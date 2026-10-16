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
for f in files:
    if not os.path.exists(f):
        results.append((f, "NOT FOUND"))
        continue
    with open(f) as fh:
        content = fh.read()
    if f.endswith("Cargo.toml"):
        old = re.findall(r'^version\s*=\s*"([^"]+)"', content, re.M)
        new_content = re.sub(r'^version\s*=\s*"[^"]+"', f'version = "{NEW}"', content, count=1, flags=re.M)
        new_value = NEW
    elif f.endswith("Package.appxmanifest"):
        appx_new = f"{NEW}.0"
        m = re.search(r'(<Identity\b[^>]*?\bVersion=")([^"]*)(")', content)
        old = [m.group(2)] if m else []
        new_content = re.sub(
            r'(<Identity\b[^>]*?\bVersion=")[^"]*(")',
            lambda mm: mm.group(1) + appx_new + mm.group(2),
            content,
            count=1,
        )
        new_value = appx_new
    else:
        old = re.findall(r'"version"\s*:\s*"([^"]+)"', content)
        new_content = re.sub(r'"version"\s*:\s*"[^"]+"', f'"version": "{NEW}"', content, count=1)
        new_value = NEW
    with open(f, "w") as fh:
        fh.write(new_content)
    results.append((f, old[0] if old else "?", new_value))

for r in results:
    print(f"{r[0]}: {r[1]} -> {r[2]}")
print("DONE")
