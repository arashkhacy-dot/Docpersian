import React, { useState, useEffect } from 'react';
import { Loader2, StopCircle, CheckCircle, Clock, AlertTriangle, ChevronDown, ChevronUp, Terminal, Activity } from 'lucide-react';
import { JobState } from '../types/job';

interface ProcessingViewProps {
  job: JobState;
  onCancel: () => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({ job, onCancel }) => {
  const [showLogs, setShowLogs] = useState(true);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [liveElapsedMs, setLiveElapsedMs] = useState(job.elapsedMs || 0);

  // Section 14: Dynamic elapsed timer driven by authoritative server timestamps
  useEffect(() => {
    const updateTimer = () => {
      if (job.startedAt) {
        if (job.completedAt) {
          setLiveElapsedMs(job.completedAt - job.startedAt);
        } else {
          setLiveElapsedMs(Math.max(0, Date.now() - job.startedAt));
        }
      } else {
        setLiveElapsedMs(job.elapsedMs || 0);
      }
    };

    updateTimer();
    const timer = setInterval(updateTimer, 500);
    return () => clearInterval(timer);
  }, [job.startedAt, job.completedAt, job.elapsedMs]);

  const stages = [
    { key: 'queued', label: 'تحلیل ساختار سند' },
    { key: 'extracting', label: 'استخراج متون و اشکال' },
    { key: 'translating', label: 'ترجمه هوشمند به فارسی' },
    { key: 'reconstructing', label: 'بازسازی و چیدمان RTL' },
    { key: 'validation', label: 'اعتبارسنجی مستقل ساختار' },
  ];

  const getStageStatus = (stageKey: string) => {
    const stageOrder = ['queued', 'extracting', 'translating', 'reconstructing', 'validation', 'completed'];
    const currentIdx = stageOrder.indexOf(job.currentStage === 'idle' ? job.status : job.currentStage);
    const thisIdx = stageOrder.indexOf(stageKey);

    if (thisIdx < currentIdx) return 'done';
    if (thisIdx === currentIdx) return 'active';
    return 'pending';
  };

  const formatDuration = (ms: number): string => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins === 0) return `${secs} ثانیه`;
    return `${mins} دقیقه و ${secs} ثانیه`;
  };

  const itemLabel = job.documentType === 'pptx' ? 'اسلاید' : 'صفحه';

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Status Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl relative overflow-hidden">
        {/* Glowing backdrop */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-lg max-w-xs sm:max-w-md truncate" dir="ltr">
                  {job.originalFileName}
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                  {job.documentType}
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span className="font-medium text-slate-300">
                  {job.currentStage === 'translating'
                    ? `ترجمه متون: ${job.processedItems} از ${job.totalItems} ${itemLabel}`
                    : job.currentStage === 'reconstructing'
                    ? `بازسازی گرافیکی RTL: ${itemLabel} ${job.processedItems} از ${job.totalItems}`
                    : job.currentStage === 'validation'
                    ? `صحت‌سنجی نهایی صفحات (${job.totalItems || job.manifest?.inputCount || 170} ${itemLabel})`
                    : job.totalItems > 0
                    ? `${itemLabel} ${job.processedItems} از ${job.totalItems}`
                    : 'در حال خواندن مشخصات سند...'}
                </span>
                {job.lastHeartbeatAt && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                    <Activity className="w-3 h-3 animate-pulse" />
                    <span>موتور فعال</span>
                  </span>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCancelModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
          >
            <StopCircle className="w-3.5 h-3.5" />
            <span>لغو عملیات</span>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-semibold">{job.currentOperation || 'در حال پردازش...'}</span>
            <span className="font-mono font-bold text-indigo-400 text-sm">{job.progress}%</span>
          </div>

          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/50">
            <div
              className="h-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-amber-500 rounded-full transition-all duration-300 ease-out shadow-sm"
              style={{ width: `${Math.max(4, Math.min(100, job.progress))}%` }}
            ></div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>زمان سپری‌شده: {formatDuration(liveElapsedMs)}</span>
            </div>
            {job.estimatedRemainingMs !== undefined && job.estimatedRemainingMs > 0 && (
              <div>
                <span>زمان تخمینی باقی‌مانده: ~{formatDuration(job.estimatedRemainingMs)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Stepper */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
          {stages.map((st, idx) => {
            const status = getStageStatus(st.key);
            return (
              <div
                key={st.key}
                className={`p-2.5 rounded-xl border text-center transition-all ${
                  status === 'done'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : status === 'active'
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300 ring-1 ring-indigo-500/30'
                    : 'bg-slate-800/40 border-slate-800 text-slate-500'
                }`}
              >
                <div className="flex items-center justify-center gap-1 mb-1">
                  {status === 'done' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  ) : status === 'active' ? (
                    <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-slate-600 inline-block text-[9px] leading-3 text-slate-500 font-mono">
                      {idx + 1}
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-bold line-clamp-2 leading-tight">{st.label}</div>
              </div>
            );
          })}
        </div>

        {/* Live Debug Logs Dropdown */}
        <div className="pt-2 border-t border-slate-800">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>لاگ‌های ساختاریافته موتور DocuShift ({job.debugLogs?.length || 0} مورد)</span>
            </span>
            {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showLogs && (
            <div className="mt-3 p-3 rounded-xl bg-black/60 border border-slate-800 max-h-56 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1.5 select-text" dir="ltr">
              {job.debugLogs && job.debugLogs.length > 0 ? (
                job.debugLogs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2 hover:bg-slate-800/30 px-1 rounded">
                    <span className="text-slate-500 text-[10px] shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`font-semibold shrink-0 text-[10px] ${
                        log.level === 'error'
                          ? 'text-rose-400'
                          : log.level === 'warn'
                          ? 'text-amber-400'
                          : log.tag === 'JOB_HEARTBEAT'
                          ? 'text-slate-500'
                          : 'text-indigo-400'
                      }`}
                    >
                      [{log.tag}]
                    </span>
                    <span className="text-slate-300 break-all">{log.message}</span>
                  </div>
                ))
              ) : (
                <div className="text-slate-500 text-center py-2">در حال دریافت رویدادها...</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-base text-white">آیا از لغو ترجمه اطمینان دارید؟</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              با لغو عملیات، فرآیند در همین مرحله متوقف می‌شود و پیشرفت جاری ذخیره می‌گردد.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                ادامه پردازش
              </button>
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  onCancel();
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
              >
                بله، لغو شود
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
