import { useAppStore } from "@/store/useAppStore";
import { useRef, useEffect, useCallback, useState } from "react";
import { Monitor, ExternalLink, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const SIDECAR_BASE = "http://localhost:3001";

export function PreviewPanel() {
  const { workspacePort, workspaceReady, setWorkspaceReady, currentProjectId } = useAppStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const versionRef = useRef(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loading, setLoading] = useState(false);

  const previewUrl = `http://localhost:${workspacePort}`;

  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      versionRef.current += 1;
      iframeRef.current.src = `${previewUrl}?_v=${versionRef.current}`;
    }
  }, [previewUrl]);

  // Poll for workspace dev server readiness when not ready
  useEffect(() => {
    if (workspaceReady) {
      setLoading(false);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (!currentProjectId) return;

    setLoading(true);
    let attempts = 0;

    const poll = async () => {
      try {
        const res = await fetch(`${SIDECAR_BASE}/projects/ready`);
        const data = await res.json();
        if (data.ready) {
          setWorkspaceReady(true);
          setLoading(false);
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
        // Timeout after ~60s
        setLoading(false);
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
  }, [workspaceReady, currentProjectId, setWorkspaceReady, handleReload]);

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
            onClick={() => window.open(previewUrl, "_blank")}
            title="ブラウザで開く"
          >
            <ExternalLink className="h-3.5 w-3.5" />
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
              className="h-full w-full border-none"
              title="App Preview"
            />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <div className="rounded-lg bg-background border p-4 shadow-lg flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <div>
                    <p className="text-sm font-medium">プレビュー準備中</p>
                    <p className="text-xs text-muted-foreground">アプリサーバーを起動しています...</p>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <AlertCircle className="h-8 w-8" />
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
