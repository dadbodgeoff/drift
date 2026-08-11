# Security Boundary Phase 8 Production TDD

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 8 as a production-ready CLI/MCP proof-truth surface for Drift security boundary enforcement.

**Architecture:** Rust owns deterministic security proof truth, parser gaps, missing proof, capability completeness, route/method/file-role binding, and blocking. TypeScript stores, validates, queries, and renders Rust proof; it must not synthesize proof from raw facts or candidate evidence. CLI and MCP consume one shared proof-backed read model so humans and agents see the same sanitized security state.

**Tech Stack:** Rust `drift-engine`; TypeScript packages `@drift/core`, `@drift/engine-contract`, `@drift/storage`, `@drift/query`, `@drift/cli`, `@drift/mcp`; SQLite storage; Vitest; Cargo tests.

---

## Source Of Truth

Primary spec:

- `docs/architecture/security-boundary-enforcement-100-tdd.md`
- Section: `## Phase 8: CLI And MCP UX`
- Related section: `## Migration And Compatibility Plan`
- Related section: `## Fixture Matrix`
- Related section: `## Verification Commands`

Current P1-P7 state:

- `origin/main` already contains Phase 1 through Phase 7 work.
- Start implementation from fresh `origin/main`, not from a stale merged feature branch.
- Existing `security_boundary_proofs` are returned by `drift check --json`.
- Existing MCP security context still reads raw facts for several sections and must be corrected.
- Existing `scan status --json` exposes `security_capabilities`, but not the required Phase 8 array shape.
- Existing repo map has fact-derived `route_security`, which must remain advisory or be replaced by proof-backed summaries.
- Existing candidate election flow exists under `drift conventions ...`; Phase 8 requires `drift candidates --json`.

## Accuracy Notes From Live Repo Verification

This TDD was checked against the live tree on May 27, 2026. The architecture, file targets, and missing Phase 8 surfaces match current code, with these implementation details:

- `origin/main` is tree-equivalent to the current Phase 7 branch and is ahead only by merge commits. Start new work from `origin/main`.
- Current Rust tests in `crates/drift-engine/tests/security_check_repo_auth.rs` use local helpers such as `temp_repo`, `run_check_repo`, `fact`, and fixture builders. Do not paste new Rust snippets that reference `security_repo_with_route`, `accepted_auth_contract`, or `check_repo_with_contracts` unless those helpers are added in the same test file.
- Current Phase 6 Rust tests in `crates/drift-engine/tests/security_phase6.rs` already have `phase6_proof`, `phase6_ssrf_contract`, `phase6_raw_sql_contract`, `phase6_cors_contract`, `phase6_csrf_contract`, and `phase6_rate_limit_contract`. Use those helpers instead of inventing `phase6_violation_proof_for_source`.
- Current TypeScript tests do not have global helpers named `securityProofFixture`, `securityBoundaryProofFixture`, `seedCheckedSecurityRepo`, `runCliJson`, `callTool`, or `runSecurityFixture`. If a task uses those names, add local helpers in the same test file or replace them with existing test harness helpers in that package.
- `SecurityBoundaryProofSchema` currently allows optional `route.endpoint.path` and `route.endpoint.method`. Phase 8 should keep those optional for old stored rows, while requiring new Rust output to populate them for supported routes.
- `security_boundary_proofs` exists today as migration `023_security_boundary_proofs`, but it is scan-scoped and keyed by `proof_id`. It is not check-run-bound. The `025_security_boundary_proof_runs` migration below is required for production-grade exact check-run reporting, not because the current table is absent.
- `drift scan status --json.security_capabilities` already exists today, but it is object-shaped and capability-report-backed. Phase 8 requires the array shape below and must derive security proof counts from proof runs, not raw scan facts.
- `buildSecurityBoundaryProofReadModel` exists today. Phase 8 should extend it or add a sibling builder; do not create duplicate proof logic in CLI or MCP.
- `get_security_context` exists today and returns `drift.security.context.v1`. It currently uses raw facts for several sections. Phase 8 must introduce proof-backed `drift.security.context.v2`.

## Non-Negotiable Boundaries

1. Rust owns deterministic proof.
2. TypeScript must not convert raw facts into proof.
3. Accepted contracts are the only enforcement contract source of truth.
4. Candidates and heuristic evidence may brief or propose. They never block.
5. File-global proof is forbidden.
6. Proof must be route-bound, method-bound, file-role-bound, contract-bound, and check-run-bound.
7. Wrong import path with matching local name must not satisfy proof.
8. Parser gaps under blocking contracts must produce missing proof and fail closed in changed scope.
9. CLI/MCP/storage must not expose source snippets, raw URLs with secrets, payloads, headers, cookies, SQL strings/literals, env values, tokens, user IDs, tenant IDs, or full source.
10. CLI and MCP must use query/read-model functions. They must not duplicate proof logic.

## Production Contract Model

### Accepted Security Convention

Use existing `AcceptedConvention` as the election result. For Phase 8, every accepted security convention exposed to agents must be summarized from this shape only:

```ts
type SecurityConventionKind =
  | "api_route_requires_auth_helper"
  | "middleware_must_cover_routes"
  | "api_route_requires_request_validation"
  | "session_object_must_come_from_trusted_helper"
  | "api_route_requires_authorization"
  | "api_route_requires_tenant_scope"
  | "api_route_forbids_sensitive_response_fields"
  | "api_route_forbids_secret_exposure"
  | "api_route_forbids_untrusted_ssrf"
  | "api_route_forbids_raw_sql_without_params"
  | "api_route_cors_must_match_policy"
  | "api_route_requires_csrf_for_mutation"
  | "api_route_requires_rate_limit";
```

Accepted security conventions must include:

```ts
type AcceptedSecurityConventionSummary = {
  convention_id: string;
  kind: SecurityConventionKind;
  enforcement_mode: "brief" | "warn" | "block";
  capability: "deterministic_check" | "heuristic_check" | "briefing_only";
  matcher_summary: string;
  route_scope: {
    file_roles: string[];
    paths?: string[];
    methods?: string[];
  };
  trusted_helpers: Array<{
    helper_id: string;
    symbol: string;
    module?: string;
    import?: string;
  }>;
  requires_summary: string[];
  accepted_by?: string;
  accepted_at?: string;
  updated_at?: string;
  expires_at?: string;
};
```

