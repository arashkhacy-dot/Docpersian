import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  Presentation,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  HardDriveUpload,
  Link2,
  CloudDownload,
  Sparkles,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { UploadProgressInfo } from '../utils/chunkedUploader';

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  onImportUrl: (url: string) => Promise<void>;
  isUploading: boolean;
  uploadProgress?: UploadProgressInfo | null;
  onCancelUpload?: () => void;
}

export const UploadZone: React.FC<UploadZoneProps> = ({
  onFileSelect,
  onImportUrl,
  isUploading,
  uploadProgress,
  onCancelUpload,
}) => {
  const [activeTab, setActiveTab] = useState<'device' | 'cloud'>('device');
  const [cloudUrl, setCloudUrl] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allowedExtensions = ['.pdf', '.docx', '.pptx'];
  const maxSizeBytes = 1024 * 1024 * 1024; // 1GB (1024MB) Maximum Capacity

  const validateAndSetFile = (file: File) => {
    setError(null);
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const isKnownExt = allowedExtensions.includes(ext);
    const isKnownMime = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.ms-powerpoint',
    ].includes(file.type);

    if (!isKnownExt && !isKnownMime) {
      setError('قالب فایل مجاز نیست. لطفاً یکی از فرمت‌های PDF، DOCX یا PPTX را انتخاب نمایید.');
      setSelectedFile(null);
      return;
    }

    if (file.size > maxSizeBytes) {
      setError('حجم فایل انتخاب شده بیش از حد مجاز (حداکثر ۱ گیگابایت) می‌باشد.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleCloudSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = cloudUrl.trim();
    if (!trimmed) {
      setError('لطفاً آدرس لینک فایل یا گوگل درایو را وارد نمایید.');
      return;
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setError('آدرس لینک باید با http:// یا https:// آغاز شود.');
      return;
    }

    onImportUrl(trimmed);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' بایت';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' کیلوبایت';
    return (bytes / (1024 * 1024)).toFixed(2) + ' مگابایت';
  };

  const getFormatIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <FileText className="w-8 h-8 text-rose-400" />;
    if (ext === 'docx') return <FileSpreadsheet className="w-8 h-8 text-blue-400" />;
    if (ext === 'pptx') return <Presentation className="w-8 h-8 text-amber-400" />;
    return <FileText className="w-8 h-8 text-slate-400" />;
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Hero Headline */}
      <div className="text-center space-y-3">
        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
          ترجمه تخصصی اسناد به فارسی
        </h1>
        <p className="text-slate-400 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
          سند خود را آپلود کنید یا لینک گوگل درایو را قرار دهید؛ موتور هوشمند{' '}
          <span className="text-indigo-400 font-semibold">DocuShift</span> متن را به فارسی روان برمی‌گرداند و
          قالب، چیدمان، تصاویر و تعداد صفحات را دست‌نخورده نگه می‌دارد.
        </p>
      </div>

      {/* Tabs Selector: Device Upload vs Cloud / Google Drive */}
      <div className="flex items-center justify-center p-1 bg-slate-900/80 border border-slate-800 rounded-2xl max-w-md mx-auto">
        <button
          type="button"
          onClick={() => {
            setActiveTab('device');
            setError(null);
          }}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 ${
            activeTab === 'device'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          <span>آپلود فایل از دستگاه</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('cloud');
            setError(null);
          }}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 relative ${
            activeTab === 'cloud'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CloudDownload className="w-4 h-4 text-emerald-300" />
          <span>گوگل درایو / لینک ابری</span>
          <span className="hidden sm:inline-block text-[10px] bg-emerald-400/20 text-emerald-300 px-1.5 py-0.5 rounded-full font-medium border border-emerald-400/30">
            فوق‌سریع
          </span>
        </button>
      </div>

      {/* Tab 1: Upload from device */}
      {activeTab === 'device' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 ${
              dragActive
                ? 'border-indigo-500 bg-indigo-500/10 scale-[1.01]'
                : selectedFile
                ? 'border-emerald-500/50 bg-emerald-500/5'
                : 'border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-800/40'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.ms-powerpoint"
              onChange={handleChange}
              className="hidden"
              disabled={isUploading}
            />

            {selectedFile ? (
              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700 shadow-md">
                  {getFormatIcon(selectedFile.name)}
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-lg text-white max-w-md truncate" dir="ltr">
                    {selectedFile.name}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">{formatFileSize(selectedFile.size)}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  فایل آماده پردازش است (کلیک برای تغییر)
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-bold text-white">
                    فایل سند را به اینجا بکشید یا برای انتخاب کلیک کنید
                  </p>
                  <p className="text-xs text-slate-400">
                    پشتیبانی از فایل‌های سنگین PDF، Word (DOCX) و PowerPoint (PPTX) تا ۱ گیگابایت (با سیستم ارسال قطعه‌ای هوشمند)
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                    PDF
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                    DOCX
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                    PPTX سنگین
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Live Chunked Upload Progress Card */}
          {isUploading && uploadProgress && (
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-indigo-500/30 shadow-xl space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-indigo-300 font-semibold">
                  {uploadProgress.isDirect ? (
                    <Zap className="w-4 h-4 text-amber-400 animate-pulse" />
                  ) : (
                    <HardDriveUpload className="w-4 h-4 animate-bounce text-indigo-400" />
                  )}
                  <span>
                    {uploadProgress.isDirect || uploadProgress.totalChunks <= 1
                      ? 'ارسال مستقیم و پرسرعت به سرور (Turbo Direct)'
                      : `ارسال قطعه ${uploadProgress.currentChunk} از ${uploadProgress.totalChunks}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {uploadProgress.speedFormatted && (
                    <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded-md font-mono text-[11px] font-bold flex items-center gap-1">
                      <Zap className="w-3 h-3 text-emerald-400" />
                      <span>{uploadProgress.speedFormatted}</span>
                    </span>
                  )}
                  <span className="font-mono font-bold text-white text-sm">{uploadProgress.percent}%</span>
                </div>
              </div>

              {/* Progress track */}
              <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden p-0.5 border border-slate-700/50">
                <div
                  className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                <span>
                  {formatFileSize(uploadProgress.uploadedBytes)} از {formatFileSize(uploadProgress.totalBytes)} ارسال شد
                  {uploadProgress.statusMessage && (
                    <span className="text-amber-400 font-semibold mr-2">
                      • {uploadProgress.statusMessage}
                    </span>
                  )}
                </span>
                <span className="text-emerald-400 flex items-center gap-1 shrink-0 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  اتصال بهینه پرسرعت
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons: Start and Cancel */}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={!selectedFile || isUploading}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (selectedFile) onFileSelect(selectedFile);
              }}
              className={`flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg ${
                isUploading
                  ? 'bg-indigo-600/80 text-white shadow-indigo-600/40 cursor-wait'
                  : selectedFile
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-indigo-600/30 hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed shadow-none'
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>
                    {uploadProgress && uploadProgress.percent < 99
                      ? uploadProgress.speedFormatted
                        ? `در حال ارسال (${uploadProgress.speedFormatted} - ${uploadProgress.percent}٪)...`
                        : `در حال ارسال (${uploadProgress.percent}٪)...`
                      : 'در حال اعتبارسنجی سند و ورود به میزکار...'}
                  </span>
                </>
              ) : uploadProgress && uploadProgress.percent > 0 ? (
                <>
                  <span>
                    ادامه ارسال سند از قطعه {uploadProgress.currentChunk} ({uploadProgress.percent}٪ از قبل در سرور موجود است)
                  </span>
                  <ArrowLeft className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>شروع فرآیند ترجمه و بازسازی سند</span>
                  <ArrowLeft className="w-4 h-4" />
                </>
              )}
            </button>

            {isUploading && onCancelUpload && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onCancelUpload();
                }}
                className="px-4 py-3.5 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all cursor-pointer"
              >
                لغو ارسال
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Google Drive & Cloud Import (The high-speed cloud solution) */}
      {activeTab === 'cloud' && (
        <form onSubmit={handleCloudSubmit} className="space-y-6 animate-in fade-in duration-200">
          <div className="border border-emerald-500/30 bg-slate-900/60 rounded-2xl p-6 sm:p-8 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <CloudDownload className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>دریافت فوق‌سریع از گوگل درایو یا فضای ابری</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    بدون مصرف اینترنت همراه شما
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  سرور برنامه مستقیماً در دیتاسنتر گوگل با پهنای باند گیگابیتی فایل را دریافت و ترجمه می‌کند.
                </p>
              </div>
            </div>

            {/* URL Input */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>آدرس لینک فایل یا گوگل درایو (Google Drive Share Link):</span>
                <span className="text-[11px] text-slate-400">PDF, DOCX, PPTX, Google Slides</span>
              </label>

              <div className="relative">
                <input
                  type="url"
                  dir="ltr"
                  value={cloudUrl}
                  onChange={(e) => setCloudUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/... یا لینک فایل"
                  disabled={isUploading}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-4 py-3 pl-10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
                />
                <Link2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              </div>
            </div>

            {/* Guidance Pills */}
            <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/60 space-y-2 text-[11px] text-slate-300 leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                <Sparkles className="w-3.5 h-3.5" />
                <span>نحوه دریافت آسان از Google Drive:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-400 pr-1">
                <li>
                  فایل خود را در <span className="text-slate-200">گوگل درایو</span> آپلود کرده، روی دکمه{' '}
                  <strong className="text-slate-200">Share</strong> کلیک کنید.
                </li>
                <li>
                  دسترسی را روی <strong className="text-emerald-300">«Anyone with the link»</strong> قرار داده و دکمه <strong className="text-slate-200">Copy link</strong> را بزنید.
                </li>
                <li>لینک کپی‌شده را در کادر بالا قرار دهید؛ سرور ظرف ۲ ثانیه فایل را از درایو برمی‌دارد.</li>
                <li>پشتیبانی از لینک‌های مستقیم دراپ‌باکس (Dropbox) و وان‌درایو نیز فراهم است.</li>
              </ul>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Cloud URL Button */}
          <div className="flex justify-center">
            <button
              type="submit"
              disabled={!cloudUrl.trim() || isUploading}
              className={`flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg ${
                isUploading
                  ? 'bg-emerald-600/80 text-white shadow-emerald-600/40 cursor-wait'
                  : cloudUrl.trim()
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-emerald-600/30 hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed shadow-none'
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>سرور در حال دریافت مستقیم فایل با پهنای باند ابری...</span>
                </>
              ) : (
                <>
                  <span>دریافت ابری پرسرعت و آغاز فرآیند ترجمه</span>
                  <ArrowLeft className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Guarantees Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 border-t border-slate-800">
        <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>حفظ ۱۰۰٪ تعداد صفحات</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            تعداد صفحات ورودی و خروجی دقیقاً برابر بوده و صفحات گرافیکی یا بدون متن حذف نمی‌شوند.
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>تنظیم راست‌به‌چپ (RTL)</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            ساختار و جهت پاراگراف‌ها با فونت فارسی و سازگاری با مایکروسافت ورد و ادوبی ریدر چیده می‌شود.
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>حفظ فرمول‌ها، ارقام و جداول</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            معادلات ریاضی، کدهای فنی، پیوندها و شماره‌ها بدون تغییر در جایگاه خود باقی می‌مانند.
          </p>
        </div>
      </div>
    </div>
  );
};
