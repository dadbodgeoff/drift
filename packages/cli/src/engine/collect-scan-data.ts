import type {
  FactRecord,
  FileSnapshot,
  FrameworkAdapter,
  FrameworkCapability,
  FrameworkParserGap,
  NormalizedEntrypointFact
} from "@drift/core";
import type { EngineDiagnostic,EngineScanResult,EngineStats,EngineStreamEvent } from "@drift/engine-contract";
import type { GraphEdge,GraphEvidence,GraphNode } from "@drift/factgraph";
import { parseEngineScanResult,parseEngineStreamEvent,type EngineCompleteness} from "@drift/engine-contract";
import { extractFactsFromFile,factRecord,fileSnapshotForFile } from "./fact-extraction.js";
import { type EngineBuildProfile, engineResolutionStatus, streamRustEngineLines } from "./rust-engine.js";
import { walkIndexableFiles } from "./ts-fallback-scanner.js";

export interface ScanData {
  files: string[];
  facts: FactRecord[];
  snapshots: FileSnapshot[];
  engineSource: "rust" | "typescript";
  fallbackStatus: ScanFallbackStatus;
  stats?: EngineStats;
  diagnostics: EngineDiagnostic[];
  graph_nodes: GraphNode[];
  graph_edges: GraphEdge[];
  graph_evidence: GraphEvidence[];
  graph_diagnostics: EngineDiagnostic[];
  framework_adapters: FrameworkAdapter[];
  normalized_entrypoints: NormalizedEntrypointFact[];
  framework_parser_gaps: FrameworkParserGap[];
  framework_capabilities: FrameworkCapability[];
  /**
   * The engine's own completeness measurement for this scan.
   *
   * Previously discarded, which meant the honest computation added for A4 - reporting
   * complete:false when files were skipped - never reached the user: the factgraph
   * substituted a hardcoded default, so graph completeness was always a constant rather
   * than a measurement.
   */
  completeness?: EngineCompleteness[];
  /**
   * Version of the engine binary that produced this scan, taken from the `scan_started`
   * event. Persisted per scan so incremental reuse can refuse facts written by a different
   * engine: reuse is otherwise keyed only on file content, which assumes a file always yields
   * the same facts - an assumption every extraction change breaks.
   */
  engineVersion?: string;
}

export interface ScanFallbackStatus {
  engine_source: "rust" | "typescript";
  fallback_used: boolean;
  fallback_reason: "rust_engine_failed" | null;
  engine_error_message: string | null;
  degraded_capabilities: string[];
  enforcement_degraded: boolean;
  /**
   * BB-2: which of the three resolution routes produced the engine that answered.
   *
   * The discriminant existed on `RustEngineCommand` since the packaged-binary work and was
   * propagated nowhere, so a `cargo run --quiet` debug engine reported itself as
   * `engine_source: "rust", fallback_used: false` — true, and materially misleading, because the
   * check it timed was ~2.7x slower than the product a user would install.
   */
  engine_resolution: "env_override" | "packaged_optional_dependency" | "workspace_cargo" | null;
  /**
   * BB-2: the profile the engine reports for itself. `null` means it could not be asked — never
   * read that as "release".
   */
  engine_build_profile: EngineBuildProfile;
}

interface ScanDataInput {
  repoId: string;
  scanId: string;
  repoRoot: string;
  reuseManifestPath?: string;
}

