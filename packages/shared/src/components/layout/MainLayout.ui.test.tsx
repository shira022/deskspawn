import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MainLayout } from "./MainLayout";
import { loadProviderConfig } from "../../lib/storage";
import type { AiConfig, ProviderKind } from "../../types";

// ── i18n（実 en バンドル。ロケール変更に追従する） ─────────────────────────────

vi.mock("react-i18next", async () => {
  const modules = import.meta.glob("../../locales/en/common.json", {
    eager: true,
  }) as Record<string, { default: Record<string, unknown> }>;
  const bundle = Object.values(modules)[0]?.default ?? {};

  const lookup = (path: string): unknown =>
    path.split(".").reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, bundle);

  const t = (key: string, opts?: Record<string, unknown>): string => {
    const value = lookup(key);
    let text = typeof value === "string" ? value : key;
    if (opts) {
      for (const [name, raw] of Object.entries(opts)) {
        text = text.split(`{{${name}}}`).join(String(raw));
      }
    }
    return text;
  };

  return {
    useTranslation: () => ({ t, i18n: { changeLanguage: vi.fn(), language: "en" } }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
    initReactI18next: { type: "3rdParty", init: () => undefined },
  };
});

// ── Store ─────────────────────────────────────────────────────────────────────

const mockStore = {
  layoutMode: "2-pane",
  setLayoutMode: vi.fn(),
  aiConfig: {
    provider: "openai",
    apiKey: "",
    model: "gpt-4o",
    apiKeyConfigured: true,
  } as AiConfig,
  setAiConfig: vi.fn().mockResolvedValue("browser"),
  initialized: true,
  languageUnset: false,
  currentAppId: null,
  apps: [],
  appSwitching: false,
  appLoading: false,
  previewMaximized: false,
  workspaceReady: false,
  settings: { theme: "system", uiFontSize: 14, codeFontSize: 13, language: "en", simpleMode: false },
  resolvedTheme: "light",
  updateSettings: vi.fn(),
  setAppLoading: vi.fn(),
};

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}));

// ── Heavy children / layout primitives ────────────────────────────────────────

vi.mock("../chat/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("../preview/PreviewPanel", () => ({ PreviewPanel: () => null }));
vi.mock("../file-tree/FileTreePanel", () => ({ FileTreePanel: () => null }));
vi.mock("../app/NewAppDialog", () => ({ NewAppDialog: () => null }));
vi.mock("../app/AppSwitcher", () => ({ AppSwitcher: () => null }));
vi.mock("./StatusBar", () => ({ StatusBar: () => null }));
vi.mock("../settings/SettingsDialog", () => ({ SettingsDialog: () => null }));
vi.mock("../settings/AiConfigDialog", () => ({ AiConfigDialog: () => null }));
vi.mock("../onboarding/LanguageSelectScreen", () => ({
  LanguageSelectScreen: () => null,
}));

vi.mock("../ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

const modelsState = vi.hoisted(() => ({
  models: [] as Array<{ id: string }>,
  loading: false,
  error: "",
  fetchModels: vi.fn(),
}));

vi.mock("../../hooks/useModels", () => ({
  useModels: () => modelsState,
}));

vi.mock("../../lib/storage", () => ({
  loadProviderConfig: vi.fn().mockResolvedValue(null),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderToolbar() {
  const utils = render(<MainLayout />);
  await act(async () => {});
  return utils;
}

async function openModelPopover(): Promise<HTMLSelectElement> {
  const toolbarButton = screen.getByRole("button", { name: /gpt-4o/ });
  await act(async () => {
    fireEvent.click(toolbarButton);
  });
  const select = screen.getByRole("combobox");
  return select as HTMLSelectElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.aiConfig = {
    provider: "openai",
    apiKey: "",
    model: "gpt-4o",
    apiKeyConfigured: true,
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MainLayout — toolbar provider select", () => {
  // 期待値はリテラル固定（providerGroups / providerLabels を参照すると
  // 実装側の改変に追従してミューテーション検出不能になるため）。
  const EXPECTED_GROUP_LABELS = ["Cloud", "Local", "OpenAI Compatible"];
  const EXPECTED_GROUP_PROVIDERS: string[][] = [
    ["openai", "anthropic", "google", "aws-bedrock", "azure-foundry", "gcp-vertexai"],
    ["ollama", "lm-studio"],
    ["openai-compatible"],
  ];
  const EXPECTED_PROVIDERS = EXPECTED_GROUP_PROVIDERS.flat();

  const EXPECTED_LABELS: Record<ProviderKind, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    "aws-bedrock": "AWS Bedrock",
    "azure-foundry": "Azure Foundry",
    "gcp-vertexai": "Google Cloud (Vertex AI)",
    ollama: "Ollama (Local)",
    "lm-studio": "LM Studio (Local)",
    "openai-compatible": "Custom (OpenAI Compatible)",
  };

  it("shows all 9 providers in the 3 category optgroups, none disabled", async () => {
    await renderToolbar();
    const select = await openModelPopover();

    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups).toHaveLength(EXPECTED_GROUP_LABELS.length);
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(EXPECTED_GROUP_LABELS);

    const options = Array.from(select.querySelectorAll("option"));
    expect(options).toHaveLength(9);
    expect(options.map((o) => o.value)).toEqual(EXPECTED_PROVIDERS);
    for (const option of options) {
      expect(option.disabled, option.value).toBe(false);
    }

    EXPECTED_GROUP_PROVIDERS.forEach((providers, index) => {
      const groupOptions = Array.from(groups[index].querySelectorAll("option"));
      expect(groupOptions.map((o) => o.value)).toEqual(providers);
    });
  });

  it("labels every option with the hardcoded provider display name", async () => {
    await renderToolbar();
    const select = await openModelPopover();

    const options = Array.from(select.querySelectorAll("option"));
    expect(options).toHaveLength(Object.keys(EXPECTED_LABELS).length);

    for (const option of options) {
      const label = EXPECTED_LABELS[option.value as ProviderKind];
      expect(option.textContent, option.value).toBeTruthy();
      expect(option.textContent?.startsWith(`${label} - `), option.value).toBe(true);
    }
  });

  it("switching the provider loads that provider's saved config", async () => {
    await renderToolbar();
    const select = await openModelPopover();

    await act(async () => {
      fireEvent.change(select, { target: { value: "ollama" } });
    });

    // バリデーションと保存 config の読み込みだけを検証する
    // （store はモックなので、select 表示値はステアリングされない）
    expect(loadProviderConfig).toHaveBeenCalledWith("ollama");
    expect(mockStore.setAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "ollama" }),
    );
    // 未知の ID は握りつぶされる（isProviderKind ガード）
    mockStore.setAiConfig.mockClear();
    await act(async () => {
      fireEvent.change(select, { target: { value: "legacy-unknown" } });
    });
    expect(loadProviderConfig).not.toHaveBeenCalledWith("legacy-unknown");
    expect(mockStore.setAiConfig).not.toHaveBeenCalled();
  });
});
