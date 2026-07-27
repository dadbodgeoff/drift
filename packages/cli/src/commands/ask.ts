import { authorizeContextExport } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { optionalRepoRelativeFlag,requiredValue,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { isActiveConvention } from "../check/rule-evaluation.js";
import { agentEnvelopeForScan } from "../domain/agent-envelope.js";
import { preflightGovernance } from "../domain/governance.js";
import { askSummary,conventionsForFiles,findingsForTopic,preparedConvention,relevantFilesForTask } from "../domain/preflight.js";
import { repoContractOrDefault } from "../domain/repo-paths.js";
import { assertFreshScanIfRequired,freshnessRequirement,scanStatusPayload } from "../domain/scan-status.js";
import { formatAskText } from "../formatters/preflight.js";

export function askRepo(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const topic = requiredValue(parsed.positional.slice(1).join(" ").trim(), "topic");
  const targetPath = optionalRepoRelativeFlag(parsed, "path");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const storedContract = storage.getRepoContract(repoId);
  const contract = storedContract ?? repoContractOrDefault(storage, repoId);
  const contractReady = Boolean(storedContract);
  const candidateCount = storage.listConventionCandidates(repoId, { status: "candidate" }).length;
  const policy = authorizeContextExport(contract, "cli-preflight");
  if (!policy.allowed) {
    throw new Error(`Policy denied ask output: ${policy.reason}`);
  }

  const activeConventions = contract.conventions.filter((convention) =>
    isActiveConvention(convention, now)
  );
  const relevantFiles = relevantFilesForTask({
    repoRoot: repo.root_path,
    task: topic,
    contract: { ...contract, conventions: activeConventions },
    targetPath
  });
  const conventions = conventionsForFiles(activeConventions, relevantFiles).map(preparedConvention);
  const findings = findingsForTopic(storage.listFindings(repoId), topic, relevantFiles)
    .map((finding) => ({
      id: finding.id,
      convention_id: finding.convention_id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      diff_status: finding.diff_status,
      enforcement_result: finding.enforcement_result,
      first_evidence: finding.evidence_refs[0]
        ? {
            file_path: finding.evidence_refs[0].file_path,
            start_line: finding.evidence_refs[0].start_line,
            import_source: finding.evidence_refs[0].import_source,
            symbol: finding.evidence_refs[0].symbol
          }
        : null
    }));
  const scanStatus = scanStatusPayload(storage, repoId);
  const requireFresh = parsed.flags.has("require-fresh");
  assertFreshScanIfRequired(repoId, scanStatus, requireFresh);
  const summary = {
    matched_convention_count: conventions.length,
    open_finding_count: findings.length,
    relevant_file_count: relevantFiles.length,
    scan_stale: scanStatus.stale,
    contract_ready: contractReady,
    candidate_count: candidateCount
  };
  const payload = {
    repo_id: repoId,
    topic,
    target_path: targetPath ?? null,
    generated_at: now,
    agent_envelope: agentEnvelopeForScan({
      surface: "cli-preflight",
      policy,
      scanStatus,
      requireFresh
    }),
    answer: {
      source: "deterministic_local_state",
      summary: contractReady
        ? askSummary(summary)
        : [
          `Matched ${conventions.length} accepted convention${conventions.length === 1 ? "" : "s"}`,
          `${findings.length} open finding${findings.length === 1 ? "" : "s"}`,
          `${relevantFiles.length} relevant file${relevantFiles.length === 1 ? "" : "s"}`,
          `and ${candidateCount} candidate convention${candidateCount === 1 ? "" : "s"} awaiting review.`
        ].join(", ")
    },
    policy,
    governance: preflightGovernance(),
    contract: {
      id: storedContract?.id ?? null,
      schema_version: contract.contract_schema_version,
      updated_at: storedContract?.updated_at ?? null,
      ready: contractReady,
      source: contractReady ? "accepted_contract" : "default_local_policy"
    },
    summary,
    scan_status: scanStatus,
    freshness_requirement: freshnessRequirement(requireFresh, scanStatus),
    conventions,
    findings,
    relevant_files: relevantFiles,
    redactions: {
      denied_globs: contract.context_egress.denied_globs,
      snippets_included: false,
      source_content_included: false,
      context_truncated: false
    },
    next_commands: contractReady
      ? [
        targetPath
          ? `drift prepare "${topic}" --repo ${repoId} --path ${targetPath} --json`
          : `drift prepare "${topic}" --repo ${repoId} --json`,
        `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`
      ]
      : [
        `drift conventions list --repo ${repoId} --status candidate --json`,
        targetPath
          ? `drift prepare "${topic}" --repo ${repoId} --path ${targetPath} --json`
          : `drift prepare "${topic}" --repo ${repoId} --json`,
        `drift repo map --repo ${repoId} --json`
      ]
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatAskText(payload)
  };
}
