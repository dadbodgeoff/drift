# TypeScript Semantic Coverage Beta TDD

Date: 2026-05-28
Status: implementation-driving TDD
Scope: TS/JS semantic coverage, graph confidence, conventions, elections, and beta claim gating.

## Purpose

This document turns Drift's largest current intelligence gap into an executable
test-driven plan.

Drift already has imports, exports, calls, roles, graph edges, parser gaps,
readiness, repo contracts, accepted conventions, checks, findings, CLI, MCP,
and beta proof. The missing beta-critical system is a precise contract layer for
what Drift understands about TypeScript/JavaScript semantics, what it does not
understand, and when that uncertainty must downgrade enforcement.

The target is not "perfect TypeScript compiler replacement" for beta. The
target is a truth-preserving system:

```text
Every beta-visible graph, check, preflight, convention, and finding must say
which TS/JS semantic capabilities were used, which gaps were present, which
unsupported patterns affected confidence, and whether blocking enforcement is
allowed.
```

## Current Repo Truth

Verified source surfaces before writing this TDD:

- `packages/core/src/domain.ts` already defines `FactRecord`, parser gaps,
  capability reports, `DataOperationRisk`, `SymbolIdentity`, graph records,
  convention candidates, accepted conventions, repo contracts, preflight
  packets, and entrypoint-flow proof.
- `packages/core/src/schemas.ts` validates the same core contracts.
- `packages/query/src/readiness.ts` already builds `DriftReadiness` with
  `blocking_allowed`, `advisory_only`, and `refuse` decisions.
- `docs/architecture/typescript-code-intelligence-map.md` already labels many
  TS/JS intelligence surfaces as implemented, partial, documented-only, or
  missing.
- `docs/architecture/beta-intelligence-gate.md` already says beta must not claim
  complete semantic understanding of arbitrary JavaScript or TypeScript.
- `docs/architecture/codebase-intelligence-100-tdd.md` already covers a broad
  contract stack, but it is too wide to be the operational ledger for TS
  semantic risk.
- `crates/drift-engine/tests/stream_graph.rs` already proves static import
  graph streaming, tsconfig alias resolution, workspace package import
  resolution, unresolved import diagnostics, JS ESM specifier resolution to TS
  sources, endpoint shape, service boundary inference, callsite nodes, and data
  operation nodes.

Current important limitation:

- The active checkout has unrelated modified graph/import files. This TDD is a
  docs-only artifact and must not rely on unstaged implementation behavior unless
  a later executor verifies it from the target branch.

## Product Claim Boundary

### Allowed Beta Claim After This TDD Is Implemented

Drift can claim:

```text
Drift is a local-first TypeScript/JavaScript repo intelligence guardrail for
accepted repo conventions. It builds deterministic graph evidence where
certified TS/JS semantic capabilities are complete, marks unsupported or partial
semantic cases as parser gaps, and refuses or downgrades enforcement when those
gaps affect the check.
```

### Still Not Allowed

Drift must not claim:

- full TypeScript type checking,
- complete runtime dataflow analysis,
- complete control-flow dominance across arbitrary JavaScript,
- full framework magic understanding,
- arbitrary dependency-injection resolution,
- decorator metadata execution,
- computed dynamic call resolution,
- source mutation,
- broad language support beyond certified TS/JS surfaces.

## Definitions

Use these terms exactly.

- Semantic capability: a named extraction or resolution ability that can be
  certified, tested, surfaced, and required by checks.
- Semantic coverage: the measured support level for a capability on a scan,
  file, flow, convention, check, or preflight response.
- Parser gap: a concrete unsupported, unresolved, skipped, or partial semantic
  case with evidence and confidence impact.
- Unsupported pattern: a known code pattern Drift saw but cannot safely resolve.
- Convention: a human-accepted repo rule. Candidate conventions never block.
- Election: the governed transition from candidate or imported rule to accepted
  convention, rejected inference, disabled convention, or superseded convention.
- Architecture contract: the machine-readable role/layer/edge model that
  accepted conventions bind to.
- Blocking-safe: enforcement can produce a blocking finding because every
  capability required for the check is certified deterministic and complete for
  the affected scope.
- Advisory-only: Drift can brief or warn but cannot block.
- Refusal: Drift must decline the check or agent packet because required evidence
  is missing, stale, or unsupported.

## Non-Negotiable Rules

1. No blocking finding may rely on a semantic capability whose scan coverage is
   partial, unsupported, stale, or uncertified for the affected scope.
2. Dynamic imports, computed calls, decorator-driven routing, DI containers, and
   framework magic must become explicit parser gaps or unsupported-pattern facts
   before any beta surface uses the graph.
3. Candidate conventions cannot block. Only accepted active conventions can
   block, and only when their required semantic capabilities are blocking-safe.
4. Repo contracts must record which semantic capability versions and architecture
   contract versions they depend on.
5. CLI and MCP must expose equivalent readiness and parser-gap decisions for
   matching read-only surfaces.
6. Beta proof must fail if beta claims mention a capability that is not
   contract-covered, fixture-proven, and release-proof-covered.
7. Drift must prefer refusal over false confidence.

## Architecture Overview

```text
Rust scanner
  -> TS/JS facts
  -> semantic capability coverage
  -> graph nodes, graph edges, graph evidence
  -> parser gaps and unsupported-pattern records
  -> engine-contract validation
  -> SQLite persistence
  -> query read models
  -> readiness and semantic coverage decisions
  -> CLI prepare/repo-map/check/findings
  -> MCP read-only equivalents
  -> beta/release proof
```

Ownership:

- Rust owns deterministic file walking, bounded parsing, static TS/JS extraction,
  resolver diagnostics, graph evidence, and engine-owned check facts.
- `@drift/core` owns versioned contracts and schemas.
- `@drift/storage` owns durable persistence and migrations.
- `@drift/query` owns derived read models, readiness, coverage decisions, role
  ontology, route/dataflow summaries, and affected-scope computation.
- CLI owns human-confirmed governance mutations and text formatting.
- MCP owns read-only agent transport and must not mutate repo governance state.
- Proof scripts own beta/release gating.

## Semantic Capability Index

Each capability has a certification, support state, confidence impact, and
blocking rule.

