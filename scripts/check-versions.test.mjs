/**
 * DeskSpawn — scripts/check-versions.mjs の回帰テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test で scripts/ 配下の .test.mjs を glob 指定）
 *        ※ Node 26 の --test はディレクトリ引数（scripts/）をモジュールとして
 *        扱いエラーになるため、ディレクトリ指定ではなく glob 指定を使う。
 *
 * 意図的にバージョンを不一致にしたフィクスチャを一時ディレクトリに構築し、
 * check-versions.mjs の終了コードが 0 / 非 0 になることを検証する。
 * フィクスチャは DESKSPAWN_CHECK_VERSIONS_ROOT 環境変数で差し替える
 * （check-versions.mjs の root 上書きフック）。ネットワーク不要。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-versions.mjs');

/** check-versions.mjs をフィクスチャ root に対して実行する（子プロセス） */
function runCheck(rootDir, expected) {
  const args = expected ? [SCRIPT, expected] : [SCRIPT];
  return spawnSync(process.execPath, args, {
    env: { ...process.env, DESKSPAWN_CHECK_VERSIONS_ROOT: rootDir },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

/** check-versions.mjs が読む全ファイルの相対パス */
const PKG_JSONS = [
  'package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/desktop/sidecar/package.json',
  'packages/ai-core/package.json',
  'packages/config/package.json',
  'packages/shared/package.json',
  'packages/ui/package.json',
];
const TAURI_CONF = 'apps/desktop/src-tauri/tauri.conf.json';
const CARGO_TOML = 'apps/desktop/src-tauri/Cargo.toml';
const CARGO_LOCK = 'apps/desktop/src-tauri/Cargo.lock';

/** 全ファイルを version で揃えたフィクスチャを作る。overrides で意図的な不一致を注入 */
function makeFixture(version, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-versions-'));
  const write = (rel, content) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  for (const p of PKG_JSONS) write(p, JSON.stringify({ name: p, version }, null, 2));
  write(TAURI_CONF, JSON.stringify({ version }, null, 2));
  write(CARGO_TOML, `[package]\nname = "deskspawn-desktop"\nversion = "${version}"\n`);
  write(CARGO_LOCK, `name = "deskspawn-desktop"\nversion = "${version}"\n`);
  for (const [rel, v] of Object.entries(overrides)) {
    write(rel, JSON.stringify({ name: rel, version: v }, null, 2));
  }
  return dir;
}

test('全箇所一致のフィクスチャは exit 0 (PASS)', () => {
  const dir = makeFixture('9.9.9');
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('意図的に不一致にしたフィクスチャは exit 1 (FAIL)', () => {
  const dir = makeFixture('9.9.9', { 'packages/shared/package.json': '9.9.8' });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /FAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tauri.conf.json の不一致も exit 1 で検出される', () => {
  const dir = makeFixture('9.9.9', { [TAURI_CONF]: '9.9.7' });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /FAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('明示期待値と不一致の場合は exit 1', () => {
  const dir = makeFixture('9.9.9');
  try {
    const r = runCheck(dir, '0.4.2');
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});