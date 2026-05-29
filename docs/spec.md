# DeskSpawn 仕様書 v1.0.0

> **プロダクト一言定義**
> 対話型のAIチャットを通じて Web アプリをその場で開発・プレビューできる、オープンソース（OSS）開発プラットフォーム。ユーザー自身の API キーで動作し、Ollama 使用時は完全ローカル完結。

---

## 🧱 1. 固定された技術スタック

### 1.1 生成されるアプリの技術スタック

生成されるアプリの技術スタックは以下に**完全固定**する。これにより AI のコード生成精度を最大化し、ハルシネーションを極小化する。

| 層 | 技術 | 選定理由 |
|---|---|---|
| **Frontend** | Vite + React 18 + TypeScript | 高速 HMR、エコシステム最大手、型安全 |
| **UI / Design** | Tailwind CSS v4 + shadcn/ui + lucide-react | ユーティリティファーストCSS + アクセシブルなヘッドレスUI + アイコン |
| **データ永続化** | IndexedDB（ブラウザ内蔵DB） | サーバー不要、ファイルエクスポートでバックアップ可能 |
| **ストレージアダプター** | `@/lib/storage`（カスタムラッパー） | IndexedDB をシンプルな CRUD API で操作 |
| **状態管理** | Zustand | 軽量、型安全、ボイラープレート最小 |
| **Runtime** | ブラウザ（WebView / 任意のブラウザ） | インストール不要、即座にプレビュー可能 |

> 生成されるアプリは **純粋な Web アプリ** であり、Rust / Tauri / SQLite / sqlx / cargo は一切使用しない。
> データは IndexedDB（ブラウザ内蔵）に保存され、永続化・バックアップは DeskSpawn のサイドカーが自動で行う。

### 1.2 DeskSpawn 本体の技術スタック

DeskSpawn 自体は Tauri + React + TypeScript で構築する（dogfooding）。

| 層 | 技術 |
|---|---|
| **Shell** | Tauri v2 (Rust) |
| **Frontend** | Vite + React 18 + TypeScript |
| **UI** | Tailwind CSS + shadcn/ui + lucide-react |
| **AI 推論** | Vercel AI SDK（`generateText` + `tool()`）。独立した Node.js sidecar プロセスで実行 |
| **バックエンド（サイドカー側責務）** | ファイル I/O、プロジェクト管理、Vite dev server 起動、コード生成の実実行 |
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

> **メイン画面到達後も**、ツールバーのモデルセレクターからプロバイダー・モデル名をいつでも切り替え可能。API キーが必要なプロバイダー（OpenAI / Anthropic / Google / カスタム）に切り替えた際、API キーが未設定の場合はチャット送信時に事前バリデーションでブロックし、設定を促す。

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

#### メイン画面からのモデル再設定

AI コンフィグ画面を経た後も、メイン画面のツールバー右側にあるモデルセレクターから以下の操作が可能：

- **現在のモデル表示**: プロバイダーアイコン＋モデル名を常時表示。未設定時は「AI未設定」と表示
- **プロバイダー切替**: ドロップダウンで OpenAI / Anthropic / Google / Ollama / カスタム を選択
- **モデル名変更**: テキスト入力で任意のモデル名に変更
- **API キー設定**: ポップオーバー内の「APIキー設定」ボタンで AI コンフィグ画面に遷移

#### API キー事前バリデーション

Ollama 以外のプロバイダー使用時、チャット送信前に API キーの有無をチェックする。
不足時は送信をブロックし、設定導線を表示する（エラーレスポンスを待たずに阻止）。

### 2.3 環境チェック画面

DeskSpawn の実行に必要な依存関係を自動検証する。**winget（Windows Package Manager）があればワンクリック自動セットアップが可能。**

#### チェック項目

| 依存 | チェック方法 | winget パッケージ ID | 自動インストール時 |
|---|---|---|---|
| Node.js (>= 20 LTS) | `node --version` | `OpenJS.NodeJS.LTS` | 約30MB |

#### 自動セットアップフロー（winget 検出時）

