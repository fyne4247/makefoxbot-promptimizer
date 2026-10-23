#!/usr/bin/env python3
"""Build a compact MakeFox tag catalog from an e621-style tags CSV.

Input columns: id,name,category,post_count,created_at,updated_at,is_locked
Filter: category in {0,1,3,4,5,8} (general, artist, copyright, character, species, lore) and post_count > 0.
Output: references/tags.json — a flat JSON array of [name, category, post_count],
sorted by name for binary search. Compact on purpose: the model never reads the
whole file; lookup-tag.js pulls only the rows it needs.
"""
import argparse, csv, json, sys

KEEP_CATEGORIES = {0, 1, 3, 4, 5, 8}  # full lookup and implication vocabulary

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--out", default="references/tags.json")
    ap.add_argument("--min-count", type=int, default=1)
    args = ap.parse_args()

    rows = []
    with open(args.csv_path, newline="", encoding="utf-8") as f:
        for rec in csv.DictReader(f):
            try:
                cat = int(rec["category"])
                count = int(rec["post_count"])
            except (KeyError, ValueError):
                continue
            if cat in KEEP_CATEGORIES and count >= args.min_count:
                rows.append([rec["name"], cat, count])

    rows.sort(key=lambda r: r[0])  # sort by name for binary search
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
    print(f"wrote {len(rows)} tags -> {args.out}")

if __name__ == "__main__":
    main()