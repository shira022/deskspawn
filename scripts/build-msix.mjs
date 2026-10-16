#!/usr/bin/env node
/**
 * DeskSpawn — MSIX パッケージング再現スクリプト
 *
 * これまで Windows 側の手作業で行っていた MSIX のステージングをスクリプト化する。
 * 既定（引数なし）では pack 用のステージングディレクトリを作るだけ。
 * `--pack` を付けると `winapp pack` まで実行する。
 *
 * ステージ先:
 *   apps/desktop/src-tauri/target/msix-stage/   （.gitignore の target/ で除外済み）
 * ステージ元:
 *   apps/desktop/store/msix/
 *
 * 重要: 提出済み MSIX に `Assets-bak-winapp-default/`（winapp 既定アセットの
 * バックアップ）が誤って同梱されていた回帰があるため、ステージングには
 * 許可リスト（STAGE_ENTRIES / isAllowedStageEntry）に一致するものだけをコピーする。
 *
 * 使い方:
 *   node scripts/build-msix.mjs                 # ステージングのみ
 *   node scripts/build-msix.mjs --version 0.5.1 # バージョン明示
 *   node scripts/build-msix.mjs --pack          # ステージング後に winapp pack
 *   node scripts/build-msix.mjs --pack --no-sign # 署名なしで pack（Store 提出用）
 *   node scripts/build-msix.mjs --help
 *
 * 実ユーザー名・絶対ホームパス・OS 固有のユーザー領域パス等は一切埋め込まない。
 * パスはリポジトリ相対で解決し、winapp は PATH から解決する。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const SOURCE_DIR = join(REPO_ROOT, 'apps/desktop/store/msix');
const STAGE_DIR = join(REPO_ROOT, 'apps/desktop/src-tauri/target/msix-stage');
const MANIFEST = 'Package.appxmanifest';

const DESKTOP_EXE = join(REPO_ROOT, 'apps/desktop/src-tauri/target/release/deskspawn-desktop.exe');
const SIDECAR_EXE = join(
  REPO_ROOT,
  'apps/desktop/src-tauri/binaries/deskspawn-sidecar-x86_64-pc-windows-msvc.exe',
);

/** ステージングにコピーしてよいトップレベルエントリの許可リスト。 */
export const STAGE_ENTRIES = [MANIFEST, 'Assets'];

/** 値をエラーメッセージ用に安全に文字列化する。 */
function describe(value) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/**
 * 3桁 SemVer を 4桁の MSIX バージョンに変換する。
 *  - "0.5.0"   -> "0.5.0.0"
 *  - "1.2.3"   -> "1.2.3.0"
 *  - "0.5.0.0" -> "0.5.0.0"（末尾が 0 の 4桁はそのまま受理）
 *  - "0.5.0.1" -> throw（4桁目が 0 以外）
 *  - "0.5" / "v0.5.0" / "" / 非文字列 -> throw
 * @param {unknown} input
 * @returns {string}
 */
export function toAppxVersion(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`toAppxVersion: 文字列を期待しましたが ${describe(input)} を受け取りました`);
  }
  const v = input.trim();
  if (/^\d+\.\d+\.\d+\.0$/.test(v)) return v;
  if (/^\d+\.\d+\.\d+$/.test(v)) return `${v}.0`;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
    throw new Error(`toAppxVersion: 4桁目が 0 以外のバージョンは受理できません: ${describe(input)}`);
  }
  throw new Error(`toAppxVersion: 無効なバージョン形式です: ${describe(input)}`);
}

/**
 * XML コメントの各文字を同数の空白に置換し、元文字列と同じインデックスを保つ。
 *
 * 正規表現でマークアップ終端を扱うと `--!>` 等の取りこぼしで誤検知し得るため、
 * `indexOf` による走査でコメント範囲を求める。XML はコメントの入れ子を許さない
 * ので、最初に見つけた `<!--` から次の `-->` までを 1 コメントとして扱う。
 *
 * `<!--` が未終端（対応する `-->` が無い）、または対応する `<!--` の無い
 * `-->` が現れた場合は、コメント内の <Identity Version> を本物と誤認して
 * 書き換えるのを防ぐため throw する。
 * @param {string} xml
 * @returns {string}
 */
