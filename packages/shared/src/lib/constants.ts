/**
 * Centralized constants for DeskSpawn.
 */

import type { ProviderKind, ProviderCategory } from "../types";

/** localStorage に設定を保存するキー */
export const SETTINGS_KEY = "deskspawn_settings";

/** プロバイダー表示名マップ（aegis-agent の displayName と完全一致） */
export const providerLabels: Record<ProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "aws-bedrock": "AWS Bedrock",
  "azure-foundry": "Azure Foundry",
  "gcp-vertexai": "Google Cloud (Vertex AI)",
  ollama: "Ollama (Local)",
  "lm-studio": "LM Studio (Local)",
  "openai-compatible": "Custom (OpenAI Compatible)",
};

/** プロバイダーアイコンマップ */
export const providerIcons: Record<ProviderKind, string> = {
  openai: "Sparkles",
  anthropic: "Cloud",
  google: "Globe",
  "aws-bedrock": "HardDrive",
  "azure-foundry": "Container",
  "gcp-vertexai": "Zap",
  ollama: "Cpu",
  "lm-studio": "Cpu",
  "openai-compatible": "Server",
};

/** プロバイダーのカテゴリ分組（aegis-agent の category 値と完全一致） */
export const providerCategories: Record<ProviderKind, ProviderCategory> = {
  openai: "cloud",
  anthropic: "cloud",
  google: "cloud",
  "aws-bedrock": "cloud",
  "azure-foundry": "cloud",
  "gcp-vertexai": "cloud",
  ollama: "local",
  "lm-studio": "local",
  "openai-compatible": "compatible",
};

/** カテゴリの表示順（UI の optgroup 順） */
export const providerCategoryOrder: readonly ProviderCategory[] = [
  "cloud",
  "local",
  "compatible",
];

/** カテゴリの optgroup ラベル（プロバイダー名と同じく英語表記） */
export const providerCategoryLabels: Record<ProviderCategory, string> = {
  cloud: "Cloud",
  local: "Local",
  compatible: "OpenAI Compatible",
};

export interface ProviderGroup {
  category: ProviderCategory;
  label: string;
  providers: ProviderKind[];
}

/**
 * プロバイダー選択 UI（AiConfigDialog / MainLayout）で共通する 3 グループ。
 * 同一の集合・分組を両 UI から出すための単一情報源。
 */
export const providerGroups: ProviderGroup[] = providerCategoryOrder.map(
  (category) => ({
    category,
    label: providerCategoryLabels[category],
    providers: (Object.keys(providerCategories) as ProviderKind[]).filter(
      (id) => providerCategories[id] === category,
    ),
  }),
);

/**
 * 保存済みのプロバイダー ID が既知の 9 種に含まれるか。
 * 旧 ID（custom / amazon-bedrock / azure-openai / google-vertex 等）や
 * 壊れた値は false（呼び出し側で openai にフォールバックする。移行はしない）。
 */
export function isProviderKind(value: string): value is ProviderKind {
  return Object.prototype.hasOwnProperty.call(providerCategories, value);
}

/** API キーが不要なローカルプロバイダー以外は true（キー必須） */
export function providerNeedsApiKey(provider: ProviderKind): boolean {
  return provider !== "ollama" && provider !== "lm-studio";
}
