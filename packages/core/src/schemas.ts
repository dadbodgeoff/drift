import { z } from "zod";

const RepoRelativePatternSchema = z.string().min(1).refine(
  (value) => !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes(".."),
  "pattern must be repo-relative"
);

export const AgentContractKindSchema = z.enum([
  "file_role",
  "module_placement",
  "import_boundary",
  "entrypoint_flow",
  "canonical_helper_reuse",
  "required_change_checks"
]);

export const ConventionKindSchema = z.enum([
  "api_route_no_direct_data_access",
  "api_route_requires_service_delegation",
  "api_route_requires_auth_helper",
  "middleware_must_cover_routes",
  "api_route_requires_request_validation",
  "api_route_forbids_untrusted_ssrf",
  "api_route_forbids_raw_sql_without_params",
  "api_route_cors_must_match_policy",
  "api_route_requires_csrf_for_mutation",
  "api_route_requires_rate_limit",
  "api_route_forbids_sensitive_response_fields",
  "api_route_forbids_secret_exposure",
  "session_object_must_come_from_trusted_helper",
  "api_route_requires_authorization",
  "api_route_requires_tenant_scope",
  "test_expected_for_changed_module",
  "custom_briefing",
  "file_role",
  "module_placement",
  "import_boundary",
  "entrypoint_flow",
  "canonical_helper_reuse",
  "required_change_checks"
]);

export const FileRoleSchema = z.enum([
  "api_route",
  "server_module",
  "service_module",
  "data_access_module",
  "component",
  "ui_component",
  "hook_module",
  "schema_module",
  "test",
  "config",
  "cli_command_module",
  "core_module",
  "query_module",
  "factgraph_module",
  "adapter_module",
  "storage_module",
  "engine_bridge_module",
  "mcp_module",
  "docs",
  "package_manifest",
  "custom"
]);

export const CanonicalRoleSchema = z.enum([
  "route",
  "controller",
  "service",
  "domain",
  "data_access",
  "schema",
  "model",
  "validation",
  "auth",
  "middleware",
  "queue_worker",
  "cron_job",
  "event_handler",
  "adapter",
  "client_sdk",
  "component",
  "hook",
  "test_unit",
  "test_integration",
  "test_e2e",
  "config",
  "script",
  "migration",
  "generated",
  "documentation",
  "unknown",
  "mixed_role"
]);

export const ConventionScopeSchema = z.object({
  path_globs: z.array(RepoRelativePatternSchema),
  package_names: z.array(z.string().min(1)).optional(),
  file_roles: z.array(FileRoleSchema).optional(),
  include_symbols: z.array(z.string().min(1)).optional(),
  exclude_path_globs: z.array(RepoRelativePatternSchema).optional()
});

export const ConventionMatcherSchema = z.object({
  kind: ConventionKindSchema,
  forbidden_imports: z.array(z.string().min(1)).optional(),
  forbidden_target_roles: z.array(FileRoleSchema).optional(),
  allowed_imports: z.array(z.string().min(1)).optional(),
  required_calls: z.array(z.string().min(1)).optional(),
  allowed_delegate_imports: z.array(z.string().min(1)).optional(),
  applies_to_file_roles: z.array(FileRoleSchema).optional(),
  file_roles: z.array(FileRoleSchema).optional(),
  path_globs: z.array(RepoRelativePatternSchema).optional(),
  route_paths: z.array(z.string().min(1)).optional(),
  methods: z.array(z.string().min(1)).optional(),
  protection_kinds: z.array(z.string().min(1)).optional(),
  middleware_ids: z.array(z.string().min(1)).optional(),
  matcher_fact_ids: z.array(z.string().min(1)).optional()
});

export const EnforcementCapabilitySchema = z.enum([
  "briefing_only",
  "heuristic_check",
  "deterministic_check"
]);

export const SeveritySchema = z.enum(["info", "warning", "error", "blocking", "release_blocking"]);
export const FindingConfidenceLabelSchema = z.enum(["certain", "high", "medium", "low", "heuristic"]);
export const FindingDriftCategorySchema = z.enum([
  "new_violation",
  "existing_violation",
  "worsened_violation",
  "improved_violation",
  "new_convention_candidate",
  "convention_conflict",
  "architecture_regression",
  "test_coverage_regression",
  "unresolved_graph_regression",
  "missing_proof",
  "parser_gap"
]);

export const EnforcementModeSchema = z.enum(["off", "brief", "warn", "block"]);

export const ConventionScoreSchema = z.object({
  supporting_examples_count: z.number().int().nonnegative(),
  counterexamples_count: z.number().int().nonnegative(),
  scope_files_count: z.number().int().nonnegative(),
  coverage_ratio: z.number().min(0).max(1),
  heuristic_id: z.string().min(1),
  // E-6 (D-2): the coverage-direction decision, computed from the baseline scan only.
  // `demoted: true` is the explicit marker that the direction gate chose warn because
  // the baseline itself violates in the majority - never because the analyzed diff
  // added newly-detected violations.
  coverage_direction: z
    .object({
      violating_files: z.number().int().nonnegative(),
      scope_files: z.number().int().nonnegative(),
      violation_ratio: z.number().min(0).max(1),
      threshold: z.number().min(0).max(1),
      demoted: z.boolean()
    })
    .optional()
});

export const ConventionExceptionSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  path_globs: z.array(RepoRelativePatternSchema).optional(),
  symbols: z.array(z.string().min(1)).optional(),
  imports: z.array(z.string().min(1)).optional(),
  endpoint_paths: z.array(z.string().min(1).regex(/^\//, "endpoint paths must start with /")).optional(),
  methods: z.array(z.string().min(1)).optional(),
  resolved_modules: z.array(RepoRelativePatternSchema).optional(),
  resolved_symbols: z.array(z.string().min(1)).optional(),
  data_stores: z.array(z.string().min(1)).optional(),
  operation_kinds: z.array(z.enum(["read", "write", "delete", "unknown"])).optional(),
  file_roles: z.array(FileRoleSchema).optional(),
  contract_kinds: z.array(AgentContractKindSchema).optional(),
  expires_at: z.string().datetime().optional(),
  requires_reapproval_on_change: z.boolean().optional(),
  approved_file_hashes: z.array(z.object({
    file_path: RepoRelativePatternSchema,
    content_hash: z.string().min(1)
  })).optional(),
  created_by: z.string().min(1),
  created_at: z.string().datetime()
});

export const EvidenceRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["supporting", "counterexample", "violation", "baseline"]),
  file_path: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  symbol: z.string().min(1).optional(),
  import_source: z.string().min(1).optional(),
  fact_ids: z.array(z.string().min(1)),
  scan_id: z.string().min(1),
  file_hash: z.string().min(1),
  artifact_hash: z.string().min(1).optional(),
  redaction_state: z.enum(["none", "redacted", "snippet_limited"])
});

