import { z } from "zod";
import {
  GraphEdgeSchema,
  GraphEvidenceSchema,
  GraphNodeSchema
} from "@drift/factgraph";

export const ENGINE_SCAN_REQUEST_SCHEMA_VERSION = "engine.scan.request.v1";
export const ENGINE_SCAN_RESULT_SCHEMA_VERSION = "engine.scan.result.v1";
export const ENGINE_CHECK_REQUEST_SCHEMA_VERSION = "engine.check.request.v1";
export const ENGINE_CHECK_RESULT_SCHEMA_VERSION = "engine.check.result.v1";
export const ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION = "engine.candidates.result.v1";
export const ENGINE_STREAM_EVENT_SCHEMA_VERSION = "engine.stream.event.v1";

const DiagnosticSeveritySchema = z.enum(["info", "warning", "error"]);
const DiffModeSchema = z.enum(["changed-hunks", "changed-files", "full"]);
const CompletenessScopeSchema = z.enum(["repo", "changed-files", "changed-hunks", "route-flow", "file"]);

export const EngineLimitsSchema = z.object({
  max_files_seen: z.number().int().positive(),
  max_files_parsed: z.number().int().positive(),
  max_file_bytes: z.number().int().positive(),
  max_facts: z.number().int().positive(),
  max_graph_nodes: z.number().int().nonnegative(),
  max_graph_edges: z.number().int().nonnegative(),
  max_diagnostics: z.number().int().nonnegative(),
  max_duration_ms: z.number().int().positive().optional(),
  follow_symlinks: z.literal(false)
});

export const EngineStatsSchema = z.object({
  files_seen: z.number().int().nonnegative(),
  files_skipped: z.number().int().nonnegative(),
  files_parsed: z.number().int().nonnegative(),
  facts_emitted: z.number().int().nonnegative(),
  graph_nodes: z.number().int().nonnegative(),
  graph_edges: z.number().int().nonnegative(),
  diagnostics_emitted: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  peak_rss_bytes: z.number().int().nonnegative().optional(),
  batch_count: z.number().int().nonnegative().optional(),
  spill_artifacts_written: z.number().int().nonnegative().optional(),
  truncated: z.boolean(),
  truncation_reason: z.string().min(1).optional()
});

export const EngineDiagnosticSchema = z.object({
  severity: DiagnosticSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  file_path: z.string().min(1).optional(),
  evidence_id: z.string().min(1).optional()
});

export const EngineCompletenessSchema = z.object({
  scope: CompletenessScopeSchema,
  rule_id: z.string().min(1).optional(),
  complete: z.boolean(),
  required_capabilities: z.array(z.string().min(1)),
  missing_capabilities: z.array(z.string().min(1)),
  truncated: z.boolean(),
  can_block: z.boolean(),
  reasons: z.array(z.string())
});

export const EngineFileSnapshotSchema = z.object({
  file_path: z.string().min(1),
  content_hash: z.string().min(1),
  byte_size: z.number().int().nonnegative(),
  indexed: z.boolean()
});

export const EngineFactSchema = z.object({
  kind: z.enum([
    "file_detected",
    "import_used",
    "re_export_used",
    "exported_symbol",
    "symbol_called",
    "data_operation_detected",
    "route_declared",
    "file_role_detected",
    "test_declared"
  ]),
  file_path: z.string().min(1),
  name: z.string().min(1),
  value: z.string().optional(),
  imported_name: z.string().optional(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive()
});

export const EngineRepoContextSchema = z.object({
  repo_id: z.string().min(1),
  repo_root: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().min(1),
  dirty: z.boolean()
});

export const EngineScanRequestSchema = z.object({
  schema_version: z.literal(ENGINE_SCAN_REQUEST_SCHEMA_VERSION),
  repo: EngineRepoContextSchema,
  limits: EngineLimitsSchema,
  adapters: z.object({
    enabled: z.array(z.string().min(1)),
    disabled: z.array(z.string().min(1)),
    required_capabilities: z.array(z.string().min(1))
  }),
  policy: z.object({
    denied_globs: z.array(z.string().min(1)),
    max_snippet_chars: z.number().int().nonnegative(),
    allow_full_file_content: z.literal(false)
  })
});

export const EngineScanResultSchema = z.object({
  schema_version: z.literal(ENGINE_SCAN_RESULT_SCHEMA_VERSION),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  engine_version: z.string().min(1),
  adapter_versions: z.record(z.string().min(1)),
  file_snapshots: z.array(EngineFileSnapshotSchema),
  facts: z.array(EngineFactSchema),
  graph: z.unknown().optional(),
  diagnostics: z.array(EngineDiagnosticSchema),
  stats: EngineStatsSchema,
  completeness: z.array(EngineCompletenessSchema)
});

const EngineConventionSchema = z.object({
  id: z.string().min(1),
  rule_id: z.string().min(1),
  rule_version: z.string().min(1).optional(),
  kind: z.string().min(1),
  matcher: z.record(z.unknown()),
  severity: z.enum(["info", "warning", "error"]),
  enforcement_mode: z.enum(["off", "brief", "warn", "block"]),
  enforcement_capability: z.enum(["briefing_only", "heuristic_check", "deterministic_check"])
});

const EngineWaiverSchema = z.object({
  id: z.string().min(1),
  convention_id: z.string().min(1).optional(),
  finding_fingerprint: z.string().min(1).optional(),
  path_globs: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1)
});

