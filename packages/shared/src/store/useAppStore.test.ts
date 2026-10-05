import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { ChatMessage, FileNode, AppMeta, ProviderKind } from "../types";
import { getModelsForProvider } from "../lib/models-fetcher";
import { clearModelCostCache, setModelCostCache } from "../lib/cost";
import { hasAppFiles, seedAppFromWorkspace, seedAppFromFilesystem } from "../lib/seed-app";

// ── Mocks (hoisted by vitest) ────────────────────────────────────────────────────

vi.mock("../lib/i18n", () => ({
  default: {
    t: vi.fn((key: string) => key),
    changeLanguage: vi.fn(),
  },
}));

vi.mock("../lib/constants", () => ({
  SETTINGS_KEY: "deskspawn_settings",
}));

// vi.mock factories are hoisted, so mock definitions must be inline.
// Use this shared object so tests can configure the mocks.
const mockStorageFns: Record<string, ReturnType<typeof vi.fn>> = {};

vi.mock("../lib/storage", () => {
  const fns = {
    saveProviderConfig: vi.fn().mockResolvedValue(undefined),
    loadProviderConfig: vi.fn().mockResolvedValue(null),
    saveApiKey: vi.fn().mockResolvedValue(undefined),
    loadApiKey: vi.fn().mockResolvedValue(null),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
    hasApiKey: vi.fn().mockResolvedValue(false),
    saveLastProvider: vi.fn().mockResolvedValue(undefined),
    loadLastProvider: vi.fn().mockResolvedValue(null),
    saveCurrentAppId: vi.fn().mockResolvedValue(undefined),
    loadCurrentAppId: vi.fn().mockResolvedValue(null),
    saveSettingsDesktop: vi.fn().mockResolvedValue(undefined),
    loadSettingsDesktop: vi.fn().mockResolvedValue({
      theme: "system",
      uiFontSize: 14,
      codeFontSize: 13,
      language: "ja",
      simpleMode: true,
    }),
    listApps: vi.fn().mockResolvedValue([]),
  };
  // Sync to shared ref so tests can configure mocks
  Object.assign(mockStorageFns, fns);
  return fns;
});

const mockEngineFns: Record<string, ReturnType<typeof vi.fn>> = {};

vi.mock("../engine/tool-executors", () => {
  const fns = {
    setAppId: vi.fn(),
    listCheckpoints: vi.fn().mockResolvedValue([]),
    persistChatHistory: vi.fn().mockResolvedValue(true),
    loadChatHistory: vi.fn().mockResolvedValue([]),
  };
  Object.assign(mockEngineFns, fns);
  return fns;
});

vi.mock("../lib/cost", () => ({
  setModelCostCache: vi.fn(),
  clearModelCostCache: vi.fn(),
}));

vi.mock("../lib/models-fetcher", () => ({
  getModelsForProvider: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/seed-app", () => ({
  seedAppFromFilesystem: vi.fn().mockResolvedValue({ seeded: 0 }),
  seedAppFromWorkspace: vi.fn().mockResolvedValue({ seeded: 0 }),
  hasAppFiles: vi.fn().mockResolvedValue(true),
}));

// デスクトップのみ: AI 設定をサイドカーへ push する先（POST /api/config）。
const sidecarFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/sidecar", () => ({ sidecarFetch: sidecarFetchMock }));

/**
 * 実行中のみ window.__DESKSPAWN_DESKTOP__ を立てる（platform は本物を使う）。
 * 終了後は必ず元の状態へ戻す。
 */
async function withDesktopEnv<T>(fn: () => Promise<T>): Promise<T> {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const original = (globalThis as { window?: unknown }).window;
  vi.stubGlobal("window", { __DESKSPAWN_DESKTOP__: true });
  try {
    return await fn();
  } finally {
    if (hadWindow) vi.stubGlobal("window", original);
    else delete (globalThis as { window?: unknown }).window;
  }
}

// ── Store import (after mocks are in place) ──────────────────────────────────────

let useAppStore: any;
let initialState: Record<string, unknown>;

beforeAll(async () => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  const mod = await import("./useAppStore");
  useAppStore = mod.useAppStore;
  // Snapshot initial state for reset between tests
  initialState = JSON.parse(JSON.stringify(useAppStore.getState()));
});

// constants はこのファイルでモックしているため、9 プロバイダーの単一情報源は
// 実物から取りに行く（将来の追加漏れを検出できるようにするため）。
let ALL_PROVIDERS: ProviderKind[] = [];

beforeAll(async () => {
  const constants = await vi.importActual<typeof import("../lib/constants")>(
    "../lib/constants",
  );
  ALL_PROVIDERS = Object.keys(constants.providerCategories) as ProviderKind[];
});

