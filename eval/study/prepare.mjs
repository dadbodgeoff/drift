// Prepare a labelling run: check out each manifest repo at its pinned commit, run Drift,
// and write the proposals to label.
//
//   held-out:  node eval/study/prepare.mjs --manifest eval/holdout.json --run eval/study/runs/NAME --drift-src . \
//                [--cache DIR] [--only a,b] [--max 15] [--pool 200]
//   dev:       node eval/study/prepare.mjs --drift BIN --manifest eval/repos.json --run DIR \
//                [--drift-src PATH | --drift-commit SHA] [--reset-clones] [--force] [--tier-min 15] [--strict-tier] [...]
//
// Writes, in the run directory:
//   run.json                 what was run: binary hash, drift commit and build, manifest hash, parameters
//                            (including the pre-registered default tier), per-repo status and binary
//   proposals/<repo>.txt     raw `drift census --all-outliers --max <max>` output (what a user is shown; with `--all`
//                            on a binary that has it, every suggestion, not only the 5 listed first: lib.mjs censusListAll)
//   proposals/<repo>.yaml    .drift/conventions.yaml from `drift init` (structured role and rule)
//   pool/<repo>.txt          `census --max <pool>` (the deeper candidate list, used only for recall@pool)
//   queue.json               every shown proposal (census text joined with its yaml role and rule), with a
//                            stable uid "<repo>/<D-id>" (drift ids are only unique within a repo)
//
// HELD-OUT RUNS. A manifest is held-out if it says so, if its file is named holdout*.json, if its hash is in
// holdout-manifests.json, or if it lists any (non-burned) repo of a registered held-out manifest. Then:
//   - --drift-src is required: the Drift checkout that contains this script. Everything in it except
//     eval/study/runs/ must be committed (tracked and untracked files both count);
//   - the manifest must be a registered held-out manifest inside --drift-src, tracked, identical to HEAD, and
//     have the sha256 recorded in eval/study/holdout-manifests.json;
//   - --run must be eval/study/runs/<name> inside --drift-src (one level; heldOutHistoryProblems reads run
//     records at any depth there, on every ref);
//   - the product commit is HEAD, less any trailing commits that change only eval/study/runs/ (so committing
//     a run record does not change what is measured). It is built here: `git archive` of that commit is
//     exported to <cache>/build/src and built with `cargo build --release --locked`, so no uncommitted or
//     ignored file can reach the binary. --drift, --drift-commit, --force and --tier-min are refused;
//   - before any census (any repo selected; the `--only none` preflight runs none), the run's start record
//     <run>/start.json must be committed: the first such invocation writes it and stops, and the next one
//     checks that HEAD holds it, for this manifest, core and product commit. A run that dies mid-census still
//     leaves that committed marker, and no tier amendment may come after it (heldOutHistoryProblems);
//   - every proposal's census `tier:` line must equal tierOf under the manifest's tier, or the run stops
//     (the product and the study measure the same tier); dev runs check this only with --strict-tier;
//   - each run gets its own checkouts (<cache>/runs/<run>/repos/<name>), which nothing else writes to.
// Dev runs use the shared clones of eval/run.mjs (<cache>/repos/<name>), which must be clean, ignored files
// included; --reset-clones cleans them (git clean -ffdx, checkout -f).
//
// `drift init` runs inside the checkout; everything it adds is removed again and the checkout is verified
// clean, so the tree reviewers open is exactly the repository at its pinned commit.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_RUBRIC, CORE_SCHEME, checkManifestLists, checkTier, censusListAll, coreSha, die, effectiveRepos, effectiveAmendments, heldOutHistoryProblems, heldOutRepos, heldOutTierFile, familyOf, parseArgs, parseCensus, parseYaml, readJson, repoSlug, rubricText, ruleKind, sha256File, sha256Text, tierMinMembers, tierOf } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2), {
  flags: ["force", "resetClones", "strictTier", "pythonProposals"],
  defaults: { cache: join(homedir(), ".cache", "drift-eval") },
});
if (!args.manifest || !args.run) die("usage: prepare.mjs --manifest FILE --run DIR (--drift-src PATH | --drift BIN) [--strict-tier] [--python-proposals] [...]");
// --python-proposals (dev runs only): the study's Python opt-in view (decision D13-py, PLAN-R11 section 3). Mined Python
// proposals are off by default since round 11; this passes `census --python-proposals` to both census runs and opts
// `init` in the product's own way, with `proposals: {python: on}` in the checkout's .drift/config.yaml (removed again
// with .drift/ after init). Recorded in run.json params.python_proposals.
const pythonProposals = args.pythonProposals === true;
const optIn = pythonProposals ? ["--python-proposals"] : [];
// A disagreement between the product's tier and the pre-registered one: never a per-repo failure, it stops the run.
class TierMismatch extends Error {}
const manifestPath = resolve(args.manifest);
const runDir = resolve(args.run);
const cache = resolve(args.cache);
const only = args.only ? new Set(args.only.split(",")) : null;
const manifest = readJson(manifestPath);
const manifestSha = sha256File(manifestPath);
const manifestCore = coreSha(manifest);

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const gitOk = (dir, ...a) => spawnSync("git", ["-C", dir, ...a], { stdio: "ignore" }).status === 0;

