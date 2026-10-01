import pkg from 'arabic-persian-reshaper';

const { PersianShaper } = pkg;

export function sanitizePersianSymbols(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/[\uFEFF\u200B\u200E\u200F]/g, "")
    .replace(/[«»“”]/g, "\"")
    .replace(/[‘’]/g, "\x27")
    .replace(/[•●■▪◦∙]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/\|/g, " - ")
    .replace(/[⚠️⚠]/g, "[!]")
    .replace(/[◄►◀▶→←⇒⇐►▼▲]/g, " : ")
    .replace(/[※]/g, "[*]")
    .replace(/[★☆✓✔✕✖]/g, "-")
    .replace(/[λ]/g, "lambda");
}

export function prepareRtlText(text: string): string {
  if (!text || !text.trim()) return "";
  const clean = sanitizePersianSymbols(text)
    .replace(/\u064A/g, '\u06CC') // Arabic Yeh -> Persian Yeh
    .replace(/\u0643/g, '\u06A9') // Arabic Kaf -> Persian Keheh
    .trim();

  // Check if string contains any RTL characters (Persian/Arabic)
  const hasRtl = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(clean);
  if (!hasRtl) {
    // Pure Latin / numbers / symbols: render directly in natural LTR order
    return clean;
  }

  try {
    // 1. Reshape Persian and Arabic letters to their connected contextual forms (initial, medial, final, isolated)
    // fontkit's OpenType layout will place these contextual glyphs in visual Left-to-Right stream order for PDF drawing.
    // NOTE: We MUST NOT apply bidi.getReorderedString here because fontkit's layout engine already handles
    // bidirectional visual glyph placement; doing both causes double-reversal and detached glyphs!
    let reshaped = PersianShaper.convertArabic(clean);

    // 2. In an RTL line, fontkit's layout reverses Latin character sequences.
    // Pre-reverse Latin word sequences so fontkit draws them in natural Left-To-Right reading order!
    // (e.g. 'ABS' -> 'SBA' -> fontkit draws 'A B S'; 'bar' -> 'rab' -> fontkit draws 'b a r')
    reshaped = reshaped.replace(/[a-zA-Z]+/g, (match) => {
      return match.split('').reverse().join('');
    });

    return reshaped;
  } catch {
    return clean;
  }
}

export interface BidiSegment {
  text: string;
  isRtl: boolean;
}

export function segmentBidiText(line: string): BidiSegment[] {
  if (!line) return [];
  const clean = sanitizePersianSymbols(line);
  const regex = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿‌]+|[^؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿‌]+/g;
  const matches = clean.match(regex) || [];
  return matches.map((token) => ({
    text: token,
    isRtl: /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(token),
  }));
}

