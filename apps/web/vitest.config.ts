import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@deskspawn/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    // Node-side tests: pure logic, engine, lib (no browser env needed by default)
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
      "../../packages/shared/src/**/*.test.{ts,tsx}",
      "../../packages/shared/src/**/*.spec.{ts,tsx}",
    ],
    exclude: [
      "src/**/*.ui.test.{ts,tsx}",
      "../../packages/shared/src/**/*.ui.test.{ts,tsx}",
      "node_modules",
      "dist",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      // v8 プロバイダはデフォルトで root (apps/web) 外のファイルを計測しないため、
      // テストが移動した packages/shared を coverage 対象に含めるには allowExternal が必要。
      allowExternal: true,
      include: [
        "src/**/*.ts",
        "src/**/*.tsx",
        "packages/shared/src/**/*.ts",
        "packages/shared/src/**/*.tsx",
      ],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.ui.test.*",
        "**/*.d.ts",
        "src/main.tsx",
        "dist/",
      ],
      // Per-file thresholds — heavy I/O modules (storage-opfs, storage,
      // webcontainer) need integration-level testing; UI components use
      // vitest.ui.config.ts. We track coverage here as a guide, not a gate.
      thresholds: {
        statements: 25,
        branches: 20,
        functions: 20,
        lines: 25,
      },
    },
  },
});
