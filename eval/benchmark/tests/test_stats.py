"""Unit tests for the pre-registered statistics and the diff blinding."""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import benchlib as bl  # noqa: E402
import grade  # noqa: E402


class StatsTests(unittest.TestCase):
    def test_wilcoxon_exact_known_values(self):
        # all five differences positive: 2 of 32 sign patterns are as extreme
        self.assertAlmostEqual(bl.wilcoxon_signed_rank([1, 2, 3, 4, 5])["p"], 2 / 32)
        # zeros are dropped, ties share midranks, symmetric data gives p = 1
        r = bl.wilcoxon_signed_rank([0, 1, -1, 2, -2])
        self.assertEqual(r["zeros"], 1)
        self.assertAlmostEqual(r["p"], 1.0)
        # exact and normal agree roughly at moderate n
        d = [0.5, -0.2, 1.1, 0.9, 0.3, -0.4, 1.5, 0.8, 0.7, 1.2, -0.1, 0.6]
        self.assertLess(abs(bl.wilcoxon_signed_rank(d)["p"] - bl.wilcoxon_signed_rank(d, exact=False)["p"]), 0.02)

    def test_kappa(self):
        self.assertAlmostEqual(bl.cohen_kappa([1, 0, 1, 0], [1, 0, 1, 0]), 1.0)
        # textbook 2x2: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no -> 0.4
        a = [1] * 25 + [0] * 25
        b = [1] * 20 + [0] * 5 + [1] * 10 + [0] * 15
        self.assertAlmostEqual(bl.cohen_kappa(a, b, (0, 1)), 0.4)
        self.assertGreater(bl.cohen_kappa([0, 1, 2, 3], [0, 1, 3, 3], (0, 1, 2, 3), "quadratic"),
                           bl.cohen_kappa([0, 1, 2, 3], [0, 1, 3, 3], (0, 1, 2, 3)))

    def test_holm(self):
        adj = bl.holm({"a": 0.01, "b": 0.04, "c": 0.03})
        self.assertAlmostEqual(adj["a"], 0.03)
        self.assertAlmostEqual(adj["c"], 0.06)
        self.assertAlmostEqual(adj["b"], 0.06)

    def test_t_and_bootstrap_deterministic(self):
        self.assertAlmostEqual(bl.t_ppf(0.975, 24), 2.0639, places=3)
        d = [0.1, -0.2, 0.3, 0.0, 0.2]
        self.assertEqual(bl.bootstrap_ci(d, "s", reps=500), bl.bootstrap_ci(d, "s", reps=500))
        self.assertNotEqual(bl.bootstrap_ci(d, "s", reps=500), bl.bootstrap_ci(d, "t", reps=500))

    def test_blind_diff(self):
        cfg = {"instructions_file": "AGENTS.md", "hooks": {"files": [{"src": "x", "dest": ".agent/hooks.json"}]}}
        diff = (
            "diff --git a/AGENTS.md b/AGENTS.md\n--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ -1 +1,2 @@\n x\n+y\n"
            "diff --git a/pkg/CLAUDE.md b/pkg/CLAUDE.md\n+z\n"
            "diff --git a/.drift/conventions.yaml b/.drift/conventions.yaml\n+q\n"
            "diff --git a/.agent/hooks.json b/.agent/hooks.json\n+h\n"
            "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,3 @@\n"
            "+// drift-ignore D-1: reason\n+export const a = 1;\n"
        )
        out, stats = grade.blind_diff(diff, cfg)
        self.assertEqual(sorted(stats["files_dropped"]), [".agent/hooks.json", ".drift/conventions.yaml", "AGENTS.md", "pkg/CLAUDE.md"])
        self.assertEqual(stats["suppression_lines_dropped"], 1)
        self.assertIn("export const a = 1;", out)
        self.assertNotIn("drift", out.lower())


if __name__ == "__main__":
    unittest.main()
