import {
  AgentPreflightPacketV2Schema,
  FileRoleSchema,
  authorizeContextExport,
  createAgentPreflightPacket,
  createContextPolicyMatrix,
  type FileRole
} from "@drift/core";
import { buildChangeImpact,buildParserGapQuality,buildReadiness,buildSemanticCoverageFromCapabilityReport,classifyAgentTask,selectRelevantTests,type ChangeImpactRouteFlow } from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { optionalRepoRelativeFlag,requiredValue,stringFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { isActiveConvention } from "../check/rule-evaluation.js";
import { agentEnvelopeForScan } from "../domain/agent-envelope.js";
import { baselineSummary } from "../domain/baselines.js";
import { isOpenPreflightFinding } from "../domain/findings.js";
import { graphPreflightContext } from "../domain/graph-preflight.js";
import { requiredChecksFromGraphRisk } from "../domain/graph-risk-checks.js";
import { preflightGovernance } from "../domain/governance.js";
import { countDeniedFiles,preflightSummary,preparedConvention,relevantFilesForTask,requiredChecksForFiles,riskyAreasForFiles,waiversForFiles } from "../domain/preflight.js";
import { conformingExemplarContext } from "../domain/conforming-exemplar-context.js";
import { buildGuidanceView } from "@drift/core";
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
  // BB-5: the packet's convention entries carry files that actually conform to each convention.
  //
  // Built from the stored scan rather than a fresh walk, so the exemplars are files Drift has facts
  // about - an exemplar it cannot vouch for is the thing this item exists to stop.
  const exemplarContext = conformingExemplarContext(storage, repoId);
  const conventions = activeConventions.map((convention) =>
    preparedConvention(convention, {
      scopeFiles: exemplarContext.scopeFilesFor(convention),
      violatingFiles: exemplarContext.violatingFilesFor(convention.id),
      roleByFile: exemplarContext.roleByFile,
      baselineActiveCount: exemplarContext.baselineActiveCountFor(convention.id),
      targetPath: targetPath ?? undefined
    })
  );
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
  const requiredChecks = [
    ...requiredChecksForFiles(contract, relevantFiles),
    ...requiredChecksFromGraphRisk({
      repoRoot: repo.root_path,
      graphContext,
      relevantFiles,
      safeCommands: contract.safe_commands
    })
  ];
  const changeImpactRouteFlows = routeFlowsForChangeImpact(graphContext);
  const taskModel = classifyAgentTask(task);
  const testFiles = scanStatus.latest_scan
    ? storage.listFileSnapshots(repoId, scanStatus.latest_scan.id)
        .filter((snapshot) => /(\.test|\.spec)\.[tj]sx?$/.test(snapshot.file_path))
        .map((snapshot) => snapshot.file_path)
    : [];
  const symbolIdentities = scanStatus.latest_scan
    ? storage.listSymbolIdentities(repoId, scanStatus.latest_scan.id)
    : [];
  const changeImpact = buildChangeImpact({
    repo_id: repoId,
    scan_id: scanStatus.latest_scan?.id ?? "scan_missing",
    changed_files: relevantFiles.map((file) => file.path),
    route_flows: changeImpactRouteFlows,
    symbol_identities: symbolIdentities,
    test_files: testFiles
  });
  const testSelection = selectRelevantTests({
    changed_file: relevantFiles[0]?.path ?? targetPath ?? "",
    route_flow: changeImpactRouteFlows[0],
    test_files: testFiles
  });
  const agentContractPacket = createAgentPreflightPacket({
    repoContract: { ...contract, conventions: activeConventions },
    task,
    scan_id: scanStatus.latest_scan?.id ?? null,
    stale: scanStatus.stale,
    explicit_paths: targetPath ? [targetPath] : [],
    changed_paths: relevantFiles.map((file) => file.path),
    file_roles: uniqueFileRoles(relevantFiles),
    graph_node_ids: graphNodeIdsForPreflight(graphContext, relevantFiles)
  });
  const parserGaps = scanStatus.latest_scan
    ? storage.listParserGaps(repoId, scanStatus.latest_scan.id)
    : [];
  const parserGapV2 = scanStatus.latest_scan
    ? storage.listParserGapV2(repoId, scanStatus.latest_scan.id)
    : [];
  const allParserGaps = [...parserGaps, ...parserGapV2];
  const readiness = buildReadiness({
    repo_id: repoId,
    scan_id: scanStatus.latest_scan?.id ?? null,
    surface: "prepare",
    graph_available: graphContext.available,
    graph_complete: graphContext.completeness?.complete ?? false,
    parser_gaps: allParserGaps,
    completeness_reasons: graphContext.completeness?.reasons ?? graphContext.diagnostics,
    required_capabilities: ["ts.route_flow.v1"],
    missing_capabilities: graphContext.available ? [] : ["fact_graph"]
  });
  const semanticCoverage = buildSemanticCoverageFromCapabilityReport({
    repo_id: repoId,
    scan_id: scanStatus.latest_scan?.id ?? "scan_missing",
    scope: "preflight",
    scope_id: targetPath ?? task,
    capability_report: scanStatus.capability_report,
    readiness,
    parser_gaps: allParserGaps,
    generated_at: now
  });
  const parserGapQuality = buildParserGapQuality({
    repo_id: repoId,
    scan_id: scanStatus.latest_scan?.id ?? null,
    surface: "prepare",
    parser_gaps: allParserGaps,
    readiness
  });
  const contextPolicy = createContextPolicyMatrix(contract, policy);
  // BB-6: the one view an agent can eat, built before the envelope so the envelope can reuse its
  // parser-gap summary rather than computing a second, potentially disagreeing one.
  const guidance = buildGuidanceView({
    repoId,
    conventions,
    relevantFiles,
    requiredChecks,
    parserGaps: allParserGaps
  });
  const taskPreflightPacket = AgentPreflightPacketV2Schema.parse({
    schema_version: "drift.agent_preflight.v2",
    repo_id: repoId,
    scan_id: scanStatus.latest_scan?.id ?? "scan_missing",
    task_model: taskModel,
    repo_map_summary: {
      relevant_file_count: relevantFiles.length,
      route_flow_count: graphContext.route_flows.length,
      parser_gap_count: allParserGaps.length
    },
    accepted_conventions: conventions,
    relevant_files: relevantFiles,
    role_layer_proof: [],
    change_impact: changeImpact,
    test_intelligence: testSelection.test_intelligence,
    // BB-6: the summary, not the records. Measured at 358,538 bytes / 639 records on dub - the
    // single largest section of the packet, and one the agent-usage trial dismissed as noise. The
    // records remain reachable through the command named in the summary.
    parser_gaps: {
      count: allParserGaps.length,
      by_code: guidance.parser_gaps.by_code,
      full_list_command: guidance.parser_gaps.full_list_command
    },
    required_checks: requiredChecks,
    forbidden_actions: taskModel.forbidden_actions,
    context_policy: contextPolicy,
    confidence: {
      graph_confidence: readiness.confidence,
      reasons: readiness.reasons
    }
  });
  const auditIntegrity = scanStatus.audit_integrity;
  const redactions = {
    denied_globs: contract.context_egress.denied_globs,
    excluded_file_count: countDeniedFiles(repo.root_path, contract.context_egress.denied_globs),
    snippets_included: false,
    source_content_included: false,
    graph_context_included: graphContext.available,
    context_truncated: false
  };
  const payload = {
    response_schema: "drift.task.preflight.v1",
    // BB-6: first field after the envelope identity, because ordering is the cheapest possible hint
    // about what to read. The full envelope follows for audit.
    guidance,
    repo_id: repoId,
    task,
    target_path: targetPath ?? null,
    generated_at: now,
    agent_envelope: agentEnvelopeForScan({
      surface: "cli-preflight",
      policy,
      scanStatus,
      requireFresh,
      diagnostics: graphContext.diagnostics
    }),
    policy,
    readiness,
    parser_gap_quality: parserGapQuality,
    semantic_coverage: semanticCoverage,
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
    task_model: taskModel,
    task_preflight_packet: taskPreflightPacket,
    change_impact: changeImpact,
    test_intelligence: testSelection.test_intelligence,
    // BB-6 (EW-3 shape): a bare `[]` cannot say whether test selection ran and found nothing or was
    // never implemented for this repo, and the two call for opposite responses from a reader.
    test_intelligence_reason: testSelection.test_intelligence.length === 0
      ? "not_implemented_for_repo"
      : null,
    agent_contract_packet: agentContractPacket,
    baseline,
    findings,
    relevant_files: relevantFiles,
    risky_areas: riskyAreas,
    waivers,
    required_checks: requiredChecks,
    safe_commands: contract.safe_commands,
    governance: preflightGovernance(),
    context_policy: contextPolicy,
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

function routeFlowsForChangeImpact(
  graphContext: ReturnType<typeof graphPreflightContext>
): ChangeImpactRouteFlow[] {
  return graphContext.route_flows.map((flow) => {
    const route = [flow.method, flow.route_pattern].filter(Boolean).join(" ");
    return {
      route: route || flow.path || "unknown route",
      service_file: flow.module_path.find((path) => path.includes("service")),
      data_access_file: flow.module_path.find((path) => path.includes("repositories") || path.includes("data") || path.includes("db")),
      data_operation: graphContext.reachable_data_access
        .flatMap((access) => access.data_operations)
        .map((operation) => [operation.receiver_name, operation.operation_name].filter(Boolean).join("."))
        .find(Boolean)
    };
  });
}

function uniqueFileRoles(relevantFiles: Array<{ roles: string[] }>): FileRole[] {
  return [...new Set(relevantFiles.flatMap((file) => file.roles))]
    .sort()
    .filter(isFileRole);
}

function isFileRole(value: string): value is FileRole {
  return FileRoleSchema.safeParse(value).success;
}

function graphConfidence(graphAvailable: boolean, parserGapCount: number): number {
  if (!graphAvailable) {
    return 0;
  }
  return parserGapCount > 0 ? 0.82 : 1;
}

function graphConfidenceReasons(graphAvailable: boolean, parserGapCount: number): string[] {
  const reasons = [];
  if (!graphAvailable) {
    reasons.push("graph_unavailable");
  }
  if (parserGapCount > 0) {
    reasons.push("parser_gaps_present");
  }
  return reasons;
}

function graphNodeIdsForPreflight(
  graphContext: ReturnType<typeof graphPreflightContext>,
  relevantFiles: Array<{ path: string }>
): string[] {
  return [...new Set([
    ...relevantFiles.map((file) => `file:${file.path}`),
    ...graphContext.route_flows.flatMap((flow) => [
      flow.route_module_id,
      ...flow.route_handler_symbol_ids,
      ...flow.service_module_ids,
      ...flow.data_access_module_ids,
      ...flow.module_path
    ]),
    ...graphContext.reachable_data_access.flatMap((access) => [
      ...access.data_access_module_ids,
      ...access.module_path,
      ...access.data_operations.flatMap((operation) => [
        operation.operation_node_id,
        operation.data_store_node_id
      ])
    ])
  ].filter((id): id is string => Boolean(id)))].sort();
}
