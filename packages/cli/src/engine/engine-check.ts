import type { AcceptedConvention,BaselineViolation,FactRecord,FileSnapshot } from "@drift/core";
import type { EngineCheckRequest,EngineCheckResult,EngineDiagnostic } from "@drift/engine-contract";
import type { GraphEdge,GraphEvidence,GraphNode } from "@drift/factgraph";
import { parseEngineCheckResult } from "@drift/engine-contract";
import { gitOutput } from "../io/git.js";
import type { ParsedDiff } from "../check/diff.js";
import { runRustEngineWithInput } from "./rust-engine.js";

export interface EngineCheckInput {
  repoId: string;
  repoRoot: string;
  scanId: string;
  facts: FactRecord[];
  snapshots: FileSnapshot[];
  graphNodes?: GraphNode[];
  graphEdges?: GraphEdge[];
  graphEvidence?: GraphEvidence[];
  graphDiagnostics?: EngineDiagnostic[];
  conventions: AcceptedConvention[];
  baseline: BaselineViolation[];
  diff: ParsedDiff;
  scope: "changed-hunks" | "changed-files" | "full";
}

export async function runEngineCheck(input: EngineCheckInput): Promise<EngineCheckResult> {
  const request = engineCheckRequest(input);
  const output = await runRustEngineWithInput(["check-repo"], JSON.stringify(request));
  return parseEngineCheckResult(JSON.parse(output) as unknown);
}

export function engineCheckRequest(input: EngineCheckInput): EngineCheckRequest {
  return {
    schema_version: "engine.check.request.v1",
    repo: {
      repo_id: input.repoId,
      repo_root: input.repoRoot,
      branch: gitOutput(input.repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: gitOutput(input.repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      dirty: Boolean(gitOutput(input.repoRoot, ["status", "--porcelain"]))
    },
    graph: {
      require_fresh: false,
      graph_nodes: input.graphNodes ?? [],
      graph_edges: input.graphEdges ?? [],
      graph_evidence: input.graphEvidence ?? [],
      graph_diagnostics: input.graphDiagnostics ?? []
    },
    scan: {
      scan_id: input.scanId,
      file_snapshots: input.snapshots.map((snapshot) => ({
        file_path: snapshot.file_path,
        content_hash: snapshot.content_hash,
        byte_size: snapshot.byte_size,
        indexed: snapshot.indexed
      })),
      facts: input.facts.map((fact) => ({
        kind: fact.kind,
        file_path: fact.file_path,
        name: fact.name,
        value: fact.value,
        start_line: fact.start_line,
        end_line: fact.end_line
      }))
    },
    contract: {
      contract_id: input.conventions[0]?.contract_id ?? "contract_unknown",
      contract_schema_version: 1,
      conventions: input.conventions.map((convention) => ({
        id: convention.id,
        rule_id: convention.kind,
        kind: convention.kind,
        matcher: convention.matcher as unknown as Record<string, unknown>,
        severity: convention.severity,
        enforcement_mode: convention.enforcement_mode,
        enforcement_capability: convention.enforcement_capability
      })),
      waivers: [],
      exceptions: []
    },
    baseline: input.baseline.map((entry) => ({
      convention_id: entry.convention_id,
      finding_fingerprint: entry.finding_fingerprint,
      status: entry.status
    })),
    diff: {
      mode: input.scope,
      files: input.diff.files.map((file) => ({
        path: file.path,
        changed_lines: [...file.changedLines].sort((a, b) => a - b)
      })),
      deleted_files: input.diff.deletedFiles
    },
    limits: {
      max_files_seen: 100000,
      max_files_parsed: 100000,
      max_file_bytes: 2_000_000,
      max_facts: 500000,
      max_graph_nodes: Math.max(input.graphNodes?.length ?? 0, 100000),
      max_graph_edges: Math.max(input.graphEdges?.length ?? 0, 100000),
      max_diagnostics: 1000,
      follow_symlinks: false
    }
  };
}
