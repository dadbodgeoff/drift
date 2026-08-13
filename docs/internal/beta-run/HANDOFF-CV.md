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

---

# Addendum, 2026-08-05: CV-2 through CV-5, and the VP precondition

Head at the close of this session is recorded in the final commit of the run; `git log --oneline -14`
covers everything below. Nothing pushed.

## What landed after the original handoff

| Item | Status | Commit |
|---|---|---|
| Process items (PROTOCOL §8, reclaim tier 3) | DONE | `e63bcf33` |
| BB-11 + 12 stale schema pins CV-1 left | DONE | `6f8a85d0` |
| CV-2 | DONE | `88c96637` |
| CV-3 (option B) | DONE | `c2325cdb` |
| CV-4 shapes + precision/recall harness | DONE | `58e16c8c` |
| CV-4b harness parameterized over kinds | DONE | this run |
| CV-5 acceptance floor (pre-registered `34a82807`) | DONE | `bc179480` |
| UQ-1 ticketed | DONE | `effea695` |
| CV-5 baseline gap diagnosed | OPEN | `a75d73ec` |

Measured: dub auth family **0.7731** coverage over its own 357-route flavour scope (from 0.0324
per-symbol); **accepted_count 2** on dub, matching the pre-registration exactly; precision and recall
**1.0000/1.0000** for auth, rate-limit and data-access, 50 compliant / 50 violating each.

## The one thing blocking CV-5's close

`docs/beta-run/CV-5-BASELINE-GAP.md`. `runFullRepoCheck` evaluates only
`api_route_no_direct_data_access`, so an auto-accepted family's pre-existing violations are never
baselined and the user's first check reports ~81 of them as new. Two candidate fixes are written up
with a recommendation; shape B changes what seeds the baseline on all seven repos, so it needs a
battery before and after and a mechanism explanation per the BB-8 rule.

CV-5's other pieces, in order after that: the presence branch in `instructionForConvention`, per-kind
`external-eval` columns with BB-8 cell-liveness from birth, and the guidance byte budget asserted 7/7
rather than measured on dub only (dub is 6,783 of 32,768 with two accepted conventions).

Red #1's exemplar requirement needs **no work** — see the correction below.

## For the VP handoff specifically

**Every prior-art citation in VP must distinguish a repo asset from a session artifact.** This sprint
hit three stale premises, and the third was of a new kind:

1. CV-2 — "the facts already distinguish cron routes." They did not; nothing emitted a flavour.
2. CV-5 — "Accepted 4 conventions." Unreachable; dub emits zero `request_validation_called` facts.
3. CV-4 — "the full 200-fixture precision/recall harness" with data-access at 1.000/1.000. The
   **measurement was real** but it was a session artifact of the 2026-08-03 benchmark, not repo
   infrastructure, so there was nothing to extend. This is the variant worth guarding against: the
   citation was not false, it was mislabelled as an asset.

The rule for VP: before an item depends on prior art, check that the artifact exists **in the repo**
at the stated path. A number in a past session's scrollback, a bench write-up, or a commit message is
not infrastructure, and an item that plans to "extend" one will discover that at implementation time.

`scripts/presence-precision-recall.mjs` (`pnpm eval:presence`) is now the committed home for the
per-kind precision/recall numbers, so that particular citation is an asset from here on.

**UQ-1 gates any VP work that touches the quarantined tier.** `docs/architecture/security-heuristic-audit.md`
carries it: the phase5 glob matcher no-ops on default create-next-app layouts, so no promotion decision
for a phase5/phase6 kind may be made until it is fixed and re-measured on `taxonomy`.

## A correction, because it was used to argue priority

An earlier report in this session said the accepted auth family shipped guidance with **zero
exemplars**, flagged as the Q9/B1 shape that made a trial agent defect. **That was a measurement
error**: the reader used the key `exemplars` and the field is `conforming_examples`. Both accepted
conventions on dub carry three, and `will_this_block` is present too (the same report looked for
`will_block`). CV-5 red #1's exemplar requirement was already satisfied and needed no work; only the
migration sentence is missing, and that is downstream of the baseline gap.

---

# Second addendum, 2026-08-06: CV-5 closed out

CV-1 through CV-4 are DONE. CV-5 is DONE_PARTIAL with two named gaps, both performance or
plumbing rather than correctness.

## CV-5, item by item against Geoffrey's ordering

| Item | Status | Commit |
|---|---|---|
| 1 — exemplar integrity spans kinds | DONE | `638f8e6d` |
| 2 — convention-scope the harness | DONE | `e61ed626` |
| 3 — seed baseline from the real check path | DONE, **conditional** | `a003ff22` |
| 4 — flip auto-acceptance to default-on | **BLOCKED** | — |
| 5 — the small pieces | DONE except per-kind eval columns | `71738620` |

## What blocks item 4, precisely

Item 3 works: dub with `--accept-families` baselines **484** (data-access 397 unchanged, auth
family 87), and the first check afterwards is `pass` with all 484 `pre_existing` and **zero new**.
The decision-C break is closed.

But the unified pass is **4–9× slower at onboarding** — cal.com 30.7s → 115.9s against a 92s
ceiling, papermark 8s → 73.3s against 30s. The duplication was cheap because it did less: the full
check runs an engine pass per convention plus graph, exemplar and readiness work a baseline seed
does not need.

So item 3 is conditional — the unified pass runs only when a presence family was accepted. That
keeps the default fast and green, but it means item 4's precondition ("an accepted family does not
flood first check") holds only on the opt-in path. **Flipping the default would impose the 4–9×
cost on every user and breach two ceilings.** Raising the ceilings to make it pass would be fitting
the gate to the code.

Item 4 therefore waits on one thing: making the full check fast enough to run unconditionally at
onboarding. That is a performance item. When it lands, the `BASELINE_CHANGE` mechanism table is
already written in `CV-5-BASELINE-GAP.md` — dub findings 2→7, exemplars 6→21, guidance 5,501→6,650,
baselined 397→484.

## Remaining work, complete list

1. **Make the onboarding check fast enough to be unconditional**, then flip the default (item 4).
2. **Per-kind eval columns with BB-8 cell-liveness** — the one piece of item 5 not addressed.
3. **UQ-1** — `docs/architecture/security-heuristic-audit.md`. Gates any phase5/phase6 promotion.

## A pattern worth carrying into VP

Three times in this session, checking before building showed the work was already there or already
fixed: the exemplar count (I had misread the field name), the 7/7 guidance byte assertion (BB-6 built
it), and the migration sentence (item 3 fixed it downstream). **Two of those I had already reported
to Geoffrey as defects**, and one of them was used to argue an item's priority.

Combined with the three stale premises in the TDD itself, the rule for VP is the same in both
directions: **verify the claim against a command's output before acting on it — whether the claim is
that something is missing or that something exists.** A misread field name and a mislabelled session
artifact produce the same wasted work.

