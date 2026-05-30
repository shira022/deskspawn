import { useState, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProviderKind, AiConfig, ModelInfo } from "@/types";
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
} from "lucide-react";

const providers: { id: ProviderKind; name: string; icon: React.ReactNode; description: string }[] = [
  { id: "openai", name: "OpenAI", icon: <Sparkles className="h-5 w-5" />, description: "GPT" },
  { id: "anthropic", name: "Anthropic", icon: <Cloud className="h-5 w-5" />, description: "Claude" },
  { id: "google", name: "Google", icon: <Globe className="h-5 w-5" />, description: "Gemini" },
  { id: "ollama", name: "Ollama", icon: <Cpu className="h-5 w-5" />, description: "ローカルLLM" },
  { id: "custom", name: "カスタム", icon: <Server className="h-5 w-5" />, description: "OpenAI 互換" },
];

const providerNeedsApiKey = (p: ProviderKind) => p !== "ollama";

export function AiConfigScreen() {
  const { setPhase, setAiConfig, aiConfig: existingConfig } = useAppStore();
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

    // If the key is managed by keychain and user didn't change it,
    // send empty apiKey with apiKeyConfigured=true so the Rust backend
    // keeps the existing keychain entry.
    const hasExistingKey = existingConfig?.apiKeyConfigured && !showApiKeyInput;
    const resolvedApiKey = hasExistingKey ? "" : apiKey.trim();

    if (showApiKey && !resolvedApiKey && !hasExistingKey) {
      setError("API キーを入力してください");
      return;
    }
    if (!model.trim()) {
      setError("モデルを選択または入力してください");
      return;
    }
    if (provider === "custom" && !customEndpoint.trim()) {
      setError("カスタムエンドポイントを入力してください");
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
          <h1 className="text-2xl font-bold tracking-tight">DeskSpawn へようこそ</h1>
          <p className="text-sm text-muted-foreground">
            使用する AI モデルを設定してください。API キーは OS のキーチェーンに安全に保存されます。
          </p>
        </div>

        <Separator />

        <ScrollArea className="max-h-[420px] min-h-[160px] sm:h-[420px]">
          <div className="space-y-5 px-1">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label>AI プロバイダー</Label>
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
                <Label>API キー</Label>

                {!showApiKeyInput && existingConfig?.apiKeyConfigured ? (
                  /* Tauri mode: key is stored in OS keychain, never shown */
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="flex-1">
                      API キーは OS キーチェーンに安全に保存されています
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setShowApiKeyInput(true)}
                    >
                      変更
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
                        ? "OpenAI の API キー（https://platform.openai.com/api-keys）"
                        : provider === "anthropic"
                          ? "Anthropic の API キー（Console → API Keys）"
                          : "Google AI Studio の API キー"}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Model Selection */}
            <div className="space-y-2">
              <Label>モデル</Label>

              {modelsLoading ? (
                <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  モデル一覧を取得中...
                </div>
              ) : modelsError ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {modelsError}
                  </div>
                  <Input
                    placeholder="モデル名を手動入力"
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
                      title={m.supportsImageInput ? '画像レビュー対応' : 'テキストベースの画面確認のみ'}
                    >
                      {m.supportsImageInput ? '✦ ' : '   '}{m.name}
                    </option>
                  ))}
                  <option disabled>──────────</option>
                  <option value="__custom__">その他（手動入力）...</option>
                </Select>
              ) : (
                <Input
                  placeholder={`モデル名を入力（例: gpt-4o）`}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}

              {/* Manual input fallback when "その他" selected */}
              {model === "" && hasModels && (
                <Input
                  className="mt-2"
                  placeholder="モデルIDを手動入力"
                  value=""
                  onChange={(e) => setModel(e.target.value)}
                />
              )}

              {/* Selected model info */}
              {selectedModelInfo && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    コンテキスト: {formatTokens(selectedModelInfo.contextLimit)}
                  </span>
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    出力上限: {formatTokens(selectedModelInfo.maxOutput)}
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
                      画像レビュー
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Custom Endpoint */}
            {provider === "custom" && (
              <div className="space-y-2">
                <Label>カスタムエンドポイント</Label>
                <Input
                  placeholder="https://your-api.example.com/v1"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                />
              </div>
            )}

            {/* Advanced Options */}
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">詳細設定（任意）</p>
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
                    placeholder="自動"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                  />
                </div>
              </div>
              {!showTemperature && (
                <p className="text-[10px] text-muted-foreground">
                  ※ このモデルは Temperature パラメータに対応していません
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
          次へ：環境チェック
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
