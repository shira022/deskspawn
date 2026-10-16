# Microsoft Store 更新手順（MSIX フルパッケージ）

DeskSpawn は Microsoft Store に **MSIX フルパッケージ**で公開されている（決定の背景は ADR-0017）。
このドキュメントは「次バージョンを Store に提出する」ときの手順で、リポジトリ側のコマンドと Windows 側の作業を順に並べたもの。

- パッケージ定義（Identity・tiles）: `apps/desktop/store/msix/`
- ステージング＋pack: `scripts/build-msix.mjs`
- 対象プラットフォーム: **x64 のみ**（arm64 は提出しない）

> ⚠️ **提出（送信）操作は対外アクション**。パッケージ生成・ローカル検証までは自動化してよいが、
> Partner Center の「レビューへ送信」は必ず人が実行する。

---

## 0. 前提（Windows ホスト側）

| ツール | 用途 |
|---|---|
| Rust（MSVC ターゲット）＋ VS Build Tools | Tauri 本体のビルド |
| `cargo install tauri-cli --locked` | `cargo-tauri build` |
| Bun | サイドカーのビルド・プレビュー |
| `winapp` CLI（`winget install microsoft.winappcli --source winget`） | MSIX のステージング初期化と pack |

パッケージ定義そのものはリポジトリに入っているため、`winapp init` をやり直す必要はない。

---

## 1. バージョンを確定する（WSL）

```bash
python3 scripts/set-version.py X.Y.Z          # manifest の Version は X.Y.Z.0 に自動変換される

# ⚠️ Cargo.lock の deskspawn-desktop は対象外（意図的）。cargo に依存解決を再検証させる:
#    これを忘れると check-versions.mjs が Cargo.lock の不一致で必ず FAIL する。
(cd apps/desktop/src-tauri && cargo update -p deskspawn-desktop)

node scripts/check-versions.mjs               # 全定義箇所が一致しているか
```

- MSIX のバージョンは **4 桁で単調増加が必須**（Store が拒否する）。`X.Y.Z` の Z を必ず上げる。
- 対象には root / web / desktop / sidecar / `packages/*` / `tauri.conf.json` /
  `Cargo.toml` / `Cargo.lock` / `apps/desktop/store/msix/Package.appxmanifest` が含まれる。

## 2. フロントとゲートを回す（WSL）

```bash
pnpm --filter desktop build                   # Tauri の frontendDist（apps/desktop/dist）
pnpm test:scripts                             # スクリプト群のユニット（build-msix / check-versions を含む）
pnpm exec eslint .                            # 0 errors が合格条件（warnings は許容）
pnpm --filter web test                        # 共有コードのユニット
```

Windows では `beforeBuildCommand` を空にする override（`{"build":{"beforeBuildCommand":""}}`）を使うため、
**フロントは必ず WSL 側でビルドして dist を持ち込む**。

## 3. Windows ステージングへ同期（WSL → ホスト）

リポジトリの真実は WSL 側にあり、ホスト側は rsync ミラー。除外を忘れると staging 専用物が消えたり、
逆にサイドカーが消えて後段が落ちる。

```bash
rsync -a --delete --exclude node_modules --exclude .git --exclude target \
      --exclude "apps/desktop/src-tauri/binaries" \
      <repo>/ <staging>/
rsync -a apps/desktop/dist/ <staging>/apps/desktop/dist/     # dist は上書きで別途同期
```

## 4. Windows 側でビルド（ホスト）

