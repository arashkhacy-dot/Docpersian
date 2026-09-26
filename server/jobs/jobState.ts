export type JobStatus =
  | 'queued'
  | 'processing'
  | 'extracting'
  | 'translating'
  | 'reconstructing'
  | 'validating'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
] as const;

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type DocumentType = 'pdf' | 'docx' | 'pptx';

export type StageName =
  | 'idle'
  | 'extraction'
  | 'extracting'
  | 'translation'
  | 'translating'
  | 'reconstruction'
  | 'reconstructing'
  | 'validation'
  | 'validating';

export interface PageManifestItem {
  index: number; // 1-based page or slide index
  status: 'pending' | 'extracted' | 'translated' | 'reconstructed' | 'validated' | 'failed';
  hasTranslatableText: boolean;
  wordCount: number;
  retryAttempts: number;
  error?: string;
  warning?: string;
  durationMs?: number;
}

export interface DocumentManifest {
  inputCount: number;
  outputCount?: number;
  items: PageManifestItem[];
}

export interface QualityReport {
  originalCount: number;
  outputCount: number;
  countMatch: boolean;
  translationStatus: string;
  imagesPreserved: 'preserved' | 'warnings' | 'not_applicable';
  tablesPreserved: 'preserved' | 'warnings' | 'not_applicable';
  validationStatus: 'passed' | 'warnings' | 'failed';
  notes: string[];
}

export interface DebugLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
}

export interface JobState {
  jobId: string;
  originalFileName: string;
  outputFileName: string;
  mimeType: string;
  documentType: DocumentType;
  fileSizeBytes: number;
  inputPath: string;
  outputPath: string;
  inputHash: string;
  outputHash?: string;
  status: JobStatus;
  progress: number; // 0 - 100
  currentStage: StageName;
  currentOperation: string;
  totalItems: number; // total pages / slides
  processedItems: number;
  totalWords: number;
  processedWords: number;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
  retryCount: number;
  lastHeartbeatAt?: number;
  warnings: string[];
  errors: string[];
  manifest: DocumentManifest;
  qualityReport?: QualityReport;
  debugLogs: DebugLogEntry[];
  cancellationRequested?: boolean;
  translatedText?: string;
  pageTranslations?: Array<{ pageNumber: number; text: string; translatedText: string }>;
}
