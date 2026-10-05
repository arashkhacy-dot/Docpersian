import {
  shapePersianForPdf,
  healPersianSpaces,
  normalizeTableCellContent,
  sanitizePersianSymbols,
} from './persianTypographyEngine';

export { shapePersianForPdf, healPersianSpaces, normalizeTableCellContent, sanitizePersianSymbols };

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

