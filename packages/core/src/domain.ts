export type ConventionKind =
  | "api_route_no_direct_data_access"
  | "api_route_requires_service_delegation"
  | "api_route_requires_auth_helper"
  | "middleware_must_cover_routes"
  | "api_route_requires_request_validation"
  | "api_route_forbids_untrusted_ssrf"
  | "api_route_forbids_raw_sql_without_params"
  | "api_route_cors_must_match_policy"
  | "api_route_requires_csrf_for_mutation"
  | "api_route_requires_rate_limit"
  | "api_route_forbids_sensitive_response_fields"
  | "api_route_forbids_secret_exposure"
  | "session_object_must_come_from_trusted_helper"
  | "api_route_requires_authorization"
  | "api_route_requires_tenant_scope"
  | "test_expected_for_changed_module"
  | "custom_briefing"
  | AgentContractKind;

export type FileRole =
  | "api_route"
  | "server_module"
  | "service_module"
  | "data_access_module"
  | "component"
  | "ui_component"
  | "hook_module"
  | "schema_module"
  | "test"
  | "config"
  | "cli_command_module"
  | "core_module"
  | "query_module"
  | "factgraph_module"
  | "adapter_module"
  | "storage_module"
  | "engine_bridge_module"
  | "mcp_module"
  | "docs"
  | "package_manifest"
  | "custom";

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

export type AgentContractKind =
  | "file_role"
  | "module_placement"
  | "import_boundary"
  | "entrypoint_flow"
  | "canonical_helper_reuse"
  | "required_change_checks";

export interface ConventionScope {
  path_globs: string[];
  package_names?: string[];
  file_roles?: FileRole[];
  include_symbols?: string[];
  exclude_path_globs?: string[];
}

export interface ConventionMatcher {
  kind: ConventionKind;
  forbidden_imports?: string[];
  forbidden_target_roles?: FileRole[];
  allowed_imports?: string[];
  required_calls?: string[];
  allowed_delegate_imports?: string[];
  applies_to_file_roles?: FileRole[];
  file_roles?: FileRole[];
  path_globs?: string[];
  route_paths?: string[];
  methods?: string[];
  protection_kinds?: string[];
  middleware_ids?: string[];
  matcher_fact_ids?: string[];
}

export type EnforcementCapability =
  | "briefing_only"
  | "heuristic_check"
  | "deterministic_check";

export type Severity = "info" | "warning" | "error" | "blocking" | "release_blocking";

export type FindingDriftCategory =
  | "new_violation"
  | "existing_violation"
  | "worsened_violation"
  | "improved_violation"
  | "new_convention_candidate"
  | "convention_conflict"
  | "architecture_regression"
  | "test_coverage_regression"
  | "unresolved_graph_regression"
  | "missing_proof"
  | "parser_gap";

export type EnforcementMode = "off" | "brief" | "warn" | "block";

export interface ConventionScore {
  supporting_examples_count: number;
  counterexamples_count: number;
  scope_files_count: number;
  coverage_ratio: number;
  heuristic_id: string;
  /**
   * E-6 (D-2): the coverage-direction decision, computed from the baseline scan only
   * (files the analyzed diff changed are excluded from both counts). `demoted: true`
   * marks a legitimate baseline-driven demotion explicitly.
   */
  coverage_direction?: {
    violating_files: number;
    scope_files: number;
    violation_ratio: number;
    threshold: number;
    demoted: boolean;
  };
}

export interface ConventionException {
  id: string;
  reason: string;
  path_globs?: string[];
  symbols?: string[];
  imports?: string[];
  endpoint_paths?: string[];
  methods?: string[];
  resolved_modules?: string[];
  resolved_symbols?: string[];
  data_stores?: string[];
  operation_kinds?: Array<"read" | "write" | "delete" | "unknown">;
  file_roles?: FileRole[];
  contract_kinds?: AgentContractKind[];
  expires_at?: string;
  requires_reapproval_on_change?: boolean;
  approved_file_hashes?: Array<{ file_path: string; content_hash: string }>;
  created_by: string;
  created_at: string;
}

export interface EvidenceRef {
  id: string;
  kind: "supporting" | "counterexample" | "violation" | "baseline";
  file_path: string;
  start_line?: number;
  end_line?: number;
  symbol?: string;
  import_source?: string;
  fact_ids: string[];
  scan_id: string;
  file_hash: string;
  artifact_hash?: string;
  redaction_state: "none" | "redacted" | "snippet_limited";
}

export interface RepoRecord {
  id: string;
  root_path: string;
  fingerprint: string;
  vcs_provider?: "git" | "none";
  remote_url_hash?: string | null;
  package_manager?: string;
  lockfile_hashes?: Record<string, string>;
  resolver_input_hash?: string;
  created_at: string;
  updated_at: string;
}

export interface ScanManifest {
  id: string;
  repo_id: string;
  branch: string;
  commit: string;
  dirty: boolean;
  previous_scan_id?: string;
  scanner_version: string;
  adapter_versions: Record<string, string>;
  rule_engine_version: string;
  status: "started" | "completed" | "failed";
  file_count: number;
  fact_count: number;
  finding_count: number;
  started_at: string;
  completed_at?: string;
  error_message?: string;
}

