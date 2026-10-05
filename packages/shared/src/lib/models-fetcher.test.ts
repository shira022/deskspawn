import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { providerCategories } from "./constants";
import type { ProviderKind } from "../types";

/** models.dev カタログから一覧を取るプロバイダー（実装の switch と対応）。 */
const MODELS_DEV_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "aws-bedrock",
  "gcp-vertexai",
] as const;

// ─── Sample catalog data matching models.dev schema ──────────────────────────

const SAMPLE_CATALOG = {
  openai: {
    name: "OpenAI",
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 16384 },
        cost: { input: 2.5, output: 10 },
        status: "available",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 16384 },
        cost: { input: 0.15, output: 0.6 },
        status: "available",
        modalities: { input: ["text"], output: ["text"] },
      },
      "text-embedding-3-small": {
        id: "text-embedding-3-small",
        name: "Text Embedding 3 Small",
        reasoning: false,
        temperature: false,
        tool_call: false,
        limit: { context: 8191, output: 1 },
        status: "available",
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
  anthropic: {
    name: "Anthropic",
    models: {
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15 },
        status: "available",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
      "claude-3-5-haiku-latest": {
        id: "claude-3-5-haiku-latest",
        name: "Claude 3.5 Haiku",
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 200000, output: 8192 },
        cost: { input: 0.8, output: 4 },
        status: "available",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
  google: {
    name: "Google",
    models: {
      "gemini-2.5-pro": {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: { context: 1048576, output: 65536 },
        cost: { input: 1.25, output: 10 },
        status: "available",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
  "amazon-bedrock": {
    name: "AWS Bedrock",
    models: {
      "claude-sonnet-4": {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 200000, output: 8192 },
        cost: { input: 3, output: 15 },
        status: "available",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
  "google-vertex": {
    name: "Google Cloud Vertex AI",
    models: {
      "gemini-2.0-flash": {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 1048576, output: 8192 },
        cost: { input: 0.1, output: 0.4 },
        status: "available",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
};

const OLLAMA_RESPONSE = {
  models: [
    { name: "llama3:latest", modified_at: "2024-06-01T00:00:00Z", size: 4700000000 },
    { name: "mistral:latest", modified_at: "2024-06-01T00:00:00Z", size: 4100000000 },
  ],
};

const CUSTOM_RESPONSE = {
  data: [
    { id: "my-custom-model", object: "model", created: 1717200000, owned_by: "me" },
    { id: "another-model", object: "model" },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createJsonResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  };
}

describe("getModelsForProvider", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getModule() {
    vi.resetModules();
    return import("./models-fetcher");
  }

  it("returns models for openai provider via models.dev catalog", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("openai");

    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === "gpt-4o")).toBe(true);
    expect(models.some((m) => m.id === "gpt-4o-mini")).toBe(true);
    // Embedding models should be filtered out
    expect(models.some((m) => m.id === "text-embedding-3-small")).toBe(false);
    // Each model should have the correct shape
    const gpt4o = models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.name).toBe("GPT-4o");
    expect(gpt4o.supportsToolCall).toBe(true);
    expect(gpt4o.supportsImageInput).toBe(true);
    expect(gpt4o.contextLimit).toBe(128000);
    expect(gpt4o.cost).toBeDefined();
    expect(gpt4o.cost!.input).toBe(2.5);
    expect(gpt4o.cost!.output).toBe(10);
  });

  it("returns empty array for azure-foundry provider", async () => {
    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("azure-foundry");

    expect(models).toEqual([]);
  });

  it("maps aws-bedrock to the amazon-bedrock models.dev catalog key", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("aws-bedrock");

    expect(models.some((m) => m.id === "claude-sonnet-4")).toBe(true);
  });

  it("maps gcp-vertexai to the google-vertex models.dev catalog key", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("gcp-vertexai");

    expect(models.some((m) => m.id === "gemini-2.0-flash")).toBe(true);
  });

  it("returns models for ollama provider with given endpoint", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(OLLAMA_RESPONSE));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("ollama", "http://my-ollama:11434");

    expect(models.length).toBe(2);
    expect(models[0].id).toBe("llama3:latest");
    expect(models[1].id).toBe("mistral:latest");
    expect(models[0].supportsToolCall).toBe(true);
    expect(models[0].cost).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith("http://my-ollama:11434/api/tags");
  });

  it("uses default ollama endpoint when none provided", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(OLLAMA_RESPONSE));

    const { getModelsForProvider } = await getModule();
    await getModelsForProvider("ollama");

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/api/tags");
  });

  it("returns models for openai-compatible provider with endpoint and apiKey", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(CUSTOM_RESPONSE));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("openai-compatible", "https://my-api.example.com/v1", "sk-test");

    expect(models.length).toBe(2);
    expect(models[0].id).toBe("my-custom-model");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-api.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          Accept: "application/json",
        }),
      }),
    );
  });

  it("calls openai-compatible provider without apiKey when not provided", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(CUSTOM_RESPONSE));

    const { getModelsForProvider } = await getModule();
    await getModelsForProvider("openai-compatible", "https://my-api.example.com/v1");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-api.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      }),
    );
    // Should not have Authorization header
    const callArgs = mockFetch.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs.headers).not.toHaveProperty("Authorization");
  });

  it("throws when openai-compatible provider has no endpoint", async () => {
    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("openai-compatible")).rejects.toThrow(
      "customEndpoint is required for openai-compatible provider",
    );
  });

  it("returns models for lm-studio provider via the local /v1/models endpoint", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(CUSTOM_RESPONSE));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("lm-studio");

    expect(models.length).toBe(2);
    expect(models[0].id).toBe("my-custom-model");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:1234/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
  });

  it("uses the custom endpoint for lm-studio when provided", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(CUSTOM_RESPONSE));

    const { getModelsForProvider } = await getModule();
    await getModelsForProvider("lm-studio", "http://192.168.1.50:1234/v1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://192.168.1.50:1234/v1/models",
      expect.anything(),
    );
  });

  it("throws for unknown provider", async () => {
    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("unknown")).rejects.toThrow(
      "Unknown provider: unknown",
    );
  });

  it("caches the models.dev catalog across calls", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider } = await getModule();

    // First call — should fetch
    const models1 = await getModelsForProvider("openai");
    expect(models1.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call — should use cache, no fetch
    const models2 = await getModelsForProvider("openai");
    expect(models2.length).toBeGreaterThan(0);
    // Still only 1 fetch call
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── Full provider coverage ────────────────────────────────────────────────

  const ALL_PROVIDERS = Object.keys(providerCategories) as ProviderKind[];

  /** URL ごとに応答を切り替える（models.dev / ollama / OpenAI互換）。 */
  function routeFetch(url: unknown): Promise<unknown> {
    const u = String(url);
    if (u.includes("models.dev")) {
      return Promise.resolve(createJsonResponse(SAMPLE_CATALOG));
    }
    if (u.endsWith("/api/tags")) {
      return Promise.resolve(createJsonResponse(OLLAMA_RESPONSE));
    }
    return Promise.resolve(createJsonResponse(CUSTOM_RESPONSE));
  }

  it("returns an array for every supported provider (never 'Unknown provider')", async () => {
    expect(ALL_PROVIDERS).toHaveLength(9);

    for (const provider of ALL_PROVIDERS) {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: unknown) => routeFetch(url));

      const { getModelsForProvider } = await getModule();
      const models = await getModelsForProvider(
        provider,
        provider === "openai-compatible" ? "https://example.com/v1" : undefined,
        "sk-test",
      );

      expect(Array.isArray(models), provider).toBe(true);
      if (provider === "azure-foundry") {
        // Azure Foundry にはモデル一覧 API がなく、UI は手動入力に切り替える
        expect(models, provider).toEqual([]);
      } else {
        expect(models.length, provider).toBeGreaterThan(0);
      }
    }
  });

  it("returns models for anthropic via the models.dev catalog", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("anthropic");

    expect(models.some((m) => m.id === "claude-sonnet-4-5")).toBe(true);
    expect(models.some((m) => m.id === "claude-3-5-haiku-latest")).toBe(true);
    expect(models.every((m) => m.contextLimit > 0)).toBe(true);
  });

  it("returns models for google via the models.dev catalog", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("google");

    expect(models.some((m) => m.id === "gemini-2.5-pro")).toBe(true);
    expect(models[0].cost?.input).toBe(1.25);
    expect(models[0].cost?.output).toBe(10);
  });

  it.each(MODELS_DEV_PROVIDERS)(
    "carries models.dev pricing for %s",
    async (provider) => {
      mockFetch.mockResolvedValue(createJsonResponse(SAMPLE_CATALOG));

      const { getModelsForProvider } = await getModule();
      const models = await getModelsForProvider(provider);

      expect(models.length, provider).toBeGreaterThan(0);
      for (const m of models) {
        expect(m.cost, `${provider}/${m.id}`).toBeDefined();
        expect(m.cost?.input, `${provider}/${m.id}`).toBeGreaterThan(0);
        expect(m.cost?.output, `${provider}/${m.id}`).toBeGreaterThan(0);
      }
    },
  );

  // ── Failure paths ─────────────────────────────────────────────────────────

  it("rejects when models.dev responds with a non-OK status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("openai")).rejects.toThrow(
      "models.dev fetch failed: 500",
    );
  });

  it("propagates a network error from models.dev", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("anthropic")).rejects.toThrow("network down");
  });

  it("propagates an abort from models.dev", async () => {
    const abortError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    mockFetch.mockRejectedValueOnce(abortError);

    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("google")).rejects.toThrow(
      "The operation was aborted",
    );
  });

  it("rejects when Ollama /api/tags is not OK", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("ollama")).rejects.toThrow(
      "Ollama /api/tags failed: 503",
    );
  });

  it("rejects when the openai-compatible /models endpoint is not OK", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { getModelsForProvider } = await getModule();

    await expect(
      getModelsForProvider("openai-compatible", "https://broken.example.com/v1"),
    ).rejects.toThrow("Custom /models fetch failed: 500");
  });

  it("rejects when the lm-studio /models endpoint is not OK", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });

    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("lm-studio")).rejects.toThrow(
      "Custom /models fetch failed: 502",
    );
  });
});

