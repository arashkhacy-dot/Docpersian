import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config, validateStartupConfig } from './server/config/env.js';
import { defaultStorage } from './server/storage/localStorageProvider.js';
import { defaultJobQueue } from './server/jobs/jobQueue.js';
import { defaultWorker } from './server/jobs/jobWorker.js';
import { JobState, isTerminalStatus } from './server/jobs/jobState.js';
import { PDFProcessor, ensurePersianFont } from './server/processors/pdfProcessor.js';
import { DOCXProcessor } from './server/processors/docxProcessor.js';
import { PPTXProcessor } from './server/processors/pptxProcessor.js';
import { defaultTranslator } from './server/gemini/translator.js';
import { downloadFileFromUrl } from './server/utils/urlDownloader.js';
import { createDocxFile } from './server/processors/docxHelper.js';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Enable CORS and iframe compatibility
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', (req.headers.origin as string) || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Initialize storage and ensure high-fidelity Persian font
await defaultStorage.init();
await ensurePersianFont().catch((err) => console.warn('[FONT_INIT_WARNING]', err));
const startupCheck = validateStartupConfig();
if (startupCheck.warnings.length > 0) {
  console.warn('[CONFIG_WARNINGS]', startupCheck.warnings);
}

// Multer storage in temporary folder
const tempUploadsDir = path.join(config.storagePath, 'uploads_temp');
if (!fs.existsSync(tempUploadsDir)) {
  fs.mkdirSync(tempUploadsDir, { recursive: true });
}

const upload = multer({
  limits: { fileSize: config.maxFileSize },
  dest: tempUploadsDir,
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per chunk maximum capacity
});

// Periodic cleanup of abandoned chunk upload folders (older than 2 hours)
setInterval(async () => {
  try {
    if (!fs.existsSync(tempUploadsDir)) return;
    const entries = await fs.promises.readdir(tempUploadsDir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(tempUploadsDir, entry.name);
        const stat = await fs.promises.stat(dirPath);
        if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
          await fs.promises.rm(dirPath, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('[CLEANUP_WARNING]', err);
  }
}, 30 * 60 * 1000);

// Helper to safely move files across filesystems (handles EXDEV in docker/cloud environments)
async function safeMoveFile(src: string, dest: string): Promise<void> {
  try {
    await fs.promises.rename(src, dest);
  } catch (err: any) {
    if (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EBUSY') {
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src).catch(() => {});
    } else {
      throw err;
    }
  }
}

// Helper to create and enqueue job from an uploaded/assembled file
async function createJobFromUploadedFile(
  tempFilePath: string,
  originalFileName: string,
  fileSize: number,
  mimeType: string
): Promise<JobState> {
  const docType = await detectFileType(tempFilePath, originalFileName);

  // Sanitize filename and extract base name safely
  const rawBaseName = path.basename(originalFileName || 'document.pdf');
  let decodedName = rawBaseName;
  try {
    if (/[\xC0-\xFF]/.test(rawBaseName)) {
      decodedName = Buffer.from(rawBaseName, 'latin1').toString('utf8');
    }
  } catch {}

  const currentExt = path.extname(decodedName).toLowerCase();
  const baseWithoutExt = path.basename(decodedName, currentExt).replace(/[^\w\.\-\u0600-\u06FF\s]/g, '_') || 'document';
  const targetExt = currentExt || `.${docType}`;
  const safeOriginalName = `${baseWithoutExt}${targetExt}`;

  const jobId = crypto.randomUUID();
  const { inputDir, outputDir } = await defaultStorage.createJobFolders(jobId);

  const safeInputName = `source_${safeOriginalName}`;
  const destinationInputPath = path.join(inputDir, safeInputName);
  await safeMoveFile(tempFilePath, destinationInputPath);

  const outputFileName = getOutputFilename(safeOriginalName, docType);
  const destinationOutputPath = path.join(outputDir, outputFileName);

  const job: JobState = {
    jobId,
    originalFileName: safeOriginalName,
    outputFileName,
    mimeType: mimeType || 'application/octet-stream',
    documentType: docType,
    fileSizeBytes: fileSize,
    inputPath: destinationInputPath,
    outputPath: destinationOutputPath,
    inputHash: '',
    status: 'queued',
    progress: 0,
    currentStage: 'idle',
    currentOperation: 'در صف آماده‌سازی و استخراج...',
    totalItems: 0,
    processedItems: 0,
    totalWords: 0,
    processedWords: 0,
    sourceLanguage: 'auto',
    targetLanguage: 'fa',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    elapsedMs: 0,
    retryCount: 0,
    warnings: [],
    errors: [],
    manifest: {
      inputCount: 0,
      items: [],
    },
    debugLogs: [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        tag: 'JOB_CREATED',
        message: `Document registered. Type=${docType}, FileSize=${fileSize} bytes`,
      },
    ],
  };

  await defaultJobQueue.enqueue(job);
  return job;
}

