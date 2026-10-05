import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all AI SDK provider packages ──────────────────────────────────────────
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn((modelId: string) => ({ provider: "openai", modelId })),
    responses: vi.fn((modelId: string) => ({ provider: "openai-responses", modelId })),
  })),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => ({
    messages: vi.fn((modelId: string) => ({ provider: "anthropic", modelId })),
  })),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    chat: vi.fn((modelId: string) => ({ provider: "google", modelId })),
  })),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => ({
    chatModel: vi.fn((modelId: string) => ({
      provider: "openai-compatible",
      modelId,
    })),
    chat: vi.fn((modelId: string) => ({
      provider: "openai-compatible",
      modelId,
    })),
  })),
}));

vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn(() =>
    vi.fn((modelId: string) => ({ provider: "aws-bedrock", modelId })),
  ),
}));

vi.mock("@ai-sdk/azure", () => ({
  createAzure: vi.fn(() =>
    vi.fn((modelId: string) => ({ provider: "azure", modelId })),
  ),
}));

vi.mock("@ai-sdk/google-vertex/edge", () => ({
  createVertex: vi.fn(() =>
    vi.fn((modelId: string) => ({ provider: "gcp-vertexai", modelId })),
  ),
}));

// ── Platform / sidecar routing (openai-compatible picks web vs desktop) ──────

const isDesktopEnvMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../lib/platform", () => ({
  isDesktopEnv: isDesktopEnvMock,
}));

vi.mock("../lib/sidecar", () => ({
  sidecarBase: vi.fn(() => "http://127.0.0.1:3009"),
  sidecarFetchWithToken: vi.fn(),
  sidecarFetch: vi.fn(),
}));

// ── Imports (after vi.mock — hoisted by vitest) ───────────────────────────────

import { getModel } from "./providers";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAzure } from "@ai-sdk/azure";
import { createVertex } from "@ai-sdk/google-vertex/edge";
import { sidecarBase, sidecarFetchWithToken } from "../lib/sidecar";
import { providerCategories } from "../lib/constants";