export const RepoRecordSchema = z.object({
  id: z.string().min(1),
  root_path: z.string().min(1),
  fingerprint: z.string().min(1),
  vcs_provider: z.enum(["git", "none"]).optional(),
  remote_url_hash: z.string().min(1).nullable().optional(),
  package_manager: z.string().min(1).optional(),
  lockfile_hashes: z.record(z.string().min(1)).optional(),
  resolver_input_hash: z.string().min(1).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const ScanManifestSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().min(1),
  dirty: z.boolean(),
  previous_scan_id: z.string().min(1).optional(),
  scanner_version: z.string().min(1),
  adapter_versions: z.record(z.string().min(1)),
  rule_engine_version: z.string().min(1),
  status: z.enum(["started", "completed", "failed"]),
  file_count: z.number().int().nonnegative(),
  fact_count: z.number().int().nonnegative(),
  finding_count: z.number().int().nonnegative(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  error_message: z.string().optional()
});

export const FileSnapshotSchema = z.object({
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  file_path: z.string().min(1),
  content_hash: z.string().min(1),
  byte_size: z.number().int().nonnegative(),
  indexed: z.boolean()
});

export const ScanFileChangeKindSchema = z.enum(["added", "modified", "deleted", "unchanged"]);

export const ScanFileChangeSchema = z.object({
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  file_path: z.string().min(1),
  change_kind: ScanFileChangeKindSchema,
  previous_hash: z.string().min(1).optional(),
  current_hash: z.string().min(1).optional(),
  created_at: z.string().min(1)
});

export const ResolverDependencySchema = z.object({
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  id: z.string().min(1),
  source_path: z.string().min(1),
  dependency_path: z.string().min(1),
  dependency_kind: z.string().min(1)
});

export const ModuleDependentSchema = z.object({
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  module_id: z.string().min(1),
  dependent_module_id: z.string().min(1),
  edge_id: z.string().min(1)
});

export const SymbolOccurrenceSchema = z.object({
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  id: z.string().min(1),
  symbol_id: z.string().min(1),
  occurrence_kind: z.enum(["declaration", "reference"]),
  file_path: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  evidence_id: z.string().min(1).optional()
});

export const BackupManifestSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  repo_fingerprint: z.string().min(1),
  schema_version: z.number().int().positive(),
  source_database_path: z.string().min(1),
  backup_path: z.string().min(1),
  checksum_sha256: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  created_at: z.string().datetime()
});

export const FactKindSchema = z.enum([
  "file_detected",
  "import_used",
  "re_export_used",
  "exported_symbol",
  "symbol_called",
  "data_operation_detected",
  "route_declared",
  "file_role_detected",
  "test_declared",
  "auth_guard_called",
  "route_returns_response",
  "callback_boundary_detected",
  "middleware_declared",
  "middleware_matcher_declared",
  "middleware_protects_route",
  "request_input_read",
  "session_read",
  "tenant_source",
  "tenant_guard_called",
  "authorization_guard_called",
  "request_validation_called",
  "validated_input_used",
  "outbound_request_called",
  "raw_sql_called",
  "parameterized_sql_used",
  "cors_policy_declared",
  "csrf_guard_called",
  "rate_limit_guard_called",
  "sensitive_field_declared",
  "response_emits_field",
  "serializer_called",
  "secret_read"
]);

export const FactEvidenceLevelSchema = z.enum(["path", "text", "ast", "graph", "heuristic"]);
export const FactResolutionStatusSchema = z.enum(["resolved", "unresolved", "partial", "unsupported"]);
export const FactStalenessStatusSchema = z.enum(["fresh", "stale", "unknown"]);
export const ConfidenceLabelSchema = z.enum(["certain", "high", "medium", "low", "heuristic"]);

export const SourceSpanSchema = z.object({
  start_line: z.number().int().positive(),
  start_column: z.number().int().positive(),
  end_line: z.number().int().positive(),
  end_column: z.number().int().positive()
});

export const FactRecordSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  kind: FactKindSchema,
  file_path: z.string().min(1),
  name: z.string().min(1),
  value: z.string().optional(),
  imported_name: z.string().optional(),
  runtime_use: z.string().min(1).optional(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  source_span: SourceSpanSchema,
  ast_node_kind: z.string().min(1).nullable(),
  extraction_method: z.string().min(1),
  extractor_version: z.string().min(1),
  parser_version: z.string().min(1),
  confidence: z.number().min(0).max(1),
  confidence_label: ConfidenceLabelSchema,
  evidence_level: FactEvidenceLevelSchema,
  resolution_status: FactResolutionStatusSchema,
  staleness_status: FactStalenessStatusSchema,
  last_seen_scan_id: z.string().min(1)
});

export const ParserGapKindSchema = z.enum([
  "unresolved_import",
  "unresolved_symbol",
  "unknown_file_role",
  "mixed_file_role",
  "unsupported_framework_pattern",
  "parser_error",
  "partial_parse",
  "dynamic_import_unresolved",
  "reflection_or_magic_detected"
]);

export const ParserGapConfidenceImpactSchema = z.enum([
  "none",
  "lowers_file",
  "lowers_flow",
  "blocks_enforcement"
]);

export const ParserGapSchema = z.object({
  schema_version: z.literal("drift.parser_gap.v1"),
  gap_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  kind: ParserGapKindSchema,
  file_path: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  confidence_impact: ParserGapConfidenceImpactSchema,
  message: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)),
  created_at: z.string().min(1)
});

export const ParserGapKindV2Schema = z.enum([
  "unresolved_import",
  "unresolved_import_symbol",
  "unsupported_namespace_import_symbol",
  "unresolved_symbol",
  "unknown_file_role",
  "mixed_file_role",
  "unsupported_framework_pattern",
  "dynamic_import_unresolved",
  "computed_call_unresolved",
  "chained_call_partial",
  "decorator_route_unresolved",
  "di_container_unresolved",
  "wrapper_alias_unresolved",
  "type_only_boundary_ignored",
  "framework_magic_detected"
]);

export const ParserGapSuggestedActionSchema = z.enum([
  "add_fixture",
  "accept_advisory",
  "rewrite_static",
  "configure_adapter",
  "defer"
]);

export const ParserGapV2Schema = z.object({
  schema_version: z.literal("drift.parser_gap.v2"),
  parser_gap_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  file_path: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  kind: ParserGapKindV2Schema,
  message: z.string().min(1),
  source_text_hash: z.string().min(1).optional(),
  affected_capabilities: z.array(z.string().min(1)).min(1),
  affected_contract_kinds: z.array(ConventionKindSchema).min(1),
  confidence_impact: ParserGapConfidenceImpactSchema,
  suggested_action: ParserGapSuggestedActionSchema,
  evidence_refs: z.array(z.string().min(1)).min(1)
});

export const ScanCapabilityReportScopeSchema = z.enum([
  "repo",
  "changed-files",
  "changed-hunks",
  "route-flow",
  "file"
]);

export const ScanCapabilityCompletenessSchema = z.object({
  scope: ScanCapabilityReportScopeSchema,
  rule_id: z.string().min(1).optional(),
  complete: z.boolean(),
  can_block: z.boolean(),
  reasons: z.array(z.string().min(1))
});

