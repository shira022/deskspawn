/**
 * Tests for file sync utilities — OPFS → WebContainer file synchronization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock @/lib/storage-opfs ───────────────────────────────────────────────────
// Must be fully inline in the factory — vi.mock is hoisted, so external
// variables aren't initialized yet when the factory runs.

vi.mock("@/lib/storage-opfs", () => ({
  readProjectFile: vi.fn(),
  listProjectFiles: vi.fn(),
}));

import {
  mountAllFiles,
  syncChangedFiles,
  detectPackageJsonChange,
} from "./file-sync";
import * as storageOpfs from "@/lib/storage-opfs";

// ─── Mock WebContainer ────────────────────────────────────────────────────────

function createMockContainer(fsFiles: Map<string, string> = new Map()) {
  const mountCalls: any[] = [];
  const writeLog: Array<{ path: string; content: string }> = [];
  const mkdirLog: string[] = [];

  return {
    mountCalls,
    writeLog,
    mkdirLog,
    container: {
      mount: vi.fn(async (tree: any) => {
        mountCalls.push(tree);
      }),
      fs: {
        readFile: vi.fn(async (path: string, _encoding?: string) => {
          // Normalize path for lookup
          const normalized = path.startsWith("/") ? path : "/" + path;
          const content = fsFiles.get(normalized);
          if (content !== undefined) return content;
          throw new Error(`File not found: ${path}`);
        }),
        writeFile: vi.fn(async (path: string, content: string) => {
          writeLog.push({ path, content });
          fsFiles.set(path, content);
        }),
        mkdir: vi.fn(async (_path: string, _options?: any) => {
          mkdirLog.push(_path);
        }),
      },
    } as any,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createFileInfo(path: string, isDir = false) {
  return { path, size: 100, lastModified: "2024-01-01", isDirectory: isDir };
}

describe("file-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storageOpfs.readProjectFile).mockReset();
    vi.mocked(storageOpfs.listProjectFiles).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── mountAllFiles ──────────────────────────────────────────────────────

  describe("mountAllFiles", () => {
    it("should read all files from storage and mount to WebContainer", async () => {
      const { container, mountCalls } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
        createFileInfo("src/index.ts"),
        createFileInfo("src/components/App.tsx"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          const files: Record<string, string> = {
            "package.json": '{"name":"test"}',
            "src/index.ts": "export const x = 1;",
            "src/components/App.tsx": "export const App = () => null;",
          };
          return files[path] ?? null;
        }
      );

      await mountAllFiles(container, "proj-1");

      expect(vi.mocked(storageOpfs.listProjectFiles)).toHaveBeenCalledWith("proj-1");
      expect(vi.mocked(storageOpfs.readProjectFile)).toHaveBeenCalledTimes(3);
      expect(container.mount).toHaveBeenCalledTimes(1);

      // Verify the tree structure
      const tree = mountCalls[0];
      expect(tree).toBeDefined();
      expect(tree["package.json"]).toBeDefined();
      expect(tree["package.json"].file.contents).toBe('{"name":"test"}');
      expect(tree["src"]).toBeDefined();
      expect(tree["src"].directory["index.ts"].file.contents).toBe(
        "export const x = 1;"
      );
      expect(
        tree["src"].directory["components"].directory["App.tsx"].file.contents
      ).toBe("export const App = () => null;");
    });

    it("should exclude node_modules files", async () => {
      const { container, mountCalls } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
        createFileInfo("node_modules/react/index.js"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          if (path === "package.json") return "{}";
          return "some content";
        }
      );

      await mountAllFiles(container, "proj-1");

      expect(vi.mocked(storageOpfs.readProjectFile)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(storageOpfs.readProjectFile)).toHaveBeenCalledWith(
        "proj-1",
        "package.json"
      );

      const tree = mountCalls[0];
      expect(tree["node_modules"]).toBeUndefined();
    });

    it("should exclude package-lock.json", async () => {
      const { container, mountCalls } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
        createFileInfo("package-lock.json"),
        createFileInfo("src/index.ts"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          if (path === "package.json") return "{}";
          if (path === "src/index.ts") return "content";
          return "lock content";
        }
      );

      await mountAllFiles(container, "proj-1");

      // package-lock.json should be excluded
      expect(vi.mocked(storageOpfs.readProjectFile)).toHaveBeenCalledTimes(2);
      const tree = mountCalls[0];
      expect(tree["package-lock.json"]).toBeUndefined();
    });

    it("should skip directories", async () => {
      const { container, mountCalls } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("src", true), // directory
        createFileInfo("src/index.ts"),
        createFileInfo("package.json"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          if (path === "package.json") return "{}";
          if (path === "src/index.ts") return "content";
          return null;
        }
      );

      await mountAllFiles(container, "proj-1");

      // Should not call readProjectFile for directory
      expect(vi.mocked(storageOpfs.readProjectFile)).toHaveBeenCalledTimes(2);
      const tree = mountCalls[0];
      expect(tree["package.json"]).toBeDefined();
      expect(tree["src"].directory["index.ts"]).toBeDefined();
    });

    it("should skip files where readProjectFile returns null", async () => {
      const { container, mountCalls } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
        createFileInfo("missing.ts"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          if (path === "package.json") return "{}";
          return null; // missing.ts returns null
        }
      );

      await mountAllFiles(container, "proj-1");

      expect(vi.mocked(storageOpfs.readProjectFile)).toHaveBeenCalledTimes(2);
      const tree = mountCalls[0];
      expect(tree["package.json"]).toBeDefined();
      expect(tree["missing.ts"]).toBeUndefined();
    });

    it("should handle empty project (no files)", async () => {
      const { container } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([]);

      await mountAllFiles(container, "proj-1");

      expect(vi.mocked(storageOpfs.readProjectFile)).not.toHaveBeenCalled();
      expect(container.mount).toHaveBeenCalledWith({});
    });
  });

  // ── detectPackageJsonChange ────────────────────────────────────────────

  describe("detectPackageJsonChange", () => {
    it("should return false when both container and OPFS have same deps", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set(
        "/package.json",
        '{"dependencies":{"react":"^18.0.0"}}'
      );
      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(
        '{"dependencies":{"react":"^18.0.0"}}'
      );

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(false);
      expect(vi.mocked(storageOpfs.readProjectFile)).toHaveBeenCalledWith(
        "proj-1",
        "package.json"
      );
    });

    it("should return true when dependencies differ", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set(
        "/package.json",
        '{"dependencies":{"react":"^17.0.0"}}'
      );
      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(
        '{"dependencies":{"react":"^18.0.0"}}'
      );

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(true);
    });

    it("should return true when devDependencies differ", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set(
        "/package.json",
        '{"devDependencies":{"vite":"^4.0.0"}}'
      );
      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(
        '{"devDependencies":{"vite":"^5.0.0"}}'
      );

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(true);
    });

    it("should return true when a new dependency is added", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set(
        "/package.json",
        '{"dependencies":{"react":"^18.0.0"}}'
      );
      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(
        '{"dependencies":{"react":"^18.0.0","lodash":"^4.0.0"}}'
      );

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(true);
    });

    it("should return true when container has no package.json but OPFS does", async () => {
      const { container } = createMockContainer(); // no package.json in container

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(
        '{"dependencies":{"react":"^18.0.0"}}'
      );

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(true);
    });

    it("should return true when OPFS has no package.json but container does", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set(
        "/package.json",
        '{"dependencies":{"react":"^18.0.0"}}'
      );
      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(null);

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(true);
    });

    it("should return false when both are null", async () => {
      const { container } = createMockContainer();

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(null);

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(false);
    });

    it("should handle unparseable JSON with string comparison fallback", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set("/package.json", "not valid json");
      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue("not valid json");

      const changed = await detectPackageJsonChange(container, "proj-1");

      // Same invalid string → no change
      expect(changed).toBe(false);
    });

    it("should detect change when unparseable JSON differs", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set("/package.json", "not valid json");
      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue("different invalid json");

      const changed = await detectPackageJsonChange(container, "proj-1");

      expect(changed).toBe(true);
    });
  });

  // ── syncChangedFiles ──────────────────────────────────────────────────

  describe("syncChangedFiles", () => {
    it("should sync files when content differs from container", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set("/src/index.ts", "old content");
      fsFiles.set("/package.json", '{"dependencies":{"react":"^17.0.0"}}');

      const { container, writeLog } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
        createFileInfo("src/index.ts"),
      ]);

      let _callIndex = 0;
      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          _callIndex++;
          if (path === "package.json")
            return '{"dependencies":{"react":"^18.0.0"}}';
          if (path === "src/index.ts") return "new content";
          return null;
        }
      );

      const result = await syncChangedFiles(container, "proj-1");

      expect(result.filesSynced).toBe(2);
      expect(result.installTriggered).toBe(true);
      expect(result.errors).toEqual([]);

      // Verify both files were written
      const writtenPaths = writeLog.map((w) => w.path);
      expect(writtenPaths).toContain("/package.json");
      expect(writtenPaths).toContain("/src/index.ts");
    });

    it("should skip files that have not changed", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set("/src/index.ts", "same content");

      const { container, writeLog } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("src/index.ts"),
        createFileInfo("src/app.ts"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          if (path === "src/index.ts") return "same content"; // unchanged
          if (path === "src/app.ts") return "new app content"; // new file
          return null;
        }
      );

      const result = await syncChangedFiles(container, "proj-1");

      // Only the new file should be synced
      expect(result.filesSynced).toBe(1);
      const writtenPaths = writeLog.map((w) => w.path);
      expect(writtenPaths).toContain("/src/app.ts");
      expect(writtenPaths).not.toContain("/src/index.ts");
    });

    it("should write a touch file after syncing", async () => {
      const { container, writeLog } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("src/index.ts"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue("new content");

      const result = await syncChangedFiles(container, "proj-1");

      expect(result.filesSynced).toBe(1);

      // Check touch file was written
      const touchWrite = writeLog.find(
        (w) => w.path === "/.deskspawn-sync-trigger"
      );
      expect(touchWrite).toBeDefined();
      const touchData = JSON.parse(touchWrite!.content);
      expect(touchData.filesSynced).toBe(1);
    });

    it("should NOT write touch file when no files synced", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set("/src/index.ts", "same content");

      const { container, writeLog } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("src/index.ts"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue("same content");

      const result = await syncChangedFiles(container, "proj-1");

      expect(result.filesSynced).toBe(0);

      const touchWrite = writeLog.find(
        (w) => w.path === "/.deskspawn-sync-trigger"
      );
      expect(touchWrite).toBeUndefined();
    });

    it("should handle empty project", async () => {
      const { container } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([]);

      const result = await syncChangedFiles(container, "proj-1");

      expect(result.filesSynced).toBe(0);
      expect(result.installTriggered).toBe(false);
      expect(result.errors).toEqual([]);
    });

    it("should exclude node_modules and lock files", async () => {
      const { container, writeLog } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
        createFileInfo("package-lock.json"),
        createFileInfo("node_modules/react/index.js"),
        createFileInfo("src/index.ts"),
        createFileInfo("dist/bundle.js"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          if (path === "package.json") return "{}";
          if (path === "src/index.ts") return "content";
          return "excluded content";
        }
      );

      const result = await syncChangedFiles(container, "proj-1");

      expect(result.filesSynced).toBe(2);
      const writtenPaths = writeLog.map((w) => w.path);
      expect(writtenPaths).toContain("/package.json");
      expect(writtenPaths).toContain("/src/index.ts");
      expect(writtenPaths).not.toContain("/package-lock.json");
      expect(writtenPaths).not.toContain("/node_modules/react/index.js");
      expect(writtenPaths).not.toContain("/dist/bundle.js");
    });

    it("should collect errors for files that fail to sync", async () => {
      const { container } = createMockContainer();

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
        createFileInfo("src/index.ts"),
      ]);

      let _callCount = 0;
      vi.mocked(storageOpfs.readProjectFile).mockImplementation(
        async (_pid: string, path: string) => {
          _callCount++;
          if (path === "package.json") return "{}";
          if (path === "src/index.ts") throw new Error("OPFS read error");
          return null;
        }
      );

      const result = await syncChangedFiles(container, "proj-1");

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("OPFS read error");
      // package.json should still have been synced
      expect(result.filesSynced).toBe(1);
    });

    it("should report package.json changes in installTriggered", async () => {
      const fsFiles = new Map<string, string>();
      fsFiles.set("/package.json", '{"dependencies":{"react":"^17.0.0"}}');

      const { container } = createMockContainer(fsFiles);

      vi.mocked(storageOpfs.listProjectFiles).mockResolvedValue([
        createFileInfo("package.json"),
      ]);

      vi.mocked(storageOpfs.readProjectFile).mockResolvedValue(
        '{"dependencies":{"react":"^18.0.0","lodash":"^4.0.0"}}'
      );

      const result = await syncChangedFiles(container, "proj-1");

      expect(result.installTriggered).toBe(true);
    });
  });
});
