# Security convention architecture: what's actually happening, and a plan

Written 2026-08-18 against `feat/test-intelligence-fields` (one commit behind `main`). This is a
source-verified response to an external agent's 7-point review of the security-convention
pipeline. Every claim below was checked against actual line numbers, not taken on the review's
word — three of its seven claims needed correction once checked. This doc exists to be the plan;
treat the original review as superseded by this.

## 1. The architecture, as it actually exists

### 1.1 The crate split — this is the load-bearing fact everything else hangs off

`crates/drift-engine` is **two crates in one directory**, and which side of that split a module
sits on determines what it's allowed to see.

```
crates/drift-engine/src/
├── lib.rs        ── the LIBRARY crate
│   mod facts;               fact extraction (tree-sitter walk)
│   mod security_facts;      security-specific fact extraction
│   mod security_patterns;   "does this call resolve to an accepted helper" — ALL FIVE tiers
│   mod security_rules;      SecurityAuthContract / phase4-5 rule assembly
│   mod security_phase6;     SSRF/CORS/CSRF/rate-limit/raw-SQL evaluators
│   mod security_proof;      proof-object builders (line-text scans live here)
│   mod security_control_flow;  guard-dominance / branch-bypass analysis
│   mod security_capabilities;  ScanCapability status rollup
│   pub mod vocabulary;      @generated — ConventionKind, FactKind, dispatch()...
│   mod data_access, diff, prisma, rules
│
└── main.rs       ── the BINARY crate (depends on the lib crate, not the reverse)
    mod protocol;         GraphNode, GraphEdge, GraphNodeKind, GraphEdgeKind, CheckConvention
    mod check_command;    convention dispatch, graph_direct_data_access_findings, is_presence_convention
    mod candidate_command; candidate proposal
    mod frameworks;
```

**Concretely:** [`lib.rs:1-16`](../../crates/drift-engine/src/lib.rs) declares `security_patterns`
etc. as lib modules. [`main.rs:9-12`](../../crates/drift-engine/src/main.rs) is the *only* place
`mod protocol;` and `mod check_command;` are declared. `GraphNode`/`GraphEdge` are defined at
[`protocol.rs:272`](../../crates/drift-engine/src/protocol.rs) and
[`:291`](../../crates/drift-engine/src/protocol.rs) — binary-only types.

This means: nothing in `security_patterns.rs` can import a graph type. Not "shouldn't," *can't* —
wrong direction of the dependency arrow. Any resolved-module-graph lookup has to either (a) live in
`check_command.rs`/`protocol.rs` where graph types are visible, and get its answer handed down as
plain data, or (b) require promoting graph types up into the lib crate first. There is currently
exactly one place doing (a):
[`graph_direct_data_access_findings`](../../crates/drift-engine/src/check_command.rs) at
`check_command.rs:716`, which walks `GraphEdgeKind::ImportResolvesToModule` edges, then hands the
result down as `rule.forbidden_module_files: Vec<String>` — a precomputed lookup table, not a
shared resolver call.

### 1.2 The identity-resolution tiers this produces

Given that constraint, five call sites independently answer "does this call resolve to the
accepted helper," each at a different strength, because each was solved without a shared primitive
to reach for:

| Tier | What it checks | Where | Can be evaded by |
|---|---|---|---|
| **0 — name only** | `fact.name == call.name && imported_name == symbol` | [`accepted_auth_helper_for_call`](../../crates/drift-engine/src/security_patterns.rs:59) | any re-export or wrapper with the same imported name, from anywhere |
| **1 — name + raw specifier string** | Tier 0 + `fact.value == import_source` (exact string match against the specifier as typed) | [`accepted_phase4_auth_helper_for_call`](../../crates/drift-engine/src/security_patterns.rs:73) via [`helper_import_matches`](../../crates/drift-engine/src/security_patterns.rs:338); [`accepted_authorization_helper_for_call`](../../crates/drift-engine/src/security_patterns.rs:470) via [`imported_symbol_matches_with_source`](../../crates/drift-engine/src/security_patterns.rs:324) | relative-path vs alias-path spelling of the same file (`../../lib/auth` vs `@/lib/auth`), or a barrel re-export |
| **2 — resolved module identity** | walks `ImportResolvesToModule` graph edges to the real file | [`graph_direct_data_access_findings`](../../crates/drift-engine/src/check_command.rs:716) | nothing found — this is the one immune to laundering |

This is real and it's the highest-leverage finding in the review — `api_route_no_direct_data_access`
is the only convention immune to identity laundering (T93/T100, per the code's own comments at
`check_command.rs:750-770`), and every other security convention (auth-helper, authorization,
tenant-scope) sits at Tier 0 or Tier 1.

