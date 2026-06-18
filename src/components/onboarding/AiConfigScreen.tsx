import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProviderKind, AiConfig, ModelInfo } from "@/types";
import { useModels } from "@/hooks/useModels";
import { hasApiKey, loadProviderConfig } from "@/lib/storage";
import {
  Sparkles,
  ChevronRight,
  Globe,
  Cloud,
  Cpu,
  Server,
  HardDrive,
  Container,
  Zap,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

const providerNeedsApiKey = (p: ProviderKind) => p !== "ollama";

const apiKeyPlaceholder: Record<ProviderKind, string> = {
  openai: "sk-proj-...",
  anthropic: "sk-ant-api03-...",
  google: "AIzaSy...",
  "amazon-bedrock": "bedrock-api-key-...",
  "azure-openai": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "google-vertex": "AIzaSy...",
  ollama: "",
  custom: "Enter your API key",
};

export function AiConfigScreen() {
  const { setPhase, setAiConfig, aiConfig: existingConfig } = useAppStore();
  const { t } = useTranslation();
  const providers: { id: ProviderKind; name: string; icon: React.ReactNode; description: string }[] = [
    { id: "openai", name: "OpenAI", icon: <Sparkles className="h-5 w-5" />, description: "GPT" },
    { id: "anthropic", name: "Anthropic", icon: <Cloud className="h-5 w-5" />, description: "Claude" },
    { id: "google", name: "Google", icon: <Globe className="h-5 w-5" />, description: "Gemini" },
    { id: "amazon-bedrock", name: t('ai.providerAmazonBedrock'), icon: <HardDrive className="h-5 w-5" />, description: t('ai.providerAmazonBedrockDesc') },
    { id: "azure-openai", name: t('ai.providerAzureOpenAI'), icon: <Container className="h-5 w-5" />, description: t('ai.providerAzureOpenAIDesc') + ' (Coming Soon)' },
    { id: "google-vertex", name: t('ai.providerGcpVertexAI'), icon: <Zap className="h-5 w-5" />, description: t('ai.providerGcpVertexAIDesc') + ' (Coming Soon)' },
    { id: "ollama", name: "Ollama", icon: <Cpu className="h-5 w-5" />, description: t('ai.providerOllamaDesc') },
    { id: "custom", name: t('ai.providerCustom'), icon: <Server className="h-5 w-5" />, description: t('ai.providerCustomDesc') },
  ];
  const initialProvider = existingConfig?.provider === "google-vertex" || existingConfig?.provider === "azure-openai" ? "openai" : existingConfig?.provider;
  const [provider, setProvider] = useState<ProviderKind>(
    initialProvider ?? "openai",
  );
  const [apiKey, setApiKey] = useState(
    // In browser mode, existing apiKey may already be in the store.
    // In Tauri mode, it's empty (keychain) — user must re-enter to change.
    existingConfig?.apiKey ?? "",
  );
  const [model, setModel] = useState(existingConfig?.model ?? "");
  const [customEndpoint, setCustomEndpoint] = useState(
    existingConfig?.customEndpoint ?? "",
  );
  const [region, setRegion] = useState(
    existingConfig?.region ?? "",
  );
  const [error, setError] = useState("");
  // Track whether the CURRENT provider has a saved key (per-provider)
  const [providerKeyConfigured, setProviderKeyConfigured] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(true);
  // Model discovery
  const { models, loading: modelsLoading, error: modelsError, fetchModels } = useModels({
    provider,
    customEndpoint,
    apiKey,
  });
  const [selectedModelInfo, setSelectedModelInfo] = useState<ModelInfo | null>(null);

  const showApiKey = providerNeedsApiKey(provider);

  // Fetch models when provider or custom endpoint changes
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Auto-select first model when list loads
  useEffect(() => {
    if (models.length > 0 && !model) {
      setModel(models[0].id);
      setSelectedModelInfo(models[0]);
    }
  }, [models, model]);

  // Update selected model info when model changes
  useEffect(() => {
    const info = models.find((m) => m.id === model) ?? null;
    setSelectedModelInfo(info);
  }, [model, models]);

  // Azure OpenAI: モデル一覧が空のため、プロバイダー切替時に強制的に空にする
  // auto-select より後に実行することで上書きする
  const prevProviderRef = useRef(provider);
  useEffect(() => {
    if (provider === "azure-openai" && prevProviderRef.current !== "azure-openai") {
      setModel("");
      setSelectedModelInfo(null);
    }
    prevProviderRef.current = provider;
  }, [provider]);

  // Async-check whether the current provider has a configured key
  useEffect(() => {
    if (!showApiKey) {
      setProviderKeyConfigured(false);
      setShowApiKeyInput(false);
      return;
    }
    hasApiKey(provider).then((configured) => {
      setProviderKeyConfigured(configured);
      setShowApiKeyInput(!configured);
    });
  }, [showApiKey, provider]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleProviderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = e.target.value as ProviderKind;
    if (p === "google-vertex" || p === "azure-openai") return; // 未実装
    setProvider(p);
    setModel("");
    setSelectedModelInfo(null);
    setRegion("");
    setCustomEndpoint("");
    if (p === "ollama") {
      setApiKey("");
    }

    // Load saved config for the new provider (endpoint, region, model)
    try {
      const savedCfg = await loadProviderConfig(p);
      if (savedCfg) {
        if (savedCfg.model) setModel(savedCfg.model);
        if (savedCfg.customEndpoint) setCustomEndpoint(savedCfg.customEndpoint);
        if (savedCfg.region) setRegion(savedCfg.region);
      }
    } catch {
      // Non-critical — keep defaults
    }
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "__custom__") {
      setModel("");
      setSelectedModelInfo(null);
    } else {
      setModel(value);
    }
  };

  const handleNext = async () => {
    setError("");

    // If the key is managed by storage and user didn't change it,
    // send empty apiKey with apiKeyConfigured=true so it keeps the existing entry.
    const hasExistingKey = providerKeyConfigured && !showApiKeyInput;
    const resolvedApiKey = hasExistingKey ? "" : apiKey.trim();

    if (showApiKey && !resolvedApiKey && !hasExistingKey) {
      setError(t('ai.error.apiKeyRequired'));
      return;
    }
    if (!model.trim()) {
      setError(t('ai.error.modelRequired'));
      return;
    }
    if (provider === "custom" && !customEndpoint.trim()) {
      setError(t('ai.error.customEndpointRequired'));
      return;
    }
      if (provider === "amazon-bedrock" && !region.trim()) {
      setError(t('ai.error.regionRequired'));
      return;
    }

    const config: AiConfig = {
      provider,
      apiKey: resolvedApiKey,
      model: model.trim(),
      customEndpoint: customEndpoint.trim() || undefined,
      region: region.trim() || undefined,
      apiKeyConfigured: hasExistingKey || !!resolvedApiKey,
    };

    setAiConfig(config);
    setPhase("main");
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const hasModels = models.length > 0 && !modelsLoading && !modelsError;

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto bg-gradient-to-b from-background to-muted/30 py-6 md:items-center">
      <div className="mx-auto w-full max-w-lg space-y-4 rounded-xl border bg-card p-6 shadow-lg sm:space-y-6 sm:p-8">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('ai.welcome')}</h1>
           <p className="text-sm text-muted-foreground">
             {t('ai.welcomeDescription')}
           </p>
           <p className="text-xs text-muted-foreground/60 leading-relaxed">
             {t('ai.securityNote')}
           </p>
        </div>

        <Separator />

        <ScrollArea className="max-h-[420px] min-h-[160px] sm:h-[420px]">
          <div className="space-y-5 px-1">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label>{t('ai.provider')}</Label>
              <Select value={provider} onChange={handleProviderChange}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === "google-vertex" || p.id === "azure-openai"}>
                    {p.name} - {p.description}
                  </option>
                ))}
              </Select>
            </div>

            {/* API Key */}
            {showApiKey && (
              <div className="space-y-2">
                <Label>{t('ai.apiKey')}</Label>

                {!showApiKeyInput && providerKeyConfigured ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="flex-1">
                      {t('ai.apiKey')} {t('ai.savedInBrowser') || 'encrypted in browser storage'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setShowApiKeyInput(true)}
                    >
                      {t('common.change')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      type="password"
                      placeholder={apiKeyPlaceholder[provider]}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      {provider === "openai"
                        ? t('ai.apiKeyInstructions.openai')
                        : provider === "anthropic"
                          ? t('ai.apiKeyInstructions.anthropic')
                          : provider === "amazon-bedrock"
                            ? t('ai.apiKeyInstructions.amazonBedrock')
                            : provider === "azure-openai"
                              ? t('ai.apiKeyInstructions.azureOpenAI')
                              : provider === "google-vertex"
                                ? t('ai.apiKeyInstructions.googleVertex')
                                : t('ai.apiKeyInstructions.google')}
                    </p>
                  </>
                )}

              </div>
            )}

            {/* Model Selection */}
            <div className="space-y-2">
              <Label>{t('ai.model')}</Label>

              {modelsLoading ? (
                <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('ai.loadingModels')}
                </div>
              ) : modelsError ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {modelsError}
                  </div>
                  <Input
                    placeholder={t('ai.manualModelPlaceholder')}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>
              ) : hasModels ? (
                <Select value={model} onChange={handleModelChange}>
                  {models.map((m) => (
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
                  placeholder={t('ai.modelPlaceholderWithExample')}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}

              {/* Manual input fallback */}
              {model === "" && hasModels && (
                <Input
                  className="mt-2"
                  placeholder={t('ai.manualModelId')}
                  value=""
                  onChange={(e) => setModel(e.target.value)}
                />
              )}

              {/* Selected model info */}
              {selectedModelInfo && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('ai.context')} {formatTokens(selectedModelInfo.contextLimit)}
                  </span>
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('ai.maxOutput')} {formatTokens(selectedModelInfo.maxOutput)}
                  </span>
                  {selectedModelInfo.supportsToolCall && (
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Tool Call
                    </span>
                  )}
                  {selectedModelInfo.supportsReasoning && (
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Reasoning
                    </span>
                  )}
                  {selectedModelInfo.supportsImageInput && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <Sparkles className="h-3 w-3" />
                      {t('ai.supportsImageReview')}
                    </span>
                  )}
                </div>
              )}

              {/* Model cost info */}
              {selectedModelInfo?.cost && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium">
                    {t('ai.costInput')} {formatCostRate(selectedModelInfo.cost.input)}
                  </span>
                  <span className="inline-flex items-center rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-medium">
                    {t('ai.costOutput')} {formatCostRate(selectedModelInfo.cost.output)}
                  </span>
                  {selectedModelInfo.cost.cacheRead != null && selectedModelInfo.cost.cacheRead !== selectedModelInfo.cost.input && (
                    <span className="inline-flex items-center rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 text-[10px] font-medium">
                      {t('ai.costCached')} {formatCostRate(selectedModelInfo.cost.cacheRead)}
                    </span>
                  )}
                  {selectedModelInfo.cost.reasoning != null && selectedModelInfo.cost.reasoning !== selectedModelInfo.cost.output && (
                    <span className="inline-flex items-center rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 text-[10px] font-medium">
                      {t('ai.costReasoning')} {formatCostRate(selectedModelInfo.cost.reasoning)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Custom Endpoint (optional) */}
            {(provider === "custom" || provider === "anthropic" || provider === "azure-openai") && (
              <div className="space-y-2">
                <Label>
                  {provider === "anthropic" ? t('ai.corsProxyUrl') : provider === "azure-openai" ? t('ai.azureEndpointUrl') : t('ai.customEndpoint')}
                </Label>
                <Input
                  placeholder={
                    provider === "azure-openai"
                      ? t('ai.azureEndpointPlaceholder')
                      : "https://your-api.example.com/v1"
                  }
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                />
                {provider === "anthropic" && (
                  <p className="text-xs text-muted-foreground">
                    {t('ai.anthropicCorsInfo')}
                  </p>
                )}
                {provider === "azure-openai" && (
                  <p className="text-xs text-muted-foreground">
                    {t('ai.azureEndpointDescription')}
                  </p>
                )}
              </div>
            )}

            {/* AWS Region (for Amazon Bedrock) */}
            {provider === "amazon-bedrock" && (
              <div className="space-y-2">
                <Label>{t('ai.region')}</Label>
                <Input
                  placeholder={t('ai.regionPlaceholder')}
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('ai.regionDescription')}
                </p>
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive font-medium">{error}</p>
            )}
          </div>
        </ScrollArea>

        <Separator />

        <Button onClick={handleNext} className="w-full" size="lg">
          {t('ai.nextEnvCheck')}
          <ChevronRight className="h-4 w-4" />
        </Button>

      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCostRate(rate: number): string {
  return `$${rate.toFixed(2)}/M`;
}
