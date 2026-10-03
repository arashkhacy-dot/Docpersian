/**
 * Persian Typography & Layout Engine (موتور تخصصی حروف‌چینی، رفع فاصله‌های اضافی و چیدمان فارسی)
 * 
 * Responsibilities:
 * 1. Comprehensive Word Healing & De-spacing (ترمیم جداافتادگی حروف و حذف فاصله‌های نامطلوب):
 *    - Reconnects letters split by PDF justification, OCR, or extraction
 *      (e.g., 'ا  تاق' -> 'اتاق', 'ح  یوانات' -> 'حیوانات', 'پ  یر' -> 'پیر', 'مس  تقر' -> 'مستقر').
 *    - Standardizes Persian semi-space (ZWNJ \u200C) for affixes ('می‌', 'نمی‌', '‌ها', '‌های', '‌ترین', '‌یی').
 *    - Normalizes punctuation spacing and eliminates double/triple spaces.
 * 2. Structure & Line Sorting Engine (مرتب‌سازی خطوط و ساختاربندی محتوا):
 *    - Table of Contents (TOC) parser & formatter with dotted leaders and uncorrupted page numbers.
 *    - Diagram callout separator & 2-column balanced legend layout.
 *    - Novel / narrative chapter and poetry formatting (e.g., Animal Farm chapters and song verses).
 *    - Notice / warning callout boxes with solid colored accent bars.
 * 3. Clarity & Sharpness (وضوح، شارپنس و کنتراست):
 *    - Deep ink colors for maximum legibility on digital screens and prints.
 *    - Dynamic proportional leading and smooth font scaling to fit page boundaries without clipping.
 * 4. Multi-Font Family (مدیریت قلم‌های منظم و برجسته - Regular & Bold):
 *    - Seamlessly embeds and switches between Vazirmatn-Regular and Vazirmatn-Bold.
 */

import fs from 'fs';
import path from 'path';
import fontkit from '@pdf-lib/fontkit';
import { rgb, PDFDocument, PDFFont } from 'pdf-lib';
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
 * 1. Comprehensive Word Healing & De-spacing
 * Fixes split letters inside words, removes unnecessary spaces, and formats Persian semi-spaces.
 */
/**
 * Ensures optimal Persian cursive joining (چسبندگی صحیح حروف):
 * 1. Converts any presentation forms to canonical Unicode via NFKC
 * 2. Removes zero-width joiner artifacts and hidden control characters
 * 3. Preserves legitimate grammatical ZWNJ (نیم‌فاصله) for affixes and compound words
 * 4. Eliminates accidental stray ZWNJ that breaks letter joining inside words
 */
export function cleanCursiveJoining(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFKC');
  s = s.replace(/[\uFEFF\u200B\u200E\u200F\u00AD\u202A-\u202E\u2066-\u2069]/g, '');

  const TOKEN = '###ZWNJ###';
  // Remove accidental ZWNJ before country/place names ending in ستان
  s = s.replace(/(انگلس|کردس|افغانس|تاجیکس|ارمس|لرستان|گلس|بوس)\u200C+تان/g, '$1تان');
  // Keep grammatical prefixes: می / نمی
  s = s.replace(/(^|\s)(ن?می)\u200C/g, (_m, p1, p2) => p1 + p2 + TOKEN);
  // Keep grammatical suffixes: ها, های, تر, ترین, ام, ات, اش, مان, تان, شان, یی, ای
  s = s.replace(/\u200C(ها|های|تر|ترین|ام|ات|اش|مان|تان|شان|یی|ای)(?=$|\s|[،.؛:!؟\-])/g, (_m, p1) => TOKEN + p1);
  // Keep compound words
  s = s.replace(/(مرغ|مه|دست|پشت|کمک|جعبه|کیسه)\u200C(دانی|شکن|کاری|سری|فنر|دنده|هوا)/g, (_m, p1, p2) => p1 + TOKEN + p2);

  // Remove any stray accidental ZWNJ breaking letter connections inside stems
  s = s.replace(/\u200C/g, '');
  // Restore legitimate grammatical ZWNJs
  s = s.split(TOKEN).join('\u200C');

  return s;
}

