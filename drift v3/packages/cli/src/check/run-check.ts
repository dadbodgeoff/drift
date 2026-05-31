import {
  SecurityBoundaryProofSchema,
  authorizeContextExport,
  type CanonicalHelperReuseAgentContract,
  type CheckRun,
  type FactRecord,
  type FileRole,
  type Finding,
  type MachineContractVersions,
  type RequiredCheckExecution,
  type RepoContract,
  type SecurityBoundaryProof
} from "@drift/core";
import { buildEntrypointFlowProof,buildReadiness, scoreHelperSimilarity } from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { isClosedFindingStatus,preservedGovernanceStatus,reviewFinding } from "../domain/findings.js";
import { auditEvent,preflightGovernance } from "../domain/governance.js";
import { contractFingerprint,hashStable } from "../domain/identifiers.js";
import { WaivedFinding } from "../domain/preflight.js";
import { isApiRoutePath,matchesGlob } from "../domain/repo-paths.js";
import { parserGapsFromDiagnostics } from "../domain/scan-status.js";
import { currentMachineContractVersions } from "../domain/versions.js";
import { collectScanData,type ScanData } from "../engine/collect-scan-data.js";
import { runEngineCheck } from "../engine/engine-check.js";
import { extractImports,importFactsForFile } from "../engine/fact-extraction.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { formatCheckText } from "../formatters/checks.js";
import { fileContentHash } from "../io/file-hash.js";
import { diffStatusFor,filesForConvention,fullRepoDiff,loadDiff,parseUnifiedDiff } from "./diff.js";
import {
  agentContractFindingFingerprint,
  canonicalHelperReuseFindingFingerprint,
  findingFingerprint
} from "./finding-fingerprint.js";
import { enforcementResultFor,isActiveConvention,isForbiddenImport } from "./rule-evaluation.js";
import { findContractWaiverForImport,isExceptedImport,isExceptedPath,waiverRequiresReapproval } from "./waivers.js";