beforeEach(() => {
  // Reset only data properties (second arg false = merge, not replace)
  useAppStore.setState(initialState, false);
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────────

describe("useAppStore — initial state", () => {
  it("phase defaults to 'ai-config'", () => {
    expect(useAppStore.getState().phase).toBe("ai-config");
  });

  it("aiConfig is null by default", () => {
    expect(useAppStore.getState().aiConfig).toBeNull();
  });

  it("messages is an empty array", () => {
    expect(useAppStore.getState().messages).toEqual([]);
  });

  it("agentStatus is 'idle'", () => {
    expect(useAppStore.getState().agentStatus).toBe("idle");
  });

  it("fileTree is an empty array", () => {
    expect(useAppStore.getState().fileTree).toEqual([]);
  });

  it("selectedFile is null", () => {
    expect(useAppStore.getState().selectedFile).toBeNull();
  });

  it("toasts is an empty array", () => {
    expect(useAppStore.getState().toasts).toEqual([]);
  });

  it("initialized is false", () => {
    expect(useAppStore.getState().initialized).toBe(false);
  });

  it("settings have default values", () => {
    const s = useAppStore.getState().settings;
    expect(s.theme).toBe("system");
    expect(s.uiFontSize).toBe(14);
    expect(s.codeFontSize).toBe(13);
    expect(s.language).toBe("ja");
    expect(s.simpleMode).toBe(true);
  });
});

describe("useAppStore — agent tier", () => {
  it("agentTier defaults to 'auto'", () => {
    expect(useAppStore.getState().agentTier).toBe("auto");
  });

  it("lastTriage is null by default", () => {
    expect(useAppStore.getState().lastTriage).toBeNull();
  });

  it("setAgentTier updates the selection", () => {
    useAppStore.getState().setAgentTier("L4");
    expect(useAppStore.getState().agentTier).toBe("L4");
  });

  it("setLastTriage stores the triage result", () => {
    useAppStore.getState().setLastTriage({ level: 3, source: "auto", reason: "feature" });
    expect(useAppStore.getState().lastTriage).toEqual({
      level: 3,
      source: "auto",
      reason: "feature",
    });
  });
});

describe("useAppStore — log panel open count", () => {
  it("logPanelOpenCount defaults to 0", () => {
    expect(useAppStore.getState().logPanelOpenCount).toBe(0);
  });

  it("incrementLogPanelOpen increases the count by one", () => {
    useAppStore.getState().incrementLogPanelOpen();
    expect(useAppStore.getState().logPanelOpenCount).toBe(1);
    useAppStore.getState().incrementLogPanelOpen();
    expect(useAppStore.getState().logPanelOpenCount).toBe(2);
  });

  it("decrementLogPanelOpen decreases the count by one", () => {
    useAppStore.getState().incrementLogPanelOpen();
    useAppStore.getState().incrementLogPanelOpen();
    useAppStore.getState().decrementLogPanelOpen();
    expect(useAppStore.getState().logPanelOpenCount).toBe(1);
    useAppStore.getState().decrementLogPanelOpen();
    expect(useAppStore.getState().logPanelOpenCount).toBe(0);
  });
});

describe("useAppStore — aiConfig", () => {
  it("setAiConfig saves provider config and api key", async () => {
    const config = {
      provider: "openai" as const,
      model: "gpt-4o",
      apiKey: "sk-test",
      apiKeyConfigured: undefined as boolean | undefined,
    };

    await useAppStore.getState().setAiConfig(config);

    expect(mockStorageFns.saveProviderConfig).toHaveBeenCalledWith("openai", {
      model: "gpt-4o",
      customEndpoint: undefined,
      region: undefined,
      maxSteps: undefined,
    });
    expect(mockStorageFns.saveApiKey).toHaveBeenCalledWith("openai", "sk-test");
    expect(mockStorageFns.saveLastProvider).toHaveBeenCalledWith("openai");
  });

  it("setAiConfig deletes api key when apiKeyConfigured is false", async () => {
    const config = {
      provider: "anthropic" as const,
      model: "claude-sonnet-4-5-20250929",
      apiKey: "",
      apiKeyConfigured: false,
    };

    await useAppStore.getState().setAiConfig(config);

    expect(mockStorageFns.deleteApiKey).toHaveBeenCalledWith("anthropic");
  });

  it("setAiConfig updates state with correct model and provider", async () => {
    mockStorageFns.hasApiKey.mockResolvedValue(true);

    const config = {
      provider: "openai" as const,
      model: "gpt-4o",
      apiKey: "sk-test",
    };

    await useAppStore.getState().setAiConfig(config);

    const state = useAppStore.getState();
    expect(state.aiConfig.provider).toBe("openai");
    expect(state.aiConfig.model).toBe("gpt-4o");
    expect(state.aiConfig.apiKey).toBe(""); // key is cleared after save
    expect(state.aiConfig.apiKeyConfigured).toBe(true);
  });
});

describe("useAppStore — settings", () => {
  it("setSettings updates settings", () => {
    const newSettings = {
      theme: "dark" as const,
      uiFontSize: 16,
      codeFontSize: 14,
      language: "en" as const,
      simpleMode: false,
    };

    useAppStore.getState().setSettings(newSettings);

    const state = useAppStore.getState();
    expect(state.settings.theme).toBe("dark");
    expect(state.settings.uiFontSize).toBe(16);
    expect(state.settings.simpleMode).toBe(false);
  });

  it("updateSettings merges partial updates", () => {
    useAppStore.getState().updateSettings({ theme: "dark" });

    const state = useAppStore.getState();
    expect(state.settings.theme).toBe("dark");
    // Other settings unchanged
    expect(state.settings.uiFontSize).toBe(14);
    expect(state.settings.language).toBe("ja");
  });

  it("updateSettings persists via saveSettingsDesktop", () => {
    useAppStore.getState().updateSettings({ theme: "light" });

    expect(mockStorageFns.saveSettingsDesktop).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "light" }),
    );
  });
});

