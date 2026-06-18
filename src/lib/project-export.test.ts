import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock JSZip ──────────────────────────────────────────────────────────────
// JSZip is used with `new JSZip()` in project-export.ts and also as
// `JSZip.loadAsync()`. The factory stores a ref to the loadAsync mock
// on a shared object so tests can configure it.
//
// Note: vi.fn() can't be used as the constructor because `new vi.fn()`
// returns the mock itself, not the implementation return value.
// Instead we use a plain function and track calls manually.

let mockZipInstance: Record<string, unknown>;
const mockState = {
  loadAsync: vi.fn(),
  /** Track which paths were passed to zip.file(path, content) */
  filePaths: [] as string[],
};

vi.mock("jszip", () => {
  const loadAsync = vi.fn();
  function JSZipMock(this: any) {
    const filesStore: Record<string, { content: string; dir: boolean }> = {};
    const fileCalls: string[] = [];
    const instance = {
      file: (path: string, content?: string) => {
        fileCalls.push(path);
        if (content !== undefined) {
          filesStore[path] = { content, dir: false };
        }
        return instance;
      },
      generateAsync: vi.fn((_options: { type: string }) => {
        return Promise.resolve(new Blob(["mock-zip-content"], { type: "application/zip" }));
      }),
      files: filesStore,
    };
    mockZipInstance = instance;
    mockState.filePaths = fileCalls;
    return instance;
  }
  JSZipMock.loadAsync = loadAsync;
  mockState.loadAsync = loadAsync;
  return { default: JSZipMock };
});

// ─── Mock storage-opfs ───────────────────────────────────────────────────────

vi.mock("@/lib/storage-opfs", () => ({
  listProjectFiles: vi.fn(),
  readProjectFile: vi.fn(),
  writeProjectFiles: vi.fn(),
}));

// ─── Mock storage ────────────────────────────────────────────────────────────

vi.mock("@/lib/storage", () => ({
  getProject: vi.fn(),
}));

// ─── Import mocks for use in tests ───────────────────────────────────────────

import * as storageOpfs from "@/lib/storage-opfs";
import * as storage from "@/lib/storage";

