import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  it("returns empty array for azure-openai provider", async () => {
    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("azure-openai");

    expect(models).toEqual([]);
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

  it("returns models for custom provider with endpoint and apiKey", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(CUSTOM_RESPONSE));

    const { getModelsForProvider } = await getModule();
    const models = await getModelsForProvider("custom", "https://my-api.example.com/v1", "sk-test");

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

  it("calls custom provider without apiKey when not provided", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(CUSTOM_RESPONSE));

    const { getModelsForProvider } = await getModule();
    await getModelsForProvider("custom", "https://my-api.example.com/v1");

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

  it("throws when custom provider has no endpoint", async () => {
    const { getModelsForProvider } = await getModule();

    await expect(getModelsForProvider("custom")).rejects.toThrow(
      "customEndpoint is required for custom provider",
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

    // Model from amazon-bedrock provider
    const cost = lookupModelCostById("claude-sonnet-4");
    expect(cost).toBeDefined();
    expect(cost!.input).toBe(3);
    expect(cost!.output).toBe(15);
  });
});
