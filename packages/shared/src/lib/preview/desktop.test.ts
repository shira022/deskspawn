/**
 * Tests for DesktopPreviewManager boot() — bounded retry behaviour + url lifecycle.
 *
 * 新規アプリ作成直後の競合（テンプレート書き込み前にプレビュー boot が
 * サイドカーに到達し 400 "Project has no package.json" を返される）に対し、
 * その 400 のみが計3回（500ms/1s/2s）自動リトライされ、それ以外のエラーは
 * 即座に失敗することを検証する。
 *
 * あわせて url ライフサイクルも検証する: boot 開始時に前アプリの url が
 * クリアされること、起動完了時にサイドカーが返す実ポート（5175〜への
 * フォールバック含む）へ追従すること。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock ../sidecar ──────────────────────────────────────────────────────────

vi.mock("../sidecar", () => ({
  sidecarFetch: vi.fn(),
}));

import { sidecarFetch } from "../sidecar";
import { DesktopPreviewManager } from "./desktop";
import type { PreviewState } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** サイドカーが package.json 無しで返す 400 のエラーメッセージ（実装と同一） */
const NO_PACKAGE_JSON_ERROR =
  "Project has no package.json — create the project first";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** リスナー経由で状態の変遷を記録する（最後の要素が最新状態） */
function trackState(manager: DesktopPreviewManager): PreviewState[] {
  const states: PreviewState[] = [];
  manager.onStateChange((s) => states.push(s));
  return states;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DesktopPreviewManager boot() retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // catch 節の console.error をテスト出力に出さない
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("400 no-package.json twice then 200 → exactly 3 requests, ready, url set", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    vi.mocked(sidecarFetch)
      .mockResolvedValueOnce(jsonResponse(400, { error: NO_PACKAGE_JSON_ERROR }))
      .mockResolvedValueOnce(jsonResponse(400, { error: NO_PACKAGE_JSON_ERROR }))
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "http://localhost:5174/", port: 5174 }),
      )
      // 4回目は boot 完了後の /projects/ready 実ポート確認（防御チェック）
      .mockResolvedValueOnce(jsonResponse(200, { ready: true, port: 5174 }));

    const bootPromise = manager.boot("app-1");
    // 1回目失敗(t≈0) → 500ms 後リトライ → 2回目失敗(t≈500) → 1000ms 後リトライ
    // → 3回目成功(t≈1500)。advanceTo("installing", 1200ms) も途中で発火する。
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await bootPromise;

    // boot リクエスト（POST /api/preview/start）は3回のみ。総呼び出しは
    // 実ポート確認の GET /projects/ready を含めて4回になる。
    const startCalls = vi
      .mocked(sidecarFetch)
      .mock.calls.filter(([path]) => path === "/api/preview/start");
    expect(startCalls).toHaveLength(3);
    expect(sidecarFetch).toHaveBeenCalledTimes(4);
    // 全 boot リクエストが同じ appId に POST している
    for (const call of startCalls) {
      expect(call[0]).toBe("/api/preview/start");
      expect(JSON.parse(String(call[1]?.body)).appId).toBe("app-1");
    }

    // 段階的ステータスは機能し続けている（準備中表示が保たれる）
    expect(states.some((s) => s.status === "booting")).toBe(true);
    expect(states.some((s) => s.status === "installing")).toBe(true);

    const final = states[states.length - 1];
    expect(final.status).toBe("ready");
    expect(final.url).toBe("http://localhost:5174/");
    // リトライ成功時はエラーが残らない
    expect(final.error).toBeNull();
    // 各試行がログに出ている
    expect(final.logs.some((l) => l.includes("attempt 1/3"))).toBe(true);
    expect(final.logs.some((l) => l.includes("attempt 2/3"))).toBe(true);
    expect(final.logs.some((l) => l.includes("attempt 3/3"))).toBe(true);
    expect(final.logs.some((l) => l.includes("retrying in 500ms"))).toBe(true);
  });

  it("retryable 400 that always fails → error surfaced only after 3 attempts", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    vi.mocked(sidecarFetch).mockImplementation(
      async () => jsonResponse(400, { error: NO_PACKAGE_JSON_ERROR }),
    );

    const bootPromise = manager.boot("app-1");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    // 2回失敗した時点ではまだエラーを表示しない（リトライ中のため）
    expect(sidecarFetch).toHaveBeenCalledTimes(2);
    expect(states.some((s) => s.status === "error")).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    // 3回目で最終失敗 → ここで初めてエラー状態になる
    await vi.advanceTimersByTimeAsync(2000);
    await bootPromise;

    expect(sidecarFetch).toHaveBeenCalledTimes(3);
    const final = states[states.length - 1];
    expect(final.status).toBe("error");
    expect(final.error).toContain("package.json");
    expect(final.url).toBeNull();
  });

  it("non-retryable 500 → exactly 1 request, error surfaced immediately", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    vi.mocked(sidecarFetch).mockResolvedValue(
      jsonResponse(500, { error: "Dev server did not start within 30s" }),
    );

    await manager.boot("app-1");

    expect(sidecarFetch).toHaveBeenCalledTimes(1);
    const final = states[states.length - 1];
    expect(final.status).toBe("error");
    expect(final.error).toContain("Dev server did not start within 30s");
    expect(final.url).toBeNull();
  });

  it("400 whose message does not mention package.json → fail fast (no retry)", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    vi.mocked(sidecarFetch).mockResolvedValue(
      jsonResponse(400, { error: "Invalid projectId" }),
    );

    await manager.boot("app-1");

    expect(sidecarFetch).toHaveBeenCalledTimes(1);
    const final = states[states.length - 1];
    expect(final.status).toBe("error");
    expect(final.error).toContain("Invalid projectId");
  });

  it("network error (fetch rejects) → exactly 1 request, fail fast", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    vi.mocked(sidecarFetch).mockRejectedValue(
      new Error("fetch failed to connect"),
    );

    await manager.boot("app-1");

    expect(sidecarFetch).toHaveBeenCalledTimes(1);
    const final = states[states.length - 1];
    expect(final.status).toBe("error");
    expect(final.error).toContain("fetch failed to connect");
    expect(final.url).toBeNull();
  });

  it("first-attempt success → single boot request, ready (no behaviour regression)", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    // 1回目: POST /api/preview/start 成功 / 2回目: GET /projects/ready 実ポート確認
    // （ポート一致 → 補正なし）。それぞれ別々の Response を返す（body 再読み不可のため）。
    vi.mocked(sidecarFetch)
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "http://localhost:5175/", port: 5175 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ready: true, port: 5175 }));

    await manager.boot("app-2");

    const startCalls = vi
      .mocked(sidecarFetch)
      .mock.calls.filter(([path]) => path === "/api/preview/start");
    expect(startCalls).toHaveLength(1);
    expect(sidecarFetch).toHaveBeenCalledTimes(2);
    const final = states[states.length - 1];
    expect(final.status).toBe("ready");
    expect(final.url).toBe("http://localhost:5175/");
    expect(final.error).toBeNull();
  });
});

