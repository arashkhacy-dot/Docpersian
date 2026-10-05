import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  geminiApiKey: string;
  geminiModel: string;
  translationEngine: 'gemini' | 'local';
  localModelUrl: string;
  localModelName: string;
  storagePath: string;
  maxFileSize: number;
  maxConcurrentJobs: number;
  jobTimeoutMs: number;
  pageTimeoutMs: number;
  pageReconstructionTimeoutMs: number;
  rtlOperationTimeoutMs: number;
  workerStallTimeoutMs: number;
  heartbeatIntervalMs: number;
  validationTimeoutMs: number;
  retryCount: number;
  cacheEnabled: boolean;
  reconstructionRtlEnabled: boolean;
  diagramInpaintingEnabled: boolean;
  port: number;
  isDev: boolean;
}

function parseNumber(val: string | undefined, defaultVal: number): number {
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultVal : parsed;
}

function parseBoolean(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined || val === null || val === '') return defaultVal;
  return val.toLowerCase() === 'true' || val === '1';
}

export const config: AppConfig = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  translationEngine: (process.env.TRANSLATION_ENGINE as 'gemini' | 'local') || 'gemini',
  localModelUrl: process.env.LOCAL_MODEL_URL || 'http://localhost:11434/v1',
  localModelName: process.env.LOCAL_MODEL_NAME || 'qwen2.5-vl:3b',
  storagePath: path.resolve(process.cwd(), process.env.STORAGE_PATH || './jobs_storage'),
  maxFileSize: parseNumber(process.env.MAX_FILE_SIZE, 1024 * 1024 * 1024), // 1GB (1024MB) Maximum Capacity
  maxConcurrentJobs: parseNumber(process.env.MAX_CONCURRENT_JOBS, 4), // 4 concurrent high-speed jobs
  jobTimeoutMs: parseNumber(process.env.JOB_TIMEOUT, 3600000), // 60 mins maximum timeout
  pageTimeoutMs: parseNumber(process.env.PAGE_TIMEOUT, 300000), // 5 mins per page/slide
  pageReconstructionTimeoutMs: parseNumber(process.env.PAGE_RECONSTRUCTION_TIMEOUT, 300000), // 5 mins
  rtlOperationTimeoutMs: parseNumber(process.env.RTL_OPERATION_TIMEOUT, 60000), // 60s
  workerStallTimeoutMs: parseNumber(process.env.WORKER_STALL_TIMEOUT, 300000), // 5 mins stall watchdog
  heartbeatIntervalMs: parseNumber(process.env.HEARTBEAT_INTERVAL, 5000), // 5s heartbeat
  validationTimeoutMs: parseNumber(process.env.VALIDATION_TIMEOUT, 600000), // 10 mins deep validation
  retryCount: parseNumber(process.env.RETRY_COUNT, 5), // 5 maximum retries
  cacheEnabled: parseBoolean(process.env.CACHE_ENABLED, true),
  reconstructionRtlEnabled: parseBoolean(process.env.RECONSTRUCTION_RTL_ENABLED, true),
  diagramInpaintingEnabled: parseBoolean(process.env.DIAGRAM_INPAINTING_ENABLED, true),
  port: parseNumber(process.env.PORT, 3000),
  isDev: process.env.NODE_ENV !== 'production',
};

export function validateStartupConfig(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (!config.geminiApiKey) {
    warnings.push('GEMINI_API_KEY is not defined. Offline/Mock translation fallback will be used if set or jobs requiring online translation will be queued.');
  }
  if (config.maxFileSize <= 0) {
    throw new Error('MAX_FILE_SIZE must be greater than 0');
  }
  if (config.jobTimeoutMs <= 0) {
    throw new Error('JOB_TIMEOUT must be greater than 0');
  }
  return { valid: true, warnings };
}
