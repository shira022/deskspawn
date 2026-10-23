// @vitest-environment jsdom
/**
 * useChatStream.startGeneration — パイプライン実行〜生成後処理の経路テスト。
 *
 * エンジン本体（runWithTriage / 実 LLM 呼び出し）はモックし、
 * フック側の配線だけを検証する:
 * - コールバック（onPhaseStart / onPhaseEnd / onPhaseDetail / onStepProgress /
 *   onRateLimit / onContinuation / onTriageResult）の状態反映
 * - ツール実行エントリ（running → success / error）の記録
 * - 生成後処理（サマリ / コスト / チェポイント / 完了状態 / プレビュー再読込）
 * - 中断（handleStop → AbortError）と空応答の扱い
 *
 * 実ネットワーク・実 LLM は一切使わない。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const m = vi.hoisted(() => ({
  t: vi.fn(
    (key: string, opts?: Record<string, unknown>) => `${key}|${JSON.stringify(opts ?? {})}`,
  ),
  loadApiKey: vi.fn(),
  initMCPClients: vi.fn(),
  getMCPTools: vi.fn(),
  mcpExecute: vi.fn(),
  getModel: vi.fn(),
  runWithTriage: vi.fn(),
  calculateCost: vi.fn(),
  syncForErrors: vi.fn(),
  readFile: vi.fn(),
  listFiles: vi.fn(),
  applyArtifact: vi.fn(),
  getErrors: vi.fn(),
  takeScreenshot: vi.fn(),
  createCheckpoint: vi.fn(),
  setAppId: vi.fn(),
  listCheckpoints: vi.fn(),
  persistChatHistory: vi.fn(),
  loadChatHistory: vi.fn(),
}));

vi.mock("../lib/i18n", () => ({
  default: { t: m.t, changeLanguage: vi.fn(), language: "ja" },
}));

vi.mock("../lib/storage", () => ({
  saveProviderConfig: vi.fn().mockResolvedValue(undefined),
  loadProviderConfig: vi.fn().mockResolvedValue(null),
  saveApiKey: vi.fn().mockResolvedValue("browser"),
  loadApiKey: m.loadApiKey,
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  hasApiKey: vi.fn().mockResolvedValue(false),
  saveLastProvider: vi.fn().mockResolvedValue(undefined),
  loadLastProvider: vi.fn().mockResolvedValue(null),
  saveCurrentAppId: vi.fn().mockResolvedValue(undefined),
  loadCurrentAppId: vi.fn().mockResolvedValue(null),
  saveSettingsDesktop: vi.fn().mockResolvedValue(undefined),
  loadSettingsDesktop: vi.fn().mockResolvedValue(null),
  listApps: vi.fn().mockResolvedValue([]),
}));

vi.mock("../engine/tool-executors", () => ({
  setAppId: m.setAppId,
  listCheckpoints: m.listCheckpoints,
  persistChatHistory: m.persistChatHistory,
  loadChatHistory: m.loadChatHistory,
  readFile: m.readFile,
  listFiles: m.listFiles,
  applyArtifact: m.applyArtifact,
  getErrors: m.getErrors,
  takeScreenshot: m.takeScreenshot,
  createCheckpoint: m.createCheckpoint,
}));

vi.mock("../engine/orchestrator", () => ({ runWithTriage: m.runWithTriage }));
vi.mock("../engine/mcp-client", () => ({
  initMCPClients: m.initMCPClients,
  getMCPTools: m.getMCPTools,
}));
vi.mock("../engine/providers", () => ({ getModel: m.getModel }));
vi.mock("../lib/cost", () => ({
  calculateCost: m.calculateCost,
  setModelCostCache: vi.fn(),
  clearModelCostCache: vi.fn(),
  setModelCost: vi.fn(),
}));
vi.mock("../lib/preview", () => ({
  previewManager: { syncForErrors: m.syncForErrors },
}));

import { useChatStream } from "./useChatStream";
import { useAppStore } from "../store/useAppStore";
import type { ChatMessage } from "../types";

// ── モックしたエンジンの動作（フックへの配線を検証するための入力） ─────────────

/** buildTools が返すツール（実行関数だけを持つ最小形）。 */
interface TestTool {
  execute: (args?: Record<string, unknown>) => Promise<unknown>;
}

