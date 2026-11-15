// Tests of eval/study/coverage/map-coverage.mjs and eval/study/coverage/funnel.mjs (map11).
import { test } from "node:test";
import assert from "node:assert/strict";

import { cardDiff, classify, headlines, labelRows, median, pool, poolTable, roleShares, roleType, unmappedClasses, foldsOf } from "./coverage/map-coverage.mjs";
import { families, keyings, splitFamily, sum } from "./coverage/funnel.mjs";

const row = (path, extra = {}) => ({ path, lang: path.endsWith(".py") ? "py" : "ts", test: false, nonprod: false, roles: [], entry_points: 0, ...extra });

test("classes of unmapped files, by precedence", () => {
  assert.equal(classify(row("svc/otter/tests/test_dive.py", { test: true })), "python test");
  assert.equal(classify(row("svc/otter/tests/conftest.py", { test: true })), "python test fixture");
  assert.equal(classify(row("apps/web/src/card.test.tsx", { test: true })), "TS component test");
  assert.equal(classify(row("apps/web/src/math.test.ts", { test: true })), "TS unit test");
  assert.equal(classify(row("apps/web/src/card.stories.tsx", { test: true })), "TS story");
  assert.equal(classify(row("apps/web/e2e/login.spec.ts", { test: true })), "TS end-to-end test");
  assert.equal(classify(row("examples/basic/index.ts", { nonprod: true })), "demo or example code");
  assert.equal(classify(row("svc/otter/alembic/versions/001_init.py")), "migration");
  assert.equal(classify(row("apps/web/next.config.mjs")), "config");
  assert.equal(classify(row("svc/otter/settings.py")), "config");
  assert.equal(classify(row("libs/pond/pond/__init__.py")), "python package __init__");
  assert.equal(classify(row("tools/scripts/seed.py")), "CLI or script");
  assert.equal(classify(row("apps/web/app/burrows/[id]/page.tsx")), "Next route/page/layout");
  assert.equal(classify(row("svc/otter/api/dives.py", { entry_points: 3 })), "entry-point module (router, handler, job)");
  assert.equal(classify(row("svc/otter/models.py")), "ORM or schema models");
  assert.equal(classify(row("svc/otter/dive_service.py")), "service or repository");
  assert.equal(classify(row("apps/web/src/hooks/burrows.ts")), "React hook");
  assert.equal(classify(row("apps/web/src/burrow-card.tsx")), "React component");
  assert.equal(classify(row("apps/web/src/lib/format.ts")), "lib or util");
  assert.equal(classify(row("svc/otter/dive.py")), "python module");
  assert.equal(classify(row("apps/web/src/dive.ts")), "TS module");
});

test("unmapped classes count only files in no role, by Drift's reason", () => {
  const map = {
    files: [
      row("svc/otter/tests/test_a.py", { test: true, unmapped: "test file: no production role (test roles off)" }),
      row("svc/otter/tests/test_b.py", { test: true, unmapped: "test file: no production role (test roles off)" }),
      row("svc/otter/a.py", { roles: ["R-000001"] }),
      row("svc/otter/b.py", { unmapped: "its groups are too small to be roles" }),
    ],
  };
  assert.deepEqual(unmappedClasses(map), {
    "python test": { "test file: no production role (test roles off)": 2 },
    "python module": { "its groups are too small to be roles": 1 },
  });
});

test("median and pool shares", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const p = pool([{ x: 95 }, { x: 89.9 }, { x: 90 }, { y: 1 }], "x");
  assert.deepEqual(p, { median: 90, mean: 91.6, at_or_above: 2, of: 3 });
});

const share = (pct) => ({ pct, files: 1, of: 1, loc_pct: pct });
const cov = (narrow, shown) => ({
  files: 10,
  measures: { "1_parsed": share(100), "2_package": share(100), "3_role": share(60), "4_internal_imports_resolved": { pct: 99 }, "6_mined": share(20), "7_shown": share(shown) },
  production: { files: 6, role: share(99), narrower_than_package: share(narrow), kind_keyed: share(5), mined: share(30), shown: share(shown) },
  test: { files: 4, test_role: share(80), mined: share(0) },
  conventions: { by_keying: { kind: { mined_cards: 2, files_mined: 5 } } },
  packages: [],
});

