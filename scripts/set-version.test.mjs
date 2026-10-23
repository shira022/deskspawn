/**
 * DeskSpawn — scripts/set-version.py の回帰テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test "scripts/**\/*.test.mjs"）
 *
 * 最小のリポジトリ構造を一時ディレクトリに作り、python3 で set-version.py を
 * 実行する。appxmanifest のコメントアウトされた旧 <Identity> が実体より前に
 * あるとき、実体側だけが更新されコメントは不変であることを検証する
 * （「次回更新の再現性」＝静かな陳腐化を防ぐ）。
 *
 * python3 が無い環境では skip して CI を壊さない。ネットワーク不要。
 * フィクスチャには実在しそうなユーザー名・絶対パスを書かない（例示は example）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT_SRC = join(SCRIPT_DIR, 'set-version.py');

const APPX = 'apps/desktop/store/msix/Package.appxmanifest';

/** 最小の appxmanifest（コメント内の旧 Identity を実体より前に置く） */
function appxManifest() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- <Identity Name="OLD.Name" Publisher="CN=OLD" Version="9.9.9.9" /> -->',
    '<Package>',
    '  <Identity',
    '    Name="example.App"',
    '    Publisher="CN=example"',
    '    Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
}

/**
 * 未終端の <!-- を含む appxmanifest（mask_comments が exit 1 する）。
 * 実体の <Identity> はコメントの後ろに置く。
 */
function appxManifestUnterminated() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Package>',
    '  <!-- <Identity Name="OLD.Name" Version="9.9.9.9" />',
    '  <Identity Name="example.App" Publisher="CN=example" Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
}

/** 対応する <!-- の無い --> を含む appxmanifest（mask_comments が exit 1 する）。 */
function appxManifestStrayClose() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Package>--><Identity Name="example.App" Publisher="CN=example" Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
}

/**
 * 実体の <Identity Version="..."> を持たず、コメント内にのみ持つ appxmanifest。
 * set-version.py はこれ（実体の Identity 検出失敗）を検証段階で検出して exit 1 し、
 * manifest だけ未更新のまま他ファイルを更新するバージョン不整合を作らない。
 */
function appxManifestOnlyComment() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- <Identity Name="OLD.Name" Publisher="CN=OLD" Version="9.9.9.9" /> -->',
    '<Package>',
    '</Package>',
    '',
  ].join('\n');
}

/** 最小のリポジトリ構造を作り、その root を返す。 */
function makeFixture(manifest = appxManifest()) {
  const root = mkdtempSync(join(tmpdir(), 'deskspawn-setver-'));
  const write = (rel, content) => {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  const pkg = (name, version) => JSON.stringify({ name, version }, null, 2);

  write('package.json', pkg('deskspawn-monorepo', '0.5.0'));
  write('apps/web/package.json', pkg('web', '0.5.0'));
  write('apps/desktop/package.json', pkg('desktop', '0.5.0'));
  write('apps/desktop/sidecar/package.json', pkg('deskspawn-sidecar', '0.5.0'));
  write('apps/desktop/src-tauri/tauri.conf.json', JSON.stringify({ version: '0.5.0' }, null, 2));
  write(
    'apps/desktop/src-tauri/Cargo.toml',
    '[package]\nname = "deskspawn-desktop"\nversion = "0.5.0"\n',
  );
  write('packages/ai-core/package.json', pkg('ai-core', '0.5.0'));
  write('packages/config/package.json', pkg('config', '0.5.0'));
  write('packages/shared/package.json', pkg('shared', '0.5.0'));
  write('packages/ui/package.json', pkg('ui', '0.5.0'));
  write(APPX, manifest);

  // set-version.py 自身をコピーして配置（スクリプト内の相対パスをそのまま使う）。
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT_SRC, join(root, 'scripts', 'set-version.py'));
  return root;
}

