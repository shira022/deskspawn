import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import type { AgentTier } from "../../types";
import { Check, ChevronDown, Gauge } from "lucide-react";
import { cn } from "../../lib/utils";

const TIER_OPTIONS: AgentTier[] = ["auto", "L1", "L2", "L3", "L4", "L5"];

/** 内部ティアを i18n キー・data 属性用の短い識別子へ変換する。 */
function tierKey(tier: AgentTier): string {
  return tier === "auto" ? "auto" : `t${tier.slice(1)}`;
}

/** テスト/E2E 用の安定した識別子（表示は変えない）。 */
function tierDataValue(tier: AgentTier): string {
  return tier === "auto" ? "auto" : tier.slice(1);
}

/**
 * チャット入力近傍のコンパクトなティアセレクター。
 *
 * - 既定は「オート」（triage の自動判定）。
 * - 表示名（オート/最小/…/最大）だけを見せ、構成の技術用語は
 *   ホバー/フォーカス時のツールチップにのみ出す。
 * - 選択状態はストア（agentTier）に保持し、直近の規模判定を1行で可視化する。
 * - 内部の値は "auto" と L1〜L5 のまま変更しない。
 */
export function AgentTierSelector() {
  const { t } = useTranslation();
  const agentTier = useAppStore((s) => s.agentTier);
  const setAgentTier = useAppStore((s) => s.setAgentTier);
  const lastTriage = useAppStore((s) => s.lastTriage);

  const [open, setOpen] = useState(false);
  // 候補をホバー/フォーカスしている間だけその構成をプレビューする。
  const [hoveredTier, setHoveredTier] = useState<AgentTier | null>(null);
  // ピル自体をホバー/フォーカス中は現在のティアの構成を表示する。
  const [pillActive, setPillActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  // クリックアウトサイド / Escape で閉じる
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setHoveredTier(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setHoveredTier(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const tierLabel = (tier: AgentTier) => t(`chat.agentTier.label.${tierKey(tier)}`);
  const tierHint = (tier: AgentTier) => t(`chat.agentTier.hint.${tierKey(tier)}`);
  const tierAgents = (tier: AgentTier) => t(`chat.agentTier.agents.${tierKey(tier)}`);

  const scaleLabel =
    agentTier === "auto"
      ? lastTriage && lastTriage.source === "auto"
        ? t("chat.agentTier.autoScale", {
            name: tierLabel(`L${lastTriage.level}` as AgentTier),
          })
        : t("chat.agentTier.autoScaleIdle")
      : t("chat.agentTier.manualScale", { name: tierLabel(agentTier) });

  // ドロップダウンを開いている間はホバー中の行の右横、閉じている間は
  // ピルの上にツールチップを出す（同時に存在する role="tooltip" は常に1つ）。
  const pillTooltipVisible = !open && pillActive;
  const rowTooltipTier = open ? hoveredTier : null;
  const tooltipVisible = pillTooltipVisible || rowTooltipTier !== null;

  const handleSelect = (tier: AgentTier) => {
    setAgentTier(tier);
    setOpen(false);
    setHoveredTier(null);
  };

  const handleToggle = () => {
    if (open) setHoveredTier(null);
    setOpen(!open);
  };

  return (
    <div ref={ref} className="relative flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={handleToggle}
        onMouseEnter={() => setPillActive(true)}
        onMouseLeave={() => setPillActive(false)}
        onFocus={() => setPillActive(true)}
        onBlur={() => setPillActive(false)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("chat.agentTier.groupLabel")}
        aria-describedby={tooltipVisible ? tooltipId : undefined}
        data-tier={tierDataValue(agentTier)}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
          "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          agentTier !== "auto" && "border-primary/50 bg-primary/10 text-primary"
        )}
      >
        <Gauge className="h-3 w-3" />
        <span>{tierLabel(agentTier)}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      <span className="truncate text-[10px] text-muted-foreground" data-testid="agent-scale">
        {scaleLabel}
      </span>

      {pillTooltipVisible && (
        <div
          id={tooltipId}
          role="tooltip"
          data-tier={tierDataValue(agentTier)}
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 w-max max-w-[18rem] rounded-md bg-foreground px-2 py-1 text-[10px] text-background shadow-md"
        >
          {tierAgents(agentTier)}
        </div>
      )}

      {open && (
        <div
          role="listbox"
          aria-label={t("chat.agentTier.groupLabel")}
          className="pointer-events-auto absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border bg-card p-1 shadow-xl"
        >
          {TIER_OPTIONS.map((tier) => {
            const selected = agentTier === tier;
            return (
              <div
                key={tier}
                className="relative"
                data-tooltip-anchor={tierDataValue(tier)}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={tierLabel(tier)}
                  data-tier={tierDataValue(tier)}
                  onMouseEnter={() => setHoveredTier(tier)}
                  onMouseLeave={() => setHoveredTier(null)}
                  onFocus={() => setHoveredTier(tier)}
                  onBlur={() => setHoveredTier(null)}
                  onClick={() => handleSelect(tier)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    "text-muted-foreground hover:bg-muted hover:text-foreground",
                    selected && "bg-muted text-foreground font-medium"
                  )}
                >
                  <Check className={cn("mt-0.5 h-3 w-3 shrink-0", !selected && "opacity-0")} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{tierLabel(tier)}</span>
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {tierHint(tier)}
                    </span>
                  </span>
                </button>

                {rowTooltipTier === tier && (
                  <div
                    id={tooltipId}
                    role="tooltip"
                    data-tier={tierDataValue(tier)}
                    className="pointer-events-none absolute left-full top-0 z-50 ml-2 w-max max-w-[18rem] rounded-md bg-foreground px-2 py-1 text-[10px] text-background shadow-md"
                  >
                    {tierAgents(tier)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
