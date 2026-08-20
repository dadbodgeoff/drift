# Binding-alias laundering (D-2) — TDD execution playbook

**Workstream id:** R8 (new; the seven in `remaining-workstreams-diagnosis.md` are R1–R7).
**Diagnosis of record:** `docs/beta-benchmark-report-2026-08-19.md` §D-2, plus §4 rows `E04`/`E05`.
**Written against:** `main @ a0517f3e`.

**For the agent executing this.** Part 0 is source-verified and, where marked **[MEASURED]**, was
reproduced by running the release engine against a purpose-built fixture. Do not re-audit it. Do
not re-read the engine to reconfirm a Part 0 claim — that is the largest available way to waste
context. Read Part 0 once, then execute steps in order. Each step carries its own local context.

---

# PART 0 — STANDING CONTEXT

## 0.1 What is wrong, in one paragraph

Drift catches a data-layer import laundered through a **re-export statement** and misses the same
import laundered through a **local binding**. The difference is entirely syntactic: `export { db }
from "./db"` carries a `source` field on its AST node and therefore produces a `re_export_used`
fact, a `MODULE_REEXPORTS_MODULE` edge, and a chain the checker walks; `export const client = db`
carries no `source`, produces only an `exported_symbol` fact, and the chain walk terminates at the
laundering module. The route imports `client`, the walk finds nothing forbidden, and `drift check`
exits `0` with `complete: true` — a silent false pass on the product's only shipped convention.

## 0.2 The confirmed failures — three shapes, not two

**[MEASURED]** Fixture: four routes, four laundering modules, one data layer, scanned with
`target/release/drift-engine scan-repo --format jsonl`. Facts emitted per module, verbatim:

| module | source | facts emitted | `MODULE_REEXPORTS_MODULE`? | verdict |
|---|---|---|---|---|
| `lib/barrel.ts` | `export { db } from "./db";` | `import_used(db, ./db)`, **`re_export_used(db, ./db)`** | **yes** → `lib/db.ts` | caught |
| `lib/alias.ts` | `import { db } from "./db"; export const client = db;` | `import_used(db, ./db, imported=db)`, `exported_symbol(client)` | **no** | **evades — E04** |
| `lib/detached.ts` | `import { db } from "./db"; export { db };` | `import_used(db, ./db, imported=db)`, `exported_symbol(db)` | **no** | **evades — E04b, unnamed in any prior audit** |
| `lib/factory.ts` | `import { db } from "./db"; export function getClient() { return db; }` | `import_used(db, ./db, imported=db)`, `exported_symbol(getClient)` | **no** | **evades — E05** |

Whole-scan edge census on that fixture: `MODULE_REEXPORTS_MODULE: 1`. One edge, for the one barrel.

**E04b is new.** `export { db };` with no `from` clause is handled by `extract_local_export_list`
(`facts.rs:1251`), which returns early when the node *has* a `source` field and emits a plain
`exported_symbol` otherwise. It is a one-token edit away from `E04` for anyone writing the evasion,
it is not in `scripts/evasion-matrix.mjs`, and it is not in the benchmark report. Treat it as a
first-class member of this workstream, not a bonus.

## 0.3 Architecture you must know and must not re-derive

### The chain that catches a barrel, end to end

Five hops. Every one is load-bearing; the fix inserts into exactly two of them.

1. **Emit.** `extract_export` (`facts.rs:1001`) tests `node.child_by_field_name("source")`. Present
   ⇒ it walks `reexport_value_identifiers` and pushes both an `ImportUsed` and a **`ReExportUsed`**
   fact (`facts.rs:1013-1089`). Absent ⇒ control falls through to the local-export branches, which
   emit `ExportedSymbol` only.
2. **Project.** `main.rs:1593` (`"re_export_used"`) builds a `ReExport` node and, when the specifier
   resolves inside the snapshot, a **`ModuleReexportsModule`** edge from the declaring module to the
   resolved module (`main.rs:1618-1632`).
