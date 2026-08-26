# DeskSpawn User-Flow Specification

> **User-perspective functional specification + test-code generation reference.**
> Verified on the real Windows desktop build (Tauri production mode) with
> Playwright-over-CDP automation against the live WebView2.
>
> - Version under test: **v0.4.2** (desktop-first monorepo; single-version policy)
> - Applies to: **desktop app (main product)** — the web demo is evaluation-only
> - Companion doc: [spec.md](./spec.md) (architecture). This document is the
>   user-visible behavior spec; it does not modify or replace `spec.md`.
>
> Legend: ✅ = verified on the real desktop app · 📝 = specified from
> implementation, not yet exercised on the real app.
> The detailed verification log (date, commit, environment, per-scenario
> results) is kept **outside this repository** (see §5 note).

---

## 1. Product Overview (user's perspective)

DeskSpawn is a desktop app that builds apps from natural language. The user:

1. Selects or creates an **app** (project).
2. Describes what they want in the **chat**.
3. A multi-agent AI pipeline plans, writes, verifies and iterates on code.
4. The result is shown in a **live local preview** (Vite dev server on the real
   app directory) — fully offline, no cloud sandbox.
5. Generated apps are **real files** under `~/deskspawn/apps/<app-id>/`;
   chat history is SQLite; API keys live in the **OS keychain**.

Main screen layout (verified):

```
┌ Toolbar: [DeskSpawn] [app selector ▾] [新規アプリ] [model ▾] .........
│ Chat panel (left)                    │ Preview panel (right, iframe)
│   messages                          │   device presets / zoom / refresh
│   input: "作りたいアプリを指示してください..." (Ctrl+Enter to send)  │
├ Status bar: Local :<port> · Desktop · Sidecar ✓ · tokens/cost ──────
```

---

## 2. Verification Environment

| Item | Value (this session) |
|---|---|
| Host | Windows 11 (WSL2 dev, host-direct verification) |
| Build | `cargo-tauri build --no-bundle` (production mode, serves `tauri.localhost`; `beforeBuildCommand` builds the frontend) |
| Frontend | `pnpm --filter desktop build` → bundled into the exe |
| Sidecar | bun-compiled `deskspawn-sidecar-x86_64-pc-windows-msvc.exe` |
| AI provider | configured provider/model (key stored in Windows Credential Manager) |
| Sidecar port | `<port>` (dynamic; default ≈3009, falls back 3009→3010→… when taken) |
| Preview | local Vite on `localhost:<port>` (dynamic; app switch moves it) |
| CDP | `--remote-debugging-port=<port>` (dev/E2E only; WebView2 binds `::1`, portproxy v4tov6 for WSL access) |
| App data root | `~/deskspawn/` (apps/ · config/ · templates/ · tools/) |

### Build & launch recipe (for reproducible tests)

```bash
# WSL
pnpm --filter desktop build                      # frontend → apps/desktop/dist
cd apps/desktop && bun scripts/build-sidecar.mjs # sidecar exe → src-tauri/binaries (externalBin)
rsync -a --delete --exclude node_modules --exclude .git --exclude target \
      --exclude 'src-tauri/binaries' ./ /mnt/c/Users/<u>/dev/deskspawn-staging/
# Windows (staging): Rust build (tauri.conf.json beforeBuildCommand rebuilds the frontend)
$env:PATH='C:\Users\<u>\dev\tools\bun\bun-windows-x64;C:\Users\<u>\.cargo\bin;'+$env:PATH
Set-Location apps/desktop/src-tauri
cargo-tauri build --no-bundle
# Launch with CDP (dev/E2E only)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=<port>'
Start-Process ...\target\release\deskspawn-desktop.exe
```

---

## 3. User Flows (Gherkin-style scenarios)

> **Flow ownership:** humans create and manage the app *container* (name,
> registry, switching, deletion); the **AI pipeline creates the app's
> content** (source code, features) through the chat — the generation loop
> (§3.2) is the main flow. The desktop launch does **not** include the
> web-only onboarding (language select / landing page).