export const ScanCapabilityReportSchema = z.object({
  schema_version: z.literal("drift.scan_capability_report.v1"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  engine_source: z.enum(["rust", "typescript"]),
  engine_version: z.string().min(1).nullable(),
  scanner_version: z.string().min(1),
  adapter_versions: z.record(z.string().min(1)),
  certified_capabilities: z.array(z.string().min(1)),
  required_capabilities: z.array(z.string().min(1)),
  missing_capabilities: z.array(z.string().min(1)),
  completeness: z.array(ScanCapabilityCompletenessSchema),
  parser_gap_count: z.number().int().nonnegative(),
  parser_gap_kinds: z.record(z.number().int().nonnegative()),
  fallback_used: z.boolean(),
  enforcement_degraded: z.boolean(),
  created_at: z.string().datetime()
});

export const SemanticCapabilityCertificationSchema = z.enum([
  "certified_deterministic",
  "certified_heuristic",
  "experimental",
  "unsupported"
]);

export const SemanticCapabilitySupportSchema = z.enum([
  "supported",
  "partial",
  "unsupported",
  "deferred"
]);

export const SemanticCapabilityEvidenceClassSchema = z.enum([
  "path",
  "text",
  "ast",
  "graph",
  "type_checker",
  "heuristic",
  "unsupported_pattern"
]);

export const SemanticCapabilityOwnerSchema = z.enum([
  "rust_engine",
  "core_schema",
  "query",
  "cli",
  "mcp",
  "proof"
]);

export const SemanticCapabilityContractSchema = z.object({
  schema_version: z.literal("drift.semantic_capability.v1"),
  capability_id: z.string().min(1),
  display_name: z.string().min(1),
  language: z.enum(["typescript", "javascript", "tsx", "jsx"]),
  support: SemanticCapabilitySupportSchema,
  certification: SemanticCapabilityCertificationSchema,
  can_block: z.boolean(),
  evidence_classes: z.array(SemanticCapabilityEvidenceClassSchema).min(1),
  emitted_fact_kinds: z.array(z.string().min(1)),
  emitted_node_kinds: z.array(z.string().min(1)),
  emitted_edge_kinds: z.array(z.string().min(1)),
  parser_gap_kinds: z.array(z.string().min(1)),
  fixture_suites: z.array(z.string().min(1)),
  required_for_beta_claims: z.array(z.string().min(1)),
  owner: SemanticCapabilityOwnerSchema
}).superRefine((value, ctx) => {
  if (value.can_block && value.certification !== "certified_deterministic") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "blocking semantic capabilities require certified deterministic evidence",
      path: ["can_block"]
    });
  }
});

export const SemanticCoverageScopeSchema = z.enum([
  "scan",
  "file",
  "route_flow",
  "check",
  "preflight",
  "repo_map",
  "mcp"
]);

export const SemanticCoverageDecisionSchema = z.enum([
  "blocking_allowed",
  "advisory_only",
  "refuse"
]);

export const SemanticCoverageContractSchema = z.object({
  schema_version: z.literal("drift.semantic_coverage.v1"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  scope: SemanticCoverageScopeSchema,
  scope_id: z.string().min(1),
  required_capabilities: z.array(z.string().min(1)),
  complete_capabilities: z.array(z.string().min(1)),
  partial_capabilities: z.array(z.string().min(1)),
  missing_capabilities: z.array(z.string().min(1)),
  unsupported_capabilities: z.array(z.string().min(1)),
  parser_gap_ids: z.array(z.string().min(1)),
  unsupported_pattern_ids: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  decision: SemanticCoverageDecisionSchema,
  reasons: z.array(z.string().min(1)),
  generated_at: z.string().datetime()
});

export const ArchitectureEdgePolicySchema = z.enum([
  "allowed",
  "forbidden",
  "expected",
  "allowed_with_risk",
  "ignored",
  "advisory_only"
]);

export const ArchitectureEdgeKindSchema = z.enum([
  "imports",
  "calls",
  "contains",
  "returns",
  "uses_data"
]);

export const ArchitectureContractV1Schema = z.object({
  schema_version: z.literal("drift.architecture.v1"),
  architecture_id: z.string().min(1),
  repo_id: z.string().min(1),
  version: z.string().min(1),
  source: z.enum(["default", "imported", "elected"]),
  roles: z.array(z.object({
    role: CanonicalRoleSchema,
    description: z.string().min(1),
    detection: z.enum(["path", "ast", "import_graph", "accepted_convention", "manual"]),
    confidence_required_for_blocking: z.literal("high")
  })).min(1),
  edge_policies: z.array(z.object({
    from_role: CanonicalRoleSchema,
    to_role: CanonicalRoleSchema,
    edge_kind: ArchitectureEdgeKindSchema,
    policy: ArchitectureEdgePolicySchema,
    required_capabilities: z.array(z.string().min(1))
  }))
});

export const ConventionRuleContractSchema = z.object({
  schema_version: z.literal("drift.convention_rule.v2"),
  rule_id: z.string().min(1),
  rule_version: z.string().min(1),
  convention_kind: ConventionKindSchema,
  statement: z.string().min(1),
  applies_to: z.object({
    path_globs: z.array(RepoRelativePatternSchema).optional(),
    file_roles: z.array(CanonicalRoleSchema).optional(),
    entrypoint_kinds: z.array(z.string().min(1)).optional(),
    methods: z.array(z.string().min(1)).optional()
  }),
  requires_capabilities: z.array(z.string().min(1)).min(1),
  architecture_contract_id: z.string().min(1),
  matcher: z.record(z.unknown()),
  can_block_when: z.object({
    convention_status: z.literal("active"),
    coverage_decision: z.literal("blocking_allowed"),
    capability_certification: z.literal("certified_deterministic")
  }),
  advisory_when: z.array(z.string().min(1)),
  refuse_when: z.array(z.string().min(1))
});

export const ConventionElectionStateSchema = z.enum([
  "detected",
  "candidate",
  "promoted",
  "accepted",
  "active",
  "rejected",
  "deprecated",
  "superseded",
  "conflicted",
  "disabled",
  "expired"
]);

export const ConventionElectionDecisionSchema = z.enum([
  "create_candidate",
  "promote",
  "accept",
  "activate",
  "reject",
  "disable",
  "deprecate",
  "supersede",
  "mark_conflicted",
  "expire"
]);

export const ConventionElectionContractV2Schema = z.object({
  schema_version: z.literal("drift.convention_election.v2"),
  election_id: z.string().min(1),
  repo_id: z.string().min(1),
  candidate_id: z.string().min(1).optional(),
  convention_id: z.string().min(1).optional(),
  previous_state: ConventionElectionStateSchema.nullable(),
  next_state: ConventionElectionStateSchema,
  decision: ConventionElectionDecisionSchema,
  human_actor: z.string().min(1).optional(),
  automated_actor: z.enum(["drift_engine", "cli_import", "policy_import"]).optional(),
  reason: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)),
  counterexample_refs: z.array(z.string().min(1)),
  required_capabilities: z.array(z.string().min(1)),
  semantic_coverage_id: z.string().min(1).optional(),
  architecture_contract_id: z.string().min(1),
  convention_rule_id: z.string().min(1),
  contract_fingerprint_before: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  contract_fingerprint_after: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  audit_event_id: z.string().min(1),
  can_block: z.boolean(),
  blocked_reason: z.string().min(1).optional(),
  created_at: z.string().datetime()
});

export const ModuleResolutionRecordSchema = z.object({
  schema_version: z.literal("drift.module_resolution.v1"),
  resolution_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  importer_file: z.string().min(1),
  source: z.string().min(1),
  specifier_kind: z.enum(["relative", "absolute_alias", "package", "workspace_package", "node_builtin", "dynamic", "commonjs"]),
  import_kind: z.enum(["static_import", "export_from", "require", "dynamic_import", "type_only"]),
  resolved_file_path: z.string().min(1).optional(),
  resolved_package_name: z.string().min(1).optional(),
  status: z.enum(["resolved", "unresolved", "external", "unsupported", "partial"]),
  resolver_strategy: z.enum(["relative_extensions", "index_file", "tsconfig_paths", "jsconfig_paths", "package_exports", "workspace_package", "node_builtin", "unsupported_dynamic"]),
  evidence_ref: z.string().min(1),
  parser_gap_id: z.string().min(1).optional()
});

