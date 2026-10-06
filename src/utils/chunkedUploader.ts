export interface UploadProgressInfo {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  currentChunk: number;
  totalChunks: number;
  speedFormatted?: string;
  statusMessage?: string;
  isResuming?: boolean;
  isDirect?: boolean;
}

// Files up to 100 MB use direct single-shot turbo stream (instantaneous, 1 request, 2-3 seconds)
const DIRECT_UPLOAD_THRESHOLD = 100 * 1024 * 1024;

// 10 MB per chunk: Strictly for very large files (> 100MB) or extreme network resilience
export const CHUNK_SIZE = 10 * 1024 * 1024;

const SESSION_STORAGE_PREFIX = 'docushift_upload_session_';

// Track files that failed direct upload in this session so we don't re-attempt direct
const directUploadFailedFiles = new Set<string>();

export function getSessionStorageKey(file: File): string {
  return `${SESSION_STORAGE_PREFIX}${encodeURIComponent(file.name)}_${file.size}`;
}

export function formatUploadSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

/**
 * Checks server for already uploaded chunks in the session
 */
export async function getUploadedChunksFromServer(uploadId: string): Promise<number[]> {
  try {
    const res = await fetch(`/api/upload/${uploadId}/status`);
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.completedChunks) ? data.completedChunks : [];
    }
  } catch {
    // Non-fatal, return empty
  }
  return [];
}

/**
 * Inspects localStorage and validates with server whether an active resumable session exists for this file
 */
export async function checkUploadSession(file: File): Promise<{
  uploadId: string;
  completedChunks: number[];
  totalChunks: number;
  percent: number;
  uploadedBytes: number;
} | null> {
  try {
    const sessionKey = getSessionStorageKey(file);
    const savedSessionRaw = localStorage.getItem(sessionKey);
    if (!savedSessionRaw) return null;

    const savedSession = JSON.parse(savedSessionRaw);
    if (savedSession.fileSize !== file.size || !savedSession.uploadId) {
      localStorage.removeItem(sessionKey);
      return null;
    }

    // Verify with server if session directory is still alive
    const existingChunks = await getUploadedChunksFromServer(savedSession.uploadId);
    if (!existingChunks || existingChunks.length === 0) {
      return null;
    }

    const totalChunks = savedSession.totalChunks || Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let uploadedBytes = 0;
    for (const chunkIdx of existingChunks) {
      const start = chunkIdx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      uploadedBytes += end - start;
    }

    const percent = Math.min(99, Math.round((uploadedBytes / file.size) * 100));

    return {
      uploadId: savedSession.uploadId,
      completedChunks: existingChunks,
      totalChunks,
      percent,
      uploadedBytes,
    };
  } catch {
    return null;
  }
}

/**
 * Clears saved session from localStorage (e.g. when user explicitly cancels or picks a new document)
 */
export function clearUploadSession(file: File): void {
  try {
    const sessionKey = getSessionStorageKey(file);
    localStorage.removeItem(sessionKey);
  } catch {
    // ignore
  }
}

/**
 * Direct Single-Stream Turbo Upload (For small files <= 2MB)
 */
