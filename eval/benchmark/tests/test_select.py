"""Unit tests for select_tasks.py on a small made-up export (tests/fixtures).

    python3 -I -m unittest discover -s eval/benchmark/tests
"""

import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import benchlib as bl  # noqa: E402
import select_tasks as st  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
EXPORTS = [os.path.join(FIX, "export-widgets.json"), os.path.join(FIX, "export-gadgets.json")]


def spec():
    with open(os.path.join(FIX, "spec.json")) as f:
        return json.load(f)


class SelectTests(unittest.TestCase):
    def test_exclusion_reasons(self):
        record, _ = st.draw(spec(), "seed-a", EXPORTS)
        reasons = {(c["repository"], c["number"]): c["excluded"] for c in record["candidates"]}
        w = "example-org/widgets"
        self.assertIsNone(reasons[(w, 1)])
        self.assertEqual(reasons[(w, 2)], "author-kind")
        self.assertEqual(reasons[(w, 3)], "title-pattern")
        self.assertEqual(reasons[(w, 4)], "no-code-drift-reads")
        self.assertEqual(reasons[(w, 5)], "no-linked-issue")
        self.assertEqual(reasons[(w, 6)], "issue-too-short")
        self.assertEqual(reasons[(w, 7)], "size")
        self.assertIsNone(reasons[(w, 8)])
        self.assertEqual(reasons[(w, 9)], "outside-dates")
        self.assertEqual(reasons[(w, 10)], "issue-holds-diff")
        self.assertEqual(reasons[(w, 11)], "issue-after-merge")
        self.assertEqual(record["eligible_per_repo"], {"example-org/gadgets": 6, "example-org/widgets": 6})

    def test_counts_and_quota(self):
        record, tasks = st.draw(spec(), "seed-a", EXPORTS)
        self.assertEqual(len(tasks), 7)
        per = {}
        for t in tasks:
            per[t["repository"]] = per.get(t["repository"], 0) + 1
        # 3 per repo, plus one refill from the leftovers in seeded order
        self.assertEqual(sorted(per.values()), [3, 4])
        self.assertEqual(len(record["reserves"]), 2)
        drawn = {(t["repository"], t["pr_number"]) for t in tasks}
        for r in record["reserves"]:
            self.assertNotIn((r["repository"], r["number"]), drawn)
        self.assertEqual([t["draw"]["rank"] for t in tasks], list(range(1, 8)))

    def test_deterministic_and_seed_dependent(self):
        a = st.draw(spec(), "seed-a", EXPORTS)
        b = st.draw(spec(), "seed-a", list(reversed(EXPORTS)))
        self.assertEqual(a, b)
        c = st.draw(spec(), "seed-b", EXPORTS)
        self.assertNotEqual([t["id"] for t in a[1]], [t["id"] for t in c[1]])

    def test_stripping(self):
        pr = {"number": 8, "merge_commit": "abcdef1234567890abcdef1234567890abcdef12", "commits": []}
        text = ("Fixed by https://github.com/example-org/widgets/pull/8 and example-org/widgets#8 "
                "(see #8, commit abcdef123). Unrelated #80 and https://example.invalid/docs and deadbeef1.")
        out, log = st.strip_fix_links(text, "example-org/widgets", pr)
        self.assertNotIn("/pull/8", out)
        self.assertNotIn("abcdef123", out)
        self.assertNotIn("#8 ", out)
        self.assertIn("#80", out)
        self.assertIn("https://example.invalid/docs", out)
        self.assertIn("deadbeef1", out)
        self.assertEqual(sorted(e["rule"] for e in log), ["ref-to-pr", "ref-to-pr", "sha-of-fix", "url-to-fix"])

    def test_prompt_and_schema(self):
        _, tasks = st.draw(spec(), "seed-a", EXPORTS)
        with open(os.path.join(ROOT, "tasks", "schema.json")) as f:
            schema = json.load(f)
        for t in tasks:
            self.assertEqual(bl.validate(t, schema), [], t["id"])
            self.assertTrue(t["prompt"].startswith("Resolve the following issue"))
            self.assertNotIn("totals.ts", t["prompt"])  # hidden files are not in the prompt
        eight = [t for t in tasks if t["pr_number"] == 8]
        for t in eight:
            self.assertIn("[link removed]", t["prompt"])
            self.assertNotIn(t["merge_commit"][:9], t["prompt"])

    def test_cli_draw_and_verify(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "sel")
            self.assertEqual(st.main(["draw", "--spec", os.path.join(FIX, "spec.json"), "--seed", "seed-a", "--out", out] + EXPORTS), 0)
            # filling the post-draw fields does not break verify
            p = os.path.join(out, "tasks", sorted(os.listdir(os.path.join(out, "tasks")))[0])
            with open(p) as f:
                t = json.load(f)
            t["test_command"] = "npm test"
            t["hidden"]["reference_diff"] = "reference/x.diff"
            bl.dump_json(p, t)
            self.assertEqual(st.main(["verify", "--out", out] + EXPORTS), 0)
            # an edited prompt does
            t["prompt"] += " (edited)"
            bl.dump_json(p, t)
            self.assertEqual(st.main(["verify", "--out", out] + EXPORTS), 1)
            with self.assertRaises(SystemExit):
                st.main(["draw", "--spec", os.path.join(FIX, "spec.json"), "--seed", "seed-a", "--out", out] + EXPORTS)


if __name__ == "__main__":
    unittest.main()
