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


def unit(path, assignment, **kw):
    u = {"path": path, "symbol": "GET /x", "line": 1, "method": "GET", "route": "/x", "package": "",
         "assignment": assignment}
    u.update(kw)
    return u


class FromMap(Base):
    """`census --from-map --json` is the census JSON with a `from_map` list beside its
    `proposals`: harness 1 read `proposals` (the mined conventions) and said 0 proposals
    from the map on all seven repositories while the data held 39."""

    def test_the_map_proposals_are_read_from_from_map(self):
        rdir = os.path.join(self.base, "cal.com")
        os.makedirs(rdir)
        write_json(os.path.join(rdir, "census-from-map.json"), {
            "proposals": [{"id": "D-mined", "rule_kind": "avoids:import"}],
            "from_map": [
                {"id": "D-1", "kind": "practice", "proposed": True, "same_rule": []},
                {"id": "D-2", "kind": "layering", "proposed": True, "same_rule": [{"id": "D-mined"}]},
                {"id": "D-3", "kind": "declared", "proposed": True},
                {"id": None, "kind": "wiring", "proposed": False},
                {"id": "D-4", "kind": "practice", "proposed": False, "same_rule": None},
            ]})
        m, _, labels = sb.score_repo(rdir, "cal.com")
        self.assertEqual(m["map.entries"], 5)
        self.assertEqual(m["map.proposed"], 3)
        self.assertEqual(m["map.proposed.practice"], 1)
        self.assertEqual(m["map.proposed.layering"], 1)
        self.assertEqual(m["map.proposed.other"], 1)
        self.assertEqual(m["map.same_as_mined"], 1)
        self.assertEqual(sorted(labels["from_map"]), ["D-1", "D-2", "D-3"])

    def test_an_output_with_no_from_map_list_is_na_not_zero(self):
        rdir = os.path.join(self.base, "epic")
        os.makedirs(rdir)
        write_json(os.path.join(rdir, "census-from-map.json"), {"proposals": [{"id": "D-mined", "proposed": True}]})
        m, notes, _ = sb.score_repo(rdir, "epic")
        self.assertIsNone(m["map.proposed"])
        self.assertIsNone(m["map.entries"])
        self.assertTrue(any("from_map" in n for n in notes))


class ShapesOfThisBuild(Base):
    """Numbers that read a key no build writes, or that a new build writes elsewhere."""

    def security(self, rdir, **extra):
        sec = {"entry_points": [{"path": "a.ts", "symbol": "GET /x", "line": 1, "kind": "http", "method": "GET",
                                 "route": "/x", "guards": [], "reaches": [],
                                 "unknown": True, "guard_unknown": True}],
               "sinks": [], "guard_gaps": [], "client_leaks": []}
        sec.update(extra)
        write_json(os.path.join(rdir, "security.json"), sec)

    def test_unscoped_keys_come_from_the_authz_rows(self):
        rdir = os.path.join(self.base, "plane")
        os.makedirs(rdir)
        # a `findings` list in security.json is not something any build writes: ignored
        self.security(rdir, findings=[{"kind": "unscoped-key", "x": 1}, {"kind": "unscoped-key", "x": 2}])
        write_json(os.path.join(rdir, "practices-units.json"), {"concerns": [
            {"id": "authz", "units": [unit("a.py", "known", kind="http", unscoped="workspace_id"),
                                      unit("b.py", "none", kind="http")]},
            {"id": "authn", "units": [unit("c.py", "known", kind="http", unscoped="org_id")]}]})
        m, _, _ = sb.score_repo(rdir, "plane")
        self.assertEqual(m["sec.findings.unscoped-key"], 1)
        self.assertEqual(m["sec.findings.no-authorization"], 1)

    def test_an_older_builds_rows_cannot_say_unscoped(self):
        rdir = os.path.join(self.base, "plane")
        os.makedirs(rdir)
        self.security(rdir)
        write_json(os.path.join(rdir, "practices-units.json"), {"concerns": [
            {"id": "authz", "units": [unit("a.py", "known")]}]})
        m, _, _ = sb.score_repo(rdir, "plane")
        self.assertIsNone(m["sec.findings.unscoped-key"])
        self.assertIsNone(m["sec.unreached"])

    def test_no_field_but_opaque_makes_a_guard_unknown(self):
        rdir = os.path.join(self.base, "epic")
        os.makedirs(rdir)
        self.security(rdir)
        m, _, _ = sb.score_repo(rdir, "epic")
        self.assertEqual(m["entry.guard_unknown"], 0)
        self.assertEqual(m["entry.no_guard"], 1)

    def test_unreached_files_and_listed_entry_points_are_counted(self):
        rdir = os.path.join(self.base, "juice-shop")
        os.makedirs(rdir)
        self.security(rdir, unreached=[{"path": "data/static/codefixes/a.ts", "parsed": True, "sinks": ["eval"]},
                                       {"path": "data/static/codefixes/b.ts", "parsed": False}])
        write_json(os.path.join(rdir, "practices-units.json"), {"concerns": [
            {"id": "authz", "units": [unit("a.ts", "known", kind="http")]}]})
        write_json(os.path.join(rdir, "map.json"), {"packages": [{"entry_points": [{"count": 3}]}],
                                                    "entry_point_counts": {"measured": 3, "listed": 126}})
        m, _, _ = sb.score_repo(rdir, "juice-shop")
        self.assertEqual((m["sec.unreached"], m["sec.unreached_sinks"], m["sec.unreached_snippets"]), (2, 1, 2))
        self.assertEqual((m["entry.in_map"], m["entry.in_map_listed"]), (3, 126))


