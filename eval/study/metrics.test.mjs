// metrics.mjs per-language and per-framework tier tables, on a synthetic run (no repo, no drift binary).
//
//   node --test eval/study/metrics.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { COURSE_MATERIAL, NOT_WRONG_CRITERION, TARGET, clusterBootstrap, clusterT, familyOf, tierOf, wilson } from "./lib.mjs";
import { APPROVED_RUBRIC } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "metrics-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// A fixed rule-kind tier: rule 5 as pre-registered (the dev runs' rule-5 view copied it). The expectations below
// were worked out by hand under it. The primary manifests now hold D5 (tier-d5.json), whose definition
// tier.test.mjs checks; this file tests the tables, which do not depend on which rule-kind tier is used.
const { tier } = JSON.parse(readFileSync(join(here, "runs", "dev-py-r2-2026-11-05", "views", "rule5", "run.json"), "utf8")).params;
const R = {
  call: { type: "wrapped_by", kind: "call", any_of: ["withAuth"] },
  jsx: { type: "wrapped_by", kind: "jsx", any_of: ["Layout"] },
  decorator: { type: "wrapped_by", kind: "decorator", any_of: ["login_required"] },
  extends: { type: "wrapped_by", kind: "extends", any_of: ["BaseView"] },
  try: { type: "wrapped_by", kind: "try" },
  key: { type: "passes_key", key: "schema" },
  importAvoid: { type: "avoids", signal: "import:app/db/**" },
  anyAvoid: { type: "avoids", signal: "any" },
  calls: { type: "calls", target: "log" },
  named: { type: "named", pattern: "*Serializer" },
  renders: { type: "renders", component: "Button" },
};
// [repo, id, rule, members, label]; label null = unlabelled (counts as WRONG over all shown).
const ITEMS = [
  ["ts-a", "D-a1", R.call, 40, "ACCEPT"], //        default
  ["ts-a", "D-a2", R.key, 20, "WRONG"], //          default
  ["ts-a", "D-a3", R.calls, 50, "TRIVIAL"], //      suggestion: kind
  ["ts-a", "D-a4", R.jsx, 14, "ACCEPT"], //         suggestion: default kind, role under 15 members
  ["ts-b", "D-b1", R.importAvoid, 30, "ACCEPT"], // default
  ["ts-b", "D-b2", R.anyAvoid, 30, "WRONG"], //     suggestion: avoids:other
  ["ts-b", "D-b3", null, 99, null], //              suggestion: no structured rule; unlabelled
  ["py-c", "D-c1", R.decorator, 15, "ACCEPT"], //   default (exactly 15)
  ["py-c", "D-c2", R.extends, 16, "TRIVIAL"], //    default
  ["py-c", "D-c3", R.named, 20, "ACCEPT"], //       suggestion
  ["py-d", "D-d1", R.renders, 100, "ACCEPT"], //    default
  ["py-d", "D-d2", R.try, 100, "TRIVIAL"], //       suggestion: unmeasured kind
];
const REPOS = [
  { name: "ts-a", language: "TypeScript", framework_bucket: "nextjs" },
  { name: "ts-b", language: "JavaScript", framework_bucket: "nestjs" },
  { name: "py-c", language: "Python", framework_bucket: "django" },
  { name: "py-d", language: "Python", framework_bucket: "django" },
  { name: "py-e", language: "Python", framework_bucket: "flask" }, // no proposals: a zero-yield cluster
];