interface Hooks {
  onTriageResult?: (result: { level: number; reason: string }) => void;
  onPhaseDetail?: (phase: string, text: string) => void;
  onPhaseStart?: (phase: string) => unknown;
  onPhaseEnd?: (phase: string, result: unknown) => unknown;
  onStepProgress?: (phase: string, progress: { step: number; maxSteps: number }) => void;
  onRateLimit?: (phase: string, retryCount: number, maxRetries: number, waitMs: number) => void;
  onContinuation?: (phase: string, round: number, maxRounds: number) => void;
}

async function pipelineSuccess(
  _model: unknown,
  _messages: unknown,
  buildTools: (names: string[]) => Record<string, TestTool>,
  _signal: unknown,
  _simpleMode?: unknown,
  _language?: unknown,
  hooks?: Hooks,
): Promise<Record<string, unknown>> {
  hooks?.onTriageResult?.({ level: 3, reason: "feature" });

  const set = buildTools([
    "read_file",
    "list_files",
    "apply_artifact",
    "get_errors",
    "take_screenshot",
    "mcp_lookup",
    "no_such_tool",
  ]);

  await set.read_file.execute({ path: "/src/App.tsx" });
  await set.list_files.execute();
  await set.apply_artifact.execute({ id: "art-1", title: "初回実装", actions: [] });
  await set.get_errors.execute();
  await set.take_screenshot.execute({ width: 1440, height: 900, waitAfterLoad: 100 });
  if (set.mcp_lookup) {
    await set.mcp_lookup.execute({ query: "desk" });
  }

  hooks?.onPhaseDetail?.("planner", "summary: TODO アプリ");
  hooks?.onPhaseDetail?.("coder", "Created src/App.tsx");
  await hooks?.onPhaseEnd?.("coder", { text: "created files" });
  hooks?.onStepProgress?.("coder", { step: 4, maxSteps: 20 });
  hooks?.onRateLimit?.("coder", 1, 3, 1500);
  hooks?.onContinuation?.("coder", 2, 5);
  await hooks?.onPhaseStart?.("visual_qa");
  hooks?.onPhaseDetail?.("verifier", "No errors found");
  hooks?.onPhaseDetail?.("visual_qa", "✅ PASS");

  return {
    text: "パイプラインが完了しました",
    usage: { inputTokens: 1200, outputTokens: 400 },
    phases: ["planner", "coder", "verifier", "visual_qa"],
    failedPhases: [],
    qaVerdict: "current",
    fileChangesApplied: true,
  };
}

// ── テストヘルパ ──────────────────────────────────────────────────────────────

/** 生成中プレースホルダー（アシスタントメッセージ）を取り出す */
function botMessage(): ChatMessage {
  const msg = useAppStore
    .getState()
    .messages.find((candidate) => candidate.role === "assistant");
  if (!msg) throw new Error("assistant message was not created");
  return msg;
}

async function runGeneration(history: ChatMessage[] = []) {
  const { result } = renderHook(() => useChatStream());
  let onCompleteCalls = 0;
  await act(async () => {
    await result.current.startGeneration(history, () => {
      onCompleteCalls += 1;
    });
  });
  return { result, onCompleteCalls };
}

