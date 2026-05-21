# merge — GitFlow Merge & Branch Management

## Purpose

Execute GitFlow merge operations: feature branches into `develop` (autonomous), and `develop` into `main` (gated by full verification). Manage branch lifecycle and cleanup.

## Trigger

- Feature implementation is complete, verification passed, and review approved
- The Orchestrator signals that merge gates are satisfied for a develop→main batch

## Branch Types Handled

| Merge | Authority | Preconditions |
|-------|-----------|---------------|
| `<type>/*` → `develop` | 🤖 Autonomous | Review `approved`, verify `pass` |
| `develop` → `main` | 👤 Human only | All feature PRs in batch pass; full integration verify pass. Orchestrator creates PR; human merges. |

## Process

### Merge Type 1: Feature → Develop (Autonomous)

#### Preconditions Check

```
✅ Plan artifact exists and is approved
✅ Verify report shows overall: pass
✅ Review report shows overall: approved
✅ No merge conflicts with develop (if conflicts exist, rebase first)
✅ All artifacts exist in .agents/artifacts/ for audit trail
```

#### Execution

```bash
# 1. Ensure local develop is current
git checkout develop
git pull origin develop

# 2. Merge the PR via GitHub CLI (preserves PR record, triggers CI)
gh pr merge <pr-number> --squash --delete-branch --subject "merge: <prefix>/<slug> → develop"
# Note: --squash is used to keep develop history linear.
# The feature branch is auto-deleted by --delete-branch.
```
If `gh` CLI is unavailable, fall back to:
```bash
# Fallback: local merge (only if GitHub PR merge is not possible)
MSG=$'merge: <prefix>/<slug> → develop\n\nSummary: <replace with one-line summary>\nRefs: plan-<slug>, verify-report-<slug>, review-report-<slug>'
git merge --no-ff <prefix>/<slug> -m "$MSG"
git push origin develop
git push origin --delete <prefix>/<slug>
```

#### Failure Handling

| Failure | Response |
|---------|----------|
| Merge conflict | Rebase feature onto develop, resolve conflicts, retry. Document the conflict resolution in merge log. |
| Push rejected | Pull latest develop, rebase, retry. If persistent, escalate. |
| Post-merge CI failure | Flag to Orchestrator immediately. Do NOT proceed to develop→main merge. |

#### Rollback: Reverting a Bad Merge to Develop

If a merged feature is later found to be broken (e.g., post-merge CI fails, or review-after-merge catches an issue):

```bash
# 1. Identify the merge commit
git log develop --oneline --merges -5

# 2. Revert the merge (preserves history, safe for shared branches)
git checkout develop
git pull origin develop
MSG=$'revert: <prefix>/<slug> merge to develop\n\nReason: <brief reason for revert>\nRefs: plan-<slug>'
git revert --mainline 1 <merge-commit-sha> -m "$MSG"

# 3. Push the revert
git push origin develop

# 4. Re-create the feature branch for rework (if needed)
git checkout -b <prefix>/<slug>-rework <merge-commit-sha>^2
git push origin <prefix>/<slug>-rework
```

**Important**: Use `git revert` (not `git reset`) on shared branches. This preserves history and avoids force-push conflicts.

### Merge Type 2: Develop → Main (Human-Gated)

The Orchestrator handles verification and PR creation. The human reviews and clicks merge.

#### Orchestrator Preconditions Check (ALL must pass before creating PR)

```
✅ All feature PRs in the batch have verify: pass
✅ All feature PRs in the batch have review: approved
✅ Full integration verify passes on develop HEAD (run verify skill on develop)
✅ No open review reports with changes_requested against any included feature
```

#### Orchestrator Execution

```bash
# 1. Ensure local branches are current
git checkout main
git pull origin main
git checkout develop
git pull origin develop

# 2. Run integration verification on develop HEAD
# (re-run verify skill; if fails → abort, route failing features back to fix)

# 3. Create a branch for the main PR (so human can review the diff)
RELEASE_BRANCH="release-pr-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$RELEASE_BRANCH"
# Build commit message using $'...' for actual newlines
MSG=$'release: prepare develop → main merge\n\nBatch includes: <replace with list of feature branches>\nVerification: all feature PRs passed verify + review\nIntegration verify: passed on develop HEAD'
git merge --no-ff develop -m "$MSG"
git push origin "$RELEASE_BRANCH"

# 4. Create PR: release-pr-* → main
# PR description must include:
#   - List of feature branches in this batch
#   - Summary of verification results
#   - Link to all review reports
#   - Any notes for human reviewer
```

#### Human Action

The human reviews the PR and clicks merge. The human may:
- **Approve and merge** — proceeds as normal
- **Request changes** — Orchestrator addresses and re-submits
- **Reject** — batch is split or features are reworked

#### Post-Merge (Orchestrator)

After the human merges:

```bash
# 1. Tag the release snapshot
git checkout main
git pull origin main
git tag -a "release-$(date +%Y%m%d-%H%M%S)" -m "Release snapshot $(date -Iseconds)"
git push origin --tags

# 2. Delete the release-pr branch
git push origin --delete release-pr-<timestamp>
```

#### Failure Handling

| Failure | Response |
|---------|----------|
| Integration verify fails before PR creation | Do NOT create PR. Identify conflicting features. Route to Orchestrator for diagnosis. |
| Human rejects PR | Read rejection reason. Route affected features back to `fix` or `implement`. |
| Post-merge tag conflict | Use a unique tag name (timestamp ensures uniqueness). |

## Branch Cleanup Policy

- ✅ Delete feature branches immediately after merge to `develop`
- ✅ Never delete `develop` or `main`
- ⚠️ Stale branches (>14 days without activity): flag to Orchestrator; human decides to keep or delete
- 📝 Branch deletions are logged in the merge log

## Output

Append to `.agents/artifacts/merge-log.jsonl` (JSON Lines — one JSON object per line, append-only):

```jsonc
{
  "timestamp": "ISO8601",
  "type": "feature_to_develop|develop_to_main_pr|develop_to_main_merged",
  "source_branch": "<prefix>/<slug>",
  "target_branch": "develop|main",
  "commit_sha": "abc123def",
  "artifacts_referenced": [
    "plan-<slug>.json",
    "verify-report-<slug>.json",
    "review-report-<slug>.json"
  ],
  "branches_deleted": ["<prefix>/<slug>"],
  "tags_created": ["release-YYYYMMDD-HHMMSS"]
}
```

## Rules

- Never merge to `main` — that is human-only territory
- Never skip preconditions, even for "trivial" changes
- If any precondition fails, abort and report to Orchestrator with specifics
- Feature → develop merges should be frequent (avoid accumulating large batches)
- Develop → main: Orchestrator creates PR only after full gate check. Human decides when to merge.
- Never merge locally to `main` — always go through the PR workflow
- Always use `--no-ff` to preserve branch history in the merge commit
- The merge log is append-only — never edit or remove entries
