import { authorizeContextExport,type Finding,type RepoContract } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { isClosedFindingStatus,preservedGovernanceStatus,reviewFinding } from "../domain/findings.js";
import { auditEvent,preflightGovernance } from "../domain/governance.js";
import { hashStable } from "../domain/identifiers.js";
import { WaivedFinding } from "../domain/preflight.js";
import { isApiRoutePath } from "../domain/repo-paths.js";
import { collectScanData,type ScanData } from "../engine/collect-scan-data.js";
import { runEngineCheck } from "../engine/engine-check.js";
import { extractImports,importFactsForFile } from "../engine/fact-extraction.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";
import { formatCheckText } from "../formatters/checks.js";
import { fileContentHash } from "../io/file-hash.js";
import { diffStatusFor,filesForConvention,fullRepoDiff,loadDiff,parseUnifiedDiff } from "./diff.js";
import { findingFingerprint } from "./finding-fingerprint.js";
import { enforcementResultFor,isActiveConvention,isForbiddenImport } from "./rule-evaluation.js";
import { findContractWaiverForImport,isExceptedImport,isExceptedPath } from "./waivers.js";

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
  const parsedDiff = scope === "full"
    ? fullRepoDiff(repo.root_path)
    : parseUnifiedDiff(loadDiff(repo.root_path, parsed));
  const baseline = storage.listBaselineViolations(repoId);
  const existingFindings = new Map(
    storage.listFindings(repoId).map((finding) => [finding.fingerprint, finding])
  );
  const expiredFindingsCount = expireFindingsForExpiredConventions(storage, parsed, repoId, contract, now);
  const checkData = await collectScanData({
    repoId,
    scanId: `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`,
    repoRoot: repo.root_path
  });
  const snapshotsByPath = new Map(checkData.snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const findings: Finding[] = [];
  const waivedFindings: WaivedFinding[] = [];
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
    snapshotsByPath
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
        if (isExceptedImport(filePath, importUsed.name, importUsed.value, convention, now)) {
          continue;
        }
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.value, contract, now);
        if (waiver) {
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
            scan_id: checkData.snapshots[0]?.scan_id ?? `scan_check_${hashStable(`${repoId}:${now}`).slice(0, 16)}`,
            file_hash: snapshot?.content_hash ?? "",
            redaction_state: "none"
          }],
          created_at: now
        };
        storage.upsertFinding(finding);
        findings.push(finding);
      }
    }
  }
  }

  const blockingCount = findings.filter((finding) =>
    finding.status === "new" &&
    finding.diff_status === "new_in_diff" &&
    finding.enforcement_result === "block"
  ).length;
  const openNewCount = findings.filter((finding) => finding.status === "new").length;
  const payload = {
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
      engine_source: checkData.engineSource
    },
    review_items: findings.map(reviewFinding),
    waived_findings: waivedFindings,
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
        if (isExceptedImport(filePath, importUsed.name, importUsed.value, convention, input.now)) {
          skippedImportFactIds.add(importUsed.fact_id);
          continue;
        }
        const waiver = findContractWaiverForImport(filePath, importUsed.name, importUsed.value, input.contract, input.now);
        if (waiver) {
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
      scanId: input.checkData.snapshots[0]?.scan_id ?? `scan_check_${hashStable(`${input.repoId}:${input.now}`).slice(0, 16)}`,
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
          scan_id: input.checkData.snapshots[0]?.scan_id ?? `scan_check_${hashStable(`${input.repoId}:${input.now}`).slice(0, 16)}`,
          file_hash: snapshot?.content_hash ?? "",
          redaction_state: "none"
        }],
        created_at: input.now
      });
    }
  }

  return { findings, waivedFindings, waivedFindingsCount };
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
        if (findContractWaiverForImport(filePath, importUsed.name, importUsed.source, contract, now)) {
          continue;
        }

        const fingerprint = findingFingerprint(convention.id, filePath, importUsed.name, importUsed.source);
        const snapshot = snapshotsByPath.get(filePath);
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
            fact_ids: [],
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
