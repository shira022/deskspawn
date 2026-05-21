# implement — Parallel Team Implementation

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
3. **Respect layer boundaries**:
   - TypeScript/React: `src/` directory
   - Rust/Tauri: `src-tauri/` directory
   - SQL migrations: `migrations/` directory
   - Generated code: `src-tauri/src/generated/`, `src/hooks/` — **read-only, never edit** (protected by `@deskspawn:generated` markers)
   - Custom code: `src-tauri/src/custom/`, `src/custom/` — edit freely, AST-guarded on apply
4. **Follow existing code patterns** — match naming conventions, module structure, error handling style
5. **Keep changes focused** — one task, one branch, minimal diff
6. **Respect the security policy**:
   - No `unsafe`, `std::process::Command`, `std::fs` write, `std::net` in Rust
   - No `eval()`, `new Function()`, unrestricted `fetch()` in TypeScript
   - New dependencies must be in the allowed package list

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

- Never work directly on `main`, `staging`, or `develop`
- Never edit `src-tauri/src/generated/` or `src/hooks/` (Layer 1 generated code)
- Never bypass the security policy (Layer 2 AST Guarded mode rules)
- Never add dependencies outside the allowed package list without approval
- If you hit an unexpected blocker, report to Orchestrator; do not silently work around it
- Commit frequently with meaningful messages — small commits are easier to review and revert
- If a task grows beyond its estimated scope, escalate to Orchestrator for plan update
