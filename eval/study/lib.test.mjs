// lib.mjs helpers added for PLAN-R14 WS-F: cards without evidence numbers (F1), the extended leak check, Gwet's AC1
// (F2), the widest quoted interval, D1's minimum n and cluster lower bound, and the one-sided condition (c) (F3).
//
//   node --test eval/study/lib.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { cohen, conditionC, d1Met, gwetAC1, labellerCard, promptLeaks, widestInterval, wilson } from "./lib.mjs";

const block = [
  " 8. [D-742eb6] apps/web: HTTP handlers in app/** (route files) do not throw a bare Error",
  "    evidence: 522/536 (lower bound 0.96, lift 4.1)",
  "    agents:   not shown to agents (family below admission bar: 50% of 2)",
  "    example:  apps/web/app/api/a/route.ts#GET",
  "    outlier:  apps/web/app/api/b/route.ts:11 POST",
].join("\n");

test("F1: under rubric v4 a census card has no evidence line, lower bound, lift or counts; the rule, example and outliers stay", () => {
  const v4 = labellerCard(block, { rubric: "v4" });
  assert.equal(v4, ["[D-742eb6] apps/web: HTTP handlers in app/** (route files) do not throw a bare Error", "    example:  apps/web/app/api/a/route.ts#GET", "    outlier:  apps/web/app/api/b/route.ts:11 POST"].join("\n"));
  assert.doesNotMatch(v4, /lower bound|lift|\d+\/\d+|evidence/);
  assert.deepEqual(promptLeaks(v4), []);
  // other evidence-number forms are stripped too: "(12 members)", "14 of 15"
  const more = labellerCard(" 2. [D-1] x (12 members, 14 of 15 follow)\n    example:  a.ts#f", { rubric: "v4" });
  assert.doesNotMatch(more, /\d+ members|\d+ of \d+/);
  // v3 and earlier: unchanged (past runs are not re-read under the new card)
  assert.match(labellerCard(block), /evidence: 522\/536 \(lower bound 0\.96, lift 4\.1\)/);
});

test("F1: the leak check also catches evidence numbers and, when given, the repo name", () => {
  assert.ok(promptLeaks("evidence: 25/27 (lower bound 0.77, lift 2.0)").some((p) => /lower bound/.test(p)));
  assert.ok(promptLeaks("lift 2.0").some((p) => /lift/.test(p)));
  assert.ok(promptLeaks("    evidence: 25/27").some((p) => /evidence/.test(p)));
  assert.ok(promptLeaks("You are labelling the repository acme-shop", { repo: "acme-shop" }).some((p) => /repo name/.test(p)));
  assert.deepEqual(promptLeaks("You are labelling the repository R-1a2b3c", { repo: "acme-shop" }), []);
  assert.deepEqual(promptLeaks("a clean prompt"), []);
});

test("F2: Gwet's AC1 against the worked example (118 / 5 / 2 / 0 of 125), where kappa is near zero", () => {
  const pairs = [...Array(118).fill(["yes", "yes"]), ...Array(5).fill(["yes", "no"]), ...Array(2).fill(["no", "yes"])];
  const ac1 = gwetAC1(pairs, ["yes", "no"]);
  assert.equal(ac1.n, 125);
  assert.ok(Math.abs(ac1.po - 0.944) < 1e-9);
  assert.ok(Math.abs(ac1.pe - 0.054432) < 1e-6);
  assert.ok(Math.abs(ac1.ac1 - 0.94076) < 1e-4);
  assert.ok(cohen(pairs, ["yes", "no"]).kappa < 0, "the kappa paradox: kappa is negative on the same table");
  assert.ok(Number.isNaN(gwetAC1([], ["a", "b"]).ac1));
});

test("F3: the quoted interval is the widest of Wilson, bootstrap and cluster-t, so it is never narrower than a cluster interval", () => {
  const w = wilson(45, 50);
  const boot = { lo: 0.8, hi: 0.97 };
  const t = { lo: 0.78, hi: 0.99 };
  const q = widestInterval(w, boot, t);
  assert.equal(q.source, "cluster-t");
  for (const x of [w, boot, t]) assert.ok(q.hi - q.lo >= x.hi - x.lo - 1e-12);
  assert.equal(widestInterval(w, { lo: NaN, hi: NaN }, { lo: NaN, hi: NaN }).source, "wilson", "with no cluster interval, Wilson");
  assert.equal(widestInterval(w, { lo: 0.5, hi: 0.99 }, t).source, "bootstrap");
});

test("F3: D1 under F3 needs n >= 30 and the cluster lower bound >= 95%; without F3 the point estimate (past sets are not re-read)", () => {
  const r = (p, n, lo) => ({ p, n, quoted: { lo } });
  assert.equal(d1Met(r(0.97, 29, 0.96), { f3: true }), false, "n < 30");
  assert.equal(d1Met(r(0.97, 60, 0.93), { f3: true }), false, "lower bound below 95%");
  assert.equal(d1Met(r(1, 60, 0.95), { f3: true }), true);
  assert.equal(d1Met(r(0.96, 10, 0.7), { f3: false }), true, "the 2026-11-05 rule: point estimate only");
  assert.equal(d1Met(r(NaN, 0, NaN), { f3: true }), null);
});

test("F3: condition (c) is one-sided: the blind result may not be more than 10 points BELOW in-sample; above is fine", () => {
  assert.equal(conditionC(1.0, 0.86), true, "a perfect blind result passes");
  assert.equal(conditionC(0.77, 0.86), true);
  assert.equal(conditionC(0.75, 0.86), false);
  assert.equal(conditionC(NaN, 0.86), false);
});
