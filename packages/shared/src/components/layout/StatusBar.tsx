import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import { Badge } from "../ui/badge";
import { isDesktopEnv } from "../../lib/platform";
import { getSidecarPort } from "../../lib/sidecar";
import {
  Loader2,
  Bot,
  CheckCircle2,
  AlertCircle,
  Wifi,
  Monitor,
} from "lucide-react";

export function StatusBar() {
  const { t } = useTranslation();
  const { agentStatus, agentStepCount, agentMaxSteps } = useAppStore();
  const isDesktop = isDesktopEnv();

  // Desktop: sidecar 接続状態を起動時に一度取得（共有コードから Tauri invoke）
  const [sidecarReady, setSidecarReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const status = await invoke<{ running: boolean; ready: boolean }>(
          "sidecar_status",
        );
        if (!cancelled) setSidecarReady(status.running && status.ready);
      } catch {
        if (!cancelled) setSidecarReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  const agentBadge = () => {
    switch (agentStatus) {
      case "running":
        return (
          <Badge variant="secondary" className="gap-1 text-xs cursor-default">
            <Loader2 className="h-3 w-3 animate-spin" />
            {agentStepCount}/{agentMaxSteps}
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="gap-1 text-xs cursor-default">
            <AlertCircle className="h-3 w-3" />
            {t('statusBar.error') || 'Error'}
          </Badge>
        );
      case "complete":
        return (
          <Badge variant="default" className="gap-1 text-xs cursor-default bg-emerald-600 hover:bg-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            {t('statusBar.complete') || 'Done'}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 text-xs cursor-default">
            <Bot className="h-3 w-3" />
            {t('statusBar.idle') || 'Idle'}
          </Badge>
        );
    }
  };

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t bg-background px-3 text-xs text-muted-foreground">
      {/* Left side — Agent status + errors */}
      <div className="flex items-center gap-2">
        {agentBadge()}
      </div>

      {/* Center — platform indicator (Web: Browser / Desktop: env + sidecar + port) */}
      <div className="flex items-center gap-2">
        {isDesktop ? (
          <>
            <Monitor className="h-3 w-3 text-emerald-500" />
            <span className="text-[10px] font-medium text-foreground/80">
              Desktop
            </span>
            {sidecarReady !== null && (
              <span
                className={`flex items-center gap-1 text-[10px] ${
                  sidecarReady
                    ? "text-emerald-600"
                    : "text-destructive"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    sidecarReady ? "bg-emerald-500" : "bg-red-500"
                  }`}
                />
                {sidecarReady
                  ? t("statusBar.sidecarConnected")
                  : t("statusBar.sidecarOffline")}
              </span>
            )}
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              :{getSidecarPort()}
            </span>
          </>
        ) : (
          <>
            <Wifi className="h-3 w-3 text-emerald-500" />
            <span className="text-[10px]">Browser</span>
          </>
        )}
      </div>

      {/* Right side — Costs */}
      <div className="flex items-center gap-2">
        <CostDisplay />
      </div>
    </footer>
  );
}

/** App-level token usage and cost display */
function CostDisplay() {
  const { t } = useTranslation();
  const messages = useAppStore((s) => s.messages);
  const totalTokens = messages.reduce(
    (sum, m) => sum + (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0) + (m.usage?.reasoningTokens ?? 0) + (m.usage?.cachedInputTokens ?? 0),
    0,
  );
  const totalCost = messages.reduce(
    (sum, m) => sum + (m.usage?.estimatedCost ?? 0),
    0,
  );

  if (totalTokens <= 0) return null;

  return (
    <div className="flex items-center gap-1 cursor-default" title={t('chat.totalTokensAndCost')}>
      <span className="text-[10px] tabular-nums text-muted-foreground/50">
        {totalTokens.toLocaleString()}
      </span>
      <span className="text-[10px] text-muted-foreground/30">{t('chat.usageTokens')}</span>
      <span className="text-[10px] font-medium tabular-nums">
        ${totalCost.toFixed(4)}
      </span>
    </div>
  );
}
