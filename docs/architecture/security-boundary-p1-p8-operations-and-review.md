# Security Boundary P1-P8 Operations And Review Notes

Use this when reviewing, releasing, or explaining the security-boundary system.

## Commands That Matter

| Command | What it proves |
| --- | --- |
| `drift scan --json` | Rust can index the repo, emit facts/graph, store candidates, and write capability diagnostics. |
| `drift check --json` | Rust can enforce accepted deterministic contracts and return proof payloads. |
| `drift check` | Human output can explain security blocks without leaking source. |
| `drift scan status --json` | Stored repo state can report Phase 8 `security_capabilities[]`. |
| `drift repo map --json` | Route map can show proof-backed `routes[].security`. |
| `drift candidates --json` | Candidate UX works without making candidates proof truth. |
| MCP `get_security_context` | Agents receive `drift.security.context.v2` from proof/query read models. |
| MCP `get_repo_map` | MCP route security matches CLI repo map semantics. |

## Final Gates Used On This Branch

```bash
pnpm verify:ci
git diff --check
```

`pnpm verify:ci` runs build, typecheck, Rust tests, package tests, e2e tests, format check, clippy, boundary checks, release matrix validation, product claim validation, beta proof, and diff whitespace check.

## Review Checklist

1. Check that every blocking security finding came from a `SecurityBoundaryProof`.
2. Check that the matched contract is accepted and `deterministic_check`.
3. Check that candidates have `reason_not_blocking` and do not fail checks.
4. Check that `security_boundary_proof_runs` has the latest check proof rows.
5. Check that `scan status`, `repo map`, and MCP use the shared query read model.
6. Check that output includes line-level metadata only, not source values.
7. Check old-row compatibility by loading `security_boundary_proofs` when no proof runs exist.
8. Check release proof parity between CLI and MCP.

## Security Output Rules

Allowed in CLI/MCP output:

- File path.
- Route path and method.
- Line numbers.
- Fact ids.
- Finding ids.
- Missing proof codes.
- Parser gap codes.
- Capability names.
- Enforcement result.

Not allowed in CLI/MCP proof context:

- Source snippets.
- Full source.
- Raw SQL strings.
- Raw URLs.
- Request payloads.
- Headers.
- Cookies.
- Environment values.
- Tokens.
- User ids.
- Tenant ids.
- Secret values.

## Backward Compatibility Rules

- `security_boundary_proofs` is still readable for older scan-scoped rows.
- `security_boundary_proof_runs` is preferred for Phase 8 because it is check-run-scoped.
- Old proof rows may have optional endpoint path/method fields; new Rust output should populate them for supported routes.
- Capability reports remain available for diagnostics, but Phase 8 route security should not treat them as proof.

## Known Review Pressure Points

| Area | Why to re-check |
| --- | --- |
| MCP security context | v2 must stay proof-backed and must not regain raw-fact proof sections. |
| CLI/MCP parity | The beta proof normalizes sanitized MCP findings before comparing with CLI. Keep that intentional. |
| Phase 5 contracts | Blocking sensitive response contracts must not be backed by candidate sensitive fields. |
| Parser gaps | A parser gap can block deterministic proof; it should not be converted into a pass. |
| Capability status | `can_block` should mean deterministic accepted block capability, not general support. |
| Route normalization | Next route groups like `(admin)` should not change the public route path. |

## Minimal Architecture Audit Command Set

```bash
git status --short --branch
git diff --stat origin/main...HEAD
git diff --check
cargo test -p drift-engine
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm test:e2e
pnpm typecheck
cargo fmt --all -- --check
cargo clippy -p drift-engine --all-targets -- -D warnings
pnpm verify:ci
```

## Useful Source Anchors

| Question | Source |
| --- | --- |
| What security contract kinds exist? | `packages/core/src/security.ts` |
| What proof shape is accepted? | `packages/core/src/security.ts` |
| What Rust conventions route into proof builders? | `crates/drift-engine/src/check_command.rs` |
| How are P6 proofs built? | `crates/drift-engine/src/security_phase6.rs` |
| Where are proof runs stored? | `packages/storage/src/migrations.ts`, `packages/storage/src/sqlite-storage.ts` |
| What does CLI/MCP consume? | `packages/query/src/security-boundary-proof.ts` |
| What does MCP expose to agents? | `packages/mcp/src/security-context.ts` |
| What proves release parity? | `scripts/run-beta-proof.mjs` |

## Current Merge Readiness

The Phase 8 branch is `codex/security-phase8-production`.

Manual PR URL:

`https://github.com/dadbodgeoff/drift/compare/main...codex/security-phase8-production?expand=1`
