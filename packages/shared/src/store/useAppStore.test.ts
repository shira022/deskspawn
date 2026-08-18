import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { ChatMessage, FileNode, AppMeta } from "../types";

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
    deleteProviderConfig: vi.fn().mockResolvedValue(undefined),
    hasProviderConfig: vi.fn().mockResolvedValue(false),
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