// Detect document type using magic bytes, ZIP structure inspection, and extension
async function detectFileType(filePath: string, originalName: string): Promise<'pdf' | 'docx' | 'pptx'> {
  const ext = path.extname(originalName || '').toLowerCase();
  const buffer = Buffer.alloc(16);
  try {
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
  } catch (readErr) {
    console.warn('[DETECT_FILE_TYPE_READ_ERR]', readErr);
  }

  // PDF check: %PDF (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }

  // Fast-track for standard extensions
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.pptx') return 'pptx';

  // ZIP check: PK\x03\x04 for extensionless or renamed office documents
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    try {
      const fileBuffer = await fs.promises.readFile(filePath);
      const zip = await JSZip.loadAsync(fileBuffer);
      const files = Object.keys(zip.files);
      if (files.some((f) => f.startsWith('ppt/') || f.includes('presentation.xml') || f.includes('slide'))) {
        return 'pptx';
      }
      if (files.some((f) => f.startsWith('word/') || f.includes('document.xml'))) {
        return 'docx';
      }
    } catch (zipErr) {
      console.warn('[ZIP_DETECT_ERR]', zipErr);
    }
    return 'pptx';
  }

  throw new Error(`قالب فایل پشتیبانی نمی‌شود. فقط PDF، Word (DOCX) و PowerPoint (PPTX) مجاز است.`);
}

function getOutputFilename(originalName: string, ext: string): string {
  const base = path.basename(originalName, path.extname(originalName));
  return `${base}_FA.${ext}`;
}

// ================= API ROUTES =================

// 1. Upload & Create Job (Direct single-part upload)
app.post('/api/jobs', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'هیچ فایلی برای آپلود انتخاب نشده است.' });
      return;
    }

    const tempFilePath = req.file.path;
    const originalFileName = req.file.originalname;
    const fileSize = req.file.size;
    const mimeType = req.file.mimetype || 'application/octet-stream';

    const job = await createJobFromUploadedFile(tempFilePath, originalFileName, fileSize, mimeType);
    res.status(201).json(job);
  } catch (err: any) {
    if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
    console.error('[UPLOAD_ERROR]', err);
    res.status(500).json({ error: err?.message || 'خطا در ثبت و بارگذاری فایل.' });
  }
});

