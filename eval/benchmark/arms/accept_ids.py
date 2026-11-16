#!/usr/bin/env python3
"""Print the comma-separated convention ids the accept rule picks.

    accept_ids.py CENSUS_JSON RULE [LIST_FILE]

CENSUS_JSON is `drift census --json` output ({"proposals": [{"id", "tier"}, ...]}).
RULE: none (accept nothing), default-tier (every default-tier proposal, nothing
else), list (the ids in LIST_FILE, one per line, # comments allowed, that the
census proposes at this commit; ids it does not propose are skipped and named
on standard error, since `drift review` refuses unknown ids).
"""
import json
import sys


def main():
    census_path, rule = sys.argv[1], sys.argv[2]
    with open(census_path, encoding="utf-8") as f:
        census = json.load(f)
    proposals = census.get("proposals", [])
    known = [p["id"] for p in proposals]
    if rule == "none":
        ids = []
    elif rule == "default-tier":
        ids = [p["id"] for p in proposals if p.get("tier") == "default"]
    elif rule == "list":
        with open(sys.argv[3], encoding="utf-8") as f:
            wanted = [l.split("#")[0].strip() for l in f]
        wanted = [w for w in wanted if w]
        ids = [w for w in wanted if w in known]
        for w in wanted:
            if w not in known:
                print("accept list: %s is not proposed at this commit; skipped" % w, file=sys.stderr)
    else:
        print("unknown accept rule: " + rule, file=sys.stderr)
        return 2
    print(",".join(sorted(set(ids))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
