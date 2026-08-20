# Security-convention pipeline — TDD execution playbook

**For the agent executing this.** This document is self-contained. The diagnosis behind it
(`docs/architecture/security-convention-pipeline-refactor.md`) has already been source-verified
twice, and every failure below has been reproduced against `origin/main @ 5e86e89a`. **Do not
re-audit the plan.** Do not go re-read the engine to confirm a claim in Part 0 — those facts were
established by running code, and re-deriving them is the single largest way to waste your context.

Read Part 0 once. Then execute steps in order. Each step carries its own local context, so you can
start a step without re-reading the ones before it.

---

# PART 0 — STANDING CONTEXT

Everything here is confirmed. Treat as given.

## 0.1 What is wrong, in one paragraph

The security-convention pipeline decides "does this call resolve to the accepted security helper" in
twelve different places, at two different strengths, and both strengths are wrong in opposite
directions. Name-only matching (tier 0) accepts *any* module exporting the right symbol — so a
helper from `@/lib/attacker-controlled` produces a passing auth proof. Specifier-string matching
(tier 1) compares the import specifier as typed — so `../../lib/auth` and `@/lib/auth`, the same
file, disagree, and a renamed import fails outright. Exactly one check resolves real module
identity, and it is the only one immune to both. Separately, the engine emits a proof value that the
TypeScript schema parsing that same field rejects, and no test crosses that boundary, so both test
suites are green while the CLI throws.

## 0.2 The five confirmed failures

Each was reproduced by a test that was written, run, and deleted. You will re-create these as
permanent tests.

| ID | Failure | Reproduced behavior |
|---|---|---|
| **F1** | Engine emits `session_not_trusted` into `session_trust.missing_trust[].reason`; the Zod enum there is `["derived_from_request","unknown_helper","missing_auth_guard","parser_gap"]` | `SecurityBoundaryProofSchema.parse` → `invalid_enum_value`. Parse is hard (throws). |
| **F2** | Tier-0 laundering | `withSession` from `@/lib/auth`, `@/lib/attacker-controlled`, and `./local-shim` all → `trusted=1 missing=0` |
| **F3** | Tier-1 spelling | contract says `@/lib/auth`: `@/lib/auth`→`trusted=1`; `@/lib` (barrel)→`missing=1`; `../../lib/auth`→`missing=1` |
| **F4** | Tier-1 rename intolerance | `import { assertCsrf }`→0 findings; `import { assertCsrf as checkCsrf }`→**1 finding** on a compliant route |
| **F5** | Text-scan secret sinks | adding `// console.error(apiKey);` flips a route `Proven`→`MissingProof` |

**F1 and F3 compound**: the barrel case is simultaneously a false positive *and* the payload that
throws.

## 0.3 Architecture you must know and must not re-derive

### The crate split is real and compile-enforced

`crates/drift-engine` is two crates. `lib.rs:3-16` declares library modules; `main.rs:9-12` is the
only place `mod protocol;` and `mod check_command;` appear. **A lib module cannot reference
`crate::protocol::GraphNode`** — this was compile-proven:

```
error[E0433]: cannot find `protocol` in `crate`
```

Consequence: `security_patterns.rs`, `security_rules.rs`, `security_phase6.rs`, `security_proof.rs`
can never touch a graph type. They receive resolution results **as plain data**. Every step below
respects this. You never need to test it.

### The resolver lives in TypeScript, and Rust structurally cannot replace it

`protocol.rs:543-549` and `engine-check.ts:85-87` both state it: the engine receives a graph **scoped
to the changed files**, so it cannot derive what a specifier means — the imports that establish
meaning live in files outside the diff. The CLI has the whole graph.

The precedent already ships: `forbiddenModuleFiles_` (`run-check.ts:3960`) walks
`IMPORT_RESOLVES_TO_MODULE` edges, and the result is handed to the engine as
`matcher.forbidden_module_files` (`engine-check.ts:91` → `protocol.rs:551` → `rules.rs:17`). **P2
generalizes exactly this.** Do not invent a second mechanism.

### There are two graphs. Only one can reach a check.

- **Engine-streamed** — `collect-scan-data.ts:249` (`graphEdges.push(...event.graph_edges)`), `:295`.
  This is `checkData.graph_edges`. **This is what every check sees.**
- **TS-derived** — `packages/factgraph/src/index.ts:341` emits `IMPORT_RESOLVES_TO_MODULE` via a
  weaker resolver (no workspace packages, flat non-scoped aliases). Called from exactly one place,
  `scan-status.ts:187`, which builds a *stored artifact*. It fires only when the Rust engine produced
  no graph — and in that state `run-check.ts:583-585` **exits `CHECK_EXIT_REFUSED`** with
  `blocked_reasons ["typescript_fallback_used"]`.

**Therefore: `IMPORT_RESOLVES_TO_MODULE` in `checkData` is always engine-produced.** P2 may trust it
without a guard. Step S3-05 pins this so a future softening of the refusal fails loudly.

