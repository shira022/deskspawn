/**
 * PreviewPanel — プレビュー表示パネル
 *
 * WebContainer を使ってプロジェクトの Vite Dev Server を起動し、
 * iframe 内にプレビューを表示する。
 *
 * 動作:
 * 1. プロジェクト選択時に WebContainer を起動 (boot → mount → install → dev)
 * 2. コード変更時にファイルを同期 (sync → 必要なら npm install)
 * 3. Vite HMR が差分を自動反映
 * 4. iframe に Dev Server の URL を表示
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Wifi,
  WifiOff,
  Package,
  Terminal,
  Smartphone,
  Tablet,
  Monitor,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { previewManager } from "@/lib/preview";
import type { PreviewStatus } from "@/lib/preview";
import { checkCompatibility } from "@/lib/compatibility";

// ── Device Presets ─────────────────────────────────────────────────────────────

/** Presets that can be toggled on/off. `null` = auto-fit (fill available width). */
type DevicePreset = "tablet" | "mobile";

interface DevicePresetDef {
  label: string;
  width: number;
  height: number;
}

const DEVICE_PRESETS: Record<DevicePreset, DevicePresetDef> = {
  tablet: { label: "Tablet", width: 768, height: 1024 },
  mobile: { label: "Mobile", width: 375, height: 812 },
};

const DEVICE_ICONS: Record<DevicePreset, React.ReactNode> = {
  tablet: <Tablet className="h-3.5 w-3.5" />,
  mobile: <Smartphone className="h-3.5 w-3.5" />,
};

const ZOOM_MIN = 25;
const ZOOM_MAX = 200;
const ZOOM_STEP = 25;

// ── ステータス表示マッピング ─────────────────────────────────────────────────

function getStatusLabel(status: PreviewStatus, t: (key: string) => string): string {
  const labels: Record<PreviewStatus, string> = {
    idle: "",
    booting: t("preview.statusBooting"),
    installing: t("preview.statusInstalling"),
    "starting-dev": t("preview.statusStartingDev"),
    ready: "",
    syncing: t("preview.statusSyncing"),
    error: "",
  };
  return labels[status];
}

const STATUS_ICONS: Record<PreviewStatus, React.ReactNode> = {
  idle: null,
  booting: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
  installing: <Package className="h-2.5 w-2.5 animate-spin" />,
  "starting-dev": <Loader2 className="h-2.5 w-2.5 animate-spin" />,
  ready: <Wifi className="h-2.5 w-2.5 text-green-500" />,
  syncing: <RefreshCw className="h-2.5 w-2.5 animate-spin" />,
  error: <WifiOff className="h-2.5 w-2.5 text-destructive" />,
};