3. **Walk (TypeScript).** `moduleReexportTargets` (`run-check.ts:4480`) indexes edges where
   `kind === "MODULE_REEXPORTS_MODULE"`; `reachesForbiddenViaReexport` (`run-check.ts:4492`)
   BFS-walks that index. `graphImportResolvesToForbidden` (`run-check.ts:3927`) calls it.
   **[CORRECTED]** This document originally claimed that answer gates whether the route's import
   fact is forwarded to the engine, citing the `continue` at `run-check.ts:3174`. **That is false.**
   `allowedGraphImportFacts.set(...)` runs at `:3172`, *before* the guard, and the `continue` is the
   last statement in the loop body — it is dead code. `graphForbidden` today affects only
   waived-finding accounting. Measured: reverting the TypeScript widening alone still produced the
   full corrected finding set. The TS widening is still required and still correct; it is simply not
   what makes the fix work.
3b. **The edge whitelist — the actually load-bearing site.** `edgeKindsForCheck`
   (`run-check.ts:3749`) is the set of edge kinds `graphForEngineCheck` keeps when building the
   graph the engine receives. An edge kind absent from this list *does not exist* as far as the Rust
   walker is concerned. **Measured:** with both walkers widened and this list unchanged, every
   binding-laundered route still passed. The `T100` comment immediately above it records the same
   lesson being learned once already, for barrels.
4. **Walk (Rust).** `forbidden_graph_import_target` (`check_command.rs:4167`) runs its *own* BFS,
   filtering `edge.kind == GraphEdgeKind::ModuleReexportsModule` (`check_command.rs:4190-4192`),
   and returns the `reexport_chain` that lands in the finding's evidence.
5. **Materialize.** The finding is attributed to the route, naming the specifier the route actually
   wrote (`./wrapper`), not the data layer. This is already correct for barrels and needs no change.

### THERE ARE TWO CHAIN WALKERS AND THEY MUST BE CHANGED TOGETHER

Hop 3 (TypeScript) and hop 4 (Rust) are independent implementations of the same BFS. Changing only
the Rust one produces **no behaviour change at all**, because the TypeScript one filters the import
fact out before the engine sees it. Changing only the TypeScript one produces a forwarded fact the
engine then declines to flag. This codebase has already paid for exactly this class of bug twice —
see the comment at `check_command.rs:4215-4227` on the two divergent copies of
`is_forbidden_import`, and the one at `run-check.ts:3980-3985` on why `resolvedModuleFilesFor`
exists as a single walk. **R8-09 is the gate that pins the two walkers in agreement. Do not skip it.**

### The import-binding table already exists — as facts

You do not need to build one. The `import_used` fact already carries everything the join needs:

```
import_used   name = local binding   value = specifier   imported_name = source symbol
```

**[MEASURED]** `lib/alias.ts` emits `import_used(name=db, value=./db, imported_name=db)` and
`exported_symbol(name=client)`. The missing link is a single intra-file join —
`exported_symbol` ↔ `import_used` on the local binding name — and both sides are already in the
`facts` vector when the post-pass runs.

### The post-pass slot

`apply_runtime_use_analysis` (`facts.rs:338`) is the precedent: a whole-file pass that runs after
the per-node walkers have filled `facts`, takes `(root, source, &mut facts)`, and both mutates and
filters. The new pass takes the same shape, runs immediately after it, and appends. Reuse
`node_text`, `first_named_declaration_identifier` (`facts.rs:1653`) and
`first_variable_declaration_identifier` (`facts.rs:1677`) as the reference for how export
declarations are navigated in this grammar — do not invent node-kind names from memory.

### `MODULE_IMPORTS_MODULE` is the obvious wrong fix

**[MEASURED]** The fixture emits `MODULE_IMPORTS_MODULE: 8` — every laundering module already has an
edge to `lib/db.ts`. Walking *that* edge would close all three shapes in one line and would also
flag every legitimate service module in every repo, because "a service imports the data layer" is
precisely what the convention exists to permit. The relation being added is narrower by
construction: *this module's **exported surface** is that module's binding*. Anyone who proposes
widening the walk to `MODULE_IMPORTS_MODULE` has proposed deleting the convention.

### Broadening a ban is safe; broadening an acceptance is not

`run-check.ts:4033` (the `SpecifierMatch` doc comment) states the rule this workstream must respect:
a prohibition may be widened safely, an acceptance may not. The new edge widens a **ban** only.
It must not be consumed by `reexportEdgesByFrom` / the accepted-security-helper closure, which
walks re-export edges to decide whether an auth helper is the accepted one. Feeding alias edges
into that closure would let a module launder its way *into* an acceptance — the exact failure the
security sprint exists to stop. **R8-08 pins this as a negative test.**

