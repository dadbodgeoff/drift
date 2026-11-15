// generalise.mjs (PLAN-R10.md §3.2-§3.3, PLAN-R11.md §5): card effects, the undo-named reading, fold effects and the
// admission rule over five folds on small fixtures; the input path refusals; a mutation check of the admission rule,
// the fold-5 rules and the path refusals (each broken in a copy of the module, and a fixture check must fail); and, on
// the real build-set labels, the PLAN-R10 figures (§1.1, §2, §3.3, §4), the dev3 figures of #132, the show-table
// figures of #129 and the r11-default default-tier readings (§1, §2, §5) reproduced.
//
//   node --test eval/study/generalise.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import * as G from "./generalise.mjs";
import { familyOf, repoRootDir, sha256File } from "./lib.mjs";
import { loro } from "./show-policy.mjs";

const here = join(repoRootDir, "eval/study");

// ---------- fixtures ----------

// Folds: a* fold 1, b* fold 2, c* fold 3, d* fold 4, e* fold 5 (all TS).
const FOLDS = {
  folds: [1, 2, 3, 4, 5],
  repos: new Map(["a1", "a2", "b1", "b2", "b3", "c1", "d1", "e1", "e2"].map((r) => [r, { fold: { a: 1, b: 2, c: 3, d: 4, e: 5 }[r[0]], lang: "ts" }])),
};
const C = (repo, id, label, o = {}) => ({ uid: `${repo}/${id}`, repo, id, lang: "ts", tier: "suggestion", family: "naming", outliers: 0, label, why: null, ...o });
const without = (cs, ...ids) => cs.filter((c) => !ids.includes(c.id));

// The admission fixtures: [name, before, after, design folds, expected [a, b, c, d] and verdict, fold 5 covered].
const okBefore = [C("a1", "W1", "WRONG"), C("a1", "A1", "ACCEPT"), C("b1", "W2", "WRONG"), C("b1", "A2", "ACCEPT"), C("b2", "W3", "WRONG"), C("b2", "A3", "ACCEPT"), C("c1", "A4", "ACCEPT")];
// The same with fold 5 (dev3) cards: an ACCEPT and a WRONG in e1.
const f5Before = [...okBefore, C("e1", "A5", "ACCEPT"), C("e1", "W5", "WRONG")];
const helpedAll = without(f5Before, "W1", "W2", "W3");
const ADMISSION_CASES = [
  // helps a1 (fold 1), b1 and b2 (fold 2); loses an ACCEPT only in the design fold; other folds 3/5 -> 3/3.
  ["admitted, with an ACCEPT lost inside the design fold", okBefore, without(okBefore, "W1", "W2", "W3", "A1"), [1], [true, true, true, true], true],
  ["helps 2 repos across 2 folds", okBefore, without(okBefore, "W1", "W2"), [1], [false, true, true, true], false],
  ["helps 3 repos in 1 fold", [C("b1", "W1", "WRONG"), C("b2", "W2", "WRONG"), C("b3", "W3", "WRONG"), C("b3", "A1", "ACCEPT")], [C("b3", "A1", "ACCEPT")], [1], [false, true, true, true], false],
  ["loses an ACCEPT outside the design fold", okBefore, without(okBefore, "W1", "W2", "W3", "A4"), [1], [true, false, true, true], false],
  // other folds 1/2 -> 1/2 (a WRONG removed, an unlabelled card added): a flat effect is not positive.
  ["other-fold effect exactly zero", [C("a1", "W1", "WRONG"), C("a2", "W2", "WRONG"), C("b1", "A2", "ACCEPT"), C("b1", "W3", "WRONG")], [C("b1", "A2", "ACCEPT"), C("b1", "U1", "UNLABELLED")], [1], [true, true, false, true], false],
  ["every fold a design fold: no other-fold effect", okBefore, without(okBefore, "W1", "W2", "W3"), [1, 2, 3, 4, 5], [true, true, false, true], false],
  ["no design fold: every fold is other", okBefore, without(okBefore, "W1", "W2", "W3"), [], [true, true, true, true], true],
  // Fold 5 (PLAN-R11 §5).
  ["fold 5 unchanged: admitted", f5Before, helpedAll, [1], [true, true, true, true], true],
  ["fold 5 WRONG removed: admitted, fold 5 helped", f5Before, without(helpedAll, "W5"), [1], [true, true, true, true], true],
  ["loses an ACCEPT in fold 5, not a design fold", f5Before, without(helpedAll, "A5"), [1], [true, false, true, false], false],
  ["loses an ACCEPT in fold 5, a design fold", f5Before, without(helpedAll, "A5"), [1, 5], [true, true, true, false], false],
  // fold 5: 1/2 -> 1/3 (an unlabelled card added): the fold-5 rate falls, while the other folds rise.
  ["fold-5 accept rate falls (design fold)", f5Before, [...helpedAll, C("e2", "U5", "UNLABELLED")], [1, 5], [true, true, true, false], false],
  // fold 5: nothing shown before; after, an ACCEPT (not negative) or an unlabelled card (negative).
  ["fold 5 empty before, an ACCEPT after", okBefore, [...without(okBefore, "W1", "W2", "W3"), C("e1", "A6", "ACCEPT")], [1], [true, true, true, true], true],
  ["fold 5 empty before, an unlabelled card after", okBefore, [...without(okBefore, "W1", "W2", "W3"), C("e1", "U6", "UNLABELLED")], [1, 5], [true, true, true, false], false],
  // fold 5: 2/3 -> 1/1, the rate rises but an ACCEPT is lost; and 1/2 -> nothing shown, an ACCEPT lost.
  ["fold 5 loses an ACCEPT while its rate rises", [...f5Before, C("e2", "A7", "ACCEPT")], [...without(helpedAll, "A5", "W5"), C("e2", "A7", "ACCEPT")], [1, 5], [true, true, true, false], false],
  ["fold 5 loses every card, an ACCEPT among them", f5Before, without(helpedAll, "A5", "W5"), [1, 5], [true, true, true, false], false],
  ["fold 5 not read (census without dev3)", okBefore, without(okBefore, "W1", "W2", "W3"), [1], [true, true, true, false], false, false],
];

