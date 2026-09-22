/**
 * DeskSpawn — regression tests for scripts/bootstrap-lib.mjs and the real
 * shell scripts (node:test).
 *
 * Run with: pnpm test:scripts
 * (node --test with a glob over scripts/**\/*.test.mjs)
 *
 * These tests cover the pure decision logic used by the bootstrap scripts
 * (argument parsing, version comparison, missing-tool detection, missing-package
 * detection, build-path selection) AND execute the shipped bash logic directly:
 * bootstrap.sh is sourced and its own validate_ref / version_ge /
 * detect_build_path functions are exercised, then compared against the JS
 * mirror. No installation or network access happens here (fast and offline).
 *
 * Coverage limits:
 *   - bootstrap.sh: executed (see the "executed" tests below).
 *   - bootstrap.ps1: NOT executed — there is no PowerShell runtime on this
 *     Linux host. Only static/text invariants are asserted, and the test named
 *     "bootstrap.ps1 is only statically checked" states this explicitly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  TAURI_CLI_INSTALL_COMMAND,
  DESKTOP_DIST_RELATIVE_PATH,
} from './bootstrap-lib.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SH_SCRIPT = join(SCRIPTS_DIR, 'bootstrap.sh');

/**
 * Source the real bootstrap.sh with `args` as its positional parameters, then
 * run `code`. This executes the shipped argument parsing and validate_ref, and
 * defines the real shell functions, but main() is guarded by a
 * `BASH_SOURCE`/`$0` check so no installs, clones, or network calls happen.
 */
function runSourced(args, code) {
  return spawnSync('bash', ['-c', `src="$1"; shift; source "$src" "$@"; ${code}`, 'bash', SH_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}


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
  const withCargo = decideBuildPath({ pnpm: true, cargo: true, frontendDist: true, tauriCli: true });
  assert.equal(withCargo.path, 'pnpm');
  assert.ok(withCargo.reason.length > 0);

  const withoutCargo = decideBuildPath({ pnpm: true, cargo: false, frontendDist: false });
  assert.equal(withoutCargo.path, 'pnpm');
  assert.ok(withoutCargo.reason.length > 0);
});

test('decideBuildPath: pnpm absent + cargo + tauri-cli + pre-built dist => cargo-override', () => {
  const result = decideBuildPath({ pnpm: false, cargo: true, frontendDist: true, tauriCli: true });
  assert.equal(result.path, 'cargo-override');
  assert.match(result.reason, /override|beforeBuildCommand/);
});

