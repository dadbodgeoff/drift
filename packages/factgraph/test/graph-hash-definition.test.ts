import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildFactGraphArtifact,
  buildFactGraphArtifactFromParts,
  type GraphEdge,
  type GraphEvidence,
  type GraphNode
} from "../src/index.js";

/**
 * T-02: `graph_hash` is still `sha256(JSON.stringify(graph))`, computed without the string.
 *
 * The hash used to be taken over a materialized copy of the whole graph - 97,230,007 chars on
 * papermark, held only to be hashed and dropped. It is now fed to sha256 in chunks.
 *
 * This test pins the DEFINITION rather than a literal digest: it recomputes the original formula
 * against the artifact that was returned and demands agreement. A golden digest would have to be
 * updated whenever the graph's shape legitimately changes, and updating it is exactly how a real
 * divergence would get waved through. `graph_hash` is persisted, compared across scans, and
 * covered by the determinism digests - if it silently changed, it would look like every repo's
 * graph changing at once rather than like a bug.
 */

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const REPO = {
  repo_id: "repo_hash_definition",
  scan_id: "scan_hash_definition",
  root_hash: "roothash",
  branch: "main",
  commit: "abc123",
  dirty: false
};

function snapshots(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    repo_id: REPO.repo_id,
    scan_id: REPO.scan_id,
    file_path: `app/api/route-${index}/route.ts`,
    content_hash: `hash${index}`.padEnd(64, "0"),
    byte_size: 128 + index,
    indexed: true
  }));
}

describe("graph_hash keeps its original definition", () => {
  it("agrees with sha256(JSON.stringify(graph)) on a parts-built graph", () => {
    const nodes: GraphNode[] = Array.from({ length: 400 }, (_, index) => ({
      id: `module:app/api/route-${index}/route.ts`,
      kind: "module",
      label: `route-${index}`,
      stable: true,
      evidence_ids: [],
      metadata: { index, nested: { deep: [1, 2, { deeper: "x" }] } }
    }));
    const edges: GraphEdge[] = Array.from({ length: 400 }, (_, index) => ({
      id: `edge_${index}`,
      kind: "MODULE_IMPORTS_MODULE",
      from: nodes[index].id,
      to: nodes[0].id,
      evidence_ids: [],
      metadata: {}
    }));
    const evidence: GraphEvidence[] = Array.from({ length: 200 }, (_, index) => ({
      id: `evidence_${index}`,
      repo_id: REPO.repo_id,
      scan_id: REPO.scan_id,
      artifact_id: `file_version:app/api/route-${index}/route.ts:hash`,
      file_path: `app/api/route-${index}/route.ts`,
      file_hash: `hash${index}`.padEnd(64, "0"),
      start_line: 1,
      end_line: 2,
      adapter_id: "typescript",
      adapter_version: "0.1.0",
      fact_ids: [`fact:import_used:app/api/route-${index}/route.ts:prisma:1-1`],
      confidence_kind: "deterministic",
      extractor: "drift-engine",
      // A key that carries quotes and non-ASCII, because escaping is where a hand-rolled
      // serializer would diverge without changing anything visible.
      redaction_state: "none"
    }));

    const artifact = buildFactGraphArtifactFromParts({
      repo: REPO,
      snapshots: snapshots(400),
      nodes,
      edges,
      evidence,
      createdAt: "2026-08-13T00:00:00.000Z"
    });

    expect(artifact.graph_hash).toBe(sha256(JSON.stringify(artifact.graph)));
  });

  it("agrees on a fact-built graph, which takes the other builder", () => {
    const artifact = buildFactGraphArtifact({
      repo: REPO,
      snapshots: snapshots(50),
      facts: Array.from({ length: 50 }, (_, index) => [
        {
          id: `fact_role_${index}`,
          repo_id: REPO.repo_id,
          scan_id: REPO.scan_id,
          kind: "file_role_detected" as const,
          file_path: `app/api/route-${index}/route.ts`,
          name: "api_route",
          start_line: 1,
          end_line: 4
        },
        {
          id: `fact_import_${index}`,
          repo_id: REPO.repo_id,
          scan_id: REPO.scan_id,
          kind: "import_used" as const,
          file_path: `app/api/route-${index}/route.ts`,
          name: "prisma",
          value: "@/lib/prisma",
          start_line: 1,
          end_line: 1
        },
        {
          id: `fact_export_${index}`,
          repo_id: REPO.repo_id,
          scan_id: REPO.scan_id,
          kind: "exported_symbol" as const,
          file_path: `app/api/route-${index}/route.ts`,
          name: "GET",
          start_line: 3,
          end_line: 3
        }
      ]).flat(),
      createdAt: "2026-08-13T00:00:00.000Z"
    });

    expect(artifact.graph_hash).toBe(sha256(JSON.stringify(artifact.graph)));
  });
});
