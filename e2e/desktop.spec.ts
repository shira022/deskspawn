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
 *   1. cp .env.example .env   # .env は gitignore 済み・シェル履歴に残さない
 *   2. .env に設定: DESKSPAWN_API_KEY / DESKSPAWN_E2E_REAL=1 / PROVIDER / ENDPOINT / MODEL
 *   3. set -a; source .env; set +a; pnpm test:e2e:real
 *      (test:e2e:real = desktop 限定 + 実行後 test-results クリーン)
 *   ⚠️ 実API E2E は開発者自己責任 (コスト・キー保存/削除含む)。CI ではダミーのみ。
 *   ⚠️ 実APIモードでは trace は自動オフ (playwright.config.ts) — キー/プロンプト漏洩防止。
 *
 * APIキーは環境変数からのみ取得する (テストファイルへの直書き禁止)。
 *
 * ⚠️⚠️ 警告: このテストは実データを削除する ⚠️⚠️
 *   beforeAll と afterAll で `reset_app_data`（Rust IPC）を実行し、
 *   アプリレジストリ・生成アプリ・チャット履歴・UI設定（言語/テーマ等）を
 *   全て削除する。実行は **開発環境限定**:
 *     - 環境変数 DESKSPAWN_TEST_RESET=1 が必要（未設定では拒否・誤爆防止）
 *     - APIキー（OSキーチェーン）とAIプロバイダー設定は削除されない
 *   このリポジトリで E2E を回す前に、開発機の実データを失ってよいか
 *   確認すること（エージェントは AGENTS.md の注意事項も参照）。
 *   実行時は必ず開発環境（WSL staging ビルド）で行う。
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

  // ⚠️ キーチェーン分離のガード: E2E は本番キーチェーン（com.deskspawn）を
  // 汚さないよう、アプリが `DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e` 付きで
  // 起動されていることを確認する（2026-08-15 レビュー指摘対応）。
  // テスト02 がダミーキーを保存しても、本番 service ではなくテスト専用
  // service に入るため、開発機の実 API キーは上書きされない。
  const ks = await page.evaluate(async () => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke: (c: string, a?: object) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    if (!internals) return '(no tauri)';
    // 現在の keyring service 名を Rust から取得（テスト用コマンド）
    try {
      // eslint-disable-next-line
      return await internals.invoke('get_keyring_service');
    } catch {
      return '(cmd unavailable)';
    }
  });
  if (ks !== 'com.deskspawn.e2e') {
    console.error(
      `⚠️ キーチェーン分離ガード: keyring service = ${ks}（期待: com.deskspawn.e2e）。\n` +
        `E2E は本番キーチェーンを汚します。アプリを \`DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e\` 付きで再起動してください。`,
    );
    throw new Error('KEYCHAIN ISOLATION VIOLATION: app not launched with DESKSPAWN_KEYCHAIN_SERVICE=com.deskspawn.e2e');
  }

  // ⚠️ ここで実データ（アプリ/設定/チャット履歴）を削除する。
  // reset_app_data はデバッグビルド + DESKSPAWN_TEST_RESET=1 の時のみ動作する
  // E2E 専用コマンド（開発環境限定・誤爆防止ガード付き）。APIキー
  // （OSキーチェーン）とAIプロバイダー設定は削除されない。
  // ヘッダコメントと AGENTS.md の警告を確認すること。
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(async () => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    }).__TAURI_INTERNALS__;
    if (internals) {
      try {
        await internals.invoke('reset_app_data');
      } catch (e) {
        console.error('reset_app_data failed (non-Tauri/CDP environment?):', e);
      }
    }
  });
  await page.evaluate(() => localStorage.setItem('deskspawn_route', '/app'));
  await page.reload();
  await page.waitForTimeout(2000);

  // クリア後は初回起動（言語未設定）のため言語選択画面が表示される
  // （デスクトップ実装 2026-08-15: config.json に settings が無い場合のみ）。
  // 日本語を選択してメイン画面に進む。
  const langJapanese = page.getByRole('button', { name: /日本語/ });
  if (await langJapanese.isVisible().catch(() => false)) {
    await langJapanese.click();
    await page.waitForTimeout(800);
  }

  // ランディングページ（Web 版のみ・デスクトップでは表示されない）。
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
  // テストが作成したアプリを実データに残さない（後片付け）。次回実行も
  // 同じクリーン状態から始められる。⚠️ 開発環境の実データも削除される
  // （beforeAll と同じガード: デバッグビルド + DESKSPAWN_TEST_RESET=1）。
  await page.evaluate(async () => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    }).__TAURI_INTERNALS__;
    if (internals) {
      try {
        await internals.invoke('reset_app_data');
      } catch (e) {
        console.error('reset_app_data (afterAll) failed:', e);
      }
    }
  });
  await browser.close();
});

