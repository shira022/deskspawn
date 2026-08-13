import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all dependencies ──────────────────────────────────────────────────────

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("./step-limits", () => ({
  StepManager: vi.fn().mockImplementation(function () {
    return {
      recordStep: vi.fn(),
      getProgress: vi.fn(() => ({ step: 1, maxSteps: 5 })),
      shouldStop: vi.fn(() => false),
      canAutoContinue: vi.fn(() => false),
      prepareForContinuation: vi.fn(),
      getFinalState: vi.fn(() => ({
        step: 1,
        maxSteps: 5,
        hitLimit: false,
        stoppedReason: "normal_completion" as const,
        continuationRound: 0,
        maxContinuations: 0,
      })),
      getSuggestion: vi.fn(() => ""),
      stepCount: 0,
      continuationCount: 0,
      maxContinuations: 0,
    };
  }),
}));

vi.mock("./retry", () => ({
  withRateLimitRetry: vi.fn(async (fn: () => unknown) => fn()),
}));

vi.mock("./system-prompts/planner", () => ({
  plannerPrompt: vi.fn(() => "planner system prompt"),
}));

vi.mock("./system-prompts/coder", () => ({
  coderPrompt: vi.fn(() => "coder system prompt"),
}));

vi.mock("./system-prompts/verifier", () => ({
  verifierPrompt: vi.fn(() => "verifier system prompt"),
}));

vi.mock("./system-prompts/visual-qa", () => ({
  visualQAPrompt: vi.fn(() => "visual-qa system prompt"),
}));

// ── Imports (after vi.mock) ────────────────────────────────────────────────────

import {
  getPhaseLabel,
  runWithTriage,
  runPipeline,
  runPhase,
  type PipelineHooks,
} from "./orchestrator";

import { generateText } from "ai";

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockModel = {} as any;
const buildTools = vi.fn(() => ({}));
const controller = new AbortController();

