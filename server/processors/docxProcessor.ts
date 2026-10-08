import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import JSZip from 'jszip';

const execPromise = util.promisify(exec);
import { DocumentProcessor } from './documentProcessor.js';
import { JobState, PageManifestItem } from '../jobs/jobState.js';
import { defaultTranslator, TranslationUnit } from '../gemini/translator.js';
import { healPersianSpaces } from './persianTypographyEngine.js';
import { defaultDiagramInpainter } from './diagramInpainter.js';

export class DOCXProcessor implements DocumentProcessor {
  async analyzeDocument(inputFilePath: string): Promise<{
    itemCount: number;
    totalWords: number;
    initialManifest: PageManifestItem[];
    detectedType: 'docx';
  }> {
    const fileBytes = await fs.promises.readFile(inputFilePath);
    const zip = await JSZip.loadAsync(fileBytes);

    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      throw new Error('Invalid DOCX file: word/document.xml not found.');
    }

    const docXml = await docXmlFile.async('text');

    // Count pages approximately by section breaks or page breaks (<w:br w:type="page"/>, <w:lastRenderedPageBreak/>)
    const pageBreakMatches = docXml.match(/<w:(lastRenderedPageBreak|br\s+w:type="page")[^>]*\/>/g) || [];
    const estimatedPages = Math.max(1, pageBreakMatches.length + 1);

    // Extract translatable text from <w:t> tags
    const textMatches = docXml.match(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
    let totalWords = 0;
    for (const match of textMatches) {
      const clean = match.replace(/<[^>]+>/g, '').trim();
      if (clean) {
        totalWords += clean.split(/\s+/).filter(Boolean).length;
      }
    }

    const initialManifest: PageManifestItem[] = [];
    const wordsPerPage = Math.ceil(totalWords / estimatedPages);

    for (let i = 1; i <= estimatedPages; i++) {
      initialManifest.push({
        index: i,
        status: 'pending',
        hasTranslatableText: totalWords > 0,
        wordCount: wordsPerPage,
        retryAttempts: 0,
      });
    }

    return {
      itemCount: estimatedPages,
      totalWords,
      initialManifest,
      detectedType: 'docx',
    };
  }

  private async canUsePythonDocx(): Promise<boolean> {
    try {
      const scriptPath = path.resolve(process.cwd(), 'scripts/python_doc_tools.py');
      if (!fs.existsSync(scriptPath)) return false;
      const { stdout } = await execPromise(`python3 "${scriptPath}" --type docx --help`, { timeout: 4000 });
      return stdout.includes('DocuShift');
    } catch {
      return false;
    }
  }

