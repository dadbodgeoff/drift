# Security Boundary Phase 8 Production Hardening TDD

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Phase 8 review gaps so CLI/MCP security surfaces are production-ready, proof-run-backed, sanitized, and migration-compatible.

**Architecture:** Rust remains the only source of deterministic security proof truth. TypeScript may validate, persist, query, and render proof payloads, but it must not synthesize proof from raw facts or legacy advisory sections. CLI and MCP must consume shared proof-backed read models and expose identical sanitized truth for scan status, repo map, findings, and security context.

**Tech Stack:** Rust `drift-engine`; TypeScript packages `@drift/core`, `@drift/engine-contract`, `@drift/storage`, `@drift/query`, `@drift/cli`, `@drift/mcp`; SQLite; Vitest; Cargo tests.

---

## Source Inputs

Primary implementation under review:

- Branch: `codex/security-phase8-production`
- Commit: `b7adcb40 Implement security phase 8 proof UX`
- Base: `origin/main`

Primary Phase 8 TDD:

- `docs/architecture/security-boundary-phase8-production-tdd.md`

Original source spec:

- `docs/architecture/security-boundary-enforcement-100-tdd.md`
- Focus: `## Phase 8: CLI And MCP UX`
- Related: `Migration And Compatibility Plan`
- Related: `Fixture Matrix`
- Related: `Verification Commands`

Review findings to fix:

1. MCP v2 security context still spreads legacy raw-fact context into `drift.security.context.v2`.
2. Proof runs are stored under check scan ids, but scan status and repo map query the latest indexed scan id.
3. Phase 1/3/4/5 Rust proof JSON lacks sanitized `evidence_refs`.
4. Phase 6 CSRF/rate-limit missing proof can emit empty `fact_ids`.
5. Query capability status is route-level and hardcoded deterministic/blocking.
6. MCP findings expose full finding payloads.
7. Repo map lacks fallback from proof-run rows to scan-scoped proof rows.
8. Routes with no proof are omitted instead of shown as `unknown`.
9. Next.js route groups are not normalized.
10. Primary Phase 8 TDD is untracked.
11. Missing Phase 8 golden/e2e fixture coverage.
12. Missing direct tests for proof-run persistence and human Phase 8 check blocks.

## Non-Negotiable Production Rules

- Rust proof payloads and proof-run rows are deterministic truth.
- Raw facts may support candidate proposals and diagnostics only. They must not appear as proof.
- MCP `drift.security.context.v2` must be proof-read-model-only.
- CLI and MCP must not duplicate Phase 8 proof logic.
- Candidate evidence must remain non-blocking until accepted.
- Phase 8 output must not expose source snippets, raw URLs with secrets, payloads, headers, cookies, SQL strings/literals, env values, tokens, user IDs, tenant IDs, or full source.
- Actor identity fields such as `accepted_by` must be omitted or redacted from agent-facing security context unless a policy explicitly permits them.
- Old databases with `security_boundary_proofs` rows but no `security_boundary_proof_runs` rows must still render Phase 8 read models.
- New `drift check` proof runs must be discoverable from scan status and repo map after a real scan -> check flow.

## File Map

Rust proof generation:

- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`
- Test: `crates/drift-engine/tests/security_check_repo_auth.rs`
- Test: `crates/drift-engine/tests/security_check_repo_request_validation.rs`
- Test: `crates/drift-engine/tests/security_check_repo_phase4.rs`
- Test: `crates/drift-engine/tests/security_check_repo_phase5.rs`
- Test: `crates/drift-engine/tests/security_phase6.rs`

TypeScript schemas/read models:

- Modify: `packages/core/src/security.ts` only if evidence-ref type needs tightening.
- Modify: `packages/engine-contract/src/index.ts` only if engine proof type needs tightening.
- Modify: `packages/query/src/security-boundary-proof.ts`
- Test: `packages/query/test/security-boundary-proof.test.ts`

Storage and proof lookup:

- Modify: `packages/storage/src/sqlite-storage.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`

CLI:

- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `packages/cli/src/domain/scan-status.ts`
- Modify: `packages/cli/src/domain/repo-map.ts`
- Modify: `packages/cli/src/formatters/checks.ts`
- Test: `packages/cli/test/cli.test.ts`

MCP:

- Modify: `packages/mcp/src/security-context.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/test/mcp.test.ts`

E2E/goldens/docs:

- Modify: `test/e2e/golden.test.ts`
- Modify: `test/e2e/security-auth.test.ts`
- Modify: `test/e2e/security-validation.test.ts`
- Modify: `test/e2e/security-sensitive.test.ts`
- Modify: `test/e2e/security-phase6.test.ts`
- Commit or remove: `docs/architecture/security-boundary-phase8-production-tdd.md`

---

## Task 1: Remove Legacy Raw-Fact Sections From MCP v2

**Files:**

- Modify: `packages/mcp/src/security-context.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing MCP v2 purity test**

