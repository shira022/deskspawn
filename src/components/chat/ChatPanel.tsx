import { useRef, useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StepLogPanel } from "@/components/chat/StepLogPanel";
import { MessageSquare, Bot, Loader2, ChevronDown, ChevronLeft, ChevronRight, History, Clock } from "lucide-react";
import type { ChatMessage as ChatMessageType, AiConfig, StepLogEntry } from "@/types";
import { getMessageCountForCheckpoint, restoreCheckpoint } from "@/lib/checkpoint-utils";
import { SIDECAR_BASE, providerLabels } from "@/lib/constants";
const SIDECAR_CHAT_URL = `${SIDECAR_BASE}/chat`;

/**
 * メッセージ履歴からタスク複雑度を推定し、適切な初期最大ステップ数を返す。
 * - バグ修正・小規模変更 → 20 steps
 * - 機能追加（中程度） → 30 steps
 * - 新規作成・大規模タスク → 50 steps
 * リクエストの文字数やキーワードを基に判定。
 */
function estimateTaskComplexity(messages: ChatMessageType[]): number {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return 20;

  const text = lastUserMsg.content;
  const length = text.length;
  const lower = text.toLowerCase();

  // 複雑タスクのパターン（新規作成・大規模機能）
  const complexPatterns = [
    "create", "new app", "新規", "作って", "フル", "full", "complete",
    "アプリにして", "アプリ作成", "一から", "from scratch",
    "dashboard", "ダッシュボード", "管理画面", "全て",
    "全部", "一括", "全体", "フルスタック",
  ];
  // シンプルタスクのパターン（バグ修正・小変更）
  const simplePatterns = [
    "fix", "bug", "直し", "バグ", "修正", "typo",
    "微小", "少し", "ちょっと", "だけ", "のみ",
    "色を変え", "文字を変え",
  ];

  const isComplex = complexPatterns.some((p) => lower.includes(p));
  const isSimple = simplePatterns.some((p) => lower.includes(p)) && length < 200;

  if (isComplex || length > 500) return 50;
  if (length > 300) return 50;
  if (length > 150 && !isSimple) return 30;
  if (isSimple) return 20;
  return 20; // デフォルト
}

