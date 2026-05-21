# merge — GitFlow Merge & Branch Management

## Purpose

Execute GitFlow merge operations: feature branches into `develop` (autonomous), and `develop` into `staging` (gated by full verification). Manage branch lifecycle and cleanup.

## Trigger

- Feature implementation is complete, verification passed, and review approved
- The Orchestrator signals that merge gates are satisfied for a develop→staging batch

## Branch Types Handled

| Merge | Authority | Preconditions |
|-------|-----------|---------------|
| `<type>/*` → `develop` | 🤖 Autonomous | Review `approved`, verify `pass` |
| `develop` → `staging` | 🤖 PR: Orchestrator<br>👤 Merge: Human | All feature PRs in batch pass; full integration verify pass. Orchestrator creates PR; human merges. |
| `staging` → `main` | 👤 Human only | NOT handled by this skill |

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

# 2. Merge feature branch with no-fast-forward to preserve history
git merge --no-ff <prefix>/<slug> -m "merge: <prefix>/<slug> → develop

$(cat <<EOF
Summary of changes from plan-<slug>
Refs: plan-<slug>, verify-report-<slug>, review-report-<slug>
EOF)"

# 3. Push
git push origin develop

# 4. Delete remote feature branch
git push origin --delete <prefix>/<slug>

# 5. Delete local feature branch
git branch -d <prefix>/<slug>
```

#### Failure Handling

| Failure | Response |
|---------|----------|
| Merge conflict | Rebase feature onto develop, resolve conflicts, retry. Document the conflict resolution in merge log. |
| Push rejected | Pull latest develop, rebase, retry. If persistent, escalate. |
| Post-merge CI failure | Flag to Orchestrator immediately. Do NOT proceed to staging merge. |

### Merge Type 2: Develop → Staging (Human-Gated)

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
git checkout staging
git pull origin staging
git checkout develop
git pull origin develop

# 2. Run integration verification on develop HEAD
# (re-run verify skill; if fails → abort, route failing features back to fix)

# 3. Create a branch for the staging PR (so human can review the diff)
git checkout -b staging-pr-$(date +%Y%m%d-%H%M%S)
git merge --no-ff develop -m "staging: prepare develop → staging merge

Batch includes:
- <list feature branches merged since last staging update>

Verification: all feature PRs passed verify + review
Integration verify: passed on develop HEAD"
git push origin staging-pr-$(date +%Y%m%d-%H%M%S)

# 4. Create PR: staging-pr-* → staging
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
# 1. Tag the staging snapshot
git checkout staging
git pull origin staging
git tag -a "staging-$(date +%Y%m%d-%H%M%S)" -m "Staging snapshot $(date -Iseconds)"
git push origin --tags

# 2. Delete the staging-pr branch
git push origin --delete staging-pr-<timestamp>
```

#### Failure Handling

| Failure | Response |
|---------|----------|
| Integration verify fails before PR creation | Do NOT create PR. Identify conflicting features. Route to Orchestrator for diagnosis. |
| Human rejects PR | Read rejection reason. Route affected features back to `fix` or `implement`. |
| Post-merge tag conflict | Use a unique tag name (timestamp ensures uniqueness). |

## Branch Cleanup Policy

- ✅ Delete feature branches immediately after merge to `develop`
- ✅ Never delete `develop`, `staging`, or `main`
- ⚠️ Stale branches (>14 days without activity): flag to Orchestrator; human decides to keep or delete
- 📝 Branch deletions are logged in the merge log

## Output

Append to `.agents/artifacts/merge-log.json`:

```jsonc
{
  "timestamp": "ISO8601",
  "type": "feature_to_develop|develop_to_staging_pr|develop_to_staging_merged",
  "source_branch": "<prefix>/<slug>",
  "target_branch": "develop|staging",
  "commit_sha": "abc123def",
  "artifacts_referenced": [
    "plan-<slug>.json",
    "verify-report-<slug>.json",
    "review-report-<slug>.json"
  ],
  "branches_deleted": ["<prefix>/<slug>"],
  "tags_created": ["staging-YYYYMMDD-HHMMSS"]
}
```

## Rules

- Never merge to `main` — that is human-only territory
- Never skip preconditions, even for "trivial" changes
- If any precondition fails, abort and report to Orchestrator with specifics
- Feature → develop merges should be frequent (avoid accumulating large batches)
- Develop → staging: Orchestrator creates PR only after full gate check. Human decides when to merge.
- Never merge locally to `staging` — always go through the PR workflow
- Always use `--no-ff` to preserve branch history in the merge commit
- The merge log is append-only — never edit or remove entries
