<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/DeskSpawn-AI%20App%20Development-8b5cf6?style=for-the-badge&labelColor=1e1b4b">
    <img src="https://img.shields.io/badge/DeskSpawn-AI%20App%20Development-8b5cf6?style=for-the-badge&labelColor=ede9fe" alt="DeskSpawn">
  </picture>
</p>

<p align="center">
  <b>AI-powered app development platform</b> — Describe your app in natural language, and DeskSpawn builds it as real files on disk with a live local preview. Desktop-first, privacy-first.
</p>

<p align="center">
  <a href="https://deskspawn.pages.dev">
    <img src="https://img.shields.io/badge/Try%20in%20Browser-Cloudflare%20Pages-380d9f?style=flat-square&logo=cloudflare&logoColor=white" alt="Try in Browser">
  </a>
  <a href="https://github.com/shira022/deskspawn/releases">
    <img src="https://img.shields.io/github/v/release/shira022/deskspawn?style=flat-square&label=Release" alt="Release">
  </a>
  <a href="https://github.com/shira022/deskspawn/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/shira022/deskspawn/ci.yml?style=flat-square&label=CI" alt="CI">
  </a>
  <a href="https://github.com/shira022/deskspawn/actions/workflows/codeql.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/shira022/deskspawn/codeql.yml?style=flat-square&label=CodeQL" alt="CodeQL">
  </a>
  <a href="https://github.com/shira022/deskspawn/stargazers">
    <img src="https://img.shields.io/github/stars/shira022/deskspawn?style=flat-square&label=Stars" alt="Stars">
  </a>
  <a href="https://github.com/shira022/deskspawn/forks">
    <img src="https://img.shields.io/github/forks/shira022/deskspawn?style=flat-square&label=Forks" alt="Forks">
  </a>
  <a href="https://agentskills.io">
    <img src="https://img.shields.io/badge/agentskills.io-compatible-8b5cf6?style=flat-square" alt="agentskills.io">
  </a>
  <a href="https://github.com/shira022/deskspawn/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License">
  </a>
</p>

---

## What is DeskSpawn?

DeskSpawn is an **AI-powered app development platform** that runs as a
**native desktop app** (Windows). Describe an app in natural language, and a
**multi-agent AI pipeline** plans, writes, verifies, and iterates on the code.
The result is saved as **real files on disk** and shown in a **fully local
live preview** — no cloud runtime, no data leaving your machine.

A **browser demo** is available for evaluation: try the core experience
without installing anything, then install the desktop app for real work.

### Use Cases

- **Rapid prototyping**: go from idea to working app in minutes
- **Full-stack apps**: generate React + Hono + SQLite apps with a real database
- **Iteration**: describe changes in natural language, watch the code update live
- **Learning**: see how AI builds apps step by step

---

## ✨ Features

- **🖥️ Desktop App (main)** — native Windows app (Tauri v2); the browser demo is for evaluation only
- **📁 Real Files on Disk** — generated apps live at `~/deskspawn/apps/`, editable in any editor, backup by folder copy
- **⚡ Fully Local Preview** — the sidecar starts a local Vite dev server on your real files; works offline
- **🔑 OS Keychain Protection** — API keys are stored in the Windows Credential Manager, never in app files
- **🗄️ Full-Stack Generation** — optional React + Hono + bun:sqlite template with a real database (ADR-010)
- **🧪 Automated Quality Loop** — generated apps ship with tests; the AI runs them and fixes until green (ADR-012)
- **🤖 Multi-Agent Pipeline** — Triage → Planner → Coder → Verifier → Visual QA agents collaborate
- **🔌 Multi-Provider AI** — OpenAI, Anthropic Claude, Google Gemini, AWS Bedrock, Azure OpenAI, GCP Vertex AI, Ollama, and any OpenAI-compatible endpoint
- **🌐 i18n** — English and Japanese interfaces

---

## Desktop vs Web