describe("useAppStore — messages", () => {
  const msg: ChatMessage = {
    id: "msg-1",
    role: "user",
    content: "Hello",
    timestamp: Date.now(),
  };

  const msg2: ChatMessage = {
    id: "msg-2",
    role: "assistant",
    content: "Hi there!",
    timestamp: Date.now(),
  };

  it("addMessage appends a message", () => {
    useAppStore.getState().addMessage(msg);
    expect(useAppStore.getState().messages).toHaveLength(1);
    expect(useAppStore.getState().messages[0].content).toBe("Hello");
  });

  it("addMessage appends multiple messages", () => {
    useAppStore.getState().addMessage(msg);
    useAppStore.getState().addMessage(msg2);
    expect(useAppStore.getState().messages).toHaveLength(2);
    expect(useAppStore.getState().messages[1].content).toBe("Hi there!");
  });

  it("updateMessage modifies an existing message", () => {
    useAppStore.getState().addMessage(msg);
    useAppStore.getState().updateMessage("msg-1", { content: "Updated" });

    const messages = useAppStore.getState().messages;
    expect(messages[0].content).toBe("Updated");
    expect(messages[0].role).toBe("user"); // unchanged
  });

  it("updateMessage with non-existent id does nothing", () => {
    useAppStore.getState().addMessage(msg);
    useAppStore.getState().updateMessage("nonexistent", { content: "X" });

    expect(useAppStore.getState().messages[0].content).toBe("Hello");
  });

  it("clearMessages empties the message list", () => {
    useAppStore.getState().addMessage(msg);
    useAppStore.getState().addMessage(msg2);
    expect(useAppStore.getState().messages).toHaveLength(2);

    useAppStore.getState().clearMessages();
    expect(useAppStore.getState().messages).toEqual([]);
  });

  it("truncateMessages keeps only messages before index", () => {
    useAppStore.getState().addMessage(msg);
    useAppStore.getState().addMessage(msg2);
    useAppStore.getState().addMessage({
      id: "msg-3",
      role: "user",
      content: "Third",
      timestamp: Date.now(),
    });

    useAppStore.getState().truncateMessages(2);

    expect(useAppStore.getState().messages).toHaveLength(2);
    expect(useAppStore.getState().messages[1].id).toBe("msg-2");
  });
});