export interface FileSnapshot {
  repo_id: string;
  scan_id: string;
  file_path: string;
  content_hash: string;
  byte_size: number;
  indexed: boolean;
}

export type ScanFileChangeKind = "added" | "modified" | "deleted" | "unchanged";

export interface ScanFileChange {
  repo_id: string;
  scan_id: string;
  file_path: string;
  change_kind: ScanFileChangeKind;
  previous_hash?: string;
  current_hash?: string;
  created_at: string;
}

export interface ResolverDependency {
  repo_id: string;
  scan_id: string;
  id: string;
  source_path: string;
  dependency_path: string;
  dependency_kind: string;
}

export interface ModuleDependent {
  repo_id: string;
  scan_id: string;
  module_id: string;
  dependent_module_id: string;
  edge_id: string;
}

export interface SymbolOccurrence {
  repo_id: string;
  scan_id: string;
  id: string;
  symbol_id: string;
  occurrence_kind: "declaration" | "reference";
  file_path: string;
  start_line: number;
  end_line: number;
  evidence_id?: string;
}

export interface BackupManifest {
  id: string;
  repo_id: string;
  repo_fingerprint: string;
  schema_version: number;
  source_database_path: string;
  backup_path: string;
  checksum_sha256: string;
  size_bytes: number;
  created_at: string;
}

export type FactKind =
  | "file_detected"
  | "import_used"
  | "re_export_used"
  | "exported_symbol"
  | "symbol_called"
  | "data_operation_detected"
  | "route_declared"
  | "file_role_detected"
  | "test_declared"
  | "auth_guard_called"
  | "route_returns_response"
  | "callback_boundary_detected"
  | "middleware_declared"
  | "middleware_matcher_declared"
  | "middleware_protects_route"
  | "request_input_read"
  | "session_read"
  | "tenant_source"
  | "tenant_guard_called"
  | "authorization_guard_called"
  | "request_validation_called"
  | "validated_input_used"
  | "outbound_request_called"
  | "raw_sql_called"
  | "parameterized_sql_used"
  | "cors_policy_declared"
  | "csrf_guard_called"
  | "rate_limit_guard_called"
  | "sensitive_field_declared"
  | "response_emits_field"
  | "serializer_called"
  | "secret_read";

export type FactEvidenceLevel = "path" | "text" | "ast" | "graph" | "heuristic";
export type FactResolutionStatus = "resolved" | "unresolved" | "partial" | "unsupported";
export type FactStalenessStatus = "fresh" | "stale" | "unknown";
export type ConfidenceLabel = "certain" | "high" | "medium" | "low" | "heuristic";

export interface SourceSpan {
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
}

/**
 * The `runtime_use` values the engine emits on `import_used` facts. Mirrors the constants in
 * `crates/drift-engine/src/facts.rs`; the engine owns the values, this names them once on the
 * TypeScript side so consumers do not each spell the string inline.
 */
export const RUNTIME_USE_VALUE_POSITION = "value_position";
export const RUNTIME_USE_DYNAMIC = "dynamic";
export const RUNTIME_USE_SIDE_EFFECT = "side_effect";

/**
 * The local name the engine records for a bindingless `import "x"` (S10), which binds nothing.
 * It is deliberately not a legal identifier so it can key binding lookups inside the engine
 * without colliding with a real binding - which also means it must never reach a user-facing
 * payload as if it were a symbol.
 */
export const SIDE_EFFECT_IMPORT_BINDING = "(side-effect)";

export interface FactRecord {
  id: string;
  repo_id: string;
  scan_id: string;
  kind: FactKind;
  file_path: string;
  name: string;
  value?: string;
  imported_name?: string;
  /**
   * Proof that the imported module is executed at runtime: `value_position`, `dynamic`
   * (require/import(), runtime by construction) or `side_effect` (a bindingless `import "x"`).
   * Absent means no runtime use was proven, which keeps member-level symbol conservatism in
   * force. Persisted, because scan reuse hands these facts back to the engine and a dropped
   * proof silently re-imposes that conservatism (EW-1).
   */
  runtime_use?: string;
  start_line: number;
  end_line: number;
  /**
   * The occurrence's position, columns included.
   *
   * EW-6 (DET-1): the columns used to be hardcoded to 1 while the engine had none to give, so two
   * occurrences on one line were indistinguishable - and since the fact id is derived from
   * (scan, file, kind, name, value, line, column), `ON CONFLICT(id) DO UPDATE` collapsed them into
   * a single row. That is why the full-scan path (which counts engine emissions) and the
   * incremental path (which counts stored rows) disagreed, and worse, why the second occurrence
   * was genuinely lost rather than merely miscounted.
   */
  source_span: SourceSpan;
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
}

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

export type ParserGapConfidenceImpact = "none" | "lowers_file" | "lowers_flow" | "blocks_enforcement";

