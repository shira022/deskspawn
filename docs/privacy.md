---
layout: default
title: プライバシーポリシー
---

# DeskSpawn プライバシーポリシー

最終更新日: 2026-10-05

DeskSpawn は、あなた自身のマシン上で動作する AI 駆動のアプリケーション生成ツールです。
**DeskSpawn の開発者は、ユーザーの個人データを一切収集・保存・販売しません。**
アナリティクス・トラッキング・広告 SDK は組み込まれていません（コードベースで確認済み）。

## 1. ネットワーク送信を行う場面

DeskSpawn は以下の目的でのみ外部へ通信します。

| 送信先 | 送信される内容 | 目的 |
|---|---|---|
| **ユーザーが設定した AI プロバイダー**（OpenAI / Google / Azure / 任意のカスタムエンドポイント等） | チャットのプロンプト、会話履歴、生成指示、およびプロバイダーの API 認証情報 | アプリ生成・チャット応答のための AI 推論 |
| **models.dev** | 個人を特定する情報なしのリクエスト | モデル一覧・価格情報の取得 |
| **npm レジストリ** | 個人を特定する情報なしのリクエスト | 生成したアプリの依存パッケージのインストール |
| **WebContainer のホスト（Web 版のみ・StackBlitz 系）** | 個人を特定する情報なしのリクエスト | ブラウザ内ランタイム（Node.js / WASM 等）の取得と起動 |
| **GitHub（shira022.github.io）** | 個人を特定する情報なしのリクエスト | デスクトップ版の更新確認（Microsoft Store 版では無効化されています） |

- **AI プロバイダーへの送信は、ユーザー自身が設定したアカウント・契約のもとで行われます。**
  どのプロバイダーにどこまで送信されるかは、各プロバイダーのプライバシーポリシーの適用範囲です。
- 生成されたアプリが外部と通信する場合、それは生成物側の挙動であり、DeskSpawn 本体のデータ収集とは別です。
- 上記以外への送信は行っていません。各送信先はいずれも DeskSpawn の機能（AI 推論・モデル一覧/価格情報の取得・依存パッケージのインストール・更新確認・Web 版ランタイムの起動）のために必要なものです。

## 2. ローカルに保存されるデータ