Rules:

- `trusted_helpers` may include helper symbols and module paths because accepted contracts already expose these. It must not include argument values, request payloads, SQL, headers, cookies, env values, user IDs, tenant IDs, or source snippets.
- `matcher_summary` must be generated from accepted matcher fields, not from raw source code.
- `requires_summary` must use allowlisted phrases such as `auth helper must dominate data and response sinks`.

### Candidate Election Contract

Phase 8 must expose candidates without bypassing elections.

Required CLI aliases:

```text
drift candidates --repo <repo_id> --json
drift candidates --repo <repo_id> --kind <kind> --json
drift candidates show <candidate_id> --repo <repo_id> --json
drift candidates accept <candidate_id> --repo <repo_id> --mode warn --confirm
drift candidates reject <candidate_id> --repo <repo_id> --reason "not a repo convention"
```

Alias behavior:

- `drift candidates` is an alias for the current candidate listing path under `drift conventions list`.
- `drift candidates show` aliases `drift conventions show`.
- `drift candidates accept` aliases `drift conventions accept`.
- `drift candidates reject` aliases `drift conventions reject`.
- Existing `drift conventions ...` commands remain valid.

Election rules:

- Candidate default mode remains `warn` or `brief`.
- Candidate output must include `candidate_id`, `kind`, `confidence_label`, `suggested_enforcement_mode`, `enforcement_capability`, `supporting_examples_count`, `counterexamples_count`, `evidence_refs`, and `reason_not_blocking`.
- Rejected candidates must not be re-proposed without changed evidence fingerprint.
- Accepted candidate materialization must preserve accepted evidence refs and counterexample refs.
- `--mode block` must be rejected unless the accepted convention kind and required capability are deterministic.
- Candidate `requires` can be displayed only as sanitized JSON from candidate payloads. It must not be enriched from raw facts.

## Required Phase 8 Schemas

### Security Proof Route Metadata

Extend the existing `SecurityBoundaryProofSchema.route` in both:

- `packages/core/src/security.ts`
- `packages/engine-contract/src/index.ts`

Route path and method remain optional for backward compatibility, but new Rust proof output must always populate them for supported API routes.

```ts
type SecurityProofRoute = {
  route_id: string;
  file_path: string;
  file_role: "api_route";
  endpoint?: {
    path?: string;
    method?: string;
    framework?: string;
  };
  handler_symbol?: string;
  start_line?: number;
  end_line?: number;
  diff_status?: "unchanged" | "added" | "modified" | "deleted" | "renamed";
};
```

Production invariant:

- If `file_role` is `api_route` and route path/method are statically supported, Rust must emit `endpoint.path` and `endpoint.method`.
- TypeScript may render `unknown` if old rows lack these fields. It must not parse `route_id` or file path as proof.

### Security Evidence Reference

Add a sanitized evidence reference object inside each proof.

```ts
type SecurityProofEvidenceRef = {
  evidence_id: string;
  fact_id?: string;
  graph_edge_id?: string;
  capability: string;
  kind: string;
  file_path: string;
  start_line?: number;
  end_line?: number;
  role: "guard" | "sink" | "validator" | "serializer" | "middleware" | "policy" | "parser_gap" | "missing_proof";
};
```

Add optional field:

```ts
evidence_refs?: SecurityProofEvidenceRef[];
```

Rules:

- No `source`, `snippet`, `value`, `literal`, `payload`, `header`, `cookie`, `sql`, `url`, `env`, `token`, `user_id`, or `tenant_id` fields.
- Evidence refs must be generated by Rust.
- TypeScript may filter, group, and render these refs. It must not create new proof evidence from raw facts.

### Stored Security Boundary Proof Run

The existing `security_boundary_proofs` table is scan-scoped and keyed by `proof_id`. That is not enough for production Phase 8 because human check output, MCP context, and scan status need to explain the exact check run that produced the proof.

Add migration `025_security_boundary_proof_runs` with a new additive table. Do not rewrite the existing table.

```sql
CREATE TABLE IF NOT EXISTS security_boundary_proof_runs (
  storage_id TEXT PRIMARY KEY,
  proof_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  scan_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  contract_kinds_json TEXT NOT NULL,
  capability_names_json TEXT NOT NULL,
  proof_status TEXT NOT NULL,
  enforcement_result TEXT NOT NULL,
  parser_gap_count INTEGER NOT NULL,
  missing_proof_count INTEGER NOT NULL,
  affected_files_json TEXT NOT NULL,
  proof_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_unique
  ON security_boundary_proof_runs(check_id, proof_id);

CREATE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_repo_scan
  ON security_boundary_proof_runs(repo_id, scan_id);

CREATE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_repo_check
  ON security_boundary_proof_runs(repo_id, check_id);

CREATE INDEX IF NOT EXISTS idx_security_boundary_proof_runs_repo_route
  ON security_boundary_proof_runs(repo_id, route_id);
```

Storage type:

```ts
type StoredSecurityBoundaryProofRun = {
  storage_id: string;
  proof_id: string;
  repo_id: string;
  scan_id: string;
  check_id: string;
  route_id: string;
  file_path: string;
  contract_kinds: string[];
  capability_names: string[];
  proof_status: "proven" | "violated" | "missing_proof" | "parser_gap" | "advisory_only";
  enforcement_result: "pass" | "brief" | "warn" | "block";
  parser_gap_count: number;
  missing_proof_count: number;
  affected_files: string[];
  proof: SecurityBoundaryProof;
  created_at: string;
};
```

Storage methods:

```ts
upsertSecurityBoundaryProofRuns(input: {
  repo_id: string;
  scan_id: string;
  check_id: string;
  proofs: SecurityBoundaryProof[];
  created_at: string;
}): void;

listSecurityBoundaryProofRuns(input: {
  repo_id: string;
  scan_id?: string;
  check_id?: string;
  file_path?: string;
  route_id?: string;
  contract_kind?: string;
  latest_only?: boolean;
}): StoredSecurityBoundaryProofRun[];
```

Compatibility:

- Keep `upsertSecurityBoundaryProofs` and `listSecurityBoundaryProofs` working.
- New read models should prefer proof runs and fall back to scan-scoped proofs if no proof runs exist.
- Existing databases with no proof rows remain valid.
- Old proof JSON must continue parsing. New schema fields must be optional/defaulted in TypeScript.

