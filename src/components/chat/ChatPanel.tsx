import { useRef, useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Bot, Loader2, Wrench } from "lucide-react";
import type { ChatMessage as ChatMessageType, AiConfig } from "@/types";

const SIDECAR_URL = "http://localhost:3001/chat";

const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  ollama: "Ollama",
  custom: "カスタム",
};

export function ChatPanel() {
  const {
    messages,
    agentStatus,
    addMessage,
    setAgentStatus,
    setAgentStepCount,
    setWorkspaceReady,
    aiConfig,
    currentProjectId,
    projects,
    projectSwitching,
  } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [toolCalls, setToolCalls] = useState<string[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, toolCalls]);

  const handleSend = async (content: string) => {
    if (!aiConfig) {
      addMessage({
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: "⚠️ AI設定が行われていません。ツールバーの「AI未設定」ボタンから設定してください。",
        timestamp: Date.now(),
      });
      return;
    }

    if (!currentProjectId) {
      addMessage({
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: "⚠️ プロジェクトが選択されていません。ツールバーの「新規アプリ」からプロジェクトを作成するか、アプリ履歴から選択してください。",
        timestamp: Date.now(),
      });
      return;
    }

    // Validate API key for non-Ollama providers
    if (aiConfig.provider !== "ollama" && !aiConfig.apiKey) {
      addMessage({
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ ${providerLabels[aiConfig.provider] || aiConfig.provider} には API キーが必要です。\nツールバーの「${aiConfig.model || "AI未設定"}」→「APIキー設定」から設定してください。`,
        timestamp: Date.now(),
      });
      return;
    }

    const userMsg: ChatMessageType = {
      id: `msg-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setToolCalls([]);
    setAgentStepCount(0);

    setAgentStatus("running");
    setAgentStepCount(0);

    try {
      await callSidecar(content, addMessage, setAgentStepCount, setToolCalls, setWorkspaceReady, aiConfig);
      setAgentStatus("complete");
      setWorkspaceReady(true);
      // Ensure preview shows the workspace app
      const { setWorkspacePort, workspacePort } = useAppStore.getState();
      if (workspacePort === 5173) setWorkspacePort(5174);
      // Trigger preview refresh by toggling workspaceReady twice
      setTimeout(() => setWorkspaceReady(false), 100);
      setTimeout(() => setWorkspaceReady(true), 300);
    } catch (e) {
      console.error("Sidecar error:", e);
      const errMsg = String(e);
      const hint = errMsg.includes("API key") || errMsg.includes("401")
        ? "APIキーが無効か未設定です。ツールバーの「APIキー設定」から確認してください。"
        : errMsg.includes("fetch") || errMsg.includes("Load failed") || errMsg.includes("NetworkError")
          ? "サイドカーサーバーに接続できません。\nnpm run sidecar server を実行してください。"
          : `サイドカーサーバーが起動しているか確認してください。\n\`npm run sidecar server\` を実行してください。`;
      addMessage({
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ エラーが発生しました: ${errMsg}\n\n${hint}`,
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
            {useAppStore.getState().agentStepCount > 0
              ? `Step ${useAppStore.getState().agentStepCount}/${useAppStore.getState().agentMaxSteps}: コードを生成中...`
              : "AI がコードを生成しています..."}
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
            {projectSwitching ? (
              <>
                <h3 className="text-sm font-medium mb-1">プロジェクトを切り替え中...</h3>
                <p className="text-xs text-muted-foreground">新しいプロジェクトの準備ができ次第、チャットを開始できます。</p>
              </>
            ) : currentProjectId ? (
              <>
                <h3 className="text-sm font-medium mb-1">
                  {projects.find((p) => p.id === currentProjectId)?.name || "アプリ"} — DeskSpawn チャット
                </h3>
                <p className="text-xs text-muted-foreground max-w-xs">
                  「タスク管理アプリにして」「ダークモードを追加して」など、
                  作りたいアプリを自由に指示してください。
                </p>
              </>
            ) : (
              <>
                <h3 className="text-sm font-medium mb-1">DeskSpawn チャット</h3>
                <p className="text-xs text-muted-foreground max-w-xs">
                  ツールバーの「新規アプリ」からプロジェクトを作成すると、
                  チャットでアプリの構築を開始できます。
                </p>
              </>
            )}
            <p className="text-xs text-muted-foreground/60 mt-2">
              {aiConfig
                ? `${providerLabels[aiConfig.provider] || aiConfig.provider} ${aiConfig.model} を使用中`
                : "AI未設定 — ツールバーから設定してください"}
            </p>
            {currentProjectId && (
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
            )}
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
  type: "tool_call" | "tool_result" | "text" | "error" | "done" | "step_progress";
  step?: number;
  maxSteps?: number;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  detail?: Record<string, unknown>;
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
  setWorkspaceReady: (ready: boolean) => void,
  config: AiConfig | null,
) {
  const provider = config?.provider ?? "ollama";
  const model = config?.model ?? "";
  const apiKey = config?.apiKey ?? "";
  const customEndpoint = config?.customEndpoint;
  const temperature = config?.temperature ?? 0.2;
  const maxTokens = config?.maxTokens ?? 4096;

  const response = await fetch(SIDECAR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      config: { provider, model, apiKey, customEndpoint, temperature, maxTokens },
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
  let currentStep = 0;
  let maxSteps = 10;

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

        if (msg.type === "step_progress") {
          currentStep = msg.step ?? currentStep;
          maxSteps = msg.maxSteps ?? maxSteps;
          setStep(currentStep);
        } else if (msg.type === "tool_call") {
          const label = `🔧 ${msg.toolName}(${JSON.stringify(msg.args).substring(0, 60)}${JSON.stringify(msg.args).length > 60 ? "..." : ""})`;
          activeToolCalls.push(label);
          setToolCalls([...activeToolCalls]);
          if (msg.step) setStep(msg.step);
        } else if (msg.type === "tool_result") {
          const label = `   ${msg.result || "OK"}`;
          activeToolCalls.push(label);
          setToolCalls([...activeToolCalls]);
        } else if (msg.type === "text") {
          fullText = msg.text ?? "";
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