beforeEach(() => {
  vi.clearAllMocks();

  m.loadApiKey.mockResolvedValue("sk-test");
  m.getModel.mockReturnValue({ id: "test-model" });
  m.initMCPClients.mockResolvedValue(undefined);
  m.getMCPTools.mockReturnValue({
    mcp_lookup: {
      description: "lookup a desk",
      parameters: { type: "object", properties: {} },
      execute: m.mcpExecute.mockResolvedValue("mcp-ok"),
    },
  });
  m.calculateCost.mockReturnValue(0.42);
  m.syncForErrors.mockResolvedValue(undefined);
  m.createCheckpoint.mockResolvedValue("cp-1");
  m.listCheckpoints.mockResolvedValue([
    { id: "cp-1", createdAt: "2026-01-01" },
    { id: "cp-2", createdAt: "2026-01-02" },
  ]);
  m.persistChatHistory.mockResolvedValue(true);
  m.loadChatHistory.mockResolvedValue([]);
  m.readFile.mockResolvedValue("export const a = 1;");
  m.listFiles.mockResolvedValue(["src/App.tsx"]);
  m.applyArtifact.mockResolvedValue({
    success: true,
    filesChanged: ["src/App.tsx"],
    errors: [],
  });
  m.getErrors.mockResolvedValue([]);
  m.takeScreenshot.mockResolvedValue({
    success: true,
    detectedIssues: [],
    elements: [],
    consoleErrors: [],
  });
  m.runWithTriage.mockImplementation((...args: unknown[]) =>
    (pipelineSuccess as (...rest: unknown[]) => Promise<Record<string, unknown>>)(...args),
  );

  useAppStore.setState({
    aiConfig: {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
      apiKeyConfigured: true,
    },
    currentAppId: "app-1",
    messages: [],
    agentStatus: "idle",
    agentTier: "auto",
    saveFailed: false,
    reloadCounter: 0,
    workspaceReady: false,
    currentCheckpointIndex: -1,
    checkpoints: [],
    settings: {
      theme: "system",
      uiFontSize: 14,
      codeFontSize: 13,
      language: "ja",
      simpleMode: true,
    },
  });
});

// ── 正常系 ────────────────────────────────────────────────────────────────────

describe("useChatStream — パイプライン成功時の生成後処理", () => {
  it("サマリ・チェックポイント・コスト・完了状態まで正しく反映する", async () => {
    const { result, onCompleteCalls } = await runGeneration();

    expect(m.runWithTriage).toHaveBeenCalledTimes(1);
    expect(m.initMCPClients).toHaveBeenCalledTimes(1);
    expect(m.getModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", apiKey: "sk-test" }),
    );

    const bot = botMessage();
    expect(bot.content).toContain("## 生成完了");
    expect(bot.content).toContain("正常に生成されました");
    expect(bot.content).toContain("**アプリ概要**: TODO アプリ");
    expect(bot.content).toContain("**ファイル数**: 1 ファイルを作成・更新しました");

    // チェポイント / コスト
    expect(m.createCheckpoint).toHaveBeenCalledWith("app-1");
    expect(bot.checkpointId).toBe("cp-1");
    expect(m.calculateCost).toHaveBeenCalledWith({
      inputTokens: 1200,
      outputTokens: 400,
      model: "gpt-4o",
    });
    expect(bot.usage).toMatchObject({
      inputTokens: 1200,
      outputTokens: 400,
      estimatedCost: 0.42,
      provider: "openai",
      model: "gpt-4o",
    });

    // ツール実行エントリ（running → success）
    // MCP ツールは buildTools で提供されるが、組み込みツールのような
    // stepLogs ラッパは持たない（実行結果のみ）。
    expect(bot.stepLogs?.map((entry) => `${entry.toolName}:${entry.status}`)).toEqual([
      "read_file:success",
      "list_files:success",
      "apply_artifact:success",
      "get_errors:success",
      "take_screenshot:success",
    ]);
    expect(m.mcpExecute).toHaveBeenCalledWith({ query: "desk" });
    expect(bot.stepLogs?.[0].result).toBe("19 chars read from /src/App.tsx");
    expect(bot.stepLogs?.[1].result).toBe("1 files found");
    expect(bot.stepLogs?.[3].result).toBe("No errors found");

    // フェーズ詳細（コールバック → ストア → 永続化ペイロード）
    expect(bot.phaseOutputs?.map((entry) => entry.phase)).toEqual([
      "planner",
      "coder",
      "verifier",
      "visual_qa",
    ]);
    expect(Object.keys(result.current.phaseOutputs)).toEqual([
      "planner",
      "coder",
      "verifier",
      "visual_qa",
    ]);

    // コールバック由来の状態
    const state = useAppStore.getState();
    expect(state.agentStatus).toBe("complete");
    expect(state.agentStepCount).toBe(4);
    expect(state.agentMaxSteps).toBe(20);
    expect(state.lastTriage).toEqual({ level: 3, source: "auto", reason: "feature" });
    expect(result.current.rateLimitInfo).toEqual({
      retryCount: 1,
      maxRetries: 3,
      waitMs: 1500,
    });
    expect(result.current.continuationRound).toBe(2);
    expect(result.current.maxContinuations).toBe(5);
    expect(result.current.liveStepLogs).toEqual([]);

    // 非致命的な生成後処理（チェックポイント再読込 / プレビュー）
    expect(m.listCheckpoints).toHaveBeenCalledWith("app-1");
    expect(state.currentCheckpointIndex).toBe(1);
    expect(state.workspaceReady).toBe(true);
    expect(state.reloadCounter).toBe(1);
    // coder 終了時 + visual_qa 開始前にプレビューへ同期
    expect(m.syncForErrors).toHaveBeenCalledTimes(2);
    expect(m.syncForErrors).toHaveBeenCalledWith("app-1");

    expect(onCompleteCalls).toBe(1);
  });
});