// `example`: each item's example path; by default a .py file in the py-* repos, so the convention's language
// (what metrics.mjs groups by, decision D7) matches the repo's.
function writeRun(dir, { repos = REPOS, manifestLanguage = null, manifest = {}, params = {}, label = (l) => l, record = () => ({}), example = (repo) => (repo.startsWith("py-") ? "x.py#x" : "x.ts#x") } = {}) {
  mkdirSync(dir, { recursive: true });
  const items = ITEMS.map(([repo, id, rule, members, _label], rank) => {
    const q = { uid: `${repo}/${id}`, repo, id, rank: rank + 1, summary: `synthetic ${id}`, role: null, rule, evidence: { total: members }, members, example: example(repo), outliers: 0, outlier_files: [], block: id };
    q.family = familyOf(q);
    return q;
  });
  writeFileSync(
    join(dir, "run.json"),
    JSON.stringify({
      run: dir,
      manifest: { path: join(dir, "manifest.json"), holdout: false, role: "dev", language: manifestLanguage, ...manifest },
      drift: { version: "drift synthetic", commit: "0".repeat(40), binary_sha256: "0".repeat(64) },
      params: { max: 15, pool: 200, tier, exposed: [], ...params },
      repos: repos.map((r) => ({ ...r, status: "ok" })),
    }),
  );
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ run: dir, items }));
  const labels = ITEMS.filter((x) => x[4]).map(([repo, id, , , l]) => ({ uid: `${repo}/${id}`, repo, id, label: label(l, `${repo}/${id}`), source: "agreed", rubric: APPROVED_RUBRIC.version, rubric_sha256: APPROVED_RUBRIC.sha256, ...record(`${repo}/${id}`) }));
  writeFileSync(join(dir, "final.jsonl"), labels.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return items;
}

