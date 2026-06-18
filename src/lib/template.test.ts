import { describe, it, expect } from "vitest";
import { getTemplateFiles, DEFAULT_TEMPLATE_FILES } from "./template";
import type { FileEntry } from "./storage-opfs";

describe("getTemplateFiles", () => {
  it("returns 15 file entries", () => {
    const files = getTemplateFiles("ja");
    expect(files.length).toBe(15);
  });

  it("returns 15 file entries for English too", () => {
    const files = getTemplateFiles("en");
    expect(files.length).toBe(15);
  });

  it("each entry has a path and content", () => {
    const files = getTemplateFiles("ja");
    for (const entry of files) {
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("content");
      expect(typeof entry.path).toBe("string");
      expect(typeof entry.content).toBe("string");
    }
  });

  it("each entry has a non-empty path", () => {
    const files = getTemplateFiles("ja");
    for (const entry of files) {
      expect(entry.path.length).toBeGreaterThan(0);
    }
  });

  it("includes all expected file paths", () => {
    const files = getTemplateFiles("ja");
    const paths = files.map((f) => f.path).sort();

    expect(paths).toEqual([
      "index.html",
      "package.json",
      "public/favicon.svg",
      "src/App.tsx",
      "src/hooks/index.ts",
      "src/index.css",
      "src/lib/project-id.ts",
      "src/lib/storage-idb.ts",
      "src/lib/storage.ts",
      "src/main.tsx",
      "src/store/index.ts",
      "src/types/index.ts",
      "src/vite-env.d.ts",
      "tsconfig.json",
      "vite.config.ts",
    ].sort());
  });

  describe("Japanese locale files", () => {
    const jaFiles = getTemplateFiles("ja");

    function findFile(path: string): FileEntry {
      const file = jaFiles.find((f) => f.path === path);
      if (!file) throw new Error(`File not found: ${path}`);
      return file;
    }

    it("App.tsx contains Japanese text", () => {
      const app = findFile("src/App.tsx");
      expect(app.content).toContain("アプリの生成を待機しています");
    });

    it("store/index.ts contains Japanese text", () => {
      const store = findFile("src/store/index.ts");
      expect(store.content).toContain("ストア定義のルール");
      expect(store.content).toContain("ここに各機能のストアを re-export:");
    });

    it("hooks/index.ts contains Japanese text", () => {
      const hooks = findFile("src/hooks/index.ts");
      expect(hooks.content).toContain("カスタムフックのルール");
      expect(hooks.content).toContain("ここに各機能のフックを re-export:");
    });

    it("types/index.ts contains Japanese text", () => {
      const types = findFile("src/types/index.ts");
      expect(types.content).toContain("型定義のルール");
      expect(types.content).toContain("ここに各機能の型を re-export:");
    });
  });

  describe("English locale files", () => {
    const enFiles = getTemplateFiles("en");

    function findFile(path: string): FileEntry {
      const file = enFiles.find((f) => f.path === path);
      if (!file) throw new Error(`File not found: ${path}`);
      return file;
    }

    it("App.tsx contains English text", () => {
      const app = findFile("src/App.tsx");
      expect(app.content).toContain("Waiting for app generation");
    });

    it("store/index.ts contains English text", () => {
      const store = findFile("src/store/index.ts");
      expect(store.content).toContain("Store Definition Rules");
      expect(store.content).toContain("Re-export feature stores here:");
    });

    it("hooks/index.ts contains English text", () => {
      const hooks = findFile("src/hooks/index.ts");
      expect(hooks.content).toContain("Custom Hook Rules");
      expect(hooks.content).toContain("Re-export feature hooks here:");
    });

    it("types/index.ts contains English text", () => {
      const types = findFile("src/types/index.ts");
      expect(types.content).toContain("Type Definition Rules");
      expect(types.content).toContain("Re-export feature types here:");
    });
  });

  describe("package.json", () => {
    const jaFiles = getTemplateFiles("ja");
    const pkg = jaFiles.find((f) => f.path === "package.json");

    it("is valid JSON", () => {
      expect(pkg).toBeDefined();
      expect(() => JSON.parse(pkg!.content)).not.toThrow();
    });

    it("has expected structure", () => {
      const parsed = JSON.parse(pkg!.content);
      expect(parsed).toHaveProperty("name", "generated-app");
      expect(parsed).toHaveProperty("private", true);
      expect(parsed).toHaveProperty("type", "module");
      expect(parsed).toHaveProperty("scripts");
      expect(parsed).toHaveProperty("dependencies");
      expect(parsed).toHaveProperty("devDependencies");
      expect(parsed.scripts).toHaveProperty("dev", "vite");
      expect(parsed.dependencies).toHaveProperty("react");
      expect(parsed.devDependencies).toHaveProperty("typescript");
    });
  });

  describe("tsconfig.json", () => {
    const jaFiles = getTemplateFiles("ja");
    const tsconfig = jaFiles.find((f) => f.path === "tsconfig.json");

    it("is valid JSON", () => {
      expect(tsconfig).toBeDefined();
      expect(() => JSON.parse(tsconfig!.content)).not.toThrow();
    });

    it("has expected compiler options", () => {
      const parsed = JSON.parse(tsconfig!.content);
      expect(parsed).toHaveProperty("compilerOptions");
      expect(parsed.compilerOptions).toHaveProperty("target", "ES2020");
      expect(parsed.compilerOptions).toHaveProperty("jsx", "react-jsx");
      expect(parsed.compilerOptions).toHaveProperty("strict", true);
      expect(parsed.compilerOptions).toHaveProperty("paths");
      expect(parsed.compilerOptions.paths).toEqual({ "@/*": ["./src/*"] });
      expect(parsed).toHaveProperty("include", ["src"]);
    });
  });

  describe("index.css", () => {
    const jaFiles = getTemplateFiles("ja");
    const css = jaFiles.find((f) => f.path === "src/index.css");

    it("contains Tailwind directives", () => {
      expect(css).toBeDefined();
      expect(css!.content).toContain("@import \"tailwindcss\"");
    });

    it("contains CSS custom properties", () => {
      expect(css!.content).toContain("--color-background");
      expect(css!.content).toContain("--color-foreground");
    });

    it("contains dark mode styles", () => {
      expect(css!.content).toContain(".dark");
    });

    it("contains @layer base with Tailwind utilities", () => {
      expect(css!.content).toContain("@layer base");
      expect(css!.content).toContain("@apply border-border");
    });
  });

  describe("index.html", () => {
    const jaFiles = getTemplateFiles("ja");
    const html = jaFiles.find((f) => f.path === "index.html");

    it("has correct lang attribute for Japanese", () => {
      expect(html).toBeDefined();
      expect(html!.content).toContain('lang="ja"');
    });

    it("has correct lang attribute for English", () => {
      const enFiles = getTemplateFiles("en");
      const enHtml = enFiles.find((f) => f.path === "index.html");
      expect(enHtml!.content).toContain('lang="en"');
    });
  });
});

describe("DEFAULT_TEMPLATE_FILES", () => {
  it("equals getTemplateFiles('ja')", () => {
    const jaFiles = getTemplateFiles("ja");
    expect(DEFAULT_TEMPLATE_FILES.length).toBe(jaFiles.length);

    for (let i = 0; i < DEFAULT_TEMPLATE_FILES.length; i++) {
      expect(DEFAULT_TEMPLATE_FILES[i].path).toBe(jaFiles[i].path);
      expect(DEFAULT_TEMPLATE_FILES[i].content).toBe(jaFiles[i].content);
    }
  });

  it("has 15 entries", () => {
    expect(DEFAULT_TEMPLATE_FILES.length).toBe(15);
  });

  it("contains Japanese locale content", () => {
    const app = DEFAULT_TEMPLATE_FILES.find((f) => f.path === "src/App.tsx");
    expect(app).toBeDefined();
    expect(app!.content).toContain("アプリの生成を待機しています");
  });
});