// ---- is this a held-out run? Decided by registry, path and content, not only by the file's own flag ----
// A repo is held-out if its pinned sha (globally unique, survives forks and mirrors) or its owner/repo
// (https, ssh or www URLs) matches a non-burned repo or reserve of a registered held-out manifest.
const registryPath = join(here, "holdout-manifests.json");
const registryFile = readJson(registryPath);
const registry = registryFile.manifests; // { "eval/holdout.json": core sha256, ... } relative to the repo root
const harnessRoot = git(here, "rev-parse", "--show-toplevel");
const heldShas = new Set();
const heldSlugs = new Set();
if (registryFile.scheme !== CORE_SCHEME) die(`${registryPath} uses scheme ${JSON.stringify(registryFile.scheme)}; this harness only accepts ${CORE_SCHEME}`);
// Held-out = the repos measured (current slot occupants) plus reserves not yet swapped in. Replaced and
// burned repos are not held-out any more: they may legitimately be dev repos.
for (const p of Object.keys(registry))
  for (const r of heldOutRepos(readJson(join(harnessRoot, p)))) {
    heldShas.add(r.sha);
    heldSlugs.add(repoSlug(r.url));
  }
const allListed = [...manifest.repos, ...(manifest.reserves?.repos ?? [])];
const holdoutWhy = [
  manifest.holdout === true && 'it says "holdout": true',
  /(^|\/)holdout[^/]*\.json$/.test(manifestPath) && "its file is named holdout*.json",
  Object.values(registry).includes(manifestCore) && "its core hash is a registered held-out manifest",
  allListed.some((r) => heldShas.has(r.sha)) && "it pins a held-out repo's commit",
  allListed.some((r) => heldSlugs.has(repoSlug(r.url))) && "it lists a held-out repo",
].filter(Boolean);
const holdout = holdoutWhy.length > 0;
const refuse = (m) => die(`held-out run (${holdoutWhy.join("; ")}): ${m}`);

