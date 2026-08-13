# Changelog

This file starts now. Earlier tags (`v0.3.0`, `native-v0.9.32`, `v0.9.33`, `v0.9.46`) predate it and
were cut without release notes; see [`docs/HISTORY.md`](docs/HISTORY.md) for the architecture story
behind them instead of trying to reconstruct a log after the fact.

## Unreleased

### Fixed
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
