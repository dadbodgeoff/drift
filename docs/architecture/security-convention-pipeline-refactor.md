# Security-convention pipeline: diagnosis and refactor proposal

**Rev 2** — rebaselined onto `origin/main @ 5e86e89a` (2026-08-18). Rev 1 was written against
`feat/test-intelligence-fields @ 05692e4b`, which has since merged; `main` is 88 commits ahead, with
churn in this proposal's own targets. **Every repro in Rev 1 was re-executed against `main` and every
one reproduces.** All line cites below are `main` line numbers.

Confidence marks:
- **[CONFIRMED-MAIN]** — reproduced by a test I wrote and ran against `origin/main`, output quoted.
- **[CITED-MAIN]** — read directly from `origin/main` at the cited line.
- **[STALE]** — was true earlier; no longer true.

---

## 0. Rebaseline record

| File | HEAD→main churn | Effect on this proposal |
|---|---|---|
| `check_command.rs` | ±797 | line cites only; all cited functions survive |
| `run-check.ts` | ±678 | line cites only; `forbiddenModuleFiles_` → `:3960`, `graphIndexFor` → `:3832`, `reachesForbiddenViaReexport` → `:4003` |
| `security_facts.rs` | ±193 | line cites only |
| `security_patterns.rs` | ±145 | line cites only; every tier site survives |
| `security_proof.rs` | ±42 | F1's emission moved `:1429`→`:1465` |
| `security_rules.rs`, `security_phase6.rs`, `protocol.rs`, `core/src/security.ts` | **untouched** | F4, F6 cites unchanged |

**Re-run of every Rev-1 repro against `main`:**

```
R2  clean route                    → exposed=0  status=Proven
R2  + commented-out console.error  → exposed=1  status=MissingProof      ← F5 reproduces
R3  import { assertCsrf }          → findings=0
R3  import { assertCsrf as check } → findings=1                          ← F4 reproduces
R4  import from "../../lib/csrf"   → findings=1                          ← F3 reproduces
R5  withSession from "@/lib/auth"                → trusted=1 missing=0
R5  withSession from "@/lib/attacker-controlled" → trusted=1 missing=0   ← F2 reproduces
R6  requireUser from "@/lib/auth"     → trusted=1 missing=0
R6  requireUser from "@/lib" (barrel) → missing=1 reasons=["session_not_trusted"]  ← F1+F3 reproduce
R6  requireUser from "../../lib/auth" → missing=1 reasons=["session_not_trusted"]
```

F1's inverted emission is live at `security_proof.rs:1464-1465`. A second
`"session_not_trusted"` at `security_proof.rs:1123` is **not** a new instance — it is
`AuthorizationMissingProof.reason`, where the value is legal (`security.ts:339`).

---

## 1. Current architecture map

### 1.1 The crate split

Two crates in one directory. **[CONFIRMED-MAIN]** — appending
`fn _zz(_n: &crate::protocol::GraphNode) {}` to `security_patterns.rs` yields
`error[E0433]: cannot find 'protocol' in 'crate'`. `lib.rs:3-16` declares the library modules;
`main.rs:9-12` is the only place `mod protocol;` and `mod check_command;` appear.

### 1.2 How a convention-relevant fact reaches a finding

The authoritative module resolver is in **TypeScript**, not Rust.