Add a test that seeds raw facts and accepted contracts but no proof runs. Call `get_security_context`.

Assertions:

```ts
expect(securityContext.response_schema).toBe("drift.security.context.v2");
expect(securityContext.middleware_coverage).toBeUndefined();
expect(securityContext.request_validation).toBeUndefined();
expect(securityContext.session_trust).toBeUndefined();
expect(securityContext.authorization).toBeUndefined();
expect(securityContext.tenant_scope).toBeUndefined();
expect(securityContext.current_proof_status).toEqual([]);
expect(securityContext.required_proofs).toEqual(expect.any(Array));
expect(JSON.stringify(securityContext)).not.toContain("request.json()");
expect(JSON.stringify(securityContext)).not.toContain("session.user.tenantId");
expect(JSON.stringify(securityContext)).not.toContain("cookie");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/mcp test -- "v2 security context does not include legacy raw-fact sections"
```

Expected: FAIL because `buildSecurityContextPayload` currently merges legacy v1 fields into v2.

- [ ] **Step 3: Fix MCP v2 payload**

In `packages/mcp/src/security-context.ts`, make `buildSecurityContextPayload` return only Phase 8 read-model fields for `drift.security.context.v2`.

Allowed v2 fields:

- `response_schema`
- `repo_id`
- `scan_id`
- `check_id`
- `repo_security_contracts`
- `changed_route_security`
- `routes`
- `required_proofs`
- `current_proof_status`
- `missing_proof_summaries`
- `parser_gap_summaries`
- `security_capabilities`
- `do_not_include`
- `redactions`
- `freshness`
- `next_commands`

Forbidden v2 fields:

- `accepted_contracts`
- `middleware_coverage`
- `request_validation`
- `session_trust`
- `authorization`
- `tenant_scope`
- any section derived directly from raw facts

