# CV sprint handoff

**Branch:** `fix/phase-a-correctness`. **Head:** `106f204b`. **Nothing pushed.**
Tree clean. Five commits added this run, all gated. Written 2026-08-04.

## What landed

| | status | commit |
|---|---|---|
| BB-9 (prerequisite) | DONE | `86e8dfaf` |
| CV-1 | DONE | `b03e4b6f` + `f36d9ddc` |
| CV-2 | BLOCKED — context, design resolved | — |
| CV-3 | BLOCKED — needs a decision | — |
| CV-4, CV-5 | SKIPPED_DEPENDENCY on CV-3 | — |

BB-8, BB-10 and BB-11 were already settled before this run. BB-9 was found uncommitted and in
flight; it is now committed with its full gate battery.

## Gate status, measured on `106f204b`

All five ran on one tree with no rebuild during the run — see the hazard note below for why that
sentence is load-bearing.

```
eval:external      7/7, no change vs baseline
eval:determinism   7/7 deterministic over 3 runs
eval:evasion       91 shape cells, no change vs baseline
eval:bench         0/56 ordinary-edit refusals, ratchet ok        <- BB-9's DoD
beta:proof         8/8 events verified
cargo test         31/31 engine binaries
```

## The decision waiting on you

**CV-3, written up in [CV-3-PROMOTION-BLOCKER.md](CV-3-PROMOTION-BLOCKER.md).** All three kinds
CV-3 wants to promote are *enforced* by control-flow proofs, so they fail CV-3's own promotion
standard (a). `api_route_requires_auth_helper` declares `control_flow_guard_dominance` as a required
capability and its finding reads "Accepted auth helper must dominate protected route sinks."
CV-3's red #3 says to stop and record before modifying a handler; that document is the record.

Recommendation: **option B** — a presence-only enforcement mode for family kinds beside the existing
proof path, which keeps its semantics and stays quarantined. ~1–1.5 agent-days plus CV-4's matrix
against the new mode. CV-4 and CV-5 unblock behind it.

## Resuming CV-2

Its design is resolved and recorded in `log.jsonl`. The short version: **CV-2's premise that "the
facts already distinguish these" is false.** All 117 of dub's cron/webhook routes carry only
`file_role_detected: api_route`; `cron_job` exists in the `CanonicalRole` union and nothing emits it.

Because red #4 forbids a second glob engine in the deriver, and the deriver is Rust while the one
scope predicate must live in `@drift/core`, **flavor has to reach the engine as data**:

1. `packages/core/src/convention-scope.ts` gains `routeFlavor(filePath)` beside
   `conventionScopeFiles`, reusing `matchesGlob` / `isNextApiRoutePath`. Flavors `app | cron |
   webhook`, defaulting to `app` so a repo with no cron paths yields one unconditioned family
   (red #2).
2. `conventionScopeFiles` honours `matcher.applies_to.route_flavors`, mirroring the
   `applies_to_file_roles` shape `required_change_checks` already uses (`run-check.ts:1740`).
3. The `infer-candidates` request carries per-file flavors, computed TS-side following the existing
   `diff_changed_files` precedent in `packages/cli/src/engine/engine-candidates.ts`. The engine reads
   a field and does no path matching — which is what satisfies red #4.
4. `candidate_command.rs` computes per-flavor denominators and emits `applies_to.route_flavors`.

One caution on red #3's ">= 90% of the 341 measured wrapper users" target:
`verifyQstashSignature` was **never nominated as an auth candidate at all** in the CV-1 run, so the
signature family CV-2 predicts may not form without work on its own nomination. Measure before
assuming.

## What CV-1 actually ships, stated precisely

One family candidate per kind, derived from the per-symbol candidates, with a disjunctive matcher
(multi-entry `required_calls` — the existing `accepted_auth_helpers_for_convention` already reads it
as a set of alternatives, so `required_calls_any_of` would have been a second code path for semantics
that already exist), union coverage, per-member evidence and join reason, and `superseded_by` on the
members.

Measured:

| repo | kind | best per-symbol | family | members |
|---|---|---|---|---|
| dub | auth | 0.0324 | **0.5709** | withAdmin, withPartnerProfile, withPublishableKey, withSession, withWorkspace |
| dub | rate limit | 0.0385 | 0.0526 | ratelimit, ratelimitOrThrow |
| papermark | rate limit | — | 0.0813 | checkRateLimit, ratelimit |

No family on taxonomy, formbricks, calcom, midday, openstatus. **No request-validation family
anywhere** — dub has zero `request_validation_called` facts, so its validation candidates are
name-matching with no positive evidence, and aggregating them was what produced an 89-member family.

dub auth at 0.5709 is **under** the plan's ≥0.6 target. Recorded as measured, not tuned toward it.

### The plan's rule was insufficient, and only the repo measurement caught it

The plan says name-similarity nominates and resolved-module identity confirms. Implemented exactly,
that over-aggregated on the repo the plan itself cites, because real modules export heterogeneous
symbols: `@/lib/auth` exports the wrappers *and* `hashPassword`, `hashToken`, `validatePassword`.
Module recruitment produced a 9-member auth family holding three crypto utilities and an 89-member
validation family holding `bulkDeleteLinks` and `addDomainToVercel`. **All ten unit tests passed on
that version**, because synthetic fixture modules are homogeneous and real ones are not.

Confirmation is now per-kind:

- **auth** requires the call to *wrap* the handler — its source span strictly encloses a response,
  data-operation or request-input fact in the same file, in ≥2 files. On dub this separates
  perfectly: `withWorkspace` 181/183 files, `withAdmin` 33/33, versus `getSession`, `hashPassword`,
  `hashToken`, `validatePassword` at 0. It is span containment between two facts — it says *this call
  is the handler's wrapper* and nothing about ordering, reachability, or bypass.
- **rate limit and request validation** recruit nothing on module identity; members must be
  positively detected.

### The residual, disclosed not fixed

Recorded in `beta-claims.json` under `convention_family_aggregation.false_positive_behavior`: a
higher-order function exported from the family's own module joins regardless of intent — a logging or
error-handling wrapper living in the auth module is the shape. The wrapper test excludes point-call
utilities; it cannot tell two wrappers apart by purpose. No eval repo exhibits it today, and dub not
having such an export is luck, not design.

## Process notes worth keeping

**1. `cargo test --release` rebuilds the binary the CLI shells out to.** `PROTOCOL.md` §8 warns about
debug-vs-release; this is release-vs-release. A mutation battery running beside an onboarding loop
produced a plausible junk family on midday that vanished on a clean re-run, and I contaminated two
gate batteries the same way before I caught the pattern. **Never rebuild while a gate is running, and
never measure while a test run is in flight.** Worth adding to §8.

**2. `scripts/reclaim-disk.sh` tier 3 breaks the installed tree.** It runs `pnpm store prune`, and
pnpm's `node_modules` are links into that store, so the prune left every workspace package
unresolvable. The CLI still answered `--version` (which imports neither storage nor better-sqlite3),
so it presented as an engine failure for a full eval run. Recovered with
`pnpm install --recursive && pnpm build`. The script's comment calls tier 3 "network, not
correctness"; for pnpm that is wrong. Either drop the prune or have it print that a reinstall is now
required.

**3. Killing an eval harness mid-run leaves injected fixtures in the eval repos.** `midday` and
`openstatus` came back `CONTAMINATED_WORKTREE` with staged `drift-bench-*` and `drift-evasion-*`
routes. The harness catching this is the gate working. Reset with `git reset HEAD && git clean -fd`
on the affected path.

**4. BB-10's flake reproduced once, under load.** 3 of 16 failures with two eval harnesses saturating
the machine, then four clean runs once quiet. Second observation, consistent with resource pressure
over shared state. The assertions were not captured before the retry — that is the gap. BB-9's tests
now carry explicit 60s timeouts instead of riding vitest's 5s default, since they land at ~2s and
load eats the margin.

**5. Disk was the binding constraint for most of this run.** The eval harnesses hard-refuse under
5 GB and the machine sat at 3.7–4.6 GB, which blocked three gate attempts. It ended at 42 GB free.
If it tightens again, the reclaimable space is `~/Downloads` (46 GB at the time) and `~/Library`
(21 GB) — user data, not mine to touch.

## Verification discipline that paid off, and should be repeated

CV-1's independent verifier was told to falsify the claims, not confirm them, and it confirmed seven
defects — one of which (`F3`) made the accepted rate-limit family **strictly worse than the candidate
it superseded**: a helper id key derived from a prefix yielded `rate_limit_id` where the reader takes
`helper_id` with `?` inside a `filter_map`, so the family carried zero helpers and flagged every route
in scope including compliant ones. Live on two eval repos, and my own comment nearby asserted the
opposite.

Two of the seven were claims with **no test behind them** — deleting the `nominated` filter, which I
had commented as "load-bearing, not a formality", left 12 of 12 green. The mutation battery is what
found that, and it should be standard for any item claiming a red-check.

Also: red-check each fix *separately*. My first F1 regression test passed under its own mutation
because F2's fix already separated the modules involved, so it was silently testing F2.