export const SymbolIdentityV2Schema = z.object({
  schema_version: z.literal("drift.symbol_identity.v2"),
  symbol_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  canonical_name: z.string().min(1),
  declaration_file: z.string().min(1),
  declaration_span: SourceSpanSchema,
  symbol_kind: z.enum(["function", "class", "const", "let", "var", "type", "interface", "namespace", "default_export", "unknown"]),
  export_kind: z.enum(["named", "default", "namespace", "re_export", "local"]),
  aliases: z.array(z.object({
    local_name: z.string().min(1),
    imported_name: z.string().min(1).optional(),
    importer_file: z.string().min(1),
    import_source: z.string().min(1),
    resolution_id: z.string().min(1)
  })),
  re_export_chain: z.array(z.string().min(1)),
  reference_count: z.number().int().nonnegative(),
  confidence: z.enum(["high", "medium", "low"]),
  resolution_status: FactResolutionStatusSchema,
  parser_gap_ids: z.array(z.string().min(1))
});

export const CallResolutionRecordSchema = z.object({
  schema_version: z.literal("drift.call_resolution.v1"),
  call_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  file_path: z.string().min(1),
  span: SourceSpanSchema,
  callee_text: z.string().min(1),
  receiver_text: z.string().min(1).optional(),
  root_identifier: z.string().min(1).optional(),
  shape: z.enum(["identifier", "member", "optional_member", "chained", "computed_member", "call_result", "new_expression", "decorator", "unknown"]),
  resolved_symbol_id: z.string().min(1).optional(),
  resolved_import_id: z.string().min(1).optional(),
  resolution_status: FactResolutionStatusSchema,
  confidence: z.enum(["high", "medium", "low"]),
  parser_gap_id: z.string().min(1).optional()
});

export const DataOperationRecordV2Schema = z.object({
  schema_version: z.literal("drift.data_operation.v2"),
  operation_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  file_path: z.string().min(1),
  call_id: z.string().min(1),
  operation_family: z.enum(["database", "cache", "queue", "http", "filesystem", "secret", "payment", "email", "analytics", "unknown"]),
  operation_kind: z.enum(["read", "create", "update", "delete", "upsert", "execute", "publish", "send", "unknown"]),
  receiver_root: z.string().min(1),
  receiver_path: z.array(z.string().min(1)),
  store_name: z.string().min(1).optional(),
  tenant_sensitive: z.boolean(),
  mutation: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence_ref: z.string().min(1),
  parser_gap_ids: z.array(z.string().min(1))
});

export const FrameworkAdapterContractV2Schema = z.object({
  schema_version: z.literal("drift.framework_adapter.v2"),
  adapter_id: z.string().min(1),
  framework: z.enum(["next", "express", "nest", "fastify", "remix", "unknown"]),
  version_range: z.string().min(1).optional(),
  certification: z.enum(["certified_deterministic", "certified_heuristic", "experimental"]),
  route_patterns_supported: z.array(z.string().min(1)),
  unsupported_patterns: z.array(z.string().min(1)),
  emitted_entrypoint_kinds: z.array(z.string().min(1)),
  emitted_capabilities: z.array(z.string().min(1)),
  parser_gap_kinds: z.array(z.string().min(1)),
  fixture_suites: z.array(z.string().min(1)),
  can_block: z.boolean()
});

export const AgentPreflightSemanticEnvelopeSchema = z.object({
  schema_version: z.literal("drift.agent_preflight_semantic.v1"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1).nullable(),
  task: z.string().min(1),
  decision: z.enum(["safe_to_edit", "run_scan_first", "blocked_by_policy", "blocked_by_stale_graph", "context_truncated", "advisory_only", "refuse"]),
  semantic_coverage: SemanticCoverageContractSchema,
  parser_gaps: z.array(ParserGapV2Schema),
  affected_files: z.array(z.string().min(1)),
  affected_symbols: z.array(z.string().min(1)),
  affected_routes: z.array(z.string().min(1)),
  affected_data_operations: z.array(z.string().min(1)),
  required_checks: z.array(z.string().min(1)),
  safe_commands: z.array(z.string().min(1)),
  source_content_included: z.boolean(),
  graph_context_included: z.boolean()
});

export const SemanticCheckProofSchema = z.object({
  schema_version: z.literal("drift.semantic_check_proof.v1"),
  check_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  repo_contract_id: z.string().min(1),
  convention_id: z.string().min(1),
  convention_rule_id: z.string().min(1),
  semantic_coverage_id: z.string().min(1),
  architecture_contract_id: z.string().min(1),
  required_capabilities: z.array(z.string().min(1)),
  coverage_decision: z.literal("blocking_allowed"),
  parser_gap_ids: z.array(z.string().min(1)),
  graph_edge_ids: z.array(z.string().min(1)),
  graph_node_ids: z.array(z.string().min(1)),
  evidence_refs: z.array(z.string().min(1)),
  result: z.enum(["pass", "block"])
});

export const SemanticBetaProofSchema = z.object({
  schema_version: z.literal("drift.semantic_beta_proof.v1"),
  commit_sha: z.string().min(1),
  semantic_capability_contracts_verified: z.boolean(),
  architecture_contract_verified: z.boolean(),
  convention_election_contract_verified: z.boolean(),
  repo_contract_materialization_verified: z.boolean(),
  cli_mcp_semantic_parity_verified: z.boolean(),
  unsupported_pattern_visibility_verified: z.boolean(),
  blocking_safety_verified: z.boolean(),
  claim_gate_verified: z.boolean(),
  partial_beta_required_count: z.number().int().nonnegative(),
  unsupported_beta_required_count: z.number().int().nonnegative(),
  evidence: z.record(z.unknown())
});

export const MachineContractVersionsSchema = z.object({
  schema_version: z.literal("drift.machine_contract_versions.v1"),
  cli_version: z.string().min(1),
  core_version: z.string().min(1),
  storage_schema_version: z.number().int().positive(),
  contract_schema_version: z.number().int().positive(),
  engine_contract_versions: z.object({
    scan_request: z.literal("engine.scan.request.v1"),
    scan_result: z.literal("engine.scan.result.v1"),
    check_request: z.literal("engine.check.request.v1"),
    check_result: z.literal("engine.check.result.v1"),
    candidates_result: z.literal("engine.candidates.result.v1"),
    stream_event: z.literal("engine.stream.event.v1")
  }),
  factgraph_schema_version: z.enum(["factgraph.v1", "factgraph.v2"]),
  scanner_version: z.string().min(1),
  rule_engine_version: z.string().min(1),
  adapter_versions: z.record(z.string().min(1))
});

export const EntrypointKindSchema = z.enum([
  "api_route",
  "page_route",
  "server_action",
  "cli_command",
  "cron_job",
  "queue_consumer",
  "webhook_handler",
  "middleware",
  "test_entrypoint",
  "script",
  "migration",
  "lambda_handler",
  "worker"
]);

export const EntrypointFactSchema = z.object({
  schema_version: z.literal("drift.entrypoint_fact.v1"),
  entrypoint_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  kind: EntrypointKindSchema,
  file_path: z.string().min(1),
  symbol: z.string().min(1).optional(),
  route_pattern: z.string().min(1).optional(),
  method: z.string().min(1).optional(),
  adapter_id: z.string().min(1),
  confidence_label: ConfidenceLabelSchema,
  evidence_refs: z.array(z.string().min(1))
});

export const DataOperationFamilySchema = z.enum([
  "orm_operation",
  "raw_sql_operation",
  "http_api_call",
  "filesystem_write",
  "cache_operation",
  "queue_publish",
  "queue_consume",
  "env_secret_read",
  "external_service_call",
  "auth_session_read",
  "payment_operation",
  "email_send"
]);