export interface ParserGap {
  schema_version: "drift.parser_gap.v1";
  gap_id: string;
  repo_id: string;
  scan_id: string;
  kind: ParserGapKind;
  file_path: string;
  start_line: number;
  end_line: number;
  confidence_impact: ParserGapConfidenceImpact;
  message: string;
  evidence_refs: string[];
  created_at: string;
}

export type ParserGapKindV2 =
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

export type ParserGapSuggestedAction =
  | "add_fixture"
  | "accept_advisory"
  | "rewrite_static"
  | "configure_adapter"
  | "defer";

export interface ParserGapV2 {
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
  affected_contract_kinds: ConventionKind[];
  confidence_impact: ParserGapConfidenceImpact;
  suggested_action: ParserGapSuggestedAction;
  evidence_refs: string[];
}

export type ScanCapabilityReportScope =
  | "repo"
  | "changed-files"
  | "changed-hunks"
  | "route-flow"
  | "file";

export interface ScanCapabilityCompleteness {
  scope: ScanCapabilityReportScope;
  rule_id?: string;
  complete: boolean;
  can_block: boolean;
  reasons: string[];
}

export interface ScanCapabilityReport {
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
  completeness: ScanCapabilityCompleteness[];
  parser_gap_count: number;
  parser_gap_kinds: Record<string, number>;
  fallback_used: boolean;
  enforcement_degraded: boolean;
  /** BB-2: which resolution route produced the engine. `null` means unverified, not "the good one". */
  engine_resolution: "env_override" | "packaged_optional_dependency" | "workspace_cargo" | null;
  /** BB-2: the profile the engine reported for itself. `null` means it could not be asked. */
  engine_build_profile: "release" | "debug" | null;
  created_at: string;
}

export type SemanticCapabilityCertification =
  | "certified_deterministic"
  | "certified_heuristic"
  | "experimental"
  | "unsupported";

export type SemanticCapabilitySupport =
  | "supported"
  | "partial"
  | "unsupported"
  | "deferred";

export type SemanticCapabilityEvidenceClass =
  | "path"
  | "text"
  | "ast"
  | "graph"
  | "type_checker"
  | "heuristic"
  | "unsupported_pattern";

export type SemanticCapabilityOwner =
  | "rust_engine"
  | "core_schema"
  | "query"
  | "cli"
  | "mcp"
  | "proof";

export interface SemanticCapabilityContract {
  schema_version: "drift.semantic_capability.v1";
  capability_id: string;
  display_name: string;
  language: "typescript" | "javascript" | "tsx" | "jsx";
  support: SemanticCapabilitySupport;
  certification: SemanticCapabilityCertification;
  can_block: boolean;
  evidence_classes: SemanticCapabilityEvidenceClass[];
  emitted_fact_kinds: string[];
  emitted_node_kinds: string[];
  emitted_edge_kinds: string[];
  parser_gap_kinds: string[];
  fixture_suites: string[];
  required_for_beta_claims: string[];
  owner: SemanticCapabilityOwner;
}

export interface ConventionRuleCapabilityReference {
  rule_id: string;
  requires_capabilities: string[];
}

export interface ConventionRuleCapabilityValidationResult {
  valid: boolean;
  missing_capabilities: string[];
}

export type SemanticCoverageScope =
  | "scan"
  | "file"
  | "route_flow"
  | "check"
  | "preflight"
  | "repo_map"
  | "mcp";

export type SemanticCoverageDecision =
  | "blocking_allowed"
  | "advisory_only"
  | "refuse";

export interface SemanticCoverageContract {
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
}

export type ArchitectureRole = CanonicalRole;

export type ArchitectureEdgePolicy =
  | "allowed"
  | "forbidden"
  | "expected"
  | "allowed_with_risk"
  | "ignored"
  | "advisory_only";

export type ArchitectureEdgeKind =
  | "imports"
  | "calls"
  | "contains"
  | "returns"
  | "uses_data";

export interface ArchitectureContractV1 {
  schema_version: "drift.architecture.v1";
  architecture_id: string;
  repo_id: string;
  version: string;
  source: "default" | "imported" | "elected";
  roles: Array<{
    role: ArchitectureRole;
    description: string;
    detection: "path" | "ast" | "import_graph" | "accepted_convention" | "manual";
    confidence_required_for_blocking: "high";
  }>;
  edge_policies: Array<{
    from_role: ArchitectureRole;
    to_role: ArchitectureRole;
    edge_kind: ArchitectureEdgeKind;
    policy: ArchitectureEdgePolicy;
    required_capabilities: string[];
  }>;
}

export interface ConventionRuleContract {
  schema_version: "drift.convention_rule.v2";
  rule_id: string;
  rule_version: string;
  convention_kind: ConventionKind;
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
}

export type ConventionElectionState =
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

export type ConventionElectionDecision =
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

export interface ConventionElectionContractV2 {
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
}

