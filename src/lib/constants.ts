/**
 * Centralized constants for DeskSpawn.
 */

import type { ProviderKind } from "@/types";

/** localStorage に設定を保存するキー */
export const SETTINGS_KEY = "deskspawn_settings";

/** プロバイダー表示名マップ */
export const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "amazon-bedrock": "AWS Bedrock",
  "azure-openai": "Azure OpenAI",
  "google-vertex": "GCP Vertex AI",
  ollama: "Ollama",
  custom: "Custom",
};

/** プロバイダーアイコンマップ */
export const providerIcons: Record<ProviderKind, string> = {
  openai: "Sparkles",
  anthropic: "Cloud",
  google: "Globe",
  "amazon-bedrock": "HardDrive",
  "azure-openai": "Container",
  "google-vertex": "Zap",
  ollama: "Cpu",
  custom: "Server",
};
