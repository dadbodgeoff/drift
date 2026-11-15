"""Agreement and final labels for the show12 rows (the rule earlier operators used).

usage: python3 -I final12.py <labeldir> <worktree> <A> <B> [--c C] [--blind-c CB] --out-full <f> --out-redacted <f> --agreement <f>

- Agreement: exact and Cohen's kappa (lib.mjs cohen) over the cards A and B both labelled.
- Final: A = B -> that label ("agreed"); A != B -> C's label (adjudicator, collected2/<C>.jsonl); a card whose B is
  missing after 3 attempts -> blind C (collected2/<CB>.jsonl, labelled with the plain labeller prompt): ACCEPT only
  when A and blind C both say ACCEPT, otherwise WRONG; a missing C counts as WRONG.
- --out-full (scratch only): uid pool:repo/id and the card text, for d4.mjs --extra.
- --out-redacted (committed): no card id or text for a dev4 card (aggregates-only rule for blind pools).
"""
import json, subprocess, sys

L, wt, wa, wb = sys.argv[1:5]
opt = dict(zip(sys.argv[5::2], sys.argv[6::2]))
jl = lambda f: {r["uid"]: r for r in (json.loads(x) for x in open(f) if x.strip())}
A, B = jl(f"{L}/collected2/{wa}.jsonl"), jl(f"{L}/collected2/{wb}.jsonl") if wb != "-" else {}
C = jl(f"{L}/collected2/{opt['--c']}.jsonl") if "--c" in opt else {}
CB = jl(f"{L}/collected2/{opt['--blind-c']}.jsonl") if "--blind-c" in opt else {}
keymap = json.load(open(f"{L}/keymap.json"))
rows = {json.loads(l)["key"]: json.loads(l) for l in open(f"{L}/rows.jsonl")}
pairs = [[A[k]["label"], B[k]["label"]] for k in rows if k in A and k in B]
lib = json.dumps(wt + "/eval/study/lib.mjs")
kappa = json.loads(subprocess.run(["node", "--input-type=module", "-e", f"import {{ cohen }} from {lib}; console.log(JSON.stringify(cohen({json.dumps(pairs)}, ['ACCEPT','TRIVIAL','WRONG'])))"],
                                  capture_output=True, text=True, check=True).stdout)
full, red = [], []
for k, r in rows.items():
    km = keymap[k]
    a, b = A[k]["label"], (B[k]["label"] if k in B else None)
    if b is None:
        cb = CB.get(k, {}).get("label")
        label, source = ("ACCEPT" if a == "ACCEPT" and cb == "ACCEPT" else "WRONG"), "A+blindC (B missing after 3 attempts)"
        c, cbl = None, cb
    elif a == b:
        label, source, c, cbl = a, "agreed", None, None
    else:
        c = C.get(k, {}).get("label")
        label, source, cbl = (c if c else "WRONG"), "adjudicated", None
    fin = A[k] if label == a else (B.get(k) if label == b else C.get(k) or CB.get(k) or {})
    rec = {"key": k, "pool": km["pool"], "repo": km["repo"], "A": a, "B": b, "C": c, "C_blind": cbl, "label": label, "source": source,
           "rubric": "v3", "wrong_because": fin.get("wrong_because") if label == "WRONG" else None, "trivial_by": fin.get("trivial_by") if label == "TRIVIAL" else None}
    full.append({**rec, "uid": f"{km['pool']}:{km['repo']}/{km['id']}", "id": km["id"], "text": r["proposal"]})
    red.append({**rec, **({} if km["pool"] == "dev4" else {"id": km["id"]})})
for path, recs in ((opt["--out-full"], full), (opt["--out-redacted"], red)):
    with open(path, "w") as f:
        for x in sorted(recs, key=lambda x: x["key"]):
            f.write(json.dumps(x) + "\n")
agree = sum(x == y for x, y in pairs)
json.dump({"labellers": [wa, wb], "n": len(pairs), "agree": agree, "po": round(agree / len(pairs), 4) if pairs else None, "kappa": kappa,
           "disagreements": [k for k in rows if k in A and k in B and A[k]["label"] != B[k]["label"]]}, open(opt["--agreement"], "w"), indent=1)
print({"n": len(pairs), "agree": agree, "kappa": kappa, "final": {l: sum(x["label"] == l for x in full) for l in ("ACCEPT", "TRIVIAL", "WRONG")}})
