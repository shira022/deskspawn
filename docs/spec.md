# DeskSpawn 仕様書 v0.1.0

> **プロダクト一言定義**
> 対話型のAIチャットを通じて Windows 専用のネイティブアプリ（.exe）をその場で開発・ビルドできる、オープンソース（OSS）開発プラットフォーム。ユーザー自身の API キーで動作し、Ollama 使用時は完全ローカル完結。

---

## 🧱 1. 固定された技術スタック

生成されるアプリの技術スタックは以下に**完全固定**する。これにより AI のコード生成精度を最大化し、ハルシネーションを極小化する。

### 1.1 アプリケーション基盤（生成対象アプリ）

| 層 | 技術 | 選定理由 |
|---|---|---|
| **Runtime / Shell** | Tauri v2 (Rust) | Windows ネイティブ `.exe` を出力可能。Electron 比でバイナリサイズ約 1/10（アプリ本体 5〜15MB）、メモリ消費約 1/3 |
| **Frontend** | Vite + React 18 + TypeScript | 高速 HMR、エコシステム最大手、型安全 |
| **UI / Design** | Tailwind CSS + shadcn/ui + lucide-react | ユーティリティファーストCSS + アクセシブルなヘッドレスUI + アイコン |
| **Database** | SQLite（ローカル埋め込み型） | ファイル単体で完結、外部サーバー不要、Windows との親和性抜群 |
| **DB ドライバー** | sqlx（Rust ネイティブ非同期SQLiteドライバー） | コンパイル時クエリ検証。Tauri の Rust バックエンドと自然に統合。Prisma 非使用（Node.js ランタイム不要） |

### 1.2 DeskSpawn 本体の技術スタック

DeskSpawn 自体も Tauri + React + TypeScript で構築する（dogfooding）。

| 層 | 技術 |
|---|---|
| **Shell** | Tauri v2 (Rust) |
| **Frontend** | Vite + React 18 + TypeScript |
| **UI** | Tailwind CSS + shadcn/ui + lucide-react |
| **AI 推論** | Vercel AI SDK（`generateText` + `tool()`）。独立した Node.js sidecar プロセスで実行。**責務は AI 推論と tool call 要求の生成のみ** |
| **バックエンド（Rust 側責務）** | ファイル I/O、JSON パース・検証、プロセス管理（Vite / Tauri build）、許可リストによるシェル実行制御、キーチェーン保存 |
| **WebView** | Tauri 組み込み WebView（Windows: WebView2 / Edge Chromium） |

---

## ⚙️ 2. 初期設定（オンボーディング）

### 2.1 初回起動フロー

```
アプリ起動
  → [1] AI コンフィグ画面
  → [2] 環境チェック画面
  → [3] メイン画面へ
```

### 2.2 AI コンフィグ画面

OpenCode の設計思想を参考にした、マルチプロバイダー対応の設定 UI。

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
| プロバイダー選択 | 必須 | ドロップダウンで選択 |
| API キー | クラウド利用時は必須 | OS キーチェーンに保存（平文保存禁止） |
| モデル名 | 必須 | 例: `gpt-4o`, `claude-sonnet-4-20250514`, `gemini-2.5-flash` |
| カスタムエンドポイント | 任意 | デフォルト以外の API ベース URL |
| API バージョン | 任意 | プロバイダー固有のバージョン指定が必要な場合 |
| Temperature | 任意 | デフォルト: 0.2（コード生成のため低め） |
| Max Tokens | 任意 | デフォルト: プロバイダー上限の 80% |

#### 保存先

- **API キー**: OS キーチェーン（Windows Credential Manager / macOS Keychain）
- **その他設定**: `%APPDATA%/DeskSpawn/config.json`

### 2.3 環境チェック画面

Tauri で `.exe` をビルドするために必要な依存関係を自動検証する。

#### チェック項目

| 依存 | チェック方法 | 不足時の対応 |
|---|---|---|
| Node.js (>= 20 LTS) | `node --version` | ダウンロード URL を表示 + ボタンでブラウザ起動 |
| Rust (MSVC Toolchain) | `rustup show` / `rustc --version` | `rustup` インストーラーURL を表示 |
| Visual Studio Build Tools (MSVC) | レジストリ / `vswhere` 確認 | Visual Studio Installer のダウンロードリンクを表示 |
| WiX Toolset v4 | `wix --version` or インストールパス確認 | MSI インストーラー出力が必要な場合のみ必須。NSIS（Tauri v2 標準 bundler）で十分な場合は不要 |
| WebView2 Runtime | レジストリ確認 (Win) | 通常 Windows 10/11 にプリインストール済みのため警告のみ |

#### UI 仕様

- チェック項目を行ごとに表示し、✅ / ❌ アイコンで状態を示す
- ❌ 項目には「インストール」ボタンを表示。クリックでブラウザに公式ダウンロードページを開く
- 全項目 ✅ になったら「DeskSpawn を始める」ボタンがアクティブ化