| Capability | Contract ID | Required For Blocking | V1 Target |
| --- | --- | --- | --- |
| file discovery | `ts.file_discovery.v1` | yes | certified deterministic |
| syntax facts | `ts.syntax_facts.v1` | yes | certified deterministic |
| static import extraction | `ts.static_imports.v1` | yes | certified deterministic |
| import resolution | `ts.import_resolution.v1` | yes for import/flow checks | certified deterministic for static supported shapes |
| re-export resolution | `ts.re_exports.v1` | yes for symbol/flow checks using barrels | certified deterministic for explicit and star re-export fixtures |
| default export identity | `ts.default_exports.v1` | yes when defaults are in scope | certified deterministic |
| namespace import identity | `ts.namespace_imports.v1` | yes only after supported | advisory until proven |
| CommonJS require | `ts.commonjs_require.v1` | no until proven | parser gap or advisory |
| dynamic import | `ts.dynamic_imports.v1` | no for V1 | parser gap unless literal static target is proven |
| symbol identity | `ts.symbol_identity.v1` | yes for symbol checks | partial until declaration/import/reference storage is complete |
| callsite extraction | `ts.callsites.v1` | yes for simple call rules | certified deterministic for direct/member calls |
| computed call resolution | `ts.computed_calls.v1` | no for V1 | parser gap |
| chained call semantics | `ts.chained_calls.v1` | no for V1 | advisory until fixture-proven |
| wrapper alias resolution | `ts.wrapper_aliases.v1` | no for blocking until proven | advisory/parser gap |
| data operation detection | `ts.data_operations.v1` | yes for data-access checks | certified deterministic for supported ORM/client shapes |
| route endpoint detection | `ts.entrypoints.next.v1` | yes for Next route checks | certified deterministic for supported Next app/pages routes |
| server actions | `ts.entrypoints.next_server_actions.v1` | no until proven | parser gap/advisory |
| middleware matcher coverage | `ts.middleware_matcher.v1` | yes for middleware checks | certified only for static matcher shapes |
| decorator routing | `ts.decorators.v1` | no for V1 | unsupported pattern |
| dependency injection | `ts.di_containers.v1` | no for V1 | unsupported pattern |
| framework adapter facts | `ts.framework_adapter.v1` | yes only per certified adapter | Next first |
| route to service to data flow | `ts.route_flow.v1` | yes for route-layering checks | deterministic only when imports, roles, and data ops are complete |
| changed symbol impact | `ts.changed_symbols.v1` | no until implemented | advisory/missing |
| test relevance | `ts.test_relevance.v1` | no for blocking | advisory |

Blocking rule:

```text
required capability complete + certified deterministic + current scan fresh
+ no blocking parser gap in affected scope + accepted active convention
= blocking-safe
```

Anything less becomes advisory-only or refusal.

## Contracts To Add Or Harden

### 1. Semantic Capability Contract

Purpose: define every TS/JS capability that Drift can claim, require, or use.

```ts
type SemanticCapabilityCertification =
  | "certified_deterministic"
  | "certified_heuristic"
  | "experimental"
  | "unsupported";

type SemanticCapabilitySupport =
  | "supported"
  | "partial"
  | "unsupported"
  | "deferred";

type SemanticCapabilityContract = {
  schema_version: "drift.semantic_capability.v1";
  capability_id: string;
  display_name: string;
  language: "typescript" | "javascript" | "tsx" | "jsx";
  support: SemanticCapabilitySupport;
  certification: SemanticCapabilityCertification;
  can_block: boolean;
  evidence_classes: Array<
    | "path"
    | "text"
    | "ast"
    | "graph"
    | "type_checker"
    | "heuristic"
    | "unsupported_pattern"
  >;
  emitted_fact_kinds: string[];
  emitted_node_kinds: string[];
  emitted_edge_kinds: string[];
  parser_gap_kinds: string[];
  fixture_suites: string[];
  required_for_beta_claims: string[];
  owner: "rust_engine" | "core_schema" | "query" | "cli" | "mcp" | "proof";
};
```

Rules:

- `can_block` requires `certified_deterministic`.
- `certified_heuristic`, `experimental`, and `unsupported` cannot block.
- A capability cannot appear in beta claims unless it has fixture suites and
  proof coverage.

### 2. Semantic Coverage Contract

Purpose: record per-scan and per-scope coverage.

```ts
type SemanticCoverageScope =
  | "scan"
  | "file"
  | "route_flow"
  | "check"
  | "preflight"
  | "repo_map"
  | "mcp";

type SemanticCoverageDecision =
  | "blocking_allowed"
  | "advisory_only"
  | "refuse";

type SemanticCoverageContract = {
  schema_version: "drift.semantic_coverage.v1";
  repo_id: string;
  scan_id: string;
  scope: SemanticCoverageScope;
  scope_id: string;
  required_capabilities: string[];
  complete_capabilities: string[];
  partial_capabilities: string[];
  missing_capabilities: string[];
  unsupported_capabilities: string[];
  parser_gap_ids: string[];
  unsupported_pattern_ids: string[];
  confidence: number;
  decision: SemanticCoverageDecision;
  reasons: string[];
  generated_at: string;
};
```

Decision rules:

- `blocking_allowed`: all required capabilities complete, no blocking parser
  gaps, no unsupported patterns affecting this scope.
- `advisory_only`: graph exists but one or more non-critical capabilities are
  partial or heuristic.
- `refuse`: graph unavailable, stale, or missing a required capability.

### 3. Parser Gap Contract V2

Purpose: make unsupported TS/JS semantics first-class and actionably grouped.

Current `ParserGap` already exists. It must be hardened into this shape while
remaining backward-compatible:

```ts
type ParserGapKindV2 =
  | "unresolved_import"
  | "unresolved_import_symbol"
  | "unsupported_namespace_import_symbol"
  | "unresolved_symbol"
  | "unknown_file_role"
  | "mixed_file_role"
  | "unsupported_framework_pattern"
  | "dynamic_import_unresolved"
  | "computed_call_unresolved"
  | "chained_call_partial"
  | "decorator_route_unresolved"
  | "di_container_unresolved"
  | "wrapper_alias_unresolved"
  | "type_only_boundary_ignored"
  | "framework_magic_detected";

type ParserGapV2 = {
  schema_version: "drift.parser_gap.v2";
  parser_gap_id: string;
  repo_id: string;
  scan_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  kind: ParserGapKindV2;
  message: string;
  source_text_hash?: string;
  affected_capabilities: string[];
  affected_contract_kinds: string[];
  confidence_impact:
    | "none"
    | "lowers_file"
    | "lowers_flow"
    | "blocks_enforcement";
  suggested_action:
    | "add_fixture"
    | "accept_advisory"
    | "rewrite_static"
    | "configure_adapter"
    | "defer";
  evidence_refs: string[];
};
```

Rules:

- Every unsupported dynamic import, computed call, DI container registration,
  decorator route, framework wrapper, or unresolved alias-heavy wrapper must
  produce a parser gap.
- Parser gaps with `blocks_enforcement` force `SemanticCoverage.decision` away
  from `blocking_allowed`.
- Parser gaps must be grouped in scan status by kind, capability, and affected
  contract kind.

### 4. Module Resolution Contract

