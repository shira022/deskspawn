import { useState, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { FileTreePanel } from "@/components/file-tree/FileTreePanel";
import { SpawnDialog } from "@/components/spawn/SpawnDialog";
import { StatusBar } from "@/components/layout/StatusBar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  LayoutPanelLeft,
  PanelsLeftRight,
  LayoutPanelTop,
  Cpu,
  Sparkles,
  Cloud,
  Globe,
  Server,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { ProviderKind, AiConfig } from "@/types";

const layoutIcons: Record<string, React.ReactNode> = {
  "2-pane": <PanelsLeftRight className="h-4 w-4" />,
  "3-pane": <LayoutPanelLeft className="h-4 w-4" />,
};

const layoutLabels: Record<string, string> = {
  "2-pane": "2ペイン（チャット＋プレビュー）",
  "3-pane": "3ペイン（ファイル＋チャット＋プレビュー）",
};

const providerIcons: Record<ProviderKind, React.ReactNode> = {
  openai: <Sparkles className="h-3.5 w-3.5" />,
  anthropic: <Cloud className="h-3.5 w-3.5" />,
  google: <Globe className="h-3.5 w-3.5" />,
  ollama: <Cpu className="h-3.5 w-3.5" />,
  custom: <Server className="h-3.5 w-3.5" />,
};

const providerLabels: Record<ProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  ollama: "Ollama",
  custom: "カスタム",
};

const providerModels: Record<ProviderKind, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-flash",
  ollama: "",
  custom: "",
};

export function MainLayout() {
  const {
    layoutMode,
    setLayoutMode,
    aiConfig,
    setAiConfig,
  } = useAppStore();
  const [showSpawn, setShowSpawn] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);

  const currentProvider: ProviderKind = (aiConfig?.provider as ProviderKind) ?? "ollama";
  const currentModel = aiConfig?.model ?? null;
  const hasConfig = aiConfig !== null;

  const toggleLayout = () => {
    setLayoutMode(layoutMode === "2-pane" ? "3-pane" : "2-pane");
  };

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const provider = e.target.value as ProviderKind;
      const model = providerModels[provider];
      setAiConfig({
        provider,
        apiKey: aiConfig?.apiKey ?? "",
        model,
        temperature: aiConfig?.temperature ?? 0.2,
        maxTokens: aiConfig?.maxTokens ?? 4096,
      });
    },
    [aiConfig, setAiConfig],
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!aiConfig) return;
      setAiConfig({ ...aiConfig, model: e.target.value });
    },
    [aiConfig, setAiConfig],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-10 items-center justify-between border-b bg-muted/30 px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">DeskSpawn</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Model selector */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 gap-1.5 px-2 ${!hasConfig ? "text-muted-foreground" : ""}`}
              onClick={() => setShowModelSettings(!showModelSettings)}
            >
              {hasConfig ? (
                <>
                  {providerIcons[currentProvider]}
                  <span className="text-xs max-w-[80px] truncate">{currentModel}</span>
                </>
              ) : (
                <>
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="text-xs">AI未設定</span>
                </>
              )}
              <Settings2 className="h-3 w-3 text-muted-foreground" />
            </Button>

            {showModelSettings && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowModelSettings(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border bg-card shadow-xl">
                  <div className="p-3 space-y-3">
                    {!hasConfig ? (
                      <div className="text-center py-2">
                        <p className="text-sm text-muted-foreground mb-2">AI設定が行われていません</p>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setShowModelSettings(false);
                            useAppStore.getState().setPhase("ai-config");
                          }}
                        >
                          AI設定画面へ
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                            プロバイダー
                          </label>
                          <Select
                            value={currentProvider}
                            onChange={handleProviderChange}
                            className="h-8 text-xs"
                          >
                            {Object.entries(providerLabels).map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                            モデル名
                          </label>
                          <Input
                            value={currentModel ?? ""}
                            onChange={handleModelChange}
                            className="h-8 text-xs"
                            placeholder="モデル名を入力"
                          />
                        </div>

                        <Separator />

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 flex-1 text-xs"
                            onClick={() => {
                              setShowModelSettings(false);
                              useAppStore.getState().setPhase("ai-config");
                            }}
                          >
                            APIキー設定
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 flex-1 text-xs"
                            onClick={() => setShowModelSettings(false)}
                          >
                            閉じる
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setShowSpawn(true)}
          >
            <LayoutPanelTop className="mr-1 h-4 w-4" />
            <span className="text-xs">Spawn .exe</span>
          </Button>

          <Tooltip content={layoutLabels[layoutMode]}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleLayout}
            >
              {layoutIcons[layoutMode]}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {layoutMode === "2-pane" ? (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={40} minSize={25}>
              <ChatPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={60} minSize={30}>
              <PreviewPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={18} minSize={12}>
              <FileTreePanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={37} minSize={20}>
              <ChatPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={45} minSize={25}>
              <PreviewPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Spawn Dialog */}
      <SpawnDialog open={showSpawn} onOpenChange={setShowSpawn} />
    </div>
  );
}
