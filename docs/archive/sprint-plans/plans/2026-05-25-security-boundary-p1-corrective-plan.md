# Security Boundary Phase 1 Corrective Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` plus `superpowers:executing-plans` or `superpowers:subagent-driven-development` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct PR #77 so Phase 1 auth-boundary enforcement is actually production-ready and matches `docs/architecture/security-boundary-enforcement-100-tdd.md`.

**Architecture:** Rust must be the deterministic authority for facts, accepted-pattern normalization, control-flow proof, parser gaps, missing proofs, and blocking rule evaluation. TypeScript must only carry product/control-plane responsibilities: schema validation, contract transport, storage/query/MCP/CLI envelopes, governance, lifecycle, and output formatting. `check_repo` may dispatch and map results, but it must not rebuild security proof inline.

**Tech Stack:** Rust `drift-engine`, TypeScript workspace packages, SQLite storage/query surfaces, CLI/MCP, Vitest, Cargo tests, fixture-driven e2e.

---

## Current Verdict

PR #77 is blocked. Do not start Phase 2. Do not add middleware coverage. Correct Phase 1 first.

The core failure is architectural: the real product path added in PR #77 does not consume the Rust proof/control-flow authority it introduced. `crates/drift-engine/src/check_command.rs` reconstructs auth proof inline from file-level line ordering and raw symbol names, which creates false passes and bypasses parser-gap/missing-proof semantics.

## Non-Negotiable Corrective Rules

- No production code before a failing test proves the defect.
- Every corrective item must follow RED -> GREEN -> REFACTOR.
- Do not keep inline auth proof logic in `check_command.rs`.
- Do not trust raw `symbol_called` names as accepted auth helpers.
- Do not let candidate-only or heuristic evidence block.
- Do not silently pass unsupported control flow.
- Do not overstate capabilities.
- Do not persist or expose proof summaries until proof shape is stable and schema-validated.
- Do not add Phase 2 work in this correction branch.
- Do not include source snippets, request payloads, header/cookie values, secret values, raw SQL values, env values, or tokens in outputs.

## Correct Target Shape

`check_repo` security auth flow must be:

```text
CheckRequest
  -> canonical/legacy contract normalization in Rust
  -> neutral facts grouped by route handler
  -> accepted auth helper normalization
  -> file-local control-flow proof
  -> SecurityBoundaryProof with missing_proof/parser_gaps
  -> deterministic rule evaluation
  -> CheckFinding + proof output
  -> TypeScript mapping/lifecycle/output without duplicating security logic
```

`check_repo` must not:

- choose the first guard in a file and apply it to every route
- treat a `GET` guard as proof for `POST`
- let a branch-local guard dominate a bypass path
- let a callback-local guard dominate an outer sink
- mark `parser_gaps: []` by default
- treat `symbol_called("requireUser")` as trusted without accepted contract normalization

## Corrective Finding Map

| Finding | Corrective tasks |
| --- | --- |
| File-level first guard proves whole file | Tasks 1, 4, 5 |
| Raw `symbol_called` name trusted | Tasks 2, 3, 5 |
| Parser gaps hard-coded empty | Tasks 4, 6 |
| Canonical contract fields not passed | Tasks 2, 3 |
| Scan uses `extract_security_facts(..., &[])` | Tasks 3, 5 |
| Endpoint/method exceptions not honored | Task 7 |
| Waivers dropped before Rust/auth mapping | Task 8 |
| `if` without `else` not modeled | Task 4 |
| Capabilities still direct-data-access only | Task 10 |
| Parser-gap schema accepts arbitrary records | Task 2 |
| Query/storage/MCP not durable truth | Task 11 |
| E2E only checks fixture existence | Task 9 |
| Golden count-only update masks behavior | Task 9 |

## Files And Responsibilities

### Rust

- `crates/drift-engine/src/security_patterns.rs`
  - Normalize accepted auth helper contracts.
  - Normalize canonical `requires.auth_helpers`.
  - Normalize legacy `matcher.required_calls` only through compatibility-tested code.
  - Resolve trusted guard calls from import facts and accepted contract input.

