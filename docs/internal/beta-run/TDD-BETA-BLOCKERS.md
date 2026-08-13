# TDD — beta blockers (BB series)

**Base:** `b5c3c230` (= code at `7123160b`, post EW-1…EW-10). **Written:** 2026-08-03, after a
source-level audit of every seam named below *and a live reproduction (or falsification) of every
bug*. Every file:line was read at this sha; every behavioral claim below was executed against
`~/drift-falsification/repos` with `DRIFT_ENGINE_BIN` pointed at a fresh release build.

**Scope.** Exactly the set standing between this tree and an open beta a stranger can be handed.
The AK knowledge tier, P-1 delta protocol, and family-aggregation inference are explicitly out —
they are the fast-follow, not the gate. Two decisions remain human-only and appear in no item
below: the `driftdetect@1.0.0-beta` npm identity, and win32 verify-or-mark-unsupported.

**Red-first throughout.** Write the failing test, watch it fail for the stated reason, then
implement. Where an item has a negative control, it comes **before** the recall test.

---

## Corrections recorded before the items (so the items are honest)

1. **The "staged-file silent miss" from the 2026-08-03 rev-1 report DOES NOT REPRODUCE at this
   sha.** Re-run under instrumentation: staged new violating file + `--diff HEAD` → exit 2, finding
   attributed, file named. The rev-1 observation was almost certainly contaminated by the same
   debug-fallback session state that produced the retracted latency numbers. What *does* reproduce
   is narrower and still real — see BB-1.
2. **D-2 (release-matrix validator) is already fixed at this sha.** Verified by execution:
   3 fatals printed, summary honest ("3 of 5 verified"), **exit 1**. The earlier "still open" note
   was recorded against `5b8a64b`, before `f27c1d9e` landed. No item needed. (My own first
   re-check read `tail`'s exit code instead of node's — the kind of harness error the standing
   rules exist for. Verified properly before writing this.)
3. **The debug-fallback confound is itself the strongest argument for BB-2.** A careful adversarial
   evaluator lost half a session to it; beta strangers will lose less time and more goodwill.

---

## BB-1 · A check that checked nothing must be distinguishable from a clean check

**Why.** Verified at this sha: clean tree + `--diff HEAD` → `status: "pass"`, exit 0,
`changed_file_count: 0`. The count *is* in both outputs (JSON field; human line
`Affected: 0 files`), but the **status and exit code are identical to a real pass**. A CI job or
hook wired with a wrong diff spec is green forever, and nothing machine-readable distinguishes
"nothing violated" from "nothing examined." For a product whose exit-code contract is its brand
(0/2/3), this is the missing fourth state, and it is exactly the class of silent-green the EW
sprint spent itself killing elsewhere.

**Seam.** `packages/cli/src/check/diff.ts` (range → `ParsedDiff`; `:140` returns
`{files, deletedFiles}`) and `packages/cli/src/check/run-check.ts` where `status` and the exit code
are computed. The counts already flow; only the outcome logic changes.

**Design decision, made here so the tests are unambiguous:** empty scope is a **refusal (exit 3)**,
not a warning — fail-closed is the house style, and a wrong `--diff` spec is a misconfiguration,
not a verdict. `CHECK_EXIT_REFUSED = 3` already exists (`run-check.ts:49`) with precedent at
`:203`.

**Red — the negative control first, because it is the trap:**
1. A diff containing **only deletions** (`files: []`, `deletedFiles: ["x.ts"]`) must **NOT**
   refuse — deleting code is a legitimate change with a legitimately empty check scope. It passes,
   and the human output says why: `Checked 0 files (1 deleted file skipped)`.
2. `files: []` AND `deletedFiles: []` → exit 3, `error.type: "refusal"`,
   `failure.code: "empty_diff_scope"`, remediation naming the likely causes (wrong range; nothing
   staged; use `--diff-file` for working-tree changes) — the same remediation quality as the
   shallow-clone refusal at `diff.ts:48`.
3. A one-file diff behaves exactly as today (pin exit 2 on a violating file in block mode — the
   existing behavior must not wobble).
4. Human format prints `Checked N files` on every run, not only on empty ones.
5. `eval:external` re-run: the refusal must not fire on any harness cell (every cell has a
   non-empty diff by construction — if one refuses, the harness had a latent empty-diff bug and
   this test just found it; investigate before suppressing).