function uploadDirectFile(
  file: File,
  onProgress?: (info: UploadProgressInfo) => void,
  signal?: AbortSignal
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('آپلود توسط کاربر لغو گردید.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file, file.name);

    let watchdogTimer: any = null;
    const resetWatchdog = (timeoutMs = 60000) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        xhr.abort();
        reject(new Error('DIRECT_UPLOAD_STALL'));
      }, timeoutMs);
    };

    const abortHandler = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      xhr.abort();
      reject(new Error('آپلود توسط کاربر متوقف شد.'));
    };
    signal?.addEventListener('abort', abortHandler);

    const startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;
    let smoothedSpeed = 0;

    resetWatchdog();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const now = Date.now();
        const elapsedTotal = Math.max(0.1, (now - startTime) / 1000);
        const timeDiff = (now - lastTime) / 1000;

        if (timeDiff >= 0.15) {
          const bytesDiff = e.loaded - lastLoaded;
          const instantSpeed = bytesDiff / timeDiff;
          smoothedSpeed = smoothedSpeed > 0 ? smoothedSpeed * 0.6 + instantSpeed * 0.4 : instantSpeed;
          lastLoaded = e.loaded;
          lastTime = now;
        } else if (smoothedSpeed === 0) {
          smoothedSpeed = e.loaded / elapsedTotal;
        }

        const isBytesDone = e.loaded >= e.total;
        const percent = isBytesDone ? 99 : Math.min(98, Math.round((e.loaded / e.total) * 100));

        if (isBytesDone) {
          // Upload bytes transferred; wait for server processing without aggressive abort
          resetWatchdog(120000);
        } else {
          resetWatchdog(60000);
        }

        onProgress?.({
          percent,
          uploadedBytes: e.loaded,
          totalBytes: e.total,
          currentChunk: 1,
          totalChunks: 1,
          speedFormatted: formatUploadSpeed(smoothedSpeed),
          isDirect: true,
          statusMessage: isBytesDone
            ? 'ارسال فایل کامل شد؛ در حال پردازش در سرور...'
            : 'در حال ارسال مستقیم سند به سرور...',
        });
      }
    };

    xhr.onload = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      signal?.removeEventListener('abort', abortHandler);

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const job = JSON.parse(xhr.responseText);
          onProgress?.({
            percent: 100,
            uploadedBytes: file.size,
            totalBytes: file.size,
            currentChunk: 1,
            totalChunks: 1,
            speedFormatted: formatUploadSpeed(smoothedSpeed),
            isDirect: true,
            statusMessage: 'فایل با موفقیت ثبت شد؛ ورود به میزکار...',
          });
          resolve(job);
        } catch {
          reject(new Error('پاسخ سرور در قالب نامعتبر دریافت شد.'));
        }
      } else {
        let errMsg = `خطای سرور در دریافت فایل (کد ${xhr.status})`;
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.error) errMsg = res.error;
        } catch {}
        reject(new Error(errMsg));
      }
    };

    xhr.onerror = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('نوسان اتصال شبکه در ارسال مستقیم'));
    };

    xhr.ontimeout = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('مهلت ارسال مستقیم به پایان رسید.'));
    };

    xhr.timeout = 120000;
    xhr.open('POST', '/api/jobs');
    xhr.send(formData);
  });
}

/**
 * Upload single chunk with progress tracking and generous timeouts
 */
function uploadSingleChunkXhr(
  uploadId: string,
  chunkIndex: number,
  chunkBlob: Blob,
  onChunkProgress: (loaded: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('آپلود توسط کاربر لغو گردید.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('chunk', chunkBlob, `chunk_${chunkIndex}.part`);

    let watchdogTimer: any = null;
    const resetWatchdog = (timeoutMs = 60000) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        xhr.abort();
        reject(new Error(`تاخیر در ارسال قطعه ${chunkIndex + 1}`));
      }, timeoutMs);
    };

    const abortHandler = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      xhr.abort();
      reject(new Error('آپلود متوقف شد.'));
    };
    signal?.addEventListener('abort', abortHandler);

    resetWatchdog(60000);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onChunkProgress(e.loaded);
        if (e.loaded >= e.total) {
          // Chunk bytes finished transferring; wait up to 120s for server disk write
          resetWatchdog(120000);
        } else {
          resetWatchdog(60000);
        }
      }
    };

    xhr.onload = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      signal?.removeEventListener('abort', abortHandler);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let errMsg = `خطای سرور در دریافت قطعه ${chunkIndex + 1} (کد ${xhr.status})`;
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.error) errMsg = res.error;
        } catch {}
        reject(new Error(errMsg));
      }
    };

    xhr.onerror = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`نوسان شبکه در ارسال قطعه ${chunkIndex + 1}`));
    };

    xhr.ontimeout = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`تاخیر اتصال شبکه در ارسال قطعه ${chunkIndex + 1}`));
    };

    xhr.timeout = 180000;
    xhr.open('POST', '/api/upload/chunk');
    xhr.send(formData);
  });
}

/**
 * Sequential Resilient Chunked File Uploader with Genuine Persistent Resume
 */