// 1.1 Chunked Upload: Initialize session
app.post('/api/upload/init', async (req: Request, res: Response) => {
  try {
    const { fileName, fileSize, totalChunks, mimeType } = req.body;
    if (!fileName || !fileSize || !totalChunks) {
      res.status(400).json({ error: 'اطلاعات فایل ارسالی ناقص است.' });
      return;
    }

    if (fileSize > config.maxFileSize) {
      const maxMb = Math.round(config.maxFileSize / (1024 * 1024));
      const fileMb = Math.round(fileSize / (1024 * 1024));
      res.status(413).json({
        error: `حجم فایل (${fileMb} مگابایت) بیش از سقف مجاز سرور (${maxMb} مگابایت) است.`,
      });
      return;
    }

    const ext = path.extname(fileName).toLowerCase();
    if (!['.pdf', '.docx', '.pptx'].includes(ext)) {
      res.status(400).json({
        error: 'قالب فایل پشتیبانی نمی‌شود. فقط PDF، Word (DOCX) و PowerPoint (PPTX) مجاز است.',
      });
      return;
    }

    const uploadId = crypto.randomUUID();
    const uploadDir = path.join(tempUploadsDir, uploadId);
    await fs.promises.mkdir(uploadDir, { recursive: true });

    const metadata = {
      uploadId,
      fileName,
      fileSize,
      totalChunks,
      mimeType: mimeType || 'application/octet-stream',
      createdAt: Date.now(),
    };

    await fs.promises.writeFile(
      path.join(uploadDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    res.json({
      uploadId,
      chunkSize: 10 * 1024 * 1024,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'خطا در مقداردهی اولیه آپلود قطعه‌ای.' });
  }
});

// 1.2 Chunked Upload: Check status of received chunks
app.get('/api/upload/:uploadId/status', async (req: Request, res: Response) => {
  try {
    const uploadId = req.params.uploadId;
    const uploadDir = path.join(tempUploadsDir, uploadId);
    if (!fs.existsSync(uploadDir)) {
      res.status(404).json({ error: 'شناسه آپلود یافت نشد یا منقضی شده است.' });
      return;
    }

    const files = await fs.promises.readdir(uploadDir);
    const completedChunks: number[] = [];
    for (const f of files) {
      const match = f.match(/^chunk_(\d+)\.part$/);
      if (match) {
        try {
          const stat = await fs.promises.stat(path.join(uploadDir, f));
          if (stat.size > 0) {
            completedChunks.push(parseInt(match[1], 10));
          }
        } catch {}
      }
    }

    completedChunks.sort((a, b) => a - b);

    res.json({
      uploadId,
      completedChunks,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'خطا در دریافت وضعیت آپلود.' });
  }
});

// 1.3 Chunked Upload: Upload a single chunk
app.post('/api/upload/chunk', chunkUpload.single('chunk'), async (req: Request, res: Response) => {
  try {
    const uploadId = req.body.uploadId;
    const chunkIndex = parseInt(req.body.chunkIndex, 10);

    if (!uploadId || isNaN(chunkIndex) || !req.file) {
      res.status(400).json({ error: 'اطلاعات قطعه ارسالی ناقص است.' });
      return;
    }

    const uploadDir = path.join(tempUploadsDir, uploadId);
    if (!fs.existsSync(uploadDir)) {
      res.status(404).json({ error: 'شناسه آپلود یافت نشد یا منقضی شده است.' });
      return;
    }

    const chunkTarget = path.join(uploadDir, `chunk_${chunkIndex}.part`);
    await fs.promises.writeFile(chunkTarget, req.file.buffer);

    res.json({ success: true, chunkIndex });
  } catch (err: any) {
    console.error('[CHUNK_UPLOAD_ERR]', err);
    res.status(500).json({ error: err?.message || 'خطا در ذخیره قطعه فایل بر روی سرور.' });
  }
});

// 1.4 Chunked Upload: Complete and merge all chunks
app.post('/api/upload/complete', async (req: Request, res: Response) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      res.status(400).json({ error: 'شناسه آپلود الزامی است.' });
      return;
    }

    const uploadDir = path.join(tempUploadsDir, uploadId);
    const metaPath = path.join(uploadDir, 'metadata.json');
    if (!fs.existsSync(metaPath)) {
      res.status(404).json({ error: 'جلسه آپلود یافت نشد یا منقضی شده است.' });
      return;
    }

    const metaRaw = await fs.promises.readFile(metaPath, 'utf-8');
    const metadata = JSON.parse(metaRaw);

    // Verify all chunks exist and have positive size
    const missingChunks: number[] = [];
    for (let i = 0; i < metadata.totalChunks; i++) {
      const chunkPath = path.join(uploadDir, `chunk_${i}.part`);
      if (!fs.existsSync(chunkPath)) {
        missingChunks.push(i);
      } else {
        const stat = await fs.promises.stat(chunkPath);
        if (stat.size === 0) {
          missingChunks.push(i);
        }
      }
    }

    if (missingChunks.length > 0) {
      res.status(400).json({
        error: `قطعات شماره ${missingChunks.map((c) => c + 1).slice(0, 5).join(', ')} بر روی سرور دریافت نشده‌اند.`,
        missingChunks,
      });
      return;
    }

    // Merge chunks into a single file with fast, robust sequential write
    const safeTargetFileName = path.basename(metadata.fileName || 'document.pdf');
    const mergedFilePath = path.join(tempUploadsDir, `${uploadId}_${safeTargetFileName}`);
    const destFd = await fs.promises.open(mergedFilePath, 'w');

    try {
      for (let i = 0; i < metadata.totalChunks; i++) {
        const chunkPath = path.join(uploadDir, `chunk_${i}.part`);
        if (!fs.existsSync(chunkPath)) {
          throw new Error(`قطعه شماره ${i + 1} از ${metadata.totalChunks} بر روی سرور یافت نشد.`);
        }
        const chunkBuffer = await fs.promises.readFile(chunkPath);
        await destFd.write(chunkBuffer);
      }
    } finally {
      await destFd.close();
    }

    // Create and enqueue job from assembled file
    const job = await createJobFromUploadedFile(
      mergedFilePath,
      metadata.fileName,
      metadata.fileSize,
      metadata.mimeType
    );

    // Cleanup part files and upload session directory ONLY AFTER job is successfully created
    await fs.promises.rm(uploadDir, { recursive: true, force: true }).catch(() => {});

    res.status(201).json(job);
  } catch (err: any) {
    console.error('[CHUNK_COMPLETE_ERROR]', err);
    res.status(500).json({ error: err?.message || 'خطا در یکپارچه‌سازی و اعتبارسنجی سند.' });
  }
});