test.describe.configure({ mode: 'serial' });

// ── ヘルパー ─────────────────────────────────────────────────────────────

/** ツールバーのモデルセレクタ → ポップオーバー → 「APIキー設定」でフル設定ダイアログを開く */
async function openAiConfig() {
  // フル設定ダイアログが開いていれば何もしない (h2タイトルで判定 — ポップオーバーの同名ボタンと区別)
  if (await page.getByRole('heading', { name: 'APIキー設定' }).isVisible().catch(() => false)) return;
  // API キー未設定時はツールバーに「AI設定画面へ」ボタンが直置きされる（reset 直後）。
  // それがあれば直接クリックして開く（実績 2026-08-15: `APIキー未設定` + `AI設定画面へ`）。
  // 同名ボタンが複数（ツールバー + チャットパネル）あるため .first() で極め、visible 判定で
  // strict エラーにならないよう try で囲む。
  try {
    const directBtn = page.getByRole('button', { name: 'AI設定画面へ' }).first();
    if (await directBtn.isVisible().catch(() => false)) {
      await directBtn.click();
      await expect(page.getByRole('heading', { name: 'APIキー設定' })).toBeVisible({ timeout: 5000 });
      return;
    }
  } catch {}
  const settingsBtn = page.getByRole('button', { name: 'APIキー設定' });
  const goConfigBtn = page.getByRole('button', { name: '設定する' });
  const popoverGoBtn = page.getByRole('button', { name: 'AI設定画面へ' }).first();
  if (await settingsBtn.isVisible().catch(() => false)) {
    // ポップオーバーが既に開いている
    await settingsBtn.click();
  } else if (await goConfigBtn.isVisible().catch(() => false)) {
    await goConfigBtn.click();
  } else if (await popoverGoBtn.isVisible().catch(() => false)) {
    // ポップオーバーが開いており「AI設定画面へ」ボタンがある（APIキー未設定時）
    await popoverGoBtn.click();
  } else {
    // ポップオーバーを開いてからボタンを押す（「APIキー未設定」= モデルセレクタ）
    await page.locator('div.flex.h-10 button').nth(3).click();
    // ポップオーバー内のボタン（APIキー未設定時は「AI設定画面へ」、設定済みは「APIキー設定」/「設定する」）
    const popoverChoices = [
      page.getByRole('button', { name: 'APIキー設定' }),
      page.getByRole('button', { name: '設定する' }),
      page.getByRole('button', { name: 'AI設定画面へ' }),
    ];
    let clicked = false;
    for (const b of popoverChoices) {
      try {
        await b.first().waitFor({ timeout: 2500 });
        await b.first().click();
        clicked = true;
        break;
      } catch {}
    }
    if (!clicked) throw new Error('openAiConfig: ポップオーバー内に設定ボタンが見つかりません');
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

test('00: 初期状態 — クリア後は「アプリ未選択」のガイドが表示される', async () => {
  // beforeAll の reset_app_data によりアプリは1つも存在しない状態から始まる。
  // ツールバーのアプリボタンは「アプリ未選択」、チャットパネルにガイドが出る。
  await expect(page.locator('div.flex.h-10 button').nth(1)).toContainText('アプリ未選択');
  await expect(page.getByText(/ツールバーの「新規アプリ」からアプリを作成すると/)).toBeVisible();
  // プレビューパネルのプレースホルダ
  await expect(page.getByText(/アプリを選択または作成するとプレビューが表示されます/)).toBeVisible();
});

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
  // 現在のモデルが表示されている。モデル一覧フェッチが成功すれば select、
  // 失敗すれば手動入力 input（ダミーキーでは /models が 502 → input になる）。
  // フェッチ完了前に判定すると両方とも未表示になり flaky なため、どちらかが
  // 表示されるまで待ってから確認する（実績 2026-08-15: フェッチは最大 ~8秒）。
  await expect
    .poll(
      async () =>
        (await popover.locator('select').nth(1).count()) +
        (await popover.getByPlaceholder(/モデル名を入力/).count()),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  const modelSelect = popover.locator('select').nth(1);
  if (await modelSelect.count()) {
    await expect(modelSelect).toHaveValue(MODEL);
  } else {
    await expect(popover.getByPlaceholder(/モデル名を入力/)).toHaveValue(MODEL);
  }
  // 後続テストのためにポップオーバーを閉じる — el.click() でReactハンドラを直接発火
  // (Playwrightのヒットテストはウィンドウ右端でflakyになるため force/座標クリックは不採用)
  await closeModelPopover(page);
  await expect(popover).toBeHidden();
});

test('06: アプリ切替と削除 — 2アプリの作成・切替・削除ガード・後片付け', async () => {
  // テスト03 で作成したアプリ（E2E-xxx）がアプリA（現在選択中）。
  const tb = page.locator('div.flex.h-10 button');
  const pop = page.locator('div.absolute.left-0.top-full');

  // アプリB を作成（作成後は B が選択状態になる）
  const appB = `SPEC-B-${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: '新規アプリ' }).click();
  await page.getByPlaceholder(/例: タスク管理アプリ/).fill(appB);
  await page.getByRole('button', { name: '作成' }).click();
  await expect(page.locator('div.flex.h-10').getByText(appB)).toBeVisible({ timeout: 10_000 });

  // A⇔B 切替: B 選択中 → AppSwitcher で A に切替 → ツールバーに反映
  await tb.nth(1).click();
  await page.waitForTimeout(900);
  const rows1 = pop.locator('[role="button"]');
  const names1 = await rows1.evaluateAll((els) =>
    els.map((el) => el.querySelector('.font-medium')?.textContent?.trim() || ''),
  );
  const aIdx = names1.findIndex((n) => n && n.startsWith('E2E-'));
  expect(aIdx).toBeGreaterThanOrEqual(0);
  await rows1.nth(aIdx).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('div.flex.h-10').getByText(/^E2E-/)).toBeVisible();

  // もう一度 B に戻す（履歴が追従する）
  await tb.nth(1).click();
  await page.waitForTimeout(900);
  const rows2 = pop.locator('[role="button"]');
  const names2 = await rows2.evaluateAll((els) =>
    els.map((el) => el.querySelector('.font-medium')?.textContent?.trim() || ''),
  );
  const bIdx = names2.findIndex((n) => n === appB);
  expect(bIdx).toBeGreaterThanOrEqual(0);
  await rows2.nth(bIdx).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('div.flex.h-10').getByText(appB)).toBeVisible();

  // B 選択中に A を削除（A は非選択なので削除可能）。プレビュー/チャット処理との
  // 競合で稀に削除が失敗（「削除に失敗しました」が表示される）することがあるため、
  // 失敗時は1回リトライする（実機では正常動作を確認済み・タイミング依存の flaky 対策）。
  const deleteAppRow = async (label: string, matcher: (n: string) => boolean) => {
    // プレビュー（vite dev server）がアプリのディレクトリをロックし、Windows の
    // remove_dir_all が失敗することがあるため、削除前に全プレビューを停止する
    // （実績 2026-08-15。アプリ側の handleDelete でも停止するが保険として二重に実行）。
    await page.evaluate(async () => {
      const inv = window.__TAURI_INTERNALS__.invoke;
      const token = await inv('get_sidecar_token');
      // __DESKSPAWN_SIDECAR_PORT__ はデスクトップ起動時に注入される（main.tsx）。
      // フォールバック値を持たない（固定の 3009 を持たせるとゾンビポートに
      // 当たる可能性があるため・実績 2026-08-15）。
      const port = window.__DESKSPAWN_SIDECAR_PORT__;
      if (!port) return;
      await fetch(`http://127.0.0.1:${port}/api/preview/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DeskSpawn-Token': token },
      }).catch(() => {});
    });
    await page.waitForTimeout(3000); // taskkill 完了待ち
    let lastErrText = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      await tb.nth(1).click();
      await page.waitForTimeout(900);
      const rowsN = pop.locator('[role="button"]');
      const namesN = await rowsN.evaluateAll((els) =>
        els.map((el) => el.querySelector('.font-medium')?.textContent?.trim() || ''),
      );
      const idx = namesN.findIndex(matcher);
      expect(idx).toBeGreaterThanOrEqual(0);
      await rowsN.nth(idx).locator('button[title="削除"]').click();
      await expect(page.getByText('アプリを削除', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '削除する' }).click();
      // 削除成功 → ダイアログが閉じる。remove_dir_all は node_modules（100MB超）で
      // 数秒〜数十秒かかることがあるため長めに待つ（実績 2026-08-15）。
      try {
        await expect(page.getByText('アプリを削除', { exact: true })).toBeHidden({
          timeout: 60_000,
        });
      } catch {
        // ダイアログが閉じない = 本当の削除失敗。エラー詳細を出して1回リトライ。
        const errInfo = await page
          .locator('text=アプリを削除')
          .first()
          .evaluate((el) => {
            const e = el as HTMLElement;
            // ダイアログコンテンツ（z-50 fixed）まで遡って全文を取得（エラー表示を含む）
            let n: HTMLElement | null = e;
            for (let i = 0; i < 5 && n && !n.className.toString().includes('fixed left-'); i++) {
              n = n.parentElement;
            }
            return (n ? n.innerText : e.innerText).slice(0, 300).replace(/\n/g, ' | ');
          })
          .catch(() => '(text not found)');
        lastErrText = errInfo;
        await page.getByRole('button', { name: 'キャンセル' }).click();
        await expect(page.getByText('アプリを削除', { exact: true })).toBeHidden({
          timeout: 10_000,
        });
        // ゾンビ backdrop（z-40）が残る場合があるため Escape + backdrop クリックで閉じる
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        const zb = page.locator('div.fixed.inset-0.z-40');
        if (await zb.isVisible().catch(() => false)) {
          await zb.click({ position: { x: 8, y: 8 } }).catch(() => {});
          await page.waitForTimeout(500);
        }
        continue;
      }
      await page.waitForTimeout(500);
      // 削除成功後も AppSwitcher ポップオーバー（z-40 backdrop）が残ることがあるため閉じる
      const zb2 = page.locator('div.fixed.inset-0.z-40');
      if (await zb2.isVisible().catch(() => false)) {
        await zb2.click({ position: { x: 8, y: 8 } }).catch(() => {});
        await page.waitForTimeout(500);
      }
      return;
    }
    throw new Error(
      `アプリ削除に失敗しました（リトライ含む）: ${label} — ${lastErrText || '(ダイアログにエラー表示なし)'}`,
    );
  };

  await deleteAppRow('アプリA (E2E-)', (n) => n && n.startsWith('E2E-'));

  // B だけが残る。B は選択中なので削除ボタンは disabled（選択中アプリ削除ガード）。
  // 削除確認ダイアログでポップオーバーは閉じるため、開き直して確認する。
  await tb.nth(1).click();
  // B の行が表示されるまで待つ（ポップオーバー再描画のタイミング差で行が
  // 見えないことがある・実績 2026-08-15: findIndex -1 で失敗）
  await expect
    .poll(
      async () => {
        const rows = pop.locator('[role="button"]');
        const names = await rows.evaluateAll((els) =>
          els.map((el) => el.querySelector('.font-medium')?.textContent?.trim() || ''),
        );
        return names.includes(appB) ? 1 : 0;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const rows4 = pop.locator('[role="button"]');
  const names4 = await rows4.evaluateAll((els) =>
    els.map((el) => el.querySelector('.font-medium')?.textContent?.trim() || ''),
  );
  const bIdx2 = names4.findIndex((n) => n === appB);
  expect(bIdx2).toBeGreaterThanOrEqual(0);
  // B は選択中 → title が「削除」でなく deleteDisabledActive（削除不可の説明）になる。
  // 両方の title にマッチさせて削除ボタンを特定する（実績 2026-08-15）。
  const delBtn = rows4
    .nth(bIdx2)
    .locator(
      'button[title="削除"], button[title="現在開いているアプリは削除できません。先に別のアプリに切り替えてください。"]',
    )
    .first();
  const delDisabled = await delBtn.isDisabled();
  expect(delDisabled).toBe(true);

  // ポップオーバーを閉じる（z-40 バックドロップの el.click — ヒットテストflaky回避）
  await page.evaluate(() => {
    const backdrop = [...document.querySelectorAll('div')].find((d) =>
      d.className.includes('fixed inset-0 z-40'),
    );
    if (backdrop) (backdrop as HTMLElement).click();
  });
  await page.waitForTimeout(500);

  // 残ったアプリB は afterAll の reset_app_data が削除する（テスト後片付け）。
});