export async function runCheck(storage: SqliteDriftStorage, parsed: ParsedArgs): Promise<CommandPayload> {
  const repoId = resolveRepoId(parsed);
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }
  const policy = authorizeContextExport(contract, "cli-check");
  if (!policy.allowed) {
    throw new Error(`Policy denied check output: ${policy.reason}`);
  }

  const scope = stringFlag(parsed, "scope") ?? "changed-hunks";
  if (!["changed-hunks", "changed-files", "full"].includes(scope)) {
    throw new Error("--scope must be changed-hunks, changed-files, or full.");
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const checkId = `check_${hashStable(`${repoId}:${scope}:${now}`).slice(0, 16)}`;
  const checkScanId = `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`;
  const contractFingerprintValue = contractFingerprint(contract);
  const machineContractVersions = currentMachineContractVersions();
  const rawDiff = scope === "full" ? null : loadDiff(repo.root_path, parsed);
  const parsedDiff = scope === "full"
    ? fullRepoDiff(repo.root_path)
    : parseUnifiedDiff(rawDiff ?? "");
  const diffHash = rawDiff ? hashStable(rawDiff) : "full_scope";
  const baseline = storage.listBaselineViolations(repoId);
  const existingFindings = new Map(
    storage.listFindings(repoId).map((finding) => [finding.fingerprint, finding])
  );
  const expiredFindingsCount = expireFindingsForExpiredConventions(storage, parsed, repoId, contract, now);
  const checkData = await collectScanData({
    repoId,
    scanId: checkScanId,
    repoRoot: repo.root_path
  });
  const snapshotsByPath = new Map(checkData.snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  if (checkData.fallbackStatus.fallback_used) {
    const fallbackStatus = fallbackStatusForCheck(checkData);
    const capabilityCompleteness = capabilityCompletenessForCheck(checkData);
    const readiness = readinessForCheck({
      repoId,
      checkScanId,
      checkData,
      capabilityCompleteness,
      now
    });
    const check = checkEnvelope({
      checkId,
      repoId,
      contract,
      contractFingerprintValue,
      checkScanId,
      scope,
      status: "blocked",
      fallbackStatus,
      capabilityCompleteness,
      machineContractVersions
    });
    storage.upsertCheckRun({
      id: checkId,
      repo_id: repoId,
      repo_contract_id: contract.id,
      contract_fingerprint: contractFingerprintValue,
      scan_id: checkScanId,
      status: "blocked",
      scope: scope as "changed-hunks" | "changed-files" | "full",
      engine_source: checkData.engineSource,
      fallback_used: true,
      stale_scan: false,
      capability_complete: false,
      findings_count: 0,
      blocking_count: 0,
      machine_contract_versions: machineContractVersions,
      started_at: now,
      completed_at: now
    });
    const payload = {
      response_schema: "drift.check.result.v1",
      check,
      readiness,
      machine_contract_versions: machineContractVersions,
      policy,
      governance: preflightGovernance(),
      audit_integrity: storage.verifyAuditChain(repoId),
      summary: {
        repo_id: repoId,
        scope,
        findings_count: 0,
        blocking_count: 0,
        waived_findings_count: 0,
        expired_findings_count: expiredFindingsCount,
        skipped_deleted_files: parsedDiff.deletedFiles,
        engine_source: checkData.engineSource,
        affected_scope: affectedScopeSummary(parsedDiff, scope),
        outcome: checkOutcomeSummary([], {
          waivedFindingsCount: 0,
          expiredFindingsCount,
          scope: scope as "changed-hunks" | "changed-files" | "full"
        }),
        blocked_reasons: ["typescript_fallback_used"]
      },
      review_items: [],
      waived_findings: [],
      diagnostics: checkData.diagnostics,
      security_boundary_proofs: [],
      next_commands: [
        "drift doctor --json",
        `drift scan status --repo ${repoId} --json`
      ],
      findings: []
    };
    return {
      exitCode: 1,
      payload: parsed.flags.has("json") ? payload : formatCheckText(payload)
    };
  }
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  const securityBoundaryProofs: SecurityBoundaryProof[] = [];
  let waivedFindingsCount = 0;

  const engineOwned = await runEngineOwnedDirectDataAccessCheck({
    repoId,
    repoRoot: repo.root_path,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId,
    contractFingerprintValue,
    diffHash
  });

  if (engineOwned) {
    findings.push(...engineOwned.findings);
    waivedFindings.push(...engineOwned.waivedFindings);
    waivedFindingsCount = engineOwned.waivedFindingsCount;
    for (const finding of findings) {
      storage.upsertFinding(finding);
    }
  } else {
    for (const convention of contract.conventions) {
    if (
      convention.kind !== "api_route_no_direct_data_access" ||
      convention.enforcement_mode === "off" ||
      convention.enforcement_capability !== "deterministic_check" ||
      !isActiveConvention(convention, now)
    ) {
      continue;
    }

    const files = filesForConvention(parsedDiff, convention, scope);
    for (const filePath of files) {
      if (!isApiRoutePath(filePath) || isExceptedPath(filePath, convention, now)) {
        continue;
      }

      for (const importUsed of importFactsForFile(checkData.facts, filePath)) {
        if (!isForbiddenImport(importUsed.value, convention.matcher.forbidden_imports ?? [])) {
          continue;
        }
        if (isExceptedImport(
          filePath,
          importUsed.name,
          importUsed.value,
          convention,
          now,
          exceptionContextForImport(checkData, filePath, importUsed)
        )) {
          continue;
        }
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.value, contract, now);
        if (waiver) {
          const staleWaiver = waiverRequiresReapproval(
            waiver,
            filePath,
            snapshotsByPath.get(filePath)?.content_hash
          );
          if (staleWaiver) {
            findings.push(waiverReapprovalFinding({
              repoId,
              repoContractId: contract.id,
              conventionId: convention.id,
              checkId,
              scanId: checkData.snapshots[0]?.scan_id ?? checkScanId,
              filePath,
              line: importUsed.start_line,
              symbol: importUsed.name,
              importSource: importUsed.value,
              fileHash: snapshotsByPath.get(filePath)?.content_hash ?? "",
              waiverId: waiver.id,
              now
            }));
          } else {
          waivedFindingsCount += 1;
          waivedFindings.push({
            waiver_id: waiver.id,
            convention_id: convention.id,
            file_path: filePath,
            symbol: importUsed.name,
            import_source: importUsed.value,
            line: importUsed.start_line,
            reason: waiver.reason
          });
          continue;
          }
        }

        const diffStatus = diffStatusFor(filePath, importUsed.start_line, parsedDiff, scope);
        const fingerprint = findingFingerprint(
          convention.id,
          filePath,
          importUsed.name,
          importUsed.value
        );
        const status = baseline.some((entry) =>
          entry.status === "active" &&
          entry.convention_id === convention.id &&
          entry.finding_fingerprint === fingerprint
        ) ? "pre_existing" : preservedGovernanceStatus(existingFindings.get(fingerprint)) ?? "new";
        const snapshot = snapshotsByPath.get(filePath);
        const finding: Finding = {
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: repoId,
          convention_id: convention.id,
          check_id: checkId,
          repo_contract_id: contract.id,
          fingerprint,
          title: "API route imports data access directly",
          message: `${filePath} imports ${importUsed.name} from ${importUsed.value} directly; route modules should delegate through the accepted service/data-access layer.`,
          severity: convention.severity,
          enforcement_result: enforcementResultFor(convention.enforcement_mode),
          status,
          diff_status: diffStatus,
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: filePath,
            start_line: importUsed.start_line,
            end_line: importUsed.start_line,
            symbol: importUsed.name,
            import_source: importUsed.value,
            fact_ids: importUsed.fact_id ? [importUsed.fact_id] : [],
            scan_id: checkData.snapshots[0]?.scan_id ?? checkScanId,
            file_hash: snapshot?.content_hash ?? "",
            redaction_state: "none"
          }],
          expected_layer: "service",
          actual_layer: "data_access",
          graph_path: [filePath, importUsed.value],
          suggested_fix: directDataAccessSuggestedFix(),
          related_node_ids: [],
          created_at: now
        };
        storage.upsertFinding(finding);
        findings.push(finding);
      }
    }
  }
  }

  const engineOwnedAuth = await runEngineOwnedAuthCheck({
    repoId,
    repoRoot: repo.root_path,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...engineOwnedAuth.findings);
  waivedFindings.push(...engineOwnedAuth.waivedFindings);
  waivedFindingsCount += engineOwnedAuth.waivedFindingsCount;
  securityBoundaryProofs.push(...engineOwnedAuth.securityBoundaryProofs);
  for (const finding of engineOwnedAuth.findings) {
    storage.upsertFinding(finding);
  }

  const helperReuseFindings = runCanonicalHelperReuseCheck({
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId,
    contractFingerprintValue,
    diffHash
  });
  findings.push(...helperReuseFindings);
  for (const finding of helperReuseFindings) {
    storage.upsertFinding(finding);
  }
  const modulePlacementFindings = runModulePlacementCheck({
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...modulePlacementFindings);
  for (const finding of modulePlacementFindings) {
    storage.upsertFinding(finding);
  }
  const importBoundaryFindings = runImportBoundaryCheck({
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...importBoundaryFindings);
  for (const finding of importBoundaryFindings) {
    storage.upsertFinding(finding);
  }
  const fileRoleFindings = runFileRoleCheck({
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...fileRoleFindings);
  for (const finding of fileRoleFindings) {
    storage.upsertFinding(finding);
  }
  const entrypointFlowFindings = runEntrypointFlowCheck({
    repoId,
    contract,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId
  });
  findings.push(...entrypointFlowFindings);
  for (const finding of entrypointFlowFindings) {
    storage.upsertFinding(finding);
  }
  const requiredCheckProofFindings = runRequiredCheckProofCheck({
    repoId,
    contract,
    storage,
    now,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    parsedDiff,
    baseline,
    existingFindings,
    checkData,
    snapshotsByPath,
    checkId,
    checkScanId,
    contractFingerprintValue,
    diffHash
  });
  findings.push(...requiredCheckProofFindings);
  for (const finding of requiredCheckProofFindings) {
    storage.upsertFinding(finding);
  }

  attachFindingVersionBindings(findings, machineContractVersions);
  for (const finding of findings) {
    storage.upsertFinding(finding);
  }

  const blockingCount = findings.filter((finding) =>
    finding.status === "new" &&
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "block"
  ).length;
  const checkStatus: CheckRun["status"] = blockingCount > 0 ? "fail" : "pass";
  const fallbackStatus = fallbackStatusForCheck(checkData);
  const capabilityCompleteness = capabilityCompletenessForCheck(checkData);
  const readiness = readinessForCheck({
    repoId,
    checkScanId,
    checkData,
    capabilityCompleteness,
    now
  });
  const check = checkEnvelope({
    checkId,
    repoId,
    contract,
    contractFingerprintValue,
    checkScanId,
    scope,
    status: checkStatus,
    fallbackStatus,
    capabilityCompleteness,
    machineContractVersions
  });
  storage.upsertCheckRun({
    id: checkId,
    repo_id: repoId,
    repo_contract_id: contract.id,
    contract_fingerprint: contractFingerprintValue,
    scan_id: checkScanId,
    status: checkStatus,
    scope: scope as "changed-hunks" | "changed-files" | "full",
    engine_source: checkData.engineSource,
    fallback_used: fallbackStatus.fallback_used,
    stale_scan: false,
    capability_complete: capabilityCompleteness.complete,
    findings_count: findings.length,
    blocking_count: blockingCount,
    machine_contract_versions: machineContractVersions,
    started_at: now,
    completed_at: now
  });
  if (securityBoundaryProofs.length > 0 && typeof storage.upsertSecurityBoundaryProofRuns === "function") {
    storage.upsertSecurityBoundaryProofRuns({
      repo_id: repoId,
      scan_id: checkScanId,
      check_id: checkId,
      proofs: securityBoundaryProofs,
      created_at: now
    });
  }
  const openNewCount = findings.filter((finding) => finding.status === "new").length;
  const outcome = checkOutcomeSummary(findings, {
    waivedFindingsCount,
    expiredFindingsCount,
    scope: scope as "changed-hunks" | "changed-files" | "full"
  });
  const payload = {
    response_schema: "drift.check.result.v1",
    check,
    readiness,
    machine_contract_versions: machineContractVersions,
    policy,
    governance: preflightGovernance(),
    audit_integrity: storage.verifyAuditChain(repoId),
    summary: {
      repo_id: repoId,
      scope,
      findings_count: findings.length,
      blocking_count: blockingCount,
      waived_findings_count: waivedFindingsCount,
      expired_findings_count: expiredFindingsCount,
      skipped_deleted_files: parsedDiff.deletedFiles,
      engine_source: checkData.engineSource,
      affected_scope: affectedScopeSummary(parsedDiff, scope),
      outcome
    },
    review_items: findings.map(reviewFinding),
    waived_findings: waivedFindings,
    security_boundary_proofs: securityBoundaryProofs,
    next_commands: checkNextCommands(repoId, {
      findingCount: findings.length,
      openNewCount,
      blockingCount
    }),
    findings
  };

  return {
    exitCode: blockingCount > 0 ? 1 : 0,
    payload: parsed.flags.has("json") ? payload : formatCheckText(payload)
  };
}

function fallbackStatusForCheck(checkData: ScanData): ScanData["fallbackStatus"] {
  return checkData.fallbackStatus;
}

function capabilityCompletenessForCheck(checkData: ScanData): {
  complete: boolean;
  missing_capabilities: string[];
  can_block: boolean;
} {
  return {
    complete: checkData.engineSource === "rust" && !checkData.fallbackStatus.fallback_used,
    missing_capabilities: checkData.fallbackStatus.fallback_used
      ? checkData.fallbackStatus.degraded_capabilities
      : [],
    can_block: checkData.engineSource === "rust" && !checkData.fallbackStatus.enforcement_degraded
  };
}

function readinessForCheck(input: {
  repoId: string;
  checkScanId: string;
  checkData: ScanData;
  capabilityCompleteness: ReturnType<typeof capabilityCompletenessForCheck>;
  now: string;
}) {
  const parserGaps = parserGapsFromDiagnostics({
    repoId: input.repoId,
    scanId: input.checkScanId,
    diagnostics: input.checkData.graph_diagnostics.length > 0
      ? input.checkData.graph_diagnostics
      : input.checkData.diagnostics,
    createdAt: input.now
  });
  const graphAvailable = input.checkData.graph_nodes.length > 0;
  return buildReadiness({
    repo_id: input.repoId,
    scan_id: input.checkScanId,
    surface: "check",
    graph_available: graphAvailable,
    graph_complete: input.capabilityCompleteness.complete && input.capabilityCompleteness.can_block,
    parser_gaps: parserGaps,
    completeness_reasons: graphAvailable ? [] : ["graph_missing"],
    required_capabilities: ["direct_data_access_check"],
    missing_capabilities: input.capabilityCompleteness.missing_capabilities
  });
}

function attachFindingVersionBindings(
  findings: Finding[],
  machineContractVersions: MachineContractVersions
): void {
  for (const finding of findings) {
    finding.created_by_engine_version = machineContractVersions.scanner_version;
    finding.created_by_rule_engine_version = machineContractVersions.rule_engine_version;
    finding.contract_schema_version = machineContractVersions.contract_schema_version;
  }
}

function checkEnvelope(input: {
  checkId: string;
  repoId: string;
  contract: RepoContract;
  contractFingerprintValue: string;
  checkScanId: string;
  scope: string;
  status: CheckRun["status"];
  fallbackStatus: ScanData["fallbackStatus"];
  capabilityCompleteness: ReturnType<typeof capabilityCompletenessForCheck>;
  machineContractVersions: MachineContractVersions;
}): {
  id: string;
  repo_id: string;
  repo_contract_id: string;
  contract_fingerprint: string;
  scope: string;
  status: CheckRun["status"];
  scan_status: {
    mode: "check_time_collection";
    stored_scan_required: false;
    stale: false;
    scan_id: string;
  };
  fallback_status: ScanData["fallbackStatus"];
  capability_completeness: ReturnType<typeof capabilityCompletenessForCheck>;
  machine_contract_versions: MachineContractVersions;
} {
  return {
    id: input.checkId,
    repo_id: input.repoId,
    repo_contract_id: input.contract.id,
    contract_fingerprint: input.contractFingerprintValue,
    scope: input.scope,
    status: input.status,
    scan_status: {
      mode: "check_time_collection",
      stored_scan_required: false,
      stale: false,
      scan_id: input.checkScanId
    },
    fallback_status: input.fallbackStatus,
    capability_completeness: input.capabilityCompleteness,
    machine_contract_versions: input.machineContractVersions
  };
}

function directDataAccessSuggestedFix(): string {
  return "Move data access behind a service layer before returning from the route.";
}

function waiverReapprovalFinding(input: {
  repoId: string;
  repoContractId: string;
  conventionId: string;
  checkId: string;
  scanId: string;
  filePath: string;
  line: number;
  symbol: string;
  importSource: string;
  fileHash: string;
  waiverId: string;
  now: string;
}): Finding {
  const fingerprint = hashStable([
    "waiver-reapproval-required",
    input.waiverId,
    input.conventionId,
    input.filePath
  ].join(":"));
  return {
    id: `finding_${fingerprint.slice(0, 16)}`,
    repo_id: input.repoId,
    convention_id: input.conventionId,
    check_id: input.checkId,
    repo_contract_id: input.repoContractId,
    fingerprint,
    title: "Waiver requires reapproval after file change",
    message: `${input.filePath} matches waiver ${input.waiverId}, but the file hash no longer matches the approved waiver state.`,
    severity: "warning",
    confidence_label: "certain",
    drift_category: "worsened_violation",
    introduced_by_diff: true,
    affected_contract: input.repoContractId,
    enforcement_result: "warn",
    status: "new",
    diff_status: "touched_existing",
    evidence_refs: [{
      id: `evidence_${fingerprint.slice(0, 16)}`,
      kind: "violation",
      file_path: input.filePath,
      start_line: input.line,
      end_line: input.line,
      symbol: input.symbol,
      import_source: input.importSource,
      fact_ids: [],
      scan_id: input.scanId,
      file_hash: input.fileHash,
      redaction_state: "none"
    }],
    expected_layer: "approved_waiver_state",
    actual_layer: "waiver_stale_after_file_change",
    graph_path: [input.filePath, input.waiverId],
    suggested_fix: `Reapprove waiver ${input.waiverId} for the current file content or remove the waiver and fix the violation.`,
    related_node_ids: [],
    created_at: input.now
  };
}

function runCanonicalHelperReuseCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  contractFingerprintValue: string;
  diffHash: string;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));
  if (changedFiles.size === 0 && input.scope === "full") {
    for (const snapshot of input.checkData.snapshots) {
      changedFiles.add(snapshot.file_path);
    }
  }
  const exportedFacts = input.checkData.facts.filter((fact) =>
    fact.kind === "exported_symbol" && changedFiles.has(fact.file_path)
  );

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "canonical_helper_reuse") {
      continue;
    }

    for (const helper of contract.canonical_helpers) {
      const forbiddenSymbols = new Set(helper.avoid_new_symbols_matching ?? []);

      for (const exported of exportedFacts) {
        if (isCanonicalHelperModule(exported.file_path, helper.module)) {
          continue;
        }

        const exactDuplicate = forbiddenSymbols.has(exported.name);
        const similarity = exactDuplicate ? null : scoreHelperSimilarity({
          candidate: helperProfileForExport(input.checkData.facts, exported),
          canonical: canonicalHelperProfile(input.checkData.facts, helper),
          blockingThreshold: "deterministic"
        });
        if (!exactDuplicate && similarity?.score_band !== "high") {
          continue;
        }
        const diffStatus = diffStatusFor(exported.file_path, exported.start_line, input.parsedDiff, input.scope);
        const fingerprint = canonicalHelperReuseFindingFingerprint(
          contract.id,
          helper.helper_id,
          exported.file_path,
          exactDuplicate ? exported.name : `${exported.name}:fuzzy:${similarity?.score ?? 0}`
        );
        const snapshot = input.snapshotsByPath.get(exported.file_path);
        const status = input.baseline.some((entry) =>
          entry.status === "active" &&
          entry.convention_id === contract.id &&
          entry.finding_fingerprint === fingerprint
        ) ? "pre_existing" : preservedGovernanceStatus(input.existingFindings.get(fingerprint)) ?? "new";
        findings.push({
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: input.repoId,
          convention_id: contract.id,
          check_id: input.checkId,
          repo_contract_id: input.contract.id,
          fingerprint,
          title: exactDuplicate ? "Duplicate canonical helper introduced" : "Possible duplicate canonical helper introduced",
          message: exactDuplicate
            ? `${exported.file_path} exports ${exported.name}; reuse ${helper.symbol} from ${helper.module} instead of creating a parallel helper.`
            : `${exported.file_path} exports ${exported.name}; it is highly similar to ${helper.symbol} from ${helper.module}.`,
          severity: exactDuplicate && contract.enforcement === "blocking" ? "error" : "warning",
          enforcement_result: exactDuplicate && contract.enforcement === "blocking" ? "block" : "warn",
          status,
          diff_status: diffStatus,
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: exported.file_path,
            start_line: exported.start_line,
            end_line: exported.end_line,
            symbol: exported.name,
            fact_ids: [exported.id, ...(similarity?.evidence_refs ?? [])].filter((value, index, all) =>
              all.indexOf(value) === index
            ),
            scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
            file_hash: snapshot?.content_hash ?? "",
            redaction_state: "none"
          }],
          expected_layer: "canonical_helper",
          actual_layer: exactDuplicate ? "duplicate_helper" : "possible_duplicate_helper",
          graph_path: [exported.file_path, helper.module],
          suggested_fix: canonicalHelperSuggestedFix(helper, exported.name),
          related_node_ids: [],
          created_at: input.now
        });
      }
    }
  }

  return findings;
}