describe("exportProjectAsZip", () => {
  const mockAnchor = {
    href: "",
    download: "",
    click: vi.fn(),
  };
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(storageOpfs.listProjectFiles).mockReset();
    vi.mocked(storageOpfs.readProjectFile).mockReset();
    vi.mocked(storage.getProject).mockReset();

    vi.stubGlobal("document", {
      createElement: vi.fn(() => mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });
    vi.stubGlobal("URL", URL);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-download-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    mockAnchor.click.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTimeoutSpy.mockRestore();
  });

  it("reads project, creates zip, and triggers download", async () => {
    const projectId = "proj-123";
    const projectName = "My Project";

    vi.mocked(storage.getProject).mockResolvedValue({
      id: projectId,
      name: projectName,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
      { path: "src/index.html", size: 100, lastModified: "2024-01-01", isDirectory: false },
      { path: "src/app.ts", size: 200, lastModified: "2024-01-01", isDirectory: false },
    ]);
    vi.mocked(storageOpfs.readProjectFile).mockImplementation(async (_pid: string, path: string) => {
      if (path === "src/index.html") return "<h1>Hello</h1>";
      if (path === "src/app.ts") return "console.log('hi')";
      return null;
    });

    const { exportProjectAsZip } = await import("./project-export");
    await exportProjectAsZip(projectId, projectName);

    expect(mockState.filePaths).toContain("deskspawn.json");
    expect(mockState.filePaths).toContain("src/index.html");
    expect(mockState.filePaths).toContain("src/app.ts");
    expect((mockZipInstance as any).generateAsync).toHaveBeenCalledWith({ type: "blob" });
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(mockAnchor.download).toBe("My_Project.deskspawn.zip");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-download-url");
  });

  it("uses project name from storage when available", async () => {
    const projectId = "proj-456";
    vi.mocked(storage.getProject).mockResolvedValue({
      id: projectId,
      name: "Stored Project Name",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
      { path: "src/main.ts", size: 50, lastModified: "2024-01-01", isDirectory: false },
    ]);
    vi.mocked(storageOpfs.readProjectFile).mockResolvedValue("content");

    const { exportProjectAsZip } = await import("./project-export");
    await exportProjectAsZip(projectId, "Fallback Name");

    // Filename is always based on the projectName parameter, not metadata
    expect(mockAnchor.download).toBe("Fallback_Name.deskspawn.zip");
    // Storage name is used in metadata inside the zip
    expect(mockState.filePaths).toContain("deskspawn.json");
  });

  it("throws when no source files are found", async () => {
    const projectId = "proj-empty";
    vi.mocked(storage.getProject).mockResolvedValue(null);
    vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([]);

    const { exportProjectAsZip } = await import("./project-export");
    await expect(exportProjectAsZip(projectId, "Empty")).rejects.toThrow(
      "No source files found to export",
    );
  });

  it("skips excluded patterns (node_modules, .git, dist, etc.)", async () => {
    const projectId = "proj-excluded";
    vi.mocked(storage.getProject).mockResolvedValue(null);
    vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
      { path: "src/index.html", size: 100, lastModified: "2024-01-01", isDirectory: false },
      { path: "node_modules/express/index.js", size: 5000, lastModified: "2024-01-01", isDirectory: false },
      { path: ".git/config", size: 200, lastModified: "2024-01-01", isDirectory: false },
      { path: "dist/bundle.js", size: 1000, lastModified: "2024-01-01", isDirectory: false },
      { path: ".deskspawn/settings.json", size: 50, lastModified: "2024-01-01", isDirectory: false },
    ]);
    vi.mocked(storageOpfs.readProjectFile).mockImplementation(async (_pid: string, path: string) => {
      if (path === "src/index.html") return "<h1>Hello</h1>";
      if (path === "node_modules/express/index.js") return "// express";
      return "ignored";
    });

    const { exportProjectAsZip } = await import("./project-export");
    await exportProjectAsZip(projectId, "Excluded");

    expect(mockState.filePaths).toContain("src/index.html");
    expect(mockState.filePaths).not.toContain("node_modules/express/index.js");
    expect(mockState.filePaths).not.toContain(".git/config");
    expect(mockState.filePaths).not.toContain("dist/bundle.js");
    expect(mockState.filePaths).not.toContain(".deskspawn/settings.json");
  });

  it("skips directories", async () => {
    const projectId = "proj-dirs";
    vi.mocked(storage.getProject).mockResolvedValue(null);
    vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
      { path: "src", size: 0, lastModified: "2024-01-01", isDirectory: true },
      { path: "src/main.ts", size: 100, lastModified: "2024-01-01", isDirectory: false },
    ]);
    vi.mocked(storageOpfs.readProjectFile).mockResolvedValue("content");

    const { exportProjectAsZip } = await import("./project-export");
    await exportProjectAsZip(projectId, "Dirs");

    expect(mockState.filePaths).not.toContain("src");
    expect(mockState.filePaths).toContain("src/main.ts");
  });
});

