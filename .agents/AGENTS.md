# DeskSpawn Agent Team Constitution

## Identity

We are the DeskSpawn autonomous agent development team.
Our mission: build DeskSpawn — an AI-powered Windows native app development platform.

**Tech stack**: Tauri v2 (Rust) + Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui + SQLite (sqlx).

## Context Note

This AGENTS.md governs **two distinct contexts**:

| Context | What it is | Tech Stack |
|---------|-----------|------------|
| **DeskSpawn (the tool)** | The IDE/tool being built. Agents modify this repo's source code. | Tauri v2 (Rust) + Vite + React 18 + TypeScript + SQLite |
| **Generated apps** | The web apps that DeskSpawn creates for users. Agents generate code for these via the sidecar AI. | Vite + React 18 + TypeScript + IndexedDB (no Rust, no Tauri) |

When working on a task, identify which context applies. For DeskSpawn itself, Rust/Tauri/cargo rules apply. For generated app code generation, the web-only stack (no cargo, no Rust) applies.

## Orchestration Model

### Hybrid Architecture

- **Planning phase (Hierarchical)**: A lead Orchestrator loads the `plan` skill, conducts scope-adaptive requirements gathering with the human user, produces a structured plan with task assignments, and spawns implementation sub-teams.
- **Execution phase (Autonomous Distributed)**: Each implementation team operates independently, loading skills dynamically as needed. Teams coordinate via standardized artifacts stored in `.agents/artifacts/`.

### What Is the Orchestrator?

The Orchestrator is not a separate process, script, or human role. It is a **role temporarily assumed by an agent session**. Any agent can become the Orchestrator by loading the `plan` or `merge` skill when those phases are active. The Orchestrator's responsibilities are:

1. **Phase gate enforcement**: Ensuring each phase completes with the required artifacts before the next begins
2. **Task distribution**: Spawning implementation sub-sessions per the plan's team assignments
3. **Artifact coordination**: Reading and validating artifacts from `.agents/artifacts/` to make gate decisions
4. **Escalation**: Routing stuck issues to the human when automated resolution fails

There is no persistent Orchestrator process. The role is ephemeral — assumed when needed, released when the phase completes.

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
| `escalation-<slug>.json` | `fix` skill | Orchestrator, human | Structured JSON |
| `merge-log.jsonl` | `merge` skill | Orchestrator, human | Append-only JSON Lines |
| `self-improve-log.jsonl` | `self-improve` skill | Orchestrator, human | Append-only JSON Lines |
| `skill-proposal-<name>.json` | `self-improve` skill | human | Structured JSON |

Artifacts are stored in `.agents/artifacts/` and serve as the bridge across separate sessions.

#### Artifact Access Rules

- **One writer per slug at a time**: Only one agent session may write artifacts for a given `<slug>`. If a session detects that the artifact file for its slug already exists and was modified by another session, it MUST NOT overwrite it. Instead, coordinate through the Orchestrator.
- **Append-only where specified**: `merge-log.jsonl` and `self-improve-log.jsonl` are append-only JSON Lines files. Never edit or remove existing entries. Each line is a standalone JSON object.
- **Atomic writes**: Write artifacts to a temp file first, then rename/move into place to prevent partial reads.
- **Read before write**: Always read the current artifact before writing to detect concurrent modifications.

## Branch Strategy: 3-Branch GitFlow

