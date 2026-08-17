# Contributing

Drift is a local-first repo intelligence guardrail. Keep changes aligned with the core wedge: TypeScript/JavaScript API/server-side layering conventions for AI-generated diffs.

## Architecture Rules

- Rust owns deterministic parser and rule authority.
- TypeScript owns CLI/MCP orchestration, storage boundaries, governance, policy, and formatting.
- SQLite access belongs in `packages/storage`.
- Agent-facing outputs must include policy/redaction metadata and must not include source snippets or secrets.
- Do not add UI, cloud sync, broad language support, OCR, or duplicate-helper detection unless the roadmap explicitly moves there.

## Local Verification

Run the full gate before opening a PR:

```bash
pnpm install --frozen-lockfile
pnpm verify:full
```

`verify:full` is `verify:ci` plus `verify:evals`. CI runs only `verify:ci`, because the eval battery
needs the seven pinned evaluation repos cloned to `$DRIFT_EVAL_REPOS` (default
`~/drift-falsification/repos`) and a release engine binary — neither exists on a hosted runner. If
you do not have those repos, run `pnpm verify:ci` and say so in the PR; do not report `verify:full`
as passing. `pnpm eval:determinism` fails on a repo it cannot find rather than skipping it, so a
partial run has to be named explicitly with `--only`.

For Rust-only changes, run:

```bash
cargo fmt --all
cargo clippy -p drift-engine --all-targets -- -D warnings
cargo test -p drift-engine
```

## Test Conventions

Three rules, all of them written after a P0 shipped underneath tests that looked like coverage and
were not.

### 1. A hand-built contract is not coverage for a convention kind

`api_route_forbids_sensitive_response_fields` was structurally incapable of producing a finding
while three tests asserted its behaviour. All three started downstream of the break: two hand-wrote
an accepted contract with `"source": "contract"` — a value the proposer never emits — and one wrote
the convention straight into the state DB with `storage.upsertAcceptedConvention`. The proposer
emitted a value the prover discarded, and no test in the repo was positioned to notice.

So:

> **Every convention kind needs at least one assertion driven by a contract that
> `candidate_command.rs` actually produced.** Obtain it through the documented workflow — `drift
> scan` → `drift start` → `drift conventions accept <candidate_id> --confirm` → `drift check` — and
> assert on the resulting `facts` / `findings` rows.

Hand-built contracts may still pin *prover* behaviour, and unit tests of either half remain
welcome. They just do not answer "can this kind fire?", which is the question that was open for a
whole release. `test/e2e/gt-harness.ts` implements the workflow; use `runGtWorkflow` rather than
re-deriving it, and never call `upsertAcceptedConvention` or hand-write a `requires` block in a
test that claims coverage for a kind.

### 2. Heuristic detectors need near-miss negatives, not just recall

A fixture built only from true positives cannot distinguish a correct detector from
`name.includes("db")`. Both score 100%.

> **Any fixture for a heuristic-driven detector must include lookalike negatives whose *content*
> contradicts the name signal, and the test must assert silence on them.**

The audit corpus is the worked example. `gt-data-access` carries `route-dbg.ts`, `route-imdb.ts`,
`route-prismatic.ts` and `route-utils.ts` — names that trip a substring test, contents that are not
data access — beside its four genuine routes. `gt-presence-auth` carries `withAuthorHat`, which the
auth-helper name heuristic nominates (it starts with `with`, it contains `auth`) and whose body is
a byline decorator that checks nothing; the fixture asserts it never joins the auth family and that
routes calling only it are still flagged.

A negative is only worth its line count if a plausible wrong implementation would fail it. "Add a
file with no imports" is not a near miss.

### 3. Every (convention kind × enforcement path) cell is declared in the ledger

`test/canary/convention-cell-ledger.json` declares one state per cell — `firing`, `quarantined`,
`unimplemented`, or `needs-review` — and each state may only be assigned when its specific evidence
is in hand (the file's own header states the four bars). `scripts/convention-cell-ledger.mjs`
derives the cell set from `check_command.rs`, `candidate_command.rs` and `capabilities.ts`, so an
undeclared cell fails; canaries live in `test/e2e/gt-canary.test.ts`.

Two things about it that are easy to get wrong:

- **The unit is the pair, not the kind.** `check_command.rs` intercepts on
  `matcher.enforcement_semantics == "presence"` *before* any kind arm, and presence is stamped per
  candidate, not per kind. One kind reaches two different enforcement paths depending on which
  candidate the proposer emitted.
- **`needs-review` is the required default and it is not a failure.** Never infer `quarantined`
  from "this looks deliberate" — that is a claim about intent, and guessing it turns an undiscovered
  defect into a checked-in "working as designed". `quarantined` requires a citation you actually
  located and can quote with a path.

Enforcement runs on the integration branch only, so a track branch can land work that earns a
transition without editing a file it does not own; the lead applies the state change at integration.

## Pull Requests

Keep PRs narrow. Include tests for behavior changes, update docs when output contracts change, and call out any remaining product or security gaps.
