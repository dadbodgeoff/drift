import { authorizeContextExport } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { optionalRepoRelativeFlag,requiredValue,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { isActiveConvention } from "../check/rule-evaluation.js";
import { baselineSummary } from "../domain/baselines.js";
import { isOpenPreflightFinding } from "../domain/findings.js";
import { graphPreflightContext } from "../domain/graph-preflight.js";
import { preflightGovernance } from "../domain/governance.js";
import { countDeniedFiles,preflightSummary,preparedConvention,relevantFilesForTask,requiredChecksForFiles,riskyAreasForFiles,waiversForFiles } from "../domain/preflight.js";
import { repoContractOrDefault } from "../domain/repo-paths.js";
import { assertFreshScanIfRequired,freshnessRequirement,scanStatusPayload } from "../domain/scan-status.js";
import { formatPrepareText } from "../formatters/preflight.js";

export function prepareTask(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const task = requiredValue(parsed.positional.slice(1).join(" ").trim(), "task");
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
    throw new Error(`Policy denied prepare output: ${policy.reason}`);
  }

  const activeConventions = contract.conventions.filter((convention) =>
    isActiveConvention(convention, now)
  );
  const conventions = activeConventions.map(preparedConvention);
  const findings = storage
    .listFindings(repoId)
    .filter(isOpenPreflightFinding)
    .map((finding) => ({
      id: finding.id,
      convention_id: finding.convention_id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      diff_status: finding.diff_status,
      enforcement_result: finding.enforcement_result
    }));
  const baseline = baselineSummary(storage, repoId);
  const relevantFiles = relevantFilesForTask({
    repoRoot: repo.root_path,
    task,
    contract: { ...contract, conventions: activeConventions },
    targetPath
  });
  const riskyAreas = riskyAreasForFiles(contract, relevantFiles);
  const requiredChecks = requiredChecksForFiles(contract, relevantFiles);
  const waivers = waiversForFiles(contract, relevantFiles, now);
  const scanStatus = scanStatusPayload(storage, repoId);
  const requireFresh = parsed.flags.has("require-fresh");
  assertFreshScanIfRequired(repoId, scanStatus, requireFresh);
  const graphContext = graphPreflightContext({
    storage,
    repoId,
    scanStatus,
    targetPath,
    relevantFiles
  });
  const auditIntegrity = scanStatus.audit_integrity;
  const redactions = {
    denied_globs: contract.context_egress.denied_globs,
    excluded_file_count: countDeniedFiles(repo.root_path, contract.context_egress.denied_globs),
    snippets_included: false
  };
  const payload = {
    repo_id: repoId,
    task,
    target_path: targetPath ?? null,
    generated_at: now,
    policy,
    contract: {
      id: storedContract?.id ?? null,
      schema_version: contract.contract_schema_version,
      updated_at: storedContract?.updated_at ?? null,
      ready: contractReady,
      source: contractReady ? "accepted_contract" : "default_local_policy"
    },
    summary: {
      ...preflightSummary({
      conventions,
      relevantFiles,
      riskyAreas,
      waivers,
      findings,
      requiredChecks,
      safeCommands: contract.safe_commands,
      baseline,
      scanStatus
      }),
      contract_ready: contractReady,
      candidate_count: candidateCount
    },
    conventions,
    audit_integrity: auditIntegrity,
    scan_status: scanStatus,
    freshness_requirement: freshnessRequirement(requireFresh, scanStatus),
    graph_context: graphContext,
    baseline,
    findings,
    relevant_files: relevantFiles,
    risky_areas: riskyAreas,
    waivers,
    required_checks: requiredChecks,
    safe_commands: contract.safe_commands,
    governance: preflightGovernance(),
    redactions,
    next_commands: contractReady
      ? [
        `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`,
        `drift findings list --repo ${repoId} --json`
      ]
      : [
        `drift conventions list --repo ${repoId} --status candidate --json`,
        `drift repo map --repo ${repoId} --json`,
        `drift scan status --repo ${repoId} --json`
      ]
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatPrepareText(payload)
  };
}