---

## 🔄 3. 開発フローとハーネスエンジン

### 3.1 画面レイアウト

ユーザーが切り替え可能な複数レイアウトを提供する。

#### 2ペインモード（デフォルト）

```
┌──────────────────┬──────────────────────────┐
│                  │                          │
│   チャット        │   ライブプレビュー         │
│   (Chat Panel)   │   (WebView)              │
│                  │                          │
│                  │   Vite dev server を      │
│                  │   読み込んで表示           │
│                  │                          │
├──────────────────┴──────────────────────────┤
│  [📎添付] [Spawn .exe]    ステータスバー      │
└─────────────────────────────────────────────┘
```

#### 3ペインモード

```
┌────┬──────────────┬──────────────────────────┐
│📁  │              │                          │
│FILES│  チャット    │   ライブプレビュー         │
│    │              │                          │
│ src/│              │                          │
│  App│              │                          │
│  mai│              │                          │
│ migrations/        │                          │
│  0001_tasks.sql    │                          │
│    │              │                          │
├────┴──────────────┴──────────────────────────┤
│  [📎添付] [Spawn .exe]    ステータスバー      │
└─────────────────────────────────────────────┘
```

- ファイルツリーにはプロジェクトルートの全ファイルを表示
- ファイルクリックで読み取り専用ビューをチャットパネル下部に表示（編集不可。編集は AI 経由のみ）
- レイアウト切り替えは右上のアイコンボタンで即時反映

### 3.2 ハーネスエンジン（中核機構）

ハーネスエンジンは DeskSpawn の心臓部。ユーザーのチャット指示からコード生成・反映・プレビューまでの一連の流れをオーケストレーションする。

#### 3.2.1 テンプレートプロジェクト

新規プロジェクト開始時、以下の構成済みテンプレートが作業ディレクトリ（`%APPDATA%/DeskSpawn/workspace/`）に展開される。

```
workspace/
├── src/
│   ├── App.tsx              # React エントリポイント
│   ├── main.tsx             # Vite エントリポイント
│   └── index.css            # Tailwind + shadcn/ui セットアップ済み
├── src-tauri/
│   ├── Cargo.toml           # Tauri (Rust) 設定（sqlx 依存含む）
│   ├── tauri.conf.json      # Tauri ウィンドウ設定
│   ├── src/
│   │   ├── lib.rs           # Tauri コマンド定義（AI が追記）
│   │   └── db.rs            # SQLite 初期化 + sqlx マイグレーション（テンプレート）
│   └── icons/               # デフォルトアイコン
├── migrations/              # sqlx マイグレーションファイル（AI が追記）
├── package.json             # 依存パッケージ定義済み（React, Tauri API 等）
├── vite.config.ts           # Vite 設定済み
├── tsconfig.json            # TypeScript 設定済み
├── tailwind.config.ts       # Tailwind 設定 + shadcn/ui プラグイン設定済み
└── index.html               # Vite 用 HTML
```

テンプレート展開時に `npm install` が自動実行される。

**DB アクセスパターン**: 生成アプリは Prisma を一切使用しない。React 側は `invoke()` で Tauri command を呼び出し、Rust 側で sqlx が SQLite を操作する。

#### 3.2.2 エージェントループによるコード生成フロー

DeskSpawn は **Node.js sidecar（AI SDK）＋ Rust バックエンド（実実行）** の分離アーキテクチャを採用する。

```
┌─ Node.js Sidecar（AI推論のみ）──────────────────────────────┐
│  Vercel AI SDK (generateText + tool)                       │
│  → AIがツール呼び出しを「要求」生成                            │
│  → 実際のファイル操作・プロセス実行は一切行わない                │
└────────────────────┬───────────────────────────────────────┘
                     │ tool call request (IPC)
                     ↓
┌─ Tauri Rust Backend（実実行・権限制御）──────────────────────┐
│  → ファイルI/O（読み取り・書き込み・バックアップ）               │
│  → JSONパース・検証                                           │
│  → 子プロセス管理（Vite dev server、Tauri build）             │
│  → シェルコマンド実行（許可リスト検証）                         │
│  → エラー監視・収集                                          │
│  → キーチェーン保存                                          │
└────────────────────────────────────────────────────────────┘
```

##### エージェントループの流れ

