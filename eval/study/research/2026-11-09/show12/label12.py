"""Label rows and blind prompts for the F12-candidate cards the build set shows without a final clean label (show12).

usage: python3 -I label12.py rows <scratch/show12> <worktree> <cards.jsonl> <labeldir>
       python3 -I label12.py render <scratch/show12> <worktree> <labeldir> <who> [<who> ...]
       python3 -I label12.py adjudicate <scratch/show12> <worktree> <labeldir> <C> <A> <B>

- rows: every card of d4.mjs `--cards` with status != "labelled" (no clean label on its exact card text), from the
  F12 candidate's `census --all --all-outliers --max 15` text (default view), rank replaced by a fresh opaque key
  K-xxxxxxxx (keymap.json, never shown to labellers); checkouts at the manifest pins under <scratch>/checkouts/<repo>.
- render: eval/study/REVIEWER-PROMPT.md with lib.mjs rubricText('v3'), each card through lib.mjs labellerCard and
  without its `tier:` line (labellers are blind to the tier), one prompt per repo per labeller, cards shuffled per
  labeller, a fresh outbox and an empty working directory each (index-<who>.json). A keyed checkout (dev4) gets
  "(keyed checkout)" for its URL.
- adjudicate: ADJUDICATOR-PROMPT.md for the cards where collected2/<A>.jsonl and collected2/<B>.jsonl (show-before-cap collect.py) disagree, the two
  reviews shuffled as Reviewer 1 / Reviewer 2 (index-<C>.json).
- Every prompt passes the pre-launch check before it is written: 0 `agents:` lines, 0 "Moves labels", 0 "N% of M",
  0 `tier:` lines, no card id (D-xxxxxx) and no other prompt's key.
"""
import json, os, random, re, secrets, subprocess, sys, uuid

mode = sys.argv[1]
S, wt = sys.argv[2], sys.argv[3]
lib = json.dumps(wt + "/eval/study/lib.mjs")


def node(code, inp=""):
    return subprocess.run(["node", "--input-type=module", "-e", f"import {{ rubricText, labellerCard, parseCensus }} from {lib}; {code}"],
                          input=inp, capture_output=True, text=True, check=True).stdout


rub = node("process.stdout.write(rubricText('v3'))")


def card(text):
    t = node("let t = ''; process.stdin.on('data', (d) => (t += d)).on('end', () => process.stdout.write(labellerCard(t)))", text)
    return "\n".join(l for l in t.split("\n") if not re.match(r"^\s+tier:\s", l))


def check(text, own_keys, all_keys):
    assert not re.search(r"^\s*agents:", text, re.M), "agents line"
    assert "Moves labels" not in text, "study-only note"
    assert not re.search(r"[0-9]+% of [0-9]+", text), "accept rate"
    assert not re.search(r"^\s+tier:\s", text, re.M), "tier line"
    assert not re.search(r"\[D-[0-9a-f]{6}\]", text), "card id"
    assert not [k for k in all_keys if k not in own_keys and k in text], "other key"


def manifest_urls():
    out = {}
    for line in open(f"{S}/remote-list.txt"):
        pool, name, url, sha = line.split()
        out[name] = (pool, url, sha)
    return out


