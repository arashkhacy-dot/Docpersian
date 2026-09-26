import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import { config } from '../config/env.js';

export interface DownloadedFileInfo {
  tempFilePath: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Normalizes cloud storage and sharing URLs (Google Drive, Dropbox, OneDrive, Google Docs/Slides)
 */
export function normalizeCloudUrl(rawUrl: string): { downloadUrl: string; inferredName?: string } {
  const url = rawUrl.trim();

  // 1. Google Slides (e.g. docs.google.com/presentation/d/ID/...)
  const slidesMatch = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slidesMatch) {
    return {
      downloadUrl: `https://docs.google.com/presentation/d/${slidesMatch[1]}/export/pptx`,
      inferredName: 'presentation.pptx',
    };
  }

  // 2. Google Docs (e.g. docs.google.com/document/d/ID/...)
  const docMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch) {
    return {
      downloadUrl: `https://docs.google.com/document/d/${docMatch[1]}/export?format=docx`,
      inferredName: 'document.docx',
    };
  }

  // 3. Google Drive file (e.g. drive.google.com/file/d/ID/... or drive.google.com/open?id=ID)
  const driveFileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                         url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/) ||
                         url.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (driveFileMatch) {
    const fileId = driveFileMatch[1];
    return {
      downloadUrl: `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`,
      inferredName: 'drive_document',
    };
  }

  // 4. Dropbox links
  if (url.includes('dropbox.com')) {
    const dropboxUrl = url.replace(/[?&]dl=0/, '').replace(/[?&]dl=1/, '');
    const separator = dropboxUrl.includes('?') ? '&' : '?';
    return {
      downloadUrl: `${dropboxUrl}${separator}dl=1`,
    };
  }

  return { downloadUrl: url };
}

/**
 * Downloads a file from a URL / Google Drive link directly into server storage
 */
export async function downloadFileFromUrl(
  inputUrl: string,
  userFileName?: string
): Promise<DownloadedFileInfo> {
  const { downloadUrl, inferredName } = normalizeCloudUrl(inputUrl);

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: '*/*',
  };

  const response = await fetch(downloadUrl, {
    headers,
    redirect: 'follow',
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('فایل در لینک ارائه شده یافت نشد یا دسترسی به آن محدود (Private) است. لطفاً دسترسی لینک در گوگل درایو را روی «Anyone with the link / هر کسی دارای پیوند» تنظیم فرمایید.');
    }
    throw new Error(`خطا در دانلود فایل از لینک مورد نظر (کد پاسخ سرور: ${response.status}).`);
  }

  // Check content type
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html') && !downloadUrl.includes('docs.google.com')) {
    // If Google Drive returned an HTML warning or login page
    const textSample = await response.text();
    if (textSample.includes('Google Drive – Virus scan warning') || textSample.includes('confirm=')) {
      const confirmMatch = textSample.match(/confirm=([0-9A-Za-z_-]+)/);
      if (confirmMatch) {
        const confirmedUrl = `${downloadUrl}&confirm=${confirmMatch[1]}`;
        const retryRes = await fetch(confirmedUrl, { headers, redirect: 'follow' });
        if (retryRes.ok) {
          return processResponseStream(retryRes, userFileName, inferredName, inputUrl);
        }
      }
    }
    throw new Error('لینک ارائه شده به صفحه وب منتهی می‌شود نه فایل سند. لطفاً لینک مستقیم فایل را بررسی فرمایید.');
  }

  return processResponseStream(response, userFileName, inferredName, inputUrl);
}