// 1.5 Import Document from Google Drive, Dropbox or Direct Web URL
app.post('/api/jobs/import-url', async (req: Request, res: Response) => {
  try {
    const { url, fileName } = req.body;
    if (!url || typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ error: 'لطفاً آدرس لینک فایل یا گوگل درایو را وارد نمایید.' });
      return;
    }

    // Direct high-speed fetch via Google Cloud backbone
    const downloaded = await downloadFileFromUrl(url.trim(), fileName);

    const job = await createJobFromUploadedFile(
      downloaded.tempFilePath,
      downloaded.originalFileName,
      downloaded.fileSize,
      downloaded.mimeType
    );

    res.status(201).json(job);
  } catch (err: any) {
    console.error('[URL_IMPORT_ERROR]', err);
    res.status(400).json({ error: err?.message || 'خطا در دریافت سند از لینک وارد شده.' });
  }
});

// 2. List Recent Jobs
app.get('/api/jobs', async (_req: Request, res: Response) => {
  const jobs = await defaultJobQueue.listRecentJobs();
  res.json(jobs);
});

// 2.1 Alias for recent jobs
app.get('/api/jobs/recent', async (_req: Request, res: Response) => {
  const jobs = await defaultJobQueue.listRecentJobs();
  res.json(jobs);
});

// Helper to serialize job state cleanly for client UI (omits text dumps during in-flight processing, includes on completion)
function serializeJobForClient(job: JobState) {
  const isTerminal = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(job.status);
  if (isTerminal) {
    return {
      ...job,
      pageTranslations: job.pageTranslations || [],
      translatedText: job.translatedText || '',
      debugLogs: (job.debugLogs || []).slice(-35),
    };
  }

  const { translatedText, pageTranslations, ...rest } = job;
  return {
    ...rest,
    debugLogs: (job.debugLogs || []).slice(-35),
  };
}

// 3. Get Job State
app.get('/api/jobs/:id', async (req: Request, res: Response) => {
  const job = await defaultJobQueue.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'کار درخواستی یافت نشد.' });
    return;
  }
  res.json(serializeJobForClient(job));
});

// 4. SSE Stream for Live Updates
app.get('/api/jobs/:id/events', async (req: Request, res: Response) => {
  const jobId = req.params.id;
  const initialJob = await defaultJobQueue.getJob(jobId);
  if (!initialJob) {
    res.status(404).json({ error: 'شناسه کار یافت نشد.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state immediately (lightweight payload < 5KB)
  res.write(`data: ${JSON.stringify(serializeJobForClient(initialJob))}\n\n`);

  const onUpdate = (job: JobState) => {
    if (job.jobId === jobId) {
      res.write(`data: ${JSON.stringify(serializeJobForClient(job))}\n\n`);
      if (isTerminalStatus(job.status)) {
        // Keep stream open briefly then finish
      }
    }
  };

  defaultWorker.on('update', onUpdate);

  req.on('close', () => {
    defaultWorker.off('update', onUpdate);
  });
});

// 5. Cancel Job
app.post('/api/jobs/:id/cancel', async (req: Request, res: Response) => {
  const job = await defaultJobQueue.cancelJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'کار برای لغو یافت نشد.' });
    return;
  }
  res.json(job);
});

// 6. Resume Job
app.post('/api/jobs/:id/resume', async (req: Request, res: Response) => {
  const job = await defaultJobQueue.resumeJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'کار برای ادامه یافت نشد.' });
    return;
  }
  res.json(job);
});

