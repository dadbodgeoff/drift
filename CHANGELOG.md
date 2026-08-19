# Changelog

This file starts now. Earlier tags (`v0.3.0`, `native-v0.9.32`, `v0.9.33`, `v0.9.46`) predate it and
were cut without release notes; see [`docs/HISTORY.md`](docs/HISTORY.md) for the architecture story
behind them instead of trying to reconstruct a log after the fact.

## Unreleased

### Fixed
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