function makeMessages(text: string): Array<Record<string, unknown>> {
  return [{ role: "user", content: text }];
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("getPhaseLabel", () => {
  it('returns "Planning & Design" for planner', () => {
    expect(getPhaseLabel("planner")).toBe("Planning & Design");
  });

  it('returns "Code Generation" for coder', () => {
    expect(getPhaseLabel("coder")).toBe("Code Generation");
  });

  it('returns "Error Check & Fix" for verifier', () => {
    expect(getPhaseLabel("verifier")).toBe("Error Check & Fix");
  });

  it('returns "Visual Review" for visual_qa', () => {
    expect(getPhaseLabel("visual_qa")).toBe("Visual Review");
  });
});

describe("runWithTriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches to coder only in single mode", async () => {
    // Triage returns single
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "mode: single\nSimple CSS fix",
    } as any);
    // Coder phase (second call to generateText)
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Changed button color",
      usage: { inputTokens: 20, outputTokens: 10 },
    } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Change button to red"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["coder"]);
    expect(result.text).toBe("Changed button color");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("dispatches to full pipeline in multi mode", async () => {
    // Triage returns multi
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "mode: multi\nFull feature needed" } as any)
      // planner
      .mockResolvedValueOnce({
        text: "Planned the feature",
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)
      // coder
      .mockResolvedValueOnce({
        text: "Implemented the feature",
        usage: { inputTokens: 30, outputTokens: 15 },
      } as any)
      // verifier
      .mockResolvedValueOnce({
        text: "No errors found",
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)
      // visual_qa
      .mockResolvedValueOnce({
        text: "✅ PASS",
        usage: { inputTokens: 8, outputTokens: 4 },
      } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build me a full app"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
    expect(generateText).toHaveBeenCalledTimes(5); // triage + 4 phases
  });

  it("calls onTriageResult hook with the triage result", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "mode: single\nTiny tweak" } as any)
      .mockResolvedValueOnce({
        text: "done",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any);

    const onTriageResult = vi.fn();

    await runWithTriage(
      mockModel,
      makeMessages("Tweak padding"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      { onTriageResult },
    );

    expect(onTriageResult).toHaveBeenCalledWith({
      mode: "single",
      reason: expect.stringContaining("Tiny"),
    });
  });
});

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs phases in order: planner, coder, verifier, visual_qa", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "Plan result",
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)
      .mockResolvedValueOnce({
        text: "Coder result",
        usage: { inputTokens: 20, outputTokens: 15 },
      } as any)
      .mockResolvedValueOnce({
        text: "Verifier result",
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)
      .mockResolvedValueOnce({
        text: "✅ PASS - looks good",
        usage: { inputTokens: 8, outputTokens: 4 },
      } as any);

    const result = await runPipeline(
      mockModel,
      makeMessages("Build feature"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
    expect(result.text).toContain("Coder result");
    expect(result.text).toContain("✅ PASS");
    expect(result.text).not.toContain("Plan result");
    expect(result.usage).toEqual({ inputTokens: 43, outputTokens: 27 });
  });

  it("extracts plan from planner phase and passes context to coder/verifier", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: 'Some plan\n```plan\n{"tasks": [{"type": "file", "filePath": "src/test.ts"}], "summary": "Add feature"}\n```',
        usage: { inputTokens: 5, outputTokens: 2 },
      } as any)
      .mockResolvedValueOnce({
        text: "Coder output",
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)
      .mockResolvedValueOnce({
        text: "Verifier output",
        usage: { inputTokens: 3, outputTokens: 2 },
      } as any)
      .mockResolvedValueOnce({
        text: "✅ PASS",
        usage: { inputTokens: 2, outputTokens: 1 },
      } as any);

    const result = await runPipeline(
      mockModel,
      makeMessages("Add feature"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
  });

  it("calls hook callbacks during pipeline execution", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "Plan",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any)
      .mockResolvedValueOnce({
        text: "Code",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any)
      .mockResolvedValueOnce({
        text: "Verify",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any)
      .mockResolvedValueOnce({
        text: "✅ PASS",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any);

    const onPhaseStart = vi.fn();
    const onPhaseEnd = vi.fn();
    const onPhaseDetail = vi.fn();

    const hooks: PipelineHooks = { onPhaseStart, onPhaseEnd, onPhaseDetail };

    await runPipeline(
      mockModel,
      makeMessages("Test"),
      buildTools,
      controller.signal,
      hooks,
    );

    expect(onPhaseStart).toHaveBeenCalledTimes(4);
    expect(onPhaseStart).toHaveBeenNthCalledWith(1, "planner");
    expect(onPhaseStart).toHaveBeenNthCalledWith(2, "coder");
    expect(onPhaseStart).toHaveBeenNthCalledWith(3, "verifier");
    expect(onPhaseStart).toHaveBeenNthCalledWith(4, "visual_qa");

    expect(onPhaseEnd).toHaveBeenCalledTimes(4);
    expect(onPhaseDetail).toHaveBeenCalledTimes(4);
  });
});

describe("runPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a PhaseRunResult with correct structure", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Phase output",
      usage: { inputTokens: 15, outputTokens: 10 },
    } as any);

    const result = await runPhase(
      mockModel,
      "coder",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );

    expect(result).toHaveProperty("text", "Phase output");
    expect(result).toHaveProperty("usage");
    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 10 });
    expect(result).toHaveProperty("stepCount");
    expect(result).toHaveProperty("hitLimit", false);
    expect(result).toHaveProperty("stoppedReason", "normal_completion");
    expect(result).toHaveProperty("continuationCount", 0);
    expect(result).toHaveProperty("toolCalls");
    expect(result).toHaveProperty("plan");
  });

  it("handles errors gracefully when generateText throws", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API failure"));

    const result = await runPhase(
      mockModel,
      "coder",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );

    expect(result.stoppedReason).toBe("error");
    expect(result.text).toContain("API failure");
    expect(result.hitLimit).toBe(false);
    expect(result.stepCount).toBe(0);
    expect(result.continuationCount).toBe(0);
  });

  it("extracts plan from planner phase text", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '```plan\n{"tasks": [], "summary": "test plan"}\n```\nDone planning',
      usage: { inputTokens: 5, outputTokens: 3 },
    } as any);

    const result = await runPhase(
      mockModel,
      "planner",
      makeMessages("Plan"),
      buildTools,
      controller.signal,
    );

    expect(result.plan).toBeDefined();
    expect(result.plan).toContain("test plan");
  });
});
