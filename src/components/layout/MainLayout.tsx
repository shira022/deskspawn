import { useState, useCallback, useEffect } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { FileTreePanel } from "@/components/file-tree/FileTreePanel";
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
  Cpu,
  Sparkles,
  Cloud,
  Globe,
  Server,
  HardDrive,
  Container,
  Zap,
  Settings2,
  Loader2,
  AlertCircle,
  FolderKanban,
  ChevronDown,
  Plus,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { AiConfigDialog } from "@/components/settings/AiConfigDialog";
import type { ProviderKind, ThemeMode } from "@/types";
import { providerLabels } from "@/lib/constants";
import { loadProviderConfig } from "@/lib/storage";
import { useModels } from "@/hooks/useModels";

const layoutIcons: Record<string, React.ReactNode> = {
  "2-pane": <PanelsLeftRight className="h-4 w-4" />,
  "3-pane": <LayoutPanelLeft className="h-4 w-4" />,
};

const providerIcons: Record<ProviderKind, React.ReactNode> = {
  openai: <Sparkles className="h-3.5 w-3.5" />,
  anthropic: <Cloud className="h-3.5 w-3.5" />,
  google: <Globe className="h-3.5 w-3.5" />,
  ollama: <Cpu className="h-3.5 w-3.5" />,
  custom: <Server className="h-3.5 w-3.5" />,
  "amazon-bedrock": <HardDrive className="h-3.5 w-3.5" />,
  "azure-openai": <Container className="h-3.5 w-3.5" />,
  "google-vertex": <Zap className="h-3.5 w-3.5" />,
};

