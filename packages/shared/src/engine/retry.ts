/**
 * @deskspawn/browser-engine — Rate-limit aware retry utility
 *
 * Detects rate-limit errors from various AI providers and retries
 * with exponential backoff + jitter.
 */

export interface RateLimitInfo {
  isRateLimit: boolean;
  suggestedWaitMs: number | null;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryEvent {
  retryCount: number;
  maxRetries: number;
  waitMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

export function detectRateLimit(error: unknown): RateLimitInfo {
  const msg = String((error as any)?.message ?? error ?? '');
  const lower = msg.toLowerCase();

  const isRateLimit =
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('resource has been exhausted') ||
    lower.includes('上限を超え') ||
    lower.includes('制限');

  if (!isRateLimit) return { isRateLimit: false, suggestedWaitMs: null };

  const msMatch = msg.match(/try again in (\d+)ms/i);
  if (msMatch) {
    return { isRateLimit: true, suggestedWaitMs: parseInt(msMatch[1]) + 200 };
  }

  const secMatch =
    msg.match(/try again in (\d+)s/i) ||
    msg.match(/retry.?after[:\s]+(\d+)/i);
  if (secMatch) {
    return { isRateLimit: true, suggestedWaitMs: parseInt(secMatch[1]) * 1000 + 500 };
  }

  return { isRateLimit: true, suggestedWaitMs: null };
}

/**
 * AbortSignal対応のsleep。
 * signal が提供されると、待機中に abort された場合でも即座に reject する。
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // タイマー完了時にイベントリスナーをクリーンアップ
      const origResolve = resolve;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (resolve as any) = () => {
        signal.removeEventListener('abort', onAbort);
        origResolve();
      };
    }
  });
}

export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (event: RetryEvent) => void,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries) throw error;

      // AbortError はリトライせずに即座に再スロー
      if (error instanceof DOMException && error.name === 'AbortError') throw error;

      const { isRateLimit, suggestedWaitMs } = detectRateLimit(error);
      if (!isRateLimit) throw error;

      const waitMs = suggestedWaitMs ?? Math.min(
        config.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        config.maxDelayMs,
      );

      if (onRetry) {
        onRetry({
          retryCount: attempt + 1,
          maxRetries: config.maxRetries,
          waitMs,
        });
      }

      await sleep(waitMs, signal);
    }
  }

  throw lastError;
}
