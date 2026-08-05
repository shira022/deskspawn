import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Node-side tests: pure logic, engine, lib (no browser env needed by default)
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    exclude: ["src/**/*.ui.test.{ts,tsx}", "node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.*",
        "src/**/*.spec.*",
        "src/**/*.ui.test.*",
        "src/vite-env.d.ts",
        "src/main.tsx",
        "dist/",
        "src/**/*.d.ts",
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
