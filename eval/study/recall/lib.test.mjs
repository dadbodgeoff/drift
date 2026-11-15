// node --test eval/study/recall/lib.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  armOf,
  checkpoints,
  groupStatus,
  hideReason,
  inArm,
  isNew,
  keyOf,
  parseRenames,
  pickSnapshot,
  recallByArm,
  renameKey,
  splitKey,
  track,
  visibilityClass,
  warningsByArm,
} from "./lib.mjs";

test("pickSnapshot: the first first-parent commit at least `back` commits back, else the oldest", () => {
  const fp = Array.from({ length: 10 }, (_, i) => `c${i}`);
  // two commits per first-parent step (merges)
  assert.equal(
    pickSnapshot(fp, (i) => 2 * i, 7),
    4,
  );
  assert.equal(
    pickSnapshot(fp, (i) => i, 200),
    9,
  );
  assert.equal(
    pickSnapshot(fp, (i) => i, 0),
    0,
  );
  assert.equal(pickSnapshot([], () => 0, 5), -1);
});

test("checkpoints: every commit under the cap; a stride plus the head over it", () => {
  assert.deepEqual(checkpoints(["a", "b", "c"], 5), { stride: 1, picked: [0, 1, 2] });
  const r = checkpoints(Array.from({ length: 10 }), 4);
  assert.equal(r.stride, 3);
  assert.deepEqual(r.picked, [2, 5, 8, 9]);
  assert.equal(r.picked.at(-1), 9);
});

test("keys and renames round-trip; only R entries of name-status -z are renames", () => {
  const k = keyOf("D-1", "a/b.ts", "GET /x#y");
  assert.deepEqual(splitKey(k), { id: "D-1", path: "a/b.ts", symbol: "GET /x#y" });
  const z = ["M", "x.ts", "R100", "a/b.ts", "a/c.ts", "D", "gone.ts", "C090", "p.ts", "q.ts", ""].join("\0");
  assert.deepEqual(parseRenames(z), [["a/b.ts", "a/c.ts"]]);
  assert.equal(renameKey(k, [["a/b.ts", "a/c.ts"]]), keyOf("D-1", "a/c.ts", "GET /x#y"));
  assert.equal(renameKey(k, [["z.ts", "w.ts"]]), k);
});

test("isNew: baselined, drift-ignore and unsure are never new; the gate only with gate on", () => {
  assert.equal(isNew("", false), true);
  assert.equal(isNew("b", false), false);
  assert.equal(isNew("s", false), false);
  assert.equal(isNew("u", true), false);
  assert.equal(isNew("n", false), true);
  assert.equal(isNew("n", true), false);
});

const v = (id, path, sym, flags = "") => [id, path, sym, flags];

test("track: introduced, fixed, removed, exempted, unfixed and legacy, across a rename", () => {
  const lock = [keyOf("D-1", "old.ts", "L")];
  const cps = [
    { i: 0, renames: [], v: [v("D-1", "old.ts", "L", "b"), v("D-1", "a.ts", "f"), v("D-1", "b.ts", "g", "n")] },
    {
      i: 1,
      renames: [["a.ts", "a2.ts"]],
      v: [v("D-1", "old.ts", "L", "b"), v("D-1", "a2.ts", "f"), v("D-1", "b.ts", "g"), v("D-2", "c.ts", "h")],
    },
    { i: 4, renames: [], v: [v("D-1", "a2.ts", "f"), v("D-2", "d.ts", "k")], holds: [keyOf("D-1", "b.ts", "g"), keyOf("D-1", "old.ts", "L")] },
    { i: 5, renames: [], v: [], holds: [keyOf("D-1", "a2.ts", "f")], exempt: [keyOf("D-2", "d.ts", "k")] },
  ];
  const { devs, legacy } = track(lock, cps);
  const by = Object.fromEntries(devs.map((d) => [d.key, d]));
  assert.equal(devs.length, 4, "the renamed a.ts is the same deviation");
  assert.equal(by[keyOf("D-1", "a.ts", "f")].status, "fixed");
  assert.equal(by[keyOf("D-1", "a.ts", "f")].keyAtEnd, keyOf("D-1", "a2.ts", "f"));
  assert.equal(by[keyOf("D-1", "a.ts", "f")].end, 3);
  assert.equal(by[keyOf("D-1", "b.ts", "g")].status, "fixed");
  assert.equal(by[keyOf("D-1", "b.ts", "g")].flags, "n", "flags are those at the introducing checkpoint");
  assert.equal(by[keyOf("D-2", "c.ts", "h")].status, "removed");
  assert.equal(by[keyOf("D-2", "d.ts", "k")].status, "exempted");
  assert.equal(by[keyOf("D-2", "d.ts", "k")].introI, 4);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].status, "fixed");
});

