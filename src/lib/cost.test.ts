import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateCost,
  setModelCostCache,
  setModelCost,
  clearModelCostCache,
} from "./cost";
import type { ModelInfo, ModelCost } from "@/types";

// Mock models-fetcher so we control lookupModelCostById
vi.mock("./models-fetcher", () => ({
  lookupModelCostById: vi.fn(),
}));

// Import the mocked function after vi.mock
import { lookupModelCostById } from "./models-fetcher";
const mockLookupModelCostById = vi.mocked(lookupModelCostById);

beforeEach(() => {
  clearModelCostCache();
  mockLookupModelCostById.mockReset();
});

const sampleCost: ModelCost = {
  input: 3.0,    // $3 per 1M input tokens
  output: 15.0,  // $15 per 1M output tokens
  cacheRead: 0.3, // $0.3 per 1M cached input tokens
  cacheWrite: 3.75, // $3.75 per 1M cache creation tokens
  reasoning: 60.0, // $60 per 1M reasoning tokens
};

const sampleModelInfo: ModelInfo = {
  id: "gpt-4o",
  name: "GPT-4o",
  supportsReasoning: false,
  supportsToolCall: true,
  supportsImageInput: true,
  contextLimit: 128000,
  maxOutput: 16384,
  cost: sampleCost,
};

