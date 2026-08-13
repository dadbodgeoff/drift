# TDD — convention families (CV series): re-earning v1's detection surface

**Base:** `30e2e036` + the BB-8…BB-11 audit fixes (run those first — CV verification depends on a
live `eval:external` baselined cell). **Written:** 2026-08-04 after a source audit of the seams
named below. Scope decision by Geoffrey: conventions parsing/detection only — no Cortex analog.

**The problem, measured.** dub: 341 of 488 routes (70%) use a member of the auth-wrapper family,
but inference emits **one candidate per helper symbol** (`candidate_command.rs:422` —
`grouped_route_facts(..., "symbol_called")` filtered per-symbol), so the strongest shard
(`withSession`, 20 files, 3.9% coverage) dies below the 0.2 coverage floor while the repo's
strongest real convention is never even hypothesized. Same story ×8 for request validation.
Meanwhile the enforcement handlers for these kinds **already exist and are reachable**
(`run-check.ts:2567-2573`) — they simply never receive an accepted convention. This sprint builds
the aggregation that lets the detections that already happen become conventions that already
enforce.

**What this is NOT.** Not a rebuild of the security heuristics' *semantics* (guard dominance,
branch analysis — that stays quarantined per `docs/architecture/security-heuristic-audit.md`).
CV promotes only **presence-of-family-member** claims, which are exactly as deterministic as the
shipped data-access kind: an import/call either resolves or it doesn't. Anything requiring
control-flow reasoning stays experimental. Hold this line in review — it is the difference
between re-earning v1's surface and re-shipping its theater.

**Red-first throughout. Negative controls before recall, without exception — an over-aggregating
family learner is worse than the fragmentation it replaces, because it gets accepted and blocks.**

---

## CV-1 · Family aggregation in the candidate deriver `[the mechanism]`

**Why.** One mechanism recovers auth, validation, and rate-limit at once: aggregate same-kind
per-symbol candidates into a single candidate whose matcher is a **disjunction** —
`required_calls_any_of: ["withWorkspace", "withSession", "withAdmin", …]` — with coverage counted
as the union of files satisfied by any member.

**Seam.** `crates/drift-engine/src/candidate_command.rs` — the per-symbol loops at `:422`
(auth), `:506`/`:998` (validation), `:764` (rate-limit), and `security_candidate_from_facts`.
The per-symbol candidates remain (they carry the per-member evidence); the family candidate is
derived FROM them, one per kind, and is what gets surfaced for acceptance.

**Design decisions, made here:**
- Family membership = symbols whose per-symbol candidates share a kind AND whose resolved import
  sources cluster in the same module family (e.g., all resolve under `@/lib/auth*` /
  `apps/web/lib/auth/`). Name-similarity alone (`is_auth_candidate_symbol`'s substring logic at
  `:1111`) nominates; **resolved-module clustering confirms**. A symbol that name-matches but
  resolves outside every member's module family is excluded — this is the F4 lesson (substring
  matching nominated `isPrismaObj`) applied prophylactically.
- The family candidate records its members with per-member evidence counts, so `conventions show`
  can answer "why is `verifyQstashSignature` in this family."

**Red — negative controls first:**
1. **Two unrelated helpers do not merge.** Fixture: routes calling `withSession` (resolves to
   `lib/auth`) and routes calling `withCache` (resolves to `lib/cache`, name-matches nothing) →
   no shared family; `withCache` appears in no auth candidate.
2. **A lookalike symbol from a foreign module is excluded.** A helper named `withAuthorHat`
   resolving to `lib/blog/` does not join the auth family despite the substring.
3. **A repo with a single helper produces a single-member family identical in effect to today's
   per-symbol candidate** — no behavior change on already-passing fixtures (pin taxonomy's
   current candidate set byte-for-byte).
4. Recall: on dub-shaped fixtures, ONE `api_route_requires_auth_helper` family candidate exists
   with ≥5 members and coverage computed on the union. On the real dub repo (eval, not unit):
   family coverage ≥ 0.6 where per-symbol best was 0.039.