### 3.0 Startup & initial state

#### F0. Launch — main screen direct (first run: language select) ✅

```
Feature: Launch (desktop)
  Scenario: App starts into the main screen
    Given the desktop app is launched
    Then the window title contains "DeskSpawn"
    And the toolbar shows: brand, app selector, "新規アプリ", model button
    And the chat input (placeholder "作りたいアプリを指示してください...") is visible
    And the status bar shows "Desktop" and "Sidecar ✓"
    And the UI language is the saved setting (config.json `settings.language`),
      defaulting to 日本語 (ja)

  Scenario: First run shows the language select (desktop-only)
    Given no `settings` exists in config.json (never saved)
    And no legacy `deskspawn_settings` in WebView2 localStorage
    When the app finishes initializing
    Then the LanguageSelectScreen is shown (日本語 / English)
    When the user picks a language
    Then the language is persisted to config.json (`save_settings` IPC)
    And the main screen appears (the language select never shows again)
```

Verified on the real app: a normal launch renders the main screen directly —
**no landing page** (web-only, `apps/web/src/main.tsx` boot sequence). The
language-select screen appears **only when no settings exist** (first run);
it was reproduced by clearing localStorage + `reset_app_data` (dev-only
command, see below), then choosing 日本語. Clearing localStorage **alone no
longer resets the language** — settings now live in config.json.

#### F0.1 Initial state — no app selected ✅

```
Feature: Empty selection
  Scenario: User opens the app with no app selected
    Given no app is selected (fresh UI state)
    Then the toolbar app selector shows "アプリ未選択"
    And the chat panel shows the guide
      "ツールバーの「新規アプリ」からアプリを作成すると、チャットでアプリの構築を開始できます。"
    And the preview panel shows the placeholder
      "アプリを選択または作成するとプレビューが表示されます"
    And the status bar shows the active AI config (e.g. "<provider> <model> 使用中")
```

Verified on the real app (after clearing the UI state; the app registry was
**not** touched and the history remained intact — see F9 for storage map).

#### F0.2 First run — zero apps 📝

```
Feature: First run with an empty registry
  Scenario: The app has never created an app
    Given ~/deskspawn/apps/apps.json has no entries
    When the user opens the app selector
    Then the popover shows "アプリ履歴はまだありません"
    And a button "最初のアプリを作成" starts the create-app flow
```

Specified from implementation (`AppSwitcher` no-history branch). Can be
reproduced in a dev environment with the `reset_app_data` command (debug
build + `DESKSPAWN_TEST_RESET=1`, see "Development-only reset" below) — the
E2E suite uses it in `beforeAll`. Never run it on a machine with real data.

#### F0.3 Last-app auto-restore ✅

```
Feature: Restore last app
  Scenario: The previously selected app is restored on launch
    Given the user selected app X before closing
    When the app is relaunched
    Then app X is selected again (currentApp persisted in config.json)
    And its chat history and preview are loaded
```

Verified via the restart-persistence round trip (see F9).

#### F1. Launch & initial screen ✅

```
Feature: Launch
  Scenario: App starts and shows the main UI
    Given the desktop app is launched
    Then the window title contains "DeskSpawn"
    And the toolbar shows: brand, app selector, "新規アプリ", model button
    And the chat input (placeholder "作りたいアプリを指示してください...") is visible
    And the status bar shows "Desktop" and "Sidecar ✓"
    And the page runs with the desktop flag (window.__DESKSPAWN_DESKTOP__ === true)
```

Test notes: toolbar buttons are `div.flex.h-10 button` — `nth(1)` = app
selector, `nth(2)` = 新規アプリ, `nth(3)` = AI/model. The language select and
landing page are **web-demo-only** and never appear on desktop (F0). The
legacy E2E guard that clicks 日本語 / 今すぐ始める when visible is harmless on
desktop (the elements never render).

