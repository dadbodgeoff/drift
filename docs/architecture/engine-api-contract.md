# Engine API Contract

Date: 2026-05-21

## Purpose

Rust must become the authoritative deterministic engine. TypeScript should call it through versioned request/result contracts, validate its output, persist it, and render it.

This contract must exist before engine-owned checks become the default path.

## Contract Ownership

The engine API is a machine contract between:

- Rust `crates/drift-engine`
- TypeScript CLI/MCP/storage orchestration
- golden fixtures
- future SDK consumers

The contract should be represented as either:

- Rust serde structs plus generated JSON Schema, or
- shared JSON Schema with Rust and TypeScript validation

Do not rely on prose TypeScript snippets as the only contract.

## Engine Scan Request

```ts
type EngineScanRequest = {
  schema_version: "engine.scan.request.v1";
  repo: {
    repo_id: string;
    repo_root: string;
    branch: string;
    commit: string;
    dirty: boolean;
  };
  limits: EngineLimits;
  adapters: {
    enabled: string[];
    disabled: string[];
    required_capabilities: string[];
  };
  policy: {
    denied_globs: string[];
    max_snippet_chars: number;
    allow_full_file_content: false;
  };
};
```

## Engine Scan Result

```ts
type EngineScanResult = {
  schema_version: "engine.scan.result.v1";
  repo_id: string;
  scan_id: string;
  engine_version: string;
  adapter_versions: Record<string, string>;
  file_snapshots: EngineFileSnapshot[];
  facts: EngineFact[];
  graph?: EngineGraphArtifact;
  diagnostics: EngineDiagnostic[];
  stats: EngineStats;
  completeness: EngineCompleteness[];
};
```

## Engine Check Request

```ts
type EngineCheckRequest = {
  schema_version: "engine.check.request.v1";
  repo: {
    repo_id: string;
    repo_root: string;
    branch: string;
    commit: string;
    dirty: boolean;
  };
  graph: {
    graph_id?: string;
    scan_id?: string;
    require_fresh: boolean;
  };
  contract: {
    contract_id: string;
    contract_schema_version: number;
    conventions: EngineConvention[];
    waivers: EngineWaiver[];
    exceptions: EngineConventionException[];
  };
  baseline: EngineBaselineViolation[];
  diff: {
    mode: "changed-hunks" | "changed-files" | "full";
    range?: string;
    patch?: string;
  };
  limits: EngineLimits;
};
```

## Engine Check Result

```ts
type EngineCheckResult = {
  schema_version: "engine.check.result.v1";
  repo_id: string;
  scan_id: string;
  graph_id?: string;
  engine_version: string;
  rule_engine_version: string;
  adapter_versions: Record<string, string>;
  diff_mode: "changed-hunks" | "changed-files" | "full";
  findings: EngineFinding[];
  diagnostics: EngineDiagnostic[];
  stats: EngineStats;
  completeness: EngineCompleteness[];
};
```

## Limits And Stats

```ts
type EngineLimits = {
  max_files_seen: number;
  max_files_parsed: number;
  max_file_bytes: number;
  max_facts: number;
  max_graph_nodes: number;
  max_graph_edges: number;
  max_diagnostics: number;
  max_duration_ms?: number;
  follow_symlinks: false;
};

type EngineStats = {
  files_seen: number;
  files_skipped: number;
  files_parsed: number;
  facts_emitted: number;
  graph_nodes: number;
  graph_edges: number;
  diagnostics_emitted: number;
  duration_ms: number;
  peak_rss_bytes?: number;
  truncated: boolean;
  truncation_reason?: string;
};
```

## Completeness

```ts
type EngineCompleteness = {
  scope: "repo" | "changed-files" | "changed-hunks" | "route-flow" | "file";
  rule_id?: string;
  complete: boolean;
  required_capabilities: string[];
  missing_capabilities: string[];
  truncated: boolean;
  can_block: boolean;
  reasons: string[];
};
```

Blocking deterministic rules require `can_block=true`.

## No Silent Fallback Policy

The current TypeScript fallback can exist only as explicit compatibility mode.

Rules:

- default deterministic enforcement must fail closed if the engine is unavailable
- fallback must be explicit through a flag or internal test mode
- fallback output must include diagnostics
- fallback must not claim `engine_source: rust`
- parity mode may run both paths and compare fingerprints

## Golden Boundary Fixtures

Add fixtures for:

- valid scan request/result
- valid check request/result
- malformed engine result rejected by TypeScript
- engine unavailable with enforcement mode block
- parity result matching existing TypeScript direct-data-access output
- truncated graph where `can_block=false`

## Acceptance Criteria

- Rust and TypeScript validate the same engine contract.
- Engine output includes limits, stats, diagnostics, and completeness.
- Engine unavailability cannot silently downgrade blocking checks.
- Existing direct-data-access findings can be reproduced through engine result fixtures.
- `pnpm verify:ci` and `cargo test -p drift-engine` pass after integration.
