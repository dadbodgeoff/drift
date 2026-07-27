# Codebase Intelligence 100% Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Drift a local, evidence-backed codebase intelligence middleman for agents by defining and enforcing the full contract stack for facts, graph meaning, conventions, elections, tasks, context policy, proof, findings, waivers, baselines, and audit.

**Architecture:** Keep the Rust engine responsible for deterministic extraction and graph evidence, keep TypeScript core responsible for versioned contracts and schemas, keep SQLite responsible for durable local truth, keep query responsible for derived read models, and keep CLI/MCP as thin transport/governance surfaces. Every new intelligence surface must be schema-checked, stored or explicitly derived, exposed through CLI and MCP where agent-facing, and covered by release/beta proof when it affects claims.

**Tech Stack:** Rust engine facts and graph projection, TypeScript core domain and Zod schemas, SQLite migrations, `@drift/query` read models, CLI commands, read-only MCP handlers, Vitest, Rust integration tests, `pnpm verify:ci`.

---

## 0. Current Implementation Baseline

Verified current branch state:

- `FactRecord` exists in `packages/core/src/domain.ts` and `packages/core/src/schemas.ts`.
- Current fact kinds: `file_detected`, `import_used`, `re_export_used`, `exported_symbol`, `symbol_called`, `data_operation_detected`, `route_declared`, `file_role_detected`, `test_declared`.
- Rust extraction and graph-backed route/service/data-access checks exist in `crates/drift-engine`.
- SQLite persists facts, graph projections, convention candidates, accepted conventions, repo contracts, findings, waivers, baselines, audits, backups, scan file changes, check runs, and required-check execution proof.
- `RepoContract` exists and includes accepted conventions, rejected inferences, waivers, risky areas, safe commands, required checks, context egress, agent permissions, and agent contracts.
- Read-only MCP exposes scan status, repo contract, repo map, preflight, conventions, findings, allowed context, audit status, capabilities, runtime info, and required-check execution proof.
- `scripts/run-beta-proof.mjs` proves fresh Rust scan, accepted convention, good route pass, bad route block, evidence-complete finding, required-check execution proof, audit, and CLI/MCP parity.

Current gaps this plan closes:

- Facts lack explicit extractor/provenance/confidence/resolution/staleness fields.
- Roles exist as tags, but not as a formal ontology with allowed/forbidden edges.
- Layer architecture is implicit in checks, not a first-class contract.
- Convention lifecycle exists, but election states and transition records are underdefined.
- Task preflight exists, but task intent/target/risk/proof model is not a first-class contract.
- Check proof records command execution, but proof binding to diff/contract/lockfile/worktree identity is not complete.
- Unknown parser gaps exist as diagnostics in places, but not as a durable confidence-affecting contract.
- Change impact, symbol identity, test relevance, data operation risk taxonomy, framework adapters, and entrypoint taxonomy are shallow.

## 1. Canonical Contract Targets

The final system must define these versioned contracts:

| Contract | Purpose | Current Status | Target Status |
| --- | --- | --- | --- |
| `ParsedFactContract` | Atomic extracted facts with file/span/evidence | partial | versioned fact quality and provenance |
| `FactQualityContract` | Confidence, resolution, extraction method, staleness | missing | persisted and queryable |
| `GraphContract` | Nodes, edges, evidence, unresolved edges | partial | typed graph edge/node semantics |
| `RoleOntologyContract` | Meaning of roles and permitted dependencies | missing | canonical role vocabulary and edges |
| `LayerArchitectureContract` | Entrypoint/middle/terminal layers and edge policy | missing | enforceable accepted architecture model |
| `AdapterContract` | Framework-specific route/entrypoint discovery | partial | Next.js adapter contract first |
| `DataOperationContract` | DB/network/cache/queue/secret/payment/email ops | partial | risk-classified operations |
| `EntrypointContract` | API route, server action, CLI, cron, worker, webhook | partial | typed entrypoint taxonomy |
| `SymbolIdentityContract` | Canonical symbol declarations, imports, refs, calls | partial | stable symbol identity and re-export chains |
| `ChangeImpactContract` | Affected routes/services/data ops/tests/callers | missing | query and preflight read model |
| `TestIntelligenceContract` | Test subjects, frameworks, relevance, missing tests | partial | scoped required-test selection |
| `ConventionElectionContract` | Candidate/election/accept/reject/supersede lifecycle | partial | formal state machine and audit trail |
| `RepoContract` | Active repo operating contract | partial | layer/role/task/proof versions included |
| `RuleContract` | Executable rule with capability requirements | partial | versioned rule schemas and failure behavior |
| `FindingContract` | Structured violation and parser-gap findings | partial | severity/confidence/drift-category complete |
| `WaiverContract` | Human exceptions with expiry/reapproval | partial | reapproval-on-change and contract binding |
| `BaselineContract` | Existing violation separation | partial | drift categories and baseline versioning |
| `CheckProofContract` | Proof that required checks ran on the right state | partial | bound to git/diff/lockfile/contract |
| `AgentTaskContract` | Typed task intent, target area, risk, required proof | missing | prepare output v2 |
| `AgentPreflightContract` | Agent-safe packet of facts/contracts/unknowns/proof | partial | typed task-aware packet |
| `ContextPolicyContract` | What agents can see/do | partial | explicit permission matrix and egress levels |
| `AuditContract` | Hash-chained governance history | partial | before/after object hashes for mutations |
| `ReleaseProofContract` | Beta/release gate evidence | partial | proves every beta-critical contract |

## 2. Convention And Election Model

### 2.1 Convention States

The canonical lifecycle must be:

```txt
detected -> candidate -> promoted -> accepted -> active
detected -> candidate -> rejected
active -> deprecated -> superseded
active -> conflicted
active -> disabled
```

Definitions:

- `detected`: raw scan evidence suggests a pattern.
- `candidate`: Drift created a reviewable proposal from evidence.
- `promoted`: user or policy marked candidate ready for acceptance review.
- `accepted`: human-confirmed and materialized into `RepoContract`.
- `active`: enforceable for current repo contract version.
- `rejected`: explicitly not a repo convention.
- `deprecated`: still visible but not used for new checks.
- `superseded`: replaced by another convention id.
- `conflicted`: incompatible with another accepted convention or role/layer rule.
- `disabled`: accepted but enforcement intentionally off.

