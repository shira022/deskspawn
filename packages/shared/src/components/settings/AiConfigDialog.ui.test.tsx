import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AiConfigDialog } from "./AiConfigDialog";
import { providerLabels, providerGroups } from "../../lib/constants";
import type { AiConfig, ProviderKind } from "../../types";

// ── Locale (real en bundle → expectations stay in sync with the shipped copy) ──

const enModules = import.meta.glob("../../locales/en/common.json", {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const enBundle = Object.values(enModules)[0]?.default ?? {};

function lookup(bundle: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, bundle);
}

function enT(key: string): string {
  const value = lookup(enBundle, key);
  return typeof value === "string" ? value : key;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-i18next", async () => {
  const modules = import.meta.glob("../../locales/en/common.json", {
    eager: true,
  }) as Record<string, { default: Record<string, unknown> }>;
  const bundle = Object.values(modules)[0]?.default ?? {};

  const t = (key: string, opts?: Record<string, unknown>): string => {
    const value = lookup(bundle, key);
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
    // lib/i18n（useModels 経由で import される）が使うプラグイン定義
    initReactI18next: { type: "3rdParty", init: () => undefined },
  };
});

const mockStore = {
  aiConfig: null as AiConfig | null,
  setAiConfig: vi.fn().mockResolvedValue("browser"),
  addToast: vi.fn(),
  apiKeyStorageMethod: "browser",
};

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}));

vi.mock("../../lib/storage", () => ({
  hasApiKey: vi.fn().mockResolvedValue(false),
  loadProviderConfig: vi.fn().mockResolvedValue(null),
}));

// モデル一覧はフック単体のテスト（useModels.test.ts）の責務なので、
// ここでは「一覧なし（手動入力）」の静的状態を返すだけにする。
const modelsState = vi.hoisted(() => ({
  models: [] as Array<{ id: string }>,
  loading: false,
  error: "",
  fetchModels: vi.fn(),
}));