import type { ProviderConfig } from "./types";
import type { ProviderKind } from "../types";

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("getModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an openai model with correct model ID', () => {
    const config: ProviderConfig = {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({ provider: "openai", modelId: "gpt-4o" });
    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: undefined,
    });
  });

  it('uses Responses API for gpt-5 family models (function tools + reasoning)', () => {
    const config: ProviderConfig = {
      provider: "openai",
      model: "gpt-5.6-luna",
      apiKey: "sk-test",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({ provider: "openai-responses", modelId: "gpt-5.6-luna" });
  });

  it('uses Responses API for gpt-5 codex models', () => {
    const config: ProviderConfig = {
      provider: "openai",
      model: "gpt-5-codex",
      apiKey: "sk-test",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({ provider: "openai-responses", modelId: "gpt-5-codex" });
  });

  it('creates an anthropic model', () => {
    const config: ProviderConfig = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-ant-test",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: "sk-ant-test",
      baseURL: undefined,
      headers: { "anthropic-dangerous-direct-browser-access": "true" },
    });
  });

  it('creates a google model', () => {
    const config: ProviderConfig = {
      provider: "google",
      model: "gemini-2.0-flash",
      apiKey: "google-test-key",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({ provider: "google", modelId: "gemini-2.0-flash" });
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: "google-test-key",
      baseURL: undefined,
    });
  });

  it('creates an ollama model with custom endpoint', () => {
    const config: ProviderConfig = {
      provider: "ollama",
      model: "llama3.2",
      customEndpoint: "http://192.168.1.100:11434/v1",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "openai-compatible",
      modelId: "llama3.2",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "ollama",
      baseURL: "http://192.168.1.100:11434/v1",
    });
  });

  it('ollama uses default localhost endpoint when customEndpoint is not set', () => {
    const config: ProviderConfig = {
      provider: "ollama",
      model: "qwen2.5",
    };
    getModel(config);
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "ollama",
      baseURL: "http://localhost:11434/v1",
    });
  });

  it('creates an OpenAI-compatible model for the openai-compatible provider', () => {
    const config: ProviderConfig = {
      provider: "openai-compatible",
      model: "my-model",
      apiKey: "custom-key",
      customEndpoint: "https://my-proxy.example.com/v1",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "openai-compatible",
      modelId: "my-model",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "openai-compatible",
      baseURL: "https://my-proxy.example.com/v1",
      apiKey: "custom-key",
    });
  });

  it('creates an lm-studio model with default localhost endpoint', () => {
    const config: ProviderConfig = {
      provider: "lm-studio",
      model: "qwen2.5-7b-instruct",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "openai-compatible",
      modelId: "qwen2.5-7b-instruct",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "lm-studio",
      baseURL: "http://localhost:1234/v1",
    });
  });

  it('lm-studio uses customEndpoint when provided', () => {
    const config: ProviderConfig = {
      provider: "lm-studio",
      model: "local-model",
      customEndpoint: "http://192.168.1.50:1234/v1",
    };
    getModel(config);
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "lm-studio",
      baseURL: "http://192.168.1.50:1234/v1",
    });
  });

  it('lm-studio does not require an API key', () => {
    const config: ProviderConfig = {
      provider: "lm-studio",
      model: "local-model",
      apiKey: "",
    };
    expect(() => getModel(config)).not.toThrow();
  });

  it('creates an aws-bedrock model with region', () => {
    const config: ProviderConfig = {
      provider: "aws-bedrock",
      model: "anthropic.claude-sonnet-4-20250514",
      apiKey: "aws-key",
      region: "us-east-1",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "aws-bedrock",
      modelId: "anthropic.claude-sonnet-4-20250514",
    });
    expect(createAmazonBedrock).toHaveBeenCalledWith({
      apiKey: "aws-key",
      region: "us-east-1",
    });
  });

  it('creates an azure-foundry model with resource name', () => {
    const config: ProviderConfig = {
      provider: "azure-foundry",
      model: "gpt-4",
      apiKey: "azure-key",
      customEndpoint: "https://my-resource.openai.azure.com",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({ provider: "azure", modelId: "gpt-4" });
    expect(createAzure).toHaveBeenCalledWith({
      apiKey: "azure-key",
      baseURL: "https://my-resource.openai.azure.com",
    });
  });

  it('creates a gcp-vertexai model with region', () => {
    const config: ProviderConfig = {
      provider: "gcp-vertexai",
      model: "gemini-2.0-flash-001",
      apiKey: "vertex-key",
      region: "us-central1",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "gcp-vertexai",
      modelId: "gemini-2.0-flash-001",
    });
    expect(createVertex).toHaveBeenCalledWith({
      apiKey: "vertex-key",
      location: "us-central1",
    });
  });

  // ── Error cases ────────────────────────────────────────────────────────────

  it("throws when API key is missing for openai", () => {
    const config: ProviderConfig = {
      provider: "openai",
      model: "gpt-4",
    };
    expect(() => getModel(config)).toThrow(/API key/i);
  });

  it("throws when API key is missing for anthropic", () => {
    const config: ProviderConfig = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
    expect(() => getModel(config)).toThrow(/API key/i);
  });

  it("throws when API key is missing for google", () => {
    const config: ProviderConfig = {
      provider: "google",
      model: "gemini-2.0-flash",
    };
    expect(() => getModel(config)).toThrow(/API key/i);
  });

  it("throws when model is missing for ollama", () => {
    const config: ProviderConfig = {
      provider: "ollama",
      model: "",
    };
    expect(() => getModel(config)).toThrow(/model/i);
  });

  it("throws when model is missing for lm-studio", () => {
    const config: ProviderConfig = {
      provider: "lm-studio",
      model: "",
    };
    expect(() => getModel(config)).toThrow(/model/i);
  });

  it("throws when customEndpoint is missing for openai-compatible", () => {
    const config: ProviderConfig = {
      provider: "openai-compatible",
      model: "my-model",
      apiKey: "key",
    };
    expect(() => getModel(config)).toThrow(/endpoint/i);
  });

  it("throws when API key is missing for openai-compatible", () => {
    const config: ProviderConfig = {
      provider: "openai-compatible",
      model: "my-model",
      customEndpoint: "https://example.com/v1",
    };
    expect(() => getModel(config)).toThrow(/API key/i);
  });

  it("throws when region is missing for aws-bedrock", () => {
    const config: ProviderConfig = {
      provider: "aws-bedrock",
      model: "claude",
      apiKey: "key",
    };
    expect(() => getModel(config)).toThrow(/region/i);
  });

  it("throws when region is missing for gcp-vertexai", () => {
    const config: ProviderConfig = {
      provider: "gcp-vertexai",
      model: "gemini-2.0-flash-001",
      apiKey: "key",
    };
    expect(() => getModel(config)).toThrow(/region/i);
  });

  it("throws when customEndpoint is missing for azure-foundry", () => {
    const config: ProviderConfig = {
      provider: "azure-foundry",
      model: "gpt-4",
      apiKey: "key",
    };
    expect(() => getModel(config)).toThrow(/endpoint/i);
  });

  it("throws for unsupported provider", () => {
    const config: ProviderConfig = {
      provider: "unknown-provider",
      model: "foo",
      apiKey: "key",
    };
    expect(() => getModel(config)).toThrow(/unsupported provider/i);
  });
});

