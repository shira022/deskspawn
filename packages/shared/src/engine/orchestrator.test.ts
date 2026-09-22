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
import i18n from "../lib/i18n";

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockModel = {} as any;
const buildTools = vi.fn(() => ({}));
const controller = new AbortController();

function makeMessages(text: string): Array<Record<string, unknown>> {
  return [{ role: "user", content: text }];
}

function defaultToolOutput(toolName: string): unknown {
  // apply_artifact の成功結果（成功したファイル変更は filesChanged が非空）。
  if (toolName === "apply_artifact") return { success: true, filesChanged: ["src/App.tsx"] };
  return {};
}

function mockTextWithTools(
  text: string,
  toolCalls: Array<{
    toolName: string;
    args?: Record<string, unknown>;
    output?: unknown;
  }> = [],
) {
  (vi.mocked(generateText) as any).mockImplementationOnce(async (opts: any) => {
    if (toolCalls.length > 0) {
      opts?.onStepFinish?.({
        toolCalls: toolCalls.map((tc) => ({ toolName: tc.toolName, args: tc.args ?? {} })),
        toolResults: toolCalls.map((tc) => ({
          toolName: tc.toolName,
          output: tc.output ?? defaultToolOutput(tc.toolName),
        })),
      });
    }
    return { text, usage: { inputTokens: 1, outputTokens: 1 } };
  });
}

function makeAbortError(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
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

  it("stops at a phase that ended with stoppedReason 'error' (no later phases run)", async () => {
    // manual L3: planner → coder → verifier。2番目の coder が例外で停止したら、
    // 3番目の verifier を実行せずパイプラインを中断すること。
    // （catch の errorText は ⚠️ で始まるため、テキストの ⚠️ では判定できない）
    vi.mocked(generateText)
      .mockResolvedValueOnce({ text: "Planned", usage: { inputTokens: 1, outputTokens: 1 } } as any)
      .mockRejectedValueOnce(new Error("API failure"));

    const result = await runWithTriage(
      mockModel,
      makeMessages("Add a feature"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      3, // manual L3
    );

    expect(result.phases).toEqual(["planner", "coder"]);
    expect(result.phases).not.toContain("verifier");
    expect(result.failedPhases).toEqual(["coder"]);
    expect(generateText).toHaveBeenCalledTimes(2); // planner + coder(next throws)
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

  it("collects tool calls from onStepFinish into the result", async () => {
    mockTextWithTools("Code", [{ toolName: "apply_artifact", args: { id: "x" } }]);

    const result = await runPhase(
      mockModel,
      "coder",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );

    expect(result.toolCalls).toEqual([{ toolName: "apply_artifact", args: { id: "x" } }]);
    expect(result.errorKind).toBeUndefined();
  });

  it("classifies 'signal timed out' as timeout and never leaks the raw SDK text", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("signal timed out"));

    const result = await runPhase(
      mockModel,
      "verifier",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );

    expect(result.stoppedReason).toBe("error");
    expect(result.errorKind).toBe("timeout");
    expect(result.text).not.toContain("signal timed out");
    expect(result.text).toContain(i18n.t("chat.error.timeout"));
  });

  it("classifies network / auth / model / ratelimit errors structurally", async () => {
    const cases: Array<[string, string]> = [
      ["failed to fetch", "network"],
      ["fetch failed", "network"],
      ["read ECONNRESET", "network"],
      ["getaddrinfo ENOTFOUND api.example.com", "network"],
      ["401 Unauthorized", "auth"],
      ["model not found", "model"],
      ["429 rate limit exceeded", "ratelimit"],
    ];

    for (const [message, expected] of cases) {
      vi.mocked(generateText).mockRejectedValueOnce(new Error(message));
      const result = await runPhase(
        mockModel,
        "verifier",
        makeMessages("Do work"),
        buildTools,
        controller.signal,
      );
      expect(result.errorKind, message).toBe(expected);
    }
  });

  it("classifies unclassified errors as 'unknown'", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("something totally unexpected"));
    const result = await runPhase(
      mockModel,
      "verifier",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );
    expect(result.errorKind).toBe("unknown");
  });

  it("classifies AbortError (user stop) as 'aborted', not 'timeout'", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(makeAbortError());
    const result = await runPhase(
      mockModel,
      "verifier",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );
    expect(result.stoppedReason).toBe("error");
    expect(result.errorKind).toBe("aborted");
  });

  it("treats 'connection timed out' as a timeout (not network)", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("connection timed out"));
    const result = await runPhase(
      mockModel,
      "verifier",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );
    expect(result.errorKind).toBe("timeout");
  });

  it("marks appliedChanges only when apply_artifact succeeded", async () => {
    mockTextWithTools("Code", [
      {
        toolName: "apply_artifact",
        args: { id: "a" },
        output: { success: true, filesChanged: ["src/App.tsx"] },
      },
    ]);
    const ok = await runPhase(
      mockModel,
      "coder",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );
    expect(ok.appliedChanges).toBe(true);

    mockTextWithTools("Code", [
      {
        toolName: "apply_artifact",
        args: { id: "b" },
        output: { success: false, filesChanged: [], errors: ["boom"] },
      },
    ]);
    const failed = await runPhase(
      mockModel,
      "coder",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );
    expect(failed.appliedChanges).toBe(false);
  });

  it("counts a verifier-derived successful apply_artifact as a file change", async () => {
    // PHASE_TOOLS 上 verifier も apply_artifact を保持するため、coder 以外の
    // 由来でも成功した変更として数えられること。
    mockTextWithTools("Fixed", [
      {
        toolName: "apply_artifact",
        args: { id: "v" },
        output: { success: true, filesChanged: ["src/App.tsx"] },
      },
    ]);
    const result = await runPhase(
      mockModel,
      "verifier",
      makeMessages("Do work"),
      buildTools,
      controller.signal,
    );
    expect(result.appliedChanges).toBe(true);
  });
});

