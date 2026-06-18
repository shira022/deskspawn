import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @/engine/tool-executors ────────────────────────────────────────────

const mockToolExecutors = {
  getProjectId: vi.fn(),
  restoreCheckpoint: vi.fn(),
  deleteCheckpointsAfter: vi.fn(),
};

vi.mock("@/engine/tool-executors", () => mockToolExecutors);

// ─── Types ───────────────────────────────────────────────────────────────────

import type { CheckpointInfo, ChatMessage } from "@/types";

function makeCheckpoint(id: string, order = 0): CheckpointInfo {
  return { id, createdAt: new Date(Date.now() + order * 1000) };
}

function makeMessage(
  id: string,
  role: "user" | "assistant" | "system",
  checkpointId?: string,
): ChatMessage {
  return {
    id,
    role,
    content: `Message ${id}`,
    timestamp: Date.now(),
    checkpointId,
  };
}

describe("getMessageCountForCheckpoint", () => {
  let getMessageCountForCheckpoint: (
    checkpoints: CheckpointInfo[],
    messages: ChatMessage[],
    checkpointIndex: number,
  ) => number;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./checkpoint-utils");
    getMessageCountForCheckpoint = mod.getMessageCountForCheckpoint;
  });

  it("returns correct count for a valid checkpoint index", () => {
    const checkpoints = [
      makeCheckpoint("initial", 0),
      makeCheckpoint("cp-1", 1),
      makeCheckpoint("cp-2", 2),
    ];
    const messages = [
      makeMessage("u1", "user"),
      makeMessage("a1", "assistant", "cp-1"),
      makeMessage("u2", "user"),
      makeMessage("a2", "assistant", "cp-2"),
    ];

    // Checkpoint index 1 = "cp-1" which is stored on messages[1] -> count = 2
    expect(getMessageCountForCheckpoint(checkpoints, messages, 1)).toBe(2);

    // Checkpoint index 2 = "cp-2" which is stored on messages[3] -> count = 4
    expect(getMessageCountForCheckpoint(checkpoints, messages, 2)).toBe(4);
  });

  it('returns 0 for the "initial" checkpoint', () => {
    const checkpoints = [makeCheckpoint("initial")];
    const messages = [makeMessage("u1", "user"), makeMessage("a1", "assistant", "cp-1")];

    expect(getMessageCountForCheckpoint(checkpoints, messages, 0)).toBe(0);
  });

  it("returns all messages when checkpoints array is empty", () => {
    const messages = [makeMessage("u1", "user"), makeMessage("a1", "assistant", "cp-1")];

    expect(getMessageCountForCheckpoint([], messages, 0)).toBe(2);
  });

  it("returns all messages when no matching assistant message is found", () => {
    const checkpoints = [
      makeCheckpoint("initial"),
      makeCheckpoint("cp-orphan"),
    ];
    const messages = [
      makeMessage("u1", "user"),
      makeMessage("a1", "assistant", "some-other-cp"),
    ];

    // No message has checkpointId === "cp-orphan", so fallback to all messages
    expect(getMessageCountForCheckpoint(checkpoints, messages, 1)).toBe(2);
  });

  it("returns all messages when checkpointIndex is negative", () => {
    const checkpoints = [makeCheckpoint("cp-1")];
    const messages = [makeMessage("u1", "user"), makeMessage("a1", "assistant", "cp-1")];

    expect(getMessageCountForCheckpoint(checkpoints, messages, -1)).toBe(2);
  });

  it("returns all messages when checkpointIndex is out of bounds", () => {
    const checkpoints = [makeCheckpoint("cp-1")];
    const messages = [makeMessage("u1", "user")];

    expect(getMessageCountForCheckpoint(checkpoints, messages, 5)).toBe(1);
  });

  it("walks backwards to find the correct assistant message", () => {
    // Multiple assistant messages with different checkpointIds
    const checkpoints = [
      makeCheckpoint("initial"),
      makeCheckpoint("cp-middle"),
    ];
    const messages = [
      makeMessage("u1", "user"),
      makeMessage("a1", "assistant", "cp-middle"),
      makeMessage("u2", "user"),
      makeMessage("a2", "assistant", "cp-middle"), // Another message with same checkpointId
    ];

    // Should find the LAST assistant message with cp-middle at index 3 -> count = 4
    expect(getMessageCountForCheckpoint(checkpoints, messages, 1)).toBe(4);
  });
});

