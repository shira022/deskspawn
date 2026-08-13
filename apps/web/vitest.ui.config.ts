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
    globals: true,
    environment: "jsdom",
    include: [
      "src/**/*.ui.test.{ts,tsx}",
      "../../packages/shared/src/**/*.ui.test.{ts,tsx}",
    ],
    setupFiles: ["./src/test/setup-ui.ts"],
    css: false,
  },
});
