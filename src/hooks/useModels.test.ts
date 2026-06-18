// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────────────────

vi.mock("@/lib/models-fetcher", () => ({
  getModelsForProvider: vi.fn(),
}));

vi.mock("@/lib/cost", () => ({
  setModelCostCache: vi.fn(),
  clearModelCostCache: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  default: {
    t: vi.fn((key: string) => key),
  },
}));

// ── Imports (after vi.mock) ──────────────────────────────────────────────────────

import { useModels } from "./useModels";
import { getModelsForProvider } from "@/lib/models-fetcher";
import { setModelCostCache, clearModelCostCache } from "@/lib/cost";

// ── Helpers ──────────────────────────────────────────────────────────────────────

const mockModels = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    supportsReasoning: false,
    supportsToolCall: true,
    supportsImageInput: true,
    contextLimit: 128000,
    maxOutput: 16384,
    cost: { input: 2.5, output: 10 },
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    supportsReasoning: false,
    supportsToolCall: true,
    supportsImageInput: false,
    contextLimit: 128000,
    maxOutput: 16384,
    cost: { input: 0.15, output: 0.6 },
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────────

describe("useModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial state with empty models, no error, loading=false", () => {
    const { result } = renderHook(() => useModels({ provider: "openai" }));

    expect(result.current.models).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
    expect(typeof result.current.fetchModels).toBe("function");
  });

  it("fetches models and returns them on success", async () => {
    vi.mocked(getModelsForProvider).mockResolvedValue(mockModels);

    const { result } = renderHook(() => useModels({ provider: "openai" }));

    await act(async () => {
      await result.current.fetchModels();
    });

    expect(getModelsForProvider).toHaveBeenCalledWith(
      "openai",
      undefined,
      undefined,
    );
    expect(result.current.models).toEqual(mockModels);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("passes customEndpoint and apiKey through to getModelsForProvider", async () => {
    vi.mocked(getModelsForProvider).mockResolvedValue(mockModels);

    const { result } = renderHook(() =>
      useModels({
        provider: "custom",
        customEndpoint: "https://api.example.com/v1",
        apiKey: "sk-test",
      }),
    );

    await act(async () => {
      await result.current.fetchModels();
    });

    expect(getModelsForProvider).toHaveBeenCalledWith(
      "custom",
      "https://api.example.com/v1",
      "sk-test",
    );
  });

  it("sets error state when getModelsForProvider rejects", async () => {
    const errorMsg = "Failed to fetch models";
    vi.mocked(getModelsForProvider).mockRejectedValue(new Error(errorMsg));

    const { result } = renderHook(() => useModels({ provider: "openai" }));

    await act(async () => {
      await result.current.fetchModels();
    });

    expect(result.current.models).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(errorMsg);
  });

  it("uses i18n fallback when error has no message", async () => {
    vi.mocked(getModelsForProvider).mockRejectedValue(null);

    const { result } = renderHook(() => useModels({ provider: "openai" }));

    await act(async () => {
      await result.current.fetchModels();
    });

    expect(result.current.error).toBe("ai.error.modelsFetchFailed");
  });

  it("updates cost cache after successful fetch", async () => {
    vi.mocked(getModelsForProvider).mockResolvedValue(mockModels);

    const { result } = renderHook(() => useModels({ provider: "openai" }));

    await act(async () => {
      await result.current.fetchModels();
    });

    expect(clearModelCostCache).toHaveBeenCalledOnce();
    expect(setModelCostCache).toHaveBeenCalledWith(mockModels);
  });

  it("clears models on new fetch call", async () => {
    vi.mocked(getModelsForProvider).mockResolvedValue(mockModels);

    const { result } = renderHook(() => useModels({ provider: "openai" }));

    // Pre-populate with some fake models to verify they are cleared
    await act(async () => {
      await result.current.fetchModels();
    });
    expect(result.current.models).toEqual(mockModels);

    // Second fetch
    const newModels = [mockModels[0]];
    vi.mocked(getModelsForProvider).mockResolvedValue(newModels);

    await act(async () => {
      await result.current.fetchModels();
    });

    // Should be replaced, not appended
    expect(result.current.models).toEqual(newModels);
  });

  it("does not call getModelsForProvider unless fetchModels is called", () => {
    renderHook(() => useModels({ provider: "openai" }));
    expect(getModelsForProvider).not.toHaveBeenCalled();
  });
});
