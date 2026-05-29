import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  MonitorCheck,
  PackageOpen,
  Download,
  ArrowRight,
  AlertTriangle,
  Store,
} from "lucide-react";
import type { EnvCheckItem, WingetStatus, SetupProgress } from "@/types";
import { callBackend } from "@/lib/backend";

// ── Icons ─────────────────────────────────────────────────────────────────────

const envCheckIcons: Record<string, React.ReactNode> = {
  "Node.js": <PackageOpen className="h-4 w-4" />,
};

function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)}GB`;
  return `${mb}MB`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EnvCheckScreen() {
  const {
    envChecks,
    setEnvCheckResults,
    setEnvCheckStatus,
    setPhase,
    allEnvChecksPassed,
    failedEnvChecks,
    setWingetStatus,
    isWingetAvailable,
    setupProgress,
    setSetupProgress,
    setupRunning,
    setSetupRunning,
  } = useAppStore();

  const [showSetupModal, setShowSetupModal] = useState(false);
  const [checkingComplete, setCheckingComplete] = useState(false);

  // ── Run environment checks on mount ──────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function runChecks() {
      try {
        const results = await callBackend<EnvCheckItem[]>("check_environment");
        if (!cancelled) setEnvCheckResults(results);
      } catch (err) {
        console.error("Environment check failed:", err);
      }
      try {
        const winget = await callBackend<WingetStatus>("check_winget");
        if (!cancelled) setWingetStatus(winget);
      } catch (err) {
        console.error("Winget check failed:", err);
      }
      if (!cancelled) setCheckingComplete(true);
    }

    runChecks();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Listen for install progress events (Tauri Tauri only) ──────────────

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setupListener() {
      const hasTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (!hasTauri) return;
      const { listen } = await import("@tauri-apps/api/event");

      unlisten = await listen<SetupProgress>(
        "env-setup-progress",
        (event) => {
          setSetupProgress(event.payload);
          if (event.payload.stage === "complete") {
            const packageToIndex: Record<string, number> = {
              "OpenJS.NodeJS.LTS": 0,
            };
            const idx = packageToIndex[event.payload.package];
            if (idx !== undefined) {
              setEnvCheckStatus(idx, "ok");
            }
          }
        },
      );
    }

    setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  // ── Auto-setup logic ─────────────────────────────────────────────────────

  const startAutoSetup = useCallback(async () => {
    const hasTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!hasTauri) return;

    setSetupRunning(true);
    setShowSetupModal(false);

    const failed = failedEnvChecks();
    for (const item of failed) {
      if (!item.wingetPackage) continue;

      setEnvCheckStatus(
        envChecks.indexOf(item),
        "installing",
      );

      try {
        await callBackend("install_with_winget", {
          package: item.wingetPackage,
        });
      } catch (err) {
        console.error(`Failed to install ${item.name}:`, err);
        // Continue with remaining packages
      }
    }

    // Re-check environment after all installs
    try {
      const results = await callBackend<EnvCheckItem[]>("check_environment");
      setEnvCheckResults(results);
    } catch (err) {
      console.error("Re-check failed:", err);
    }

    setSetupRunning(false);
  }, [envChecks, failedEnvChecks, setEnvCheckResults, setEnvCheckStatus, setSetupRunning]);

  // ── Derived state ────────────────────────────────────────────────────────

  const allPassed = allEnvChecksPassed();
  const hasChecked = checkingComplete;
  const failed = failedEnvChecks();
  const wingetOk = isWingetAvailable();
  const canAutoSetup =
    wingetOk && failed.length > 0 && !setupRunning;

  // Collect packages to install for the confirmation modal
  const packagesToInstall = failed
    .filter((item) => item.wingetPackage)
    .map((item) => ({
      name: item.name,
      wingetPackage: item.wingetPackage!,
      sizeMb: item.sizeMb ?? 0,
      description: item.description,
    }));

  const totalSizeMb = packagesToInstall.reduce((sum, p) => sum + p.sizeMb, 0);
  const hasVsBuildTools = packagesToInstall.some((p) =>
    p.name.includes("VS Build Tools"),
  );

  // Get progress for a specific package
  const getPackageProgress = (wingetPkg: string): SetupProgress | undefined =>
    setupProgress.get(wingetPkg);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto bg-gradient-to-b from-background to-muted/30 py-6 md:items-center">
      <div className="mx-auto w-full max-w-lg space-y-4 rounded-xl border bg-card p-6 shadow-lg sm:space-y-6 sm:p-8">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MonitorCheck className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">環境チェック</h1>
          <p className="text-sm text-muted-foreground">
            Node.js と npm が利用可能かを確認します
          </p>
        </div>

        <Separator />

        {/* Winget Status Banner — only show when winget not available AND there are failed checks */}
        {hasChecked && !wingetOk && !allPassed && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  自動セットアップを利用できません
                </p>
                <p className="text-amber-700 dark:text-amber-300">
                  Windows パッケージマネージャー（winget）が見つかりませんでした。
                </p>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    winget を導入する方法：
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto w-full justify-start px-2 py-1.5 text-xs"
                    onClick={() =>
                      window.open(
                        "ms-windows-store://pdp/?productid=9NBLGGH4NNS1",
                        "_blank",
                      )
                    }
                  >
                    <Store className="mr-1 h-3 w-3" />
                    Microsoft Store で App Installer を更新する
                  </Button>
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    Store が開かない場合は、以下から各ツールを手動でインストールしてください。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Check List */}
        <ScrollArea className="max-h-[320px] min-h-[120px] sm:h-[320px]">
          <div className="space-y-3 px-1">
            {envChecks.map((item, _i) => {
              const pkg = item.wingetPackage;
              const progress = pkg ? getPackageProgress(pkg) : undefined;

              return (
                <div
                  key={item.name}
                  className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
                    {envCheckIcons[item.name] ?? (
                      <PackageOpen className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{item.name}</p>
                      {item.status === "ok" && (
                        <Badge variant="success">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          OK
                        </Badge>
                      )}
                      {item.status === "fail" && (
                        <Badge variant="destructive">
                          <XCircle className="mr-1 h-3 w-3" />
                          未インストール
                        </Badge>
                      )}
                      {item.status === "installing" && (
                        <Badge variant="outline">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          インストール中
                        </Badge>
                      )}
                      {item.status === "pending" && (
                        <Badge variant="outline">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          確認中
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.description}
                      {item.sizeMb && item.status === "fail" && (
                        <span className="ml-1 opacity-60">
                          （約{formatSize(item.sizeMb)}）
                        </span>
                      )}
                    </p>

                    {/* Progress during install */}
                    {progress && progress.stage !== "complete" && progress.stage !== "error" && (
                      <div className="mt-1">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all duration-500"
                            style={{ width: `${progress.progressPercent}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {progress.message}
                        </p>
                      </div>
                    )}

                    {/* Fallback: manual install link (shown when no winget or install failed) */}
                    {item.status === "fail" && item.downloadUrl && !wingetOk && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => window.open(item.downloadUrl, "_blank")}
                      >
                        手動インストール{" "}
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <Separator />

        {/* Actions */}
        <div className="space-y-3">
          {/* Auto-setup button (winget available, has failures) */}
          {hasChecked && !setupRunning && canAutoSetup && (
            <Button
              className="w-full"
              size="lg"
              onClick={() => setShowSetupModal(true)}
            >
              <Download className="mr-2 h-4 w-4" />
              自動セットアップ
            </Button>
          )}

          {/* Installing state */}
          {setupRunning && (
            <div className="space-y-2 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                依存関係を自動インストール中...
              </p>
              <p className="text-xs text-muted-foreground">
                セットアップが完了するまでお待ちください
              </p>
            </div>
          )}

          {/* Status message (no winget, has failures, not installing) */}
          {hasChecked && !allPassed && !setupRunning && !wingetOk && (
            <p className="text-sm text-muted-foreground text-center">
              必要なツールをインストールしてからお試しください
            </p>
          )}

          {/* All OK */}
          {allPassed && !setupRunning && (
            <p className="text-sm text-green-600 dark:text-green-400 text-center font-medium">
              すべての依存関係が準備できました
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPhase("ai-config")}
              className="flex-1"
              disabled={setupRunning}
            >
              戻る
            </Button>
            <Button
              onClick={() => setPhase("main")}
              className="flex-1"
              disabled={setupRunning}
            >
              DeskSpawn を始める
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Node.js はアプリの開発サーバーと依存関係の管理に必要です。
          </p>
        </div>
      </div>

      {/* ── Setup Confirmation Modal ──────────────────────────────────────── */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">自動セットアップの確認</h2>
                <p className="text-xs text-muted-foreground">
                  winget を使用して以下のツールをインストールします
                </p>
              </div>
            </div>

            <Separator className="mb-4" />

            {/* Package list */}
            <div className="mb-2 space-y-2">
              {packagesToInstall.map((pkg) => (
                <div
                  key={pkg.wingetPackage}
                  className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
                >
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="font-medium">{pkg.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {pkg.description}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    約{formatSize(pkg.sizeMb)}
                  </span>
                </div>
              ))}
            </div>

            {/* Total size warning */}
            <div className="mb-4 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              合計ダウンロードサイズ: 約{formatSize(totalSizeMb)}
            </div>

            {/* VS Build Tools specific warning */}
            {hasVsBuildTools && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                VS Build Tools のインストールには約4.5GBの空き容量と安定した
                インターネット接続が必要です。Wi-Fi 環境を推奨します。
              </div>
            )}

            {/* UAC notice */}
            <div className="mb-4 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium">インストール中について</p>
              <p>
                インストール中に Windows の確認画面（UAC）が表示された場合は、
                「はい」を押して許可してください。これは Windows がシステムへの
                変更を確認するための標準的な動作です。
              </p>
            </div>

            <Separator className="mb-4" />

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowSetupModal(false)}
              >
                キャンセル
              </Button>
              <Button className="flex-1" onClick={startAutoSetup}>
                インストール開始
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