**DoD.** All five green. `pnpm beta:proof` green. The docs' exit-code table gains the
`empty_diff_scope` refusal row.

---

## BB-2 · Engine provenance is reported, and the debug fallback is loud

**Why.** `resolveRustEngineCommand` (`packages/cli/src/engine/rust-engine.ts:105-132`) resolves, in
order: `DRIFT_ENGINE_BIN` → **`cargo run` from any enclosing cargo workspace** → packaged binary.
The middle branch runs a **debug** build silently. Verified consequence: check timings inflate
~2.7× (7.88s → 22.9s measured), while `fallback_status` reports `engine_source: "rust",
fallback_used: false` — technically true, materially misleading. The `source` discriminant
(`:14`, `"env_override" | "packaged_optional_dependency" | "workspace_cargo"`) exists and is
propagated nowhere.

**Seam.** `rust-engine.ts` (already computes `source`);
`packages/cli/src/engine/collect-scan-data.ts` (spawn site — thread it through);
`run-check.ts:719` (`fallback_status` assembly). For build profile: the engine itself is the only
honest source — add a `build_profile` field to its version/handshake output via
`cfg!(debug_assertions)` in `crates/drift-engine/src/main.rs`; never infer profile from path names.

**Red.**
1. `fallback_status` gains `engine_resolution` (the enum) and `engine_build_profile`
   (`"release" | "debug"`). With `DRIFT_ENGINE_BIN` → `env_override`; unset inside the workspace →
   `workspace_cargo`.
2. **The loud part:** `workspace_cargo` resolution, or `engine_build_profile: "debug"` by any
   route, prints one stderr line on every command that spawns the engine:
   `warning: drift-engine resolved via cargo run (debug build) — timings are not representative;
   set DRIFT_ENGINE_BIN for measurements.` Assert on captured stderr.
3. Negative control: packaged/env-override release resolution prints **nothing** — no warning
   fatigue.
4. `scripts/beta-bench.mjs` and `prepare-quality-eval.mjs` refuse to record results when the
   handshake reports `debug` — the 2026-08-03 confound becomes structurally unrepeatable.
5. MCP parity: the new fields appear in `get_task_preflight`'s scan status (the EW-6 lesson —
   parity gates fail otherwise).

**DoD.** A benchmark harness pointed at a debug engine cannot produce a recorded number. All eval
suites green.

---

## BB-3 · `--accept-defaults` says what it decided

**Why.** Verified: dub's default acceptance lands `enforcement_mode: "warn"` (397 pre-existing
violations → coverage-direction logic), cal.com's lands `"block"` — from
`baseline_coverage_direction` at `crates/drift-engine/src/candidate_command.rs:134-166`. The
`start` output (`packages/cli/src/commands/start.ts:210`) prints the identical
`"Accepted default convention."` either way. A dub user who believes they installed a gate
installed a suggestion box; ten agent trials (Q9/Q19, 2026-08-03) show even *agents* read warn
mode as "not a real rule." This one line is the cheapest behavior-changing fix in the product.

**Seam.** `start.ts:94-115` (acceptance already holds the accepted convention object, including
mode and severity) and the summary block near `:210`. JSON output: the `start --json` payload
gains the same fields.

**Red.**
1. Warn-mode acceptance prints:
   `Accepted "api_route_no_direct_data_access" in WARN mode (397 existing violations baselined —
   new violations will be reported but will NOT block).` followed by the exact
   `drift conventions accept … --mode block --confirm` command to upgrade. Assert the mode word,
   the count, and the upgrade command are all present.
2. Block-mode acceptance prints the block sentence (`new violations exit 2`) and no upgrade
   command.
3. The mode decision itself is **unchanged** — pin one warn-shaped and one block-shaped fixture so
   this item cannot silently alter `baseline_coverage_direction` (the T100 regression lesson:
   output changes and threshold changes must be separable in review).
4. `start --json` carries `accepted: {mode, severity, baselined_count, upgrade_command}`.

**DoD.** Both fixtures assert their full sentence. No candidate-scoring test changes in the diff —
if one does, the item was implemented at the wrong seam.

---

## BB-4 · Contract liveness: a forbidden import that resolves to nothing is a warning, not a silence

