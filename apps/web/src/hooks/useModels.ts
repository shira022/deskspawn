import { useState, useCallback } from "react";
import type { ModelInfo, ProviderKind } from "@/types";
import { getModelsForProvider } from "@/lib/models-fetcher";
import { setModelCostCache, clearModelCostCache } from "@/lib/cost";
import i18n from "@/lib/i18n";

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
 * ブラウザ内で直接モデル一覧を取得する（サイドカー非依存）。
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
      const fetchedModels = await getModelsForProvider(
        provider,
        customEndpoint || undefined,
        apiKey || undefined,
      );
      setModels(fetchedModels);
      // Update the shared cost cache for calculateCost() to use
      clearModelCostCache();
      setModelCostCache(fetchedModels);
    } catch (e: any) {
      setError((e?.message || '') || i18n.t('ai.error.modelsFetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [provider, customEndpoint, apiKey]);

  return { models, loading, error, fetchModels };
}
