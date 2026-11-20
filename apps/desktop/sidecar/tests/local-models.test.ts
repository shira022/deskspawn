import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLocalModels, validateLocalEndpoint } from "../src/server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateLocalEndpoint", () => {
  it.each([
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://127.10.20.30:11434",
    "http://[::1]:11434",
    "http://10.0.0.5:11434",
    "http://172.16.0.1:11434",
    "http://172.31.255.254:11434",
    "http://192.168.1.50:1234/v1",
    "https://192.168.0.10:1234",
  ])("allows loopback / private address %s", (raw) => {
    expect(validateLocalEndpoint(raw)).toMatchObject({ ok: true });
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://100.100.100.200",
    "http://0.0.0.0:11434",
    "http://metadata.google.internal",
    "http://8.8.8.8:11434",
    "http://user:pass@localhost:11434",
    "file:///etc/passwd",
    "ftp://localhost:11434",
    "",
  ])("rejects %s", (raw) => {
    expect(validateLocalEndpoint(raw)).toMatchObject({ ok: false });
  });

  it("normalizes a trailing slash from the returned base URL", () => {
    expect(validateLocalEndpoint("http://localhost:11434/")).toMatchObject({
      ok: true,
      url: "http://localhost:11434",
    });
  });
});

describe("fetchLocalModels", () => {
  it("returns ollama model names from GET /api/tags", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "llama3:latest" }, { name: "mistral:latest" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await fetchLocalModels("ollama");

    expect(result).toEqual({ ok: true, models: ["llama3:latest", "mistral:latest"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/tags");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the provided ollama endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "tinyllama" }] }), { status: 200 }),
    );

    await fetchLocalModels("ollama", "http://192.168.1.20:11434");

    expect(fetchMock.mock.calls[0][0]).toBe("http://192.168.1.20:11434/api/tags");
  });

  it("returns lm-studio model ids from the default /v1/models endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5-7b-instruct" }, { id: "llama-3.2-3b-instruct" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await fetchLocalModels("lm-studio");

    expect(result).toEqual({
      ok: true,
      models: ["qwen2.5-7b-instruct", "llama-3.2-3b-instruct"],
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/models");
  });

  it("appends /v1/models when the lm-studio endpoint has no /v1 suffix", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    await fetchLocalModels("lm-studio", "http://192.168.1.50:1234");

    expect(fetchMock.mock.calls[0][0]).toBe("http://192.168.1.50:1234/v1/models");
  });

  it("returns 400 INVALID_LOCAL_ENDPOINT without fetching for a blocked endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await fetchLocalModels("ollama", "http://169.254.169.254");

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      errorCode: "INVALID_LOCAL_ENDPOINT",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_LOCAL_ENDPOINT for userinfo in the URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await fetchLocalModels("ollama", "http://user:pass@localhost:11434");

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 LOCAL_UPSTREAM_FAILED when the upstream fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const result = await fetchLocalModels("ollama");

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      errorCode: "LOCAL_UPSTREAM_FAILED",
    });
  });

  it("returns 502 LOCAL_UPSTREAM_FAILED when the upstream responds non-OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad gateway", { status: 500 }),
    );

    const result = await fetchLocalModels("lm-studio");

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      errorCode: "LOCAL_UPSTREAM_FAILED",
    });
  });

  it("returns 502 LOCAL_UPSTREAM_FAILED for invalid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 200 }),
    );

    const result = await fetchLocalModels("ollama");

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      errorCode: "LOCAL_UPSTREAM_FAILED",
    });
  });

  it("returns an empty list when the upstream payload lacks the expected array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await expect(fetchLocalModels("ollama")).resolves.toEqual({ ok: true, models: [] });
  });
});
