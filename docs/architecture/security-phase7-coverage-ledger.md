# Security Phase 7 Coverage Ledger

Scope: Phase 7 of `docs/architecture/security-boundary-enforcement-100-tdd.md`.

Phase 7 is complete only when candidate inference is useful without becoming enforcement. Coverage here means spec coverage: every required candidate family, election rule, and validation guard has a live test or gate.

## Requirement Coverage

| Requirement | Proof |
| --- | --- |
| Auth helper candidate | `crates/drift-engine/tests/candidate_inference.rs::infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| Middleware protection candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| Validation helper candidate | `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| Tenant helper candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| Serializer candidate | `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| Sensitive field candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| SQL safe wrapper candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| SSRF allowlist/sanitizer candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| CSRF helper candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| Rate-limit helper candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| CORS policy candidate | `infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; `scan_repo_then_infer_candidates_covers_phase7_security_candidate_families` |
| Candidates default to non-blocking mode | Rust candidate tests assert `suggested_enforcement_mode = warn` and `reason_not_blocking = candidate_not_accepted` for every Phase 7 security family. |
| Candidate cannot produce blocking finding until accepted | `crates/drift-engine/tests/candidate_inference.rs::infer_candidates_emits_security_phase_candidates_as_non_blocking_elections`; Phase 1-6 `candidate_only_*_does_not_block` Rust tests remain part of the gate. |
| Accepted candidate becomes Rust contract input | `packages/cli/test/cli.test.ts::accepts a candidate, materializes a repo contract, and audits the action`; Phase 1-6 check tests validate accepted contracts through Rust proof. |
| Rejected candidate is not re-proposed without new evidence | `packages/cli/test/cli.test.ts::does not re-propose a rejected candidate without new evidence` |
| Blocking heuristic contracts are rejected | `packages/cli/test/cli.test.ts::rejects contract validate when a blocking convention is not deterministic`; `rejects imported blocking security contracts backed by candidate sensitive fields` |
| Output includes evidence counts, confidence, suggested contract/mode, and reason not blocking | `crates/drift-engine/tests/candidate_inference.rs` candidate payload assertions; `pnpm --filter @drift/cli test` covers CLI rendering and import/accept surfaces. |

## Gate Commands

Run these from the repository root before calling Phase 7 covered:

```bash
cargo test -p drift-engine --test candidate_inference
cargo test -p drift-engine security_
cargo test -p drift-engine --test security_phase6
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
git diff --check
```

## Boundary

Phase 7 does not make heuristic evidence enforceable. The expected lifecycle remains:

```text
scan facts -> infer candidate -> human/agent election -> accepted repo contract -> Rust proof/check
```

Phase 8 output and MCP UX are intentionally out of scope except where existing CLI tests prove candidates can be listed, accepted, rejected, imported, and validated without bypassing elections.
