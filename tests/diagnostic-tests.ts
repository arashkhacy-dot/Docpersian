import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { PDFProcessor } from '../server/processors/pdfProcessor';
import { JobState } from '../server/jobs/jobState';
import { defaultStorage } from '../server/storage/localStorageProvider';
import { config } from '../server/config/env';

const DIAGNOSTIC_DIR = path.resolve(process.cwd(), './test_diagnostic_artifacts');

async function setup() {
  if (!fs.existsSync(DIAGNOSTIC_DIR)) {
    fs.mkdirSync(DIAGNOSTIC_DIR, { recursive: true });
  }
  await defaultStorage.init();
}

function makeJob(jobId: string, inputPath: string, outputPath: string, pages: number): JobState {
  return {
    jobId,
    originalFileName: path.basename(inputPath),
    outputFileName: path.basename(outputPath),
    mimeType: 'application/pdf',
    documentType: 'pdf',
    fileSizeBytes: fs.statSync(inputPath).size,
    inputPath,
    outputPath,
    inputHash: 'hash_' + jobId,
    status: 'queued',
    progress: 0,
    currentStage: 'idle',
    currentOperation: 'در انتظار پردازش...',
    totalItems: pages,
    processedItems: 0,
    totalWords: 100,
    processedWords: 0,
    sourceLanguage: 'auto',
    targetLanguage: 'fa',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    elapsedMs: 0,
    retryCount: 0,
    warnings: [],
    errors: [],
    manifest: {
      inputCount: pages,
      items: Array.from({ length: pages }, (_, i) => ({
        index: i + 1,
        status: 'pending',
        hasTranslatableText: true,
        wordCount: 10,
        retryAttempts: 0,
      })),
    },
    debugLogs: [],
  };
}

import fontkit from '@pdf-lib/fontkit';

async function createMultiPagePdf(filename: string, pages: number, contentFn: (pageIndex: number) => string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontBytes = await fs.promises.readFile('./server/assets/fonts/persian-font.ttf');
  const customFont = await doc.embedFont(fontBytes);

  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    const text = contentFn(i);
    if (text) {
      page.drawText(text, { x: 50, y: 780, size: 12, font: customFont });
    }
  }
  const bytes = await doc.save();
  const filePath = path.join(DIAGNOSTIC_DIR, filename);
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

async function createImageOnlyPdf(filename: string): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  // 1x1 png pixel base64
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEcQHsXmI88AAAAABJRU5ErkJggg==';
  const pngBytes = Buffer.from(pngBase64, 'base64');
  const embeddedImage = await doc.embedPng(pngBytes);
  page.drawImage(embeddedImage, { x: 50, y: 400, width: 200, height: 200 });
  const bytes = await doc.save();
  const filePath = path.join(DIAGNOSTIC_DIR, filename);
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

interface TestReport {
  testId: string;
  name: string;
  start: string;
  durationMs: number;
  totalPages: number;
  outputPages: number;
  stageReached: string;
  end: string;
  result: 'PASSED' | 'FAILED';
  details?: string;
}

