import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Bot, User, Pencil, Check, X, Copy, CheckCheck, ChevronLeft, ChevronRight, RotateCcw, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StepLogPanel } from "@/components/chat/StepLogPanel";
import { useAppStore } from "@/store/useAppStore";
import { HighlightedText, highlightChildren } from "@/components/chat/SearchHighlight";
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
  /** Search query for highlighting matches */
  searchQuery?: string;
  /** Whether this message matches the current search */
  isMatch?: boolean;
  /** Whether this message is the currently active search match */
  isActiveMatch?: boolean;
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
  searchQuery,
  isMatch,
  isActiveMatch,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editingMessageId = useAppStore((s) => s.editingMessageId);
  const agentStatus = useAppStore((s) => s.agentStatus);
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
      id={`chat-msg-${message.id}`}
      className={cn(
        "group flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out",
        isUser ? "flex-row-reverse" : "flex-row",
        isMatch && "chat-message-match",
        isActiveMatch && "chat-message-active-match"
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
            "rounded-2xl overflow-hidden chat-bubble",
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
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
            <div className="px-4 py-2.5">
              {searchQuery ? (
                <HighlightedText
                  text={message.content}
                  query={searchQuery}
                  className="text-sm whitespace-pre-wrap break-words"
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
              )}
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm px-4 py-2.5 [&>p]:mb-1 [&>ul]:mt-1 [&>p:last-child]:mb-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words">
              <MessageContent content={message.content} searchQuery={searchQuery} />
              {/* Execution logs (collapsible) */}
              {message.stepLogs && message.stepLogs.length > 0 && (
                <StepLogPanel stepLogs={message.stepLogs} searchQuery={searchQuery} />
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
                  title={t('common.save')}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  title={t('common.cancel')}
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
                    title={t('chat.edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title={t('chat.retry')}
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
              title={copied ? t('chat.copied') : t('chat.copy')}
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
              title={t('chat.regenerate')}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* ── Editing indicator ── */}
        {isEditing && (
          <span className="mt-0.5 text-[10px] text-muted-foreground/30 select-none">{t('chat.editing')}</span>
        )}

        {/* ── Checkpoint navigation (assistant messages only) ── */}
        {isAssistant && checkpointLabel && onNavigateToCheckpoint && (
          <div className="flex items-center gap-0.5 mt-0.5 text-[10px] text-muted-foreground/40 select-none">
            <button
              onClick={() => onNavigateToCheckpoint(checkpointIndex! - 1)}
              disabled={checkpointIndex === 0 || agentStatus === "running"}
              className="h-4 w-4 flex items-center justify-center rounded hover:text-foreground/70 hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title={t('chat.prevState')}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span
              className={`tabular-nums px-0.5 leading-none transition-colors select-none ${agentStatus === "running" ? "cursor-default" : "cursor-pointer hover:text-foreground/60"}`}
              onClick={() => {
                if (agentStatus !== "running") onNavigateToCheckpoint(checkpointIndex!);
              }}
              title={t('chat.goToCheckpoint')}
            >
              {checkpointLabel}
            </span>
            <button
              onClick={() => onNavigateToCheckpoint(checkpointIndex! + 1)}
              disabled={checkpointIndex === checkpointCount! - 1 || agentStatus === "running"}
              className="h-4 w-4 flex items-center justify-center rounded hover:text-foreground/70 hover:bg-muted/60 transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title={t('chat.nextState')}
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* ── Token usage / model footer (assistant messages only) ── */}
        {isAssistant && message.usage && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-muted-foreground/30 select-none leading-relaxed">
            {/* Token breakdown */}
            <span className="tabular-nums">
              {t('ai.costInput')} {message.usage.inputTokens.toLocaleString()}
            </span>
            <span className="tabular-nums">
              {t('ai.costOutput')} {message.usage.outputTokens.toLocaleString()}
            </span>
            {message.usage.reasoningTokens != null && message.usage.reasoningTokens > 0 && (
              <span className="tabular-nums">
                {t('ai.costReasoning')} {message.usage.reasoningTokens.toLocaleString()}
              </span>
            )}
            {message.usage.cachedInputTokens != null && message.usage.cachedInputTokens > 0 && (
              <span className="tabular-nums">
                {t('ai.costCached')} {message.usage.cachedInputTokens.toLocaleString()}
              </span>
            )}
            {/* Model */}
            {message.usage.model && (
              <>
                <span className="opacity-20">|</span>
                <span className="font-mono truncate max-w-[200px]">
                  {message.usage.provider ? `${message.usage.provider}/` : ""}
                  {message.usage.model}
                </span>
              </>
            )}
            {/* Cost */}
            <span className="opacity-20">|</span>
            <span className="tabular-nums">
              ${(message.usage.estimatedCost ?? 0).toLocaleString(undefined, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 6,
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Proper markdown rendering using react-markdown */
function MessageContent({ content, searchQuery }: { content: string; searchQuery?: string }) {
  const hl = searchQuery
    ? (children: React.ReactNode) => highlightChildren(children, searchQuery)
    : (children: React.ReactNode) => children;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({ children }) {
          return (
            <pre className="bg-background border border-border/30 rounded-lg p-3 overflow-x-auto text-xs font-mono my-1.5 leading-relaxed whitespace-pre-wrap break-words">
              {children}
            </pre>
          );
        },
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          if (match) {
            return (
              <>
                <div className="text-[10px] text-muted-foreground/40 font-sans mb-1.5 uppercase tracking-wider">
                  {match[1]}
                </div>
                <code className={className} {...props}>
                  {children}
                </code>
              </>
            );
          }
          if (className) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          // Inline code with highlighting
          return (
            <code className="bg-background px-1 py-0.5 rounded text-xs font-mono" {...props}>
              {searchQuery ? highlightChildren(children, searchQuery) : children}
            </code>
          );
        },
        p({ children }) {
          return <p className="text-sm whitespace-pre-wrap">{hl(children)}</p>;
        },
        ul({ children, ...props }) {
          return <ul className="list-disc pl-4 space-y-0.5 my-1" {...props}>{hl(children)}</ul>;
        },
        ol({ children, ...props }) {
          return <ol className="list-decimal pl-4 space-y-0.5 my-1" {...props}>{hl(children)}</ol>;
        },
        li({ children, ...props }) {
          return <li className="text-sm" {...props}>{hl(children)}</li>;
        },
        h1({ children, ...props }) {
          return <h1 className="text-base font-bold my-2" {...props}>{hl(children)}</h1>;
        },
        h2({ children, ...props }) {
          return <h2 className="text-sm font-bold my-1.5" {...props}>{hl(children)}</h2>;
        },
        h3({ children, ...props }) {
          return <h3 className="text-sm font-semibold my-1" {...props}>{hl(children)}</h3>;
        },
        a({ href, children, ...props }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline" {...props}>
              {children}
            </a>
          );
        },
        blockquote({ children, ...props }) {
          return (
            <blockquote className="border-l-2 border-border/40 pl-3 my-1 text-muted-foreground/80 text-sm" {...props}>
              {hl(children)}
            </blockquote>
          );
        },
        hr(props) {
          return <hr className="my-2 border-border/20" {...props} />;
        },
        table({ children, ...props }) {
          return (
            <div className="overflow-x-auto my-1.5">
              <table className="text-xs border-collapse border border-border/30" {...props}>{children}</table>
            </div>
          );
        },
        th({ children, ...props }) {
          return <th className="border border-border/30 px-2 py-1 font-medium bg-muted/30 text-left" {...props}>{hl(children)}</th>;
        },
        td({ children, ...props }) {
          return <td className="border border-border/30 px-2 py-1" {...props}>{hl(children)}</td>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