1. **環境チェック（自動実行）**: Node.js の有無をチェックし、✅ / ❌ で状態表示
2. **winget 検出**: システムに winget が利用可能か確認
3. **不足あり + winget 利用可能 →「自動セットアップ」ボタン表示**
4. **事前確認モーダル**:
   - インストールされるパッケージ一覧（名称・説明・サイズ）
   - 合計ダウンロードサイズ表示
   - UAC（管理者権限確認）が表示されることの事前説明
5. **インストール実行**:
   - 不足パッケージを `winget install --id <package> --silent` で自動インストール
   - プログレスバーで進捗をリアルタイム表示
6. **完了後**: 環境を再チェックし、全 ✅ なら「DeskSpawn を始める」ボタンがアクティブ化

#### フォールバック（winget 非検出時）

winget が利用できない場合：
- Microsoft Store へのリンクを表示（App Installer の更新を案内）
- Node.js の公式ダウンロード URL を表示
- 「インストール」ボタンクリックでブラウザに公式ダウンロードページを開く

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

ユーザーが切り替え可能な複数レイアウトを提供する。

#### 2ペインモード（デフォルト）

```
┌──────────────────┬──────────────────────────┐
│                  │                          │
│   チャット        │   ライブプレビュー         │
│   (Chat Panel)   │   (iframe)               │
│                  │                          │
│                  │   workspace Vite を       │
│                  │   読み込んで表示           │
│                  │   (port 5174)            │
├──────────────────┴──────────────────────────┤
│ [🤖モデル] [新規アプリ]   ステータスバー       │
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
│    │              │                          │
├────┴──────────────┴──────────────────────────┤
│ [🤖モデル] [新規アプリ]   ステータスバー       │
└─────────────────────────────────────────────┘
```

- ファイルツリーにはプロジェクトルートの全ファイルを表示
- ファイルクリックで読み取り専用ビューをチャットパネル下部に表示（編集不可。編集は AI 経由のみ）
- レイアウト切り替えは右上のアイコンボタンで即時反映

### 3.2 ハーネスエンジン（中核機構）

ハーネスエンジンは DeskSpawn の心臓部。ユーザーのチャット指示からコード生成・反映・プレビューまでの一連の流れをオーケストレーションする。

#### 3.2.1 テンプレートプロジェクト

新規プロジェクト開始時、以下の構成済みテンプレートがプロジェクトディレクトリ（`projects/<id>/`）に展開される。

```
project/
├── src/
│   ├── App.tsx              # React エントリポイント（コンポジションルート）
│   ├── main.tsx             # Vite エントリポイント
│   ├── types/               # TypeScript 型定義
│   ├── store/               # Zustand ストア
│   ├── api/                 # データアクセス層
│   ├── hooks/               # CRUD フック（テンプレート自動生成）
│   ├── components/
│   │   └── ui/              # UI プリミティブ（shadcn/ui パターン）
│   ├── lib/
│   │   ├── storage.ts       # ストレージアダプターインターフェース
│   │   └── storage-idb.ts   # IndexedDB 実装
│   └── index.css            # Tailwind セットアップ済み
├── package.json             # 依存パッケージ定義済み（React, Tailwind 等）
├── vite.config.ts           # Vite 設定済み
├── tsconfig.json            # TypeScript 設定済み
└── index.html               # Vite 用 HTML
```

テンプレート展開時に `npm install` が自動実行される。

**データ永続化パターン**: 生成アプリは IndexedDB（ブラウザ内蔵）にデータを保存する。`@/lib/storage` アダプター経由で CRUD 操作を行い、DeskSpawn サイドカーが自動的にファイルにバックアップする。

#### 3.2.2 エージェントループによるコード生成フロー

DeskSpawn は **Node.js sidecar** が AI 推論からファイル操作・コマンド実行までを一貫して行うシンプルなアーキテクチャを採用する。