// ---- parameters that define "proposals shown": pre-registered in the frozen manifest for held-out runs ----
let max;
let pool;
let tier;
if (holdout) {
  for (const [flag, name] of [["drift", "--drift"], ["driftCommit", "--drift-commit"], ["force", "--force"], ["tierMin", "--tier-min"], ["max", "--max"], ["pool", "--pool"], ["resetClones", "--reset-clones"], ["pythonProposals", "--python-proposals"]])
    if (args[flag] !== undefined) refuse(`${name} is not allowed; the binary is built from --drift-src, and max, pool and tier come from the frozen manifest`);
  if (!Number.isInteger(manifest.max) || !Number.isInteger(manifest.pool) || !manifest.tier) refuse("the manifest must pre-register max, pool and tier");
  ({ max, pool, tier } = manifest);
  const tierProblems = checkTier(tier);
  if (tierProblems.length) refuse(`its pre-registered tier is invalid: ${tierProblems.join("; ")}`);
  // The labelling rubric is part of what a held-out run measures (decision D6): its labeller-facing text must be
  // exactly the approved one, so a rubric edit after approval cannot reach a held-out run without a new decision.
  const rubricSha = sha256Text(rubricText(APPROVED_RUBRIC.version));
  if (rubricSha !== APPROVED_RUBRIC.sha256)
    refuse(`RUBRIC-${APPROVED_RUBRIC.version}.md's labeller-facing text hashes to ${rubricSha.slice(0, 12)}, not the ${APPROVED_RUBRIC.sha256.slice(0, 12)} approved with decision ${APPROVED_RUBRIC.decision}; a rubric change after approval needs a new recorded decision (and lib.mjs APPROVED_RUBRIC)`);
} else {
  max = Number(args.max ?? manifest.max ?? 15);
  pool = Number(args.pool ?? manifest.pool ?? 200);
  tier = manifest.tier ?? { kind: "min_members", value: Number(args.tierMin ?? 15) };
  const tierProblems = checkTier(tier);
  if (tierProblems.length) die(`invalid tier: ${tierProblems.join("; ")}`);
  if (manifest.tier && args.tierMin && Number(args.tierMin) !== tierMinMembers(manifest.tier)) die("--tier-min differs from the manifest's pre-registered tier");
}
const repos = holdout ? effectiveRepos(manifest) : manifest.repos;

const runPath = join(runDir, "run.json");
const prev = existsSync(runPath) ? readJson(runPath) : null;
const runKey = `${basename(runDir)}-${createHash("sha256").update(runDir).digest("hex").slice(0, 8)}`;
const runCache = join(cache, "runs", runKey);
if (holdout && existsSync(join(runDir, "prompts", "index.json")))
  refuse(`${runDir} already has prompts (labelling has started); a held-out run is never re-prepared. Use a new --run.`);