async function uploadFileInParallelChunks(
  file: File,
  onProgress?: (info: UploadProgressInfo) => void,
  signal?: AbortSignal
): Promise<any> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const sessionKey = getSessionStorageKey(file);

  let uploadId: string | null = null;
  let serverChunksAlreadyUploaded: number[] = [];

  // Check if a previous upload session for this file exists and is active on the server
  try {
    const savedSessionRaw = localStorage.getItem(sessionKey);
    if (savedSessionRaw) {
      const savedSession = JSON.parse(savedSessionRaw);
      const isRecent = Date.now() - (savedSession.createdAt || 0) < 24 * 60 * 60 * 1000;
      if (isRecent && savedSession.uploadId && savedSession.fileSize === file.size) {
        const existingChunks = await getUploadedChunksFromServer(savedSession.uploadId);
        if (existingChunks.length > 0) {
          uploadId = savedSession.uploadId;
          serverChunksAlreadyUploaded = existingChunks;
        }
      }
    }
  } catch {
    // Ignore storage parse issues
  }

  // 1. Initialize session on server if not resuming
  if (!uploadId) {
    const initRes = await fetch('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        mimeType: file.type || 'application/octet-stream',
      }),
      signal,
    });

    if (!initRes.ok) {
      const errData = await initRes.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در ثبت و آغاز جلسه آپلود بر روی سرور.');
    }

    const initData = await initRes.json();
    uploadId = initData.uploadId;

    try {
      localStorage.setItem(
        sessionKey,
        JSON.stringify({
          uploadId,
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
          createdAt: Date.now(),
        })
      );
    } catch {
      // Non-fatal
    }
  }

  const completedChunksSet = new Set<number>(serverChunksAlreadyUploaded);
  const activeChunkProgress = new Map<number, number>();

  // Speed calculation metrics
  const sessionStartTime = Date.now();
  let lastCalcTime = sessionStartTime;
  let lastTotalUploaded = 0;
  let currentSpeed = 0;

  const calculateTotalUploadedBytes = (): number => {
    let bytes = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (completedChunksSet.has(i)) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        bytes += end - start;
      } else if (activeChunkProgress.has(i)) {
        bytes += activeChunkProgress.get(i)!;
      }
    }
    return Math.min(file.size, bytes);
  };

  const notifyProgress = (statusMsg?: string) => {
    const totalBytesLoaded = calculateTotalUploadedBytes();
    const now = Date.now();
    const timeDiff = (now - lastCalcTime) / 1000;
    const totalElapsed = Math.max(0.1, (now - sessionStartTime) / 1000);

    if (timeDiff >= 0.15) {
      const bytesDiff = totalBytesLoaded - lastTotalUploaded;
      const instantSpeed = bytesDiff / timeDiff;
      currentSpeed = currentSpeed > 0 ? currentSpeed * 0.6 + instantSpeed * 0.4 : instantSpeed;
      lastTotalUploaded = totalBytesLoaded;
      lastCalcTime = now;
    } else if (currentSpeed === 0 && totalBytesLoaded > 0) {
      currentSpeed = totalBytesLoaded / totalElapsed;
    }

    const percent = Math.min(99, Math.round((totalBytesLoaded / file.size) * 100));
    onProgress?.({
      percent,
      uploadedBytes: totalBytesLoaded,
      totalBytes: file.size,
      currentChunk: Math.min(totalChunks, completedChunksSet.size + 1),
      totalChunks,
      speedFormatted: formatUploadSpeed(currentSpeed),
      statusMessage: statusMsg,
      isResuming: completedChunksSet.size > 0,
      isDirect: false,
    });
  };

  if (completedChunksSet.size > 0) {
    notifyProgress(
      `ادامه ارسال از قطعه ${completedChunksSet.size + 1} (${completedChunksSet.size} قطعه از قبل روی سرور موجود است)`
    );
  }

  // 2. Sequential Upload Loop
  const pendingIndices: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!completedChunksSet.has(i)) {
      pendingIndices.push(i);
    }
  }

  const retryDelays = [1500, 3000, 6000, 10000];

  for (const chunkIndex of pendingIndices) {
    if (signal?.aborted) throw new Error('آپلود توسط کاربر لغو گردید.');

    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBlob = file.slice(start, end);

    let chunkUploaded = false;
    let lastErr: any = null;

    for (let attempt = 1; attempt <= retryDelays.length + 1; attempt++) {
      if (signal?.aborted) throw new Error('آپلود توسط کاربر لغو گردید.');

      try {
        notifyProgress(
          attempt > 1
            ? `تلاش مجدد برای قطعه ${chunkIndex + 1} از ${totalChunks} (نوبت ${attempt})...`
            : totalChunks > 1
            ? `در حال ارسال قطعه ${chunkIndex + 1} از ${totalChunks}...`
            : 'در حال ارسال فایل به سرور...'
        );

        await uploadSingleChunkXhr(
          uploadId!,
          chunkIndex,
          chunkBlob,
          (loadedInChunk) => {
            activeChunkProgress.set(chunkIndex, loadedInChunk);
            notifyProgress(
              totalChunks > 1
                ? `در حال ارسال قطعه ${chunkIndex + 1} از ${totalChunks}`
                : undefined
            );
          },
          signal
        );

        completedChunksSet.add(chunkIndex);
        activeChunkProgress.delete(chunkIndex);
        chunkUploaded = true;
        notifyProgress();
        break;
      } catch (err: any) {
        lastErr = err;
        activeChunkProgress.delete(chunkIndex);

        // Check if server actually accepted the chunk despite network blip
        const serverChunks = await getUploadedChunksFromServer(uploadId!);
        if (serverChunks.includes(chunkIndex)) {
          completedChunksSet.add(chunkIndex);
          chunkUploaded = true;
          notifyProgress();
          break;
        }

        if (attempt <= retryDelays.length) {
          notifyProgress(`نوسان شبکه؛ تلاش مجدد برای قطعه ${chunkIndex + 1} پس از وقفه کوتاه...`);
          await new Promise((r) => setTimeout(r, retryDelays[attempt - 1]));
        }
      }
    }

    if (!chunkUploaded) {
      // CRITICAL: We DO NOT remove sessionKey from localStorage here!
      // This allows the user to click resume and continue from this exact chunk without restarting from 0!
      throw (
        lastErr ||
        new Error(
          `ارسال قطعه ${chunkIndex + 1} از ${totalChunks} به دلیل نوسان شبکه متوقف شد. اطلاعات قطعات ذخیره شده و می‌توانید ارسال را ادامه دهید.`
        )
      );
    }
  }

  // 3. Final completion call to merge chunks and create job
  onProgress?.({
    percent: 99,
    uploadedBytes: file.size,
    totalBytes: file.size,
    currentChunk: totalChunks,
    totalChunks,
    speedFormatted: formatUploadSpeed(currentSpeed),
    statusMessage: 'ارسال پایان یافت؛ در حال یکپارچه‌سازی و اعتبارسنجی سند در سرور...',
    isDirect: false,
  });

  const compRes = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
    signal,
  });

  if (!compRes.ok) {
    const errData = await compRes.json().catch(() => ({}));
    throw new Error(errData.error || 'خطا در یکپارچه‌سازی و اعتبارسنجی سند در سرور.');
  }

  // ONLY clear completed session from localStorage after 100% success!
  try {
    localStorage.removeItem(sessionKey);
  } catch {
    // Non-fatal
  }

  const job = await compRes.json();
  onProgress?.({
    percent: 100,
    uploadedBytes: file.size,
    totalBytes: file.size,
    currentChunk: totalChunks,
    totalChunks,
    speedFormatted: formatUploadSpeed(currentSpeed),
    statusMessage: 'سند با موفقیت تایید شد؛ ورود به میزکار...',
    isDirect: false,
  });

  return job;
}