```
                     ┌──────────────────────────── SCAN (BIN + LIB) ─────────────────────────────┐
 source ──► facts.rs (LIB)                tree-sitter → Fact{kind,name,value,imported_name}
              ├─► security_facts.rs (LIB) :302 unknown_helper source, :644 secret_read_facts
              └─► main.rs (BIN)           :1441 IMPORT_RESOLVES_TO_MODULE   :2343 resolve_import
                                          :2276 resolve_import_symbol  (:2317 chain_closed)
                     └───────────────────────────────┬───────────────────────────────────────────┘
                                                     │ scan payload (JSON)
                     ┌───────────────────────────────▼──── TS: @drift/cli ───────────────────────┐
  run-check.ts :3832 graphIndexFor()      nodesById, resolvedModuleEdgesByFrom,
                                          resolvedSymbolEdgesByFrom (:3870), reexportTargets
               :3960 forbiddenModuleFiles_()      ◄── THE RESOLVER
               :4003 reachesForbiddenViaReexport() BFS over MODULE_REEXPORTS_MODULE
               :4045 exceptionContextForImport()  the ONLY consumer of IMPORT_RESOLVES_TO_SYMBOL
               :1211 "external packages resolve to nothing by design"   ◄── see F7
                     └───────────────────────────────┬───────────────────────────────────────────┘
                                                     │ engine-check.ts:91  matcher.forbidden_module_files
                                                     │ engine-check.ts:95  requires (contract, verbatim)
                     ┌───────────────────────────────▼──── check-repo (BIN) ─────────────────────┐
  protocol.rs  :528 requires: Option<Value>    :541-567 CheckMatcher    :551 forbidden_module_files
  check_command.rs :2330 phase4_policy_for_convention()   :819 graph_direct_data_access_findings()
                   :862 the T93/T100 comment — why identity beats specifiers
                     └───────────────────────────────┬───────────────────────────────────────────┘
                                                     │ Phase4SecurityPolicy / Accepted*Helper (plain data)
                     ┌───────────────────────────────▼──── LIB: matching + proofs ───────────────┐
  security_patterns.rs :59 auth (name)      :73 phase4 auth (name+string)   :191 validator (name)
                       :297 serializer (name+string)  :605 authorization (either)
                       :451/:459/:473 the three matchers   :481 schema_receiver_matches
  security_rules.rs    :814 accepted_helper_called   :865 ssrf_allowlist_…   (rename-hostile — F4)
  security_phase6.rs   :718 accepted_imports         :738 accepted_security_imports
  security_proof.rs    :1429 build_session_trust_proof_from_facts (:1465 F1)
                       :1630 secret_sink_exposures  :1724 is_response_sink_line   (F5)
                       :1022 / :1592 / :1737 parser-gap scanners (conservative — NOT F5)
                     └───────────────────────────────┬───────────────────────────────────────────┘
                                                     │ check_command.rs :3823 wire  :3638 finding reason
                     ┌───────────────────────────────▼──── TS consumers ─────────────────────────┐
  engine-contract/src/index.ts:962 / core/src/security.ts:323   ← the enum F1 violates
  run-check.ts:3384  SecurityBoundaryProofSchema.parse(…)   ◄── hard parse, THROWS
  storage/src/sqlite-storage.ts  .parse(…) on write AND read
                     └──────────────────────────────────────────────────────────────────────────┘
```

### 1.3 The resolution tiers

Twelve name-or-string sites against one identity-resolved site. **[CITED-MAIN]**

| Tier | Rule | Sites | Failure direction |
|---|---|---|---|
| **0** name only | `imported_name == symbol` | `security_patterns.rs:59`, `:191`, `:451`, `:481`, `:605`(no source); `check_command.rs:2169` | **false negatives** (laundering) |
| **1** name + raw specifier | tier 0 + `fact.value == import_source` | `security_patterns.rs:73`, `:297`, `:459`, `:473`, `:605`(with source); `security_rules.rs:814`, `:865`; `security_phase6.rs:718`, `:738` | **false positives** (spellings, renames) |
| **2** resolved module identity | `IMPORT_RESOLVES_TO_MODULE` + `MODULE_REEXPORTS_MODULE` | `check_command.rs:819`, fed by `run-check.ts:3960` | neither — *for repo-local imports only* (F7) |

**Tier 1 is not a stronger tier 0.** It trades a false-negative class for a false-positive class
(F2 vs F3/F4). Only resolved identity dominates both. Any plan built on "promote the tier-0 sites to
tier 1" ships false positives on compliant repos.

### 1.4 Already fixed — do not re-solve

- **Convention-capability lookups are generated.** `vocabulary/vocabulary.json` → `generate.mjs` →
  `vocabulary.rs` + `vocabulary.ts`; 8 vocabularies, 163 members; `pnpm check:vocabulary` green with
  10 baselined reserved members. **[CONFIRMED-MAIN]**
- **`is_presence_convention` is not a duplicate** — `check_command.rs:1983` reads a per-*instance*
  field. **[CITED-MAIN]**
- **The presence tier's name-only matching is a documented, pinned trade**
  (`check_command.rs:2169`, `beta-claims.json:108`, `tests/presence_enforcement_cv3.rs`). Leave it.
- The heuristic audit lives at `docs/internal/architecture/security-heuristic-audit.md`; three code
  comments point at `docs/architecture/`. Cosmetic.

---

## 2. Findings

### F1 — The engine emits a proof value the schema that parses it rejects. **LIVE. [CONFIRMED-MAIN]**

`security_proof.rs:1460-1470`:

```rust
(source, Some("untrusted")) => {
    missing_trust.push(SessionMissingTrustProof {
        fact_id: fact_id(fact), variable,
        reason: if source == Some("unknown_helper") {
            "session_not_trusted"          // ← :1465
        } else { "derived_from_request" }.to_string(),
    });
}
```

Wire-serialized at `check_command.rs:3823`. Parsed by
`z.enum(["derived_from_request","unknown_helper","missing_auth_guard","parser_gap"])` at
`core/src/security.ts:323` and `engine-contract/src/index.ts:962`. `"session_not_trusted"` is in
neither. Reproduced end-to-end through the real binary (R6, §0); the payload fed to the real schema
yields `invalid_enum_value` at `["session_trust","missing_trust",0,"reason"]`.

