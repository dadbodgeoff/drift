// Select the apps11 coverage pool: public GitHub APPLICATIONS shaped like Drift's beta users (a frontend plus backend
// services, or several services; mixed TS + Python, multi-package TS or multi-service Python), drawn by a seeded walk
// over GitHub search results and split, seeded, into apps-build (12, readable by design agents) and apps-blind (18,
// readable only by the apps11 operator). Pre-registration: eval/study/PREREG-apps-coverage.md.
//
//   spec                                  the pre-registered specification as JSON (offline; names no repo)
//   fetch  --private DIR                  exclusions, search, eligibility, the walk; writes DIR/record.json (counts only on stdout)
//   write  --private DIR                  the split; writes eval/apps11-build.json, eval/apps11-blind-hashes.json and
//                                         DIR/apps11-blind.json (the blind key map, never committed)
//   verify [--private DIR]                offline. Public part: the committed build manifest and blind hashes are well formed,
//                                         disjoint, and no repo of either is in any other pool or mentioned by the Drift
//                                         repository (select-holdout.mjs exclusion-hashes --at HEAD, hashes only). With DIR:
//                                         the full replay (secret commitment, pool, walk order, classification from the
//                                         recorded evidence, LOC bounds, the split, the committed hashes and core).
//   loc DIR                               the LOC count of a checkout (the technical check), as JSON
//   packages DIR                          the discovered packages of a checkout (eval/study/apps-coverage.mjs), as JSON
//
// DIR must be a directory named apps-blind* (the brief's isolation rule: only the operator reads it).
//
// What is read of a candidate: search METADATA (stars, size, push date, archived, fork, template, licence, name, topics);
// its HEAD sha (git ls-remote); the file PATHS of its tree at that sha (a depth-1, blobless fetch); the CONTENTS of its
// dependency manifests only (package.json and Python manifests), to find framework packages; and, for a candidate that
// passes every other criterion, the line count of its source files at that sha (a depth-1 fetch read by `git cat-file`,
// no checkout, deleted at once). No Drift run, no source read by anyone, no README or docs. The record keeps metadata,
// manifest paths, the frameworks found per manifest, the pin and the line count only. (Code search, which
// select-holdout.mjs uses, misses repos it has not indexed; the tree at the pin is complete and fixed.)
//
// Determinism. The eligible pool (owner/repo, sorted) is shuffled with lib.mjs shuffle(SEED), where SEED is the public
// seed below joined with a 128-bit secret drawn once before the draw (openssl rand -hex 16) and kept in DIR/secret.txt;
// only its sha256 is committed (SPEC.secret_sha256), before the draw. Without the secret nobody can replay the walk
// order from a re-run of the public queries, so the 18 blind repos cannot be recovered from the 12 published ones. The
// walk takes candidates in that order until 30 pass; the 30 (in walk order) are shuffled with `${SEED}:split`, and the
// first 12 are apps-build. GitHub search changes over time, so `fetch` stores the pool and every walked step's evidence
// and pin; `verify --private` replays the draw from them without the network.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseJson, poolHash, readJson, shuffle } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

// ---------------------------------------------------------------------------------------------------------
// The pre-registered specification (committed and pushed before the draw; changing it is a new selection).
// ---------------------------------------------------------------------------------------------------------
const PUSHED_SINCE = "2025-11-09"; // active in the last 12 months
const STARS = [200, 20000];
// GitHub `size` (KB, history and assets included): a metadata pre-filter only; the LOC bounds below are the criterion.
const SIZE_KB = [1000, 1000000];
const COMMON = `size:${SIZE_KB[0]}..${SIZE_KB[1]} pushed:>=${PUSHED_SINCE} archived:false fork:false is:public`;
// Permissive licences only (SPDX ids, from the search metadata): no copyleft (GPL, AGPL, LGPL, MPL, EPL, ...).
const PERMISSIVE = ["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause-Clear", "BSL-1.0", "ISC", "MIT", "MIT-0", "NCSA", "PostgreSQL", "UPL-1.0", "Unlicense", "Zlib"];
// Non-applications by NAME or TOPIC (select-holdout.mjs's lists, plus libraries, SDKs, frameworks, plugins and CLIs).
const NON_APP_NAME =
  /(^|[-_.])(awesome|tutorials?|courses?|examples?|samples?|demos?|learn|learning|workshops?|cheat-?sheets?|interviews?|roadmaps?|books?|boilerplates?|starters?|templates?|exercises?|homework|leetcode|playgrounds?|snippets|dotfiles|lessons?|bootcamp|challenges?|100-?days(-of-[a-z]+)?|kata|katas|sdks?|libs?|library|plugins?|framework|cli|components)([-_.]|$)|^awesome/i;