### 2.2 Election Record

Add `ConventionElection`:

```ts
export interface ConventionElection {
  schema_version: "drift.convention_election.v1";
  election_id: string;
  repo_id: string;
  candidate_id: string;
  convention_id: string | null;
  previous_state: ConventionElectionState | null;
  next_state: ConventionElectionState;
  actor: string;
  reason: string;
  evidence_refs: EvidenceRef[];
  counterexample_refs: EvidenceRef[];
  contract_fingerprint_before: string | null;
  contract_fingerprint_after: string | null;
  audit_event_id: string;
  created_at: string;
}
```

### 2.3 Election Rules

- Only `accepted` + `active` conventions can block.
- `candidate`, `promoted`, `conflicted`, and `deprecated` can brief agents but cannot block.
- Every transition after `candidate` requires an audit event.
- `accepted -> active` must rematerialize `RepoContract`.
- `active -> superseded` must point to the replacement convention.
- `conflicted` must include the conflicting convention ids.

## 3. Target Role Ontology

Canonical roles:

```txt
route
controller
service
domain
data_access
schema
model
validation
auth
middleware
queue_worker
cron_job
event_handler
adapter
client_sdk
component
hook
test_unit
test_integration
test_e2e
config
script
migration
generated
documentation
unknown
mixed_role
```

Initial edge policy:

```txt
route -> service: allowed
route -> data_access: forbidden
route -> auth: expected_when_auth_sensitive
service -> data_access: allowed
service -> external_service: allowed_with_risk
component -> data_access: forbidden
component -> service: forbidden_when_server_only
test_* -> any: allowed_by_scope
migration -> data_access: allowed
script -> data_access: allowed_with_risk
generated -> any: ignored_by_default
unknown -> blocking: never
unknown -> confidence: lowers_graph_confidence
```

## 4. TDD Execution Rules

Every task below must follow red-green-refactor:

1. Write one failing test for one behavior.
2. Run it and capture the expected failure.
3. Implement the smallest production change.
4. Run the focused test.
5. Run the relevant package test.
6. Update docs/schema fixtures.
7. Commit.

Do not promote a capability into `createDriftCapabilities()` until storage, CLI, MCP, and release proof are green for that capability.

---

## Phase 1: Fact Quality, Provenance, Unknowns

### Task 1: Add Fact Quality Schema

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Test: `packages/core/test/domain.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests:

```ts
it("validates fact quality provenance on parsed facts", () => {
  expect(FactRecordSchema.parse({
    id: "fact_route_users_get",
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    file_path: "app/api/users/route.ts",
    kind: "route_declared",
    name: "GET /api/users",
    value: "/api/users",
    start_line: 1,
    end_line: 3,
    source_span: { start_line: 1, start_column: 1, end_line: 3, end_column: 2 },
    ast_node_kind: "ExportedFunction",
    extraction_method: "next_app_router_parser",
    extractor_version: "0.1.0",
    parser_version: "0.1.0",
    confidence: 0.98,
    confidence_label: "high",
    evidence_level: "ast",
    resolution_status: "resolved",
    staleness_status: "fresh",
    last_seen_scan_id: "scan_abc"
  })).toMatchObject({
    confidence_label: "high",
    resolution_status: "resolved"
  });
});

it("rejects parsed facts without extraction provenance", () => {
  expect(() => FactRecordSchema.parse({
    id: "fact_missing_provenance",
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    file_path: "app/api/users/route.ts",
    kind: "route_declared",
    name: "GET",
    start_line: 1,
    end_line: 1
  })).toThrow();
});
```

- [ ] **Step 2: Run red test**

Run:

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "fact quality provenance"
```

Expected: FAIL because `FactRecordSchema` does not require provenance fields.

- [ ] **Step 3: Add minimal domain/schema fields**

Add:

```ts
export type FactEvidenceLevel = "path" | "text" | "ast" | "graph" | "heuristic";
export type FactResolutionStatus = "resolved" | "unresolved" | "partial" | "unsupported";
export type FactStalenessStatus = "fresh" | "stale" | "unknown";
export type ConfidenceLabel = "certain" | "high" | "medium" | "low" | "heuristic";
```

Extend `FactRecord` with:

```ts
source_span: {
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
};
ast_node_kind: string | null;
extraction_method: string;
extractor_version: string;
parser_version: string;
confidence: number;
confidence_label: ConfidenceLabel;
evidence_level: FactEvidenceLevel;
resolution_status: FactResolutionStatus;
staleness_status: FactStalenessStatus;
last_seen_scan_id: string;
```

- [ ] **Step 4: Run green test**

Run:

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "fact quality provenance"
```

Expected: PASS.

### Task 2: Persist Fact Quality

**Files:**

- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`

- [ ] **Step 1: Write failing storage test**

Add:

```ts
it("persists fact quality provenance fields", async () => {
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertFacts([factWithQuality({
    id: "fact_route_users_get",
    kind: "route_declared",
    confidence_label: "high",
    resolution_status: "resolved",
    evidence_level: "ast"
  })]);

  expect(storage.listFacts("scan_abc")[0]).toMatchObject({
    extraction_method: "next_app_router_parser",
    confidence_label: "high",
    resolution_status: "resolved",
    evidence_level: "ast"
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "fact quality provenance"
```

Expected: FAIL because the facts table does not have the new fields.

- [ ] **Step 3: Add migration `014_fact_quality`**

Add nullable-safe columns with defaults for existing facts:

```sql
ALTER TABLE facts ADD COLUMN source_span_json TEXT NOT NULL DEFAULT '{"start_line":1,"start_column":1,"end_line":1,"end_column":1}';
ALTER TABLE facts ADD COLUMN ast_node_kind TEXT;
ALTER TABLE facts ADD COLUMN extraction_method TEXT NOT NULL DEFAULT 'legacy_parser';
ALTER TABLE facts ADD COLUMN extractor_version TEXT NOT NULL DEFAULT '0.1.0';
ALTER TABLE facts ADD COLUMN parser_version TEXT NOT NULL DEFAULT '0.1.0';
ALTER TABLE facts ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;
ALTER TABLE facts ADD COLUMN confidence_label TEXT NOT NULL DEFAULT 'certain';
ALTER TABLE facts ADD COLUMN evidence_level TEXT NOT NULL DEFAULT 'text';
ALTER TABLE facts ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'resolved';
ALTER TABLE facts ADD COLUMN staleness_status TEXT NOT NULL DEFAULT 'fresh';
ALTER TABLE facts ADD COLUMN last_seen_scan_id TEXT;
```

- [ ] **Step 4: Wire row serialization**

Update `upsertFacts()` and `factFromRow()` to round-trip all fields.

- [ ] **Step 5: Run green test**

```bash
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "fact quality provenance|schema migrations"
```

Expected: PASS.

### Task 3: Emit Fact Quality From Rust Engine

**Files:**

- Modify: `crates/drift-engine/src/facts.rs`
- Modify: `crates/drift-engine/src/main.rs`
- Test: `crates/drift-engine/tests/typescript_facts.rs`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing Rust test**

Add assertion:

```rust
assert_eq!(route_fact.extraction_method, "next_app_router_parser");
assert_eq!(route_fact.evidence_level, "ast");
assert_eq!(route_fact.resolution_status, "resolved");
assert!(route_fact.confidence >= 0.95);
```

- [ ] **Step 2: Run red test**

```bash
cargo test -p drift-engine typescript_facts -- --nocapture
```

Expected: FAIL because Rust fact output does not include quality fields.

- [ ] **Step 3: Add fact quality fields to Rust output**

Each fact emitted by Rust must include:

- deterministic parser method,
- parser version,
- AST span,
- confidence label,
- resolution status.

Rules:

- direct AST extraction: `confidence_label: "certain"`, `evidence_level: "ast"`.
- path role inference: `confidence_label: "high"`, `evidence_level: "path"`.
- unresolved imports: `confidence_label: "medium"`, `resolution_status: "unresolved"`.
- heuristic role classification: `confidence_label: "heuristic"`.

- [ ] **Step 4: Run Rust and CLI focused tests**

```bash
cargo test -p drift-engine typescript_facts
pnpm --filter @drift/cli test -- test/cli.test.ts -t "scans a repo"
```

Expected: PASS.

### Task 4: Add Parser Gap Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/cli/src/commands/scan.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Define `ParserGap`**

```ts
export type ParserGapKind =
  | "unresolved_import"
  | "unresolved_symbol"
  | "unknown_file_role"
  | "mixed_file_role"
  | "unsupported_framework_pattern"
  | "parser_error"
  | "partial_parse"
  | "dynamic_import_unresolved"
  | "reflection_or_magic_detected";

export interface ParserGap {
  schema_version: "drift.parser_gap.v1";
  gap_id: string;
  repo_id: string;
  scan_id: string;
  kind: ParserGapKind;
  file_path: string;
  start_line: number;
  end_line: number;
  confidence_impact: "none" | "lowers_file" | "lowers_flow" | "blocks_enforcement";
  message: string;
  evidence_refs: string[];
  created_at: string;
}
```

- [ ] **Step 2: Write failing CLI/MCP tests**

CLI test must assert scan status includes:

```json
{
  "parser_gaps": {
    "total_count": 1,
    "by_kind": { "unresolved_import": 1 },
    "confidence_impact": { "lowers_flow": 1 }
  }
}
```

MCP `get_scan_status` must return the same summary.

- [ ] **Step 3: Persist and expose gaps**

Add migration `015_parser_gaps` and storage methods:

```ts
upsertParserGaps(gaps: ParserGap[]): void;
listParserGaps(repoId: string, scanId?: string): ParserGap[];
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "parser gap"
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "parser gap"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "parser gap"
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "parser gap"
```

Expected: PASS.

---

## Phase 2: Role Ontology And Layer Architecture

### Task 5: Add Role Ontology Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/query/src/role-ontology.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/query/test/query.test.ts`

- [ ] **Step 1: Write failing ontology tests**

Add query tests:

```ts
it("classifies route to data access as a forbidden role edge", () => {
  const result = evaluateRoleEdge({
    from_role: "route",
    to_role: "data_access",
    edge_kind: "imports"
  });

  expect(result).toMatchObject({
    allowed: false,
    severity: "blocking",
    reason_code: "route_must_not_import_data_access"
  });
});

it("classifies service to data access as allowed", () => {
  expect(evaluateRoleEdge({
    from_role: "service",
    to_role: "data_access",
    edge_kind: "imports"
  })).toMatchObject({ allowed: true });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "role edge"
```

Expected: FAIL because `evaluateRoleEdge` does not exist.

- [ ] **Step 3: Implement role ontology**

Create:

```ts
export type CanonicalRole =
  | "route"
  | "controller"
  | "service"
  | "domain"
  | "data_access"
  | "schema"
  | "model"
  | "validation"
  | "auth"
  | "middleware"
  | "queue_worker"
  | "cron_job"
  | "event_handler"
  | "adapter"
  | "client_sdk"
  | "component"
  | "hook"
  | "test_unit"
  | "test_integration"
  | "test_e2e"
  | "config"
  | "script"
  | "migration"
  | "generated"
  | "documentation"
  | "unknown"
  | "mixed_role";
```

Implement `evaluateRoleEdge()` using the initial edge policy from section 3.

- [ ] **Step 4: Run green test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "role edge"
```

Expected: PASS.

### Task 6: Add Layer Architecture Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/query/src/layer-architecture.ts`
- Modify: `packages/query/src/index.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/query/test/query.test.ts`

- [ ] **Step 1: Write failing layer tests**