class DiffSides(Base):
    def test_a_repository_on_one_side_is_named_not_skipped(self):
        before = self.score_of({"epic": {}, "plane": {}})
        after = self.score_of({"epic": {}, "pygoat": {}})
        code, out = self.run_diff(before, after)
        self.assertEqual(code, 0)
        self.assertEqual(out["repos"], ["epic"])
        self.assertEqual(out["not_comparable"]["one_side"], {"before_only": ["plane"], "after_only": ["pygoat"]})

    def test_the_text_diff_says_which_repository_is_not_compared(self):
        before = self.score_of({"epic": {}, "plane": {}})
        after = self.score_of({"epic": {}})
        paths = []
        for n, s in (("b.json", before), ("a.json", after)):
            paths.append(os.path.join(self.base, n))
            write_json(paths[-1], s)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), self.assertRaises(SystemExit):
            sb.diff(argparse.Namespace(before=paths[0], after=paths[1], changed=False, json=False))
        self.assertIn("NOT COMPARABLE: plane: scored before only", buf.getvalue())

    def test_different_harness_versions_are_said(self):
        before = self.score_of({"epic": {}})  # no stamp: version 1
        after = self.score_of({"epic": {}})
        after["harness_version"] = sb.HARNESS_VERSION
        _, out = self.run_diff(before, after)
        self.assertEqual(out["harness_version"], {"before": 1, "after": sb.HARNESS_VERSION})
        self.assertGreater(sb.HARNESS_VERSION, 1)

    def test_an_unknown_rise_with_new_rows_says_so(self):
        before = self.score_of({"juice-shop": {"units.authz.rows": 43, "units.authz.unknown": 20,
                                               "units.authz.known": 20, "units.authz.none": 3}})
        after = self.score_of({"juice-shop": {"units.authz.rows": 50, "units.authz.unknown": 27,
                                              "units.authz.known": 20, "units.authz.none": 3}})
        code, out = self.run_diff(before, after)
        self.assertEqual(code, 1)
        self.assertIn("rows +7", out["unknown_guard"][0])


class Score(Base):
    def run_score(self, data, **kw):
        out = os.path.join(self.base, "score.json")
        args = argparse.Namespace(data=data, truth=os.path.join(self.base, "no-truth"), out=out, **kw)
        with contextlib.redirect_stdout(io.StringIO()):
            sb.score(args)
        with open(out, encoding="utf-8") as f:
            return json.load(f)

    def data_with_timing(self):
        data = os.path.join(self.base, "data")
        rdir = os.path.join(data, "epic")
        os.makedirs(rdir)
        write_json(os.path.join(rdir, "coverage.json"), {"loc": 50000})
        write_json(os.path.join(rdir, "run.json"), {"wall_s": 3.0, "runs": {
            "census": {"available": True, "wall_s": 1.0, "peak_rss_kb": 2048}}})
        return data

    def test_score_is_stamped_with_the_harness_version(self):
        s = self.run_score(self.data_with_timing(), no_timing=None)
        self.assertEqual(s["harness_version"], sb.HARNESS_VERSION)
        self.assertEqual(s["repos"]["epic"]["time.census_per_100k_s"], 2.0)

    def test_no_timing_makes_every_time_na(self):
        s = self.run_score(self.data_with_timing(), no_timing="debug build")
        for k in sb.TIMING_KEYS:
            self.assertIsNone(s["repos"]["epic"][k], k)
        self.assertIsNone(s["total"]["time.census_per_100k_s"])
        self.assertEqual(s["timing_not_comparable"], "debug build")
        self.assertIsNone(next(x for x in s["scoreboard"] if x["n"] == 7)["value"])


if __name__ == "__main__":
    unittest.main()
