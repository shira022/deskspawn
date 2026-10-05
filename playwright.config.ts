import { defineConfig } from '@playwright/test';

/**
 * DeskSpawn E2E — WebView2 (Tauri desktop) へのCDP接続テスト
 *
 * 前提:
 *  - DeskSpawn デスクトップアプリが起動中で、WebView2 の remote debugging が有効なこと
 *    (起動時に WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222)
 *  - WSL から Windows の CDP へ到達できること (netsh portproxy + FWルール:
 *    172.28.208.0/20 限定)
 *
 * 実行: pnpm exec playwright test
 *
 * 漏洩対策: 実APIモード (DESKSPAWN_E2E_REAL=1) ではキー/プロンプトが
 * trace.zip に残らないよう trace を無効化する (ダミーモードのみ retain-on-failure)。
 */
const isRealApi = process.env.DESKSPAWN_E2E_REAL === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  // 実アプリ1インスタンスを共有するため直列実行
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    // 実APIモードでは trace をオフ (キー/プロンプト漏洩防止)。ダミーモードは失敗時のみ。
    trace: isRealApi ? 'off' : 'retain-on-failure',
    actionTimeout: 15_000,
  },
});