// ---- freeze: which product is being measured ----
let drift;
let commit = null;
let dirty = null;
let build = null;
if (holdout) {
  if (!args.driftSrc) refuse("pass --drift-src <the Drift checkout containing this script>");
  const src = git(resolve(args.driftSrc), "rev-parse", "--show-toplevel");
  if (src !== harnessRoot) refuse(`--drift-src (${src}) must be the checkout that contains this script (${harnessRoot})`);
  const rel = relative(src, manifestPath);
  if (rel.startsWith("..")) refuse(`the manifest must live inside --drift-src, not at ${manifestPath}`);
  if (!(rel in registry)) refuse(`${rel} is not a registered held-out manifest (eval/study/holdout-manifests.json)`);
  if (registry[rel] !== manifestCore) refuse(`${rel}'s frozen core hashes to ${manifestCore.slice(0, 12)}, the registry records ${registry[rel].slice(0, 12)}`);
  const listProblems = checkManifestLists(manifest);
  if (listProblems.length) refuse(`its append-only lists are inconsistent with the core:\n  ${listProblems.join("\n  ")}`);
  const relReg = relative(src, registryPath);
  // The run directory: eval/study/runs/<name>, inside --drift-src, after resolving symlinks.
  const runsRoot = join(src, "eval", "study", "runs");
  const runParent = existsSync(dirname(runDir)) ? realpathSync(dirname(runDir)) : dirname(runDir);
  const runName = basename(runDir);
  if (!existsSync(runsRoot) || runParent !== realpathSync(runsRoot) || !runName || runName === "." || runName === ".." || (existsSync(runDir) && realpathSync(runDir) !== join(realpathSync(runsRoot), runName)))
    refuse(`--run must be eval/study/runs/<name> inside --drift-src (one level, no symlinks), not ${runDir}: held-out run records live there, where the history check reads them`);
  if (!/^[A-Za-z0-9._-]+$/.test(runName)) refuse(`the run name ${JSON.stringify(runName)} may use only A-Z, a-z, 0-9, ".", "_" and "-" (git quotes other names in its path listings)`);
  const runRel = `eval/study/runs/${runName}`;
  for (const f of [rel, relReg]) {
    if (!gitOk(src, "ls-files", "--error-unmatch", f)) refuse(`${f} is not tracked by git`);
    if (!gitOk(src, "diff", "--quiet", "HEAD", "--", f)) refuse(`${f} differs from HEAD`);
  }
  // A re-pin committed together with an updated hash would pass the checks above; the history would not.
  // heldOutHistoryProblems (lib.mjs; select-holdout.mjs verify runs the same check) walks every version of
  // every held-out manifest file ever committed: a frozen version must still exist among the registered
  // manifests, by set_id, with an identical core, or a registered amendment (the tier only) must allow it.
  // The amendments are append-only, unique, name only frozen versions, and each is in the history of every
  // held-out run record on any ref (commit order, not dates). So a re-pin, a rename, a set_id change or a scheme bump of a frozen
  // set is refused, short of rewriting history.
  const historyProblems = heldOutHistoryProblems(src, registryFile, relReg);
  if (historyProblems.length) refuse(`the held-out manifests' history is inconsistent:\n  ${historyProblems.join("\n  ")}`);
  // The tier is decision D7's, as eval/study/tier-d7.json defines it and the product implements it: for a primary
  // set by D7, for a secondary set by D7a (lib.mjs heldOutTierFile).
  const tierFile = heldOutTierFile(manifest);
  if (!tierFile || JSON.stringify(manifest.tier) !== JSON.stringify(readJson(join(here, tierFile)).tier))
    refuse(`its tier is not eval/study/${tierFile ?? "tier-d7.json"}'s tier (${manifest?.role === "secondary" ? "decision D7a" : "decision D7"}); a manifest with another tier needs a registered amendment first`);
  if (!manifest.frozen_at || !manifest.set_id || !["primary", "secondary"].includes(manifest.role))
    refuse('a held-out manifest needs set_id, frozen_at and role ("primary" or "secondary") in its frozen core');
  if (manifest.role === "secondary") console.error(`SECONDARY held-out set ${manifest.set_id}: exploratory check only, never a headline result (see its "decision")`);
  if (manifest.holdout !== true || manifest.status !== "frozen") refuse('the manifest must say "holdout": true and "status": "frozen"');
  const status = git(src, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)eval/study/runs");
  if (status) refuse(`commit everything first (product and harness are frozen together):\n${status}`);
  // The product commit: HEAD, less trailing commits that change only eval/study/runs/ (run records).
  commit = git(src, "rev-parse", "HEAD");
  for (;;) {
    const parent = spawnSync("git", ["-C", src, "rev-parse", "--verify", "--quiet", `${commit}^1`], { encoding: "utf8" }).stdout.trim();
    if (!parent) break;
    // --no-renames: a move of product code into runs/ lists its old path too, so it is not runs-only.
    const changed = git(src, "diff", "--no-renames", "-z", "--name-only", parent, commit).split("\0").filter(Boolean);
    if (!changed.length || !changed.every((f) => f.startsWith("eval/study/runs/"))) break;
    commit = parent;
  }
  // The start record: committed before any census, so a run that dies mid-census still leaves a marker that
  // no tier amendment may come after.
  const censusRepos = repos.filter((r) => !only || only.has(r.name));
  if (censusRepos.length) {
    const startRel = `${runRel}/start.json`;
    const start = { held_out: true, status: "started", manifest: rel, set_id: manifest.set_id, core_sha256: manifestCore, product_commit: commit };
    const committed = spawnSync("git", ["-C", src, "show", `HEAD:${startRel}`], { encoding: "utf8" });
    if (committed.status !== 0) {
      if (!existsSync(join(src, startRel))) {
        mkdirSync(join(src, runRel), { recursive: true });
        writeFileSync(join(src, startRel), JSON.stringify({ ...start, started_at: new Date().toISOString() }, null, 2) + "\n");
        refuse(`wrote the start record ${startRel}. Commit it (it is the only change: git add ${startRel} && git commit -m "held-out run start: ${runName}"), push it, and rerun the same command; the census runs only once the start record is committed`);
      }
      refuse(`${startRel} exists but is not committed: commit it (and push it), then rerun`);
    }
    let held;
    try {
      held = JSON.parse(committed.stdout);
    } catch {
      refuse(`${startRel} at HEAD is not JSON`);
    }
    if (!held || typeof held !== "object" || Array.isArray(held)) refuse(`${startRel} at HEAD is not a start record (an object)`);
    for (const k of Object.keys(start)) if (held[k] !== start[k]) refuse(`${startRel} at HEAD is the start record of another run (${k}: ${JSON.stringify(held[k])}, this run: ${JSON.stringify(start[k])}). Use a new --run.`);
    if (!gitOk(src, "diff", "--quiet", "HEAD", "--", startRel)) refuse(`${startRel} differs from HEAD: a start record never changes`);
  }
  dirty = false;
  build = buildProduct(src, commit);
  drift = build.binary;
} else {
  if (!args.drift) die("dev run: pass --drift BIN (held-out runs build the binary themselves)");
  drift = resolve(args.drift);
  if (args.driftSrc) {
    const src = resolve(args.driftSrc);
    commit = git(src, "rev-parse", "HEAD");
    dirty = git(src, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)eval", ":(exclude)docs") !== "";
  } else if (args.driftCommit) commit = args.driftCommit; // recorded as given, not verified (dev runs only)
}
const binarySha = build?.binary_sha256 ?? sha256File(drift);
// Every proposal, not only the suggestions a person is shown first (censusListAll).
const listAll = censusListAll(drift);
const version = spawnSync(drift, ["--version"], { encoding: "utf8" }).stdout.trim();

