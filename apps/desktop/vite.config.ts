import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("/node_modules/monaco-editor/")) return "editor";

  if (
    id.includes("/node_modules/react/") ||
    id.includes("/node_modules/react-dom/") ||
    id.includes("/node_modules/scheduler/")
  ) {
    return "react";
  }

  if (
    id.includes("/node_modules/i18next/") ||
    id.includes("/node_modules/react-i18next/") ||
    id.includes("/node_modules/i18next-browser-languagedetector/")
  ) {
    return "i18n";
  }

  if (
    id.includes("/node_modules/react-markdown/") ||
    id.includes("/node_modules/remark-") ||
    id.includes("/node_modules/rehype-") ||
    id.includes("/node_modules/highlight.js/") ||
    id.includes("/node_modules/shiki/")
  ) {
    return "markdown";
  }

  if (
    id.includes("/node_modules/ai/") ||
    id.includes("/node_modules/@ai-sdk/")
  ) {
    return "ai";
  }

  return "vendor";
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inject-theme-script",
      transformIndexHtml() {
        // Low-3（監査 2026-08-28）: インライン script は本番 CSP
        // （script-src 'self' 'wasm-unsafe-eval'、unsafe-inline 無し）で
        // ブロックされるため、public/theme-init.js を外部スクリプトとして
        // 注入する（'self' で読み込めるので CSP 準拠）。
        return [
          {
            tag: "script",
            attrs: { src: "/theme-init.js" },
            injectTo: "head",
          },
        ];
      },
    },
  ],
  resolve: {
    alias: {
      "@deskspawn/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 5174 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari14",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
