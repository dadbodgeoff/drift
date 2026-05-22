import {
  ConventionCandidateSchema,
  type ConventionCandidate
} from "@drift/core";
import { parseEngineCandidatesResult } from "@drift/engine-contract";
import type { ScanData } from "./collect-scan-data.js";
import { runRustEngineWithInput } from "./rust-engine.js";

export async function inferConventionCandidatesFromEngine(input: {
  repoId: string;
  scanId: string;
  scanData: ScanData;
  now: string;
}): Promise<ConventionCandidate[]> {
  const result = parseEngineCandidatesResult(JSON.parse(await runRustEngineWithInput(
    ["infer-candidates"],
    JSON.stringify({
      repo: { repo_id: input.repoId },
      graph: {
        graph_nodes: input.scanData.graph_nodes,
        graph_edges: input.scanData.graph_edges,
        graph_evidence: input.scanData.graph_evidence
      },
      scan: {
        scan_id: input.scanId,
        file_snapshots: input.scanData.snapshots.map((snapshot) => ({
          file_path: snapshot.file_path,
          content_hash: snapshot.content_hash,
          byte_size: snapshot.byte_size,
          indexed: snapshot.indexed
        })),
        facts: input.scanData.facts.map((fact) => ({
          kind: fact.kind,
          file_path: fact.file_path,
          name: fact.name,
          value: fact.value,
          start_line: fact.start_line,
          end_line: fact.end_line
        }))
      }
    })
  )));

  return result.candidates.map((candidate) =>
    ConventionCandidateSchema.parse({
      id: candidate.candidate_id,
      repo_id: result.repo_id,
      scan_id: result.scan_id,
      kind: candidate.kind,
      statement: candidate.statement,
      rationale: candidate.rationale,
      scope: candidate.scope,
      matcher: candidate.matcher,
      suggested_severity: candidate.suggested_severity,
      suggested_enforcement_mode: candidate.suggested_enforcement_mode,
      enforcement_capability: candidate.enforcement_capability,
      confidence_label: candidate.confidence_label,
      scoring: candidate.scoring,
      evidence_refs: candidate.evidence_refs,
      counterexample_refs: candidate.counterexample_refs,
      status: "candidate",
      created_at: input.now
    })
  );
}