const EngineBaselineViolationSchema = z.object({
  convention_id: z.string().min(1),
  finding_fingerprint: z.string().min(1),
  status: z.enum(["active", "resolved"])
});

export const EngineCheckRequestSchema = z.object({
  schema_version: z.literal(ENGINE_CHECK_REQUEST_SCHEMA_VERSION),
  repo: EngineRepoContextSchema,
  graph: z.object({
    graph_id: z.string().min(1).optional(),
    scan_id: z.string().min(1).optional(),
    require_fresh: z.boolean(),
    graph_nodes: z.array(GraphNodeSchema).default([]),
    graph_edges: z.array(GraphEdgeSchema).default([]),
    graph_evidence: z.array(GraphEvidenceSchema).default([]),
    graph_diagnostics: z.array(EngineDiagnosticSchema).default([])
  }),
  scan: z.object({
    scan_id: z.string().min(1),
    file_snapshots: z.array(EngineFileSnapshotSchema),
    facts: z.array(EngineFactSchema)
  }),
  contract: z.object({
    contract_id: z.string().min(1),
    contract_schema_version: z.number().int().positive(),
    conventions: z.array(EngineConventionSchema),
    waivers: z.array(EngineWaiverSchema),
    exceptions: z.array(z.record(z.unknown()))
  }),
  baseline: z.array(EngineBaselineViolationSchema),
  diff: z.object({
    mode: DiffModeSchema,
    range: z.string().min(1).optional(),
    patch: z.string().optional(),
    files: z.array(z.object({
      path: z.string().min(1),
      changed_lines: z.array(z.number().int().positive())
    })).optional(),
    deleted_files: z.array(z.string().min(1)).optional()
  }),
  limits: EngineLimitsSchema
});

export const EngineEvidenceRefSchema = z.object({
  file_path: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  evidence_id: z.string().min(1).optional()
});

