import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageProvider } from './storageProvider.js';
import { JobState } from '../jobs/jobState.js';
import { config } from '../config/env.js';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;
  private cacheDir: string;

  constructor(baseDir: string = config.storagePath) {
    this.baseDir = path.resolve(baseDir);
    this.cacheDir = path.join(this.baseDir, 'cache');
  }

  async init(): Promise<void> {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async createJobFolders(jobId: string): Promise<{ inputDir: string; outputDir: string; tempDir: string }> {
    const jobDir = path.join(this.baseDir, jobId);
    const inputDir = path.join(jobDir, 'input');
    const outputDir = path.join(jobDir, 'output');
    const tempDir = path.join(jobDir, 'temp');

    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    return { inputDir, outputDir, tempDir };
  }

  getInputPath(jobId: string, filename: string): string {
    return path.join(this.baseDir, jobId, 'input', filename);
  }

  getOutputPath(jobId: string, filename: string): string {
    return path.join(this.baseDir, jobId, 'output', filename);
  }

  private getJobStatePath(jobId: string): string {
    return path.join(this.baseDir, jobId, 'checkpoint.json');
  }

  async saveJobState(job: JobState): Promise<void> {
    const jobDir = path.join(this.baseDir, job.jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    const statePath = this.getJobStatePath(job.jobId);
    // Write atomically using temporary file
    const tempPath = `${statePath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(job, null, 2), 'utf-8');
    await fs.promises.rename(tempPath, statePath);
  }

  async loadJobState(jobId: string): Promise<JobState | null> {
    const statePath = this.getJobStatePath(jobId);
    if (!fs.existsSync(statePath)) {
      return null;
    }
    try {
      const data = await fs.promises.readFile(statePath, 'utf-8');
      return JSON.parse(data) as JobState;
    } catch {
      return null;
    }
  }

  async listJobIds(): Promise<string[]> {
    if (!fs.existsSync(this.baseDir)) return [];
    const entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name !== 'cache')
      .map((e) => e.name);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  async computeHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  async saveCache(key: string, value: string): Promise<void> {
    if (!config.cacheEnabled) return;
    try {
      const cacheFile = path.join(this.cacheDir, `${key}.json`);
      await fs.promises.writeFile(cacheFile, JSON.stringify({ key, value, timestamp: Date.now() }), 'utf-8');
    } catch {
      // Non-fatal cache write failure
    }
  }

  async loadCache(key: string): Promise<string | null> {
    if (!config.cacheEnabled) return null;
    try {
      const cacheFile = path.join(this.cacheDir, `${key}.json`);
      if (!fs.existsSync(cacheFile)) return null;
      const content = await fs.promises.readFile(cacheFile, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed.value || null;
    } catch {
      return null;
    }
  }

  async cleanJob(jobId: string, onlyTemp = false): Promise<void> {
    const jobDir = path.join(this.baseDir, jobId);
    if (!fs.existsSync(jobDir)) return;

    if (onlyTemp) {
      const tempDir = path.join(jobDir, 'temp');
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        await fs.promises.mkdir(tempDir, { recursive: true });
      }
    } else {
      await fs.promises.rm(jobDir, { recursive: true, force: true });
    }
  }
}

export const defaultStorage = new LocalStorageProvider();
