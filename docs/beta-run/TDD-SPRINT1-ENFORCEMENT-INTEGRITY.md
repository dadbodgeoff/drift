# TDD — Sprint 1: enforcement integrity

**For:** Opus, run 2 continuation. **Base:** `a48ac41`. **Written:** 2026-07-28 after a source-level
audit of every seam named below. Every file:line reference was read at `a48ac41`; every measurement
was taken in an isolated clone (`~/drift-audit-baseline`) against private eval-repo copies
(`~/drift-falsification/repos-audit`), never the active checkout.

Test-first throughout. Each task states the **Red** tests to write and the command that must show
them failing, then the **Green** implementation seam, then **Verify**. Do not write implementation
before the red test exists and fails for the stated reason.

---

## 0. What the audit changed about the plan

My earlier sprint sketch said "finish T100's matcher work on three repos." **That was wrong, and the
audit found why.** The matcher is correct; it is data-starved.

`forbiddenModuleFiles_` (`packages/cli/src/check/run-check.ts:2519`) derives forbidden module
identities from the repo's *own already-resolved* import edges — an elegant design that needs no
second resolver and cannot disagree with the graph. It returns an empty set when nothing resolvably
imports a forbidden specifier, and then matching falls back to specifier comparison, which is
exactly the pre-T100 behaviour. Measured on fresh scans:

| Repo | imports of the forbidden specifier | of those, resolved | `forbiddenModuleFiles_` | T100 works? |
|---|---|---|---|---|
| taxonomy | 8 | **8** | populated | yes |
| dub | 844 | **0** | empty | no |
| formbricks | 712 | **0** | empty | no |

So the remaining recall gap is a **resolver coverage** problem, and it is upstream of at least three
symptoms: T100's unfixed repos, the parser-gap counts that keep every repo out of blocking readiness,
and the frequency with which the enforcement gate trips. One fix, three payoffs. That reframing is
the single most important thing in this document.

**Ordering consequence.** Fixing the resolver *raises* recall, which (a) trips the coverage-direction
gate and (b) produces more findings for the enforcement gate to silently zero. So the safety fix goes
**first**: make silent demotion impossible before making detection better. Red before green, at the
sprint level.

---

## Task order and why

1. **S1-01 — Fail closed: a demoted finding must never exit 0.** Smallest change, converts an
   invisible failure into a loud one. Everything after it becomes observable.
2. **S1-02 — Tell the truth about `can_block`.** Same area, removes the contradiction that made this
   bug look inconclusive when probed from the CLI.
3. **S1-03 — Oracle: assert the exit code and the attribution.** So the suite can see S1-01's
   behaviour and cannot regress it.
4. **S1-04 — Resolver coverage: nested tsconfig + workspace packages.** The leverage fix.
5. **S1-05 — Namespace / dynamic / `require` provable at runtime.** Removes the residual trigger
   class legitimately rather than by exception.
6. **S1-06 — Coverage-direction coupling: decide, then surface.** Required because S1-04 succeeds.

---

## S1-01 — Fail closed: a demoted finding must never exit 0

### Why

Verified at `a48ac41`, no harness involved, on a private cal.com copy:

```
Route A: import { prisma } from "@calcom/prisma"        -> exit 2, enforcement_result "block"
Route A + Route B: import * as U from "@calcom/lib"     -> exit 0, enforcement_result "none"
Route A + Route B: await import("@calcom/lib")          -> exit 0, enforcement_result "none"
```

`@calcom/lib` exists, Route B has no violation, Route A's finding is unchanged. The mechanism is
`crates/drift-engine/src/check_command.rs`:

- `:37` — `let can_block = completeness_reasons.is_empty();` — one boolean for the whole check.
- `:379` `check_graph_completeness_reasons` — contributes a reason for any **API-route file** carrying
  a diagnostic of `unresolved_import` | `unresolved_import_symbol` |
  `unsupported_namespace_import_symbol`.
- `:276` — rewrites **every** finding's `enforcement_result` to `"none"` when `!can_block`.

