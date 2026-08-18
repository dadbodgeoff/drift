use std::{collections::BTreeMap, path::PathBuf};

use drift_engine::{ConventionKind, GraphEdgeKind, GraphNodeKind, ScanCapability};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const ENGINE_SCAN_RESULT_SCHEMA_VERSION: &str = "engine.scan.result.v1";
pub const ENGINE_STREAM_EVENT_SCHEMA_VERSION: &str = "engine.stream.event.v1";
pub const ENGINE_CHECK_RESULT_SCHEMA_VERSION: &str = "engine.check.result.v1";
pub const ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION: &str = "engine.candidates.result.v1";
pub const ENGINE_VERSION_RESULT_SCHEMA_VERSION: &str = "engine.version.result.v1";

pub const MAX_FILE_BYTES: u64 = 2_000_000;

/// BB-2: the profile this binary was compiled with, reported in every handshake.
///
/// The engine is the only honest source for this. Callers used to infer it from the resolution
/// path, which is wrong in both directions: a release binary can sit under `target/debug` and a
/// `cargo run` fallback can be `--release`. `cfg!(debug_assertions)` is evaluated when *this*
/// binary is compiled, so it describes the binary that is actually answering.
pub fn engine_build_profile() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

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
    /// BB-2: same field as the `scan_started` event carries, so the `--format json` path is not a
    /// blind spot for provenance.
    pub build_profile: &'static str,
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
    /// EW-6 (DET-1): 1-based columns, so two occurrences on one line stay two facts through the
    /// wire and into storage. `default` on deserialize because the scan-reuse manifest carries
    /// facts written by an earlier engine; those load with column 0, which is distinguishable from
    /// a real 1-based column and therefore honest about being absent.
    #[serde(default)]
    pub start_column: usize,
    #[serde(default)]
    pub end_column: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EngineDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// EW-2: the import specifier this diagnostic is about, when it is about one.
    ///
    /// `file_path` alone cannot distinguish "the import this finding rests on is unresolved"
    /// from "some other import in the same file is unresolved", and the difference decides
    /// whether a finding's evidence is uncertain or merely adjacent to uncertainty. The
    /// message carries the specifier in prose; parsing prose to make an enforcement decision
    /// is not a contract. `default` on deserialize so older payloads stay loadable and
    /// conservative.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_source: Option<String>,
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
    /// EW-2: was the graph itself sound, as distinct from "did every import resolve"?
    ///
    /// `can_block` answers the check-wide question and stays the honest whole-run verdict: a
    /// run with any coverage gap did not see everything. But a limit breach (truncated graph,
    /// too many facts, symlinks followed) and one unresolved import are not the same kind of
    /// problem. The first invalidates everything derived from the graph; the second is about
    /// one import in one file, and the engine now decides per finding whether that import is
    /// in the finding's own chain. This field is what lets a consumer tell the two apart -
    /// without it, "a finding blocks while can_block is false" is indistinguishable from a
    /// contract violation.
    ///
    /// Serialize-only, like the rest of this struct: the engine writes completeness, it never
    /// reads it back. The consumer-side default lives in `EngineCompletenessSchema`, where
    /// absent means `true` - a payload from an engine with no concept of import-scoped gaps,
    /// whose `can_block` already carried the whole verdict.
    pub graph_intact: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GraphNode {
    pub id: String,
    /// D-G4: a member of the generated vocabulary rather than a bare `String`.
    ///
    /// The engine emitted node kinds as free-form strings, so nothing on this side could tell a
    /// typo from a kind the CLI simply had not learned yet. A corrupted kind travelled to the CLI
    /// and failed there as a generic Zod enum error - exit 1, "Invalid enum value" - instead of the
    /// exit-3 `engine_vocabulary_mismatch` the fact-kind handshake had given for the same class of
    /// problem since it was built. Deserialization is strict for the same reason: a check request
    /// carrying an unknown node kind is a disagreement about vocabulary, and saying so is more
    /// useful than silently accepting it.
    pub kind: GraphNodeKind,
    pub label: String,
    pub stable: bool,
    pub evidence_ids: Vec<String>,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GraphEdge {
    pub id: String,
    /// D-G4: see `GraphNode::kind`.
    pub kind: GraphEdgeKind,
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
    /// EW-1: the runtime-use proof, carried into the check request.
    ///
    /// Dropped here, the check path re-derives member-level symbol conservatism for imports that had
    /// already escaped it - the same defect the scan-reuse manifest had, on a different route in.
    #[serde(default)]
    pub runtime_use: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    /// EW-6: the columns, so two occurrences on one line stay two facts on this path too.
    /// `default` because a request from an older CLI carries none, and 0 says that rather than
    /// claiming column 1.
    #[serde(default)]
    pub start_column: usize,
    #[serde(default)]
    pub end_column: usize,
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
    /// D-P3a: the proposed convention's kind, from the one vocabulary. The engine used to build this
    /// from string literals and the CLI validated it against a hand-copied 17-value Zod enum.
    pub kind: ConventionKind,
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
    /// CV-1: set on a per-symbol candidate that a family candidate now speaks for. Skipped when
    /// absent so every candidate that has no family serialises exactly as it did before families
    /// existed - the byte-for-byte no-change property CV-1's third negative control pins.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<String>,
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
    /// What each accepted security helper's import specifier actually resolves to.
    ///
    /// S3-03: computed CLI-side for the same structural reason as `forbidden_module_files` above -
    /// the engine's graph is scoped to the changed files, so it cannot resolve a specifier whose
    /// meaning is established by imports outside the diff. The CLI has the whole graph.
    ///
    /// It arrives on the matcher rather than inside `requires` deliberately. `requires` is the
    /// stored contract - what a human accepted - and it crosses this boundary as an untyped
    /// `Option<Value>`, so a CLI derivation placed there would both blur contract with derivation
    /// and lose its shape on the way. Typed here, a rename fails the build instead of shipping.
    ///
    /// Accepted and ignored as of this sprint: nothing reads it, and no engine behaviour depends on
    /// it. It exists so the next sprint can replace name-only and specifier-string helper matching
    /// with resolved module identity.
    ///
    /// `allow(dead_code)` is load-bearing rather than lazy, and it is temporary. `lint:engine` runs
    /// clippy with `-D warnings`, so an unread field fails the build - correctly, in general. Here
    /// the field is deliberately inert for exactly one sprint: shipping the wire shape first means
    /// the consumer lands against a field the CLI already populates over a round trip that is
    /// already exercised, rather than both arriving together untested. That the CLI really does
    /// populate it on a real run is pinned by `accepted-helper-identity-dispatch.test.ts`, which
    /// reads the JSON that actually crossed this boundary - the first wiring of this field went to
    /// a dispatch loop whose only kind carries no helpers, so it was never emitted at all, and no
    /// unit test of the request builder could see that. Delete this attribute when helper matching
    /// starts reading the field; if it is still here after that, the consumer never landed.
    #[serde(default)]
    #[allow(dead_code)]
    pub accepted_helper_module_files: Option<Vec<AcceptedHelperModuleFiles>>,
    // `allowed_delegate_imports` was here, read by nothing. It was the only configurable field
    // of api_route_requires_service_delegation's matcher, and that kind's evaluator took it as
    // `_allowed_delegate_imports` and never looked at it - so an author who narrowed their
    // convention narrowed nothing. The kind now fails closed at acceptance
    // (docs/decisions/service-delegation-capability.md) and the field goes with it. Serde
    // ignores unknown keys, so an older contract still carrying one deserialises fine.
    pub required_calls: Option<Vec<String>>,
    pub applies_to_file_roles: Option<Vec<String>>,
    pub file_roles: Option<Vec<String>>,
    pub path_globs: Option<Vec<String>>,
    pub route_paths: Option<Vec<String>>,
    pub methods: Option<Vec<String>>,
    /// CV-3: `Some("presence")` selects presence-only enforcement - the route calls an accepted
    /// helper, or it does not. Absent selects the kind's existing proof path, which for the security
    /// kinds reasons about control flow and stays quarantined.
    #[serde(default)]
    pub enforcement_semantics: Option<String>,
    /// CV-2: the route flavours this convention is about. Absent or empty means all of them.
    #[serde(default)]
    pub applies_to_route_flavors: Option<Vec<String>>,
}

/// One accepted security helper's resolved module identity, and how that answer was reached.
///
/// `mode` carries as much of the answer as `files` does, and a consumer that reads one without the
/// other will be wrong in the common case:
///
///   - `repo_resolved` - the specifier resolved inside the repo; `files` is the identity, re-export
///     chains already followed. Match on resolved file. The chain is filtered by the helper's
///     symbol, so a barrel that re-exports both the helper and an unrelated module contributes only
///     the module that exports the symbol - but the filter compares symbol NAMES, so a barrel
///     re-exporting one name from two modules yields both. `files` means "modules that plausibly
///     supply this helper", not "modules proven to be it".
///   - `external` - a bare package specifier that resolved to nothing, which is not a failure:
///     `resolve_import` filters to paths inside the scan snapshot, so `next-auth` and everything
///     else under `node_modules` never produces an edge. `files` is empty and always will be.
///     Match on the exact specifier, plus a local-shadow check.
///   - `unresolved` - a repo-relative specifier that resolved to nothing. Also empty `files`, but
///     this one is a degradation and belongs in the proof as one.
///
/// Reading an empty `files` as "this helper matches nothing" would therefore flag every route that
/// correctly uses an external auth helper - the most common real-world contract there is.
/// Inert for one sprint by design - see `CheckMatcher::accepted_helper_module_files`.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct AcceptedHelperModuleFiles {
    /// Which `requires` list this helper came from - `auth_helpers`, `csrf_helpers`, and so on.
    ///
    /// Part of the identity. `symbol` is unique WITHIN a list and not across them, and this engine
    /// already reads the lists separately (`accepted_auth_helpers_for_convention`,
    /// `phase6_helpers_from_requires`, `security_helpers_from_requires` each build their own map),
    /// so a name reused by an auth helper and a response serializer is two helpers here too.
    pub requires_key: String,
    pub symbol: String,
    /// The specifier as the contract typed it. `external` and `unresolved` match on this.
    pub specifier: String,
    pub mode: String,
    #[serde(default)]
    pub files: Vec<String>,
    /// The tsconfig-paths hijack shape: the contract names a package and the repo has pointed that
    /// name at a file it controls. Present only when true, and never to be silently accepted.
    #[serde(default)]
    pub external_specifier_resolves_in_repo: Option<bool>,
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
    /// What this run did with each convention it was handed, one entry per convention.
    ///
    /// The engine's convention loop has five ways out and four of them are a bare `continue`: a
    /// non-deterministic capability, a kind the vocabulary does not know, a kind dispatched
    /// elsewhere, and the exhaustive skip arm at the end. Every one produced an empty findings
    /// list indistinguishable from an evaluator that ran and was satisfied, and `completeness`
    /// does not distinguish them either - it reports capabilities and limits, not conventions.
    ///
    /// Always emitted, including when everything ran. A coverage account that appears only on
    /// failure is not an account, and a consumer must be able to ask "did this convention run"
    /// without knowing the answer in advance.
    pub evaluation_receipts: Vec<CheckEvaluationReceipt>,
}