async function processResponseStream(
  response: any,
  userFileName?: string,
  inferredName?: string,
  originalUrl?: string
): Promise<DownloadedFileInfo> {
  // Extract filename
  let fileName = userFileName?.trim() || '';

  if (!fileName) {
    const contentDisposition = response.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
    if (match && match[1]) {
      try {
        fileName = decodeURIComponent(match[1].trim());
      } catch {
        fileName = match[1].trim();
      }
    }
  }

  if (!fileName && inferredName && inferredName.includes('.')) {
    fileName = inferredName;
  }

  if (!fileName && originalUrl) {
    try {
      const parsed = new URL(originalUrl);
      const base = path.basename(parsed.pathname);
      if (base && ['.pdf', '.docx', '.pptx'].some((ext) => base.toLowerCase().endsWith(ext))) {
        fileName = decodeURIComponent(base);
      }
    } catch {
      // ignore
    }
  }

  // Check content length
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const size = parseInt(contentLengthHeader, 10);
    if (size > config.maxFileSize) {
      throw new Error(`حجم فایل در این لینک (${Math.round(size / (1024 * 1024))} مگابایت) بیش از سقف مجاز (${Math.round(config.maxFileSize / (1024 * 1024))} مگابایت) است.`);
    }
  }

  // Stream directly to temporary folder
  const tempId = crypto.randomUUID();
  const tempDir = path.join(config.storagePath, 'uploads_temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `url_download_${tempId}.tmp`);
  const fileStream = fs.createWriteStream(tempFilePath);

  let downloadedBytes = 0;
  // Node fetch body is a ReadableStream or NodeJS Readable
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloadedBytes += value.length;
      if (downloadedBytes > config.maxFileSize) {
        fileStream.close();
        await fs.promises.unlink(tempFilePath).catch(() => {});
        throw new Error(`حجم فایل بیش از سقف مجاز سرور است.`);
      }
      await new Promise<void>((resolve, reject) => {
        fileStream.write(value, (err: any) => (err ? reject(err) : resolve()));
      });
    }
  } else {
    // ArrayBuffer fallback
    const arrayBuffer = await response.arrayBuffer();
    downloadedBytes = arrayBuffer.byteLength;
    if (downloadedBytes > config.maxFileSize) {
      throw new Error(`حجم فایل بیش از سقف مجاز سرور است.`);
    }
    await fs.promises.writeFile(tempFilePath, Buffer.from(arrayBuffer));
  }

  await new Promise<void>((resolve) => fileStream.end(resolve));

  // Determine true format by inspecting magic bytes and ZIP structure
  let detectedExt = '';
  try {
    const magicBuffer = Buffer.alloc(16);
    const fd = fs.openSync(tempFilePath, 'r');
    fs.readSync(fd, magicBuffer, 0, 16, 0);
    fs.closeSync(fd);

    if (magicBuffer[0] === 0x25 && magicBuffer[1] === 0x50 && magicBuffer[2] === 0x44 && magicBuffer[3] === 0x46) {
      detectedExt = '.pdf';
    } else if (magicBuffer[0] === 0x50 && magicBuffer[1] === 0x4b && magicBuffer[2] === 0x03 && magicBuffer[3] === 0x04) {
      const fileBytes = await fs.promises.readFile(tempFilePath);
      const zip = await JSZip.loadAsync(fileBytes);
      const files = Object.keys(zip.files);
      if (files.some((f) => f.startsWith('ppt/') || f.includes('presentation.xml') || f.includes('slide'))) {
        detectedExt = '.pptx';
      } else if (files.some((f) => f.startsWith('word/') || f.includes('document.xml'))) {
        detectedExt = '.docx';
      }
    }
  } catch (inspectErr) {
    console.warn('[DOWNLOAD_INSPECT_WARNING]', inspectErr);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  let ext = detectedExt || path.extname(fileName).toLowerCase();

  if (!ext) {
    if (contentType.includes('presentation') || contentType.includes('powerpoint')) ext = '.pptx';
    else if (contentType.includes('word') || contentType.includes('document')) ext = '.docx';
    else if (contentType.includes('pdf')) ext = '.pdf';
    else ext = '.pptx';
  }

  const currentExt = path.extname(fileName).toLowerCase();
  if (!currentExt || currentExt !== ext) {
    const baseName = currentExt ? path.basename(fileName, currentExt) : (fileName || 'downloaded_document');
    fileName = `${baseName}${ext}`;
  }

  return {
    tempFilePath,
    originalFileName: fileName,
    fileSize: downloadedBytes,
    mimeType: contentType || 'application/octet-stream',
  };
}
