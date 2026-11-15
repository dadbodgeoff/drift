import json, sys, uuid, os, subprocess, random
S, WT, who = sys.argv[1], sys.argv[2], sys.argv[3]
tpl = open(f"{WT}/eval/study/REVIEWER-PROMPT.md").read().split("<!-- BEGIN PROMPT -->")[1].split("<!-- END PROMPT -->")[0]
rub = open(f"{WT}/eval/study/RUBRIC-v3.md").read(); rub = rub[rub.index("## The setting"):]
rows = [json.loads(l) for l in open(f"{S}/label/rows.jsonl")]
by = {}
for r in rows: by.setdefault(r["repo_dir"], []).append(r)
index = json.load(open(f"{S}/label/index.json")) if os.path.exists(f"{S}/label/index.json") else []
for d, rs in by.items():
    random.shuffle(rs)
    u = uuid.uuid4().hex; out = f"{S}/label/outbox/{u}/out.jsonl"; cwd = f"{S}/label/work/{uuid.uuid4().hex}"
    os.makedirs(os.path.dirname(out)); os.makedirs(cwd)
    sha = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    url = subprocess.run(["git", "-C", d, "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip() or "(no remote)"
    name = os.path.basename(d)
    if name.startswith(("T", "P")) and len(name) == 3: url = "(keyed checkout)"
    p = (tpl.replace("{{REPO}}", name).replace("{{REPO_URL}}", url).replace("{{REPO_SHA}}", sha).replace("{{REPO_DIR}}", d)
         .replace("{{RUBRIC}}", rub).replace("{{COUNT}}", str(len(rs))).replace("{{OUTPUT_FILE}}", out)
         .replace("{{PROPOSALS}}", "\n\n".join(r["proposal"] for r in rs)))
    pf = f"{S}/label/prompts/{who}-{uuid.uuid4().hex[:8]}.md"; os.makedirs(os.path.dirname(pf), exist_ok=True)
    open(pf, "w").write(p.strip() + "\n")
    index.append({"labeller": who, "prompt": pf, "cwd": cwd, "out": out, "keys": [r["key"] for r in rs], "repo_dir": d})
json.dump(index, open(f"{S}/label/index.json", "w"), indent=1)
for i in index:
    if i["labeller"] == who: print(i["prompt"], "cwd:", i["cwd"])
