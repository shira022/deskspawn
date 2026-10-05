---
layout: default
title: プライバシーポリシー
---

# DeskSpawn プライバシーポリシー

最終更新日: 2026-10-05

DeskSpawn は、開発者自身のマシン上で動作する AI 駆動のアプリケーション生成ツールです。
**DeskSpawn の開発者は、ユーザーの個人データを一切収集・保存・販売しません。**
アナリティクス・トラッキング・広告 SDK は組み込まれていません（コードベースで確認済み）。

## 1. ネットワーク送信を行う場面

DeskSpawn は以下の目的でのみ外部へ通信します。

| 送信先 | 送信される内容 | 目的 |
|---|---|---|
| **ユーザーが設定した AI プロバイダー**（OpenAI / Google / Azure / 任意のカスタムエンドポイント等） | チャットのプロンプト、会話履歴、生成指示、およびプロバイダーの API 認証情報 | アプリ生成・チャット応答のための AI 推論 |
| **models.dev** | 個人を特定する情報なしのリクエスト | モデル一覧・価格情報の取得 |
| **npm レジストリ** | 個人を特定する情報なしのリクエスト | 生成したアプリの依存パッケージのインストール |
| **GitHub（shira022.github.io）** | 個人を特定する情報なしのリクエスト | デスクトップ版の更新確認（Microsoft Store 版では無効化されています） |

- **AI プロバイダーへの送信は、ユーザー自身が設定したアカウント・契約のもとで行われます。**
  どのプロバイダーにどこまで送信されるかは、各プロバイダーのプライバシーポリシーの適用範囲です。
- 生成されたアプリが外部と通信する場合、それは生成物側の挙動であり、DeskSpawn 本体のデータ収集とは別です。

## 2. ローカルに保存されるデータ

| 保存先 | 内容 |
|---|---|
| **OS キーチェーン**（Windows Credential Manager / macOS Keychain） | AI プロバイダーの API キー。アプリ外へは書き出されません |
| `~/deskspawn/`（ローカルファイル） | 作成したアプリのソースコード、チャット履歴（SQLite）、設定（JSON）、レジストリ |
| Web 版のブラウザ（IndexedDB / localStorage） | 言語設定・UI 状態・AI 設定のメタデータ（API キーはキーチェーンまたはユーザー指定の保管先） |

すべてのプロジェクトデータはユーザーの端末内に留まります。DeskSpawn の開発者がこれらにアクセスすることはありません。

## 3. 収集・共有しないもの

- 個人を特定できる情報（氏名・メールアドレス等）の収集 — **なし**
- 利用状況の解析・トラッキング — **なし**
- データの第三者への販売・提供 — **なし**
- クラウドへのユーザーデータの同期 — **なし**（すべてローカル保存）

## 4. セキュリティ

- API キーは平文ファイルではなく OS キーチェーンに保存します
- チャット履歴はローカルの SQLite データベースに保存されます
- プロバイダーのカスタムエンドポイントへの転送は、許可リスト・URL 検証などの多層防御で検証されます（詳細は [SECURITY.md](https://github.com/shira022/deskspawn/blob/main/SECURITY.md)）

## 5. 未成年人

DeskSpawn は未成年人を対象として設計されたサービスではなく、未成年人の個人データを意図的に収集しません。

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

**Network transmissions occur only for:**

- **Your configured AI provider** (OpenAI, Google, Azure, or any custom endpoint): your prompts,
  conversation history, and provider API credentials — solely to generate apps and answers,
  under *your* account and subject to *that provider's* privacy policy.
- **models.dev**: anonymous requests to fetch model lists and pricing.
- **npm registry**: anonymous requests to install dependencies of generated apps.
- **GitHub (shira022.github.io)**: anonymous update checks for the desktop build
  (disabled in the Microsoft Store build).

**Locally stored data:** API keys in the OS keychain (Windows Credential Manager / macOS Keychain);
projects, chat history (SQLite), and settings under `~/deskspawn/` — never leaves your device.

We do not collect personally identifiable information, do not track usage, do not sell data,
and do not sync your data to any cloud service.

Questions: [GitHub Issues](https://github.com/shira022/deskspawn/issues).
