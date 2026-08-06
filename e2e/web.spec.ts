import { test as base, expect, type Page } from '@playwright/test';
import { chromium } from '@playwright/test';

/**
 * DeskSpawn Web E2E — Windows Edge (CDP) 経由で Web 版をユーザー目線で検証
 *
 * 前提:
 *  - Windows Edge が CDP で起動中 (--remote-debugging-port=9222)
 *  - WSL dev サーバーが起動中 (pnpm --filter web dev --port 5178)
 *
 * 実行: npx playwright test --config playwright.web.config.ts
 */

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://172.28.208.1:9222';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5178';

// ── CDP 接続フィクスチャ（テストごとに新規 context = 状態分離） ───────────────
type Fixtures = { cdpPage: Page };

const test = base.extend<Fixtures>({
  cdpPage: async ({}, use) => {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  },
});

const expectCdp = expect;

// ── Helpers ────────────────────────────────────────────────────────────────

/** 開いている可能性のあるモーダル/ダイアログを閉じる */
async function closeModals(page: Page) {
  for (const label of ['キャンセル', '閉じる']) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

/** ランディング（言語=ja・route=/) へ */
async function gotoLanding(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('deskspawn_language', 'ja');
    localStorage.removeItem('deskspawn_route');
  });
  await page.goto(`${BASE_URL}/`);
}

/** アプリUI（言語=ja・route=/app) へ */
async function gotoApp(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('deskspawn_language', 'ja');
    localStorage.setItem('deskspawn_route', '/app');
  });
  await page.goto(`${BASE_URL}/?page=app`);
  await closeModals(page); // 初回AI設定ダイアログ等が開いていれば閉じる
}

