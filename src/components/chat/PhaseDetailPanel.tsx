import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PhaseOutput } from "@/types";
import { ChevronDown, ChevronRight, FileJson, Code, Bug, Eye } from "lucide-react";

interface PhaseDetailPanelProps {
  phaseOutputs: PhaseOutput[];
}

const PHASE_ICONS: Record<string, React.ReactNode> = {
  planner: <FileJson className="h-3.5 w-3.5" />,
  coder: <Code className="h-3.5 w-3.5" />,
  verifier: <Bug className="h-3.5 w-3.5" />,
  visual_qa: <Eye className="h-3.5 w-3.5" />,
};

const PHASE_COLORS: Record<string, string> = {
  planner: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  coder: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  verifier: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  visual_qa: "bg-green-500/15 text-green-600 dark:text-green-400",
};

/**
 * 各フェーズ（planner/coder/verifier/visual_qa）の詳細出力を
 * 折りたたみ可能なセクションで表示するパネル。
 */
export function PhaseDetailPanel({ phaseOutputs }: PhaseDetailPanelProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const phases = phaseOutputs.filter((p) => p.text?.trim());

  // Phase order (from pipeline sequence)
  const PHASE_ORDER = ["planner", "coder", "verifier", "visual_qa"];
  const sorted = [...phases].sort(
    (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase),
  );

  if (sorted.length === 0) return null;

  return (
    <div className="mt-1 ml-11">
      {/* トグルヘッダー */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors",
          "hover:bg-muted/40",
          panelOpen && "rounded-b-none bg-muted/20",
        )}
      >
        <span className="shrink-0 text-muted-foreground/40">
          {panelOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground/70">
          フェーズ詳細
        </span>
        <div className="flex items-center gap-1">
          {sorted.map((p) => (
            <span
              key={p.phase}
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full",
                PHASE_COLORS[p.phase] || "bg-muted-foreground/10 text-muted-foreground",
              )}
              title={p.label}
            >
              {PHASE_ICONS[p.phase] || null}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground/50 ml-auto tabular-nums">
          {sorted.length} フェーズ
        </span>
      </button>

      {/* フェーズ一覧（展開時） */}
      {panelOpen && (
        <div className="space-y-1.5 px-2 pb-2 pt-1.5 animate-in fade-in slide-in-from-top-1 duration-150 border border-border/20 rounded-b-lg bg-muted/10">
          {sorted.map((phase) => (
            <PhaseSection key={phase.phase} phase={phase} />
          ))}
        </div>
      )}
    </div>
  );
}

function PhaseSection({ phase }: { phase: PhaseOutput }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors duration-200",
        open ? "border-border/50" : "border-border/30",
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
          "hover:bg-muted/30 rounded-lg",
          open && "rounded-b-none",
        )}
      >
        <span className="shrink-0 text-muted-foreground/50">
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
            PHASE_COLORS[phase.phase] || "bg-muted-foreground/10 text-muted-foreground",
          )}
        >
          {PHASE_ICONS[phase.phase] || null}
        </span>
        <span className="min-w-0 flex-1 text-xs font-medium text-foreground/80 truncate">
          {phase.label}
        </span>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {phase.text.length} 文字
        </span>
      </button>

      {open && (
        <div className="px-2.5 pb-2 pt-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <pre className="rounded bg-background/60 border border-border/20 px-2.5 py-1.5 text-[11px] font-mono text-foreground/70 overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">
            {phase.text}
          </pre>
        </div>
      )}
    </div>
  );
}