5. Determinism: member order is sorted; candidate id is stable across runs (`eval:determinism`).

**DoD.** Family candidates on dub for auth + validation + rate-limit, each with union coverage,
member list, and per-member evidence. Ledger entry for the aggregation claim with its evidencing
test. Per-symbol candidates still present but marked `superseded_by: <family_id>`.

---

## CV-2 · Role-conditioned scope: cron routes are not session routes

**Why.** dub's union says 341/488 — the missing 147 are largely cron/webhook routes that
authenticate by **signature** (`verifyQstashSignature`), not session. One global denominator
either drags family confidence down or, worse, accepts a family that then flags every cron route
as unauthenticated. The scope must condition on route flavor.

**Seam.** The facts already distinguish these: `route_declared` + path structure
(`**/api/cron/**`, `**/api/webhooks/**`) and the existing `file_role_detected` machinery.
Candidate scoring in `candidate_command.rs` gains per-flavor denominators; the emitted family
matcher gains `applies_to: {route_flavors: [...]}` mirroring the existing
`applies_to_file_roles` shape that `required_change_checks` already uses (`run-check.ts:1740`).

**Red — negative controls first:**
1. A repo where cron routes uniformly use signature auth and session routes uniformly use
   wrappers yields TWO scoped families (or one family with two flavor clauses) — and a cron route
   without a session wrapper is NOT a violation of the session family.
2. A repo with no flavor signal (no cron/webhook paths) yields one unconditioned family —
   the conditioning must not manufacture flavors from noise.
3. Recall: dub-shaped fixture — session family covers app routes, signature family covers cron;
   combined union accounts for ≥ 90% of the 341 measured wrapper users.
4. The flavor predicate lives in `@drift/core` beside `conventionScopeFiles` — NOT as a second
   glob engine in the deriver (the BB-11 lesson; one scope predicate in the product).

**DoD.** On dub: no cron route is flagged by the session family; flavor assignment visible in
`conventions show`.

---

## CV-3 · Promotion path: family kinds leave quarantine only through the new evidence standard

**Why.** The 18 candidates are hidden behind `--experimental-security` for a documented reason.
CV must not bulk-unhide them; it must define what promotion requires, promote the three
presence-kinds that meet it, and leave the rest quarantined.

**Seam.** `packages/cli/src/commands/conventions.ts:76-120` (the quarantine filter),
`createDriftCapabilities()` (`packages/core/src/capabilities.ts` — `convention_kinds` gains the
promoted kinds), and the claims ledger.

**Promotion standard, explicit:** a kind leaves quarantine when (a) its matcher is
presence/resolution-only (no control-flow claims), (b) it has an evasion-matrix cell with
negative controls, (c) it has a precision/recall harness cell (CV-5), and (d) its ledger entry
names its false-positive behavior. Kinds that fail (a) — guard *dominance*, sensitive-field
*flow* — stay experimental regardless of demand.

**Red.**
1. `conventions list` (no flags) shows family candidates for
   `api_route_requires_auth_helper`, `api_route_requires_request_validation`,
   `api_route_requires_rate_limit` once promoted; `sensitive_response_fields`, `cors_policy`,
   `raw_sql` remain hidden. Assert both directions.
2. `capabilities --json` `supported_wedge.convention_kinds` lists exactly the promoted kinds —
   the EW-10 validator must fail if a promoted kind lacks a ledger entry + evidencing test.
3. Acceptance of a promoted family flows through the existing accept → contract → enforcement
   path with **no changes to the handlers at `run-check.ts:2567+`** — proving, as with the AK
   plan's §0, that inference was the only missing half. If a handler needs modification, stop
   and record why before proceeding.
4. `beta:proof` green (this touches the capabilities manifest, which it pins).

**DoD.** Three kinds promoted, fifteen still quarantined, ledger complete, no handler diffs.