### 3.1 Human operations — the app "container"

#### F2. App list & switching ✅

```
Feature: App switching
  Scenario: User switches between apps and back
    Given at least two apps exist
    When the user opens the app selector (toolbar nth(1))
    Then a popover lists all apps (name + last-updated date, newest first)
    When the user clicks another app
    Then the toolbar shows the new app name
    And the chat panel loads that app's message history
    When the user switches back
    Then the original app and its history are restored
```

Verified: round trip between existing apps; history follows the selection.

Test notes:
- Popover rows are `div.absolute.left-0.top-full [role="button"]`; the app name
  is the row's `.font-medium` span. **Do not use `hasText` on the row for
  matching** — a date line such as `<M/D HH:MM>` can collide with other app
  names via digit substrings. Match the `.font-medium` text
  exactly, then click `rows.nth(index)`.
- Switching resets session state (messages cleared, then reloaded).

#### F3. Create a new app ✅

```
Feature: Create app
  Scenario: User creates a new app from the toolbar
    Given the main screen is shown
    When the user clicks 新規アプリ
    Then a dialog appears: heading "新しいアプリを作成", field "アプリ名"
    When the user enters a name and clicks 作成
    Then the toolbar app selector shows the new name
    And real files are created under ~/deskspawn/apps/<app-id>/ (src/, package.json, …)
    And (desktop) the full-stack template is used (Hono + bun:sqlite, ADR-010)
    When the user clicks キャンセル instead
    Then the dialog closes without creating anything
```

Verified: create → toolbar reflects name; real directory with `src/`,
`package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `bun.lock`
appeared on disk. Cancel path closes the dialog (covered by the existing E2E).

Test notes: use a unique app name per run (e.g. `SPEC-<timestamp>`) so
repeated runs never collide; clean up by deleting the app afterwards.

#### F8. Delete an app ✅

```
Feature: Delete app
  Scenario: User deletes a non-active app
    Given the app selector is open
    When the user clicks the trash button (title="削除") on an app row
    Then a confirm dialog appears: "アプリを削除" / "「<name>」を完全に削除しますか？…"
    When the user confirms (削除する)
    Then the app is removed from the list and its files are deleted
  Scenario: Guard — the active app cannot be deleted
    Given the app is currently selected
    When the user clicks its trash button
    Then the button is disabled (title "現在開いているアプリは削除できません…")
```

Verified: switch to another app → delete the test app via the confirm dialog
→ gone from the list and from the registry (`~/deskspawn/apps/apps.json`).

Test notes: delete button = row's `button[title="削除"]`; the active row's
button is `disabled`. Confirm dialog: text "アプリを削除" + button "削除する".

#### F10. Export / Import 📝 (spec from implementation)

```
Feature: Backup
  Scenario: User exports an app as a zip
    Given an app exists
    When the user clicks the download button (title="エクスポート") on a row
    Then (desktop) Rust builds a zip in memory and shows a save dialog
    And the zip contains the source files plus deskspawn.json metadata
    And excluded paths (node_modules, .deskspawn, …) are not included
  Scenario: User imports an app from a zip
    When the user clicks インポート and selects a .zip
    Then (desktop) Rust extracts it with zip-slip protection
      and registers the app in the registry
```

Not exercised on the real app this session (native file dialogs are not
automation-friendly). Implementation verified by code review: `export_app_zip`
/ `import_app_zip` in `src-tauri/src/commands/apps.rs`, `is_excluded_zip_path`,
`is_zip_entry_safe` (zip-slip guard).

---

### 3.2 AI generation loop — the AI creates the app's content (main flow)

#### F4. AI configuration ✅

```
Feature: AI settings
  Scenario: User opens settings and sees their saved configuration
    Given the toolbar model button (nth(3)) is clicked
    Then a model popover opens (provider/model quick-switch + API-key entry)
    When the user clicks "APIキー設定" (or "設定する" when unconfigured)
    Then a full dialog opens with heading "APIキー設定"
    And the provider select shows the saved provider (e.g. openai)
    And the model field shows the saved model
    And (desktop) the description mentions the sidecar proxy
    And the API key is shown as stored in the OS keychain (not as plaintext)
    When the user clicks キャンセル
    Then the dialog closes without changing anything
