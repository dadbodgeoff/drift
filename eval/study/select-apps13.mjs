// Select apps13: a FRESH blind set of 40 public (18 at the first draw, 30 by amendment 1, 40 by amendment 2) GitHub applications shaped like Drift's beta users (app-shaped TS and
// Python monorepos and services), for the round-13 practice-map measures (PLAN-R13 §5; PREREG-R13-practices.md).
// The criteria, queries and walk are apps11's (select-apps.mjs: C1-C5, the same search, LOC bounds and licences), with
// a new public seed and a new secret, and wider exclusions:
//   - every exclusion of apps11 (select-holdout.mjs exclusion-hashes: the build set, held-out and dev pool manifests,
//     the hashed pools, every github.com mention in the Drift repository's files, commits and PR/issue text);
//   - both apps11 halves: the build half (eval/apps11-build.json) by slug, name AND owner; the blind half by its slug
//     and name hashes (a hashed pool);
//   - by organisation: the owner of every repo any manifest names (exclusion-hashes `owners_hashed`), and of the
//     apps11 build half. The apps11 blind half has no owner hashes, so it is excluded by repo only.
// All are blind: there is no build half. Only hashes are committed (eval/apps13-blind-hashes.json, with owner
// hashes so later selections can exclude these organisations); the key map stays in scratchpad/apps13-blind/, which
// only the later blind operator reads. Nothing here runs Drift.
//
//   spec                      the pre-registered specification as JSON (offline; names no repo)
//   fetch  --private DIR      exclusions, search, eligibility, the walk; writes DIR/record.json (counts only on stdout)
//   extend --private DIR      (amendment 1) continues the recorded walk, in the same order over the same pool and
//                             exclusions, until SPEC.n pass; the record keeps the spec it was drawn under (spec_history)
//   write  --private DIR      writes eval/apps13-blind-hashes.json and DIR/apps13-blind.json (the key map, never committed)
//   verify [--private DIR]    offline. Public: the committed hashes are well formed, match the secret commitment, and
//                             no row is in another pool, mentioned by the Drift repository, or of an excluded
//                             organisation. With DIR: the full replay from the private record.
//
// DIR must be a directory named apps13-blind* (only the apps13 operator reads it). The secret (openssl rand -hex 16) is
// DIR/secret.txt; its sha256 is SPEC.secret_sha256, committed and pushed before the draw.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, poolHash, readJson } from "./lib.mjs";
import { SPEC as APPS11, apiCallCount, classify, eligibility, enumerate, evidenceAt, hashRow, locAtPin, locOk, lsRemote, secretOk, sha256, walkOrder } from "./select-apps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

// ---------------------------------------------------------------------------------------------------------
// The pre-registered specification (committed and pushed before the draw; changing it is a new selection).
// ---------------------------------------------------------------------------------------------------------
const { id: _id, date: _date, seed_public: _seed, secret_sha256: _secret, n: _n, split: _split, outputs: _outputs, ...CRITERIA } = APPS11;
export const SPEC = {
  ...CRITERIA,
  id: "apps13",
  date: "2026-11-09",
  // The Drift main commit this selection branched from, fixed before any candidate was seen.
  seed_public: "drift-apps13-2026-11-09:81a1d01a81ad609ba7304cf112e6eca4b4ab3cc8",
  // sha256 of the 128-bit secret (32 hex characters, no newline) in scratchpad/apps13-blind/secret.txt.
  secret_sha256: "de32f02e35c2eca7a2c4a96271588629219ab44996d63b501eb9e9eac5d7bc87",
  // Amendment 1 (PREREG-R13-practices.md §9): 30, up from the 18 of the first draw. The walk continues in the same
  // seeded order over the same recorded pool until 30 pass (`extend`).
  // Amendment 2 (PREREG-R13-practices.md §10): 40, so one repo without a concern does not fail every ">= 30 repos" bar.
  n: 40,
  split: { build: 0, blind: 40 },
  amendments: [
    { n_before: 18, n_after: 30, why: "an external review: M-acc needs >= 100 units per concern from >= 30 repos", how: "the same pool, exclusions, secret and walk order, walked on from the 18th accepted repo" },
    { n_before: 30, n_after: 40, why: "the lead: with exactly 30, one repo without a primary concern fails every >= 30 repos bar", how: "the same pool, exclusions, secret and walk order, walked on from the 30th accepted repo" },
  ],
  outputs: { blind_hashes: "eval/apps13-blind-hashes.json" },
  exclusions: [
    "apps11's: select-holdout.mjs exclusion-hashes (manifests, hashed pools, tracked files, commit messages, PR and issue text of the Drift repository)",
    "the apps11 build half (eval/apps11-build.json): slug, name and owner",
    "the apps11 blind half (eval/apps11-blind-hashes.json): slug and name hashes",
    "the owner of every repo a manifest names (exclusion-hashes owners_hashed)",
  ],
};
const OWN_OUTPUTS = [SPEC.outputs.blind_hashes, "eval/study/select-apps13.mjs", "eval/study/select-apps13.test.mjs", "eval/study/PREREG-R13-practices.md"];
const APPS11_BUILD = "eval/apps11-build.json";

