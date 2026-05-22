import { z } from "zod";

const RepoRelativePatternSchema = z.string().min(1).refine(
  (value) => !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes(".."),
  "pattern must be repo-relative"
);

export const ConventionKindSchema = z.enum([
  "api_route_no_direct_data_access",
  "api_route_requires_service_delegation",
  "api_route_requires_auth_helper",
  "test_expected_for_changed_module",
  "custom_briefing"
]);

export const FileRoleSchema = z.enum([
  "api_route",
  "server_module",
  "service_module",
  "data_access_module",
  "component",
  "test",
  "config",
  "cli_command_module",
  "storage_module",
  "engine_bridge_module",
  "mcp_module",
  "docs",
  "package_manifest"
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
  required_calls: z.array(z.string().min(1)).optional(),
  allowed_delegate_imports: z.array(z.string().min(1)).optional(),
  applies_to_file_roles: z.array(FileRoleSchema).optional()
});

export const EnforcementCapabilitySchema = z.enum([
  "briefing_only",
  "heuristic_check",
  "deterministic_check"
]);

export const SeveritySchema = z.enum(["info", "warning", "error"]);

export const EnforcementModeSchema = z.enum(["off", "brief", "warn", "block"]);

export const ConventionScoreSchema = z.object({
  supporting_examples_count: z.number().int().nonnegative(),
  counterexamples_count: z.number().int().nonnegative(),
  scope_files_count: z.number().int().nonnegative(),
  coverage_ratio: z.number().min(0).max(1),
  heuristic_id: z.string().min(1)
});

export const ConventionExceptionSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  path_globs: z.array(RepoRelativePatternSchema).optional(),
  symbols: z.array(z.string().min(1)).optional(),
  imports: z.array(z.string().min(1)).optional(),
  expires_at: z.string().datetime().optional(),
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
  "test_declared"
]);

export const FactRecordSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  kind: FactKindSchema,
  file_path: z.string().min(1),
  name: z.string().min(1),
  value: z.string().optional(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive()
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
    "election_accepted",
    "election_rejected",
    "election_edited",
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
    "baseline_cleared"
  ]),
  target_type: z.string().min(1),
  target_id: z.string().min(1),
  metadata: z.record(z.unknown()),
  created_at: z.string().datetime(),
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
  suggested_severity: SeveritySchema,
  suggested_enforcement_mode: EnforcementModeSchema,
  enforcement_capability: EnforcementCapabilitySchema,
  confidence_label: z.enum(["low", "medium", "high"]),
  scoring: ConventionScoreSchema,
  evidence_refs: z.array(EvidenceRefSchema),
  counterexample_refs: z.array(EvidenceRefSchema),
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

export const FindingSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  convention_id: z.string().min(1),
  fingerprint: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  severity: SeveritySchema,
  enforcement_result: z.enum(["none", "warn", "block"]),
  status: FindingStatusSchema,
  diff_status: FindingDiffStatusSchema,
  evidence_refs: z.array(EvidenceRefSchema),
  created_at: z.string().datetime()
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

export const SafeCommandSchema = z.object({
  command: z.string().min(1),
  reason: z.string().min(1),
  requires_explicit_run: z.literal(true)
});

export const RequiredCheckSchema = z.object({
  command: z.string().min(1),
  applies_to: ConventionScopeSchema,
  reason: z.string().min(1)
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
  safe_commands: z.array(SafeCommandSchema),
  required_checks: z.array(RequiredCheckSchema),
  context_egress: ContextEgressPolicySchema,
  agent_permissions: z.array(AgentPermissionSchema)
});

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  surface: z.enum(["cli-preflight", "cli-check", "mcp", "contract-export", "artifact", "log", "ui"]),
  mode: z.enum(["local_only", "redacted", "approval_required", "denied"]),
  reason: z.string().min(1),
  max_snippet_chars: z.number().int().nonnegative(),
  approved_snippet_chars: z.number().int().nonnegative()
});
