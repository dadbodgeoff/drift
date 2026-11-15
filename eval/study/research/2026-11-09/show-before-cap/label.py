"""Label rows and blind A/B prompts for the cards the show-before-cap change adds (layer11's format).

usage: python3 -I label.py <scratch> <p1-bin> <census-diff.json> <worktree> <labeldir> [labeller ...]

With labellers named (e.g. A2 B2), only renders their prompts from the existing rows.jsonl (index-<who>.json).
With `C:<A>:<B>` (e.g. C:A2:B2), renders the adjudicator prompts (ADJUDICATOR-PROMPT.md) for the cards where the collected
labels collected2/<A>.jsonl and collected2/<B>.jsonl disagree: one per repo, cases shuffled, the two reviews in a
shuffled order as "Reviewer 1"/"Reviewer 2", through the same rubric, card text and pre-launch check (index-C2.json).

- rows: every proposal new under the change in either view (`census --all`, D4's population [STRICT]), plus nothing
  else; each card's text exactly as `drift census --all-outliers --all --max 15` prints it with the change, its rank
  number replaced by an opaque key K-xxxxxxxx (keymap.json, never shown to labellers);
- prompts: eval/study/REVIEWER-PROMPT.md with RUBRIC-v3, one per repo per labeller, the repo's rows shuffled per
  labeller, a fresh outbox and an empty working directory each; index-A.json and index-B.json list them.
  Per the runbook, B's prompts are launched only after A's outputs are collected.
"""
import json, os, random, re, secrets, shutil, subprocess, sys, tempfile, uuid

scratch, p1, diff, wt, L = sys.argv[1:6]
who_list = sys.argv[6:] or ["A", "B"]
rows_in = json.load(open(diff))
clones = os.path.join(scratch, "dev-clones")
part = {n: d for d in ("ts", "py", "py2", "dev3") for n in os.listdir(os.path.join(clones, d))}
want = {}
for r in rows_in:
    for c in r["new"]:
        want.setdefault(r["repo"], {})[c["id"]] = r["view"]
os.makedirs(L, exist_ok=True)
rows, keymap = [], {}
for repo, ids in (sorted(want.items()) if not sys.argv[6:] else []):
    root = os.path.join(clones, part[repo], repo)
    for view in sorted(set(ids.values())):
        cache = tempfile.mkdtemp(dir=scratch + "/recall11")
        extra = ["--python-proposals"] if view == "optin" else []
        out = subprocess.run([p1, "--root", root, "census", "--all-outliers", "--all", "--max", "15", *extra],
                             capture_output=True, text=True, env=dict(os.environ, DRIFT_CACHE_DIR=cache)).stdout
        shutil.rmtree(cache, ignore_errors=True)
        blocks = re.split(r"\n(?=\s*\d+\. \[)", out)
        for i, v in ids.items():
            if v != view or any(keymap[k]["id"] == i and keymap[k]["repo"] == repo for k in keymap):
                continue
            b = [x for x in blocks if f"[{i}]" in x]
            assert len(b) == 1, (repo, i, len(b))
            text = b[0].strip("\n").split("\n\n")[0]
            key = "K-" + secrets.token_hex(4)
            text = re.sub(r"^\s*\d+\. \[" + i + r"\]", f"[{key}]", text)
            assert i not in text, (repo, i)
            keymap[key] = {"repo": repo, "id": i, "view": view}
            rows.append({"key": key, "repo_dir": root, "proposal": text})
if sys.argv[6:]:
    rows = [json.loads(l) for l in open(f"{L}/rows.jsonl")]
