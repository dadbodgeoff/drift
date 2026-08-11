# Engine-Owned Checks

Date: 2026-05-21

## Purpose

Drift should not have duplicated rule authority.

The CLI should orchestrate, persist, and render. The engine should decide scan facts, graph facts, diff classification, and deterministic rule findings.

This matters because Drift's product promise depends on trust. If TypeScript and Rust can disagree about what is a violation, the tool can drift internally.

## Current Risk

Today the product loop is strong, but rule/check authority is split:

- Rust extracts TypeScript facts and owns some direct-data-access rule primitives.
- TypeScript CLI still performs some scan/check orchestration and fallback logic.
- The CLI persists findings and applies governance/baseline behavior.

This was reasonable for V1 bootstrapping. It should not remain the long-term shape.

## Target Responsibility Split

```text
CLI
  parse args
  open/migrate storage
  resolve repo id/db path
  load accepted contract/policy/baseline
  call engine
  persist engine scan/check output
  append audit events
  format JSON/text

Engine
  walk files
  apply ignore/skip policy
  hash files
  extract facts
  build graph
  resolve imports
  classify diff scope
  evaluate deterministic rules
  emit findings and diagnostics
```

## Engine Check Request

The full boundary contract lives in `docs/architecture/engine-api-contract.md`. This document explains the migration and ownership model.

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
  scan: {
    scan_id?: string;
    graph_id?: string;
    require_fresh?: boolean;
  };
  contract: {
    contract_id: string;
    contract_schema_version: number;
    conventions: EngineConvention[];
    waivers: EngineWaiver[];
  };
  baseline: EngineBaselineViolation[];
  diff: {
    mode: "changed-hunks" | "changed-files" | "full";
    range?: string;
    patch?: string;
  };
  policy: {
    denied_globs: string[];
    max_snippet_chars: number;
    allow_full_file_content: boolean;
  };
};
```

## Engine Check Result

```ts
type EngineCheckResult = {
  schema_version: "engine.check.result.v1";
  repo_id: string;
  scan_id: string;
  graph_id?: string;
  rule_engine_version: string;
  adapter_versions: Record<string, string>;
  diff_mode: "changed-hunks" | "changed-files" | "full";
  findings: EngineFinding[];
  diagnostics: EngineDiagnostic[];
  stats: {
    files_seen: number;
    files_considered: number;
    files_parsed: number;
    facts_emitted: number;
    graph_nodes: number;
    graph_edges: number;
    duration_ms: number;
    truncated: boolean;
    truncation_reason?: string;
  };
};
```

## Engine Finding

```ts
type EngineFinding = {
  id: string;
  fingerprint: string;
  convention_id: string;
  rule_id: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  enforcement_result: "none" | "warn" | "block";
  status_hint: "new" | "pre_existing";
  diff_status: "new_in_diff" | "touched_existing" | "outside_diff";
  evidence: EngineEvidenceRef[];
  related_node_ids: string[];
};
```

The CLI can map `status_hint` into persisted `Finding.status` after applying existing governance statuses such as `suppressed`, `accepted_drift`, and `false_positive`.

## Migration Strategy

Do not big-bang replace checks.

### Phase 1: Parity mode

Add an engine-owned direct-data-access check path behind an internal flag or test-only toggle.

The CLI runs:

```text
existing TypeScript check path
engine check path
compare fingerprints and evidence
persist existing path results
```

Acceptance:

- same finding fingerprints for current fixtures
- same diff status
- same enforcement result
- same evidence file/line where possible
- diagnostics explain any unresolved imports

### Phase 2: Engine default

The CLI calls the engine and persists engine findings.

The old TypeScript check path becomes fallback only.

Acceptance:

- all existing CLI tests pass
- engine tests cover rule behavior
- golden fixture outputs are unchanged or intentionally migrated with a documented contract bump

### Phase 3: Remove duplicate authority

Delete or demote TypeScript rule logic that can disagree with Rust.

TypeScript can still:

- map engine findings to storage records
- preserve existing governed statuses
- apply policy to outward output
- format findings
- append audit events

TypeScript should not:

- re-decide whether direct data access happened
- re-run diff classification differently than the engine
- create separate finding fingerprints for the same rule

## Rule Capability Requirements

Each deterministic rule declares what graph/adapter capabilities it requires.

```ts
type EngineRuleManifest = {
  id: string;
  version: string;
  convention_kind: string;
  enforcement_capability: "briefing_only" | "heuristic_check" | "deterministic_check";
  required_capabilities: string[];
  preferred_capabilities: string[];
};
```

For V1:

```json
{
  "id": "api_route_no_direct_data_access",
  "version": "0.1.0",
  "convention_kind": "api_route_no_direct_data_access",
  "enforcement_capability": "deterministic_check",
  "required_capabilities": ["file_discovery", "syntax_facts", "route_detection"],
  "preferred_capabilities": ["import_resolution", "symbol_linking"]
}
```

## Baseline And Governance Interaction

The engine can classify whether a finding matches an active baseline. The CLI remains responsible for governance state.

Rules:

- Existing `suppressed`, `accepted_drift`, and `false_positive` statuses are preserved by CLI persistence.
- Active baseline matches must not block by default.
- Resolved baseline rows must not hide new findings.
- Finding fingerprints must stay stable across line-only changes where possible.
- Audit events stay in TypeScript/storage because they are product governance, not parser truth.

## Diagnostics

The engine should emit diagnostics instead of silent gaps.

Examples:

```ts
type EngineDiagnostic = {
  severity: "info" | "warning" | "error";
  code:
    | "import_unresolved"
    | "file_too_large"
    | "adapter_failed"
    | "max_facts_exceeded"
    | "graph_truncated"
    | "unsupported_syntax";
  message: string;
  file_path?: string;
  evidence_id?: string;
};
```

Diagnostics must appear in scan/check JSON so users and agents know when Drift's context is incomplete.

## No Silent Fallback

If Rust/engine check execution fails, the CLI may fall back only when the response clearly marks:

- `engine_status: "fallback_used"`
- the fallback reason
- which capabilities are unavailable
- whether enforcement was degraded
- whether blocking was disabled

Silent fallback from engine truth to TypeScript fallback would create internal drift. Fallback is acceptable for continuity, but not as invisible authority.

## Completeness Gate

Engine findings must include enough completeness metadata for the CLI to decide whether blocking is allowed.

Rules:

- deterministic blocking requires required capabilities to be available for the checked scope
- unresolved imports can degrade a rule to warn if they affect the checked file or route
- graph truncation disables blocking unless the rule proves completeness for the diff scope
- skipped secret/binary/generated files must be visible in diagnostics, but should not create fake violations

## Acceptance Criteria

- Existing TypeScript direct-data-access fixture outputs can be reproduced by engine-owned checks.
- Finding fingerprints remain stable against current golden tests.
- Diff mode is classified by the engine in parity tests.
- CLI persists engine findings without changing JSON output contracts.
- Baselines and existing governed statuses continue to work.
- Engine diagnostics are exposed in scan/check outputs.
- Engine failure/fallback is visible and machine-readable.
- Blocking checks fail closed when graph/rule completeness is insufficient.
- `pnpm verify:ci` and `cargo test -p drift-engine` pass.

## Non-Goals

- no new convention families during engine migration
- no broad semantic duplicate detection
- no model-assisted rule enforcement
- no UI work
- no cloud sync