// Build the product from a clean export of the commit, in a FRESH target dir for this run, so neither an
// uncommitted file nor a stale or replaced target/ can reach the binary. The binary is copied out and hashed
// from that build. Resuming the same run (--only, before labelling) reuses that copy only if its sha256
// still equals the one recorded when it was built.
function buildProduct(src, sha) {
  const keep = join(runCache, `drift-${sha.slice(0, 12)}`);
  if (prev?.drift?.commit === sha && prev.drift.build?.binary === keep && existsSync(keep) && sha256File(keep) === prev.drift.binary_sha256) {
    console.error(`reusing this run's drift ${sha.slice(0, 12)}, built ${prev.drift.build.built_at} (sha256 verified)`);
    return { ...prev.drift.build, reused_at: new Date().toISOString() };
  }
  const dir = join(runCache, "build");
  const exp = join(dir, "src");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(exp, { recursive: true });
  execFileSync("sh", ["-c", `git -C "${src}" archive --format=tar ${sha} | tar -x -C "${exp}"`]);
  const env = { ...process.env, CARGO_TARGET_DIR: join(dir, "target") };
  console.error(`building drift ${sha.slice(0, 12)} from a clean export in a fresh target dir (cargo build --release --locked)...`);
  const r = spawnSync("cargo", ["build", "--release", "--locked", "--bin", "drift"], { cwd: exp, env, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) die(`cargo build failed (${r.status})`);
  const tool = (c, ...a) => spawnSync(c, a, { cwd: exp, encoding: "utf8" }).stdout?.trim() ?? null;
  const userCfg = [join(homedir(), ".cargo", "config.toml"), join(homedir(), ".cargo", "config")].filter(existsSync);
  const info = {
    binary: keep,
    from: "git archive of the commit, built in a fresh CARGO_TARGET_DIR",
    built_at: new Date().toISOString(),
    tree: git(src, "rev-parse", `${sha}^{tree}`),
    cargo: tool("cargo", "--version"),
    rustc: tool("rustc", "-vV"),
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(RUST|CARGO)/.test(k))),
    user_cargo_config: userCfg.map((f) => ({ path: f, sha256: sha256File(f) })),
  };
  copyFileSync(join(dir, "target", "release", "drift"), keep);
  chmodSync(keep, 0o755);
  info.binary_sha256 = sha256File(join(dir, "target", "release", "drift"));
  if (sha256File(keep) !== info.binary_sha256) die("copied binary differs from the build output");
  rmSync(dir, { recursive: true, force: true }); // ~400 MB; the copy is all a run needs
  return info;
}

