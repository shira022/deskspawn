import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUpstreamVerified, pumpStreamWithIdleTimeout } from "../src/server";

const UPSTREAM_URL = new URL("https://api.example.com/v1/chat/completions");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchUpstreamVerified", () => {
  it("ヘッダが期限内に返らない場合は中断する", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    await expect(
      fetchUpstreamVerified(UPSTREAM_URL, {}, new AbortController(), 20),
    ).rejects.toThrow("upstream headers timeout");
  });

  it("ヘッダ受信後はタイマーを解除し、ボディが遅くても中断しない", async () => {
    let captured: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      captured = (init as RequestInit | undefined)?.signal ?? undefined;
      return new Response("ok", { status: 200 });
    });

    const res = await fetchUpstreamVerified(UPSTREAM_URL, {}, new AbortController(), 10);
    await sleep(40);

    expect(captured?.aborted).toBe(false);
    await expect(res.text()).resolves.toBe("ok");
  });
});

describe("pumpStreamWithIdleTimeout", () => {
  it("チャンク間の無通信が閾値を超えたら cancel して終了する", async () => {
    const chunk = new Uint8Array([1, 2, 3]);
    let cancelled = false;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: chunk })
        .mockImplementationOnce(() => new Promise(() => {})),
      cancel: vi.fn(async () => {
        cancelled = true;
      }),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const received: Uint8Array[] = [];
    await pumpStreamWithIdleTimeout(reader, (value) => received.push(value), 20);

    expect(received).toEqual([chunk]);
    expect(cancelled).toBe(true);
  });

  it("ストリームが正常終了したら cancel せずに終了する", async () => {
    const chunk = new Uint8Array([1]);
    let cancelled = false;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: chunk })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn(async () => {
        cancelled = true;
      }),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const received: Uint8Array[] = [];
    await pumpStreamWithIdleTimeout(reader, (value) => received.push(value), 1000);

    expect(received).toEqual([chunk]);
    expect(cancelled).toBe(false);
  });
});