```

Verified: saved provider/model shown as configured, desktop proxy wording
present, キャンセル closes the dialog without changes.

Test notes:
- **The AI-config dialog has NO "閉じる" button** — only キャンセル and 保存.
  E2E must close it via キャンセル (or Escape if Radix handles it); searching
  for a "閉じる" button silently does nothing.
- The model popover (not the dialog) is closed with a "閉じる" button — don't
  confuse the two.
- `providerKeyConfigured` shows a "saved in keychain" badge and a "変更" button
  instead of a password input; click 変更 to reveal the input when testing the
  key field.
- Saving is **not** required for verification — never overwrite the user's
  real keychain config during tests.

#### F5. Chat & AI pipeline ✅

```
Feature: Chat
  Scenario: User sends a message and receives an AI response (real API)
    Given an app is selected
    When the user types a prompt into the chat input
    And presses Ctrl+Enter
    Then the user message appears in the chat
    And an assistant response is streamed in (real provider round-trip)
    And the response contains the expected content (e.g. a token)
    And the status bar updates (tokens / cost / phase info)
  Scenario: Guard — chat requires a selected app
    Given no app is selected
    When the user tries to send a message
    Then an error is shown:
      "⚠️ アプリが選択されていません。ツールバーの「新規アプリ」からアプリを作成するか、アプリ履歴から選択してください。"
    And nothing is sent to the AI
  Scenario: Multi-agent pipeline runs tools
    When the prompt requires a tool (e.g. read_file on package.json)
    Then the agent executes the tool (step log visible)
    And a checkpoint snapshot is saved as real files (see F7)
