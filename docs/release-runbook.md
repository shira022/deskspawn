# Release runbook

Operational steps for cutting a DeskSpawn release and for recovering from a bad
one. Written after v0.5.0 shipped only Windows assets (issue #175) with no
documented rollback path.

## 0. Before you tag

Run these locally; every one must pass:

```bash
node scripts/check-versions.mjs          # all manifests agree on one version
pnpm --filter web exec tsc -b            # types
pnpm --filter web test                   # unit + component tests
pnpm exec eslint .                       # repo-root lint (matches CI)
```

Then confirm on the branch you are about to release:

- [ ] `develop` CI is green, including `rust-check-test`, `desktop-build`,
      `sidecar-build`, `version-consistency` and `Analyze` (CodeQL).
- [ ] The AppImage path is proven: the `AppImage verify` workflow has a green
      run for this commit (Actions → "AppImage verify"). This is the only
      tag-less way to know Linux bundling works.
- [ ] `pnpm --filter desktop tauri build` has been run at least once on a
      machine with the Tauri CLI since the last dependency bump — the CLI
      refuses to build when `@tauri-apps/api` and the `tauri` crate differ in
      major/minor, and no CI job catches that on its own.
- [ ] `docs/changelog.md` has a section for the version being released (move
      shipped items out of any "Unreleased" heading).

## 1. Bump the version

```bash
git checkout develop && git pull
git checkout -b release/vX.Y.Z
python3 scripts/set-version.py X.Y.Z          # 9 manifests + MSIX (X.Y.Z.0)
(cd apps/desktop/src-tauri && cargo update -p deskspawn-desktop)
node scripts/check-versions.mjs                # must print 全箇所一致
```

Commit as `chore(release): vX.Y.Z`, open a PR to `develop`, let CI pass, merge.

## 2. Promote to main

```bash
gh pr create --base main --head develop --title "release: vX.Y.Z"
# wait for checks, then merge (admin merge is allowed for this repo)
gh pr merge <n> --merge --admin
```

## 3. Tag and build

```bash
git checkout main && git pull
git show HEAD:apps/desktop/src-tauri/tauri.conf.json   # version must equal X.Y.Z
git tag -a vX.Y.Z -m "DeskSpawn vX.Y.Z"
git push origin vX.Y.Z
```

The `Release` workflow (`guard` → `build` → `verify-assets`) then:

1. verifies the tag is an ancestor of `origin/main` and matches
   `tauri.conf.json`,
2. creates the GitHub Release once (generated notes),
3. builds Windows (MSI + NSIS setup.exe) and Linux (deb + rpm + AppImage),
4. **verifies that msi, setup.exe, deb and AppImage all exist** and demotes the
   release to a draft if any platform is missing.

## 4. Verify the result

```bash
gh release view vX.Y.Z --json assets --jq '.assets[].name'
```

Expected: `*.msi`, `*-setup.exe`, `*.deb`, `*.rpm`, `*.AppImage`.
Only then announce the release.

> Updater note: `plugins.updater` is configured in `tauri.conf.json`, but
> `bundle.createUpdaterArtifacts` is not enabled, so no `.sig`/updater archives
> are produced and the in-app update check cannot succeed. Either enable
> signing (needs `TAURI_SIGNING_PRIVATE_KEY` + a published `updates.json`) or
> remove the updater configuration so the app stops checking. Tracked in the
> audit issue.

## 5. Rollback

### 5a. Bad assets on a published release (build broke, code is fine)

```bash
gh release edit vX.Y.Z --draft          # hide it immediately
# fix the workflow/code on develop, merge to main, then re-run for the tag:
gh workflow run release.yml -f tag=vX.Y.Z
gh release edit vX.Y.Z --draft=false    # re-publish once assets are complete
```

`gh release upload --clobber` makes re-runs idempotent, so partially uploaded
assets are replaced rather than duplicated.

### 5b. Bad code already released (needs a new patch)

Do **not** move or delete the tag — installers reference it, and rewriting a
published tag breaks reproducibility.

```bash
git checkout main && git pull
git revert <bad-commit-sha>             # or cherry-pick the fix
# release as vX.Y.(Z+1) following sections 1-3
gh release edit vX.Y.Z --notes "Superseded by vX.Y.(Z+1): <reason>"
```

### 5c. Microsoft Store package was bad

The Store build is submitted from `apps/desktop/store/msix` (see
`docs/store-update-runbook.md`). If a bad package reached the Store, submit a
new MSIX with a higher `Package.appxmanifest` version — the Store does not allow
withdrawing a published version in place; the update is the rollback.

## 6. After the release

- Keep `docs/changelog.md` correct: shipped sections stay, "Unreleased" only
  holds work that has not been tagged.
- If a dependency bump was involved, re-check the app on a real machine: the AI
  round trip is the only test that catches AI SDK provider/spec mismatches.
