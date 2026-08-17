# Glob revival — reviving and proving the glob-killed convention kinds

Branch `remediation/glob-revival`, forked from `remediation/ground-truth-audit` at `80a9f6e3`
(unmerged to `main`, 54 commits ahead). Baseline `pnpm verify:ci` at that sha: **exit 0**.

The engine's scope-glob matcher was historically broken: `path_glob_matches` reduced
`**/app/api/**/route.ts` to `starts_with("**/app/api")`, which no repo-relative path matches. Every
proposer-emitted scope therefore selected zero files, and several security convention kinds accepted
cleanly while structurally unable to fire. A real recursive matcher now exists. This sprint proves,
per kind and end to end, that the revived kinds actually fire — and, for all five glob-scoped kinds,
that the canary *dies* when the old bug is put back.

---

## 1. Per-kind results

Every row's canary lives in `test/e2e/gt-canary.test.ts` and drives the real CLI. The mutation column
is the load-bearing one: it records whether the canary **failed** when the `**/` zero-segment case
was deleted from `glob_matches_from`.

| Kind | Path used | Fixture violation | Finding emitted at | Exit | Canary fails under reverted glob fix | Ledger cell |
|---|---|---|---|---|---|---|
| `api_route_requires_tenant_scope` | **proposer** — `scan → start → conventions accept --mode block → check` | `gt-tenant-scope/app/api/projects/route.ts:4` | same, `tenant_predicate_missing`, `block` | **2** over a diff | **YES** | `needs-review → firing` |
| `api_route_requires_authorization` | **proposer** | `gt-authorization/app/api/projects/route.ts:7` | same, `authorization_guard_missing`, `block` | **2** over a diff | **YES** | `needs-review → firing` |
| `api_route_forbids_sensitive_response_fields` | **proposer** (canary pre-existed) | `gt-sensitive-fields{,-schema}/pages/api/route-leak.ts` | same | 0 (`--scope full`) | **YES** | `firing → firing`, now mutation-verified |
| `api_route_forbids_secret_exposure` | **contract import** — no proposer exists | `gt-secret-exposure/app/api/billing/route.ts:3`, `webhooks/route.ts:3` | both, `block` | **2** | **YES** | `unimplemented → firing` |
| `session_object_must_come_from_trusted_helper` | **contract import** — no proposer exists | `gt-session-trust/app/api/session/route.ts:4` | same, `session_not_trusted`, `block` | **2** | **YES** (see §4.1 — a harness defect briefly hid this) | `unimplemented → firing` |
| `api_route_requires_request_validation` (`safeParse`) | **proposer** | `gt-request-validation/app/api/projects/route.ts:7` | same, `request_input_not_validated`, `block` | 0 full scope, **2** over a diff | **NO — structurally cannot; see §4** | `needs-review → firing` (`request_validation_proof`) |

**Contract-import exception, flagged as required.** Two kinds used it: `api_route_forbids_secret_exposure`
and `session_object_must_come_from_trusted_helper`. Both have **zero** `ConventionKind::` occurrences in
`candidate_command.rs`, so no candidate of either shape can ever be proposed and `conventions accept`
cannot reach their arms. `drift contract import` is the documented alternative
(`docs/agent-integration.md:84`). In both cases the imported scope is the proposer's own literal glob
set — not a de-globbed convenience — which is exactly what makes their mutation proofs meaningful.

**Both cells were `unimplemented`, and this work falsified half of that evidence.** The old rows
claimed (a) the proposer emits nothing of the shape — still true, still pinned by the untouched
`it("proposer emits no candidate of the unimplemented shapes")` — and (b) that the arm is therefore
unreachable. (b) does not follow from (a) and is false: import reaches the arm and the arm fires. Both
`it(...)` cases stay in that test deliberately; the no-candidate half is what makes import the *only*
route, and so what makes the exception legitimate rather than a shortcut.

### The documented review surface hides every one of these kinds

