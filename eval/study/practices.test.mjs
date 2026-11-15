// practices.mjs (M-cov, the M-acc sample and score), practices-run.mjs (the runner, with a stand-in binary), and the
// practice labelling prompt (lib.mjs rubricText + labellerCard, prompt.mjs, the leak check). Hand-written fixtures in
// the `drift practices --json` version-1 shape (PLAN-R13 §0.3): eval/study/practices-fixtures/. Offline.
//
//   node --test eval/study/practices.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { APPROVED_PRACTICE_RUBRICS, PRACTICE_RUBRICS, checkLabel, derivePracticeLabel, labellerCard, promptLeaks, readJsonl, rubricText, sha256Text } from "./lib.mjs";
import { CONCERNS, allocate, apartLines, frameOf, goldSample, pooledCov, practiceUid, recallSample, recallScore, repoCov, sampleRepo, sampleSizes, score, shapeProblems, weightsOf } from "./practices.mjs";
import { BLIND_MANIFEST, neverRun } from "./practices-run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "practices-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const fixture = (n) => JSON.parse(readFileSync(join(here, "practices-fixtures", `${n}.practices.json`), "utf8"));
const NEXT = fixture("next-app");
const API = fixture("fastapi-svc");
const BAD = fixture("inconsistent");

test("shape: the hand-written fixtures are consistent, and an inconsistent document is caught", () => {
  assert.deepEqual(shapeProblems(NEXT), []);
  assert.deepEqual(shapeProblems(API), []);
  const p = shapeProblems(BAD);
  assert.ok(p.some((x) => /known 4 \+ identified 0 \+ none 0 \+ unknown 0 != total 5/.test(x)));
  assert.ok(p.some((x) => /P-ffffff, which the concern does not list/.test(x)));
  assert.ok(shapeProblems({ ...NEXT, version: 2 }).some((x) => /version 2/.test(x)));
  assert.ok(shapeProblems({ ...NEXT, concerns: [{ ...NEXT.concerns[0], id: "auth" }] }).some((x) => /frozen concern ids/.test(x)));
  // a variant kind other than known / none (unknown is never a variant)
  const k = structuredClone(NEXT);
  k.concerns[0].variants[0].kind = "unknown";
  assert.ok(shapeProblems(k).some((x) => /kind "unknown"/.test(x)));
});

test("the engine's own empty-report golden (crates/drift-mine) is read: consistent, no units, no coverage", () => {
  const snap = readFileSync(join(here, "..", "..", "crates", "drift-mine", "tests", "snapshots", "practices__empty_report.snap"), "utf8");
  const j = JSON.parse(snap.slice(snap.indexOf("{")));
  assert.deepEqual(shapeProblems(j), []);
  const cov = repoCov(j);
  assert.equal(cov.summary.population, 0);
  assert.equal(cov.summary.coverage, null);
  assert.ok(cov.concerns.every((c) => c.total === 0));
});

test("M-cov per concern: population, known / none / unknown shares, coverage, the dominant KNOWN variant and the variant count", () => {
  const cov = repoCov(NEXT);
  assert.deepEqual(cov.concerns.map((c) => c.id), CONCERNS, "the nine concerns, in the frozen order");
  const a = cov.concerns.find((c) => c.id === "authn");
  assert.equal(a.total, 20);
  assert.equal(a.coverage, 18 / 20);
  assert.equal(a.known_only, 15 / 20);
  assert.equal(a.share_none, 3 / 20);
  assert.equal(a.share_unknown, 2 / 20);
  assert.deepEqual(a.dominant, { id: "P-a1b2c3", label: "wrapped in withWorkspace()", members: 12, share: 0.6 });
  assert.equal(a.variants, 2, "known variants only: none is not counted");
  assert.deepEqual(a.left_out, { tests: 4, non_production: 1 });
  // a concern the document leaves out has no units, and no coverage
  const z = cov.concerns.find((c) => c.id === "authz");
  assert.equal(z.total, 0);
  assert.equal(z.coverage, null);
  // repo-wide, recomputed from the concerns
  assert.equal(cov.summary.population, 34);
  assert.equal(cov.summary.coverage, 31 / 34);
  assert.equal(cov.summary.concerns_at_target, 2, "authn 90% and errors 100%; config 75% is below");
  // a none-only concern: coverage 100%, no dominant variant
  const n = structuredClone(API);
  n.concerns[1].variants = n.concerns[1].variants.filter((v) => v.kind === "none").map((v) => ({ ...v, members: 6 }));
  n.concerns[1].population = { ...n.concerns[1].population, known: 0, none: 6 };
  const t = repoCov(n).concerns.find((c) => c.id === "testing");
  assert.equal(t.coverage, 1);
  assert.equal(t.dominant, null);
  assert.equal(t.variants, 0);
});

test("M-cov per package: known and none from the package's variants by kind, the rest unknown", () => {
  const rows = repoCov(NEXT).packages.filter((p) => p.concern === "authn");
  const admin = rows.find((p) => p.package === "apps/admin");
  assert.deepEqual([admin.total, admin.known, admin.none, admin.unknown, admin.coverage], [5, 3, 1, 1, 0.8]);
  assert.equal(admin.dominant.id, "P-d4e5f6", "the package's own dominant variant (divergence from the repo's)");
  const web = rows.find((p) => p.package === "apps/web");
  assert.deepEqual([web.total, web.known, web.none, web.unknown], [15, 12, 2, 1]);
});