// 7. Download Translated Document (Sections 20 & 46)
app.get('/api/jobs/:id/download', async (req: Request, res: Response) => {
  const job = await defaultJobQueue.getJob(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'کار مورد نظر پیدا نشد.' });
    return;
  }

  // 1. Verify terminal status
  if (!isTerminalStatus(job.status)) {
    res.status(400).json({ error: 'پردازش سند هنوز به پایان نرسیده است.' });
    return;
  }

  if (job.status === 'failed' || job.status === 'cancelled') {
    res.status(400).json({
      error: `دانلود امکان‌پذیر نیست؛ وضعیت سند ${job.status === 'cancelled' ? 'لغو شده' : 'ناموفق'} است.`,
    });
    return;
  }

  // 2 & 3. Verify outputPath exists
  if (!job.outputPath) {
    res.status(500).json({ error: 'مسیر فایل خروجی در شناسه کار ثبت نشده است.' });
    return;
  }

  // 4 & 5. Verify output file exists and is non-empty
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(job.outputPath);
    if (stats.size === 0) {
      res.status(500).json({ error: 'فایل خروجی تولید شده نامعتبر است (صفر بایت).' });
      return;
    }
  } catch {
    res.status(404).json({ error: 'فایل خروجی روی سرور یافت نشد.' });
    return;
  }

  // 6. Verify outputPath != inputPath (NEVER fall back to input file!)
  if (job.outputPath === job.inputPath) {
    res.status(500).json({ error: 'نقض یکپارچگی: مسیر فایل خروجی منطبق با ورودی است.' });
    return;
  }

  // 7. Verify critical integrity checks
  if (job.qualityReport && job.qualityReport.validationStatus === 'failed') {
    res.status(400).json({ error: 'سند خروجی بررسی‌های ساختاری اعتبارسنجی را پشت سر نگذاشته است.' });
    return;
  }

  // 8. Stream the OUTPUT file (support ?format=pptx, ?format=docx, ?format=txt, ?format=pdf)
  try {
    const requestedFormat = (req.query.format as string || '').toLowerCase();
    let targetPath = job.outputPath;
    let targetFileName = job.outputFileName;
    let contentType = 'application/octet-stream';

    const isOutputPptx = job.outputPath.endsWith('.pptx');
    const isOutputPdf = job.outputPath.endsWith('.pdf');
    const isOutputDocx = job.outputPath.endsWith('.docx');
    const isOutputTxt = job.outputPath.endsWith('.txt');

    if (requestedFormat === 'pptx' || (!requestedFormat && isOutputPptx)) {
      targetPath = job.outputPath;
      targetFileName = job.outputFileName.replace(/\.(txt|docx|pdf)$/i, '.pptx');
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else if (requestedFormat === 'pdf' || (!requestedFormat && isOutputPdf)) {
      contentType = 'application/pdf';
      targetFileName = job.outputFileName.replace(/\.(txt|docx|pptx)$/i, '.pdf');
      if (isOutputPdf) {
        targetPath = job.outputPath;
      } else {
        const candidatePdf = job.outputPath.replace(/\.(txt|docx|pptx)$/i, '.pdf');
        if (fs.existsSync(candidatePdf)) {
          targetPath = candidatePdf;
        } else {
          targetPath = job.outputPath;
        }
      }
    } else if (requestedFormat === 'docx' || (!requestedFormat && isOutputDocx)) {
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      targetFileName = job.outputFileName.replace(/\.(txt|pdf|pptx)$/i, '.docx');

      if (isOutputDocx) {
        targetPath = job.outputPath;
      } else {
        const companionDocx = `${job.outputPath}.docx`;
        if (fs.existsSync(companionDocx)) {
          targetPath = companionDocx;
        } else if (job.pageTranslations && job.pageTranslations.length > 0) {
          // Generate on-the-fly if companion is missing
          await createDocxFile(
            job.originalFileName,
            job.pageTranslations,
            companionDocx,
            isOutputPptx ? 'اسلاید' : 'صفحه'
          );
          targetPath = companionDocx;
        } else {
          targetPath = job.outputPath;
        }
      }
    } else if (requestedFormat === 'txt' || (!requestedFormat && isOutputTxt)) {
      contentType = 'text/plain; charset=utf-8';
      targetFileName = job.outputFileName.replace(/\.(docx|pdf|pptx)$/i, '.txt');

      if (isOutputTxt) {
        targetPath = job.outputPath;
      } else {
        const companionTxt = `${job.outputPath}.txt`;
        if (fs.existsSync(companionTxt)) {
          targetPath = companionTxt;
        } else {
          // Generate on-the-fly companion TXT if missing
          const textContent =
            job.translatedText ||
            job.pageTranslations?.map((p) => `--- صفحه/اسلاید ${p.pageNumber} ---\n${p.translatedText}`).join('\n\n') ||
            'ترجمه کامل سند انجام شده است.';
          await fs.promises.writeFile(companionTxt, Buffer.from(textContent, 'utf-8'));
          targetPath = companionTxt;
        }
      }
    }

    const finalStats = await fs.promises.stat(targetPath);
    const fileSize = finalStats.size;

    // RFC 6266 / RFC 5987 compliant disposition with safe ASCII fallback
    const rawFileName = targetFileName;
    const ext = path.extname(rawFileName);
    const baseName = path.basename(rawFileName, ext).replace(/[^\w\d\-]/g, '_');
    const safeAsciiFilename = `${baseName || 'translated_document'}${ext}`;
    const utf8Filename = encodeURIComponent(rawFileName);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeAsciiFilename}"; filename*=UTF-8''${utf8Filename}`
    );

    // Support HTTP Range requests (HTTP 206 Partial Content) for accelerated multi-chunk downloads and pause/resume
    const rangeHeader = req.headers.range;

    if (rangeHeader && fileSize > 0) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start < fileSize && end < fileSize && start <= end) {
          const chunkSize = end - start + 1;
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          res.setHeader('Content-Length', chunkSize);

          const rangeStream = fs.createReadStream(targetPath, {
            start,
            end,
            highWaterMark: 1024 * 1024, // 1MB buffer for maximum throughput
          });

          rangeStream.on('error', (err) => {
            console.error('[RANGE_STREAM_ERROR]', err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'خطا در ارسال بخش فایل خروجی.' });
            }
          });

          rangeStream.pipe(res);
          return;
        } else {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          res.end();
          return;
        }
      }
    }

    // Standard full stream with 1MB highWaterMark
    res.setHeader('Content-Length', fileSize);

    const fileStream = fs.createReadStream(targetPath, {
      highWaterMark: 1024 * 1024, // 1MB chunk buffer to prevent throttling on high-speed internet
    });

    fileStream.on('error', (err) => {
      console.error('[STREAM_ERROR]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'خطا در خواندن فایل خروجی.' });
      }
    });

    fileStream.pipe(res);
  } catch (err: any) {
    console.error('[DOWNLOAD_ROUTE_ERROR]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'خطا در بارگیری فایل خروجی از سرور.' });
    }
  }
});