export async function collectScanData(input: ScanDataInput): Promise<ScanData> {
  let rustError: unknown;
  try {
    return await collectScanDataFromRust(input);
  } catch (error) {
    if (process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK !== "1") {
      throw error;
    }
    rustError = error;
  }

  const files = walkIndexableFiles(input.repoRoot);
  const errorMessage = rustError instanceof Error ? rustError.message : "Unknown Rust engine failure.";
  const fallbackDiagnostic: EngineDiagnostic = {
    severity: "warning",
    code: "typescript_fallback_used",
    message: `Rust engine failed and DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK=1 enabled the degraded TypeScript scanner: ${errorMessage}`
  };
  return {
    files,
    facts: files.flatMap((filePath) =>
      extractFactsFromFile({
        repoId: input.repoId,
        scanId: input.scanId,
        repoRoot: input.repoRoot,
        filePath
      })
    ),
    snapshots: files.map((filePath) =>
      fileSnapshotForFile({
        repoId: input.repoId,
        scanId: input.scanId,
        repoRoot: input.repoRoot,
        filePath
      })
    ),
    engineSource: "typescript",
    fallbackStatus: {
      engine_source: "typescript",
      fallback_used: true,
      fallback_reason: "rust_engine_failed",
      engine_error_message: errorMessage,
      degraded_capabilities: ["graph", "graph_evidence", "deterministic_enforcement"],
      enforcement_degraded: true,
      // BB-2: the TypeScript scanner is not the Rust engine, so neither field describes it.
      engine_resolution: null,
      engine_build_profile: null
    },
    diagnostics: [fallbackDiagnostic],
    graph_nodes: [],
    graph_edges: [],
    graph_evidence: [],
    graph_diagnostics: [fallbackDiagnostic],
    framework_adapters: [],
    normalized_entrypoints: [],
    framework_parser_gaps: [],
    framework_capabilities: [],
    stats: {
      files_seen: files.length,
      files_skipped: 0,
      files_parsed: files.length,
      facts_emitted: 0,
      graph_nodes: 0,
      graph_edges: 0,
      diagnostics_emitted: 1,
      duration_ms: 0,
      truncated: false
    }
  };
}

export async function collectScanDataFromRust(input: ScanDataInput): Promise<ScanData> {
  const events: EngineStreamEvent[] = [];
  await streamRustEngineLines([
    "scan-repo",
    input.repoRoot,
    "--format",
    "jsonl",
    "--repo-id",
    input.repoId,
    "--scan-id",
    input.scanId,
    ...(input.reuseManifestPath ? ["--reuse-manifest", input.reuseManifestPath] : [])
  ], (line) => {
    events.push(parseEngineStreamLine(line, events.length));
  });

  return scanDataFromEngineStreamEvents(events, input);
}

export function scanDataFromEngineScanResult(value: unknown, input: ScanDataInput): ScanData {
  const parsed = parseEngineScanResult(value);
  return {
    files: sortedSnapshotFiles(parsed.file_snapshots),
    facts: parsed.facts.map((fact) => engineFactRecord(input, fact)),
    snapshots: parsed.file_snapshots.map((file) => engineFileSnapshot(input, file)),
    engineSource: "rust",
    fallbackStatus: rustFallbackStatus(parsed.build_profile ?? null),
    diagnostics: parsed.diagnostics,
    graph_nodes: [],
    graph_edges: [],
    graph_evidence: [],
    graph_diagnostics: [],
    framework_adapters: parsed.framework_adapters.map((adapter) =>
      engineFrameworkAdapter(adapter, parsed.framework_capabilities.map(engineFrameworkCapability))
    ),
    normalized_entrypoints: parsed.normalized_entrypoints.map(engineNormalizedEntrypoint),
    framework_parser_gaps: parsed.framework_parser_gaps.map(engineFrameworkParserGap),
    framework_capabilities: parsed.framework_capabilities.map(engineFrameworkCapability),
    stats: parsed.stats
  };
}

export function scanDataFromEngineStreamOutput(output: string, input: ScanDataInput): ScanData {
  const events = parseEngineStreamOutput(output);
  return scanDataFromEngineStreamEvents(events, input);
}

