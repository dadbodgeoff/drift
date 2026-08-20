# Remaining workstreams — source-verified diagnosis

Written 2026-08-18 against `origin/main @ 5e86e89a`. Companion to
`security-convention-pipeline-refactor.md`, which covers the security-convention pipeline. **This
document covers everything that plan de-scoped**, plus two items no prior audit named.

Method is the same: reproduce, cite, mark confidence.
- **[CONFIRMED]** — reproduced by a test I wrote and ran against `origin/main`, output quoted.
- **[CITED]** — read directly at the cited line.
- **[STALE]** — a prior audit asserted it; current source disagrees.

Seven workstreams: **R1**…**R7**. §8 says which need their own TDD document, which need a design
spike first, and how they sequence against the security plan already in flight.

---

## 1. R1 — Proposer coverage: the five `needs-review` ledger cells

### 1.1 What the ledger says

`test/canary/convention-cell-ledger.json` declares one state per (convention kind × enforcement
path). **[CONFIRMED]** — 18 cells: 11 `firing`, 2 `quarantined`, **5 `needs-review`**:

| cell | path |
|---|---|
| `api_route_requires_rate_limit` | `presence_findings` |
| `api_route_requires_rate_limit` | `phase6_proof` |
| `api_route_requires_csrf_for_mutation` | `phase6_proof` |
| `api_route_forbids_untrusted_ssrf` | `phase6_proof` |
| `api_route_forbids_raw_sql_without_params` | `phase6_proof` |

`needs-review` is a **passing** state (`convention-cell-ledger.json` `$comment`; the count prints and
CI exits 0). `docs/decisions/ledger-needs-review.md` proposes tightening it and already ships the
mechanism default-off (`DRIFT_LEDGER_STRICT_NEEDS_REVIEW`).

Every one is `needs-review` for the same stated reason: **the proposer emits no candidate of that
shape on any of the 79 fixtures swept**, so no convention can be accepted, so no check produces a
receipt. The ledger's own framing: *"a cell nobody has been able to evaluate ships exactly as quietly
as a cell that was evaluated and found healthy."*

### 1.2 The ledger's diagnosis is half wrong — there are two root causes, not one

Every cell's `missing_evidence` frames this as a **fixture** problem. For rate-limit it even
prescribes the fixture: *"Needed: a fixture with >=2 rate-limit helpers, each called in >=2 route
files."* That prescription cannot work for the path it is attached to.

**Cause A — dead fact kinds. [CONFIRMED]**

`pnpm check:vocabulary` output, verbatim:

```
- reserved fact_kind:csrf_guard_called (no_producer)
- reserved fact_kind:rate_limit_guard_called (no_producer)
```

Zero producer sites for `FactKind::CsrfGuardCalled` and `FactKind::RateLimitGuardCalled` across
`facts.rs`, `security_facts.rs`, `main.rs`. Compare the siblings, which all have one:

| fact kind | producer sites |
|---|---|
| `ParameterizedSqlUsed` | 1 |
| `OutboundRequestCalled` | 1 |
| `RawSqlCalled` | 1 |
| `CorsPolicyDeclared` | 1 |
| **`CsrfGuardCalled`** | **0** |
| **`RateLimitGuardCalled`** | **0** |

Three proposer paths read them anyway:

- `candidate_command.rs:668` — `fact_kind: "csrf_guard_called"`
- `candidate_command.rs:700` — `fact_kind: "rate_limit_guard_called"`
- `candidate_command.rs:888` — the rate-limit **family** proposer, as one of its sources

These cannot fire on any input, ever. **No fixture fixes them.** The extractor was never written.
Worse, `candidate_command.rs:783` documents the opposite as fact: *"Both the dedicated fact kind
(`rate_limit_guard_called`) and the generic `symbol_called` path emit candidates today"* — a claim
the gate's own baseline contradicts.

**Cause B — conformance threshold vs a violation-shaped corpus. [CITED]**

`push_guard_candidate:1636-1640`:

```rust
grouped_route_facts(input.request, input.api_route_files, input.fact_kind)
    .into_iter()
    .filter(|(symbol, facts)| facts.len() >= 2 && (input.symbol_filter)(symbol))
```