if mode == "rows":
    cards_path, L = sys.argv[4], sys.argv[5]
    os.makedirs(L, exist_ok=True)
    want = {}
    for l in open(cards_path):
        c = json.loads(l)
        if c["view"] == "default" and c["status"] != "labelled":
            want.setdefault((c["pool"], c["repo"]), []).append(c["id"])
    rows, keymap = [], {}
    for (pool, repo), ids in sorted(want.items()):
        txt = open(f"{S}/census-text/current/default/{pool}__{repo}.txt").read()
        props = json.loads(node("let t=''; process.stdin.on('data', (d) => (t += d)).on('end', () => process.stdout.write(JSON.stringify(parseCensus(t).proposals)))", txt))
        blocks = {p["id"]: p["block"] for p in props}
        for i in ids:
            text = blocks[i]
            key = "K-" + secrets.token_hex(4)
            text = re.sub(r"^\s*\d+\. \[" + i + r"\]", f"[{key}]", text)
            assert i not in text, (repo, i)
            keymap[key] = {"pool": pool, "repo": repo, "id": i, "view": "default"}
            rows.append({"key": key, "repo_dir": f"{S}/checkouts/{repo}", "proposal": text})
    random.shuffle(rows)
    json.dump(keymap, open(f"{L}/keymap.json", "w"), indent=1)
    with open(f"{L}/rows.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(len(rows), "rows;", len({r["repo_dir"] for r in rows}), "repos")
    sys.exit(0)

L = sys.argv[4]
rows = [json.loads(l) for l in open(f"{L}/rows.jsonl")]
all_keys = [r["key"] for r in rows]
urls = manifest_urls()


def head(d):
    sha = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    name = os.path.basename(d)
    pool, url, pin = urls[name]
    assert sha == pin, (name, sha, pin)
    assert subprocess.run(["git", "-C", d, "status", "--short"], capture_output=True, text=True).stdout == "", ("dirty", d)
    return name, ("(keyed checkout)" if pool == "dev4" else url), sha


def write(who, d, rs, body_key, body, tpl_file, extra=None):
    out = f"{L}/outbox/{uuid.uuid4().hex}/out.jsonl"
    cwd = f"{L}/work/{uuid.uuid4().hex}"
    os.makedirs(os.path.dirname(out))
    os.makedirs(cwd)
    name, url, sha = head(d)
    tpl = open(f"{wt}/eval/study/{tpl_file}").read().split("<!-- BEGIN PROMPT -->")[1].split("<!-- END PROMPT -->")[0]
    p = (tpl.replace("{{REPO}}", name).replace("{{REPO_URL}}", url).replace("{{REPO_SHA}}", sha).replace("{{REPO_DIR}}", d)
         .replace("{{RUBRIC}}", rub).replace("{{COUNT}}", str(len(rs))).replace("{{OUTPUT_FILE}}", out).replace(body_key, body))
    assert "{{" not in p, "unfilled placeholder"
    check(p, [r["key"] for r in rs], all_keys)
    os.makedirs(f"{L}/prompts", exist_ok=True)
    pf = f"{L}/prompts/{uuid.uuid4().hex[:12]}.md"
    open(pf, "w").write(p.strip() + "\n")
    return {"labeller": who, "prompt": pf, "cwd": cwd, "out": out, "keys": [r["key"] for r in rs], "repo_dir": d}


by = {}
for r in rows:
    by.setdefault(r["repo_dir"], []).append(r)

if mode == "render":
    for who in sys.argv[5:]:
        index = []
        for d, rs in sorted(by.items()):
            rs = rs[:]
            random.shuffle(rs)
            index.append(write(who, d, rs, "{{PROPOSALS}}", "\n\n".join(card(r["proposal"]) for r in rs), "REVIEWER-PROMPT.md"))
        json.dump(index, open(f"{L}/index-{who}.json", "w"), indent=1)
        print(who, [(os.path.basename(i["repo_dir"]), len(i["keys"])) for i in index])

if mode == "adjudicate":
    wc, wa, wb = sys.argv[5:8]
    jl = lambda f: {r["uid"]: r for r in (json.loads(x) for x in open(f) if x.strip())}
    la, lb = jl(f"{L}/collected2/{wa}.jsonl"), jl(f"{L}/collected2/{wb}.jsonl")

    def review(n, l):
        h = f"**Reviewer {n}: {l['label']}**"
        if l.get("trivial_by"):
            h += f" (trivial_by: {l['trivial_by']}" + (f"; {l['trivial_evidence']}" if l.get("trivial_evidence") else "") + ")"
        if l.get("wrong_because"):
            h += f" (wrong_because: {l['wrong_because']})"
        o = [h, f"- reason: {l['reason']}", f"- checked: {', '.join(l.get('checked') or []) or '(not recorded)'}"]
        if l.get("outliers"):
            o.append("- outlier verdicts: " + "; ".join(f"{x.get('symbol')}: {x.get('verdict')}" for x in l["outliers"]))
        return "\n".join(o)

    dis = [r for r in rows if r["key"] in la and r["key"] in lb and la[r["key"]]["label"] != lb[r["key"]]["label"]]
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
        index.append(write(wc, d, rs, "{{CASES}}", "\n\n---\n\n".join(cases), "ADJUDICATOR-PROMPT.md"))
    json.dump(index, open(f"{L}/index-{wc}.json", "w"), indent=1)
    print(wc, [(os.path.basename(i["repo_dir"]), len(i["keys"])) for i in index])
