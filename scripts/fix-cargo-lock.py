#!/usr/bin/env python3
"""Cargo.lock の壊れたバージョン(存在しない0.4.2)を0.4.1に戻す。
対象は検証済み: heck/jni-sys/jni-sys-macros/rustc_version/windows-result
"""
import re, sys

TARGETS = {"heck", "jni-sys", "jni-sys-macros", "rustc_version", "windows-result"}

for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as f:
        content = f.read()
    blocks = content.split("[[package]]")
    fixed = 0
    for i, block in enumerate(blocks):
        m = re.search(r'name = "([^"]+)"', block)
        if not m or m.group(1) not in TARGETS:
            continue
        v = re.search(r'version = "([^"]+)"', block)
        if v and v.group(1) == "0.4.2":
            blocks[i] = block.replace('version = "0.4.2"', 'version = "0.4.1"', 1)
            fixed += 1
    with open(path, "w", encoding="utf-8") as f:
        f.write("[[package]]".join(blocks))
    print(f"{path}: {fixed} 件修正")