**Blast radius.** Hard `.parse()`, not `safeParse`: `run-check.ts:3384` plus four
`sqlite-storage.ts` sites — which fire **on read as well as write**. The
`unknown_reason_code` normalization built for exactly this problem
(`engine-contract/src/index.ts:641`) is applied only to `missing_proof[].code`.

**Why every suite is green.** `tests/security_check_repo_phase4.rs:156` *asserts the illegal value*
and passes. **No test crosses the Rust→Zod boundary.** That, not enum duplication, is the root cause.

**Producer audit of the 4-member enum — one member is real:**

| member | producer |
|---|---|
| `derived_from_request` | ✓ `security_proof.rs:1467` |
| `unknown_helper` | ✗ a *source* discriminator at `security_facts.rs:302`, never a reason |
| `missing_auth_guard` | ✗ a finding-level code (`security_rules.rs:186`, `:228`, `check_command.rs:1079`) |
| `parser_gap` | ✗ no producer |

**The wrong fix already shipped next door.** The identical collision hit tenant and authorization and
was repaired by *widening the consumer*: `security.ts:361` carries seven members — four original
proof-level names plus the three finding-level names the engine actually emits. Zero Rust producers
exist for `no_tenant_predicate`, `untrusted_tenant_source`, `predicate_not_bound_to_query`,
`no_authorization_guard`, `guard_not_dominating_sink`, `unknown_policy_helper`, `dynamic_matcher`.
Widening permanently encodes two names per concept and leaves seven dead members.

### F2 — Tier-0 laundering. **LIVE false negative. [CONFIRMED-MAIN]**

`accepted_auth_helper_for_call` (`security_patterns.rs:59`) matches `imported_name` only. Any file
exporting a symbol named `withSession` produces a **passing** session-trust proof (R5). Same rule at
`:191`, `:451`, `:481`, and `:605` when the contract omits `import_source`.

### F3 — Tier-1 specifier-string matching. **LIVE false positive. [CONFIRMED-MAIN]**

`helper_import_matches` (`security_patterns.rs:473`) is a raw string comparison. The barrel and the
relative spelling of the *same file* both fail (R6, R4). **F1 and F3 compound**: the barrel case is
simultaneously a false positive and the payload that throws.

### F4 — Two contradictory answers to "is this the accepted helper". **LIVE false positive. [CONFIRMED-MAIN]**

`security_rules.rs:824-828` (and `:866-869`) require `fact.name == helper.symbol`, so a renamed
import never matches (R3). This contradicts `check_command.rs:2169`'s doc comment, which handles the
rename shape explicitly, and `security_patterns.rs:64-70`, which handles it correctly. Affects
`api_route_requires_csrf_for_mutation` (`security_rules.rs:441`) and
`api_route_forbids_untrusted_ssrf` (`:851`).

### F5 — Secret-exposure detection reads comments and string literals as code. **LIVE false positive. [CONFIRMED-MAIN]**

`secret_sink_exposures` (`security_proof.rs:1630`) is a whole-file line scan;
`is_response_sink_line` (`:1724`) is three `.contains()` calls. A commented-out
`// console.error(apiKey)` flips a route from `Proven` to `MissingProof` (R2). The taint loop is also
order- and scope-blind: a sink *above* the assignment that taints it is still reported.

**Correction retained from Rev 1.** `security_proof.rs:1022`, `:1592`, `:1737` are **parser-gap
detectors** emitting `blocks_enforcement: true` — over-firing *refuses to enforce*. Only `:1630` is
detection that over-fires into a reported finding. Opposite blast radii; do not migrate as one unit.

### F6 — 34 duplicated enum lists, in perfect agreement. **LATENT. [CONFIRMED-MAIN]**

Programmatic diff of `core/src/security.ts` (40 `z.enum`s) against `engine-contract/src/index.ts`
(60): 34 byte-identical member lists. They do not currently disagree — the Rev-1 review's framing of
this as F1's *cause* is **[STALE]**; F1 is Rust↔TS. The duplication remains a hazard, not a live bug.

**Do not merge** `SecurityParserGapCodeSchema` (14 members, security-proof gap codes) with the
generated `parser_gap_kind` vocabulary (9 members, CLI-derived from engine diagnostics). Disjoint
sets, different concepts, coincidental name.

### F7 — External helpers have no resolution edge, and Rev 1's fallback would have hidden that. **NEW. [CONFIRMED-MAIN]**

`resolve_import` (`main.rs:2343-2348`) ends:

```rust
.find(|candidate| resolver.snapshot_paths.contains(candidate))
```

It resolves **only to files in the scan snapshot**. An import from `next-auth`, `@clerk/nextjs`, or
any node_modules package produces **no** `IMPORT_RESOLVES_TO_MODULE` edge. `run-check.ts:1211-1212`
states it in the codebase's own words: *"external packages resolve to nothing by design and are
excluded from both sides of the ratio."*

Rev 1's P2.3 said "empty resolved table → fall back to specifier matching." That fallback is
**per-convention**, so for every contract naming an external auth helper — the most common real-world
shape — the table is permanently empty and tier-1 semantics are retained **forever, silently**. That
is the silent-tier-degradation class this document exists to eliminate, reintroduced by its own
compatibility mechanism. Rev 1 was wrong here; §3.2 replaces it.

The codebase already has the honest-degradation primitive: `resolve_import_symbol`
(`main.rs:2317-2319`) sets `chain_closed = false` when a re-export star target is outside the
snapshot, precisely to record "my answer is open-ended." The fix reuses that idea rather than
inventing one.

---

## 3. Proposed architecture

### 3.1 P1 — One reason vocabulary per proof surface, generated

**Invariant.** *A reason value that is not a declared member of that surface's vocabulary fails to
compile.* `security_proof.rs:1465` becomes `SessionTrustReason::SessionNotTrusted` — which does not
exist — instead of a string literal. This is the property `ConventionKind` already has, and the one
`security_capabilities.rs:20-42` documents gaining after the identical defect.