### The vocabulary generator — what you get for free

`vocabulary/vocabulary.json` is the single source. Adding a member to `vocabularies.fact_kind.members`
or `vocabularies.graph_edge_kind.members` and running the generator produces the TypeScript const
and Zod schema. What is **not** free: the Rust `enum` member, the `ALL` array (manifest order), and
the `as_str`/`from_str` arms in `vocabulary.rs`. `pnpm check:vocabulary` fails on a member with zero
producer sites — which is the standing bug `csrf_guard_called` and `rate_limit_guard_called` embody,
and is why no fact kind may be added in this workstream before its emitter exists.

### Storage DOES need a migration — the columns do not, the migration COUNT does

**[CORRECTED — this section originally claimed no migration was needed. It was wrong.]**
`facts.kind` and `graph_edges.kind` are `TEXT`, so no column changes. But `factFromRow` parses every
row through `FactRecordSchema`, whose `kind` is a **closed Zod enum**. A database written by a build
that knows a newer fact kind is therefore *unreadable* by a build that does not — a throw on every
`listFacts`, not a degraded read. The only thing preventing that is `assertSupportedLocalDatabase`,
which refuses a database carrying more migrations than the build knows. So a fact-kind addition must
ship with a migration, **even a no-op one**, purely so the count moves in lockstep.

`packages/cli/test/frozen-contracts.test.ts` ("pins the fact vocabulary to the migration count") is
the only thing tying these together, and it is the gate that caught this. Precedents to copy:
`034_declaration_fact_kinds`, `035_secret_source_read_fact_kind`, `036_sink_candidate_fact_kind` —
all three are schema-less migrations existing for exactly this reason.

## 0.4 Design decisions already made — do not relitigate

**D1 — Two new fact kinds, not reuse of `re_export_used`.**
`re_export_used.value` means *the specifier written on this statement*. `export const client = db`
has no specifier on its line, and the fact's evidence span would point at source text containing no
`from`. Adapter certification requires an evidence-span test; `EW-4` and the `D2` comment at
`facts.rs:1110` show this codebase treats fact truthfulness as load-bearing rather than cosmetic.
Reuse would be cheaper by exactly one day and would make every downstream consumer's evidence a lie.

- `export_aliases_import` — the exported name **is** the imported binding (E04, E04b).
- `export_wraps_import` — an exported function's every return **is** the imported binding (E05).

**D2 — Two kinds, not one.** The two carry different evidence strength. Aliasing is an identity
claim decidable from one declarator. Wrapping is a claim about a function's returns, with a real
conservatism boundary (multiple returns, conditional returns, nested functions). Conflating them
means the weaker claim inherits the stronger one's blocking status, and neither can be gated off
alone if the corpus sweep in R8-12 turns up a false positive.

**D3 — One new edge kind, `ModuleAliasesModule` / `MODULE_ALIASES_MODULE`; no new node kind.**
Both fact kinds project onto this one edge, because the graph question — "does this module's
exported surface depend on that module" — is genuinely the same for both, and the two chain walkers
should each grow by one enum arm, not two. The fact kind is what preserves the distinction.
No new node kind: the edge runs module→module over ids that already exist, and carries its evidence
directly.

**D4 — The relation is emitted only on positive syntactic proof.** Full rules in R8-04/R8-06.
Governing principle, from the benchmark report's own framing: a silent miss is the worst failure
class, but one false block disables the tool. Every rejected shape becomes a pinned
`known_evasion: true` row (R8-11), never an unrecorded gap.

## 0.5 Traps

1. **Changing one walker.** See 0.3. A one-sided change measures as "no effect" and reads as "the
   fix does not work."
2. **`let` rebinding.** `import { db } from "./db"; export let client = db; client = safeWrapper;`
   The alias claim is false after line 3. Skip any binding reassigned anywhere in the file.
3. **Shadowing.** `export function getClient() { const db = local(); return db; }` — the returned
   `db` is not the import. The return-expression check must resolve against the *enclosing scope
   chain*, or, for beta, must bail out whenever the function body declares any binding of the same
   name. Bail out; it is one line and it cannot be wrong in the dangerous direction.