  private async processWithPythonDocx(
    job: JobState,
    onProgress: (stage: JobState['currentStage'], currentItem: number, totalItems: number, op: string) => Promise<void>,
    checkCancelled: () => boolean
  ): Promise<{
    outputFilePath: string;
    totalWords: number;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    const scriptPath = path.resolve(process.cwd(), 'scripts/python_doc_tools.py');
    const tempExtractJson = path.join(os.tmpdir(), `docx_extract_${job.jobId}.json`);
    const tempTransJson = path.join(os.tmpdir(), `docx_trans_${job.jobId}.json`);

    try {
      await onProgress('extracting', 1, 1, 'استخراج نیتیو متون و جداول ورد با ابزار python-docx...');
      await execPromise(`python3 "${scriptPath}" --action extract --type docx --input "${job.inputPath}" --output "${tempExtractJson}"`, {
        timeout: 60000,
      });

      if (!fs.existsSync(tempExtractJson)) {
        throw new Error('فایل JSON خروجی استخراج پایتون ایجاد نشد.');
      }

      const rawJson = await fs.promises.readFile(tempExtractJson, 'utf-8');
      const texts: string[] = JSON.parse(rawJson);

      if (texts.length === 0) {
        await fs.promises.copyFile(job.inputPath, job.outputPath);
        return { outputFilePath: job.outputPath, totalWords: 0, warnings };
      }

      const units: TranslationUnit[] = texts.map((t, idx) => ({
        id: `docx_py_${idx}`,
        text: t,
        context: `سند مایکروسافت ورد - بخش ${idx + 1} از ${texts.length}`,
      }));

      await onProgress('translating', 0, units.length, `ترجمه هوشمند متون سند ورد با پایتون (${units.length} بخش)...`);
      if (checkCancelled()) throw new Error('OPERATION_CANCELLED');

      const translatedUnits = await defaultTranslator.translateBatch(units, (completedCount) => {
        onProgress('translating', Math.min(completedCount, units.length), units.length, `ترجمه متون سند ورد (${completedCount} از ${units.length})`);
      });

      const transMap: Record<string, string> = {};
      let totalWords = 0;
      for (const u of translatedUnits) {
        const orig = units.find((x) => x.id === u.id);
        if (orig) {
          transMap[orig.text] = u.translatedText;
          totalWords += u.translatedText.split(/\s+/).filter(Boolean).length;
        }
      }

      await fs.promises.writeFile(tempTransJson, JSON.stringify(transMap, null, 2), 'utf-8');

      if (checkCancelled()) throw new Error('OPERATION_CANCELLED');
      await onProgress('reconstructing', 1, 1, 'پیاده‌سازی نیتیو ترجمه در فایل اصلی با python-docx و تنظیم راست‌به‌چپ (RTL)...');

      await execPromise(`python3 "${scriptPath}" --action apply --type docx --input "${job.inputPath}" --output "${job.outputPath}" --translations "${tempTransJson}"`, {
        timeout: 90000,
      });

      if (!fs.existsSync(job.outputPath) || (await fs.promises.stat(job.outputPath)).size < 1000) {
        throw new Error('فایل خروجی ورد توسط python-docx ایجاد نشد یا ناقص است.');
      }

      return {
        outputFilePath: job.outputPath,
        totalWords,
        warnings,
      };
    } finally {
      await fs.promises.unlink(tempExtractJson).catch(() => {});
      await fs.promises.unlink(tempTransJson).catch(() => {});
    }
  }