export type ModuleSpecifierKind = "relative" | "absolute_alias" | "package" | "workspace_package" | "node_builtin" | "dynamic" | "commonjs";
export type ModuleResolutionStatus = "resolved" | "unresolved" | "external" | "unsupported" | "partial";
export type ModuleImportKind = "static_import" | "export_from" | "require" | "dynamic_import" | "type_only";
export type ModuleResolverStrategy = "relative_extensions" | "index_file" | "tsconfig_paths" | "jsconfig_paths" | "package_exports" | "workspace_package" | "node_builtin" | "unsupported_dynamic";

export interface ModuleResolutionRecord {
  schema_version: "drift.module_resolution.v1";
  resolution_id: string;
  repo_id: string;
  scan_id: string;
  importer_file: string;
  source: string;
  specifier_kind: ModuleSpecifierKind;
  import_kind: ModuleImportKind;
  resolved_file_path?: string;
  resolved_package_name?: string;
  status: ModuleResolutionStatus;
  resolver_strategy: ModuleResolverStrategy;
  evidence_ref: string;
  parser_gap_id?: string;
}

export interface SymbolIdentityV2 {
  schema_version: "drift.symbol_identity.v2";
  symbol_id: string;
  repo_id: string;
  scan_id: string;
  canonical_name: string;
  declaration_file: string;
  declaration_span: SourceSpan;
  symbol_kind: "function" | "class" | "const" | "let" | "var" | "type" | "interface" | "namespace" | "default_export" | "unknown";
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
  resolution_status: FactResolutionStatus;
  parser_gap_ids: string[];
}

export type CallExpressionShape = "identifier" | "member" | "optional_member" | "chained" | "computed_member" | "call_result" | "new_expression" | "decorator" | "unknown";

export interface CallResolutionRecord {
  schema_version: "drift.call_resolution.v1";
  call_id: string;
  repo_id: string;
  scan_id: string;
  file_path: string;
  span: SourceSpan;
  callee_text: string;
  receiver_text?: string;
  root_identifier?: string;
  shape: CallExpressionShape;
  resolved_symbol_id?: string;
  resolved_import_id?: string;
  resolution_status: FactResolutionStatus;
  confidence: "high" | "medium" | "low";
  parser_gap_id?: string;
}

export interface DataOperationRecordV2 {
  schema_version: "drift.data_operation.v2";
  operation_id: string;
  repo_id: string;
  scan_id: string;
  file_path: string;
  call_id: string;
  operation_family: "database" | "cache" | "queue" | "http" | "filesystem" | "secret" | "payment" | "email" | "analytics" | "unknown";
  operation_kind: "read" | "create" | "update" | "delete" | "upsert" | "execute" | "publish" | "send" | "unknown";
  receiver_root: string;
  receiver_path: string[];
  store_name?: string;
  tenant_sensitive: boolean;
  mutation: boolean;
  confidence: "high" | "medium" | "low";
  evidence_ref: string;
  parser_gap_ids: string[];
}

export interface FrameworkAdapterContractV2 {
  schema_version: "drift.framework_adapter.v2";
  adapter_id: string;
  framework: "next" | "express" | "nest" | "fastify" | "remix" | "unknown";
  version_range?: string;
  certification: "certified_deterministic" | "certified_heuristic" | "experimental";
  route_patterns_supported: string[];
  unsupported_patterns: string[];
  emitted_entrypoint_kinds: string[];
  emitted_capabilities: string[];
  parser_gap_kinds: string[];
  fixture_suites: string[];
  can_block: boolean;
}

export interface AgentPreflightSemanticEnvelope {
  schema_version: "drift.agent_preflight_semantic.v1";
  repo_id: string;
  scan_id: string | null;
  task: string;
  decision: "safe_to_edit" | "run_scan_first" | "blocked_by_policy" | "blocked_by_stale_graph" | "context_truncated" | "advisory_only" | "refuse";
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
}

export interface SemanticCheckProof {
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
}

export interface SemanticBetaProof {
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
}

export interface MachineContractVersions {
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
  factgraph_schema_version: "factgraph.v1" | "factgraph.v2";
  scanner_version: string;
  rule_engine_version: string;
  adapter_versions: Record<string, string>;
}

export type EntrypointKind =
  | "api_route"
  | "page_route"
  | "server_action"
  | "cli_command"
  | "cron_job"
  | "queue_consumer"
  | "webhook_handler"
  | "middleware"
  | "test_entrypoint"
  | "script"
  | "migration"
  | "lambda_handler"
  | "worker";

export interface EntrypointFact {
  schema_version: "drift.entrypoint_fact.v1";
  entrypoint_id: string;
  repo_id: string;
  scan_id: string;
  kind: EntrypointKind;
  file_path: string;
  symbol?: string;
  route_pattern?: string;
  method?: string;
  adapter_id: string;
  confidence_label: ConfidenceLabel;
  evidence_refs: string[];
}

export type DataOperationFamily =
  | "orm_operation"
  | "raw_sql_operation"
  | "http_api_call"
  | "filesystem_write"
  | "cache_operation"
  | "queue_publish"
  | "queue_consume"
  | "env_secret_read"
  | "external_service_call"
  | "auth_session_read"
  | "payment_operation"
  | "email_send";

