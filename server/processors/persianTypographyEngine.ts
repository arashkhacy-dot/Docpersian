/**
 * Persian Typography & Layout Engine (موتور تخصصی حروف‌چینی و پردازش تایپوگرافی فارسی)
 * 
 * Responsibilities:
 * 1. Word Healing & De-spacing: Reconnects split letters and removes accidental extra spaces
 *    (e.g., 'ا  تاق' -> 'اتاق', 'ح  یوانات' -> 'حیوانات', 'نوش  ته' -> 'نوشته', 'پ  یر' -> 'پیر').
 * 2. Proper Persian Affix & Prefix handling: 'می‌', 'نمی‌', '‌ها', '‌ترین', '‌یی'.
 * 3. Table of Contents Normalizer: Cleanly separates Title and Page Numbers with dotted leaders,
 *    preventing bidirectional flipping of titles.
 * 4. Technical Units & Table Normalizer: Preserves technical and automotive units (kg, N·m, r/min, °C, bar, psi)
 *    in natural order alongside Persian terminology without backward corruption.
 * 5. High-Clarity Typography formatting: Prepares text for crisp PDF drawing with Vazirmatn.
 */

import pkg from 'arabic-persian-reshaper';
const { PersianShaper } = pkg;

// List of known international and engineering units that must never be corrupted
export const TECHNICAL_UNITS = [
  'N·m', 'N.m', 'Nm',
  'r/min', 'rpm',
  'km/h', 'km', 'mm', 'cm', 'm',
  'kg', 'g', 'mg',
  '°C', 'C°', '°F', 'K',
  'kW', 'hp', 'W', 'mW',
  'bar', 'psi', 'kPa', 'MPa', 'Pa',
  'L', 'mL', 'cc',
  'V', 'mV', 'kV', 'A', 'mA', 'Ah', 'mAh',
  'Hz', 'kHz', 'MHz', 'GHz',
  'dB', 'dB(A)',
  'VIN', 'ISO', 'SAE', 'GB', 'QC/T',
  'ABS', 'ESP', 'EBD', 'TCS', 'SRS', 'TPMS', 'OBD', 'ECU', 'LED', 'HID',
];

/**
 * 1. Heal broken Persian words by reconnecting letters separated by stray spaces or bad line breaks.
 */
