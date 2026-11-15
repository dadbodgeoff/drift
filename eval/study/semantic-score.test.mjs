// Tests of the WS-G semantic check's offline scorer (research/2026-11-08/sem11-score.mjs): matching labeller verdicts
// to judged members, κ, the flag effect of narrowing, the two admission rules on fixtures, and a mutation check of
// every admission condition (each is one line of the scorer; a mutant must fail a fixture check).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as S from "./research/2026-11-08/sem11-score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCORER = join(here, "research/2026-11-08/sem11-score.mjs");
const SRC = readFileSync(SCORER, "utf8");

const mem = (symbol, flagged = true) => ({ key: `src/${symbol}.ts#${symbol}`, path: `src/${symbol}.ts`, symbol, flagged });

test("labeller verdicts match only a unique judged symbol on a card with the labelled outlier count", () => {
  const card = { members: [mem("ex", false), mem("a"), mem("b"), mem("GET"), { ...mem("GET"), key: "src/x.ts#GET" }], outliers_total: 4 };
  const lab = { outliers: 4, verdicts: [{ L: "A", symbol: "a", verdict: "mistake" }, { L: "B", symbol: "GET", verdict: "legit" }, { L: "B", symbol: "zz", verdict: "legit" }] };
  assert.deepEqual(S.matchVerdicts(card, lab), [{ member: "src/a.ts#a", L: "A", verdict: "mistake" }]);
  assert.deepEqual(S.matchVerdicts({ ...card, outliers_total: 5 }, lab), []);
  assert.deepEqual(S.matchVerdicts(card, { ...lab, verdicts: null }), []);
  // A symbol listed twice among the card's outliers (one not judged) does not match.
  assert.deepEqual(S.matchVerdicts({ ...card, listed_outlier_symbols: ["a", "a", "b", "GET"] }, lab), []);
});

test("κ: perfect, chance and n/a", () => {
  assert.equal(S.kappa([["x", "x"], ["y", "y"]]), 1);
  assert.equal(S.kappa([]), null);
  assert.ok(Math.abs(S.kappa([["x", "x"], ["x", "y"], ["y", "x"], ["y", "y"]])) < 1e-9);
});

test("the flag effect: helped sets apart a not-real flag and no real one; a real flag set apart is a loss", () => {
  const matched = [{ member: "m1", L: "A", verdict: "legit" }, { member: "m1", L: "B", verdict: "one_off" }, { member: "m2", L: "A", verdict: "mistake" }, { member: "m2", L: "B", verdict: "look" }, { member: "m3", L: "A", verdict: "legit" }, { member: "m3", L: "B", verdict: "look" }];
  const e = S.cardFlagEffect({ set_apart: ["m1"] }, matched);
  assert.equal(e.helped, true);
  assert.deepEqual(e.losses, []);
  assert.deepEqual([e.before, e.after], [{ real: 3, n: 6 }, { real: 3, n: 4 }]);
  const bad = S.cardFlagEffect({ set_apart: ["m1", "m2"] }, matched);
  assert.equal(bad.helped, false);
  assert.deepEqual(bad.losses, ["m2"]);
  // A split member set apart is neither help nor loss.
  assert.equal(S.cardFlagEffect({ set_apart: ["m3"] }, matched).helped, false);
});

const eff = (uid, repo, fold, helped, losses, before, after) => ({ uid, repo, fold, helped, losses, before, after });
const flagFixture = () => [
  eff("r1/a", "r1", 1, true, [], { real: 1, n: 3 }, { real: 1, n: 1 }),
  eff("r2/a", "r2", 2, true, [], { real: 2, n: 4 }, { real: 2, n: 2 }),
  eff("r3/a", "r3", 3, true, [], { real: 0, n: 2 }, { real: 0, n: 0 }),
  eff("t1/a", "t1", 5, false, [], { real: 1, n: 2 }, { real: 1, n: 2 }),
];
const shown = (uid, repo, fold, label, before, after) => ({ uid, repo, fold, label, before, after });
const shownFixture = () => [
  shown("r1/a", "r1", 1, "WRONG", true, false), shown("r2/a", "r2", 2, "WRONG", true, false), shown("r3/a", "r3", 3, "TRIVIAL", true, false),
  shown("r1/b", "r1", 1, "ACCEPT", true, true), shown("r2/b", "r2", 2, "ACCEPT", true, true), shown("t1/a", "t1", 5, "ACCEPT", true, true),
];

