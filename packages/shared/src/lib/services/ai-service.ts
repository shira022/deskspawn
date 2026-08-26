/**
 * @deskspawn/browser-engine — Web AI service implementation
 *
 * Uses @ai-sdk/* directly in the browser.
 */

import type {
  AiService,
  GenerateTextParams,
  StreamTextParams,
  ModelInfo,
  ProviderConfig,
} from "@deskspawn/ai-core";
import { getModel } from "../../engine/providers";
import { getModelsForProvider } from "../../lib/models-fetcher";

export class WebAiService implements AiService {
  async generateText(params: GenerateTextParams): Promise<string> {
    const { messages, config, systemPrompt, maxSteps } = params;
    const { generateText, stepCountIs } = await import("ai");
    const model = getModel(config as ProviderConfig);

    const result = await generateText({
      model,
      messages: (systemPrompt
        ? [{ role: "system" as const, content: systemPrompt }, ...messages]
        : messages) as any,
      // ai v6: maxSteps は廃止 → stopWhen: stepCountIs() でステップ上限を指定
      ...(maxSteps ? { stopWhen: stepCountIs(maxSteps) } : {}),
    });

    return result.text;
  }

  async streamText(params: StreamTextParams): Promise<void> {
    const { messages, config, systemPrompt, onChunk, onError, signal, tools, maxSteps } = params;

    try {
      const { streamText, stepCountIs } = await import("ai");
      const model = getModel(config as ProviderConfig);

      const result = streamText({
        model,
        messages: (systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }, ...messages]
          : messages) as any,
        ...(tools ? { tools: tools as any } : {}),
        abortSignal: signal,
        // ai v6: maxSteps は廃止 → stopWhen: stepCountIs() でステップ上限を指定
        ...(maxSteps ? { stopWhen: stepCountIs(maxSteps) } : {}),
      });

      for await (const chunk of result.textStream) {
        onChunk({ type: "text", content: chunk });
      }
      onChunk({ type: "finish", content: "" });
    } catch (error) {
      if (onError) onError(error as Error);
      onChunk({ type: "error", content: (error as Error).message });
    }
  }

  async getModels(provider: string, apiKey?: string): Promise<ModelInfo[]> {
    if (!apiKey) return [];
    // getModelsForProvider は (provider, endpoint?, apiKey?) のシグネチャのため
    // apiKey を第3引数に渡す（第2引数 endpoint は指定しない）
    const models = await getModelsForProvider(provider, undefined, apiKey);
    // Convert web ModelInfo to shared ModelInfo
    return models.map((m: any) => ({
      id: m.id,
      name: m.name ?? m.id,
      supportsTemperature: m.supportsTemperature ?? true,
      supportsReasoning: m.supportsReasoning ?? false,
      supportsToolCall: m.supportsToolCall ?? true,
      supportsImageInput: m.supportsImageInput ?? false,
      contextLimit: m.contextLimit ?? 128000,
      maxOutput: m.maxOutput ?? 4096,
      cost: m.cost,
    }));
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
