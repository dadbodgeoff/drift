import {
  ConventionCandidateSchema,
  type ConventionCandidate
} from "@drift/core";
import { parseEngineCandidatesResult } from "@drift/engine-contract";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonFileStreamed } from "../io/write-json-stream.js";
import type { ScanData } from "./collect-scan-data.js";
import { runRustEngineWithInput } from "./rust-engine.js";

export async function inferConventionCandidatesFromEngine(input: {
  repoId: string;
  scanId: string;
  scanData: ScanData;
  now: string;
  /**
   * E-6 (D-2): repo-relative paths changed in the working tree relative to HEAD. The
   * engine excludes them from the coverage direction so a dirty scan cannot let the
   * analyzed diff's own violations argue a convention down to warn.
   */
  diffChangedFiles?: string[];
}): Promise<ConventionCandidate[]> {
  const request = {
    repo: { repo_id: input.repoId },
    diff_changed_files: input.diffChangedFiles ?? [],
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
  };

  // T-02: handed to the engine as a file, written in chunks, rather than as one JSON string on
  // stdin. This request carries the whole graph and every fact - 105,024,113 chars on papermark,
  // against a MAX_STRING_LENGTH of 536,870,888 - so building it as a string is what turned repo
  // size into a cliff. The engine's `--request-file` reads the same bytes.
  //
  // The temp file is removed in `finally`: it is a copy of the repo's graph, and leaving those
  // behind in the system temp directory is both a disk leak and more of the user's source
  // structure on disk than they asked for.
  const requestDir = mkdtempSync(join(tmpdir(), "drift-candidates-"));
  const requestPath = join(requestDir, "infer-candidates-request.json");
  let raw: string;
  try {
    writeJsonFileStreamed(requestPath, request);
    raw = await runRustEngineWithInput(["infer-candidates", "--request-file", requestPath]);
  } finally {
    rmSync(requestDir, { recursive: true, force: true });
  }
  const result = parseEngineCandidatesResult(JSON.parse(raw));

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
      requires: candidate.requires,
      suggested_severity: candidate.suggested_severity,
      suggested_enforcement_mode: candidate.suggested_enforcement_mode,
      enforcement_capability: candidate.enforcement_capability,
      confidence_label: candidate.confidence_label,
      scoring: candidate.scoring,
      evidence_refs: candidate.evidence_refs,
      counterexample_refs: candidate.counterexample_refs,
      matcher_fingerprint: candidate.matcher_fingerprint,
      scope_fingerprint: candidate.scope_fingerprint,
      graph_fingerprint: candidate.graph_fingerprint,
      evidence_fingerprint: candidate.evidence_fingerprint,
      required_capabilities: candidate.required_capabilities,
      reason_not_blocking: candidate.reason_not_blocking,
      // CV-1: absent on the engine payload unless a family superseded this candidate.
      superseded_by: candidate.superseded_by,
      status: "candidate",
      created_at: input.now
    })
  );
}
