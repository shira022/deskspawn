/**
 * Desktop preview manager — runs the generated app's Vite dev server
 * locally via the sidecar (Bun). No WebContainer/StackBlitz dependency.
 *
 * Same public interface as PreviewManager (webcontainer.ts) so that
 * PreviewPanel and tool-executors can use it transparently.
 */

import { sidecarBase } from "@/lib/sidecar";
import type { PreviewState, PreviewStatus, StateListener } from "./types";

export class DesktopPreviewManager {
  private _status: PreviewStatus = "idle";
  private _url: string | null = null;
  private _error: string | null = null;
  private _logs: string[] = [];
  private _appId: string | null = null;
  private listeners = new Set<StateListener>();

  get isBooted(): boolean {
    return this._appId !== null && this._status !== "idle";
  }

  get appId(): string | null {
    return this._appId;
  }

  get url(): string | null {
    return this._url;
  }

  private get state(): PreviewState {
    return { status: this._status, url: this._url, error: this._error, logs: this._logs };
  }

  private setState(partial: Partial<PreviewState>): void {
    if (partial.status !== undefined) this._status = partial.status;
    if (partial.url !== undefined) this._url = partial.url;
    if (partial.error !== undefined) this._error = partial.error;
    this.notify();
  }

  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this._logs = [...this._logs, `[${timestamp}] ${message}`];
    this.notify();
  }

  private clearLogs(): void {
    this._logs = [];
    this.notify();
  }

  private notify(): void {
    const state = this.state;
    for (const fn of this.listeners) {
      try {
        fn(state);
      } catch {
        // リスナーエラーは無視
      }
    }
  }

  /** 状態変更を購読する。購読解除関数を返す。 */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    // 初回は即座に現在の状態を通知
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** サイドカーにローカルVite dev server を起動させ、プレビューを開始する */
  async boot(appId: string): Promise<void> {
    if (this._appId === appId && this._status === "ready") {
      return;
    }
    this._appId = appId;
    this.clearLogs();
    this.addLog(`Starting local preview for app: ${appId}`);
    this.setState({ status: "booting", error: null });

    // サイドカーの実際の進行（bun install → vite起動）を反映した段階的ステータス。
    // レスポンスが来たらタイマーは finally でクリアされる。
    const timers: ReturnType<typeof setTimeout>[] = [];
    const advanceTo = (status: PreviewStatus, atMs: number, log: string) => {
      timers.push(
        setTimeout(() => {
          if (this._status !== "ready" && this._status !== "error") {
            this.addLog(log);
            this.setState({ status });
          }
        }, atMs),
      );
    };
    advanceTo("installing", 1200, "Installing dependencies with bun...");
    advanceTo("starting-dev", 5000, "Starting Vite dev server...");

    try {
      // デスクトップ版は実体ディレクトリを直接参照するためファイル送信は
      // 不要。sidecarは実体でbun install→vite起動する（ADR-008）。
      const res = await fetch(`${sidecarBase()}/api/preview/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Preview start failed (${res.status})`);
      }
      this._url = data.url;
      this.setState({ url: data.url, status: "ready" });
      this.addLog(`Dev server ready at ${data.url}`);
    } catch (e: any) {
      const msg = e.message || String(e);
      console.error("[preview] start failed:", e);
      this.setState({ status: "error", error: msg, url: null });
    } finally {
      timers.forEach(clearTimeout);
    }
  }

  /** ファイル変更をサイドカーに同期する（Vite HMR が自動反映）。
   *  デスクトップ版では実体ディレクトリをRust IPCで直接書き込むため、
   *  ファイル同期は不要。viteのHMRが自動反映する（ADR-008）。 */
  async syncAndReload(appId: string): Promise<void> {
    if (this._appId !== appId) {
      await this.boot(appId);
      return;
    }
    // 実体を直接編集しているため、再同期は不要（HMRが反映）。
    // ただし旧フロー（files送信）との互換のため、ここでは何もしない。
    this.setState({ status: "ready" });
  }

  /** エラーチェック前の同期 — デスクトップでは syncAndReload と同じ（Vite HMR が反映） */
  async syncForErrors(appId: string): Promise<void> {
    await this.syncAndReload(appId);
  }

  /** tsc --noEmit + Viteエラー検出（サイドカーで実行） */
  async checkApp(appId: string): Promise<import("./types").ErrorEntry[]> {
    if (this._appId !== appId && this._status !== "ready") {
      return [];
    }
    this.addLog("Running type check (tsc --noEmit)...");
    try {
      const res = await fetch(`${sidecarBase()}/api/preview/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Check failed (${res.status})`);
      }
      const errors = (data.errors || []) as import("./types").ErrorEntry[];
      const typeErrors = errors.filter((e) => e.type === "typescript").length;
      const viteErrors = errors.filter((e) => e.type === "vite").length;
      if (errors.length > 0) {
        this.addLog(`Check complete: ${typeErrors} type error(s), ${viteErrors} Vite error(s)`);
      } else {
        this.addLog("Check complete: no errors found");
      }
      return errors;
    } catch (e: any) {
      const msg = e.message || String(e);
      console.error("[preview] check failed:", e);
      this.addLog(`Check error: ${msg}`);
      return [{ type: "typescript", message: msg }];
    }
  }

  /** プレビューを停止する */
  async teardown(): Promise<void> {
    this._appId = null;
    this._url = null;
    this._status = "idle";
    try {
      await fetch(`${sidecarBase()}/api/preview/stop`, { method: "POST" });
    } catch {
      // サイドカー未起動なら無視
    }
    this.clearLogs();
  }
}
