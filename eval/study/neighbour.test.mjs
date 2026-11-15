// neighbour.mjs (round 11, WS-J): the ground truth per outlier, the gate's decision (as neighbour.rs's holds_back and
// may_hold_back), the leave-one-out, the placing of verdicts on members, the member-level fold rule; and a mutation
// check of each of these branches (each broken in a copy of the module, and a fixture check must fail).
//
//   node --test eval/study/neighbour.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import * as N from "./neighbour.mjs";
import { repoRootDir } from "./lib.mjs";

const here = join(repoRootDir, "eval/study");
const SRC = readFileSync(join(here, "neighbour.mjs"), "utf8");

// A study card: outlier 0 is nearer outlier 1 (0.1) than its nearest holder (0.3); outlier 2 is guarded.
const card = () => ({
  outliers: [
    { member: "a.ts#x", found: true, may_hold_back: true, holder: { member: "h.ts#h", distance: 0.3 }, exempt: null, pair: [null, 0.1, 0.2] },
    { member: "b.ts#y", found: true, may_hold_back: true, holder: { member: "h.ts#h", distance: 0.05 }, exempt: { member: "e.ts#e", code: "another_kind", distance: 0.2 }, pair: [0.1, null, 0.4] },
    { member: "c.ts#z", found: true, may_hold_back: false, holder: { member: "h.ts#h", distance: 0.9 }, exempt: { member: "e.ts#e", code: "another_kind", distance: 0.0 }, pair: [0.2, 0.4, null] },
  ],
});

function fixtureChecks(M) {
  const failed = [];
  const check = (name, f) => {
    try {
      f();
    } catch (e) {
      failed.push(`${name}: ${e.message}`);
    }
  };
  check("truth: either mistake or look keeps", () => {
    assert.deepEqual(M.groundTruth(["legit", "look"]), { truth: "KEEP", mistake: false });
    assert.deepEqual(M.groundTruth(["mistake", "legit"]), { truth: "KEEP", mistake: true });
  });
  check("truth: legit only when every verdict is", () => {
    assert.deepEqual(M.groundTruth(["legit", "not_violation"]), { truth: "LEGIT", mistake: false });
    assert.deepEqual(M.groundTruth(["legit", "one_off"]), { truth: "OTHER", mistake: false });
    assert.deepEqual(M.groundTruth([undefined, "legit"]), { truth: "LEGIT", mistake: false });
    assert.deepEqual(M.groundTruth([]), { truth: "OTHER", mistake: false });
  });
  check("decide: nearer a reviewer's exception holds back", () => assert.deepEqual(M.decide(card(), 0, [1]), { hold: true, why: "nearer_apart" }));
  check("decide: nobody set apart warns", () => assert.deepEqual(M.decide(card(), 0, []), { hold: false, why: "nobody_apart" }));
  check("decide: leave-one-out never sets the member apart from itself", () => assert.deepEqual(M.decide(card(), 0, [0]), { hold: false, why: "nobody_apart" }));
  check("decide: nearer the holders warns", () => assert.deepEqual(M.decide(card(), 1, [0]), { hold: false, why: "nearer_holders" }));
  check("decide: a tie warns", () => {
    const c = card();
    c.outliers[0].pair[1] = 0.3;
    assert.equal(M.decide(c, 0, [1]).hold, false);
  });
  check("decide: guarded never holds back", () => assert.deepEqual(M.decide(card(), 2, [0, 1]), { hold: false, why: "guarded" }));
  check("decide: exemptions only", () => {
    const c = card();
    c.outliers[1].holder.distance = 0.5;
    assert.deepEqual(M.decide(c, 1, []), { hold: true, why: "nearer_apart" });
    assert.deepEqual(M.decide(c, 1, [], { exemptions: false }), { hold: false, why: "nobody_apart" });
  });
  check("place: by the block, in order", () => {
    const block = [{ kind: "outlier", path: "a/route.ts", symbol: "GET" }, { kind: "outlier", path: "b/route.ts", symbol: "GET" }, { kind: "exempt", path: "c.ts", symbol: "C" }];
    const r = M.placeVerdicts({ outliers: [{ symbol: "GET", verdict: "legit" }, { symbol: "GET", verdict: "look" }] }, block, []);
    assert.deepEqual(r, { placed: [{ key: "a/route.ts#GET", verdict: "legit" }, { key: "b/route.ts#GET", verdict: "look" }], unplaced: 0 });
  });
  check("place: an ambiguous symbol out of order is not placed", () => {
    const block = [{ kind: "outlier", path: "a/route.ts", symbol: "GET" }, { kind: "outlier", path: "b/route.ts", symbol: "GET" }];
    const r = M.placeVerdicts({ outliers: [{ symbol: "POST", verdict: "legit" }, { symbol: "GET", verdict: "look" }] }, block, ["a/route.ts#GET", "b/route.ts#GET"]);
    assert.deepEqual(r, { placed: [], unplaced: 2 });
  });
  check("place: a symbol unique now", () => {
    const r = M.placeVerdicts({ outliers: [{ symbol: "Foo", verdict: "legit" }] }, [], ["x.ts#Foo", "y.ts#Bar"]);
    assert.deepEqual(r.placed, [{ key: "x.ts#Foo", verdict: "legit" }]);
  });
  const fold = new Map([["a1", 1], ["a2", 1], ["b1", 2], ["c1", 3], ["e1", 5]]);
  const t = (legitHeld, keepHeld = 0, mistakeHeld = 0) => ({ legitHeld, keepHeld, mistakeHeld });
  check("admission: met", () => assert.equal(M.admission({ a1: t(1), a2: t(2), b1: t(1) }, fold, [5]).admitted, true));
  check("admission: a repo with a KEEP held back is not helped", () => {
    const r = M.admission({ a1: t(1), a2: t(2, 1), b1: t(1) }, fold, [5]);
    assert.deepEqual([r.helped, r.a, r.admitted], [["a1", "b1"], false, false]);
  });
  check("admission: one fold is not enough", () => assert.equal(M.admission({ a1: t(1), a2: t(1), e1: t(1) }, fold, []).helpedFolds.length, 2));
  check("admission: 3 repos in 1 fold fail a", () => assert.equal(M.admission({ a1: t(1), a2: t(1) }, new Map([["a1", 1], ["a2", 1]]), [5], { minRepos: 2 }).a, false));
  check("admission: a MISTAKE outside the design folds fails b", () => {
    const r = M.admission({ a1: t(1), a2: t(2), b1: t(1), c1: t(0, 1, 1) }, fold, [5]);
    assert.deepEqual([r.b, r.admitted, r.mistakesOutside], [false, false, [["c1", 1]]]);
  });
  check("admission: fold 5 is always a design fold", () => {
    const r = M.admission({ a1: t(1), a2: t(2), b1: t(1), e1: t(0, 1, 1) }, fold, []);
    assert.deepEqual([r.design, r.b], [[5], true]);
  });
  return failed;
}

