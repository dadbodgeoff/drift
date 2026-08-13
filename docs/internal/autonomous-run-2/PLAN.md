# Drift v3 — Autonomous Run 2: Open Items, Backlog, and the Path to Beta

**Written:** 2026-07-27
**Base:** branch `fix/phase-a-correctness` @ `6e465b3` (run 1 closed: 64 commits, `verify:ci` exit 0, e2e 63/63, external suite 7/7)
**Inputs:** run 1 `SUMMARY.md` (this directory) — 20 partials, 6 discussion items, 2 dependency-skipped, 2 T93 blocking findings; plus the 2026-07-27 external performance benchmark (`~/drift-falsification/bench-2026-07-27/`, report: docs/reference/performance.md needs its numbers).
**Purpose:** close every item run 1 left open whose blocker is now resolved. The four human
decisions that gated T18/T19b/T28/T80 have been made and are pre-registered below. Executable
unattended under `PROTOCOL.md` (triage-and-continue).

---

## Phase 0 — Protocol, tiers, and lessons that are now hard rules

`PROTOCOL.md` governs the run lifecycle. Verification tiers, commit discipline, and stop
conditions from PLAN.md §0 stay in force, with these amendments:

### 0.1 Amended verification tiers

| Tier | When | Command | Cost |
|---|---|---|---|
| T0 | after every edit | `pnpm build` + touched package's vitest file | ~40s |
| T1 | before every commit | `pnpm test:engine && pnpm -r test` | ~3min |
| T1e | before every commit that touches CLI/MCP surfaces, exit codes, or scripts/ | T1 + `pnpm test:e2e` | +2min |
| T2 | after every task | `pnpm eval:external` | ~100s |
| T3 | after every phase | `pnpm verify:ci` | ~8min |

**T1e exists because run 1 went ~50 tasks without running e2e and accumulated 8 failures.**
Do not repeat that.

### 0.2 Hard rules from run 1's own post-mortem

1. **Rebuild `target/release` after any Rust change, before any measurement** (T-stale-binary
   produced a false 8.4% FP-rate).