test("M-cov pooled: counts summed over repos; the median over repos with units; failed and inconsistent repos are 0 in the median [STRICT]", () => {
  const a = repoCov(NEXT);
  const b = repoCov(API);
  const p = pooledCov([{ name: "acme-next", cov: a }, { name: "acme-api", cov: b }]);
  const authn = p.concerns.find((c) => c.id === "authn");
  assert.deepEqual([authn.repos, authn.total, authn.known, authn.none, authn.unknown], [2, 28, 19, 5, 4]);
  assert.equal(authn.coverage, 24 / 28);
  assert.equal(authn.median, (0.9 + 0.75) / 2);
  assert.equal(authn.at_target, false);
  assert.deepEqual(authn.below_target, ["acme-api"]);
  const errors = p.concerns.find((c) => c.id === "errors");
  assert.equal(errors.repos, 1, "acme-api has no errors units: not in the median");
  assert.equal(errors.at_target, true);
  assert.equal(p.concerns.find((c) => c.id === "authz").median, null, "no measured repo has authz units");
  // a failed and an inconsistent repo: out of the pooled counts, 0 in each median
  const q = pooledCov([{ name: "acme-next", cov: a }, { name: "acme-api", cov: b }, { name: "broken", cov: repoCov(BAD) }, { name: "gone", cov: null, failed: "practices exited 1" }]);
  const e = q.concerns.find((c) => c.id === "errors");
  assert.equal(e.total, 10);
  assert.equal(e.median, 0, "1.0 with two zeros");
  assert.equal(e.at_target, false);
  assert.deepEqual(q.failed.map((f) => f.name), ["broken", "gone"]);
  assert.equal(q.concerns.find((c) => c.id === "logging").total, 0, "the inconsistent repo's logging units are not pooled");
});

test("sample frame: examples plus the exceptions that name the variant; unknown from its examples and unknown exceptions; full `units` lists win", () => {
  const f = frameOf(NEXT.concerns[0]);
  assert.equal(f.frame, "examples");
  const units = (id) => f.strata.find((s) => s.stratum === id).units.map((u) => `${u.path}#${u.symbol}`);
  assert.deepEqual(units("P-d4e5f6"), ["apps/admin/app/api/users/route.ts#DELETE", "apps/admin/app/api/users/route.ts#GET", "apps/web/app/api/webhooks/stripe/route.ts#POST"]);
  assert.ok(units("P-0n0n0n").includes("apps/web/app/api/og/route.ts#GET"));
  assert.deepEqual(units("unknown"), ["apps/web/app/api/limits/route.ts#GET", "apps/web/app/api/proxy/route.ts#GET"]);
  // the contract also names a none exception as `none`
  const named = structuredClone(NEXT.concerns[0]);
  named.variants[0].exceptions[1].variant = "none";
  assert.deepEqual(frameOf(named).strata.find((s) => s.stratum === "P-0n0n0n").units, f.strata.find((s) => s.stratum === "P-0n0n0n").units);
  const g = frameOf(API.concerns[0]);
  assert.equal(g.frame, "units");
  assert.equal(g.strata.find((s) => s.stratum === "P-f00001").units.length, 4);
  // a unit listed under two strata is never sampled [STRICT]
  const twice = structuredClone(NEXT.concerns[0]);
  twice.variants[1].examples.push({ path: "apps/web/app/api/links/route.ts", symbol: "GET", line: 8 });
  const h = frameOf(twice);
  assert.equal(h.ambiguous, 2);
  assert.ok(!h.strata.some((s) => s.units.some((u) => u.path === "apps/web/app/api/links/route.ts" && u.symbol === "GET")));
});

test("allocation (F6): at most 5 units per repo per concern; none first when oversampled, then one each for unknown, none and variants with share >= 5%, the rest by members", () => {
  const mk = (kind, members, n, share) => ({ kind, members, share, units: Array.from({ length: n }, (_, i) => ({ path: `f${i}`, symbol: "", line: 0 })) });
  // 80 / 10 / 4 (share 4%) / none 3 / unknown 3, of 100
  const s = [mk("known", 80, 50, 0.8), mk("known", 10, 10, 0.1), mk("known", 4, 4, 0.04), mk("none", 3, 3, 0.03), mk("unknown", 3, 3, 0.03)];
  const { take, unmet } = allocate(s);
  assert.equal(take.reduce((a, b) => a + b), 5, "the hard cap");
  assert.ok(take[1] >= 1 && take[3] >= 1 && take[4] >= 1, "share >= 5%, none and unknown get one each");
  assert.equal(take[2], 0, "a 4% variant has no minimum and loses to the larger ones");
  assert.equal(unmet, 0);
  // none oversampled (authn, validation): min_none first
  const o = allocate(s, { min_none: 3 });
  assert.equal(o.take[3], 3);
  assert.equal(o.take.reduce((a, b) => a + b), 5);
  // seven strata at >= 5%: the cap holds, and two minimums go unmet (recorded)
  const many = Array.from({ length: 7 }, () => mk("known", 10, 5, 1 / 7));
  const m = allocate(many);
  assert.equal(m.take.reduce((a, b) => a + b), 5);
  assert.equal(m.unmet, 2);
});

test("sample: deterministic for a seed, different for another; never more than 5 per concern per repo; uids are stable and carry repo and concern", () => {
  const a = sampleRepo("acme-next", NEXT, { seed: "s1" });
  assert.deepEqual(a, sampleRepo("acme-next", NEXT, { seed: "s1" }));
  const big = structuredClone(API);
  big.concerns[0].variants[0].units = Array.from({ length: 40 }, (_, i) => ({ path: `app/routers/r${String(i).padStart(2, "0")}.py`, symbol: "h", line: 1 }));
  big.concerns[0].variants[0].members = 40;
  big.concerns[0].population = { ...big.concerns[0].population, total: 44, known: 40, coverage: 0.909 };
  big.concerns[0].by_package[0].total = 44;
  const x = sampleRepo("acme-api", big, { seed: "s1" }).items.filter((i) => i.concern === "authn");
  const y = sampleRepo("acme-api", big, { seed: "s2" }).items.filter((i) => i.concern === "authn");
  assert.equal(x.length, 5);
  assert.notDeepEqual(x.map((i) => i.uid), y.map((i) => i.uid));
  for (const [repo, j] of [["acme-next", NEXT], ["acme-api", API], ["acme-api", big]]) {
    const s = sampleRepo(repo, j);
    for (const c of CONCERNS) assert.ok(s.items.filter((i) => i.concern === c).length <= 5, c);
    assert.equal(new Set(s.items.map((i) => i.uid)).size, s.items.length);
  }
  assert.equal(practiceUid("acme-api", "authn", { path: "app/x.py", symbol: "f", line: 3 }), practiceUid("acme-api", "authn", { path: "app/x.py", symbol: "f", line: 3 }));
  assert.match(a.items[0].uid, /^acme-next\/authn\/[0-9a-f]{8}$/);
});