test('decideBuildPath: cargo + dist but no tauri-cli => install-tauri-cli (actionable)', () => {
  const result = decideBuildPath({ pnpm: false, cargo: true, frontendDist: true, tauriCli: false });
  assert.equal(result.path, 'install-tauri-cli');
  assert.match(result.reason, new RegExp(TAURI_CLI_INSTALL_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.reason, /rustup/);
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

// ─────────────────────────────────────────────────────────────────────
// Executed coverage of the shipped shell logic. These source bootstrap.sh
// and call the real functions (not regex checks), then compare against the
// JS mirror so the two cannot silently diverge.
//
//   validate_ref()      scripts/bootstrap.sh:121  <-> normalizeRef()
//   version_ge()        scripts/bootstrap.sh:136  <-> meetsMinVersion()
//   detect_build_path() scripts/bootstrap.sh:373  <-> decideBuildPath()
//
// bootstrap.ps1 has no PowerShell runtime on this Linux host, so it is only
// checked statically (see the explicit test below).
// ─────────────────────────────────────────────────────────────────────

test('bootstrap.sh has no syntax errors (bash -n)', () => {
  const r = spawnSync('bash', ['-n', SH_SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('bootstrap.sh --help exits 0 and documents the POSIX flags', () => {
  const r = spawnSync('bash', [SH_SCRIPT, '--help'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--ref/);
  assert.match(r.stdout, /--no-bundle/);
});

test('bootstrap.sh argument parsing matches parseBootstrapArgs (executed)', () => {
  const dump = 'printf "%s|%s|%s|%s|%s" "$REF" "$DIR" "$NO_BUNDLE" "$DEV_MODE" "$SKIP_DEPS"';

  const defaults = runSourced([], dump);
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.equal(defaults.stdout, `main||0|0|0`);

  const all = runSourced(['--ref', 'develop', '--dir', '/tmp/x', '--no-bundle', '--dev', '--skip-deps'], dump);
  assert.equal(all.status, 0, all.stderr);
  assert.equal(all.stdout, 'develop|/tmp/x|1|1|1');

  const eq = runSourced(['--ref=develop'], 'printf "%s" "$REF"');
  assert.equal(eq.stdout, 'develop');

  const unknown = runSourced(['--nope'], 'printf should-not-run');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown option/);
});

test('bootstrap.sh validate_ref accept/reject set matches normalizeRef (executed)', () => {
  const accept = ['main', 'develop', 'v0.4.2', 'feature/clone-and-release-dx', 'release-1.2.3'];
  const reject = ['--evil', 'a b', 'a\tb', 'a\u0001b', 'a..b', 'a\\b'];

  for (const ref of accept) {
    assert.equal(normalizeRef(ref), ref);
    const r = runSourced(['--ref', ref], 'printf ok');
    assert.equal(r.status, 0, `shell rejected valid ref ${JSON.stringify(ref)}: ${r.stderr}`);
    assert.equal(r.stdout, 'ok');
  }

  for (const ref of reject) {
    assert.throws(() => normalizeRef(ref), `lib should reject ${JSON.stringify(ref)}`);
    const r = runSourced(['--ref', ref], 'printf ok');
    assert.notEqual(r.status, 0, `shell accepted invalid ref ${JSON.stringify(ref)}`);
  }

  // Empty ref: lib rejects it; the shell rejects it during argument parsing.
  assert.throws(() => normalizeRef(''));
  const empty = runSourced(['--ref', ''], 'printf ok');
  assert.notEqual(empty.status, 0);
});

test('bootstrap.sh version_ge matches meetsMinVersion (executed)', () => {
  const cases = [
    ['1.2.3', '1.2.0'],
    ['1.2.0', '1.2.3'],
    ['1.2.3', '1.2.3'],
    ['20.11.0', '20.0.0'],
    ['v1.3.14', '1.3.0'],
    ['1.3.14', '1.3.0'],
  ];
  for (const [actual, min] of cases) {
    const expected = meetsMinVersion(actual, min);
    const r = runSourced([], `version_ge ${shQuote(actual)} ${shQuote(min)} && printf yes || printf no`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, expected ? 'yes' : 'no', `version_ge ${actual} ${min}`);
  }
});

test('bootstrap.sh detect_build_path matches decideBuildPath (executed)', () => {
  const scenarios = [
    { pnpm: true, cargo: false, frontendDist: false, tauriCli: false, expected: 'pnpm' },
    { pnpm: false, cargo: true, frontendDist: true, tauriCli: true, expected: 'cargo-override' },
    { pnpm: false, cargo: true, frontendDist: true, tauriCli: false, expected: 'install-tauri-cli' },
  ];
  for (const s of scenarios) {
    // Override only the tool probes, then call the real detect_build_path.
    const overrides = `
have() { case "$1" in pnpm) return ${s.pnpm ? 0 : 1} ;; cargo) return ${s.cargo ? 0 : 1} ;; *) return 1 ;; esac; }
frontend_dist_exists() { return ${s.frontendDist ? 0 : 1}; }
tauri_cli_available() { return ${s.tauriCli ? 0 : 1}; }
detect_build_path >/dev/null 2>&1
printf '%s' "$BUILD_PATH"
`;
    const r = runSourced([], overrides);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, s.expected, JSON.stringify(s));
    assert.equal(decideBuildPath(s).path, s.expected, `lib mirrors ${JSON.stringify(s)}`);
  }
});

test('bootstrap.ps1 is only statically checked (not executed on this Linux host)', () => {
  // There is no PowerShell runtime here, so the .ps1 cannot be executed. Only
  // the text invariants below are covered — this test exists to make that
  // limitation explicit instead of implying full coverage.
  const script = readFileSync(join(SCRIPTS_DIR, 'bootstrap.ps1'), 'utf8');
  assert.match(script, /-Ref main/, 'the .EXAMPLE must use PowerShell -Ref, not --Ref');
  assert.doesNotMatch(script, /--Ref\b/, 'PowerShell flags must be documented with a single dash');
  assert.match(script, /Test-TauriCli/, 'the .ps1 must probe for the Tauri CLI');
  assert.match(script, /install-tauri-cli/, 'the .ps1 must mirror the install-tauri-cli outcome');
});

test('bundleArtifactDirs is documented as reference-only (not mirrored by a shell function)', () => {
  const lib = readFileSync(join(SCRIPTS_DIR, 'bootstrap-lib.mjs'), 'utf8');
  assert.match(lib, /REFERENCE ONLY — not mirrored by a named shell function/);
});

