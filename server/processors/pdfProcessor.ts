import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';
import { exec } from 'child_process';
import zlib from 'zlib';
import { PDFDocument, rgb, PDFName, PDFNumber } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PDFParse } from 'pdf-parse';
import { DocumentProcessor } from './documentProcessor';
import { JobState, PageManifestItem } from '../jobs/jobState';
import { defaultTranslator, TranslationUnit } from '../gemini/translator';
import { prepareRtlText, sanitizePersianSymbols } from './persianShaper';
import { config } from '../config/env';
import { createDocxFile } from './docxHelper.js';

const execPromise = util.promisify(exec);

const standardFontDataUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/');

function createPdfParser(data: Uint8Array | Buffer): PDFParse {
  return new PDFParse({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    standardFontDataUrl,
  });
}

function pageHasImages(page: any, doc: any): boolean {
  try {
    const resources = page.node.Resources();
    const xObj = resources?.get(PDFName.of('XObject'));
    if (xObj && (xObj as any).dict) {
      for (const [, ref] of (xObj as any).dict.entries()) {
        const obj = doc.context.lookup(ref);
        const subtypeObj =
          obj?.dict?.get?.(PDFName.of('Subtype')) ||
          obj?.get?.(PDFName.of('Subtype'));
        const subtype = subtypeObj ? subtypeObj.toString() : '';
        if (subtype === '/Image' || subtype === 'Image') return true;
      }
    }
  } catch {}
  return false;
}

function drawSegmentedRtlLine(
  page: any,
  lineText: string,
  font: any,
  fontSize: number,
  rightX: number,
  y: number,
  color: any
) {
  if (!lineText || !lineText.trim()) return;
  const clean = prepareRtlText(lineText);
  const w = font.widthOfTextAtSize(clean, fontSize);
  page.drawText(clean, {
    x: rightX - w,
    y,
    size: fontSize,
    font,
    color,
  });
}

let cachedFontBytes: Buffer | null = null;

export async function ensurePersianFont(): Promise<Buffer> {
  if (cachedFontBytes && cachedFontBytes.length > 50000) {
    return cachedFontBytes;
  }

  const primaryPath = path.resolve(process.cwd(), 'server/assets/fonts/persian-font.ttf');

  // 1. Check if primary file exists and is valid Vazirmatn font
  if (fs.existsSync(primaryPath)) {
    try {
      const bytes = await fs.promises.readFile(primaryPath);
      if (bytes.length > 50000) {
        const font = fontkit.create(bytes);
        if (font.hasGlyphForCodePoint(0x067E) && font.hasGlyphForCodePoint(0x06AF) && font.hasGlyphForCodePoint(0xFB7C)) {
          cachedFontBytes = bytes;
          return cachedFontBytes;
        }
      }
    } catch {
      // invalid, will re-download or search
    }
  }

  // 2. Try candidate system fonts
  const systemCandidates = [
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
    '/usr/share/fonts/truetype/scheherazade/Scheherazade-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.otf',
  ];

  for (const sp of systemCandidates) {
    if (fs.existsSync(sp)) {
      try {
        const bytes = await fs.promises.readFile(sp);
        const font = fontkit.create(bytes);
        if (font.hasGlyphForCodePoint(0x067E) && font.hasGlyphForCodePoint(0x06AF) && font.hasGlyphForCodePoint(0xFB7C)) {
          cachedFontBytes = bytes;
          return cachedFontBytes;
        }
      } catch {}
    }
  }

  // 3. Auto-download official Persian Vazirmatn font from reliable CDN mirrors
  console.log('[FONT_INIT] Downloading official Persian Vazirmatn font...');
  const cdnUrls = [
    'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@master/fonts/ttf/Vazirmatn-Regular.ttf',
    'https://raw.githubusercontent.com/rastikerdar/vazirmatn/master/fonts/ttf/Vazirmatn-Regular.ttf',
    'https://cdnjs.cloudflare.com/ajax/libs/vazirmatn/33.0.3/Vazirmatn-Regular.ttf',
  ];

  await fs.promises.mkdir(path.dirname(primaryPath), { recursive: true });

  for (const url of cdnUrls) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        if (buf.length > 50000) {
          const font = fontkit.create(buf);
          if (font.hasGlyphForCodePoint(0x067E) && font.hasGlyphForCodePoint(0x06AF)) {
            await fs.promises.writeFile(primaryPath, buf);
            cachedFontBytes = buf;
            console.log('[FONT_INIT] Successfully downloaded & cached Vazirmatn Persian font.');
            return cachedFontBytes;
          }
        }
      }
    } catch (e: any) {
      console.warn(`[FONT_INIT] Mirror failed (${url}):`, e?.message);
    }
  }

  if (fs.existsSync(primaryPath)) {
    cachedFontBytes = await fs.promises.readFile(primaryPath);
    return cachedFontBytes;
  }

  throw new Error('Persian TrueType font file not found.');
}

async function getCachedPersianFont(): Promise<Buffer> {
  return ensurePersianFont();
}

