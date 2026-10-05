/**
 * sidecar.ts — サイドカー接続（ポート解決・H1 トークン付与）のテスト。
 *
 * 実サイドカー／実ネットワークは使わず、Tauri IPC と fetch をモックする。
 * モジュールはトークンをキャッシュするため、テスト順序を
 * 「IPC 失敗（キャッシュされない）→ IPC 成功（キャッシュされる」に固定している。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { getSidecarPort, sidecarBase, getSidecarToken, sidecarFetch, sidecarFetchWithToken } from "./sidecar";

const fetchMock = vi.fn();

function lastHeaders(): Headers {
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit;
  return init.headers as Headers;
}

beforeEach(() => {
  invokeMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSidecarPort / sidecarBase", () => {
  it("グローバル未設定ならデフォルトポートを使う", () => {
    vi.stubGlobal("window", {});
    expect(getSidecarPort()).toBe(3009);
    expect(sidecarBase()).toBe("http://localhost:3009");
  });

  it("Rust 側が検出したポートを優先する", () => {
    vi.stubGlobal("window", { __DESKSPAWN_SIDECAR_PORT__: 3012 });
    expect(getSidecarPort()).toBe(3012);
    expect(sidecarBase()).toBe("http://localhost:3012");
  });

  it("0 / 負値 / 数値でない値は無視してデフォルトに戻す", () => {
    for (const invalid of [0, -1, "3010", null, undefined]) {
      vi.stubGlobal("window", { __DESKSPAWN_SIDECAR_PORT__: invalid });
      expect(getSidecarPort(), String(invalid)).toBe(3009);
    }
  });

  it("window 自体が無い環境でもデフォルトを返す", () => {
    vi.stubGlobal("window", undefined);
    expect(getSidecarPort()).toBe(3009);
  });
});

describe("sidecarFetch（H1 トークン付与）", () => {
  it("IPC が使えない環境ではトークン無しの素の fetch になる", async () => {
    invokeMock.mockRejectedValue(new Error("not in a Tauri environment"));

    await sidecarFetch("/api/config", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3009/api/config", {
      method: "POST",
      headers: expect.any(Headers),
    });
    expect(lastHeaders().get("X-DeskSpawn-Token")).toBeNull();
    // 失敗はキャッシュされない（次回以降も再試行する）
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("IPC 成功時はトークンをヘッダに付与し、2回目はキャッシュを使う", async () => {
    invokeMock.mockResolvedValue("tok-desktop-1");

    await sidecarFetch("/api/config", { method: "POST" });

    expect(invokeMock).toHaveBeenCalledWith("get_sidecar_token");
    expect(lastHeaders().get("X-DeskSpawn-Token")).toBe("tok-desktop-1");
    expect(await getSidecarToken()).toBe("tok-desktop-1");

    // 2回目: キャッシュから返るため IPC は呼ばれない
    await getSidecarToken();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("sidecarFetchWithToken も任意の入力 URL にトークンを付与する", async () => {
    // 上のテストでキャッシュ済みトークンを使う
    await sidecarFetchWithToken("http://localhost:3009/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3009/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lastHeaders().get("X-DeskSpawn-Token")).toBe("tok-desktop-1");
    expect(lastHeaders().get("Content-Type")).toBe("application/json");
  });
});