describe("runPipelineForLevel: qaVerdict / interruptedBy / fileChangesApplied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateText).mockReset();
  });

  it("qaVerdict is 'current' when visual_qa runs after the last file change", async () => {
    mockTextWithTools("Plan");
    mockTextWithTools("Code", [{ toolName: "apply_artifact", args: { id: "a" } }]);
    mockTextWithTools("No errors found");
    mockTextWithTools("✅ PASS");

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build a new app"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      5,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
    expect(result.qaVerdict).toBe("current");
    expect(result.interruptedBy).toBeUndefined();
    expect(result.fileChangesApplied).toBe(true);
  });

  it("qaVerdict is 'not-run' when the tier never includes visual_qa (L1)", async () => {
    mockTextWithTools("Code", [{ toolName: "apply_artifact", args: { id: "a" } }]);

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
    expect(result.qaVerdict).toBe("not-run");
  });

  it("qaVerdict is 'not-run' for L2 (coder + verifier, no visual_qa)", async () => {
    mockTextWithTools("Code", [{ toolName: "apply_artifact", args: { id: "a" } }]);
    mockTextWithTools("No errors found");

    const result = await runWithTriage(
      mockModel,
      makeMessages("Small feature"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      2,
    );

    expect(result.phases).toEqual(["coder", "verifier"]);
    expect(result.phases).not.toContain("visual_qa");
    expect(result.qaVerdict).toBe("not-run");
    expect(result.failedPhases).toEqual([]);
  });

  it("qaVerdict is 'failed' when visual_qa itself fails (timeout) — the M1 bug", async () => {
    mockTextWithTools("Plan");
    mockTextWithTools("Code", [{ toolName: "apply_artifact", args: { id: "a" } }]);
    mockTextWithTools("No errors found");
    // visual_qa がタイムアウトで失敗し、判定を返さない
    vi.mocked(generateText).mockRejectedValueOnce(new Error("signal timed out"));

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build a new app"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      5,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa"]);
    expect(result.failedPhases).toEqual(["visual_qa"]);
    expect(result.qaVerdict).toBe("failed");
    expect(result.interruptedBy).toBe("timeout");
  });

  it("qaVerdict is 'stale' when files change after the last visual_qa; timeout is reported", async () => {
    mockTextWithTools("Plan");
    mockTextWithTools("Code", [{ toolName: "apply_artifact", args: { id: "a" } }]);
    mockTextWithTools("No errors found");
    mockTextWithTools("❌ FAIL: blank page", [{ toolName: "take_screenshot", args: {} }]);
    // fix round: coder changes files after the visual_qa verdict...
    mockTextWithTools("Code fixed", [{ toolName: "apply_artifact", args: { id: "b" } }]);
    // ...then the verifier is cut off by a per-call timeout.
    vi.mocked(generateText).mockRejectedValueOnce(new Error("signal timed out"));

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build a new app"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      5,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa", "coder", "verifier"]);
    expect(result.qaVerdict).toBe("stale");
    expect(result.interruptedBy).toBe("timeout");
    expect(result.failedPhases).toEqual(["verifier"]);
  });

  it("keeps qaVerdict 'current' when the final visual_qa runs after fix rounds (fix cap reached)", async () => {
    // 修正ラウンド上限に達しても最後の visual_qa は判定を返すため current のまま。
    mockTextWithTools("Plan");
    mockTextWithTools("Code", [{ toolName: "apply_artifact", args: { id: "a" } }]);
    mockTextWithTools("Verify");
    mockTextWithTools("❌ FAIL: blank page", [{ toolName: "take_screenshot", args: {} }]);
    // fix round 1
    mockTextWithTools("Code fixed", [{ toolName: "apply_artifact", args: { id: "b" } }]);
    mockTextWithTools("Verify 1");
    mockTextWithTools("❌ FAIL: still broken", [{ toolName: "take_screenshot", args: {} }]);

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build a new app"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      4, // L4: fixRounds = 1
    );

    expect(result.phases).toEqual([
      "planner", "coder", "verifier", "visual_qa",
      "coder", "verifier", "visual_qa",
    ]);
    expect(result.qaVerdict).toBe("current");
    expect(result.failedPhases).toEqual([]);
  });

  it("does not mark the verdict stale when a post-visual_qa apply_artifact failed", async () => {
    // 失敗した apply_artifact はファイル変更ではないため、判定を stale にしない。
    mockTextWithTools("Plan");
    mockTextWithTools("Code", [
      { toolName: "apply_artifact", args: { id: "a" }, output: { success: true, filesChanged: ["src/App.tsx"] } },
    ]);
    mockTextWithTools("Verify");
    mockTextWithTools("❌ FAIL: blank page", [{ toolName: "take_screenshot", args: {} }]);
    // fix round: coder の適用は失敗し、その後の verifier が例外で停止する
    mockTextWithTools("Code attempted", [
      { toolName: "apply_artifact", args: { id: "b" }, output: { success: false, filesChanged: [], errors: ["boom"] } },
    ]);
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API failure"));

    const result = await runWithTriage(
      mockModel,
      makeMessages("Build a new app"),
      buildTools,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      5,
    );

    expect(result.phases).toEqual(["planner", "coder", "verifier", "visual_qa", "coder", "verifier"]);
    expect(result.qaVerdict).toBe("current");
    expect(result.failedPhases).toEqual(["verifier"]);
  });

  it("interruptedBy is 'error' for non-timeout failures", async () => {
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
      1,
    );

    expect(result.interruptedBy).toBe("error");
    expect(result.failedPhases).toEqual(["coder"]);
    expect(result.qaVerdict).toBe("not-run");
  });

  it("interruptedBy is 'aborted' for a user stop (AbortError)", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(makeAbortError());

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

    expect(result.interruptedBy).toBe("aborted");
    expect(result.failedPhases).toEqual(["coder"]);
  });
});
