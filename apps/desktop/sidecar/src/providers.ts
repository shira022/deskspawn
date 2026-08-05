import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from './types.js';

/**
 * Resolve a language model instance from the provider configuration.
 *
 * API keys are NEVER read from environment variables.
 * They must be provided explicitly via the config (from keychain / file
 * in Tauri mode, or localStorage in browser mode).
 *
 * If apiKey is missing for a provider that requires one, an error is thrown
 * with a clear message rather than sending an empty Authorization header
 * (which would result in a cryptic 401 from the API).
 */
export function getModel(config: ProviderConfig): LanguageModel {
  const { provider, model, apiKey, customEndpoint } = config;

  switch (provider) {
    case 'openai': {
      if (!apiKey) {
        throw new Error(
          'OpenAI API key is not configured. ' +
          'Please enter your API key in the settings.',
        );
      }
      const client = createOpenAI({ apiKey, baseURL: customEndpoint });
      return client.chat(model) as unknown as LanguageModel;
    }

    case 'anthropic': {
      if (!apiKey) {
        throw new Error(
          'Anthropic API key is not configured. ' +
          'Please enter your API key in the settings.',
        );
      }
      const client = createAnthropic({ apiKey, baseURL: customEndpoint });
      return client.messages(model) as unknown as LanguageModel;
    }

    case 'google': {
      if (!apiKey) {
        throw new Error(
          'Google AI API key is not configured. ' +
          'Please enter your API key in the settings.',
        );
      }
      const client = createGoogleGenerativeAI({ apiKey, baseURL: customEndpoint });
      return client.chat(model) as unknown as LanguageModel;
    }

    case 'ollama': {
      // Ollama is local-only; no API key needed.
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL: customEndpoint ?? 'http://localhost:11434/v1',
      });
      if (!model) {
        throw new Error(
          'Ollama model is not specified. ' +
          'Please enter a model name in the settings (e.g. llama3.2, qwen2.5).',
        );
      }
      return ollama.chatModel(model) as unknown as LanguageModel;
    }

    case 'custom': {
      if (!customEndpoint) {
        throw new Error(
          'Custom provider requires an endpoint URL. ' +
          'Please enter the endpoint in the settings.',
        );
      }
      if (!apiKey) {
        throw new Error(
          'Custom provider API key is not configured. ' +
          'Please enter your API key in the settings.',
        );
      }
      const client = createOpenAICompatible({
        name: 'custom-provider',
        baseURL: customEndpoint,
        apiKey,
      });
      return client.chatModel(model) as unknown as LanguageModel;
    }

    default: {
      throw new Error(
        `Unsupported provider: "${provider}". ` +
        'Supported: openai, anthropic, google, ollama, custom',
      );
    }
  }
}
