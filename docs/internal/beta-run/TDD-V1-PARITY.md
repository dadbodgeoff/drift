# TDD — v1 detection parity on Next.js (VP series)

**Base:** CV sprint completion (CV-2…CV-5 landed and verified — VP-1 rides the family/promotion
path CV builds). **Written:** 2026-08-04. **Scope decision by Geoffrey:** everything v1 displayed
that v3 should re-earn, on the existing TypeScript + Next.js wedge only — no new frameworks or
entrypoint kinds yet; scale comes after this is fully built out. Cortex stays out. The quarantined
flow-security tier (sensitive-field flow, CORS policy matching, SQL dataflow, guard *dominance*)
stays out — those wait on the AST/flow rebuild and are not part of parity.

**What "parity" means here, so it can't inflate:** v1 displayed eight capability categories users
touched: data-access, auth, validation, rate-limit, error handling, testing, placement/naming,
graph queries (reach/coupling), plus a status overview. Post-CV, v3 has the first, second and
fourth. VP is the remaining five plus the overview. v3 will never display "101 detectors" — the
endpoint is ~8–10 kinds each carrying coverage, evidence, exemplars, and an evasion cell.

**Standing lessons this TDD inherits as requirements, not suggestions:**
- **The real-repo measurement is part of each item's DoD, not a deferred gate.** CV-1's design
  rule passed 10/10 synthetic tests while producing an 89-member garbage family on dub; only the
  dub measurement caught it. Every VP item that infers something names its dub (and one other
  repo) measurement in its DoD.
- Negative controls before recall. Red-check with mutations that bite. Implementer ≠ verifier;
  the independent verification round (7 confirmed defects in CV-1) is standard for every item
  touching enforcement or persisted claims.
- No builds during a gate battery. `DRIFT_ENGINE_BIN` set explicitly in every measurement.
- Presence claims can promote; flow claims stay quarantined. If a test needs branch or ordering
  reasoning to pass, the kind is in the wrong tier.

---

## VP-1 · Request-validation facts — the extractor that was never written

**Why.** dub has **zero** `request_validation_called` facts — its eight per-symbol validation
candidates were name-matching with no positive evidence, which is why CV-1's honest validation
family count on dub was zero. The check-side machinery already consumes accepted validators
(`security_facts.rs:27` `accepted_validators`, `accepted_request_validator_for_call`), so this is
the CV pattern again: one half exists, the fact-emission half doesn't.