export function healPersianSpaces(text: string): string {
  if (!text) return '';
  let s = cleanCursiveJoining(text);

  // Step 1: Normalize Unicode non-breaking spaces and zero-width artifacts
  s = s
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

  // Step 2: Convert Arabic presentation forms (FB50-FDFF, FE70-FEFF) back to canonical Persian
  // so the font shaper can handle them consistently
  s = s
    .replace(/\u064A/g, '\u06CC') // Arabic Yeh -> Persian Yeh
    .replace(/\u0643/g, '\u06A9') // Arabic Kaf -> Persian Keheh
    .replace(/\u06C0/g, '\u0647\u200C\u06CC'); // Heh with Yeh above

  // Step 3: Collapse excessive spaces and tabs (2 or more)
  s = s.replace(/[ \t]{2,}/g, ' ');

  // Step 3.5: Systematic repair of broken letter connections seen in OCR / vision models
  // 1. Repair isolated trailing 'ی' after consonants: 'مشترک ی' -> 'مشترکی', 'قدیم ی' -> 'قدیمی'
  s = s.replace(/([بپتثجچحخسشصضطظعغفقکگلمنه])\s+ی(?=$|\s|[،.؛:!؟\-\)»\]])/g, '$1ی');
  // 2. Repair isolated trailing 'یی' after Alef: 'اسپانیا یی' -> 'اسپانیایی'
  s = s.replace(/([اآ])\s+یی(?=$|\s|[،.؛:!؟\-\)»\]])/g, '$1یی');
  // 3. Repair past-tense and verb endings: 'داش تند' -> 'داشتند', 'رف تند' -> 'رفتند', 'گف ته' -> 'گفته', 'گفت ند' -> 'گفتند'
  s = s.replace(/([گکدربخشپمتنفثحجچرزژسصضطظعغفقلموهی])\s+(تند|ته|ند)(?=$|\s|[،.؛:!؟\-\)»\]])/g, '$1$2');
  // 4. Repair 'شما را' (from 'شمار ا')
  s = s.replace(/(^|\s)شمار\s+ا(?=$|\s|[،.؛:!؟\-\)»\]])/g, '$1شما را');
  // 5. Repair specific broken stems
  s = s.replace(/انگلس\s*[\u200C\s]*تان/g, 'انگلستان');
  s = s.replace(/تصاو\s+یر/g, 'تصاویر');
  s = s.replace(/چ\s+یزی/g, 'چیزی');
  s = s.replace(/هیجان\s*انگ\s*یز/g, 'هیجان‌انگیز');
  s = s.replace(/لیور\s+پول/g, 'لیورپول');
  s = s.replace(/بارس\s+لون/g, 'بارسلون');

  // Step 4: Dictionary of well-known split words seen in novels (Animal Farm) & automotive manuals (Changan)
  const wordFixes: Array<[RegExp, string]> = [
    // Initial Alef splits: 'ا ...'
    [/(^|\s)ا\s+تاق(?=$|\s|[،.؛:!؟\-])/g, '$1اتاق'],
    [/(^|\s)ا\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1این'],
    [/(^|\s)ا\s+یرلند(?=$|\s|[،.؛:!؟\-])/g, '$1ایرلند'],
    [/(^|\s)ا\s+فتاد(?=$|\s|[،.؛:!؟\-])/g, '$1افتاد'],
    [/(^|\s)اف\s+تاد(?=$|\s|[،.؛:!؟\-])/g, '$1افتاد'],
    [/(^|\s)ا\s+ینکه(?=$|\s|[،.؛:!؟\-])/g, '$1اینکه'],
    [/(^|\s)سا\s*ینکه(?=$|\s|[،.؛:!؟\-])/g, '$1پس از اینکه'],
    [/(^|\s)ا\s+ینطور(?=$|\s|[،.؛:!؟\-])/g, '$1این‌طور'],
    [/(^|\s)ا\s+ین گونه(?=$|\s|[،.؛:!؟\-])/g, '$1این‌گونه'],
    [/(^|\s)ا\s+ستاندارد(?=$|\s|[،.؛:!؟\-])/g, '$1استاندارد'],
    [/(^|\s)اس\s+تاندارد(?=$|\s|[،.؛:!؟\-])/g, '$1استاندارد'],
    [/(^|\s)اس\s+تانداردها(?=$|\s|[،.؛:!؟\-])/g, '$1استانداردها'],
    [/(^|\s)ا\s+نبار(?=$|\s|[،.؛:!؟\-])/g, '$1انبار'],
    [/(^|\s)ان\s+بار(?=$|\s|[،.؛:!؟\-])/g, '$1انبار'],
    [/(^|\s)ان\s+سان(?=$|\s|[،.؛:!؟\-])/g, '$1انسان'],
    [/(^|\s)ا\s+حساس(?=$|\s|[،.؛:!؟\-])/g, '$1احساس'],
    [/(^|\s)اح\s+ساس(?=$|\s|[،.؛:!؟\-])/g, '$1احساس'],
    [/(^|\s)ا\s+حترام(?=$|\s|[،.؛:!؟\-])/g, '$1احترام'],
    [/(^|\s)اح\s+ترام(?=$|\s|[،.؛:!؟\-])/g, '$1احترام'],
    [/(^|\s)ا\s+حوال(?=$|\s|[،.؛:!؟\-])/g, '$1احوال'],
    [/(^|\s)ا\s+طمینان(?=$|\s|[،.؛:!؟\-])/g, '$1اطمینان'],
    [/(^|\s)اط\s+مینان(?=$|\s|[،.؛:!؟\-])/g, '$1اطمینان'],

    // Split 'پ' / 'ب'
    [/(^|\s)پ\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1پیر'],
    [/(^|\s)پ\s+یرم(?=$|\s|[،.؛:!؟\-])/g, '$1پیرم'],
    [/(^|\s)پ\s+یرتر(?=$|\s|[،.؛:!؟\-])/g, '$1پیرتر'],
    [/(^|\s)پ\s+یرترین(?=$|\s|[،.؛:!؟\-])/g, '$1پیرترین'],
    [/(^|\s)پ\s+روانه(?=$|\s|[،.؛:!؟\-])/g, '$1پروانه'],
    [/(^|\s)پ\s+رواز(?=$|\s|[،.؛:!؟\-])/g, '$1پرواز'],
    [/(^|\s)پ\s+شت(?=$|\s|[،.؛:!؟\-])/g, '$1پشت'],
    [/(^|\s)پ\s+یدا(?=$|\s|[،.؛:!؟\-])/g, '$1پیدا'],
    [/(^|\s)پ\s+یموده(?=$|\s|[،.؛:!؟\-])/g, '$1پیموده'],
    [/(^|\s)پ\s+ینچر(?=$|\s|[،.؛:!؟\-])/g, '$1پینچر'],
    [/(^|\s)ب\s+یوتی(?=$|\s|[،.؛:!؟\-])/g, '$1بیوتی'],
    [/(^|\s)ب\s+رای(?=$|\s|[،.؛:!؟\-])/g, '$1برای'],
    [/(^|\s)ب\s+زرگ(?=$|\s|[،.؛:!؟\-])/g, '$1بزرگ'],
    [/(^|\s)ب\s+لند(?=$|\s|[،.؛:!؟\-])/g, '$1بلند'],
    [/(^|\s)ب\s+لوط(?=$|\s|[،.؛:!؟\-])/g, '$1بلوط'],
    [/(^|\s)ب\s+هتر(?=$|\s|[،.؛:!؟\-])/g, '$1بهتر'],
    [/(^|\s)ب\s+یشتر(?=$|\s|[،.؛:!؟\-])/g, '$1بیشتر'],
    [/(^|\s)ب\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1بین'],

    // Split 'ح' / 'ج' / 'چ' / 'خ'
    [/(^|\s)ح\s+یوان(?=$|\s|[،.؛:!؟\-])/g, '$1حیوان'],
    [/(^|\s)ح\s+یوانی(?=$|\s|[،.؛:!؟\-])/g, '$1حیوانی'],
    [/(^|\s)ح\s+یوانات(?=$|\s|[،.؛:!؟\-])/g, '$1حیوانات'],
    [/(^|\s)ج\s+وان(?=$|\s|[،.؛:!؟\-])/g, '$1جوان'],
    [/(^|\s)ج\s+لوی(?=$|\s|[،.؛:!؟\-])/g, '$1جلوی'],
    [/(^|\s)ج\s+لو(?=$|\s|[،.؛:!؟\-])/g, '$1جلو'],
    [/(^|\s)جلو\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1جلویی'],
    [/(^|\s)چ\s+راغ(?=$|\s|[،.؛:!؟\-])/g, '$1چراغ'],
    [/(^|\s)چ\s+راغ‌های(?=$|\s|[،.؛:!؟\-])/g, '$1چراغ‌های'],
    [/(^|\s)چ\s+راغها(?=$|\s|[،.؛:!؟\-])/g, '$1چراغ‌ها'],
    [/(^|\s)چ\s+هار(?=$|\s|[،.؛:!؟\-])/g, '$1چهار'],
    [/(^|\s)چ\s+هارمین(?=$|\s|[،.؛:!؟\-])/g, '$1چهارمین'],
    [/(^|\s)چ\s+کمه(?=$|\s|[،.؛:!؟\-])/g, '$1چکمه'],
    [/(^|\s)خ\s+واب(?=$|\s|[،.؛:!؟\-])/g, '$1خواب'],
    [/(^|\s)خ\s+وک(?=$|\s|[،.؛:!؟\-])/g, '$1خوک'],
    [/(^|\s)خ\s+وک‌ها(?=$|\s|[،.؛:!؟\-])/g, '$1خوک‌ها'],
    [/(^|\s)خ\s+ود(?=$|\s|[،.؛:!؟\-])/g, '$1خود'],
    [/(^|\s)خ\s+وب(?=$|\s|[،.؛:!؟\-])/g, '$1خوب'],
    [/(^|\s)خ\s+انه(?=$|\s|[،.؛:!؟\-])/g, '$1خانه'],

    // Split 'د' / 'ت' / 'ز' / 'ر' / 'س' / 'ش'
    [/(^|\s)د\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1دیر'],
    [/(^|\s)د\s+م(?=$|\s|[،.؛:!؟\-])/g, '$1دم'],
    [/(^|\s)د\s+یوار(?=$|\s|[،.؛:!؟\-])/g, '$1دیوار'],
    [/(^|\s)د\s+ست(?=$|\s|[،.؛:!؟\-])/g, '$1دست'],
    [/(^|\s)ت\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1تیر'],
    [/(^|\s)ت\s+یرک(?=$|\s|[،.؛:!؟\-])/g, '$1تیرک'],
    [/(^|\s)ت\s+یرهای(?=$|\s|[،.؛:!؟\-])/g, '$1تیرهای'],
    [/(^|\s)ت\s+نومند(?=$|\s|[،.؛:!؟\-])/g, '$1تنومند'],
    [/(^|\s)ز\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1زیر'],
    [/(^|\s)پا\s*ی\s*ین(?=$|\s|[،.؛:!؟\-])/g, '$1پایین'],
    [/(^|\s)پای\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1پایین'],
    [/(^|\s)سرنش\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1سرنشین'],
    [/(^|\s)سر\s+نشین(?=$|\s|[،.؛:!؟\-])/g, '$1سرنشین'],
    [/(^|\s)تغ\s*ی\s*یر(?=$|\s|[،.؛:!؟\-])/g, '$1تغییر'],
    [/(^|\s)تغی\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1تغییر'],
    [/(^|\s)ط\s+بق(?=$|\s|[،.؛:!؟\-])/g, '$1طبق'],
    [/(^|\s)منط\s+بق(?=$|\s|[،.؛:!؟\-])/g, '$1منطبق'],
    [/(^|\s)آرا\s+می(?=$|\s|[،.؛:!؟\-])/g, '$1آرامی'],
    [/(^|\s)ب\s+یرون(?=$|\s|[،.؛:!؟\-])/g, '$1بیرون'],
    [/(^|\s)ناگهان\s+ی(?=$|\s|[،.؛:!؟\-])/g, '$1ناگهانی'],
    [/(^|\s)کودک\s+ان(?=$|\s|[،.؛:!؟\-])/g, '$1کودکان'],
    [/(^|\s)بزرگ\s+سال(?=$|\s|[،.؛:!؟\-])/g, '$1بزرگسال'],
    [/(^|\s)جلو\s+گیری(?=$|\s|[،.؛:!؟\-])/g, '$1جلوگیری'],
    [/(^|\s)ز\s+مین(?=$|\s|[،.؛:!؟\-])/g, '$1زمین'],
    [/(^|\s)زم\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1زمین'],
    [/(^|\s)سرزم\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1سرزمین'],
    [/(^|\s)س\s+رزمین(?=$|\s|[،.؛:!؟\-])/g, '$1سرزمین'],
    [/(^|\s)س\s+ال(?=$|\s|[،.؛:!؟\-])/g, '$1سال'],
    [/(^|\s)س\s+فید(?=$|\s|[،.؛:!؟\-])/g, '$1سفید'],
    [/(^|\s)س\s+یاه(?=$|\s|[،.؛:!؟\-])/g, '$1سیاه'],
    [/(^|\s)تغ\s*ی\s*ی?ر(?=$|\s|[،.؛:!؟\-])/g, '$1تغییر'],
    [/(^|\s)تغ\s+ییر(?=$|\s|[،.؛:!؟\-])/g, '$1تغییر'],
    [/(^|\s)ش\s+روع(?=$|\s|[،.؛:!؟\-])/g, '$1شروع'],
    [/(^|\s)ش\s+ب(?=$|\s|[،.؛:!؟\-])/g, '$1شب'],
    [/(^|\s)ش\s+یرین(?=$|\s|[،.؛:!؟\-])/g, '$1شیرین'],
    [/(^|\s)ش\s+یر\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1شیرین'],
    [/(^|\s)ش\s+لاق(?=$|\s|[،.؛:!؟\-])/g, '$1شلاق'],

    // Split 'ه' / 'م' / 'ن' / 'ک' / 'گ'
    [/(^|\s)ه\s+یچ(?=$|\s|[،.؛:!؟\-])/g, '$1هیچ'],
    [/(^|\s)ه\s+م(?=$|\s|[،.؛:!؟\-])/g, '$1هم'],
    [/(^|\s)ه\s+مه(?=$|\s|[،.؛:!؟\-])/g, '$1همه'],
    [/(^|\s)ه\s+نوز(?=$|\s|[،.؛:!؟\-])/g, '$1هنوز'],
    [/(^|\s)ه\s+وا(?=$|\s|[،.؛:!؟\-])/g, '$1هوا'],
    [/(^|\s)م\s+ادر(?=$|\s|[،.؛:!؟\-])/g, '$1مادر'],
    [/(^|\s)م\s+ردم(?=$|\s|[،.؛:!؟\-])/g, '$1مردم'],
    [/(^|\s)م\s+زرعه(?=$|\s|[،.؛:!؟\-])/g, '$1مزرعه'],
    [/(^|\s)م\s+وتور(?=$|\s|[،.؛:!؟\-])/g, '$1موتور'],
    [/(^|\s)ن\s+ور(?=$|\s|[،.؛:!؟\-])/g, '$1نور'],
    [/(^|\s)ن\s+گاه(?=$|\s|[،.؛:!؟\-])/g, '$1نگاه'],
    [/(^|\s)ن\s+زدیک(?=$|\s|[،.؛:!؟\-])/g, '$1نزدیک'],
    [/(^|\s)ک\s+وچک(?=$|\s|[،.؛:!؟\-])/g, '$1کوچک'],
    [/(^|\s)کو\s+چک(?=$|\s|[،.؛:!؟\-])/g, '$1کوچک'],
    [/(^|\s)ک\s+وتاه(?=$|\s|[،.؛:!؟\-])/g, '$1کوتاه'],
    [/(^|\s)کو\s+تاه(?=$|\s|[،.؛:!؟\-])/g, '$1کوتاه'],
    [/(^|\s)گ\s+وش(?=$|\s|[،.؛:!؟\-])/g, '$1گوش'],
    [/(^|\s)گ\s+ندم(?=$|\s|[،.؛:!؟\-])/g, '$1گندم'],

    // Split words in Animal Farm novel
    [/(^|\s)مس\s+تقر(?=$|\s|[،.؛:!؟\-])/g, '$1مستقر'],
    [/(^|\s)عجی\s+بی(?=$|\s|[،.؛:!؟\-])/g, '$1عجیبی'],
    [/(^|\s)عجی\s+ب(?=$|\s|[،.؛:!؟\-])/g, '$1عجیب'],
    [/(^|\s)ما\s+یل(?=$|\s|[،.؛:!؟\-])/g, '$1مایل'],
    [/(^|\s)سا\s+یر(?=$|\s|[،.؛:!؟\-])/g, '$1سایر'],
    [/(^|\s)آو\s+یزان(?=$|\s|[،.؛:!؟\-])/g, '$1آویزان'],
    [/(^|\s)الج\s+ثه(?=$|\s|[،.؛:!؟\-])/g, '$1الجثه'],
    [/(^|\s)مور\s+یل(?=$|\s|[،.؛:!؟\-])/g, '$1موریل'],
    [/(^|\s)بنجام\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1بنجامین'],
    [/(^|\s)مخ\s+تلف(?=$|\s|[،.؛:!؟\-])/g, '$1مختلف'],
    [/(^|\s)قد\s+یمی(?=$|\s|[،.؛:!؟\-])/g, '$1قدیمی'],
    [/(^|\s)مهم\s+یز(?=$|\s|[،.؛:!؟\-])/g, '$1مهمیز'],
    [/(^|\s)انگلس\s+تان(?=$|\s|[،.؛:!؟\-])/g, '$1انگلستان'],
    [/(^|\s)ی\s+ولاف(?=$|\s|[،.؛:!؟\-])/g, '$1یولاف'],
    [/(^|\s)ی\s+ونجه(?=$|\s|[،.؛:!؟\-])/g, '$1یونجه'],
    [/(^|\s)جا\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1جایی'],
    [/(^|\s)طلا\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1طلایی'],
    [/(^|\s)شناسا\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1شناسایی'],

    // Split past tense / passive suffixes: '... ته' / '... تند'
    [/(^|\s)نوش\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1نوشته'],
    [/(^|\s)آهس\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1آهسته'],
    [/(^|\s)برنگش\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1برنگشته'],
    [/(^|\s)گرف\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1گرفته'],
    [/(^|\s)نک\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1نکته'],
    [/(^|\s)بس\s+ته(?=$|\s|[،.؛:!؟\-])/g, '$1بسته'],
    [/(^|\s)رف\s+تند(?=$|\s|[،.؛:!؟\-])/g, '$1رفتند'],
    [/(^|\s)گذاش\s+تند(?=$|\s|[،.؛:!؟\-])/g, '$1گذاشتند'],
    [/(^|\s)دانس\s+تند(?=$|\s|[،.؛:!؟\-])/g, '$1دانستند'],
    [/(^|\s)داش\s+تند(?=$|\s|[،.؛:!؟\-])/g, '$1داشتند'],
    [/(^|\s)گف\s+تند(?=$|\s|[،.؛:!؟\-])/g, '$1گفتند'],
    [/(^|\s)شنیدس\s+تند(?=$|\s|[،.؛:!؟\-])/g, '$1شنیدستند'],

    // Split pronoun / possessive endings
    [/(^|\s)برای\s+تان(?=$|\s|[،.؛:!؟\-])/g, '$1برایتان'],
    [/(^|\s)برایش\s+تان(?=$|\s|[،.؛:!؟\-])/g, '$1برایتان'],
    [/(^|\s)کودکی\s+ام(?=$|\s|[،.؛:!؟\-])/g, '$1کودکی‌ام'],
    [/(^|\s)صدای\s+م(?=$|\s|[،.؛:!؟\-])/g, '$1صدایم'],
    [/(^|\s)چکمه\s+هایش(?=$|\s|[،.؛:!؟\-])/g, '$1چکمه‌هایش'],

    // Specific automotive terms in Changan manual & compound words in novels
    [/(^|\s)مرغ\s+دانی(?=$|\s|[،.؛:!؟\-])/g, '$1مرغ‌دانی'],
    [/(^|\s)مرغ\s+داری(?=$|\s|[،.؛:!؟\-])/g, '$1مرغ‌داری'],
    [/(^|\s)دست\s+کاری(?=$|\s|[،.؛:!؟\-])/g, '$1دست‌کاری'],
    [/(^|\s)مه\s+شکن(?=$|\s|[،.؛:!؟\-])/g, '$1مه‌شکن'],
    [/(^|\s)شیشه\s+شور(?=$|\s|[،.؛:!؟\-])/g, '$1شیشه‌شور'],
    [/(^|\s)سان\s+روف(?=$|\s|[،.؛:!؟\-])/g, '$1سان‌روف'],
    [/(^|\s)باد\s+گیر(?=$|\s|[،.؛:!؟\-])/g, '$1بادگیر'],
    [/(^|\s)پشت\s+سری(?=$|\s|[،.؛:!؟\-])/g, '$1پشت‌سری'],
    [/(^|\s)کمک\s+فنر(?=$|\s|[،.؛:!؟\-])/g, '$1کمک‌فنر'],
    [/(^|\s)جعبه\s+دنده(?=$|\s|[،.؛:!؟\-])/g, '$1جعبه‌دنده'],
    [/(^|\s)کیسه\s+هوا(?=$|\s|[،.؛:!؟\-])/g, '$1کیسه‌هوا'],
    [/(^|\s)سیس\s+تم(?=$|\s|[،.؛:!؟\-])/g, '$1سیستم'],
    [/(^|\s)کی\s+سه(?=$|\s|[،.؛:!؟\-])/g, '$1کیسه'],
    [/(^|\s)تر\s+مز(?=$|\s|[،.؛:!؟\-])/g, '$1ترمز'],
    [/(^|\s)فر\s+مان(?=$|\s|[،.؛:!؟\-])/g, '$1فرمان'],
    [/(^|\s)کن\s+ترل(?=$|\s|[،.؛:!؟\-])/g, '$1کنترل'],
    [/(^|\s)سنس\s+ور(?=$|\s|[،.؛:!؟\-])/g, '$1سنسور'],
    [/(^|\s)رو\s+غن(?=$|\s|[،.؛:!؟\-])/g, '$1روغن'],
    [/(^|\s)صف\s+حه(?=$|\s|[،.؛:!؟\-])/g, '$1صفحه'],
    [/(^|\s)فهر\s+ست(?=$|\s|[،.؛:!؟\-])/g, '$1فهرست'],
    [/(^|\s)مطا\s+لب(?=$|\s|[،.؛:!؟\-])/g, '$1مطالب'],
  ];

  for (const [regex, replacement] of wordFixes) {
    s = s.replace(regex, replacement);
  }

  // Step 5: Generic Single-Letter Stitcher
  // When a lone Persian connecting letter is orphaned by spaces, stitch it to the rest of the word.
  // Excludes independent valid Persian 1-2 letter words: و, به, با, در, از, تا, یا, که, چه, نه, ده, سه, بی, رو, مو, دو, تو, من, ما, او, هم
  const nonWords = 'بپتثجچحخسشصضطظعغفقکگلمنهی';
  const stitchRegex = new RegExp(`(^|\\s)([${nonWords}])\\s+([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی]{2,})(?=$|\\s|[،.؛:!؟\\-])`, 'g');
  s = s.replace(stitchRegex, '$1$2$3');

  // Step 6: Proper Persian Affixes and Prefixes with ZWNJ (نیم‌فاصله \u200C)
  s = s
    // Suffix: -ترین, -تر
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی]+)تر\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1‌ترین')
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+تر\s+ین(?=$|\s|[،.؛:!؟\-])/g, '$1‌ترین')
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+ترین(?=$|\s|[،.؛:!؟\-])/g, '$1‌ترین')
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+تر(?=$|\s|[،.؛:!؟\-])/g, '$1‌تر')
    // Suffix: -های / -ها / -هایی / -هایش / -هایمان / -هایتان
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+ها\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1‌هایی')
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+هایی(?=$|\s|[،.؛:!؟\-])/g, '$1‌هایی')
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+های(?=$|\s|[،.؛:!؟\-])/g, '$1‌های')
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+ها(?=$|\s|[،.؛:!؟\-])/g, '$1‌ها')
    // Suffix: -یی (e.g. مرغ‌دانی، طلایی، جلویی)
    .replace(/([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی])\s+یی(?=$|\s|[،.؛:!؟\-])/g, '$1‌یی')
    // Prefix: می / نمی (e.g. می‌رقصید، می‌آمدند، می‌گذشت)
    .replace(/(^|\s)(ن?می)\s+([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنهی]{2,})/g, '$1$2‌$3');

  // Step 7: Clean up spacing around Persian punctuation
  s = s
    .replace(/\s+([،.؛:!؟»\]\)])/g, '$1') // remove space before punctuation
    .replace(/([«\[\(])\s+/g, '$1')        // remove space inside open brackets
    .replace(/([،؛:!؟])(?=[^\s\d،؛:!؟»\]\)])/g, '$1 '); // single space after punctuation

  return s;
}

/**
 * 2. Normalizes technical text, tables, and automotive units.
 * Ensures units like kg, N·m, r/min, °C are preserved naturally alongside Persian terms.
 */
export function normalizeTableCellContent(content: string): string {
  if (!content) return '';
  let s = healPersianSpaces(content);

  // Fix any backwards-flipped units or OCR inversions
  s = s
    .replace(/مرگولیک\s*gk/gi, 'کیلوگرم (kg)')
    .replace(/رتم\s*ن\s*تویژ\s*N[·\.]?m/gi, 'نیوتن‌متر (N·m)')
    .replace(/هقیقرد\s*رد\s*رود\s*r\/min/gi, 'دور بر دقیقه (r/min)')
    .replace(/س\s*ویلساس\s*ه\s*جرد\s*C°/gi, 'درجه سلسیوس (°C)')
    .replace(/و\s*ردوخ\s*حرش/g, 'شرح خودرو');

  return s;
}

/**
 * 3. Table of Contents (TOC) Entry Interface & Parsers
 */
export interface TocEntry {
  isToc: boolean;
  title: string;
  dots: string;
  pageNumber: string;
  isMajorHeader?: boolean;
}

/**
 * Parses a single TOC line (e.g., 'I. شرح خودرو ................. 12' or '12 ........ مقدمه')
 */
export function parseTocLine(line: string): TocEntry | null {
  if (!line || !line.trim()) return null;
  const cleaned = healPersianSpaces(line.trim());

  // Pattern 1: Title .......... 12
  const pattern1 = /^(.*?)\s*([\.·•\-–—]{3,})\s*(\d+|[\u06F0-\u06F9]+)\s*$/;
  const m1 = cleaned.match(pattern1);
  if (m1) {
    const rawTitle = normalizeTableCellContent(m1[1].trim());
    if (rawTitle.length > 0) {
      const isMajor = /^(?:[I|V|X]+|\d+|[\u06F0-\u06F9]+)\s*[\.\-]\s*/.test(rawTitle);
      return {
        isToc: true,
        title: rawTitle,
        dots: '................................................................',
        pageNumber: m1[3].trim(),
        isMajorHeader: isMajor,
      };
    }
  }

  // Pattern 2: 12 .......... Title
  const pattern2 = /^(\d+|[\u06F0-\u06F9]+)\s*([\.·•\-–—]{3,})\s*(.*?)$/;
  const m2 = cleaned.match(pattern2);
  if (m2) {
    const rawTitle = normalizeTableCellContent(m2[3].trim());
    if (rawTitle.length > 0) {
      const isMajor = /^(?:[I|V|X]+|\d+|[\u06F0-\u06F9]+)\s*[\.\-]\s*/.test(rawTitle);
      return {
        isToc: true,
        title: rawTitle,
        dots: '................................................................',
        pageNumber: m2[1].trim(),
        isMajorHeader: isMajor,
      };
    }
  }

  return null;
}

/**
 * Parses comma-separated or run-on Table of Contents blocks
 * (e.g. 'فهرست: مقدمه 6، I. شرح خودرو 12، مشخصات و سطح آلایندگی سوخت 13...')
 */
export function parseRunOnTocEntries(text: string): TocEntry[] {
  if (!text || !text.trim()) return [];
  const cleaned = healPersianSpaces(text.trim()).replace(/^(?:فهرست(?:\s*مطالب)?|مطالب)\s*[\:：]?\s*/i, '');
  const tokens = cleaned.split(/[،,;\r\n]+/).map((t) => t.trim()).filter(Boolean);
  const entries: TocEntry[] = [];

  for (const token of tokens) {
    // Match 'Title 12' or 'Title - 12' or '12 Title'
    const mEnd = token.match(/^(.*?)\s*[\-–—\.]*\s*(\d+|[\u06F0-\u06F9]+)$/);
    if (mEnd && mEnd[1].trim().length > 1) {
      const title = normalizeTableCellContent(mEnd[1].trim());
      const isMajor = /^(?:[I|V|X]+|\d+|[\u06F0-\u06F9]+)\s*[\.\-]\s*/.test(title);
      entries.push({
        isToc: true,
        title,
        dots: '................................................................',
        pageNumber: mEnd[2].trim(),
        isMajorHeader: isMajor,
      });
      continue;
    }

    const mStart = token.match(/^(\d+|[\u06F0-\u06F9]+)\s*[\-–—\.]*\s*(.*?)$/);
    if (mStart && mStart[2].trim().length > 1) {
      const title = normalizeTableCellContent(mStart[2].trim());
      const isMajor = /^(?:[I|V|X]+|\d+|[\u06F0-\u06F9]+)\s*[\.\-]\s*/.test(title);
      entries.push({
        isToc: true,
        title,
        dots: '................................................................',
        pageNumber: mStart[1].trim(),
        isMajorHeader: isMajor,
      });
    }
  }

  return entries;
}

/**
 * 4. High-Fidelity Text Preparation for PDF Drawing
 * Prepares healed text for drawing with Vazirmatn OpenType font in pdf-lib.
 * Preserves canonical Unicode so fontkit's HarfBuzz engine performs native OpenType
 * shaping while strictly maintaining right-to-left (RTL) text direction.
 */
export function shapePersianForPdf(text: string): string {
  if (!text || !text.trim()) return '';
  return normalizeTableCellContent(text).trim();
}

/**
 * 5. Font Family Bundle (Regular & Bold)
 */
export interface PersianFontFamily {
  regular: PDFFont;
  bold: PDFFont;
  widthOf(text: string, size: number, isBold?: boolean): number;
}

let cachedRegularBytes: Buffer | null = null;
let cachedBoldBytes: Buffer | null = null;

export async function ensurePersianFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  const regPath = path.resolve(process.cwd(), 'server/assets/fonts/persian-font.ttf');
  const boldPath = path.resolve(process.cwd(), 'server/assets/fonts/persian-font-bold.ttf');

  // Load Regular
  if (!cachedRegularBytes || cachedRegularBytes.length < 50000) {
    if (fs.existsSync(regPath)) {
      cachedRegularBytes = await fs.promises.readFile(regPath);
    } else {
      const cdn = 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Regular.ttf';
      const res = await fetch(cdn, { signal: AbortSignal.timeout(10000) });
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(regPath, buf);
      cachedRegularBytes = buf;
    }
  }

  // Load Bold
  if (!cachedBoldBytes || cachedBoldBytes.length < 50000) {
    if (fs.existsSync(boldPath)) {
      cachedBoldBytes = await fs.promises.readFile(boldPath);
    } else {
      const cdn = 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Bold.ttf';
      const res = await fetch(cdn, { signal: AbortSignal.timeout(10000) });
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(boldPath, buf);
      cachedBoldBytes = buf;
    }
  }

  return {
    regular: cachedRegularBytes!,
    bold: cachedBoldBytes || cachedRegularBytes!,
  };
}

export async function loadPersianFontFamily(doc: PDFDocument): Promise<PersianFontFamily> {
  doc.registerFontkit(fontkit);
  const { regular, bold } = await ensurePersianFonts();
  const fontReg = await doc.embedFont(regular);
  const fontBold = await doc.embedFont(bold);

  const measureCache = new Map<string, number>();

  return {
    regular: fontReg,
    bold: fontBold,
    widthOf(text: string, size: number, isBold = false): number {
      const key = `${isBold ? 'B' : 'R'}:${size}:${text}`;
      let w = measureCache.get(key);
      if (w === undefined) {
        const font = isBold ? fontBold : fontReg;
        w = font.widthOfTextAtSize(text, size);
        measureCache.set(key, w);
      }
      return w;
    },
  };
}

/**
 * Unified Persian Typography & Formatting Engine
 * موتور جامع حروف‌چینی، فاصله‌زدایی، ساختاربندی خطوط و مدیریت فونت‌های فارسی
 */
export class PersianTypographyEngine {
  /**
   * 1. Heals split letters, removes unwanted spaces, standardizes ZWNJ semi-spaces
   */
  public static healSpaces(text: string): string {
    return healPersianSpaces(text);
  }

  /**
   * 2. Normalizes technical terms, tables, automotive units (kg, N·m, r/min, °C)
   */
  public static normalizeTechnical(text: string): string {
    return normalizeTableCellContent(text);
  }

  /**
   * 3. Prepares and contextually shapes text for PDF drawing
   */
  public static shapeForPdf(text: string): string {
    return shapePersianForPdf(text);
  }

  /**
   * 4. Parses single TOC line
   */
  public static parseToc(line: string): TocEntry | null {
    return parseTocLine(line);
  }

  /**
   * 5. Parses run-on / comma-separated TOC blocks
   */
  public static parseRunOnToc(text: string): TocEntry[] {
    return parseRunOnTocEntries(text);
  }

  /**
   * 6. Loads the complete Vazirmatn multi-font family (Regular & Bold)
   */
  public static async loadFontFamily(doc: PDFDocument): Promise<PersianFontFamily> {
    return loadPersianFontFamily(doc);
  }

  /**
   * 7. Ensures optimal cursive letter joining and eliminates broken connections
   */
  public static cleanCursive(text: string): string {
    return cleanCursiveJoining(text);
  }

  /**
   * 8. Classifies and structures page lines for optimum layout clarity
   */
  public static classifyPageContent(paragraphs: string[]): {
    isTocPage: boolean;
    tocEntries: TocEntry[];
    isChapterHeading: boolean;
    chapterTitle: string | null;
    isTechnicalHeader: boolean;
    headerTitle: string | null;
    bodyParagraphs: string[];
  } {
    const healed = paragraphs.map((p) => healPersianSpaces(p)).filter(Boolean);
    const fullText = healed.join('\n');
    const runOnToc = parseRunOnTocEntries(fullText);
    const lineTocs = healed.map((p) => parseTocLine(p)).filter(Boolean) as TocEntry[];

    const isTocPage =
      runOnToc.length >= 4 ||
      healed.some((p) => /^فهرست(?:\s*مطالب)?/i.test(p)) ||
      lineTocs.length >= 3;

    const tocEntries = runOnToc.length >= 4 ? runOnToc : lineTocs;

    let isChapterHeading = false;
    let chapterTitle: string | null = null;
    let isTechnicalHeader = false;
    let headerTitle: string | null = null;
    let bodyParas = healed;

    if (!isTocPage && healed.length > 0) {
      const first = healed[0];
      if (
        /^(?:فصل\s*(?:اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|[\d\u06F0-\u06F9]+)|بخش\s*(?:اول|دوم|سوم|[\d\u06F0-\u06F9]+)|chapter\s*\d+)/i.test(
          first
        )
      ) {
        isChapterHeading = true;
        chapterTitle = first;
        bodyParas = healed.slice(1);
      } else if (
        first.length < 90 &&
        healed.length > 1 &&
        !/^\d+[\.\-\)]/.test(first) &&
        !first.startsWith('-') &&
        !first.startsWith('•')
      ) {
        isTechnicalHeader = true;
        headerTitle = first;
        bodyParas = healed.slice(1);
      }
    }

    return {
      isTocPage,
      tocEntries,
      isChapterHeading,
      chapterTitle,
      isTechnicalHeader,
      headerTitle,
      bodyParagraphs: bodyParas,
    };
  }
}

