import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../src/server";

const realFetch = globalThis.fetch.bind(globalThis);

let server: Server;
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type UpstreamCall = { url: string; init?: RequestInit };

/** アプリ本体（realFetch）は実サーバーへ、上流 fetch だけをモックする。 */
function mockUpstream(makeResponse: () => Response): UpstreamCall[] {
  const calls: UpstreamCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.startsWith(base)) {
      return realFetch(input, init);
    }
    calls.push({ url, init });
    return makeResponse();
  });
  return calls;
}

function postLocal(
  path: string,
  headers: Record<string, string>,
  body: unknown = { model: "llama3.2", messages: [] },
): Promise<Response> {
  return realFetch(`${base}/local/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("/local/v1 proxy", () => {
  it("forwards an allowed /chat/completions request and returns the upstream body", async () => {
    const upstreamBody = { id: "chatcmpl-1", choices: [] };
    const calls = mockUpstream(
      () =>
        new Response(JSON.stringify(upstreamBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await postLocal("/chat/completions", {
      "x-local-endpoint": "http://localhost:11434/v1",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(upstreamBody);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "llama3.2",
      messages: [],
    });
  });

  it("forwards the query string and Authorization header unchanged", async () => {
    const calls = mockUpstream(() => new Response("{}", { status: 200 }));

    const res = await postLocal(
      "/completions?foo=bar",
      {
        "x-local-endpoint": "http://localhost:1234/v1",
        Authorization: "Bearer local-key",
      },
      { prompt: "hi" },
    );

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("http://localhost:1234/v1/completions?foo=bar");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer local-key");
  });

  it("returns the SSE body for streaming responses", async () => {
    mockUpstream(
      () =>
        new Response("data: hello\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const res = await postLocal("/chat/completions", {
      "x-local-endpoint": "http://localhost:11434/v1",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await expect(res.text()).resolves.toBe("data: hello\n\n");
  });

  it("rejects a path outside the allow list with 400 INVALID_UPSTREAM_PATH", async () => {
    const calls = mockUpstream(() => new Response("{}", { status: 200 }));

    const res = await postLocal("/admin", {
      "x-local-endpoint": "http://localhost:11434/v1",
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      errorCode: "INVALID_UPSTREAM_PATH",
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects a cloud metadata endpoint with 400 INVALID_LOCAL_ENDPOINT", async () => {
    const calls = mockUpstream(() => new Response("{}", { status: 200 }));

    const res = await postLocal("/chat/completions", {
      "x-local-endpoint": "http://169.254.169.254",
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      errorCode: "INVALID_LOCAL_ENDPOINT",
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects a missing x-local-endpoint header with 400", async () => {
    const calls = mockUpstream(() => new Response("{}", { status: 200 }));

    const res = await postLocal("/chat/completions", {});

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      errorCode: "INVALID_LOCAL_ENDPOINT",
    });
    expect(calls).toHaveLength(0);
  });

  it("returns JSON { error, errorCode } when the upstream request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const res = await postLocal("/chat/completions", {
      "x-local-endpoint": "http://localhost:11434/v1",
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      errorCode: "LOCAL_UPSTREAM_FAILED",
    });
  });
});