async function runDiagnostic() {
  await setup();
  console.log('================================================================');
  console.log('DocuShift Diagnostic Test Suite (Section 19 & 20 Diagnostics)');
  console.log('================================================================\n');

  const reports: TestReport[] = [];
  const processor = new PDFProcessor();

  async function executeTest(
    testId: string,
    name: string,
    inputPath: string,
    rtlEnabled: boolean
  ): Promise<TestReport> {
    const startTime = Date.now();
    const startIso = new Date(startTime).toISOString();
    console.log(`[START ${testId}] ${name} (RTL=${rtlEnabled})`);

    const sourceDoc = await PDFDocument.load(await fs.promises.readFile(inputPath));
    const totalPages = sourceDoc.getPageCount();
    const outputPath = path.join(DIAGNOSTIC_DIR, `output_${testId}.pdf`);
    const job = makeJob(testId.toLowerCase(), inputPath, outputPath, totalPages);

    // Set diagnostic RTL flag
    config.reconstructionRtlEnabled = rtlEnabled;

    let stageReached = 'started';
    let lastReportedPage = 0;

    try {
      const result = await processor.processDocument(
        job,
        async (stage, currentItem, total, op) => {
          stageReached = stage;
          lastReportedPage = currentItem;
          if (currentItem % 25 === 0 || currentItem === total) {
            console.log(`  -> [${testId}] Stage: ${stage} | Page: ${currentItem}/${total} | ${op}`);
          }
        },
        () => false,
        (level, tag, msg) => {
          if (level === 'error' || tag === 'PAGE_TIMEOUT' || tag === 'OPERATION_TIMEOUT') {
            console.log(`  [! LOG ${tag}] ${msg}`);
          }
        }
      );

      const outputDoc = await PDFDocument.load(await fs.promises.readFile(outputPath));
      const outputPages = outputDoc.getPageCount();
      const endTime = Date.now();
      const durationMs = endTime - startTime;

      if (outputPages !== totalPages) {
        throw new Error(`Page count mismatch: Input=${totalPages} Output=${outputPages}`);
      }

      console.log(`[END ${testId}] PASSED in ${durationMs}ms | Pages: ${totalPages}->${outputPages}\n`);
      const report: TestReport = {
        testId,
        name,
        start: startIso,
        durationMs,
        totalPages,
        outputPages,
        stageReached: 'completed',
        end: new Date(endTime).toISOString(),
        result: 'PASSED',
        details: `Processed ${result.totalWords} words, ${result.warnings.length} warnings`,
      };
      reports.push(report);
      return report;
    } catch (err: any) {
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      console.error(`[END ${testId}] FAILED at stage ${stageReached} (page ${lastReportedPage}):`, err.message);
      const report: TestReport = {
        testId,
        name,
        start: startIso,
        durationMs,
        totalPages,
        outputPages: 0,
        stageReached,
        end: new Date(endTime).toISOString(),
        result: 'FAILED',
        details: err.message,
      };
      reports.push(report);
      return report;
    }
  }

  // TEST 1: 10-page PDF, RTL disabled
  const test1File = await createMultiPagePdf('test1_10p.pdf', 10, (i) => `Chapter ${i}: Automotive engineering and electronic stability program.`);
  await executeTest('TEST-1', '10-page PDF (RTL disabled)', test1File, false);

  // TEST 2: 10-page PDF, RTL enabled
  const test2File = await createMultiPagePdf('test2_10p.pdf', 10, (i) => `Chapter ${i}: Automotive engineering and electronic stability program.`);
  await executeTest('TEST-2', '10-page PDF (RTL enabled)', test2File, true);

  // TEST 3: 1-page Persian PDF
  const test3File = await createMultiPagePdf('test3_1p_persian.pdf', 1, () => 'راهنمای جامع سیستم ترمز ضد قفل و مدیریت هوشمند خودرو');
  await executeTest('TEST-3', '1-page Persian PDF', test3File, true);

  // TEST 4: 1-page English PDF translated to Persian
  const test4File = await createMultiPagePdf('test4_1p_english.pdf', 1, () => 'Vehicle Owner Manual: Regular maintenance schedule and tire pressure indicators.');
  await executeTest('TEST-4', '1-page English PDF translated to Persian', test4File, true);

  // TEST 5: 1-page mixed Persian/English/numbers/URL
  const test5File = await createMultiPagePdf('test5_1p_mixed.pdf', 1, () => 'CHANGAN Alsvin مدل 2024 با کد خطای OBD-II شماره P0300 در وبسایت https://changan.com');
  await executeTest('TEST-5', '1-page mixed Persian/English/numbers/URL', test5File, true);

  // TEST 6: image-only PDF page
  const test6File = await createImageOnlyPdf('test6_image_only.pdf');
  await executeTest('TEST-6', 'image-only PDF page', test6File, true);

  // TEST 7: 170-page PDF, RTL disabled (Real CHANGAN manual if available, or 170-page test document)
  const changanPath = './jobs_storage/fc036c84-28dd-489e-8b10-d5a6f434caf2/input/source_Manual_del_propietario__CHANGAN_Alsvin.pdf';
  const real170File = fs.existsSync(changanPath)
    ? changanPath
    : await createMultiPagePdf('test7_170p.pdf', 170, (i) => `Page ${i}: Service and Warranty Manual for Changan Motor Vehicles.`);

  await executeTest('TEST-7', '170-page PDF (RTL disabled)', real170File, false);

  // TEST 8: 170-page PDF, RTL enabled (Real CHANGAN manual with full RTL reconstruction!)
  await executeTest('TEST-8', '170-page PDF (RTL enabled - CHANGAN Alsvin Real Document)', real170File, true);

  console.log('================================================================');
  console.log('DIAGNOSTIC TEST SUMMARY REPORT');
  console.log('================================================================');
  console.table(reports);

  const allPassed = reports.every((r) => r.result === 'PASSED');
  if (allPassed) {
    console.log('\n>>> ALL 8 DIAGNOSTIC TESTS PASSED ACCORDING TO SPECIFICATION! <<<');
  } else {
    console.log('\n>>> SOME DIAGNOSTIC TESTS FAILED - REVIEW LOGS <<<');
    process.exit(1);
  }
}

runDiagnostic().catch((e) => {
  console.error('Fatal diagnostic suite error:', e);
  process.exit(1);
});