### 1.3 The fact/proof pipeline

```
source file
   │  tree-sitter parse
   ▼
facts.rs (lib)          ── generic FactKind facts: ImportUsed, SymbolCalled, RouteDeclared...
   │
   ▼
security_facts.rs (lib) ── security-flavored extraction: AcceptedAuthHelper, Phase4SecurityPolicy...
   │
   ├──► security_patterns.rs  (lib) ── "does this call match an accepted helper" — Tiers 0/1 above
   ├──► security_rules.rs     (lib) ── assembles SecurityAuthContract from patterns + facts
   ├──► security_phase6.rs    (lib) ── SSRF/CORS/CSRF/rate-limit/raw-SQL, same accepted_imports pattern
   ├──► security_control_flow.rs (lib) ── guard-dominance / branch-bypass (fact-based, not text-based)
   └──► security_proof.rs     (lib) ── builds the actual SecurityProofResult per contract kind
             │
             │  build_phase4_security_proof, build_secret_exposure_proof, etc. —
             │  MOST of these re-scan `source.lines()` with `.contains(...)` as their real
             │  detection step (security_proof.rs:1007-1035, 1563-1726) — comments, dead
             │  branches, and string literals read as executing code to all of them.
             │  EXCEPTION: presence_call_resolves_to_accepted-style checks, which are fact-based
             │  and don't have this problem — proof this pattern generalizes.
             ▼
check_command.rs (bin)  ── dispatches per ConventionKind, owns the ONE graph-resolved check,
                            is_presence_convention() (per-instance, not per-kind), repo_root re-reads
   │
   ▼
protocol.rs (bin) ── wire types: CheckConvention, GraphNode/Edge, the JSON the engine emits
   │
   ▼  JSON over the engine↔CLI boundary
packages/core/src/security.ts   ── Zod schemas, hand-typed z.enum(...) reason lists
packages/engine-contract/src/index.ts ── a SECOND, independently hand-typed copy of the same lists
   │
   ▼
packages/query, packages/cli, packages/mcp ── consume the parsed proofs
```

### 1.4 The one part of this that's already fixed — don't re-solve it

`vocabulary/vocabulary.json` is a single manifest that
[`vocabulary/generate.mjs`](../../vocabulary/generate.mjs) compiles into **both**
[`crates/drift-engine/src/vocabulary.rs`](../../crates/drift-engine/src/vocabulary.rs) (`@generated`,
line 1) and the TypeScript vocabulary package. As of W5 (commit `4788ddb1`), this manifest already
generates one `ConventionKind` enum with `dispatch()`, `proposable()`, `security_contract()`, and
`requires_engine_source()` as **exhaustive matches with no wildcard arm** — a new convention kind
that doesn't cover all four accessors fails to compile. This is the "one struct per kind, generated
once" fix already landed for convention-capability classification. `is_presence_convention()` in
`check_command.rs` looks similar but isn't a leftover duplicate — it reads a per-*instance* field
(`enforcement_semantics` on a specific `CheckConvention` value), not a per-*kind* static
classification, so it's answering a genuinely different question and correctly stays separate.
**Don't spend a phase re-unifying convention-capability lookups — that work is done.**

## 2. What's actually happening — findings, corrected against source

1. **Identity resolution is real and is the top-leverage item.** Confirmed at §1.2. The fix is
   real but not a one-line refactor per caller — see the plan below.
2. **`security_proof.rs`'s text-scanning is real.** Confirmed at §1.3. `security_control_flow.rs`
   already shows the fact-based alternative working; the proof-builders haven't adopted it.
3. **The `session_not_trusted` bug is real and currently live**, not historical:
   [`security_proof.rs:1428`](../../crates/drift-engine/src/security_proof.rs) still maps
   `source == "unknown_helper"` to the string `"session_not_trusted"`, and two independent
   hand-typed `z.enum([...])` copies of the same 9-value reason list exist at
   [`packages/core/src/security.ts:339`](../../packages/core/src/security.ts) and
   [`packages/engine-contract/src/index.ts:957`](../../packages/engine-contract/src/index.ts).
   The `vocabulary.json` pattern from §1.4 generalizes to this cleanly and is the right fix.
4. **"Six overlapping convention-capability lookups" is stale — already fixed, see §1.4.** The
   original review's evidence (a convention `proposable: true` with no proposer code) is a
   *cross-file* consistency gap between the generated `ConventionKind` and `candidate_command.rs`,
   not a symptom of un-unified lookups within `vocabulary.rs` itself.