describe("useAppStore — toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("addToast adds a toast with generated id", () => {
    useAppStore.getState().addToast({ message: "Success", variant: "success" });

    const toasts = useAppStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Success");
    expect(toasts[0].variant).toBe("success");
    expect(toasts[0].id).toMatch(/^toast-/);
  });

  it("removeToast removes the toast by id", () => {
    useAppStore.getState().addToast({ message: "First", variant: "info" });
    useAppStore.getState().addToast({ message: "Second", variant: "error" });

    const toasts = useAppStore.getState().toasts;
    const firstId = toasts[0].id;

    useAppStore.getState().removeToast(firstId);

    expect(useAppStore.getState().toasts).toHaveLength(1);
    expect(useAppStore.getState().toasts[0].message).toBe("Second");
  });

  it("toasts auto-remove after default duration (4000ms)", () => {
    useAppStore.getState().addToast({ message: "Auto-remove", variant: "info" });
    expect(useAppStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(4000);

    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it("toasts respect custom duration", () => {
    useAppStore.getState().addToast({
      message: "Short",
      variant: "warning",
      duration: 1000,
    });
    expect(useAppStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(useAppStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });
});

describe("useAppStore — fileTree and selectedFile", () => {
  const fileTree: FileNode[] = [
    { name: "src", path: "/src", isDirectory: true, children: [] },
    { name: "index.html", path: "/index.html", isDirectory: false, size: 1024 },
  ];

  it("setFileTree updates the file tree", () => {
    useAppStore.getState().setFileTree(fileTree);
    expect(useAppStore.getState().fileTree).toEqual(fileTree);
  });

  it("setSelectedFile updates the selected file", () => {
    useAppStore.getState().setSelectedFile("/index.html");
    expect(useAppStore.getState().selectedFile).toBe("/index.html");
  });

  it("setSelectedFile can be set to null", () => {
    useAppStore.getState().setSelectedFile("/index.html");
    useAppStore.getState().setSelectedFile(null);
    expect(useAppStore.getState().selectedFile).toBeNull();
  });
});

describe("useAppStore — phase transitions", () => {
  it("setPhase changes the phase", () => {
    expect(useAppStore.getState().phase).toBe("ai-config");
    useAppStore.getState().setPhase("main");
    expect(useAppStore.getState().phase).toBe("main");
  });

  it("can transition back to ai-config", () => {
    useAppStore.getState().setPhase("main");
    useAppStore.getState().setPhase("ai-config");
    expect(useAppStore.getState().phase).toBe("ai-config");
  });
});

describe("useAppStore — agent state", () => {
  it("setAgentStatus changes status", () => {
    useAppStore.getState().setAgentStatus("running");
    expect(useAppStore.getState().agentStatus).toBe("running");
  });

  it("setAgentStepCount updates step count", () => {
    useAppStore.getState().setAgentStepCount(5);
    expect(useAppStore.getState().agentStepCount).toBe(5);
  });

  it("setAgentMaxSteps updates max steps", () => {
    useAppStore.getState().setAgentMaxSteps(50);
    expect(useAppStore.getState().agentMaxSteps).toBe(50);
  });
});

describe("useAppStore — apps", () => {
  const app: AppMeta = {
    id: "app-1",
    name: "My App",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-02",
  };

  it("addApp adds an app to the list", () => {
    useAppStore.getState().addApp(app);
    expect(useAppStore.getState().apps).toHaveLength(1);
    expect(useAppStore.getState().apps[0].name).toBe("My App");
  });

  it("removeApp removes by id", () => {
    useAppStore.getState().addApp(app);
    useAppStore.getState().addApp({ ...app, id: "app-2", name: "Other" });
    useAppStore.getState().removeApp("app-1");

    expect(useAppStore.getState().apps).toHaveLength(1);
    expect(useAppStore.getState().apps[0].id).toBe("app-2");
  });

  it("setApps replaces the entire app list", () => {
    useAppStore.getState().addApp(app);
    useAppStore.getState().setApps([{ ...app, id: "app-3", name: "New" }]);

    expect(useAppStore.getState().apps).toHaveLength(1);
    expect(useAppStore.getState().apps[0].id).toBe("app-3");
  });
});

describe("useAppStore — workspace / preview", () => {
  it("setWorkspacePort updates the port", () => {
    useAppStore.getState().setWorkspacePort(3000);
    expect(useAppStore.getState().workspacePort).toBe(3000);
  });

  it("setWorkspaceReady toggles workspace ready", () => {
    useAppStore.getState().setWorkspaceReady(true);
    expect(useAppStore.getState().workspaceReady).toBe(true);
  });

  it("previewMaximized toggles correctly", () => {
    expect(useAppStore.getState().previewMaximized).toBe(false);
    useAppStore.getState().togglePreviewMaximized();
    expect(useAppStore.getState().previewMaximized).toBe(true);
    useAppStore.getState().togglePreviewMaximized();
    expect(useAppStore.getState().previewMaximized).toBe(false);
  });

  it("triggerReload increments reloadCounter", () => {
    const before = useAppStore.getState().reloadCounter;
    useAppStore.getState().triggerReload();
    expect(useAppStore.getState().reloadCounter).toBe(before + 1);
  });
});

describe("useAppStore — checkpoints", () => {
  it("default currentCheckpointIndex is -1", () => {
    expect(useAppStore.getState().currentCheckpointIndex).toBe(-1);
  });

  it("fetchCheckpoints calls engine listCheckpoints and updates state", async () => {
    useAppStore.getState().currentAppId = "test-pid";

    mockEngineFns.listCheckpoints.mockResolvedValue([
      { id: "cp-1", createdAt: new Date("2025-01-01") },
      { id: "cp-2", createdAt: new Date("2025-01-02") },
    ]);

    await useAppStore.getState().fetchCheckpoints();

    expect(mockEngineFns.listCheckpoints).toHaveBeenCalledWith("test-pid");
    expect(useAppStore.getState().checkpoints).toHaveLength(2);
    expect(useAppStore.getState().checkpoints[0].id).toBe("cp-1");
    expect(useAppStore.getState().currentCheckpointIndex).toBe(1);
  });
});

describe("useAppStore — initialize()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets initialized to true after running", async () => {
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().initialized).toBe(true);
  });

  it("loads AI config from storage when last provider exists", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue("openai");
    mockStorageFns.loadProviderConfig.mockResolvedValue({ model: "gpt-4o", maxSteps: 10 });
    mockStorageFns.loadApiKey.mockResolvedValue("sk-test-key");
    mockStorageFns.listApps.mockResolvedValue([]);

    await useAppStore.getState().initialize();

    const state = useAppStore.getState();
    expect(state.phase).toBe("main");
    expect(state.aiConfig).toBeTruthy();
    expect(state.aiConfig.provider).toBe("openai");
    expect(state.aiConfig.model).toBe("gpt-4o");
    expect(state.aiConfig.apiKeyConfigured).toBe(true);
    expect(state.aiConfig.maxSteps).toBe(10);
  });

  it("stays in ai-config phase when no stored config exists", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue(null);
    mockStorageFns.listApps.mockResolvedValue([]);

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().phase).toBe("ai-config");
    expect(useAppStore.getState().aiConfig).toBeNull();
  });

  it("loads apps from IndexedDB", async () => {
    const storedApps = [
      { id: "app-1", name: "Test App", createdAt: "2025-01-01", updatedAt: "2025-01-02" },
    ];
    mockStorageFns.loadLastProvider.mockResolvedValue(null);
    mockStorageFns.listApps.mockResolvedValue(storedApps);

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().apps).toEqual(storedApps);
  });

  it("loads current app and fetches checkpoints", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue(null);
    mockStorageFns.listApps.mockResolvedValue([]);
    mockStorageFns.loadCurrentAppId.mockResolvedValue("app-loaded");

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().currentAppId).toBe("app-loaded");
    expect(mockEngineFns.setAppId).toHaveBeenCalledWith("app-loaded");
    expect(mockEngineFns.listCheckpoints).toHaveBeenCalledWith("app-loaded");
  });

  it("handles initialization failure gracefully", async () => {
    mockStorageFns.loadLastProvider.mockRejectedValue(new Error("Storage error"));

    // Should not throw
    await expect(useAppStore.getState().initialize()).resolves.not.toThrow();
    expect(useAppStore.getState().initialized).toBe(true);
  });

  it("loads UI settings and applies the language", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue(null);
    mockStorageFns.listApps.mockResolvedValue([]);
    mockStorageFns.loadSettingsDesktop.mockResolvedValue({
      theme: "dark",
      uiFontSize: 16,
      codeFontSize: 15,
      language: "en",
      simpleMode: false,
    });

    await useAppStore.getState().initialize();

    const state = useAppStore.getState();
    expect(state.settings.language).toBe("en");
    expect(state.settings.theme).toBe("dark");
    expect(state.languageUnset).toBe(false);
  });

  it("marks languageUnset when no settings exist (first run)", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue(null);
    mockStorageFns.listApps.mockResolvedValue([]);
    mockStorageFns.loadSettingsDesktop.mockResolvedValue(null);

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().languageUnset).toBe(true);
  });

  it("persists settings via saveSettingsDesktop on setSettings", async () => {
    const store = useAppStore.getState();
    store.setSettings({
      theme: "dark",
      uiFontSize: 16,
      codeFontSize: 15,
      language: "en",
      simpleMode: false,
    });

    expect(useAppStore.getState().settings.language).toBe("en");
    expect(mockStorageFns.saveSettingsDesktop).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    );
  });
});

