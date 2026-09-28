export function sanitizePersianSymbols(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/[\uFEFF\u200B\u200E\u200F]/g, '')
    .replace(/[«»“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[••●■▪◦∙]/g, '-')
    .replace(/[—–]/g, '-')
    .replace(/\|/g, ' - ')
    .replace(/[⚠️⚠]/g, '[!]');
}

export function prepareRtlText(text: string): string {
  if (!text) return '';
  let clean = sanitizePersianSymbols(text);

  // Reverse Latin words so fontkit's RTL layout engine renders them in correct LTR direction
  clean = clean.replace(/[a-zA-Z0-9]+(?:[\.\-_/][a-zA-Z0-9]+)*/g, (match) => {
    return match.split('').reverse().join('');
  });

  return clean;
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
