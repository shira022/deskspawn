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

import type { ModelInfo, ModelCost, TokenUsage } from "../types";
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

// ─── Pricing resolution ───────────────────────────────────────────────────────

/**
 * Resolve pricing for a model from the in-memory cache, falling back to the
 * models.dev catalog (same source as the UI model selector).  Shared by
 * `calculateCost` and `normalizeStoredCost` so both use identical logic.
 */
function resolveModelCost(model: string): ModelCost | undefined {
  let cost = modelCostCache.get(model);
  if (!cost) {
    cost = lookupModelCostById(model) ?? lookupModelCostById(model.toLowerCase());
    if (cost) modelCostCache.set(model, cost); // warm the fast cache
  }
  return cost;
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
   * in cache the cost is unknown (`undefined`).
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
 * Returns `undefined` when the model's pricing is unknown (ollama,
 * custom, or very new models not yet in models.dev); `0` only when
 * pricing is known and the total is zero.
 */
export function calculateCost(usage: CostCalcInput): number | undefined {
  const cost = usage.model ? resolveModelCost(usage.model) : undefined;
  if (!cost) return undefined;
  return computeCost(usage, cost);
}

/** Apply model pricing to token counts (rates are $ per 1M tokens). */
function computeCost(usage: CostCalcInput, cost: ModelCost): number {
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

/**
 * Re-interpret a persisted `estimatedCost` under the current contract.
 *
 * Older versions stored `0` whenever pricing was unavailable, which makes
 * unknown costs indistinguishable from a real `$0`.  This recalculates a
 * stored `0` from the token counts when the model's pricing is now known:
 *
 * - `estimatedCost` is a non-zero number: returned unchanged.
 * - `estimatedCost` is `0` or not a number (`undefined`/`null`) with
 *   resolvable pricing: recalculated value (a genuine known-zero stays `0`).
 * - `estimatedCost` is `0` or not a number with no model / unknown pricing:
 *   `undefined` (i.e. "unknown") — never coerced to a number.
 *
 * Values are corrected on read; subsequent saves persist the corrected value.
 */
export function normalizeStoredCost(
  usage: TokenUsage | undefined,
  resolve: (model: string) => ModelCost | undefined = resolveModelCost,
): number | undefined {
  if (!usage) return undefined;
  if (typeof usage.estimatedCost === "number" && usage.estimatedCost !== 0) {
    return usage.estimatedCost;
  }
  if (!usage.model) return undefined;
  const cost = resolve(usage.model);
  if (!cost) return undefined;
  return computeCost(usage, cost);
}