function canonicalHelperSuggestedFix(
  helper: CanonicalHelperReuseAgentContract["canonical_helpers"][number],
  duplicateSymbol: string
): string {
  return `Import ${helper.symbol} from ${helper.module} instead of creating ${duplicateSymbol}.`;
}

function helperProfileForExport(facts: FactRecord[], exported: FactRecord): {
  symbol: string;
  file_path: string;
  purpose_tags: string[];
  parameter_shape: string[];
  return_shape: string;
  call_dependencies: string[];
  import_dependencies: string[];
  body_operation_kinds: string[];
  evidence_refs: string[];
} {
  const fileFacts = facts.filter((fact) => fact.file_path === exported.file_path);
  return {
    symbol: exported.name,
    file_path: exported.file_path,
    purpose_tags: helperPurposeTags(exported.name, exported.file_path),
    parameter_shape: ["request"],
    return_shape: helperReturnShape(exported.name),
    call_dependencies: uniqueSorted(fileFacts
      .filter((fact) => fact.kind === "symbol_called")
      .map((fact) => fact.name)),
    import_dependencies: uniqueSorted(fileFacts
      .filter((fact) => fact.kind === "import_used" && fact.value)
      .map((fact) => fact.value as string)),
    body_operation_kinds: helperBodyOperationKinds(fileFacts),
    evidence_refs: fileFacts.map((fact) => fact.id)
  };
}

function canonicalHelperProfile(
  facts: FactRecord[],
  helper: CanonicalHelperReuseAgentContract["canonical_helpers"][number]
): {
  symbol: string;
  module: string;
  purpose_tags: string[];
  parameter_shape: string[];
  return_shape: string;
  call_dependencies: string[];
  import_dependencies: string[];
  body_operation_kinds: string[];
  evidence_refs: string[];
} {
  const helperFacts = facts.filter((fact) => isCanonicalHelperModule(fact.file_path, helper.module));
  return {
    symbol: helper.symbol,
    module: helper.module,
    purpose_tags: helper.purpose_tags,
    parameter_shape: ["request"],
    return_shape: helperReturnShape(helper.symbol),
    call_dependencies: uniqueSorted(helperFacts
      .filter((fact) => fact.kind === "symbol_called")
      .map((fact) => fact.name)),
    import_dependencies: uniqueSorted(helperFacts
      .filter((fact) => fact.kind === "import_used" && fact.value)
      .map((fact) => fact.value as string)),
    body_operation_kinds: helperBodyOperationKinds(helperFacts, helper.purpose_tags),
    evidence_refs: helperFacts.map((fact) => fact.id)
  };
}

function helperPurposeTags(symbol: string, filePath: string): string[] {
  const text = `${symbol} ${filePath}`.toLowerCase();
  return uniqueSorted([
    text.includes("auth") || text.includes("user") ? "auth" : "",
    text.includes("user") ? "user" : "",
    text.includes("valid") || text.includes("schema") ? "validation" : ""
  ].filter(Boolean));
}

function helperReturnShape(symbol: string): string {
  return /user/i.test(symbol) ? "user" : "unknown";
}

function helperBodyOperationKinds(facts: FactRecord[], fallbackTags: string[] = []): string[] {
  const names = facts.map((fact) => `${fact.name} ${fact.value ?? ""}`).join(" ").toLowerCase();
  return uniqueSorted([
    names.includes("session") || fallbackTags.includes("auth") ? "auth_guard" : "",
    names.includes("schema") || fallbackTags.includes("validation") ? "validation" : "",
    ...facts.filter((fact) => fact.kind === "data_operation_detected").map((fact) => fact.name)
  ].filter(Boolean));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isCanonicalHelperModule(filePath: string, moduleSpecifier: string): boolean {
  const normalizedFile = filePath.replaceAll("\\", "/").replace(/\.[cm]?[jt]sx?$/, "");
  const normalizedModule = moduleSpecifier
    .replace(/^@\//, "")
    .replaceAll("\\", "/")
    .replace(/\.[cm]?[jt]sx?$/, "");
  return normalizedFile.endsWith(normalizedModule);
}

function runModulePlacementCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "module_placement") {
      continue;
    }

    const roleFacts = input.checkData.facts.filter((fact) =>
      fact.kind === "file_role_detected" &&
      fact.name === contract.target_role &&
      changedFiles.has(fact.file_path)
    );
    for (const roleFact of roleFacts) {
      if (modulePlacementAllowed(roleFact.file_path, contract.allowed_paths, contract.forbidden_paths ?? [])) {
        continue;
      }

      const diffStatus = diffStatusFor(roleFact.file_path, roleFact.start_line, input.parsedDiff, input.scope);
      const fingerprint = agentContractFindingFingerprint(
        "module-placement",
        contract.id,
        roleFact.file_path,
        roleFact.name,
        contract.allowed_paths.join("|")
      );
      const snapshot = input.snapshotsByPath.get(roleFact.file_path);
      const status = findingStatusForAgentContract(
        input.baseline,
        input.existingFindings,
        contract.id,
        fingerprint
      );
      findings.push({
        id: `finding_${fingerprint.slice(0, 16)}`,
        repo_id: input.repoId,
        convention_id: contract.id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint,
        title: "Module placement contract violated",
        message: `${roleFact.file_path} is classified as ${contract.target_role}, but that role is not allowed in this path by ${contract.id}.`,
        severity: contract.enforcement === "blocking" ? "error" : "warning",
        enforcement_result: contract.enforcement === "blocking" ? "block" : "warn",
        status,
        diff_status: diffStatus,
        evidence_refs: [{
          id: `evidence_${fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: roleFact.file_path,
          start_line: roleFact.start_line,
          end_line: roleFact.end_line,
          symbol: roleFact.name,
          fact_ids: [roleFact.id],
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: contract.target_role,
        actual_layer: "misplaced_module",
        graph_path: [roleFact.file_path, ...contract.allowed_paths],
        suggested_fix: modulePlacementSuggestedFix(roleFact.file_path, contract.allowed_paths),
        related_node_ids: [],
        created_at: input.now
      });
    }
  }

  return findings;
}

function runImportBoundaryCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "import_boundary") {
      continue;
    }

    const sourceFiles = filesWithRoles(input.checkData.facts, changedFiles, contract.source_roles);
    for (const importUsed of input.checkData.facts.filter((fact) =>
      fact.kind === "import_used" &&
      fact.value &&
      sourceFiles.has(fact.file_path)
    )) {
      const importSource = importUsed.value as string;
      if (!isForbiddenImport(importSource, contract.forbidden_imports ?? [])) {
        continue;
      }
      if (isForbiddenImport(importSource, contract.allowed_imports ?? [])) {
        continue;
      }

      const diffStatus = diffStatusFor(importUsed.file_path, importUsed.start_line, input.parsedDiff, input.scope);
      const fingerprint = agentContractFindingFingerprint(
        "import-boundary",
        contract.id,
        importUsed.file_path,
        importUsed.name,
        importSource
      );
      const snapshot = input.snapshotsByPath.get(importUsed.file_path);
      const status = findingStatusForAgentContract(
        input.baseline,
        input.existingFindings,
        contract.id,
        fingerprint
      );
      findings.push({
        id: `finding_${fingerprint.slice(0, 16)}`,
        repo_id: input.repoId,
        convention_id: contract.id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint,
        title: "Import boundary contract violated",
        message: `${importUsed.file_path} imports ${importUsed.name} from ${importSource}, which is forbidden for ${contract.source_roles.join(", ")}.`,
        severity: contract.enforcement === "blocking" ? "error" : "warning",
        enforcement_result: contract.enforcement === "blocking" ? "block" : "warn",
        status,
        diff_status: diffStatus,
        evidence_refs: [{
          id: `evidence_${fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: importUsed.file_path,
          start_line: importUsed.start_line,
          end_line: importUsed.end_line,
          symbol: importUsed.name,
          import_source: importSource,
          fact_ids: [importUsed.id],
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: "allowed_import_boundary",
        actual_layer: "forbidden_import",
        graph_path: [importUsed.file_path, importSource],
        suggested_fix: importBoundarySuggestedFix(importSource),
        related_node_ids: [],
        created_at: input.now
      });
    }
  }

  return findings;
}

function runFileRoleCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "file_role") {
      continue;
    }

    for (const role of contract.roles) {
      const files = [...changedFiles].filter((filePath) =>
        role.path_globs.some((glob) => matchesGlob(filePath, glob))
      );
      for (const filePath of files) {
        const imports = input.checkData.facts.filter((fact) =>
          fact.kind === "import_used" &&
          fact.file_path === filePath &&
          fact.value &&
          isForbiddenImport(fact.value, role.forbidden_imports ?? [])
        );
        for (const importUsed of imports) {
          const importSource = importUsed.value as string;
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: "file-role-forbidden-import",
            title: "File role contract violated",
            message: `${filePath} is in the ${role.role} role and imports forbidden dependency ${importSource}.`,
            severity: role.confidence === "deterministic" ? "error" : "warning",
            enforcementResult: role.confidence === "deterministic" ? "block" : "warn",
            filePath,
            startLine: importUsed.start_line,
            endLine: importUsed.end_line,
            symbol: importUsed.name,
            importSource,
            factIds: [importUsed.id],
            expectedLayer: role.role,
            actualLayer: "forbidden_import",
            graphPath: [filePath, importSource],
            suggestedFix: `Remove forbidden import ${importSource} from ${role.role} files.`
          }));
        }

        const exportedSymbols = new Set(input.checkData.facts
          .filter((fact) => fact.kind === "exported_symbol" && fact.file_path === filePath)
          .map((fact) => fact.name));
        for (const requiredExport of role.required_exports ?? []) {
          if (exportedSymbols.has(requiredExport)) {
            continue;
          }
          const fileFact = fileDetectedFact(input.checkData.facts, filePath);
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: "file-role-required-export",
            title: "File role contract violated",
            message: `${filePath} is in the ${role.role} role but does not export required symbol ${requiredExport}.`,
            severity: role.confidence === "deterministic" ? "error" : "warning",
            enforcementResult: role.confidence === "deterministic" ? "block" : "warn",
            filePath,
            startLine: 1,
            endLine: fileFact?.end_line ?? 1,
            symbol: requiredExport,
            factIds: fileFact ? [fileFact.id] : [],
            expectedLayer: role.role,
            actualLayer: "missing_required_export",
            graphPath: [filePath, requiredExport],
            suggestedFix: `Export ${requiredExport} from ${role.role} files.`
          }));
        }
      }
    }
  }

  return findings;
}

