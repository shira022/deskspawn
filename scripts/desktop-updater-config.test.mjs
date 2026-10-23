/**
 * DeskSpawn — デスクトップ版 updater 設定の回帰テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test で scripts/ 配下の .test.mjs を glob 指定）
 *
 * 現状の意図: updater の署名鍵が未整備で bundle.createUpdaterArtifacts も無く、
 * .sig / updater archive がリリースに含まれないため、plugins.updater は設定しない。
 * 設定だけ存在して永久に動かない状態を防ぐため「存在しないこと」を固定する。
 *
 * 将来 plugins.updater を復活させる場合は、実際に更新が動く構成であることを
 * 強制する（存在するときだけ以下を検査する）:
 *   - bundle.createUpdaterArtifacts === true
 *   - plugins.updater.endpoints が非空の配列
 *   - plugins.updater.pubkey が非空の文字列
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

function readConf() {
  return JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
}

test('plugins.updater は設定されていない（未署名のため）', () => {
  const conf = readConf();
  assert.equal(
    conf?.plugins?.updater,
    undefined,
    'plugins.updater が存在する。署名済み updater archive を生成しない限り ' +
      '「設定だけあって動かない」状態になるため、bundle.createUpdaterArtifacts 等の ' +
      '準備が整うまで削除しておくこと。',
  );
});

test('plugins.updater が存在する場合、更新が実際に動く構成になっている', () => {
  const conf = readConf();
  const updater = conf?.plugins?.updater;
  if (updater === undefined) {
    return;
  }

  assert.equal(
    conf?.bundle?.createUpdaterArtifacts,
    true,
    'plugins.updater を設定するなら bundle.createUpdaterArtifacts === true が必要' +
      '（無いと .sig / updater archive が生成されず更新が永久に動かない）。',
  );

  assert.ok(
    Array.isArray(updater.endpoints) && updater.endpoints.length > 0,
    'plugins.updater.endpoints は非空の配列であること',
  );

  assert.equal(
    typeof updater.pubkey,
    'string',
    'plugins.updater.pubkey は文字列であること',
  );
  assert.ok(
    updater.pubkey.length > 0,
    'plugins.updater.pubkey は非空であること',
  );
});