**Why extend the generator.** `scripts/vocabulary-parity.mjs` rule 5 ("every member has a producer
and a consumer, or is baselined as reserved with a reason") would have flagged all seven
zero-producer members the day these enums entered the manifest. The gate is written; the
vocabularies just aren't in it.

- **P1.1 — fix the live bug, no schema change.** `security_proof.rs:1465` → `"unknown_helper"`.
  **`check_command.rs:3643` must simultaneously widen** to map *both* `derived_from_request` and
  `unknown_helper` → `session_not_trusted`; otherwise `unknown_helper` falls through `:3646` into the
  finding-level code, where it is not a `SecurityMissingProofCodeSchema` member and normalizes to
  `unknown_reason_code` at `engine-contract/src/index.ts:644` — trading a crash for silent
  degradation.
- **P1.2 — the cross-boundary gate** (§4 test 5). Land first if you want red→green.
- **P1.3** Add `session_trust_reason` to `vocabulary.json` with `rust_enum`; retype the Rust field;
  delete the two hand-written `z.enum`s at `security.ts:323` / `index.ts:962`.
- **P1.4** Repeat per surface: `authorization_missing_reason`, `tenant_missing_reason`,
  `undominated_sink_reason`, `middleware_mismatch_reason`, `request_unvalidated_reason`,
  `security_missing_proof_code`, `security_parser_gap_code`. One commit each.

  **Revised from Rev 1: do not delete the zero-producer members.** Rev 1 called deletion "the honest
  option." That is wrong given `sqlite-storage.ts` `.parse()`s **on read**, and given the
  tenant/authorization enums were previously *widened* — persisted proof rows may legitimately
  contain members a producer-only audit calls dead. Shrinking the enum bricks reads of those rows.
  Baseline them as `reserved` with the reason "superseded by the finding-level name; retained for
  stored-row compatibility," and gate any later deletion on a stored-row census.

### 3.2 P2 — Resolved helper identity, with an explicit per-helper mode

**Rev 1's rejection of the prior review's options (a) and (b) stands.** `protocol.rs:543-549` and
`engine-check.ts:85-87` both state that the engine receives a **diff-scoped** graph and cannot derive
what a specifier means. Option (a) is incorrect in changed-files mode; option (b) does not help,
because the problem is not which crate can *see* graph types but that the binary never *receives*
the whole-repo graph.

**What Rev 1 got wrong (F7): the per-convention fallback.** Replaced by a **per-helper resolution
mode**, decided once per accepted helper and carried on the wire:

| mode | when | matching rule |
|---|---|---|
| `repo_resolved` | the helper's specifier produced an `IMPORT_RESOLVES_TO_MODULE` edge | resolved-file identity, incl. re-export chains |
| `external` | the specifier is a bare package specifier that resolved to nothing | exact-specifier match **+ local-shadow check**: fail if a repo file also exports that symbol under a path alias that could shadow it |
| `unresolved` | a repo-relative specifier that resolved to nothing | exact-specifier match, **and the proof records the degradation** |

Plus one alarm: a specifier classified `external` that *does* resolve repo-locally is the
tsconfig-paths hijack shape and must be flagged, not silently accepted.

**The mode must be visible in the emitted proof.** An invisible fallback is indistinguishable from
the bug it replaces. Model the field on `chain_closed` (`main.rs:2317-2319`).

**Revised from Rev 1: ship the table as a typed matcher field, not inside `requires`.**
`engine-check.ts:95` passes `requires: securityRequires(convention)`, and `securityRequires`
(`:146-148`) returns the **stored convention's** `requires` verbatim. Injecting CLI-computed
resolution data there mixes contract with derivation, breaks "enforcement is a pure function of the
contract," and bypasses typing — `protocol.rs:528` is `Option<Value>`, so a typo-shaped field ships
silently. `forbidden_module_files` (`engine-check.ts:91`, `protocol.rs:551`) is a **typed matcher
field**; `accepted_helper_module_files` becomes its typed sibling. One struct field, one Zod line.

**Migration path.**

- **P2.1** Generalize `forbiddenModuleFiles_` (`run-check.ts:3960`) into
  `resolvedModuleFilesFor(specifiers)`. Pure refactor.
- **P2.2** Compute, per security convention, `accepted_helper_module_files: Array<{symbol, mode,
  files}>` from `requires.auth_helpers[].import_source` and the phase6/csrf/ssrf equivalents, reusing
  P2.1 + `reachesForbiddenViaReexport` (`:4003`). **Sort and dedupe the file lists** — the
  determinism digest (`scripts/determinism.mjs:105-113`) covers findings only, not proofs, so
  ordering nondeterminism introduced here would be invisible to it. Ship as a typed matcher field.
- **P2.3** Extend `AcceptedHelperImport` (`security_patterns.rs:33`) with `resolved_module_files` and
  `resolution_mode`, populated in `phase4_policy_for_convention` (`check_command.rs:2330`). Change
  `helper_import_matches` (`:473`) to **dispatch on mode**, not on emptiness.
- **P2.4** Same for `security_rules.rs:814` / `:865` — which also fixes F4, because resolution keys
  on the edge rather than `fact.name`.
- **P2.5** Same for `security_phase6.rs:718` / `:738`.
- **P2.6** Tier-0 sites (`security_patterns.rs:59`, `:191`, `:605`) begin requiring resolved identity
  when the contract supplies it. Land last — the only step that can newly fail a passing repo.

**RESOLVED (was an open item in an earlier draft): the TS fallback resolver exists, is weaker, and
cannot reach a check. No gating needed. [CONFIRMED-MAIN]**

A second resolver does exist. `packages/factgraph/src/index.ts:341` emits
`IMPORT_RESOLVES_TO_MODULE` using its own `resolveImportPath` (`:575-591`), and
`packages/cli/src/engine/fact-graph.ts:22` calls the deriving function, so it is live CLI code, not
a dead package.

It **is** materially weaker than Rust's, in exactly the two ways suspected:

| capability | Rust `import_bases` (`main.rs:2383`) | TS `aliasImportBases` (`factgraph:607`) |
|---|---|---|
| relative specifiers | ✓ `:2384-2390` | ✓ `:581-582` |
| tsconfig path aliases | ✓ **scope-aware**: only aliases whose scope contains the importing file, deepest scope wins (`:2393-2413`) | ✓ **flat** `Record<string, string[]>`, no scope concept |
| workspace package imports | ✓ `resolver.package_imports` (`:2415-2423`) | ✗ none |

**But it can never produce the edges a security convention is evaluated against**, for two
independent reasons:

1. `checkData.graph_edges` is assembled exclusively from engine scan events —
   `collect-scan-data.ts:249` (`graphEdges.push(...event.graph_edges)`) and `:295`. The TS derivation
   is called from exactly one place, `scan-status.ts:187`, which builds a *stored artifact*, not
   check input.
2. That call site is the `else` of `scanData.graph_nodes.length > 0` (`scan-status.ts:161`) — it runs
   only when the Rust engine produced no graph, i.e. the TypeScript fallback scanner ran
   (`collect-scan-data.ts:104-143`, `fallback_reason: "rust_engine_failed"`). **And in that state the
   check refuses**: `run-check.ts:583-585` — "this path exits `CHECK_EXIT_REFUSED` with
   `blocked_reasons ["typescript_fallback_used"]`".

So whenever the weaker resolver is the one producing edges, the check has already refused. P2 may
treat `IMPORT_RESOLVES_TO_MODULE` in `checkData` as engine-produced without a guard, and the existing
refusal is the invariant that guarantees it. Cite it in P2.2's code comment so a future change that
softens the fallback refusal is understood to break P2.

**One latent risk to record, not to act on now.** `AdapterGraphEdgeSchema.kind`
(`packages/adapters/src/index.ts:119`) is `z.string().min(1)` — unconstrained, not bound to the
`graph_edge_kind` vocabulary. `@drift/adapters` has **zero dependents** today (no package.json lists
it; the only external reference is a boundary-checker error string), so no adapter can inject edges.
If adapter batches are ever wired into the scan path, an adapter could emit
`IMPORT_RESOLVES_TO_MODULE` with arbitrary semantics and P2 would trust it silently. The cheap guard
at that time: type `kind` against the generated vocabulary, which also makes it visible to
`check:vocabulary`.

### 3.3 P3 — Split: comment/string immunity now, taint analysis deferred

**Revised from Rev 1.** Rev 1 stated a global invariant ("a token inside a comment cannot produce a
security finding") that P3 does not deliver: `security_control_flow.rs` contains **48** `.contains()`
calls **[CONFIRMED-MAIN]** and phase6 header parsing is text-based too. The invariant is scoped to
the secret-exposure path only. Rev 1 also inverted the sensible rebuild order.

- **P3.1** Emit `SecretRead` from the tree-sitter walk in `facts.rs` instead of
  `security_facts.rs:644`'s line scan. One fact kind added to `vocabulary.json`.
- **P3.2** Emit response/log sink facts from `facts.rs`; rewrite `is_response_sink_line`
  (`security_proof.rs:1724`) as a fact lookup. **P3.1+P3.2 are cheap, mechanical, and close a
  reproduced embarrassment — keep them on this schedule.**
- **P3.3 — DEFERRED to its own plan.** Order- and scope-aware taint replacing the fixpoint loop at
  `security_proof.rs:1642-1660` is research-grade and is the piece furthest from what facts express
  today. Do not schedule it here.

**Not in scope:** the parser-gap scanners (`:1022`, `:1592`, `:1737`) stay text-based — they emit
`blocks_enforcement: true`, so over-firing refuses to enforce.

---

## 4. Test plan per step

### P1.1 — fix the emitted value

| # | File | Test | Red today because |
|---|---|---|---|
| 1 | `tests/security_check_repo_phase4.rs` (extend) | `session_trust_reason_is_a_member_of_the_wire_enum` | emits `session_not_trusted` |
| 2 | same, **modify** `:151-158` | assert `unknown_helper`; **add** that the *finding* still reports `session_not_trusted` | pins the illegal value |
| 3 | `security_proof.rs` `mod tests` | `unknown_helper_source_maps_to_unknown_helper_reason` | `:1465` |
| 4 | `check_command.rs` `mod tests` | `both_session_trust_reasons_map_to_the_finding_code` | `:3643` maps only the first |

### P1.2 — the cross-boundary gate (highest-value item in the plan)

| # | File | Test | Red today because |
|---|---|---|---|
| 5 | `scripts/engine-schema-parity.mjs` + `.test.mjs` (new; register in `test:harness` and `verify:ci`) | drive the built engine over the fixture corpus, run every `security_boundary_proofs` entry through `SecurityBoundaryProofSchema.safeParse`, fail on rejection | the barrel fixture yields `invalid_enum_value` |

Model on `vocabulary-parity.mjs`'s ratchet-with-baseline shape.

### P1.3 / P1.4

| # | File | Test | Red today because |
|---|---|---|---|
| 6 | `scripts/vocabulary-parity.test.mjs` (extend) | `session_trust_reason_members_all_have_producers` | 3 of 4 have none |
| 7 | `packages/core/test/security.test.ts` | schema imported from `@drift/vocabulary`, not inline | inline at `:323` |
| 8 | compile-level | re-introducing `reason: "session_not_trusted"` must be a **type error** | it is a `String` field |
| 9 | `scripts/vocabulary-parity.test.mjs` | repeat #6 per surface | 7 zero-producer members |
| 10 | **new** `scripts/stored-proof-census.mjs` | enumerate reason values in persisted proof rows; **gate P1.4 deletions on this** | nothing measures stored rows (§3.1 revision) |

### P2

| # | File | Test | Red today because |
|---|---|---|---|
| 11 | `packages/cli/test/contract-liveness-bb4.test.ts` (extend) | `resolvedModuleFilesFor_matches_forbiddenModuleFiles_` — characterization lock for P2.1 | function absent |
| 12 | new `packages/cli/test/accepted-helper-identity.test.ts` | `barrel_reexport_resolves_to_the_helper_module` | nothing computes it |
| 13 | same | `a_same_named_export_from_an_unrelated_module_resolves_elsewhere` — F2 control | — |
| 14 | same | **`an_external_package_helper_is_classified_external_not_empty`** — F7's core case | no mode concept |
| 15 | same | **`an_external_specifier_that_resolves_repo_locally_is_flagged`** — tsconfig-paths hijack | — |
| 16 | same | `resolved_file_lists_are_sorted_and_deduped` | — |
| 17 | `packages/cli/test/engine-bridge.test.ts` (extend — it covers `engine-check.ts`'s request build) | `accepted_helper_module_files_is_a_typed_matcher_field_not_inside_requires` | field absent |
| 17b | `packages/cli/test/cli.test.ts` (extend) | `a_typescript_fallback_scan_refuses_before_any_helper_resolution_runs` — pins the invariant §3.2 relies on, so softening the fallback refusal fails loudly instead of silently feeding P2 weaker edges | passes today; this is a **characterization lock**, not a red test |
| 18 | `tests/security_check_repo_phase4.rs` | `barrel_imported_auth_helper_satisfies_session_trust` | `missing=1` |
| 19 | same | `relative_spelling_satisfies_session_trust` | `missing=1` |
| 20 | same | `an_unrelated_module_exporting_the_same_symbol_does_not_satisfy` | `trusted=1` (wrongly passes) |
| 21 | same | **`external_mode_records_its_degradation_in_the_proof`** — the anti-silent-fallback test | no such field |
| 22 | `security_patterns.rs` `mod tests` (precedent at `:548`) | `unresolved_mode_falls_back_and_says_so` | — |
| 23 | `tests/security_rules.rs` (extend) | `renamed_import_of_the_accepted_csrf_helper_satisfies` | 1 finding (F4) |
| 24 | same | `renamed_import_of_the_ssrf_allowlist_helper_satisfies` | same defect |
| 25 | same | `relative_spelling_of_the_csrf_helper_satisfies` | 1 finding |
| 26 | `tests/security_phase6.rs` (extend) | rename + barrel for `:718` / `:738` | same defect |
| 27 | `tests/security_check_repo_auth.rs` | `tier0_requires_resolved_identity_when_the_contract_supplies_one` | passes wrongly |

### P3.1 / P3.2

| # | File | Test | Red today because |
|---|---|---|---|
| 28 | `tests/security_check_repo_phase5.rs` (extend) | `a_commented_out_log_call_is_not_a_secret_sink` | `Proven`→`MissingProof` |
| 29 | same | `a_secret_name_inside_a_string_literal_is_not_a_secret_sink` | same |
| 30 | `tests/typescript_facts.rs` (extend) | `secret_read_facts_come_from_the_ast_not_the_line` | line-scanned |
| 31 | `tests/security_check_repo_phase5.rs` | `parser_gaps_still_fire_on_the_same_inputs` — pin that P3 left them alone | — |

---

## 5. Canary-impact inventory

The reviewer asked for this and was right to. The answer is smaller than feared — I enumerated every
pinned assertion of the affected values on `main`:

| Site | Surface | Flips? |
|---|---|---|
| `tests/security_check_repo_phase4.rs:156` | proof-level `missing_trust[].reason` | **YES — deliberately, in P1.1** (test 2) |
| `tests/security_rules.rs:686-687` | `authorization.missing[].reason` | **No** — legal value on a different surface |
| `test/e2e/gt-canary.test.ts:768` | finding-level `actual_layer` | **No** — *provided* P1.1's mapper widening is done |

`gt-canary.test.ts:768` is the **guard**, not a casualty: if P1.1 changes the emission without
widening `check_command.rs:3643`, that canary goes red. That is exactly the trap, caught for free.

S4/S6 blast radius is confined to `tests/security_rules.rs` and `tests/security_phase6.rs` — grep for
`assertCsrf|accepted_csrf|exposed_secrets|accepted_allowlist_helpers` finds **no e2e canary
assertions** on those surfaces.

**Total pinned assertions that flip across the whole plan: one.**

---

## 6. Sequencing and sprint boundaries

| Sprint | Steps | Done signal | Prerequisites |
|---|---|---|---|
| **S1** Stop the crash, add the gate | P1.1, P1.2 | `check:engine-schema-parity` green and in `verify:ci`; tests 1-5 green; gt-canary still green | none |
| **S2** Generate the reason vocabularies | P1.3, P1.4, census | `check:vocabulary` green with new vocabularies; tests 6-10; no inline `reason: z.enum` left | **S1** |
| **S3** Resolver + modes, TS side | P2.1, P2.2 | tests 11-17 green; field on the wire, engine ignores it harmlessly | none (parallel with S2) |
| **S4** Resolved identity, Rust side | P2.3, P2.4, P2.5 | tests 18-26 green; F3, F4 closed | **S3** |
| **S5** Close the laundering class | P2.6 | test 27 green; F2 closed | **S4** |
| **S6** Comment/string immunity | P3.1, P3.2 | tests 28-31 green; F5 closed | **S4** |
| *(deferred)* | P3.3 taint analysis | own plan | — |

- **S1 and S3 start the same day** — disjoint files.
- **S2 must not precede S1**: generating a Rust enum from today's member set would freeze a set that
  is three-quarters dead and missing the value the engine emits.
- **S5 ships alone, with a release note** — the only step that can newly fail a passing repo.
- **Revertibility** rests on P2.3's mode dispatch: `external`/`unresolved` reproduce today's
  behavior exactly, so S4 reverts by reverting the TS field alone.

---

## 7. Pre-S1 items — verified, with two reviewer claims corrected

1. **`verify:evals` — reviewer's CI claim is wrong; the pin is still worth fixing.** The reviewer
   said "main is red on the `verify:evals` pin (every sprint PR fails CI until that one-liner
   lands)." `verify:evals` **does not run in CI at all**: `.github/workflows/ci.yml:3-5` states it
   needs seven pinned eval repos and a release binary, "neither of which exist on a hosted runner.
   Evals are a local gate." CI runs `verify:ci` only (`ci.yml:70`). So sprint PRs will not fail on
   it. Fix it for local `verify:full` hygiene, not as a CI blocker. **[CITED-MAIN]**
2. **Ledger gate — reviewer's effect is right, the cause is a documented design.**
   `convention-cell-ledger.mjs:374-375` enforces only on
   `integration_branches: ["remediation/ground-truth-audit", "main"]`; elsewhere it reports and exits
   0 (`:418-420`). So yes, PR builds cannot fail it — but by design (§4.2, header `:28-31`), to
   preserve zero-file-overlap while parallel tracks were open. Those tracks (#123–#127) have merged,
   so **the rationale may have expired — that is a call for you, not a defect I should assert.** If
   you want PR-level enforcement, set `DRIFT_LEDGER_ENFORCE=1` in `ci.yml`. **[CITED-MAIN]**
3. **Cell-ledger `receipt_evidence` is string-anchored** to Rust source forms
   (`convention-cell-ledger.mjs:21-26` chooses regex over a parser deliberately). P1.1 changes a
   string literal in `security_proof.rs` and P2.3 changes `helper_import_matches`; re-run
   `pnpm check:cell-ledger --report` after each and update anchors in the same commit.

---

## 8. Explicit non-goals

**Overturned from the prior (external) review:**

1. Its Phase-2 option (a), "compute the table in `check_command.rs`" — the engine receives a
   diff-scoped graph (`protocol.rs:543-549`, `engine-check.ts:85-87`). It was that review's
   recommended first move.
2. Its Phase-2 option (b), "promote graph types into the lib crate" — same reason, higher cost.
3. Its framing of the tiers as a strength ladder (§1.3).
4. Its claim that the two hand-typed TS copies cause F1 — they are byte-identical and both correct.
5. Its citation of `security.ts:339` as the violated enum — that is the *authorization* enum, which
   legitimately contains the value. The violated enum is `:323`.

**Overturned from Rev 1 of this document:**

6. **"Empty resolved table → fall back to specifier matching."** Reintroduces silent tier
   degradation for every external helper (F7). Replaced by per-helper modes (§3.2).
7. **"Ship the table inside `requires`."** Mixes contract with derivation and bypasses typing
   (`engine-check.ts:95`, `securityRequires:146-148`). Replaced by a typed matcher field.
8. **"Deleting the dead members is the honest option."** Storage `.parse()`s on read; the widened
   enums mean stored rows may hold them. Baseline-as-reserved, gated on a census (§3.1, test 10).
9. **The global comment/string invariant, and P3's ordering.** Scoped to secret exposure; P3.3 split
   out (§3.3).

**De-scoped, with reasons:**

10. **CLI command registry.** The existence/shape half is remediated (`6e7dc8f6` added a cross-check
    reading the router's own source). Not part of this pipeline.
11. **Diff/rename two-stage resolution.** Still open — `diff_status: "renamed"` has zero producers
    while Rust's `DiffStatus` (`diff.rs:30-34`) is a disjoint three-variant enum. It has its own hard
    prerequisite (path-keyed fingerprints converting baselined debt to `new`) that would wreck this
    plan's revertibility if mixed in. Own plan.
12. **MCP transport.** No change.
13. **The presence tier's name-only matching.** Documented, pinned, deliberately traded. P2 gives it
    an escape hatch later if that product decision is revisited.
14. **Merging `SecurityParserGapCodeSchema` into `parser_gap_kind`.** Disjoint concepts (F6).
15. **The parser-gap text scanners.** Conservative by construction; test 31 pins that P3 leaves them.
16. **`security_control_flow.rs`'s 48 `.contains()` calls and phase6 header parsing.** Real, and the
    reason §3.3's invariant is scoped rather than global. Own plan.
