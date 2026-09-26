import React, { useState } from 'react';
import { History, Download, RefreshCw, Play, CheckCircle2, AlertTriangle, XCircle, Clock, X, Loader2 } from 'lucide-react';
import { JobState } from '../types/job';
import { downloadJobOutput } from '../utils/fileDownloader';

interface JobHistoryProps {
  jobs: JobState[];
  currentJobId?: string;
  onSelectJob: (job: JobState) => void;
  onResumeJob: (jobId: string) => void;
  onClose: () => void;
}

export const JobHistory: React.FC<JobHistoryProps> = ({
  jobs,
  currentJobId,
  onSelectJob,
  onResumeJob,
  onClose,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (e: React.MouseEvent, job: JobState) => {
    e.stopPropagation();
    setDownloadingId(job.jobId);
    await downloadJobOutput(job.jobId, job.outputFileName);
    setDownloadingId(null);
  };
  const getStatusBadge = (status: JobState['status']) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
            <CheckCircle2 className="w-3 h-3" />
            تکمیل‌شده
          </span>
        );
      case 'completed_with_warnings':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
            <AlertTriangle className="w-3 h-3" />
            تکمیل با هشدار
          </span>
        );
      case 'failed':
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-medium">
            <XCircle className="w-3 h-3" />
            {status === 'cancelled' ? 'لغو شده' : 'ناموفق'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-medium animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" />
            در حال پردازش
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-y-0 left-0 z-50 w-full sm:w-96 bg-slate-900 border-r border-slate-800 shadow-2xl flex flex-col">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-400" />
          <h3 className="font-bold text-sm text-white">تاریخچه اسناد پردازش‌شده</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Jobs List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {jobs.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            هنوز سندی برای ترجمه ثبت نشده است.
          </div>
        ) : (
          jobs.map((j) => {
            const isCurrent = j.jobId === currentJobId;
            const canDownload = j.status === 'completed' || j.status === 'completed_with_warnings';
            const canResume = j.status === 'failed' || j.status === 'cancelled';

            return (
              <div
                key={j.jobId}
                onClick={() => onSelectJob(j)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                  isCurrent
                    ? 'bg-indigo-600/10 border-indigo-500/50 shadow-md shadow-indigo-500/10'
                    : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-xs text-white truncate max-w-[180px]" dir="ltr">
                    {j.originalFileName}
                  </div>
                  {getStatusBadge(j.status)}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="uppercase font-mono font-semibold text-slate-300">
                    {j.documentType} • {j.totalItems} {j.documentType === 'pptx' ? 'اسلاید' : 'صفحه'}
                  </span>
                  <span>{new Date(j.createdAt).toLocaleDateString('fa-IR')}</span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/60" onClick={(e) => e.stopPropagation()}>
                  {canDownload && (
                    <button
                      onClick={(e) => handleDownload(e, j)}
                      disabled={downloadingId === j.jobId}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 disabled:opacity-50 cursor-pointer"
                    >
                      {downloadingId === j.jobId ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      <span>دانلود خروجی</span>
                    </button>
                  )}

                  {canResume && (
                    <button
                      onClick={() => onResumeJob(j.jobId)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30"
                    >
                      <Play className="w-3 h-3" />
                      <span>ادامه ترجمه</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