export function ChatPanel() {
  const messages = useAppStore((s) => s.messages);
  const visibleMessageCount = useAppStore((s) => s.visibleMessageCount);
  const checkpoints = useAppStore((s) => s.checkpoints);
  const currentCheckpointIndex = useAppStore((s) => s.currentCheckpointIndex);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const agentStepCount = useAppStore((s) => s.agentStepCount);
  const agentMaxSteps = useAppStore((s) => s.agentMaxSteps);
  const setAgentMaxSteps = useAppStore((s) => s.setAgentMaxSteps);
  const aiConfig = useAppStore((s) => s.aiConfig);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const projects = useAppStore((s) => s.projects);
  const projectSwitching = useAppStore((s) => s.projectSwitching);

  // When the preview slider has navigated back, only show the messages that
  // existed at that checkpoint.  visibleMessageCount = -1 means "show all".
  const displayMessages =
    visibleMessageCount >= 0
      ? messages.slice(0, visibleMessageCount)
      : messages;

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [liveStepLogs, setLiveStepLogs] = useState<StepLogEntry[]>([]);
  const [continuationRound, setContinuationRound] = useState(0);
  const [maxContinuations, setMaxContinuations] = useState(0);
  const [rateLimitInfo, setRateLimitInfo] = useState<{ retryCount: number; maxRetries: number; waitMs: number } | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Smart auto-scroll ─────────────────────────────────────────────

  const checkIsAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    const threshold = 100;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
    }
  }, []);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const atBottom = checkIsAtBottom();
    setIsAtBottom(atBottom);
    if (atBottom) {
      setShowScrollButton(false);
    } else if (agentStatus === "running" || liveStepLogs.length > 0) {
      setShowScrollButton(true);
    }
  }, [checkIsAtBottom, agentStatus, liveStepLogs.length]);

  // Auto-scroll when messages or tool calls change, only if at bottom
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom(false);
    } else if (displayMessages.length > 0 || liveStepLogs.length > 0) {
      setShowScrollButton(true);
    }
  }, [messages, liveStepLogs, isAtBottom, scrollToBottom]);

  // ── Abort controller for stop ──────────────────────────────────────

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    useAppStore.getState().setAgentStatus("idle");
    setLiveStepLogs([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // ── Sidecar call (reads state via getState for freshness) ────

  const handleSendWithHistory = useCallback(
    async (history: ChatMessageType[]) => {
      const state = useAppStore.getState();
      const { aiConfig: cfg, currentProjectId: pid, addMessage, setAgentStatus, setAgentStepCount, setWorkspaceReady } = state;

      if (!cfg) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: "⚠️ AI設定が行われていません。ツールバーの「AI未設定」ボタンから設定してください。",
          timestamp: Date.now(),
        });
        return;
      }

      if (!pid) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: "⚠️ プロジェクトが選択されていません。ツールバーの「新規アプリ」からプロジェクトを作成するか、アプリ履歴から選択してください。",
          timestamp: Date.now(),
        });
        return;
      }

      if (cfg.provider !== "ollama" && !cfg.apiKey && !cfg.apiKeyConfigured) {
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ ${providerLabels[cfg.provider] || cfg.provider} には API キーが必要です。\nツールバーの「${cfg.model || "AI未設定"}」→「APIキー設定」から設定してください。`,
          timestamp: Date.now(),
        });
        return;
      }

      // タスク複雑度を推定し、適切な初期最大ステップ数を設定
      const estimatedMaxSteps = estimateTaskComplexity(history);
      setAgentStatus("running");
      setAgentStepCount(0);
      setAgentMaxSteps(estimatedMaxSteps);
      setLiveStepLogs([]);
      setContinuationRound(0);
      setMaxContinuations(0);
      setRateLimitInfo(null);
      scrollToBottom(true);

      try {
        const producedOutput = await callSidecar(history, addMessage, setAgentStepCount, setAgentMaxSteps, setLiveStepLogs, setWorkspaceReady, cfg, abortControllerRef, estimatedMaxSteps, setContinuationRound, setMaxContinuations, setRateLimitInfo);
        if (!producedOutput) {
          setAgentStatus("error");
          setWorkspaceReady(true);
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: `⚠️ AIが空のレスポンスを返しました。モデルの設定を確認するか、もう一度試してみてください。\n\nプロバイダー: ${cfg.provider}\nモデル: ${cfg.model}\n\nツールバーのモデル名をクリックして設定を確認してください。`,
            timestamp: Date.now(),
          });
          return;
        }
        setAgentStatus("complete");
        const { setWorkspacePort, workspacePort, fetchCheckpoints, setCurrentCheckpointIndex, triggerReload } = useAppStore.getState();
        // Sync workspace port from the sidecar (which may differ from default 5174
        // if the port was already in use)
        fetch(`${SIDECAR_BASE}/projects/ready`)
          .then(r => r.json())
          .then(data => {
            if (typeof data.port === 'number' && data.port !== workspacePort) {
              setWorkspacePort(data.port);
            }
          })
          .catch(() => {});
        // Refresh checkpoint list after generation
        await fetchCheckpoints();
        setCurrentCheckpointIndex(useAppStore.getState().checkpoints.length - 1);
        // Reload iframe to ensure preview shows latest generation state
        triggerReload();
      } catch (e: any) {
        if (e?.name === "AbortError") {
          console.log("[chat] Generation cancelled by user");
          // Restore workspace ready state after cancellation
          setWorkspaceReady(true);
          return;
        }
        console.error("Sidecar error:", e);
        const errMsg = String(e);
        const hint = errMsg.includes("API key") || errMsg.includes("401")
          ? "APIキーが無効か未設定です。ツールバーの「APIキー設定」から確認してください。"
          : errMsg.includes("fetch") || errMsg.includes("Load failed") || errMsg.includes("NetworkError")
            ? "サイドカーサーバーに接続できません。\nnpm run sidecar server を実行してください。"
            : `サイドカーサーバーが起動しているか確認してください。\n\`npm run sidecar server\` を実行してください。`;
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ エラーが発生しました: ${errMsg}\n\n${hint}`,
          timestamp: Date.now(),
        });
        setAgentStatus("error");
        setWorkspaceReady(true);
      }
    },
    [scrollToBottom]
  );

  // ── Edit & Regenerate ─────────────────────────────────────────────

  const handleEdit = useCallback(
    async (id: string, newContent: string) => {
      const { messages: msgs, updateMessage, truncateMessages, setWorkspaceReady, fetchCheckpoints, setCurrentCheckpointIndex, addMessage } = useAppStore.getState();
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx === -1) return;

      // Restore project files to the state just before the edited message:
      // find the last assistant message before this user message and use its checkpoint
      const prevAssistantMsg = msgs.slice(0, idx).reverse().find((m) => m.role === "assistant");
      const checkpointId = prevAssistantMsg?.checkpointId ?? "initial";
      try {
        setWorkspaceReady(false);
        await restoreCheckpoint(checkpointId);
      } catch (e) {
        console.warn("[chat] Failed to restore checkpoint:", e);
        setWorkspaceReady(true);
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ チェックポイントの復元に失敗しました。\n\n${e instanceof Error ? e.message : String(e)}\n\nプレビューを最新の状態に戻します。`,
          timestamp: Date.now(),
        });
        return;
      }

      updateMessage(id, { content: newContent });
      truncateMessages(idx + 1);
      useAppStore.getState().setVisibleMessageCount(-1); // reset visibility after truncation

      // Refresh checkpoint state and set to latest
      await fetchCheckpoints();
      setCurrentCheckpointIndex(useAppStore.getState().checkpoints.length - 1);

      const history = [...useAppStore.getState().messages];
      handleSendWithHistory(history);
    },
    [handleSendWithHistory]
  );

  // ── Retry (resend a past user message) ───────────────────────────

  const handleRetry = useCallback(
    async (id: string) => {
      const state = useAppStore.getState();
      const { messages: msgs, truncateMessages, setWorkspaceReady, fetchCheckpoints, setCurrentCheckpointIndex, addMessage } = state;
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx === -1) return;

      // Restore project files to the state just before this user message
      const prevAssistantMsg = msgs.slice(0, idx).reverse().find((m) => m.role === "assistant");
      const checkpointId = prevAssistantMsg?.checkpointId ?? "initial";
      try {
        setWorkspaceReady(false);
        await restoreCheckpoint(checkpointId);
      } catch (e) {
        console.warn("[chat] Failed to restore checkpoint:", e);
        setWorkspaceReady(true);
        addMessage({
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ チェックポイントの復元に失敗しました。\n\n${e instanceof Error ? e.message : String(e)}\n\nプレビューを最新の状態に戻します。`,
          timestamp: Date.now(),
        });
        return;
      }

      // Truncate messages after the user message (remove AI response and beyond)
      truncateMessages(idx + 1);
      useAppStore.getState().setVisibleMessageCount(-1);

      // Refresh checkpoint state and set to latest
      await fetchCheckpoints();
      setCurrentCheckpointIndex(useAppStore.getState().checkpoints.length - 1);

      const history = [...useAppStore.getState().messages];
      handleSendWithHistory(history);
    },
    [handleSendWithHistory]
  );

  // ── Send new message ──────────────────────────────────────────────

  const handleSend = useCallback(
    async (content: string) => {
      const state = useAppStore.getState();
      const { messages: allMsgs, visibleMessageCount: vmc, checkpoints, currentCheckpointIndex: cpIdx } = state;

      // If the preview was showing a past state (navigated back), truncate
      // messages to that point and clean up the "future" checkpoints so the
      // new generation starts cleanly from the restored checkpoint state.
      if (vmc >= 0 && vmc < allMsgs.length) {
        state.truncateMessages(vmc);
        state.setVisibleMessageCount(-1);

        if (cpIdx >= 0 && cpIdx < checkpoints.length) {
          try {
            await fetch(`${SIDECAR_BASE}/projects/checkpoints/cleanup`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ keepCheckpointId: checkpoints[cpIdx].id }),
            });
          } catch (e) {
            console.warn("[chat] Failed to cleanup checkpoints after navigate-back:", e);
          }
        }
      }

      const { addMessage, setAgentStepCount } = useAppStore.getState();
      const userMsg: ChatMessageType = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
      };
      addMessage(userMsg);
      setLiveStepLogs([]);
      setAgentStepCount(0);
      setContinuationRound(0);
      setMaxContinuations(0);

      const currentMessages = [...useAppStore.getState().messages];
      handleSendWithHistory(currentMessages);
    },
    [handleSendWithHistory]
  );

  // ── Navigate to a specific checkpoint from chat ────────────────────

  const handleNavigateToCheckpoint = useCallback(async (checkpointIndex: number) => {
    const state = useAppStore.getState();
    const { checkpoints: cps, setWorkspaceReady, setCurrentCheckpointIndex, setVisibleMessageCount, messages: msgs } = state;
    const cp = cps[checkpointIndex];
    if (!cp) return;

    setWorkspaceReady(false);
    setCurrentCheckpointIndex(checkpointIndex);

    const msgCount = getMessageCountForCheckpoint(cps, msgs, checkpointIndex);
    // If navigating to the latest state, show all messages (-1 = all)
    if (msgCount >= msgs.length) {
      setVisibleMessageCount(-1);
    } else {
      setVisibleMessageCount(msgCount);
    }

    try {
      await fetch(`${SIDECAR_BASE}/projects/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkpointId: cp.id }),
      });
    } catch (e) {
      console.warn("[chat] Failed to navigate to checkpoint:", e);
      setWorkspaceReady(true);
    }
  }, []);

  // ── Message grouping ──────────────────────────────────────────────

  const messagesWithGrouping = displayMessages.map((msg, i) => {
    const prevMsg = i > 0 ? displayMessages[i - 1] : null;
    const showAvatar = !prevMsg || prevMsg.role !== msg.role;

    // Compute checkpoint label for assistant messages: match checkpointId → slider position
    let checkpointLabel: string | undefined;
    let checkpointIndex: number | undefined;
    let checkpointCount: number | undefined;
    if (msg.role === "assistant" && msg.checkpointId) {
      const idx = checkpoints.findIndex((cp) => cp.id === msg.checkpointId);
      if (idx >= 0) {
        checkpointLabel = `${idx + 1}/${checkpoints.length}`;
        checkpointIndex = idx;
        checkpointCount = checkpoints.length;
      }
    }

    return {
      ...msg,
      showAvatar,
      checkpointLabel,
      checkpointIndex,
      checkpointCount,
    };
  });

  // Find the latest user message (for retry button)
  const lastUserMsgIndex = (() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === "user") return i;
    }
    return -1;
  })();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-2 border-b border-border/50 px-3">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">チャット</span>

        {/* Checkpoint navigation (synced with preview panel) */}
        {checkpoints.length > 0 && (
          <div className="flex items-center gap-1 border-l border-border/40 pl-2">
            <button
              onClick={() => handleNavigateToCheckpoint(currentCheckpointIndex - 1)}
              disabled={currentCheckpointIndex <= 0}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title="1つ前の状態に戻る"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[2.5rem] text-center select-none">
              {currentCheckpointIndex + 1}/{checkpoints.length}
            </span>
            <button
              onClick={() => handleNavigateToCheckpoint(currentCheckpointIndex + 1)}
              disabled={currentCheckpointIndex >= checkpoints.length - 1}
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title="1つ先の状態に進む"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* History browsing badge */}
        {visibleMessageCount >= 0 && (
          <div className="flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5">
            <History className="h-3 w-3 text-amber-500/70" />
            <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80 font-medium">履歴</span>
          </div>
        )}

        {rateLimitInfo && (
          <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Clock className="h-3 w-3 animate-pulse" />
            レートリミット中... {rateLimitInfo.waitMs}ms待機中 ({rateLimitInfo.retryCount}/{rateLimitInfo.maxRetries})
          </span>
        )}
        {agentStatus === "running" && !rateLimitInfo && (
          <span className="ml-auto text-xs text-muted-foreground animate-pulse flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {agentStepCount > 0
              ? `Step ${agentStepCount}/${agentMaxSteps}${continuationRound > 0 ? ` (継続 ${continuationRound}/${maxContinuations})` : ""}: コードを生成中...`
              : "AI がコードを生成しています..."}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        {/* History browsing banner (visible when viewing past checkpoint) */}
        {visibleMessageCount >= 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/5 border-b border-amber-500/10 z-10 relative">
            <History className="h-3 w-3 text-amber-500/60 shrink-0" />
            <span className="text-[11px] text-amber-600/70 dark:text-amber-400/70">
              過去の状態を表示中（{checkpoints.length > 0 ? `${currentCheckpointIndex + 1}/${checkpoints.length}` : ""}）
            </span>
            <button
              onClick={() => handleNavigateToCheckpoint(checkpoints.length - 1)}
              className="ml-auto text-[11px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
            >
              最新の状態に戻る
            </button>
          </div>
        )}

        <ScrollArea
          ref={scrollRef}
          className="h-full"
          onScroll={handleScroll}
          viewportClassName="p-4"
        >
          {displayMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center min-h-[300px] p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              {projectSwitching ? (
                <>
                  <h3 className="text-sm font-medium mb-1">プロジェクトを切り替え中...</h3>
                  <p className="text-xs text-muted-foreground">新しいプロジェクトの準備ができ次第、チャットを開始できます。</p>
                </>
              ) : currentProjectId ? (
                <>
                  <h3 className="text-sm font-medium mb-1">
                    {projects.find((p) => p.id === currentProjectId)?.name || "アプリ"} — DeskSpawn チャット
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    「タスク管理アプリにして」「ダークモードを追加して」など、
                    作りたいアプリを自由に指示してください。
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-medium mb-1">DeskSpawn チャット</h3>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    ツールバーの「新規アプリ」からプロジェクトを作成すると、
                    チャットでアプリの構築を開始できます。
                  </p>
                </>
              )}
              <p className="text-xs text-muted-foreground/60 mt-2">
                {aiConfig
                  ? `${providerLabels[aiConfig.provider] || aiConfig.provider} ${aiConfig.model} を使用中`
                  : "AI未設定 — ツールバーから設定してください"}
              </p>
              {currentProjectId && (
                <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                  {[
                    "カウンターアプリにスタイルをつけて",
                    "ToDoリストアプリにして",
                    "ダークモード対応にして",
                    "タイマー機能を追加して",
                  ].map((s) => (
                    <button
                      key={s}
                      className="rounded-full border border-border/50 px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                      onClick={() => handleSend(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4 py-4">
              {messagesWithGrouping.map((msg, i) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  showAvatar={msg.showAvatar}
                  onEdit={msg.role === "user" ? handleEdit : undefined}
                  onRegenerate={msg.role === "user" && i === lastUserMsgIndex ? () => handleRetry(msg.id) : undefined}
                  checkpointLabel={(msg as any).checkpointLabel}
                  checkpointIndex={(msg as any).checkpointIndex}
                  checkpointCount={(msg as any).checkpointCount}
                  onNavigateToCheckpoint={handleNavigateToCheckpoint}
                />
              ))}

              {/* Step log (live during generation) */}
              {liveStepLogs.length > 0 && (
                <div className="pl-11">
                  <StepLogPanel stepLogs={liveStepLogs} isLive />
                </div>
              )}

              {/* Typing indicator when running */}
              {agentStatus === "running" && liveStepLogs.length === 0 && (
                <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Bot className="h-4 w-4 text-foreground" />
                  </div>
                  <div className="rounded-2xl rounded-bl-md bg-muted/50 border border-border/30 px-4 py-3">
                    <div className="flex gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Invisible anchor for scrollIntoView */}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        {/* Floating scroll-to-bottom button */}
        {showScrollButton && (
          <button
            onClick={() => {
              scrollToBottom(true);
              setIsAtBottom(true);
              setShowScrollButton(false);
            }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-border/50 bg-background/90 backdrop-blur-sm px-3 py-1.5 text-xs text-muted-foreground shadow-lg hover:bg-muted transition-all animate-in fade-in slide-in-from-bottom-2 duration-200 z-10"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            最新へ
          </button>
        )}
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} onStop={handleStop} />
    </div>
  );
}

// ── Actual sidecar call via SSE ──────────────────────────────────────────────

interface SSEMessage {
  type: "tool_call" | "tool_result" | "text" | "error" | "done" | "step_progress" | "checkpoint" | "continuation" | "rate_limit";
  id?: string;
  step?: number;
  maxSteps?: number;
  continuationRound?: number;
  maxContinuations?: number;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  detail?: Record<string, unknown>;
  text?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  steps?: number;
  round?: number;
  maxRounds?: number;
  // rate_limit fields
  retryCount?: number;
  maxRetries?: number;
  waitMs?: number;
}

/**
 * @returns true if the AI produced any text output, false otherwise.
 */
async function callSidecar(
  messages: ChatMessageType[],
  addMessage: (msg: ChatMessageType) => void,
  setStep: (step: number) => void,
  setMaxSteps: (maxSteps: number) => void,
  setLiveStepLogs: (logs: StepLogEntry[]) => void,
  setWorkspaceReady: (ready: boolean) => void,
  config: AiConfig | null,
  abortRef: React.MutableRefObject<AbortController | null>,
  estimatedMaxSteps?: number,
  setContinuationRound?: (round: number) => void,
  setMaxContinuations?: (max: number) => void,
  setRateLimitInfo?: (info: { retryCount: number; maxRetries: number; waitMs: number } | null) => void,
): Promise<boolean> {
  const provider = config?.provider ?? "ollama";
  const model = config?.model ?? "";
  const apiKey = config?.apiKey ?? "";
  const customEndpoint = config?.customEndpoint;
  const temperature = config?.temperature ?? 0.2;
  const maxTokens = config?.maxTokens ?? 16384;

  const abortController = new AbortController();
  abortRef.current = abortController;

  const response = await fetch(SIDECAR_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortController.signal,
    body: JSON.stringify({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      config: {
        provider, model, apiKey, customEndpoint, temperature, maxTokens,
        maxSteps: estimatedMaxSteps ?? 20,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Sidecar responded with ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let lastCheckpointId: string | undefined;
  let currentStep = 0;
  let maxSteps = 10;
  let sawError = false;

  // ── 構造化ステップログ追跡 ──────────────────────────────────────
  const stepLogs: StepLogEntry[] = [];
  // tool_result は tool_call より先に到着するので、いったんバッファして突き合わせる
  const pendingResults: Array<{ toolName: string; result: string; detail?: Record<string, unknown> }> = [];

  /** 最新の stepLogs で React 状態を更新 */
  const flushStepLogs = () => {
    setLiveStepLogs([...stepLogs]);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6);
      try {
        const msg: SSEMessage = JSON.parse(jsonStr);

        if (msg.type === "checkpoint") {
          lastCheckpointId = msg.id as string;
        } else if (msg.type === "rate_limit") {
          // レートリミット待機中 — フロントエンドに状況表示
          if (setRateLimitInfo) {
            setRateLimitInfo({
              retryCount: msg.retryCount ?? 0,
              maxRetries: msg.maxRetries ?? 3,
              waitMs: msg.waitMs ?? 1000,
            });
          }
        } else if (msg.type === "continuation") {
          // 自動継続ラウンド開始 — フロントエンドの表示を更新
          const round = msg.round ?? 0;
          const maxRounds = msg.maxRounds ?? 0;
          if (setContinuationRound) setContinuationRound(round);
          if (setMaxContinuations) setMaxContinuations(maxRounds);
        } else if (msg.type === "step_progress") {
          currentStep = msg.step ?? currentStep;
          maxSteps = msg.maxSteps ?? maxSteps;
          setStep(currentStep);
          setMaxSteps(maxSteps);
          // 自動継続ラウンド情報を更新
          if (msg.continuationRound !== undefined && setContinuationRound) {
            setContinuationRound(msg.continuationRound);
          }
          if (msg.maxContinuations !== undefined && setMaxContinuations) {
            setMaxContinuations(msg.maxContinuations);
          }
        } else if (msg.type === "tool_call") {
          // バッファから同名ツールの tool_result を探す
          const matchIdx = pendingResults.findIndex((r) => r.toolName === msg.toolName);
          const matched = matchIdx >= 0 ? pendingResults.splice(matchIdx, 1)[0] : undefined;

          const step = msg.step ?? currentStep;
          const entry: StepLogEntry = {
            step,
            toolName: msg.toolName ?? "unknown",
            args: (msg.args ?? {}) as Record<string, unknown>,
            result: matched?.result,
            detail: matched?.detail,
            // 結果がマッチしたら成功、なければ実行中
            status: matched ? "success" : "running",
          };
          stepLogs.push(entry);
          flushStepLogs();

          if (msg.step) setStep(msg.step);
        } else if (msg.type === "tool_result") {
          // ツール名が一致する既存の (running で未完了の) エントリを更新
          const openEntry = stepLogs.find(
            (e) => e.toolName === msg.toolName && e.status === "running" && !e.result,
          );
          if (openEntry) {
            openEntry.result = msg.result;
            openEntry.detail = msg.detail;
            openEntry.status = "success";
            flushStepLogs();
          } else {
            // まだ tool_call が来ていないのでバッファ
            pendingResults.push({
              toolName: msg.toolName ?? "unknown",
              result: msg.result ?? "",
              detail: msg.detail,
            });
          }
        } else if (msg.type === "text") {
          fullText = msg.text ?? "";
          // Clear rate limit indicator since generation produced output
          if (setRateLimitInfo) setRateLimitInfo(null);
        } else if (msg.type === "error") {
          // If the abort was already triggered (stop button / unmount),
          // the server's "aborted" error event is a race condition artifact.
          // Ignore it — the AbortError from reader.read() follows shortly.
          if (!abortRef.current) continue;
          sawError = true;
          if (setRateLimitInfo) setRateLimitInfo(null);
          throw new Error(msg.error);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  abortRef.current = null;
  // Clear rate limit indicator once the stream is fully consumed
  if (setRateLimitInfo) setRateLimitInfo(null);

  // ── Check for stale "running" entries ──────────────────────────────
  // If the stream ended but some tool calls never received a matching
  // tool_result (e.g. tool execution threw before sending tool_result,
  // or the connection was interrupted), those entries would be stuck in
  // "running" state forever. Mark them as "error" so the log is accurate.
  let hasStaleRunning = false;
  for (const entry of stepLogs) {
    if (entry.status === "running") {
      entry.status = "error";
      entry.result = entry.result || "⚠️ ストリームが完了しましたが、ツールの結果が取得できませんでした";
      hasStaleRunning = true;
    }
  }
  if (hasStaleRunning) flushStepLogs();

  if (fullText) {
    addMessage({
      id: `msg-bot-${Date.now()}`,
      role: "assistant",
      content: fullText,
      timestamp: Date.now(),
      checkpointId: lastCheckpointId,
      stepLogs,
    });
    setLiveStepLogs([]);
    setWorkspaceReady(true);
    return true;
  }

  // AI produced no text output — don't set workspaceReady(true) since nothing changed
  setLiveStepLogs([]);

  if (sawError) {
    return false; // error already handled by caller
  }

  console.warn("[chat] Sidecar returned empty text — no output produced");
  return false;
}