---

## CV-4 · Enforcement verification: the required-wrapper matcher under attack

**Why.** The data-access kind earned trust through the evasion matrix and the 200-fixture
harness. The family kinds get the same treatment BEFORE any repo accepts them in block mode —
"required call present" has different evasion shapes than "forbidden import absent."

**Red — this IS the item; the shapes to pin:**
1. **Present-but-renamed:** `import { withWorkspace as w } from "@/lib/auth"; export const GET =
   w(...)` → satisfied (resolution, not string).
2. **Re-exported wrapper:** wrapper imported through a barrel → satisfied (the E-5 chain logic,
   reused).
3. **Wrong-family member:** a cron-flavored route using `withSession` where flavor requires
   signature auth → violation with a message naming the expected family for that flavor.
4. **Absent entirely** → violation; **absent but file outside scope flavor** → silent.
5. **Negative controls:** a route importing the wrapper but never calling it (import-only) —
   decide and pin: presence = *call* fact (`symbol_called`), not import. A test-file calling
   wrappers outside route scope → silent.
6. Run the full 200-fixture precision/recall harness extended with 50 wrapper-present /
   50 wrapper-absent fixtures per promoted kind. Target: 1.000/1.000 like the data-access kind;
   record whatever is measured either way, per repo.

**DoD.** Evasion cells green 7/7 repos; measured precision/recall published in the eval baseline.

---

## CV-5 · Eval + packet integration: the new kinds are visible, honest, and budgeted

**Why.** Three new accepted kinds must show up in `guidance` with exemplars and enforcement
reality (the Q19 lesson — statements don't persuade agents, enforcement reality does), without
blowing BB-6's byte budget.

**Red.**
1. `guidance.conventions` on dub carries all accepted families, each with mode, will-block,
   migration sentence (per-kind baselined counts), and ≤3 conforming exemplars — where
   "conforming" for a required-wrapper kind means *calls a family member* and has no open finding
   (extend the BB-5 exemplar predicate; its integrity property now spans kinds).
2. **Guidance stays ≤ 32,768 bytes on 7/7 repos with 4 accepted conventions.** If it doesn't fit,
   trim exemplar count per convention before anything else, and record the decision.
3. `external-eval` gains per-kind columns (candidates, accepted, coverage, exemplars) with the
   BB-8 cell-liveness rule applied from birth: a kind whose coverage reads 0 on a repo where the
   family measurably exists fails the suite.
4. Onboarding disclosure (BB-3) now names each accepted convention and mode — verify the sentence
   scales to 4 conventions without becoming a wall (one line per convention).

**DoD.** dub onboarding: "Accepted 4 conventions" with per-kind modes; guidance within budget;
per-kind eval columns live.

---

## Order

```
CV-1 ──> CV-2 ──> CV-3 ──> CV-4 ──> CV-5      strictly serial: each consumes the last's output
```

The serial shape is deliberate — this sprint has one idea (families), and its risk is
over-aggregation, which each stage's negative controls check at a different level. Do not
parallelize CV-1/CV-2; a wrong merge in CV-1 invalidates everything after it.

Estimated: CV-1 ≈ 2 agent-days (Rust, the real work), CV-2 ≈ 1, CV-3 ≈ 0.5, CV-4 ≈ 1.5,
CV-5 ≈ 1. Total ≈ 6 agent-days.

## Standing rules

Carried in full from TDD-BETA-BLOCKERS.md and the BB audit, plus:
- **Name-similarity nominates; resolved-module identity confirms.** No family member joins on a
  substring alone. (F4's ghost — it haunts every aggregation design.)
- **Presence claims promote; flow claims stay quarantined.** If a test needs to reason about
  branches or ordering to pass, the kind is in the wrong tier.
- A family kind accepted in block mode on any eval repo requires its CV-4 cells green FIRST —
  enforcement without its evasion matrix is the v1 pattern with better branding.
