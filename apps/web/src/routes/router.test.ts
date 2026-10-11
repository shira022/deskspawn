// @vitest-environment jsdom
/**
 * useRouter — クエリパラメータ判定・遷移・localStorage 復元のテスト。
 *
 * この環境では jsdom の localStorage が露出されない（Node 側の
 * --localstorage-file 未指定によるもの）ため、グローバルをスタブして
 * ルーターが読む `localStorage` を差し替える。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRouter } from "./router";

const ROUTE_KEY = "deskspawn_route";

function stubLocalStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = String(value);
    },
    removeItem: (key: string) => {
      delete data[key];
    },
    clear: () => {
      for (const key of Object.keys(data)) delete data[key];
    },
  });
  return data;
}

beforeEach(() => {
  stubLocalStorage();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("useRouter", () => {
  it("既定は '/'", () => {
    const { result } = renderHook(() => useRouter());

    expect(result.current[0]).toBe("/");
  });

  it("?page=app なら '/app' から始まる", () => {
    window.history.replaceState({}, "", "/?page=app");

    const { result } = renderHook(() => useRouter());

    expect(result.current[0]).toBe("/app");
  });

  it("navigate はルートを切り替え、localStorage に残す", () => {
    const data = stubLocalStorage();
    const { result } = renderHook(() => useRouter());

    act(() => {
      result.current[1]("/app");
    });

    expect(result.current[0]).toBe("/app");
    expect(data[ROUTE_KEY]).toBe("/app");

    act(() => {
      result.current[1]("/");
    });
    expect(result.current[0]).toBe("/");
    expect(data[ROUTE_KEY]).toBe("/");
  });

  it("前回 '/app' を開いていたらマウント時に復元する", () => {
    stubLocalStorage({ [ROUTE_KEY]: "/app" });

    const { result } = renderHook(() => useRouter());

    expect(result.current[0]).toBe("/app");
  });

  it("保存済みが '/app' 以外（壊れた値含む）なら '/' のまま", () => {
    stubLocalStorage({ [ROUTE_KEY]: "/unknown" });

    const { result } = renderHook(() => useRouter());

    expect(result.current[0]).toBe("/");
  });
});
