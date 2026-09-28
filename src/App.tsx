import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { UploadZone } from './components/UploadZone';
import { ProcessingView } from './components/ProcessingView';
import { CompletionCard } from './components/CompletionCard';
import { FailureCard } from './components/FailureCard';
import { JobHistory } from './components/JobHistory';
import { QualityReportModal } from './components/QualityReportModal';
import { JobState } from './types/job';
import { uploadFileInChunks, UploadProgressInfo } from './utils/chunkedUploader';

const ACTIVE_JOB_KEY = 'docushift_active_job_id';

export default function App() {
  const [currentJob, setCurrentJob] = useState<JobState | null>(null);
  const [jobsList, setJobsList] = useState<JobState[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressInfo | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch recent jobs list
  const fetchRecentJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobsList(data);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // Subscribe to live SSE updates for a job
  const subscribeToJobEvents = useCallback((jobId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sse = new EventSource(`/api/jobs/${jobId}/events`);
    eventSourceRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const updated: JobState = JSON.parse(event.data);
        setCurrentJob(updated);

        // Update in jobs list as well
        setJobsList((prev) => {
          const idx = prev.findIndex((j) => j.jobId === updated.jobId);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = updated;
            return next;
          }
          return [updated, ...prev];
        });

        // If job reached terminal state, close SSE
        const isTerminal = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(updated.status);
        if (isTerminal) {
          sse.close();
          fetchRecentJobs();
        }
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    sse.onerror = () => {
      // Fallback polling if SSE disconnects
      sse.close();
    };
  }, [fetchRecentJobs]);

  // Load persisted job on startup (browser reconnect support)
  useEffect(() => {
    fetchRecentJobs();

    const savedJobId = localStorage.getItem(ACTIVE_JOB_KEY);
    if (savedJobId) {
      fetch(`/api/jobs/${savedJobId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((job: JobState | null) => {
          if (job) {
            setCurrentJob(job);
            const isTerminal = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(job.status);
            if (!isTerminal) {
              subscribeToJobEvents(job.jobId);
            }
          }
        })
        .catch(() => {});
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [fetchRecentJobs, subscribeToJobEvents]);

  // Polling fallback to guarantee continuous updates even if SSE hiccups
  useEffect(() => {
    if (!currentJob) return;
    const isTerminal = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(currentJob.status);
    if (isTerminal) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${currentJob.jobId}`);
        if (res.ok) {
          const freshJob: JobState = await res.json();
          setCurrentJob((prev) => {
            if (!prev) return freshJob;
            if (['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(prev.status)) {
              return prev;
            }
            if (
              prev.status === freshJob.status &&
              prev.currentStage === freshJob.currentStage &&
              prev.processedItems === freshJob.processedItems &&
              prev.progress === freshJob.progress &&
              prev.currentOperation === freshJob.currentOperation
            ) {
              return prev; // Identical state -> keep reference, zero re-renders!
            }
            return freshJob;
          });
          if (['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(freshJob.status)) {
            clearInterval(interval);
            fetchRecentJobs();
          }
        }
      } catch {
        // Ignore transient poll failures
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [currentJob?.jobId, currentJob?.status, fetchRecentJobs]);

  // Handle document upload with smart chunking (supports large files up to 500MB without Cloud Run 32MB limits)
  const handleFileSelect = async (file: File) => {
    setIsUploading(true);
    setGlobalError(null);
    setUploadProgress((prev) =>
      prev && prev.percent > 0
        ? { ...prev, statusMessage: 'در حال برقراری مجدد ارتباط...' }
        : {
            percent: 0,
            uploadedBytes: 0,
            totalBytes: file.size,
            currentChunk: 1,
            totalChunks: file.size <= 25 * 1024 * 1024 ? 1 : Math.max(1, Math.ceil(file.size / (10 * 1024 * 1024))),
            isDirect: file.size <= 25 * 1024 * 1024,
            statusMessage: 'آغاز ارسال مستقیم و پرسرعت...',
          }
    );

    try {
      const newJob: JobState = await uploadFileInChunks(file, (info) => {
        setUploadProgress(info);
      });

      setCurrentJob(newJob);
      localStorage.setItem(ACTIVE_JOB_KEY, newJob.jobId);
      setJobsList((prev) => [newJob, ...prev]);

      // Connect to live stream
      subscribeToJobEvents(newJob.jobId);
      setIsUploading(false);
      setUploadProgress(null);
    } catch (err: any) {
      console.error('[UPLOAD_FAILED]', err);
      setGlobalError(
        err?.message ||
          'خطا در ارسال فایل به سرور. اطلاعات قطعات ارسال‌شده ذخیره شده است؛ برای ادامه ارسال از دکمه زیر استفاده نمایید.'
      );
      setIsUploading(false);
      setUploadProgress((prev) =>
        prev
          ? {
              ...prev,
              statusMessage: 'ارتباط متوقف شد؛ می‌توانید ارسال را از همین نقطه بدون اتلاف حجم ادامه دهید.',
            }
          : null
      );
    }
  };

  // Handle document import from Google Drive or Cloud URL
  const handleImportUrl = async (url: string) => {
    setIsUploading(true);
    setGlobalError(null);
    setUploadProgress({
      percent: 50,
      uploadedBytes: 0,
      totalBytes: 0,
      currentChunk: 1,
      totalChunks: 1,
      statusMessage: 'سرور در حال دریافت مستقیم سند از گوگل درایو / فضای ابری...',
    });

    try {
      const res = await fetch('/api/jobs/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'خطا در دریافت سند از لینک وارد شده.');
      }

      const newJob: JobState = await res.json();
      setCurrentJob(newJob);
      localStorage.setItem(ACTIVE_JOB_KEY, newJob.jobId);
      setJobsList((prev) => [newJob, ...prev]);

      subscribeToJobEvents(newJob.jobId);
      setIsUploading(false);
      setUploadProgress(null);
    } catch (err: any) {
      console.error('[IMPORT_URL_FAILED]', err);
      setGlobalError(err?.message || 'خطا در دریافت فایل از لینک وارد شده.');
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  // Handle job cancellation
  const handleCancel = async () => {
    if (!currentJob) return;
    try {
      const res = await fetch(`/api/jobs/${currentJob.jobId}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentJob(updated);
      }
    } catch (err) {
      console.error('Cancel request error:', err);
    }
  };

  // Handle job resume
  const handleResume = async (jobId?: string) => {
    const targetId = jobId || currentJob?.jobId;
    if (!targetId) return;

    try {
      const res = await fetch(`/api/jobs/${targetId}/resume`, {
        method: 'POST',
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentJob(updated);
        localStorage.setItem(ACTIVE_JOB_KEY, updated.jobId);
        subscribeToJobEvents(updated.jobId);
      }
    } catch (err) {
      console.error('Resume error:', err);
    }
  };

  // Handle reset to translate a new document
  const handleReset = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setCurrentJob(null);
    setGlobalError(null);
  };

  // Render current view based on job status
  const renderMainContent = () => {
    if (!currentJob) {
      return (
        <UploadZone
          onFileSelect={handleFileSelect}
          onImportUrl={handleImportUrl}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
        />
      );
    }

    switch (currentJob.status) {
      case 'queued':
      case 'processing':
      case 'extracting':
      case 'translating':
      case 'reconstructing':
      case 'validating':
      case 'cancelling':
        return <ProcessingView job={currentJob} onCancel={handleCancel} />;

      case 'completed':
      case 'completed_with_warnings':
        return (
          <CompletionCard
            job={currentJob}
            onReset={handleReset}
            onViewReport={() => setShowReportModal(true)}
          />
        );

      case 'failed':
      case 'cancelled':
        return (
          <FailureCard
            job={currentJob}
            onResume={() => handleResume(currentJob.jobId)}
            onReset={handleReset}
          />
        );

      default:
        return (
          <UploadZone
            onFileSelect={handleFileSelect}
            onImportUrl={handleImportUrl}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
          />
        );
    }
  };

  const activeJobsCount = jobsList.filter(
    (j) => !['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(j.status)
  ).length;

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200">
      <Header
        onToggleHistory={() => setShowHistory(!showHistory)}
        showHistory={showHistory}
        activeCount={activeJobsCount}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
        {globalError && (
          <div className="w-full max-w-3xl mx-auto mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center justify-between">
            <span>{globalError}</span>
            <button
              onClick={() => setGlobalError(null)}
              className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1"
            >
              بستن
            </button>
          </div>
        )}

        {renderMainContent()}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>DocuShift — سامانه ترجمه پیشرفته و مهندسی اسناد به زبان فارسی</span>
          <span className="font-mono text-[11px] text-slate-600">Enterprise Document Translation Engine v1.0.0</span>
        </div>
      </footer>

      {/* History Drawer */}
      {showHistory && (
        <JobHistory
          jobs={jobsList}
          currentJobId={currentJob?.jobId}
          onSelectJob={(j) => {
            setCurrentJob(j);
            localStorage.setItem(ACTIVE_JOB_KEY, j.jobId);
            const isTerminal = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(j.status);
            if (!isTerminal) {
              subscribeToJobEvents(j.jobId);
            }
            setShowHistory(false);
          }}
          onResumeJob={(id) => {
            handleResume(id);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Quality Report Modal */}
      {showReportModal && currentJob && (
        <QualityReportModal job={currentJob} onClose={() => setShowReportModal(false)} />
      )}
    </div>
  );
}
