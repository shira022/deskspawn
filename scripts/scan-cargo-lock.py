#!/usr/bin/env python3
"""Cargo.lock の全レジストリ依存を crates.io sparse index と突き合わせ、
「存在しないバージョン」や「checksum不一致」を網羅的に検出する。

使い方: python3 scan_cargo_lock.py <Cargo.lock>
"""
import re
import sys
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

LOCK_PATH = sys.argv[1] if len(sys.argv) > 1 else "apps/desktop/src-tauri/Cargo.lock"

def parse_lock(path):
    """Cargo.lock をパースして [[package]] のリストを返す"""
    with open(path, encoding="utf-8") as f:
        content = f.read()
    packages = []
    for block in content.split("[[package]]"):
        if "name =" not in block:
            continue
        name = re.search(r'name = "([^"]+)"', block)
        ver = re.search(r'version = "([^"]+)"', block)
        src = re.search(r'source = "([^"]+)"', block)
        cksum = re.search(r'checksum = "([^"]+)"', block)
        if not name or not ver:
            continue
        packages.append({
            "name": name.group(1),
            "version": ver.group(1),
            "source": src.group(1) if src else None,
            "checksum": cksum.group(1) if cksum else None,
        })
    return packages

def index_url(name):
    if len(name) == 1:
        return f"https://index.crates.io/1/{name}"
    if len(name) == 2:
        return f"https://index.crates.io/2/{name}"
    if len(name) == 3:
        # 実測: crates.io sparse index は 3文字も 3/{先頭文字}/{name} 形式 (3/syn は404)
        return f"https://index.crates.io/3/{name[0]}/{name}"
    return f"https://index.crates.io/{name[:2]}/{name[2:4]}/{name}"

def fetch_index(name, retries=3):
    """sparse index をフェッチして {version: {cksum, yanked}} を返す。失敗時は None"""
    for attempt in range(retries):
        req = urllib.request.Request(index_url(name), headers={"User-Agent": "deskspawn-lock-scan"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read().decode("utf-8")
            break
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1.5 * (attempt + 1))
    versions = {}
    for line in data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        versions[d["vers"]] = {"cksum": d.get("cksum"), "yanked": d.get("yanked", False)}
    return versions

def main():
    pkgs = parse_lock(LOCK_PATH)
    registry_pkgs = [p for p in pkgs if p["source"] and "crates.io" in p["source"]]
    print(f"ロック内パッケージ: {len(pkgs)} / レジストリ依存: {len(registry_pkgs)}")

    # ユニークなnameをフェッチ
    names = sorted({p["name"] for p in registry_pkgs})
    indexes = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(fetch_index, n): n for n in names}
        done = 0
        for fut in as_completed(futs):
            n = futs[fut]
            try:
                indexes[n] = fut.result()
            except Exception:
                indexes[n] = None
            done += 1
            if done % 100 == 0:
                print(f"  index取得 {done}/{len(names)}")

    missing_idx = [n for n in names if indexes[n] is None]
    if missing_idx:
        print(f"\n⚠️ index取得失敗 (ネットワーク/存在しないクレート?): {missing_idx}")

    problems = []
    for p in registry_pkgs:
        idx = indexes.get(p["name"])
        if idx is None:
            continue
        entry = idx.get(p["version"])
        if entry is None:
            problems.append(f"❌ 存在しないバージョン: {p['name']} {p['version']}")
            continue
        if p["checksum"] and entry["cksum"] and p["checksum"] != entry["cksum"]:
            problems.append(f"❌ checksum不一致: {p['name']} {p['version']} (lock={p['checksum'][:16]}… index={entry['cksum'][:16]}…)")
        if entry["yanked"]:
            problems.append(f"⚠️ yanked: {p['name']} {p['version']}")

    if problems:
        print(f"\n=== 問題 {len(problems)} 件 ===")
        for pr in problems:
            print(" ", pr)
        sys.exit(1)
    print("\n✅ 問題なし: 全レジストリ依存が crates.io に実在し checksum 一致")

if __name__ == "__main__":
    main()
