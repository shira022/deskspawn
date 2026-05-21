import { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProviderKind, AiConfig } from "@/types";
import {
  Sparkles,
  ChevronRight,
  Globe,
  Cloud,
  Cpu,
  Server,
} from "lucide-react";

const providers: { id: ProviderKind; name: string; icon: React.ReactNode; description: string }[] = [
  { id: "openai", name: "OpenAI", icon: <Sparkles className="h-5 w-5" />, description: "GPT-4o, o1, o3 など" },
  { id: "anthropic", name: "Anthropic", icon: <Cloud className="h-5 w-5" />, description: "Claude Sonnet, Opus など" },
  { id: "google", name: "Google", icon: <Globe className="h-5 w-5" />, description: "Gemini 2.5 Flash, Pro など" },
  { id: "ollama", name: "Ollama", icon: <Cpu className="h-5 w-5" />, description: "ローカルLLM（完全オフライン）" },
  { id: "custom", name: "カスタム", icon: <Server className="h-5 w-5" />, description: "OpenAI API 互換エンドポイント" },
];

const defaultModels: Record<ProviderKind, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.5-flash",
  ollama: "llama3.2",
  custom: "",
};

export function AiConfigScreen() {
  const { setPhase, setAiConfig } = useAppStore();
  const [provider, setProvider] = useState<ProviderKind>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(defaultModels.openai);
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("");
  const [error, setError] = useState("");

  const showApiKey = provider !== "ollama";

  const handleNext = () => {
    setError("");

    if (showApiKey && !apiKey.trim()) {
      setError("API キーを入力してください");
      return;
    }
    if (!model.trim()) {
      setError("モデル名を入力してください");
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

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = e.target.value as ProviderKind;
    setProvider(p);
    setModel(defaultModels[p]);
    if (p === "ollama") setApiKey("");
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-full max-w-lg space-y-6 rounded-xl border bg-card p-8 shadow-lg">
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

        <ScrollArea className="h-[420px]">
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

            {/* Model */}
            <div className="space-y-2">
              <Label>モデル名</Label>
              <Input
                placeholder={`例: ${defaultModels[provider]}`}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
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
              <div className="grid grid-cols-2 gap-3">
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
