# implement — Parallel Team Implementation

> **Context Note**: These skills govern DeskSpawn (the tool) development — a Tauri v2 + React + TypeScript app. They **do not** apply to the generated web apps (which are pure Vite + React + TypeScript, no Rust/Tauri). Code generation for user apps is handled by the sidecar AI system prompt, not these skills.
>

## Purpose

Execute implementation tasks in parallel across teams, working on type-prefixed branches, following the approved plan artifact. Integrate completed work back into `develop` via PR.

## Trigger

- A plan artifact exists at `.agents/artifacts/plan-<slug>.json` with `approved: true`
- The Orchestrator has assigned tasks to this agent/team

## Pre-flight

1. Read the plan artifact from `.agents/artifacts/plan-<slug>.json`
2. Identify your assigned tasks from the plan's `tasks` array
3. Confirm your team's scope and inter-team dependencies
4. Verify the base branch (`develop`) is up to date:
   ```bash
   git checkout develop && git pull origin develop
   ```

## Process

### Step 1: Branch Creation

```bash
git checkout -b <prefix>/<slug>
```

Use the `branch` field from the plan task. Example: `feature/harness-engine`, `fix/hmr-race`, `docs/api-ref`.

### Step 2: Implementation

For each assigned task:

1. **Read existing code** — understand the files you will touch and the surrounding architecture
2. **Implement the change** — follow the task `description` and `acceptance_criteria`
3. **Write tests alongside** — for every new or modified file, create or update corresponding test files. See "Test Coverage Requirements" section below.
4. **Respect layer boundaries**:
   - TypeScript/React: `src/` directory
   - Rust/Tauri: `src-tauri/` directory
   - SQL migrations: `migrations/` directory
   - Generated code: `src-tauri/src/generated/`, `src/hooks/` — **read-only, never edit** (protected by `@deskspawn:generated` markers; established by DeskSpawn's template project setup)
   - Custom code: `src-tauri/src/custom/`, `src/custom/` — edit freely, AST-guarded on apply
   - **Bootstrap note**: `generated/`, `custom/`, and `hooks/` directories do not exist until DeskSpawn's template scaffold is in place. If these directories are missing, do not create or reference them — work exclusively in `src/`, `src-tauri/src/`, and `migrations/`.
5. **Follow existing code patterns** — match naming conventions, module structure, error handling style
6. **Keep changes focused** — one task, one branch, minimal diff
7. **Respect the security policy**:
   - No `unsafe`, `std::process::Command`, `std::fs` write, `std::net` in Rust
   - No `eval()`, `new Function()`, unrestricted `fetch()` in TypeScript
   - New dependencies must be in the allowed package list
8. **Respect i18n (internationalization):** All user-facing UI strings must use the i18n system. See "i18n Patterns" below.

#### Test Coverage Requirements

Every implementation task MUST include corresponding tests. Follow these patterns:

1. **File naming** — place test files alongside source files:
   - Node/business logic tests: `src/foo/bar.ts` → `src/foo/bar.test.ts`
   - UI/component tests (jsdom): `src/foo/Bar.tsx` → `src/foo/Bar.ui.test.tsx`
   - Test helpers: `src/test/helpers/`

2. **Framework** — uses **Vitest** throughout. Default config is Node environment; UI tests use `vitest.ui.config.ts` (jsdom).

3. **Coverage expectations by layer**:

   | Layer | Target Coverage | Notes |
   |-------|----------------|-------|
   | Pure utility functions (`lib/utils`, `lib/constants`, templates) | 90%+ statements | No mocking needed; test all branches |
   | Business logic (`engine/retry`, `engine/step-limits`, `cost`) | 85%+ statements | Mock external I/O only; test edge cases |
   | I/O-dependent lib (`lib/storage`, `lib/models-fetcher`, `lib/preview`) | 70%+ statements | Heavy mocking acceptable; focus on key flows |
   | Engine/orchestrator (`engine/orchestrator`, `engine/tool-executors`) | 60%+ statements | Mock AI SDK calls; test phase flows and error paths |
   | UI components (`components/ui/*`, simple feature components) | 80%+ branches | jsdom + testing-library; test variants, states, interactions |
   | Store/hooks (`store/*`, `hooks/*`) | 70%+ statements | Mock all external deps; test state transitions and side effects |
   | Complex integration targets (`storage-opfs`, `webcontainer`) | Manual/integration | Unit tests for sync surface; async flows via integration |

4. **Mock patterns**:
   - External modules: `vi.mock("module-name", () => ({ ... }))` at file top
   - Browser APIs: `vi.stubGlobal("apiName", mockValue)` in `beforeEach`
   - AI SDK calls: Mock `@ai-sdk/*` and `ai` modules entirely
   - IndexedDB: Use `fake-indexeddb` for storage tests
   - DOM/URL: Use `vi.spyOn` (not `vi.stubGlobal`) to keep constructors intact
   - Zustand stores: Import real store, use `getState()` / `setState()` directly
   - `vi.mock` factories are hoisted — define mocks inline, never reference external variables

5. **Test structure rules**:
   - Every test file must be self-contained (no shared mutable state between files)
   - Reset mocks in `beforeEach` via `vi.clearAllMocks()` or `vi.unstubAllGlobals()`
   - Avoid `test.each` for complex cases — prefer explicit named `it()` blocks
   - Prefer `async/await` over Promise chains
   - Use `expect(result).toMatchInlineSnapshot()` for complex string outputs

6. **Verification** — before marking a task complete, run:
   ```bash
   npm test                          # Node tests
   npx vitest run --config vitest.ui.config.ts  # UI tests
   ```
   All tests MUST pass. If you add new files without tests, you MUST document why.

#### i18n Patterns

When adding or modifying UI text, follow these patterns:

1. **React components** — use the `useTranslation()` hook:
   ```tsx
   import { useTranslation } from "react-i18next";

   function MyComponent() {
     const { t } = useTranslation();
     return <div>{t('myNamespace.myKey')}</div>;
   }
   ```

2. **Non-React code** (hooks, utils) — use the `i18n` instance directly:
   ```tsx
   import i18n from "@/lib/i18n";

   export function formatError(err: Error): string {
     return i18n.t('common.errorOccurred');
   }
   ```

3. **Translation files** — add keys to ALL language files in `src/locales/`:
   - `src/locales/en/common.json` — English
   - `src/locales/ja/common.json` — 日本語
   - (plus any additional languages)

4. **Key naming** — use hierarchical namespaces matching the feature/component name:
   ```jsonc
   {
     "settings": {
       "title": "Settings",
       "theme": "Theme",
       "themeLight": "Light"
     },
     "chat": {
       "title": "Chat",
       "error": {
         "generic": "An error occurred"
       }
     }
   }
   ```

5. **Variable interpolation** — use `{{variableName}}` syntax:
   ```json
   { "greeting": "Hello, {{name}}!" }
   ```
   ```tsx
   t('greeting', { name: 'Alice' })
   ```

6. **Adding a new language** — requires two changes:
   - Create `src/locales/{code}/common.json` with all keys translated
   - Add `{ code, labelKey: "languages.{code}" }` to `src/lib/languages.ts`
   - Add the display name key (`languages.{code}`) to all existing language files

7. **Never hardcode** user-facing strings in component or utility code.

### Step 3: Dependency Coordination

- If your task depends on another team's output, check `.agents/artifacts/` for their completion signal
- If blocked, report to the Orchestrator with the blocking task ID and wait
- If unblocked, proceed independently

### Step 4: Self-Review

Before marking a task complete, verify:

- Does the code compile? (at minimum, no obvious syntax errors)
- Are all imports correct and used?
- Does it satisfy all acceptance criteria from the plan?
- Is the diff clean, minimal, and focused on the task?
- Are there any leftover debug logs, commented-out code, or TODO markers without explanation?
- **Are the corresponding test files created?** — every new `.ts`/`.tsx` file should have a test file unless it's a type-only export, barrel export, or entry point
- **Do all tests pass?** — run `npm test` and `npx vitest run --config vitest.ui.config.ts` and confirm zero failures
- **Is coverage adequate for the layer?** — see "Test Coverage Requirements" for per-layer expectations
- **Are the mocks correctly scoped?** — no shared mutable state between test files; mocks reset in `beforeEach`
- **Are edge cases tested?** — empty states, error states, loading states, boundary values, null/undefined inputs

### Step 5: Commit

```bash
git add <changed files>
git commit -m "<type>: <description>"
```

Use the commit convention: type ∈ {feat, fix, docs, refactor, test, chore}.

### Step 6: Push & Create PR

```bash
git push origin <prefix>/<slug>
```

Create a PR targeting the `develop` branch:

- **PR title**: `[<type>] <task title>`
- **PR body**: Summary of changes, reference to plan artifact (e.g., `Refs: plan-<slug>`), testing notes, any known limitations
- **Do NOT assign the PR** — the `merge` skill will detect and autonomously merge it once verification and review pass.

### Step 7: Report Completion

Report to the Orchestrator:

- Which tasks completed
- File paths changed
- Any issues or deviations from the plan
- Suggestions for verification focus areas (areas you're less confident about)

## Team Specialization

| Team | Primary Stack | Typical Files |
|------|--------------|---------------|
| `frontend` | React, TypeScript, Tailwind, shadcn/ui | `src/` |
| `backend` | Rust, Tauri, sqlx | `src-tauri/src/` |
| `database` | SQL, sqlx migrations | `migrations/` |
| `sidecar` | Node.js, Vercel AI SDK | sidecar process code |
| `integration` | Cross-cutting, config, build | `package.json`, `Cargo.toml`, `vite.config.ts`, `tauri.conf.json` |

## Parallel Execution Guidelines

- Teams with no inter-dependencies → spawn in parallel immediately after plan approval
- If two teams touch the same file, coordinate: one team finishes first, the other rebases
- Maximum 4 parallel implementation sessions at once to avoid merge chaos on `develop`
- Teams should push incrementally (at least daily) to surface merge conflicts early

## Rules

- Never work directly on `main` or `develop`
- Never edit `src-tauri/src/generated/` or `src/hooks/` (Layer 1 generated code)
- Never bypass the security policy (Layer 2 AST Guarded mode rules)
- Never add dependencies outside the allowed package list without approval
- If you hit an unexpected blocker, report to Orchestrator; do not silently work around it
- Commit frequently with meaningful messages — small commits are easier to review and revert
- If a task grows beyond its estimated scope, escalate to Orchestrator for plan update