describe("useAppStore — setAiConfig for every provider", () => {
  it("persists lastProvider and the per-provider config for all 9 providers", async () => {
    expect(ALL_PROVIDERS).toHaveLength(9);

    for (const provider of ALL_PROVIDERS) {
      mockStorageFns.saveProviderConfig.mockClear();
      mockStorageFns.saveLastProvider.mockClear();
      mockStorageFns.saveApiKey.mockClear();

      const config = {
        provider,
        model: `model-${provider}`,
        apiKey: `key-${provider}`,
        customEndpoint: `https://${provider}.example.com`,
        region: "us-east-1",
      };

      await useAppStore.getState().setAiConfig(config);

      // provider_config_{provider} へ保存される（キー生成は storage 側の責務）
      expect(mockStorageFns.saveProviderConfig, provider).toHaveBeenCalledWith(provider, {
        model: `model-${provider}`,
        customEndpoint: `https://${provider}.example.com`,
        region: "us-east-1",
        maxSteps: undefined,
      });
      // lastProvider も同じプロバイダーで上書きされる
      expect(mockStorageFns.saveLastProvider, provider).toHaveBeenCalledWith(provider);
      // APIキーはプロバイダー単位で保存される
      expect(mockStorageFns.saveApiKey, provider).toHaveBeenCalledWith(
        provider,
        `key-${provider}`,
      );

      const state = useAppStore.getState();
      expect(state.aiConfig.provider, provider).toBe(provider);
      expect(state.aiConfig.model, provider).toBe(`model-${provider}`);
      // 保存後はキー本体をステートに残さない
      expect(state.aiConfig.apiKey, provider).toBe("");
    }
  });

  it("keeps the provider list and the store in sync (9 kinds)", async () => {
    for (const provider of ALL_PROVIDERS) {
      await useAppStore.getState().setAiConfig({ provider, model: "m", apiKey: "k" });
      expect(useAppStore.getState().aiConfig.provider, provider).toBe(provider);
    }
    expect(useAppStore.getState().aiConfig.provider).toBe(
      ALL_PROVIDERS[ALL_PROVIDERS.length - 1],
    );
  });
});

// ── モデル一覧から価格キャッシュを事前ロード（プロバイダー/モデル系） ──────────

describe("useAppStore — initialize() がモデル価格キャッシュを事前ロードする", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockStorageFns.listApps.mockResolvedValue([]);
    mockStorageFns.loadCurrentAppId.mockResolvedValue(null);
    mockStorageFns.loadSettingsDesktop.mockResolvedValue({
      theme: "system",
      uiFontSize: 14,
      codeFontSize: 13,
      language: "ja",
      simpleMode: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getModelsForProvider).mockResolvedValue([]);
  });

  it("models.dev 由来のモデル一覧を clearModelCostCache → setModelCostCache で入れる", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue("openai");
    mockStorageFns.loadProviderConfig.mockResolvedValue({ model: "gpt-4o" });
    mockStorageFns.loadApiKey.mockResolvedValue("sk-test");
    const models = [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        supportsReasoning: false,
        supportsToolCall: true,
        supportsImageInput: true,
        contextLimit: 128000,
        maxOutput: 16384,
      },
    ];
    vi.mocked(getModelsForProvider).mockResolvedValueOnce(models);

    await useAppStore.getState().initialize();

    expect(getModelsForProvider).toHaveBeenCalledWith("openai");
    expect(clearModelCostCache).toHaveBeenCalled();
    expect(setModelCostCache).toHaveBeenCalledWith(models);
  });

  it("ローカル/互換プロバイダーでは models.dev を叩かずキャッシュも更新しない", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue("ollama");
    mockStorageFns.loadProviderConfig.mockResolvedValue({ model: "llama3.2" });
    mockStorageFns.loadApiKey.mockResolvedValue(null);
    vi.mocked(getModelsForProvider).mockClear();
    vi.mocked(setModelCostCache).mockClear();

    await useAppStore.getState().initialize();

    expect(getModelsForProvider).not.toHaveBeenCalled();
    expect(setModelCostCache).not.toHaveBeenCalled();
  });
});

// ── 保存済みプロバイダー設定の復元（reloadAiConfig） ─────────────────────────

