import { canonicalRepoContractJson,canonicalScanStateJson,type FileSnapshot,type RepoContract,type ScanManifest } from "@drift/core";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

export function repoIdForRoot(repoRoot: string): string {
  return `repo_${hashStable(resolve(repoRoot)).slice(0, 16)}`;
}

export function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let checkInvocationCounter = 0;

/**
 * Ids for one `drift check` invocation: the check_runs row id and its ephemeral check-scan id.
 *
 * F-4 (R-2): these were hashStable(repoId:scope:now) at millisecond resolution, and
 * upsertCheckRun does ON CONFLICT(id) DO UPDATE - so concurrent checks landing in the same
 * millisecond merged into one check_runs row (verified: 3 same-ms checks -> 1 row, last writer
 * overwriting the others' audit trail). Each invocation now folds a collision-avoidance nonce
 * into the hash: pid separates concurrent processes, a monotonic per-process counter separates
 * calls within a process, and random bytes cover pid reuse. Nothing in the codebase relies on
 * checkId being reproducible from (repoId, scope, now) - tests read the id from the payload and
 * the eval baselines pin no ids - so the nonce costs no determinism anyone consumes.
 */
export function checkRunIdsFor(repoId: string, scope: string, now: string): {
  checkId: string;
  checkScanId: string;
} {
  checkInvocationCounter += 1;
  const nonce = `${process.pid}:${checkInvocationCounter}:${randomBytes(4).toString("hex")}`;
  return {
    checkId: `check_${hashStable(`${repoId}:${scope}:${now}:${nonce}`).slice(0, 16)}`,
    checkScanId: `scan_check_${hashStable(`${repoId}:${now}:${nonce}`).slice(0, 16)}`
  };
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