export function scanDataFromEngineStreamEvents(events: EngineStreamEvent[], input: ScanDataInput): ScanData {
  const fileSnapshots: EngineScanResult["file_snapshots"] = [];
  const facts: EngineScanResult["facts"] = [];
  const diagnostics: EngineDiagnostic[] = [];
  const graphNodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];
  const graphEvidence: GraphEvidence[] = [];
  const frameworkAdapters: EngineScanResult["framework_adapters"] = [];
  const normalizedEntrypoints: EngineScanResult["normalized_entrypoints"] = [];
  const frameworkParserGaps: EngineScanResult["framework_parser_gaps"] = [];
  const frameworkCapabilities: EngineScanResult["framework_capabilities"] = [];
  let stats: EngineStats | undefined;
  let completeness: EngineCompleteness[] | undefined;
  let engineVersion: string | undefined;
  let buildProfile: EngineBuildProfile = null;
  let completed = false;

  for (const event of events) {
    switch (event.event) {
      case "file_snapshot_batch":
        fileSnapshots.push(...event.file_snapshots);
        break;
      case "fact_batch":
        facts.push(...event.facts);
        break;
      case "graph_node_batch":
        graphNodes.push(...event.graph_nodes);
        break;
      case "graph_edge_batch":
        graphEdges.push(...event.graph_edges);
        break;
      case "graph_evidence_batch":
        graphEvidence.push(...event.graph_evidence.map(engineGraphEvidence));
        break;
      case "framework_adapter_batch":
        frameworkAdapters.push(...event.framework_adapters);
        break;
      case "normalized_entrypoint_batch":
        normalizedEntrypoints.push(...event.normalized_entrypoints);
        break;
      case "framework_parser_gap_batch":
        frameworkParserGaps.push(...event.framework_parser_gaps);
        break;
      case "framework_capability_batch":
        frameworkCapabilities.push(...event.framework_capabilities);
        break;
      case "scan_completed":
        completed = true;
        stats = event.stats;
        completeness = event.completeness;
        break;
      case "diagnostic_batch":
        diagnostics.push(...event.diagnostics);
        break;
      case "scan_started":
        engineVersion = event.engine_version;
        buildProfile = event.build_profile ?? null;
        break;
      case "stats_delta":
        break;
    }
  }

  if (!completed) {
    throw new Error("Drift engine stream did not complete");
  }

  return {
    files: sortedSnapshotFiles(fileSnapshots),
    facts: facts.map((fact) => engineFactRecord(input, fact)),
    snapshots: fileSnapshots.map((file) => engineFileSnapshot(input, file)),
    engineSource: "rust",
    fallbackStatus: rustFallbackStatus(buildProfile),
    diagnostics,
    graph_nodes: graphNodes,
    graph_edges: graphEdges,
    graph_evidence: graphEvidence,
    graph_diagnostics: diagnostics,
    framework_adapters: frameworkAdapters.map((adapter) =>
      engineFrameworkAdapter(adapter, frameworkCapabilities.map(engineFrameworkCapability))
    ),
    normalized_entrypoints: normalizedEntrypoints.map(engineNormalizedEntrypoint),
    framework_parser_gaps: frameworkParserGaps.map(engineFrameworkParserGap),
    framework_capabilities: frameworkCapabilities.map(engineFrameworkCapability),
    completeness,
    engineVersion,
    stats
  };
}

function rustFallbackStatus(reportedBuildProfile?: EngineBuildProfile): ScanFallbackStatus {
  const status = engineResolutionStatus();
  return {
    engine_source: "rust",
    fallback_used: false,
    fallback_reason: null,
    engine_error_message: null,
    degraded_capabilities: [],
    enforcement_degraded: false,
    engine_resolution: status.resolution,
    // BB-2: the scan's own `scan_started` handshake wins when we have it - it came from the process
    // that produced these facts, where the separate `version` probe only describes the binary we
    // would spawn now.
    engine_build_profile: reportedBuildProfile ?? status.build_profile
  };
}

function parseEngineStreamOutput(output: string): EngineStreamEvent[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseEngineStreamLine);
}

