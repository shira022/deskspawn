import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RENAME_RETRY_CODES = ['EPERM', 'EBUSY', 'EACCES'];
const RENAME_MAX_RETRIES = 3;
const RENAME_RETRY_MIN_MS = 15;
const RENAME_RETRY_MAX_MS = 30;

/**
 * Node のイベントループを同期ブロックする（最大約90ms）。Express シングルスレッド上では同時リクエストをわずかに遅延させるが、sync API 維持のための意図的な選択。
 */
function sleepSync(ms: number): void {
  const lock = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(lock, 0, 0, ms);
}

function isRetryableRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && RENAME_RETRY_CODES.includes(code);
}

function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    return;
  }
}

function renameWithRetry(tmp: string, target: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (error) {
      if (attempt >= RENAME_MAX_RETRIES || !isRetryableRenameError(error)) {
        throw error;
      }
      const waitMs =
        RENAME_RETRY_MIN_MS +
        Math.floor(Math.random() * (RENAME_RETRY_MAX_MS - RENAME_RETRY_MIN_MS + 1));
      sleepSync(waitMs);
    }
  }
}

export function writeFileAtomic(root: string, rel: string, content: string): void {
  const rootResolved = path.resolve(root);
  const target = path.resolve(root, rel);
  if (!target.startsWith(rootResolved + path.sep)) {
    throw new Error(`Invalid file path: ${rel}`);
  }
  const tmp = path.join(
    path.dirname(target),
    `${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    renameWithRetry(tmp, target);
  } catch (error) {
    removeQuietly(tmp);
    throw error;
  }
}