test('set-version.py: コメント内の旧 Identity を無視し実体の Version だけ更新する', (t) => {
  const root = makeFixture();
  try {
    const r = spawnSync('python3', ['scripts/set-version.py', '1.2.3'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (r.error && r.error.code === 'ENOENT') {
      t.skip('python3 が見つからないためスキップ');
      return;
    }
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

    const appx = readFileSync(join(root, APPX), 'utf8');
    // 実体の Version は更新される
    assert.match(appx, /Version="1\.2\.3\.0"/);
    assert.doesNotMatch(appx, /Version="0\.5\.0\.0"/);
    // コメント内の旧 Version は書き換わらない
    assert.match(appx, /Version="9\.9\.9\.9"/);
    // コメント自体も除去されない
    assert.match(appx, /<!-- <Identity Name="OLD\.Name"/);

    // ルート package.json も 3桁で更新される
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.version, '1.2.3');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// set-version.py は「全件検証 → 一括書き込み」の二段階方式。manifest の検証で
// 失敗した場合は、先頭の package.json すら更新せず（部分書き込みを防いで）exit 1 する。
for (const [label, manifest] of [
  ['未終端の <!--', appxManifestUnterminated()],
  ['対応する <!-- の無い -->', appxManifestStrayClose()],
]) {
  test(`set-version.py: ${label} を含む manifest では exit 1 し部分書き込みしない`, (t) => {
    const root = makeFixture(manifest);
    try {
      const pkgPath = join(root, 'package.json');
      const before = readFileSync(pkgPath, 'utf8');
      const r = spawnSync('python3', ['scripts/set-version.py', '1.2.3'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
      });
      if (r.error && r.error.code === 'ENOENT') {
        t.skip('python3 が見つからないためスキップ');
        return;
      }
      assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
      assert.match(r.stderr, /未終端/);
      // 失敗時は package.json が変更されていない（先頭ファイルの部分書き込み防止）。
      assert.equal(readFileSync(pkgPath, 'utf8'), before);
      assert.equal(JSON.parse(readFileSync(pkgPath, 'utf8')).version, '0.5.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// (A) 対象ファイル欠落: 一覧は全件表示（欠落は NOT FOUND -> -）し、IndexError で
// 途切れない。1件でも欠落があれば検証段階で中断し、何も書き込まず exit 1 する。
test('set-version.py: 対象ファイル欠落時は NOT FOUND を全件表示して exit 1 し何も更新しない', (t) => {
  const root = makeFixture();
  try {
    const pkgPath = join(root, 'package.json');
    const before = readFileSync(pkgPath, 'utf8');
    // 中間のファイルを1つ欠落させる（途中の一覧途切れを検出できる位置）。
    const missingRel = 'packages/ui/package.json';
    rmSync(join(root, missingRel));

    const r = spawnSync('python3', ['scripts/set-version.py', '1.2.3'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (r.error && r.error.code === 'ENOENT') {
      t.skip('python3 が見つからないためスキップ');
      return;
    }
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    // 欠落ファイルは NOT FOUND、3要素目は "-" として表示される。
    assert.match(r.stdout, /packages\/ui\/package\.json: NOT FOUND -> -/);
    // 一覧は全件表示される（最後の appxmanifest まで出力され IndexError で途切れない）。
    assert.match(r.stdout, /apps\/desktop\/store\/msix\/Package\.appxmanifest:/);
    assert.match(r.stderr, /1 件の対象ファイルが見つかりません/);
    // 欠落がある場合は他ファイルを一切更新しない。
    assert.equal(readFileSync(pkgPath, 'utf8'), before);
    assert.equal(JSON.parse(readFileSync(pkgPath, 'utf8')).version, '0.5.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// (B) 実体の <Identity Version="..."> が無い（コメント内にのみ存在）manifest では、
// manifest だけ未更新のまま他ファイルを更新してバージョン不整合を静かに作らず、
// 検証段階で exit 1 する（他のファイルも書き換えない）。
test('set-version.py: 実体に <Identity Version> が無い manifest では exit 1 し更新しない', (t) => {
  const root = makeFixture(appxManifestOnlyComment());
  try {
    const pkgPath = join(root, 'package.json');
    const before = readFileSync(pkgPath, 'utf8');
    const appxPath = join(root, APPX);
    const appxBefore = readFileSync(appxPath, 'utf8');

    const r = spawnSync('python3', ['scripts/set-version.py', '1.2.3'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (r.error && r.error.code === 'ENOENT') {
      t.skip('python3 が見つからないためスキップ');
      return;
    }
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /実体に <Identity Version="\.\.\."> が見つかりません/);
    // 他ファイルも manifest も書き換えられていない。
    assert.equal(readFileSync(pkgPath, 'utf8'), before);
    assert.equal(JSON.parse(readFileSync(pkgPath, 'utf8')).version, '0.5.0');
    assert.equal(readFileSync(appxPath, 'utf8'), appxBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
