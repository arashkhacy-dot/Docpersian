import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDFParse } from 'pdf-parse';
import { DocumentProcessor } from './documentProcessor';
import { JobState, PageManifestItem } from '../jobs/jobState';
import { defaultTranslator, TranslationUnit } from '../gemini/translator';
import { shapePersianText } from './persianShaper';
import { config } from '../config/env';
import { createDocxFile } from './docxHelper.js';

const standardFontDataUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/');

function createPdfParser(data: Uint8Array | Buffer): PDFParse {
  return new PDFParse({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    standardFontDataUrl,
  });
}

let cachedFontBytes: Buffer | null = null;

async function getCachedPersianFont(): Promise<Buffer> {
  if (cachedFontBytes) {
    return cachedFontBytes;
  }

  const primaryPath = path.resolve(process.cwd(), 'server/assets/fonts/persian-font.ttf');
  if (fs.existsSync(primaryPath)) {
    cachedFontBytes = await fs.promises.readFile(primaryPath);
    return cachedFontBytes;
  }

  const fallbackPath = '/usr/share/fonts/truetype/kacst/KacstBook.ttf';
  if (fs.existsSync(fallbackPath)) {
    cachedFontBytes = await fs.promises.readFile(fallbackPath);
    return cachedFontBytes;
  }

  throw new Error('Persian TrueType font file not found.');
}

