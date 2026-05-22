import type { FactRecord, FileSnapshot } from "@drift/core";
import {
  type FactGraphArtifact,
  buildFactGraphArtifact as buildFactGraphArtifactFromFacts
} from "@drift/factgraph";

export function buildFactGraphArtifact(input: {
  repoId: string;
  scanId: string;
  snapshots: FileSnapshot[];
  facts: FactRecord[];
  createdAt: string;
  pathAliases?: Record<string, string[]>;
  repo?: {
    root_hash: string;
    branch: string;
    commit: string;
    dirty: boolean;
  };
}): FactGraphArtifact {
  return buildFactGraphArtifactFromFacts({
    repo: {
      repo_id: input.repoId,
      scan_id: input.scanId,
      root_hash: input.repo?.root_hash ?? "unknown",
      branch: input.repo?.branch ?? "unknown",
      commit: input.repo?.commit ?? "unknown",
      dirty: input.repo?.dirty ?? false
    },
    snapshots: input.snapshots,
    facts: input.facts,
    createdAt: input.createdAt,
    pathAliases: input.pathAliases
  });
}
