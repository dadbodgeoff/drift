"""usage: python3 -I mkpolicy.py RUNPART_DIR REPO OUT_YAML OUT_IDS
The labelled run's conventions file for REPO, kept to the uids of its queue.json, each marked accepted (so the show
policy keeps it, as it keeps what a person accepted), plus `agents: semantic: on`."""
import json, re, sys
d, repo, out, outids = sys.argv[1:5]
q = [it for it in json.load(open(f"{d}/queue.json"))["items"] if it["repo"] == repo]
want = {it["id"] for it in q}
lines = open(f"{d}/proposals/{repo}.yaml").read().split("\n")
i = lines.index("conventions:")
head, rest = lines[:i + 1], lines[i + 1:]
blocks, tail, cur = [], [], None
for l in rest:
    if l.startswith("- id: "):
        cur = [l]; blocks.append(cur)
    elif l and not l.startswith(" ") and not l.startswith("-"):
        cur = None; tail.append(l)
    elif cur is not None:
        cur.append(l)
    else:
        tail.append(l)
keep, ids = [], []
for b in blocks:
    cid = b[0][len("- id: "):].strip()
    if cid in want:
        assert "  status: proposed" in b or "  status: accepted" in b, cid
        keep.extend("  status: accepted" if x == "  status: proposed" else x for x in b); ids.append(cid)
assert not any(t.startswith("agents:") for t in tail)
text = "\n".join(head + keep + [t for t in tail if t.strip()] + ["agents:", "  semantic: on", ""])
open(out, "w").write(text)
json.dump(ids, open(outids, "w"))
print(f"{repo}: {len(ids)}/{len(want)} labelled ids", file=sys.stderr)
