# Ground-truth audit remediation — final report

| | |
|---|---|
| **Repo** | `/Users/geoffreyfernald/drift-falsification/drift` |
| **Baseline** | `255f2208` — `main` never moved from it |
| **Integration branch** | `remediation/ground-truth-audit` |
| **Merge status** | **NOT MERGED, and NOT PUSHED.** The merge gate fails (§6), so not merging is the correct outcome regardless; separately, `git push` was denied by this session's permission policy, so the PR could not be opened. Branch is complete and local. PR body: `docs/ground-truth-audit/PR-BODY.md`. |
| **Spec** | `docs/tdd-ground-truth-remediation.md` (v2.3) |

---

## 1. §7 exit criteria

| Capability | Baseline | Achieved | Evidence |
|---|---|---|---|
| `exported_symbol` precision (fixtures) | 75% (6 of 8) | **100% — 4 + 2 rows, 0 extras** | `gt-fact-extraction.test.ts`, exit 0. Red at `ea9e774c` with `"export default function handler" must not claim a NAMED export handler` |
| `exported_symbol` recall (fixtures) | 85.7% (6/7) | **100% (7/7)** — `internalHelper` emitted, `WidgetShape` still excluded by the documented runtime-symbols rule | same file; red with `"export { internalHelper }" at lib/util.ts:17 exports a runtime symbol` |
| `default_exports.rs` invariant | asserts both facts | **S2 branch: assertion was INCIDENTAL, D2 ships.** Canonical single-fact assertion in place; EW-4 bare-identifier case at line 30 untouched and passing | `cargo test -p drift-engine` exit 0, 355 passed / 0 failed. `import_resolution`, `external_star_reexports`, `runtime_provable_imports`, `graph_backed_check` all green |
| Graph node/edge delta, taxonomy | 1878 / 3221 | **predicted and matched** — 28→26 nodes, 44→40 edges on `gt-fact-extraction`; dangling edges 0→2 predicted, then fixed to 0 | `1d97451d`; verified by the lead by reverting only that hunk — assertion goes red with exactly 2 dangling endpoints |
| Data-access precision, synthetic | 66.7% (4/6) | **100% (4/4)** — `dbg`, `imdb`, `no-data-access-here` silent | `gt-data-access.test.ts` exit 0. Red with `pages/api/route-dbg.ts imports no data layer and must not be flagged` |
| Data-access, taxonomy held-out | 4/4, 0 FP | **unchanged** | `eval:external` T3 #3 — taxonomy `ok`, no finding-count change |
| Papermark `@/lib/prisma` | 229 | **229, holds** | The one import that was briefly suppressed (all uses commented out) is retained again after the D5.2 correction |
| Papermark `@prisma/client` | 35 / 30 lines | **35 → 30 (D5.1) → 7 (D5.2)** — not the predicted 0 | Every survivor cites evidence: 2× `invocation:member_call` (`Prisma.sql` feeding `$queryRaw`), 4× `unresolved:reference_escapes` (`z.nativeEnum`, `Object.values(X).includes`), 1× `no_use_found`. See §3. |
| Sensitive-fields, marker path | 0 (structural) | **1/1, `source: "schema"` preserved** | `gt-sensitive-fields.test.ts` exit 0. Red with `the driftSensitive marker is schema-declared provenance and must survive proposal: expected [candidate, candidate] to not include candidate` |
| Sensitive-fields, inference path | 0 (structural) | **1/1 via `accepted_inference`** | same file; red with `expected [] to deeply equal [pages/api/route-leak.ts]` |
| Dead-config diagnostic | absent | **fires on a broken config and on an allowlist rejection**; the pre-fix-accepted-convention case substituted per §5.1's own escape hatch | `gt_sensitive_field_provenance.rs`, 9 tests. Substitution recorded in §5 below |
| Auth-helper convention | 100/100 | **unchanged** | `gt-canary.test.ts` — 1 finding on `route-c.ts`, 0 on `route-a`/`route-b` |
| Mutation test (taxonomy) | 1/1, isolation clean | **unchanged** | `eval:external` taxonomy `ok`, `injected=y evidence=y` |
| Determinism | held | **held, 7/7 over 3 runs** | `eval:determinism` exit 0 at T3 #1, #2 and #3 |
| Canary ledger coverage | 0 cells declared | **18 cells declared: 5 firing / 1 quarantined / 2 unimplemented / 10 needs-review** | `node scripts/convention-cell-ledger.mjs` exit 0; `gt-canary.test.ts` 9 passed |

