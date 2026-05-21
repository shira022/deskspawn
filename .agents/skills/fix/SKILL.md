# fix — Review-Driven Fix Implementation

## Purpose

Implement fixes based on review report findings. Execute in a separate session from the review. Loop back through verification and review until all issues are resolved or escalation is triggered.

## Critical: Separate Session Requirement

This skill MUST be loaded in a session separate from the review session. The fix agent works from the review report artifact alone, without direct conversation with the reviewer, to maintain objectivity.

## Trigger

- A review report at `.agents/artifacts/review-report-<slug>.json` shows `overall: changes_requested`
- The Orchestrator has routed the review findings for fixing

## Pre-flight

1. Read the review report: `.agents/artifacts/review-report-<slug>.json`
2. Read the plan artifact for context: `.agents/artifacts/plan-<slug>.json`
3. Checkout the feature branch that was reviewed:
   ```bash
   git checkout <prefix>/<slug> && git pull origin <prefix>/<slug>
   ```
4. Confirm the branch is based on current `develop`:
   ```bash
   git merge-base --is-ancestor origin/develop HEAD || echo "NEEDS REBASE"
   ```

## Process

### Step 1: Triage Issues

Parse the review report's issues across all dimensions. Sort by:

1. **Severity** — critical first, then high, then medium (low/info are optional)
2. **File grouping** — batch issues per file to minimize context switching
3. **Dependency** — issues that block other fixes come first (e.g., "extract this type before fixing the component that uses it")

### Step 2: Implement Fixes

For each issue (ordered by triage):

1. Read the file at the specified path and line number
2. Understand the reviewer's concern and their `recommendation`
3. Implement the fix following the recommendation when present
4. If the recommendation is unclear, infeasible, or conflicts with other constraints, propose an alternative
5. After fixing all issues in a file, self-review: does the fix actually resolve the reviewer's concern?
6. Check that the fix doesn't introduce new issues (run `tsc --noEmit` / `cargo check` to verify)

### Step 3: Document Changes

Track every fix applied:

```jsonc
{
  "review_issue_ref": "<dimension>:<issue index>",
  "file": "path",
  "change": "Brief description of what was changed",
  "status": "fixed|deferred|rejected|alternative",
  "reason": "Explanation if not fixed as recommended"
}
```

- `fixed`: Implemented exactly as recommended
- `deferred`: Acknowledged but requires broader architectural work (note in escalation)
- `rejected`: Reviewer's concern is not applicable (with evidence)
- `alternative`: Fixed the concern with a different approach than recommended

### Step 4: Commit

```bash
git add <changed files>
git commit -m "fix: address review findings for <slug>

Issues addressed:
- <dimension>: <summary>
- <dimension>: <summary>

Refs: review-report-<slug>"
```

### Step 5: Push

```bash
git push origin <prefix>/<slug>
```

Update the existing PR (push to the same branch). The PR description will reflect the latest commits.

## Output: Fix Log

Write to `.agents/artifacts/fix-log-<slug>-<iteration>.json`:

```jsonc
{
  "plan_id": "plan-<slug>",
  "review_report_id": "review-report-<slug>",
  "iteration": 1,
  "timestamp": "ISO8601",
  "fixes": [
    {
      "issue_ref": "<dimension>:<index>",
      "file": "path",
      "change": "What was changed",
      "status": "fixed|deferred|rejected|alternative",
      "reason": "Explanation"
    }
  ],
  "unresolved": [
    {
      "issue_ref": "<dimension>:<index>",
      "reason": "Why it was not fixed in this iteration",
      "recommendation": "What is needed to resolve it"
    }
  ]
}
```

## The Fix Loop

```
FIX → VERIFY → REVIEW
  ↑                 │
  └─── changes_requested ──┘
```

1. Fixes applied → run `verify` skill → run `review` skill (new separate session)
2. If review passes → proceed to merge
3. If review still shows issues → back to fix (increment iteration number in fix log filename)
4. Loop continues without iteration limit

### Escalation Rule

If the **same issue** (same file, same concern) persists after 5 fix iterations without progress:

1. Write escalation artifact: `.agents/artifacts/escalation-<slug>.json`
2. Include:
   - The persistent issue (exact file, line, concern)
   - What was tried in each of the 5 iterations
   - Why it remains unresolved
   - What help is needed from a human
3. Signal the Orchestrator: "Human intervention needed for <issue>"
4. The Orchestrator presents the escalation to the human user

### Stuck Detection

An issue is considered "stuck" when the same file/line is flagged in 5 consecutive fix iterations for the same concern without progress. When stuck detection fires, the Escalation Rule above triggers automatically.

Additionally, escalate immediately (regardless of iteration count) when:
- The fix agent cannot determine a viable approach after 2 attempts on the same issue
- Implementing the recommended fix would violate an architectural constraint
- The fix requires a decision that only a human can make

## Rules

- Fix in a SEPARATE session from review — load this skill in a fresh session with no implementation context
- Address ALL issues with severity ≥ `medium` before considering the fix complete
- Do not silently skip issues — document every `deferred` or `rejected` with a clear reason
- If a fix introduces new issues, fix those too but note them in the fix log
- Do not expand scope — only fix what the review requested; do not refactor adjacent code
- When truly stuck, escalate; do not guess at risky fixes
- The fix log is written per iteration — each iteration gets its own file