```
main        🔒 Protected. PR from develop only. Human approve + full CI pass required.
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
| `<type>/*` → `develop` | 🤖 Agents (autonomous) | PR must be created; CI must pass (see `.github/workflows/ci.yml`) |
| `develop` → `main` | 👤 Human only | Full verification (verify + review) must pass. Human approves and merges. |

### Commit Convention

`<type>: <description>` where type ∈ {feat, fix, docs, refactor, test, chore}

## Workflow

```
[PLAN] → [IMPLEMENT] → [VERIFY] → [REVIEW] ──→ [FIX] ──┐
   ↑          ↑            ↑           ↑          ↑       │
Hierarchical  feature/*   local      separate    separate │
              branches    session     session     session  │
                            └── loop (FIX→VERIFY→REVIEW) ─┘
                            ↓ (review passes)
                     [MERGE feature→develop]  ← autonomous
                            ↓
                    (develop accumulates)
                            ↓
                  [MERGE develop→main]  ← human only
```

### Phase Transitions

1. **PLAN**: Orchestrator loads `plan` skill → scope-adaptive questions → outputs plan → user approves
2. **IMPLEMENT**: Orchestrator spawns teams per task assignments → teams load `implement` skill → work on feature branches → create PRs to `develop`
3. **VERIFY**: Agent loads `verify` skill → runs lint, typecheck, test, build locally → outputs verify-report
4. **REVIEW**: Separate session agents load `review` skill → multi-perspective review → outputs review-report
5. **FIX**: If review finds issues → separate session loads `fix` skill → implements fixes → back to VERIFY (unlimited loop; escalate to human at 5 iterations for same issue)
6. **MERGE (feature→develop)**: `merge` skill autonomously detects passing PRs → merges to `develop` → deletes feature branch
7. **MERGE (develop→main)**: Orchestrator loads `merge` skill → integration verify on develop → creates PR for human → human reviews and merges

## Skill Catalog

| Skill | Load When | Purpose |
|-------|-----------|---------|
| `plan` | New feature/epic starts | Requirements gathering, task breakdown, team formation |
| `implement` | Plan is approved | Parallel team implementation on feature branches |
| `verify` | Implementation done / fixes applied | Local verification (lint, typecheck, test, build) |
| `review` | Verification passes (separate session) | Multi-perspective code review |
| `fix` | Review finds issues (separate session) | Implement review fixes |
| `merge` | All gates passed | Feature→develop, develop→main merges |
| `self-improve` | Skill gaps detected | Autonomous skill creation/editing |
| `decision-recorder` | Architecture decisions made | Record decisions as ADRs in `docs/adr/` |

## ADR (Architecture Decision Records) Policy

- **Autonomous recording**: Any agent (regardless of coding-agent type) that identifies an important architectural decision MUST record it as an ADR using the `decision-recorder` skill, without waiting for human instruction.
- **Scope**: Architecture-wide decisions, tech stack/framework/library selections, significant trade-off design choices, and policy changes to existing ADRs.
- **Location**: `docs/adr/NNN-title-in-kebab-case.md` (see `docs/adr/_template.md`).
- **Status lifecycle**: new ADRs start as `proposed` → human approval → `accepted` → superseded ADRs get `superseded` status.
- **🔒 Privacy (MANDATORY)**: ADRs are committed to a public OSS repository. NEVER include personal information — real usernames, emails, absolute paths (e.g. `C:\Users\<user>\...`), API keys, tokens, secrets, or machine-specific identifiers. Always use generalized notation (`~/...`, `<USER_HOME>/...`) and placeholders. Run the self-check in the `decision-recorder` skill before committing.

## Session Isolation Policy

- `review` MUST run in a separate session from implementation
- `fix` MUST run in a separate session from review
- Review sub-dimensions (security, architecture, etc.) MAY run in parallel separate sessions
- Each session loads only the skills it needs
- Cross-session state: `.agents/artifacts/` only. No in-memory state transfer.
- **Enforcement**: The Orchestrator MUST create a session-isolation token (a random UUID) and pass it to only one session per role. An agent presenting a token that was already used for a different role in the same slug MUST be rejected. Each `.agents/artifacts/session-<slug>.json` records which session ID performed which role.

## Governance

- **AGENTS.md is immutable** to agents — changes require human approval
- **Skills** may be proposed autonomously via `self-improve`. All proposals must be approved by a human before being applied to `.agents/skills/`.
- **Branch strategy** changes require human approval
- The Orchestrator is responsible for enforcing phase transitions and gate conditions
- When uncertain, escalate to human. Do not guess.

## Repository Context

- DeskSpawn is an OSS project
- **Versioning (MANDATORY)**: 全パッケージ単一バージョン方針。ルート / apps/web / apps/desktop / apps/desktop/sidecar / packages/* / tauri.conf.json / Cargo.toml のversionは常に同一（SemVer 3桁 `major.minor.patch`）。リリース時はGitHubタグ `v<version>` とも一致させること。検証: `node scripts/check-versions.mjs`。バージョン更新: `python3 scripts/set-version.py <version>`。詳細は verify スキル Stage 7 / merge スキル Version Bump を参照。
- Primary languages: Rust (backend) + TypeScript (frontend)
- Package manager: pnpm (frontend), cargo (backend)
- Build system: Vite (frontend), Cargo (backend)
- Testing: vitest (frontend), cargo test (backend)
- Linting: ESLint (frontend), clippy (backend)
- **i18n:** All user-facing UI strings must use the i18n system (`useTranslation()` hook in React components, `i18n.t()` in non-React code). Translation keys are defined in `packages/shared/src/locales/{en,ja}/common.json`. Language configuration is in `packages/shared/src/lib/languages.ts`. Never hardcode display strings in components or utilities.

## Allowed Package List

Agents may add dependencies from the following list without human approval. Any package not on this list requires human approval before use.

### npm (Frontend)
```
react, react-dom, @tauri-apps/api, @tauri-apps/plugin-*,
tailwindcss, @tailwindcss/forms, @tailwindcss/typography,
lucide-react, @radix-ui/* (shadcn/ui dependencies)
```

### Cargo (Backend)
```
tauri, tauri-build, serde, serde_json, sqlx (sqlite feature), tokio
```

---

## 🇯🇵 日本語

この AGENTS.md は「DeskSpawn（開発対象ツール・Tauri/Rust）」と「生成アプリ（Web のみ）」の2コンテキストを統治する。要点:

- **ブランチ戦略**: 3ブランチ GitFlow（`main` 🔒 保護・人間のみ ← `develop` 🤖 自律マージ ← `<type>/*`）。`<type>/*` → `develop` は CI 通過後にエージェントが自律マージ可、`develop` → `main` は人間の承認のみ。
- **検証ゲート**: VERIFY 段階で lint / tsc / vitest / build をローカル実行し `verify-report-<slug>.json` を `.agents/artifacts/` に置く。型チェックは `pnpm --filter web exec tsc -b --noEmit`（desktop も `-b` 必須 — `tsc --noEmit` は no-op）。
- **バージョン（MANDATORY）**: 全パッケージ単一バージョン（SemVer 3桁 `major.minor.patch`）。検証 `node scripts/check-versions.mjs`、更新 `python3 scripts/set-version.py <version>`。
- **i18n**: UI 文字列のハードコード禁止。`useTranslation()` / `i18n.t()` を使い、キーは `packages/shared/src/locales/{en,ja}/common.json` に定義、対応言語は `packages/shared/src/lib/languages.ts`。
- **ADR**: 重要な設計判断は `decision-recorder` スキルで `docs/adr/NNN-title.md` に記録（proposed → human approval → accepted）。公開 OSS リポジトリのため**個人情報（実ユーザー名・実パス・APIキー等）を ADR に書かない**（`~/...` やプレースホルダを使用）。
- **共有コード**: 両アプリ共通の実装（UI・チャット・AI・ストレージ・i18n・型）は `packages/shared/src/` に置き `@deskspawn/shared` alias で import（ADR-014）。`apps/web/src` / `apps/desktop/src` はプラットフォームエントリ＆グルーコードのみ。