```ts
it("builds a route service data access architecture proof", () => {
  const proof = buildLayerArchitectureProof({
    entrypoint: "apps/web/app/api/users/route.ts",
    facts,
    graph_edges,
    architecture: {
      schema_version: "drift.layer_architecture.v1",
      layers: [
        { id: "route", role: "route", position: "entrypoint" },
        { id: "service", role: "service", position: "middle" },
        { id: "data_access", role: "data_access", position: "terminal" }
      ],
      allowed_edges: [{ from_layer: "route", to_layer: "service" }, { from_layer: "service", to_layer: "data_access" }],
      forbidden_edges: [{ from_layer: "route", to_layer: "data_access" }]
    }
  });

  expect(proof).toMatchObject({
    entrypoint_layer: "route",
    terminal_layers_reached: ["data_access"],
    forbidden_edges_present: []
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "architecture proof"
```

Expected: FAIL because the contract and builder do not exist.

- [ ] **Step 3: Implement `LayerArchitectureContract`**

```ts
export interface LayerArchitectureContract {
  schema_version: "drift.layer_architecture.v1";
  architecture_id: string;
  repo_id: string;
  layers: Array<{
    id: string;
    role: CanonicalRole;
    position: "entrypoint" | "middle" | "terminal" | "support";
  }>;
  allowed_edges: Array<{ from_layer: string; to_layer: string; edge_kind?: string }>;
  forbidden_edges: Array<{ from_layer: string; to_layer: string; edge_kind?: string }>;
  soft_edges: Array<{ from_layer: string; to_layer: string; reason: string }>;
  version: number;
}
```