test("track: still violating at the last checkpoint is unfixed; an unchecked file is unknown, not fixed", () => {
  const cps = [
    { i: 0, renames: [], v: [v("D-1", "a.ts", "f"), v("D-1", "u.ts", "x")] },
    { i: 1, renames: [], v: [v("D-1", "a.ts", "f")], unchecked: ["u.ts"] },
  ];
  const { devs } = track([], cps);
  assert.deepEqual(
    devs.map((d) => d.status),
    ["unfixed", "unfixed"],
  );
});

test("track: a deviation fixed and broken again is a second deviation", () => {
  const k = v("D-1", "a.ts", "f");
  const cps = [
    { i: 0, renames: [], v: [k] },
    { i: 1, renames: [], v: [], holds: [keyOf("D-1", "a.ts", "f")] },
    { i: 2, renames: [], v: [k] },
  ];
  const { devs } = track([], cps);
  assert.deepEqual(
    devs.map((d) => d.status),
    ["fixed", "unfixed"],
  );
});

const table = {
  max_outliers: 1,
  hidden: { ts: ["calls", "ordering"], py: ["repo"] },
  rule_kinds: { named: "naming", calls: "calls", "wrapped_by:extends": "base_class", directive: null },
  languages: { ts: { naming: { admitted: true }, base_class: { admitted: false } }, py: {} },
};

test("hideReason: the show policy's reasons; the default tier is never hidden", () => {
  assert.equal(hideReason(table, { tier: "default", rule_kind: "calls", language: "ts", outliers: 9 }), null);
  assert.equal(hideReason(table, { tier: "suggestion", rule_kind: "calls", language: "ts", outliers: 0 }), "hidden_family");
  assert.equal(hideReason(table, { tier: "suggestion", rule_kind: "directive", language: "ts", outliers: 0 }), "family_not_admitted");
  assert.equal(
    hideReason(table, { tier: "suggestion", rule_kind: "wrapped_by:extends", language: "ts", outliers: 0 }),
    "family_not_admitted",
  );
  assert.equal(hideReason(table, { tier: "suggestion", rule_kind: "named", language: "ts", outliers: 2 }), "outliers");
  assert.equal(hideReason(table, { tier: "suggestion", rule_kind: "named", language: "ts", outliers: 1 }), null);
  assert.equal(hideReason(table, { tier: "suggestion", rule_kind: "named", language: "py", outliers: 0 }), "family_not_admitted");
});

test("armOf: the candidate tier is never in `shown`; the opt-in view reads the Python columns", () => {
  const base = { tier: "suggestion", language: "ts", agents: false, inShown: true, inPool: true };
  assert.equal(armOf(base), "shown");
  assert.equal(armOf({ ...base, agents: true }), "agents");
  assert.equal(armOf({ ...base, tier: "default" }), "candidate");
  assert.equal(armOf({ ...base, inShown: false }), "pool");
  assert.equal(armOf({ ...base, inShown: false, inPool: false }), "all");
  const py = { tier: "suggestion", language: "py", agents: false, inShown: false, inPool: false, inShownPy: true, inPoolPy: true };
  assert.equal(armOf(py), "all");
  assert.equal(armOf(py, { optin: true }), "shown");
  assert.equal(inArm("shown", "candidate"), true);
  assert.equal(inArm("candidate", "shown"), false);
  assert.equal(visibilityClass(py, table), "python_off");
  assert.equal(visibilityClass({ ...base, inShown: false }, table), "capped");
  assert.equal(
    visibilityClass({ ...base, inShown: false, inPool: false, rule_kind: "calls", outliers: 0 }, table),
    "hidden:hidden_family",
  );
});