describe("useAppStore — reloadAiConfig（保存済みプロバイダー設定の復元）", () => {
  beforeEach(() => {
    sidecarFetchMock.mockReset();
    sidecarFetchMock.mockResolvedValue({ ok: true });
  });

  it("last provider の設定と APIキー有無を復元する（Web: サイドカーへは同期しない）", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue("anthropic");
    mockStorageFns.loadProviderConfig.mockResolvedValue({
      model: "claude-sonnet-4-5",
      maxSteps: 12,
      customEndpoint: "https://up.example.com/v1",
    });
    mockStorageFns.loadApiKey.mockResolvedValue("sk-ant");

    await useAppStore.getState().reloadAiConfig();

    const state = useAppStore.getState();
    expect(state.aiConfig.provider).toBe("anthropic");
    expect(state.aiConfig.model).toBe("claude-sonnet-4-5");
    expect(state.aiConfig.maxSteps).toBe(12);
    // キー本体はステートに残さず「設定済み」だけ持つ
    expect(state.aiConfig.apiKey).toBe("");
    expect(state.aiConfig.apiKeyConfigured).toBe(true);
    expect(sidecarFetchMock).not.toHaveBeenCalled();
  });

  it("last provider が無ければ何もしない", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue(null);

    await useAppStore.getState().reloadAiConfig();

    expect(useAppStore.getState().aiConfig).toBeNull();
    expect(sidecarFetchMock).not.toHaveBeenCalled();
  });

  it("desktop: 復元した上流設定をサイドカーへ同期する", async () => {
    mockStorageFns.loadLastProvider.mockResolvedValue("openai");
    mockStorageFns.loadProviderConfig.mockResolvedValue({
      model: "gpt-4o",
      customEndpoint: "https://up.example.com/v1",
    });
    mockStorageFns.loadApiKey.mockResolvedValue("sk-test");

    await withDesktopEnv(() => useAppStore.getState().reloadAiConfig());

    expect(sidecarFetchMock).toHaveBeenCalledWith(
      "/api/config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          apiKey: "sk-test",
          customEndpoint: "https://up.example.com/v1",
        }),
      }),
    );
  });
});

// ── setAiConfig のサイドカー同期（desktop / web） ───────────────────────────

describe("useAppStore — setAiConfig のサイドカー同期", () => {
  beforeEach(() => {
    sidecarFetchMock.mockReset();
    sidecarFetchMock.mockResolvedValue({ ok: true });
  });

  it("desktop: 保存直後に上流設定をサイドカーへ POST する", async () => {
    await withDesktopEnv(() =>
      useAppStore.getState().setAiConfig({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-test",
        customEndpoint: "https://up.example.com/v1",
      }),
    );

    expect(sidecarFetchMock).toHaveBeenCalledWith(
      "/api/config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          apiKey: "sk-test",
          customEndpoint: "https://up.example.com/v1",
        }),
      }),
    );
  });

  it("desktop: 同期が失敗しても保存は完結し警告のみ出す", async () => {
    sidecarFetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await withDesktopEnv(() =>
        useAppStore.getState().setAiConfig({
          provider: "openai",
          model: "gpt-4o",
          apiKey: "sk-test",
        }),
      );
      expect(warn).toHaveBeenCalledWith(
        "[sidecar] Failed to push AI config:",
        expect.any(Error),
      );
    } finally {
      sidecarFetchMock.mockResolvedValue({ ok: true });
      warn.mockRestore();
    }

    // 保存（プロバイダー設定・APIキー・last provider）は完了している
    const state = useAppStore.getState();
    expect(state.aiConfig.provider).toBe("openai");
    expect(state.aiConfig.model).toBe("gpt-4o");
    expect(mockStorageFns.saveLastProvider).toHaveBeenCalledWith("openai");
  });

  it("web: サイドカーへは同期しない", async () => {
    await useAppStore.getState().setAiConfig({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
    });

    expect(sidecarFetchMock).not.toHaveBeenCalled();
  });
});

// ── 状態更新アクション（UI から呼ばれるが単体では未実行だったもの） ──────────

describe("useAppStore — 状態更新アクション", () => {
  it("setLayoutMode はレイアウトモードを切り替える", () => {
    expect(useAppStore.getState().layoutMode).toBe("2-pane");
    useAppStore.getState().setLayoutMode("3-pane");
    expect(useAppStore.getState().layoutMode).toBe("3-pane");
    useAppStore.getState().setLayoutMode("2-pane");
    expect(useAppStore.getState().layoutMode).toBe("2-pane");
  });

  it("setEditingMessageId は編集中メッセージ ID を保持する", () => {
    expect(useAppStore.getState().editingMessageId).toBeNull();
    useAppStore.getState().setEditingMessageId("msg-9");
    expect(useAppStore.getState().editingMessageId).toBe("msg-9");
    useAppStore.getState().setEditingMessageId(null);
    expect(useAppStore.getState().editingMessageId).toBeNull();
  });

  it("setAppSwitching / setAppLoading は読込中フラグを切り替える", () => {
    expect(useAppStore.getState().appSwitching).toBe(false);
    expect(useAppStore.getState().appLoading).toBe(false);

    useAppStore.getState().setAppSwitching(true);
    useAppStore.getState().setAppLoading(true);
    expect(useAppStore.getState().appSwitching).toBe(true);
    expect(useAppStore.getState().appLoading).toBe(true);

    useAppStore.getState().setAppSwitching(false);
    useAppStore.getState().setAppLoading(false);
    expect(useAppStore.getState().appSwitching).toBe(false);
    expect(useAppStore.getState().appLoading).toBe(false);
  });

  it("setCheckpoints / setCurrentCheckpointIndex はチェックポイント状態を更新する", () => {
    const checkpoints = [{ id: "cp-1", createdAt: "2026-01-01" }];
    useAppStore.getState().setCheckpoints(checkpoints);
    expect(useAppStore.getState().checkpoints).toEqual(checkpoints);

    useAppStore.getState().setCurrentCheckpointIndex(0);
    expect(useAppStore.getState().currentCheckpointIndex).toBe(0);
  });

  it("setVisibleMessageCount は表示件数を更新する", () => {
    expect(useAppStore.getState().visibleMessageCount).toBe(-1);
    useAppStore.getState().setVisibleMessageCount(20);
    expect(useAppStore.getState().visibleMessageCount).toBe(20);
  });

  it("setPreviewMaximized はトグルと独立に値を設定できる", () => {
    expect(useAppStore.getState().previewMaximized).toBe(false);
    useAppStore.getState().setPreviewMaximized(true);
    expect(useAppStore.getState().previewMaximized).toBe(true);
    useAppStore.getState().setPreviewMaximized(false);
    expect(useAppStore.getState().previewMaximized).toBe(false);
  });

  it("setResolvedTheme はライト/ダークを切り替える", () => {
    expect(useAppStore.getState().resolvedTheme).toBe("light");
    useAppStore.getState().setResolvedTheme("dark");
    expect(useAppStore.getState().resolvedTheme).toBe("dark");
    useAppStore.getState().setResolvedTheme("light");
    expect(useAppStore.getState().resolvedTheme).toBe("light");
  });
});

