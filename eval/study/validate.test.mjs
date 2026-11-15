// The "other members" rule of label validation (lib.mjs checkLabel, memberFileBound, otherMemberBounds): a label must
// list min(2, the files its role can have members in besides the example's and outliers') further files. Amended
// 2026-11-06 in runs/dev-v3-2026-11-06 (see its README): a role whose members all sit in one file had no two other
// member files to open, and labellers padded `checked` with non-member files to pass.
//
//   node --test eval/study/validate.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { CONFIG_FILE, labellerCard, checkLabel, mayDeclareDjangoModel, memberFileBound, memberFileInfo, otherMemberBounds, roleFileCandidates } from "./lib.mjs";

const FILES = [
  "frontend/src/hooks/api/identities/mutations.tsx",
  "frontend/src/hooks/api/identities/queries.tsx",
  "frontend/src/hooks/api/identities/types.ts",
  "frontend/src/hooks/api/users/mutations.tsx",
  "frontend/src/hooks/api/orgs/mutations.tsx",
  "frontend/src/hooks/api/orgs/mutations.test.tsx",
  "apps/api/src/app/widgets/widgets.controller.ts",
  "apps/api/src/app/inbox/inbox.controller.ts",
  "apps/api/src/app/inbox/feed.controller.ts",
  "apps/web/app/[team]/settings/page.tsx",
  "apps/web/app/[org]/settings/page.tsx",
  "apps/web/app/x/settings/page.tsx",
  "packages/emails/a.ts",
  "packages/emails/sub/b.ts",
  "server/shop/api/views.py",
  "server/blog/api/views.py",
  "server/blog/views.py",
];
const item = (uid, role, example, outlier_files) => ({ uid, repo: uid.split("/")[0], id: uid.split("/")[1], role, example, outlier_files });
const SINGLE = item("r/D-1", { package: "frontend", dir: "src/hooks/api/identities", file: "mutations", entry: "-", kind: "function" }, "frontend/src/hooks/api/identities/mutations.tsx#useA", ["frontend/src/hooks/api/identities/mutations.tsx"]);
const SPREAD = item("r/D-2", { package: "frontend", dir: "src/hooks/api", file: "mutations", entry: "-", kind: "function" }, "frontend/src/hooks/api/identities/mutations.tsx#useA", ["frontend/src/hooks/api/users/mutations.tsx"]);
const label = (uid, checked) => ({ uid, labeller: "A", rubric: "v3", label: "ACCEPT", clear: true, confidence: "high", reason: "a reason long enough", checked });
const othersProblem = (ps) => ps.filter((p) => p.includes("besides the example and outliers"));

test("roleFileCandidates over-approximates the role's files: package, dir prefix (dynamic segments), file kind", () => {
  assert.deepEqual(roleFileCandidates(SINGLE.role, FILES), ["frontend/src/hooks/api/identities/mutations.tsx"]);
  assert.deepEqual(roleFileCandidates(SPREAD.role, FILES), ["frontend/src/hooks/api/identities/mutations.tsx", "frontend/src/hooks/api/users/mutations.tsx", "frontend/src/hooks/api/orgs/mutations.tsx", "frontend/src/hooks/api/orgs/mutations.test.tsx"]);
  assert.deepEqual(roleFileCandidates({ package: "apps/api", dir: "src/app/inbox", file: "*.controller", kind: "function" }, FILES), ["apps/api/src/app/inbox/inbox.controller.ts", "apps/api/src/app/inbox/feed.controller.ts"]);
  assert.deepEqual(roleFileCandidates({ package: "apps/web", dir: "app/[*]/settings", file: "page", kind: "component" }, FILES), ["apps/web/app/[team]/settings/page.tsx", "apps/web/app/[org]/settings/page.tsx"]);
  assert.deepEqual(roleFileCandidates({ package: "packages/emails", dir: ".", file: "*", kind: "function" }, FILES), ["packages/emails/a.ts", "packages/emails/sub/b.ts"]);
  assert.deepEqual(roleFileCandidates({ package: "server", dir: "**", file: "api/views", kind: "class" }, FILES), ["server/shop/api/views.py", "server/blog/api/views.py"]);
  assert.equal(roleFileCandidates({ package: "", dir: "x", file: "(model)", kind: "model" }, FILES), null); // a model source without a bound
  assert.equal(roleFileCandidates(null, FILES), null);
});

test("memberFileBound excludes the example's and every outlier's file", () => {
  assert.equal(memberFileBound(SINGLE, FILES), 0);
  assert.equal(memberFileBound(SPREAD, FILES), 2);
});

