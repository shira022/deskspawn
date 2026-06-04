import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Bot,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
  RotateCw,
  RefreshCw,
  ChevronsUpDown,
  DollarSign,
} from "lucide-react";
import { callBackend } from "@/lib/backend";
import { sidecarHealthUrl, setSidecarPort } from "@/lib/constants";

export function StatusBar() {
  const { t } = useTranslation();
  const { agentStatus, agentStepCount, agentMaxSteps, errors, vitePort } =
    useAppStore();

  const [sidecarOnline, setSidecarOnline] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [tauriRestarting, setTauriRestarting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Initialize sidecar port from Rust backend (Tauri only)
  useEffect(() => {
    (async () => {
      try {
        const port = await callBackend<number>("sidecar_port");
        if (typeof port === "number" && port > 0) {
          setSidecarPort(port);
        }
      } catch {
        // browser mode — use default port 3001
      }
    })();
  }, []);

  // Poll sidecar health (uses dynamic port)
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(sidecarHealthUrl(), { signal: AbortSignal.timeout(2000) });
        setSidecarOnline(res.ok);
      } catch {
        setSidecarOnline(false);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleRestart = useCallback(async () => {
    setMenuOpen(false);
    setRestarting(true);
    try {
      await callBackend("restart_sidecar");
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error("Failed to restart sidecar:", e);
    } finally {
      setRestarting(false);
    }
  }, []);

  const handleTauriRestart = useCallback(async () => {
    setMenuOpen(false);
    setTauriRestarting(true);
    try {
      await callBackend("restart_tauri");
    } catch (e) {
      console.error("Failed to restart Tauri:", e);
      setTauriRestarting(false);
    }
  }, []);

  const statusConfig = {
    idle: { label: t('status.idle'), icon: <Bot className="h-3 w-3" />, variant: "outline" as const },
    running: { label: t('status.running'), icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "secondary" as const },
    error: { label: t('status.error'), icon: <AlertCircle className="h-3 w-3" />, variant: "destructive" as const },
    complete: { label: t('status.complete'), icon: <CheckCircle2 className="h-3 w-3" />, variant: "success" as const },
  };

  const messages = useAppStore((s) => s.messages);
  const totalCost = messages.reduce((sum, m) => sum + (m.usage?.estimatedCost ?? 0), 0);
  const totalTokens = messages.reduce((sum, m) => sum + (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0), 0);

  const s = statusConfig[agentStatus];

  const isRestarting = restarting || tauriRestarting;

  return (
    <div className="flex h-7 items-center justify-between border-t bg-muted/20 px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Badge variant={s.variant} className="h-5 gap-1 text-[10px]">
            {s.icon}
            {s.label}
          </Badge>
          {agentStatus === "running" && (
            <span>
              Step {agentStepCount}/{agentMaxSteps}
            </span>
          )}
        </div>
        {errors.length > 0 && (
          <Badge variant="destructive" className="h-5 text-[10px]">
            <AlertCircle className="h-3 w-3 mr-1" />
            {t('status.errorCount', { count: errors.length })}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Token usage */}
        {totalTokens > 0 && (
          <>
            <div className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[10px] tabular-nums">
                {totalTokens.toLocaleString()} tokens{totalCost > 0 ? ` ($${totalCost.toFixed(4)})` : ""}
              </span>
            </div>
            <Separator orientation="vertical" className="h-3" />
          </>
        )}

        {/* Sidecar status & restart dropdown */}
        <div ref={menuRef} className="relative flex items-center gap-1">
          {sidecarOnline
            ? <Wifi className="h-3 w-3 text-success" />
            : <WifiOff className="h-3 w-3 text-destructive" />
          }
          <span className={sidecarOnline ? "" : "text-destructive"}>
            Sidecar
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={isRestarting}
            title={t('status.restartOptions')}
          >
            {restarting
              ? <RotateCw className="h-3 w-3 animate-spin" />
              : tauriRestarting
                ? <RefreshCw className="h-3 w-3 animate-spin" />
                : <ChevronsUpDown className="h-3 w-3" />
            }
          </Button>

          {menuOpen && (
            <div className="absolute bottom-full right-0 mb-1 z-50 w-44 rounded-md border bg-popover py-1 shadow-md">
              <button
                onClick={handleRestart}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
              >
                <RotateCw className="h-3 w-3 shrink-0" />
                <span>{t('status.restartSidecar')}</span>
              </button>
              <button
                onClick={handleTauriRestart}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
              >
                <RefreshCw className="h-3 w-3 shrink-0" />
                <span>{t('status.restartTauri')}</span>
              </button>
            </div>
          )}
        </div>
        <Separator orientation="vertical" className="h-3" />
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-success" />
          <span>Vite :{vitePort}</span>
        </div>
        <Separator orientation="vertical" className="h-3" />
        <span>{new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
