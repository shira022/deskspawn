import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Separator } from "../ui/separator";
import { ScrollArea } from "../ui/scroll-area";
import { useModels } from "../../hooks/useModels";
import { hasApiKey, loadProviderConfig } from "../../lib/storage";
import { isDesktopEnv } from "../../lib/platform";
import type { ProviderKind, AiConfig, ModelInfo } from "../../types";
import {
  providerLabels,
  providerGroups,
  isProviderKind,
  providerNeedsApiKey,
} from "../../lib/constants";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
} from "lucide-react";

interface AiConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const apiKeyPlaceholder: Record<ProviderKind, string> = {
  openai: "sk-app-...",
  anthropic: "sk-ant-api03-...",
  google: "AIzaSy...",
  "aws-bedrock": "bedrock-api-key-...",
  "azure-foundry": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "gcp-vertexai": "AIzaSy...",
  ollama: "",
  "lm-studio": "",
  "openai-compatible": "Enter your API key",
};

export function AiConfigDialog({ open, onOpenChange }: AiConfigDialogProps) {
  const { aiConfig: existingConfig, setAiConfig, addToast, apiKeyStorageMethod } = useAppStore();
  const { t } = useTranslation();

  // ── Local state ────────────────────────────────────────────────────────────
  // 保存済み ID が既知の 9 種に無い場合（旧 custom / amazon-bedrock 等）は
  // その場で openai へ落とす（保存データの移行はしない — ユーザー決定）。
  const initialProvider =
    existingConfig && isProviderKind(existingConfig.provider)
      ? existingConfig.provider
      : "openai";
  const [provider, setProvider] = useState<ProviderKind>(initialProvider);
  const [apiKey, setApiKey] = useState(
    existingConfig?.apiKey ?? "",
  );
  const [model, setModel] = useState(existingConfig?.model ?? "");
  // __custom__（手動入力）選択中は auto-select で先頭モデルに上書きしない
  const [customModelMode, setCustomModelMode] = useState(false);
  const [customEndpoint, setCustomEndpoint] = useState(
    existingConfig?.customEndpoint ?? "",
  );
  const [region, setRegion] = useState(
    existingConfig?.region ?? "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Track whether the CURRENT provider has a saved key (per-provider)
  const [providerKeyConfigured, setProviderKeyConfigured] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(true);
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";

  const showApiKey = providerNeedsApiKey(provider);

  // Async-check whether the current provider has a configured key.
  // Runs when the dialog opens AND when the provider changes.
  useEffect(() => {
    if (!open) return;
    if (!showApiKey) {
      setProviderKeyConfigured(false);
      setShowApiKeyInput(false);
      return;
    }
    hasApiKey(provider).then((configured) => {
      setProviderKeyConfigured(configured);
      setShowApiKeyInput(!configured);
    });
  }, [open, showApiKey, provider]);

  // ── Model discovery ────────────────────────────────────────────────────────
  const { models, loading: modelsLoading, error: modelsError, fetchModels } = useModels({
    provider,
    customEndpoint,
    apiKey,
  });
  const [selectedModelInfo, setSelectedModelInfo] = useState<ModelInfo | null>(null);

  // Fetch models when provider or endpoint changes
  useEffect(() => {
    if (open) fetchModels();
  }, [open, fetchModels]);

  // Auto-select first model when list loads (skip while in manual-input mode)
  useEffect(() => {
    if (models.length > 0 && !model && !customModelMode) {
      setModel(models[0].id);
      setSelectedModelInfo(models[0]);
    }
  }, [models, model, customModelMode]);

  // Update selected model info on model change
  useEffect(() => {
    const info = models.find((m) => m.id === model) ?? null;
    setSelectedModelInfo(info);
  }, [model, models]);

  // Sync from existing config when dialog opens (provider/model/endpoint/region only)
  useEffect(() => {
    if (open && existingConfig) {
      // 既知の ID 以外（旧ID・壊れた値）は openai にフォールバック（移行しない）
      if (!isProviderKind(existingConfig.provider)) {
        setProvider("openai");
        setApiKey("");
        setModel("");
        setCustomModelMode(false);
        setCustomEndpoint("");
        setRegion("");
        return;
      }
      setProvider(existingConfig.provider);
      setApiKey(existingConfig.apiKey ?? "");
      setModel(existingConfig.model ?? "");
      setCustomModelMode(false);
      setCustomEndpoint(existingConfig.customEndpoint ?? "");
      setRegion(existingConfig.region ?? "");
    }
  }, [open, existingConfig]);

  // Azure Foundry: モデル一覧が空のため、プロバイダー切替時に強制的に空にする
  // auto-select より後に実行することで上書きする
  const prevProviderRef = useRef(provider);
  useEffect(() => {
    if (provider === "azure-foundry" && prevProviderRef.current !== "azure-foundry") {
      setModel("");
      setSelectedModelInfo(null);
    }
    prevProviderRef.current = provider;
  }, [provider]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleProviderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = e.target.value as ProviderKind;
    if (!isProviderKind(p)) return;
    setProvider(p);
    setModel("");
    setCustomModelMode(false);
    setSelectedModelInfo(null);
    setRegion("");
    setCustomEndpoint("");
    if (!providerNeedsApiKey(p)) {
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
      setCustomModelMode(true);
      setSelectedModelInfo(null);
    } else {
      setModel(value);
      setCustomModelMode(false);
    }
  };

  const handleSave = async () => {
    setError("");
    setSaving(true);

    try {
      const hasExistingKey = providerKeyConfigured && !showApiKeyInput;
      const resolvedApiKey = hasExistingKey ? "" : apiKey.trim();

      if (showApiKey && !resolvedApiKey && !hasExistingKey) {
        setError(t('ai.error.apiKeyRequired'));
        setSaving(false);
        return;
      }
      if (!model.trim()) {
        setError(t('ai.error.modelRequired'));
        setSaving(false);
        return;
      }
      if (
        (provider === "openai-compatible" || provider === "azure-foundry") &&
        !customEndpoint.trim()
      ) {
        setError(t('ai.error.customEndpointRequired'));
        setSaving(false);
        return;
      }
      if (provider === "aws-bedrock" && !region.trim()) {
        setError(t('ai.error.regionRequired'));
        setSaving(false);
        return;
      }
      if (provider === "gcp-vertexai" && !region.trim()) {
        setError(t('ai.error.gcpRegionRequired'));
        setSaving(false);
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

      await setAiConfig(config);
      addToast({ message: t('ai.savedConfig'), variant: "success" });
      onOpenChange(false);
    } catch (e: any) {
      setError(e.message || t('common.errorOccurred'));
    } finally {
      setSaving(false);
    }
  };

  const hasModels = models.length > 0 && !modelsLoading && !modelsError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>{t('ai.apiKeySettings')}</DialogTitle>
          <DialogDescription>
            {t(isDesktopEnv() ? 'ai.welcomeDescriptionDesktop' : 'ai.welcomeDescription')}
          </DialogDescription>
          <p className="mt-1 text-xs text-muted-foreground/70 leading-relaxed">
            {t('ai.securityNote')}
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 pb-4">
          <div className="space-y-5">
            {/* Provider */}
            <div className="space-y-2">
              <Label>{t('ai.provider')}</Label>
              <Select value={provider} onChange={handleProviderChange}>
                {providerGroups.map((group) => (
                  <optgroup key={group.category} label={group.label}>
                    {group.providers.map((id) => (
                      <option key={id} value={id}>
                        {providerLabels[id]}
                      </option>
                    ))}
                  </optgroup>
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
                      {t('ai.apiKey')} {t(apiKeyStorageMethod === 'file' ? 'ai.savedInFile' : isDesktopEnv() ? 'ai.savedInKeychain' : 'ai.savedInBrowser')}
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
                          : provider === "aws-bedrock"
                            ? t('ai.apiKeyInstructions.amazonBedrock')
                            : provider === "azure-foundry"
                              ? t('ai.apiKeyInstructions.azureOpenAI')
                              : provider === "gcp-vertexai"
                                ? t('ai.apiKeyInstructions.googleVertex')
                                : provider === "google"
                                  ? t('ai.apiKeyInstructions.google')
                                  : t('ai.apiKeyInstructions.custom')}
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

              {/* Manual fallback — stays visible while "Other (manual input)" is selected */}
              {customModelMode && (
                <Input
                  className="mt-2"
                  placeholder={t('ai.manualModelId')}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}

              {/* Model info badges */}
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

              {/* Model cost */}
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
            {(provider === "openai-compatible" || provider === "anthropic" || provider === "azure-foundry") && (
              <div className="space-y-2">
                <Label>
                  {provider === "anthropic" ? t('ai.corsProxyUrl') : provider === "azure-foundry" ? t('ai.azureEndpointUrl') : t('ai.customEndpoint')}
                </Label>
                <Input
                  placeholder={
                    provider === "azure-foundry"
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
                {provider === "azure-foundry" && (
                  <p className="text-xs text-muted-foreground">
                    {t('ai.azureEndpointDescription')}
                  </p>
                )}
              </div>
            )}

            {/* AWS Region (for AWS Bedrock) */}
            {provider === "aws-bedrock" && (
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

            {/* GCP Region (for Google Cloud Vertex AI) */}
            {provider === "gcp-vertexai" && (
              <div className="space-y-2">
                <Label>{t('ai.gcpRegion')}</Label>
                <Input
                  placeholder={t('ai.gcpRegionPlaceholder')}
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('ai.gcpRegionDescription')}
                </p>
              </div>
            )}

            {/* Ollama Endpoint (optional) */}
            {provider === "ollama" && (
              <div className="space-y-2">
                <Label>{t('ai.customEndpoint')}</Label>
                <Input
                  placeholder="http://localhost:11434"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                />
                {isHttps && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-1.5">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      {t('ai.ollamaCorsDescription')}
                    </p>
                    <div className="relative group flex items-center gap-1">
                      <pre className="flex-1 text-xs bg-amber-100/80 dark:bg-amber-900/40 px-2.5 py-1.5 rounded font-mono text-amber-800 dark:text-amber-300 overflow-x-auto">
                        OLLAMA_ORIGINS=* ollama serve
                      </pre>
                      <button
                        onClick={() => navigator.clipboard.writeText('OLLAMA_ORIGINS=* ollama serve')}
                        className="p-1.5 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/50 text-amber-500 dark:text-amber-400 shrink-0"
                        title={t('common.copy')}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* LM Studio Endpoint (optional) */}
            {provider === "lm-studio" && (
              <div className="space-y-2">
                <Label>{t('ai.customEndpoint')}</Label>
                <Input
                  placeholder="http://localhost:1234/v1"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive font-medium">{error}</p>
            )}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex items-center justify-end gap-2 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {t('common.save')}...
              </>
            ) : (
              t('common.save')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