// ─── boot() の url ライフサイクル ─────────────────────────────────────────────
// アプリ切替時に前アプリの URL/ポート（＝ドキュメント）が pane に残らないこと、
// および起動完了時に「実際に起動したサーバー」の実ポート（5174 埋まっていれば
// 5175〜へのフォールバックも含む）へ常に追従することを検証する。

describe("DesktopPreviewManager boot() url lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("boot 開始時に前アプリの url がクリアされ、応答の実ポート（5175 フォールバック）に差し替わる", async () => {
    const manager = new DesktopPreviewManager();

    // まず app-1 を 5174 で ready にする（ready 確認の port も一致させる）
    vi.mocked(sidecarFetch)
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "http://localhost:5174/", port: 5174 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ready: true, port: 5174 }));
    await manager.boot("app-1");
    expect(manager.url).toBe("http://localhost:5174/");

    // app-2 の boot 開始を観測するため、start の応答を手動で解決させる
    const states = trackState(manager);
    let resolveStart!: (r: Response) => void;
    const startPromise = new Promise<Response>((resolve) => {
      resolveStart = resolve;
    });
    vi.mocked(sidecarFetch)
      .mockReturnValueOnce(startPromise)
      // app-2 の ready 確認（start 応答と同じ実ポートを返す）
      .mockResolvedValueOnce(jsonResponse(200, { ready: true, port: 5175 }));

    const bootPromise = manager.boot("app-2");
    await vi.advanceTimersByTimeAsync(0);

    // ★ boot 開始直後: status は booting で url は null — 前アプリの 5174 が
    //   残っていてはならない（booting 状態で url を伴う通知は一度も無い）。
    expect(states.some((s) => s.status === "booting" && s.url !== null)).toBe(
      false,
    );
    const afterStart = states[states.length - 1];
    expect(afterStart.status).toBe("booting");
    expect(afterStart.url).toBeNull();
    // 「サーバーの応答待ち」のログが1行出ている
    expect(
      afterStart.logs.some((l) => l.includes("Waiting for the dev server")),
    ).toBe(true);

    // start 応答: 5174 が埋まって 5175 にフォールバックした実ポート
    resolveStart(jsonResponse(200, { url: "http://localhost:5175/", port: 5175 }));
    await vi.advanceTimersByTimeAsync(0);
    await bootPromise;

    // 完了時はレスポンスの実 url をそのまま採用（ポートのハードコード無し）
    const final = states[states.length - 1];
    expect(final.status).toBe("ready");
    expect(final.url).toBe("http://localhost:5175/");
    expect(final.error).toBeNull();
    expect(manager.url).toBe("http://localhost:5175/");
  });

  it("start 応答のポートと /projects/ready の実測が食い違えば実測ポートへ補正される", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    // start は 5174 を返すが、サイドカーの実測ポートは 5176 → 実測を優先
    vi.mocked(sidecarFetch)
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "http://localhost:5174/", port: 5174 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ready: true, port: 5176 }));

    await manager.boot("app-1");

    const final = states[states.length - 1];
    expect(final.status).toBe("ready");
    expect(final.url).toBe("http://localhost:5176/");
    expect(manager.url).toBe("http://localhost:5176/");
    expect(final.logs.some((l) => l.includes("actual port 5176"))).toBe(true);
  });

  it("/projects/ready の確認に失敗しても start 応答の url をそのまま使う", async () => {
    const manager = new DesktopPreviewManager();
    const states = trackState(manager);

    vi.mocked(sidecarFetch)
      .mockResolvedValueOnce(
        jsonResponse(200, { url: "http://localhost:5174/", port: 5174 }),
      )
      .mockRejectedValueOnce(new Error("ready check failed"));

    await manager.boot("app-1");

    const final = states[states.length - 1];
    expect(final.status).toBe("ready");
    // 確認失敗は致命的ではない — start 応答の実 url のまま
    expect(final.url).toBe("http://localhost:5174/");
    expect(final.error).toBeNull();
  });
});