- `crates/drift-engine/src/security_facts.rs`
  - Extract neutral facts only.
  - It may emit calls, response sinks, callback-boundary indicators, dynamic-flow indicators, and route-related evidence.
  - It must not decide whether a call is trusted unless passed explicit accepted contract input by the check path.

- `crates/drift-engine/src/security_control_flow.rs`
  - Own handler-local dominance and path-sensitive summaries for Phase 1.
  - Model the Phase 1 required cases: straight-line, guard after sink, branch bypass, `if` without `else`, callback boundary, unsupported dynamic control flow.

- `crates/drift-engine/src/security_proof.rs`
  - Build `SecurityBoundaryProof`.
  - Emit `missing_proof`.
  - Emit `parser_gaps`.
  - Never silently pass unsupported cases.

- `crates/drift-engine/src/security_rules.rs`
  - Evaluate deterministic auth contracts from proof results.
  - Candidate-only and heuristic evidence cannot block.

- `crates/drift-engine/src/check_command.rs`
  - Dispatch only.
  - Convert `CheckRequest` to normalized security inputs.
  - Call `security_patterns`, `security_control_flow`, `security_proof`, and `security_rules`.
  - Map returned findings/proofs into `CheckResult`.
  - No inline auth line-order proof logic.

- `crates/drift-engine/src/protocol.rs`
  - Carry canonical security contract fields, legacy compatibility fields, exceptions, and waivers if Rust needs them for deterministic decisions.
  - Preserve schema versions.

### TypeScript

- `packages/engine-contract/src/index.ts`
  - Strictly validate security proof, parser gap, missing proof, and check result schemas.
  - Reject malformed parser gaps.
  - Carry canonical contract fields without flattening away semantics.

- `packages/core/src/security.ts`, `packages/core/src/domain.ts`, `packages/core/src/schemas.ts`
  - Define canonical security contract and proof shapes.
  - Validate that blocking security contracts require deterministic capability.
  - Preserve legacy compatibility only where explicitly tested.

- `packages/cli/src/engine/engine-check.ts`
  - Send full accepted contract input needed by Rust.
  - Do not hard-code security contract schema behavior.
  - Do not drop exceptions/waivers where Rust needs them.

- `packages/cli/src/check/run-check.ts`
  - Call engine-owned auth checks.
  - Apply existing finding lifecycle/governance conventions without duplicating Rust rule logic.
  - Map proof/finding output into CLI payloads.

- `packages/cli/src/check/security-check.ts`
  - Output shaping only.
  - No deterministic security decisions.

- `packages/query/src/security-boundary-proof.ts`
  - Read model only after proof shape is stable.

- `packages/storage/src/migrations.ts`, `packages/storage/src/sqlite-storage.ts`
  - Add persistence only after proof shape is corrected and schema-stable.

- `packages/mcp/src/security-context.ts`
  - Read-only proof summaries only after query/storage truth exists.
  - No duplicated rule logic.

## Task 0: Freeze Scope And Baseline

**Files:**
- Read: `AGENTS.md`
- Read: `docs/architecture/security-boundary-enforcement-100-tdd.md`
- Read: current PR #77 diff

- [ ] **Step 0.1: Confirm branch and dirty state**

Run:

```bash
git status --short --branch
```

Expected: identify all dirty files before touching anything. Treat unrelated dirty files as user work.

- [ ] **Step 0.2: Confirm corrective scope**

Write down this boundary in the implementation notes:

```text
Correct Phase 1 only. Do not implement Phase 2 middleware coverage.
```

- [ ] **Step 0.3: Record existing blocked findings**

Create or update the PR notes with the 13 findings from the blocking audit. Each finding must map to a task in this plan.

## Task 1: Product-Path RED Tests For False Passes

**Files:**
- Create or modify: `crates/drift-engine/tests/security_check_repo_auth.rs`
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `test/e2e/security-auth.test.ts`
- Use fixtures under: `test/fixtures/security-auth-*`

- [ ] **Step 1.1: Add Rust `check_repo` RED test for multi-handler false pass**

Test name:

```rust
check_repo_does_not_use_get_auth_guard_for_unguarded_post
```

Scenario:

```text
app/api/projects/route.ts:
- GET calls accepted auth helper before sinks.
- POST reaches a data operation/response sink without auth.
- Accepted blocking `api_route_requires_auth_helper` contract applies to GET and POST.
```

Expected RED command:

```bash
cargo test -p drift-engine check_repo_does_not_use_get_auth_guard_for_unguarded_post -- --nocapture
```

Expected RED failure: PR #77 reports no blocking POST auth finding because `check_command.rs` uses first file-level guard line.

- [ ] **Step 1.2: Add Rust `check_repo` RED test for branch bypass**

Test name:

```rust
check_repo_blocks_auth_guard_in_only_one_branch
```

Expected RED command:

```bash
cargo test -p drift-engine check_repo_blocks_auth_guard_in_only_one_branch -- --nocapture
```

Expected RED failure: PR #77 marks the route proven because first guard line appears before sink.

- [ ] **Step 1.3: Add Rust `check_repo` RED test for callback guard**

Test name:

```rust
check_repo_blocks_callback_auth_guard_for_outer_sink
```

Expected RED command:

```bash
cargo test -p drift-engine check_repo_blocks_callback_auth_guard_for_outer_sink -- --nocapture
```

Expected RED failure: PR #77 marks callback guard as dominating an outer sink.

- [ ] **Step 1.4: Add Rust `check_repo` RED test for `if` without `else`**

Test name:

```rust
check_repo_blocks_conditional_guard_without_else_before_sink
```

Expected RED command:

```bash
cargo test -p drift-engine check_repo_blocks_conditional_guard_without_else_before_sink -- --nocapture
```

Expected RED failure: PR #77 does not model the path that skips the guard.

- [ ] **Step 1.5: Add CLI product-path RED test for real `drift check --json`**

Test file: `packages/cli/test/security-check.test.ts`

Test name:

```ts
it("runs auth dominance through Rust proof authority in drift check JSON output", async () => {
  // fixture must run through runCheck, not build synthetic output
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED failure: output lacks correct parser gap/missing proof/finding for at least one false-pass case.

## Task 2: Strict Contract And Engine Schema Transport

**Files:**
- Modify: `packages/core/src/security.ts`
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/engine-contract/src/index.ts`
- Modify: `packages/engine-contract/test/security-contract.test.ts`
- Modify: `packages/core/test/security.test.ts`
- Modify: `crates/drift-engine/src/protocol.rs`
- Modify: `packages/cli/src/engine/engine-check.ts`

- [ ] **Step 2.1: Add RED test for canonical `requires.auth_helpers`**

Test name:

```ts
it("sends canonical security contract requires.auth_helpers to the Rust check request", () => {
  // engineCheckRequest must preserve requires.auth_helpers, scope, exceptions, capability, and schema version
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED failure: request only carries legacy matcher shape and loses canonical fields.

- [ ] **Step 2.2: Add RED schema test rejecting arbitrary parser gaps**

Test name:

```ts
it("rejects malformed security parser gaps in engine check results", () => {
  // parser_gaps: [{ anything: true }] must fail
});
```

Expected RED command:

```bash
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected RED failure: `parser_gaps` currently accepts arbitrary records.

- [ ] **Step 2.3: Implement strict schema transport**

Implementation requirements:

- Add canonical `requires`, `forbids`, `scope`, `exceptions`, and `governance` fields to engine check request schema where needed.
- Preserve `contract_schema_version`.
- Keep legacy `matcher.required_calls` only as compatibility input.
- Replace loose parser-gap records with strict parser-gap schema.

