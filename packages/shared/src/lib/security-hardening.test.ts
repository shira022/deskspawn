// Security hardening tests (2026-08-28 audit fixes)
// - C2: generated template no longer contains cors()
// - C3: sanitizeIdentifier blocks code injection via table/column names
import { describe, it, expect } from "vitest";
import { getTemplateFiles } from "./template.js";
import { sanitizeIdentifier } from "../engine/tool-executors.js";

function fileContent(files: { path: string; content: string }[], path: string): string {
  const found = files.find((f) => f.path === path);
  return found ? found.content : "";
}

describe("C2: generated template has no CORS open-permit", () => {
  it("generated server.ts does not import or use cors()", () => {
    const files = getTemplateFiles("en", false);
    const serverTs = fileContent(files, "src/server.ts");
    expect(serverTs).not.toContain("hono/cors");
    expect(serverTs).not.toContain("cors");
  });

  it("desktop template vite.config still proxies /api (same-origin access path)", () => {
    // Desktop（フルスタック・サーバー版）テンプレは vite の proxy（/api → 4174）経由で
    // Hono API にアクセスする。cors() 削除後もこの同一オリジン経路が残っていることを確認。
    const files = getTemplateFiles("en", true);
    const viteConfig = fileContent(files, "vite.config.ts");
    expect(viteConfig).toContain("/api");
    expect(viteConfig).toContain("4174");
  });
});

describe("C3: sanitizeIdentifier blocks code injection", () => {
  it("strips quotes, semicolons, backticks, and ${} escapes", () => {
    expect(sanitizeIdentifier(`items";fetch("https://evil");//`)).toBe("itemsfetchhttpsevil");
    expect(sanitizeIdentifier("user`s")).toBe("users");
    expect(sanitizeIdentifier("a${b}c")).toBe("abc");
  });

  it("prefixes leading digits and falls back to item for empty", () => {
    expect(sanitizeIdentifier("123abc")).toBe("_123abc");
    expect(sanitizeIdentifier("")).toBe("item");
    expect(sanitizeIdentifier("!!!")).toBe("item");
  });

  it("keeps valid identifiers unchanged", () => {
    expect(sanitizeIdentifier("todo_items")).toBe("todo_items");
    expect(sanitizeIdentifier("note")).toBe("note");
  });
});