test("the real module passes every fixture check", () => assert.deepEqual(fixtureChecks(N), []));

const MUTANTS = [
  ["truth: mistake not recorded", 'const mistake = vs.includes("mistake"); // mutation:truth-mistake', "const mistake = false;"],
  ["truth: look does not keep", 'if (vs.some((v) => KEEP_VERDICTS.has(v))) return { truth: "KEEP", mistake }; // mutation:truth-keep', 'if (vs.every((v) => KEEP_VERDICTS.has(v))) return { truth: "KEEP", mistake };'],
  ["decide: the guard ignored", 'if (!o.may_hold_back) return { hold: false, why: "guarded" }; // mutation:decide-guard', ""],
  ["decide: the member set apart from itself", "for (const j of apart) if (j !== k && o.pair[j] != null) ds.push(o.pair[j]); // mutation:decide-leave-one-out", "for (const j of apart) ds.push(o.pair[j] ?? 0);"],
  ["decide: a tie holds back", 'return a < o.holder.distance ? { hold: true, why: "nearer_apart" } : { hold: false, why: "nearer_holders" }; // mutation:decide-nearer', 'return a <= o.holder.distance ? { hold: true, why: "nearer_apart" } : { hold: false, why: "nearer_holders" };'],
  ["admission: a KEEP held back still helps", "const helped = Object.entries(byRepo).filter(([, t]) => t.legitHeld > 0 && t.keepHeld === 0).map(([r]) => r); // mutation:admission-helped", "const helped = Object.entries(byRepo).filter(([, t]) => t.legitHeld > 0).map(([r]) => r);"],
  ["admission: a always holds", "const a = helped.length >= minRepos && helpedFolds.size >= minFolds; // mutation:admission-a", "const a = true;"],
  ["admission: b always holds", "const b = mistakesOutside.length === 0; // mutation:admission-b", "const b = true;"],
  ["admission: fold 5 not forced", "const design = new Set([...designFolds, FOLD5]);", "const design = new Set([...designFolds]);"],
];

test("mutation check: breaking any branch fails a fixture check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nb-mut-"));
  try {
    for (const [i, [what, from, to]] of MUTANTS.entries()) {
      assert.equal(SRC.split(from).length, 2, `mutant "${what}": its text must occur exactly once in neighbour.mjs`);
      const src = SRC.replace(from, to)
        .replace('from "./folds.mjs"', `from ${JSON.stringify(pathToFileURL(join(here, "folds.mjs")).href)}`)
        .replace('from "./lib.mjs"', `from ${JSON.stringify(pathToFileURL(join(here, "lib.mjs")).href)}`)
        .replace('from "./generalise.mjs"', `from ${JSON.stringify(pathToFileURL(join(here, "generalise.mjs")).href)}`);
      const f = join(dir, `mutant-${i}.mjs`);
      writeFileSync(f, src);
      const failed = fixtureChecks(await import(pathToFileURL(f).href));
      assert.ok(failed.length > 0, `mutant "${what}" passed every fixture check`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("refuses held-out, dev4 and dev3-operator study directories", () => {
  const folds = { repos: new Map() };
  for (const p of ["/tmp/heldout-x", "/tmp/dev4-study", "/tmp/claude/scratchpad/dev3-keys"]) assert.throws(() => N.loadCards(p, folds), /held-out|dev4|dev3/);
});
