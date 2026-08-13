/**
 * Tests for preview types — minimal since it's a types-only file.
 */
import { describe, it, expect } from "vitest";
import type {
  PreviewState,
  PreviewStatus,
  SyncResult,
  StateListener,
  ErrorEntry,
} from "./types";

describe("preview types", () => {
  it("should export PreviewStatus type", () => {
    const status: PreviewStatus = "idle";
    expect(status).toBe("idle");

    const allStatuses: PreviewStatus[] = [
      "idle",
      "booting",
      "installing",
      "starting-dev",
      "ready",
      "syncing",
      "error",
    ];
    expect(allStatuses).toHaveLength(7);
  });

  it("should export PreviewState interface shape", () => {
    const state: PreviewState = {
      status: "ready",
      url: "http://localhost:5173",
      error: null,
      logs: ["[12:00:00] Server ready"],
    };
    expect(state.status).toBe("ready");
    expect(state.url).toBe("http://localhost:5173");
    expect(state.error).toBeNull();
    expect(state.logs).toHaveLength(1);
  });

  it("should export SyncResult interface shape", () => {
    const result: SyncResult = {
      filesSynced: 5,
      installTriggered: true,
      errors: ["file.ts: read error"],
    };
    expect(result.filesSynced).toBe(5);
    expect(result.installTriggered).toBe(true);
    expect(result.errors).toHaveLength(1);
  });

  it("should export StateListener as a callable function type", () => {
    const listener: StateListener = (state) => {
      expect(state.status).toBeDefined();
    };
    listener({ status: "ready", url: null, error: null, logs: [] });
  });

  it("should export ErrorEntry interface shape", () => {
    const tsError: ErrorEntry = {
      type: "typescript",
      message: "Type 'string' is not assignable to type 'number'.",
      filePath: "src/App.tsx",
      line: 42,
      column: 10,
    };
    expect(tsError.type).toBe("typescript");
    expect(tsError.filePath).toBe("src/App.tsx");
    expect(tsError.line).toBe(42);
    expect(tsError.column).toBe(10);

    const viteError: ErrorEntry = {
      type: "vite",
      message: "Build error",
    };
    expect(viteError.type).toBe("vite");
    expect(viteError.filePath).toBeUndefined();

    const missingPkgError: ErrorEntry = {
      type: "missing-package",
      message: "Package 'lodash' not found",
    };
    expect(missingPkgError.type).toBe("missing-package");
  });
});
