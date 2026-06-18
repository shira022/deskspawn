/**
 * Tests for preview barrel export (index.ts).
 */
import { describe, it, expect } from "vitest";

// ─── Import the things that should be exported ────────────────────────────────

import {
  previewManager,
  PreviewManager,
} from "./index";
import type { PreviewState, PreviewStatus, ErrorEntry } from "./index";

describe("preview index (barrel export)", () => {
  it("should export previewManager as a singleton instance of PreviewManager", () => {
    expect(previewManager).toBeDefined();
    expect(previewManager).toBeInstanceOf(PreviewManager);
  });

  it("should export PreviewManager class", () => {
    expect(PreviewManager).toBeDefined();
    expect(typeof PreviewManager).toBe("function");

    const instance = new PreviewManager();
    expect(instance).toBeInstanceOf(PreviewManager);
  });

  it("previewManager should be a singleton (same reference)", async () => {
    // Importing the same module should return the same instance
    const mod = await import("./index");
    expect(mod.previewManager).toBe(previewManager);
  });

  it("should export type PreviewState (compile-time check)", () => {
    // Type-only import — if it compiles, the export works
    const state: PreviewState = {
      status: "idle",
      url: null,
      error: null,
      logs: [],
    };
    expect(state.status).toBe("idle");
  });

  it("should export type PreviewStatus (compile-time check)", () => {
    const status: PreviewStatus = "ready";
    expect(status).toBe("ready");
  });

  it("should export type ErrorEntry (compile-time check)", () => {
    const entry: ErrorEntry = {
      type: "typescript",
      message: "error message",
    };
    expect(entry.type).toBe("typescript");
  });
});
