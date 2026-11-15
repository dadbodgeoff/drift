# collect.py <who>: move each prompt's out.jsonl into label/collected/<who>.jsonl, checking keys and empty cwd
import json, sys, os, shutil
S = "<scratch>/layer11"
who = sys.argv[1]
idx = json.load(open(f"{S}/label/index.json"))
os.makedirs(f"{S}/label/collected", exist_ok=True)
rows = []
for i in idx:
    if i["labeller"] != who: continue
    if os.listdir(i["cwd"]): print("NOT EMPTY cwd", i["cwd"], os.listdir(i["cwd"]))
    od = os.path.dirname(i["out"])
    extra = [x for x in os.listdir(od) if x != "out.jsonl"]
    if extra: print("extra files in outbox", od, extra)
    if not os.path.exists(i["out"]): print("MISSING", i["prompt"]); continue
    got = [json.loads(l) for l in open(i["out"]) if l.strip()]
    keys = sorted(r.get("uid") for r in got)
    if keys != sorted(i["keys"]): print("KEY MISMATCH", i["prompt"], keys, i["keys"])
    for r in got: r["labeller"] = who; rows.append(r)
    shutil.move(i["out"], f"{S}/label/collected/{who}-{os.path.basename(od)}.jsonl")
with open(f"{S}/label/collected/{who}.jsonl", "w") as f:
    for r in rows: f.write(json.dumps(r) + "\n")
print(who, len(rows), {l: sum(1 for r in rows if r.get("label") == l) for l in ("ACCEPT", "WRONG", "TRIVIAL")})
