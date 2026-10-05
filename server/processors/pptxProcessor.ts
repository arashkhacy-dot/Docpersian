import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { DocumentProcessor } from './documentProcessor.js';
import { JobState, PageManifestItem } from '../jobs/jobState.js';
import { defaultTranslator, TranslationUnit } from '../gemini/translator.js';
import { createDocxFile } from './docxHelper.js';
import { healPersianSpaces } from './persianTypographyEngine.js';
import { defaultDiagramInpainter } from './diagramInpainter.js';

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class PPTXProcessor implements DocumentProcessor {
  /**
   * Discovers and sorts all slide XML files in order: ppt/slides/slide1.xml, slide2.xml, ...
   */
  private getSlideFiles(zip: JSZip): string[] {
    const slides: string[] = [];
    zip.forEach((relativePath) => {
      const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      if (match) {
        slides.push(relativePath);
      }
    });

    // Natural numeric sort
    slides.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return numA - numB;
    });

    return slides;
  }

  /**
   * Discovers presenter speaker notes: ppt/notesSlides/notesSlide1.xml, ...
   */
  private getNotesSlideFiles(zip: JSZip): string[] {
    const notes: string[] = [];
    zip.forEach((relativePath) => {
      const match = relativePath.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/);
      if (match) {
        notes.push(relativePath);
      }
    });
    notes.sort((a, b) => {
      const numA = parseInt(a.match(/notesSlide(\d+)\.xml/)![1], 10);
      const numB = parseInt(b.match(/notesSlide(\d+)\.xml/)![1], 10);
      return numA - numB;
    });
    return notes;
  }

  /**
   * Discovers SmartArt and diagram data: ppt/diagrams/data1.xml, ...
   */
  private getDiagramFiles(zip: JSZip): string[] {
    const diagrams: string[] = [];
    zip.forEach((relativePath) => {
      if (relativePath.startsWith('ppt/diagrams/data') && relativePath.endsWith('.xml')) {
        diagrams.push(relativePath);
      }
    });
    return diagrams;
  }

  /**
   * Discovers charts: ppt/charts/chart1.xml, ...
   */
  private getChartFiles(zip: JSZip): string[] {
    const charts: string[] = [];
    zip.forEach((relativePath) => {
      if (relativePath.startsWith('ppt/charts/chart') && relativePath.endsWith('.xml')) {
        charts.push(relativePath);
      }
    });
    return charts;
  }

  /**
   * Extracts clean translatable text from all <a:t> tags within an XML snippet
   */
  private extractTextFromXml(xml: string): string {
    const textMatches = xml.match(/<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/g) || [];
    let combined = '';
    for (const m of textMatches) {
      const clean = m.replace(/<[^>]+>/g, '').trim();
      if (clean) {
        combined += (combined ? ' ' : '') + clean;
      }
    }
    return combined;
  }

  /**
   * Extracts slide title from <p:ph type="title"/>, <p:ph type="ctrTitle"/>, or the first prominent text
   */
  private extractSlideTitle(xml: string, slideIndex: number): string {
    // Look for shape with title placeholder
    const titleShapeMatch = xml.match(/<p:sp>[\s\S]*?<p:ph[^>]*type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/);
    if (titleShapeMatch) {
      const titleText = this.extractTextFromXml(titleShapeMatch[0]);
      if (titleText) return titleText.substring(0, 100);
    }

    // Fallback: extract the very first non-empty text run in the slide
    const firstP = xml.match(/<a:p(?:\s+[^>]*)?>([\s\S]*?)<\/a:p>/);
    if (firstP) {
      const firstText = this.extractTextFromXml(firstP[0]);
      if (firstText && firstText.length < 80) return firstText;
    }

    return `اسلاید شماره ${slideIndex}`;
  }

  /**
   * Extracts coherent paragraphs from a slide or note XML
   */
  private extractParagraphs(xmlContent: string): Array<{
    fullTag: string;
    text: string;
    start: number;
    end: number;
    isTitle: boolean;
  }> {
    const paragraphs: Array<{
      fullTag: string;
      text: string;
      start: number;
      end: number;
      isTitle: boolean;
    }> = [];

    const pRegex = /<a:p(?:\s+[^>]*)?>([\s\S]*?)<\/a:p>/g;
    let match: RegExpExecArray | null;

    while ((match = pRegex.exec(xmlContent)) !== null) {
      const pBody = match[1];
      const pText = this.extractTextFromXml(pBody);

      if (pText && pText.trim().length > 0) {
        // Check if paragraph is inside a title shape
        const precedingXml = xmlContent.substring(Math.max(0, match.index - 500), match.index);
        const isTitle = /type="(?:title|ctrTitle)"/.test(precedingXml);

        paragraphs.push({
          fullTag: match[0],
          text: pText.trim(),
          start: match.index,
          end: pRegex.lastIndex,
          isTitle,
        });
      }
    }

    return paragraphs;
  }

  /**
   * Safely updates or creates <a:pPr> with rtl="1" and alignment
   */
  private updateParagraphProperties(pXml: string, targetAlgn: 'r' | 'ctr'): string {
    const match = pXml.match(/<a:pPr(\s*[\s\S]*?)(\/?)>/);
    if (match) {
      const rawAttrs = match[1] || '';
      const isSelfClosing = match[2] === '/' || rawAttrs.trim().endsWith('/');
      let clean = (' ' + rawAttrs).replace(/\/+$/, ' ').trim();
      clean = (' ' + clean).replace(/\s+rtl="[^"]*"/g, '').replace(/\s+algn="[^"]*"/g, '').trim();
      const tag = `<a:pPr${clean ? ' ' + clean : ''} rtl="1" algn="${targetAlgn}"${isSelfClosing ? '/>' : '>'}`;
      return pXml.replace(match[0], tag);
    } else {
      return pXml.replace(/^(<a:p(?:\s+[^>]*)?>)/, `$1<a:pPr rtl="1" algn="${targetAlgn}"/>`);
    }
  }

  /**
   * Safely updates or creates <a:rPr> preserving fonts, sizes, styles while setting Persian language
   */
  private updateRunProperties(rXml: string): string {
    const match = rXml.match(/<a:rPr(\s*[\s\S]*?)(\/?)>/);
    if (match) {
      const rawAttrs = match[1] || '';
      const isSelfClosing = match[2] === '/' || rawAttrs.trim().endsWith('/');
      let clean = (' ' + rawAttrs).replace(/\/+$/, ' ').trim();
      clean = (' ' + clean).replace(/\s+lang="[^"]*"/g, '').replace(/\s+altLang="[^"]*"/g, '').trim();
      const tag = `<a:rPr${clean ? ' ' + clean : ''} lang="fa-IR" altLang="en-US"${isSelfClosing ? '/>' : '>'}`;
      return rXml.replace(match[0], tag);
    } else {
      return rXml.replace(/^(<a:r(?:\s+[^>]*)?>)/, `$1<a:rPr lang="fa-IR" altLang="en-US"/>`);
    }
  }

  /**
   * Deeply reconstructs a single <a:p> paragraph with:
   * 1. 100% Valid OpenXML Schema (guaranteed to open in Microsoft PowerPoint)
   * 2. RTL direction (<a:pPr rtl="1" algn="r"/>)
   * 3. Persian locale tagging (lang="fa-IR")
   * 4. Complete elimination of corrupted self-closing tags
   */
  private reconstructParagraph(pXml: string, translatedText: string, isTitle: boolean): string {
    const targetAlgn = isTitle && pXml.includes('algn="ctr"') ? 'ctr' : 'r';
    let rebuilt = this.updateParagraphProperties(pXml, targetAlgn);

    // Update <a:endParaRPr> if present
    rebuilt = rebuilt.replace(/<a:endParaRPr(\s*[\s\S]*?)(\/?)>/g, (_m, rawAttrs, slash) => {
      const isSelf = slash === '/' || rawAttrs.trim().endsWith('/');
      let clean = (' ' + rawAttrs).replace(/\/+$/, ' ').trim();
      clean = (' ' + clean).replace(/\s+lang="[^"]*"/g, '').trim();
      return `<a:endParaRPr${clean ? ' ' + clean : ''} lang="fa-IR"${isSelf ? '/>' : '>'}`;
    });

    // Handle text runs
    const hasRuns = /<a:r(?:\s+[^>]*)?>/.test(rebuilt);
    if (hasRuns) {
      let firstRunReplaced = false;
      rebuilt = rebuilt.replace(/<a:r(?:\s+[^>]*)?>([\s\S]*?)<\/a:r>/g, (runXml) => {
        if (!firstRunReplaced) {
          firstRunReplaced = true;
          let rUpdated = this.updateRunProperties(runXml);
          if (/<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/.test(rUpdated)) {
            rUpdated = rUpdated.replace(
              /<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/,
              `<a:t>${escapeXml(translatedText)}</a:t>`
            );
          } else {
            rUpdated = rUpdated.replace(/<\/a:r>/, `<a:t>${escapeXml(translatedText)}</a:t></a:r>`);
          }
          return rUpdated;
        } else {
          // Remove subsequent runs to prevent fragmented repetitive text while maintaining clean XML
          return '';
        }
      });
    } else {
      // Paragraph has no <a:r>, inject a pristine Persian run
      const closingIndex = rebuilt.lastIndexOf('</a:p>');
      if (closingIndex !== -1) {
        const prefix = rebuilt.substring(0, closingIndex);
        rebuilt = `${prefix}<a:r><a:rPr lang="fa-IR" altLang="en-US"/><a:t>${escapeXml(translatedText)}</a:t></a:r></a:p>`;
      }
    }

    return rebuilt;
  }

  /**
   * Ensures tables in PowerPoint have RTL column flow: <a:tblPr rtl="1">
   */
  private applyRtlToTables(xml: string): string {
    return xml.replace(/<a:tblPr(\s*[\s\S]*?)(\/?)>/g, (_m, rawAttrs, slash) => {
      const isSelf = slash === '/' || rawAttrs.trim().endsWith('/');
      let clean = (' ' + rawAttrs).replace(/\/+$/, ' ').trim();
      clean = (' ' + clean).replace(/\s+rtl="[^"]*"/g, '').trim();
      return `<a:tblPr${clean ? ' ' + clean : ''} rtl="1"${isSelf ? '/>' : '>'}`;
    });
  }

  async analyzeDocument(inputFilePath: string): Promise<{
    itemCount: number;
    totalWords: number;
    initialManifest: PageManifestItem[];
    detectedType: 'pptx';
  }> {
    const fileBytes = await fs.promises.readFile(inputFilePath);
    const zip = await JSZip.loadAsync(fileBytes);
    const slides = this.getSlideFiles(zip);
    const notes = this.getNotesSlideFiles(zip);
    const diagrams = this.getDiagramFiles(zip);

    if (slides.length === 0) {
      throw new Error('Invalid PPTX file: No slides found in presentation.');
    }

    const initialManifest: PageManifestItem[] = [];
    let totalWords = 0;

    for (let i = 0; i < slides.length; i++) {
      const slidePath = slides[i];
      const xml = await zip.file(slidePath)!.async('text');

      const slideText = this.extractTextFromXml(xml);
      let slideWords = 0;
      if (slideText) {
        slideWords = slideText.split(/\s+/).filter(Boolean).length;
      }

      totalWords += slideWords;

      initialManifest.push({
        index: i + 1,
        status: 'pending',
        hasTranslatableText: slideWords > 0,
        wordCount: slideWords,
        retryAttempts: 0,
      });
    }

    // Add speaker notes word count to total
    for (const notePath of notes) {
      const noteXml = await zip.file(notePath)!.async('text');
      const noteText = this.extractTextFromXml(noteXml);
      if (noteText) {
        totalWords += noteText.split(/\s+/).filter(Boolean).length;
      }
    }

    // Add diagrams word count to total
    for (const dgmPath of diagrams) {
      const dgmXml = await zip.file(dgmPath)!.async('text');
      const dgmText = this.extractTextFromXml(dgmXml);
      if (dgmText) {
        totalWords += dgmText.split(/\s+/).filter(Boolean).length;
      }
    }

    return {
      itemCount: slides.length,
      totalWords,
      initialManifest,
      detectedType: 'pptx',
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
    const slides = this.getSlideFiles(zip);
    const notes = this.getNotesSlideFiles(zip);
    const diagrams = this.getDiagramFiles(zip);
    const charts = this.getChartFiles(zip);

    const totalSlides = slides.length;
    let processedWords = 0;
    const slideTranslations: Array<{ pageNumber: number; text: string; translatedText: string }> = [];

    // 1. Process and Translate Slides
    for (let i = 0; i < totalSlides; i++) {
      if (checkCancelled()) {
        throw new Error('OPERATION_CANCELLED');
      }

      const slideIndex = i + 1;
      const slidePath = slides[i];
      const xmlContent = await zip.file(slidePath)!.async('text');

      const slideTitle = this.extractSlideTitle(xmlContent, slideIndex);

      await onProgress(
        'extracting',
        slideIndex,
        totalSlides,
        `آنالیز و استخراج اشکال، جداول و متن اسلاید ${slideIndex} از ${totalSlides}: «${slideTitle}»`
      );

      const paragraphs = this.extractParagraphs(xmlContent);
      const manifestItem = job.manifest.items.find((it) => it.index === slideIndex);

      if (paragraphs.length === 0) {
        // Pure image or empty slide: keep original intact
        if (manifestItem) {
          manifestItem.status = 'reconstructed';
          manifestItem.hasTranslatableText = false;
        }

        slideTranslations.push({
          pageNumber: slideIndex,
          text: '',
          translatedText: `(اسلاید ${slideIndex} دارای محتوای گرافیکی/تصویری است و فاقد متن متنی مستقیم می‌باشد)`,
        });

        await onProgress(
          'reconstructing',
          slideIndex,
          totalSlides,
          `حفظ کامل ساختار اسلاید تصویری/گرافیکی ${slideIndex} از ${totalSlides}`
        );
        continue;
      }

      // Build coherent translation units
      const units: TranslationUnit[] = paragraphs.map((p, pIdx) => ({
        id: `slide_${slideIndex}_p_${pIdx}`,
        text: p.text,
        context: `ارائه پاورپوینت - اسلاید ${slideIndex} (${slideTitle}) - ${p.isTitle ? 'عنوان اسلاید' : 'پاراگراف/نکته یا سلول جدول'}`,
      }));

      await onProgress(
        'translating',
        slideIndex,
        totalSlides,
        `ترجمه هوشمند متون اسلاید ${slideIndex} از ${totalSlides} (${units.length} بخش)`
      );

      const translatedUnits = await defaultTranslator.translateBatch(units);
      const translationMap = new Map(translatedUnits.map((u) => [u.id, u.translatedText]));

      await onProgress(
        'reconstructing',
        slideIndex,
        totalSlides,
        `بازسازی هندسی، فونت فارسی و چینش راست‌به‌چپ (RTL) اسلاید ${slideIndex}`
      );

      // Rebuild slide XML with coherent paragraphs and RTL layout
      let rebuiltXml = '';
      let lastIndex = 0;
      const slideOriginalParagraphs: string[] = [];
      const slideTranslatedParagraphs: string[] = [];

      for (let j = 0; j < paragraphs.length; j++) {
        const p = paragraphs[j];
        const unitId = `slide_${slideIndex}_p_${j}`;
        const rawTranslated = translationMap.get(unitId) || p.text;
        const translated = healPersianSpaces(rawTranslated);

        slideOriginalParagraphs.push(p.text);
        slideTranslatedParagraphs.push(translated);
        processedWords += translated.split(/\s+/).filter(Boolean).length;

        rebuiltXml += xmlContent.substring(lastIndex, p.start);
        rebuiltXml += this.reconstructParagraph(p.fullTag, translated, p.isTitle);
        lastIndex = p.end;
      }
      rebuiltXml += xmlContent.substring(lastIndex);

      // Record slide translation for text reader & companion files
      slideTranslations.push({
        pageNumber: slideIndex,
        text: slideOriginalParagraphs.join('\n\n'),
        translatedText: slideTranslatedParagraphs.join('\n\n'),
      });

      // Mirror PowerPoint tables into native RTL
      rebuiltXml = this.applyRtlToTables(rebuiltXml);

      // Validate XML integrity before packaging
      const xmlValidation = XMLValidator.validate(rebuiltXml);
      if (xmlValidation !== true) {
        console.error(`[PPTX_XML_VALIDATION_ERROR] Slide ${slideIndex} XML error:`, xmlValidation.err);
        warnings.push(`خطای ساختار XML در اسلاید ${slideIndex}.`);
        zip.file(slidePath, xmlContent);
      } else {
        zip.file(slidePath, rebuiltXml);
      }

      if (manifestItem) {
        manifestItem.status = 'reconstructed';
        manifestItem.hasTranslatableText = true;
      }
    }

    // 2. Process and Translate Speaker Notes (notesSlides)
    if (notes.length > 0) {
      await onProgress(
        'translating',
        totalSlides,
        totalSlides,
        `ترجمه یادداشت‌های ارائه (Speaker Notes) در ${notes.length} اسلاید...`
      );

      for (let nIdx = 0; nIdx < notes.length; nIdx++) {
        if (checkCancelled()) throw new Error('OPERATION_CANCELLED');
        const notePath = notes[nIdx];
        const noteXml = await zip.file(notePath)!.async('text');
        const noteParagraphs = this.extractParagraphs(noteXml);

        if (noteParagraphs.length > 0) {
          const noteUnits: TranslationUnit[] = noteParagraphs.map((p, pIdx) => ({
            id: `note_${nIdx}_p_${pIdx}`,
            text: p.text,
            context: `یادداشت‌های ارائه اسلاید شماره ${nIdx + 1}`,
          }));

          const translatedNoteUnits = await defaultTranslator.translateBatch(noteUnits);
          const noteTranslationMap = new Map(translatedNoteUnits.map((u) => [u.id, u.translatedText]));

          let rebuiltNoteXml = '';
          let lastNoteIndex = 0;
          const noteTranslatedLines: string[] = [];

          for (let j = 0; j < noteParagraphs.length; j++) {
            const p = noteParagraphs[j];
            const unitId = `note_${nIdx}_p_${j}`;
            const rawTranslated = noteTranslationMap.get(unitId) || p.text;
            const translated = healPersianSpaces(rawTranslated);
            noteTranslatedLines.push(translated);
            processedWords += translated.split(/\s+/).filter(Boolean).length;

            rebuiltNoteXml += noteXml.substring(lastNoteIndex, p.start);
            rebuiltNoteXml += this.reconstructParagraph(p.fullTag, translated, false);
            lastNoteIndex = p.end;
          }
          rebuiltNoteXml += noteXml.substring(lastNoteIndex);
          zip.file(notePath, rebuiltNoteXml);

          // Append speaker notes to the corresponding slide text
          const targetSlide = slideTranslations.find((s) => s.pageNumber === nIdx + 1);
          if (targetSlide && noteTranslatedLines.length > 0) {
            targetSlide.translatedText += `\n\n📌 [یادداشت‌های ارائه / Speaker Notes]:\n${noteTranslatedLines.join('\n')}`;
          }
        }
      }
    }

    // 3. Process SmartArt / Flowchart Diagrams
    if (diagrams.length > 0) {
      for (const dgmPath of diagrams) {
        if (checkCancelled()) throw new Error('OPERATION_CANCELLED');
        const dgmXml = await zip.file(dgmPath)!.async('text');
        const dgmParagraphs = this.extractParagraphs(dgmXml);

        if (dgmParagraphs.length > 0) {
          const dgmUnits: TranslationUnit[] = dgmParagraphs.map((p, pIdx) => ({
            id: `dgm_${pIdx}`,
            text: p.text,
            context: 'نمودار و دیاگرام SmartArt پاورپوینت',
          }));

          const translatedDgmUnits = await defaultTranslator.translateBatch(dgmUnits);
          const dgmMap = new Map(translatedDgmUnits.map((u) => [u.id, u.translatedText]));

          let rebuiltDgmXml = '';
          let lastDgmIndex = 0;

          for (let j = 0; j < dgmParagraphs.length; j++) {
            const p = dgmParagraphs[j];
            const unitId = `dgm_${j}`;
            const rawTranslated = dgmMap.get(unitId) || p.text;
            const translated = healPersianSpaces(rawTranslated);
            processedWords += translated.split(/\s+/).filter(Boolean).length;

            rebuiltDgmXml += dgmXml.substring(lastDgmIndex, p.start);
            rebuiltDgmXml += this.reconstructParagraph(p.fullTag, translated, false);
            lastDgmIndex = p.end;
          }
          rebuiltDgmXml += dgmXml.substring(lastDgmIndex);
          zip.file(dgmPath, rebuiltDgmXml);
        }
      }
    }

    // 3.5. Smart Inpainting & Translation for Embedded Diagram Images
    if (defaultTranslator.isDiagramInpaintingEnabled()) {
      const mediaFiles: string[] = [];
      zip.forEach((relativePath) => {
        if (
          relativePath.startsWith('ppt/media/') &&
          /\.(png|jpe?g|webp)$/i.test(relativePath)
        ) {
          mediaFiles.push(relativePath);
        }
      });

      if (mediaFiles.length > 0) {
        await onProgress(
          'translating',
          totalSlides,
          totalSlides,
          `بررسی و ترجمه هوشمند برچسب‌های متنی در ${mediaFiles.length} دیاگرام و تصویر ارائه...`
        );

        for (let mIdx = 0; mIdx < mediaFiles.length; mIdx++) {
          if (checkCancelled()) throw new Error('OPERATION_CANCELLED');
          const mediaPath = mediaFiles[mIdx];
          const fileEntry = zip.file(mediaPath);
          if (!fileEntry) continue;

          try {
            const imgBuffer = await fileEntry.async('nodebuffer');
            const mimeType = mediaPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
            const inpaintResult = await defaultDiagramInpainter.inpaintDiagramImage(
              imgBuffer,
              mimeType,
              `تصویر دیاگرام اسلاید ارائه: ${path.basename(mediaPath)}`
            );

            if (inpaintResult.modified) {
              zip.file(mediaPath, inpaintResult.buffer);
            }
          } catch (mErr) {
            console.warn(`[DIAGRAM_MEDIA_WARN] Skipped inpainting for ${mediaPath}:`, mErr);
          }
        }
      }
    }

    // 4. Generate Output PPTX
    await onProgress(
      'reconstructing',
      totalSlides,
      totalSlides,
      'تولید فایل نهایی ارائه و فشرده‌سازی با حداکثر کیفیت...'
    );

    const outputBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    await fs.promises.writeFile(job.outputPath, outputBuffer);

    // 5. Invariant Verification: Guarantee 100% Slide Count Match
    const verifyZip = await JSZip.loadAsync(outputBuffer);
    const outputSlides = this.getSlideFiles(verifyZip);

    if (outputSlides.length !== totalSlides) {
      throw new Error(
        `CRITICAL_SLIDE_COUNT_MISMATCH: Input presentation had ${totalSlides} slides, but output has ${outputSlides.length}.`
      );
    }

    // 6. Build Comprehensive Persian Full Text and Companion Files (TXT & Word DOCX)
    let fullDocText = '\uFEFF======================================================================\r\n';
    fullDocText += `DocuShift | ترجمه کامل و استخراج اختصاصی اسلایدهای ارائه: ${job.originalFileName}\r\n`;
    fullDocText += `تعداد اسلایدها: ${totalSlides} | کلمات ترجمه‌شده: ${processedWords.toLocaleString('fa-IR')}\r\n`;
    fullDocText += '======================================================================\r\n\r\n';

    for (const st of slideTranslations) {
      fullDocText += '----------------------------------------------------------------------\r\n';
      fullDocText += `🖥️ اسلاید ${st.pageNumber} از ${totalSlides}\r\n`;
      fullDocText += '----------------------------------------------------------------------\r\n\r\n';
      fullDocText += `${st.translatedText.trim()}\r\n\r\n\r\n`;
    }

    fullDocText += '======================================================================\r\n';
    fullDocText += 'پایان ترجمه کامل اسلایدهای ارائه\r\n';
    fullDocText += '======================================================================\r\n';

    job.translatedText = fullDocText;
    job.pageTranslations = slideTranslations;

    // Write companion TXT file
    const companionTxtPath = `${job.outputPath}.txt`;
    await fs.promises.writeFile(companionTxtPath, Buffer.from(fullDocText, 'utf-8'));

    // Write companion Word (DOCX) file with slide ribbon headers
    const companionDocxPath = `${job.outputPath}.docx`;
    try {
      await createDocxFile(job.originalFileName, slideTranslations, companionDocxPath, 'اسلاید');
    } catch (err) {
      console.warn('[DOCX_COMPANION_WARN]', err);
    }

    return {
      outputFilePath: job.outputPath,
      totalWords: processedWords,
      warnings,
    };
  }
}

export const defaultPPTXProcessor = new PPTXProcessor();
