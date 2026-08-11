# Capability, Version, And Boundary Hardening TDD

Date: 2026-05-25
Status: next implementation-driving TDD after shared readiness lands
Scope: architecture boundary gate, scan capability report, machine-contract version binding, and evidence proof persistence.

## Purpose

The readiness slice makes Drift say whether a surface is safe for blocking, advisory only, or refusal. This TDD defines the next layer under that: the durable inputs that readiness and checks should trust.

Target claim:

```text
Drift can prove which engine, schemas, capabilities, graph evidence, and accepted contracts were used for a scan/check, and package boundaries prevent that proof logic from drifting into the wrong layer.
```

Do not fold this into broad parser work, shared CLI/MCP builders, or new product claims. This is a hardening slice.

## Current Truth

- `@drift/query` now owns `buildReadiness` and exports `drift.readiness.v1`.
- Scan manifests persist `scanner_version`, `adapter_versions`, and `rule_engine_version`.
- FactGraph artifacts persist `schema_version`, graph JSON, projected nodes/edges/evidence/diagnostics/completeness.
- Findings persist evidence refs, check id, repo contract id, graph path, and suggested fix.
- `check-boundaries.mjs` protects CLI/core/storage/MCP/engine-contract, but not `query` or `factgraph`.
- Capability data exists in engine stats/completeness/readiness, but not as one persisted scan-owned capability report.
- Version data exists, but not as one canonical version-binding object attached to scan/check/finding outputs.

## TDD Rules

No production code without a failing test first.

Each task follows:

1. RED: add the failing test.
2. Confirm it fails for the intended reason.
3. GREEN: make the smallest implementation change.
4. Run the focused tests.
5. Run the package gate.
6. Update docs/proof only after behavior exists.

## Contract Stack

### Existing Governance Contracts To Respect

This slice must follow the already-established Drift governance model. It may add proof metadata around these concepts, but it must not redefine them or bypass them.

#### Contract

A contract is a versioned machine-readable rule or proof boundary. Contract-backed behavior must be importable, inspectable, auditable, and tied to a schema version.

Rules:

- `RepoContract` remains the accepted repo policy source.
- `AcceptedConvention` remains the human-approved convention source.
- `AgentContract` remains the machine-readable agent guidance/check surface.
- Contract import/export must keep `contract_schema_version`.
- Contract-backed checks must include `repo_contract_id` and contract fingerprint/version proof.
- No inferred candidate can enforce blocking behavior until accepted by a human.

#### Convention

A convention is a human-governed repo rule. It can start as an inferred candidate, but it only becomes enforceable after review.

Rules:

- `ConventionCandidate` is evidence-backed suggestion only.
- `AcceptedConvention` is the only convention state that can feed blocking checks.
- Rejected/expired conventions must not produce active findings.
- Non-deterministic conventions must not run in `block` mode.
- Exceptions and waivers must remain explicit, auditable, and content-hash aware where reapproval is required.
- Findings must identify the convention that produced them with `convention_id`.

#### Election

An election is the governed lifecycle that turns evidence into a convention decision.

Allowed decisions:

```ts
type ConventionElectionDecision =
  | "dry_run"
  | "accepted"
  | "rejected"
  | "edited"
  | "archived"
  | "expired";
```

Rules:

- Mutating election decisions require explicit human confirmation.
- Every mutating election decision must append an audit event.
- Acceptance must preserve candidate evidence refs and counterexample refs.
- Acceptance must materialize or update the repo contract.
- `can_block` is true only when the accepted convention is deterministic and enforcement mode is `block`.
- This hardening slice may add version/capability/evidence proof to elections, but it must not let MCP or inferred candidates mutate election state.

#### Finding Proof

A finding is Drift's user-facing proof output. It must be traceable back to the scan, check, contract, convention, evidence, and version context that produced it.

Rules:

- Findings must include `check_id` when produced by `drift check`.
- Findings must include `repo_contract_id` for contract-backed checks.
- Findings must include `convention_id` or agent-contract id.
- Findings must include evidence refs with file path, scan id, file hash, and range when available.
- Blocking findings must only be emitted when readiness/capability proof allows blocking.
- Existing governance status preservation must stay intact for fixed, false-positive, accepted-drift, suppressed, and expired findings.

### Contract: Package Boundary Gate

Goal:

Prevent `query`, `factgraph`, `core`, `storage`, `engine-contract`, `mcp`, and CLI internals from drifting into circular or product-surface ownership.

Rules:

- `core` must not import CLI, storage, MCP, query, factgraph, or engine-contract.
- `factgraph` may import `core` types only and must not import storage, query, CLI, MCP, or engine-contract.
- `engine-contract` may import `factgraph` schemas if needed for the Rust/TS boundary, but must not import core, storage, query, CLI, or MCP.
- `storage` may import core and factgraph, but must not import query, CLI, or MCP.
- `query` may import core, factgraph, and storage read types. It must not import CLI, MCP, raw SQLite, filesystem writes, child process execution, or engine bridge code.
- `mcp` must not import CLI and must not expose mutation-like tool names.
- CLI may orchestrate all shared packages, but command modules must not import other command modules.

