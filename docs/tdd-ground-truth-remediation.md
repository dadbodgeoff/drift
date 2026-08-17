# TDD: Drift Ground-Truth Audit Remediation

| | |
|---|---|
| **Status** | v2.3 — execution-ready; all blocking decisions pre-decided, orchestration model in §9.4 |
| **Author** | Geoff Fernald (w/ Claude) |
| **Date** | 2026-08-16 |
| **Baseline** | `255f2208` (`Merge pull request #113 from dadbodgeoff/remediation/w1-w4-foundations`, 2026-08-15 22:01) |
| **Repo** | `/Users/geoffreyfernald/drift-falsification/drift` — **not** `driftv2`, see §0 |
| **Source** | Ground-Truth Audit of `255f2208` (see `/tmp/gt-audit/`, to be committed alongside this doc) |
| **Reviewers** | TBD |

**What changed in v2.** Every defect claim was re-verified against the code at `255f2208`. D1 and D4 confirmed verbatim. D2, D3, and D5 are real but were misdiagnosed in ways that change their fixes. Two design "ambiguities" turned out to be already-implemented conventions. The proposed D1 fix, as written in v1, would not have worked — it introduces a `source` value that an existing allowlist rejects. Details in §1.1 and inline. **All v1 code-site citations were wrong about the file path** (`crates/drift-engine/src/…`, not bare filenames).

---

## 0. Where this work happens

The audit and this remediation target `/Users/geoffreyfernald/drift-falsification/drift`, whose `main` is at `255f2208`. Three landmines for anyone picking this up:

1. **`/Users/geoffreyfernald/driftv2` is a different codebase lineage.** It has no `crates/drift-engine/` at all; its `main` (`3a1e1a40`) does not contain `255f2208`. Do not open a PR there.
2. **`/Users/geoffreyfernald/drift-audit-baseline` is a decoy.** Despite the name, its HEAD is `7123160b` (2026-08-03) on a different lineage; `255f2208` is not in its history, and its `facts.rs`/`candidate_command.rs` differ from the audited code. The audit artifacts in `/tmp/gt-audit/` are timestamped 2026-08-15 22:08–22:22, immediately after `255f2208` landed — the falsification repo is the audited tree.
3. **`/tmp/gt-audit/` is on a temp filesystem.** Phase 0's first commit should be the fixture move, before anything reboots.

**Action:** state the repo path and baseline SHA in the PR description of every PR in this series.

### 0.1 How much to trust this document

v2's corrections were produced by reading the code at `255f2208`. They are not uniform in reliability, and one was wrong in review, so triage them by class:

| Class | Status | Examples |
|---|---|---|
| **Quoted code** — a line printed from the file | Trust; re-check is a `grep`, not a judgment call | C1's three citations, C3, C4, C5, C6, C9 |
| **Measured from audit artifacts** | Trust the arithmetic, check the query | C7's 35-findings-over-30-lines breakdown |
| **Inferred about a document not opened** | **Do not trust without reading the source** | An earlier revision asserted the audit's 85.7% recall denominator included `WidgetShape` and needed recomputing. It did not — the audit excluded the interface deliberately. The claim was reasoned backwards from the fixtures rather than read from the audit report. Corrected in §5.3. |

Because C1 rewrites the whole D1 fix on the strength of three line references, those three were re-verified by direct print after the above error surfaced:

- `security_patterns.rs:266` — `if !matches!(source.as_str(), "contract" | "schema" | "candidate") { return None; }` ✅
- `security_facts.rs:911–913` — `if let Some(accepted) = accepted_phase5 { for field in &accepted.sensitive_response_fields { facts.push(sensitive_field_fact(file_path, 1, field)); } }` ✅
- `security_check_repo_phase5.rs:60,178,291` — `"source": "contract"`, and no other `"source"` value anywhere in that file ✅

Re-run these three before the D1 PR opens anyway; it is a ten-minute grep against a fix whose entire design rests on them. **And note the structural protection:** D1's red test asserts the finding row exists end-to-end through the CLI workflow. If any citation here is wrong, that test stays red and the fix cannot no-op the way v1's would have — which is the concrete reason §3 requires the workflow-level red test to land *before* the fix, not alongside it.

### 0.2 Architecture orientation — read this instead of re-auditing

Everything below was verified by direct read at `255f2208` on 2026-08-16. It exists so an implementing agent does not spend context rediscovering the layout. Citations are `file:line`; trust them at the §0.1 "quoted code" level.

**Baseline pre-verified (2026-08-16).** Working tree clean, `git log -1` = `255f2208`, `pnpm build:engine` exit 0, `pnpm test:engine` exit 0. Both `target/debug/drift-engine` and `target/release/drift-engine` are present. You still re-run these (prompt step 1–3) — a stale binary or a tree someone dirtied since is exactly what the check is for — but the plan is known to start from green.

#### Repo layout

| Path | What |
|---|---|
| `crates/drift-engine/src/` | The Rust engine. All five defects live here except D1's accept-path half. |
| `crates/drift-engine/tests/*.rs` | Rust integration tests (~30 files) |
| `packages/cli/` | The TypeScript CLI — `runCli`, command implementations in `src/commands/`, accept logic in `src/domain/` |
| `packages/storage/` | SQLite state: `sqlite-storage.ts`, `migrations.ts` (26 id-keyed migrations) |
| `packages/core`, `query`, `mcp`, `factgraph`, `adapters`, `engine-contract` | Supporting TS workspace packages |
| `test/e2e/*.test.ts` | Vitest e2e suite that drives the **real CLI** |
| `test/fixtures/<name>/` | Fixture repos, flat-named (`next-api-direct-db`, `security-sensitive-leak`, …) |
| `scripts/` | Eval harnesses + their `*-baseline.json` files |

#### The two test layers — and which one can see the seam

This is the single most important architectural fact in the plan, because it is why D1 survived.

- **Rust layer** (`crates/drift-engine/tests/`) drives the engine binary directly: `run_check_repo` (`security_check_repo_phase5.rs:354`) spawns `CARGO_BIN_EXE_drift-engine check-repo` and pipes a JSON request in. **Facts are hand-written into that JSON** (`security_check_repo_phase5.rs:36-42`). This layer therefore cannot observe fact extraction *or* candidate proposal — it starts downstream of both.
- **TypeScript layer** (`test/e2e/`) drives the real CLI: `runCli` imported from `packages/cli/src/index.js` (`golden.test.ts:5`), fixtures copied from `test/fixtures/<name>` into a temp `repoRoot` + `stateRoot` (`golden.test.ts:10-17`), then `scan` / `start --accept-defaults` / `check` with `--json`.

**Three existing tests cover D1's convention kind, and all three bypass the seam:**

1. `security_check_repo_phase5.rs:60,178,291` — hand-built contract, `"source": "contract"`.
2. `test/e2e/security-sensitive.test.ts:175` — hand-built convention, `"source": "contract"` again.
3. That same test injects the convention with `storage.upsertAcceptedConvention(...)` (`security-sensitive.test.ts:105`), writing straight into the state DB — so even the CLI-driving layer never runs `drift conventions accept`.

**Therefore the D1 red test's defining property is negative:** it must obtain its convention from the candidate proposer via `drift start` → `drift conventions accept`, and must never call `upsertAcceptedConvention` or hand-write a `requires` block. Any test that injects a convention is reproducing the blindness that let the P0 ship, no matter how end-to-end the rest of it looks.

#### The documented workflow, exactly

```
drift scan       --repo-root <r> --state-root <s> --json
drift start      --repo-root <r> --state-root <s> --accept-defaults --json
drift --db <path> conventions accept <candidate_id> --severity warning --mode warn --confirm --json
drift check      --repo-root <r> --state-root <s> --json
```

The `conventions accept` form is quoted from `packages/cli/src/args/help.ts:252`; `--confirm` is mandatory (`packages/cli/src/domain/convention-candidates.ts:60` throws without it).

#### Reading assertions out of the state DB

```ts
import { openDriftStorage } from "../../packages/storage/src/index.js";
const storage = openDriftStorage({ databasePath: scanPayload.database_path });
```
- `storage.listFacts(scanId, { kind })` — `sqlite-storage.ts:956`
- `storage.listFindings(repoId)` — `sqlite-storage.ts:1934`
- `storage.close()` when done; `golden.test.ts:19-21` shows the temp-dir cleanup pattern.

#### Build gotcha that will cost an hour if missed

`pnpm build:engine` builds **release** (`cargo build --release -p drift-engine`), but `test/e2e/security-sensitive.test.ts:32` sets `DRIFT_ENGINE_BIN` to **`target/debug/drift-engine`**. A debug build (`cargo build -p drift-engine`) is required for the e2e suite, and a stale debug binary silently tests old engine behavior against new TypeScript. **Rebuild debug before every e2e run in a track that touched Rust** — and better, make it structural: §4.1 requires the 0a harness to rebuild debug in setup and to assert `engine.checksum_matches` / `engine.path` from `drift start --json`. A note relies on being re-read at the moment of confusion, which is exactly when it will not be. This is otherwise the most likely source of a "my fix didn't take" false alarm.

