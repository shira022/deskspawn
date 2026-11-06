/**
 * First-run environment check screen (desktop only).
 *
 * Shown after language selection on desktop. The web build never registers a
 * RuntimeEnvProvider, so this component is never displayed there.
 *
 * It deliberately lists only the two runtime prerequisites the user actually
 * needs (bun and WebView2) — never build-only tooling such as Node/pnpm/rustup.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  PackageOpen,
  Play,
  RefreshCw,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import {
  getRuntimeEnvProvider,
  type RuntimeCheckItem,
  type RuntimeEnvProvider,
  type RuntimePrerequisiteKind,
} from "../../lib/runtime-env";

interface Props {
  onReady: () => void;
}

type Phase = "checking" | "list" | "installing" | "ready";

const READY_DELAY_MS = 1200;

function sourceKey(source: string): string {
  switch (source) {
    case "bundled":
      return "env.sourceBundled";
    case "env":
      return "env.sourceEnv";
    case "path":
      return "env.sourcePath";
    case "home":
      return "env.sourceHome";
    case "winget":
      return "env.sourceWinget";
    case "registry":
      return "env.sourceRegistry";
    default:
      return "env.sourceNone";
  }
}

function formatSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb} MB`;
}

export function EnvCheckScreen({ onReady }: Props) {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>("checking");
  const [items, setItems] = useState<RuntimeCheckItem[]>([]);
  const [wingetAvailable, setWingetAvailable] = useState<boolean | null>(null);
  const [confirmKind, setConfirmKind] = useState<RuntimePrerequisiteKind | null>(
    null,
  );
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);

  const providerRef = useRef<RuntimeEnvProvider | null>(null);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyCalledRef = useRef(false);
  const checkStartedRef = useRef(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const callReady = useCallback(() => {
    if (readyCalledRef.current) return;
    readyCalledRef.current = true;
    onReadyRef.current();
  }, []);

  const scheduleReady = useCallback(() => {
    setPhase("ready");
    if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    readyTimerRef.current = setTimeout(() => {
      readyTimerRef.current = null;
      callReady();
    }, READY_DELAY_MS);
  }, [callReady]);

  useEffect(() => {
    return () => {
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
    };
  }, []);

  const runCheck = useCallback(
    async (p: RuntimeEnvProvider) => {
      setPhase("checking");
      setInstallError(null);
      try {
        const result = await p.check();
        setItems(result);
        if (result.every((item) => item.status === "ok")) {
          scheduleReady();
          return;
        }
        setPhase("list");
        try {
          setWingetAvailable(await p.isWingetAvailable());
        } catch {
          setWingetAvailable(false);
        }
      } catch (err) {
        setPhase("list");
        setInstallError(err instanceof Error ? err.message : String(err));
      }
    },
    [scheduleReady],
  );

  useEffect(() => {
    if (checkStartedRef.current) return;
    checkStartedRef.current = true;

    const p = getRuntimeEnvProvider();
    if (!p) {
      callReady();
      return;
    }
    providerRef.current = p;
    void Promise.resolve().then(() => runCheck(p));
  }, [callReady, runCheck]);

  useEffect(() => {
    const el = progressRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [progressLines]);

  const handleRecheck = useCallback(() => {
    const p = providerRef.current ?? getRuntimeEnvProvider();
    if (!p) return;
    void runCheck(p);
  }, [runCheck]);

  const handleStartInstall = useCallback(async () => {
    const p = providerRef.current;
    if (!p || !confirmKind) return;
    const kind = confirmKind;
    setConfirmKind(null);
    setPhase("installing");
    setProgressLines([]);
    setInstallError(null);

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await p.subscribeProgress((progress) => {
        setProgressLines((prev) => [...prev, progress.line]);
      });
    } catch {
      // Progress reporting is best-effort; installation can still proceed.
    }

    try {
      const result = await p.install(kind);
      setItems(result);
      try {
        setWingetAvailable(await p.isWingetAvailable());
      } catch {
        setWingetAvailable(false);
      }
      if (result.every((item) => item.status === "ok")) {
        scheduleReady();
      } else {
        setPhase("list");
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
      setPhase("list");
    } finally {
      unlisten?.();
    }
  }, [confirmKind, scheduleReady]);

  const allOk = items.length > 0 && items.every((item) => item.status === "ok");
  const installing = phase === "installing";
  const missingItems = items.filter((item) => item.status !== "ok");
  const pendingItem = confirmKind
    ? items.find((item) => item.id === confirmKind) ?? null
    : null;
  const hasFailure = installError !== null;
  const failureItem = items.find((item) => item.status !== "ok") ?? null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-background p-4">
      <div
        className="my-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-lg sm:p-8"
        data-testid="env-check-screen"
      >
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <PackageOpen className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {phase === "checking" ? t("env.checkingTitle") : t("env.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("env.checkingDescription")}
          </p>
        </div>

        <Separator className="my-4" />

        {phase === "checking" ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium">{t("env.checkingTitle")}</p>
          </div>
        ) : (
          <>
            {phase === "ready" && (
              <div className="mb-4 flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                <div className="text-center">
                  <p className="text-sm font-medium">{t("env.readyToStart")}</p>
                  <p className="text-xs font-normal opacity-80">
                    {t("env.allDepsReady")}
                  </p>
                </div>
              </div>
            )}

            {installing && (
              <div className="mb-4 space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {t("env.installingDeps")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("env.progressTitle")}
                </p>
                <div
                  ref={progressRef}
                  role="status"
                  data-testid="env-progress"
                  className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
                >
                  {progressLines.length > 0
                    ? progressLines.join("\n")
                    : t("env.waitForSetup")}
                </div>
              </div>
            )}

            {hasFailure && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium text-destructive">
                      {t("env.installFailed")}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {installError}
                    </p>
                    {failureItem && (
                      <a
                        href={failureItem.manualUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        {t("env.manualInstall")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Item list */}
            <div className="space-y-3">
              {items.map((item) => {
                return (
                  <div
                    key={item.id}
                    data-testid={`env-item-${item.id}`}
                    className="rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <PackageOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.label}
                      </p>
                      <div data-testid={`env-status-${item.id}`}>
                        {item.status === "ok" ? (
                          <Badge variant="success">✅ {t("env.ok")}</Badge>
                        ) : (
                          <Badge variant="warning">
                            ⚠️ {t("env.notInstalled")}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {item.version && (
                        <span>
                          {t("env.versionLabel", { version: item.version })}
                        </span>
                      )}
                      <span>{t(sourceKey(item.source))}</span>
                      {item.status !== "ok" && (
                        <span>
                          {t("env.approxSize", {
                            size: formatSize(item.sizeMb),
                          })}
                        </span>
                      )}
                    </div>

                    {item.status !== "ok" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          data-testid={`env-auto-setup-${item.id}`}
                          disabled={wingetAvailable !== true || installing}
                          onClick={() =>
                            setConfirmKind(item.id as RuntimePrerequisiteKind)
                          }
                        >
                          <Download className="mr-1 h-3 w-3" />
                          {t("env.autoSetup")}
                        </Button>
                        <a
                          href={item.manualUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline ${
                            installing ? "pointer-events-none opacity-50" : ""
                          }`}
                        >
                          {t("env.manualInstall")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {wingetAvailable === false && missingItems.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">{t("env.wingetNotFound")}</p>
                <p className="mt-1">{t("env.howToInstallWinget")}</p>
              </div>
            )}

            <Separator className="my-4" />

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="env-recheck"
                disabled={installing}
                onClick={handleRecheck}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {t("env.recheck")}
              </Button>
              <Button
                className="flex-1"
                data-testid="env-start-button"
                disabled={!allOk || installing}
                onClick={callReady}
              >
                <Play className="mr-1 h-3.5 w-3.5" />
                {t("env.startDeskspawn")}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Confirmation dialog */}
      {pendingItem && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="env-confirm-title"
            data-testid="env-confirm-dialog"
            className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl"
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2
                  id="env-confirm-title"
                  className="text-lg font-semibold"
                >
                  {t("env.setupConfirmTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("env.setupConfirmDesc")}
                </p>
              </div>
            </div>

            <Separator className="my-3" />

            <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
              <PackageOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {pendingItem.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("env.approxSize", {
                  size: formatSize(pendingItem.sizeMb),
                })}
              </span>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {pendingItem.wingetId}
            </p>

            <div className="mb-3 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t("env.totalSize")}{" "}
              {t("env.approxSize", {
                size: formatSize(pendingItem.sizeMb),
              })}
            </div>

            <div className="mb-4 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium">{t("env.installNotice")}</p>
              <p className="mt-1">{t("env.uacDescription")}</p>
            </div>

            <Separator className="mb-4" />

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmKind(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                className="flex-1"
                data-testid="env-start-install"
                onClick={() => void handleStartInstall()}
              >
                {t("env.startInstall")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
