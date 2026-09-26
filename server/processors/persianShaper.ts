/**
 * Persian/Arabic text shaper and Unicode Bidirectional (Bidi) Algorithm layout engine.
 * Fully compliant with UAX #9 via bidi-js, avoiding manual string reversal.
 */
import bidiFactory from 'bidi-js';
import { config } from '../config/env';

const bidi = bidiFactory();

interface CharForms {
  isolated: number;
  final: number;
  initial: number;
  medial: number;
}

// Map Persian and Arabic chars to presentation forms
const CHAR_MAP: Record<number, CharForms> = {
  0x0622: { isolated: 0xfe81, final: 0xfe82, initial: 0xfe81, medial: 0xfe82 }, // آ
  0x0627: { isolated: 0xfe8d, final: 0xfe8e, initial: 0xfe8d, medial: 0xfe8e }, // ا
  0x0628: { isolated: 0xfe8f, final: 0xfe90, initial: 0xfe91, medial: 0xfe92 }, // ب
  0x067e: { isolated: 0xfb56, final: 0xfb57, initial: 0xfb58, medial: 0xfb59 }, // پ
  0x062a: { isolated: 0xfe95, final: 0xfe96, initial: 0xfe97, medial: 0xfe98 }, // ت
  0x062b: { isolated: 0xfe99, final: 0xfe9a, initial: 0xfe9b, medial: 0xfe9c }, // ث
  0x062c: { isolated: 0xfe9d, final: 0xfe9e, initial: 0xfe9f, medial: 0xfea0 }, // ج
  0x0686: { isolated: 0xfb7a, final: 0xfb7b, initial: 0xfb7c, medial: 0xfb7d }, // چ
  0x062d: { isolated: 0xfea1, final: 0xfea2, initial: 0xfea3, medial: 0xfea4 }, // ح
  0x062e: { isolated: 0xfea5, final: 0xfea6, initial: 0xfea7, medial: 0xfea8 }, // خ
  0x062f: { isolated: 0xfea9, final: 0xfeaa, initial: 0xfea9, medial: 0xfeaa }, // د
  0x0630: { isolated: 0xfeab, final: 0xfeac, initial: 0xfeab, medial: 0xfeac }, // ذ
  0x0631: { isolated: 0xfead, final: 0xfeae, initial: 0xfead, medial: 0xfeae }, // ر
  0x0632: { isolated: 0xfeaf, final: 0xfeb0, initial: 0xfeaf, medial: 0xfeb0 }, // ز
  0x0698: { isolated: 0xfb8a, final: 0xfb8b, initial: 0xfb8a, medial: 0xfb8b }, // ژ
  0x0633: { isolated: 0xfeb1, final: 0xfeb2, initial: 0xfeb3, medial: 0xfeb4 }, // س
  0x0634: { isolated: 0xfeb5, final: 0xfeb6, initial: 0xfeb7, medial: 0xfeb8 }, // ش
  0x0635: { isolated: 0xfeb9, final: 0xfeba, initial: 0xfebb, medial: 0xfebc }, // ص
  0x0636: { isolated: 0xfebd, final: 0xfebe, initial: 0xfebf, medial: 0xfec0 }, // ض
  0x0637: { isolated: 0xfec1, final: 0xfec2, initial: 0xfec3, medial: 0xfec4 }, // ط
  0x0638: { isolated: 0xfec5, final: 0xfec6, initial: 0xfec7, medial: 0xfec8 }, // ظ
  0x0639: { isolated: 0xfec9, final: 0xfeca, initial: 0xfecb, medial: 0xfecc }, // ع
  0x063a: { isolated: 0xfecd, final: 0xfece, initial: 0xfecf, medial: 0xfed0 }, // غ
  0x0641: { isolated: 0xfed1, final: 0xfed2, initial: 0xfed3, medial: 0xfed4 }, // ف
  0x0642: { isolated: 0xfed5, final: 0xfed6, initial: 0xfed7, medial: 0xfed8 }, // ق
  0x06a9: { isolated: 0xfb8e, final: 0xfb8f, initial: 0xfb8e, medial: 0xfb8f }, // ک (Persian)
  0x0643: { isolated: 0xfed9, final: 0xfeda, initial: 0xfedb, medial: 0xfedc }, // ك (Arabic)
  0x06af: { isolated: 0xfb92, final: 0xfb93, initial: 0xfb94, medial: 0xfb95 }, // گ
  0x0644: { isolated: 0xfedd, final: 0xfede, initial: 0xfedf, medial: 0xfee0 }, // ل
  0x0645: { isolated: 0xfee1, final: 0xfee2, initial: 0xfee3, medial: 0xfee4 }, // م
  0x0646: { isolated: 0xfee5, final: 0xfee6, initial: 0xfee7, medial: 0xfee8 }, // ن
  0x0648: { isolated: 0xfeed, final: 0xfeee, initial: 0xfeed, medial: 0xfeee }, // و
  0x0647: { isolated: 0xfeeb, final: 0xfeec, initial: 0xfeeb, medial: 0xfeec }, // ه
  0x06cc: { isolated: 0xfbfc, final: 0xfbfd, initial: 0xfbfe, medial: 0xfbff }, // ی (Persian)
  0x064a: { isolated: 0xfef1, final: 0xfef2, initial: 0xfef3, medial: 0xfef4 }, // ي (Arabic)
  0x0626: { isolated: 0xfe89, final: 0xfe8a, initial: 0xfe8b, medial: 0xfe8c }, // ئ
};

