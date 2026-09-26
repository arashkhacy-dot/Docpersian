import { JobState, PageManifestItem } from '../jobs/jobState.js';

export interface ProcessPageResult {
  index: number;
  wordCount: number;
  hasTranslatableText: boolean;
  status: PageManifestItem['status'];
  error?: string;
  warning?: string;
}

export interface DocumentProcessor {
  analyzeDocument(inputFilePath: string): Promise<{
    itemCount: number; // pages or slides
    totalWords: number;
    initialManifest: PageManifestItem[];
    detectedType: 'pdf' | 'docx' | 'pptx';
  }>;

  processDocument(
    job: JobState,
    onProgress: (stage: JobState['currentStage'], currentItem: number, totalItems: number, op: string) => Promise<void>,
    checkCancelled: () => boolean,
    onLog?: (level: 'info' | 'warn' | 'error', tag: string, message: string) => void
  ): Promise<{
    outputFilePath: string;
    totalWords: number;
    warnings: string[];
  }>;
}
