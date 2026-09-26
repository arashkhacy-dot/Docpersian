import { JobState } from '../jobs/jobState.js';

export interface StorageProvider {
  init(): Promise<void>;
  createJobFolders(jobId: string): Promise<{ inputDir: string; outputDir: string; tempDir: string }>;
  getInputPath(jobId: string, filename: string): string;
  getOutputPath(jobId: string, filename: string): string;
  saveJobState(job: JobState): Promise<void>;
  loadJobState(jobId: string): Promise<JobState | null>;
  listJobIds(): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  getFileSize(path: string): Promise<number>;
  computeHash(filePath: string): Promise<string>;
  saveCache(key: string, value: string): Promise<void>;
  loadCache(key: string): Promise<string | null>;
  cleanJob(jobId: string, onlyTemp?: boolean): Promise<void>;
}
