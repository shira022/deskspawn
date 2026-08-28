/**
 * PreviewPanel — プレビュー表示パネル
 *
 * WebContainer を使ってアプリの Vite Dev Server を起動し、
 * iframe 内にプレビューを表示する。
 *
 * 動作:
 * 1. アプリ選択時に WebContainer を起動 (boot → mount → install → dev)
 * 2. コード変更時にファイルを同期 (sync → 必要なら npm install)
 * 3. Vite HMR が差分を自動反映
 * 4. iframe に Dev Server の URL を表示
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Maximize2,
  Minimize2,
  Wifi,
  WifiOff,
  Package,
  Terminal,
  Smartphone,
  Tablet,
  ExternalLink,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { previewManager } from "../../lib/preview";
import type { PreviewStatus } from "../../lib/preview";
import { checkCompatibility } from "../../lib/compatibility";
import { isDesktopEnv } from "../../lib/platform";

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

// ── 初回プレビュー実行同意 (C1, 監査 2026-08-28) ──────────────────────────────
// プレビューは AI が生成した未検証コードを実行するため、アプリ(projectId)ごとに
// 初回のみ確認ダイアログを表示する。同意は localStorage に機密を含まないフラグ
// （deskspawn_preview_consent_<projectId>='1'）で永続化する。Web/Desktop 共通。
const PREVIEW_CONSENT_PREFIX = "deskspawn_preview_consent_";

function hasPreviewConsent(appId: string): boolean {
  try {
    return localStorage.getItem(PREVIEW_CONSENT_PREFIX + appId) === "1";
  } catch {
    return false;
  }
}

function setPreviewConsent(appId: string): void {
  try {
    localStorage.setItem(PREVIEW_CONSENT_PREFIX + appId, "1");
  } catch {
    // localStorage が使えない環境では毎回確認を表示する（安全側）
  }
}

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
  const currentAppId = useAppStore((s) => s.currentAppId);
  const initialized = useAppStore((s) => s.initialized);
  const reloadCounter = useAppStore((s) => s.reloadCounter);
  const previewMaximized = useAppStore((s) => s.previewMaximized);
  const togglePreviewMaximized = useAppStore((s) => s.togglePreviewMaximized);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [compatOk, setCompatOk] = useState(true);
  const [compatMessage, setCompatMessage] = useState("");
  const [iframeLoading, setIframeLoading] = useState(true);
  const [consentRequired, setConsentRequired] = useState(false);
  const prevAppRef = useRef<string | null>(null);
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

  // 互換性チェック（初回のみ・WebContainer版のみ。デスクトップはローカルVite
  // プレビューのため Cross-Origin Isolation は不要）
  useEffect(() => {
    if (isDesktopEnv()) {
      setCompatOk(true);
      return;
    }
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
    const unsub = previewManager.onStateChange((state: import("../../lib/preview").PreviewState) => {
      setStatus(state.status);
      setPreviewUrl(state.url);
      setError(state.error);
      setLogs(state.logs || []);
    });
    return unsub;
  }, []);

  // プレビュー起動ヘルパー（C1: 同意後の起動・通常起動の両方で使用）
  const runPreview = useCallback((appId: string) => {
    previewManager
      .boot(appId)
      .catch((e: any) => {
        console.error("[preview] Boot failed:", e);
        setError(e.message || String(e));
      });
  }, []);

  // 同意ダイアログの「実行」— 同意を永続化してプレビューを起動する
  const handleConsentConfirm = useCallback(() => {
    if (!currentAppId) return;
    setPreviewConsent(currentAppId);
    setConsentRequired(false);
    runPreview(currentAppId);
  }, [currentAppId, runPreview]);

  // アプリ選択時 → プレビュー起動。
  // initialized（initialize 完了）を待ってから boot する — 起動直後に
  // currentAppId が復元される前の競合を避けるため。
  // C1: アプリごとに初回のみ同意を求め、同意前は boot しない（最終防衛線）。
  useEffect(() => {
    if (!initialized) return;
    if (!currentAppId) return;
    if (prevAppRef.current === currentAppId) return;
    prevAppRef.current = currentAppId;

    if (!hasPreviewConsent(currentAppId)) {
      setConsentRequired(true);
      return;
    }
    runPreview(currentAppId);
  }, [initialized, currentAppId, runPreview]);

  // タブが再フォーカスされたときにエラー状態から自動復帰
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (status !== "error") return;
      if (!currentAppId) return;

      console.log("[preview] Tab became visible, recovering from error...");
      setError(null);
      previewManager
        .boot(currentAppId)
        .catch((e: any) => {
          console.error("[preview] Auto-recovery failed:", e);
          setError(e.message || String(e));
        });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [status, currentAppId]);

  // 生成完了後（agentStatus: running → 非running）に、エラー状態のプレビューを
  // 再起動する。生成中に package.json がまだ無い状態で boot が失敗しても、
  // コード生成完了後に files が揃っていれば再試行で成功する（実績 2026-08-21:
  // 生成中 boot → "Project has no package.json" → 完了後も自動再試行されず
  // 残る問題があった）。
  const prevAgentStatusRef = useRef(agentStatus);
  useEffect(() => {
    const wasRunning = prevAgentStatusRef.current === "running";
    const nowRunning = agentStatus === "running";
    prevAgentStatusRef.current = agentStatus;
    if (!wasRunning || nowRunning) return; // 完了時のみ反応
    if (status !== "error") return;
    if (!currentAppId) return;
    if (isDesktopEnv() === false) return; // Web 版は対象外（生成→WebContainer boot の既存フロー）

    console.log("[preview] Generation finished, retrying preview boot...");
    setError(null);
    previewManager
      .boot(currentAppId)
      .catch((e: any) => {
        console.error("[preview] Post-generation retry failed:", e);
        setError(e.message || String(e));
      });
  }, [agentStatus, status, currentAppId]);

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

  // reloadCounter 変更時 → ファイル同期 + iframe 強制リロード
  // workspaceReady によるガードは行わない — リトライ時など workspace が
  // ready でない状態でも triggerReload() で即座にプレビューを再表示する。
  useEffect(() => {
    if (!currentAppId || reloadCounter <= prevReloadRef.current) return;
    prevReloadRef.current = reloadCounter;

    previewManager
      .syncAndReload(currentAppId)
      .then(() => {
        // syncAndReload はファイル同期 + dev server再起動を行うが、
        // iframe は古いページ＋モジュールキャッシュを保持したまま。
        // ブラウザのモジュールキャッシュを強制的にクリアし、
        // 新しい ViteDevServer から最新ファイルを取得させるため、
        // iframe を明示的にリロードする。
        const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
        if (iframe && previewUrl) {
          setIframeLoading(true);
          iframe.src = previewUrl;
        }
      })
      .catch((e: any) => {
        console.error("[preview] Sync failed:", e);
        setError(e.message || String(e));
      });
  }, [reloadCounter, currentAppId, previewUrl]);

  // ★ injectIframeModule は削除済み
  // 理由: HTML内の <script type="module" src="/__virtual__/5174/src/main.tsx"> で
  // モジュールは自動的に読み込まれる。重複した動的インポートは不要であり、
  // Service Workerの制御タイミング問題により "Failed to fetch" エラーの原因になる。
  // エラーキャプチャは tool-executors.ts のフォールバック機構と HTML内の
  // エラーオーバーレイスクリプト（_createErrorOverlayScript）が代替する。

  // 手動リロード
  const handleReload = useCallback(() => {
    if (!currentAppId) return;
    setError(null);
    // iframe のリロード
    const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
    if (iframe && previewUrl) {
      iframe.src = previewUrl;
    }
    // コンテナ再同期
    previewManager.syncAndReload(currentAppId).catch((e: any) => {
      setError(e.message || String(e));
    });
  }, [currentAppId, previewUrl]);

  // デスクトップ: プレビューURL からポートを抽出（Local :port バッジ用）
  const previewPort = useMemo(() => {
    if (!previewUrl) return "";
    try {
      return new URL(previewUrl).port;
    } catch {
      return "";
    }
  }, [previewUrl]);

  // プレビューを外部ブラウザで開く
  // Desktop: Tauri の open_url コマンド → システムブラウザ
  // Web: 新しいタブ
  const handleOpenInBrowser = useCallback(() => {
    if (!previewUrl) return;
    if (isDesktopEnv()) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke("open_url", { url: previewUrl }).catch((e: unknown) =>
            console.error("[preview] open_url failed:", e),
          ),
        )
        .catch((e: unknown) => console.error("[preview] tauri import failed:", e));
    } else {
      window.open(previewUrl, "_blank", "noopener,noreferrer");
    }
  }, [previewUrl]);

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

  // アプリ未選択
  if (!currentAppId) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/10 p-4">
        <p className="text-sm text-muted-foreground">
          {t("preview.selectApp")}
        </p>
      </div>
    );
  }

  // ── C1: 初回プレビュー実行の確認ダイアログ ───────────────────────────────────
  // 未検証のAI生成コードを実行することを、アプリごとに初回のみ確認する。
  return (
    <>
      <Dialog open={consentRequired} onOpenChange={(open) => { if (!open) setConsentRequired(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              {t("preview.consentTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("preview.consentDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConsentRequired(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleConsentConfirm}>
              {t("preview.consentExecute")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            isDesktopEnv() ? (
              <>
                <Badge
                  variant="outline"
                  className="gap-1 text-[10px] text-emerald-600 border-emerald-300"
                >
                  <Wifi className="h-2.5 w-2.5" />
                  {t("preview.localBadge", { port: previewPort })}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  onClick={handleOpenInBrowser}
                  title={t("preview.openInBrowser")}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <Badge variant="outline" className="gap-1 text-[10px] text-green-600 border-green-300">
                <Wifi className="h-2.5 w-2.5" />
                HMR
              </Badge>
            )
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
        ) : status === "idle" && !previewUrl && !hasPreviewConsent(currentAppId) ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <ShieldAlert className="h-5 w-5" />
              <p className="text-xs">
                {t("preview.consentPending")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConsentRequired(true)}
              >
                {t("preview.consentStart")}
              </Button>
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
    </>
  );
}