test("stratum weights (F6): each unit stands for its stratum's members over its sampled units; with the unsampled strata the weights sum to the population", () => {
  for (const [repo, j] of [["acme-next", NEXT], ["acme-api", API]]) {
    const s = sampleRepo(repo, j);
    const { w, total, covered, unsampled } = weightsOf(s.items, s.population);
    const sumW = [...w.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumW - covered) < 1e-9, `${repo}: weights sum to the sampled strata's members`);
    assert.equal(covered + unsampled, total);
    assert.equal(total, j.concerns.reduce((n, c) => n + c.population.total, 0), "the population of every concern");
  }
});

test("the describe card has the concern and the unit only: no assignment, attribute, share, count or variant id; the match card adds the description, the assignment and the attributes", () => {
  const { items } = sampleRepo("acme-next", NEXT);
  for (const it of items) {
    const d = labellerCard(it);
    assert.deepEqual(promptLeaks(d), []);
    assert.doesNotMatch(d, /assigned|attributes|P-[0-9a-z]{6}|share|members|dominant|\d+\/\d+|%/);
    assert.match(d, /^concern: {2}\w+/);
    assert.ok(d.includes(it.unit.path));
    assert.doesNotMatch(d, new RegExp(it.assigned.label ? it.assigned.label.replace(/[()]/g, ".") : "^$" + "x"));
  }
  const k = items.find((i) => i.assigned.variant === "P-d4e5f6");
  const m = labellerCard(k, { match: { does: "DOES", mechanisms: [{ mechanism: "middleware", instrument: "clerkMiddleware" }], description: "covered by the Clerk middleware" } });
  assert.match(m, /described: DOES: middleware clerkMiddleware/);
  assert.match(m, /assigned: covered by clerkMiddleware\(\) \(a known variant\)/);
  assert.match(m, /attributes to check against this unit:\n {2}- imports:pkg:@clerk\/nextjs\n {2}- package:apps\/admin/);
  assert.doesNotMatch(m, /control|P-[0-9a-z]{6}|share|dominant/);
  assert.deepEqual(promptLeaks(m), []);
  // census blocks still render as before
  assert.equal(labellerCard(" 3. [D-1] x\n    agents:   shown"), "[D-1] x");
});

test("leak check and the pinned texts: the describe and match rubrics are clean, name no version, and are the pre-registered texts; the describe text never mentions the assignment", () => {
  for (const v of [PRACTICE_RUBRICS.describe, PRACTICE_RUBRICS.match, PRACTICE_RUBRICS["recall-list"], PRACTICE_RUBRICS["recall-match"]]) {
    const t = rubricText(v);
    assert.deepEqual(promptLeaks(t), [], v);
    assert.doesNotMatch(t, /\bv[0-9]\b|study-only|PREREG|STRICT|derivePracticeLabel/);
    assert.equal(sha256Text(t), APPROVED_PRACTICE_RUBRICS[v].sha256, `${v} is the pre-registered text`);
  }
  const d = rubricText(PRACTICE_RUBRICS.describe);
  assert.doesNotMatch(d, /assign|variant|the tool/i);
  for (const o of ["DOES", "NONE", "CANNOT_TELL", "NOT_IN_POPULATION", "UNSURE"]) assert.ok(d.includes(`**${o}`), o);
  for (const c of CONCERNS) assert.ok(d.includes(`**${c}**`), c);
});