// 8. Direct Translated Text endpoint
app.get('/api/jobs/:id/text', async (req: Request, res: Response) => {
  const job = await defaultJobQueue.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'کار مورد نظر پیدا نشد.' });
    return;
  }

  let text = job.translatedText || '';
  if (!text && job.outputPath) {
    const companionTxt = `${job.outputPath}.txt`;
    if (fs.existsSync(companionTxt)) {
      try {
        text = await fs.promises.readFile(companionTxt, 'utf-8');
      } catch {}
    }
  }

  res.json({
    jobId: job.jobId,
    originalFileName: job.originalFileName,
    status: job.status,
    translatedText: text,
    pageTranslations: job.pageTranslations || [],
    totalWords: job.totalWords,
    totalItems: job.totalItems,
  });
});

// 8. Direct Inline View (Preview in Browser)
app.get('/api/jobs/:id/view', async (req: Request, res: Response) => {
  const job = await defaultJobQueue.getJob(req.params.id);

  if (!job || !isTerminalStatus(job.status) || !job.outputPath) {
    res.status(404).send('فایل برای پیش‌نمایش در دسترس نیست.');
    return;
  }

  try {
    const stats = await fs.promises.stat(job.outputPath);
    if (stats.size === 0) {
      res.status(404).send('فایل خروجی خالی است.');
      return;
    }

    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    const contentType = mimeTypes[job.documentType] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const fileStream = fs.createReadStream(job.outputPath);
    fileStream.pipe(res);
  } catch {
    res.status(500).send('خطا در دسترسی به فایل برای پیش‌نمایش.');
  }
});

// 8. Quality Report
app.get('/api/jobs/:id/report', async (req: Request, res: Response) => {
  const job = await defaultJobQueue.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'کار یافت نشد.' });
    return;
  }
  res.json(job.qualityReport || null);
});

