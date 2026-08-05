import { describe, it, expect, vi } from "vitest";
import { detectRateLimit, withRateLimitRetry } from "./retry";

describe("detectRateLimit", () => {
  it.each([
    ["rate limit exceeded", true, null],
    ["Rate Limit: please slow down", true, null],
    ["RATE_LIMIT_ERROR", true, null],
    ["too many requests", true, null],
    ["Too Many Requests", true, null],
    ["429 Too Many Requests", true, null],
    ["status code 429", true, null],
    ["resource has been exhausted", true, null],
    ["上限を超えました", true, null],
    ["制限に達しました", true, null],
    ["API制限エラー", true, null],
  ])("detects rate limit error message '%s'", (message, expectedIsRateLimit, expectedWaitMs) => {
    const error = new Error(message);
    const result = detectRateLimit(error);
    expect(result.isRateLimit).toBe(expectedIsRateLimit);
    if (expectedWaitMs === null) {
      expect(result.suggestedWaitMs).toBeNull();
    } else {
      expect(result.suggestedWaitMs).toBe(expectedWaitMs);
    }
  });

  it("returns false for non-rate-limit errors", () => {
    const errors = [
      new Error("some other error"),
      new Error("internal server error"),
      new Error("timeout"),
      new Error(""),
      "string error",
      42,
      null,
      undefined,
      { message: "not found" },
    ];

    for (const err of errors) {
      expect(detectRateLimit(err).isRateLimit).toBe(false);
    }
  });

  it("parses 'try again in 5000ms' and returns suggestedWaitMs = 5200", () => {
    const error = new Error("Rate limit exceeded. Please try again in 5000ms");
    const result = detectRateLimit(error);
    expect(result.isRateLimit).toBe(true);
    expect(result.suggestedWaitMs).toBe(5200);
  });

  it("parses 'try again in 5s' and returns suggestedWaitMs = 5500", () => {
    const error = new Error("rate limit: try again in 5s");
    const result = detectRateLimit(error);
    expect(result.isRateLimit).toBe(true);
    expect(result.suggestedWaitMs).toBe(5500);
  });

  it("parses 'retry after: 30' and returns suggestedWaitMs = 30500", () => {
    const error = new Error("rate limit: retry after: 30");
    const result = detectRateLimit(error);
    expect(result.isRateLimit).toBe(true);
    expect(result.suggestedWaitMs).toBe(30500);
  });

  it("parses 'retry after 30' (without colon) and returns suggestedWaitMs = 30500", () => {
    const error = new Error("rate limit: retry after 30");
    const result = detectRateLimit(error);
    expect(result.isRateLimit).toBe(true);
    expect(result.suggestedWaitMs).toBe(30500);
  });

  it("returns null suggestedWaitMs when no timing info is present", () => {
    const error = new Error("rate limit");
    const result = detectRateLimit(error);
    expect(result.isRateLimit).toBe(true);
    expect(result.suggestedWaitMs).toBeNull();
  });
});

describe("withRateLimitRetry", () => {
  it("succeeds on first try when no error is thrown", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRateLimitRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on rate limit error and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");

    const result = await withRateLimitRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries multiple times on rate limit errors and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 too many requests"))
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");

    const result = await withRateLimitRetry(fn, undefined, { maxRetries: 3, baseDelayMs: 5, maxDelayMs: 50 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("throws after max retries are exhausted", async () => {
    const error = new Error("rate limit");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRateLimitRetry(fn, undefined, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 })).rejects.toThrow(
      "rate limit",
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("throws immediately on non-rate-limit error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("internal error"));

    await expect(withRateLimitRetry(fn)).rejects.toThrow("internal error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry callback with correct event data", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    await withRateLimitRetry(fn, onRetry, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });

    expect(onRetry).toHaveBeenCalledTimes(1);
    const event = onRetry.mock.calls[0][0];
    expect(event.retryCount).toBe(1);
    expect(event.maxRetries).toBe(3);
    expect(event.waitMs).toBeGreaterThanOrEqual(0);
  });

  it("calls onRetry for each retry attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    await withRateLimitRetry(fn, onRetry, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0].retryCount).toBe(1);
    expect(onRetry.mock.calls[1][0].retryCount).toBe(2);
  });

  it("uses custom RetryConfig", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");

    const config = { maxRetries: 5, baseDelayMs: 5, maxDelayMs: 50 };
    const onRetry = vi.fn();

    await withRateLimitRetry(fn, onRetry, config);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0].maxRetries).toBe(5);
  });

  it("applies exponential backoff (each retry waits longer)", async () => {
    // Mock Math.random to remove jitter for deterministic testing
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    await withRateLimitRetry(fn, onRetry, { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 5000 });

    expect(onRetry).toHaveBeenCalledTimes(3);
    const waits = onRetry.mock.calls.map((c: unknown[]) => (c[0] as { waitMs: number }).waitMs);
    // Without jitter: attempt 0 -> 100, attempt 1 -> 200, attempt 2 -> 400
    expect(waits[0]).toBe(100);
    expect(waits[1]).toBe(200);
    expect(waits[2]).toBe(400);

    randomSpy.mockRestore();
  });

  it("respects maxDelayMs cap", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    await withRateLimitRetry(fn, onRetry, { maxRetries: 2, baseDelayMs: 10000, maxDelayMs: 100 });

    for (const call of onRetry.mock.calls) {
      expect((call[0] as { waitMs: number }).waitMs).toBeLessThanOrEqual(100);
    }
  });

  it("uses suggestedWaitMs from detectRateLimit when available", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit: try again in 2000ms"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    await withRateLimitRetry(fn, onRetry, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 });

    expect(onRetry).toHaveBeenCalledTimes(1);
    // suggestedWaitMs = 2000 + 200 = 2200
    expect(onRetry.mock.calls[0][0].waitMs).toBe(2200);
  });

  it("throws the last error when all retries fail", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("rate limit"));

    await expect(withRateLimitRetry(fn, undefined, { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100 })).rejects.toThrow(
      "rate limit",
    );
  });
});
