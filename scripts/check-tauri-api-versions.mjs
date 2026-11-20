#!/usr/bin/env node
/**
 * DeskSpawn — @tauri-apps/api バージョン整合性チェック
 *
 * npm の @tauri-apps/api と Rust クレート tauri の minor が一致しているか検証する。
 * バンドル内 JS とネイティブの不整合を防ぐため、全パッケージの指定を
 * apps/desktop/src-tauri/Cargo.lock の tauri と同一 minor に揃える。
 *
 * 対象マニフェスト（存在するものだけ）:
 *   package.json (root), apps/web, packages/shared, apps/desktop
 *
 * 指定（^2.12.4 / ~2.11.1 / 2.11.1 等）から major.minor を取り出して比較する。
 * workspace:* 記法や未宣言のパッケージはスキップする。
 *
 * 使い方:
 *   node scripts/check-tauri-api-versions.mjs
 *
 * テスト用: 環境変数 DESKSPAWN_CHECK_TAURI_ROOT でリポジトリ root を
 * 差し替え可能（scripts/check-tauri-api-versions.test.mjs がフィクスチャで利用）。
 *
 * 終了コード: 0 = OK / 1 = 不一致あり
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.DESKSPAWN_CHECK_TAURI_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');

const MANIFESTS = [
  'package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
  'apps/desktop/package.json',
];

/** Cargo.lock から tauri クレートの version を読む（[[package]] ブロック単位） */
function crateTauriVersion() {
  try {
    const lock = readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
    for (const block of lock.split(/^\[\[package\]\]$/m)) {
      const name = block.match(/^name = "([^"]+)"/m);
      if (!name || name[1] !== 'tauri') continue;
      const version = block.match(/^version = "([^"]+)"/m);
      if (version) return version[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** バージョン指定から major.minor を取り出す */
function majorMinor(spec) {
  const m = String(spec).match(/(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** package.json の dependencies / devDependencies から @tauri-apps/api の指定を読む */
function tauriApiSpec(relPath) {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
    if (pkg.dependencies && '@tauri-apps/api' in pkg.dependencies) {
      return pkg.dependencies['@tauri-apps/api'];
    }
    if (pkg.devDependencies && '@tauri-apps/api' in pkg.devDependencies) {
      return pkg.devDependencies['@tauri-apps/api'];
    }
    return null;
  } catch {
    return null;
  }
}

const crate = crateTauriVersion();
if (!crate) {
  console.error('NG: apps/desktop/src-tauri/Cargo.lock から tauri の version を読み取れませんでした');
  process.exit(1);
}
const crateMM = majorMinor(crate);

console.log('=== DeskSpawn @tauri-apps/api バージョン整合性チェック ===');
console.log(`  ${'crate tauri'.padEnd(30)} ${crate}`);

let failed = false;
for (const rel of MANIFESTS) {
  const spec = tauriApiSpec(rel);
  if (spec === null) continue;
  if (String(spec).startsWith('workspace:')) continue;

  const specMM = majorMinor(spec);
  if (!specMM || specMM !== crateMM) {
    console.error(`NG: ${rel} spec=${spec} (crate=${crate})`);
    failed = true;
  } else {
    console.log(`  ${'✓'.padEnd(30)} ${rel} ${spec}`);
  }
}

console.log(
  failed
    ? '\nNG: @tauri-apps/api の指定が tauri クレートと一致していません'
    : '\nOK: @tauri-apps/api は全パッケージで tauri クレートと一致しています',
);
process.exit(failed ? 1 : 0);