RED tests:

- Extend `test/e2e/release-hygiene.test.ts` or add `packages/cli/test/boundaries.test.ts`:
  - fails if `packages/cli/scripts/check-boundaries.mjs` does not include `query` and `factgraph` package roots;
  - fails if `query` imports `node:child_process`, raw SQLite, or `@drift/cli`;
  - fails if `factgraph` imports storage, query, CLI, MCP, or engine-contract;
  - fails if `core` imports any other Drift package.

Expected initial failure:

- `check-boundaries.mjs` does not include `query` or `factgraph`.

GREEN implementation:

- Add `query` and `factgraph` to `packageSrcRoots`.
- Add explicit package dependency checks for `query` and `factgraph`.
- Keep existing MCP read-only checks.

Focused commands:

```bash
pnpm --filter @drift/cli test -- boundaries
pnpm check:boundaries
pnpm verify:ci
```

Done:

- `pnpm check:boundaries` enforces the architecture concern directly, not just by review.

### Contract: Scan Capability Report

Goal:

Persist one scan-owned capability report that says what Drift knew, partially knew, and could not know for that scan.

Target contract:

```ts
type ScanCapabilityReport = {
  schema_version: "drift.scan_capability_report.v1";
  repo_id: string;
  scan_id: string;
  engine_source: "rust" | "typescript";
  engine_version: string | null;
  scanner_version: string;
  adapter_versions: Record<string, string>;
  certified_capabilities: string[];
  required_capabilities: string[];
  missing_capabilities: string[];
  completeness: Array<{
    scope: "repo" | "changed-files" | "changed-hunks" | "route-flow" | "file";
    rule_id?: string;
    complete: boolean;
    can_block: boolean;
    reasons: string[];
  }>;
  parser_gap_count: number;
  parser_gap_kinds: Record<string, number>;
  fallback_used: boolean;
  enforcement_degraded: boolean;
  created_at: string;
};
```

RED tests:

- `packages/storage/test/sqlite-storage.test.ts`
  - persists and reads `ScanCapabilityReport`;
  - refuses invalid schema version;
  - preserves missing capabilities and parser gap kind counts.
- `packages/cli/test/cli.test.ts`
  - `scan --json` writes a capability report for the completed scan;
  - `scan status --json` includes the latest capability report.
- `packages/mcp/test/mcp.test.ts`
  - `get_scan_status` returns the same capability report as CLI scan status.

Expected initial failure:

- No `scan_capability_reports` table or storage API exists.
- Scan status cannot load a persisted report.

GREEN implementation:

- Add `ScanCapabilityReport` and schema to `@drift/core`.
- Add storage migration `019_scan_capability_reports`.
- Add `upsertScanCapabilityReport` and `getScanCapabilityReport`.
- Build the report during `runScanRepo` from `ScanData.stats`, graph completeness, parser gaps, fallback status, and versions.
- Include the report in CLI/MCP scan status.

Focused commands:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/storage test
pnpm --filter @drift/cli test -- scan
pnpm --filter @drift/mcp test -- scan
pnpm verify:ci
```

Done:

- Readiness no longer depends only on transient local calculations; each scan has a durable capability proof.

### Contract: Machine Version Binding

Goal:

Attach one canonical version-binding object to scan, check, and finding outputs so old proof is not treated as current proof.

Target contract:

```ts
type MachineContractVersions = {
  schema_version: "drift.machine_contract_versions.v1";
  cli_version: string;
  core_version: string;
  storage_schema_version: number;
  contract_schema_version: number;
  engine_contract_versions: {
    scan_request: string;
    scan_result: string;
    check_request: string;
    check_result: string;
    candidates_result: string;
    stream_event: string;
  };
  factgraph_schema_version: string;
  scanner_version: string;
  rule_engine_version: string;
  adapter_versions: Record<string, string>;
};
```

RED tests:

- `packages/core/test/domain.test.ts`
  - builds a stable `MachineContractVersions` object from runtime constants.
- `packages/cli/test/cli.test.ts`
  - `doctor --json`, `scan status --json`, and `check --json` include `machine_contract_versions`;
  - check output includes the version binding used for the scan/check.
- `packages/storage/test/sqlite-storage.test.ts`
  - check runs persist `machine_contract_versions_json`;
  - findings persist `created_by_engine_version`, `created_by_rule_engine_version`, and `contract_schema_version`.

Expected initial failure:

- Version data is split across `doctorRuntime`, scan manifest, engine contract constants, and graph schema constants.
- Check runs/findings do not persist the full binding.

GREEN implementation:

- Add `createMachineContractVersions` in `@drift/core` or CLI domain versions if the constants cannot live entirely in core.
- Add storage migration for check-run and finding version columns.
- Populate check run and finding version fields in `runCheck`.
- Include the binding in CLI/MCP machine-readable outputs where proof is exposed.

Focused commands:

```bash
pnpm --filter @drift/core test
pnpm --filter @drift/storage test
pnpm --filter @drift/cli test -- check
pnpm --filter @drift/mcp test
pnpm verify:ci
```

Done:

- A finding can be traced to the exact CLI/core/storage/engine-contract/factgraph/rule versions that produced it.

### Contract: Evidence Confidence Metadata

Goal:

Make evidence proof explicit about whether it came from deterministic AST/graph extraction, heuristic path inference, or unresolved/incomplete resolution.

Target additions:

```ts
type EvidenceConfidenceKind = "deterministic" | "heuristic" | "unresolved";

