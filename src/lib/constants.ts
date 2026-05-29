/**
 * Centralized constants for DeskSpawn.
 *
 * サイドカーサーバーのURLやプロバイダー関連の定数を一元管理する。
 * 各コンポーネントはこのファイルからインポートすること。
 */

/** サイドカーサーバーのベースURL */
export const SIDECAR_BASE = "http://localhost:3001";

/** サイドカーチャットエンドポイント */
export const SIDECAR_CHAT_URL = `${SIDECAR_BASE}/chat`;

/** サイドカーヘルスチェックURL */
export const SIDECAR_HEALTH_URL = `${SIDECAR_BASE}/health`;

import type { ProviderKind } from "@/types";

/** プロバイダー表示名マップ */
export const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  ollama: "Ollama",
  custom: "カスタム",
};

/** プロバイダーアイコンマップ */
export const providerIcons: Record<ProviderKind, string> = {
  openai: "Sparkles",
  anthropic: "Cloud",
  google: "Globe",
  ollama: "Cpu",
  custom: "Server",
};
