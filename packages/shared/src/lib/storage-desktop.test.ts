/**
 * Tests for the desktop storage adapter (storage-desktop.ts).
 *
 * The adapter wraps Rust IPC; here we mock @tauri-apps/api/core's invoke and
 * verify the mapping / fallback logic (app meta snake_case → camelCase,
 * missing-file → null, batch reads).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Tauri invoke before importing the module under test.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  listAppsDesktop,
  getAppDesktop,
  saveAppDesktop,
  deleteAppDesktop,
  listAppFilesDesktop,
  readAppFileDesktop,
  readAppFilesDesktop,
  writeAppFileDesktop,
  writeAppFilesDesktop,
} from "./storage-desktop";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("storage-desktop", () => {
  it("maps Rust AppMeta (snake_case) to StoredApp (camelCase)", async () => {
    invokeMock.mockResolvedValue([
      {
        id: "app-1",
        name: "My App",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ]);
    const apps = await listAppsDesktop();
    expect(apps).toEqual([
      {
        id: "app-1",
        name: "My App",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("list_apps", undefined);
  });

  it("getAppDesktop finds by id", async () => {
    invokeMock.mockResolvedValue([
      { id: "a", name: "A", created_at: "t", updated_at: "t" },
      { id: "b", name: "B", created_at: "t", updated_at: "t" },
    ]);
    const b = await getAppDesktop("b");
    expect(b?.id).toBe("b");
    expect(b?.name).toBe("B");

    const missing = await getAppDesktop("zzz");
    expect(missing).toBeNull();
  });

  it("saveAppDesktop returns the backend-assigned id", async () => {
    // First call: list_apps → empty (missing)
    invokeMock.mockResolvedValueOnce([]);
    // Second call: create_app → returns created meta with backend id
    invokeMock.mockResolvedValueOnce({
      id: "app-backend-1",
      name: "New App",
      created_at: "t",
      updated_at: "t",
    });

    const id = await saveAppDesktop({ id: "caller-id", name: "New App", createdAt: "t", updatedAt: "t" });

    expect(id).toBe("app-backend-1");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_apps", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "create_app", { name: "New App" });
  });

  it("saveAppDesktop returns existing app id without creating", async () => {
    invokeMock.mockResolvedValueOnce([
      { id: "app-exists", name: "Existing", created_at: "t", updated_at: "t" },
    ]);
    const id = await saveAppDesktop({ id: "app-exists", name: "Existing", createdAt: "t", updatedAt: "t" });
    expect(id).toBe("app-exists");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("deleteAppDesktop invokes Rust delete", async () => {
    invokeMock.mockResolvedValue(undefined);
    await deleteAppDesktop("app-1");
    expect(invokeMock).toHaveBeenCalledWith("delete_app", { appId: "app-1" });
  });

  it("listAppFilesDesktop returns relative paths", async () => {
    invokeMock.mockResolvedValue(["package.json", "src/App.tsx"]);
    const files = await listAppFilesDesktop("app-1");
    expect(files).toEqual(["package.json", "src/App.tsx"]);
    expect(invokeMock).toHaveBeenCalledWith("list_app_files", { appId: "app-1" });
  });

  it("readAppFileDesktop returns null on missing file", async () => {
    invokeMock.mockRejectedValue(new Error("File not found"));
    const content = await readAppFileDesktop("app-1", "nope.ts");
    expect(content).toBeNull();
  });

  it("readAppFilesDesktop batch reads with nulls for missing", async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { path: string }) => {
      if (args.path === "exists.ts") return "hello";
      throw new Error("File not found");
    });
    const result = await readAppFilesDesktop("app-1", ["exists.ts", "missing.ts"]);
    expect(result).toEqual({ "exists.ts": "hello", "missing.ts": null });
  });

  it("writeAppFileDesktop passes through", async () => {
    invokeMock.mockResolvedValue(undefined);
    await writeAppFileDesktop("app-1", "src/a.ts", "code");
    expect(invokeMock).toHaveBeenCalledWith("write_app_file", {
      appId: "app-1",
      path: "src/a.ts",
      content: "code",
    });
  });

  it("writeAppFilesDesktop converts record to entries array", async () => {
    invokeMock.mockResolvedValue(2);
    const n = await writeAppFilesDesktop("app-1", {
      "a.ts": "1",
      "b.ts": "2",
    });
    expect(n).toBe(2);
    expect(invokeMock).toHaveBeenCalledWith("write_app_files", {
      appId: "app-1",
      files: [
        ["a.ts", "1"],
        ["b.ts", "2"],
      ],
    });
  });

  it("getChatHistoryDesktop restores full payload objects", async () => {
    invokeMock.mockResolvedValue([
      {
        client_id: "msg-bot-1",
        role: "assistant",
        content: "hi",
        payload: JSON.stringify({
          id: "msg-bot-1",
          role: "assistant",
          content: "hi",
          timestamp: 1700000000000,
          stepLogs: [{ step: 1, toolName: "read_file", status: "success" }],
          phaseOutputs: [{ phase: "coder", label: "coder", text: "done" }],
        }),
        created_at: "2026-08-05T00:00:01Z",
      },
    ]);
    const { getChatHistoryDesktop } = await import("./storage-desktop");
    const history = await getChatHistoryDesktop("app-1");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: "msg-bot-1",
      role: "assistant",
      stepLogs: [{ step: 1, toolName: "read_file", status: "success" }],
    });
    expect(history[0].phaseOutputs[0].text).toBe("done");
    expect(invokeMock).toHaveBeenCalledWith("get_chat_history", { appId: "app-1" });
  });

  it("getChatHistoryDesktop reconstructs legacy rows without payload", async () => {
    invokeMock.mockResolvedValue([
      { client_id: "legacy-1", role: "user", content: "hello", payload: null, created_at: "2026-08-05T00:00:00Z" },
    ]);
    const { getChatHistoryDesktop } = await import("./storage-desktop");
    const history = await getChatHistoryDesktop("app-1");
    expect(history[0]).toMatchObject({ id: "legacy-1", role: "user", content: "hello" });
  });

  it("getChatHistoryDesktop returns [] on failure", async () => {
    invokeMock.mockRejectedValue(new Error("db closed"));
    const { getChatHistoryDesktop } = await import("./storage-desktop");
    const history = await getChatHistoryDesktop("app-1");
    expect(history).toEqual([]);
  });

  it("saveChatHistoryDesktop sends full messages as replace-all", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { saveChatHistoryDesktop } = await import("./storage-desktop");
    await saveChatHistoryDesktop("app-1", [
      { id: "msg-user-1", role: "user", content: "old", timestamp: 1 },
      {
        id: "msg-bot-1",
        role: "assistant",
        content: "new",
        timestamp: 2,
        stepLogs: [{ step: 1, toolName: "write_file", status: "success" }],
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("save_chat_messages", {
      appId: "app-1",
      messages: [
        {
          client_id: "msg-user-1",
          role: "user",
          content: "old",
          payload: expect.stringContaining('"id":"msg-user-1"'),
          created_at: undefined,
        },
        {
          client_id: "msg-bot-1",
          role: "assistant",
          content: "new",
          payload: expect.stringContaining("stepLogs"),
          created_at: undefined,
        },
      ],
    });
  });

  it("saveChatHistoryDesktop serializes concurrent writes (no lost update)", async () => {
    let releaseFirst: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    invokeMock.mockImplementation(async (_cmd: string, args?: { messages?: Array<{ client_id: string }> }) => {
      const clientId = args?.messages?.[0]?.client_id ?? "";
      calls.push(clientId);
      if (clientId === "slow") await gate;
      return undefined;
    });
    const { saveChatHistoryDesktop } = await import("./storage-desktop");
    const p1 = saveChatHistoryDesktop("app-1", [{ id: "slow", role: "user", content: "1" }]);
    const p2 = saveChatHistoryDesktop("app-1", [{ id: "fast", role: "user", content: "2" }]);
    // Give the second call a chance to start; it must NOT run before the first finishes.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(["slow"]);
    releaseFirst!();
    await Promise.all([p1, p2]);
    expect(calls).toEqual(["slow", "fast"]);
  });
});