// ── チャット履歴の永続化・復元 ────────────────────────────────────────────────

describe("useAppStore — チャット履歴の永続化と復元", () => {
  const msg1: ChatMessage = {
    id: "hist-1",
    role: "user",
    content: "first",
    timestamp: 1,
  };
  const msg2: ChatMessage = {
    id: "hist-2",
    role: "assistant",
    content: "second",
    timestamp: 2,
  };

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    mockEngineFns.persistChatHistory.mockResolvedValue(true);
    mockEngineFns.loadChatHistory.mockResolvedValue([]);
  });

  it("truncateMessages は残したメッセージを現在のアプリへ保存する", async () => {
    useAppStore.setState({ currentAppId: "app-persist", messages: [] });
    useAppStore.getState().addMessage(msg1);
    useAppStore.getState().addMessage(msg2);

    useAppStore.getState().truncateMessages(1);
    expect(useAppStore.getState().messages).toHaveLength(1);
    await flush();

    expect(mockEngineFns.persistChatHistory).toHaveBeenCalledWith("app-persist", [msg1]);
    expect(useAppStore.getState().saveFailed).toBe(false);
  });

  it("履歴の保存に失敗したら saveFailed を立てる", async () => {
    useAppStore.setState({ currentAppId: "app-persist", messages: [], saveFailed: false });
    mockEngineFns.persistChatHistory.mockResolvedValue(false);

    useAppStore.getState().addMessage(msg1);
    await flush();

    expect(useAppStore.getState().saveFailed).toBe(true);
  });

  it("fetchChatHistory は保存済みメッセージを復元する", async () => {
    useAppStore.setState({ currentAppId: "app-hist", messages: [] });
    mockEngineFns.loadChatHistory.mockResolvedValue([msg1, msg2]);

    await useAppStore.getState().fetchChatHistory();

    expect(mockEngineFns.loadChatHistory).toHaveBeenCalledWith("app-hist");
    expect(useAppStore.getState().messages).toEqual([msg1, msg2]);
  });

  it("保存が空でも例外でも、既存メッセージは消えない", async () => {
    useAppStore.setState({ currentAppId: "app-hist", messages: [msg1] });

    mockEngineFns.loadChatHistory.mockResolvedValue([]);
    await useAppStore.getState().fetchChatHistory();
    expect(useAppStore.getState().messages).toEqual([msg1]);

    mockEngineFns.loadChatHistory.mockRejectedValue(new Error("db error"));
    await expect(useAppStore.getState().fetchChatHistory()).resolves.toBeUndefined();
    expect(useAppStore.getState().messages).toEqual([msg1]);

    // アプリ未選択ではストレージへ問い合わせない
    useAppStore.setState({ currentAppId: null });
    await useAppStore.getState().fetchChatHistory();
    expect(mockEngineFns.loadChatHistory).toHaveBeenCalledTimes(2);
  });
});

// ── カレントアプリの保存と自動シード ────────────────────────────────────────

