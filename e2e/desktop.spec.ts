/**
 * DeskSpawn デスクトップ E2E — ユーザー目線のUI/UX検証
 *
 * 実行中の WebView2 へ CDP で接続し、実際の画面操作で検証する。
 * アプリの状態はテスト間で共有される(実アプリ)ため直列実行。
 *
 * APIキーは DESKSPAWN_API_KEY 環境変数、無ければ ~/.hermes/config.yaml から読む。
 * (コミット禁止: テストファイルにキーを直書きしないこと)
 */
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'fs';

const CDP_URL = process.env.CDP_URL || 'http://172.28.208.1:9222';
const ENDPOINT = 'https://opencode.ai/zen/go/v1';
const MODEL = 'deepseek-v4-flash';

let browser: Browser;
let page: Page;

function getApiKey(): string {
  if (process.env.DESKSPAWN_API_KEY) return process.env.DESKSPAWN_API_KEY;
  try {
    const raw = readFileSync('/home/shira/.hermes/config.yaml', 'utf8');
    const m = raw.match(/api_key:\s*(\S+)/);
    if (m) return m[1].trim();
  } catch {
    /* ignore */
  }
  return '';
}

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  page = ctx.pages()[0];
  await page.bringToFront();

  // 前回実行の状態が残っていると各テストの前提（フレッシュ状態）が崩れる。
  // ローカルストレージをクリアし、デスクトップのルート設定だけ再適用して
  // 毎回クリーンな状態から開始する（E2Eの再現性確保）。
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('deskspawn_route', '/app');
  });
  await page.reload();
  await page.waitForTimeout(1000);

  // 初回起動時は言語選択画面（LanguageSelect）が表示される。
  // データクリーンアップ後など新規環境では必ず通るため、日本語を選択して
  // メイン画面に進む（クリーンな環境でのE2E再現性のため）。
  const langJapanese = page.getByRole('button', { name: /日本語/ });
  if (await langJapanese.isVisible().catch(() => false)) {
    await langJapanese.click();
    await page.waitForTimeout(800);
  }

  // 言語選択後はランディングページが表示される（「今すぐ始める」/「使ってみる」）。
  // 新規環境では必ず通るため、メイン画面まで進める。
  const startBtn = page.getByRole('button', { name: '今すぐ始める' });
  const tryBtn = page.getByRole('button', { name: '使ってみる' });
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
  } else if (await tryBtn.isVisible().catch(() => false)) {
    await tryBtn.click();
  }
  // メイン画面（新規アプリボタン）が表示されるまで待つ
  await page.getByRole('button', { name: '新規アプリ' }).waitFor({ timeout: 15_000 }).catch(() => {});
});

test.afterAll(async () => {
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ── ヘルパー ─────────────────────────────────────────────────────────────

/** ツールバーのモデルセレクタ → ポップオーバー → 「APIキー設定」でフル設定ダイアログを開く */
async function openAiConfig() {
  // フル設定ダイアログが開いていれば何もしない (h2タイトルで判定 — ポップオーバーの同名ボタンと区別)
  if (await page.getByRole('heading', { name: 'APIキー設定' }).isVisible().catch(() => false)) return;
  const settingsBtn = page.getByRole('button', { name: 'APIキー設定' });
  const goConfigBtn = page.getByRole('button', { name: '設定する' });
  if (await settingsBtn.isVisible().catch(() => false)) {
    // ポップオーバーが既に開いている
    await settingsBtn.click();
  } else if (await goConfigBtn.isVisible().catch(() => false)) {
    await goConfigBtn.click();
  } else {
    // ポップオーバーを開いてからボタンを押す
    await page.locator('div.flex.h-10 button').nth(3).click();
    await settingsBtn.or(goConfigBtn).first().waitFor({ timeout: 5_000 });
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
    } else {
      await goConfigBtn.click();
    }
  }
  await expect(page.getByRole('heading', { name: 'APIキー設定' })).toBeVisible();
}

/** モデル設定ポップオーバーを閉じる — el.click()でReactハンドラを直接発火 (ヒットテストflaky回避) */
async function closeModelPopover(page: Page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '閉じる');
    if (btn) {
      (btn as HTMLButtonElement).click();
      return;
    }
    const backdrop = [...document.querySelectorAll('div')].find((d) =>
      d.className.includes('fixed inset-0'),
    );
    if (backdrop) (backdrop as HTMLElement).click();
  });
}

// ── テスト ─────────────────────────────────────────────────────────────────

test('01: 起動画面 — タイトルと主要UIが表示される', async () => {
  await expect(page).toHaveTitle(/DeskSpawn/);
  await expect(page.getByRole('button', { name: '新規アプリ' })).toBeVisible();
  // AI設定ボタン (未設定時「AI未設定」/設定済み時はモデル名) — ツールバー4番目のボタン
  await expect(page.locator('div.flex.h-10 button').nth(3)).toBeVisible();
  // アプリボタン (未選択時「アプリ未選択」/選択済み時アプリ名) — ツールバー2番目
  await expect(page.locator('div.flex.h-10 button').nth(1)).toBeVisible();
  await expect(page.getByPlaceholder(/作りたいアプリを指示/)).toBeVisible();
});

