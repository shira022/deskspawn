import { useAppStore } from "@/store/useAppStore";
import { Monitor, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPanel() {
  const { vitePort, workspaceReady } = useAppStore();

  const previewUrl = `http://localhost:${vitePort}`;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-2 border-b px-3">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">ライブプレビュー</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement;
              iframe?.contentWindow?.location.reload();
            }}
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
            id="preview-iframe"
            src={previewUrl}
            className="h-full w-full border-none"
            title="App Preview"
            sandbox="allow-scripts allow-same-origin"
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
              Vite dev server: {previewUrl}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
