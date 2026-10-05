/**
 * DeskSpawn — scripts/check-i18n-keys.py の回帰テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test で scripts/ 配下の .test.mjs を glob 指定）
 *
 * 見落としのあった t('key', { ... }) 形式（プレースホルダ付きキー）を
 * 検出できること、および現リポジトリが exit 0 であることを検証する。
 * 一時ディレクトリに最小フィクスチャを作り、check-i18n-keys.py を
 * そのフィクスチャへコピーして実行する（ROOT はスクリプト位置から解決される）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(SCRIPTS_DIR, 'check-i18n-keys.py');
const REPO_ROOT = dirname(SCRIPTS_DIR);

/** 指定ディレクトリを root として check-i18n-keys.py を実行する（子プロセス）。 */
function runCheck(rootDir) {
  const fixtureScript = join(rootDir, 'scripts', 'check-i18n-keys.py');
  const script = rootDir === REPO_ROOT ? SCRIPT : fixtureScript;
  return spawnSync('python3', [script], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

/** 最小フィクスチャを作る（スクリプトをコピーして自己完結させる）。 */
function makeFixture({ sourceKeys, locale }) {
  const dir = mkdtempSync(join(tmpdir(), 'check-i18n-keys-'));
  const write = (rel, content) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write('scripts/check-i18n-keys.py', readFileSync(SCRIPT, 'utf8'));
  write('packages/shared/src/locales/ja/common.json', JSON.stringify(locale, null, 2));
  write('packages/shared/src/locales/en/common.json', JSON.stringify(locale, null, 2));
  write(
    'packages/shared/src/sample.ts',
    sourceKeys.map((k) => `export const ${k.replace(/\W/g, '_')} = t('${k}', { name: 'x' });`).join('\n') + '\n',
  );
  return dir;
}

test('現リポジトリは exit 0 (PASS)', () => {
  const r = runCheck(REPO_ROOT);
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /no missing keys/);
});

test("t('key', { ... }) 形式の欠落キーを検出して exit 1", () => {
  const dir = makeFixture({
    sourceKeys: ['chat.error.known', 'chat.error.untracked'],
    locale: { chat: { error: { known: 'Known' } } },
  });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /MISSING in ja/);
    assert.match(r.stdout, /MISSING in en/);
    assert.match(r.stdout, /chat\.error\.untracked/);
    // 既知キーは欠落として報告されない
    assert.doesNotMatch(r.stdout, /chat\.error\.known\s+<-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("第2引数付きでも全キーが locale にあれば exit 0", () => {
  const dir = makeFixture({
    sourceKeys: ['chat.error.known'],
    locale: { chat: { error: { known: 'Known' } } },
  });
  try {
    const r = runCheck(dir);
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /no missing keys/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
