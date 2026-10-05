/**
 * Tests for the read-time cost normalization wired into `getChatHistory()`.
 *
 * `normalizeMessageCost` is the ONLY integration point that corrects a
 * persisted `estimatedCost: 0` on read (old versions stored `0` whenever
 * pricing was unavailable).  These tests go through the public wrapper so a
 * regression (e.g. dropping `.map(normalizeMessageCost)` or applying it only
 * on one platform) is caught.
 *
 * Pricing is made deterministic by injecting into the in-memory cost cache
 * (`setModelCost`) and by mocking `models-fetcher` for the unknown case —
 * never by hitting models.dev.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelCost } from "../types";

// Install a global IndexedDB so the Web path can be exercised in node.
import "fake-indexeddb/auto";

vi.mock("./models-fetcher", () => ({
  lookupModelCostById: vi.fn(),
}));

const isDesktopEnvMock = vi.fn();
vi.mock("./platform", () => ({
  isDesktopEnv: () => isDesktopEnvMock(),
}));

const getChatHistoryDesktopMock = vi.fn();
vi.mock("./storage-desktop", () => ({
  getChatHistoryDesktop: (...args: unknown[]) => getChatHistoryDesktopMock(...args),
}));

import { getChatHistory, saveChatHistory } from "./storage";
import { clearModelCostCache, setModelCost } from "./cost";
import { lookupModelCostById } from "./models-fetcher";

const mockLookupModelCostById = vi.mocked(lookupModelCostById);

const knownCost: ModelCost = { input: 2, output: 4 };

function usageWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    inputTokens: 1_000_000,
    outputTokens: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Read a history through the wrapper as the desktop platform. */
async function readDesktop(messages: unknown[]): Promise<any[]> {
  isDesktopEnvMock.mockReturnValue(true);
  getChatHistoryDesktopMock.mockResolvedValue(messages);
  return getChatHistory("app-1");
}

beforeEach(() => {
  isDesktopEnvMock.mockReset();
  getChatHistoryDesktopMock.mockReset();
  mockLookupModelCostById.mockReset();
  clearModelCostCache();
});

describe("getChatHistory cost normalization", () => {
  it("recalculates a persisted estimatedCost: 0 when the model pricing is known", async () => {
    setModelCost("gpt-4o", knownCost);

    const [message] = await readDesktop([
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        usage: usageWith({ model: "gpt-4o", estimatedCost: 0 }),
      },
    ]);

    // 1M input tokens @ $2 / 1M = $2
    expect(message.usage.estimatedCost).toBeCloseTo(2.0, 6);
  });

  it("recalculates a persisted null estimatedCost when the model pricing is known", async () => {
    setModelCost("gpt-4o", knownCost);

    const [message] = await readDesktop([
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        usage: usageWith({ model: "gpt-4o", estimatedCost: null }),
      },
    ]);

    // 1M input tokens @ $2 / 1M = $2 (legacy null is treated like unknown, not $0)
    expect(message.usage.estimatedCost).toBeCloseTo(2.0, 6);
  });

  it("reinterprets a persisted estimatedCost: 0 as unknown when pricing cannot be resolved", async () => {
    mockLookupModelCostById.mockReturnValue(undefined);

    const [message] = await readDesktop([
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        usage: usageWith({ model: "unknown-model", estimatedCost: 0 }),
      },
    ]);

    expect(message.usage.estimatedCost).toBeUndefined();
  });

  it("leaves a non-zero estimatedCost untouched (same value and object)", async () => {
    setModelCost("gpt-4o", knownCost);
    const original = {
      id: "m1",
      role: "assistant",
      content: "hi",
      usage: usageWith({ model: "gpt-4o", estimatedCost: 1.2345 }),
    };

    const [message] = await readDesktop([original]);

    expect(message.usage.estimatedCost).toBe(1.2345);
    expect(message).toBe(original);
  });

  it("recalculates a persisted undefined estimatedCost when the model pricing is known", async () => {
    setModelCost("gpt-4o", knownCost);

    const [message] = await readDesktop([
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        usage: usageWith({ model: "gpt-4o" }),
      },
    ]);

    // 1M input tokens @ $2 / 1M = $2
    expect(message.usage.estimatedCost).toBeCloseTo(2.0, 6);
  });

  it("passes a message without usage through untouched (no crash)", async () => {
    const original = { id: "m1", role: "assistant", content: "hi" };

    const [message] = await readDesktop([original]);

    expect(message).toBe(original);
  });

  it("applies the same normalization on the Web (IndexedDB) path", async () => {
    isDesktopEnvMock.mockReturnValue(false);
    setModelCost("gpt-4o", knownCost);

    await saveChatHistory("app-web", [
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        usage: usageWith({ model: "gpt-4o", estimatedCost: 0 }),
      },
    ]);

    const [message] = await getChatHistory("app-web");

    expect(message.usage.estimatedCost).toBeCloseTo(2.0, 6);
  });
});
