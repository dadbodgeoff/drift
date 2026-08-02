use std::{collections::BTreeMap, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const ENGINE_SCAN_RESULT_SCHEMA_VERSION: &str = "engine.scan.result.v1";
pub const ENGINE_STREAM_EVENT_SCHEMA_VERSION: &str = "engine.stream.event.v1";
pub const ENGINE_CHECK_RESULT_SCHEMA_VERSION: &str = "engine.check.result.v1";
pub const ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION: &str = "engine.candidates.result.v1";

pub const MAX_FILE_BYTES: u64 = 2_000_000;

#[derive(Debug)]
pub struct ScanRepoArgs {
    pub repo_root: PathBuf,
    pub format: OutputFormat,
    pub repo_id: String,
    pub scan_id: String,
    pub reuse_manifest: Option<PathBuf>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum OutputFormat {
    Json,
    Jsonl,
}

#[derive(Debug, Serialize)]
pub struct ScanRepoOutput {
    pub schema_version: &'static str,
    pub repo_id: String,
    pub scan_id: String,
    pub engine_version: String,
    pub adapter_versions: BTreeMap<String, String>,
    pub file_snapshots: Vec<ScannedFile>,
    pub facts: Vec<EngineFact>,
    pub framework_adapters: Vec<EngineFrameworkAdapter>,
    pub normalized_entrypoints: Vec<EngineNormalizedEntrypoint>,
    pub framework_parser_gaps: Vec<EngineFrameworkParserGap>,
    pub framework_capabilities: Vec<EngineFrameworkCapability>,
    pub diagnostics: Vec<EngineDiagnostic>,
    pub stats: EngineStats,
    pub completeness: Vec<EngineCompleteness>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ScannedFile {
    pub file_path: String,
    pub content_hash: String,
    pub byte_size: u64,
    pub indexed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EngineFact {
    pub kind: String,
    pub file_path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_name: Option<String>,
    /// S1-05: runtime-use proof carried forward from fact extraction (see facts.rs).
    /// `default` on deserialize so facts recorded before this field existed stay
    /// conservative (`None`) rather than failing to load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_use: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EngineDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineFrameworkAdapter {
    pub schema_version: &'static str,
    pub adapter_id: String,
    pub framework: String,
    pub adapter_version: String,
    pub package_names: Vec<String>,
    pub entrypoint_kinds: Vec<String>,
    pub supported_patterns: Vec<String>,
    pub unsupported_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineNormalizedEntrypoint {
    pub schema_version: &'static str,
    pub entrypoint_id: String,
    pub repo_id: String,
    pub scan_id: String,
    pub adapter_id: String,
    pub framework: String,
    pub kind: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handler_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subdirectory_role: Option<String>,
    pub middleware_refs: Vec<String>,
    pub request_source_refs: Vec<String>,
    pub response_sink_refs: Vec<String>,
    pub data_operation_refs: Vec<String>,
    pub confidence_label: String,
    pub evidence_refs: Vec<String>,
    pub parser_gap_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineFrameworkParserGap {
    pub schema_version: &'static str,
    pub parser_gap_id: String,
    pub repo_id: String,
    pub scan_id: String,
    pub adapter_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framework: Option<String>,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    pub code: String,
    pub reason: String,
    pub affected_entrypoint_ids: Vec<String>,
    pub affected_contract_kinds: Vec<String>,
    pub blocks_enforcement: bool,
    pub suggested_next_step: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineFrameworkCapability {
    pub schema_version: &'static str,
    pub adapter_id: String,
    pub framework: String,
    pub capability: String,
    pub status: String,
    pub can_block: bool,
    pub block_requires_accepted_convention: bool,
    pub parser_gap_ids: Vec<String>,
    pub missing_proof_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineStats {
    pub files_seen: usize,
    pub files_skipped: usize,
    pub files_parsed: usize,
    pub files_reused: usize,
    pub reuse_applied: bool,
    pub reuse_blocked_reasons: Vec<String>,
    pub facts_emitted: usize,
    pub graph_nodes: usize,
    pub graph_edges: usize,
    pub diagnostics_emitted: usize,
    pub duration_ms: u128,
    pub truncated: bool,
    pub capabilities: EngineCapabilityStats,
}

#[derive(Debug, Deserialize)]
pub struct ScanReuseManifest {
    pub schema_version: String,
    pub previous_scan_id: String,
    /// Engine version that produced these facts.
    ///
    /// Reuse is otherwise keyed only on file content, which assumes a given file always
    /// yields the same facts. That assumption breaks on every engine change that alters
    /// extraction - T12 stopped emitting type-only imports and T13 narrowed data-layer
    /// matching, so an unchanged file legitimately produces different facts than it did
    /// before. Without this, upgrading Drift and rescanning would silently keep the old
    /// facts for every unchanged file, which is exactly the stale-analysis failure this
    /// project exists to prevent.
    ///
    /// Optional so manifests written by older engines still parse; absent means unknown,
    /// which is treated as not reusable.
    #[serde(default)]
    pub engine_version: Option<String>,
    pub file_snapshots: Vec<ScannedFile>,
    pub facts: Vec<EngineFact>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineCapabilityStats {
    pub certified: Vec<String>,
    pub required: Vec<String>,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineCompleteness {
    pub scope: String,
    pub complete: bool,
    pub required_capabilities: Vec<String>,
    pub missing_capabilities: Vec<String>,
    pub truncated: bool,
    pub can_block: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub stable: bool,
    pub evidence_ids: Vec<String>,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GraphEdge {
    pub id: String,
    pub kind: String,
    pub from: String,
    pub to: String,
    pub evidence_ids: Vec<String>,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GraphEvidence {
    pub id: String,
    pub repo_id: String,
    pub scan_id: String,
    pub artifact_id: String,
    pub file_path: String,
    pub file_hash: String,
    pub start_line: usize,
    pub end_line: usize,
    pub adapter_id: String,
    pub adapter_version: String,
    pub fact_ids: Vec<String>,
    #[serde(default = "default_evidence_confidence_kind")]
    pub confidence_kind: String,
    #[serde(default = "default_evidence_extractor")]
    pub extractor: String,
    #[serde(default)]
    pub snippet_hash: String,
    pub redaction_state: String,
}

fn default_evidence_confidence_kind() -> String {
    "deterministic".to_string()
}

fn default_evidence_extractor() -> String {
    "unknown".to_string()
}

#[derive(Debug, Deserialize)]
pub struct CheckRequest {
    pub repo: CheckRepoContext,
    #[serde(default)]
    pub graph: CheckGraphData,
    pub scan: CheckScanData,
    pub contract: CheckContract,
    pub baseline: Vec<CheckBaselineViolation>,
    pub diff: CheckDiff,
    #[serde(default)]
    pub limits: CheckLimits,
}

#[derive(Debug, Deserialize)]
pub struct CheckLimits {
    pub max_files_seen: usize,
    pub max_files_parsed: usize,
    pub max_file_bytes: u64,
    pub max_facts: usize,
    pub max_graph_nodes: usize,
    pub max_graph_edges: usize,
    pub max_diagnostics: usize,
    pub follow_symlinks: bool,
}

impl Default for CheckLimits {
    fn default() -> Self {
        Self {
            max_files_seen: usize::MAX,
            max_files_parsed: usize::MAX,
            max_file_bytes: MAX_FILE_BYTES,
            max_facts: usize::MAX,
            max_graph_nodes: usize::MAX,
            max_graph_edges: usize::MAX,
            max_diagnostics: usize::MAX,
            follow_symlinks: false,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct CheckGraphData {
    #[serde(default)]
    pub graph_nodes: Vec<GraphNode>,
    #[serde(default)]
    pub graph_edges: Vec<GraphEdge>,
    #[serde(default)]
    pub graph_evidence: Vec<GraphEvidence>,
    #[serde(default)]
    pub graph_diagnostics: Vec<EngineDiagnostic>,
}

#[derive(Debug, Deserialize)]
pub struct CheckRepoContext {
    pub repo_id: String,
    #[serde(default)]
    pub repo_root: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CheckScanData {
    pub scan_id: String,
    #[serde(default)]
    pub file_snapshots: Vec<ScannedFile>,
    pub facts: Vec<CheckFact>,
}

#[derive(Debug, Deserialize)]
pub struct CheckFact {
    pub kind: String,
    pub file_path: String,
    pub name: String,
    pub value: Option<String>,
    #[serde(default)]
    pub imported_name: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Deserialize)]
pub struct CandidateRequest {
    pub repo: CheckRepoContext,
    #[serde(default)]
    pub graph: CheckGraphData,
    pub scan: CheckScanData,
    /// E-6 (decision D-2): repo-relative paths of files changed in the working tree
    /// relative to the git baseline (HEAD) - staged, unstaged, and untracked. Coverage
    /// direction is computed from the baseline only, so newly-detected violations in an
    /// analyzed diff can never argue a convention down from block to warn (the T100
    /// pathology). Absent or empty means "everything is baseline", which preserves the
    /// old behaviour for non-git callers.
    #[serde(default)]
    pub diff_changed_files: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CandidateResult {
    pub schema_version: &'static str,
    pub repo_id: String,
    pub scan_id: String,
    pub graph_id: String,
    pub engine_version: String,
    pub rule_engine_version: String,
    pub adapter_versions: BTreeMap<String, String>,
    pub candidates: Vec<EngineCandidate>,
    pub diagnostics: Vec<EngineDiagnostic>,
    pub stats: EngineStats,
    pub completeness: Vec<EngineCompleteness>,
}

#[derive(Debug, Serialize)]
pub struct EngineCandidate {
    pub candidate_id: String,
    pub candidate_version: usize,
    pub kind: String,
    pub rule_id: String,
    pub rule_version: String,
    pub matcher_schema_version: String,
    pub matcher_fingerprint: String,
    pub scope_fingerprint: String,
    pub graph_fingerprint: String,
    pub statement: String,
    pub rationale: String,
    pub scope: Value,
    pub matcher: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires: Option<Value>,
    pub suggested_severity: String,
    pub suggested_enforcement_mode: String,
    pub enforcement_capability: String,
    pub confidence_label: String,
    pub scoring: Value,
    pub required_capabilities: Vec<String>,
    pub evidence_refs: Vec<EngineCandidateEvidenceRef>,
    pub counterexample_refs: Vec<EngineCandidateEvidenceRef>,
    pub reason_not_blocking: String,
    pub evidence_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineCandidateEvidenceRef {
    pub id: String,
    pub kind: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_source: Option<String>,
    pub fact_ids: Vec<String>,
    pub scan_id: String,
    pub file_hash: String,
    pub redaction_state: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckContract {
    #[serde(default)]
    pub contract_id: Option<String>,
    #[serde(default)]
    pub contract_schema_version: Option<usize>,
    pub conventions: Vec<CheckConvention>,
    #[serde(default)]
    pub waivers: Vec<Value>,
    #[serde(default)]
    pub exceptions: Vec<Value>,
}

#[derive(Debug, Deserialize)]
pub struct CheckConvention {
    pub id: String,
    pub kind: String,
    pub matcher: CheckMatcher,
    #[serde(default)]
    pub requires: Option<Value>,
    #[serde(default)]
    pub scope: Option<Value>,
    #[serde(default)]
    pub exceptions: Vec<Value>,
    #[serde(default)]
    pub governance: Option<Value>,
    pub severity: String,
    pub enforcement_mode: String,
    pub enforcement_capability: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckMatcher {
    pub forbidden_imports: Option<Vec<String>>,
    /// Repo-relative files the forbidden specifiers resolve to.
    ///
    /// T100: the engine receives a graph scoped to the changed files, so it cannot derive this
    /// itself - the imports that establish what `@/lib/prisma` *means* live in files that are not
    /// part of the diff. The CLI has the whole graph and computes it there. Without it, matching
    /// falls back to comparing specifier strings, which is what let a relative import and a barrel
    /// re-export of the same module through (T93).
    #[serde(default)]
    pub forbidden_module_files: Option<Vec<String>>,
    pub allowed_delegate_imports: Option<Vec<String>>,
    pub required_calls: Option<Vec<String>>,
    pub applies_to_file_roles: Option<Vec<String>>,
    pub file_roles: Option<Vec<String>>,
    pub path_globs: Option<Vec<String>>,
    pub route_paths: Option<Vec<String>>,
    pub methods: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CheckBaselineViolation {
    pub convention_id: String,
    pub finding_fingerprint: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckDiff {
    pub mode: String,
    pub files: Option<Vec<CheckDiffFile>>,
}

#[derive(Debug, Deserialize)]
pub struct CheckDiffFile {
    pub path: String,
    pub changed_lines: Vec<usize>,
    /// Newly added file. Optional for backward compatibility with older CLIs;
    /// absent means "unknown", which conservatively falls back to scope-based
    /// classification.
    #[serde(default)]
    pub is_added: bool,
}

#[derive(Debug, Serialize)]
pub struct CheckResult {
    pub schema_version: &'static str,
    pub repo_id: String,
    pub scan_id: String,
    pub engine_version: String,
    pub rule_engine_version: String,
    pub adapter_versions: BTreeMap<String, String>,
    pub diff_mode: String,
    pub findings: Vec<CheckFinding>,
    #[serde(default)]
    pub security_boundary_proofs: Vec<Value>,
    pub diagnostics: Vec<EngineDiagnostic>,
    pub stats: EngineStats,
    pub completeness: Vec<EngineCompleteness>,
}

#[derive(Debug, Serialize)]
pub struct CheckFinding {
    pub id: String,
    pub fingerprint: String,
    pub convention_id: String,
    pub rule_id: String,
    pub title: String,
    pub message: String,
    pub severity: String,
    pub enforcement_result: String,
    pub status_hint: String,
    pub diff_status: String,
    pub evidence: Vec<CheckEvidence>,
    pub related_node_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CheckEvidence {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub evidence_id: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event")]
pub enum ScanStreamEvent {
    #[serde(rename = "scan_started")]
    ScanStarted {
        schema_version: &'static str,
        repo_id: String,
        scan_id: String,
        engine_version: String,
    },
    #[serde(rename = "file_snapshot_batch")]
    FileSnapshotBatch {
        schema_version: &'static str,
        file_snapshots: Vec<ScannedFile>,
    },
    #[serde(rename = "fact_batch")]
    FactBatch {
        schema_version: &'static str,
        facts: Vec<EngineFact>,
    },
    #[serde(rename = "graph_node_batch")]
    GraphNodeBatch {
        schema_version: &'static str,
        graph_nodes: Vec<GraphNode>,
    },
    #[serde(rename = "graph_edge_batch")]
    GraphEdgeBatch {
        schema_version: &'static str,
        graph_edges: Vec<GraphEdge>,
    },
    #[serde(rename = "graph_evidence_batch")]
    GraphEvidenceBatch {
        schema_version: &'static str,
        graph_evidence: Vec<GraphEvidence>,
    },
    #[serde(rename = "framework_adapter_batch")]
    FrameworkAdapterBatch {
        schema_version: &'static str,
        framework_adapters: Vec<EngineFrameworkAdapter>,
    },
    #[serde(rename = "normalized_entrypoint_batch")]
    NormalizedEntrypointBatch {
        schema_version: &'static str,
        normalized_entrypoints: Vec<EngineNormalizedEntrypoint>,
    },
    #[serde(rename = "framework_parser_gap_batch")]
    FrameworkParserGapBatch {
        schema_version: &'static str,
        framework_parser_gaps: Vec<EngineFrameworkParserGap>,
    },
    #[serde(rename = "framework_capability_batch")]
    FrameworkCapabilityBatch {
        schema_version: &'static str,
        framework_capabilities: Vec<EngineFrameworkCapability>,
    },
    #[serde(rename = "diagnostic_batch")]
    DiagnosticBatch {
        schema_version: &'static str,
        diagnostics: Vec<EngineDiagnostic>,
    },
    #[serde(rename = "scan_completed")]
    ScanCompleted {
        schema_version: &'static str,
        stats: EngineStats,
        completeness: Vec<EngineCompleteness>,
    },
}

pub fn adapter_versions() -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "typescript".to_string(),
            drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        ),
        // Recorded per scan so incremental reuse can tell whether stored facts were produced
        // by this engine. Reuse is otherwise keyed only on file content, which assumes a file
        // always yields the same facts - an assumption every extraction change breaks.
        (
            "engine".to_string(),
            drift_engine::DRIFT_ENGINE_VERSION.to_string(),
        ),
    ])
}

pub fn engine_stats(
    files_seen: usize,
    files_skipped: usize,
    files_parsed: usize,
    facts_emitted: usize,
    diagnostics_emitted: usize,
    duration_ms: u128,
) -> EngineStats {
    EngineStats {
        files_seen,
        files_skipped,
        files_parsed,
        files_reused: 0,
        reuse_applied: false,
        reuse_blocked_reasons: Vec::new(),
        facts_emitted,
        graph_nodes: 0,
        graph_edges: 0,
        diagnostics_emitted,
        duration_ms,
        truncated: false,
        capabilities: capability_stats(&["syntax_facts"], &[]),
    }
}

/// Completeness for a repo scan.
///
/// This previously took no arguments and hardcoded `complete: true, can_block: true`,
/// so the engine asserted full coverage even when files had been skipped. That is the
/// same failure shape as reporting a clean check while enforcement is disabled: a
/// guardrail that overstates what it inspected is worse than one that admits a gap.
///
/// `files_skipped_unreadable` is the count of files that could not be read or parsed
/// during discovery. Any skipped file means syntax facts are incomplete for the repo.
pub fn repo_completeness(files_skipped_unreadable: usize) -> Vec<EngineCompleteness> {
    let required = vec![
        "file_discovery".to_string(),
        "syntax_facts".to_string(),
        "graph_stream".to_string(),
    ];
    let complete = files_skipped_unreadable == 0;
    let (missing_capabilities, reasons) = if complete {
        (Vec::new(), Vec::new())
    } else {
        (
            vec!["syntax_facts".to_string()],
            vec![format!(
                "{files_skipped_unreadable} file(s) could not be read or parsed and were skipped"
            )],
        )
    };
    vec![EngineCompleteness {
        scope: "repo".to_string(),
        complete,
        required_capabilities: required,
        missing_capabilities,
        truncated: false,
        // Findings that were produced remain trustworthy, so a partial scan can still
        // block. What it must not do is claim it saw everything.
        can_block: true,
        reasons,
    }]
}

pub fn capability_stats(required: &[&str], missing: &[&str]) -> EngineCapabilityStats {
    EngineCapabilityStats {
        certified: certified_capabilities(),
        required: required
            .iter()
            .map(|capability| (*capability).to_string())
            .collect(),
        missing: missing
            .iter()
            .map(|capability| (*capability).to_string())
            .collect(),
    }
}

pub fn certified_capabilities() -> Vec<String> {
    [
        "candidate_inference",
        "auth_boundary_facts",
        "control_flow_guard_dominance",
        "data_operation_detection",
        "direct_data_access_check",
        "file_discovery",
        "graph_stream",
        "import_resolution",
        "route_detection",
        "security_facts",
        "symbol_linking",
        "syntax_facts",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect()
}

#[cfg(test)]
mod completeness_tests {
    use super::repo_completeness;

    /// A scan that skipped files must not claim it saw everything. This previously
    /// hardcoded `complete: true`, so one unreadable file produced either a hard abort
    /// or - had the abort been removed alone - a silent claim of full coverage.
    #[test]
    fn repo_completeness_reports_skipped_files() {
        let clean = &repo_completeness(0)[0];
        assert!(clean.complete);
        assert!(clean.missing_capabilities.is_empty());
        assert!(clean.reasons.is_empty());

        let degraded = &repo_completeness(3)[0];
        assert!(!degraded.complete);
        assert_eq!(degraded.missing_capabilities, vec!["syntax_facts"]);
        assert_eq!(degraded.reasons.len(), 1);
        // Findings that were produced are still trustworthy, so blocking stays available.
        assert!(degraded.can_block);
    }
}
