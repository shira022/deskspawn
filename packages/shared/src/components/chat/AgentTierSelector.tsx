import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import type { AgentTier } from "../../types";
import { Check, ChevronDown, Gauge } from "lucide-react";
import { cn } from "../../lib/utils";

const TIER_OPTIONS: AgentTier[] = ["auto", "L1", "L2", "L3", "L4", "L5"];

function tierLabel(t: (key: string, opts?: Record<string, unknown>) => string, tier: AgentTier): string {
  return tier === "auto"
    ? t("chat.agentTier.auto")
    : t("chat.agentTier.level", { level: tier.slice(1) });
}

function tierDescKey(tier: AgentTier): string {
  return tier === "auto" ? "chat.agentTier.descAuto" : `chat.agentTier.desc${tier.slice(1)}`;
}

/**
 * チャット入力近傍のコンパクトなティアセレクター。
 *
 * - 既定は「オート」（triage の自動判定）。
 * - L1〜L5 を選ぶと triage の LLM 判定をスキップしてその構成で実行する。
 * - 選択状態はストア（agentTier）に保持し、直近の規模判定を1行で可視化する。
 */
export function AgentTierSelector() {
  const { t } = useTranslation();
  const agentTier = useAppStore((s) => s.agentTier);
  const setAgentTier = useAppStore((s) => s.setAgentTier);
  const lastTriage = useAppStore((s) => s.lastTriage);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // クリックアウトサイド / Escape で閉じる
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const scaleLabel =
    agentTier === "auto"
      ? lastTriage && lastTriage.source === "auto"
        ? t("chat.agentTier.autoScale", { level: lastTriage.level })
        : t("chat.agentTier.autoScaleIdle")
      : t("chat.agentTier.manualScale", { level: agentTier.slice(1) });

  const handleSelect = (tier: AgentTier) => {
    setAgentTier(tier);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("chat.agentTier.label")}
        title={`${tierLabel(t, agentTier)} — ${t(tierDescKey(agentTier))}`}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          agentTier !== "auto" && "border-primary/50 bg-primary/10 text-primary"
        )}
      >
        <Gauge className="h-3 w-3" />
        <span>{tierLabel(t, agentTier)}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      <span className="truncate text-[10px] text-muted-foreground" data-testid="agent-scale">
        {scaleLabel}
      </span>

      {open && (
        <div
          role="listbox"
          aria-label={t("chat.agentTier.label")}
          className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border bg-card p-1 shadow-xl"
        >
          {TIER_OPTIONS.map((tier) => {
            const selected = agentTier === tier;
            return (
              <button
                key={tier}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={tierLabel(t, tier)}
                onClick={() => handleSelect(tier)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  "text-muted-foreground hover:bg-muted hover:text-foreground",
                  selected && "bg-muted text-foreground font-medium"
                )}
              >
                <Check className={cn("mt-0.5 h-3 w-3 shrink-0", !selected && "opacity-0")} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{tierLabel(t, tier)}</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {t(tierDescKey(tier))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