export function MainLayout() {
  const {
    layoutMode,
    setLayoutMode,
    aiConfig,
    setAiConfig,
    initialized,
    currentProjectId,
    projects,
    projectSwitching,
    appLoading,
    previewMaximized,
    workspaceReady,
  } = useAppStore();

  const { t } = useTranslation();

  const providerRepModel: Record<ProviderKind, string> = {
    openai: "GPT",
    anthropic: "Claude",
    google: "Gemini",
    ollama: t('ai.providerOllamaDesc'),
    custom: t('ai.providerCustomDesc'),
    "amazon-bedrock": t('ai.providerAmazonBedrockDesc'),
    "azure-openai": t('ai.providerAzureOpenAIDesc'),
    "google-vertex": t('ai.providerGcpVertexAIDesc'),
  };

  const layoutLabels: Record<string, string> = {
    "2-pane": t('layout.twoPane'),
    "3-pane": t('layout.threePane'),
  };

  const currentAppName = currentProjectId
    ? projects.find((p) => p.id === currentProjectId)?.name
    : null;
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const [showNewApp, setShowNewApp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiConfig, setShowAiConfig] = useState(false);

  const settings = useAppStore((s) => s.settings);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setAppLoading = useAppStore((s) => s.setAppLoading);

  const currentProvider: ProviderKind = (aiConfig?.provider as ProviderKind) ?? "ollama";
  const currentModel = aiConfig?.model ?? null;
  const hasConfig = aiConfig !== null;
  const needsApiKey = currentProvider !== "ollama";
  const isConfigReady = hasConfig && (!needsApiKey || aiConfig?.apiKeyConfigured === true);

  // Model discovery for toolbar popover
  const { models: toolbarModels, loading: toolbarModelsLoading, error: toolbarModelsError, fetchModels: fetchToolbarModels } = useModels({
    provider: currentProvider,
    customEndpoint: aiConfig?.customEndpoint,
    apiKey: aiConfig?.apiKey,
  });

  // Fetch models when popover opens
  useEffect(() => {
    if (showModelSettings && hasConfig) {
      fetchToolbarModels();
    }
  }, [showModelSettings, currentProvider, hasConfig, fetchToolbarModels]);

  // Auto-dismiss loading overlay when workspace is ready
  useEffect(() => {
    if (workspaceReady && appLoading) {
      setAppLoading(false);
    }
  }, [workspaceReady, appLoading, setAppLoading]);

  // Auto-open AI config dialog when no configuration exists
  useEffect(() => {
    if (initialized && !aiConfig) {
      setShowAiConfig(true);
    }
  }, [initialized, aiConfig]);

  const toggleLayout = () => {
    setLayoutMode(layoutMode === "2-pane" ? "3-pane" : "2-pane");
  };

  const handleProviderChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const provider = e.target.value as ProviderKind;
      // google-vertex / azure-openai は未実装のため選択不可
      if (provider === "google-vertex" || provider === "azure-openai") return;
      // Load saved config for the target provider to preserve model/endpoint/region
      const savedCfg = await loadProviderConfig(provider);
      setAiConfig({
        provider,
        apiKey: aiConfig?.apiKey ?? "",
        model: savedCfg?.model ?? "",
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
          <button
            onClick={() => {
              localStorage.setItem("deskspawn_route", "/");
              window.location.reload();
            }}
            className="text-sm font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
          >
            DeskSpawn
          </button>

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
                  ? projects.find((p) => p.id === currentProjectId)?.name || t('project.label')
                  : t('project.noneSelected')}
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
            <span className="text-xs">{t('project.newApp')}</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {/* Model selector */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 gap-1.5 px-2 ${!hasConfig ? "text-muted-foreground" : !isConfigReady ? "text-amber-500" : ""}`}
              onClick={() => setShowModelSettings(!showModelSettings)}
            >
              {!hasConfig ? (
                <>
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('ai.notConfiguredShort')}</span>
                </>
              ) : isConfigReady ? (
                <>
                  {providerIcons[currentProvider]}
                  <span className="text-xs max-w-[140px] truncate hidden sm:inline">{currentModel || t('common.notSelected')}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('ai.apiKeyNotSet')}</span>
                </>
              )}
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
                        <p className="text-sm text-muted-foreground mb-2">{t('ai.notConfigured')}</p>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setShowModelSettings(false);
                            setShowAiConfig(true);
                          }}
                        >
                          {t('ai.goToConfig')}
                        </Button>
                      </div>
                    ) : !isConfigReady ? (
                      <div className="text-center py-2">
                        <AlertCircle className="mx-auto h-6 w-6 text-amber-500 mb-2" />
                        <p className="text-sm text-muted-foreground mb-2">{t('ai.apiKeyNotConfiguredDetailed')}</p>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setShowModelSettings(false);
                            setShowAiConfig(true);
                          }}
                        >
                          {t('ai.goToConfig')}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                            {t('settings.provider')}
                          </label>
                          <Select
                            value={currentProvider}
                            onChange={handleProviderChange}
                            className="h-8 text-xs"
                          >
                            {Object.entries(providerLabels).map(([id, label]) => (
                              <option key={id} value={id} disabled={id === "google-vertex" || id === "azure-openai"}>
                                {label} - {providerRepModel[id as ProviderKind]}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                            {t('ai.model')}
                          </label>

                          {toolbarModelsLoading ? (
                            <div className="flex items-center gap-1.5 h-8 px-2 rounded border bg-muted/30 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t('common.loading')}
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
                                placeholder={t('ai.modelPlaceholder')}
                              />
                            </div>
                          ) : hasToolbarModels ? (
                            <Select
                              value={currentModel ?? ""}
                              onChange={handleModelChange}
                              className="h-8 text-xs"
                            >
                              <option value="" disabled>
                                {t('ai.selectModel')}
                              </option>
                              {toolbarModels.map((m) => (
                                <option
                                  key={m.id}
                                  value={m.id}
                                  title={m.supportsImageInput ? t('ai.supportsImageReview') : t('ai.textOnlyReview')}
                                >
                                  {m.supportsImageInput ? '✦ ' : '   '}{m.name}
                                </option>
                              ))}
                              <option disabled>──────────</option>
                              <option value="__custom__">{t('ai.otherManual')}</option>
                            </Select>
                          ) : (
                            <Input
                              value={currentModel ?? ""}
                              onChange={handleModelInputChange}
                              className="h-8 text-xs"
                              placeholder={t('ai.modelPlaceholder')}
                            />
                          )}

                          {/* Manual input fallback when "Other" selected */}
                          {currentModel === "" && hasToolbarModels && (
                            <Input
                              className="h-8 text-xs mt-1.5"
                              placeholder={t('ai.manualModelId')}
                              value=""
                              onChange={handleModelInputChange}

                            />
                          )}

                          {/* Model cost info */}
                          {(() => {
                            const selected = toolbarModels.find((m) => m.id === currentModel);
                            if (!selected?.cost) return null;
                            const c = selected.cost;
                            const showCached = c.cacheRead != null && c.cacheRead !== c.input;
                            const showReasoning = c.reasoning != null && c.reasoning !== c.output;
                            return (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                <span className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium">
                                  In {formatCostRate(c.input)}
                                </span>
                                <span className="inline-flex items-center rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-medium">
                                  Out {formatCostRate(c.output)}
                                </span>
                                {showCached && (
                                  <span className="inline-flex items-center rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 text-[10px] font-medium">
                                    Cache {formatCostRate(c.cacheRead!)}
                                  </span>
                                )}
                                {showReasoning && (
                                  <span className="inline-flex items-center rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 text-[10px] font-medium">
                                    Think {formatCostRate(c.reasoning!)}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        <Separator />

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 flex-1 text-xs"
                            onClick={() => {
                              setShowModelSettings(false);
                              setShowAiConfig(true);
                            }}
                          >
                            {t('ai.apiKeySettings')}
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 flex-1 text-xs"
                            onClick={() => setShowModelSettings(false)}
                          >
                            {t('common.close')}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Dark mode toggle */}
          <Tooltip content={resolvedTheme === "dark" ? t('common.switchToLight') : t('common.switchToDark')}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const next = settings.theme === "system"
                  ? (resolvedTheme === "dark" ? "light" : "dark")
                  : (settings.theme === "dark" ? "light" : "dark");
                updateSettings({ theme: next as ThemeMode });
              }}
            >
              {resolvedTheme === "dark" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </Button>
          </Tooltip>

          {/* Settings button */}
          <Tooltip content={t('settings.title')}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>

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
      <div className="flex-1 overflow-hidden relative">
        <ResizablePanelGroup
          direction="horizontal"
          className={appLoading ? "opacity-20 pointer-events-none select-none" : ""}
        >
          {layoutMode === "3-pane" && (
            <ResizablePanel defaultSize={18} minSize={0}>
              <FileTreePanel />
            </ResizablePanel>
          )}
          {layoutMode === "3-pane" && <ResizableHandle />}
          {!previewMaximized && (
            <ResizablePanel defaultSize={37} minSize={20}>
              <ChatPanel />
            </ResizablePanel>
          )}
          {!previewMaximized && <ResizableHandle />}
          <ResizablePanel defaultSize={45} minSize={25}>
            <PreviewPanel />
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* App loading overlay — shown when creating a new app */}
        {appLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-5 max-w-sm text-center px-6">
              <div className="relative">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-3 w-3 rounded-full bg-primary/20 animate-ping" />
                </div>
              </div>
              <div>
                <p className="text-base font-semibold">{t('project.preparingNewApp')}</p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  {currentAppName ? (
                    <Trans i18nKey="project.preparingWithName" values={{ appName: currentAppName }} />
                  ) : (
                    <>{t('project.preparingGeneric')}</>
                  )}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-3">
                  {t('project.autoDismiss')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:0ms]" />
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:150ms]" />
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar />

      {/* New App Dialog */}
      <NewAppDialog open={showNewApp} onOpenChange={setShowNewApp} />

      {/* Settings Dialog */}
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />

      {/* AI Config Dialog */}
      <AiConfigDialog open={showAiConfig} onOpenChange={setShowAiConfig} />
    </div>
  );
}

function formatCostRate(rate: number): string {
  return `$${rate.toFixed(2)}/M`;
}
