import { expandApiRouteScopeGlobs,type AcceptedConvention,type ConventionScope,type EnforcementMode,type Finding,type RepoContract,type Severity } from "@drift/core";
import { rankRelevantFiles } from "@drift/query";
import { existsSync } from "node:fs";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { baselineSummary } from "./baselines.js";
import { conformingExemplars,conventionRationale,migrationSentence } from "@drift/core";
import { uniqueSorted,waiverStatus } from "./contract-materialization.js";
import { isOpenPreflightFinding } from "./findings.js";
import { isApiRoutePath,matchesGlob } from "./repo-paths.js";
import { scanStatusPayload } from "./scan-status.js";

export interface PreparedConvention {
  id: string;
  kind: AcceptedConvention["kind"];
  statement: string;
  severity: Severity;
  enforcement_mode: EnforcementMode;
  enforcement_capability: AcceptedConvention["enforcement_capability"];
  scope: AcceptedConvention["scope"];
  matcher: AcceptedConvention["matcher"];
  exceptions: AcceptedConvention["exceptions"];
  agent_instruction: string;
  /**
   * BB-5: files in scope that obey this convention. Never a violator - see
   * `domain/conforming-exemplars.ts` for why that invariant is the item rather than a nicety.
   */
  conforming_examples: Array<{ file_path: string; role: string | null }>;
  /** BB-5: why an empty exemplar list is empty. Never a bare `[]` (the EW-3 shape). */
  conforming_examples_reason: string | null;
  /**
   * BB-5: the AK-8 split. `derivation` is how Drift came to believe the repo holds this convention;
   * `reason` is why the repo holds it, which is what a reader deciding whether to comply needs.
   */
  rationale: { derivation: string; reason: string | null };
  /**
   * BB-5: why the baselined violations around the exemplars are not precedent. Absent when there
   * are none - boilerplate saying "0 are baselined" trains readers to skip the line.
   */
  migration_sentence: string | null;
}

export interface RelevantFile {
  path: string;
  roles: string[];
  reasons: string[];
}

export type PreparedRequiredCheck = RepoContract["required_checks"][number] & {
  matched_files: string[];
};

export type PreparedRiskArea = RepoContract["risky_areas"][number] & {
  matched_files: string[];
};

export type PreparedWaiver = RepoContract["waivers"][number] & {
  status: "active";
  matched_files: string[];
};

export interface WaivedFinding {
  waiver_id: string;
  convention_id: string;
  file_path: string;
  /**
   * Absent for a bindingless side-effect import (S10), which has no symbol to name. The
   * formatters already render `symbol` conditionally, so absence prints as nothing rather
   * than as the engine's internal sentinel.
   */
  symbol?: string;
  import_source: string;
  line: number;
  reason: string;
}

export interface PreflightSummaryInput {
  conventions: PreparedConvention[];
  relevantFiles: RelevantFile[];
  riskyAreas: PreparedRiskArea[];
  waivers: PreparedWaiver[];
  findings: Array<{ enforcement_result: Finding["enforcement_result"] }>;
  requiredChecks: PreparedRequiredCheck[];
  safeCommands: RepoContract["safe_commands"];
  baseline: ReturnType<typeof baselineSummary>;
  scanStatus: ReturnType<typeof scanStatusPayload>;
}

export function preparedConvention(
  convention: AcceptedConvention,
  // BB-5: optional so every existing caller keeps working and gets the empty-with-reason shape
  // rather than a missing field. A packet that silently omits the exemplars is the status quo.
  context: {
    scopeFiles?: string[];
    violatingFiles?: Iterable<string>;
    roleByFile?: Map<string, string>;
    baselineActiveCount?: number;
    targetPath?: string;
  } = {}
): PreparedConvention {
  const exemplars = conformingExemplars({
    scopeFiles: context.scopeFiles ?? [],
    violatingFiles: context.violatingFiles ?? [],
    roleByFile: context.roleByFile,
    referenceFile: context.targetPath
  });
  return {
    id: convention.id,
    kind: convention.kind,
    statement: convention.statement,
    severity: convention.severity,
    enforcement_mode: convention.enforcement_mode,
    enforcement_capability: convention.enforcement_capability,
    scope: convention.scope,
    matcher: convention.matcher,
    exceptions: convention.exceptions,
    agent_instruction: instructionForConvention(convention),
    conforming_examples: exemplars.conforming_examples,
    conforming_examples_reason: exemplars.reason,
    rationale: conventionRationale({
      kind: convention.kind,
      derivation: convention.rationale ?? convention.statement
    }),
    migration_sentence: migrationSentence(context.baselineActiveCount ?? 0)
  };
}

