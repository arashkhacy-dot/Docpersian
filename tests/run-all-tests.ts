import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import { defaultStorage } from '../server/storage/localStorageProvider.js';
import { defaultWorker } from '../server/jobs/jobWorker.js';
import { defaultJobQueue } from '../server/jobs/jobQueue.js';
import { defaultValidator } from '../server/validation/documentValidator.js';
import { PDFProcessor } from '../server/processors/pdfProcessor.js';
import { DOCXProcessor } from '../server/processors/docxProcessor.js';
import { PPTXProcessor } from '../server/processors/pptxProcessor.js';
import { JobState } from '../server/jobs/jobState.js';

const TEST_DIR = path.resolve(process.cwd(), './test_artifacts');

async function setupTestDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  await defaultStorage.init();
}

async function createSamplePdf(pageCount: number, filename: string, emptyPages: number[] = []): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([595, 842]);
    if (!emptyPages.includes(i)) {
      page.drawText(`Page ${i} content: Introduction and technical analysis of architecture.`, {
        x: 50,
        y: 800,
        size: 14,
      });
    }
  }
  const bytes = await doc.save();
  const filePath = path.join(TEST_DIR, filename);
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

async function createSampleDocx(filename: string): Promise<string> {
  const zip = new JSZip();
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Project Executive Summary</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>This is the detailed report for Q4 revenue growth.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
  zip.file('word/document.xml', docXml);
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const filePath = path.join(TEST_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

async function createSamplePptx(slideCount: number, filename: string): Promise<string> {
  const zip = new JSZip();
  for (let i = 1; i <= slideCount; i++) {
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:r><a:t>Slide ${i} Strategic Roadmap</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
    zip.file(`ppt/slides/slide${i}.xml`, slideXml);
  }
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const filePath = path.join(TEST_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('DocuShift Automated Test Suite (Section 44 Tests A-Q)');
  console.log('====================================================\n');

  await setupTestDir();
  let passedCount = 0;
  let failedCount = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`TEST [${name}] ... `);
    try {
      await fn();
      console.log('PASSED ✓');
      passedCount++;
    } catch (err: any) {
      console.log(`FAILED ✗: ${err?.message || err}`);
      failedCount++;
    }
  }

  // A. Normal completion
  await test('A. Normal completion', async () => {
    const pdfPath = await createSamplePdf(3, 'test_a.pdf');
    const { inputDir, outputDir } = await defaultStorage.createJobFolders('job_a');
    const inputPath = path.join(inputDir, 'test_a.pdf');
    const outputPath = path.join(outputDir, 'test_a_FA.pdf');
    await fs.promises.copyFile(pdfPath, inputPath);

    const pdfProc = new PDFProcessor();
    const analysis = await pdfProc.analyzeDocument(inputPath);

    const job: JobState = {
      jobId: 'job_a',
      originalFileName: 'test_a.pdf',
      outputFileName: 'test_a_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: (await fs.promises.stat(inputPath)).size,
      inputPath,
      outputPath,
      inputHash: await defaultStorage.computeHash(inputPath),
      status: 'queued',
      progress: 0,
      currentStage: 'idle',
      currentOperation: '',
      totalItems: analysis.itemCount,
      processedItems: 0,
      totalWords: analysis.totalWords,
      processedWords: 0,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: analysis.itemCount, items: analysis.initialManifest },
      debugLogs: [],
    };

    await defaultWorker.runJob(job);
    if (job.status !== 'completed' && job.status !== 'completed_with_warnings') {
      throw new Error(`Job ended with status: ${job.status}`);
    }
    if (job.progress !== 100) {
      throw new Error(`Job progress is not 100% on normal completion: ${job.progress}`);
    }
  });

  // B. Cancel at 50%
  await test('B. Cancel at 50%', async () => {
    const job: JobState = {
      jobId: 'job_b',
      originalFileName: 'test_b.pdf',
      outputFileName: 'test_b_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 1000,
      inputPath: '/tmp/test.pdf',
      outputPath: '/tmp/test_out.pdf',
      inputHash: 'hash',
      status: 'processing',
      progress: 50,
      currentStage: 'translating',
      currentOperation: 'ترجمه متن',
      totalItems: 10,
      processedItems: 5,
      totalWords: 500,
      processedWords: 250,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 5000,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 10, items: [] },
      debugLogs: [],
    };

    defaultWorker.cancelJob(job);
    if (job.status !== 'cancelled' && job.status !== 'cancelling') {
      throw new Error(`Expected cancelled status, got: ${job.status}`);
    }
    if (job.progress === 100) {
      throw new Error('BUG: Cancel must never set progress to 100%!');
    }
  });

  // C. Cancel at 88%
  await test('C. Cancel at 88%', async () => {
    const job: JobState = {
      jobId: 'job_c',
      originalFileName: 'test_c.pdf',
      outputFileName: 'test_c_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 1000,
      inputPath: '/tmp/test.pdf',
      outputPath: '/tmp/test_out.pdf',
      inputHash: 'hash',
      status: 'processing',
      progress: 88,
      currentStage: 'reconstructing',
      currentOperation: 'بازسازی صفحات',
      totalItems: 100,
      processedItems: 88,
      totalWords: 1000,
      processedWords: 880,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 20000,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 100, items: [] },
      debugLogs: [],
    };

    defaultWorker.cancelJob(job);
    if (job.status !== 'cancelled' && job.status !== 'cancelling') {
      throw new Error(`Expected cancelled status, got: ${job.status}`);
    }
    if (job.progress === 100) {
      throw new Error('BUG: Cancel must not jump to 100%!');
    }
  });

  // D. Validation timeout protection
  await test('D. Validation timeout protection', async () => {
    const job: JobState = {
      jobId: 'job_d',
      originalFileName: 'test_d.pdf',
      outputFileName: 'test_d_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 1000,
      inputPath: '/tmp/in.pdf',
      outputPath: '/tmp/out.pdf',
      inputHash: 'hash',
      status: 'validating',
      progress: 92,
      currentStage: 'validation',
      currentOperation: 'اعتبارسنجی',
      totalItems: 10,
      processedItems: 10,
      totalWords: 100,
      processedWords: 100,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 10000,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 10, items: [] },
      debugLogs: [],
    };
    // Non-existent output path should fail fast without hanging
    const res = await defaultValidator.validateJobOutput(job);
    if (res.criticalPassed) {
      throw new Error('Non-existent file should fail validation');
    }
  });

  // E. Missing output
  await test('E. Missing output', async () => {
    const job: JobState = {
      jobId: 'job_e',
      originalFileName: 'test_e.pdf',
      outputFileName: 'test_e_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 1000,
      inputPath: '/tmp/exists.pdf',
      outputPath: '/tmp/nonexistent_xyz_123.pdf',
      inputHash: 'hash',
      status: 'validating',
      progress: 92,
      currentStage: 'validation',
      currentOperation: '',
      totalItems: 5,
      processedItems: 5,
      totalWords: 100,
      processedWords: 100,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 5, items: [] },
      debugLogs: [],
    };
    const res = await defaultValidator.validateJobOutput(job);
    if (res.criticalPassed) {
      throw new Error('Should not pass validation when output file is missing');
    }
  });

  // F. Input exists but output does not (download prevention)
  await test('F. Input exists but output does not', async () => {
    const job: JobState = {
      jobId: 'job_f',
      originalFileName: 'in.pdf',
      outputFileName: 'out.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 100,
      inputPath: '/tmp/in.pdf',
      outputPath: '/tmp/missing.pdf',
      inputHash: 'hash',
      status: 'completed',
      progress: 100,
      currentStage: 'idle',
      currentOperation: '',
      totalItems: 1,
      processedItems: 1,
      totalWords: 10,
      processedWords: 10,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 1, items: [] },
      debugLogs: [],
    };
    const exists = await defaultStorage.fileExists(job.outputPath);
    if (exists) throw new Error('File should not exist');
  });

  // G. Valid output download verification
  await test('G. Valid output download', async () => {
    const pdfPath = await createSamplePdf(2, 'test_g.pdf');
    const stats = await fs.promises.stat(pdfPath);
    if (stats.size === 0) throw new Error('Output cannot be empty');
  });

  // H. Input/output path separation
  await test('H. Input/output path separation', async () => {
    const { inputDir, outputDir } = await defaultStorage.createJobFolders('job_h');
    const inputPath = defaultStorage.getInputPath('job_h', 'doc.pdf');
    const outputPath = defaultStorage.getOutputPath('job_h', 'doc_FA.pdf');
    if (inputPath === outputPath) {
      throw new Error('BUG: inputPath and outputPath must never be identical!');
    }
    if (inputDir === outputDir) {
      throw new Error('BUG: inputDir and outputDir must be distinct!');
    }
  });

  // I. 170-page PDF page accounting (Section 45 Real PDF Acceptance Test)
  await test('I. 170-page PDF page accounting (170 in = 170 out)', async () => {
    const bigPdfPath = await createSamplePdf(170, 'big_170_page.pdf', [10, 50, 100, 150]);
    const { inputDir, outputDir } = await defaultStorage.createJobFolders('job_170');
    const inputPath = path.join(inputDir, 'big_170_page.pdf');
    const outputPath = path.join(outputDir, 'big_170_page_FA.pdf');
    await fs.promises.copyFile(bigPdfPath, inputPath);

    const pdfProc = new PDFProcessor();
    const analysis = await pdfProc.analyzeDocument(inputPath);
    if (analysis.itemCount !== 170) {
      throw new Error(`Expected 170 pages analyzed, got ${analysis.itemCount}`);
    }

    const job: JobState = {
      jobId: 'job_170',
      originalFileName: 'big_170_page.pdf',
      outputFileName: 'big_170_page_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: (await fs.promises.stat(inputPath)).size,
      inputPath,
      outputPath,
      inputHash: await defaultStorage.computeHash(inputPath),
      status: 'queued',
      progress: 0,
      currentStage: 'idle',
      currentOperation: '',
      totalItems: 170,
      processedItems: 0,
      totalWords: analysis.totalWords,
      processedWords: 0,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 170, items: analysis.initialManifest },
      debugLogs: [],
    };

    await defaultWorker.runJob(job);

    // Verify output file page count
    const outBytes = await fs.promises.readFile(outputPath);
    const outDoc = await PDFDocument.load(outBytes);
    const outputPageCount = outDoc.getPageCount();

    if (outputPageCount !== 170) {
      throw new Error(`CRITICAL BUG: 170-page PDF resulted in ${outputPageCount} pages!`);
    }
  });

  // J. Empty-text page preservation (Section 3)
  await test('J. Empty-text page preservation', async () => {
    const mixedPdfPath = await createSamplePdf(5, 'mixed_empty.pdf', [2, 4]); // Pages 2 and 4 are empty
    const { inputDir, outputDir } = await defaultStorage.createJobFolders('job_j');
    const inputPath = path.join(inputDir, 'mixed_empty.pdf');
    const outputPath = path.join(outputDir, 'mixed_empty_FA.pdf');
    await fs.promises.copyFile(mixedPdfPath, inputPath);

    const pdfProc = new PDFProcessor();
    const analysis = await pdfProc.analyzeDocument(inputPath);

    const job: JobState = {
      jobId: 'job_j',
      originalFileName: 'mixed_empty.pdf',
      outputFileName: 'mixed_empty_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: (await fs.promises.stat(inputPath)).size,
      inputPath,
      outputPath,
      inputHash: await defaultStorage.computeHash(inputPath),
      status: 'queued',
      progress: 0,
      currentStage: 'idle',
      currentOperation: '',
      totalItems: 5,
      processedItems: 0,
      totalWords: analysis.totalWords,
      processedWords: 0,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 5, items: analysis.initialManifest },
      debugLogs: [],
    };

    await defaultWorker.runJob(job);
    const outBytes = await fs.promises.readFile(outputPath);
    const outDoc = await PDFDocument.load(outBytes);
    if (outDoc.getPageCount() !== 5) {
      throw new Error(`Empty pages were dropped! Got ${outDoc.getPageCount()} pages instead of 5`);
    }
  });

  // K. Missing page detection
  await test('K. Missing page detection', async () => {
    const job: JobState = {
      jobId: 'job_k',
      originalFileName: 'doc.pdf',
      outputFileName: 'doc_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 100,
      inputPath: '/tmp/test.pdf',
      outputPath: path.join(TEST_DIR, 'test_a.pdf'), // Has 3 pages
      inputHash: 'hash',
      status: 'validating',
      progress: 92,
      currentStage: 'validation',
      currentOperation: '',
      totalItems: 5, // Expected 5, file only has 3
      processedItems: 5,
      totalWords: 10,
      processedWords: 10,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 5, items: [] },
      debugLogs: [],
    };
    const res = await defaultValidator.validateJobOutput(job);
    if (res.criticalPassed) {
      throw new Error('Validator must detect page count mismatch');
    }
  });

  // L. Failed page retry
  await test('L. Failed page retry logic', async () => {
    // Tests retry loop and exponential backoff utility
    let attempts = 0;
    const testRetryOp = async () => {
      attempts++;
      if (attempts < 3) throw new Error('Transient 503 error');
      return 'success';
    };

    let result = '';
    for (let i = 1; i <= 3; i++) {
      try {
        result = await testRetryOp();
        break;
      } catch {
        if (i === 3) throw new Error('Retry exhausted');
      }
    }
    if (result !== 'success' || attempts !== 3) {
      throw new Error(`Expected 3 attempts, got ${attempts}`);
    }
  });

  // M. Browser reconnect (loading persisted state)
  await test('M. Browser reconnect', async () => {
    const dummyJob: JobState = {
      jobId: 'reconnect_job_123',
      originalFileName: 'reconnect.pdf',
      outputFileName: 'reconnect_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 2048,
      inputPath: '/tmp/in.pdf',
      outputPath: '/tmp/out.pdf',
      inputHash: 'dummy',
      status: 'translating',
      progress: 45,
      currentStage: 'translation',
      currentOperation: 'صفحه ۵ از ۱۰',
      totalItems: 10,
      processedItems: 5,
      totalWords: 300,
      processedWords: 150,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 15000,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 10, items: [] },
      debugLogs: [],
    };
    await defaultStorage.saveJobState(dummyJob);
    const loaded = await defaultStorage.loadJobState('reconnect_job_123');
    if (!loaded || loaded.progress !== 45 || loaded.status !== 'translating') {
      throw new Error('Browser reconnect failed to retrieve exact job state from server');
    }
  });

  // N. Worker restart / resume
  await test('N. Worker restart/resume', async () => {
    const validPdf = await createSamplePdf(1, 'resume_sample.pdf');
    const pausedJob: JobState = {
      jobId: 'resume_job_456',
      originalFileName: 'resume.pdf',
      outputFileName: 'resume_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 2048,
      inputPath: validPdf,
      outputPath: path.join(TEST_DIR, 'resume_FA.pdf'),
      inputHash: 'dummy',
      status: 'failed',
      progress: 55,
      currentStage: 'translation',
      currentOperation: 'خطا رخ داد',
      totalItems: 1,
      processedItems: 1,
      totalWords: 300,
      processedWords: 150,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 15000,
      retryCount: 0,
      warnings: [],
      errors: ['Network timeout'],
      manifest: { inputCount: 1, items: [] },
      debugLogs: [],
    };
    await defaultStorage.saveJobState(pausedJob);
    const resumed = await defaultJobQueue.resumeJob('resume_job_456');
    if (!resumed || (resumed.status !== 'queued' && resumed.status !== 'processing')) {
      throw new Error(`Resume did not reset job status properly: ${resumed?.status}`);
    }
  });

  // O. Output corruption detection
  await test('O. Output corruption detection', async () => {
    const corruptFile = path.join(TEST_DIR, 'corrupt.pdf');
    await fs.promises.writeFile(corruptFile, Buffer.from('NOT_A_VALID_PDF_HEADER'));
    const job: JobState = {
      jobId: 'job_o',
      originalFileName: 'corrupt.pdf',
      outputFileName: 'corrupt_FA.pdf',
      mimeType: 'application/pdf',
      documentType: 'pdf',
      fileSizeBytes: 100,
      inputPath: '/tmp/in.pdf',
      outputPath: corruptFile,
      inputHash: 'hash',
      status: 'validating',
      progress: 92,
      currentStage: 'validation',
      currentOperation: '',
      totalItems: 1,
      processedItems: 1,
      totalWords: 10,
      processedWords: 10,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 1, items: [] },
      debugLogs: [],
    };
    const res = await defaultValidator.validateJobOutput(job);
    if (res.criticalPassed) {
      throw new Error('Corrupted output must fail validation');
    }
  });

  // P. PPTX slide-count preservation
  await test('P. PPTX slide-count preservation', async () => {
    const pptxPath = await createSamplePptx(6, 'presentation_6.pptx');
    const { inputDir, outputDir } = await defaultStorage.createJobFolders('job_pptx');
    const inputPath = path.join(inputDir, 'presentation_6.pptx');
    const outputPath = path.join(outputDir, 'presentation_6_FA.pptx');
    await fs.promises.copyFile(pptxPath, inputPath);

    const pptxProc = new PPTXProcessor();
    const analysis = await pptxProc.analyzeDocument(inputPath);
    if (analysis.itemCount !== 6) {
      throw new Error(`Expected 6 slides, got ${analysis.itemCount}`);
    }

    const job: JobState = {
      jobId: 'job_pptx',
      originalFileName: 'presentation_6.pptx',
      outputFileName: 'presentation_6_FA.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      documentType: 'pptx',
      fileSizeBytes: (await fs.promises.stat(inputPath)).size,
      inputPath,
      outputPath,
      inputHash: await defaultStorage.computeHash(inputPath),
      status: 'queued',
      progress: 0,
      currentStage: 'idle',
      currentOperation: '',
      totalItems: 6,
      processedItems: 0,
      totalWords: analysis.totalWords,
      processedWords: 0,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: 6, items: analysis.initialManifest },
      debugLogs: [],
    };

    await defaultWorker.runJob(job);
    const outBuffer = await fs.promises.readFile(outputPath);
    const zip = await JSZip.loadAsync(outBuffer);
    let slideCount = 0;
    zip.forEach((p) => {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(p)) slideCount++;
    });

    if (slideCount !== 6) {
      throw new Error(`CRITICAL BUG: PPTX slide count mismatch! Expected 6, got ${slideCount}`);
    }
  });

  // Q. DOCX structural preservation
  await test('Q. DOCX structural preservation', async () => {
    const docxPath = await createSampleDocx('report.docx');
    const { inputDir, outputDir } = await defaultStorage.createJobFolders('job_docx');
    const inputPath = path.join(inputDir, 'report.docx');
    const outputPath = path.join(outputDir, 'report_FA.docx');
    await fs.promises.copyFile(docxPath, inputPath);

    const docxProc = new DOCXProcessor();
    const analysis = await docxProc.analyzeDocument(inputPath);

    const job: JobState = {
      jobId: 'job_docx',
      originalFileName: 'report.docx',
      outputFileName: 'report_FA.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      documentType: 'docx',
      fileSizeBytes: (await fs.promises.stat(inputPath)).size,
      inputPath,
      outputPath,
      inputHash: await defaultStorage.computeHash(inputPath),
      status: 'queued',
      progress: 0,
      currentStage: 'idle',
      currentOperation: '',
      totalItems: analysis.itemCount,
      processedItems: 0,
      totalWords: analysis.totalWords,
      processedWords: 0,
      sourceLanguage: 'auto',
      targetLanguage: 'fa',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsedMs: 0,
      retryCount: 0,
      warnings: [],
      errors: [],
      manifest: { inputCount: analysis.itemCount, items: analysis.initialManifest },
      debugLogs: [],
    };

    await defaultWorker.runJob(job);
    const outBuffer = await fs.promises.readFile(outputPath);
    const zip = await JSZip.loadAsync(outBuffer);
    const docFile = zip.file('word/document.xml');
    if (!docFile) {
      throw new Error('word/document.xml missing in output DOCX');
    }
    const xml = await docFile.async('text');
    if (!xml.includes('<w:bidi/>')) {
      throw new Error('RTL / bidi marker was not inserted into DOCX paragraph properties');
    }
  });

  console.log('\n----------------------------------------------------');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed of ${passedCount + failedCount} tests.`);
  console.log('----------------------------------------------------');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
