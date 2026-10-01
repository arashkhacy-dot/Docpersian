import bidiFactory from 'bidi-js';
import pkg from 'arabic-persian-reshaper';

const { PersianShaper } = pkg;
const bidi = bidiFactory();

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
  const clean = sanitizePersianSymbols(text);
  try {
    // 1. Reshape Persian and Arabic letters to their connected contextual forms (initial, medial, final, isolated)
    const reshaped = PersianShaper.convertArabic(clean);
    // 2. Apply Unicode Bidirectional Algorithm (Bidi) so RTL runs are flipped for left-to-right PDF streams
    // while keeping Latin characters (codes, formulas, acronyms) and numbers in natural LTR order
    const levels = bidi.getEmbeddingLevels(reshaped, 'rtl');
    return bidi.getReorderedString(reshaped, levels);
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
