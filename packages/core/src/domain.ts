export type ConventionKind =
  | "api_route_no_direct_data_access"
  | "api_route_requires_service_delegation"
  | "api_route_requires_auth_helper"
  | "test_expected_for_changed_module"
  | "custom_briefing";

export type FileRole =
  | "api_route"
  | "server_module"
  | "service_module"
  | "data_access_module"
  | "component"
  | "test"
  | "config"
  | "cli_command_module"
  | "storage_module"
  | "engine_bridge_module"
  | "mcp_module"
  | "docs"
  | "package_manifest";

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
  required_calls?: string[];
  allowed_delegate_imports?: string[];
  applies_to_file_roles?: FileRole[];
}

export type EnforcementCapability =
  | "briefing_only"
  | "heuristic_check"
  | "deterministic_check";

export type Severity = "info" | "warning" | "error";

export type EnforcementMode = "off" | "brief" | "warn" | "block";

export interface ConventionScore {
  supporting_examples_count: number;
  counterexamples_count: number;
  scope_files_count: number;
  coverage_ratio: number;
  heuristic_id: string;
}

export interface ConventionException {
  id: string;
  reason: string;
  path_globs?: string[];
  symbols?: string[];
  imports?: string[];
  expires_at?: string;
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
  | "test_declared";

export interface FactRecord {
  id: string;
  repo_id: string;
  scan_id: string;
  kind: FactKind;
  file_path: string;
  name: string;
  value?: string;
  start_line: number;
  end_line: number;
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
    | "election_accepted"
    | "election_rejected"
    | "election_edited"
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
    | "baseline_cleared";
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
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
  suggested_severity: Severity;
  suggested_enforcement_mode: EnforcementMode;
  enforcement_capability: EnforcementCapability;
  confidence_label: "low" | "medium" | "high";
  scoring: ConventionScore;
  evidence_refs: EvidenceRef[];
  counterexample_refs: EvidenceRef[];
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

export interface Finding {
  id: string;
  repo_id: string;
  convention_id: string;
  fingerprint: string;
  title: string;
  message: string;
  severity: Severity;
  enforcement_result: "none" | "warn" | "block";
  status: FindingStatus;
  diff_status: FindingDiffStatus;
  evidence_refs: EvidenceRef[];
  created_at: string;
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

export interface SafeCommand {
  command: string;
  reason: string;
  requires_explicit_run: true;
}

export interface RequiredCheck {
  command: string;
  applies_to: ConventionScope;
  reason: string;
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
  safe_commands: SafeCommand[];
  required_checks: RequiredCheck[];
  context_egress: ContextEgressPolicy;
  agent_permissions: AgentPermission[];
}

export interface PolicyDecision {
  allowed: boolean;
  surface: "cli-preflight" | "cli-check" | "mcp" | "contract-export" | "artifact" | "log" | "ui";
  mode: "local_only" | "redacted" | "approval_required" | "denied";
  reason: string;
  max_snippet_chars: number;
  approved_snippet_chars: number;
}