/// One convention's account of itself: reached, on how much, producing what, or why not.
///
/// `skip_reason` is `Some` exactly when `reached` is false, so the two cannot describe different
/// runs. The reason vocabulary is shared with the CLI ledger
/// (packages/cli/src/check/evaluation-receipts.ts) rather than free text, because these are read
/// by machines - the human summary counts them and `security audit` derives proof-backing from
/// them.
#[derive(Debug, Serialize)]
pub struct CheckEvaluationReceipt {
    pub convention_id: String,
    pub kind: String,
    /// Where the vocabulary says this kind is evaluated: engine_direct, engine_phase6, cli, none.
    pub dispatch: String,
    pub reached: bool,
    /// Facts in scope for this convention. Zero with `reached: true` is a real outcome - the
    /// evaluator ran on nothing - and not the same as never having run.
    pub inputs_considered: usize,
    pub findings_emitted: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
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
    /// T-03: the symbol this finding is about, when the finding is about one.
    ///
    /// Presence is enforced per handler - `GET` and `POST` in one `route.ts` are two endpoints and
    /// two findings - but the handler name reached the CLI only inside the message prose, so every
    /// presence finding arrived with a null symbol and two handlers in one file were
    /// indistinguishable by anything structured. T-06 keys per-handler baseline identity on this.
    ///
    /// Omitted rather than sent as null when there is none, so a finding that is genuinely about a
    /// whole file does not claim a symbol it does not have.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
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
        /// BB-2: `"release"` or `"debug"`. A debug engine's timings are ~2.7x inflated, so every
        /// consumer that records a measurement needs to be able to refuse one.
        build_profile: &'static str,
        /// Every fact kind this engine can emit, sorted.
        ///
        /// Declared here so the CLI can refuse an incompatible pairing before ingesting anything,
        /// rather than throwing on the first record of an unknown kind partway through the stream.
        /// Neither `engine_version` nor `schema_version` moves when the vocabulary changes, so
        /// neither can detect a stale binary; this can.
        fact_kinds: Vec<String>,
        /// D-G4: every graph node kind this engine can emit, sorted. Same contract as `fact_kinds`.
        graph_node_kinds: Vec<String>,
        /// D-G4: every graph edge kind this engine can emit, sorted.
        graph_edge_kinds: Vec<String>,
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
        capabilities: capability_stats(&[ScanCapability::SyntaxFacts], &[]),
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
pub fn repo_completeness(
    files_skipped_unreadable: usize,
    files_skipped_too_large: usize,
) -> Vec<EngineCompleteness> {
    let required = vec![
        ScanCapability::FileDiscovery.as_wire().to_string(),
        ScanCapability::SyntaxFacts.as_wire().to_string(),
        ScanCapability::GraphStream.as_wire().to_string(),
    ];
    let complete = files_skipped_unreadable == 0 && files_skipped_too_large == 0;
    let (missing_capabilities, reasons) = if complete {
        (Vec::new(), Vec::new())
    } else {
        // Two reasons rather than one total, because they call for different responses: an
        // unreadable file is usually a mistake worth fixing, an oversized one is usually a
        // generated artifact worth excluding. A single "n files skipped" makes the reader go
        // find out which.
        let mut reasons = Vec::new();
        if files_skipped_unreadable > 0 {
            reasons.push(format!(
                "{files_skipped_unreadable} file(s) could not be read or parsed and were skipped"
            ));
        }
        if files_skipped_too_large > 0 {
            reasons.push(format!(
                "{files_skipped_too_large} file(s) exceeded the {MAX_FILE_BYTES} byte scan limit and were skipped"
            ));
        }
        (
            vec![ScanCapability::SyntaxFacts.as_wire().to_string()],
            reasons,
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
        graph_intact: true,
        reasons,
    }]
}

pub fn capability_stats(
    required: &[ScanCapability],
    missing: &[ScanCapability],
) -> EngineCapabilityStats {
    EngineCapabilityStats {
        certified: certified_capabilities(),
        required: required
            .iter()
            .map(|capability| capability.as_wire().to_string())
            .collect(),
        missing: missing
            .iter()
            .map(|capability| capability.as_wire().to_string())
            .collect(),
    }
}

/// D-S1: what this engine is certified to have done, from the one capability vocabulary.
///
/// The list used to be twelve literals here and eight `ts.*.v1` ids in
/// packages/core/src/semantic-capabilities.ts, with no string in common by construction, bridged by
/// a hand-written table in packages/query/src/semantic-coverage.ts that named four capabilities this
/// engine has never emitted. One namespace now, generated into both languages.
///
/// `route_flow` and `static_imports` joined the certified set with that collapse. Both were declared
/// on the TypeScript side as supported, certified-deterministic capabilities and were absent here,
/// so `route_flow` - which `get_task_preflight` requires on every call - was required and never
/// certified, and semantic coverage refused unconditionally. Certifying them is a claim about
/// evidence, and it is checkable: `scripts/vocabulary-parity.mjs` fails if a capability contract
/// names a fact, node or edge kind this engine does not produce.
pub fn certified_capabilities() -> Vec<String> {
    let mut names: Vec<String> = ScanCapability::ENGINE_CERTIFIED
        .iter()
        .map(|capability| capability.as_wire().to_string())
        .collect();
    names.sort();
    names
}

#[cfg(test)]
mod completeness_tests {
    use super::repo_completeness;