Keep legacy v1 helper code only if older tests still need it through a separate v1 path. Do not spread it into v2.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @drift/mcp test -- "v2 security context does not include legacy raw-fact sections"
pnpm --filter @drift/mcp test
```

Expected: PASS.

---

## Task 2: Make Proof Runs Discoverable After Real Check Runs

**Files:**

- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/cli/src/domain/scan-status.ts`
- Modify: `packages/cli/src/domain/repo-map.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing storage lookup test**

Add a storage test proving proof runs can be listed by repo even when the proof-run `scan_id` is a check scan id and the indexed scan id is different.

Required fixture:

- Indexed scan: `scan_indexed`
- Check run: `check_security`
- Check proof-run row: `scan_id = "scan_check_security"`
- Proof route file: `app/api/users/route.ts`

Assertions:

```ts
const latestRows = storage.listLatestSecurityBoundaryProofRunsForRepo({
  repo_id: "repo_security",
  file_path: "app/api/users/route.ts"
});
expect(latestRows).toHaveLength(1);
expect(latestRows[0]?.check_id).toBe("check_security");
expect(latestRows[0]?.scan_id).toBe("scan_check_security");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/storage test -- "lists latest security boundary proof runs by repo across check scan ids"
```

Expected: FAIL because no repo-scoped latest proof-run lookup exists.

- [ ] **Step 3: Implement repo-scoped latest proof-run lookup**

Add a storage method with this shape:

```ts
listLatestSecurityBoundaryProofRunsForRepo(options: {
  repo_id: string;
  file_path?: string;
  check_id?: string;
}): StoredSecurityBoundaryProofRun[]
```

Rules:

- If `check_id` is provided, filter by it.
- If `file_path` is provided, filter affected files by exact repo-relative path.
- Otherwise return rows from the latest completed check run for that repo.
- Sort deterministically by `created_at DESC`, `check_id DESC`, `proof_id ASC`.
- Do not infer proof from scan facts.

- [ ] **Step 4: Update scan status and repo map**

Use repo-scoped proof-run lookup in:

- `packages/cli/src/domain/scan-status.ts`
- `packages/cli/src/domain/repo-map.ts`
- `packages/mcp/src/index.ts`

Behavior:

- Prefer latest proof-run rows for the repo.
- If no proof runs exist, fall back to scan-scoped proof rows from the latest indexed scan.
- If neither exists, return empty capability array and unknown/no-proof route states where route metadata exists.

- [ ] **Step 5: Write failing scan -> check -> scan status/repo map tests**

In `packages/cli/test/cli.test.ts`, add an e2e-style unit test that runs:

```text
drift scan repo --repo-root <fixture> --repo <repo_id> --actor test --json
drift check --repo <repo_id> --json
drift scan status --repo <repo_id> --json
drift repo map --repo <repo_id> --json
```

Assertions:

```ts
expect(scanStatus.security_capabilities.length).toBeGreaterThan(0);
expect(repoMap.routes.length).toBeGreaterThan(0);
expect(repoMap.routes[0].security).toBeDefined();
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm --filter @drift/storage test -- "latest security boundary proof runs"
pnpm --filter @drift/cli test -- "scan status and repo map use check-run proof rows"
pnpm --filter @drift/mcp test -- "scan status and repo map use check-run proof rows"
```

Expected: PASS.

---

## Task 3: Add Sanitized Evidence Refs To All Rust Proof Families

**Files:**

- Modify: `crates/drift-engine/src/check_command.rs`
- Test: `crates/drift-engine/tests/security_check_repo_auth.rs`
- Test: `crates/drift-engine/tests/security_check_repo_request_validation.rs`
- Test: `crates/drift-engine/tests/security_check_repo_phase4.rs`
- Test: `crates/drift-engine/tests/security_check_repo_phase5.rs`

- [ ] **Step 1: Write failing per-family evidence tests**

Add one assertion helper in each relevant Rust test file or shared local helper:

```rust
fn assert_evidence_refs_are_sanitized(proof: &serde_json::Value) {
    let refs = proof["evidence_refs"].as_array().expect("evidence_refs array");
    assert!(!refs.is_empty(), "expected evidence refs");
    for evidence in refs {
        assert!(evidence["file_path"].as_str().is_some());
        assert!(evidence["start_line"].as_u64().is_some());
        assert!(evidence["end_line"].as_u64().is_some());
        assert!(evidence.get("source").is_none());
        assert!(evidence.get("source_text").is_none());
        assert!(evidence.get("snippet").is_none());
        assert!(evidence.get("value").is_none());
        assert!(evidence.get("raw_url").is_none());
        assert!(evidence.get("headers").is_none());
        assert!(evidence.get("cookies").is_none());
        assert!(evidence.get("sql").is_none());
        assert!(evidence.get("env").is_none());
        assert!(evidence.get("token").is_none());
        assert!(evidence.get("user_id").is_none());
        assert!(evidence.get("tenant_id").is_none());
    }
}
```

Cover proof families:

- auth helper
- middleware coverage
- request validation
- session trust
- authorization
- tenant scope
- sensitive response fields
- secret exposure

- [ ] **Step 2: Verify RED**

Run:

```bash
cargo test -p drift-engine security_phase8_evidence_refs -- --nocapture
```

Expected: FAIL for proof families that do not emit top-level `evidence_refs`.

- [ ] **Step 3: Implement Rust evidence ref helper**

In `crates/drift-engine/src/check_command.rs`, add a single helper that converts known proof facts/guards/sinks into line-only evidence refs.

Required shape:

```json
{
  "id": "evidence:<stable-id>",
  "kind": "proof_line",
  "file_path": "apps/web/app/api/users/route.ts",
  "start_line": 12,
  "end_line": 12,
  "fact_ids": ["fact_auth_guard"],
  "redaction_state": "line_only"
}
```

Rules:

- Include file path and lines.
- Include fact ids when available.
- Include guard/sink ids only if they are stable ids and not raw values.
- Never include snippets, argument values, URLs, SQL strings, header names/values, cookies, env values, user IDs, or tenant IDs.
- Use the same helper across Phase 1/3/4/5 proof generation.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cargo test -p drift-engine security_phase8_evidence_refs -- --nocapture
cargo test -p drift-engine security_rules
```