4. **Nested functions.** Collect only `return` statements whose nearest enclosing function is the
   exported one. A naive subtree walk attributes an inner callback's return to the outer function.
5. **Type-only exports.** `export type { Db };` is erased. `extract_local_export_list` already
   handles this by statement-text prefix (`facts.rs:1267-1274`) and the per-specifier `type ` form
   (`facts.rs:1289`). Mirror both, or reuse the function.
6. **The `(side-effect)` sentinel.** `SIDE_EFFECT_IMPORT_BINDING` (`facts.rs:53`) is deliberately not
   a legal identifier. Exclude it from the binding table explicitly rather than relying on the fact
   that nothing can match it — `facts.rs:351-353` explains why that default is not a decision.
7. **Namespace imports.** `import * as ns from "./db"; export const client = ns.db;` is a member
   expression, out of scope (R8-13), and must not fall through into the alias rule by accident.
8. **Determinism.** `pnpm eval:determinism` and the bit-identical-run property are shipped claims.
   Emit inside the existing ordered traversal and key intermediate maps on `BTreeMap`/`BTreeSet`, as
   the surrounding code already does.
9. **Handshake compatibility.** `scan_started` declares `fact_kinds` and an incompatible pairing is
   refused before ingestion. A new engine against an older CLI will refuse the scan. That is the
   designed behaviour, but it means engine and CLI must ship together — note it in the changelog.

## 0.6 Execution rules

- Test first. Every step below names its failing test before its edit.
- One step, one commit. The message says what changed and what it was measured against.
- Do not proceed past a sprint gate that is red.
- `pnpm verify:ci` is the floor. `pnpm verify:evals` is the ceiling, and R8-12 is the only step that
  requires the full corpus.

---

# PART 1 — SPRINT 1: the alias relation (E04, E04b)

Ships the identity half. At the end of this sprint two of the three shapes are caught.

## R8-01 — pin the current behaviour before changing it

Add `crates/drift-engine/tests/binding_alias_laundering.rs`. Four cases, built from the Part 0.2
fixture: barrel (control), alias, detached, factory. Assert what is true **today** — one
`MODULE_REEXPORTS_MODULE` edge, from the barrel only.

This test is green on arrival. It exists so that the change in R8-05 is visible as a diff in a
committed expectation rather than as a claim, and so a future regression is attributable.

## R8-02 — vocabulary: `export_aliases_import`

Failing test first: `scripts/vocabulary-parity.test.mjs` must fail on a manifest member with no Rust
counterpart. Then:

- `vocabulary/vocabulary.json` → `vocabularies.fact_kind.members`, in manifest order after
  `re_export_used`.
- Regenerate with `pnpm vocabulary:generate`. `crates/drift-engine/src/vocabulary.rs` is ALSO
  generated (`vocabulary/generate.mjs:24`, `RUST_OUTPUT_PATH`) - the enum, `ALL`, `as_wire` and
  `from_wire` all come from the manifest. Hand-edit neither it nor `packages/vocabulary/src`.
- Two count pins in `main.rs` (`every_vocabulary_member_is_declared`, ~line 1094) assert
  `FactKind::ALL.len()` and `GraphEdgeKind::ALL.len()`. They are a deliberate manifest pin and must
  be updated in this step; no later step touches them.
- The Rust twin of the vocabulary gate is `tests/fact_kind_emission.rs` (`NEVER_EMITTED`). It fails
  here for the same reason `check:vocabulary` does, and closes at R8-05/R8-07 - not by allowlisting.

`pnpm check:vocabulary` will now fail with `no_producer` — expected, and closed by R8-05. Do not
land R8-02 alone on `main`; it and R8-05 are one commit or one stacked pair.

## R8-03 — vocabulary: `MODULE_ALIASES_MODULE`

Same shape, `vocabularies.graph_edge_kind.members` and `GraphEdgeKind::ModuleAliasesModule`, placed
immediately after `ModuleReexportsModule` so the manifest reads in dependency order.

## R8-04 — the alias rule, as unit tests over the AST

New pass `apply_export_alias_analysis(root, source, facts)` in `facts.rs`, called from the same site
as `apply_runtime_use_analysis`. Write these tests first; they are the specification.