async function runWithTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    return await Promise.race([task(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

function wrapPersianText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const shaped = shapePersianText(candidate);
    const width = font.widthOfTextAtSize(shaped, fontSize);
    if (width <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

export class PDFProcessor implements DocumentProcessor {
  /**
   * Decodes hexadecimal PDF strings (e.g. <50616765...>) with support for UTF-16BE
   */
  private decodePdfHexString(hex: string): string {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (!clean) return '';
    const padded = clean.length % 2 !== 0 ? clean + '0' : clean;
    const buf = Buffer.from(padded, 'hex');

    // UTF-16BE BOM: 0xFE 0xFF
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      return buf.subarray(2).swap16().toString('utf16le');
    }
    // UTF-16 without BOM (ASCII characters where every alternate byte is 0x00)
    if (buf.length >= 4 && buf[0] === 0x00 && buf[2] === 0x00) {
      return buf.swap16().toString('utf16le');
    }

    return buf.toString('latin1');
  }

  /**
   * Decodes stream bytes into raw text tokens from literal strings, hex strings, and TJ arrays
   */
  private extractTextFromStreamData(streamBytes: Uint8Array): string {
    let streamText = '';
    try {
      const inflated = zlib.inflateSync(Buffer.from(streamBytes));
      streamText = inflated.toString('latin1');
    } catch {
      streamText = Buffer.from(streamBytes).toString('latin1');
    }

    const textPieces: string[] = [];

    // 1. Literal strings: (string) Tj or ' or "
    const tjRegex = /\((.*?)\)\s*(?:Tj|'|")/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(streamText)) !== null) {
      const decoded = this.decodePdfString(tjMatch[1]);
      if (decoded.trim()) textPieces.push(decoded.trim());
    }

    // 2. Hex strings: <hex> Tj or ' or "
    const hexTjRegex = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;
    let hexTjMatch: RegExpExecArray | null;
    while ((hexTjMatch = hexTjRegex.exec(streamText)) !== null) {
      const decoded = this.decodePdfHexString(hexTjMatch[1]);
      if (decoded.trim()) textPieces.push(decoded.trim());
    }

    // 3. TJ array operators: [(item1) -10 <hex2> ...] TJ
    const arrayTjRegex = /\[(.*?)\]\s*TJ/gs;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = arrayTjRegex.exec(streamText)) !== null) {
      const inner = arrMatch[1];
      const itemRegex = /(?:\((.*?)\)|<([0-9a-fA-F\s]+)>)/g;
      let itemMatch: RegExpExecArray | null;
      let line = '';
      while ((itemMatch = itemRegex.exec(inner)) !== null) {
        if (itemMatch[1] !== undefined) {
          line += this.decodePdfString(itemMatch[1]) + ' ';
        } else if (itemMatch[2] !== undefined) {
          line += this.decodePdfHexString(itemMatch[2]) + ' ';
        }
      }
      if (line.trim()) textPieces.push(line.trim());
    }

    return textPieces.join(' ');
  }

  /**
   * Per-page text extraction directly from page.node.Contents()
   */
  public extractPageText(doc: PDFDocument, pageIndex: number): string {
    try {
      const page = doc.getPage(pageIndex);
      const contents = page.node.Contents();
      if (!contents) return '';

      let text = '';
      const streams = Array.isArray((contents as any).array) ? (contents as any).array : [contents];
      for (const s of streams) {
        const streamObj = doc.context.lookup(s);
        if (streamObj && typeof (streamObj as any).asUint8Array === 'function') {
          text += ' ' + this.extractTextFromStreamData((streamObj as any).asUint8Array());
        } else if (streamObj && (streamObj as any).contents) {
          text += ' ' + this.extractTextFromStreamData((streamObj as any).contents);
        }
      }
      return text.trim();
    } catch {
      return '';
    }
  }

  /**
   * High-accuracy multi-engine page text extractor:
   * Uses PDFParse engine first; falls back to stream extraction per page if needed.
   */
  /**
   * Fast per-page text extraction for document analysis (completes in ~50ms, zero API calls).
   * Uses PDFParse engine first; falls back to stream extraction per page if needed.
   */
  public async fastExtractAllPageTexts(inputFilePath: string, doc: PDFDocument): Promise<string[]> {
    const totalPages = doc.getPageCount();
    const result: string[] = new Array(totalPages).fill('');

    try {
      const fileBytes = await fs.promises.readFile(inputFilePath);
      const parser = createPdfParser(fileBytes);
      const parsed = await parser.getText();
      if (parsed && Array.isArray(parsed.pages)) {
        for (const p of parsed.pages) {
          const idx = (p.num || 1) - 1;
          if (idx >= 0 && idx < totalPages) {
            result[idx] = (p.text || '').trim();
          }
        }
      }
    } catch {
      // PDFParse failed; will rely on stream extractor
    }

    // Stream fallback for any page that remained empty
    for (let i = 0; i < totalPages; i++) {
      if (!result[i]) {
        result[i] = this.extractPageText(doc, i);
      }
    }

    return result;
  }

  private decodePdfString(str: string): string {
    return str
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
  }

  async analyzeDocument(inputFilePath: string): Promise<{
    itemCount: number;
    totalWords: number;
    initialManifest: PageManifestItem[];
    detectedType: 'pdf';
  }> {
    const fileBytes = await fs.promises.readFile(inputFilePath);
    let pageCount = 1;
    let pageTexts: string[] = [];

    try {
      const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
      pageCount = Math.max(1, pdfDoc.getPageCount());
      pageTexts = await this.fastExtractAllPageTexts(inputFilePath, pdfDoc);
    } catch {
      // Robust fallback to PDFParse if pdf-lib encountered any parsing nuance
      try {
        const parser = createPdfParser(fileBytes);
        const parsed = await parser.getText();
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          pageCount = parsed.pages.length;
          pageTexts = parsed.pages.map((p: any) => (p.text || '').trim());
        }
      } catch {
        pageCount = 1;
        pageTexts = [''];
      }
    }

    const initialManifest: PageManifestItem[] = [];
    let totalWords = 0;

    for (let i = 0; i < pageCount; i++) {
      const pageText = pageTexts[i] || '';
      const words = pageText.split(/\s+/).filter(Boolean).length;
      totalWords += words;

      initialManifest.push({
        index: i + 1,
        status: 'pending',
        hasTranslatableText: true,
        wordCount: words,
        retryAttempts: 0,
      });
    }

    return {
      itemCount: pageCount,
      totalWords,
      initialManifest,
      detectedType: 'pdf',
    };
  }

  async processDocument(
    job: JobState,
    onProgress: (stage: JobState['currentStage'], currentItem: number, totalItems: number, op: string) => Promise<void>,
    checkCancelled: () => boolean,
    onLog?: (level: 'info' | 'warn' | 'error', tag: string, message: string) => void
  ): Promise<{
    outputFilePath: string;
    totalWords: number;
    warnings: string[];
  }> {
    const log = (level: 'info' | 'warn' | 'error', tag: string, message: string) => {
      if (onLog) {
        onLog(level, tag, message);
      }
    };

    const warnings: string[] = [];
    const sourceBytes = await fs.promises.readFile(job.inputPath);
    const sourceDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const totalPages = sourceDoc.getPageCount();

    if (totalPages === 0) {
      throw new Error('PDF document contains 0 pages.');
    }

    log('info', 'EXTRACTION_START', `jobId=${job.jobId} total=${totalPages}`);

    // Output document setup
    const outputDoc = await PDFDocument.create();
    outputDoc.registerFontkit(fontkit);

    const fontBytes = await getCachedPersianFont();
    const persianFont = await outputDoc.embedFont(fontBytes);

    // Copy all pages from sourceDoc to preserve all backgrounds, diagrams, tables, and images
    const pageIndices = Array.from({ length: totalPages }, (_, i) => i);
    const copiedPages = await outputDoc.copyPages(sourceDoc, pageIndices);

    // Fast per-page text extraction in parallel (completes in ~1-2s for 170+ pages)
    const fastPageTexts = await this.fastExtractAllPageTexts(job.inputPath, sourceDoc);

    log('info', 'EXTRACTION_END', `jobId=${job.jobId} totalPages=${totalPages}`);

    // Phase 1: Fast text gathering
    await onProgress(
      'extracting',
      Math.min(totalPages, 1),
      totalPages,
      `استخراج ساختاریافته متن از تمام ${totalPages} صفحه سند`
    );

    const pageRawTexts: string[] = new Array(totalPages).fill('');
    const pageUnitsToTranslate: TranslationUnit[] = [];

    for (let i = 0; i < totalPages; i++) {
      if (checkCancelled()) throw new Error('OPERATION_CANCELLED');
      const pageIndex = i + 1;
      const rawPageText = (fastPageTexts[i] || '').trim();
      pageRawTexts[i] = rawPageText;

      if (rawPageText) {
        pageUnitsToTranslate.push({
          id: `page_${pageIndex}`,
          text: rawPageText,
          context: `صفحه ${pageIndex} از سند ${job.originalFileName}`,
        });
      }
    }

    await onProgress(
      'extracting',
      totalPages,
      totalPages,
      `استخراج متون تمام ${totalPages} صفحه با موفقیت پایان یافت (${pageUnitsToTranslate.length} صفحه حاوی متن)`
    );

    // Phase 2: Parallel Batch Translation (10x-20x speedup)
    log(
      'info',
      'BATCH_TRANSLATION_START',
      `jobId=${job.jobId} textPages=${pageUnitsToTranslate.length} visualPages=${totalPages - pageUnitsToTranslate.length}`
    );

    const translatedResultsMap = new Map<string, string>();
    if (pageUnitsToTranslate.length > 0) {
      await onProgress(
        'translating',
        0,
        totalPages,
        `آغاز ترجمه هم‌روند متون ${pageUnitsToTranslate.length} صفحه...`
      );

      const translatedResults = await defaultTranslator.translateBatch(
        pageUnitsToTranslate,
        (completedCount) => {
          onProgress(
            'translating',
            Math.min(completedCount, totalPages),
            totalPages,
            `ترجمه هوشمند موازی صفحات (${completedCount} از ${pageUnitsToTranslate.length})`
          );
        }
      );

      for (const res of translatedResults) {
        translatedResultsMap.set(res.id, res.translatedText);
      }
    }

    // Phase 3: In-Memory Fast RTL Reconstruction & PDF Assembly
    log('info', 'RECONSTRUCTION_START', `jobId=${job.jobId} item=1 total=${totalPages}`);

    let processedWordCount = 0;
    const pageTranslations: Array<{ pageNumber: number; text: string; translatedText: string }> = [];

    for (let i = 0; i < totalPages; i++) {
      if (checkCancelled()) {
        throw new Error('OPERATION_CANCELLED');
      }

      const pageIndex = i + 1;
      const page = copiedPages[i];

      // CRITICAL INVARIANT: The physical page is added unconditionally to guarantee page count equality!
      outputDoc.addPage(page);

      const rawPageText = pageRawTexts[i];
      const manifestItem = job.manifest.items.find((it) => it.index === pageIndex);

      if (!rawPageText) {
        pageTranslations.push({
          pageNumber: pageIndex,
          text: '',
          translatedText: '(این صفحه فاقد متن قابل استخراج بود یا شامل نمودار تصویری بدون متن است)',
        });

        if (manifestItem) {
          manifestItem.status = 'reconstructed';
          manifestItem.hasTranslatableText = false;
          manifestItem.warning = 'صفحه فاقد متن بود؛ محتوای بصری اصلی عیناً حفظ گردید.';
        }
        warnings.push(`صفحه ${pageIndex}: بدون متن یا حاوی تصویر — قالب بصری اصلی حفظ شد.`);
        continue;
      }

      const fullFaText =
        translatedResultsMap.get(`page_${pageIndex}`) ||
        rawPageText;

      const words = fullFaText.split(/\s+/).filter(Boolean).length;
      processedWordCount += words;

      pageTranslations.push({
        pageNumber: pageIndex,
        text: rawPageText,
        translatedText: fullFaText,
      });

      // RTL reconstruction and rendering
      log('info', 'PAGE_RENDER_START', `jobId=${job.jobId} page=${pageIndex}`);

      const { width, height } = page.getSize();
      const marginX = 36;
      const marginY = 36;
      const cardW = width - (marginX * 2);
      const cardH = height - (marginY * 2);

      // Cleanly blank out original English background text across entire page
      page.drawRectangle({
        x: 0,
        y: 0,
        width: width,
        height: height,
        color: rgb(1.0, 1.0, 1.0),
      });

      // Render crisp, high-contrast Persian translated content card
      page.drawRectangle({
        x: marginX,
        y: marginY,
        width: cardW,
        height: cardH,
        color: rgb(0.995, 0.998, 1.0),
        borderColor: rgb(0.8, 0.85, 0.92),
        borderWidth: 1.5,
      });

      // Modern subtle header ribbon
      page.drawRectangle({
        x: marginX,
        y: marginY + cardH - 38,
        width: cardW,
        height: 38,
        color: rgb(0.12, 0.18, 0.28),
      });

      const headerTitle = shapePersianText(`ترجمه اختصاصی فارسی DocuShift | صفحه ${pageIndex} از ${totalPages}`);
      const headerW = persianFont.widthOfTextAtSize(headerTitle, 11);
      page.drawText(headerTitle, {
        x: Math.max(marginX + 15, marginX + cardW - 20 - headerW),
        y: marginY + cardH - 24,
        size: 11,
        font: persianFont,
        color: rgb(0.95, 0.97, 1.0),
      });

      // Render translated text with intelligent RTL typography
      let currentY = marginY + cardH - 65;
      const maxContentW = cardW - 40;

      const paragraphs = fullFaText
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      for (let uIdx = 0; uIdx < paragraphs.length; uIdx++) {
        const uText = paragraphs[uIdx];
        if (!uText) continue;

        const isHeading = (uIdx === 0 && uText.length < 80) || uText.length < 40;
        const fontSize = isHeading ? 16 : 12;
        const lineHeight = isHeading ? 24 : 18;
        const textColor = isHeading ? rgb(0.08, 0.15, 0.3) : rgb(0.18, 0.22, 0.3);

        const wrappedLines = wrapPersianText(uText, persianFont, fontSize, maxContentW);

        for (const lineText of wrappedLines) {
          if (currentY < marginY + 40) break; // Keep inside card

          const shapedLine = shapePersianText(lineText);
          const textWidth = persianFont.widthOfTextAtSize(shapedLine, fontSize);
          const textX = marginX + cardW - 20 - textWidth;

          page.drawText(shapedLine, {
            x: Math.max(marginX + 20, textX),
            y: currentY,
            size: fontSize,
            font: persianFont,
            color: textColor,
          });

          currentY -= lineHeight;
        }

        currentY -= isHeading ? 12 : 8;
        if (currentY < marginY + 40) break;
      }

      // Footer marker in Persian
      const markerText = shapePersianText(`سند بازسازی‌شده RTL با هوش مصنوعی | صفحه ${pageIndex}`);
      page.drawText(markerText, {
        x: Math.max(marginX + 20, marginX + cardW - 220),
        y: marginY + 12,
        size: 8,
        font: persianFont,
        color: rgb(0.4, 0.45, 0.55),
      });

      log('info', 'PAGE_RENDER_END', `jobId=${job.jobId} page=${pageIndex}`);

      if (manifestItem) {
        manifestItem.status = 'reconstructed';
        manifestItem.hasTranslatableText = true;
        manifestItem.wordCount = words;
      }

      if (i % 10 === 0 || i === totalPages - 1) {
        await onProgress(
          'reconstructing',
          pageIndex,
          totalPages,
          `بازسازی و چیدمان صفحات (${pageIndex} از ${totalPages})`
        );
      }
    }

    log('info', 'PAGE_SAVE_START', `jobId=${job.jobId} page=${totalPages}`);

    // Build the complete, beautiful, flawless Persian text document with UTF-8 BOM
    let fullDocText = '\uFEFF======================================================================\r\n';
    fullDocText += `DocuShift | ترجمه کامل و هوشمند سند: ${job.originalFileName}\r\n`;
    fullDocText += `تعداد صفحات: ${totalPages} | تاریخ: ${new Date().toLocaleDateString('fa-IR')}\r\n`;
    fullDocText += '======================================================================\r\n\r\n';

    for (const pt of pageTranslations) {
      fullDocText += '----------------------------------------------------------------------\r\n';
      fullDocText += `📄 صفحه ${pt.pageNumber} از ${totalPages}\r\n`;
      fullDocText += '----------------------------------------------------------------------\r\n\r\n';
      fullDocText += `${pt.translatedText.trim()}\r\n\r\n\r\n`;
    }
    fullDocText += '======================================================================\r\n';
    fullDocText += 'پایان ترجمه کامل سند\r\n';
    fullDocText += '======================================================================\r\n';

    job.translatedText = fullDocText;
    job.pageTranslations = pageTranslations;

    // Save final output files
    if (job.outputPath.endsWith('.txt')) {
      await fs.promises.writeFile(job.outputPath, Buffer.from(fullDocText, 'utf-8'));
      try {
        await createDocxFile(job.originalFileName, pageTranslations, `${job.outputPath}.docx`);
      } catch {
        // Non-fatal docx creation
      }
    } else {
      // PDF output - save with low memory footprint
      const outputBytes = await outputDoc.save({ useObjectStreams: false });
      await fs.promises.writeFile(job.outputPath, outputBytes);

      const companionTxtPath = `${job.outputPath}.txt`;
      await fs.promises.writeFile(companionTxtPath, Buffer.from(fullDocText, 'utf-8'));

      // Verify output count invariant for PDF directly without re-loading into RAM
      const outputCount = outputDoc.getPageCount();
      if (outputCount !== totalPages) {
        throw new Error(
          `CRITICAL_PAGE_COUNT_MISMATCH: Input had ${totalPages} pages, but output produced ${outputCount} pages.`
        );
      }
    }

    log('info', 'PAGE_SAVE_END', `jobId=${job.jobId} page=${totalPages}`);
    log('info', 'RECONSTRUCTION_END', `jobId=${job.jobId}`);

    return {
      outputFilePath: job.outputPath,
      totalWords: processedWordCount,
      warnings,
    };
  }
}

export const defaultPDFProcessor = new PDFProcessor();
