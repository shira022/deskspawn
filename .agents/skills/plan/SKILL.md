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

### Phase 2: Exhaustive Questioning

Ask the human user about ALL of the following dimensions. Do not skip any. Do not assume answers. The user's answer is the single source of truth.

#### Architecture & Design

- What is the exact scope of this change? What is explicitly OUT of scope?
- Which components/layers are affected? (Tauri backend, React frontend, database, sidecar, etc.)
- Are there any architectural constraints or patterns to follow?
- Does this change interact with existing features? How?
- Which of the 3 code generation layers does this touch? (Template / AST Guarded / Freeform)

#### Data & State

- What data is involved? New SQLite tables? Schema changes to existing tables?
- What is the data flow? (user action → React state → invoke → Tauri command → sqlx → SQLite)
- Are there migration concerns? Backward compatibility with existing db files?
- What are the Rust ↔ TypeScript type mappings needed?

#### UI/UX

- What does the user see? Describe the full interaction flow step by step.
- Which layout mode does this affect? (2-pane, 3-pane, both?)
- What are the loading states? Empty states? Error states?
- Are there accessibility requirements? (keyboard nav, screen reader labels)
- Does it follow shadcn/ui component patterns?

#### Security

- Does this introduce new file I/O paths? New shell command executions?
- Does this touch the security policy engine? (allowed commands list, AST guard rules)
- Any new external API calls? Any new data exposure risks?
- Are user inputs properly validated and sanitized?
- Are API keys or secrets handled correctly? (keychain, never plaintext)

#### Verification

- What tests are needed? (unit, integration, e2e)
- What manual verification steps should the human perform?
- Are there edge cases that need special attention?
- What are the rollback/undo requirements?

#### Dependencies & Risks

- Are there new npm or cargo dependencies? Are they in the allowed package list?
- What could go wrong? What's the rollback plan?
- Are there cross-team dependencies? Can tasks be parallelized?
- What is the expected effort level?

### Phase 3: Plan Structuring

After all questions are answered, produce a structured plan following this schema:

```jsonc
{
  "id": "plan-<slug>",
  "title": "Human-readable title",
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

### Phase 4: Human Approval

1. Present the complete plan to the human user in a clear, readable format
2. Ask explicitly: "Does this plan look correct? Shall I proceed with implementation?"
3. Do NOT proceed to implementation until the human explicitly approves
4. After approval, set `approved: true` and write to `.agents/artifacts/plan-<slug>.json`

### Phase 5: Team Formation

1. For each team in the plan, determine if tasks can be parallelized
2. Independent tasks → spawn separate implementation sessions concurrently
3. Dependent tasks → sequence within team, parallelize across teams
4. Brief each team with: their task IDs, expected outputs, coordination needs, and the plan artifact path
5. Maximum 4 parallel implementation sessions at once

## Output

- A plan artifact at `.agents/artifacts/plan-<slug>.json`
- Team assignments communicated to the Orchestrator for session spawning

## Rules

- Never skip a question dimension even if it seems obvious
- Never assume the user's intent — ask explicitly
- Never proceed to implementation without human approval
- If the user gives vague answers, ask follow-ups until clarity is reached
- Plans are living documents — update if new information emerges during implementation
- Update the plan artifact if scope changes mid-implementation (re-approval may be needed)
