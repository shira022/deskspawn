# DeskSpawn 仕様書 v0.1.0

> **プロダクト一言定義**
> 対話型のAIチャットを通じて Windows 専用のネイティブアプリ（.exe）をその場で開発・ビルドできる、完全ローカル完結型のオープンソース（OSS）開発プラットフォーム。

---

## 🧱 1. 固定された技術スタック

生成されるアプリの技術スタックは以下に**完全固定**する。これにより AI のコード生成精度を最大化し、ハルシネーションを極小化する。

### 1.1 アプリケーション基盤（生成対象アプリ）

| 層 | 技術 | 選定理由 |
|---|---|---|
| **Runtime / Shell** | Tauri v2 (Rust) | Windows ネイティブ `.exe` を出力可能。Electron 比でバイナリサイズ 1/10 以下、メモリ消費 1/3 以下 |
| **Frontend** | Vite + React 18 + TypeScript | 高速 HMR、エコシステム最大手、型安全 |
| **UI / Design** | Tailwind CSS + shadcn/ui + lucide-react | ユーティリティファーストCSS + アクセシブルなヘッドレスUI + アイコン |
| **Database** | SQLite（ローカル埋め込み型） | ファイル単体で完結、外部サーバー不要、Windows との親和性抜群 |
| **ORM** | Prisma | `schema.prisma` ファイル1つの編集で DB スキーマ〜TypeScript 型定義まで自動生成。AI による動的スキーマ変更と相性が良い |

### 1.2 DeskSpawn 本体の技術スタック

DeskSpawn 自体も Tauri + React + TypeScript で構築する（dogfooding）。

| 層 | 技術 |
|---|---|
| **Shell** | Tauri v2 (Rust) |
| **Frontend** | Vite + React 18 + TypeScript |
| **UI** | Tailwind CSS + shadcn/ui + lucide-react |
| **子プロセス管理** | Rust 側で `std::process::Command` により Node.js / Cargo プロセスを管理 |
| **AI エージェント** | Vercel AI SDK（`generateText` + `tool()`）によるエージェントループ。React フロントエンドと同一 Node.js プロセス上で動作 |
| **設定保存** | OS キーチェーン（Windows Credential Manager）に API キーを保存。一般設定は JSON ファイル |
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
| WiX Toolset v4 | `wix --version` or インストールパス確認 | ダウンロード URL を表示（`.msi` 直接リンク） |
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
│ prisma/            │                          │
│  schema.prisma     │                          │
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
│   ├── Cargo.toml           # Tauri (Rust) 設定
│   ├── tauri.conf.json      # Tauri ウィンドウ設定
│   ├── src/
│   │   └── lib.rs           # Tauri コマンド定義（空）
│   └── icons/               # デフォルトアイコン
├── prisma/
│   └── schema.prisma        # 空の Prisma スキーマ（generator + datasource 定義済み）
├── package.json             # 依存パッケージ定義済み
├── vite.config.ts           # Vite 設定済み
├── tsconfig.json            # TypeScript 設定済み
├── tailwind.config.ts       # Tailwind 設定 + shadcn/ui プラグイン設定済み
└── index.html               # Vite 用 HTML
```

テンプレート展開時に `npm install` が自動実行される。

#### 3.2.2 エージェントループによるコード生成フロー

Vercel AI SDK の `generateText()` + `tool()` を用いて、AI が自律的にツールを呼び出しながらコードを生成する**エージェントループ**を採用する。1回のユーザー指示に対し、AI は複数回のツール呼び出し（最大20往復）を自律実行する。

```
[1] ユーザーがチャットに指示を入力
    例: 「タスク管理アプリにして。タイトルと完了フラグをSQLiteに保存できるように」
         ↓
[2] エージェントがシステムプロンプトを受け取り、自律ループを開始
    システムプロンプト内容:
    - 固定スタック（Tauri/React/Tailwind/shadcn/ui/Prisma/SQLite）の使用を強制
    - 利用可能なツール一覧（後述）
    - Bolt.diy XML 形式の出力ルール（後述）
         ↓
┌─ エージェントループ（最大20往復）────────────────────────┐
│                                                          │
│  [A] AI が「調査」ツールを呼び出し                          │
│      read_file("prisma/schema.prisma")                   │
│      read_file("src/App.tsx")                            │
│      → 現在のコードベースを把握                             │
│         ↓                                                │
│  [B] AI が「一括反映」ツールを呼び出し                       │
│      apply_artifact(`<boltArtifact>...</boltArtifact>`)  │
│      → 全ファイル変更を XML で一括出力                      │
│      → バックエンドがパース・ファイル書き込み                 │
│      → 変更検知 → prisma db push → HMR（自動連動）          │
│         ↓                                                │
│  [C] AI が「エラー確認」ツールを呼び出し                     │
│      get_errors()                                        │
│      → コンパイルエラーがあれば [B] に戻って修正              │
│      → エラーなしならループ終了                             │
│         ↓                                                │
│  （必要に応じて [A]〜[C] を繰り返し）                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
         ↓