**Why.** `forbiddenModuleFiles_` (`packages/cli/src/check/run-check.ts:2519`) derives forbidden
module identity from the repo's resolved import edges for the contract's `forbidden_imports`
specifiers, falling back to specifier-string matching when resolution yields nothing. Consequence,
from the matcher's own logic: rename `apps/web/lib/prisma` → `apps/web/lib/database` (updating all
imports, as any refactor would) and the accepted convention **matches nothing forever** — old
specifiers no longer appear as strings and no longer resolve, so enforcement evaporates with
`status: pass` and no signal. This is the enforcement-integrity class of bug (a cousin of the
kill-switch): the gate reports green while its trigger has been unplugged.

**Seam.** The same derivation site (`run-check.ts:2519` and its callers), plus `check` summary
assembly for the new warning, plus `semantic_coverage`/readiness so the degradation is visible to
agents, not only humans.

**Red — negative controls first, this warning must not cry wolf:**
1. Healthy repo (specifiers resolve, violations exist): no staleness warning. Pin on dub fixture.
2. A specifier that resolves but currently has zero violators: no warning — absence of violations
   is success, not staleness.
3. **The liveness probe:** fixture repo with an accepted contract; `git mv` the data module and
   rewrite all imports; add a new route importing the *renamed* module directly. Today (pin it
   first): 0 findings, pass, silence. Required: the check emits
   `contract_staleness: [{specifier: "@/lib/prisma", resolved_modules: 0, string_matches: 0}]`,
   the summary carries a visible warning naming the dead specifier and the re-derive command, and
   `convention_coverage`-style reporting marks the kind degraded.
4. Staleness does **not** change the exit code by itself (a removed data layer is a legitimate
   refactor; blocking would be a false positive) — but a `--strict-contract` flag exists for CI
   users who want exit 3 on a dead contract, tested both ways.
5. Determinism: the staleness computation is derived from the same fact set as the check —
   re-run `eval:determinism`.

**DoD.** The rename fixture flips from silent-pass to warned-pass (or refused under
`--strict-contract`). Negative controls green **before** the probe test is written. Ledger entry
for the new reporting class with its evidencing test (EW-10 discipline).

---

## BB-5 · Conforming exemplars and the migration sentence — the persuasion layer

**Why.** This is the empirically highest-leverage item in the set. In controlled trials
(2026-08-03): unguided agents violated the data-access rule 7/7; agents given the convention
*statement* conformed 2/3; and in two separate experiments an agent **read the cited files, found
they violate the rule themselves, and deliberately defected** — one writing "the preflight's claim
doesn't hold up against the actual codebase." A second trial given the honest warn-mode packet used
the findings summary as *evidence against* the rule. Agents comply with perceived enforcement
reality, not statements. Two payload changes encode that reality: examples that actually conform,
and one sentence explaining why the 397 violations around them don't count as precedent.

**Seam.** Finding message assembly at `run-check.ts:101-103` (and the finding payload where
evidence_refs attach); `prepare.ts` conventions block; exemplar source = files matching the
convention's scope globs + `file_role` with **zero open findings** for that convention — all
queryable from `findings` + `file_role_detected` facts already in the DB.