Same threshold in the SSRF block (`:625`) and `push_request_validation_candidates:1694`. The proposer
infers a convention from **conformance** — the helper must already be used ≥2 times in API routes.
The corpus's security fixtures are **violation** fixtures built to exercise the evaluator, so they
contain zero or one use. `security-rate-limit-missing` is literally the absence of the helper.

This is a genuine fixture gap, and here the ledger's prescription is correct.

**Split by cause:**

| cell | cause | fix |
|---|---|---|
| `csrf::phase6_proof` (dedicated path, `:668`) | **A** | write the extractor, or delete the path |
| `rate_limit::phase6_proof` (dedicated, `:700`) | **A** | same |
| `rate_limit` family source (`:888`) | **A** | same |
| `csrf` / `rate_limit` via `symbol_called` (`:685`, `:716`) | **B** | conformance fixture |
| `ssrf::phase6_proof` (`:625`) | **B** | conformance fixture |
| `raw_sql::phase6_proof` (`:615`) | **B** | conformance fixture |
| `rate_limit::presence_findings` | **B** (family derives from per-symbol) | conformance fixture |

### 1.3 Blast radius

Live, and it is the "dead rule ships looking clean" class the ledger was built to prevent — the same
class as the D1 P0 the ledger's header describes. Four security conventions (csrf, rate-limit, ssrf,
raw-sql) cannot be proposed, therefore cannot be accepted, therefore never run. `drift check` emits
no receipt for them, which per the receipt vocabulary is *weaker* than `reached: false`.

### 1.4 Note on stale cites

The ledger's `dispatch` fields cite `check_command.rs:220` / `:276` at `baseline_sha 255f2208`. Main
has moved ~90 commits. Re-anchor by symbol before using them.

---

## 2. R2 — Renamed files vanish from diff scope

### 2.1 Current behavior

`parse_unified_diff` (`crates/drift-engine/src/diff.rs:42-102`) recognizes exactly three line
prefixes: `--- `, `+++ `, `@@ `. There is no `rename from` / `rename to` / `similarity index`
handling — **[CITED]**, and `grep -rn "renamed" crates/drift-engine/src` returns only unrelated
comments about renamed *symbols*.

The TypeScript side matches: `diff.ts:214-217` looks the path up in `diff.files` and returns
`outside_diff` when absent; `filesForConvention:201` passes `diff.files.map(f => f.path)` into
`conventionScopeFiles`.

### 2.2 Failure scenario — reproduced

Git's rename detection is **on by default** for `git diff`. The documented workflow is
`git diff --unified=0 <range> > <path>` (`run-check.ts:68`, `:495`). Running exactly that over a
renamed route: **[CONFIRMED]**

```
$ git diff --cached --unified=0
diff --git a/app/api/x/route.ts b/app/api/x/handler.ts
similarity index 100%
rename from app/api/x/route.ts
rename to app/api/x/handler.ts
```

**No `---`, no `+++`, no `@@`.** The parser produces **zero** `DiffFile` entries. The renamed file is
`outside_diff`, is not in `conventionScopeFiles`, and is not checked.

So: **rename a violating route and `drift check --scope changed-files` reports clean.** That is an
enforcement bypass in the documented workflow, not the cosmetic schema gap earlier reviews described
("`diff_status: "renamed"` has no producer"). Both my Rev-2 proposal and the prior review understated
this. **[STALE]** as previously framed.

With `--no-renames` the same change becomes delete + add, and the add **is** caught (`is_added` →
`new_in_diff`, `diff.ts:223`). So the bypass is a function of a git default the user never chose.

### 2.3 The hard prerequisite, and the mechanism that already exists

`findingFingerprint` (`packages/cli/src/check/finding-fingerprint.ts:35-51`) hashes the file path at
`:45`. Any rename changes every fingerprint in that file, so baselined debt returns as `status:
"new"` — a grandfathering break that would land on users who did nothing but move a file.

**The migration mechanism is already shipped.** `rules.rs:71-77`:

> Fingerprints an older version of this rule would have written for the same violation. D5.1 turns N
> per-specifier findings into one per-statement finding, which necessarily changes the identity of
> the multi-specifier ones. Without this, every baselined multi-specifier violation would come back
> as `new` on the first check after upgrade.