function parseEngineStreamLine(line: string, index: number): EngineStreamEvent {
  try {
    return parseEngineStreamEvent(JSON.parse(line) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Drift engine stream event on line ${index + 1}: ${message}`);
  }
}

function engineGraphEvidence(
  evidence: Extract<EngineStreamEvent, { event: "graph_evidence_batch" }>["graph_evidence"][number]
): GraphEvidence {
  return {
    ...evidence,
    confidence_kind: evidence.confidence_kind ?? "deterministic",
    extractor: evidence.extractor ?? "drift-engine"
  };
}

function engineNormalizedEntrypoint(
  entrypoint: EngineScanResult["normalized_entrypoints"][number]
): NormalizedEntrypointFact {
  return {
    ...entrypoint,
    schema_version: "drift.normalized_entrypoint.v1"
  };
}

function engineFrameworkAdapter(
  adapter: EngineScanResult["framework_adapters"][number],
  capabilities: FrameworkCapability[]
): FrameworkAdapter {
  return {
    ...adapter,
    schema_version: "drift.framework.adapter.v1",
    capabilities: capabilities.filter((capability) => capability.adapter_id === adapter.adapter_id)
  };
}

function engineFrameworkParserGap(
  gap: EngineScanResult["framework_parser_gaps"][number]
): FrameworkParserGap {
  return {
    ...gap,
    schema_version: "drift.framework.parser_gap.v1"
  };
}

function engineFrameworkCapability(
  capability: EngineScanResult["framework_capabilities"][number]
): FrameworkCapability {
  return {
    ...capability,
    schema_version: "drift.framework.capability.v1"
  };
}

function engineFactRecord(input: ScanDataInput, fact: EngineScanResult["facts"][number]): FactRecord {
  return factRecord(
    { repoId: input.repoId, scanId: input.scanId, filePath: fact.file_path },
    fact.kind,
    fact.name,
    fact.value ?? undefined,
    fact.start_line,
    fact.end_line,
    {
      // EW-6 (DET-1): the engine's real columns, not 1.
      //
      // Hardcoding them made two occurrences on one line identical, and the fact id is built from
      // this span - so the second one silently overwrote the first.
      //
      // A column of 0 means the engine had none to give: either a synthesised relationship fact
      // (`middleware_protects_route` has a line but occupies no position in the file) or a fact
      // reused from a manifest written before columns existed. `SourceSpan` describes a position in
      // source, so it stays 1-based and such facts point at the start of their line - the previous
      // behaviour, kept only where there is genuinely nothing better to say. Those facts have one
      // occurrence per key, so the collapse this fixes cannot apply to them.
      source_span: {
        start_line: fact.start_line,
        start_column: fact.start_column || 1,
        end_line: fact.end_line,
        end_column: fact.end_column || 1
      },
      ast_node_kind: null,
      extraction_method: rustExtractionMethodForKind(fact.kind),
      imported_name: fact.imported_name,
      // EW-1: the engine's runtime-use proof must reach storage, because the scan-reuse
      // manifest is built from stored facts. Dropped here, every reused file loses the
      // proof and the engine re-imposes member-level symbol conservatism on it.
      runtime_use: fact.runtime_use ?? undefined,
      extractor_version: "0.1.0",
      parser_version: "0.1.0",
      confidence: rustConfidenceForKind(fact.kind),
      confidence_label: rustConfidenceLabelForKind(fact.kind),
      evidence_level: rustEvidenceLevelForKind(fact.kind),
      resolution_status: "resolved",
      staleness_status: "fresh",
      last_seen_scan_id: input.scanId
    }
  );
}

function rustExtractionMethodForKind(kind: FactRecord["kind"]): string {
  if (kind === "file_detected") {
    return "rust_filesystem_scanner";
  }
  if (kind === "file_role_detected") {
    return "rust_path_role_classifier";
  }
  if (kind === "route_declared") {
    return "next_app_router_parser";
  }
  return "rust_typescript_parser";
}

function rustEvidenceLevelForKind(kind: FactRecord["kind"]): FactRecord["evidence_level"] {
  if (kind === "file_detected" || kind === "file_role_detected") {
    return "path";
  }
  return "ast";
}

function rustConfidenceForKind(kind: FactRecord["kind"]): number {
  if (kind === "file_role_detected") {
    return 0.9;
  }
  return 1;
}

function rustConfidenceLabelForKind(kind: FactRecord["kind"]): FactRecord["confidence_label"] {
  if (kind === "file_role_detected") {
    return "high";
  }
  return "certain";
}

function engineFileSnapshot(
  input: ScanDataInput,
  file: EngineScanResult["file_snapshots"][number]
): FileSnapshot {
  return {
    repo_id: input.repoId,
    scan_id: input.scanId,
    file_path: file.file_path,
    content_hash: file.content_hash,
    byte_size: file.byte_size,
    indexed: file.indexed
  };
}

function sortedSnapshotFiles(files: EngineScanResult["file_snapshots"]): string[] {
  return files.map((file) => file.file_path).sort();
}
