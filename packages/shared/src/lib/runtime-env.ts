/**
 * Runtime environment provider registration (platform independent).
 *
 * Desktop registers a Tauri-backed provider at startup. Web never registers
 * one, so the first-run environment check screen is simply not shown there.
 */

export type RuntimePrerequisiteKind = "bun" | "webview2";

export type RuntimeCheckStatus = "ok" | "missing";

export interface RuntimeCheckItem {
  id: string;
  label: string;
  status: RuntimeCheckStatus;
  version?: string;
  source: string;
  wingetId: string;
  sizeMb: number;
  manualUrl: string;
}

export interface RuntimeInstallProgress {
  kind: string;
  line: string;
}

export interface RuntimeEnvProvider {
  check(): Promise<RuntimeCheckItem[]>;
  install(kind: RuntimePrerequisiteKind): Promise<RuntimeCheckItem[]>;
  subscribeProgress(
    cb: (progress: RuntimeInstallProgress) => void,
  ): Promise<() => void>;
  isWingetAvailable(): Promise<boolean>;
}

let provider: RuntimeEnvProvider | null = null;

export function registerRuntimeEnvProvider(
  next: RuntimeEnvProvider,
): void {
  provider = next;
}

export function getRuntimeEnvProvider(): RuntimeEnvProvider | null {
  return provider;
}