| | **Desktop App** | **Web Demo** |
|---|---|---|
| **Position** | Main product | Evaluation only |
| **Install** | MSI/NSIS installer (GitHub Releases) | None — open in browser |
| **Storage** | Real files + SQLite (`~/deskspawn/`) | IndexedDB/OPFS (browser) |
| **API keys** | OS keychain | Browser storage (less secure) |
| **Preview** | Local Vite (offline-capable) | WebContainer (Chromium only) |
| **Full-stack apps** | ✅ (Hono + SQLite) | ❌ |
| **OS** | Windows 10/11 | Chrome 105+ / Edge 105+ |

> ⚠️ The web version stores data in the browser and is **not** recommended for
> serious work. Use the desktop app.

---

## 🚀 Quick Start

### Desktop App (recommended)

1. Download the installer from **[GitHub Releases](https://github.com/shira022/deskspawn/releases)**.
2. Run the installer (Windows 10/11, WebView2 preinstalled).
3. On first launch, select your language and enter an AI provider API key
   (stored in the OS keychain — never sent to any server beyond your provider).
4. Click **+ New App**, describe what you want to build, and watch it appear
   in the local preview.

### Web Demo (evaluation)

Visit **[deskspawn.pages.dev](https://deskspawn.pages.dev)**, configure a
provider, and try generating an app in your browser.

---

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (`corepack enable` or `npm install -g pnpm`)
- For the desktop app: [Rust](https://rustup.rs/) (MSVC toolchain) + VS Build Tools on Windows

### Setup

```bash
git clone https://github.com/shira022/deskspawn.git
cd deskspawn
pnpm install
```

### Commands

| Command | Description |
|---|---|
| `pnpm dev` | Web dev server (http://localhost:5173) |
| `pnpm --filter web build` | TypeScript check + web production build |
| `pnpm --filter web test` | Unit tests (Vitest) |
| `pnpm --filter web test:ui` | UI component tests |
| `pnpm --filter web lint` | ESLint |
| `pnpm --filter desktop tauri dev` | Desktop app (dev mode) |
| `pnpm --filter desktop build` | Frontend build for the desktop app |
| `pnpm test:e2e` | Playwright end-to-end tests — ⚠️ **deletes real app data** (dev-environment only; see CONTRIBUTING "E2E modes") |
| `pnpm test:e2e:real` | Real-API E2E (needs `DESKSPAWN_API_KEY` + `DESKSPAWN_E2E_REAL=1` in `.env`). ⚠️ **Developer's own responsibility** — real key + cost + OS keychain save, key delete is on you. Auto-disables trace & cleans test-results. See docs/user-flow-spec.md "Real-API E2E". |

### Project Structure

```
deskspawn/                          # pnpm workspace root
├── apps/
│   ├── web/                        # Web demo (Cloudflare Pages) — thin entry over packages/shared
│   │   ├── src/                    # Web-only entry: main.tsx, App.tsx, index.css, routes/, test/
│   │   ├── public/                 # Static assets + _headers
│   └── desktop/                    # Tauri v2 desktop app — thin wrapper over packages/shared
│       ├── src/                    # Entry point + platform services only (5 files)
│       ├── src-tauri/              # Rust backend (storage, sidecar, IPC)
│       └── sidecar/                # Bun-bundled Node server (AI proxy, preview, MCP)
├── packages/
│   ├── shared/                     # ⭐ Shared app code (see "Who uses what" below)
│   │   └── src/                    # engine/ hooks/ lib/ store/ components/ locales/ types/
│   ├── ui/                         # Shared UI primitives
│   ├── ai-core/                    # Shared AI pipeline types
│   └── config/                     # Shared TS config
├── docs/                           # Documentation + ADRs
└── pnpm-workspace.yaml
```

#### Who uses what (read this before editing)

| Concern | Where it lives | Notes |
|---|---|---|
| **UI & AI chat flow** | `packages/shared/src/**` | The single source of truth. Both `apps/web` and `apps/desktop` import it directly via the `@deskspawn/shared` alias. Do NOT edit code under `apps/web/src` (except `main.tsx`/`App.tsx`/`routes/`) to fix shared UI/AI logic — edit `packages/shared/src`. |
| Web entry + routing | `apps/web/src/` | Only `main.tsx`, `App.tsx`, `index.css`, `routes/`, `test/`. Everything else lives in `packages/shared`. |
| Desktop entry + IPC | `apps/desktop/src/` | Only 5 files: `main.tsx` (sets `__DESKSPAWN_DESKTOP__` flag), `App.tsx`, `lib/ipc.ts` (Tauri bridge — `getSidecarPort` is the only live wrapper), `lib/services.ts`. |
| Rust backend | `apps/desktop/src-tauri/` | Storage, sidecar lifecycle, security server. |
| Standalone AI server | `apps/desktop/sidecar/` | Bun-bundled Node server: OpenAI-compatible `/v1` proxy (CORS workaround), preview server, checkpoint & chat-history storage. The AI chat engine itself lives in `packages/shared` (legacy sidecar engine was removed in the 2026-08 audit). |
| Model resolution (OpenAI/Anthropic/etc.) | `packages/shared/src/engine/providers.ts` | **The single source of truth** for which API each provider uses. |
| Shared primitives | `packages/ui`, `packages/ai-core` | True shared packages (not aliased). |

> 💡 **Rule of thumb:** if it's UI, chat, or AI provider logic, it lives in
> `packages/shared/src` and is imported by both apps via the `@deskspawn/shared`
> alias. `apps/web/src` and `apps/desktop/src` only contain platform entry &
> glue code.

---

## 🔒 Security

- **Desktop**: API keys live in the **OS keychain**; AI requests go through the
  local sidecar proxy; app data is local files under `~/deskspawn/`.
- **Web demo**: keys and data live in IndexedDB — **evaluation only**. A
  warning is shown in the UI and on the landing page.
- Generated apps run in a sandboxed/isolated preview; the web preview uses an
  iframe sandbox + CSP.

See [SECURITY.md](SECURITY.md) for the coordinated disclosure process.

---

## 🧩 Tech Stack

| Layer | Technology |
|---|---|
| **Desktop Shell** | Tauri v2 (Rust) |
| **UI Framework** | React 18 + TypeScript |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS v4 |
| **State Management** | Zustand |
| **AI SDK** | Vercel AI SDK (in sidecar) |
| **Sidecar Engine** | Node/Bun (bundled, ADR-011) |
| **Preview** | Local Vite (desktop) / WebContainer (web) |
| **Storage** | Real files + SQLite (desktop) / IndexedDB (web) |
| **Internationalization** | i18next + react-i18next |
| **Testing** | Vitest + Testing Library + Playwright (E2E) + Rust tests |

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for
guidelines, branch strategy, and code style.

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 📄 License

[MIT](LICENSE) © DeskSpawn

---

## 🇯🇵 日本語

**DeskSpawn** は AI によるアプリ開発プラットフォームです。チャットで作りたいアプリを
伝えると、AI がコードを生成し、実ファイルとして `~/deskspawn/apps/` に保存して、
ローカルプレビューで即確認できます。**デスクトップアプリが本編**で、Web版は体験用
デモです。APIキーは OS キーチェーンに保存され、データはあなたの PC から出ません。

- 📥 ダウンロード: [GitHub Releases](https://github.com/shira022/deskspawn/releases)
- 🌐 ブラウザで試す: [deskspawn.pages.dev](https://deskspawn.pages.dev)
- 📖 ドキュメント: [Getting Started](docs/getting-started.md) / [Installation](docs/installation.md) / [Spec](docs/spec.md)

**開発者向けメモ（コード構成）:** UI・チャット・AIプロバイダー解決の実体は
`packages/shared/src/` にあり、**Web 版もデスクトップアプリも同じコードを
`@deskspawn/shared` alias 経由で import しています**。共有UIやAIロジックを
直したい場合は `apps/web/src` や `apps/desktop/src` ではなく
`packages/shared/src` を編集してください。`apps/web/src` は Web 専用の
エントリ（main.tsx・App.tsx・routes）だけ、`apps/desktop/src` はデスクトップの
エントリとWindows固有のサービス登録（5ファイル）だけです。詳細は README の
**Project Structure** を参照。