export function instructionForConvention(convention: AcceptedConvention): string {
  if (convention.kind === "api_route_no_direct_data_access") {
    const forbidden = (convention.matcher.forbidden_imports ?? []).join(", ");
    return [
      "When editing API route files, do not import data-access clients directly.",
      forbidden ? `Forbidden imports: ${forbidden}.` : "",
      "Delegate through the repo's accepted service/data-access layer and run drift check before finishing."
    ].filter(Boolean).join(" ");
  }

  if (convention.kind === "api_route_requires_service_delegation") {
    const delegates = (convention.matcher.allowed_delegate_imports ?? []).join(", ");
    return [
      "When editing API route files, keep route modules thin and delegate business/data-access work to the service layer.",
      delegates ? `Observed delegate imports: ${delegates}.` : "",
      "Treat this as briefing guidance unless the repo later upgrades it to a deterministic check."
    ].filter(Boolean).join(" ");
  }

  return `${convention.statement} Follow its scope, matcher, and exceptions.`;
}

export function conventionsForFiles(
  conventions: AcceptedConvention[],
  relevantFiles: RelevantFile[]
): AcceptedConvention[] {
  if (relevantFiles.length === 0) {
    return conventions;
  }
	  return conventions.filter((convention) =>
	    relevantFiles.some((file) =>
	      apiCompatibleGlobs(convention.scope.path_globs).some((glob) => matchesGlob(file.path, glob)) &&
	      !(convention.scope.exclude_path_globs ?? []).some((glob) => matchesGlob(file.path, glob))
	    )
	  );
}

export function findingsForTopic(
  findings: Finding[],
  topic: string,
  relevantFiles: RelevantFile[]
): Finding[] {
  const relevantPaths = new Set(relevantFiles.map((file) => file.path));
  const tokens = tokenizeTask(topic);
  return findings.filter((finding) => {
    if (!isOpenPreflightFinding(finding)) {
      return false;
    }
    if (finding.evidence_refs.some((ref) => relevantPaths.has(ref.file_path))) {
      return true;
    }
    const text = `${finding.title} ${finding.message} ${finding.convention_id}`.toLowerCase();
    return [...tokens].some((token) => text.includes(token));
  });
}

export function askSummary(input: {
  matched_convention_count: number;
  open_finding_count: number;
  relevant_file_count: number;
}): string {
  return [
    `Matched ${input.matched_convention_count} accepted convention${input.matched_convention_count === 1 ? "" : "s"}`,
    `${input.open_finding_count} open finding${input.open_finding_count === 1 ? "" : "s"}`,
    `and ${input.relevant_file_count} relevant file${input.relevant_file_count === 1 ? "" : "s"}.`
  ].join(", ");
}

export function preflightSummary(input: PreflightSummaryInput): {
  convention_count: number;
  relevant_file_count: number;
  risky_area_count: number;
  waiver_count: number;
  finding_count: number;
  blocking_finding_count: number;
  required_check_count: number;
  safe_command_count: number;
  baseline_active_count: number;
  scan_stale: boolean;
} {
  return {
    convention_count: input.conventions.length,
    relevant_file_count: input.relevantFiles.length,
    risky_area_count: input.riskyAreas.length,
    waiver_count: input.waivers.length,
    finding_count: input.findings.length,
    blocking_finding_count: input.findings.filter((finding) =>
      finding.enforcement_result === "block"
    ).length,
    required_check_count: input.requiredChecks.length,
    safe_command_count: input.safeCommands.length,
    baseline_active_count: input.baseline.active_count,
    scan_stale: input.scanStatus.stale
  };
}

export function relevantFilesForTask(input: {
  repoRoot: string;
  task: string;
  contract: RepoContract;
  targetPath?: string;
}): RelevantFile[] {
  if (!existsSync(input.repoRoot)) {
    return input.targetPath
      ? [relevantFileForPath(input.targetPath, tokenizeTask(input.task), input.contract, "requested path")].filter(
          (file): file is RelevantFile => Boolean(file)
        )
      : [];
  }

  const tokens = tokenizeTask(input.task);
  const deniedGlobs = input.contract.context_egress.denied_globs;
  const files = walkIndexableFiles(input.repoRoot)
    .filter((filePath) => !deniedGlobs.some((glob) => matchesGlob(filePath, glob)))
    .map((filePath) => relevantFileForPath(filePath, tokens, input.contract))
    .filter((file): file is RelevantFile => Boolean(file));
  if (
    input.targetPath &&
    !deniedGlobs.some((glob) => matchesGlob(input.targetPath!, glob)) &&
    !files.some((file) => file.path === input.targetPath)
  ) {
    const targetFile = relevantFileForPath(input.targetPath, tokens, input.contract, "requested path");
    if (targetFile) {
      files.unshift(targetFile);
    }
  } else if (input.targetPath) {
    const existing = files.find((file) => file.path === input.targetPath);
    if (existing && !existing.reasons.includes("requested path")) {
      existing.reasons = uniqueSorted([...existing.reasons, "requested path"]);
    }
  }

  // Rank before truncating.
  //
  // This previously returned `files.slice(0, 25)` in filesystem-walk order, so the cap was
  // exhausted by whichever files happened to sort first - and "in scope for this convention"
  // matches every API route in the repository, so it always had thousands of candidates.
  //
  // Measured on dub with "add an endpoint that lists workspace invites": 24 of the 25 returned
  // files were arbitrary routes matched only by convention scope, none matched "invite", and
  // apps/web/app/api/workspaces/[idOrSlug]/invites/route.ts - the one file someone doing that
  // task must see - never appeared, because the walk reached app/(ee)/api/admin/* first. The
  // context claim rests on this function, so ordering it by relevance is the whole point.
  return rankRelevantFiles(files);
}


