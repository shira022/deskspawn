# Contributing to DeskSpawn

Thank you for your interest in contributing to DeskSpawn!

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** (`corepack enable` or `npm install -g pnpm`)
- **Rust** (MSVC toolchain) + **VS Build Tools** — only needed for the desktop app (Tauri)

### Setup

```bash
# Clone the repository
git clone https://github.com/shira022/deskspawn.git
cd deskspawn

# Install dependencies
pnpm install
```

### Development Workflow

```bash
# Web app dev server (Vite) — http://localhost:5173
pnpm dev

# Desktop app (Tauri dev mode)
pnpm --filter desktop tauri dev

# TypeScript type check (web)
pnpm --filter web exec tsc -b --noEmit

# TypeScript type check (desktop)
pnpm --filter desktop exec tsc --noEmit

# Run unit tests
pnpm --filter web test

# Run UI component tests
pnpm --filter web test:ui

# Run Rust tests (desktop backend)
cd apps/desktop/src-tauri && cargo test

# Lint
pnpm --filter web lint

# Build for production (web)
pnpm --filter web build

# End-to-end tests
pnpm test:e2e
```

#### E2E modes (e2e/desktop.spec.ts)

> ⚠️ **WARNING: `pnpm test:e2e` deletes real data.** The suite runs the Rust
> command `reset_app_data` in `beforeAll`/`afterAll`, which wipes the app
> registry (`apps/apps.json`), generated app dirs (`apps/app-*` incl. chat
> DBs/checkpoints), and UI settings (language/theme/…) on the machine where
> the app under test stores its data. API keys (OS keychain) and AI provider
> config are **kept**.
>
> **Dev environment only.** The command refuses to run unless the environment
> variable `DESKSPAWN_TEST_RESET=1` is set (anti-footgun). Never run the
> desktop E2E on a machine whose real DeskSpawn data matters to you. See
> `docs/user-flow-spec.md` ("Development-only reset") for details.
>
> ⚠️ **Keychain isolation.** E2E `beforeAll` refuses to run unless the app was
> launched with `DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e`. This makes
> test 02's dummy-key save land in a **separate** OS keychain service instead
> of the production `com.deskspawn` — so your real API keys are never
> overwritten. Launch the app under test with:
> ```powershell
> $env:DESKSPAWN_KEYCHAIN_SERVICE="com.deskspawn.e2e"; $env:DESKSPAWN_TEST_RESET="1"
> & "C:\path\to\deskspawn-desktop.exe"
> ```

The desktop E2E suite runs in two modes — both default to safe values, so you can run it without any API key:

| Mode | When | What it verifies |
|------|------|------------------|
| **Dummy** (default) | No env vars set | AI config flow (save → toolbar reflects model) using a fake endpoint/key. Model list fetch fails → manual-input path is exercised. |
| **Real API** | `DESKSPAWN_E2E_REAL=1` + `DESKSPAWN_API_KEY` | Real provider connection: model list from `/models`, real chat response. |

All settings are injected via environment variables (no provider/model is hardcoded):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DESKSPAWN_E2E_PROVIDER` | `custom` | Provider ID (`custom`, `openai`, `anthropic`, `ollama`, `azure-openai`, `amazon-bedrock`, …) |
| `DESKSPAWN_E2E_ENDPOINT` | `http://127.0.0.1:9/v1` | Endpoint URL (custom/anthropic/azure/ollama) — discard port, intentionally unreachable |
| `DESKSPAWN_E2E_MODEL` | `e2e-model` | Model ID to save |
| `DESKSPAWN_E2E_REGION` | `us-east-1` | AWS region (amazon-bedrock only) |
| `DESKSPAWN_API_KEY` | *(none)* | Real API key (real-API mode only) |
| `DESKSPAWN_E2E_REAL` | *(unset)* | Set to `1` to enable real-API verification |
| `CDP_URL` | `http://172.28.208.1:9222` | WebView2 CDP endpoint |

Real-API example:

```bash
DESKSPAWN_E2E_PROVIDER=custom \
DESKSPAWN_E2E_ENDPOINT=https://api.example.com/v1 \
DESKSPAWN_E2E_MODEL=my-model \
DESKSPAWN_API_KEY=sk-... \
DESKSPAWN_E2E_REAL=1 \
pnpm test:e2e
```