Purpose: make import resolution deterministic and auditable.

```ts
type ModuleSpecifierKind =
  | "relative"
  | "absolute_alias"
  | "package"
  | "workspace_package"
  | "node_builtin"
  | "dynamic"
  | "commonjs";

type ModuleResolutionStatus =
  | "resolved"
  | "unresolved"
  | "external"
  | "unsupported"
  | "partial";

type ModuleResolutionRecord = {
  schema_version: "drift.module_resolution.v1";
  resolution_id: string;
  repo_id: string;
  scan_id: string;
  importer_file: string;
  source: string;
  specifier_kind: ModuleSpecifierKind;
  import_kind:
    | "static_import"
    | "export_from"
    | "require"
    | "dynamic_import"
    | "type_only";
  resolved_file_path?: string;
  resolved_package_name?: string;
  status: ModuleResolutionStatus;
  resolver_strategy:
    | "relative_extensions"
    | "index_file"
    | "tsconfig_paths"
    | "jsconfig_paths"
    | "package_exports"
    | "workspace_package"
    | "node_builtin"
    | "unsupported_dynamic";
  evidence_ref: string;
  parser_gap_id?: string;
};
```

Rules:

- Static supported imports must resolve or emit `unresolved_import`.
- Type-only imports must be tracked as type-only and excluded from runtime flow
  checks unless a future type contract explicitly uses them.
- Dynamic imports are unsupported for blocking unless a literal static target is
  specifically fixture-proven and marked with a narrower strategy.
- Package exports resolution must never execute package code.

### 5. Symbol Identity Contract V2

Purpose: connect declarations, exports, imports, re-exports, aliases, and
references without pretending to own the full TS type graph.

```ts
type SymbolIdentityV2 = {
  schema_version: "drift.symbol_identity.v2";
  symbol_id: string;
  repo_id: string;
  scan_id: string;
  canonical_name: string;
  declaration_file: string;
  declaration_span: {
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
  };
  symbol_kind:
    | "function"
    | "class"
    | "const"
    | "let"
    | "var"
    | "type"
    | "interface"
    | "namespace"
    | "default_export"
    | "unknown";
  export_kind: "named" | "default" | "namespace" | "re_export" | "local";
  aliases: Array<{
    local_name: string;
    imported_name?: string;
    importer_file: string;
    import_source: string;
    resolution_id: string;
  }>;
  re_export_chain: string[];
  reference_count: number;
  confidence: "high" | "medium" | "low";
  resolution_status: "resolved" | "partial" | "unresolved" | "unsupported";
  parser_gap_ids: string[];
};
```

Rules:

- `changed_symbols` cannot remain empty after this contract is beta-required.
- Symbol checks cannot block on `partial`, `unresolved`, or `unsupported`
  symbols.
- Namespace imports must be either resolved to member symbols or marked
  unsupported for the affected symbol.

### 6. Call Resolution Contract

Purpose: classify calls and make computed/chained/alias-heavy calls honest.

```ts
type CallExpressionShape =
  | "identifier"
  | "member"
  | "optional_member"
  | "chained"
  | "computed_member"
  | "call_result"
  | "new_expression"
  | "decorator"
  | "unknown";

type CallResolutionRecord = {
  schema_version: "drift.call_resolution.v1";
  call_id: string;
  repo_id: string;
  scan_id: string;
  file_path: string;
  span: {
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
  };
  callee_text: string;
  receiver_text?: string;
  root_identifier?: string;
  shape: CallExpressionShape;
  resolved_symbol_id?: string;
  resolved_import_id?: string;
  resolution_status: "resolved" | "partial" | "unresolved" | "unsupported";
  confidence: "high" | "medium" | "low";
  parser_gap_id?: string;
};
```

Rules:

- Direct identifier and member calls can block only when resolved to supported
  symbol/import/data-operation evidence.
- Computed calls like `client[method]()` must emit `computed_call_unresolved`.
- Chained calls like `db.user.where(...).findMany()` must be partial until the
  data operation contract proves the terminal operation and receiver path.
- Wrapper calls like `withAuth(handler)` must not satisfy auth/security
  conventions unless the wrapper is accepted in the repo contract and resolved.

### 7. Data Operation Contract V2

Purpose: make reads, writes, tenant-sensitive access, and external side effects
explicit.

```ts
type DataOperationRecord = {
  schema_version: "drift.data_operation.v2";
  operation_id: string;
  repo_id: string;
  scan_id: string;
  file_path: string;
  call_id: string;
  operation_family:
    | "database"
    | "cache"
    | "queue"
    | "http"
    | "filesystem"
    | "secret"
    | "payment"
    | "email"
    | "analytics"
    | "unknown";
  operation_kind:
    | "read"
    | "create"
    | "update"
    | "delete"
    | "upsert"
    | "execute"
    | "publish"
    | "send"
    | "unknown";
  receiver_root: string;
  receiver_path: string[];
  store_name?: string;
  tenant_sensitive: boolean;
  mutation: boolean;
  confidence: "high" | "medium" | "low";
  evidence_ref: string;
  parser_gap_ids: string[];
};
```

Rules:

- Route direct-data-access checks require data operation evidence for the
  affected route or resolved imports to data-access modules.
- Tenant/authorization checks require `tenant_sensitive` when the accepted
  convention says the route touches protected resources.
- Unknown operation families cannot block except through a convention that
  explicitly treats unknown data access as risky and still has complete evidence.

### 8. Framework Adapter Contract V2

Purpose: prevent framework magic from leaking into generic graph assumptions.

```ts
type FrameworkAdapterContractV2 = {
  schema_version: "drift.framework_adapter.v2";
  adapter_id: string;
  framework: "next" | "express" | "nest" | "fastify" | "remix" | "unknown";
  version_range?: string;
  certification:
    | "certified_deterministic"
    | "certified_heuristic"
    | "experimental";
  route_patterns_supported: string[];
  unsupported_patterns: string[];
  emitted_entrypoint_kinds: string[];
  emitted_capabilities: string[];
  parser_gap_kinds: string[];
  fixture_suites: string[];
  can_block: boolean;
};
```

Rules:

- Next app-router and pages API routes are the first beta target.
- Nest decorators, Express router wrappers, Fastify plugin registration, Remix
  loaders/actions, and custom framework wrappers are unsupported until their
  adapter contract is fixture-proven.
- Unsupported framework magic must emit parser gaps, not silent absence.

### 9. Role Ontology And Architecture Contract

Purpose: make roles and permitted edges machine-readable, accepted, and
enforceable.

