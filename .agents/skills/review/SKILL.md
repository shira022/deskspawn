# review — Multi-Perspective Code Review

> **Context Note**: These skills govern DeskSpawn (the tool) development — a Tauri v2 + React + TypeScript app. They **do not** apply to the generated web apps (which are pure Vite + React + TypeScript, no Rust/Tauri). Code generation for user apps is handled by the sidecar AI system prompt, not these skills.
>

## Purpose

Conduct a thorough, multi-dimensional code review in a separate session. Evaluate code from security, architecture, performance, correctness, and UI/UX perspectives. Produce an actionable, structured review report.

## Critical: Separate Session Requirement

This skill MUST be loaded in a session that had NO involvement in the implementation. A fresh session provides a fresh, unbiased perspective. The review agent must not have written the code it reviews.

## Trigger

- Verification report shows `overall: pass` at `.agents/artifacts/verify-report-<slug>.json`
- A PR from `<type>/*` to `develop` is open and ready for review
- A previous review's fixes have been applied and re-verified (re-review)

## Pre-flight

1. Read the verification report: `.agents/artifacts/verify-report-<slug>.json`
2. Read the plan artifact for context: `.agents/artifacts/plan-<slug>.json`
3. Checkout the feature branch or read the PR diff
4. Identify which files changed and their layer/component

## Review Dimensions

Execute the following 5 dimensions. Each MAY run in parallel as separate sub-agent sessions to maximize throughput and objectivity.

### Dimension 1: Security

Check for:

- **Shell command injection**: Any user input reaching shell execution? Commands validated against the allowed list (`npm`, `npx`, `cargo`, `sqlx` only)?
- **Path traversal**: Any `../` or absolute paths in file operations? All paths within workspace?
- **Forbidden Rust APIs**: `unsafe{}`, `std::process::Command`, `std::fs` (write), `std::net::*`, `tokio::spawn`, `std::mem::transmute`, `libc::*`
- **Forbidden TypeScript APIs**: `eval()`, `new Function()`, `document.write()`, `innerHTML` with variable input, unrestricted `fetch()`
- **Secret exposure**: API keys, tokens, credentials in code, logs, or artifacts?
- **Input validation**: Are all user inputs validated and sanitized? SQL injection prevention (sqlx parameterized queries)?
- **Dependency safety**: New dependencies in the allowed package list? Lockfile (`package-lock.json`, `Cargo.lock`) properly updated? Versions pinned (no `^`/`~`)?
- **AST Guard compliance**: Does Layer 2 code (`custom/`) pass all security policy checks?
- **Keychain usage**: API keys stored via OS keychain, never in plaintext config files?

### Dimension 2: Architecture

Check for:

- **Layer boundaries**: Frontend (`src/`) ↔ Backend (`src-tauri/`). Node sidecar only does AI inference. Rust backend handles all I/O.
- **Generated code protection**: `src-tauri/src/generated/` and `src/hooks/` not edited (Layer 1, read-only)
- **IPC correctness**: Tauri `invoke()` calls properly typed? Commands registered in `lib.rs`? State management correct?
- **Data flow integrity**: User action → React state → `invoke()` → Tauri command → sqlx → SQLite. Clean and traceable?
- **Module coupling**: New modules appropriately decoupled? Any circular dependencies? Clear responsibility boundaries?
- **Pattern consistency**: Does new code follow existing architectural patterns, or does it introduce a new one that needs justification?
- **Sidecar separation**: Node.js sidecar process performs AI inference only; does not touch filesystem or execute commands

### Dimension 3: Performance

Check for:

- **N+1 queries**: Database calls inside loops? Batch queries where possible?
- **Unnecessary re-renders**: React `useMemo`/`useCallback` where appropriate? `React.memo` for expensive components?
- **Large payloads**: Database queries returning excessive data? Pagination needed? Column selection vs `SELECT *`?
- **Memory leaks**: Uncleaned subscriptions? Missing `useEffect` cleanup? Uncleared intervals/timeouts?
- **Blocking operations**: Async where appropriate? No blocking calls in async Rust contexts?
- **Build size**: New dependencies significantly increase bundle or binary size? Tree-shaking effective?

