// The family admission table (W0): the committed crates/drift-mine/data/family-admission.json is exactly what
// family-admission.mjs gives for the run it names, admits only families at >= 85% of >= 10 labelled
// suggestion-tier cards, and maps rule kinds with lib.mjs familyOf (the Rust test
// `admission::tests::committed_table_is_complete` reads the same file).
//
//   node --test eval/study/family-admission.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_BAR, DEFAULT_OUT, admissionTable, admitted, kindFamilies, ruleOfKind } from "./family-admission.mjs";
import { RULE_KINDS, familyOf, repoRootDir, ruleKind, ruleKindFamily, studioFamilies } from "./lib.mjs";

const RULE_KIND_FAMILY = ruleKindFamily();
const STUDIO_FAMILIES = studioFamilies();

const committed = JSON.parse(readFileSync(join(repoRootDir, DEFAULT_OUT), "utf8"));

test("the committed table is what its run gives (regenerate with the command it records)", () => {
  assert.match(committed.regenerate, /^node eval\/study\/family-admission\.mjs --run eval\/study\/runs\/dev-[\w.-]+$/);
  assert.equal(committed.source.run, committed.regenerate.split("--run ")[1]);
  assert.match(committed.source.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(admissionTable(committed.source.run, committed.bar), committed);
  const r = spawnSync(process.execPath, ["eval/study/family-admission.mjs", "--run", committed.source.run, "--check"], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("the bar is the table's (85% of at least 10 labelled cards as committed), compared in integers", () => {
  assert.deepEqual(DEFAULT_BAR, { min_accept: 0.85, min_cards: 10 });
  assert.equal(committed.bar.min_accept, 0.85);
  assert.equal(committed.bar.min_cards, 10);
  assert.equal(admitted(8, 10, { min_accept: 0.75, min_cards: 10 }), true);
  assert.equal(admitted(8, 10, { min_accept: 0.85, min_cards: 10 }), false);
  // Another bar changes only the verdicts, never the counts.
  const at75 = admissionTable(committed.source.run, { min_accept: 0.75, min_cards: 10 });
  assert.deepEqual(at75.bar.min_accept, 0.75);
  for (const [lang, fams] of Object.entries(at75.languages))
    for (const [f, v] of Object.entries(fams)) assert.equal(v.n, committed.languages[lang][f].n, f);
  assert.equal(admitted(17, 20), true);
  assert.equal(admitted(16, 19), false);
  assert.equal(admitted(9, 9), false);
  assert.equal(admitted(85, 100), true);
  assert.equal(admitted(84, 99), false);
  for (const fams of Object.values(committed.languages))
    for (const [f, v] of Object.entries(fams)) {
      assert.equal(v.admitted, admitted(v.accepted, v.n, committed.bar), f);
      assert.ok(v.accepted <= v.n && v.n > 0, f);
    }
});

test("rule kinds map to the study's families, and only to families the Studio names", () => {
  assert.deepEqual(Object.keys(committed.rule_kinds), RULE_KINDS);
  for (const k of RULE_KINDS) {
    assert.equal(ruleKind(ruleOfKind(k)), k, k);
    const f = familyOf({ rule: ruleOfKind(k), summary: "" });
    assert.equal(committed.rule_kinds[k], f === "other" ? null : f, k);
  }
  assert.deepEqual(kindFamilies(), committed.rule_kinds);
  for (const f of Object.values(committed.rule_kinds).filter(Boolean)) assert.ok(STUDIO_FAMILIES[f], f);
  assert.deepEqual(Object.fromEntries(Object.entries(committed.families).map(([f, v]) => [f, v.studio])), STUDIO_FAMILIES);
  // One family mapping: rule-kind-family.json (the Studio's, read by drift_mine::rank) names every kind, and
  // STUDIO_FAMILIES is derived from it, so each Studio family is in one study family.
  assert.deepEqual(Object.keys(RULE_KIND_FAMILY).sort(), [...RULE_KINDS].sort());
  const owner = {};
  for (const [f, names] of Object.entries(STUDIO_FAMILIES)) for (const n of names) (owner[n] ??= new Set()).add(f);
  for (const [n, fs] of Object.entries(owner)) assert.equal(fs.size, 1, `${n} is in ${[...fs]}`);
  for (const k of RULE_KINDS) if (committed.rule_kinds[k]) assert.ok(STUDIO_FAMILIES[committed.rule_kinds[k]].includes(RULE_KIND_FAMILY[k]), k);
  // Kinds with no study family are never admitted.
  for (const k of ["throws", "directive", "registered_in", "mirrors_keys", "practice"]) assert.equal(committed.rule_kinds[k], null, k);
});

test("counts are each part's own-language suggestion-tier cards", () => {
  const ts = committed.languages.ts;
  // relabel4: TypeScript naming 20 of 34 in ts, 1 of 3 more in py2's TypeScript cards.
  if (committed.source.run.endsWith("dev-v3-relabel4-2026-11-07")) {
    assert.deepEqual(ts.naming, { accepted: 21, n: 37, rate: 0.568, admitted: false });
    // The default tier's call wrappers are not suggestion-tier cards: one ts suggestion card.
    assert.equal(ts.wrapper.n, 1);
    assert.deepEqual(committed.languages.py.wrapper, { accepted: 6, n: 8, rate: 0.75, admitted: false });
  }
});

// Every directory of a run that holds a metrics.json is read as a part, so a run's own tools never write that name
// for anything but metrics.mjs --json output (relabel5's verifier summary did, and stopped this script; it is
// verifier/score.json now). admissionTable dies (exits) on a bad part, hence the child process.
test("the latest relabel run reads: each <part>/metrics.json is metrics.mjs output", () => {
  const run = "eval/study/runs/dev-v3-relabel5-2026-11-07";
  const code = `import { admissionTable } from "./eval/study/family-admission.mjs"; console.log(JSON.stringify(admissionTable(${JSON.stringify(run)}).source.parts.map((p) => p.path)));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ["py", "py2", "ts"].map((p) => `${run}/${p}/metrics.json`));
});

test("a held-out or unknown run is refused", () => {
  for (const run of ["eval/study/runs/heldout-primary", "eval/elsewhere", "/tmp/x"]) {
    const r = spawnSync(process.execPath, ["eval/study/family-admission.mjs", "--run", run, "--check"], { cwd: repoRootDir, encoding: "utf8" });
    assert.equal(r.status, 2, run);
  }
});