function runEntrypointFlowCheck(input: {
  repoId: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));

  for (const contract of input.contract.agent_contracts ?? []) {
    if (contract.kind !== "entrypoint_flow") {
      continue;
    }

    const entryFiles = filesWithRoles(input.checkData.facts, changedFiles, contract.entry_roles);
    for (const filePath of entryFiles) {
      const proof = buildEntrypointFlowProof({
        contract,
        entry_file_path: filePath,
        facts: input.checkData.facts
      });
      const callNames = new Set(input.checkData.facts
        .filter((fact) => fact.kind === "symbol_called" && fact.file_path === filePath)
        .map((fact) => fact.name));
      const importSources = new Set(input.checkData.facts
        .filter((fact) => fact.kind === "import_used" && fact.file_path === filePath && fact.value)
        .map((fact) => fact.value as string));

      for (const step of contract.required_steps) {
        const stepCalls = "calls" in step ? step.calls ?? [] : [];
        const stepImports = "imports" in step ? step.imports ?? [] : [];
        for (const callName of stepCalls) {
          if (callNames.has(callName)) {
            continue;
          }
          const fileFact = fileDetectedFact(input.checkData.facts, filePath);
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: `entrypoint-flow-missing-call-${step.kind}`,
            title: "Entrypoint flow contract violated",
            message: `${filePath} is missing required ${step.kind} call ${callName}.`,
            severity: contract.enforcement === "blocking" ? "error" : "warning",
            enforcementResult: contract.enforcement === "blocking" ? "block" : "warn",
            filePath,
            startLine: 1,
            endLine: fileFact?.end_line ?? 1,
            symbol: callName,
            factIds: fileFact ? [fileFact.id] : [],
            expectedLayer: step.kind,
            actualLayer: "missing_required_call",
            graphPath: [filePath, callName],
            suggestedFix: `Call ${callName} before completing this entrypoint.`
          }));
        }

        for (const importSource of stepImports) {
          if (importSources.has(importSource)) {
            continue;
          }
          const fileFact = fileDetectedFact(input.checkData.facts, filePath);
          findings.push(agentContractFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            agentContractId: contract.id,
            checkId: input.checkId,
            checkScanId: input.checkScanId,
            checkData: input.checkData,
            snapshotsByPath: input.snapshotsByPath,
            baseline: input.baseline,
            existingFindings: input.existingFindings,
            parsedDiff: input.parsedDiff,
            scope: input.scope,
            now: input.now,
            fingerprintKind: `entrypoint-flow-missing-import-${step.kind}`,
            title: "Entrypoint flow contract violated",
            message: `${filePath} is missing required ${step.kind} import ${importSource}.`,
            severity: contract.enforcement === "blocking" ? "error" : "warning",
            enforcementResult: contract.enforcement === "blocking" ? "block" : "warn",
            filePath,
            startLine: 1,
            endLine: fileFact?.end_line ?? 1,
            symbol: importSource,
            importSource,
            factIds: fileFact ? [fileFact.id] : [],
            expectedLayer: step.kind,
            actualLayer: "missing_required_import",
            graphPath: [filePath, importSource],
            suggestedFix: `Import ${importSource} before completing this entrypoint.`
          }));
        }
      }

      for (const forbiddenStep of proof.forbidden_steps) {
        if (!forbiddenStep.present) {
          continue;
        }
        const evidenceFact = input.checkData.facts.find((fact) =>
          forbiddenStep.evidence_refs.includes(fact.id)
        ) ?? fileDetectedFact(input.checkData.facts, filePath);
        findings.push(agentContractFinding({
          repoId: input.repoId,
          repoContractId: input.contract.id,
          agentContractId: contract.id,
          checkId: input.checkId,
          checkScanId: input.checkScanId,
          checkData: input.checkData,
          snapshotsByPath: input.snapshotsByPath,
          baseline: input.baseline,
          existingFindings: input.existingFindings,
          parsedDiff: input.parsedDiff,
          scope: input.scope,
          now: input.now,
          fingerprintKind: `entrypoint-flow-forbidden-${forbiddenStep.step_kind}`,
          title: "Entrypoint flow contract violated",
          message: `${filePath} includes forbidden ${forbiddenStep.step_kind} in its entrypoint flow.`,
          severity: contract.enforcement === "blocking" ? "error" : "warning",
          enforcementResult: contract.enforcement === "blocking" ? "block" : "warn",
          filePath,
          startLine: evidenceFact?.start_line ?? 1,
          endLine: evidenceFact?.end_line ?? 1,
          symbol: forbiddenStep.step_kind,
          importSource: evidenceFact?.value,
          factIds: forbiddenStep.evidence_refs,
          expectedLayer: "service_delegation",
          actualLayer: forbiddenStep.step_kind,
          graphPath: forbiddenStep.graph_path,
          suggestedFix: "Delegate data access and business logic through an accepted service layer."
        }));
      }
    }
  }

  return findings;
}

function runRequiredCheckProofCheck(input: {
  repoId: string;
  contract: RepoContract;
  storage: SqliteDriftStorage;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  contractFingerprintValue: string;
  diffHash: string;
}): Finding[] {
  const findings: Finding[] = [];
  const changedFiles = new Set(input.parsedDiff.files.map((file) => file.path));
  if (changedFiles.size === 0 && input.scope === "full") {
    for (const snapshot of input.checkData.snapshots) {
      changedFiles.add(snapshot.file_path);
    }
  }
  const changedRoles = new Set(input.checkData.facts
    .filter((fact) => fact.kind === "file_role_detected" && changedFiles.has(fact.file_path))
    .map((fact) => fact.name));

  for (const agentContract of input.contract.agent_contracts ?? []) {
    if (agentContract.kind !== "required_change_checks") {
      continue;
    }
    for (const rule of agentContract.rules) {
      const pathMatch = !rule.applies_to.path_globs?.length ||
        [...changedFiles].some((file) =>
          rule.applies_to.path_globs!.some((glob) => matchesGlob(file, glob))
        );
      const roleMatch = !rule.applies_to.file_roles?.length ||
        rule.applies_to.file_roles.some((role) => changedRoles.has(role));
      if (!pathMatch || !roleMatch) {
        continue;
      }
      for (const requiredCheck of rule.required_checks) {
        if (!requiredCheck.required_for_release) {
          continue;
        }
        const latest = input.storage.latestRequiredCheckExecution(input.repoId, requiredCheck.command);
        if (
          latest?.status === "passed" &&
          latest.repo_contract_id === input.contract.id &&
          latest.agent_contract_id === agentContract.id &&
          latest.contract_fingerprint === input.contractFingerprintValue &&
          latest.diff_hash === input.diffHash
        ) {
          continue;
        }
        const proofState = requiredCheckProofState(
          latest,
          input.contract.id,
          agentContract.id,
          input.contractFingerprintValue,
          input.diffHash
        );
        const firstFile = [...changedFiles].sort()[0] ?? input.checkData.snapshots[0]?.file_path ?? "required-checks";
        const firstChangedLine = [...(input.parsedDiff.files.find((file) => file.path === firstFile)
          ?.changedLines ?? [])].sort((left, right) => left - right)[0];
        const fileFact = fileDetectedFact(input.checkData.facts, firstFile);
        const evidenceStartLine = firstChangedLine ?? fileFact?.start_line ?? 1;
        findings.push(agentContractFinding({
          repoId: input.repoId,
          repoContractId: input.contract.id,
          agentContractId: agentContract.id,
          checkId: input.checkId,
          checkScanId: input.checkScanId,
          checkData: input.checkData,
          snapshotsByPath: input.snapshotsByPath,
          baseline: input.baseline,
          existingFindings: input.existingFindings,
          parsedDiff: input.parsedDiff,
          scope: input.scope,
          now: input.now,
          fingerprintKind: "required-check-not-run",
          title: proofState.title,
          message: proofState.message(requiredCheck.command),
          severity: "error",
          enforcementResult: "block",
          filePath: firstFile,
          startLine: evidenceStartLine,
          endLine: Math.max(evidenceStartLine, fileFact?.end_line ?? evidenceStartLine),
          symbol: requiredCheck.command,
          factIds: fileFact ? [fileFact.id] : [],
          expectedLayer: "required_check_execution",
          actualLayer: proofState.actualLayer,
          graphPath: [firstFile, requiredCheck.command],
          suggestedFix: `Run drift checks run --repo ${input.repoId} --command "${requiredCheck.command}" --json.`
        }));
      }
    }
  }

  return findings;
}