function maskXmlComments(xml) {
  const parts = [];
  let cursor = 0;
  for (;;) {
    const start = xml.indexOf('<!--', cursor);
    const strayClose = xml.indexOf('-->', cursor);
    if (start === -1) {
      if (strayClose !== -1) {
        throw new Error(
          'maskXmlComments: XML コメントが未終端です (対応する <!-- の無い --> があります)。' +
            'マニフェストを確認してください',
        );
      }
      break;
    }
    if (strayClose !== -1 && strayClose < start) {
      throw new Error(
        'maskXmlComments: XML コメントが未終端です (対応する <!-- の無い --> があります)。' +
          'マニフェストを確認してください',
      );
    }
    const end = xml.indexOf('-->', start + 4);
    if (end === -1) {
      throw new Error(
        'maskXmlComments: XML コメントが未終端です (--> が見つかりません)。' +
          'マニフェストを確認してください',
      );
    }
    const closeEnd = end + 3;
    parts.push(xml.slice(cursor, start));
    parts.push(' '.repeat(closeEnd - start));
    cursor = closeEnd;
  }
  parts.push(xml.slice(cursor));
  return parts.join('');
}

/**
 * Package.appxmanifest の <Identity ... Version="..."> の Version 属性だけを
 * appxVersion に置換して返す。LF / CRLF のどちらでも動く。
 * 他の Version 属性や Assets\*.png 等の記述は変更しない。
 * XML コメント内の <Identity ... Version> には反応せず、コメント自体も
 * 除去せず元の構造を保ったまま本物の <Identity> 要素だけを置換する。
 * @param {string} xml
 * @param {string} appxVersion
 * @returns {string}
 */
export function rewriteManifestVersion(xml, appxVersion) {
  if (typeof xml !== 'string') {
    throw new TypeError(`rewriteManifestVersion: xml は文字列を期待しましたが ${describe(xml)} を受け取りました`);
  }
  // コメントを空白化した「同インデックス」の文字列でマッチ位置を求め、
  // 実際の置換は元の xml の値部分だけに適用する（コメントを壊さない）。
  const masked = maskXmlComments(xml);
  const re = /(<Identity\b[^>]*?\sVersion=")([^"]*)(")/;
  const m = masked.match(re);
  if (!m || m.index === undefined) {
    throw new Error('rewriteManifestVersion: <Identity ... Version="..."> が見つかりませんでした');
  }
  const valueStart = m.index + m[1].length;
  const valueEnd = valueStart + m[2].length;
  return xml.slice(0, valueStart) + appxVersion + xml.slice(valueEnd);
}

/**
 * 相対パスがステージング許可リストに含まれるか。
 *  - Package.appxmanifest
 *  - Assets/ 直下の *.png（サブディレクトリ不可）
 * `Assets-bak-.../x.png` のようなバックアップやサブディレクトリは false。
 * @param {string} relPath
 * @returns {boolean}
 */
export function isAllowedStageEntry(relPath) {
  if (relPath === MANIFEST) return true;
  const prefix = 'Assets/';
  if (relPath.startsWith(prefix)) {
    const rest = relPath.slice(prefix.length);
    return rest.length > 0 && !rest.includes('/') && rest.toLowerCase().endsWith('.png');
  }
  return false;
}

/** 与えられた相対パス一覧を許可リストでフィルタし、ソートして返す。 */
export function selectStageEntries(relPaths) {
  return relPaths.filter((p) => isAllowedStageEntry(p)).sort();
}

/** <Identity ... Publisher="..."> の Publisher 値を取り出す（例: CN=...）。 */
function getIdentityPublisher(xml) {
  const m = xml.match(/<Identity\b[^>]*?\sPublisher="([^"]*)"/);
  return m ? m[1] : null;
}

