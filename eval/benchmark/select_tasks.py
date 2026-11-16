#!/usr/bin/env python3
"""Select and freeze benchmark tasks from local exports of merged pull requests.

    python3 -I eval/benchmark/select_tasks.py draw   --spec SPEC.json --seed SEED --out DIR EXPORT.json [EXPORT.json ...]
    python3 -I eval/benchmark/select_tasks.py verify --out DIR EXPORT.json [EXPORT.json ...]

No network. The exports are JSON files the operator wrote beforehand, one per
repository, in the format documented in TASKS.md ("The export format"). The
spec fixes the query (TASKS.md, "The query"). The draw is a seeded random order
over the eligible pull requests, so the builder does not choose tasks.

`draw` writes:
  DIR/selection.json      the record: spec, seed, export hashes, every pull
                          request with its eligibility and the reason it was
                          excluded, the drawn tasks and the reserves, in order
  DIR/tasks/<id>.json     one frozen task record per drawn task (tasks/schema.json)
`verify` replays the draw from DIR/selection.json and the same exports and
exits 1 if anything differs.
"""

import argparse
import fnmatch
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import benchlib as bl  # noqa: E402

SELECTOR_VERSION = 1

DEFAULT_SPEC = {
    "merged_after": "2025-01-01T00:00:00Z",
    "merged_before": "2026-11-01T00:00:00Z",
    "min_changed_lines": 10,
    "max_changed_lines": 400,
    "min_files": 1,
    "max_files": 12,
    "min_code_files": 1,
    "code_extensions": [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py"],
    "not_code_globs": [
        "*.d.ts", "*.pyi", "*.min.js",
        "*/node_modules/*", "*/dist/*", "*/build/*", "*/vendor/*",
        "*/migrations/*", "*/alembic/versions/*",
        "*.lock", "*-lock.json", "*-lock.yaml", "*.snap",
    ],
    "test_globs": [
        "*.test.*", "*.spec.*", "test_*.py", "*_test.py", "conftest.py",
        "*/__tests__/*", "*/tests/*", "*/test/*", "*/e2e/*", "*/fixtures/*",
    ],
    "require_linked_issue": True,
    "max_linked_issues": 1,
    "min_issue_chars": 80,
    "exclude_issue_with_diff": True,
    "exclude_author_kinds": ["bot"],
    "exclude_title_patterns": ["^revert\\b", "^(chore|build|ci)(\\(.*\\))?!?:", "\\bbump\\b", "\\bdeps?\\b", "\\brelease\\b"],
    "tasks_per_repo": 5,
    "total_tasks": 25,
    "refill_from_other_repos": True,
    "reserves_per_repo": 2,
    "prompt_template": "Resolve the following issue in the repository in the current directory.\n\nIssue title: {title}\n\n{body}\n",
}

SHA_RE = re.compile(r"\b[0-9a-f]{7,40}\b")
URL_RE = re.compile(r"https?://[^\s)>\]]+")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def merged_spec(spec):
    out = dict(DEFAULT_SPEC)
    unknown = set(spec) - set(DEFAULT_SPEC) - {"//", "repositories"}
    if unknown:
        raise SystemExit("unknown spec keys: %s" % ", ".join(sorted(unknown)))
    out.update(spec)
    return out


def glob_any(path, globs):
    p = "/" + path
    base = os.path.basename(path)
    return any(fnmatch.fnmatch(p, g) or fnmatch.fnmatch(base, g) for g in globs)


def is_code(path, spec):
    if not any(path.endswith(ext) for ext in spec["code_extensions"]):
        return False
    return not glob_any(path, spec["not_code_globs"])


def is_test(path, spec):
    return glob_any(path.lower(), spec["test_globs"])


# ---------------------------------------------------------------- stripping

def strip_fix_links(text, repo, pr):
    """Remove from issue text every pointer to the fix. Returns (text, log).

    Removed: URLs to this pull request, to its commits, to any pull/, commit/ or
    compare/ page of the same repository; references `#N` and `owner/name#N`
    where N is this pull request's number; hex strings of 7 to 40 characters
    that are a prefix of the merge commit or of any commit of the pull request.
    Each removal is replaced by "[link removed]" or "[reference removed]" and
    logged. Everything else is kept verbatim.
    """
    log = []
    shas = [pr["merge_commit"]] + list(pr.get("commits", []))
    owner_repo = repo.lower()
    n = str(pr["number"])

    def url_sub(m):
        url = m.group(0)
        low = url.lower()
        hit = False
        if owner_repo in low and re.search(r"/(pull|pulls|commit|commits|compare)/", low):
            hit = True
        if any(s and s[:7] in low for s in shas):
            hit = True
        if hit:
            log.append({"removed": url, "rule": "url-to-fix"})
            return "[link removed]"
        return url

    text = URL_RE.sub(url_sub, text)

    def ref_sub(m):
        log.append({"removed": m.group(0), "rule": "ref-to-pr"})
        return "[reference removed]"

    text = re.sub(r"(?i)\b" + re.escape(repo) + "#" + n + r"\b", ref_sub, text)
    text = re.sub(r"(?<![\w/])#" + n + r"\b", ref_sub, text)

    def sha_sub(m):
        h = m.group(0)
        if any(s.startswith(h) for s in shas if s):
            log.append({"removed": h, "rule": "sha-of-fix"})
            return "[reference removed]"
        return h

    text = SHA_RE.sub(sha_sub, text)
    return text, log


def issue_has_diff(body):
    if "```diff" in body or "```patch" in body:
        return True
    lines = body.splitlines()
    return any(l.startswith("diff --git ") or l.startswith("@@ ") for l in lines)


# ---------------------------------------------------------------- eligibility

def eligibility(pr, repo, spec):
    """Return None when eligible, else the first reason (in a fixed order)."""
    merged = pr.get("merged_at")
    if not merged:
        return "not-merged"
    if not (spec["merged_after"] <= merged < spec["merged_before"]):
        return "outside-dates"
    if not pr.get("base_commit") or not pr.get("merge_commit"):
        return "missing-commit"
    if pr.get("author_kind", "user") in spec["exclude_author_kinds"]:
        return "author-kind"
    title = pr.get("title", "")
    for pat in spec["exclude_title_patterns"]:
        if re.search(pat, title, re.IGNORECASE):
            return "title-pattern"
    files = pr.get("changed_files", [])
    if not (spec["min_files"] <= len(files) <= spec["max_files"]):
        return "file-count"
    lines = sum(int(f.get("additions", 0)) + int(f.get("deletions", 0)) for f in files)
    if not (spec["min_changed_lines"] <= lines <= spec["max_changed_lines"]):
        return "size"
    code = [f["path"] for f in files if is_code(f["path"], spec) and not is_test(f["path"], spec)]
    if len(code) < spec["min_code_files"]:
        return "no-code-drift-reads"
    issues = pr.get("linked_issues", [])
    if spec["require_linked_issue"] and not issues:
        return "no-linked-issue"
    if len(issues) > spec["max_linked_issues"]:
        return "several-issues"
    if issues:
        iss = issues[0]
        body = iss.get("body") or ""
        if len(body.strip()) < spec["min_issue_chars"]:
            return "issue-too-short"
        if spec["exclude_issue_with_diff"] and issue_has_diff(body):
            return "issue-holds-diff"
        created = iss.get("created_at")
        if created and created >= merged:
            return "issue-after-merge"
        if iss.get("is_pull_request"):
            return "issue-is-pr"
    return None


def task_id(repo, number):
    return re.sub(r"[^a-z0-9]+", "-", repo.lower()).strip("-") + "-pr" + str(number)


def make_task(repo, pr, spec, seed, rank, export_sha):
    iss = pr["linked_issues"][0]
    title, tlog = strip_fix_links(iss.get("title", ""), repo, pr)
    body, blog = strip_fix_links(iss.get("body") or "", repo, pr)
    prompt = spec["prompt_template"].format(title=title, body=body)
    files = pr["changed_files"]
    return {
        "schema": "drift-benchmark-task/1",
        "id": task_id(repo, pr["number"]),
        "repository": repo,
        "pr_number": pr["number"],
        "merge_commit": pr["merge_commit"],
        "base_commit": pr["base_commit"],
        "base_branch": pr.get("base_branch", "main"),
        "merged_at": pr["merged_at"],
        "language": language_of(files, spec),
        "issue": {
            "number": iss.get("number"),
            # sha256 of "issue" + US + title + US + body (US = \x1f), before stripping
            "raw_sha256": bl.stable_key("issue", iss.get("title", ""), iss.get("body") or ""),
            "stripped": tlog + blog,
        },
        "prompt": prompt,
        "hidden": {
            "changed_files": sorted(f["path"] for f in files),
            "additions": sum(int(f.get("additions", 0)) for f in files),
            "deletions": sum(int(f.get("deletions", 0)) for f in files),
            "reference_diff": None,
        },
        "test_command": None,
        "setup_command": None,
        "conventions": [],
        "draw": {"seed": seed, "rank": rank, "export_sha256": export_sha, "selector_version": SELECTOR_VERSION},
    }


def language_of(files, spec):
    py = sum(1 for f in files if f["path"].endswith(".py"))
    js = sum(1 for f in files if is_code(f["path"], spec) and not f["path"].endswith(".py"))
    return "python" if py > js else "typescript-javascript"


def draw(spec_in, seed, export_paths):
    spec = merged_spec(spec_in)
    exports = []
    for p in sorted(export_paths):
        ex = load_json(p)
        exports.append((ex["repository"], bl.sha256_file(p), ex))
    exports.sort(key=lambda t: t[0])
    repos = [r for r, _, _ in exports]
    if len(set(repos)) != len(repos):
        raise SystemExit("two exports for one repository")
    if spec_in.get("repositories") and sorted(spec_in["repositories"]) != sorted(repos):
        raise SystemExit("exports do not match the spec's repositories")

    candidates = []  # all PRs, with reason
    eligible = {r: [] for r in repos}
    shas = {}
    for repo, sha, ex in exports:
        shas[repo] = sha
        for pr in sorted(ex["pull_requests"], key=lambda p: p["number"]):
            reason = eligibility(pr, repo, spec)
            key = bl.stable_key(seed, "draw", repo, pr["number"])
            candidates.append({"repository": repo, "number": pr["number"], "excluded": reason, "key": key})
            if reason is None:
                eligible[repo].append((key, pr))
    for repo in repos:
        eligible[repo].sort(key=lambda t: t[0])

    chosen, reserves = [], []
    leftovers = []
    per = spec["tasks_per_repo"]
    for repo in repos:
        lst = eligible[repo]
        chosen += [(repo, k, pr) for k, pr in lst[:per]]
        reserves += [(repo, k, pr) for k, pr in lst[per:per + spec["reserves_per_repo"]]]
        leftovers += [(repo, k, pr) for k, pr in lst[per + spec["reserves_per_repo"]:]]
    shortfall = spec["total_tasks"] - len(chosen)
    if shortfall > 0 and spec["refill_from_other_repos"]:
        leftovers.sort(key=lambda t: t[1])
        chosen += leftovers[:shortfall]
    chosen.sort(key=lambda t: t[1])
    chosen = chosen[: spec["total_tasks"]]

    tasks = [make_task(repo, pr, spec, seed, i + 1, shas[repo]) for i, (repo, _, pr) in enumerate(chosen)]
    reserve_records = [{"repository": r, "number": pr["number"], "key": k} for r, k, pr in sorted(reserves, key=lambda t: t[1])]
    counts = {}
    for c in candidates:
        counts[c["excluded"] or "eligible"] = counts.get(c["excluded"] or "eligible", 0) + 1
    record = {
        "schema": "drift-benchmark-selection/1",
        "selector_version": SELECTOR_VERSION,
        "seed": seed,
        "spec": spec_in,
        "spec_effective": spec,
        "exports": [{"repository": r, "sha256": shas[r]} for r in repos],
        "counts": dict(sorted(counts.items())),
        "eligible_per_repo": {r: len(eligible[r]) for r in repos},
        "candidates": candidates,
        "drawn": [t["id"] for t in tasks],
        "reserves": reserve_records,
        "shortfall": max(0, spec["total_tasks"] - len(tasks)),
    }
    return record, tasks


def write_out(out, record, tasks):
    os.makedirs(os.path.join(out, "tasks"), exist_ok=True)
    bl.dump_json(os.path.join(out, "selection.json"), record)
    for t in tasks:
        bl.dump_json(os.path.join(out, "tasks", t["id"] + ".json"), t)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Select and freeze benchmark tasks (no network).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("draw")
    d.add_argument("--spec", required=True)
    d.add_argument("--seed", required=True)
    d.add_argument("--out", required=True)
    d.add_argument("exports", nargs="+")
    v = sub.add_parser("verify")
    v.add_argument("--out", required=True)
    v.add_argument("exports", nargs="+")
    a = ap.parse_args(argv)

    if a.cmd == "draw":
        if os.path.exists(os.path.join(a.out, "selection.json")):
            raise SystemExit("%s already holds a selection; a draw is made once" % a.out)
        record, tasks = draw(load_json(a.spec), a.seed, a.exports)
        write_out(a.out, record, tasks)
        print("drew %d tasks (%d reserves, shortfall %d) from %d eligible pull requests"
              % (len(tasks), len(record["reserves"]), record["shortfall"], sum(record["eligible_per_repo"].values())))
        return 0
    rec = load_json(os.path.join(a.out, "selection.json"))
    record, tasks = draw(rec["spec"], rec["seed"], a.exports)
    bad = []
    if record != rec:
        bad.append("selection.json differs from the replay")
    for t in tasks:
        p = os.path.join(a.out, "tasks", t["id"] + ".json")
        if not os.path.exists(p):
            bad.append("missing " + p)
            continue
        have = load_json(p)
        # Fields filled after the draw (TASKS.md "Freezing") are not part of the replay.
        for k in ("test_command", "setup_command", "conventions"):
            have.pop(k, None)
            t.pop(k, None)
        have["hidden"].pop("reference_diff", None)
        t["hidden"].pop("reference_diff", None)
        if have != t:
            bad.append("task differs: " + t["id"])
    for b in bad:
        print("verify: " + b)
    print("verify: " + ("OK" if not bad else "FAILED"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