const EVENTS_BEFORE = [
  C("a1", "x1", "ACCEPT"), C("a1", "x2", "WRONG"), C("a1", "x3", "TRIVIAL"), C("a1", "x4", "UNLABELLED"),
  C("a1", "x5", "ACCEPT", { tier: "default" }), C("a1", "x6", "WRONG", { tier: "default" }), C("a1", "x7", "ACCEPT"), C("a1", "x8", "WRONG"),
  C("a1", "x9", "WRONG", { outliers: 3 }),
];
const EVENTS_AFTER = [
  C("a1", "x5", "ACCEPT"), C("a1", "x6", "WRONG"), C("a1", "x7", "WRONG"), C("a1", "x8", "ACCEPT"), C("a1", "x9", "WRONG", { outliers: 1 }),
  C("a1", "y1", "UNLABELLED"), C("a1", "y2", "ACCEPT"),
];
const EVENTS_WANT = {
  "a1/x1": ["removed", "accept_lost"], "a1/x2": ["removed", "helped"], "a1/x3": ["removed", "helped"], "a1/x4": ["removed", null],
  "a1/x5": ["demoted", "accept_lost"], "a1/x6": ["demoted", null], "a1/x7": ["relabelled", "accept_lost"], "a1/x8": ["relabelled", "helped"],
  "a1/x9": ["changed", null], "a1/y1": ["added", null], "a1/y2": ["added", "helped"],
};