describe("calculateCost", () => {
  it("returns 0 when no model is provided", () => {
    const result = calculateCost({
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(result).toBe(0);
  });

  it("returns 0 when model is not in cache and lookupModelCostById returns undefined", () => {
    mockLookupModelCostById.mockReturnValue(undefined);

    const result = calculateCost({
      model: "unknown-model",
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(result).toBe(0);
  });

  it("falls back to lookupModelCostById when model not in cache", () => {
    mockLookupModelCostById.mockReturnValue(sampleCost);

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000, // 1M tokens
      outputTokens: 500_000,  // 500K tokens
    });

    // Expected: (1M / 1M) * 3 + (500K / 1M) * 15 = 3 + 7.5 = 10.5
    expect(result).toBeCloseTo(10.5, 5);

    // Should have called the fallback
    expect(mockLookupModelCostById).toHaveBeenCalledWith("gpt-4o");
  });

  it("calculates cost correctly with cached model pricing", () => {
    setModelCost("gpt-4o", sampleCost);

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 2_000_000,  // 2M tokens
      outputTokens: 1_000_000, // 1M tokens
    });

    // Expected: (2M / 1M) * 3 + (1M / 1M) * 15 = 6 + 15 = 21
    expect(result).toBeCloseTo(21.0, 5);

    // Should NOT have called fallback since model was in cache
    expect(mockLookupModelCostById).not.toHaveBeenCalled();
  });

  it("handles reasoning tokens using reasoning rate", () => {
    setModelCost("claude-sonnet-4", sampleCost);

    const result = calculateCost({
      model: "claude-sonnet-4",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      reasoningTokens: 200_000, // 200K reasoning tokens
    });

    // Expected: (1M / 1M) * 3 + (500K / 1M) * 15 + (200K / 1M) * 60
    //          = 3 + 7.5 + 12 = 22.5
    expect(result).toBeCloseTo(22.5, 5);
  });

  it("falls back to output rate for reasoning tokens when reasoning rate is undefined", () => {
    const costWithoutReasoning: ModelCost = {
      input: 3.0,
      output: 15.0,
    };
    setModelCost("gpt-4o-mini", costWithoutReasoning);

    const result = calculateCost({
      model: "gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      reasoningTokens: 200_000,
    });

    // Expected: (1M / 1M) * 3 + (500K / 1M) * 15 + (200K / 1M) * 15
    //          = 3 + 7.5 + 3 = 13.5
    expect(result).toBeCloseTo(13.5, 5);
  });

  it("handles cached input tokens using cacheRead rate", () => {
    setModelCost("claude-sonnet-4", sampleCost);

    const result = calculateCost({
      model: "claude-sonnet-4",
      inputTokens: 500_000,
      outputTokens: 250_000,
      cachedInputTokens: 500_000,
    });

    // Expected: (500K / 1M) * 3 + (250K / 1M) * 15 + (500K / 1M) * 0.3
    //          = 1.5 + 3.75 + 0.15 = 5.4
    expect(result).toBeCloseTo(5.4, 5);
  });

  it("falls back to input rate for cached input tokens when cacheRead is undefined", () => {
    const costWithoutCache: ModelCost = {
      input: 3.0,
      output: 15.0,
    };
    setModelCost("gpt-4o", costWithoutCache);

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedInputTokens: 500_000,
    });

    // Expected: (1M / 1M) * 3 + (500K / 1M) * 15 + (500K / 1M) * 3
    //          = 3 + 7.5 + 1.5 = 12
    expect(result).toBeCloseTo(12.0, 5);
  });

  it("handles cache creation tokens using cacheWrite rate", () => {
    setModelCost("claude-sonnet-4", sampleCost);

    const result = calculateCost({
      model: "claude-sonnet-4",
      inputTokens: 500_000,
      outputTokens: 250_000,
      cacheCreationTokens: 1_000_000,
    });

    // Expected: (500K / 1M) * 3 + (250K / 1M) * 15 + (1M / 1M) * 3.75
    //          = 1.5 + 3.75 + 3.75 = 9.0
    expect(result).toBeCloseTo(9.0, 5);
  });

  it("falls back to input rate for cache creation tokens when cacheWrite is undefined", () => {
    const costWithoutCacheWrite: ModelCost = {
      input: 3.0,
      output: 15.0,
      cacheRead: 0.3,
    };
    setModelCost("gpt-4o", costWithoutCacheWrite);

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheCreationTokens: 500_000,
    });

    // Expected: (1M / 1M) * 3 + (500K / 1M) * 15 + (500K / 1M) * 3
    //          = 3 + 7.5 + 1.5 = 12
    expect(result).toBeCloseTo(12.0, 5);
  });

  it("returns 0 when all tokens are 0", () => {
    setModelCost("gpt-4o", sampleCost);

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(result).toBe(0);
  });

  it("returns 0 with zero tokens and no model", () => {
    const result = calculateCost({
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(result).toBe(0);
  });

  it("ignores reasoningTokens when undefined or 0", () => {
    setModelCost("gpt-4o", sampleCost);

    const withoutReasoning = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    const withZeroReasoning = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      reasoningTokens: 0,
    });

    expect(withoutReasoning).toBeCloseTo(10.5, 5);
    expect(withZeroReasoning).toBeCloseTo(10.5, 5);
  });

  it("ignores cachedInputTokens when undefined or 0", () => {
    setModelCost("gpt-4o", sampleCost);

    const withoutCached = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    const withZeroCached = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cachedInputTokens: 0,
    });

    expect(withoutCached).toBeCloseTo(10.5, 5);
    expect(withZeroCached).toBeCloseTo(10.5, 5);
  });

  it("ignores cacheCreationTokens when undefined or 0", () => {
    setModelCost("gpt-4o", sampleCost);

    const withoutCreation = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    const withZeroCreation = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheCreationTokens: 0,
    });

    expect(withoutCreation).toBeCloseTo(10.5, 5);
    expect(withZeroCreation).toBeCloseTo(10.5, 5);
  });

  it("handles all token types simultaneously", () => {
    setModelCost("claude-opus-4", sampleCost);

    const result = calculateCost({
      model: "claude-opus-4",
      inputTokens: 1_000_000,       // 1M @ $3  = $3
      outputTokens: 200_000,        // 200K @ $15 = $3
      reasoningTokens: 100_000,     // 100K @ $60 = $6
      cachedInputTokens: 300_000,   // 300K @ $0.3 = $0.09
      cacheCreationTokens: 400_000, // 400K @ $3.75 = $1.5
    });

    // Total: 3 + 3 + 6 + 0.09 + 1.5 = 13.59
    expect(result).toBeCloseTo(13.59, 5);
  });

  it("calls lookupModelCostById with lowercase version when first lookup fails", () => {
    mockLookupModelCostById
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(sampleCost);

    const result = calculateCost({
      model: "GPT-4O",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    // Should have tried exact match, then lowercase
    expect(mockLookupModelCostById).toHaveBeenCalledTimes(2);
    expect(mockLookupModelCostById).toHaveBeenCalledWith("GPT-4O");
    expect(mockLookupModelCostById).toHaveBeenCalledWith("gpt-4o");

    // Expected: 3 + 7.5 = 10.5
    expect(result).toBeCloseTo(10.5, 5);
  });

  it("warms the fast cache after a fallback lookup", () => {
    mockLookupModelCostById.mockReturnValue(sampleCost);

    // First call: fallback lookup
    calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    expect(mockLookupModelCostById).toHaveBeenCalledTimes(1);

    // Second call: should be served from cache, no more fallback calls
    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
    });

    // Still only 1 call to the fallback
    expect(mockLookupModelCostById).toHaveBeenCalledTimes(1);
    expect(result).toBeCloseTo(21.0, 5);
  });
});

