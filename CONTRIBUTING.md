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

## Pull Requests

Keep PRs narrow. Include tests for behavior changes, update docs when output contracts change, and call out any remaining product or security gaps.