Then `packages/cli/src/check/run-check.ts:607` exits `blockingCount > 0 ? 2 : 0`, and
`blockingCount` is 0 because everything was demoted. Uncertainty becomes success.

**The contract does not require this.** `packages/engine-contract/src/index.ts:1189-1210` fires only
when some finding has `enforcement_result === "block"`. A payload whose findings are all `"none"` is
contract-legal at any completeness. So the demotion is contract-mandated; **reporting `pass` is not.**
That is why the earlier per-file-gating attempt was correctly reverted, and why this fix is different:
it changes the *outcome*, not the finding.

Precedent already exists: `run-check.ts:203` returns `CHECK_EXIT_REFUSED` (=3, defined at `:49`) with
`blocked_reasons: ["typescript_fallback_used"]` in the summary. Follow that shape exactly.

### Red

1. **Engine unit test** — `crates/drift-engine/tests/direct_data_access_rule.rs` (or a new
   `enforcement_gate.rs`): construct a `CheckRequest` with two route files, one carrying a
   block-mode violation with complete evidence and one carrying a namespace-import diagnostic.
   Assert the result reports incompleteness (`completeness[0].can_block == false`) **and** that its
   `reasons` name the causing file. This should pass today — it pins existing intended behaviour so
   the CLI-side change cannot be mistaken for an engine change.
2. **CLI test** — `packages/cli/test/` (new `check-fail-closed.test.ts`): drive `runCheck` with a
   stubbed `ScanData` where `completeness[0].can_block === false`, `reasons` non-empty, and findings
   whose `enforcement_result` is `"none"` but whose convention mode is `block`. Assert:
   - `exitCode === CHECK_EXIT_REFUSED` (3), **not** 0;
   - `summary.blocked_reasons` contains a reason naming the causing file and specifier;
   - the finding is still reported (refusal must not hide it);
   - a check with the *same* findings and `can_block === true` still exits 2 (no over-refusal).
3. **E2E** — `test/e2e/`: the two-route repro above as a fixture
   (`test/fixtures/enforcement-gate-adjacent/`), asserting exit 3 rather than 0.

Must fail with: `expected 3, received 0`.

```bash
cargo test -p drift-engine enforcement_gate && pnpm --filter @drift/cli test check-fail-closed
```

### Green

`packages/cli/src/check/run-check.ts`. `checkData.completeness` is **already available** —
`packages/cli/src/engine/collect-scan-data.ts:40` receives `EngineCompleteness[]` from the engine and
`:229` assigns it. No protocol change is needed.

- Derive `enforcementDegradedByCompleteness`: true when any completeness entry has
  `can_block === false` **and** at least one reported finding's convention mode is `block` or `warn`
  while its `enforcement_result` is `"none"`.

  > **Correction, from the implementation (`e0dc052`) — this half of the spec was wrong.**
  > `checkData.completeness` is available, but it is the **scan's** completeness measurement, and on
  > the repro it reports `can_block: true, complete: true, reasons: []` while the finding is already
  > demoted: the demotion happens inside `check-repo`, whose own completeness the CLI discards.
  > Gating on the scan's value would have shipped a predicate that never fires. The implemented
  > approach is better — detect the **effect**: `enforcement_result_for` maps block→`"block"` and
  > warn→`"warn"` unconditionally, so a finding under a block- or warn-mode convention carrying
  > `"none"` can only have been zeroed. Exact, and no plumbing. Keep that; do not "restore" the
  > completeness read.
- At `:607`, extend the exit decision to:
  `blockingCount > 0 ? BLOCKED : enforcementDegradedByCompleteness ? REFUSED : PASS`.
- Add `blocked_reasons` to the summary carrying the engine's `reasons` verbatim (they already contain
  `unresolved_route_import_symbol:<path>` etc.), and surface them in `formatCheckText`.

**Do not** touch `check_command.rs:276`, and do not attempt per-finding enforcement here — that is
S1-05's job, and doing it now reproduces the reverted attempt.

### Verify / expected fallout — pre-register this