**Seam.** The scan-side fact extraction in `crates/drift-engine` (where `symbol_called` /
`request_input_read` are emitted — `request_input_read` works today, 277 facts on dub, so input
detection is solved; what's missing is the *validation-call* fact). Emit
`request_validation_called` when a known-shape validation call is applied: `<schema>.parse(x)` /
`.safeParse(x)`, or a call whose callee resolves into a module under a `zod`/schema import chain.
Record the callee symbol, the resolved schema module, and the span.

**Red — negative controls first:**
1. `JSON.parse(body)` emits nothing — `parse` on a non-schema receiver is the trap; the receiver
   must trace to a schema construction (`z.object`, imported schema symbol) or a resolved
   validator module.
2. A test file calling `schema.parse` outside route scope emits the fact (facts are neutral) but
   produces no route-scoped candidate — scope filtering stays downstream.
3. `.parse()` on a date library (`dayjs(x)`, `parseISO`) emits nothing (resolved-module check).
4. Recall: on dub, routes using `getWorkspaceUsersQuerySchema.parse(searchParams)` and
   `safeParse` shapes emit facts; measured count reported per repo (dub, cal.com) in the DoD.
5. With facts present, CV-1's family deriver forms a validation family on dub **with no deriver
   changes** — if the deriver needs modification, stop and record why.
6. New fact kind = ledger entry + schema bump + the migration-pin updates; `eval:determinism`
   re-run (fact emission ordering).

**DoD.** dub validation family exists with members that are actually validators; family coverage
measured and recorded (no target — this is discovery, record what's true). Promotion to
enforcement rides the CV-3(B) presence mode + a CV-4 matrix extension (renamed schema import,
barrel re-export of a schema, `safeParse`-result-unused as a **pinned non-catch** — result-use is
flow, not presence).

**Est.** ~2 agent-days.

---

## VP-2 · Error-handling / response-shape facts + family

**Why.** v1 displayed "Errors" as a category; v3 has nothing. dub's real convention is visible in
every route the agents copied: `DubApiError`, `handleAndReturnErrorResponse`, error-code enums.
The cron-agent trials showed agents replicate error handling from neighbors perfectly — so the
*enforcement* value is moderate, but packet/exemplar value is high and it's a display-parity
category.

**Seam.** New facts: `error_helper_called` (call resolving into the repo's error module family)
and `error_class_imported` (import of symbols resolving to modules that export Error subclasses —
extractor already parses class extends chains for exported_symbol facts; verify and reuse). Then
the CV-1 family deriver with a per-kind confirmation: **an error helper is called inside a catch
block or is the returned expression of one** — if catch-context isn't available as a fact, use
presence-only and record the weaker claim in the ledger; do NOT invent flow analysis for this.

**Red — negative controls first:**
1. `console.error` / a logging call does not join the family (module confirmation: must resolve
   to the repo's error module, not a global).
2. A repo with no error module (taxonomy-scale minimal repos) yields no family, with reason.
3. Recall: dub family = `DubApiError` + `handleAndReturnErrorResponse` (+ real siblings), measured
   coverage recorded. cal.com measured as the second repo.
4. Candidate statement is honest: "API routes appear to handle errors via the `@/lib/api/errors`
   family" — presence claim only.

**DoD.** Family candidate on dub with only genuine error helpers; exemplars in guidance carry it;
ledger entry with false-positive behavior (a helper re-exported from the error module joins
regardless of semantics).

**Est.** ~2–2.5 agent-days.

---

## VP-3 · Test intelligence — wire what's built

**Why.** v1 displayed "which tests cover this file" (`drift test-topology affected`). v3 has
`selectRelevantTests` exported from `@drift/query` and a `test_intelligence` packet field that
has returned `[]` since birth (now with an honest reason, post-BB-6). This is the cheapest
category on the board.

**Seam.** First audit step (the implementer verifies, the TDD does not assume): whether
`file_role_detected` ever emits a test role — dub's facts show only `api_route`-style roles, so
the extractor likely needs a `test_file` role (path + import heuristics: `*.test.*`, `*.spec.*`,
`__tests__/`, vitest/jest imports — path-based is fine and deterministic). Then feed
`selectRelevantTests` from the facts and populate `prepare`'s `test_intelligence` +
`guidance.relevant_tests` (≤3, byte budget holds).

**Red.**
1. Negative: a repo with no test files → `[]` with reason `no_test_files_detected`, never a
   guess.
2. A route file's packet names its sibling/nearest test files with the reason they're comparable
   (same role/dir distance — reuse the BB-5 exemplar ranking, don't invent a second one).
3. dub + drift's own repo measured (drift's own repo has 4 test locations by area — the
   role-conditioned case from the AK TDD; nearest-test must not cross areas).
4. Guidance byte assertion still ≤ 32,768 on 7/7.

**DoD.** `test_intelligence` non-empty on repos with tests; the AK-1-style question "does the
packet speak to 'test added'" flips from never to usually.

**Est.** ~1 agent-day.

---

## VP-4 · Module placement + naming — inference for a handler that already exists

**Why.** v1 displayed naming/structure patterns. v3 has `module_placement` as one of the six
**fully-enforced, never-inferred** agent-contract kinds (`run-check.ts:1285` handler, zero
contracts ever). Same shape as CV: build the inference half, change no handler.

**Seam.** New deriver in the candidate pipeline: for each file role, cluster existing files'
directories + filename shapes (`route.ts` under `app/api/**`, `*.test.ts` beside source or under
`test/`, lib helpers kebab-case under `lib/<area>/`). Emit `module_placement` **candidates**
carrying directory pattern + filename pattern + evidence counts per role. Human accepts →
existing handler enforces. Packet: `guidance` gains a `placement` block ("a new <role> goes in
<dir>, named <pattern> — N existing examples").

**Red — negative controls first (this is AK-6's controls, unchanged):**
1. A repo with genuinely inconsistent placement for a role reports low confidence / no candidate
   rather than picking one arbitrarily. Fixture: drift's own repo's tests (4 locations by area) —
   the right answer is role+area-conditioned or silence, never one global rule.
2. A role with <3 examples yields no candidate (floor recorded with rationale).
3. Recall: dub — api_route placement candidate matches `apps/web/app/api/**/route.ts` with ~490
   evidence files; accepted candidate enforces via the existing handler **unmodified** (e2e:
   a misplaced route file in a diff triggers the existing `module_placement` finding).
4. Determinism: clustering output stable across runs.

**DoD.** `selected_contracts` non-empty on dub for the first time (the AK-3 milestone, reached
through placement); placement guidance in the packet; no handler diffs.

**Est.** ~2–3 agent-days.

---

## VP-5 · Graph query commands — v1's sleeper features on v3's better graph

**Why.** v1 shipped `drift callgraph reach <file:line>` and users used it. v3 has strictly better
data (205k resolved edges on dub, `route_flows`, `reachable_data_access` computed every prepare)
and no commands over it.

**Seam.** Read-only CLI: `drift graph reach <file[:line]>` (what data-access does this file
transitively touch — walk existing edges), `drift graph deps <module>` (who imports this,
directly and via re-export chains), both `--json` + human. MCP read-only tool parity for `reach`
(agents want it; read_only surface, no policy change).

**Red.**
1. Reach on a dub invite route names `@/lib/prisma` via the resolved chain with the hop list —
   assert against a hand-verified fixture path.
2. Reach on a clean util names nothing (negative control — no speculative edges).
3. A file with parser gaps in its chain reports the gap honestly in the output (the EW-3 shape:
   what it couldn't see, stated).
4. Latency: both commands < 2s on dub (indexed reads, no scan — refuse if stored scan is stale
   rather than silently serving old graph, consistent with existing freshness machinery).

**DoD.** Both commands live, MCP parity for reach, README examples.

**Est.** ~1.5 agent-days.

---

## VP-6 · Coupling / cycles

**Why.** v1's `drift coupling cycles`. Data exists (`module_dependents`, 15k rows on dub).

**Seam.** Tarjan SCC over the module graph in `@drift/query`; `drift graph cycles` command;
report cycles with the edge evidence. **Display only for now** — no candidate kind, no
enforcement (a "no new cycles" convention is a later, separate decision).

**Red.** 1. A DAG repo reports zero cycles (negative). 2. A fixture with a known 3-module cycle
reports exactly it with its edges. 3. dub/cal.com measured and recorded — whatever is true. 4.
< 2s on dub.

**Est.** ~1 agent-day.

---

## VP-7 · The status surface — honest breadth, displayed

**Why.** v1's `drift status` said "Patterns: 47 discovered, 12 approved. Health Score: 85." The
health score was vibes, but the *display shape* was right: one screen that says what Drift knows
here. v3's equivalent today is a plumbing dump.

**Seam.** `drift status` (extend the existing scan-status command): accepted conventions with
kind, mode, coverage, member count; families discovered awaiting review (with the accept
command); baselined count; what Drift has no opinion on (the guidance `not_covered` line);
staleness. No composite score — coverage numbers per convention, never a blended vibe number.

**Red.** 1. dub post-CV+VP shows: N accepted (each with coverage), M candidates awaiting review,
397 baselined, not-covered line. 2. Empty repo shows the honest zero with next commands. 3.
Output is ≤ one screen (assert line count) — the BB-3 disclosure lesson: one line per fact.

**Est.** ~0.5–1 agent-day.

---

## Order and dependencies

```
prerequisite: CV-2…CV-5 landed (families promotable, guidance live, matrix pattern established)

VP-1 ──> (validation family rides CV path)     the only item with a hard CV dependency
VP-2                                            independent after CV
VP-3 ── VP-5 ── VP-6                            independent of each other, read-only, parallelizable
VP-4                                            independent; the deepest item — time-box like AK-4
VP-7                                            last — it displays what everything else built
```

Total ≈ **10–12 agent-days**. Suggested split: sprint A = VP-1 + VP-3 + VP-5 (facts + wiring +
queries, ~4.5 days); sprint B = VP-2 + VP-4 + VP-6 + VP-7 (~6 days). Independent verification
round after each sprint, not each item, except VP-1 and VP-4 which touch persisted claims and get
their own round.

## Gating (decided by Geoffrey — do not re-derive per item)

Per change: **unit tests only.** Per item close: **that item's own real-repo DoD probe only** —
one command, ~1–2 min (the CV-1 lesson: this probe is not a regression check, it is the only
instrument that detects the item's own failure mode; it is never deferred). Per phase end
(sprint A close, sprint B close): **the full battery exactly once** — `eval:external` 7/7,
`eval:evasion`, `eval:bench`, `eval:determinism`, `beta:proof` — on a frozen tree with zero
builds during the run, overlapped with log/doc writing, never idle-watched. If the phase battery
regresses: `git bisect` across the phase's per-item commits (≤2 steps for a 4-item phase) before
any diagnosis by reasoning. Exceptions: VP-1 and VP-2 add fact kinds, so `eval:determinism` joins
their item close (fact-ordering is exactly what it checks); VP-4's acceptance e2e runs at its own
item close since it exercises the enforcement path.

## What this deliberately leaves on the table (so nobody mistakes it for forgotten)

- **Entrypoint breadth beyond Next.js** (tRPC, Express, server actions) — Geoffrey's explicit
  sequencing: fully build out Next.js first, then scale.
- **Flow-tier security** (dominance, sensitive-field flow, SQL dataflow) — quarantined pending
  the AST rebuild; the presence tier (CV) is the honest ceiling until then.
- **AK-7 stated-conventions reader** (CLAUDE.md → `stated_not_verified`) — the cheapest perceived-
  breadth win on the board (~25 stated entries on cal.com in ~2 days), but its extraction design
  is unresolved (prose→entries) and it is display, not parsing. Decide separately.
- **Cortex** — out by decision.
- **Co-change conventions (AK-4)** — highest-value non-v1 kind; belongs to the AK sprint, not
  parity.

After VP, the v1-parity scoreboard on a Next.js repo reads: data-access ✓ auth ✓ rate-limit ✓
validation ✓ errors ✓ tests ✓ placement ✓ reach/coupling ✓ status ✓ — every one measured,
evidenced, and enforceable where presence semantics allow. That is v1's display, minus its lies.