function fixtureChecks(M) {
  const failed = [];
  const ck = (name, f) => { try { if (!f()) failed.push(name); } catch (e) { failed.push(`${name}: ${e.message}`); } };
  const design = new Set([4, 5]);
  ck("flags: a clean fixture is admitted", () => M.admitFlags(flagFixture(), design).admitted === true);
  ck("flags: helped in 2 repos is not enough", () => M.admitFlags(flagFixture().map((e) => (e.repo === "r3" ? { ...e, helped: false } : e)), design).admitted === false);
  ck("flags: helped in one fold is not enough", () => M.admitFlags(flagFixture().map((e) => ({ ...e, fold: e.fold === 5 ? 5 : 1 })), design).admitted === false);
  ck("flags: a real flag set apart outside the design folds fails", () => M.admitFlags(flagFixture().map((e) => (e.uid === "r1/a" ? { ...e, losses: ["m"] } : e)), design).admitted === false);
  ck("flags: other-fold precision must rise", () => M.admitFlags(flagFixture().map((e) => (e.fold < 4 ? { ...e, after: e.before } : e)), design).admitted === false);
  ck("flags: a fold-5 loss fails", () => M.admitFlags(flagFixture().map((e) => (e.fold === 5 ? { ...e, losses: ["m"] } : e)), design).admitted === false);
  ck("flags: a fold-5 precision fall fails", () => M.admitFlags(flagFixture().map((e) => (e.fold === 5 ? { ...e, after: { real: 0, n: 2 } } : e)), design).admitted === false);
  ck("shown: a clean fixture is admitted", () => M.admitShown(shownFixture(), design).admitted === true);
  ck("shown: helped in 2 repos is not enough", () => M.admitShown(shownFixture().filter((c) => c.uid !== "r3/a"), design).admitted === false);
  ck("shown: helped in one fold is not enough", () => M.admitShown(shownFixture().map((c) => ({ ...c, fold: c.fold === 5 ? 5 : 1 })), design).admitted === false);
  ck("shown: an ACCEPT lost outside the design folds fails", () => M.admitShown(shownFixture().map((c) => (c.uid === "r1/b" ? { ...c, after: false } : c)), design).admitted === false);
  ck("shown: the other-fold rate must rise", () => M.admitShown(shownFixture().map((c) => (c.label === "ACCEPT" ? c : { ...c, fold: c.repo === "r3" ? 5 : 4 })), design).admitted === false);
  ck("shown: a fold-5 ACCEPT lost fails", () => M.admitShown(shownFixture().map((c) => (c.fold === 5 ? { ...c, after: false } : c)), design).admitted === false);
  ck("shown: no fold-5 reading, no admission", () => M.admitShown(shownFixture(), design, undefined, false).admitted === false);
  return failed;
}

test("the real scorer passes every fixture check", () => assert.deepEqual(fixtureChecks(S), []));

const MUTANTS = [
  ["b-a: the help condition always holds", "const a = new Set(helped.map((e) => e.repo)).size >= rule.min_repos && new Set(helped.map((e) => e.fold)).size >= rule.min_folds; // mutation:b-a", "const a = true;"],
  ["b-b: losses outside the design folds pass", "const b = other.every((e) => e.losses.length === 0); // mutation:b-b", "const b = true;"],
  ["b-c: other-fold precision need not rise", "const c = precRises(sum(other, \"before\"), sum(other, \"after\")); // mutation:b-c", "const c = true;"],
  ["b-d: fold 5 need not hold", "const d = f5.every((e) => e.losses.length === 0) && precNotLower(sum(f5, \"before\"), sum(f5, \"after\")); // mutation:b-d", "const d = true;"],
  ["s-a: the help condition always holds", "const a = new Set(helped.map((c) => c.repo)).size >= rule.min_repos && new Set(helped.map((c) => c.fold)).size >= rule.min_folds; // mutation:s-a", "const a = true;"],
  ["s-b: an ACCEPT lost passes", "const b = !lost.some((c) => !design.has(c.fold)); // mutation:s-b", "const b = true;"],
  ["s-c: the other-fold rate need not rise", "const c = oa.shown > 0 && oa.accept * ob.shown > ob.accept * oa.shown; // mutation:s-c", "const c = true;"],
  ["s-d: fold 5 need not hold", "const d = fold5Covered && !lost.some((x) => x.fold === FOLD5) && (fb.shown ? fa.accept * fb.shown >= fb.accept * fa.shown : fa.accept === fa.shown); // mutation:s-d", "const d = true;"],
];

test("mutation check: breaking any admission condition fails a fixture check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sem-mut-"));
  try {
    for (const [i, [what, from, to]] of MUTANTS.entries()) {
      assert.equal(SRC.split(from).length, 2, `mutant "${what}": its text must occur exactly once in the scorer`);
      const base = pathToFileURL(join(here, "research/2026-11-08/")).href;
      const src = SRC.replace(from, to).replace(/from "(\.\.\/\.\.\/[^"]+)"/g, (_, p) => `from ${JSON.stringify(new URL(p, base).href)}`);
      const f = join(dir, `mutant-${i}.mjs`);
      writeFileSync(f, src);
      const failed = fixtureChecks(await import(pathToFileURL(f).href));
      assert.ok(failed.length > 0, `mutant "${what}" passed every fixture check`);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});
