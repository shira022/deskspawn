import { useState } from "react";
import { cn } from "@/lib/utils";
import type { StepLogEntry } from "@/types";
import {
  ChevronDown,
  ChevronRight,
  Search,
  List,
  FileEdit,
  Terminal,
  AlertTriangle,
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

interface StepLogPanelProps {
  stepLogs: StepLogEntry[];
  /** true の場合は生成中のライブログとして表示 */
  isLive?: boolean;
}

/** ツール名 → アイコン */
function toolIcon(name: string) {
  switch (name) {
    case "read_file":
      return <Search className="h-3.5 w-3.5" />;
    case "list_files":
      return <List className="h-3.5 w-3.5" />;
    case "apply_artifact":
      return <FileEdit className="h-3.5 w-3.5" />;
    case "run_shell":
      return <Terminal className="h-3.5 w-3.5" />;
    case "get_errors":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    default:
      return <Wrench className="h-3.5 w-3.5" />;
  }
}

/** ツール名 → 日本語ラベル */
function toolLabel(name: string): string {
  switch (name) {
    case "read_file":
      return "ファイル読み取り";
    case "list_files":
      return "ファイル一覧";
    case "apply_artifact":
      return "コード生成・編集";
    case "run_shell":
      return "コマンド実行";
    case "get_errors":
      return "エラーチェック";
    default:
      return name;
  }
}

/** JSON を整形表示（80文字以内に丸める） */
function formatJSON(obj: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(obj, null, 2);
    if (text.length <= 300) return text;
    return text.substring(0, 300) + "\n… (truncated)";
  } catch {
    return String(obj);
  }
}

/** ステータスに応じたバッジ */
function StatusBadge({ status }: { status: StepLogEntry["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400 font-medium">
        <Clock className="h-2.5 w-2.5 animate-pulse" />
        実行中
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600 dark:text-red-400 font-medium">
        <XCircle className="h-2.5 w-2.5" />
        エラー
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-600 dark:text-green-400 font-medium">
      <CheckCircle2 className="h-2.5 w-2.5" />
      成功
    </span>
  );
}

/** 1つのステップ行 */
function StepRow({
  entry,
  defaultOpen,
}: {
  entry: StepLogEntry;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isRunning = entry.status === "running";
  const isError = entry.status === "error";

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors duration-200",
        isRunning
          ? "border-blue-500/20 bg-blue-500/5"
          : isError
            ? "border-red-500/20 bg-red-500/5"
            : "border-border/30 bg-muted/20",
        open && (isRunning ? "border-blue-500/30" : isError ? "border-red-500/30" : "border-border/50"),
      )}
    >
      {/* ステップヘッダー（クリックで展開） */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
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
            isRunning
              ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
              : isError
                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                : "bg-muted-foreground/10 text-muted-foreground",
          )}
        >
          {toolIcon(entry.toolName)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          <span className="text-muted-foreground/50 mr-1.5 tabular-nums">
            Step {entry.step}
          </span>
          <span className="text-foreground/80">{toolLabel(entry.toolName)}</span>
        </span>
        <StatusBadge status={entry.status} />
      </button>

      {/* ステップ詳細（展開時のみ） */}
      {open && (
        <div className="space-y-2 px-3 pb-3 pt-1 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* 引数 */}
          {entry.args && Object.keys(entry.args).length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                引数
              </span>
              <pre className="mt-0.5 rounded bg-background/60 border border-border/20 px-2.5 py-1.5 text-[11px] font-mono text-foreground/70 overflow-x-auto whitespace-pre-wrap">
                {formatJSON(entry.args)}
              </pre>
            </div>
          )}

          {/* 結果 */}
          {entry.result && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                結果
              </span>
              <pre
                className={cn(
                  "mt-0.5 rounded px-2.5 py-1.5 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap",
                  isError
                    ? "bg-red-500/5 border border-red-500/10 text-red-600/80 dark:text-red-400/80"
                    : "bg-background/60 border border-border/20 text-foreground/70",
                )}
              >
                {entry.result}
              </pre>
            </div>
          )}

          {/* 実行中で結果がない場合のプレースホルダー */}
          {isRunning && !entry.result && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
              実行中...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ステップ実行ログを折りたたみ可能な形式で表示するパネル。
 *
 * - トップレベル: ログ全体の開閉
 * - 各ステップ行: 個別に開閉可能
 * - ステータス（成功/エラー/実行中）がひと目でわかる
 */
export function StepLogPanel({ stepLogs, isLive }: StepLogPanelProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const errorCount = stepLogs.filter((s) => s.status === "error").length;
  const runningCount = stepLogs.filter((s) => s.status === "running").length;

  if (stepLogs.length === 0) return null;

  // 最初のステップのみデフォルトで開く（ライブ時は running のステップを開く）
  const defaultOpenIndex = (idx: number) =>
    isLive ? stepLogs[idx]?.status === "running" : idx === 0;

  return (
    <div className="mt-2">
      {/* トグルヘッダー */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
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
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
            isLive
              ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
              : "bg-muted-foreground/10 text-muted-foreground",
          )}
        >
          {isLive ? "▶" : "📋"}
        </span>
        <span className="min-w-0 flex-1 text-xs font-medium text-foreground/80">
          {isLive ? "ライブ実行ログ" : "実行ログ"}
        </span>

        {/* ステータスサマリー */}
        <div className="flex items-center gap-1.5">
          {isLive && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
          )}
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {stepLogs.length} ステップ
          </span>
          {runningCount > 0 && (
            <span className="text-[11px] text-blue-500 font-medium tabular-nums">
              ({runningCount} 実行中)
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-[11px] text-red-500 font-medium tabular-nums">
              ({errorCount} エラー)
            </span>
          )}
        </div>
      </button>

      {/* ログ一覧（展開時） */}
      {panelOpen && (
        <div className="space-y-1.5 px-2 pb-2 pt-1.5 animate-in fade-in slide-in-from-top-1 duration-150 border border-border/20 rounded-b-lg bg-muted/10">
          {stepLogs.map((entry, idx) => (
            <StepRow
              key={`${entry.step}-${entry.toolName}-${idx}`}
              entry={entry}
              defaultOpen={defaultOpenIndex(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