```ts
type ArchitectureRole =
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

type ArchitectureEdgePolicy =
  | "allowed"
  | "forbidden"
  | "expected"
  | "allowed_with_risk"
  | "ignored"
  | "advisory_only";

type ArchitectureContract = {
  schema_version: "drift.architecture.v1";
  architecture_id: string;
  repo_id: string;
  version: string;
  source: "default" | "imported" | "elected";
  roles: Array<{
    role: ArchitectureRole;
    description: string;
    detection:
      | "path"
      | "ast"
      | "import_graph"
      | "accepted_convention"
      | "manual";
    confidence_required_for_blocking: "high";
  }>;
  edge_policies: Array<{
    from_role: ArchitectureRole;
    to_role: ArchitectureRole;
    edge_kind: "imports" | "calls" | "contains" | "returns" | "uses_data";
    policy: ArchitectureEdgePolicy;
    required_capabilities: string[];
  }>;
};
```

Default V1 policy:

```text
route -> service: allowed
route -> data_access: forbidden
route -> auth: expected when convention requires auth
route -> validation: expected when convention requires request validation
service -> data_access: allowed
service -> external_service: allowed_with_risk
component -> data_access: forbidden
test_* -> any: allowed_by_scope
migration -> data_access: allowed
script -> data_access: allowed_with_risk
generated -> any: ignored
unknown -> any blocking: never
mixed_role -> any blocking: never without accepted override
```

Rules:

- Path-only role inference can support briefing. Blocking requires the role
  evidence confidence required by the accepted convention.
- `unknown` and `mixed_role` lower confidence and cannot be silently treated as
  service or data access.
- Architecture contracts must be fingerprinted into `RepoContract`.

### 10. Convention Rule Contract V2

Purpose: replace loose matchers with versioned required capability sets.

```ts
type ConventionRuleContract = {
  schema_version: "drift.convention_rule.v2";
  rule_id: string;
  rule_version: string;
  convention_kind:
    | "api_route_no_direct_data_access"
    | "api_route_requires_service_delegation"
    | "api_route_requires_auth_helper"
    | "api_route_requires_request_validation"
    | "api_route_requires_authorization"
    | "api_route_requires_tenant_scope"
    | "session_object_must_come_from_trusted_helper"
    | "import_boundary"
    | "file_role"
    | "entrypoint_flow"
    | "required_change_checks";
  statement: string;
  applies_to: {
    path_globs?: string[];
    file_roles?: ArchitectureRole[];
    entrypoint_kinds?: string[];
    methods?: string[];
  };
  requires_capabilities: string[];
  architecture_contract_id: string;
  matcher: Record<string, unknown>;
  can_block_when: {
    convention_status: "active";
    coverage_decision: "blocking_allowed";
    capability_certification: "certified_deterministic";
  };
  advisory_when: string[];
  refuse_when: string[];
};
```

Rules:

- Every accepted convention must point to a convention rule contract.
- A rule's required capabilities must be included in the coverage contract for
  affected files/flows/checks.
- Matcher fingerprints must include rule ID, rule version, architecture contract
  ID, and required capabilities.

### 11. Convention Election Contract V2

Purpose: make convention lifecycle auditable and safe.

```ts
type ConventionElectionState =
  | "detected"
  | "candidate"
  | "promoted"
  | "accepted"
  | "active"
  | "rejected"
  | "deprecated"
  | "superseded"
  | "conflicted"
  | "disabled"
  | "expired";

type ConventionElectionDecision =
  | "create_candidate"
  | "promote"
  | "accept"
  | "activate"
  | "reject"
  | "disable"
  | "deprecate"
  | "supersede"
  | "mark_conflicted"
  | "expire";

type ConventionElectionContractV2 = {
  schema_version: "drift.convention_election.v2";
  election_id: string;
  repo_id: string;
  candidate_id?: string;
  convention_id?: string;
  previous_state: ConventionElectionState | null;
  next_state: ConventionElectionState;
  decision: ConventionElectionDecision;
  human_actor?: string;
  automated_actor?: "drift_engine" | "cli_import" | "policy_import";
  reason: string;
  evidence_refs: string[];
  counterexample_refs: string[];
  required_capabilities: string[];
  semantic_coverage_id?: string;
  architecture_contract_id: string;
  convention_rule_id: string;
  contract_fingerprint_before?: string;
  contract_fingerprint_after?: string;
  audit_event_id: string;
  can_block: boolean;
  blocked_reason?: string;
  created_at: string;
};
```

Election rules:

- `candidate`, `promoted`, `rejected`, `deprecated`, `conflicted`, `disabled`,
  and `expired` cannot block.
- `accepted` is not enough to block; the convention must be materialized as
  `active` in the current repo contract.
- `active` requires human confirmation, deterministic capabilities, coverage
  proof, architecture contract fingerprint, and audit event.
- `superseded` must point to the replacement convention.
- `conflicted` must name conflicting conventions and force advisory/refusal.
- Importing a contract from disk is an election and must be audited.

### 12. Repo Contract V2 Additions

Purpose: bind all active governance state to semantic capability truth.

```ts
type RepoContractV2Additions = {
  semantic_capability_contract_version: "drift.semantic_capability.v1";
  architecture_contract_id: string;
  architecture_contract_fingerprint: string;
  active_convention_rule_ids: string[];
  active_semantic_capability_ids: string[];
  beta_claim_profile:
    | "narrow_route_layering"
    | "security_boundary"
    | "custom_internal";
  enforcement_policy: {
    block_on_parser_gaps: false;
    refuse_on_required_capability_missing: true;
    advisory_on_heuristic_capability: true;
  };
};
```

Rules:

- Repo contracts must not depend on undocumented implicit role rules.
- Materialization must fail if an active convention references an unknown
  capability, unknown architecture contract, or missing rule contract.

### 13. Agent Preflight Semantic Envelope

Purpose: make agent-facing output useful and safe.

```ts
type AgentPreflightSemanticEnvelope = {
  schema_version: "drift.agent_preflight_semantic.v1";
  repo_id: string;
  scan_id: string | null;
  task: string;
  decision:
    | "safe_to_edit"
    | "run_scan_first"
    | "blocked_by_policy"
    | "blocked_by_stale_graph"
    | "context_truncated"
    | "advisory_only"
    | "refuse";
  semantic_coverage: SemanticCoverageContract;
  parser_gaps: ParserGapV2[];
  affected_files: string[];
  affected_symbols: string[];
  affected_routes: string[];
  affected_data_operations: string[];
  required_checks: string[];
  safe_commands: string[];
  source_content_included: boolean;
  graph_context_included: boolean;
};
```

Rules:

- `prepare` and MCP `get_task_preflight` must use the same semantic envelope.
- If source content is omitted or truncated, that must be visible.
- If graph context is stale or partial, the agent must see that before editing.

### 14. Check Proof Contract

Purpose: prove every blocking result was allowed to block.