2. **Fixture green is not done** for changes to matching, walking, or ignore logic — the external
   suite is the oracle (T22's fixture passed while openstatus routes were being swallowed).
3. **Never write a number you did not measure this session** (T42's RegExp comment).
4. **Any behaviour shared by CLI and MCP lands in `@drift/query` or ships with a parity
   assertion on both surfaces** (T46's fix missed MCP; T48's removal missed the CLI copy; T51
   bit three times).
5. **Perf claims are measured on real repos** (`$DRIFT_EVAL_REPOS`), not only the synthetic
   20k repo. The external benchmark showed real-file cost ≈ 10× synthetic per file
   (papermark, 1,347 files: prepare 24.4s).
6. **Do not store run state in the session scratchpad** — it is wiped on session teardown. Use
   a directory under the repo or `~/drift-falsification/`.

### 0.3 Pre-registered decisions (made by the maintainer 2026-07-27 — do not re-litigate)

- **T18 baseline semantics: option C.** Add a provenance column to `baseline_violations`.
  Onboarding (`--accept-defaults`) baselines shield **untouched code only** — rewriting the
  violating line or deleting-and-reintroducing it blocks. Explicit waivers (`findings suppress`,
  contract waivers) remain permanent. Requires a forward migration (schema 27 → 28) and updating
  the two tests that pin the old contract; the commit must name them.
- **T19b repo identity: option (a) with (b) fallback.** Identity = hash(git remote origin URL +
  root commit sha); repos with no remote fall back to hash(root package.json name + root commit
  sha). Requires a stored-id migration with a re-keying story for existing databases; contract
  import must succeed across two checkouts of the same repo at different paths, and still refuse
  foreign repos.
- **T28 inert contract fields: implement the valuable two, remove the rest.** Implement
  `enforcement_policy` and `active_convention_rule_ids` as real enforcement inputs. Remove the
  other five (`beta_claim_profile`, `active_semantic_capability_ids`, `architecture_contract_id`,
  `architecture_contract_fingerprint`, `semantic_capability_contract_version`) with a schema
  bump; import of a contract carrying a removed field fails closed with a named reason.
- **T80 engine binaries: deferred this run.** Do not install cross toolchains, do not write CI
  workflows that require pushing. The honest validator state (1 verified, 1 unexecuted,
  3 missing) stands. Consequence accepted: T84 (publish) stays blocked and T123 below is
  design-only.
- Everything outward-facing stays gated: no push, no publish, no issue replies sent, no npm.
  `@modelcontextprotocol/sdk` may be *evaluated* (the 2026-07-28 gate has passed) but migration
  needs the T47 follow-up verdict first (T137).

### 0.4 Environment invariants (updated for the new root)

- Repo root is `~/drift-falsification/drift` (run 1's T82 surgery; `drift v3/` no longer exists —
  old paths in any doc are stale).
- `DRIFT_ENGINE_BIN` exported; every scan/check reports `engine_source: "rust"`.
- Eval repos at `$DRIFT_EVAL_REPOS`; never commit into them.
- Disk floor 5 GB (stop condition). Benchmark artifacts and any generated large repos live in
  `~/drift-falsification/bench-2026-07-27/` — reuse `synth-20k` from there rather than
  regenerating.

---

## Phase 1 — Enforcement correctness (beta blockers; do first, with full verification budget)

Run 1 deferred T93's fix explicitly because it landed at end-of-run with no verification room.
That reason is void now: it goes first.

### T100 — Match on resolved module identity, not specifier strings (T93 bypasses + T13b)
**Why:** the product's central claim has two proven bypasses, filed with fixtures:
`import { prisma } from "../../../lib/prisma"` passes where the aliased form blocks, and a barrel
re-export launders the same import. Root cause is one defect: `check_command.rs` compares import
*specifier strings* against forbidden *specifiers*; the resolver already produces resolved paths
(the `:3148` comparison even reads `resolved_path == forbidden`, which can never match — a
resolved file path against a specifier). T13b is the same defect from the other direction: the
boundary rule dropped `../../lib/prismaClient`, a legitimate client specifier, for string reasons.
**Do:** resolve the forbidden module set to file identities at contract-materialisation time;
match each import by its resolved identity (falling back to specifier match only when resolution
fails, and recording that as a parser gap, not silence). Barrel chains are covered by the existing
multi-hop resolution — the fix is using it on both sides of the comparison.
**DoD:** both T93 fixtures block; the T03 negative controls still hold on all 7 repos (the
`-legacy` lookalike must stay uncaught — no overshoot); external suite 7/7 with every baseline
delta explained in the commit body. This touches `is_forbidden_import` territory: **T2 after every
sub-step, never batched.**
**Proof:** `pnpm eval:external` + the two fixture tests + `cargo test -p drift-engine`.

### T101 — T01c: declared-modules contract materialises block, finding reports `enforcement_result: none`
**Why:** F3-class silent pass — a block-mode contract that exits 0 — on the `--data-modules`
path (midday). Run 1 isolated it to `declaredDataModulesCandidate` and could not reproduce by
hand; the harness sequence (clean control route + prior F4 probe) triggers it.
**Do:** instrument the declared path at the point the engine payload is built; replay the exact
harness sequence; fix; then promote `enforcement_matches_mode` from a recorded baseline field to
a **hard assertion** in the external suite.
**DoD:** midday `injection_enforcement: block`, exit 2; `enforcement_matches_mode` asserted for
all 7 repos.
**Proof:** `pnpm eval:external` (assertion now fails on regression by construction).

### T102 — Gitignore correctness via per-directory semantics (T22, second attempt)
**Why:** nested `.gitignore` files are ignored entirely and `!` negations discarded. Run 1's
attempt failed because `GitignoreBuilder::add()` scopes patterns to the builder root — a bare
`app` pattern in `apps/server/.gitignore` went repo-wide and swallowed openstatus's routes.
**Do:** option (b) from the T22 entry — adopt `ignore::WalkBuilder` for file discovery, which
applies per-directory precedence natively. The `ignore` crate is already authorised.
**DoD:** T08 fixtures pass (nested honored, negation honored) **and** external suite 7/7 with
openstatus `injection_caught: true` and `catches_genuine_subpath: true` — the exact fields the
first attempt regressed.
**Proof:** `pnpm eval:external` + fixture tests.

### T103 — A6 discovery: workspace-package resolution and message suppression (T01a, T01b)
**Why:** two run-1 discoveries left open. `specifierPointsAt` matches specifier tails against
file paths, so `@midday/supabase/server` never resolves to `packages/supabase/src/...` — the
discovery that exists specifically for whitelist-defeating repos can't see the most common
monorepo shape. Separately, the discovery message is suppressed from text output whenever any
other candidate kind exists.
**Do:** resolve workspace package names via the workspace manifest (pnpm-workspace/package.json
`workspaces`) before tail-matching; surface `data_layer_discovery` in text output regardless of
other candidates.
**DoD:** midday discovery names `@midday/supabase` wrapper with the local path; message visible
in text output on a repo with mixed candidates.
**Proof:** `pnpm eval:external` (midday row) + a fixture test for the message path.

---

## Phase 2 — Performance to the sub-1s gate (unlocks the launch headline)

External benchmark baselines (2026-07-27, medians, real repos, this machine): single-file check
5.7s/1.3k files → 23.3s/5k; prepare 24.4s/1.3k; repo map 96s/5k; check peak RSS 0.8–1.4GB;
per-scan state ~410MB (dub) with **no GC** — 4 `start` runs left a 1.6GB DB. Order below is
dependency order: storage sanity first (it contaminates every other measurement), then the
engine, then the graph consumers.

### T110 — Scan retention: GC superseded scans; no-op fast path for `start`
**Why:** every `start` appends a full fact set + graph artifact forever (4 runs = 4 × 107k facts
on dub). Beta users re-scanning daily hit multi-GB state in a week, and accumulated scans are the
prime suspect for run 1's unreproduced 3.9s check claim (external bench measured 18.7s on a
4-scan DB). Also: warm `start` on an unchanged repo costs 70–100% of cold — there is no
short-circuit.
**Do:** (1) measure check latency at 1 vs 4 stored scans to settle the discrepancy on the record;
(2) prune superseded scans (walk `previous_scan_id`, keep latest per branch + any scan referenced
by findings/baselines) on successful scan completion, with `VACUUM` policy documented;
(3) `start` on same commit + clean tree + same engine version returns the existing scan in <1s.
**DoD:** dub DB after 5 consecutive `start` runs ≤ 1.2× single-scan size; unchanged-repo `start`
<1s; the 1-scan vs N-scan check numbers recorded in docs/reference/performance.md.
**Proof:** scripted 5-run loop + `stat` + timed no-op start, committed as a test where feasible.

### T111 — Changed-files-only engine mode (completes T45; the T44 gate)
**Why:** T45 wired reuse manifests into `check` but the engine still walks and hashes every file
to decide reusability — 3.9s of pure overhead on formbricks for a one-line edit. This is the
single blocker on T44, the launch headline.
**Do:** an engine mode that takes the changed-file list (from the diff already in hand) and
touches only those files plus their reverse-dependency closure from the stored graph, skipping
hash-verification of everything else. Stays behind T15's version gate (facts from a different
engine version are refused, so staleness cannot survive an upgrade).
**DoD:** single-file check <1s on formbricks AND <1.5s on cal.com (measured on 1-scan DBs, post-
T110); detection unchanged (T2 green; the T93 fixtures from T100 still block).
**Proof:** timed runs recorded in performance.md; `pnpm eval:external`.