```
[1] ユーザーがチャットに指示を入力
    例: 「タスク管理アプリにして。タイトルと完了フラグをSQLiteに保存できるように」
         ↓
[2] エージェントがシステムプロンプトを受け取り、自律ループを開始
    システムプロンプト内容:
    - 固定スタック（Tauri/React/Tailwind/shadcn/ui/sqlx/SQLite）の使用を強制
    - 利用可能なツール一覧（後述）
    - Tauri command + sqlx によるDBアクセスのテンプレート（後述）
    - JSON 形式の出力ルール（後述）
         ↓
┌─ エージェントループ（最大20往復）─────────────────────────────┐
│                                                              │
│  Node sidecar（AI SDK）:                                     │
│  [A] AI がツール呼び出しを要求                                │
│      → read_file("src-tauri/src/db.rs")                     │
│      → read_file("src/App.tsx")                             │
│          ↓ IPCでRustに送信                                   │
│  Rust backend:                                               │
│      → ファイルを読み取り、結果を返す                           │
│          ↓ IPCでNode sidecarに返送                           │
│  Node sidecar:                                               │
│  [B] AI がコード変更を JSON で要求                             │
│      → apply_artifact({ ... })                                │
│          ↓ IPCでRustに送信                                   │
│  Rust backend:                                               │
│      → JSONパース・検証                                       │
│      → ファイル書き込み（バックアップ作成）                     │
│      → 変更検知: migrations/ 変更 → sqlx migrate run         │
│      → 変更検知: .rs 変更 → cargo check                      │
│      → 結果（ApplyResult）を返送                              │
│          ↓ IPCでNode sidecarに返送                           │
│  Node sidecar:                                               │
│  [C] AI がエラー確認を要求                                    │
│      → get_errors()                                         │
│          ↓ IPCでRustに送信                                   │
│  Rust backend:                                               │
│      → 監視中のVite/cargo/sqlxエラーを返送                    │
│          ↓                                                  │
│      → エラーあり → [B] に戻り修正                            │
│      → エラーなし → ループ終了                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
         ↓
[3] 完了。チャットに「✅ コード生成完了」と表示
    プレビューに変更が即座に反映される（Vite HMR）
```

##### ループ終了条件
- AI がエラーのないコードを生成し、これ以上の変更不要と判断した時点で自動終了
- 20往復に達した場合は強制終了し、ユーザーに現在の状態を報告
- ユーザーが「停止」ボタンを押すことで任意タイミングで中断可能

#### 3.2.3 エージェントツール定義

エージェントループ内で AI が呼び出せるツールは以下の5つ。各ツールは Vercel AI SDK の `tool()` で定義され、**Node sidecar が要求を生成 → Rust バックエンドが IPC 経由で実行 → 結果を返送** する。

##### `read_file(path: string) → string`

ファイルの内容を読み取って返す。

| パラメータ | 型 | 説明 |
|---|---|---|
| `path` | `string` | workspace からの相対パス（例: `"src/App.tsx"`） |

- 存在しないパス → エラーメッセージを返す
- バイナリファイル → エラーメッセージを返す（テキストファイルのみ読み取り）

##### `list_files() → FileInfo[]`

プロジェクトの全ファイル一覧を返す。

```typescript
type FileInfo = {
  path: string;      // 相対パス
  size: number;      // バイト数
  lastModified: string; // ISO 8601
};
```

- `.deskspawn/`, `node_modules/`, `target/` は除外

##### `apply_artifact(json: string) → ApplyResult`

**最も重要なツール。** JSON ペイロード（後述のスキーマ）を受け取り、Rust バックエンドにファイル操作を要求する。Rust 側で JSON パース・検証・ファイル書き込み・自動連動（sqlx migrate / cargo check）が同期的に実行され、結果が返る。

| パラメータ | 型 | 説明 |
|---|---|---|
| `json` | `string` | JSON ペイロード（`Artifact` スキーマに準拠した完全な文字列） |

```typescript
type ApplyResult = {
  success: boolean;
  filesChanged: string[];   // 変更されたファイルパス一覧
  shellCommandsRun: string[]; // 実行されたシェルコマンド一覧
  errors?: string[];        // エラーがあれば
};
```

- JSON のパースエラー → `success: false` + エラー詳細を返す（AI が自己修正可能）
- `type="shell"` は許可リスト（`npm`, `npx`, `cargo`, `sqlx` のみ）に制限

##### `run_shell(command: string) → ShellResult`

許可リストに含まれるシェルコマンドを workspace ルートで実行する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `command` | `string` | 実行するコマンド（許可リスト: `npm`, `npx`, `cargo` のサブコマンドのみ） |

```typescript
type ShellResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};
```

- 許可リスト外のコマンド → 実行拒否 + エラーメッセージ
- タイムアウト: 120秒（cargo ビルドは時間がかかるため）

##### `get_errors() → ErrorInfo[]`

現在のプロジェクトのコンパイル/ビルドエラーを収集して返す。AI が自律的にエラーを把握し修正するために使用する。

```typescript
type ErrorInfo = {
  type: "typescript" | "sqlx" | "rust" | "vite" | "tauri";
  message: string;     // エラーメッセージ全文
  filePath?: string;   // 該当ファイル（特定できる場合）
  line?: number;       // 該当行（特定できる場合）
};
```