    /// A scan that skipped files must not claim it saw everything. This previously
    /// hardcoded `complete: true`, so one unreadable file produced either a hard abort
    /// or - had the abort been removed alone - a silent claim of full coverage.
    #[test]
    fn repo_completeness_reports_skipped_files() {
        let clean = &repo_completeness(0, 0)[0];
        assert!(clean.complete);
        assert!(clean.missing_capabilities.is_empty());
        assert!(clean.reasons.is_empty());

        let degraded = &repo_completeness(3, 0)[0];
        assert!(!degraded.complete);
        assert_eq!(degraded.missing_capabilities, vec!["syntax_facts"]);
        assert_eq!(degraded.reasons.len(), 1);
        // Findings that were produced are still trustworthy, so blocking stays available.
        assert!(degraded.can_block);
    }

    /// An oversized file is a file the scan did not read, and it was counted nowhere.
    ///
    /// The oversize branch returns `Ok(None)`, which the caller matched with an empty arm, so a
    /// skipped 2 MB route left this reporting `complete: true` - the exact overstatement the
    /// unreadable counter above exists to prevent, arriving one branch over.
    #[test]
    fn repo_completeness_reports_files_skipped_for_size() {
        let oversized = &repo_completeness(0, 2)[0];
        assert!(!oversized.complete);
        assert_eq!(oversized.missing_capabilities, vec!["syntax_facts"]);
        assert_eq!(oversized.reasons.len(), 1);
        assert!(oversized.reasons[0].contains("scan limit"));
        assert!(oversized.can_block);

        // Both kinds are named separately: unreadable is usually a mistake to fix, oversized is
        // usually a generated artifact to exclude, and one merged count makes the reader go and
        // find out which they have.
        let both = &repo_completeness(1, 1)[0];
        assert!(!both.complete);
        assert_eq!(both.reasons.len(), 2);
    }
}
