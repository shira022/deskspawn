import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Create a mock IndexedDB that can handle open() and deleteDatabase()
 * with the callback pattern used by compatibility.ts.
 */
function createMockIndexedDB() {
  const dbs: Record<string, { objectStoreNames: string[]; objectStores: Record<string, unknown> }> = {};

  function createRequest() {
    const req: {
      result: {
        objectStoreNames: { contains: (n: string) => boolean };
        createObjectStore: (n: string) => void;
        close: ReturnType<typeof vi.fn>;
      };
      onupgradeneeded: ((evt: { target: typeof req }) => void) | null;
      onsuccess: ((evt: { target: typeof req }) => void) | null;
      onerror: ((evt: { target: typeof req }) => void) | null;
      error: Error | null;
    } = {
      result: {
        objectStoreNames: { contains: () => false },
        createObjectStore: () => {},
        close: vi.fn(),
      },
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      error: null,
    };
    return req;
  }

  const mock = {
    open: vi.fn((name: string, _version?: number) => {
      if (!dbs[name]) {
        dbs[name] = { objectStoreNames: [], objectStores: {} };
      }
      const dbState = dbs[name];
      const req = createRequest();
      req.result = {
        objectStoreNames: {
          contains: (n: string) => dbState.objectStoreNames.includes(n),
        },
        createObjectStore: (n: string) => {
          dbState.objectStoreNames.push(n);
        },
        close: vi.fn(),
      };

      // Fire onupgradeneeded then onsuccess asynchronously
      queueMicrotask(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }),
    deleteDatabase: vi.fn((name: string) => {
      delete dbs[name];
      const req = createRequest();
      queueMicrotask(() => {
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }),
  };
  return mock;
}

describe("checkCompatibility", () => {
  let mockIDB: ReturnType<typeof createMockIndexedDB>;

  beforeEach(() => {
    mockIDB = createMockIndexedDB();
    vi.stubGlobal("indexedDB", mockIDB);
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("crypto", { subtle: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok=true when all features available", async () => {
    const { checkCompatibility } = await import("./compatibility");
    const result = await checkCompatibility();

    expect(result.ok).toBe(true);
    expect(result.indexedDB).toBe(true);
    expect(result.crossOriginIsolated).toBe(true);
    expect(result.crypto).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports indexedDB failure when indexedDB is undefined", async () => {
    vi.stubGlobal("indexedDB", undefined);

    const { checkCompatibility } = await import("./compatibility");
    const result = await checkCompatibility();

    expect(result.ok).toBe(false);
    expect(result.indexedDB).toBe(false);
    expect(result.errors).toContain(
      "IndexedDB is not supported by this browser.",
    );
  });

  it("reports indexedDB failure when indexedDB.open fails", async () => {
    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => {
        const req: Record<string, unknown> = {
          result: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          error: new Error("blocked"),
        };
        queueMicrotask(() => {
          if (typeof req.onerror === "function") {
            (req.onerror as (evt: unknown) => void)({ target: req });
          }
        });
        return req;
      }),
      deleteDatabase: vi.fn(),
    });

    const { checkCompatibility } = await import("./compatibility");
    const result = await checkCompatibility();

    expect(result.ok).toBe(false);
    expect(result.indexedDB).toBe(false);
    expect(result.errors).toContain(
      "IndexedDB is not available (may be blocked in private browsing mode).",
    );
  });

  it("reports crossOriginIsolated failure when set to false", async () => {
    vi.stubGlobal("crossOriginIsolated", false);

    const { checkCompatibility } = await import("./compatibility");
    const result = await checkCompatibility();

    expect(result.crossOriginIsolated).toBe(false);
    // indexedDB + crypto still ok
    expect(result.ok).toBe(true);
    // The error message starts with this text
    expect(result.errors[0]).toMatch(/^Cross-Origin Isolation is required/);
  });

  it("reports crypto failure when crypto.subtle is undefined", async () => {
    vi.stubGlobal("crypto", { subtle: undefined } as unknown as Crypto);

    const { checkCompatibility } = await import("./compatibility");
    const result = await checkCompatibility();

    expect(result.ok).toBe(false);
    expect(result.crypto).toBe(false);
    expect(result.errors).toContain(
      "Web Crypto API is not available (required for secure key storage).",
    );
  });

  it("reports multiple failures with ok=false and combined errors", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("crossOriginIsolated", false);
    vi.stubGlobal("crypto", undefined);

    const { checkCompatibility } = await import("./compatibility");
    const result = await checkCompatibility();

    expect(result.ok).toBe(false);
    expect(result.indexedDB).toBe(false);
    expect(result.crossOriginIsolated).toBe(false);
    expect(result.crypto).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors).toContain(
      "IndexedDB is not supported by this browser.",
    );
    expect(result.errors).toContain(
      "Web Crypto API is not available (required for secure key storage).",
    );
  });
});

describe("getCompatErrorMessage", () => {
  it("returns empty string when result.ok is true", async () => {
    const { getCompatErrorMessage } = await import("./compatibility");
    const msg = getCompatErrorMessage({
      ok: true,
      indexedDB: true,
      crossOriginIsolated: true,
      crypto: true,
      errors: [],
    });
    expect(msg).toBe("");
  });

  it("returns a formatted error message when not ok", async () => {
    const { getCompatErrorMessage } = await import("./compatibility");
    const msg = getCompatErrorMessage({
      ok: false,
      indexedDB: false,
      crossOriginIsolated: true,
      crypto: true,
      errors: ["IndexedDB is not supported by this browser."],
    });

    expect(msg).toContain("IndexedDB");
    expect(msg).toContain("DeskSpawn requires a modern browser");
  });

  it("includes crossOriginIsolated in message when false", async () => {
    const { getCompatErrorMessage } = await import("./compatibility");
    const msg = getCompatErrorMessage({
      ok: false,
      indexedDB: true,
      crossOriginIsolated: false,
      crypto: true,
      errors: [],
    });

    expect(msg).toContain("Cross-Origin Isolation");
  });

  it("includes crypto in message when false", async () => {
    const { getCompatErrorMessage } = await import("./compatibility");
    const msg = getCompatErrorMessage({
      ok: false,
      indexedDB: true,
      crossOriginIsolated: true,
      crypto: false,
      errors: [],
    });

    expect(msg).toContain("Web Crypto API");
  });

  it("recommends browsers at the end of the message", async () => {
    const { getCompatErrorMessage } = await import("./compatibility");
    const msg = getCompatErrorMessage({
      ok: false,
      indexedDB: false,
      crossOriginIsolated: false,
      crypto: false,
      errors: [],
    });

    expect(msg).toContain("Chrome 105+");
  });
});
