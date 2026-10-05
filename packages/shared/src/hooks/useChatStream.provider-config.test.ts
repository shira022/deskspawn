// @vitest-environment jsdom
/**
 * 送信前のプロバイダー設定チェック（getProviderConfigIssue）の網羅テスト。
 *
 * - 9 プロバイダー全件: 必須情報が揃っていれば null
 * - 欠落時: 対応する i18n キーを含むメッセージを返す
 * - キー必須プロバイダーの API キー欠落はこの関数の責務外（呼び出し元の
 *   providerNeedsApiKey チェックが chat.error.apiKeyRequiredDetailed を返す）ため、
 *   実際に startGeneration() を流してその経路を検証する
 * - 使う i18n キーが ja/en 両ロケールに存在すること
 *
 * i18n.t はモック（キー + パラメータを返す）して、どのキーが使われるかを直接観測する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const tMock = vi.hoisted(() =>
  vi.fn(
    (key: string, opts?: Record<string, unknown>) =>
      `${key}|${JSON.stringify(opts ?? {})}`,
  ),
);

vi.mock("../lib/i18n", () => ({
  default: {
    t: tMock,
    changeLanguage: vi.fn(),
    language: "ja",
  },
}));

const loadApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/storage", () => ({
  saveProviderConfig: vi.fn().mockResolvedValue(undefined),
  loadProviderConfig: vi.fn().mockResolvedValue(null),
  saveApiKey: vi.fn().mockResolvedValue("browser"),
  loadApiKey: loadApiKeyMock,
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  hasApiKey: vi.fn().mockResolvedValue(false),
  saveLastProvider: vi.fn().mockResolvedValue(undefined),
  loadLastProvider: vi.fn().mockResolvedValue(null),
  saveCurrentAppId: vi.fn().mockResolvedValue(undefined),
  loadCurrentAppId: vi.fn().mockResolvedValue(null),
  saveSettingsDesktop: vi.fn().mockResolvedValue(undefined),
  loadSettingsDesktop: vi.fn().mockResolvedValue(null),
  listApps: vi.fn().mockResolvedValue([]),
}));

vi.mock("../engine/tool-executors", () => ({
  setAppId: vi.fn(),
  listCheckpoints: vi.fn().mockResolvedValue([]),
  persistChatHistory: vi.fn().mockResolvedValue(true),
  loadChatHistory: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
  listFiles: vi.fn(),
  applyArtifact: vi.fn(),
  getErrors: vi.fn(),
  takeScreenshot: vi.fn(),
  createCheckpoint: vi.fn(),
}));

import { getProviderConfigIssue, useChatStream } from "./useChatStream";
import { useAppStore } from "../store/useAppStore";
import {
  providerCategories,
  providerLabels,
  providerNeedsApiKey,
} from "../lib/constants";
import type { AiConfig, ProviderKind } from "../types";

const ALL_PROVIDERS = Object.keys(providerCategories) as ProviderKind[];
const KEY_REQUIRED_PROVIDERS = ALL_PROVIDERS.filter((p) => providerNeedsApiKey(p));

/** 必須情報が揃った完全設定 */
function completeConfig(provider: ProviderKind): AiConfig {
  const base: AiConfig = { provider, apiKey: "sk-test", model: "model-1" };
  switch (provider) {
    case "aws-bedrock":
      return { ...base, region: "us-east-1" };
    case "gcp-vertexai":
      return { ...base, region: "us-central1" };
    case "azure-foundry":
      return { ...base, customEndpoint: "https://my-resource.openai.azure.com" };
    case "openai-compatible":
      return { ...base, customEndpoint: "https://example.com/v1" };
    case "ollama":
    case "lm-studio":
      return { provider, apiKey: "", model: "llama3.2" };
    default:
      return base;
  }
}

interface MissingCase {
  provider: ProviderKind;
  patch: Partial<AiConfig>;
  key: string;
}

const MISSING_CASES: MissingCase[] = [
  {
    provider: "openai-compatible",
    patch: { customEndpoint: "" },
    key: "chat.error.customEndpointRequired",
  },
  {
    provider: "azure-foundry",
    patch: { customEndpoint: "" },
    key: "chat.error.customEndpointRequired",
  },
  {
    provider: "aws-bedrock",
    patch: { region: "" },
    key: "chat.error.regionRequired",
  },
  {
    provider: "gcp-vertexai",
    patch: { region: "" },
    key: "chat.error.gcpRegionRequired",
  },
  {
    provider: "ollama",
    patch: { model: "" },
    key: "chat.error.ollamaModelRequired",
  },
  {
    provider: "lm-studio",
    patch: { model: "" },
    key: "chat.error.ollamaModelRequired",
  },
];

function getByPath(bundle: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, bundle);
}

beforeEach(() => {
  vi.clearAllMocks();
  loadApiKeyMock.mockResolvedValue(null);
  useAppStore.setState({
    messages: [],
    aiConfig: null,
    currentAppId: null,
    saveFailed: false,
  });
});