### External imports produce no resolution edge — by design

`resolve_import` (`main.rs:2343-2348`) ends `.find(|c| resolver.snapshot_paths.contains(c))`. It
resolves only into the scan snapshot. `next-auth`, `@clerk/nextjs`, anything in node_modules →
**no edge**. `run-check.ts:1211-1212` says so: *"external packages resolve to nothing by design."*

**This is the single most important design constraint in P2.** A naive "empty table → fall back to
string matching" would permanently and silently retain tier-1 semantics for every external auth
helper — the most common real-world contract. That is why P2 uses a **per-helper mode**, not a
per-convention fallback, and why the mode is recorded in the proof.

### There are two `reason` surfaces with colliding vocabularies

1. **Proof-level** — `session_trust.missing_trust[].reason`, wire-serialized at
   `check_command.rs:3823`, validated by `core/src/security.ts:323` and
   `engine-contract/src/index.ts:962`. Legal: `derived_from_request`, `unknown_helper`,
   `missing_auth_guard`, `parser_gap`.
2. **Finding-level** — produced by `check_command.rs:3638-3649`, drawn from
   `SecurityMissingProofCodeSchema` (`security.ts:22`, 32 members) which **does** contain
   `session_not_trusted`.

`security_proof.rs:1465` writes a surface-2 value into surface-1. The mapper at `:3643` passes it
through, so surface 2 accidentally works. **Fixing one without the other trades a crash for silent
degradation.** See S1-01.

### The tier table

| Tier | Rule | Fails by |
|---|---|---|
| 0 — name only | `imported_name == symbol` | **false negatives** (laundering) |
| 1 — name + specifier string | tier 0 + `fact.value == import_source` | **false positives** (spellings, renames) |
| 2 — resolved identity | graph edges | neither |

**Tier 1 is not a stronger tier 0.** Never "upgrade" a tier-0 site to tier 1 — that converts silent
misses into noisy false alarms. Only tier 2 dominates both.

### The vocabulary generator — what you get for free

`vocabulary/vocabulary.json` → `node vocabulary/generate.mjs` → `crates/drift-engine/src/vocabulary.rs`
+ `packages/core/src/vocabulary.ts`. Both generated files are **committed**.

A manifest entry is exactly this shape:

```json
"route_flavor": {
  "doc": "…prose that becomes the doc comment on both sides…",
  "rust_enum": "RouteFlavor",
  "ts_const": "ROUTE_FLAVORS",
  "ts_schema": "RouteFlavorSchema",
  "members": ["api_route", "cron_job", "webhook_handler"]
}
```

Members are plain strings. Rust variant names are PascalCased from the wire string (the generator
errors on a collision). For any entry with `rust_enum`, `generate.mjs:82-134` emits, for free:
`ALL`, `as_wire()`, `from_wire()` (with `_ => None`, never a silent drop), `all_wire_names()`,
`Display`, `Serialize`, `Deserialize`. **Omit `rust_enum` and you get a TypeScript-only vocabulary**
(this is how `parser_gap_kind` works).

`scripts/vocabulary-parity.mjs` then enforces, without further work from you:
1. generated files match the manifest,
2. no hand-written list is a proper subset of a vocabulary,
3. every member has a producer and a consumer, or is baselined as reserved with a written reason.

Rule 3 uses `PRODUCER_PATTERNS` (`vocabulary-parity.mjs:297-315`), keyed by vocabulary name:

