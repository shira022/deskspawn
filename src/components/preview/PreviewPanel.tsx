import { useAppStore } from "@/store/useAppStore";
import { useRef, useEffect, useCallback } from "react";
import { Monitor, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPanel() {
  const { workspacePort, workspaceReady } = useAppStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const versionRef = useRef(0);

  const previewUrl = `http://localhost:${workspacePort}`;

  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      versionRef.current += 1;
      iframeRef.current.src = `${previewUrl}?_v=${versionRef.current}`;
    }
  }, [previewUrl]);

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
      <div className="flex-1 bg-white">
        {workspaceReady ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            className="h-full w-full border-none"
            title="App Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          />
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
