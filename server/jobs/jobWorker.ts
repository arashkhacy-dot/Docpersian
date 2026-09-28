import EventEmitter from 'events';
import { JobState, JobStatus, isTerminalStatus, DebugLogEntry } from './jobState';
import { defaultStorage } from '../storage/localStorageProvider';
import { config } from '../config/env';
import { defaultPDFProcessor } from '../processors/pdfProcessor';
import { defaultDOCXProcessor } from '../processors/docxProcessor';
import { defaultPPTXProcessor } from '../processors/pptxProcessor';
import { defaultValidator } from '../validation/documentValidator';
import { DocumentProcessor } from '../processors/documentProcessor';

interface ActiveJobHandle {
  job: JobState;
  cancelFlag: { cancelled: boolean };
}

export class JobWorker extends EventEmitter {
  private activeJobs: Map<string, ActiveJobHandle> = new Map();

  private getProcessor(type: JobState['documentType']): DocumentProcessor {
    switch (type) {
      case 'pdf':
        return defaultPDFProcessor;
      case 'docx':
        return defaultDOCXProcessor;
      case 'pptx':
        return defaultPPTXProcessor;
      default:
        throw new Error(`Unsupported document type: ${type}`);
    }
  }

  private addLog(job: JobState, level: DebugLogEntry['level'], tag: string, message: string): void {
    const entry: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      tag,
      message,
    };
    job.debugLogs.push(entry);
    // Keep max 50 logs per job to maintain ultra-fast serialization
    if (job.debugLogs.length > 50) {
      job.debugLogs.shift();
    }
  }

  async runJob(job: JobState): Promise<void> {
    return this.startJob(job);
  }

  async startJob(job: JobState): Promise<void> {
    if (isTerminalStatus(job.status)) {
      return;
    }

    const cancelFlag = { cancelled: false };
    this.activeJobs.set(job.jobId, { job, cancelFlag });

    job.status = 'processing';
    job.startedAt = job.startedAt || Date.now();
    job.updatedAt = Date.now();
    job.lastHeartbeatAt = Date.now();
    this.addLog(job, 'info', 'JOB_START', `Started processing ${job.originalFileName} (${job.documentType})`);
    await defaultStorage.saveJobState(job);
    this.emit('update', job);

    // Section 15: Heartbeat generator every 5s
    const heartbeatTimer = setInterval(async () => {
      if (isTerminalStatus(job.status)) {
        clearInterval(heartbeatTimer);
        return;
      }
      job.lastHeartbeatAt = Date.now();
      job.elapsedMs = Date.now() - (job.startedAt || Date.now());
      this.addLog(
        job,
        'info',
        'JOB_HEARTBEAT',
        `jobId=${job.jobId} stage=${job.currentStage} page=${job.processedItems}/${job.totalItems} progress=${job.progress}% timestamp=${new Date().toISOString()}`
      );
      await defaultStorage.saveJobState(job);
      this.emit('update', job);
    }, config.heartbeatIntervalMs);
    if (heartbeatTimer.unref) heartbeatTimer.unref();

    // Section 16: Watchdog stall check every 10s (stalled if > 90s without progress/heartbeat)
    const watchdogInterval = setInterval(async () => {
      if (isTerminalStatus(job.status)) {
        clearInterval(watchdogInterval);
        return;
      }
      const stallDuration = Date.now() - (job.lastHeartbeatAt || job.updatedAt);
      if (stallDuration > config.workerStallTimeoutMs) {
        clearInterval(watchdogInterval);
        this.addLog(
          job,
          'error',
          'JOB_STALL',
          `Worker stall detected (${stallDuration}ms > ${config.workerStallTimeoutMs}ms). Diagnostic captured: stage=${job.currentStage} page=${job.processedItems}. Halting job.`
        );
        cancelFlag.cancelled = true;
        await this.terminateJob(job, 'failed', `توقف طولانی‌مدت فرآیند (Watchdog Stall Timeout > ${config.workerStallTimeoutMs / 1000} ثانیه).`);
      }
    }, 10000);
    if (watchdogInterval.unref) watchdogInterval.unref();

    try {
      const processor = this.getProcessor(job.documentType);

      // Check input hash
      if (!job.inputHash) {
        job.inputHash = await defaultStorage.computeHash(job.inputPath);
      }

      // Initial analysis if not already performed during fast non-blocking upload
      if (!job.manifest || !job.manifest.items || job.manifest.items.length === 0 || job.totalItems === 0) {
        job.currentStage = 'extracting';
        job.currentOperation = 'آنالیز ساختار سند و شناسایی صفحات...';
        this.emit('update', job);

        const analysis = await processor.analyzeDocument(job.inputPath);
        job.totalItems = analysis.itemCount;
        job.totalWords = analysis.totalWords;
        job.manifest = {
          inputCount: analysis.itemCount,
          items: analysis.initialManifest,
        };
        this.addLog(
          job,
          'info',
          'ANALYSIS_DONE',
          `Document analyzed: items=${analysis.itemCount}, words=${analysis.totalWords}`
        );
        await defaultStorage.saveJobState(job);
        this.emit('update', job);
      }

      if (cancelFlag.cancelled || job.cancellationRequested) {
        await this.terminateJob(job, 'cancelled', 'عملیات توسط کاربر لغو گردید.');
        return;
      }

      // Process document with granular progress and logging callback
      const result = await processor.processDocument(
        job,
        async (stage, currentItem, totalItems, op) => {
          if (cancelFlag.cancelled || job.cancellationRequested) {
            throw new Error('OPERATION_CANCELLED');
          }

          job.currentStage = stage;
          job.processedItems = currentItem;
          job.totalItems = totalItems;
          job.currentOperation = op;
          job.lastHeartbeatAt = Date.now();
          job.elapsedMs = Date.now() - (job.startedAt || Date.now());

          // Progressive weight for progress calculation:
          // Extraction: 10% - 25%
          // Translation: 25% - 65%
          // Reconstruction: 65% - 90%
          let stageBase = 10;
          let stageSpan = 15;

          if (stage === 'extracting') {
            stageBase = 10;
            stageSpan = 15;
          } else if (stage === 'translating') {
            stageBase = 25;
            stageSpan = 40;
          } else if (stage === 'reconstructing') {
            stageBase = 65;
            stageSpan = 25;
          }

          const itemRatio = totalItems > 0 ? Math.min(1, currentItem / totalItems) : 0;
          const calculatedProgress = Math.min(90, Math.round(stageBase + itemRatio * stageSpan));
          job.progress = Math.max(job.progress, calculatedProgress);

          // Estimate remaining time
          if (job.progress > 10) {
            const timePerPercent = job.elapsedMs / job.progress;
            job.estimatedRemainingMs = Math.round((95 - job.progress) * timePerPercent);
          }

          job.updatedAt = Date.now();
          await defaultStorage.saveJobState(job);
          this.emit('update', job);
        },
        () => cancelFlag.cancelled || !!job.cancellationRequested,
        (level, tag, msg) => {
          this.addLog(job, level, tag, msg);
        }
      );

      if (cancelFlag.cancelled || job.cancellationRequested) {
        await this.terminateJob(job, 'cancelled', 'عملیات توسط کاربر لغو گردید.');
        return;
      }

      job.totalWords = result.totalWords || job.totalWords;
      if (result.warnings.length > 0) {
        job.warnings.push(...result.warnings);
      }

      // Compute output hash
      job.outputHash = await defaultStorage.computeHash(job.outputPath);

      // Section 22: Output Validation Stage
      job.currentStage = 'validation';
      job.currentOperation = 'اعتبارسنجی مستقل ساختار و شمارش صفحات/اسلایدهای سند خروجی...';
      job.progress = 92;
      job.updatedAt = Date.now();
      await defaultStorage.saveJobState(job);
      this.emit('update', job);

      this.addLog(job, 'info', 'VALIDATION_START', 'Starting independent output validation');

      const validation = await defaultValidator.validateJobOutput(job, async (step) => {
        job.currentOperation = step;
        job.updatedAt = Date.now();
        await defaultStorage.saveJobState(job);
        this.emit('update', job);
      });

      job.qualityReport = validation.qualityReport;
      this.addLog(
        job,
        validation.valid ? 'info' : 'error',
        'VALIDATION_END',
        `Validation completed. Passed=${validation.valid}, Warnings=${validation.warnings.length}`
      );

      if (!validation.valid) {
        job.errors.push(...validation.errors);
        await this.terminateJob(job, 'failed', 'عدم تطابق یا اشکال در اعتبارسنجی ساختاری سند خروجی');
        return;
      }

      // Success terminal state
      const finalStatus: JobStatus = validation.warnings.length > 0 ? 'completed_with_warnings' : 'completed';
      job.status = finalStatus;
      job.progress = 100;
      job.currentStage = 'idle';
      job.currentOperation = 'ترجمه و اعتبارسنجی با موفقیت به پایان رسید.';
      job.completedAt = Date.now();
      job.elapsedMs = job.completedAt - (job.startedAt || job.completedAt);
      job.estimatedRemainingMs = 0;
      job.updatedAt = Date.now();

      this.addLog(job, 'info', 'JOB_COMPLETE', `Job finished successfully as ${finalStatus}`);
      await defaultStorage.saveJobState(job);
      this.emit('update', job);
    } catch (err: any) {
      if (err?.message === 'OPERATION_CANCELLED' || cancelFlag.cancelled || job.cancellationRequested) {
        await this.terminateJob(job, 'cancelled', 'عملیات توسط کاربر لغو گردید.');
      } else {
        const errorMsg = err?.message || String(err);
        this.addLog(job, 'error', 'JOB_ERROR', errorMsg);
        job.errors.push(errorMsg);
        await this.terminateJob(job, 'failed', `خطا در پردازش سند: ${errorMsg}`);
      }
    } finally {
      clearInterval(heartbeatTimer);
      clearInterval(watchdogInterval);
      this.activeJobs.delete(job.jobId);
    }
  }

  cancelJob(job: JobState): boolean {
    if (isTerminalStatus(job.status)) {
      return false;
    }

    job.cancellationRequested = true;
    job.status = 'cancelling';
    job.currentOperation = 'در حال لغو ایمن عملیات...';
    this.addLog(job, 'warn', 'JOB_CANCEL', 'Cancellation requested by user');

    const active = this.activeJobs.get(job.jobId);
    if (active) {
      active.cancelFlag.cancelled = true;
    } else {
      this.terminateJob(job, 'cancelled', 'عملیات لغو گردید.');
    }

    return true;
  }

  private async terminateJob(job: JobState, terminalStatus: 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled', reason: string): Promise<void> {
    if (isTerminalStatus(job.status) && job.status !== 'cancelling' && job.status !== 'processing') {
      return;
    }

    job.status = terminalStatus;
    if (terminalStatus === 'cancelled') {
      job.currentOperation = `لغو شده (پیشرفت متوقف در ${job.progress}٪): ${reason}`;
    } else if (terminalStatus === 'failed') {
      job.currentOperation = `شکست در پردازش: ${reason}`;
    }

    job.completedAt = Date.now();
    job.elapsedMs = job.completedAt - (job.startedAt || job.completedAt);
    job.estimatedRemainingMs = 0;
    job.updatedAt = Date.now();

    this.addLog(job, terminalStatus === 'failed' ? 'error' : 'warn', 'JOB_TERMINATE', `Job reached terminal state: ${terminalStatus} - ${reason}`);
    await defaultStorage.saveJobState(job);
    this.emit('update', job);
  }
}

export const defaultWorker = new JobWorker();