`legacy_fingerprints` flows through `check_command.rs:248`, `:814`, `:952`, `:997`, `:1093`, `:1119`.
A rename-aware change reuses it: emit the pre-rename path's fingerprint as a legacy entry. This
materially de-risks R2 — the scary half has precedent.

### 2.4 Blast radius

Live. Affects every convention, not just security, in both `changed-files` and `changed-hunks`
scope — the modes CI actually runs.

---

## 3. R3 — No can-it-fire ledger for CLI-dispatched conventions (unnamed by any prior audit)

### 3.1 Current behavior

The ledger's `derived_from.dispatch` is `crates/drift-engine/src/check_command.rs` — it enumerates
**engine-dispatched** kinds only. **[CONFIRMED]**: of 23 convention kinds in the vocabulary, 15 have
a cell. The 8 without break down as:

| kind | dispatch | has cell |
|---|---|---|
| `test_expected_for_changed_module`, `custom_briefing` | `none` | correctly absent |
| `file_role`, `module_placement`, `import_boundary`, `entrypoint_flow`, `canonical_helper_reuse`, `required_change_checks` | **`cli`** | **no cell, no equivalent** |

`scripts/vocabulary-parity.mjs` rule 3 checks that `cli` kinds appear in `run-check.ts`. That is
**dispatch existence**, not can-it-fire. The ledger exists precisely because those differ — its own
header: *"a P0 shipped in which `api_route_forbids_sensitive_response_fields` was structurally
incapable of firing while looking covered: both halves of the seam had tests, and both tests
hand-built the accepted contract."*

### 3.2 Failure scenario

End-to-end mentions per kind **[CONFIRMED]**:

| kind | e2e files mentioning it |
|---|---|
| `file_role` | 5 |
| `import_boundary` | 1 |
| `module_placement` | **0** |
| `entrypoint_flow` | **0** |
| `canonical_helper_reuse` | **0** |
| `required_change_checks` | **0** |

Four CLI-dispatched convention kinds have no end-to-end coverage and no structured record of whether
they can fire. That is the exact precondition of the D1 P0, on six kinds, unmeasured.

### 3.3 Blast radius

Unknown — which is the finding. I did **not** verify that any of these four is actually broken, only
that nothing would tell us if it were. **[CONFIRMED]** on the absence of coverage; **not
investigated** on whether each fires. Scoping the ledger is the cheap way to find out.

---

## 4. R4 — The quarantined control-flow tier

### 4.1 What is true today, and one prior claim that is not

`docs/internal/architecture/beta-claims.json:115` says guard dominance is a line-number comparison,
branch detection is `line.contains("if")`, and `unsupported_dynamic_control_flow()` "matches only
Drift fixture strings, so it opens for test inputs and never for real dynamic dispatch."

**Two of three hold. The third is [STALE].** `unsupported_dynamic_control_flow`
(`security_control_flow.rs:175-197`) has been rewritten to be structural:

```rust
if line.contains("](") || line.contains(")(") { return true; }
if line.contains("compose(") || line.contains("applyMiddleware")
    || ((line.contains("middleware") || line.contains("guard"))
        && (line.contains(".forEach") || line.contains(".reduce") || line.contains(".map("))) { … }
```

It also strips `//`- and `*`-leading lines at `:179`. It matches real dynamic dispatch shapes, not
fixture strings. **Any plan quoting that claim needs updating first.**

**Guard dominance is a line-number comparison. [CITED]** `security_control_flow.rs:42-61`:

```rust
let first_guard_line = facts.iter().filter(|f| f.kind == FactKind::AuthGuardCalled)
    .map(|f| f.start_line).min()?;
protected_sinks(facts).into_iter().filter(|sink| first_guard_line < sink.start_line)
```

The minimum guard line versus the sink line, numerically. A guard inside `if (false)`, in a
different function, or in dead code "dominates" every sink below it.

**48 `.contains()` calls in the file** — up from 26 when the audit was written. The file is growing.
But it is **not uniformly naive**: `safe_parse_success_guard_dominates:472` calls
`strip_strings_and_line_comment(line)`. Some paths already handle strings and comments; the file has
no consistent policy.

### 4.2 Blast radius