describe("getProviderConfigIssue", () => {
  it("returns null for every provider with a complete config", () => {
    expect(ALL_PROVIDERS).toHaveLength(9);

    for (const provider of ALL_PROVIDERS) {
      const issue = getProviderConfigIssue(
        completeConfig(provider),
        providerLabels[provider],
      );
      expect(issue, provider).toBeNull();
    }
  });

  it.each(MISSING_CASES)(
    "$provider → returns the $key message",
    ({ provider, patch, key }) => {
      const cfg: AiConfig = { ...completeConfig(provider), ...patch };
      const issue = getProviderConfigIssue(cfg, providerLabels[provider]);

      expect(issue).toContain(key);
      // どのプロバイダーの問題か分かるよう、ラベルがパラメータとして渡る
      expect(issue).toContain(providerLabels[provider]);
      // モデル未指定の例示もパラメータで渡る
      if (key === "chat.error.ollamaModelRequired") {
        expect(issue).toContain("example");
      }
    },
  );

  it("does not validate the API key (it is checked by the caller)", () => {
    // キー欠落は startGeneration() 側の providerNeedsApiKey チェックの責務
    // （useChatStream.ts の loadApiKey 後の分岐）。
    for (const provider of KEY_REQUIRED_PROVIDERS) {
      const cfg: AiConfig = { ...completeConfig(provider), apiKey: "" };
      expect(
        getProviderConfigIssue(cfg, providerLabels[provider]),
        provider,
      ).toBeNull();
    }
  });
});

describe("startGeneration — pre-flight provider checks", () => {
  async function runStartGeneration() {
    const { result } = renderHook(() => useChatStream());
    await act(async () => {
      await result.current.startGeneration([]);
    });
    return useAppStore.getState().messages;
  }

  it.each(KEY_REQUIRED_PROVIDERS)(
    "%s without an API key → chat.error.apiKeyRequiredDetailed",
    async (provider) => {
      useAppStore.setState({
        aiConfig: completeConfig(provider),
        currentAppId: "app-1",
      });
      loadApiKeyMock.mockResolvedValue(null);

      const messages = await runStartGeneration();

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].content).toContain("chat.error.apiKeyRequiredDetailed");
      expect(messages[0].content).toContain(providerLabels[provider]);
      // この経路ではモデル解決に進まない
      expect(messages[0].content).not.toContain("providerConfigError");
    },
  );

  it.each(MISSING_CASES)(
    "$provider with a missing field → wrapped in chat.error.providerConfigError",
    async ({ provider, patch, key }) => {
      useAppStore.setState({
        aiConfig: { ...completeConfig(provider), ...patch },
        currentAppId: "app-1",
      });
      // キー必須プロバイダーはキーを解決済みにしておく（欠落チェックを先に通過させる）
      loadApiKeyMock.mockResolvedValue("sk-present");

      const messages = await runStartGeneration();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain("chat.error.providerConfigError");
      expect(messages[0].content).toContain(key);
      expect(messages[0].content).toContain(providerLabels[provider]);
    },
  );

  it("local providers do not require an API key to reach the config check", async () => {
    useAppStore.setState({
      aiConfig: { ...completeConfig("ollama"), model: "" },
      currentAppId: "app-1",
    });
    loadApiKeyMock.mockResolvedValue(null);

    const messages = await runStartGeneration();

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("chat.error.ollamaModelRequired");
  });
});

describe("provider-config i18n keys", () => {
  const REQUIRED_KEYS = [
    "chat.error.customEndpointRequired",
    "chat.error.regionRequired",
    "chat.error.gcpRegionRequired",
    "chat.error.ollamaModelRequired",
    "chat.error.apiKeyRequiredDetailed",
    "chat.error.providerConfigError",
  ];

  // このファイルでは i18n をモックしているため、キー実在の検証にだけ実物を使う
  async function realI18n() {
    const mod = await vi.importActual<typeof import("../lib/i18n")>("../lib/i18n");
    return mod.default;
  }

  for (const lng of ["ja", "en"] as const) {
    it(`${lng}: every key used by the pre-flight check exists and expands`, async () => {
      const i18n = await realI18n();
      for (const key of REQUIRED_KEYS) {
        const bundle = i18n.getResourceBundle(lng, "translation");
        expect(typeof getByPath(bundle, key), `${lng}:${key}`).toBe("string");

        const text = i18n.t(key, {
          lng,
          provider: "OpenAI",
          detail: "detail",
          example: "llama3.2",
          modelLabel: "gpt-4o",
        });
        expect(text, `${lng}:${key}`).not.toBe(key);
        expect(text.length, `${lng}:${key}`).toBeGreaterThan(0);
      }
    });
  }

  it("ja and en have distinct messages for every key", async () => {
    const i18n = await realI18n();
    for (const key of REQUIRED_KEYS) {
      const jaText = i18n.t(key, { lng: "ja" });
      const enText = i18n.t(key, { lng: "en" });
      expect(jaText, key).not.toBe(key);
      expect(enText, key).not.toBe(key);
      expect(jaText, key).not.toBe(enText);
    }
  });
});
