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
const saveChatHistoryDesktopMock = vi.fn();
const listAppsDesktopMock = vi.fn();
const getAppDesktopMock = vi.fn();
const saveAppDesktopMock = vi.fn();
const deleteAppDesktopMock = vi.fn();
vi.mock("./storage-desktop", () => ({
  getChatHistoryDesktop: (...args: unknown[]) => getChatHistoryDesktopMock(...args),
  saveChatHistoryDesktop: (...args: unknown[]) => saveChatHistoryDesktopMock(...args),
  listAppsDesktop: (...args: unknown[]) => listAppsDesktopMock(...args),
  getAppDesktop: (...args: unknown[]) => getAppDesktopMock(...args),
  saveAppDesktop: (...args: unknown[]) => saveAppDesktopMock(...args),
  deleteAppDesktop: (...args: unknown[]) => deleteAppDesktopMock(...args),
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
  saveLastProvider,
  loadLastProvider,
  getSetting,
  setSetting,
  saveCurrentAppId,
  loadCurrentAppId,
  listApps,
  getApp,
  saveApp,
  deleteApp,
  deleteAppDatabase,
  getStorageStats,
  saveSettingsDesktop,
  loadSettingsDesktop,
} from "./storage";
import { clearModelCostCache, setModelCost } from "./cost";
import { lookupModelCostById } from "./models-fetcher";
import { providerCategories, SETTINGS_KEY } from "./constants";
import { DEFAULT_SETTINGS, type AppSettings } from "../types";
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

  it("keeps the legacy plaintext key sweep best-effort when IndexedDB cannot be opened", async () => {
    // Desktop IPC は成功したが IDB へ掃除にいけないケース（DB 破損・未作成）。
    // スイープ失敗は警告のみで、APIキー保存自体は成功したまま続くこと。
    invokeMock.mockResolvedValue({ method: "keychain" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("indexedDB", undefined);

    try {
      await expect(saveApiKey("openai", "sk-new")).resolves.toBe("keychain");
      expect(warn).toHaveBeenCalledWith(
        "[storage] Legacy IDB api_key sweep skipped:",
        expect.any(Error),
      );
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });
});

// ── Last active provider（プロバイダー設定の保存/復元） ────────────────────────

describe("last provider (save / load)", () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    // 「未保存」状態にリセット（value: undefined）
    await setSetting("last_provider", undefined);
  });

  it("web: stores the last provider in IndexedDB when Tauri IPC is unavailable", async () => {
    invokeMock.mockRejectedValue(new Error("not in a Tauri environment"));

    await saveLastProvider("anthropic");

    expect(await getSetting("last_provider")).toBe("anthropic");
    expect(invokeMock).toHaveBeenCalledWith("save_last_provider", {
      provider: "anthropic",
    });
  });

  it("desktop: stores the last provider via IPC without writing IndexedDB", async () => {
    invokeMock.mockResolvedValue(null);

    await saveLastProvider("openai");

    expect(invokeMock).toHaveBeenCalledWith("save_last_provider", { provider: "openai" });
    expect(await getSetting("last_provider")).toBeUndefined();
  });

  it("desktop: reads the last provider from config.json", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_last_provider" ? "google" : null,
    );

    expect(await loadLastProvider()).toBe("google");
    expect(await getSetting("last_provider")).toBeUndefined();
  });

  it("desktop: migrates a legacy IndexedDB value into config.json once", async () => {
    await setSetting("last_provider", "lm-studio");
    invokeMock.mockResolvedValue(null);

    expect(await loadLastProvider()).toBe("lm-studio");
    expect(invokeMock).toHaveBeenCalledWith("save_last_provider", { provider: "lm-studio" });
  });

  it("desktop: returns null when neither config.json nor IndexedDB holds a provider", async () => {
    invokeMock.mockResolvedValue(null);

    expect(await loadLastProvider()).toBeNull();
  });

  it("web: falls back to the IndexedDB value when Tauri IPC is unavailable", async () => {
    await setSetting("last_provider", "ollama");
    invokeMock.mockRejectedValue(new Error("not in a Tauri environment"));

    expect(await loadLastProvider()).toBe("ollama");
  });
});