Expected GREEN commands:

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
pnpm --filter @drift/cli test -- security-check
```

## Task 3: Accepted Auth Helper Normalization

**Files:**
- Modify: `crates/drift-engine/src/security_patterns.rs`
- Modify: `crates/drift-engine/src/security_facts.rs`
- Modify: `crates/drift-engine/tests/security_facts.rs`
- Modify: `crates/drift-engine/tests/security_rules.rs`
- Modify: `crates/drift-engine/src/protocol.rs`

- [ ] **Step 3.1: Add RED test for canonical accepted helper**

Test name:

```rust
canonical_requires_auth_helpers_normalizes_trusted_guard_calls
```

Expected RED command:

```bash
cargo test -p drift-engine canonical_requires_auth_helpers_normalizes_trusted_guard_calls -- --nocapture
```

Expected RED failure: canonical `requires.auth_helpers` is ignored.

- [ ] **Step 3.2: Add RED test for import alias**

Test name:

```rust
accepted_auth_helper_import_alias_is_trusted
```

Scenario:

```text
import { requireUser as requireAuth } from "@/auth";
await requireAuth();
```

Expected RED command:

```bash
cargo test -p drift-engine accepted_auth_helper_import_alias_is_trusted -- --nocapture
```

Expected RED failure: PR #77 scan/check path does not trust accepted helper aliases.

- [ ] **Step 3.3: Add RED test for name-only non-contract helper**

Test name:

```rust
name_only_auth_looking_helper_cannot_satisfy_or_block
```

Expected RED command:

```bash
cargo test -p drift-engine name_only_auth_looking_helper_cannot_satisfy_or_block -- --nocapture
```

Expected RED failure: raw `symbol_called` name can satisfy auth in PR #77.

- [ ] **Step 3.4: Implement normalization**

Implementation requirements:

- `security_patterns.rs` returns trusted guard calls only from accepted contract input plus import facts.
- `security_facts.rs` emits neutral facts; it does not decide final trust from names.
- Legacy `matcher.required_calls` must normalize into the same accepted helper representation and be covered by tests.

Expected GREEN command:

```bash
cargo test -p drift-engine security_
```

## Task 4: Route-Scoped Control Flow And Parser Gaps

**Files:**
- Modify: `crates/drift-engine/src/security_control_flow.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Modify: `crates/drift-engine/tests/security_control_flow.rs`
- Modify: `crates/drift-engine/tests/security_rules.rs`

- [ ] **Step 4.1: Add RED tests for route-scoped handlers**

Required test names:

```rust
separates_get_and_post_auth_proofs_in_one_route_file
conditional_guard_without_else_does_not_dominate_later_sink
callback_guard_does_not_dominate_outer_sink_in_check_proof
dynamic_control_flow_creates_parser_gap_in_check_proof
```

Expected RED command:

```bash
cargo test -p drift-engine security_control_flow -- --nocapture
```

Expected RED failure: current proof logic is file/line based and parser gaps do not flow through the check proof.

- [ ] **Step 4.2: Implement route-scoped summaries**

Implementation requirements:

- Build one proof per route handler/export.
- Attach sinks to the handler they occur in.
- A guard in `GET` cannot dominate `POST`.
- A guard inside callback cannot dominate outer sink.
- A guard inside `if` without a guaranteed else/path cannot dominate later sink.
- Unsupported dynamic control flow emits parser gap and missing proof under blocking contract.

Expected GREEN command:

```bash
cargo test -p drift-engine security_control_flow -- --nocapture
```

## Task 5: Replace Inline Auth Proof In `check_command.rs`

