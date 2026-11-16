"""End-to-end dry run: a throwaway git repository, a made-up export of its
"pull requests", selection, freeze, harness.py run --dry-run, grade.py packets,
made-up grades, grade.py join. No agent, no Drift binary, no network.

    BENCH_SCRATCH=/some/scratch/dir python3 -I -m unittest discover -s eval/benchmark/tests

The throwaway repository and every run are created under BENCH_SCRATCH (or
the system temporary directory) and deleted at the end unless BENCH_KEEP=1.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import benchlib as bl  # noqa: E402
import grade  # noqa: E402
import harness  # noqa: E402
import select_tasks as st  # noqa: E402

GIT_ENV = dict(harness.COMMIT_ENV)


def sh(args, cwd, env=None):
    e = dict(os.environ)
    e.update(GIT_ENV)
    e["GIT_CONFIG_NOSYSTEM"] = "1"
    if env:
        e.update(env)
    return subprocess.run(args, cwd=cwd, env=e, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


TEST_PY = """import sys
sys.path.insert(0, '.')
from app import handlers
assert handlers.get_total([]) == {"total": 0}
print("tests passed")
"""


def make_repo(base):
    """Source repository with three merged fix branches; returns (mirror, prs)."""
    src = os.path.join(base, "src")
    os.makedirs(src)
    sh(["git", "init", "-q", "-b", "main"], src)
    write(os.path.join(src, "app", "handlers.py"),
          'def get_total(items):\n    return {"total": sum(i["n"] for i in items)}\n')
    write(os.path.join(src, "test_app.py"), TEST_PY)
    write(os.path.join(src, "README.md"), "# Widgets\n")
    sh(["git", "add", "-A"], src)
    sh(["git", "commit", "-q", "-m", "initial"], src)
    prs = []
    bodies = {
        1: "Calling get_total with an empty list should return a zero total in a dict, and it should keep "
           "working for lists of items. Please make it robust.",
        2: "The handler module needs a count function that returns a dict with the number of items. "
           "DRYRUN-FAIL is a marker the fake agent reads; it exits 1 on it.",
        3: "Add a helper that returns the mean of item sizes as a dict, the way other handlers answer. "
           "DRYRUN-SLEEP is a marker the fake agent reads; it sleeps past the timeout.",
    }
    for n in (1, 2, 3):
        sh(["git", "checkout", "-q", "-b", "fix-%d" % n], src)
        with open(os.path.join(src, "app", "handlers.py"), "a") as f:
            f.write('\n\ndef helper_%d(items):\n    return {"value": len(items) * %d}\n' % (n, n))
        sh(["git", "commit", "-q", "-am", "fix %d" % n], src)
        sh(["git", "checkout", "-q", "main"], src)
        sh(["git", "merge", "-q", "--no-ff", "-m", "Merge fix %d" % n, "fix-%d" % n], src)
        merge = sh(["git", "rev-parse", "HEAD"], src).strip()
        basec = sh(["git", "rev-parse", "HEAD^1"], src).strip()
        fixc = sh(["git", "rev-parse", "HEAD^2"], src).strip()
        prs.append({
            "number": n, "title": "Handler fix %d" % n, "merged_at": "2026-0%d-10T10:00:00Z" % n,
            "merge_commit": merge, "base_commit": basec, "base_branch": "main", "author_kind": "user",
            "commits": [fixc],
            "changed_files": [{"path": "app/handlers.py", "status": "modified", "additions": 3, "deletions": 0}],
            "linked_issues": [{"number": 100 + n, "title": "Issue %d" % n, "created_at": "2026-01-01T00:00:00Z",
                               "body": bodies[n]}],
        })
    mirror = os.path.join(base, "mirror.git")
    sh(["git", "clone", "-q", "--mirror", src, mirror], base)
    shutil.rmtree(src)
    return mirror, prs


class EndToEndDryRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        parent = os.environ.get("BENCH_SCRATCH") or None
        if parent:
            os.makedirs(parent, exist_ok=True)
        cls.base = tempfile.mkdtemp(prefix="bench-e2e-", dir=parent)

    @classmethod
    def tearDownClass(cls):
        if os.environ.get("BENCH_KEEP") != "1":
            shutil.rmtree(cls.base, ignore_errors=True)

    def test_dry_run_end_to_end(self):
        base = self.base
        mirror, prs = make_repo(base)
        export = os.path.join(base, "export.json")
        bl.dump_json(export, {"schema": "drift-benchmark-pr-export/1", "repository": "example-org/widgets",
                              "exported_at": "2026-11-10T00:00:00Z", "source": "throwaway dry-run repository",
                              "pull_requests": prs})
        spec = os.path.join(base, "spec.json")
        bl.dump_json(spec, {"repositories": ["example-org/widgets"], "min_changed_lines": 1, "tasks_per_repo": 3,
                            "total_tasks": 3, "reserves_per_repo": 0})
        tdir = os.path.join(base, "taskset")
        self.assertEqual(st.main(["draw", "--spec", spec, "--seed", "e2e-seed", "--out", tdir, export]), 0)
        for name in os.listdir(os.path.join(tdir, "tasks")):
            p = os.path.join(tdir, "tasks", name)
            with open(p) as f:
                t = json.load(f)
            t["test_command"] = "python3 -I test_app.py"
            t["conventions"] = [{"id": "C1", "text": "Handlers return a dict.", "evidence": ["app/handlers.py:1"]}]
            bl.dump_json(p, t)
        cfg_path = os.path.join(base, "config.json")
        runs_root = os.path.join(base, "runs")
        bl.dump_json(cfg_path, {"seed": "e2e-seed", "tasks_dir": tdir, "runs_root": runs_root,
                                "mirrors": {"example-org/widgets": mirror}, "runs_per_arm": 2,
                                "agent": {"timeout_s": 3}, "tests": {"enabled": True, "timeout_s": 60}})

        # freeze: technical check and reference diffs
        self.assertEqual(harness.main(["freeze", "--config", cfg_path, "--dry-run", "--tests"]), 0)
        with open(os.path.join(tdir, "freeze-report.json")) as f:
            report = json.load(f)
        for rep in report.values():
            self.assertEqual(rep["problems"], [])
            self.assertEqual(rep["tests_merge"]["exit_code"], 0)

        # the run
        self.assertEqual(harness.main(["run", "--config", cfg_path, "--dry-run"]), 0)
        with open(os.path.join(runs_root, "manifest.json")) as f:
            man = json.load(f)
        self.assertEqual(len(man["order"]), 3 * 4 * 2)
        self.assertEqual(man["model"], "dry-run")
        self.assertEqual(man["drift_version"], "drift 0.0.0-dryrun")
        self.assertEqual(man["agent_version"], "fake-agent 0.0.0-dryrun")
        self.assertEqual(man["policy_consistency"], [])
        self.assertTrue(man["dry_run"])
        self.assertEqual(sorted(os.listdir(os.path.join(runs_root, "work"))), [])  # working copies removed

        cfg = harness.load_config(cfg_path, dry_run=True)
        tasks = harness.load_tasks(cfg)
        by_prompt = {t["id"]: t["prompt"] for t in tasks}
        results = []
        for o in man["order"]:
            with open(os.path.join(runs_root, "runs", o["run_id"], "result.json")) as f:
                results.append(json.load(f))
        for r in results:
            prompt = by_prompt[r["task"]]
            want = "timeout" if "DRYRUN-SLEEP" in prompt else "agent-error" if "DRYRUN-FAIL" in prompt else "ok"
            self.assertEqual(r["status"], want, r)
            d = os.path.join(runs_root, "runs", r["run_id"], r["final_attempt"])
            if want != "timeout":
                self.assertIn("app/handlers.py", r["changed_files"])
                self.assertTrue(os.path.exists(os.path.join(d, "transcript.jsonl")))
                self.assertEqual(r["tests"]["exit_code"], 0)
            else:
                self.assertTrue(r["timed_out"])
                self.assertEqual(r["changed_files"], [])
            # what each arm prepared, and nothing else
            setup = set(r["setup_files"])
            if r["arm"] == "none":
                self.assertEqual(setup, set())
            elif r["arm"] == "plain":
                self.assertEqual(setup, {"AGENTS.md"})
            elif r["arm"] == "agents-md":
                self.assertEqual(setup, {"AGENTS.md", ".drift/conventions.yaml", "drift.lock"})
            else:
                self.assertEqual(setup, {"AGENTS.md", ".drift/conventions.yaml", "drift.lock", ".agent/hooks.json"})
            with open(os.path.join(d, "agent.diff")) as f:
                diff = f.read()
            self.assertNotIn("AGENTS.md", diff)  # the arm's own setup is not in the agent's diff
        # a second run is a no-op (resume)
        before = {o["run_id"]: os.path.getmtime(os.path.join(runs_root, "runs", o["run_id"], "result.json")) for o in man["order"]}
        harness.main(["run", "--config", cfg_path, "--dry-run"])
        after = {o["run_id"]: os.path.getmtime(os.path.join(runs_root, "runs", o["run_id"], "result.json")) for o in man["order"]}
        self.assertEqual(before, after)

        # packets: blind and deterministic
        packs = os.path.join(base, "packets")
        key = os.path.join(base, "key", "key.json")
        self.assertEqual(grade.main(["packets", "--config", cfg_path, "--dry-run", "--seed", "grade-seed",
                                     "--out", packs, "--key-out", key, "--with-transcript"]), 0)
        texts = []
        for g in ("g1", "g2"):
            for name in sorted(os.listdir(os.path.join(packs, g))):
                if name.endswith(".md"):  # the packets themselves (grades.json is the same form for all)
                    with open(os.path.join(packs, g, name)) as f:
                        texts.append(f.read())
        blob = "\n".join(texts)
        for leak in ("drift", "Drift", "AGENTS.md", ".agent/", "conventions.yaml", runs_root, "agents-md", "Project setup"):
            self.assertNotIn(leak, blob, leak)
        with open(os.path.join(packs, "g1", "ORDER.txt")) as f:
            o1 = f.read().split()
        with open(os.path.join(packs, "g2", "ORDER.txt")) as f:
            o2 = f.read().split()
        self.assertEqual(sorted(o1), sorted(o2))
        self.assertNotEqual(o1, o2)
        packs2 = os.path.join(base, "packets2")
        grade.main(["packets", "--config", cfg_path, "--dry-run", "--seed", "grade-seed",
                    "--out", packs2, "--key-out", os.path.join(base, "key", "key2.json"), "--with-transcript"])
        for g in ("g1", "g2"):
            for name in os.listdir(os.path.join(packs, g)):
                with open(os.path.join(packs, g, name)) as f, open(os.path.join(packs2, g, name)) as f2:
                    self.assertEqual(f.read(), f2.read())
        with open(key) as f:
            k = json.load(f)
        dropped = [v["blinding"]["suppression_lines_dropped"] for v in k["packets"].values() if v["arm"] in ("agents-md", "hooks") and v["status"] != "timeout"]
        self.assertTrue(all(x == 1 for x in dropped))

        # made-up grades: violations more often without Drift, so the analysis has something to find
        grade_files = []
        for g, noise in (("g1", 0), ("g2", 1)):
            with open(os.path.join(packs, g, "grades.json")) as f:
                tmpl = json.load(f)
            for e in tmpl["grades"]:
                info = k["packets"][e["packet"]]
                bad = info["arm"] in ("none", "plain")
                flip = noise and int(bl.stable_key("flip", e["packet"])[:2], 16) < 40
                e["resolves"] = 0 if info["status"] == "timeout" else 3
                e["conventions"] = {"C1": "violated" if (bad != bool(flip)) and info["status"] != "timeout" else "followed"}
                e["other_violations"] = 0
                e["breakage"] = 3
                e["scope"] = 3
                e["guess_arm"] = "cannot-tell"
            path = os.path.join(base, "grades-%s.json" % g)
            bl.dump_json(path, tmpl)
            grade_files.append(path)
        out = os.path.join(base, "analysis.json")
        self.assertEqual(grade.main(["join", "--config", cfg_path, "--dry-run", "--packets", packs, "--key", key,
                                     "--grades"] + grade_files + ["--out", out]), 0)
        with open(out) as f:
            an = json.load(f)
        self.assertEqual(an["packets"], 24)
        self.assertEqual(an["primary"]["n_tasks"], 3)
        self.assertLess(an["primary"]["mean_diff"], 0)
        self.assertIn("kappa", an["agreement"]["convention_verdicts"])
        self.assertIn("p_holm", an["secondary"]["agents-md-vs-none"])
        # an incomplete grades file is refused
        with open(grade_files[0]) as f:
            g1 = json.load(f)
        g1["grades"][0]["resolves"] = None
        bad = os.path.join(base, "grades-bad.json")
        bl.dump_json(bad, g1)
        with self.assertRaises(SystemExit):
            grade.main(["join", "--config", cfg_path, "--dry-run", "--packets", packs, "--key", key,
                        "--grades", bad, grade_files[1], "--out", out])


if __name__ == "__main__":
    unittest.main()