export const DataOperationEffectSchema = z.enum([
  "read",
  "write",
  "delete",
  "mutation",
  "side_effect",
  "external_effect",
  "secret_access",
  "network_effect"
]);

export const DataOperationRiskSchema = z.object({
  schema_version: z.literal("drift.data_operation_risk.v1"),
  operation_family: DataOperationFamilySchema,
  effect: DataOperationEffectSchema,
  risk: z.enum(["read", "write", "destructive_write", "side_effect", "secret_access", "external_effect", "unknown"]),
  confidence_label: ConfidenceLabelSchema
});

const FileLineRangeSchema = z.object({
  file_path: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive()
});

export const SymbolIdentitySchema = z.object({
  schema_version: z.literal("drift.symbol_identity.v1"),
  symbol_id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  symbol_name: z.string().min(1),
  kind: z.enum(["function", "class", "const", "type", "unknown"]),
  declared_in: z.string().min(1),
  exported_from: z.array(z.string().min(1)),
  imported_as: z.array(z.object({
    file_path: z.string().min(1),
    local_name: z.string().min(1)
  })),
  re_export_chain: z.array(z.string().min(1)),
  canonical_definition: z.string().min(1),
  call_sites: z.array(FileLineRangeSchema),
  references: z.array(FileLineRangeSchema),
  visibility: z.enum(["private", "module", "exported", "public"])
});

export const ChangeImpactSchema = z.object({
  schema_version: z.literal("drift.change_impact.v1"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  changed_files: z.array(z.string().min(1)),
  changed_symbols: z.array(z.string().min(1)),
  changed_routes: z.array(z.string().min(1)),
  changed_tests: z.array(z.string().min(1)),
  changed_contract_surfaces: z.array(z.string().min(1)),
  affected_routes: z.array(z.string().min(1)),
  affected_services: z.array(z.string().min(1)),
  affected_data_ops: z.array(z.string().min(1)),
  affected_tests: z.array(z.string().min(1)),
  affected_callers: z.array(z.string().min(1)),
  affected_importers: z.array(z.string().min(1)),
  missing_test_candidates: z.array(z.string().min(1))
});

export const TestIntelligenceSchema = z.object({
  schema_version: z.literal("drift.test_intelligence.v1"),
  test_subject: z.string().min(1),
  test_type: z.enum(["unit", "integration", "e2e", "unknown"]),
  test_framework: z.enum(["vitest", "jest", "playwright", "unknown"]),
  test_file_for: z.array(z.string().min(1)),
  covered_symbols: z.array(z.string().min(1)),
  covered_routes: z.array(z.string().min(1)),
  mocked_dependencies: z.array(z.string().min(1)),
  fixture_usage: z.array(z.string().min(1)),
  snapshot_usage: z.boolean(),
  missing_test_candidate: z.boolean(),
  stale_test_candidate: z.boolean()
});

export const AgentTaskIntentSchema = z.enum([
  "bugfix",
  "feature",
  "refactor",
  "test_addition",
  "migration",
  "dependency_update",
  "config_change",
  "security_change",
  "performance_change",
  "unknown"
]);

export const AgentTaskSchema = z.object({
  schema_version: z.literal("drift.agent_task.v1"),
  task_id: z.string().min(1),
  task_text: z.string().min(1),
  task_intent: AgentTaskIntentSchema,
  target_area: z.string().min(1).nullable(),
  likely_files: z.array(z.string().min(1)),
  likely_entrypoint_kinds: z.array(EntrypointKindSchema),
  required_context: z.array(z.string().min(1)),
  risky_contracts: z.array(z.string().min(1)),
  required_checks: z.array(z.string().min(1)),
  forbidden_actions: z.array(z.string().min(1)),
  human_approval_needed: z.boolean()
});

export const GraphNodeRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["file", "module", "symbol", "import", "route", "role", "data_store", "data_operation", "endpoint", "re_export"]),
  label: z.string().min(1)
});

export const GraphEdgeRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "FILE_CONTAINS_SYMBOL",
    "MODULE_IMPORTS_MODULE",
    "FILE_HAS_ROLE",
    "ROUTE_DECLARED_IN_FILE",
    "ROUTE_HAS_ENDPOINT",
    "MODULE_REEXPORTS_MODULE",
    "REEXPORT_RESOLVES_TO_SYMBOL",
    "IMPORT_RESOLVES_TO_MODULE",
    "IMPORT_RESOLVES_TO_SYMBOL",
    "DATA_OPERATION_READS_DATA_STORE",
    "DATA_OPERATION_WRITES_DATA_STORE",
    "DATA_OPERATION_DELETES_DATA_STORE",
    "DATA_OPERATION_TOUCHES_DATA_STORE"
  ]),
  from: z.string().min(1),
  to: z.string().min(1)
});

export const FactGraphArtifactSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  schema_version: z.enum(["factgraph.v1", "factgraph.v2"]),
  graph_hash: z.string().regex(/^[a-f0-9]{64}$/),
  graph: z.record(z.unknown()),
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  created_at: z.string().datetime()
});

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  actor: z.string().min(1),
  action: z.enum([
    "repo_added",
    "scan_started",
    "scan_completed",
    "scan_failed",
    "scans_pruned",
    "election_accepted",
    "election_rejected",
    "election_edited",
    "enforcement_demoted",
    "finding_resolved",
    "finding_suppressed",
    "finding_flagged_for_review",
    "policy_changed",
    "agent_permission_changed",
    "backup_created",
    "restore_completed",
    "contract_exported",
    "contract_imported",
    "adapter_upgraded",
    "scan_invalidated",
    "baseline_created",
    "baseline_cleared",
    "required_check_executed"
  ]),
  target_type: z.string().min(1),
  target_id: z.string().min(1),
  metadata: z.record(z.unknown()),
  before_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  after_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  object_schema_version: z.string().min(1).nullable().optional(),
  created_at: z.string().datetime(),
  sequence: z.number().int().positive().optional(),
  previous_event_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  event_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()
});

export const ConventionStatusSchema = z.enum([
  "candidate",
  "accepted",
  "rejected",
  "archived",
  "expired"
]);

export const ConventionCandidateSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  kind: ConventionKindSchema,
  statement: z.string().min(1),
  rationale: z.string().optional(),
  scope: ConventionScopeSchema,
  matcher: ConventionMatcherSchema,
  requires: z.record(z.unknown()).optional(),
  suggested_severity: SeveritySchema,
  suggested_enforcement_mode: EnforcementModeSchema,
  enforcement_capability: EnforcementCapabilitySchema,
  confidence_label: z.enum(["low", "medium", "high"]),
  scoring: ConventionScoreSchema,
  evidence_refs: z.array(EvidenceRefSchema),
  counterexample_refs: z.array(EvidenceRefSchema),
  matcher_fingerprint: z.string().min(1).optional(),
  scope_fingerprint: z.string().min(1).optional(),
  graph_fingerprint: z.string().min(1).optional(),
  evidence_fingerprint: z.string().min(1).optional(),
  required_capabilities: z.array(z.string().min(1)).optional(),
  reason_not_blocking: z.enum([
    "candidate_not_accepted",
    "candidate_incomplete",
    "candidate_heuristic"
  ]).optional(),
  status: ConventionStatusSchema,
  created_at: z.string().datetime()
});