export const EngineCandidateEvidenceRefSchema = z.object({
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

export const EngineCandidateScoringSchema = z.object({
  supporting_examples_count: z.number().int().nonnegative(),
  counterexamples_count: z.number().int().nonnegative(),
  scope_files_count: z.number().int().nonnegative(),
  coverage_ratio: z.number().min(0).max(1),
  heuristic_id: z.string().min(1)
});

export const EngineCandidateSchema = z.object({
  candidate_id: z.string().min(1),
  candidate_version: z.number().int().positive(),
  kind: z.enum([
    "api_route_no_direct_data_access",
    "api_route_requires_service_delegation",
    "api_route_requires_auth_helper",
    "test_expected_for_changed_module",
    "custom_briefing"
  ]),
  rule_id: z.string().min(1),
  rule_version: z.string().min(1),
  matcher_schema_version: z.string().min(1),
  matcher_fingerprint: z.string().min(1),
  scope_fingerprint: z.string().min(1),
  graph_fingerprint: z.string().min(1),
  statement: z.string().min(1),
  rationale: z.string().min(1).optional(),
  scope: z.record(z.unknown()),
  matcher: z.record(z.unknown()),
  suggested_severity: z.enum(["info", "warning", "error"]),
  suggested_enforcement_mode: z.enum(["off", "brief", "warn", "block"]),
  enforcement_capability: z.enum(["briefing_only", "heuristic_check", "deterministic_check"]),
  confidence_label: z.enum(["low", "medium", "high"]),
  scoring: EngineCandidateScoringSchema,
  required_capabilities: z.array(z.string().min(1)),
  evidence_refs: z.array(EngineCandidateEvidenceRefSchema),
  counterexample_refs: z.array(EngineCandidateEvidenceRefSchema),
  supersedes_candidate_id: z.string().min(1).optional()
});

export const EngineFindingSchema = z.object({
  id: z.string().min(1),
  fingerprint: z.string().min(1),
  convention_id: z.string().min(1),
  rule_id: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  enforcement_result: z.enum(["none", "warn", "block"]),
  status_hint: z.enum(["new", "pre_existing"]),
  diff_status: z.enum(["new_in_diff", "touched_existing", "outside_diff"]),
  evidence: z.array(EngineEvidenceRefSchema),
  related_node_ids: z.array(z.string())
});

export const EngineCheckResultSchema = z.object({
  schema_version: z.literal(ENGINE_CHECK_RESULT_SCHEMA_VERSION),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  graph_id: z.string().min(1).optional(),
  engine_version: z.string().min(1),
  rule_engine_version: z.string().min(1),
  adapter_versions: z.record(z.string().min(1)),
  diff_mode: DiffModeSchema,
  findings: z.array(EngineFindingSchema),
  diagnostics: z.array(EngineDiagnosticSchema),
  stats: EngineStatsSchema,
  completeness: z.array(EngineCompletenessSchema)
});

export const EngineCandidatesResultSchema = z.object({
  schema_version: z.literal(ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  graph_id: z.string().min(1).optional(),
  engine_version: z.string().min(1),
  rule_engine_version: z.string().min(1),
  adapter_versions: z.record(z.string().min(1)),
  candidates: z.array(EngineCandidateSchema),
  diagnostics: z.array(EngineDiagnosticSchema),
  stats: EngineStatsSchema,
  completeness: z.array(EngineCompletenessSchema)
});

export const EngineStreamEventSchema = z.discriminatedUnion("event", [
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("scan_started"),
    repo_id: z.string().min(1).optional(),
    scan_id: z.string().min(1).optional(),
    engine_version: z.string().min(1)
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("file_snapshot_batch"),
    file_snapshots: z.array(EngineFileSnapshotSchema)
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("fact_batch"),
    facts: z.array(EngineFactSchema)
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("graph_node_batch"),
    graph_nodes: z.array(GraphNodeSchema)
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("graph_edge_batch"),
    graph_edges: z.array(GraphEdgeSchema)
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("graph_evidence_batch"),
    graph_evidence: z.array(GraphEvidenceSchema)
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("diagnostic_batch"),
    diagnostics: z.array(EngineDiagnosticSchema)
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("stats_delta"),
    stats: EngineStatsSchema.partial()
  }),
  z.object({
    schema_version: z.literal(ENGINE_STREAM_EVENT_SCHEMA_VERSION),
    event: z.literal("scan_completed"),
    stats: EngineStatsSchema,
    completeness: z.array(EngineCompletenessSchema)
  })
]);

export type EngineLimits = z.infer<typeof EngineLimitsSchema>;
export type EngineStats = z.infer<typeof EngineStatsSchema>;
export type EngineDiagnostic = z.infer<typeof EngineDiagnosticSchema>;
export type EngineCompleteness = z.infer<typeof EngineCompletenessSchema>;
export type EngineFileSnapshot = z.infer<typeof EngineFileSnapshotSchema>;
export type EngineFact = z.infer<typeof EngineFactSchema>;
export type EngineScanRequest = z.infer<typeof EngineScanRequestSchema>;
export type EngineScanResult = z.infer<typeof EngineScanResultSchema>;
export type EngineCheckRequest = z.infer<typeof EngineCheckRequestSchema>;
export type EngineCheckResult = z.infer<typeof EngineCheckResultSchema>;
export type EngineCandidateEvidenceRef = z.infer<typeof EngineCandidateEvidenceRefSchema>;
export type EngineCandidateScoring = z.infer<typeof EngineCandidateScoringSchema>;
export type EngineCandidate = z.infer<typeof EngineCandidateSchema>;
export type EngineCandidatesResult = z.infer<typeof EngineCandidatesResultSchema>;
export type EngineStreamEvent = z.infer<typeof EngineStreamEventSchema>;

export function parseEngineScanResult(value: unknown): EngineScanResult {
  return parseWithMessage(EngineScanResultSchema, value, "Invalid Drift engine scan result");
}

export function parseEngineStreamEvent(value: unknown): EngineStreamEvent {
  return parseWithMessage(EngineStreamEventSchema, value, "Invalid Drift engine stream event");
}

export function parseEngineCheckResult(value: unknown): EngineCheckResult {
  return parseWithMessage(EngineCheckResultSchema, value, "Invalid Drift engine check result");
}

export function parseEngineCandidatesResult(value: unknown): EngineCandidatesResult {
  return parseWithMessage(EngineCandidatesResultSchema, value, "Invalid Drift engine candidates result");
}

function parseWithMessage<S extends z.ZodTypeAny>(schema: S, value: unknown, message: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${message}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
}