```
┌─ Node.js Sidecar ──────────────────────────────────────────┐
│  Vercel AI SDK (generateText + tool)                       │
│  → AIがツール呼び出しを生成                                   │
│  → ファイル読み書き・コマンド実行を sidecar 内で直接実行        │
│  → エラー監視・収集も sidecar 内で完結                        │
└────────────────────────────────────────────────────────────┘
```

##### エージェントループの流れ

```
[1] ユーザーがチャットに指示を入力
    例: 「タスク管理アプリにして。タイトルと完了フラグを保存できるように」
         ↓
[2] エージェントがシステムプロンプトを受け取り、自律ループを開始
    システムプロンプト内容:
    - 固定スタック（React/Tailwind/shadcn/ui/IndexedDB）の使用を強制
    - 利用可能なツール一覧
    - ストレージアダプター + Zustand によるデータ管理のテンプレート
         ↓
┌─ エージェントループ（最大20往復）────────────────────────────┐
│                                                             │
│  [A] AI がツール呼び出しを実行                                │
│      → read_file("src/App.tsx")                              │
│      → 結果を AI が確認                                       │
│                                                              │
│  [B] AI がコード変更を JSON で要求                             │
│      → apply_artifact({ ... })                                │
│      → sidecar が JSON パース・検証                           │
│      → ファイル書き込み（バックアップ作成）                      │
│      → 変更検知: package.json → npm install                  │
│      → 結果を AI に返送                                       │
│                                                              │
│  [C] AI がエラー確認                                          │
│      → get_errors()                                          │
│      → sidecar が TypeScript エラーを収集して返送               │
│      → エラーあり → [B] に戻り修正                             │
│      → エラーなし → ループ終了                                 │
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

##### SSE によるリアルタイム進捗表示

エージェントループの各ステップで、以下の SSE（Server-Sent Events）が sidecar からフロントエンドに送信され、チャット内にリアルタイムで表示される。

| イベント | タイミング | ペイロード |
|---|---|---|
| `step_progress` | 各ステップ開始時 | `{ step: number, maxSteps: number }`（maxStepsは進捗に応じて動的に増加） |
| `tool_call` | AI がツール呼び出しを要求した時 | `{ step: number, toolName: string, args: object }` |
| `tool_result` | ツールの実行が完了した時 | `{ toolName: string, result: string, detail?: object }` |
| `text` | 全ステップ完了後の最終テキスト | `{ text: string, usage: object, steps: number }` |
| `done` | SSE ストリーム終了 | `{}` |

**チャット UI での表示**:
- ヘッダーに `Step 2/10: コードを生成中...` を表示
- ツール呼び出しを `🔧 read_file(App.tsx)`、実行結果を `✅ 670 chars read from src/App.tsx` のように表示
- コード生成完了後、プレビュー iframe を自動リロード

#### 3.2.3 エージェントツール定義

エージェントループ内で AI が呼び出せるツールは以下の5つ。各ツールは Vercel AI SDK の `tool()` で定義され、**Node sidecar 内で直接実行**される。

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

- `.deskspawn/`, `node_modules/`, `target/`, `.git/`, `dist/` は除外

##### `apply_artifact(json: string) → ApplyResult`

**最も重要なツール。** JSON ペイロード（後述のスキーマ）を受け取り、sidecar がファイル操作・コマンド実行を行う。

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
- `type="shell"` は許可リスト（`npm`, `npx` のみ）に制限

##### `run_shell(command: string) → ShellResult`

許可リストに含まれるシェルコマンドを workspace ルートで実行する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `command` | `string` | 実行するコマンド（許可リスト: `npm`, `npx` のサブコマンドのみ） |

```typescript
type ShellResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};
```

- 許可リスト外のコマンド → 実行拒否 + エラーメッセージ
- タイムアウト: 120秒（npm install が遅い場合に備えて長め）

##### `get_errors() → ErrorInfo[]`

現在のプロジェクトの TypeScript コンパイルエラーを収集して返す。AI が自律的にエラーを把握し修正するために使用する。

```typescript
type ErrorInfo = {
  type: "typescript";
  message: string;     // エラーメッセージ全文
  filePath?: string;   // 該当ファイル（特定できる場合）
  line?: number;       // 該当行（特定できる場合）
};
```

- sidecar が `tsc --noEmit` を実行してエラーを収集
- エラーがない場合は空配列を返す

##### ツール呼び出しの制限
- エージェントループのステップ上限は動的に変動する（動的ステップ管理）
  - **ベース値**: 20 steps（初期値、タスク複雑度に応じて20/30/50に自動調整）
  - **進捗に応じた延長**: ファイル書き込み (+10/回、最大+40)、シェル実行 (+5/回、最大+20)、延長上限+60
  - **ループ検出による早期停止**: 同一の (tool + args) が3回以上連続 → ループと判断
  - **絶対上限**: 120 steps（全ラウンド合計の安全弁）
  - **自動継続**: ステップ上限到達時に進捗があれば自動で次ラウンドへ（最大2回、+10 bonus/回）
  - 実装: `sidecar/src/step-limits.ts`（StepManager クラス）
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
        { "name": "completed", "sqlType": "BOOLEAN", "nullable": false, "defaultValue": "0" }
      ]
    }
  ]
}
```