export function healPersianSpaces(text: string): string {
  if (!text) return '';
  let s = text;

  // Normalize Unicode non-breaking spaces and zero-width artifacts
  s = s.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
       .replace(/[\uFEFF\u200B\u200E\u200F]/g, '');

  // Collapse excessive spaces and tabs (2 or more)
  s = s.replace(/[ \t]{2,}/g, ' ');

  // Specific well-known split words seen in OCR, hyphenation, and PDF extractions
  const wordFixes: Array<[RegExp, string]> = [
    // Words starting with 'ا'
    [/(^|\s)ا\s+تاق(?=$|\s|[،.؛:!؟\-])/g, '$1اتاق'],
    [/(^|\s)ا\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1این'],
    [/(^|\s)ا\s+یرلند(?=$|\s|[،.؛:!؟\-])/g, '$1ایرلند'],
    [/(^|\s)ا\s+فتاد(?=$|\s|[،.؛:!؟\-])/g, '$1افتاد'],
    [/(^|\s)اف\s+تاد(?=$|\s|[،.؛:!؟\-])/g, '$1افتاد'],
    [/(^|\s)ا\s+ینکه(?=$|\s|[،.؛:!؟\-])/g, '$1اینکه'],
    [/(^|\s)ا\s+ینطور(?=$|\s|[،.؛:!؟\-])/g, '$1این‌طور'],
    [/(^|\s)ا\s+ستاندارد(?=$|\s|[،.؛:!؟\-])/g, '$1استاندارد'],
    [/(^|\s)اس\s+تاندارد(?=$|\s|[،.؛:!؟\-])/g, '$1استاندارد'],
    [/(^|\s)اس\s+تانداردها(?=$|\s|[،.؛:!؟\-])/g, '$1استانداردها'],

    // Words starting with 'پ'
    [/(^|\s)پ\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1پیر'],
    [/(^|\s)پ\s+یرم(?=$|\s|[،.؛:!؟\-])/g, '$1پیرم'],
    [/(^|\s)پ\s+یرتر(?=$|\s|[،.؛:!؟\-])/g, '$1پیرتر'],
    [/(^|\s)پ\s+یرترین(?=$|\s|[،.؛:!؟\-])/g, '$1پیرترین'],
    [/(^|\s)ب\s+یوتی(?=$|\s|[،.؛:!؟\-])/g, '$1بیوتی'],

    // Words with split 'د' / 'ت' / 'ز'
    [/(^|\s)د\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1دیر'],
    [/(^|\s)د\s+م(?=$|\s|[،.؛:!؟\-])/g, '$1دم'],
    [/(^|\s)ت\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1تیر'],
    [/(^|\s)ت\s+یرک(?=$|\s|[،.؛:!؟\-])/g, '$1تیرک'],
    [/(^|\s)ز\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1زیر'],

    // Animals and novel-specific terms
    [/(^|\s)ح\s+یوان(?=$|\s|[،.؛:!؟\-])/g, '$1حیوان'],
    [/(^|\s)ح\s+یوانی(?=$|\s|[،.؛:!؟\-])/g, '$1حیوانی'],
    [/(^|\s)ح\s+یوانات(?=$|\s|[،.؛:!؟\-])/g, '$1حیوانات'],
    [/(^|\s)کو\s+تاه(?=$|\s|[،.؛:!؟\-])/g, '$1کوتاه'],
    [/(^|\s)کو\s+چک(?=$|\s|[،.؛:!؟\-])/g, '$1کوچک'],
    [/(^|\s)مس\s+تقر(?=$|\s|[،.؛:!؟\-])/g, '$1مستقر'],
    [/(^|\s)عجی\s+بی(?=$|\s|[،.؛:!؟\-])/g, '$1عجیبی'],
    [/(^|\s)عجی\s+ب(?=$|\s|[،.؛:!؟\-])/g, '$1عجیب'],
    [/(^|\s)ما\s+یل(?=$|\s|[،.؛:!؟\-])/g, '$1مایل'],
    [/(^|\s)سا\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1سایر'],
    [/(^|\s)آو\s+یزان(?=$|\s|[،.؛:!؟\-])/g, '$1آویزان'],
    [/(^|\s)الج\s+ثه(?=$|\s|[،.؛:!؟\-])/g, '$1الجثه'],
    [/(^|\s)مور\s+یل(?=$|\s|[،.؛:!؟\-])/g, '$1موریل'],
    [/(^|\s)نا\s+می(?=$|\s|[،.؛:!؟\-])/g, '$1نامی'],
    [/(^|\s)انگلس\s+تان(?=$|\s|[،.؛:!؟\-])/g, '$1انگلستان'],

    // Split suffix 'ته'
    [/(^|\s)نوش\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1نوشته'],
    [/(^|\s)آهس\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1آهسته'],
    [/(^|\s)برنگش\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1برنگشته'],
    [/(^|\s)گرف\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1گرفته'],
    [/(^|\s)نک\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1نکته'],
    [/(^|\s)بس\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1بسته'],

    // Split suffix 'ین'
    [/(^|\s)زم\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1زمین'],
    [/(^|\s)سرزم\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1سرزمین'],
    [/(^|\s)بنجام\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1بنجامین'],
    [/(^|\s)چهارم\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1چهارمین'],
    [/(^|\s)بدخلق تر\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1بدخلق‌ترین'],

    // Split suffix 'یی'
    [/(^|\s)شناسا\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1شناسایی'],
    [/(^|\s)جا\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1جایی'],
    [/(^|\s)طلای\s+ی(?=$|\s|[،.؛:!؟\-])/g, '$1طلایی'],
  ];

  for (const [regex, replacement] of wordFixes) {
    s = s.replace(regex, replacement);
  }

  // Generic single-letter stitcher:
  // Merges lone letters that were torn apart from their words (excluding independent prepositions: و, به, با, در, از, تا, یا)
  s = s.replace(/(^|\s)([پتثجچحخسشصضطظعفقکگلمنهی])\s+([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی]{2,})(?=$|\s|[،.؛:!؟\-])/g, '$1$2$3');

  // Fix affixes with clean ZWNJ
  s = s
    // Suffixes: -ترین, -تر
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+تر\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1‌ترین')
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+تر(?=$|\s|[،.؛:!؟\-])/g, '$1‌تر')
    // Suffix: -های / -ها
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+های?(?=$|\s|[،.؛:!؟\-])/g, '$1‌های')
    // Prefix: می / نمی
    .replace(/(^|\s)(ن?می)\s+([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی]{2,})/g, '$1$2‌$3');

  return s;
}

/**
 * 2. Normalizes table cell content containing technical/automotive units.
 * Ensures units like kg, N·m, r/min, °C are preserved in proper LTR order next to Persian terms.
 */
export function normalizeTableCellContent(content: string): string {
  if (!content) return '';
  let s = healPersianSpaces(content);

  // Common corrupted or reversed units from OCR/shaping:
  s = s
    .replace(/مرگولیک\s*gk/gi, 'کیلوگرم (kg)')
    .replace(/رتم\s*ن\s*تویژ\s*N[·\.]?m/gi, 'نیوتن‌متر (N·m)')
    .replace(/هقیقرد\s*رد\s*رود\s*r\/min/gi, 'دور بر دقیقه (r/min)')
    .replace(/س\s*ویلساس\s*ه\s*جرد\s*C°/gi, 'درجه سلسیوس (C°)')
    .replace(/و\s*ردوخ\s*حرش\s*[\.\-]?\s*([ا-ی\d]*)/g, '۱. شرح خودرو')
    .replace(/شرح\s*خودرو\s*[\.\-]?\s*([ا-ی\d]*)/g, '۱. شرح خودرو');

  return s;
}

/**
 * 3. Clean and format Table of Contents (TOC) entries.
 * E.g., '12 ........................... شرح خودرو' -> Title right-aligned, leader dots, page number left-aligned.
 */
export interface TocEntry {
  isToc: boolean;
  title: string;
  dots: string;
  pageNumber: string;
}

export function parseTocLine(line: string): TocEntry | null {
  if (!line) return null;
  // Match Title ...... 12
  const pattern1 = /^(.*?)\s*([\.·•\-–—]{4,})\s*(\d+|[\u06F0-\u06F9]+)\s*$/;
  const match1 = line.match(pattern1);
  if (match1) {
    const rawTitle = normalizeTableCellContent(healPersianSpaces(match1[1].trim()));
    if (rawTitle.length > 0) {
      return {
        isToc: true,
        title: rawTitle,
        dots: '................................................................',
        pageNumber: match1[3].trim(),
      };
    }
  }

  // Reverse pattern: 12 ...... Title
  const pattern2 = /^(\d+|[\u06F0-\u06F9]+)\s*([\.·•\-–—]{4,})\s*(.*?)$/;
  const match2 = line.match(pattern2);
  if (match2) {
    const rawTitle = normalizeTableCellContent(healPersianSpaces(match2[3].trim()));
    if (rawTitle.length > 0) {
      return {
        isToc: true,
        title: rawTitle,
        dots: '................................................................',
        pageNumber: match2[1].trim(),
      };
    }
  }

  return null;
}

/**
 * 4. High-fidelity shape and Bidi preparation for PDF drawing.
 * Transforms Persian into connected glyphs while protecting Latin acronyms and numbers.
 */
export function shapePersianForPdf(text: string): string {
  if (!text || !text.trim()) return '';

  // Step 1: Heal broken spaces and normalize units
  let clean = normalizeTableCellContent(text)
    .replace(/\u064A/g, '\u06CC') // Arabic Yeh -> Persian Yeh
    .replace(/\u0643/g, '\u06A9') // Arabic Kaf -> Persian Keheh
    .replace(/[\uFEFF\u200B\u200E\u200F]/g, '')
    .trim();

  const hasRtl = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(clean);
  if (!hasRtl) {
    return clean;
  }

  try {
    // Step 2: Contextual shaping of Persian letters
    let reshaped = PersianShaper.convertArabic(clean);

    // Step 3: In an RTL run, fontkit's layout flips Latin character sequences.
    // We pre-reverse Latin words so fontkit draws them in natural Left-To-Right reading order.
    reshaped = reshaped.replace(/[a-zA-Z]+/g, (match) => {
      return match.split('').reverse().join('');
    });

    return reshaped;
  } catch {
    return clean;
  }
}
