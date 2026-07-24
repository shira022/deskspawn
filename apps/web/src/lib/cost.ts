/**
 * Cost calculation using real model pricing from models.dev.
 *
 * Architecture:
 *   models.dev API  →  models-fetcher catalog (in-memory cache, 24h TTL)
 *       ↓                          ↓
 *   setModelCostCache()    lookupModelCostById()  [fallback]
 *       ↓                          ↓
 *   modelCostCache (Map)  ←  calculateCost(usage)
 *
 * The primary source is the in-memory `modelCostCache` populated on each
 * model list fetch.  When a model isn't found there, we fall back to the
 * models.dev catalog cached inside models-fetcher — the exact same data
 * shown in the UI's model selector.  No hardcoded pricing.
 */

import type { ModelInfo, ModelCost } from "@/types";
import { lookupModelCostById } from "./models-fetcher";

// ─── Singleton cache ──────────────────────────────────────────────────────────

/** Model ID → pricing data (from models.dev). Populated on model fetch. */
const modelCostCache = new Map<string, ModelCost>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Populate the cost cache from a batch of ModelInfo (called after fetching
 * the model list).  Only entries that have `cost` data are stored.
 */
export function setModelCostCache(models: ModelInfo[]): void {
  for (const m of models) {
    if (m.cost) {
      modelCostCache.set(m.id, m.cost);
    }
  }
}

/**
 * Populate a single model cost entry (useful for side-channel lookups).
 */
export function setModelCost(modelId: string, cost: ModelCost): void {
  modelCostCache.set(modelId, cost);
}

/** Clear the cache (e.g. on provider change). */
export function clearModelCostCache(): void {
  modelCostCache.clear();
}

// ─── Calculation ──────────────────────────────────────────────────────────────

export interface CostCalcInput {
  inputTokens: number;
  outputTokens: number;

  /**
   * Reasoning/thinking tokens — billed at `cost.reasoning` rate if
   * the model has one, otherwise falls back to `cost.output`.
   */
  reasoningTokens?: number;

  /**
   * Input tokens that were served from the provider's cache — billed
   * at `cost.cacheRead` rate if available, otherwise `cost.input`.
   */
  cachedInputTokens?: number;

  /**
   * Input tokens used to create a new cache entry — billed at
   * `cost.cacheWrite` rate if available, otherwise `cost.input`.
   */
  cacheCreationTokens?: number;

  /**
   * The model ID (e.g. "gpt-4o", "claude-sonnet-4-20250514").
   * Used to look up pricing from the cache.  If omitted or not found
   * in cache the cost is $0.
   */
  model?: string;
}

/**
 * Calculate estimated cost using model-specific pricing from models.dev.
 *
 * Rates are $ per 1M tokens.  If a model has a dedicated rate variant
 * (cacheRead, reasoning, …) it is used; otherwise the standard
 * input/output rate applies.
 *
 * Returns $0 for models without known pricing (ollama, custom, or
 * very new models not yet in models.dev).
 */
export function calculateCost(usage: CostCalcInput): number {
  let cost = usage.model ? modelCostCache.get(usage.model) : undefined;
  // Fall back to the models.dev catalog (same source as the UI model selector)
  if (!cost && usage.model) {
    cost = lookupModelCostById(usage.model) ?? lookupModelCostById(usage.model.toLowerCase());
    if (cost) modelCostCache.set(usage.model, cost); // warm the fast cache
  }
  if (!cost) return 0;

  // Standard tokens
  let total =
    (usage.inputTokens / 1_000_000) * cost.input +
    (usage.outputTokens / 1_000_000) * cost.output;

  // Reasoning tokens (e.g. o-series, Claude with thinking enabled)
  if (usage.reasoningTokens && usage.reasoningTokens > 0) {
    const reasoningRate = cost.reasoning ?? cost.output;
    total += (usage.reasoningTokens / 1_000_000) * reasoningRate;
  }

  // Cached input tokens (Anthropic-style prompt caching)
  if (usage.cachedInputTokens && usage.cachedInputTokens > 0) {
    const cachedRate = cost.cacheRead ?? cost.input;
    total += (usage.cachedInputTokens / 1_000_000) * cachedRate;
  }

  // Cache creation tokens (Anthropic cache_write)
  if (usage.cacheCreationTokens && usage.cacheCreationTokens > 0) {
    const creationRate = cost.cacheWrite ?? cost.input;
    total += (usage.cacheCreationTokens / 1_000_000) * creationRate;
  }

  return total;
}