function metrics(dir, ...extra) {
  const out = join(dir, "metrics.json");
  const r = spawnSync(process.execPath, [join(here, "metrics.mjs"), "--run", dir, "--json", out, ...extra], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { md: r.stdout, json: JSON.parse(readFileSync(out, "utf8")) };
}

const items = writeRun(join(tmp, "run"));
const { md, json } = metrics(join(tmp, "run"));

// Expected, by hand, from ITEMS and tierOf (rule 5): [shown, labelled, ACCEPT, TRIVIAL, WRONG].
const EXPECT = {
  "typescript/javascript": { repos: ["ts-a", "ts-b"], default_tier: [3, 3, 2, 0, 1], suggestion_tier: [4, 3, 1, 1, 1], overall: [7, 6, 3, 1, 2] },
  python: { repos: ["py-c", "py-d", "py-e"], default_tier: [3, 3, 2, 1, 0], suggestion_tier: [2, 2, 1, 1, 0], overall: [5, 5, 3, 2, 0] },
};

test("the fixture's tiers are tierOf under the pre-registered tier", () => {
  const def = items.filter((p) => tierOf(p, tier) === "default").map((p) => p.id);
  assert.deepEqual(def, ["D-a1", "D-a2", "D-b1", "D-c1", "D-c2", "D-d1"]);
  assert.equal(json.tier.pre_registered, true);
  assert.deepEqual(json.tier.unkinded, ["ts-b/D-b3"]);
});

test("per-language tables: counts per tier, rates over all shown (unlabelled = WRONG)", () => {
  assert.deepEqual(json.by_language.map((g) => g.language), Object.keys(EXPECT));
  for (const g of json.by_language) {
    const e = EXPECT[g.language];
    assert.deepEqual(g.repos, e.repos);
    for (const t of ["default_tier", "suggestion_tier", "overall"]) {
      const s = g[t];
      assert.deepEqual([s.shown, s.labelled, s.ACCEPT, s.TRIVIAL, s.WRONG], e[t], `${g.language} ${t}`);
      const w = wilson(s.ACCEPT, s.shown);
      assert.equal(s.accept_shown.p, w.p);
      assert.equal(s.accept_shown.lo, w.lo);
      assert.equal(s.accept_shown.hi, w.hi);
      assert.equal(s.not_wrong_shown.p, wilson(s.ACCEPT + s.TRIVIAL, s.shown).p);
    }
  }
  // the overall tiers are the sum of the languages
  for (const t of ["default_tier", "suggestion_tier"]) {
    const top = json[t];
    assert.equal(top.shown, json.by_language.reduce((a, g) => a + g[t].shown, 0));
    assert.equal(top.ACCEPT, json.by_language.reduce((a, g) => a + g[t].ACCEPT, 0));
  }
});

test("cluster intervals resample this language's repos only", () => {
  const ts = json.by_language.find((g) => g.language === "typescript/javascript");
  // default tier, accept over shown: ts-a 1/2, ts-b 1/1
  const cl = [{ k: 1, n: 2 }, { k: 1, n: 1 }];
  assert.deepEqual(ts.default_tier.accept_shown.boot, clusterBootstrap(cl));
  assert.deepEqual(ts.default_tier.accept_shown.t, clusterT(cl));
  assert.equal(ts.default_tier.accept_shown.boot.clusters, 2);
  // python not-wrong over all shown: py-c 3/3, py-d 2/2; py-e has no proposals and is not a cluster of a ratio
  const py = json.by_language.find((g) => g.language === "python");
  assert.deepEqual(py.overall.not_wrong_shown.boot, clusterBootstrap([{ k: 3, n: 3 }, { k: 2, n: 2 }, { k: 0, n: 0 }]));
  assert.equal(py.overall.not_wrong_shown.boot.clusters, 2);
  // ...but it is a repo with zero yield
  assert.deepEqual([py.overall.yield.repos, py.overall.yield.zero, py.overall.yield.total], [3, 1, 3]);
});

test("per-framework table follows the manifest's framework_bucket", () => {
  assert.deepEqual(
    json.by_framework.map((g) => [g.language, g.framework_bucket, g.repos, g.default_tier.shown, g.default_tier.ACCEPT, g.overall.shown]),
    [
      ["typescript/javascript", "nextjs", ["ts-a"], 2, 1, 4],
      ["typescript/javascript", "nestjs", ["ts-b"], 1, 1, 3],
      ["python", "django", ["py-c", "py-d"], 3, 2, 5],
      ["python", "flask", ["py-e"], 0, 0, 0],
    ],
  );
  assert.deepEqual(json.repos.map((r) => [r.name, r.language, r.framework_bucket]), REPOS.map((r) => [r.name, r.language === "Python" ? "python" : "typescript/javascript", r.framework_bucket]));
});

test("per rule family within a language: counts per tier and both cluster intervals over that family's repos", () => {
  const label = new Map(ITEMS.map(([repo, id, , , l]) => [`${repo}/${id}`, l]));
  const lang = (p) => (p.repo.startsWith("py-") ? "python" : "typescript/javascript");
  for (const g of json.by_language) {
    const mine = items.filter((p) => lang(p) === g.language);
    assert.deepEqual(g.families.map((f) => f.family).sort(), [...new Set(mine.map((p) => p.family))].sort());
    for (const f of g.families) {
      for (const [t, pick] of [["default_tier", (p) => tierOf(p, tier) === "default"], ["suggestion_tier", (p) => tierOf(p, tier) !== "default"], ["overall", () => true]]) {
        const sel = mine.filter((p) => p.family === f.family && pick(p));
        const s = f[t];
        assert.equal(s.shown, sel.length, `${g.language} ${f.family} ${t}`);
        assert.equal(s.ACCEPT, sel.filter((p) => label.get(p.uid) === "ACCEPT").length);
        // the clusters are the language's repos; empty ones drop out of the ratio intervals
        const cl = g.repos.map((r) => ({ k: sel.filter((p) => p.repo === r && label.get(p.uid) === "ACCEPT").length, n: sel.filter((p) => p.repo === r).length }));
        const asJson = (x) => JSON.parse(JSON.stringify(x)); // NaN (fewer than 2 clusters) is null in metrics.json
        assert.deepEqual(s.accept_shown.boot, asJson(clusterBootstrap(cl)));
        assert.deepEqual(s.accept_shown.t, asJson(clusterT(cl)));
        assert.deepEqual([s.accept_shown.p, s.accept_shown.lo, s.accept_shown.hi], sel.length ? [wilson(s.ACCEPT, sel.length).p, wilson(s.ACCEPT, sel.length).lo, wilson(s.ACCEPT, sel.length).hi] : [null, null, null]);
      }
    }
  }
  // the TypeScript default tier, by family: call wrappers (ts-a 1/1), argument keys (ts-a 0/1), layering (ts-b 1/1)
  const ts = json.by_language.find((g) => g.language === "typescript/javascript");
  assert.deepEqual(ts.families.filter((f) => f.default_tier.shown).map((f) => [f.family, f.default_tier.shown, f.default_tier.ACCEPT, f.default_tier.accept_shown.boot.clusters]), [
    ["wrapper", 1, 1, 1],
    ["argument_key", 1, 0, 1],
    ["layering", 1, 1, 1],
  ]);
  assert.match(md, /## Per language, tier and rule family/);
  assert.match(md, /\| typescript\/javascript \| Call wrappers \| Default tier \| 1 \| 1 \| 0 \| 0 \| 100\.0% \[.*\(1 repo: no cluster interval\)/);
  assert.match(md, /\| python \| Base classes \| Default tier \| 1 \| 0 \| 1 \| 0 \|/);
});

test("markdown: per-language rows for both tiers and all shown, targets in bold", () => {
  assert.match(md, /## Per language and tier/);
  const rows = md.split("\n").filter((l) => /^\| (typescript\/javascript|python|all languages \(pooled, secondary\)) \| (Default tier|Suggestion tier|All shown)/.test(l));
  assert.equal(rows.length, 9); // 2 languages + all languages, 3 rows each
  const tsDefault = rows.find((l) => l.startsWith("| typescript/javascript | Default tier |"));
  assert.match(tsDefault, /\| 2 \| 3 \| 3 \| 2 \| 0 \| 1 \| \*\*66\.7% \[/);
  // D1: the bold default-tier cell states the criterion; a dev run gets no verdict
  assert.match(tsDefault, /target met when the point estimate, per language, is ≥ 95% \(decision D1, 2026-11-05\): \*\*no verdict \(not a primary held-out run\)\*\*/);
  const pooledDefault = rows.find((l) => l.startsWith("| all languages (pooled, secondary) | Default tier |"));
  assert.doesNotMatch(pooledDefault, /\*\*|target/);
  const pyAll = rows.find((l) => l.startsWith("| python | All shown (both tiers) |"));
  assert.match(pyAll, /\*\*100\.0% \[.*\(2 repos: bootstrap/);
  assert.match(md, /## Per framework bucket/);
  assert.match(md, /\| python \| django \| 2 \| 5 \| 3 \| 66\.7%/);
});

test("a single-language run without buckets: one language from the manifest, no framework table", () => {
  const dir = join(tmp, "plain");
  writeRun(dir, { repos: REPOS.map(({ name }) => ({ name })), manifestLanguage: "typescript/javascript", example: () => "x.ts#x" });
  const r = metrics(dir);
  assert.deepEqual(r.json.by_language.map((g) => [g.language, g.overall.shown]), [["typescript/javascript", 12]]);
  assert.deepEqual(r.json.by_framework, []);
  assert.doesNotMatch(r.md, /## Per framework bucket/);
  assert.doesNotMatch(r.md, /\| all languages/);
});

test("D1: a primary held-out run gets a verdict per language on the point estimate; pooled rows get none", () => {
  const dir = join(tmp, "primary");
  // every default-tier proposal of python ACCEPT (3/3 = 100%); typescript/javascript stays at 2/3
  writeRun(dir, { manifest: { holdout: true, role: "primary", set_id: "synthetic-primary" }, label: (l, uid) => (uid === "py-c/D-c2" ? "ACCEPT" : l) });
  const r = metrics(dir);
  assert.equal(r.json.headline_eligible, true);
  assert.deepEqual(r.json.by_language.map((g) => [g.language, g.target.default_tier_accept, g.target.met]), [
    ["typescript/javascript", 2 / 3, false],
    ["python", 1, true],
  ]);
  assert.match(r.md, /\| python \| Default tier \|.*\*\*100\.0% \[.*; target met when the point estimate, per language, is ≥ 95% \(decision D1, 2026-11-05\): \*\*MET\*\*/);
  assert.match(r.md, /\| typescript\/javascript \| Default tier \|.*: \*\*NOT MET\*\*/);
  // the point estimate decides, not the interval: python's Wilson lower bound is far below 95%
  assert.ok(r.json.by_language[1].default_tier.accept_shown.lo < TARGET);
  assert.doesNotMatch(r.md.split("\n").find((l) => l.startsWith("| all languages (pooled, secondary) | Default tier |")), /MET/);
});

test("D4: the not-wrong target is judged like D1: point estimate per language, verdict on primary runs only", () => {
  const cell = (md, lang) => md.split("\n").find((l) => l.startsWith(`| ${lang} | All shown (both tiers) |`));
  // dev run: criterion stated, no verdict
  const dev = metrics(join(tmp, "run"));
  assert.ok(cell(dev.md, "python").includes(`; target ${NOT_WRONG_CRITERION}: **no verdict (not a primary held-out run)**`));
  assert.deepEqual(dev.json.by_language.map((g) => [g.language, g.not_wrong_target.not_wrong, g.not_wrong_target.met]), [
    ["typescript/javascript", 4 / 7, null],
    ["python", 1, null],
  ]);
  // primary held-out run: python not-wrong 5/5 = 100% MET, typescript/javascript 4/7 NOT MET
  const dir = join(tmp, "primary-nw");
  writeRun(dir, { manifest: { holdout: true, role: "primary", set_id: "synthetic-primary" } });
  const r = metrics(dir);
  assert.deepEqual(r.json.by_language.map((g) => [g.not_wrong_target.criterion, g.not_wrong_target.met]), [
    [NOT_WRONG_CRITERION, false],
    [NOT_WRONG_CRITERION, true],
  ]);
  assert.match(cell(r.md, "python"), /\*\*100\.0% \[.*\(decision D4, 2026-11-05\): \*\*MET\*\*/);
  assert.match(cell(r.md, "typescript/javascript"), /\(decision D4, 2026-11-05\): \*\*NOT MET\*\*/);
  // the pooled row is secondary: no bold, no verdict
  assert.doesNotMatch(cell(r.md, "all languages (pooled, secondary)"), /\*\*|MET|target/);
});

test("D1/D4: a language with no default-tier proposals gets no verdict, in the markdown as in the JSON", () => {
  const dir = join(tmp, "primary-empty");
  writeRun(dir, { manifest: { holdout: true, role: "primary", set_id: "synthetic-primary" } });
  const q = JSON.parse(readFileSync(join(dir, "queue.json"), "utf8"));
  q.items = q.items.filter((p) => !(p.repo.startsWith("py-") && tierOf(p, tier) === "default"));
  writeFileSync(join(dir, "queue.json"), JSON.stringify(q));
  const r = metrics(dir);
  const py = r.json.by_language.find((g) => g.language === "python");
  assert.deepEqual([py.default_tier.shown, py.target.default_tier_accept, py.target.met], [0, null, null]);
  const row = r.md.split("\n").find((l) => l.startsWith("| python | Default tier |"));
  assert.match(row, /\*\*no verdict \(no default-tier proposals, n = 0\)\*\*/);
  assert.doesNotMatch(row, /MET/);
  assert.equal(py.not_wrong_target.met, true); // its suggestion-tier proposals are still judged (2/2 not wrong)
});

test("D2: the set's course-material repos stay in, and a sensitivity table repeats the rates without them", () => {
  for (const [set, names] of Object.entries(COURSE_MATERIAL)) {
    const file = { "ts-primary-2026-11-05": "holdout-primary.json", "py-primary-2026-11-05": "holdout-primary-py.json" }[set];
    const m = JSON.parse(readFileSync(join(here, "..", file), "utf8"));
    assert.equal(m.set_id, set);
    for (const n of names) assert.ok(m.repos.some((r) => r.name === n), `${n} is a primary of ${set}`);
  }
  const dir = join(tmp, "sens");
  writeRun(dir);
  const r = metrics(dir, "--without", "ts-b,not-in-run");
  assert.deepEqual(r.json.sensitivity.without, ["ts-b"]);
  const ts = r.json.sensitivity.by_language.find((g) => g.language === "typescript/javascript");
  assert.deepEqual([ts.removed, ts.with.repos, ts.without.repos], [["ts-b"], ["ts-a", "ts-b"], ["ts-a"]]);
  assert.deepEqual([ts.with.default_tier.shown, ts.without.default_tier.shown, ts.without.default_tier.ACCEPT], [3, 2, 1]);
  // the headline tables are unchanged: the repos stay in
  assert.deepEqual(r.json.by_language.map((g) => g.overall.shown), [7, 5]);
  assert.match(r.md, /## Sensitivity: without ts-b \(decision D2\)/);
  assert.match(r.md, /\| python \| 3 \| without \(none of them in this language\) \|/);
});

test("D3: a repo whose census failed is reported as a failure and the run continues", () => {
  const dir = join(tmp, "failed");
  writeRun(dir);
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  run.repos.push({ name: "broken", language: "Python", framework_bucket: "flask", status: "ERROR: drift census failed (101)" });
  writeFileSync(join(dir, "run.json"), JSON.stringify(run));
  const r = metrics(dir);
  assert.deepEqual(r.json.failed_repos, [{ name: "broken", status: "ERROR: drift census failed (101)" }]);
  assert.match(r.md, /\*\*1 repos failed\*\* \(decision D3: reported as failures, not swapped; the run continues with the rest\): broken/);
  assert.deepEqual(r.json.by_language.map((g) => g.repos), [["ts-a", "ts-b"], ["py-c", "py-d", "py-e"]]);
});

test("a held-out run whose labels name another rubric text is refused (the D6 pin)", () => {
  const dir = join(tmp, "pin");
  writeRun(dir, { manifest: { holdout: true, role: "primary", set_id: "synthetic-primary" } });
  const f = join(dir, "final.jsonl");
  writeFileSync(f, readFileSync(f, "utf8").replace(new RegExp(APPROVED_RUBRIC.sha256, "g"), "f".repeat(64)));
  const r = spawnSync(process.execPath, [join(here, "metrics.mjs"), "--run", dir], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /held-out run: its labels are not all under the rubric text approved with decision D6/);
});

test("metrics.json marks calibration runs (run.json `calibration`) and ordinary runs", () => {
  const dir = join(tmp, "calib", "ts");
  writeRun(dir);
  const score = () => {
    const out = join(dir, "metrics.json");
    const r = spawnSync(process.execPath, [join(here, "metrics.mjs"), "--run", dir, "--json", out], { encoding: "utf8" });
    return { r, m: r.status === 0 ? JSON.parse(readFileSync(out, "utf8")) : null };
  };
  assert.equal(score().m.kind, "precision");
  assert.equal(score().m.calibration, undefined);
  const runPath = join(dir, "run.json");
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  // `calibration: true` takes the default locations: <run>/../shift.json and <run>/agreement.json
  writeFileSync(runPath, JSON.stringify({ ...run, run: dir, calibration: true }));
  assert.equal(score().r.status, 2, "missing files are refused");
  writeFileSync(join(dir, "..", "shift.json"), "{}\n");
  writeFileSync(join(dir, "agreement.json"), "{}\n");
  const { m } = score();
  assert.equal(m.kind, "calibration");
  assert.deepEqual(m.calibration, { shift: join(dir, "..", "shift.json"), agreement: join(dir, "agreement.json") });
  // explicit paths, as stage.mjs writes them
  writeFileSync(runPath, JSON.stringify({ ...run, run: dir, calibration: { shift: join(dir, "..", "shift.json"), agreement: join(dir, "agreement.json") } }));
  assert.equal(score().m.kind, "calibration");
});

test("D7: rows are by the convention's language, not the repo's; only the set's language gets a verdict", () => {
  const dir = join(tmp, "by-convention");
  // A Python primary set whose py-d proposals are its frontend's TypeScript rules, and one py-c rule whose
  // example is TypeScript but whose role has a Python member (python_members): that one counts as Python.
  const repos = REPOS.filter((r) => r.name.startsWith("py-"));
  const items = writeRun(dir, { repos, manifestLanguage: "python", manifest: { holdout: true, role: "primary", set_id: "synthetic-py" }, example: (repo) => (repo === "py-d" ? "web/x.tsx#X" : "x.ts#x") });
  const q = JSON.parse(readFileSync(join(dir, "queue.json"), "utf8"));
  q.items = q.items.filter((p) => p.repo.startsWith("py-")).map((p) => (p.repo === "py-c" ? { ...p, python_members: 1 } : p));
  writeFileSync(join(dir, "queue.json"), JSON.stringify(q));
  assert.ok(items.length > 0);
  const r = metrics(dir);
  const by = Object.fromEntries(r.json.by_language.map((g) => [g.language, g]));
  assert.deepEqual(Object.keys(by), ["typescript/javascript", "python"]);
  assert.deepEqual([by.python.repos, by.python.overall.shown], [["py-c", "py-d", "py-e"], 3]);
  assert.deepEqual([by["typescript/javascript"].repos, by["typescript/javascript"].overall.shown], [["py-d"], 2]);
  assert.equal(by["typescript/javascript"].set_language, false);
  assert.equal(by["typescript/javascript"].target.met, null, "another set's language: no verdict");
  assert.equal(by.python.set_language, true);
  assert.match(r.md, /no verdict \(not this set's language\)/);
});


// ---------------------------------------------------------------------------------------------------------
// PLAN-R14 WS-F (F3, F4, F1)
// ---------------------------------------------------------------------------------------------------------
test("F3: every pooled rate quotes the widest of Wilson, bootstrap and cluster-t, never narrower than a cluster interval", () => {
  for (const g of json.by_language)
    for (const t of ["default_tier", "suggestion_tier", "overall"])
      for (const k of ["accept_shown", "not_wrong_shown"]) {
        const r = g[t][k];
        if (!Number.isFinite(r.p)) continue;
        const width = (x) => (Number.isFinite(x?.lo) ? x.hi - x.lo : 0);
        assert.ok(width(r.quoted) >= width(r.boot) - 1e-12 && width(r.quoted) >= width(r.t) - 1e-12 && width(r.quoted) >= width(r) - 1e-12, `${g.language} ${t} ${k}`);
      }
});

test("F3: D1 on a run prepared under F3 needs n >= 30 and the quoted lower bound >= 95%: 3/3 is not met; a past run keeps the point estimate", () => {
  const dir = join(tmp, "primary-f3");
  writeRun(dir, { manifest: { holdout: true, role: "primary", set_id: "synthetic-primary" }, params: { decisions: ["F3"] }, label: (l, uid) => (uid === "py-c/D-c2" ? "ACCEPT" : l) });
  const r = metrics(dir);
  const py = r.json.by_language.find((g) => g.language === "python");
  assert.equal(py.target.default_tier_accept, 1);
  assert.equal(py.target.met, false, "n = 3 < 30");
  assert.equal(py.target.rule, "F3");
  assert.match(r.md, /minimum n 30 and the quoted lower bound/);
});

test("F4: every rate is also reported with adjudicated items counted as WRONG", () => {
  const dir = join(tmp, "adjudicated");
  writeRun(dir, { record: (uid) => (uid === "py-c/D-c1" ? { source: "adjudicated", C: "ACCEPT", sided_with: "A" } : {}) });
  const r = metrics(dir);
  const py = r.json.by_language.find((g) => g.language === "python");
  const adj = r.json.adjudicated_as_wrong.by_language.find((g) => g.language === "python");
  assert.equal(r.json.adjudicated_as_wrong.adjudicated, 1);
  assert.equal(adj.default_tier.accept_shown.k, py.default_tier.accept_shown.k - 1);
  assert.match(r.md, /adjudicated items counted as WRONG/);
});

test("F1: v3 and v4 labels are never mixed in one rate", () => {
  const dir = join(tmp, "mixed");
  writeRun(dir, { record: (uid) => (uid.startsWith("py-") ? { rubric: "v4", rubric_sha256: "1".repeat(64) } : {}) });
  const r = spawnSync(process.execPath, [join(here, "metrics.mjs"), "--run", dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /v4 labels are never mixed with earlier rubrics/);
});