test("a single-file role needs no other member files; nothing else is relaxed", () => {
  const byUid = new Map([[SINGLE.uid, SINGLE], [SPREAD.uid, SPREAD]]);
  const otherMembers = new Map([[SINGLE.uid, 0], [SPREAD.uid, 2]]);
  const only = label(SINGLE.uid, ["frontend/src/hooks/api/identities/mutations.tsx", "frontend/src/hooks/api/identities/queries.tsx"].slice(0, 2));
  // checked must still list at least 2 files in all: the example's file and one more
  assert.deepEqual(checkLabel(only, { labeller: "A", byUid, rubric: "v3", otherMembers }), []);
  assert.deepEqual(othersProblem(checkLabel(label(SINGLE.uid, ["frontend/src/hooks/api/identities/mutations.tsx", "x.ts"]), { byUid, rubric: "v3", otherMembers })), []);
  assert.ok(checkLabel(label(SINGLE.uid, ["frontend/src/hooks/api/identities/mutations.tsx"]), { byUid, rubric: "v3", otherMembers }).includes("checked must list at least 2 files opened"));
  // without a bound (or without the map) the rule asks for 2, as before
  assert.equal(othersProblem(checkLabel(only, { byUid, rubric: "v3" })).length, 1);
  assert.equal(othersProblem(checkLabel(only, { byUid, rubric: "v3", otherMembers: new Map() })).length, 1);
  // the example and the outliers stay required
  assert.ok(checkLabel(label(SINGLE.uid, ["a.ts", "b.ts"]), { byUid, rubric: "v3", otherMembers }).some((p) => p.includes("does not include the example file")));
  // a role with further member files still needs 2
  const spread1 = label(SPREAD.uid, ["frontend/src/hooks/api/identities/mutations.tsx", "frontend/src/hooks/api/users/mutations.tsx", "frontend/src/hooks/api/orgs/mutations.tsx"]);
  assert.match(othersProblem(checkLabel(spread1, { byUid, rubric: "v3", otherMembers }))[0], /needs 2 \(other members\)/);
  // a bound of 1 asks for 1
  const one = new Map([[SPREAD.uid, 1]]);
  assert.deepEqual(othersProblem(checkLabel(spread1, { byUid, rubric: "v3", otherMembers: one })), []);
});

const tmp = mkdtempSync(join(tmpdir(), "study-validate-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("otherMemberBounds reads each checkout's tracked files; a missing checkout gives no bound", () => {
  const repo = join(tmp, "r");
  for (const f of FILES) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), "x\n");
  }
  writeFileSync(join(repo, "frontend/src/hooks/api/identities/mutations.untracked.tsx"), "x\n");
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "add", ...FILES]);
  const run = { repos: [{ name: "r", checkout: repo }, { name: "gone", checkout: join(tmp, "nope") }] };
  const gone = item("gone/D-3", SINGLE.role, SINGLE.example, SINGLE.outlier_files);
  const bounds = otherMemberBounds(run, { items: [SINGLE, SPREAD, gone] });
  assert.equal(bounds.get(SINGLE.uid), 0);
  assert.equal(bounds.get(SPREAD.uid), 2);
  assert.equal(bounds.has(gone.uid), false);
});

