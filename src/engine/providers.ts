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
import type { ProviderConfig } from './types';

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
      return client.chat(model) as unknown as LanguageModel;
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
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL: customEndpoint ?? 'http://localhost:11434/v1',
      });
      if (!model) {
        throw new Error(
          'Ollama model is not specified. Please enter a model name in the settings (e.g. llama3.2, qwen2.5).',
        );
      }
      return ollama.chatModel(model) as unknown as LanguageModel;
    }

    case 'custom': {
      if (!customEndpoint) {
        throw new Error(
          'Custom provider requires an endpoint URL. Please enter the endpoint in the settings.',
        );
      }
      if (!apiKey) {
        throw new Error(
          'Custom provider API key is not configured. Please enter your API key in the settings.',
        );
      }
      const client = createOpenAICompatible({
        name: 'custom-provider',
        baseURL: customEndpoint,
        apiKey,
      });
      return client.chatModel(model) as unknown as LanguageModel;
    }

    case 'amazon-bedrock': {
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

    case 'azure-openai': {
      if (!apiKey) {
        throw new Error(
          'Azure OpenAI API key is not configured. Please enter your API key in the settings.',
        );
      }
      if (!customEndpoint) {
        throw new Error(
          'Azure OpenAI endpoint is not configured. Please enter your endpoint URL in the settings.',
        );
      }
      const client = createAzure({
        apiKey,
        baseURL: customEndpoint,
      });
      return client(model) as unknown as LanguageModel;
    }

    case 'google-vertex': {
      if (!apiKey) {
        throw new Error(
          'GCP Vertex AI API key is not configured. Please enter your API key in the settings.',
        );
      }
      const client = createVertex({
        apiKey,
      });
      return client(model) as unknown as LanguageModel;
    }

    default: {
      throw new Error(
        `Unsupported provider: "${provider}". Supported: openai, anthropic, google, amazon-bedrock, azure-openai, google-vertex, ollama, custom`,
      );
    }
  }
}