After S1-01, `pnpm eval:external` will legitimately turn **red on taxonomy, papermark and cal.com**,
because those checks genuinely cannot enforce today. That is the fix working, not a regression.

To keep the run's stop conditions intact, record the honest expectation in the same commit: set the
baseline's expected `check_exit_code` to `3` for the affected repos with a comment pointing at S1-04,
and flip it to `2` when resolution lands. **Do not** revert S1-01 to make the suite green.

### Acceptance

Two-route repro exits 3 with the cause named; single-violation repro still exits 2; no path exists
from "a finding was demoted for completeness" to exit 0.

---

## S1-02 — Tell the truth about `can_block`

### Why

`run-check.ts:626`:

```ts
can_block: checkData.engineSource === "rust" && !checkData.fallbackStatus.enforcement_degraded
```

This is computed from engine source and fallback status only — it never consults the engine's
completeness. That is why every kill-switch payload reports `can_block: true` while the engine had
already zeroed the findings, and why T101's investigation, probing from the CLI payload, concluded the
gate "reads something" invisible. It was visible; the CLI just recomputed an optimistic answer.

### Red

`packages/cli/test/check-capability-completeness.test.ts`: given `checkData.completeness[0].can_block
=== false` with reasons, assert `payload.check.capability_completeness.can_block === false` and that
`missing_capabilities`/reasons are propagated. Assert the converse too (complete → true), so this
cannot be satisfied by hardcoding false.

### Green

Fold the engine's completeness into `capabilityCompletenessForCheck`: `can_block` becomes the current
expression **AND** every completeness entry's `can_block`. Keep the existing conditions — a
TypeScript fallback must still force false.

### Also in scope: `check.status` cannot express refusal — found verifying S1-01

S1-01 is confirmed working (measured on cal.com at `e0dc052`: violation alone exit 2; violation +
adjacent namespace import **exit 3** with `blocked_reasons` naming
`unresolved_route_import:apps/web/app/api/__sb/route.ts`; clean diff + namespace import exit 0, so no
over-refusal). But in the refusal case the payload still reads:

```
exit code 3        check.status "pass"        blocking_count 0
```

`CheckRunStatus` is `"pass" | "fail" | "blocked"` (`packages/core/src/domain.ts:1127`, schema at
`packages/core/src/schemas.ts:1178`) — there is no way to say "refused" in the payload at all. So the
exit code tells the truth and the JSON does not, which is the *same defect class* as the
`can_block: true` contradiction this task exists to fix: two fields in one payload disagreeing about
the outcome. It matters more than it looks, because the consumers Drift is built for — the MCP
surface, an agent, a CI step parsing JSON rather than `$?` — read `check.status`, not the process exit
code. My S1-01 spec asked only for the exit code and `blocked_reasons`, so this is a gap in the spec
rather than a deviation from it.

**Do:** add `"refused"` to `CheckRunStatus` and set it wherever `enforcementDegradedByCompleteness`
drives exit 3. Note `check_runs.status` is persisted (`packages/storage/src/migrations.ts:446`), so
check whether stored-row validation rejects the new value before assuming a new enum member is free;
if it does, a forward migration in the T16 style is needed rather than a type edit.

**Red:** assert that the refusal case has `check.status === "refused"` and that a JSON consumer reading
only `check.status` can never conclude success for a check that exited 3. Assert `"pass"` and
`"blocked"` are unchanged for the other two cases.

### Acceptance

No payload can report `can_block: true` alongside a finding demoted for completeness, and no payload
can report a passing `check.status` alongside a non-zero exit. Add both as invariant assertions in the
e2e check so they hold for every future check shape.

---

## S1-03 — Oracle: assert the exit code and the attribution

### Why

`scripts/external-eval.mjs:445-458` is the `PASS` predicate. It asserts `injection_caught`,
`injection_evidence_correct`, `enforcement_matches_mode !== false`, and others — but:

1. **`check_exit_code` is recorded (`:388`) and never asserted.** A check that finds the violation and
   exits 0 passes the suite.