### Security Capability Summary

Phase 8 `drift scan status --json` must expose an array:

```ts
type SecurityCapabilitySummary = {
  name: string;
  capability: "deterministic_check" | "heuristic_check" | "briefing_only";
  status: "complete" | "partial" | "missing" | "unsupported";
  can_block: boolean;
  parser_gap_count: number;
  missing_proof_count: number;
  affected_files: string[];
};
```

Derivation rules:

- Prefer latest proof runs for the latest scan.
- Count parser gaps and missing proof from `SecurityBoundaryProof.parser_gaps` and `SecurityBoundaryProof.missing_proof`.
- `affected_files` is the sorted unique set of proof route files and parser gap files.
- `status = complete` only when every matching proof for that capability is proven and no blocking parser gaps or missing proof exist.
- `status = partial` when supported proof exists but at least one route has missing proof, parser gap, warning, or block.
- `status = missing` when an accepted blocking/warn contract requires capability but no proof run exists.
- `status = unsupported` when engine contract/version says the capability is not supported.
- TypeScript must not inspect raw facts to decide these statuses.

Capability names:

```ts
const SECURITY_CAPABILITIES = [
  "control_flow_guard_dominance",
  "middleware_coverage",
  "request_validation_facts",
  "session_trust",
  "authorization",
  "tenant_scope",
  "sensitive_response",
  "secret_exposure",
  "ssrf",
  "raw_sql",
  "cors_policy",
  "csrf",
  "rate_limit"
] as const;
```

### Repo Map Route Security

Required route shape:

```ts
type RepoMapSecurityRoute = {
  route_id: string;
  path: string | null;
  method: string | null;
  file_path: string;
  security: {
    public_or_protected: "public" | "protected" | "unknown";
    auth_proven: boolean | "not_required" | "missing_proof" | "parser_gap" | "unknown";
    middleware_proven: boolean | "not_required" | "missing_proof" | "parser_gap" | "unknown";
    tenant_scope: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
    request_validation: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
    sensitive_response: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
    phase6: {
      ssrf: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
      raw_sql: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
      cors: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
      csrf: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
      rate_limit: "proven" | "not_required" | "missing_proof" | "parser_gap" | "unknown";
    };
    proof_status: "proven" | "violated" | "missing_proof" | "parser_gap" | "advisory_only" | "unknown";
    enforcement_result: "pass" | "brief" | "warn" | "block" | "unknown";
    missing_proof_codes: string[];
    parser_gap_codes: string[];
    finding_ids: string[];
    next_command: string;
  };
};
```

Rules:

- `routes[].security` must be proof-backed.
- Existing fact-derived `route_security` may remain in file summaries, but it must be labeled advisory and must not satisfy Phase 8 route security.
- If no proof exists for a route, output `unknown`, not `proven`.

### MCP Security Context

Required MCP payload:

```ts
type DriftSecurityContextV2 = {
  response_schema: "drift.security.context.v2";
  repo_id: string;
  scan_id: string | null;
  check_id: string | null;
  repo_security_contracts: AcceptedSecurityConventionSummary[];
  changed_route_security: Array<{
    route_id: string;
    path: string | null;
    method: string | null;
    file_path: string;
    required_proofs: string[];
    current_proof_status: "proven" | "violated" | "missing_proof" | "parser_gap" | "advisory_only" | "unknown";
    enforcement_result: "pass" | "brief" | "warn" | "block" | "unknown";
    missing_proof: Array<{
      id: string;
      capability: string;
      code: string;
      blocks_enforcement: boolean;
    }>;
    parser_gaps: Array<{
      parser_gap_id: string;
      capability: string;
      code: string;
      file_path: string;
      start_line?: number;
      end_line?: number;
      blocks_enforcement: boolean;
    }>;
    next_command: string;
  }>;
  do_not_include: [
    "source snippets",
    "secret values",
    "raw request payload examples",
    "headers",
    "cookies",
    "raw SQL",
    "raw URLs",
    "env values",
    "tokens",
    "user IDs",
    "tenant IDs"
  ];
};
```

Tool schema:

```ts
type GetSecurityContextInput = {
  repo_id: string;
  path?: string;
  changed_files?: string[];
  check_id?: string;
  require_fresh?: boolean;
};
```

Rules:

- `path` and `changed_files` filter route security and relevant contracts.
- If no path is supplied, use latest changed files from scan/check state when available.
- MCP must not read raw facts to decide proof status.
- MCP must not expose raw fact values.
- MCP must call query package read-model functions.

## File Responsibility Map

### Rust

- `crates/drift-engine/src/check_command.rs`
  - Emit route endpoint path/method in security proof route metadata.
  - Emit sanitized proof evidence refs.
  - Keep proof/finding IDs stable and route/method/file-role bound.

- `crates/drift-engine/src/security_phase6.rs`
  - Preserve P6 evidence line refs in JSON.
  - Populate P6 missing proof fact IDs.
  - Emit P6 parser gaps and missing proof without source values.

- `crates/drift-engine/src/security_capabilities.rs`
  - Add Phase 6 capability names and capability completeness inputs.

- `crates/drift-engine/tests/security_phase6.rs`
  - Assert no P6 evidence leaks SQL, URL, headers, cookies, payloads, env values, tokens, user IDs, tenant IDs, or source snippets.

### Core And Engine Contract

- `packages/core/src/security.ts`
  - Add optional `evidence_refs` schema.
  - Keep route endpoint path/method optional for compatibility.
  - Add schemas for Phase 8 read-model shapes if exported from core.

- `packages/core/src/domain.ts`
  - Add `StoredSecurityBoundaryProofRun` domain type if storage needs it exported.

- `packages/core/src/schemas.ts`
  - Add validation exports if domain schema registry uses this file.

- `packages/engine-contract/src/index.ts`
  - Mirror engine proof event schema changes.
  - Parse new route metadata/evidence refs.

### Storage

- `packages/storage/src/migrations.ts`
  - Add migration `025_security_boundary_proof_runs`.

- `packages/storage/src/sqlite-storage.ts`
  - Add `upsertSecurityBoundaryProofRuns`.
  - Add `listSecurityBoundaryProofRuns`.
  - Keep old proof methods compatible.