CRUD テンプレートは IndexedDB 操作用の TypeScript フック（`src/hooks/useTasks.ts`）を自動生成する。Rust コードや SQL マイグレーションは生成しない。

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

---

#### 3.2.5 ファイル反映後の自動連動

`apply_artifact` によるファイル変更後、以下の自動連動処理を実行する。

```
apply_artifact 実行
    ↓
├── package.json が変更された場合:
│     → npm install  (新規依存をインストール)
│
└── その他 (.tsx, .ts, .css) が変更された場合:
      → Vite HMR が自動検知し即座にホットリロード
```

#### 3.2.6 Vite 開発サーバー管理

DeskSpawn は **2つの Vite 開発サーバー** をポート分離で運用する。

| 用途 | デフォルトポート | 管理 | 利用箇所 |
|---|---|---|---|
| DeskSpawn 本体の UI | `5173` | Tauri `beforeDevCommand` | DeskSpawn 自身の WebView |
| 生成アプリのプレビュー | `5174` | サイドカーが子プロセス起動 | プレビューパネルの iframe |

- **サイドカー**: project ディレクトリで `vite` を子プロセスとして起動し、空きポートを自動検出。検出したポートをフロントエンドに通知
- プレビューパネルの iframe は `http://localhost:{workspacePort}` を読み込む
- コード生成完了時、`workspaceReady` のトグルにより iframe が自動リロード
- プレビューヘッダーに現在のポート番号を表示（`:5174`）

#### 3.2.7 2層コード生成モード

DeskSpawn v1.0.0 では、AI が生成するコードを以下の 2 層で管理する。**基本方針: AI に自由にコードを書かせることを許可するが、適用するのは全検証を通過したコードのみ。**

##### Layer 1: Template Mode（最安定）

テンプレート生成。AI はテーブル名・カラム名のみを指定し、TypeScript CRUD フックをテンプレートエンジンが自動生成する。

| 対象 | 生成されるもの |
|---|---|
| CRUD | `get{Table}s`, `get{Table}ById`, `create{Table}`, `update{Table}`, `delete{Table}` |
| React Hooks | `use{Table}s()` カスタムフック（IndexedDB ストレージアダプター使用） |

- エラー率が最も低い
- 出力先: `src/hooks/`（`@deskspawn:generated` マーカーで保護）
- AI による直接編集禁止（マーカーで保護）

##### Layer 2: Freeform Mode（自由生成）

AI が**自由に TypeScript コードを生成**する。TypeScript の型チェック（`tsc --noEmit`）のみを検証として通過したコードが workspace に反映される。

**適用条件（すべて必須）**

- ✅ `tsc --noEmit` 成功

##### 2層の比較