// 2026-11-07: the further files count as other members only when they can hold one. Two B outputs of relabel 3 failed
// the count; padding `checked` with configs, helpers or paths that are not in the checkout no longer passes it.
test("other members: only tracked, non-config files the role can have members in are counted (memberFileInfo)", () => {
  const repo = join(tmp, "members");
  const files = [...FILES, "frontend/eslint.config.mjs", "frontend/src/hooks/api/apiRequest.ts"];
  for (const f of files) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), "x\n");
  }
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "add", ...files]);
  const SPREAD2 = { ...SPREAD, repo: "members", uid: "members/D-2" };
  const PKG = item("members/D-9", { package: "frontend", dir: ".", file: "*", entry: "-", kind: "package" }, "frontend/src/hooks/api/identities/mutations.tsx#useA", ["frontend/src/hooks/api/users/mutations.tsx"]);
  PKG.role = { ...PKG.role, kind: "package" }; // a package role: no candidate files, so only tracked and non-config count
  const queue = { items: [SPREAD2, PKG] };
  const info = memberFileInfo({ repos: [{ name: "members", checkout: repo }] }, queue);
  assert.equal(info.get(SPREAD2.uid).bound, 2);
  assert.deepEqual([...info.get(SPREAD2.uid).candidates].sort(), ["frontend/src/hooks/api/identities/mutations.tsx", "frontend/src/hooks/api/orgs/mutations.test.tsx", "frontend/src/hooks/api/orgs/mutations.tsx", "frontend/src/hooks/api/users/mutations.tsx"]);
  assert.equal(info.get(PKG.uid).candidates, null);
  const byUid = new Map(queue.items.map((q) => [q.uid, q]));
  const check = (uid, checked) => othersProblem(checkLabel(label(uid, checked), { byUid, rubric: "v3", memberFiles: info }));
  const base = ["frontend/src/hooks/api/identities/mutations.tsx", "frontend/src/hooks/api/users/mutations.tsx"];
  // two real member files: ok
  assert.deepEqual(check(SPREAD2.uid, [...base, "frontend/src/hooks/api/orgs/mutations.tsx", "frontend/src/hooks/api/orgs/mutations.test.tsx"]), []);
  // a config, a helper outside the role's file kind and a path not in the checkout do not count, and the message says why
  const padded = check(SPREAD2.uid, [...base, "frontend/eslint.config.mjs", "frontend/src/hooks/api/apiRequest.ts", "frontend/src/hooks/api/orgs/nope.tsx", "frontend/src/hooks/api/orgs/mutations.tsx"]);
  assert.equal(padded.length, 1);
  assert.match(padded[0], /checked lists 1 files besides the example and outliers, needs 2 \(other members\); rubric v3 "What to open" 3/);
  assert.match(padded[0], /not counted: frontend\/eslint\.config\.mjs \(a config file\), frontend\/src\/hooks\/api\/apiRequest\.ts \(cannot hold a member of the role: outside its package, directory or file kind\), frontend\/src\/hooks\/api\/orgs\/nope\.tsx \(not a tracked file of the checkout\)/);
  // a role without candidate files: any tracked file that is not a config counts
  assert.deepEqual(check(PKG.uid, [...base, "frontend/src/hooks/api/apiRequest.ts", "frontend/src/hooks/api/orgs/mutations.tsx"]), []);
  assert.match(check(PKG.uid, [...base, "frontend/eslint.config.mjs", "frontend/src/hooks/api/apiRequest.ts", "x/not-there.ts"])[0], /needs 2 .*not counted: frontend\/eslint\.config\.mjs \(a config file\), x\/not-there\.ts \(not a tracked file of the checkout\)/);
  // without memberFiles (no checkout), only the count is checked, as before
  assert.deepEqual(othersProblem(checkLabel(label(SPREAD2.uid, [...base, "a.ts", "b.ts"]), { byUid, rubric: "v3" })), []);
  for (const f of ["eslint.config.js", "apps/web/.eslintrc.json", "tsconfig.base.json", "pyproject.toml", "backend/setup.cfg", "package.json", "next.config.mjs"]) assert.ok(CONFIG_FILE.test(f), f);
  for (const f of ["src/package.ts", "src/config/settings.py", "app/tsconfig.ts"]) assert.ok(!CONFIG_FILE.test(f), f);
});

test("model roles: a Django model can be declared in any .py file; only files certain to declare none are left out", () => {
  const SRC = {
    "app/models.py": "from django.db import models\n\nclass A(models.Model):\n    name = models.CharField(max_length=3)\n",
    "app/other/defs.py": "import django.db.models as m\nclass B(m.Model):\n    n: int = m.IntegerField()\n",
    "app/aliased.py": "from django.db.models import (\n    CharField as C,\n)\nclass D(Base): x = C()\n",
    "app/paren.py": "from django.db import models\nclass E(Base):\n    x = (\n        models.ForeignKey('A', on_delete=models.CASCADE)\n    )\n",
    "app/migrations/0001_initial.py": "from django.db import migrations, models\nclass Migration(migrations.Migration):\n    operations = [\n        migrations.AddField(\n            model_name='a',\n            name='n',\n            field=models.CharField(max_length=3),\n        ),\n    ]\n",
    "app/serializers.py": "from rest_framework import serializers\nclass S(serializers.Serializer):\n    name = serializers.CharField()\n",
    "app/doc.py": "from django.db import models\n'''\nclass X(models.Model):\n    name = models.CharField()\n'''\n# y = models.CharField()\n",
    "app/reexport.py": "from .base import models\nclass F(models.Model):\n    name = models.CharField()\n",
    "app/broken.py": "x = (\n",
    "app/views.py": "def f():\n    return 1\n",
    "web/schema.prisma": "model User { id Int @id }\n",
    "web/a.ts": "export const x = 1;\n",
  };
  const files = Object.keys(SRC);
  const read = (f) => SRC[f] ?? null;
  const django = { package: "", dir: "django", file: "(model)", entry: "-", kind: "model" };
  assert.deepEqual(roleFileCandidates(django, files, read), ["app/models.py", "app/other/defs.py", "app/aliased.py", "app/paren.py", "app/broken.py"]);
  assert.equal(mayDeclareDjangoModel(SRC["app/migrations/0001_initial.py"]), false);
  assert.equal(mayDeclareDjangoModel(SRC["app/broken.py"]), true); // cannot follow it: a candidate
  // an unreadable file is a candidate
  assert.deepEqual(roleFileCandidates(django, ["app/gone.py"], () => null), ["app/gone.py"]);
  assert.deepEqual(roleFileCandidates({ ...django, dir: "prisma" }, files, read), ["web/schema.prisma"]);
  assert.equal(roleFileCandidates({ ...django, dir: "sqlalchemy" }, files, read), null);
  assert.equal(roleFileCandidates(django, files), null); // without file contents, no bound
  // lotus-like: every model in one models.py, which is the example's and the outlier's file
  const q = item("lotus/D-9", django, "app/models.py#A", ["app/models.py"]);
  assert.equal(memberFileBound(q, ["app/models.py", "app/views.py", "app/migrations/0001_initial.py"], read), 0);
  assert.equal(memberFileBound(q, files, read), 4);
});