else:
    random.shuffle(rows)
    json.dump(keymap, open(f"{L}/keymap.json", "w"), indent=1)
    with open(f"{L}/rows.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

tpl = open(f"{wt}/eval/study/REVIEWER-PROMPT.md").read().split("<!-- BEGIN PROMPT -->")[1].split("<!-- END PROMPT -->")[0]
# The labeller-facing rubric and card text exactly as prompt.mjs gives them (lib.mjs rubricText, labellerCard):
# no study-only "Moves labels" blocks, and no `agents:` line (it states a family's labelled accept rate).
lib = json.dumps(wt + "/eval/study/lib.mjs")
node = lambda code, inp="": subprocess.run(["node", "--input-type=module", "-e", f"import {{ rubricText, labellerCard }} from {lib}; {code}"],
                                           input=inp, capture_output=True, text=True, check=True).stdout
rub = node("process.stdout.write(rubricText('v3'))")
card = lambda text: node("let t = ''; process.stdin.on('data', (d) => (t += d)).on('end', () => process.stdout.write(labellerCard(t)))", text)


def check(text):
    # The pre-launch check (BRIEF.md): no agents line, no study-only note, no accept rate.
    assert not re.search(r"^\s*agents:", text, re.M) and "Moves labels" not in text and not re.search(r"[0-9]+% of [0-9]+", text), "leak"
by = {}
for r in rows:
    by.setdefault(r["repo_dir"], []).append(r)
adjudicate = [w for w in who_list if w.startswith("C:")]
who_list = [w for w in who_list if not w.startswith("C:")]


def review(n, l):
    head = f"**Reviewer {n}: {l['label']}**"
    if l.get("trivial_by"):
        head += f" (trivial_by: {l['trivial_by']}" + (f"; {l['trivial_evidence']}" if l.get("trivial_evidence") else "") + ")"
    if l.get("wrong_because"):
        head += f" (wrong_because: {l['wrong_because']})"
    out = [head, f"- reason: {l['reason']}", f"- checked: {', '.join(l.get('checked') or []) or '(not recorded)'}"]
    if l.get("outliers"):
        out.append("- outlier verdicts: " + "; ".join(f"{o.get('symbol')}: {o.get('verdict')}" for o in l["outliers"]))
    return "\n".join(out)


for spec in adjudicate:
    _, wa, wb = spec.split(":")
    jl = lambda f: {r["uid"]: r for r in (json.loads(x) for x in open(f) if x.strip())}
    la, lb = jl(f"{L}/collected2/{wa}.jsonl"), jl(f"{L}/collected2/{wb}.jsonl")
    ctpl = open(f"{wt}/eval/study/ADJUDICATOR-PROMPT.md").read().split("<!-- BEGIN PROMPT -->")[1].split("<!-- END PROMPT -->")[0]
    dis = [r for r in rows if la[r["key"]]["label"] != lb[r["key"]]["label"]]
    cby = {}
    for r in dis:
        cby.setdefault(r["repo_dir"], []).append(r)
    index = []
    for d, rs in sorted(cby.items()):
        rs = rs[:]
        random.shuffle(rs)
        cases = []
        for r in rs:
            pair = [la[r["key"]], lb[r["key"]]]
            random.shuffle(pair)
            cases.append("\n\n".join([card(r["proposal"]), review(1, pair[0]), review(2, pair[1])]))
        out = f"{L}/outbox/{uuid.uuid4().hex}/out.jsonl"
        cwd = f"{L}/work/{uuid.uuid4().hex}"
        os.makedirs(os.path.dirname(out))
        os.makedirs(cwd)
        sha = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        name = os.path.basename(d)
        url = "(keyed checkout)" if re.fullmatch(r"[TP]\d\d", name) else (
            subprocess.run(["git", "-C", d, "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip() or "(no remote)")
        p = (ctpl.replace("{{REPO}}", name).replace("{{REPO_URL}}", url).replace("{{REPO_SHA}}", sha).replace("{{REPO_DIR}}", d)
             .replace("{{RUBRIC}}", rub).replace("{{COUNT}}", str(len(rs))).replace("{{OUTPUT_FILE}}", out)
             .replace("{{CASES}}", "\n\n---\n\n".join(cases)))
        check(p)
        pf = f"{L}/prompts/{uuid.uuid4().hex[:12]}.md"
        open(pf, "w").write(p.strip() + "\n")
        index.append({"labeller": "C2", "prompt": pf, "cwd": cwd, "out": out, "keys": [r["key"] for r in rs], "repo_dir": d})
    json.dump(index, open(f"{L}/index-C2.json", "w"), indent=1)
    print("C2:", [(os.path.basename(i["repo_dir"]), len(i["keys"])) for i in index])

for who in who_list:
    index = []
    for d, rs in sorted(by.items()):
        rs = rs[:]
        random.shuffle(rs)
        out = f"{L}/outbox/{uuid.uuid4().hex}/out.jsonl"
        cwd = f"{L}/work/{uuid.uuid4().hex}"
        os.makedirs(os.path.dirname(out))
        os.makedirs(cwd)
        sha = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        name = os.path.basename(d)
        url = "(keyed checkout)" if re.fullmatch(r"[TP]\d\d", name) else (
            subprocess.run(["git", "-C", d, "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip() or "(no remote)")
        p = (tpl.replace("{{REPO}}", name).replace("{{REPO_URL}}", url).replace("{{REPO_SHA}}", sha).replace("{{REPO_DIR}}", d)
             .replace("{{RUBRIC}}", rub).replace("{{COUNT}}", str(len(rs))).replace("{{OUTPUT_FILE}}", out)
             .replace("{{PROPOSALS}}", "\n\n".join(card(r["proposal"]) for r in rs)))
        pf = f"{L}/prompts/{uuid.uuid4().hex[:12]}.md"
        os.makedirs(os.path.dirname(pf), exist_ok=True)
        check(p)
        open(pf, "w").write(p.strip() + "\n")
        index.append({"labeller": who, "prompt": pf, "cwd": cwd, "out": out, "keys": [r["key"] for r in rs], "repo_dir": d})
    json.dump(index, open(f"{L}/index-{who}.json", "w"), indent=1)
print(len(rows), "rows;", len(by), "repos")
