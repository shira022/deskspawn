import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Square } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop?: () => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, onStop, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const agentStepCount = useAppStore((s) => s.agentStepCount);
  const agentMaxSteps = useAppStore((s) => s.agentMaxSteps);
  const isRunning = agentStatus === "running";

  const handleSend = () => {
    const trimmed = value.trim();
    if (trimmed && !disabled && !isRunning) {
      onSend(trimmed);
      setValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Enter alone creates a newline (default textarea behavior)
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }
  }, [value]);

  return (
    <div className="border-t border-border/50">
      {/* Generation overlay bar */}
      {isRunning && (
        <div className="px-3 pt-2 pb-1.5">
          <div className="flex items-center justify-between rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/40 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
              </span>
              <span className="text-xs text-destructive font-medium truncate">
                {agentStepCount > 0
                  ? `Step ${agentStepCount}/${agentMaxSteps}`
                  : "AI がコードを生成しています..."}
              </span>
            </div>
            <button
              onClick={onStop}
              className="shrink-0 flex items-center gap-1.5 rounded-full bg-destructive text-destructive-foreground pl-2.5 pr-3 py-1 text-xs font-medium shadow-sm shadow-destructive/20 hover:bg-destructive/90 active:scale-95 transition-all duration-150"
              title="生成を停止"
              style={{ animation: "pulse-ring-subtle 2s infinite" }}
            >
              <Square className="h-3 w-3 fill-current" />
              <span>停止</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 p-3 pt-1.5">
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? "生成中はチャットを送信できません..." : "作りたいアプリを指示してください..."}
            className={cn(
              "min-h-[40px] max-h-[120px] resize-none pr-10 transition-[border-color,box-shadow] duration-300",
              isRunning && "border-destructive/40 focus-visible:border-destructive/60 focus-visible:ring-destructive/20"
            )}
            disabled={disabled || isRunning}
            rows={1}
          />
          {!isRunning && !value.trim() && (
            <div className="absolute right-3 bottom-2.5 text-muted-foreground/40 pointer-events-none select-none">
              <kbd className="text-[10px] border border-border rounded px-1 py-0.5 font-sans">Shift+Enter</kbd>
            </div>
          )}
        </div>

        <Button
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl"
          onClick={handleSend}
          disabled={disabled || !value.trim() || isRunning}
          title="送信 (Shift+Enter)"
        >
          <Send className={cn("h-4 w-4", isRunning && "opacity-50")} />
        </Button>
      </div>
    </div>
  );
}
