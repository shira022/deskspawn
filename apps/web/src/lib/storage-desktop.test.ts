/**
 * Tests for the desktop storage adapter (storage-desktop.ts).
 *
 * The adapter wraps Rust IPC; here we mock @tauri-apps/api/core's invoke and
 * verify the mapping / fallback logic (project meta snake_case → camelCase,
 * missing-file → null, batch reads).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Tauri invoke before importing the module under test.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// The module reads `window.__DESKSPAWN_DESKTOP__` — provide a node-safe shim.
const windowShim = {} as { __DESKSPAWN_DESKTOP__?: boolean };
(globalThis as unknown as { window?: unknown }).window = windowShim;

import {
  listProjectsDesktop,
  getProjectDesktop,
  saveProjectDesktop,
  deleteProjectDesktop,
  listProjectFilesDesktop,
  readProjectFileDesktop,
  readProjectFilesDesktop,
  writeProjectFileDesktop,
  writeProjectFilesDesktop,
  isDesktopStorageActive,
} from "./storage-desktop";

beforeEach(() => {
  invokeMock.mockReset();
  // Default: not in a desktop runtime (no window flag) unless a test sets it.
  delete windowShim.__DESKSPAWN_DESKTOP__;
});

describe("storage-desktop", () => {
  it("maps Rust ProjectMeta (snake_case) to StoredProject (camelCase)", async () => {
    invokeMock.mockResolvedValue([
      {
        id: "proj-1",
        name: "My App",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ]);
    const projects = await listProjectsDesktop();
    expect(projects).toEqual([
      {
        id: "proj-1",
        name: "My App",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("list_projects", undefined);
  });

  it("getProjectDesktop finds by id", async () => {
    invokeMock.mockResolvedValue([
      { id: "a", name: "A", created_at: "t", updated_at: "t" },
      { id: "b", name: "B", created_at: "t", updated_at: "t" },
    ]);
    const b = await getProjectDesktop("b");
    expect(b?.id).toBe("b");
    expect(b?.name).toBe("B");

    const missing = await getProjectDesktop("zzz");
    expect(missing).toBeNull();
  });

  it("saveProjectDesktop returns the backend-assigned id", async () => {
    // First call: list_projects → empty (missing)
    invokeMock.mockResolvedValueOnce([]);
    // Second call: create_project → returns created meta with backend id
    invokeMock.mockResolvedValueOnce({
      id: "proj-backend-1",
      name: "New App",
      created_at: "t",
      updated_at: "t",
    });

    const id = await saveProjectDesktop({ id: "caller-id", name: "New App", createdAt: "t", updatedAt: "t" });

    expect(id).toBe("proj-backend-1");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_projects", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "create_project", { name: "New App" });
  });

  it("saveProjectDesktop returns existing project id without creating", async () => {
    invokeMock.mockResolvedValueOnce([
      { id: "proj-exists", name: "Existing", created_at: "t", updated_at: "t" },
    ]);
    const id = await saveProjectDesktop({ id: "proj-exists", name: "Existing", createdAt: "t", updatedAt: "t" });
    expect(id).toBe("proj-exists");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("deleteProjectDesktop invokes Rust delete", async () => {
    invokeMock.mockResolvedValue(undefined);
    await deleteProjectDesktop("proj-1");
    expect(invokeMock).toHaveBeenCalledWith("delete_project", { projectId: "proj-1" });
  });

  it("listProjectFilesDesktop returns relative paths", async () => {
    invokeMock.mockResolvedValue(["package.json", "src/App.tsx"]);
    const files = await listProjectFilesDesktop("proj-1");
    expect(files).toEqual(["package.json", "src/App.tsx"]);
    expect(invokeMock).toHaveBeenCalledWith("list_project_files", { projectId: "proj-1" });
  });

  it("readProjectFileDesktop returns null on missing file", async () => {
    invokeMock.mockRejectedValue(new Error("File not found"));
    const content = await readProjectFileDesktop("proj-1", "nope.ts");
    expect(content).toBeNull();
  });

  it("readProjectFilesDesktop batch reads with nulls for missing", async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { path: string }) => {
      if (args.path === "exists.ts") return "hello";
      throw new Error("File not found");
    });
    const result = await readProjectFilesDesktop("proj-1", ["exists.ts", "missing.ts"]);
    expect(result).toEqual({ "exists.ts": "hello", "missing.ts": null });
  });

  it("writeProjectFileDesktop passes through", async () => {
    invokeMock.mockResolvedValue(undefined);
    await writeProjectFileDesktop("proj-1", "src/a.ts", "code");
    expect(invokeMock).toHaveBeenCalledWith("write_project_file", {
      projectId: "proj-1",
      path: "src/a.ts",
      content: "code",
    });
  });

  it("writeProjectFilesDesktop converts record to entries array", async () => {
    invokeMock.mockResolvedValue(2);
    const n = await writeProjectFilesDesktop("proj-1", {
      "a.ts": "1",
      "b.ts": "2",
    });
    expect(n).toBe(2);
    expect(invokeMock).toHaveBeenCalledWith("write_project_files", {
      projectId: "proj-1",
      files: [
        ["a.ts", "1"],
        ["b.ts", "2"],
      ],
    });
  });

  it("isDesktopStorageActive reflects the __DESKSPAWN_DESKTOP__ flag", () => {
    expect(isDesktopStorageActive()).toBe(false);
    (windowShim as { __DESKSPAWN_DESKTOP__?: boolean }).__DESKSPAWN_DESKTOP__ = true;
    expect(isDesktopStorageActive()).toBe(true);
  });

  it("getChatHistoryDesktop maps Rust rows to engine shape", async () => {
    invokeMock.mockResolvedValue([
      { id: 1, role: "user", content: "hello", created_at: "2026-08-05T00:00:00Z" },
      { id: 2, role: "assistant", content: "hi", created_at: "2026-08-05T00:00:01Z" },
    ]);
    const { getChatHistoryDesktop } = await import("./storage-desktop");
    const history = await getChatHistoryDesktop("proj-1");
    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("get_chat_history", { projectId: "proj-1" });
  });

  it("getChatHistoryDesktop returns [] on failure", async () => {
    invokeMock.mockRejectedValue(new Error("db closed"));
    const { getChatHistoryDesktop } = await import("./storage-desktop");
    const history = await getChatHistoryDesktop("proj-1");
    expect(history).toEqual([]);
  });

  it("saveChatHistoryDesktop appends only the last message", async () => {
    invokeMock.mockResolvedValue(42);
    const { saveChatHistoryDesktop } = await import("./storage-desktop");
    await saveChatHistoryDesktop("proj-1", [
      { role: "user", content: "old" },
      { role: "assistant", content: "new" },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("append_chat_message", {
      projectId: "proj-1",
      role: "assistant",
      content: "new",
    });
  });
});
