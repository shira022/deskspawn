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
 *   apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/Cargo.lock,
 *   apps/desktop/store/msix/Package.appxmanifest (期待値は 3桁 + .0)
 *
 * 非 appx ターゲットは生値の 3桁 SemVer (X.Y.Z) でのみ比較し、4桁値は受理しない。
 * appxmanifest だけは MSIX 必須の 4桁 (X.Y.Z.0) として検証し、比較時のみ
 * 3桁部分に落として他のターゲットと突き合わせる。
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

import { maskXmlComments } from './lib/xml-comments.mjs';

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

/** Package.appxmanifest の <Identity ... Version="..."> を読む（4桁 MSIX バージョン） */
function appxVersion() {
  try {
    const xml = readFileSync(join(ROOT, 'apps/desktop/store/msix/Package.appxmanifest'), 'utf8');
    // コメントアウトされた旧 <Identity> を実体と誤認しないようマスクしてから読む。
    // maskXmlComments は等長置換でマッチ位置を保つ（ここでは値の取得のみ）。
    const m = maskXmlComments(xml).match(/<Identity\b[^>]*?\bVersion="([^"]*)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** 非 appx ターゲットは生値の 3桁 SemVer (X.Y.Z) でなければならない */
const SEMVER_3_RE = /^\d+\.\d+\.\d+$/;
/** appxmanifest は MSIX 必須の 4桁 (X.Y.Z.0) でなければならない */
const APPX_VERSION_RE = /^\d+\.\d+\.\d+\.0$/;

const appxRaw = appxVersion();
const appxShapeOk = typeof appxRaw === 'string' && APPX_VERSION_RE.test(appxRaw);
// appxmanifest は比較時のみ 4桁末尾 .0 を落として 3桁部分にそろえる。
// 形が不正な場合は生値のまま扱い、形の検証で別途 FAIL させる。
const appxComparable = appxShapeOk ? appxRaw.replace(/\.0$/, '') : appxRaw;

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

const versions = new Set([...targets.map(([, v]) => v), appxComparable]);
let failed = false;

console.log('=== DeskSpawn バージョン整合性チェック ===');
for (const [name, v] of targets) {
  const marker = v ? '✓' : '✗';
  console.log(`  ${marker} ${name.padEnd(28)} ${v ?? '(未定義/読取失敗)'}`);
  if (!v) failed = true;
}
console.log(
  `  ${appxRaw ? '✓' : '✗'} ${'store/msix (appxmanifest)'.padEnd(28)} ${appxRaw ?? '(未定義/読取失敗)'}`,
);
if (!appxRaw) failed = true;

// 非 appx ターゲットは生値で 3桁 SemVer のみ受理する（4桁値の混入を検出）。
for (const [name, v] of targets) {
  if (v && !SEMVER_3_RE.test(v)) {
    console.log(`  ✗ ${name}: ${v} は 3桁 SemVer (X.Y.Z) を期待します`);
    failed = true;
  }
}

// appxmanifest は 4桁 (X.Y.Z.0) 形式でなければならない。
if (appxRaw !== null && !appxShapeOk) {
  console.log(`  ✗ store/msix (appxmanifest): ${appxRaw} は MSIX 必須の 4桁 (X.Y.Z.0) 形式ではありません`);
  failed = true;
}

if (EXPECTED) {
  if (!SEMVER_3_RE.test(EXPECTED)) {
    console.log(`\n不一致: 期待値は 3桁 SemVer (X.Y.Z) で指定してください: ${EXPECTED}`);
    failed = true;
  } else {
    console.log(`\n期待値: ${EXPECTED} (appxmanifest は ${EXPECTED}.0)`);
    for (const [name, v] of targets) {
      if (v !== EXPECTED) {
        console.log(`  ✗ ${name}: ${v} ≠ ${EXPECTED}`);
        failed = true;
      }
    }
    if (appxRaw !== `${EXPECTED}.0`) {
      console.log(`  ✗ store/msix (appxmanifest): ${appxRaw} ≠ ${EXPECTED}.0`);
      failed = true;
    }
  }
} else if (versions.size !== 1) {
  console.log(`\n不一致: ${versions.size} 種類のバージョンが存在します → ${[...versions].join(', ')}`);
  failed = true;
} else if (!failed) {
  console.log(`\n全箇所一致: ${[...versions][0]}`);
}

console.log(failed ? '\n❌ FAIL: バージョンが統一されていません' : '\n✅ PASS: バージョンは全箇所で統一されています');
process.exit(failed ? 1 : 0);
