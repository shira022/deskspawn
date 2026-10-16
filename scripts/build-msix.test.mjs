/**
 * DeskSpawn — scripts/build-msix.mjs の純関数テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test "scripts/**\/*.test.mjs"）
 *
 * 大半は純関数とインメモリ文字列のみで検証する。ステージング許可リストの
 * 回帰（Assets-bak-winapp-default 混入）やバージョン書換の回帰を防止する。
 * ただしペイロード欠落時に旧ステージを破壊しないこと（削除順序）だけは
 * 実プロセスを spawn して検証する。winapp や Windows には触れない。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STAGE_ENTRIES,
  buildOutputFileName,
  buildPackArgs,
  buildPackFlags,
  buildPackInvocation,
  getIdentityName,
  isAllowedStageEntry,
  rewriteManifestVersion,
  selectStageEntries,
  toAppxVersion,
  toWindowsPath,
} from './build-msix.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'build-msix.mjs');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_DIR = join(REPO, 'apps/desktop/src-tauri/target/msix-stage');
const PAYLOAD_PATHS = [
  join(REPO, 'apps/desktop/src-tauri/target/release/deskspawn-desktop.exe'),
  join(REPO, 'apps/desktop/src-tauri/binaries/deskspawn-sidecar-x86_64-pc-windows-msvc.exe'),
];

test('toAppxVersion: 3桁 SemVer は .0 を付与する', () => {
  assert.equal(toAppxVersion('0.5.0'), '0.5.0.0');
  assert.equal(toAppxVersion('1.2.3'), '1.2.3.0');
  assert.equal(toAppxVersion('10.20.30'), '10.20.30.0');
});

test('toAppxVersion: 末尾が 0 の 4桁はそのまま受理する', () => {
  assert.equal(toAppxVersion('0.5.0.0'), '0.5.0.0');
  assert.equal(toAppxVersion('1.2.3.0'), '1.2.3.0');
});

test('toAppxVersion: 4桁目が 0 以外の 4桁は固有メッセージで throw する', () => {
  assert.throws(() => toAppxVersion('0.5.0.1'), (err) => {
    assert.match(err.message, /0\.5\.0\.1/);
    // 「無効なバージョン形式」の generic 分岐と区別できる固有文言。
    // この assert が無いと専用分岐を丸ごと削除しても generic 分岐で
    // throw してしまい、テストが空虚になる（前回の指摘）。
    assert.match(err.message, /4桁目/);
    return true;
  });
});

test('toAppxVersion: 不正な形式は throw し受け取った値がメッセージに含まれる', () => {
  for (const bad of ['0.5', 'v0.5.0', '', '0.5.0-beta', '1.2.3.4.5']) {
    assert.throws(() => toAppxVersion(bad), (err) => {
      assert.match(err.message, /toAppxVersion/);
      assert.ok(err.message.includes(bad), `message should include ${JSON.stringify(bad)}: ${err.message}`);
      return true;
    });
  }
});

test('toAppxVersion: 非文字列は throw し受け取った値がメッセージに含まれる', () => {
  for (const bad of [null, undefined, 5, {}, ['0.5.0']]) {
    assert.throws(() => toAppxVersion(bad), (err) => {
      assert.match(err.message, /toAppxVersion/);
      assert.ok(err.message.length > 0);
      return true;
    });
  }
  assert.throws(() => toAppxVersion(null), /null/);
  assert.throws(() => toAppxVersion(5), /5/);
});

const LF_XML = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<Package>',
  '  <Identity',
  '    Name="shira022.DeskSpawn"',
  '    Publisher="CN=44EAA9A0-7A82-4923-8FB6-B9698B129FDB"',
  '    Version="0.5.0.0" />',
  '  <Properties>',
  '    <Logo>Assets\\StoreLogo.png</Logo>',
  '  </Properties>',
  '  <Extensions>',
  '    <Extension Version="1.2.3.4" />',
  '  </Extensions>',
  '</Package>',
  '',
].join('\n');

test('rewriteManifestVersion: Identity の Version だけを置換し他は不変 (LF)', () => {
  const out = rewriteManifestVersion(LF_XML, '0.5.1.0');
  assert.equal(out, LF_XML.replace('Version="0.5.0.0"', 'Version="0.5.1.0"'));
  assert.match(out, /Name="shira022\.DeskSpawn"/);
  assert.match(out, /Publisher="CN=44EAA9A0-7A82-4923-8FB6-B9698B129FDB"/);
  assert.match(out, /Assets\\StoreLogo\.png/);
  assert.match(out, /<Extension Version="1\.2\.3\.4"/);
  assert.doesNotMatch(out, /Version="0\.5\.0\.0"/);
});

test('rewriteManifestVersion: CRLF 改行でも Identity の Version を置換する', () => {
  const crlf = LF_XML.replace(/\n/g, '\r\n');
  const out = rewriteManifestVersion(crlf, '0.6.0.0');
  assert.equal(out, crlf.replace('Version="0.5.0.0"', 'Version="0.6.0.0"'));
  assert.match(out, /\r\n/);
  assert.match(out, /Version="0\.6\.0\.0"/);
  assert.match(out, /<Extension Version="1\.2\.3\.4"/);
});

test('rewriteManifestVersion: Identity の Version が無ければ throw する', () => {
  assert.throws(() => rewriteManifestVersion('<Package></Package>', '0.5.0.0'), /Identity/);
});

test('rewriteManifestVersion: コメント内の <Identity> には反応せず本体のみ置換しコメントを保持する', () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- <Identity Version="9.9.9.9"/> -->',
    '<Package>',
    '  <Identity',
    '    Name="fixture.DeskSpawn"',
    '    Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
  const out = rewriteManifestVersion(xml, '0.6.0.0');
  // 本体の Version は置換される
  assert.match(out, /Version="0\.6\.0\.0"/);
  assert.doesNotMatch(out, /Version="0\.5\.0\.0"/);
  // コメントは除去されず、コメント内の Version は不変
  assert.match(out, /<!-- <Identity Version="9\.9\.9\.9"\/> -->/);
  assert.equal((out.match(/<!--/g) || []).length, 1);
});

test('rewriteManifestVersion: コメント内にしか <Identity> が無ければ throw する', () => {
  const xml = '<!-- <Identity Version="9.9.9.9"/> -->\n<Package></Package>';
  assert.throws(() => rewriteManifestVersion(xml, '0.5.0.0'), /Identity/);
});

test('rewriteManifestVersion: 未終端の <!-- があれば throw する（コメント内を書き換えない）', () => {
  const xml =
    '<!-- oops <Identity Version="9.9.9.9"/>\n<Package><Identity Version="0.5.0.0"/></Package>';
  assert.throws(() => rewriteManifestVersion(xml, '0.6.0.0'), /未終端/);
});

test('rewriteManifestVersion: --> だけ余分にある場合も throw する', () => {
  const xml = '<Package>--><Identity Version="0.5.0.0"/></Package>';
  assert.throws(() => rewriteManifestVersion(xml, '0.6.0.0'), /未終端/);
});

test('rewriteManifestVersion: テストA コメントが本物より前にある場合もインデックスとコメントを保つ', () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- <Identity Version="9.9.9.9"/> -->',
    '<Package>',
    '  <Identity Name="fixture.DeskSpawn" Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
  const out = rewriteManifestVersion(xml, '0.6.0.0');
  assert.equal(out.length, xml.length, '出力長は入力と等しい（インデックス保存）');
  assert.match(out, /Version="0\.6\.0\.0"/);
  assert.doesNotMatch(out, /Version="0\.5\.0\.0"/);
  assert.match(out, /<!-- <Identity Version="9\.9\.9\.9"\/> -->/);
  assert.match(out, /9\.9\.9\.9/);
});

test('rewriteManifestVersion: テストB コメントが2つあっても本物だけを書き換える', () => {
  const xml = [
    '<Package>',
    '<!-- first comment -->',
    '<!-- <Identity Version="8.8.8.8"/> -->',
    '  <Identity Name="fixture.DeskSpawn" Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
  const out = rewriteManifestVersion(xml, '0.6.0.0');
  assert.equal(out.length, xml.length, '出力長は入力と等しい（インデックス保存）');
  assert.match(out, /Version="0\.6\.0\.0"/);
  assert.doesNotMatch(out, /Version="0\.5\.0\.0"/);
  assert.match(out, /Version="8\.8\.8\.8"/);
  assert.equal((out.match(/<!--/g) || []).length, 2);
});

test('rewriteManifestVersion: テストC 未終端の <!-- はメッセージに「未終端」を含めて throw する', () => {
  const xml = '<!-- broken <Identity Version="9.9.9.9"/>\n<Package><Identity Version="0.5.0.0"/></Package>';
  assert.throws(() => rewriteManifestVersion(xml, '0.6.0.0'), (err) => {
    assert.match(err.message, /未終端/);
    return true;
  });
});

test('rewriteManifestVersion: テストD コメント本体の <!-- は入れ子にせず throw しない', () => {
  const xml = [
    '<Package>',
    '<!-- x <!-- y -->',
    '  <Identity Name="fixture.DeskSpawn" Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
  const out = rewriteManifestVersion(xml, '0.6.0.0');
  assert.equal(out.length, xml.length, '出力長は入力と等しい（インデックス保存）');
  assert.match(out, /Version="0\.6\.0\.0"/);
  assert.doesNotMatch(out, /Version="0\.5\.0\.0"/);
  assert.match(out, /<!-- x <!-- y -->/);
});

test('rewriteManifestVersion: テストE CRLF でも同じく本物だけを書き換える', () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- <Identity Version="9.9.9.9"/> -->',
    '<Package>',
    '  <Identity Name="fixture.DeskSpawn" Version="0.5.0.0" />',
    '</Package>',
    '',
  ]
    .join('\n')
    .replace(/\n/g, '\r\n');
  const out = rewriteManifestVersion(xml, '0.6.0.0');
  assert.equal(out.length, xml.length, '出力長は入力と等しい（インデックス保存）');
  assert.match(out, /Version="0\.6\.0\.0"/);
  assert.doesNotMatch(out, /Version="0\.5\.0\.0"/);
  assert.match(out, /<!-- <Identity Version="9\.9\.9\.9"\/> -->/);
  assert.match(out, /9\.9\.9\.9/);
});

test('許可リスト: Package.appxmanifest と Assets 直下の png のみ', () => {
  assert.equal(isAllowedStageEntry('Package.appxmanifest'), true);
  assert.equal(isAllowedStageEntry('Assets/MedTile.png'), true);
  assert.equal(isAllowedStageEntry('Assets/StoreLogo.png'), true);
  assert.equal(isAllowedStageEntry('Assets/AppList.scale-200.png'), true);
});

test('回帰防止: Assets-bak-winapp-default は許可リストに含まれない', () => {
  const backedPaths = [
    'Assets-bak-winapp-default/MedTile.png',
    'Assets-bak-winapp-default/StoreLogo.png',
    'Assets-bak-winapp-default',
  ];
  for (const p of backedPaths) {
    assert.equal(isAllowedStageEntry(p), false, `${p} は許可されてはならない`);
    assert.ok(!STAGE_ENTRIES.includes(p), `${p} は STAGE_ENTRIES に含まれてはならない`);
  }
  // サブディレクトリ・非 png も弾く
  assert.equal(isAllowedStageEntry('Assets/sub/MedTile.png'), false);
  assert.equal(isAllowedStageEntry('Assets/readme.txt'), false);
  assert.equal(isAllowedStageEntry('Assets'), false);
  assert.equal(isAllowedStageEntry('other/MedTile.png'), false);
});

test('selectStageEntries: バックアップやサブディレクトリを除外してソートする', () => {
  const input = [
    'Assets/MedTile.png',
    'Assets-bak-winapp-default/MedTile.png',
    'Package.appxmanifest',
    'Assets/sub/WideTile.png',
    'Assets/StoreLogo.png',
    'Assets/notes.txt',
  ];
  assert.deepEqual(selectStageEntries(input), [
    'Assets/MedTile.png',
    'Assets/StoreLogo.png',
    'Package.appxmanifest',
  ]);
});

test('getIdentityName: manifest 断片から <Identity Name> を取り出す', () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Package>',
    '  <Identity',
    '    Name="shira022.DeskSpawn"',
    '    Publisher="CN=44EAA9A0-7A82-4923-8FB6-B9698B129FDB"',
    '    Version="0.5.0.0" />',
    '</Package>',
    '',
  ].join('\n');
  assert.equal(getIdentityName(xml), 'shira022.DeskSpawn');
});

test('getIdentityName: Name が無ければ null を返す', () => {
  assert.equal(getIdentityName('<Identity Publisher="CN=abc" Version="0.5.0.0" />'), null);
  assert.equal(getIdentityName('<Package></Package>'), null);
});

test('buildOutputFileName: <Identity Name>_<X.Y.Z.0>_x64.msix を組み立てる', () => {
  assert.equal(
    buildOutputFileName('shira022.DeskSpawn', '0.5.0.0'),
    'shira022.DeskSpawn_0.5.0.0_x64.msix',
  );
  assert.equal(buildOutputFileName('app', '1.2.3.0'), 'app_1.2.3.0_x64.msix');
});

test('buildPackArgs: 既定は --generate-cert と --publisher を付ける', () => {
  const args = buildPackArgs('/stage', { publisher: 'CN=abc' });
  assert.deepEqual(args, ['pack', '/stage', '--generate-cert', '--publisher', 'CN=abc']);
});

test('buildPackArgs: --no-sign では --generate-cert を付けない', () => {
  const args = buildPackArgs('/stage', { publisher: 'CN=abc', noSign: true });
  assert.deepEqual(args, ['pack', '/stage', '--no-sign']);
});

test('toWindowsPath: /mnt/<drive>/... を C:\\... へ変換しドライブ文字を大文字化する', () => {
  assert.equal(toWindowsPath('/mnt/c/Users/example/app'), 'C:\\Users\\example\\app');
  assert.equal(toWindowsPath('/mnt/d/foo/bar'), 'D:\\foo\\bar');
  assert.equal(toWindowsPath('/mnt/e/a/b/c'), 'E:\\a\\b\\c');
});

test('toWindowsPath: 大文字ドライブ入力も大文字 C:\\ に正規化する', () => {
  assert.equal(toWindowsPath('/mnt/C/Users/example/app'), 'C:\\Users\\example\\app');
  assert.equal(toWindowsPath('/mnt/C'), 'C:\\');
  assert.equal(toWindowsPath('/mnt/C/'), 'C:\\');
});

test('toWindowsPath: 大文字小文字が混在したパスを正規化する', () => {
  assert.equal(toWindowsPath('/mnt/c/Users/example'), 'C:\\Users\\example');
  assert.equal(toWindowsPath('/mnt/C/Users/example'), 'C:\\Users\\example');
  assert.equal(
    toWindowsPath('/mnt/c/Users/example/app'),
    'C:\\Users\\example\\app',
  );
});

test('toWindowsPath: 非マッチや既に Windows 形式は null を返す（破綻しない）', () => {
  assert.equal(toWindowsPath('/home/example/x'), null);
  assert.equal(toWindowsPath('relative/path'), null);
  assert.equal(toWindowsPath('C:\\Users\\example'), null);
  assert.equal(toWindowsPath('/mnt/cc/Users'), null);
  assert.equal(toWindowsPath(null), null);
  assert.equal(toWindowsPath(undefined), null);
});

test('toWindowsPath: 末尾スラッシュ除去と /mnt/c 単体を扱える', () => {
  assert.equal(toWindowsPath('/mnt/c'), 'C:\\');
  assert.equal(toWindowsPath('/mnt/c/'), 'C:\\');
  assert.equal(toWindowsPath('/mnt/c/Users/example/'), 'C:\\Users\\example');
  assert.equal(toWindowsPath('/mnt/d//foo//bar/'), 'D:\\foo\\bar');
});

test('buildPackArgs: --output が --no-sign 経路でも必ず入る', () => {
  const args = buildPackArgs('/stage', { noSign: true, output: '/stage/app_0.5.0.0_x64.msix' });
  assert.deepEqual(args, [
    'pack',
    '/stage',
    '--no-sign',
    '--output',
    '/stage/app_0.5.0.0_x64.msix',
  ]);
});

test('buildPackArgs: --output が --generate-cert --publisher 経路でも必ず入る', () => {
  const args = buildPackArgs('/stage', {
    publisher: 'CN=abc',
    output: '/stage/app_0.5.0.0_x64.msix',
  });
  assert.deepEqual(args, [
    'pack',
    '/stage',
    '--generate-cert',
    '--publisher',
    'CN=abc',
    '--output',
    '/stage/app_0.5.0.0_x64.msix',
  ]);
});

test('buildPackFlags: 出力先を常に含め、パスは呼び出し側の形式のまま返す', () => {
  assert.deepEqual(buildPackFlags({ noSign: true, output: 'C:\\stage\\app.msix' }), [
    '--no-sign',
    '--output',
    'C:\\stage\\app.msix',
  ]);
  assert.deepEqual(
    buildPackFlags({ publisher: 'CN=abc', output: 'C:\\stage\\app.msix' }),
    ['--generate-cert', '--publisher', 'CN=abc', '--output', 'C:\\stage\\app.msix'],
  );
});

test('buildPackInvocation: win32 は winapp をネイティブパスのまま使う', () => {
  const inv = buildPackInvocation('/stage', '/stage/app_0.5.0.0_x64.msix', {
    publisher: 'CN=abc',
    platform: 'win32',
  });
  assert.deepEqual(inv, {
    command: 'winapp',
    args: [
      'pack',
      '/stage',
      '--generate-cert',
      '--publisher',
      'CN=abc',
      '--output',
      '/stage/app_0.5.0.0_x64.msix',
    ],
  });
});

test('buildPackInvocation: 非 win32 は winapp.exe と Windows 形式パスを使う（--no-sign / --output 込み）', () => {
  const stage = '/mnt/c/Users/example/repo/apps/desktop/src-tauri/target/msix-stage';
  const out = `${stage}/app_0.5.0.0_x64.msix`;
  const inv = buildPackInvocation(stage, out, { noSign: true, platform: 'linux' });
  assert.equal(inv.command, 'winapp.exe');
  assert.deepEqual(inv.args, [
    'pack',
    'C:\\Users\\example\\repo\\apps\\desktop\\src-tauri\\target\\msix-stage',
    '--no-sign',
    '--output',
    'C:\\Users\\example\\repo\\apps\\desktop\\src-tauri\\target\\msix-stage\\app_0.5.0.0_x64.msix',
  ]);
});

test('buildPackInvocation: 非 win32 の --generate-cert 経路でも --output が Windows 形式で入る', () => {
  const stage = '/mnt/d/stage';
  const out = '/mnt/d/stage/app_0.6.0.0_x64.msix';
  const inv = buildPackInvocation(stage, out, { publisher: 'CN=abc', platform: 'linux' });
  assert.equal(inv.command, 'winapp.exe');
  assert.deepEqual(inv.args, [
    'pack',
    'D:\\stage',
    '--generate-cert',
    '--publisher',
    'CN=abc',
    '--output',
    'D:\\stage\\app_0.6.0.0_x64.msix',
  ]);
});

test('buildPackInvocation: 非 win32 で Windows から見えないパスは null を返す', () => {
  assert.equal(
    buildPackInvocation('/home/example/stage', '/home/example/stage/app.msix', { platform: 'linux' }),
    null,
  );
  // stage は見えるが output が見えない場合も null。
  assert.equal(
    buildPackInvocation('/mnt/c/stage', '/home/example/stage/app.msix', { platform: 'linux' }),
    null,
  );
});

test('ペイロード欠落時はステージ削除より前に exit 1 し旧ステージを保持する', (t) => {
  if (PAYLOAD_PATHS.some((p) => existsSync(p))) {
    t.skip('ペイロードが存在する環境ではステージ削除より後に到達するためスキップ');
    return;
  }
  if (existsSync(STAGE_DIR)) {
    t.skip('実ステージが既存のためスキップ（破壊を避ける）');
    return;
  }

  mkdirSync(STAGE_DIR, { recursive: true });
  const sentinel = join(STAGE_DIR, 'SENTINEL.txt');
  writeFileSync(sentinel, 'previous stage must survive a missing payload\n');
  try {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(
      existsSync(sentinel),
      'ペイロード欠落で失敗する場合、既存ステージを削除してはならない',
    );
  } finally {
    rmSync(STAGE_DIR, { recursive: true, force: true });
  }
});