```ts
type SemanticCheckProof = {
  schema_version: "drift.semantic_check_proof.v1";
  check_id: string;
  repo_id: string;
  scan_id: string;
  repo_contract_id: string;
  convention_id: string;
  convention_rule_id: string;
  semantic_coverage_id: string;
  architecture_contract_id: string;
  required_capabilities: string[];
  coverage_decision: "blocking_allowed";
  parser_gap_ids: string[];
  graph_edge_ids: string[];
  graph_node_ids: string[];
  evidence_refs: string[];
  result: "pass" | "block";
};
```

Rules:

- Blocking findings must include this proof or a pointer to it.
- A check result cannot block if `coverage_decision` is not
  `blocking_allowed`.

### 15. Beta Claim Proof Contract

Purpose: make broad wording fail CI.

```ts
type SemanticBetaProof = {
  schema_version: "drift.semantic_beta_proof.v1";
  commit_sha: string;
  semantic_capability_contracts_verified: boolean;
  architecture_contract_verified: boolean;
  convention_election_contract_verified: boolean;
  repo_contract_materialization_verified: boolean;
  cli_mcp_semantic_parity_verified: boolean;
  unsupported_pattern_visibility_verified: boolean;
  blocking_safety_verified: boolean;
  claim_gate_verified: boolean;
  partial_beta_required_count: number;
  unsupported_beta_required_count: number;
  evidence: Record<string, unknown>;
};
```

Rules:

- `partial_beta_required_count` and `unsupported_beta_required_count` must both
  be zero for public beta claims.
- Beta proof must include a fixture where an unsupported dynamic/computed case
  downgrades enforcement.

## Storage Model

Add or harden these persisted surfaces:

- `semantic_capabilities`
- `semantic_coverage`
- `module_resolutions`
- `symbol_identities_v2`
- `call_resolutions`
- `data_operations_v2`
- `architecture_contracts`
- `convention_rules`
- `convention_elections`
- `semantic_check_proofs`
- `unsupported_patterns`

Persistence rules:

- Store raw facts and graph evidence separately from derived read models.
- Store parser gaps with enough detail to group and explain them without source
  snippets by default.
- Store capability coverage per scan and derive per-scope coverage in query
  when cheaper, but persist check/preflight coverage when it affects findings.
- Every governance mutation emits an audit event.

## Fixture Matrix

The fixture matrix is the core of this TDD. Each fixture must prove both the
positive behavior and the confidence downgrade behavior.

### Required Fixture Groups

| Fixture | Must Prove |
| --- | --- |
| `ts-static-imports` | relative imports, index files, extension substitution |
| `ts-tsconfig-paths` | path aliases resolve and unresolved aliases emit gaps |
| `ts-workspace-packages` | workspace package imports resolve without executing package code |
| `ts-reexports` | named re-exports and star re-exports preserve symbol identity or emit partial |
| `ts-default-exports` | default import/export identity is stable |
| `ts-namespace-imports` | supported namespace member references resolve or emit unsupported namespace gap |
| `ts-commonjs-require` | literal `require` is either supported or clearly advisory |
| `ts-dynamic-imports` | non-literal dynamic import emits `dynamic_import_unresolved` |
| `ts-computed-calls` | `client[method]()` emits `computed_call_unresolved` |
| `ts-chained-calls` | ORM chains classify only proven terminal operations |
| `ts-wrapper-aliases` | wrapper calls do not satisfy security/flow conventions unless accepted |
| `ts-di-container` | DI registration and lookup emit unsupported pattern |
| `ts-decorators` | decorator routes emit unsupported framework pattern until adapter certified |
| `next-app-routes` | app route endpoint shape and method detection |
| `next-pages-api` | pages API endpoint shape |
| `next-server-actions` | unsupported or advisory until certified |
| `route-service-data-flow` | route -> service -> data access is not direct route data access |
| `route-direct-data-access` | direct route data access blocks under accepted convention |
| `mixed-role-file` | mixed roles lower confidence and cannot block silently |
| `unknown-role-file` | unknown roles brief only |
| `stale-graph` | stale scan refuses preflight/check |
| `cli-mcp-parity` | CLI and MCP return same semantic coverage and parser gaps |

## Implementation Phases

Every phase follows RED/GREEN/REFACTOR:

1. Add one failing test for one contract behavior.
2. Run it and verify the failure is correct.
3. Implement the smallest production change.
4. Run the focused test.
5. Run package-level tests.
6. Update docs/proof.
7. Commit the slice.

## Phase 1: Contract Schemas And Capability Ledger

Goal: define semantic capability, coverage, parser-gap V2, architecture, rule,
and election schemas without changing scanner behavior.

Files:

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/semantic-capabilities.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/core/test/semantic-capabilities.test.ts`
- Modify: `docs/architecture/beta-claims.json`

RED tests:

```ts
it("rejects blocking semantic capabilities without deterministic certification", () => {
  expect(() => SemanticCapabilityContractSchema.parse({
    schema_version: "drift.semantic_capability.v1",
    capability_id: "ts.computed_calls.v1",
    display_name: "Computed call resolution",
    language: "typescript",
    support: "partial",
    certification: "experimental",
    can_block: true,
    evidence_classes: ["heuristic"],
    emitted_fact_kinds: [],
    emitted_node_kinds: [],
    emitted_edge_kinds: [],
    parser_gap_kinds: ["computed_call_unresolved"],
    fixture_suites: ["ts-computed-calls"],
    required_for_beta_claims: [],
    owner: "rust_engine"
  })).toThrow("blocking semantic capabilities require certified deterministic evidence");
});

it("requires active conventions to reference known semantic capabilities", () => {
  const result = validateConventionRuleCapabilities({
    rule: {
      rule_id: "api_route_no_direct_data_access",
      requires_capabilities: ["ts.static_imports.v1", "ts.missing.v1"]
    },
    capabilities: BUILTIN_SEMANTIC_CAPABILITIES
  });

  expect(result).toEqual({
    valid: false,
    missing_capabilities: ["ts.missing.v1"]
  });
});
```

Expected RED:

- `SemanticCapabilityContractSchema` does not exist.
- `validateConventionRuleCapabilities` does not exist.

GREEN requirements:

- Add schema and domain types.
- Add built-in capability list for V1.
- Enforce `can_block` certification rule in schema refine.
- Export capability helpers from `@drift/core`.

Done when:

- Core tests prove capability schema validation.
- `beta-claims.json` references semantic capability proof as required for TS/JS
  intelligence claims.

## Phase 2: Parser Gap V2 And Unsupported Pattern Visibility

Goal: every unsupported TS/JS semantic pattern becomes visible, scoped, and
confidence-affecting.

Files:

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/cli/src/domain/scan-status.ts`
- Modify: `packages/cli/src/formatters/scan-status.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`
- Test: `packages/cli/test/cli.test.ts`

