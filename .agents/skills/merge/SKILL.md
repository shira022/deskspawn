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
| `develop` → `staging` | 🎯 Orchestrator gate | All feature PRs in batch pass; full integration verify pass |
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

### Merge Type 2: Develop → Staging (Gated)

#### Preconditions Check (ALL must pass)

```
✅ All feature PRs in the batch have verify: pass
✅ All feature PRs in the batch have review: approved
✅ Full integration verify passes on develop HEAD (run verify skill on develop)
✅ No open review reports with changes_requested against any included feature
✅ Orchestrator explicitly signals: "Merge develop → staging approved"
```

#### Execution

```bash
# 1. Ensure local branches are current
git checkout staging
git pull origin staging
git checkout develop
git pull origin develop

# 2. Merge develop into staging
git checkout staging
git merge --no-ff develop -m "merge: develop → staging

Batch includes:
- <list feature branches merged since last staging update>

Verification: all feature PRs passed verify + review
Integration verify: passed on develop HEAD"

# 3. Run integration verification on staging HEAD
# (re-run verify skill; if fails → revert merge)

# 4. Push if integration verify passes
git push origin staging

# 5. Tag the staging snapshot
git tag -a "staging-$(date +%Y%m%d-%H%M%S)" -m "Staging snapshot $(date -Iseconds)"
git push origin --tags
```

#### Failure Handling

| Failure | Response |
|---------|----------|
| Integration verify fails | Revert the staging merge (`git reset --hard HEAD~1`). Identify conflicting features. Route to Orchestrator for diagnosis. |
| Push rejected | Someone else merged to staging concurrently. Rebase and retry. |
| Tag conflict | Use a unique tag name (timestamp already ensures uniqueness). |

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
  "type": "feature_to_develop|develop_to_staging",
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
- Develop → staging merges should be deliberate and only after full gate check
- Always use `--no-ff` to preserve branch history in the merge commit
- The merge log is append-only — never edit or remove entries
