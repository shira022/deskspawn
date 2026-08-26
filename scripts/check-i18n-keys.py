#!/usr/bin/env python3
"""Compare all t("...") / t('...') keys used in code against ja/en locale key sets.

Usage: python3 scripts/check-i18n-keys.py
Exit code 0 = no mismatches. Prints per-file mismatches otherwise.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- 1. Load locale key sets (flattened dotted paths) ---
def flatten(obj, prefix=""):
    keys = []
    for k, v in obj.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys.extend(flatten(v, p))
        else:
            keys.append(p)
    return keys

locales = {}
for lang in ("ja", "en"):
    with open(ROOT / f"packages/shared/src/locales/{lang}/common.json", encoding="utf-8") as f:
        locales[lang] = set(flatten(json.load(f)))

# --- 2. Enumerate t("...") literal keys from source ---
t_re = re.compile(
    r"\bt\s*\(\s*(['\"])([^'\"]+?)\1\s*\)"
)
t_import_re = re.compile(r"\bt\s*\(")  # any t( call for counting

# keys referenced with template interpolation, e.g. t(`chat.${x}`) or t(`step.${...}`)
t_template_re = re.compile(r"\bt\s*\(\s*`([^`]*\$\{[^`]*\}[^`]*)`\s*\)")

used = {}          # key -> set(files)
template_uses = [] # (pattern, file)
dynamic_uses = []  # non-literal non-template t() calls (file, snippet)

source_dirs = [
    ROOT / "packages/shared/src",
    ROOT / "apps/web/src",
    ROOT / "apps/desktop/src",
    ROOT / "apps/desktop/sidecar/src",
]

files = []
for d in source_dirs:
    if d.exists():
        files.extend(d.rglob("*.ts"))
        files.extend(d.rglob("*.tsx"))

for f in files:
    text = f.read_text(encoding="utf-8")
    rel = f.relative_to(ROOT)
    # literal keys
    for m in t_re.finditer(text):
        key = m.group(2)
        used.setdefault(key, set()).add(str(rel))
    # template keys (record pattern)
    for m in t_template_re.finditer(text):
        template_uses.append((m.group(1), str(rel)))
    # dynamic: find t( calls that are not literal and not template
    for m in t_import_re.finditer(text):
        start = m.start()
        # skip if part of a literal/template match already counted
        frag = text[start : start + 60].split("\n", 1)[0]
        if re.match(r"\bt\s*\(\s*['\"]", frag) or re.match(r"\bt\s*\(\s*`", frag):
            continue
        dynamic_uses.append((str(rel), frag.strip()[:80]))

# --- 3. Compare ---
missing_ja = {k: v for k, v in sorted(used.items()) if k not in locales["ja"]}
missing_en = {k: v for k, v in sorted(used.items()) if k not in locales["en"]}

print("== t() literal keys used:", len(used))
print("== locale key counts: ja =", len(locales["ja"]), "/ en =", len(locales["en"]))
print()

status = 0
for lang, missing in (("ja", missing_ja), ("en", missing_en)):
    if missing:
        status = 1
        print(f"--- MISSING in {lang}/common.json ({len(missing)}) ---")
        for k, v in missing.items():
            print(f"  {k}  <- {', '.join(sorted(v))}")
    else:
        print(f"--- {lang}: no missing keys ---")

print()
if template_uses:
    print("== template-literal t() patterns (not statically verifyable) ==")
    for pat, f in template_uses:
        print(f"  {f}: t(`{pat}`)")
if dynamic_uses:
    print("== dynamic t() calls (not statically verifyable) ==")
    for f, frag in dynamic_uses:
        print(f"  {f}: {frag}")

sys.exit(status)