**Binding table.** Built from the `ImportUsed` facts already in `facts` for this file:
`local_name -> (specifier, imported_name)`. Exclude `SIDE_EFFECT_IMPORT_BINDING`. Exclude any
binding whose `runtime_use` marks it type-erased — a type-only import cannot launder a value.

**Emit `export_aliases_import` when all hold:**

- the export statement has **no** `source` field, and
- either
  - **(a) declarator form** — a `lexical_declaration`/`variable_declaration` with exactly one
    `variable_declarator` whose `name` is a plain identifier and whose `value` is a **bare
    identifier** present in the binding table; or
  - **(b) detached-clause form** — an `export_clause` specifier (`facts.rs:1281`) whose `name` is
    present in the binding table; or
  - **(c) default form** — `export default <bare identifier>` where the identifier is in the table;
- the binding is **never reassigned** anywhere in the file (any `assignment_expression` whose left
  side is that identifier disqualifies it), and
- the specifier is not type-only.

**Fact shape.** One fact per exported name:

```
kind          = export_aliases_import
file_path     = this file
name          = the EXPORTED name        (client / db / default)
value         = the import SPECIFIER     (./db)
imported_name = the SOURCE symbol in the target module
span          = the EXPORT statement     (the laundering line, which is the evidence)
```

`name` is the exported name and `imported_name` is the source symbol, mirroring `EW-4`'s reasoning
at `facts.rs:1427-1436`: recording only the alias makes a renamed export unresolvable in its target.
`export { db as client }` must record `name=client, imported_name=db`.

**Negative unit tests, each asserting zero facts:** `let` reassigned; shadowed local; member
expression (`export const q = db.user`); object literal (`export const api = { db }`);
`export type { Db }`; `export { type Db }`; a plain local (`export const x = 1`); a binding from a
type-only import.

## R8-05 — emit it, and close the vocabulary gate

Land the pass. `pnpm check:vocabulary` goes green (producer site exists). R8-01's expectations are
updated in the same commit: alias and detached modules now carry the new fact.

Still **no behaviour change** — nothing consumes the fact yet. `pnpm eval:evasion` must be
unchanged. If it moves here, something is consuming a fact it should not.

## R8-06 — sprint gate

`cargo test -p drift-engine`, `pnpm check:vocabulary`, `pnpm check:engine-schema-parity`,
`pnpm eval:determinism`. Evasion baseline byte-identical.

---

# PART 2 — SPRINT 2: the wrap relation (E05)

## R8-07 — the wrap rule, as unit tests

**Emit `export_wraps_import` when all hold:**

- an exported `function_declaration`, or an exported `const` bound to an `arrow_function` /
  `function_expression`; and
- the function is **not** `async` and **not** a generator (an `async` function returns a Promise, not
  the binding — the caller cannot use it as the client without awaiting, and claiming otherwise is a
  claim about types this engine does not make); and
- it takes the same-name-shadowing bail-out from trap 3 — the body declares no binding named the
  same as the candidate; and
- **every** `return` statement whose nearest enclosing function is this one returns a **bare
  identifier**, that identifier is the same one in every return, and it is in the binding table; and
- there is **at least one** return (a concise arrow body counts as the single return); and
- the binding is never reassigned in the file.

Fact shape is identical to R8-04's, with `name` = the exported function's name.

**Negative unit tests:** `async function`; generator; two returns of different identifiers; a
conditional return where one branch returns something else; a return of a call
(`return getDb()`); a return of a member (`return db.client`); a return from a nested callback only;
a function with no return; a shadowed local.

Every one of these is a **deliberate miss**, and each becomes a pinned row in R8-11. Say so in the
doc comment above the pass, in this codebase's house style: name the condition, name the reason.

## R8-08 — the acceptance-side negative test

Before either fact reaches a walker, pin the boundary from 0.3. Test: a module that aliases an
accepted auth helper's binding and re-exports it under a new name must **not** widen the accepted
set. Assert `reexportEdgesByFrom` / the helper closure is unchanged by the presence of
`MODULE_ALIASES_MODULE` edges.

This test must be written before R8-09, so that the widening in R8-09 is fenced on arrival rather
than fenced after someone notices.

## R8-09 — sprint gate

Unit tests green. Evasion baseline still byte-identical — still nothing consumes the facts.