The brief's workflow was `scan → conventions list → conventions accept → check`. The harness reads
candidates from `start --json`, which emits them **unfiltered**. `drift conventions list` — the
command a human actually runs — does not: `packages/cli/src/commands/conventions.ts:76,85-87` drops
every `isExperimentalSecurityKind` candidate unless `--experimental-security` is passed or the
candidate is a promoted presence family (which is why the `api_route_requires_auth_helper` presence
canary needs no such assertion), and
`EXPERIMENTAL_SECURITY_CONVENTION_KINDS` is the entire security-contract set
(`packages/core/src/capabilities.ts:187`).

Measured, not inferred: for `gt-sensitive-fields`, `conventions list --json` returns
`candidates: []`; the same command with `--experimental-security` returns the accepted
sensitive-fields convention. **So a user following the documented review command sees zero candidates
for every kind this sprint proves.** The brief anticipated exactly this ("if hidden behind
`--experimental-security` … use the flag and note it"), and the first pass of this work substituted
`start --json` without noting it. That is now pinned: `assertListVisibility` asserts both halves —
hidden by default, reachable with the flag — on all four proposer-path canaries. Inverting it makes
exactly those four fail, so it is load-bearing rather than decorative.

This is a **product** limitation, not a harness one, and it bounds what "these kinds now fire" means:
the engine fires, and the default review surface will not show a user the candidate that gets them
there.

### Receipts

**N/A — not implemented.** `reached`, `inputs_considered`, `findings_emitted` and `skip_reason` do not
exist in `packages/cli/src/check/run-check.ts` or `crates/drift-engine/src/check_command.rs` (verified
by grep). Implementing them was out of scope. The "evaluated, not skipped" half of every canary is
therefore asserted against the **proof payload** instead — for all six, one of two shapes: a
`security_boundary_proofs` entry for the conformance route with `required: true, proven: true`
(tenant-scope, authorization, session-trust, request-validation), or the engine naming the compliant
sibling in the finding's `conforming_examples` (secret-exposure, sensitive-fields). Either is
something a scope that failed to match could not have produced. A completeness audit found the
sensitive-fields canary originally asserted neither — only that its safe route was *absent* from the
flagged list, which is satisfied by never evaluating it — and it was strengthened rather than
excused.

---

## 2. Ledger

`scripts/convention-cell-ledger.mjs` has **no `proven` state** — its vocabulary is
`firing | quarantined | unimplemented | needs-review`. The state meaning "proved it fires" is
**`firing`**, and it is not hand-editable: the script requires a non-null `canary`, and
`gt-canary.test.ts`'s `ledger integrity` block asserts *both directions* — the named canary must be
registered in `CELLS_COVERED_HERE` **and** exist as a literal `it("...")` in that file. Every
transition below is backed by a passing test, obtained through that mechanism.

| | Baseline `80a9f6e3` | Final |
|---|---|---|
| `firing` | 5 | **10** |
| `quarantined` | 1 | 1 |
| `unimplemented` | 2 | **0** |
| `needs-review` | 10 | **7** |

**The ledger gate is branch-gated and silently no-ops on this branch.** `enforcement.integration_branches`
is `["remediation/ground-truth-audit", "main"]`, so the `pnpm check:cell-ledger` step inside
`verify:ci` exits 0 here without enforcing. Every ledger result in this report was therefore also run
as `DRIFT_LEDGER_ENFORCE=1 node scripts/convention-cell-ledger.mjs` — **exit 0**.

---

## 3. Code changes shipped, each with the test that fails when it is reverted

Every revert below was actually performed, the named test observed failing, and the change restored.

| # | Change | Test that fails when reverted |
|---|---|---|
| 1 | `security_proof.rs` — the untrusted-tenant-source clause counted a `scoped_helper` predicate as a route-supplied tenant value | `gt-canary > phase-4 tenant-scope path fires, and the helper-scoped siblings pass` |
| 2 | `check_command.rs` — phase6 migrated from the weak `path_matches_globs` to `path_glob_matches`; the weak matcher had no other caller and is deleted. **Correct but inert on real conventions** — phase6 reads `matcher.path_globs`, which the proposer never sets (§6.2), so today it narrows nothing; the test sets that field explicitly | `security_check_repo_phase6.rs > phase6_narrows_with_the_proposers_globstar_scope` |
| 3 | `check_command.rs` — the bare-directory widening moved out of `path_glob_matches` into a phase5-only `phase5_scope_pattern_matches`, making the Rust matcher byte-equivalent to `matchesGlob` | `a_trailing_star_still_matches_the_directory_itself` + `rust_matcher_reproduces_the_shared_parity_selection` |
| 4 | `security_patterns.rs` + `security_facts.rs` + `check_command.rs` + `lib.rs` — new `RequestValidatorKind::SchemaMethod`, plus `defaulted_request_validator_kind` retagging any validator that names a `SCHEMA_METHOD_VALIDATOR_SYMBOLS` symbol (currently only `safeParse`) with no explicit `kind` from Helper to SchemaMethod, so a proposer-shaped `safeParse` validator can prove | `gt-canary > request-validation safeParse proof path fires`; `security_check_repo_request_validation.rs > proposer_shaped_safe_parse_validator_proves_a_guarded_schema_call` |
| 5 | `check_command.rs` — `sink_line_from_sink_id`: sink ids are `sink:{file}:{line}:{symbol}`, so reading the last `:`-segment as the line failed and the call site's `unwrap_or(1)` (`check_command.rs:1124`, itself unchanged) then invented line 1 on **every** request-validation finding | `security_check_repo_request_validation.rs > request_validation_finding_points_at_the_unvalidated_sink_line` |
| 6 | `test/e2e/gt-harness.ts` — `withDebugEngine()`, pinning `DRIFT_ENGINE_BIN` around every CLI call a test makes *after* a workflow returns. Without it those calls resolved to `target/release/drift-engine`, which nothing in the e2e suite builds (§4.1) | `gt-canary > ledger integrity > every CLI call in this file runs the engine binary under test` — a standing guard that fails on any unwrapped `runCli([` in the canary file AND on the harness's returned `check` closure losing its wrapper — the two partial reverts that matter, each proved by actually performing it. (The behavioural proof is the mutation itself: reverted, `phase-4 session-trust …` stops failing under it — but that is a one-off falsification, so the standing guard was added too, because deleting the fix otherwise leaves the suite green.) |
| 7 | `test/e2e/gt-canary.test.ts` — sensitive-fields gained the block-mode half it was missing, and lost a false claim that block mode was impossible for the kind (§3, "one assertion that was wrong") | `gt-canary > phase-5 sensitive-response-fields path fires, on both provenance routes` — its exit-2 block-mode assertions |

### One assertion that was wrong, and what replaced it

The first attempt to strengthen the sensitive-fields canary asserted that a candidate-sourced
sensitive-fields convention **cannot** be accepted in block mode, citing
`packages/engine-contract/src/index.ts:412-420`. That was false. The reject keys on
`source === "candidate"`, and `conventions accept` deliberately restamps `candidate` to
`accepted_inference` (`packages/cli/src/domain/convention-candidates.ts:216`) exactly because a
reviewed field is no longer an unreviewed guess — so the reject cannot fire on the accept path, and
for `gt-sensitive-fields-schema` it is doubly inapplicable (`source: "schema"`). Measured: accept
with `--severity error --mode block` exits 0, and `check --scope changed-hunks --diff-file` exits
**2** with `enforcement_result: block`. A hollow assertion had been replaced with a wrong one; the
canary now asserts the real behaviour.

### One change made and then withdrawn

Change 5 originally also added an input-fact fallback to `request_validation_finding_line`. A
verification pass found it was **unreachable and uncovered** — deleting it left the whole suite green.
`sink_line_from_sink_id` returns 0 only for an id with fewer than two `:`-segments or a non-numeric
line, and `security_control_flow.rs:745-747` emits neither. Shipping a new path no test can hold down
is the exact shape this sprint exists to remove, so it was withdrawn rather than documented.

### Two new dead-path mechanisms, beyond the three known fallout items

Neither was on the known list, and both made a kind unable to report a *pass*:

- **`security_proof.rs` (change 1).** `push_guard_candidate` emits `requires: { tenant_helpers: [...] }`
  and no `auth_helpers`, so `accepted_auth_helpers` is empty, so no `SessionRead` is ever stamped
  `source: "auth_result"`, so `trusted_sessions` is empty on every route. With `!predicates.is_empty()`
  on both sides of the conjunction, a route that *called the accepted helper* was failed for
  `tenant_source_untrusted` — naming a source it does not have. The kind could report a violation but
  never a pass, which is a constant rather than enforcement.
- **`security_patterns.rs` (change 4).** The `safeParse` arm looked live but was unreachable: the
  proposer writes every inferred symbol to `requires.validators` and leaves `requires.schemas` empty,
  so `safeParse` arrives as `RequestValidatorKind::Helper`, whose arm requires `call.value.is_none()`
  — and `Schema.safeParse(body)` always has a receiver. Measured before the fix: **3 findings on 3
  routes, including both conforming routes the convention had been inferred from.** A false-positive
  generator, not merely a missed detection.

### The three known fallout items

- **D1-style source-provenance filter** — not hit. The phase5 allowlist (`SENSITIVE_FIELD_SOURCES`,
  `security_patterns.rs:302-303`, enforced at `:316`) already admits `candidate`.
- **Block-mode schema reject** (`packages/engine-contract/src/index.ts:412-420`, *not* `:439-452`; the
  line numbers had drifted) — **not hit, and deliberately not "fixed."** It is scoped to
  `api_route_forbids_sensitive_response_fields` with candidate-sourced fields, and its message
  ("candidate sensitive fields cannot back blocking enforcement") reads as a deliberate safety
  property: a name-heuristic guess should not block a merge. No canary needed it; changing it would
  have been a policy change smuggled in under a bug fix. Every other kind accepted in block mode
  without complaint.
- **`safeParse` dead arm** — hit, diagnosed, fixed (change 4). The brief's file:line was right; its
  mechanism was not.

---

## 4. Item 2 — phase6 migration and scope-engine parity

**Migration.** `security_phase6_findings_and_proofs` now narrows with `path_glob_matches`;
`path_matches_globs` is deleted. "No globs means no narrowing" is preserved via phase4's
`if !path_globs.is_empty()` guard. **No existing test pinned the weak matcher's quirks** — because
`matcher.path_globs` was never set in any existing test or fixture, the shim always took its
`None → true` path. So no test needed changing, and none was weakened.

**The two glob engines genuinely disagreed on one input, and it was found and fixed rather than
papered over.** `path_glob_matches("/api/users/*", "/api/users")` returned `true` while
`matchesGlob` returned `false`. `matchesGlob` was right — both files document `*` as "any run of
characters except `/`". The Rust widening was real but belonged only to phase5, the sole site that
matches these patterns against *route paths* rather than file paths, so it moved to
`phase5_scope_pattern_matches` instead of being deleted. Phase5's behaviour is unchanged.

**Parity test.** `test/canary/glob-parity.json` is generated from the Rust matcher and holds the
proposer's glob set, 22 fixture paths, the 12-path selection, and 11 single-pattern rows.
`check_command.rs::glob_engine_parity_tests` asserts the Rust matcher reproduces it;
`packages/core/test/glob-parity.test.ts` asserts `matchesGlob` reproduces it from the same input.
There is no regeneration flag on either side, so a change to **either** engine alone fails the test —
demonstrated by mutating each side in turn. Both engines now agree on all 33 rows. Coverage includes
the zero-nesting cases (`app/api/route.ts`, `pages/api/handler.ts` — the original bug), nested and
`src/`-prefixed routes, `.tsx` variants, and the near-misses `app/apixyz/`, `pages/api/nested/deep/`,
`route.js`, `route.ts.bak`, `notapp/api/`.

`conventionScopeFiles` was deliberately **not** compared against the engine: it gates on
`isNextApiRoutePath` first, so it measures a role predicate, not a matcher. That would have been a
parity test that could not fail for matcher reasons.

### 4.1 A harness defect briefly hid one mutation proof — found, root-caused, fixed

Worth recording in full, because the first two attempts at this got it wrong in opposite directions.

`session_object_must_come_from_trusted_helper` appeared to **pass** under the glob mutation when run
in isolation, while failing when the whole canary file ran. The first conclusion drawn was that its
findings were "not gated by the scope globs" — filed as an open question. **That was wrong.**

The real cause: `runGtWorkflow` and `runGtContractImportWorkflow` pin `DRIFT_ENGINE_BIN` to the debug
binary for their own duration and unpin it in a `finally`. Any CLI call a *test* makes afterwards —
the `check` closure returned by the import workflow, a second blocking `check` over a diff — ran
**unpinned**, and engine resolution fell through to `workspace_release_binary`
(`target/release/drift-engine`). Nothing in the e2e suite rebuilds that. So those assertions were
being made against a stale engine, and mutating the debug binary looked like it changed nothing.

Two precise qualifications, because the unqualified version overstates it. First, resolution only
falls through to `workspace_release_binary` **if `target/release/drift-engine` happens to exist**;
otherwise it falls to `workspace_cargo` (`cargo run -p drift-engine`), which is the debug build and
behaves correctly (`rust-engine.ts:277-292`). So reproducing this on a clean clone requires a release
binary to be present. Second, `pnpm verify` runs `build:engine` (a *release* build of the same
source) before `test:e2e`, so under the full gate those calls hit a freshly built engine rather than
a stale one. The defect's real domain is isolated and ad-hoc runs — which is exactly where the
mutation experiment lives, and exactly why it bit there and nowhere else.

Fixed by `withDebugEngine()` in `test/e2e/gt-harness.ts`, which pins and restores around any
post-workflow CLI call; every such call site now goes through it. **With the fix, session-trust fails
under the mutation as originally reported** — reproduced independently by a third reviewer. All five
glob-scoped canaries now die in isolation. A standing guard,
`ledger integrity > every CLI call in this file runs the engine binary under test`, now covers both
partial reverts: it fails if any `runCli([` in the canary file is left unwrapped, **and** if the
harness's returned `check` closure — the very call this section root-causes — loses its wrapper.
Each direction was proved by performing the unwrap and watching the guard fail. Without the guard,
deleting the fix leaves the suite green.

Two lessons this leaves behind, both cheap and both real:

- **A green assertion is not evidence that the binary under test produced it.** This defect made
  three canaries assert against an engine no test had built. `assertEngineIdentity` exists for
  exactly this and was not reaching those runs.
- **Mutation results must be read per test, in isolation.** A whole-file run mixes in ordering
  effects; the isolated result is the trustworthy one.

### The merged-tree mutation run is the strongest single piece of evidence here

Deleting the `**/` zero-segment early return and running the whole canary file failed **exactly five
tests, and exactly the right five**:

```
× phase-5 sensitive-response-fields path fires, on both provenance routes
× phase-5 secret-exposure path fires, reached by contract import
× phase-4 authorization path fires over the proposer's own route globs
× phase-4 session-trust path fires through contract import   <- does NOT reproduce in isolation (§4.1)
× phase-4 tenant-scope path fires, and the helper-scoped siblings pass
✓ (9 others, including request-validation and phase-6 CORS)
```

Both survivors are explained, not excused:

- **`request-validation` cannot be made glob-dependent.** `security_request_validation_findings_and_proofs`
  (`check_command.rs:1057`) scopes only by `security_auth_files` + `matcher.applies_to_file_roles` and
  never calls `path_glob_matches`. The historical glob bug could not have killed this kind. This is
  reported as an honest negative on the mutation clause rather than disguised by contriving a scope
  path the kind does not have.
- **`phase-6 CORS` survives for a reason worth acting on** — see "Found, not fixed" #2: phase6 reads
  `convention.matcher.path_globs`, which the proposer never populates, so phase6 applies *zero* path
  narrowing to proposer-emitted conventions regardless of the migration. The migration is still
  correct and revert-proved by its own test; the field mismatch is a separate defect.

---

## 5. Gate runs

Every row below was run **after** the final round of fixes, on the merged branch, in this session.
The suite was gated three times in total (baseline, post-merge, post-fixes); these are the last.

| Command | Exit |
|---|---|
| `pnpm verify:ci` — baseline at `80a9f6e3`, before any change | **0** |
| `pnpm verify:ci` — final | **0** |
| `cargo test -p drift-engine` | 0 (all binaries) |
| `cargo fmt --all -- --check` | 0 |
| `cargo clippy -p drift-engine --all-targets -- -D warnings` | 0 (inside `verify:ci`) |
| `pnpm typecheck` | 0 |
| `DRIFT_LEDGER_ENFORCE=1 node scripts/convention-cell-ledger.mjs` | 0 — 18 cells: firing 10, quarantined 1, unimplemented 0, needs-review 7 |
| `vitest run test/e2e/gt-canary.test.ts` ×3 (determinism) | 15 passed / 15, identical each run |

`verify:ci` covers `check:cell-ledger`, `check:surface-parity`, `check:payload-invariants`,
`validate:claims`, `beta:proof` and `git diff --check`. **No baseline or eval baseline was blessed;
no `--update` was run in any form.** Working tree clean at the final sha.

### Mutation matrix — measured per canary, in isolation

Whole-file runs mix in ordering effects, so each was run alone against a rebuilt mutated binary:

| Canary | Under the `**/` zero-segment kill |
|---|---|
| `phase-4 tenant-scope …` | **fails** — glob-dependent |
| `phase-4 authorization …` | **fails** — glob-dependent |
| `phase-5 sensitive-response-fields …` | **fails** — glob-dependent |
| `phase-5 secret-exposure …` | **fails** — glob-dependent |
| `phase-4 session-trust …` | **fails** — glob-dependent (see §4.1) |
| `request-validation safeParse …` | passes — structurally not glob-gated (§4), reported as an honest negative |

---

## 6. Found, not fixed

Out of scope for this sprint. Not fixed, listed with `file:line`.

**P0 — `drift check` hard-fails on a common route shape.**
`crates/drift-engine/src/security_proof.rs:1465` emits `reason: "session_not_trusted"` for a
`SessionRead` whose source is `unknown_helper`, but the wire schema does not permit that value in that
field: `packages/engine-contract/src/index.ts:937` and `packages/core/src/security.ts:323` type
`session_trust.missing_trust[].reason` as `enum(["derived_from_request", "unknown_helper",
"missing_auth_guard", "parser_gap"])`. Reproduced: a route doing
`const session = await requireUser(); requirePermission(session.user, "...")` with any phase-4
convention accepted makes the whole run exit 1 with *"Invalid enum value … received
'session_not_trusted'"* and produce no findings and no proofs. That is the shape of every existing
`security-role-*` / `security-tenant-*` fixture and of most real Next.js routes. Two candidate fixes
exist (map to `unknown_helper`, or widen the two enums); choosing between them touches shared phase-4
proof semantics and an existing engine test (`security_check_repo_phase4.rs:156` pins the current
value), so it needs its own decision.

1. **`vocabulary/vocabulary.json:231-232`** marks `api_route_forbids_secret_exposure` and
   `session_object_must_come_from_trusted_helper` `"proposable": true`. Both have zero proposer
   occurrences. Nothing cross-checks `proposable` against `candidate_command.rs`, which is how the
   false value survived — the same class of unchecked manifest claim the cell ledger exists to kill.
2. **Phase6 reads the wrong field.** `check_command.rs:1212` reads `convention.matcher.path_globs`
   while phase4 (`:1604`) and phase5 (`:1803`) read `convention.scope["path_globs"]`. The proposer
   writes globs only to `scope`, so phase6 applies no path narrowing to any proposer-emitted
   convention. Masked in the CLI path by `run-check.ts:2811-2825` pre-filtering through
   `conventionScopeFiles`, but live on the raw `check-repo` wire.
3. **A second, unrelated `path_glob_matches`** at `crates/drift-engine/src/security_rules.rs:690` —
   a three-line prefix matcher sharing the name of the real globstar engine, used by
   `phase5_contract_applies`. Verified **not** on the CLI check path: the `evaluate_api_route_*`
   functions it serves are re-exported at `lib.rs:96-97` and called only from
   `crates/drift-engine/tests/security_rules.rs`. So it is a test-only parallel implementation of
   logic production reaches by another route — worth deciding about on its own.
4. **No `request_validation_called` fact exists at scan time in any repo.** Scan calls the 3-arg
   `extract_security_facts` (`crates/drift-engine/src/main.rs:663`), whose wrapper hard-codes the
   empty validator slice when it delegates (`security_facts.rs:20`). Note the `&[]` visible at
   `main.rs:663` is `accepted_auth_helpers`, NOT the validators — the fix is to call
   `extract_security_facts_with_validation` there, not to change that argument. `FAMILY_SPECS` sources the request-validation family from that fact kind only, so
   `api_route_requires_request_validation::presence_findings` can never be promoted by any fixture:
   a code gap, not a corpus gap. That cell stays `needs-review`, with `missing_evidence` rewritten to
   record this rather than the previous (incorrect) corpus explanation.
5. **`--scope full` is green by construction.** `packages/cli/src/check/diff.ts` classifies every
   finding `touched_existing` under `DiffScope::Full`, and `run-check.ts:821` counts only
   `new_in_diff`, so a full-scope run cannot exit 2 however many blocking findings it has. Canaries
   that assert the blocking exit code therefore supply `--diff-file` + `--scope changed-hunks`.
6. **Authorization guards taking a subject argument are false positives by construction.**
   `security_proof.rs:1116-1126` requires the guard's first argument to name a trusted session, and
   trusted sessions come only from `requires.auth_helpers`, which an authorization candidate never
   carries. `requireRole(session.user, "admin")` — i.e. `security-role-guard-present` — can never pass.
7. **Dead branch:** `check_command.rs:3589-3596` — the `.or_else` inside `phase4_finding_line`
   parses a line out of `sink_fact_id`, but both sink-id formats put the *symbol* last
   (`security_control_flow.rs:745`, `security_proof.rs:537`), so it can never yield a number. It is
   also never entered on any current fixture: `build_tenant_proof_from_facts`
   (`security_proof.rs:1186-1194`) pushes `tenant_predicate_missing` whenever data operations exist
   with no predicate, which is true of all three flagged `gt-authorization` routes, so the tenant arm
   above returns `Some` and short-circuits it — and that arm is where the canary's asserted lines
   (7, 10, 14, the `db.*` lines) actually come from. **The consequence is undiscovered elsewhere,** and it is
   broader than a single fallthrough: for an authorization finding, *no* arm of
   `phase4_finding_line` that can succeed points at the unguarded sink. On a route whose data
   operation IS tenant-scoped but whose authorization guard is missing, the tenant arm yields
   nothing and this one yields `None`; the next arm (`check_command.rs:3598-3605`, reading
   `session_trust.missing_trust[0].fact_id`, which does end in a line) then reports the
   **session-read** line, and only a route with no untrusted session read falls all the way through
   to `unwrap_or(1)` (`check_command.rs:1653`) and reports line 1. No fixture has either shape.
8. **`security_facts.rs:1648`** `is_session_like_variable` matches any variable containing `user`, so
   `const userAgent = request.headers.get("user-agent")` would read as an untrusted session read.
   Suspected false positive, **not measured**, and deliberately not exercised by any fixture.
9. **Backslash normalization diverges**: `matchesGlob` normalizes (`globs.ts:106`), `path_glob_matches`
   does not. Both files' stated contract is forward-slash repo-relative paths, so the input is
   undefined on both sides; the engine normalizes upstream in `next_api_route_identity`.
10. **`request_validator_kind_from_str` accepts `"schema_method"`, and no test passes that string.**
    `crates/drift-engine/src/check_command.rs` — the variant is exercised only via the defaulting
    path; the explicit wire value is reachable solely from a hand-authored contract and is uncovered.
11. **Reproducing the revert-proofs needs a relink, or the result is meaningless.**
    `check_command.rs` is a module of the *binary* (`crates/drift-engine/src/main.rs:10`), and the
    integration tests spawn `CARGO_BIN_EXE_drift-engine`, whose path is baked in at compile time.
    Reverting a change and re-running can rebuild the binary without relinking the test target, which
    then silently exercises the OLD binary and reports a false pass. Force it with
    `touch crates/drift-engine/tests/*.rs`. Every revert-proof in §3 was confirmed with the relink.
12. **The same unpinned-engine hazard exists in two sibling e2e files.**
    `test/e2e/dogfood-enforcement-proof.test.ts:27,101,139` and `test/e2e/golden.test.ts` (11 call
    sites) drive `runCli` with no engine pin at all — the same class of defect as §4.1's P0,
    pre-existing and outside this sprint's scope. Under `verify:ci` they hit the release binary
    `build:engine` just produced, so they are not currently wrong; run ad hoc, they are a false green
    waiting to happen.
13. **Pre-existing banned practices in `test/e2e/security-tenant-authorization.test.ts:153,217`** —
    uses `storage.upsertAcceptedConvention` and the de-globbed `app/api/**/route.ts`. Left untouched
    under the no-weakening rule; it is the exact pattern this sprint's canaries exist to replace.

---

## 7. Corrections to the sprint brief

- **`api_route_requires_tenant_scope` and `api_route_requires_authorization` DO have proposers.**
  They are emitted dynamically via `push_guard_candidate(... candidate_kind: ...)` at
  `candidate_command.rs:508,524,540,556`, so a literal-string grep for the wire name in that file
  finds nothing. Their ledger blocker was never the glob — it was that **no fixture in the corpus
  induced a candidate at all**. `push_guard_candidate` needs the *same* symbol in ≥2 route facts, and
  every `security-role-*` / `security-tenant-*` fixture is a single route making a single call.
- **The ledger has no `proven` state**; the correct target is `firing` (see §2).
- **Fallout item 2's line numbers had drifted** (`:412-420`, not `:439-452`).
- **`api_route_requires_request_validation` was never glob-killed** — its arm never calls the matcher.

## 8. Environment

The machine hit **100% disk** repeatedly during the parallel phase (nine cargo `target/` trees plus
~28 GB of other sessions' scratchpads). `drift start` refuses below 512 MiB
(`packages/cli/src/domain/disk-space.ts:23`), which surfaces as exit 3 *"Not enough disk space for
local state"* and is easily misread as a test failure. Only regenerable build caches and leaked
`drift-*` harness temp dirs were reclaimed. Worth noting as a real finding:
`cleanupGtTempDirs` runs in `afterEach`, so **every crashed or timed-out e2e run leaks its temp dir**
— 311 were found accumulated.

This branch also carries two commits it did not author — `583383e0` and `59d563f8`, docs-only edits to
`docs/remediation-report.md` from a concurrent session sharing the same checkout. They touch no file in
this sprint's scope and were kept rather than discarded.
