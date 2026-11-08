/**
 * @deskspawn/browser-engine — AI provider model resolution
 *
 * Resolves a language model instance from provider configuration.
 * Uses the Vercel AI SDK provider packages which work in the browser.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAzure } from '@ai-sdk/azure';
import { createVertex } from '@ai-sdk/google-vertex/edge';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from "@deskspawn/ai-core";
import { sidecarBase, sidecarFetchWithToken } from "../lib/sidecar";
import { isDesktopEnv } from "../lib/platform";

/** ローカルモデルの既定エンドポイント（OpenAI 互換 API の baseURL）。 */
const LOCAL_MODEL_CHAT_ENDPOINTS = {
  ollama: 'http://localhost:11434/v1',
  'lm-studio': 'http://localhost:1234/v1',
} as const;

/**
 * デスクトップ用: サイドカーの /local/v1 プロキシへ x-local-endpoint を付与して
 * 転送する fetch ラッパー。WebView2 の CORS を回避しつつ H1 トークンも付与する。
 */
function createLocalProxyFetch(endpoint: string) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set('x-local-endpoint', endpoint);
    return sidecarFetchWithToken(input, { ...init, headers });
  };
}

export function getModel(config: ProviderConfig): LanguageModel {
  const { provider, model, apiKey, customEndpoint } = config;

  switch (provider) {
    case 'openai': {
      if (!apiKey) {
        throw new Error(
          'OpenAI API key is not configured. Please enter your API key in the settings.',
        );
      }
      const client = createOpenAI({ apiKey, baseURL: customEndpoint });
      // GPT-5 系モデルは Chat Completions API で function tools + reasoning の併用が
      // 許可されていない（例: "Function tools with reasoning_effort are not supported
      // for gpt-5.6-luna in /v1/chat/completions"）。そのため GPT-5 系は
      // Responses API（/v1/responses）を使う。それ以外のモデルは後方互換のため chat() のまま。
      const isGpt5 = model.startsWith('gpt-5');
      return (isGpt5 ? client.responses(model) : client.chat(model)) as unknown as LanguageModel;
    }

    case 'anthropic': {
      if (!apiKey) {
        throw new Error(
          'Anthropic API key is not configured. Please enter your API key in the settings.',
        );
      }
      // Direct browser access supported via opt-in header
      // (anthropic-dangerous-direct-browser-access: true).
      // Users can optionally provide a customEndpoint for a private proxy.
      const client = createAnthropic({
        apiKey,
        baseURL: customEndpoint,
        headers: {
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      return client.messages(model) as unknown as LanguageModel;
    }

    case 'google': {
      if (!apiKey) {
        throw new Error(
          'Google AI API key is not configured. Please enter your API key in the settings.',
        );
      }
      const client = createGoogleGenerativeAI({ apiKey, baseURL: customEndpoint });
      return client.chat(model) as unknown as LanguageModel;
    }

    case 'ollama': {
      if (!model) {
        throw new Error(
          'Ollama model is not specified. Please enter a model name in the settings (e.g. llama3.2, qwen2.5).',
        );
      }
      const endpoint = customEndpoint ?? LOCAL_MODEL_CHAT_ENDPOINTS.ollama;
      // デスクトップでは CORS 回避のためサイドカーの /local/v1 経由にする。
      const isDesktop = isDesktopEnv();
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL: isDesktop ? `${sidecarBase()}/local/v1` : endpoint,
        ...(isDesktop ? { fetch: createLocalProxyFetch(endpoint) } : {}),
      });
      return ollama.chatModel(model) as unknown as LanguageModel;
    }

    case 'lm-studio': {
      if (!model) {
        throw new Error(
          'LM Studio model is not specified. Please enter a model name in the settings (e.g. qwen2.5-7b-instruct).',
        );
      }
      const endpoint = customEndpoint ?? LOCAL_MODEL_CHAT_ENDPOINTS['lm-studio'];
      // デスクトップでは CORS 回避のためサイドカーの /local/v1 経由にする。
      const isDesktop = isDesktopEnv();
      const lmStudio = createOpenAICompatible({
        name: 'lm-studio',
        baseURL: isDesktop ? `${sidecarBase()}/local/v1` : endpoint,
        ...(isDesktop ? { fetch: createLocalProxyFetch(endpoint) } : {}),
      });
      return lmStudio.chatModel(model) as unknown as LanguageModel;
    }

    case 'openai-compatible': {
      if (!customEndpoint) {
        throw new Error(
          'OpenAI-compatible provider requires an endpoint URL. Please enter the endpoint in the settings.',
        );
      }
      if (!apiKey) {
        throw new Error(
          'OpenAI-compatible provider API key is not configured. Please enter your API key in the settings.',
        );
      }
      // デスクトップ(Tauri)ではサイドカープロキシ経由で呼ぶ (CORS回避)
      const isDesktop = isDesktopEnv();
      const client = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: isDesktop ? `${sidecarBase()}/v1` : customEndpoint,
        apiKey,
        // H1: サイドカープロキシには X-DeskSpawn-Token 必須（無いと401）。
        // Web（素のfetch）ではトークン不要なので undefined のまま。
        fetch: isDesktop ? sidecarFetchWithToken : undefined,
      });
      return client.chatModel(model) as unknown as LanguageModel;
    }

    case 'aws-bedrock': {
      if (!apiKey) {
        throw new Error(
          'AWS Bedrock API key is not configured. Please enter your API key in the settings.',
        );
      }
      if (!config.region) {
        throw new Error(
          'AWS Bedrock region is not configured. Please enter the AWS region in the settings.',
        );
      }
      const client = createAmazonBedrock({
        apiKey,
        region: config.region,
      });
      return client(model) as unknown as LanguageModel;
    }

    case 'azure-foundry': {
      if (!apiKey) {
        throw new Error(
          'Azure Foundry API key is not configured. Please enter your API key in the settings.',
        );
      }
      if (!customEndpoint) {
        throw new Error(
          'Azure Foundry endpoint is not configured. Please enter your endpoint URL in the settings.',
        );
      }
      const client = createAzure({
        apiKey,
        baseURL: customEndpoint,
      });
      return client(model) as unknown as LanguageModel;
    }

    case 'gcp-vertexai': {
      if (!apiKey) {
        throw new Error(
          'Google Cloud (Vertex AI) API key is not configured. Please enter your API key in the settings.',
        );
      }
      if (!config.region) {
        throw new Error(
          'Google Cloud (Vertex AI) region is not configured. Please enter the GCP region in the settings.',
        );
      }
      const client = createVertex({
        apiKey,
        location: config.region,
      });
      return client(model) as unknown as LanguageModel;
    }

    default: {
      throw new Error(
        `Unsupported provider: "${provider}". Supported: openai, anthropic, google, aws-bedrock, azure-foundry, gcp-vertexai, ollama, lm-studio, openai-compatible`,
      );
    }
  }
}
