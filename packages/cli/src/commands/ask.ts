import { authorizeContextExport } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { optionalRepoRelativeFlag,requiredValue,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { isActiveConvention } from "../check/rule-evaluation.js";
import { preflightGovernance } from "../domain/governance.js";
import { askSummary,conventionsForFiles,findingsForTopic,preparedConvention,relevantFilesForTask } from "../domain/preflight.js";
import { requiredRepoContract } from "../domain/repo-paths.js";
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
  const contract = requiredRepoContract(storage, repoId);
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
    scan_stale: scanStatus.stale
  };
  const payload = {
    repo_id: repoId,
    topic,
    target_path: targetPath ?? null,
    generated_at: now,
    answer: {
      source: "deterministic_local_state",
      summary: askSummary(summary)
    },
    policy,
    governance: preflightGovernance(),
    summary,
    scan_status: scanStatus,
    freshness_requirement: freshnessRequirement(requireFresh, scanStatus),
    conventions,
    findings,
    relevant_files: relevantFiles,
    redactions: {
      denied_globs: contract.context_egress.denied_globs,
      snippets_included: false
    },
    next_commands: [
      targetPath
        ? `drift prepare "${topic}" --repo ${repoId} --path ${targetPath} --json`
        : `drift prepare "${topic}" --repo ${repoId} --json`,
      `drift check --repo ${repoId} --diff main...HEAD --scope changed-hunks --json`
    ]
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatAskText(payload)
  };
}
