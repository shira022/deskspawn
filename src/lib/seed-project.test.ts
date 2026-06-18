import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock storage-opfs ───────────────────────────────────────────────────────

const mockStorageOpfs = {
  listProjectFiles: vi.fn(),
  writeProjectFile: vi.fn(),
  projectFileExists: vi.fn(),
};

vi.mock("./storage-opfs", () => mockStorageOpfs);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(data),
  };
}

describe("seedProjectFromFilesystem", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockStorageOpfs.writeProjectFile.mockReset().mockResolvedValue(undefined);
    mockStorageOpfs.projectFileExists.mockReset().mockResolvedValue(false);
    mockStorageOpfs.listProjectFiles.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches project files and writes them to OPFS", async () => {
    const projectId = "test-proj-1";
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Hello</h1>",
          "src/app.ts": "console.log('hi')",
        },
        projectId,
      }),
    );

    const { seedProjectFromFilesystem } = await import("./seed-project");
    const result = await seedProjectFromFilesystem(projectId);

    expect(result).toEqual({ seeded: 2, skipped: 0 });
    expect(mockFetch).toHaveBeenCalledWith(`/api/project-files/${projectId}`);
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledTimes(2);
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledWith(
      projectId,
      "src/index.html",
      "<h1>Hello</h1>",
    );
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledWith(
      projectId,
      "src/app.ts",
      "console.log('hi')",
    );
  });

  it("skips node_modules and package-lock.json files", async () => {
    const projectId = "test-proj-2";
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Hello</h1>",
          "node_modules/express/index.js": "// express",
          "package-lock.json": "{}",
        },
        projectId,
      }),
    );

    const { seedProjectFromFilesystem } = await import("./seed-project");
    const result = await seedProjectFromFilesystem(projectId);

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledTimes(1);
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledWith(
      projectId,
      "src/index.html",
      "<h1>Hello</h1>",
    );
  });

  it("handles 404 response and returns zero counts", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(null, false));

    const { seedProjectFromFilesystem } = await import("./seed-project");
    const result = await seedProjectFromFilesystem("missing-proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeProjectFile).not.toHaveBeenCalled();
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { seedProjectFromFilesystem } = await import("./seed-project");
    const result = await seedProjectFromFilesystem("error-proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeProjectFile).not.toHaveBeenCalled();
  });

  it("skips existing files when force is not set", async () => {
    const projectId = "test-proj-3";
    mockStorageOpfs.projectFileExists.mockResolvedValue(true);
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Hello</h1>",
          "src/app.ts": "console.log('hi')",
        },
        projectId,
      }),
    );

    const { seedProjectFromFilesystem } = await import("./seed-project");
    const result = await seedProjectFromFilesystem(projectId);

    expect(result).toEqual({ seeded: 0, skipped: 2 });
    expect(mockStorageOpfs.writeProjectFile).not.toHaveBeenCalled();
    expect(mockStorageOpfs.projectFileExists).toHaveBeenCalledTimes(2);
  });

  it("overwrites existing files when force=true", async () => {
    const projectId = "test-proj-4";
    mockStorageOpfs.projectFileExists.mockResolvedValue(true);
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Forced</h1>",
        },
        projectId,
      }),
    );

    const { seedProjectFromFilesystem } = await import("./seed-project");
    const result = await seedProjectFromFilesystem(projectId, { force: true });

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    // Should NOT check if files exist when force=true
    expect(mockStorageOpfs.projectFileExists).not.toHaveBeenCalled();
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledTimes(1);
  });

  it("continues writing other files when one write fails", async () => {
    const projectId = "test-proj-5";
    mockStorageOpfs.writeProjectFile
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValueOnce(undefined);

    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/a.ts": "// a",
          "src/b.ts": "// b",
        },
        projectId,
      }),
    );

    const { seedProjectFromFilesystem } = await import("./seed-project");
    const result = await seedProjectFromFilesystem(projectId);

    // First write failed, second succeeded
    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledTimes(2);
  });
});

describe("seedProjectFromWorkspace", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    mockStorageOpfs.writeProjectFile.mockReset().mockResolvedValue(undefined);
    mockStorageOpfs.projectFileExists.mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches workspace files and writes them to OPFS", async () => {
    const projectId = "workspace-proj";
    mockFetch.mockResolvedValueOnce(
      createJsonResponse({
        files: {
          "src/index.html": "<h1>Workspace</h1>",
          "src/style.css": "body { color: red; }",
        },
        projectId,
      }),
    );

    const { seedProjectFromWorkspace } = await import("./seed-project");
    const result = await seedProjectFromWorkspace(projectId);

    expect(result).toEqual({ seeded: 2, skipped: 0 });
    expect(mockFetch).toHaveBeenCalledWith("/api/project-files/_workspace_?type=workspace");
    expect(mockStorageOpfs.writeProjectFile).toHaveBeenCalledTimes(2);
  });

  it("handles workspace fetch failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse(null, false));

    const { seedProjectFromWorkspace } = await import("./seed-project");
    const result = await seedProjectFromWorkspace("proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeProjectFile).not.toHaveBeenCalled();
  });

  it("handles workspace fetch network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));

    const { seedProjectFromWorkspace } = await import("./seed-project");
    const result = await seedProjectFromWorkspace("proj");

    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockStorageOpfs.writeProjectFile).not.toHaveBeenCalled();
  });
});

describe("hasProjectFiles", () => {
  beforeEach(() => {
    mockStorageOpfs.listProjectFiles.mockReset();
  });

  it("returns true when source files are found", async () => {
    mockStorageOpfs.listProjectFiles.mockResolvedValue([
      { path: "src/App.tsx", size: 100, lastModified: "2024-01-01", isDirectory: false },
    ]);

    const { hasProjectFiles } = await import("./seed-project");
    const result = await hasProjectFiles("proj-1");

    expect(result).toBe(true);
  });

  it("returns false when only non-source files exist", async () => {
    mockStorageOpfs.listProjectFiles.mockResolvedValue([
      { path: "package-lock.json", size: 500, lastModified: "2024-01-01", isDirectory: false },
      { path: "node_modules/express/index.js", size: 1000, lastModified: "2024-01-01", isDirectory: false },
    ]);

    const { hasProjectFiles } = await import("./seed-project");
    const result = await hasProjectFiles("proj-2");

    expect(result).toBe(false);
  });

  it("returns false when no files exist", async () => {
    mockStorageOpfs.listProjectFiles.mockResolvedValue([]);

    const { hasProjectFiles } = await import("./seed-project");
    const result = await hasProjectFiles("proj-3");

    expect(result).toBe(false);
  });

  it("returns false when listProjectFiles throws an error", async () => {
    mockStorageOpfs.listProjectFiles.mockRejectedValue(new Error("OPFS error"));

    const { hasProjectFiles } = await import("./seed-project");
    const result = await hasProjectFiles("proj-4");

    expect(result).toBe(false);
  });

  it("includes index.html and public/ files as source files", async () => {
    mockStorageOpfs.listProjectFiles.mockResolvedValue([
      { path: "index.html", size: 100, lastModified: "2024-01-01", isDirectory: false },
      { path: "public/favicon.ico", size: 1024, lastModified: "2024-01-01", isDirectory: false },
    ]);

    const { hasProjectFiles } = await import("./seed-project");
    const result = await hasProjectFiles("proj-5");

    expect(result).toBe(true);
  });
});
