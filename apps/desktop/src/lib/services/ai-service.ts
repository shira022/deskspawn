/**
 * DeskSpawn Desktop — AI service implementation
 *
 * Routes AI requests through Rust IPC → Sidecar (Node.js).
 * Falls back to direct API call if Sidecar is offline.
 */

import type {
  AiService,
  GenerateTextParams,
  StreamTextParams,
  StreamChunk,
  ModelInfo,
} from "@deskspawn/ai-core";
import { invoke } from "@tauri-apps/api/core";

export class DesktopAiService implements AiService {
  async generateText(params: GenerateTextParams): Promise<string> {
    const { messages, config, systemPrompt, tools, maxSteps } = params;

    // Try Sidecar via Rust IPC first
    try {
      const result = await invoke<string>("call_ai", {
        messages,
        config,
        systemPrompt: systemPrompt ?? null,
        tools: tools ?? null,
        maxSteps: maxSteps ?? 20,
      });
      return result;
    } catch {
      // Fallback: direct API call from WebView
      return this.fallbackGenerate(messages, config, systemPrompt);
    }
  }

  async streamText(params: StreamTextParams): Promise<void> {
    const { messages, config, systemPrompt, onChunk, onError, signal } = params;

    try {
      // Try Sidecar via Rust IPC (streaming)
      const port = await invoke<number>("sidecar_port").catch(() => 3001);

      const response = await fetch(`http://localhost:${port}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          config: {
            provider: config.provider,
            model: config.model,
            apiKey: config.apiKey,
            customEndpoint: config.customEndpoint,
          },
          systemPrompt,
        }),
        signal,
      });

      if (!response.ok) throw new Error(`Sidecar: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        onChunk({ type: "text", content: text });
      }

      onChunk({ type: "finish", content: "" });
    } catch (error) {
      if (signal?.aborted) {
        onChunk({ type: "finish", content: "" });
        return;
      }
      // Fallback to direct
      try {
        const text = await this.fallbackGenerate(messages, config, systemPrompt);
        onChunk({ type: "text", content: text });
        onChunk({ type: "finish", content: "" });
      } catch (e2) {
        if (onError) onError(e2 as Error);
        onChunk({ type: "error", content: (e2 as Error).message });
      }
    }
  }

  async getModels(provider: string, apiKey?: string): Promise<ModelInfo[]> {
    try {
      return await invoke<ModelInfo[]>("get_available_models", { provider, apiKey });
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const status = await invoke<string>("sidecar_status");
      return status === "running";
    } catch {
      return false;
    }
  }

  // ── Fallback: direct fetch from WebView ──────────────────────────

  private async fallbackGenerate(
    messages: Array<{ role: string; content: string }>,
    config: { provider: string; model?: string; apiKey?: string; customEndpoint?: string },
    systemPrompt?: string,
  ): Promise<string> {
    const { provider, model, apiKey, customEndpoint } = config;
    if (!apiKey) throw new Error("No API key configured");

    const allMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    let url: string;
    let body: Record<string, unknown>;

    if (provider === "anthropic") {
      url = "https://api.anthropic.com/v1/messages";
      body = {
        model: model || "claude-sonnet-4-20250514",
        messages: allMessages,
        max_tokens: 4096,
      };
    } else {
      url = `${customEndpoint || "https://api.openai.com/v1"}/chat/completions`;
      body = { model: model || "gpt-4o", messages: allMessages };
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    if (provider === "anthropic") {
      const data = await res.json();
      return data.content?.[0]?.text ?? "";
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
}
