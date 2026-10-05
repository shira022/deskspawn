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

// Desktop (Tauri) IPC — invoke が成功すれば keychain / config.json 経由になる
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  getChatHistory,
  saveChatHistory,
  saveApiKey,
  loadApiKey,
  hasApiKey,
  deleteApiKey,
  saveProviderConfig,
  loadProviderConfig,
  getSetting,
  setSetting,
} from "./storage";
import { clearModelCostCache, setModelCost } from "./cost";
import { lookupModelCostById } from "./models-fetcher";
import { providerCategories } from "./constants";
import type { ProviderKind } from "../types";

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

// ── Per-provider key / config isolation ──────────────────────────────────────

describe("per-provider API key & config storage", () => {
  const ALL_PROVIDERS = Object.keys(providerCategories) as ProviderKind[];

  function configFor(provider: ProviderKind) {
    return {
      model: `model-${provider}`,
      customEndpoint: `https://${provider}.example.com`,
      region: "us-east-1",
    };
  }

  beforeEach(() => {
    // 既定は「Tauri 非搭載」= IndexedDB(Web) 経由
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("not in a Tauri environment"));
  });

  it("round-trips API keys for all 9 providers under api_key_{provider}", async () => {
    expect(ALL_PROVIDERS).toHaveLength(9);

    for (const provider of ALL_PROVIDERS) {
      await expect(saveApiKey(provider, `key-${provider}`)).resolves.toBe("browser");
    }

    for (const provider of ALL_PROVIDERS) {
      expect(await getSetting(`api_key_${provider}`), provider).toBe(`key-${provider}`);
      expect(await loadApiKey(provider), provider).toBe(`key-${provider}`);
      expect(await hasApiKey(provider), provider).toBe(true);
    }
  });

  it("deleting one provider's key leaves every other provider untouched", async () => {
    for (const provider of ALL_PROVIDERS) {
      await saveApiKey(provider, `key-${provider}`);
    }

    await deleteApiKey("openai");

    expect(await loadApiKey("openai")).toBeNull();
    expect(await hasApiKey("openai")).toBe(false);
    for (const provider of ALL_PROVIDERS) {
      if (provider === "openai") continue;
      expect(await loadApiKey(provider), provider).toBe(`key-${provider}`);
    }
  });

  it("round-trips provider configs for all 9 providers under provider_config_{provider}", async () => {
    for (const provider of ALL_PROVIDERS) {
      await saveProviderConfig(provider, configFor(provider));
    }

    for (const provider of ALL_PROVIDERS) {
      expect(await getSetting(`provider_config_${provider}`), provider).toEqual(
        configFor(provider),
      );
      expect(await loadProviderConfig(provider), provider).toEqual(
        configFor(provider),
      );
    }
  });

  it("provider configs and API keys use separate keys (never overwrite each other)", async () => {
    for (const provider of ALL_PROVIDERS) {
      await saveApiKey(provider, `key-${provider}`);
      await saveProviderConfig(provider, configFor(provider));
    }

    for (const provider of ALL_PROVIDERS) {
      expect(await getSetting(`api_key_${provider}`), provider).toBe(`key-${provider}`);
      expect(await getSetting(`provider_config_${provider}`), provider).toEqual(
        configFor(provider),
      );
    }
  });

  // ── Desktop (invoke-first) path ──────────────────────────────────────────

  it("uses the Tauri IPC path for API keys when invoke succeeds", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "save_api_key") return { method: "keychain" };
      if (cmd === "load_api_key") return "key-from-keychain";
      if (cmd === "delete_api_key") return null;
      return null;
    });

    await expect(saveApiKey("anthropic", "sk-ant")).resolves.toBe("keychain");
    expect(invokeMock).toHaveBeenCalledWith("save_api_key", {
      provider: "anthropic",
      apiKey: "sk-ant",
    });

    expect(await loadApiKey("anthropic")).toBe("key-from-keychain");
    expect(await hasApiKey("anthropic")).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("load_api_key", { provider: "anthropic" });

    await deleteApiKey("anthropic");
    expect(invokeMock).toHaveBeenCalledWith("delete_api_key", { provider: "anthropic" });
  });

  it("returns null / false for a desktop key that is not stored", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_api_key") return null;
      return null;
    });

    expect(await loadApiKey("ollama")).toBeNull();
    expect(await hasApiKey("ollama")).toBe(false);
  });

  it("sweeps the legacy plaintext IndexedDB copy after a desktop save", async () => {
    // デスクトップ移行前の平文が settings ストアに残っている状態を再現
    await setSetting("api_key_openai", "legacy-plain-text");

    invokeMock.mockResolvedValue({ method: "keychain" });
    await expect(saveApiKey("openai", "sk-new")).resolves.toBe("keychain");

    expect(await getSetting("api_key_openai")).toBeUndefined();
  });

  it("uses the Tauri IPC path for provider configs when invoke succeeds", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_provider_config") {
        return { model: "from-config-json", customEndpoint: "https://upstream.example.com" };
      }
      if (cmd === "save_provider_config") return null;
      return null;
    });

    await saveProviderConfig("gcp-vertexai", {
      model: "gemini-2.0-flash-001",
      region: "us-central1",
    });
    expect(invokeMock).toHaveBeenCalledWith("save_provider_config", {
      provider: "gcp-vertexai",
      config: { model: "gemini-2.0-flash-001", region: "us-central1" },
    });

    await expect(loadProviderConfig("gcp-vertexai")).resolves.toEqual({
      model: "from-config-json",
      customEndpoint: "https://upstream.example.com",
    });
    expect(invokeMock).toHaveBeenCalledWith("load_provider_config", {
      provider: "gcp-vertexai",
    });
  });
});
