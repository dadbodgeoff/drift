# Beta-blocker sprint (BB series) — outcome

**Base:** `b5c3c230`. **Tip:** see `git log --oneline b5c3c230..HEAD`. **Branch:**
`fix/phase-a-correctness`, local only — nothing pushed, nothing published.

Seven items from `TDD-BETA-BLOCKERS.md`. Six implemented, one falsified. Per-item detail is in
`log.jsonl`; this is the discussion agenda.

## Outcome

| Item | Status | What changed |
|---|---|---|
| BB-2 | DONE | Engine reports its own `build_profile`; resolution + profile recorded per scan (migration 031) and on MCP's capability report; one deduped stderr warning; benches refuse to record through a debug or unverifiable engine |
| BB-3 | DONE | `--accept-defaults` names the mode, the baselined count, the consequence, and the upgrade command; `start --json` carries a shaped `acceptance` block |
| BB-1 | DONE | Empty diff scope refuses with exit 3 / `empty_diff_scope`; deletion-only **and pure-rename** diffs still pass; every check prints `Checked N files` |
| BB-7 | **PREMISE FALSE** | The index already existed since migration 002 and is used. No index added; guard test pins the three that exist |
| BB-5 | DONE | Conforming exemplars (migration 032) + migration sentence + rationale split, with the zero-open-findings invariant asserted on all 7 eval repos |
| BB-6 | DONE | `guidance` view ≤32 KB; dub packet 901,730 → 376,889 bytes; parity with MCP proved by moving shared logic into `@drift/core` |
| BB-4 | DONE | `contract_staleness` reports a forbidden module the repo no longer contains; `--strict-contract` turns it into exit 3 |

## Numbers worth keeping

- dub packet: **901,730 → 376,889 bytes (−58%)**; `guidance` **6,473 bytes** against a 32,768 ceiling,
  byte-asserted on 7/7 repos (3–5 KB actual, cal.com included).
- Exemplar integrity: **7/7 repos, 6/6 clean exemplars each**, asserted in the suite rather than a
  fixture.
- Engine provenance: release → silence and `"release"` recorded; debug → one warning and `"debug"`
  recorded; both measuring harnesses exit 1 rather than record a debug number.
- `eval:external` **7/7**, no change vs baseline apart from the two declared BASELINE_CHANGEs.

## Decisions taken inside the sprint

These were the TDD's to make and it left them open, so they were made and are flagged for review:

1. **`acceptance`, not `accepted`** (BB-3). The TDD asked for `accepted: {mode, severity, …}`, but
   `accepted` is already the accepted-convention record on a schema-locked beta surface. `mode`
   beside its own `enforcement_mode` would have been two spellings of one fact. The four facts are
   present and schema-locked under `acceptance`.
2. **The acceptance sentence names the convention *kind***, not the accepted id. Real ids are content
   hashes (`convention_c8a97e3d4e5490d8`) and say nothing to a reader; the id stays in the upgrade
   command, where the CLI needs it.
3. **BB-7's index was not added.** See below — this is the one item that reverses a TDD instruction.
4. **BB-6's parity was bought with a refactor.** MCP cannot depend on the CLI, so an identical
   guidance view on both surfaces meant moving the builder, exemplar selection, the exemplar context,
   the finding-openness predicate and **scope membership** into `@drift/core`. `filesForConvention`
   now delegates to `conventionScopeFiles`. This is a larger diff than BB-6 implied, and it is the
   part most worth a second pair of eyes — though a second scope implementation is precisely what F3
   was, so sharing it removes a standing hazard rather than adding one.

## BB-7: the premise does not hold

The item asked for an index on `facts.file_path`, citing "single-file fact query 448 ms cold (full
table scan), all-facts 55 ms". Measured against a real 106,626-row dub database:

| Query | Plan | Time |
|---|---|---|
| per-file, with `scan_id` (what the product would issue) | `SEARCH facts USING INDEX idx_facts_scan_file` | ~15 ms |
| all facts for a scan (what the product **does** issue) | `SEARCH … USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY` | ~267 ms |
| per-file, without `scan_id` (a shape nobody issues) | `SCAN facts` | ~9.6 ms |

`idx_facts_scan_file (scan_id, file_path)` has existed since migration `002`. The reported numbers are
**inverted** relative to reality — the per-file lookup is the fast query — so the measurement cannot
have been of these queries as the product issues them. The most likely explanation is the same
debug-engine session that produced the retracted latency numbers, which is BB-2's whole argument.

The index was reverted rather than kept: the planner never chose it, and a fourth index on the largest
table costs write throughput on every scan and disk in a database already flagged for GB-scale growth
(B-11/P-4 scan GC). A guard test pins the three fact indexes so the premise cannot return.

**Discovery left behind (DISCOVERY-BB7a):** the real cost is that `listFacts` loads *every* fact for a
scan and all five callers filter in memory. An order-matching index removes the measured TEMP B-TREE
for ~14% (267 → 230 ms) but adds that fourth index; the honest fix is a per-file/per-kind query
surface. Logged for the P-1 perf sprint, not beta.

## Caught by a gate, not by review: BB-1 refused pure renames

Worth recording because it is the sprint's best argument for running the benches rather than trusting
the unit tests.

BB-1 shipped with the deletion-only negative control the TDD named — and a `git mv` with unchanged
content is the *second* case, which the TDD did not name. Git emits only `similarity index 100%` /
`rename from` / `rename to` for it: no hunks, so it parses identically to an empty diff. BB-1 refused
it, and `eval:bench` caught it as taxonomy's ordinary-edit refusal rate going 0/8 → 1/8.

That metric matters more than its size suggests: refusal rate on edits that are *not* violations is
the single largest determinant of a stranger's first session. Fixed in `d735ea20`; renames are now
tracked and reported (`Checked 0 files (1 renamed file unchanged)`) rather than refused or hidden.

## Found while closing: the publish path shipped a debug engine

Not a TDD item, and the most consequential thing in this sprint after BB-5.

`scripts/prepare-engine-package.mjs` is the `prepack` hook on every engine package, so it runs on
`npm publish`. It built `cargo build -p drift-engine` with **no `--release`** and staged
`target/debug/drift-engine`. Every user installing `driftdetect` would have received a debug engine —
~2.7x slower on the same check — which is BB-2's confound in the shipped product.

`build-engine-artifacts.mjs` had always built these correctly. The publish path used the other script
and the two disagreed silently; the release-matrix validator checks presence and checksums, not
profile, so nothing caught it. It was BB-2's own stderr warning, appearing in the installed-package
e2e flow, that surfaced it.

Fixed, and guarded: staging now refuses a binary that reports `build_profile: "debug"` or that cannot
report one at all. **This is worth confirming before any publish** — it means every previously
packed artifact in this checkout was a debug build.

## Still human-gated (unchanged by this sprint)

- `driftdetect@1.0.0-beta` npm identity — publishing over the v1 audience is Geoffrey's call.
- win32 verify-or-mark-unsupported.
- Nothing here was pushed, published, or posted.

## What a reviewer should check first

1. The `@drift/core` extraction in BB-6 (scope membership especially) — largest blast radius.
2. BB-4's `--strict-contract` precedence: a real block outranks the staleness refusal. Asserted, but
   it is the kind of ordering that rots.
3. BB-5's exemplar attachment point. It must stay *after* all checks contribute findings; moving it
   earlier silently breaks the invariant without failing an obvious test.
