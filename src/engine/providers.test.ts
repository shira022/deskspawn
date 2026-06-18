import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all AI SDK provider packages ──────────────────────────────────────────
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn((modelId: string) => ({ provider: "openai", modelId })),
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
    vi.fn((modelId: string) => ({ provider: "amazon-bedrock", modelId })),
  ),
}));

vi.mock("@ai-sdk/azure", () => ({
  createAzure: vi.fn(() =>
    vi.fn((modelId: string) => ({ provider: "azure", modelId })),
  ),
}));

vi.mock("@ai-sdk/google-vertex/edge", () => ({
  createVertex: vi.fn(() =>
    vi.fn((modelId: string) => ({ provider: "google-vertex", modelId })),
  ),
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

import type { ProviderConfig } from "./types";

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

  it('creates an OpenAI-compatible model for custom provider', () => {
    const config: ProviderConfig = {
      provider: "custom",
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
      name: "custom-provider",
      baseURL: "https://my-proxy.example.com/v1",
      apiKey: "custom-key",
    });
  });

  it('creates an amazon-bedrock model with region', () => {
    const config: ProviderConfig = {
      provider: "amazon-bedrock",
      model: "anthropic.claude-sonnet-4-20250514",
      apiKey: "aws-key",
      region: "us-east-1",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "amazon-bedrock",
      modelId: "anthropic.claude-sonnet-4-20250514",
    });
    expect(createAmazonBedrock).toHaveBeenCalledWith({
      apiKey: "aws-key",
      region: "us-east-1",
    });
  });

  it('creates an azure-openai model with resource name', () => {
    const config: ProviderConfig = {
      provider: "azure-openai",
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

  it('creates a google-vertex model with region', () => {
    const config: ProviderConfig = {
      provider: "google-vertex",
      model: "gemini-2.0-flash-001",
      apiKey: "vertex-key",
    };
    const model = getModel(config) as any;
    expect(model).toEqual({
      provider: "google-vertex",
      modelId: "gemini-2.0-flash-001",
    });
    expect(createVertex).toHaveBeenCalledWith({ apiKey: "vertex-key" });
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

  it("throws when customEndpoint is missing for custom provider", () => {
    const config: ProviderConfig = {
      provider: "custom",
      model: "my-model",
      apiKey: "key",
    };
    expect(() => getModel(config)).toThrow(/endpoint/i);
  });

  it("throws when API key is missing for custom provider", () => {
    const config: ProviderConfig = {
      provider: "custom",
      model: "my-model",
      customEndpoint: "https://example.com/v1",
    };
    expect(() => getModel(config)).toThrow(/API key/i);
  });

  it("throws when region is missing for amazon-bedrock", () => {
    const config: ProviderConfig = {
      provider: "amazon-bedrock",
      model: "claude",
      apiKey: "key",
    };
    expect(() => getModel(config)).toThrow(/region/i);
  });

  it("throws when customEndpoint is missing for azure-openai", () => {
    const config: ProviderConfig = {
      provider: "azure-openai",
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