- バックエンドが Vite の標準出力、cargo check / sqlx の標準エラー出力、Tauri のビルド出力を常時監視し、最新のエラー情報を保持
- エラーがない場合は空配列を返す

##### ツール呼び出しの制限
- エージェントループ全体で最大20往復（`maxSteps: 20`）
- 各ツール呼び出しのタイムアウト: 60秒（`run_shell` を除く）
- ツールの実行順序や回数に制限はない（AI が自律判断）

---

#### 3.2.4 `apply_artifact` ペイロード仕様（JSON フォーマット）

`apply_artifact` ツールに渡す JSON の仕様。XML より保守性に優れ、LLM の生成精度も高い JSON を採用する。

##### 全体スキーマ

```typescript
type Artifact = {
  id: string;                        // 操作の一意識別子
  title: string;                     // 操作の概要（チャット表示用）
  actions: Action[];                 // 実行するアクションの配列
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
  columns: {
    name: string;
    sqlType: "INTEGER" | "REAL" | "TEXT" | "BOOLEAN" | "DATETIME";
    nullable: boolean;
    defaultValue?: string;
  }[];
};

type ShellAction = {
  type: "shell";
  command: string;                   // 許可リスト内のコマンドのみ
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

##### 例2: 差分適用（推奨）

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

##### 例3: テンプレート駆動

```json
{
  "id": "crud-tasks",
  "title": "tasksテーブルのCRUDを生成",
  "actions": [
    {
      "type": "template",
      "template": "crud",
      "tableName": "tasks",
      "columns": [
        { "name": "title", "sqlType": "TEXT", "nullable": false },
        { "name": "completed", "sqlType": "BOOLEAN", "nullable": false, "defaultValue": "0" }
      ]
    }
  ]
}
```

##### サポートするアクションタイプ一覧

| アクション | 必須キー | 説明 |
|---|---|---|
| `file` (mode=`"file"`) | `type`, `mode`, `filePath`, `content` | ファイルの**全内容**を置換（新規 or 小規模ファイル用） |
| `file` (mode=`"diff"`) | `type`, `mode`, `filePath`, `search`, `replace` | ファイル内の部分置換 |
| `template` | `type`, `template`, `tableName`, `columns` | テンプレートエンジンで Rust+React コードを自動生成（3.2.7 参照） |
| `shell` | `type`, `command` | 許可リスト検証後にシェルコマンド実行 |

##### 制約

- 1つの Artifact 内で全アクションタイプは混在可能
- `mode="diff"` の `search` はファイル内で一意にマッチすること
- `shell` の `command` は許可リスト（`npm`, `npx`, `cargo`, `sqlx`）のみ
- JSON が不正な形式の場合、パースエラーを返し AI に再生成を要求
- 1 Artifact あたりの最大アクション数: 30

---

#### 3.2.4-bis コード適用フロー（非エンジニア向け全自動）

非エンジニアが「適用/破棄」を都度判断するのは現実的ではない。コード変更は**常に自動適用**し、安全網は「元に戻す」に一本化する。

##### 適用フロー

```
apply_artifact(json) が呼ばれる
    ↓
[1] Rust バックエンドが JSON をパース・検証
    ↓
[2] バックアップを作成（workspace/.deskspawn/backups/）
    ↓
[3] 全アクションを自動実行:
    ├── type="file"       → ファイル書き込み（新規 or 差分適用）
    ├── type="template"   → テンプレートエンジンでコード生成 → ファイル書き込み
    └── type="shell"      → シェルコマンド実行
        実行中はチャットに「⚙️ {title} を実行中...」と表示
    ↓
[4] 自動連動（sqlx migrate / cargo check / Vite HMR）を同期的に実行
    ↓
[5] 結果をチャットに簡潔表示:
    成功 → 「✅ {title} が完了しました」
    失敗 → 「⚠️ {title} でエラーが発生しました。AIが修正を試みます...」
    ↓
[6] 気に入らなければ、チャットで「元に戻して」→ 直前のバックアップから復元
```

##### シェルコマンド実行時の通知

`type="shell"` アクションの実行中は、チャットに現在の処理を表示するが、**ユーザーの確認は求めない**。

```
⚙️ 依存パッケージをインストールしています...
⚙️ データベースを更新しています (sqlx migrate)...
⚙️ コンパイルを確認しています (cargo check)...
```

##### 元に戻す（安全網）

- 「元に戻して」→ 直近の `apply_artifact` 実行前の状態に完全復元
- バックアップは最新 5 世代まで保持
- チャットに「✅ 直前の状態に戻しました」と表示

#### 3.2.5 ファイル反映後の自動連動

`apply_artifact` ツールの実行時、バックエンドは JSON パース・ファイル書き込みに加え、以下の自動連動処理を同期的に実行する。エージェントループ内で完結するため、AI は連動結果（エラー含む）を `ApplyResult` として即座に受け取ることができる。

```
JSON パース（Rust側で検証）→ ファイル書き込み（Rust側でバックアップ）
    ↓
