/**
 * Browser-native model discovery for all supported providers.
 *
 * Ported from sidecar/src/models-fetcher.ts — runs entirely in the browser
 * without a sidecar HTTP server.
 *
 * Sources:
 *  - models.dev/api.json   → cached catalog of 75+ providers (in-memory)
 *  - Ollama /api/tags       → local models running on the host
 *  - Custom /v1/models      → OpenAI-compatible endpoint
 */
import type { ModelInfo, ModelCost } from "@/types";

// ─── In-memory cache ───────────────────────────────────────────────────────────

let modelsDevCatalog: ModelsDevCatalog | null = null;
let modelsDevCachedAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── models.dev types ──────────────────────────────────────────────────────────

interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  limit: { context: number; output: number };
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
    [key: string]: unknown;
  };
  status?: string;
  modalities?: { input: string[]; output: string[] };
  open_weights?: boolean;
  release_date?: string;
}

interface ModelsDevProvider {
  name: string;
  models: Record<string, ModelsDevModel>;
}

type ModelsDevCatalog = Record<string, ModelsDevProvider>;

/** Map deskspawn provider IDs to models.dev keys */
const PROVIDER_TO_MODELSDEV: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "amazon-bedrock": "amazon-bedrock",
  "google-vertex": "google-vertex",
};

function convertModelsDevModel(raw: ModelsDevModel): ModelInfo {
  const inputModalities = raw.modalities?.input ?? [];
  const supportsImageInput = inputModalities.includes("image");

  return {
    id: raw.id,
    name: raw.name,
    supportsReasoning: raw.reasoning,
    supportsToolCall: raw.tool_call,
    supportsImageInput,
    contextLimit: raw.limit.context,
    maxOutput: raw.limit.output,
    cost: raw.cost
      ? {
          input: raw.cost.input,
          output: raw.cost.output,
          cacheRead: raw.cost.cache_read,
          cacheWrite: raw.cost.cache_write,
          reasoning: raw.cost.reasoning,
        }
      : undefined,
  };
}

/**
 * Look up pricing for a model ID from the cached models.dev catalog.
 * Searches all providers.  Returns undefined when the catalog hasn't
 * been fetched yet or the model ID isn't found.
 */
export function lookupModelCostById(modelId: string): ModelCost | undefined {
  if (!modelsDevCatalog) return undefined;
  for (const provider of Object.values(modelsDevCatalog)) {
    const raw = provider.models?.[modelId];
    if (raw?.cost) {
      return {
        input: raw.cost.input,
        output: raw.cost.output,
        cacheRead: raw.cost.cache_read,
        cacheWrite: raw.cost.cache_write,
        reasoning: raw.cost.reasoning,
      };
    }
  }
  return undefined;
}

async function fetchModelsDevCatalog(): Promise<ModelsDevCatalog> {
  // Return cached catalog if still fresh
  if (modelsDevCatalog && Date.now() - modelsDevCachedAt < CACHE_TTL_MS) {
    return modelsDevCatalog;
  }

  const res = await fetch("https://models.dev/api.json");
  if (!res.ok) throw new Error(`models.dev fetch failed: ${res.status}`);
  const data = (await res.json()) as ModelsDevCatalog;
  modelsDevCatalog = data;
  modelsDevCachedAt = Date.now();
  return data;
}

async function fetchModelsFromModelsDev(provider: string): Promise<ModelInfo[]> {
  const catalog = await fetchModelsDevCatalog();
  const providerData = catalog[provider];
  if (!providerData?.models) return [];

  return Object.values(providerData.models)
    .filter((m) => m.status !== "deprecated")
    .filter((m) => {
      // Exclude embedding and non-text-generation models
      const family = (m.family ?? "").toLowerCase();
      const name = (m.name ?? "").toLowerCase();
      const id = (m.id ?? "").toLowerCase();
      if (family.includes("embed")) return false;
      if (name.includes("embed")) return false;
      if (id.includes("embed")) return false;
      if (family.includes("moderation")) return false;
      if (family.includes("tts")) return false;
      if (family.includes("whisper")) return false;
      if (family.includes("dall")) return false;
      if (family.includes("audio")) return false;
      return true;
    })
    .filter((m) => {
      // Exclude models that can't generate text: zero context or zero output
      if (m.limit.context <= 0) return false;
      if (m.limit.output <= 0) return false;
      return true;
    })
    .filter((m) => {
      // Exclude image-only generation models (e.g. DALL-E, Imagen)
      const outputModalities = m.modalities?.output ?? [];
      if (outputModalities.length > 0 && outputModalities.every((mod) => mod !== "text")) {
        return false;
      }
      return true;
    })
    .map(convertModelsDevModel)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Ollama ────────────────────────────────────────────────────────────────────

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

async function fetchOllamaModels(endpoint: string): Promise<ModelInfo[]> {
  const base = endpoint || "http://localhost:11434";
  const url = `${base.replace(/\/+$/, "")}/api/tags`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`);
  const data = (await res.json()) as OllamaTagsResponse;
  return (data.models ?? []).map((m) => ({
    id: m.name,
    name: m.name,
    supportsReasoning: false,
    supportsToolCall: true,
    supportsImageInput: false,
    contextLimit: 8192,
    maxOutput: 4096,
  }));
}

// ─── Custom (OpenAI-compatible) ─────────────────────────────────────────────────

interface CustomModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

interface CustomModelsResponse {
  data: CustomModel[];
}

async function fetchCustomModels(
  endpoint: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  const base = endpoint.replace(/\/+$/, "");
  const url = `${base}/models`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Custom /models fetch failed: ${res.status}`);
  const data = (await res.json()) as CustomModelsResponse;
  return (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.id,
    supportsReasoning: false,
    supportsToolCall: true,
    supportsImageInput: false,
    contextLimit: 8192,
    maxOutput: 4096,
  }));
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fetch available models for a given provider.
 * Runs entirely in the browser — no sidecar server needed.
 *
 * @param provider   - deskspawn provider ID
 * @param endpoint   - optional custom endpoint (used for ollama / custom)
 * @param apiKey     - optional API key (used for custom provider auth)
 */
export async function getModelsForProvider(
  provider: string,
  endpoint?: string,
  apiKey?: string,
): Promise<ModelInfo[]> {
  switch (provider) {
    case "openai":
    case "anthropic":
    case "google":
    case "amazon-bedrock":
    case "google-vertex": {
      const key = PROVIDER_TO_MODELSDEV[provider];
      return fetchModelsFromModelsDev(key);
    }
    // Azure OpenAI にはモデル一覧 API がなく、ユーザーがデプロイしたモデル名を
    // 直接入力する必要があるため、空リストを返して UI で自由入力させる
    case "azure-openai":
      return [];
    case "ollama":
      return fetchOllamaModels(endpoint ?? "http://localhost:11434");
    case "custom": {
      if (!endpoint) throw new Error("customEndpoint is required for custom provider");
      return fetchCustomModels(endpoint, apiKey ?? "");
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
