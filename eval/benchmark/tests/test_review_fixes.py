"""Pins two fixes from the code review of the map-to-enforcement sprint.

    BENCH_SCRATCH=/some/scratch/dir python3 -I -m unittest discover -s eval/benchmark/tests

- An attempt directory left by an interrupted run is moved aside, never reused, so
  the retry cannot read the old transcript or usage (and count the old cost).
- The hooks arm refuses a destination that leaves the working copy through a
  symbolic link in the task repository (`.claude -> ../..`).
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import harness  # noqa: E402


class AttemptDir(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="bench-attempt-", dir=os.environ.get("BENCH_SCRATCH"))

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_an_interrupted_attempt_is_moved_aside(self):
        a1 = os.path.join(self.base, "runs", "0123456789abcdef", "a1")
        os.makedirs(a1)
        with open(os.path.join(a1, "usage.json"), "w") as f:
            f.write('{"cost": 9.5}\n')
        harness.fresh_attempt_dir(a1)
        self.assertEqual(os.listdir(a1), [])
        with open(os.path.join(a1 + ".stale-1", "usage.json")) as f:
            self.assertIn("9.5", f.read())
        # a second interruption keeps both earlier directories
        open(os.path.join(a1, "transcript.jsonl"), "w").close()
        harness.fresh_attempt_dir(a1)
        self.assertEqual(os.listdir(a1), [])
        self.assertTrue(os.path.exists(os.path.join(a1 + ".stale-2", "transcript.jsonl")))


class HooksArm(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="bench-hooks-", dir=os.environ.get("BENCH_SCRATCH"))
        self.work = os.path.join(self.base, "work")
        self.run_dir = os.path.join(self.base, "run")
        self.outside = os.path.join(self.base, "outside")
        for d in (self.work, self.run_dir, self.outside):
            os.makedirs(d)
        self.src = os.path.join(self.base, "hooks.json")
        with open(self.src, "w") as f:
            f.write("{}\n")

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def arm(self, dest):
        env = dict(os.environ)
        env.update({
            "BENCH_DRIFT": os.path.join(ROOT, "dryrun", "fake_drift.py"),
            "BENCH_PYTHON": sys.executable,
            "BENCH_ARMS_DIR": os.path.join(ROOT, "arms"),
            "BENCH_INSTRUCTIONS_FILE": "AGENTS.md",
            "BENCH_ACCEPT_RULE": "none",
            "BENCH_ACCEPT_MODE": "advise",
            "BENCH_ACCEPT_LIST": "",
            "BENCH_HOOK_FILES": "%s=>%s" % (self.src, dest),
            "BENCH_HOOKS_WITH_AGENTS_MD": "0",
        })
        return subprocess.run(["bash", os.path.join(ROOT, "arms", "hooks.sh"), self.work, self.run_dir], env=env,
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def test_a_link_out_of_the_working_copy_is_refused(self):
        os.symlink(self.outside, os.path.join(self.work, ".claude"))
        p = self.arm(".claude/hooks/hooks.json")
        self.assertNotEqual(p.returncode, 0, p.stdout)
        self.assertEqual(os.listdir(self.outside), [])
        with open(os.path.join(self.run_dir, "arm.log")) as f:
            self.assertIn("leaves the working copy", f.read())

    def test_a_plain_destination_is_written(self):
        p = self.arm(".agent/hooks.json")
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertTrue(os.path.isfile(os.path.join(self.work, ".agent", "hooks.json")))


if __name__ == "__main__":
    unittest.main()
