// drift-map.mjs: the study re-derivation of Drift's units and roles (roles.rs / mine.rs at F11) and the map-coverage
// measures. Synthetic fact indexes only. (On real repos the runner checks it against the census on every run.)
//
//   node --test eval/study/drift-map.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSummary } from "./apps-coverage.mjs";
import { MIN_ROLE_SIZE, fileClass, includes, isTestPath, keyOf, kindOf, learnKinds, mapCoverage, rolesOf, unitsOf } from "./drift-map.mjs";

const sym = (name, x = {}) => ({ name, kind: "function", exported_as: [name], traits: [], ...x });
const file = (path, symbols = [], x = {}) => ({ path, lang: path.endsWith(".py") ? "py" : "ts", package: "apps/web", parse_ok: true, imports: [], symbols, entry_points: [], ...x });
// 9 route files with an exported handler each, 2 helpers, 3 tests.
const scan = () => ({
  files: [
    ...Array.from({ length: 9 }, (_, i) => file(`apps/web/app/api/r${i}/route.ts`, [sym("GET")], { entry_points: [{ symbol: "GET", kind: "http", adapter: "nextjs" }], imports: [{ module: "apps/web/lib/a.ts" }, { module: i === 0 ? "unresolved:apps/web/x" : "pkg:zod" }] })),
    file("apps/web/lib/a.ts", [sym("a")]),
    file("apps/web/lib/b.ts", [sym("b", { kind: "class", traits: ["base"] })]),
    file("apps/web/lib/a.test.ts", [sym("t")]),
    file("apps/web/examples/x.ts", [sym("x")], { package: "apps/web" }),
  ],
  skipped: [{ path: "apps/web/gen/schema.ts", reason: "generated" }],
  models: [],
  packages: [{ path: "apps/web", name: "@acme/web", manifest: "" }],
});

test("tests and examples form no unit; a route literal stem is a file kind; base classes are in no role", () => {
  assert.ok(isTestPath("apps/web/lib/a.test.ts") && isTestPath("svc/tests/x.py") && isTestPath("conftest.py") && !isTestPath("src/testing-utils.ts"));
  const { units } = unitsOf(scan());
  assert.ok(!units.some((u) => /a\.test|examples/.test(u.path)));
  assert.equal(kindOf(learnKinds(scan().files), "apps/web/app/api/r1/route.ts"), "route");
  assert.deepEqual(units.find((u) => u.name === "b").roles, []);
  assert.equal(units.filter((u) => u.package_unit).length, 1);
});

test("roles: >= 8 members; the route handlers form one; includes() holds a role narrowed below depth 5 only under its dir", () => {
  const { units } = unitsOf(scan());
  const roles = rolesOf(units);
  const http = [...roles.values()].find((r) => r.sel.entry === "http" && r.sel.dir === "app");
  assert.equal(http.members.length, 9);
  assert.ok(http.members.length >= MIN_ROLE_SIZE);
  const u = units.find((x) => x.path === "apps/web/app/api/r1/route.ts" && x.name === "GET");
  assert.ok(includes({ ...http.sel, also: [] }, u.roles, u.path));
  const deep = { package: "p", dir: "a/b/c/d/e/f", file: "*", entry: "-", kind: "function" };
  const roles5 = [{ ...deep, dir: "a/b/c/d/e", variety: null, export_name: null, member_kind: null }];
  assert.ok(includes(deep, roles5, "p/a/b/c/d/e/f/x.ts"));
  assert.ok(!includes(deep, roles5, "p/a/b/c/d/e/g/x.ts"));
  assert.ok(includes({ ...deep, dir: "zzz", also: [{ ...deep, dir: "a/b/c/d/e" }] }, roles5, "p/a/b/c/d/e/x.ts"), "a merged card holds each part's members");
  assert.notEqual(keyOf({ ...deep, variety: "enum" }), keyOf(deep));
});

test("a Python role whose members sit in fewer than 3 files is not a role", () => {
  const py = { files: [file("svc/a.py", Array.from({ length: 5 }, (_, i) => sym(`f${i}`)), { package: "svc" }), file("svc/b.py", Array.from({ length: 5 }, (_, i) => sym(`g${i}`)), { package: "svc" })], skipped: [], models: [], packages: [] };
  const roles = rolesOf(unitsOf(py).units);
  assert.ok(![...roles.values()].some((r) => r.sel.kind === "function"));
});

test("map coverage: parsed, package, role, imports, mined and shown coverage, unmapped classes with Drift's reason", () => {
  const s = scan();
  const sources = [...s.files.map((f) => ({ path: f.path, loc: 10 })), { path: "apps/web/gen/schema.ts", loc: 50 }, { path: "apps/web/src/Never.vue", loc: 5 }];
  const { units } = unitsOf(s);
  const http = [...rolesOf(units).values()].find((r) => r.sel.entry === "http" && r.sel.dir === "app");
  const proposal = { id: "D-1", role: { ...http.sel, members: 9 } };
  const m = mapCoverage({ sources, scan: s, pkgs: [{ dir: "apps/web", kind: "ts" }], mined: { default: [proposal], python_opt_in: [proposal] }, shown: { default: [], python_opt_in: [proposal] }, census: { default: { roles: 1, units: units.length }, python_opt_in: { roles: 1, units: units.length } } });
  assert.equal(m.check.default.member_counts_match, 1);
  assert.deepEqual([m.repo.files_parsed.files, m.repo.files_parsed.of_files], [13, 15]);
  assert.equal(m.repo.files_in_role.files, 9);
  assert.equal(m.repo.files_under_mined.files, 9);
  assert.equal(m.repo.files_under_shown.files, 0);
  assert.equal(m.repo.files_under_shown_py.files, 9);
  assert.deepEqual(m.repo.imports, { internal_resolved: 9, internal_unresolved: 1 });
  assert.equal(m.per_package[0].silent.default, true);
  assert.equal(m.per_package[0].silent.python_opt_in, false);
  const why = Object.fromEntries(m.unmapped.map((u) => [`${u.class}:${u.why}`, u.files]));
  assert.equal(why["test:test path (forms no role)"], 1);
  assert.equal(why["util:only base, abstract, view or type-variable classes"], 1);
  assert.equal(why["util:largest role 1-3 members (< 8)"], 1);
  assert.equal(why["other:not parsed: generated"], 1);
  assert.equal(why["component:not in the fact index (not scanned)"], 1);
  assert.equal(why["other:demo or integration-suite code"], 1);
  const sum = mapSummary([{ name: "r", ...m }]);
  assert.equal(sum.pooled.files_in_role.files_rate, 9 / 15);
  assert.equal(sum.imports.rate, 0.9);
  assert.equal(sum.per_package.silent.default, 1);
});

test("file classes by path and facts", () => {
  const c = (p, f) => fileClass(p, f);
  assert.equal(c("web/src/hooks/useThing.ts"), "hook");
  assert.equal(c("web/src/components/Button.tsx"), "component");
  assert.equal(c("api/app/models/user.py"), "ORM model");
  assert.equal(c("api/app/schemas/user.py"), "pydantic/dataclass model");
  assert.equal(c("api/app/api/routes/items.py"), "router/dep");
  assert.equal(c("api/alembic/versions/0001_x.py"), "migration");
  assert.equal(c("scripts/seed.ts"), "script");
  assert.equal(c("web/vite.config.ts"), "config");
  assert.equal(c("web/src/a.test.ts"), "test");
  assert.equal(c("svc/app/services/billing.py"), "service");
  assert.equal(c("web/src/lib/format.ts"), "util");
});