---

# PART 3 — SPRINT 3: projection and the two walkers

This is the sprint where behaviour changes. Everything before it was inert.

## R8-10 — project both fact kinds onto `MODULE_ALIASES_MODULE`

In `main.rs`, alongside the `"re_export_used"` arm (`main.rs:1593`), add an arm for
`"export_aliases_import" | "export_wraps_import"`. Resolve `fact.value` through `resolve_import`
exactly as the re-export arm does — **the same resolver, not a second one**. On resolution, insert:

```
ModuleAliasesModule : module_id(fact.file_path) -> module_id(resolved)
metadata: { source, exported_name, alias_kind: "alias" | "wrap",
            resolved_file_path, resolved_module_id }
```

`alias_kind` is where the D2 distinction survives into the graph without a second edge kind.

Unresolvable specifiers produce no edge, by the same design as re-exports — an external package is
outside the snapshot and absence is not proof (`resolve_import` filters to snapshot paths).

Extend R8-01's expectations: the fixture now shows `MODULE_REEXPORTS_MODULE: 1` and
`MODULE_ALIASES_MODULE: 3`.

## R8-11 — both walkers, in one commit

**TypeScript** (`run-check.ts:4480`): `moduleReexportTargets` currently keys on one edge kind.
Rename to `moduleDependencyTargets` and accept `MODULE_REEXPORTS_MODULE` **or**
`MODULE_ALIASES_MODULE`. Leave `moduleReexportEdges` (`reexportEdgesByFrom`) **untouched** — that is
the acceptance-side index fenced by R8-08, and its name stays accurate.

**Rust** (`check_command.rs:4190`): widen the filter to
`matches!(edge.kind, GraphEdgeKind::ModuleReexportsModule | GraphEdgeKind::ModuleAliasesModule)`.
The returned chain is unchanged in shape; it now may contain alias hops.

**The agreement gate.** Add `scripts/chain-walker-parity.test.mjs` to `test:harness`. It builds a
fixture set covering all four Part 0.2 shapes plus the R8-04/R8-07 negatives, runs the engine once,
and asserts the two walkers return the **same** reachability verdict for every (import, forbidden
set) pair. This is the highest-value item in the workstream: it is the only thing standing between
this change and a third divergent copy of the same BFS.

## R8-12 — sprint gate: the shapes flip

`E04`, `E04b` and `E05` are now caught. Add all three to `scripts/evasion-matrix.mjs` as
`class: "catch"` cells in the existing shape-list format (`evasion-matrix.mjs:205-228` is the
template — `files: (d) => ({...})` returning a laundering module and a route). Run
`pnpm eval:evasion:update` and read the diff: the only movement permitted is those three shapes,
across the seven repos. Any other cell moving is a regression, not a bonus.

---

# PART 4 — SPRINT 4: honesty, measurement, rollout

## R8-13 — pin every deliberate miss

**[RECONCILED against what execution actually pinned.]** The table below originally listed six
shapes and said nothing about where any of them lived. Two of its rows were wrong, two shapes were
missing, and the distinction that decides which column a shape belongs in was never stated. All
four are corrected here.

**The classifying question is what the ROUTE receives at runtime**, not whether the engine emits a
fact:

- the route **does** receive the data layer and Drift does not flag it → a **recall gap**. It is
  real laundering, it is a `known_evasion: true` catch cell, and it is recorded, never hidden.
- the route **provably does not** receive the data layer → a **negative control**. A finding here
  is a false positive, so it is a `silent` cell and a fire is a FAIL.

The plan conflated these under "deliberate miss". They are opposite failure modes and the fixture
already treated them as such; only the doc did not.

### Where a shape can be pinned

| tier | file | what it proves |
|---|---|---|
| **fact** | `crates/drift-engine/src/facts.rs`, `mod export_alias_analysis_tests` | no `export_aliases_import` / `export_wraps_import` is emitted for the source |
| **e2e** | `test/fixtures/bypass-binding-alias` + `packages/cli/test/binding-alias-laundering.test.ts` | a real `drift check` over a real contract does or does not flag the route |
| **parity** | `scripts/chain-walker-parity.test.mjs` (same fixture) | the two chain walkers agree about the shape |
| **corpus** | `scripts/evasion-matrix.mjs` + `scripts/evasion-baseline.json` | the shape's verdict on all seven eval repos, per repo |

