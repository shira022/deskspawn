import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Bot, User, Pencil, Check, X, Copy, CheckCheck, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { StepLogPanel } from "@/components/chat/StepLogPanel";
import { useAppStore } from "@/store/useAppStore";
import type { ChatMessage as ChatMessageType } from "@/types";

interface ChatMessageProps {
  message: ChatMessageType;
  showAvatar?: boolean;
  onEdit?: (id: string, newContent: string) => void;
  onRegenerate?: () => void;
  /** e.g. "2/4" — the checkpoint slider position corresponding to this assistant message */
  checkpointLabel?: string;
  /** 0-based index into the checkpoints array */
  checkpointIndex?: number;
  /** Total number of checkpoints (for ◀▶ disable logic) */
  checkpointCount?: number;
  /** Navigate to a specific checkpoint by index */
  onNavigateToCheckpoint?: (index: number) => void;
}

export function ChatMessage({
  message,
  showAvatar = true,
  onEdit,
  onRegenerate,
  checkpointLabel,
  checkpointIndex,
  checkpointCount,
  onNavigateToCheckpoint,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editingMessageId = useAppStore((s) => s.editingMessageId);
  const isThisEditing = editingMessageId === message.id;

  // Fit textarea height to content
  const fitTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 400) + "px";
  };

  // Auto-focus and set height when entering edit mode
  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      fitTextarea(editTextareaRef.current);
    }
  }, [isEditing]);

  // Sync external editing state
  useEffect(() => {
    if (isThisEditing && !isEditing) {
      setIsEditing(true);
      setEditValue(message.content);
    } else if (!isThisEditing && isEditing) {
      setIsEditing(false);
    }
  }, [isThisEditing, message.content]);

  const handleSaveEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && onEdit) {
      onEdit(message.id, trimmed);
    }
    setIsEditing(false);
    useAppStore.getState().setEditingMessageId(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(message.content);
    useAppStore.getState().setEditingMessageId(null);
  };

  const handleStartEdit = () => {
    setEditValue(message.content);
    useAppStore.getState().setEditingMessageId(message.id);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-resize edit textarea
  useEffect(() => {
    const el = editTextareaRef.current;
    if (el && isEditing) {
      fitTextarea(el);
    }
  }, [editValue, isEditing]);

  // System messages (errors, etc.)
  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="rounded-lg bg-warning/10 border border-warning/20 px-4 py-2 text-xs text-warning-foreground max-w-[90%]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
      style={{ animationFillMode: "both" }}
    >
      {/* Avatar */}
      {showAvatar ? (
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-0.5",
            isUser ? "bg-primary" : "bg-muted"
          )}
        >
          {isUser ? (
            <User className="h-4 w-4 text-primary-foreground" />
          ) : (
            <Bot className="h-4 w-4 text-foreground" />
          )}
        </div>
      ) : (
        <div className="w-8 shrink-0" />
      )}

      {/* Content */}
      <div className={cn("max-w-[85%] min-w-0", isUser && "items-end flex flex-col")}>
        {/* Message bubble (also serves as edit container) */}
        <div
          className={cn(
            "rounded-2xl overflow-hidden",
            isUser
              ? cn(
                  "bg-primary text-primary-foreground rounded-br-md",
                  isEditing && "bg-primary/80"
                )
              : "bg-muted/50 rounded-bl-md border border-border/30",
            isEditing && "ring-2 ring-primary-foreground/20"
          )}
        >
          {isEditing ? (
            <div className="grid grid-cols-1">
              {/* Invisible <p> — preserves the text-responsive bubble width */}
              <p
                className="invisible col-start-1 row-start-1 whitespace-pre-wrap text-sm px-4 py-2.5"
                aria-hidden="true"
              >
                {editValue}
              </p>
              <textarea
                ref={editTextareaRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                  if (e.key === "Escape") {
                    handleCancelEdit();
                  }
                }}
                rows={1}
                className="col-start-1 row-start-1 block w-full min-w-0 resize-none overflow-hidden text-sm bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 px-4 py-2.5"
              />
            </div>
          ) : isUser ? (
            <p className="text-sm whitespace-pre-wrap px-4 py-2.5">{message.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm px-4 py-2.5 [&>p]:mb-1 [&>ul]:mt-1 [&>p:last-child]:mb-0">
              <MessageContent content={message.content} />
              {/* 実行ログ（展開/折りたたみ可能） */}
              {message.stepLogs && message.stepLogs.length > 0 && (
                <StepLogPanel stepLogs={message.stepLogs} />
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div
          className={cn(
            "flex items-center gap-1 mt-1 h-5",
            isEditing ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            "transition-opacity duration-150",
            isUser ? "flex-row-reverse" : "flex-row"
          )}
        >
          {isUser && (
            isEditing ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  title="保存"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  title="キャンセル"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                {onEdit && (
                  <button
                    onClick={handleStartEdit}
                    className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="編集"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="リトライ"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )
          )}
          {isAssistant && (
            <button
              onClick={handleCopy}
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title={copied ? "コピーしました" : "コピー"}
            >
              {copied ? (
                <CheckCheck className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {isAssistant && onRegenerate && (
            <button
              onClick={onRegenerate}
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="再生成"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          )}
        </div>

        {/* ── Editing indicator ── */}
        {isEditing && (
          <span className="mt-0.5 text-[10px] text-muted-foreground/30 select-none">
            編集中…
          </span>
        )}

        {/* ── Checkpoint navigation (assistant messages only) ── */}
        {isAssistant && checkpointLabel && onNavigateToCheckpoint && (
          <div className="flex items-center gap-0.5 mt-0.5 text-[10px] text-muted-foreground/40 select-none">
            <button
              onClick={() => onNavigateToCheckpoint(checkpointIndex! - 1)}
              disabled={checkpointIndex === 0}
              className="h-4 w-4 flex items-center justify-center rounded hover:text-foreground/70 hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title="1つ前の状態に戻る"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span
              className="tabular-nums cursor-pointer hover:text-foreground/60 transition-colors px-0.5 leading-none"
              onClick={() => onNavigateToCheckpoint(checkpointIndex!)}
              title="このチェックポイントに戻る"
            >
              {checkpointLabel}
            </span>
            <button
              onClick={() => onNavigateToCheckpoint(checkpointIndex! + 1)}
              disabled={checkpointIndex === checkpointCount! - 1}
              className="h-4 w-4 flex items-center justify-center rounded hover:text-foreground/70 hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title="1つ先の状態に進む"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple markdown-like rendering */
function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bold text
    if (line.startsWith("**") && line.endsWith("**")) {
      elements.push(
        <p key={i} className="font-semibold">{line.slice(2, -2)}</p>
      );
      i++;
      continue;
    }

    // Inline code
    if (line.startsWith("`") && line.endsWith("`")) {
      elements.push(
        <code key={i} className="bg-background px-1 py-0.5 rounded text-xs">{line.slice(1, -1)}</code>
      );
      i++;
      continue;
    }

    // List items
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={i} className="list-disc pl-4 space-y-0.5">
          {items.map((item, j) => (
            <li key={j} className="text-sm">
              <InlineCode text={item} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Regular paragraph (skip empty lines)
    if (line.trim()) {
      elements.push(
        <p key={i} className="text-sm whitespace-pre-wrap">
          <InlineCode text={line} />
        </p>
      );
    }
    i++;
  }

  return <>{elements}</>;
}

/** Render inline `code` within text */
function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="bg-background px-1 py-0.5 rounded text-xs font-mono">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