// ── Desktop: プロバイダー設定の config.json 互換 ──────────────────────────────

describe("provider config — desktop config.json migration", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("migrates the legacy IndexedDB config into config.json when config.json has none", async () => {
    const legacy = { model: "claude-sonnet-4-5", customEndpoint: "https://legacy.example.com" };
    await setSetting("provider_config_openai", legacy);
    invokeMock.mockResolvedValue(null);

    await expect(loadProviderConfig("openai")).resolves.toEqual(legacy);
    expect(invokeMock).toHaveBeenCalledWith("save_provider_config", {
      provider: "openai",
      config: legacy,
    });
  });

  it("returns null when neither config.json nor IndexedDB holds a config", async () => {
    await setSetting("provider_config_openai", undefined);
    invokeMock.mockResolvedValue(null);

    await expect(loadProviderConfig("openai")).resolves.toBeNull();
  });
});

// ── Current app（B4: config.json / localStorage） ──────────────────────────────

const CURRENT_APP_KEY = "deskspawn_current_app";

/** node 環境に localStorage を用意し、書き込み内容を観測できるようにする。 */
function stubLocalStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const localStorageMock = {
    getItem: vi.fn((key: string) => (key in data ? data[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      data[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete data[key];
    }),
  };
  vi.stubGlobal("localStorage", localStorageMock);
  return { data, localStorageMock };
}

describe("current app id（config.json / localStorage）", () => {
  let data: Record<string, string>;
  let ls: ReturnType<typeof stubLocalStorage>["localStorageMock"];

  beforeEach(() => {
    const stubbed = stubLocalStorage();
    data = stubbed.data;
    ls = stubbed.localStorageMock;
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("not in a Tauri environment"));
  });

  it("web: 保存した ID をそのまま復元できる", async () => {
    await saveCurrentAppId("app-42");

    expect(ls.setItem).toHaveBeenCalledWith(CURRENT_APP_KEY, JSON.stringify("app-42"));
    await expect(loadCurrentAppId()).resolves.toBe("app-42");
  });

  it("web: null 保存は localStorage から消去する", async () => {
    data[CURRENT_APP_KEY] = JSON.stringify("app-42");

    await saveCurrentAppId(null);

    expect(ls.removeItem).toHaveBeenCalledWith(CURRENT_APP_KEY);
    await expect(loadCurrentAppId()).resolves.toBeNull();
  });

  it("web: JSON でない生の旧値でも壊さずそのまま返す", async () => {
    data[CURRENT_APP_KEY] = "legacy-plain-id";

    await expect(loadCurrentAppId()).resolves.toBe("legacy-plain-id");
  });

  it("web: 保存が無ければ null", async () => {
    await expect(loadCurrentAppId()).resolves.toBeNull();
  });

  it("desktop: config.json の ID を優先して返し、保存も IPC 経由にする", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_current_app" ? "app-from-config" : null,
    );

    await expect(loadCurrentAppId()).resolves.toBe("app-from-config");
    expect(invokeMock).toHaveBeenCalledWith("load_current_app");

    await saveCurrentAppId("app-42");
    expect(invokeMock).toHaveBeenCalledWith("save_current_app", { appId: "app-42" });
  });

  it("desktop: config.json が空なら localStorage の旧値を移行して返す", async () => {
    data[CURRENT_APP_KEY] = JSON.stringify("app-legacy");
    invokeMock.mockResolvedValue(null);

    await expect(loadCurrentAppId()).resolves.toBe("app-legacy");
    expect(invokeMock).toHaveBeenCalledWith("save_current_app", { appId: "app-legacy" });
  });

  it("desktop: どこにも無い場合は null（null 保存でも IPC を呼ぶ）", async () => {
    invokeMock.mockResolvedValue(null);

    await expect(loadCurrentAppId()).resolves.toBeNull();

    await saveCurrentAppId(null);
    expect(invokeMock).toHaveBeenCalledWith("save_current_app", { appId: null });
  });
});

