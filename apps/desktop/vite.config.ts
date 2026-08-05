import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const webSrc = path.resolve(__dirname, "../../apps/web/src");
const SETTINGS_KEY = "deskspawn_settings";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inject-theme-script",
      transformIndexHtml() {
        return [
          {
            tag: "script",
            injectTo: "head",
            children: `(function(){try{var s=JSON.parse(localStorage.getItem('${SETTINGS_KEY}'));if(s&&s.theme==='dark'){document.documentElement.classList.add('dark')}else if(!s||s.theme==='system'){if(window.matchMedia('(prefers-color-scheme:dark)').matches){document.documentElement.classList.add('dark')}}}catch(e){}})()`,
          },
        ];
      },
    },
  ],
  resolve: {
    alias: {
      "@": webSrc,
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
  },
});