// 9. System Health & Config Info
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    model: config.geminiModel,
    engine: defaultTranslator.getEngineSettings().engine,
    localUrl: defaultTranslator.getEngineSettings().localUrl,
    localModel: defaultTranslator.getEngineSettings().localModel,
    maxFileSize: config.maxFileSize,
    maxConcurrentJobs: config.maxConcurrentJobs,
    hasApiKey: !!config.geminiApiKey,
    cacheEnabled: config.cacheEnabled,
  });
});

// Engine Settings endpoints (Gemini vs Local Private Server)
app.get('/api/settings/engine', (_req: Request, res: Response) => {
  res.json(defaultTranslator.getEngineSettings());
});

app.post('/api/settings/engine', (req: Request, res: Response) => {
  const { engine, localUrl, localModel, diagramInpainting } = req.body;
  if (engine !== 'gemini' && engine !== 'local') {
    res.status(400).json({ error: 'موتور باید gemini یا local باشد.' });
    return;
  }
  defaultTranslator.setEngineSettings(
    engine,
    localUrl,
    localModel,
    typeof diagramInpainting === 'boolean' ? diagramInpainting : undefined
  );
  res.json({ success: true, settings: defaultTranslator.getEngineSettings() });
});

app.post('/api/settings/test-local', async (req: Request, res: Response) => {
  const { localUrl, localModel } = req.body;
  const result = await defaultTranslator.testLocalConnection(localUrl, localModel);
  res.json(result);
});

// Checkpoint Restoration Endpoint
app.post('/api/settings/restore-checkpoint', async (_req: Request, res: Response) => {
  const scriptPath = path.join(process.cwd(), 'restore_checkpoint_v1.sh');
  if (fs.existsSync(scriptPath)) {
    try {
      res.json({
        success: true,
        message: 'دستور بازگردانی آماده است. برای بازگردانی کامل به چک‌پوینت پایدار، دستور ./restore_checkpoint_v1.sh را در ترمینال سرور اجرا کنید یا از طریق گیت ریست نمایید.',
        command: './restore_checkpoint_v1.sh',
        tag: 'checkpoint-v1.0',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'خطا در بررسی چک‌پوینت' });
    }
  } else {
    res.status(404).json({ success: false, error: 'فایل اسکریپت چک‌پوینت یافت نشد.' });
  }
});

// VPS Update Script Endpoint
app.get('/api/update.sh', (_req: Request, res: Response) => {
  const scriptPath = path.join(process.cwd(), 'update_vps.sh');
  if (fs.existsSync(scriptPath)) {
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.sendFile(scriptPath);
  } else {
    res.status(404).send('#!/bin/bash\necho "Update script not found"\n');
  }
});

// Multer and file upload error handling middleware
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: `حجم فایل ارسالی بیش از سقف مجاز سرور (${Math.round(config.maxFileSize / (1024 * 1024))} مگابایت) است. لطفاً از قابلیت آپلود قطعه‌ای برای ارسال فایل‌های سنگین استفاده فرمایید.`,
      });
      return;
    }
    res.status(400).json({
      error: `خطا در دریافت و ذخیره فایل: ${err.message}`,
    });
    return;
  }
  next(err);
});

// General error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API_ERROR]', err);
  res.status(500).json({
    error: err?.message || 'خطای غیرمنتظره در سرور رخ داده است.',
  });
});

// ================= FRONTEND / VITE SERVING =================
async function startServer() {
  const distPath = path.resolve(__dirname, 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (hasDist && (!config.isDev || process.env.NODE_ENV === 'production' || process.env.SERVE_DIST === 'true')) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('[FRONTEND] Serving optimized production build from dist (Zero reload glitches)');
  } else if (config.isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[FRONTEND] Serving Vite middleware (HMR disabled to prevent mobile reload glitches)');
  } else if (hasDist) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`DocuShift server running on port ${config.port} (mode: ${config.isDev ? 'dev' : 'prod'})`);
  });

  // Optimize timeouts for large document and presentation uploads
  server.setTimeout(30 * 60 * 1000); // 30 minutes
  server.keepAliveTimeout = 120 * 1000;
  server.headersTimeout = 130 * 1000;
}

startServer().catch((err) => {
  console.error('Fatal startup failure:', err);
  process.exit(1);
});