[変更検知] どのファイルが変更されたか判定（Rust側）
    ↓
├── migrations/*.sql が変更された場合:
│     → sqlx migrate run  (SQLite にスキーマ適用)
│
├── src-tauri/**/*.rs が変更された場合:
│     → cargo check  (コンパイル検証)
│
├── package.json が変更された場合:
│     → npm install  (新規依存をインストール)
│
└── その他 (.tsx, .ts, .css) が変更された場合:
      → Vite HMR が自動検知し即座にホットリロード
```

**重要**: 上記の全処理（ファイルI/O、プロセス起動、エラーキャプチャ）は Rust バックエンドが実行する。Node sidecar は一切のファイル操作を行わない。

#### 3.2.6 Vite 開発サーバー管理

- ハーネスエンジン（Rust バックエンド）が `vite` を子プロセスとして起動・管理
- ポート: デフォルト `5173`。使用中の場合、空きポートを自動検索
- バックエンドがクラッシュしても Vite プロセスは独立して存続（逆も同様）
- WebView は `http://localhost:{port}` を読み込んでレンダリング
- チャット操作中も Vite は常時起動（停止はアプリ終了時のみ）

#### 3.2.7 厳格テンプレートによるコード生成

Rust（sqlx + Tauri command）の自由生成は AI のエラー率が高く、プロジェクト崩壊のリスクが大きい。そのため、AI が Rust コードを**自ら書くことは禁止**し、事前定義されたテンプレートの**穴埋めのみ**を許可する。

##### 3.2.7.1 許可する CRUD パターン（4種のみ）

AI が生成できる DB 操作は以下の 4 パターンに限定する。これ以外の Rust コード生成はシステムプロンプトで禁止する。

| パターン | Tauri Command 名 | SQL |
|---|---|---|
| 全件取得 | `get_{table}s` | `SELECT * FROM {table}` |
| 1件取得 | `get_{table}_by_id` | `SELECT * FROM {table} WHERE id = $1` |
| 作成 | `create_{table}` | `INSERT INTO {table} (...) VALUES (...)` |
| 更新 | `update_{table}` | `UPDATE {table} SET ... WHERE id = $1` |
| 削除 | `delete_{table}` | `DELETE FROM {table} WHERE id = $1` |

##### 3.2.7.2 AI が埋める変数のみ

AI が自由に生成してよいのは以下の**変数**だけである。それ以外の Rust コード構造はテンプレートが提供する。

```typescript
// AI への入力（ユーザー指示から抽出、または AI が提案）
type TableDefinition = {
  tableName: string;          // 例: "tasks"
  columns: {
    name: string;             // 例: "title"
    sqlType: SQLiteType;      // 例: "TEXT"
    nullable: boolean;
    defaultValue?: string;
  }[];
};
```

##### 3.2.7.3 型マッピング（固定）

| SQLite 型 | Rust 型 | TypeScript 型 |
|---|---|---|
| `INTEGER` | `i64` | `number` |
| `REAL` | `f64` | `number` |
| `TEXT` | `String` | `string` |
| `BLOB` | `Vec<u8>` | `number[]`（MVP では使用禁止） |
| `BOOLEAN` | `bool`（`INTEGER` 0/1 で保持） | `boolean` |
| `DATETIME` | `String`（ISO 8601） | `string` |

##### 3.2.7.4 テンプレート実装例

AI が `tasks(title: TEXT, completed: BOOLEAN)` を定義した場合、以下のコードがテンプレートから**自動生成**される。

**① SQL マイグレーション**（AI が `CREATE TABLE` 文を生成）
```sql
-- migrations/0001_create_tasks.sql
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**② Rust 構造体 + Tauri Command**（テンプレートが生成。AI は書かない）
```rust
// src-tauri/src/db.rs（テンプレートにより自動生成）
#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub completed: bool, // INTEGER 0/1 → bool に変換
    pub created_at: String,
}

// src-tauri/src/lib.rs（テンプレートにより自動生成）
#[tauri::command]
async fn get_tasks(state: State<'_, DbState>) -> Result<Vec<Task>, String> {
    sqlx::query_as!(Task, "SELECT id, title, completed, created_at FROM tasks")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_task(state: State<'_, DbState>, title: String) -> Result<Task, String> {
    sqlx::query_as!(Task,
        "INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, completed, created_at",
        title
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())
}
// get_task_by_id, update_task, delete_task も同様にテンプレートが生成
```

**③ React Hook**（テンプレートが生成）
```typescript
// src/hooks/useTasks.ts
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const load = () => invoke<Task[]>('get_tasks').then(setTasks);
  const create = (title: string) => invoke<Task>('create_task', { title }).then(t => setTasks(prev => [...prev, t]));
  // update, delete も同様
  return { tasks, load, create };
}
```

##### 3.2.7.5 生成フロー（Rust コードは AI ではなくテンプレートエンジンが生成）

```
[1] ユーザー指示 → AI が TableDefinition（変数のみ）を抽出
    例: { tableName: "tasks", columns: [{ name: "title", sqlType: "TEXT", nullable: false }] }
         ↓