export type DataOperationEffect =
  | "read"
  | "write"
  | "delete"
  | "mutation"
  | "side_effect"
  | "external_effect"
  | "secret_access"
  | "network_effect";

export interface DataOperationRisk {
  schema_version: "drift.data_operation_risk.v1";
  operation_family: DataOperationFamily;
  effect: DataOperationEffect;
  risk: "read" | "write" | "destructive_write" | "side_effect" | "secret_access" | "external_effect" | "unknown";
  confidence_label: ConfidenceLabel;
}

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

export interface GraphNodeRecord {
  id: string;
  kind: "file" | "module" | "symbol" | "import" | "route" | "role" | "data_store" | "data_operation" | "endpoint" | "re_export";
  label: string;
}

export interface GraphEdgeRecord {
  id: string;
  kind:
    | "FILE_CONTAINS_SYMBOL"
    | "MODULE_IMPORTS_MODULE"
    | "FILE_HAS_ROLE"
    | "ROUTE_DECLARED_IN_FILE"
    | "ROUTE_HAS_ENDPOINT"
    | "MODULE_REEXPORTS_MODULE"
    | "REEXPORT_RESOLVES_TO_SYMBOL"
    | "IMPORT_RESOLVES_TO_MODULE"
    | "IMPORT_RESOLVES_TO_SYMBOL"
    | "DATA_OPERATION_READS_DATA_STORE"
    | "DATA_OPERATION_WRITES_DATA_STORE"
    | "DATA_OPERATION_DELETES_DATA_STORE"
    | "DATA_OPERATION_TOUCHES_DATA_STORE";
  from: string;
  to: string;
}

export interface FactGraphArtifact {
  id: string;
  repo_id: string;
  scan_id: string;
  schema_version: "factgraph.v1" | "factgraph.v2";
  graph_hash: string;
  graph: Record<string, unknown>;
  node_count: number;
  edge_count: number;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  repo_id: string;
  actor: string;
  action:
    | "repo_added"
    | "scan_started"
    | "scan_completed"
    | "scan_failed"
    // T110: superseded scans are pruned after a successful scan. Recorded because reclaiming
    // state is a state change, and this project's whole argument is that those should be visible
    // rather than silent - even when what was removed is data nothing referenced.
    | "scans_pruned"
    | "election_accepted"
    | "election_rejected"
    | "election_edited"
    // E-6 (D-2): an accepted convention moved from block to a weaker mode. Explicit by
    // design - a silent block -> warn transition is how T100's recall improvement
    // weakened taxonomy's enforcement without any output saying so.
    | "enforcement_demoted"
    | "finding_resolved"
    | "finding_suppressed"
    | "finding_flagged_for_review"
    | "policy_changed"
    | "agent_permission_changed"
    | "backup_created"
    | "restore_completed"
    | "contract_exported"
    | "contract_imported"
    | "adapter_upgraded"
    | "scan_invalidated"
    | "baseline_created"
    | "baseline_cleared"
    | "required_check_executed";
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  before_hash?: string | null;
  after_hash?: string | null;
  object_schema_version?: string | null;
  created_at: string;
  sequence?: number;
  previous_event_hash?: string | null;
  event_hash?: string | null;
}

export type ConventionStatus =
  | "candidate"
  | "accepted"
  | "rejected"
  | "archived"
  | "expired";

export interface ConventionCandidate {
  id: string;
  repo_id: string;
  scan_id: string;
  kind: ConventionKind;
  statement: string;
  rationale?: string;
  scope: ConventionScope;
  matcher: ConventionMatcher;
  requires?: Record<string, unknown>;
  suggested_severity: Severity;
  suggested_enforcement_mode: EnforcementMode;
  enforcement_capability: EnforcementCapability;
  confidence_label: "low" | "medium" | "high";
  scoring: ConventionScore;
  evidence_refs: EvidenceRef[];
  counterexample_refs: EvidenceRef[];
  matcher_fingerprint?: string;
  scope_fingerprint?: string;
  graph_fingerprint?: string;
  evidence_fingerprint?: string;
  required_capabilities?: string[];
  reason_not_blocking?: "candidate_not_accepted" | "candidate_incomplete" | "candidate_heuristic";
  status: ConventionStatus;
  created_at: string;
}

