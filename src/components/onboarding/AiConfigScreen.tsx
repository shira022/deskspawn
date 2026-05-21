import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProviderKind, AiConfig, ModelInfo } from "@/types";
import {
  Sparkles,
  ChevronRight,
  Globe,
  Cloud,
  Cpu,
  Server,
  Loader2,
  AlertCircle,
} from "lucide-react";

const SIDECAR_BASE = "http://localhost:3001";

const providers: { id: ProviderKind; name: string; icon: React.ReactNode; description: string }[] = [
  { id: "openai", name: "OpenAI", icon: <Sparkles className="h-5 w-5" />, description: "GPT" },
  { id: "anthropic", name: "Anthropic", icon: <Cloud className="h-5 w-5" />, description: "Claude" },
  { id: "google", name: "Google", icon: <Globe className="h-5 w-5" />, description: "Gemini" },
  { id: "ollama", name: "Ollama", icon: <Cpu className="h-5 w-5" />, description: "ローカルLLM" },
  { id: "custom", name: "カスタム", icon: <Server className="h-5 w-5" />, description: "OpenAI 互換" },
];

const providerNeedsApiKey = (p: ProviderKind) => p !== "ollama";

export function AiConfigScreen() {
  const { setPhase, setAiConfig } = useAppStore();
  const [provider, setProvider] = useState<ProviderKind>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("");
  const [error, setError] = useState("");

  // Model discovery state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [selectedModelInfo, setSelectedModelInfo] = useState<ModelInfo | null>(null);

  const showApiKey = providerNeedsApiKey(provider);

  // ── Fetch models when provider or custom endpoint changes ──────────────────

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError("");
    setModels([]);
    setSelectedModelInfo(null);

    try {
      const params = new URLSearchParams({ provider });
      if (customEndpoint && (provider === "custom" || provider === "ollama")) {
        params.set("customEndpoint", customEndpoint);
      }
      if (apiKey && provider === "custom") {
        params.set("apiKey", apiKey);
      }

      const res = await fetch(`${SIDECAR_BASE}/api/models?${params}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as any).error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const fetched: ModelInfo[] = data.models ?? [];
      setModels(fetched);

      if (fetched.length > 0) {
        setModel(fetched[0].id);
        setSelectedModelInfo(fetched[0]);
      }
    } catch (e: any) {
      setModelsError(e.message || "モデル一覧の取得に失敗しました");
    } finally {
      setModelsLoading(false);
    }
  }, [provider, customEndpoint, apiKey]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

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
    if (p === "ollama") setApiKey("");
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

    if (showApiKey && !apiKey.trim()) {
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
      apiKey: apiKey.trim(),
      model: model.trim(),
      customEndpoint: customEndpoint.trim() || undefined,
      temperature: parseFloat(temperature) || 0.2,
      maxTokens: maxTokens ? parseInt(maxTokens) : undefined,
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
                    <option key={m.id} value={m.id}>
                      {m.name}
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
