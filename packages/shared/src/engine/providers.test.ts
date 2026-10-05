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