/** <Identity ... Name="..."> の Name 値を取り出す（出力 .msix の名前に使う）。 */
function getIdentityName(xml) {
  const m = xml.match(/<Identity\b[^>]*?\sName="([^"]*)"/);
  return m ? m[1] : null;
}

/**
 * WSL 形式のパス `/mnt/<drive>/...` を Windows 形式 `C:\...` に変換する（純関数）。
 *  - `/mnt/c/Users/example/app` -> `C:\Users\example\app`
 *  - `/mnt/c` / `/mnt/c/` -> `C:\`
 *  - 末尾スラッシュは除去し、区切りは `\` に正規化する。
 *  - `/mnt/...` 形式でない（`/home/...` や既に `C:\...` の入力）は null を返す。
 * @param {unknown} p
 * @returns {string|null}
 */
export function toWindowsPath(p) {
  if (typeof p !== 'string') return null;
  const m = p.match(/^\/mnt\/([a-zA-Z])(?:\/|$)/);
  if (!m) return null;
  const drive = m[1].toUpperCase();
  const rest = p
    .slice(m[0].length)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '\\');
  return rest === '' ? `${drive}:\\` : `${drive}:\\${rest}`;
}

/** winapp pack のオプション列（'pack' と stage を除く）を組み立てる（純関数）。 */
export function buildPackFlags({ publisher = null, noSign = false, output = null } = {}) {
  const args = [];
  if (noSign) {
    args.push('--no-sign');
  } else {
    args.push('--generate-cert');
    if (publisher) args.push('--publisher', publisher);
  }
  // 出力先 .msix は常に明示する（winapp 既定の cwd 依存出力を避ける）。
  if (output) args.push('--output', output);
  return args;
}

/** winapp pack に渡す引数を組み立てる（純関数）。 */
export function buildPackArgs(stageDir, opts = {}) {
  return ['pack', stageDir, ...buildPackFlags(opts)];
}

/** 表示用の winapp pack コマンド文字列（常に引用符付き）。 */
function describePackCommand(stageDir, publisher, noSign, output) {
  const parts = ['winapp', 'pack', `"${stageDir}"`];
  if (noSign) {
    parts.push('--no-sign');
  } else {
    parts.push('--generate-cert');
    if (publisher) parts.push(`--publisher "${publisher}"`);
  }
  if (output) parts.push(`--output "${output}"`);
  return parts.join(' ');
}

/** PowerShell のコマンド文字列用にトークンを引用する（フラグは素のまま、値は引用）。 */
function quoteCommandArg(arg) {
  const s = String(arg);
  if (s.startsWith('-')) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * WSL から `powershell.exe -NoProfile -Command "<文字列>"` で winapp pack を
 * 実行する際のコマンド文字列を組み立てる（純関数）。
 * @param {string} winStage Windows 形式のステージ先
 * @param {string[]} args 'pack' と stage を除いたオプション列（パスは Windows 形式）
 * @returns {string}
 */
export function buildWslPackCommand(winStage, args) {
  const parts = ['winapp', 'pack', quoteCommandArg(winStage)];
  for (const arg of args) parts.push(quoteCommandArg(arg));
  return parts.join(' ');
}

/** ステージ元から許可リストに一致する相対パスを列挙する。 */
function collectStageSources(sourceDir) {
  const out = [];
  if (existsSync(join(sourceDir, MANIFEST))) out.push(MANIFEST);
  const assetsDir = join(sourceDir, 'Assets');
  if (existsSync(assetsDir)) {
    for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
        out.push(`Assets/${entry.name}`);
      }
    }
  }
  return selectStageEntries(out);
}

/**
 * target が未作成でも、実在する最も近い祖先を realpath で解決し、残りの
 * (未作成の) セグメントを連結した「実パス」を返す。
 */
function resolveRealPath(target) {
  let existing = target;
  const tail = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    tail.unshift(basename(existing));
    existing = parent;
  }
  let real;
  try {
    real = realpathSync(existing);
  } catch {
    real = existing;
  }
  return tail.length > 0 ? join(real, ...tail) : real;
}

