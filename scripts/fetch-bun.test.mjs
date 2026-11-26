/**
 * DeskSpawn — regression tests for scripts/fetch-bun.mjs (node:test).
 *
 * Run with: pnpm test:scripts
 * (node --test with a glob over scripts/**\/*.test.mjs)
 *
 * These tests build tiny ZIP archives in a temporary directory inside the
 * repository (never /tmp or $HOME) to exercise the minimal Node ZIP reader and
 * the recursive binary lookup. Importing the module must not run the CLI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { extractWithNode, findBinary } from './fetch-bun.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(SCRIPTS_DIR, '.fetch-bun-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Build a minimal ZIP (stored or deflate) without external dependencies. The
// reader under test does not validate CRCs, so they are left at zero.
function buildZip(entries, method = 0) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data);
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);

    locals.push(local, name, data);
    central.push(cd, name);
    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// Write a nested bun.exe archive and return the ZIP path.
function createNestedBunZip(dir, method = 0, data = Buffer.from('MZ dummy bun binary\n')) {
  const zipPath = path.join(dir, 'bun-windows-x64.zip');
  fs.writeFileSync(
    zipPath,
    buildZip(
      [
        { name: 'bun-windows-x64/', data: Buffer.alloc(0) },
        { name: 'bun-windows-x64/bun.exe', data },
      ],
      method,
    ),
  );
  return zipPath;
}

test('extractWithNode extracts a nested bun.exe and findBinary locates it', (t) => {
  const dir = makeTempDir(t);
  const zipPath = createNestedBunZip(dir);
  const dest = path.join(dir, 'out');
  fs.mkdirSync(dest);

  const extracted = extractWithNode(zipPath, dest, 'bun.exe');
  assert.ok(extracted, 'extractWithNode should return the extracted path');
  assert.equal(path.basename(extracted), 'bun.exe');
  assert.equal(fs.readFileSync(extracted, 'utf8'), 'MZ dummy bun binary\n');

  assert.equal(findBinary(dest, 'bun.exe'), extracted);
});

test('extractWithNode handles deflate-compressed nested entries', (t) => {
  const dir = makeTempDir(t);
  const zipPath = createNestedBunZip(dir, 8, Buffer.from('deflated dummy binary\n'));
  const dest = path.join(dir, 'out');
  fs.mkdirSync(dest);

  const extracted = extractWithNode(zipPath, dest, 'bun.exe');
  assert.ok(extracted);
  assert.equal(fs.readFileSync(extracted, 'utf8'), 'deflated dummy binary\n');
  assert.equal(findBinary(dest, 'bun.exe'), extracted);
});

test('extractWithNode returns null when the archive has no matching binary', (t) => {
  const dir = makeTempDir(t);
  const zipPath = path.join(dir, 'other.zip');
  fs.writeFileSync(zipPath, buildZip([{ name: 'other/readme.txt', data: Buffer.from('hi') }]));
  const dest = path.join(dir, 'out');
  fs.mkdirSync(dest);

  assert.equal(extractWithNode(zipPath, dest, 'bun.exe'), null);
});

test('findBinary returns null when the binary is absent', (t) => {
  const dir = makeTempDir(t);
  fs.mkdirSync(path.join(dir, 'nested', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nested', 'deeper', 'readme.txt'), 'not a binary');

  assert.equal(findBinary(dir, 'bun.exe'), null);
});