RED tests:

```ts
it("persists parser gap v2 with affected semantic capabilities", () => {
  const gap = ParserGapV2Schema.parse({
    schema_version: "drift.parser_gap.v2",
    parser_gap_id: "gap_dynamic_import_route_1",
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    file_path: "app/api/users/route.ts",
    start_line: 4,
    end_line: 4,
    kind: "dynamic_import_unresolved",
    message: "Dynamic import target is not statically resolvable.",
    affected_capabilities: ["ts.dynamic_imports.v1", "ts.route_flow.v1"],
    affected_contract_kinds: ["api_route_no_direct_data_access"],
    confidence_impact: "blocks_enforcement",
    suggested_action: "rewrite_static",
    evidence_refs: ["evidence_graph_1"]
  });

  storage.insertParserGaps([gap]);
  expect(storage.parserGapsForScan("scan_abc")).toContainEqual(gap);
});

it("scan status groups parser gaps by capability and contract kind", () => {
  const status = scanStatusPayload(storage, "repo_abc");
  expect(status.parser_gap_summary.by_capability["ts.route_flow.v1"]).toBe(1);
  expect(status.parser_gap_summary.by_contract_kind["api_route_no_direct_data_access"]).toBe(1);
});
```

Historical RED:

- Parser gap V2 fields were not persisted or grouped. Current beta wiring keeps
  V2 as an existing source contract and derives `drift.parser_gap_quality.v1`
  in `@drift/query` for grouped user-facing quality; it does not claim
  production-complete TypeScript semantics.

GREEN requirements:

- Add migration columns or a JSON payload for V2 fields.
- Preserve existing parser gap reads.
- Add grouped summaries to scan status.
- Do not emit source text by default.

Done when:

- Storage and CLI tests prove grouped parser-gap visibility.

## Phase 3: Module Resolution Contract

Goal: make resolution results durable and separate supported static resolution
from unsupported dynamic/CommonJS cases.

Files:

- Modify: `crates/drift-engine/src/main.rs`
- Modify: `crates/drift-engine/src/protocol.rs`
- Modify: `crates/drift-engine/tests/stream_graph.rs`
- Modify: `packages/engine-contract/src/index.ts`
- Modify: `packages/engine-contract/test/engine-contract.test.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/cli/src/engine/collect-scan-data.ts`

RED tests:

```rust
#[test]
fn scan_stream_emits_module_resolution_records_for_static_dynamic_and_require() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(dir.path().join("tsconfig.json"), r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#).unwrap();
    fs::create_dir_all(dir.path().join("src")).unwrap();
    fs::write(dir.path().join("src/db.ts"), "export const db = {};\n").unwrap();
    fs::write(dir.path().join("src/route.ts"), r#"
import { db } from "@/db";
const legacy = require("./legacy");
const mod = await import(process.env.MODULE_NAME);
"#).unwrap();
    fs::write(dir.path().join("src/legacy.ts"), "export const legacy = {};\n").unwrap();

    let output = run_scan_jsonl(dir.path());
    let resolutions = events_named(&output, "module_resolution_batch");

    assert_resolution(&resolutions, "@/db", "resolved", "tsconfig_paths");
    assert_resolution(&resolutions, "./legacy", "resolved", "relative_extensions");
    assert_resolution(&resolutions, "process.env.MODULE_NAME", "unsupported", "unsupported_dynamic");
    assert_gap(&output, "dynamic_import_unresolved");
}
```

Expected RED:

- Engine does not emit `module_resolution_batch`.
- Contract package does not validate module resolution records.

GREEN requirements:

- Emit module resolution records from Rust.
- Validate boundary shape in `@drift/engine-contract`.
- Persist module resolutions.
- Link unresolved/unsupported resolution to parser gap.

Done when:

- Static imports, literal require, and dynamic import gaps are represented
  separately.

## Phase 4: Symbol Identity V2 And Changed Symbols

Goal: make declarations/imports/re-exports/references useful enough for change
impact and symbol-scoped conventions.

Files:

- Modify: `crates/drift-engine/src/main.rs`
- Modify: `crates/drift-engine/src/facts.rs`
- Modify: `crates/drift-engine/tests/stream_graph.rs`
- Modify: `packages/engine-contract/src/index.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Modify: `packages/query/src/symbol-identity.ts`
- Modify: `packages/query/src/change-impact.ts`
- Test: `packages/query/test/query.test.ts`

RED tests:

```ts
it("populates changed symbols from persisted symbol identities", () => {
  const impact = buildChangeImpact({
    changed_files: ["src/services/users.ts"],
    symbol_identities: [{
      schema_version: "drift.symbol_identity.v2",
      symbol_id: "sym_listUsers",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      canonical_name: "listUsers",
      declaration_file: "src/services/users.ts",
      declaration_span: { start_line: 1, start_column: 1, end_line: 3, end_column: 2 },
      symbol_kind: "function",
      export_kind: "named",
      aliases: [],
      re_export_chain: [],
      reference_count: 2,
      confidence: "high",
      resolution_status: "resolved",
      parser_gap_ids: []
    }],
    route_flows: []
  });

  expect(impact.changed_symbols).toEqual(["listUsers"]);
});
```

Expected RED:

- `changed_symbols` is empty.
- Symbol identity V2 does not exist.

GREEN requirements:

- Persist symbol identity V2.
- Populate changed symbols by declaration file.
- Mark unresolved re-export or namespace cases partial.

Done when:

- `changed_symbols` is no longer a placeholder for resolved symbols.

## Phase 5: Call Resolution And Data Operation V2

Goal: separate direct/member calls from computed/chained/wrapper calls, and make
data operations precise enough for route-layering checks.

Files:

- Modify: `crates/drift-engine/src/facts.rs`
- Modify: `crates/drift-engine/src/main.rs`
- Modify: `crates/drift-engine/tests/stream_graph.rs`
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/query/src/data-operation-risk.ts`
- Test: `packages/query/test/query.test.ts`

RED tests:

```rust
#[test]
fn scan_stream_marks_computed_calls_as_parser_gaps_and_resolves_direct_data_ops() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(dir.path().join("app/api/users")).unwrap();
    fs::write(dir.path().join("app/api/users/route.ts"), r#"
import { db } from "../../../lib/db";

export async function GET() {
  const method = "findMany";
  await db.user.findMany();
  await db.user[method]();
}
"#).unwrap();
    fs::create_dir_all(dir.path().join("lib")).unwrap();
    fs::write(dir.path().join("lib/db.ts"), "export const db = {};\n").unwrap();

    let output = run_scan_jsonl(dir.path());

    assert_data_operation(&output, "db.user", "findMany", "read", "high");
    assert_gap(&output, "computed_call_unresolved");
}
```

