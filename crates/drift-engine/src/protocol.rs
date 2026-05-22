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

#[derive(Debug, Clone, Serialize)]
pub struct EngineFact {
    pub kind: String,
    pub file_path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_name: Option<String>,
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
pub struct EngineStats {
    pub files_seen: usize,
    pub files_skipped: usize,
    pub files_parsed: usize,
    pub facts_emitted: usize,
    pub graph_nodes: usize,
    pub graph_edges: usize,
    pub diagnostics_emitted: usize,
    pub duration_ms: u128,
    pub truncated: bool,
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
    pub redaction_state: String,
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
    pub suggested_severity: String,
    pub suggested_enforcement_mode: String,
    pub enforcement_capability: String,
    pub confidence_label: String,
    pub scoring: Value,
    pub required_capabilities: Vec<String>,
    pub evidence_refs: Vec<EngineCandidateEvidenceRef>,
    pub counterexample_refs: Vec<EngineCandidateEvidenceRef>,
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
    pub conventions: Vec<CheckConvention>,
}

#[derive(Debug, Deserialize)]
pub struct CheckConvention {
    pub id: String,
    pub kind: String,
    pub matcher: CheckMatcher,
    pub severity: String,
    pub enforcement_mode: String,
    pub enforcement_capability: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckMatcher {
    pub forbidden_imports: Option<Vec<String>>,
    pub allowed_delegate_imports: Option<Vec<String>>,
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
    BTreeMap::from([(
        "typescript".to_string(),
        drift_engine::DRIFT_ENGINE_VERSION.to_string(),
    )])
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
        facts_emitted,
        graph_nodes: 0,
        graph_edges: 0,
        diagnostics_emitted,
        duration_ms,
        truncated: false,
    }
}

pub fn repo_completeness() -> Vec<EngineCompleteness> {
    vec![EngineCompleteness {
        scope: "repo".to_string(),
        complete: true,
        required_capabilities: vec!["syntax_facts".to_string()],
        missing_capabilities: Vec::new(),
        truncated: false,
        can_block: true,
        reasons: Vec::new(),
    }]
}
