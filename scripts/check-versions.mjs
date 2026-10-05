#!/usr/bin/env node
/**
 * DeskSpawn — バージョン整合性チェック
 *
 * 全バージョン定義箇所が単一バージョン（SemVer 3桁）に一致しているか検証する。
 * リリース前に必ず実行すること（verify スキル Stage 7 / merge スキルの事前条件）。
 *
 * 対象:
 *   package.json (root), apps/web, apps/desktop, apps/desktop/sidecar,
 *   packages/* (ai-core, config, ui),
 *   apps/desktop/src-tauri/tauri.conf.json,
 *   apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/Cargo.lock
 *
 * 使い方:
 *   node scripts/check-versions.mjs            # 全箇所が一致しているか確認
 *   node scripts/check-versions.mjs 0.4.2      # 指定バージョンとの一致を確認
 *
 * テスト用: 環境変数 DESKSPAWN_CHECK_VERSIONS_ROOT でリポジトリ root を
 * 差し替え可能（scripts/check-versions.test.mjs がフィクスチャで利用）。
 *
 * 終了コード: 0 = OK / 1 = 不一致あり
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.DESKSPAWN_CHECK_VERSIONS_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = process.argv[2] || null;

/** JSON の "version" を読む */
function pkgVersion(relPath) {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));
    return pkg.version;
  } catch {
    return null;
  }
}

/** tauri.conf.json の version を読む */
function tauriVersion() {
  try {
    const conf = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
    return conf.version;
  } catch {
    return null;
  }
}

/** Cargo.toml / Cargo.lock の version を読む */
function cargoVersion(relPath) {
  try {
    const m = readFileSync(join(ROOT, relPath), 'utf8').match(/^version\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function cargoLockVersion() {
  try {
    const lock = readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
    const m = lock.match(/name = "deskspawn-desktop"[\s\S]*?version = "([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const targets = [
  ['root package.json', pkgVersion('package.json')],
  ['apps/web', pkgVersion('apps/web/package.json')],
  ['apps/desktop', pkgVersion('apps/desktop/package.json')],
  ['sidecar', pkgVersion('apps/desktop/sidecar/package.json')],
  ['tauri.conf.json', tauriVersion()],
  ['Cargo.toml', cargoVersion('apps/desktop/src-tauri/Cargo.toml')],
  ['Cargo.lock (deskspawn-desktop)', cargoLockVersion()],
  ['packages/ai-core', pkgVersion('packages/ai-core/package.json')],
  ['packages/config', pkgVersion('packages/config/package.json')],
  ['packages/shared', pkgVersion('packages/shared/package.json')],
  ['packages/ui', pkgVersion('packages/ui/package.json')],
];

const versions = new Set(targets.map(([, v]) => v));
let failed = false;

console.log('=== DeskSpawn バージョン整合性チェック ===');
for (const [name, v] of targets) {
  const marker = v ? '✓' : '✗';
  console.log(`  ${marker} ${name.padEnd(28)} ${v ?? '(未定義/読取失敗)'}`);
  if (!v) failed = true;
}

if (EXPECTED) {
  console.log(`\n期待値: ${EXPECTED}`);
  for (const [name, v] of targets) {
    if (v !== EXPECTED) {
      console.log(`  ✗ ${name}: ${v} ≠ ${EXPECTED}`);
      failed = true;
    }
  }
} else if (versions.size !== 1) {
  console.log(`\n不一致: ${versions.size} 種類のバージョンが存在します → ${[...versions].join(', ')}`);
  failed = true;
} else {
  console.log(`\n全箇所一致: ${[...versions][0]}`);
}

console.log(failed ? '\n❌ FAIL: バージョンが統一されていません' : '\n✅ PASS: バージョンは全箇所で統一されています');
process.exit(failed ? 1 : 0);
