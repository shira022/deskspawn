import { useState, useCallback } from "react";
import type { ModelInfo, ProviderKind } from "@/types";
import { SIDECAR_BASE } from "@/lib/constants";

interface UseModelsOptions {
  provider: ProviderKind;
  customEndpoint?: string;
  apiKey?: string;
}

interface UseModelsReturn {
  models: ModelInfo[];
  loading: boolean;
  error: string;
  fetchModels: () => Promise<void>;
}

/**
 * AIプロバイダーからモデル一覧を取得する共有フック。
 * AiConfigScreen と MainLayout のツールバーで使用する。
 */
export function useModels({ provider, customEndpoint, apiKey }: UseModelsOptions): UseModelsReturn {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError("");
    setModels([]);

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
      setModels(data.models ?? []);
    } catch (e: any) {
      setError(e.message || "モデル一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [provider, customEndpoint, apiKey]);

  return { models, loading, error, fetchModels };
}
