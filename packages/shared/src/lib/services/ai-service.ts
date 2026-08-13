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
    const { generateText } = await import("ai");
    const model = getModel(config as ProviderConfig);

    const result = await generateText({
      model,
      messages: (systemPrompt
        ? [{ role: "system" as const, content: systemPrompt }, ...messages]
        : messages) as any,
      ...(maxSteps ? { maxSteps } : {}),
    });

    return result.text;
  }

  async streamText(params: StreamTextParams): Promise<void> {
    const { messages, config, systemPrompt, onChunk, onError, signal } = params;

    try {
      const { streamText } = await import("ai");
      const model = getModel(config as ProviderConfig);

      const result = streamText({
        model,
        messages: (systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }, ...messages]
          : messages) as any,
        abortSignal: signal,
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
    const models = await getModelsForProvider(provider, apiKey);
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
