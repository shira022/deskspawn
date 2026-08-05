import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SRC = '/mnt/c/Users/shira/deskspawn-projects/preview/unit-test-002';
const PROJECT_ID = 'f659b30c-9208-47e6-996d-339b669ee0ef';

function collectFiles(dir, prefix = '') {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'bun.lock' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, collectFiles(p, rel));
    else out[rel] = fs.readFileSync(p, 'utf-8');
  }
  return out;
}
const files = collectFiles(SRC);

const browser = await chromium.connectOverCDP('http://172.28.208.1:9222');
const page = browser.contexts()[0].pages()[0];
const result = await page.evaluate(async ({ projectId, files }) => {
  const root = await navigator.storage.getDirectory();
  const projectDir = await root.getDirectoryHandle(`project_${projectId}`, { create: true });
  let count = 0;
  for (const [rel, content] of Object.entries(files)) {
    const parts = rel.split('/');
    const fileName = parts.pop();
    let dir = projectDir;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    count++;
  }
  return { injected: count };
}, { projectId: PROJECT_ID, files });
console.log('injected:', JSON.stringify(result));

// ページをリロードして boot を発火
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
console.log('reloaded — waiting for preview boot...');
await page.waitForTimeout(30000);

const st = await page.evaluate(() => {
  const iframe = document.getElementById('preview-iframe');
  const previewArea = [...document.querySelectorAll('div')].find((d) => d.innerText && d.innerText.includes('プレビュー') && d.clientWidth > 400);
  return {
    iframe: !!iframe,
    iframeSrc: iframe ? iframe.src.slice(0, 50) : null,
    previewTail: previewArea ? previewArea.innerText.slice(-120) : null,
  };
});
console.log(JSON.stringify(st, null, 1));
await page.screenshot({ path: '/home/shira/hermes-project/project/deskspawn/final-preview.png' });
await browser.close();
