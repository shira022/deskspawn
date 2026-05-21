import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from './types.js';

/**
 * Known Ollama models mapped to their typical local identifiers.
 * Users can override via the `model` field in config.
 */
const OLLAMA_DEFAULT_MODEL = 'llama3.2';

/**
 * Resolve a language model instance from the provider configuration.
 * Supports: openai, anthropic, google, ollama, and custom (OpenAI-compatible).
 *
 * Each provider is instantiated via its `create*` factory so that API keys
 * and custom endpoints can be passed explicitly. If no apiKey is provided,
 * the factory will fall back to the standard environment variable.
 */
export function getModel(config: ProviderConfig): LanguageModel {
  const { provider, model, apiKey, customEndpoint } = config;

  switch (provider) {
    case 'openai': {
      const client = createOpenAI({
        apiKey,
        baseURL: customEndpoint,
      });
      // createOpenAI returns a provider with .chat(modelId) method
      return client.chat(model) as unknown as LanguageModel;
    }

    case 'anthropic': {
      const client = createAnthropic({
        apiKey,
        baseURL: customEndpoint,
      });
      // createAnthropic returns a provider with .messages(modelId) method
      return client.messages(model) as unknown as LanguageModel;
    }

    case 'google': {
      const client = createGoogleGenerativeAI({
        apiKey,
        baseURL: customEndpoint,
      });
      // createGoogleGenerativeAI returns a provider with .chat(modelId) method
      return client.chat(model) as unknown as LanguageModel;
    }

    case 'ollama': {
      // Ollama exposes an OpenAI-compatible API at localhost:11434/v1
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL: customEndpoint ?? 'http://localhost:11434/v1',
      });
      return ollama.chatModel(model || OLLAMA_DEFAULT_MODEL) as unknown as LanguageModel;
    }

    case 'custom': {
      if (!customEndpoint) {
        throw new Error(
          'customEndpoint is required when provider is "custom"'
        );
      }
      const client = createOpenAICompatible({
        name: 'custom-provider',
        baseURL: customEndpoint,
        apiKey: apiKey ?? '',
      });
      return client.chatModel(model) as unknown as LanguageModel;
    }

    default: {
      throw new Error(
        `Unsupported provider: "${provider}". Supported: openai, anthropic, google, ollama, custom`
      );
    }
  }
}
