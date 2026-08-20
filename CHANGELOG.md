# Changelog

This file starts now. Earlier tags (`v0.3.0`, `native-v0.9.32`, `v0.9.33`, `v0.9.46`) predate it and
were cut without release notes; see [`docs/HISTORY.md`](docs/HISTORY.md) for the architecture story
behind them instead of trying to reconstruct a log after the fact.

## Unreleased

### Fixed
- **A data-layer import laundered through a local binding is now caught.** `export { db } from
  "./db"` was blocked; the same republication with the `from` clause moved one line up was a silent
  pass on the product's only shipped convention. Three shapes close:

  | shape | example |
  |---|---|
  | E04 — const alias | `import { db } from "./db"; export const client = db;` |
  | E04b — detached clause | `import { db } from "./db"; export { db };` (and `export { db as client }`) |
  | E05 — thin wrap | `export function get() { return db; }` (and `export const get = () => db;`) |

  The route importing `client` / `db` / `get` from that module is now attributed the finding,
  naming the specifier the route actually wrote. The message says which mechanism it followed —
  "through a chain of modules that republish its binding", not "through a re-export chain", because
  a reader who opens the file and finds no re-export learns to distrust the message rather than the
  code.

  Two new fact kinds, `export_aliases_import` and `export_wraps_import`, and one new graph edge
  kind, `MODULE_ALIASES_MODULE`. Both facts project onto the one edge; the fact kind is what
  preserves the distinction between an identity claim decidable from a single declarator and a
  weaker claim about a function's returns.

  **Engine and CLI must ship together.** Migration `037_binding_alias_fact_kinds` is schema-less
  and exists only to move the migration count in lockstep with the fact vocabulary: `FactRecordSchema.kind`
  is a closed enum, so a database written by a build that knows these kinds throws on every
  `listFacts` in a build that does not. The `scan_started` handshake declares `fact_kinds` and
  refuses a mismatched pairing before ingestion, so a new engine against an older CLI fails with
  "Drift engine and CLI disagree about vocabulary" rather than ingesting a stream it cannot model.
  That is the designed behaviour, and it means the two artifacts are a matched pair on upgrade.

  **Upgrade consequence: previously-baselined violations can resurface as new.** A finding's
  fingerprint embeds the terminal forbidden module, and the widened walk is LIFO, so it can now
  reach a *different* forbidden module first for the same route and the same import. The violation
  is unchanged; its fingerprint is not. On the eval corpus this happened once
  (`onboarding/checks/route.ts` on openstatus kept its meaning and moved `forbidden_path` from
  `schema/index.ts` to `schema/plan/utils.ts`, reading as one dropped plus one new fingerprint).
  On a real repo with a large baseline, expect some churn on the first check after upgrading; the
  churned findings are re-baselined, not newly introduced.

  Honest corpus result, measured `main @ a774dace` against this branch on the seven pinned repos,
  same machine, same eval harnesses:

  - **Six repos are byte-identical**: taxonomy 4, dub 349, formbricks 11, calcom 28, papermark 237,
    midday 5 findings before and after. Not one added, dropped or changed finding.
  - **openstatus moves 17 → 19**, and **zero files newly flag** — both routes were already flagged.
    Two are new true positives, hand-adjudicated against the source: `chat-session/schemas.ts:35`
    (`export { CHAT_TITLE_MAX_LENGTH };`, republishing an `@openstatus/db/src/schema` import) and
    `monitor/schemas.ts:15` (`export { monitorJobTypes, monitorMethods, monitorPeriodicity };`).
    The third is the fingerprint churn above, caused by `limits.ts:15`,
    `export const getPlanLimits = getLimits;` — whose own comment reads "Re-exported plan-defaults
    lookup".
  - **No false positives.** `pnpm eval:presence` is unchanged: precision 1.0 and recall 1.0 with
    zero false positives on all seven repos. `pnpm eval:determinism` stays 7/7 deterministic.

  Scanning costs one extra whole-file traversal per file. Measured on openstatus, five runs each:
  median scan wall **3.63s → 4.25s (+17%)**. Findings are unaffected by this; it is scan latency
  only.

  What is deliberately still open, recorded rather than implied: member expressions
  (`export const q = db.user`), namespace members, object literals, `async` wraps, conditional
  returns, multi-declarator exports and reassignment toward the import. Each is pinned as a
  `known_evasion` cell in `scripts/evasion-baseline.json` and tabulated with its reason in
  `docs/architecture/binding-alias-laundering-tdd.md` §R8-13.
- Secret-exposure proofs no longer read comments and string literals as code. Adding
  `// console.error(apiKey);` to a route, or a trailing `// ... process.env.API_KEY` to a line that
  already logs something, used to turn it from `Proven` to `MissingProof`. Secret reads and secret
  sinks both come from the tree-sitter walk now.

  This is a DETECTION CHANGE, not only a false-positive fix. Measured case by case against the
  previous engine at the `check-repo` surface, it removes 3 findings and adds 6:

  - Removed: a commented-out sink; a sink named inside a string literal; a token elsewhere on a
    sink's line that the sink does not actually reference (`console.error("boot"); const x = apiKey;`).
  - Added, all true positives the line scan could not see: `logger?.error(x)`;
    `Response.json ({ x })` with a space before the paren; a second statement on a line whose first
    secret classified `unknown`, which the old scanner abandoned wholesale; `secretManager\n.get(k)`
    split across lines; a second `process.env` read on one line; and call arguments split across
    lines.

  Text scanning is deliberately retained in the parser-gap scanners, which emit
  `blocks_enforcement: true` — there, over-firing refuses to enforce, which is the conservative
  direction. The taint fixpoint also still reads raw lines; a string literal mentioning a secret
  variable can still mark what that line assigns as carrying the secret.
- `Cargo.toml` claimed `UNLICENSED` while the rest of the repo is MIT — aligned.
- The product-scope "V1" language in README/CONTRIBUTING/SECURITY collided with "v1" meaning the
  first architecture generation once the version history became public. Renamed to "core wedge";
  v1/v2/v3 now refer only to architecture generations.
- Repository housekeeping: 41 stale branches removed (28 fully-merged, 6 confirmed-superseded,
  7 dead Dependabot bumps), `delete_branch_on_merge` enabled, branch protection added to `main`.

### Added
- `docs/HISTORY.md` — the v1 → v2 → v3 story, linking the three preserved architecture branches
  (`archive/v1`, `archive/v2`, `archive/v2-full-experiment`).
- `docs/README.md` as a front door separating public docs from `docs/internal/` process records.

### Changed
- `docs/architecture/` trimmed to current system-design and contract references; sprint plans,
  TDD/audit-trail documents, and autonomous-run logs moved to `docs/internal/`.