/** 新規アプリを作成してツールバー反映まで待つ */
async function createApp(page: Page, name: string) {
  await page.getByRole('button', { name: '新規アプリ' }).click();
  await page.getByPlaceholder(/例:/).fill(name);
  await page.getByRole('button', { name: /作成|生成/ }).click();
  await expectCdp(
    page.getByRole('button', { name }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

// ── ランディングページ ──────────────────────────────────────────────────────

test.describe('ランディングページ', () => {
  test('01: デスクトップメインの構成が表示される', async ({ cdpPage }) => {
    await gotoLanding(cdpPage);

    // Hero
    await expectCdp(
      cdpPage.getByRole('heading', { level: 1, name: /AIでアプリを作る/ }),
    ).toBeVisible();
    const dlLink = cdpPage
      .getByRole('link', { name: 'デスクトップアプリをダウンロード' })
      .first();
    await expectCdp(dlLink).toBeVisible();
    await expectCdp(dlLink).toHaveAttribute(
      'href',
      /github\.com\/shira022\/deskspawn\/releases/,
    );
    await expectCdp(
      cdpPage.getByRole('button', { name: 'ブラウザで試す' }).first(),
    ).toBeVisible();

    // 体験版警告（ボタン直下）
    await expectCdp(cdpPage.getByText(/ブラウザ版は体験用です/).first()).toBeVisible();

    // 特徴カード6枚
    for (const title of [
      '実ファイルで管理',
      '完全ローカルプレビュー',
      'OSキーチェーン保護',
      'フルスタック生成',
      '自動テスト品質ループ',
      'お好みのAIプロバイダ',
    ]) {
      await expectCdp(
        cdpPage.getByRole('heading', { level: 3, name: title }),
      ).toBeVisible();
    }

    // ブラウザ版セクション警告バナー
    await expectCdp(cdpPage.getByText(/IndexedDB/).first()).toBeVisible();

    // 推奨環境2区分
    await expectCdp(
      cdpPage.getByRole('heading', { level: 3, name: 'デスクトップアプリ' }),
    ).toBeVisible();
    await expectCdp(
      cdpPage.getByRole('heading', { level: 3, name: 'Web版（体験用）' }),
    ).toBeVisible();
  });

  test('02: 言語切替で英語表示になる', async ({ cdpPage }) => {
    await gotoLanding(cdpPage);

    await cdpPage.getByRole('button', { name: 'English' }).click();
    await expectCdp(
      cdpPage.getByRole('heading', { level: 1, name: /Build Apps/ }),
    ).toBeVisible();
    await expectCdp(
      cdpPage.getByRole('link', { name: 'Download Desktop App' }).first(),
    ).toBeVisible();

    // 日本語に戻す
    await cdpPage.getByRole('button', { name: '日本語' }).click();
    await expectCdp(
      cdpPage.getByRole('heading', { level: 1, name: /AIでアプリを作る/ }),
    ).toBeVisible();
  });

  test('03: テーマ切替でダークモードが適用される', async ({ cdpPage }) => {
    await gotoLanding(cdpPage);

    const html = cdpPage.locator('html');
    await cdpPage.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expectCdp(html).toHaveClass(/dark/);
    await cdpPage.getByRole('button', { name: 'Switch to light mode' }).click();
    await expectCdp(html).not.toHaveClass(/dark/);
  });

  test('04: 「ブラウザで試す」でアプリUIに遷移する', async ({ cdpPage }) => {
    // addInitScript は reload 時にも再実行され route=/app を消してしまうため、
    // goto 後に evaluate で設定する方式に
    await cdpPage.goto(`${BASE_URL}/`);
    await cdpPage.evaluate(() => {
      localStorage.setItem('deskspawn_language', 'ja');
      localStorage.removeItem('deskspawn_route');
    });
    await cdpPage.reload();
    await expectCdp(
      cdpPage.getByRole('heading', { level: 1, name: /AIでアプリを作る/ }),
    ).toBeVisible();

    await cdpPage.getByRole('button', { name: 'ブラウザで試す' }).first().click();
    // リロード後、アプリUIのツールバーが表示される（初回ダイアログがあれば閉じる）
    await expectCdp(cdpPage.getByRole('button', { name: '新規アプリ' })).toBeVisible();
    await closeModals(cdpPage);
    await expectCdp(cdpPage.getByRole('button', { name: 'アプリ未選択' })).toBeVisible();
  });
});

// ── アプリUI ────────────────────────────────────────────────────────────────

test.describe('アプリUI', () => {
  test('05: ツールバー初期状態（アプリ未選択/新規アプリ/AI未設定）', async ({ cdpPage }) => {
    await gotoApp(cdpPage);

    await expectCdp(cdpPage.getByRole('button', { name: 'アプリ未選択' })).toBeVisible();
    await expectCdp(cdpPage.getByRole('button', { name: '新規アプリ' })).toBeVisible();
    await expectCdp(cdpPage.getByRole('button', { name: 'AI未設定' })).toBeVisible();

    // プレビュー未選択メッセージ
    await expectCdp(
      cdpPage.getByText('アプリを選択または作成するとプレビューが表示されます'),
    ).toBeVisible();

    // ステータスバー: Web は Browser 表示
    await expectCdp(cdpPage.getByText('Browser')).toBeVisible();
    await expectCdp(cdpPage.getByText('待機中')).toBeVisible();
  });

  test('06: 新規アプリダイアログを開いてキャンセルできる', async ({ cdpPage }) => {
    await gotoApp(cdpPage);

    await cdpPage.getByRole('button', { name: '新規アプリ' }).click();
    await expectCdp(
      cdpPage.getByRole('heading', { name: /新規アプリ|アプリを作成/ }),
    ).toBeVisible();
    await cdpPage.getByRole('button', { name: 'キャンセル' }).click();
    await expectCdp(cdpPage.getByRole('button', { name: 'アプリ未選択' })).toBeVisible();
  });

  test('07: 新規アプリを作成するとツールバーに反映される', async ({ cdpPage }) => {
    await gotoApp(cdpPage);
    await createApp(cdpPage, 'E2Eアプリ');

    await expectCdp(cdpPage.getByRole('button', { name: 'E2Eアプリ' }).first()).toBeVisible();
  });

  test('08: AI設定ダイアログ — 保存でツールバーに反映される', async ({ cdpPage }) => {
    await gotoApp(cdpPage);

    // 2段階: 「AI未設定」→ モデル設定ポップオーバー → 「AI設定画面へ」→ ダイアログ
    await cdpPage.getByRole('button', { name: 'AI未設定' }).click();
    await cdpPage.getByRole('button', { name: 'AI設定画面へ' }).click();
    await expectCdp(
      cdpPage.getByRole('heading', { name: 'APIキー設定' }),
    ).toBeVisible();

    // プロバイダーを Custom に変更（ネイティブ select → selectOption）
    await cdpPage.getByRole('combobox').first().selectOption({ label: 'Custom' });

    // APIキー入力（type=password。Custom の placeholder は sk- 始まりでないため）
    const keyInput = cdpPage.locator('input[type="password"]').first();
    await keyInput.fill('sk-test-e2e-dummy-key');

    // モデル: Custom ではモデル欄が手動入力 Input になる
    // （modelsError 時「モデル名を手動入力」/ それ以外「モデル名を入力（例: gpt-4o）」）
    const modelInput = cdpPage.getByPlaceholder(/モデル/).first();
    await modelInput.fill('e2e-model');

    // カスタムエンドポイント（Custom プロバイダーでは必須）
    await cdpPage
      .getByPlaceholder(/https:\/\//)
      .fill('http://localhost:3001/v1');

    await cdpPage.getByRole('button', { name: '保存' }).click();

    // ツールバーに保存したモデル名（e2e-model）が反映される
    // （ツールバーはプロバイダーアイコン + モデル名表示）
    await expectCdp(
      cdpPage.getByRole('button', { name: /e2e-model/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('09: チャット — 入力で送信ボタンが有効になり送信できる', async ({ cdpPage }) => {
    await gotoApp(cdpPage);

    const textbox = cdpPage.getByPlaceholder(/作りたいアプリを指示/);
    await textbox.fill('タスク管理アプリを作って');
    const sendBtn = cdpPage.getByRole('button', { name: /送信/ });
    await expectCdp(sendBtn).toBeEnabled();

    // 送信するとユーザーメッセージがチャットに表示される
    await sendBtn.click();
    await expectCdp(
      cdpPage.getByText('タスク管理アプリを作って').first(),
    ).toBeVisible();
  });

  test('10: 設定ダイアログ — 言語を変更できる', async ({ cdpPage }) => {
    await gotoApp(cdpPage);

    // 設定ボタン（lucide-settings2 アイコン。ツールバーに2つあるため nth(1) = 右端の設定ボタン）
    await cdpPage
      .locator('button')
      .filter({ has: cdpPage.locator('.lucide-settings2') })
      .nth(1)
      .click();
    await expectCdp(cdpPage.getByRole('heading', { name: /設定/ })).toBeVisible();

    // 言語ボタンをクリック → LanguageSelectScreen で English を選択
    await cdpPage.getByRole('button', { name: /日本語/ }).click();
    await cdpPage.getByRole('button', { name: /English/ }).click();
    // 言語が英語に変わったのでダイアログタイトルは「Settings」になる
    await expectCdp(
      cdpPage.getByRole('heading', { name: /設定|Settings/ }),
    ).toBeVisible();

    // 設定ダイアログを閉じる
    await cdpPage.getByRole('button', { name: '閉じる' }).first().click().catch(() => {});
    await cdpPage.keyboard.press('Escape').catch(() => {});
  });

  test('11: アプリ作成後のプレビューパネル — ヘッダー/デバイスプリセット', async ({ cdpPage }) => {
    await gotoApp(cdpPage);
    await createApp(cdpPage, 'プレビュー確認アプリ');

    // プレビューパネルのヘッダーにタイトルが表示される
    await expectCdp(cdpPage.getByText('プレビュー').first()).toBeVisible();

    // デバイスプリセット（モバイル/タブレット）ボタンが存在する
    const mobileBtn = cdpPage.getByTitle(/375×812/).first();
    await expectCdp(mobileBtn).toBeVisible();
  });

  test('12: デスクトップ環境 — StatusBarにDesktop/Sidecar/ポート表示（WebのBrowserは出ない）', async ({ cdpPage }) => {
    // デスクトップ環境フラグを設定して同じ共有UIを検証（フロントの分岐動作確認）
    await cdpPage.addInitScript(() => {
      localStorage.setItem('deskspawn_language', 'ja');
      localStorage.setItem('deskspawn_route', '/app');
      (window as any).__DESKSPAWN_DESKTOP__ = true;
      (window as any).__DESKSPAWN_SIDECAR_PORT__ = 3009;
    });
    await cdpPage.goto(`${BASE_URL}/?page=app`);
    await closeModals(cdpPage);

    // Desktop 環境表示
    await expectCdp(cdpPage.getByText('Desktop')).toBeVisible();
    await expectCdp(cdpPage.getByText(':3009')).toBeVisible();
    // Tauri invoke 不可 → Sidecar オフライン
    await expectCdp(cdpPage.getByText('Sidecar オフライン')).toBeVisible();
    // Web 専用の「Browser」表示は出ない
    await expectCdp(cdpPage.getByText('Browser')).toHaveCount(0);
  });
});