/** 起動中に表示する進捗ログビューア */
function LogViewer({ logs, status }: { logs: string[]; status: PreviewStatus }) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新しいログが追加されたら自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const isStarting = status === "booting" || status === "installing" || status === "starting-dev";

  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col gap-3">
        {/* ステータスヘッダー */}
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">
            {isStarting && t("preview.loading")}
            {status === "syncing" && t("preview.updating")}
          </span>
        </div>

        {/* 詳細ステップ表示 */}
        {logs.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border bg-black/5 p-2 dark:bg-white/5">
            <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5 mb-1.5">
              <Terminal className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[10px] font-medium text-muted-foreground/60">{t("preview.buildLog")}</span>
            </div>
            {logs.map((log, i) => (
              <div
                key={i}
                className={`py-0.5 text-[10px] font-mono leading-relaxed ${
                  log.includes("Error") || log.includes("error")
                    ? "text-destructive"
                    : log.includes("ready") || log.includes("complete")
                      ? "text-green-600 dark:text-green-400"
                      : "text-muted-foreground/80"
                }`}
              >
                {log}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* ヒント */}
        <p className="text-center text-[10px] text-muted-foreground/50">
          {logs.length === 0
            ? t("preview.initializing")
            : t("preview.firstTimeSetup")}
        </p>
      </div>
    </div>
  );
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export function PreviewPanel() {
  const { t } = useTranslation();
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const reloadCounter = useAppStore((s) => s.reloadCounter);
  const previewMaximized = useAppStore((s) => s.previewMaximized);
  const togglePreviewMaximized = useAppStore((s) => s.togglePreviewMaximized);
  const workspaceReady = useAppStore((s) => s.workspaceReady);

  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [compatOk, setCompatOk] = useState(true);
  const [compatMessage, setCompatMessage] = useState("");
  const [iframeLoading, setIframeLoading] = useState(true);
  const prevProjectRef = useRef<string | null>(null);
  const prevReloadRef = useRef(0);
  const iframeLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Device Preset & Zoom ────────────────────────────────────────────────────
  // `null` = auto-fit (fill available width, original behaviour)
  const [devicePreset, setDevicePreset] = useState<DevicePreset | null>(null);
  const [zoom, setZoom] = useState(100);
  const presetDef = devicePreset ? DEVICE_PRESETS[devicePreset] : null;

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(100);
  }, []);

  // 互換性チェック（初回のみ）
  useEffect(() => {
    checkCompatibility().then((r) => {
      setCompatOk(r.ok);
      if (!r.crossOriginIsolated) {
        setCompatMessage(
          "⚠️ Cross-Origin Isolation is not enabled. " +
          "The Vite dev server must be started with the correct HTTP headers. " +
          "Run `npm run dev` with the updated vite.config.ts."
        );
      } else if (!r.ok) {
        setCompatMessage(
          "Some required browser features are not available. " +
          "Please use a modern Chromium-based browser (Chrome 105+)."
        );
      }
    });
  }, []);

  // WebContainer の状態変更を購読
  useEffect(() => {
    const unsub = previewManager.onStateChange((state: import("@/lib/preview").PreviewState) => {
      setStatus(state.status);
      setPreviewUrl(state.url);
      setError(state.error);
      setLogs(state.logs || []);
    });
    return unsub;
  }, []);

  // プロジェクト選択時 → WebContainer 起動
  useEffect(() => {
    if (!currentProjectId) return;
    if (prevProjectRef.current === currentProjectId) return;
    prevProjectRef.current = currentProjectId;

    previewManager
      .boot(currentProjectId)
      .catch((e: any) => {
        console.error("[preview] Boot failed:", e);
        setError(e.message || String(e));
      });
  }, [currentProjectId]);

  // タブが再フォーカスされたときにエラー状態から自動復帰
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (status !== "error") return;
      if (!currentProjectId) return;

      console.log("[preview] Tab became visible, recovering from error...");
      setError(null);
      previewManager
        .boot(currentProjectId)
        .catch((e: any) => {
          console.error("[preview] Auto-recovery failed:", e);
          setError(e.message || String(e));
        });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [status, currentProjectId]);

  // previewUrl 変更時 → iframe のローディング状態をリセット
  useEffect(() => {
    if (previewUrl) {
      setIframeLoading(true);

      // 安全タイムアウト: 30秒経過しても load が来なければ強制解除
      if (iframeLoadTimeoutRef.current) clearTimeout(iframeLoadTimeoutRef.current);
      iframeLoadTimeoutRef.current = setTimeout(() => {
        setIframeLoading(false);
      }, 30000);
    }
    return () => {
      if (iframeLoadTimeoutRef.current) clearTimeout(iframeLoadTimeoutRef.current);
    };
  }, [previewUrl]);

  // アンマウント時にタイムアウトをクリア
  useEffect(() => {
    return () => {
      if (iframeLoadTimeoutRef.current) clearTimeout(iframeLoadTimeoutRef.current);
    };
  }, []);

  // reloadCounter 変更時 → ファイル同期
  useEffect(() => {
    if (!currentProjectId || reloadCounter <= prevReloadRef.current) return;
    if (!workspaceReady) return;
    prevReloadRef.current = reloadCounter;

    previewManager
      .syncAndReload(currentProjectId)
      .catch((e: any) => {
        console.error("[preview] Sync failed:", e);
        setError(e.message || String(e));
      });
  }, [reloadCounter, currentProjectId, workspaceReady]);

  // 手動リロード
  const handleReload = useCallback(() => {
    if (!currentProjectId) return;
    setError(null);
    // iframe のリロード
    const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
    if (iframe && previewUrl) {
      iframe.src = previewUrl;
    }
    // コンテナ再同期
    previewManager.syncAndReload(currentProjectId).catch((e: any) => {
      setError(e.message || String(e));
    });
  }, [currentProjectId, previewUrl]);

  // エラー画面（互換性）
  if (!compatOk) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/10 p-4">
        <div className="max-w-sm text-center space-y-2">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {compatMessage || "Cross-Origin Isolation is not available. Preview requires WebContainer support."}
          </p>
        </div>
      </div>
    );
  }

  // プロジェクト未選択
  if (!currentProjectId) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/10 p-4">
        <p className="text-sm text-muted-foreground">
          {t("preview.selectProject")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col ${
        previewMaximized ? "fixed inset-0 z-50 bg-background" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {t("preview.title")}
          </span>
          {status !== "ready" && status !== "idle" && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {STATUS_ICONS[status]}
              {getStatusLabel(status, t)}
            </Badge>
          )}
          {status === "ready" && previewUrl && (
            <Badge variant="outline" className="gap-1 text-[10px] text-green-600 border-green-300">
              <Wifi className="h-2.5 w-2.5" />
              HMR
            </Badge>
          )}

          {/* Device Presets (toggle on/off) */}
          <div className="ml-2 flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5">
            {(Object.keys(DEVICE_PRESETS) as DevicePreset[]).map((key) => {
              const isActive = devicePreset === key;
              return (
                <button
                  key={key}
                  onClick={() => setDevicePreset(isActive ? null : key)}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={`${DEVICE_PRESETS[key].label} (${DEVICE_PRESETS[key].width}×${DEVICE_PRESETS[key].height})${isActive ? " — click to disable" : ""}`}
                >
                  {DEVICE_ICONS[key]}
                  {key === "mobile" && (
                    <span className="hidden sm:inline">375</span>
                  )}
                  {key === "tablet" && (
                    <span className="hidden sm:inline">768</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 rounded-md border bg-muted/30 px-1 py-0.5">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= ZOOM_MIN}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t("preview.zoomOut")}
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <button
              onClick={handleZoomReset}
              className="rounded px-1 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground hover:text-foreground transition-colors min-w-[2.5rem] text-center"
              title={t("preview.zoomReset")}
            >
              {zoom}%
            </button>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= ZOOM_MAX}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t("preview.zoomIn")}
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleReload}
            disabled={status === "installing" || status === "booting"}
            title={t("common.refresh")}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                status === "syncing" ? "animate-spin" : ""
              }`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={togglePreviewMaximized}
            title={
              previewMaximized
                ? t("common.minimize")
                : t("common.maximize")
            }
          >
            {previewMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 overflow-hidden bg-white">
        {status === "booting" || status === "installing" || status === "starting-dev" || (status === "syncing" && !previewUrl) ? (
          <LogViewer logs={logs} status={status} />
        ) : error ? (
          <div className="flex h-full items-center justify-center p-4">
            <div className="max-w-md space-y-2 text-center">
              <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
              <p className="text-xs text-destructive font-medium">
                {t("preview.previewError")}
              </p>
              <pre className="max-h-48 overflow-auto rounded border bg-muted p-2 text-left text-[10px] text-muted-foreground">
                {error}
              </pre>
              <Button variant="outline" size="sm" className="mt-2" onClick={handleReload}>
                <RefreshCw className="mr-1 h-3 w-3" />
                {t("common.retry")}
              </Button>
            </div>
          </div>
        ) : previewUrl ? (
          <div className="relative flex h-full items-start justify-center overflow-auto bg-white/50 dark:bg-black/20">
            <div
              className="relative shrink-0 transition-[width,height] duration-200"
              style={{
                width: presetDef ? `${presetDef.width}px` : "100%",
                height: presetDef ? `${presetDef.height}px` : "100%",
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
              }}
            >
              {/* Iframe コンテンツ読み込み中 — ローディングオーバーレイ */}
              {iframeLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-[1px] dark:bg-black/80">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("preview.rendering")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {t("preview.loadingApp")}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* If syncing while preview is already ready, show overlay */}
              {status === "syncing" && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/50 backdrop-blur-[1px] dark:bg-black/50">
                  <div className="max-w-sm">
                    <LogViewer logs={logs} status={status} />
                  </div>
                </div>
              )}
              <iframe
                id="preview-iframe"
                className="h-full w-full border-0"
                src={previewUrl}
                title="App Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={() => {
                  setIframeLoading(false);
                  if (iframeLoadTimeoutRef.current) {
                    clearTimeout(iframeLoadTimeoutRef.current);
                    iframeLoadTimeoutRef.current = null;
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-xs">
                {t("preview.loading")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