2. **`enforcement_matches_mode !== false` passes when the value is `null`.** If
   `enforcementInIsolation` errors or returns nothing, the assertion silently succeeds. `!== false` is
   a recording idiom, not an asserting one.
3. **Attribution is not asserted structurally.** A finding whose evidence names an intermediate barrel
   rather than the injected route reads as a catch. This produced a false "fixed" reading on papermark
   in my own matrix until I re-tested with the barrel outside the route tree — on `pages/api/` repos a
   barrel beside a route is itself classified as a route.

This is why a global enforcement kill-switch survived 64 commits with a green gate.

### Red

In `scripts/external-eval.test.mjs` (the harness's own test suite, 6 tests today):

1. A synthetic result with `injection_caught: true`, `enforcement_matches_mode: null` must be `FAIL`.
2. A synthetic result with `check_exit_code: 0` while `enforcement_mode: "block"` and
   `injection_caught: true` must be `FAIL`.
3. A synthetic result whose injection evidence `file_path` is not the injected route must be `FAIL`.

### Green

- Assert `enforcement_matches_mode === true` (strict).
- Add `check_exit_code` to the predicate: expected `2` when `enforcement_mode === "block"`, `0` when
  `warn`, `3` when the run legitimately refuses — read the expectation from the baseline rather than
  hardcoding, so S1-01's transitional `3` is explicit and reviewable.
- Assert `injection_evidence_correct` includes a path equality check against the injected route.
- **Keep measuring enforcement in the presence of unresolvable imports.** T101's
  `enforcementInIsolation` correctly isolates the signal from the harness's own negative controls, but
  isolation must not mean the case goes unobserved: add a second measurement that includes an
  adjacent namespace import and asserts the *refusal* from S1-01. Otherwise the product behaviour
  stays outside what the oracle looks at.

### Acceptance

Each of the three synthetic results fails the predicate. Verify by mutation, per T65's method.

---

## S1-04 — Resolver coverage: nested tsconfig and workspace packages

### Why

Two resolvers exist, and **the one that matters is the Rust one** — `IMPORT_RESOLVES_TO_MODULE`, the
edge kind `forbiddenModuleFiles_` consumes, is emitted by the engine at
`crates/drift-engine/src/main.rs:1058`, from `resolve_import` (`:1722`). The TypeScript
`packages/cli/src/engine/import-resolution.ts` is the weaker of the two (root `tsconfig.json` only at
`:51-53`, a hardcoded `@/` case at `:13-18`, no workspace packages) and should be brought into
agreement, but it is not what starves the matcher.

The Rust resolver is well built — `ResolverContext` carries `path_aliases`, `package_imports`,
`packages`, and `base_urls` (`:821-824`, populated `:1675-1681`), and `should_report_unresolved_import`
(`:1729`) is what correctly classifies `react` as *external* rather than unresolved. It has **three
specific gaps**, each verified against the repos:

**Gap 1 — workspace packages are read from the wrong file.** `read_workspace_packages` (`:1963`)
reads only `package.json#workspaces` and never `pnpm-workspace.yaml`. Every eval repo is a pnpm
monorepo, so:

| Repo | `package.json#workspaces` | `pnpm-workspace.yaml` | workspace packages resolvable? |
|---|---|---|---|
| cal.com | present (`packages/*`, …) | absent | **yes** → this is why T100 worked here |
| formbricks | **absent** | present (`packages/*`) | **no** → `@formbricks/database` unresolvable |
| dub | **absent** | present (`packages/*`) | **no** |
| openstatus | present, but see Gap 2 | present | **no** |

**Gap 2 — only `<prefix>/*` globs are honoured.** `:1976-1980` does `glob.strip_suffix("/*")` and
skips anything else, then `read_dir(repo_root.join(prefix))`. openstatus declares
`packages/**/*`, which yields the literal prefix `packages/**`, whose `read_dir` fails and is silently
dropped — so its `@openstatus/db/src/db` never resolves even though `package.json#workspaces` exists.

**Gap 3 — nested tsconfig files are never discovered.** `read_js_ts_config_resolution` (`:1831`) loops
over `["tsconfig.json", "jsconfig.json"]` at the **repo root only**. It does follow `extends`
correctly (`read_js_ts_config_file` with a `seen` set, so cycles are safe), but it never finds
`apps/web/tsconfig.json`. dub declares `@/lib/*` there — hence 0 of 844.

That accounts for every measured failure: taxonomy and papermark declare `paths: {"@/*"}` at the repo
root (Gap 3 doesn't bite); cal.com has `package.json#workspaces` (Gap 1 doesn't bite); dub hits Gaps 1
and 3; formbricks hits Gap 1; openstatus hits Gap 2.

*(This supersedes the "workspace packages whose entry lives under `src/`" hypothesis in
`T100-VERIFICATION.md` — the real discriminator is which file the workspace globs are read from and
which glob shapes parse, not the entry path.)*

Overall resolution rates today: taxonomy 55%, dub 17% (5,028 / 29,440), formbricks 17%
(3,826 / 22,322).

### Red

Fixture-level first, then repo-level — and **repo-level is the DoD**, because fixtures passed while
T22 silently excluded openstatus's real routes.

One fixture per gap, so a partial fix cannot look complete. These are Rust tests — put them beside
`crates/drift-engine/tests/graph_backed_check.rs`, asserting on emitted edges, not on findings, so
they fail for the resolution reason rather than a downstream one.

1. **Gap 1** — `test/fixtures/resolve-pnpm-workspace/`: `pnpm-workspace.yaml` with `packages/*`, **no**
   `package.json#workspaces`, `packages/database/package.json` named `@acme/database`, and a route
   importing `@acme/database`. Assert an `IMPORT_RESOLVES_TO_MODULE` edge exists.
2. **Gap 2** — `test/fixtures/resolve-workspace-deep-glob/`: `package.json#workspaces` of
   `["packages/**/*"]` with the package at `packages/data/db/`. Assert resolution. (openstatus's exact
   shape.)
3. **Gap 3** — `test/fixtures/resolve-nested-tsconfig/`: root `tsconfig.json` with no `paths`,
   `apps/web/tsconfig.json` declaring `@/lib/*`, a route importing `@/lib/db`, module at
   `apps/web/lib/db.ts`. Assert resolution. (dub's exact shape.)
4. **Entry-point variants**, cheap to add and they cover formbricks/openstatus as shipped: package
   entry via `main: "src/index.ts"`, via `exports`, and a subpath import `@acme/database/src/client`.
5. **Negative controls, in the same commit:** a sibling package `@acme/database-legacy`, and a
   type-only import of the real one, must both stay silent. This is the overshoot guard and it is not
   optional — a resolver that resolves *more* can make the matcher match more than intended.
6. **Repo-level assertion** — extend the external suite so `injection_caught` holds for dub, formbricks
   and openstatus with the relative-path and re-export shapes, not only the canonical one.

### Green

Fix the **Rust** resolver first — it is what emits the edges. Three surgical changes, one per gap,
each committable and measurable on its own:

- **Gap 1 — `read_workspace_packages` (`main.rs:1963`):** read `pnpm-workspace.yaml`'s `packages:`
  list in addition to `package.json#workspaces`, unioning both. This is a small YAML read; if adding a
  YAML dependency is unwelcome, the `packages:` block is a flat sequence of scalars and can be parsed
  without one — but say which you chose and why in the commit. Note Drift itself is a pnpm workspace,
  so this gap means Drift cannot resolve its own package graph.
- **Gap 2 — glob handling (`main.rs:1976`):** replace `strip_suffix("/*")` with handling for `**`
  (recursive descent) and for explicit non-glob entries (`packages/app-store` appears literally in
  cal.com's list). Skipping an unparseable glob must emit a diagnostic rather than being silently
  dropped — a silently-ignored workspace glob is how this stayed invisible.
- **Gap 3 — `read_js_ts_config_resolution` (`main.rs:1831`):** discover `tsconfig.json`/`jsconfig.json`
  below the root as well, and apply `paths` from the config nearest the importing file. Keep the
  existing `extends` handling. **Resolve each config's `baseUrl` and `paths` targets relative to the
  directory that declares them, not the repo root** — that is the identical trap that broke T22's
  first gitignore attempt (`GitignoreBuilder::add` interpreting patterns against the builder root), and
  it will silently mis-resolve half a monorepo if repeated here.
- **Precedence must be explicit:** nearest config wins over root; a nested alias must not leak to
  sibling apps. Add a fixture with two apps declaring the *same* `@/*` pattern to different directories
  and assert each resolves to its own.
- **Then bring the TS resolver into agreement.** `import-resolution.ts` is used for check-time graph
  assembly; if it resolves less than the engine, the two disagree about the same repository. Either
  extend it the same way or have it consume the engine's resolution rather than duplicating it —
  duplicated resolvers are how T100's original defect (`resolved_path` compared against a specifier)
  survived.
- **Determinism:** consult only in-repo configuration — no global tsconfig, no `NODE_PATH`, nothing
  above the repo root. Two machines scanning the same commit must see the same edges. T102 made exactly
  this call for `.gitignore`; match it.

### Verify

```bash
cargo test -p drift-engine && pnpm -r test && pnpm test:e2e && pnpm eval:external
DRIFT_ENGINE_BIN=<fresh release> node ~/drift-falsification/bench-2026-07-27/evasion-matrix.mjs
```

Then flip the transitional `check_exit_code: 3` baselines from S1-01 back to `2`.

### Acceptance

- Resolution rate rises materially on dub and formbricks; state the before/after numbers in the commit
  body (measured, not estimated).
- `forbiddenModuleFiles_` is non-empty for dub, formbricks and openstatus.
- Evasion matrix: relative-path and all three re-export shapes caught on **all six** repos with ground
  truth, with negative controls unchanged (type-only silent, sibling-package lookalikes silent,
  genuine subpath still caught).
- Parser-gap counts drop; report them per repo. This is the number that gates blocking readiness.

### Traps

- Do not re-resolve inside `forbiddenModuleFiles_`. Its design — derive identities from edges the
  resolver already placed — is why it cannot disagree with the graph. Fix the resolver and it fills
  itself.
- Expect baseline drift, and expect some of it to be *new true positives*. Explain each moved field
  per repo; do not `--update` past it.

---

## S1-05 — Namespace / dynamic / `require` provable at runtime

### Why

`main.rs:1097-1106` emits `unsupported_namespace_import_symbol` when a namespace import **resolved**
but member-level symbol resolution is conservative. That diagnostic then feeds the completeness gate.
After S1-04 many such imports will resolve, but the conservatism remains — so the trigger class
persists and S1-01 will keep refusing where it could legitimately block.

`await import(m)` and `require(m)` are runtime by construction: no type-only reading exists. For
`import * as X`, runtime use is provable if `X` appears in any value position — which is precisely the
analysis T12 already built. Reuse it; do not write a second one.

Verified where it lives and what shape it is in:

- `crates/drift-engine/src/facts.rs:143` `drop_type_only_usage_imports` computes
  `value_uses` / `type_uses` via `collect_identifier_usage` (`:164`), then applies
  `erased_at_runtime = used_as_type && !used_as_value` (`:159`).
- It keys on `fact.name` — the **local binding name** — and namespace imports do bind a local name
  (`main.rs:496` `push_import_binding(&mut bindings, "*", namespace_name)`, with `imported_name == "*"`).
  So "is `X` in `import * as X` used as a value" is answerable by the existing partition with no new
  AST work.
- **The catch:** those sets are local to `drop_type_only_usage_imports` at scan-time fact production
  and are not retained, while the diagnostic you need to suppress is emitted later during graph
  assembly (`main.rs:1097-1106`). So this is *reuse the function*, not *read a stored flag* — either
  call `collect_identifier_usage` at the diagnostic site, or carry the value/type verdict forward on
  the import fact. Prefer carrying it forward: computing it twice invites the two copies to disagree,
  which is the same failure mode as the duplicated resolvers in S1-04.
- Keep T12's direction of caution exactly as documented at `facts.rs:130-142`: drop only on positive
  evidence of type use with no value use. A namespace binding with no usage evidence at all must stay
  conservative rather than becoming a silent miss.

### Red

`crates/drift-engine/tests/` — for each of `import * as X` (used in a value position),
`await import(m)`, and `require(m)` reaching a forbidden module: assert a finding **with**
`enforcement_result` equal to the convention's mode, and assert **no**
`unsupported_namespace_import_symbol` diagnostic is emitted for the value-position namespace case.
Plus the negative: `import type * as T` used only in type positions yields no finding and no
diagnostic.

### Green

Where the namespace diagnostic is emitted, first consult the existing symbol-usage analysis; emit the
conservative diagnostic only when the namespace binding is genuinely unused at runtime or
unanalysable. Treat dynamic `import()` and `require()` targets as runtime references.

### Acceptance

Evasion matrix S06/S07/S08 show the convention's mode (`block` on block-mode repos) rather than
`none`, with S09 still silent. Combined with S1-01, no shape both produces a finding and exits 0.

---

## S1-06 — Coverage-direction coupling: decide, then surface

### Why

When T100 landed, taxonomy's canonical control moved from `block`/exit 2 to `warn`/exit 0 with the
injection unchanged. Better recall raised the measured violation ratio past
`CONVENTION_MAJORITY_VIOLATION_THRESHOLD = 0.5`
(`crates/drift-engine/src/candidate_command.rs:1471`, applied at `:1489`), demoting the convention.
The gate works as documented (T72) — but **every recall improvement can weaken enforcement**, and
S1-04 is a large recall improvement. Left alone, S1-04 will demote repos as it succeeds.

This one needs a decision, not a patch. Recommended: compute coverage direction from the **baseline**
scan and hold it until explicitly re-derived, so newly-detected violations cannot argue a convention
down. Alternative: exclude `new_in_diff` findings from the ratio. Either way, do the third part:

**Surface every mode change as an explicit event** — `convention demoted block → warn because coverage
crossed N%` — in the check output and the audit log. A silent mode change is the same class of defect
as a silent demotion, and this project has now been bitten by that twice.

### Red

A test that adds violating routes to a fixture until the ratio crosses 0.5 and asserts the
convention's enforcement mode is **unchanged** from its baseline-derived value, plus a test asserting
the demotion event is emitted when a re-derivation legitimately changes it.

### Acceptance

Running S1-04's improved recall against the eval repos does not silently move any repo from block to
warn; any legitimate change is reported.

---

## Sprint gate

```bash
pnpm verify:ci                        # build, typecheck, unit, e2e, harness, fmt, clippy, boundaries, claims, beta proof
pnpm eval:external                    # 7/7, every baseline delta explained per repo
node ~/drift-falsification/bench-2026-07-27/evasion-matrix.mjs   # the DoD proof
```

**Sprint 1 is done when:** every should-catch shape is caught *and* enforced at its convention's mode
on all block-mode repos; every negative control still silent; and no reachable path exists from "a
violation was found" to "exit 0". The matrix grid, not the fixtures, is the evidence — pre-fix grids
are preserved at `evasion-results-BEFORE-6e465b3.json` and `evasion-results-5e75a19.json`.

## Process note worth adopting

T101 was reclassified from product defect to harness artifact on the strength of a harness bug that
genuinely existed — but the reclassification generalised from *"the harness manufactured this
instance"* to *"the behaviour is correct"*, and the second claim needed its own test with a
**resolvable** module. One such test would have kept it open. Suggested protocol addition: **when a
defect is reclassified as a test artifact, the reclassification requires a test that isolates the
product from the artifact.** This is the same "assert at the level the bug lives" lesson as T22 and the
rev-1 detection column, applied to retractions.
