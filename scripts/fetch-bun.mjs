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

const key = `${process.platform}-${process.arch}`;
const asset = ASSETS[key];
const checkOnly = process.argv.includes('--check');

function log(status) {
  console.log(`fetch-bun: ${status}`);
}

let tempDir = null;

function cleanup() {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function fail(message) {
  console.error(`fetch-bun: ${message}`);
  cleanup();
  process.exit(1);
}

if (!asset) {
  fail(`unsupported platform ${key} (supported: ${Object.keys(ASSETS).join(', ')})`);
}

const outFile = path.join(outDir, `bun-${asset.triple}${asset.exe === 'bun.exe' ? '.exe' : ''}`);

function readVersionFile() {
  try {
    return fs.readFileSync(versionFile, 'utf8').trim();
  } catch {
    return null;
  }
}

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
tempDir = fs.mkdtempSync(path.join(outDir, '.fetch-bun-'));

function findBinary(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(full);
      if (found) return found;
    } else if (entry.name === asset.exe) {
      return full;
    }
  }
  return null;
}

// Minimal ZIP reader used only when the platform extractor (`unzip`) is not
// installed. Handles the stored/deflate entries Bun publishes.
function extractWithNode(zipPath, destDir) {
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

    if (path.posix.basename(name) !== asset.exe) continue;
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

    const out = path.join(destDir, asset.exe);
    fs.writeFileSync(out, data);
    return out;
  }
  return null;
}

async function main() {
  log(`downloading v${BUN_VERSION} (${asset.file})`);
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

  let result;
  if (process.platform === 'win32') {
    result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tempDir}' -Force`,
      ],
      { stdio: 'ignore' },
    );
  } else {
    result = spawnSync('unzip', ['-o', zipPath, '-d', tempDir], { stdio: 'ignore' });
  }
  let extracted = null;
  if (result.error || result.status !== 0) {
    // `unzip` is not guaranteed to exist on Linux; fall back to reading the
    // archive directly with Node so fetching still works on a bare host.
    try {
      extracted = extractWithNode(zipPath, tempDir);
    } catch (err) {
      fail(`failed to extract archive: ${err.message}`);
    }
  }
  if (!extracted) {
    extracted = findBinary(tempDir);
  }
  if (!extracted) {
    fail(`could not find ${asset.exe} in the downloaded archive`);
  }

  fs.copyFileSync(extracted, outFile);
  if (asset.exe !== 'bun.exe') {
    fs.chmodSync(outFile, 0o755);
  }
  fs.writeFileSync(versionFile, `${BUN_VERSION}\n`);
  log(`installed v${BUN_VERSION} (${path.basename(outFile)})`);
}

main()
  .catch((err) => fail(err.message))
  .finally(cleanup);