Contained by design. The tier is quarantined: security heuristics are gated behind
`--experimental-security` (`packages/cli/src/commands/conventions.ts:76`, `:122-126`;
`commands/start.ts:102`) and never auto-accepted. **This is why R4 is not urgent** — the mitigation
is a product gate, and it is in place.

### 4.3 Why this is not TDD-ready

The audit's own verdict is "lift when the layer is rebuilt on AST analysis." Nobody has decided what
that rebuild is. Writing red tests against an undesigned target produces tests that encode the
current shape. **R4 needs a design spike, not a TDD document.**

---

## 5. R5 — Secret-exposure taint has no scope and no order

### 5.1 Current behavior

`secret_sink_exposures` (`security_proof.rs:1630-1686`) runs a fixpoint over **all lines in the
file**, matching variable names textually. There is no scope, no order, no notion of a function
boundary.

### 5.2 Failure scenarios — both reproduced **[CONFIRMED]**

**Cross-scope** — two different variables that share a name:

```ts
function loadConfig() {
  const key = process.env.STRIPE_API_KEY;
  return key.length;
}
export function logRequest(key: string) {   // a DIFFERENT `key`
  console.error(key);
}
```
→ `exposed=1 status=MissingProof`

**Order-blind** — the sink precedes the assignment that taints it:

```ts
console.error(copy);
const copy = process.env.STRIPE_API_KEY;
```
→ `exposed=1 status=MissingProof`

The first is the realistic one: a parameter named `key`, `token`, or `secret` in any function in a
route file inherits taint from an unrelated local elsewhere in that file.

### 5.3 Relationship to the plan already in flight

The security plan's **S6** fixes comment/string immunity for this same builder (`F5`) and explicitly
defers the taint rewrite as **S6-03 "do NOT do the taint rewrite."** R5 is that deferral, written up.
It must come **after** S6, because S6 moves the sink and secret inputs onto AST facts, which is the
substrate a scoped taint pass needs.

---

## 6. R6 — CLI `next_commands` has no registry

### 6.1 Current behavior **[CONFIRMED]**

- 25 files in `packages/cli/src` reference `next_commands`
- **65** distinct construction sites
- `packages/cli/src/app/router.ts` is 267 lines containing **50** `group === …` / `command === …`
  comparisons
- `packages/cli/src/app/command-types.ts` is interfaces only (`CliResult`, `ParsedArgs`,
  `CommandPayload`, `CommandContext`) — **there is no command descriptor registry**

### 6.2 What is already fixed

The *existence/shape* half is remediated. Commit `6e7dc8f6` added a cross-check that reads the
router's own source and compares it against `unknownCommandError` and `validateCommandShape`, so a
command the router handles but the error path rejects (and the reverse) now fails a test. The
remaining exposure is `next_commands` strings pointing at commands that do not exist or are
mis-shaped — partially covered by `scripts/payload-invariants.mjs` check B, which validates
`drift <group> <command> …` pointers against the router.

### 6.3 Blast radius

Low and bounded. Wrong guidance text, not wrong enforcement. **[CITED]** — no security surface.

---

## 7. R7 — Small items