export function relevantFileForPath(
  filePath: string,
  tokens: Set<string>,
  contract: RepoContract,
  forcedReason?: string
): RelevantFile | undefined {
  const reasons = new Set<string>();
  const roles = new Set<string>();
  if (forcedReason) {
    reasons.add(forcedReason);
  }
  if (isApiRoutePath(filePath)) {
    roles.add("api_route");
  }

  for (const token of tokens) {
    if (filePath.toLowerCase().includes(token)) {
      reasons.add(`task token: ${token}`);
    }
  }

  for (const convention of contract.conventions) {
    const inScope = apiCompatibleGlobs(convention.scope.path_globs).some((glob) => matchesGlob(filePath, glob));
    if (inScope) {
      reasons.add(`in scope for ${convention.id}`);
      for (const role of convention.scope.file_roles ?? []) {
        roles.add(role);
      }
    }
  }

  if (reasons.size === 0) {
    return undefined;
  }

  return {
    path: filePath,
    roles: [...roles].sort(),
    reasons: [...reasons].sort()
  };
}

export function riskyAreasForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[]
): PreparedRiskArea[] {
  return contract.risky_areas.flatMap((area) => {
    const pathGlobs = apiCompatibleGlobs(area.path_globs);
    const matchedFiles = relevantFiles
      .filter((file) => pathGlobs.some((glob) => matchesGlob(file.path, glob)))
      .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...area, matched_files: matchedFiles }] : [];
  });
}

export function waiversForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[],
  now: string
): PreparedWaiver[] {
  return contract.waivers.flatMap((waiver) => {
    if (waiverStatus(waiver, now) !== "active") {
      return [];
    }
    const pathGlobs = waiver.path_globs ?? [];
    const matchedFiles = pathGlobs.length === 0
      ? relevantFiles.map((file) => file.path)
      : relevantFiles
          .filter((file) => pathGlobs.some((glob) => matchesGlob(file.path, glob)))
          .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...waiver, status: "active", matched_files: matchedFiles }] : [];
  });
}

export function requiredChecksForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[]
): PreparedRequiredCheck[] {
  return allRequiredChecks(contract).flatMap((check) => {
    const matchedFiles = relevantFiles
      .filter((file) => requiredCheckMatchesFile(check, file.path, file.roles))
      .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...check, matched_files: matchedFiles }] : [];
  });
}

export function requiredChecksForPath(
  contract: RepoContract,
  filePath: string
): PreparedRequiredCheck[] {
  const roles = rolesForPath(filePath);
  return allRequiredChecks(contract).flatMap((check) =>
    requiredCheckMatchesFile(check, filePath, roles)
      ? [{ ...check, matched_files: [filePath] }]
      : []
  );
}

export function allRequiredChecks(contract: RepoContract): RepoContract["required_checks"] {
  return [
    ...contract.required_checks,
    ...(contract.agent_contracts ?? []).flatMap((agentContract) => {
      if (agentContract.kind !== "required_change_checks") {
        return [];
      }
      return agentContract.rules.flatMap((rule) =>
        rule.required_checks.map((check) => ({
          command: check.command,
          applies_to: {
            path_globs: rule.applies_to.path_globs ?? [],
            file_roles: rule.applies_to.file_roles ?? []
          },
          reason: check.reason,
          source: "contract" as const
        }))
      );
    })
  ];
}

export function requiredCheckMatchesFile(
  check: RepoContract["required_checks"][number],
  filePath: string,
  roles: string[]
): boolean {
  return scopeMatchesFile(check.applies_to, filePath, roles);
}

export function scopeMatchesFile(scope: ConventionScope, filePath: string, roles: string[]): boolean {
  if ((scope.exclude_path_globs ?? []).some((glob) => matchesGlob(filePath, glob))) {
    return false;
  }
  const pathGlobs = apiCompatibleGlobs(scope.path_globs);
  const pathMatches = pathGlobs.length === 0 ||
    pathGlobs.some((glob) => matchesGlob(filePath, glob));
  const roleMatches = !scope.file_roles?.length ||
    scope.file_roles.some((role) => roles.includes(role));
  return pathMatches && roleMatches;
}

export function rolesForPath(filePath: string): string[] {
  return isApiRoutePath(filePath) ? ["api_route"] : [];
}

function apiCompatibleGlobs(globs: string[]): string[] {
  return expandApiRouteScopeGlobs(globs);
}

export function tokenizeTask(task: string): Set<string> {
  return new Set(
    task
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

export function countDeniedFiles(repoRoot: string, deniedGlobs: string[]): number {
  if (deniedGlobs.length === 0 || !existsSync(repoRoot)) {
    return 0;
  }
  return walkIndexableFiles(repoRoot).filter((filePath) =>
    deniedGlobs.some((glob) => matchesGlob(filePath, glob))
  ).length;
}
