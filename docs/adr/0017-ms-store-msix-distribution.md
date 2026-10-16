# ADR-0017: Microsoft Store 配布（MSIX フルパッケージ方式）

## Status
accepted

## Context

DeskSpawn は Windows デスクトップアプリ（Tauri v2）で、配布経路は GitHub Releases（NSIS/MSI）に加えて Microsoft Store を選んだ。

Store は MSIX/Appx と EXE/MSI の両形式を受け付ける。

- **EXE/MSI 方式**は、versioned HTTPS の Package URL（自前 CDN）と Authenticode コード署名が必須になる。本プロジェクトは署名証明書を購入しておらず、配信 CDN も持たないため、この2つの前提を満たすには追加コストと運用が必要だった。
- **MSIX 方式**は、提出パッケージを Store が自動で再署名し、配信ホスティングも Store 側が提供する。一方で payload（本体 exe・サイドカー・アセット）をすべて同梱する必要があり、サイドカーのファイル名規則（generic 名と target triple 名の両方が必要）や WebView2 の前提を自分で検証する責任が残る。

MSIX には通常パッケージと sparse パッケージがある。sparse は identity のみを同梱し本体を含まないため Store 配布には使えない。

## Decision

1. **配布形式は MSIX フルパッケージ方式を採用**し、`winapp` CLI の `winapp pack` でパッケージを生成する。通常の `winapp init` で作るフルパッケージを使い、sparse は使わない。
2. **Identity 3値（Name / Publisher / PublisherDisplayName）は Partner Center の予約値と完全一致**させる。manifest は `apps/desktop/store/msix/Package.appxmanifest` を single source of truth としてリポジトリで管理し、値の写しをドキュメントに置かない。
3. **MSIX のバージョンは 4 桁（`X.Y.Z.0`）**とし、リポジトリの単一バージョン（3桁 SemVer）から機械的に導出する。`scripts/build-msix.mjs` が manifest のバージョン書き換え・payload 収集・`winapp pack` の呼び出しを行い、`scripts/set-version.py` と `scripts/check-versions.mjs` の対象に manifest を含めて整合を検証する。
4. **Store 版では Tauri の updater を無効化**する（パッケージ identity を検出したら無効化し、更新は Store に一本化する）。GitHub Releases 版は従来どおり自己 updater を持つ。
5. ステージングは**許可リスト方式**とし、manifest と `Assets/` の tiles 以外（バックアップディレクトリ等）をパッケージに混入させない。混入は回帰テストで防ぐ。

## Alternatives Considered

- **EXE/MSI 方式（EXE 単体での提出を含む）**: コード署名証明書（OSS 向けの無償枠を含む）と自前 CDN の確保が必要で、現段階では運用コストが見合わないため却下。ただし Store が受理する形式であることは事実で、将来 CDN と署名を持つ場合は再検討の余地がある。
- **MSIX sparse パッケージ**: identity のみで本体ファイルが含まれず、配布に使えないため却下。
- **Store 版でも自己 updater を有効にする**: Store が管理する更新と二重になり、更新経路が競合するため却下。
- **Store 専用に別 identity を用意する**: 同一マシンで同名アプリがサイドバイサイドに並び、ユーザーに混乱を生むため却下。
- **manifest をドキュメントに転記して管理する**: 値が二重管理になり乖離するため却下。manifest を唯一の定義とする。

## Consequences

- コード署名証明書の購入が不要になり、配信ホスティングも Store が提供する。ユーザーは Store から入手でき、SmartScreen の警告も出ない。
- 更新のたびに MSIX を再パッケージして提出する必要がある（配信・更新は Store が担う）。
- manifest のバージョンは 4 桁で**単調増加が必須**。バージョン一括更新と整合チェックの対象に含める。
- payload の同梱漏れ（本体・サイドカー・アセット）は起動失敗として現れるため、ステージングの許可リストとそのテストで担保する。
- Store 版と GitHub Releases 版で更新経路が異なる（自己 updater の有無）。ユーザー向け説明で区別する必要がある。
- 提出前のローカル検証として、MSIX を実機インストールし、UI・プレビュー・チャット・サイドカー health と「Store モード（updater 無効）」のログ行を確認する運用を必須とする。
- 実績: 0.5.0 が本方式で提出・公開され、x64 のみの配信として登録された。

## References

- 更新手順: `docs/store-update-runbook.md`
- パッケージング定義: `apps/desktop/store/msix/`
- 生成スクリプト: `scripts/build-msix.mjs`
