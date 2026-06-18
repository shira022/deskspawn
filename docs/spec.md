# DeskSpawn 仕様書（2026-06-04）

> **⚠️ ARCHIVE NOTICE**
> この仕様書は **Tauri 版 DeskSpawn** の設計書です。
> 現在の DeskSpawn は **ブラウザベース（Web版）** として再設計されています。
> Tauri/サイドカー/Rust に関する記述は現在のコードベースには該当しません。
> ブラウザ版の最新情報は [README](https://github.com/shira022/deskspawn#readme) を参照してください。

> **プロダクト一言定義**
> 対話型のAIチャットを通じて Web アプリをその場で開発・プレビューできる、オープンソース（OSS）開発プラットフォーム。ユーザー自身の API キーで動作し、Ollama 使用時は完全ローカル完結。

---

## 🧱 1. 固定された技術スタック

### 1.1 生成されるアプリの技術スタック

生成されるアプリの技術スタックは以下に**完全固定**する。これにより AI のコード生成精度を最大化し、ハルシネーションを極小化する。

| 層 | 技術 | 選定理由 |
|---|---|---|
| **Frontend** | Vite + React 18 + TypeScript | 高速 HMR、エコシステム最大手、型安全 |
| **UI / Design** | Tailwind CSS v4 + lucide-react | ユーティリティファーストCSS + アイコンライブラリ |
| **データ永続化** | IndexedDB（ブラウザ内蔵DB） | サーバー不要、ファイルエクスポートでバックアップ可能 |
| **ストレージアダプター** | `@/lib/storage`（自動生成ラッパー） | IndexedDB をシンプルな CRUD API で操作 |
| **状態管理** | Zustand | 軽量、型安全、ボイラープレート最小 |
| **Runtime** | ブラウザ（生成アプリのプレビュー） | インストール不要、即座にプレビュー可能 |

> 生成されるアプリは **純粋な Web アプリ** であり、Rust / Tauri / SQLite / sqlx / cargo は一切使用しない。
> テンプレートの `package.json` には shadcn/ui は含まれていない。AI エージェントが必要に応じて shadcn/ui パターンのコンポーネントを生成する。
> データは IndexedDB（ブラウザ内蔵）に保存され、永続化・バックアップは DeskSpawn のサイドカーが自動で行う。

### 1.2 DeskSpawn 本体の技術スタック

DeskSpawn 自体は Tauri + React + TypeScript で構築する（dogfooding）。**DeskSpawn は Tauri 専用アプリケーションであり、ブラウザでの単体動作はサポートしない。**

| 層 | 技術 |
|---|---|
| **Shell** | Tauri v2 (Rust) |
| **Frontend** | Vite + React 18 + TypeScript |
| **UI** | Tailwind CSS + shadcn/ui + lucide-react |
| **AI 推論** | Vercel AI SDK（`generateText` + `tool()`）。独立した Node.js sidecar プロセスで実行 |
| **バックエンド（サイドカー側責務）** | HTTP REST API。ファイル I/O、プロジェクト管理、Vite dev server 起動、コード生成の実実行 |
| **セキュリティレイヤー** | Rust Security Server（Tauri プロセス内）。全ファイル操作・シェル実行のパスバリデーションと許可リスト検査 |
| **WebView** | Tauri 組み込み WebView（Windows: WebView2 / macOS: WKWebView） |

#### 1.2.1 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│  Tauri Shell (Rust)                                  │
│  ├── Tauri WebView ─── React Frontend (Vite :5173)  │
│  │   ├── AiConfigScreen → 環境チェック → MainLayout │
│  │   │   └── ChatPanel + PreviewPanel + FileTree     │
│  │   ├── SettingsDialog（テーマ・言語等）              │
│  │   └── Toast/Notifications                         │
│  │                                                    │
│  ├── Rust Security Server ─── port: DESKSPAWN_...    │
│  │   ├── ファイル読み書きのパス検証                    │
│  │   ├── シェルコマンドの許可リスト検査                 │
│  │   ├── apply_artifact のアクション検証               │
│  │   └── APIキーのキーチェーン管理                     │
│  │                                                    │
│  ├── Tauri IPC (invoke)                               │
│  │   └── load_ai_config / save_ai_config /            │
│  │       check_environment / restart_sidecar 等       │
│  └── 子プロセス管理                                   │
│      └── Node.js Sidecar を起動・監視                  │
│                                                        │
│  Node.js Sidecar ─── HTTP REST (:3001)                │
│  ├── Vercel AI SDK（generateText + tool()）            │
│  │   └── マルチエージェントパイプライン                 │
│  │       ├── Triage → Planner → Coder → Verifier      │
│  │       └── → Visual QA                              │
│  ├── MCP Client → grep.app（GitHubコード検索）         │
│  ├── プロジェクト管理 CRUD API                         │
│  ├── チェックポイント管理                              │
│  ├── チャット履歴永続化                                │
│  ├── データバックアップAPI                             │
│  └── 生成アプリVite Dev Server 管理（:5174）           │
│      ├── 子プロセス起動・停止                           │
│      ├── ポート自動検出・フォールバック                 │
│      └── オーファンプロセス自動Kill                     │
└─────────────────────────────────────────────────────┘
```

**データフロー:**

```
[ユーザー入力] → React → Tauri IPC → Rust Security → Sidecar HTTP
                                            ↓
                              Vercel AI SDK (generateText)
                                            ↓
                          ┌─ マルチエージェントパイプライン ──┐
                          │  Triage → Planner → Coder         │
                          │  → Verifier → Visual QA           │
                          └──────────────────────────────────┘
                                            ↓
                              ファイル操作・コマンド実行
                                            ↓
                              Rust Security Server（検証）
                                            ↓
                              実ファイルシステム反映
                                            ↓
                              Vite HMR → プレビュー自動更新
```

**セキュリティ:**
- ファイルI/O・シェル実行はすべて Rust Security Server（Tauriプロセス内）を経由して実行される
- パスバリデーションにより、workspace 外へのファイルアクセスを防止
- シェルコマンドは許可リスト（`npm`, `npx`）のみ実行可能
- APIキーは OS キーチェーン or credentials.json（パーミッション600）に保存。フロントエンドには渡らない
- Sidecar は APIキーをプロセスメモリ上のみ保持。ディスクに書き出さない

---

## ⚙️ 2. 初期設定（オンボーディング）

### 2.1 初回起動フロー

```
アプリ起動
  → [1] AI コンフィグ画面
  → [2] 環境チェック画面
  → [3] メイン画面へ
```

> **メイン画面到達後も**、ツールバーのモデルセレクターからプロバイダー・モデル名をいつでも切り替え可能。API キーが必要なプロバイダー（OpenAI / Anthropic / Google / カスタム）に切り替えた際、API キーが未設定の場合はチャット送信時に事前バリデーションでブロックし、設定を促す。

### 2.2 AI コンフィグ画面

マルチプロバイダー対応の設定 UI。プロバイダー選択後、自動的にモデル一覧を取得（fetch）してドロップダウンに表示する。

#### 対応プロバイダー

| プロバイダー | 区分 |
|---|---|
| OpenAI | 商用クラウド |
| Anthropic (Claude) | 商用クラウド |
| Google (Gemini) | 商用クラウド |
| Ollama | ローカル LLM |
| カスタムエンドポイント | OpenAI API 互換の任意サーバー |

#### 設定項目

| 項目 | 必須 | 説明 |
|---|---|---|
| プロバイダー選択 | 必須 | ドロップダウンで選択。変更時は自動的にモデル一覧を取得 |
| API キー | クラウド利用時は必須 | OS キーチェーン or `credentials.json`（パーミッション600）に保存 |
| モデル名 | 必須 | 自動取得リストから選択。または手動入力（`__custom__` 選択時） |
| カスタムエンドポイント | 任意 | デフォルト以外の API ベース URL。カスタムプロバイダー選択時のみ |
| Temperature | 任意 | デフォルト: 0.2（コード生成のため低め） |
| Max Tokens | 任意 | デフォルト: 16384 |

#### 保存先

| データ | 保存先 |
|---|---|
| API キー | OS キーチェーン（macOS Keychain / Windows Credential Manager）または `credentials.json`（選択式） |
| AI 設定（プロバイダー・モデル名等） | Rust バックエンド（Tauri IPC）経由で保存 |
| アプリ設定（テーマ・言語・フォントサイズ等） | `localStorage('deskspawn_settings')` |

#### モデル一覧の自動取得

プロバイダー選択時、`GET /api/models?provider=<provider>` で該当プロバイダーの利用可能モデル一覧を取得する。
取得したモデル情報には以下が含まれる：

- モデルID / 表示名
- Context / Max Output トークン数
- 対応機能（Tool Call, Reasoning, Image Input, Temperature）
- 価格情報（models.dev ベース、input/output/cache/reasoning の $/1M tokens）

取得に失敗した場合は手動入力フィールドを表示する。

#### メイン画面からのモデル再設定

AI コンフィグ画面を経た後も、メイン画面のツールバー右側にあるモデルセレクターから以下の操作が可能：

- **現在のモデル表示**: プロバイダーアイコン＋モデル名を常時表示。未設定時は「AI未設定」と表示
- **プロバイダー切替**: ドロップダウンで OpenAI / Anthropic / Google / Ollama / カスタム を選択
- **モデル名変更**: 自動取得リストまたはテキスト入力で任意のモデル名に変更
- **モデル価格表示**: 選択中のモデルの料金をインライン表示（In/Out/Cache/Think の $/M）
- **API キー設定**: ポップオーバー内の「APIキー設定」ボタンで AI コンフィグ画面に遷移

#### API キー事前バリデーション

Ollama 以外のプロバイダー使用時、チャット送信前に API キーの有無をチェックする。
不足時は送信をブロックし、設定導線を表示する（エラーレスポンスを待たずに阻止）。

### 2.3 環境チェック画面

DeskSpawn の実行に必要な依存関係を自動検証する。**winget（Windows Package Manager）があればワンクリック自動セットアップが可能。**
環境チェックは Tauri Rust バックエンド経由で実行される（`callBackend("check_environment")`）。

#### チェック項目

| 依存 | チェック方法 | winget パッケージ ID | 自動インストール時 |
|---|---|---|---|
| Node.js (>= 20 LTS) | `node --version` | `OpenJS.NodeJS.LTS` | 約30MB |

#### 自動セットアップフロー（winget 検出時）

1. **環境チェック（自動実行）**: Node.js の有無をチェックし、✅ / ❌ で状態表示
2. **winget 検出**: システムに winget が利用可能か確認（`callBackend("check_winget")`）
3. **不足あり + winget 利用可能 →「自動セットアップ」ボタン表示**
4. **事前確認モーダル**:
   - インストールされるパッケージ一覧（名称・説明・サイズ）
   - 合計ダウンロードサイズ表示
   - UAC（管理者権限確認）が表示されることの事前説明
5. **インストール実行**:
   - 不足パッケージを `winget install --id <package> --silent` で自動インストール
   - サイドカー経由のイベント（`env-setup-progress`）でプログレスバーをリアルタイム表示
6. **完了後**: 環境を再チェックし、全 ✅ なら「DeskSpawn を始める」ボタンがアクティブ化

#### フォールバック（winget 非検出時）

winget が利用できない場合：
- Microsoft Store へのリンクを表示（App Installer の更新を案内）
- Node.js の公式ダウンロード URL を表示
- 各チェック項目に個別の「手動インストール」ボタンを表示

#### 既存インストールの検出

- 既にインストール済みのツールはスキップ（二重インストール防止）
- 全 ✅ の場合は「自動セットアップ」ボタン自体を非表示
- 「DeskSpawn を始める」ボタンは常に利用可能（Node.js 未インストールでもチャットでコード生成は可能。ただしプレビューには Node.js が必要）

#### UI 仕様

- チェック項目を行ごとに表示し、✅ / ❌ アイコンで状態を示す
- インストール中は「インストール中」バッジ + プログレスバーを表示
- 全項目 ✅ になったら「DeskSpawn を始める」ボタンがアクティブ化

---

## 🔄 3. 開発フローとハーネスエンジン

### 3.1 画面レイアウト

ユーザーが切り替え可能な複数レイアウトを提供する。パネルはドラッグでリサイズ可能。

#### 2ペインモード（デフォルト）

```
┌──────────────────────┬──────────────────────────────┐
│                      │                              │
│   チャット            │   ライブプレビュー             │
│   (Chat Panel)       │   (iframe)                   │
│                      │                              │
│  ・会話履歴           │  ・デバイスプリセット           │
│  ・検索・編集         │    (mobile/tablet/desktop)    │
│  ・ステップログ       │  ・ズーム                     │
│  ・フェーズ詳細       │  ・チェックポイントスライダー   │
├──────────────────────┴──────────────────────────────┤
│ ステータスバー（Agent状態 / Token使用量 / Sidecar / Vite）│
└─────────────────────────────────────────────────────┘
```

#### 3ペインモード

```
┌──────┬──────────────────────┬──────────────────────────┐
│📁    │                      │                          │
│FILES │    チャット           │   ライブプレビュー         │
│      │                      │                          │
│ src/ │                      │                          │
│  App │                      │                          │
│  mai │                      │                          │
├──────┴──────────────────────┴──────────────────────────┤
│ ステータスバー                                           │
└────────────────────────────────────────────────────────┘
```

- ファイルツリーにはプロジェクトルートの全ファイルを表示（`node_modules/`, `.git/`, `dist/`, `.deskspawn/` 除外）
- ファイルクリックで読み取り専用ビューをチャットパネル下部に表示（編集不可。編集は AI 経由のみ）
- レイアウト切り替えは右上のアイコンボタンで即時反映

#### プレビューパネルの機能

- **デバイスプリセット**: Mobile (375×812) / Tablet (768×1024) / Desktop (1280×800) の切替
- **ズーム**: 25%〜200% のズーム、リセット機能
- **最大化**: プレビューパネルのみの全画面表示
- **チェックポイントナビゲーション**: 過去の状態に戻る / 進む
- **リロード**: 強制リフレッシュ

### 3.2 ハーネスエンジン（中核機構）

ハーネスエンジンは DeskSpawn の心臓部。ユーザーのチャット指示からコード生成・反映・プレビューまでの一連の流れをオーケストレーションする。

#### 3.2.1 テンプレートプロジェクト

新規プロジェクト開始時、以下のテンプレートがプロジェクトディレクトリ（`sidecar/projects/<id>/`）に展開される。
テンプレートは `templates/react-template/` に配置され、コピーにより展開される。
テンプレートが存在しない場合は最小限のフォールバックスキャフォールドが生成される。

```
project/
├── src/
│   ├── App.tsx              # React コンポジションルート（最小限）
│   ├── main.tsx             # Vite エントリポイント
│   ├── types/               # TypeScript 型定義（空）
│   ├── store/               # Zustand ストア（空）
│   ├── api/                 # API データアクセス層（空）
│   ├── hooks/               # CRUD フック（テンプレート生成時に作成）
│   ├── components/
│   │   └── ui/              # UI プリミティブ（空。AIが生成）
│   ├── lib/
│   │   ├── storage.ts       # ストレージアダプター（プロジェクト作成時に動的生成）
│   │   └── storage-idb.ts   # IndexedDB 実装（プロジェクト作成時に動的生成）
│   └── index.css            # Tailwind セットアップ済み
├── package.json             # 依存定義（React, Tailwind, Zustand, lucide-react）
├── vite.config.ts           # Vite 設定（Tailwind plugin, @ alias）
├── tsconfig.json            # TypeScript 設定（@/* パスエイリアス）
├── index.html               # Vite 用 HTML
└── project.json             # プロジェクトメタデータ
```

`package.json` の依存関係:

| 区分 | パッケージ |
|---|---|
| dependencies | `react`, `react-dom`, `zustand`, `lucide-react`, `clsx`, `tailwind-merge` |
| devDependencies | `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `typescript`, `@types/react`, `@types/react-dom` |

テンプレート展開後に自動的に `npm install --ignore-scripts` が実行される。

**storage.ts / storage-idb.ts の動的生成:**

プロジェクト作成時に `generateStorageAdapterFiles()` により自動生成される。この2ファイルは **DeskSpawn プラットフォーム管理のコアインフラ**であり、AI エージェントによる編集は禁止されている（システムプロンプトで明示的に禁止）。生成アプリのデータ永続化のベースとして機能する。

- `src/lib/storage.ts`: StorageAdapter インターフェース定義 + `initStorage()` `getStorage()` ファクトリー
- `src/lib/storage-idb.ts`: IndexedDBAdapter 実装 + 自動ファイルバックアップ機能

**データ永続化パターン:**
- 生成アプリは IndexedDB にデータを保存
- `@/lib/storage` アダプター経由で CRUD 操作
- 変更のたびに自動的にサイドカーの `/data-backup` API 経由で `.deskspawn/data-backup.json` にバックアップ
- アプリ起動時に IndexedDB が空の場合、バックアップから自動復元

#### 3.2.2 マルチエージェントパイプラインによるコード生成

DeskSpawn は **Node.js sidecar** が AI 推論からファイル操作・コマンド実行までを一貫して行う。
コード生成は **マルチエージェントパイプライン** で構成され、リクエストの複雑さに応じて単一または複数エージェントが協調動作する。

##### アーキテクチャ概要

```
[ユーザー入力]
    ↓
┌─ Phase 0: Triage ──────────────────────────────────┐
│  最小コスト（100-200 tokens）でリクエストを分類       │
│  → "single": Coder のみ（高速・低コスト）           │
│  → "multi":  フルパイプライン（高品質）              │
└─────────────────────────────────────────────────────┘
    ↓ (multi の場合)
┌─ Phase 1: Planner ─────────────────────────────────┐
│  役割: シニアアーキテクト                            │
│  ツール: read_file, list_files, searchGitHub        │
│  出力: 構造化実装計画（plan.json）                    │
│  Step上限: 8 / 継続なし                             │
└─────────────────────────────────────────────────────┘
    ↓ (plan コンテキストを受け渡し)
┌─ Phase 2: Coder ───────────────────────────────────┐
│  役割: 実装エンジニア                                │
│  ツール: read_file, list_files, apply_artifact,     │
│          run_shell, get_errors, searchGitHub         │
│  Step上限: 20（+自動継続最大2回）                    │
│  前フェーズのplanに従い実装                           │
└─────────────────────────────────────────────────────┘
    ↓
┌─ Phase 3: Verifier ────────────────────────────────┐
│  役割: QAエンジニア（エラー検出・自動修正）            │
│  ツール: get_errors, read_file, apply_artifact       │
│  Step上限: 15 / 継続なし                            │
│  全 TypeScript エラーをゼロにするまで修正             │
└─────────────────────────────────────────────────────┘
    ↓
┌─ Phase 4: Visual QA ───────────────────────────────┐
│  役割: ビジュアルQAエンジニア                        │
│  ツール: take_screenshot, read_file                 │
│  Step上限: 5 / 継続なし                             │
│  スクリーンショット＋コンソールエラー検出              │
└─────────────────────────────────────────────────────┘
    ↓
[完了] チャットに結果表示 + プレビュー自動更新
```

##### トリアージ（Triage）Phase 0

リクエストの複雑さを最小コストで判定する。

**simple → Coder のみ実行:**
- タイポ修正・小さなバグ修正
- 1-2ファイルの単純変更（ボタン色変更、入力フィールド追加等）
- シェルコマンド実行
- 単純なUI調整

**multi → フルパイプライン実行:**
- 新規アプリ・機能のフル作成
- 複数ファイルにまたがる CRUD 機能
- 設計・計画が必要な複雑なリクエスト

**トリアージ出力:**
```json
{"mode": "single", "reason": "Simple UI adjustment"}
{"mode": "multi", "reason": "Multi-file feature with dependencies"}
```

##### エージェントループ（各Phase共通）

各フェーズは `generateText` + `tool()` のループで動作する。**ファイル操作・シェル実行は sidecar の HTTP API ではなく、Rust Security Server 経由で実行される。**

```
[フェーズ開始] → システムプロンプトを注入
    ↓
[ループ（最大N steps）]
    ↓
[A] AI がツール呼び出し（例: apply_artifact）
    → Sidecar → Rust Security Server（検証）→ 実ファイルシステム
    ↓
[B] 結果を AI に返送
    ↓
[C] 必要に応じて次のツール呼び出し
    ↓
[ループ終了条件]
    - step上限に達した
    - ループ検出（同一 tool+args が3回連続）
    - 正常完了（AI が完了と判断）
    ↓
[自動継続] step上限に達した場合、進捗（ファイル書き込み等）があれば
          自動で次ラウンドへ（最大2回、+10 bonus steps/回）
```

##### 動的ステップ管理（StepManager）

`sidecar/src/step-limits.ts` の `StepManager` クラスが各フェーズのステップ上限を動的に管理する。

| パラメータ | 値 | 説明 |
|---|---|---|
| ベース値 | フェーズごとに設定（planner:8, coder:20, verifier:15, visual_qa:5） | タスク複雑度に応じてフロントエンドが20/30/50に調整 |
| 進捗延長 | ファイル書込 +10/回（最大+40）、シェル実行 +5/回（最大+20） | 進捗に応じて動的拡張、延長上限+60 |
| ループ検出 | 同一 (tool + args) が3回連続 → loop_detected | 早期停止して無駄を防止 |
| 絶対上限 | 120 steps（全ラウンド合計） | 安全弁 |
| 自動継続 | 最大2回、+10 bonus steps/回 | 上限到達＋進捗あり→自動継続 |

##### ツール定義

エージェントが呼び出せるツールは以下の6つ。フェーズごとに利用可能なツールが制限される。

| # | ツール名 | 説明 | 利用Phase |
|---|---|---|---|
| 1 | `read_file(path)` | ワークスペース内ファイルの読み取り | planner, coder, verifier, visual_qa |
| 2 | `list_files()` | プロジェクトの全ファイル一覧を返す | planner, coder |
| 3 | `apply_artifact(id, title, actions)` | コード変更・ファイル操作・CRUD生成 | coder, verifier |
| 4 | `run_shell(command)` | 許可リスト内のシェルコマンド実行（npm, npx） | coder |
| 5 | `get_errors()` | TypeScriptコンパイルエラーの収集 | coder, verifier |
| 6 | `take_screenshot(target, ...)` | スクリーンショット撮影＋DOM解析 | visual_qa |

**MCPツール（オプション）:**
MCP Client が接続されている場合、以下の追加ツールが利用可能になる：

| ツール名 | 説明 |
|---|---|
| `searchGitHub(query, ...)` | GitHub 公開リポジトリからコードパターンを検索（grep.app） |

##### 各ツールの詳細

**`read_file(path: string) → string`**

| パラメータ | 型 | 説明 |
|---|---|---|
| `path` | `string` | workspace からの相対パス（例: `"src/App.tsx"`） |

- Rust Security Server 経由でパス検証後に実行
- 存在しないパス → エラーメッセージを返す

**`list_files() → FileInfo[]`**

```typescript
type FileInfo = {
  path: string;      // 相対パス
  size: number;      // バイト数
  lastModified: string; // ISO 8601
};
```

- `.deskspawn/`, `node_modules/`, `target/`, `.git/`, `dist/` は除外

**`apply_artifact(id, title, actions) → ApplyResult`**

| パラメータ | 型 | 説明 |
|---|---|---|
| `id` | `string` | 一意識別子 |
| `title` | `string` | 表示用タイトル |
| `actions` | `Action[]` | アクション配列（最大30） |

```typescript
type ApplyResult = {
  success: boolean;
  filesChanged: string[];    // 変更されたファイルパス一覧
  shellCommandsRun: string[]; // 実行されたシェルコマンド一覧
  errors?: string[];         // エラーがあれば
};
```

- ファイル操作は Rust Security Server 経由で実行（パス検証・許可リスト検査）
- JSON のパースエラー → `success: false` + エラー詳細（AI が自己修正可能）

**`run_shell(command: string) → ShellResult`**

| パラメータ | 型 | 説明 |
|---|---|---|
| `command` | `string` | 許可リスト内のコマンド（`npm`, `npx` のサブコマンドのみ） |

```typescript
type ShellResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};
```

- 許可リスト外のコマンド → Rust Security Server が拒否
- タイムアウト: 120秒

**`get_errors() → ErrorInfo[]`**

```typescript
type ErrorInfo = {
  type: "typescript";
  pattern: "missing_module" | "missing_component" | "type_error" | "syntax_error" | "not_found" | "unknown";
  message: string;     // エラーメッセージ全文
  filePath?: string;   // 該当ファイル
  line?: number;       // 該当行
  suggestion?: string; // AI 用の修正提案
};
```

- Rust Security Server 経由で `npx tsc --noEmit` を実行
- エラーは機械可読なパターンに分類される（AI が自律修正するため）
- エラーがない場合は空配列を返す

**`take_screenshot(target, mode, ...) → ScreenshotResult`**

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `target` | `string` | `http://localhost:5174` | プレビューURL |
| `mode` | `"browser"` | `"browser"` | スクリーンショットモード |
| `fullPage` | `boolean` | `true` | フルページ or 表示領域のみ |
| `width` | `number` | `1280` | ビューポート幅 |
| `height` | `number` | `720` | ビューポート高さ |
| `viewports` | `Viewport[]` | 任意 | レスポンシブテスト用：複数ビューポートを一括撮影 |
| `compareWithPrevious` | `boolean` | `false` | 前回とのピクセル差分比較 |
| `waitAfterLoad` | `number` | `1500` | レンダリング待機時間（ms） |

3層のレスポンスを返す：
1. **Layer 1**: base64 JPEG 画像（マルチモーダルモデルが視覚確認）
2. **Layer 2**: 構造化 DOM メタデータ（要素・位置・テキスト・コンソールエラー）
3. **Layer 3**: 人間可読なテキスト要約

`compareWithPrevious: true` 時は差分オーバーレイ画像＋変更領域＋変化率を追加で返す。

#### 3.2.3 SSE イベント仕様

マルチエージェントパイプラインの各ステップで、以下の SSE（Server-Sent Events）が sidecar からフロントエンドに送信される。

##### 基本イベント

| イベント | タイミング | ペイロード |
|---|---|---|
| `step_progress` | 各ステップ開始時 | `{ type, phase, step, maxSteps, continuationRound?, maxContinuations? }` |
| `tool_call` | AI がツール呼び出しを要求した時 | `{ type, phase, toolName, args }` |
| `tool_result` | ツールの実行が完了した時 | `{ type, toolName, result, detail? }` |
| `text` | 全フェーズ完了後の最終テキスト | `{ type, text, usage, phases }` |
| `done` | SSE ストリーム終了 | `{ type }` |
| `error` | エラー発生時 | `{ type, error, errorCode }` |

##### パイプラインイベント

| イベント | タイミング | ペイロード |
|---|---|---|
| `triage_start` | トリアージ開始時 | `{ type, label }` |
| `triage_result` | トリアージ完了時 | `{ type, mode: "single"\|"multi", reason }` |
| `phase_start` | 各フェーズ開始時 | `{ type, phase, label }` |
| `phase_end` | 各フェーズ完了時 | `{ type, phase, steps, usage }` |
| `phase_detail` | 各フェーズの完全な出力テキスト | `{ type, phase, label, text }` |

##### 進捗・制御イベント

| イベント | タイミング | ペイロード |
|---|---|---|
| `checkpoint` | パイプライン完了後のチェックポイント作成時 | `{ type, phase: "all", id }` |
| `rate_limit` | レート制限検出時（リトライ情報） | `{ type, phase, retryCount, maxRetries, waitMs }` |
| `continuation` | 自動継続ラウンド開始時 | `{ type, phase, round, maxRounds }` |

##### チャット UI での表示

```
ヘッダー:
  [Phase: Code Generation] Step 5/20 (Continuation 1/2): コード生成中...

ツール呼び出し:
  🔧 read_file(src/App.tsx)
  ✅ 670 chars read from src/App.tsx

  🔧 apply_artifact(add-todo-model)
  ✅ 3 files changed: src/types/todo.ts, src/store/todoStore.ts, src/components/TodoList.tsx

フェーズ詳細（折りたたみ可能）:
  ── Planner ──
  [plan] タスク管理アプリの実装計画...
  ── Verifier ──
  [fix] 2 errors fixed (missing import, type mismatch)
```

#### 3.2.4 `apply_artifact` ペイロード仕様（JSON フォーマット）

##### 全体スキーマ

```typescript
type Artifact = {
  id: string;                        // 操作の一意識別子
  title: string;                     // 操作の概要（チャット表示用）
  actions: Action[];                 // 実行するアクションの配列（最大30）
};

type Action = FileAction | DiffAction | TemplateAction | ShellAction;

type FileAction = {
  type: "file";
  mode: "file";
  filePath: string;                  // workspace からの相対パス
  content: string;                   // ファイルの全内容（新規 or 全置換）
};

type DiffAction = {
  type: "file";
  mode: "diff";
  filePath: string;
  search: string;                    // 検索パターン（ファイル内で一意にマッチ）
  replace: string;                   // 置換後のコード
};

type TemplateAction = {
  type: "template";
  template: "crud";                  // テンプレート名（現在は crud のみ）
  tableName: string;
  columns: ColumnDef[];
};

type ColumnDef = {
  name: string;
  sqlType: string;                   // "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "DATETIME" 等
  nullable: boolean;
  defaultValue?: string;
  primaryKey?: boolean;              // プライマリキー指定（デフォルト: false）
  unique?: boolean;                  // ユニーク制約（デフォルト: false）
  references?: string;              // 外部キー参照（例: "users(id)"）
};

type ShellAction = {
  type: "shell";
  command: string;                   // 許可リスト内のコマンドのみ（npm, npx）
};
```

##### 例1: 新規ファイル

```json
{
  "id": "new-component",
  "title": "タスク一覧コンポーネントを追加",
  "actions": [
    {
      "type": "file",
      "mode": "file",
      "filePath": "src/components/TaskList.tsx",
      "content": "import { Task } from '../types';\n\nexport function TaskList({ tasks }: { tasks: Task[] }) {\n  return (\n    <ul>{tasks.map(t => <li key={t.id}>{t.title}</li>)}</ul>\n  );\n}"
    }
  ]
}
```

##### 例2: 差分適用

```json
{
  "id": "add-delete-button",
  "title": "削除ボタンを追加",
  "actions": [
    {
      "type": "file",
      "mode": "diff",
      "filePath": "src/components/TaskList.tsx",
      "search": "<li key={t.id}>{t.title}</li>",
      "replace": "<li key={t.id}>\n  {t.title}\n  <button onClick={() => onDelete(t.id)}>削除</button>\n</li>"
    }
  ]
}
```

- `search`: ファイル内で**一意に**マッチすること（複数マッチ → エラー）
- `replace`: 置換後のコード。マルチライン文字列は `\n` で表現
- マッチしない → エラーを `ApplyResult.errors` に返し、AI が再試行
- 基本方針: `mode: "file"`（全内容置換）を優先。差分は主に設定ファイル（package.json等）の部分修正に使用

##### 例3: テンプレート駆動（CRUD 自動生成）

```json
{
  "id": "crud-tasks",
  "title": "tasks コレクションの CRUD を生成",
  "actions": [
    {
      "type": "template",
      "template": "crud",
      "tableName": "tasks",
      "columns": [
        { "name": "title", "sqlType": "TEXT", "nullable": false },
        { "name": "completed", "sqlType": "BOOLEAN", "nullable": false, "defaultValue": "0" },
        { "name": "priority", "sqlType": "INTEGER", "nullable": true, "defaultValue": "0" }
      ]
    }
  ]
}
```

CRUD テンプレートは `src/hooks/useTasks.ts` を自動生成する。生成されるコードには `@deskspawn:generated` マーカーが付与され、AI に対して「このブロックはテンプレート生成物である」ことを示す。ただし強制保護は行わず、システムプロンプトでの注意喚起により運用する。

**生成されるCRUD関数:**
- `get{tables}() → T[]` — 全件取得
- `get{table}ById(id) → T | null` — ID指定取得
- `create{table}(data) → T` — 作成
- `update{table}(id, data) → T` — 更新
- `delete{table}(id) → void` — 削除

##### サポートするアクションタイプ一覧

| アクション | 必須キー | 説明 |
|---|---|---|
| `file` (mode=`"file"`) | `type`, `mode`, `filePath`, `content` | ファイルの**全内容**を置換（新規 or 小規模ファイル用） |
| `file` (mode=`"diff"`) | `type`, `mode`, `filePath`, `search`, `replace` | ファイル内の部分置換 |
| `template` | `type`, `template`, `tableName`, `columns` | テンプレートエンジンで CRUD フックを自動生成 |
| `shell` | `type`, `command` | 許可リスト検証後にシェルコマンド実行 |

##### 制約

- 1つの Artifact 内で全アクションタイプは混在可能
- `mode="diff"` の `search` はファイル内で一意にマッチすること
- `shell` の `command` は許可リスト（`npm`, `npx`）のみ
- JSON が不正な形式の場合、パースエラーを返し AI に再生成を要求
- 1 Artifact あたりの最大アクション数: 30

#### 3.2.5 ファイル反映後の自動連動

`apply_artifact` によるファイル変更後、以下の自動連動処理を実行する。

```
apply_artifact 実行
    ↓
├── package.json が変更された場合:
│     → npm install --ignore-scripts (新規依存をインストール)
│
├── テンプレートアクション実行時:
│     → ストレージアダプターファイルが workspace に書き込まれる
│
├── その他 (.tsx, .ts, .css) が変更された場合:
│     → Vite HMR が自動検知し即座にホットリロード
│
└── 全ケース:
      → 変更前に自動チェックポイント作成（.deskspawn/checkpoints/<id>/）
      → Vite設定ファイルに .deskspawn/ のwatch除外が自動パッチ適用
```

#### 3.2.6 Vite 開発サーバー管理

DeskSpawn は **2つの Vite 開発サーバー** をポート分離で運用する。

| 用途 | デフォルトポート | 管理 | 利用箇所 |
|---|---|---|---|
| DeskSpawn 本体の UI | Tauri `beforeDevCommand` | Tauri が管理 | DeskSpawn 自身の WebView |
| 生成アプリのプレビュー | `5174`（strictPort: false） | サイドカーが子プロセス起動 | プレビューパネルの iframe |

**プレビューサーバー管理:**
- サイドカーが `npm run dev` を子プロセス（`spawn`, `detached: true`）として起動
- `strictPort: false` のため、5174 が使用中なら空きポートにフォールバック
- Vite の "Local:" 出力をパースして実際のポートを検出
- 検出したポートは `/projects/ready` エンドポイントでフロントエンドに通知
- プロジェクト切替時は既存サーバーを `SIGTERM` で停止→新しいプロジェクトで起動
- 起動前に `lsof -ti:<port>` でオーファンプロセスを自動Kill
- Vite 設定に `.deskspawn/` の watch 除外を自動パッチ（チェックポイント操作による不要なHMRリロード防止）

#### 3.2.7 テンプレート CRUD 生成

`apply_artifact` の `template` アクションにより、IndexedDB 操作用の TypeScript CRUD フックを自動生成する。この機能は spec v1.0.0 で「Layer 1: Template Mode」として定義されていたが、現在は Coder エージェントの一部として統合されている。

**生成方式:**
- AI が `type: "template"` アクションを `apply_artifact` に含めると、sidecar 内でテンプレートエンジンが実行される
- ファイル操作・シェル実行は Rust Security Server 経由、テンプレート生成のみ sidecar 内でローカル実行
- 生成先: `src/hooks/use{pascal_tableName}.ts`
- 生成されるコードには `// @deskspawn:generated table=<name>` マーカーがコメントとして付与される

**生成されるファイル例:**
```typescript
// @deskspawn:generated table=tasks
// Auto-generated React hooks for Tasks
import { getStorage } from "@/lib/storage";

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
  updated_at: string | null;
}

const COLLECTION = "tasks";

export async function getTasks(): Promise<Task[]> { ... }
export async function getTaskById(id: string): Promise<Task | null> { ... }
export async function createTask(data: Omit<Task, "id" | "created_at" | "updated_at">): Promise<Task> { ... }
export async function updateTask(id: string, data: Partial<Omit<Task, "id">>): Promise<Task> { ... }
export async function deleteTask(id: string): Promise<void> { ... }
// @deskspawn:end
```

### 3.3 エラーハンドリングと自律修正

エラーハンドリングはマルチエージェントパイプラインに統合されている。**Verifier フェーズ** が専任でエラー検出・修正を行う。

#### 3.3.1 エラー検知

サイドカーが TypeScript コンパイルエラーを収集する。**Vite エラーの監視は行わない**（型チェック＋Visual QA のスクリーンショット＋コンソールエラー検出で十分にカバー）。

| エラー種別 | 監視ソース | 検出タイミング |
|---|---|---|
| TypeScript コンパイルエラー | `tsc --noEmit`（Rust Security Server経由） | `get_errors()` 呼び出し時に最新状態 |

##### エラー分類パターン

`get_errors()` はエラーを機械可読なパターンに分類し、AI 向けの修正提案を含める。

| パターン | 説明 | 修正提案例 |
|---|---|---|
| `missing_module` | モジュールが見つからない（import エラー） | `npm install <package>` を提案 |
| `missing_component` | UIコンポーネントが見つからない | 該当コンポーネントを作成することを提案 |
| `type_error` | 型の不一致・存在しないプロパティ | 型定義の修正を提案 |
| `syntax_error` | 構文エラー | 括弧・引用符の確認を提案 |
| `not_found` | その他の not found | 該当ファイルの作成を提案 |
| `unknown` | 分類不能 | — |

#### 3.3.2 パイプライン内の自律修正の流れ

```
Coder フェーズ完了
    ↓ (plan コンテキストを引き継ぐ)
Verifier フェーズ開始
    ↓
[A] get_errors() で全エラーを取得
    ↓
[B] 各エラーに対して:
    ├── エラーのパターンを分類
    ├── read_file() で該当コードを確認
    └── apply_artifact() で修正
    ↓
[C] 再度 get_errors() で確認
    ├── エラーなし → 完了 ✅
    └── エラーあり → [B] に戻る
    ↓
[D] ループ検出（同一エラーが3回連続）
    → 「自動修正が難しいようです」と報告して終了
```

#### 3.3.3 Visual QA による視認確認

Verifier 完了後、Visual QA フェーズがスクリーンショットによる視認確認を行う。

```
Visual QA フェーズ開始
    ↓
[1] take_screenshot() でデフォルトビューポート（1280×720）を撮影
    ↓
[2] 3層の結果を分析:
    ├── Layer 1: 画像（白画面・レイアウト崩れの確認）
    ├── Layer 2: DOMメタデータ（要素の有無）
    └── Layer 3: コンソールエラー検出
    ↓
[3] 問題があれば報告、なければ ✅ 正常
    ↓
[4] レスポンシブ対応アプリの場合は追加ビューポートでも確認
    （compareWithPrevious で前回との差分確認）
```

#### 3.3.4 自律修正の期待値

| ケース | 期待成功率 | フォールバック |
|---|---|---|
| 単純な型エラー / import 不足 | 〜95% | Verifier 内で自動解決 |
| ロジックエラー（条件分岐ミス等） | 〜80% | 2〜3往復で修正されることが多い |
| 構造的な設計ミス（データフロー誤り等） | 〜50% | Visual QA で検出→ユーザーに委ねる |
| **総合** | **70〜90%** | 残り 10〜30% はユーザーの明示的な指示が必要 |

#### 3.3.5 チェックポイント・ロールバック

- 各 `apply_artifact` 実行前に自動バックアップを作成（`project/.deskspawn/checkpoints/<id>/`）
- **チェックポイントはプロジェクトの全ソースファイルのスナップショット**（`node_modules/`, `.git/`, `dist/`, `.deskspawn/` を除く）
- ユーザーはチャットのチェックポイントスライダーで過去の状態に戻すことが可能
- チェックポイント復元時はプロジェクトファイルをクリア後、該当チェックポイントから復元→Vite Dev Server 再起動
- チャット編集・再生成時は該当チェックポイントまで自動復元してから再実行

**チャット編集/再生成フロー:**
```
ユーザーがメッセージを編集
    ↓
編集対象メッセージより前の最新の assistant メッセージを検索
    ↓
該当チェックポイントに復元（workspaceReady = false）
    ↓
編集後のメッセージから再生成開始
    ↓
生成完了 → 新しいチェックポイント作成
```

### 3.4 プロジェクト管理

複数プロジェクトを管理可能。

#### プロジェクトの種類

すべてのプロジェクトは **Web アプリ**（Vite + React + TypeScript）として作成される。desktop アプリ種別は存在しない。

#### 新規プロジェクト作成

1. ツールバーの「新規アプリ」ボタンをクリック
2. アプリ名を入力（`NewAppDialog`）
3. テンプレートが展開 + `storage.ts` `storage-idb.ts` 生成
4. `npm install --ignore-scripts` + Vite dev server 起動が自動実行
5. 初回チェックポイント（`initial`）作成
6. プレビューが表示されたらチャットで開発開始

#### プロジェクトの切り替え

- ツールバーのプロジェクトセレクターから過去のプロジェクトに切り替え可能
- 切り替え時に Vite dev server が自動で再起動される（古いサーバーを停止→新しいプロジェクトで起動）
- 切替中は iframe を `about:blank` にクリア（古いコンテンツのフラッシュ防止）
- `/projects/ready` をポーリング（1.5秒間隔、最大60回=90秒）して起動完了を検出

#### エクスポート / インポート

- プロジェクトは `.deskspawn` ファイル（zip）としてエクスポート可能
- エクスポート: `zip` コマンドでアーカイブ作成 → HTTP ダウンロード
- インポート: base64 エンコードされた zip を受信 → `unzip` 展開 → プロジェクトディレクトリ復元
- `deskspawn.json` メタデータ（name, version, exportedAt）を含む
- インポート後は自動的に `npm install` + Vite Dev Server 起動

#### データバックアップ（IndexedDB）

生成アプリの IndexedDB データはサイドカーの HTTP API で自動バックアップされる：
- `PUT /data-backup` → `.deskspawn/data-backup.json` に保存
- `GET /data-backup` → バックアップから復元
- 生成アプリの `storage-idb.ts` が各変更操作後に自動的に `PUT /data-backup` を呼び出す

### 3.5 その他の UI 機能

#### チャット検索

- チャットパネルヘッダーの検索アイコンから全文検索を開く
- メッセージ内容・ツール名・ツール実行結果を検索対象
- マッチ件数表示＋前/次のマッチへ移動
- 検索結果のハイライト表示

#### チャット編集・再生成・リトライ

- **編集**: ユーザーメッセージのペンシルアイコン→インライン編集→ Ctrl+Enter で保存
- **再生成**: 最新ユーザーメッセージのリトライアイコン→チェックポイント復元後再生成
- **リトライ**: assistant メッセージの再実行アイコン→該当チェックポイントまで復元後再生成

#### トースト通知

- コード生成完了時・エラー発生時にトースト通知を表示
- バリアント: success / error / info / warning
- 自動消灯: 4秒（デフォルト）

#### テーマ・フォント設定

- テーマ: Light / Dark / System（OS設定に追従）
- UIフォントサイズ・コードフォントサイズ: CSS カスタムプロパティで制御
- `document.documentElement.classList.toggle("dark")` でテーマ切替

#### コスト・トークン表示

- 各 assistant メッセージのフッターにトークン使用量を表示
- ステータスバーにセッション合計のトークン数＋推定コストを表示
- コスト計算: models.dev の価格情報をベースにクライアントサイドで計算

#### 国際化（i18n）

- フレームワーク: i18next + react-i18next
- 対応言語: 日本語、英語
- 設定画面で言語切替可能
- 翻訳ファイル: `src/locales/{lang}/common.json`

#### Simple Mode

- 設定画面で ON/OFF 切替可能
- ON 時: AI の応答が非エンジニア向けの平易な説明になる
- 各システムプロンプト（Coder, Visual QA）に反映され、ファイル名や実装詳細を省略

---

## 🚀 4. 既存ツールに対する優位性

### 4.1 WebContainers の限界突破

| | Bolt.diy / Lovable 等 | DeskSpawn |
|---|---|---|
| 実行環境 | ブラウザ内 WebContainer（Sandbox） | ホスト OS 上で直接実行（Node.js sidecar + Rust Security） |
| PC リソース活用 | ブラウザタブのメモリ制限に依存 | ホスト PC の全 CPU/メモリを使用可能 |
| 出力物 | Web アプリのプレビュー URL のみ | ライブプレビュー + ファイルエクスポート |
| npm パッケージ | 制限あり | フルアクセス（ホストの Node.js） |
| ファイルシステム | 仮想 FS に制限 | 実ファイルシステム（バックアップ・復元可能） |

### 4.2 IndexedDB + 自動ファイルバックアップ

- 「データを保存する機能を追加して」という抽象的な指示に対し、AI がストレージアダプターを使った CRUD コードを一括生成
- DeskSpawn のサイドカーが IndexedDB の内容を自動的にファイルにバックアップするため、ブラウザのストレージをクリアしてもデータが消えない
- `npm install` 不要でデータ保存が可能（IndexedDB はブラウザネイティブ機能）

### 4.3 OSS + 自分の API キー + 明確なプライバシー境界

| | 商用 Web サービス型 | DeskSpawn |
|---|---|---|
| ソースコード | 非公開 | **OSS（オープンソース）** |
| API キー | サービス側が保有（従量課金に上乗せ） | **ユーザー自身の API キー**を使用。使った分だけのクリアな課金 |
| プライバシー（クラウドLLM利用時） | コードがクラウドに送信される | コードが**外部 API に送信される**（OpenAI / Anthropic / Google のサーバーへ）。プライバシーを重視する場合は Ollama（ローカルLLM）を使用 |
| プライバシー（Ollama利用時） | N/A | **完全ローカル**。コードもデータも PC 外に出ない |
| オフライン利用 | ❌ インターネット必須 | ローカル LLM（Ollama）使用時は完全オフライン可 |
| ベンダーロックイン | あり（サービス終了で使えなくなれる） | **なし**（OSS のためフォークして永続利用可能） |

### 4.4 独自の強みサマリー

1. **コード生成と即時プレビューの統合**: チャットで指示するだけで、ライブプレビューに変更が即座に反映される（Vite HMR）
2. **マルチエージェントパイプライン**: Triage → Planner → Coder → Verifier → Visual QA の4段階で高品質なコード生成を実現。リクエストの複雑さに応じて single/multi を自動切替
3. **セキュアなアーキテクチャ**: 全ファイル操作・シェル実行は Rust Security Server を経由。APIキーはフロントエンドに露出しない
4. **ホスト OS 上で動作**: WebContainer の制約から解放され、実ファイルシステム、実 Node.js、任意の npm パッケージが使用可能
5. **データの永続性**: IndexedDB の内容をサイドカーが自動ファイルバックアップ。ブラウザのストレージ制約に依存しない
6. **OSS + BYOK（Bring Your Own Key）**: 完全オープンソース。API キーはユーザー自身のものを使い、使った分だけのクリアな課金体系
7. **ローカルLLM対応**: Ollama 使用時は完全オフライン・完全プライベート
8. **プロジェクト管理とエクスポート**: 複数プロジェクトの切り替え、`.deskspawn` ファイルによるエクスポート/インポートが可能
9. **チェックポイントシステム**: 各生成ごとに自動スナップショット。過去の任意の状態にワンクリックで復元可能