```

Verified: real responses from the configured provider within seconds; tool
execution (`read_file`) with a visible step log; stream completes (status
"完了").

Test notes:
- Messages are `[id^="chat-msg-"]`; wait for `before + 2` (user + assistant).
- Real-API timeout: 120–240 s (provider latency); dummy mode (existing
  `e2e/desktop.spec.ts`, `DESKSPAWN_E2E_REAL=0`) skips the response assertion.
- The chat input is a textarea; set it with the native value setter pattern
  and press Ctrl+Enter (send button has `title="送信 (Ctrl+Enter)"`).
- Chat requires an app to be selected — guard message
  「⚠️ アプリが選択されていません。ツールバーの「新規アプリ」からアプリを作成するか、アプリ履歴から選択してください。」

#### F6. Preview ✅

```
Feature: Preview
  Scenario: The app is shown in a live local preview
    Given an app with generated files is selected
    Then a preview iframe is rendered (URL: http://localhost:<port>)
    And the iframe serves the generated app's UI (title, #root rendered)
    And the status bar shows "Local :<port>"
  Scenario: Preview toolbar
    When the user uses the preview toolbar
    Then device presets (Tablet 768×1024 / Mobile 375×812), zoom (100% reset),
      refresh, maximize and "open in browser" controls are available
```

Verified: iframe serves the generated app at `http://localhost:<port>/`
(app's own `<title>`, `#root` rendered); preview toolbar controls present.

Test notes:
- Preview is **local-only** (sidecar starts Vite on the real app dir) —
  no WebContainer/cloud dependency on desktop.
- A freshly created app may take a while to boot its preview (bun install +
  Vite). For a stable test, switch to an existing app before asserting the
  iframe, or poll for the iframe up to 60 s.
- The iframe is a separate CDP target (`/json` shows `type: iframe`); in
  Playwright it appears via `page.frames()` with a `localhost:5xxx` URL.

#### F7. Checkpoints ✅

```
Feature: Checkpoints
  Scenario: The pipeline auto-saves a checkpoint after tool execution
    Given an AI response that executes a tool
    Then a snapshot of the app source is saved as real files
      at ~/deskspawn/apps/<app-id>/.deskspawn/checkpoints/<uuid>/
    And (UI) an assistant message bound to a checkpoint shows a restore
      affordance ("このチェックポイントに戻る" tooltip) to roll back
```

Verified (real app): a tool-execution run created
`.deskspawn/checkpoints/<uuid>/` containing the app source (`src/`,
`package.json`, `index.html`, …) — a full snapshot.

Test notes: the restore label is rendered only when an assistant message is
bound to a checkpoint id (UI logic in `ChatPanel`/`ChatMessage`); the on-screen
label is `checkpointLabel` (e.g. CP index) with the tooltip
"このチェックポイントに戻る". Snapshot excludes ignored dirs (node_modules etc.).

### 3.3 Persistence

#### F9. Persistence across restarts ✅

```
Feature: Persistence
  Scenario: Everything survives an app restart
    Given the app is closed gracefully and relaunched
    Then the app list is restored (registry on disk)
    And the previously selected app is restored
    And its chat history is restored (SQLite chat.db)
    And the AI provider/model selection is restored
    And the preview is running again
```

Verified (restart round trip): the selected app, its chat history, the
AI provider/model, and the local preview are all restored after a graceful
close (`CloseMainWindow`) and relaunch.

Storage map (desktop):

| What | Where | Tech |
|---|---|---|
| App registry | `~/deskspawn/apps/apps.json` | JSON |
| Generated app files | `~/deskspawn/apps/<app-id>/` | real files |
| Chat history | `~/deskspawn/apps/<app-id>/.deskspawn/chat.db` | SQLite (v2 schema: `client_id`, `payload`) |
| Checkpoints | `~/deskspawn/apps/<app-id>/.deskspawn/checkpoints/<uuid>/` | real files |
| AI config | `~/deskspawn/config/config.json` | JSON (`providers`, `lastProvider`, `currentApp`) |
| Language / UI settings | `~/deskspawn/config/config.json` `settings` (desktop, Rust IPC `save_settings`/`load_settings`) / Web: localStorage (`SETTINGS_KEY`) | config.json on desktop; localStorage on web |
| API keys | Windows Credential Manager | OS keychain (Rust IPC) |

### Development-only reset (E2E / spec verification)

The E2E suite (`e2e/desktop.spec.ts`) wipes user data in `beforeAll` and
`afterAll` via the Rust command **`reset_app_data`** so every run starts from a
clean state and leaves nothing behind. ⚠️ **This deletes real data** (app
registry, generated app dirs, chat DBs, UI settings, current app). API keys in
the OS keychain and AI provider config are kept.

Guards (required — accidental data loss is prevented structurally):
- environment variable **`DESKSPAWN_TEST_RESET=1`** (unset → command refuses)

How it is invoked from E2E (WebView2 context): `window.__TAURI_INTERNALS__.invoke('reset_app_data')`.
Never run it on a machine with real data — the E2E suite is **dev-environment only**.

> **App history is NOT in localStorage** — it lives in the registry file
> (`apps/apps.json`), so clearing localStorage does not delete apps
> (verified on the real app, F0.1). WebView2 localStorage holds only light
> UI state (language, route, current-app cache).

### Real-API E2E (optional — developer's own responsibility)

The E2E suite can verify the actual AI generation loop (F5/F6/F7: chat → real
response → preview → checkpoints) against a real provider. This is **optional
and entirely the developer's responsibility**: it uses a real API key and
incurs real cost, and the developer is responsible for storing **and deleting**
the key.

**Prerequisites & policy**
- OS keychain storage is assumed (same path as production). Key save/delete is
  left to the developer.
- Real key + cost + any leakage are the **developer's responsibility**.
  Prefer a **rate-limited / low-quota** key, never a production key.
- **CI must never run real-API E2E** (dummy mode only).
- Recommended cost guard: small model, max-token cap, one generation only.

**Setup (leak-avoidance)**
1. Copy the template: `cp .env.example .env` — `.env` is gitignored, never
   committed, and keeps the key out of shell history.
2. Set in `.env`: `DESKSPAWN_API_KEY=...`, `DESKSPAWN_E2E_REAL=1`,
   `DESKSPAWN_E2E_PROVIDER`, `DESKSPAWN_E2E_ENDPOINT`, `DESKSPAWN_E2E_MODEL`.
3. Load without shell history: `set -a; source .env; set +a`.

**Leak-mitigation (automatic)**
- `playwright.config.ts` disables **trace** when `DESKSPAWN_E2E_REAL=1`
  (key/prompt never written to `trace.zip`).
- `pnpm test:e2e:real` runs the suite then cleans `test-results/` and
  `playwright-report/` via `scripts/clean-test-results.mjs`.
- credentials.json (file fallback) only ever lives under the user profile;
  writing outside it is refused.

**Run**
```bash
set -a; source .env; set +a
pnpm test:e2e:real
```

**Post-run (developer's responsibility)**
- Confirm the API key is removed from the OS keychain when done
  (`deskspawn` credential / keyring entry for the provider).
- Delete generated test apps (registry + dirs) or re-run the dummy-mode suite
  which resets to a clean state.

**Full-app generation verification (developer's own agent)**

The E2E suite only checks provider reachability (hello echo). To verify the
actual *app generation loop* (code generation → checkpoints → preview render),
use the helper script (same responsibility & leak rules as above):

```bash
# Default: the script's built-in prompt (fixed in scripts/verify-generate-app.mjs)
node scripts/verify-generate-app.mjs

# Custom prompt (developer's choice)
node scripts/verify-generate-app.mjs "予定管理アプリを作成"
```

Output is JSON: `{ ok, appId, appName, prompt, aiResponded, codeGenerated,
checkpoints, previewRendered, elapsedMs }`. `ok` requires AI response + code
files; `previewRendered` indicates the Vite dev server actually rendered
(verified on the real app: a generated app was rendered in the preview and its
UI was interactive).

Prerequisites:
- **Run the app as a single instance** — duplicate desktop instances race the
  sidecar and cause spurious `Project has no package.json` errors.
- Preview auto-retry after generation is implemented: if boot
  fails mid-generation (package.json not yet written), PreviewPanel retries
  once generation finishes.
- Generation takes minutes and real cost; retry if the model does not respond
  (provider latency is variable).

## 4. Test-Code Generation Guide

### Selectors that worked on the real app

| Purpose | Selector |
|---|---|
| Toolbar buttons | `div.flex.h-10 button` (`nth(1)` app · `nth(2)` 新規アプリ · `nth(3)` model) |
| App popover | `div.absolute.left-0.top-full [role="button"]`; name = row `.font-medium` |
| New-app dialog | heading `新しいアプリを作成`; input placeholder `例: タスク管理アプリ`; buttons `作成` / `キャンセル` |
| Chat input | placeholder `作りたいアプリを指示してください...`; send `Ctrl+Enter` |
| Messages | `[id^="chat-msg-"]` |
| AI config dialog | heading `APIキー設定` (h2); provider = first `select`; close via `キャンセル` |
| Delete | row `button[title="削除"]` → dialog `アプリを削除` → button `削除する` |
| Preview iframe | `page.frames()` where url matches `localhost:5\d+` |
| Status bar | body text contains `Sidecar ✓` / `Desktop` / `Local :<port>` |

### Hard-won pitfalls (encode these in generated tests)

1. **No "閉じる" in the AI-config dialog** — use キャンセル. A leftover open
   dialog blocks every later click (z-50 backdrop intercepts pointer events).
2. **`hasText` substring collisions on app rows** — a date like `<M/D HH:MM>`
   can match digits in a name. Match `.font-medium` exactly, click by index.
3. **Active app cannot be deleted** — switch first, then delete.
4. **Fresh app preview is slow to boot** — poll up to 60 s, or test preview on
   an existing app.
5. **Persistent app state across runs** — use unique names/tokens; clean up
   created apps.
6. **`option` elements are hidden when the select is closed** — assert by
   `toHaveValue`/count, not visibility.
7. **Model popover vs config dialog** are different layers — open the popover
   with toolbar `nth(3)`, then "APIキー設定"/"設定する" for the dialog.
8. **Never overwrite the user's real keychain settings** — verify, then
   cancel; do not press 保存 with a test key.

> **Cost note (CI policy):** F4/F5/F7 involve a real provider API (personal
> key, token cost). Run those against the real API **only on a local machine**.
> CI must use the dummy mode (existing `e2e/desktop.spec.ts`,
> `DESKSPAWN_E2E_REAL=0`) for UI-flow regression — no network/provider cost.
>
> ### API-level verification points (sidecar)

| Check | Expect |
|---|---|
| `GET /health` (no token) | 401 `Unauthorized` (auth enforced) |
| `GET /api/models` (no token) | 401 |
| `GET /api/models` (with token, via app) | 200, model list incl. provider models |
| Preview `http://localhost:<port>/` | 200 HTML |
| `POST /chat` (SSE) | `triage_start → phase_start → triage_result → step_progress → text → done` |

CORS/SSRF posture (security review baseline): custom endpoints are proxied via
the sidecar (`/v1` proxy, `x-upstream`), token required, no `Access-Control-
Allow-Origin` for foreign origins. See `docs/adr/004-three-layer-security.md`.

---

## 5. Verification Log

The detailed verification log (date, commit, environment, per-scenario
results) is kept **outside this repository** (local file
`~/hermes-project/deskspawn-verification/…`) so this spec stays free of
one-time test data. All flows marked ✅ were exercised on a production-mode
desktop build via CDP/Playwright automation of the live WebView2.

Out of scope / not exercised: F10 export/import (native dialogs), installer
(NSIS/MSI) runs, first-launch onboarding on a clean profile.

---

## 🇯🇵 日本語

### このドキュメントの位置づけ

- **ユーザー目線の機能仕様書**であり、**テストコード（E2E/UIテスト）を生成するための参照仕様**。
- 既存の `docs/spec.md`（アーキテクチャ仕様）は変更していません。本ドキュメントは別ファイルとして新規作成されたものです。
- 検証は Windows 実機の**本番ビルド**（Tauri プロダクションモード・`tauri.localhost` 配信）に対して、Playwright（CDP 接続）で実際の UI 操作を行い、結果を記録しています。

### 検証済みユーザーフロー

| フロー | 内容 | 結果 |
|---|---|---|
| F0 起動 | メイン画面直行。**初回起動（言語未設定）時のみ言語選択画面を表示**（config.json に保存・設定済みなら出ない）・ランディングは Web 版のみ | ✅ |
| F0.1 初期状態 | アプリ未選択時のガイド文言・プレビュープレースホルダ・アプリ履歴は実ファイルから残存 | ✅ |
| F0.2 アプリゼロ | 「アプリ履歴はまだありません」+「最初のアプリを作成」（実機再現不可のためコードベース） | 📝 |
| F0.3 復元 | 前回アプリの自動復元（config.json の currentApp） | ✅ |
| F1 起動画面 | タイトル・ツールバー・入力欄・ステータスバー（Sidecar ✓・Desktop）・デスクトップフラグ | ✅ |
| F2 アプリ切替 | 既存アプリ間の往復、履歴も追従 | ✅ |
| F3 アプリ作成 | ダイアログ→名前→作成→ツールバー反映→実ファイル生成（フルスタックテンプレート） | ✅ |
| F4 AI設定 | 保存済みプロバイダー/モデル表示・プロキシ文言・キャンセルで変更なしクローズ | ✅ |
| F5 チャット | 実API応答（保存済みプロバイダー・数秒）・ツール実行（read_file・ステップログ） | ✅ |
| F6 プレビュー | ローカルVite iframe・生成アプリUI描画 | ✅ |
| F7 チェックポイント | ツール実行時に実ファイルスナップショット自動保存（checkpoints/<uuid>/） | ✅ |
| F8 アプリ削除 | 確認ダイアログ経由の削除・選択中アプリの削除ガード | ✅ |
| F9 永続化 | 再起動後もアプリ一覧・チャット・AI設定・プレビューが復元 | ✅ |
| 認証 | /health・/api/models はトークンなしで 401（サイドカー認証が機能） | ✅ |

※ 具体的な検証記録（日付・コミット・環境・シナリオ別結果）は本仕様書に
含めず、リポジトリ外のローカル検証ログに分離している。実APIを使う検証
（F4/F5/F7）はローカル実機限定で、CI ではダミーモード
（`DESKSPAWN_E2E_REAL=0`）のみ実行する。

### テストコード生成時の重要ポイント

1. AI設定ダイアログに「閉じる」ボタンは無い → 閉じるのは「キャンセル」（E2E で「閉じる」を探すと無反応でダイアログが残り、以降のクリックが全部バックドロップにブロックされる）
2. アプリ一覧の行マッチングは `hasText` を使うと日付（例: `<M/D HH:MM>`）の数字とアプリ名が衝突し得る → `.font-medium` の完全一致 + index クリック
3. 選択中のアプリは削除不可（ガード）→ 削除テストは先に別アプリへ切替
4. 新規作成直後のプレビューは起動に時間がかかる（bun install）→ プレビュー検証は既存アプリで、または 60 秒ポーリング
5. 実機の状態は実行間で永続する → アプリ名・検証トークンは毎回ユニークにし、作成したアプリは削除して後片付け
6. APIキーはキーチェーンに保存済み → 検証は「確認してキャンセル」のみ（保存ボタンで実キーを上書きしない）
7. デスクトップ版の起動は**初回（言語未設定）のみ言語選択画面あり**（config.json に `settings` が無い場合）。設定済みなら即メイン画面（言語は `settings.language`・ja デフォルト）。ランディングは Web 版のみ
8. アプリ履歴は localStorage に無い（`apps/apps.json` 実ファイル）・UI設定（言語/テーマ等）は config.json → localStorage クリアでは消えない（実機確認済み）。「アプリゼロ」「言語未設定」の初期画面は、開発環境専用コマンド `reset_app_data`（デバッグビルド + `DESKSPAWN_TEST_RESET=1`・E2E の beforeAll で実行）で再現可能。⚠️ 実データを消すため開発環境限定
9. **実API E2E（`DESKSPAWN_E2E_REAL=1`）は開発者自己責任**（コスト・漏洩含む）。OS キーチェーン保存が前提・キーの保存/削除は開発者に委ねられる。キーは `.env`（gitignore 済み）で管理し、シェル履歴に直接打たない。実APIモードでは playwright の trace は自動オフ（`playwright.config.ts`）・実行後は `pnpm test:e2e:real` が test-results を掃除。CI では実API 不可（ダミーのみ）。詳細は英語本編「Real-API E2E」参照
10. **実アプリ生成のフル検証**（コード生成 → チェックポイント → プレビュー描画）は `node scripts/verify-generate-app.mjs`（引数でプロンプト可変・既定はスクリプト内の固定プロンプト）。⚠️ アプリを**1インスタンス**で起動すること（多重起動はサイドカー競合で `Project has no package.json` の誤エラー）。生成中にプレビュー boot が失敗しても**生成完了後に自動再試行**する（PreviewPanel 修正済み）。実機確認済み ✅: 生成したアプリがプレビューに描画され、UI操作（タスク追加等）まで動作
