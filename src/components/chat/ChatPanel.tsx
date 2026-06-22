import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StepLogPanel } from "@/components/chat/StepLogPanel";
import { PhaseDetailPanel } from "@/components/chat/PhaseDetailPanel";
import { MessageSquare, Bot, Loader2, ChevronDown, ChevronLeft, ChevronRight, History, Clock, Search, X, WifiOff } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/types";
import { getMessageCountForCheckpoint, restoreCheckpoint } from "@/lib/checkpoint-utils";
import { useChatStream } from "@/hooks/useChatStream";
import { previewManager } from "@/lib/preview";
import type { PreviewStatus } from "@/lib/preview";

const useChatSSE = useChatStream;

export function ChatPanel() {
  const messages = useAppStore((s) => s.messages);
  const visibleMessageCount = useAppStore((s) => s.visibleMessageCount);
  const checkpoints = useAppStore((s) => s.checkpoints);
  const currentCheckpointIndex = useAppStore((s) => s.currentCheckpointIndex);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const agentStepCount = useAppStore((s) => s.agentStepCount);
  const agentMaxSteps = useAppStore((s) => s.agentMaxSteps);
  const aiConfig = useAppStore((s) => s.aiConfig);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const projects = useAppStore((s) => s.projects);
  const projectSwitching = useAppStore((s) => s.projectSwitching);
  const fetchChatHistory = useAppStore((s) => s.fetchChatHistory);
  const initialized = useAppStore((s) => s.initialized);
  const { t } = useTranslation();

  // Preview status (for chat indicator)
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");

  useEffect(() => {
    const unsub = previewManager.onStateChange((state) => {
      setPreviewStatus(state.status);
    });
    return unsub;
  }, []);

  // SSE streaming state (抽出されたフック)
  const {
    liveStepLogs,
    phaseOutputs,
    continuationRound,
    maxContinuations,
    rateLimitInfo,
    startGeneration,
    handleStop,
  } = useChatSSE();

  // ── Search state ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // ── Load chat history when project is confirmed ─────────────
  useEffect(() => {
    if (initialized && currentProjectId) {
      fetchChatHistory();
    }
  }, [initialized, currentProjectId, fetchChatHistory]);

  // When the preview slider has navigated back, only show the messages that
  // existed at that checkpoint. visibleMessageCount = -1 means "show all".
  const baseMessages =
    visibleMessageCount >= 0
      ? messages.slice(0, visibleMessageCount)
      : messages;

  // Search filter
  const searchLower = searchQuery.toLowerCase().trim();
  const filteredMessages = searchLower
    ? baseMessages.filter(
        (m) =>
          m.content.toLowerCase().includes(searchLower) ||
          (m.role === "assistant" && m.stepLogs?.some((log) =>
            log.toolName.toLowerCase().includes(searchLower) ||
            (log.result && log.result.toLowerCase().includes(searchLower))
          ))
      )
    : baseMessages;

  const displayMessages = filteredMessages;

  // IDs of matched messages (for navigation)
  const matchedMessageIds = searchQuery.trim()
    ? displayMessages.map((m) => m.id)
    : [];

  // Reset currentMatchIndex when search changes
  const prevSearchRef = useRef(searchQuery);
  useEffect(() => {
    if (prevSearchRef.current !== searchQuery) {
      setCurrentMatchIndex(0);
      prevSearchRef.current = searchQuery;
    }
  }, [searchQuery]);

  // Clamp match index
  useEffect(() => {
    if (currentMatchIndex >= matchedMessageIds.length) {
      setCurrentMatchIndex(Math.max(0, matchedMessageIds.length - 1));
    }
  }, [matchedMessageIds.length, currentMatchIndex]);

  // Scroll to the current match
  const scrollToMatch = useCallback(
    (index: number) => {
      const id = matchedMessageIds[index];
      if (!id) return;
      const el = document.getElementById(`chat-msg-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [matchedMessageIds],
  );

  const goToNextMatch = useCallback(() => {
    if (matchedMessageIds.length === 0) return;
    const next = (currentMatchIndex + 1) % matchedMessageIds.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  }, [matchedMessageIds.length, currentMatchIndex, scrollToMatch]);

  const goToPrevMatch = useCallback(() => {
    if (matchedMessageIds.length === 0) return;
    const prev = (currentMatchIndex - 1 + matchedMessageIds.length) % matchedMessageIds.length;
    setCurrentMatchIndex(prev);
    scrollToMatch(prev);
  }, [matchedMessageIds.length, currentMatchIndex, scrollToMatch]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
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

  const handleScroll = useCallback(() => {
    const atBottom = checkIsAtBottom();
    setIsAtBottom(atBottom);
    if (atBottom) {
      setShowScrollButton(false);
    } else if (agentStatus === "running" || liveStepLogs.length > 0) {
      setShowScrollButton(true);
    }
  }, [checkIsAtBottom, agentStatus, liveStepLogs.length]);

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom(false);
    } else if (displayMessages.length > 0 || liveStepLogs.length > 0) {
      setShowScrollButton(true);
    }
  }, [messages, liveStepLogs, isAtBottom, scrollToBottom]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      useAppStore.getState().setAgentStatus("idle");
    };
  }, []);

  // ── Edit & Regenerate ─────────────────────────────────────────────

  const handleEdit = useCallback(
    async (id: string, newContent: string) => {
      const { messages: msgs, updateMessage, truncateMessages, setWorkspaceReady, fetchCheckpoints, setCurrentCheckpointIndex, addMessage } = useAppStore.getState();
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx === -1) return;

      const prevAssistantMsg = msgs.slice(0, idx).reverse().find((m) => m.role === "assistant");
      if (prevAssistantMsg?.checkpointId) {
        try {
          setWorkspaceReady(false);
          await restoreCheckpoint(prevAssistantMsg.checkpointId);
          // 直ちにプレビューを復元後のファイル状態に同期する
          useAppStore.getState().triggerReload();
        } catch (e) {
          console.warn("[chat] Failed to restore checkpoint:", e);
          setWorkspaceReady(true);
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: t('chat.checkpointRestoreFailed', { error: e instanceof Error ? e.message : String(e) }),
            timestamp: Date.now(),
          });
          return;
        }
      }

      updateMessage(id, { content: newContent });
      truncateMessages(idx + 1);
      useAppStore.getState().setVisibleMessageCount(-1);
      await fetchCheckpoints();
      setCurrentCheckpointIndex(useAppStore.getState().checkpoints.length - 1);

      const history = [...useAppStore.getState().messages];
      await startGeneration(history);
    },
    [startGeneration],
  );

  const handleRetry = useCallback(
    async (id: string) => {
      const state = useAppStore.getState();
      const { messages: msgs, truncateMessages, setWorkspaceReady, fetchCheckpoints, setCurrentCheckpointIndex, addMessage } = state;
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx === -1) return;

      const prevAssistantMsg = msgs.slice(0, idx).reverse().find((m) => m.role === "assistant");
      if (prevAssistantMsg?.checkpointId) {
        try {
          setWorkspaceReady(false);
          await restoreCheckpoint(prevAssistantMsg.checkpointId);
          // 直ちにプレビューを復元後のファイル状態に同期する
          useAppStore.getState().triggerReload();
        } catch (e) {
          console.warn("[chat] Failed to restore checkpoint:", e);
          setWorkspaceReady(true);
          addMessage({
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: t('chat.checkpointRestoreFailed', { error: e instanceof Error ? e.message : String(e) }),
            timestamp: Date.now(),
          });
          return;
        }
      }

      truncateMessages(idx + 1);
      useAppStore.getState().setVisibleMessageCount(-1);
      await fetchCheckpoints();
      setCurrentCheckpointIndex(useAppStore.getState().checkpoints.length - 1);

      const history = [...useAppStore.getState().messages];
      await startGeneration(history);
    },
    [startGeneration],
  );

  // ── Send new message ──────────────────────────────────────────────

  const handleSend = useCallback(
    async (content: string) => {
      const state = useAppStore.getState();
      const { messages: allMsgs, visibleMessageCount: vmc, checkpoints, currentCheckpointIndex: cpIdx } = state;

      if (vmc >= 0 && vmc < allMsgs.length) {
        state.truncateMessages(vmc);
        state.setVisibleMessageCount(-1);

        if (cpIdx >= 0 && cpIdx < checkpoints.length) {
          try {
            const { deleteCheckpointsAfter } = await import("@/engine/tool-executors");
            const pid = useAppStore.getState().currentProjectId;
            if (pid) await deleteCheckpointsAfter(pid, checkpoints[cpIdx].id);
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
      setAgentStepCount(0);

      const currentMessages = [...useAppStore.getState().messages];
      await startGeneration(currentMessages);
    },
    [startGeneration],
  );

  // ── Navigate to a specific checkpoint from chat ────────────────────

  const handleNavigateToCheckpoint = useCallback(async (checkpointIndex: number) => {
    const state = useAppStore.getState();
    const { checkpoints: cps, setWorkspaceReady, setCurrentCheckpointIndex, setVisibleMessageCount, triggerReload, messages: msgs } = state;
    const cp = cps[checkpointIndex];
    if (!cp) return;

    setWorkspaceReady(false);
    setCurrentCheckpointIndex(checkpointIndex);

    const msgCount = getMessageCountForCheckpoint(cps, msgs, checkpointIndex);
    if (msgCount >= msgs.length) {
      setVisibleMessageCount(-1);
    } else {
      setVisibleMessageCount(msgCount);
    }

    try {
      const { restoreCheckpoint } = await import("@/engine/tool-executors");
      const pid = useAppStore.getState().currentProjectId;
      if (pid) await restoreCheckpoint(pid, cp.id);
      // プレビューを復元後のファイル状態に同期する
      setWorkspaceReady(true);
      triggerReload();
    } catch (e) {
      console.warn("[chat] Failed to navigate to checkpoint:", e);
      setWorkspaceReady(true);
    }
  }, []);

  // ── Message grouping ──────────────────────────────────────────────

  const messagesWithGrouping = displayMessages.map((msg, i) => {
    const prevMsg = i > 0 ? displayMessages[i - 1] : null;
    const showAvatar = !prevMsg || prevMsg.role !== msg.role;

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

    return { ...msg, showAvatar, checkpointLabel, checkpointIndex, checkpointCount };
  });

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
        <span className="text-sm font-medium">{t('chat.title')}</span>

        {currentProjectId && !projectSwitching && (
          <div className="flex items-center gap-1 border-l border-border/40 pl-2">
            {checkpoints.length > 0 ? (
              <>
                <button
                  onClick={() => handleNavigateToCheckpoint(currentCheckpointIndex - 1)}
                  disabled={currentCheckpointIndex <= 0 || agentStatus === "running"}
                  className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
                  title={t('chat.prevState')}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-muted-foreground tabular-nums min-w-[2.5rem] text-center select-none">
                  {currentCheckpointIndex + 1}/{checkpoints.length}
                </span>
                <button
                  onClick={() => handleNavigateToCheckpoint(currentCheckpointIndex + 1)}
                  disabled={currentCheckpointIndex >= checkpoints.length - 1 || agentStatus === "running"}
                  className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
                  title={t('chat.nextState')}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground tabular-nums min-w-[2.5rem] text-center select-none">
                0/0
              </span>
            )}
          </div>
        )}

        {visibleMessageCount >= 0 && (
          <div className="flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5">
            <History className="h-3 w-3 text-amber-500/70" />
              <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80 font-medium">{t('chat.history')}</span>
            </div>
          )}

          {/* Search button */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`ml-auto h-6 w-6 flex items-center justify-center rounded transition-colors ${
              showSearch ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
            title={t('chat.searchChat')}
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {rateLimitInfo && (
          <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Clock className="h-3 w-3 animate-pulse" />
            {t('chat.rateLimit', { waitMs: rateLimitInfo.waitMs, retryCount: rateLimitInfo.retryCount, maxRetries: rateLimitInfo.maxRetries })}
          </span>
        )}
        {agentStatus === "running" && !rateLimitInfo && (
          <span className="ml-auto text-xs text-muted-foreground animate-pulse flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {agentStepCount > 0
              ? `Step ${agentStepCount}/${agentMaxSteps}${continuationRound > 0 ? ` (${t('chat.continuation', { round: continuationRound, max: maxContinuations })})` : ""}: ${t('chat.generating')}`
              : t('chat.aiGenerating')}
          </span>
        )}
        {agentStatus !== "running" && (previewStatus === "booting" || previewStatus === "installing" || previewStatus === "starting-dev" || previewStatus === "syncing") && (
          <span className="ml-auto text-xs text-muted-foreground/60 flex items-center gap-1">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {previewStatus === "booting" && t("preview.statusBooting")}
            {previewStatus === "installing" && t("preview.statusInstalling")}
            {previewStatus === "starting-dev" && t("preview.statusStartingDev")}
            {previewStatus === "syncing" && t("preview.statusSyncing")}
          </span>
        )}
        {agentStatus !== "running" && previewStatus === "error" && (
          <span className="ml-auto text-xs text-destructive/60 flex items-center gap-1">
            <WifiOff className="h-2.5 w-2.5" />
            {t("preview.previewError")}
          </span>
        )}
      </div>

      {/* History mode banner (always visible above scroll area) */}
      {visibleMessageCount >= 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/5 border-b border-amber-500/10 shrink-0">
          <History className="h-3 w-3 text-amber-500/60 shrink-0" />
          <span className="text-[11px] text-amber-600/70 dark:text-amber-400/70">
            {t('chat.viewingHistory', { index: currentCheckpointIndex + 1, total: checkpoints.length })}
          </span>
          <button
            onClick={() => handleNavigateToCheckpoint(checkpoints.length - 1)}
            className="ml-auto text-[11px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors"
          >
            {t('chat.backToLatest')}
          </button>
        </div>
      )}

      {/* Search bar (always visible above scroll area) */}
      {showSearch && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 shrink-0 bg-background/95 backdrop-blur-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentMatchIndex(0);
            }}
            placeholder={t('chat.searchPlaceholder')}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowSearch(false);
                setSearchQuery("");
              }
              if (e.key === "Enter") {
                e.shiftKey ? goToPrevMatch() : goToNextMatch();
              }
            }}
          />
          {searchQuery && (
            <>
              {/* Match count */}
              {matchedMessageIds.length > 0 ? (
                <span className="text-[10px] text-muted-foreground/50 tabular-nums whitespace-nowrap">
                  {currentMatchIndex + 1} / {matchedMessageIds.length}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground/50">
                  {t('chat.zeroResults')}
                </span>
              )}

              {/* Navigation arrows */}
              {matchedMessageIds.length > 1 && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={goToPrevMatch}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title={t('chat.prevMatch')}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <button
                    onClick={goToNextMatch}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title={t('chat.nextMatch')}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              )}

              <button
                onClick={() => setSearchQuery("")}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground transition-colors"
                title={t('chat.clearSearch')}
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Scrollable messages area */}
      <div className="relative flex-1 overflow-hidden">

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
                  <h3 className="text-sm font-medium mb-1">{t('project.switching')}</h3>
                  <p className="text-xs text-muted-foreground">{t('project.switchingDesc')}</p>
                </>
              ) : currentProjectId ? (
                <>
                  <h3 className="text-sm font-medium mb-1">
                    {projects.find((p) => p.id === currentProjectId)?.name || t('project.label')} — {t('chat.deskspawnChat')}
                  </h3>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    {t('chat.emptyStatePrompt')}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-medium mb-1">{t('chat.deskspawnChat')}</h3>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    {t('chat.emptyStateNoProject')}
                  </p>
                </>
              )}
              <p className="text-xs text-muted-foreground/60 mt-2">
                {aiConfig
                  ? `${aiConfig.provider} ${aiConfig.model} ${t('chat.inUse')}`
                  : t('chat.aiNotConfigured')}
              </p>
              {currentProjectId && (
                <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                  {[t('chat.suggestion.calendarApp'), t('chat.suggestion.todoApp'), t('chat.suggestion.darkMode'), t('chat.suggestion.timerFeature')].map((s) => (
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
                <div key={msg.id}>
                  <ChatMessage
                    message={msg}
                    showAvatar={msg.showAvatar}
                    onEdit={msg.role === "user" ? handleEdit : undefined}
                    onRegenerate={msg.role === "user" && i === lastUserMsgIndex ? () => handleRetry(msg.id) : undefined}
                    checkpointLabel={(msg as any).checkpointLabel}
                    checkpointIndex={(msg as any).checkpointIndex}
                    checkpointCount={(msg as any).checkpointCount}
                    onNavigateToCheckpoint={handleNavigateToCheckpoint}
                    searchQuery={searchQuery || undefined}
                    isMatch={matchedMessageIds.length > 0 && matchedMessageIds.includes(msg.id)}
                    isActiveMatch={matchedMessageIds.length > 0 && matchedMessageIds[currentMatchIndex] === msg.id}
                  />
                  {msg.phaseOutputs && msg.phaseOutputs.length > 0 && (
                    <PhaseDetailPanel phaseOutputs={msg.phaseOutputs} />
                  )}
                </div>
              ))}

              {agentStatus === "running" && Object.keys(phaseOutputs).length > 0 && (
                <div className="pl-11">
                  <PhaseDetailPanel
                    phaseOutputs={Object.entries(phaseOutputs).map(([phase, { label, text }]) => ({ phase, label, text }))}
                  />
                </div>
              )}

              {liveStepLogs.length > 0 && (
                <div className="pl-11">
                  <StepLogPanel stepLogs={liveStepLogs} isLive searchQuery={searchQuery || undefined} />
                </div>
              )}

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

              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

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
            {t('chat.scrollToLatest')}
          </button>
        )}
      </div>

      <ChatInput onSend={handleSend} onStop={handleStop} />
    </div>
  );
}


