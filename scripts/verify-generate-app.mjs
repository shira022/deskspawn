#!/usr/bin/env node
/**
 * DeskSpawn 実アプリ生成 フル動作検証スクリプト（開発者エージェント向け）
 *
 * 実行中の WebView2 へ CDP で接続し、実際に AI へ指示を送って
 * アプリ生成（コード生成 → チェックポイント → プレビュー）までを検証する。
 *
 * ── 使い方 ─────────────────────────────────────────────────────
 *   # デフォルト: ToDo アプリを作成（固定）
 *   node scripts/verify-generate-app.mjs
 *
 *   # プロンプトを指定（開発者の要望に応じて変更可能）
 *   node scripts/verify-generate-app.mjs "予定管理アプリを作成"
 *
 * ── 環境変数 ────────────────────────────────────────────────────
 *   CDP_URL                   WebView2 CDP エンドポイント (default: http://172.28.208.1:9222)
 *   DESKSPAWN_E2E_REAL=1      実APIモード（必須。未設定なら拒否）
 *   DESKSPAWN_API_KEY         実APIキー（.env から source すること。値はログに出力しない）
 *
 * ── セキュリティ ────────────────────────────────────────────────
 *   ⚠️ 実API を使用する。実コストが発生する。開発者の明示依頼時のみ実行すること。
 *   ⚠️ エージェント自律実行・cron 自動実行は禁止（ADR-015・secure-api-key-e2e スキル）。
 *   ⚠️ キー値は出力しない。trace は無効。
 *
 * ── 出力 ────────────────────────────────────────────────────────
 *   検証結果を JSON で stdout に出力（exit code 0=成功 / 1=失敗）
 *   { ok, appId, appName, prompt, codeGenerated, checkpoints, previewRendered, elapsedMs, error? }
 */