test("headlines and the pool table, with folds", () => {
  const h = headlines(cov(70, 0));
  assert.equal(h.prod_narrow, 70);
  assert.equal(h.shown, 0);
  assert.equal(h.test_role, 80);
  const folds = foldsOf({ folds: [{ fold: 1, ts: ["a"], py: [] }, { fold: 5, ts: [], py: ["P01"] }] });
  assert.deepEqual(folds, { a: 1, P01: 5 });
  const repos = {
    a: { fold: 1, ...headlines(cov(92, 10)), unmapped: { "python test": { t: 3 } } },
    P01: { fold: 5, ...headlines(cov(80, 0)), unmapped: { "python test": { t: 1 }, migration: { s: 1 } } },
  };
  const t = poolTable(repos);
  assert.deepEqual(t.prod_narrow, { median: 86, mean: 86, at_or_above: 1, of: 2 });
  assert.equal(t.folds["5"].prod_narrow.median, 80);
  assert.equal(t.unmapped["python test"].files, 4);
  assert.equal(t.unmapped["python test"].share, 20);
  assert.deepEqual(Object.keys(t.unmapped), ["python test", "migration"]);
  assert.deepEqual(t.by_keying.kind, { mined_cards: 4, files_mined: 10 });
});

const fr = (family, keying, lang, stage, n) => ({ family, keying, lang, stage, n });

test("funnel: families with their gates, roles and cards by keying", () => {
  const rows = [
    fr("-", "kind", "ts", "roles", 10),
    fr("-", "kind", "ts", "role_small", 8),
    fr("-", "kind", "ts", "role_mined", 2),
    fr("-", "path", "ts", "roles", 5),
    fr("-", "path", "ts", "role_mined", 5),
    fr("calls", "path", "ts", "observed", 40),
    fr("calls", "path", "ts", "lift", 30),
    fr("calls", "path", "ts", "wilson", 5),
    fr("calls", "path", "ts", "drafted", 5),
    fr("calls", "path", "ts", "call_family_hidden", 5),
    fr("wrapped_by:call", "kind", "ts", "observed", 4),
    fr("wrapped_by:call", "kind", "ts", "drafted", 2),
    fr("wrapped_by:call", "kind", "ts", "mined", 2),
    fr("wrapped_by:call", "kind", "ts", "proposed", 2),
    fr("wrapped_by:call", "kind", "ts", "shown", 1),
    fr("wrapped_by:call", "kind", "ts", "not_listed", 1),
  ];
  const f = families(rows);
  assert.equal(f[0].family, "calls");
  assert.equal(f[0].top_gate, "lift");
  assert.deepEqual(f[0].drops, { lift: 30, wilson: 5, call_family_hidden: 5 });
  assert.equal(f[1].shown, 1);
  assert.equal(f[1].top_gate, null);
  const k = keyings(rows);
  assert.deepEqual(k.map((x) => [x.keying, x.roles, x.mined, x.mined_per_100_roles]), [["kind", 2, 2, 100], ["path", 5, 0, 0]]);
  assert.deepEqual(sum(rows, (r) => r.lang).ts.observed, 44);
  assert.deepEqual(splitFamily("test:calls"), ["calls", true]);
  assert.deepEqual(splitFamily("calls"), ["calls", false]);
});

test("role shares split place, test and kind roles", () => {
  const map = {
    roles: [
      { id: "R-a", selector: { package: "", dir: "src" } },
      { id: "R-t", selector: { package: "*", dir: "**", shape: "py:test" } },
      { id: "R-k", selector: { package: "*", dir: "**", shape: "ts:hook" } },
    ],
    files: [row("src/a.ts", { roles: ["R-a", "R-k"] }), row("tests/test_a.py", { roles: ["R-t"] }), row("x.ts")],
  };
  assert.deepEqual(roleShares(map), { role_places: 33.3, role_test: 33.3, role_kind: 33.3 });
});

test("card diff by role type, and labelling rows with opaque keys", () => {
  const p = (id, shown, shape) => ({ id, shown_by_default: shown, summary: `s ${id}`, role: shape ? { shape } : {}, rule: {}, evidence: {} });
  const before = { a: { proposals: [p("D-1", true), p("D-2", false)] } };
  const after = { a: { proposals: [p("D-1", true), p("D-3", true, "ts:hook"), p("D-4", false, "py:test"), p("D-2", true)] } };
  assert.equal(roleType(p("x", true, "py:fixture")), "test");
  assert.equal(roleType(p("x", true, "ts:component")), "kind");
  const d = cardDiff(before, after);
  assert.deepEqual(d.total, { added_kind: 1, shown_added_kind: 1, added_test: 1, shown_added_place: 1 });
  const { rows, keys } = labelRows(before, after);
  assert.deepEqual(rows.map((r) => r.key), ["M11-001", "M11-002"]);
  assert.deepEqual(keys.map((k) => [k.id, k.role_type]), [["D-3", "kind"], ["D-2", "place"]]);
});
