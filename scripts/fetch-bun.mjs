#!/usr/bin/env node
// Fetch the pinned Bun runtime used for previews and bundle it as a Tauri
// external binary. External-dependency-free; requires Node.js 20+.
//
// Usage:
//   node scripts/fetch-bun.mjs          # download + verify + extract
//   node scripts/fetch-bun.mjs --check  # verify an already-fetched runtime

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const BUN_VERSION = '1.3.14';

const ASSETS = {
  'win32-x64': {
    file: 'bun-windows-x64.zip',
    sha256: '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922',
    triple: 'x86_64-pc-windows-msvc',
    exe: 'bun.exe',
  },
  'linux-x64': {
    file: 'bun-linux-x64.zip',
    sha256: '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f',
    triple: 'x86_64-unknown-linux-gnu',
    exe: 'bun',
  },
  'darwin-arm64': {
    file: 'bun-darwin-aarch64.zip',
    sha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
    triple: 'aarch64-apple-darwin',
    exe: 'bun',
  },
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const outDir = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'binaries');
const versionFile = path.join(outDir, '.bun-version');

const platformKey = `${process.platform}-${process.arch}`;
const platformAsset = ASSETS[platformKey];

function log(status) {
  console.log(`fetch-bun: ${status}`);
}

let tempDir = null;

function cleanup() {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
}

function fail(message) {
  console.error(`fetch-bun: ${message}`);
  cleanup();
  process.exit(1);
}

function readVersionFile() {
  try {
    return fs.readFileSync(versionFile, 'utf8').trim();
  } catch {
    return null;
  }
}

export function findBinary(dir, exeName = platformAsset?.exe) {
  if (!exeName) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(full, exeName);
      if (found) return found;
    } else if (entry.name === exeName) {
      return full;
    }
  }
  return null;
}

// Minimal ZIP reader. Handles the stored/deflate entries Bun publishes and
// keeps the archive's directory structure so findBinary() can locate nested
// binaries (e.g. bun-windows-x64/bun.exe).
export function extractWithNode(zipPath, destDir, exeName = platformAsset?.exe) {
  if (!exeName) throw new Error('no executable name supplied');

  const buf = fs.readFileSync(zipPath);
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip end-of-central-directory not found');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('invalid zip central-directory entry');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (path.posix.basename(name) !== exeName) continue;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('invalid zip local-file header');
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`unsupported zip compression method ${method}`);
    }

    const relative = name
      .split('/')
      .filter((part) => part && part !== '.' && part !== '..')
      .join(path.sep);
    const out = path.join(destDir, relative || exeName);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    return out;
  }
  return null;
}

function truncate(value, max = 500) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describeDirectory(dir, limit = 20) {
  const lines = [];

  function walk(current) {
    if (lines.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      lines.push(`<unreadable: ${err.message}>`);
      return;
    }
    for (const entry of entries) {
      if (lines.length >= limit) return;
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full) || '.';
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        walk(full);
      } else {
        let size;
        try {
          size = `${fs.statSync(full).size} bytes`;
        } catch (err) {
          size = `<stat failed: ${err.message}>`;
        }
        lines.push(`${rel} (${size})`);
      }
    }
  }

  walk(dir);
  if (lines.length === 0) return '  (empty)';
  const suffix = lines.length >= limit ? `\n  ... (truncated to ${limit} entries)` : '';
  return lines.map((line) => `  ${line}`).join('\n') + suffix;
}

function toAttempt(name, result) {
  return {
    name,
    status: result.status,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error ? result.error.message : null,
    ok: !result.error && result.status === 0,
  };
}

