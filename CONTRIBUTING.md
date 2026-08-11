# Contributing

Drift is a local-first repo intelligence guardrail. Keep changes aligned with the V1 wedge: TypeScript/JavaScript API/server-side layering conventions for AI-generated diffs.

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
pnpm verify:ci
```

For Rust-only changes, run:

```bash
cargo fmt --all
cargo clippy -p drift-engine --all-targets -- -D warnings
cargo test -p drift-engine
```

## Pull Requests

Keep PRs narrow. Include tests for behavior changes, update docs when output contracts change, and call out any remaining product or security gaps.