**Rows not met as written: none.** The `@prisma/client` row landed at 7 rather than the predicted 0, which §7 explicitly defines as a prediction and not a threshold — the gate is that every retained finding cites its ambiguous-use evidence, and all seven do.

---

## 2. What shipped, deferred, blocked

**Shipped:** D1 (P0), D2, D3, D4, D5.1, D5.2 — all five audited defects, plus two the audit did not name (§4).

**Deferred by pre-decided branch:** none. The S2 branch resolved to *ship* D2.

**Blocked:** none.

**Deliberately not done:** the state-DB migration (§5.1 compat). It is the only irreversible act in the plan and needs a human signature. `docs/decisions/d1-sensitive-field-source-migration.md` records it as considered-and-deferred, carrying the discriminator and lossiness constraints. The §5.1.4 dead-config diagnostic covers the same users non-destructively.

### S2 branch outcome and its evidence

**The `default_exports.rs:50-63` assertion was incidental. D2 ships.** Evidence, re-run by the lead: `cargo test -p drift-engine` exit 0 with all four named suites green, and — the decisive one — `eval:bench` reports **0/56 ordinary-edit refusals, ratchet ok, no repo regressed**. §5.2's stated risk was that removing the second fact would reintroduce the EW-4 over-refusal regression; the ratchet measures exactly that.

---

## 3. D5.2 — the retained findings, with their evidence

The papermark `@prisma/client` target was 0. It landed at **7**, and that is a pass under §7's gate note:

| Count | Verdict | Evidence |
|---|---|---|
| 2 | `invocation:member_call` | ``Prisma.sql`AND LOWER(v.email) LIKE …` `` feeding ``prisma.$queryRaw`` — genuine raw-SQL construction |
| 4 | `unresolved:reference_escapes` | `z.nativeEnum(X)` and `Object.values(X).includes(…)` pass the enum object to a callee; the use cannot be classified |
| 1 | `no_use_found` | a genuinely unused `DocumentVersion` import — a mild false positive, the honest cost of failing closed |

Track D explicitly **declined to add a known-pure-callee allowlist** that would have driven this to 0, on the grounds that loosening the classifier to make a predicted number land is the same act as blessing a baseline. That refusal is why this merges rather than being sent back.

**The audit's own hand-check was wrong on 2 of the 35.** §5.5 records that all 35 should classify as inert; the two `Prisma.sql` cases are member calls building raw SQL. Pinned as a fixture route so a later refinement cannot suppress raw-SQL construction.

---

## 4. Discoveries that contradict the TDD

§0.1 exists because this document has been wrong before. Six findings, each verified by the lead rather than accepted from a subagent.

### 4.1 Two defects the audit does not name — and D1 could not fire without either

1. **`path_glob_matches` never implemented `**/` as zero-or-more segments.** Every scope the proposer emits is `**/`-prefixed, so phase-5 rejected *every file of every proposer-produced convention*. The old matcher fell through to `split_once("**")` and tested `file_path.ends_with("/pages/api/**/*.ts")`, which is never true. **Not a new discovery** — Track A corrected its own report on this, and the comment above `presence_file_in_scope` already records it verbatim as "F3's exact shape, still live in this matcher … Recorded as a discovery; the phase5 paths that still use it are quarantined and are not changed here." This is the fix that comment deferred. `packages/core/src/globs.ts:13-14` documents the same bug fixed on the TS side and never ported to Rust.
2. **`call_argument_text` truncated a response literal at its first comma.** `res.json({ id, email, password })` emitted `response_emits_field` for `id` alone, so the leak route proved clean even with correct provenance and a matching scope.

### 4.2 §5.4's proposed D4 fix does not work as written
§5.4 says routing `data-access` through `contains_data_layer_token` stops `no-data-access-here` matching. It does not: that helper gates on `is_ascii_alphanumeric`, and `-` is not alphanumeric, so the token clears the boundary test on both sides. Verified in source. The shipped fix requires the token to be a path segment or its head/tail.

