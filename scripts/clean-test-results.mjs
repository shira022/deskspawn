// 実API E2E 実行後の後片付けスクリプト。
// playwright の trace/report に API キーやプロンプトが残らないよう、実行結果を削除する。
// 実APIモード (DESKSPAWN_E2E_REAL=1) での E2E 後に必ず実行する (self-responsibility 前提)。
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['test-results', 'playwright-report'];

for (const t of targets) {
  const p = join(root, t);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`[clean-test-results] removed ${p}`);
  }
}
console.log('[clean-test-results] done — trace/report cleared (漏洩対策)');