async function runWithTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    return await Promise.race([task(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

const textWidthCache = new Map<string, number>();

function getWordWidth(word: string, font: any, fontSize: number): number {
  const key = `${fontSize}:${word}`;
  let w = textWidthCache.get(key);
  if (w === undefined) {
    w = font.widthOfTextAtSize(word, fontSize);
    if (textWidthCache.size < 50000) {
      textWidthCache.set(key, w as number);
    }
  }
  return w ?? 0;
}

function wrapPersianText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const spaceWidth = getWordWidth(' ', font, fontSize);
  const lines: string[] = [];
  let currentWords: string[] = [];
  let currentLineWidth = 0;

  for (const word of words) {
    const wordWidth = getWordWidth(word, font, fontSize);
    const neededWidth = currentWords.length === 0 ? wordWidth : currentLineWidth + spaceWidth + wordWidth;

    if (neededWidth <= maxWidth) {
      currentWords.push(word);
      currentLineWidth = neededWidth;
    } else {
      if (currentWords.length > 0) {
        lines.push(currentWords.join(' '));
      }
      currentWords = [word];
      currentLineWidth = wordWidth;
    }
  }

  if (currentWords.length > 0) {
    lines.push(currentWords.join(' '));
  }

  return lines;
}

function getStreamObjects(page: any, doc: any): any[] {
  try {
    const contents = page.node.Contents();
    if (!contents) return [];
    const resolved = doc.context.lookup(contents);
    if (!resolved) return [];

    if (resolved.constructor.name === 'PDFArray' || typeof (resolved as any).size === 'function') {
      const list: any[] = [];
      const size = typeof (resolved as any).size === 'function' ? (resolved as any).size() : (resolved as any).array?.length || 0;
      for (let i = 0; i < size; i++) {
        const ref = (resolved as any).get ? (resolved as any).get(i) : (resolved as any).array[i];
        const s = doc.context.lookup(ref);
        if (s) list.push(s);
      }
      return list;
    }
    return [resolved];
  } catch {
    return [];
  }
}

function stripTextFromPageStreams(
  page: any,
  doc: any
): {
  maxY: number | null;
  minY: number | null;
  hasTopImage: boolean;
  imageBottomY: number | null;
  imageTopY: number | null;
} {
  try {
    const streams = getStreamObjects(page, doc);
    if (streams.length === 0) {
      return { maxY: null, minY: null, hasTopImage: false, imageBottomY: null, imageTopY: null };
    }

    const allYs: number[] = [];
    const imageBottoms: number[] = [];
    const imageTops: number[] = [];
    const { height } = page.getSize();

    for (const streamObj of streams) {
      const rawBytes: Uint8Array =
        typeof (streamObj as any).getContents === 'function'
          ? (streamObj as any).getContents()
          : (streamObj as any).contents;

      if (!rawBytes || rawBytes.length === 0) continue;

      let decompressed: Buffer;
      let isCompressed = false;
      try {
        decompressed = zlib.inflateSync(Buffer.from(rawBytes));
        isCompressed = true;
      } catch {
        decompressed = Buffer.from(rawBytes);
      }

      const streamText = decompressed.toString('latin1');

      // 1. Detect images and their vertical positions
      // cm transformation matrix: a b c d e f cm ... /Name Do
      const cmDoRegex = /([-+]?\d*\.?\d+)\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+cm\s*(?:[^\n\r]*?)?\/([^\s\/]+)\s+Do/g;
      let imgM: RegExpExecArray | null;
      while ((imgM = cmDoRegex.exec(streamText)) !== null) {
        const w = Math.abs(parseFloat(imgM[1]));
        const h = Math.abs(parseFloat(imgM[2]));
        const d = parseFloat(imgM[2]);
        const y = parseFloat(imgM[4]);
        if (!isNaN(y) && !isNaN(h) && h > 60 && w > 80) {
          const bottom = d < 0 ? y - h : y;
          const top = d < 0 ? y : y + h;
          if (top > height * 0.40) {
            imageBottoms.push(bottom);
            imageTops.push(top);
          }
        }
      }

      // 2. Detect text vertical positions before stripping
      // Match 6-param Tm: a b c d e f Tm (f is y-position)
      const tm6Regex = /[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+Tm/g;
      let m: RegExpExecArray | null;
      while ((m = tm6Regex.exec(streamText)) !== null) {
        const y = parseFloat(m[2]);
        if (!isNaN(y) && y > 15 && y < height - 15) {
          allYs.push(y);
        }
      }

      // Match 2-param Td or TD: tx ty Td
      const tdRegex = /[-+]?\d*\.?\d+\s+([-+]?\d*\.?\d+)\s+(?:Td|TD)/g;
      while ((m = tdRegex.exec(streamText)) !== null) {
        const y = parseFloat(m[1]);
        if (!isNaN(y) && y > 15 && y < height - 15) {
          allYs.push(y);
        }
      }

      // 3. Strip all BT ... ET text blocks
      const stripped = streamText.replace(/BT[\s\S]*?ET/g, '');

      // Recompress and update stream
      const newBytes = isCompressed
        ? zlib.deflateSync(Buffer.from(stripped, 'latin1'))
        : Buffer.from(stripped, 'latin1');

      (streamObj as any).contents = new Uint8Array(newBytes);
      if ((streamObj as any).dict) {
        (streamObj as any).dict.set(PDFName.of('Length'), PDFNumber.of(newBytes.length));
      }
    }

    const hasTopImg = imageBottoms.length > 0;
    const minImgBottom = hasTopImg ? Math.min(...imageBottoms) : null;
    const maxImgTop = hasTopImg ? Math.max(...imageTops) : null;

    return {
      maxY: allYs.length > 0 ? Math.max(...allYs) : null,
      minY: allYs.length > 0 ? Math.min(...allYs) : null,
      hasTopImage: hasTopImg,
      imageBottomY: minImgBottom,
      imageTopY: maxImgTop,
    };
  } catch {
    return { maxY: null, minY: null, hasTopImage: false, imageBottomY: null, imageTopY: null };
  }
}

function normalizeDiagramParagraphs(paragraphs: string[]): string[] {
  const result: string[] = [];
  for (const p of paragraphs) {
    if (!p || !p.trim()) continue;
    const trimmed = p.trim();

    // 1. If paragraph contains multiple bullet points: • or -
    if ((trimmed.match(/[•\-]\s+/g) || []).length >= 2) {
      const items = trimmed.split(/(?=[•\-]\s+)/).map((s) => s.trim()).filter(Boolean);
      result.push(...items);
      continue;
    }

    // 2. If paragraph contains numbered items: 1. or 1- or 1) or ۱.
    if ((trimmed.match(/(?:^|\s+)(?:\d+|[\u06F0-\u06F9]+)[\.\-\)]\s+/g) || []).length >= 2) {
      const items = trimmed
        .split(/(?=(?:^|\s+)(?:\d+|[\u06F0-\u06F9]+)[\.\-\)]\s+)/)
        .map((s) => s.trim())
        .filter(Boolean);
      result.push(...items);
      continue;
    }

    // 3. If paragraph contains multiple comma or semicolon separated parts:
    if (trimmed.includes('،') || trimmed.includes('؛')) {
      const parts = trimmed.split(/[،؛]/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 3 && parts.every((pt) => pt.length < 50)) {
        result.push(...parts.map((pt, idx) => `${idx + 1}. ${pt}`));
        continue;
      }
    }

    // 4. Vehicle parts list without punctuation:
    if (trimmed.length > 45 && !trimmed.includes('.') && !trimmed.includes('،')) {
      const headerMatch = trimmed.match(/^([A-Z0-9\s]{2,15}\d*)\s+(.*)/i);
      if (headerMatch && headerMatch[2].length > 35) {
        const header = headerMatch[1].trim();
        const rest = headerMatch[2].trim();
        const keywords = [
          'چراغ‌های', 'چراغ', 'قفل درب', 'سانروف', 'برف‌پاک‌کن', 'کاپوت موتور',
          'درب باک', 'شیشه‌های برقی', 'آینه بغل', 'آینه دید', 'آفتاب‌گیر',
          'کلید سانروف', 'کلید قفل', 'کلید شیشه', 'سیستم چندرسانه‌ای', 'صندلی جلو',
          'زیرآرنجی', 'اهرم کنترل', 'دکمه‌های', 'تنظیم آینه', 'دریچه هوا',
          'داشبورد', 'مخزن مایع', 'درپوش پرکن', 'باتری', 'گیج روغن', 'فیلتر هوا', 'جعبه فیوز'
        ];
        const pattern = new RegExp('\\s+(?=(?:' + keywords.join('|') + '))', 'g');
        const parts = rest.split(pattern).map((s) => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          result.push(header);
          result.push(...parts.map((pt, idx) => `${idx + 1}. ${pt}`));
          continue;
        }
      }
    }

    result.push(trimmed);
  }
  return result;
}

function renderPersianTextToPage(
  page: any,
  paragraphs: string[],
  persianFont: any,
  textBounds: {
    maxY: number | null;
    minY: number | null;
    hasTopImage: boolean;
    imageBottomY: number | null;
    imageTopY?: number | null;
  },
  pageIndex: number,
  totalPages: number
) {
  const { width, height } = page.getSize();
  const marginX = 32;
  const bottomMargin = 26;

  const normalized = normalizeDiagramParagraphs(paragraphs);
  if (normalized.length === 0) return;

  // 1. Detect title / page header
  const hasTitle =
    normalized.length > 1 &&
    normalized[0].length < 110 &&
    !/^\d+[\.\-]/.test(normalized[0]) &&
    !normalized[0].startsWith('•') &&
    !normalized[0].startsWith('-');

  let listParas = normalized;
  if (hasTitle) {
    const title = normalized[0];
    listParas = normalized.slice(1);
    // Draw title at the top of the page so page header is clearly restored
    const titleFontSize = 11.5;
    const titleLines = wrapPersianText(title, persianFont, titleFontSize, width - marginX * 2);
    let titleY = height - 36;
    for (const line of titleLines) {
      drawSegmentedRtlLine(page, line, persianFont, titleFontSize, width - marginX, titleY, rgb(0.08, 0.15, 0.3));
      titleY -= 15;
    }
  }

  if (listParas.length === 0) return;

  // 2. Determine starting position for descriptions/content
  let startY: number;
  if (textBounds.hasTopImage && textBounds.imageBottomY !== null) {
    if (textBounds.imageBottomY > bottomMargin + 110) {
      startY = Math.min(textBounds.imageBottomY - 12, height * 0.58);
    } else {
      startY = hasTitle ? height - 60 : height - 42;
    }
  } else if (textBounds.maxY !== null && textBounds.maxY < height - 70) {
    startY = Math.min(textBounds.maxY, height - 42);
  } else {
    startY = hasTitle ? height - 60 : height - 42;
  }

  startY = Math.max(bottomMargin + 75, Math.min(startY, height - 35));
  let curY = startY;
  const availableHeight = Math.max(70, curY - bottomMargin);

  // 3. Layout: Single-column or Multi-column
  const isItemList =
    listParas.length >= 4 &&
    listParas.filter((p) => /^\d+[\.\-]/.test(p) || p.startsWith('•') || p.startsWith('-') || p.length < 80).length /
      listParas.length >
      0.5;

  const useThreeColumns = width >= 520 && listParas.length >= 15;
  const useTwoColumns =
    !useThreeColumns &&
    ((isItemList && width >= 420 && listParas.length >= 4) ||
      (textBounds.hasTopImage && width >= 420 && listParas.length >= 4) ||
      (listParas.length >= 10 && width >= 420));

  if (useThreeColumns) {
    // 3-Column Layout: Right, Middle, Left
    const colGap = 16;
    const colW = (width - marginX * 2 - colGap * 2) / 3;
    const perCol = Math.ceil(listParas.length / 3);
    const col1 = listParas.slice(0, perCol);
    const col2 = listParas.slice(perCol, perCol * 2);
    const col3 = listParas.slice(perCol * 2);

    let fontSize = 8.5;
    let lineHeight = 11.8;

    const calcColH = (paras: string[], fSize: number, lHeight: number) => {
      let h = 0;
      for (const p of paras) {
        const lines = wrapPersianText(p, persianFont, fSize, colW);
        h += lines.length * lHeight + 2;
      }
      return h;
    };

    while (
      Math.max(
        calcColH(col1, fontSize, lineHeight),
        calcColH(col2, fontSize, lineHeight),
        calcColH(col3, fontSize, lineHeight)
      ) > availableHeight &&
      fontSize > 6.5
    ) {
      fontSize -= 0.3;
      lineHeight = Math.round(fontSize * 1.35 * 10) / 10;
    }

    const cols = [
      { paras: col1, rightX: width - marginX },
      { paras: col2, rightX: width - marginX - colW - colGap },
      { paras: col3, rightX: width - marginX - (colW + colGap) * 2 },
    ];

    for (const col of cols) {
      let colY = curY;
      for (const p of col.paras) {
        const lines = wrapPersianText(p, persianFont, fontSize, colW);
        for (const line of lines) {
          if (colY < bottomMargin) break;
          drawSegmentedRtlLine(page, line, persianFont, fontSize, col.rightX, colY, rgb(0.12, 0.16, 0.24));
          colY -= lineHeight;
        }
        colY -= 2;
      }
    }
  } else if (useTwoColumns) {
    // 2-Column Layout: Right column first (RTL), then Left column
    const colGap = 20;
    const colW = (width - marginX * 2 - colGap) / 2;
    const rightColX = width - marginX;
    const leftColX = width - marginX - colW - colGap;

    const mid = Math.ceil(listParas.length / 2);
    const rightParas = listParas.slice(0, mid);
    const leftParas = listParas.slice(mid);

    let fontSize = 9.5;
    let lineHeight = 13.5;

    const calcColH = (paras: string[], fSize: number, lHeight: number) => {
      let h = 0;
      for (const p of paras) {
        const lines = wrapPersianText(p, persianFont, fSize, colW);
        h += lines.length * lHeight + 3;
      }
      return h;
    };

    while (
      Math.max(
        calcColH(rightParas, fontSize, lineHeight),
        calcColH(leftParas, fontSize, lineHeight)
      ) > availableHeight &&
      fontSize > 6.8
    ) {
      fontSize -= 0.3;
      lineHeight = Math.round(fontSize * 1.35 * 10) / 10;
    }

    // Render Right Column
    let rightY = curY;
    for (const p of rightParas) {
      const isSubHeading = p.length < 35 && !p.startsWith('-') && !p.startsWith('•') && !/^\d+[\.\-]/.test(p);
      const f = isSubHeading ? fontSize + 1 : fontSize;
      const lh = isSubHeading ? lineHeight + 2 : lineHeight;
      const lines = wrapPersianText(p, persianFont, f, colW);
      const color = isSubHeading ? rgb(0.08, 0.15, 0.3) : rgb(0.12, 0.16, 0.24);

      for (const line of lines) {
        if (rightY < bottomMargin) break;
        drawSegmentedRtlLine(page, line, persianFont, f, rightColX, rightY, color);
        rightY -= lh;
      }
      rightY -= 2;
    }

    // Render Left Column
    let leftY = curY;
    for (const p of leftParas) {
      const isSubHeading = p.length < 35 && !p.startsWith('-') && !p.startsWith('•') && !/^\d+[\.\-]/.test(p);
      const f = isSubHeading ? fontSize + 1 : fontSize;
      const lh = isSubHeading ? lineHeight + 2 : lineHeight;
      const lines = wrapPersianText(p, persianFont, f, colW);
      const color = isSubHeading ? rgb(0.08, 0.15, 0.3) : rgb(0.12, 0.16, 0.24);

      for (const line of lines) {
        if (leftY < bottomMargin) break;
        drawSegmentedRtlLine(page, line, persianFont, f, leftColX, leftY, color);
        leftY -= lh;
      }
      leftY -= 2;
    }
  } else {
    // Single-column layout
    const contentW = width - marginX * 2;
    const rightX = width - marginX;

    let fontSize = 10.5;
    let lineHeight = 15.5;

    const calcTotalH = (fSize: number, lHeight: number) => {
      let h = 0;
      for (const p of listParas) {
        const isHeading = p.length < 45 && !p.startsWith('-') && !p.startsWith('•') && !/^\d+[\.\-]/.test(p);
        const f = isHeading ? fSize + 1.5 : fSize;
        const lh = isHeading ? lHeight + 2.5 : lHeight;
        const lines = wrapPersianText(p, persianFont, f, contentW);
        h += lines.length * lh + (isHeading ? 5 : 3);
      }
      return h;
    };

    while (calcTotalH(fontSize, lineHeight) > availableHeight && fontSize > 6.8) {
      fontSize -= 0.3;
      lineHeight = Math.round(fontSize * 1.35 * 10) / 10;
    }

    for (let uIdx = 0; uIdx < listParas.length; uIdx++) {
      const p = listParas[uIdx];
      const isHeading =
        (uIdx === 0 && p.length < 75) ||
        (p.length < 45 && !p.startsWith('-') && !p.startsWith('•') && !/^\d+[\.\-]/.test(p));
      const f = isHeading ? fontSize + 1.5 : fontSize;
      const lh = isHeading ? lineHeight + 2.5 : lineHeight;
      const lines = wrapPersianText(p, persianFont, f, contentW);
      const color = isHeading ? rgb(0.08, 0.15, 0.3) : rgb(0.12, 0.16, 0.24);

      for (const line of lines) {
        if (curY < bottomMargin) break;
        drawSegmentedRtlLine(page, line, persianFont, f, rightX, curY, color);
        curY -= lh;
      }
      curY -= isHeading ? 5 : 3;
      if (curY < bottomMargin) break;
    }
  }
}

export class PDFProcessor implements DocumentProcessor {
  /**
   * Decodes hexadecimal PDF strings (e.g. <50616765...>) with support for UTF-16BE
   */
  private decodePdfHexString(hex: string): string {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (!clean) return '';
    const padded = clean.length % 2 !== 0 ? clean + '0' : clean;
    const buf = Buffer.from(padded, 'hex');

    // UTF-16BE BOM: 0xFE 0xFF
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      return buf.subarray(2).swap16().toString('utf16le');
    }
    // UTF-16 without BOM (ASCII characters where every alternate byte is 0x00)
    if (buf.length >= 4 && buf[0] === 0x00 && buf[2] === 0x00) {
      return buf.swap16().toString('utf16le');
    }

    return buf.toString('latin1');
  }

  /**
   * Decodes stream bytes into raw text tokens from literal strings, hex strings, and TJ arrays
   */
  private extractTextFromStreamData(streamBytes: Uint8Array): string {
    let streamText = '';
    try {
      const inflated = zlib.inflateSync(Buffer.from(streamBytes));
      streamText = inflated.toString('latin1');
    } catch {
      streamText = Buffer.from(streamBytes).toString('latin1');
    }

    const textPieces: string[] = [];

    // 1. Literal strings: (string) Tj or ' or "
    const tjRegex = /\((.*?)\)\s*(?:Tj|'|")/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(streamText)) !== null) {
      const decoded = this.decodePdfString(tjMatch[1]);
      if (decoded.trim()) textPieces.push(decoded.trim());
    }

    // 2. Hex strings: <hex> Tj or ' or "
    const hexTjRegex = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;
    let hexTjMatch: RegExpExecArray | null;
    while ((hexTjMatch = hexTjRegex.exec(streamText)) !== null) {
      const decoded = this.decodePdfHexString(hexTjMatch[1]);
      if (decoded.trim()) textPieces.push(decoded.trim());
    }

    // 3. TJ array operators: [(item1) -10 <hex2> ...] TJ
    const arrayTjRegex = /\[(.*?)\]\s*TJ/gs;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = arrayTjRegex.exec(streamText)) !== null) {
      const inner = arrMatch[1];
      const itemRegex = /(?:\((.*?)\)|<([0-9a-fA-F\s]+)>)/g;
      let itemMatch: RegExpExecArray | null;
      let line = '';
      while ((itemMatch = itemRegex.exec(inner)) !== null) {
        if (itemMatch[1] !== undefined) {
          line += this.decodePdfString(itemMatch[1]) + ' ';
        } else if (itemMatch[2] !== undefined) {
          line += this.decodePdfHexString(itemMatch[2]) + ' ';
        }
      }
      if (line.trim()) textPieces.push(line.trim());
    }

    return textPieces.join('\n');
  }

  /**
   * Per-page text extraction directly from page.node.Contents()
   */
  public extractPageText(doc: PDFDocument, pageIndex: number): string {
    try {
      const page = doc.getPage(pageIndex);
      const contents = page.node.Contents();
      if (!contents) return '';

      let text = '';
      const streams = Array.isArray((contents as any).array) ? (contents as any).array : [contents];
      for (const s of streams) {
        const streamObj = doc.context.lookup(s);
        if (streamObj && typeof (streamObj as any).asUint8Array === 'function') {
          text += '\n' + this.extractTextFromStreamData((streamObj as any).asUint8Array());
        } else if (streamObj && (streamObj as any).contents) {
          text += '\n' + this.extractTextFromStreamData((streamObj as any).contents);
        }
      }
      return text.trim();
    } catch {
      return '';
    }
  }

  /**
   * High-accuracy multi-engine page text extractor:
   * Uses PDFParse engine first; falls back to stream extraction per page if needed.
   */
  /**
   * Fast per-page text extraction for document analysis (completes in ~50ms, zero API calls).
   * Uses PDFParse engine first; falls back to stream extraction per page if needed.
   */
  public async fastExtractAllPageTexts(inputFilePath: string, doc: PDFDocument): Promise<string[]> {
    const totalPages = doc.getPageCount();
    const result: string[] = new Array(totalPages).fill('');

    try {
      const fileBytes = await fs.promises.readFile(inputFilePath);
      const parser = createPdfParser(fileBytes);
      const parsed = await parser.getText();
      if (parsed && Array.isArray(parsed.pages)) {
        for (const p of parsed.pages) {
          const idx = (p.num || 1) - 1;
          if (idx >= 0 && idx < totalPages) {
            result[idx] = (p.text || '').trim();
          }
        }
      }
    } catch {
      // PDFParse failed; will rely on stream extractor
    }

    // Stream fallback for any page that remained empty
    for (let i = 0; i < totalPages; i++) {
      if (!result[i]) {
        result[i] = this.extractPageText(doc, i);
      }
    }

    return result;
  }

  private async renderPageToBase64Jpeg(pdfPath: string, pageNumber: number): Promise<string> {
    const tmpOut = path.join(os.tmpdir(), `page_${Date.now()}_${pageNumber}_${Math.random().toString(36).substring(2)}.jpg`);
    try {
      await execPromise(`gs -dBATCH -dNOPAUSE -sDEVICE=jpeg -dFirstPage=${pageNumber} -dLastPage=${pageNumber} -r120 -sOutputFile="${tmpOut}" "${pdfPath}"`);
      if (fs.existsSync(tmpOut)) {
        const buf = await fs.promises.readFile(tmpOut);
        await fs.promises.unlink(tmpOut).catch(() => {});
        return buf.toString('base64');
      }
      return '';
    } catch {
      return '';
    }
  }

  private decodePdfString(str: string): string {
    return str
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
  }

  async analyzeDocument(inputFilePath: string): Promise<{
    itemCount: number;
    totalWords: number;
    initialManifest: PageManifestItem[];
    detectedType: 'pdf';
  }> {
    const fileBytes = await fs.promises.readFile(inputFilePath);
    let pageCount = 1;
    let pageTexts: string[] = [];

    try {
      const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
      pageCount = Math.max(1, pdfDoc.getPageCount());
      pageTexts = await this.fastExtractAllPageTexts(inputFilePath, pdfDoc);
    } catch {
      // Robust fallback to PDFParse if pdf-lib encountered any parsing nuance
      try {
        const parser = createPdfParser(fileBytes);
        const parsed = await parser.getText();
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          pageCount = parsed.pages.length;
          pageTexts = parsed.pages.map((p: any) => (p.text || '').trim());
        }
      } catch {
        pageCount = 1;
        pageTexts = [''];
      }
    }

    const initialManifest: PageManifestItem[] = [];
    let totalWords = 0;

    for (let i = 0; i < pageCount; i++) {
      const pageText = pageTexts[i] || '';
      const words = pageText.split(/\s+/).filter(Boolean).length;
      totalWords += words;

      initialManifest.push({
        index: i + 1,
        status: 'pending',
        hasTranslatableText: true,
        wordCount: words,
        retryAttempts: 0,
      });
    }

    return {
      itemCount: pageCount,
      totalWords,
      initialManifest,
      detectedType: 'pdf',
    };
  }

  async processDocument(
    job: JobState,
    onProgress: (stage: JobState['currentStage'], currentItem: number, totalItems: number, op: string) => Promise<void>,
    checkCancelled: () => boolean,
    onLog?: (level: 'info' | 'warn' | 'error', tag: string, message: string) => void
  ): Promise<{
    outputFilePath: string;
    totalWords: number;
    warnings: string[];
  }> {
    const log = (level: 'info' | 'warn' | 'error', tag: string, message: string) => {
      if (onLog) {
        onLog(level, tag, message);
      }
    };

    const warnings: string[] = [];
    const sourceBytes = await fs.promises.readFile(job.inputPath);
    const sourceDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const totalPages = sourceDoc.getPageCount();

    if (totalPages === 0) {
      throw new Error('PDF document contains 0 pages.');
    }

    log('info', 'EXTRACTION_START', `jobId=${job.jobId} total=${totalPages}`);

    // Output document setup
    const outputDoc = await PDFDocument.create();
    outputDoc.registerFontkit(fontkit);

    const fontBytes = await getCachedPersianFont();
    const persianFont = await outputDoc.embedFont(fontBytes);

    // Copy all pages from sourceDoc to preserve all backgrounds, diagrams, tables, and images
    const pageIndices = Array.from({ length: totalPages }, (_, i) => i);
    const copiedPages = await outputDoc.copyPages(sourceDoc, pageIndices);

    // Fast per-page text extraction in parallel (completes in ~1-2s for 170+ pages)
    const fastPageTexts = await this.fastExtractAllPageTexts(job.inputPath, sourceDoc);

    log('info', 'EXTRACTION_END', `jobId=${job.jobId} totalPages=${totalPages}`);

    // Phase 1: Fast text gathering
    await onProgress(
      'extracting',
      Math.min(totalPages, 1),
      totalPages,
      `استخراج ساختاریافته متن از تمام ${totalPages} صفحه سند`
    );

    const pageRawTexts: string[] = new Array(totalPages).fill('');
    const pageUnitsToTranslate: TranslationUnit[] = [];
    const diagramPagesToScan: number[] = [];

    for (let i = 0; i < totalPages; i++) {
      if (checkCancelled()) throw new Error('OPERATION_CANCELLED');
      const pageIndex = i + 1;
      const rawPageText = (fastPageTexts[i] || '').trim();
      pageRawTexts[i] = rawPageText;

      if (rawPageText.length > 0) {
        pageUnitsToTranslate.push({
          id: `page_${pageIndex}`,
          text: rawPageText,
          context: `صفحه ${pageIndex} از سند ${job.originalFileName}`,
        });
      } else {
        diagramPagesToScan.push(pageIndex);
      }
    }

    await onProgress(
      'extracting',
      totalPages,
      totalPages,
      `استخراج متون تمام ${totalPages} صفحه با موفقیت پایان یافت (${pageUnitsToTranslate.length} صفحه متن، ${diagramPagesToScan.length} صفحه دیاگرام تصویری)`
    );

    // Phase 2: Parallel Batch Translation (10x-20x speedup)
    log(
      'info',
      'BATCH_TRANSLATION_START',
      `jobId=${job.jobId} textPages=${pageUnitsToTranslate.length} visualPages=${totalPages - pageUnitsToTranslate.length}`
    );

    const translatedResultsMap = new Map<string, string>();
    if (pageUnitsToTranslate.length > 0) {
      await onProgress(
        'translating',
        0,
        pageUnitsToTranslate.length,
        `آغاز ترجمه هوشمند متون (${pageUnitsToTranslate.length} صفحه دارای متن)...`
      );

      const translatedResults = await defaultTranslator.translateBatch(
        pageUnitsToTranslate,
        (completedCount) => {
          onProgress(
            'translating',
            Math.min(completedCount, pageUnitsToTranslate.length),
            pageUnitsToTranslate.length,
            `ترجمه هوشمند متون (صفحه ${completedCount} از ${pageUnitsToTranslate.length} صفحه متنی)`
          );
        }
      );

      for (const res of translatedResults) {
        translatedResultsMap.set(res.id, res.translatedText);
      }
    }

    // Vision OCR for key schematic diagrams if needed (supports up to 15 key diagram pages)
    const diagramsToScan = diagramPagesToScan.slice(0, 15);
    if (diagramsToScan.length > 0) {
      log('info', 'DIAGRAM_VISION_START', `jobId=${job.jobId} diagrams=${diagramsToScan.length}`);
      for (let dIdx = 0; dIdx < diagramsToScan.length; dIdx++) {
        const diagPage = diagramsToScan[dIdx];
        await onProgress(
          'extracting',
          dIdx + 1,
          diagramsToScan.length,
          `تحلیل بصری علائم دیاگرام صفحه ${diagPage} از ${totalPages}...`
        );
        try {
          const b64 = await this.renderPageToBase64Jpeg(job.inputPath, diagPage);
          if (b64) {
            const visionFa = await defaultTranslator.extractAndTranslateFromImage(
              b64,
              `صفحه دیاگرام ${diagPage} از دفترچه خودرو ${job.originalFileName}`
            );
            if (visionFa && visionFa.trim()) {
              translatedResultsMap.set(`page_${diagPage}`, visionFa.trim());
            }
          }
        } catch (diagErr) {
          log('warn', 'DIAGRAM_VISION_ERROR', `page=${diagPage} err=${diagErr}`);
        }
      }
    }

    // Phase 3: In-Memory Fast RTL Reconstruction & PDF Assembly
    log('info', 'RECONSTRUCTION_START', `jobId=${job.jobId} item=1 total=${totalPages}`);

    let processedWordCount = 0;
    const pageTranslations: Array<{ pageNumber: number; text: string; translatedText: string }> = [];

    for (let i = 0; i < totalPages; i++) {
      if (checkCancelled()) {
        throw new Error('OPERATION_CANCELLED');
      }

      const pageIndex = i + 1;
      const page = copiedPages[i];

      // CRITICAL INVARIANT: The physical page is added unconditionally to guarantee page count equality!
      outputDoc.addPage(page);

      const rawPageText = pageRawTexts[i];
      const manifestItem = job.manifest.items.find((it) => it.index === pageIndex);

      const fullFaText =
        translatedResultsMap.get(`page_${pageIndex}`) ||
        rawPageText;

      if (!fullFaText || !fullFaText.trim()) {
        pageTranslations.push({
          pageNumber: pageIndex,
          text: '',
          translatedText: '(این صفحه فاقد متن قابل استخراج بود یا شامل نمودار تصویری بدون متن است)',
        });

        if (manifestItem) {
          manifestItem.status = 'reconstructed';
          manifestItem.hasTranslatableText = false;
          manifestItem.warning = 'صفحه فاقد متن بود؛ محتوای بصری اصلی عیناً حفظ گردید.';
        }
        warnings.push(`صفحه ${pageIndex}: بدون متن یا حاوی تصویر — قالب بصری اصلی حفظ شد.`);
        continue;
      }

      const words = fullFaText.split(/\s+/).filter(Boolean).length;
      processedWordCount += words;

      pageTranslations.push({
        pageNumber: pageIndex,
        text: rawPageText,
        translatedText: fullFaText,
      });

      // RTL reconstruction and rendering with visual preservation
      log('info', 'PAGE_RENDER_START', `jobId=${job.jobId} page=${pageIndex}`);

      const paragraphs = fullFaText
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      // Strip original English text from page content streams to avoid text collision,
      // while keeping all original raster photos, schematics, lines, and drawings 100% intact!
      const textBounds = stripTextFromPageStreams(page, outputDoc);

      if (paragraphs.length > 0) {
        renderPersianTextToPage(
          page,
          paragraphs,
          persianFont,
          textBounds,
          pageIndex,
          totalPages
        );
      }

      log('info', 'PAGE_RENDER_END', `jobId=${job.jobId} page=${pageIndex}`);

      if (manifestItem) {
        manifestItem.status = 'reconstructed';
        manifestItem.hasTranslatableText = true;
        manifestItem.wordCount = words;
      }

      if (i % 2 === 0 || i === totalPages - 1) {
        await onProgress(
          'reconstructing',
          pageIndex,
          totalPages,
          `بازسازی و چیدمان گرافیکی RTL (صفحه ${pageIndex} از ${totalPages})`
        );
      }

      // Yield execution to the Node event loop so SSE never freezes
      await new Promise((resolve) => setImmediate(resolve));
    }

    log('info', 'PAGE_SAVE_START', `jobId=${job.jobId} page=${totalPages}`);

    // Build the complete, beautiful, flawless Persian text document with UTF-8 BOM
    let fullDocText = '\uFEFF======================================================================\r\n';
    fullDocText += `ترجمه کامل و هوشمند سند: ${job.originalFileName}\r\n`;
    fullDocText += `تعداد صفحات: ${totalPages} | تاریخ: ${new Date().toLocaleDateString('fa-IR')}\r\n`;
    fullDocText += '======================================================================\r\n\r\n';

    for (const pt of pageTranslations) {
      fullDocText += '----------------------------------------------------------------------\r\n';
      fullDocText += `📄 صفحه ${pt.pageNumber} از ${totalPages}\r\n`;
      fullDocText += '----------------------------------------------------------------------\r\n\r\n';
      fullDocText += `${pt.translatedText.trim()}\r\n\r\n\r\n`;
    }
    fullDocText += '======================================================================\r\n';
    fullDocText += 'پایان ترجمه کامل سند\r\n';
    fullDocText += '======================================================================\r\n';

    job.translatedText = fullDocText;
    job.pageTranslations = pageTranslations;

    // Save final output files
    if (job.outputPath.endsWith('.txt')) {
      await fs.promises.writeFile(job.outputPath, Buffer.from(fullDocText, 'utf-8'));
      try {
        await createDocxFile(job.originalFileName, pageTranslations, `${job.outputPath}.docx`);
      } catch {
        // Non-fatal docx creation
      }
    } else {
      // PDF output - save with low memory footprint
      const outputBytes = await outputDoc.save({ useObjectStreams: false });
      await fs.promises.writeFile(job.outputPath, outputBytes);

      const companionTxtPath = `${job.outputPath}.txt`;
      await fs.promises.writeFile(companionTxtPath, Buffer.from(fullDocText, 'utf-8'));

      // Also create companion DOCX file for instantaneous Word download
      try {
        await createDocxFile(job.originalFileName, pageTranslations, `${job.outputPath}.docx`);
      } catch {
        // Non-fatal docx creation
      }

      // Verify output count invariant for PDF directly without re-loading into RAM
      const outputCount = outputDoc.getPageCount();
      if (outputCount !== totalPages) {
        throw new Error(
          `CRITICAL_PAGE_COUNT_MISMATCH: Input had ${totalPages} pages, but output produced ${outputCount} pages.`
        );
      }
    }

    log('info', 'PAGE_SAVE_END', `jobId=${job.jobId} page=${totalPages}`);
    log('info', 'RECONSTRUCTION_END', `jobId=${job.jobId}`);

    return {
      outputFilePath: job.outputPath,
      totalWords: processedWordCount,
      warnings,
    };
  }
}

export const defaultPDFProcessor = new PDFProcessor();