describe("importProjectFromZip", () => {
  beforeEach(() => {
    vi.mocked(storageOpfs.writeProjectFiles).mockReset().mockResolvedValue(undefined);
    mockState.loadAsync.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createMockFile(name: string): File {
    const blob = new Blob(["mock-zip"], { type: "application/zip" });
    const file = new File([blob], name, { type: "application/zip" });
    vi.spyOn(file, "arrayBuffer").mockResolvedValue(new ArrayBuffer(0));
    return file;
  }

  it("reads zip metadata and writes files to OPFS", async () => {
    const newProjectId = "new-proj-abc";
    const file = createMockFile("MyApp.deskspawn.zip");

    const mockZipLoaded = {
      file: vi.fn((path: string) => {
        if (path === "deskspawn.json") {
          return {
            async: vi.fn(() =>
              Promise.resolve(JSON.stringify({ name: "MyApp", version: "1.0", exportedAt: "2024-01-01" })),
            ),
            dir: false,
          };
        }
        return null;
      }),
      files: {
        "deskspawn.json": { dir: false },
        "src/index.html": { dir: false },
        "src/style.css": { dir: false },
      },
    };
    const asyncMock = vi.fn((_type: string) => Promise.resolve("file content"));
    (mockZipLoaded.files["src/index.html"] as any) = { dir: false, async: asyncMock };
    (mockZipLoaded.files["src/style.css"] as any) = { dir: false, async: asyncMock };

    mockState.loadAsync.mockResolvedValue(mockZipLoaded);

    const { importProjectFromZip } = await import("./project-export");
    const result = await importProjectFromZip(file, newProjectId);

    expect(result.projectId).toBe(newProjectId);
    expect(result.projectName).toBe("MyApp");
    expect(result.filesImported).toBe(2);

    expect(storageOpfs.writeProjectFiles).toHaveBeenCalledWith(newProjectId, [
      { path: "src/index.html", content: "file content" },
      { path: "src/style.css", content: "file content" },
    ]);
  });

  it("uses filename-derived name when deskspawn.json is missing", async () => {
    const newProjectId = "new-proj-xyz";
    const file = createMockFile("MyProject.deskspawn.zip");

    const mockZipLoaded = {
      file: vi.fn(() => null),
      files: {
        "src/main.ts": { dir: false },
      },
    };
    const asyncMock = vi.fn(() => Promise.resolve("console.log('hi')"));
    (mockZipLoaded.files["src/main.ts"] as any) = { dir: false, async: asyncMock };

    mockState.loadAsync.mockResolvedValue(mockZipLoaded);

    const { importProjectFromZip } = await import("./project-export");
    const result = await importProjectFromZip(file, newProjectId);

    expect(result.projectName).toBe("MyProject");
    expect(result.filesImported).toBe(1);
  });

  it("throws when no source files are in the archive", async () => {
    const newProjectId = "new-empty";
    const file = createMockFile("Empty.deskspawn.zip");

    const mockZipLoaded = {
      file: vi.fn(() => null),
      files: {},
    };

    mockState.loadAsync.mockResolvedValue(mockZipLoaded);

    const { importProjectFromZip } = await import("./project-export");
    await expect(importProjectFromZip(file, newProjectId)).rejects.toThrow(
      "No source files found in the archive",
    );
  });

  it("skips deskspawn.json and excluded patterns during import", async () => {
    const newProjectId = "new-skip";
    const file = createMockFile("SkipTest.deskspawn.zip");

    const mockZipLoaded = {
      file: vi.fn((path: string) => {
        if (path === "deskspawn.json") {
          return {
            async: vi.fn(() => Promise.resolve(JSON.stringify({ name: "SkipTest", version: "1.0", exportedAt: "" }))),
            dir: false,
          };
        }
        return null;
      }),
      files: {
        "deskspawn.json": { dir: false },
        "src/app.ts": { dir: false },
        "node_modules/pkg/index.js": { dir: false },
      },
    };
    const appAsync = vi.fn(() => Promise.resolve("console.log('app')"));
    (mockZipLoaded.files["src/app.ts"] as any) = { dir: false, async: appAsync };
    const nodeAsync = vi.fn(() => Promise.resolve("// pkg"));
    (mockZipLoaded.files["node_modules/pkg/index.js"] as any) = { dir: false, async: nodeAsync };

    mockState.loadAsync.mockResolvedValue(mockZipLoaded);

    const { importProjectFromZip } = await import("./project-export");
    const result = await importProjectFromZip(file, newProjectId);

    expect(result.filesImported).toBe(1);
    expect(storageOpfs.writeProjectFiles).toHaveBeenCalledWith(newProjectId, [
      { path: "src/app.ts", content: "console.log('app')" },
    ]);
  });
});