```powershell
# 実行中インスタンスを必ず落とす（exe がロックされると最終コピーだけ失敗する）
Get-Process | Where-Object { $_.ProcessName -match 'deskspawn' } | Stop-Process -Force

# サイドカー（PATH に bun と .cargo\bin を通す。cwd は apps/desktop）
$env:PATH = 'C:\Users\<user>\dev\tools\bun\bun-windows-x64;C:\Users\<user>\.cargo\bin;' + $env:PATH
Set-Location 'C:\Users\<user>\dev\deskspawn-staging\apps\desktop'
bun scripts/build-sidecar.mjs

# Tauri 本体（cwd は src-tauri。検証目的なら --no-bundle でバンドル生成を省略）
Set-Location 'C:\Users\<user>\dev\deskspawn-staging\apps\desktop\src-tauri'

# beforeBuildCommand を空にする override は **リポジトリに存在しない**（staging で手動作成するファイル）。
# rsync --delete のたびに消えるため、ビルドの直前に毎回作り直す。
#   ⚠️ PowerShell のシングルクォート内なら `"` はそのまま書ける（`\"` と書くとバックスラッシュが残り無効な JSON になる）。
Set-Content -Path 'tauri.build-override.json' -Value '{"build":{"beforeBuildCommand":""}}' -Encoding UTF8

C:\Users\<user>\.cargo\bin\cargo-tauri.exe build --no-bundle --config tauri.build-override.json
```

## 5. MSIX をステージングして pack する

```bash
# リポジトリ root（WSL でも Windows でも可）。ステージングのみ:
node scripts/build-msix.mjs