**Files:**
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/security_proof.rs`
- Modify: `crates/drift-engine/src/security_rules.rs`
- Modify: `crates/drift-engine/tests/security_check_repo_auth.rs`

- [ ] **Step 5.1: Delete the inline first-guard auth proof path**

Remove any `check_command.rs` logic that:

- computes `first_guard_line`
- builds `dominated_sinks` from only line comparison
- hard-codes `parser_gaps: []`
- trusts raw `SymbolCalled` names as guards

- [ ] **Step 5.2: Add a focused assertion that `check_repo` uses module proof**

Test name:

```rust
check_repo_uses_security_proof_parser_gaps_and_missing_proofs
```

Expected RED command before implementation:

```bash
cargo test -p drift-engine check_repo_uses_security_proof_parser_gaps_and_missing_proofs -- --nocapture
```

Expected RED failure: `CheckResult.security_boundary_proofs[0].parser_gaps` is empty for unsupported dynamic control flow.

- [ ] **Step 5.3: Implement dispatcher-only `check_command.rs`**

Implementation requirements:

- Convert `CheckConvention` into normalized security auth contract input.
- Pass facts and contract to `security_proof.rs`.
- Pass proof to `security_rules.rs`.
- Map returned findings/proofs into `CheckResult`.
- Keep direct-data-access and service-delegation behavior unchanged.

Expected GREEN commands:

```bash
cargo test -p drift-engine check_repo_uses_security_proof_parser_gaps_and_missing_proofs -- --nocapture
cargo test -p drift-engine graph_backed_check
cargo test -p drift-engine security_
```

## Task 6: Product Output Parser Gaps And Missing Proofs

**Files:**
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `packages/cli/src/check/security-check.ts`
- Modify: `packages/engine-contract/src/index.ts`

- [ ] **Step 6.1: Add RED test for parser gap in `drift check --json`**

Test name:

```ts
it("returns parser-gap-backed auth proof from drift check json for dynamic control flow", async () => {
  // run through runCheck or CLI, not synthetic proof JSON
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED failure: parser gap is missing or malformed in real check JSON.

- [ ] **Step 6.2: Add RED test for missing proof in `drift check --json`**

Test name:

```ts
it("returns missing-proof-backed auth finding from drift check json", async () => {
  // assert missing_proof code, finding id, contract id, route file, enforcement result
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED failure: output lacks complete missing proof/finding linkage.

- [ ] **Step 6.3: Implement output mapping**

Implementation requirements:

- Preserve proof ID, proof status, parser gap IDs, missing proof IDs, finding IDs, route file, contract ID, and capability status.
- Do not include snippets or source values.

Expected GREEN command:

```bash
pnpm --filter @drift/cli test -- security-check
```

## Task 7: Exceptions And Public Route Handling

**Files:**
- Modify: `crates/drift-engine/src/protocol.rs`
- Modify: `crates/drift-engine/src/security_rules.rs`
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `packages/cli/src/engine/engine-check.ts`
- Modify: `packages/cli/test/security-check.test.ts`

- [ ] **Step 7.1: Add RED test for method-specific exception**

Test name:

```ts
it("does not block an auth finding when a method-specific public route exception applies", async () => {
  // GET public exception must not suppress POST unless POST is excepted too
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected RED failure: exception handling is path-only or dropped before Rust.

- [ ] **Step 7.2: Implement exception transport and evaluation**

Implementation requirements:

- Transport path, endpoint, method, helper, and reason fields needed by Rust.
- Do not suppress sibling methods or sibling routes.
- Expired exceptions must not suppress.

Expected GREEN command:

```bash
pnpm --filter @drift/cli test -- security-check
```

## Task 8: Waiver, Baseline, Lifecycle, And Persistence Semantics

**Files:**
- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `crates/drift-engine/src/protocol.rs` only if Rust needs waiver context before finding emission

- [ ] **Step 8.1: Add RED test for active waiver suppression**

Test name:

```ts
it("honors active auth waivers during checks and reports waived security findings", async () => {
  // use real check path and stored waiver
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- "auth waivers"
```

Expected RED failure: auth mapping persists a finding instead of applying waiver semantics.

- [ ] **Step 8.2: Add RED test for baseline `pre_existing`**

Test name:

```ts
it("marks existing auth findings as pre_existing from baseline", async () => {
  // use real baseline table and auth finding fingerprint
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- "existing auth findings"
```

Expected RED failure: auth findings ignore existing baseline semantics.

- [ ] **Step 8.3: Implement lifecycle integration**

Implementation requirements:

- Use existing waiver/baseline/finding status helpers.
- Preserve `accepted_drift`, `suppressed`, `fixed`, and human-governed statuses where existing code does so.
- Do not create a parallel lifecycle model for auth.

Expected GREEN command:

```bash
pnpm --filter @drift/cli test -- security-check
pnpm --filter @drift/cli test
```

## Task 9: Real E2E Fixture Matrix

**Files:**
- Modify: `test/e2e/security-auth.test.ts`
- Modify fixtures:
  - `test/fixtures/security-auth-missing`
  - `test/fixtures/security-auth-before-sink`
  - `test/fixtures/security-auth-after-data`
  - `test/fixtures/security-auth-branch-bypass`
  - `test/fixtures/security-auth-callback-bypass`
  - `test/fixtures/security-dynamic-control-flow`
- Modify: `test/e2e/golden.test.ts`

- [ ] **Step 9.1: Replace fixture-existence test with real enforcement matrix**

Test name:

```ts
it("runs Phase 1 auth fixtures through real drift check enforcement", async () => {
  // each fixture must run scan/start or seeded contract + check path and assert outcome
});
```

Expected RED command:

```bash
pnpm test:e2e -- security-auth
```

Expected RED failure: fixture harness does not yet run real checks or expected outcomes fail.

- [ ] **Step 9.2: Assert each fixture outcome**

Required fixture assertions:

- `security-auth-missing`: blocks with `missing_auth_guard`
- `security-auth-before-sink`: passes
- `security-auth-after-data`: blocks with `guard_after_sink`
- `security-auth-branch-bypass`: blocks with branch bypass/missing proof
- `security-auth-callback-bypass`: blocks with callback boundary
- `security-dynamic-control-flow`: blocks with parser gap

- [ ] **Step 9.3: Strengthen golden coverage**

Replace count-only golden validation with assertions that identify the new fact/proof behavior. The golden test must not only assert `facts_count`.

Expected GREEN command:

```bash
pnpm test:e2e -- security-auth
pnpm test:e2e -- golden
```

## Task 10: Capability Truth

**Files:**
- Modify: `crates/drift-engine/src/security_capabilities.rs`
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/tests/security_capabilities.rs`
- Modify: `packages/cli/src/domain/scan-status.ts` only if check/scan status exposes security capabilities

- [ ] **Step 10.1: Add RED test for auth capabilities in check result**

Test name:

```rust
check_repo_reports_auth_security_capabilities_when_auth_contract_runs
```

Expected RED command:

```bash
cargo test -p drift-engine check_repo_reports_auth_security_capabilities_when_auth_contract_runs -- --nocapture
```

Expected RED failure: result stats/completeness only report `direct_data_access_check`.

- [ ] **Step 10.2: Implement honest capability reporting**

Required capabilities:

- `security_facts`
- `auth_boundary_facts`
- `control_flow_guard_dominance`

Statuses must distinguish:

- `complete`
- `partial`
- `unsupported`
- `failed`

Expected GREEN command:

```bash
cargo test -p drift-engine security_capabilities -- --nocapture
```

## Task 11: Durable Query, Storage, MCP After Proof Stabilizes

Do not start this task until Tasks 1 through 10 are green.

**Files:**
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/storage/test/sqlite-storage.test.ts`
- Modify: `packages/query/src/security-boundary-proof.ts`
- Modify: `packages/query/test/security-boundary-proof.test.ts`
- Modify: `packages/mcp/src/security-context.ts`
- Modify: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 11.1: Add RED storage round-trip test**

Test name:

```ts
it("persists security boundary proof summaries without snippets", () => {
  // round-trip proof id, route, contract id, proof status, parser gaps, missing proof ids, finding ids
});
```

Expected RED command:

```bash
pnpm --filter @drift/storage test -- security
```

Expected RED failure: no durable proof storage/read method exists.

- [ ] **Step 11.2: Add RED query read-model test**

Test name:

```ts
it("builds route security proof read model with capability and parser-gap truth", () => {
  // no snippets, no source values
});
```

Expected RED command:

```bash
pnpm --filter @drift/query test -- security-boundary-proof
```

Expected RED failure: query model is too thin.

- [ ] **Step 11.3: Add RED MCP parity test**

Test name:

```ts
it("exposes auth proof summaries from query truth without duplicating rules", () => {
  // MCP output matches query summary and contains no snippets
});
```

Expected RED command:

```bash
pnpm --filter @drift/mcp test -- security
```

Expected RED failure: MCP does not expose durable proof truth.

- [ ] **Step 11.4: Implement additive persistence and read models**

Implementation requirements:

- Add only additive migrations.
- Persist proof summary, not full source or snippets.
- Query is the shared read source for CLI/MCP.
- MCP remains read-only and rule-free.

Expected GREEN commands:

```bash
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
pnpm --filter @drift/mcp test
```

## Task 12: Output Safety Tests

**Files:**
- Modify: `packages/cli/test/security-check.test.ts`
- Modify: `packages/query/test/security-boundary-proof.test.ts`
- Modify: `packages/storage/test/sqlite-storage.test.ts`
- Modify: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 12.1: Add RED no-leak matrix**

Every output surface must be tested against these strings:

```text
SECRET_VALUE
Authorization: Bearer
Cookie:
process.env
DATABASE_URL
raw-user-id-123
SELECT * FROM users WHERE id = 'raw-user-id-123'
request.body.password
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- security-check
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/storage test -- security
pnpm --filter @drift/mcp test -- security
```

Expected RED failure: at least one surface lacks explicit no-leak coverage.

- [ ] **Step 12.2: Implement redaction/output discipline**

Implementation requirements:

- Evidence references use fact IDs, file paths, stable hashes, line ranges, classifications.
- No snippets or sensitive values in proof/finding/query/MCP output.

Expected GREEN commands:

```bash
pnpm --filter @drift/cli test -- security-check
pnpm --filter @drift/query test -- security-boundary-proof
pnpm --filter @drift/storage test
pnpm --filter @drift/mcp test
```

## Task 13: Human Output Parity

**Files:**
- Modify: `packages/cli/src/formatters/checks.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 13.1: Add RED test for human auth finding output**

Test name:

```ts
it("prints auth proof status, capability, route, and next command in human check output", async () => {
  // no snippets, no secret values
});
```

Expected RED command:

```bash
pnpm --filter @drift/cli test -- "auth proof status"
```

Expected RED failure: human output omits proof/capability/route detail.

- [ ] **Step 13.2: Implement human formatter parity**

Implementation requirements:

- Human output must include contract, route/file, reason, evidence lines, lifecycle, capability, and next command.
- Human output must not include snippets.
- JSON remains the richer machine-readable surface.

Expected GREEN command:

```bash
pnpm --filter @drift/cli test -- "auth proof status"
```

## Task 14: Final Production Gate

Run only after all corrective tasks are green.

- [ ] **Step 14.1: Rust gates**

Run:

```bash
cargo fmt --all -- --check
cargo clippy -p drift-engine --all-targets -- -D warnings
cargo test -p drift-engine security_
cargo test -p drift-engine
```

Expected: all pass.

- [ ] **Step 14.2: TypeScript package gates**

Run:

```bash
pnpm typecheck
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
```

Expected: all pass.

- [ ] **Step 14.3: E2E and diff hygiene**

Run:

```bash
pnpm test:e2e
git diff --check
```

Expected: all pass.

- [ ] **Step 14.4: PR readiness checklist**

Confirm:

- No inline auth proof logic remains in `check_command.rs`.
- Canonical TDD contract shape enforces.
- Legacy contract fields are compatibility-tested.
- Branch/callback/dynamic-flow product-path tests pass.
- Parser gaps and missing proofs appear in real check output.
- Candidate-only evidence cannot block.
- Waiver, baseline, exception, lifecycle behavior is proven for auth.
- Human/JSON/query/MCP outputs are snippet-safe.
- Capability reporting is honest.
- Direct-data-access and service-delegation tests still pass.

## Expected Final State

The corrected PR is production-ready only when:

- `api_route_requires_auth_helper` enforcement in `drift check` depends on Rust proof modules, not inline line-order logic.
- Accepted contract input is the only source of blocking auth truth.
- Unsupported control flow produces parser gaps and blocks under accepted blocking contracts.
- Missing proof is explicit and linked to findings.
- Existing Drift governance semantics continue to work.
- Product-path tests prove every Phase 1 TDD claim.
- Storage/query/MCP are wired only after the proof schema is stable.