/**
 * 対象パスがリポジトリ root 配下にあることを保証する。
 * 定数パスに対する字句判定に加え、シンボリックリンクを解決した実パスでも
 * リポジトリ内であることを検証する（リンク経由で外を削除し得ないことの担保）。
 */
function isInsideRepo(target) {
  const rel = relative(REPO_ROOT, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  const realRepo = resolveRealPath(REPO_ROOT);
  const realTarget = resolveRealPath(target);
  const realRel = relative(realRepo, realTarget);
  return realRel !== '' && !realRel.startsWith('..') && !isAbsolute(realRel);
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function fail(msg) {
  console.error(`[build-msix] ${msg}`);
  process.exit(1);
}

function printUsage() {
  console.log(`DeskSpawn — MSIX ステージング再現スクリプト

使い方:
  node scripts/build-msix.mjs [options]

オプション:
  --version <X.Y.Z>  ステージ先 manifest に書くバージョン（既定: root package.json の version）
  --pack             ステージング後に winapp pack を実行する
  --no-sign          --pack 時に署名しない（--generate-cert を付けない。Store 提出用）
  --help, -h         この usage を表示して終了

既定動作:
  引数なしでは apps/desktop/src-tauri/target/msix-stage/ に
  pack 用のステージングディレクトリを作るだけで、winapp pack は実行しない。
  次に実行すべき winapp pack コマンド例を標準出力に表示する。

WSL からの --pack:
  Windows 以外では powershell.exe 経由で winapp を呼ぶ。ステージ先が
  /mnt/<drive>/... にある必要がある（Windows から見えない場所では失敗する）。
  出力 .msix は <stage>/<Identity Name>_<version>_x64.msix に固定する。`);
}

function parseArgs(argv) {
  const opts = { help: false, version: null, pack: false, noSign: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--pack') {
      opts.pack = true;
    } else if (arg === '--no-sign') {
      opts.noSign = true;
    } else if (arg === '--version') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail('--version にはバージョン値 (例: 0.5.1) が必要です');
      }
      opts.version = value;
      i += 1;
    } else {
      fail(`不明な引数です: ${arg}\n--help を参照してください。`);
    }
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printUsage();
    return 0;
  }

  let requestedVersion = opts.version;
  if (!requestedVersion) {
    try {
      requestedVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
    } catch (e) {
      fail(`root package.json の version を読めませんでした: ${e.message}`);
    }
  }

  let appxVersion;
  try {
    appxVersion = toAppxVersion(requestedVersion);
  } catch (e) {
    fail(e.message);
  }

  if (!isInsideRepo(STAGE_DIR)) {
    fail(`ステージ先がリポジトリ外を指しています: ${STAGE_DIR}`);
  }

  const sources = collectStageSources(SOURCE_DIR);
  if (!sources.includes(MANIFEST)) {
    fail(`ステージ元マニフェストが見つかりません: ${join(SOURCE_DIR, MANIFEST)}`);
  }

  const payload = [
    {
      src: DESKTOP_EXE,
      dests: ['deskspawn-desktop.exe'],
      hint: 'cargo-tauri build --no-bundle',
    },
    {
      src: SIDECAR_EXE,
      dests: ['deskspawn-sidecar.exe', 'deskspawn-sidecar-x86_64-pc-windows-msvc.exe'],
      hint: 'bun scripts/build-sidecar.mjs',
    },
  ];

  // ペイロードの存在確認はステージ削除より前に行う。欠落時は旧ステージを
  // 破壊せず exit 1 にする（再ビルド要求で前回のステージを失わないため）。
  const missing = payload.filter((p) => !existsSync(p.src));
  if (missing.length > 0) {
    for (const p of missing) {
      console.error(`[build-msix] 必須ペイロードが見つかりません: ${p.src}`);
      console.error(`              生成コマンド: ${p.hint}`);
    }
    fail(`${missing.length} 件のペイロードが欠落しています。上記コマンドでビルドしてください。`);
  }

  rmSync(STAGE_DIR, { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });

  const copied = [];
  for (const rel of sources) {
    const dest = join(STAGE_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (rel === MANIFEST) {
      const xml = readFileSync(join(SOURCE_DIR, rel), 'utf8');
      writeFileSync(dest, rewriteManifestVersion(xml, appxVersion));
    } else {
      copyFileSync(join(SOURCE_DIR, rel), dest);
    }
    copied.push({ rel, size: statSync(dest).size });
  }

  for (const p of payload) {
    for (const name of p.dests) {
      const dest = join(STAGE_DIR, name);
      copyFileSync(p.src, dest);
      copied.push({ rel: name, size: statSync(dest).size });
    }
  }

  const total = copied.reduce((sum, f) => sum + f.size, 0);
  console.log('=== MSIX ステージング完了 ===');
  console.log(`ステージ先: ${STAGE_DIR}`);
  console.log(`MSIX バージョン: ${appxVersion}`);
  console.log('コピーしたファイル:');
  for (const f of copied) {
    console.log(`  ${f.rel} (${humanSize(f.size)})`);
  }
  console.log(`合計: ${copied.length} ファイル / ${humanSize(total)}`);

  const stagedXml = readFileSync(join(STAGE_DIR, MANIFEST), 'utf8');
  const publisher = getIdentityPublisher(stagedXml);
  const identityName = getIdentityName(stagedXml);
  if (!identityName) {
    fail(`${MANIFEST} の <Identity Name="..."> を取得できませんでした`);
  }

  // 出力 .msix は常に絶対パスで明示する（winapp 既定の cwd 依存出力を避ける）。
  const outputPath = join(STAGE_DIR, `${identityName}_${appxVersion}_x64.msix`);
  const packArgs = buildPackArgs(STAGE_DIR, { publisher, noSign: opts.noSign, output: outputPath });

  console.log('\n次のコマンド (winapp pack):');
  console.log(`  ${describePackCommand(STAGE_DIR, publisher, opts.noSign, outputPath)}`);

  if (opts.pack) {
    if (process.platform === 'win32') {
      console.log('\n[build-msix] winapp pack を実行します...');
      const result = spawnSync('winapp', packArgs, { stdio: 'inherit' });
      if (result.error) {
        if (result.error.code === 'ENOENT') {
          fail('winapp が見つかりません。インストールしてください: winget install microsoft.winappcli --source winget');
        }
        fail(`winapp の実行に失敗しました: ${result.error.message}`);
      }
      if (result.status !== 0) {
        fail(`winapp pack が終了コード ${result.status} で失敗しました`);
      }
    } else {
      // WSL 等の非 Windows 環境では powershell.exe 経由で winapp を呼ぶ。
      const winStage = toWindowsPath(STAGE_DIR);
      const winOutput = toWindowsPath(outputPath);
      if (winStage === null || winOutput === null) {
        fail(
          'stage ディレクトリが Windows から見える場所（/mnt/<drive>/...）にないため pack できません',
        );
      }
      const command = buildWslPackCommand(
        winStage,
        buildPackFlags({ publisher, noSign: opts.noSign, output: winOutput }),
      );
      console.log('\n[build-msix] powershell.exe 経由で winapp pack を実行します...');
      console.log(`  powershell.exe -NoProfile -Command "${command}"`);
      const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
        stdio: 'inherit',
      });
      if (result.error) {
        if (result.error.code === 'ENOENT') {
          fail('powershell.exe が見つかりません。WSL の Windows interop を確認してください');
        }
        fail(`powershell.exe の実行に失敗しました: ${result.error.message}`);
      }
      if (result.status !== 0) {
        fail(`winapp pack (powershell.exe 経由) が終了コード ${result.status} で失敗しました`);
      }
    }

    // pack 後の検証: 出力 .msix が期待した絶対パスに存在するか。
    if (!existsSync(outputPath)) {
      fail(`pack 後の .msix が見つかりません: ${outputPath}`);
    }
    console.log(`OK: ${outputPath} (${humanSize(statSync(outputPath).size)})`);
  }

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