describe("setModelCostCache", () => {
  it("populates cache from an array of ModelInfo", () => {
    const models: ModelInfo[] = [
      {
        id: "model-a",
        name: "Model A",
        supportsReasoning: false,
        supportsToolCall: true,
        supportsImageInput: false,
        contextLimit: 8000,
        maxOutput: 4000,
        cost: { input: 1.0, output: 2.0 },
      },
      {
        id: "model-b",
        name: "Model B",
        supportsReasoning: true,
        supportsToolCall: true,
        supportsImageInput: true,
        contextLimit: 128000,
        maxOutput: 16384,
        cost: { input: 3.0, output: 15.0 },
      },
      {
        id: "model-c",
        name: "Model C",
        supportsReasoning: false,
        supportsToolCall: false,
        supportsImageInput: false,
        contextLimit: 4096,
        maxOutput: 1024,
        // no cost — should be skipped
      },
    ];

    setModelCostCache(models);

    // model-c has no cost, so it should not have been cached
    const resultA = calculateCost({
      model: "model-a",
      inputTokens: 500_000,
      outputTokens: 0,
    });
    expect(resultA).toBeCloseTo(0.5, 5);

    const resultB = calculateCost({
      model: "model-b",
      inputTokens: 500_000,
      outputTokens: 0,
    });
    expect(resultB).toBeCloseTo(1.5, 5);

    // model-c has no cost info, should fallback and fail
    mockLookupModelCostById.mockReturnValue(undefined);
    const resultC = calculateCost({
      model: "model-c",
      inputTokens: 500_000,
      outputTokens: 0,
    });
    expect(resultC).toBe(0);
  });

  it("overwrites existing cache entries", () => {
    setModelCost("gpt-4o", { input: 10, output: 50 });
    setModelCost("gpt-4o", { input: 3, output: 15 });

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    // Uses the second (overwritten) pricing: 3 + 7.5 = 10.5
    expect(result).toBeCloseTo(10.5, 5);
  });
});

describe("clearModelCostCache", () => {
  it("clears previously cached costs", () => {
    setModelCost("gpt-4o", sampleCost);

    clearModelCostCache();

    mockLookupModelCostById.mockReturnValue(undefined);

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    expect(result).toBe(0);
  });

  it("allows re-populating after clear", () => {
    setModelCost("gpt-4o", sampleCost);
    clearModelCostCache();
    setModelCost("gpt-4o", sampleCost);

    const result = calculateCost({
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    expect(result).toBeCloseTo(10.5, 5);
  });
});
