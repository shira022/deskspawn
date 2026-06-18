# Contributing to DeskSpawn

Thank you for your interest in contributing to DeskSpawn!

## Getting Started

### Prerequisites

- **Node.js** 20+
- **npm**

### Setup

```bash
# Clone the repository
git clone https://github.com/shira022/deskspawn.git
cd deskspawn

# Install dependencies
npm install

# Start the dev server
npm run dev
```

### Development Workflow

```bash
# Frontend dev server (Vite) — http://localhost:5173
npm run dev

# TypeScript type check
npx tsc --noEmit

# Run tests
npx vitest run

# Lint
npm run lint

# Build for production
npm run build
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
   npx tsc --noEmit
   npx vitest run
   npm run build
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
- Use the `@/` path alias for imports from `src/`

## Security Policy

Please review [SECURITY.md](SECURITY.md) for our security policy and vulnerability reporting process.

### Code Security Rules

- No `eval()`, `new Function()`, or `innerHTML` with variable input
- API keys must never be logged or sent to unintended endpoints
- Use the existing IndexedDB/OPFS storage layer for all persistent data
- Library dependencies should be approved in PR review
- All `connect-src` endpoints must be documented for CSP maintenance

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).
