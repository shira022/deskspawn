import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/types";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary" : "bg-muted"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-foreground" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "rounded-lg px-3 py-2 max-w-[85%] min-w-0",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&>p]:mb-1 [&>ul]:mt-1 [&>p:last-child]:mb-0">
            <MessageContent content={message.content} />
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
