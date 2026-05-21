# DeskSpawn Agent Team Constitution

## Identity

We are the DeskSpawn autonomous agent development team.
Our mission: build DeskSpawn — an AI-powered Windows native app development platform.

**Tech stack**: Tauri v2 (Rust) + Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui + SQLite (sqlx).

## Orchestration Model

### Hybrid Architecture

- **Planning phase (Hierarchical)**: A lead Orchestrator loads the `plan` skill, conducts exhaustive requirements gathering with the human user, produces a structured plan with task assignments, and spawns implementation sub-teams.
- **Execution phase (Autonomous Distributed)**: Each implementation team operates independently, loading skills dynamically as needed. Teams coordinate via standardized artifacts stored in `.agents/artifacts/`.

### Dynamic Skill Loading

Skills are loaded on-demand based on the current workflow phase. Reference the Skill Catalog below to determine which skill to load. Skills are self-contained; loading one does not require pre-loading others. Only load skills needed for the current phase to minimize context pollution.

### Tool Sharing & Artifacts

All inter-agent communication flows through standardized artifacts:

| Artifact | Produced By | Consumed By | Format |
|----------|-------------|-------------|--------|
| `plan-<slug>.json` | `plan` skill | `implement` skill | Structured JSON |
| `verify-report-<slug>.json` | `verify` skill | `review` skill, `merge` skill | Structured JSON |
| `review-report-<slug>.json` | `review` skill | `fix` skill | Structured JSON |
| `fix-log-<slug>-<iter>.json` | `fix` skill | `verify` skill | Structured JSON |
| `merge-log.json` | `merge` skill | Orchestrator, human | Append-only JSON |

Artifacts are stored in `.agents/artifacts/` and serve as the bridge across separate sessions.

## Branch Strategy: 4-Branch GitFlow

```
main        🔒 Protected. PR from staging only. Human approve + full CI pass required.
  ↑
staging     🔒 Protected. PR from develop only. Orchestrator merges after all verification passes.
  ↑
develop     🤖 Open. Agents autonomously merge feature/fix/docs/refactor/chore PRs.
  ↑
<type>/*    🛠️ Implementation branches. Created per task.
```

### Branch Naming by Contributor Type

| Prefix | Use Case | Example |
|--------|----------|---------|
| `feature/` | New features | `feature/harness-engine` |
| `fix/` | Bug fixes | `fix/hmr-reload-race` |
| `docs/` | Documentation | `docs/api-reference` |
| `refactor/` | Code restructuring | `refactor/extract-db-layer` |
| `chore/` | Maintenance, tooling, CI | `chore/update-deps` |

### Merge Rules

| Source → Target | Merge Authority | Conditions |
|-----------------|----------------|------------|
| `<type>/*` → `develop` | 🤖 Agents (autonomous) | PR must be created; basic CI (lint/build) should pass |
| `develop` → `staging` | 🎯 Orchestrator | Full verification (verify + review) must pass |
| `staging` → `main` | 👤 Human only | Manual approval + full CI green |

### Commit Convention

`<type>: <description>` where type ∈ {feat, fix, docs, refactor, test, chore}

## Workflow

```
[PLAN] → [IMPLEMENT] → [VERIFY] → [REVIEW] → [FIX] → [MERGE develop→staging]
   ↑          ↑            ↑           ↑          ↑              ↑
 階層型    自律分散      local      separate    separate      orchestrator
           feature/*    session     session     session         gate
                          └────── loop ──────┘
```

### Phase Transitions

1. **PLAN**: Orchestrator loads `plan` skill → exhaustively questions user → outputs plan → user approves
2. **IMPLEMENT**: Orchestrator spawns teams per task assignments → teams load `implement` skill → work on feature branches
3. **VERIFY**: Agent loads `verify` skill → runs lint, typecheck, test, build locally → outputs verify-report
4. **REVIEW**: Separate session agents load `review` skill → multi-perspective review → outputs review-report
5. **FIX**: If review finds issues → separate session loads `fix` skill → implements fixes → back to VERIFY (unlimited loop). If stuck after 5 iterations for the same issue → escalate to human.
6. **MERGE (develop→staging)**: Orchestrator loads `merge` skill → confirms all gates → merges

## Skill Catalog

| Skill | Load When | Purpose |
|-------|-----------|---------|
| `plan` | New feature/epic starts | Requirements gathering, task breakdown, team formation |
| `implement` | Plan is approved | Parallel team implementation on feature branches |
| `verify` | Implementation done / fixes applied | Local verification (lint, typecheck, test, build) |
| `review` | Verification passes (separate session) | Multi-perspective code review |
| `fix` | Review finds issues (separate session) | Implement review fixes |
| `merge` | All gates passed | Feature→develop, develop→staging merges |
| `self-improve` | Skill gaps detected | Autonomous skill creation/editing |

## Session Isolation Policy

- `review` MUST run in a separate session from implementation
- `fix` MUST run in a separate session from review
- Review sub-dimensions (security, architecture, etc.) MAY run in parallel separate sessions
- Each session loads only the skills it needs
- Cross-session state: `.agents/artifacts/` only. No in-memory state transfer.

## Governance

- **AGENTS.md is immutable** to agents — changes require human approval
- **Skills** may be added/edited autonomously via `self-improve` (limited to `.agents/skills/` only)
- **Branch strategy** changes require human approval
- The Orchestrator is responsible for enforcing phase transitions and gate conditions
- When uncertain, escalate to human. Do not guess.

## Repository Context

- DeskSpawn is an OSS project
- Primary languages: Rust (backend) + TypeScript (frontend)
- Package manager: npm (frontend), cargo (backend)
- Build system: Vite (frontend), Cargo (backend)
- Testing: vitest (frontend), cargo test (backend)
- Linting: ESLint (frontend), clippy (backend)
