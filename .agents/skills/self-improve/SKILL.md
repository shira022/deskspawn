# self-improve — Autonomous Skill Management

## Purpose

Detect gaps in the agent team's skill coverage, propose new skills, and edit existing skills. This is the meta-skill that enables the agent team to evolve its own capabilities autonomously.

## Scope Limitation

- ✅ MAY: Create new skills under `.agents/skills/<name>/SKILL.md`
- ✅ MAY: Edit existing skill files under `.agents/skills/`
- ❌ MAY NOT: Edit `AGENTS.md` (requires human approval)
- ❌ MAY NOT: Change branch strategy or governance rules
- ❌ MAY NOT: Delete skills without human confirmation

## Trigger

- A workflow phase lacks adequate skill guidance (agents repeatedly ask "how do I...?")
- An agent encounters a repeated problem that existing skills don't address
- A new technology, tool, or pattern emerges that needs skill documentation
- After an escalation or post-mortem reveals a process gap
- An agent explicitly requests a new or improved skill
- The project's tech stack or conventions evolve

## Process

### Step 1: Gap Detection

Identify skill gaps by analyzing:

- **Escalation artifacts** (`.agents/artifacts/escalation-*.json`): What problems required human intervention?
- **Fix loop patterns**: What issues recur across multiple fix cycles? Could a skill prevent them?
- **Phase friction points**: Where do agents consistently slow down, get confused, or make errors?
- **Tool/tech changes**: New dependencies, APIs, or patterns without corresponding skill coverage?
- **Manual steps**: What do humans repeatedly have to do that agents should handle autonomously?
- **Skill catalog completeness**: Is every workflow phase covered? Are there cross-cutting concerns without a home?

### Step 2: Gap Analysis

For each identified gap, answer:

1. **What problem does this gap cause?** — provide concrete examples with artifact references
2. **Would a skill solve it?** — distinguish between skill gap, process gap, and tool gap
3. **Which existing skill is closest?** — extend an existing skill vs. create a new one
4. **What's the required scope?** — can it be a focused, small skill (<5,000 tokens)?

### Step 3: Proposal

Before creating/editing a skill, write a brief proposal to `.agents/artifacts/skill-proposal-<name>.json`:

```jsonc
{
  "action": "create|edit",
  "skill_name": "<name>",
  "rationale": "Why this skill is needed, what gap it fills",
  "gap_evidence": [
    "Concrete examples: escalation artifacts, repeated errors, manual interventions"
  ],
  "scope": "What the skill will cover (and what it won't)",
  "estimated_tokens": 3000,
  "impact": "How this improves the team's autonomy and output quality",
  "existing_skill_affected": "<name> or null"
}
```

### Step 4: Skill Creation

When creating a new skill, follow this required structure:

```markdown
# <name> — <one-line purpose>

## Purpose
<2-3 sentences on what this skill enables and why it exists>

## Trigger
<When should an agent load this skill? Be specific.>

## Process
<Step-by-step workflow. Numbered steps. Each step actionable.>

## Output
<What artifact does this skill produce? Where is it written? Schema if applicable.>

## Rules
<Hard constraints and guidelines. Bullet list.>
```

Requirements:

- **Maximum 10,000 tokens** — target 2,000-5,000 tokens
- **Self-contained** — loadable independently; no cross-skill dependency requirements
- **Actionable** — an agent can follow it immediately without external guidance
- **Specific** — references DeskSpawn's tech stack, conventions, and directory structure
- **Focused** — one skill, one purpose. Split broad topics into multiple skills.

### Step 5: Skill Editing

When editing an existing skill:

1. Read the current skill file fully (do not assume you remember it)
2. Make minimal, focused changes — prefer surgical edits over rewrites
3. Preserve the existing structure, tone, and level of detail
4. Add a changelog comment at the top: `<!-- Last updated: YYYY-MM-DD - <brief reason> -->`
5. Ensure the edited skill still stays under 10,000 tokens
6. If the edit significantly changes the skill's scope, write a brief proposal first (Step 3)

### Step 6: Validation

After creating/editing a skill, self-validate:

1. **Clarity check**: Read it as if loading it for the first time. Is every instruction clear?
2. **Actionability check**: Can an agent execute every step without guessing?
3. **Integration check**: Does it fit with the existing skill catalog? Are phase transitions clear?
4. **Token check**: Is it under 10,000 tokens? (If close, trim or split.)
5. **Scope check**: Does it stay within `.agents/skills/` boundaries? No AGENTS.md edits?

### Step 7: Notification

After creating/editing:

1. Append a summary to `.agents/artifacts/self-improve-log.json` (append-only):
   ```jsonc
   {
     "timestamp": "ISO8601",
     "action": "created|edited",
     "skill": "<name>",
     "rationale": "Brief reason",
     "validation_passed": true
   }
   ```
2. Notify the Orchestrator: "Skill <name> has been <created|updated>."
3. The human will be informed at the next planning checkpoint.
4. If the new skill should be added to the AGENTS.md skill catalog, write a catalog update note to `.agents/artifacts/skill-catalog-update.json` (the human will review and update AGENTS.md).

## When NOT to Create a Skill

- The problem is a one-off incident, not a recurring pattern
- The existing skill just needs better adherence by agents, not editing
- The problem is better solved by a tool, script, or configuration change
- The scope would exceed 10,000 tokens (split into multiple focused skills instead)
- It would duplicate an existing skill's guidance (extend the existing skill instead)
- The problem requires a human policy decision (escalate, don't skill-ify)

## Rules

- Never edit AGENTS.md
- Keep skills focused — one clear purpose per skill
- Prefer editing existing skills over creating new ones when the gap is adjacent
- Always write a proposal before creating — validate the need first
- Each skill must be self-contained and loadable independently
- Skills are living documents — revisit and improve periodically as the project evolves
- If unsure whether a skill is needed, ask the human at the next checkpoint
- The self-improve log is append-only; it serves as the audit trail for skill evolution
