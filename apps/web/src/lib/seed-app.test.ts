import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock storage-opfs ───────────────────────────────────────────────────────

const mockStorageOpfs = {
  listAppFiles: vi.fn(),
  writeAppFile: vi.fn(),
  appFileExists: vi.fn(),
};

vi.mock("./storage-opfs", () => mockStorageOpfs);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(data),
  };
}

describe("seedAppFromFilesystem", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockStorageOpfs.writeAppFile.mockReset().mockResolvedValue(undefined);
    mockStorageOpfs.appFileExists.mockReset().mockResolvedValue(false);
    mockStorageOpfs.listAppFiles.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches app files and writes them to OPFS", async () => {
    const appId = "test-app-1";
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Hello</h1>",
          "src/app.ts": "console.log('hi')",
        },
        appId,
      }),
    );

    const { seedAppFromFilesystem } = await import("./seed-app");
    const result = await seedAppFromFilesystem(appId);

    expect(result).toEqual({ seeded: 2, skipped: 0 });
    expect(mockFetch).toHaveBeenCalledWith(`/api/app-files/${appId}`);
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledTimes(2);
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledWith(
      appId,
      "src/index.html",
      "<h1>Hello</h1>",
    );
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledWith(
      appId,
      "src/app.ts",
      "console.log('hi')",
    );
  });

  it("skips node_modules and package-lock.json files", async () => {
    const appId = "test-app-2";
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Hello</h1>",
          "node_modules/express/index.js": "// express",
          "package-lock.json": "{}",
        },
        appId,
      }),
    );

    const { seedAppFromFilesystem } = await import("./seed-app");
    const result = await seedAppFromFilesystem(appId);

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledTimes(1);
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledWith(
      appId,
      "src/index.html",
      "<h1>Hello</h1>",
    );
  });

  it("handles 404 response and returns zero counts", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(null, false));

    const { seedAppFromFilesystem } = await import("./seed-app");
    const result = await seedAppFromFilesystem("missing-proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeAppFile).not.toHaveBeenCalled();
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { seedAppFromFilesystem } = await import("./seed-app");
    const result = await seedAppFromFilesystem("error-proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeAppFile).not.toHaveBeenCalled();
  });

  it("skips existing files when force is not set", async () => {
    const appId = "test-app-3";
    mockStorageOpfs.appFileExists.mockResolvedValue(true);
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Hello</h1>",
          "src/app.ts": "console.log('hi')",
        },
        appId,
      }),
    );

    const { seedAppFromFilesystem } = await import("./seed-app");
    const result = await seedAppFromFilesystem(appId);

    expect(result).toEqual({ seeded: 0, skipped: 2 });
    expect(mockStorageOpfs.writeAppFile).not.toHaveBeenCalled();
    expect(mockStorageOpfs.appFileExists).toHaveBeenCalledTimes(2);
  });

  it("overwrites existing files when force=true", async () => {
    const appId = "test-app-4";
    mockStorageOpfs.appFileExists.mockResolvedValue(true);
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Forced</h1>",
        },
        appId,
      }),
    );

    const { seedAppFromFilesystem } = await import("./seed-app");
    const result = await seedAppFromFilesystem(appId, { force: true });

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    // Should NOT check if files exist when force=true
    expect(mockStorageOpfs.appFileExists).not.toHaveBeenCalled();
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledTimes(1);
  });

  it("continues writing other files when one write fails", async () => {
    const appId = "test-app-5";
    mockStorageOpfs.writeAppFile
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValueOnce(undefined);

    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/a.ts": "// a",
          "src/b.ts": "// b",
        },
        appId,
      }),
    );

    const { seedAppFromFilesystem } = await import("./seed-app");
    const result = await seedAppFromFilesystem(appId);

    // First write failed, second succeeded
    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledTimes(2);
  });
});

describe("seedAppFromWorkspace", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockStorageOpfs.writeAppFile.mockReset().mockResolvedValue(undefined);
    mockStorageOpfs.appFileExists.mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches workspace files and writes them to OPFS", async () => {
    const appId = "workspace-proj";
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Workspace</h1>",
          "src/style.css": "body { color: red; }",
        },
        appId,
      }),
    );

    const { seedAppFromWorkspace } = await import("./seed-app");
    const result = await seedAppFromWorkspace(appId);

    expect(result).toEqual({ seeded: 2, skipped: 0 });
    expect(mockFetch).toHaveBeenCalledWith("/api/app-files/_workspace_?type=workspace");
    expect(mockStorageOpfs.writeAppFile).toHaveBeenCalledTimes(2);
  });

  it("handles workspace fetch failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(null, false));

    const { seedAppFromWorkspace } = await import("./seed-app");
    const result = await seedAppFromWorkspace("proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeAppFile).not.toHaveBeenCalled();
  });

  it("handles workspace fetch network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));

    const { seedAppFromWorkspace } = await import("./seed-app");
    const result = await seedAppFromWorkspace("proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeAppFile).not.toHaveBeenCalled();
  });
});

describe("hasAppFiles", () => {
  beforeEach(() => {
    mockStorageOpfs.listAppFiles.mockReset();
  });

  it("returns true when source files are found", async () => {
    mockStorageOpfs.listAppFiles.mockResolvedValue([
      { path: "src/App.tsx", size: 100, lastModified: "2024-01-01", isDirectory: false },
    ]);

    const { hasAppFiles } = await import("./seed-app");
    const result = await hasAppFiles("app-1");

    expect(result).toBe(true);
  });

  it("returns false when only non-source files exist", async () => {
    mockStorageOpfs.listAppFiles.mockResolvedValue([
      { path: "package-lock.json", size: 500, lastModified: "2024-01-01", isDirectory: false },
      { path: "node_modules/express/index.js", size: 1000, lastModified: "2024-01-01", isDirectory: false },
    ]);

    const { hasAppFiles } = await import("./seed-app");
    const result = await hasAppFiles("app-2");

    expect(result).toBe(false);
  });

  it("returns false when no files exist", async () => {
    mockStorageOpfs.listAppFiles.mockResolvedValue([]);

    const { hasAppFiles } = await import("./seed-app");
    const result = await hasAppFiles("app-3");

    expect(result).toBe(false);
  });

  it("returns false when listAppFiles throws an error", async () => {
    mockStorageOpfs.listAppFiles.mockRejectedValue(new Error("OPFS error"));

    const { hasAppFiles } = await import("./seed-app");
    const result = await hasAppFiles("app-4");

    expect(result).toBe(false);
  });

  it("includes index.html and public/ files as source files", async () => {
    mockStorageOpfs.listAppFiles.mockResolvedValue([
      { path: "index.html", size: 100, lastModified: "2024-01-01", isDirectory: false },
      { path: "public/favicon.ico", size: 1024, lastModified: "2024-01-01", isDirectory: false },
    ]);

    const { hasAppFiles } = await import("./seed-app");
    const result = await hasAppFiles("app-5");

    expect(result).toBe(true);
  });
});