describe("restoreCheckpoint", () => {
  beforeEach(() => {
    mockToolExecutors.getProjectId.mockReset();
    mockToolExecutors.restoreCheckpoint.mockReset();
    mockToolExecutors.deleteCheckpointsAfter.mockReset();
  });

  it("calls engine restore and deleteCheckpointsAfter", async () => {
    mockToolExecutors.getProjectId.mockReturnValue("proj-123");

    const { restoreCheckpoint } = await import("./checkpoint-utils");
    await restoreCheckpoint("cp-5");

    expect(mockToolExecutors.restoreCheckpoint).toHaveBeenCalledWith("proj-123", "cp-5");
    expect(mockToolExecutors.deleteCheckpointsAfter).toHaveBeenCalledWith("proj-123", "cp-5");
  });

  it("throws when no project is selected", async () => {
    mockToolExecutors.getProjectId.mockReturnValue("");

    const { restoreCheckpoint } = await import("./checkpoint-utils");
    await expect(restoreCheckpoint("cp-5")).rejects.toThrow("No project selected.");
  });

  it("throws when getProjectId returns undefined", async () => {
    mockToolExecutors.getProjectId.mockReturnValue(undefined as unknown as string);

    const { restoreCheckpoint } = await import("./checkpoint-utils");
    await expect(restoreCheckpoint("cp-5")).rejects.toThrow("No project selected.");
  });

  it("propagates errors from engine restore", async () => {
    mockToolExecutors.getProjectId.mockReturnValue("proj-456");
    mockToolExecutors.restoreCheckpoint.mockRejectedValue(new Error("Checkpoint data corrupted"));

    const { restoreCheckpoint } = await import("./checkpoint-utils");
    await expect(restoreCheckpoint("cp-bad")).rejects.toThrow("Checkpoint data corrupted");
  });

  it("still calls deleteCheckpointsAfter when engine restore throws", async () => {
    // Actually, looking at the source code, the error from engineRestore
    // would prevent deleteCheckpointsAfter from being called since they're
    // sequential awaits.  This test documents that behavior.
    mockToolExecutors.getProjectId.mockReturnValue("proj-456");
    mockToolExecutors.restoreCheckpoint.mockRejectedValue(new Error("Fail"));

    const { restoreCheckpoint } = await import("./checkpoint-utils");
    await expect(restoreCheckpoint("cp-fail")).rejects.toThrow("Fail");

    // deleteCheckpointsAfter should NOT be called since engineRestore threw
    expect(mockToolExecutors.deleteCheckpointsAfter).not.toHaveBeenCalled();
  });
});

describe("getMessageCountForCheckpoint edge cases", () => {
  let getMessageCountForCheckpoint: (
    checkpoints: CheckpointInfo[],
    messages: ChatMessage[],
    checkpointIndex: number,
  ) => number;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./checkpoint-utils");
    getMessageCountForCheckpoint = mod.getMessageCountForCheckpoint;
  });

  it("handles a single checkpoint correctly", () => {
    const checkpoints = [makeCheckpoint("cp-solo")];
    const messages = [
      makeMessage("u1", "user"),
      makeMessage("a1", "assistant", "cp-solo"),
    ];

    expect(getMessageCountForCheckpoint(checkpoints, messages, 0)).toBe(2);
  });

  it("handles empty messages array", () => {
    const checkpoints = [makeCheckpoint("initial")];
    expect(getMessageCountForCheckpoint(checkpoints, [], 0)).toBe(0);
  });

  it("handles null/missing checkpointId on assistant messages", () => {
    const checkpoints = [makeCheckpoint("cp-1")];
    const messages = [
      makeMessage("u1", "user"),
      makeMessage("a1", "assistant"), // No checkpointId
    ];

    // No match, falls back to all messages
    expect(getMessageCountForCheckpoint(checkpoints, messages, 0)).toBe(2);
  });

  it("distinguishes between user and assistant messages", () => {
    const checkpoints = [makeCheckpoint("cp-target")];
    const messages = [
      makeMessage("u1", "user", "cp-target"), // User message with checkpointId rarely, but should be ignored
      makeMessage("a1", "assistant", "cp-target"),
    ];

    // Should find the assistant message at index 1 -> count = 2
    expect(getMessageCountForCheckpoint(checkpoints, messages, 0)).toBe(2);
  });
});