// ---------------------------------------------------------------------------------------------------------
// Pure parts (exported for the tests)
// ---------------------------------------------------------------------------------------------------------
export const seedOf = (secret) => `${SPEC.seed_public}:${secret}`;
const ownerOf = (slug) => slug.toLowerCase().split("/")[0];
// The apps11 build half as exclusions: { slugs, names, owners } (Sets, lower-cased).
export function buildHalfOf(m) {
  const rs = (m?.repos ?? []).map((r) => String(r.repo ?? "").toLowerCase()).filter((s) => s.includes("/"));
  return { slugs: new Set(rs), names: new Set(rs.map((s) => s.split("/")[1])), owners: new Set(rs.map(ownerOf)) };
}
// apps11's eligibility, then the apps13 exclusions: the apps11 build half, and the organisations of every pool.
export function eligibility13(it, ex, build) {
  const why = eligibility(it, ex);
  if (why) return why;
  const slug = it.full_name.toLowerCase();
  if (build.slugs.has(slug) || build.names.has(slug.split("/")[1])) return "in another pool or mentioned by the Drift repository";
  if (build.owners.has(ownerOf(slug)) || ex.owners_hashed?.[poolHash("owner", ownerOf(slug))]) return "an organisation of another pool";
  return null;
}
export const hashRow13 = (slug, sha) => ({ ...hashRow(slug, sha), owner_sha256: poolHash("owner", ownerOf(slug)) });
const rowOf = (w, meta) => {
  const c = classify(w.evidence);
  return {
    name: w.repo.split("/")[1],
    repo: w.repo,
    url: `https://github.com/${w.repo}`,
    sha: w.sha,
    language: meta?.language ?? null,
    licence: meta?.licence ?? null,
    size_kb: meta?.size_kb ?? null,
    stars: meta?.stars ?? null,
    pushed_at: meta?.pushed_at ?? null,
    loc: w.loc,
    shape: { mix: c.structure.mix, shape: c.shape, js_dirs: c.structure.js.length, py_dirs: c.structure.py.length, workspace_files: c.structure.workspace, frontend_dirs: c.front, backend_dirs: c.back },
  };
};
// The outputs, from a record (fetch's) and its secret: pure, so verify replays them.
export function outputsOf(rec, spec = SPEC) {
  const accepted = rec.walked.filter((w) => w.verdict === "accepted");
  const repos = accepted.map((w) => rowOf(w, rec.meta?.[w.repo]));
  const core = sha256(JSON.stringify(repos));
  const recordSha = sha256(JSON.stringify(rec));
  return {
    hashes: {
      "//": `apps13 BLIND set (${repos.length} repos), committed only as hashes (lib.mjs poolHash): slug_sha256 = poolHash('slug', owner/repo), name_sha256 = poolHash('name', repo), owner_sha256 = poolHash('owner', owner), pin_sha256 = poolHash('pin', owner/repo@sha). Only the apps13 operator reads the repos (scratchpad/apps13-blind*). select-holdout.mjs excludes these slug and name hashes from every later selection, and exclusion-hashes lists the owner hashes. core_sha256 is sha256 of the key map's repos array. Selected by eval/study/select-apps13.mjs; pre-registration eval/study/PREREG-R13-practices.md.`,
      set_id: "apps13-blind-2026-11-09",
      role: "apps13-blind",
      holdout: false,
      n: repos.length,
      core_sha256: core,
      record_sha256: recordSha,
      seed_public: spec.seed_public,
      secret_sha256: spec.secret_sha256,
      counts: rec.counts,
      repos_sha256: accepted.map((w) => hashRow13(w.repo, w.sha)).sort((a, b) => (a.slug_sha256 < b.slug_sha256 ? -1 : 1)),
    },
    keyMap: { set_id: "apps13-blind-2026-11-09", role: "apps13-blind", note: "BLIND: the apps13 operator only. Never commit.", repos },
  };
}
// The offline replay of a record: problems, or [].
export function replayProblems(rec, secret, { spec = SPEC } = {}) {
  const problems = [];
  if (!secretOk(secret, spec.secret_sha256)) return ["the secret does not match the committed secret_sha256"];
  if (JSON.stringify(rec.spec) !== JSON.stringify(spec)) problems.push("the record's spec differs from this script's pre-registered SPEC");
  const pool = rec.pool ?? [];
  if (JSON.stringify(pool) !== JSON.stringify([...new Set(pool)].sort())) problems.push("the pool is not sorted and unique");
  const build = { slugs: new Set(rec.build_half?.slugs ?? []), names: new Set(rec.build_half?.names ?? []), owners: new Set(rec.build_half?.owners ?? []) };
  for (const s of pool) {
    const it = { full_name: s, license: { spdx_id: rec.meta_pool?.[s]?.licence }, stargazers_count: rec.meta_pool?.[s]?.stars, pushed_at: rec.meta_pool?.[s]?.pushed_at, topics: rec.meta_pool?.[s]?.topics ?? [] };
    if (eligibility13(it, rec.exclusions ?? {}, build)) problems.push(`pool repo ${s} is not eligible`);
  }
  const order = walkOrder(pool, `${spec.seed_public}:${secret}`);
  const walked = rec.walked ?? [];
  if (JSON.stringify(walked.map((w) => w.repo)) !== JSON.stringify(order.slice(0, walked.length))) problems.push("the walk order differs from the seeded shuffle of the pool");
  let n = 0;
  for (const w of walked) {
    const c = w.evidence ? classify(w.evidence) : { pass: false };
    const ok = c.pass && /^[0-9a-f]{40}$/.test(w.sha ?? "") && locOk(w.loc);
    if ((w.verdict === "accepted") !== ok) problems.push(`walked ${w.repo}: verdict ${w.verdict} does not follow from its evidence`);
    if (w.verdict === "accepted") n++;
  }
  if (n > spec.n) problems.push(`${n} accepted, more than ${spec.n}`);
  if (n < spec.n && walked.length < pool.length) problems.push(`${n} accepted, and the walk stopped before the pool ran out`);
  if (n === spec.n && walked.at(-1)?.verdict !== "accepted") problems.push(`the walk went on after the ${spec.n}th accepted repo`);
  return problems;
}
// The public check of a hashes file against exclusions (exclusion-hashes output) and the apps11 build half.
export function hashesProblems(h, ex, build, spec = SPEC) {
  const p = [];
  if (h.n !== spec.split.blind || h.repos_sha256?.length !== spec.split.blind) p.push(`${h.repos_sha256?.length ?? 0} hashes, the spec ${spec.split.blind}`);
  if (h.secret_sha256 !== spec.secret_sha256 || h.seed_public !== spec.seed_public) p.push("the seed or the secret commitment differs from SPEC");
  const rows = h.repos_sha256 ?? [];
  for (const r of rows) for (const f of ["slug_sha256", "name_sha256", "owner_sha256", "pin_sha256"]) if (!/^[0-9a-f]{64}$/.test(r[f] ?? "")) p.push(`a row has no valid ${f}`);
  if (new Set(rows.map((r) => r.slug_sha256)).size !== rows.length) p.push("a slug hash is listed twice");
  const exKeys = new Set([...Object.keys(ex.slugs ?? {}), ...Object.keys(ex.names ?? {}), ...Object.keys(ex.hashed ?? {})]);
  const hit = rows.filter((r) => exKeys.has(r.slug_sha256) || exKeys.has(r.name_sha256)).length;
  if (hit) p.push(`${hit} rows are in another pool or mentioned by the Drift repository`);
  const buildSlugs = new Set([...build.slugs].map((s) => poolHash("slug", s)));
  const buildNames = new Set([...build.names].map((s) => poolHash("name", s)));
  const owners = new Set([...Object.keys(ex.owners_hashed ?? {}), ...[...build.owners, ...(ex.owners ?? [])].map((o) => poolHash("owner", o))]);
  const b = rows.filter((r) => buildSlugs.has(r.slug_sha256) || buildNames.has(r.name_sha256)).length;
  if (b) p.push(`${b} rows are in the apps11 build half`);
  const o = rows.filter((r) => owners.has(r.owner_sha256)).length;
  if (o) p.push(`${o} rows are of an organisation of another pool`);
  return p;
}

