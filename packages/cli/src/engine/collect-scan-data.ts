import type { FactRecord,FileSnapshot } from "@drift/core";
import type { EngineDiagnostic,EngineScanResult,EngineStats,EngineStreamEvent } from "@drift/engine-contract";
import type { GraphEdge,GraphEvidence,GraphNode } from "@drift/factgraph";
import { parseEngineScanResult,parseEngineStreamEvent } from "@drift/engine-contract";
import { extractFactsFromFile,factRecord,fileSnapshotForFile } from "./fact-extraction.js";
import { streamRustEngineLines } from "./rust-engine.js";
import { walkIndexableFiles } from "./ts-fallback-scanner.js";

export interface ScanData {
  files: string[];
  facts: FactRecord[];
  snapshots: FileSnapshot[];
  engineSource: "rust" | "typescript";
  stats?: EngineStats;
  diagnostics: EngineDiagnostic[];
  graph_nodes: GraphNode[];
  graph_edges: GraphEdge[];
  graph_evidence: GraphEvidence[];
  graph_diagnostics: EngineDiagnostic[];
}

interface ScanDataInput {
  repoId: string;
  scanId: string;
  repoRoot: string;
}

export async function collectScanData(input: ScanDataInput): Promise<ScanData> {
  try {
    return await collectScanDataFromRust(input);
  } catch (error) {
    if (process.env.DRIFT_ALLOW_TYPESCRIPT_ENGINE_FALLBACK !== "1") {
      throw error;
    }
  }

  const files = walkIndexableFiles(input.repoRoot);
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
    diagnostics: [],
    graph_nodes: [],
    graph_edges: [],
    graph_evidence: [],
    graph_diagnostics: [],
    stats: {
      files_seen: files.length,
      files_skipped: 0,
      files_parsed: files.length,
      facts_emitted: 0,
      graph_nodes: 0,
      graph_edges: 0,
      diagnostics_emitted: 0,
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
    input.scanId
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
    diagnostics: parsed.diagnostics,
    graph_nodes: [],
    graph_edges: [],
    graph_evidence: [],
    graph_diagnostics: [],
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
  let stats: EngineStats | undefined;
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
        graphEvidence.push(...event.graph_evidence);
        break;
      case "scan_completed":
        completed = true;
        stats = event.stats;
        break;
      case "diagnostic_batch":
        diagnostics.push(...event.diagnostics);
        break;
      case "scan_started":
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
    diagnostics,
    graph_nodes: graphNodes,
    graph_edges: graphEdges,
    graph_evidence: graphEvidence,
    graph_diagnostics: diagnostics,
    stats
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

function engineFactRecord(input: ScanDataInput, fact: EngineScanResult["facts"][number]): FactRecord {
  return factRecord(
    { repoId: input.repoId, scanId: input.scanId, filePath: fact.file_path },
    fact.kind,
    fact.name,
    fact.value ?? undefined,
    fact.start_line,
    fact.end_line
  );
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
