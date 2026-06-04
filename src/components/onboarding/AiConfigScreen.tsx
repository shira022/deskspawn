import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProviderKind, AiConfig, ModelInfo, StorageMethod } from "@/types";
import { useModels } from "@/hooks/useModels";
import {
  Sparkles,
  ChevronRight,
  Globe,
  Cloud,
  Cpu,
  Server,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  FileText,
} from "lucide-react";

const providerNeedsApiKey = (p: ProviderKind) => p !== "ollama";

export function AiConfigScreen() {
  const { setPhase, setAiConfig, aiConfig: existingConfig } = useAppStore();
  const { t } = useTranslation();
  const providers: { id: ProviderKind; name: string; icon: React.ReactNode; description: string }[] = [
    { id: "openai", name: "OpenAI", icon: <Sparkles className="h-5 w-5" />, description: "GPT" },
    { id: "anthropic", name: "Anthropic", icon: <Cloud className="h-5 w-5" />, description: "Claude" },
    { id: "google", name: "Google", icon: <Globe className="h-5 w-5" />, description: "Gemini" },
    { id: "ollama", name: "Ollama", icon: <Cpu className="h-5 w-5" />, description: t('ai.providerOllamaDesc') },
    { id: "custom", name: t('ai.providerCustom'), icon: <Server className="h-5 w-5" />, description: t('ai.providerCustomDesc') },
  ];
  const [provider, setProvider] = useState<ProviderKind>(
    existingConfig?.provider ?? "openai",
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
  const [temperature, setTemperature] = useState(
    String(existingConfig?.temperature ?? 0.2),
  );
  const [maxTokens, setMaxTokens] = useState(
    existingConfig?.maxTokens ? String(existingConfig.maxTokens) : "",
  );
  const [error, setError] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(
    // Show input if we need a key but don't have one accessible
    !existingConfig?.apiKeyConfigured || !!(existingConfig?.apiKey),
  );
  const [storageMethod, setStorageMethod] = useState<StorageMethod>(
    existingConfig?.storageMethod ?? "keychain",
  );

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

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = e.target.value as ProviderKind;
    setProvider(p);
    setModel("");
    setSelectedModelInfo(null);
    if (p === "ollama") {
      setApiKey("");
      setShowApiKeyInput(false);
    } else {
      setShowApiKeyInput(true);
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

  const handleNext = () => {
    setError("");

    // If the key is managed by storage and user didn't change it,
    // send empty apiKey with apiKeyConfigured=true so the Rust backend
    // keeps the existing entry.
    const hasExistingKey = existingConfig?.apiKeyConfigured && !showApiKeyInput;
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

    const config: AiConfig = {
      provider,
      apiKey: resolvedApiKey,
      model: model.trim(),
      customEndpoint: customEndpoint.trim() || undefined,
      temperature: parseFloat(temperature) || 0.2,
      maxTokens: maxTokens ? parseInt(maxTokens) : undefined,
      apiKeyConfigured: hasExistingKey || !!resolvedApiKey,
      storageMethod,
    };

    setAiConfig(config);
    setPhase("env-check");
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const showTemperature = !selectedModelInfo || selectedModelInfo.supportsTemperature;
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
        </div>

        <Separator />

        <ScrollArea className="max-h-[420px] min-h-[160px] sm:h-[420px]">
          <div className="space-y-5 px-1">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label>{t('ai.provider')}</Label>
              <Select value={provider} onChange={handleProviderChange}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {p.description}
                  </option>
                ))}
              </Select>
            </div>

            {/* API Key */}
            {showApiKey && (
              <div className="space-y-2">
                <Label>{t('ai.apiKey')}</Label>

                {!showApiKeyInput && existingConfig?.apiKeyConfigured ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="flex-1">
                      {t('ai.apiKey')} {t('ai.savedIn')}{' '}
                      {storageMethod === "keychain"
                        ? t('ai.keychain')
                        : "credentials.json"}
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
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      {provider === "openai"
                        ? t('ai.apiKeyInstructions.openai')
                        : provider === "anthropic"
                          ? t('ai.apiKeyInstructions.anthropic')
                          : t('ai.apiKeyInstructions.google')}
                    </p>
                  </>
                )}

                {/* Storage method selector */}
                <div className="space-y-2 pt-1">
                  <Label>{t('ai.storageMethod')}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setStorageMethod("keychain")}
                      className={`flex items-start gap-2.5 rounded-md border p-3 text-left text-sm transition-colors ${
                        storageMethod === "keychain"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/30"
                      }`}
                    >
                      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="font-medium">{t('ai.keychain')}</div>
                        <div className="text-xs text-muted-foreground">
                          {t('common.recommended')}
                        </div>
                      </div>
                      {storageMethod === "keychain" && (
                        <div className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                          <div className="h-2 w-2 rounded-full bg-primary-foreground" />
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStorageMethod("file")}
                      className={`flex items-start gap-2.5 rounded-md border p-3 text-left text-sm transition-colors ${
                        storageMethod === "file"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/30"
                      }`}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="font-medium">{t('ai.file')}</div>
                        <div className="text-xs text-muted-foreground">
                          credentials.json
                        </div>
                      </div>
                      {storageMethod === "file" && (
                        <div className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
                          <div className="h-2 w-2 rounded-full bg-primary-foreground" />
                        </div>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {storageMethod === "keychain"
                      ? t('ai.keychainDescription')
                      : t('ai.fileDescription')}
                  </p>
                </div>
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

            {/* Custom Endpoint */}
            {provider === "custom" && (
              <div className="space-y-2">
                <Label>{t('ai.customEndpoint')}</Label>
                <Input
                  placeholder="https://your-api.example.com/v1"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                />
              </div>
            )}

            {/* Advanced Options */}
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">{t('ai.advancedSettings')}</p>
              <div className={`grid gap-3 ${showTemperature ? "grid-cols-2" : "grid-cols-1"}`}>
                {showTemperature && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Temperature</Label>
                    <Input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Tokens</Label>
                  <Input
                    type="number"
                    min="1"
                    max="200000"
                    placeholder={t('common.auto')}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                  />
                </div>
              </div>
              {!showTemperature && (
                <p className="text-[10px] text-muted-foreground">
                  {t('ai.temperatureNotSupported')}
                </p>
              )}
            </div>

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
