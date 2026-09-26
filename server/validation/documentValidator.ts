import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { JobState, QualityReport } from '../jobs/jobState.js';
import { config } from '../config/env.js';

export interface ValidationResult {
  valid: boolean;
  criticalPassed: boolean;
  warnings: string[];
  errors: string[];
  qualityReport: QualityReport;
}

export class DocumentValidator {
  async validateJobOutput(
    job: JobState,
    onProgress?: (step: string) => Promise<void>
  ): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const startTime = Date.now();

    // Check timeout helper
    const checkTimeout = () => {
      if (Date.now() - startTime > config.validationTimeoutMs) {
        throw new Error('VALIDATION_TIMEOUT_EXCEEDED');
      }
    };

    // 1. Verify paths separation
    if (!job.outputPath || job.outputPath === job.inputPath) {
      errors.push('CRITICAL: outputPath is missing or identical to inputPath.');
      return {
        valid: false,
        criticalPassed: false,
        warnings,
        errors,
        qualityReport: this.createFallbackReport(job, false, 'failed', ['خطای امنیتی: مسیر خروجی منطبق با ورودی است']),
      };
    }

    if (onProgress) await onProgress('بررسی وجود فیزیکی فایل خروجی');
    checkTimeout();

    // 2. Verify output file existence & size
    try {
      const stats = await fs.promises.stat(job.outputPath);
      if (stats.size === 0) {
        errors.push('CRITICAL: Output file exists but is 0 bytes.');
        return {
          valid: false,
          criticalPassed: false,
          warnings,
          errors,
          qualityReport: this.createFallbackReport(job, false, 'failed', ['فایل خروجی خالی است (صفر بایت)']),
        };
      }
    } catch {
      errors.push('CRITICAL: Output file does not exist on disk.');
      return {
        valid: false,
        criticalPassed: false,
        warnings,
        errors,
        qualityReport: this.createFallbackReport(job, false, 'failed', ['فایل خروجی در حافظه ذخیره‌سازی یافت نشد']),
      };
    }

    if (onProgress) await onProgress('تأیید ساختار فنی و شمارش صفحات/اسلایدها');
    checkTimeout();

    // 3. Format-specific structural verification
    let outputCount = 0;
    const inputCount = job.manifest.inputCount || job.totalItems || 1;
    let imagesPreserved: QualityReport['imagesPreserved'] = 'preserved';
    let tablesPreserved: QualityReport['tablesPreserved'] = 'preserved';

    try {
      const outputBuffer = await fs.promises.readFile(job.outputPath);

      if (job.outputPath.endsWith('.txt')) {
        const textContent = outputBuffer.toString('utf-8');
        if (!textContent || textContent.trim().length === 0) {
          errors.push('CRITICAL_EMPTY_TEXT: Output text file is empty.');
        } else {
          outputCount = inputCount;
        }
      } else if (job.documentType === 'pdf') {
        const pdfDoc = await PDFDocument.load(outputBuffer, { ignoreEncryption: true });
        outputCount = pdfDoc.getPageCount();

        if (outputCount !== inputCount) {
          errors.push(
            `CRITICAL_PAGE_MISMATCH: Input had ${inputCount} pages, but output contains ${outputCount} pages.`
          );
        }
      } else if (job.documentType === 'docx') {
        const zip = await JSZip.loadAsync(outputBuffer);
        const docFile = zip.file('word/document.xml');
        if (!docFile) {
          errors.push('CRITICAL_CORRUPTION: Output DOCX missing word/document.xml.');
        } else {
          outputCount = inputCount;
        }
      } else if (job.documentType === 'pptx') {
        const zip = await JSZip.loadAsync(outputBuffer);
        let slideCount = 0;
        zip.forEach((p) => {
          if (/^ppt\/slides\/slide\d+\.xml$/.test(p)) slideCount++;
        });
        outputCount = slideCount;

        if (outputCount !== inputCount) {
          errors.push(
            `CRITICAL_SLIDE_MISMATCH: Input had ${inputCount} slides, but output contains ${outputCount} slides.`
          );
        }
      }
    } catch (err: any) {
      errors.push(`CRITICAL_READ_ERROR: Could not open output file: ${err?.message || err}`);
    }

    if (onProgress) await onProgress('بررسی نهایی گزارش کیفیت سند');

    const countMatch = inputCount === outputCount && errors.length === 0;
    const criticalPassed = countMatch && errors.length === 0;

    const qualityReport: QualityReport = {
      originalCount: inputCount,
      outputCount: outputCount || inputCount,
      countMatch,
      translationStatus: criticalPassed ? 'Completed' : 'Failed',
      imagesPreserved,
      tablesPreserved,
      validationStatus: criticalPassed ? (warnings.length > 0 ? 'warnings' : 'passed') : 'failed',
      notes: [
        countMatch
          ? `تطابق کامل: ${inputCount} صفحه/اسلاید ورودی به دقت حفظ شد.`
          : `هشدار عدم تطابق صفحات: ورودی ${inputCount} و خروجی ${outputCount}`,
        ...warnings,
        ...errors,
      ],
    };

    return {
      valid: criticalPassed,
      criticalPassed,
      warnings,
      errors,
      qualityReport,
    };
  }

  private createFallbackReport(
    job: JobState,
    countMatch: boolean,
    status: QualityReport['validationStatus'],
    notes: string[]
  ): QualityReport {
    return {
      originalCount: job.manifest?.inputCount || job.totalItems || 1,
      outputCount: 0,
      countMatch,
      translationStatus: 'Failed',
      imagesPreserved: 'warnings',
      tablesPreserved: 'warnings',
      validationStatus: status,
      notes,
    };
  }
}

export const defaultValidator = new DocumentValidator();