Expected RED:

- Computed call does not emit a parser gap.
- Data operation V2 does not exist.

GREEN requirements:

- Emit call resolution records.
- Emit data operation V2 records.
- Add parser gaps for computed calls.
- Keep current data operation behavior working.

Done when:

- Direct `db.user.findMany()` is high-confidence.
- `db.user[method]()` blocks enforcement for affected flow unless explicitly
  supported later.

## Phase 6: Framework Adapter V2 And Unsupported Framework Magic

Goal: make Next support explicit and all unsupported framework magic visible.

Files:

- Modify: `packages/adapters/src/index.ts`
- Modify: `crates/drift-engine/src/main.rs`
- Modify: `crates/drift-engine/tests/stream_graph.rs`
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/query/src/readiness.ts`
- Test: `packages/adapters/test/adapters.test.ts`

RED tests:

```ts
it("does not certify decorator routes for blocking without an adapter fixture", () => {
  const adapter = frameworkAdapterFor("nest");
  expect(adapter.certification).toBe("experimental");
  expect(adapter.can_block).toBe(false);
  expect(adapter.unsupported_patterns).toContain("decorator routing");
});
```

```rust
#[test]
fn scan_stream_reports_decorator_route_as_unsupported_framework_pattern() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(dir.path().join("users.controller.ts"), r#"
@Controller("users")
export class UsersController {
  @Get()
  listUsers() {}
}
"#).unwrap();

    let output = run_scan_jsonl(dir.path());
    assert_gap(&output, "decorator_route_unresolved");
}
```

Expected RED:

- Decorator routes are not reported as unsupported framework pattern.

GREEN requirements:

- Certify Next supported patterns only.
- Emit unsupported framework parser gaps for decorator/router magic.
- Ensure readiness downgrades affected route claims.

Done when:

- Framework magic cannot silently disappear from beta graph confidence.

## Phase 7: Architecture Contract And Role Ontology

Goal: make role/layer policy explicit and accepted by repo contracts.

Files:

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Create/modify: `packages/query/src/role-ontology.ts`
- Modify: `packages/query/src/layer-architecture.ts`
- Modify: `packages/cli/src/domain/contract-materialization.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`

RED tests:

```ts
it("classifies route to data access as forbidden only when role evidence is high confidence", () => {
  const result = evaluateArchitectureEdge({
    architecture: defaultArchitectureContract(),
    from: { file_path: "app/api/users/route.ts", role: "route", confidence: "high" },
    to: { file_path: "src/db.ts", role: "data_access", confidence: "low" },
    edge_kind: "imports"
  });

  expect(result).toEqual({
    policy: "advisory_only",
    reason: "target_role_confidence_below_blocking_threshold"
  });
});

it("materializes repo contracts with architecture fingerprint", () => {
  const contract = materializeRepoContract({
    repo_id: "repo_abc",
    architecture_contract: defaultArchitectureContract(),
    conventions: []
  });

  expect(contract.architecture_contract_id).toBe("default_ts_architecture_v1");
  expect(contract.architecture_contract_fingerprint).toMatch(/^[a-f0-9]{64}$/);
});
```

Expected RED:

- Architecture contract is not first-class in repo materialization.

GREEN requirements:

- Add default architecture contract.
- Bind it to repo contract materialization.
- Role edge evaluation returns allowed, forbidden, advisory, or ignored.

Done when:

- Route/data-access blocking checks depend on explicit architecture policy and
  role confidence.

## Phase 8: Convention Rule V2 And Election V2

Goal: make convention rules versioned, capability-bound, and governed through
audited elections.

Files:

- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/contracts.ts`
- Modify: `packages/cli/src/domain/convention-candidates.ts`
- Modify: `packages/cli/src/domain/contract-materialization.ts`
- Modify: `packages/cli/src/commands/conventions.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/sqlite-storage.ts`
- Test: `packages/core/test/domain.test.ts`
- Test: `packages/storage/test/sqlite-storage.test.ts`
- Test: `packages/cli/test/cli.test.ts`

RED tests:

```ts
it("refuses to activate a convention when semantic coverage is advisory only", () => {
  const result = activateConvention({
    candidate_id: "candidate_route_no_db",
    semantic_coverage: {
      decision: "advisory_only",
      reasons: ["parser_gap_blocks_enforcement"]
    },
    confirm: true
  });

  expect(result).toEqual({
    activated: false,
    reason: "semantic_coverage_not_blocking_safe"
  });
});

it("writes an audited convention election for accept and activate", () => {
  const result = acceptConventionCandidate({
    candidate_id: "candidate_route_no_db",
    actor: "geoffrey",
    confirm: true
  });

  expect(result.election).toMatchObject({
    schema_version: "drift.convention_election.v2",
    previous_state: "candidate",
    next_state: "active",
    decision: "activate",
    can_block: true
  });
  expect(result.audit_event_id).toBe(result.election.audit_event_id);
});
```

Expected RED:

- Election V2 is not persisted.
- Activation does not require semantic coverage.

GREEN requirements:

- Add convention rule contracts.
- Add election V2 records.
- Gate activation on semantic coverage.
- Audit every governance mutation.

Done when:

- Accepted active conventions carry rule, architecture, capability, coverage,
  and election evidence.

## Phase 9: Semantic Readiness Across Query, CLI, And MCP

Goal: one readiness/coverage decision appears consistently across agent-facing
surfaces.

Files:

- Modify: `packages/query/src/readiness.ts`
- Create: `packages/query/src/semantic-coverage.ts`
- Modify: `packages/query/src/index.ts`
- Modify: `packages/cli/src/commands/prepare.ts`
- Modify: `packages/cli/src/commands/repo-map.ts`
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/query/test/query.test.ts`
- Test: `packages/cli/test/cli.test.ts`
- Test: `packages/mcp/test/mcp.test.ts`

RED tests:

```ts
it("returns identical semantic coverage from CLI prepare and MCP preflight", async () => {
  const cli = await runCliJson(["prepare", "touch user route", "--repo", "repo_abc"]);
  const mcp = await callMcpTool("get_task_preflight", {
    repo_id: "repo_abc",
    task: "touch user route"
  });

  expect(mcp.semantic_coverage).toEqual(cli.semantic_coverage);
  expect(mcp.parser_gaps).toEqual(cli.parser_gaps);
});
```

Expected RED:

- CLI/MCP do not share semantic coverage response builder.

GREEN requirements:

- Build semantic coverage in query.
- CLI and MCP call shared builder.
- Preserve read-only MCP boundary.

Done when:

- Agent surfaces expose the same confidence decisions.

## Phase 10: Check Enforcement Proof And Blocking Safety

Goal: block only when convention, architecture, semantic coverage, and evidence
all line up.

Files:

- Modify: `packages/cli/src/check/run-check.ts`
- Modify: `crates/drift-engine/src/check_command.rs`
- Modify: `packages/core/src/domain.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/storage/src/migrations.ts`
- Test: `packages/cli/test/security-check.test.ts`
- Test: `test/e2e/rd-architecture-drift.test.ts`

RED tests:

```ts
it("refuses blocking check when dynamic import gap affects route flow", async () => {
  const result = await runCheck({
    repo_id: "repo_dynamic",
    convention_id: "api_route_no_direct_data_access",
    scope: "full"
  });

  expect(result.status).toBe("refused");
  expect(result.readiness.decision).toBe("refuse");
  expect(result.reasons).toContain("required_semantic_capability_blocked_by_parser_gap");
  expect(result.findings).toEqual([]);
});

