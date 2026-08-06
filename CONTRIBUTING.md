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