### Still open — real laundering, deliberately not caught

| shape | pinned | why it stays open |
|---|---|---|
| `export const q = db.user` | fact, e2e (`member`), corpus (`S22`) | member expression; the fact model has no member path, and a claim about which member would be invented |
| `import * as ns; export const client = ns.db` | fact, corpus (`S23`) | namespace member; same gap as row 1, with a whole module as the table entry. **Prose-only in the e2e fixture** |
| `export const api = { db }` | fact, corpus (`S24`) | property laundering; needs an object-shape relation. **Prose-only in the e2e fixture** |
| `export async function getClient() { return db }` | fact, e2e (`asyncfn`), corpus (`S25`) | returns a Promise; the route does receive the client after awaiting, but saying so is a claim about types this engine does not make |
| `if (f) return db; return other` | fact, e2e (`conditional`), corpus (`S26`) | conditional return; "sometimes the data layer" needs the control-flow tier (R4) |
| `export const a = db, b = db` | fact, corpus (`S27`) | multi-declarator; the alias rule takes exactly one declarator so a partially-matching statement cannot emit a half-true fact. **Prose-only in the e2e fixture** |
| `export let c = other; c = db` | corpus (`S28`) | reassignment *toward* the import; the rule disqualifies any reassigned binding, which gives this away for free. Closing it needs flow-sensitive binding state. **Not pinned at the fact tier** |
| `export const { db } = deps` | fact | destructuring pattern; a shape the pass cannot describe. **Prose-only elsewhere** |
| `export function* g() { return db }` | fact | generator; the caller receives an iterator, not the binding |
| `export class C { static x = db }` | — | class static field. **PROSE ONLY — pinned nowhere.** Found in review, after the fact tests were written |

### Negative controls — NOT laundering; a finding here is a false positive

These are the rows a fix loose enough to close the table above would break first.

| shape | pinned | why a finding would be wrong |
|---|---|---|
| `export let c = db; c = other` | fact, e2e (`reassigned`), corpus (`S19`) | the importer receives the replacement; the alias claim is false by the time the module finishes evaluating |
| `function g() { const db = local(); return db }` | fact, e2e (`shadowed`), corpus (`S20`) | same spelling, different binding |
| `function g() { xs.forEach(() => { return db }) }` | fact, e2e (`nested`), corpus (`S21`) | the return belongs to the callback; the exported function returns `undefined` |
| `import { db } from "drizzle-orm"; export const c = db` | e2e (`external`) | the specifier resolves nowhere in the snapshot, and absence is not evidence about what a package contains |
| `export type { Db }` / `export { type Db }` | fact | type-erased; nothing exists at runtime to launder |

### Two corrections to the original table

1. **`let` was one row and is two.** `export let client = db` that is never reassigned **is
   caught** — measured against the release binary. Reassignment *away* from the import is a
   negative control (`S19`), reassignment *toward* it is the evasion (`S28`). The single row
   "re-assignment through `let` — needs flow-sensitive binding state" described neither
   accurately and would have read as a known miss on a shape the product actually blocks.
2. **The multi-declarator shape was missing entirely** and is real laundering.

This is the report's recommendation 6 generalised: a shape nobody pinned is folklore. Member
expression and namespace member are the strongest remaining laundering paths and are the natural
R9; async and conditional return belong to the R4 control-flow spike, not here. The class static
field is pinned nowhere and is the one row of this table that is still folklore.

## R8-14 — precision sweep on the real corpus

The only step that needs the seven pinned repos. Run `pnpm eval:external` and `pnpm eval:breadth`
before and after, and diff the finding sets **per repo, per file**.

**[CORRECTED — the original prediction here was wrong, and usefully so.]** This document predicted
zero new findings, on the reasoning that no corpus repo launders its data layer this way. **openstatus
does.** Measured, three real sites:

| site | shape | what it republishes |
|---|---|---|
| `packages/services/src/chat-session/schemas.ts:35` | `export { CHAT_TITLE_MAX_LENGTH };` | E04b — a binding imported from `@openstatus/db` |
| `packages/services/src/monitor/schemas.ts:15` | `export { monitorJobTypes, monitorMethods, monitorPeriodicity };` | E04b — imported from `@openstatus/db/src/schema/constants` |
| `packages/services/src/limits.ts:15` | `export const getPlanLimits = getLimits;` | E04 — its own comment reads "Re-exported plan-defaults lookup" |

