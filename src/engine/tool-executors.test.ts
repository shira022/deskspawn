import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all dependencies ──────────────────────────────────────────────────────

vi.mock("@/lib/storage-opfs", () => ({
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
  listProjectFiles: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  saveChatHistory: vi.fn(),
  getChatHistory: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

// html2canvas and pixelmatch are only used by takeScreenshot — not tested here,
// but we provide mocks to prevent import errors if any side-effect loads them.
vi.mock("html2canvas", () => ({ default: vi.fn() }));
vi.mock("pixelmatch", () => ({ default: vi.fn() }));

// ── Imports (after vi.mock) ────────────────────────────────────────────────────

import {
  setProjectId,
  getProjectId,
  readFile,
  listFiles,
  createCheckpoint,
  listCheckpoints,
  deleteCheckpointsAfter,
  persistChatHistory,
  loadChatHistory,
} from "./tool-executors";

import { readProjectFile, listProjectFiles } from "@/lib/storage-opfs";
import { saveChatHistory, getChatHistory, getSetting, setSetting } from "@/lib/storage";

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("setProjectId / getProjectId", () => {
  beforeEach(() => {
    // Reset to empty string
    setProjectId("");
  });

  it("starts with empty project ID", () => {
    expect(getProjectId()).toBe("");
  });

  it("setProjectId sets the project ID", () => {
    setProjectId("my-project");
    expect(getProjectId()).toBe("my-project");
  });

  it("setProjectId overwrites previous ID", () => {
    setProjectId("first");
    setProjectId("second");
    expect(getProjectId()).toBe("second");
  });
});

describe("readFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProjectId("test-project");
  });

  it("reads a file by resolving @/ alias to src/", async () => {
    vi.mocked(readProjectFile).mockResolvedValue("file content");

    const content = await readFile("@/App.tsx");

    expect(content).toBe("file content");
    expect(readProjectFile).toHaveBeenCalledWith("test-project", "src/App.tsx");
  });

  it("reads a file with relative path unchanged when no @/ prefix", async () => {
    vi.mocked(readProjectFile).mockResolvedValue("config content");

    const content = await readFile("config.json");

    expect(content).toBe("config content");
    expect(readProjectFile).toHaveBeenCalledWith("test-project", "config.json");
  });

  it("throws when file is not found (returns null)", async () => {
    vi.mocked(readProjectFile).mockResolvedValue(null);

    await expect(readFile("missing.ts")).rejects.toThrow("File not found");
  });

  it("throws when no project is selected", async () => {
    setProjectId("");
    await expect(readFile("test.ts")).rejects.toThrow("No project selected");
  });
});

describe("listFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProjectId("test-project");
  });

  it("lists files for the current project", async () => {
    const mockFiles = [
      { path: "src/App.tsx", size: 500, lastModified: "2024-01-01", isDirectory: false },
      { path: "src/utils.ts", size: 200, lastModified: "2024-01-02", isDirectory: false },
    ];
    vi.mocked(listProjectFiles).mockResolvedValue(mockFiles);

    const result = await listFiles();

    expect(result).toEqual(mockFiles);
    expect(listProjectFiles).toHaveBeenCalledWith("test-project");
  });

  it("returns empty array when no project is selected", async () => {
    setProjectId("");

    const result = await listFiles();

    expect(result).toEqual([]);
    expect(listProjectFiles).not.toHaveBeenCalled();
  });
});

describe("createCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProjectId("test-project");
  });

  it("creates a checkpoint and returns its ID", async () => {
    vi.mocked(listProjectFiles).mockResolvedValue([
      { path: "src/main.ts", size: 100, lastModified: "2024-01-01", isDirectory: false },
    ]);
    vi.mocked(readProjectFile).mockResolvedValue("console.log('hello');");
    vi.mocked(getSetting).mockResolvedValue({});
    vi.mocked(setSetting).mockResolvedValue(undefined);

    const id = await createCheckpoint("test-project", "cp-1");

    expect(id).toBe("cp-1");
    expect(listProjectFiles).toHaveBeenCalledWith("test-project");
    expect(readProjectFile).toHaveBeenCalledWith("test-project", "src/main.ts");
    expect(getSetting).toHaveBeenCalledWith("deskspawn_checkpoints");
    expect(setSetting).toHaveBeenCalledWith("deskspawn_checkpoints", expect.any(Object));
  });

  it("skips directory entries when building snapshot", async () => {
    vi.mocked(listProjectFiles).mockResolvedValue([
      { path: "node_modules", size: 0, lastModified: "2024-01-01", isDirectory: true },
      { path: "src/main.ts", size: 100, lastModified: "2024-01-01", isDirectory: false },
    ]);
    vi.mocked(readProjectFile).mockResolvedValue("content");
    vi.mocked(getSetting).mockResolvedValue({});
    vi.mocked(setSetting).mockResolvedValue(undefined);

    await createCheckpoint("test-project", "cp-2");

    // Should only read the non-directory file
    expect(readProjectFile).toHaveBeenCalledTimes(1);
    expect(readProjectFile).toHaveBeenCalledWith("test-project", "src/main.ts");
  });

  it("merges with existing checkpoints", async () => {
    vi.mocked(listProjectFiles).mockResolvedValue([
      { path: "src/main.ts", size: 100, lastModified: "2024-01-01", isDirectory: false },
    ]);
    vi.mocked(readProjectFile).mockResolvedValue("content");
    vi.mocked(getSetting).mockResolvedValue({
      "existing-cp": {
        id: "existing-cp",
        projectId: "other-project",
        createdAt: "2024-01-01T00:00:00.000Z",
        files: {},
      },
    });
    vi.mocked(setSetting).mockResolvedValue(undefined);

    await createCheckpoint("test-project", "cp-new");

    const saved = vi.mocked(setSetting).mock.calls[0][1] as Record<string, any>;
    expect(saved["existing-cp"]).toBeDefined();
    expect(saved["cp-new"]).toBeDefined();
  });

  it("throws when no project ID is provided and none is set", async () => {
    setProjectId("");
    await expect(createCheckpoint("")).rejects.toThrow("No project selected");
  });
});