[2] AI が JSON で以下を出力:
    - SQL マイグレーションファイルの file アクション (CREATE TABLE)
    - template アクション ({ "type": "template", "template": "crud", ... })
         ↓
[3] Rust バックエンドが "type": "template" を検出
    → テンプレートエンジンが Rust コード（構造体+Command）と React Hook を自動生成
    → テンプレート生成されたファイルは読み取り専用としてマーク（AI が上書き禁止）
         ↓
[4] 自動連動: sqlx migrate run → cargo check → Vite HMR
```

##### 3.2.7.6 フォールバックルール

テンプレートから生成されたコードが `cargo check` に失敗した場合（テンプレート自体のバグ、または型マッピングの不一致）：

| 試行 | 動作 |
|---|---|
| 1回目 | エラーを AI に返送。AI が `TableDefinition` の修正を試みる |
| 2回目 | テンプレートを再適用。再度 `cargo check` |
| 3回目 | 失敗。AI に「DB設計を簡素化してください」と指示 |
| 3回連続失敗 | テンプレート生成を中断し、手動修正を促すメッセージを表示 |

##### 3.2.7.7 読み取り専用ブロック

テンプレートが生成したファイル領域には `// @deskspawn:generated` マーカーを付与する。AI はこのマーカーで囲まれたコードブロックを**上書き禁止**とし、変更が必要な場合はテンプレートパラメータの変更で対応する。

```rust
// @deskspawn:generated tasks_crud
#[tauri::command]
async fn get_tasks(state: State<'_, DbState>) -> Result<Vec<Task>, String> {
    // ...
}
// @deskspawn:end
```

---

### 3.2.8 セキュリティポリシー（3層自動防御）

非エンジニアがセキュリティ判断をするのは不可能なため、以下の3層防御を**完全自動・不可視**で適用する。

#### レイヤー1: シェルコマンド許可リスト

`type="shell"` で実行可能なコマンドは以下に限定する。これ以外は実行拒否。

| 許可コマンド | 許可サブコマンド | 制限 |
|---|---|---|
| `npm` | `install`, `run` | `npm install` は `--ignore-scripts` を自動付与 |
| `npx` | （なし） | 原則禁止。将来の特定シナリオ用に予約 |
| `cargo` | `check`, `build` | `cargo build` は `--release` のみ（debug不可） |
| `sqlx` | `migrate run`, `migrate revert` | workspace ルートからのみ実行可能 |

#### レイヤー2: 依存パッケージ安全策

| 施策 | 内容 |
|---|---|
| **lockfile 強制** | `package-lock.json`（npm）および `Cargo.lock` が存在しない場合、初回生成時に自動生成。以降、lockfile の存在を必須化 |
| **postinstall ブロック** | すべての `npm install` に `--ignore-scripts` を自動付与。postinstall スクリプトは一切実行しない |
| **バージョン固定** | AI が `package.json` に追加する依存は常に完全なバージョン固定（`"1.2.3"`）。`^` や `~` を禁止 |
| **許可パッケージリスト** | AI が追加できる npm パッケージはホワイトリスト制。リスト外のパッケージを要求した場合、ユーザーに「{pkg} を手動でインストールしてください」と通知 |

##### デフォルト許可パッケージ

```
react, react-dom, @tauri-apps/api, @tauri-apps/plugin-*, 
tailwindcss, @tailwindcss/forms, @tailwindcss/typography,
lucide-react, @radix-ui/*（shadcn/ui 依存）
```

#### レイヤー3: ファイルシステム制限

| 施策 | 内容 |
|---|---|
| **workspace 外アクセス禁止** | すべてのファイル操作は workspace（`%APPDATA%/DeskSpawn/workspace/`）配下のみ。絶対パス・親ディレクトリ参照（`../`）は拒否 |
| **拡張子制限** | 書き込み可能な拡張子: `.tsx`, `.ts`, `.jsx`, `.js`, `.css`, `.html`, `.json`, `.toml`, `.rs`, `.sql`。それ以外は拒否 |
| **最大ファイルサイズ** | 1ファイルあたり 1MB を超える書き込みは拒否 |

---

### 3.3 エラーハンドリングと自律修正

エラーハンドリングはエージェントループに統合されている。個別の再試行ロジックは不要であり、AI が `get_errors()` ツールでエラーを認識し、`apply_artifact()` で自律修正する。

#### 3.3.1 エラー検知（バックエンドの常時監視）