describe("useAppStore — setCurrentAppId（カレントアプリ保存・自動シード）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockStorageFns.saveCurrentAppId.mockResolvedValue(undefined);
    mockEngineFns.listCheckpoints.mockResolvedValue([]);
    vi.mocked(hasAppFiles).mockResolvedValue(true);
    vi.mocked(seedAppFromWorkspace).mockResolvedValue({ seeded: 0, skipped: 0 });
    vi.mocked(seedAppFromFilesystem).mockResolvedValue({ seeded: 0, skipped: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ID を設定すると engine へ伝わり、保存とチェックポイント読込も走る", () => {
    useAppStore.getState().setCurrentAppId("app-9");

    expect(useAppStore.getState().currentAppId).toBe("app-9");
    expect(mockEngineFns.setAppId).toHaveBeenCalledWith("app-9");
    expect(mockStorageFns.saveCurrentAppId).toHaveBeenCalledWith("app-9");
    expect(mockEngineFns.listCheckpoints).toHaveBeenCalledWith("app-9");
  });

  it("null を設定すると保存も null で走り、シードは試みない", async () => {
    vi.mocked(hasAppFiles).mockClear();

    useAppStore.getState().setCurrentAppId(null);

    expect(useAppStore.getState().currentAppId).toBeNull();
    expect(mockStorageFns.saveCurrentAppId).toHaveBeenCalledWith(null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(hasAppFiles)).not.toHaveBeenCalled();
  });

  it("Web でファイルが無ければ workspace → apps の順にシードし、完了でプレビューを再読込する", async () => {
    vi.mocked(hasAppFiles).mockResolvedValue(false);
    vi.mocked(seedAppFromWorkspace).mockResolvedValue({ seeded: 0, skipped: 0 });
    vi.mocked(seedAppFromFilesystem).mockResolvedValue({ seeded: 2, skipped: 0 });
    const before = useAppStore.getState().reloadCounter;

    useAppStore.getState().setCurrentAppId("app-seed");
    await vi.advanceTimersByTimeAsync(600);

    expect(vi.mocked(hasAppFiles)).toHaveBeenCalledWith("app-seed");
    expect(vi.mocked(seedAppFromWorkspace)).toHaveBeenCalledWith("app-seed");
    expect(vi.mocked(seedAppFromFilesystem)).toHaveBeenCalledWith("app-seed");
    expect(useAppStore.getState().reloadCounter).toBe(before + 1);
  });

  it("workspace 側に既にあれば apps/ へフォールバックせずそのまま終える", async () => {
    vi.mocked(hasAppFiles).mockResolvedValue(false);
    vi.mocked(seedAppFromWorkspace).mockResolvedValue({ seeded: 3, skipped: 0 });
    const before = useAppStore.getState().reloadCounter;

    useAppStore.getState().setCurrentAppId("app-ws-only");
    await vi.advanceTimersByTimeAsync(600);

    expect(vi.mocked(seedAppFromFilesystem)).not.toHaveBeenCalled();
    expect(useAppStore.getState().reloadCounter).toBe(before + 1);
  });

  it("ファイルが既にある場合はシードも再読込も走らない", async () => {
    vi.mocked(hasAppFiles).mockResolvedValue(true);
    const before = useAppStore.getState().reloadCounter;

    useAppStore.getState().setCurrentAppId("app-has-files");
    await vi.advanceTimersByTimeAsync(600);

    expect(vi.mocked(seedAppFromWorkspace)).not.toHaveBeenCalled();
    expect(vi.mocked(seedAppFromFilesystem)).not.toHaveBeenCalled();
    expect(useAppStore.getState().reloadCounter).toBe(before);
  });

  it("デスクトップでは実ファイルが使えるためシードを試みない", async () => {
    vi.mocked(hasAppFiles).mockClear();

    await withDesktopEnv(async () => {
      useAppStore.getState().setCurrentAppId("app-desktop");
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(vi.mocked(hasAppFiles)).not.toHaveBeenCalled();
    expect(mockStorageFns.saveCurrentAppId).toHaveBeenCalledWith("app-desktop");
  });
});

// ── initialize() の全体タイムアウト ─────────────────────────────────────────

describe("useAppStore — initialize() のタイムアウト強制完了", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("10秒以内に完了しなければ警告を出して initialized を立てる", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 設定読込が永遠に返らない状態を再現（ネットワーク/DB ハング）
    mockStorageFns.loadSettingsDesktop.mockImplementation(() => new Promise(() => {}));

    try {
      const init = useAppStore.getState().initialize();
      await vi.advanceTimersByTimeAsync(10_000);
      await init;

      expect(warn).toHaveBeenCalledWith(
        "[initialize] Timed out after 10000ms — forcing app to load",
      );
      expect(useAppStore.getState().initialized).toBe(true);
    } finally {
      warn.mockRestore();
      mockStorageFns.loadSettingsDesktop.mockResolvedValue({
        theme: "system",
        uiFontSize: 14,
        codeFontSize: 13,
        language: "ja",
        simpleMode: true,
      });
    }
  });
});

// ── 追加の未到達パス（言語変更の i18n 適用・無効ID時のチェックポイント取得・
//    デスクトップでの同期ペイロード空チェック） ────────────────────────────────

describe("useAppStore — 追加の未到達パス", () => {
  it("updateSettings は言語変更を i18n に反映する", async () => {
    useAppStore.getState().updateSettings({ language: "en" });

    const i18nMod = await import("../lib/i18n");
    expect(vi.mocked(i18nMod.default.changeLanguage)).toHaveBeenCalledWith("en");
    expect(useAppStore.getState().settings.language).toBe("en");
    expect(mockStorageFns.saveSettingsDesktop).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    );
  });

  it("アプリ未選択時はチェックポイントを問い合わせない", async () => {
    useAppStore.setState({ currentAppId: null });

    await useAppStore.getState().fetchCheckpoints();

    expect(mockEngineFns.listCheckpoints).not.toHaveBeenCalled();
    expect(useAppStore.getState().checkpoints).toEqual([]);
  });

  it("desktop: 同期する値が無いときはサイドカーへ送信しない", async () => {
    sidecarFetchMock.mockClear();

    await withDesktopEnv(() =>
      useAppStore.getState().setAiConfig({
        provider: "ollama",
        model: "llama3.2",
        apiKey: "",
        apiKeyConfigured: true,
      }),
    );

    expect(sidecarFetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().aiConfig.provider).toBe("ollama");
    expect(useAppStore.getState().apiKeyStorageMethod).toBe("");
  });
});