| item | evidence | size |
|---|---|---|
| `AdapterGraphEdgeSchema.kind` is `z.string().min(1)` (`packages/adapters/src/index.ts:119`), unbound to the `graph_edge_kind` vocabulary | `@drift/adapters` has **zero dependents** — no package.json lists it; the only external reference is a boundary-checker error string | one line, only when adapters are wired in |
| Three code comments cite `docs/architecture/security-heuristic-audit.md`; the file is at `docs/internal/architecture/` | `check_command.rs:1819`, `tests/presence_enforcement_cv3.rs:325`, `docs/quickstart.md:94` | trivial |
| `verify:evals` local pin | `ci.yml:3-5` — evals need seven pinned repos and a release binary, so **CI never runs them**; this is a local-hygiene fix, not a CI blocker | trivial |
| Cell-ledger enforcement is integration-branch only | `convention-cell-ledger.mjs:374`, integration = `main`, `remediation/ground-truth-audit`. Documented design (§4.2) to preserve zero-file-overlap while parallel tracks were open; those tracks (#123–#127) have merged, so **the rationale may have expired** | a decision, then one line in `ci.yml` |

---

## 8. Which of these need their own TDD document

| | workstream | live? | TDD-ready? | recommendation |
|---|---|---|---|---|
| **R1** | Proposer coverage / 5 ledger cells | yes | **yes** — every cell names its own missing evidence, and §1.2 splits it by root cause | **own TDD doc** |
| **R2** | Rename bypass + fingerprint migration | yes | **yes** — failure reproduced, migration precedent exists | **own TDD doc** |
| **R3** | CLI-dispatch can-it-fire ledger | unknown | **yes** — the ledger format is a working template | **own TDD doc**, smallest of the three |
| **R4** | Control-flow tier | quarantined | **no** | **design spike first** |
| **R5** | Taint scope/order | yes | **no** — needs R4's fact design | **fold into the R4 spike** |
| **R6** | `next_commands` registry | cosmetic | yes | **one sprint**, no Part-0 doc needed |
| **R7** | Small items | mixed | yes | **fold into any sprint** |

### 8.1 Sequencing against the security plan already in flight

```
security plan   S1 ──► S2
                 │
                 ├──► S3 ──► S4 ──► S5
                 │            │
                 │            └───► S6 ────────────► R5 (after S6's AST facts land)
                 │            │
                 │            └───► R1  (4 of 5 cells are phase6_proof; csrf/ssrf are S4's surfaces)
                 │
R2 ──────────────┴─ independent, no shared files
R3 ──────────────── independent
R4 spike ────────── independent; gates R5's design
R6, R7 ──────────── independent
```

**Hard dependencies:**

- **R1 after S4.** Four of five cells are `phase6_proof`, and csrf/ssrf are exactly the surfaces
  S4-03/S4-04 change. The two halves are different (R1 is proposer-side, S4 is evaluator-side) but
  R1's conformance fixtures are the natural extension of S4's test fixtures. Doing R1 first means
  writing those fixtures twice.
- **R5 after S6.** S6 moves secret and sink detection onto AST facts. A scoped taint pass needs that
  substrate.
- **R4 spike before R5's design.** They would share a fact-emission design; deciding it twice is how
  you get two.

**No dependency:** R2, R3, R6, R7 can start any time, including now, in parallel with the security
plan. R2 and R3 touch no file the security plan touches.

### 8.2 Suggested order if capacity is one workstream at a time

1. **R2** — a live enforcement bypass in the documented workflow, independent of everything.
2. **R3** — cheapest of the three, and it is the one that tells you whether there is a fourth
   workstream hiding behind it.
3. **R1** — once S4 has landed.
4. **R4 spike** → then R5, R6, R7 as capacity allows.

---

## 9. Corrections to prior audits, carried forward

1. **`beta-claims.json:115` on `unsupported_dynamic_control_flow`** — "matches only Drift fixture
   strings" is **stale**. It is structural now (`security_control_flow.rs:175-197`). The other two
   claims in that sentence (line-number dominance, `line.contains("if")` branch detection) hold.
2. **The ledger's `missing_evidence` for csrf and rate-limit** frames a dead-fact-kind problem as a
   fixture gap. Following it would produce fixtures that still cannot make those paths fire.
3. **`candidate_command.rs:783`** asserts that both the dedicated fact kind and the `symbol_called`
   path "emit candidates today." The dedicated path reads a fact kind with zero producers.
4. **Earlier framing of the rename gap** — mine included — as "`diff_status: "renamed"` has no
   producer" understates it. It is an enforcement bypass reachable from the documented workflow.
5. **Ledger `dispatch` line cites** are anchored at `baseline_sha 255f2208`, ~90 commits behind.
   Re-anchor by symbol.

---

## 10. Explicit non-goals

- **Rebuilding the control-flow tier in this document.** It needs a design decision first (§4.3), and
  the `--experimental-security` gate is holding.
- **Deleting the dead `csrf_guard_called` / `rate_limit_guard_called` fact kinds.** Whether to write
  the extractors or delete the proposer paths is a product call — those kinds name real security
  controls. R1's doc should present both options with costs, not pick one here.
- **Changing git rename detection defaults for users.** R2 fixes the parser, not the user's git
  config.
- **MCP transport, the presence tier's name-only matching, `SecurityParserGapCodeSchema` vs
  `parser_gap_kind`** — unchanged from `security-convention-pipeline-refactor.md` §8.