// ── アプリ CRUD ─────────────────────────────────────────────────────────────────

describe("アプリ CRUD（Web IndexedDB / Desktop アダプタ）", () => {
  beforeEach(() => {
    isDesktopEnvMock.mockReturnValue(false);
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("not in a Tauri environment"));
  });

  it("web: save → get → list で往復し、未知 ID は null", async () => {
    const app = {
      id: `app-crud-${Date.now()}`,
      name: "CRUD App",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    await expect(saveApp(app)).resolves.toBe(app.id);
    await expect(getApp(app.id)).resolves.toEqual(app);
    expect((await listApps()).some((a) => a.id === app.id)).toBe(true);
    await expect(getApp(`${app.id}-missing`)).resolves.toBeNull();
  });

  it("web: deleteApp で一覧から消える（生成アプリの DB 削除も併せて実行される）", async () => {
    const app = {
      id: `app-del-${Date.now()}`,
      name: "Delete Me",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await saveApp(app);

    await deleteApp(app.id);

    await expect(getApp(app.id)).resolves.toBeNull();
    expect((await listApps()).some((a) => a.id === app.id)).toBe(false);
  });

  it("web: deleteAppDatabase は生成アプリ固有の DB を削除する", async () => {
    const appId = `probe-${Date.now()}`;
    const dbName = `deskspawn_app_${appId}`;
    const names = async () =>
      ((await (indexedDB as IDBFactory).databases?.()) ?? []).map((d) => d.name);

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onupgradeneeded = () => req.result.createObjectStore("kv", { keyPath: "id" });
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    expect(await names()).toContain(dbName);

    await deleteAppDatabase(appId);

    expect(await names()).not.toContain(dbName);
  });

  it("web: 別接続で開かれている DB の削除は blocked でも完了扱いにして警告する", async () => {
    const appId = `blocked-${Date.now()}`;
    const dbName = `deskspawn_app_${appId}`;
    const conn = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onupgradeneeded = () => req.result.createObjectStore("kv", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await deleteAppDatabase(appId);
      expect(warn).toHaveBeenCalledWith(
        `[storage] deleteDatabase "${dbName}" is blocked (open in another tab?)`,
      );
    } finally {
      conn.close();
      warn.mockRestore();
    }
  });

  it("desktop: アダプタ（storage-desktop）へ委譲し、DB 削除はスキップする", async () => {
    isDesktopEnvMock.mockReturnValue(true);
    const desktopApp = {
      id: "desk-1",
      name: "Desktop App",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    listAppsDesktopMock.mockResolvedValue([desktopApp]);
    getAppDesktopMock.mockResolvedValue(desktopApp);
    saveAppDesktopMock.mockResolvedValue("desk-1");
    deleteAppDesktopMock.mockResolvedValue(undefined);

    await expect(listApps()).resolves.toEqual([desktopApp]);
    await expect(getApp("desk-1")).resolves.toEqual(desktopApp);
    await expect(saveApp(desktopApp)).resolves.toBe("desk-1");
    await deleteApp("desk-1");
    expect(deleteAppDesktopMock).toHaveBeenCalledWith("desk-1");

    // C8: デスクトップには生成アプリの DB が存在しないので no-op
    await expect(deleteAppDatabase("desk-1")).resolves.toBeUndefined();
    expect(listAppsDesktopMock).toHaveBeenCalledTimes(1);
  });

  it("保存統計はアプリ一覧の件数を返す（チャット件数は常に 0）", async () => {
    isDesktopEnvMock.mockReturnValue(false);
    const before = (await listApps()).length;

    await saveApp({
      id: `app-stats-${Date.now()}`,
      name: "Stats",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(getStorageStats()).resolves.toEqual({ apps: before + 1, chatMessages: 0 });
  });

  it("desktop: チャット履歴の保存はアダプタへ委譲される", async () => {
    isDesktopEnvMock.mockReturnValue(true);
    saveChatHistoryDesktopMock.mockResolvedValue(undefined);
    const messages = [{ id: "m1", role: "user", content: "hi" }];

    await saveChatHistory("app-1", messages);

    expect(saveChatHistoryDesktopMock).toHaveBeenCalledWith("app-1", messages);
  });
});

// ── UI 設定（言語・テーマ等） ────────────────────────────────────────────────────

describe("UI設定（saveSettingsDesktop / loadSettingsDesktop）", () => {
  let data: Record<string, string>;
  let ls: ReturnType<typeof stubLocalStorage>["localStorageMock"];

  const settings: AppSettings = {
    theme: "dark",
    uiFontSize: 16,
    codeFontSize: 15,
    language: "en",
    simpleMode: false,
  };

  beforeEach(() => {
    const stubbed = stubLocalStorage();
    data = stubbed.data;
    ls = stubbed.localStorageMock;
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("not in a Tauri environment"));
  });

  it("web: localStorage へ丸ごと保存し、読み込み時は既定値とマージする", async () => {
    await saveSettingsDesktop(settings);

    expect(ls.setItem).toHaveBeenCalledWith(SETTINGS_KEY, JSON.stringify(settings));
    await expect(loadSettingsDesktop()).resolves.toEqual(settings);
  });

  it("web: 保存が無い初回起動は null", async () => {
    await expect(loadSettingsDesktop()).resolves.toBeNull();
  });

  it("web: 壊れた JSON は初回起動同様 null 扱い", async () => {
    data[SETTINGS_KEY] = "{not json";

    await expect(loadSettingsDesktop()).resolves.toBeNull();
  });

  it("desktop: config.json へ保存し、言語/テーマだけ localStorage へミラーする", async () => {
    invokeMock.mockResolvedValue(null);

    await saveSettingsDesktop(settings);

    expect(invokeMock).toHaveBeenCalledWith("save_settings", { settings });
    expect(JSON.parse(data[SETTINGS_KEY])).toEqual({ language: "en", theme: "dark" });
  });

  it("desktop: 既存のミラー値は残し、言語/テーマだけ更新する", async () => {
    data[SETTINGS_KEY] = JSON.stringify({ uiFontSize: 99 });
    invokeMock.mockResolvedValue(null);

    await saveSettingsDesktop(settings);

    expect(JSON.parse(data[SETTINGS_KEY])).toEqual({
      uiFontSize: 99,
      language: "en",
      theme: "dark",
    });
  });

  it("desktop: ミラーが失敗しても config.json 保存は成功する", async () => {
    invokeMock.mockResolvedValue(null);
    ls.getItem.mockImplementation(() => {
      throw new Error("storage disabled");
    });

    await expect(saveSettingsDesktop(settings)).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("save_settings", { settings });
  });

  it("desktop: load_settings の結果を既定値とマージして返す", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_settings" ? { theme: "dark" } : null,
    );

    await expect(loadSettingsDesktop()).resolves.toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
  });

  it("desktop: config.json が空なら localStorage の旧設定を移行する", async () => {
    data[SETTINGS_KEY] = JSON.stringify({ language: "en" });
    invokeMock.mockResolvedValue(null);

    await expect(loadSettingsDesktop()).resolves.toEqual({ ...DEFAULT_SETTINGS, language: "en" });
    expect(invokeMock).toHaveBeenCalledWith("save_settings", {
      settings: { ...DEFAULT_SETTINGS, language: "en" },
    });
  });

  it("desktop: 壊れた旧設定は無視して初回起動扱いにする", async () => {
    data[SETTINGS_KEY] = "{oops";
    invokeMock.mockResolvedValue(null);

    await expect(loadSettingsDesktop()).resolves.toBeNull();
  });

  it("desktop: config.json・localStorage どちらも空なら null", async () => {
    invokeMock.mockResolvedValue(null);

    await expect(loadSettingsDesktop()).resolves.toBeNull();
  });
});