// ── ツール実行エントリのエラー系 ──────────────────────────────────────────────

describe("useChatStream — ツール実行の成否を stepLogs に記録する", () => {
  it("ツールが例外を投げても error として記録し、生成は続行する", async () => {
    m.readFile.mockRejectedValue(new Error("ENOENT: no such file"));
    m.listFiles.mockRejectedValue(new Error("EACCES: permission denied"));
    m.applyArtifact.mockRejectedValue(new Error("write failed"));
    m.getErrors.mockRejectedValue(new Error("esbuild crashed"));
    m.takeScreenshot.mockRejectedValue(new Error("capture failed"));

    const { onCompleteCalls } = await runGeneration();

    const bot = botMessage();
    expect(bot.stepLogs?.map((entry) => `${entry.toolName}:${entry.status}`)).toEqual([
      "read_file:error",
      "list_files:error",
      "apply_artifact:error",
      "get_errors:error",
      "take_screenshot:error",
    ]);
    expect(bot.stepLogs?.[0].result).toContain("ENOENT");
    expect(bot.stepLogs?.[0].detail).toMatchObject({ error: "ENOENT: no such file" });
    expect(bot.stepLogs?.[1].result).toContain("EACCES");
    expect(bot.stepLogs?.[2].result).toContain("write failed");
    expect(bot.stepLogs?.[3].result).toContain("esbuild crashed");
    expect(bot.stepLogs?.[4].result).toContain("capture failed");
    expect(bot.stepLogs?.[2].result).toContain("❌ write failed");

    // ツール失敗はサマリでは「ツールエラー件数」として扱われる
    expect(bot.content).toContain("5 件のツールエラー");
    expect(useAppStore.getState().agentStatus).toBe("complete");
    expect(onCompleteCalls).toBe(1);
  });

  it("apply_artifact / take_screenshot が失敗結果を返したら error 扱いにする", async () => {
    m.applyArtifact.mockResolvedValue({
      success: false,
      filesChanged: [],
      errors: ["schema mismatch"],
    });
    m.takeScreenshot.mockResolvedValue({ success: false, error: "page crashed" });

    await runGeneration();

    const bot = botMessage();
    expect(bot.stepLogs?.[2].status).toBe("error");
    expect(bot.stepLogs?.[2].result).toBe("Failed: schema mismatch");
    expect(bot.stepLogs?.[4].status).toBe("error");
    expect(bot.stepLogs?.[4].result).toBe("❌ page crashed");
    expect(bot.stepLogs?.[2].detail).toEqual({
      filesChanged: [],
      errors: ["schema mismatch"],
    });
    expect(bot.content).toContain("2 件のツールエラー");
  });

  it("take_screenshot の検出 Issue 数をサマリ行と detail の両方に残す", async () => {
    m.takeScreenshot.mockResolvedValue({
      success: true,
      detectedIssues: [
        { severity: "error", message: "console error" },
        { severity: "warning", message: "contrast" },
      ],
      elements: [{}, {}],
      consoleErrors: ["Uncaught TypeError"],
    });

    await runGeneration();

    const bot = botMessage();
    expect(bot.stepLogs?.[4].status).toBe("success");
    expect(bot.stepLogs?.[4].result).toContain("1 errors, 1 warnings detected");
    expect(bot.stepLogs?.[4].detail).toMatchObject({
      elementsCount: 2,
      consoleErrors: 1,
    });
    expect(bot.stepLogs?.[4].detail?.["detectedIssues"]).toHaveLength(2);
  });

  it("MCP ツールが無ければ組み込みツールだけで動く", async () => {
    m.getMCPTools.mockReturnValue(null);

    await runGeneration();

    const bot = botMessage();
    expect(bot.stepLogs?.map((entry) => entry.toolName)).toEqual([
      "read_file",
      "list_files",
      "apply_artifact",
      "get_errors",
      "take_screenshot",
    ]);
    expect(m.mcpExecute).not.toHaveBeenCalled();
  });
});

