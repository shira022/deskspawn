// Post-fix verification: re-attack the FIXED build
// Expected behavior after hardening (2026-08-28):
//   rce:        400 DEV_SCRIPT_MODIFIED (scripts.dev != "vite" rejected at /api/preview/start)
//   ssrf-config:400 INVALID_ENDPOINT (http://127.0.0.1 rejected)
//   traversal:  400 (projectId ../ rejected by validateAppIdLike)
//   idb-key:    apiKeyCount === 0 (legacy plaintext swept on desktop)
// Usage: node verify-sec-fixes.cjs
const { chromium } = require('playwright-core');
const crypto = require('crypto');

const CDP = process.env.CDP_URL || 'http://172.28.208.1:9222';
const GATEWAY = process.env.WSL_GW || '172.28.208.1';

function newProjectId() {
  return crypto.randomUUID();
}

async function pageFetch(page, port, token, path, body) {
  // ページコンテキスト（WebView2）から fetch — WSL→Windowsループバックは届かないため
  return page.evaluate(async ({ port, token, path, body }) => {
    const res = await fetch('http://127.0.0.1:' + port + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DeskSpawn-Token': token },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  }, { port, token, path, body });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages()[0];
  const token = await page.evaluate(async () => await window.__TAURI_INTERNALS__.invoke('get_sidecar_token'));
  const port = await page.evaluate(async () => await window.__TAURI_INTERNALS__.invoke('sidecar_port'));
  const out = { port, tokenLen: token.length };

  // ── 1. RCE: package.json with evil dev script → expect DEV_SCRIPT_MODIFIED 400
  {
    const projectId = newProjectId();
    const pkg = {
      name: 'verify', private: true, type: 'module',
      scripts: { dev: "bun -e \"Bun.write('C:/Users/shira/deskspawn/audit-rce-proof-fixed.txt','PWNED')\"" }
    };
    out.rce = await pageFetch(page, port, token, '/api/preview/start', { projectId, files: { 'package.json': JSON.stringify(pkg, null, 2) } });
    out.rceExploitFileExists = require('fs').existsSync('/mnt/c/Users/shira/deskspawn/audit-rce-proof-fixed.txt');
  }

  // ── 2. SSRF: hijack customEndpoint to localhost → expect 400 INVALID_ENDPOINT
  out.ssrfConfig = await pageFetch(page, port, token, '/api/config', { customEndpoint: 'http://127.0.0.1:9999' });

  // ── 2b. SSRF: private IP 192.168.x → expect 400 INVALID_ENDPOINT
  out.ssrfPrivateIp = await pageFetch(page, port, token, '/api/config', { customEndpoint: 'https://192.168.1.10/v1' });

  // ── 3. Traversal: projectId ../ → expect 400
  out.traversal = await pageFetch(page, port, token, '/api/preview/start', { projectId: '../ds-hack-fixed', files: { 'pwn.txt': 'PWNED' } });

  // ── 4. IDB: legacy plaintext api key sweep check
  {
    const r = await page.evaluate(async () => {
      if (!window.indexedDB) return { hasIDB: false };
      const dbs = await window.indexedDB.databases();
      if (!dbs.some(d => d.name === 'deskspawn')) return { hasStore: false, dbs: dbs.map(d => d.name) };
      const db = await new Promise((res, rej) => {
        const req = window.indexedDB.open('deskspawn');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      if (!db.objectStoreNames.contains('settings')) { db.close(); return { hasStore: true, settingsStore: false }; }
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const keys = await new Promise((res, rej) => {
        const req = store.getAllKeys();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const apiKeys = keys.filter(k => String(k).startsWith('api_key_'));
      db.close();
      return { hasStore: true, settingsStore: true, apiKeyCount: apiKeys.length, apiKeys: apiKeys.map(String) };
    });
    out.idbKey = r;
  }

  console.log(JSON.stringify(out, null, 1));
  await browser.close();
}

main().catch(e => { console.log('ERR: ' + e.message); process.exit(1); });