// ── Coverage across every ProviderKind ────────────────────────────────────────

interface ModelLike {
  provider: string;
  modelId: string;
}

/**
 * 必須フィールドが揃った完全設定を 9 プロバイダー分定義する。
 * キーはハードコードせず providerCategories（単一情報源）と突き合わせ、
 * 新プロバイダー追加時にこの表が欠けるとテストが落ちるようにする。
 */
const COMPLETE_CONFIGS: Record<ProviderKind, ProviderConfig> = {
  openai: { provider: "openai", model: "gpt-4o", apiKey: "sk-test" },
  anthropic: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-ant-test",
  },
  google: { provider: "google", model: "gemini-2.0-flash", apiKey: "google-key" },
  "aws-bedrock": {
    provider: "aws-bedrock",
    model: "anthropic.claude-sonnet-4-20250514",
    apiKey: "aws-key",
    region: "us-east-1",
  },
  "azure-foundry": {
    provider: "azure-foundry",
    model: "gpt-4",
    apiKey: "azure-key",
    customEndpoint: "https://my-resource.openai.azure.com",
  },
  "gcp-vertexai": {
    provider: "gcp-vertexai",
    model: "gemini-2.0-flash-001",
    apiKey: "vertex-key",
    region: "us-central1",
  },
  ollama: { provider: "ollama", model: "llama3.2" },
  "lm-studio": { provider: "lm-studio", model: "qwen2.5-7b-instruct" },
  "openai-compatible": {
    provider: "openai-compatible",
    model: "my-model",
    apiKey: "custom-key",
    customEndpoint: "https://my-proxy.example.com/v1",
  },
};

describe("getModel — all 9 providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDesktopEnvMock.mockReturnValue(false);
  });

  it("returns a model instance for every ProviderKind", () => {
    const kinds = Object.keys(providerCategories) as ProviderKind[];

    // 単一情報源と完全一致（追加・削除の片側欠落を検出）
    expect([...kinds].sort()).toEqual([...Object.keys(COMPLETE_CONFIGS)].sort());
    expect(kinds).toHaveLength(9);

    for (const provider of kinds) {
      const model = getModel(COMPLETE_CONFIGS[provider]) as unknown as ModelLike;
      expect(model, provider).toBeTruthy();
      expect(typeof model.modelId, provider).toBe("string");
      expect(model.modelId.length, provider).toBeGreaterThan(0);
    }
  });

  it("passes customEndpoint through as baseURL for openai / anthropic / google", () => {
    const baseURL = "https://proxy.example.com/v1";

    getModel({ ...COMPLETE_CONFIGS.openai, customEndpoint: baseURL });
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL }),
    );

    getModel({ ...COMPLETE_CONFIGS.anthropic, customEndpoint: baseURL });
    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL }),
    );

    getModel({ ...COMPLETE_CONFIGS.google, customEndpoint: baseURL });
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL }),
    );
  });

  it("opts in to anthropic direct browser access via header", () => {
    getModel(COMPLETE_CONFIGS.anthropic);
    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      }),
    );
  });

  it("routes openai-compatible through the desktop sidecar (baseURL + token fetch)", () => {
    isDesktopEnvMock.mockReturnValue(true);

    const model = getModel(COMPLETE_CONFIGS["openai-compatible"]) as unknown as ModelLike;
    expect(model.modelId).toBe("my-model");

    const calls = vi.mocked(createOpenAICompatible).mock.calls;
    const opts = calls[calls.length - 1][0];
    expect(opts.baseURL).toBe(`${sidecarBase()}/v1`);
    expect(opts.fetch).toBe(sidecarFetchWithToken);
  });

  it("routes openai-compatible through the plain web fetch (custom endpoint, no token fetch)", () => {
    isDesktopEnvMock.mockReturnValue(false);

    getModel(COMPLETE_CONFIGS["openai-compatible"]);

    const calls = vi.mocked(createOpenAICompatible).mock.calls;
    const opts = calls[calls.length - 1][0];
    expect(opts.baseURL).toBe("https://my-proxy.example.com/v1");
    expect(opts.fetch).toBeUndefined();
  });
});

