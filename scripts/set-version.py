#!/usr/bin/env python3
"""DeskSpawn: 全バージョン定義を単一バージョンに統一するスクリプト。
対象: ルート / apps/web / apps/desktop / apps/desktop/sidecar / tauri.conf.json / Cargo.toml / packages/*
      (ai-core, config, shared, ui) / store/msix Package.appxmanifest
      — check-versions.mjs の対象と一致させること。
      appxmanifest は 3桁 → 4桁 (<new>.0) に変換して <Identity Version="..."> を書き換える。

注意: apps/desktop/src-tauri/Cargo.lock の deskspawn-desktop バージョンは
      ここで直接置換しない。実行後に `cargo update -p deskspawn-desktop` で
      更新すること（cargo に依存解決を再検証させるのが正しい手順）。
"""
import re, sys, os


def mask_comments(content):
    """XML コメントの各文字を同数の空白に置換し、元文字列と同じインデックスを保つ。

    Package.appxmanifest を正規表現で読む際、コメントアウトされた旧
    <Identity Version="..."> を実体と誤認して書き換えるのを防ぐ。等長置換なので
    返り値のマッチ位置は content と同一オフセットになり、実体側だけを差し替え
    られる。未終端コメントは黙って素通しせず、明示メッセージで sys.exit(1) する。
    """
    parts = []
    cursor = 0
    while True:
        start = content.find("<!--", cursor)
        stray_close = content.find("-->", cursor)
        if start == -1:
            if stray_close != -1:
                sys.stderr.write(
                    "mask_comments: XML コメントが未終端です "
                    "(対応する <!-- の無い --> があります)。マニフェストを確認してください\n"
                )
                sys.exit(1)
            break
        if stray_close != -1 and stray_close < start:
            sys.stderr.write(
                "mask_comments: XML コメントが未終端です "
                "(対応する <!-- の無い --> があります)。マニフェストを確認してください\n"
            )
            sys.exit(1)
        end = content.find("-->", start + 4)
        if end == -1:
            sys.stderr.write(
                "mask_comments: XML コメントが未終端です "
                "(--> が見つかりません)。マニフェストを確認してください\n"
            )
            sys.exit(1)
        close_end = end + 3
        parts.append(content[cursor:start])
        parts.append(" " * (close_end - start))
        cursor = close_end
    parts.append(content[cursor:])
    return "".join(parts)


# 注意: Cargo.lock の deskspawn-desktop は直接書き換えず、本スクリプト実行後に
# `cargo update -p deskspawn-desktop` で更新すること（cargo 経由が正しい）。
files = [
    "package.json",
    "apps/web/package.json",
    "apps/desktop/package.json",
    "apps/desktop/sidecar/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "packages/ai-core/package.json",
    "packages/config/package.json",
    "packages/shared/package.json",
    "packages/ui/package.json",
    "apps/desktop/store/msix/Package.appxmanifest",
]

NEW = sys.argv[1] if len(sys.argv) > 1 else "0.4.2"
results = []
# 二段階方式: まず全対象ファイルを読み込み、種別ごとの変換とマスク・検証
# （未終端コメント検出）をメモリ上で完了させる。1つでも失敗したら何も書かずに
# sys.exit(1) する。先に処理した package.json だけが更新される部分書き込みを防ぐ。
pending_writes = []
# 欠落した対象ファイル。1件でもあれば検証段階で中断し、何も書き込まない。
missing = []
for f in files:
    if not os.path.exists(f):
        # 3要素目に "-" を入れて後段の表示（r[2]）でクラッシュしないようにする。
        # 一覧は全件表示したうえで、ループ後に exit 1 する（部分書き込み防止）。
        results.append((f, "NOT FOUND", "-"))
        missing.append(f)
        continue
    with open(f) as fh:
        content = fh.read()
    if f.endswith("Cargo.toml"):
        old = re.findall(r'^version\s*=\s*"([^"]+)"', content, re.M)
        new_content = re.sub(r'^version\s*=\s*"[^"]+"', f'version = "{NEW}"', content, count=1, flags=re.M)
        new_value = NEW
    elif f.endswith("Package.appxmanifest"):
        appx_new = f"{NEW}.0"
        # コメントを等長で空白化した masked 上で位置を求め、実際の書き換えは
        # 元の content の実体側だけに適用する（コメントを壊さない／書き戻さない）。
        # 未終端コメントはここ（書き込み前）で sys.exit(1) する。
        masked = mask_comments(content)
        m = re.search(r'(<Identity\b[^>]*?\bVersion=")([^"]*)(")', masked)
        if m:
            # old は実体側（content）から取る。
            old = [content[m.start(2):m.end(2)]]
            new_content = content[:m.start(2)] + appx_new + content[m.end(2):]
        else:
            # 実体の <Identity Version="..."> が無い（コメント内にのみ存在する等）。
            # このまま進めると manifest だけ未更新のまま他ファイルが更新され、
            # 静かにバージョン不整合を作るため、検証段階で中断する
            # （build-msix.mjs の rewriteManifestVersion が throw するのと同じ方針）。
            # 書き込みはループ後なので、ここで抜ければ一切書き込まれない。
            sys.stderr.write(
                f'エラー: {f} の実体に <Identity Version="..."> が見つかりません'
                "（コメント内の Identity は対象外です）\n"
            )
            sys.exit(1)
        new_value = appx_new
    else:
        old = re.findall(r'"version"\s*:\s*"([^"]+)"', content)
        new_content = re.sub(r'"version"\s*:\s*"[^"]+"', f'"version": "{NEW}"', content, count=1)
        new_value = NEW
    pending_writes.append((f, new_content))
    results.append((f, old[0] if old else "?", new_value))

# 全件成功したときだけ一括で書き込む。欠落が1件でもあれば、一覧を全件表示
# したうえで何も書かずに exit 1 する（先頭ファイルだけ更新される部分書き込みを防ぐ）。
if missing:
    for r in results:
        print(f"{r[0]}: {r[1]} -> {r[2]}")
    sys.stderr.write(f"エラー: {len(missing)} 件の対象ファイルが見つかりません\n")
    sys.exit(1)

for f, new_content in pending_writes:
    with open(f, "w") as fh:
        fh.write(new_content)

for r in results:
    print(f"{r[0]}: {r[1]} -> {r[2]}")
print("DONE")