### T112 — Scoped graph loading for `prepare` (and check's readiness pass)
**Why:** issue #99's substance. `prepare` loads and traverses the whole graph for a task that
needs the neighbourhood of ≤10 files; cost tracks evidence density, not file count (cal.com
15.8s < dub 41.1s despite more files). Same root cause as the 0.8–1.4GB check RSS.
**Do:** indexed SQL queries for the node/edge/evidence neighbourhood of the target files;
hydrate only that subgraph. `getFactGraphArtifact`'s lazy getters (T42) are the seam.
**DoD:** prepare <2s on papermark, <5s on cal.com; check peak RSS <300MB on cal.com; prepare
quality eval still 3/3 (`pnpm eval:prepare`) — speed must not cost the ranking fix.
**Proof:** timed runs + `/usr/bin/time -l` RSS + `pnpm eval:prepare`.

### T113 — `repo map` answers from SQL, paginated
**Why:** 96s on cal.com, 180s on synth-20k. `--limit/--offset` exist but the whole map is built
first. Nobody runs a 96-second map twice.
**DoD:** first page <5s on cal.com; full-map output byte-identical to current for a fixture repo
(correctness pin).
**Proof:** timed run + fixture diff test.

### T114 — Ship the hooks pack (T44, unblocked)
**Why:** the launch headline. Correctness was proven in run 1 (exit 2 on violating edit, exit 0
on clean, warn/block split verified); only latency gated it.
**Do:** the PreToolUse/pre-commit hook per docs/reference/enforcement.md messaging. Gate on
T111's DoD being met — if Phase 2 misses sub-1s, this task auto-skips with the measured number
logged (same discipline run 1 used).
**DoD:** hook blocks a violating edit end-to-end in <1s wall on formbricks; e2e test added.
**Proof:** `pnpm test:e2e` + timed hook invocation.