test('02: AI設定フロー — Customプロバイダーで保存しツールバーに反映', async () => {
  const apiKey = getApiKey();
  expect(apiKey, 'APIキーが必要 (DESKSPAWN_API_KEY か ~/.hermes/config.yaml)').toBeTruthy();

  await openAiConfig();

  // プロバイダー選択 (ネイティブselect)
  const providerSelect = page.locator('select').first();
  await providerSelect.selectOption({ label: 'Custom' });

  // エンドポイント入力
  const endpointInput = page.getByPlaceholder(/http|https|endpoint/i).first();
  await endpointInput.fill(ENDPOINT);

  // APIキー入力 (前回保存済みなら「変更」で入力欄を表示 — ブラウザ内保存バッジ表示中)
  const changeBtn = page.getByRole('button', { name: '変更' });
  if (await changeBtn.isVisible().catch(() => false)) {
    await changeBtn.click();
  }
  const keyInput = page.locator('input[type="password"]').first();
  await keyInput.fill(apiKey);

  // モデルが /models から取得されて select に載るのを待つ
  const modelSelect = page.locator('select').nth(1);
  await expect(modelSelect).toBeVisible();
  // モデル一覧がプロキシ経由でロードされるのを待つ (<option> はドロップダウン未展開時 hidden のため
  // toBeVisible ではなく要素存在で判定)
  const modelOption = modelSelect.locator('option', { hasText: MODEL });
  await expect(modelOption).toHaveCount(1, { timeout: 30_000 });
  await modelSelect.selectOption({ value: MODEL });

  // 保存
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // ダイアログが閉じ、ツールバーにモデル名が反映される
  // (span は sm:inline レスポンシブで小窓時 display:none のため存在ベースで判定)
  await expect(page.getByText('APIキー設定', { exact: true })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('div.flex.h-10').getByText(MODEL)).toHaveCount(1);
});

test('03: チャット送信 — アプリ作成後にAI応答が表示される', async () => {
  // チャットはアプリ必須のため先に作成する (ユーザーの実フロー)
  const appName = `E2E-${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: '新規アプリ' }).click();
  await page.getByPlaceholder(/例: タスク管理アプリ/).fill(appName);
  await page.getByRole('button', { name: '作成' }).click();
  await expect(page.getByRole('button', { name: 'アプリ未選択' })).toBeHidden({
    timeout: 10_000,
  });
  await expect(page.locator('div.flex.h-10').getByText(appName)).toBeVisible();

  // 再実行時も重複しないようユニークなプロンプト (メッセージはアプリ内に蓄積されるため)
  const token = `HELLO_OK_${Date.now().toString().slice(-6)}`;
  const prompt = `Say hello. Reply with exactly: ${token}`;
  const msgCountBefore = await page.locator('[id^="chat-msg-"]').count();

  const input = page.getByPlaceholder(/作りたいアプリを指示/);
  await input.fill(prompt);
  await page.keyboard.press('Control+Enter');

  // ユーザーメッセージが表示される
  await expect(page.getByText(prompt)).toBeVisible();

  // AI応答 (プロキシ経由の実応答) — ユーザー+アシスタントの2メッセージ追加を待つ
  await expect(page.locator('[id^="chat-msg-"]')).toHaveCount(msgCountBefore + 2, {
    timeout: 120_000,
  });
  await expect(page.locator('[id^="chat-msg-"]').last()).toContainText(new RegExp(token), {
    timeout: 30_000,
  });
});

test('04: 新規アプリ — ダイアログが開いてキャンセルできる', async () => {
  await page.getByRole('button', { name: '新規アプリ' }).click();
  await expect(page.getByText('新しいアプリを作成', { exact: true })).toBeVisible();
  await expect(page.getByText('アプリ名', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByText('新しいアプリを作成', { exact: true })).toBeHidden();
});

test('05: モデル設定メニュー — 現在のモデルが表示される', async () => {
  // 前回実行で開きっぱなしのポップオーバーがあれば閉じる
  const popover = page.locator('div.absolute.right-0.top-full');
  if (await popover.isVisible().catch(() => false)) {
    await closeModelPopover(page);
    await expect(popover).toBeHidden();
  }
  // ツールバーのモデル表示ボタンをクリック → ポップオーバーが開く
  const modelBtn = page.locator('div.flex.h-10 button').filter({ hasText: MODEL }).first();
  await modelBtn.click();
  await expect(popover).toBeVisible();
  await page.waitForTimeout(800); // ポップオーバーの入場アニメーション完了待ち (クリック位置安定化)
  // 現在のモデルがセレクトの値として表示されている (option要素はhiddenのため値で検証)
  await expect(popover.locator('select').nth(1)).toHaveValue(MODEL);
  // 後続テストのためにポップオーバーを閉じる — el.click() でReactハンドラを直接発火
  // (Playwrightのヒットテストはウィンドウ右端でflakyになるため force/座標クリックは不採用)
  await closeModelPopover(page);
  await expect(popover).toBeHidden();
});