### 4.3 §4.2's dispatch table is incomplete — the ledger would have been undersized
The dispatch has **nine** arms, not eight. `is_phase6_security_convention` (`check_command.rs:198`, list at `:1159-1168`) covers ssrf, raw-sql, cors, csrf and rate-limit — none in §4.2's table, and that arm alone adds 5 cells. Separately, `middleware_must_cover_routes` is proposed but has **no arm at all**, falling through `check_command.rs:281`'s `else { continue }`.

### 4.4 §4.2 and §2 cite a documentation path that does not exist
`docs/architecture/security-heuristic-audit.md` is not present; the real path is `docs/internal/architecture/security-heuristic-audit.md`. A ledger-integrity test now verifies every cited path opens. Because `quarantined` requires a *locatable* citation, a wrong path would have silently forced cells to `needs-review`.

### 4.5 §5.5's D5.2 design cannot be built on facts alone
§5.5 names "a `new` instantiation" as invocation evidence, but `walk_node` dispatches only on `call_expression` — verified, there is no `new_expression` arm — so `new PrismaClient()` emits **no fact at all**. A member read emits none either. To a fact-only classifier the one genuine violation shape and an inert enum are the same nothing, and suppress-on-no-facts would silently drop the former. The shipped classifier reads the importing file's AST via `read_repo_file`, the door five security rules in `check_command.rs` already use.

### 4.6 §10's fact count spans two fixtures, not one
§10 attributes "8 → 6" to `gt-fact-extraction`. Measured through the real CLI: that fixture emits **6** and `gt-fact-extraction2` emits **2**. The 8 is the total across both. §7's precision (75% = 6 of 8) and recall (85.7% = 6 of 7) arithmetic both hold on the combined figure.

### 4.7 Incidental
`packages/cli/src/check/run-check.ts:523`'s TypeScript fallback producer is unreachable — `runEngineOwnedDirectDataAccessCheck` has a non-nullable return type, so `if (engineOwned)` is always true. No bypass exists, but it is dead code carrying a stale copy of the message format.

---

## 5. Ledger — 18 cells, and what the 10 `needs-review` cells lack

`firing 5 / quarantined 1 / unimplemented 2 / needs-review 10`. A mostly-`needs-review` ledger is a pass per §4.2; the missing evidence is the next audit's worklist.

**Presence inventory** (which determines the row count, and is not derivable from the kind list): `enforcement_semantics = "presence"` is stamped at exactly one site, `candidate_command.rs:1240`, reached from one caller, so the presence-capable kinds are exactly the three `FAMILY_SPECS` kinds — `api_route_requires_auth_helper`, `api_route_requires_request_validation`, `api_route_requires_rate_limit`. `PRESENCE_PROMOTABLE_CONVENTION_KINDS` in `capabilities.ts` agrees, and the checker asserts the two lists agree.

| Cell | Why `needs-review` |
|---|---|
| `api_route_requires_service_delegation` × graph | **The most D1-shaped thing in the run.** A candidate is readily obtainable (32 of 79 fixtures) and accepts cleanly, yet produced **zero findings on all ten fixtures probed**, including violation-shaped ones. No quarantine citation exists. Reported as an observation, not declared a P0. |
| `api_route_requires_request_validation` × presence | proposer has emission code, but no fixture in the corpus induces a candidate, so acceptance cannot be driven through the documented workflow — `unimplemented` is therefore unavailable |
| `api_route_requires_rate_limit` × presence | as above |
| `api_route_requires_request_validation` × validation proof | as above |
| `api_route_forbids_untrusted_ssrf` × phase-6 | as above |
| `api_route_forbids_raw_sql_without_params` × phase-6 | as above |
| `api_route_requires_csrf_for_mutation` × phase-6 | as above |
| `api_route_requires_rate_limit` × phase-6 | as above |
| `api_route_requires_tenant_scope` × phase-4 | as above (emission site `candidate_command.rs:587,603`) |
| `api_route_requires_authorization` × phase-4 | as above |

**The one `quarantined` cell** cites `packages/core/src/capabilities.ts:197-219` (`UNIMPLEMENTED_CONVENTION_KINDS`, naming `middleware_must_cover_routes`) plus `convention-candidates.ts:49-55`, and its canary asserts `conventions accept` exits 1 with that message.

