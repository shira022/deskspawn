import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Connect } from "vite";

const SETTINGS_KEY = "deskspawn_settings";

// ── Project Files API Server ──────────────────────────────────────────────────
// Serves generated project source files from the filesystem to the browser app
// so they can be seeded into OPFS/IndexedDB for preview.
//
// The desktop (Tauri) version writes project files to disk. In the web version,
// the browser reads from OPFS. This middleware bridges the gap by letting the
// browser fetch existing filesystem project files and write them to OPFS.

const PROJECTS_DIR = path.resolve(__dirname, "projects");
const WORKSPACE_DIR = path.resolve(__dirname, "workspace");

function projectFilesPlugin(): import("vite").Plugin {
  return {
    name: "project-files-server",
    configureServer(_server) {

      // Middleware: GET /api/project-files/:projectId
      // Returns JSON: { files: { [relativePath]: content } }
      _server.middlewares.use(
        "/api/project-files",
        (req: Connect.IncomingMessage, res: any, next: Connect.NextFunction) => {
          if (req.method !== "GET") return next();

          const url = req.url || "";
          // Match /{projectId} and optional ?type=workspace
          const match = url.match(/^\/([^/?]+)(?:\?(.+))?$/);
          if (!match) return next();

          const projectId = match[1];
          const params = new URLSearchParams(match[2] || "");
          const isWorkspace = params.get("type") === "workspace";

          // Determine source directory
          const srcDir = isWorkspace
            ? path.join(WORKSPACE_DIR, "src")
            : path.join(PROJECTS_DIR, projectId, "src");
          const baseDir = isWorkspace ? WORKSPACE_DIR : path.join(PROJECTS_DIR, projectId);

          if (!fs.existsSync(srcDir)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Project not found", projectId }));
            return;
          }

          try {
            const files: Record<string, string> = {};

            // Read base files (index.html, package.json, etc.)
            for (const baseFile of ["index.html", "package.json", "tsconfig.json", "vite.config.ts"]) {
              const fp = path.join(baseDir, baseFile);
              if (fs.existsSync(fp)) {
                files[baseFile] = fs.readFileSync(fp, "utf-8");
              }
            }

            // Read public/ directory
            const publicDir = path.join(baseDir, "public");
            if (fs.existsSync(publicDir)) {
              readDirRecursive(publicDir, "public", files);
            }

            // Read src/ directory recursively
            readDirRecursive(srcDir, "src", files);

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ files, projectId }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        },
      );
    },
  };
}

function readDirRecursive(dir: string, prefix: string, files: Record<string, string>): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        readDirRecursive(fullPath, relativePath, files);
      } else if (entry.isFile() && !entry.name.startsWith(".") && !entry.name.endsWith(".tsbuildinfo")) {
        // Skip binary files and lockfiles
        const skipExts = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".lock"];
        if (!skipExts.some((ext) => entry.name.endsWith(ext))) {
          files[relativePath] = fs.readFileSync(fullPath, "utf-8");
        }
      }
    }
  } catch {
    // Directory may not exist
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    projectFilesPlugin(),
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
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // WebContainer 必須: crossOriginIsolation のためのヘッダー
    // WebContainer.boot({ coep: "credentialless" }) と一致させること
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  build: {
    target: "es2020",
    minify: "esbuild",
  },
});
