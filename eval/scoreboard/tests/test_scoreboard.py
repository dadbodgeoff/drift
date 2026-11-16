"""Pins fixes from the code review of the map-to-enforcement sprint.

    python3 -I -m unittest discover -s eval/scoreboard/tests

- Passive candidates (`passive` in `practices promote --list --json`) are counted, and
  apart as `cand.passive`; a diff against a side with no `passive` list says "not
  comparable (older build)" for the candidate numbers instead of a drop.
- A guard whose "after" value is missing (its command crashed or timed out) fails the
  diff and names the repository and command; never "guards: none regressed".
- A collect step that fails leaves no output of an earlier collect (the funnel
  included) for `score` to read.
"""

import argparse
import contextlib
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import scoreboard as sb  # noqa: E402


def cand(concern, path):
    return {"candidate": {"concern": concern, "place": {"package": "", "dir": "src"}, "ways": [{"key": "call:x"}],
                          "total": 20, "exceptions": [], "example": {"path": path}}}


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f)


class Base(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="scoreboard-", dir=os.environ.get("SCOREBOARD_SCRATCH"))

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def score_of(self, repos):
        """A minimal score.json: {repo: {key: value}}, guards filled in unless given."""
        full = {}
        for r, m in repos.items():
            v = {"census.text_sha256": "abc", "sec.guard_gap_exceptions_unknown": 0, "cand.exceptions_unknown": 0,
                 "census.outliers_unknown": 0}
            v.update(m)
            full[r] = v
        return {"schema": sb.SCHEMA, "repos": full, "meta": {}}

    def run_diff(self, before, after):
        paths = []
        for n, s in (("before.json", before), ("after.json", after)):
            p = os.path.join(self.base, n)
            write_json(p, s)
            paths.append(p)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                sb.diff(argparse.Namespace(before=paths[0], after=paths[1], changed=False, json=True))
        return cm.exception.code, json.loads(buf.getvalue())


class Passive(Base):
    def test_passive_candidates_are_counted_and_apart(self):
        rdir = os.path.join(self.base, "epic")
        os.makedirs(rdir)
        write_json(os.path.join(rdir, "promote-list.json"),
                   {"candidates": [cand("errors", "src/a.ts")], "passive": [cand("api", "src/b.ts")]})
        m, _, labels = sb.score_repo(rdir, "epic")
        self.assertEqual(m["cand.count"], 2)
        self.assertEqual(m["cand.passive"], 1)
        self.assertEqual(m["cand.api"], 1)
        self.assertEqual(len(labels["candidates"]), 2)

    def test_an_older_list_has_no_passive_count(self):
        rdir = os.path.join(self.base, "epic")
        os.makedirs(rdir)
        write_json(os.path.join(rdir, "promote-list.json"), {"candidates": [cand("errors", "src/a.ts")]})
        m, _, _ = sb.score_repo(rdir, "epic")
        self.assertEqual(m["cand.count"], 1)
        self.assertIsNone(m["cand.passive"])

    def test_a_diff_against_an_older_build_is_not_comparable(self):
        before = self.score_of({"epic": {"cand.count": 5, "cand.passive": None}})
        after = self.score_of({"epic": {"cand.count": 3, "cand.passive": 1}})
        code, out = self.run_diff(before, after)
        self.assertEqual(code, 0)
        row = next(r for r in out["rows"] if r["key"] == "cand.count")
        self.assertEqual(row["verdict"], "not comparable (older build)")
        self.assertEqual(out["not_comparable"]["repos"], ["epic"])


class MissingGuard(Base):
    def test_a_guard_with_no_value_after_fails_and_names_the_command(self):
        before = self.score_of({"epic": {}})
        after = self.score_of({"epic": {"sec.guard_gap_exceptions_unknown": None}})
        after["failed"] = {"epic": ["security"]}
        code, out = self.run_diff(before, after)
        self.assertEqual(code, 1)
        self.assertEqual(len(out["guard_missing"]), 1)
        self.assertIn("epic", out["guard_missing"][0])
        self.assertIn("`drift security --json`", out["guard_missing"][0])

    def test_a_guard_absent_from_both_sides_fails(self):
        before = self.score_of({"epic": {}})
        after = self.score_of({"epic": {}})
        del before["repos"]["epic"]["cand.exceptions_unknown"]
        del after["repos"]["epic"]["cand.exceptions_unknown"]
        code, out = self.run_diff(before, after)
        self.assertEqual(code, 1)
        self.assertTrue(any("cand.exceptions_unknown" in x for x in out["guard_missing"]))

    def test_all_guards_present_and_steady_pass(self):
        code, out = self.run_diff(self.score_of({"epic": {}}), self.score_of({"epic": {}}))
        self.assertEqual(code, 0)
        self.assertEqual(out["guard_missing"], [])


class StaleOutputs(Base):
    def test_a_failed_census_leaves_no_old_funnel(self):
        repos = os.path.join(self.base, "repos")
        os.makedirs(os.path.join(repos, "epic"))
        out = os.path.join(self.base, "out")
        rdir = os.path.join(out, "epic")
        os.makedirs(rdir)
        for n in ("funnel.json", "census.json", "security.json"):
            write_json(os.path.join(rdir, n), {"old": True})
        fake = os.path.join(self.base, "fake-drift")
        with open(fake, "w") as f:
            # every command prints {} and exits 0, except `census --json`, which fails
            f.write('#!/bin/sh\ncase "$*" in *"census --json") exit 1;; esac\necho "{}"\n')
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
        args = argparse.Namespace(bin=fake, repos=repos, out=out, only=["epic"], timeout=60.0, cache="none",
                                  keep_cache=False)
        with contextlib.redirect_stderr(io.StringIO()):
            sb.collect(args)
        self.assertFalse(os.path.exists(os.path.join(rdir, "funnel.json")))
        self.assertIsNone(sb.read_json(rdir, "census.json"))
        self.assertEqual(sb.read_json(rdir, "security.json"), {})
        self.assertIn("census_json", sb.failed_commands(rdir))


if __name__ == "__main__":
    unittest.main()
