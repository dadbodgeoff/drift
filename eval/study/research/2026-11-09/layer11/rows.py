import json, re, secrets, subprocess, os, sys
S = "<scratch>"
C = f"{S}/dev-clones"
want = {"T02": ["D-163bf8"], "T18": ["D-44e866", "D-911706"], "cal.com": ["D-5d6ff0"], "documenso": ["D-ea1182"]}
part = {"T02": "dev3", "T18": "dev3", "cal.com": "ts", "documenso": "ts"}
rows, keymap = [], {}
for repo, ids in want.items():
    env = dict(os.environ, DRIFT_CACHE_DIR=f"{S}/layer11/lc")
    out = subprocess.run([f"{S}/layer11/bin/drift-l11", "--root", f"{C}/{part[repo]}/{repo}", "census", "--all-outliers", "--all", "--max", "15"], capture_output=True, text=True, env=env).stdout
    subprocess.run(["rm", "-rf", f"{S}/layer11/lc"])
    blocks = re.split(r"\n(?=\s*\d+\. \[)", out)
    for i in ids:
        b = [x for x in blocks if f"[{i}]" in x]
        assert len(b) == 1, (repo, i)
        text = b[0].strip("\n").split("\n\n")[0]
        key = "K-" + secrets.token_hex(4)
        text = re.sub(r"^\s*\d+\. \[" + i + r"\]", f"[{key}]", text)
        keymap[key] = {"repo": repo, "id": i}
        rows.append({"key": key, "repo_dir": f"{C}/{part[repo]}/{repo}", "proposal": text})
import random; random.shuffle(rows)
json.dump(keymap, open(f"{S}/layer11/label/keymap.json", "w"), indent=1)
with open(f"{S}/layer11/label/rows.jsonl", "w") as f:
    for r in rows: f.write(json.dumps(r) + "\n")
print(len(rows))
