import React from 'react';
import { Layers, ShieldCheck, Cpu, History } from 'lucide-react';

interface HeaderProps {
  onToggleHistory: () => void;
  showHistory: boolean;
  activeCount: number;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleHistory, showHistory, activeCount, onOpenSettings }) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight text-white">DocuShift</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                موتور ترجمه اسناد
              </span>
            </div>
            <p className="text-xs text-slate-400">تغییر زبان، بدون تغییر در ساختار و تعداد صفحات</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>تضمین یکپارچگی ۱۰۰٪ صفحات</span>
          </div>

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-all border bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white"
              title="تنظیمات و انتخاب موتور ترجمه هوش مصنوعی"
            >
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span className="hidden md:inline">انتخاب موتور</span>
            </button>
          )}

          <button
            onClick={onToggleHistory}
            className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg transition-all border ${
              showHistory
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/25'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <History className="w-4 h-4" />
            <span>تاریخچه اسناد</span>
            {activeCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