# 出力される winapp pack コマンドを確認してから、pack まで実行:
node scripts/build-msix.mjs --pack              # 自己署名証明書を生成して署名
node scripts/build-msix.mjs --pack --no-sign    # Store 提出用（Store が再署名する）
```

生成されるもの:

```
apps/desktop/src-tauri/target/msix-stage/            # manifest（バージョン書換済み）+ Assets + payload
apps/desktop/src-tauri/target/msix-stage/<Name>_<X.Y.Z.0>_x64.msix
```

- payload は本体 exe ＋ サイドカー（`deskspawn-sidecar.exe` と `deskspawn-sidecar-x86_64-pc-windows-msvc.exe` の**両名**）。
- ステージングは**許可リスト方式**（manifest と `Assets/*.png` のみ）。バックアップディレクトリなどを混入させない。
- 出力 .msix は **`--output` で常にステージ先の中に固定**される（winapp 既定の「カレントディレクトリ出力」に依存しない）。
  `--pack` 実行後にスクリプトが出力の存在とサイズを検証し、無ければ exit 1 で失敗する。

### 実測（2026-10-16 / winapp 0.7.1 / WSL の node v26）

- **この環境では node は WSL にのみ、winapp は Windows にのみ入っている**。それでも上の 3 行は
  WSL のリポジトリからそのまま実行できる: 非 Windows 環境ではスクリプトが `winapp.exe` を
  **直接 spawn** し（WSL の interop PATH で解決できることを実測済み。PowerShell は経由しない）、
  `/mnt/c/...` を `C:\...` に変換した Windows 形式パスを argv で渡す。
- pack は 214.4 MiB のステージから **約 9 秒 / 85.9 MiB** の MSIX を生成（`--no-sign`）。
- **`.msix` 全体のバイト同一性は保証されない**（実測: 同じステージから再実行して `90,071,452` →
  `90,071,456` bytes）。差分は zip のタイムスタンプと `AppxBlockMap.xml` の `<File>` 列挙順だけで、
  **payload・manifest・アセットのハッシュは全一致**する。再現性の確認は
  「ステージ内容（許可リスト＋manifest の版）と payload の md5 一致」で行い、ファイル全体のハッシュ比較はしない。
- ステージ先が Windows から見えない場所（`/home/...` 等）だと `--pack` は
  「stage ディレクトリが Windows から見える場所（/mnt/<drive>/...）にないため pack できません」で exit 1 する。
- payload が無いリポジトリ（例: WSL 側にしか無いソースツリー）で実行すると、
  ペイロード欠落の 3 行メッセージを出して exit 1 する（**旧ステージを消さずに**失敗する）。
  → **pack はビルド成果物のある Windows 側コピー（例 `C:\Users\<user>\dev\deskspawn-staging`）で実行する**。
- 昇格は不要（`--no-sign` の pack に UAC は出ない）。

## 6. 提出前のローカル実機検証（Windows）

1. 昇格 PowerShell で証明書を信頼させる（**Machine ストア**に入れる。CurrentUser では無視される）:
   `Cert:\LocalMachine\TrustedPeople` と（自己署名のため）`Cert:\LocalMachine\Root` の両方へ `Import-Certificate`。
   併せて開発者モード（`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock`）を有効化する。
2. `Add-AppxPackage -Path <msix>` → `Get-AppxPackage -Name <Identity Name>` で `InstallLocation` を確認。
3. CDP を有効にして起動し、**1 インスタンスだけ**であることを確認:
   ```powershell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
   Start-Process "<InstallLocation>\deskspawn-desktop.exe"
   ```
4. ログに `Packaged (Store/MSIX) build detected: updater disabled` が出ること（Store モードの実行時証明）。
   ログは `env_logger` で **stderr** に出るため、パッケージ版 exe を stderr リダイレクト付きで起動して捕まえる:

   ```powershell
   $pkg = Get-AppxPackage -Name shira022.DeskSpawn
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
   Start-Process -FilePath (Join-Path $pkg.InstallLocation 'deskspawn-desktop.exe') `
     -RedirectStandardError 'C:\Users\<user>\dev\ds-run-err.log' -RedirectStandardOutput 'C:\Users\<user>\dev\ds-run-out.log'
   ```

   `C:\Program Files\WindowsApps\...` の exe は**この方法で直接起動できる**（実測）。
   併せて **`No updates available.` が 0 件**であることを確認すると「updater が登録すらされていない」ことまで言える
   （非パッケージ版ではこの行が出て updater が走る）。
   なお `Start-Process` を付けた親プロセスは、GUI 子プロセスがハンドルを保持する間パイプが閉じない点に注意
   （バックグラウンドで走らせるか、出力をファイルに取る）。
5. CDP で UI・プレビュー・チャットを確認し、サイドカーの `/health` を叩く
   （WSL からは `127.0.0.1` に届かないため、Windows 側の `curl.exe` か `Invoke-RestMethod` を使う）。
   WSL から `9222` を見るには既定ゲートウェイ経由（`$(ip route | awk '/^default/{print $3}')`）で到達でき、
   Playwright の `chromium.connectOverCDP()` で DOM を読める（実測: タイトル `DeskSpawn`・本文・button 数など）。
   **サイドカーの `/health` は 401 が正常**（認証トークン必須の設計。到達＝プロセス生存の証拠）。
6. 旧パッケージの `Remove-AppxPackage` は**新パッケージの起動検証が済んでから**行う。

## 7. 提出（Partner Center）

1. 既存の製品ページから**新しい提出**を作成。
2. パッケージ: 手順 5 の MSIX をアップロード（x64 のみ）。
3. リスティング: **What's New**（日英）を更新。スクリーンショット・予告編は既存を流用可。
4. プライバシーポリシー URL・サポート URL は既存のまま（変更が無ければ触らない）。
5. **「レビューへ送信」は人が実行** → 審査 → 公開。

## 8. 公開の確認

Store API で公開状態と更新時刻を確認できる（認証不要）:

```
https://storeedgefd.dsx.mp.microsoft.com/v9.0/products/<ProductId>?market=JP&locale=ja-jp&deviceFamily=Windows.Desktop
```

`ReleaseDateUtc` / `LastUpdateDateUtc` / `Title` / `Trailers` / `Images`（スクリーンショット枚数）を見る。

---

## 注意（事故りやすい点）

- **`*.pfx`（署名証明書）は絶対にコミットしない**。`*.msix` も生成物なのでコミットしない（`.gitignore` 済み）。
- Identity 3値（`Name` / `Publisher` / `PublisherDisplayName`）は**公開識別子**（マニフェスト平文・`Get-AppxPackage` で誰でも読める）で、秘密ではない。ただし Partner Center のアカウント情報・認証情報は当然ながら共有しない。
- ステージングディレクトリへ手作業でファイルを足さない（許可リスト運用が壊れる）。追加が必要なら `apps/desktop/store/msix/` に置く。
- `--no-sign` で作った MSIX は**ローカルインストールできない**（署名が無いため）。ローカル検証は署名ありで行い、提出用はどちらでもよい。
- バージョンを据え置いたまま同じ MSIX を出し直すと Store が拒否する。必ず上げる。
