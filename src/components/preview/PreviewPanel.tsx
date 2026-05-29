import { useAppStore } from "@/store/useAppStore";
import { useRef, useEffect, useCallback, useState } from "react";
import { Monitor, Maximize2, Minimize2, RefreshCw, AlertCircle, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMessageCountForCheckpoint } from "@/lib/checkpoint-utils";
import { SIDECAR_BASE } from "@/lib/constants";

export function PreviewPanel() {
  const {
    workspacePort,
    workspaceReady,
    setWorkspaceReady,
    currentProjectId,
    projectSwitching,
    setProjectSwitching,
    appLoading,
    setAppLoading,
    checkpoints,
    currentCheckpointIndex,
    setCurrentCheckpointIndex,
    fetchCheckpoints,
    reloadCounter,
    previewMaximized,
    togglePreviewMaximized,
  } = useAppStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const versionRef = useRef(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);

  const previewUrl = `http://localhost:${workspacePort}`;

  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      versionRef.current += 1;
      iframeRef.current.src = `${previewUrl}?_v=${versionRef.current}`;
    }
  }, [previewUrl]);

  // Clear the iframe to about:blank when project switching/loading starts,
  // so old content never flashes while the new dev server starts up.
  const clearIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = "about:blank";
    }
  }, []);

  const prevProjectId = useRef<string | null>(null);
  useEffect(() => {
    if (currentProjectId && currentProjectId !== prevProjectId.current) {
      // Project just changed — clear iframe immediately
      clearIframe();
    }
    prevProjectId.current = currentProjectId;
  }, [currentProjectId, clearIframe]);

  // ── Checkpoint navigation ──────────────────────────────────────────

  const canGoBack = currentCheckpointIndex > 0 && checkpoints.length > 0;
  const canGoForward = currentCheckpointIndex < checkpoints.length - 1;

  // Clear navigating state when dev server comes back after a checkpoint restore
  const wasNavigating = useRef(false);
  useEffect(() => {
    if (navigating) {
      wasNavigating.current = true;
    }
    if (wasNavigating.current && workspaceReady) {
      wasNavigating.current = false;
      setNavigating(false);
    }
  }, [workspaceReady, navigating]);

  const handleNavigate = useCallback(
    async (direction: "back" | "forward") => {
      const nextIndex =
        direction === "back"
          ? currentCheckpointIndex - 1
          : currentCheckpointIndex + 1;

      if (nextIndex < 0 || nextIndex >= checkpoints.length) return;

      const cp = checkpoints[nextIndex];
      if (!cp) return;

      setNavigating(true);
      setWorkspaceReady(false);
      setCurrentCheckpointIndex(nextIndex);

      // Sync the chat panel to show only the messages that existed at this checkpoint
      const { messages } = useAppStore.getState();
      const msgCount = getMessageCountForCheckpoint(checkpoints, messages, nextIndex);
      // If navigating to the latest state, show all messages (-1 = all)
      if (msgCount >= messages.length) {
        useAppStore.getState().setVisibleMessageCount(-1);
      } else {
        useAppStore.getState().setVisibleMessageCount(msgCount);
      }

      try {
        const res = await fetch(`${SIDECAR_BASE}/projects/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkpointId: cp.id }),
        });
        if (!res.ok) {
          console.warn("[preview] Failed to restore checkpoint:", await res.text());
        }
      } catch (e) {
        console.warn("[preview] Failed to restore checkpoint:", e);
      }
    },
    [checkpoints, currentCheckpointIndex, setCurrentCheckpointIndex, setWorkspaceReady],
  );

  // Fetch checkpoints on mount and when project changes
  useEffect(() => {
    fetchCheckpoints();
  }, [currentProjectId, fetchCheckpoints]);

  // Set initial checkpoint index to latest when checkpoints first load
  useEffect(() => {
    if (currentCheckpointIndex === -1 && checkpoints.length > 0) {
      setCurrentCheckpointIndex(checkpoints.length - 1);
    }
  }, [checkpoints, currentCheckpointIndex, setCurrentCheckpointIndex]);

  // Reload iframe when triggered by new generation (reloadCounter incremented)
  const prevReloadCounter = useRef(reloadCounter);
  useEffect(() => {
    if (reloadCounter > 0 && reloadCounter !== prevReloadCounter.current) {
      prevReloadCounter.current = reloadCounter;
      handleReload();
    }
  }, [reloadCounter, handleReload]);

  // Poll for workspace dev server readiness when not ready
  useEffect(() => {
    if (workspaceReady) {
      setLoading(false);
      setPollingTimedOut(false);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (!currentProjectId) {
      // No project selected — not loading
      setLoading(false);
      setPollingTimedOut(false);
      return;
    }

    setLoading(true);
    let attempts = 0;

    const poll = async () => {
      try {
        const res = await fetch(`${SIDECAR_BASE}/projects/ready`);
        const data = await res.json();
        if (data.ready) {
          // Use the actual port reported by the sidecar (may differ from default 5174
          // if the port was already in use)
          if (typeof data.port === 'number' && data.port !== useAppStore.getState().workspacePort) {
            useAppStore.getState().setWorkspacePort(data.port);
          }
          setWorkspaceReady(true);
          setLoading(false);
          setPollingTimedOut(false);
          // Clear any pending loading states now that workspace is ready
          setAppLoading(false);
          setProjectSwitching(false);
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          // Trigger iframe reload
          setTimeout(() => handleReload(), 500);
        }
      } catch {
        // Server not ready yet
      }
      attempts++;
      if (attempts > 60) {
        // Timeout after ~90s — clear loading states and show error
        setLoading(false);
        setPollingTimedOut(true);
        setAppLoading(false);
        setProjectSwitching(false);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    };

    // Poll immediately, then every 1.5s
    poll();
    pollingRef.current = setInterval(poll, 1500);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [workspaceReady, currentProjectId, setWorkspaceReady, setAppLoading, setProjectSwitching, handleReload]);

  // Auto-reload when workspace changes (code generation completes)
  useEffect(() => {
    if (workspaceReady) {
      handleReload();
    }
  }, [workspaceReady, handleReload]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-2 border-b px-3">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">ライブプレビュー</span>
        <span className="text-xs text-muted-foreground/50">:{workspacePort}</span>

        {/* Checkpoint navigation */}
        {checkpoints.length > 0 && (
          <div className="flex items-center gap-1 ml-2 border-l border-border/40 pl-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handleNavigate("back")}
              disabled={!canGoBack || navigating}
              title="1つ前の状態に戻る"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[2.5rem] text-center select-none">
              {currentCheckpointIndex + 1}/{checkpoints.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handleNavigate("forward")}
              disabled={!canGoForward || navigating}
              title="1つ先の状態に進む"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleReload}
            title="リロード"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={togglePreviewMaximized}
            title={previewMaximized ? "元に戻す" : "プレビューを最大化"}
          >
            {previewMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Preview Content */}
      <div className="flex-1 bg-white relative">
        {workspaceReady || currentProjectId ? (
          <>
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className={`h-full w-full border-none ${projectSwitching || appLoading || (!workspaceReady && currentProjectId) || navigating || loading ? "invisible" : ""}`}
              title="App Preview"
            />
            {(projectSwitching || appLoading || loading || navigating || (!workspaceReady && currentProjectId)) && (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <div className="rounded-lg bg-card border p-6 shadow-lg flex flex-col items-center gap-3 max-w-xs text-center">
                  {pollingTimedOut ? (
                    <AlertCircle className="h-6 w-6 text-destructive" />
                  ) : (
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {pollingTimedOut
                        ? "プレビューの起動に失敗しました"
                        : navigating
                          ? "チェックポイントを復元しています"
                          : appLoading
                            ? "新しいアプリを準備しています..."
                            : projectSwitching
                              ? "プロジェクトを切り替えています"
                              : loading
                                ? "アプリサーバーを起動しています..."
                                : "準備中..."}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {pollingTimedOut
                        ? "開発サーバーの応答がありません。プロジェクトを切り替えて再試行してください。"
                        : navigating
                          ? "ファイルを復元し、開発サーバーを再起動しています"
                          : appLoading
                            ? "依存関係のインストールと開発サーバーの起動を行っています"
                            : projectSwitching
                              ? "開発サーバーを再起動しています"
                              : loading
                                ? "Vite 開発サーバーが起動するのを待っています"
                                : ""}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {/* Error banner for timed-out state even when workspaceReady is false */}
            {pollingTimedOut && !workspaceReady && (
              <div className="absolute bottom-3 left-3 right-3">
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive text-center">
                  開発サーバーが応答しません。プロジェクト一覧から別のアプリを選択して再試行してください。
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Monitor className="h-8 w-8" />
            </div>
            <h3 className="text-sm font-medium mb-1">プレビュー準備中</h3>
            <p className="text-xs text-center max-w-xs">
              チャットでアプリのコードを生成すると、
              ここにリアルタイムプレビューが表示されます。
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              workspace port: {workspacePort}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
