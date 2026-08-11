import { buildSecurityArchitectureAudit } from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload, ParsedArgs } from "../app/command-types.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { latestIndexedScan } from "../domain/scan-status.js";
import { formatSecurityAuditText } from "../formatters/security-audit.js";

export function securityAudit(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}. Run drift scan --repo-root <path> first.`);
  }
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const proofRuns = storage.listLatestSecurityBoundaryProofRunsForRepo({ repo_id: repoId });
  const fallbackProofs = proofRuns.length === 0 && latestScan
    ? storage.listSecurityBoundaryProofs(repoId, latestScan.id)
    : [];
  const payload = buildSecurityArchitectureAudit({
    repo_id: repoId,
    scan_id: proofRuns[0]?.scan_id ?? latestScan?.id ?? null,
    facts,
    candidates: storage.listConventionCandidates(repoId),
    accepted_conventions: storage.listAcceptedConventions(repoId),
    parser_gaps: latestScan ? storage.listParserGaps(repoId, latestScan.id) : [],
    proofs: proofRuns.length > 0 ? proofRuns.map((run) => run.proof) : fallbackProofs
  });
  return {
    payload: parsed.flags.has("json") ? payload : formatSecurityAuditText(payload)
  };
}