- [ ] **Step 4: Run green test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "layer architecture"
pnpm --filter @drift/query test -- test/query.test.ts -t "architecture proof"
```

Expected: PASS.

### Task 7: Materialize Role/Layer Rules Into RepoContract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/cli/src/domain/contract-materialization.ts`
- Modify: `packages/cli/src/commands/contract.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing contract materialization test**

```ts
it("materializes accepted architecture layers into the repo contract", async () => {
  const { databasePath } = await seedAcceptedDatabase();
  const payload = await runCli([
    "--db", databasePath,
    "contract", "show",
    "--repo", "repo_abc",
    "--json"
  ]);

  expect(JSON.parse(payload.stdout).contract.layer_architecture).toMatchObject({
    schema_version: "drift.layer_architecture.v1",
    layers: expect.arrayContaining([
      expect.objectContaining({ role: "route" }),
      expect.objectContaining({ role: "service" }),
      expect.objectContaining({ role: "data_access" })
    ])
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "architecture layers"
```

Expected: FAIL because `RepoContract` does not include `layer_architecture`.

- [ ] **Step 3: Add default narrow architecture for current wedge**

When an accepted `api_route_no_direct_data_access` convention exists, materialize:

```txt
route -> service -> data_access
route -> data_access forbidden
```

- [ ] **Step 4: Run green test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "architecture layers|contract show"
```

Expected: PASS.

---

## Phase 3: Adapter, Entrypoint, Data Operation Taxonomy

### Task 8: Define Framework Adapter Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/adapters/src/next-app-router.ts`
- Modify: `packages/adapters/src/index.ts`
- Test: `packages/adapters/test/adapters.test.ts`

- [ ] **Step 1: Write failing adapter contract test**

```ts
it("describes Next.js app router entrypoints and boundaries", () => {
  expect(nextAppRouterAdapter()).toMatchObject({
    schema_version: "drift.framework_adapter.v1",
    framework: "next",
    adapter_id: "next_app_router",
    route_discovery: {
      path_globs: ["app/**/route.ts", "app/**/route.tsx"],
      method_exports: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    },
    entrypoint_patterns: expect.arrayContaining(["api_route", "server_action", "middleware"])
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/adapters test -- test/adapters.test.ts -t "Next.js app router"
```

Expected: FAIL because adapter contract does not exist.

- [ ] **Step 3: Implement `FrameworkAdapterContract`**

Fields:

```ts
adapter_id
framework
version
route_discovery
method_discovery
handler_shape
middleware_shape
server_client_boundary
config_files
test_conventions
entrypoint_patterns
data_access_patterns
generated_file_patterns
unsupported_patterns
```

- [ ] **Step 4: Run green test**

```bash
pnpm --filter @drift/adapters test -- test/adapters.test.ts -t "Next.js app router"
```

Expected: PASS.

### Task 9: Add Entrypoint Taxonomy

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `crates/drift-engine/src/facts.rs`
- Test: `crates/drift-engine/tests/typescript_facts.rs`
- Test: `packages/core/test/domain.test.ts`

- [ ] **Step 1: Write failing schema test**

```ts
it("validates typed entrypoint facts", () => {
  expect(EntrypointFactSchema.parse({
    schema_version: "drift.entrypoint_fact.v1",
    entrypoint_id: "entrypoint_api_users_get",
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    kind: "api_route",
    file_path: "app/api/users/route.ts",
    symbol: "GET",
    route_pattern: "/api/users",
    method: "GET",
    adapter_id: "next_app_router",
    confidence_label: "certain",
    evidence_refs: ["fact_route_users_get"]
  })).toMatchObject({ kind: "api_route" });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "entrypoint facts"
```

Expected: FAIL.

- [ ] **Step 3: Add taxonomy**

```txt
api_route
page_route
server_action
cli_command
cron_job
queue_consumer
webhook_handler
middleware
test_entrypoint
script
migration
lambda_handler
worker
```

- [ ] **Step 4: Emit API route entrypoint facts from existing route facts**

Do not add non-route detection yet. For this task, only map current Next route facts into `api_route`.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "entrypoint facts"
cargo test -p drift-engine typescript_facts
```

Expected: PASS.

### Task 10: Add Data Operation Risk Taxonomy

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `crates/drift-engine/src/facts.rs`
- Create: `packages/query/src/data-operation-risk.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `crates/drift-engine/tests/typescript_facts.rs`

- [ ] **Step 1: Write failing risk classification tests**

```ts
it("classifies data operations by side effect risk", () => {
  expect(classifyDataOperationRisk({
    receiver_name: "prisma.user",
    operation_name: "delete"
  })).toMatchObject({
    operation_family: "orm_operation",
    effect: "delete",
    risk: "destructive_write"
  });

  expect(classifyDataOperationRisk({
    receiver_name: "process.env",
    operation_name: "SECRET"
  })).toMatchObject({
    operation_family: "env_secret_read",
    effect: "secret_access"
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "data operations by side effect"
```

Expected: FAIL.

- [ ] **Step 3: Implement taxonomy**

Families:

```txt
orm_operation
raw_sql_operation
http_api_call
filesystem_write
cache_operation
queue_publish
queue_consume
env_secret_read
external_service_call
auth_session_read
payment_operation
email_send
```

Effects:

```txt
read
write
delete
mutation
side_effect
external_effect
secret_access
network_effect
```

- [ ] **Step 4: Run green test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "data operations by side effect"
```

Expected: PASS.

---

## Phase 4: Symbol Identity, Change Impact, Test Intelligence

### Task 11: Add Symbol Identity Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Create: `packages/query/src/symbol-identity.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`
- Test: `packages/query/test/query.test.ts`

- [ ] **Step 1: Write failing symbol identity test**

```ts
it("tracks canonical symbol identity across import aliases and re-exports", () => {
  const identity = buildSymbolIdentity({
    symbol_name: "getUserById",
    declared_in: "server/services/users.ts",
    exported_from: ["server/services/users.ts", "server/services/index.ts"],
    imported_as: [{ file_path: "app/api/users/route.ts", local_name: "loadUser" }],
    call_sites: [{ file_path: "app/api/users/route.ts", start_line: 4 }]
  });

  expect(identity).toMatchObject({
    canonical_definition: "server/services/users.ts#getUserById",
    aliases: ["loadUser"],
    re_export_chain: ["server/services/index.ts"]
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "symbol identity"
```

Expected: FAIL.

- [ ] **Step 3: Add `SymbolIdentity`**

```ts
export interface SymbolIdentity {
  schema_version: "drift.symbol_identity.v1";
  symbol_id: string;
  repo_id: string;
  scan_id: string;
  symbol_name: string;
  kind: "function" | "class" | "const" | "type" | "unknown";
  declared_in: string;
  exported_from: string[];
  imported_as: Array<{ file_path: string; local_name: string }>;
  re_export_chain: string[];
  canonical_definition: string;
  call_sites: Array<{ file_path: string; start_line: number; end_line: number }>;
  references: Array<{ file_path: string; start_line: number; end_line: number }>;
  visibility: "private" | "module" | "exported" | "public";
}
```

- [ ] **Step 4: Persist identities**

Add migration `016_symbol_identities` and storage methods:

```ts
upsertSymbolIdentities(identities: SymbolIdentity[]): void;
listSymbolIdentities(repoId: string, scanId?: string): SymbolIdentity[];
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "symbol identity"
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "symbol identity"
pnpm --filter @drift/query test -- test/query.test.ts -t "symbol identity"
```

Expected: PASS.

### Task 12: Add Change Impact Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/query/src/change-impact.ts`
- Modify: `packages/cli/src/commands/prepare.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing change-impact test**

```ts
it("maps a changed repository function to affected routes and tests", () => {
  const impact = buildChangeImpact({
    changed_files: ["server/repositories/users.ts"],
    graph,
    facts,
    tests
  });

  expect(impact).toMatchObject({
    affected_routes: expect.arrayContaining(["GET /api/users"]),
    affected_services: expect.arrayContaining(["server/services/users.ts"]),
    affected_data_ops: expect.arrayContaining(["prisma.user.findMany"]),
    affected_tests: expect.arrayContaining(["server/services/users.test.ts"])
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "change impact"
```

Expected: FAIL.

- [ ] **Step 3: Implement `ChangeImpact`**

```ts
export interface ChangeImpact {
  schema_version: "drift.change_impact.v1";
  repo_id: string;
  scan_id: string;
  changed_files: string[];
  changed_symbols: string[];
  changed_routes: string[];
  changed_tests: string[];
  changed_contract_surfaces: string[];
  affected_routes: string[];
  affected_services: string[];
  affected_data_ops: string[];
  affected_tests: string[];
  affected_callers: string[];
  affected_importers: string[];
  missing_test_candidates: string[];
}
```

- [ ] **Step 4: Add to preflight**

`drift prepare --json` and MCP `get_task_preflight` must include:

```json
{
  "change_impact": {
    "affected_routes": [],
    "affected_services": [],
    "affected_data_ops": [],
    "affected_tests": [],
    "missing_test_candidates": []
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "change impact"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "change impact"
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "change impact"
```

Expected: PASS.

### Task 13: Add Test Intelligence Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/query/src/test-intelligence.ts`
- Modify: `packages/cli/src/commands/prepare.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing test relevance test**

```ts
it("selects route and service tests relevant to a changed route flow", () => {
  const result = selectRelevantTests({
    changed_file: "app/api/users/route.ts",
    route_flow,
    test_facts
  });

  expect(result).toMatchObject({
    closest_tests: ["app/api/users/route.test.ts", "server/services/users.test.ts"],
    missing_test_candidate: false,
    required_check_hint: "npm test -- users"
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "relevant tests"
```

Expected: FAIL.

- [ ] **Step 3: Implement `TestIntelligence`**

```ts
export interface TestIntelligence {
  schema_version: "drift.test_intelligence.v1";
  test_subject: string;
  test_type: "unit" | "integration" | "e2e" | "unknown";
  test_framework: "vitest" | "jest" | "playwright" | "unknown";
  test_file_for: string[];
  covered_symbols: string[];
  covered_routes: string[];
  mocked_dependencies: string[];
  fixture_usage: string[];
  snapshot_usage: boolean;
  missing_test_candidate: boolean;
  stale_test_candidate: boolean;
}
```

- [ ] **Step 4: Add required check selection**

When `ChangeImpact` includes affected routes/services and matching tests exist, prepare should prefer scoped test commands when safe commands include `npm test`, `pnpm test`, or `vitest`.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "relevant tests"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "test relevance"
```

Expected: PASS.

---

## Phase 5: Task, Preflight, Context Policy

### Task 14: Add Agent Task Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/query/src/task-intent.ts`
- Modify: `packages/cli/src/commands/prepare.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing task model test**

```ts
it("classifies a user endpoint filtering task", () => {
  expect(classifyAgentTask("add filtering to users endpoint")).toMatchObject({
    task_intent: "feature",
    target_area: "user_management",
    likely_entrypoint_kinds: ["api_route"],
    human_approval_needed: false
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "classifies a user endpoint"
```

Expected: FAIL.

- [ ] **Step 3: Implement `AgentTaskContract`**

```ts
export type AgentTaskIntent =
  | "bugfix"
  | "feature"
  | "refactor"
  | "test_addition"
  | "migration"
  | "dependency_update"
  | "config_change"
  | "security_change"
  | "performance_change"
  | "unknown";

export interface AgentTask {
  schema_version: "drift.agent_task.v1";
  task_id: string;
  task_text: string;
  task_intent: AgentTaskIntent;
  target_area: string | null;
  likely_files: string[];
  likely_entrypoint_kinds: EntrypointKind[];
  required_context: string[];
  risky_contracts: string[];
  required_checks: string[];
  forbidden_actions: string[];
  human_approval_needed: boolean;
}
```

- [ ] **Step 4: Add to CLI/MCP preflight**

`drift prepare --json` and MCP `get_task_preflight` must include:

```json
{
  "task_model": {
    "schema_version": "drift.agent_task.v1",
    "task_intent": "feature",
    "likely_entrypoint_kinds": ["api_route"]
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "agent task"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "task model"
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "task model"
```

Expected: PASS.

### Task 15: Upgrade Agent Preflight Contract

**Files:**

- Modify: `packages/core/src/agent-envelope.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/cli/src/commands/prepare.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing schema test**

```ts
it("validates task-aware preflight packets", () => {
  expect(AgentPreflightPacketSchema.parse({
    schema_version: "drift.agent_preflight.v2",
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    task_model,
    repo_map_summary,
    accepted_conventions: [],
    risky_areas: [],
    change_impact,
    test_intelligence: [],
    parser_gaps: [],
    required_checks: [],
    forbidden_actions: [],
    context_policy,
    confidence: {
      graph_confidence: 0.92,
      reasons: []
    }
  })).toMatchObject({ schema_version: "drift.agent_preflight.v2" });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "task-aware preflight"
```

Expected: FAIL.

- [ ] **Step 3: Implement `AgentPreflightPacketV2`**

Required sections:

- task model,
- repo topology summary,
- accepted conventions,
- relevant files,
- role/layer proof,
- change impact,
- test intelligence,
- parser gaps,
- required checks,
- context policy,
- forbidden actions,
- confidence.

- [ ] **Step 4: Preserve V1 compatibility**

Keep existing `response_schema: "drift.task.preflight.v1"` unless introducing `drift.task.preflight.v2` in a controlled migration. Add both during transition:

```json
{
  "response_schema": "drift.task.preflight.v2",
  "legacy_packet": { "schema_version": "drift.agent.preflight.v3" }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "task-aware preflight"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "preflight v2"
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "preflight v2"
```

Expected: PASS.

### Task 16: Complete Context Policy Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/cli/src/commands/policy.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing policy matrix test**

```ts
it("returns agent permission and egress matrix for allowed context", async () => {
  const result = await runCli([
    "--db", databasePath,
    "policy", "check-context",
    "--repo", "repo_abc",
    "--path", "apps/web/app/api/users/route.ts",
    "--json"
  ]);

  expect(JSON.parse(result.stdout).context_policy).toMatchObject({
    can_read_repo_map: true,
    can_read_source_snippets: false,
    can_read_contract: true,
    can_read_findings: true,
    can_execute_commands: false,
    can_modify_contract: false,
    can_create_waiver: false,
    can_request_human_approval: true,
    can_access_secret_like_files: false,
    egress_level: "symbol_only"
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "permission and egress matrix"
```

Expected: FAIL.

- [ ] **Step 3: Add policy matrix**

Use `RepoContract.context_egress` and `agent_permissions` to compute:

```ts
can_read_repo_map
can_read_source_snippets
can_read_contract
can_read_findings
can_execute_commands
can_modify_contract
can_create_waiver
can_request_human_approval
can_access_secret_like_files
can_emit_patch
egress_level: "no_source" | "symbol_only" | "snippet_allowed" | "full_file_allowed"
```

- [ ] **Step 4: Run CLI/MCP parity tests**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "permission and egress matrix"
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "permission and egress matrix"
```

Expected: PASS.

---

## Phase 6: Proof Binding, Findings, Waivers, Baselines, Audit

### Task 17: Bind Required Check Proof To Exact State

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/cli/src/commands/checks-run.ts`
- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`

- [ ] **Step 1: Write failing proof-binding test**

```ts
it("rejects stale required check proof after the diff hash changes", async () => {
  await runCli([
    "--db", databasePath,
    "checks", "run",
    "--repo", "repo_abc",
    "--command", "pnpm test",
    "--diff-file", firstDiff,
    "--json"
  ]);

  const result = await runCli([
    "--db", databasePath,
    "check",
    "--repo", "repo_abc",
    "--diff-file", secondDiff,
    "--scope", "changed-hunks",
    "--json"
  ]);

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout).findings[0]).toMatchObject({
    actual_layer: "required_check_stale_proof",
    expected_layer: "required_check_execution"
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "stale required check proof"
```

Expected: FAIL because proof is not bound to diff hash.

- [ ] **Step 3: Extend `RequiredCheckExecution`**

Add:

```ts
git_branch: string;
git_commit_sha: string;
worktree_dirty: boolean;
untracked_files_present: boolean;
diff_hash: string;
lockfile_hash: string | null;
package_manager: string | null;
contract_fingerprint: string;
repo_contract_version: number;
```

- [ ] **Step 4: Require matching proof in check**

`runRequiredCheckProofCheck()` must verify:

- command matches,
- status passed,
- active contract id matches,
- contract fingerprint matches,
- diff hash matches when `--diff-file` or `--diff` is used,
- worktree dirty state did not become dirtier after proof,
- lockfile hash matches when present.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "required check execution"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "required check proof|stale required check proof"
```

Expected: PASS.

### Task 18: Complete Finding Severity And Confidence Model

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/cli/src/check/run-check.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing finding schema test**

```ts
it("validates finding confidence and drift category", () => {
  expect(FindingSchema.parse({
    ...findingFixture,
    severity: "release_blocking",
    confidence_label: "certain",
    drift_category: "new_violation",
    introduced_by_diff: true,
    affected_contract: "agent_contract_api_flow"
  })).toMatchObject({
    severity: "release_blocking",
    drift_category: "new_violation"
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "finding confidence"
```

Expected: FAIL.

- [ ] **Step 3: Add finding fields**

Severity:

```txt
info
warning
error
blocking
release_blocking
```

Confidence:

```txt
certain
high
medium
low
heuristic
```

Drift categories:

```txt
new_violation
existing_violation
worsened_violation
improved_violation
new_convention_candidate
convention_conflict
architecture_regression
test_coverage_regression
unresolved_graph_regression
missing_proof
parser_gap
```

- [ ] **Step 4: Map existing findings**

- direct data access: `certain`, `new_violation` or `existing_violation`.
- fuzzy duplicate helper: `high`, warning.
- missing required check proof: `certain`, `missing_proof`.
- parser gap: `medium`, `parser_gap`.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "finding confidence"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "finding confidence|parser gap"
```

Expected: PASS.

### Task 19: Add Waiver Reapproval-On-Change

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/cli/src/check/waivers.ts`
- Modify: `packages/cli/src/commands/contract.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing waiver test**

```ts
it("does not honor a waiver when the waived file changed and reapproval is required", async () => {
  await addWaiver({
    path_globs: ["app/api/health/route.ts"],
    requires_reapproval_on_change: true
  });

  const result = await runCli([
    "--db", databasePath,
    "check",
    "--repo", "repo_abc",
    "--diff-file", changedHealthRouteDiff,
    "--scope", "changed-hunks",
    "--json"
  ]);

  expect(JSON.parse(result.stdout).findings[0]).toMatchObject({
    title: "Waiver requires reapproval after file change"
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "waiver requires reapproval"
```

Expected: FAIL.

- [ ] **Step 3: Extend waiver/exception schema**

Add:

```ts
requires_reapproval_on_change: boolean;
approved_file_hashes: Array<{ file_path: string; content_hash: string }>;
```

- [ ] **Step 4: Enforce waiver staleness**

If a waiver applies but file hash changed and reapproval is required, do not suppress the finding. Add an additional warning finding with remediation command.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/cli test -- test/cli.test.ts -t "waiver requires reapproval|contract waiver"
```

Expected: PASS.

### Task 20: Add Audit Before/After Hashes

**Files:**

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/cli/src/domain/governance.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`

- [ ] **Step 1: Write failing audit schema test**

```ts
it("validates audit events with before and after object hashes", () => {
  expect(AuditEventSchema.parse({
    ...auditFixture,
    before_hash: "0".repeat(64),
    after_hash: "1".repeat(64),
    object_schema_version: "drift.repo_contract.v1"
  })).toMatchObject({
    before_hash: "0".repeat(64),
    after_hash: "1".repeat(64)
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "before and after object hashes"
```

Expected: FAIL.

- [ ] **Step 3: Add audit hash fields**

```ts
before_hash: string | null;
after_hash: string | null;
object_schema_version: string | null;
```

- [ ] **Step 4: Populate for repo contract mutations**

For convention accept/reject/edit, contract import, waiver add/remove, policy changes, and agent permission changes:

- compute `before_hash` from canonical object before mutation,
- compute `after_hash` after mutation,
- include schema version.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "audit"
pnpm --filter @drift/storage test -- test/sqlite-storage.test.ts -t "audit"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "audit"
```

Expected: PASS.

---

## Phase 7: Repo Map Topology, CLI/MCP, Release Proof

### Task 21: Add Topological Repo Map Contract

**Files:**

- Modify: `packages/core/src/domain.ts`
- Create: `packages/query/src/repo-topology.ts`
- Modify: `packages/cli/src/domain/repo-map.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing topology test**

```ts
it("builds an area-oriented repo topology", () => {
  const topology = buildRepoTopology({ facts, graph, contract });

  expect(topology).toMatchObject({
    schema_version: "drift.repo_topology.v1",
    areas: expect.arrayContaining([
      expect.objectContaining({
        name: "User Management",
        entrypoints: expect.arrayContaining(["GET /api/users"]),
        services: expect.arrayContaining(["server/services/users.ts"]),
        data_access: expect.arrayContaining(["server/repositories/users.ts"]),
        tests: expect.arrayContaining(["server/services/users.test.ts"])
      })
    ]),
    unknown_zones: []
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "repo topology"
```

Expected: FAIL.

- [ ] **Step 3: Implement topology**

Topology sections:

```txt
areas
entrypoints
modules
layers
flows
tests
configs
external_systems
risky_zones
generated_zones
unknown_zones
```

- [ ] **Step 4: Expose through CLI/MCP repo map**

Add to repo map JSON:

```json
{
  "topology": {
    "schema_version": "drift.repo_topology.v1",
    "areas": [],
    "unknown_zones": []
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/query test -- test/query.test.ts -t "repo topology"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "repo topology"
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "repo topology"
```

Expected: PASS.

### Task 22: Add Contract Parity Ledger

**Files:**

- Create: `packages/core/src/contract-ledger.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/commands/capabilities.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing ledger test**

```ts
it("reports contract parity for all canonical contracts", () => {
  const ledger = createContractParityLedger();

  expect(ledger.contracts.map((contract) => contract.name)).toEqual([
    "ParsedFactContract",
    "FactQualityContract",
    "GraphContract",
    "RoleOntologyContract",
    "LayerArchitectureContract",
    "AdapterContract",
    "DataOperationContract",
    "EntrypointContract",
    "SymbolIdentityContract",
    "ChangeImpactContract",
    "TestIntelligenceContract",
    "ConventionElectionContract",
    "RepoContract",
    "RuleContract",
    "FindingContract",
    "WaiverContract",
    "BaselineContract",
    "CheckProofContract",
    "AgentTaskContract",
    "AgentPreflightContract",
    "ContextPolicyContract",
    "AuditContract",
    "ReleaseProofContract"
  ]);
  expect(ledger.summary.not_implemented_count).toBe(0);
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "contract parity"
```

Expected: FAIL.

- [ ] **Step 3: Implement ledger**

Each ledger row:

```ts
{
  name: string;
  schema: "defined" | "missing";
  storage: "persisted" | "derived" | "not_applicable" | "missing";
  cli: "exposed" | "internal" | "missing";
  mcp: "exposed" | "not_applicable" | "missing";
  release_proof: "covered" | "not_required" | "missing";
  beta_required: boolean;
  confidence: "complete" | "partial" | "experimental";
}
```

- [ ] **Step 4: Expose through capabilities**

`drift capabilities --json` and MCP `get_capabilities` must include:

```json
{
  "contract_parity": {
    "summary": {
      "complete_count": 23,
      "partial_count": 0,
      "missing_count": 0
    }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "contract parity"
pnpm --filter @drift/cli test -- test/cli.test.ts -t "contract parity"
pnpm --filter @drift/mcp test -- test/mcp.test.ts -t "contract parity"
```

Expected: PASS.

### Task 23: Extend Beta Proof For 100% Contract Parity

**Files:**

- Modify: `scripts/run-beta-proof.mjs`
- Modify: `scripts/generate-release-proof.mjs`
- Test: `test/e2e/release-hygiene.test.ts`

- [ ] **Step 1: Write failing e2e test**

```ts
it("requires 100 percent contract parity in beta proof", () => {
  const betaProof = JSON.parse(execFileSync("node", ["scripts/run-beta-proof.mjs"], { encoding: "utf8" }));

  expect(betaProof.beta_proof.contract_parity_verified).toBe(true);
  expect(betaProof.evidence.contract_parity.summary).toMatchObject({
    missing_count: 0,
    partial_beta_required_count: 0
  });
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm exec vitest run test/e2e/release-hygiene.test.ts -t "contract parity"
```

Expected: FAIL.

- [ ] **Step 3: Add proof checks**

Beta proof must fail if:

- any beta-required contract is missing schema,
- any beta-required CLI/MCP surface is missing,
- any beta-required storage surface is missing,
- any beta-required release proof field is missing,
- product claims include a deferred or partial surface.

- [ ] **Step 4: Add release proof ingestion**

`generate-release-proof.mjs --require-beta-proof` must require:

```txt
contract_parity_verified=true
missing_count=0
partial_beta_required_count=0
```

- [ ] **Step 5: Run e2e**

```bash
pnpm exec vitest run test/e2e/release-hygiene.test.ts -t "contract parity|executable beta proof"
```

Expected: PASS.

---

## Phase 8: Product Claim Promotion

### Task 24: Promote Only Proven Claims

**Files:**

- Modify: `packages/core/src/capabilities.ts`
- Modify: `docs/architecture/beta-claims.json`
- Modify: `scripts/validate-product-claims.mjs`
- Test: `test/e2e/release-hygiene.test.ts`

- [ ] **Step 1: Write failing product-claims test**

```ts
it("does not promote duplicate helper detection until full parity says complete", async () => {
  const capabilities = createDriftCapabilities();

  expect(capabilities.deferred).toContain("duplicate_helper_detection");
  expect(capabilities.supported_wedge.convention_kinds).not.toContain("duplicate_helper_detection");
});
```

- [ ] **Step 2: Run red/green as appropriate**

Run:

```bash
pnpm --filter @drift/core test -- test/domain.test.ts -t "duplicate helper detection"
```

Expected now: PASS while broad duplicate-helper detection remains deferred.

- [ ] **Step 3: Add promotion rule**

A capability can move from `deferred` to supported only when:

- schema exists,
- storage exists or derived status is documented,
- CLI/MCP parity exists,
- release proof covers it,
- capability-specific fixture proves it,
- docs no longer mark it deferred.

- [ ] **Step 4: Run claims gate**

```bash
pnpm validate:claims
```

Expected: PASS.

---

## 5. Final Verification Gate

When all tasks are complete, run:

```bash
pnpm verify:ci
```

Expected:

- build passes,
- typecheck passes,
- Rust tests pass,
- package tests pass,
- e2e tests pass,
- engine format check passes,
- clippy passes,
- architecture boundary check passes,
- release matrix validates,
- product claims validate,
- beta proof passes,
- `git diff --check` passes.

Then run:

```bash
node scripts/run-beta-proof.mjs --output /tmp/drift-beta-proof.json
DRIFT_VERIFY_CI_STATUS=passed node scripts/generate-release-proof.mjs \
  --beta-proof-file /tmp/drift-beta-proof.json \
  --require-beta-proof
```

Expected:

```txt
beta_proof.contract_parity_verified = true
release_proof.verification.beta_missing = []
```

## 6. Definition Of 100% Done

Drift reaches 100% parity for this plan when:

- every contract in section 1 has a domain type and Zod schema,
- beta-required contracts have storage or an explicit derived read model,
- CLI and MCP expose the same agent-facing truth,
- all accepted convention/election transitions are auditable,
- `prepare` emits typed task, impact, policy, unknowns, and required proof,
- `check` blocks only accepted enforceable contracts with evidence,
- missing/stale proof is a structured finding,
- parser gaps lower confidence and are visible,
- waivers can require reapproval on change,
- beta/release proof fails if any beta-critical contract is partial,
- `pnpm verify:ci` passes from a clean worktree.

## 7. Build Order

Recommended implementation order:

1. Fact quality and parser gaps.
2. Role ontology and layer architecture.
3. Adapter, entrypoint, and data operation taxonomy.
4. Symbol identity.
5. Change impact.
6. Test intelligence.
7. Agent task and preflight v2.
8. Proof binding.
9. Waiver reapproval and audit object hashes.
10. Repo topology.
11. Contract parity ledger.
12. Release proof and product claim promotion.

Do not start multi-framework expansion until the Next.js adapter, route/service/data-access layer model, task preflight, and proof binding are complete and release-proven.