const NON_APP_TOPICS = [
  "awesome", "awesome-list", "awesome-lists", "list", "tutorial", "tutorials", "course", "courses", "examples", "example",
  "sample", "samples", "sample-code", "demo", "boilerplate", "boilerplates", "starter", "starter-kit", "starter-template",
  "template", "templates", "cheatsheet", "interview", "interview-questions", "interview-preparation", "roadmap", "book",
  "books", "exercises", "leetcode", "algorithms", "data-structures", "learning", "learn", "dotfiles", "workshop",
  "library", "sdk", "framework", "npm-package", "component-library", "ui-library", "ui-components", "design-system", "cli", "plugin", "python-library", "python-package",
];
// Never drawn, whatever the exclusions say (the brief: never scan polar or CTFd).
const NEVER = ["polar", "ctfd"];
// Manifest members that are not the product: skipped (select-holdout.mjs's list), as are hidden and node_modules paths.
const NON_PRODUCT_DIR = /(^|\/)(docs?|documentation|website|site|examples?|samples?|playgrounds?|demos?|e2e|storybook|benchmarks?|fixtures?|templates?|tests?|__tests__)(\/|$)/i;
export const JS_MANIFEST_RE = /(^|\/)package\.json$/;
export const PY_MANIFEST_RE = /(^|\/)(pyproject\.toml|setup\.cfg|setup\.py|Pipfile|requirements[^/]*\.txt)$/i;
export const WORKSPACE_FILE_RE = /(^|\/)(pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json|rush\.json)$/;
const JS_MANIFEST = JS_MANIFEST_RE;
// Top-level directories that hold applications or services, not published libraries.
const APP_DIR = /^(apps?|services?|backend|server|api|frontend|web|client|workers?)(\/|$)/i;
const PY_MANIFEST = PY_MANIFEST_RE;
const WORKSPACE_FILE = WORKSPACE_FILE_RE;
// Framework packages found in the manifests. Backend: package.json `dependencies` (not dev or peer: a dev server or a
// library's peer is not a service), or a Python requirement. Frontend: package.json `dependencies` or `devDependencies`.
const BACKEND_PY = ["fastapi", "django", "flask", "litestar"];
const BACKEND_TS = ["express", "@nestjs/core", "fastify", "hono", "koa"];
const FRONTEND = ["react-dom", "next", "vue", "svelte", "@angular/core", "solid-js", "nuxt", "@sveltejs/kit"];
// The technical check: non-blank lines of tracked source files at the pin.
const LOC = {
  min: 20000,
  max: 500000,
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".vue", ".svelte"],
  excluded_dir: String(/(^|\/)(node_modules|vendors?|third[_-]party|dist|build|out|\.next|\.nuxt|coverage|__generated__|generated|bower_components|site-packages|\.?venv|migrations)(\/|$)/),
  excluded_file: String(/(\.min\.js|\.bundle\.js|\.d\.ts|-lock\.json)$/),
  max_file_bytes: 1000000,
};
export const SPEC = {
  id: "apps11",
  date: "2026-11-09",
  // The Drift main commit this selection branched from, fixed before any candidate was seen.
  seed_public: "drift-apps11-2026-11-09:226389b6d90b7c83680d6ed6f92eae5107be6745",
  // sha256 of the 128-bit secret (32 hex characters, no newline), drawn once before the draw; the secret stays in
  // scratchpad/apps-blind*/secret.txt until apps-blind joins the build set, when it is published to let anyone replay.
  secret_sha256: "f4d99128a31653c9d7c5688df8db397bdb39dc3b246d0afb4caeeb5aa7875114",
  pushed_since: PUSHED_SINCE,
  stars: STARS,
  size_kb: SIZE_KB,
  queries: [`language:TypeScript ${COMMON}`, `language:Python ${COMMON}`],
  licences: PERMISSIVE,
  non_app_name: String(NON_APP_NAME),
  non_app_topics: NON_APP_TOPICS,
  never: NEVER,
  non_product_dir: String(NON_PRODUCT_DIR),
  js_manifest: String(JS_MANIFEST),
  py_manifest: String(PY_MANIFEST),
  workspace_file: String(WORKSPACE_FILE),
  app_dir: String(APP_DIR),
  backend_py: BACKEND_PY,
  backend_ts: BACKEND_TS,
  frontend: FRONTEND,
  loc: LOC,
  n: 30,
  split: { build: 12, blind: 18 },
  outputs: { build: "eval/apps11-build.json", blind_hashes: "eval/apps11-blind-hashes.json" },
  criteria: [
    "C1 languages: >=1 product package.json and >=1 product Python manifest (mixed TS + Python), or >=2 package.json directories (multi-package TS), or >=2 Python manifest directories (multi-service Python)",
    "C2 shape: a frontend directory (a package.json with a frontend framework) and a backend directory (a manifest with a backend framework) that differ, or >=2 backend directories; a package.json counts only if it is \"private\": true or lies under an application directory (apps/, services/, backend/, server/, api/, frontend/, web/, client/, workers/) (an application's packages are not published; a library's are), and with >=2 package.json directories the root one is the workspace root and counts as neither",
    "C3 workspace: >=2 manifest directories in all (C1 implies it); workspace files (pnpm-workspace.yaml, lerna.json, nx.json, turbo.json, rush.json) are recorded",
    "C4 size and activity: 20k-500k non-blank source lines at the pin; pushed within 12 months; permissive licence; not archived, fork or template",
    "C5 an application: no non-application name or topic (libraries, SDKs, frameworks, plugins, CLIs, lists, tutorials, templates)",
  ],
};
const OWN_OUTPUTS = ["eval/apps11-build.json", "eval/apps11-blind-hashes.json", "eval/study/select-apps.mjs", "eval/study/select-apps.test.mjs", "eval/study/apps-coverage.mjs", "eval/study/apps-coverage.test.mjs", "eval/study/PREREG-apps-coverage.md", "eval/study/runs/apps11-build-baseline-2026-11-09"];

