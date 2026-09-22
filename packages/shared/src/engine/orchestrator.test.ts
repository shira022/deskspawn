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
  PIPELINE_TIERS,
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

describe("PIPELINE_TIERS", () => {
  it("defines a distinct composition for each of the 5 levels", () => {
    expect(PIPELINE_TIERS[1].phases).toEqual(["coder"]);
    expect(PIPELINE_TIERS[2].phases).toEqual(["coder", "verifier"]);
    expect(PIPELINE_TIERS[3].phases).toEqual(["planner", "coder", "verifier"]);
    expect(PIPELINE_TIERS[4].phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
    expect(PIPELINE_TIERS[5].phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
  });

  it("states L4 and L5 differ by fixRounds", () => {
    // L4 / L5 は同一フェーズだが fixRounds の差で区別する
    expect(PIPELINE_TIERS[4].phases).toEqual(PIPELINE_TIERS[5].phases);
    expect(PIPELINE_TIERS[4].fixRounds).toBe(1);
    expect(PIPELINE_TIERS[5].fixRounds).toBe(2);
  });

  it("makes fixRounds level-dependent (0 for L1-L3, 1 for L4, 2 for L5)", () => {
    // visual_qa を含まない L1〜L3 は修正ループに入らないため fixRounds=0。
    expect(PIPELINE_TIERS[1].fixRounds).toBe(0);
    expect(PIPELINE_TIERS[2].fixRounds).toBe(0);
    expect(PIPELINE_TIERS[3].fixRounds).toBe(0);
    expect(PIPELINE_TIERS[4].fixRounds).toBe(1);
    expect(PIPELINE_TIERS[5].fixRounds).toBe(2);
  });

  it("enables dummyDataRegen only for the visual_qa tiers (L4/L5)", () => {
    expect(PIPELINE_TIERS[1].dummyDataRegen).toBe(false);
    expect(PIPELINE_TIERS[2].dummyDataRegen).toBe(false);
    expect(PIPELINE_TIERS[3].dummyDataRegen).toBe(false);
    expect(PIPELINE_TIERS[4].dummyDataRegen).toBe(true);
    expect(PIPELINE_TIERS[5].dummyDataRegen).toBe(true);
  });

  it("produces 5 unique phase+fixRounds+dummyDataRegen compositions", () => {
    const signatures = ([1, 2, 3, 4, 5] as const).map(
      (level) =>
        `${PIPELINE_TIERS[level].phases.join(">")}|${PIPELINE_TIERS[level].fixRounds}|${PIPELINE_TIERS[level].dummyDataRegen}`,
    );
    expect(new Set(signatures).size).toBe(5);
  });
});

describe("runWithTriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateText).mockReset();
  });

  it("L1 dispatches to coder only", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({ level: 1, reason: "Typo fix" }),
    } as any);
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
    expect(generateText).toHaveBeenCalledTimes(2); // triage + coder
  });

  it("L2 dispatches to coder + verifier (no planner)", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({ level: 2, reason: "Minor tweak" }),
    } as any);
    // coder
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Changed button color",
      usage: { inputTokens: 20, outputTokens: 10 },
    } as any);
    // verifier
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "No errors found",
      usage: { inputTokens: 5, outputTokens: 3 },
    } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Change button to red"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["coder", "verifier"]);
    expect(result.text).toBe("Changed button color");
    expect(generateText).toHaveBeenCalledTimes(3); // triage + 2 phases
  });

  it("L3 dispatches to planner + coder + verifier", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ level: 3, reason: "Standard feature" }) } as any)
      .mockResolvedValueOnce({ text: "Planned", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Coded", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verified", usage: { inputTokens: 1, outputTokens: 1 } } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Add a feature"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier"]);
    expect(generateText).toHaveBeenCalledTimes(4); // triage + 3 phases
  });

  it("L3 never runs visual_qa and therefore never enters a fix loop", async () => {
    // coder 出力に dummy-data パターンを含め、verifier 出力を失敗に見せかけても、
    // L3 は visual_qa を含まないため修正ループは起動しない。
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ level: 3, reason: "Standard feature" }) } as any)
      .mockResolvedValueOnce({ text: "Planned", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({
        text: "const users = [\n  { name: 'John Doe' },\n];\nTODO: implement fetch",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any)
      .mockResolvedValueOnce({ text: "❌ FAIL: blank page", usage: { inputTokens: 1, outputTokens: 1 } } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Add a feature"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier"]);
    expect(result.phases).not.toContain("visual_qa");
    expect(generateText).toHaveBeenCalledTimes(4); // triage + 3 phases only
  });

  it("L4 dispatches to the full 4-phase pipeline", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ level: 4, reason: "Cross-cutting change" }) } as any)
      .mockResolvedValueOnce({ text: "Planned the feature", usage: { inputTokens: 10, outputTokens: 5 } } as any)
      .mockResolvedValueOnce({ text: "Implemented the feature", usage: { inputTokens: 30, outputTokens: 15 } } as any)
      .mockResolvedValueOnce({ text: "No errors found", usage: { inputTokens: 5, outputTokens: 3 } } as any)
      .mockResolvedValueOnce({ text: "✅ PASS", usage: { inputTokens: 8, outputTokens: 4 } } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Refactor the data layer"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
    expect(generateText).toHaveBeenCalledTimes(5); // triage + 4 phases
  });

  it("L4 re-runs the coder when dummy data is detected", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ level: 4, reason: "New feature" }) } as any)
      .mockResolvedValueOnce({ text: "Plan", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({
        text: "const users = [\n  { name: 'John Doe' },\n];\nTODO: implement fetch",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any)
      // dummy-data 再生成で coder がもう一度走る
      .mockResolvedValueOnce({ text: "Real fetch implementation", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verified", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "✅ PASS", usage: { inputTokens: 1, outputTokens: 1 } } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build a feature"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual(["planner", "coder", "coder", "verifier", "visual_qa"]);
    expect(generateText).toHaveBeenCalledTimes(6); // triage + planner + coder x2 + verifier + visual_qa
  });

  it("L4 caps visual_qa fix loop at 1 round", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ level: 4, reason: "Needs QA" }) } as any)
      .mockResolvedValueOnce({ text: "Plan", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Code", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verify", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "❌ FAIL: blank page", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      // fix round 1
      .mockResolvedValueOnce({ text: "Code fixed", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verify fixed", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "❌ FAIL: still broken", usage: { inputTokens: 1, outputTokens: 1 } } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Needs QA"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual([
      "planner", "coder", "verifier", "visual_qa",
      "coder", "verifier", "visual_qa",
    ]);
    // 2回目の FAIL では追加ラウンドが発生しない（上限1）
    expect(generateText).toHaveBeenCalledTimes(8);
  });

  it("L5 allows up to 2 visual_qa fix rounds", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ level: 5, reason: "New app" }) } as any)
      .mockResolvedValueOnce({ text: "Plan", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Code", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verify", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "❌ FAIL: blank page", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      // fix round 1
      .mockResolvedValueOnce({ text: "Code fixed 1", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verify fixed 1", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "❌ FAIL: still broken", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      // fix round 2
      .mockResolvedValueOnce({ text: "Code fixed 2", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verify fixed 2", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "✅ PASS", usage: { inputTokens: 1, outputTokens: 1 } } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build a new app"),
      buildTools,
      controller.signal,
    );

    expect(result.phases).toEqual([
      "planner", "coder", "verifier", "visual_qa",
      "coder", "verifier", "visual_qa",
      "coder", "verifier", "visual_qa",
    ]);
    expect(generateText).toHaveBeenCalledTimes(11);
  });

  it("manual tier skips the triage LLM call and uses the selected level", async () => {
    // triage 用のモックは用意しない（呼ばれたら undefined になる）
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Planned", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Coded", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockResolvedValueOnce({ text: "Verified", usage: { inputTokens: 1, outputTokens: 1 } } as any);

    const onTriageResult = vi.fn();

    const result = await runWithTriage(
      mockModel,
      makeMessages("Add a feature"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      { onTriageResult },
      undefined,
      undefined,
      3, // manual L3
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier"]);
    expect(generateText).toHaveBeenCalledTimes(3); // 手動なので triage なし
    expect(onTriageResult).toHaveBeenCalledWith({ level: 3, reason: "" });
  });

  it("manual L1 runs coder only without triage", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Coded",
      usage: { inputTokens: 1, outputTokens: 1 },
    } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Tiny tweak"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
    );

    expect(result.phases).toEqual(["coder"]);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("collects the errored phase into failedPhases (structural failure signal)", async () => {
    // テキストにエラー語が現れない経路（例外）でも失敗を判別できること。
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API failure"));

    const result = await runWithTriage(
      mockModel,
      makeMessages("Tiny tweak"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1, // manual L1 → coder only
    );

    expect(result.phases).toEqual(["coder"]);
    expect(result.failedPhases).toEqual(["coder"]);
  });

  it("returns an empty failedPhases when no phase errored", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Coded",
      usage: { inputTokens: 1, outputTokens: 1 },
    } as any);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Tiny tweak"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
    );

    expect(result.failedPhases).toEqual([]);
  });

  it("calls onTriageResult hook with the triage result", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: JSON.stringify({ level: 2, reason: "Tiny tweak" }) } as any)
      .mockResolvedValueOnce({
        text: "done",
        usage: { inputTokens: 1, outputTokens: 1 },
      } as any)
      .mockResolvedValueOnce({
        text: "verified",
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
      level: 2,
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
    // 翻訳済みメッセージが入ること（生の i18n キーが露出しない）。
    expect(result.text).not.toContain("phaseFailedDetail");
    expect(result.text).toContain("coder");
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
