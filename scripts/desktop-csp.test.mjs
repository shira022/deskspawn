/**
 * DeskSpawn — デスクトップ版 CSP の回帰テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test で scripts/ 配下の .test.mjs を glob 指定）
 *
 * Tauri v2 は IPC の fetch トランスポートとして http://ipc.localhost/<command> を
 * 使うため、tauri.conf.json の CSP connect-src に ipc: と http://ipc.localhost が
 * 必須。欠けると起動ごとに接続がブロックされ、フォールバック経路に依存する。
 * 既存の許可（localhost の sidecar 等）も失われていないことを検証する。
 * 読み取りのみ・ネットワーク不要・リポジトリ内で自己完結。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAURI_CONF = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/desktop/src-tauri/tauri.conf.json',
);

/** tauri.conf.json の app.security.csp から connect-src ディレクティブの値を返す */
function readConnectSrc() {
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
  const csp = conf?.app?.security?.csp;
  assert.equal(typeof csp, 'string', 'app.security.csp が文字列であること');

  const directive = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === 'connect-src' || d.startsWith('connect-src '));
  assert.ok(directive, `CSP に connect-src ディレクティブが存在すること（csp: ${csp}）`);

  return directive.split(/\s+/).slice(1);
}

test('connect-src に Tauri IPC の fetch トランスポート（ipc: / http://ipc.localhost）が含まれる', () => {
  const sources = readConnectSrc();
  for (const required of ['ipc:', 'http://ipc.localhost']) {
    assert.ok(
      sources.includes(required),
      `connect-src に "${required}" が必要（Tauri v2 の IPC fetch トランスポートが ` +
        `http://ipc.localhost/<command> を使うため。無いと起動ごとにブロックされる）。` +
        `現在: ${sources.join(' ')}`,
    );
  }
});

test('connect-src の既存必須許可が失われていない', () => {
  const sources = readConnectSrc();
  for (const required of [
    "'self'",
    'http://127.0.0.1:*',
    'http://localhost:*',
    'tauri://localhost',
    'https:',
  ]) {
    assert.ok(
      sources.includes(required),
      `connect-src から "${required}" が失われている（削ると sidecar 接続等が壊れる）。` +
        `現在: ${sources.join(' ')}`,
    );
  }
});