function formatAttempt(attempt) {
  return [
    `- ${attempt.name}: status=${attempt.status ?? 'n/a'}`,
    `    stdout: ${attempt.stdout || '(empty)'}`,
    `    stderr: ${attempt.stderr || '(empty)'}`,
    ...(attempt.error ? [`    error: ${attempt.error}`] : []),
  ].join('\n');
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPlatformExtractor(zipPath, destDir) {
  if (process.platform === 'win32') {
    return spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destDir)} -Force`,
      ],
      { encoding: 'utf8' },
    );
  }
  return spawnSync('unzip', ['-o', zipPath, '-d', destDir], { encoding: 'utf8' });
}

function extractionFailure(exeName, attempts, dir) {
  return [
    `could not find ${exeName} in the downloaded archive`,
    'extraction attempts:',
    ...attempts.map(formatAttempt),
    `contents of ${dir}:`,
    describeDirectory(dir),
  ].join('\n');
}

function extractArchive(zipPath, destDir, exeName) {
  const attempts = [];
  let extracted = null;

  try {
    extracted = extractWithNode(zipPath, destDir, exeName);
    attempts.push({
      name: 'extractWithNode',
      status: extracted ? 0 : 1,
      stdout: '',
      stderr: extracted ? '' : 'no matching entry found in archive',
      error: null,
      ok: Boolean(extracted),
    });
  } catch (err) {
    attempts.push({
      name: 'extractWithNode',
      status: null,
      stdout: '',
      stderr: truncate(err.message),
      error: null,
      ok: false,
    });
  }

  if (!extracted) {
    const name = process.platform === 'win32' ? 'Expand-Archive' : 'unzip';
    let result = runPlatformExtractor(zipPath, destDir);
    attempts.push(toAttempt(name, result));

    if (process.platform === 'win32' && (result.error || result.status !== 0)) {
      sleepSync(1000);
      result = runPlatformExtractor(zipPath, destDir);
      attempts.push(toAttempt(`${name} (retry)`, result));
    }
  }

  if (!extracted) {
    extracted = findBinary(destDir, exeName);
  }
  if (!extracted) {
    throw new Error(extractionFailure(exeName, attempts, destDir));
  }

  const size = fs.statSync(extracted).size;
  if (size <= 0) {
    throw new Error(
      [
        `extracted ${exeName} is empty (0 bytes)`,
        'extraction attempts:',
        ...attempts.map(formatAttempt),
      ].join('\n'),
    );
  }

  return extracted;
}

async function main() {
  const asset = platformAsset;
  const checkOnly = process.argv.includes('--check');

  if (!asset) {
    fail(`unsupported platform ${platformKey} (supported: ${Object.keys(ASSETS).join(', ')})`);
  }

  const outFile = path.join(outDir, `bun-${asset.triple}${asset.exe === 'bun.exe' ? '.exe' : ''}`);

  if (checkOnly) {
    if (!fs.existsSync(outFile)) {
      fail(`bundled bun is missing (expected bun-${asset.triple}); run node scripts/fetch-bun.mjs`);
    }
    if (readVersionFile() !== BUN_VERSION) {
      fail(`bundled bun version marker is missing or stale; run node scripts/fetch-bun.mjs`);
    }
    log(`ok (v${BUN_VERSION})`);
    process.exit(0);
  }

  if (fs.existsSync(outFile) && readVersionFile() === BUN_VERSION) {
    log(`up to date (v${BUN_VERSION})`);
    process.exit(0);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${asset.file}`;
  log(`downloading v${BUN_VERSION} (${asset.file})`);
  tempDir = fs.mkdtempSync(path.join(outDir, '.fetch-bun-'));

  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    fail(`download failed: ${err.message}`);
  }
  if (!response.ok) {
    fail(`download failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.sha256) {
    fail(`SHA256 mismatch for ${asset.file} (expected ${asset.sha256}, got ${actual})`);
  }
  log('checksum verified');

  const zipPath = path.join(tempDir, asset.file);
  fs.writeFileSync(zipPath, bytes);

  let extracted;
  try {
    extracted = extractArchive(zipPath, tempDir, asset.exe);
  } catch (err) {
    fail(err.message);
  }

  fs.copyFileSync(extracted, outFile);
  if (asset.exe !== 'bun.exe') {
    fs.chmodSync(outFile, 0o755);
  }
  fs.writeFileSync(versionFile, `${BUN_VERSION}\n`);
  log(`installed v${BUN_VERSION} (${path.basename(outFile)})`);
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main()
    .catch((err) => fail(err.message))
    .finally(cleanup);
}