function requiredCheckProofState(
  latest: RequiredCheckExecution | null,
  repoContractId: string,
  agentContractId: string,
  contractFingerprintValue: string,
  diffHash: string
): {
  title: string;
  actualLayer: string;
  message: (command: string) => string;
} {
  if (!latest) {
    return {
      title: "Required check has not been proven",
      actualLayer: "required_check_not_run",
      message: (command) =>
        `${command} is required for this change, but Drift has no passing execution proof for the active contract.`
    };
  }
  if (latest.status !== "passed") {
    return {
      title: "Required check has not passed",
      actualLayer: "required_check_failed",
      message: (command) =>
        `${command} is required for this change, but the latest execution proof did not pass.`
    };
  }
  if (latest.repo_contract_id !== repoContractId || latest.agent_contract_id !== agentContractId) {
    return {
      title: "Required check proof belongs to another contract",
      actualLayer: "required_check_wrong_contract",
      message: (command) =>
        `${command} has passing proof, but it was recorded for a different repo or agent contract.`
    };
  }
  if (latest.contract_fingerprint !== contractFingerprintValue) {
    return {
      title: "Required check proof is stale for the active contract",
      actualLayer: "required_check_stale_contract",
      message: (command) =>
        `${command} has passing proof, but the active contract fingerprint changed after it ran.`
    };
  }
  if (latest.diff_hash !== diffHash) {
    return {
      title: "Required check proof is stale for this diff",
      actualLayer: "required_check_stale_proof",
      message: (command) =>
        `${command} has passing proof, but it was recorded for a different diff.`
    };
  }
  return {
    title: "Required check has not been proven",
    actualLayer: "required_check_not_run",
    message: (command) =>
      `${command} is required for this change, but Drift has no passing execution proof for the active contract.`
  };
}

function modulePlacementAllowed(filePath: string, allowedPaths: string[], forbiddenPaths: string[]): boolean {
  if (forbiddenPaths.some((glob) => matchesGlob(filePath, glob))) {
    return false;
  }
  return allowedPaths.length === 0 || allowedPaths.some((glob) => matchesGlob(filePath, glob));
}

function modulePlacementSuggestedFix(filePath: string, allowedPaths: string[]): string {
  const target = allowedPaths[0] ?? "an accepted module path";
  return `Move ${filePath} under ${target}.`;
}

function importBoundarySuggestedFix(importSource: string): string {
  return `Import through an accepted delegate instead of importing ${importSource} directly.`;
}

function filesWithRoles(facts: FactRecord[], files: Set<string>, roles: FileRole[]): Set<string> {
  return new Set(facts
    .filter((fact) =>
      fact.kind === "file_role_detected" &&
      files.has(fact.file_path) &&
      roles.includes(fact.name as FileRole)
    )
    .map((fact) => fact.file_path));
}

function fileDetectedFact(facts: FactRecord[], filePath: string): FactRecord | undefined {
  return facts.find((fact) => fact.kind === "file_detected" && fact.file_path === filePath);
}

function agentContractFinding(input: {
  repoId: string;
  repoContractId: string;
  agentContractId: string;
  checkId: string;
  checkScanId: string;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  scope: "changed-hunks" | "changed-files" | "full";
  now: string;
  fingerprintKind: string;
  title: string;
  message: string;
  severity: Finding["severity"];
  enforcementResult: Finding["enforcement_result"];
  filePath: string;
  startLine: number;
  endLine: number;
  symbol: string;
  importSource?: string;
  factIds: string[];
  expectedLayer: string;
  actualLayer: string;
  graphPath: string[];
  suggestedFix: string;
}): Finding {
  const fingerprint = agentContractFindingFingerprint(
    input.fingerprintKind,
    input.agentContractId,
    input.filePath,
    input.symbol,
    input.importSource ?? input.actualLayer
  );
  const snapshot = input.snapshotsByPath.get(input.filePath);
  const status = findingStatusForAgentContract(
    input.baseline,
    input.existingFindings,
    input.agentContractId,
    fingerprint
  );
  return {
    id: `finding_${fingerprint.slice(0, 16)}`,
    repo_id: input.repoId,
    convention_id: input.agentContractId,
    check_id: input.checkId,
    repo_contract_id: input.repoContractId,
    fingerprint,
    title: input.title,
    message: input.message,
    severity: input.severity,
    enforcement_result: input.enforcementResult,
    status,
    diff_status: diffStatusFor(input.filePath, input.startLine, input.parsedDiff, input.scope),
    evidence_refs: [{
      id: `evidence_${fingerprint.slice(0, 16)}`,
      kind: "violation",
      file_path: input.filePath,
      start_line: input.startLine,
      end_line: input.endLine,
      symbol: input.symbol,
      import_source: input.importSource,
      fact_ids: input.factIds,
      scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
      file_hash: snapshot?.content_hash ?? "",
      redaction_state: "none"
    }],
    expected_layer: input.expectedLayer,
    actual_layer: input.actualLayer,
    graph_path: input.graphPath,
    suggested_fix: input.suggestedFix,
    related_node_ids: [],
    created_at: input.now
  };
}

function findingStatusForAgentContract(
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>,
  existingFindings: Map<string, Finding>,
  contractId: string,
  fingerprint: string
): Finding["status"] {
  return baseline.some((entry) =>
    entry.status === "active" &&
    entry.convention_id === contractId &&
    entry.finding_fingerprint === fingerprint
  ) ? "pre_existing" : preservedGovernanceStatus(existingFindings.get(fingerprint)) ?? "new";
}

function graphPathForFinding(
  relatedNodeIds: string[],
  filePath: string,
  importSource: string | undefined
): string[] {
  if (relatedNodeIds.length > 0) {
    return relatedNodeIds;
  }
  return [filePath, importSource].filter((value): value is string => Boolean(value));
}

function affectedScopeSummary(
  parsedDiff: ReturnType<typeof parseUnifiedDiff>,
  scope: string
): {
  mode: string;
  changed_file_count: number;
  changed_line_count: number;
  deleted_file_count: number;
  deleted_files: string[];
} {
  return {
    mode: scope,
    changed_file_count: parsedDiff.files.length,
    changed_line_count: parsedDiff.files.reduce((total, file) => total + file.changedLines.size, 0),
    deleted_file_count: parsedDiff.deletedFiles.length,
    deleted_files: parsedDiff.deletedFiles
  };
}

function checkOutcomeSummary(
  findings: Finding[],
  input: {
    waivedFindingsCount: number;
    expiredFindingsCount: number;
    scope: "changed-hunks" | "changed-files" | "full";
  }
): {
  status_counts: Partial<Record<Finding["status"], number>>;
  diff_status_counts: Partial<Record<Finding["diff_status"], number>>;
  enforcement_counts: Partial<Record<Finding["enforcement_result"], number>>;
  blocking_reasons: Array<{ reason: string; count: number }>;
  warning_reasons: Array<{ reason: string; count: number }>;
  non_blocking_reasons: Array<{ reason: string; count: number }>;
} {
  const statusCounts = countFindingsBy(findings, (finding) => finding.status);
  const diffStatusCounts = countFindingsBy(findings, (finding) => finding.diff_status);
  const enforcementCounts = countFindingsBy(findings, (finding) => finding.enforcement_result);
  const blockingNewHunks = findings.filter((finding) =>
    finding.status === "new" &&
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "block"
  ).length;
  const warnings = findings.filter((finding) =>
    finding.status === "new" &&
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "warn"
  ).length;
  const preExisting = findings.filter((finding) => finding.status === "pre_existing").length;
  const touchedExisting = findings.filter((finding) =>
    finding.status === "new" && finding.diff_status === "touched_existing"
  ).length;
  const outsideDiff = findings.filter((finding) =>
    finding.status === "new" && finding.diff_status === "outside_diff"
  ).length;

  return {
    status_counts: statusCounts,
    diff_status_counts: diffStatusCounts,
    enforcement_counts: enforcementCounts,
    blocking_reasons: compactReasons([
      ["new_blocking_violation_in_changed_hunk", blockingNewHunks]
    ]),
    warning_reasons: compactReasons([
      ["new_warning_violation_in_changed_hunk", warnings]
    ]),
    non_blocking_reasons: compactReasons([
      ["pre_existing_baseline", preExisting],
      ["touched_existing_not_new_hunk", touchedExisting],
      ["outside_diff", outsideDiff],
      ["waived_by_contract", input.waivedFindingsCount],
      ["expired_convention_findings", input.expiredFindingsCount],
      [input.scope === "changed-files" ? "changed_files_mode_does_not_infer_new_hunks" : "", input.scope === "changed-files" ? touchedExisting : 0],
      [input.scope === "full" ? "full_scope_reports_existing_violations_without_blocking" : "", input.scope === "full" ? touchedExisting : 0]
    ])
  };
}

