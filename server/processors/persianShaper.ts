import { shapePersianForPdf, healPersianSpaces, normalizeTableCellContent } from './persianTypographyEngine';

export { shapePersianForPdf, healPersianSpaces, normalizeTableCellContent };

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
  return shapePersianForPdf(text);
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

