import { useAppStore } from "@/store/useAppStore";
import { useRef, useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Maximize2, Minimize2, RefreshCw, AlertCircle, Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Smartphone, Tablet, Monitor as MonitorIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMessageCountForCheckpoint } from "@/lib/checkpoint-utils";
import { sidecarBase } from "@/lib/constants";

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
  const [zoom, setZoom] = useState(1);
  const [devicePreset, setDevicePreset] = useState<string | null>(null);
  const { t } = useTranslation();

  const devicePresets: Record<string, { width: number; height: number; label: string; icon: React.ReactNode }> = {
    mobile: { width: 375, height: 812, label: "Mobile", icon: <Smartphone className="h-3.5 w-3.5" /> },
    tablet: { width: 768, height: 1024, label: "Tablet", icon: <Tablet className="h-3.5 w-3.5" /> },
    desktop: { width: 1280, height: 800, label: "Desktop", icon: <MonitorIcon className="h-3.5 w-3.5" /> },
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.1, 2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.25));
  const handleZoomReset = () => { setZoom(1); setDevicePreset(null); };

  const handleDevicePreset = (key: string | null) => {
    if (devicePreset === key) {
      setDevicePreset(null);
    } else {
      setDevicePreset(key);
    }
  };

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
        const res = await fetch(`${sidecarBase()}/projects/restore`, {
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
        const res = await fetch(`${sidecarBase()}/projects/ready`);
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
        <span className="text-sm font-medium">{t('preview.title')}</span>
        <span className="text-xs text-muted-foreground/50">:{workspacePort}</span>

        {/* Checkpoint navigation */}
        {currentProjectId && !projectSwitching && (
          <div className="flex items-center gap-1 ml-2 border-l border-border/40 pl-2">
            {checkpoints.length > 0 ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleNavigate("back")}
                  disabled={!canGoBack || navigating}
                  title={t('chat.prevState')}
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
                  title={t('chat.nextState')}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground tabular-nums min-w-[2.5rem] text-center select-none">
                0/0
              </span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {/* Device presets */}
          {Object.entries(devicePresets).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => handleDevicePreset(key)}
              className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                devicePreset === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
              title={preset.label}
            >
              {preset.icon}
            </button>
          ))}

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 border-l border-border/40 pl-1 ml-1">
            <button
              onClick={handleZoomOut}
              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t('preview.zoomOut')}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleZoomReset}
              className="h-7 min-w-[2.5rem] px-1 flex items-center justify-center rounded text-[10px] tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t('preview.zoomReset')}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t('preview.zoomIn')}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleReload}
            title={t('preview.reload')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={togglePreviewMaximized}
            title={previewMaximized ? t('preview.restore') : t('preview.maximize')}
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
      <div className="flex-1 bg-white relative overflow-hidden">
        {workspaceReady || currentProjectId ? (
          <>
            <div
              className="flex items-start justify-center w-full h-full overflow-auto"
              style={{
                padding: devicePreset ? "16px" : "0",
                background: devicePreset ? "repeating-conic-gradient(rgba(0,0,0,0.03) 0% 25%, transparent 0% 50%) 0 0 / 20px 20px" : undefined,
              }}
            >
              <div
                style={{
                  transform: devicePreset ? `scale(${zoom})` : `scale(${zoom})`,
                  transformOrigin: "top center",
                  width: devicePreset ? `${devicePresets[devicePreset].width}px` : "100%",
                  height: devicePreset ? `${devicePresets[devicePreset].height}px` : "100%",
                  minWidth: devicePreset ? `${devicePresets[devicePreset].width}px` : undefined,
                  transition: "width 0.2s ease, height 0.2s ease",
                  boxShadow: devicePreset ? "0 4px 24px rgba(0,0,0,0.15)" : "none",
                  borderRadius: devicePreset === "mobile" ? "24px" : devicePreset === "tablet" ? "8px" : "0",
                  overflow: "hidden",
                }}
              >
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className={`h-full w-full border-none ${projectSwitching || appLoading || (!workspaceReady && currentProjectId) || navigating || loading ? "invisible" : ""}`}
                  title="App Preview"
                  style={{
                    width: devicePreset ? `${devicePresets[devicePreset].width}px` : "100%",
                    height: devicePreset ? `${devicePresets[devicePreset].height}px` : "100%",
                  }}
                />
              </div>
            </div>
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
                        ? t('preview.startFailed')
                        : navigating
                          ? t('preview.restoringCheckpoint')
                          : appLoading
                            ? t('preview.preparingApp')
                            : projectSwitching
                              ? t('preview.switchingProject')
                              : loading
                                ? t('preview.startingServer')
                                : t('preview.preparing')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {pollingTimedOut
                        ? t('preview.serverNoResponse')
                        : navigating
                          ? t('preview.restoringFiles')
                          : appLoading
                            ? t('preview.installingDeps')
                            : projectSwitching
                              ? t('preview.restartingServer')
                              : loading
                                ? t('preview.waitingForVite')
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
                  {t('preview.serverNotResponding')}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Monitor className="h-8 w-8" />
            </div>
            <h3 className="text-sm font-medium mb-1">{t('preview.notReady')}</h3>
            <p className="text-xs text-center max-w-xs">
              {t('preview.notReadyDesc')}
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
