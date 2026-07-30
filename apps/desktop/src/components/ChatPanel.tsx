/**
 * DeskSpawn Desktop — Chat Panel
 */

import React, { useState, useRef, useCallback } from "react";
import { ServiceRegistry, type StreamChunk } from "@deskspawn/ai-core";
import { Button } from "@deskspawn/ui";
import { Send, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  config: {
    provider: string;
    model: string;
    apiKey?: string;
    customEndpoint?: string;
  };
  onStartPreview: (projectId: string, files: Record<string, string>) => Promise<void>;
}

export function ChatPanel({ config, onStartPreview }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const userMessage = input.trim();
    setInput("");
    setStreaming(true);
    setCurrentText("");

    const userMsg: Message = { role: "user", content: userMessage };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const ai = ServiceRegistry.ai;
      let fullText = "";

      await ai.streamText({
        messages: [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
        config,
        onChunk: (chunk: StreamChunk) => {
          if (chunk.type === "text") {
            fullText += chunk.content;
            setCurrentText(fullText);
          }
        },
      });

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: fullText },
      ]);
      setCurrentText("");
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${(e as Error).message}` },
      ]);
    } finally {
      setStreaming(false);
      scrollToBottom();
    }
  }, [input, streaming, messages, config, scrollToBottom]);

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Describe the app you want to build...
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {streaming && currentText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg bg-muted px-4 py-2 text-sm">
              <div className="whitespace-pre-wrap">{currentText}</div>
              <span className="inline-block h-3 w-2 animate-pulse bg-primary ml-0.5" />
            </div>
          </div>
        )}
        {streaming && !currentText && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-muted px-4 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Describe your app..."
            disabled={streaming}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button onClick={handleSend} disabled={streaming || !input.trim()}>
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