**Red — the integrity invariant first, because it is easy to violate by accident:**
1. **An exemplar never has an open finding against the convention it exemplifies.** Property-style
   test: for every emitted exemplar, assert zero open findings. Build a fixture where the
   nearest-by-path candidates ARE violators (dub's invite routes are exactly this shape) and assert
   they are skipped in favor of farther conforming files. This is AK-5's red test 2; the B1
   defection is its justification.
2. Negative control: a repo where **no** conforming file exists in scope emits
   `conforming_examples: []` with reason `"no_conforming_examples"` — never a violator, never a
   file from outside the scope.
3. Findings and packet convention entries carry up to 3 `conforming_examples`, selected
   deterministically (stable sort: same role → shallowest path distance → lexicographic).
   Re-run `eval:determinism`.
4. When `baseline_active_count > 0`, both the finding message and the packet rationale carry the
   migration sentence:
   `397 existing violations are baselined and do not block; new code is held to this rule.` with
   live counts. When zero, the sentence is absent (no boilerplate).
5. Rationale field splits `derivation` (how Drift found it — today's text) from `reason`
   (why the repo holds it, defaulting to the delegation rationale for this kind) — the AK-8 shape,
   scoped here to the one accepted kind only.
6. Packet-budget guard: with exemplars added, the conventions block must not regrow an
   evidence-dump — assert serialized bytes for the conventions entry < 4 KB (the EW-8 lesson:
   only byte assertions force real fixes).

**DoD.** The Q19 replay: re-run the packet-usage agent trial prompt against the new packet extract
and record the delta (this is an eval, not a gate — record, don't assert; models vary). Exemplar
integrity property green on all 7 eval repos.

---

## BB-6 · The packet goes on a diet: one `guidance` view an agent can eat

**Why.** Measured composition of the 1,135,517-byte dub packet: `parser_gaps` 358,538 B (639 full
records), `selected_conventions.evidence_refs` 186,252 B (all 397 findings), `findings` 94,486 B
(**the same 397 again**), `graph_context` 167,801 B. The agent-usage trial: 2 of 9 sections used;
`semantic_coverage`, `parser_gaps`, `route_flows`, `risky_areas` all dismissed as noise by the
consumer they exist for. The useful core measured ~25–40 KB. This is a filtering job, not a
compression job.

**Seam.** `packages/cli/src/commands/prepare.ts` payload assembly (`:150-260`), and
`packages/mcp/src/index.ts` `get_task_preflight` — the parity gate will fail otherwise, as it
correctly did for `stored_fact_count` during EW-6.

**Red.**
1. A top-level `guidance` view exists containing exactly: conventions (statement, scope, matcher,
   mode, **will-this-block**, migration sentence, conforming_examples — no evidence_refs),
   ranked `relevant_files` with reasons, required_checks (names + commands only), and a
   `not_covered` line (what Drift has no opinion on — the AK-2 seed). **Asserted ≤ 32,768 bytes
   serialized** on every eval repo, including cal.com with its 2,500 parser gaps.
2. Duplication is dead: the 397 findings appear **once** in the full envelope; `evidence_refs`
   in `selected_conventions` become finding-id references. Assert total packet bytes on dub
   < 500 KB (from 1,135 KB) without deleting any information class — dedup and summarize, don't
   drop.
3. `parser_gaps` in the packet becomes `{count, by_code: top 3, full_list_command}`; the full
   records remain reachable via the existing check output and a listed command. Assert the packet
   contains ≤ 3 gap kinds and no per-gap records.
4. Empty-with-reason (the EW-3 shape): `test_intelligence: []` and `selected_contracts: []` each
   gain a `reason` (`"not_implemented_for_repo" | "no_contracts_accepted"` …) — pinned so bare
   `[]` can never return.
5. CLI/MCP parity green; `prepare-quality-eval.mjs` re-run (ranking must be unaffected — this item
   touches packaging, not selection).

**DoD.** `guidance` ≤ 32 KB on 7/7 repos, byte-asserted. Full envelope intact for audit. Parity
green.

---

## BB-7 (optional, 2 lines of leverage) · Index `facts.file_path`

Measured: single-file fact query 448 ms cold (full table scan), all-facts 55 ms — the index is
missing, and every per-file lookup pays for it. Migration + one regression test asserting the
query plan uses the index (`EXPLAIN QUERY PLAN` contains `USING INDEX`). Rides along with any BB
item; listed so it doesn't get lost before the P-1 sprint that will want it anyway.

---

## Order

```
BB-2 ─┐                       hours; makes every later measurement trustworthy — do first
BB-3 ─┤  independent, parallelizable immediately
BB-1 ─┤  (three different seams, no shared state)
BB-7 ─┘
BB-5 ──> BB-6                 BB-6's guidance view embeds BB-5's exemplars + sentence
BB-4                          independent; the only item needing a new fixture repo
```

Estimated: BB-1/2/3/7 ≈ 1 agent-day combined; BB-5 ≈ 2; BB-6 ≈ 1.5; BB-4 ≈ 1.5. Total ≈ 6 agent-
days plus verification passes — consistent with the 8–11 day beta estimate that includes E-7's
separately-planned time box.

## Standing rules (carried, plus this audit's contributions)

- Implementer never verifies its own item; verifier gets the DoD and the sha.
- `pnpm eval:external` after every item, never batched; `eval:determinism` re-run for BB-4 and
  BB-5 (both touch emitted payload ordering).
- **Capture the exit code of the process you tested, not the last pipe stage** — this document
  briefly mislabeled D-2 as still-broken because of `node … | tail; echo $?`.
- **Never measure through the engine fallback** — set `DRIFT_ENGINE_BIN` explicitly in every
  harness (BB-2 makes this structural, but the rule holds until it lands).
- A bug report that doesn't reproduce at the current sha gets a correction note, not a quiet
  deletion — see the header of this file.