// ── 異常系 ────────────────────────────────────────────────────────────────────

describe("useChatStream — 失敗・中断の扱い", () => {
  it("アプリ未選択なら chat.error.noAppSelected を返してエンジンを呼ばない", async () => {
    useAppStore.setState({ currentAppId: null });

    const { onCompleteCalls } = await runGeneration();

    expect(m.runWithTriage).not.toHaveBeenCalled();
    const messages = useAppStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("chat.error.noAppSelected");
    expect(onCompleteCalls).toBe(1);
  });

  it("エンジンが空応答を返したら error 状態と空応答メッセージにする", async () => {
    m.runWithTriage.mockResolvedValue({
      text: "",
      usage: { inputTokens: 10, outputTokens: 0 },
      phases: [],
      failedPhases: [],
      qaVerdict: "not-run",
      fileChangesApplied: false,
    });

    const { onCompleteCalls } = await runGeneration();

    const state = useAppStore.getState();
    expect(state.agentStatus).toBe("error");
    const bot = botMessage();
    expect(bot.content).toContain("chat.error.emptyResponse");
    expect(bot.content).toContain("OpenAI");
    expect(bot.checkpointId).toBeUndefined();
    expect(m.createCheckpoint).not.toHaveBeenCalled();
    expect(onCompleteCalls).toBe(1);
  });

  it("チェックポイント作成に失敗しても生成は完了する（警告のみ）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.createCheckpoint.mockRejectedValue(new Error("disk full"));

    try {
      const { onCompleteCalls } = await runGeneration();

      expect(warn).toHaveBeenCalledWith(
        "[chat] Failed to create checkpoint:",
        expect.any(Error),
      );
      expect(botMessage().checkpointId).toBeUndefined();
      expect(useAppStore.getState().agentStatus).toBe("complete");
      expect(onCompleteCalls).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("生成中に handleStop すると中断し、中断メッセージを残して idle に戻る", async () => {
    const { result } = renderHook(() => useChatStream());
    let started: () => void = () => {};
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });

    m.runWithTriage.mockImplementation(
      (_model: unknown, _messages: unknown, _tools: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          started();
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })),
          );
        }),
    );

    let generation!: Promise<void>;
    await act(async () => {
      generation = result.current.startGeneration([], () => {});
      await startedPromise;
    });
    expect(useAppStore.getState().agentStatus).toBe("running");

    await act(async () => {
      result.current.handleStop();
      await generation;
    });

    const state = useAppStore.getState();
    expect(state.agentStatus).toBe("idle");
    expect(result.current.liveStepLogs).toEqual([]);
    expect(botMessage().content).toContain("chat.error.generationInterrupted");
  });
});


// ── 履歴の引き渡し・多重起動 ──────────────────────────────────────────────────

describe("useChatStream — 履歴の引き渡しと多重起動ガード", () => {
  it("渡した履歴を AI SDK 形式に変換してエンジンへ渡す", async () => {
    const history: ChatMessage[] = [
      { id: "h1", role: "user", content: "TODOアプリを作って", timestamp: 1 },
      { id: "h2", role: "assistant", content: "了解しました", timestamp: 2 },
    ];

    await runGeneration(history);

    expect(m.runWithTriage).toHaveBeenCalledTimes(1);
    expect(m.runWithTriage.mock.calls[0][1]).toEqual([
      { role: "user", content: "TODOアプリを作って" },
      { role: "assistant", content: "了解しました" },
    ]);
  });

  it("生成中に再度 startGeneration しても二重実行されない", async () => {
    const { result } = renderHook(() => useChatStream());

    await act(async () => {
      const first = result.current.startGeneration([]);
      const second = result.current.startGeneration([]);
      await second;
      await first;
    });

    expect(m.runWithTriage).toHaveBeenCalledTimes(1);
    expect(
      useAppStore.getState().messages.filter((msg) => msg.role === "assistant"),
    ).toHaveLength(1);
  });
});