/**
 * Main Entry Point: Intelligent High-Speed File Uploader
 */
export async function uploadFileInChunks(
  file: File,
  onProgress?: (info: UploadProgressInfo) => void,
  signal?: AbortSignal
): Promise<any> {
  const sessionKey = getSessionStorageKey(file);

  // For all standard files (<= 100MB), always prioritize direct fast upload
  // and clear any stale chunk sessions from localStorage to prevent slow chunk loops
  if (file.size <= DIRECT_UPLOAD_THRESHOLD) {
    try {
      localStorage.removeItem(sessionKey);
    } catch {}

    // Only fallback to chunked if direct upload explicitly failed in current execution session
    if (!directUploadFailedFiles.has(sessionKey)) {
      try {
        return await uploadDirectFile(file, onProgress, signal);
      } catch (err: any) {
        if (signal?.aborted) throw err;
        console.warn('[DIRECT_UPLOAD_FALLBACK_TO_CHUNKS]', err);
        directUploadFailedFiles.add(sessionKey);
      }
    }
    return await uploadFileInParallelChunks(file, onProgress, signal);
  }

  // Files > 100 MB use resumable chunked upload
  const savedSessionRaw = localStorage.getItem(sessionKey);
  if (savedSessionRaw) {
    return await uploadFileInParallelChunks(file, onProgress, signal);
  }

  return await uploadFileInParallelChunks(file, onProgress, signal);
}