Net effect on the corpus: openstatus moves 17 → 19 findings. **Zero newly-flagged FILES** — both
routes were already flagged by other findings — plus one fingerprint churn (see below). The other
six repos are unchanged.

Adjudication: these are the existing module-level rule applied through one more hop, not a new
false-positive class. The convention forbids importing the *module*, and a route importing these
symbols directly from `@openstatus/db` is flagged today. Whether a constant living in the data
package should count is a question about the convention's granularity, and it predates this change.

**Fingerprint churn is a rollout consequence.** The finding fingerprint embeds the terminal forbidden
module, the widened walk is LIFO, and it can now reach a different terminal module first. openstatus
shows one: a finding on `onboarding/checks/route.ts` kept its meaning but moved `forbidden_path` from
`schema/index.ts` to `schema/plan/utils.ts`, so it reads as one dropped plus one new fingerprint.
On a real user repo that means **previously-baselined violations can resurface as new**. This must be
in the changelog and in the upgrade notes; it is not optional.

Any new finding must be hand-adjudicated before this lands. A true positive is a result worth
reporting; a false positive means the R8-04/R8-07 conditions are too loose and the offending clause
is removed and re-pinned as `known_evasion`, not softened.

Add a latency delta to the bench row: the new pass is one extra whole-file traversal per file, and
`eval:bench` is the only place that would notice.

## R8-15 — ship gate

- `pnpm verify:ci` green, including `check:vocabulary`, `check:engine-schema-parity`,
  `check:surface-parity`, `check:cell-ledger`, `validate:claims`.
- `pnpm verify:evals` green, with the evasion baseline diff showing exactly three flipped shapes.
- `chain-walker-parity` in `test:harness`.
- `CHANGELOG.md`: the three shapes, the new fact and edge kinds, the engine/CLI pairing requirement
  from trap 9, and the R8-14 caveat stated plainly.

---

# PART 5 — RISK, ROLLBACK, AND WHAT THIS IS NOT

**Blast radius.** One new post-pass in `facts.rs`, one new arm in `main.rs`, one widened filter in
each walker, one edge kind added to `edgeKindsForCheck`, and one no-op storage migration. No storage migration, no new dependency, no new process, no change to the resolver, no
change to how findings are attributed or messaged. Evidence class stays `deterministic_ast`, so the
new relation is blocking-eligible under `adapter-certification.md` — unlike anything sourced from an
external type checker, which lands in `external_tool` and is capped at "depends on certification."

**Edge identity collapses duplicates.** `insert_edge` keys on `edge:{from}:{kind}:{to}`
(`main.rs:2032`), so a module that aliases the same target twice produces ONE edge and its
`exported_name`/`alias_kind` reflect the last fact in traversal order. Deterministic, and identical
to how the re-export arm already behaves. Reachability — all R8-11 needs — is unaffected, but it
means D2's "gate one kind off independently" story holds at the FACT layer and not at the graph
layer. The fact stream stays complete and unambiguous.

**Rollback.** The behaviour change is confined to R8-11 (and the `edgeKindsForCheck` entry). Reverting that one commit returns the
product to today's verdicts while leaving the facts and edges emitted but unread — which is a
useful state, not a broken one: the relation stays measurable in the graph while the walkers ignore
it.

**Sequencing.** Independent of S1–S6 and of R1–R7. It touches `facts.rs`, `main.rs`,
`check_command.rs` and `run-check.ts`; the security plan touches `security_*.rs` and different
regions of `run-check.ts`. Land R8-11's `run-check.ts` edit on a rebased branch to keep that hunk
small.

**What this is not.** This is not type inference, and it does not become easier with type
inference. Knowing that `client` has type `PrismaClient` answers nothing the checker asks; knowing
that `client` was bound from the `db` import answers all of it. The engine has no type environment,
no persistent language service, and no type-aware crate in `Cargo.toml` — and closing D-2 requires
none of the three. Any future proposal to add them should be argued on the shapes in R8-13 rows
1–5, and should account for `external_tool` evidence being ineligible to block by default.