// Every fixture check, against a module (the real one, or a mutant): the names of the checks that fail.
function fixtureChecks(M) {
  const checks = {
    events: () => {
      const got = Object.fromEntries(M.cardEvents(EVENTS_BEFORE, EVENTS_AFTER).map((e) => [e.uid, [e.kind, e.effect]]));
      assert.deepEqual(got, EVENTS_WANT);
    },
    rises: () => {
      assert.equal(M.rises({ accept: 1, shown: 2 }, { accept: 1, shown: 2 }), false);
      assert.equal(M.rises({ accept: 1, shown: 2 }, { accept: 2, shown: 3 }), true);
      assert.equal(M.rises({ accept: 2, shown: 3 }, { accept: 1, shown: 2 }), false);
      assert.equal(M.rises({ accept: 0, shown: 2 }, { accept: 0, shown: 0 }), false);
      assert.equal(M.rises({ accept: 0, shown: 0 }, { accept: 1, shown: 1 }), false);
    },
    no_design_folds: () => {
      const eff = M.foldEffects(okBefore, without(okBefore, "W1"), FOLDS, null);
      assert.equal(eff.other, undefined);
      assert.equal(M.admission(eff).admitted, null);
    },
    // [STRICT] a change that touches a default-tier card gets fold 5 as a design fold; one that does not keeps its own.
    fold5_design_forced: () => {
      const def = [C("a1", "D1", "ACCEPT", { tier: "default" }), C("a1", "W1", "WRONG")];
      const demote = M.cardEvents(def, [C("a1", "D1", "ACCEPT"), C("a1", "W1", "WRONG")]);
      const dropDefault = M.cardEvents([...def, C("a1", "D2", "WRONG", { tier: "default" })], def);
      const addDefault = M.cardEvents(def, [...def, C("a1", "D3", "UNLABELLED", { tier: "default" })]);
      const suggestionOnly = M.cardEvents(def, [def[0]]);
      for (const ev of [demote, dropDefault, addDefault]) {
        const r = M.effectiveDesignFolds(new Set([1]), ev);
        assert.deepEqual([[...r.design].sort(), r.forced], [[1, 5], true]);
        assert.deepEqual([...M.effectiveDesignFolds(new Set(), ev).design], [5]);
      }
      assert.deepEqual(M.effectiveDesignFolds(new Set([1]), suggestionOnly), { design: new Set([1]), forced: false });
      assert.deepEqual(M.effectiveDesignFolds(new Set([1, 5]), demote), { design: new Set([1, 5]), forced: false });
      assert.deepEqual(M.effectiveDesignFolds(null, demote), { design: null, forced: false });
    },
    // Paths: held-out and a pool operator's scratch always refused; a blind pool before its report refused (none is
    // in that state since dev5 reported, 2026-11-11; show-policy.test.mjs checks the rule with a tree that lacks a
    // report); a reported pool (dev3, dev4, dev5) only through its committed runs.
    paths: () => {
      const refused = [
        ["eval/study/runs/heldout2-2026-11-08/ts", /held-out/], ["eval/holdout-primary.json", /held-out/], [`${repoRootDir}/eval/holdout.json`, /held-out/],
        ["eval/dev4-2026-11-09.json", /dev4 path outside/], ["/tmp/x/scratchpad/dev4/census", /operator's scratch/], ["x/dev4_census", /dev4 path outside/],
        ["x/dev5_census", /dev5 path outside/], ["eval/dev5-py.json", /dev5 path outside/],
        ["eval/study/runs/dev9-py/queue.json", /dev9: a blind dev pool this checkout does not know/],
        ["/tmp/x/scratchpad/dev3/keys.json", /operator's scratch/], ["/tmp/x/scratchpad/dev3-ops/a", /operator's scratch/], ["scratchpad/dev3/census", /operator's scratch/],
        ["x/dev3_census", /dev3 path outside/], ["/tmp/x/r11c/dev3/after", /dev3 path outside/], ["eval/dev3-2026-11-08.json", /dev3 path outside/], ["eval/study/dev3-runs/x", /dev3 path outside/],
      ];
      for (const [p, re] of refused) assert.throws(() => M.checkPath(p), re, p);
      for (const p of ["eval/study/runs/dev5-py/queue.json", "eval/study/runs/dev5-py/final.jsonl", "eval/study/runs/dev-v3-relabel5-2026-11-07/census-json", "scratchpad/folds10/after", "eval/study/runs/dev3-ts-2026-11-08/final.jsonl", `${repoRootDir}/eval/study/runs/dev3-py-2026-11-08/labels/A`, "eval/study/runs/dev3-recensus-2026-11-08/census-json", "/tmp/x/r11c/after", "eval/study/runs/dev4-ts-2026-11-09/queue.json", `${repoRootDir}/eval/study/runs/dev4-py-2026-11-09/final.jsonl`, "eval/study/runs/dev-v3-relabel6-2026-11-10/py4/final.jsonl"])
        assert.equal(M.checkPath(p), p);
    },
  };
  for (const [name, before, after, design, want, verdict, covered = true] of ADMISSION_CASES)
    checks[`admission: ${name}`] = () => {
      const r = M.admission(M.foldEffects(before, after, FOLDS, new Set(design)), M.ADMISSION, covered);
      const c = r.conditions;
      assert.deepEqual([c.helps.pass, c.no_accept_lost_outside_design.pass, c.other_fold_effect_positive.pass, c.fold5_not_negative.pass], want);
      assert.equal(r.admitted, verdict);
    };
  const failed = [];
  for (const [n, f] of Object.entries(checks)) {
    try {
      f();
    } catch {
      failed.push(n);
    }
  }
  return failed;
}

// ---------- unit tests ----------

test("card effects: what helps, what loses an ACCEPT, and what is neither", () => {
  assert.deepEqual(fixtureChecks(G).filter((n) => n === "events" || n === "rises"), []);
  const s = G.stats(EVENTS_BEFORE);
  assert.deepEqual([s.accept, s.shown, s.wrong, s.trivial, s.unlabelled, s.not_wrong, s.default.accept, s.default.shown, s.repos], [3, 9, 4, 1, 1, 4, 1, 2, 1]);
});

for (const [name, , , , want, verdict] of ADMISSION_CASES)
  test(`admission (§3.2): ${name} -> [${want}] ${verdict ? "admitted" : "not admitted"}`, () => {
    assert.deepEqual(fixtureChecks(G).filter((n) => n === `admission: ${name}`), []);
  });

test("admission needs the design folds named", () => assert.deepEqual(fixtureChecks(G).filter((n) => n === "no_design_folds"), []));

test("[STRICT] fold 5 joins the design folds of a change that touches a default-tier card", () => assert.deepEqual(fixtureChecks(G).filter((n) => n === "fold5_design_forced"), []));

test("paths: held-out, a pool operator's scratch and a blind pool before its report are refused; a reported pool is read only through its committed runs", () => assert.deepEqual(fixtureChecks(G).filter((n) => n === "paths"), []));

test("fold effects: per fold, design and other sides, with per-repo deltas", () => {
  const [, before, after, design] = ADMISSION_CASES[0];
  const eff = G.foldEffects(before, after, FOLDS, new Set(design));
  assert.deepEqual(eff.folds.map((f) => [f.fold, f.design, f.helped.length, f.accept_lost.length]), [[1, true, 1, 1], [2, false, 2, 0], [3, false, 0, 0], [4, false, 0, 0], [5, false, 0, 0]]);
  assert.deepEqual([eff.fold5.before.shown, eff.fold5.after.shown], [0, 0]);
  assert.deepEqual([eff.design.before.accept, eff.design.before.shown, eff.design.after.accept, eff.design.after.shown], [1, 2, 0, 0]);
  assert.deepEqual([eff.other.before.accept, eff.other.before.shown, eff.other.after.accept, eff.other.after.shown, eff.other.before.repos], [3, 5, 3, 3, 3]);
  assert.ok(Math.abs(eff.other.delta - 0.4) < 1e-12);
  assert.ok(Math.abs(eff.other.delta_per_repo.wrong + 2 / 3) < 1e-12);
  assert.deepEqual(eff.other.repos_helped, ["b1", "b2"]);
});

test("undo-named: a named card returns to its base state, a named new card goes, a named hidden card returns", () => {
  const base = new Map([C("a1", "k1", "ACCEPT"), C("a1", "k2", "WRONG", { tier: "default" }), C("a1", "k3", "WRONG"), C("a1", "k4", "ACCEPT"), C("a1", "k5", "WRONG")].map((c) => [c.uid, c]));
  const now = [C("a1", "k1", "ACCEPT"), C("a1", "k2", "ACCEPT"), C("a1", "n1", "ACCEPT"), C("a1", "n2", "WRONG"), C("a1", "k5", "WRONG")];
  const named = new Set(["a1/k1", "a1/k2", "a1/n1", "a1/k3"]);
  const u = G.undoNamed(now, base, named);
  assert.deepEqual(u.map((c) => [c.id, c.label, c.tier, !!c.undone, !!c.restored]), [
    ["k1", "ACCEPT", "suggestion", true, false], ["k2", "WRONG", "default", true, false], ["n2", "WRONG", "suggestion", false, false],
    ["k5", "WRONG", "suggestion", false, false], ["k3", "WRONG", "suggestion", false, true],
  ]);
  const prs = G.mentionedUids([{ pr: 1, round: 5, ids: ["k1", "zz"] }, { pr: 2, round: 7, ids: ["k2"] }], [{ cards: base }]);
  assert.deepEqual([...G.namedSet(prs, [5])], ["a1/k1"]);
  assert.deepEqual([...G.namedSet(prs, [5, 7])], ["a1/k1", "a1/k2"]);
});

test("census diff round trip, and its refusals", () => {
  const before = [C("a1", "x1", "ACCEPT"), C("a1", "x2", "WRONG"), C("b1", "x3", "WRONG")];
  const after = [C("a1", "x1", "ACCEPT", { tier: "default" }), C("b1", "x3", "WRONG"), C("b1", "x4", "UNLABELLED")];
  const d = G.censusDiff(before, after);
  assert.deepEqual(Object.fromEntries(Object.entries(d.repos).map(([r, x]) => [r, [x.removed, x.added.map((c) => c.id), x.changed.map((c) => c.id)]])), { a1: [["x2"], [], ["x1"]], b1: [[], ["x4"], []] });
  const got = G.applyDiff(before, d, FOLDS);
  assert.deepEqual(got.map((c) => [c.uid, c.tier, c.label]), [["a1/x1", "default", "ACCEPT"], ["b1/x3", "suggestion", "WRONG"], ["b1/x4", "suggestion", "UNLABELLED"]]);
  assert.throws(() => G.applyDiff(before, { kind: "drift-census-diff", repos: { a1: { removed: ["nope"] } } }, FOLDS), /removed but not in the before state/);
  assert.throws(() => G.applyDiff(before, { kind: "drift-census-diff", repos: { polar: { removed: [] } } }, FOLDS), /not a build-set repo/);
  assert.throws(() => G.applyDiff(before, { repos: {} }, FOLDS), /not a census diff/);
});

test("refuses repos outside the build set, and folds that are not in the folds file", () => {
  const dir = mkdtempSync(join(tmpdir(), "gen-"));
  try {
    writeFileSync(join(dir, "polar.json"), JSON.stringify({ proposals: [] }));
    assert.throws(() => G.loadCensusDir(dir, FOLDS), /polar is not a build-set repo/);
  } finally {
    rmSync(dir, { recursive: true });
  }
  assert.deepEqual([...G.parseDesignFolds("1,3", FOLDS)], [1, 3]);
  assert.deepEqual([...G.parseDesignFolds("none", FOLDS)], []);
  assert.equal(G.parseDesignFolds(undefined, FOLDS), null);
  assert.deepEqual([...G.parseDesignFolds("1,5", FOLDS)], [1, 5]);
  assert.throws(() => G.parseDesignFolds("6", FOLDS), /not a fold/);
});

// ---------- mutation check of the admission rule ----------

const SRC = readFileSync(join(here, "generalise.mjs"), "utf8");
// [what is broken, text in generalise.mjs, its replacement]. Each must make some fixture check fail.
const MUTANTS = [
  ["a: the help condition always holds", "const a = helpedRepos.size >= rule.min_repos && helpedFolds.size >= rule.min_folds; // mutation:a", "const a = true;"],
  ["a: no repo count", "helpedRepos.size >= rule.min_repos && helpedFolds", "helpedFolds"],
  ["a: no fold count", " && helpedFolds.size >= rule.min_folds;", ";"],
  ["a: 2 repos are enough", "export const ADMISSION = { min_repos: 3, min_folds: 2 };", "export const ADMISSION = { min_repos: 2, min_folds: 2 };"],
  ["a: an unlabelled card removed counts as helped", 'isLabelledNonA(c) ? "helped" : null', '"helped"'],
  ["b: the ACCEPT condition always holds", "const b = lostOutside.length === 0; // mutation:b", "const b = true;"],
  ["b: ACCEPTs lost anywhere count (design fold too)", "const lostOutside = eff.other.accept_lost;", "const lostOutside = eff.all.accept_lost;"],
  ["b: a demoted ACCEPT is not lost", 'kind: "demoted", before: o, after: c, effect: isA(c) ? "accept_lost" : null', 'kind: "demoted", before: o, after: c, effect: null'],
  ["c: the other-fold condition always holds", "const c = eff.other.rises; // mutation:c", "const c = true;"],
  ["c: a flat effect counts as positive", "a.accept * b.shown > b.accept * a.shown", "a.accept * b.shown >= b.accept * a.shown"],
  ["c: the design folds count as other folds", "res.other = side((x) => !designFolds.has(x));", "res.other = side(() => true);"],
  // Round 11 (PLAN-R11 §5): fold 5, the [STRICT] default-tier design fold, and the path refusals.
  ["b: fold 5 left out of the other folds", "res.other = side((x) => !designFolds.has(x));", "res.other = side((x) => !designFolds.has(x) && x !== FOLD5);"],
  ["d: the fold-5 condition always holds", "const d = fold5Covered && fold5NotNegative(eff.fold5); // mutation:d", "const d = true;"],
  ["d: a census without dev3 counts as covered", "const d = fold5Covered && fold5NotNegative(eff.fold5);", "const d = fold5NotNegative(eff.fold5);"],
  ["d: a fold-5 ACCEPT lost is not negative", "  if (f5.accept_lost.length) return false; // mutation:d-lost\n", ""],
  ["d: an empty fold 5 before compares rates", "  if (!f5.before.shown) return f5.after.accept === f5.after.shown; // mutation:d-empty\n", ""],
  ["d: a falling fold-5 rate is not negative", "  return f5.after.accept * f5.before.shown >= f5.before.accept * f5.after.shown; // mutation:d-rate", "  return true;"],
  ["d: a flat fold-5 rate is negative", "f5.after.accept * f5.before.shown >= f5.before.accept * f5.after.shown", "f5.after.accept * f5.before.shown > f5.before.accept * f5.after.shown"],
  ["d: fold 5 is read from fold 4", "fold5: side((x) => x === FOLD5)", "fold5: side((x) => x === 4)"],
  ["e: a default-tier change keeps its own design folds", "  const touchesDefault = events.some((e) => e.before?.tier === \"default\" || e.after?.tier === \"default\"); // mutation:e", "  const touchesDefault = false;"],
  ["e: only a card that leaves the default tier counts", "e.before?.tier === \"default\" || e.after?.tier === \"default\"", "e.before?.tier === \"default\""],
  ["path: held-out read", "    if (/heldout|holdout/i.test(x)) throw new Error(`${p}: a held-out path; generalise.mjs reads build-set data only`); // mutation:path-heldout", ""],
  ["path: a blind pool read before its report", "    for (const pool of blindPoolsNamed(x)) if (blindPoolProblem(pool)) throw new Error(`${p}: ${blindPoolProblem(pool)}; generalise.mjs reads build-set data only`); // mutation:path-blind", ""],
  ["path: a pool operator's scratch read", "    if (/(^|\\/)scratchpad\\/dev\\d/i.test(x)) throw new Error(`${p}: a blind pool operator's scratch; generalise.mjs never reads it`); // mutation:path-poolscratch", ""],
  ["path: any path of a reported pool read", "for (const pool of blindPoolsNamed(tail)) if (!(inRepo && poolRuns(pool).test(rel)))", "for (const pool of blindPoolsNamed(tail)) if (false)"],
  ["path: a reported pool allowed anywhere under the checkout", "!(inRepo && poolRuns(pool).test(rel))", "!inRepo"],
];

test("the real module passes every fixture check", () => assert.deepEqual(fixtureChecks(G), []));

test("mutation check: breaking any admission condition fails a fixture check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gen-mut-"));
  try {
    const caught = [];
    for (const [i, [what, from, to]] of MUTANTS.entries()) {
      assert.equal(SRC.split(from).length, 2, `mutant "${what}": its text must occur exactly once in generalise.mjs`);
      const src = SRC.replace(from, to)
        .replace('from "./folds.mjs"', `from ${JSON.stringify(pathToFileURL(join(here, "folds.mjs")).href)}`)
        .replace('from "./lib.mjs"', `from ${JSON.stringify(pathToFileURL(join(here, "lib.mjs")).href)}`)
        .replace('from "./show-policy.mjs"', `from ${JSON.stringify(pathToFileURL(join(here, "show-policy.mjs")).href)}`);
      const f = join(dir, `mutant-${i}.mjs`);
      writeFileSync(f, src);
      const failed = fixtureChecks(await import(pathToFileURL(f).href));
      assert.ok(failed.length > 0, `mutant "${what}" passed every fixture check`);
      caught.push([what, failed]);
    }
    assert.equal(caught.length, MUTANTS.length);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ---------- integration: the PLAN-R10 figures from the real dev labels ----------

const ctx = G.loadAll();
const P = (a, b) => G.pct(a, b);
const row = (policy, lang) => {
  const R = G.generalise({ change: { policy }, ...ctx }).languages[lang];
  const a = R.in_sample.after, v = R.dev_v3?.after;
  return [P(a.accept, a.shown), a.cards_per_repo.toFixed(1), a.accepts_per_repo.toFixed(1), a.wrong, v ? P(v.accept, v.shown) : null];
};

test("PLAN-R10 §1.1: per-card accept by snapshot (TS all and default tier, Python all)", () => {
  const s = ctx.snaps;
  const rate = (k, lang, f = () => true) => {
    const cs = [...s[k].cards.values()].filter((c) => c.lang === lang && f(c));
    return P(cs.filter(G.isA).length, cs.length);
  };
  const def = (c) => c.tier === "default";
  assert.deepEqual(["v3", "r2", "r3", "r4", "r5"].map((k) => rate(k, "ts")), ["42.6% (69/162)", "50.0% (79/158)", "55.1% (87/158)", "62.6% (92/147)", "63.9% (94/147)"]);
  assert.deepEqual(["v3", "r2", "r3", "r4", "r5"].map((k) => rate(k, "ts", def)), ["75.0% (24/32)", "93.1% (27/29)", "100.0% (29/29)", "100.0% (30/30)", "100.0% (30/30)"]);
  assert.deepEqual(["v3", "r3", "r4", "r5"].map((k) => rate(k, "py")), ["31.6% (31/98)", "34.0% (34/100)", "45.8% (38/83)", "61.0% (47/77)"]);
});

test("PLAN-R10 §1.1/§3.3: the undo-named reading (TS 43.6%, Python 34.3%; TS against relabel2 50.3%)", () => {
  const r = G.generalise({ change: { policy: "all" }, ...ctx });
  assert.equal(P(r.languages.ts.undo_named.before.accept, r.languages.ts.undo_named.before.shown), "43.6% (72/165)");
  assert.equal(P(r.languages.py.undo_named.before.accept, r.languages.py.undo_named.before.shown), "34.3% (34/99)");
  const r2 = G.generalise({ change: { policy: "all" }, ...ctx, undo: { base: "r2", rounds: [5, 6, 8, 9] } });
  assert.equal(P(r2.languages.ts.undo_named.before.accept, r2.languages.ts.undo_named.before.shown), "50.3% (80/159)");
});

test("PLAN-R10 §2: the mechanism readings, in-sample and dev-v3", () => {
  const two = (p, l) => row(p, l).filter((_, i) => i === 0 || i === 4);
  assert.deepEqual(two("M1", "ts"), ["66.2% (94/142)", "43.7% (69/158)"]);
  assert.deepEqual(two("I1", "ts"), ["65.5% (93/142)", "42.8% (68/159)"]);
  assert.deepEqual(two("I1", "py"), ["65.3% (47/72)", "34.4% (31/90)"]);
  assert.deepEqual(two("I1+I2", "ts"), ["68.5% (89/130)", "47.8% (64/134)"]);
  assert.deepEqual(two("I1+I2", "py"), ["70.1% (47/67)", "36.1% (30/83)"]);
  assert.deepEqual(two("M1+I1+I2", "ts"), ["71.2% (89/125)", "49.2% (64/130)"]);
  assert.deepEqual(two("outliers<=1", "py"), ["73.8% (31/42)", "38.2% (13/34)"]);
});

// PLAN-R10 §4 tables: [accept, cards/repo, accepts/repo, WRONG, dev-v3 reading].
const PLAN_S4 = {
  ts: [
    ["all", ["63.9% (94/147)", "11.3", "7.2", 48, "42.6% (69/162)"]],
    ["M1+I1+I2", ["71.2% (89/125)", "9.6", "6.8", 31, "49.2% (64/130)"]],
    ["rank<=5", ["82.8% (48/58)", "4.5", "3.7", 8, null]],
    ["rank<=3", ["88.9% (32/36)", "2.8", "2.5", 2, null]],
    ["default+sugg<=1", ["82.9% (63/76)", "5.8", "4.8", 9, "68.3% (43/63)"]],
    ["default+sugg<=1,no-ordering", ["84.9% (62/73)", "5.6", "4.8", 7, "67.7% (42/62)"]],
    ["loro60+<=1", ["85.7% (48/56)", "4.3", "3.7", 4, "77.5% (31/40)"]],
    ["default-only", ["100.0% (30/30)", "2.3", "2.3", 0, "75.0% (24/32)"]],
  ],
  py: [
    ["all", ["61.0% (47/77)", "4.5", "2.8", 30, "31.6% (31/98)"]],
    ["I1+I2", ["70.1% (47/67)", "3.9", "2.8", 20, "36.1% (30/83)"]],
    ["outliers<=1", ["73.8% (31/42)", "2.5", "1.8", 11, "38.2% (13/34)"]],
    ["loro60", ["71.8% (28/39)", "2.3", "1.6", 11, "88.2% (15/17)"]],
    ["loro60+<=1", ["90.5% (19/21)", "1.2", "1.1", 2, "83.3% (5/6)"]],
  ],
};
for (const [lang, rows] of Object.entries(PLAN_S4))
  for (const [policy, want] of rows) test(`PLAN-R10 §4 ${G.LANG_NAME[lang]}: ${policy}`, () => assert.deepEqual(row(policy, lang), want));

// The same change given as two census states (relabel5's census --json plus dev3's at main, and that census with
// I1+I2's cards removed), as a census diff, and through the CLI, reads as the policy does, fold 5 included.
const DEV3_CENSUS = join(repoRootDir, G.RUNS, "dev3-recensus-2026-11-08/census-json");
test("a census before/after, a census diff and the CLI read as the policy", () => {
  const r5src = join(repoRootDir, G.RUNS, "dev-v3-relabel5-2026-11-07/census-json");
  const dir = mkdtempSync(join(tmpdir(), "gen-census-"));
  try {
    const src = join(dir, "before"), after = join(dir, "after");
    spawnSync("mkdir", [src, after]);
    for (const d of [r5src, DEV3_CENSUS]) for (const f of readdirSync(d)) writeFileSync(join(src, f), readFileSync(join(d, f)));
    assert.equal(readdirSync(src).length, 54);
    const hide = { ts: ["ordering", "renders", "calls"], py: ["ordering", "repo"] };
    for (const f of readdirSync(src)) {
      const j = JSON.parse(readFileSync(join(src, f), "utf8"));
      const lang = ctx.folds.repos.get(f.replace(/\.json$/, "")).lang;
      j.proposals = j.proposals.filter((p) => !(p.tier === "suggestion" && hide[lang].includes(familyOf({ rule: p.rule, summary: p.summary }))));
      writeFileSync(join(after, f), JSON.stringify(j));
    }
    const design = new Set([1]);
    const pol = G.generalise({ change: { policy: "I1+I2" }, ...ctx, designFolds: design });
    const before = G.loadCensusDir(src, ctx.folds), afterCards = G.loadCensusDir(after, ctx.folds);
    const repos = new Set(readdirSync(src).map((f) => f.replace(/\.json$/, "")));
    const cen = G.generalise({ change: { before, after: afterCards, repos }, ...ctx, designFolds: design, policy: "I1+I2" });
    const dif = G.generalise({ change: { diff: G.censusDiff(before, afterCards) }, ...ctx, designFolds: design, policy: "I1+I2" });
    const strip = (r) => ({ b: r.before, a: r.after, events: r.folds.events.map((e) => [e.uid, e.kind, e.effect, e.fold]), folds: r.folds.folds.map((f) => [f.fold, f.before, f.after, f.helped, f.accept_lost]) });
    const strip5 = (R) => ({ five: strip({ before: null, after: null, folds: R.folds }), fold5: R.fold5, dt: R.default_tier });
    for (const lang of ["ts", "py"]) {
      assert.equal(pol.languages[lang].fold5.covered, true);
      for (const r of [cen, dif]) {
        assert.deepEqual(strip(r.languages[lang].in_sample), strip(pol.languages[lang].in_sample), lang);
        assert.deepEqual(strip5(r.languages[lang]), strip5(pol.languages[lang]), lang);
        assert.deepEqual(r.languages[lang].admission, pol.languages[lang].admission, lang);
        assert.deepEqual(r.languages[lang].policy_matches_census.differ, [], lang);
        assert.deepEqual(r.languages[lang].dev_v3.after, pol.languages[lang].dev_v3.after, lang);
        // The undo-named reading: the same before state; a census keeps the restored cards it says nothing about.
        assert.deepEqual(r.languages[lang].undo_named.before, pol.languages[lang].undo_named.before, lang);
        const restoredHidden = G.undoNamed([...ctx.snaps.r5.cards.values()].filter((c) => c.lang === lang), new Map([...ctx.snaps.v3.cards].filter(([, c]) => c.lang === lang)), G.namedSet(ctx.prs, G.UNDO.rounds)).filter((c) => c.restored && c.tier === "suggestion" && hide[lang].includes(c.family)).length;
        assert.equal(r.languages[lang].undo_named.after.shown - pol.languages[lang].undo_named.after.shown, restoredHidden, lang);
      }
    }
    assert.equal(P(cen.languages.ts.in_sample.after.accept, cen.languages.ts.in_sample.after.shown), "68.5% (89/130)");
    // [STRICT] a census that leaves out a dev3 repo has no fold-5 reading, and so is not admitted.
    const part = new Set([...repos].filter((r) => r !== "T02"));
    const noF5 = G.generalise({ change: { before, after: afterCards, repos: part }, ...ctx, designFolds: design });
    assert.equal(noF5.languages.ts.fold5.covered, false);
    assert.equal(noF5.languages.ts.admission.conditions.fold5_not_negative.pass, false);
    assert.equal(noF5.languages.py.fold5.covered, true);
    const noRepos = G.generalise({ change: { before, after: afterCards }, ...ctx, designFolds: design });
    assert.deepEqual([noRepos.languages.ts.fold5.covered, noRepos.languages.py.fold5.covered], [false, false]);
    const run = (...a) => spawnSync(process.execPath, [join(here, "generalise.mjs"), ...a], { cwd: repoRootDir, encoding: "utf8" });
    const diffFile = join(dir, "diff.json");
    const c1 = run("--before", src, "--after", after, "--design-folds", "1", "--policy", "I1+I2", "--write-diff", diffFile, "--json", join(dir, "out.json"));
    assert.equal(c1.status, 0, c1.stderr);
    assert.match(c1.stdout, /after {2}68\.5% \(89\/130\)/);
    assert.match(c1.stdout, /policy I1\+I2 on the before cards gives the after cards: yes/);
    assert.equal(JSON.parse(readFileSync(join(dir, "out.json"), "utf8")).languages.ts.in_sample.after.shown, 130);
    const c2 = run("--diff", diffFile, "--design-folds", "1");
    assert.equal(c2.status, 0, c2.stderr);
    assert.match(c2.stdout, /after {2}68\.5% \(89\/130\)/);
    assert.match(c2.stdout, /dev-v3 reading: n\/a \(a census change is not a policy/);
    const c3 = run("--policy", "loro60+<=1");
    assert.equal(c3.status, 0, c3.stderr);
    assert.match(c3.stdout, /after {2}85\.7% \(48\/56\)/);
    assert.match(c3.stdout, /admission \(PLAN-R11 §5\): no verdict: name the design folds/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ---------- round 11: fold 5 (dev3), the default-tier readings, #132 and #129 reproduced ----------

const rate = (s) => P(s.accept, s.shown);
const flags = (x) => P(x.flags.real, x.flags.n);

test("folds-r11: 54 build repos in five folds; the dev3 cards are fold 5 (12 TS/JS, 2 Python cards)", () => {
  assert.equal(ctx.folds.repos.size, 54);
  assert.deepEqual(ctx.folds.folds, [1, 2, 3, 4, 5]);
  const d = [...ctx.dev3.cards.values()];
  assert.deepEqual([d.filter((c) => c.lang === "ts").length, d.filter((c) => c.lang === "py").length], [12, 2]);
  for (const c of d) assert.equal(ctx.folds.repos.get(c.repo).fold, 5, c.uid);
  for (const s of Object.values(ctx.snaps)) for (const c of s.cards.values()) assert.ok(ctx.folds.repos.get(c.repo).fold <= 4, c.uid);
});

test("#132: the dev3 figures at F10 (TS default 1/5, per-card accept 7/12, not-wrong 8/12, default flag precision 31.3%; Python 1/2)", () => {
  const r = G.generalise({ change: { policy: "all" }, ...ctx });
  const ts = r.languages.ts.fold5.before, py = r.languages.py.fold5.before;
  assert.deepEqual([P(ts.default.accept, ts.default.shown), rate(ts), P(ts.not_wrong, ts.shown), ts.wrong, ts.unlabelled, ts.repos], ["20.0% (1/5)", "58.3% (7/12)", "66.7% (8/12)", 4, 0, 12]);
  assert.deepEqual([rate(py), P(py.not_wrong, py.shown), py.repos], ["50.0% (1/2)", "50.0% (1/2)", 8]);
  const dt = r.languages.ts.default_tier.before["5"];
  assert.deepEqual([rate(dt), flags(dt), dt.repos, dt.flags.untraced], ["20.0% (1/5)", "31.3% (5/16)", 4, 0]);
  // The F10 census already applied the committed show table: it shows every dev3 card again.
  const st = G.generalise({ change: { policy: "show-table" }, ...ctx });
  for (const lang of ["ts", "py"]) assert.deepEqual(st.languages[lang].folds.fold5.after, st.languages[lang].folds.fold5.before, lang);
});

test("#129: the show table's build figures (in-sample, dev-v3, undo-named, leave-one-repo-out)", () => {
  // #129's table is relabel 5's (show-table-r5): the committed table then, and the one PLAN-R11 section 3 cites. The
  // committed table has been relabel 6's since round 12 (python12.md section 9.4); its readings are asserted below.
  const st = G.generalise({ change: { policy: "show-table-r5" }, ...ctx });
  const want = { ts: { in: "93.5% (43/46)", v3: "69.2% (27/39)", undo: "71.8% (28/39)" }, py: { in: "100.0% (12/12)", v3: "85.7% (6/7)", undo: "88.9% (8/9)" } };
  for (const lang of ["ts", "py"]) {
    const R = st.languages[lang];
    assert.deepEqual({ in: rate(R.in_sample.after), v3: rate(R.dev_v3.after), undo: rate(R.undo_named.after) }, want[lang], lang);
  }
  assert.equal(P(st.languages.ts.in_sample.after.not_wrong, st.languages.ts.in_sample.after.shown), "93.5% (43/46)");
  // MISMATCH with #129, reported, not tuned: its TS undo-named reading is 63.6% (28/44). show10-readings undoes a named
  // card's label only (keeping its relabel5 outlier count); generalise undoes the whole card (r10-history §2). Five named
  // TS naming cards, WRONG at dev-v3 with 2-6 outliers there and <= 1 at relabel5, are shown in #129's form only.
  const named = G.namedSet(ctx.prs, G.UNDO.rounds);
  const r5 = [...ctx.snaps.r5.cards.values()].filter((c) => c.lang === "ts");
  const v3 = new Map([...ctx.snaps.v3.cards].filter(([, c]) => c.lang === "ts"));
  const ids = new Set(r5.map((c) => c.uid));
  const s10 = [...r5.flatMap((c) => (!named.has(c.uid) ? [c] : v3.has(c.uid) ? [{ ...c, label: v3.get(c.uid).label }] : [])), ...[...v3.values()].filter((b) => !ids.has(b.uid) && named.has(b.uid))];
  const shown10 = G.POLICIES["show-table-r5"].select(s10, "ts");
  assert.equal(P(shown10.filter(G.isA).length, shown10.length), "63.6% (28/44)");
  const ours = new Set(G.POLICIES["show-table-r5"].select(G.undoNamed(r5, v3, named), "ts").map((c) => c.uid));
  const only10 = shown10.filter((c) => !ours.has(c.uid));
  assert.deepEqual(only10.map((c) => c.uid).sort(), ["ai/D-5590d9", "cal.com/D-8d7d13", "immich/D-26380c", "novu/D-2e9dcc", "supabase/D-5bd6b4"]);
  for (const c of only10) assert.ok(c.family === "naming" && c.label === "WRONG" && c.outliers <= 1 && v3.get(c.uid).outliers > 1, c.uid);
  const lo = G.generalise({ change: { policy: "show-table-r5-loro" }, ...ctx });
  assert.deepEqual([rate(lo.languages.ts.in_sample.after), rate(lo.languages.py.in_sample.after)], ["88.6% (31/35)", "81.8% (9/11)"]);
  // relabel 5's table, read from its run record, is the table that was committed then: the committed one differs from
  // it only in the Python half.
  const r5t = G.showTableR5();
  assert.equal(r5t.source.run, G.SHOW_TABLE_R5_RUN);
  assert.deepEqual(Object.entries(r5t.languages.py).filter(([, v]) => v.admitted).map(([f]) => f), ["naming"]);
  assert.deepEqual(r5t.languages.ts, G.showTable().languages.ts);
  // The committed table (relabel 6's) on the same snapshots: Python control, layering and call wrappers beside naming.
  const now = G.generalise({ change: { policy: "show-table" }, ...ctx });
  assert.deepEqual({ in: rate(now.languages.py.in_sample.after), v3: rate(now.languages.py.dev_v3.after), undo: rate(now.languages.py.undo_named.after) }, { in: "100.0% (13/13)", v3: "77.8% (7/9)", undo: "81.8% (9/11)" });
  assert.deepEqual({ in: rate(now.languages.ts.in_sample.after), v3: rate(now.languages.ts.dev_v3.after), undo: rate(now.languages.ts.undo_named.after) }, want.ts);
  const nowLo = G.generalise({ change: { policy: "show-table-loro" }, ...ctx });
  assert.deepEqual([rate(nowLo.languages.ts.in_sample.after), rate(nowLo.languages.py.in_sample.after)], ["88.6% (31/35)", "100.0% (10/10)"]);
  // The table's `admitted` is what the product recomputes (leave-one-repo-out over its own repos, not hidden).
  const t = G.showTable();
  for (const [lang, fams] of Object.entries(t.languages)) for (const [f, rec] of Object.entries(fams)) assert.equal(rec.admitted, loro(rec.repos).admitted && !t.hidden[lang].includes(f), `${lang} ${f}`);
});

test("r11-default §1, §2, §5: the TS default tier and its flag precision per snapshot and per fold", () => {
  const rd = G.defaultTierReadings(ctx);
  const all = Object.fromEntries(Object.entries(rd).map(([k, r]) => [k, [rate(r.all), flags(r.all), r.all.repos, r.all.flags.untraced]]));
  assert.deepEqual(all, {
    v3: ["75.0% (24/32)", "75.8% (150/198)", 9, 0], r2: ["93.1% (27/29)", "83.8% (254/303)", 8, 0], r3: ["100.0% (29/29)", "86.9% (252/290)", 8, 0],
    r4: ["100.0% (30/30)", "85.6% (256/299)", 8, 0], r5: ["100.0% (30/30)", "88.8% (261/294)", 8, 0], dev3: ["20.0% (1/5)", "31.3% (5/16)", 4, 0],
  });
  const per = (k) => [1, 2, 3, 4, 5].map((f) => (rd[k][f].shown ? `${rate(rd[k][f])} ${rd[k][f].repos}` : null));
  assert.deepEqual(per("v3"), ["50.0% (3/6) 2", "88.9% (8/9) 2", "40.0% (2/5) 2", "91.7% (11/12) 3", null]);
  assert.deepEqual(per("r5"), ["100.0% (4/4) 1", "100.0% (10/10) 2", "100.0% (3/3) 2", "100.0% (13/13) 3", null]);
  assert.deepEqual(per("dev3"), [null, null, null, null, "20.0% (1/5) 4"]);
  assert.deepEqual([1, 2, 3, 4].map((f) => flags(rd.r5[f])), ["89.2% (66/74)", "89.4% (84/94)", "75.0% (6/8)", "89.0% (105/118)"]);
  assert.deepEqual([rate(rd.r5.build), rd.dev3.build.shown], ["100.0% (30/30)", 0]);
  const cli = spawnSync(process.execPath, [join(here, "generalise.mjs"), "--default-tier"], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /dev3 \(5151e5c, .*\): all 20\.0% \(1\/5\), flag precision 31\.3% \(5\/16\)/);
  // r11-default.mjs rests on these readings and still prints its committed output.
  const r = spawnSync(process.execPath, [join(here, "research/2026-11-08/r11-default.mjs")], { cwd: repoRootDir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, readFileSync(join(here, "research/2026-11-08/r11-default.out.txt"), "utf8"));
});

test("default tier in a change: a default card whose outliers change is untraced, and fold 5 joins the design folds", () => {
  const c = ctx.snaps.r5.cards.get("dub/D-d24d21");
  assert.equal(c.tier, "default");
  const diff = { kind: "drift-census-diff", repos: { dub: { removed: [], added: [], changed: [{ ...c, outliers: c.outliers + 1 }] } } };
  const r = G.generalise({ change: { diff }, ...ctx, designFolds: new Set([4]) });
  assert.equal(r.fold5_design_forced, true);
  assert.deepEqual(r.design_folds, [4, 5]);
  const dt = r.languages.ts.default_tier;
  assert.deepEqual([dt.before["4"].flags.untraced, dt.after["4"].flags.untraced, dt.after["4"].flags.traced + 1, dt.before["4"].flags.traced], [0, 1, 13, 13]);
  assert.deepEqual([rate(dt.after["4"]), rate(dt.after["5"])], ["100.0% (13/13)", "20.0% (1/5)"]);
  const kept = G.generalise({ change: { policy: "I1" }, ...ctx, designFolds: new Set([4]) });
  assert.deepEqual([kept.fold5_design_forced, kept.design_folds], [false, [4]]);
});

test("dev3 re-census at main equals F10's: 60 census outputs byte-identical; census --json shows the queue's 14 cards", () => {
  const rec = JSON.parse(readFileSync(join(repoRootDir, G.RUNS, "dev3-recensus-2026-11-08/compare.json"), "utf8"));
  assert.deepEqual([rec.identical, rec.differ, Object.keys(rec.repos).length], [60, 0, 20]);
  for (const [k, x] of Object.entries(rec.repos)) {
    assert.ok(ctx.folds.repos.get(k)?.fold === 5, k);
    for (const [f, h] of Object.entries(x.files)) {
      assert.equal(h.f10, sha256File(join(repoRootDir, x.run, f)), `${k} ${f}`);
      assert.equal(h.main, h.f10, `${k} ${f}`);
    }
  }
  const cards = G.loadCensusDir(DEV3_CENSUS, ctx.folds);
  assert.equal(readdirSync(DEV3_CENSUS).length, 20);
  const key = (c) => `${c.uid} ${c.tier} ${c.outliers} ${c.family} ${c.lang} ${c.plang}`;
  assert.deepEqual(cards.map(key).sort(), [...ctx.dev3.cards.values()].map(key).sort());
});

// PLAN-R11 §1.4 / WS-C: the candidate-scope label policies (K1, K2-role) drop only default-tier cards of their family.
test("WS-C policies: K1 drops non-entry wrapper defaults, K2 drops tooling layering defaults", () => {
  const card = (o) => ({ tier: "default", family: "wrapper", roleEntry: "-", rolePackage: "", roleDir: "src", roleFile: "*", ...o });
  assert.equal(G.k1Fails(card({})), true);
  assert.equal(G.k1Fails(card({ roleEntry: "*" })), true);
  assert.equal(G.k1Fails(card({ roleEntry: "http" })), false);
  assert.equal(G.k1Fails(card({ tier: "suggestion" })), false);
  assert.equal(G.k1Fails(card({ family: "layering" })), false);
  const lay = (o) => card({ family: "layering", ...o });
  assert.equal(G.k2Fails(lay({ roleDir: "scripts" })), true);
  assert.equal(G.k2Fails(lay({ rolePackage: "tools/scripts", roleDir: "**" })), true);
  assert.equal(G.k2Fails(lay({ roleFile: "*.config" })), true);
  assert.equal(G.k2Fails(lay({ roleDir: "src/lib" })), false);
  assert.equal(G.k2Fails(lay({ roleDir: "scripts", tier: "suggestion" })), false);
  assert.equal(G.k2Fails(card({ roleDir: "scripts" })), false);
  assert.equal(G.k2Fails(lay({ outlierFiles: ["apps/x/electron-builder.config.cjs", "scripts/a.ts"] })), true);
  assert.equal(G.k2Fails(lay({ outlierFiles: ["apps/x/vite.config.ts", "apps/x/src/a.ts"] })), false);
  assert.equal(G.k2Fails(lay({ outlierFiles: [] })), false);
  for (const p of ["vite.config.ts", "a/scripts/b.mjs#default"]) assert.equal(G.isToolingPath(p), true, p);
  for (const p of ["src/config.ts", "src/config/index.ts", "src/lib/scripts.ts", "src/configure.ts"]) assert.equal(G.isToolingPath(p), false, p);
  const cs = [card({ uid: "a" }), card({ uid: "b", roleEntry: "rpc" }), lay({ uid: "c", roleDir: "scripts" })];
  assert.deepEqual(G.POLICIES.K1.select(cs, "ts").map((c) => c.uid), ["b", "c"]);
  assert.deepEqual(G.POLICIES.K2.select(cs, "ts").map((c) => c.uid), ["a", "b"]);
});
