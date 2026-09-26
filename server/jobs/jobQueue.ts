import { JobState, isTerminalStatus } from './jobState.js';
import { defaultWorker } from './jobWorker.js';
import { defaultStorage } from '../storage/localStorageProvider.js';
import { config } from '../config/env.js';

export class JobQueue {
  private queue: string[] = [];
  private inFlight = new Set<string>();
  private cache = new Map<string, JobState>();

  constructor() {
    defaultWorker.on('update', (job: JobState) => {
      this.cache.set(job.jobId, job);
      if (isTerminalStatus(job.status)) {
        this.inFlight.delete(job.jobId);
        this.processNext();
      }
    });
  }

  async enqueue(job: JobState): Promise<void> {
    this.cache.set(job.jobId, job);
    await defaultStorage.saveJobState(job);
    this.queue.push(job.jobId);
    this.processNext();
  }

  async getJob(jobId: string): Promise<JobState | null> {
    if (this.cache.has(jobId)) {
      return this.cache.get(jobId)!;
    }
    const persisted = await defaultStorage.loadJobState(jobId);
    if (persisted) {
      this.cache.set(jobId, persisted);
      return persisted;
    }
    return null;
  }

  async listRecentJobs(): Promise<JobState[]> {
    const jobIds = await defaultStorage.listJobIds();
    const jobs: JobState[] = [];

    for (const id of jobIds) {
      const job = await this.getJob(id);
      if (job) jobs.push(job);
    }

    return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  }

  async cancelJob(jobId: string): Promise<JobState | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    if (isTerminalStatus(job.status)) {
      return job;
    }

    // If still in queue, remove from queue directly
    const queueIdx = this.queue.indexOf(jobId);
    if (queueIdx !== -1) {
      this.queue.splice(queueIdx, 1);
    }

    defaultWorker.cancelJob(job);
    return job;
  }

  async resumeJob(jobId: string): Promise<JobState | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    if (job.status === 'completed' || job.status === 'completed_with_warnings') {
      return job;
    }

    // Reset status to queued for resuming
    job.status = 'queued';
    job.cancellationRequested = false;
    job.currentOperation = 'از سرگیری پردازش سند از آخرین نقطه بازرسی...';
    job.updatedAt = Date.now();
    await defaultStorage.saveJobState(job);

    this.enqueue(job);
    return job;
  }

  private async processNext(): Promise<void> {
    if (this.inFlight.size >= config.maxConcurrentJobs) {
      return;
    }

    const nextJobId = this.queue.shift();
    if (!nextJobId) {
      return;
    }

    const job = await this.getJob(nextJobId);
    if (!job || isTerminalStatus(job.status)) {
      this.processNext();
      return;
    }

    this.inFlight.add(job.jobId);
    // Execute asynchronously (do not await, let worker run in background)
    defaultWorker.runJob(job).catch((err) => {
      console.error(`Unhandled error running job ${job.jobId}:`, err);
    });
  }
}

export const defaultJobQueue = new JobQueue();
