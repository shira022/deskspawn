/**
 * Rate-limit aware retry utility for the AI agent loop.
 *
 * Supports multiple provider error formats:
 *   - OpenAI:    "Please try again in 248ms."
 *   - Anthropic: "rate_limit_error" with retry-after
 *   - Google:    "Resource has been exhausted" / RATE_LIMIT
 *   - Ollama:    "too many requests" / 429
 *   - Custom:    falls back to exponential backoff + jitter
 */

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Rate-limit detection ─────────────────────────────────────────────────────

/**
 * Detect whether an error is a rate-limit error and extract the suggested
 * wait time if available.
 *
 * Recognised provider patterns:
 *   OpenAI:   "Rate limit reached ... Please try again in 248ms."
 *   Anthropic:"rate_limit_error" / "retry_after: X"
 *   Google:   "Resource has been exhausted" / "RATE_LIMIT"
 *   Ollama:   "too many requests" / HTTP 429
 *   Any:      Japanese "制限" / "上限を超え"
 */
export function detectRateLimit(error: unknown): RateLimitInfo {
  const msg = String((error as any)?.message ?? error ?? '');
  const lower = msg.toLowerCase();

  // ── Heuristics ─────────────────────────────────────────────────────────
  const isRateLimit =
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('resource has been exhausted') ||
    lower.includes('上限を超え') ||
    lower.includes('制限');

  if (!isRateLimit) return { isRateLimit: false, suggestedWaitMs: null };

  // ── Wait-time extraction ───────────────────────────────────────────────

  // OpenAI: "Please try again in 248ms."
  const msMatch = msg.match(/try again in (\d+)ms/i);
  if (msMatch) {
    return { isRateLimit: true, suggestedWaitMs: parseInt(msMatch[1]) + 200 };
  }

  // Anthropic / generic: "try again in X seconds" or "retry_after: X"
  const secMatch =
    msg.match(/try again in (\d+)s/i) ||
    msg.match(/retry.?after[:\s]+(\d+)/i);
  if (secMatch) {
    return { isRateLimit: true, suggestedWaitMs: parseInt(secMatch[1]) * 1000 + 500 };
  }

  // Could not parse a specific wait time → will use exponential backoff
  return { isRateLimit: true, suggestedWaitMs: null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

/**
 * Retry an async function when a rate-limit error is encountered.
 *
 * - Detects rate-limit errors from various providers
 * - Uses the API-suggested wait time when available
 * - Falls back to exponential backoff + jitter
 * - Calls `onRetry` before each retry attempt (for logging / SSE notifications)
 * - Throws the last error when all retries are exhausted
 * - Non-rate-limit errors are rethrown immediately (no retry)
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (event: RetryEvent) => void,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Exhausted all retries → propagate
      if (attempt >= config.maxRetries) throw error;

      const { isRateLimit, suggestedWaitMs } = detectRateLimit(error);

      // Non-rate-limit errors are not retried
      if (!isRateLimit) throw error;

      // Calculate wait: use API-suggested time or exponential backoff + jitter
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

      console.log(
        `[rate_limit] Attempt ${attempt + 1}/${config.maxRetries}, ` +
        `waiting ${waitMs}ms` +
        (suggestedWaitMs ? '' : ' (exponential backoff)'),
      );

      await sleep(waitMs);
    }
  }

  // TypeScript safety — should not reach here because the loop always
  // either returns or throws on the final iteration.
  throw lastError;
}