  async processDocument(
    job: JobState,
    onProgress: (stage: JobState['currentStage'], currentItem: number, totalItems: number, op: string) => Promise<void>,
    checkCancelled: () => boolean
  ): Promise<{
    outputFilePath: string;
    totalWords: number;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    // Prioritize 100% native layout & style preservation via python-docx if installed
    const canUsePy = await this.canUsePythonDocx();
    if (canUsePy) {
      try {
        return await this.processWithPythonDocx(job, onProgress, checkCancelled);
      } catch (pyErr) {
        console.warn('[PYTHON_DOCX_FALLBACK_TO_XML]', pyErr);
        warnings.push('پردازش پایتون با خطا مواجه شد؛ بازگشت خودکار به پردازشگر درونی XML.');
      }
    }

    const fileBytes = await fs.promises.readFile(job.inputPath);
    const zip = await JSZip.loadAsync(fileBytes);

    // Find all XML files containing text (document.xml, headers, footers)
    const targetFiles: string[] = [];
    zip.forEach((relativePath) => {
      if (
        relativePath === 'word/document.xml' ||
        relativePath.startsWith('word/header') ||
        relativePath.startsWith('word/footer') ||
        relativePath === 'word/footnotes.xml' ||
        relativePath === 'word/endnotes.xml'
      ) {
        targetFiles.push(relativePath);
      }
    });

    let totalWords = 0;
    const allDocxTranslatedParagraphs: string[] = [];
    const globalTransMap: Record<string, string> = {};
    const estimatedPages = job.totalItems || 1;

    for (let idx = 0; idx < targetFiles.length; idx++) {
      if (checkCancelled()) {
        throw new Error('OPERATION_CANCELLED');
      }

      const filePath = targetFiles[idx];
      const xmlContent = await zip.file(filePath)!.async('text');

      await onProgress(
        'extracting',
        Math.min(idx + 1, estimatedPages),
        estimatedPages,
        `استخراج متون ساختاریافته ${filePath}`
      );

      // Collect all text nodes with their indexes and content
      const regex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;
      const units: TranslationUnit[] = [];
      const matches: Array<{ fullMatch: string; text: string; start: number; end: number }> = [];

      let match: RegExpExecArray | null;
      let count = 0;

      while ((match = regex.exec(xmlContent)) !== null) {
        const text = match[1];
        if (text && text.trim().length > 0) {
          units.push({
            id: `docx_${idx}_${count++}`,
            text: text,
            context: `فایل سند ورد ${filePath}`,
          });
          matches.push({
            fullMatch: match[0],
            text,
            start: match.index,
            end: regex.lastIndex,
          });
        }
      }

      if (units.length === 0) {
        continue;
      }

      await onProgress(
        'translating',
        Math.min(idx + 1, estimatedPages),
        estimatedPages,
        `ترجمه دقیق و هماهنگ اجزای متنی ${filePath}`
      );

      const translatedUnits = await defaultTranslator.translateBatch(units);
      const translationMap = new Map(translatedUnits.map((u) => [u.id, u.translatedText]));

      await onProgress(
        'reconstructing',
        Math.min(idx + 1, estimatedPages),
        estimatedPages,
        `بازسازی برچسب‌های OpenXML و تنظیم جهت راست‌به‌چپ در ${filePath}`
      );

      // Replace text in XML content while preserving all attributes and tags
      let rebuiltXml = '';
      let lastIndex = 0;

      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const unitId = `docx_${idx}_${i}`;
        const rawTranslated = translationMap.get(unitId) || m.text;
        const translated = healPersianSpaces(rawTranslated);

        if (m.text && translated && translated !== m.text && /[\u0600-\u06FF]/.test(translated)) {
          globalTransMap[m.text.trim()] = translated.trim();
        }

        totalWords += translated.split(/\s+/).filter(Boolean).length;
        if (translated.trim()) {
          allDocxTranslatedParagraphs.push(translated.trim());
        }

        rebuiltXml += xmlContent.substring(lastIndex, m.start);

        // Escape XML entities in translated text
        const safeText = translated
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

        // Preserve original tag wrapper with xml:space="preserve"
        rebuiltXml += `<w:t xml:space="preserve">${safeText}</w:t>`;
        lastIndex = m.end;
      }
      rebuiltXml += xmlContent.substring(lastIndex);

      // 1. Ensure all paragraphs have <w:pPr> with RTL and right alignment
      rebuiltXml = rebuiltXml.replace(/<w:p(?:\s+[^>]*)?>([\s\S]*?)<\/w:p>/g, (pFull, pInner) => {
        if (!pInner.includes('<w:pPr>')) {
          return pFull.replace(/^(<w:p(?:\s+[^>]*)?>)/, '$1<w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>');
        }
        return pFull;
      });

      // 2. Inject RTL (<w:bidi/>) and right alignment (<w:jc w:val="right"/>) in existing paragraph properties
      rebuiltXml = rebuiltXml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (_pPrBlock, inner) => {
        let updated = inner;
        if (!updated.includes('<w:bidi')) {
          updated = `<w:bidi/>${updated}`;
        }
        if (!updated.includes('<w:jc')) {
          updated += '<w:jc w:val="right"/>';
        } else if (updated.includes('w:val="left"')) {
          updated = updated.replace(/w:val="left"/g, 'w:val="right"');
        }
        return `<w:pPr>${updated}</w:pPr>`;
      });