**A correction to §4.2's premise:** the per-symbol auth path is **not** quarantined in the "produces no findings" sense, so it could not be assigned `quarantined`. `--experimental-security` gates candidate *visibility* and `--accept-defaults`, not enforcement; a candidate accepted by explicit id through the documented workflow reaches `build_auth_boundary_proof` and produces findings. It is `firing`, with evidence.

---

## 6. Merge gate (§9.4.6) — evaluated, and NOT passed

| Condition | Status |
|---|---|
| `pnpm verify:ci` green | ❌ **FAILS** — `release-hygiene > runs an executable beta proof` |
| `pnpm verify:evals` green with every delta predicted and named | ❌ **FAILS** — `eval:external` exits 1; and the `baselined` deltas are named but were not predicted in magnitude |
| every §7 row met with evidence, or deferred under a pre-decided branch | ✅ met |
| no track in `blocked` state | ✅ met |

### Blocker 1 — pre-existing, not this work's doing
`run-beta-proof.mjs` fails on CLI/MCP parity: `parser_gaps.records: cli=[] mcp=undefined`. **Reproduced on a clean checkout of `255f2208`** in a separate worktree, and independently by three tracks. It belongs to the in-flight W7 parser-gap work (`bfe1e14e`, `ee0b1f33` on `remediation/w7-detection`), not to this remediation. Not fixed here, because absorbing another branch's unmerged work to make a gate go green is the same act as blessing a baseline.

### Blocker 2 — `eval:external` red at baseline, root-caused
5 of 7 repos failed `packet_within_envelope_budget` at `255f2208` before any change here. Cause: `f3f81257` (W4 item D-A5) added itemized parser-gap `records` to the `scan status` payload, which `prepare --json` embeds wholesale — **359,973 of 714,662 bytes on openstatus, 50.4% of the envelope**. BB-6 had already removed those same records from `task_preflight_packet` after measuring them; they re-entered the same document one level up. Full diagnosis in `docs/ground-truth-audit/ENVELOPE-BUDGET-INVESTIGATION.md`. A fix exists in flight on `remediation/w7-detection`; this branch neither cherry-picks it nor blesses the baseline.