it("blocking finding includes semantic check proof", async () => {
  const result = await runCheck({
    repo_id: "repo_direct_db",
    convention_id: "api_route_no_direct_data_access",
    scope: "full"
  });

  expect(result.findings[0].semantic_check_proof).toMatchObject({
    schema_version: "drift.semantic_check_proof.v1",
    coverage_decision: "blocking_allowed",
    required_capabilities: expect.arrayContaining([
      "ts.static_imports.v1",
      "ts.import_resolution.v1",
      "ts.data_operations.v1",
      "ts.route_flow.v1"
    ])
  });
});
```

Expected RED:

- Checks do not produce semantic check proof.
- Dynamic import parser gap does not force refusal.

GREEN requirements:

- Checks require semantic coverage.
- Blocking findings include semantic proof.
- Parser gaps affecting required capabilities downgrade to advisory/refusal.

Done when:

- False blocks from partial semantic graphs are structurally prevented.

## Phase 11: Beta Proof And Claim Gate

Goal: CI fails if Drift overclaims TS semantic understanding.

Files:

- Modify: `scripts/run-beta-proof.mjs`
- Modify: `scripts/generate-release-proof.mjs`
- Modify: `scripts/validate-product-claims.mjs`
- Modify: `docs/architecture/beta-claims.json`
- Test: `test/e2e/release-hygiene.test.ts`

RED tests:

```ts
it("beta proof fails when a beta-required semantic capability is partial", () => {
  const proof = runBetaProof({
    semantic_capabilities: [{
      capability_id: "ts.dynamic_imports.v1",
      support: "partial",
      required_for_beta_claims: ["complete semantic TypeScript graph"]
    }]
  });

  expect(proof.semantic_beta_proof.claim_gate_verified).toBe(false);
  expect(proof.semantic_beta_proof.partial_beta_required_count).toBe(1);
});

it("claim validation rejects complete semantic understanding wording", () => {
  expect(() => validateProductClaim(
    "Drift fully understands arbitrary TypeScript dataflow."
  )).toThrow("unsupported beta claim");
});
```

Expected RED:

- Claim gate does not inspect semantic capability support.

GREEN requirements:

- Add semantic beta proof section.
- Validate docs and package copy against claim boundary.
- Require unsupported-pattern visibility fixture.

Done when:

- Public beta wording cannot outrun the semantic capability ledger.

## Phase 12: Dogfood Transcript Update

Goal: prove Drift reports its own TS semantic gaps honestly.

Files:

- Modify: `docs/dogfood/drift-on-drift.md`
- Modify: `docs/architecture/typescript-code-intelligence-map.md`
- Modify: `docs/architecture/beta-intelligence-gate.md`

Required transcript sections:

- scan summary,
- semantic capability summary,
- parser gaps grouped by kind/capability/contract,
- repo map semantic coverage,
- prepare semantic envelope,
- no-contract refusal,
- accepted-contract fixture proof,
- CLI/MCP parity,
- audit proof,
- backup proof,
- claim gate proof.

Done when:

- Dogfood transcript makes unresolved/unsupported TS semantics visible and does
  not imply broad semantic completeness.

## Final Verification Gate

The full implementation is complete only when these pass from
`/Users/geoffreyfernald/Downloads/driftv3/drift v3`:

```bash
pnpm verify:ci
pnpm beta:proof
pnpm release:proof
git diff --check
```

Required focused gates:

```bash
cargo test -p drift-engine stream_graph -- --nocapture
pnpm --filter @drift/core test
pnpm --filter @drift/query test
pnpm --filter @drift/storage test
pnpm --filter @drift/engine-contract test
pnpm --filter @drift/cli test
pnpm --filter @drift/mcp test
pnpm exec vitest run test/e2e/release-hygiene.test.ts
```

## Acceptance Criteria

- Semantic capabilities are versioned, schema-validated, and claim-gated.
- Parser gaps include affected capabilities and contract kinds.
- Dynamic imports, computed calls, DI containers, decorators, framework magic,
  alias-heavy wrappers, and unresolved namespace symbols are visible.
- Module resolution records separate resolved, unresolved, external,
  unsupported, and partial cases.
- Symbol identity V2 powers non-empty `changed_symbols` for resolved
  declarations.
- Call and data operation records distinguish direct/member, computed, chained,
  wrapper, and unknown shapes.
- Architecture roles and edge policies are explicit and fingerprinted into repo
  contracts.
- Convention rules require semantic capabilities and architecture contracts.
- Convention elections are audited and cannot activate blocking conventions
  without blocking-safe semantic coverage.
- CLI and MCP expose the same semantic coverage and parser gap decisions.
- Blocking findings include semantic check proof.
- Beta proof fails on unsupported beta-required semantic claims.
- Dogfood transcript shows Drift's own semantic gaps.

## What To Defer Past V1 Beta

These are valuable, but they should not block the narrow beta if unsupported
patterns are visible and enforcement downgrades correctly:

- full TypeScript compiler/language-service type graph,
- complete interprocedural dataflow,
- dynamic import runtime expansion,
- arbitrary decorator metadata support,
- generic DI container resolution,
- complete Express/Fastify/Nest/Remix adapter coverage,
- full test coverage graph,
- multi-language semantic parity,
- source-code mutation.

## Implementation Order

Execute in this order:

1. Contract schemas and capability ledger.
2. Parser gap V2 and unsupported pattern visibility.
3. Module resolution contract.
4. Symbol identity V2 and changed symbols.
5. Call resolution and data operation V2.
6. Framework adapter V2.
7. Architecture contract and role ontology.
8. Convention rule V2 and election V2.
9. Shared semantic readiness across query, CLI, and MCP.
10. Check proof and blocking safety.
11. Beta proof and claim gate.
12. Dogfood transcript update.

Do not start broad framework expansion until steps 1 through 11 are complete and
the final verification gate passes.
