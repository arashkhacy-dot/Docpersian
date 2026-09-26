import React, { useState, useEffect } from 'react';
import { X, Download, FileText, Loader2, AlertCircle } from 'lucide-react';
import { JobState } from '../types/job';
import { downloadJobOutput } from '../utils/fileDownloader';

interface DocumentPreviewModalProps {
  job: JobState;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ job, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    let url: string | null = null;

    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/jobs/${job.jobId}/download`, {
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error('خطا در دریافت فایل پیش‌نمایش از سرور');
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          throw new Error('پاسخ سرور نامعتبر است.');
        }

        const blob = await res.blob();
        if (!active) return;

        const cleanBlob = new Blob([blob], { type: 'application/pdf' });
        url = URL.createObjectURL(cleanBlob);
        setBlobUrl(url);
      } catch (err: any) {
        if (active) {
          setError(err?.message || 'خطا در بارگیری سند');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [job.jobId]);

  const handleDownload = async () => {
    setIsDownloading(true);
    await downloadJobOutput(job.jobId, job.outputFileName);
    setIsDownloading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="truncate">
              <div className="text-sm font-bold text-white truncate" dir="ltr">
                {job.outputFileName}
              </div>
              <div className="text-[11px] text-slate-400">
                پیش‌نمایش درون‌برنامه‌ای سند ترجمه‌شده
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-colors cursor-pointer disabled:opacity-50"
            >
              {isDownloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">دانلود فایل</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Viewer */}
        <div className="flex-1 bg-slate-950 relative flex items-center justify-center overflow-hidden">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
              <p className="text-sm">در حال آماده‌سازی سند برای نمایش...</p>
            </div>
          )}

          {error && !loading && (
            <div className="p-6 text-center space-y-3 max-w-md">
              <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
              <p className="text-sm text-slate-300">{error}</p>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                <Download className="w-4 h-4" />
                <span>دانلود مستقیم فایل در دستگاه</span>
              </button>
            </div>
          )}

          {blobUrl && !loading && (
            <iframe
              src={blobUrl}
              title="پیش‌نمایش سند"
              className="w-full h-full border-0 rounded-b-2xl bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
};