[3] 完了。チャットに「✅ コード生成完了」と表示
    プレビューに変更が即座に反映される
```

##### ループ終了条件
- AI がエラーのないコードを生成し、これ以上の変更不要と判断した時点で自動終了
- 20往復に達した場合は強制終了し、ユーザーに現在の状態を報告
- ユーザーが「停止」ボタンを押すことで任意タイミングで中断可能

#### 3.2.3 エージェントツール定義

エージェントループ内で AI が呼び出せるツールは以下の5つ。各ツールは Vercel AI SDK の `tool()` で定義され、バックエンドが実行して結果を AI に返す。

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

##### `apply_artifact(xml: string) → ApplyResult`

**最も重要なツール。** Bolt.diy 互換 XML を受け取り、指定された全ファイルを一括で作成・上書きする。変更検知後、Prisma / Vite の自動連動（後述）が即座に発火する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `xml` | `string` | Bolt.diy 互換 XML（`<boltArtifact>` ルート要素を含む完全な文字列） |

```typescript
type ApplyResult = {
  success: boolean;
  filesChanged: string[];   // 変更されたファイルパス一覧
  shellCommandsRun: string[]; // 実行されたシェルコマンド一覧
  errors?: string[];        // エラーがあれば
};
```

- XML のパースエラー → `success: false` + エラー詳細を返す（AI が自己修正可能）
- `<boltAction type="shell">` は許可リスト（`prisma`, `npm`, `npx` のみ）に制限

##### `run_shell(command: string) → ShellResult`

許可リストに含まれるシェルコマンドを workspace ルートで実行する。

| パラメータ | 型 | 説明 |
|---|---|---|
| `command` | `string` | 実行するコマンド（許可リスト: `prisma`, `npm`, `npx` のサブコマンドのみ） |

```typescript
type ShellResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};
```

- 許可リスト外のコマンド → 実行拒否 + エラーメッセージ
- タイムアウト: 60秒

##### `get_errors() → ErrorInfo[]`

現在のプロジェクトのコンパイル/ビルドエラーを収集して返す。AI が自律的にエラーを把握し修正するために使用する。

```typescript
type ErrorInfo = {
  type: "typescript" | "prisma" | "vite" | "tauri";
  message: string;     // エラーメッセージ全文
  filePath?: string;   // 該当ファイル（特定できる場合）
  line?: number;       // 該当行（特定できる場合）
};
```

- バックエンドが Vite の標準出力、Prisma の標準エラー出力、Tauri のビルド出力を常時監視し、最新のエラー情報を保持
- エラーがない場合は空配列を返す

##### ツール呼び出しの制限
- エージェントループ全体で最大20往復（`maxSteps: 20`）
- 各ツール呼び出しのタイムアウト: 60秒（`run_shell` を除く）
- ツールの実行順序や回数に制限はない（AI が自律判断）

---

#### 3.2.4 Bolt.diy 互換 XML 形式（`apply_artifact` ペイロード仕様）

`apply_artifact` ツールに渡す XML の仕様。AI は以下の XML タグでファイル操作を指示する。

##### `<boltArtifact>`（必須のルート要素）

```xml
<boltArtifact id="project" title="生成内容の概要">
  <boltAction type="file" filePath="src/App.tsx">
    import { useState, useEffect } from 'react';
    // ... 生成されたコード
  </boltAction>
  <boltAction type="file" filePath="prisma/schema.prisma">
    model Task {
      id        Int      @id @default(autoincrement())
      title     String
      completed Boolean  @default(false)
      createdAt DateTime @default(now())
    }
  </boltAction>
  <boltAction type="shell">
    npx prisma db push && npx prisma generate
  </boltAction>
</boltArtifact>
```

##### サポートするタグ

| タグ | 属性 | 説明 |
|---|---|---|
| `<boltArtifact>` | `id`, `title` | 1レスポンスのルート。複数ファイル操作をまとめる |
| `<boltAction type="file">` | `filePath` | 単一ファイルの**全内容**を指定。既存ファイルは上書き、新規ファイルは作成 |
| `<boltAction type="shell">` | （なし） | 実行すべきシェルコマンド。バックエンドが安全性を検証してから実行 |

##### 制約

- AI は必ず**ファイル全体**を出力する（部分 diff ではない）
- `<boltAction type="shell">` は許可リスト（`prisma`, `npm`, `npx` のみ）に制限し、任意コマンド実行を防止
- XML が不正な形式の場合、エラーメッセージをチャットに表示し AI に再生成を要求する

#### 3.2.5 ファイル反映後の自動連動

`apply_artifact` ツールの実行時、バックエンドは XML パース・ファイル書き込みに加え、以下の自動連動処理を同期的に実行する。エージェントループ内で完結するため、AI は連動結果（エラー含む）を `ApplyResult` として即座に受け取ることができる。

```
XML パース → ファイル書き込み
    ↓
[変更検知] どのファイルが変更されたか判定
    ↓