mkdirSync(join(runDir, "proposals"), { recursive: true });
mkdirSync(join(runDir, "pool"), { recursive: true });
if (prev?.manifest?.holdout && args.force) die("--force is not allowed on a held-out run");
if (prev && !args.force) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (prev.drift.binary_sha256 !== binarySha || prev.drift.commit !== commit)
    die(`${runDir} was prepared with another drift build (${prev.drift.commit ?? prev.drift.binary_sha256}); one run = one frozen product. Use a new --run.`);
  if ((prev.manifest.core_sha256 ?? prev.manifest.sha256) !== (prev.manifest.core_sha256 ? manifestCore : manifestSha)) die(`${runDir} was prepared from a different manifest version`);
  if (!same(prev.params.tier, tier)) die(`${runDir} pre-registered tier ${JSON.stringify(prev.params.tier)}`);
  if (prev.params.max !== max || prev.params.pool !== pool) die(`${runDir} was prepared with max ${prev.params.max} and pool ${prev.params.pool}; they define "proposals shown" and cannot change within a run`);
  if (prev.params.repos && !same(prev.params.repos, repos.map((r) => `${r.name}@${r.sha}`))) die(`${runDir} measured another repo list (a reserve swap or burn since): use a new --run`);
}
// --force (dev only) starts the run over: rows and items from the earlier build are dropped, never mixed in.
const keepPrev = prev && !args.force;

const checkoutRoot = holdout ? join(runCache, "repos") : join(cache, "repos");
const cleanStatus = (dir) => git(dir, "status", "--porcelain", "--ignored", "--untracked-files=all");

function checkout(repo) {
  const dir = join(checkoutRoot, repo.name);
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "ignore", "inherit"] });
  if (!(existsSync(join(dir, ".git")) && git(dir, "rev-parse", "HEAD") === repo.sha)) {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, ".git"))) g("init", "-q");
    // A held-out checkout may copy the commit from the shared clone when that has it (no network); never the reverse.
    const shared = join(cache, "repos", repo.name);
    const local = holdout && existsSync(join(shared, ".git")) && gitOk(shared, "cat-file", "-e", `${repo.sha}^{commit}`);
    g("fetch", "-q", "--depth", "1", local ? shared : repo.url, repo.sha);
    g("checkout", "-q", "--force", repo.sha);
    if (git(dir, "rev-parse", "HEAD") !== repo.sha) throw new Error(`checkout of ${repo.sha} failed`);
  }
  const st = cleanStatus(dir);
  if (st) {
    if (!args.resetClones) throw new Error(`checkout ${dir} is not the pinned tree (modified, untracked or ignored files: ${st.split("\n").slice(0, 3).join("; ")}); pass --reset-clones (dev runs) to clean it`);
    g("clean", "-ffdxq");
    g("checkout", "-q", "--force", repo.sha);
    if (cleanStatus(dir)) throw new Error(`could not clean ${dir}`);
  }
  return dir;
}

function run(a) {
  const t = Date.now();
  const r = spawnSync(drift, a, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`drift ${a.join(" ")} failed (${r.status}): ${(r.stderr || "").slice(0, 400)}`);
  return { out: r.stdout, err: r.stderr, ms: Date.now() - t };
}