export interface AcceptedConvention {
  id: string;
  contract_id: string;
  kind: ConventionKind;
  statement: string;
  rationale?: string;
  scope: ConventionScope;
  matcher: ConventionMatcher;
  requires?: Record<string, unknown>;
  severity: Severity;
  enforcement_mode: EnforcementMode;
  enforcement_capability: EnforcementCapability;
  exceptions: ConventionException[];
  evidence_refs: EvidenceRef[];
  counterexample_refs: EvidenceRef[];
  accepted_by: string;
  accepted_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface RejectedInference {
  candidate_id: string;
  evidence_fingerprint?: string;
  matcher_fingerprint?: string;
  scope_fingerprint?: string;
  reason: string;
  rejected_by: string;
  rejected_at: string;
}

export interface BaselineViolation {
  id: string;
  repo_id: string;
  convention_id: string;
  finding_fingerprint: string;
  file_path: string;
  first_seen_scan_id: string;
  first_seen_commit: string;
  status: "active" | "resolved";
  created_at: string;
}

export type FindingStatus =
  | "new"
  | "pre_existing"
  | "needs_review"
  | "fixed"
  | "false_positive"
  | "accepted_drift"
  | "suppressed"
  | "expired";

export type FindingDiffStatus =
  | "new_in_diff"
  | "touched_existing"
  | "outside_diff";

/**
 * What the check actually did (E-1 / S1-02):
 *   pass     - coverage adequate, nothing blocked
 *   fail     - at least one blocking finding
 *   refused  - the check declined to make an enforcement claim (exit 3): enforcement was
 *              degraded by incomplete coverage, or only the TypeScript fallback ran
 *   blocked  - legacy value written by pre-E-1 fallback refusals; kept so stored rows
 *              remain readable, never written by current code
 */
export type CheckRunStatus = "pass" | "fail" | "refused" | "blocked";

export interface CheckRun {
  id: string;
  repo_id: string;
  repo_contract_id: string;
  contract_fingerprint: string;
  scan_id: string;
  status: CheckRunStatus;
  scope: "changed-hunks" | "changed-files" | "full";
  engine_source: "rust" | "typescript";
  fallback_used: boolean;
  stale_scan: boolean;
  capability_complete: boolean;
  findings_count: number;
  blocking_count: number;
  machine_contract_versions?: MachineContractVersions;
  started_at: string;
  completed_at: string;
}

export interface Finding {
  id: string;
  repo_id: string;
  convention_id: string;
  check_id?: string;
  repo_contract_id?: string;
  fingerprint: string;
  title: string;
  message: string;
  severity: Severity;
  enforcement_result: "none" | "warn" | "block";
  status: FindingStatus;
  diff_status: FindingDiffStatus;
  evidence_refs: EvidenceRef[];
  expected_layer?: string;
  actual_layer?: string;
  graph_path?: string[];
  suggested_fix?: string;
  /**
   * BB-5: files in scope that obey this convention, for a reader who would otherwise take the
   * violating neighbours as precedent. Never contains a file with an open finding against this
   * convention - that invariant is the item, not a detail of it.
   */
  conforming_examples?: Array<{ file_path: string; role: string | null }>;
  related_node_ids?: string[];
  confidence_label?: ConfidenceLabel | "heuristic";
  drift_category?: FindingDriftCategory;
  introduced_by_diff?: boolean;
  affected_contract?: string;
  created_by_engine_version?: string;
  created_by_rule_engine_version?: string;
  contract_schema_version?: number;
  created_at: string;
}

export type HelperSimilarityFeature =
  | "name_tokens"
  | "purpose_tags"
  | "parameter_shape"
  | "return_shape"
  | "call_dependencies"
  | "import_dependencies"
  | "body_operation_kinds";

export interface HelperSimilarityEvidence {
  schema_version: "drift.helper_similarity.v1";
  candidate_symbol: string;
  candidate_file_path: string;
  canonical_symbol: string;
  canonical_module: string;
  score: number;
  score_band: "low" | "medium" | "high" | "deterministic";
  matched_features: HelperSimilarityFeature[];
  missing_features: string[];
  evidence_refs: string[];
  blocking_allowed: boolean;
}

export interface EntrypointFlowProofStep {
  step_kind: "auth_helper" | "validation_helper" | "service_delegation" | "response_boundary";
  satisfied: boolean;
  evidence_refs: string[];
  graph_path: string[];
}

export interface EntrypointFlowForbiddenProofStep {
  step_kind: "direct_data_access" | "inline_business_logic";
  present: boolean;
  evidence_refs: string[];
  graph_path: string[];
}

export interface EntrypointFlowProof {
  schema_version: "drift.entrypoint_flow_proof.v1";
  entry_file_path: string;
  contract_id: string;
  required_steps: EntrypointFlowProofStep[];
  forbidden_steps: EntrypointFlowForbiddenProofStep[];
  missing_evidence: string[];
}

export interface RequiredCheckExecution {
  schema_version: "drift.required_check_execution.v1";
  execution_id: string;
  repo_id: string;
  repo_root: string;
  repo_commit: string;
  git_branch: string;
  git_commit_sha: string;
  worktree_dirty: boolean;
  untracked_files_present: boolean;
  scan_id: string | null;
  repo_contract_id: string;
  agent_contract_id: string;
  contract_fingerprint: string;
  repo_contract_version: number;
  command: string;
  argv: string[];
  command_hash: string;
  diff_hash: string;
  lockfile_hash: string | null;
  package_manager: string | null;
  cwd: string;
  started_at: string;
  completed_at: string;
  timeout_ms: number;
  exit_code: number | null;
  status: "passed" | "failed" | "timed_out" | "blocked";
  stdout_hash: string;
  stderr_hash: string;
  stdout_preview: string;
  stderr_preview: string;
  audit_event_id: string;
}

export interface RiskArea {
  id: string;
  path_globs: string[];
  risk_kind:
    | "auth"
    | "billing"
    | "data_access"
    | "migration"
    | "secrets"
    | "external_api"
    | "generated_code";
  reason: string;
}

export interface RepoTopologyArea {
  name: string;
  entrypoints: string[];
  modules: string[];
  services: string[];
  data_access: string[];
  tests: string[];
  external_systems: string[];
  risky_zones: string[];
}

export interface RepoTopology {
  schema_version: "drift.repo_topology.v1";
  repo_id: string;
  scan_id: string | null;
  areas: RepoTopologyArea[];
  entrypoints: string[];
  modules: string[];
  layers: string[];
  flows: string[];
  tests: string[];
  configs: string[];
  external_systems: string[];
  risky_zones: string[];
  generated_zones: string[];
  unknown_zones: string[];
}

export interface SafeCommand {
  command: string;
  reason: string;
  requires_explicit_run: true;
}

export interface RequiredCheck {
  command: string;
  applies_to: ConventionScope;
  reason: string;
  source?: "contract" | "graph_risk";
  evidence_node_ids?: string[];
  risk_kinds?: string[];
}

export type AgentContractEnforcement = "blocking" | "advisory";

export interface FileRoleAgentContract {
  kind: "file_role";
  id: string;
  version: 1;
  roles: Array<{
    role: FileRole;
    path_globs: string[];
    required_exports?: string[];
    forbidden_imports?: string[];
    confidence: "deterministic" | "heuristic";
  }>;
}

export interface ModulePlacementAgentContract {
  kind: "module_placement";
  id: string;
  version: 1;
  statement: string;
  target_role: FileRole;
  allowed_paths: string[];
  forbidden_paths?: string[];
  required_parent_roles?: FileRole[];
  forbidden_contained_roles?: FileRole[];
  examples?: {
    good: string[];
    bad: string[];
  };
  enforcement: AgentContractEnforcement;
}

export interface ImportBoundaryAgentContract {
  kind: "import_boundary";
  id: string;
  version: 1;
  source_roles: FileRole[];
  forbidden_imports?: string[];
  forbidden_target_roles?: FileRole[];
  allowed_imports?: string[];
  allowed_delegate_imports?: string[];
  enforcement: AgentContractEnforcement;
}

export type EntrypointFlowRequiredStep =
  | { kind: "auth_helper"; imports?: string[]; calls?: string[] }
  | { kind: "validation_helper"; imports?: string[]; calls?: string[] }
  | { kind: "service_delegation"; target_roles?: FileRole[]; imports?: string[] }
  | { kind: "response_boundary"; calls?: string[] };

export type EntrypointFlowForbiddenStep =
  | { kind: "direct_data_access" }
  | { kind: "inline_business_logic" };

export interface EntrypointFlowAgentContract {
  kind: "entrypoint_flow";
  id: string;
  version: 1;
  entry_roles: FileRole[];
  required_steps: EntrypointFlowRequiredStep[];
  forbidden_steps?: EntrypointFlowForbiddenStep[];
  enforcement: AgentContractEnforcement;
}

export interface CanonicalHelperReuseAgentContract {
  kind: "canonical_helper_reuse";
  id: string;
  version: 1;
  canonical_helpers: Array<{
    helper_id: string;
    symbol: string;
    module: string;
    roles?: FileRole[];
    applies_to_roles?: FileRole[];
    purpose_tags: string[];
    avoid_new_symbols_matching?: string[];
    avoid_new_files_matching?: string[];
    suggested_import: string;
  }>;
  enforcement: AgentContractEnforcement;
}

export interface RequiredChangeChecksAgentContract {
  kind: "required_change_checks";
  id: string;
  version: 1;
  rules: Array<{
    applies_to: {
      path_globs?: string[];
      file_roles?: FileRole[];
      convention_kinds?: string[];
    };
    required_checks: Array<{
      command: string;
      reason: string;
      required_for_release?: boolean;
    }>;
  }>;
}

export type AgentContract =
  | FileRoleAgentContract
  | ModulePlacementAgentContract
  | ImportBoundaryAgentContract
  | EntrypointFlowAgentContract
  | CanonicalHelperReuseAgentContract
  | RequiredChangeChecksAgentContract;

export interface AgentContractSelection {
  schema_version: "drift.agent.contract_selection.v1";
  repo_id: string;
  scan_id: string;
  selected_contract_ids: string[];
  selected_convention_ids: string[];
  selected_helper_ids: string[];
  selected_required_checks: string[];
  selection_inputs: {
    task_text?: string;
    explicit_paths: string[];
    changed_paths: string[];
    file_roles: FileRole[];
    graph_node_ids: string[];
  };
  reasons: Array<{
    target_id: string;
    reason:
      | "path_match"
      | "role_match"
      | "task_text_match"
      | "graph_reachable"
      | "contract_dependency"
      | "active_waiver";
    evidence_refs: string[];
  }>;
}

export interface AgentPreflightPacket {
  schema_version: "drift.agent.preflight.v3";
  repo_id: string;
  scan_id: string | null;
  stale: boolean;
  task: string;
  selected_contracts: unknown[];
  selected_conventions: unknown[];
  selected_helpers: Array<{
    symbol: string;
    module: string;
    suggested_import: string;
    purpose_tags: string[];
  }>;
  placement_guidance: Array<{
    role: FileRole;
    allowed_paths: string[];
    forbidden_paths: string[];
  }>;
  import_boundaries: unknown[];
  required_flows: unknown[];
  required_checks: Array<{
    command: string;
    reason: string;
  }>;
  active_exceptions: unknown[];
  active_waivers: unknown[];
  agent_instructions: string[];
  diagnostics: string[];
}

export interface AgentPreflightPacketV2 {
  schema_version: "drift.agent_preflight.v2";
  repo_id: string;
  scan_id: string;
  task_model: AgentTask;
  repo_map_summary: {
    relevant_file_count: number;
    route_flow_count: number;
    parser_gap_count: number;
  };
  accepted_conventions: unknown[];
  relevant_files: unknown[];
  role_layer_proof: unknown[];
  change_impact: ChangeImpact;
  test_intelligence: TestIntelligence[];
  parser_gaps: ParserGap[];
  required_checks: unknown[];
  forbidden_actions: string[];
  context_policy: ContextPolicyMatrix;
  confidence: {
    graph_confidence: number;
    reasons: string[];
  };
  /** @deprecated T48: duplicated agent_contract_packet; no longer emitted. */
  legacy_packet?: AgentPreflightPacket;
}

export interface ContractFindingV2 {
  schema_version: "drift.finding.v2";
  finding_id: string;
  contract_id: string;
  convention_id?: string;
  kind: string;
  severity: Severity;
  status: "blocking" | "advisory" | "waived" | "blocked_by_missing_evidence";
  file_path: string;
  range?: {
    start_line: number;
    end_line: number;
  };
  expected: string;
  actual: string;
  evidence_refs: string[];
  graph_path?: string[];
  suggested_fix: string;
  diagnostics: string[];
}

export interface ContextEgressPolicy {
  default_mode: "local_only" | "redacted" | "approval_required";
  denied_globs: string[];
  max_snippet_chars: number;
  allow_full_file_content: boolean;
}

export interface AgentPermission {
  agent: string;
  permissions: Array<"read_context" | "request_preflight" | "propose_resolution">;
}

export interface ContextPolicyMatrix {
  schema_version: "drift.context_policy.v1";
  can_read_repo_map: boolean;
  can_read_source_snippets: boolean;
  can_read_contract: boolean;
  can_read_findings: boolean;
  can_execute_commands: boolean;
  can_modify_contract: boolean;
  can_create_waiver: boolean;
  can_request_human_approval: boolean;
  can_access_secret_like_files: boolean;
  can_emit_patch: boolean;
  egress_level: "no_source" | "symbol_only" | "snippet_allowed" | "full_file_allowed";
}

export interface LayerArchitectureContract {
  schema_version: "drift.layer_architecture.v1";
  architecture_id: string;
  repo_id: string;
  version: number;
  layers: Array<{
    id: string;
    role: CanonicalRole;
    position: "entrypoint" | "middle" | "terminal" | "support";
  }>;
  allowed_edges: Array<{ from_layer: string; to_layer: string; edge_kind?: string }>;
  forbidden_edges: Array<{ from_layer: string; to_layer: string; edge_kind?: string }>;
  soft_edges: Array<{ from_layer: string; to_layer: string; reason: string; edge_kind?: string }>;
}

export interface RepoContract {
  id: string;
  repo_id: string;
  contract_schema_version: number;
  repo_fingerprint: string;
  created_at: string;
  updated_at: string;
  conventions: AcceptedConvention[];
  rejected_inferences: RejectedInference[];
  waivers: ConventionException[];
  risky_areas: RiskArea[];
  agent_contracts?: AgentContract[];
  layer_architecture?: LayerArchitectureContract;
  safe_commands: SafeCommand[];
  required_checks: RequiredCheck[];
  context_egress: ContextEgressPolicy;
  agent_permissions: AgentPermission[];
  semantic_capability_contract_version?: "drift.semantic_capability.v1";
  architecture_contract_id?: string;
  architecture_contract_fingerprint?: string;
  active_convention_rule_ids?: string[];
  active_semantic_capability_ids?: string[];
  beta_claim_profile?: "narrow_route_layering" | "security_boundary" | "custom_internal";
  enforcement_policy?: {
    block_on_parser_gaps: false;
    refuse_on_required_capability_missing: true;
    advisory_on_heuristic_capability: true;
  };
}

export interface PolicyDecision {
  allowed: boolean;
  surface: "cli-preflight" | "cli-check" | "mcp" | "contract-export" | "artifact" | "log" | "ui";
  mode: "local_only" | "redacted" | "approval_required" | "denied";
  reason: string;
  max_snippet_chars: number;
  approved_snippet_chars: number;
}
