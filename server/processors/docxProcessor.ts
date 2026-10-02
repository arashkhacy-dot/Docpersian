import fs from 'fs';
import JSZip from 'jszip';
import { DocumentProcessor } from './documentProcessor.js';
import { JobState, PageManifestItem } from '../jobs/jobState.js';
import { defaultTranslator, TranslationUnit } from '../gemini/translator.js';
import { healPersianSpaces } from './persianTypographyEngine.js';

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

      // Inject RTL support in paragraph properties (<w:pPr><w:bidi/></w:pPr>) for Persian
      rebuiltXml = rebuiltXml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (pPrBlock, inner) => {
        if (!inner.includes('<w:bidi')) {
          return `<w:pPr><w:bidi/>${inner}</w:pPr>`;
        }
        return pPrBlock;
      });

      // Update the file in the zip archive
      zip.file(filePath, rebuiltXml);
    }

    // Generate output zip buffer
    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    await fs.promises.writeFile(job.outputPath, outputBuffer);

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