// Run `drift init` in the (clean) checkout and take its conventions.yaml out again.
function initYaml(dir) {
  try {
    if (pythonProposals) {
      if (existsSync(join(dir, ".drift"))) throw new Error(`${dir} already has .drift/: the Python opt-in would mix with the repo's own config`);
      mkdirSync(join(dir, ".drift"), { recursive: true });
      writeFileSync(join(dir, ".drift", "config.yaml"), "proposals:\n  python: on\n");
    }
    run(["--root", dir, "--no-cache", "init", "--max", String(Math.max(max, pool))]);
    return readFileSync(join(dir, ".drift", "conventions.yaml"), "utf8");
  } finally {
    rmSync(join(dir, ".drift"), { recursive: true, force: true });
    rmSync(join(dir, "drift.lock"), { force: true });
    const after = cleanStatus(dir);
    if (after) throw new Error(`checkout not clean after drift init:\n${after}`);
  }
}

const rows = [];
const items = [];
for (const repo of repos) {
  if (only && !only.has(repo.name)) {
    const old = keepPrev && prev.repos?.find((r) => r.name === repo.name);
    if (old) rows.push(old);
    continue;
  }
  // language and framework_bucket as the manifest categorises the repo (the primary sets record both; dev and
  // secondary manifests have neither, only free-text `shape`), so metrics.mjs can report per language and bucket.
  const row = { name: repo.name, url: repo.url, sha: repo.sha, shape: repo.shape, language: repo.language ?? null, framework_bucket: repo.framework_bucket ?? null, binary_sha256: binarySha, prepared_at: new Date().toISOString() };
  try {
    const dir = checkout(repo);
    row.checkout = dir;
    const census = run(["--root", dir, "--no-cache", "census", "--all-outliers", ...listAll, ...optIn, "--max", String(max)]);
    writeFileSync(join(runDir, "proposals", `${repo.name}.txt`), census.out);
    const deep = run(["--root", dir, "--no-cache", "census", ...listAll, ...optIn, "--max", String(pool)]);
    writeFileSync(join(runDir, "pool", `${repo.name}.txt`), deep.out);
    if (cleanStatus(dir)) throw new Error(`census wrote into ${dir}`);
    const yamlText = initYaml(dir);
    writeFileSync(join(runDir, "proposals", `${repo.name}.yaml`), yamlText);

    const parsed = parseCensus(census.out);
    const conv = new Map((parseYaml(yamlText)?.conventions ?? []).map((c) => [c.id, c]));
    const seen = new Set();
    const props = parsed.proposals.map((p) => {
      if (seen.has(p.id)) throw new Error(`duplicate proposal id ${p.id} in ${repo.name}`);
      seen.add(p.id);
      const c = conv.get(p.id);
      if (!c) console.error(`${repo.name}: ${p.id} is in census but not in conventions.yaml (kind falls back to text)`);
      const q = {
        uid: `${repo.name}/${p.id}`,
        repo: repo.name,
        id: p.id,
        rank: p.rank,
        summary: p.summary,
        role: c?.role ?? null,
        rule: c?.rule ?? null,
        evidence: p.evidence ?? c?.evidence ?? null,
        // The role's size, as the product's tier reads it (Evidence::role_size): conventions.yaml's
        // evidence.role_members when the rule is about only part of the role, else the census total.
        members: c?.evidence?.role_members ?? p.evidence?.total ?? c?.evidence?.total ?? null,
        example: p.example,
        // How many role members are Python (decision D7: any makes the convention advise only); null if none.
        python_members: c?.evidence?.python_members ?? null,
        outliers: p.outliers.length + p.more_outliers,
        outlier_files: [...new Set(p.outliers.map((o) => o.path))],
        block: p.block,
      };
      q.family = familyOf(q);
      q.rule_kind = ruleKind(q.rule); // structured kind (null without a conventions.yaml rule)
      q.tier = tierOf(q, tier); // under the pre-registered tier; metrics.mjs recomputes it from params.tier
      // The product's own tier (census `tier:` line) must be the study's: a held-out run (or --strict-tier)
      // stops on the first proposal where the product and the pre-registered tier disagree, or where the
      // census prints no tier at all (fail closed: a missing line is not agreement).
      if ((holdout || args.strictTier) && !p.census_tier)
        throw new TierMismatch(`${q.uid}: the census prints no tier line, the pre-registered tier gives ${q.tier} (${q.rule_kind ?? "no rule"}, ${q.members} members): the product's tier cannot be checked`);
      if ((holdout || args.strictTier) && p.census_tier !== q.tier)
        throw new TierMismatch(`${q.uid}: the census says tier ${p.census_tier}, the pre-registered tier gives ${q.tier} (${q.rule_kind ?? "no rule"}, ${q.members} members): the product and the study disagree`);
      return q;
    });
    items.push(...props);
    Object.assign(row, {
      status: "ok",
      units: parsed.header?.units ?? null,
      roles: parsed.header?.roles ?? null,
      proposals: props.length,
      pool: parseCensus(deep.out).proposals.length,
      census_ms: census.ms,
    });
  } catch (e) {
    if (e instanceof TierMismatch) die(e.message);
    row.status = `ERROR: ${e.message.split("\n")[0]}`;
  }
  rows.push(row);
  console.error(`${repo.name}: ${row.status}${row.proposals != null ? ` (${row.proposals} proposals, pool ${row.pool})` : ""}`);
}