バックエンドは以下のソースを常時監視し、最新のエラー情報を保持する。この情報は `get_errors()` ツールが呼ばれるたびに最新の状態で返される。

| エラー種別 | 監視ソース | `get_errors()` への反映タイミング |
|---|---|---|
| TypeScript コンパイルエラー | Vite の標準出力 | リアルタイム（エラー発生から1秒以内） |
| sqlx マイグレーションエラー | `sqlx migrate run` の標準エラー出力 | `apply_artifact` 実行直後にキャプチャ |
| Rust コンパイルエラー | `cargo check` の標準エラー出力 | `apply_artifact` 実行直後にキャプチャ |
| Vite ビルドエラー | Vite の標準出力 | リアルタイム |
| Tauri ビルドエラー | `cargo build` の標準エラー出力 | Spawn 実行時にキャプチャ |
| JSON パースエラー | Rust 側 JSON パーサー | `apply_artifact` の戻り値に即時反映 |

#### 3.3.2 エージェントループ内の自律修正の流れ

```
AI が apply_artifact() を実行
    ↓
ApplyResult にエラーあり？
    ├── なし → AI が get_errors() で確認
    │            ├── エラーなし → ループ終了 ✅
    │            └── エラーあり → 修正モードへ
    └── あり → 修正モードへ
              ↓
         AI がエラー内容を解析し、修正した JSON を apply_artifact() で再適用
              ↓
         再度 get_errors() で確認 → 解決するまで同一ループ内で反復
              ↓
          ループ上限（20往復）に達した場合:
               → 「⚠️ 自動修正が完了しませんでした。続行しますか？」とユーザーに確認
```

##### 自律修正の期待値

AI による自律修正は万能ではない。現実的な期待値として以下を前提とする：

| ケース | 期待成功率 | フォールバック |
|---|---|---|
| 単純な型エラー / import 不足 | 〜95% | 同一ループ内で自然解決 |
| ロジックエラー（条件分岐ミス等） | 〜80% | 2〜3往復で修正されることが多い |
| 構造的な設計ミス（データフロー誤り等） | 〜50% | 5往復以上かかる場合は人間の指示を推奨 |
| **総合** | **70〜90%** | 残り 10〜30% はユーザーの明示的な指示が必要 |

AI が同じエラーで3回連続失敗した場合、ループを継続せず「🤖 自動修正が難しいようです。別のアプローチを指示してください」とユーザーに委ねる。

#### 3.3.3 ロールバック

- 各 `apply_artifact` 実行前に自動バックアップを作成（`workspace/.deskspawn/backups/`）
- ユーザーはチャットで「元に戻して」と指示することで直前の状態に復元可能
- バックアップは最新5世代まで保持

### 3.4 Spawn（.exe ビルド）

#### 3.4.1 ビルドフロー

```
ユーザーが「Spawn」ボタンをクリック
    ↓
[1] プリフライトチェック
    - TypeScript コンパイルエラーがないことを確認
    - `cargo check` が成功することを確認
    - sqlx マイグレーションが適用済みであることを確認
    ↓
[2] ビルド実行（バックグラウンド）
    - npm run tauri build を実行
    - 進捗をチャットにリアルタイム表示
    ↓
[3] 完了
    - 出力先: workspace/src-tauri/target/release/bundle/msi/
    - Setup.exe（MSI インストーラー）が生成される
    - 成功: 「✅ ビルド完了！Setup.exe を出力しました」+ フォルダを開くボタン
    - 失敗: エラーをチャットに表示し、AI による自動修正を提案
```

#### 3.4.2 Spawn 設定（ビルド前の確認ダイアログ）

| 項目 | デフォルト値 | 説明 |
|---|---|---|
| アプリ名 | （チャットから抽出 or 手入力） | `.exe` のプロダクト名 |
| バージョン | `0.1.0` | セマンティックバージョニング |
| ウィンドウタイトル | アプリ名と同じ | タイトルバーに表示される文字列 |
| アイコン | デフォルト | カスタムアイコンを指定可能（png/ico） |

### 3.5 プロジェクト管理

MVP（v0.1.0）では**単一プロジェクト**のみ対応。

- ユーザーが新しいアプリを作りたい場合は、既存プロジェクトが上書きされる
- 確認ダイアログを表示:「現在のプロジェクトを破棄して新しいプロジェクトを作成しますか？」
- 複数プロジェクト管理は v0.2.0 以降で検討

---

## 🚀 4. 既存ツールに対する優位性

### 4.1 WebContainers の限界突破

| | Bolt.diy / Lovable 等 | DeskSpawn |
|---|---|---|
| 実行環境 | ブラウザ内 WebContainer（Sandbox） | Windows ホスト OS 上で直接実行 |
| Rust コンパイル | ❌ 不可能 | ✅ `cargo build` で本物のバイナリ生成 |
| 本物の SQLite | ❌ WebContainer 内の仮想 FS 制約 | ✅ ホスト OS のファイルシステム上に本物の `.db` ファイル |
| PC リソース活用 | ブラウザタブのメモリ制限に依存 | ホスト PC の全 CPU/メモリを使用可能 |
| 出力物 | Web アプリのプレビュー URL のみ | 配布可能な Windows `.exe` / `.msi` |