type EvidenceProofMetadata = {
  confidence_kind: EvidenceConfidenceKind;
  extractor: string;
  snippet_hash?: string;
};
```

Rules:

- AST-backed facts use `deterministic`.
- Path/file-role classification uses `heuristic` unless proven by a deterministic adapter rule.
- Unresolved imports/symbols and parser gaps use `unresolved`.
- Do not add numeric confidence scores to evidence.

RED tests:

- `packages/factgraph/test/factgraph.test.ts`
  - graph evidence includes `confidence_kind` and `extractor`;
  - source-backed evidence can include `snippet_hash`;
  - old `factgraph.v1` and `factgraph.v2` artifacts remain readable enough for diagnostics.
- `packages/storage/test/sqlite-storage.test.ts`
  - graph evidence projection persists confidence metadata.
- `crates/drift-engine/tests/stream_graph.rs`
  - emitted graph evidence includes deterministic/heuristic/unresolved confidence kind.

Expected initial failure:

- `GraphEvidence` stores file/hash/range/adapter/fact ids/redaction only.
- Rust graph evidence does not emit confidence metadata.

GREEN implementation:

- Extend `GraphEvidenceSchema` additively.
- Add SQLite columns or metadata JSON for evidence confidence fields.
- Populate confidence in TypeScript graph builders and Rust graph stream output.
- Keep old artifacts readable with default `confidence_kind: "deterministic"` only when the old source has no diagnostic uncertainty.

Focused commands:

```bash
pnpm --filter @drift/factgraph test
pnpm --filter @drift/storage test
cargo test -p drift-engine --test stream_graph
pnpm verify:ci
```

Done:

- Evidence does not overclaim precision; consumers can distinguish deterministic proof from heuristic or unresolved context.

### Contract: Generated Hardening Proof

Goal:

Make this hardening visible in generated proof artifacts, not just implementation tests.

RED tests:

- `test/e2e/release-hygiene.test.ts`
  - beta proof fails if scan capability report is missing;
  - beta proof fails if machine contract versions are missing;
  - beta proof fails if blocking finding evidence lacks confidence metadata.
- `scripts/run-beta-proof.mjs`
  - generated proof includes `capability_report`, `machine_contract_versions`, and `finding_evidence_confidence`.

Expected initial failure:

- Current beta proof proves accepted-contract blocking, but not durable capability/version/evidence proof.

GREEN implementation:

- Extend generated beta proof payload after the storage and CLI outputs exist.
- Update claims validation only if public docs mention these proof fields.
- Keep proof additive; do not remove current beta proof fields.

Focused commands:

```bash
pnpm beta:proof
pnpm test:e2e -- release-hygiene
pnpm validate:claims
pnpm verify:ci
```

Done:

- The beta proof demonstrates not only that Drift blocked a bad diff, but why that block was allowed.

## Execution Order

1. Package boundary gate.
2. Scan capability report.
3. Machine version binding.
4. Evidence confidence metadata.
5. Generated hardening proof.

Reasoning:

- Boundary enforcement is smallest and prevents new layering drift while the rest lands.
- Capability report is the durable input readiness needs.
- Version binding makes capability and findings auditable over time.
- Evidence confidence prevents proof overclaiming.
- Generated proof comes last because it should consume implemented behavior.

## Non-Goals

- No shared CLI/MCP response-builder extraction in this slice.
- No new parser coverage except confidence metadata on existing emitted evidence.
- No broad TypeScript semantic claims.
- No new MCP mutation tools.
- No desktop UI or cloud sync.
- No capability promotion unless generated proof and claims validation pass.

## Completion Gate

Focused gates:

```bash
pnpm check:boundaries
pnpm --filter @drift/core test
pnpm --filter @drift/factgraph test
pnpm --filter @drift/storage test
pnpm --filter @drift/query test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
cargo test -p drift-engine
pnpm beta:proof
pnpm validate:claims
```

Final gate:

```bash
pnpm verify:ci
git diff --check
```