function countFindingsBy<T extends string>(
  findings: Finding[],
  selector: (finding: Finding) => T
): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const finding of findings) {
    const key = selector(finding);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function compactReasons(entries: Array<[string, number]>): Array<{ reason: string; count: number }> {
  return entries
    .filter(([reason, count]) => reason.length > 0 && count > 0)
    .map(([reason, count]) => ({ reason, count }));
}

async function runEngineOwnedDirectDataAccessCheck(input: {
  repoId: string;
  repoRoot: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
  contractFingerprintValue: string;
  diffHash: string;
}): Promise<{ findings: Finding[]; waivedFindings: WaivedFinding[]; waivedFindingsCount: number }> {
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  let waivedFindingsCount = 0;

  for (const convention of input.contract.conventions) {
    if (
      convention.kind !== "api_route_no_direct_data_access" ||
      convention.enforcement_mode === "off" ||
      convention.enforcement_capability !== "deterministic_check" ||
      !isActiveConvention(convention, input.now)
    ) {
      continue;
    }

    const files = filesForConvention(input.parsedDiff, convention, input.scope)
      .filter((filePath) => isApiRoutePath(filePath) && !isExceptedPath(filePath, convention, input.now));
    const fileSet = new Set(files);
    const skippedImportFactIds = new Set<string>();
    const importFactsByEvidence = new Map<string, ReturnType<typeof importFactsForFile>[number]>();
    const allowedGraphImportFacts = new Map<string, ReturnType<typeof importFactsForFile>[number]>();

    for (const filePath of files) {
      for (const importUsed of importFactsForFile(input.checkData.facts, filePath)) {
        const forbiddenImports = convention.matcher.forbidden_imports ?? [];
        const directlyForbidden = isForbiddenImport(importUsed.value, forbiddenImports);
        const graphForbidden = graphImportResolvesToForbidden(input.checkData, filePath, importUsed, forbiddenImports);
        if (isExceptedImport(
          filePath,
          importUsed.name,
          importUsed.value,
          convention,
          input.now,
          exceptionContextForImport(input.checkData, filePath, importUsed)
        )) {
          skippedImportFactIds.add(importUsed.fact_id);
          continue;
        }
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.value, input.contract, input.now);
        if (waiver) {
          const staleWaiver = waiverRequiresReapproval(
            waiver,
            filePath,
            input.snapshotsByPath.get(filePath)?.content_hash
          );
          if (staleWaiver) {
            findings.push(waiverReapprovalFinding({
              repoId: input.repoId,
              repoContractId: input.contract.id,
              conventionId: convention.id,
              checkId: input.checkId,
              scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
              filePath,
              line: importUsed.start_line,
              symbol: importUsed.name,
              importSource: importUsed.value,
              fileHash: input.snapshotsByPath.get(filePath)?.content_hash ?? "",
              waiverId: waiver.id,
              now: input.now
            }));
          } else {
          skippedImportFactIds.add(importUsed.fact_id);
          if (directlyForbidden || graphForbidden) {
            waivedFindingsCount += 1;
            waivedFindings.push({
              waiver_id: waiver.id,
              convention_id: convention.id,
              file_path: filePath,
              symbol: importUsed.name,
              import_source: importUsed.value,
              line: importUsed.start_line,
              reason: waiver.reason
            });
          }
          continue;
          }
        }
        allowedGraphImportFacts.set(importFactGraphKey(filePath, importUsed), importUsed);
        importFactsByEvidence.set(`${filePath}:${importUsed.start_line}`, importUsed);
        if (!directlyForbidden && !graphForbidden) {
          continue;
        }
      }
    }

    const facts = input.checkData.facts.filter((fact) =>
      fileSet.has(fact.file_path) && !skippedImportFactIds.has(fact.id)
    );
    const snapshots = input.checkData.snapshots.filter((snapshot) => fileSet.has(snapshot.file_path));
    const graph = graphForEngineCheck(input.checkData, fileSet, allowedGraphImportFacts);
    const result = await runEngineCheck({
      repoId: input.repoId,
      repoRoot: input.repoRoot,
      scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
      contractId: input.contract.id,
      contractSchemaVersion: input.contract.contract_schema_version,
      contractWaivers: input.contract.waivers,
      facts,
      snapshots,
      graphNodes: graph.nodes,
      graphEdges: graph.edges,
      graphEvidence: graph.evidence,
      graphDiagnostics: graph.diagnostics,
      conventions: [convention],
      baseline: input.baseline,
      diff: input.parsedDiff,
      scope: input.scope
    });
    for (const engineFinding of result.findings) {
      const evidence = engineFinding.evidence[0];
      if (!evidence) {
        continue;
      }
      const importUsed = importFactsByEvidence.get(`${evidence.file_path}:${evidence.start_line ?? 1}`);
      const snapshot = input.snapshotsByPath.get(evidence.file_path);
      const preserved = preservedGovernanceStatus(input.existingFindings.get(engineFinding.fingerprint));
      findings.push({
        id: engineFinding.id,
        repo_id: input.repoId,
        convention_id: engineFinding.convention_id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint: engineFinding.fingerprint,
        title: engineFinding.title,
        message: engineFinding.message,
        severity: engineFinding.severity,
        enforcement_result: engineFinding.enforcement_result,
        status: engineFinding.status_hint === "pre_existing" ? "pre_existing" : preserved ?? "new",
        diff_status: engineFinding.diff_status,
        evidence_refs: [{
          id: evidence.evidence_id ?? `evidence_${engineFinding.fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: evidence.file_path,
          start_line: evidence.start_line,
          end_line: evidence.end_line,
          symbol: importUsed?.name,
          import_source: importUsed?.value,
          fact_ids: importUsed?.fact_id ? [importUsed.fact_id] : [],
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: "service",
        actual_layer: "data_access",
        graph_path: graphPathForFinding(engineFinding.related_node_ids, evidence.file_path, importUsed?.value),
        suggested_fix: directDataAccessSuggestedFix(),
        related_node_ids: engineFinding.related_node_ids,
        created_at: input.now
      });
    }
  }

  return { findings, waivedFindings, waivedFindingsCount };
}

async function runEngineOwnedAuthCheck(input: {
  repoId: string;
  repoRoot: string;
  contract: RepoContract;
  now: string;
  scope: "changed-hunks" | "changed-files" | "full";
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  baseline: ReturnType<SqliteDriftStorage["listBaselineViolations"]>;
  existingFindings: Map<string, Finding>;
  checkData: ScanData;
  snapshotsByPath: Map<string, ScanData["snapshots"][number]>;
  checkId: string;
  checkScanId: string;
}): Promise<{
  findings: Finding[];
  waivedFindings: WaivedFinding[];
  waivedFindingsCount: number;
  securityBoundaryProofs: SecurityBoundaryProof[];
}> {
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
  let waivedFindingsCount = 0;
  const securityBoundaryProofs: SecurityBoundaryProof[] = [];

  for (const convention of input.contract.conventions) {
    if (
      (
        convention.kind !== "api_route_requires_auth_helper" &&
        convention.kind !== "api_route_requires_request_validation" &&
        convention.kind !== "api_route_forbids_untrusted_ssrf" &&
        convention.kind !== "api_route_forbids_raw_sql_without_params" &&
        convention.kind !== "api_route_cors_must_match_policy" &&
        convention.kind !== "api_route_requires_csrf_for_mutation" &&
        convention.kind !== "api_route_requires_rate_limit" &&
        convention.kind !== "api_route_forbids_sensitive_response_fields" &&
        convention.kind !== "api_route_forbids_secret_exposure" &&
        convention.kind !== "session_object_must_come_from_trusted_helper" &&
        convention.kind !== "api_route_requires_authorization" &&
        convention.kind !== "api_route_requires_tenant_scope"
      ) ||
      convention.enforcement_mode === "off" ||
      convention.enforcement_capability !== "deterministic_check" ||
      !isActiveConvention(convention, input.now)
    ) {
      continue;
    }

    const files = filesForConvention(input.parsedDiff, convention, input.scope)
      .filter((filePath) => isApiRoutePath(filePath) && !isExceptedPath(filePath, convention, input.now));
    const fileSet = new Set(files);
    if (fileSet.size === 0) {
      continue;
    }

    const result = await runEngineCheck({
      repoId: input.repoId,
      repoRoot: input.repoRoot,
      scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
      contractId: input.contract.id,
      contractSchemaVersion: input.contract.contract_schema_version,
      contractWaivers: input.contract.waivers,
      facts: input.checkData.facts.filter((fact) => fileSet.has(fact.file_path)),
      snapshots: input.checkData.snapshots.filter((snapshot) => fileSet.has(snapshot.file_path)),
      conventions: [convention],
      baseline: input.baseline,
      diff: input.parsedDiff,
      scope: input.scope
    });
    securityBoundaryProofs.push(
      ...result.security_boundary_proofs.map((proof) => SecurityBoundaryProofSchema.parse(proof))
    );

    for (const engineFinding of result.findings) {
      const evidence = engineFinding.evidence[0];
      if (!evidence) {
        continue;
      }
      const evidenceStartLine = evidence.start_line ?? 1;
      const evidenceEndLine = evidence.end_line ?? evidenceStartLine;
      const snapshot = input.snapshotsByPath.get(evidence.file_path);
      const evidenceFacts = input.checkData.facts
        .filter((fact) =>
          fact.file_path === evidence.file_path &&
          fact.start_line >= evidenceStartLine &&
          fact.end_line <= evidenceEndLine
        )
        .map((fact) => fact.id);
      const preserved = preservedGovernanceStatus(input.existingFindings.get(engineFinding.fingerprint));
      const isRequestValidationFinding = engineFinding.rule_id === "api_route_requires_request_validation";
      const isPhase6Finding = isPhase6SecurityFinding(engineFinding.rule_id);
      const isPhase5Finding = isPhase5SecurityFinding(engineFinding.rule_id);
      const isPhase4Finding = isPhase4SecurityFinding(engineFinding.rule_id);
      const proofForFinding = result.security_boundary_proofs.find((proof) =>
        proof.result.finding_ids.includes(engineFinding.id)
      );
      const waiver = isPhase4Finding || isPhase5Finding
        ? findContractWaiverForImport(
            evidence.file_path,
            isPhase5Finding
              ? phase5ExpectedLayer(engineFinding.rule_id)
              : phase4ExpectedLayer(engineFinding.rule_id),
            isPhase5Finding
              ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
              : phase4ActualLayer(proofForFinding),
            input.contract,
            input.now
          )
        : undefined;
      if (waiver) {
        const staleWaiver = waiverRequiresReapproval(
          waiver,
          evidence.file_path,
          snapshot?.content_hash
        );
        if (staleWaiver) {
          findings.push(waiverReapprovalFinding({
            repoId: input.repoId,
            repoContractId: input.contract.id,
            conventionId: engineFinding.convention_id,
            checkId: input.checkId,
            scanId: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
            filePath: evidence.file_path,
            line: evidenceStartLine,
            symbol: isPhase5Finding
              ? phase5ExpectedLayer(engineFinding.rule_id)
              : phase4ExpectedLayer(engineFinding.rule_id),
            importSource: isPhase5Finding
              ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
              : phase4ActualLayer(proofForFinding),
            fileHash: snapshot?.content_hash ?? "",
            waiverId: waiver.id,
            now: input.now
          }));
        } else {
          waivedFindingsCount += 1;
          waivedFindings.push({
            waiver_id: waiver.id,
            convention_id: engineFinding.convention_id,
            file_path: evidence.file_path,
            symbol: isPhase5Finding
              ? phase5ExpectedLayer(engineFinding.rule_id)
              : phase4ExpectedLayer(engineFinding.rule_id),
            import_source: isPhase5Finding
              ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
              : phase4ActualLayer(proofForFinding),
            line: evidenceStartLine,
            reason: waiver.reason
          });
        }
        continue;
      }
      findings.push({
        id: engineFinding.id,
        repo_id: input.repoId,
        convention_id: engineFinding.convention_id,
        check_id: input.checkId,
        repo_contract_id: input.contract.id,
        fingerprint: engineFinding.fingerprint,
        title: engineFinding.title,
        message: engineFinding.message,
        severity: engineFinding.severity,
        enforcement_result: engineFinding.enforcement_result,
        status: engineFinding.status_hint === "pre_existing" ? "pre_existing" : preserved ?? "new",
        diff_status: engineFinding.diff_status,
        evidence_refs: [{
          id: evidence.evidence_id ?? `evidence_${engineFinding.fingerprint.slice(0, 16)}`,
          kind: "violation",
          file_path: evidence.file_path,
          start_line: evidenceStartLine,
          end_line: evidenceEndLine,
          fact_ids: evidenceFacts,
          scan_id: input.checkData.snapshots[0]?.scan_id ?? input.checkScanId,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        expected_layer: isRequestValidationFinding
          ? "request_validation"
          : isPhase6Finding
            ? phase6ExpectedLayer(engineFinding.rule_id)
          : isPhase5Finding
            ? phase5ExpectedLayer(engineFinding.rule_id)
          : isPhase4Finding
            ? phase4ExpectedLayer(engineFinding.rule_id)
            : "auth_guard",
        actual_layer: isRequestValidationFinding
          ? requestValidationActualLayer(proofForFinding)
          : isPhase6Finding
            ? phase6ActualLayer(proofForFinding)
          : isPhase5Finding
            ? phase5ActualLayer(proofForFinding, engineFinding.rule_id)
          : isPhase4Finding
            ? phase4ActualLayer(proofForFinding)
            : "missing_auth_guard",
        graph_path: [evidence.file_path],
        suggested_fix: isRequestValidationFinding
          ? "Validate request input with an accepted validator before using it at protected route sinks."
          : isPhase6Finding
            ? "Add accepted Phase 6 proof before SSRF, raw SQL, CORS, CSRF, or rate-limit protected sinks."
          : isPhase5Finding
            ? phase5SuggestedFix(engineFinding.rule_id)
          : isPhase4Finding
            ? "Add accepted session trust, authorization, and tenant-scope proof before protected route sinks."
            : "Call an accepted auth helper before route data operations or response sinks.",
        related_node_ids: engineFinding.related_node_ids,
        created_at: input.now
      });
    }
  }

  return { findings, waivedFindings, waivedFindingsCount, securityBoundaryProofs };
}

function isPhase5SecurityFinding(ruleId: string): boolean {
  return ruleId === "api_route_forbids_sensitive_response_fields" ||
    ruleId === "api_route_forbids_secret_exposure";
}

function isPhase6SecurityFinding(ruleId: string): boolean {
  return ruleId === "api_route_forbids_untrusted_ssrf" ||
    ruleId === "api_route_forbids_raw_sql_without_params" ||
    ruleId === "api_route_cors_must_match_policy" ||
    ruleId === "api_route_requires_csrf_for_mutation" ||
    ruleId === "api_route_requires_rate_limit";
}

function phase6ExpectedLayer(ruleId: string): string {
  if (ruleId === "api_route_forbids_untrusted_ssrf") {
    return "outbound_request";
  }
  if (ruleId === "api_route_forbids_raw_sql_without_params") {
    return "raw_sql";
  }
  if (ruleId === "api_route_cors_must_match_policy") {
    return "cors_policy";
  }
  if (ruleId === "api_route_requires_csrf_for_mutation") {
    return "csrf_guard";
  }
  if (ruleId === "api_route_requires_rate_limit") {
    return "rate_limit_guard";
  }
  return "security_boundary";
}

function phase6ActualLayer(proof: unknown): string {
  if (!proof || typeof proof !== "object") {
    return "missing_phase6_proof";
  }
  const candidate = proof as {
    parser_gaps?: Array<{ code?: unknown }>;
    missing_proof?: Array<{ code?: unknown }>;
  };
  const parserGapCode = candidate.parser_gaps?.find((gap) =>
    typeof gap.code === "string"
  )?.code;
  if (typeof parserGapCode === "string") {
    return parserGapCode;
  }
  const missingProofCode = candidate.missing_proof?.find((missing) =>
    typeof missing.code === "string"
  )?.code;
  return typeof missingProofCode === "string" ? missingProofCode : "missing_phase6_proof";
}

function isPhase4SecurityFinding(ruleId: string): boolean {
  return ruleId === "session_object_must_come_from_trusted_helper" ||
    ruleId === "api_route_requires_authorization" ||
    ruleId === "api_route_requires_tenant_scope";
}

function phase5ExpectedLayer(ruleId: string): string {
  return ruleId === "api_route_forbids_sensitive_response_fields"
    ? "response_shape"
    : "secret_exposure";
}

function phase5SuggestedFix(ruleId: string): string {
  return ruleId === "api_route_forbids_sensitive_response_fields"
    ? "Filter accepted sensitive response fields with an accepted serializer before responding."
    : "Keep secret reads out of responses and accepted log sinks.";
}

function phase5ActualLayer(proof: unknown, ruleId: string): string {
  if (!proof || typeof proof !== "object") {
    return ruleId === "api_route_forbids_sensitive_response_fields"
      ? "dynamic_response_shape_missing_proof"
      : "secret_exposure_not_excluded";
  }
  const candidate = proof as {
    parser_gaps?: Array<{ code?: unknown }>;
    missing_proof?: Array<{ code?: unknown }>;
    response_shape?: {
      sensitive_leaks?: unknown[];
    };
    sinks?: {
      secrets?: unknown[];
    };
  };
  const missingProofCode = candidate.missing_proof?.find((missing) =>
    typeof missing.code === "string"
  )?.code;
  if (typeof missingProofCode === "string") {
    return missingProofCode;
  }
  const parserGapCode = candidate.parser_gaps?.find((gap) =>
    typeof gap.code === "string"
  )?.code;
  if (typeof parserGapCode === "string") {
    return parserGapCode;
  }
  if (ruleId === "api_route_forbids_sensitive_response_fields") {
    return (candidate.response_shape?.sensitive_leaks?.length ?? 0) > 0
      ? "sensitive_response_field_unfiltered"
      : "dynamic_response_shape_missing_proof";
  }
  return (candidate.sinks?.secrets?.length ?? 0) > 0
    ? "secret_exposure_not_excluded"
    : "secret_exposure_not_excluded";
}

function phase4ExpectedLayer(ruleId: string): string {
  if (ruleId === "session_object_must_come_from_trusted_helper") {
    return "session_trust";
  }
  if (ruleId === "api_route_requires_authorization") {
    return "authorization";
  }
  if (ruleId === "api_route_requires_tenant_scope") {
    return "tenant_scope";
  }
  return "security_boundary";
}

function phase4ActualLayer(proof: SecurityBoundaryProof | undefined): string {
  return proof?.missing_proof[0]?.code ?? proof?.parser_gaps[0]?.code ?? "missing_proof";
}

function requestValidationActualLayer(proof: unknown): string {
  if (!proof || typeof proof !== "object") {
    return "request_input_not_validated";
  }
  const candidate = proof as {
    parser_gaps?: Array<{ code?: unknown }>;
    missing_proof?: Array<{ code?: unknown }>;
    request_validation?: {
      unvalidated_uses?: Array<{ reason?: unknown }>;
    };
  };
  const parserGapCode = candidate.parser_gaps?.find((gap) =>
    typeof gap.code === "string"
  )?.code;
  if (typeof parserGapCode === "string") {
    return parserGapCode;
  }
  const missingProofCode = candidate.missing_proof?.find((missing) =>
    typeof missing.code === "string"
  )?.code;
  if (typeof missingProofCode === "string") {
    return missingProofCode;
  }
  const unvalidatedReason = candidate.request_validation?.unvalidated_uses?.find((use) =>
    typeof use.reason === "string"
  )?.reason;
  return typeof unvalidatedReason === "string" ? unvalidatedReason : "request_input_not_validated";
}

function graphForEngineCheck(
  checkData: ScanData,
  fileSet: Set<string>,
  allowedImportFacts: Map<string, ReturnType<typeof importFactsForFile>[number]>
): {
  nodes: ScanData["graph_nodes"];
  edges: ScanData["graph_edges"];
  evidence: ScanData["graph_evidence"];
  diagnostics: ScanData["graph_diagnostics"];
} {
  const evidenceById = new Map(checkData.graph_evidence.map((evidence) => [evidence.id, evidence]));
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  const allowedImportNodeIds = new Set(
    checkData.graph_nodes
      .filter((node) => node.kind === "import_decl")
      .filter((node) => {
        const key = importNodeGraphKey(node, evidenceById);
        return key ? allowedImportFacts.has(key) : false;
      })
      .map((node) => node.id)
  );
  const allowedNodeIds = new Set<string>();

  for (const node of checkData.graph_nodes) {
    const filePath = stringMetadata(node.metadata, "file_path") ?? stringMetadata(node.metadata, "path");
    if (filePath && fileSet.has(filePath)) {
      allowedNodeIds.add(node.id);
    }
    if (node.kind === "file_role") {
      allowedNodeIds.add(node.id);
    }
  }
  for (const importNodeId of allowedImportNodeIds) {
    allowedNodeIds.add(importNodeId);
  }

  const edgeKindsForCheck = new Set([
    "FILE_HAS_ROLE",
    "FILE_DEFINES_MODULE",
    "IMPORT_DECL_REFERENCES_MODULE",
    "IMPORT_RESOLVES_TO_MODULE",
    "MODULE_IMPORTS_MODULE"
  ]);
  const keptEdges = checkData.graph_edges.filter((edge) => {
    if (!edgeKindsForCheck.has(edge.kind)) {
      return false;
    }
    if (edge.kind.startsWith("IMPORT_") && !allowedImportNodeIds.has(edge.from)) {
      return false;
    }
    if (edge.kind === "MODULE_IMPORTS_MODULE") {
      const from = nodesById.get(edge.from);
      const fromPath = from ? stringMetadata(from.metadata, "file_path") : undefined;
      if (!fromPath || !fileSet.has(fromPath)) {
        return false;
      }
    }
    if (edge.kind === "FILE_HAS_ROLE" || edge.kind === "FILE_DEFINES_MODULE") {
      const from = nodesById.get(edge.from);
      const fromPath = from ? stringMetadata(from.metadata, "path") : undefined;
      if (!fromPath || !fileSet.has(fromPath)) {
        return false;
      }
    }
    allowedNodeIds.add(edge.from);
    allowedNodeIds.add(edge.to);
    return true;
  });

  const keptEvidenceIds = new Set<string>();
  const keptNodes = checkData.graph_nodes.filter((node) => {
    if (!allowedNodeIds.has(node.id)) {
      return false;
    }
    for (const evidenceId of node.evidence_ids) {
      keptEvidenceIds.add(evidenceId);
    }
    return true;
  });
  for (const edge of keptEdges) {
    for (const evidenceId of edge.evidence_ids) {
      keptEvidenceIds.add(evidenceId);
    }
  }

  return {
    nodes: keptNodes,
    edges: keptEdges,
    evidence: checkData.graph_evidence.filter((evidence) => keptEvidenceIds.has(evidence.id)),
    diagnostics: checkData.graph_diagnostics.filter((diagnostic) =>
      !diagnostic.file_path || fileSet.has(diagnostic.file_path)
    )
  };
}

function graphImportResolvesToForbidden(
  checkData: ScanData,
  filePath: string,
  importUsed: ReturnType<typeof importFactsForFile>[number],
  forbiddenImports: string[]
): boolean {
  if (forbiddenImports.length === 0) {
    return false;
  }
  const evidenceById = new Map(checkData.graph_evidence.map((evidence) => [evidence.id, evidence]));
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  const importKey = importFactGraphKey(filePath, importUsed);
  const importNode = checkData.graph_nodes.find((node) =>
    node.kind === "import_decl" && importNodeGraphKey(node, evidenceById) === importKey
  );
  if (!importNode) {
    return false;
  }
  return checkData.graph_edges
    .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE" && edge.from === importNode.id)
    .some((edge) => {
      const resolved = nodesById.get(edge.to);
      const resolvedPath = resolved ? stringMetadata(resolved.metadata, "file_path") : undefined;
      return Boolean(resolvedPath && isForbiddenImport(resolvedPath, forbiddenImports));
    });
}

function exceptionContextForImport(
  checkData: ScanData,
  filePath: string,
  importUsed: ReturnType<typeof importFactsForFile>[number]
): {
  endpointPaths: string[];
  methods: string[];
  resolvedModules: string[];
  resolvedSymbols: string[];
  dataStores: string[];
  operationKinds: string[];
} {
  const evidenceById = new Map(checkData.graph_evidence.map((evidence) => [evidence.id, evidence]));
  const nodesById = new Map(checkData.graph_nodes.map((node) => [node.id, node]));
  const importKey = importFactGraphKey(filePath, importUsed);
  const importNode = checkData.graph_nodes.find((node) =>
    node.kind === "import_decl" && importNodeGraphKey(node, evidenceById) === importKey
  );
  const endpointNodes = checkData.graph_nodes.filter((node) =>
    node.kind === "endpoint" && stringMetadata(node.metadata, "file_path") === filePath
  );
  const dataOperationNodes = checkData.graph_nodes.filter((node) =>
    node.kind === "data_operation" &&
    stringMetadata(node.metadata, "file_path") === filePath &&
    stringMetadata(node.metadata, "receiver_root") === importUsed.name
  );
  const resolvedModules = importNode
    ? checkData.graph_edges
        .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE" && edge.from === importNode.id)
        .map((edge) => nodesById.get(edge.to))
        .flatMap((node) => node ? [stringMetadata(node.metadata, "file_path")] : [])
        .filter((value): value is string => typeof value === "string")
    : [];
  const resolvedSymbols = importNode
    ? checkData.graph_edges
        .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_SYMBOL" && edge.from === importNode.id)
        .map((edge) => nodesById.get(edge.to)?.label)
        .filter((value): value is string => typeof value === "string")
    : [];

  return {
    endpointPaths: uniqueStrings(endpointNodes.flatMap((node) => metadataValues(node.metadata, "route_pattern"))),
    methods: uniqueStrings(endpointNodes.flatMap((node) => metadataValues(node.metadata, "method"))),
    resolvedModules: uniqueStrings(resolvedModules),
    resolvedSymbols: uniqueStrings(resolvedSymbols),
    dataStores: uniqueStrings(dataOperationNodes.flatMap((node) => metadataValues(node.metadata, "store_name"))),
    operationKinds: uniqueStrings(dataOperationNodes.flatMap((node) => metadataValues(node.metadata, "operation_kind")))
  };
}

function metadataValues(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return typeof value === "string" ? [value] : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function importFactGraphKey(filePath: string, importUsed: ReturnType<typeof importFactsForFile>[number]): string {
  return `${filePath}:${importUsed.name}:${importUsed.value}:${importUsed.start_line}`;
}

function importNodeGraphKey(
  node: ScanData["graph_nodes"][number],
  evidenceById: Map<string, ScanData["graph_evidence"][number]>
): string | undefined {
  const filePath = stringMetadata(node.metadata, "file_path");
  const localName = stringMetadata(node.metadata, "local_name");
  const source = stringMetadata(node.metadata, "source");
  const line = node.evidence_ids
    .map((id) => evidenceById.get(id)?.start_line)
    .find((startLine): startLine is number => typeof startLine === "number");
  if (!filePath || !localName || !source || !line) {
    return undefined;
  }
  return `${filePath}:${localName}:${source}:${line}`;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

export function expireFindingsForExpiredConventions(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  repoId: string,
  contract: RepoContract,
  now: string
): number {
  const expiredConventionIds = new Set(
    contract.conventions
      .filter((convention) => convention.expires_at && convention.expires_at <= now)
      .map((convention) => convention.id)
  );
  if (expiredConventionIds.size === 0) {
    return 0;
  }

  let expiredCount = 0;
  const actor = actorFlag(parsed);
  for (const finding of storage.listFindings(repoId)) {
    if (!expiredConventionIds.has(finding.convention_id) || isClosedFindingStatus(finding.status)) {
      continue;
    }

    const updated: Finding = {
      ...finding,
      status: "expired"
    };
    storage.upsertFinding(updated);
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_finding_expired_${repoId}_${finding.id}_${now}`,
      repoId,
      actor,
      action: "finding_resolved",
      targetType: "finding",
      targetId: finding.id,
      metadata: {
        status: "expired",
        reason: "convention_expired",
        convention_id: finding.convention_id
      },
      createdAt: now
    }));
    expiredCount += 1;
  }
  return expiredCount;
}

export function runFullRepoCheck(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  repoId: string,
  now: string
): Finding[] {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    return [];
  }
  const checkId = `check_full_${hashStable(`${repoId}:${now}`).slice(0, 16)}`;

  const files = walkIndexableFiles(repo.root_path).filter(isApiRoutePath);
  const diff = {
    files: files.map((path) => ({ path, changedLines: new Set<number>() })),
    deletedFiles: []
  };
  const contract = storage.getRepoContract(repoId);
  if (!contract) {
    return [];
  }
  const latestScan = storage.listScanManifests(repoId).find((scan) => scan.status === "completed");
  const snapshotsByPath = new Map(
    latestScan
      ? storage.listFileSnapshots(repoId, latestScan.id).map((snapshot) => [snapshot.file_path, snapshot])
      : []
  );
  const importFactsByKey = new Map(
    latestScan
      ? storage.listFacts(latestScan.id, { kind: "import_used" }).map((fact) => [
          importFactEvidenceKey(fact.file_path, fact.start_line, fact.name, String(fact.value ?? "")),
          fact.id
        ])
      : []
  );

  const findings: Finding[] = [];
  for (const convention of contract.conventions) {
    if (convention.kind !== "api_route_no_direct_data_access") {
      continue;
    }

    for (const filePath of filesForConvention(diff, convention, "full")) {
      if (isExceptedPath(filePath, convention, now)) {
        continue;
      }
      const source = readFileSync(join(repo.root_path, filePath), "utf8");
      for (const importUsed of extractImports(source)) {
        if (!isForbiddenImport(importUsed.source, convention.matcher.forbidden_imports ?? [])) {
          continue;
        }
        if (isExceptedImport(filePath, importUsed.name, importUsed.source, convention, now)) {
          continue;
        }
        const snapshot = snapshotsByPath.get(filePath);
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.source, contract, now);
        if (waiver) {
          const staleWaiver = waiverRequiresReapproval(
            waiver,
            filePath,
            snapshot?.content_hash
          );
          if (staleWaiver) {
            findings.push(waiverReapprovalFinding({
              repoId,
              repoContractId: contract.id,
              conventionId: convention.id,
              checkId,
              scanId: snapshot?.scan_id ?? checkId,
              filePath,
              line: importUsed.line,
              symbol: importUsed.name,
              importSource: importUsed.source,
              fileHash: snapshot?.content_hash ?? "",
              waiverId: waiver.id,
              now
            }));
          } else {
            continue;
          }
        }

        const fingerprint = findingFingerprint(convention.id, filePath, importUsed.name, importUsed.source);
        const factId = importFactsByKey.get(
          importFactEvidenceKey(filePath, importUsed.line, importUsed.name, importUsed.source)
        );
        const finding: Finding = {
          id: `finding_${fingerprint.slice(0, 16)}`,
          repo_id: repoId,
          convention_id: convention.id,
          fingerprint,
          title: "API route imports data access directly",
          message: `${filePath} imports ${importUsed.name} from ${importUsed.source} directly; route modules should delegate through the accepted service/data-access layer.`,
          severity: convention.severity,
          enforcement_result: enforcementResultFor(convention.enforcement_mode),
          status: "new",
          diff_status: "touched_existing",
          evidence_refs: [{
            id: `evidence_${fingerprint.slice(0, 16)}`,
            kind: "violation",
            file_path: filePath,
            start_line: importUsed.line,
            end_line: importUsed.end_line,
            symbol: importUsed.name,
            import_source: importUsed.source,
            fact_ids: factId ? [factId] : [],
            scan_id: latestScan?.id ?? `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`,
            file_hash: snapshot?.content_hash ?? fileContentHash(join(repo.root_path, filePath)),
            redaction_state: "none"
          }],
          created_at: now
        };
        storage.upsertFinding(finding);
        findings.push(finding);
      }
    }
  }

  return findings;
}

function importFactEvidenceKey(filePath: string, line: number, name: string, source: string): string {
  return `${filePath}\0${line}\0${name}\0${source}`;
}

export function checkNextCommands(
  repoId: string,
  summary: { findingCount: number; openNewCount: number; blockingCount: number }
): string[] {
  const commands = [
    summary.openNewCount > 0
      ? `drift findings list --repo ${repoId} --status new --json`
      : `drift findings list --repo ${repoId} --json`,
    `drift prepare "task" --repo ${repoId} --json`
  ];
  if (summary.findingCount > 0) {
    commands.push(`drift baseline create --repo ${repoId} --from main --confirm --json`);
  }
  if (summary.blockingCount > 0) {
    commands.push(`drift audit list --repo ${repoId} --action finding_resolved --json`);
  }
  return commands;
}