| | Layer 1: Template | Layer 2: Freeform |
|---|---|---|
| **AI の自由度** | テーブル定義のみ | 完全自由 |
| **安定性** | ◎ 最高 | ○ `tsc` 通過時 |
| **生成可能アプリ** | CRUD 中心 | カレンダー、グラフ、ダッシュボード、外部API連携 等 |
| **v1.0.0 実装** | ✅ 必須 | ✅ 必須 |
| **出力先** | `src/hooks/` | `src/` 配下（任意） |

##### フォールバックルール

| 試行回数 | Layer 1 動作 | Layer 2 動作 |
|---|---|---|
| 1回目 | エラーを AI に返送。定義の修正を試みる | エラーを AI に返送。コード修正を試みる |
| 2回目 | テンプレートを再適用 | 修正コードを再検証 |
| 3回連続失敗 | 中断。「別のアプローチを提案してください」と依頼 | 中断。「別のアプローチを提案してください」と依頼 |

##### 読み取り専用ブロック

テンプレートが生成したコードには `@deskspawn:generated` マーカーが付与される。AI はこのブロックを上書きできない。

```typescript
// @deskspawn:generated table=tasks
export async function getTasks(): Promise<Task[]> {
  return getStorage().getAll<Task>("tasks");
}
// @deskspawn:end
```

---

### 3.3 エラーハンドリングと自律修正

エラーハンドリングはエージェントループに統合されている。個別の再試行ロジックは不要であり、AI が `get_errors()` ツールでエラーを認識し、`apply_artifact()` で自律修正する。

#### 3.3.1 エラー検知

サイドカーが TypeScript コンパイルエラーを収集する。この情報は `get_errors()` ツールが呼ばれるたびに最新の状態で返される。

| エラー種別 | 監視ソース | `get_errors()` への反映タイミング |
|---|---|---|
| TypeScript コンパイルエラー | `tsc --noEmit` | `apply_artifact` 実行直後にキャプチャ |

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

- 各 `apply_artifact` 実行前に自動バックアップを作成（`project/.deskspawn/checkpoints/`）
- ユーザーはチャットで過去の状態に戻すことが可能（チェックポイントスライダー）
- 最新のチェックポイントは `project/.deskspawn/checkpoints/` に保存

### 3.4 プロジェクト管理

v1.0.0 では複数プロジェクトを管理可能。

#### プロジェクトの種類

すべてのプロジェクトは **Web アプリ**（Vite + React + TypeScript）として作成される。desktop アプリ種別は存在しない。

#### 新規プロジェクト作成

1. ツールバーの「新規アプリ」ボタンをクリック
2. アプリ名を入力
3. テンプレートが展開され、`npm install` + Vite dev server 起動が自動実行
4. プレビューが表示されたらチャットで開発開始

#### プロジェクトの切り替え

- ツールバーのプロジェクトセレクターから過去のプロジェクトに切り替え可能
- 切り替え時に Vite dev server が自動で再起動される

#### エクスポート / インポート

- プロジェクトは `.deskspawn` ファイル（zip）としてエクスポート可能
- エクスポートしたプロジェクトは他の DeskSpawn 環境にインポート可能

---

## 🚀 4. 既存ツールに対する優位性

### 4.1 WebContainers の限界突破

| | Bolt.diy / Lovable 等 | DeskSpawn |
|---|---|---|
| 実行環境 | ブラウザ内 WebContainer（Sandbox） | ホスト OS 上で直接実行（Node.js sidecar） |
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
2. **ホスト OS 上で動作**: WebContainer の制約から解放され、実ファイルシステム、実 Node.js、任意の npm パッケージが使用可能
3. **データの永続性**: IndexedDB の内容をサイドカーが自動ファイルバックアップ。ブラウザのストレージ制約に依存しない
4. **OSS + BYOK（Bring Your Own Key）**: 完全オープンソース。API キーはユーザー自身のものを使い、使った分だけのクリアな課金体系
5. **ローカルLLM対応**: Ollama 使用時は完全オフライン・完全プライベート
6. **プロジェクト管理とエクスポート**: 複数プロジェクトの切り替え、`.deskspawn` ファイルによるエクスポート/インポートが可能
