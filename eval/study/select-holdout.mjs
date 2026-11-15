// Select the PRIMARY held-out sets, code-blind: a seeded, stratified random draw from GitHub search.
//
//   fetch:   node eval/study/select-holdout.mjs fetch  [--record FILE]   search, exclude, draw, pin; writes the record
//   write:   node eval/study/select-holdout.mjs write  [--record FILE]   record -> manifests + registry (once, then frozen)
//   verify:  node eval/study/select-holdout.mjs verify [--record FILE] [--registry FILE] [--dev a.json,b.json]
//            offline and deterministic: checks that the primary manifests are exactly what the selection gives
//            from its frozen inputs (seed, spec, exclusion lists, eligible pool, walked shas), replaying the
//            exclusions' git-derived part from the recorded refs and the draw from the record, and that no
//            held-out repo overlaps a dev manifest (eval/repos*.json on every local branch, plus --dev files).
//            It never contacts GitHub or the held-out repos. Also checks the secondary sets against the dev manifests,
//            their append-only lists and their registered core hashes. --manifest-root DIR reads fixture manifests
//            (tests only): it prints a FIXTURE banner and never exits 0 (4 when clean).
//   extend:  node eval/study/select-holdout.mjs extend --set ts|py --add N [--extension FILE]   decision D9 (reserve
//            exhaustion at runbook step 4): continue the same draw (same pool, seed, walk order and classifier) with
//            the set's reserve_order continued cyclically by N places; writes the extension record (default
//            eval/study/selection/primary-2026-11-05-d9.json), appends the new reserves to the manifest and registers
//            the new core with a reserves-only amendment (decision D9) from every earlier frozen core. --add is the
//            TOTAL number of places added; a larger --add later continues the same extension (recorded steps reused).
//   probe:   node eval/study/select-holdout.mjs probe ts|py OWNER/REPO...   the classifier on dev repos; refuses any
//            repo of any held-out manifest (repos, reserves, replaced, burned, exposed) before any network call
//   redact:  node eval/study/select-holdout.mjs redact < text   the redactor every message goes through (tests)
//   exclusion-hashes --own A,B --out FILE [--at SHA,...]   the exclusions of a selection outside this script (eval/study/
//            select-apps.mjs), as HASHES only (lib.mjs poolHash), so its operator never reads a held-out or blind pool
//            name: every exclusion source above, with the files A,B (that selection's own outputs) left out. Without
//            --at: at the current refs, PR and issue text included (network). With --at: offline, git objects of
//            those commits only (verify). Prints counts only.
//
// No output names a held-out repo: see heldOutRedactor.
//
// Code-blind means: candidates are chosen from repository METADATA (GitHub search: stars, size, push date,
// archived, fork, licence, name, topics) and their DEPENDENCY MANIFESTS only (package.json; pyproject.toml,
// requirements*.txt, setup.cfg, Pipfile), to detect the framework. Manifests are queried through GitHub code
// search restricted to those file names (see "classification" below for why not the contents API): the only
// answers used are which manifests of a repo contain a framework's package name, and the manifests' paths (to
// skip docs/examples/test members). Nothing else of a candidate is fetched, read or recorded: no source, docs,
// README, AGENTS.md or CONTRIBUTING, no clone (the HEAD sha comes from `git ls-remote`), no Drift run.
//
// Determinism. The draw is a function of (eligible pool, seed): the pool is sorted by owner/repo, shuffled with
// lib.mjs shuffle(seed), and walked in that order; each walked candidate is pinned and classified, and fills
// the next open place of its framework bucket (primaries first, then that bucket's reserves). Taking the first k
// of a uniform random permutation within each bucket is a uniform random sample per bucket. GitHub search
// changes over time, so `fetch` stores the eligible pool (owner/repo only), the exclusion list and every walked
// candidate's sha and bucket in the record; `verify` replays the draw from the record without the network.
//
// The record holds only metadata. Each selected repo is recorded as {name, url, sha, language,
// framework_bucket, size_kb, stars, pushed_at}.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_SCHEME, HELD_OUT_TIER_FILES, amendableFields, checkManifestLists, checkTier, coreSha, die, effectiveAmendments, heldOutHistoryProblems, heldOutRepos, heldOutTierFile, parseArgs, parseJson, poolHash, readJson, repoSlug, shuffle } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = spawnSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
const args = parseArgs(process.argv.slice(2));
const mode = args._[0];
if (!["fetch", "write", "verify", "probe", "redact", "extend", "spec", "exclusion-hashes"].includes(mode)) die("usage: select-holdout.mjs fetch|write|verify [--selection primary|heldout2] [--record FILE] | probe ts|py OWNER/REPO... | redact (stdin to stdout) | exclusion-hashes --own A,B --out FILE [--at SHA,SHA]");