#### Defect sites

All five defects' verified `file:line` citations are in §10. Do not re-derive them; spot-check per prompt step 4.

---

## 1. Background

A falsification-style audit hand-built ground truth for six capabilities and measured Drift's actual output. It validated real strengths — deterministic output across independent runs, exact diff-scoped mutation detection, and quantitatively exact exemplar inference — and found five defects.

| ID | Defect | Class | Severity | v2 status |
|----|--------|-------|----------|-----------|
| **D1** | `api_route_forbids_sensitive_response_fields` structurally cannot fire. | Structural dead path | **P0** | **Confirmed verbatim**; mechanism re-diagnosed, fix rewritten |
| **D2** | `export default function` emits two `exported_symbol` facts. | Fact over-count | **P1** | **Confirmed**, but it is a *deliberate, test-pinned* invariant — see §5.2 |
| **D3** | `export { name }` emits no `exported_symbol` fact. | Fact miss | **P1** | **Confirmed for the local form only**; re-export forms already work — scope shrinks |
| **D4** | `is_data_access_source` matches `db` by bare substring. | Heuristic FP | **P1** | **Confirmed verbatim**; `data-access` has the same bug, unreported |
| **D5** | `@prisma/client` findings fire on type/enum-only imports. | Heuristic FP + granularity | **P2** | **Confirmed**, but v1's Phase 1 is a near no-op — see §5.5 |

### 1.1 Corrections to the v1 diagnosis

These are the findings that change the work, listed once here and expanded in §5.

| # | v1 claim | Verified reality | Consequence |
|---|---|---|---|
| **C1** | `source` collides *provenance* with *lifecycle*; fix by promoting to `"accepted"` on accept. | `source` is **provenance only**, and it **round-trips**: extraction emits `"schema"`/`"candidate"` → accept persists → `security_patterns.rs:266` re-parses under allowlist `{contract, schema, candidate}` → `security_facts.rs:913` **re-emits accepted fields as facts** → `security_proof.rs:784` filters. | **v1's fix silently fails.** `"accepted"` is not in the allowlist, so `accepted_sensitive_response_field` returns `None`, the field is dropped, and the check still never fires — with no error. §5.1 rewritten. |
| **C2** | "Nothing anywhere required this kind to produce even one finding." | `crates/drift-engine/tests/security_check_repo_phase5.rs` **does** assert findings for this kind — using `"source": "contract"` (lines 60, 178, 291), a value `candidate_command.rs` never emits. `candidate_inference.rs:1390–1488` covers the proposer half. | Both halves were tested; only the seam was not. Strengthens the canary case but **changes the canary rule** — see §4.2. |
| **C3** | D2 is "likely two extraction arms both matching; confirm during implementation." | It is deliberate. `facts.rs:731` guards the default arm with `first_named_declaration_identifier(...).is_none()`; `facts.rs:805–825` then emits **both** names on purpose. `tests/default_exports.rs:50–63` explicitly asserts both, and the file header ties it to an EW-4 fix for false "unresolved symbol" refusals against `@calcom/prisma`. | D2's fix **deletes an asserted invariant tied to a production refusal-rate regression**. Needs a justification and a regression guard, not a dedup. §5.2. |
| **C4** | D3 needs a full export-specifier matrix incl. aliases and re-exports; `export *` out of scope. | `reexport_value_identifiers` (`facts.rs:899`) already handles `export {x} from`, `export {a as b} from` (EW-4 keeps **both** names via `imported_name`, not `value`), and `export * as ns from`. `export_star_sources_by_file` + `chain_closed` (S1-05) already resolve `export *`. | Only the **local** `export { x }` (no `from`) is missing — it needs a `source` child that a local export lacks. Four of v1's five matrix rows are already done. §5.3. |
| **C5** | Type-only exports need a decision (`export interface WidgetShape` ambiguity). | Already decided in code. `first_named_declaration_identifier` (`facts.rs:1163`) matches only `function_declaration`, `generator_function_declaration`, `class_declaration`, `lexical_declaration`, `variable_declaration` — never `interface_declaration`/`type_alias_declaration`. `facts.rs:911,933` skip `type ` specifiers; `facts.rs:733`'s comment states the rule for default exports. | **Document, don't decide.** §5.3. |
| **C6** | D5 Phase 1: "skip `import type` … ships with this remediation." | Already implemented: `facts.rs:835` returns empty for `import type …`; `facts.rs:865` skips inline `type` specifiers. | The 35 papermark findings are **plain value imports of enums/types** — Phase 1's type-skip yields **zero** reduction. §5.5. |
| **C7** | "One import line fans out to one finding per specifier" (implied large win). | Measured from `papermark-findings-raw.json`: 35 findings across **30** import lines; only 4 lines carry >1. | Grouping reduces 35 → 30. Real, worth doing, but not the fix. §5.5. |
| **C8** | Canary: nine convention kinds, one fixture each. | Nine named kinds is correct, but the dispatch has **eight arms**, and `is_presence_convention` (`check_command.rs:1712`, keyed on `matcher.enforcement_semantics == "presence"`) intercepts **before** the kind arms. Presence is stamped **per candidate, not per kind** (`candidate_command.rs:1240` + comment). The per-symbol variants route to `build_auth_boundary_proof`, which is **deliberately quarantined**. | Coverage surface is (kind × enforcement path), not nine cells. A naive "every kind must fire" rule would raise **false P0s against intentional quarantine**. §4.2 rewritten. |
| **C9** | D4 is a `db`-only boundary bug. | `data-access` is also a bare `lower.contains("data-access")` (`candidate_command.rs:382`). Separately, extension stripping feeds only the `DATA_LAYER_TYPE_SURFACES` check; the token tests run on `lower` **with** the extension, so `db.ts` matches via `/db` but never via `ends_with("db")`. | Fix must cover `data-access` and settle which string the tokens match. §5.4. |

**Good news from the audit:** `packages/storage/src/migrations.ts` exists with 26 id-keyed migrations and a `schema_migrations` table — so if a state migration is ever authorized (it is **not** in scope here, see §5.1 compat), it has a home and a pattern to follow.

### Why D1 is P0

Unchanged from v1, and the code audit sharpens it: a user can enable the check, see it report clean, and be *provably* incapable of being warned. It is also representative of a defect **class** — a dead seam between two individually-correct, individually-tested components — so its fix includes process guardrails, not just a patch.

---

## 2. Goals

1. Every defect D1–D5 fixed, each proven by a test that fails at `255f2208` and passes after the fix.
2. The audit's fixtures and methodology converted into a permanent, CI-enforced regression suite.
3. A structural guardrail ensuring no convention kind can ship in a cannot-fire state again — **without** flagging deliberately quarantined paths as defects.
4. Validated strengths (determinism, diff scoping, exemplar inference) pinned by tests before any refactoring near them.

### Non-goals

