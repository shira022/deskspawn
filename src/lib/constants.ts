/**
 * Centralized constants for DeskSpawn.
 *
 * サイドカーサーバーのURLやプロバイダー関連の定数を一元管理する。
 * 各コンポーネントはこのファイルからインポートすること。
 */

let _sidecarPort = 3001;

/** 現在のサイドカーポートを設定する（Rust backendから通知された場合） */
export function setSidecarPort(port: number) {
  if (port > 0 && port !== _sidecarPort) {
    console.log(`[sidecar] Port updated: ${_sidecarPort} → ${port}`);
    _sidecarPort = port;
  }
}

/** 現在のサイドカーポートを取得する */
export function getSidecarPort(): number {
  return _sidecarPort;
}

/** サイドカーサーバーのベースURL（動的） */
export function sidecarBase(): string {
  return `http://localhost:${_sidecarPort}`;
}

/** サイドカーチャットエンドポイント（動的） */
export function sidecarChatUrl(): string {
  return `${sidecarBase()}/chat`;
}

/** サイドカーヘルスチェックURL（動的） */
export function sidecarHealthUrl(): string {
  return `${sidecarBase()}/health`;
}

/**
 * Legacy constants (keep for backward compatibility).
 * Note: these are evaluated ONCE at import time.
 * For dynamic resolution, use the function versions instead.
 */
export const SIDECAR_BASE = `http://localhost:${_sidecarPort}`;
export const SIDECAR_CHAT_URL = `${SIDECAR_BASE}/chat`;
export const SIDECAR_HEALTH_URL = `${SIDECAR_BASE}/health`;

import type { ProviderKind } from "@/types";

/** localStorage に設定を保存するキー */
export const SETTINGS_KEY = "deskspawn_settings";

/** プロバイダー表示名マップ */
export const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  ollama: "Ollama",
  custom: "Custom",
};

/** プロバイダーアイコンマップ */
export const providerIcons: Record<ProviderKind, string> = {
  openai: "Sparkles",
  anthropic: "Cloud",
  google: "Globe",
  ollama: "Cpu",
  custom: "Server",
};