5. **CLI command-surface fragmentation (`next_commands`, `--db` auto-resolve)** — plausible,
   `next_commands` genuinely touches ~25 files in `packages/cli/src`, but I didn't verify the
   `--db` positional-argument claim at the same depth as 1-3. Treat as directionally right,
   confidence lower.
6. **Diff-scope / rename handling** — not covered by the original review, but it's the same
   architectural genre as #1 (a resolution/identity problem) and is independently source-verified
   already: `diff.ts` conflates "is this file in scope" with "did this file change," so a rename
   is invisible to scope resolution. Three wire-surface gaps confirmed (`engine-check.ts` drops
   `renamedFiles`, Rust `diff.rs` has no rename handling, `diff_status:"renamed"` is a schema value
   nothing produces). Full detail already in the standing remediation blueprint memory.
7. **MCP staying hand-rolled JSON-RPC** — agreed, no changes needed. Small, read-only, already
   shares the same `@drift/query`/`@drift/storage`/`@drift/core` boundary as the CLI.

## 3. The plan

Ordered by (a) whether the bug is live today, (b) size of the actual change once the crate
boundary is accounted for, (c) whether it closes a whole class or one instance.

### Phase 1 — schema unification (`session_not_trusted` and friends)
**Size: small. Live bug: yes.**
Extend the `vocabulary.json` → `generate.mjs` pattern to every security-proof reason enum
(`SessionMissingTrustProof.reason`, `AuthorizationMissingProof.reason`, etc.). Delete the two
independent `z.enum([...])` literals in `packages/core/src/security.ts` and
`packages/engine-contract/src/index.ts`; generate both from one manifest entry. This makes the
`unknown_helper → session_not_trusted` mismatch a compile-time/generation-time impossibility
instead of a runtime Zod rejection. No crate-boundary obstacle — this is pure schema plumbing.

### Phase 2 — identity resolution, scoped correctly
**Size: medium-large. This is a crate-boundary change, not a shared-function refactor.**
Two viable shapes, pick one before starting:
- **(a) Generalize the precomputed-lookup pattern.** `check_command.rs` (which can see the graph)
  computes a resolved-identity table per convention — same shape as `forbidden_module_files` — and
  passes it down into `security_patterns.rs` functions as plain data. Lower risk, no crate
  restructuring, but means duplicating the "compute the table" step per convention that needs it
  (auth-helper, authorization, tenant-scope) rather than one shared service.
- **(b) Promote graph types into the lib crate.** Move `GraphNode`/`GraphEdge`/`GraphNodeKind`
  out of `protocol.rs` into a lib-visible module, so `security_patterns.rs` can genuinely host one
  `ResolvedCallTarget` service every `accepted_*_helper_for_call` calls into. Bigger change, but
  it's the one that actually eliminates the five-reimplementation problem instead of relocating it.
Recommend (a) first as an incremental unblock (closes the evasion class fast), with (b) as the
follow-up if a fourth or fifth tier-0/1 call site shows up and the duplication cost of (a) starts
to bite.

### Phase 3 — proof-builder fact-basis migration
**Size: large, riskiest — tree-sitter/fact-schema surgery.**
Extend `facts.rs` to emit the structural facts `security_control_flow.rs` already proves are
possible (reachability, comment/string-literal membership, branch identity) once, at the
tree-sitter layer. Migrate `security_proof.rs`'s `build_*` functions off `line.contains(...)` onto
those facts, one contract kind at a time — each migration is independently shippable and
independently testable against the existing fixture corpus. Do this after Phase 2, not before —
some proof builders will want the resolved-identity primitive Phase 2 produces.

### Phase 4 (parallel-track, doesn't block 1-3) — CLI command registry + diff/rename two-stage
Lower urgency, no live crash, but worth scoping in parallel since they don't touch the Rust engine:
- One `{name, requiresDb, ...}` descriptor per CLI command, with router/help/`next_commands`
  reading from it instead of ~25 independent builders.
- Split `diff.ts` into a scope-resolution pass (current tree state) and a diff-classification pass
  (within that resolved scope), so renames stop being invisible to scope membership. This has
  existing pinned tests marking the hole open — see the standing remediation blueprint memory for
  exact file/line references before starting.

## 4. What NOT to do
- Don't build a "convention capability descriptor" — it's already generated (§1.4).
- Don't scope Phase 2 as "make every `accepted_*_helper_for_call` call a shared function" without
  first deciding (a) vs (b) above — that framing assumes a crate boundary that doesn't exist yet.
- Don't touch MCP's transport.