test("labels (F6): a description never carries a label; the label follows from the assignment, the description and the matcher's `same`; FALSE_NONE only for none, MISSED only for unknown", () => {
  assert.equal(derivePracticeLabel("known", "DOES", true), "CORRECT");
  assert.equal(derivePracticeLabel("known", "DOES", false), "WRONG_VARIANT");
  assert.equal(derivePracticeLabel("known", "NONE", null), "WRONG_VARIANT");
  assert.equal(derivePracticeLabel("none", "NONE", null), "CORRECT");
  assert.equal(derivePracticeLabel("none", "DOES", null), "FALSE_NONE");
  assert.equal(derivePracticeLabel("unknown", "DOES", null), "MISSED");
  assert.equal(derivePracticeLabel("unknown", "CANNOT_TELL", null), "CORRECT");
  assert.equal(derivePracticeLabel("unknown", "NONE", null), "WRONG_VARIANT");
  assert.equal(derivePracticeLabel("known", "NOT_IN_POPULATION", null), "NOT_IN_POPULATION");
  assert.equal(derivePracticeLabel("none", "CANNOT_TELL", null), "UNSURE");
  const { items } = sampleRepo("acme-next", NEXT);
  const byUid = new Map(items.map((i) => [i.uid, i]));
  const k = items.find((i) => i.assigned.variant === "P-d4e5f6" && i.apart.length);
  const desc = (q, x = {}) => ({ uid: q.uid, labeller: "A", rubric: "practice-describe", does: "DOES", mechanisms: [{ mechanism: "wrap", instrument: "lib/auth.ts#withX" }], description: "wrapped by withX", confidence: "high", checked: [q.unit.path], reason: "opened the handler and the wrapper", ...x });
  const match = (q, x = {}) => ({ uid: q.uid, labeller: "MA", rubric: "practice-match", described_does: "DOES", same: true, apart: q.apart.map((a) => ({ attribute: a, verdict: "TRUE" })), checked: [q.unit.path], reason: "the described wrapper is the assigned one", ...x });
  const cd = (r) => checkLabel(r, { labeller: "A", byUid, expectRubric: "practice-describe" });
  const cm = (r) => checkLabel(r, { labeller: "MA", byUid, expectRubric: "practice-match" });
  assert.deepEqual(cd(desc(k)), []);
  assert.deepEqual(cd(desc(k, { does: "NONE", mechanisms: [] })), []);
  assert.deepEqual(cm(match(k)), []);
  const has = (ps, re) => assert.ok(ps.some((x) => re.test(x)), `${JSON.stringify(ps)} has ${re}`);
  has(cd(desc(k, { label: "CORRECT" })), /not a field of a description/);
  has(cd(desc(k, { mechanisms: [] })), /DOES needs `mechanisms`/);
  has(cd(desc(k, { does: "MAYBE" })), /does "MAYBE"/);
  has(cd(desc(k, { checked: ["x.ts"] })), /unit's file/);
  has(cm(match(k, { same: null })), /needs same: true or false/);
  has(cm(match(k, { apart: [] })), /apart misses/);
  has(cm(match(k, { described_does: undefined })), /described_does/);
  has(cm(match(k, { rubric: "practice-describe" })), /rubric is "practice-describe"/);
});

// A synthetic practice sample over 30 repos: per repo 4 authn units (2 known of a 20-member variant, 2 none of 3).
function synth(nRepos = 30) {
  const items = [];
  const population = [];
  for (let r = 0; r < nRepos; r++) {
    const repo = `r${String(r).padStart(2, "0")}`;
    for (let i = 0; i < 4; i++) {
      const kind = i < 2 ? "known" : "none";
      items.push({ uid: `${repo}/authn/${String(i).padStart(8, "0")}`, repo, kind: "practice", concern: "authn", unit: { path: `a${i}.ts`, symbol: "h", line: 1 }, assigned: { kind }, apart: [], apart_of: {}, stratum: kind === "known" ? "P-k" : "P-n", stratum_members: kind === "known" ? 20 : 3, stratum_sampled: 2, concern_total: 25 });
    }
    population.push({ repo, concern: "authn", total: 25, strata: [{ stratum: "P-k", kind: "known", members: 20, sampled: 2 }, { stratum: "P-n", kind: "none", members: 3, sampled: 2 }, { stratum: "P-x", kind: "known", members: 2, sampled: 0 }] });
  }
  return { items, population };
}
const describeAll = (items, L, f = () => ({})) => items.map((q) => ({ uid: q.uid, does: q.assigned.kind === "none" ? "NONE" : "DOES", ...f(q) }));
const matchAll = (items, f = () => ({})) => items.map((q) => ({ uid: q.uid, same: q.assigned.kind === "known" ? true : null, apart: [], ...f(q) }));

test("score (F6): stratum-weighted accuracy over the whole population (unsampled strata count as not correct), its cluster lower bound as the pass rule, n >= 100 from >= 30 repos", () => {
  const { items, population } = synth();
  const labels = { A: describeAll(items), B: describeAll(items), MA: matchAll(items), MB: matchAll(items) };
  const s = score(items, labels, population);
  const c = s.concerns.find((x) => x.id === "authn");
  assert.equal(c.n, 120);
  assert.equal(c.repos, 30);
  // all sampled units correct; 2 of 25 members per repo are in an unsampled stratum: 23/25
  assert.ok(Math.abs(c.accuracy.p - 23 / 25) < 1e-9);
  assert.equal(c.accuracy_unweighted.p, 1);
  assert.equal(c.met.acc_lower, true);
  assert.equal(c.met.false_none, true, "60 units assigned none, none of them doing the concern");
  assert.equal(c.bar_met, true);
  assert.equal(c.met.n, true);
  // weighting matters: wrong none units weigh 1.5 each, wrong known units 10 each
  const wrongKnown = { ...labels, MA: matchAll(items, (q) => (q.assigned.kind === "known" && q.uid.endsWith("0") ? { same: false } : {})), MB: matchAll(items, (q) => (q.assigned.kind === "known" && q.uid.endsWith("0") ? { same: false } : {})) };
  const w = score(items, wrongKnown, population).concerns[0];
  assert.ok(Math.abs(w.accuracy.p - 13 / 25) < 1e-9, "one known unit of two wrong per repo: 10 of 20 known members");
  assert.ok(Math.abs(w.accuracy_unweighted.p - 90 / 120) < 1e-9);
  assert.equal(w.met.acc_lower, false);
  // under 30 repos the bar is not met whatever the accuracy
  const few = synth(29);
  assert.equal(score(few.items, { A: describeAll(few.items), B: describeAll(few.items), MA: matchAll(few.items), MB: matchAll(few.items) }, few.population).concerns[0].met.repos, false);
});

test("FALSE_NONE (F6): units assigned none that do the concern / units assigned none, weighted; an unresolved description counts as doing it [STRICT]; A/B disagreement goes to C", () => {
  const { items, population } = synth();
  const none = items.filter((q) => q.assigned.kind === "none");
  const fnA = describeAll(items, "A", (q) => (q === none[0] || q === none[1] || q === none[2] ? { does: "DOES", mechanisms: [{ mechanism: "body check", instrument: "getSession" }] } : {}));
  const s = score(items, { A: fnA, B: fnA, MA: matchAll(items), MB: matchAll(items) }, population);
  const c = s.concerns[0];
  assert.equal(c.false_none.n, 60);
  assert.ok(Math.abs(c.false_none.p - 3 / 60) < 1e-9, "3 of the 60 none units, each of weight 1.5 out of 90");
  assert.equal(c.met.false_none, true, "5.0% is within <= 5%");
  // B disagrees on one more none unit: unresolved, so counted as doing it, and C is pending
  const fnB = fnA.map((r) => (r.uid === none[3].uid ? { ...r, does: "DOES", mechanisms: [{ mechanism: "wrap", instrument: "x" }] } : r));
  const s2 = score(items, { A: fnA, B: fnB, MA: matchAll(items), MB: matchAll(items) }, population);
  assert.ok(Math.abs(s2.concerns[0].false_none.p - 4 / 60) < 1e-9);
  assert.equal(s2.concerns[0].met.false_none, false);
  assert.deepEqual(s2.unresolved, [none[3].uid]);
  // C describes it as NONE: resolved
  const s3 = score(items, { A: fnA, B: fnB, C: [{ uid: none[3].uid, does: "NONE" }], MA: matchAll(items), MB: matchAll(items), MC: [{ uid: none[3].uid, same: null, apart: [] }] }, population);
  assert.equal(s3.unresolved.length, 0);
  assert.ok(Math.abs(s3.concerns[0].false_none.p - 3 / 60) < 1e-9);
  // F2: agreement on >= 30 pairs carries kappa and AC1; below, raw agreement only
  assert.ok(Number.isFinite(s2.concerns[0].agreement.ac1));
  assert.equal(score(items.slice(0, 8), { A: fnA, B: fnB, MA: matchAll(items), MB: matchAll(items) }, population).concerns[0].agreement.kappa, undefined);
});

test("M-apart controls: a non-dominant variant's attributes also go on match cards of dominant-variant units; a line is confirmed when the variant has it and the controls do not, a coincidence when they have it too", () => {
  const { items } = sampleRepo("acme-next", NEXT, { seed: "s1" });
  const ctl = items.filter((i) => Object.values(i.apart_of).some((o) => o.role === "control"));
  assert.ok(ctl.length > 0 && ctl.length <= 2 * 2);
  assert.ok(ctl.every((i) => i.stratum === "P-a1b2c3"), "controls are units of the dominant known variant");
  for (const i of ctl) assert.doesNotMatch(labellerCard(i, { match: { does: "DOES", mechanisms: [] } }), /control/);
  const v = (it, f) => ({ uid: it.uid, apart: it.apart.map((a) => ({ attribute: a, verdict: f(it, a) })) });
  const truth = (it, a) => (it.apart_of[a].role === "variant" ? "TRUE" : "FALSE");
  const lines = apartLines(items.map((q) => ({ q, ma: v(q, truth), mb: v(q, truth) })));
  const clerk = lines.filter((l) => l.variant === "P-d4e5f6");
  assert.equal(clerk.length, 2);
  assert.ok(clerk.every((l) => l.confirmed && !l.coincidence));
  const lines2 = apartLines(items.map((q) => ({ q, ma: v(q, () => "TRUE"), mb: v(q, () => "TRUE") })));
  assert.ok(lines2.filter((l) => l.variant === "P-d4e5f6").every((l) => l.coincidence && !l.confirmed));
});

test("sample sizes: none is oversampled towards 66 on authn and validation, within the cap of 5", () => {
  const z = sampleSizes(Array.from({ length: 30 }, () => NEXT));
  assert.deepEqual(z.authn, { repos: 30, cap: 5, min_none: 3 });
  assert.equal(z.errors.min_none, 0, "errors has no none members and is not oversampled");
  assert.equal(sampleSizes(Array.from({ length: 5 }, () => NEXT)).authn.min_none, 5, "never above the cap");
});

test("variant-recall arm (F6): at least 2 seeded packages per repo, from every package with units of any concern; recall = FOUND / every mechanism listed (PARTIAL is not found)", () => {
  const r = recallSample("acme-next", NEXT, { seed: "s1" });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.package).sort(), ["apps/admin", "apps/web"]);
  assert.ok(r.every((x) => x.kind === "practice-recall" && x.concerns.length === 5));
  assert.deepEqual(recallSample("acme-next", NEXT, { seed: "s1" }), r);
  const matches = [{ uid: r[0].uid, concerns: { authn: [{ match: "FOUND" }, { match: "PARTIAL" }, { match: "MISSED" }, { match: "FOUND" }] } }];
  const sc = recallScore(r, matches);
  const authn = sc.concerns.find((c) => c.id === "authn");
  assert.equal(authn.recall.p, 0.5);
  assert.equal(authn.met, false);
  assert.deepEqual(sc.unmatched, [r[1].uid]);
});