---

## Phase 3 — Identity, baseline, and contract semantics (decisions now in hand)

### T120 — Path-independent repo identity (T19b, decision: (a)+(b) fallback)
**Do:** per §0.3. Migration re-keys existing rows; `drift doctor` reports identity source
(remote/content). Cross-checkout import test: export from checkout A, import into checkout B of
the same repo at a different path → `imported: true`; cal.com contract into taxonomy still
refused with the same reasons as today.
**DoD:** both directions tested; migration idempotent and forward-only (T16 pattern).
**Unblocks:** T122, T123.

### T121 — Baseline provenance (T18, decision: C)
**Do:** per §0.3. Migration adds provenance (`onboarding` | `explicit`); blocking predicates
treat `diff_status: new_in_diff` + block-mode as blocking when provenance is `onboarding`; the
four-case matrix from the T18 entry becomes four tests, with case 3 (line rewritten) and case 4
(reintroduced) now blocking. Update the two tests that pin the old contract; name them in the
commit.
**DoD:** four-case matrix green with the new semantics; external suite baseline deltas explained.

### T122 — drift.lock framing (T49, unblocked by T120)
**Do:** E3 as designed — contract export as a committed, PR-reviewable `drift.lock`; docs +
`contract export --output drift.lock` ergonomics; the cross-checkout import test from T120 is the
proof this can work at all.
**DoD:** documented flow verified end-to-end on two checkouts of taxonomy.

### T123 — GitHub Action (T50) — **design-only this run**
**Why:** T120 removes the identity blocker, but T80's deferral means no Linux engine binary
exists, and the Action runs on Linux. Writing a workflow that cannot be executed anywhere would
repeat the empty-package pattern T80 just fixed in the validator.
**Do:** author the workflow + docs marked UNVERIFIED, building the engine from source via cargo
on the runner as the documented interim (slow but honest). Do not push.
**DoD:** workflow file + docs stating exactly what is and is not verified.

### T124 — Contract fields (T28, decision: implement 2, remove 5)
**Do:** per §0.3. `enforcement_policy` becomes a real enforcement input (per-convention
mode override precedence documented); `active_convention_rule_ids` scopes which accepted
conventions a check enforces. Five fields removed; importer fails closed on them with a named
reason; schema bump + migration.
**DoD:** each implemented field has a test proving it changes enforcement outcome; import of a
contract carrying a removed field refuses with the field named; T27's layering tests still green.

---

## Phase 4 — Surface quality and hygiene (partials with stated remaining scope)

### T130 — MCP preflight packet to ≤12 top-level keys (T48 completion)
Measure which keys the MCP consumers and the prepare quality eval actually read; collapse or drop
the rest (80KB/~20k tokens today on a 131-file repo is hostile to the agents the surface exists
for). Rule 4 applies: the CLI copy of the packet changes in the same commit or a parity test
pins the divergence as intended. **DoD:** ≤12 keys, ≤20KB on taxonomy, `pnpm eval:prepare` 3/3,
e2e parity test green.