      // 3. Set Persian complex script font (Vazirmatn) and RTL in run properties (<w:rPr>)
      rebuiltXml = rebuiltXml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_rPrBlock, inner) => {
        let updated = inner;
        if (!updated.includes('<w:rtl')) {
          updated = `<w:rtl/>${updated}`;
        }
        if (!updated.includes('<w:rFonts')) {
          updated = `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Vazirmatn"/>${updated}`;
        } else if (!updated.includes('w:cs=')) {
          updated = updated.replace(/<w:rFonts(\s*[^>]*?)\/?>/, '<w:rFonts$1 w:cs="Vazirmatn"/>');
        }
        return `<w:rPr>${updated}</w:rPr>`;
      });

      // 4. Ensure Word tables have RTL column flow (<w:bidiVisual/> in <w:tblPr>)
      rebuiltXml = rebuiltXml.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (tblBlock, inner) => {
        if (!inner.includes('<w:bidiVisual')) {
          return `<w:tblPr><w:bidiVisual/>${inner}</w:tblPr>`;
        }
        return tblBlock;
      });

      // Update the file in the zip archive
      zip.file(filePath, rebuiltXml);
    }

    // Smart Inpainting & Translation for Embedded Diagram Images in Word
    if (defaultTranslator.isDiagramInpaintingEnabled()) {
      const docxMedia: string[] = [];
      zip.forEach((relativePath) => {
        if (
          relativePath.startsWith('word/media/') &&
          /\.(png|jpe?g|webp)$/i.test(relativePath)
        ) {
          docxMedia.push(relativePath);
        }
      });

      if (docxMedia.length > 0) {
        for (const mediaPath of docxMedia) {
          if (checkCancelled()) throw new Error('OPERATION_CANCELLED');
          const fileEntry = zip.file(mediaPath);
          if (!fileEntry) continue;
          try {
            const imgBuffer = await fileEntry.async('nodebuffer');
            const mimeType = mediaPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
            const inpaintResult = await defaultDiagramInpainter.inpaintDiagramImage(
              imgBuffer,
              mimeType,
              `تصویر دیاگرام سند ورد: ${path.basename(mediaPath)}`
            );
            if (inpaintResult.modified) {
              zip.file(mediaPath, inpaintResult.buffer);
            }
          } catch (mErr) {
            console.warn(`[DOCX_MEDIA_WARN] Skipped ${mediaPath}:`, mErr);
          }
        }
      }
    }

    // Generate output zip buffer
    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    let generatedViaPython = false;
    try {
      await execPromise('python3 -c "import docx"');
      if (Object.keys(globalTransMap).length > 0) {
        const transJsonPath = path.join(os.tmpdir(), `docx_trans_${Date.now()}.json`);
        await fs.promises.writeFile(transJsonPath, JSON.stringify(globalTransMap, null, 2), 'utf-8');
        const scriptPath = path.resolve(process.cwd(), 'scripts/python_doc_tools.py');
        await execPromise(
          `python3 "${scriptPath}" --action apply --type docx --input "${job.inputPath}" --output "${job.outputPath}" --translations "${transJsonPath}"`
        );
        await fs.promises.unlink(transJsonPath).catch(() => {});

        if (fs.existsSync(job.outputPath) && fs.statSync(job.outputPath).size > 1000) {
          generatedViaPython = true;
          console.log('[DOCX] Successfully generated Word document using native python-docx engine!');
        }
      }
    } catch {
      // Fall through to JSZip output
    }

    if (!generatedViaPython) {
      await fs.promises.writeFile(job.outputPath, outputBuffer);
    }

    // Update manifest
    for (const item of job.manifest.items) {
      item.status = 'reconstructed';
    }

    // Build comprehensive text and companion TXT file
    let fullDocText = '\uFEFF======================================================================\r\n';
    fullDocText += `DocuShift | ترجمه کامل و اختصاصی سند Word: ${job.originalFileName}\r\n`;
    fullDocText += `کلمات ترجمه‌شده: ${totalWords.toLocaleString('fa-IR')} | تاریخ: ${new Date().toLocaleDateString('fa-IR')}\r\n`;
    fullDocText += '======================================================================\r\n\r\n';
    fullDocText += allDocxTranslatedParagraphs.join('\r\n\r\n');
    fullDocText += '\r\n\r\n======================================================================\r\n';
    fullDocText += 'پایان ترجمه کامل سند Word\r\n';
    fullDocText += '======================================================================\r\n';

    job.translatedText = fullDocText;
    job.pageTranslations = [
      {
        pageNumber: 1,
        text: 'متن استخراج‌شده سند Word',
        translatedText: allDocxTranslatedParagraphs.join('\n\n'),
      },
    ];

    const companionTxtPath = `${job.outputPath}.txt`;
    await fs.promises.writeFile(companionTxtPath, Buffer.from(fullDocText, 'utf-8'));

    return {
      outputFilePath: job.outputPath,
      totalWords,
      warnings,
    };
  }
}

export const defaultDOCXProcessor = new DOCXProcessor();
