import { useRef, useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Bot, Loader2, Wrench } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/types";

const SIDECAR_URL = "http://localhost:3001/chat";

export function ChatPanel() {
  const { messages, agentStatus, addMessage, setAgentStatus, setAgentStepCount, setWorkspaceReady } =
    useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [toolCalls, setToolCalls] = useState<string[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, toolCalls]);

  const handleSend = async (content: string) => {
    const userMsg: ChatMessageType = {
      id: `msg-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setToolCalls([]);

    setAgentStatus("running");
    setAgentStepCount(0);

    try {
      await callSidecar(content, addMessage, setAgentStepCount, setToolCalls, setWorkspaceReady);
      setAgentStatus("complete");
      setWorkspaceReady(true);
    } catch (e) {
      console.error("Sidecar error:", e);
      addMessage({
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ エラーが発生しました: ${String(e)}\n\nサイドカーサーバーが起動しているか確認してください。\n\`npm run sidecar server\` を実行してください。`,
        timestamp: Date.now(),
      });
      setAgentStatus("error");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-2 border-b px-3">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">チャット</span>
        {agentStatus === "running" && (
          <span className="ml-auto text-xs text-muted-foreground animate-pulse flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            AI がコードを生成しています...
          </span>
        )}
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1" viewportClassName="p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
              <Bot className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium mb-1">DeskSpawn チャット</h3>
            <p className="text-xs text-muted-foreground max-w-xs">
              「タスク管理アプリにして」「ダークモードを追加して」など、
              作りたいアプリを自由に指示してください。
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              Ollama qwen3.5:4b を使用中
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
              {[
                "カウンターアプリにスタイルをつけて",
                "ToDoリストアプリにして",
                "ダークモード対応にして",
                "タイマー機能を追加して",
              ].map((s) => (
                <button
                  key={s}
                  className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                  onClick={() => handleSend(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {/* Tool call progress */}
            {toolCalls.map((tc, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                <Wrench className="h-3 w-3" />
                <span>{tc}</span>
              </div>
            ))}
          </>
        )}
      </ScrollArea>

      <Separator />

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={agentStatus === "running"} />
    </div>
  );
}

// ── Actual sidecar call via SSE ──────────────────────────────────────────────

interface SSEMessage {
  type: "tool_call" | "text" | "error" | "done";
  toolName?: string;
  args?: Record<string, unknown>;
  text?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  steps?: number;
}

async function callSidecar(
  prompt: string,
  addMessage: (msg: ChatMessageType) => void,
  setStep: (step: number) => void,
  setToolCalls: (calls: string[]) => void,
  setWorkspaceReady: (ready: boolean) => void
) {
  const response = await fetch(SIDECAR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      config: {
        provider: "ollama",
        model: "qwen3.5:4b",
        temperature: 0.2,
        maxTokens: 4096,
      },
      maxSteps: 10,
    }),
  });

  if (!response.ok) {
    throw new Error(`Sidecar responded with ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  const activeToolCalls: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6);
      try {
        const msg: SSEMessage = JSON.parse(jsonStr);

        if (msg.type === "tool_call") {
          const label = `${msg.toolName}(${JSON.stringify(msg.args).substring(0, 60)}${JSON.stringify(msg.args).length > 60 ? "..." : ""})`;
          activeToolCalls.push(label);
          setToolCalls([...activeToolCalls]);
          if (msg.stepNumber) setStep(msg.stepNumber);
        } else if (msg.type === "text") {
          fullText = msg.text;
        } else if (msg.type === "error") {
          throw new Error(msg.error);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (fullText) {
    addMessage({
      id: `msg-bot-${Date.now()}`,
      role: "assistant",
      content: fullText,
      timestamp: Date.now(),
    });
  }
  setToolCalls([]);
  setWorkspaceReady(true);
}
