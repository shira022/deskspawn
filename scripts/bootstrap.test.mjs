/**
 * DeskSpawn — regression tests for scripts/bootstrap-lib.mjs (node:test).
 *
 * Run with: pnpm test:scripts
 * (node --test with a glob over scripts/**\/*.test.mjs)
 *
 * These tests cover the pure decision logic used by the bootstrap scripts:
 * argument parsing, version comparison, missing-tool detection and
 * missing-package detection. No installation or network access happens here
 * (fast and offline).
 *
 * They also assert invariants of the real scripts as text: `set -euo pipefail`
 * (bash), `$ErrorActionPreference = 'Stop'` (PowerShell), and that neither
 * script deletes the app data root (~/deskspawn).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBootstrapArgs,
  normalizeRef,
  parseSemver,
  compareSemver,
  meetsMinVersion,
  evaluateTools,
  missingPackages,
  resolveRepoDir,
  bundleArtifactDirs,
  decideBuildPath,
  LINUX_APT_PACKAGES,
  DEFAULT_REF,
  PINNED_BUN,
  BUILD_OVERRIDE_JSON,
  BUILD_OVERRIDE_FILE_NAME,
  DESKTOP_DIST_RELATIVE_PATH,
} from './bootstrap-lib.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

test('parseBootstrapArgs: defaults', () => {
  const opts = parseBootstrapArgs([]);
  assert.equal(opts.ref, DEFAULT_REF);
  assert.equal(opts.dir, null);
  assert.equal(opts.noBundle, false);
  assert.equal(opts.dev, false);
  assert.equal(opts.help, false);
});

test('parseBootstrapArgs: --ref and --dir (separate value and = form)', () => {
  assert.equal(parseBootstrapArgs(['--ref', 'develop']).ref, 'develop');
  assert.equal(parseBootstrapArgs(['--ref=develop']).ref, 'develop');
  assert.equal(parseBootstrapArgs(['--dir', '/tmp/x']).dir, '/tmp/x');
  assert.equal(parseBootstrapArgs(['--dir=/tmp/x']).dir, '/tmp/x');
});

test('parseBootstrapArgs: flags and combinations', () => {
  const opts = parseBootstrapArgs(['--no-bundle', '--dev', '--ref', 'v0.4.2']);
  assert.equal(opts.noBundle, true);
  assert.equal(opts.dev, true);
  assert.equal(opts.ref, 'v0.4.2');
});

test('parseBootstrapArgs: unknown option and missing value throw', () => {
  assert.throws(() => parseBootstrapArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseBootstrapArgs(['--ref']), /requires a value/);
  assert.throws(() => parseBootstrapArgs(['--ref', '--dev']), /requires a value/);
});

test('normalizeRef: rejects unsafe refs', () => {
  assert.equal(normalizeRef('  main  '), 'main');
  assert.throws(() => normalizeRef(''), /must not be empty/);
  assert.throws(() => normalizeRef('--evil'), /must not start/);
  assert.throws(() => normalizeRef('a b'), /whitespace|unsupported/);
});

test('parseSemver: accepts the v prefix and metadata, rejects garbage', () => {
  assert.deepEqual(parseSemver('v1.3.14'), { major: 1, minor: 3, patch: 14 });
  assert.deepEqual(parseSemver('20.11.0-beta.1'), { major: 20, minor: 11, patch: 0 });
  assert.equal(parseSemver('not-a-version'), null);
  assert.equal(parseSemver(undefined), null);
});

test('compareSemver / meetsMinVersion', () => {
  assert.equal(compareSemver(parseSemver('1.2.3'), parseSemver('1.2.4')), -1);
  assert.equal(compareSemver(parseSemver('2.0.0'), parseSemver('1.9.9')), 1);
  assert.equal(compareSemver(parseSemver('1.0.0'), parseSemver('1.0.0')), 0);
  assert.equal(meetsMinVersion('20.11.0', '20.0.0'), true);
  assert.equal(meetsMinVersion('v1.3.14', '1.3.0'), true);
  assert.equal(meetsMinVersion('18.19.0', '20.0.0'), false);
  assert.equal(meetsMinVersion('garbage', '20.0.0'), false);
});

test('evaluateTools: classifies missing and outdated tools', () => {
  const detected = {
    git: '2.43.0',
    node: '18.19.0',
    bun: { present: true, version: '1.3.14' },
    rustc: null,
    cargo: undefined,
    // pnpm is not detected at all
  };
  const result = evaluateTools(detected);
  assert.deepEqual(result.missing.sort(), ['cargo', 'pnpm', 'rustc']);
  assert.deepEqual(result.outdated, [{ name: 'node', found: '18.19.0', required: '20.0.0' }]);
  assert.deepEqual(result.satisfied.sort(), ['bun', 'git']);
  assert.equal(result.ok, false);
});

test('evaluateTools: ok when every requirement is satisfied', () => {
  const detected = {
    git: '2.43.0',
    node: '20.0.0',
    pnpm: '10.4.1',
    bun: '1.3.14',
    rustc: '1.80.0',
    cargo: '1.80.0',
  };
  const result = evaluateTools(detected);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.outdated, []);
});

test('missingPackages: returns only the apt packages that are absent', () => {
  const installed = [LINUX_APT_PACKAGES[0], LINUX_APT_PACKAGES[2]];
  const missing = missingPackages(installed);
  assert.equal(missing.length, LINUX_APT_PACKAGES.length - 2);
  assert.ok(!missing.includes(LINUX_APT_PACKAGES[0]));
  assert.ok(missing.includes(LINUX_APT_PACKAGES[1]));
  assert.deepEqual(missingPackages(LINUX_APT_PACKAGES), []);
});

test('resolveRepoDir: cwd inside a checkout, --dir outside, else $HOME/deskspawn-src', () => {
  assert.equal(
    resolveRepoDir({ cwd: '/work/deskspawn', isCheckout: true, requestedDir: '/other', home: '/home/user' }),
    '/work/deskspawn',
  );
  assert.equal(
    resolveRepoDir({ cwd: '/tmp', isCheckout: false, requestedDir: '/other', home: '/home/user' }),
    '/other',
  );
  assert.equal(
    resolveRepoDir({ cwd: '/tmp', isCheckout: false, requestedDir: null, home: '/home/user/' }),
    '/home/user/deskspawn-src',
  );
});

test('bundleArtifactDirs: output directories per platform', () => {
  assert.deepEqual(bundleArtifactDirs('win32'), [
    'apps/desktop/src-tauri/target/release/bundle/msi',
    'apps/desktop/src-tauri/target/release/bundle/nsis',
  ]);
  assert.ok(bundleArtifactDirs('linux').some((p) => p.endsWith('/appimage')));
  assert.ok(bundleArtifactDirs('darwin').some((p) => p.endsWith('/dmg')));
});

test('decideBuildPath: pnpm available always wins (even without cargo)', () => {
  const withCargo = decideBuildPath({ pnpm: true, cargo: true, frontendDist: true });
  assert.equal(withCargo.path, 'pnpm');
  assert.ok(withCargo.reason.length > 0);

  const withoutCargo = decideBuildPath({ pnpm: true, cargo: false, frontendDist: false });
  assert.equal(withoutCargo.path, 'pnpm');
  assert.ok(withoutCargo.reason.length > 0);
});

test('decideBuildPath: pnpm absent + cargo + pre-built dist => cargo-override', () => {
  const result = decideBuildPath({ pnpm: false, cargo: true, frontendDist: true });
  assert.equal(result.path, 'cargo-override');
  assert.match(result.reason, /override|beforeBuildCommand/);
});

test('decideBuildPath: pnpm absent + cargo + no dist => impossible (actionable)', () => {
  const result = decideBuildPath({ pnpm: false, cargo: true, frontendDist: false });
  assert.equal(result.path, 'impossible');
  assert.match(result.reason, /frontend dist/i);
  assert.match(result.reason, new RegExp(DESKTOP_DIST_RELATIVE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.reason, /pnpm/);
});

test('decideBuildPath: neither pnpm nor cargo => impossible (actionable)', () => {
  const result = decideBuildPath({ pnpm: false, cargo: false, frontendDist: true });
  assert.equal(result.path, 'impossible');
  assert.match(result.reason, /pnpm/);
  assert.match(result.reason, /cargo/);
});

test('build override constants describe the beforeBuildCommand blanking', () => {
  assert.equal(BUILD_OVERRIDE_FILE_NAME, '.bootstrap-build-override.json');
  assert.deepEqual(JSON.parse(BUILD_OVERRIDE_JSON), { build: { beforeBuildCommand: '' } });
});

test('the pinned bun version is in the 1.3.x line', () => {
  assert.equal(PINNED_BUN, '1.3.14');
  assert.equal(meetsMinVersion(PINNED_BUN, '1.3.0'), true);
});

test('bootstrap scripts mirror the cargo-override fallback rules', () => {
  for (const name of ['bootstrap.sh', 'bootstrap.ps1']) {
    const script = readFileSync(join(SCRIPTS_DIR, name), 'utf8');
    assert.match(script, /cargo tauri build/, `${name} must invoke cargo tauri build`);
    assert.match(
      script,
      /"build"\s*:\s*\{\s*"beforeBuildCommand"\s*:\s*""\s*\}/,
      `${name} must blank beforeBuildCommand via the override JSON`,
    );
    assert.match(script, /frontend dist/i, `${name} must explain the pre-built frontend dist requirement`);
    assert.match(script, /keep (it and the shell scripts|both).*sync/i, `${name} must note it mirrors bootstrap-lib.mjs`);
  }
});

test('bootstrap.sh sets set -euo pipefail', () => {
  const script = readFileSync(join(SCRIPTS_DIR, 'bootstrap.sh'), 'utf8');
  assert.match(script, /set -euo pipefail/);
});

test("bootstrap.ps1 sets $ErrorActionPreference = 'Stop'", () => {
  const script = readFileSync(join(SCRIPTS_DIR, 'bootstrap.ps1'), 'utf8');
  assert.match(script, /\$ErrorActionPreference\s*=\s*'Stop'/);
});

test('bootstrap scripts never delete the app data root ($HOME/deskspawn)', () => {
  for (const name of ['bootstrap.sh', 'bootstrap.ps1']) {
    const script = readFileSync(join(SCRIPTS_DIR, name), 'utf8');
    // No recursive removal that targets the app data root directly.
    assert.doesNotMatch(script, /Remove-Item[^\n]*[\\/]deskspawn[\\/]?["']?\s*$/m, `${name} must not delete app data`);
    assert.doesNotMatch(script, /rm\s+-[a-z]*r[a-z]*f?[^\n]*[\\/]deskspawn\/(?:\s|$)/m, `${name} must not delete app data`);
  }
});