Expected: PASS.

---

## Task 4: Anchor Phase 6 CSRF And Rate-Limit Missing Proof

**Files:**

- Modify: `crates/drift-engine/src/security_phase6.rs`
- Test: `crates/drift-engine/tests/security_phase6.rs`

- [ ] **Step 1: Write failing CSRF/rate-limit fact-id tests**

Extend existing tests:

- `csrf_helper_after_mutation_sink_does_not_prove_safety`
- `rate_limit_helper_after_response_sink_does_not_prove_safety`
- mutation route without accepted CSRF proof
- login route without accepted rate-limit proof

Assertions:

```rust
let missing = proof["missing_proof"].as_array().unwrap();
let target = missing.iter().find(|entry| entry["capability"] == "csrf").unwrap();
assert!(!target["fact_ids"].as_array().unwrap().is_empty());
```

and:

```rust
let target = missing.iter().find(|entry| entry["capability"] == "rate_limit").unwrap();
assert!(!target["fact_ids"].as_array().unwrap().is_empty());
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cargo test -p drift-engine --test security_phase6 csrf_helper_after_mutation_sink_does_not_prove_safety -- --nocapture
cargo test -p drift-engine --test security_phase6 rate_limit_helper_after_response_sink_does_not_prove_safety -- --nocapture
```

Expected: FAIL because `fact_ids` can be empty.

- [ ] **Step 3: Fix missing proof construction**

In `crates/drift-engine/src/security_phase6.rs`, ensure CSRF and rate-limit missing proof entries include:

- mutation/response sink fact ids
- guard fact ids when a non-dominating guard exists
- route handler fact ids when no guard exists but route/sink fact is present

Never add raw request payload, method body, SQL, cookie, token, user id, or tenant id.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cargo test -p drift-engine --test security_phase6
```

Expected: PASS.

---

## Task 5: Fix Capability Status Semantics

**Files:**

- Modify: `packages/query/src/security-boundary-proof.ts`
- Test: `packages/query/test/security-boundary-proof.test.ts`

- [ ] **Step 1: Write failing mixed-capability route test**

Seed one route proof with:

- `auth` proven
- `request_validation` missing proof
- `capability_status` containing one complete deterministic capability and one partial deterministic capability
- one accepted convention with `deterministic_check`
- one accepted convention with `heuristic_check`

Assertions:

```ts
expect(route.security).toEqual(expect.arrayContaining([
  expect.objectContaining({
    name: "control_flow_guard_dominance",
    status: "complete",
    capability: "deterministic_check",
    can_block: true
  }),
  expect.objectContaining({
    name: "request_validation",
    status: "partial",
    capability: "deterministic_check",
    can_block: true
  }),
  expect.objectContaining({
    name: "candidate_only_signal",
    capability: "heuristic_check",
    can_block: false
  })
]));
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/query test -- "mixed capability route status"
```

Expected: FAIL because route-level `proof.result.proof_status` bleeds into unrelated capabilities and capability type is hardcoded.

- [ ] **Step 3: Fix read model status derivation**

Rules:

- Match status by normalized `proof.capability_status[].name`.
- Use `proof.missing_proof[].capability` only for that capability.
- Use `proof.parser_gaps[].capability` only for that capability.
- Use accepted convention metadata for `capability`.
- `can_block` is true only when an accepted matched convention is `deterministic_check` and enforcement mode is `block`.
- Heuristic and briefing capabilities must always have `can_block: false`.
- Route-level `proof.result.proof_status` may summarize the whole proof, but must not overwrite individual capability status.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @drift/query test
```

Expected: PASS.

---

## Task 6: Sanitize MCP Findings

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing finding leak test**

Seed a finding with:

- `message` containing `session=secret`
- `evidence_refs[].import_source`
- `evidence_refs[].symbol`
- `evidence_refs[].fact_ids`
- any available source-like field

Call `get_findings`.

Assertions:

```ts
const serialized = JSON.stringify(result);
expect(serialized).not.toContain("session=secret");
expect(serialized).not.toContain("@/lib/prisma");
expect(serialized).not.toContain("raw_sql");
expect(result.findings[0]).toEqual(expect.objectContaining({
  finding_id: expect.any(String),
  title: expect.any(String),
  severity: expect.any(String),
  lifecycle: expect.any(String),
  file_refs: expect.any(Array)
}));
expect(result.findings[0].message).toBeUndefined();
expect(result.findings[0].evidence_refs).toBeUndefined();
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/mcp test -- "get_findings sanitizes finding payloads"
```