// ---------------------------------------------------------------------------------------------------------
// The pre-registered selection specifications. Each is fixed before its draw; changing anything in one is a new
// selection (new set_ids), never a re-draw of it. `--selection` picks one (default: primary).
//   primary   the primary held-out sets (2026-11-05), measured on frozen 29f4cd6 and reported (#111).
//   heldout2  the second held-out draw (decision D11, 2026-11-07): selection only; census at the round-9 freeze;
//             used for the D1/D4 re-measure and the D10.3 verifier check. The same buckets, quotas, filters and
//             classifier as the primary draw, a new seed (committed and pushed before the draw), and reserves
//             fixed in advance at 18 (TS/JS) and 12 (Python): the primary run needed 10 and 5, and a reserves
//             amendment (D9) of this set is no longer possible once any held-out run record exists
//             (lib.mjs heldOutHistoryProblems: every amendment precedes every held-out run record).
// ---------------------------------------------------------------------------------------------------------
// TS/JS buckets. Precedence: the first bucket whose packages appear wins (server frameworks before UI frameworks).
const TS_BUCKETS = [
  { id: "nestjs", label: "NestJS", primaries: 3, deps: ["@nestjs/core"] },
  { id: "nextjs", label: "Next.js", primaries: 4, deps: ["next"] },
  { id: "express_fastify_hono", label: "Express/Fastify/Hono", primaries: 4, deps: ["express", "fastify", "hono"] },
  { id: "react_spa", label: "React SPA", primaries: 4, deps: ["react-dom"] },
  { id: "other_node", label: "other Node", primaries: 3, deps: null },
];
const PY_BUCKETS = [
  { id: "django", label: "Django/DRF", primaries: 3, deps: ["django", "djangorestframework"] },
  { id: "fastapi", label: "FastAPI", primaries: 3, deps: ["fastapi"] },
  { id: "flask", label: "Flask", primaries: 2, deps: ["flask"] },
  { id: "other_python", label: "other Python", primaries: 2, deps: null },
];
// The i-th reserve slot is filled from this bucket (reserves are used in this order, rule 1).
const TS_RESERVE_ORDER = ["nextjs", "react_spa", "express_fastify_hono", "nestjs", "other_node", "nextjs"];
const PY_RESERVE_ORDER = ["django", "fastapi", "flask", "other_python"];
const times = (order, n) => Array.from({ length: n }, () => order).flat();
// The same buckets (ids, labels, packages, precedence) with other primary quotas: a smaller draw of the same population.
const withPrimaries = (buckets, quota) => {
  if (Object.keys(quota).sort().join() !== buckets.map((b) => b.id).sort().join()) die("withPrimaries: a quota for every bucket, and only those");
  return buckets.map((b) => ({ ...b, primaries: quota[b.id] }));
};
const STARS = [300, 15000];
// GitHub `size` is in KB and includes history and assets; 20 MB is the metadata-only proxy for "at least
// ~300 source files", so that roles of 15 members can exist. A repo that still turns out too small fails the
// technical check (rule 1: < 200 parseable files) and gives way to the next reserve.
const SIZE_KB = [20000, 500000];
const commonOf = (pushedSince) => `size:${SIZE_KB[0]}..${SIZE_KB[1]} pushed:>=${pushedSince} archived:false fork:false is:public`;
const SELECTIONS = {
  primary: {
    date: "2026-11-05",
    // The seed is the Drift main commit this selection branched from (fixed before any candidate was seen).
    seed: "drift-heldout-primary-2026-11-05:859542f401a358c1bf32e43fefd9e048fd88be92",
    pushed_since: "2026-05-05", // pushed within 6 months of the date
    record: "eval/study/selection/primary-2026-11-05.json",
    extension: "eval/study/selection/primary-2026-11-05-d9.json",
    // this selection's own outputs, never a source of its exclusions
    own: ["eval/study/selection/"],
    sets: (common) => ({
      ts: { set_id: "ts-primary-2026-11-05", path: "eval/holdout-primary.json", language: "typescript/javascript", queries: [`language:TypeScript ${common}`, `language:JavaScript ${common}`], buckets: TS_BUCKETS, reserve_order: TS_RESERVE_ORDER },
      py: { set_id: "py-primary-2026-11-05", path: "eval/holdout-primary-py.json", language: "python", queries: [`language:Python ${common}`], buckets: PY_BUCKETS, reserve_order: PY_RESERVE_ORDER },
    }),
    record_note: "Selection record of the primary held-out sets (eval/study/select-holdout.mjs). Metadata only: no repository contents beyond dependency manifests were fetched, and none are recorded. `verify` replays the draw from this record.",
    manifest_note: "HELD-OUT set, role PRIMARY: the headline precision result comes from this set. FROZEN since `frozen_at`: the core (set_id, role, frozen_at, repos, reserves, tier, max, pool) never changes; only the append-only lists `replaced`, `burned` and `exposed` may grow. Rules: eval/study/README.md#held-out-rules. Selected code-blind by eval/study/select-holdout.mjs (see `selection`); nobody working on the product has read these repos.",
    decision: "Decision 2026-11-05 (product lead, before any held-out data): the primary held-out sets are fresh and selected by a code-blind script (seeded random sample from GitHub search by language, size and activity; framework detected only from dependency manifests; only metadata recorded). This is that set. The former sets (holdout.json, holdout-py.json) are secondary.",
    excludes: "excluding every repo the Drift repository mentions (dev sets, secondary sets with reserves, replaced and exposed, any github.com URL on any branch, commit messages, PR and issue text)",
  },
  heldout2: {
    date: "2026-11-07",
    // Committed and pushed (ws/heldout2-draw) before the draw: the main commit the selection branched from, and
    // 128 bits from `openssl rand -hex 16`, drawn once, before any candidate of this selection was seen.
    seed: "drift-heldout2-2026-11-07:6be4e9b992729c31fbd50b70d9c55c5d72085eaa:96981b12fc4ecd258ffa1003af1a1917",
    pushed_since: "2026-05-07", // pushed within 6 months of the date (the primary draw's rule)
    record: "eval/study/selection/heldout2-2026-11-07.json",
    extension: null, // no D9-style extension: see above
    // Only its own outputs: the primary sets, their records and the D9 extension ARE sources of its exclusions.
    own: ["eval/study/selection/heldout2-2026-11-07.json"],
    sets: (common) => ({
      ts: { set_id: "ts-heldout2-2026-11-07", path: "eval/holdout-2-2026-11-07.json", language: "typescript/javascript", queries: [`language:TypeScript ${common}`, `language:JavaScript ${common}`], buckets: TS_BUCKETS, reserve_order: times(TS_RESERVE_ORDER, 3) },
      py: { set_id: "py-heldout2-2026-11-07", path: "eval/holdout-2-2026-11-07-py.json", language: "python", queries: [`language:Python ${common}`], buckets: PY_BUCKETS, reserve_order: times(PY_RESERVE_ORDER, 3) },
    }),
    record_note: "Selection record of the second held-out draw (decision D11; eval/study/select-holdout.mjs --selection heldout2). Metadata only: no repository contents beyond dependency manifests were fetched, and none are recorded. `verify` replays the draw from this record.",
    manifest_note: "HELD-OUT set (second draw, decision D11), role PRIMARY: the D1/D4 re-measure and the D10.3 verifier check come from this set. FROZEN since `frozen_at`: the core (set_id, role, frozen_at, repos, reserves, tier, max, pool) never changes; only the append-only lists `replaced`, `burned` and `exposed` may grow. Rules: eval/study/README.md#held-out-rules. Selected code-blind by eval/study/select-holdout.mjs --selection heldout2 (see `selection`); nobody working on the product has read these repos.",
    decision: "Decision D11 (lead, 2026-11-07, before any data of this set existed): second held-out draw, selection only; census at the round-9 freeze; used for the D1/D4 re-measure and the D10.3 verifier check. Drawn code-blind with the primary draw's buckets, quotas, filters and classifier, a new seed committed before the draw, and every repo of the dev sets and of the earlier held-out sets (repos, reserves, replaced, exposed) excluded.",
    excludes: "excluding every repo the Drift repository mentions (dev sets, the primary and secondary held-out sets with their reserves, replaced and exposed entries, any github.com URL on any branch, commit messages, PR and issue text)",
  },
  // A rolling BLIND DEV pool (role "dev", PLAN-R10 section 3.1): drawn under the held-out procedure and exclusions, but
  // not a held-out set: it is not registered in holdout-manifests.json (its manifests carry "holdout": false), has its
  // own registry of core hashes, and carries no D1/D4 verdict. Its census and blind labelling run once, at the round-10
  // freeze; after its report it joins the build set. Isolation: every output of a role-"dev" selection is named
  // eval/<selection>* (or lives under eval/study/runs/<selection>*), checked before anything is written, so the rule
  // "never open eval/dev3* or eval/study/runs/dev3*" covers all of it.
  //   dev3  12 TS/JS and 8 Python repos: the held-out quotas scaled to 12/18 and 8/10 by largest remainder (ties
  //         in bucket order); reserves fixed before the draw at 18 and 12 (the held-out reserve order x3; heldout2
  //         needed 12 of 18 and 5 of 12 for 18 and 10 slots).
  dev3: {
    role: "dev",
    date: "2026-11-08",
    // Committed and pushed (ws/dev3-select) before the draw: the main commit the selection branched from, and
    // 128 bits from `openssl rand -hex 16`, drawn once, before any candidate of this selection was seen.
    seed: "drift-dev3-2026-11-08:459e52857b0d6de8fb7a414e5841d3ad6a66a74d:1ec283eb0ee09446d7ea887006f5cebd",
    pushed_since: "2026-05-08", // pushed within 6 months of the date (the held-out draws' rule)
    record: "eval/dev3-2026-11-08-selection.json",
    registry: "eval/dev3-2026-11-08-registry.json",
    extension: null,
    // Only its own outputs: every held-out manifest, record and extension IS a source of its exclusions.
    own: ["eval/dev3-2026-11-08-selection.json", "eval/dev3-2026-11-08-registry.json"],
    sets: (common) => ({
      ts: { set_id: "ts-dev3-2026-11-08", path: "eval/dev3-2026-11-08.json", language: "typescript/javascript", queries: [`language:TypeScript ${common}`, `language:JavaScript ${common}`], buckets: withPrimaries(TS_BUCKETS, { nestjs: 2, nextjs: 3, express_fastify_hono: 3, react_spa: 2, other_node: 2 }), reserve_order: times(TS_RESERVE_ORDER, 3) },
      py: { set_id: "py-dev3-2026-11-08", path: "eval/dev3-2026-11-08-py.json", language: "python", queries: [`language:Python ${common}`], buckets: withPrimaries(PY_BUCKETS, { django: 2, fastapi: 2, flask: 2, other_python: 2 }), reserve_order: times(PY_RESERVE_ORDER, 3) },
    }),
    record_note: "Selection record of the dev3 blind dev pool (PLAN-R10 section 3.1; eval/study/select-holdout.mjs --selection dev3). Metadata only: no repository contents beyond dependency manifests were fetched, and none are recorded. `verify` replays the draw from this record.",
    manifest_note: "BLIND DEV pool dev3 (PLAN-R10 section 3.1), role DEV: not a held-out set (no D1/D4 verdict); it predicts the next held-out draw. Drawn with the held-out procedure and exclusions. FROZEN since `frozen_at`: the core (set_id, role, frozen_at, repos, reserves, tier, max, pool) never changes (registered in `selection.registry`); only the append-only lists `replaced`, `burned` and `exposed` may grow. Nobody building product opens these repos, cards or labels before the round-10 freeze; only the dev3 operator runs its census and blind labelling, once, at the freeze. After its report it joins the build set.",
    decision: "PLAN-R10 section 3.1 (adopted with D12, 2026-11-08): a rolling blind dev pool, dev3: select-holdout.mjs --selection dev3 with the held-out procedure and exclusions, 12 TS/JS and 8 Python repos, role dev, reserves fixed before the draw; census and blind labelling (rubric v3) once, at the round-10 freeze, on the frozen binary.",
    excludes: "excluding every repo the Drift repository mentions (dev sets, polar and CTFd, every held-out set (primary, secondary and both later draws) with its reserves, replaced, burned and exposed entries, any github.com URL on any branch, commit messages, PR and issue text)",
  },
  //   dev4  36 TS/JS and 24 Python repos (PLAN-R11 section 4.1, D13): twice the held-out quotas per bucket (Python
  //         by largest remainder, 24/10 = 2.4x); reserves fixed before the draw at 54 and 36 (the held-out reserve
  //         order x9, 1.5x the slots: dev3's technical check swapped 6 of 12 and 4 of 8, heldout2's 12 of 18). The
  //         cap a short bucket's places are handed up to is doubled with the quotas (10), so that it can still act.
  //         Every earlier blind dev pool (dev3) is a source of its exclusions, like every held-out set.
  dev4: {
    role: "dev",
    date: "2026-11-08",
    // Committed and pushed (ws/dev4-select) before the draw, after the dev4-check pre-registration (48b85cf): the
    // main commit the selection branched from, and 128 bits from `openssl rand -hex 16`, drawn once, before any
    // candidate of this selection was seen.
    seed: "drift-dev4-2026-11-08:bb1d45ed129027d3c65349dc0ca653e68b13d125:abedc84078600f8fdfce1b9318162139",
    pushed_since: "2026-05-08", // pushed within 6 months of the date (the held-out draws' rule)
    max_per_bucket: 10,
    record: "eval/dev4-2026-11-08-selection.json",
    registry: "eval/dev4-2026-11-08-registry.json",
    extension: null,
    // Only its own outputs: every held-out manifest, record and extension, and every other pool's files, ARE sources.
    own: ["eval/dev4-2026-11-08-selection.json", "eval/dev4-2026-11-08-registry.json"],
    sets: (common) => ({
      ts: { set_id: "ts-dev4-2026-11-08", path: "eval/dev4-2026-11-08.json", language: "typescript/javascript", queries: [`language:TypeScript ${common}`, `language:JavaScript ${common}`], buckets: withPrimaries(TS_BUCKETS, { nestjs: 6, nextjs: 8, express_fastify_hono: 8, react_spa: 8, other_node: 6 }), reserve_order: times(TS_RESERVE_ORDER, 9) },
      py: { set_id: "py-dev4-2026-11-08", path: "eval/dev4-2026-11-08-py.json", language: "python", queries: [`language:Python ${common}`], buckets: withPrimaries(PY_BUCKETS, { django: 7, fastapi: 7, flask: 5, other_python: 5 }), reserve_order: times(PY_RESERVE_ORDER, 9) },
    }),
    record_note: "Selection record of the dev4 blind dev pool (PLAN-R11 section 4.1; eval/study/select-holdout.mjs --selection dev4). Metadata only: no repository contents beyond dependency manifests were fetched, and none are recorded. `verify` replays the draw from this record.",
    manifest_note: "BLIND DEV pool dev4 (PLAN-R11 section 4.1), role DEV: not a held-out set (no D1/D4 verdict); its dev4-check (PREREG-F11-dev4-check.md) gates the next held-out draw. Drawn with the held-out procedure and exclusions. FROZEN since `frozen_at`: the core (set_id, role, frozen_at, repos, reserves, tier, max, pool) never changes (registered in `selection.registry`); only the append-only lists `replaced`, `burned` and `exposed` may grow. Nobody building product opens these repos, cards or labels before the round-11 freeze; only the dev4 operator runs its census and blind labelling, once, at the freeze. After its report it joins the build set.",
    decision: "PLAN-R11 section 4.1 (adopted with D13, 2026-11-08): a blind dev pool, dev4: select-holdout.mjs --selection dev4 with the held-out procedure and exclusions (every dev set, dev3 and every held-out set), 36 TS/JS and 24 Python repos (twice the held-out quotas), role dev, reserves fixed before the draw; census at the round-11 freeze on the frozen binary (TS/JS shown cards; the Python opt-in view) and blind labelling (rubric v3).",
    excludes: "excluding every repo the Drift repository mentions (dev sets, polar and CTFd, every held-out set (primary, secondary and both later draws) and every earlier blind dev pool (dev3) with its reserves, replaced, burned and exposed entries, any github.com URL on any branch, commit messages, PR and issue text)",
  },
};
const SELECTION = args.selection ?? "primary";
const SEL = SELECTIONS[SELECTION] ?? die(`--selection must be one of ${Object.keys(SELECTIONS).join(", ")}`);
const recordPath = resolve(root, args.record ?? SEL.record);
const ROLE = SEL.role ?? "primary";
const DEV_POOL = ROLE === "dev";
// What a selected repo is called in messages: a held-out repo, or a repo of a blind dev pool.
const KIND = DEV_POOL ? "blind-dev" : "held-out";
// A selection with its own registry (a blind dev pool) never touches the held-out registry.
const selRegistryRel = SEL.registry ?? null;
if (mode === "extend" && !SEL.extension) die(`extend: decision D9 extends the primary sets only; the ${SELECTION} selection fixed its reserves before its draw`);
const DATE = SEL.date;
const SEED = SEL.seed;
const PUSHED_SINCE = SEL.pushed_since;
const COMMON = commonOf(PUSHED_SINCE);
// OSI-approved licences (SPDX ids), applied to the search results' licence metadata. GitHub repository search
// takes one license: qualifier per query, so the filter is applied to the result set instead of fanning out.
const OSI = [
  "0BSD", "AFL-3.0", "AGPL-3.0", "Apache-2.0", "Artistic-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause-Clear",
  "BSL-1.0", "CECILL-2.1", "ECL-2.0", "EPL-1.0", "EPL-2.0", "EUPL-1.1", "EUPL-1.2", "GPL-2.0", "GPL-3.0", "ISC",
  "LGPL-2.1", "LGPL-3.0", "LPPL-1.3c", "MIT", "MIT-0", "MPL-2.0", "MS-PL", "MS-RL", "MulanPSL-2.0", "NCSA",
  "OFL-1.1", "OSL-3.0", "PostgreSQL", "UPL-1.0", "Unlicense", "Zlib",
];
// Obvious non-applications, by NAME or TOPIC metadata only (never description or contents).
const NON_APP_NAME =
  /(^|[-_.])(awesome|tutorials?|courses?|examples?|samples?|demos?|learn|learning|workshops?|cheat-?sheets?|interviews?|roadmaps?|books?|boilerplates?|starters?|templates?|exercises?|homework|leetcode|playgrounds?|snippets|dotfiles|lessons?|bootcamp|challenges?|100-?days(-of-[a-z]+)?|kata|katas)([-_.]|$)|^awesome/i;
const NON_APP_TOPICS = new Set([
  "awesome", "awesome-list", "awesome-lists", "list", "tutorial", "tutorials", "course", "courses", "examples", "example",
  "sample", "samples", "sample-code", "demo", "boilerplate", "boilerplates", "starter", "starter-kit", "starter-template",
  "template", "templates", "cheatsheet", "interview", "interview-questions", "interview-preparation", "roadmap", "book",
  "books", "exercises", "leetcode", "algorithms", "data-structures", "learning", "learn", "dotfiles", "workshop",
]);
// Workspace members that are not the product (docs sites, examples, playgrounds): skipped for classification.
const NON_PRODUCT_DIR = /(^|\/)(docs?|documentation|website|site|examples?|samples?|playgrounds?|demos?|e2e|storybook|benchmarks?|fixtures?|templates?|tests?|__tests__)(\/|$)/i;

const SETS = SEL.sets(COMMON);
// The held-out draws' cap; a selection may set its own (dev4: doubled with its quotas). Part of the spec.
const MAX_PER_BUCKET = SEL.max_per_bucket ?? 5;
// The specification a record is drawn under, and `verify` compares it with (the tier aside: it plays no part in the draw).
const specOf = () => ({ date: DATE, pushed_since: PUSHED_SINCE, stars: STARS, size_kb: SIZE_KB, common_qualifiers: COMMON, osi_licences: OSI, non_app_name: String(NON_APP_NAME), non_app_topics: [...NON_APP_TOPICS], non_product_dir: String(NON_PRODUCT_DIR), max_per_bucket: MAX_PER_BUCKET, sets: SETS });
const extPathOf = () => (SEL.extension ? args.extension ?? SEL.extension : null);
// If a bucket cannot be filled from the whole pool, its open primary places go to the other buckets in this
// order of each set's `buckets`, never above MAX_PER_BUCKET.

// The tier as pre-registered (product lead, 2026-11-05, before any data of these sets existed), amended the same
// day before any held-out run (wrapped_by:jsx moved to the default tier). The selection record's spec.tier is
// this tier as it stood at the draw (the tier plays no part in the draw). Decision D5 (lead; approved by the
// founder 2026-11-06, before any held-out census) replaced the manifests' tier with eval/study/tier-d5.json,
// registered as an amendment in holdout-manifests.json. The lead amended the secondary sets (eval/holdout.json,
// eval/holdout-py.json) to the same tier the same day (D5a). Decision D7 (approved by the founder 2026-11-06, before
// any held-out census) replaced the primary manifests' tier with eval/study/tier-d7.json, registered the same way,
// and the lead amended the secondary sets to it the same day (D7a). MANIFEST_TIER below is what the held-out
// manifests hold, and lib.mjs heldOutTierFile gives each set's tier file.
const RULE5_TIER = {
  "//": "Pre-registered 2026-11-05 by the product lead, before these sets were drawn. DEFAULT tier (blocking-eligible; its ACCEPT / shown is the headline default-tier accept rate) = the proposal's structured rule kind (lib.mjs ruleKind: conventions.yaml rule.type, rule.kind for wrapped_by, import vs other signal for avoids; never the summary text) is in default.rule_kinds AND its role has >= default.min_members members (PLAN: n >= 15 to allow blocking). SUGGESTION tier = every other shown proposal, including kinds listed in neither list and proposals without a structured rule. The not-wrong rate is reported over all shown proposals, both tiers. Amended 2026-11-05, before any held-out run (no held-out data existed): wrapped_by:jsx moved from suggestion to default (product lead).",
  kind: "rule_kind",
  default: {
    "//": "call wrappers, decorators, base classes, required argument keys, layering (import avoidance), rendered components, rendered inside a (layout) wrapper",
    rule_kinds: ["wrapped_by:call", "wrapped_by:decorator", "wrapped_by:extends", "passes_key", "avoids:import", "renders", "wrapped_by:jsx"],
    min_members: 15,
  },
  suggestion: {
    "//": "named by the product lead: generic calls, naming, absence (any/console/bare Error and other non-import avoids), preferred libraries, ordering, file/model/package rules. Unmeasured, so suggestion tier (the default tier is an allowlist): wrapped_by:try, control, directive, throws.",
    rule_kinds: [
      "calls", "named", "avoids:other", "prefers_library", "before", "has_test", "model_has", "package_has", "dependency_version",
      "wrapped_by:try", "control", "directive", "throws",
    ],
  },
  not_wrong_over: "all_shown",
};
const MANIFEST_TIER = readJson(join(here, HELD_OUT_TIER_FILES.primary)).tier;

