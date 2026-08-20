# CHARTER 06 — Parsing and fact extraction

**Depends on:** 05 · **Est. 4 h** · **Output:** `results/06-parsing-and-fact-extraction.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 06 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 06 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 06` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Determine what the parser actually sees, what it silently misses, and whether it admits to what it
missed. Every enforcement verdict downstream rests on facts produced here; a fact that was never
extracted becomes a convention that passes without checking anything.

## 2. Mechanism under test

`crates/drift-engine/src/facts.rs` (1,671 lines) extracts imports, exports, routes, route flavor.
`rules.rs` (803 lines) does data-access matching, an alias fixpoint, and value-use classification.

Two structurally different parsing approaches coexist **in the same file**:
- The primary `ImportUsed` fact comes from a **hand-rolled text/substring parser** operating on the
  raw statement string (§22 obs. 6).
- Value-use classification of an already-identified binding is **AST-driven**.
- The codebase's own comment on the AST-driven function states the text approach "cannot tell" two
  shapes apart — the tradeoff was known when at least one function was written this way.

Route extraction: `facts.rs` route declaration extraction, with a comment at `facts.rs:962-965`
documenting a prior real incident about list-form export routes.

`parser_gaps` (SQLite, migration 015, v2 metadata 027) is the honesty surface: what the parser
records about what it could not cover.

## 3. Procedure

Drive every probe through the **committed fixtures** (`test/fixtures/`, 92 dirs) plus purpose-built
shapes. For each, the oracle is known by construction; record extracted facts via
`drift repo map --json` and direct engine invocation.

### Import shapes

| Probe | Shape |
|---|---|
| P-06-01 | `import { a } from "m"` — baseline |
| P-06-02 | `import { a as b } from "m"` — renamed binding |
| P-06-03 | `import d from "m"` — default (`test/fixtures/default-exports`, `default-export-data-layer`, `default-export-service`) |
| P-06-04 | `import * as ns from "m"` — namespace |
| P-06-05 | `import "m"` — side-effect only (`test/fixtures/side-effect-imports`, `side-effect-import-finding`) |
| P-06-06 | `import type { T } from "m"` — type-only (`test/fixtures/type-only-imports`). Must not be treated as a value import. |
| P-06-07 | Multi-line import clause, trailing commas, comments inside the clause, `/* */` between specifier and `from` |
| P-06-08 | Very long import clause — **the truncation mechanism is byte-for-byte confirmed in §6**; find the exact length at which it truncates and what the resulting fact looks like |
| P-06-09 | `require()`, `await import()`, dynamic template-literal import (`test/fixtures/commonjs-dynamic-imports`) |
| P-06-10 | A string in a comment or a string literal that looks exactly like an import statement — false positive probe for the text parser |
| P-06-11 | The same import shape written to exercise both the text parser and the AST classifier; determine where they disagree |

### Export and route shapes

| Probe | Shape |
|---|---|
| P-06-12 | `export const GET = ...`, `export async function GET`, `export { GET }`, `export default` |
| P-06-13 | List-form export routes (`export { GET, POST }`) — the shape `facts.rs:962-965` documents a prior incident about |
| P-06-14 | Re-exports: `export * from`, `export { x } from`, external star re-exports (`test/fixtures/external-star-reexports`, `local-export-lists`) |
| P-06-15 | A route handler assigned indirectly (`const GET = handler; export { GET }`) |
| P-06-16 | A route file whose handler is produced by a wrapper (`export const GET = withAuth(handler)`) |

### Honesty

| Probe | What to do |
|---|---|
| P-06-17 | For every shape above that was **not** extracted, confirm a `parser_gaps` row exists naming that file and reason. A miss with no gap row is the finding. |
| P-06-18 | Run the repo's own `parser_honesty.rs` test and reconcile its claims against P-06-17's observations. |
| P-06-19 | Syntactically invalid TypeScript. Does the scan refuse, skip with a gap row, or silently index nothing? |
| P-06-20 | `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.d.ts` — which extensions are indexed at all? |
| P-06-21 | Non-Next.js framework file (Express route) — is it indexed for imports/exports even though it gets no route role? **§21 records this as CANNOT DETERMINE from source.** This charter closes it. |
| P-06-22 | Measure `parser_gaps` volume across all seven `$DRIFT_EVAL_REPOS` repos. A gap count is a coverage statement; report gaps per 1,000 files per repo. |

## 4. Benchmarks

| Metric | n |
|---|---|
| Parse throughput: files/s and KB/s, by file size bucket | 5 |
| Facts extracted per file, distribution | 1 per corpus repo |
| `parser_gaps` rate per corpus repo | 1 each, 7 repos |
| Time in parse vs. time in graph build (`graph_for_file`) | 3 |

## 5. Oracles

- Every fixture's known-true facts are extracted.
- Every fact that is **not** extracted from an indexed file produces a `parser_gaps` row.
- No fact is extracted from a comment or a string literal.
- Type-only imports never appear as value imports.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-06-1 | The primary `ImportUsed` fact comes from a hand-rolled substring parser, not the AST, and truncates long import clauses byte-for-byte at a determinable point. | §6, §22 obs. 6 | P-06-08 |
| S-06-2 | The codebase's own comment concedes the text approach cannot distinguish two shapes that the AST-driven function can. Find those two shapes and demonstrate the divergence live. | §6, §22 obs. 6 | P-06-11 |
| S-06-3 | Express/Fastify files may be fully indexed for imports/exports despite never receiving a route role — or may not be indexed at all. Undetermined in source. | §21 | P-06-21 |
| S-06-4 | `parser_honesty.rs` exists and asserts something about gap reporting; its actual assertions were never read against observed behavior. | §20a | P-06-18 |
| S-06-5 | Import specifier storage keeps the **raw, unresolved specifier text**, which is what Tier 1 identity comparison later compares by exact string (charter 07). | §6, §7 | Inspect stored facts directly; confirm the raw text is what persists. |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). A parser miss is a finding, not a blocker — the point of
the charter is to enumerate them.

## 8. Deliverables

`results/06-parsing-and-fact-extraction.md` with a shape × extracted/missed/gap-reported matrix;
fixtures for any new shape built here committed under `results/artifacts/06/fixtures/`.
