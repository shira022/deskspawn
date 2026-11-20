/**
 * DeskSpawn — scripts/check-tauri-api-versions.mjs の回帰テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test で scripts/ 配下の .test.mjs を glob 指定）
 *
 * Cargo.lock と package.json のフィクスチャを一時ディレクトリに構築し、
 * check-tauri-api-versions.mjs の終了コードを検証する。
 * フィクスチャは DESKSPAWN_CHECK_TAURI_ROOT 環境変数で差し替える
 * （check-tauri-api-versions.mjs の root 上書きフック）。ネットワーク不要。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-tauri-api-versions.mjs');

/** check-tauri-api-versions.mjs をフィクスチャ root に対して実行する（子プロセス） */
function runCheck(rootDir) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, DESKSPAWN_CHECK_TAURI_ROOT: rootDir },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

/**
 * tauri 本体以外の似た名前（tauri-build / tauri-plugin-*）を含む Cargo.lock。
 * tauri 本体の version だけを拾えていることを確認するため、別名エントリには
 * 異なる version を置く。
 */
function cargoLock(tauriVersion) {
  return [
    '[[package]]',
    'name = "tauri-build"',
    'version = "9.9.9"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
    '[[package]]',
    'name = "tauri-plugin-dialog"',
    'version = "8.8.8"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
    '[[package]]',
    'name = "tauri"',
    `version = "${tauriVersion}"`,
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
  ].join('\n');
}

/** 一時ディレクトリにフィクスチャを作る。pkgSpecs は relPath -> spec（未指定は未宣言） */
function makeFixture(tauriVersion, pkgSpecs) {
  const dir = mkdtempSync(join(tmpdir(), 'check-tauri-api-'));
  const write = (rel, content) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write('apps/desktop/src-tauri/Cargo.lock', cargoLock(tauriVersion));
  for (const [rel, spec] of Object.entries(pkgSpecs)) {
    write(rel, JSON.stringify({ name: rel, dependencies: { '@tauri-apps/api': spec } }, null, 2));
  }
  return dir;
}

test('全パッケージがクレートと同一 minor (~2.11.1 + crate 2.11.5) なら exit 0', () => {
  const dir = makeFixture('2.11.5', {
    'apps/web/package.json': '~2.11.1',
    'packages/shared/package.json': '~2.11.1',
    'apps/desktop/package.json': '~2.11.1',
  });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('不一致 (^2.12.4 + crate 2.11.5) は exit 1 かつ stderr に対象パスが出る', () => {
  const dir = makeFixture('2.11.5', {
    'apps/web/package.json': '^2.12.4',
    'packages/shared/package.json': '~2.11.1',
    'apps/desktop/package.json': '~2.11.1',
  });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /apps\/web\/package\.json/);
    assert.match(r.stdout, /NG/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@tauri-apps/api 未宣言のパッケージは無視される', () => {
  const dir = makeFixture('2.11.5', {
    'apps/web/package.json': '~2.11.1',
    // packages/shared は未宣言（フィクスチャに file 自体を作らない）
    'apps/desktop/package.json': '~2.11.1',
  });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