### T131 — Auth dominance end-to-end (T07b)
The hand-written contract naming `requireUser`, plus the five fixtures listed in the T07b entry
(guard-in-dead-branch, guard-in-unrelated-function, else-if chain, ternary guard, destructured
tenant id). Behind `--experimental-security`, so no enforcement-path risk. Days-scale: PROTOCOL's
triage rules apply — partial extraction with fixtures committed is an acceptable outcome.
**DoD:** the line-6-guard/line-8-sink bypass fixture produces a finding; naive dominance's
false "protected" is pinned as the failure the feature exists to fix.

### T132 — DriftError migration for remaining throw sites (T23 completion)
Migrate the remaining classifier-fallback sites (8 were counted in T09). **DoD:** classifier
string-matching fallback hit count measurably reduced; every migrated site's code/action/
retryability tested.

### T133 — Single-source version constants (T63 completion)
Generate the four TS constants and `DRIFT_ENGINE_VERSION` from package.json/Cargo.toml at build
time instead of pinning them with tests. **DoD:** a version bump in one file propagates
everywhere with no manual edit; T63's coupling tests still pass.

### T134 — Continue the cli.test.ts split (T61 pattern)
Extract the next 2–3 contiguous families with the count-guard (436 == 436 style) per extraction.
Mechanical; fill-in work between larger tasks. **DoD:** cli.test.ts under 12k lines, package test
count unchanged.

### T135 — Exact forbidden sets for dub/papermark/midday (T14 completion)
Pre-registered expectation: the current post-T100 baseline sets, reviewed against each repo's
real data layer, become `expectForbiddenExact` entries. **DoD:** no repo left on the weaker
`expectForbidden`.

### T136 — Parser-gap burn-down on real repos
2,470 gaps on cal.com and 632 on dub keep every real repo in `advisory_only`/`refuse` — no repo
can block out of the box, which gates the product claim all the perf work serves. **Do:**
bucket the gap kinds on cal.com/dub, fix the top classes (T103's workspace-package resolution
likely removes a large bucket), re-measure. **DoD:** measured gap reduction recorded; at least
one real eval repo reaches `can_block` readiness without hand-holding — or the blocker for that
is named precisely.

### T137 — MCP SDK verdict (T52 follow-up; date gate passed)
Verify what the 2026-07-28 protocol revision actually contains (T47 could not). If the current
hand-rolled server still negotiates and serves sessions against the revision, record NO-MIGRATE
with evidence and close T52. Migration itself would be a new plan item, not this run's work.

---

## Phase 5 — Re-verification and honest state

### T140 — Refresh the performance reference with real-repo numbers
docs/reference/performance.md currently carries only synthetic numbers, which the external
benchmark showed understate real-repo cost ~10× per file. Add the real-repo table (before/after
Phase 2), the 1-scan vs N-scan finding from T110, and retire any number not re-measured this
run. **DoD:** every number in the doc was produced by a command run this session (rule 3).

### T141 — Full gate + closing report
`pnpm verify:ci`, external suite, prepare eval, e2e, Rust suites; update GATE.md, SUMMARY.md,
HALT.md-equivalent handoff. Outcome table in the run-1 format. Nothing pushed, nothing published.
**Explicitly out of scope, still human-gated:** T84 npm publish (also blocked by T80 deferral),
T75 failure-catalog publishing, sending the four drafted issue replies. Note for the #99 reply:
Phase 2 likely changes its substance (the underlying latency is the fix) — re-verify against the
issue's opencode repro before the maintainer sends anything.

---

## Task order and budget notes

Strict phase order 1 → 2 → 3 → 4 → 5; within phases, listed order. Phase 1 and 2 are the beta
gates and get the deepest verification budget. If context runs short, the halt priority is:
finish the in-flight task, T2, update the handoff, stop — same as run 1. The run's stop
condition is the same sentinel: `no actionable tasks remain`.

| Phase | Tasks | Theme |
|---|---|---|
| 1 | T100–T103 | Enforcement correctness — the two bypasses, the silent pass, gitignore, discovery |
| 2 | T110–T114 | Performance to <1s; ship the hooks pack |
| 3 | T120–T124 | Identity, baseline provenance, drift.lock, contract fields |
| 4 | T130–T137 | MCP packet, auth claims, errors, versions, test split, exact sets, parser gaps, SDK verdict |
| 5 | T140–T141 | Re-measure, re-verify, hand off |
