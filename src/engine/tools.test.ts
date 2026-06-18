import { describe, it, expect, vi } from "vitest";

// ── Mock "ai" module ───────────────────────────────────────────────────────────
// The real `tool()` returns a complex AI SDK type, but we only need the shape.
vi.mock("ai", () => ({
  tool: vi.fn(
    ({ description, inputSchema }: { description: string; inputSchema: unknown }) => ({
      description,
      parameters: inputSchema,
      execute: undefined,
    }),
  ),
}));

// ── Imports (after vi.mock) ────────────────────────────────────────────────────

import { tools, readFileTool, listFilesTool, applyArtifactTool, getErrorsTool, takeScreenshotTool } from "./tools";

// Helper: access parameters regardless of TS types (mock returns different shape)
function params(t: any) {
  return t.parameters;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("tools", () => {
  it("exports all 5 tools with correct keys", () => {
    const keys = Object.keys(tools);
    expect(keys).toHaveLength(5);
    expect(keys).toEqual([
      "read_file",
      "list_files",
      "apply_artifact",
      "get_errors",
      "take_screenshot",
    ]);
  });

  it("each tool has description, parameters, and execute", () => {
    for (const [, toolDef] of Object.entries(tools)) {
      const t: any = toolDef;
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("parameters");
      expect(t).toHaveProperty("execute");
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  describe("readFileTool", () => {
    it("has path parameter mentioning path", () => {
      const shape = params(readFileTool)._def?.innerType?._def?.shape
        ?? params(readFileTool)._def?.shape;
      expect(shape).toHaveProperty("path");
    });

    it("parses valid input", () => {
      const result = params(readFileTool).safeParse({ path: "src/App.tsx" });
      expect(result.success).toBe(true);
    });

    it("rejects missing path", () => {
      const result = params(readFileTool).safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string path", () => {
      const result = params(readFileTool).safeParse({ path: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe("listFilesTool", () => {
    it("has empty object input schema", () => {
      const result = params(listFilesTool).safeParse({});
      expect(result.success).toBe(true);
    });

    it("strips extra keys (z.object strips by default)", () => {
      const result = params(listFilesTool).safeParse({ extra: "key" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty("extra");
      }
    });
  });

  describe("applyArtifactTool", () => {
    it("has description mentioning code changes", () => {
      expect(applyArtifactTool.description).toMatch(/apply|code|change/i);
    });

    it("parses a valid artifact with file actions", () => {
      const result = params(applyArtifactTool).safeParse({
        id: "change-1",
        title: "Add button component",
        actions: [
          {
            type: "file" as const,
            mode: "file" as const,
            filePath: "src/Button.tsx",
            content: "export const Button = () => null;",
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("parses artifact with diff action", () => {
      const result = params(applyArtifactTool).safeParse({
        id: "change-2",
        title: "Update text",
        actions: [
          {
            type: "file" as const,
            mode: "diff" as const,
            filePath: "src/App.tsx",
            search: "old text",
            replace: "new text",
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("parses artifact with template action", () => {
      const result = params(applyArtifactTool).safeParse({
        id: "change-3",
        title: "Generate CRUD",
        actions: [
          {
            type: "template" as const,
            template: "crud" as const,
            tableName: "users",
            columns: [
              { name: "name", sqlType: "TEXT", nullable: false, primaryKey: false, unique: false },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty actions array", () => {
      const result = params(applyArtifactTool).safeParse({
        id: "change-4",
        title: "Empty",
        actions: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 30 actions", () => {
      const actions = Array.from({ length: 31 }, (_, i) => ({
        type: "file" as const,
        mode: "file" as const,
        filePath: `file${i}.ts`,
        content: "",
      }));
      const result = params(applyArtifactTool).safeParse({
        id: "too-many",
        title: "Too many actions",
        actions,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid action type", () => {
      const result = params(applyArtifactTool).safeParse({
        id: "bad",
        title: "Bad action",
        actions: [{ type: "invalid", foo: "bar" }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getErrorsTool", () => {
    it("has description mentioning error check", () => {
      expect(getErrorsTool.description).toMatch(/error|check/i);
    });

    it("parses empty input", () => {
      const result = params(getErrorsTool).safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("takeScreenshotTool", () => {
    it("has description mentioning screenshot", () => {
      expect(takeScreenshotTool.description).toMatch(/screenshot|visual|verify/i);
    });

    it("parses valid screenshot options", () => {
      const result = params(takeScreenshotTool).safeParse({
        target: "#preview",
        fullPage: true,
        width: 1280,
        height: 720,
      });
      expect(result.success).toBe(true);
    });

    it("parses with viewports array", () => {
      const result = params(takeScreenshotTool).safeParse({
        viewports: [
          { width: 375, height: 667, label: "mobile" },
          { width: 768, height: 1024, label: "tablet" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects viewport with invalid width (< 320)", () => {
      const result = params(takeScreenshotTool).safeParse({
        viewports: [{ width: 100, height: 500 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects too many viewports (> 10)", () => {
      const viewports = Array.from({ length: 11 }, (_, i) => ({
        width: 1280,
        height: 720,
        label: `vp-${i}`,
      }));
      const result = params(takeScreenshotTool).safeParse({ viewports });
      expect(result.success).toBe(false);
    });

    it("applies defaults for optional fields", () => {
      const result = params(takeScreenshotTool).safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fullPage).toBe(true);
        expect(result.data.width).toBe(1280);
        expect(result.data.height).toBe(720);
        expect(result.data.mode).toBe("browser");
        expect(result.data.waitAfterLoad).toBe(1500);
        expect(result.data.compareWithPrevious).toBe(false);
      }
    });
  });

  describe("tool descriptions are informative", () => {
    it("readFileTool description mentions path or file", () => {
      expect(readFileTool.description).toMatch(/path|file/i);
    });

    it("applyArtifactTool description mentions actions or changes", () => {
      expect(applyArtifactTool.description).toMatch(/action|change|file/i);
    });
  });
});
