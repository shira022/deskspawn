import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Bot,
  CheckCircle2,
  AlertCircle,
  Wifi,
} from "lucide-react";

export function StatusBar() {
  const { t } = useTranslation();
  const { agentStatus, agentStepCount, agentMaxSteps } = useAppStore();

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

      {/* Center */}
      <div className="flex items-center gap-2">
        <Wifi className="h-3 w-3 text-emerald-500" />
        <span className="text-[10px]">Browser</span>
      </div>

      {/* Right side — Costs */}
      <div className="flex items-center gap-2">
        <CostDisplay />
      </div>
    </footer>
  );
}

/** Project-level token usage and cost display */
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
