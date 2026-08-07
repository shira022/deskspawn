/**
 * DeskSpawn デスクトップ E2E — ユーザー目線のUI/UX検証
 *
 * 実行中の WebView2 へ CDP で接続し、実際の画面操作で検証する。
 * アプリの状態はテスト間で共有される(実アプリ)ため直列実行。
 *
 * ── 2つの実行モード ─────────────────────────────────────────────────
 * 1. ダミーモード (デフォルト): 実APIキー不要。ダミーのエンドポイント/モデルで
 *    AI設定フローとUI反映を検証する。CIや外部貢献者でも実行可能。
 * 2. 実APIモード (DESKSPAWN_E2E_REAL=1): 実際のプロバイダーに接続し、
 *    モデル一覧取得とAI応答まで検証する。APIキーが必要。
 *
 * ── 環境変数 (すべて省略可) ─────────────────────────────────────────
 *   DESKSPAWN_E2E_PROVIDER  プロバイダーID (default: custom)
 *   DESKSPAWN_E2E_ENDPOINT  エンドポイントURL (custom/ollama/azure/anthropic)
 *                           (default: http://127.0.0.1:9/v1 — 破棄ポートで意図的に繋がらない)
 *   DESKSPAWN_E2E_MODEL     モデルID (default: e2e-model)
 *   DESKSPAWN_E2E_REGION    AWSリージョン (amazon-bedrock のみ, default: us-east-1)
 *   DESKSPAWN_API_KEY       APIキー (ダミーモードでは不要)
 *   DESKSPAWN_E2E_REAL=1    実APIモードを有効化
 *   CDP_URL                 WebView2 CDP エンドポイント (default: http://172.28.208.1:9222)
 *
 * 実APIモードの例 (OpenAI互換):
 *   DESKSPAWN_E2E_PROVIDER=custom \
 *   DESKSPAWN_E2E_ENDPOINT=https://api.example.com/v1 \
 *   DESKSPAWN_E2E_MODEL=my-model \
 *   DESKSPAWN_API_KEY=sk-... DESKSPAWN_E2E_REAL=1 pnpm test:e2e
 *
 * APIキーは環境変数からのみ取得する (テストファイルへの直書き禁止)。
 */
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';

const CDP_URL = process.env.CDP_URL || 'http://172.28.208.1:9222';

// ── E2E設定 (すべて環境変数から。未設定ならダミー値でUIフローのみ検証) ──
const PROVIDER = process.env.DESKSPAWN_E2E_PROVIDER || 'custom';
const ENDPOINT = process.env.DESKSPAWN_E2E_ENDPOINT || 'http://127.0.0.1:9/v1';
const MODEL = process.env.DESKSPAWN_E2E_MODEL || 'e2e-model';
const REGION = process.env.DESKSPAWN_E2E_REGION || 'us-east-1';
const API_KEY = process.env.DESKSPAWN_API_KEY || '';
const REAL_API = process.env.DESKSPAWN_E2E_REAL === '1';
// ダミーモード用: 保存バリデーションを通すための非実キー
const DUMMY_KEY = 'sk-e2e-dummy-key';

/** エンドポイント入力欄が表示されるプロバイダー (AiConfigDialog の表示条件と一致) */
const NEEDS_ENDPOINT = ['custom', 'anthropic', 'azure-openai', 'ollama'].includes(PROVIDER);
/** APIキー入力欄が表示されるプロバイダー (ollama 以外すべて) */
const NEEDS_API_KEY = PROVIDER !== 'ollama';

let browser: Browser;
let page: Page;

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

/**
 * モデル欄を設定する。プロバイダー/モードに応じて次のいずれかで動く:
 *  - モデル一覧取得OK → select から指定モデルを選択
 *  - 一覧に無いモデル → 「その他（手動入力）」→ 手動入力欄
 *  - 一覧取得失敗 (ダミーモード/一覧API非対応) → 手動入力欄
 */
async function fillModel(page: Page, model: string) {
  const modelSelect = page.locator('select').nth(1);
  const manualInput = page.getByPlaceholder(/Enter model|モデル/).first();

  // モデル一覧の取得完了を待つ (select か手動入力欄のどちらかが表示される)
  await expect
    .poll(
      async () => {
        const selectVisible = await modelSelect.isVisible().catch(() => false);
        const manualVisible = await manualInput.isVisible().catch(() => false);
        return selectVisible || manualVisible;
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  if (await modelSelect.isVisible().catch(() => false)) {
    const option = modelSelect.locator('option', { hasText: model });
    if ((await option.count()) > 0) {
      // 指定モデルが一覧にある → 選択
      await modelSelect.selectOption({ value: model });
    } else {
      // 一覧に無いモデル → 「その他（手動入力）」を選んで手動入力
      await modelSelect.selectOption('__custom__');
      await manualInput.fill(model);
    }
  } else {
    // モデル一覧が取得できない (ダミーモード等) → 手動入力
    await manualInput.fill(model);
  }
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

test('02: AI設定フロー — プロバイダーを保存しツールバーに反映', async () => {
  if (REAL_API) {
    expect(API_KEY, '実APIモードでは DESKSPAWN_API_KEY が必要').toBeTruthy();
  }

  await openAiConfig();

  // プロバイダー選択 (ネイティブselect)
  const providerSelect = page.locator('select').first();
  await providerSelect.selectOption({ value: PROVIDER });

  // エンドポイント入力 (表示されるプロバイダーのみ)
  if (NEEDS_ENDPOINT) {
    const endpointInput = page.getByPlaceholder(/http|https|endpoint/i).first();
    await endpointInput.fill(ENDPOINT);
  }

  // APIキー入力 (前回保存済みなら「変更」で入力欄を表示 — ブラウザ内保存バッジ表示中)
  if (NEEDS_API_KEY) {
    const changeBtn = page.getByRole('button', { name: '変更' });
    if (await changeBtn.isVisible().catch(() => false)) {
      await changeBtn.click();
    }
    const keyInput = page.locator('input[type="password"]').first();
    await keyInput.fill(REAL_API ? API_KEY : DUMMY_KEY);
  }

  // AWSリージョン (amazon-bedrock のみ)
  if (PROVIDER === 'amazon-bedrock') {
    const regionInput = page.getByPlaceholder(/us-east-1|リージョン/).first();
    await regionInput.fill(REGION);
  }

  // モデル選択/入力 (モデル一覧が取得できれば select、失敗すれば手動入力)
  await fillModel(page, MODEL);

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

  // AI応答の検証は実APIモードのみ (ダミーモードでは実応答が来ない)
  if (REAL_API) {
    // AI応答 (プロキシ経由の実応答) — ユーザー+アシスタントの2メッセージ追加を待つ
    await expect(page.locator('[id^="chat-msg-"]')).toHaveCount(msgCountBefore + 2, {
      timeout: 120_000,
    });
    await expect(page.locator('[id^="chat-msg-"]').last()).toContainText(new RegExp(token), {
      timeout: 30_000,
    });
  }
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
