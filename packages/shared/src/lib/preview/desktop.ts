/**
 * Desktop preview manager — runs the generated app's Vite dev server
 * locally via the sidecar (Bun). No WebContainer/StackBlitz dependency.
 *
 * Same public interface as PreviewManager (webcontainer.ts) so that
 * PreviewPanel and tool-executors can use it transparently.
 */

import { sidecarFetch } from "../sidecar";
import type { PreviewState, PreviewStatus, StateListener } from "./types";

// ── boot() の有限リトライ設定 ────────────────────────────────────────────────
// 新規アプリ作成直後、テンプレート書き込みとプレビュー boot の間に競合が
// 起き得る（currentAppId 変更を契機に PreviewPanel が即 boot する）。
// サイドカーは package.json が無い間は 400 "Project has no package.json"
// を返すため、その 400 のみ計3回（500ms/1s/2s バックオフ）自動リトライする。

/** リトライの最大試行回数（初回含む） */
const MAX_BOOT_ATTEMPTS = 3;
/** 初回失敗後のリトライ間隔（インデックス = 失敗回数-1） */
const BOOT_RETRY_DELAYS_MS = [500, 1000, 2000];

/** HTTP ステータスを保持する /api/preview/start のエラー（リトライ判定用） */
class PreviewStartHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PreviewStartHttpError";
  }
}

/**
 * 「アプリがまだスキャフォールドされていない」側の 400 かどうか。
 * HTTP 400 かつエラーメッセージに package.json が含まれる場合のみ
 * リトライ対象とする（appId の値では判定しない）。それ以外の 400・
 * 500・ネットワーク断は即座に失敗させる。
 */
function isNotScaffoldedHttpError(e: unknown): e is PreviewStartHttpError {
  return (
    e instanceof PreviewStartHttpError &&
    e.status === 400 &&
    e.message.includes("package.json")
  );
}

/** setTimeout ベースのスリープ（テストで fake timers 化できるよう分離） */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
      // package.json 無しの 400（＝まだスキャフォールドされていない）の
      // みバックオフ付きで自動リトライし、テンプレート書き込みの完了を
      // 待って復帰する。それ以外のエラーは即座に失敗（リトライ連発防止）。
      let attempt = 0;
      for (;;) {
        attempt++;
        this.addLog(`Starting dev server (attempt ${attempt}/${MAX_BOOT_ATTEMPTS})...`);
        const res = await sidecarFetch("/api/preview/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new PreviewStartHttpError(
            data.error || `Preview start failed (${res.status})`,
            res.status,
          );
          if (isNotScaffoldedHttpError(err) && attempt < MAX_BOOT_ATTEMPTS) {
            const delay = BOOT_RETRY_DELAYS_MS[attempt - 1];
            this.addLog(
              `Project not scaffolded yet (no package.json) — retrying in ${delay}ms...`,
            );
            await sleep(delay);
            continue;
          }
          throw err;
        }
        this._url = data.url;
        this.setState({ url: data.url, status: "ready", error: null });
        this.addLog(`Dev server ready at ${data.url}`);
        return;
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      console.error("[preview] start failed:", e);
      this.addLog(`Preview start failed: ${msg}`);
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
      const res = await sidecarFetch("/api/preview/check", {
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
      await sidecarFetch("/api/preview/stop", { method: "POST" });
    } catch {
      // サイドカー未起動なら無視
    }
    this.clearLogs();
  }
}