```js
graph_edge_kind: (variant, member) => [
  { file: MAIN_SOURCE,      pattern: new RegExp(`GraphEdgeKind::${variant}\\b`) },
  { file: FACTGRAPH_SOURCE, pattern: new RegExp(`edge\\(\\s*"${member}"`) }
]
```

Source path constants are at `vocabulary-parity.mjs:53-60`. You will add
`SECURITY_PROOF_SOURCE` there in S2.

## 0.4 What is already fixed — do not touch

- **Convention-capability lookups are generated.** 8 vocabularies, 163 members,
  `pnpm check:vocabulary` green. Do not build a "convention descriptor."
- **`is_presence_convention`** (`check_command.rs:1983`) reads a per-*instance* field. Not a
  duplicate. Leave it.
- **The presence tier's name-only matching** (`check_command.rs:2169`) is a documented, pinned,
  deliberate trade (`beta-claims.json:108`, `tests/presence_enforcement_cv3.rs`). **It is not F2.**
  Leave it alone; changing it is a product decision.
- **MCP transport.** Out of scope.
- **Diff/rename.** Real gap, own plan, own prerequisite. Out of scope.
- **The parser-gap scanners** (`security_proof.rs:1022`, `:1592`, `:1737`). They emit
  `blocks_enforcement: true` — over-firing *refuses to enforce*, which is conservative. **They are
  not F5.** S6-04 pins that you left them alone.

## 0.5 Traps — each has cost someone a bug already

1. **The P1.1 half-fix.** Changing `security_proof.rs:1465` without widening
   `check_command.rs:3643` sends `unknown_helper` into the finding-level code, where it is not a
   member and normalizes to `unknown_reason_code` at `engine-contract/src/index.ts:644`. Crash
   becomes silent degradation. `test/e2e/gt-canary.test.ts:768` catches you — do not "fix" that
   canary, fix the mapper.
2. **Deleting "dead" enum members.** `sqlite-storage.ts` `.parse()`s **on read**. The tenant and
   authorization enums were previously *widened*, so stored rows may legitimately hold members a
   producer-only audit calls dead. Shrinking bricks reads. Baseline-as-reserved instead.
3. **The per-convention fallback.** See 0.3. Per-helper mode, always.
4. **The cell ledger is string-anchored.** `convention-cell-ledger.mjs:21-26` chooses regex over a
   parser deliberately. Steps that change string literals in `security_proof.rs` or
   `helper_import_matches` move those anchors. Re-run `pnpm check:cell-ledger --report` and update
   anchors **in the same commit**.
5. **Ordering nondeterminism is invisible.** The determinism digest (`scripts/determinism.mjs:105-113`)
   covers findings only, never proofs. Anything you add to a proof must be sorted and deduped by you.

## 0.6 Execution rules

- **Red first.** Write the test, run it, **paste the actual failure into the commit body**. A step
  whose "red" test passes before the fix means you wrote the wrong test — stop and re-read the step.
- **Line numbers drift.** Every cite is `origin/main @ 5e86e89a`. If a cite doesn't match, re-anchor
  by the symbol name given alongside it. Never guess.
- **One step, one commit.** Every step below is independently revertible. Do not batch.
- **After every step:** `cargo test -p drift-engine && pnpm -r test`. Before every PR:
  `pnpm verify:ci`.
- **`verify:evals` does not run in CI** (`ci.yml:3-5` — needs seven pinned repos and a release
  binary). Do not block on it.
- **The cell-ledger gate is report-only on non-integration branches**
  (`convention-cell-ledger.mjs:374`, integration = `main`, `remediation/ground-truth-audit`). It will
  not fail your PR. Run `pnpm check:cell-ledger --report` yourself.
- **If a step's premise is false** (the code already changed), **stop and report**. Do not improvise
  a replacement.

---

# PART 1 — SPRINT 1: stop the crash, add the gate

**Goal.** F1 closed, and a gate that makes F1's whole class impossible.
**Done when.** Tests S1-01…S1-05 green; `pnpm check:engine-schema-parity` wired into `verify:ci`;
`gt-canary.test.ts` still green.
**Depends on.** Nothing. Start here.

## S1-01 — the emitted value, and the mapper, together

**Where this is going.** `security_proof.rs` writes a finding-level vocabulary word into a
proof-level field. You are making it write the proof-level word, and simultaneously teaching the
finding-level mapper to produce the finding-level word from it. Both halves in one commit, because
either half alone is a regression.

**RED.** Extend `crates/drift-engine/tests/security_check_repo_phase4.rs`. The file already has
`run_check_repo(request) -> Value`, `fact(kind, name, start_line, end_line, value, imported_name)`,
`temp_repo(name)`, `write_route(root, path, lines)`.

```rust
#[test]
fn session_trust_reason_is_a_member_of_the_wire_enum() {
    let repo_root = temp_repo("phase4_reason_vocabulary");
    write_route(&repo_root, "app/api/projects/route.ts", &[
        "export async function GET(request: Request) {",
        "  const session = await getSession(request);",
        "  return Response.json({ ok: Boolean(session) });",
        "}",
        "",
    ]);

    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": repo_root.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact("file_role_detected", "api_route", 1, 4, None, None),
            fact("route_declared", "GET", 1, 4, None, None),
            fact("symbol_called", "getSession", 2, 2, None, None),
            fact("route_returns_response", "json", 3, 3, Some("Response"), None)
        ]},
        "contract": { "contract_id": "c", "contract_schema_version": 1, "conventions": [{
            "id": "security_session_trust",
            "kind": "session_object_must_come_from_trusted_helper",
            "matcher": { "applies_to_file_roles": ["api_route"] },
            "severity": "error", "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }]},
        "baseline": [], "diff": { "mode": "full", "files": [] }
    }));

    // The four members of core/src/security.ts:323 — the enum that parses this field.
    const LEGAL: [&str; 4] =
        ["derived_from_request", "unknown_helper", "missing_auth_guard", "parser_gap"];
    for missing in payload["security_boundary_proofs"][0]["session_trust"]["missing_trust"]
        .as_array().expect("missing_trust")
    {
        let reason = missing["reason"].as_str().expect("reason");
        assert!(LEGAL.contains(&reason),
            "proof-level reason {reason:?} is not a member of the wire enum {LEGAL:?}");
    }
}
```

**Expected red:** `proof-level reason "session_not_trusted" is not a member of the wire enum […]`.

Also **modify** the existing test at `security_check_repo_phase4.rs:151-158`. It currently asserts
the illegal value. Change the proof-level assertion to `"unknown_helper"` and **add** a finding-level
assertion that the user-facing code is still `session_not_trusted` — that is what proves you widened
the mapper rather than just moving the bug.

**GREEN — two edits, one commit.**

1. `crates/drift-engine/src/security_proof.rs:1465` — inside
   `build_session_trust_proof_from_facts`, the `(source, Some("untrusted"))` arm:
   `"session_not_trusted"` → `"unknown_helper"`.
2. `crates/drift-engine/src/check_command.rs:3643` — the
   `"session_object_must_come_from_trusted_helper"` arm. Today:
   `if missing.reason == "derived_from_request" { "session_not_trusted" } else { missing.reason.clone() }`.
   Make **both** `derived_from_request` and `unknown_helper` map to `session_not_trusted`.

**VERIFY.**
```bash
cargo test -p drift-engine --test security_check_repo_phase4 && pnpm vitest run test/e2e/gt-canary.test.ts
```
`gt-canary.test.ts:768` asserts `actual_layer: "session_not_trusted"` on the **finding**. It must
stay green. If it goes red, you did edit 1 without edit 2.

**Also run:** `pnpm check:cell-ledger --report` (trap 4 — you changed a string literal in
`security_proof.rs`).

## S1-02 — unit-level guard on the proof builder

**RED.** New `#[test]` in `security_proof.rs`'s `mod tests`:

```rust
#[test]
fn unknown_helper_source_maps_to_unknown_helper_reason() {
    let source = "\nexport async function GET(request: Request) {\n  \
                  const session = await getSession(request);\n  \
                  return Response.json({ ok: true });\n}\n";
    let proof = build_phase4_security_proof("app/api/x/route.ts", source, &[]).expect("proof");
    assert_eq!(proof.session_trust.missing_trust[0].reason, "unknown_helper");
}
```

Green after S1-01. Keep it: it fails much faster than the e2e test and names the cause.

## S1-03 — the mapper is total

**RED.** New `#[test]` in `check_command.rs`'s `mod tests`. Assert **both** proof-level reasons
produce the finding-level `session_not_trusted`. Against pre-S1-01 code, the `unknown_helper` case
returns `"unknown_helper"`.

## S1-04 — the cross-boundary gate (highest-value item in the entire plan)

**Where this is going.** F1 survived because the Rust suite asserts Rust values, the TS suite asserts
TS schemas, and **nothing drives the real engine and parses its real output with the real schema**.
This gate is that missing test. It kills the class, not the instance.

**Build two files**, modeled on `scripts/error-contract.mjs` + `.test.mjs` (read
`scripts/error-contract.test.mjs:1-40` for the shape — `execFileSync` the gate, assert exit code and
output).

`scripts/engine-schema-parity.mjs`:
1. Build the engine (`cargo build -p drift-engine`).
2. For each fixture scenario, run `check-repo` and collect `security_boundary_proofs`.
3. `SecurityBoundaryProofSchema.safeParse` each one.
4. On rejection print `path` + `received` + `options`, and exit non-zero.
5. Baseline + ratchet, matching `vocabulary-parity.mjs`: pre-existing rejections may be baselined
   **with a written reason**; a new one fails. Support `--update`.

Include the barrel fixture from S3-03 as a scenario — it is the one that reproduces F1.

`scripts/engine-schema-parity.test.mjs`: the gate passes on committed state; and, with a deliberately
corrupted reason value injected, the gate **fails and names the field**. (This repo's own stated
convention, `convention-cell-ledger.mjs:42`: *"A guard nobody has watched fail is a guard nobody
knows works."*)

**Register in `package.json`:**
- `"check:engine-schema-parity": "node scripts/engine-schema-parity.mjs"`
- append `&& pnpm check:engine-schema-parity` to `verify:ci` (after `check:payload-invariants`)
- add `scripts/engine-schema-parity.test.mjs` to the `test:harness` list

**VERIFY.** `pnpm check:engine-schema-parity` green; then `git stash` the S1-01 fix and confirm the
gate goes **red** naming `["session_trust","missing_trust",0,"reason"]`. That is your proof the gate
works. Restore.

## S1-05 — sprint gate

```bash
cargo test -p drift-engine && pnpm -r test && pnpm test:e2e && pnpm verify:ci
```

---

# PART 2 — SPRINT 2: generate the reason vocabularies

**Goal.** The F1 class becomes a **compile error**, not a runtime rejection.
**Done when.** `pnpm check:vocabulary` green with the new vocabularies; no inline
`reason: z.enum([...])` left in `security.ts` / `engine-contract/index.ts`; S2-01…S2-05 green.
**Depends on.** **S1 — hard.** Generating an enum from today's member set would freeze a set that is
three-quarters dead and missing the value the engine emits.
**Can run in parallel with.** Sprint 3 (disjoint files).

## S2-01 — the stored-row census (do this before any deletion)

**Why.** Trap 2. You are about to be tempted to delete members with no producer. `sqlite-storage.ts`
parses **on read**, and the tenant/authorization enums were widened, so stored rows may hold them.

**Build** `scripts/stored-proof-census.mjs`: open the storage DBs reachable in a dev/test
environment, enumerate distinct values appearing in every proof `reason`/`code` field, and print
them grouped by field path.

**Output is an input to S2-03.** Any member the census finds in a stored row is **reserved**, never
deleted, regardless of what the producer audit says.

## S2-02 — `session_trust_reason` into the manifest

**Where this is going.** After this step, `reason: "session_not_trusted"` in `security_proof.rs` will
not compile.

**RED (compile-level + gate-level).** Add to `scripts/vocabulary-parity.test.mjs`:
`session_trust_reason_members_all_have_producers`. Against current code, three of four members
(`unknown_helper` pre-S1, `missing_auth_guard`, `parser_gap`) have no producer.

**GREEN.**

1. `vocabulary/vocabulary.json` — new entry:

```json
"session_trust_reason": {
  "doc": "Why a session object could not be proven trusted. PROOF-LEVEL vocabulary: it says why the proof failed. The FINDING-level code a user sees is separate (SecurityMissingProofCodeSchema) and is derived from this in check_command.rs's phase4 finding-reason mapping. The two are deliberately different vocabularies; mapping between them must be total.",
  "rust_enum": "SessionTrustReason",
  "ts_const": "SESSION_TRUST_REASONS",
  "ts_schema": "SessionTrustReasonSchema",
  "members": ["derived_from_request", "unknown_helper", "missing_auth_guard", "parser_gap"]
}
```

2. `node vocabulary/generate.mjs` — commit both regenerated files.
3. Retype `SessionMissingTrustProof.reason` from `String` to `SessionTrustReason`; the emission site
   becomes `SessionTrustReason::UnknownHelper`. The wire site (`check_command.rs:3823`) becomes
   `missing.reason.as_wire()`.
4. Delete the inline `z.enum` at `core/src/security.ts:323` and
   `engine-contract/src/index.ts:962`; import `SessionTrustReasonSchema` from `@drift/vocabulary`.
5. `scripts/vocabulary-parity.mjs` — add `SECURITY_PROOF_SOURCE` to the constants at `:53-60`, and a
   `PRODUCER_PATTERNS` entry:

```js
session_trust_reason: (variant) => [
  { file: SECURITY_PROOF_SOURCE, pattern: new RegExp(`SessionTrustReason::${variant}\\b`) }
]
```

6. Baseline `missing_auth_guard` and `parser_gap` as **reserved**, each with a written reason
   (`missing_auth_guard`: "finding-level code copied into this enum; retained for stored-row
   compatibility, see the S2-01 census"). Do **not** delete.

**VERIFY.** `pnpm check:vocabulary && cargo test -p drift-engine && pnpm -r test`. Then confirm the
invariant: temporarily re-introduce `reason: "session_not_trusted"` and observe a **type error**, not
a test failure. That is the whole point of the sprint.

## S2-03 — the remaining six surfaces

One commit each, same recipe as S2-02:

| vocabulary | today's inline enum | note |
|---|---|---|
| `authorization_missing_reason` | `security.ts:339` / `index.ts:982` (6 members) | 3 have no producer — **already widened**, reserve them |
| `tenant_missing_reason` | `security.ts:361` / `index.ts:1008` (7 members) | 4 have no producer — **already widened**, reserve them |
| `undominated_sink_reason` | `security.ts:253` / `index.ts:802` (5) | `guard_only_in_one_branch`, `callback_boundary` produced by `security_control_flow.rs` — add it to `PRODUCER_PATTERNS` |
| `middleware_mismatch_reason` | `security.ts:275` / `index.ts:823` (4) | `dynamic_matcher` has no producer |
| `request_unvalidated_reason` | `security.ts:307` / `index.ts:859` (3) | exact match, clean |
| `security_missing_proof_code` | `security.ts:22` / `index.ts:602` (32) | **keep the `unknown_reason_code` preprocess at `index.ts:641`** — it is correct and must survive |
| `security_parser_gap_code` | `security.ts:59` / `index.ts:661` (14) | **do not merge with the generated `parser_gap_kind`** — disjoint concepts, coincidental name |

## S2-04 — the duplication is gone

**RED.** New test asserting that `core/src/security.ts` and `engine-contract/src/index.ts` contain
**zero** inline `z.enum` lists for proof `reason`/`code` fields — all imported from
`@drift/vocabulary`. (34 byte-identical member lists exist across the two files today; these seven
are the ones that matter.)

## S2-05 — sprint gate

`pnpm verify:ci` green, including `check:vocabulary` and `check:engine-schema-parity`.

---

# PART 3 — SPRINT 3: the resolver and the modes (TypeScript side)

**Goal.** Compute, per accepted helper, what it actually resolves to — and what mode that answer came
from. Ship it to the engine as a typed field. **The engine ignores it this sprint.**
**Done when.** S3-01…S3-06 green; the field appears in the engine request; no behavior change.
**Depends on.** Nothing. Parallel with Sprint 2.

## S3-01 — generalize the resolver

**Where this is going.** `forbiddenModuleFiles_` already does the exact walk you need, hardcoded to
"forbidden." You are lifting the specifier list into a parameter. Pure refactor.

**RED.** `packages/cli/test/contract-liveness-bb4.test.ts` (extend) or a new
`resolved-module-files.test.ts`: `resolvedModuleFilesFor_matches_forbiddenModuleFiles_` — a
characterization lock over the same `ScanData`. Red because the function doesn't exist.

**GREEN.** In `run-check.ts`, extract `resolvedModuleFilesFor(checkData, specifiers): Set<string>`
from `forbiddenModuleFiles_` (`:3960`). `forbiddenModuleFiles_` becomes a one-line caller. Keep the
memoization on `graphIndexFor` (`:3832`) — it is called per import and per convention.

## S3-02 — classify each helper into a mode

**Where this is going.** This is the step the whole design turns on. Read 0.3 "External imports
produce no resolution edge" again before writing code.

| mode | when | matching rule the engine will apply |
|---|---|---|
| `repo_resolved` | the specifier produced an `IMPORT_RESOLVES_TO_MODULE` edge | resolved-file identity, including re-export chains |
| `external` | a bare package specifier that resolved to nothing | exact specifier match **+ local-shadow check** |
| `unresolved` | a repo-relative specifier that resolved to nothing | exact specifier match, **degradation recorded in the proof** |

Plus one alarm: a specifier classified `external` that **does** resolve repo-locally is the
tsconfig-paths hijack shape — flag it, never silently accept.

**RED.** New `packages/cli/test/accepted-helper-identity.test.ts`, synthetic `ScanData` with
`MODULE_REEXPORTS_MODULE` and `IMPORT_RESOLVES_TO_SYMBOL` edges:

- `barrel_reexport_resolves_to_the_helper_module` — F3's barrel case resolves
- `a_same_named_export_from_an_unrelated_module_resolves_elsewhere` — F2's negative control
- **`an_external_package_helper_is_classified_external_not_empty`** — the core of 0.3; a
  `next-auth` helper must come back `mode: "external"`, **never** an empty `repo_resolved`
- **`an_external_specifier_that_resolves_repo_locally_is_flagged`** — the hijack shape
- `resolved_file_lists_are_sorted_and_deduped` — trap 5; the determinism digest cannot see this

**GREEN.** `resolvedHelperIdentities(checkData, convention)` returning
`Array<{ symbol, mode, files }>`, built from `requires.auth_helpers[].import_source` and the
phase6/csrf/ssrf equivalents, reusing S3-01 + `reachesForbiddenViaReexport` (`:4003`). **Sort and
dedupe `files`.**

## S3-03 — ship it as a typed matcher field

**Where this is going.** `engine-check.ts:95` passes `requires: securityRequires(convention)`, and
`securityRequires` (`:146-148`) returns the **stored convention's** `requires` verbatim. Injecting
CLI-computed data there would mix contract with derivation and bypass typing —
`protocol.rs:528` is `Option<Value>`, so a typo-shaped field ships silently. The correct precedent is
one line above: `forbidden_module_files` at `engine-check.ts:91` is a **typed matcher field**.

**RED.** `packages/cli/test/engine-bridge.test.ts` (it covers `engine-check.ts`'s request build):
`accepted_helper_module_files_is_a_typed_matcher_field_not_inside_requires`. Assert the field lands
under `matcher`, and assert `requires` is byte-identical to the stored convention's.

**GREEN.**
- `engine-check.ts` — add `accepted_helper_module_files` to the `matcher` spread beside `:90-92`.
- `protocol.rs` `CheckMatcher` (`:541-567`) — add the typed field with a doc comment explaining
  *why it is computed CLI-side*, mirroring the `forbidden_module_files` comment at `:543-549`.
- `engine-contract/src/index.ts` — the Zod line.

The engine accepts and ignores it this sprint.

## S3-04 — the fallback-refusal lock

**Where this is going.** S3-02's `repo_resolved` mode trusts that
`IMPORT_RESOLVES_TO_MODULE` in `checkData` came from the Rust resolver. That holds because the
TypeScript fallback path refuses before any check runs (0.3). Pin it, so softening that refusal fails
loudly rather than quietly feeding P2 weaker edges.

**Test** (`packages/cli/test/cli.test.ts`, extend):
`a_typescript_fallback_scan_refuses_before_any_helper_resolution_runs` — assert
`CHECK_EXIT_REFUSED` and `blocked_reasons` containing `typescript_fallback_used`.

**This is a characterization lock, not a red test.** It passes today. Comment it as the guarantee
S3-02 depends on, and cite `run-check.ts:583-585`.

## S3-05 — record the latent adapter risk

`AdapterGraphEdgeSchema.kind` (`packages/adapters/src/index.ts:119`) is `z.string().min(1)` —
unbound to the `graph_edge_kind` vocabulary. `@drift/adapters` has **zero dependents** today, so
nothing can inject edges. **No code change.** Add a comment at the field pointing here, so whoever
wires adapters into the scan path types `kind` against the generated vocabulary first.

## S3-06 — sprint gate

`pnpm -r test && pnpm verify:ci`. **No engine behavior changed.** Any Rust test that moved means you
did more than this sprint asks.

---

# PART 4 — SPRINT 4: consume resolved identity (Rust side)

**Goal.** F3 and F4 closed. **This is the sprint whose result is worth a release note.**
**Done when.** S4-01…S4-06 green; **no existing green test changes** (see §Canary below).
**Depends on.** **S3 — hard** (needs the wire field).

## S4-01 — mode dispatch in `security_patterns.rs`

**Where this is going.** `helper_import_matches` (`security_patterns.rs:473`) is
`import_source.is_none_or(|expected| fact.value.as_deref() == Some(expected))` — one raw string
comparison. It becomes a dispatch on the helper's mode. Remember the crate boundary (0.3): this
module receives resolution results as **plain data**, never a graph type.

**RED.** `crates/drift-engine/tests/security_check_repo_phase4.rs`:

- `barrel_imported_auth_helper_satisfies_session_trust` — contract names `@/lib/auth`, route imports
  `@/lib`, `accepted_helper_module_files` says both resolve to `lib/auth.ts`. Expect
  `trusted_sessions.len() == 1`, `missing_trust` empty. **Red: `missing=1` today.**
- `relative_spelling_satisfies_session_trust` — `../../lib/auth`. **Red: `missing=1` today.**
- **`external_mode_records_its_degradation_in_the_proof`** — a `next-auth` helper, `mode: "external"`.
  Expect the match to succeed on the specifier **and** the proof to carry the mode. Red: no such
  field.

**GREEN.**
- `AcceptedHelperImport` (`security_patterns.rs:33`) gains `resolved_module_files: Vec<String>` and
  `resolution_mode`.
- Populate in `phase4_policy_for_convention` (`check_command.rs:2330`, helper-import construction at
  `:2196-2206`).
- `helper_import_matches` dispatches **on mode, never on emptiness** (trap 3).
- Surface the mode in the emitted proof.

## S4-02 — the no-regression guarantee

**Test** in `security_patterns.rs`'s `mod tests` (precedent at `:548`):
`unresolved_mode_falls_back_and_says_so` — with no table supplied, matching behaves **exactly** as
today. This is what makes Sprint 4 revertible by reverting the TS field alone.

## S4-03 — csrf and ssrf, which also fixes F4

**Where this is going.** `security_rules.rs:824-828` and `:866-869` require
`fact.name == helper.symbol` **and** `fact.imported_name == helper.symbol`, so a renamed import never
matches. Resolution keys on the **edge**, so switching to mode dispatch fixes the rename for free.
Note `security_rules.rs` was untouched by the last 88 commits — these cites are stable.

**RED.** `crates/drift-engine/tests/security_rules.rs`:
- `renamed_import_of_the_accepted_csrf_helper_satisfies` — `import { assertCsrf as checkCsrf }`.
  **Red: 1 finding today** on a compliant route.
- `renamed_import_of_the_ssrf_allowlist_helper_satisfies` (`:865`) — same defect.
- `relative_spelling_of_the_csrf_helper_satisfies` — F3 on this surface.

**GREEN.** Mode dispatch in `accepted_helper_called` (`:814`) and
`ssrf_allowlist_proves_outbound_urls` (`:865`).

## S4-04 — phase 6

Same treatment for `accepted_imports` (`security_phase6.rs:718`) and `accepted_security_imports`
(`:738`). Tests in `crates/drift-engine/tests/security_phase6.rs`.

## S4-05 — canary check

Confirmed inventory of every pinned assertion of the affected values on `main`:

| Site | Surface | Flips? |
|---|---|---|
| `tests/security_check_repo_phase4.rs:156` | proof-level `missing_trust[].reason` | **YES — in S1-01, deliberately** |
| `tests/security_rules.rs:686-687` | `authorization.missing[].reason` | **No** — legal value, different surface |
| `test/e2e/gt-canary.test.ts:768` | finding-level `actual_layer` | **No** — provided S1-01 widened the mapper |

**Total pinned assertions that flip across the whole plan: one.** If Sprint 4 turns any other
existing test red, **stop and report** — it means the mode dispatch changed behavior it shouldn't.

## S4-06 — sprint gate

`pnpm verify:ci` green. Draft the release note: false positives on barrel imports, relative
specifiers, and renamed imports are fixed. **No new findings are introduced by this sprint.**

---

# PART 5 — SPRINT 5: close the laundering class

**Goal.** F2 closed.
**Depends on.** **S4 — hard.**
**Ships alone.** This is the **only** step in the entire plan that can newly fail a repo that passes
today. Separate PR, separate release note.

## S5-01 — tier-0 sites require identity when the contract supplies it

**RED.** `crates/drift-engine/tests/security_check_repo_auth.rs`:
- `tier0_requires_resolved_identity_when_the_contract_supplies_one` — `withSession` imported from
  `@/lib/attacker-controlled` while the contract names `@/lib/auth`. Expect **no** trusted session.
  **Red today: `trusted=1 missing=0` — it wrongly passes.**
- `tier0_keeps_name_only_matching_when_no_table_is_supplied` — the compatibility guarantee.

**GREEN.** `accepted_auth_helper_for_call` (`:59`), `accepted_request_validator_for_call` (`:191`),
and `accepted_authorization_helper_for_call` (`:605`) consult the identity table when present.

**Do not touch `presence_call_resolves_to_accepted` (`check_command.rs:2169`).** It has the same
rule and it is a documented, pinned, deliberate trade (0.4). It is not F2.

## S5-02 — sprint gate

`pnpm verify:ci`, plus `pnpm eval:evasion` and `pnpm eval:breadth` locally if eval repos are
available — this is the sprint where detection breadth legitimately moves, and the baselines may need
`--update` **with each delta named** (see `chore(evals)` commits for the house format).

---

# PART 6 — SPRINT 6: comment and string immunity

**Goal.** F5 closed for the secret-exposure path.
**Depends on.** **S4** (S6-02 wants the identity table for accepted-serializer sinks).

**Scope warning.** The invariant here is *scoped to secret exposure*, not global. `security_control_flow.rs`
contains **48** `.contains()` calls and phase6 header parsing is text-based too. Do not claim more
than you fixed.

## S6-01 — `SecretRead` from the AST

`secret_read_facts` (`security_facts.rs:644`) is a pure line scan — it cannot tell a comment from
code. Emit `SecretRead` from the tree-sitter walk in `facts.rs` instead. Add the fact kind to
`vocabulary.json` (the generator moves both languages for you — 0.3).

**RED.** `crates/drift-engine/tests/typescript_facts.rs`:
`secret_read_facts_come_from_the_ast_not_the_line`.

## S6-02 — sink facts from the AST

`is_response_sink_line` (`security_proof.rs:1724`) is three `.contains()` calls. Emit response/log
sink facts from `facts.rs`; rewrite it as a fact lookup.

**RED.** `crates/drift-engine/tests/security_check_repo_phase5.rs`:
- `a_commented_out_log_call_is_not_a_secret_sink` — **red today: `Proven` → `MissingProof`**
- `a_secret_name_inside_a_string_literal_is_not_a_secret_sink`

## S6-03 — do NOT do the taint rewrite

The fixpoint loop at `security_proof.rs:1649-1667` is order- and scope-blind, so a sink *above* the
line that taints it is still reported. **That is deferred to its own plan.** It is research-grade and
furthest from what facts express today. Do not start it here.

## S6-04 — pin what you left alone

**Test** `parser_gaps_still_fire_on_the_same_inputs` in
`crates/drift-engine/tests/security_check_repo_phase5.rs`. The parser-gap scanners
(`security_proof.rs:1022`, `:1592`, `:1737`) stay text-based on purpose (0.4). This pins that S6 did
not change them.

## S6-05 — sprint gate

`pnpm verify:ci` green. Release note scoped honestly: *secret-exposure* proofs no longer read
comments and string literals as code.

---

# PART 7 — FINAL

```bash
pnpm verify:ci        # must be green
pnpm verify:evals     # local only — needs $DRIFT_EVAL_REPOS and a release binary
```

**What is true at the end that was not true at the start:**

1. A proof reason value outside its declared vocabulary **fails to compile** (S2).
2. The engine's real output is parsed by the real schema in CI, on every build (S1-04).
3. A helper contract is satisfied by **module identity**, not by how the specifier was spelled or
   whether the binding was renamed — and where identity is unavailable (external packages), the
   degradation is **recorded in the proof** rather than silently assumed (S3–S5).
4. A commented-out line cannot produce a secret-exposure finding (S6).

**Still open, deliberately, each with a reason in the proposal's §8:** taint scope/order analysis;
`security_control_flow.rs`'s 48 text scans; phase6 header parsing; diff/rename; the CLI
`next_commands` surface; the presence tier's name-only matching.
