// select-apps13.mjs (the fresh apps13 blind set): the spec against apps11's, the wider exclusions (the apps11 build half
// and organisations), the replay, the hashes-only outputs and the public check. Offline: no candidate is read.
//
//   node --test eval/study/select-apps13.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { poolHash } from "./lib.mjs";
import { SPEC as APPS11, walkOrder } from "./select-apps.mjs";
import { SPEC, buildHalfOf, eligibility13, hashRow13, hashesProblems, outputsOf, replayProblems, seedOf } from "./select-apps13.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

test("spec: 40 blind (amendment 2; 18, then 30) and no build half, apps11's criteria and queries unchanged, a new public seed on a Drift commit and a new secret commitment", () => {
  assert.equal(SPEC.n, 40);
  assert.deepEqual(SPEC.split, { build: 0, blind: 40 });
  assert.deepEqual(SPEC.amendments.map((a) => [a.n_before, a.n_after]), [[18, 30], [30, 40]]);
  for (const k of ["queries", "licences", "non_app_name", "non_app_topics", "never", "non_product_dir", "js_manifest", "py_manifest", "workspace_file", "app_dir", "backend_py", "backend_ts", "frontend", "loc", "criteria", "pushed_since", "stars", "size_kb"])
    assert.deepEqual(SPEC[k], APPS11[k], k);
  assert.match(SPEC.secret_sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(SPEC.secret_sha256, APPS11.secret_sha256);
  assert.notEqual(SPEC.seed_public, APPS11.seed_public);
  const commit = SPEC.seed_public.split(":").at(-1);
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(SPEC.outputs, { blind_hashes: "eval/apps13-blind-hashes.json" });
  assert.ok(SPEC.never.includes("polar") && SPEC.never.includes("ctfd"));
});

// The seed's commit is from the history before the public snapshot (Drift 0.1.0-dev: first public snapshot), which
// squashed it away, so a clone of the public repository may not have it: checked where it is present, skipped (and
// shown as skipped) where it is not, as select-holdout.test.mjs does for its recorded refs.
const seedCommit = SPEC.seed_public.split(":").at(-1);
const seedPresent = spawnSync("git", ["-C", here, "cat-file", "-e", `${seedCommit}^{commit}`]).status === 0;
test("spec: the apps13 public seed's Drift commit is in this clone", { skip: !seedPresent && `seed commit ${seedCommit} not in this clone (pre-snapshot history)` }, () => {
  assert.equal(spawnSync("git", ["-C", here, "cat-file", "-t", seedCommit], { encoding: "utf8" }).stdout.trim(), "commit", "the public seed names a Drift commit");
});

const it = (x = {}) => ({ full_name: "acme/shop", archived: false, fork: false, is_template: false, license: { spdx_id: "MIT" }, topics: [], stargazers_count: 500, pushed_at: "2026-10-01T00:00:00Z", ...x });
const none = { slugs: {}, names: {}, hashed: {}, owners: ["geoffreyfernald"], owners_hashed: {} };
const noBuild = buildHalfOf({ repos: [] });

test("exclusions: apps11's, then the apps11 build half by slug, name and owner, and every pool's organisations by owner hash", () => {
  assert.equal(eligibility13(it(), none, noBuild), null);
  assert.equal(eligibility13(it({ license: { spdx_id: "GPL-3.0" } }), none, noBuild), "no permissive licence");
  assert.equal(eligibility13(it({ full_name: "x/polar" }), none, noBuild), "never drawn");
  const build = buildHalfOf({ repos: [{ repo: "Acme/Shop" }, { repo: "beta/store" }] });
  assert.equal(eligibility13(it(), none, build), "in another pool or mentioned by the Drift repository");
  assert.equal(eligibility13(it({ full_name: "other/store" }), none, build), "in another pool or mentioned by the Drift repository", "by name");
  assert.equal(eligibility13(it({ full_name: "beta/other" }), none, build), "an organisation of another pool", "by owner");
  assert.equal(eligibility13(it({ full_name: "gamma/x" }), { ...none, owners_hashed: { [poolHash("owner", "gamma")]: ["manifest eval/repos.json"] } }, noBuild), "an organisation of another pool");
  // the apps11 blind half: by its slug and name hashes (a hashed pool)
  assert.equal(eligibility13(it(), { ...none, hashed: { [poolHash("slug", "acme/shop")]: ["hashed pool eval/apps11-blind-hashes.json"] } }, noBuild), "in another pool or mentioned by the Drift repository");
  assert.equal(eligibility13(it({ full_name: "geoffreyfernald/x" }), none, noBuild), "in another pool or mentioned by the Drift repository");
});

// A synthetic draw: 160 pool repos, every third one passes.
const secret = "0123456789abcdef0123456789abcdef";
const spec = { ...SPEC, secret_sha256: createHash("sha256").update(secret).digest("hex") };
const passEv = { manifests: ["apps/web/package.json", "services/api/pyproject.toml"], frontend: ["apps/web/package.json"], backend: ["services/api/pyproject.toml"], frameworks: { "apps/web/package.json": { frontend: ["next"], backend: [], private: true } } };
const failEv = { manifests: ["package.json"], frontend: [], backend: [], frameworks: {} };
function synthetic() {
  const pool = Array.from({ length: 160 }, (_, i) => `org${String(i).padStart(2, "0")}/app${i}`).sort();
  const order = walkOrder(pool, `${spec.seed_public}:${secret}`);
  const walked = [];
  let n = 0;
  for (const repo of order) {
    if (n >= spec.n) break;
    const pass = Number(repo.split("app")[1]) % 3 === 0;
    walked.push(pass ? { repo, sha: "a".repeat(40), evidence: passEv, loc: 30000, verdict: "accepted", why: null } : { repo, sha: "b".repeat(40), evidence: failEv, loc: null, verdict: "skip", why: "C1" });
    if (pass) n++;
  }
  const meta_pool = Object.fromEntries(pool.map((s) => [s, { language: "TypeScript", licence: "MIT", size_kb: 5000, stars: 300, pushed_at: "2026-10-01T00:00:00Z", topics: [] }]));
  return { spec, exclusions: { ...none }, build_half: { slugs: [], names: [], owners: [] }, counts: { accepted: n }, pool, meta_pool, walked, meta: Object.fromEntries(walked.filter((w) => w.verdict === "accepted").map((w) => [w.repo, meta_pool[w.repo]])) };
}

test("replay: the synthetic draw replays, and the 18-repo first draw is its prefix; another secret, a reordered walk, a flipped verdict, an ineligible pool repo or a walk past the 40th are refused", () => {
  const rec = synthetic();
  assert.equal(rec.counts.accepted, 40);
  // the first draw, under the 18-repo spec, is the prefix of the extended walk
  const first = structuredClone(rec);
  const spec18 = { ...spec, n: 18, split: { build: 0, blind: 18 } };
  let k = 0;
  first.walked = rec.walked.filter((w) => k < 18 && (w.verdict === "accepted" ? ++k : true));
  first.spec = spec18;
  assert.deepEqual(replayProblems(first, secret, { spec: spec18 }), []);
  assert.deepEqual(rec.walked.slice(0, first.walked.length), first.walked);
  assert.deepEqual(replayProblems(rec, secret, { spec }), []);
  assert.match(replayProblems(rec, "f".repeat(32), { spec })[0], /secret/);
  const swapped = structuredClone(rec);
  [swapped.walked[0], swapped.walked[1]] = [swapped.walked[1], swapped.walked[0]];
  assert.ok(replayProblems(swapped, secret, { spec }).some((p) => /walk order/.test(p)));
  const flipped = structuredClone(rec);
  flipped.walked.find((w) => w.verdict === "skip").verdict = "accepted";
  assert.ok(replayProblems(flipped, secret, { spec }).some((p) => /does not follow/.test(p)));
  const owner = structuredClone(rec);
  owner.build_half.owners = [rec.pool[5].split("/")[0]];
  assert.ok(replayProblems(owner, secret, { spec }).some((p) => /is not eligible/.test(p)));
  const past = structuredClone(rec);
  past.walked.push({ repo: walkOrder(rec.pool, `${spec.seed_public}:${secret}`)[rec.walked.length], sha: null, evidence: failEv, loc: null, verdict: "skip", why: "C1" });
  assert.ok(replayProblems(past, secret, { spec }).some((p) => /went on after/.test(p)));
  assert.equal(seedOf(secret), `${SPEC.seed_public}:${secret}`);
});

test("outputs: deterministic; only hashes are committed (slug, name, owner, pin), never a name; the key map holds the 40", () => {
  const rec = synthetic();
  const a = outputsOf(rec, spec);
  assert.deepEqual(a, outputsOf(structuredClone(rec), spec));
  assert.equal(a.hashes.repos_sha256.length, 40);
  assert.equal(a.keyMap.repos.length, 40);
  const text = JSON.stringify(a.hashes);
  for (const r of a.keyMap.repos) {
    assert.ok(!text.includes(r.repo) && !text.includes(r.name) && !text.includes(r.repo.split("/")[0]), "no blind name in the committed hashes");
    assert.ok(a.hashes.repos_sha256.some((h) => JSON.stringify(h) === JSON.stringify(hashRow13(r.repo, r.sha))));
  }
  assert.deepEqual(Object.keys(a.hashes.repos_sha256[0]).sort(), ["name_sha256", "owner_sha256", "pin_sha256", "slug_sha256"]);
  // the public check: clean, then each tamper caught
  assert.deepEqual(hashesProblems(a.hashes, none, noBuild, spec), []);
  const one = a.keyMap.repos[0].repo;
  assert.ok(hashesProblems(a.hashes, { ...none, hashed: { [poolHash("slug", one)]: ["x"] } }, noBuild, spec).some((p) => /another pool/.test(p)));
  assert.ok(hashesProblems(a.hashes, none, buildHalfOf({ repos: [{ repo: `${one.split("/")[0]}/zzz` }] }), spec).some((p) => /organisation/.test(p)));
  assert.ok(hashesProblems(a.hashes, none, buildHalfOf({ repos: [{ repo: one }] }), spec).some((p) => /build half/.test(p)));
  assert.ok(hashesProblems({ ...a.hashes, secret_sha256: "0".repeat(64) }, none, noBuild, spec).some((p) => /commitment/.test(p)));
  assert.ok(hashesProblems({ ...a.hashes, n: 39, repos_sha256: a.hashes.repos_sha256.slice(1) }, none, noBuild, spec).some((p) => /39 hashes/.test(p)));
});

const drawn = existsSync(join(root, SPEC.outputs.blind_hashes));
test("verify (public, offline) passes on the committed apps13 hashes", { skip: !drawn && "apps13 not drawn yet" }, () => {
  const r = spawnSync(process.execPath, [join(here, "select-apps13.mjs"), "verify"], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", HTTPS_PROXY: "http://127.0.0.1:9" } });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /blind hashes \(40\) are consistent/);
  const h = JSON.parse(readFileSync(join(root, SPEC.outputs.blind_hashes), "utf8"));
  assert.equal(h.secret_sha256, SPEC.secret_sha256);
});

test("select-holdout.mjs exclusion-hashes lists the owners of manifest repos (owners_hashed), hashes only", () => {
  const out = join(root, "eval", "study", `.owners-test-${process.pid}.json`);
  const r = spawnSync(process.execPath, [join(here, "select-holdout.mjs"), "exclusion-hashes", "--own", SPEC.outputs.blind_hashes, "--out", out, "--at", "HEAD"], { encoding: "utf8" });
  try {
    assert.equal(r.status, 0, r.stderr);
    const ex = JSON.parse(readFileSync(out, "utf8"));
    // twentyhq/twenty is in eval/repos.json (the build set)
    assert.ok(ex.owners_hashed[poolHash("owner", "twentyhq")]?.some((s) => s.startsWith("manifest ")));
    assert.ok(Object.keys(ex.owners_hashed).every((k) => /^[0-9a-f]{64}$/.test(k)));
  } finally {
    rmSync(out, { force: true });
  }
});