| 保存先 | 内容 |
|---|---|
| **OS キーチェーン**（Windows Credential Manager / macOS Keychain） | デスクトップ版の AI プロバイダー API キー。**キーチェーンが利用できない環境では、平文の設定ファイルにフォールバックし、保存時にその旨をアプリ内表示します** |
| `~/deskspawn/`（ローカルファイル） | 作成したアプリのソースコード、チャット履歴（SQLite）、設定（JSON）、レジストリ |
| Web 版のブラウザ（IndexedDB / OPFS / localStorage） | 言語設定・UI 状態・AI 設定・チャット履歴・生成アプリのファイル。**Web 版の API キーはブラウザの IndexedDB に平文で保存されます**（この点は [SECURITY.md](https://github.com/shira022/deskspawn/blob/main/SECURITY.md) にも記載） |

プロジェクトのファイル・チャット履歴・設定の保存はすべてあなたの端末内に留まり、DeskSpawn の開発者がこれらにアクセスすることはありません。ただし、セクション 1 で挙げた送信先へは送信内容が渡ります（それらは送信先のプライバシーポリシーの適用範囲です）。

## 3. 収集・共有しないもの

- 個人を特定できる情報（氏名・メールアドレス等）の収集 — **なし**
- 利用状況の解析・トラッキング — **なし**
- データの第三者への販売・提供 — **なし**
- クラウドへのユーザーデータの同期 — **なし**（すべてローカル保存）

## 4. セキュリティ

- デスクトップ版の API キーは、原則として OS キーチェーンに保存します。キーチェーンが使えない場合は平文の設定ファイルへフォールバックし、保存時にその旨を UI でユーザーに表示します
- チャット履歴はローカルの SQLite データベースに保存されます
- プロバイダーのカスタムエンドポイントへの転送は、許可リスト・URL 検証などの多層防御で検証されます（詳細は [SECURITY.md](https://github.com/shira022/deskspawn/blob/main/SECURITY.md)）

## 5. 未成年者

DeskSpawn は未成年者を対象として設計されたサービスではなく、未成年者の個人データを意図的に収集しません。

## 6. 変更

本ポリシーは変更される場合があり、変更はこのページに掲載されます。

## 7. お問い合わせ

ご質問は [GitHub Issues](https://github.com/shira022/deskspawn/issues) までご連絡ください。

---

# Privacy Policy (English)

Last updated: 2026-10-05

DeskSpawn is an AI-powered application generator that runs on your own machine.
**The developers of DeskSpawn do not collect, store, or sell any user data.**
There is no analytics, tracking, or advertising SDK in the product (verified against the codebase).

## 1. Network transmissions

DeskSpawn communicates externally only for the following purposes:

| Destination | Data sent | Purpose |
|---|---|---|
| **Your configured AI provider** (OpenAI, Google, Azure, or any custom endpoint) | Prompts, conversation history, generation instructions, and the provider's API credentials | AI inference for app generation and chat responses |
| **models.dev** | Anonymous requests | Model lists and pricing |
| **npm registry** | Anonymous requests | Installing dependencies of generated apps |
| **WebContainer hosts (web version only, StackBlitz ecosystem)** | Anonymous requests | Fetching and booting the in-browser runtime (Node.js / WASM) |
| **GitHub (shira022.github.io)** | Anonymous requests | Update checks for the desktop build (disabled in the Microsoft Store build) |

- **AI provider transmissions happen under the account and contract you configure.**
  What is sent to which provider is governed by that provider's privacy policy.
- If a generated app communicates with the outside, that is behavior of the generated artifact,
  separate from DeskSpawn's own data collection.
- No other transmissions are made. Each destination listed above is required for
  DeskSpawn's functionality (AI inference, model list and pricing lookup, dependency
  installation, update checks, and the web runtime).

## 2. Data stored locally

| Location | Contents |
|---|---|
| **OS keychain** (Windows Credential Manager / macOS Keychain) | Desktop API keys. **If the keychain is unavailable, keys fall back to a plain-text settings file, and the app discloses this in the UI at save time** |
| `~/deskspawn/` (local files) | Generated app source code, chat history (SQLite), settings (JSON), registry |
| Web version browser storage (IndexedDB / OPFS / localStorage) | Language settings, UI state, AI settings, chat history, and generated app files. **Web version API keys are stored in the browser's IndexedDB in plain text** (also documented in [SECURITY.md](https://github.com/shira022/deskspawn/blob/main/SECURITY.md)) |

Project files, chat history, and settings always remain on your device and are never
accessible to the DeskSpawn developers. However, the content described in section 1 is
transmitted to the destinations listed there, where their privacy policies apply.

## 3. What we do not collect or share

- No collection of personally identifiable information (name, email, etc.)
- No usage analytics or tracking
- No sale or third-party provision of data
- No cloud sync of user data (everything is stored locally)

## 4. Security

- Desktop API keys are stored in the OS keychain where possible. If the keychain is
  unavailable, they fall back to a plain-text settings file, and the UI discloses this at save time
- Chat history is stored in a local SQLite database
- Forwarding to user-configured custom provider endpoints is protected by allow-listing
  and URL validation (details in [SECURITY.md](https://github.com/shira022/deskspawn/blob/main/SECURITY.md))

## 5. Minors

DeskSpawn is not designed for minors and does not knowingly collect minors' personal data.

## 6. Changes

This policy may be updated; changes will be posted on this page.

## 7. Contact

Questions: [GitHub Issues](https://github.com/shira022/deskspawn/issues).