test("recall and warnings per arm: nested arms, gate on drops held-back warnings", () => {
  const devs = [
    { arm: "shown", flags: "", status: "fixed" },
    { arm: "candidate", flags: "n", status: "fixed" },
    { arm: "all", flags: "", status: "fixed" },
    { arm: "all", flags: "", status: "unfixed" },
    { arm: "shown", flags: "s", status: "fixed" },
  ];
  const off = recallByArm(devs);
  assert.deepEqual(off.agents, { k: 0, n: 4 });
  assert.deepEqual(off.shown, { k: 1, n: 4 });
  assert.deepEqual(off.candidate, { k: 2, n: 4 });
  assert.deepEqual(off.all, { k: 3, n: 4 });
  const on = recallByArm(devs, { gate: true });
  assert.deepEqual(on.candidate, { k: 1, n: 4 });
  const w = warningsByArm(devs);
  assert.deepEqual(w.all, { warnings: 4, fixed: 3, removed: 0, exempted: 0, unfixed: 1 });
  const g = groupStatus(devs, (d) => d.arm);
  assert.deepEqual(Object.keys(g), ["shown", "all", "candidate"]);
  assert.equal(g.all.unfixed, 1);
});

test("scoreRecord: cards joined to the F11 census, the gate-off comparison, both Python views", async () => {
  const { scoreRecord } = await import("./score.mjs");
  const card = (id, tier, rule_kind, language, extra = {}) => ({ id, tier, rule_kind, language, holders: 9, total: 10, agents: false, shown_by_default: true, ...extra });
  const rec = {
    name: "flask",
    lang: "py",
    fold: 3,
    first_parent_after: 2,
    census: {
      shown: { cards: [] },
      shown_py: { cards: [card("S-1", "suggestion", "named", "py")] },
      pool: { cards: [] },
      pool_py: { cards: [card("S-1", "suggestion", "named", "py"), card("S-9", "suggestion", "named", "py")] },
      study: { cards: [card("S-1", "suggestion", "named", "py"), card("S-2", "suggestion", "before", "py")] },
    },
    lock: [],
    cps: [
      { i: 0, renames: [], v: [["S-1", "a.py", "f", ""], ["S-2", "b.py", "g", "n"]], v_off: [["S-1", "a.py", "f", ""], ["S-2", "b.py", "g", ""]] },
      { i: 1, renames: [], v: [], holds: ["S-1 a.py#f", "S-2 b.py#g"], v_off: [["S-2", "b.py", "g", ""]] },
    ],
  };
  const r = scoreRecord(rec);
  assert.equal(r.meta.f11_ids_missing_from_study, 1, "S-9 is in F11's pool but was not mined by the study binary");
  assert.equal(r.meta.gate_compared_checkpoints, 2);
  assert.equal(r.meta.gate_discrepancies, 1);
  const opt = Object.fromEntries(r.views.optin.devs.map((d) => [d.id, d]));
  assert.equal(opt["S-1"].arm, "shown");
  assert.equal(opt["S-2"].vis, "hidden:hidden_family");
  assert.equal(r.views.default.devs.find((d) => d.id === "S-1").vis, "python_off");
});

test("prNumber: the trailing (#N) of a squash-merge subject only", async () => {
  const { prNumber } = await import("./lib.mjs");
  assert.equal(prNumber("fix: thing (#1234)"), 1234);
  assert.equal(prNumber("Merge pull request #12 from x/y"), null);
  assert.equal(prNumber("see (#12) for more"), null);
  assert.equal(prNumber(""), null);
});

test("shownUnderP1: the first 15 policy-shown cards by rank, at most 4 avoid rules", async () => {
  const { shownUnderP1 } = await import("./lib.mjs");
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: `C${i}`, rank: i + 1, rule_kind: i < 6 ? "avoids:import" : "named" }));
  const s = shownUnderP1(pool.reverse());
  assert.equal(s.size, 15);
  assert.deepEqual(
    ["C0", "C3", "C4", "C5", "C6", "C19"].map((x) => s.has(x)),
    [true, true, false, false, true, false],
  );
});

test("shownUnderP1 defaultInFull: every default-tier card, then suggestions up to the cap", async () => {
  const { shownUnderP1 } = await import("./lib.mjs");
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: `C${i}`, rank: i + 1, tier: i < 10 ? "default" : "suggestion", rule_kind: i < 10 ? "avoids:import" : "named" }));
  const s = shownUnderP1(pool, { defaultInFull: true });
  assert.equal(s.size, 15);
  assert.equal(["C0", "C9", "C10", "C14", "C15"].filter((x) => s.has(x)).join(), "C0,C9,C10,C14");
  const all = shownUnderP1(pool.slice(0, 18).map((c) => ({ ...c, tier: "default" })), { defaultInFull: true });
  assert.equal(all.size, 18, "the default tier is not capped");
});
