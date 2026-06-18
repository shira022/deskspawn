# verify — Local Verification Pipeline

> **Context Note**: These skills govern DeskSpawn (the tool) development — a Tauri v2 + React + TypeScript app. They **do not** apply to the generated web apps (which are pure Vite + React + TypeScript, no Rust/Tauri). Code generation for user apps is handled by the sidecar AI system prompt, not these skills.
>

## Purpose

Run a comprehensive local verification pipeline to ensure code quality before review and merge. Catch issues early and produce an actionable, machine-readable report.

## Trigger

- Implementation is complete (all tasks in plan done)
- Fixes have been applied after a review
- Any time code changes need validation before proceeding to the next phase

## Pre-flight

1. Read the plan artifact for verification scope: `.agents/artifacts/plan-<slug>.json`
2. Ensure you are on the correct feature branch
3. Verify working directory is clean (`git status` — no unintended uncommitted changes)
4. Confirm all required tools are available: `node`, `npm`, `cargo`, `rustc`

## Verification Pipeline

Run all stages. Do not stop after a failure — collect errors from every stage to build a complete picture before reporting. Failure in any stage sets `overall: fail`.

### Stage 1: Lint

```bash
# Frontend — zero tolerance for warnings
npx eslint src/ --max-warnings 0

# Backend — deny all warnings
cargo clippy -- -D warnings
```

**Pass condition**: Zero errors, zero warnings on both sides.

### Stage 2: Type Check

```bash
# Frontend — full type checking without emitting
npx tsc --noEmit

# Backend — cargo check covers type checking
cargo check
```

**Pass condition**: Compilation succeeds with no type errors.

### Stage 3: Unit Tests

```bash
# Frontend — Node-environment tests (pure logic, engine, lib)
npx vitest run

# Frontend — UI/component tests (jsdom environment)
npx vitest run --config vitest.ui.config.ts

# Frontend — Coverage (optional but recommended)
npx vitest run --coverage

# Backend
cargo test
```

**Pass condition**: All tests pass across both environments. Zero failures, zero flakes. If tests are skipped with `.skip`, flag as warning. Coverage regression (new code with lower coverage than adjacent files) should be noted.

### Stage 4: Build

```bash
# Frontend production build
npm run build

# Backend debug build (release build is covered by tauri build in Stage 6)
cargo build
```

**Pass condition**: Build succeeds with no errors. Warnings from build tools are noted but do not block.

### Stage 5: Migration Check (conditional)

Only if files under `migrations/` changed:

```bash
sqlx migrate run --database-url sqlite://dev.db
```

**Pass condition**: Migrations apply cleanly without errors. No duplicate migration versions.

### Stage 6: Tauri Build Smoke Test (conditional)

Only if `src-tauri/` files changed:

```bash
npm run tauri build -- --debug
```

**Pass condition**: Tauri bundles without errors. Skip if no Tauri-backend changes.

## Error Handling

### Collection Strategy

- Capture stdout and stderr from each command separately
- Parse error messages to extract: file path, line number, error code, message
- Group errors by file for easier fixing triage

### Severity Classification

| Severity | Definition | Action |
|----------|-----------|--------|
| `BLOCKER` | Build failure, type error, migration failure | Must fix before proceeding to review |
| `ERROR` | Lint error, test failure | Must fix before proceeding to review |
| `WARNING` | Lint warning, deprecation notice, skipped test | Note in report, does not block review |
| `INFO` | Performance hint, style suggestion | Note in report |

## Output: Verification Report

Write to `.agents/artifacts/verify-report-<slug>.json`:

```jsonc
{
  "plan_id": "plan-<slug>",
  "branch": "<prefix>/<slug>",
  "timestamp": "ISO8601",
  "overall": "pass|fail",
  "stages": {
    "lint": {
      "status": "pass|fail|skipped",
      "errors": 0,
      "warnings": 0,
      "summary": "High-level summary of lint results"
    },
    "typecheck": {
      "status": "pass|fail|skipped",
      "errors": 0,
      "summary": "High-level summary"
    },
    "test": {
      "status": "pass|fail|skipped",
      "failed": 0,
      "passed": 0,
      "summary": "High-level summary"
    },
    "build": {
      "status": "pass|fail|skipped",
      "summary": "High-level summary"
    },
    "migration": {
      "status": "pass|fail|skipped",
      "summary": "High-level summary"
    },
    "tauri_build": {
      "status": "pass|fail|skipped",
      "summary": "High-level summary"
    }
  },
  "blockers": [
    {
      "severity": "BLOCKER|ERROR",
      "file": "relative/path",
      "line": 42,
      "message": "Exact error text"
    }
  ],
  "recommendations": [
    "Actionable suggestions for fixing issues"
  ]
}
```

## Outcome

- **Pass** (`overall: pass`): Report written. Signal Orchestrator: "Verification passed. Ready for review."
- **Fail** (`overall: fail`): Report written with full blocker details. Signal Orchestrator: "Verification failed. See report." Orchestrator routes to `fix` or back to `implement`.

## Rules

- Always run ALL stages even if an early stage fails (collect complete error picture)
- Never skip a stage because it "probably passes"
- If a required tool is not installed, report it as a BLOCKER with installation instructions
- The verification report is the single source of truth for gate decisions — no verbal "it's fine" bypasses
- If the plan specifies additional verification steps beyond this pipeline, include them
- Verification runs on the feature branch by default. Integration verification on `develop` HEAD is permitted only when gating a develop→main merge (run by Orchestrator via `merge` skill).
