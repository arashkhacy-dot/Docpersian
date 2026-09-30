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

// Direct upload for all files up to 20 MB (lightning fast, single stream, safe for Cloud Run & mobile)
const DIRECT_UPLOAD_THRESHOLD = 20 * 1024 * 1024;

// 2 MB chunks: Fast throughput without high HTTP overhead (10-20x fewer requests than 512KB)
const CHUNK_SIZE = 2 * 1024 * 1024;

const SESSION_STORAGE_PREFIX = 'docushift_upload_session_';

// Track files that failed direct upload in this session so we don't retry direct on them
const directUploadFailedFiles = new Set<string>();

function getSessionStorageKey(file: File): string {
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
async function getUploadedChunksFromServer(uploadId: string): Promise<number[]> {
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
 * Direct Single-Stream Turbo Upload (Best for files <= 20MB)
 * Fast, reliable, no chunking overhead, directly supported by browser native upload engine.
 * Includes a 12-second stall watchdog to failover instantly if connection stalls.
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

    let stallTimer: any = null;
    const resetStallWatchdog = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        xhr.abort();
        reject(new Error('DIRECT_UPLOAD_STALL'));
      }, 15000); // 15 seconds without any bytes transferred triggers instant fallback
    };

    const abortHandler = () => {
      if (stallTimer) clearTimeout(stallTimer);
      xhr.abort();
      reject(new Error('آپلود توسط کاربر متوقف شد.'));
    };
    signal?.addEventListener('abort', abortHandler);

    const startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;
    let smoothedSpeed = 0;

    resetStallWatchdog();

    xhr.upload.onprogress = (e) => {
      resetStallWatchdog();

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

        onProgress?.({
          percent,
          uploadedBytes: e.loaded,
          totalBytes: e.total,
          currentChunk: 1,
          totalChunks: 1,
          speedFormatted: formatUploadSpeed(smoothedSpeed),
          isDirect: true,
          statusMessage: isBytesDone
            ? 'ارسال فایل کامل شد؛ در حال ثبت و آغاز در سرور...'
            : 'در حال ارسال مستقیم سند به سرور...',
        });
      }
    };

    xhr.onload = () => {
      if (stallTimer) clearTimeout(stallTimer);
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
        } catch (parseErr) {
          reject(new Error('پاسخ سرور در قالب نامعتبر دریافت شد.'));
        }
      } else {
        let errMsg = `خطای سرور در دریافت فایل (کد ${xhr.status})`;
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.error) errMsg = res.error;
        } catch {
          // ignore
        }
        reject(new Error(errMsg));
      }
    };

    xhr.onerror = () => {
      if (stallTimer) clearTimeout(stallTimer);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('نوسان اتصال شبکه در ارسال مستقیم'));
    };

    xhr.ontimeout = () => {
      if (stallTimer) clearTimeout(stallTimer);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error('مهلت ارسال مستقیم به پایان رسید.'));
    };

    xhr.timeout = 60000; // 60 seconds total timeout
    xhr.open('POST', '/api/jobs');
    xhr.send(formData);
  });
}

/**
 * Upload single 2MB chunk with progress tracking and 35s watchdog
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

    let chunkWatchdog: any = null;
    const resetWatchdog = () => {
      if (chunkWatchdog) clearTimeout(chunkWatchdog);
      chunkWatchdog = setTimeout(() => {
        xhr.abort();
        reject(new Error(`تاخیر در ارسال قطعه ${chunkIndex + 1}`));
      }, 35000);
    };

    const abortHandler = () => {
      if (chunkWatchdog) clearTimeout(chunkWatchdog);
      xhr.abort();
      reject(new Error('آپلود متوقف شد.'));
    };
    signal?.addEventListener('abort', abortHandler);

    resetWatchdog();

    xhr.upload.onprogress = (e) => {
      resetWatchdog();
      if (e.lengthComputable) {
        onChunkProgress(e.loaded);
      }
    };

    xhr.onload = () => {
      if (chunkWatchdog) clearTimeout(chunkWatchdog);
      signal?.removeEventListener('abort', abortHandler);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let errMsg = `خطای سرور در دریافت قطعه ${chunkIndex + 1} (کد ${xhr.status})`;
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.error) errMsg = res.error;
        } catch {
          // ignore
        }
        reject(new Error(errMsg));
      }
    };

    xhr.onerror = () => {
      if (chunkWatchdog) clearTimeout(chunkWatchdog);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`نوسان شبکه در ارسال قطعه ${chunkIndex + 1}`));
    };

    xhr.ontimeout = () => {
      if (chunkWatchdog) clearTimeout(chunkWatchdog);
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(`تاخیر اتصال شبکه در ارسال قطعه ${chunkIndex + 1}`));
    };

    xhr.timeout = 45000;
    xhr.open('POST', '/api/upload/chunk');
    xhr.send(formData);
  });
}

/**
 * Sequential Resilient 2MB Chunked File Uploader
 * Slices files into 2MB chunks and uploads sequentially with auto-resume.
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
      const isRecent = Date.now() - (savedSession.createdAt || 0) < 60 * 60 * 1000;
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

  // 1. Initialize session if not resuming
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

  const retryDelays = [800, 1500, 3000];

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

        // Check if server actually accepted chunk despite network blip
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
      try {
        localStorage.removeItem(sessionKey);
      } catch {
        // ignore
      }
      throw (
        lastErr ||
        new Error(`ارسال قطعه ${chunkIndex + 1} پس از چند مرتبه تلاش به دلیل نوسان شبکه متوقف شد.`)
      );
    }
  }

  // 3. Final completion call
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
    try {
      localStorage.removeItem(sessionKey);
    } catch {
      // ignore
    }
    const errData = await compRes.json().catch(() => ({}));
    throw new Error(errData.error || 'خطا در یکپارچه‌سازی و اعتبارسنجی سند در سرور.');
  }

  // Clear completed session from local storage
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
 * 
 * Automatically selects the optimal strategy:
 * - Files <= 20 MB: Single-shot direct turbo stream (instantaneous, 1 request)
 * - Files > 20 MB: Sequential 2MB chunk uploads (stable, resilient on mobile connections)
 * - Instant fallback to chunked upload if direct upload ever stalls
 */
export async function uploadFileInChunks(
  file: File,
  onProgress?: (info: UploadProgressInfo) => void,
  signal?: AbortSignal
): Promise<any> {
  const sessionKey = getSessionStorageKey(file);

  // If this file previously failed direct upload, jump directly to chunked
  if (directUploadFailedFiles.has(sessionKey)) {
    return await uploadFileInParallelChunks(file, onProgress, signal);
  }

  // For files <= 20MB, try direct single stream with fast fallback
  if (file.size <= DIRECT_UPLOAD_THRESHOLD) {
    try {
      return await uploadDirectFile(file, onProgress, signal);
    } catch (err: any) {
      if (signal?.aborted) throw err;
      console.warn('[DIRECT_UPLOAD_FALLBACK_TO_CHUNKS]', err);
      directUploadFailedFiles.add(sessionKey);

      // Clean any stale session key before fallback
      try {
        localStorage.removeItem(sessionKey);
      } catch {
        // ignore
      }
      return await uploadFileInParallelChunks(file, onProgress, signal);
    }
  }

  return await uploadFileInParallelChunks(file, onProgress, signal);
}
