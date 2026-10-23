# ADR-019: 署名鍵が用意できるまで Tauri updater を無効にする

## Status

accepted (2026-10-23)

## Context

`apps/desktop/src-tauri/tauri.conf.json` には `plugins.updater`（`pubkey` と
`endpoints`）が設定されており、`src/lib.rs` は起動時に `updater.check()` を実行していた。
一方 `bundle.createUpdaterArtifacts` は未設定のため、リリースワークフローは
`.sig` も updater archive も生成していない。

実測（v0.5.0 / v0.5.1 のリリースアセット）:

- 生成物は `*.msi` / `*-setup.exe` / `*.deb` / `*.rpm` / `*.AppImage` のみ
- `.sig`、`*.AppImage.tar.gz`、`*.app.tar.gz` は存在しない
- `endpoints` の `updates.json` は配信されていない（HTTP 404）

この組み合わせでは更新チェックが構造的に成功し得ない。ユーザーから見ると
「自動更新がある」ように見えて永久に動かない状態で、起動ごとに警告ログが出る。
Microsoft Store (MSIX) 版は `packaged` 判定で updater 自体をスキップしており、
この経路は意図した設計として維持する（ADR-017）。

## Decision

**updater の設定（`plugins.updater`）を `tauri.conf.json` から削除し、起動時の
チェックは「設定が無いので何もしない」状態にする。** プラグイン登録と
`tauri-plugin-updater` の依存はコード上に残す（削除は別作業。Windows 実機での
コンパイル検証が必要なため、設定変更とは分離する）。

再有効化の条件（すべて満たすこと）:

1. `tauri signer generate` で署名鍵を作り、秘密鍵をリポジトリの secret
   （`TAURI_SIGNING_PRIVATE_KEY` / `..._PASSWORD`）に登録する
2. `bundle.createUpdaterArtifacts: true` を有効にする
3. `plugins.updater.pubkey` に公開鍵、`endpoints` に**実際に配信される**
   `updates.json` の URL を設定する
4. リリース後に `updates.json` が更新されるパイプライン（静的ホスティング）を用意する

再発防止として `scripts/desktop-updater-config.test.mjs` を追加した。
`plugins.updater` が存在する場合は `createUpdaterArtifacts: true`・非空の
`endpoints`・非空の `pubkey` を要求するため、「設定だけして動かない」状態は
テストで落ちる。

## Consequences

良い面:

- 存在しない更新エンドポイントへ毎起動アクセスしなくなる（プライバシー・ログの面でも素直）
- 「動くはずの機能が動かない」という説明コストが消える
- 再有効化の前提が ADR とテストで明文化され、半分だけ設定された状態を防げる

悪い面 / トレードオフ:

- NSIS 版の自動更新は当分提供できない（手動ダウンロードでの更新になる）
- プラグイン登録は残るため、`app.handle().updater()` は失敗し続ける。ログを
  `debug` に落として通常運用では見えないようにする（別コミットで対応可）
- Store 版と NSIS 版で更新経路が異なる設計（ADR-017）は維持される

---
