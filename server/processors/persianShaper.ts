export function sanitizePersianSymbols(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/[\u200b\u200d\u200e\u200f\ufeff]/g, '')
    .replace(/[«»“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[•\u2022\u25CF\u25A0\u25AA\u25E6\u2219]/g, '-')
    .replace(/[—–]/g, '-')
    .replace(/\|/g, '-')
    .replace(/[⚠️⚠]/g, '[!]');
}

export interface BidiSegment {
  text: string;
  isRtl: boolean;
}

export function segmentBidiText(line: string): BidiSegment[] {
  if (!line) return [];
  const clean = sanitizePersianSymbols(line);
  const regex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u200c]+|[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u200c]+/g;
  const matches = clean.match(regex) || [];
  
  return matches.map((token) => ({
    text: token,
    isRtl: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(token),
  }));
}
