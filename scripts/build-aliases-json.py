#!/usr/bin/env python3
"""Build aliases.json (antecedent -> consequent) from the e621 tag_aliases dump.

Filters to status=active. Consequents are the canonical tags; antecedents are
redirects. Output is a flat JSON object { antecedent: consequent }.
"""
import argparse, csv, json

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--out", default="references/aliases.json")
    args = ap.parse_args()

    aliases = {}
    with open(args.csv_path, newline="", encoding="utf-8") as f:
        for rec in csv.DictReader(f):
            if rec.get("status") != "active":
                continue
            a = rec.get("antecedent_name", "").strip()
            c = rec.get("consequent_name", "").strip()
            if a and c:
                aliases[a] = c

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(aliases, f, separators=(",", ":"))

    print(f"wrote {len(aliases)} active aliases -> {args.out}")

if __name__ == "__main__":
    main()