test("human gold subset (planned, pending D-4): 20 units per primary concern of the M-acc sample", () => {
  const items = ["authn", "api", "logging"].flatMap((c) => Array.from({ length: 30 }, (_, i) => ({ uid: `r${i}/${c}/${String(i).padStart(8, "0")}`, repo: `r${i}`, concern: c })));
  const g = goldSample(items, { seed: "s1" });
  assert.equal(g.length, 40, "authn and api only: logging is secondary");
  assert.deepEqual(goldSample(items, { seed: "s1" }), g);
});

test("M-cov co-primary bars: known_only >= 80% beside known-or-none >= 90%, from >= 30 repos; none-heavy coverage does not pass", () => {
  // a concern where everything is `none`: known-or-none 100%, known_only 0%
  const n = structuredClone(API);
  n.concerns[1].variants = n.concerns[1].variants.filter((v) => v.kind === "none").map((v) => ({ ...v, members: 6 }));
  n.concerns[1].population = { ...n.concerns[1].population, known: 0, none: 6 };
  n.concerns[1].by_package[0].variants = [{ id: "P-7e5701", members: 6, share: 1 }];
  const repos = Array.from({ length: 30 }, (_, i) => ({ name: `r${i}`, cov: repoCov(i % 2 ? n : API) }));
  const p = pooledCov(repos);
  const t = p.concerns.find((c) => c.id === "testing");
  assert.equal(t.at_target, true, "known-or-none is 100% everywhere");
  assert.equal(t.known_only_at_target, false);
  assert.equal(t.bar_met, false);
  assert.equal(t.primary, false);
  const a = p.concerns.find((c) => c.id === "authn");
  assert.equal(a.repos_at_bar, true);
  assert.ok(p.primary_failed.includes("authn"), "authn at 75% fails, and is published");
});