test("other members: a package role counts other packages' manifests, which are config files elsewhere (relabel4)", async () => {
  const { otherMemberRejection } = await import("./lib.mjs");
  const tracked = new Set(["apps/desktop/package.json", "packages/email/package.json", "biome.json"]);
  const pkg = { tracked, candidates: null, packageRole: true };
  assert.equal(otherMemberRejection("apps/desktop/package.json", pkg), null);
  assert.equal(otherMemberRejection("packages/email/package.json", pkg), null);
  assert.equal(otherMemberRejection("biome.json", pkg), "a config file");
  // Any other role: a manifest is still a config file, not a member.
  assert.equal(otherMemberRejection("apps/desktop/package.json", { tracked, candidates: null, packageRole: false }), "a config file");
});

test("labellerCard: a labeller sees the card without its rank and its agents line (the family's labelled accept rate)", () => {
  const block = [
    " 8. [D-742eb6] apps/web: HTTP handlers in app/** (route files) do not throw a bare Error",
    "    evidence: 522/536 (lower bound 0.96, lift 4.1)",
    "    agents:   not shown to agents (family below admission bar: 50% of 2)",
    "    example:  apps/web/app/api/a/route.ts#GET",
    "    outlier:  apps/web/app/api/b/route.ts:11 POST",
  ].join("\n");
  const seen = labellerCard(block);
  assert.equal(seen, ["[D-742eb6] apps/web: HTTP handlers in app/** (route files) do not throw a bare Error", "    evidence: 522/536 (lower bound 0.96, lift 4.1)", "    example:  apps/web/app/api/a/route.ts#GET", "    outlier:  apps/web/app/api/b/route.ts:11 POST"].join("\n"));
  assert.doesNotMatch(seen, /admission bar|agents:/);
  // a summary that mentions agents is kept
  assert.equal(labellerCard(" 1. [D-1] files in agents/** are named `*Agent`\n    agents:   shown to agents"), "[D-1] files in agents/** are named `*Agent`");
});

test("a merged card's files are the union over its parts (role.also, round 9 D): a sibling part's member counts", () => {
  const files = ["backend/cases/views.py", "backend/cases/api.py", "backend/leads/views/lead_views.py", "backend/leads/models.py", "backend/common/permissions.py"];
  const merged = { package: "backend", dir: "cases", file: "*", kind: "function", entry: "http", also: [{ package: "backend", dir: "leads", file: "*", kind: "function", entry: "http" }] };
  assert.deepEqual(roleFileCandidates(merged, files), ["backend/cases/views.py", "backend/cases/api.py", "backend/leads/views/lead_views.py", "backend/leads/models.py"]);
  const { also, ...primary } = merged;
  assert.deepEqual(roleFileCandidates(primary, files), ["backend/cases/views.py", "backend/cases/api.py"]);
  // an unbounded part leaves the whole card unbounded
  assert.equal(roleFileCandidates({ ...merged, also: [{ package: "backend", dir: "leads", kind: "package", file: "*" }] }, files), null);
  // the validator counts the sibling part's file as an other member, and still rejects a file outside every part
  const q = { uid: "r/D-1", repo: "r", example: "backend/cases/views.py#a", outlier_files: [], role: merged };
  const info = { tracked: new Set(files), candidates: new Set(roleFileCandidates(merged, files)), bound: memberFileBound(q, files), packageRole: false };
  assert.equal(info.bound, 3);
  const rec = { uid: "r/D-1", rubric: "v3", label: "ACCEPT", clear: true, confidence: "high", reason: "the reason text is long enough", checked: ["backend/cases/views.py", "backend/cases/api.py", "backend/leads/views/lead_views.py"] };
  const byUid = new Map([["r/D-1", q]]);
  assert.deepEqual(checkLabel(rec, { byUid, rubric: "v3", memberFiles: new Map([["r/D-1", info]]) }), []);
  const bad = { ...rec, checked: ["backend/cases/views.py", "backend/cases/api.py", "backend/common/permissions.py"] };
  assert.match(checkLabel(bad, { byUid, rubric: "v3", memberFiles: new Map([["r/D-1", info]]) }).join(" "), /cannot hold a member of the role/);
});