### Dimension 4: Correctness

Check for:

- **Logic errors**: Edge cases handled? Null/undefined checked? Empty collections handled?
- **Type safety**: Any `any` types that should be concrete? Unsafe type assertions? Missing null checks?
- **Error handling**: All fallible operations have proper error handling? User-friendly error messages via `Err(String)` in Tauri commands?
- **Race conditions**: Concurrent operations properly sequenced? Loading/empty/error states all represented?
- **SQL correctness**: Migrations idempotent? Queries match schema? Transactions where multiple writes are needed?
- **Test coverage**: New features adequately tested? Edge cases covered? Existing tests not broken?
- **State consistency**: React state stays in sync with backend? Optimistic updates rolled back on failure?

### Dimension 5: UI/UX

(Applicable when frontend files changed: `src/`)

Check for:

- **Responsive layout**: Works in both 2-pane and 3-pane modes? Doesn't break at narrow widths?
- **Loading states**: Loading indicators during async operations? Skeleton screens or spinners?
- **Error states**: Errors displayed gracefully with actionable messages? Not raw stack traces?
- **Empty states**: Meaningful empty state displayed when no data exists? Not blank screen?
- **Accessibility**: Keyboard navigation possible? Focus management? Screen reader labels (`aria-*`)? Color contrast adequate?
- **Consistency**: Matches shadcn/ui patterns? Uses existing component variants? Follows the design system?
- **User feedback**: Actions confirmed (toast, status bar)? Destructive actions have confirmation?
- **Visual polish**: Alignment, spacing, typography consistent? No layout shift on load?

## Output: Review Report

Write to `.agents/artifacts/review-report-<slug>.json`:

```jsonc
{
  "plan_id": "plan-<slug>",
  "branch": "<prefix>/<slug>",
  "timestamp": "ISO8601",
  "overall": "approved|changes_requested",
  "dimensions": {
    "security": {
      "status": "pass|fail|warning",
      "issues": [
        {
          "severity": "critical|high|medium|low|info",
          "file": "relative/path",
          "line": 42,
          "description": "What the issue is",
          "recommendation": "How to fix it"
        }
      ]
    },
    "architecture": { "status": "...", "issues": [...] },
    "performance": { "status": "...", "issues": [...] },
    "correctness": { "status": "...", "issues": [...] },
    "ui_ux": { "status": "...", "issues": [...] }
  },
  "summary": "Brief summary for human consumption",
  "risks": ["Any risks that need human attention even if review passes"]
}
```

## Outcome

- **Approved** (`overall: approved`): No issues, or only `low`/`info` severity issues. Ready for merge to `develop`.
- **Changes Requested** (`overall: changes_requested`): At least one issue at `medium` or higher severity. Routes to `fix` skill.

### Severity Rules

| Severity | Blocks Merge? | Examples |
|----------|---------------|---------|
| `critical` | ✅ Yes | Security vulnerability, data loss or corruption risk |
| `high` | ✅ Yes | Architecture violation, broken core feature, data integrity |
| `medium` | ✅ Yes | Performance regression, missing error handling, test gap |
| `low` | ❌ No | Style nit, minor refactor suggestion, optional improvement |
| `info` | ❌ No | Educational note, future consideration, non-blocking observation |

## Rules

- Review in a SEPARATE session. Never review code you wrote or were involved in implementing.
- Be objective and specific. Every issue must have a file path and line number where possible.
- Do not gate-keep unnecessarily — if the code is safe, works, and follows patterns, approve it.
- When in doubt about severity, default to `medium` and let the Orchestrator or human decide.
- The review report must be actionable — every `changes_requested` item must describe a fixable concern.
- If the diff is large (>500 lines), focus on high-risk areas (security, data flow, new patterns) rather than line-by-line.
- Do not let perfection block progress — `low` severity issues should not delay merge.
