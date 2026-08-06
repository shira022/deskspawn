import { defineConfig } from '@playwright/test';

/**
 * DeskSpawn Web E2E — Chromium で Web 版（dev サーバー）をユーザー目線で検証
 *
 * 前提: pnpm --filter web dev --port 5178 が起動していること
 * 実行: npx playwright test --config playwright.web.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /web\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5178',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
});