describe("listCheckpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns checkpoints filtered by project ID, sorted by date", async () => {
    vi.mocked(getSetting).mockResolvedValue({
      "cp-a": { id: "cp-a", projectId: "proj-1", createdAt: "2024-01-03T00:00:00.000Z", files: {} },
      "cp-b": { id: "cp-b", projectId: "proj-1", createdAt: "2024-01-01T00:00:00.000Z", files: {} },
      "cp-c": { id: "cp-c", projectId: "proj-2", createdAt: "2024-01-02T00:00:00.000Z", files: {} },
    });

    const result = await listCheckpoints("proj-1");

    expect(result).toHaveLength(2);
    // Sorted ascending: cp-b (Jan 1), cp-a (Jan 3)
    expect(result[0].id).toBe("cp-b");
    expect(result[1].id).toBe("cp-a");
    expect(result[0].createdAt).toBeInstanceOf(Date);
  });

  it("returns empty array when no checkpoints exist", async () => {
    vi.mocked(getSetting).mockResolvedValue({});
    const result = await listCheckpoints("proj-1");
    expect(result).toEqual([]);
  });
});

describe("deleteCheckpointsAfter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes checkpoints created after the given (keep) checkpoint", async () => {
    const checkpoints = {
      "cp-1": { id: "cp-1", projectId: "proj-1", createdAt: "2024-01-01T00:00:00.000Z", files: {} },
      "cp-2": { id: "cp-2", projectId: "proj-1", createdAt: "2024-01-02T00:00:00.000Z", files: {} },
      "cp-3": { id: "cp-3", projectId: "proj-1", createdAt: "2024-01-03T00:00:00.000Z", files: {} },
    };
    vi.mocked(getSetting).mockResolvedValue(checkpoints);
    vi.mocked(setSetting).mockResolvedValue(undefined);

    await deleteCheckpointsAfter("proj-1", "cp-2");

    // Should keep cp-1 and cp-2, delete cp-3 (created after cp-2)
    const saved = vi.mocked(setSetting).mock.calls[0][1] as Record<string, any>;
    expect(saved["cp-1"]).toBeDefined();
    expect(saved["cp-2"]).toBeDefined();
    expect(saved["cp-3"]).toBeUndefined();
  });

  it("does nothing if the keep checkpoint ID is not found", async () => {
    const checkpoints = {
      "cp-1": { id: "cp-1", projectId: "proj-1", createdAt: "2024-01-01T00:00:00.000Z", files: {} },
    };
    vi.mocked(getSetting).mockResolvedValue(checkpoints);
    vi.mocked(setSetting).mockResolvedValue(undefined);

    await deleteCheckpointsAfter("proj-1", "nonexistent");

    expect(setSetting).not.toHaveBeenCalled();
  });

  it("only affects checkpoints for the specified project", async () => {
    const checkpoints = {
      "cp-a": { id: "cp-a", projectId: "proj-1", createdAt: "2024-01-01T00:00:00.000Z", files: {} },
      "cp-b": { id: "cp-b", projectId: "proj-1", createdAt: "2024-01-02T00:00:00.000Z", files: {} },
      "cp-other": { id: "cp-other", projectId: "proj-2", createdAt: "2024-01-03T00:00:00.000Z", files: {} },
    };
    vi.mocked(getSetting).mockResolvedValue(checkpoints);
    vi.mocked(setSetting).mockResolvedValue(undefined);

    await deleteCheckpointsAfter("proj-1", "cp-a");

    const saved = vi.mocked(setSetting).mock.calls[0][1] as Record<string, any>;
    expect(saved["cp-a"]).toBeDefined();
    expect(saved["cp-b"]).toBeUndefined(); // deleted (after cp-a)
    expect(saved["cp-other"]).toBeDefined(); // different project, untouched
  });
});

describe("persistChatHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves chat messages to storage", async () => {
    vi.mocked(saveChatHistory).mockResolvedValue(undefined);

    const messages = [{ role: "user", content: "Hello" }];
    await persistChatHistory("proj-1", messages);

    expect(saveChatHistory).toHaveBeenCalledWith("proj-1", messages);
  });
});

describe("loadChatHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads chat messages from storage", async () => {
    const storedMessages = [{ role: "user", content: "Hello" }];
    vi.mocked(getChatHistory).mockResolvedValue(storedMessages);

    const result = await loadChatHistory("proj-1");

    expect(result).toEqual(storedMessages);
    expect(getChatHistory).toHaveBeenCalledWith("proj-1");
  });

  it("returns empty array when no history exists", async () => {
    vi.mocked(getChatHistory).mockResolvedValue([]);

    const result = await loadChatHistory("proj-empty");

    expect(result).toEqual([]);
  });
});