// ---------------------------------------------------------------------------------------------------------
// The runner, with a stand-in binary
// ---------------------------------------------------------------------------------------------------------
const git = (d, ...a) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8" });
function repoAt(name) {
  const d = join(tmp, "clones", name);
  mkdirSync(d, { recursive: true });
  git(d, "init", "-q");
  writeFileSync(join(d, "a.ts"), `export const x = "${name}";\n`);
  git(d, "add", ".");
  git(d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
  return git(d, "rev-parse", "HEAD").stdout.trim();
}
// A stand-in for `drift`: `practices --help` lists --json and --all-variants; `practices --json` prints the fixture
// named by the checkout's directory (FAKE_FIXTURES/<name>.json), and fails for a name without one.
const fakeBin = join(tmp, "fake-drift.cjs");
writeFileSync(
  fakeBin,
  `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const a = process.argv.slice(2);
if (a[0] !== "practices") process.exit(2);
if (a.includes("--help")) { console.log("Usage: drift practices [--json] [--all-variants] [--units]"); process.exit(0); }
if (!process.env.DRIFT_CACHE_DIR) process.exit(3);
const f = path.join(process.env.FAKE_FIXTURES, path.basename(process.cwd()) + ".json");
if (!fs.existsSync(f)) { console.error("boom"); process.exit(1); }
process.stdout.write(fs.readFileSync(f, "utf8"));
`,
);
chmodSync(fakeBin, 0o755);

test("runner: one repo at a time over a manifest; existing checkouts are used read-only and kept; failures recorded; M-cov tables written", () => {
  const fx = join(tmp, "fixtures");
  mkdirSync(fx, { recursive: true });
  writeFileSync(join(fx, "acme-next.json"), JSON.stringify(NEXT));
  writeFileSync(join(fx, "acme-api.json"), JSON.stringify(API));
  const manifest = join(tmp, "repos.json");
  const repos = [
    { name: "acme-next", url: "https://example.invalid/acme-next", sha: repoAt("acme-next") },
    { name: "acme-api", url: "https://example.invalid/acme-api", sha: repoAt("acme-api") },
    { name: "acme-broken", url: "https://example.invalid/acme-broken", sha: repoAt("acme-broken") },
    { name: "acme-moved", url: "https://example.invalid/acme-moved", sha: "0".repeat(40) },
    { name: "polar", url: "https://example.invalid/polar", sha: "1".repeat(40) },
  ];
  repoAt("acme-moved");
  writeFileSync(manifest, JSON.stringify({ set_id: "test-set", repos }));
  const out = join(tmp, "run");
  const r = spawnSync(process.execPath, [join(here, "practices-run.mjs"), "--manifest", manifest, "--drift", fakeBin, "--out", out, "--clones", join(tmp, "clones")], { encoding: "utf8", env: { ...process.env, FAKE_FIXTURES: fx } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /polar: never run/);
  const files = readdirSync(join(out, "repos")).sort();
  assert.deepEqual(files, ["acme-api.json", "acme-broken.json", "acme-moved.json", "acme-next.json"]);
  assert.match(readJson(join(out, "repos", "acme-broken.json")).failed, /practices exited 1/);
  assert.match(readJson(join(out, "repos", "acme-moved.json")).failed, /not at its pin/);
  const run = readJson(join(out, "run.json"));
  assert.deepEqual(run.drift.flags, ["--json", "--all-variants", "--units"]);
  assert.equal(run.manifest_set_id, "test-set");
  assert.ok(existsSync(join(tmp, "clones", "acme-next", ".git")), "an existing checkout is never deleted");
  assert.ok(!existsSync(join(out, "cache")), "the private cache is deleted");
  const m = readJson(join(out, "mcov.json"));
  const authn = m.pooled.concerns.find((c) => c.id === "authn");
  assert.equal(authn.total, 28);
  assert.equal(authn.median, 0.375, "0.9, 0.75 and the two failed repos as 0");
  const md = readFileSync(join(out, "mcov.md"), "utf8");
  assert.match(md, /\| authn \| primary \| 2 \| 28 \|/);
  assert.match(md, /Failed bars are published: authn, authz, errors, api, validation/);
  assert.match(md, /acme-broken \(practices exited 1/);
  // the same RUNDIR again: refused without --only; another binary refused
  const again = spawnSync(process.execPath, [join(here, "practices-run.mjs"), "--manifest", manifest, "--drift", fakeBin, "--out", out, "--clones", join(tmp, "clones")], { encoding: "utf8", env: { ...process.env, FAKE_FIXTURES: fx } });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already holds a run/);
  // --only redoes one repo and keeps the others in run.json
  writeFileSync(join(fx, "acme-broken.json"), JSON.stringify(API));
  const redo = spawnSync(process.execPath, [join(here, "practices-run.mjs"), "--manifest", manifest, "--drift", fakeBin, "--out", out, "--clones", join(tmp, "clones"), "--only", "acme-broken"], { encoding: "utf8", env: { ...process.env, FAKE_FIXTURES: fx } });
  assert.equal(redo.status, 0, redo.stderr);
  assert.equal(readJson(join(out, "run.json")).repos.length, 4);
  assert.equal(readJson(join(out, "repos", "acme-broken.json")).failed, undefined);

  // the sample and a practice run (F6): A describes blind, MA matches, B and MB the same, C on the disagreement, MC
  const prun = join(tmp, "practice-run");
  const s = spawnSync(process.execPath, [join(here, "practices.mjs"), "sample", "--runs", out, "--out", prun, "--cache", join(tmp, "pcache")], { encoding: "utf8" });
  assert.equal(s.status, 0, s.stderr);
  const q = readJson(join(prun, "queue.json"));
  assert.equal(q.kind, "practice");
  assert.ok(q.items.length > 0 && q.population.length > 0);
  assert.ok(q.items.every((i) => i.repo !== "acme-moved"), "a failed repo is not sampled");
  assert.equal(readJson(join(prun, "recall.json")).items.filter((i) => i.repo === "acme-next").length, 2);
  assert.notEqual(spawnSync(process.execPath, [join(here, "practices.mjs"), "sample", "--runs", out, "--out", prun, "--cache", join(tmp, "pcache")], { encoding: "utf8" }).status, 0, "a sample is drawn once");
  const wd = join(tmp, "workdirs");
  const P = (...a) => spawnSync(process.execPath, [join(here, "prompt.mjs"), ...a, "--run", prun, "--repo", "acme-next", "--workdir-root", wd], { encoding: "utf8" });
  const C = () => spawnSync(process.execPath, [join(here, "collect.mjs"), "--run", prun], { encoding: "utf8" });
  const entry = (L) => readJson(join(prun, "prompts", "index.json")).find((e) => e.labeller === L);
  assert.match(P("label", "--labeller", "A").stderr, /--model ID is required/);
  const pa = P("label", "--labeller", "A", "--model", "model-a");
  assert.equal(pa.status, 0, pa.stderr);
  const eA = entry("A");
  assert.equal(eA.rubric, "practice-describe");
  const text = readFileSync(eA.prompt, "utf8");
  assert.deepEqual(promptLeaks(text), []);
  assert.ok(text.includes(rubricText("practice-describe")));
  const mine = q.items.filter((i) => i.repo === "acme-next");
  for (const it of mine) assert.ok(text.includes(labellerCard(it)), it.uid);
  assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}|assigned:|attributes to check|share|dominant|P-[0-9a-z]{6}/);
  const at = text.indexOf("acme-next");
  assert.equal(at, -1, `the repo name is masked: ${text.slice(Math.max(0, at - 80), at + 40)}`);
  assert.ok(text.includes(eA.repo_key));
  // adjudication is not a practice-run stage
  assert.notEqual(spawnSync(process.execPath, [join(here, "prompt.mjs"), "adjudicate", "--run", prun], { encoding: "utf8" }).status, 0);
  const describe = (it, x = {}) => ({ uid: it.uid, rubric: "practice-describe", does: it.assigned.kind === "none" ? "NONE" : it.assigned.kind === "unknown" ? "CANNOT_TELL" : "DOES", ...(it.assigned.kind === "known" ? { mechanisms: [{ mechanism: "wrap", instrument: "x" }] } : {}), description: `opened ${it.unit.path}`, confidence: "high", checked: [it.unit.path], reason: `opened ${it.unit.path} at line ${it.unit.line} and one hop`, ...x });
  writeFileSync(eA.output, mine.map((it) => JSON.stringify(describe(it))).join("\n") + "\n");
  assert.equal(C().status, 0);
  // MA: the match card carries A's description; the describe step's labels are never shown to B
  assert.match(P("match", "--labeller", "MB", "--model", "model-m").stderr, /MB matches B's descriptions once they are collected/);
  const pm = P("match", "--labeller", "MA", "--model", "model-m");
  assert.equal(pm.status, 0, pm.stderr);
  const eMA = entry("MA");
  const mtext = readFileSync(eMA.prompt, "utf8");
  assert.ok(mtext.includes(rubricText("practice-match")));
  assert.match(mtext, /described: (DOES|NONE|CANNOT_TELL)/);
  assert.match(mtext, /assigned: /);
  const matchRec = (it, x = {}) => ({ uid: it.uid, rubric: "practice-match", described_does: describe(it).does, same: it.assigned.kind === "known" && describe(it).does === "DOES" ? true : null, apart: it.apart.map((a) => ({ attribute: a, verdict: "TRUE" })), checked: [it.unit.path], reason: `matched ${it.unit.path} against the assignment`, ...x });
  writeFileSync(eMA.output, mine.map((it) => JSON.stringify(matchRec(it))).join("\n") + "\n");
  const cm = C();
  assert.equal(cm.status, 0, cm.stdout);
  assert.ok(existsSync(join(prun, "labels", "MA", "acme-next.jsonl")));
  // B on A's model is refused (F4); B on its own model describes one unit differently
  assert.match(P("label", "--labeller", "B", "--model", "model-a").stderr, /three different models/);
  assert.equal(P("label", "--labeller", "B", "--model", "model-b").status, 0);
  const first = mine.find((it) => it.assigned.kind === "known");
  writeFileSync(entry("B").output, mine.map((it) => JSON.stringify(describe(it, { reason: `B opened ${it.unit.path} and one hop`, ...(it === first ? { does: "NONE", mechanisms: [] } : {}) }))).join("\n") + "\n");
  assert.equal(C().status, 0);
  assert.equal(P("match", "--labeller", "MB", "--model", "model-m").status, 0);
  writeFileSync(entry("MB").output, mine.map((it) => JSON.stringify(matchRec(it, { reason: `MB matched ${it.unit.path}`, ...(it === first ? { described_does: "NONE", same: null } : {}) }))).join("\n") + "\n");
  assert.equal(C().status, 0);
  // C (a third model) is shown that unit only
  assert.match(P("label", "--labeller", "C", "--model", "model-b").stderr, /three different models/);
  assert.equal(P("label", "--labeller", "C", "--model", "model-c").status, 0);
  assert.deepEqual(entry("C").expected, [first.uid]);
  writeFileSync(entry("C").output, JSON.stringify(describe(first, { reason: "C opened the handler and one hop", does: "DOES", mechanisms: [{ mechanism: "body check", instrument: "auth()" }] })) + "\n");
  assert.equal(C().status, 0);
  assert.equal(P("match", "--labeller", "MC", "--model", "model-m").status, 0);
  writeFileSync(entry("MC").output, JSON.stringify(matchRec(first, { reason: "MC matched it: another mechanism", same: false })) + "\n");
  assert.equal(C().status, 0);
  assert.ok(readJsonl(join(prun, "labels", "C", "acme-next.jsonl")).every((r) => r.model === "model-c"), "collect.mjs stamps the model");
  // the variant-recall arm: L1 lists blind (no tool output on the card), R1 matches each listed mechanism
  const rec = readJson(join(prun, "recall.json")).items.filter((i) => i.repo === "acme-next");
  assert.match(P("recall-match", "--labeller", "R1", "--model", "model-r").stderr, /R1 matches L1's lists once they are collected/);
  const pl = P("recall-list", "--labeller", "L1", "--model", "model-l");
  assert.equal(pl.status, 0, pl.stderr);
  const eL = entry("L1");
  const ltext = readFileSync(eL.prompt, "utf8");
  assert.ok(ltext.includes(rubricText("practice-recall-list")));
  for (const it of rec) assert.ok(ltext.includes(labellerCard(it)));
  assert.doesNotMatch(ltext, /tool:|P-[0-9a-z]{6}|withWorkspace|clerkMiddleware/, "the lister sees no tool output");
  assert.deepEqual(promptLeaks(ltext), []);
  const list = (it) => ({ uid: it.uid, rubric: "practice-recall-list", concerns: { authn: [{ mechanism: "wrap", instrument: "withWorkspace", example: "app/api/links/route.ts" }, { mechanism: "body check", instrument: "auth()", example: "app/api/x/route.ts" }], authz: [], validation: [], errors: [], api: [] }, checked: ["app/api/links/route.ts"], reason: `listed ${it.package} by reading its routes` });
  writeFileSync(eL.output, rec.map((it) => JSON.stringify(list(it))).join("\n") + "\n");
  assert.equal(C().status, 0);
  assert.equal(P("recall-match", "--labeller", "R1", "--model", "model-r").status, 0);
  const eR = entry("R1");
  assert.match(readFileSync(eR.prompt, "utf8"), /listed:\n {4}1\. wrap withWorkspace/);
  assert.match(readFileSync(eR.prompt, "utf8"), /tool:/);
  // one answer short for authn: refused; then a full answer
  writeFileSync(eR.output, rec.map((it) => JSON.stringify({ uid: it.uid, rubric: "practice-recall-match", concerns: { authn: [{ match: "FOUND" }], authz: [], validation: [], errors: [], api: [] }, checked: ["a.ts"], reason: `matched ${it.package}` })).join("\n") + "\n");
  assert.match(C().stdout, /1 answers for 2 listed mechanisms/);
  writeFileSync(eR.output, rec.map((it) => JSON.stringify({ uid: it.uid, rubric: "practice-recall-match", concerns: { authn: [{ match: "FOUND" }, { match: "MISSED" }], authz: [], validation: [], errors: [], api: [] }, checked: ["a.ts"], reason: `matched ${it.package}` })).join("\n") + "\n");
  assert.equal(C().status, 0);
  const sc = spawnSync(process.execPath, [join(here, "practices.mjs"), "score", "--run", prun], { encoding: "utf8" });
  assert.equal(sc.status, 0, sc.stderr);
  const recall = readJson(join(prun, "score.json")).recall;
  assert.equal(recall.concerns.find((c) => c.id === "authn").recall.p, 0.5);
  assert.match(readFileSync(join(prun, "score.md"), "utf8"), /## Variant recall/);
  const scored = readJson(join(prun, "score.json"));
  assert.equal(scored.pooled.counts.WRONG_VARIANT, 1, "C's label (from its description and MC) is final");
  assert.equal(scored.pooled.counts.UNLABELLED, q.items.length - mine.length, "the repos nobody labelled count against accuracy");
  assert.match(readFileSync(join(prun, "score.md"), "utf8"), /Labelled by models, not maintainers/);
});

test("runner guards: blind and held-out manifests need --blind-operator; a binary without `practices` is refused; polar and CTFd never run", () => {
  for (const p of ["eval/holdout.json", "eval/holdout-2-2026-11-07-py.json", "scratchpad/apps13-blind/apps13-blind.json", "x/apps-blind.json", "eval/apps11-blind-hashes.json"]) assert.match(p, BLIND_MANIFEST, p);
  for (const p of ["eval/repos.json", "eval/apps11-build.json", "eval/dev4-2026-11-08.json"]) assert.doesNotMatch(p, BLIND_MANIFEST, p);
  const r = spawnSync(process.execPath, [join(here, "practices-run.mjs"), "--manifest", "eval/holdout.json", "--drift", fakeBin, "--out", join(tmp, "x"), "--clones", tmp], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /only its operator/);
  const noPractices = join(tmp, "old-drift.cjs");
  writeFileSync(noPractices, "#!/usr/bin/env node\nprocess.exit(2)\n");
  chmodSync(noPractices, 0o755);
  writeFileSync(join(tmp, "m.json"), JSON.stringify({ repos: [] }));
  const o = spawnSync(process.execPath, [join(here, "practices-run.mjs"), "--manifest", join(tmp, "m.json"), "--drift", noPractices, "--out", join(tmp, "y"), "--clones", tmp], { encoding: "utf8" });
  assert.notEqual(o.status, 0);
  assert.match(o.stderr, /no `practices --json` subcommand/);
  assert.ok(neverRun({ name: "CTFd" }) && neverRun({ name: "x", repo: "polarsource/polar" }) && !neverRun({ name: "dub" }));
});

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
