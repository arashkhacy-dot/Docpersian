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

export interface PageManifestItem {
  index: number;
  status: 'pending' | 'extracted' | 'translated' | 'reconstructed' | 'validated' | 'failed';
  hasTranslatableText: boolean;
  wordCount: number;
  retryAttempts: number;
  error?: string;
  warning?: string;
}

export interface QualityReport {
  originalCount: number;
  outputCount: number;
  countMatch: boolean;
  translationStatus: string;
  imagesPreserved: 'preserved' | 'modified' | 'warnings';
  tablesPreserved: 'preserved' | 'modified' | 'warnings';
  validationStatus: 'passed' | 'warnings' | 'failed';
  notes: string[];
  layoutAudit?: any;
}

export interface DebugLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  tag: string;
  message: string;
}

export interface JobState {
  jobId: string;
  originalFileName: string;
  outputFileName: string;
  mimeType: string;
  documentType: 'pdf' | 'docx' | 'pptx';
  fileSizeBytes: number;
  inputPath: string;
  outputPath: string;
  inputHash: string;
  outputHash?: string;
  status: JobStatus;
  progress: number;
  currentStage:
    | 'idle'
    | 'extraction'
    | 'extracting'
    | 'translation'
    | 'translating'
    | 'reconstruction'
    | 'reconstructing'
    | 'validation'
    | 'validating';
  currentOperation: string;
  totalItems: number;
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
  manifest: {
    inputCount: number;
    items: PageManifestItem[];
  };
  qualityReport?: QualityReport;
  debugLogs: DebugLogEntry[];
  translatedText?: string;
  pageTranslations?: Array<{ pageNumber: number; text: string; translatedText: string }>;
}