### 4.2 sqlx + Tauri Command によるネイティブ DB 連動

- 「データを保存する機能を追加して」という抽象的な指示に対し、AI が SQL マイグレーション（`CREATE TABLE`）と Rust の Tauri command、React の `invoke()` 呼び出しを一括生成
- `sqlx migrate run` + `cargo check` の自動連動により、DB テーブル作成から Rust コンパイル検証までを**ゼロクリック**で完結
- 生成アプリは Node.js ランタイムを一切含まず、純粋な Rust バイナリとして配布可能。Prisma のランタイム依存問題を根本解決

### 4.3 OSS + 自分の API キー + 明確なプライバシー境界

| | 商用 Web サービス型 | DeskSpawn |
|---|---|---|
| ソースコード | 非公開 | **OSS（オープンソース）** |
| API キー | サービス側が保有（従量課金に上乗せ） | **ユーザー自身の API キー**を使用。使った分だけのクリアな課金 |
| プライバシー（クラウドLLM利用時） | コードがクラウドに送信される | コードが**外部 API に送信される**（OpenAI / Anthropic / Google のサーバーへ）。プライバシーを重視する場合は Ollama（ローカルLLM）を使用 |
| プライバシー（Ollama利用時） | N/A | **完全ローカル**。コードもデータも PC 外に出ない |
| オフライン利用 | ❌ インターネット必須 | ローカル LLM（Ollama）使用時は完全オフライン可 |
| ベンダーロックイン | あり（サービス終了で使えなくなる） | **なし**（OSS のためフォークして永続利用可能） |

### 4.4 独自の強みサマリー

1. **Web → Desktop のパラダイムシフト**: AI アプリビルダーをブラウザの制約から解放し、ネイティブ Windows アプリ開発に特化
2. **宣言的 DB 連動**: SQL マイグレーション + sqlx + Tauri command を中心に据えた、チャット駆動のネイティブデータベース開発
3. **透明なプライバシー境界**: ユーザーの PC、ユーザーの API キー、ユーザーのコントロール。クラウドLLM利用時はコードがAPIに送信されることを明示。完全ローカルが必要ならOllamaを選択可能
4. **実用成果物**: 「動くプレビュー」ではなく「配布可能なインストーラー」が最終成果物

---

## 📌 付録: 制約とスコープ外（v0.1.0）

### スコープ内（このバージョンで実装）

- [x] 単一プロジェクト管理
- [x] Vercel AI SDK エージェントループ × JSON ペイロード（file / diff / template の3モード）
- [x] Node.js sidecar（AI 推論のみ）＋ Rust バックエンド（実実行）の責務分離アーキテクチャ
- [x] テンプレート駆動コード生成（CRUD 4パターン限定、型マッピング固定、テンプレートエンジンがRustコードを自動生成）
- [x] JSON 差分モード（`mode="diff"`、`search` / `replace`）＋ 全自動適用（元に戻す）
- [x] Tauri + React + Tailwind + shadcn/ui + sqlx + SQLite の固定スタック
- [x] マルチプロバイダー AI 設定 + OS キーチェーン保存
- [x] Windows ビルド依存関係の自動チェックとインストール支援
- [x] 2ペイン / 3ペイン切り替えレイアウト
- [x] Vite HMR によるリアルタイムプレビュー
- [x] sqlx マイグレーション変更の自動検知・適用
- [x] 3層自動防御セキュリティ（許可リスト / lockfile強制 + postinstallブロック + バージョン固定 / workspace制限）
- [x] コード変更の全自動適用（確認不要）+ チャット「元に戻す」による安全網
- [x] エージェントループ内での自律エラー修正（期待成功率 70〜90%。3回連続失敗でユーザーに委譲）
- [x] `npm run tauri build` による NSIS Setup.exe / MSI 出力
- [x] ファイル変更の自動バックアップ（5世代）

### スコープ外（将来バージョンで検討）

- [ ] 複数プロジェクト管理
- [ ] Git 連携（自動コミット、GitHub 連携）
- [ ] プラグインシステム
- [ ] カスタムテンプレート（技術スタックの選択肢追加）
- [ ] 共同編集 / チーム機能
- [ ] macOS / Linux 対応（Tauri 自体はクロスプラットフォームだが、v0.1.0 は Windows 専念）
- [ ] Electron アプリ出力対応
- [ ] モバイルアプリ出力（Tauri mobile）
- [ ] チャット履歴の永続化・検索
- [ ] プロジェクトのエクスポート（GitHub / ZIP）