├── schema.prisma が変更された場合:
│     → npx prisma db push  (SQLite にスキーマ適用)
│     → npx prisma generate  (Prisma Client 型再生成)
│     → Vite HMR が自動検知しフロントエンドをホットリロード
│
├── package.json が変更された場合:
│     → npm install  (新規依存をインストール)
│
└── その他 (.tsx, .ts, .css) が変更された場合:
      → Vite HMR が自動検知し即座にホットリロード
```

#### 3.2.6 Vite 開発サーバー管理

- ハーネスエンジン（Rust）が `vite` を子プロセスとして起動・管理
- ポート: デフォルト `5173`。使用中の場合、空きポートを自動検索
- バックエンドがクラッシュしても Vite プロセスは独立して存続（逆も同様）
- WebView は `http://localhost:{port}` を読み込んでレンダリング
- チャット操作中も Vite は常時起動（停止はアプリ終了時のみ）

### 3.3 エラーハンドリングと自律修正

エラーハンドリングはエージェントループに統合されている。個別の再試行ロジックは不要であり、AI が `get_errors()` ツールでエラーを認識し、`apply_artifact()` で自律修正する。

#### 3.3.1 エラー検知（バックエンドの常時監視）

バックエンドは以下のソースを常時監視し、最新のエラー情報を保持する。この情報は `get_errors()` ツールが呼ばれるたびに最新の状態で返される。

| エラー種別 | 監視ソース | `get_errors()` への反映タイミング |
|---|---|---|
| TypeScript コンパイルエラー | Vite の標準出力 | リアルタイム（エラー発生から1秒以内） |
| Prisma スキーマエラー | `prisma db push` / `prisma generate` の標準エラー出力 | `apply_artifact` 実行直後にキャプチャ |
| Vite ビルドエラー | Vite の標準出力 | リアルタイム |
| Tauri ビルドエラー | `cargo build` の標準エラー出力 | Spawn 実行時にキャプチャ |
| XML パースエラー | `apply_artifact` の XML パーサー | `apply_artifact` の戻り値に即時反映 |

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
         AI がエラー内容を解析し、修正した XML を apply_artifact() で再適用
              ↓
         再度 get_errors() で確認 → 解決するまで同一ループ内で反復
              ↓
         ループ上限（20往復）に達した場合:
              → 「⚠️ 自動修正が完了しませんでした。続行しますか？」とユーザーに確認
```

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
    - Prisma スキーマが有効であることを確認
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

### 4.2 Prisma による DB 構造の動的書き換え

- 「データを保存する機能を追加して」という抽象的な指示だけで、AI が `schema.prisma` を編集
- `prisma db push` + `prisma generate` の自動連動により、DB テーブル作成から TypeScript 型定義の更新までを**ゼロクリック**で完結
- フロントエンドの React コードと DB が Prisma Client を介して密結合。チャットのみでデータ駆動型アプリを爆速構築

### 4.3 完全ローカル OSS + 自分の API キー

| | 商用 Web サービス型 | DeskSpawn |
|---|---|---|
| ソースコード | 非公開 | **OSS（オープンソース）** |
| API キー | サービス側が保有（従量課金に上乗せ） | **ユーザー自身の API キー**を使用。使った分だけのクリアな課金 |
| プライバシー | コードがクラウドに送信される | **完全ローカル**。コードもデータも PC 外に出ない |
| オフライン利用 | ❌ インターネット必須 | ローカル LLM（Ollama）使用時は完全オフライン可 |
| ベンダーロックイン | あり（サービス終了で使えなくなる） | **なし**（OSS のためフォークして永続利用可能） |

### 4.4 独自の強みサマリー

1. **Web → Desktop のパラダイムシフト**: AI アプリビルダーをブラウザの制約から解放し、ネイティブ Windows アプリ開発に特化
2. **宣言的 DB 連動**: Prisma スキーマを中心に据えた、チャット駆動のフルスタックデータベース開発
3. **完全な自律性**: ユーザーの PC、ユーザーの API キー、ユーザーのコントロール。外部サービス依存ゼロ
4. **実用成果物**: 「動くプレビュー」ではなく「配布可能なインストーラー」が最終成果物

---

## 📌 付録: 制約とスコープ外（v0.1.0）

### スコープ内（このバージョンで実装）

- [x] 単一プロジェクト管理
- [x] Vercel AI SDK エージェントループ × Bolt.diy 互換 XML によるハイブリッドコード生成
- [x] Tauri + React + Tailwind + shadcn/ui + Prisma + SQLite の固定スタック
- [x] マルチプロバイダー AI 設定 + OS キーチェーン保存
- [x] Windows ビルド依存関係の自動チェックとインストール支援
- [x] 2ペイン / 3ペイン切り替えレイアウト
- [x] Vite HMR によるリアルタイムプレビュー
- [x] Prisma スキーマ変更の自動検知・適用
- [x] エージェントループ内での自律エラー修正（`get_errors` + `apply_artifact` のループ）
- [x] `npm run tauri build` による `.exe` / `.msi` 出力
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
