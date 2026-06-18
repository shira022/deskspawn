# Changelog

Each release is documented on **GitHub Releases**. See the full history at
[github.com/shira022/deskspawn/releases](https://github.com/shira022/deskspawn/releases).

---

## v0.1.0 (Initial Release) — 2026-06-05

**Highlights:**

- 🚀 **Project generation** — describe an app in natural language and generate
  a complete Vite + React + TypeScript project.
- 💬 **AI chat interface** — iterate on your project through conversation.
- 👁️ **Live preview** — see your app running inside the DeskSpawn window.
- 🧩 **Sidecar architecture** — isolated AI runtime for reliability and
  performance.
- 🗄️ **Local SQLite database** — all projects and settings stored locally.
- 🌐 **Multi-provider AI support** — OpenAI, Anthropic, and Ollama (local).
- 🖥️ **Cross-platform** — Windows, macOS, and Linux installers.
- 🎨 **Multiple project templates** — blank, to-do app, dashboard, and more.

**Known Issues:**

- macOS distribution is paused due to Apple code signing certificate costs
  (see [Installation](./installation.md#macos) for building from source).
- Windows SmartScreen may flag the unsigned `.msi` installer.
- Linux AppImage requires FUSE to be installed.

---

## v1.0.1 — Patch Release — 2026-06-19

**Changes:**

- 🎨 **Refined language selection UI** — replaced homage-style intro rotation
  with paired title/subtitle that cycle together (e.g., "Choose your language"
  / "You can change it later. It's easier than life choices.").
- 🗑️ **Removed unused `intros` field** from language entries — simplifies the
  data model and reduces bundle size.
- 🔧 **Added `models.dev` to CSP allowlist** — enables connectivity to new AI
  provider endpoints.
- ✅ **Tests updated** — 520 tests passing (all existing + new coverage for
  `languageSelectSubtitles`).

---


## v1.0.0 — Web-Only Release — 2026-06-19

**Highlights:**

- 🏗️ **Complete migration from Tauri desktop to pure web application** —
  DeskSpawn now runs entirely in the browser. No more native installers.
- 🧠 **Web-native engine** — browser-based orchestrator, providers (8 supported),
  tool execution, MCP client, retry logic, and step limits.
- 💾 **Dual-path storage** — IndexedDB + OPFS for offline-first data persistence.
- 🔬 **WebContainer preview** — run and preview generated apps directly in the
  browser via WebContainers.
- 🖥️ **New landing page** with routing system and LanguageSelect/AiConfig screens.
- 🧪 **Comprehensive test suite** — 31 test files, 519 tests covering engine,
  components, hooks, stores, and utilities.
- 🌐 **All AI providers fully supported** — OpenAI, Anthropic, Ollama, and more
  directly from the browser.
- 🗑️ **Removed dependencies** — Tauri (Rust), sidecar (Node.js), old marketing
  website.

**Breaking Changes:**

- DeskSpawn is now a web-only application. Desktop installers are no longer
  provided.
- Local SQLite database replaced with IndexedDB. Migrate projects manually if
  needed.
- Sidecar-based AI runtime replaced with a browser-native engine — no
  additional process required.

---

## Future Releases

Check the [GitHub Releases page](https://github.com/shira022/deskspawn/releases)
for the latest updates, including patch notes, new features, and bug fixes.
