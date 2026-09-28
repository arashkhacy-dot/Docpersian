import React, { useState } from 'react';
import {
  Download,
  CheckCircle,
  AlertTriangle,
  FileCheck,
  RefreshCw,
  BarChart2,
  ShieldCheck,
  Eye,
  Loader2,
  FileText,
  Copy,
  Check,
  Presentation,
  Zap,
} from 'lucide-react';
import { JobState } from '../types/job';
import { triggerDirectDownload } from '../utils/fileDownloader';
import { DocumentPreviewModal } from './DocumentPreviewModal';

interface CompletionCardProps {
  job: JobState;
  onReset: () => void;
  onViewReport: () => void;
}

export const CompletionCard: React.FC<CompletionCardProps> = ({ job, onReset, onViewReport }) => {
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedPage, setSelectedPage] = useState<number | 'all'>('all');

  const isWarnings = job.status === 'completed_with_warnings';
  const report = job.qualityReport;

  const isPptx =
    job.originalFileName.toLowerCase().endsWith('.pptx') ||
    job.outputFileName.toLowerCase().endsWith('.pptx');
  const isDocx =
    job.originalFileName.toLowerCase().endsWith('.docx') ||
    job.outputFileName.toLowerCase().endsWith('.docx');
  const isPdf =
    job.originalFileName.toLowerCase().endsWith('.pdf') ||
    job.outputFileName.toLowerCase().endsWith('.pdf');

  const unitLabel = isPptx ? 'اسلاید' : 'صفحه';

  const baseName = job.outputFileName.replace(/\.(txt|docx|pdf|pptx)$/i, '');

  const handleInstantDownload = (format: 'pptx' | 'pdf' | 'docx' | 'txt') => {
    setDownloadError(null);
    const targetName = `${baseName}_FA.${format}`;
    try {
      triggerDirectDownload(job.jobId, targetName, format);
      setDownloadSuccess(`دانلود مستقیم و پرسرعت فایل (${format.toUpperCase()}) آغاز گردید. لطفاً نوار اعلان بالای گوشی یا بخش دانلودهای مرورگر را بررسی فرمایید.`);
      setTimeout(() => setDownloadSuccess(null), 7000);
    } catch (err: any) {
      setDownloadError(err?.message || 'خطا در برقراری ارتباط با دانلودر مرورگر.');
    }
  };

  const pageTranslations = job.pageTranslations || [];

  const handleCopyText = () => {
    let textToCopy = job.translatedText;
    if (!textToCopy && pageTranslations.length > 0) {
      textToCopy = pageTranslations
        .map((p) => `--- ${unitLabel} ${p.pageNumber} ---\n${p.translatedText}`)
        .join('\n\n');
    }

    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {showPreviewModal && (
        <DocumentPreviewModal job={job} onClose={() => setShowPreviewModal(false)} />
      )}

      {/* Success Banner */}
      <div
        className={`border rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl relative overflow-hidden ${
          isWarnings
            ? 'bg-amber-950/20 border-amber-500/30'
            : 'bg-emerald-950/20 border-emerald-500/30'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`p-3.5 rounded-2xl ${
                isWarnings
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {isWarnings ? <AlertTriangle className="w-8 h-8" /> : <CheckCircle className="w-8 h-8" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  {isPptx
                    ? 'ترجمه و بازسازی کامل اسلایدهای پاورپوینت با موفقیت انجام شد'
                    : isWarnings
                    ? 'ترجمه کامل و استخراج هوشمند با موفقیت انجام شد'
                    : 'ترجمه کامل سند با موفقیت ۱۰۰٪ استخراج و انجام گردید'}
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">
                {isPptx
                  ? 'تمامی اسلایدها با چیدمان راست‌به‌چپ (RTL)، حفظ کامل تصاویر و نمودارها ترجمه شدند و لینک‌های دانلود مستقیم پرسرعت آماده دریافت هستند.'
                  : 'متن تمام صفحات با دقت استخراج، ترجمه و آماده استفاده در قالب فایل بازسازی‌شده، Word و فایل متنی شد.'}
              </p>
            </div>
          </div>
        </div>

        {/* Big Action Download Buttons (Instant Native Downloads) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <span className="text-xs font-semibold text-slate-400">نام فایل مبدأ:</span>
              <span className="text-sm font-bold text-white mr-2" dir="ltr">
                {job.originalFileName}
              </span>
            </div>
            <div className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>
                تعداد {unitLabel}‌ها: {job.totalItems} | کلمات ترجمه‌شده: {job.totalWords.toLocaleString('fa-IR')}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 1. Primary Native Format Download Link */}
            {isPptx && (
              <a
                href={`/api/jobs/${job.jobId}/download?format=pptx`}
                download={`${baseName}_FA.pptx`}
                target="_self"
                onClick={() => {
                  setDownloadSuccess('دانلود فایل پاورپوینت (PPTX) آغاز شد.');
                  setTimeout(() => setDownloadSuccess(null), 5000);
                }}
                className="col-span-1 sm:col-span-1 inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-gradient-to-r from-amber-600 via-orange-500 to-amber-500 hover:from-amber-500 hover:to-orange-400 text-white font-black text-xs sm:text-sm shadow-lg shadow-amber-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center"
              >
                <Presentation className="w-5 h-5 shrink-0" />
                <span>دانلود مستقیم پاورپوینت (PPTX)</span>
              </a>
            )}

            {isPdf && (
              <a
                href={`/api/jobs/${job.jobId}/download?format=pdf`}
                download={`${baseName}_FA.pdf`}
                target="_self"
                onClick={() => {
                  setDownloadSuccess('دانلود مستقیم فایل PDF آغاز شد.');
                  setTimeout(() => setDownloadSuccess(null), 5000);
                }}
                className="col-span-1 sm:col-span-1 inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-white font-black text-xs sm:text-sm shadow-lg shadow-rose-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center"
              >
                <FileText className="w-5 h-5 shrink-0" />
                <span>دانلود مستقیم PDF بازسازی‌شده</span>
              </a>
            )}

            {isDocx && (
              <a
                href={`/api/jobs/${job.jobId}/download?format=docx`}
                download={`${baseName}_FA.docx`}
                target="_self"
                onClick={() => {
                  setDownloadSuccess('دانلود فایل Word (DOCX) آغاز شد.');
                  setTimeout(() => setDownloadSuccess(null), 5000);
                }}
                className="col-span-1 sm:col-span-1 inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-blue-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center"
              >
                <FileCheck className="w-5 h-5 shrink-0" />
                <span>دانلود مستقیم فایل Word (DOCX)</span>
              </a>
            )}

            {/* 2. Companion Word (DOCX) Button (if not already docx) */}
            {!isDocx && (
              <a
                href={`/api/jobs/${job.jobId}/download?format=docx`}
                download={`${baseName}_FA.docx`}
                target="_self"
                onClick={() => {
                  setDownloadSuccess('دانلود فایل Word (DOCX) آغاز شد.');
                  setTimeout(() => setDownloadSuccess(null), 5000);
                }}
                className="col-span-1 sm:col-span-1 inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-blue-600/25 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center"
              >
                <FileCheck className="w-5 h-5 shrink-0" />
                <span>دانلود فایل Word (DOCX راست‌به‌چپ)</span>
              </a>
            )}

            {/* 3. Companion Text (TXT) Button */}
            <a
              href={`/api/jobs/${job.jobId}/download?format=txt`}
              download={`${baseName}_FA.txt`}
              target="_self"
              onClick={() => {
                setDownloadSuccess('دانلود فایل متنی (TXT) آغاز شد.');
                setTimeout(() => setDownloadSuccess(null), 5000);
              }}
              className={`col-span-1 sm:col-span-1 inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl ${
                isDocx ? 'sm:col-span-2' : ''
              } bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-600/25 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center`}
            >
              <FileText className="w-5 h-5 shrink-0" />
              <span>دانلود فایل متنی تفکیک‌شده (TXT)</span>
            </a>
          </div>

          <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 text-emerald-400">
              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              دانلودها با پشتیبانی از پروتکل پرسرعت HTTP Range و بدون محدودیت حافظه مرورگر آغاز می‌شوند.
            </span>
          </div>
        </div>

        {/* Download Feedback Messages */}
        {downloadSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2.5 animate-fadeIn">
            <CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
            <span>{downloadSuccess}</span>
          </div>
        )}

        {downloadError && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>وضعیت دانلود:</span>
            </div>
            <p className="text-slate-300 text-[11px]">{downloadError}</p>
          </div>
        )}

        {/* Embedded Interactive Persian Document Reader */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl">
          <div className="p-4 bg-slate-800/80 border-b border-slate-700/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              <h3 className="font-bold text-white text-sm">
                متن کامل ترجمه فارسی ({isPptx ? 'استخراج تفکیک‌شده اسلایدها' : 'استخراج هوشمند و خوانا'})
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'کپی شد!' : 'کپی کل متن'}</span>
              </button>
            </div>
          </div>

          {/* Page/Slide Tabs */}
          {pageTranslations.length > 1 && (
            <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto text-xs">
              <button
                onClick={() => setSelectedPage('all')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  selectedPage === 'all'
                    ? 'bg-emerald-500 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                همه {unitLabel}‌ها ({pageTranslations.length})
              </button>
              {pageTranslations.map((p) => (
                <button
                  key={p.pageNumber}
                  onClick={() => setSelectedPage(p.pageNumber)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                    selectedPage === p.pageNumber
                      ? 'bg-emerald-500 text-white font-bold'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {unitLabel} {p.pageNumber}
                </button>
              ))}
            </div>
          )}

          {/* Text View Content */}
          <div
            className="p-5 max-h-96 overflow-y-auto space-y-6 text-right font-sans text-slate-200 text-sm leading-relaxed"
            dir="rtl"
          >
            {pageTranslations.length > 0 ? (
              pageTranslations
                .filter((p) => selectedPage === 'all' || selectedPage === p.pageNumber)
                .map((pt) => (
                  <div
                    key={pt.pageNumber}
                    className="space-y-2 border-b border-slate-800/80 pb-4 last:border-0 last:pb-0"
                  >
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-emerald-400 text-xs font-bold">
                      <span>
                        {unitLabel} {pt.pageNumber}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap font-sans text-slate-100 leading-relaxed select-text bg-slate-950/50 p-4 rounded-xl border border-slate-800/50">
                      {pt.translatedText || pt.text}
                    </div>
                  </div>
                ))
            ) : (
              <div className="whitespace-pre-wrap font-sans text-slate-100 leading-relaxed select-text bg-slate-950/50 p-4 rounded-xl border border-slate-800/50">
                {job.translatedText || 'در حال آماده‌سازی متن...'}
              </div>
            )}
          </div>
        </div>

        {/* Quality Audit Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-1">
            <span className="text-[11px] text-slate-400 font-medium">تطابق تعداد {unitLabel}‌ها</span>
            <div className="font-bold text-sm text-emerald-400 flex items-center justify-center gap-1 font-mono">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {report?.originalCount || job.totalItems} / {report?.outputCount || job.totalItems}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-1">
            <span className="text-[11px] text-slate-400 font-medium">کلمات ترجمه‌شده</span>
            <div className="font-bold text-sm text-white font-mono">
              {job.totalWords.toLocaleString('fa-IR')} کلمه
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-1">
            <span className="text-[11px] text-slate-400 font-medium">فرمت‌های خروجی</span>
            <div className="font-bold text-xs sm:text-sm text-emerald-400">
              {isPptx ? 'پاورپوینت، Word و متنی' : isDocx ? 'Word و متنی UTF-8' : 'PDF، Word و متنی'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-1">
            <span className="text-[11px] text-slate-400 font-medium">پروتکل دانلود</span>
            <div className="font-bold text-xs sm:text-sm text-indigo-400">Range 206 چندرشته‌ای ✓</div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <button
            onClick={onViewReport}
            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
          >
            <BarChart2 className="w-4 h-4" />
            <span>مشاهده مانیفست کامل صفحات و گزارش فنی کیفیت</span>
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>ترجمه یک سند دیگر</span>
          </button>
        </div>
      </div>
    </div>
  );
};
