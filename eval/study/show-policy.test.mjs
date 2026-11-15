// The show policy table (PLAN-R10 §4, WS-B): the committed crates/drift-mine/data/show-policy.json is exactly what
// show-policy.mjs gives for the run it names; a family is admitted only at >= 60% of >= 5 labelled suggestion-tier
// cards with every single dev repo left out, never when hidden (I1, I2); rule kinds map as the W0 table maps them
// (the Rust test `show::tests::committed_table_is_complete` reads the same file).
//
//   node --test eval/study/show-policy.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { kindFamilies } from "./family-admission.mjs";
import { BLIND_POOLS, blindPoolProblem, blindPoolsNamed, repoRootDir } from "./lib.mjs";
import { BAR, DEFAULT_OUT, EXCLUDED_REPOS, HIDDEN, MAX_OUTLIERS, loro, meets, runProblem, showTable } from "./show-policy.mjs";

const committed = JSON.parse(readFileSync(join(repoRootDir, DEFAULT_OUT), "utf8"));

test("the committed table is what its run gives (regenerate with the command it records)", () => {
  assert.match(committed.regenerate, /^node eval\/study\/show-policy\.mjs --run eval\/study\/runs\/dev-[\w.-]+$/);
  assert.equal(committed.source.run, committed.regenerate.split("--run ")[1]);
  assert.doesNotMatch(committed.source.run, /heldout|holdout/i);
  // The blind dev pools its counts come from (repos named `<pool>:<key>`) have each reported.
  const pools = blindPoolsNamed(Object.values(committed.languages).flatMap((fams) => Object.values(fams).flatMap((v) => Object.keys(v.repos))).join("\n"));
  assert.deepEqual(pools, ["dev3", "dev4"]);
  for (const p of pools) assert.equal(blindPoolProblem(p), null, p);
  assert.match(committed.source.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(showTable(committed.source.run), committed);
  const r = spawnSync(process.execPath, ["eval/study/show-policy.mjs", "--run", committed.source.run, "--check"], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // Every queue and label file it read is recorded with its hash.
  for (const p of committed.source.parts) {
    assert.match(p.queue, /\/views\/d7\/queue\.json$/);
    assert.match(p.labels, /\/final\.jsonl$/);
    assert.match(p.queue_sha256, /^[0-9a-f]{64}$/);
    assert.match(p.labels_sha256, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(committed.source.excluded_repos, EXCLUDED_REPOS);
});

test("the bar is 60% of at least 5, compared in integers, and the cap is one outlier", () => {
  assert.deepEqual(BAR, { min_accept: 0.6, min_cards: 5 });
  assert.equal(committed.bar.min_accept, 0.6);
  assert.equal(committed.bar.min_cards, 5);
  assert.equal(committed.bar.admission, "leave_one_repo_out_min");
  assert.equal(MAX_OUTLIERS, 1);
  assert.equal(committed.max_outliers, 1);
  assert.equal(meets(3, 5), true);
  assert.equal(meets(2, 4), false);
  assert.equal(meets(59, 100), false);
  assert.equal(meets(6, 10), true);
});

test("admission is the minimum over left-out repos", () => {
  // 12 of 17 pooled; without the repo that carries it, 4 of 9.
  assert.equal(loro({ a: { accepted: 8, n: 8 }, b: { accepted: 2, n: 5 }, c: { accepted: 2, n: 4 } }).admitted, false);
  assert.equal(loro({ a: { accepted: 3, n: 5 }, b: { accepted: 3, n: 5 } }).admitted, true);
  assert.equal(loro({ a: { accepted: 20, n: 20 } }).admitted, false);
  for (const [lang, fams] of Object.entries(committed.languages))
    for (const [f, v] of Object.entries(fams)) {
      const hidden = HIDDEN[lang].includes(f);
      assert.equal(v.hidden, hidden, `${lang} ${f}`);
      assert.equal(v.admitted, loro(v.repos).admitted && !hidden, `${lang} ${f}`);
      assert.equal(Object.values(v.repos).reduce((s, x) => s + x.n, 0), v.n, `${lang} ${f}`);
      assert.equal(Object.values(v.repos).reduce((s, x) => s + x.accepted, 0), v.accepted, `${lang} ${f}`);
      for (const r of EXCLUDED_REPOS) assert.equal(v.repos[r], undefined, `${lang} ${f} ${r}`);
    }
});

test("I1 and I2 are hidden; rule kinds map as the W0 table maps them", () => {
  assert.deepEqual(committed.hidden, { ts: ["calls", "ordering", "renders"], py: ["ordering", "repo"] });
  assert.deepEqual(committed.rule_kinds, kindFamilies());
  const w0 = JSON.parse(readFileSync(join(repoRootDir, "crates/drift-mine/data/family-admission.json"), "utf8"));
  assert.deepEqual(committed.rule_kinds, w0.rule_kinds);
  const admitted = (lang) => Object.entries(committed.languages[lang]).filter(([, v]) => v.admitted).map(([f]) => f);
  assert.deepEqual(admitted("ts"), ["control", "naming"]);
  // As generated from relabel 6 (the mined pool of the 50 Python build-set repos, every card labelled).
  assert.deepEqual(admitted("py"), ["control", "layering", "naming", "wrapper"]);
});

test("a blind dev pool is a source only once its report is in the tree; a held-out run never is", () => {
  const run = "eval/study/runs/dev-x-2026-01-01";
  const tree = (...files) => (p) => files.some((f) => p.split("\\").join("/").endsWith(f));
  // Reported pools: their cards may count, whatever the run is called.
  assert.equal(runProblem(run, ["netbox", "dev3:P04", "dev4:P10"], tree(BLIND_POOLS.dev3.report, BLIND_POOLS.dev4.report)), null);
  assert.equal(runProblem("eval/study/runs/dev-with-dev3-2026-01-01", [], tree(BLIND_POOLS.dev3.report)), null);
  // A pool whose report is not in the tree: refused, named by a repo or by the path.
  assert.match(runProblem(run, ["netbox", "dev3:P04", "dev4:P10"], tree(BLIND_POOLS.dev3.report)), /^dev4: a blind dev pool whose report \(.*dev4-check\.md\) is not in the tree/);
  assert.match(runProblem("eval/study/runs/dev-with-dev5-2026-01-01", [], tree(BLIND_POOLS.dev3.report, BLIND_POOLS.dev4.report)), /^dev5: a blind dev pool whose report/);
  // A pool the registry does not know has no report to find: refused even if every file exists.
  assert.match(runProblem(run, ["dev9:P01"], () => true), /^dev9: a blind dev pool this checkout does not know/);
  // Held-out: always, whatever is in the tree; and a path that is no dev run.
  for (const bad of ["eval/study/runs/dev-heldout2-2026-01-01", "eval/study/runs/dev-holdout-x", "eval/study/runs/heldout2-2026-11-08", "eval/study/runs/calib-v3-2026-11-06"]) assert.equal(runProblem(bad, [], () => true), "expected a dev build-set run under eval/study/runs", bad);
  // `dev-v3-...` names no pool.
  assert.deepEqual(blindPoolsNamed("eval/study/runs/dev-v3-relabel6-2026-11-10/py3/views/d7/queue.json"), []);
  assert.deepEqual(blindPoolsNamed("netbox\ndev4:P10\ndev3:P04\nx/dev3_census"), ["dev3", "dev4"]);
  // This tree: dev3, dev4 and dev5 (2026-11-11) have reported.
  assert.equal(blindPoolProblem("dev3"), null);
  assert.equal(blindPoolProblem("dev4"), null);
  assert.equal(blindPoolProblem("dev5"), null);
});

test("refuses held-out and non-dev runs by path", () => {
  for (const run of ["eval/study/runs/heldout2-2026-11-08", "eval/study/runs/dev3-2026-11-09", "eval/study/runs/calib-v3-2026-11-06"]) {
    const r = spawnSync(process.execPath, ["eval/study/show-policy.mjs", "--run", run, "--check"], { cwd: repoRootDir, encoding: "utf8" });
    assert.equal(r.status, 2, run);
    assert.match(r.stderr, /expected a dev build-set run/);
  }
});
