import React, { useState, useEffect } from 'react';
import { Cpu, Server, Sparkles, CheckCircle2, AlertTriangle, RefreshCw, Zap, Shield, Image, Bookmark, RotateCcw } from 'lucide-react';

interface EngineSettings {
  engine: 'gemini' | 'local';
  localUrl: string;
  localModel: string;
  geminiModel: string;
  geminiAvailable: boolean;
  diagramInpainting?: boolean;
}

interface EngineSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EngineSettingsModal: React.FC<EngineSettingsModalProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<EngineSettings>({
    engine: 'gemini',
    localUrl: 'http://localhost:11434/v1',
    localModel: 'qwen2.5-vl:3b',
    geminiModel: 'gemini-3.1-flash-lite',
    geminiAvailable: true,
    diagramInpainting: true,
  });

  const [selectedEngine, setSelectedEngine] = useState<'gemini' | 'local'>('gemini');
  const [localUrl, setLocalUrl] = useState('http://localhost:11434/v1');
  const [localModel, setLocalModel] = useState('qwen2.5-vl:3b');
  const [diagramInpainting, setDiagramInpainting] = useState<boolean>(true);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    models?: string[];
    error?: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/settings/engine')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setSettings(data);
          setSelectedEngine(data.engine || 'gemini');
          setLocalUrl(data.localUrl || 'http://localhost:11434/v1');
          setLocalModel(data.localModel || 'qwen2.5-vl:3b');
          setDiagramInpainting(data.diagramInpainting !== false);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localUrl, localModel }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        error: err?.message || 'خطا در برقراری ارتباط با سرور محلی',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/settings/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: selectedEngine,
          localUrl,
          localModel,
          diagramInpainting,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        setSaveSuccess(true);
        setTimeout(() => {
          setSaveSuccess(false);
          onClose();
        }, 1200);
      }
    } catch {
      // Error handling
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#121826] border border-slate-700/80 rounded-2xl max-w-2xl w-full p-6 text-slate-200 shadow-2xl relative max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                انتخاب موتور هوش مصنوعی و ترجمه
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-normal">
                  سریع و بدون چت
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                مقایسه و انتخاب بین موتور ابری گوگل جمنای و سرور شخصی مستقل (Ollama / vLLM)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Engine Selection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
          {/* Option 1: Google Gemini */}
          <div
            onClick={() => setSelectedEngine('gemini')}
            className={`p-4 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
              selectedEngine === 'gemini'
                ? 'bg-gradient-to-b from-indigo-950/60 to-slate-900 border-indigo-500 shadow-lg shadow-indigo-500/10'
                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            {selectedEngine === 'gemini' && (
              <span className="absolute top-3 left-3 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
            )}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-sm">گوگل جمنای (Cloud API)</h3>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                  پیش‌فرض برتر
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                بهترین کیفیت ترجمه تخصصی فارسی، بینایی ماشین بی‌نقص (OCR تصاویر و جداول)، سرعت پردازش فوق‌سریع و بدون نیاز به سخت‌افزار سنگین یا GPU.
              </p>
              <ul className="text-[11px] text-slate-400 space-y-1 mb-4">
                <li className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  بدون نیاز به نصب، راه‌اندازی یا منابع سرور
                </li>
                <li className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  دقت ۱۰۰٪ در ترجمه متون فنی، مهندسی و اسناد
                </li>
                <li className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  مدل اختصاصی: Gemini 3.1 Flash Lite / 3.8 Flash
                </li>
              </ul>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>وضعیت: {settings.geminiAvailable ? 'آماده و متصل ✅' : 'نیاز به API Key'}</span>
            </div>
          </div>

          {/* Option 2: Local Self-Hosted */}
          <div
            onClick={() => setSelectedEngine('local')}
            className={`p-4 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
              selectedEngine === 'local'
                ? 'bg-gradient-to-b from-indigo-950/60 to-slate-900 border-indigo-500 shadow-lg shadow-indigo-500/10'
                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            {selectedEngine === 'local' && (
              <span className="absolute top-3 left-3 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
            )}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-sm">سرور شخصی مستقل (Ollama / Local)</h3>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                  آفلاین ۱۰۰٪
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                اجرای کاملاً مستقل روی سرور شخصی شما بدون وابستگی به هیچ شرکت خارجی. حفظ ۱۰۰٪ محرمانگی اطلاعات.
              </p>
              <ul className="text-[11px] text-slate-400 space-y-1 mb-4">
                <li className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  مدل پیشنهادی فوق سبک: <strong className="text-white">Qwen2.5-VL (3B)</strong>
                </li>
                <li className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  دارای قابلیت بینایی تصویر (Vision) برای متون عکس
                </li>
                <li className="flex items-center gap-1.5 text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  نیازمند حداقل ۴ گیگابایت رم در سرور
                </li>
              </ul>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>بدون چت، فقط ترجمه ساختاری مستقیم</span>
            </div>
          </div>
        </div>

        {/* Local Configuration Details (Visible if Local is selected) */}
        {selectedEngine === 'local' && (
          <div className="p-4 bg-slate-900/90 rounded-xl border border-slate-800 space-y-3 mb-5 animate-fadeIn">
            <h4 className="text-xs font-bold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              تنظیمات اتصال به سرور محلی Ollama یا vLLM
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-mono text-[11px]">آدرس API سرور محلی (URL)</label>
                <input
                  type="text"
                  value={localUrl}
                  onChange={(e) => setLocalUrl(e.target.value)}
                  dir="ltr"
                  placeholder="http://localhost:11434/v1"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-mono text-[11px]">نام مدل نصب‌شده (Model Name)</label>
                <input
                  type="text"
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  dir="ltr"
                  placeholder="qwen2.5-vl:3b"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between pt-2 gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition"
              >
                {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                تست اتصال به سرور محلی
              </button>

              {testResult && (
                <div
                  className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}
                >
                  {testResult.success ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      اتصال موفق ({testResult.latencyMs}ms)
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {testResult.error || 'خطا در اتصال'}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Quick Helper for user's VPS */}
            <div className="mt-2 p-2.5 bg-slate-950/80 rounded-lg border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed font-mono">
              <span className="text-indigo-400 font-bold">دستور نصب مدل‌های ویژن یا سبک در سرور شخصی:</span>
              <div className="mt-1 bg-black/60 p-2 rounded text-emerald-300 select-all overflow-x-auto">
                ollama run llama3.2-vision
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                یا برای متن‌های فوق‌سریع: <code className="text-indigo-300">ollama run qwen2.5:3b</code>
              </div>
            </div>
          </div>
        )}

        {/* Feature: Diagram & Image Text Inpainting */}
        <div className="p-4 bg-slate-900/90 rounded-xl border border-slate-800 space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Image className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-2">
                  جایگزینی هوشمند متون روی عکس و دیاگرام (Inpainting)
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-normal">
                    نسخه جدید
                  </span>
                </h4>
                <p className="text-[11px] text-slate-400">
                  تشخیص هوشمند برچسب‌های متنی روی فلوچارت‌ها، نمودارها و تصاویر فنی و جایگزینی مستقیم با فونت فارسی
                </p>
              </div>
            </div>
            {/* Toggle switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={diagramInpainting}
                onChange={(e) => setDiagramInpainting(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-slate-400">
            <div className="flex items-center gap-1 text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              پوشش تمیز پس‌زمینه اصلی
            </div>
            <div className="flex items-center gap-1 text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              فونت ضخیم وزیرمتن فارسی
            </div>
            <div className="flex items-center gap-1 text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              فایل‌های PDF، پاورپوینت و ورد
            </div>
          </div>
        </div>

        {/* Checkpoint Safety Card */}
        <div className="p-3.5 bg-indigo-950/40 rounded-xl border border-indigo-900/60 mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-white">نقطه بازگشت پایدار (Checkpoint v1.0)</span>
            </div>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono">
              checkpoint-v1.0
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed mb-2">
            یک چک‌پوینت امن و مستقل از وضعیت پایدار پیش از فعال‌سازی این قابلیت ثبت شده است. در صورت تمایل به بازگشت فوری به وضعیت قبلی، دستور زیر در ترمینال سرور همواره در دسترس است:
          </p>
          <div className="bg-black/60 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-emerald-300 flex items-center justify-between select-all">
            <span>./restore_checkpoint_v1.sh</span>
            <span className="text-[10px] text-slate-500 font-sans">یا git reset --hard checkpoint-v1.0</span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span>کلیه قابلیت‌های ساختاری، جانمایی و فونت برای هر دو موتور فعال است.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
            >
              انصراف
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="text-xs px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/30 transition flex items-center gap-1.5"
            >
              {isSaving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : saveSuccess ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : null}
              {saveSuccess ? 'ذخیره شد' : 'اعمال و ذخیره موتور'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