- `packages/storage/test/sqlite-storage.test.ts`
  - Empty DB migration.
  - Existing DB migration.
  - Proof run round trip with missing proof and parser gaps.
  - Secret/snippet sentinel rejection or absence check.

### Query

- `packages/query/src/security-boundary-proof.ts`
  - Extend current read model into a Phase 8 proof-backed read model.
  - Add accepted contract summaries.
  - Add route security summaries.
  - Add MCP context builder.
  - Add scan capability summary builder.

- `packages/query/src/index.ts`
  - Export new read-model functions.
  - Wire repo map route security through proof read model.

- `packages/query/test/security-boundary-proof.test.ts`
  - Proof-backed route security.
  - Missing proof and parser gap summaries.
  - Changed-file filtering.
  - No raw facts required.

### CLI

- `packages/cli/src/check/run-check.ts`
  - Persist proof runs after check run creation.
  - Keep `drift check --json.security_boundary_proofs`.

- `packages/cli/src/check/security-check.ts`
  - Preserve proof JSON in check payload.
  - Do not derive proof from findings.

- `packages/cli/src/formatters/checks.ts`
  - Render Phase 8 human blocks from proof plus finding summaries.

- `packages/cli/src/domain/scan-status.ts`
  - Emit Phase 8 `security_capabilities[]`.

- `packages/cli/src/domain/repo-map.ts`
  - Add proof-backed top-level `routes[]`.

- `packages/cli/src/commands/repo-map.ts`
  - Include proof read model in JSON response.

- `packages/cli/src/commands/conventions.ts`
  - Support `drift candidates` alias through router.

- `packages/cli/src/app/router.ts`
  - Add candidate aliases.

- `packages/cli/src/args/command-shape.ts`
  - Accept candidate aliases.

- `packages/cli/src/args/flag-readers.ts`
  - Add all security convention kinds to `--kind`.

- `packages/cli/src/args/help.ts`
  - Document `drift candidates`.

- `packages/cli/test/cli.test.ts`
  - P8 CLI tests and goldens.

### MCP

- `packages/mcp/src/security-context.ts`
  - Replace raw-fact proof sections with query read model.
  - Emit `drift.security.context.v2`.

- `packages/mcp/src/tools.ts`
  - Extend `get_security_context` input schema.

- `packages/mcp/src/index.ts`
  - Pass path/check filters to security context builder.

- `packages/mcp/test/mcp.test.ts`
  - P8 MCP context shape.
  - Path filtering.
  - No raw fact value egress.

### E2E And Fixtures

- `test/e2e/security-phase8.test.ts`
  - Golden CLI/MCP P8 flow.

- `test/e2e/golden.test.ts`
  - Add reduced goldens for P8 outputs.

- `test/fixtures/security-*`
  - Fill missing fixture cases required by original TDD.

## TDD Task Ledger

### Task 1: RED Rust Proof Route Metadata

**Files:**

- Test: `crates/drift-engine/tests/security_check_repo_auth.rs`
- Modify: `crates/drift-engine/src/check_command.rs`

- [ ] **Step 1: Add failing test for route path and method in proof**

Add test:

```rust
#[test]
fn security_phase8_proof_includes_route_path_and_method() {
    let repo = security_repo_with_route("app/api/users/route.ts", "GET", r#"
import { requireUser } from "@/server/auth";
export async function GET() {
  const user = await requireUser();
  return Response.json({ id: user.id });
}
"#);
    let contract = accepted_auth_contract("security_auth", "@/server/auth", "requireUser");
    let result = check_repo_with_contracts(&repo, vec![contract]);
    let proof = result.security_boundary_proofs.iter()
        .find(|proof| proof.route.file_path == "app/api/users/route.ts")
        .expect("security proof");
    assert_eq!(proof.route.endpoint.as_ref().and_then(|endpoint| endpoint.path.as_deref()), Some("/api/users"));
    assert_eq!(proof.route.endpoint.as_ref().and_then(|endpoint| endpoint.method.as_deref()), Some("GET"));
    assert_eq!(proof.route.file_role, "api_route");
}
```

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine --test security_check_repo_auth security_phase8_proof_includes_route_path_and_method -- --nocapture
```

Expected: fail because route endpoint path/method is missing.

- [ ] **Step 3: Implement Rust route metadata**

In `crates/drift-engine/src/check_command.rs`, when building `SecurityBoundaryProof.route`, use the already computed route path and method. Method must come from the route handler, not from filename parsing in TypeScript.

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p drift-engine --test security_check_repo_auth security_phase8_proof_includes_route_path_and_method -- --nocapture
```

Expected: pass.

### Task 2: RED Rust Sanitized Evidence Refs

**Files:**