vi.mock("../../hooks/useModels", () => ({
  useModels: () => modelsState,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const onOpenChange = vi.fn();

async function renderDialog() {
  const utils = render(<AiConfigDialog open={true} onOpenChange={onOpenChange} />);
  // open 時の effect（hasApiKey 等の非同期チェック）を待たせる
  await act(async () => {});
  return utils;
}

function getProviderSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector("select");
  expect(select, "provider select should render").not.toBeNull();
  return select as HTMLSelectElement;
}

async function selectProvider(
  select: HTMLSelectElement,
  value: string,
): Promise<void> {
  await act(async () => {
    fireEvent.change(select, { target: { value } });
  });
}

function inputsByPlaceholder(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll("input"));
}

function hasPasswordInput(container: HTMLElement): boolean {
  return inputsByPlaceholder(container).some(
    (input) => input.getAttribute("type") === "password",
  );
}

function findInput(
  container: HTMLElement,
  predicate: (input: HTMLInputElement) => boolean,
): HTMLInputElement | undefined {
  return inputsByPlaceholder(container).find(predicate);
}

async function typeInto(
  input: HTMLInputElement | undefined,
  value: string,
): Promise<void> {
  expect(input, "expected input to be present").toBeDefined();
  await act(async () => {
    fireEvent.change(input as HTMLInputElement, { target: { value } });
  });
}

async function clickSave(): Promise<void> {
  const saveButton = screen.getByRole("button", { name: enT("common.save") });
  await act(async () => {
    fireEvent.click(saveButton);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.aiConfig = null;
  mockStore.setAiConfig.mockResolvedValue("browser");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AiConfigDialog — provider select", () => {
  it("renders 3 optgroups covering all 9 providers, none disabled", async () => {
    const { container } = await renderDialog();
    const select = getProviderSelect(container);

    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups).toHaveLength(providerGroups.length);
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(
      providerGroups.map((g) => g.label),
    );

    const options = Array.from(select.querySelectorAll("option"));
    expect(options).toHaveLength(9);
    expect(options.map((o) => o.value)).toEqual(
      providerGroups.flatMap((g) => g.providers),
    );
    for (const option of options) {
      expect(option.disabled, option.value).toBe(false);
    }

    providerGroups.forEach((group, index) => {
      const groupOptions = Array.from(groups[index].querySelectorAll("option"));
      expect(groupOptions.map((o) => o.value)).toEqual(group.providers);
    });
  });

  it("labels every option exactly like providerLabels", async () => {
    const { container } = await renderDialog();
    const select = getProviderSelect(container);

    const options = Array.from(select.querySelectorAll("option"));
    expect(options).toHaveLength(Object.keys(providerLabels).length);

    for (const option of options) {
      expect(option.textContent, option.value).toBe(
        providerLabels[option.value as ProviderKind],
      );
    }
  });
});

interface FieldCase {
  provider: ProviderKind;
  apiKey: boolean;
  labelKeys: string[];
  absentLabelKeys: string[];
  placeholders: string[];
  absentPlaceholders: string[];
}

const FIELD_CASES: FieldCase[] = [
  {
    provider: "ollama",
    apiKey: false,
    labelKeys: ["ai.customEndpoint"],
    absentLabelKeys: ["ai.apiKey", "ai.region", "ai.gcpRegion", "ai.azureEndpointUrl"],
    placeholders: ["http://localhost:11434"],
    absentPlaceholders: ["http://localhost:1234/v1", "https://your-api.example.com/v1"],
  },
  {
    provider: "lm-studio",
    apiKey: false,
    labelKeys: ["ai.customEndpoint"],
    absentLabelKeys: ["ai.apiKey", "ai.region", "ai.gcpRegion", "ai.azureEndpointUrl"],
    placeholders: ["http://localhost:1234/v1"],
    absentPlaceholders: ["http://localhost:11434", "https://your-api.example.com/v1"],
  },
  {
    provider: "openai-compatible",
    apiKey: true,
    labelKeys: ["ai.apiKey", "ai.customEndpoint"],
    absentLabelKeys: ["ai.region", "ai.gcpRegion", "ai.azureEndpointUrl", "ai.corsProxyUrl"],
    placeholders: ["https://your-api.example.com/v1"],
    absentPlaceholders: ["http://localhost:11434", "http://localhost:1234/v1"],
  },
  {
    provider: "azure-foundry",
    apiKey: true,
    labelKeys: ["ai.apiKey", "ai.azureEndpointUrl"],
    absentLabelKeys: ["ai.region", "ai.gcpRegion", "ai.customEndpoint", "ai.corsProxyUrl"],
    placeholders: ["https://your-resource.openai.azure.com"],
    absentPlaceholders: ["https://your-api.example.com/v1"],
  },
  {
    provider: "aws-bedrock",
    apiKey: true,
    labelKeys: ["ai.apiKey", "ai.region"],
    absentLabelKeys: ["ai.gcpRegion", "ai.azureEndpointUrl", "ai.customEndpoint", "ai.corsProxyUrl"],
    placeholders: [],
    absentPlaceholders: ["https://your-api.example.com/v1"],
  },
  {
    provider: "gcp-vertexai",
    apiKey: true,
    labelKeys: ["ai.apiKey", "ai.gcpRegion"],
    absentLabelKeys: ["ai.region", "ai.azureEndpointUrl", "ai.customEndpoint", "ai.corsProxyUrl"],
    placeholders: [],
    absentPlaceholders: ["https://your-api.example.com/v1"],
  },
  {
    provider: "openai",
    apiKey: true,
    labelKeys: ["ai.apiKey"],
    absentLabelKeys: [
      "ai.region",
      "ai.gcpRegion",
      "ai.customEndpoint",
      "ai.azureEndpointUrl",
      "ai.corsProxyUrl",
    ],
    placeholders: [],
    absentPlaceholders: ["https://your-api.example.com/v1"],
  },
  {
    provider: "google",
    apiKey: true,
    labelKeys: ["ai.apiKey"],
    absentLabelKeys: [
      "ai.region",
      "ai.gcpRegion",
      "ai.customEndpoint",
      "ai.azureEndpointUrl",
      "ai.corsProxyUrl",
    ],
    placeholders: [],
    absentPlaceholders: ["https://your-api.example.com/v1"],
  },
  {
    provider: "anthropic",
    apiKey: true,
    labelKeys: ["ai.apiKey", "ai.corsProxyUrl"],
    absentLabelKeys: ["ai.region", "ai.gcpRegion", "ai.azureEndpointUrl", "ai.customEndpoint"],
    placeholders: ["https://your-api.example.com/v1"],
    absentPlaceholders: ["http://localhost:11434"],
  },
];

describe("AiConfigDialog — per-provider form", () => {
  it.each(FIELD_CASES)(
    "$provider → api key: $apiKey, expected fields only",
    async ({
      provider,
      apiKey,
      labelKeys,
      absentLabelKeys,
      placeholders,
      absentPlaceholders,
    }) => {
      const { container } = await renderDialog();
      const select = getProviderSelect(container);
      await selectProvider(select, provider);

      expect(select.value).toBe(provider);
      expect(hasPasswordInput(container), `${provider} api key input`).toBe(apiKey);

      for (const key of labelKeys) {
        expect(screen.queryByText(enT(key)), `${provider} / ${key}`).toBeInTheDocument();
      }
      for (const key of absentLabelKeys) {
        expect(screen.queryByText(enT(key)), `${provider} / ${key}`).not.toBeInTheDocument();
      }
      for (const placeholder of placeholders) {
        expect(
          findInput(container, (i) => i.getAttribute("placeholder") === placeholder),
          `${provider} / ${placeholder}`,
        ).toBeDefined();
      }
      for (const placeholder of absentPlaceholders) {
        expect(
          findInput(container, (i) => i.getAttribute("placeholder") === placeholder),
          `${provider} / ${placeholder}`,
        ).toBeUndefined();
      }

      // リージョン欄の粒度（AWS と GCP は互いに表示しない）
      const awsRegion = findInput(container, (i) =>
        i.getAttribute("placeholder") === enT("ai.regionPlaceholder"),
      );
      const gcpRegion = findInput(container, (i) =>
        i.getAttribute("placeholder") === enT("ai.gcpRegionPlaceholder"),
      );
      expect(Boolean(awsRegion), `${provider} aws region`).toBe(provider === "aws-bedrock");
      expect(Boolean(gcpRegion), `${provider} gcp region`).toBe(provider === "gcp-vertexai");
    },
  );
});

describe("AiConfigDialog — save validation", () => {
  const CASES: Array<{ provider: ProviderKind; errorKey: string }> = [
    { provider: "gcp-vertexai", errorKey: "ai.error.gcpRegionRequired" },
    { provider: "aws-bedrock", errorKey: "ai.error.regionRequired" },
    { provider: "openai-compatible", errorKey: "ai.error.customEndpointRequired" },
    { provider: "azure-foundry", errorKey: "ai.error.customEndpointRequired" },
  ];

  it.each(CASES)(
    "$provider without the required field shows $errorKey",
    async ({ provider, errorKey }) => {
      const { container } = await renderDialog();
      const select = getProviderSelect(container);
      await selectProvider(select, provider);

      await typeInto(
        findInput(container, (i) => i.getAttribute("type") === "password"),
        "sk-test",
      );
      await typeInto(
        findInput(
          container,
          (i) => i.getAttribute("placeholder") === enT("ai.modelPlaceholderWithExample"),
        ),
        "test-model",
      );

      // リージョン / エンドポイントは意図的に未入力
      await clickSave();

      expect(screen.getByText(enT(errorKey))).toBeInTheDocument();
      expect(mockStore.setAiConfig).not.toHaveBeenCalled();
    },
  );

  it("shows the model error when no model is entered", async () => {
    const { container } = await renderDialog();
    const select = getProviderSelect(container);
    await selectProvider(select, "openai");

      await typeInto(
        findInput(container, (i) => i.getAttribute("type") === "password"),
        "sk-test",
      );
      await clickSave();

    expect(screen.getByText(enT("ai.error.modelRequired"))).toBeInTheDocument();
    expect(mockStore.setAiConfig).not.toHaveBeenCalled();
  });
});

describe("AiConfigDialog — legacy provider IDs", () => {
  it.each(["custom", "amazon-bedrock"] as const)(
    "falls back to openai for the legacy id '%s'",
    async (legacyId) => {
      mockStore.aiConfig = {
        provider: legacyId,
        apiKey: "",
        model: "",
      } as unknown as AiConfig;

      const { container } = await renderDialog();
      const select = getProviderSelect(container);

      expect(select.value).toBe("openai");
      expect(
        screen.getByText(providerLabels.openai),
      ).toBeInTheDocument();
    },
  );
});

describe("AiConfigDialog — saving", () => {
  it("stores the selected lm-studio config", async () => {
    const { container } = await renderDialog();
    const select = getProviderSelect(container);
    await selectProvider(select, "lm-studio");

    expect(select.value).toBe("lm-studio");
    expect(hasPasswordInput(container)).toBe(false);

    await typeInto(
      findInput(
        container,
        (i) => i.getAttribute("placeholder") === "http://localhost:1234/v1",
      ),
      "http://192.168.1.50:1234/v1",
    );
    await typeInto(
      findInput(
        container,
        (i) => i.getAttribute("placeholder") === enT("ai.modelPlaceholderWithExample"),
      ),
      "qwen2.5-7b-instruct",
    );

    await clickSave();

    expect(mockStore.setAiConfig).toHaveBeenCalledTimes(1);
    expect(mockStore.setAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "lm-studio",
        model: "qwen2.5-7b-instruct",
        customEndpoint: "http://192.168.1.50:1234/v1",
      }),
    );
    expect(mockStore.addToast).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