import { chromium } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const CDP_URL = process.env.CDP_URL || 'http://172.28.208.1:9222';
const REAL_API = process.env.DESKSPAWN_E2E_REAL === '1';
const PROMPT = process.argv[2] || 'ToDoアプリを作成して';
const APPS_DIR = process.env.DESKSPAWN_APPS_DIR || '/mnt/c/Users/shira/deskspawn/apps';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 結果を JSON で出力して終了 */
function done(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function main() {
  if (!REAL_API) {
    return done({
      ok: false,
      error: 'DESKSPAWN_E2E_REAL=1 が必要です（実APIモード）。.env を source してから実行してください。',
    });
  }
  if (!process.env.DESKSPAWN_API_KEY) {
    return done({ ok: false, error: 'DESKSPAWN_API_KEY が未設定です。.env を source してください。' });
  }

  const t0 = Date.now();
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const page = browser.contexts()[0].pages()[0];
    await page.bringToFront();

    // 直前の失敗でゾンビ化した backdrop（fixed z-50/z-40）が残ってないか掃除する
    // （既知 pitfall: 失敗時に backdrop が消えず、次のクリックを遮る）
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0.z-50, .fixed.inset-0.z-40').forEach((el) => el.remove());
    });

    // 多重起動チェック: 複数の deskspawn-desktop インスタンスが起動していると
    // プレビュー（サイドカー）が競合し「Project has no package.json」等の
    // 誤エラーになる（実績 2026-08-21）。1インスタンスで実行すること。
    // ここでは page が期待どおり1つに束ねられていることだけ確認する。
    const pages = browser.contexts()[0].pages();
    if (pages.length !== 1) {
      console.warn(`[verify] 警告: CDP に ${pages.length} ページあります。多重起動の可能性が高いため、1インスタンスで実行してください。`);
    }

    // 1. 新規アプリ作成（ユニーク名）
    const appName = `Verify-${Date.now().toString().slice(-6)}`;
    await page.getByRole('button', { name: '新規アプリ' }).click();
    await page.getByPlaceholder(/例: タスク管理アプリ/).fill(appName);
    // 提案ボタン（「ToDoアプリを作成して」等）と衝突しないよう完全一致で
    await page.getByRole('button', { name: '作成', exact: true }).click();

    // 作成後ツールバーに反映されるまで待つ
    await page.waitForFunction(
      (name) => document.body.innerText.includes(name),
      appName,
      { timeout: 15_000 },
    ).catch(() => {
      throw new Error('アプリ作成後のツールバー反映を確認できませんでした');
    });

    // 2. チャット送信（Ctrl+Enter）
    const input = page.getByPlaceholder(/作りたいアプリを指示/);
    await input.fill(PROMPT);
    const msgBefore = await page.locator('[id^="chat-msg-"]').count();
    await page.keyboard.press('Control+Enter');

    // ユーザーメッセージ表示（チャットカウント増加）を確認
    await page.waitForFunction(
      (before) => document.querySelectorAll('[id^="chat-msg-"]').length > before,
      msgBefore,
      { timeout: 15_000 },
    ).catch(() => {
      throw new Error('チャット送信後、ユーザーメッセージが表示されませんでした');
    });

    // 3. AI応答（生成完了）を待つ — メッセージが +2（ユーザー+AI）になるまで
    //    実生成は数分かかるため、最大15分ポーリング
    let aiResponded = false;
    let previewRendered = false;
    for (let i = 0; i < 180; i++) {
      await sleep(5000);
      const count = await page.locator('[id^="chat-msg-"]').count();
      const bodyText = await page.locator('body').innerText();
      const generating = bodyText.includes('生成中') || bodyText.includes('Step ') || bodyText.includes('インストール') || bodyText.includes('開発サーバー');
      // プレビュー iframe が出たら（= Vite dev server 起動 = 生成実質完了）完了
      if (await page.locator('#preview-iframe').count() > 0) {
        previewRendered = true;
        break;
      }
      if (count >= msgBefore + 2 && !generating) {
        aiResponded = true;
        // 応答は来たがまだプレビュー起動中かも → 短く待って iframe を再確認
        for (let j = 0; j < 12; j++) {
          await sleep(5000);
          if (await page.locator('#preview-iframe').count() > 0) {
            previewRendered = true;
            break;
          }
        }
        break;
      }
    }

    // 4. 生成コード・チェックポイントの確認（生成完了後、少し待ってからファイル確認）
    await sleep(3000);
    // apps.json から生成した appName の id を特定する（ディレクトリ mtime は
    // プレビュー起動等で変わるため当てにしない — 実績 2026-08-21）
    let appId = null;
    try {
      const registry = JSON.parse(readFileSync(`${APPS_DIR}/apps.json`, 'utf-8'));
      const hit = registry.find((a) => a.name === appName);
      if (hit) appId = hit.id;
    } catch {
      // registry が読めない場合はディレクトリ走査にフォールバック
      const appDirs = readdirSync(APPS_DIR).filter((d) => d.startsWith('app-'));
      appId = appDirs.sort().pop() ?? null;
    }

    let codeGenerated = false;
    let checkpoints = 0;
    if (appId) {
      const appDir = `${APPS_DIR}/${appId}`;
      const srcDir = `${appDir}/src`;
      codeGenerated = existsSync(srcDir) && readdirSync(srcDir).some((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
      const cpDir = `${appDir}/.deskspawn/checkpoints`;
      if (existsSync(cpDir)) {
        checkpoints = readdirSync(cpDir).filter((f) => f.length === 36).length;
      }
    }

    // 5. プレビュー表示の確認（ループ内で判定済みの previewRendered を使用。
    //    ここで再チェックせず、生成完了時の iframe 検出をそのまま採用する）

    done({
      ok: aiResponded && codeGenerated,
      appId,
      appName,
      prompt: PROMPT,
      aiResponded,
      codeGenerated,
      checkpoints,
      previewRendered,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    done({ ok: false, error: e.message || String(e), elapsedMs: Date.now() - t0 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main();