// Letters that do not connect to the following letter
const NON_CONNECTING_AFTER = new Set([
  0x0622, 0x0627, 0x062f, 0x0630, 0x0631, 0x0632, 0x0698, 0x0648,
]);

/**
 * Shape Persian text into connected glyphs
 */
function applyGlyphShaping(text: string): string {
  if (!text) return '';

  const chars = Array.from(text);
  const shapedCodes: number[] = [];

  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0);

    // Lam-Alef ligatures: ل (0x0644) followed by ا (0x0627) or آ (0x0622)
    if (code === 0x0644 && i < chars.length - 1) {
      const nextCode = chars[i + 1].charCodeAt(0);
      const prevChar = i > 0 ? chars[i - 1].charCodeAt(0) : 0;
      const connectsWithPrev = CHAR_MAP[prevChar] && !NON_CONNECTING_AFTER.has(prevChar);

      if (nextCode === 0x0627) {
        // لا
        shapedCodes.push(connectsWithPrev ? 0xfefc : 0xfefb);
        i++;
        continue;
      } else if (nextCode === 0x0622) {
        // لآ
        shapedCodes.push(connectsWithPrev ? 0xfefa : 0xfef9);
        i++;
        continue;
      }
    }

    const forms = CHAR_MAP[code];
    if (!forms) {
      shapedCodes.push(code);
      continue;
    }

    const prevChar = i > 0 ? chars[i - 1].charCodeAt(0) : 0;
    const nextChar = i < chars.length - 1 ? chars[i + 1].charCodeAt(0) : 0;

    const connectsWithPrev =
      CHAR_MAP[prevChar] && !NON_CONNECTING_AFTER.has(prevChar);
    const connectsWithNext = !!CHAR_MAP[nextChar];

    if (connectsWithPrev && connectsWithNext && !NON_CONNECTING_AFTER.has(code)) {
      shapedCodes.push(forms.medial);
    } else if (connectsWithPrev) {
      shapedCodes.push(forms.final);
    } else if (connectsWithNext && !NON_CONNECTING_AFTER.has(code)) {
      shapedCodes.push(forms.initial);
    } else {
      shapedCodes.push(forms.isolated);
    }
  }

  return String.fromCharCode(...shapedCodes);
}

/**
 * Unicode Bidirectional Algorithm reordering using bidi-js (UAX #9).
 * Never uses manual string reversal (.reverse()).
 */
function applyBidiReordering(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const reorderedLines = lines.map((line) => {
    // Check if line contains any RTL characters
    const hasRtl = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(line);
    if (!hasRtl) {
      return line;
    }

    try {
      const embedding = bidi.getEmbeddingLevels(line, 'rtl');
      return bidi.getReorderedString(line, embedding);
    } catch {
      // Fallback: return line safely without crash
      return line;
    }
  });

  return reorderedLines.join('\n');
}

/**
 * Main Persian text shaper with RTL layout and diagnostic isolation support.
 * @param input Raw text containing Persian/English/Numbers/Symbols
 * @param forceRtl Optional override for diagnostic testing
 */
export function shapePersianText(input: string, forceRtl?: boolean): string {
  if (!input) return '';

  // Section 7: RTL ISOLATION TEST (Diagnostic mode)
  const rtlEnabled = forceRtl !== undefined ? forceRtl : config.reconstructionRtlEnabled;
  if (!rtlEnabled) {
    // Return original un-reordered text for diagnostic comparison
    return input;
  }

  const startTime = Date.now();

  try {
    // 1. Contextual glyph shaping (isolated, initial, medial, final forms)
    const shaped = applyGlyphShaping(input);

    // 2. Unicode Bidirectional Algorithm reordering (UAX #9)
    const result = applyBidiReordering(shaped);

    const elapsed = Date.now() - startTime;
    if (elapsed > config.rtlOperationTimeoutMs) {
      console.warn(`[RTL_TIMEOUT] RTL operation took ${elapsed}ms, exceeding threshold.`);
    }

    return result;
  } catch (err: any) {
    console.error(`[RTL_ERROR] Failed during Persian shaping:`, err?.message || err);
    // Safe fallback: never crash or return empty
    return input;
  }
}
