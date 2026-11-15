// select-apps.mjs (the apps11 coverage pool) and apps-coverage.mjs: the classifier, the seeded walk and split, the
// replay, the hashed exclusions, and the coverage measures. Offline: no candidate and no blind repo is read.
//
//   node --test eval/study/select-apps.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { coverage, packageOfPath, packagesOf, shownCards } from "./apps-coverage.mjs";
import { poolHash } from "./lib.mjs";
import { SPEC, classify, eligibility, excluded, frameworksOf, hashRow, locCounted, locOk, outputsOf, replayProblems, seedOf, split, structureOf, walkOrder } from "./select-apps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const script = join(here, "select-apps.mjs");
const tmp = mkdtempSync(join(tmpdir(), "select-apps-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const pkg = (o) => JSON.stringify(o);

test("spec: 30 repos split 12/18, permissive licences only, a 256-bit secret commitment and a public seed on a Drift commit", () => {
  assert.equal(SPEC.n, 30);
  assert.equal(SPEC.split.build + SPEC.split.blind, SPEC.n);
  assert.deepEqual(SPEC.split, { build: 12, blind: 18 });
  for (const l of SPEC.licences) assert.ok(!/GPL|MPL|EPL|EUPL|CECILL|OSL|MS-RL/.test(l), l);
  assert.match(SPEC.secret_sha256, /^[0-9a-f]{64}$/);
  const commit = SPEC.seed_public.split(":").at(-1);
  assert.equal(spawnSync("git", ["-C", here, "cat-file", "-e", `${commit}^{commit}`]).status, 0, "the public seed names a Drift commit");
  assert.deepEqual([SPEC.loc.min, SPEC.loc.max], [20000, 500000]);
  assert.ok(SPEC.never.includes("polar") && SPEC.never.includes("ctfd"));
  for (const q of SPEC.queries) assert.match(q, /archived:false fork:false is:public/);
});

test("structure (C1): mixed TS + Python, multi-package TS or multi-service Python; docs, examples, tests, hidden and node_modules members never count", () => {
  assert.equal(structureOf(["package.json", "api/pyproject.toml"]).mix, "ts+py");
  assert.equal(structureOf(["package.json", "apps/web/package.json"]).mix, "multi-ts");
  assert.equal(structureOf(["svc-a/requirements.txt", "svc-b/pyproject.toml"]).mix, "multi-py");
  assert.equal(structureOf(["package.json"]).mix, null);
  assert.equal(structureOf(["package.json", "docs/package.json", "examples/x/package.json", ".github/package.json", "node_modules/a/package.json", "e2e/package.json"]).mix, null);
  assert.equal(structureOf(["requirements.txt", "requirements-dev.txt"]).mix, null, "two manifests in one directory are one Python directory");
  assert.deepEqual(structureOf(["pnpm-workspace.yaml", "package.json", "apps/a/package.json"]).workspace, ["pnpm-workspace.yaml"]);
});

test("frameworks: package.json dependencies (backend: runtime only), private flag; Python requirements by name, not extras or prefixes", () => {
  assert.deepEqual(frameworksOf("web/package.json", pkg({ private: true, dependencies: { "react-dom": "1" }, devDependencies: { express: "1", svelte: "1" } })), { frontend: ["react-dom", "svelte"], backend: [], private: true });
  assert.deepEqual(frameworksOf("api/package.json", pkg({ dependencies: { "@nestjs/core": "1" }, peerDependencies: { "react-dom": "1" } })), { frontend: [], backend: ["@nestjs/core"], private: false });
  assert.deepEqual(frameworksOf("x/package.json", "{ not json"), { frontend: [], backend: [] });
  assert.deepEqual(frameworksOf("requirements.txt", "Django==4.2\nsentry-sdk[fastapi]\nflask-cors\n# litestar\n").backend, ["django"]);
  assert.deepEqual(frameworksOf("pyproject.toml", 'dependencies = [\n  "fastapi[standard]>=0.1",\n]\n[tool.poetry.dependencies]\nflask = "^2"\n').backend, ["fastapi", "flask"]);
  assert.deepEqual(frameworksOf("setup.py", 'install_requires=["litestar>=2", "x"]').backend, ["litestar"]);
  assert.deepEqual(frameworksOf("requirements/base.txt", "djangorestframework\nfastapi-users\n").backend, []);
});

test("shape (C2): a frontend and a different backend directory, or several backends; libraries and the workspace root do not count", () => {
  const ev = (manifests, frameworks) => ({ manifests, frontend: Object.keys(frameworks).filter((p) => frameworks[p].frontend?.length), backend: Object.keys(frameworks).filter((p) => frameworks[p].backend?.length), frameworks });
  const F = (x = {}) => ({ frontend: ["react-dom"], backend: [], private: true, ...x });
  const B = (x = {}) => ({ frontend: [], backend: ["fastapi"], ...x });
  // mixed: a private frontend and a Python backend
  assert.equal(classify(ev(["web/package.json", "api/pyproject.toml"], { "web/package.json": F(), "api/pyproject.toml": B() })).shape, "frontend+backend");
  // several Python services
  assert.equal(classify(ev(["a/requirements.txt", "b/requirements.txt"], { "a/requirements.txt": B(), "b/requirements.txt": B() })).shape, "services");
  // frontend and backend in the same directory only: a single full-stack package, not a frontend plus a service
  assert.equal(classify(ev(["package.json", "x/pyproject.toml"], { "package.json": F({ backend: ["express"] }) })).pass, false);
  // a published library monorepo: adapters with express/fastify under packages/, not private
  assert.equal(classify(ev(["package.json", "packages/a/package.json", "packages/b/package.json"], { "packages/a/package.json": { frontend: [], backend: ["express"], private: false }, "packages/b/package.json": { frontend: [], backend: ["fastify"], private: false } })).pass, false);
  // ... but a non-private package under an application directory counts
  assert.equal(classify(ev(["package.json", "backend/package.json", "frontend/package.json"], { "backend/package.json": { frontend: [], backend: ["fastify"], private: false }, "frontend/package.json": F() })).shape, "frontend+backend");
  // the root package.json of a workspace is neither frontend nor backend
  assert.equal(classify(ev(["package.json", "apps/web/package.json"], { "package.json": F({ backend: ["express"] }), "apps/web/package.json": F() })).pass, false);
  // ... but a root Python manifest is a service
  assert.equal(classify(ev(["pyproject.toml", "ui/package.json"], { "pyproject.toml": B(), "ui/package.json": F() })).shape, "frontend+backend");
  assert.match(classify(ev(["package.json"], {})).why, /^C1/);
});

test("eligibility: metadata filters, never polar or CTFd, and the hashed exclusions by slug, name and owner", () => {
  const it = (x = {}) => ({ full_name: "acme/shop", archived: false, fork: false, is_template: false, license: { spdx_id: "MIT" }, topics: [], stargazers_count: 500, pushed_at: "2026-10-01T00:00:00Z", ...x });
  const none = { slugs: {}, names: {}, hashed: {}, owners: ["geoffreyfernald"] };
  assert.equal(eligibility(it(), none), null);
  assert.equal(eligibility(it({ license: { spdx_id: "AGPL-3.0" } }), none), "no permissive licence");
  assert.equal(eligibility(it({ archived: true }), none), "archived");
  assert.equal(eligibility(it({ full_name: "x/polar" }), none), "never drawn");
  assert.equal(eligibility(it({ full_name: "CTFd/CTFd" }), none), "never drawn");
  assert.equal(eligibility(it({ full_name: "acme/shop-sdk" }), none), "non-application (name)");
  assert.equal(eligibility(it({ topics: ["library"] }), none), "non-application (topic)");
  assert.equal(eligibility(it({ pushed_at: "2025-01-01T00:00:00Z" }), none), "not pushed within 12 months");
  assert.ok(excluded({ ...none, slugs: { [poolHash("slug", "acme/shop")]: ["x"] } }, "Acme/Shop"));
  assert.ok(excluded({ ...none, names: { [poolHash("name", "shop")]: ["x"] } }, "other/shop"));
  assert.ok(excluded({ ...none, hashed: { [poolHash("slug", "acme/shop")]: ["x"] } }, "acme/shop"));
  assert.ok(excluded(none, "geoffreyfernald/shop"));
  assert.ok(!excluded(none, "acme/shop"));
});

test("LOC (C4): source extensions only; vendored, generated, minified and over-1-MB files never count", () => {
  assert.ok(locCounted("apps/web/src/a.tsx", 100));
  assert.ok(locCounted("svc/app/main.py", 100));
  for (const p of ["node_modules/x/a.js", "web/dist/a.js", "a.min.js", "types/a.d.ts", "api/migrations/0001.py", "vendor/a.py", "README.md", "web/.next/a.js"]) assert.ok(!locCounted(p, 100), p);
  assert.ok(!locCounted("big.js", 2_000_000));
  assert.ok(locOk(20000) && locOk(500000) && !locOk(19999) && !locOk(500001) && !locOk(null));
});

// A synthetic draw: a pool, a test secret and commitment, a walk whose evidence passes for some repos.
const secret = "0123456789abcdef0123456789abcdef";
const commitment = createHash("sha256").update(secret).digest("hex");
const passEv = { manifests: ["api/pyproject.toml", "web/package.json"], frontend: ["web/package.json"], backend: ["api/pyproject.toml"], frameworks: { "web/package.json": { frontend: ["react-dom"], backend: [], private: true }, "api/pyproject.toml": { frontend: [], backend: ["fastapi"] } } };
const failEv = { manifests: ["package.json"], frontend: [], backend: [], frameworks: {} };
function synthetic() {
  const pool = Array.from({ length: 80 }, (_, i) => `owner${i}/app${i}`).sort();
  const order = walkOrder(pool, seedOf(secret));
  const walked = [];
  let n = 0;
  for (const repo of order) {
    if (n >= 30) break;
    const ok = Number(repo.slice(5, repo.indexOf("/"))) % 2 === 0;
    walked.push({ repo, sha: "a".repeat(40), evidence: ok ? passEv : failEv, loc: ok ? 50000 : null, verdict: ok ? "accepted" : "skip", why: ok ? null : "C1" });
    if (ok) n++;
  }
  const meta = Object.fromEntries(walked.filter((w) => w.verdict === "accepted").map((w) => [w.repo, { language: "TypeScript", licence: "MIT", size_kb: 5000, stars: 300, pushed_at: "2026-10-01T00:00:00Z" }]));
  return { spec: SPEC, exclusions: { slugs: {}, names: {}, hashed: {}, owners: ["geoffreyfernald"] }, counts: { accepted: n }, pool, walked, meta };
}

test("replay: the synthetic draw replays; another secret, a reordered walk, a flipped verdict, an excluded pool repo or a walk past the 30th are refused", () => {
  const rec = synthetic();
  assert.deepEqual(replayProblems(rec, secret, { commitment }), []);
  assert.match(replayProblems(rec, "f".repeat(32), { commitment })[0], /secret/);
  const swapped = structuredClone(rec);
  [swapped.walked[0], swapped.walked[1]] = [swapped.walked[1], swapped.walked[0]];
  assert.ok(replayProblems(swapped, secret, { commitment }).some((p) => /walk order/.test(p)));
  const flipped = structuredClone(rec);
  const i = flipped.walked.findIndex((w) => w.verdict === "skip");
  flipped.walked[i].verdict = "accepted";
  assert.ok(replayProblems(flipped, secret, { commitment }).some((p) => /does not follow/.test(p)));
  const tooSmall = structuredClone(rec);
  tooSmall.walked.find((w) => w.verdict === "accepted").loc = 100;
  assert.ok(replayProblems(tooSmall, secret, { commitment }).some((p) => /does not follow/.test(p)));
  const ex = structuredClone(rec);
  ex.exclusions.hashed[poolHash("slug", ex.pool[3])] = ["hashed pool eval/x-hashes.json"];
  assert.ok(replayProblems(ex, secret, { commitment }).some((p) => /is excluded/.test(p)));
  const past = structuredClone(rec);
  past.walked.push({ repo: walkOrder(rec.pool, seedOf(secret))[rec.walked.length], sha: null, evidence: failEv, loc: null, verdict: "skip", why: "C1" });
  assert.ok(replayProblems(past, secret, { commitment }).some((p) => /went on after/.test(p)));
  const spec = structuredClone(rec);
  spec.spec = { ...SPEC, n: 31 };
  assert.ok(replayProblems(spec, secret, { commitment }).some((p) => /spec differs/.test(p)));
});

test("split: deterministic, 12 build and 18 blind, disjoint, and the blind half is committed as hashes only", () => {
  const rec = synthetic();
  const a = outputsOf(rec, secret);
  const b = outputsOf(structuredClone(rec), secret);
  assert.deepEqual(a, b);
  assert.equal(a.build.repos.length, 12);
  assert.equal(a.blindHashes.repos_sha256.length, 18);
  const blindRepos = a.blindManifest.repos.map((r) => r.repo);
  assert.equal(new Set([...a.build.repos.map((r) => r.repo), ...blindRepos]).size, 30);
  const text = JSON.stringify(a.blindHashes);
  for (const r of blindRepos) assert.ok(!text.includes(r) && !text.includes(r.split("/")[1]), "no blind name in the committed hashes");
  for (const r of a.blindManifest.repos) assert.ok(a.blindHashes.repos_sha256.some((h) => JSON.stringify(h) === JSON.stringify(hashRow(r.repo, r.sha))));
  assert.notDeepEqual(split(a.build.repos.map((r) => r.repo).concat(blindRepos).sort(), seedOf(secret)).build, split(blindRepos.concat(a.build.repos.map((r) => r.repo)).sort(), seedOf("other")).build);
});

const built = existsSync(join(root, SPEC.outputs.build)) && existsSync(join(root, SPEC.outputs.blind_hashes));
const runVerify = (...extra) => {
  const r = spawnSync(process.execPath, [script, "verify", ...extra], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", HTTPS_PROXY: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9" } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

test("verify (public, offline) passes on the committed build manifest and blind hashes, and refuses tampered copies", { skip: !built && "apps11 not drawn yet" }, () => {
  const ok = runVerify();
  assert.equal(ok.status, 0, ok.out);
  const b = JSON.parse(readFileSync(join(root, SPEC.outputs.build), "utf8"));
  const h = JSON.parse(readFileSync(join(root, SPEC.outputs.blind_hashes), "utf8"));
  const write = (name, v) => {
    const p = join(tmp, name);
    writeFileSync(p, JSON.stringify(v));
    return p;
  };
  // a build repo that is also blind (by hash)
  const overlap = structuredClone(h);
  overlap.repos_sha256[0] = hashRow(b.repos[0].repo, b.repos[0].sha);
  assert.match(runVerify("--hashes", write("h1.json", overlap)).out, /overlaps the blind half/);
  // a build repo replaced by a dev repo (in another pool)
  const dev = structuredClone(b);
  dev.repos[0] = { ...dev.repos[0], repo: "twentyhq/twenty", name: "twenty", url: "https://github.com/twentyhq/twenty" };
  assert.match(runVerify("--build", write("b1.json", dev)).out, /in another pool or mentioned/);
  // a dropped blind hash, an unpinned build repo
  const short = structuredClone(h);
  short.repos_sha256.pop();
  assert.match(runVerify("--hashes", write("h2.json", short)).out, /17 hashes/);
  const unpinned = structuredClone(b);
  unpinned.repos[1].sha = "main";
  assert.match(runVerify("--build", write("b2.json", unpinned)).out, /not pinned/);
});

test("select-holdout.mjs exclusion-hashes: dev repos are excluded by hash; the apps11 blind hashes are a source for every later selection, never for apps11 itself", { skip: !built && "apps11 not drawn yet" }, () => {
  const out = join(tmp, "ex.json");
  const run = (own) => {
    const r = spawnSync(process.execPath, [join(here, "select-holdout.mjs"), "exclusion-hashes", "--own", own, "--out", out, "--at", "HEAD"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /\//, "counts only");
    return JSON.parse(readFileSync(out, "utf8"));
  };
  const h = JSON.parse(readFileSync(join(root, SPEC.outputs.blind_hashes), "utf8"));
  const committed = spawnSync("git", ["-C", root, "cat-file", "-e", `HEAD:${SPEC.outputs.blind_hashes}`]).status === 0;
  const other = run("eval/other-pool.json");
  assert.ok(other.slugs[poolHash("slug", "twentyhq/twenty")], "a dev repo is excluded");
  if (committed) for (const r of h.repos_sha256) assert.ok(other.hashed[r.slug_sha256] && other.hashed[r.name_sha256], "every blind repo is excluded from a later selection");
  const own = run(JSON.parse(spawnSync(process.execPath, [script, "spec"], { encoding: "utf8" }).stdout).own_outputs.join(","));
  for (const r of h.repos_sha256) assert.ok(!own.hashed[r.slug_sha256], "apps11's own hashes are not its exclusions");
});

test("coverage: packages, attribution by example path, silent roots and per-package figures", () => {
  const pk = packagesOf(["package.json", "apps/web/package.json", "services/api/pyproject.toml", "services/api/requirements.txt", "docs/package.json", "pnpm-workspace.yaml"]);
  assert.deepEqual(pk, [{ dir: "apps/web", kind: "ts" }, { dir: "services/api", kind: "py" }]);
  assert.deepEqual(packagesOf(["package.json", "pyproject.toml"]), [{ dir: "", kind: "ts+py" }]);
  assert.equal(packageOfPath("apps/web/src/a.ts", pk), "apps/web");
  assert.equal(packageOfPath("tools/x.ts", pk), null);
  const census = { proposals: [{ id: "D-1", tier: "default", language: "ts", rule_kind: "wrapped_by:call", role: { package: "apps/web" }, example: { path: "src/a.ts" }, shown_by_default: true }, { id: "D-2", shown_by_default: false, example: { path: "x" } }] };
  assert.deepEqual(shownCards(census, pk, "apps/web/").map((c) => [c.id, c.package]), [["D-1", "apps/web"]]);
  const card = (id, p, language = "ts") => ({ id, tier: "suggestion", language, package: p });
  const v = (cards) => ({ cards });
  const repos = [
    { name: "a", packages: [{ dir: "apps/web", kind: "ts", default: v([card("D-1", "apps/web")]) }, { dir: "services/api", kind: "py", default: v([]), python_opt_in: v([card("D-3", "services/api", "py")]) }], root: { default: v([card("D-1", "apps/web")]), python_opt_in: v([card("D-1", "apps/web"), card("D-2", "services/api", "py")]) } },
    { name: "b", packages: [{ dir: "x", kind: "ts", default: v([]) }], root: { default: v([]), python_opt_in: v([]) } },
    { name: "c", failed: "root census: exit 2", packages: [], root: {} },
  ];
  const c = coverage(repos);
  assert.deepEqual(c.root_default.silent_root, { repos: 2, of: 3, rate: 2 / 3 });
  assert.deepEqual(c.root_python_opt_in.silent_root, { repos: 2, of: 3, rate: 2 / 3 });
  assert.deepEqual(c.root_python_opt_in.packages_with_shown, { packages: 2, of: 3 });
  assert.deepEqual(c.per_package_census.packages_with_shown, { packages: 2, of: 3 });
  assert.equal(c.root_default.shown_per_repo.median, 0);
  const labelled = coverage(repos, new Map([["a/D-1", "ACCEPT"], ["a/D-2", "WRONG"]]));
  assert.deepEqual(labelled.labels.precision, { accept: 1, not_wrong: 1, shown: 2, unlabelled: 0 });
  assert.deepEqual(labelled.labels.package_coverage, { packages: 1, of: 3, rate: 1 / 3 });
  assert.equal(labelled.labels.accepted_per_repo.zero, 2);
});