> **Never hardcode API keys in test files.** Keys are read from the environment only.

> ⚠️ **Real-API E2E is the developer's own responsibility.** It uses a real
> API key, incurs real cost, and stores the key in the **OS keychain** (same
> path as production). The developer is responsible for saving **and deleting**
> the key. Recommended guardrails:
> - Use a **rate-limited / low-quota key**, never a production key. Cap cost
>   (small model, max tokens, one generation only).
> - Keep the key out of shell history: use the gitignored `.env` file
>   (`cp .env.example .env`, then `set -a; source .env; set +a`).
> - **CI must never run real-API E2E** — dummy mode only (`DESKSPAWN_E2E_REAL` unset).
>
> **Leak-mitigation is automatic:** `playwright.config.ts` disables trace when
> `DESKSPAWN_E2E_REAL=1`, and `pnpm test:e2e:real` cleans `test-results/` and
> `playwright-report/` afterwards. credentials.json (file fallback) only ever
> lives under the user profile.
>
> Prefer `pnpm test:e2e:real` (desktop-only + cleanup) over the raw command
> above, since `pnpm test:e2e` also targets the web suite which needs a live
> CDP server.

## Branch Strategy

We use a 3-branch GitFlow:

```
main        Protected. PR from develop only. Human approval required.
  ↑
develop     Open. Merge feature/fix/docs/refactor/chore PRs here.
  ↑
<type>/*    Implementation branches. Created per task.
```

### Branch Naming

| Prefix | Use Case | Example |
|--------|----------|---------|
| `feature/` | New features | `feature/export-zip` |
| `fix/` | Bug fixes | `fix/hmr-reload-race` |
| `docs/` | Documentation | `docs/api-reference` |
| `refactor/` | Code restructuring | `refactor/extract-db-layer` |
| `chore/` | Maintenance, tooling, CI | `chore/update-deps` |

### Merge Rules

| Source → Target | Authority | Conditions |
|-----------------|-----------|------------|
| `<type>/*` → `develop` | Automated | PR created, CI passes |
| `develop` → `main` | Human only | Full verification passes, human approves |

## Commit Convention

```
<type>: <description>
```

Where type ∈ {feat, fix, docs, refactor, test, chore}

Examples:
- `feat: add AI-generated app preview pane`
- `fix: resolve HMR race condition on config change`
- `docs: update README with deployment guide`

## Pull Request Process

1. Create a branch from `develop` using the naming convention above
2. Implement your changes following existing code patterns
3. Ensure all checks pass locally:
   ```bash
   pnpm --filter web exec tsc -b --noEmit
   pnpm --filter desktop exec tsc --noEmit
   pnpm --filter web test
   pnpm --filter web test:ui
   pnpm --filter web build
   ```
4. Push your branch and open a PR targeting `develop`
5. CI will automatically run lint, typecheck, test, and build
6. Once CI passes, the PR will be merged

## Code Style

### TypeScript / React

- Follow existing patterns in `apps/web/src/`
- Use TypeScript strict mode (no `any` unless necessary)
- Components use functional style with hooks
- UI components follow shadcn/ui conventions (Tailwind CSS v4)
- Use the `@/` path alias for imports from `apps/web/src/`
- **UI sharing rule**: the desktop app imports web components via the `@`
  alias. Do NOT duplicate components — branch only platform-specific parts
  (via `isDesktopEnv()` and per-platform i18n keys).

### Rust

- Follow existing patterns in `apps/desktop/src-tauri/src/`
- Run `cargo fmt` before committing
- Add tests for storage/workspace logic in the same file (as `#[cfg(test)]`)

## Security Policy

Please review [SECURITY.md](SECURITY.md) for our security policy and vulnerability reporting process.

### Code Security Rules

- No `eval()`, `new Function()`, or `innerHTML` with variable input
- API keys must never be logged or sent to unintended endpoints
- Desktop: use the OS keychain via Rust IPC for secrets; web: use the storage
  layer (IndexedDB/OPFS) — web is evaluation-only
- Library dependencies should be approved in PR review
- All `connect-src` endpoints must be documented for CSP maintenance
- ADRs must never contain personal information (real paths, API keys, tokens)

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).