This work **improved** it: failures went 5 → 3 (formbricks and papermark crossed back under budget, because D2 removes one `exported_symbol` fact per default-exported declaration and symbol nodes are built only from those facts, shrinking `graph_context` — papermark's envelope measured at 437,050 bytes after, 63 KB under budget).

### Blocker 3 — unpredicted `baselined` magnitudes, flagged for human review
D5.2 reduces pre-existing baselined findings on the held-out repos: `dub 397→346`, `calcom 39→28`, `papermark 264→237`, `openstatus 30→15`. This is the *intended direction* of a precision fix, and detection is proven intact by two independent oracles — `eval:evasion` catches every injected violation shape (91 cells, no change vs baseline) and `eval:presence` reports `fp=0, fn=0` on 100 synthetic cases per cell. **But the magnitude was never predicted**, and openstatus losing half its findings deserves a human eye before anyone re-blesses the baseline. Under §9.4.4, an unpredicted delta is a stop, not a bless — so it is reported, not pinned.

---

## 7. The regression this run caught, and how

Worth recording, because it is the strongest argument for the process the TDD specifies.

D5.2 shipped and merged with a green local suite: `cargo test` 352/352, targeted e2e 17/17, its own red-tests verified genuinely red at baseline. **T3 #2 then found it had broken enforcement across every held-out repo.**

| Signal | T3 #1 (before D) | T3 #2 (after D) | T3 #3 (after correction) |
|---|---|---|---|
| `eval:evasion` | no change, 91 cells | **39 failing shapes, 7 repos** | no change, 91 cells |
| `eval:presence` | no change | **`false_negatives 0 → 50`** | no change, fp=0 fn=0 |
| `S01-control-canonical` | warned / blocked, PASS | **evaded, FAIL** | blocked, PASS |

**Cause.** `classify_value_consumption`'s `unary_expression` and comparison arms returned a hardcoded `Inert` instead of `terminal`, discarding `is_member_read`. That asymmetry is the classifier's entire licence to suppress: a member read of a generated enum is one value, the bare binding is the whole datastore handle. `evasion-matrix.mjs:167` marks injected imports used with `const __h = <binding>; void __h;`, which took the discarding path. Two further fail-open paths were closed with it: zero occurrences now yield `Unresolved(no_use_found)`, and a tree-sitter parse containing ERROR nodes yields `Unresolved(source_unparsed)` rather than being treated as understood.

**Both of the lead's stated hypotheses were wrong** (unrecognised import shapes; unreadable source) and the correcting agent falsified them with instrumented evidence rather than accepting them — namespace, dynamic-import and require bindings classify correctly, proven by fixture routes passing at baseline.

**What made this catchable:** the eval baselines still recorded the correct pre-regression behaviour. A single `--update` at any point would have pinned a 50-false-negative enforcement hole as expected behaviour — the `397 → 0` incident's exact shape. Nothing was blessed by any subagent at any point.

---

## 8. Baseline deltas blessed

Exactly one, by the lead, at integration, with the prediction written before measuring.

| Artifact | Prediction (written first) | Observation |
|---|---|---|
| `test/e2e/golden.test.ts` express `facts_count` | 22 → 23, delta +1. Derivation: `node-express-api/src/server.ts:8` is `export { app };`, precisely D3's defect — no `exported_symbol` fact before, one after. No other field should move, since `app` is neither a route nor a data-layer symbol. | **22 → 23.** `candidate_kinds`, `engine_source`, `files_indexed`, `diagnostics_count` all unchanged. Match. |

Re-recorded by hand-editing the single value, **not** with `vitest -u`, which takes no argument and re-records every snapshot in a run from one invocation.

**No `*-baseline.json` was edited.** `scripts/external-eval-baseline.json`, the evasion matrix baseline, the bench baseline and the presence baseline are all untouched.

---

## 9. Before/after eval numbers

| Eval | Baseline (`255f2208`) | Final (T3 #3) |
|---|---|---|
| `eval:external` | 5 repos failing, all `packet_within_envelope_budget` | **3 repos failing**, same single assertion, no new `failed_assertions` name |
| `eval:evasion` | 91 cells, no change vs baseline | **91 cells, no change vs baseline**, exit 0 |
| `eval:bench` | 0/56 refusals, ratchet ok | **0/56 refusals, ratchet ok**, exit 0 |
| `eval:determinism` | 7/7 deterministic | **7/7 deterministic**, exit 0 |
| `eval:presence` | 9 cells, no change | **9 cells, no change**, exit 0 |
| `cargo test -p drift-engine` | 313 passed | **355 passed**, 0 failed |
| `test/e2e` | 2 failed (both `release-hygiene`, pre-existing) | **1 failed** (`beta:proof`, pre-existing), 124 passed |

---

## 10. Prompt-vs-spec conflicts

Full log with resolutions in `docs/ground-truth-audit/CONFLICTS-LOG.md`. Summary:

1. **State-DB migration** — void per the launcher, despite §5.1 calling it "the obvious remedy" and §1.1 noting 26 migrations to follow. Not written.
2. **Red-at-baseline** = post-0a commit (`ea9e774c`), never `255f2208`, per the launcher over §9.4.6's stale bullet.
3. **Where 0a's red assertions live** — spec genuinely ambiguous (§4.1 vs §9.4.3). Resolved: **0a lands green**; defect tests land with their tracks, so parallel tracks do not all inherit a failing base and §9.4.3's "apply only the new test" has meaning.
4. **Recorded audit state too large to commit** — 220 MB, papermark's DB alone 189 MB. JSON/text evidence committed (1.5 MB); binary state recorded in a checksummed manifest and preserved in a durable backup.
5. **`eval:external` red at baseline** — §6 and §9.4.6 assume it is green. Root-caused, not absorbed, not blessed.
6. **§5.2's S2 experiment needs `eval:external`, which §9.4.5 forbids subagents from running** — split: Track B ran the cargo half, the lead ran the eval half.
7. **§10's "8 → 6" spans two fixtures** — corrected in Track B's brief before it could hunt for two phantom facts.
8. **Ledger CI enforcement is integration-branch-only and cell transitions are the lead's** — launcher override, implemented as specified.
9. **§5.5's "extend `gt-data-access`" collides with §5.4's exact-four assertion** — Track D built a separate fixture rather than edit another track's test.

---

## 11. Artifacts

- Audit corpus: `test/fixtures/gt-*` (deviations recorded in `test/fixtures/GT-CORPUS.md`)
- Raw audit evidence: `docs/ground-truth-audit/`
- Durable backup of `/tmp/gt-audit/`: `~/drift-falsification/gt-audit-backup-2026-08-16/` (originals left in place)
- Branches, all inspectable: `remediation/gt-track-{a,b,c,d}`, `remediation/gt-track-a-ordered`, `remediation/gt-track-a-presplit`

`main` is still at `255f2208`.

---

## 12. Post-merge reconciliation with `main` (W1–W7)

`main` advanced 23 commits during this run. The branch was reconciled at `80a9f6e3`; §§1–11
above are the pre-reconciliation record and are left intact as a dated snapshot.

**What changed in reconciliation:**

- **D3 dropped as redundant.** Upstream's `90a76c74` ("W7 D-S2 — a bare export list is an export")
  fixes the same defect with a deeper analysis. The hazard was real: `facts.rs` auto-merged with
  **both** emission paths present, which would have emitted the fact twice. Ours was removed and
  verified — `gt-fact-extraction2` yields exactly 3 `exported_symbol` facts, `internalHelper` once.
  Upstream places a renamed local export's binding in `value`, not `imported_name`; that is now the
  shipped model, and §5.3's C4 claim to the contrary is superseded.
- **D4 split.** The `data-access` bare-substring fix ships. **The `db` boundary narrowing was
  dropped** in deference to upstream's documented decision (`data_access.rs`: "`db` is matched
  loosely rather than at a boundary, and deliberately"). The reason is not deference alone: `dbg`
  and `dbutils`, `imdb` and `appdb`, are **lexically identical shapes**, so no boundary rule can
  separate the audit's measured false positives from upstream's real data layers. D4 as specified
  trades measured FPs for unmeasured FNs with no principled discriminator. Filed as a follow-up
  with the audit's measurement, upstream's counter-argument, and the recommendation that the
  discriminator must be **content** (a data-operation fact), not the name.
- **The cell-ledger derivation was stale**, not the ledger: it regexed symbols W5/W7 deleted.
  Re-pointed at `vocabulary/vocabulary.json`. **Same 18 cells, same states.**
- **The pre-existing `beta:proof` blocker cleared** — by W7's fix arriving through the merge,
  which is exactly the route §6 predicted. It was not worked around.

### Verification after reconciliation — everything green

| Check | Result |
|---|---|
| `cargo test -p drift-engine` | exit 0 — **368 passed / 0 failed** |
| `npx vitest run test/e2e` | exit 0 — **27 files, 125 passed / 0 failed** |
| `eval:evasion` | exit 0 — **no change vs baseline, 91 cells** |
| `eval:presence` | exit 0 — **no change vs baseline**, fp=0 fn=0 |
| `eval:bench` | exit 0 — **0/56 refusals, ratchet ok** |
| `eval:determinism` | exit 0 — **7/7 deterministic** |
| `eval:external` | **all 7 repos `ok`** — every assertion passes |
| `check:cell-ledger` | exit 0 — 18 cells, 5/1/2/10 |

This is the first fully-green `test/e2e` of the project.

### The one remaining diff, now explained rather than blessed

`eval:external` exits 1 solely because its baseline diff is non-empty. The only fields that moved
are `baselined` counts: `dub 400→349`, `calcom 39→28`, `papermark 264→237`, `openstatus 34→17`.
No assertion fails; `packet_within_envelope_budget` is gone entirely (W7 fixed it).

That magnitude was never predicted, so per §9.4.4 it was investigated rather than blessed.
**Investigated on openstatus, the largest proportional drop:** every route file importing
`@openstatus/db*` is still flagged — 9 distinct files, **zero importers unflagged**. So no file
lost coverage. The reduction is dominated by **D5.1 grouping** (`import { and, count, eq, gte,
inArray, lte } from "@openstatus/db"` was six findings and is now one) plus D5.2 suppressing
genuinely inert specifiers. Corroborated independently by `eval:evasion` (every injected violation
shape still caught) and `eval:presence` (fp=0, fn=0 on 100 synthetic cases per cell).

**No baseline was re-recorded.** `scripts/external-eval-baseline.json` remains exactly as upstream
wrote it at `07bdbb6f`, so the diff stays visible to the next reader rather than being absorbed.
Re-blessing it is a deliberate, separate decision for a human.
