# plan — Requirements Gathering & Task Planning

## Purpose

Conduct exhaustive requirements gathering with the human user, produce a structured implementation plan with task assignments, and prepare for parallel team execution.

## Trigger

- A new feature, epic, or significant change is requested
- The Orchestrator determines that planning is needed before implementation

## Process

### Phase 1: Domain Understanding

1. Read relevant existing code and documentation to understand context
2. Read `.agents/artifacts/` for any prior plans or artifacts that may be relevant
3. Identify the affected system components (frontend, backend, database, sidecar, build, etc.)

### Phase 2: Scope Assessment

Before questioning, classify the change into one of three tiers. The tier determines which question dimensions are required.

| Tier | Trigger | Example |
|------|---------|---------|
| **Full** (all dimensions) | New feature, architecture change, new component/layer | New onboarding flow, harness engine rewrite |
| **Focused** (3-4 dimensions) | Enhancement to existing feature, moderate refactor | Add filter to existing list, extract module |
| **Minimal** (2 dimensions) | Bug fix, typo, comment update, dependency bump | Fix HMR race condition, update package version |

#### Tier Selection

1. Assess the request against the trigger examples
2. If uncertain between tiers, choose the higher tier
3. Announce the tier to the user: "This looks like a **[Full/Focused/Minimal]** scope change. I'll ask the relevant questions."
4. If the user disagrees, adjust to their preference

### Phase 3: Scope-Adaptive Questioning

Ask the human user about the dimensions required for the chosen tier. Do not assume answers. Ask follow-ups until clarity is reached.

#### Required Dimensions by Tier

| Dimension | Full | Focused | Minimal |
|-----------|------|---------|---------|
| Architecture & Design | ✅ | ✅ | ✅ |
| Verification | ✅ | ✅ | ✅ |
| Data & State | ✅ | ✅ | — |
| Dependencies & Risks | ✅ | ✅ | — |
| UI/UX | ✅ | if UI touched | — |
| Security | ✅ | if I/O or deps | — |

##### Architecture & Design (Full, Focused, Minimal)

- What is the exact scope? What is explicitly OUT of scope?
- Which components/layers are affected? (Tauri backend, React frontend, database, sidecar, etc.)
- Are there architectural constraints or patterns to follow?
- Does this change interact with existing features? How?

##### Verification (Full, Focused, Minimal)

- What tests are needed? (unit, integration, e2e) — can be "none" for Minimal
- What manual verification steps should the human perform?
- Are there edge cases that need special attention?

##### Data & State (Full, Focused)

- What data is involved? New SQLite tables? Schema changes to existing tables?
- What is the data flow? (user action → React state → invoke → Tauri command → sqlx → SQLite)
- Are there migration concerns? Backward compatibility with existing db files?
- What are the Rust ↔ TypeScript type mappings needed?

##### Dependencies & Risks (Full, Focused)

- Are there new npm or cargo dependencies? Are they in the allowed package list?
- What could go wrong? What's the rollback plan?
- Are there cross-team dependencies? Can tasks be parallelized?
- What is the estimated effort level?

##### UI/UX (Full, and Focused when UI changes)

- What does the user see? Describe the full interaction flow step by step.
- Which layout mode does this affect? (2-pane, 3-pane, both?)
- What are the loading states? Empty states? Error states?
- Are there accessibility requirements? (keyboard nav, screen reader labels)
- Does it follow shadcn/ui component patterns?

##### Security (Full, and Focused when I/O or new dependencies)

- Does this introduce new file I/O paths? New shell command executions?
- Does this touch the security policy engine? (allowed commands list, AST guard rules)
- Any new external API calls? Any new data exposure risks?
- Are API keys or secrets handled correctly? (keychain, never plaintext)

### Phase 4: Plan Structuring

After questions are answered, produce a structured plan.

#### Slug Naming Convention

Plan slugs (used for plan ID, artifact filenames, and branch names) MUST follow this format:

```
<type>-<short-kebab-desc>-<YYYYMMDD>
```

- `type`: `feat`, `fix`, `docs`, `refactor`, `chore` (matches commit convention)
- `short-kebab-desc`: 2-5 words, lowercase, hyphenated. Must be unique within the project.
- `YYYYMMDD`: Creation date ensures uniqueness across same-topic plans

Example: `feat-harness-engine-20260521`

Before writing the plan artifact, check `.agents/artifacts/` for any existing plan with the same slug. If a collision exists, append `-2`, `-3`, etc.

#### Plan Schema

```jsonc
{
  "id": "plan-<slug>",
  "title": "Human-readable title",
  "scope_tier": "full|focused|minimal",
  "created": "ISO8601",
  "approved": false,           // set to true only after human approves
  "context": {
    "goal": "What we are building",
    "out_of_scope": ["Explicitly excluded items"],
    "constraints": ["Tech/business constraints"],
    "dependencies": ["External dependencies"]
  },
  "tasks": [
    {
      "id": "task-<nn>",
      "title": "Short descriptive title",
      "description": "Detailed what-to-do",
      "team": "frontend|backend|database|sidecar|integration",
      "branch": "<type>/<slug>",
      "prefix": "feature|fix|docs|refactor|chore",
      "dependencies": ["task-ids that must complete first"],
      "files_touched": ["Estimated file paths"],
      "acceptance_criteria": ["Checklist of verifiable conditions"],
      "estimated_effort": "S|M|L|XL"
    }
  ],
  "teams": [
    {
      "id": "team-<name>",
      "members": 1,
      "tasks": ["task-ids assigned"],
      "coordination_needs": ["Other teams to sync with"]
    }
  ],
  "verification_plan": {
    "lint": ["eslint", "clippy"],
    "typecheck": ["tsc --noEmit", "cargo check"],
    "test": ["vitest run", "cargo test"],
    "build": ["npm run build", "cargo build"]
  },
  "risk_mitigation": [
    {
      "risk": "Description of the risk",
      "likelihood": "low|medium|high",
      "mitigation": "How we handle or prevent it"
    }
  ]
}
```

### Phase 5: Human Approval

1. Present the complete plan to the human user in a clear, readable format
2. Ask explicitly: "Does this plan look correct? Shall I proceed with implementation?"
3. Do NOT proceed to implementation until the human explicitly approves
4. After approval, set `approved: true` and write to `.agents/artifacts/plan-<slug>.json`

### Phase 6: Team Formation

1. For each team in the plan, determine if tasks can be parallelized
2. Independent tasks → spawn separate implementation sessions concurrently
3. Dependent tasks → sequence within team, parallelize across teams
4. Brief each team with: their task IDs, expected outputs, coordination needs, and the plan artifact path
5. Maximum 4 parallel implementation sessions at once

## Output

- A plan artifact at `.agents/artifacts/plan-<slug>.json`
- Team assignments communicated to the Orchestrator for session spawning

## Rules

- Choose the appropriate scope tier before questioning (Full/Focused/Minimal). Do not over-question for small changes.
- Cover all dimensions required for the chosen tier. Skip dimensions not required by the tier.
- Never assume the user's intent — ask explicitly for required dimensions
- Never proceed to implementation without human approval
- If the user gives vague answers, ask follow-ups until clarity is reached
- Plans are living documents — update if new information emerges during implementation
- Update the plan artifact if scope changes mid-implementation (re-approval may be needed)