export const AcceptedConventionSchema = z.object({
  id: z.string().min(1),
  contract_id: z.string().min(1),
  kind: ConventionKindSchema,
  statement: z.string().min(1),
  rationale: z.string().optional(),
  scope: ConventionScopeSchema,
  matcher: ConventionMatcherSchema,
  requires: z.record(z.unknown()).optional(),
  severity: SeveritySchema,
  enforcement_mode: EnforcementModeSchema,
  enforcement_capability: EnforcementCapabilitySchema,
  exceptions: z.array(ConventionExceptionSchema),
  evidence_refs: z.array(EvidenceRefSchema),
  counterexample_refs: z.array(EvidenceRefSchema),
  accepted_by: z.string().min(1),
  accepted_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  expires_at: z.string().datetime().optional()
});

export const RejectedInferenceSchema = z.object({
  candidate_id: z.string().min(1),
  evidence_fingerprint: z.string().min(1).optional(),
  matcher_fingerprint: z.string().min(1).optional(),
  scope_fingerprint: z.string().min(1).optional(),
  reason: z.string().min(1),
  rejected_by: z.string().min(1),
  rejected_at: z.string().datetime()
});

export const BaselineViolationSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  convention_id: z.string().min(1),
  finding_fingerprint: z.string().min(1),
  file_path: z.string().min(1),
  first_seen_scan_id: z.string().min(1),
  first_seen_commit: z.string().min(1),
  status: z.enum(["active", "resolved"]),
  created_at: z.string().datetime()
});

export const FindingStatusSchema = z.enum([
  "new",
  "pre_existing",
  "needs_review",
  "fixed",
  "false_positive",
  "accepted_drift",
  "suppressed",
  "expired"
]);

export const FindingDiffStatusSchema = z.enum([
  "new_in_diff",
  "touched_existing",
  "outside_diff"
]);

// "refused" (E-1 / S1-02): the check made no enforcement claim - exit 3's truth in the
// payload. "blocked" is legacy (pre-E-1 fallback refusals); kept readable, never written.
export const CheckRunStatusSchema = z.enum(["pass", "fail", "refused", "blocked"]);

export const CheckRunSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  repo_contract_id: z.string().min(1),
  contract_fingerprint: z.string().min(1),
  scan_id: z.string().min(1),
  status: CheckRunStatusSchema,
  scope: z.enum(["changed-hunks", "changed-files", "full"]),
  engine_source: z.enum(["rust", "typescript"]),
  fallback_used: z.boolean(),
  stale_scan: z.boolean(),
  capability_complete: z.boolean(),
  findings_count: z.number().int().nonnegative(),
  blocking_count: z.number().int().nonnegative(),
  machine_contract_versions: MachineContractVersionsSchema.optional(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime()
});

export const FindingSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  convention_id: z.string().min(1),
  check_id: z.string().min(1).optional(),
  repo_contract_id: z.string().min(1).optional(),
  fingerprint: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  severity: SeveritySchema,
  enforcement_result: z.enum(["none", "warn", "block"]),
  status: FindingStatusSchema,
  diff_status: FindingDiffStatusSchema,
  evidence_refs: z.array(EvidenceRefSchema),
  expected_layer: z.string().min(1).optional(),
  actual_layer: z.string().min(1).optional(),
  graph_path: z.array(z.string().min(1)).optional(),
  suggested_fix: z.string().min(1).optional(),
  related_node_ids: z.array(z.string().min(1)).optional(),
  confidence_label: FindingConfidenceLabelSchema.optional(),
  drift_category: FindingDriftCategorySchema.optional(),
  introduced_by_diff: z.boolean().optional(),
  affected_contract: z.string().min(1).optional(),
  created_by_engine_version: z.string().min(1).optional(),
  created_by_rule_engine_version: z.string().min(1).optional(),
  contract_schema_version: z.number().int().positive().optional(),
  created_at: z.string().datetime()
});

export const AgentContractEnforcementSchema = z.enum(["blocking", "advisory"]);

const FileRoleDefinitionSchema = z.object({
  role: FileRoleSchema,
  path_globs: z.array(RepoRelativePatternSchema).min(1),
  required_exports: z.array(z.string().min(1)).optional(),
  forbidden_imports: z.array(z.string().min(1)).optional(),
  confidence: z.enum(["deterministic", "heuristic"])
});

export const FileRoleAgentContractSchema = z.object({
  kind: z.literal("file_role"),
  id: z.string().min(1),
  version: z.literal(1),
  roles: z.array(FileRoleDefinitionSchema).min(1)
});

export const ModulePlacementAgentContractSchema = z.object({
  kind: z.literal("module_placement"),
  id: z.string().min(1),
  version: z.literal(1),
  statement: z.string().min(1),
  target_role: FileRoleSchema,
  allowed_paths: z.array(RepoRelativePatternSchema).min(1),
  forbidden_paths: z.array(RepoRelativePatternSchema).optional(),
  required_parent_roles: z.array(FileRoleSchema).optional(),
  forbidden_contained_roles: z.array(FileRoleSchema).optional(),
  examples: z.object({
    good: z.array(RepoRelativePatternSchema),
    bad: z.array(RepoRelativePatternSchema)
  }).optional(),
  enforcement: AgentContractEnforcementSchema
});

export const ImportBoundaryAgentContractSchema = z.object({
  kind: z.literal("import_boundary"),
  id: z.string().min(1),
  version: z.literal(1),
  source_roles: z.array(FileRoleSchema).min(1),
  forbidden_imports: z.array(z.string().min(1)).optional(),
  forbidden_target_roles: z.array(FileRoleSchema).optional(),
  allowed_imports: z.array(z.string().min(1)).optional(),
  allowed_delegate_imports: z.array(z.string().min(1)).optional(),
  enforcement: AgentContractEnforcementSchema
}).superRefine((value, ctx) => {
  if (!value.forbidden_imports?.length && !value.forbidden_target_roles?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "import boundary requires forbidden imports or forbidden target roles"
    });
  }
});

export const EntrypointFlowRequiredStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("auth_helper"),
    imports: z.array(z.string().min(1)).optional(),
    calls: z.array(z.string().min(1)).optional()
  }),
  z.object({
    kind: z.literal("validation_helper"),
    imports: z.array(z.string().min(1)).optional(),
    calls: z.array(z.string().min(1)).optional()
  }),
  z.object({
    kind: z.literal("service_delegation"),
    target_roles: z.array(FileRoleSchema).optional(),
    imports: z.array(z.string().min(1)).optional()
  }),
  z.object({
    kind: z.literal("response_boundary"),
    calls: z.array(z.string().min(1)).optional()
  })
]);

export const EntrypointFlowForbiddenStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct_data_access") }),
  z.object({ kind: z.literal("inline_business_logic") })
]);

export const EntrypointFlowAgentContractSchema = z.object({
  kind: z.literal("entrypoint_flow"),
  id: z.string().min(1),
  version: z.literal(1),
  entry_roles: z.array(FileRoleSchema).min(1),
  required_steps: z.array(EntrypointFlowRequiredStepSchema).min(1),
  forbidden_steps: z.array(EntrypointFlowForbiddenStepSchema).optional(),
  enforcement: AgentContractEnforcementSchema
});

const CanonicalHelperSchema = z.object({
  helper_id: z.string().min(1),
  symbol: z.string().min(1),
  module: z.string().min(1),
  roles: z.array(FileRoleSchema).optional(),
  applies_to_roles: z.array(FileRoleSchema).optional(),
  purpose_tags: z.array(z.string().min(1)).min(1),
  avoid_new_symbols_matching: z.array(z.string().min(1)).optional(),
  avoid_new_files_matching: z.array(RepoRelativePatternSchema).optional(),
  suggested_import: z.string().min(1)
});

