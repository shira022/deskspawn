# ADR-016: エージェント構成の5段階（ユーザー選択の難易度を廃止）

## Status
accepted

## Context

アプリ作成時にユーザーが選ぶ「難易度（simple / medium / complex）」機能が存在したが、これは本来のユーザー意図（**マルチ/シングルエージェントの構成を段階的に選びたい**）とは別軸の機能だった。さらに既定値 `medium` が triage の自動判定を上書きしてしまい、**自動判定が事実上無効化される**という欠陥があった。

一方、triage は要求を 1〜5 の複雑度に分類していたが、その出力をエージェント構成へ写すルーティングは if 連鎖で散在しており、L2 と L3 の区別が曖昧（L3 のみ visual_qa を追加）など、5段階と言いながら実質3〜4構成しか存在しなかった。

## Decision

1. **難易度機能を完全撤去**する。後方互換・マイグレーションは不要（開発段階・未リリースのため）。`DifficultyLevel` 型、`AppMeta.difficulty`、作成ダイアログのセレクタ、AppSwitcher のバッジをすべて削除する。
2. `orchestrator.ts` に単一テーブル `PIPELINE_TIERS` を新設し、レベル→構成の対応を**1箇所**に集約する。`runWithTriage` は表を引くだけにする。

   | レベル | phases | fixRounds | dummyDataRegen |
   |---|---|---|---|
   | L1 | coder | 0 | false |
   | L2 | coder, verifier | 0 | false |
   | L3 | planner, coder, verifier | 0 | false |
   | L4 | planner, coder, verifier, visual_qa | 1 | true |
   | L5 | planner, coder, verifier, visual_qa | 2 | true |

   修正ループは `visual_qa` の出力から起動するため、`visual_qa` を含まない L1〜L3 の `fixRounds` は 0（L3 の「検証・修正1回」という以前の記述は事実に反していたため訂正）。
   5段階すべてが異なる `(phases, fixRounds, dummyDataRegen)` の組を持つ。
3. `MAX_FIX_ROUNDS = 2` のハードコードを廃止し、テーブルの `fixRounds` を参照する。dummy-data 再生成は `maxFixRounds >= 2` というマジック値ではなく、テーブルの `dummyDataRegen` フラグ（L4/L5 で true）で制御する。
4. triage の判定ロジック・プロンプト・レベル定義の意味は変更しない（ルーティングのみ変更）。
5. チャット入力近傍に「オート + L1〜L5」の手動ティアセレクタを追加する。既定はオート。手動選択時は triage の LLM 判定をスキップして即時反映する（コスト削減）。
6. 直近の triage 結果（`{ level, source: "auto" | "manual", reason? }`）をストアに保持し、セレクタ近傍に1行で規模を可視化する。

## Alternatives Considered

- **難易度を triage のヒントとして残す**: 既定 `medium` が自動判定を上書きする欠陥の温床であり、ユーザー意図とも別軸のため却下。
- **難易度→ティアのマッピングで後方互換を取る**: 未リリースで移行対象が存在せず、不要な複雑さを持ち込むため却下。
- **`runPipeline` / `runPipelineForLevel` の if 連鎖を各所に残す**: 構成の分岐が分散し、triage の意味と実際の構成が乖離し続けるため却下。表引きに一本化する。
- **AppSettings（config.json 永続化）にティア選択を追加**: デスクトップの設定は Rust 側の構造体を通るため、Rust を変更せずに自然に永続化できない。今回はストア（非永続）で保持し、既定オートに戻る挙動を許容する。新規の永続化層は作らない。
- **大規模なパネル/モーダルで規模を表示**: 既存 UX に反し過剰なため却下。セレクタ近傍の1行表示に留める。

## Consequences

- ユーザーはオートのまま triage に委ねることも、L1〜L5 を明示的に選ぶこともできる。
- 既定のオートでは難易度による上書きが消え、triage の自動判定が正しく機能する。
- 5段階それぞれが異なるエージェント構成になり、レベルと構成の対応がコード上で自明になる。
- 手動選択は triage 呼び出しを1回分スキップするため、レイテンシとコストがわずかに減る。
- ティア選択はセッション内のみ保持され、再起動後はオートに戻る（永続化が必要になれば別途 ADR で扱う）。
- 既存の難易度関連テストは削除し、5段階マッピング・手動オーバーライド・fixRounds/dummyDataRegen のレベル依存性のテストに置換した。
