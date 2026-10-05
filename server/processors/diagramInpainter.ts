import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import arabicPersianReshaper from 'arabic-persian-reshaper';
import { defaultTranslator, DiagramTextLabel } from '../gemini/translator.js';

const execPromise = promisify(exec);

// Path to embedded high-fidelity Persian font
const PERSIAN_BOLD_FONT = path.resolve(process.cwd(), 'server/assets/fonts/persian-font-bold.ttf');
const PERSIAN_REG_FONT = path.resolve(process.cwd(), 'server/assets/fonts/persian-font.ttf');

function getPersianFontPath(): string {
  if (fs.existsSync(PERSIAN_BOLD_FONT)) return PERSIAN_BOLD_FONT;
  if (fs.existsSync(PERSIAN_REG_FONT)) return PERSIAN_REG_FONT;
  return 'DejaVu-Sans';
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function formatPersianVisualText(rawPersian: string): string {
  try {
    // 1. Reshape cursive Arabic/Persian letters to presentation forms (e.g. ﺟﻌﺒﻪ)
    const reshaped = arabicPersianReshaper.ArabicShaper.convertArabic(rawPersian);
    // 2. Reverse character order for left-to-right raster graphics engines like ImageMagick/FreeType
    return reshaped.split('').reverse().join('');
  } catch {
    return rawPersian;
  }
}

export class DiagramInpainter {
  private cache = new Map<string, { buffer: Buffer; modified: boolean; replacedCount: number }>();
  private readonly maxCacheSize = 200;

  /**
   * Translates and cleanly inpaints English text labels directly on a diagram or image
   * using AI Vision (Gemini / Local) and raster typography with Vazirmatn Persian font.
   */
  async inpaintDiagramImage(
    imageBuffer: Buffer,
    mimeType = 'image/png',
    context?: string
  ): Promise<{ buffer: Buffer; modified: boolean; replacedCount: number }> {
    if (!defaultTranslator.isDiagramInpaintingEnabled()) {
      return { buffer: imageBuffer, modified: false, replacedCount: 0 };
    }

    if (!imageBuffer || imageBuffer.length < 500) {
      return { buffer: imageBuffer, modified: false, replacedCount: 0 };
    }

    // 1. Check memory cache by SHA256 of image
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const cached = this.cache.get(hash);
    if (cached) {
      return cached;
    }

    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png';
    const tmpInput = path.join(os.tmpdir(), `diag_in_${Date.now()}_${Math.random().toString(36).substring(2)}${ext}`);
    const tmpOutput = path.join(os.tmpdir(), `diag_out_${Date.now()}_${Math.random().toString(36).substring(2)}${ext}`);

    try {
      await fs.promises.writeFile(tmpInput, imageBuffer);

      // 2. Inspect image dimensions
      let width = 0;
      let height = 0;
      try {
        const { stdout } = await execPromise(`identify -format "%w %h" ${escapeShellArg(tmpInput)}`);
        const parts = stdout.trim().split(/\s+/).map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          width = parts[0];
          height = parts[1];
        }
      } catch {
        // Not a standard raster image or identify failed
        return { buffer: imageBuffer, modified: false, replacedCount: 0 };
      }

      // Filter out tiny icons, decorative dividers, or buttons (< 120px in both dimensions)
      if (width < 120 && height < 120) {
        return { buffer: imageBuffer, modified: false, replacedCount: 0 };
      }

      // 3. Multimodal Diagram Text Detection & Persian Translation
      const b64 = imageBuffer.toString('base64');
      const labels: DiagramTextLabel[] = await defaultTranslator.detectAndTranslateDiagramLabels(
        b64,
        mimeType,
        context
      );

      if (!labels || labels.length === 0) {
        const noOpResult = { buffer: imageBuffer, modified: false, replacedCount: 0 };
        this.addToCache(hash, noOpResult);
        return noOpResult;
      }

      // 4. Construct ImageMagick inpainting command
      const fontPath = getPersianFontPath();
      let imArgs: string[] = [escapeShellArg(tmpInput)];

      let validLabelCount = 0;

      for (const lbl of labels) {
        if (!lbl.box_2d || lbl.box_2d.length !== 4 || !lbl.translatedText) continue;

        const [ymin, xmin, ymax, xmax] = lbl.box_2d;
        // Clamp and compute pixel coordinates
        const x0 = Math.max(0, Math.min(width - 1, Math.round((xmin / 1000) * width)));
        const y0 = Math.max(0, Math.min(height - 1, Math.round((ymin / 1000) * height)));
        const x1 = Math.max(x0 + 1, Math.min(width, Math.round((xmax / 1000) * width)));
        const y1 = Math.max(y0 + 1, Math.min(height, Math.round((ymax / 1000) * height)));

        const boxW = x1 - x0;
        const boxH = y1 - y0;

        if (boxW < 8 || boxH < 6) continue;

        const padX = Math.min(4, Math.max(1, Math.round(boxW * 0.04)));
        const padY = Math.min(4, Math.max(1, Math.round(boxH * 0.04)));

        const inpaintX0 = Math.max(0, x0 - padX);
        const inpaintY0 = Math.max(0, y0 - padY);
        const inpaintX1 = Math.min(width, x1 + padX);
        const inpaintY1 = Math.min(height, y1 + padY);

        const bgColor = lbl.bgColor || '#FFFFFF';
        const textColor = lbl.textColor || '#0F172A';

        // Calculate appropriate font size fitting the bounding box
        const fontSize = Math.max(10, Math.min(36, Math.round(boxH * 0.72)));
        const visualText = formatPersianVisualText(lbl.translatedText);

        // A. Inpaint / wipe original English text with background patch
        imArgs.push(`-fill ${escapeShellArg(bgColor)} -draw ${escapeShellArg(`rectangle ${inpaintX0},${inpaintY0} ${inpaintX1},${inpaintY1}`)}`);

        // B. Draw high-contrast Persian text
        const midY = Math.round(y0 + fontSize * 0.95);
        imArgs.push(
          `-font ${escapeShellArg(fontPath)}`,
          `-pointsize ${fontSize}`,
          `-fill ${escapeShellArg(textColor)}`,
          `-gravity northwest`,
          `-annotate +${x0}+${midY} ${escapeShellArg(visualText)}`
        );

        validLabelCount++;
      }

      if (validLabelCount === 0) {
        const noOpResult = { buffer: imageBuffer, modified: false, replacedCount: 0 };
        this.addToCache(hash, noOpResult);
        return noOpResult;
      }

      imArgs.push(escapeShellArg(tmpOutput));
      const fullCmd = `convert ${imArgs.join(' ')}`;

      await execPromise(fullCmd);

      if (fs.existsSync(tmpOutput)) {
        const outBuf = await fs.promises.readFile(tmpOutput);
        if (outBuf && outBuf.length > 500) {
          const successResult = {
            buffer: outBuf,
            modified: true,
            replacedCount: validLabelCount,
          };
          this.addToCache(hash, successResult);
          return successResult;
        }
      }

      return { buffer: imageBuffer, modified: false, replacedCount: 0 };
    } catch (err) {
      console.warn('[DIAGRAM_INPAINTING_WARN] Failed to inpaint diagram image, keeping original:', err);
      return { buffer: imageBuffer, modified: false, replacedCount: 0 };
    } finally {
      await fs.promises.unlink(tmpInput).catch(() => {});
      await fs.promises.unlink(tmpOutput).catch(() => {});
    }
  }

  private addToCache(hash: string, item: { buffer: Buffer; modified: boolean; replacedCount: number }): void {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(hash, item);
  }
}

export const defaultDiagramInpainter = new DiagramInpainter();