export const CanonicalHelperReuseAgentContractSchema = z.object({
  kind: z.literal("canonical_helper_reuse"),
  id: z.string().min(1),
  version: z.literal(1),
  canonical_helpers: z.array(CanonicalHelperSchema).min(1),
  enforcement: AgentContractEnforcementSchema
});

const RequiredChangeCheckAppliesToSchema = z.object({
  path_globs: z.array(RepoRelativePatternSchema).optional(),
  file_roles: z.array(FileRoleSchema).optional(),
  convention_kinds: z.array(ConventionKindSchema).optional()
}).superRefine((value, ctx) => {
  if (!value.path_globs?.length && !value.file_roles?.length && !value.convention_kinds?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "required change check requires at least one applies_to selector"
    });
  }
});

export const RequiredChangeChecksAgentContractSchema = z.object({
  kind: z.literal("required_change_checks"),
  id: z.string().min(1),
  version: z.literal(1),
  rules: z.array(z.object({
    applies_to: RequiredChangeCheckAppliesToSchema,
    required_checks: z.array(z.object({
      command: z.string().min(1),
      reason: z.string().min(1),
      required_for_release: z.boolean().optional()
    })).min(1)
  })).min(1)
});

export const AgentContractSchema = z.union([
  FileRoleAgentContractSchema,
  ModulePlacementAgentContractSchema,
  ImportBoundaryAgentContractSchema,
  EntrypointFlowAgentContractSchema,
  CanonicalHelperReuseAgentContractSchema,
  RequiredChangeChecksAgentContractSchema
]);

export const AgentContractSelectionSchema = z.object({
  schema_version: z.literal("drift.agent.contract_selection.v1"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  selected_contract_ids: z.array(z.string().min(1)),
  selected_convention_ids: z.array(z.string().min(1)),
  selected_helper_ids: z.array(z.string().min(1)),
  selected_required_checks: z.array(z.string().min(1)),
  selection_inputs: z.object({
    task_text: z.string().min(1).optional(),
    explicit_paths: z.array(RepoRelativePatternSchema),
    changed_paths: z.array(RepoRelativePatternSchema),
    file_roles: z.array(FileRoleSchema),
    graph_node_ids: z.array(z.string().min(1))
  }),
  reasons: z.array(z.object({
    target_id: z.string().min(1),
    reason: z.enum([
      "path_match",
      "role_match",
      "task_text_match",
      "graph_reachable",
      "contract_dependency",
      "active_waiver"
    ]),
    evidence_refs: z.array(z.string().min(1))
  }))
});

export const AgentPreflightPacketSchema = z.object({
  schema_version: z.literal("drift.agent.preflight.v3"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1).nullable(),
  stale: z.boolean(),
  task: z.string().min(1),
  selected_contracts: z.array(z.unknown()),
  selected_conventions: z.array(z.unknown()),
  selected_helpers: z.array(z.object({
    symbol: z.string().min(1),
    module: z.string().min(1),
    suggested_import: z.string().min(1),
    purpose_tags: z.array(z.string().min(1)).min(1)
  })),
  placement_guidance: z.array(z.object({
    role: FileRoleSchema,
    allowed_paths: z.array(RepoRelativePatternSchema),
    forbidden_paths: z.array(RepoRelativePatternSchema)
  })),
  import_boundaries: z.array(z.unknown()),
  required_flows: z.array(z.unknown()),
  required_checks: z.array(z.object({
    command: z.string().min(1),
    reason: z.string().min(1)
  })),
  active_exceptions: z.array(z.unknown()),
  active_waivers: z.array(z.unknown()),
  agent_instructions: z.array(z.string().min(1)),
  diagnostics: z.array(z.string().min(1))
});

export const ContextPolicyMatrixSchema = z.object({
  schema_version: z.literal("drift.context_policy.v1"),
  can_read_repo_map: z.boolean(),
  can_read_source_snippets: z.boolean(),
  can_read_contract: z.boolean(),
  can_read_findings: z.boolean(),
  can_execute_commands: z.boolean(),
  can_modify_contract: z.boolean(),
  can_create_waiver: z.boolean(),
  can_request_human_approval: z.boolean(),
  can_access_secret_like_files: z.boolean(),
  can_emit_patch: z.boolean(),
  egress_level: z.enum(["no_source", "symbol_only", "snippet_allowed", "full_file_allowed"])
});

export const AgentPreflightPacketV2Schema = z.object({
  schema_version: z.literal("drift.agent_preflight.v2"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  task_model: AgentTaskSchema,
  repo_map_summary: z.object({
    relevant_file_count: z.number().int().nonnegative(),
    route_flow_count: z.number().int().nonnegative(),
    parser_gap_count: z.number().int().nonnegative()
  }),
  accepted_conventions: z.array(z.unknown()),
  relevant_files: z.array(z.unknown()),
  role_layer_proof: z.array(z.unknown()),
  change_impact: ChangeImpactSchema,
  test_intelligence: z.array(TestIntelligenceSchema),
  parser_gaps: z.array(ParserGapSchema),
  required_checks: z.array(z.unknown()),
  forbidden_actions: z.array(z.string().min(1)),
  context_policy: ContextPolicyMatrixSchema,
  confidence: z.object({
    graph_confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().min(1))
  }),
  // T48: no longer emitted. It was byte-identical to the sibling top-level agent_contract_packet
  // - 3,012 bytes of pure duplication in a packet agents pay tokens to read. Kept optional so a
  // consumer that still reads it parses rather than throws.
  legacy_packet: AgentPreflightPacketSchema.optional()
});

export const ContractFindingV2Schema = z.object({
  schema_version: z.literal("drift.finding.v2"),
  finding_id: z.string().min(1),
  contract_id: z.string().min(1),
  convention_id: z.string().min(1).optional(),
  kind: ConventionKindSchema,
  severity: SeveritySchema,
  status: z.enum(["blocking", "advisory", "waived", "blocked_by_missing_evidence"]),
  file_path: RepoRelativePatternSchema,
  range: z.object({
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive()
  }).optional(),
  expected: z.string().min(1),
  actual: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)),
  graph_path: z.array(z.string().min(1)).optional(),
  suggested_fix: z.string().min(1),
  diagnostics: z.array(z.string().min(1))
}).superRefine((value, ctx) => {
  if (value.range && value.range.end_line < value.range.start_line) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["range", "end_line"],
      message: "end_line must be greater than or equal to start_line"
    });
  }
  if (value.status !== "blocked_by_missing_evidence" && value.evidence_refs.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidence_refs"],
      message: "non-blocked findings require evidence references"
    });
  }
});

export const HelperSimilarityFeatureSchema = z.enum([
  "name_tokens",
  "purpose_tags",
  "parameter_shape",
  "return_shape",
  "call_dependencies",
  "import_dependencies",
  "body_operation_kinds"
]);

export const HelperSimilarityEvidenceSchema = z.object({
  schema_version: z.literal("drift.helper_similarity.v1"),
  candidate_symbol: z.string().min(1),
  candidate_file_path: RepoRelativePatternSchema,
  canonical_symbol: z.string().min(1),
  canonical_module: z.string().min(1),
  score: z.number().min(0).max(1),
  score_band: z.enum(["low", "medium", "high", "deterministic"]),
  matched_features: z.array(HelperSimilarityFeatureSchema),
  missing_features: z.array(z.string().min(1)),
  evidence_refs: z.array(z.string().min(1)),
  blocking_allowed: z.boolean()
});