- Test: `crates/drift-engine/tests/security_phase6.rs`
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`

- [ ] **Step 1: Add failing test for sanitized proof evidence refs**

Add test:

```rust
#[test]
fn security_phase8_proof_evidence_refs_are_line_only_and_sanitized() {
    let proof = phase6_violation_proof_for_source(r#"
export async function POST(request: Request) {
  const body = await request.json();
  await fetch(body.callbackUrl + "?token=secret");
  await db.query("select * from users where token = 'secret'");
  return Response.json({ ok: true });
}
"#);
    let serialized = serde_json::to_string(&proof).expect("proof json");
    assert!(serialized.contains("\"evidence_refs\""));
    assert!(serialized.contains("\"start_line\""));
    assert!(!serialized.contains("callbackUrl +"));
    assert!(!serialized.contains("select * from users"));
    assert!(!serialized.contains("token=secret"));
    assert!(!serialized.contains("\"source\""));
    assert!(!serialized.contains("\"snippet\""));
    assert!(!serialized.contains("\"payload\""));
    assert!(!serialized.contains("\"cookie\""));
    assert!(!serialized.contains("\"header\""));
  }
```

- [ ] **Step 2: Run RED**

```bash
cargo test -p drift-engine --test security_phase6 security_phase8_proof_evidence_refs_are_line_only_and_sanitized -- --nocapture
```

Expected: fail because `evidence_refs` is not emitted.

- [ ] **Step 3: Implement evidence refs in Rust**

Emit `evidence_refs` with only:

- `evidence_id`
- `fact_id`
- `graph_edge_id`
- `capability`
- `kind`
- `file_path`
- `start_line`
- `end_line`
- `role`

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p drift-engine --test security_phase6 security_phase8_proof_evidence_refs_are_line_only_and_sanitized -- --nocapture
```

Expected: pass.

### Task 3: RED P6 Missing Proof Fact IDs And Capability Truth

**Files:**

- Test: `crates/drift-engine/tests/security_phase6.rs`
- Modify: `crates/drift-engine/src/security_phase6.rs`
- Modify: `crates/drift-engine/src/security_capabilities.rs`

- [ ] **Step 1: Add failing P6 missing proof ID test**

Add test:

```rust
#[test]
fn security_phase8_phase6_missing_proof_preserves_fact_ids() {
    let proof = phase6_violation_proof_for_source(r#"
export async function POST(request: Request) {
  const body = await request.json();
  await fetch(body.callbackUrl);
  return Response.json({ ok: true });
}
"#);
    let missing = proof.missing_proof.iter()
        .find(|missing| missing.code == "request_controlled_url")
        .expect("ssrf missing proof");
    assert!(!missing.fact_ids.is_empty());
    assert!(missing.blocks_enforcement);
}
```

- [ ] **Step 2: Add failing P6 capability test**

Add or extend a capability test:

```rust
#[test]
fn security_phase8_reports_phase6_capabilities() {
    let capabilities = security_capabilities();
    for expected in ["ssrf", "raw_sql", "cors_policy", "csrf", "rate_limit"] {
        assert!(capabilities.iter().any(|capability| capability.name == expected), "missing {expected}");
    }
}
```

- [ ] **Step 3: Run RED**

```bash
cargo test -p drift-engine --test security_phase6 security_phase8_phase6_missing_proof_preserves_fact_ids -- --nocapture
cargo test -p drift-engine security_phase8_reports_phase6_capabilities -- --nocapture
```

Expected: fail because fact IDs and P6 capabilities are incomplete.

- [ ] **Step 4: Implement**

Use `Phase6MissingProof.fact_ids` when emitting top-level missing proof. Add P6 capabilities to the Rust capability registry.

- [ ] **Step 5: Run GREEN**

```bash
cargo test -p drift-engine --test security_phase6 security_phase8_phase6_missing_proof_preserves_fact_ids -- --nocapture
cargo test -p drift-engine security_phase8_reports_phase6_capabilities -- --nocapture
```

Expected: pass.

### Task 4: RED TypeScript Proof Schema Mirrors Rust

**Files:**

- Test: `packages/core/test/security.test.ts`
- Test: `packages/engine-contract/test/security-contract.test.ts`
- Modify: `packages/core/src/security.ts`
- Modify: `packages/engine-contract/src/index.ts`

- [ ] **Step 1: Add failing core schema test**

```ts
it("accepts Phase 8 proof route metadata and sanitized evidence refs", () => {
  const proof = securityProofFixture({
    route: {
      route_id: "route_users_get",
      file_path: "app/api/users/route.ts",
      file_role: "api_route",
      endpoint: { path: "/api/users", method: "GET", framework: "next" },
      handler_symbol: "GET"
    },
    evidence_refs: [{
      evidence_id: "evidence_auth_guard",
      fact_id: "fact_auth_guard",
      capability: "control_flow_guard_dominance",
      kind: "auth_guard_called",
      file_path: "app/api/users/route.ts",
      start_line: 4,
      end_line: 4,
      role: "guard"
    }]
  });
  expect(SecurityBoundaryProofSchema.parse(proof).evidence_refs).toHaveLength(1);
});
```

- [ ] **Step 2: Add failing forbidden evidence fields test**

```ts
it("rejects Phase 8 proof evidence refs that carry source or secret values", () => {
  const proof = securityProofFixture({
    evidence_refs: [{
      evidence_id: "evidence_bad",
      capability: "raw_sql",
      kind: "raw_sql_called",
      file_path: "app/api/users/route.ts",
      role: "sink",
      source: "await db.query(\"select secret\")"
    }]
  });
  expect(() => SecurityBoundaryProofSchema.parse(proof)).toThrow();
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected: fail because `evidence_refs` is not defined or strict enough.

- [ ] **Step 4: Implement schemas**

Add strict `SecurityProofEvidenceRefSchema` and optional `evidence_refs` to both core and engine-contract proof schemas.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter @drift/core test -- security
pnpm --filter @drift/engine-contract test -- security-contract
```

Expected: pass.

### Task 5: RED Storage Proof Runs

**Files:**

- Test: `packages/storage/test/sqlite-storage.test.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`

- [ ] **Step 1: Add failing migration expectation**

Extend migration ID tests to include:

```ts
expect(migrationIds).toContain("025_security_boundary_proof_runs");
```

- [ ] **Step 2: Add failing round-trip test**

```ts
it("persists security boundary proof runs by check run without snippets", () => {
  const storage = createTestStorage();
  seedRepoScanAndCheck(storage, {
    repo_id: "repo_security",
    scan_id: "scan_security",
    check_id: "check_security"
  });
  const proof = securityBoundaryProofFixture({
    proof_id: "proof_route_users_get",
    route: {
      route_id: "route_users_get",
      file_path: "app/api/users/route.ts",
      file_role: "api_route",
      endpoint: { path: "/api/users", method: "GET", framework: "next" }
    },
    missing_proof: [{
      id: "missing_auth",
      capability: "control_flow_guard_dominance",
      code: "auth_guard_not_dominating_sink",
      blocks_enforcement: true,
      fact_ids: ["fact_sink"],
      graph_edge_ids: []
    }],
    parser_gaps: []
  });
  storage.upsertSecurityBoundaryProofRuns({
    repo_id: "repo_security",
    scan_id: "scan_security",
    check_id: "check_security",
    proofs: [proof],
    created_at: "2026-05-27T00:00:00.000Z"
  });
  const rows = storage.listSecurityBoundaryProofRuns({
    repo_id: "repo_security",
    check_id: "check_security"
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].missing_proof_count).toBe(1);
  expect(rows[0].affected_files).toEqual(["app/api/users/route.ts"]);
  expect(JSON.stringify(rows[0])).not.toContain("select *");
  expect(JSON.stringify(rows[0])).not.toContain("secret=");
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @drift/storage test -- sqlite-storage
```

Expected: fail because migration and methods do not exist.

- [ ] **Step 4: Implement migration and methods**

Add migration `025_security_boundary_proof_runs` and storage methods exactly as defined in this TDD.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter @drift/storage test -- sqlite-storage
```

Expected: pass.

### Task 6: RED Check Persists Proof Runs

**Files:**

- Test: `packages/cli/test/security-check.test.ts`
- Modify: `packages/cli/src/check/run-check.ts`

- [ ] **Step 1: Add failing test**

```ts
it("persists engine security proofs for the check run", async () => {
  const { storage, repoId, scanId } = await seedSecurityCheckRepo();
  const result = await runCheckForTest(storage, {
    repo: repoId,
    scope: "full",
    json: true
  });
  expect(result.security_boundary_proofs.length).toBeGreaterThan(0);
  const checkId = result.summary.check_id;
  const stored = storage.listSecurityBoundaryProofRuns({
    repo_id: repoId,
    scan_id: scanId,
    check_id: checkId
  });
  expect(stored.length).toBe(result.security_boundary_proofs.length);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected: fail because check proof runs are not persisted.

- [ ] **Step 3: Implement**

After `upsertCheckRun` and before final payload return, call:

```ts
storage.upsertSecurityBoundaryProofRuns({
  repo_id: repoId,
  scan_id: latestScan.id,
  check_id: checkRun.id,
  proofs: securityBoundaryProofs,
  created_at: completedAt
});
```

Only call when `securityBoundaryProofs.length > 0`.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @drift/cli test -- security-check
```

Expected: pass.

### Task 7: RED Query Phase 8 Read Model

**Files:**

- Test: `packages/query/test/security-boundary-proof.test.ts`
- Modify: `packages/query/src/security-boundary-proof.ts`
- Modify: `packages/query/src/index.ts`

- [ ] **Step 1: Add failing route security read-model test**

```ts
it("builds Phase 8 route security from proofs only", () => {
  const model = buildSecurityPhase8ReadModel({
    repo_id: "repo_security",
    scan_id: "scan_security",
    check_id: "check_security",
    proofs: [securityBoundaryProofFixture({
      route: {
        route_id: "route_users_get",
        file_path: "app/api/users/route.ts",
        file_role: "api_route",
        endpoint: { path: "/api/users", method: "GET", framework: "next" }
      },
      auth: { required: true, proven: true, trusted_guards: [], undominated_sinks: [] },
      tenant: { required: true, proven: false, tenant_sources: [], predicates: [], missing: [{ reason: "tenant_param_not_bound_to_data_operation" }] },
      missing_proof: [{
        id: "missing_tenant",
        capability: "tenant_scope",
        code: "tenant_not_bound_to_data_operation",
        blocks_enforcement: true,
        fact_ids: ["fact_tenant"],
        graph_edge_ids: []
      }],
      parser_gaps: [],
      result: {
        proof_status: "missing_proof",
        enforcement_result: "block",
        can_block: true,
        finding_ids: ["finding_tenant"]
      }
    })],
    findings: [{ finding_id: "finding_tenant", title: "Tenant missing", lifecycle: "new" }],
    accepted_conventions: []
  });
  expect(model.routes[0]).toMatchObject({
    route_id: "route_users_get",
    path: "/api/users",
    method: "GET",
    security: {
      auth_proven: true,
      tenant_scope: "missing_proof",
      proof_status: "missing_proof",
      enforcement_result: "block"
    }
  });
});
```

- [ ] **Step 2: Add failing changed-file filtering test**

```ts
it("filters Phase 8 route security to changed files", () => {
  const model = buildSecurityPhase8ReadModel({
    repo_id: "repo_security",
    scan_id: "scan_security",
    check_id: "check_security",
    proofs: [
      securityBoundaryProofFixture({ route: { route_id: "route_users", file_path: "app/api/users/route.ts", file_role: "api_route" } }),
      securityBoundaryProofFixture({ route: { route_id: "route_admin", file_path: "app/api/admin/route.ts", file_role: "api_route" } })
    ],
    findings: [],
    accepted_conventions: [],
    changed_files: ["app/api/users/route.ts"]
  });
  expect(model.changed_route_security.map((route) => route.file_path)).toEqual(["app/api/users/route.ts"]);
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @drift/query test -- security-boundary-proof
```

Expected: fail because `buildSecurityPhase8ReadModel` does not exist.

- [ ] **Step 4: Implement query model**

Add `buildSecurityPhase8ReadModel` that returns:

- `security_capabilities`
- `routes`
- `repo_security_contracts`
- `changed_route_security`
- `do_not_include`

Use only proofs, findings, accepted conventions, and explicit changed file inputs.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter @drift/query test -- security-boundary-proof
```

Expected: pass.

### Task 8: RED Scan Status Phase 8 Capabilities

**Files:**

- Test: `packages/cli/test/cli.test.ts`
- Modify: `packages/cli/src/domain/scan-status.ts`

- [ ] **Step 1: Add failing CLI test**

```ts
it("scan status reports Phase 8 security capability array from proof runs", async () => {
  const { storage, repoId } = await seedCheckedSecurityRepo();
  const result = await runCliJson(storage, ["scan", "status", "--repo", repoId, "--json"]);
  expect(Array.isArray(result.security_capabilities)).toBe(true);
  expect(result.security_capabilities).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: "control_flow_guard_dominance",
      capability: "deterministic_check",
      status: expect.stringMatching(/complete|partial|missing|unsupported/),
      can_block: expect.any(Boolean),
      parser_gap_count: expect.any(Number),
      missing_proof_count: expect.any(Number),
      affected_files: expect.any(Array)
    })
  ]));
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/cli test -- "scan status reports Phase 8 security capability array"
```

Expected: fail because current output is object-shaped.

- [ ] **Step 3: Implement**

In `scan-status.ts`, load latest proof runs and pass them to the query read model. Replace the old object-shaped `security_capabilities` output with the Phase 8 array. If no proof runs exist, return an empty array and keep `capability_report` unchanged for backward diagnostics.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @drift/cli test -- "scan status reports Phase 8 security capability array"
```

Expected: pass.

### Task 9: RED Repo Map Proof-Backed Routes

**Files:**

- Test: `packages/cli/test/cli.test.ts`
- Modify: `packages/cli/src/domain/repo-map.ts`
- Modify: `packages/cli/src/commands/repo-map.ts`
- Modify: `packages/query/src/index.ts`

- [ ] **Step 1: Add failing CLI test**

```ts
it("repo map reports Phase 8 proof-backed route security", async () => {
  const { storage, repoId } = await seedCheckedSecurityRepo();
  const result = await runCliJson(storage, ["repo", "map", "--repo", repoId, "--json"]);
  expect(result.routes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      route_id: expect.any(String),
      file_path: expect.stringContaining("app/api/"),
      security: expect.objectContaining({
        public_or_protected: expect.stringMatching(/public|protected|unknown/),
        auth_proven: expect.anything(),
        tenant_scope: expect.stringMatching(/proven|not_required|missing_proof|parser_gap|unknown/),
        request_validation: expect.stringMatching(/proven|not_required|missing_proof|parser_gap|unknown/),
        sensitive_response: expect.stringMatching(/proven|not_required|missing_proof|parser_gap|unknown/)
      })
    })
  ]));
});
```

- [ ] **Step 2: Add false-proof regression**

```ts
it("repo map does not mark raw fact route security as proven without proof runs", async () => {
  const { storage, repoId } = await seedScannedButUncheckedSecurityRepo();
  const result = await runCliJson(storage, ["repo", "map", "--repo", repoId, "--json"]);
  expect(result.routes ?? []).not.toEqual(expect.arrayContaining([
    expect.objectContaining({
      security: expect.objectContaining({ auth_proven: true })
    })
  ]));
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @drift/cli test -- "repo map reports Phase 8 proof-backed route security"
pnpm --filter @drift/cli test -- "repo map does not mark raw fact route security as proven"
```

Expected: fail because repo map does not expose proof-backed top-level routes.

- [ ] **Step 4: Implement**

Load latest proof runs in repo map command/domain, build Phase 8 read model, and attach `routes` to repo map JSON. Existing file-level map output stays compatible.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter @drift/cli test -- "repo map reports Phase 8 proof-backed route security"
pnpm --filter @drift/cli test -- "repo map does not mark raw fact route security as proven"
```

Expected: pass.

### Task 10: RED Human Check Output

**Files:**

- Test: `packages/cli/test/security-check.test.ts`
- Modify: `packages/cli/src/formatters/checks.ts`
- Modify: `packages/cli/src/check/run-check.ts`

- [ ] **Step 1: Add failing human output test**

```ts
it("renders Phase 8 human check blocks for security findings", async () => {
  const { storage, repoId } = await seedSecurityViolationRepo();
  const text = await runCliText(storage, ["check", "--repo", repoId, "--scope", "full"]);
  expect(text).toContain("BLOCK api_route_requires_auth_helper");
  expect(text).toContain("Route: GET /api/users");
  expect(text).toContain("File: app/api/users/route.ts");
  expect(text).toContain("Reason:");
  expect(text).toContain("Evidence:");
  expect(text).toContain("Capability:");
  expect(text).toContain("Lifecycle:");
  expect(text).toContain("Next: drift repo map --repo");
  expect(text).not.toContain("await ");
  expect(text).not.toContain("select *");
  expect(text).not.toContain("cookie");
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/cli test -- "renders Phase 8 human check blocks"
```

Expected: fail because formatter only prints compact finding rows.

- [ ] **Step 3: Implement formatter**

Change `formatCheckText` input to accept `security_boundary_proofs`. Render one block per blocking/warning security finding matched through `proof.result.finding_ids`.

Block format:

```text
BLOCK api_route_requires_auth_helper
  Route: GET /api/users
  File: app/api/users/route.ts
  Reason: auth guard does not dominate data operation
  Evidence: auth_guard_called line 18; data_operation_detected line 12
  Capability: control_flow_guard_dominance deterministic_check
  Lifecycle: new, changed-files
  Next: drift repo map --repo <repo_id> --path app/api/users/route.ts --json
```

If path or method is missing, render:

```text
Route: unknown
```

Do not infer proof truth from the finding message.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @drift/cli test -- "renders Phase 8 human check blocks"
```

Expected: pass.

### Task 11: RED MCP Security Context V2

**Files:**

- Test: `packages/mcp/test/mcp.test.ts`
- Modify: `packages/mcp/src/security-context.ts`
- Modify: `packages/mcp/src/tools.ts`
- Modify: `packages/mcp/src/index.ts`

- [ ] **Step 1: Add failing MCP shape test**

```ts
it("returns Phase 8 security context v2 from proof read model", async () => {
  const { server, repoId } = await seedMcpSecurityRepoWithProofRuns();
  const result = await callTool(server, "get_security_context", {
    repo_id: repoId,
    changed_files: ["app/api/users/route.ts"]
  });
  expect(result.response_schema).toBe("drift.security.context.v2");
  expect(result.repo_security_contracts).toEqual(expect.any(Array));
  expect(result.changed_route_security).toEqual(expect.arrayContaining([
    expect.objectContaining({
      file_path: "app/api/users/route.ts",
      required_proofs: expect.any(Array),
      current_proof_status: expect.stringMatching(/proven|violated|missing_proof|parser_gap|advisory_only|unknown/)
    })
  ]));
  expect(result.do_not_include).toContain("source snippets");
});
```

- [ ] **Step 2: Add raw fact egress regression**

```ts
it("does not expose raw security fact values in MCP security context", async () => {
  const { server, repoId } = await seedMcpRepoWithAdversarialSecurityFacts({
    source_value: "await db.query(\"select * from users where token = secret\")",
    secret_value: "sk_live_secret",
    cookie_value: "session=secret",
    header_value: "authorization: bearer secret",
    request_payload: "{\"password\":\"secret\"}",
    tenant_id: "tenant_123",
    user_id: "user_123"
  });
  const result = await callTool(server, "get_security_context", { repo_id: repoId });
  const json = JSON.stringify(result);
  for (const forbidden of ["select * from users", "sk_live_secret", "session=secret", "bearer secret", "password", "tenant_123", "user_123"]) {
    expect(json).not.toContain(forbidden);
  }
});
```

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected: fail because MCP returns v1 and still emits raw-fact-derived sections.

- [ ] **Step 4: Implement MCP v2**

Extend tool input schema and replace raw-fact proof reducers with query read model output.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter @drift/mcp test -- mcp
```

Expected: pass.

### Task 12: RED Candidates Alias And Kind Filters

**Files:**

- Test: `packages/cli/test/cli.test.ts`
- Modify: `packages/cli/src/app/router.ts`
- Modify: `packages/cli/src/args/command-shape.ts`
- Modify: `packages/cli/src/args/flag-readers.ts`
- Modify: `packages/cli/src/args/help.ts`

- [ ] **Step 1: Add failing candidates alias test**

```ts
it("lists security convention candidates through drift candidates json", async () => {
  const { storage, repoId } = await seedScannedSecurityCandidateRepo();
  const result = await runCliJson(storage, ["candidates", "--repo", repoId, "--kind", "api_route_requires_rate_limit", "--json"]);
  expect(result.candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "api_route_requires_rate_limit",
      suggested_enforcement_mode: "warn",
      reason_not_blocking: "candidate_not_accepted"
    })
  ]));
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @drift/cli test -- "lists security convention candidates through drift candidates json"
```

Expected: fail because command alias or kind filter is missing.

- [ ] **Step 3: Implement**

Add command alias and update kind filter to include all security convention kinds from this TDD.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @drift/cli test -- "lists security convention candidates through drift candidates json"
```

Expected: pass.

### Task 13: RED Golden Outputs

**Files:**

- Test: `test/e2e/security-phase8.test.ts`
- Test: `test/e2e/golden.test.ts`
- Create: `test/fixtures/security-phase8-full`

- [ ] **Step 1: Add failing e2e golden test**

Add `test/e2e/security-phase8.test.ts` with one fixture repo that:

- scans security route fixtures
- accepts deterministic security contracts
- runs `drift check --json`
- runs human `drift check`
- runs `drift scan status --json`
- runs `drift repo map --json`
- runs `drift candidates --json`
- runs MCP `get_security_context`

Assertions:

```ts
expect(checkJson.security_boundary_proofs[0].route.endpoint.method).toBeDefined();
expect(scanStatus.security_capabilities[0]).toHaveProperty("missing_proof_count");
expect(repoMap.routes[0]).toHaveProperty("security");
expect(candidates.candidates.every((candidate) => candidate.reason_not_blocking)).toBe(true);
expect(mcp.response_schema).toBe("drift.security.context.v2");
expect(JSON.stringify({ checkJson, scanStatus, repoMap, candidates, mcp })).not.toContain("select *");
```

- [ ] **Step 2: Run RED**

```bash
pnpm test:e2e -- security-phase8
```

Expected: fail because P8 surfaces are incomplete.

- [ ] **Step 3: Implement fixture and golden reducers**

Use reducers that remove timestamps, absolute paths, hash values, and unstable IDs. Keep route, method, file, contract kind, proof status, enforcement result, missing proof code, parser gap code, and next command.

- [ ] **Step 4: Run GREEN**

```bash
pnpm test:e2e -- security-phase8
```

Expected: pass.

### Task 14: RED Missing Fixture Matrix Cases

**Files:**

- Create: `test/fixtures/security-dynamic-import-parser-gap`
- Create: `test/fixtures/security-public-route-exception`
- Create: `test/fixtures/security-waived-finding`
- Create: `test/fixtures/security-baseline-pre-existing`
- Test: `test/e2e/security-phase8.test.ts`

- [ ] **Step 1: Add fixture matrix test**

```ts
it("covers Phase 8 required fixture matrix additions", async () => {
  for (const fixture of [
    "security-dynamic-import-parser-gap",
    "security-public-route-exception",
    "security-waived-finding",
    "security-baseline-pre-existing"
  ]) {
    const result = await runSecurityFixture(fixture);
    expect(result.check.summary.engine_source).toBe("rust");
    expect(result.check.security_boundary_proofs).toEqual(expect.any(Array));
  }
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm test:e2e -- security-phase8
```

Expected: fail because fixtures do not exist.

- [ ] **Step 3: Add fixtures**

Each fixture must include:

- `drift.contract.json` or accepted convention setup
- route source
- expected pass/fail behavior
- no source snippets in expected output

- [ ] **Step 4: Run GREEN**

```bash
pnpm test:e2e -- security-phase8
```

Expected: pass.

### Task 15: Final Regression Gate

Run all commands:

```bash
git status --short --branch
git diff --stat
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

Expected:

- All pass.
- No source/snippet/secret leakage in P8 outputs.
- Candidate-only evidence remains non-blocking.
- Accepted blocking contracts still fail closed on missing proof and parser gaps.

## Output Sanitization Checklist

Every new CLI/MCP/storage/query output must be checked against these forbidden fields and values:

- `source`
- `source_text`
- `snippet`
- `raw`
- `literal`
- `url`
- `sql`
- `payload`
- `body`
- `header`
- `cookie`
- `env`
- `token`
- `secret`
- `password`
- `authorization`
- `user_id`
- `tenant_id`
- actual request body examples
- actual SQL strings
- actual raw URLs
- actual environment variable values
- full source lines

Allowed:

- file path
- route path
- HTTP method
- line number
- fact ID
- graph edge ID
- parser gap ID
- missing proof ID
- contract kind
- capability name
- sanitized helper symbol and accepted module path

## Definition Of Done

Phase 8 is production ready when:

1. Rust proof JSON includes route path/method and sanitized evidence refs.
2. P6 missing proof fact IDs and capability truth are emitted.
3. TypeScript schemas validate the new proof shape without allowing secret/snippet fields.
4. Check runs persist security proof runs by `check_id`.
5. `drift scan status --json` emits Phase 8 `security_capabilities[]`.
6. `drift check --json` emits complete `security_boundary_proofs`.
7. Human check output renders Phase 8 security blocks.
8. `drift repo map --json` emits proof-backed `routes[].security`.
9. `drift candidates --json` exists and includes security candidates.
10. MCP emits `drift.security.context.v2` from query read models.
11. CLI/MCP parity tests pass.
12. Golden tests cover all P8 output surfaces.
13. Missing fixture matrix items are present.
14. No output/storage/MCP/CLI surface leaks forbidden values.
15. Full verification gate passes.