// ---------------------------------------------------------------------------------------------------------
// Pure parts (exported for the tests)
// ---------------------------------------------------------------------------------------------------------
const re = (s) => new RegExp(s.slice(1, s.lastIndexOf("/")), s.slice(s.lastIndexOf("/") + 1));
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
// A product manifest path: not under a non-product, hidden or node_modules directory.
export const isProductPath = (p) => {
  const d = dirOf(p);
  return !NON_PRODUCT_DIR.test(d) && !/(^|\/)node_modules(\/|$)/.test(p) && !d.split("/").some((seg) => seg.startsWith("."));
};
// The structure of a repo from its manifest paths: package.json directories, Python manifest directories, workspace files.
export function structureOf(paths) {
  const prod = [...new Set(paths)].filter(isProductPath).sort();
  const js = [...new Set(prod.filter((p) => JS_MANIFEST.test(p)).map(dirOf))].sort();
  const py = [...new Set(prod.filter((p) => PY_MANIFEST.test(p)).map(dirOf))].sort();
  const workspace = prod.filter((p) => WORKSPACE_FILE.test(p));
  const mix = js.length >= 1 && py.length >= 1 ? "ts+py" : js.length >= 2 ? "multi-ts" : py.length >= 2 ? "multi-py" : null;
  return { js, py, workspace, mix };
}
// The frameworks a manifest names (frontend / backend), from its text. Pure: verify re-derives nothing from the network.
export function frameworksOf(path, text) {
  const out = { frontend: [], backend: [] };
  if (JS_MANIFEST.test(path)) {
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return out;
    }
    const dep = Object.keys(j?.dependencies ?? {});
    const dev = Object.keys(j?.devDependencies ?? {});
    out.frontend = FRONTEND.filter((f) => dep.includes(f) || dev.includes(f));
    out.backend = BACKEND_TS.filter((b) => dep.includes(b));
    out.private = j?.private === true;
  } else if (PY_MANIFEST.test(path)) {
    const lines = text.split("\n").map((l) => l.replace(/(^|\s)#.*$/, ""));
    const named = (n) => {
      const e = n.replace(/[-_.]/g, "[-_.]");
      const start = new RegExp(`^\\s*["']?${e}(\\[[^\\]]*\\])?["']?\\s*([<>=~!;,"'\\]@]|$)`, "i");
      const quoted = new RegExp(`["']${e}(\\[[^\\]]*\\])?\\s*([<>=~!;,"'\\s@]|$)`, "i");
      return lines.some((l) => start.test(l) || quoted.test(l));
    };
    out.backend = BACKEND_PY.filter(named);
  }
  return out;
}
// The verdict from the evidence: { manifests: [path], frontend: [path], backend: [path] } (paths of the manifests that
// name a frontend / backend framework).
export function classify(ev) {
  const st = structureOf(ev.manifests ?? []);
  if (!st.mix) return { pass: false, why: "C1: not mixed TS + Python, multi-package TS or multi-service Python", structure: st };
  // With several package.json directories, the root one is the workspace root: neither frontend nor backend.
  const wsRoot = (p) => st.js.length >= 2 && p === "package.json";
  // An application's packages are not published: a package.json counts only with "private": true (a library's are public).
  // An application directory by name (apps/, services/, backend/, server/, ...) counts as well.
  const app = (p) => !JS_MANIFEST.test(p) || ev.frameworks?.[p]?.private === true || APP_DIR.test(dirOf(p));
  const front = [...new Set((ev.frontend ?? []).filter(isProductPath).filter((p) => JS_MANIFEST.test(p) && !wsRoot(p) && app(p)).map(dirOf))].sort();
  const back = [...new Set((ev.backend ?? []).filter(isProductPath).filter((p) => !wsRoot(p) && app(p)).map(dirOf))].sort();
  const shape = front.some((f) => back.some((b) => b !== f)) ? "frontend+backend" : back.length >= 2 ? "services" : null;
  if (!shape) return { pass: false, why: "C2: no frontend plus backend, nor several services", structure: st, front, back };
  return { pass: true, shape, structure: st, front, back };
}
export const passes = (ev) => classify(ev).pass;
// Metadata eligibility (C4 licence/activity part, C5), and the exclusions (hashes from select-holdout.mjs exclusion-hashes).
export function eligibility(it, ex) {
  const slug = it.full_name.toLowerCase();
  const name = slug.split("/")[1];
  if (it.archived) return "archived";
  if (it.fork) return "fork";
  if (it.is_template) return "template repository";
  if (!PERMISSIVE.includes(it.license?.spdx_id)) return "no permissive licence";
  if (NEVER.includes(name)) return "never drawn";
  if (excluded(ex, slug)) return "in another pool or mentioned by the Drift repository";
  if (NON_APP_NAME.test(name)) return "non-application (name)";
  if ((it.topics ?? []).some((t) => NON_APP_TOPICS.includes(t))) return "non-application (topic)";
  if (!it.stargazers_count || it.stargazers_count < STARS[0] || it.stargazers_count > STARS[1]) return "stars out of range";
  if (it.pushed_at < PUSHED_SINCE) return "not pushed within 12 months";
  return null;
}
export function excluded(ex, slug) {
  const s = slug.toLowerCase();
  const [owner, name] = s.split("/");
  return Boolean(ex.slugs?.[poolHash("slug", s)] || ex.names?.[poolHash("name", name)] || ex.hashed?.[poolHash("slug", s)] || ex.hashed?.[poolHash("name", name)] || (ex.owners ?? []).includes(owner));
}
export const seedOf = (secret) => `${SPEC.seed_public}:${secret}`;
export const secretOk = (secret, commitment = SPEC.secret_sha256) => /^[0-9a-f]{32}$/.test(secret ?? "") && createHash("sha256").update(secret).digest("hex") === commitment;
export const walkOrder = (pool, seed) => shuffle([...pool].sort(), `${seed}:walk`);
export function split(accepted, seed) {
  const order = shuffle(accepted, `${seed}:split`);
  return { build: order.slice(0, SPEC.split.build), blind: order.slice(SPEC.split.build) };
}
// The LOC count of a list of { path, bytes, text } (text only for counted files).
export const locCounted = (path, bytes) =>
  LOC.extensions.some((e) => path.endsWith(e)) && !re(LOC.excluded_dir).test(path) && !re(LOC.excluded_file).test(path) && bytes <= LOC.max_file_bytes;
export const nonBlank = (text) => text.split("\n").filter((l) => l.trim()).length;
export const locOk = (n) => Number.isInteger(n) && n >= LOC.min && n <= LOC.max;
// A committed hashes row of a repo.
export const hashRow = (slug, sha) => ({ slug_sha256: poolHash("slug", slug), name_sha256: poolHash("name", slug.split("/")[1]), pin_sha256: poolHash("pin", `${slug}@${sha}`) });
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const rowOf = (w, meta) => ({
  name: w.repo.split("/")[1],
  repo: w.repo,
  url: `https://github.com/${w.repo}`,
  sha: w.sha,
  language: meta.language,
  licence: meta.licence,
  size_kb: meta.size_kb,
  stars: meta.stars,
  pushed_at: meta.pushed_at,
  loc: w.loc,
  shape: (({ structure, shape, front, back }) => ({ mix: structure.mix, shape, js_dirs: structure.js.length, py_dirs: structure.py.length, workspace_files: structure.workspace, frontend_dirs: front, backend_dirs: back }))(classify(w.evidence)),
});
// The split and the outputs, from a record (fetch's) and its secret: pure, so verify replays it.
export function outputsOf(rec, secret) {
  const seed = seedOf(secret);
  const accepted = rec.walked.filter((w) => w.verdict === "accepted").map((w) => w.repo);
  const { build, blind } = split(accepted, seed);
  const byRepo = new Map(rec.walked.map((w) => [w.repo, w]));
  const rows = (list) => list.map((r) => rowOf(byRepo.get(r), rec.meta[r]));
  const blindRepos = rows(blind);
  const blindCore = sha256(JSON.stringify(blindRepos));
  const recordSha = sha256(JSON.stringify(rec));
  const counts = rec.counts;
  return {
    build: {
      "//": "apps11 BUILD half (12 repos): design agents may read these repos, their census and labels. The blind half is committed only as hashes (eval/apps11-blind-hashes.json). Selected by eval/study/select-apps.mjs; pre-registration eval/study/PREREG-apps-coverage.md.",
      set_id: "apps11-build-2026-11-09",
      role: "apps-build",
      holdout: false,
      status: "frozen",
      frozen_on: SPEC.date,
      max: 15,
      selection: { script: "eval/study/select-apps.mjs", seed_public: SPEC.seed_public, secret_sha256: SPEC.secret_sha256, record_sha256: recordSha, blind_core_sha256: blindCore, retrieved_at: rec.retrieved_at, counts },
      repos: rows(build),
    },
    blindHashes: {
      "//": "apps11 BLIND half (18 repos), committed only as hashes (lib.mjs poolHash): slug_sha256 = poolHash('slug', owner/repo), name_sha256 = poolHash('name', repo), pin_sha256 = poolHash('pin', owner/repo@sha). Only the apps11 operator reads the repos (scratchpad/apps-blind*). select-holdout.mjs excludes these hashes from every later selection. core_sha256 is sha256 of the blind manifest's repos array as the operator holds it.",
      set_id: "apps11-blind-2026-11-09",
      role: "apps-blind",
      holdout: false,
      n: blind.length,
      core_sha256: blindCore,
      record_sha256: recordSha,
      secret_sha256: SPEC.secret_sha256,
      repos_sha256: blind.map((r) => hashRow(r, byRepo.get(r).sha)).sort((a, b) => (a.slug_sha256 < b.slug_sha256 ? -1 : 1)),
    },
    blindManifest: { set_id: "apps11-blind-2026-11-09", role: "apps-blind", note: "BLIND: the apps11 operator only. Never commit.", repos: blindRepos },
  };
}
// The offline replay of a record (verify --private): problems, or [].
// commitment and spec: SPEC's (tests pass their own).
export function replayProblems(rec, secret, { commitment = SPEC.secret_sha256, spec = SPEC } = {}) {
  const problems = [];
  if (!secretOk(secret, commitment)) return ["the secret does not match the committed secret_sha256"];
  if (JSON.stringify(rec.spec) !== JSON.stringify(spec)) problems.push("the record's spec differs from this script's pre-registered SPEC");
  const pool = rec.pool ?? [];
  if (JSON.stringify(pool) !== JSON.stringify([...new Set(pool)].sort())) problems.push("the pool is not sorted and unique");
  for (const s of pool) if (excluded(rec.exclusions ?? {}, s) || NEVER.includes(s.split("/")[1]) || NON_APP_NAME.test(s.split("/")[1])) problems.push(`pool repo ${s} is excluded`);
  const order = walkOrder(pool, seedOf(secret));
  const walked = rec.walked ?? [];
  if (JSON.stringify(walked.map((w) => w.repo)) !== JSON.stringify(order.slice(0, walked.length))) problems.push("the walk order differs from the seeded shuffle of the pool");
  let n = 0;
  for (const w of walked) {
    const c = w.evidence ? classify(w.evidence) : { pass: false };
    const ok = c.pass && /^[0-9a-f]{40}$/.test(w.sha ?? "") && locOk(w.loc);
    if ((w.verdict === "accepted") !== ok) problems.push(`walked ${w.repo}: verdict ${w.verdict} does not follow from its evidence`);
    if (w.verdict === "accepted") n++;
  }
  // The walk stops at the 30th accepted repo, or when the pool runs out.
  if (n > SPEC.n) problems.push(`${n} accepted, more than ${SPEC.n}`);
  if (n < SPEC.n && walked.length < pool.length) problems.push(`${n} accepted, and the walk stopped before the pool ran out`);
  if (n === SPEC.n && walked.at(-1)?.verdict !== "accepted") problems.push(`the walk went on after the ${SPEC.n}th accepted repo`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------------------------------------
const die = (m) => {
  console.error(`error: ${m}`);
  process.exit(2);
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};
let apiCalls = 0;
export const apiCallCount = () => apiCalls; // select-apps13.mjs reports it
function gh(path, fields = {}, extra = []) {
  const a = ["api", "-X", "GET", path, ...extra, ...Object.entries(fields).flatMap(([k, v]) => ["-f", `${k}=${v}`])];
  for (let attempt = 0; ; attempt++) {
    apiCalls++;
    const r = spawnSync("gh", a, { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status === 0) return parseJson(r.stdout, `gh ${path} output`);
    const err = `${r.stderr}${r.stdout}`;
    if (/HTTP 404|Not Found/.test(err)) return null;
    if (/HTTP 422/.test(err)) return { total_count: 0, items: [], invalid: true };
    if (attempt >= 6) die(`gh ${path} failed (${err.slice(0, 120).replace(/repo:\S+/g, "repo:…")})`);
    sleep(/rate limit|HTTP 403|HTTP 429/i.test(err) ? 65000 : 5000 * (attempt + 1));
  }
}
const repoSearch = (q, page) => {
  sleep(2200);
  return gh("search/repositories", { q, per_page: 100, page, sort: "stars", order: "desc" });
};
export function enumerate(query) {
  const leaves = [];
  const items = new Map();
  const stack = [STARS];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const q = `${query} stars:${lo}..${hi}`;
    const first = repoSearch(q, 1);
    if (first.total_count > 1000 && hi > lo) {
      const mid = Math.floor((lo + hi) / 2);
      stack.push([mid + 1, hi], [lo, mid]);
      continue;
    }
    let got = first.items;
    for (let page = 2; page <= Math.ceil(Math.min(first.total_count, 1000) / 100); page++) got = got.concat(repoSearch(q, page).items);
    for (const it of got) items.set(it.full_name.toLowerCase(), it);
    leaves.push({ q, total_count: first.total_count, fetched: got.length, incomplete_results: !!first.incomplete_results });
    console.error(`  ${q}: ${first.total_count} (fetched ${got.length})`);
  }
  return { leaves, items: [...items.values()] };
}
// The evidence of one candidate at its pin: the tree (a depth-1, blobless fetch), then the product manifests' contents.
const gitIn = (d, ...a) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8", maxBuffer: 1 << 30, timeout: 900000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
export function evidenceAt(url, sha, scratch) {
  const d = join(scratch, "tree-tmp");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  try {
    if (gitIn(d, "init", "-q", "--bare").status !== 0 || gitIn(d, "fetch", "-q", "--depth", "1", "--filter=blob:none", url, sha).status !== 0) return null;
    const ls = gitIn(d, "ls-tree", "-r", sha);
    if (ls.status !== 0) return null;
    const entries = ls.stdout.split("\n").filter(Boolean).map((l) => {
      const tab = l.indexOf("\t");
      const [mode, type, oid] = l.slice(0, tab).split(" ");
      return { mode, type, oid, path: l.slice(tab + 1) };
    });
    const manifests = entries.filter((e) => e.type === "blob" && (JS_MANIFEST.test(e.path) || PY_MANIFEST.test(e.path) || WORKSPACE_FILE.test(e.path)) && isProductPath(e.path));
    const ev = { files: entries.length, manifests: manifests.map((e) => e.path).sort(), frontend: [], backend: [], frameworks: {} };
    if (!structureOf(ev.manifests).mix) return ev;
    const deps = manifests.filter((e) => e.mode !== "120000" && (JS_MANIFEST.test(e.path) || PY_MANIFEST.test(e.path)));
    for (let i = 0; i < deps.length; i += 200) if (gitIn(d, "-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags", "--no-write-fetch-head", "--filter=blob:none", url, ...deps.slice(i, i + 200).map((e) => e.oid)).status !== 0) return null;
    const cat = spawnSync("git", ["-C", d, "cat-file", "--batch"], { input: deps.map((e) => e.oid).join("\n") + "\n", maxBuffer: 1 << 30 });
    if (cat.status !== 0) return null;
    let i = 0;
    for (const e of deps) {
      const nl = cat.stdout.indexOf(10, i);
      const head = cat.stdout.subarray(i, nl).toString("utf8").split(" ");
      const size = Number(head[2]);
      const text = head[1] === "blob" ? cat.stdout.subarray(nl + 1, nl + 1 + size).toString("utf8") : "";
      i = head[1] === "blob" ? nl + 1 + size + 1 : nl + 1;
      const f = frameworksOf(e.path, text);
      if (f.frontend.length || f.backend.length) ev.frameworks[e.path] = f;
      if (f.frontend.length) ev.frontend.push(e.path);
      if (f.backend.length) ev.backend.push(e.path);
    }
    ev.frontend.sort();
    ev.backend.sort();
    return ev;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
export function lsRemote(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = spawnSync("git", ["ls-remote", url, "HEAD"], { encoding: "utf8", timeout: 90000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const sha = r.stdout?.match(/^([0-9a-f]{40})\tHEAD$/m)?.[1];
    if (sha) return sha;
    sleep(3000);
  }
  return null;
}
// LOC of a git directory at a commit (no checkout): tracked blobs with a counted path.
export function locOfGit(gitDir, commit) {
  const ls = spawnSync("git", ["-C", gitDir, "ls-tree", "-r", "-l", commit], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (ls.status !== 0) return null;
  const blobs = [];
  for (const l of ls.stdout.split("\n").filter(Boolean)) {
    const tab = l.indexOf("\t");
    const [mode, type, obj, size] = l.slice(0, tab).trim().split(/\s+/);
    const path = l.slice(tab + 1);
    if (type === "blob" && mode !== "120000" && locCounted(path, Number(size))) blobs.push(obj);
  }
  let loc = 0;
  for (let k = 0; k < blobs.length; k += 2000) {
    const cat = spawnSync("git", ["-C", gitDir, "cat-file", "--batch"], { input: blobs.slice(k, k + 2000).join("\n") + "\n", maxBuffer: 1 << 30 });
    if (cat.status !== 0) return null;
    const buf = cat.stdout;
    let i = 0;
    while (i < buf.length) {
      const nl = buf.indexOf(10, i);
      const size = Number(buf.subarray(i, nl).toString("utf8").split(" ")[2]);
      loc += nonBlank(buf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
      i = nl + 1 + size + 1;
    }
  }
  return { loc, files: blobs.length };
}
export function locAtPin(url, sha, scratch) {
  const d = join(scratch, "loc-tmp");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const g = (...a) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8", timeout: 900000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  try {
    if (g("init", "-q", "--bare").status !== 0 || g("fetch", "-q", "--depth", "1", url, sha).status !== 0) return null;
    return locOfGit(d, sha);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
const privateDir = (args) => {
  const d = args.private ? resolve(args.private) : null;
  if (!d) die("--private DIR is required");
  if (!/^apps-blind/.test(basename(d))) die("--private must be a directory named apps-blind* (only the apps11 operator reads it)");
  return d;
};
const readSecret = (d) => (existsSync(join(d, "secret.txt")) ? readFileSync(join(d, "secret.txt"), "utf8").trim() : null);

// ---------------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (mode === "spec") {
    console.log(JSON.stringify({ spec: SPEC, own_outputs: OWN_OUTPUTS }, null, 2));
    return;
  }
  if (mode === "loc") {
    const d = resolve(args._[1] ?? ".");
    console.log(JSON.stringify(locOfGit(d, "HEAD")));
    return;
  }
  if (mode === "packages") {
    const d = resolve(args._[1] ?? ".");
    const files = spawnSync("git", ["-C", d, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 30 }).stdout.split("\n").filter(Boolean);
    const st = structureOf(files.filter((p) => JS_MANIFEST.test(p) || PY_MANIFEST.test(p) || WORKSPACE_FILE.test(p)));
    console.log(JSON.stringify(st));
    return;
  }
  if (mode === "fetch") {
    const d = privateDir(args);
    const secret = readSecret(d);
    if (!secretOk(secret)) die("DIR/secret.txt is missing or does not match SPEC.secret_sha256");
    const recPath = join(d, "record.json");
    if (existsSync(recPath) && !args.force) die("record.json exists; a selection is drawn once");
    const retrieved_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    console.error("exclusions (select-holdout.mjs exclusion-hashes, hashes only)...");
    const exPath = join(d, "exclusions.json");
    const xr = spawnSync(process.execPath, [join(here, "select-holdout.mjs"), "exclusion-hashes", "--own", OWN_OUTPUTS.join(","), "--out", exPath], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
    if (xr.status !== 0) die("exclusion-hashes failed");
    console.error(xr.stdout.trim());
    const ex = readJson(exPath);
    const all = new Map();
    const leaves = [];
    for (const q of SPEC.queries) {
      const r = enumerate(q);
      leaves.push(...r.leaves);
      for (const it of r.items) all.set(it.full_name.toLowerCase(), it);
    }
    const excludedCounts = {};
    const pool = [];
    const metaOf = new Map();
    let excludedByPools = 0;
    for (const [slug, it] of all) {
      const why = eligibility(it, ex);
      if (why) {
        excludedCounts[why] = (excludedCounts[why] ?? 0) + 1;
        if (why.startsWith("in another pool")) excludedByPools++;
      } else {
        pool.push(slug);
        metaOf.set(slug, { language: it.language, licence: it.license?.spdx_id, size_kb: it.size, stars: it.stargazers_count, pushed_at: it.pushed_at });
      }
    }
    pool.sort();
    console.error(`search: ${all.size} unique results, ${pool.length} eligible (${excludedByPools} excluded by the other pools and mentions); walking...`);
    const seed = seedOf(secret);
    const order = walkOrder(pool, seed);
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
          else if (!locOk(l.loc)) w.why = `C4: lines outside ${LOC.min}-${LOC.max}`;
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
    const meta = Object.fromEntries(walked.filter((w) => w.verdict === "accepted").map((w) => [w.repo, metaOf.get(w.repo)]));
    const record = {
      "//": "apps11 selection record (eval/study/select-apps.mjs). PRIVATE: the apps11 operator only (it names the blind half). Metadata, manifest-path evidence, pins and LOC only.",
      script: "eval/study/select-apps.mjs",
      retrieved_at,
      spec: SPEC,
      exclusions: ex,
      queries: leaves,
      counts: { results: all.size, excluded: excludedCounts, eligible: pool.length, walked: walked.length, accepted, skipped: why, api_calls: apiCalls },
      pool,
      walked,
      meta,
    };
    writeJson(recPath, record);
    console.error(`wrote the record: ${accepted} accepted of ${walked.length} walked (${apiCalls} API calls)`);
    return;
  }
  if (mode === "write") {
    const d = privateDir(args);
    const secret = readSecret(d);
    const rec = readJson(join(d, "record.json"));
    const pr = replayProblems(rec, secret);
    if (pr.length) die(`the record does not replay: ${pr.length} problems`);
    if (rec.counts.accepted !== SPEC.n) die(`${rec.counts.accepted} accepted, the spec needs ${SPEC.n}`);
    const o = outputsOf(rec, secret);
    for (const p of Object.values(SPEC.outputs)) if (existsSync(join(root, p)) && !args.force) die(`${p} exists: a frozen manifest is never rewritten`);
    const frozen_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    writeJson(join(root, SPEC.outputs.build), { ...o.build, frozen_at });
    writeJson(join(root, SPEC.outputs.blind_hashes), { ...o.blindHashes, frozen_at });
    writeJson(join(d, "apps11-blind.json"), { ...o.blindManifest, frozen_at, core_sha256: o.blindHashes.core_sha256 });
    console.error(`wrote ${SPEC.outputs.build} (${o.build.repos.length} repos), ${SPEC.outputs.blind_hashes} (${o.blindHashes.n} hashes), and the blind key map`);
    return;
  }
  if (mode === "verify") {
    const problems = [];
    // --build / --hashes: other copies of the committed files (the tests tamper with copies).
    const bp = resolve(root, args.build ?? SPEC.outputs.build);
    const hp = resolve(root, args.hashes ?? SPEC.outputs.blind_hashes);
    const b = existsSync(bp) ? readJson(bp) : null;
    const h = existsSync(hp) ? readJson(hp) : null;
    if (!b || !h) die("the build manifest or the blind hashes are not written yet");
    if (b.repos.length !== SPEC.split.build) problems.push(`build: ${b.repos.length} repos, the spec ${SPEC.split.build}`);
    if (h.n !== SPEC.split.blind || h.repos_sha256.length !== SPEC.split.blind) problems.push(`blind: ${h.repos_sha256.length} hashes, the spec ${SPEC.split.blind}`);
    if (b.selection.secret_sha256 !== SPEC.secret_sha256 || h.secret_sha256 !== SPEC.secret_sha256) problems.push("the secret commitment differs from SPEC");
    if (b.selection.blind_core_sha256 !== h.core_sha256 || b.selection.record_sha256 !== h.record_sha256) problems.push("the build manifest and the blind hashes name different records or cores");
    const blindSlugs = new Set(h.repos_sha256.map((r) => r.slug_sha256));
    const blindNames = new Set(h.repos_sha256.map((r) => r.name_sha256));
    for (const r of b.repos) {
      const c = { slug: r.repo, sha: r.sha };
      if (!/^[0-9a-f]{40}$/.test(r.sha ?? "")) problems.push(`build ${r.repo}: not pinned`);
      if (!locOk(r.loc)) problems.push(`build ${r.repo}: LOC ${r.loc} outside the bounds`);
      if (!PERMISSIVE.includes(r.licence)) problems.push(`build ${r.repo}: licence ${r.licence} is not permissive`);
      if (!r.shape?.mix || !r.shape?.shape) problems.push(`build ${r.repo}: no qualifying shape`);
      if (blindSlugs.has(poolHash("slug", c.slug)) || blindNames.has(poolHash("name", c.slug.split("/")[1]))) problems.push(`build ${r.repo} overlaps the blind half`);
    }
    // No repo of either half is in another pool or mentioned by the Drift repository (HEAD and every remote ref; hashes only).
    const exPath = join(here, `.apps11-exclusions-${process.pid}.json`);
    const refs = spawnSync("git", ["-C", root, "for-each-ref", "--format=%(objectname)", "refs/remotes/driftv22/", "refs/heads/main"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const at = [...new Set(["HEAD", ...refs])].join(",");
    const xr = spawnSync(process.execPath, [join(here, "select-holdout.mjs"), "exclusion-hashes", "--own", OWN_OUTPUTS.join(","), "--out", exPath, "--at", at], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (xr.status !== 0) problems.push("select-holdout.mjs exclusion-hashes failed");
    else {
      const ex = readJson(exPath);
      rmSync(exPath, { force: true });
      for (const r of b.repos) if (excluded(ex, r.repo)) problems.push(`build ${r.repo} is in another pool or mentioned by the Drift repository`);
      const exKeys = new Set([...Object.keys(ex.slugs ?? {}), ...Object.keys(ex.names ?? {}), ...Object.keys(ex.hashed ?? {})]);
      const hit = h.repos_sha256.filter((r) => exKeys.has(r.slug_sha256) || exKeys.has(r.name_sha256)).length;
      if (hit) problems.push(`${hit} blind repos are in another pool or mentioned by the Drift repository`);
      console.log(`exclusions: ${Object.keys(ex.slugs).length} slugs, ${Object.keys(ex.names).length} names, ${Object.keys(ex.hashed).length} hashed-pool entries at ${new Set(at.split(",")).size} commits; the 12 build repos and the 18 blind hashes checked`);
    }
    if (args.private) {
      const d = privateDir(args);
      const secret = readSecret(d);
      const rec = readJson(join(d, "record.json"));
      problems.push(...replayProblems(rec, secret));
      if (!problems.length) {
        const o = outputsOf(rec, secret);
        const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== "frozen_at"));
        if (JSON.stringify(strip(b)) !== JSON.stringify(o.build)) problems.push("the build manifest differs from what the record gives");
        if (JSON.stringify(strip(h)) !== JSON.stringify(o.blindHashes)) problems.push("the blind hashes differ from what the record gives");
        const km = existsSync(join(d, "apps11-blind.json")) ? readJson(join(d, "apps11-blind.json")) : null;
        if (!km || JSON.stringify(km.repos) !== JSON.stringify(o.blindManifest.repos)) problems.push("the blind key map differs from what the record gives");
        console.log(`private replay: ${rec.pool.length} eligible, ${rec.walked.length} walked, ${rec.counts.accepted} accepted; split 12/18 replayed`);
      }
    }
    if (problems.length) {
      console.error(problems.join("\n"));
      console.error(`verify: ${problems.length} problems`);
      process.exit(1);
    }
    console.log(`verify: apps11 build manifest (12) and blind hashes (18) are consistent${args.private ? ", and replay from the private record" : ""}; no repo of either half is in another pool or mentioned by the Drift repository`);
    return;
  }
  die("usage: select-apps.mjs spec | fetch --private DIR | write --private DIR | verify [--private DIR] | loc DIR | packages DIR");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