export const EntrypointFlowProofStepSchema = z.object({
  step_kind: z.enum(["auth_helper", "validation_helper", "service_delegation", "response_boundary"]),
  satisfied: z.boolean(),
  evidence_refs: z.array(z.string().min(1)),
  graph_path: z.array(z.string().min(1))
});

export const EntrypointFlowForbiddenProofStepSchema = z.object({
  step_kind: z.enum(["direct_data_access", "inline_business_logic"]),
  present: z.boolean(),
  evidence_refs: z.array(z.string().min(1)),
  graph_path: z.array(z.string().min(1))
});

export const EntrypointFlowProofSchema = z.object({
  schema_version: z.literal("drift.entrypoint_flow_proof.v1"),
  entry_file_path: RepoRelativePatternSchema,
  contract_id: z.string().min(1),
  required_steps: z.array(EntrypointFlowProofStepSchema),
  forbidden_steps: z.array(EntrypointFlowForbiddenProofStepSchema),
  missing_evidence: z.array(z.string().min(1))
});

export const RequiredCheckExecutionSchema = z.object({
  schema_version: z.literal("drift.required_check_execution.v1"),
  execution_id: z.string().min(1),
  repo_id: z.string().min(1),
  repo_root: z.string().min(1),
  repo_commit: z.string().min(1),
  git_branch: z.string().min(1),
  git_commit_sha: z.string().min(1),
  worktree_dirty: z.boolean(),
  untracked_files_present: z.boolean(),
  scan_id: z.string().min(1).nullable(),
  repo_contract_id: z.string().min(1),
  agent_contract_id: z.string().min(1),
  contract_fingerprint: z.string().min(1),
  repo_contract_version: z.number().int().positive(),
  command: z.string().min(1),
  argv: z.array(z.string().min(1)).min(1),
  command_hash: z.string().min(1),
  diff_hash: z.string().min(1),
  lockfile_hash: z.string().min(1).nullable(),
  package_manager: z.string().min(1).nullable(),
  cwd: z.string().min(1),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  timeout_ms: z.number().int().positive(),
  exit_code: z.number().int().nullable(),
  status: z.enum(["passed", "failed", "timed_out", "blocked"]),
  stdout_hash: z.string().min(1),
  stderr_hash: z.string().min(1),
  stdout_preview: z.string(),
  stderr_preview: z.string(),
  audit_event_id: z.string().min(1)
}).superRefine((value, ctx) => {
  if (value.completed_at < value.started_at) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completed_at"],
      message: "completed_at must be greater than or equal to started_at"
    });
  }
  if (value.status === "passed" && value.exit_code !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exit_code"],
      message: "passed required checks must have exit_code 0"
    });
  }
});

export const RiskAreaSchema = z.object({
  id: z.string().min(1),
  path_globs: z.array(RepoRelativePatternSchema),
  risk_kind: z.enum([
    "auth",
    "billing",
    "data_access",
    "migration",
    "secrets",
    "external_api",
    "generated_code"
  ]),
  reason: z.string().min(1)
});

export const RepoTopologyAreaSchema = z.object({
  name: z.string().min(1),
  entrypoints: z.array(z.string().min(1)),
  modules: z.array(z.string().min(1)),
  services: z.array(z.string().min(1)),
  data_access: z.array(z.string().min(1)),
  tests: z.array(z.string().min(1)),
  external_systems: z.array(z.string().min(1)),
  risky_zones: z.array(z.string().min(1))
});

export const RepoTopologySchema = z.object({
  schema_version: z.literal("drift.repo_topology.v1"),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1).nullable(),
  areas: z.array(RepoTopologyAreaSchema),
  entrypoints: z.array(z.string().min(1)),
  modules: z.array(z.string().min(1)),
  layers: z.array(z.string().min(1)),
  flows: z.array(z.string().min(1)),
  tests: z.array(z.string().min(1)),
  configs: z.array(z.string().min(1)),
  external_systems: z.array(z.string().min(1)),
  risky_zones: z.array(z.string().min(1)),
  generated_zones: z.array(z.string().min(1)),
  unknown_zones: z.array(z.string().min(1))
});

export const SafeCommandSchema = z.object({
  command: z.string().min(1),
  reason: z.string().min(1),
  requires_explicit_run: z.literal(true)
});

export const RequiredCheckSchema = z.object({
  command: z.string().min(1),
  applies_to: ConventionScopeSchema,
  reason: z.string().min(1),
  source: z.enum(["contract", "graph_risk"]).optional(),
  evidence_node_ids: z.array(z.string().min(1)).optional(),
  risk_kinds: z.array(z.string().min(1)).optional()
});

export const ContextEgressPolicySchema = z.object({
  default_mode: z.enum(["local_only", "redacted", "approval_required"]),
  denied_globs: z.array(RepoRelativePatternSchema),
  max_snippet_chars: z.number().int().positive(),
  allow_full_file_content: z.boolean()
});

export const AgentPermissionSchema = z.object({
  agent: z.string().min(1),
  permissions: z.array(z.enum([
    "read_context",
    "request_preflight",
    "propose_resolution"
  ]))
});

const LayerEdgeSchema = z.object({
  from_layer: z.string().min(1),
  to_layer: z.string().min(1),
  edge_kind: z.string().min(1).optional()
});

export const LayerArchitectureContractSchema = z.object({
  schema_version: z.literal("drift.layer_architecture.v1"),
  architecture_id: z.string().min(1),
  repo_id: z.string().min(1),
  version: z.number().int().positive(),
  layers: z.array(z.object({
    id: z.string().min(1),
    role: CanonicalRoleSchema,
    position: z.enum(["entrypoint", "middle", "terminal", "support"])
  })).min(1),
  allowed_edges: z.array(LayerEdgeSchema),
  forbidden_edges: z.array(LayerEdgeSchema),
  soft_edges: z.array(LayerEdgeSchema.extend({
    reason: z.string().min(1)
  }))
});

export const RepoContractSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  contract_schema_version: z.number().int().positive(),
  repo_fingerprint: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  conventions: z.array(AcceptedConventionSchema),
  rejected_inferences: z.array(RejectedInferenceSchema),
  waivers: z.array(ConventionExceptionSchema),
  risky_areas: z.array(RiskAreaSchema),
  agent_contracts: z.array(AgentContractSchema).optional(),
  layer_architecture: LayerArchitectureContractSchema.optional(),
  safe_commands: z.array(SafeCommandSchema),
  required_checks: z.array(RequiredCheckSchema),
  context_egress: ContextEgressPolicySchema,
  agent_permissions: z.array(AgentPermissionSchema),
  semantic_capability_contract_version: z.literal("drift.semantic_capability.v1").optional(),
  architecture_contract_id: z.string().min(1).optional(),
  architecture_contract_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  active_convention_rule_ids: z.array(z.string().min(1)).optional(),
  active_semantic_capability_ids: z.array(z.string().min(1)).optional(),
  beta_claim_profile: z.enum(["narrow_route_layering", "security_boundary", "custom_internal"]).optional(),
  enforcement_policy: z.object({
    block_on_parser_gaps: z.literal(false),
    refuse_on_required_capability_missing: z.literal(true),
    advisory_on_heuristic_capability: z.literal(true)
  }).optional()
});

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  surface: z.enum(["cli-preflight", "cli-check", "mcp", "contract-export", "artifact", "log", "ui"]),
  mode: z.enum(["local_only", "redacted", "approval_required", "denied"]),
  reason: z.string().min(1),
  max_snippet_chars: z.number().int().nonnegative(),
  approved_snippet_chars: z.number().int().nonnegative()
});