// ---------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const git = (...a) => {
  const r = spawnSync("git", ["-C", root, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
  return r.status === 0 || r.status === 1 ? r.stdout : die(`git ${a.slice(0, 2).join(" ")} failed: ${r.stderr}`);
};
let apiCalls = 0;
// gh api GET; returns parsed JSON, or null on 404. Retries rate limits and transient errors.
function gh(path, fields = {}, extra = []) {
  const a = ["api", "-X", "GET", path, ...extra, ...Object.entries(fields).flatMap(([k, v]) => ["-f", `${k}=${v}`])];
  for (let attempt = 0; ; attempt++) {
    apiCalls++;
    const r = spawnSync("gh", a, { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status === 0) return parseJson(r.stdout, `gh ${path} output`);
    const err = `${r.stderr}${r.stdout}`;
    if (/HTTP 404|Not Found/.test(err)) return null;
    if (attempt >= 6) die(REDACT(`gh ${path} failed: ${err.slice(0, 300)}`)); // the query can name a repo
    sleep(/rate limit|HTTP 403|HTTP 429/i.test(err) ? 65000 : 5000 * (attempt + 1));
  }
}
const ghSearch = (q, page) => {
  sleep(2200); // search API: 30 requests per minute
  return gh("search/repositories", { q, per_page: 100, page, sort: "stars", order: "desc" });
};
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};

// ---------------------------------------------------------------------------------------------------------
// exclusions: everything the Drift repository (any branch), its PRs or its manifests mention
// ---------------------------------------------------------------------------------------------------------
const OWN_OUTPUTS = [...Object.values(SETS).map((s) => s.path), ...SEL.own, "eval/study/select-holdout.mjs"];
// Isolation of a blind dev pool: before `fetch` or `write` writes anything, every file it would write (the record,
// --record included, the manifests and the registry) must be named eval/<selection>* or live under
// eval/study/runs/<selection>*, the paths the brief's isolation rule forbids everyone but the pool's operator.
const isolatedPath = (p) => {
  const r = relative(root, resolve(root, p)).split("\\").join("/");
  return [`eval/${SELECTION}`, `eval/study/runs/${SELECTION}`].some((pre) => r.startsWith(pre) && /^[-_./]/.test(r.slice(pre.length)));
};
if (DEV_POOL && ["fetch", "write"].includes(mode))
  for (const p of [recordPath, selRegistryRel ?? "", ...Object.values(SETS).map((s) => s.path)])
    if (!isolatedPath(p)) die(`${mode}: the ${SELECTION} selection is a blind dev pool: every output must be named eval/${SELECTION}* or live under eval/study/runs/${SELECTION}*, and ${relative(root, resolve(root, p)) || "(no registry)"} is not`);
// The manifests of every blind dev pool (role "dev") of this script. They are not named eval/repos* or eval/holdout*,
// so they are listed here: each is a manifest source of every other selection's exclusions (repos, reserves and the
// names in replaced, burned and exposed), as a held-out manifest is. A selection's own manifests stay out (OWN_OUTPUTS).
// Replaying an earlier draw is unchanged by this: a pool's manifests exist only at refs after its own draw.
const POOL_MANIFESTS = Object.values(SELECTIONS)
  .filter((sel) => sel.role === "dev")
  .flatMap((sel) => Object.values(sel.sets(commonOf(sel.pushed_since))).map((x) => x.path));
// Sources of an exclusion that come from git alone (offline, so `verify` can replay them from the recorded refs).
const OFFLINE_SOURCE = (src) => src.startsWith("manifest ") || src.startsWith("hashed pool ") || src === "tracked files" || src === "commit messages";
// A pool committed only as hashes (eval/<pool>-hashes.json: { repos_sha256: [{ slug_sha256, name_sha256 }] }, lib.mjs
// poolHash): its repos are excluded by hash, from every later selection, without their names being read.
const HASHED_POOL_FILE = /^eval\/[^/]+-hashes\.json$/;
const isHashedPoolExcluded = (ex, slug) => Boolean(ex?.hashed?.[poolHash("slug", slug)] || ex?.hashed?.[poolHash("name", slug.split("/")[1])]);
const addTo = (m, k, src) => (m.get(k) ?? m.set(k, new Set()).get(k)).add(src);
const slugRe = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
const scanInto = (slugs, text, src) => {
  for (const m of text.matchAll(slugRe)) addTo(slugs, `${m[1]}/${m[2].replace(/\.git$/, "").replace(/\.+$/, "")}`.toLowerCase(), src);
};
const sortedObj = (m) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, [...v].sort()]));