- Verifying exemplar *accuracy* for `api_route_requires_service_delegation`, `api_route_requires_tenant_scope`, `api_route_requires_authorization` (audit's declared unverified scope; follow-up).
- Re-architecting candidate inference or the proof engine beyond what the fixes require.
- Promoting `build_auth_boundary_proof` out of quarantine. Its quarantine is a documented decision (`docs/architecture/security-heuristic-audit.md`); this doc **records** it, it does not revisit it.
- Tracking type-only exports as first-class symbols (§5.3 documents the existing decision).

---

## 3. Guiding principle: test-first, workflow-level

Every fix follows: **Red** (fixture + test failing at baseline for the audited reason) → **Green** (smallest change) → **Regressions** (full suite + golden suite + held-out re-checks).

C2 is the sharpest possible statement of why unit tests are insufficient: both halves of D1 *were* tested. `security_check_repo_phase5.rs` proves the prover works by handing it `source: "contract"`; `candidate_inference.rs` proves the proposer proposes. Neither could observe that the proposer emits a value the prover discards. **The primary test layer for conventions is therefore end-to-end through the documented CLI workflow** (`drift start` → `drift conventions accept` → `drift check --scope full`), asserting on the resulting `facts`/`findings` SQLite tables — the audit's own observation method.

**New rule (from C2):** a test that constructs an accepted contract by hand does not count as coverage for a convention kind. Hand-built contracts may pin prover behavior, but every kind needs at least one assertion driven by a contract that `candidate_command.rs` actually produced. Add this to the test guidelines in §4.3.

---

## 4. Phase 0 — Regression infrastructure

**Revised scope (see §6).** v1 put the entire infrastructure build ahead of the P0. Phase 0 is now split: **0a** is the minimum D1 needs and lands with it; **0b** runs in parallel with D2–D5.

### 4.1 (0a) Golden fixture suite — **mostly wiring, not building**

**CORRECTION to v2.2's language decision.** v2.2 chose Rust under `crates/drift-engine/tests/`, reasoning that the Rust suites "already build repos on disk and drive the engine." They do build repos — but they drive the engine with **hand-written facts** (§0.2), so that layer structurally cannot observe extraction or candidate proposal. Building 0a there would have reproduced D1's blindness in the very harness meant to catch it. **The harness is TypeScript, in `test/e2e/`.**

**And most of it already exists.** `test/e2e/golden.test.ts` is `run_workflow`: temp `repoRoot` + `stateRoot`, fixture copied from `test/fixtures/<name>`, `runCli([...])` through scan → start → check, assertions on parsed `--json` output (`golden.test.ts:10-50`). `test/e2e/security-sensitive.test.ts` is `db_assert`: `openDriftStorage({ databasePath })` plus `listFacts` / `listFindings` (§0.2). 0a is therefore **wiring an existing pattern to new fixtures**, not standing up infrastructure.

**Fixtures go in `test/fixtures/<name>/`**, flat-named alongside the existing ~30, not in a new nested tree:

```
test/fixtures/
  gt-fact-extraction/          # 3-file Next.js pages-router mini-repo
  gt-fact-extraction2/         # arrow fn, class, interface, local export{}
  gt-data-access/              # 4 genuine + 4 near-miss modules, 8 routes
  gt-auth-helper/              # requireAuth conformance/violation trio
  gt-sensitive-fields/         # route-leak / route-safe pair
  gt-sensitive-fields-schema/  # driftSensitive-marker variant
test/e2e/
  gt-golden.test.ts            # the workflow + assertions
```

The `gt-` prefix keeps the audit corpus greppable as a set without nesting it away from the harness that already knows how to find `test/fixtures`.

**These paths are canonical.** Elsewhere this document (and the audit) calls them by bare names — `fact-extraction`, `data-access`, `sensitive-fields` — and earlier drafts referenced a `golden/` directory that does not exist. Those are shorthand for the `gt-`-prefixed directories under `test/fixtures/`. **Resolve every fixture reference to this table**, and note that rule 2's red test is exactly what a wrong fixture path kills: a missing directory is a setup failure, which proves nothing.

**Harness contract.** Onboard into a temp state root, **obtain the convention from the proposer** (`drift start` → `drift conventions accept <candidate_id> --severity … --mode … --confirm`), run `check`, assert on normalized `facts`/`findings` rows with volatile ids excluded.

**Two guards the harness must build in, not document.** The debug/release split (§0.2) will otherwise surface as an inexplicable failure an hour into a track:

1. **Rebuild debug in setup** — `cargo build -p drift-engine`, so a stale `target/debug/drift-engine` is impossible by construction.
2. **Assert engine identity** — `drift start --json` already reports `engine.checksum_matches`, `engine.path`, and `engine.source` (verified in the audit's `sensitive-start.json`). Assert `checksum_matches === true` and that `engine.path` is the intended binary. A wrong or stale engine then fails loudly at setup with a legible message.

> **The one hard rule, from §0.2:** never call `storage.upsertAcceptedConvention` and never hand-write a `requires` block. All three existing tests of D1's kind do exactly that, which is why a P0 shipped under their coverage. A test that injects its convention is not evidence for any conclusion this plan draws.

**Blessing — and a hazard the snapshot approach introduces.** The suite uses vitest inline snapshots (`golden.test.ts:34`, `toMatchInlineSnapshot`), so `vitest -u` is the existing bless path and no custom `--bless` flag is needed. **But this is strictly more dangerous than the flag v1 specified**, and §9.4.4's discipline must be read as covering it: `-u` takes no argument, every TS-fluent agent knows it reflexively, and a single invocation re-records **every** snapshot in the run. That is the `397 → 0` shape with a shorter fuse. Hand-editing an inline snapshot block is the same act by another route and is equally forbidden.

**Prefer explicit assertions for §7's gate rows.** `expect(findings).toHaveLength(4)` cannot be silently re-recorded en masse; a snapshot can. This is also the house majority — only `golden.test.ts` uses inline snapshots; the rest of `test/e2e/` asserts explicitly.

**Scope of 0a:** the harness wiring plus the fixtures D1 needs — `gt-sensitive-fields`, `gt-sensitive-fields-schema`, and `gt-data-access` as a known-good control. The rest land with their defects. Expected values are written to **post-fix** ground truth, so at baseline the suite is red exactly where the audit said it would be.

### 4.2 (0b) Canary tests — revised rule

v1's rule ("a convention kind without a demonstrated true positive is presumed broken") would, applied literally, raise P0s against `build_auth_boundary_proof`'s per-symbol path, which is quarantined **on purpose** (C8). Revised:

> **Rule.** Every (convention kind × enforcement path) cell must be in exactly one of four states, declared in a checked-in ledger. **Each state requires a specific artifact as evidence — a cell may only be assigned the state whose evidence the agent actually holds:**
>
> | State | Evidence required to assign it |
> |---|---|
> **(a) firing** | A passing canary test driving the documented workflow: ≥1 finding on a violation fixture, 0 on a conformance fixture. |
> **(b) quarantined** | A **citation** — an existing doc path or code comment stating the quarantine (e.g. `docs/architecture/security-heuristic-audit.md`, or the `presence_findings` header) — *plus* a test asserting it produces no findings. A citation the agent cannot locate is not evidence. |
> **(c) unimplemented** | A passing test proving the proposer emits no candidate of this shape. |
> **(d) needs-review** | The default. Assigned whenever (a)–(c)'s evidence could not be produced. |
>
> An undeclared cell fails CI. A cell that changes state without a ledger edit fails CI.

**Scope of that CI rule — integration branch only.** Enforcing it on track branches would break the zero-file-overlap property (§9.4.1): D1's tests move the sensitive-fields cell to `firing`, but that cell lives in the ledger, which Track C owns — so Track A would have to edit a Track C file on a branch forked before C merged. Instead:

- The ledger's CI enforcement activates **only on the integration branch**, never on track branches.
- **Cell-state transitions are made by the lead at integration time**, not inside track PRs. A track PR that earns a transition says so in its PR body and cites the passing test; the lead applies the ledger edit when merging it into integration.
- Track C therefore owns the ledger's *structure and enumeration*; the lead owns its *state values* from integration onward.

**PRE-DECIDED (was S3): `needs-review` is the required default, and it is not a failure.** An unattended agent must never assign `quarantined` by inference — that is a claim about intent, and guessing it converts an undiscovered P0 into a checked-in "working as designed," which is precisely how D1 survived. If the evidence for (a), (b), or (c) is not in hand, the cell is `needs-review`, full stop.

A ledger containing `needs-review` cells **still merges** — it is additive test infrastructure and strictly better than the current zero cells. The count of `needs-review` cells, and what evidence each one lacked, is a required line in the final report. Those are the next audit's worklist, and a run that produces a ledger of mostly `needs-review` has still done the job it was sent to do.

This catches D1 (it would have been declared `firing` with no workflow-level evidence) without manufacturing false P0s.

**Enumerating the cells.** Dispatch arms in `check_command.rs`:

| Arm | Kinds | Enforcement path |
|---|---|---|
| 1 | `api_route_no_direct_data_access` | materialized + graph |
| 2 | `api_route_requires_service_delegation` | graph |
| 3 | *(intercept)* any kind with `matcher.enforcement_semantics == "presence"` | `presence_findings` |
| 4 | `api_route_requires_auth_helper` | auth proof |
| 5 | `api_route_requires_request_validation` | — |
| 6 | `api_route_forbids_sensitive_response_fields` | phase-5 proof |
| 7 | `api_route_forbids_secret_exposure` | — |
| 8 | `api_route_requires_tenant_scope`, `api_route_requires_authorization`, `session_object_must_come_from_trusted_helper` | shared arm |

Arm 3 is the trap: it is keyed on matcher semantics, not kind, and it sits **before** arms 4–8. A convention of kind `api_route_requires_auth_helper` with presence semantics never reaches arm 4. The ledger's first column must therefore be the *pair*, and building it starts with an inventory task: enumerate which kinds `candidate_command.rs` can stamp `presence` on (`candidate_command.rs:1240` is per-candidate, so this is not derivable from the kind list).

The audit exercised three cells. Building the rest is 0b's bulk and the main reason it no longer blocks D1.

### 4.3 (0b) Near-miss fixtures as a standing convention

Recall-only fixtures let substring heuristics look perfect. Codify the audit's `dbg`/`imdb`/`prismatic`/`utils` pattern: any heuristic-driven detector's fixture must include lookalike negatives whose *content* contradicts the name signal, and the test asserts silence on them.

Document in `CONTRIBUTING.md` alongside the §3 rule about hand-built contracts.

### 4.4 (0a) Determinism gate — **already exists; wire, do not build**

v1 and v2 both specified building this. It is already built, and better than specified: `scripts/determinism.mjs` (EW-7 / DET-2), exposed as `pnpm eval:determinism`. It runs every eval repo 3× by default (`--only calcom -n 10` to focus), digests exit code + check status + finding count + every finding fingerprint and enforcement result, excludes legitimately-varying ids and timings, and **refuses to measure a worktree another process has touched** — so "it was harness contamination" becomes falsifiable either way.

**Revised task:** none for 0a beyond confirming it runs green at baseline and recording the digest. Add the golden fixtures to its repo list only if they surface something the real repos do not; the doubt this script was written for is on real repos, not fixtures.

### 4.5 (0b) Held-out repo snapshots — **already exists; wire, do not build**

Also already built. `scripts/external-eval.mjs` (`pnpm eval:external`) runs the full Drift loop against real Next.js repos, diffs against `scripts/external-eval-baseline.json`, and takes `--update` to re-bless — the `--bless` flag v1 specified. Repos resolve from `$DRIFT_EVAL_REPOS`, defaulting to `~/drift-falsification/repos`, **which is populated on this machine** (`papermark`, `taxonomy`, and others). `scripts/eval-repos.mjs` carries the per-repo table with `expectedExitCode` provenance.

Sibling evals that also gate real-repo behavior: `eval:evasion` (evasion matrix), `eval:bench` (with a ratchet test), `eval:presence` (presence precision/recall). All baseline-backed, all `--update`-blessable.

**Revised task:** record the D4/D5 matcher counts as an assertion in the existing baseline rather than standing up a parallel snapshot script. Two parallel held-out mechanisms would drift apart, and the existing one is the one CI knows about.

**Predicted-delta discipline is already implemented — use it.** `external-eval.mjs` has an O-4 mechanism requiring each accepted unsafe baseline move to be named explicitly as `<repo>:<field>`. That is §5.2.3's requirement, already enforced. The script also carries a war story worth reading before blessing anything (around line 252): a reversed regex made a `397 baselined` count parse as `0`, `?? 0` supplied a plausible zero, and the baseline was blessed `397 → 0` across every repo under cover of a "new fields" change. That is exactly the failure mode §5.2.3 exists to prevent, it has already happened here once, and it is the reason the predicted delta must be written down *before* the run, not rationalized after it.

### Exit criteria

- **0a:** harness runs in CI; `sensitive-fields` assertions red for the D1 reason; determinism gate green. *(Unblocks D1.)*
- **0b:** ledger checked in with every (kind × path) cell declared and tested; near-miss convention documented; held-out snapshot script committed.

---

## 5. Fix designs

### 5.1 D1 — Sensitive-response-fields dead path (P0) — **rewritten**

**Verified root cause.** Both sites confirmed verbatim:

- `crates/drift-engine/src/candidate_command.rs:642` — `"source": "candidate"`, hardcoded into every proposed field.
- `crates/drift-engine/src/security_proof.rs:784` — `.filter(|field| field.source != "candidate")`.

**What v1 got wrong (C1).** `source` is not a provenance/lifecycle collision. It is provenance, and it survives a full round trip:

```
security_facts.rs:917-934   extract → source = "schema" (driftSensitive marker)
                                    or "candidate" (name heuristic)
candidate_command.rs:642    propose → source OVERWRITTEN to "candidate"   ← the bug
                            accept  → persisted into convention.requires
security_patterns.rs:256-272 parse  → allowlist {contract, schema, candidate}; else None
security_facts.rs:906-913   re-emit accepted fields as Facts, source from config
security_proof.rs:784       prove   → drops source == "candidate"
```

So line 784 is not filtering "unaccepted config." It is filtering **low-trust provenance** — name-heuristic guesses — and letting marker- and contract-declared fields through. That is a coherent design. Line 642 breaks it by destroying the provenance the filter depends on: a field the user explicitly marked `driftSensitive` is extracted as `"schema"`, then relabelled `"candidate"` on proposal, then discarded on proof.

**Consequence for v1's fix:** promoting to `"accepted"` fails the `matches!` allowlist at `security_patterns.rs:266`, `accepted_sensitive_response_field` returns `None`, and the field is dropped **before** it ever reaches the filter. The check would still never fire, and nothing would report an error. Had this shipped as specified, the P0 would have survived its own fix.

**Revised change.**

1. **Stop destroying provenance.** `candidate_command.rs:642` propagates the originating fact's `source` instead of hardcoding. The `sensitive_field_declared` fact already carries it in its `value` JSON (`security_facts.rs:953–968`); read it there, defaulting to `"candidate"` when absent. This alone makes the marker path (`gt-sensitive-fields-schema` fixture) fire end-to-end.
2. **The heuristic-inferred case — PRE-DECIDED (was blocking decision S1).** After (1), fields inferred by name heuristic still carry `"candidate"` and are still filtered, so the `gt-sensitive-fields` fixture (no `driftSensitive` markers) would still report zero. The question was:

   > When a user explicitly runs `drift conventions accept` on a candidate whose fields were name-inferred, does acceptance confer enough trust to enforce?

   **Decision: yes, represented as provenance rather than lifecycle.** Add `"accepted_inference"` to the allowlist at `security_patterns.rs:266`, stamped at the accept path when a `"candidate"`-sourced field is confirmed by a user. It reads as "a heuristic guess a human signed off on," which is exactly what it is, and keeps `source` single-purpose. The `784` filter then excludes only `"candidate"` — genuinely unreviewed guesses — which is what its name and intent already say.

   **Rationale for deciding it this way unattended:** `drift conventions accept` is an explicit human act against a specific, displayed candidate. A design where that act is insufficient to enforce makes the command meaningless for this kind, and leaves the P0 half-fixed — the marker path works, the path every real user actually hits does not. The opposite answer is defensible only if acceptance is understood as bookkeeping rather than authorization, which contradicts `acceptance-disclosure.ts` existing at all.

   **Consequence for tests:** both fixture paths assert **1 finding** on the leak route, 0 on the safe route. No expected-output ambiguity remains.

   **What was carved off:** the irreversible half — migrating *existing* state DBs — is deferred and must not be implemented. See the compat block below.
3. **Keep the 784 filter, document the invariant.** Add a comment stating what the values mean and that the filter is a *trust* boundary, not an acceptance boundary — the misreading that produced v1's fix.
4. **Dead-config diagnostic (defense in depth).** If a proof builder filters out *all* fields of an *accepted* convention, emit a warning in `check` output. Extend it to cover C1's failure mode: if `accepted_sensitive_response_field` returns `None` for any entry (unknown `classification` or `source`), say so loudly instead of silently dropping. Both allowlists at `security_patterns.rs:259` and `:266` fail closed and silent today.

**Compat.** Conventions accepted before this fix have `"candidate"`-sourced fields persisted and will still never fire. The obvious remedy is a migration in `packages/storage/src/migrations.ts` (id-keyed, 26 existing to follow) — **and this plan deliberately does not ship one.** Read the next paragraph before writing any migration code.

**RESOLVED — the state-DB migration is out of scope for this remediation.** §5.1.2's trust question is settled for new acceptances (yes, via `"accepted_inference"`), but the *data migration* over existing user state is deliberately **not** shipped here, and an unattended agent must not write it. Reasons, in order of weight:

1. **It is the only irreversible act in the plan.** It flattens provenance that cannot be recovered without re-scanning source for markers, and it silently converts previously-quiet checks into firing ones on state Drift's owner never re-inspected.
2. **The non-destructive path covers the same users.** §5.1.4's dead-config diagnostic tells anyone with a pre-fix accepted convention that it has no enforceable fields, and points at re-accepting. That restores enforcement by user action, with provenance recorded correctly on the way through, instead of by a one-way rewrite of their database.
3. **Nothing downstream depends on it.** Every §7 gate is met by the in-flight fix plus the diagnostic; the migration only changes how fast existing users get there.

**Deliverable instead:** a `docs/` note recording the migration as a considered-and-deferred option, carrying the two constraints worked out below so whoever authorizes it later does not rediscover them.

- *Discriminator constraint.* An unconditional "promote all accepted conventions" is wrong: a hand-authored config may say `"candidate"` deliberately, meaning "not yet enforcing," and value alone cannot distinguish that from a pre-fix Drift write. Use the migration boundary — promote only rows existing at migration time, treat later `"candidate"` as intentional.
- *Lossiness constraint.* Pre-fix, line 642 overwrote `"schema"` before persistence, so marker-derived and heuristic-derived fields are indistinguishable at rest. Any migration promotes both to `"accepted_inference"`, understating the marker ones. Harmless for enforcement (both clear the `784` filter) but it means `"accepted_inference"` on a pre-migration row reads as "was `candidate` at rest," **not** "was inferred." Nobody may build trust-weighting or UI on that value for old rows.

**Tests.**

- e2e, red at baseline: `gt-sensitive-fields-schema` → accept → check → exactly 1 finding on the leak route, 0 on the safe route, `source: "schema"` preserved into the accepted convention.
- e2e, red at baseline: `gt-sensitive-fields` → same, asserting 1 finding on the leak route via `accepted_inference`.
- Unit: proposal preserves provenance for each of `schema`/`candidate`; allowlist accepts the new value; `None` from either allowlist raises the diagnostic.
- Pre-fix state DB: open a state DB carrying a pre-fix accepted convention → `check` emits the §5.1.4 dead-config diagnostic naming the convention. **No migration test, because no migration ships** (see compat block). This is the non-destructive cover for the same user story.

  **How to build that fixture without breaking the injection ban.** §4.1's hard rule forbids `upsertAcceptedConvention` and hand-written `requires` blocks — and the only obvious ways to construct a *pre-fix* accepted convention are exactly those. The resolution: **generate it, do not author it.** In the throwaway worktree at the post-0a, pre-fix commit, run the real workflow (`start` → `conventions accept`) against `gt-sensitive-fields`, then copy the resulting state DB into `test/fixtures/` as a binary fixture with a README recording the commit that produced it. The convention is genuinely proposer-produced; it is simply produced by the *old* code, which is precisely what the test needs.

  **This is the one sanctioned exception, and it is narrow:** it applies only to constructing this negative fixture, never to a test that asserts a finding. If generating it proves impractical, assert the diagnostic on an allowlist rejection instead (an accepted convention carrying an unknown `classification`, which §5.1.4 also covers) and record the substitution — do **not** fall back to injecting a convention.
- Canary ledger: cell (`api_route_forbids_sensitive_response_fields`, phase-5 proof) moves to `firing` with workflow-level evidence.

**Closed: v1's "who else filters by `source`?" open question.** Grepped the engine — `"candidate"` appears at exactly four sites: `security_facts.rs:933` (emit), `candidate_command.rs:642` (the bug), `security_proof.rs:784` (the filter), `security_patterns.rs:266` (the allowlist). There is **no second dead seam of this exact form.** The allowlist at :266 is the fourth site and the one v1 missed; it is now in scope.

### 5.2 D2 — Duplicate `exported_symbol` for default exports (P1) — **materially revised**

**Verified.** For `export default function handler()`: `facts.rs:731`'s guard (`first_named_declaration_identifier(...).is_none()`) suppresses that arm, then `facts.rs:752` emits `(name=handler, value=None)` and `facts.rs:817` emits `(name=default, value=Some("handler"))`. Two facts, same span — exactly as the audit measured.

**But it is deliberate and pinned (C3).** `tests/default_exports.rs::default_export_of_a_declaration_still_works` (lines 50–63) asserts *both* facts exist. The file header ties the surrounding work to EW-4, which fixed false "unresolved symbol `default` from `@calcom/prisma`" refusals against `export default prisma;` — a bug the header describes as inflating the ordinary-edit refusal rate.

So D2 is not a dedup. It is a proposal to **delete an asserted invariant** in code that exists to keep import resolution from over-refusing.

**Is the fact wrong?** Yes, semantically: `export default function handler` does not create a named export `handler`, and `exported_symbols_by_file` (`main.rs:2174`) keys purely on `fact.name`, so `import { handler } from './orders'` currently resolves against a module that exports no such name. That is a real false-resolution.

**Canonical model (unchanged from v1):** one declaration ⇒ one fact; `name = "default"`, `value = <local identifier or ∅>`. `default` is what importers bind; the local identifier is metadata. Handles `export default () => …` uniformly.

**What the fix must additionally do (new):**

1. **Confront `default_exports.rs:50–63` directly — PRE-DECIDED branch (was S2).** Either the assertion is incidental regression-pinning (likely — EW-4's actual subject was the bare-identifier form at line 30) or it is load-bearing.

   **Experiment:** make the D2 change, update the assertion, then run `cargo test -p drift-engine` (specifically `import_resolution.rs`, `external_star_reexports.rs`, `runtime_provable_imports.rs`, `graph_backed_check.rs`) and `pnpm eval:external` **without** `--update`.

   **Branch, decided in advance — no escalation:**
   - *All green, and the `eval:external` delta matches the prediction* → the assertion was incidental. **D2 ships.** Update `default_exports.rs` to assert the canonical single fact, and record in the PR body that the EW-4 bare-identifier case (line 30) still passes untouched.
   - *Any of those suites red, or an unpredicted `eval:external` delta* → the assertion is load-bearing. **D2 does not ship.** Revert the D2 commit entirely, leave both facts in place, and instead add a regression test pinning the current behavior plus a `docs/` note recording the false-resolution (`import { handler }` resolving against a module with no such named export) as a known limitation with the evidence gathered. Track B then delivers **D3 only**, and the §7 D2 rows are marked `deferred — evidence in PR` rather than failed.

   Either outcome is a complete, mergeable result. The agent must not attempt a third path (e.g. reworking the resolver to preserve resolvability while dropping the fact) — that is a design change beyond this remediation's scope and is where an unattended run would go wrong.
2. **Consumer audit, with named consumers.** `exported_symbols_by_file` feeds `resolver.exported_symbols`, read at `main.rs:1446` (`is_symbol_resolvable_import` + `chain_closed`), `main.rs:1605` (`REEXPORT_RESOLVES_TO_SYMBOL` edges), and `main.rs:2253` (`resolve_import_symbol` walk). Removing a name can flip an import from resolvable to unresolvable, which is the exact regression EW-4 fixed. Each of the three needs a stated expected effect.
3. **Predicted-delta blessing (v1 gap).** v1 said "expect a delta; bless deliberately." A blessed count change is where a real regression hides inside an expected one. Require the PR to state the *predicted* delta with its derivation — *N* default-exported declarations in taxonomy ⇒ *N* fewer `exported_symbol` facts ⇒ stated node/edge effect — and fail review if observed ≠ predicted. Same requirement for D3, which adds rows.

**Tests:** golden facts for `gt-fact-extraction` assert 6 `exported_symbol` rows (was 8); anonymous-default and default-class cases added; `default_exports.rs` updated with the §5.2.1 finding recorded in the diff; determinism gate re-blessed against a predicted delta.

### 5.3 D3 — local `export { name }` missed (P1) — **scope reduced**

**Verified.** `extract_export` (`facts.rs:622`) gates re-export handling on `node.child_by_field_name("source")` — a `from` clause. A local `export { internalHelper };` has no source child, no declaration child, and is not a default export, so it falls through all four arms and emits nothing. Confirmed against `fixtures/fact-extraction2/lib/util.ts`.

**Four of v1's five matrix rows are already implemented (C4):**

| Syntax | v1 said | Reality at `255f2208` |
|---|---|---|
| `export { x }` (local) | new | **Missing — this is D3.** |
| `export { x } from './y'` | new | Already emits, via `reexport_value_identifiers` (`facts.rs:899`) |
| `export { a as b } from './y'` | new; `name=b, value=a` | Already emits, and v1's shape **conflicts with the codebase**: EW-4 keeps both names as `name=b` + `imported_name=a`, because the source name must resolve in the *target* module. `value` is not the field for this. |
| `export * from './y'` | out of scope, needs module resolution | Already resolved — `export_star_sources_by_file` (`main.rs:2192`) + `chain_closed` (S1-05) |
| `export type {T}` / `{type T}` | needs a decision | Already skipped (`facts.rs:911`, `:933`) |

**Change:** handle the local export-specifier form only. Emit `name = <exported name>`, and for `export { a as b }` follow the **established** EW-4 convention — `name = b`, `imported_name = a` — not v1's `value = a`. A local alias has no target module to resolve into, so `imported_name` records the local binding; state that asymmetry in a comment, since it differs from the re-export case's meaning.

**Re-export discriminator (v1 gap, now narrower).** v1 wanted to "flag `value`/metadata to distinguish re-export if consumers need it." The codebase already answers this: re-exports additionally emit a distinct `ReExportUsed` fact (`facts.rs:653`). No new discriminator is needed — but the *local* form must not accidentally emit `ReExportUsed`, or it will claim a module dependency that does not exist. Add a negative assertion.

**Type-only exports (C5): document, don't decide.** `export interface WidgetShape` already emits nothing, because `first_named_declaration_identifier` (`facts.rs:1163`) matches only function/generator/class/lexical/variable declarations. The rule — `exported_symbol` models **runtime** symbols; a future consumer needing type exports gets a distinct `exported_type` kind — should be written into the fact-model reference as a record of existing behavior.

**The audit's recall figure needs no restatement.** An earlier revision of this doc claimed 85.7% (6/7) counted `WidgetShape` in the denominator and had to be recomputed. That was wrong. The audit's 7 are `queryUsers`, `helperUnused`, both `handler`s, `addOne`, `Widget`, `internalHelper` — it excluded `WidgetShape` as an ambiguous type-only case from the start. 85.7% already reflects the runtime-symbols-only rule, `internalHelper` is the sole miss, and §7's 100% target is unchanged. Recorded here rather than deleted because the error is the reason §0.1 exists.

**Tests:** golden facts for `fact-extraction2` assert `internalHelper` present, alias shape follows EW-4, `WidgetShape` absent, no `ReExportUsed` for the local form; `symbol_called` facts unchanged.

### 5.4 D4 — `db` token boundary bug (P1) — **confirmed, scope widened**

**Verified verbatim** at `candidate_command.rs:378–383`:

```rust
contains_data_layer_token(&lower, "prisma")
    || contains_data_layer_token(&lower, "database")
    || lower.contains("/db")
    || lower.ends_with("db")
    || lower.contains("data-access")
```

`lib/dbg` matches `contains("/db")`; `lib/imdb` matches `ends_with("db")`. `prismatic` correctly does not match, proving `contains_data_layer_token` is boundary-aware.

**Two additions (C9):**

1. **`data-access` has the same bug** and the audit did not report it — `lower.contains("data-access")` is a bare substring, so `lib/no-data-access-here` or `legacy-data-access-notes.ts` would match. Route it through `contains_data_layer_token` in the same change; a near-miss fixture entry proves it.
2. **Settle which string the tokens match.** `without_extension` (`candidate_command.rs:363–373`) is computed but used *only* for the `DATA_LAYER_TYPE_SURFACES` check; the token tests below it run on `lower`, with the extension attached. So `lib/db.ts` matches via `/db` but never via `ends_with("db")`, and v1's claimed post-fix behavior ("`db.ts` matches") holds only by the path-separator branch. **Decided: match tokens against `without_extension`** (this closes what an earlier draft left to the implementer) — cleaner and makes `db.ts` match for the right reason — and cover both forms in the table test.

**Change:** route `db` and `data-access` through the same boundary logic. Post-fix: `lib/db`, `db/client`, `my-db`, `db.ts`, `lib/data-access/orders` match; `dbg`, `imdb`, `appdb`, `dbx`, `no-data-access-here` do not.

**Accepted trade-off:** modules genuinely named `appdb` stop matching the *name* heuristic. Document it — such modules typically also match via content or the `database` token, and a miss surfaces as a candidate gap (visible) rather than a false block (harmful).

**Tests:** `gt-data-access` golden asserts exactly 4 findings — `dbg`/`imdb` silent (red at baseline), `prismatic`/`utils` still silent, 4 genuine still caught. Unit table-test over the full boundary matrix including the `data-access` cases and both extension forms. Held-out: taxonomy stays exactly 4/4.

### 5.5 D5 — `@prisma/client` type/enum-only imports (P2) — **Phase 1 largely pre-existing**

**Measured from the audit's own output** (`papermark-findings-raw.json`, 264 findings):

| Matcher | Findings | Import lines | Distinct symbols |
|---|---|---|---|
| `@/lib/prisma` | 229 | — | `prisma` |
| `@prisma/client` | 35 | 30 | `Prisma` (11), `LinkAudienceType` (8), `ItemType` (7), `ViewType` (4), `DocumentStorageType` (2), `LinkType` (1), `RootItemAccess` (1), `DocumentVersion` (1) |

`PrismaClient` — the one genuine violation shape — appears zero times. The audit's read is correct.

**Two corrections to v1's phasing:**

- **C6 — `import type` skipping already exists.** `facts.rs:835` returns no bindings for `import type …`; `facts.rs:865` skips inline `type` specifiers. So all 35 findings come from **plain value imports** (`import { ItemType } from "@prisma/client"`), which is how Prisma's generated enums are legitimately imported. v1's Phase 1 type-skip removes **zero** of the 35. Keep a regression test asserting the existing behavior; do not book it as a fix.
- **C7 — fan-out is minor.** 35 findings across 30 lines; 4 lines carry >1 specifier. Grouping per import statement takes 35 → 30, a 14% reduction. Worth doing for message quality; it is not the precision fix.

**Revised phasing.**

- **Phase 1 (ships with this remediation):** group findings per import statement, listing offending specifiers in the message. Add a regression test pinning the existing `import type` behavior. Expected papermark effect: 35 → 30, **not** 0.
- **Phase 2 (the actual fix — separate PR, same milestone, now mandatory):** invocation evidence. For each specifier imported from a forbidden module, flag only with evidence it can touch the datastore — a `symbol_called` fact, a `new` instantiation, or a member-**call** (`x.findMany()`) as opposed to a member-**read** (`LinkType.GROUP`). No invocation evidence ⇒ suppress. This reuses Drift's own fact substrate, and is why D2/D3 land first: it inherits fact-layer precision.

**Posture conflict (v1 gap), now resolved.** v1's design principle ("require evidence it can touch the datastore" ⇒ suppress on no evidence) and its risk note ("when the extractor can't tell, keep the finding — prefer FP over FN") are opposite defaults, and v1 did not say which wins. **Resolution: suppress on *absence* of evidence; retain on *ambiguity* of evidence.** These are different states. A specifier with no invocation facts at all is inert (`ItemType` in a type position). A specifier whose use cannot be classified — dynamic member access, reassignment (`const q = db.query; q()`) — is unresolved, and there the FP-over-FN default holds. Encode the two as distinct branches, not one confidence threshold, and add both to the fixture as documented cases.

**Why this differs from D4's trade-off**, since the two look inconsistent otherwise: D4 trades recall for precision on a *name* heuristic, where a miss degrades to a visible candidate gap. D5.2 trades precision for recall on *use* evidence, where a miss is a silent unenforced datastore access. Different failure costs, different defaults. State this in the PR so the pair reads as deliberate.

**Tests:** extend `gt-data-access` with a type-only-position route, an enum-member-comparison route, an aliased-invocation route (must stay flagged), an unclassifiable-reassignment route (must stay flagged), and a multi-specifier line (one grouped finding). Held-out: papermark 229 `@/lib/prisma` unchanged; `@prisma/client` 35 → 30 after Phase 1, → 0 after Phase 2.

---

## 6. Ordering and dependencies — **revised**

v1 placed the full infrastructure build ahead of the P0. Phase 0 is now split so the P0 is gated only on what it actually needs.

```
0a  fixture move + harness + confirm eval:determinism/eval:external green at baseline
    └─ hard prerequisite for every track; nothing starts until it lands
──────────────────────────── fan out ────────────────────────────
TRACK A          TRACK B                    TRACK C
D1 provenance    D2 default-export canon.   0b canary ledger
   + allowlist      └─ S2 branch, §5.2      + near-miss convention
   + diagnostic   D3 local export specifier
D4 db/data-access
   boundary
(sequential,     (sequential, one PR)       (test infra only)
 one branch)
──────────── (T3 boundaries: see §9.2 — this diagram shows order, not gates) ───────────
TRACK D  D5.1 finding grouping + import-type regression pin
         D5.2 invocation-evidence classification   [needs B merged]
Integration → PR → merge gate (§9.4.6) → final report (§9.4.7)
```

A, B and C touch disjoint files (§9.4.1) and run in separate worktrees. D1 and D4 share `candidate_command.rs`, so they are sequential commits inside track A rather than a fourth parallel track — zero conflict surface beats a small one when nobody is watching the merge.

Each fix is its own PR (D2+D3 may share one), red-test commit first so review shows the failure → fix arc. **Every PR that changes real-repo output (D2, D3, D4, D5.1, D5.2) re-runs the held-out checks in its own checklist** — that is the enforcement point, not the release-time run.

---

## 7. Exit criteria — **now per-PR, not one terminal event**

v1 made the audit re-run a single end-of-project event, which puts the success signal last. Each row below is the gate for its own PR; the final re-run confirms rather than discovers.

| Capability | Baseline | Target | Gate |
|---|---|---|---|
| `exported_symbol` precision (fixtures) | 75% | 100% — 6 rows, 0 extras | D2 PR |
| `exported_symbol` recall (fixtures) | 85.7% (6/7 runtime declarations) | 100% (7/7); `WidgetShape` excluded by documented rule, as the audit already did | D3 PR |
| `default_exports.rs` invariant | asserts both facts | branch taken per §5.2 step 1, evidence recorded; `deferred` is a passing outcome | D2 PR |
| Graph node/edge delta, taxonomy | 1878 / 3221 | predicted delta stated and matched | D2+D3 PR |
| Data-access precision, synthetic | 66.7% (4/6) | 100% (4/4); `dbg`, `imdb`, `no-data-access-here` silent | D4 PR |
| Data-access, taxonomy held-out | 4/4, 0 FP | unchanged | D4 PR |
| Papermark `@/lib/prisma` | 229 | unchanged, 229 | D5.1, D5.2 |
| Papermark `@prisma/client` | 35 findings / 30 lines | 30 after D5.1; **0 predicted** after D5.2 — see gate note below | D5.1, D5.2 |
| Sensitive-fields, marker path | 0 (structural) | 1/1, `source: "schema"` preserved | D1 PR |
| Sensitive-fields, inference path | 0 (structural) | 1/1 via `accepted_inference` (§5.1 step 2) | D1 PR |
| Dead-config diagnostic | absent | fires on a deliberately broken config *and* on an allowlist rejection *and* on a pre-fix accepted convention | D1 PR |
| Auth-helper convention | 100/100 | unchanged | regression |
| Mutation test (taxonomy) | 1/1, isolation clean | unchanged | regression |
| Determinism | held | held, CI-gated | 0a |
| Canary ledger coverage | 0 cells declared | every (kind × path) cell declared `firing`/`quarantined`/`unimplemented`/`needs-review` and tested; per §4.2 a mostly-`needs-review` ledger **passes** — the count and each cell's missing evidence go in the report | 0b |

Note the ledger row replaces v1's "9/9 convention kinds" — per C8 the surface is (kind × enforcement path), and some cells are correctly non-firing.

**Gate note on the papermark `@prisma/client` target.** 0 is the *prediction*, not a pass/fail threshold, and the distinction is load-bearing. D5.2's own rule (§5.5) is retain-on-ambiguity: a specifier whose use cannot be classified keeps its finding. So 0 holds only if all 35 classify cleanly as inert — which the audit's hand-check says they should, but the classifier is the thing under test, and a hand-check is not the classifier.

The gate is therefore: **any retained finding must cite the specific ambiguous-use evidence that retained it.** Retained-with-evidence is investigate-then-decide, not automatic failure; retained-without-evidence is a defect in the classifier. Reaching 0 by loosening the classifier until the number lands is exactly the pressure §9.4.4 exists to resist — the same shape as blessing a baseline to go green, and it must be refused the same way.

---

## 8. Risks and open questions

**Blocking decisions — none remain.** All three former stops are pre-decided in place, so the plan is executable without human check-in:

| Was | Now | Where |
|---|---|---|
| S1 — trust semantics for inferred fields | **Decided: yes**, via `"accepted_inference"`. Irreversible half (state migration) carved out and deferred. | §5.1 step 2 + compat |
| S2 — is `default_exports.rs:50-63` load-bearing? | **Decided as a branch** on an evidence trigger, both outcomes mergeable, third paths forbidden. | §5.2 step 1 |
| S3 — ledger cell classification | **Decided: `needs-review` is the default**; `quarantined` requires a locatable citation. Ledger merges either way. | §4.2 |

The one thing deliberately withheld from unattended execution is the **state-DB migration** (§5.1 compat) — not a decision the agent needs, but an irreversible data rewrite that should carry a human signature. Its absence blocks no §7 gate.

**Risks:**

- **Golden-file churn (D2/D3).** Fact-table changes shift graph counts and possibly candidate inference on real repos. Mitigated by the determinism gate landing in 0a (before the changes) and by §5.2.3's predicted-delta requirement, which makes an unexplained delta a review failure rather than a bless.
- **D2 may not ship as designed.** If `default_exports.rs:50–63` proves load-bearing for import resolution, canonicalization reintroduces the EW-4 refusal regression. §5.2.1 makes that determination the first task in the PR, not a discovery during review.
- **Existing accepted conventions stay dead until re-accepted (D1).** Because the state migration is deferred (§5.1 compat), a user who accepted this convention before the fix keeps a non-firing check. The §5.1.4 diagnostic is what closes that gap — it names the convention and points at re-accepting. Release note should say so plainly. The grace-period design (`status: "new"`, one release of `warn` before `block`) belongs with the migration whenever a human authorizes it, **not here** — with no migration there is no mass of newly-firing findings to phase in.
- **Silent allowlist failures are a defect class of their own.** `security_patterns.rs:259` (classification) and `:266` (source) both `return None` on unknown values, dropping the entry with no diagnostic. C1 shows how that converts a fix into a no-op. §5.1.4 addresses the sensitive-fields path; the same `Option`-returning parse pattern elsewhere in `security_patterns.rs` deserves a sweep — filed as follow-up, not in scope here.

**Closed since v1:**

- ~~Who else filters by `source`?~~ Grepped: four sites total, no second seam of this form. The fourth site (`security_patterns.rs:266`) is now in D1's scope — see §5.1.
- ~~`export *` limitation.~~ Already implemented (S1-05); no follow-up needed.
- ~~Type-only export decision.~~ Already implemented; §5.3 documents it.

**Still open:**

- **Which kinds can carry `presence` semantics?** Stamped per candidate (`candidate_command.rs:1240`), so not derivable from the kind list. Inventory is 0b's first task and determines the ledger's row count.
- **Unverified audit scope.** Exemplar *accuracy* for service-delegation / tenant-scope / authorization remains unmeasured. The ledger gives them fire-ability coverage; ground-truth precision on a real corpus is a follow-up audit pass.

---

## 9. Execution guide — cadence, orchestration, and merge protocol

### 9.1 Verification tiers

The repo already tiers its checks; this plan uses those tiers rather than inventing a cadence. **Expensive gates run at phase boundaries, not after every task.**

| Tier | Command | When | Cost |
|---|---|---|---|
| **T0 — loop** | `cargo test -p drift-engine <test_name>` + the one golden fixture for the defect in hand. **Never with `-u`** (§9.4.4). | Every red/green cycle | seconds |
| **T1 — task done** | `pnpm test:engine` | Finishing a defect's implementation | ~minutes |
| **T2 — PR ready** | `cargo build -p drift-engine` (**debug** — see §0.2 gotcha), then `pnpm verify` (`build:engine` → `build` → `typecheck` → `test` → `test:e2e`), plus `format:engine:check` and `lint:engine` | Before opening each PR | moderate |
| **T3 — phase boundary** | `pnpm verify:ci` then `pnpm verify:evals` (`eval:external`, `eval:evasion`, `eval:bench`, `eval:determinism`) | Three times total, per §9.2 | 20+ min |

`verify:full` = `verify:ci` + `verify:evals` if you want T3 as one command. CI itself runs only `verify:ci`, so the evals are a deliberate local/manual gate — the batching this plan asks for is what the repo already assumes.

### 9.2 Phase boundaries — three T3 runs, not six

**§6 owns the ordering.** This section owns only *where the expensive gates fall on it*, so read §6's track diagram first; if the two ever disagree, §6 wins.

```
0a  fixture move + harness + baseline evals green      [prerequisite for everything]
──────────────────────────── fan out ────────────────────────────
TRACK A (D1 → D4)   TRACK B (D2 → D3)   TRACK C (0b ledger)
   T0/T1 inside tracks; T2 on each track PR into integration
──────────── T3 #1 — after A and B are merged to integration ────────────
TRACK D  D5.1 → D5.2                                   [needs B merged]
──────────────── T3 #2 — after D is merged to integration ───────────────
Integration: full re-run, ledger cell transitions, PR, merge gate (§9.4.6)
──────────────── T3 #3 — final, on the integration tip ──────────────
```

**Why the seams fall here.** T3 #1 sits after **A and B** merge — the two tracks that change engine behavior, so that is the first point a real-repo delta means anything. **Track C is deliberately excluded from that gate**: it adds test infrastructure only, changes no product behavior, and may land before or after T3 #1. Its ledger row is validated at T3 #3 like every other §7 row. T3 #2 is the seam that must not be dropped: D5.2 classifies invocation evidence over the fact layer B corrects, so running it on an unvalidated fact layer means a fact-layer regression surfaces as a D5.2 finding-precision bug and gets debugged in the wrong place. T3 #3 is confirmation on the exact tree being merged — never inherit an earlier run's result as the merge gate's evidence.

Note that no seam exists "after D1" any more. The earlier draft put one there because the state migration touched persisted state; that migration is deferred (§5.1 compat), and the seam went with it.

**Attribution when a batched T3 goes red.** Each PR states its predicted delta (§5.2.3), so an aggregate matching the sum of predictions attributes itself. When it does not, `git bisect` over the track merges is minutes, not a re-run of everything. This is why the predicted delta is non-negotiable even though the checks are batched — batching trades detection latency for attribution, and the prediction buys the attribution back.

### 9.3 What still runs every time

Three things, all fast, none of them the 20-minute kind:

1. **The workflow-level red test for the defect in hand, before its fix.** This is not a regression check; it is the only thing that catches a fix that no-ops. D1's v1 design would have passed every unit test in the repo while remaining completely dead. Non-negotiable, and it costs seconds.
2. **T0 on the touched fixture.** Same reason.
3. **`cargo fmt` / `clippy` before commit.** `verify:ci` gates on both; discovering it at a phase boundary wastes a T3.

### 9.4 Orchestration model for unattended execution

This section is the operating contract for a lead agent running the plan with no human check-in. It exists because the failure modes of an agent fleet are different from a human team's: subagents do not share context, they over-report success, and they are prone to blessing a baseline to make a run go green.

#### 9.4.1 Track decomposition — three parallel tracks, zero file overlap

Phase 0a is a hard prerequisite for everything (it builds the harness every red test uses). After it lands, three tracks run concurrently in **separate git worktrees**:

| Track | Scope | Files owned | Depends on |
|---|---|---|---|
| **A** | D1, then D4 | `candidate_command.rs`, `security_proof.rs`, `security_patterns.rs`, `security_facts.rs`, accept path in `packages/cli/src/domain/` | 0a |
| **B** | D2, then D3 | `facts.rs`, `tests/default_exports.rs` | 0a |
| **C** | 0b canary ledger + near-miss convention | new test files, `CONTRIBUTING.md` | 0a |
| **D** | D5.1, then D5.2 | `rules.rs`, `check_command.rs` | **B merged** |

**Track A is cross-language and its brief must say so.** D1 spans a Rust allowlist (`security_patterns.rs:266`) and a TypeScript accept path (`packages/cli/src/domain/`), and the halves fail independently: the Rust side can compile, pass `cargo test`, and still never enforce because the CLI never stamps `"accepted_inference"`. "It compiles in Rust" catches none of that. Only the e2e harness driving the real CLI observes the seam — the same class of gap that produced D1 — so treat a Rust-only green as no evidence at all.

**Both halves of D1 are required, and they are not alternatives.** `candidate_command.rs:642` must stop *destroying* provenance (that is the fix); the accept path must *additionally* stamp `"accepted_inference"` on user-confirmed `candidate` fields (that is §5.1 step 2). The review checklist's "D1 stamped at the accept path **instead of** 642" names the error of doing only the second. Quote both sentences in Track A's brief — an implementer given only one will build the wrong half, and a reviewer given only the checklist line may reject a correct fix.

**Track C reads `check_command.rs`; it does not own it.** The ledger's cell enumeration derives from that file's dispatch arms and the `:1712` presence intercept, but Track C adds only new test files and `CONTRIBUTING.md`. Track D owns `check_command.rs` edits, and D starts after B merges, so the read and the write never overlap in time.

D1 and D4 share `candidate_command.rs` (lines ~642 and ~355–383), so they are sequential commits on one branch rather than parallel tracks — that keeps the conflict surface at zero rather than merely small. Track D is genuinely gated: D5.2 classifies invocation evidence over the fact layer B corrects, so starting it on unmerged B means debugging a fact-layer regression as a finding-precision bug.

#### 9.4.2 Subagent contract

Every task brief handed to an implementer must be **self-contained** — repo path, baseline SHA, the file:line citations from §10, the acceptance criteria from §7, and the relevant §5 subsection quoted in full. A subagent has none of this conversation's context and will invent plausible substitutes if the brief is thin.

Implementers return **evidence, not summaries**. A report saying "tests pass" is rejected unread. The required shape is raw command output: the command, its exit code, and the assertion lines. This is not ceremony — an agent reporting a green suite it did not run is the single most common way a fleet produces a confidently broken merge.

Implementers are **forbidden** from: running any `--update` / bless flag, editing any `*-baseline.json`, editing §7's targets, marking a §7 row met without the command output proving it, and writing the state-DB migration (§5.1 compat).

#### 9.4.3 Review protocol — the lead re-runs, it does not trust

For each returned task the lead performs, itself:

1. **Re-run the claimed verification.** Not a reading of the report — the actual command.
2. **Verify red-at-baseline, and for the right reason.** Mandatory for every defect — this is the protocol that would have caught v1's D1 fix.

   **The baseline for this check is the integration branch at the 0a commit, not `255f2208`.** Every new test depends on the 0a harness, which does not exist in the raw baseline, so a test run there fails to *build* — a setup failure, which this same paragraph rejects as proof of nothing. Running it against the raw SHA makes the protocol unsatisfiable, and an agent that notices will quietly relax it. So: worktree at the integration branch's post-0a, pre-fix commit; apply **only** the new test; run it; confirm it fails with an *assertion* failure whose message matches the audited defect.

   A test that fails to compile, errors on a missing fixture, or fails for any setup reason is **not** a red test. It proves nothing about the fix, and a fix validated against it can be a complete no-op.
3. **Diff review against §5.** Confirm the change matches the specified fix rather than an adjacent one that happens to pass. Specifically watch for: D1 fixes stamped at the accept path instead of line 642; D3 using `value` instead of `imported_name` for the alias (contradicts EW-4, see C4); D4 fixing `db` while leaving `data-access` (C9); D5.1 booked as removing type-only findings when it cannot (C6).
4. **Correction loop, bounded at 2 rounds.** Return specific, quoted defects — never "try again." After the second failed round, mark the track `blocked`, record the evidence, and **continue the other tracks**. One stuck track must not stall the run.

#### 9.4.4 Baseline blessing — the one place to be paranoid

`external-eval.mjs` records a real incident (§4.5): a reversed regex made `397 baselined` parse as `0`, and the baseline was blessed `397 → 0` across every repo under cover of an unrelated change. An agent fleet under pressure to go green will reproduce that exact failure.

Rules, no exceptions:

- Only the lead blesses, only in the integration phase, never a subagent.
- The **predicted delta is written down before the eval runs** — per repo, per field, with the derivation. Prediction after the fact is not prediction.
- An observed delta that does not match the prediction is a **stop**: investigate, do not bless. If it cannot be explained within the correction budget, open the PR **unmerged** with the discrepancy documented.
- Use the existing O-4 mechanism (`<repo>:<field>`) to name each accepted move explicitly.

#### 9.4.5 Verification cadence

Per §9.1–9.3. Subagents run **T0/T1 only** — seconds to minutes. The lead runs **T2 per PR** and **T3 at the three phase boundaries**. No subagent runs `verify:evals`; a 20-minute eval fanned out across a fleet is the fastest way to burn an afternoon on redundant work. T3 runs must be launched in the background with generous timeouts and polled, not run in a blocking foreground call.

#### 9.4.6 Branch topology and merge protocol

**Nothing is ever committed directly to `main`.** `main` is touched exactly once, by the final merge, and only if the gate below passes. Branch off `main` at `255f2208`:

```
main @ 255f2208
 └── remediation/ground-truth-audit        ← integration branch; 0a lands here
      ├── remediation/gt-track-a           ← D1 → D4       (worktree)
      ├── remediation/gt-track-b           ← D2 → D3       (worktree)
      ├── remediation/gt-track-c           ← 0b ledger     (worktree)
      └── remediation/gt-track-d           ← D5.1 → D5.2   (worktree, after B merges)
```

Rules:

- Create the integration branch **before** any work, and land 0a on it. Track branches fork from the integration branch *after* 0a, so every track inherits the harness.
- Each track works in its own `git worktree` on its own branch — never two tracks in one checkout.
- Track branches PR into the **integration branch**, not `main`.
- The red-at-baseline verification (§9.4.3 step 2) uses a **separate throwaway worktree at the integration branch's post-0a, pre-fix commit — NOT `255f2208`.** An earlier revision of this bullet said `255f2208` and was wrong; §9.4.3 step 2 governs and explains why (the runner exists at baseline, the fixtures and new tests do not, so a raw-baseline run dies on a missing `test/fixtures/gt-*` path — a setup failure that proves nothing). Never check `main` out into a working tree a track is using, and never reset it.
- If the run is abandoned or blocked, `main` is still at `255f2208` and every branch is inspectable. That is the point.

The integration branch merges to `main` **only** when all of:

- `pnpm verify:ci` green,
- `pnpm verify:evals` green with every delta predicted and named,
- every §7 row either met with evidence, or marked `deferred` under a §5 pre-decided branch (D2 deferral, §5.2 step 1) with its evidence attached,
- no track in `blocked` state.

If any condition fails: **open the PR, do not merge, and say so plainly in the final report.** A merged-but-broken `main` costs far more than a PR awaiting a human. This is the one place the lead should prefer stopping over finishing.

#### 9.4.7 Final report — required contents

Not a narrative. A table of §7's rows with baseline value, achieved value, and the command output that proves it; then:

- Which of D1–D5 shipped, which deferred **by pre-decided branch** (not the same as failed), which blocked.
- The S2 branch outcome and its evidence.
- Ledger cell counts by state, and what evidence each `needs-review` cell lacked.
- Every blessed baseline delta with its prediction alongside the observation.
- Before/after benchmark numbers from `eval:bench`, `eval:external`, `eval:determinism`, `eval:presence`.
- Merge status, and if unmerged, exactly what blocked it.
- **Anything the run discovered that contradicts this TDD.** §0.1 exists because this document has already been wrong once; a run that finds a sixth defect, or finds one of C1–C9 misstated, should report that rather than route around it.

---

## 10. Appendix — audit-to-test traceability (verified paths)

All paths relative to `/Users/geoffreyfernald/drift-falsification/drift` at `255f2208`.

| Audit finding | Red test | Fix | Verified code site |
|---|---|---|---|
| §1 FP duplicate default-export fact | `test/fixtures/gt-fact-extraction` facts golden (8→6) | D2 | `crates/drift-engine/src/facts.rs:752`, `:817`; pinned by `tests/default_exports.rs:50-63` |
| §1 FN local `export { internalHelper }` | `test/fixtures/gt-fact-extraction2` facts golden | D3 | `crates/drift-engine/src/facts.rs:622` (source-gated), `:899` |
| §2 FP `dbg` / `imdb` | `test/fixtures/gt-data-access` findings golden (6→4) | D4 | `crates/drift-engine/src/candidate_command.rs:378-383` |
| §2 (unreported) FP `data-access` bare substring | near-miss fixture entry | D4 | `crates/drift-engine/src/candidate_command.rs:382` |
| §2 papermark 35 type/enum FPs | fixture ext. + papermark snapshot | D5.2 | `facts.rs:835`/`:865` (type skip, pre-existing); `rules.rs:130` (granularity) |
| §3b structural FN | `test/fixtures/gt-sensitive-fields*` findings golden (0→1) | D1 | `candidate_command.rs:642`, `security_proof.rs:784`, **`security_patterns.rs:266`** |
| §3b class risk (dead seams) | canary ledger, all cells | §4.2 | `check_command.rs:102-263`, intercept at `:1712` |
| §3b why unit tests missed it | ledger rule in §3 | §4.2 | `tests/security_check_repo_phase5.rs:60,178,291` (`source: "contract"`) |
| §6 determinism (strength, pin it) | determinism CI gate | §4.4 | — |
| §5 exemplar inference (strength, pin it) | papermark snapshot | §4.5 | — |
