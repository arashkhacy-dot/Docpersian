import React from 'react';
import { XCircle, StopCircle, RefreshCw, Play, AlertOctagon } from 'lucide-react';
import { JobState } from '../types/job';

interface FailureCardProps {
  job: JobState;
  onResume: () => void;
  onReset: () => void;
}

export const FailureCard: React.FC<FailureCardProps> = ({ job, onResume, onReset }) => {
  const isCancelled = job.status === 'cancelled' || job.status === 'cancelling';

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
        <div className="flex items-center gap-4 border-b border-slate-800 pb-5">
          <div
            className={`p-3.5 rounded-2xl ${
              isCancelled
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}
          >
            {isCancelled ? <StopCircle className="w-8 h-8" /> : <XCircle className="w-8 h-8" />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {isCancelled ? 'فرآیند ترجمه متوقف و لغو گردید' : 'خطا در پردازش و ترجمه سند'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {job.currentOperation || 'فرآیند به پایان نرسید.'}
            </p>
          </div>
        </div>

        {/* Progress snapshot */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">پیشرفت ذخیره‌شده تا لحظه توقف:</span>
            <span className="font-mono font-bold text-slate-300">{job.progress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-slate-600 rounded-full"
              style={{ width: `${Math.max(2, job.progress)}%` }}
            ></div>
          </div>
          <p className="text-[11px] text-slate-500">
            تمامی نقاط بازرسی و متن‌های ترجمه‌شده تا این لحظه در سرور نگهداری شده‌اند.
          </p>
        </div>

        {/* Error messages if any */}
        {job.errors?.length > 0 && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-rose-400">
              <AlertOctagon className="w-4 h-4" />
              <span>شرح خطای رخ داده:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 font-mono text-[11px] text-rose-200/90" dir="ltr">
              {job.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            onClick={onResume}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors shadow-md shadow-indigo-600/20"
          >
            <Play className="w-3.5 h-3.5" />
            <span>از سرگیری ترجمه از همین نقطه (Resume)</span>
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>آپلود سند جدید</span>
          </button>
        </div>
      </div>
    </div>
  );
};
