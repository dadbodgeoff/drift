# collect.py <labeldir> <who>: validate-free move of each prompt's out.jsonl into collected2/<who>.jsonl
import json, os, shutil, sys
L, who = sys.argv[1:3]
idx = json.load(open(f"{L}/index-{who}.json"))
os.makedirs(f"{L}/collected2", exist_ok=True)
rows = []
for i in idx:
    od = os.path.dirname(i["out"])
    assert os.listdir(i["cwd"]) == [], ("cwd not empty", i["cwd"], os.listdir(i["cwd"]))
    assert os.listdir(od) == ["out.jsonl"], ("outbox", od, os.listdir(od))
    got = [json.loads(l) for l in open(i["out"]) if l.strip()]
    assert sorted(r.get("uid") for r in got) == sorted(i["keys"]), ("keys", i["prompt"])
    for r in got:
        r["labeller"] = who
        rows.append(r)
    shutil.move(i["out"], f"{L}/collected2/{who}-{os.path.basename(od)}.jsonl")
with open(f"{L}/collected2/{who}.jsonl", "w") as f:
    for r in rows:
        f.write(json.dumps(r) + "\n")
print(who, len(rows), {l: sum(r.get("label") == l for r in rows) for l in ("ACCEPT", "WRONG", "TRIVIAL")})