describe("getModel — error messages name the provider and the fix", () => {
  const CASES: Array<{
    name: string;
    config: ProviderConfig;
    fragment: string;
    pattern: RegExp;
  }> = [
    {
      name: "openai without API key",
      config: { provider: "openai", model: "gpt-4o" },
      fragment: "OpenAI",
      pattern: /API key/i,
    },
    {
      name: "anthropic without API key",
      config: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      fragment: "Anthropic",
      pattern: /API key/i,
    },
    {
      name: "google without API key",
      config: { provider: "google", model: "gemini-2.0-flash" },
      fragment: "Google AI",
      pattern: /API key/i,
    },
    {
      name: "aws-bedrock without API key",
      config: { provider: "aws-bedrock", model: "claude", region: "us-east-1" },
      fragment: "AWS Bedrock",
      pattern: /API key/i,
    },
    {
      name: "aws-bedrock without region",
      config: { provider: "aws-bedrock", model: "claude", apiKey: "key" },
      fragment: "AWS Bedrock",
      pattern: /region/i,
    },
    {
      name: "azure-foundry without API key",
      config: {
        provider: "azure-foundry",
        model: "gpt-4",
        customEndpoint: "https://my-resource.openai.azure.com",
      },
      fragment: "Azure Foundry",
      pattern: /API key/i,
    },
    {
      name: "azure-foundry without endpoint",
      config: { provider: "azure-foundry", model: "gpt-4", apiKey: "key" },
      fragment: "Azure Foundry",
      pattern: /endpoint/i,
    },
    {
      name: "gcp-vertexai without API key",
      config: { provider: "gcp-vertexai", model: "gemini-2.0-flash-001", region: "us-central1" },
      fragment: "Google Cloud (Vertex AI)",
      pattern: /API key/i,
    },
    {
      name: "gcp-vertexai without region",
      config: { provider: "gcp-vertexai", model: "gemini-2.0-flash-001", apiKey: "key" },
      fragment: "Google Cloud (Vertex AI)",
      pattern: /region/i,
    },
    {
      name: "ollama without model",
      config: { provider: "ollama", model: "" },
      fragment: "Ollama",
      pattern: /model/i,
    },
    {
      name: "lm-studio without model",
      config: { provider: "lm-studio", model: "" },
      fragment: "LM Studio",
      pattern: /model/i,
    },
    {
      name: "openai-compatible without endpoint",
      config: { provider: "openai-compatible", model: "my-model", apiKey: "key" },
      fragment: "OpenAI-compatible",
      pattern: /endpoint/i,
    },
    {
      name: "openai-compatible without API key",
      config: {
        provider: "openai-compatible",
        model: "my-model",
        customEndpoint: "https://example.com/v1",
      },
      fragment: "OpenAI-compatible",
      pattern: /API key/i,
    },
  ];

  it.each(CASES)(
    "$name → names the provider, states the problem and how to fix it",
    ({ config, fragment, pattern }) => {
      let message = "";
      try {
        getModel(config);
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain(fragment);
      expect(message).toMatch(pattern);
      // 対処のヒント（入力場所 or サポート済みプロバイダー一覧）
      expect(message).toMatch(/Please enter|Supported:/);
    },
  );

  it("unsupported provider names the given ID and lists what is supported", () => {
    let message = "";
    try {
      getModel({ provider: "unknown-provider", model: "foo", apiKey: "key" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"unknown-provider"');
    expect(message).toMatch(/Supported:/);
    expect(message).toContain("openai-compatible");
  });
});