// Keep queue items of repos not re-run this time (--only), so the queue always covers the manifest.
if (only && keepPrev && existsSync(join(runDir, "queue.json"))) {
  for (const p of readJson(join(runDir, "queue.json")).items) if (!only.has(p.repo)) items.push(p);
}
const order = new Map(repos.map((r, i) => [r.name, i]));
items.sort((a, b) => order.get(a.repo) - order.get(b.repo) || a.rank - b.rank);

const runJson = {
  run: relative(process.cwd(), runDir) || runDir,
  prepared_at: new Date().toISOString(),
  // The registered amendments of this set, with their corrections applied (e.g. the secondary sets' D5a).
  amendments: holdout ? effectiveAmendments(registryFile).filter((a) => a.set_id === manifest.set_id).map(({ superseded_core, core, fields, decision, date, by }) => ({ superseded_core, core, fields, decision, date, by })) : [],
  manifest: { path: relative(process.cwd(), manifestPath), sha256: manifestSha, core_sha256: manifestCore, holdout, holdout_because: holdoutWhy, set_id: manifest.set_id ?? null, role: holdout ? manifest.role : "dev", language: manifest.language ?? null },
  drift: { binary: drift, binary_sha256: binarySha, version, commit, dirty, build },
  // The study tooling (this script's checkout) the run was prepared with: its HEAD, and whether eval/ differed from it.
  harness: { commit: git(harnessRoot, "rev-parse", "HEAD"), eval_dirty: git(harnessRoot, "status", "--porcelain", "--untracked-files=all", "--", "eval", ":(exclude)eval/study/runs") !== "" },
  // tier_pre_registered: the tier came from the manifest (always, for a held-out run), not the min_members default.
  // decisions: the rules this run is read under that are not in every earlier run (PLAN-R14 WS-F F3: D1/D4 at n >= 30
  // on the quoted lower bound; README decision log). metrics.mjs applies F3 only to runs that name it.
  params: { max, pool, tier, tier_pre_registered: Boolean(manifest.tier), python_proposals: pythonProposals, decisions: ["F3"], exposed: (manifest.exposed ?? []).map((e) => e.name), repos: repos.map((r) => `${r.name}@${r.sha}`), cache, checkouts: checkoutRoot },
  repos: rows,
};
writeFileSync(runPath, JSON.stringify(runJson, null, 2) + "\n");
writeFileSync(join(runDir, "queue.json"), JSON.stringify({ run: runJson.run, items }, null, 2) + "\n");
const bad = rows.filter((r) => r.status !== "ok");
console.error(`${items.length} proposals queued from ${rows.length - bad.length} repos${bad.length ? `; ${bad.length} failed` : ""}`);
process.exit(bad.length ? 1 : 0);
