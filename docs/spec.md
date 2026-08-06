# DeskSpawn Specification

> Current as of **v0.4.x** (desktop-first monorepo). For historical decisions,
> see [docs/adr/](./adr/).

## Product Definition

DeskSpawn is an open-source, AI-powered **app development platform**.
A user describes an app in natural language; a multi-agent AI pipeline plans,
writes, verifies, and iterates on the code; and the result is shown in a live
preview. The **desktop app is the main product**; a browser version exists as
an evaluation demo.

---

## 1. Architecture Overview

pnpm monorepo with three layers:

```
deskspawn/
├── apps/
│   ├── web/                       # Web demo (Vite + React, Cloudflare Pages)
│   └── desktop/                   # Tauri v2 desktop app (Windows)
│       ├── src/                   # Thin entry + platform services
│       ├── src-tauri/             # Rust backend (storage, sidecar mgmt, IPC)
│       └── sidecar/               # Node/Bun AI engine (local preview + AI proxy)
├── packages/
│   ├── ui/                        # Shared UI primitives
│   ├── ai-core/                   # Shared types & service interfaces
│   └── config/                    # Shared tsconfig
└── docs/
```

### Desktop app (main)

- **Shell**: Tauri v2 (Rust)
- **Frontend**: Vite + React 18 + TypeScript
- **Shared UI**: the desktop imports the web app's components directly via a
  `@/*` alias → `apps/web/src/*` (true code sharing; only platform-specific
  parts are branched via `isDesktopEnv()`)
- **AI engine**: a local **sidecar** (bundled with Bun, ADR-011) runs the
  multi-agent pipeline and proxies AI API calls (CORS fix, ADR-003)
- **Storage**: real files on disk + SQLite (ADR-007/008/009)
- **Preview**: local Vite dev server started by the sidecar on the real app
  directory (fully offline, ADR-008)

### Web version (evaluation)

- Same shared component tree, but storage uses **IndexedDB/OPFS** and preview
  uses **WebContainer** (cloud-free but requires Chromium + cross-origin
  isolation). Marked as evaluation-only in the UI.

---

## 2. Storage

### Desktop (`~/deskspawn/`)

```
~/deskspawn/
├── apps/                 # generated apps — real files on disk
│   └── <app-id>/
│       ├── src/          # editable source
│       └── .deskspawn/
│           └── chat.db   # per-app chat history (SQLite, Rust-managed)
├── apps.json             # app registry (JSON)
├── config/               # settings, AI provider config (keys → OS keychain)
├── templates/            # bundled app templates
└── tools/                # sidecar tooling (bun, etc.)
```

- **Hybrid management data** (ADR-009): app list/settings in JSON,
  per-app chat history in SQLite (`chat_messages.app_id`, `app_id TEXT`).
- **API keys**: OS keychain (Windows Credential Manager) via Rust IPC.
- **Web version**: IndexedDB/OPFS for apps + API keys (evaluation only).

---

## 3. Generated App Templates

### Web (both platforms)

Fixed stack for maximum generation accuracy:

| Layer | Technology |
|---|---|
| Frontend | Vite + React 18 + TypeScript |
| UI | Tailwind CSS v4 + lucide-react |
| State | Zustand |
| Persistence | IndexedDB via `src/lib/storage` (auto-generated wrapper) |
| App identity | `src/lib/app-id.ts` (injected `__DESKSPAWN_APP_ID__`) |

### Desktop full-stack (ADR-010)

Additional option: **React + Hono + bun:sqlite** with a `DATABASE_URL`
abstraction and automatic port fallback (4174 → +10).

---

## 4. Preview

| Platform | Engine | Notes |
|---|---|---|
| Web | WebContainer | sandboxed Node, needs Chromium + COOP/COEP |
| Desktop | local Vite via sidecar | runs on the real app directory, fully offline |

The preview manager is a lazy Proxy singleton (`lib/preview/index.ts`) that
picks the platform implementation on first access. The shared `PreviewPanel`
branches only the platform-specific bits (badge, open-in-browser).

---

## 5. AI Pipeline

Multi-agent pipeline (triage → planner → coder → verifier → visual QA) with:

- **Multi-provider**: OpenAI, Anthropic, Gemini, Bedrock, Azure, Vertex,
  Ollama, any OpenAI-compatible endpoint
- **Desktop proxy**: custom/self-hosted endpoints go through the sidecar
  (`/v1` proxy with `x-upstream` header) to avoid CORS failures (ADR-003)
- **Quality loop** (ADR-012): generated apps ship with tests; the coder agent
  runs them and fixes until green
- **Step limits & retries**: rate-limit detection with exponential backoff

---

## 6. Security

- Desktop: API keys in **OS keychain**; app data is local files; AI calls go
  through the local sidecar proxy (keys never sent to external servers
  directly)
- Web: keys in IndexedDB — **evaluation only** (warning shown in UI)
- CSP and connect-src documented for the web deployment
- ADRs must never contain personal information (privacy rule)

---

## 7. Versioning

**Single-version policy**: root, web, desktop, sidecar, packages/*,
`tauri.conf.json`, and `Cargo.toml` share one version.
`scripts/check-versions.mjs` verifies consistency; `scripts/set-version.py`
bumps every location. 4-part versions are not allowed (Tauri updater
compatibility).

---

## 🇯🇵 日本語

DeskSpawn は**デスクトップアプリをメイン**とした AI アプリ開発プラットフォーム。
チャットでアプリを記述すると、マルチエージェントパイプラインが設計・実装・検証し、
ローカルプレビューで即確認できる。生成物は `~/deskspawn/apps/` の**実ファイル**
として保存され、APIキーは OS キーチェーンに保管される。Web版は体験用デモ
（IndexedDB 保存・評価目的のみ）。詳細な決定履歴は [docs/adr/](./adr/) を参照。