describe("lookupModelCostById", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getModule() {
    vi.resetModules();
    return import("./models-fetcher");
  }

  it("returns cost info for a known model after catalog is loaded", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider, lookupModelCostById } = await getModule();

    // Load the catalog
    await getModelsForProvider("openai");

    const cost = lookupModelCostById("gpt-4o");
    expect(cost).toBeDefined();
    expect(cost!.input).toBe(2.5);
    expect(cost!.output).toBe(10);
    expect(cost!.cacheRead).toBeUndefined();
    expect(cost!.cacheWrite).toBeUndefined();
  });

  it("returns undefined for an unknown model ID", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider, lookupModelCostById } = await getModule();

    await getModelsForProvider("openai");

    const cost = lookupModelCostById("nonexistent-model");
    expect(cost).toBeUndefined();
  });

  it("returns undefined when catalog has not been loaded yet", async () => {
    const { lookupModelCostById } = await getModule();

    const cost = lookupModelCostById("gpt-4o");
    expect(cost).toBeUndefined();
  });

  it("finds model cost across different providers", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(SAMPLE_CATALOG));

    const { getModelsForProvider, lookupModelCostById } = await getModule();

    await getModelsForProvider("openai");

    // Model from the aws-bedrock (models.dev key: amazon-bedrock) catalog
    const cost = lookupModelCostById("claude-sonnet-4");
    expect(cost).toBeDefined();
    expect(cost!.input).toBe(3);
    expect(cost!.output).toBe(15);
  });
});
