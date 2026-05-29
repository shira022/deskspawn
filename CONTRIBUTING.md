# Contributing to DeskSpawn

Thank you for your interest in contributing to DeskSpawn!

## Getting Started

### Prerequisites

- **Node.js** 20+
- **Rust** (stable toolchain)
- **npm** (for frontend dependencies)
- **Cargo** (for Rust dependencies)

### System Dependencies

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update && sudo apt-get install -y \
  libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libsqlite3-dev
```

**Windows:**
- [SQLite](https://www.sqlite.org/download.html) (for `sqlx`)
- [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

**macOS:**
```bash
xcode-select --install
```

### Setup

```bash
# Clone the repository
git clone https://github.com/shira022/deskspawn.git
cd deskspawn

# Install frontend dependencies
npm ci

# Build and run in development mode
npm run tauri dev
```

### Development Workflow

```bash
# Frontend dev server (Vite)
npm run dev

# Backend type checking
cargo check --manifest-path src-tauri/Cargo.toml

# Run all checks
npm run build          # Frontend build
cargo build            # Backend build
npx tsc --noEmit       # TypeScript type check
cargo clippy -- -D warnings  # Rust linter
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
| `feature/` | New features | `feature/harness-engine` |
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
- `docs: update API reference for Tauri commands`

## Pull Request Process

1. Create a branch from `develop` using the naming convention above
2. Implement your changes following existing code patterns
3. Ensure all checks pass locally:
   ```bash
   npx tsc --noEmit && cargo check
   npx vitest run && cargo test
   npm run build && cargo build
   ```
4. Push your branch and open a PR targeting `develop`
5. CI will automatically run lint, typecheck, test, and build
6. Once CI passes, the PR will be merged

## Code Style

### TypeScript / React
- Follow existing patterns in `src/`
- Use TypeScript strict mode (no `any` unless necessary)
- Components use functional style with hooks
- UI components follow shadcn/ui conventions (Tailwind CSS)

### Rust
- Follow standard Rust conventions (`cargo clippy`)
- No `unsafe` code
- No direct filesystem writes outside designated paths
- Use `anyhow` / `thiserror` for error handling

## Security Policy

Please review [SECURITY.md](SECURITY.md) for our security policy and vulnerability reporting process.

### Code Security Rules
- No `eval()`, `new Function()`, or `innerHTML` with variable input in TypeScript
- No `unsafe{}`, `std::process::Command`, raw `std::fs` writes, or `std::net` in Rust
- API keys are stored via OS keychain, never in plaintext config
- New dependencies outside the allowed list require approval

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).
