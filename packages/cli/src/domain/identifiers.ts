import { canonicalRepoContractJson,canonicalScanStateJson,type FileSnapshot,type RepoContract,type ScanManifest } from "@drift/core";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export function repoIdForRoot(repoRoot: string): string {
  return `repo_${hashStable(resolve(repoRoot)).slice(0, 16)}`;
}

export function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contractFingerprint(contract: RepoContract): string {
  return hashStable(canonicalRepoContractJson(contract));
}

export function scanFingerprint(manifest: ScanManifest, snapshots: FileSnapshot[]): string {
  return hashStable(canonicalScanStateJson({ manifest, snapshots }));
}

export function conventionIdForCandidate(candidateId: string): string {
  return candidateId.startsWith("candidate_")
    ? `convention_${candidateId.slice("candidate_".length)}`
    : `convention_${candidateId}`;
}

export function contractIdForRepo(repoId: string): string {
  return repoId.startsWith("repo_") ? `contract_${repoId.slice("repo_".length)}` : `contract_${repoId}`;
}

export function exceptionIdForConvention(conventionId: string, path: string): string {
  return `waiver_${sanitizeAuditId(`${conventionId}_${path}`)}`;
}

export function contractWaiverId(
  repoId: string,
  path: string | undefined,
  symbol: string | undefined,
  importSource: string | undefined
): string {
  return `waiver_${hashStable(`${repoId}:${path ?? ""}:${symbol ?? ""}:${importSource ?? ""}`).slice(0, 16)}`;
}

export function sanitizeAuditId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}
