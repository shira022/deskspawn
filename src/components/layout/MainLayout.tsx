import { useState, useCallback, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { FileTreePanel } from "@/components/file-tree/FileTreePanel";
import { SpawnDialog } from "@/components/spawn/SpawnDialog";
import { NewAppDialog } from "@/components/project/NewAppDialog";
import { ProjectSwitcher } from "@/components/project/ProjectSwitcher";
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
  Loader2,
  AlertCircle,
  FolderKanban,
  ChevronDown,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { ProviderKind, AiConfig, ModelInfo } from "@/types";

const SIDECAR_BASE = "http://localhost:3001";

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

const providerRepModel: Record<ProviderKind, string> = {
  openai: "GPT",
  anthropic: "Claude",
  google: "Gemini",
  ollama: "ローカルLLM",
  custom: "OpenAI 互換",
};

export function MainLayout() {
  const {
    layoutMode,
    setLayoutMode,
    aiConfig,
    setAiConfig,
    currentProjectId,
    projects,
    projectSwitching,
  } = useAppStore();
  const [showSpawn, setShowSpawn] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const [showNewApp, setShowNewApp] = useState(false);

  const currentProvider: ProviderKind = (aiConfig?.provider as ProviderKind) ?? "ollama";
  const currentModel = aiConfig?.model ?? null;
  const hasConfig = aiConfig !== null;

  // Model discovery for toolbar popover
  const [toolbarModels, setToolbarModels] = useState<ModelInfo[]>([]);
  const [toolbarModelsLoading, setToolbarModelsLoading] = useState(false);
  const [toolbarModelsError, setToolbarModelsError] = useState("");

  const fetchToolbarModels = useCallback(async () => {
    if (!hasConfig) return;
    setToolbarModelsLoading(true);
    setToolbarModelsError("");

    try {
      const params = new URLSearchParams({ provider: currentProvider });
      if (aiConfig.customEndpoint && (currentProvider === "custom" || currentProvider === "ollama")) {
        params.set("customEndpoint", aiConfig.customEndpoint);
      }
      if (aiConfig.apiKey && currentProvider === "custom") {
        params.set("apiKey", aiConfig.apiKey);
      }

      const res = await fetch(`${SIDECAR_BASE}/api/models?${params}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as any).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setToolbarModels(data.models ?? []);
    } catch (e: any) {
      setToolbarModelsError(e.message || "Failed to fetch models");
    } finally {
      setToolbarModelsLoading(false);
    }
  }, [hasConfig, currentProvider, aiConfig?.customEndpoint, aiConfig?.apiKey]);

  // Fetch models when popover opens
  useEffect(() => {
    if (showModelSettings && hasConfig) {
      // Reset to trigger re-fetch when provider changed
      setToolbarModels([]);
      fetchToolbarModels();
    }
  }, [showModelSettings, currentProvider, hasConfig, fetchToolbarModels]);

  const toggleLayout = () => {
    setLayoutMode(layoutMode === "2-pane" ? "3-pane" : "2-pane");
  };

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const provider = e.target.value as ProviderKind;
      setAiConfig({
        provider,
        apiKey: aiConfig?.apiKey ?? "",
        model: "",
        temperature: aiConfig?.temperature ?? 0.2,
        maxTokens: aiConfig?.maxTokens ?? 4096,
      });
    },
    [aiConfig, setAiConfig],
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!aiConfig) return;
      const value = e.target.value;
      if (value === "__custom__") {
        setAiConfig({ ...aiConfig, model: "" });
      } else {
        setAiConfig({ ...aiConfig, model: value });
      }
    },
    [aiConfig, setAiConfig],
  );

  const handleModelInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!aiConfig) return;
      setAiConfig({ ...aiConfig, model: e.target.value });
    },
    [aiConfig, setAiConfig],
  );

  const hasToolbarModels = toolbarModels.length > 0 && !toolbarModelsLoading && !toolbarModelsError;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-10 items-center justify-between border-b bg-muted/30 px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">DeskSpawn</span>

          <Separator orientation="vertical" className="h-4" />

          {/* Project selector */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={() => setShowProjectSwitcher(!showProjectSwitcher)}
            >
              <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs max-w-[100px] truncate">
                {currentProjectId
                  ? projects.find((p) => p.id === currentProjectId)?.name || "プロジェクト"
                  : "プロジェクト未選択"}
              </span>
              {projectSwitching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              )}
            </Button>

            <ProjectSwitcher
              open={showProjectSwitcher}
              onOpenChange={setShowProjectSwitcher}
              onNewApp={() => setShowNewApp(true)}
            />
          </div>

          {/* New App button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={() => setShowNewApp(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-xs">新規アプリ</span>
          </Button>
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
                  <span className="text-xs max-w-[80px] truncate">{currentModel || "未選択"}</span>
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
                                {label} - {providerRepModel[id as ProviderKind]}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                            モデル
                          </label>

                          {toolbarModelsLoading ? (
                            <div className="flex items-center gap-1.5 h-8 px-2 rounded border bg-muted/30 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              取得中...
                            </div>
                          ) : toolbarModelsError ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                <AlertCircle className="h-3 w-3" />
                                {toolbarModelsError}
                              </div>
                              <Input
                                value={currentModel ?? ""}
                                onChange={handleModelInputChange}
                                className="h-8 text-xs"
                                placeholder="モデル名を入力"
                              />
                            </div>
                          ) : hasToolbarModels ? (
                            <Select
                              value={currentModel ?? ""}
                              onChange={handleModelChange}
                              className="h-8 text-xs"
                            >
                              <option value="" disabled>
                                モデルを選択...
                              </option>
                              {toolbarModels.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                              <option disabled>──────────</option>
                              <option value="__custom__">その他（手動入力）...</option>
                            </Select>
                          ) : (
                            <Input
                              value={currentModel ?? ""}
                              onChange={handleModelInputChange}
                              className="h-8 text-xs"
                              placeholder="モデル名を入力"
                            />
                          )}

                          {/* Manual input fallback when "その他" selected */}
                          {currentModel === "" && hasToolbarModels && (
                            <Input
                              className="h-8 text-xs mt-1.5"
                              placeholder="モデルIDを手動入力"
                              value=""
                              onChange={handleModelInputChange}
                            />
                          )}
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
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel
            defaultSize={18}
            minSize={0}
            className={layoutMode === "2-pane" ? "hidden" : ""}
          >
            <FileTreePanel />
          </ResizablePanel>
          <ResizableHandle className={layoutMode === "2-pane" ? "hidden" : ""} />
          <ResizablePanel defaultSize={37} minSize={20}>
            <ChatPanel />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={45} minSize={25}>
            <PreviewPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* Spawn Dialog */}
      <SpawnDialog open={showSpawn} onOpenChange={setShowSpawn} />

      {/* New App Dialog */}
      <NewAppDialog open={showNewApp} onOpenChange={setShowNewApp} />
    </div>
  );
}