// Parts 1-3 of the exclusions, from git objects only (no network): manifests, tracked files and commit
// messages at the given commits. Returns { slugs: Map<slug, Set<source>>, names: Map<name, Set<source>>,
// hashed: Map<poolHash, Set<source>> }. own: the selection's own outputs, never a source.
//
// SELECT_HOLDOUT_EXCLUSION_CACHE=DIR (the tests set it): the result is cached in DIR, keyed by the sorted commits and
// `own`. Git objects of a commit never change, so the replay of the same commits is the same; the cache only saves the
// `git grep` over every commit's tree, which made each `verify` take minutes.
function offlineExclusions(shas, own = OWN_OUTPUTS) {
  const cacheDir = process.env.SELECT_HOLDOUT_EXCLUSION_CACHE;
  const key = cacheDir ? createHash("sha256").update(JSON.stringify({ v: 1, shas: [...new Set(shas)].sort(), own: [...own].sort() })).digest("hex") : null;
  const cached = key ? join(cacheDir, `${key}.json`) : null;
  const toMaps = (o) => Object.fromEntries(["slugs", "names", "hashed"].map((k) => [k, new Map(Object.entries(o[k]).map(([x, v]) => [x, new Set(v)]))]));
  if (cached && existsSync(cached)) return toMaps(JSON.parse(readFileSync(cached, "utf8")));
  const result = offlineExclusionsUncached(shas, own);
  if (cached) {
    mkdirSync(cacheDir, { recursive: true });
    const tmp = `${cached}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(["slugs", "names", "hashed"].map((k) => [k, Object.fromEntries([...result[k]].map(([x, v]) => [x, [...v].sort()]))]))));
    renameSync(tmp, cached);
  }
  return result;
}
// heldOutHistoryProblems(root, ...), cached under SELECT_HOLDOUT_EXCLUSION_CACHE (the tests) by everything it reads:
// HEAD, the working tree's changes and untracked files (paths and contents), and the registry given. Without the
// variable it always runs.
function historyProblemsCached(reg, regRel) {
  const cacheDir = process.env.SELECT_HOLDOUT_EXCLUSION_CACHE;
  if (!cacheDir) return heldOutHistoryProblems(root, reg, regRel);
  const h = createHash("sha256");
  h.update(JSON.stringify({ v: 1, regRel, reg }));
  h.update(git("rev-parse", "HEAD"));
  h.update(git("status", "--porcelain=v1", "-z", "-uall"));
  h.update(git("diff", "HEAD", "--binary"));
  for (const f of git("ls-files", "-o", "--exclude-standard", "-z").split("\0").filter(Boolean).sort()) {
    h.update(f);
    try {
      h.update(readFileSync(join(root, f)));
    } catch {
      h.update("unreadable");
    }
  }
  const cached = join(cacheDir, `history-${h.digest("hex")}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const problems = heldOutHistoryProblems(root, reg, regRel);
  mkdirSync(cacheDir, { recursive: true });
  const tmp = `${cached}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(problems));
  renameSync(tmp, cached);
  return problems;
}
function offlineExclusionsUncached(shas, own) {
  const slugs = new Map(); // slug -> sources
  const names = new Map(); // repo name (lower-cased) -> sources
  const hashed = new Map(); // poolHash("slug"|"name", ...) -> sources, from hashed pool files
  const hashedFiles = new Map(); // `${path}\t${blob}` -> path
  // 1. dev and held-out manifests on every branch: every repo, reserve, replaced and exposed entry, by slug and name
  // Read once per distinct eval/ tree (one cat-file call for every ref's tree) and once per distinct
  // (path, blob): the sources are by path, so equal versions on many refs give the same entries.
  const manifestFiles = new Map(); // `${path}\t${blob}` -> path
  const evalTrees = new Set();
  const check = spawnSync("git", ["-C", root, "cat-file", "--batch-check"], { input: shas.map((s) => `${s}:eval\n`).join(""), encoding: "utf8", maxBuffer: 1 << 28 });
  if (check.status !== 0) die(`git cat-file --batch-check failed: ${check.stderr}`);
  for (const l of check.stdout.split("\n")) if (/^[0-9a-f]{40,64} tree /.test(l)) evalTrees.add(l.split(" ")[0]);
  for (const t of evalTrees)
    for (const l of git("ls-tree", "-r", t).split("\n").filter(Boolean)) {
      const tab = l.indexOf("\t");
      const f = `eval/${l.slice(tab + 1)}`; // a name git quotes (core.quotePath) matches the pattern neither way, as before
      if ((/^eval\/(repos[^/]*|holdout[^/]*)\.json$/.test(f) || POOL_MANIFESTS.includes(f)) && !own.includes(f)) manifestFiles.set(`${f}\t${l.slice(0, tab).split(" ")[2]}`, f);
      if (HASHED_POOL_FILE.test(f) && !own.includes(f)) hashedFiles.set(`${f}\t${l.slice(0, tab).split(" ")[2]}`, f);
    }
  for (const [k, f] of manifestFiles) {
    let m;
    try {
      m = JSON.parse(git("cat-file", "-p", k.split("\t")[1]));
    } catch {
      continue;
    }
    const src = `manifest ${f}`;
    for (const r of [...(m.repos ?? []), ...(m.reserves?.repos ?? [])]) {
      if (r.url) addTo(slugs, repoSlug(r.url), src);
      if (r.name) addTo(names, r.name.toLowerCase(), src);
      if (r.url) addTo(names, repoSlug(r.url).split("/")[1], src);
    }
    for (const e of [...(m.replaced ?? []), ...(m.exposed ?? []), ...(m.burned ?? [])])
      for (const n of [e.repo, e.reserve, e.name]) if (n) addTo(names, n.toLowerCase(), src);
  }
  // 1b. pools committed only as hashes: their slug and name hashes
  for (const [k, f] of hashedFiles) {
    let m;
    try {
      m = JSON.parse(git("cat-file", "-p", k.split("\t")[1]));
    } catch {
      continue;
    }
    for (const r of m.repos_sha256 ?? []) for (const h of [r.slug_sha256, r.name_sha256]) if (/^[0-9a-f]{64}$/.test(h ?? "")) addTo(hashed, h, `hashed pool ${f}`);
  }
  // 2. any github.com/<owner>/<repo> in any tracked file on any branch (this script's own outputs excluded)
  const grep = spawnSync("git", ["-C", root, "grep", "-I", "-o", "-h", "-E", "github\\.com[/:][A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", ...shas, "--", ".", ...own.map((p) => `:(exclude)${p}`)], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout;
  scanInto(slugs, grep, "tracked files");
  // 3. commit messages on every branch
  scanInto(slugs, git("log", "--format=%B", ...shas), "commit messages");
  return { slugs, names, hashed };
}

function exclusions(own = OWN_OUTPUTS) {
  const refs = Object.fromEntries(
    git("for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/driftv22/", "refs/heads/main")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ")),
  );
  const shas = [...new Set(Object.values(refs))];
  const { slugs, names, hashed } = offlineExclusions(shas, own);
  // 4. PR and issue text of the Drift repository (bodies, comments, review comments)
  const repo = "GeoffreyFernald/Driftv22";
  const pages = (path) => {
    const out = [];
    for (let page = 1; page < 50; page++) {
      const r = gh(path, { per_page: 100, page, state: "all" });
      if (!r?.length) break;
      out.push(...r);
      if (r.length < 100) break;
    }
    return out;
  };
  for (const it of pages(`repos/${repo}/issues`)) scanInto(slugs, `${it.title}\n${it.body ?? ""}`, "PR/issue bodies");
  for (const c of pages(`repos/${repo}/issues/comments`)) scanInto(slugs, c.body ?? "", "PR/issue comments");
  for (const c of pages(`repos/${repo}/pulls/comments`)) scanInto(slugs, c.body ?? "", "PR review comments");
  const owners = ["geoffreyfernald"]; // the Drift owner's own repos and forks
  return { refs, owners, slugs: sortedObj(slugs), names: sortedObj(names), ...(hashed.size ? { hashed: sortedObj(hashed) } : {}) };
}

// ---------------------------------------------------------------------------------------------------------
// search: enumerate every result of each query, splitting the star range until a slice has <= 1000 results
// ---------------------------------------------------------------------------------------------------------
function enumerate(query) {
  const leaves = [];
  const items = new Map();
  const stack = [STARS];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const q = `${query} stars:${lo}..${hi}`;
    const first = ghSearch(q, 1);
    if (first.total_count > 1000 && hi > lo) {
      const mid = Math.floor((lo + hi) / 2);
      stack.push([mid + 1, hi], [lo, mid]);
      continue;
    }
    let got = first.items;
    for (let page = 2; page <= Math.ceil(Math.min(first.total_count, 1000) / 100); page++) got = got.concat(ghSearch(q, page).items);
    for (const it of got) items.set(it.full_name.toLowerCase(), it);
    leaves.push({ q, total_count: first.total_count, fetched: got.length, incomplete_results: !!first.incomplete_results });
    console.error(`  ${q}: ${first.total_count} (fetched ${got.length})`);
  }
  return { leaves, items: [...items.values()] };
}

function eligibility(it, ex) {
  const slug = it.full_name.toLowerCase();
  const [owner, name] = slug.split("/");
  if (it.archived) return "archived";
  if (it.fork) return "fork";
  if (it.is_template) return "template repository";
  if (!OSI.includes(it.license?.spdx_id)) return "no OSI licence";
  if (ex.slugs[slug] || ex.owners.includes(owner)) return "in the Drift repository (dev/secondary/exposed or mentioned)";
  if (ex.names[name]) return "same name as a dev/secondary/exposed repo";
  if (isHashedPoolExcluded(ex, slug)) return "in a pool committed as hashes";
  if (NON_APP_NAME.test(name)) return "non-application (name)";
  if ((it.topics ?? []).some((t) => NON_APP_TOPICS.has(t))) return "non-application (topic)";
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// classification: dependency manifests only, through GitHub code search restricted to manifest file names
// ---------------------------------------------------------------------------------------------------------
// This session's GitHub gateway serves the search endpoints but not the contents API of repositories that are
// not attached to it, so manifests are not downloaded. Instead, code search is asked, for a batch of candidates
// (repo:A repo:B ... are OR-ed), which of their DEPENDENCY MANIFESTS (filename: qualifiers below) contain a
// framework's package name. Only the repository, the manifest's path (to drop docs/examples members) and, for
// `next`, the matched manifest fragment are used; nothing else is requested, and nothing is recorded but the
// bucket. Code search indexes the default branch, so the framework is detected at the default branch, and the
// sha is pinned from `git ls-remote` of that branch's HEAD at the same time.
const MANIFEST_FILES = {
  ts: ["package.json"],
  py: ["pyproject.toml", "requirements", "setup.cfg", "Pipfile"],
};
const MANIFEST_PATH = {
  ts: (p) => /(^|\/)package\.json$/.test(p),
  py: (p) => /(^|\/)(pyproject\.toml|setup\.cfg|Pipfile|requirements[^/]*\.txt)$/i.test(p),
};
// The search term for each framework package, and an optional check of the matched manifest fragment for
// terms the tokenizer makes ambiguous (`next` is also a token of next-auth, ./next.mjs, ...).
const TERMS = {
  "@nestjs/core": { q: '"@nestjs/core"' },
  next: { q: "next", fragment: /"next"\s*:|\bnext\s+(dev|build|start|lint|export)\b/ },
  express: { q: "express" },
  fastify: { q: "fastify" },
  hono: { q: "hono" },
  "react-dom": { q: '"react-dom"' },
  django: { q: "django" },
  djangorestframework: { q: "djangorestframework" },
  fastapi: { q: "fastapi" },
  flask: { q: "flask" },
};
const BATCH = 8;
let codeCalls = 0;
const codeSearch = (q, page, textMatch) => {
  sleep(6500); // code search: 10 requests per minute
  codeCalls++;
  return gh("search/code", { q, per_page: 100, page }, textMatch ? ["-H", "Accept: application/vnd.github.text-match+json"] : []);
};

// Which of `repos` (full names) have a qualifying manifest matching `term` (null: any manifest at all)?
function manifestHits(key, repos, term) {
  const t = term ? TERMS[term] : null;
  const ok = (it) =>
    MANIFEST_PATH[key](it.path) &&
    !NON_PRODUCT_DIR.test(it.path.split("/").slice(0, -1).join("/")) &&
    !/(^|\/)node_modules\//.test(it.path) &&
    (!t?.fragment || (it.text_matches ?? []).some((m) => t.fragment.test(m.fragment ?? "")));
  const hit = new Set();
  const query = (rs, pages) => {
    const q = `${t ? `${t.q} ` : ""}${MANIFEST_FILES[key].map((f) => `filename:${f}`).join(" ")} ${rs.map((r) => `repo:${r}`).join(" ")}`;
    let total = 0;
    for (let page = 1; page <= pages; page++) {
      const r = codeSearch(q, page, !!t?.fragment);
      total = r.total_count;
      for (const it of r.items ?? []) if (ok(it)) hit.add(it.repository.full_name.toLowerCase());
      if (page * 100 >= Math.min(total, 1000) || rs.every((x) => hit.has(x.toLowerCase()))) break;
    }
    return total;
  };
  const total = query(repos, 1);
  // More than one page of matches: ask again, one repo at a time, for those without a qualifying match yet.
  if (total > 100) for (const r of repos) if (!hit.has(r.toLowerCase())) query([r], 3);
  return hit;
}

// Classify a batch of candidates: { full_name_lower: { bucket } | { bucket: null, skip } }
function classifyBatch(key, set, repos) {
  const out = {};
  const has = manifestHits(key, repos, null);
  let open = repos.filter((r) => has.has(r.toLowerCase()));
  for (const r of repos) if (!has.has(r.toLowerCase())) out[r.toLowerCase()] = { bucket: null, skip: key === "ts" ? "no package.json found" : "no Python dependency manifest found" };
  for (const b of set.buckets) {
    if (!b.deps) continue;
    for (const d of b.deps) {
      if (!open.length) break;
      const hit = manifestHits(key, open, d);
      for (const r of open) if (hit.has(r.toLowerCase())) out[r.toLowerCase()] = { bucket: b.id };
      open = open.filter((r) => !out[r.toLowerCase()]);
    }
  }
  const other = set.buckets.find((b) => !b.deps).id;
  for (const r of open) out[r.toLowerCase()] = { bucket: other };
  return out;
}

function lsRemote(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = spawnSync("git", ["ls-remote", url, "HEAD"], { encoding: "utf8", timeout: 90000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const sha = r.stdout?.match(/^([0-9a-f]{40})\tHEAD$/m)?.[1];
    if (sha) return sha;
    sleep(3000);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// the draw (shared by fetch and verify)
// ---------------------------------------------------------------------------------------------------------
// walkStep(slug, i, order) -> { sha, bucket, skip } (fetch: network; verify: from the record)
function draw(set, pool, walkStep) {
  const order = shuffle([...pool].sort(), `${SEED}:${set.set_id}`);
  const need = Object.fromEntries(set.buckets.map((b) => [b.id, b.primaries + set.reserve_order.filter((x) => x === b.id).length]));
  const got = Object.fromEntries(set.buckets.map((b) => [b.id, []]));
  const walked = [];
  const full = () => set.buckets.every((b) => got[b.id].length >= need[b.id]);
  for (const [i, slug] of order.entries()) {
    if (full()) break;
    const step = walkStep(slug, i, order);
    walked.push({ repo: slug, ...step });
    if (step.bucket && got[step.bucket].length < need[step.bucket]) got[step.bucket].push(slug);
  }
  // Primaries: the first `primaries` of each bucket; a bucket the pool could not fill hands its open places to
  // the other buckets (in bucket order, at most MAX_PER_BUCKET each), from candidates already drawn for them.
  const take = Object.fromEntries(set.buckets.map((b) => [b.id, Math.min(b.primaries, got[b.id].length)]));
  let open = set.buckets.reduce((s, b) => s + b.primaries, 0) - Object.values(take).reduce((a, b) => a + b, 0);
  const shortfall = open > 0;
  for (const b of set.buckets) {
    while (open > 0 && take[b.id] < MAX_PER_BUCKET && take[b.id] < got[b.id].length) {
      take[b.id]++;
      open--;
    }
  }
  const primaries = set.buckets.flatMap((b) => got[b.id].slice(0, take[b.id]).map((slug) => ({ slug, bucket: b.id })));
  const left = Object.fromEntries(set.buckets.map((b) => [b.id, got[b.id].slice(take[b.id])]));
  const reserves = [];
  for (const id of set.reserve_order) if (left[id].length) reserves.push({ slug: left[id].shift(), bucket: id });
  return { walked, primaries, reserves, shortfall, unfilled_primaries: open };
}

// ---------------------------------------------------------------------------------------------------------
// No message names a held-out repo. Product engineers can read CI logs, so every repo of a registered held-out
// manifest (its name, owner/repo, URL and pinned sha, and every name in its replaced, burned and exposed lists)
// is printed as `<set_id>:repos[i]` / `<set_id>:reserves[i]`, or `<set_id>:name#<hash>` for a list name that is
// neither (a misspelling, say). manifestRoot: where the registered manifests are read (--manifest-root, fixtures).
// recs: [{ sets, rec }], the selection records to read (every selection's committed record, so a record drawn but not
// yet written into manifests is redacted too).
function heldOutRedactor(manifestRoots, recs = []) {
  const shaRefs = new Map(); // full pinned sha (lower case) -> ref; any 7+ hex prefix of one is redacted too
  const reg = readJson(join(here, "holdout-manifests.json"));
  const pairs = new Map(); // token (lower case) -> ref
  const add = (tok, ref) => {
    const t = String(tok ?? "").toLowerCase();
    if (t.length >= 3 && !pairs.has(t)) pairs.set(t, ref);
    if (/^[0-9a-f]{40}$/.test(t) && !shaRefs.has(t)) shaRefs.set(t, ref);
  };
  // Every registered held-out manifest, and every selection's own manifests (a blind dev pool is not registered there).
  const manifestPaths = [...new Set([...Object.keys(reg.manifests), ...Object.values(SELECTIONS).flatMap((sel) => Object.values(sel.sets(commonOf(sel.pushed_since))).map((x) => x.path))])].sort();
  for (const p of manifestRoots.flatMap((mr) => manifestPaths.map((q) => [mr, q]))) {
    const f = join(p[0], p[1]);
    if (!existsSync(f)) continue;
    const m = readJson(f);
    const sid = m.set_id ?? p[1];
    for (const [list, rs] of [["repos", m.repos ?? []], ["reserves", m.reserves?.repos ?? []]])
      rs.forEach((r, i) => {
        const ref = `${sid}:${list}[${i}]`;
        for (const t of [r.url, repoSlug(r.url ?? ""), r.sha, r.name, repoSlug(r.url ?? "").split("/")[1]]) add(t, ref);
      });
    for (const e of [...(m.replaced ?? []), ...(m.burned ?? []), ...(m.exposed ?? [])])
      for (const n of [e.repo, e.reserve, e.name]) if (n) add(n, `${sid}:name#${createHash("sha256").update(String(n).toLowerCase()).digest("hex").slice(0, 8)}`);
  }
  // each selection record's primaries and reserves are its sets as drawn (pins included)
  for (const { sets, rec } of recs)
  for (const [key, st] of Object.entries(rec?.sets ?? {}))
    for (const [list, rs] of [["primaries", st.primaries ?? []], ["reserves", st.reserves ?? []]])
      rs.forEach((r, i) => {
        const ref = `${sets[key]?.set_id ?? key}:record.${list}[${i}]`;
        for (const t of [r.repo, r.sha, String(r.repo ?? "").split("/")[1]]) add(t, ref);
      });
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const toks = [...pairs.keys()].sort((a, b) => b.length - a.length);
  const re = toks.length ? new RegExp(`(?<![A-Za-z0-9_.-])(${toks.map(esc).join("|")})(?![A-Za-z0-9_-])`, "gi") : null;
  const shas = [...shaRefs.keys()];
  const prefix = (m) => {
    const h = m.toLowerCase();
    const full = shas.find((x) => x.startsWith(h));
    return full ? shaRefs.get(full) : m;
  };
  const redact = (text) => {
    const t = String(text).replace(/(?<![0-9A-Za-z])[0-9a-fA-F]{7,40}(?![0-9A-Za-z])/g, prefix);
    return re ? t.replace(re, (m) => pairs.get(m.toLowerCase()) ?? m) : t;
  };
  // is this owner/repo, URL or name one of a held-out manifest's repos (occupant, reserve, replaced, burned, exposed)?
  redact.isHeld = (x) => {
    const v = String(x ?? "").toLowerCase();
    return [v, repoSlug(v), repoSlug(v).split("/")[1]].some((k) => k && pairs.has(k));
  };
  return redact;
}
// Every message that can carry repo text goes through this (gh failures included). It reads every selection's
// record: this one's (or --record), and the others' committed ones.
const allRecords = (rec) => [
  { sets: SETS, rec },
  ...Object.entries(SELECTIONS)
    .filter(([id, sel]) => id !== SELECTION && existsSync(join(root, sel.record)))
    .map(([, sel]) => ({ sets: sel.sets(commonOf(sel.pushed_since)), rec: readJson(join(root, sel.record)) })),
];
const REDACT = heldOutRedactor([root], allRecords(existsSync(recordPath) ? readJson(recordPath) : null));

// redact: filter stdin through the redactor (used by the tests; reads only this checkout's manifests and record).
if (mode === "redact") {
  process.stdout.write(REDACT(readFileSync(0, "utf8")));
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------
// probe: test the exclusions and the classifier on repos that are already dev or secondary repos (never on a
// candidate: any repo the Drift repository's manifests do not list is refused).
if (mode === "probe") {
  const [key, ...slugs] = args._.slice(1);
  if (!SETS[key] || !slugs.length) die("usage: select-holdout.mjs probe ts|py OWNER/REPO...");
  const redact = REDACT;
  // Never a held-out repo: probe runs code search and ls-remote on what it is given. Refused before any
  // network call, by every registered manifest's repos, reserves and list names (primary sets included).
  for (const slug of slugs) if (redact.isHeld(slug)) die(redact(`${slug} is in a held-out manifest: probe refuses held-out repos`));
  const ex = exclusions();
  console.log(`exclusions: ${Object.keys(ex.slugs).length} slugs, ${Object.keys(ex.names).length} names; refs ${JSON.stringify(ex.refs)}`);
  for (const slug of slugs) {
    const src = ex.slugs[slug.toLowerCase()] ?? [];
    if (!src.some((x) => x.startsWith("manifest "))) die(redact(`${slug} is not a dev or secondary repo: probe refuses candidates`));
  }
  const c = classifyBatch(key, SETS[key], slugs);
  for (const slug of slugs) console.log(redact(`${slug} @ ${lsRemote(`https://github.com/${slug}`)?.slice(0, 12)}: ${JSON.stringify(c[slug.toLowerCase()])}`));
  console.log(`${apiCalls} API calls (${codeCalls} code search)`);
  process.exit(0);
}

// spec: the selection's pre-registered specification as JSON (offline; names no repo). The tests compare selections.
if (mode === "spec") {
  console.log(JSON.stringify({ selection: SELECTION, role: ROLE, record: relative(root, recordPath), registry: selRegistryRel, extension: extPathOf(), own_outputs: OWN_OUTPUTS, seed: SEED, spec: specOf() }, null, 2));
  process.exit(0);
}

// exclusion-hashes: the exclusions for a selection made by another script (select-apps.mjs), hashed so that its operator
// never reads a held-out or blind pool name. Every source of `fetch`'s exclusions, with that selection's own outputs
// (--own) left out instead of this selection's. Output: { refs, owners, slugs: {poolHash("slug"): sources},
// names: {poolHash("name"): sources}, hashed: {...} } with sources as `fetch` names them (paths, not repos).
if (mode === "exclusion-hashes") {
  const own = [...String(args.own ?? "").split(",").filter(Boolean), "eval/study/select-holdout.mjs"];
  if (!args.out) die("exclusion-hashes: --out FILE is required");
  if (own.some((p) => Object.values(SELECTIONS).some((sel) => Object.values(sel.sets(commonOf(sel.pushed_since))).some((x) => x.path === p) || sel.record === p || sel.registry === p))) die("exclusion-hashes: --own may not name a held-out or blind dev pool file of this script");
  let ex;
  if (args.at) {
    const shas = String(args.at).split(",").filter(Boolean).map((c) => git("rev-parse", "--verify", `${c}^{commit}`).trim());
    const off = offlineExclusions(shas, own);
    ex = { refs: Object.fromEntries(shas.map((c) => [c, c])), owners: ["geoffreyfernald"], slugs: sortedObj(off.slugs), names: sortedObj(off.names), hashed: sortedObj(off.hashed), offline: true };
  } else ex = { ...exclusions(own), offline: false };
  const hashKeys = (o, kind) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [poolHash(kind, k), v]).sort(([a], [b]) => (a < b ? -1 : 1)));
  // owners_hashed (select-apps13.mjs, by organisation): poolHash("owner") of the owner of every repo a manifest names,
  // and the owner_sha256 of every hashed pool row that carries one. Other mentions (tracked files, commit messages, PR
  // text) name libraries and tools as well, so their owners are not excluded.
  const ownersHashed = new Map();
  for (const [slug, srcs] of Object.entries(ex.slugs ?? {})) for (const src of srcs) if (src.startsWith("manifest ")) addTo(ownersHashed, poolHash("owner", slug.split("/")[0]), src);
  const atShas = [...new Set(Object.values(ex.refs ?? {}))];
  const hashedPoolBlobs = new Map();
  for (const c of atShas)
    for (const l of git("ls-tree", c, "eval/").split("\n").filter(Boolean)) {
      const f = l.slice(l.indexOf("\t") + 1);
      if (HASHED_POOL_FILE.test(f) && !own.includes(f)) hashedPoolBlobs.set(l.slice(0, l.indexOf("\t")).split(" ")[2], f);
    }
  for (const [blob, f] of hashedPoolBlobs) {
    let m;
    try {
      m = JSON.parse(git("cat-file", "-p", blob));
    } catch {
      continue;
    }
    for (const r of m.repos_sha256 ?? []) if (/^[0-9a-f]{64}$/.test(r.owner_sha256 ?? "")) addTo(ownersHashed, r.owner_sha256, `hashed pool ${f}`);
  }
  const out = { own, refs: ex.refs, owners: ex.owners, offline: ex.offline, slugs: hashKeys(ex.slugs, "slug"), names: hashKeys(ex.names, "name"), hashed: ex.hashed ?? {}, owners_hashed: sortedObj(ownersHashed) };
  writeJson(resolve(args.out), out);
  console.log(`exclusion-hashes: ${Object.keys(out.slugs).length} slugs, ${Object.keys(out.names).length} names, ${Object.keys(out.hashed).length} hashed-pool entries, ${Object.keys(out.owners_hashed).length} owners from ${new Set(Object.values(ex.refs)).size} commits${ex.offline ? " (offline)" : ""}`);
  process.exit(0);
}

if (mode === "fetch") {
  if (existsSync(recordPath) && !args.force) die(`${relative(root, recordPath)} exists; a selection is drawn once (pass --force only to redo a failed fetch before anything was written)`);
  const retrieved_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  console.error("exclusions...");
  const ex = exclusions();
  const record = {
    "//": SEL.record_note,
    ...(SELECTION === "primary" ? {} : { selection: SELECTION }),
    ...(DEV_POOL ? { role: ROLE } : {}),
    script: "eval/study/select-holdout.mjs",
    seed: SEED,
    retrieved_at,
    spec: { ...specOf(), tier: RULE5_TIER },
    exclusions: ex,
    sets: {},
  };
  const meta = new Map();
  for (const [key, set] of Object.entries(SETS)) {
    console.error(`${key}: search`);
    const leaves = [];
    const all = new Map();
    for (const q of set.queries) {
      const r = enumerate(q);
      leaves.push(...r.leaves);
      for (const it of r.items) all.set(it.full_name.toLowerCase(), it);
    }
    const excluded = {};
    const pool = [];
    for (const [slug, it] of all) {
      const why = eligibility(it, ex);
      if (why) excluded[why] = (excluded[why] ?? 0) + 1;
      else {
        pool.push(slug);
        meta.set(slug, it);
      }
    }
    const excluded_drift = [...all.keys()].filter((s) => /Drift repository|same name/.test(eligibility(all.get(s), ex) ?? "")).sort();
    console.error(`${key}: ${all.size} unique results, ${pool.length} eligible; walking...`);
    // Candidates are classified in batches of BATCH, in walk order; a candidate classified ahead of the point
    // where the draw stops is simply not walked (and not recorded).
    const cls = {};
    const res = draw(set, pool, (slug, i, order) => {
      if (!cls[slug]) {
        const batch = order.slice(i, i + BATCH);
        Object.assign(cls, classifyBatch(key, set, batch.map((s) => meta.get(s).full_name)));
        console.error(`  walked ${i + batch.length}: ${JSON.stringify(Object.values(cls).reduce((a, c) => ((a[c.bucket ?? "skip"] = (a[c.bucket ?? "skip"] ?? 0) + 1), a), {}))}`);
      }
      const c = cls[slug];
      if (!c.bucket) return { sha: null, bucket: null, skip: c.skip };
      const sha = lsRemote(meta.get(slug).html_url);
      if (!sha) return { sha: null, bucket: null, skip: "git ls-remote failed" };
      return { sha, bucket: c.bucket };
    });
    const bucketsWalked = {};
    for (const w of res.walked) bucketsWalked[w.bucket ?? `skipped: ${w.skip}`] = (bucketsWalked[w.bucket ?? `skipped: ${w.skip}`] ?? 0) + 1;
    const entry = (p) => {
      const it = meta.get(p.slug);
      return { repo: p.slug, url: it.html_url, sha: res.walked.find((w) => w.repo === p.slug).sha, language: it.language, framework_bucket: p.bucket, size_kb: it.size, stars: it.stargazers_count, pushed_at: it.pushed_at };
    };
    record.sets[key] = {
      set_id: set.set_id,
      queries: leaves,
      counts: { results: all.size, excluded, eligible: pool.length, walked: res.walked.length, walked_by_bucket: bucketsWalked },
      excluded_by_drift_repo: excluded_drift,
      pool: [...pool].sort(),
      walked: res.walked,
      primaries: res.primaries.map(entry),
      reserves: res.reserves.map(entry),
      shortfall: res.shortfall,
      unfilled_primaries: res.unfilled_primaries,
    };
    const bc = {};
    for (const p of res.primaries) bc[p.bucket] = (bc[p.bucket] ?? 0) + 1;
    console.error(`${key}: ${res.primaries.length} primaries ${JSON.stringify(bc)}, ${res.reserves.length} reserves; ${JSON.stringify(excluded)}`);
  }
  record.api_calls = { total: apiCalls, code_search: codeCalls };
  writeJson(recordPath, record);
  console.error(`wrote ${relative(root, recordPath)} (${apiCalls} API calls)`);
  process.exit(0);
}

const record = readJson(recordPath);
const recordSha = createHash("sha256").update(readFileSync(recordPath)).digest("hex");

// Manifest names: the repo name, lower-cased; owner-repo when two selected repos (or a registered held-out
// manifest's repo) share a name.
function nameRepos(rec) {
  const all = Object.values(rec.sets).flatMap((s) => [...s.primaries, ...s.reserves]);
  const count = new Map();
  for (const r of all) count.set(r.repo.split("/")[1], (count.get(r.repo.split("/")[1]) ?? 0) + 1);
  const taken = new Set(Object.keys(rec.exclusions.names));
  return (r) => {
    const n = r.repo.split("/")[1];
    return count.get(n) > 1 || taken.has(n) ? r.repo.replace("/", "-") : n;
  };
}

// ---------------------------------------------------------------------------------------------------------
// Decision D9 (lead, 2026-11-07, before any held-out census, blind to outcomes): reserve exhaustion at runbook
// step 4. The same draw continues: the same pool, seed and walk order, the same classifier and pins, with the
// set's reserve_order continued cyclically (place 6 + i of the TypeScript/JavaScript set comes from bucket
// reserve_order[i mod 6], and so on). Candidates the original walk visited keep their recorded sha and bucket;
// one the original draw did not select, and that the Drift repository now mentions (the exclusions recomputed
// at the extension, exactly as `fetch` computes them), is skipped, as is any newly walked candidate it
// mentions (rule 6: a held-out repo never overlaps a dev repo). The extension record holds the steps walked
// beyond the original walk, the re-skipped original steps, the exclusions and the new reserves' metadata.
// ---------------------------------------------------------------------------------------------------------
const extPath = SEL.extension ? resolve(root, args.extension ?? SEL.extension) : null;
const D9_SKIP = "excluded at the D9 extension (the Drift repository mentions it now)";
const extendedSet = (set, add) => ({ ...set, reserve_order: [...set.reserve_order, ...Array.from({ length: add }, (_, i) => set.reserve_order[i % set.reserve_order.length])] });
const excludedBy = (ex) => (slug) => {
  const [owner, name] = slug.split("/");
  return Boolean(ex?.slugs?.[slug] || ex?.owners?.includes(owner) || ex?.names?.[name]);
};
// The extended draw of set `key`. stepNew(slug, i, order) answers walk steps beyond the original walk.
function extendedDraw(key, rec, add, ex, stepNew) {
  const s = rec.sets[key];
  const selected = new Set([...s.primaries, ...s.reserves].map((p) => p.repo));
  const excluded = excludedBy(ex);
  const reskipped = [];
  const res = draw(extendedSet(SETS[key], add), s.pool, (slug, i, order) => {
    if (i < s.walked.length) {
      const w = s.walked[i];
      if (w.repo !== slug) return { sha: null, bucket: null, skip: `walk order differs from the record at step ${i}` };
      if (w.bucket && !selected.has(slug) && excluded(slug)) {
        reskipped.push(slug);
        return { sha: null, bucket: null, skip: D9_SKIP };
      }
      return { sha: w.sha, bucket: w.bucket, ...(w.skip ? { skip: w.skip } : {}) };
    }
    if (excluded(slug)) return { sha: null, bucket: null, skip: D9_SKIP };
    return stepNew(slug, i, order);
  });
  return { ...res, reskipped, walked_new: res.walked.slice(s.walked.length) };
}
let EXT = extPath && existsSync(extPath) ? readJson(extPath) : null;
let extSha = EXT ? createHash("sha256").update(readFileSync(extPath)).digest("hex") : null;
// Manifest names of the extension's reserves: the repo name, or owner-repo when it is taken by any selected repo
// of the record, another extension reserve, or an excluded name.
function extensionRows(key, rec, ext) {
  const e = ext?.sets?.[key];
  if (!e) return [];
  const nm = nameRepos(rec);
  const taken = new Set([...Object.values(rec.sets).flatMap((x) => [...x.primaries, ...x.reserves].map(nm)), ...Object.keys(rec.exclusions.names)]);
  const all = Object.values(ext.sets).flatMap((x) => x.reserves);
  const count = new Map();
  for (const r of all) count.set(r.repo.split("/")[1], (count.get(r.repo.split("/")[1]) ?? 0) + 1);
  return e.reserves.map((r) => {
    const n = r.repo.split("/")[1];
    return { name: count.get(n) > 1 || taken.has(n) ? r.repo.replace("/", "-") : n, url: r.url, sha: r.sha, language: r.language, framework_bucket: r.framework_bucket, size_kb: r.size_kb, stars: r.stars, pushed_at: r.pushed_at };
  });
}

function manifestOf(key, rec, frozen_at) {
  const set = SETS[key];
  const s = rec.sets[key];
  const nm = nameRepos(rec);
  const row = (r) => ({ name: nm(r), url: r.url, sha: r.sha, language: r.language, framework_bucket: r.framework_bucket, size_kb: r.size_kb, stars: r.stars, pushed_at: r.pushed_at });
  const counts = Object.fromEntries(set.buckets.map((b) => [b.id, s.primaries.filter((p) => p.framework_bucket === b.id).length]));
  return {
    "//": SEL.manifest_note,
    set_id: set.set_id,
    role: ROLE,
    decision: SEL.decision,
    holdout: !DEV_POOL,
    status: "frozen",
    frozen_on: DATE,
    frozen_at,
    language: set.language,
    tier: MANIFEST_TIER,
    max: 15,
    "//max_pool": "Same as the secondary sets: max 15 (census --max, proposals shown) and pool 200 (recall pool).",
    pool: 200,
    provenance: `Metadata only. Candidates: GitHub repository search (queries in \`selection.record\`), filtered by OSI licence, not archived, not a fork or template, and ${SEL.excludes} and obvious non-applications by name or topic. framework_bucket from the repo's dependency manifests only (package.json; pyproject.toml, requirements*.txt, setup.cfg, Pipfile), queried through GitHub code search restricted to those file names on the default branch; nothing else. sha = default-branch HEAD from git ls-remote. size_kb, stars, pushed_at from search metadata at retrieval. No notes about the code exist: nobody read it.`,
    selection: {
      script: "eval/study/select-holdout.mjs",
      ...(SELECTION === "primary" ? {} : { selection: SELECTION }),
      record: relative(root, recordPath),
      record_sha256: recordSha,
      ...(selRegistryRel ? { registry: selRegistryRel } : {}),
      seed: rec.seed,
      retrieved_at: rec.retrieved_at,
      buckets: counts,
    },
    "//lists": "Append-only lists outside the frozen core. replaced: [{date, repo, reserve, reason}], the i-th swap uses the i-th reserve, only for a failed technical check (clone fails, `drift scan` errors, fewer than 200 parseable files) or (Python) overlap with the dev set. burned: [{date, name, reason}]. exposed: [{name, where}], repos whose conventions were named where product engineers can read.",
    replaced: [],
    burned: [],
    exposed: [],
    repos: s.primaries.map(row),
    reserves: {
      "//": EXT?.sets?.[key]
        ? `Pre-registered replacements, used in this order only (rule 1). Reserve i comes from bucket spec.sets.<set>.reserve_order[i] of the selection record; reserves ${s.reserves.length} and later were drawn under decision D9 (selection.extension), from the same walk with reserve_order continued cyclically.`
        : "Pre-registered replacements, used in this order only (rule 1). Reserve i comes from bucket spec.sets.<set>.reserve_order[i] of the selection record.",
      repos: [...s.reserves.map(row), ...extensionRows(key, rec, EXT)],
    },
  };
}
// The selection block of a manifest, with the D9 extension when there is one.
function withExtension(key, m) {
  const e = EXT?.sets?.[key];
  if (!e) return m;
  return { ...m, selection: { ...m.selection, extension: { decision: "D9", record: relative(root, extPath), record_sha256: extSha, places_added: e.add, reserve_order_added: extendedSet(SETS[key], e.add).reserve_order.slice(SETS[key].reserve_order.length) } } };
}

if (mode === "extend") {
  // Decision D9. Network: GitHub search (code search of dependency manifests, repository metadata of the new
  // reserves) and git ls-remote, exactly as `fetch`; nothing of a candidate's code is read. Prints counts only.
  const key = args.set;
  const set = SETS[key];
  const add = Number(args.add);
  if (!set || !Number.isInteger(add) || add < 1) die("usage: select-holdout.mjs extend --set ts|py --add N");
  const ext = EXT ?? {
    "//": "Decision D9 (lead, 2026-11-07, before any held-out census, blind to outcomes): further reserves of the primary held-out sets after reserve exhaustion at runbook step 4, drawn by continuing the selection's own walk (same pool, seed, walk order, classifier) with reserve_order continued cyclically. Metadata only. `select-holdout.mjs verify` replays it.",
    decision: "D9",
    script: "eval/study/select-holdout.mjs",
    base_record: relative(root, recordPath),
    base_record_sha256: recordSha,
    seed: SEED,
    sets: {},
  };
  if (ext.base_record_sha256 !== recordSha) die("the extension record was drawn from another selection record");
  const prevE = ext.sets[key];
  if (prevE && add <= prevE.add) die(`${key} is already extended by ${prevE.add} places; --add is the total, so pass more than that`);
  if (!ext.exclusions) {
    console.error("exclusions (as `fetch` computes them, at the current refs)...");
    ext.exclusions = exclusions();
    ext.exclusions_retrieved_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  }
  const s = record.sets[key];
  const excluded = excludedBy(ext.exclusions);
  const known = new Map((prevE?.walked ?? []).map((w) => [w.repo, w]));
  const cls = {};
  let fresh = 0;
  const xr = extendedDraw(key, record, add, ext.exclusions, (slug, i, order) => {
    const k = known.get(slug);
    if (k) return { sha: k.sha, bucket: k.bucket, ...(k.skip ? { skip: k.skip } : {}) };
    if (!cls[slug]) {
      const batch = order.slice(i, i + BATCH).filter((x) => x === slug || (!excluded(x) && !known.has(x) && !cls[x]));
      Object.assign(cls, classifyBatch(key, set, batch));
      console.error(`  ${key}: ${i + 1} steps walked, ${(fresh += batch.length)} newly classified`);
    }
    const c = cls[slug];
    if (!c?.bucket) return { sha: null, bucket: null, skip: c?.skip ?? "not classified" };
    const sha = lsRemote(`https://github.com/${slug}`);
    if (!sha) return { sha: null, bucket: null, skip: "git ls-remote failed" };
    return { sha, bucket: c.bucket };
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(xr.primaries.map((p) => p.slug), s.primaries.map((p) => p.repo))) die(`${key}: the extended draw changes the primaries (a harness error)`);
  if (!same(xr.reserves.slice(0, s.reserves.length).map((p) => p.slug), s.reserves.map((p) => p.repo))) die(`${key}: the extended draw changes the earlier reserves (a harness error)`);
  const added = xr.reserves.slice(s.reserves.length);
  if (prevE && !same(added.slice(0, prevE.reserves.length).map((p) => p.slug), prevE.reserves.map((p) => p.repo))) die(`${key}: the larger extension changes the earlier D9 reserves (a harness error)`);
  const shaOf = new Map([...s.walked, ...xr.walked_new].filter((w) => w.sha).map((w) => [w.repo, w.sha]));
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const reserves = added.map((p) => {
    const old = prevE?.reserves.find((r) => r.repo === p.slug);
    if (old) return old;
    const it = ghSearch(`repo:${p.slug}`, 1)?.items?.find((x) => x.full_name.toLowerCase() === p.slug);
    if (!it) die(REDACT(`${key}: no search metadata for ${p.slug}`));
    return { repo: p.slug, url: it.html_url, sha: shaOf.get(p.slug), language: it.language, framework_bucket: p.bucket, size_kb: it.size, stars: it.stargazers_count, pushed_at: it.pushed_at, metadata_retrieved_at: now };
  });
  ext.sets[key] = { add, walked_from: s.walked.length, walked: xr.walked_new, reskipped: xr.reskipped, reserves, exhausted: xr.reserves.length < extendedSet(set, add).reserve_order.length, retrieved_at: now };
  writeJson(extPath, ext);
  EXT = readJson(extPath);
  extSha = createHash("sha256").update(readFileSync(extPath)).digest("hex");
  // The manifest: only reserves (core) and selection (not core) change. Then the registry: the new core, and a
  // D9 amendment from every earlier frozen core of the set (no chaining, lib.mjs amendmentAllows).
  const mPath = join(root, set.path);
  const m = readJson(mPath);
  const exp = withExtension(key, manifestOf(key, record, m.frozen_at));
  const CHANGES = ["reserves", "selection"];
  for (const k of new Set([...Object.keys(m), ...Object.keys(exp)]))
    if (![...CHANGES, "replaced", "burned", "exposed"].includes(k) && !same(m[k], exp[k])) die(`${set.path}: \`${k}\` would change; only reserves and selection may`);
  const next = Object.fromEntries(Object.keys(m).map((k) => [k, CHANGES.includes(k) ? exp[k] : m[k]]));
  writeJson(mPath, next);
  // Another set extended earlier names this extension record by sha256 in its `selection` (not core): refresh it.
  for (const k of Object.keys(EXT.sets).filter((k) => k !== key)) {
    const p = join(root, SETS[k].path);
    const o = readJson(p);
    const sel = withExtension(k, manifestOf(k, record, o.frozen_at)).selection;
    writeJson(p, Object.fromEntries(Object.keys(o).map((f) => [f, f === "selection" ? sel : o[f]])));
  }
  const regPath = join(here, "holdout-manifests.json");
  const reg = readJson(regPath);
  const old = reg.manifests[set.path];
  const core = coreSha(next);
  const earlier = [...new Set([...(reg.amendments ?? []).filter((a) => a.path === set.path).flatMap((a) => [a.superseded_core, a.core]), old])].filter((c) => c !== core);
  for (const c of earlier)
    if (!reg.amendments.some((a) => a.path === set.path && a.superseded_core === c && a.core === core))
      reg.amendments.push({
        path: set.path,
        set_id: set.set_id,
        superseded_core: c,
        core,
        fields: c === old ? ["reserves"] : ["tier", "reserves"],
        decision: "D9",
        date: now.slice(0, 10),
        by: "lead (decided), held-out run operator (applied)",
        note: `reserves extended by decision D9 (reserve exhaustion at runbook step 4), before any held-out census: ${reserves.length} reserves appended, drawn by select-holdout.mjs extend (${relative(root, extPath)}); every earlier reserve unchanged${c === old ? "" : "; tier as amended by D7"}`,
      });
  reg.manifests[set.path] = core;
  writeJson(regPath, reg);
  console.log(`${key}: D9 extension: ${add} places, ${xr.walked_new.length} further steps walked, ${xr.reskipped.length} earlier steps re-skipped, ${reserves.length} reserves drawn${ext.sets[key].exhausted ? " (pool exhausted)" : ""}; ${set.path} core ${core.slice(0, 12)} registered (${earlier.length} D9 amendments)`);
  process.exit(0);
}

if (mode === "write") {
  // A blind dev pool registers its cores in its own registry (created here), never in holdout-manifests.json.
  const regFile = selRegistryRel ? join(root, selRegistryRel) : join(here, "holdout-manifests.json");
  const reg = selRegistryRel && !existsSync(regFile) ? { "//": `Core sha256 (lib.mjs coreSha) of the ${SELECTION} manifests, written once by select-holdout.mjs write --selection ${SELECTION}; checked by verify. Not a held-out registry.`, scheme: CORE_SCHEME, manifests: {} } : readJson(regFile);
  if (reg.scheme !== CORE_SCHEME) die(`registry scheme ${reg.scheme}`);
  if (selRegistryRel) {
    const held = readJson(join(here, "holdout-manifests.json")).manifests;
    for (const set of Object.values(SETS)) if (held[set.path]) die(`${set.path} is registered as a held-out manifest; a ${ROLE} pool never is`);
  }
  if (checkTier(MANIFEST_TIER).length) die(`tier: ${checkTier(MANIFEST_TIER).join("; ")}`);
  const frozen_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  for (const key of Object.keys(SETS)) {
    const set = SETS[key];
    const s = record.sets[key];
    const nP = set.buckets.reduce((a, b) => a + b.primaries, 0);
    if (s.primaries.length !== nP || s.reserves.length !== set.reserve_order.length) die(`${key}: the draw has ${s.primaries.length} primaries and ${s.reserves.length} reserves, the spec ${nP} and ${set.reserve_order.length}`);
    if ([...s.primaries, ...s.reserves].some((r) => !/^[0-9a-f]{40}$/.test(r.sha))) die(`${key}: unpinned repo`);
    if (existsSync(join(root, set.path))) die(`${set.path} exists: a frozen manifest is never rewritten`);
    if (reg.manifests[set.path]) die(`${set.path} is registered already`);
    const m = manifestOf(key, record, frozen_at);
    writeJson(join(root, set.path), m);
    reg.manifests[set.path] = coreSha(m);
    console.error(`wrote ${set.path}: core ${reg.manifests[set.path]}`);
  }
  writeJson(regFile, reg);
  process.exit(0);
}

if (mode === "verify") {
  // Every check reads only this repository's git objects, the record and the manifests: no network, no
  // held-out repository. Output is a function of those inputs (sorted where order could vary).
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // --registry checks another copy of the registry against this repository's history (the tests use it).
  const regRel = relative(root, join(here, "holdout-manifests.json"));
  const reg = readJson(args.registry ? resolve(root, args.registry) : join(root, regRel));
  // --manifest-root DIR reads the registered manifests from DIR instead of this checkout: for test fixtures only.
  // Its output says so, and it is never a verification of this repository.
  const mroot = args.manifestRoot ? resolve(args.manifestRoot) : root;
  const fixture = mroot !== root;
  const redact = heldOutRedactor([...new Set([mroot, root])], allRecords(record));
  const say = (line) => console.log(redact(line));
  // A blind dev pool's cores are in its own registry (read from --manifest-root with its manifests), and its
  // manifests are never registered as held-out ones (prepare.mjs would run them as a held-out set).
  const selReg = selRegistryRel ? (existsSync(join(mroot, selRegistryRel)) ? readJson(join(mroot, selRegistryRel)) : null) : reg;
  if (selRegistryRel) {
    if (!selReg) problems.push(`${selRegistryRel} not written yet`);
    else if (selReg.scheme !== CORE_SCHEME) problems.push(`${selRegistryRel}: registry scheme ${selReg.scheme}, expected ${CORE_SCHEME}`);
    for (const set of Object.values(SETS)) if (set.path in reg.manifests) problems.push(`${set.path} is registered as a held-out manifest, but the ${SELECTION} selection has role ${ROLE}`);
  }

  // 1. Frozen inputs: the seed and the specification the record was drawn under are this script's.
  if (record.seed !== SEED) problems.push(`record seed ${JSON.stringify(record.seed)} is not the pre-registered seed ${SEED}`);
  const specNow = specOf();
  const { tier: specTier, ...specRec } = record.spec ?? {};
  for (const k of new Set([...Object.keys(specNow), ...Object.keys(specRec)]))
    if (!same(specRec[k], JSON.parse(JSON.stringify(specNow[k] ?? null)))) problems.push(`record spec.${k} differs from this script's pre-registered spec`);
  if (checkTier(specTier).length) problems.push(`record spec.tier is not a valid tier: ${checkTier(specTier).join("; ")}`);

  // 2. Exclusion lists: replay the git-derived part (manifests, tracked files, commit messages) at the refs
  //    the record names. The PR/issue text part needs the GitHub API and is taken from the record as is.
  const ex = record.exclusions ?? {};
  const refShas = [...new Set(Object.values(ex.refs ?? {}))].sort();
  // one batch for every recorded ref (a commit present answers "<sha> commit <size>")
  const present = spawnSync("git", ["-C", root, "cat-file", "--batch-check"], { input: refShas.map((c) => `${c}^{commit}\n`).join(""), encoding: "utf8", maxBuffer: 1 << 28 }).stdout.split("\n");
  const missingRefs = refShas.filter((c, i) => !/^[0-9a-f]{40,64} commit /.test(present[i] ?? ""));
  if (!refShas.length) problems.push("record exclusions.refs is empty");
  else if (missingRefs.length)
    problems.push(`cannot replay the exclusions: commits ${missingRefs.map((c) => c.slice(0, 12)).join(", ")} of the recorded refs are not in this clone (fetch them: git fetch origin 'refs/tags/heldout-exclusion-ref-*:refs/tags/heldout-exclusion-ref-*', or the branches; nothing of a held-out repo is needed)`);
  else {
    const off = offlineExclusions(refShas);
    for (const [what, recMap, offMap] of [["slug", ex.slugs ?? {}, off.slugs], ["name", ex.names ?? {}, off.names], ["hash", ex.hashed ?? {}, off.hashed]]) {
      const keys = new Set([...Object.keys(recMap), ...offMap.keys()]);
      for (const k of [...keys].sort()) {
        const want = [...(offMap.get(k) ?? [])].sort();
        const got = (recMap[k] ?? []).filter(OFFLINE_SOURCE).sort();
        if (!same(want, got)) problems.push(`exclusion ${what} ${k}: the record has sources ${JSON.stringify(got)}, replaying the recorded refs gives ${JSON.stringify(want)}`);
        if (recMap[k] && !recMap[k].length) problems.push(`exclusion ${what} ${k} has no source`);
      }
    }
    console.log(`exclusions: replayed ${off.slugs.size} slugs and ${off.names.size} names from ${refShas.length} recorded refs; ${Object.values(ex.slugs ?? {}).filter((v) => !v.some(OFFLINE_SOURCE)).length} slugs only from PR/issue text (taken from the record)`);
  }
  if (!same(ex.owners, ["geoffreyfernald"])) problems.push(`record exclusions.owners is ${JSON.stringify(ex.owners)}`);

  // 3. Per set: the pool respects the exclusions, the walk is well formed, and the draw replays.
  const isSha = (x) => /^[0-9a-f]{40}$/.test(x ?? "");
  for (const [key, set] of Object.entries(SETS)) {
    const s = record.sets[key];
    if (s.set_id !== set.set_id) problems.push(`${key}: record set_id ${s.set_id}, spec ${set.set_id}`);
    if (!same(s.pool, [...new Set(s.pool)].sort())) problems.push(`${key}: the pool is not sorted and unique`);
    if (s.pool.length !== s.counts.eligible) problems.push(`${key}: pool has ${s.pool.length} repos, counts.eligible says ${s.counts.eligible}`);
    const excludedN = Object.values(s.counts.excluded).reduce((a, b) => a + b, 0);
    if (s.counts.results !== s.counts.eligible + excludedN) problems.push(`${key}: ${s.counts.results} results != ${s.counts.eligible} eligible + ${excludedN} excluded`);
    // The offline part of eligibility (slug, owner, name, non-application name); licence, template, archived,
    // fork and topics need the search metadata, which the record does not keep.
    for (const slug of s.pool) {
      const [owner, name] = slug.split("/");
      if (ex.slugs?.[slug]) problems.push(`${key}: pool repo ${slug} is excluded (${ex.slugs[slug].join(", ")})`);
      if (ex.owners?.includes(owner)) problems.push(`${key}: pool repo ${slug} belongs to an excluded owner`);
      if (ex.names?.[name]) problems.push(`${key}: pool repo ${slug} has an excluded name (${ex.names[name].join(", ")})`);
      if (isHashedPoolExcluded(ex, slug)) problems.push(`${key}: pool repo ${slug} is in a pool committed as hashes`);
      if (NON_APP_NAME.test(name)) problems.push(`${key}: pool repo ${slug} has a non-application name`);
    }
    const bucketIds = new Set(set.buckets.map((b) => b.id));
    for (const w of s.walked) {
      if (w.bucket ? !bucketIds.has(w.bucket) || !isSha(w.sha) || w.skip : w.sha !== null || !w.skip) problems.push(`${key}: malformed walked entry ${JSON.stringify(w)}`);
      if (!s.pool.includes(w.repo)) problems.push(`${key}: walked ${w.repo} is not in the pool`);
    }
    const byRepo = new Map(s.walked.map((w) => [w.repo, w]));
    const res = draw(set, s.pool, (slug) => {
      const w = byRepo.get(slug);
      if (!w) problems.push(`${key}: the replay walks ${slug}, which the record did not walk`);
      return w ? { sha: w.sha, bucket: w.bucket, ...(w.skip ? { skip: w.skip } : {}) } : { sha: null, bucket: null, skip: "missing" };
    });
    // Determinism: a second replay gives the same draw.
    const again = draw(set, s.pool, (slug) => byRepo.get(slug) ?? { sha: null, bucket: null, skip: "missing" });
    if (!same(res, again)) problems.push(`${key}: the draw is not deterministic`);
    if (!same(res.walked.map((w) => w.repo), s.walked.map((w) => w.repo))) problems.push(`${key}: walk order differs from the record`);
    if (!same(res.primaries.map((p) => [p.slug, p.bucket]), s.primaries.map((p) => [p.repo, p.framework_bucket]))) problems.push(`${key}: primaries differ from the record`);
    if (!same(res.reserves.map((p) => [p.slug, p.bucket]), s.reserves.map((p) => [p.repo, p.framework_bucket]))) problems.push(`${key}: reserves differ from the record`);
    if (res.shortfall !== s.shortfall || res.unfilled_primaries !== s.unfilled_primaries) problems.push(`${key}: shortfall differs from the record`);
    for (const p of [...s.primaries, ...s.reserves]) if (byRepo.get(p.repo)?.sha !== p.sha || !isSha(p.sha)) problems.push(`${key}: ${p.repo} is pinned to ${p.sha}, the walk recorded ${byRepo.get(p.repo)?.sha}`);

    // 3b. Decision D9: the extension replays from the selection record and the extension record (offline). Its
    //     exclusions are taken from the extension record, as the PR/issue part of the original exclusions is.
    const e = EXT?.sets?.[key];
    if (e && EXT.base_record_sha256 !== recordSha) problems.push(`${key}: the D9 extension was drawn from another selection record (not replayed)`);
    else if (e) {
      const xset = extendedSet(set, e.add);
      if (EXT.decision !== "D9" || EXT.seed !== SEED) problems.push(`${key}: the D9 extension record names decision ${EXT.decision} and seed ${EXT.seed}`);
      if (!Number.isInteger(e.add) || e.add < 1) problems.push(`${key}: the D9 extension adds ${e.add} places`);
      if (e.walked_from !== s.walked.length) problems.push(`${key}: the D9 extension starts at walk step ${e.walked_from}, the record walked ${s.walked.length}`);
      for (const w of e.walked) {
        if (w.bucket ? !bucketIds.has(w.bucket) || !isSha(w.sha) || w.skip : w.sha !== null || !w.skip) problems.push(`${key}: malformed D9 walked entry ${JSON.stringify(w)}`);
        if (!s.pool.includes(w.repo)) problems.push(`${key}: D9 walked ${w.repo} is not in the pool`);
      }
      const steps = new Map(e.walked.map((w) => [w.repo, w]));
      let unrecorded = 0;
      const xr = extendedDraw(key, record, e.add, EXT.exclusions, (slug) => {
        const w = steps.get(slug);
        if (!w) unrecorded++;
        return w ? { sha: w.sha, bucket: w.bucket, ...(w.skip ? { skip: w.skip } : {}) } : { sha: null, bucket: null, skip: "missing" };
      });
      if (unrecorded) problems.push(`${key}: the D9 replay walks ${unrecorded} steps the extension did not record`);
      if (!same(xr.walked_new.map((w) => [w.repo, w.bucket ?? null]), e.walked.map((w) => [w.repo, w.bucket ?? null]))) problems.push(`${key}: the D9 walk differs from the extension record`);
      if (!same(xr.reskipped, e.reskipped)) problems.push(`${key}: the D9 re-skipped steps differ from the extension record`);
      if (!same(xr.primaries, res.primaries)) problems.push(`${key}: the D9 extension changes the primaries`);
      if (!same(xr.reserves.slice(0, res.reserves.length), res.reserves)) problems.push(`${key}: the D9 extension changes the earlier reserves`);
      if (!same(xr.reserves.slice(res.reserves.length).map((p) => [p.slug, p.bucket]), e.reserves.map((p) => [p.repo, p.framework_bucket]))) problems.push(`${key}: the D9 reserves differ from what the extended draw gives`);
      if (e.exhausted !== xr.reserves.length < xset.reserve_order.length) problems.push(`${key}: the D9 extension's \`exhausted\` is wrong`);
      for (const p of e.reserves) {
        const w = steps.get(p.repo) ?? byRepo.get(p.repo);
        if (w?.sha !== p.sha || !isSha(p.sha)) problems.push(`${key}: D9 reserve ${p.repo} is pinned to ${p.sha}, the walk recorded ${w?.sha}`);
      }
      console.log(`${key}: D9 extension: ${e.add} places added, ${e.walked.length} further steps walked, ${e.reskipped.length} earlier steps re-skipped, ${e.reserves.length} reserves drawn${e.exhausted ? " (pool exhausted)" : ""}`);
    }

    // 4. The manifest is exactly what `write` produces from the record (frozen_at aside), plus its append-only lists.
    const mp = join(mroot, set.path);
    if (existsSync(mp)) {
      const m = readJson(mp);
      const exp = withExtension(key, manifestOf(key, record, m.frozen_at));
      const LISTS = ["replaced", "burned", "exposed"];
      for (const k of new Set([...Object.keys(m), ...Object.keys(exp)]))
        if (!LISTS.includes(k) && !same(m[k], exp[k])) problems.push(`${set.path}: \`${k}\` differs from what the selection produces`);
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(m.frozen_at ?? "")) problems.push(`${set.path}: frozen_at ${JSON.stringify(m.frozen_at)}`);
      for (const p of checkManifestLists(m)) problems.push(`${set.path}: ${p}`);
      if (m.selection?.record_sha256 !== recordSha) problems.push(`${set.path}: selection.record_sha256 does not match ${relative(root, recordPath)}`);
      if (selReg?.manifests?.[set.path] !== coreSha(m)) problems.push(`${set.path}: not registered with its core hash${selRegistryRel ? ` in ${selRegistryRel}` : ""}`);
    } else problems.push(`${set.path} not written yet`);
    const bc = {};
    for (const p of res.primaries) bc[p.bucket] = (bc[p.bucket] ?? 0) + 1;
    console.log(`${key}: ${s.counts.results} results, ${s.counts.eligible} eligible, ${s.walked.length} walked; primaries ${JSON.stringify(bc)}, ${res.reserves.length} reserves`);
  }
  if (reg.scheme !== CORE_SCHEME) problems.push(`registry scheme ${reg.scheme}, expected ${CORE_SCHEME}`);
  // Registered amendments of a frozen core (decisions D5 and D7: the tier only). Each names the core it superseded and
  // the core it produced; the last amendment of a path produced its registered core.
  // With their corrections applied (lib.mjs effectiveAmendments): the secondary sets' entries read D5a.
  const amendmentsNow = effectiveAmendments(reg);
  for (const [i, a] of amendmentsNow.entries()) {
    if (!amendableFields(a.fields)) problems.push(`amendments[${i}]: only the tier and (decision D9) the reserves may be amended, not ${JSON.stringify(a.fields)}`);
    if (a.fields?.includes("reserves") && a.decision !== "D9") problems.push(`amendments[${i}]: a reserves amendment is decision D9's, not ${a.decision}`);
    if (!a.decision || !a.date || !/^[0-9a-f]{64}$/.test(a.superseded_core ?? "") || !/^[0-9a-f]{64}$/.test(a.core ?? "") || a.core === a.superseded_core) problems.push(`amendments[${i}] needs decision, date, superseded_core and a different core`);
    if (!(a.path in reg.manifests)) problems.push(`amendments[${i}]: ${a.path} is not registered`);
  }
  for (const p of Object.keys(reg.manifests)) {
    const last = amendmentsNow.filter((a) => a.path === p).at(-1);
    if (last && last.core !== reg.manifests[p]) problems.push(`${p}: its last amendment produced ${last.core.slice(0, 12)}, the registry records ${reg.manifests[p].slice(0, 12)}`);
  }
  // The committed history, as prepare.mjs checks it before a held-out run: every frozen version is the current
  // core or allowed by an amendment; amendments are append-only, unique, name only frozen versions, and none
  // is dated or committed after a held-out census.
  for (const p of historyProblemsCached(reg, regRel)) problems.push(`history: ${p}`);
  console.log(`amendments: ${amendmentsNow.map((a) => `${a.path} ${a.decision} (${a.date}, ${a.by})`).join("; ")}`);
  // Every registered held-out manifest holds its set's tier block (lib.mjs heldOutTierFile): the primary sets
  // and the secondary sets alike tier-d7.json's (the product's tier: decision D7 for the primaries, D7a for the secondaries).
  for (const p of Object.keys(reg.manifests)) {
    const m = existsSync(join(root, p)) ? readJson(join(root, p)) : null;
    const file = heldOutTierFile(m);
    if (!m || !file || !same(m.tier, readJson(join(here, file)).tier)) problems.push(`${p}: its tier is not eval/study/${file ?? HELD_OUT_TIER_FILES.primary}'s tier`);
  }

  // 5. No held-out repo (a slot's current occupant or an unused reserve) overlaps a dev manifest, by owner/repo,
  //    pinned sha or repo name: eval/repos*.json in the working tree and on every local branch, plus --dev files.
  //    Nor a secondary held-out set, nor the other primary set. Section 6 checks the secondary sets' own repos.
  const primary = Object.values(SETS).filter((set) => existsSync(join(mroot, set.path))).map((set) => ({ path: set.path, m: readJson(join(mroot, set.path)) }));
  const held = primary.flatMap(({ path, m }) => heldOutRepos(m).map((r) => ({ path, name: r.name, slug: repoSlug(r.url), sha: r.sha })));
  const keysOf = (r) => [`slug ${repoSlug(r.url ?? "")}`, r.sha && `sha ${r.sha}`, r.name && `name ${r.name.toLowerCase()}`, r.url && `name ${repoSlug(r.url).split("/")[1]}`].filter(Boolean);
  const others = []; // { where, keys, dev }
  const addManifest = (where, m, withLists, dev = false) => {
    for (const r of [...(m?.repos ?? []), ...(m?.reserves?.repos ?? [])]) others.push({ where, keys: new Set(keysOf(r)), dev });
    if (withLists) for (const e of [...(m?.replaced ?? []), ...(m?.burned ?? []), ...(m?.exposed ?? [])]) for (const n of [e.repo, e.reserve, e.name]) if (n) others.push({ where, keys: new Set([`name ${n.toLowerCase()}`]), dev });
  };
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const devVersions = new Set();
  for (const f of readdirSync(join(root, "eval")).filter((f) => /^repos[^/]*\.json$/.test(f)).sort()) {
    addManifest(`eval/${f} (working tree)`, parse(readFileSync(join(root, "eval", f), "utf8")), false, true);
    devVersions.add(`working tree:eval/${f}`);
  }
  const blobs = new Map(); // blob -> first ref:path, so identical versions are read once
  const refLines = git("for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/", "refs/remotes/").split("\n").filter(Boolean).sort();
  // Each ref's eval/ tree in one cat-file call, and each distinct tree listed once (refs share most of them).
  const evalTree = spawnSync("git", ["-C", root, "cat-file", "--batch-check"], { input: refLines.map((l) => `${l.split(" ")[1]}:eval\n`).join(""), encoding: "utf8", maxBuffer: 1 << 28 });
  if (evalTree.status !== 0) die(`git cat-file --batch-check failed: ${evalTree.stderr}`);
  const treeOf = evalTree.stdout.split("\n").slice(0, refLines.length).map((l) => (/^[0-9a-f]{40,64} tree /.test(l) ? l.split(" ")[0] : null));
  const listing = new Map(); // eval tree -> [[blob, path]] of eval/repos*.json
  for (const [i, line] of refLines.entries()) {
    const ref = line.split(" ")[0];
    const t = treeOf[i];
    if (!t) continue;
    if (!listing.has(t))
      listing.set(
        t,
        // eval/repos*.json sit directly under eval/: the top level of its tree is enough (not -r: 119 trees)
        git("ls-tree", t)
          .split("\n")
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf("\t")).split(" ")[2], `eval/${l.slice(l.indexOf("\t") + 1)}`])
          .filter(([, f]) => /^eval\/repos[^/]*\.json$/.test(f)),
      );
    for (const [blob, f] of listing.get(t)) if (!blobs.has(blob)) blobs.set(blob, `${ref}:${f}`);
  }
  for (const [blob, where] of blobs) {
    addManifest(where, parse(git("cat-file", "blob", blob)), false, true);
    devVersions.add(where);
  }
  for (const f of (args.dev ? String(args.dev).split(",") : []).filter(Boolean)) {
    addManifest(`${f} (--dev)`, readJson(resolve(f)), false, true);
    devVersions.add(f);
  }
  // Every other registered held-out manifest: the secondary sets, and the other selection's sets (role primary).
  const otherKind = (m) => (m?.role === "secondary" ? "secondary held-out" : "held-out of another selection");
  for (const p of Object.keys(reg.manifests).filter((p) => !primary.some((x) => x.path === p)).sort()) {
    const m = readJson(join(mroot, p));
    addManifest(`${p} (${otherKind(m)})`, m, true);
  }
  // Every other blind dev pool's manifests (not in the held-out registry): a pool never overlaps another pool, nor a
  // held-out set overlaps a pool, by owner/repo, pin or name, current occupants, reserves and listed names alike.
  for (const p of POOL_MANIFESTS.filter((p) => !primary.some((x) => x.path === p) && !Object.values(SETS).some((x) => x.path === p) && existsSync(join(mroot, p))).sort())
    addManifest(`${p} (blind dev pool of another selection)`, readJson(join(mroot, p)), true);
  for (const { path, m } of primary) addManifest(`${path} (${DEV_POOL ? "blind dev pool" : "primary held-out"})`, m, false);
  // Pools committed only as hashes (eval/<pool>-hashes.json, working tree): compared by slug and name hash.
  for (const f of readdirSync(join(mroot, "eval")).filter((f) => HASHED_POOL_FILE.test(`eval/${f}`)).sort()) {
    const m = parse(readFileSync(join(mroot, "eval", f), "utf8"));
    for (const r of m?.repos_sha256 ?? []) others.push({ where: `eval/${f} (pool committed as hashes)`, keys: new Set([r.slug_sha256, r.name_sha256].filter(Boolean).map((h) => `hash ${h}`)), dev: false });
  }
  const overlaps = new Set();
  for (const h of held) {
    const mine = new Set([`slug ${h.slug}`, `sha ${h.sha}`, `name ${h.name.toLowerCase()}`, `name ${h.slug.split("/")[1]}`, `hash ${poolHash("slug", h.slug)}`, `hash ${poolHash("name", h.slug.split("/")[1])}`, `hash ${poolHash("name", h.name)}`]);
    for (const o of others) {
      if (o.where.startsWith(`${h.path} `)) continue; // its own manifest
      const hit = [...o.keys].filter((k) => mine.has(k));
      if (hit.length) overlaps.add(`${h.path}: ${KIND} ${h.name} overlaps ${o.where} by ${hit.join(", ")}`);
    }
  }
  // 6. No dev manifest takes a repo that a SECONDARY held-out set still holds out (prepare.mjs refuses those
  //    as held-out too; verify must catch them first): each secondary set's current occupants and unused
  //    reserves by owner/repo, pinned sha and name, plus the names in its `replaced` (the reserve swapped in) and
  //    `exposed` lists. Not checked: a `replaced[].repo` and a burned repo, which rules 1 and 3 release from the
  //    set (they may be dev repos; polar and CTFd are, by rule 6).
  const secondary = Object.keys(reg.manifests).filter((p) => !primary.some((x) => x.path === p)).sort().map((p) => ({ path: p, m: readJson(join(mroot, p)) }));
  let heldSecondary = 0;
  for (const { path, m } of secondary) {
    // the append-only lists name repos of this set (an `exposed` entry must name an occupant, reserve or
    // replaced repo: a misspelt name would match nothing and protect nothing)
    for (const p of checkManifestLists(m)) problems.push(`${path}: ${p}`);
    if (reg.manifests[path] !== coreSha(m)) problems.push(`${path}: not registered with its core hash`);
    const released = new Set([...(m.replaced ?? []).map((e) => e.repo), ...(m.burned ?? []).map((e) => e.name)].filter(Boolean).map((n) => n.toLowerCase()));
    const entries = heldOutRepos(m).map((r) => ({ name: r.name, keys: new Set([`slug ${repoSlug(r.url)}`, `sha ${r.sha}`, `name ${r.name.toLowerCase()}`, `name ${repoSlug(r.url).split("/")[1]}`]) }));
    for (const n of [...(m.replaced ?? []).map((e) => e.reserve), ...(m.exposed ?? []).map((e) => e.name)].filter(Boolean))
      if (!released.has(n.toLowerCase())) entries.push({ name: n, keys: new Set([`name ${n.toLowerCase()}`]) });
    heldSecondary += entries.length;
    for (const h of entries)
      for (const o of others.filter((x) => x.dev)) {
        const hit = [...o.keys].filter((k) => h.keys.has(k));
        if (hit.length) overlaps.add(`${path}: ${otherKind(m)} ${h.name} overlaps ${o.where} by ${hit.join(", ")}`);
      }
  }
  problems.push(...[...overlaps].sort());
  console.log(`overlap: ${held.length} ${KIND} repos (current occupants and unused reserves) checked against ${devVersions.size} dev manifest versions, the secondary sets and each other`);
  console.log(`overlap: ${heldSecondary} entries of the other held-out sets (secondary sets${secondary.some((x) => x.m?.role !== "secondary") ? " and the other selection's sets" : ""}: current occupants, unused reserves, replaced and exposed names) checked against the same dev manifest versions`);

  if (fixture) console.log(`verify: FIXTURE run (manifests from --manifest-root), not a verification of this repository`);
  // Without --selection (and without --record or --extension, which name one selection's files), verify checks every
  // selection whose record is committed: the others run as a child with the same --registry, --manifest-root and
  // --dev, and the exit status is the worst of all (1 problems, 2 unreadable input, 4 clean fixture, 0 verified).
  const statuses = [problems.length ? 1 : fixture ? 4 : 0];
  if (!args.selection && !args.record && !args.extension) {
    const pass = ["registry", "manifestRoot", "dev"].filter((k) => args[k] !== undefined).flatMap((k) => [`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(args[k])]);
    for (const [id, sel] of Object.entries(SELECTIONS)) {
      if (id === SELECTION || !existsSync(join(root, sel.record))) continue;
      console.log(`verify: selection ${id}`);
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "verify", "--selection", id, ...pass], { encoding: "utf8", maxBuffer: 1 << 28 });
      process.stdout.write(r.stdout ?? "");
      process.stderr.write(r.stderr ?? "");
      statuses.push(r.status ?? 1);
    }
  }
  if (problems.length) {
    console.error(problems.map(redact).join("\n"));
    console.error(`verify: ${problems.length} problems${SELECTION === "primary" ? "" : ` (selection ${SELECTION})`}`);
  }
  const worst = [1, 2, 4].find((x) => statuses.includes(x)) ?? (statuses.every((x) => x === 0) ? 0 : 1);
  if (worst) process.exit(worst); // a clean fixture is not a verification: never exit 0
  console.log(`verify: the manifests are exactly what the selection${statuses.length > 1 ? "s give" : " gives"} from ${statuses.length > 1 ? "their" : "its"} frozen inputs (seed, spec, exclusions, pool, walk); the draw replays deterministically; registry and append-only lists are consistent; no ${KIND} repo overlaps a dev manifest${DEV_POOL ? " or a held-out set" : ""}`);
}