// ---------------------------------------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------------------------------------
const die = (m) => {
  console.error(`error: ${m}`);
  process.exit(2);
};
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};
const privateDir = (args) => {
  const d = args.private ? resolve(args.private) : null;
  if (!d) die("--private DIR is required");
  if (!/^apps13-blind/.test(basename(d))) die("--private must be a directory named apps13-blind* (only the apps13 operator reads it)");
  return d;
};
const readSecret = (d) => (existsSync(join(d, "secret.txt")) ? readFileSync(join(d, "secret.txt"), "utf8").trim() : null);
const exclusionHashes = (out, at) => {
  const a = [join(here, "select-holdout.mjs"), "exclusion-hashes", "--own", OWN_OUTPUTS.join(","), "--out", out, ...(at ? ["--at", at] : [])];
  const r = spawnSync(process.execPath, a, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
  if (r.status !== 0) die("select-holdout.mjs exclusion-hashes failed");
  return r.stdout.trim();
};
const buildHalfAt = (commit) => {
  const r = spawnSync("git", ["-C", root, "show", `${commit}:${APPS11_BUILD}`], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) die(`${APPS11_BUILD} is not at ${commit}`);
  return buildHalfOf(JSON.parse(r.stdout));
};

function main() {
  const args = parseArgs(process.argv.slice(2), { flags: ["force"] });
  const mode = args._[0];
  if (mode === "spec") {
    console.log(JSON.stringify({ spec: SPEC, own_outputs: OWN_OUTPUTS }, null, 2));
    return;
  }
  if (!/^[0-9a-f]{64}$/.test(SPEC.secret_sha256)) die("SPEC.secret_sha256 is not set: commit the secret's sha256 before the draw");
  if (mode === "fetch") {
    const d = privateDir(args);
    const secret = readSecret(d);
    if (!secretOk(secret, SPEC.secret_sha256)) die("DIR/secret.txt is missing or does not match SPEC.secret_sha256");
    const recPath = join(d, "record.json");
    if (existsSync(recPath) && !args.force) die("record.json exists; a selection is drawn once");
    const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    const retrieved_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    console.error("exclusions (select-holdout.mjs exclusion-hashes, hashes only)...");
    const exPath = join(d, "exclusions.json");
    console.error(exclusionHashes(exPath));
    const ex = readJson(exPath);
    const build = buildHalfAt(head);
    const all = new Map();
    const leaves = [];
    for (const q of SPEC.queries) {
      const r = enumerate(q);
      leaves.push(...r.leaves);
      for (const it of r.items) all.set(it.full_name.toLowerCase(), it);
    }
    const excludedCounts = {};
    const pool = [];
    const metaPool = {};
    for (const [slug, it] of all) {
      const why = eligibility13(it, ex, build);
      if (why) excludedCounts[why] = (excludedCounts[why] ?? 0) + 1;
      else {
        pool.push(slug);
        metaPool[slug] = { language: it.language, licence: it.license?.spdx_id, size_kb: it.size, stars: it.stargazers_count, pushed_at: it.pushed_at, topics: it.topics ?? [] };
      }
    }
    pool.sort();
    console.error(`search: ${all.size} unique results, ${pool.length} eligible; walking...`);
    const order = walkOrder(pool, seedOf(secret));
    const walked = [];
    let accepted = 0;
    for (const slug of order) {
      if (accepted >= SPEC.n) break;
      const url = `https://github.com/${slug}`;
      const w = { repo: slug, sha: lsRemote(url), evidence: null, loc: null, verdict: "skip", why: null };
      if (!w.sha) w.why = "git ls-remote failed";
      else {
        w.evidence = evidenceAt(url, w.sha, d);
        const c = w.evidence ? classify(w.evidence) : null;
        if (!c) w.why = "fetch of the tree at the pin failed";
        else if (!c.pass) w.why = c.why;
        else {
          const l = locAtPin(url, w.sha, d);
          w.loc = l?.loc ?? null;
          if (!l) w.why = "fetch at the pin failed";
          else if (!locOk(l.loc)) w.why = `C4: lines outside ${SPEC.loc.min}-${SPEC.loc.max}`;
          else {
            w.verdict = "accepted";
            accepted++;
          }
        }
      }
      walked.push(w);
      if (walked.length % 10 === 0 || w.verdict === "accepted") console.error(`  walked ${walked.length}: ${accepted} accepted`);
    }
    const why = {};
    for (const w of walked) if (w.verdict !== "accepted") why[w.why] = (why[w.why] ?? 0) + 1;
    const meta = Object.fromEntries(walked.filter((w) => w.verdict === "accepted").map((w) => [w.repo, metaPool[w.repo]]));
    const record = {
      "//": "apps13 selection record (eval/study/select-apps13.mjs). PRIVATE: the apps13 operator only (it names the blind set). Metadata, manifest-path evidence, pins and LOC only.",
      script: "eval/study/select-apps13.mjs",
      retrieved_at,
      drift_head: head,
      spec: SPEC,
      exclusions: ex,
      build_half: { slugs: [...build.slugs].sort(), names: [...build.names].sort(), owners: [...build.owners].sort() },
      queries: leaves,
      counts: { results: all.size, excluded: excludedCounts, eligible: pool.length, walked: walked.length, accepted, skipped: why, api_calls: apiCallCount() },
      pool,
      meta_pool: metaPool,
      walked,
      meta,
    };
    writeJson(recPath, record);
    console.error(`wrote the record: ${accepted} accepted of ${walked.length} walked`);
    console.log(JSON.stringify(record.counts));
    return;
  }
  if (mode === "extend") {
    const d = privateDir(args);
    const secret = readSecret(d);
    const recPath = join(d, "record.json");
    const rec = readJson(recPath);
    if (JSON.stringify(rec.spec) === JSON.stringify(SPEC)) die("the record is already drawn under this SPEC");
    const pr = replayProblems(rec, secret, { spec: rec.spec });
    if (pr.length) die(`the record does not replay under its own spec: ${pr.length} problems`);
    const order = walkOrder(rec.pool, seedOf(secret));
    let accepted = rec.walked.filter((w) => w.verdict === "accepted").length;
    const build = { slugs: new Set(rec.build_half.slugs), names: new Set(rec.build_half.names), owners: new Set(rec.build_half.owners) };
    for (const slug of order.slice(rec.walked.length)) {
      if (accepted >= SPEC.n) break;
      // the pool was eligible when drawn; the same check again, from the recorded metadata and exclusions
      const m = rec.meta_pool[slug];
      if (eligibility13({ full_name: slug, license: { spdx_id: m.licence }, stargazers_count: m.stars, pushed_at: m.pushed_at, topics: m.topics }, rec.exclusions, build)) die("a pool repo is no longer eligible");
      const url = `https://github.com/${slug}`;
      const w = { repo: slug, sha: lsRemote(url), evidence: null, loc: null, verdict: "skip", why: null };
      if (!w.sha) w.why = "git ls-remote failed";
      else {
        w.evidence = evidenceAt(url, w.sha, d);
        const c = w.evidence ? classify(w.evidence) : null;
        if (!c) w.why = "fetch of the tree at the pin failed";
        else if (!c.pass) w.why = c.why;
        else {
          const l = locAtPin(url, w.sha, d);
          w.loc = l?.loc ?? null;
          if (!l) w.why = "fetch at the pin failed";
          else if (!locOk(l.loc)) w.why = `C4: lines outside ${SPEC.loc.min}-${SPEC.loc.max}`;
          else {
            w.verdict = "accepted";
            accepted++;
          }
        }
      }
      rec.walked.push(w);
      if (w.verdict === "accepted") rec.meta[w.repo] = rec.meta_pool[w.repo];
      if (rec.walked.length % 10 === 0 || w.verdict === "accepted") console.error(`  walked ${rec.walked.length}: ${accepted} accepted`);
    }
    const why = {};
    for (const w of rec.walked) if (w.verdict !== "accepted") why[w.why] = (why[w.why] ?? 0) + 1;
    rec.spec_history = [...(rec.spec_history ?? []), { spec: rec.spec, counts: rec.counts }];
    rec.spec = SPEC;
    rec.extended_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    rec.counts = { ...rec.counts, walked: rec.walked.length, accepted, skipped: why, api_calls: (rec.counts.api_calls ?? 0) + apiCallCount() };
    writeJson(recPath, rec);
    console.log(JSON.stringify(rec.counts));
    return;
  }
  if (mode === "write") {
    const d = privateDir(args);
    const secret = readSecret(d);
    const rec = readJson(join(d, "record.json"));
    const pr = replayProblems(rec, secret);
    if (pr.length) die(`the record does not replay: ${pr.length} problems (${pr.slice(0, 3).join("; ")})`);
    if (rec.counts.accepted !== SPEC.n) die(`${rec.counts.accepted} accepted, the spec needs ${SPEC.n}`);
    const o = outputsOf(rec);
    const out = join(root, SPEC.outputs.blind_hashes);
    if (existsSync(out) && !args.force) die(`${SPEC.outputs.blind_hashes} exists: a frozen set is never rewritten`);
    const frozen_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    writeJson(out, { ...o.hashes, frozen_at });
    writeJson(join(d, "apps13-blind.json"), { ...o.keyMap, frozen_at, core_sha256: o.hashes.core_sha256 });
    console.error(`wrote ${SPEC.outputs.blind_hashes} (${o.hashes.n} hashes) and the key map`);
    return;
  }
  if (mode === "verify") {
    const hp = resolve(root, args.hashes ?? SPEC.outputs.blind_hashes);
    if (!existsSync(hp)) die(`${SPEC.outputs.blind_hashes} is not written yet`);
    const h = readJson(hp);
    const refs = spawnSync("git", ["-C", root, "for-each-ref", "--format=%(objectname)", "refs/remotes/driftv22/", "refs/heads/main"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const at = [...new Set(["HEAD", ...refs])].join(",");
    const exPath = join(here, `.apps13-exclusions-${process.pid}.json`);
    exclusionHashes(exPath, at);
    const ex = readJson(exPath);
    rmSync(exPath, { force: true });
    const problems = hashesProblems(h, ex, buildHalfAt("HEAD"));
    if (args.private) {
      const d = privateDir(args);
      const secret = readSecret(d);
      const rec = readJson(join(d, "record.json"));
      problems.push(...replayProblems(rec, secret));
      if (!problems.length) {
        const o = outputsOf(rec);
        const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== "frozen_at"));
        if (JSON.stringify(strip(h)) !== JSON.stringify(o.hashes)) problems.push("the committed hashes differ from what the record gives");
        const km = existsSync(join(d, "apps13-blind.json")) ? readJson(join(d, "apps13-blind.json")) : null;
        if (!km || JSON.stringify(km.repos) !== JSON.stringify(o.keyMap.repos)) problems.push("the key map differs from what the record gives");
      }
    }
    if (problems.length) {
      console.error(problems.join("\n"));
      console.error(`verify: ${problems.length} problems`);
      process.exit(1);
    }
    console.log(`verify: apps13 blind hashes (${h.n}) are consistent${args.private ? ", and replay from the private record" : ""}; no row is in another pool, mentioned by the Drift repository, in the apps11 build half, or of an excluded organisation (checked at ${new Set(at.split(",")).size} commits)`);
    return;
  }
  die("usage: select-apps13.mjs spec | fetch --private DIR | write --private DIR | verify [--private DIR]");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