Expected: FAIL because MCP returns full findings.

- [ ] **Step 3: Add sanitized finding DTO**

Return only:

```ts
type McpFindingSummary = {
  finding_id: string;
  convention_id: string;
  title: string;
  severity: string;
  lifecycle: string;
  diff_status: string;
  enforcement_result: string;
  file_refs: Array<{
    file_path: string;
    start_line?: number;
    end_line?: number;
    redaction_state: "line_only" | "metadata_only";
  }>;
};
```

Do not include:

- `message`
- raw `evidence_refs`
- `import_source`
- `symbol`
- `fact_ids`
- snippets
- source text
- SQL
- URLs
- cookies
- env values
- tokens
- user IDs
- tenant IDs

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @drift/mcp test
```

Expected: PASS.

---

## Task 7: Add Scan-Scoped Proof Fallback

**Files:**

- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/cli/src/domain/scan-status.ts`
- Modify: `packages/cli/src/domain/repo-map.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing old-row fallback tests**

Seed:

- latest indexed scan `scan_old`
- rows in `security_boundary_proofs` from migration 023
- no rows in `security_boundary_proof_runs`

Assertions:

```ts
expect(scanStatus.security_capabilities.length).toBeGreaterThan(0);
expect(repoMap.routes.length).toBeGreaterThan(0);
expect(repoMap.routes[0].security).toBeDefined();
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/cli test -- "falls back to scan-scoped security boundary proofs"
pnpm --filter @drift/mcp test -- "falls back to scan-scoped security boundary proofs"
```

Expected: FAIL because surfaces emit empty arrays without proof-run rows.

- [ ] **Step 3: Implement fallback helper**

Create a shared helper in query or storage-facing domain code:

```ts
function securityProofsForPhase8Surface(input: {
  storage: SqliteDriftStorage;
  repo_id: string;
  latest_scan_id: string | null;
  file_path?: string;
  check_id?: string;
}): {
  check_id: string | null;
  proofs: SecurityBoundaryProof[];
  source: "proof_run" | "scan_scoped" | "none";
}
```

Rules:

- Prefer proof runs.
- Fall back to scan-scoped proofs from latest indexed scan.
- Return `source` for diagnostics/tests.
- Do not use raw facts.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @drift/cli test -- "falls back to scan-scoped security boundary proofs"
pnpm --filter @drift/mcp test -- "falls back to scan-scoped security boundary proofs"
```

Expected: PASS.

---

## Task 8: Emit Unknown Route Security For Known Routes With No Proof

**Files:**

- Modify: `packages/query/src/security-boundary-proof.ts`
- Modify: `packages/cli/src/domain/repo-map.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/query/test/security-boundary-proof.test.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing unknown-route test**

Build a Phase 8 read model with known route metadata:

```ts
known_routes: [{
  route_id: "route:GET:apps/web/app/api/users/route.ts",
  file_path: "apps/web/app/api/users/route.ts",
  method: "GET",
  path: "/api/users",
  file_role: "api_route"
}]
```

No proofs.

Assertions:

```ts
expect(model.routes).toEqual([expect.objectContaining({
  route_id: "route:GET:apps/web/app/api/users/route.ts",
  path: "/api/users",
  method: "GET",
  security: [expect.objectContaining({
    proof_status: "unknown",
    reason: "no_security_proof"
  })]
})]);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/query test -- "known routes without proof are emitted as unknown"
```

Expected: FAIL because routes are emitted only from proofs.

- [ ] **Step 3: Pass known route metadata into read model**

Add optional input:

```ts
known_routes?: Array<{
  route_id: string;
  file_path: string;
  path?: string;
  method?: string;
  file_role?: string;
}>;
```

Use repo map graph route data to populate it in CLI/MCP repo map.

Rules:

- Proof routes override known routes.
- Known routes without proof emit `unknown`.
- Do not parse source files in query.
- Do not infer security proof from graph facts.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/cli test -- "repo map emits unknown route security without proof"
```

Expected: PASS.

---

## Task 9: Normalize Next.js Route Groups

**Files:**

- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`
- Test: `crates/drift-engine/tests/security_check_repo_auth.rs`
- Test: `crates/drift-engine/tests/security_phase6.rs`

- [ ] **Step 1: Write failing route-group tests**

Add route fixture:

```text
app/api/(admin)/users/route.ts
```

Expected endpoint:

```json
{ "path": "/api/users", "method": "GET", "framework": "next" }
```

Assertions in auth and Phase 6 proof tests:

```rust
assert_eq!(proof["route"]["endpoint"]["path"], "/api/users");
assert_eq!(proof["route"]["endpoint"]["method"], "GET");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cargo test -p drift-engine route_group_endpoint -- --nocapture
```

Expected: FAIL because route group segment appears in route path.

- [ ] **Step 3: Centralize route path normalization**

Create one Rust helper used by all proof families:

```rust
fn next_route_path(file_path: &str) -> Option<String>
```

Rules:

- Strip `app/`.
- Strip trailing `/route.ts`, `/route.tsx`, `/route.js`, `/route.jsx`.
- Keep `/api`.
- Drop route group segments matching `(name)`.
- Convert dynamic segments `[id]` to `:id` only if existing route semantics already do that. If not, preserve existing dynamic behavior and only strip groups.
- Return `None` for unsupported non-route files.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
cargo test -p drift-engine route_group_endpoint -- --nocapture
cargo test -p drift-engine security_rules
cargo test -p drift-engine --test security_phase6
```

Expected: PASS.

---

## Task 10: Redact Actor Identity From Security Read Models

**Files:**

- Modify: `packages/query/src/security-boundary-proof.ts`
- Test: `packages/query/test/security-boundary-proof.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing accepted_by redaction test**

Seed accepted convention:

```ts
{
  accepted_by: "geoffrey@example.com",
  accepted_at: "2026-05-27T00:00:00.000Z"
}
```

Assertions:

```ts
expect(JSON.stringify(model)).not.toContain("geoffrey@example.com");
expect(model.repo_security_contracts[0].accepted_by).toBeUndefined();
expect(model.repo_security_contracts[0].accepted_at).toBe("2026-05-27T00:00:00.000Z");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/query test -- "redacts accepted_by from security read model"
```

Expected: FAIL if actor identity is still exposed.

- [ ] **Step 3: Remove or redact `accepted_by`**

Rules:

- Omit `accepted_by` from Phase 8 agent-facing read models.
- Keep timestamps if useful and non-sensitive.
- Do not mutate stored contracts.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @drift/query test
pnpm --filter @drift/mcp test
```

Expected: PASS.

---

## Task 11: Add Human Check Block Tests

**Files:**

- Modify: `packages/cli/src/formatters/checks.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing human output test**

Run `drift check` without `--json` against a fixture with a blocking security proof.

Assertions:

```ts
expect(result.stdout).toContain("Security proof");
expect(result.stdout).toContain("Route:");
expect(result.stdout).toContain("File:");
expect(result.stdout).toContain("Reason:");
expect(result.stdout).toContain("Evidence:");
expect(result.stdout).toContain("Capability:");
expect(result.stdout).toContain("Lifecycle:");
expect(result.stdout).toContain("Next:");
expect(result.stdout).not.toContain("request.json()");
expect(result.stdout).not.toContain("session=secret");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @drift/cli test -- "human check renders Phase 8 security proof block"
```

Expected: FAIL if human output is missing any required block field.

- [ ] **Step 3: Fix formatter**

Make the human block render from `security_boundary_proofs` only.

Required fields:

- route path + method
- file
- reason
- evidence line refs
- capability
- lifecycle/finding status
- next command

Never render source snippets or raw proof internals.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @drift/cli test -- "human check renders Phase 8 security proof block"
pnpm --filter @drift/cli test
```

Expected: PASS.

---

## Task 12: Add Phase 8 Golden/E2E Fixture

**Files:**

- Modify: `test/e2e/golden.test.ts`
- Modify: `test/e2e/security-auth.test.ts`
- Modify: `test/e2e/security-validation.test.ts`
- Modify: `test/e2e/security-sensitive.test.ts`
- Modify: `test/e2e/security-phase6.test.ts`

- [ ] **Step 1: Write failing e2e proof-surface test**

Add an e2e fixture that runs:

```bash
drift scan repo --repo-root <fixture> --actor test --json
drift check --repo <repo_id> --json
drift check --repo <repo_id>
drift scan status --repo <repo_id> --json
drift repo map --repo <repo_id> --json
drift candidates --repo <repo_id> --json
```

Assertions:

```ts
expect(checkJson.security_boundary_proofs.length).toBeGreaterThan(0);
expect(checkHuman.stdout).toContain("Security proof");
expect(scanStatus.security_capabilities.length).toBeGreaterThan(0);
expect(repoMap.routes.some((route) => route.security?.length > 0)).toBe(true);
expect(candidates.candidates.every((candidate) => candidate.reason_not_blocking)).toBe(true);
expect(serialized).not.toContain("session=secret");
expect(serialized).not.toContain("request.json()");
expect(serialized).not.toContain("process.env");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm test:e2e -- security Phase 8 production proof surfaces
```

Expected: FAIL until Tasks 1-11 are complete.

- [ ] **Step 3: Update goldens intentionally**

Update any schema-version expectations from 24 to 25 only where migration 025 is genuinely expected.

Do not reduce goldens to old fields. Golden output must assert:

- `security_boundary_proofs`
- `security_capabilities[]`
- `routes[].security`
- candidate non-blocking metadata
- no sensitive output

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm test:e2e
```

Expected: PASS.

---

## Task 13: Resolve Primary TDD Doc State

**Files:**

- Add or intentionally remove: `docs/architecture/security-boundary-phase8-production-tdd.md`

- [ ] **Step 1: Decide source-control state**

If the Phase 8 TDD is the review contract, commit it. If it is local scratch, remove it from the worktree.

Production rule:

```bash
git status --short
```

must not show:

```text
?? docs/architecture/security-boundary-phase8-production-tdd.md
```

- [ ] **Step 2: Verify**

Run:

```bash
git status --short --branch
```

Expected: no untracked Phase 8 TDD doc.

---

## Task 14: Full Verification Gate

- [ ] **Step 1: Run focused RED/GREEN tests from this TDD**

Run:

```bash
cargo test -p drift-engine security_phase8_evidence_refs -- --nocapture
cargo test -p drift-engine route_group_endpoint -- --nocapture
cargo test -p drift-engine --test security_phase6
pnpm --filter @drift/storage test -- "security boundary proof runs"
pnpm --filter @drift/query test -- "security"
pnpm --filter @drift/cli test -- "Phase 8"
pnpm --filter @drift/mcp test -- "security"
```

Expected: PASS.

- [ ] **Step 2: Run required production verification**

Run:

```bash
git status --short --branch
git diff --stat origin/main...HEAD
git diff --check
cargo test -p drift-engine security_facts
cargo test -p drift-engine security_control_flow
cargo test -p drift-engine security_rules
cargo test -p drift-engine security_proof
cargo test -p drift-engine --test security_phase6
cargo test -p drift-engine --test candidate_inference
cargo test -p drift-engine
pnpm --filter @drift/core test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/factgraph test
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

Expected: every command exits 0.

- [ ] **Step 3: Final production readiness review**

Before merge, run a six-lane review against the final diff and verify these are false:

- MCP v2 contains legacy raw-fact sections.
- scan status or repo map are empty after a real `drift check`.
- any proof family lacks sanitized `evidence_refs`.
- CSRF/rate-limit missing proof has empty `fact_ids`.
- capability status is route-level rather than capability-level.
- MCP findings expose full finding payloads.
- old scan-scoped proof rows disappear from Phase 8 surfaces.
- known routes without proof are omitted.
- route groups appear in endpoint paths.
- `accepted_by` appears in agent-facing security read models.
- untracked Phase 8 TDD docs remain.

Expected: all false.

## Final Acceptance Criteria

The branch is production-ready only when:

- `drift.security.context.v2` is proof-read-model-only.
- `drift scan status --json.security_capabilities[]` is non-empty after real proof-producing checks.
- `drift repo map --json.routes[].security` is proof-backed or explicitly `unknown`.
- `drift check` human output includes sanitized Phase 8 security blocks.
- Every Rust proof family emits sanitized `evidence_refs`.
- Phase 6 missing proof entries include deterministic fact anchors.
- MCP findings are sanitized DTOs.
- Old scan-scoped proof rows are compatible.
- Next.js route groups are normalized.
- Candidate output remains non-blocking until accepted.
- Full verification, including `pnpm verify:ci`, passes.
