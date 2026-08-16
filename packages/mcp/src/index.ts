import type {
  AcceptedConvention,
  AuditChainVerification,
  ConventionKind,
  EnforcementCapability,
  FileSnapshot,
  FileRole,
  Finding,
  FindingDiffStatus,
  FindingStatus,
  ParserGap,
  ParserGapConfidenceImpact,
  ParserGapKind,
  ParserGapV2,
  PolicyDecision,
  RepoContract,
  RepoRecord,
  RequiredCheckExecution,
  ScanFileChange,
  ScanManifest,
  Severity
} from "@drift/core";
import type { ExemplarContext } from "@drift/core";
import {
  AgentPreflightPacketV2Schema,
  FileRoleSchema,
  authorizeContextExport,
  buildGuidanceView,
  conformingExemplars,
  conventionRationale,
  exemplarContext,
  isOpenFinding,
  migrationSentence,
  canonicalScanStateJson,
  classifyFailure,
  createAgentEnvelopeV2,
  createAgentPreflightPacket,
  createContextPolicyMatrix,
  createDriftCapabilities,
  expandApiRouteScopeGlobs,
  isNextApiRoutePath,
  conventionScopeFiles,
  matchesPolicyGlob,
  nextApiRouteIdentity
} from "@drift/core";
import {
  DRIFT_CONTRACT_SCHEMA_VERSION,
  DRIFT_CORE_VERSION,
  DRIFT_RESOLVER_VERSION,
  DRIFT_RULE_ENGINE_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION,
  type MachineContractVersions
} from "@drift/core";
import {
  ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION,
  ENGINE_CHECK_REQUEST_SCHEMA_VERSION,
  ENGINE_CHECK_RESULT_SCHEMA_VERSION,
  ENGINE_SCAN_REQUEST_SCHEMA_VERSION,
  ENGINE_SCAN_RESULT_SCHEMA_VERSION,
  ENGINE_STREAM_EVENT_SCHEMA_VERSION
} from "@drift/engine-contract";
import { FACTGRAPH_SCHEMA_VERSION } from "@drift/factgraph";
import {
  buildChangeImpact,
  buildCanonicalRouteReadModel,
  buildFrameworkEntrypointReadModel,
  buildFindingsReadModel,
  buildParserGapQuality,
  buildParserGapSummary,
  buildRepoContractReadModel,
  buildReadiness,
  buildSemanticCoverageFromCapabilityReport,
  buildSecurityPhase8ReadModel,
  buildStoredScanReadiness,
  classifyAgentTask,
  buildRepoMapReadModel,
  createGraphQueryService,
  fallbackFactRepoMapFiles,
  repoMapConventionIds,
  repoMapOpenFindingIds,
  repoMapRiskyAreaIds,
  type CanonicalFactRouteInput,
  selectRelevantTests,
  type ChangeImpactRouteFlow,
  type DriftReadinessSurface,
  type RepoMapFile,
  rankRelevantFiles,
  relevantFilesForTask,
  repoMapFileForPayload,
  walkIndexableFiles,buildParserGapSection} from "@drift/query";
import { MIGRATIONS, openDriftStorage } from "@drift/storage";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { buildSecurityContextPayload } from "./security-context.js";
import { DRIFT_READ_ONLY_MCP_TOOLS } from "./tools.js";
import type {
  DriftMcpHandlers,
  DriftMcpOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  McpCliResult,
  PreparedRequiredCheck,
  PreparedRiskArea,
  PreparedWaiver,
  RelevantFile
} from "./types.js";

export { DRIFT_READ_ONLY_MCP_TOOLS } from "./tools.js";
export type {
  DriftMcpHandlers,
  DriftMcpOptions,
  DriftMcpTool,
  JsonRpcRequest,
  JsonRpcResponse,
  McpCliResult
} from "./types.js";

const DRIFT_CLI_VERSION = "0.1.0";

export const DRIFT_MCP_PROTOCOL_VERSION = "2024-11-05";
export const DRIFT_MCP_VERSION = "0.1.0";

export function createReadOnlyMcpHandlers(options: DriftMcpOptions): DriftMcpHandlers {
  return {
    get_runtime_info: () => ({
      runtime: mcpRuntime(),
      v1_scope: mcpV1Scope(),
      governance: preflightGovernance()
    }),

    get_capabilities: () => ({
      runtime: mcpRuntime(),
      v1_scope: mcpV1Scope(),
      governance: preflightGovernance(),
      capabilities: mcpCapabilities()
    }),

    get_audit_status: ({ repo_id }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { policy } = requiredAuthorizedMcpContract(storage, requestedRepoId, "log");
      const verification = storage.verifyAuditChain(requestedRepoId);
      return {
        response_schema: "drift.audit.status.v1",
        repo_id: requestedRepoId,
        policy,
        governance: preflightGovernance(),
        verification,
        audit_integrity: verification,
        summary: auditVerifySummary(verification),
        next_commands: auditVerifyNextCommands(requestedRepoId, verification)
      };
    }),

    get_scan_status: ({ repo_id }) => withStorage(options, (storage) =>
      scanStatusPayload(storage, requiredMcpString(repo_id, "repo_id"))),

    get_repo_contract: ({ repo_id }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { contract, policy } = requiredAuthorizedMcpContract(storage, requestedRepoId, "contract-export");
      return buildRepoContractReadModel({
        repo_id: requestedRepoId,
        contract,
        policy,
        governance: preflightGovernance()
      });
    }),

    get_repo_map: ({ repo_id, role, path, require_fresh, limit, offset }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const requestedPath = path ? requiredRepoRelativeMcpPath(path) : undefined;
      const requestedLimit = optionalMcpPositiveInteger(limit, "limit");
      const requestedOffset = optionalMcpNonNegativeInteger(offset, "offset") ?? 0;
      return repoMapPayload(storage, requestedRepoId, {
        surface: "cli-preflight",
        role,
        path: requestedPath,
        requireFresh: Boolean(require_fresh),
        limit: requestedLimit,
        offset: requestedOffset
      });
    }),

    get_security_context: ({ repo_id, path, changed_files, check_id }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const requestedPath = path ? requiredRepoRelativeMcpPath(path) : undefined;
      const requestedChangedFiles = Array.isArray(changed_files)
        ? changed_files.map((filePath) => requiredRepoRelativeMcpPath(filePath))
        : undefined;
      const { contract } = requiredAuthorizedMcpContract(storage, requestedRepoId, "mcp");
      return buildSecurityContextPayload(storage, requestedRepoId, contract, {
        path: requestedPath,
        changed_files: requestedChangedFiles,
        check_id: check_id ? requiredMcpString(check_id, "check_id") : undefined
      });
    }),

    get_task_preflight: ({ repo_id, task, path, require_fresh, now }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const requestedTask = requiredMcpString(task, "task");
      const requestedPath = path ? requiredRepoRelativeMcpPath(path) : undefined;
      const generatedAt = optionalMcpIsoTimestamp(now, "now") ?? new Date().toISOString();
      const { contract, policy, ready: contractReady } = authorizedMcpContractOrDefault(
        storage,
        requestedRepoId,
        "cli-preflight"
      );
      const activeConventions = contract.conventions.filter((convention) =>
        !convention.expires_at || convention.expires_at > generatedAt
      );
      const relevantFiles = relevantFilesForTask({
        repoRoot: storage.getRepo(requestedRepoId)!.root_path,
        task: requestedTask,
        contract: { ...contract, conventions: activeConventions },
        targetPath: requestedPath
      });
      const scanStatus = scanStatusPayload(storage, requestedRepoId);
      assertFreshScanIfRequired(requestedRepoId, scanStatus, Boolean(require_fresh));
      const baseline = baselineSummary(storage, requestedRepoId);
      const candidateCount = storage.listConventionCandidates(requestedRepoId, { status: "candidate" }).length;
      const findings = storage.listFindings(requestedRepoId)
        .filter(isOpenPreflightFinding)
        .map(prepareFinding);
      const riskyAreas = riskyAreasForFiles(contract, relevantFiles);
      const graphContext = graphPreflightContext({
        storage,
        repoId: requestedRepoId,
        scanStatus,
        targetPath: requestedPath,
        relevantFiles
      });
      const requiredChecks = [
        ...requiredChecksForFiles(contract, relevantFiles),
        ...requiredChecksFromGraphRisk({
          repoRoot: storage.getRepo(requestedRepoId)!.root_path,
          graphContext,
          relevantFiles,
          safeCommands: contract.safe_commands
        })
      ];
      const changeImpactRouteFlows = routeFlowsForChangeImpact(graphContext);
      const taskModel = classifyAgentTask(requestedTask);
      const testFiles = scanStatus.latest_scan
        ? storage.listFileSnapshots(requestedRepoId, scanStatus.latest_scan.id)
            .filter((snapshot) => /(\.test|\.spec)\.[tj]sx?$/.test(snapshot.file_path))
            .map((snapshot) => snapshot.file_path)
        : [];
      const symbolIdentities = scanStatus.latest_scan
        ? storage.listSymbolIdentities(requestedRepoId, scanStatus.latest_scan.id)
        : [];
      const changeImpact = buildChangeImpact({
        repo_id: requestedRepoId,
        scan_id: scanStatus.latest_scan?.id ?? "scan_missing",
        changed_files: relevantFiles.map((file) => file.path),
        route_flows: changeImpactRouteFlows,
        symbol_identities: symbolIdentities,
        test_files: testFiles
      });
      const testSelection = selectRelevantTests({
        changed_file: relevantFiles[0]?.path ?? requestedPath ?? "",
        route_flow: changeImpactRouteFlows[0],
        test_files: testFiles
      });
      const waivers = waiversForFiles(contract, relevantFiles, generatedAt);
      const agentContractPacket = createAgentPreflightPacket({
        repoContract: { ...contract, conventions: activeConventions },
        task: requestedTask,
        scan_id: scanStatus.latest_scan?.id ?? null,
        stale: scanStatus.stale,
        explicit_paths: requestedPath ? [requestedPath] : [],
        changed_paths: relevantFiles.map((file) => file.path),
        file_roles: uniqueFileRoles(relevantFiles),
        graph_node_ids: graphNodeIdsForPreflight(graphContext, relevantFiles)
      });
      const parserGaps = scanStatus.latest_scan
        ? storage.listParserGaps(requestedRepoId, scanStatus.latest_scan.id)
        : [];
      const parserGapV2 = scanStatus.latest_scan
        ? storage.listParserGapV2(requestedRepoId, scanStatus.latest_scan.id)
        : [];
      const allParserGaps = [...parserGaps, ...parserGapV2];
      const readiness = buildReadiness({
        repo_id: requestedRepoId,
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
        repo_id: requestedRepoId,
        scan_id: scanStatus.latest_scan?.id ?? "scan_missing",
        scope: "preflight",
        scope_id: requestedPath ?? requestedTask,
        capability_report: scanStatus.capability_report,
        readiness,
        parser_gaps: allParserGaps,
        generated_at: generatedAt
      });
      const parserGapQuality = buildParserGapQuality({
        repo_id: requestedRepoId,
        scan_id: scanStatus.latest_scan?.id ?? null,
        surface: "prepare",
        parser_gaps: allParserGaps,
        readiness
      });
      const contextPolicy = createContextPolicyMatrix(contract, policy);
      // BB-5/BB-6: the same derivation the CLI uses, from the same stored state, so the two surfaces
      // cannot disagree about which files conform.
      const preflightExemplars = exemplarContext({
        scanFiles: scanStatus.latest_scan
          ? storage
              .listFileSnapshots(requestedRepoId, scanStatus.latest_scan.id)
              .map((snapshot) => snapshot.file_path)
          : [],
        roleByFile: new Map(
          (scanStatus.latest_scan
            ? storage.listFacts(scanStatus.latest_scan.id, { kind: "file_role_detected" })
            : []
          ).map((fact) => [fact.file_path, fact.name])
        ),
        openFindings: storage.listFindings(requestedRepoId).filter(isOpenFinding),
        activeBaseline: storage
          .listBaselineViolations(requestedRepoId)
          .filter((entry) => entry.status === "active"),
        // What each file imports, so an exemplar is proven rather than presumed. get_task_preflight
        // never runs a check, so without this its violator set is only what some earlier check
        // happened to record - empty on a repo where none ever ran.
        importsByFile: (scanStatus.latest_scan
          ? storage.listFacts(scanStatus.latest_scan.id, { kind: "import_used" })
          : []
        ).reduce((byFile, fact) => {
          const sources = byFile.get(fact.file_path) ?? [];
          if (fact.value) {
            sources.push(fact.value);
          }
          byFile.set(fact.file_path, sources);
          return byFile;
        }, new Map<string, string[]>())
      });
      const preflightConventions = activeConventions.map((convention) =>
        preflightConvention(convention, preflightExemplars)
      );
      const guidance = buildGuidanceView({
        repoId: requestedRepoId,
        conventions: preflightConventions,
        relevantFiles,
        requiredChecks,
        parserGaps: allParserGaps
      });
      const taskPreflightPacket = AgentPreflightPacketV2Schema.parse({
        schema_version: "drift.agent_preflight.v2",
        repo_id: requestedRepoId,
        scan_id: scanStatus.latest_scan?.id ?? "scan_missing",
        task_model: taskModel,
        repo_map_summary: {
          relevant_file_count: relevantFiles.length,
          route_flow_count: graphContext.route_flows.length,
          parser_gap_count: allParserGaps.length
        },
        accepted_conventions: preflightConventions,
        relevant_files: relevantFiles,
        role_layer_proof: [],
        change_impact: changeImpact,
        test_intelligence: testSelection.test_intelligence,
        // BB-6: the gap summary, identical to the CLI's - both read it off the shared guidance view
        // rather than each computing one.
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
        },
      });
      return {
        response_schema: "drift.task.preflight.v1",
        // BB-6: same field, same position, same builder as the CLI's prepare payload.
        guidance,
        repo_id: requestedRepoId,
        task: requestedTask,
        target_path: requestedPath ?? null,
        generated_at: generatedAt,
        agent_envelope: mcpAgentEnvelope({
          surface: "cli-preflight",
          policy,
          scanStatus,
          requireFresh: Boolean(require_fresh),
          diagnostics: graphContext.diagnostics
        }),
        policy,
        readiness,
        parser_gap_quality: parserGapQuality,
        semantic_coverage: semanticCoverage,
        contract: {
          id: contractReady ? contract.id : null,
          schema_version: contract.contract_schema_version,
          updated_at: contractReady ? contract.updated_at : null,
          ready: contractReady,
          source: contractReady ? "accepted_contract" : "default_local_policy"
        },
        summary: {
          ...preflightSummary({
          conventions: activeConventions,
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
        conventions: preflightConventions,
        audit_integrity: scanStatus.audit_integrity,
        scan_status: scanStatus,
        freshness_requirement: freshnessRequirement(Boolean(require_fresh), scanStatus),
        graph_context: graphContext,
        task_model: taskModel,
        task_preflight_packet: taskPreflightPacket,
        change_impact: changeImpact,
        test_intelligence: testSelection.test_intelligence,
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
        redactions: {
          denied_globs: contract.context_egress.denied_globs,
          excluded_file_count: countDeniedFiles(
            storage.getRepo(requestedRepoId)!.root_path,
            contract.context_egress.denied_globs
          ),
          snippets_included: false,
          source_content_included: false,
          graph_context_included: graphContext.available,
          context_truncated: false
        },
        next_commands: contractReady
          ? [
            `drift check --repo ${requestedRepoId} --diff main...HEAD --scope changed-hunks --json`,
            `drift findings list --repo ${requestedRepoId} --json`
          ]
          : [
            `drift conventions list --repo ${requestedRepoId} --status candidate --json`,
            `drift repo map --repo ${requestedRepoId} --json`,
            `drift scan status --repo ${requestedRepoId} --json`
          ]
      };
    }),

    get_conventions: ({ repo_id, kind, capability, limit, offset }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { policy } = requiredAuthorizedMcpContract(storage, requestedRepoId, "cli-preflight");
      const requestedKind = validateConventionKind(kind);
      const requestedCapability = validateEnforcementCapability(capability);
      const requestedLimit = optionalMcpPositiveInteger(limit, "limit");
      const requestedOffset = optionalMcpNonNegativeInteger(offset, "offset") ?? 0;
      const allConventions = storage.listAcceptedConventions(requestedRepoId);
      const filteredConventions = orderAcceptedConventionsForReview(allConventions.filter((convention) =>
        (!requestedKind || convention.kind === requestedKind) &&
        (!requestedCapability || convention.enforcement_capability === requestedCapability)
      ));
      const conventions = paginateAcceptedConventions(filteredConventions, requestedLimit, requestedOffset);
      return {
        response_schema: "drift.conventions.accepted.v1",
        repo_id: requestedRepoId,
        policy,
        filters: {
          kind: requestedKind ?? null,
          capability: requestedCapability ?? null
        },
        summary: conventionSummary(allConventions, filteredConventions, conventions),
        pagination: paginationSummary(filteredConventions.length, conventions.length, requestedLimit, requestedOffset),
        governance: preflightGovernance(),
        conventions
      };
    }),

    get_findings: ({ repo_id, status, severity, diff_status, convention_id, path, limit, offset, require_fresh }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const { policy } = requiredAuthorizedMcpContract(storage, requestedRepoId, "cli-check");
      const requestedStatus = validateFindingStatus(status);
      const requestedSeverity = validateSeverity(severity);
      const requestedDiffStatus = validateFindingDiffStatus(diff_status);
      const requestedConventionId = optionalMcpString(convention_id, "convention_id");
      const requestedPath = path ? requiredRepoRelativeMcpPath(path) : undefined;
      const requestedLimit = optionalMcpPositiveInteger(limit, "limit");
      const requestedOffset = optionalMcpNonNegativeInteger(offset, "offset") ?? 0;
      const scanStatus = scanStatusPayload(storage, requestedRepoId);
      assertFreshScanIfRequired(requestedRepoId, scanStatus, Boolean(require_fresh));
      const readModel = buildFindingsReadModel({
        findings: storage.listFindings(requestedRepoId),
        filters: {
          status: requestedStatus,
          severity: requestedSeverity,
          diff_status: requestedDiffStatus,
          convention_id: requestedConventionId,
          path: requestedPath
        },
        limit: requestedLimit,
        offset: requestedOffset
      });
      return {
        response_schema: "drift.findings.list.v1",
        repo_id: requestedRepoId,
        agent_envelope: mcpAgentEnvelope({
          surface: "cli-check",
          policy,
          scanStatus,
          requireFresh: Boolean(require_fresh)
        }),
        policy,
        governance: preflightGovernance(),
        filters: readModel.filters,
        scan_status: scanStatus,
        freshness_requirement: freshnessRequirement(Boolean(require_fresh), scanStatus),
        summary: readModel.summary,
        pagination: readModel.pagination,
        review_items: readModel.review_items.map((item) => ({
          ...item,
          first_evidence: item.first_evidence
            ? {
                file_path: item.first_evidence.file_path,
                start_line: item.first_evidence.start_line ?? null
              }
            : null
        })),
        findings: readModel.findings.map(sanitizedMcpFinding)
      };
    }),

    get_required_check_executions: ({ repo_id, command, scan_id, repo_contract_id, limit, offset }) => withStorage(options, (storage) => {
      const requestedRepoId = requiredMcpString(repo_id, "repo_id");
      const requestedCommand = optionalMcpString(command, "command");
      const requestedScanId = optionalMcpString(scan_id, "scan_id");
      const requestedRepoContractId = optionalMcpString(repo_contract_id, "repo_contract_id");
      const requestedLimit = optionalMcpPositiveInteger(limit, "limit") ?? 50;
      const requestedOffset = optionalMcpNonNegativeInteger(offset, "offset") ?? 0;
      const { contract, policy } = requiredAuthorizedMcpContract(storage, requestedRepoId, "log");
      const executions = storage.listRequiredCheckExecutions(requestedRepoId, {
        command: requestedCommand,
        scan_id: requestedScanId,
        repo_contract_id: requestedRepoContractId
      });
      const page = executions.slice(requestedOffset, requestedOffset + requestedLimit)
        .map(redactRequiredCheckExecution);
      const latestByCommand = new Map<string, (typeof executions)[number]>();
      for (const execution of executions) {
        if (!latestByCommand.has(execution.command)) {
          latestByCommand.set(execution.command, execution);
        }
      }
      const latestExecutions = [...latestByCommand.values()];
      const redactedLatestExecutions = latestExecutions.map(redactRequiredCheckExecution);
      return {
        response_schema: "drift.required_check_executions.v1",
        repo_id: requestedRepoId,
        policy,
        governance: preflightGovernance(),
        filters: {
          command: requestedCommand ?? null,
          scan_id: requestedScanId ?? null,
          repo_contract_id: requestedRepoContractId ?? null
        },
        summary: {
          repo_contract_id: contract.id,
          total_count: executions.length,
          returned_count: page.length,
          limit: requestedLimit,
          offset: requestedOffset,
          latest_passed_count: latestExecutions.filter((execution) => execution.status === "passed").length,
          latest_failed_count: latestExecutions.filter((execution) => execution.status !== "passed").length
        },
        latest_by_command: redactedLatestExecutions,
        executions: page
      };
    }),

    get_allowed_context: ({
      repo_id,
      path,
      surface = "mcp",
      requested_snippet_chars,
      request_full_file_content,
      require_fresh
    }) =>
      withStorage(options, (storage) => {
        const requestedRepoId = requiredMcpString(repo_id, "repo_id");
        const requestedPath = requiredRepoRelativeMcpPath(path);
        const requestedSurface = validatePolicySurface(surface);
        const { contract, ready: contractReady } = mcpContractOrDefault(
          storage,
          requestedRepoId
        );
        const request = {
          path: requestedPath,
          surface: requestedSurface,
          requested_snippet_chars: requested_snippet_chars ?? null,
          request_full_file_content: request_full_file_content ?? false,
          require_fresh: require_fresh ?? false
        };
        const scanStatus = scanStatusPayload(storage, requestedRepoId);
        assertFreshScanIfRequired(requestedRepoId, scanStatus, Boolean(require_fresh));
        const readiness = readinessForStoredScan(
          storage,
          requestedRepoId,
          scanStatus.latest_scan?.id ?? null,
          "allowed_context"
        );
        const freshness = freshnessRequirement(Boolean(require_fresh), scanStatus);
        const fileContext = policyFileContext(storage, requestedRepoId, requestedPath, contract);
        const decision = authorizeContextExport(contract, requestedSurface, {
          path: requestedPath,
          requested_snippet_chars,
          request_full_file_content
        });
        const contextPolicy = createContextPolicyMatrix(contract, decision);
        return {
          response_schema: "drift.allowed-context.v1",
          repo_id: requestedRepoId,
          path: requestedPath,
          request,
          contract: {
            ready: contractReady,
            id: contractReady ? contract.id : null,
            source: contractReady ? "accepted_contract" : "default_local_policy"
          },
          readiness,
          governance: preflightGovernance(),
          scan_status: scanStatus,
          freshness_requirement: freshness,
          file_context: fileContext,
          redactions: {
            denied_globs: contract.context_egress.denied_globs,
            allow_full_file_content: contract.context_egress.allow_full_file_content,
            max_snippet_chars: contract.context_egress.max_snippet_chars
          },
          summary: policyContextSummary({
            decision,
            fileContext,
            freshness,
            deniedGlobCount: contract.context_egress.denied_globs.length
          }),
          decision,
          context_policy: contextPolicy,
          next_commands: policyContextNextCommands(requestedRepoId, requestedPath, decision)
        };
      })
  };
}

export function handleMcpJsonRpcRequest(
  options: DriftMcpOptions,
  request: JsonRpcRequest
): JsonRpcResponse | undefined {
  if (request.id === undefined && request.method.startsWith("notifications/")) {
    return undefined;
  }

  try {
    if (request.method === "initialize") {
      return response(request.id, {
        protocolVersion: DRIFT_MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "drift-local",
          version: "0.1.0"
        }
      });
    }

    if (request.method === "tools/list") {
      return response(request.id, {
        tools: DRIFT_READ_ONLY_MCP_TOOLS
      });
    }

    if (request.method === "tools/call") {
      const params = objectParam(request.params);
      const name = stringParam(params, "name");
      const args = objectParam(params.arguments ?? {});
      const handlers = createReadOnlyMcpHandlers(options);
      if (!isReadOnlyToolName(name)) {
        throw new Error(`Unknown read-only Drift MCP tool: ${name}`);
      }

      validateMcpToolArguments(name, args);
      const result = handlers[name](args as never);
      return response(request.id, {
        content: [
          {
            type: "text",
            // Compact. Pretty-printing a machine surface inflated every dub payload 1.31-1.45x;
            // on get_task_preflight that is roughly 120 KB of indentation in a response an agent
            // pays for by the token. Nothing reads this by eye - the CLI keeps its human
            // formatting, and `jq` reformats for anyone who wants it.
            text: JSON.stringify(result)
          }
        ],
        isError: false
      });
    }

    return errorResponse(request.id, -32601, `Unsupported MCP method: ${request.method}`);
  } catch (error) {
    // F-2 (R-3): classify before forwarding. Raw SQLite strings ("file is not a database",
    // "database disk image is malformed", "disk I/O error") used to reach agents verbatim with
    // nothing to branch on; the classified data mirrors the CLI's failure payload.
    const message = error instanceof Error ? error.message : "Unknown Drift MCP error.";
    const failure = classifyFailure(error, message);
    return errorResponse(request.id, -32000, message, {
      code: failure.code,
      user_action: failure.user_action,
      safe_to_retry: failure.safe_to_retry,
      recovery_commands: failure.recovery_commands
    });
  }
}

export async function runReadOnlyMcpStdioServer(
  options: DriftMcpOptions,
  io: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    error?: NodeJS.WritableStream;
  } = {}
): Promise<void> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const error = io.error ?? process.stderr;
  const lines = createInterface({ input });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      const result = handleMcpJsonRpcRequest(options, request);
      if (result) {
        output.write(`${JSON.stringify(result)}\n`);
      }
    } catch (parseError) {
      const result = errorResponse(
        null,
        -32700,
        parseError instanceof Error ? parseError.message : "Invalid JSON-RPC request."
      );
      output.write(`${JSON.stringify(result)}\n`);
      error.write("Drift MCP rejected an invalid JSON-RPC line.\n");
    }
  }
}

export async function runMcpCli(
  argv: string[],
  env: { DRIFT_DB?: string | undefined } = process.env,
  io: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    error?: NodeJS.WritableStream;
  } = {}
): Promise<McpCliResult> {
  const parsed = parseMcpCliArgs(argv);
  const output = io.output ?? process.stdout;
  const error = io.error ?? process.stderr;
  if (parsed.help) {
    output.write(mcpHelpText());
    return { exitCode: 0 };
  }
  if (parsed.version) {
    output.write(`${DRIFT_MCP_VERSION}\n`);
    return { exitCode: 0 };
  }
  if (parsed.error) {
    error.write(`${parsed.error}\n`);
    return { exitCode: 1 };
  }

  const databasePath = resolveMcpDatabasePath(argv, env);
  if (!databasePath) {
    error.write("Missing --db <path> or DRIFT_DB for drift-mcp.\n");
    return { exitCode: 1 };
  }

  await runReadOnlyMcpStdioServer({ databasePath }, io);
  return { exitCode: 0 };
}

function parseMcpCliArgs(argv: string[]): {
  help: boolean;
  version: boolean;
  error?: string;
} {
  let skipNext = false;
  for (const arg of argv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg === "--db") {
      skipNext = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, version: false };
    }
    if (arg === "--version" || arg === "-v") {
      return { help: false, version: true };
    }
    if (arg.startsWith("-")) {
      return {
        help: false,
        version: false,
        error: `Unknown drift-mcp option: ${arg}`
      };
    }
  }
  return { help: false, version: false };
}

function mcpHelpText(): string {
  return [
    "Usage: drift-mcp --db <path>",
    "",
    "Run Drift's read-only MCP server over stdio.",
    "",
    "Options:",
    "  --db <path>     SQLite Drift state database.",
    "  --help, -h      Show this help.",
    "  --version, -v   Show the drift-mcp version.",
    "",
    "Environment:",
    "  DRIFT_DB        Fallback SQLite Drift state database path.",
    ""
  ].join("\n");
}

function withStorage<T>(options: DriftMcpOptions, fn: (storage: ReturnType<typeof openDriftStorage>) => T): T {
  // F-3a: the MCP serve path is where R-3 verified a mid-file-corrupted database being served
  // as success with silently incomplete data. Fail closed at open instead; the guard's verdict
  // is cached per process so healthy databases are not re-walked on every request.
  const storage = openDriftStorage({ databasePath: options.databasePath, integrityGuard: true });
  try {
    assertMcpReadOnlySchemaReady(storage);
    return fn(storage);
  } finally {
    storage.close();
  }
}

function assertMcpReadOnlySchemaReady(storage: ReturnType<typeof openDriftStorage>): void {
  const applied = storage.getAppliedMigrations();
  const expected = MIGRATIONS.map((migration) => migration.id);
  const unknown = applied.filter((migrationId) => !expected.includes(migrationId));
  if (unknown.length > 0) {
    throw new Error(`Drift read-only MCP database has unsupported migrations: ${unknown.join(", ")}.`);
  }
  const missing = expected.filter((migrationId) => !applied.includes(migrationId));
  if (missing.length > 0) {
    throw new Error(`Drift read-only MCP database is not migrated; run the Drift CLI migration/scan path first. Missing migrations: ${missing.join(", ")}.`);
  }
}

function redactRequiredCheckExecution(execution: RequiredCheckExecution): Omit<RequiredCheckExecution, "stdout_preview" | "stderr_preview"> {
  const { stdout_preview: _stdoutPreview, stderr_preview: _stderrPreview, ...redacted } = execution;
  return redacted;
}

function response(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result
  };
}

function errorResponse(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: NonNullable<JsonRpcResponse["error"]>["data"]
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  };
}

function objectParam(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object params.");
  }
  return value as Record<string, unknown>;
}

function stringParam(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string param: ${key}`);
  }
  return value.trim();
}

export function resolveMcpDatabasePath(
  argv: string[],
  env: { DRIFT_DB?: string | undefined } = process.env
): string | undefined {
  if (argv.includes("--db")) {
    return nonEmptyValue(flagValue(argv, "db"));
  }
  return nonEmptyValue(env.DRIFT_DB);
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function nonEmptyValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mcpRuntime(): {
  mcp_version: string;
  core_version: string;
  scanner_version: string;
  typescript_adapter_version: string;
  rule_engine_version: string;
  contract_schema_version: number;
  supported_sqlite_schema_version: number;
  storage_driver: "sqlite";
} {
  return {
    mcp_version: DRIFT_MCP_VERSION,
    core_version: DRIFT_CORE_VERSION,
    scanner_version: DRIFT_SCANNER_VERSION,
    typescript_adapter_version: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
    rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
    contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    supported_sqlite_schema_version: MIGRATIONS.length,
    storage_driver: "sqlite"
  };
}

function mcpV1Scope(): {
  product_mode: "local_first_cli";
  primary_wedge: "typescript_api_route_layering";
  mutation_model: "human_confirmed_governance_only";
  source_mutation: false;
  language_adapters: string[];
  deferred: string[];
} {
  return {
    product_mode: "local_first_cli",
    primary_wedge: "typescript_api_route_layering",
    mutation_model: "human_confirmed_governance_only",
    source_mutation: false,
    language_adapters: ["typescript"],
    deferred: ["desktop_ui", "cloud_sync", "python_adapter", "duplicate_helper_detection"]
  };
}

function mcpCapabilities(): ReturnType<typeof createDriftCapabilities> {
  return createDriftCapabilities({
    mcpReadOnlyTools: DRIFT_READ_ONLY_MCP_TOOLS.map((tool) => tool.name)
  });
}

function isReadOnlyToolName(name: string): name is keyof DriftMcpHandlers {
  return DRIFT_READ_ONLY_MCP_TOOLS.some((tool) => tool.name === name);
}

function validateMcpToolArguments(name: keyof DriftMcpHandlers, args: Record<string, unknown>): void {
  const tool = DRIFT_READ_ONLY_MCP_TOOLS.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Unknown read-only Drift MCP tool: ${name}`);
  }

  for (const requiredField of tool.inputSchema.required) {
    if (!(requiredField in args)) {
      throw new Error(`Invalid arguments for ${name}: missing required field ${requiredField}.`);
    }
  }

  if (tool.inputSchema.additionalProperties === false) {
    for (const field of Object.keys(args)) {
      if (!(field in tool.inputSchema.properties)) {
        throw new Error(`Invalid arguments for ${name}: unexpected field ${field}.`);
      }
    }
  }

  for (const [field, schema] of Object.entries(tool.inputSchema.properties)) {
    if (!(field in args)) {
      continue;
    }
    const propertySchema = schema as { type?: string; enum?: string[] };
    if (propertySchema.type === "string" && typeof args[field] !== "string") {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be a string.`);
    }
    if (
      propertySchema.type === "string" &&
      typeof args[field] === "string" &&
      args[field].trim().length === 0
    ) {
      throw new Error(`Invalid arguments for ${name}: field ${field} must not be empty.`);
    }
    if (
      (name === "get_allowed_context" || name === "get_repo_map" || name === "get_task_preflight" || name === "get_findings") &&
      field === "path" &&
      typeof args[field] === "string" &&
      !isRepoRelativeMcpPath(args[field].trim())
    ) {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be repo-relative.`);
    }
    if (propertySchema.type === "number" && typeof args[field] !== "number") {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be a number.`);
    }
    if (field === "requested_snippet_chars" && propertySchema.type === "number") {
      const value = args[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid arguments for ${name}: field ${field} must be a positive integer.`);
      }
    }
    if (field === "limit" && propertySchema.type === "number") {
      const value = args[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid arguments for ${name}: field ${field} must be a positive integer.`);
      }
    }
    if (field === "offset" && propertySchema.type === "number") {
      const value = args[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid arguments for ${name}: field ${field} must be a non-negative integer.`);
      }
    }
    if (propertySchema.type === "boolean" && typeof args[field] !== "boolean") {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be a boolean.`);
    }
    if (propertySchema.enum && !propertySchema.enum.includes(args[field] as string)) {
      throw new Error(`Invalid arguments for ${name}: field ${field} must be one of ${propertySchema.enum.join(", ")}.`);
    }
  }
}

function requiredContract(contract: RepoContract | undefined, repoId: string): RepoContract {
  if (!contract) {
    throw new Error(`No repo contract exists for ${repoId}.`);
  }
  return contract;
}

function requiredMcpString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must not be empty.`);
  }
  return trimmed;
}

function optionalMcpString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredMcpString(value, field);
}

function optionalMcpPositiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function optionalMcpNonNegativeInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
  return value;
}

function optionalMcpIsoTimestamp(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = requiredMcpString(value, field);
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
  return trimmed;
}

function requiredRepoRelativeMcpPath(value: string): string {
  const trimmed = requiredMcpString(value, "path");
  if (!isRepoRelativeMcpPath(trimmed)) {
    throw new Error("path must be repo-relative.");
  }
  return trimmed;
}

function isRepoRelativeMcpPath(value: string): boolean {
  return value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.split(/[\\/]+/).includes("..");
}

function requiredAuthorizedMcpContract(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  surface: PolicyDecision["surface"] = "mcp"
): { contract: RepoContract; policy: PolicyDecision } {
  requiredMcpRepo(storage, repoId);
  const contract = requiredContract(storage.getRepoContract(repoId), repoId);
  const policy = authorizeContextExport(contract, surface);
  if (!policy.allowed) {
    throw new Error(`Policy denied MCP output: ${policy.reason}`);
  }
  return { contract, policy };
}

function authorizedMcpContractOrDefault(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  surface: PolicyDecision["surface"] = "mcp"
): { contract: RepoContract; policy: PolicyDecision; ready: boolean } {
  const { contract, ready } = mcpContractOrDefault(storage, repoId);
  const policy = authorizeContextExport(contract, surface);
  if (!policy.allowed) {
    throw new Error(`Policy denied MCP output: ${policy.reason}`);
  }
  return { contract, policy, ready };
}

function mcpContractOrDefault(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string
): { contract: RepoContract; ready: boolean } {
  const repo = requiredMcpRepoRecord(storage, repoId);
  const storedContract = storage.getRepoContract(repoId);
  const contract = storedContract ?? {
    id: `contract_default_${repoId}`,
    repo_id: repoId,
    contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    repo_fingerprint: repo.fingerprint,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
    conventions: [],
    rejected_inferences: [],
    waivers: [],
    risky_areas: [],
    safe_commands: [],
    required_checks: [],
    context_egress: {
      default_mode: "local_only" as const,
      denied_globs: [".env*", "**/*.pem", "**/*.key", "**/*.crt"],
      max_snippet_chars: 1200,
      allow_full_file_content: false
    },
    agent_permissions: []
  };
  return { contract, ready: Boolean(storedContract) };
}

function requiredMcpRepo(storage: ReturnType<typeof openDriftStorage>, repoId: string): void {
  if (!storage.getRepo(repoId)) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
}

function requiredMcpRepoRecord(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string
): RepoRecord {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  return repo;
}

function scanStatusPayload(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string
) {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const scans = storage.listScanManifests(repoId);
  const latestScan = latestIndexedScan(scans) ?? null;
  const indexedScanCount = scans.filter((scan) =>
    scan.status === "completed" &&
    !scan.id.startsWith("scan_baseline_") &&
    !scan.id.startsWith("scan_restore_")
  ).length;
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const scanFileChanges = latestScan ? storage.listScanFileChanges(repoId, latestScan.id) : [];
  const parserGaps = latestScan ? storage.listParserGaps(repoId, latestScan.id) : [];
  const parserGapV2 = latestScan ? storage.listParserGapV2(repoId, latestScan.id) : [];
  const allParserGaps = [...parserGaps, ...parserGapV2];
  const capabilityReport = latestScan
    ? storage.getScanCapabilityReport(repoId, latestScan.id) ?? null
    : null;
  const readiness = readinessForStoredScan(storage, repoId, latestScan?.id ?? null, "scan_status", allParserGaps);
  const proofRuns = latestScan
    ? storage.listSecurityBoundaryProofRuns({
        repo_id: repoId,
        scan_id: latestScan.id,
        latest_only: true
      })
    : [];
  const securityReadModel = latestScan
    ? buildSecurityPhase8ReadModel({
        repo_id: repoId,
        scan_id: latestScan.id,
        check_id: proofRuns[0]?.check_id ?? null,
        proofs: proofRuns.map((run) => run.proof),
        findings: storage.listFindings(repoId).map((finding) => ({
          finding_id: finding.id,
          title: finding.title,
          lifecycle: finding.status
        })),
        accepted_conventions: storage.getRepoContract(repoId)?.conventions ?? []
      })
    : null;
  const repoRootMissing = !existsSync(repo.root_path);
  const currentBranch = repoRootMissing
    ? "unknown"
    : gitOutput(repo.root_path, ["branch", "--show-current"]) || "unknown";
  const currentResolverInputFingerprint = repoRootMissing
    ? undefined
    : resolverInputFingerprint(repo.root_path);
  const invalidationReasons = latestScan
    ? [
        ...(repoRootMissing ? ["repo_root_missing"] : []),
        ...scanInvalidationReasons(latestScan, { currentBranch, currentResolverInputFingerprint })
      ]
    : ["scan_missing"];
  const changes = latestScan
    ? repoRootMissing
      ? {
          added: [],
          modified: [],
          deleted: snapshots.map((snapshot) => snapshot.file_path).sort()
        }
      : compareSnapshotsToCurrentFiles(repo.root_path, snapshots)
    : emptyChanges();
  const stale = !latestScan ||
    invalidationReasons.length > 0 ||
    changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.deleted.length > 0;
  const sourceChangeCount = changes.added.length + changes.modified.length + changes.deleted.length;
  const auditIntegrity = storage.verifyAuditChain(repoId);
  const nextCommands = scanStatusNextCommands(repoId, repo.root_path, stale);

  return {
    response_schema: "drift.scan.status.v1",
    repo_id: repoId,
    governance: preflightGovernance(),
    repo_root: repo.root_path,
    current_branch: currentBranch,
    latest_scan: latestScan,
    scan_fingerprint: latestScan ? scanFingerprint(latestScan, snapshots) : null,
    /**
     * EW-6 (DET-1): stored facts beside the manifest's emission count, in parity with the CLI.
     *
     * The two numbers coming from different code paths is what let a dropped fact go unnoticed, so
     * both are published - and published on both surfaces, because an agent reading MCP and a human
     * reading the CLI must be able to check the same claim.
     */
    stored_fact_count: latestScan ? storage.listFacts(latestScan.id).length : 0,
    audit_integrity: auditIntegrity,
    indexed_file_count: latestScan?.file_count ?? 0,
    source_change_count: sourceChangeCount,
    scan_count: indexedScanCount,
    latest_scan_change_summary: scanFileChangeSummary(scanFileChanges),
    summary: scanStatusSummary({
      latestScanId: latestScan?.id ?? null,
      scanCount: indexedScanCount,
      indexedFileCount: latestScan?.file_count ?? 0,
      sourceChangeCount,
      stale,
      invalidationCount: latestScan ? invalidationReasons.length : 1,
      auditValid: auditIntegrity.valid
    }),
    stale,
    invalidation_reasons: invalidationReasons,
    changes,
    parser_gaps: buildParserGapSection(allParserGaps),
    parser_gap_quality: buildParserGapQuality({
      repo_id: repoId,
      scan_id: latestScan?.id ?? null,
      surface: "scan_status",
      parser_gaps: allParserGaps,
      readiness
    }),
    readiness,
    capability_report: capabilityReport,
    security_capabilities: proofRuns.length > 0 ||
      (securityReadModel?.repo_security_contracts.length ?? 0) > 0
      ? securityReadModel?.security_capabilities ?? []
      : [],
    machine_contract_versions: currentMachineContractVersions(latestScan?.adapter_versions),
    next_command: nextCommands[0],
    next_commands: nextCommands
  };
}

function currentMachineContractVersions(
  adapterVersions: Record<string, string> = {
    typescript: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
    resolver: DRIFT_RESOLVER_VERSION
  }
): MachineContractVersions {
  return {
    schema_version: "drift.machine_contract_versions.v1",
    cli_version: DRIFT_CLI_VERSION,
    core_version: DRIFT_CORE_VERSION,
    storage_schema_version: MIGRATIONS.length,
    contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    engine_contract_versions: {
      scan_request: ENGINE_SCAN_REQUEST_SCHEMA_VERSION,
      scan_result: ENGINE_SCAN_RESULT_SCHEMA_VERSION,
      check_request: ENGINE_CHECK_REQUEST_SCHEMA_VERSION,
      check_result: ENGINE_CHECK_RESULT_SCHEMA_VERSION,
      candidates_result: ENGINE_CANDIDATES_RESULT_SCHEMA_VERSION,
      stream_event: ENGINE_STREAM_EVENT_SCHEMA_VERSION
    },
    factgraph_schema_version: FACTGRAPH_SCHEMA_VERSION,
    scanner_version: DRIFT_SCANNER_VERSION,
    rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
    adapter_versions: adapterVersions
  };
}

function readinessForStoredScan(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  scanId: string | null,
  surface: DriftReadinessSurface,
  parserGaps: Array<ParserGap | ParserGapV2> = scanId
    ? [...storage.listParserGaps(repoId, scanId), ...storage.listParserGapV2(repoId, scanId)]
    : []
) {
  const graphAvailable = Boolean(scanId && storage.getFactGraphArtifact(repoId, scanId));
  return buildStoredScanReadiness({
    repo_id: repoId,
    scan_id: scanId,
    surface,
    graph_available: graphAvailable,
    parser_gaps: parserGaps
  });
}


function scanStatusSummary(options: {
  latestScanId: string | null;
  scanCount: number;
  indexedFileCount: number;
  sourceChangeCount: number;
  stale: boolean;
  invalidationCount: number;
  auditValid: boolean;
}): {
  latest_scan_id: string | null;
  scan_count: number;
  indexed_file_count: number;
  source_change_count: number;
  stale: boolean;
  invalidation_count: number;
  audit_valid: boolean;
} {
  return {
    latest_scan_id: options.latestScanId,
    scan_count: options.scanCount,
    indexed_file_count: options.indexedFileCount,
    source_change_count: options.sourceChangeCount,
    stale: options.stale,
    invalidation_count: options.invalidationCount,
    audit_valid: options.auditValid
  };
}

function scanFileChangeSummary(changes: ScanFileChange[]): {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
  total: number;
} {
  return {
    added: changes.filter((change) => change.change_kind === "added").length,
    modified: changes.filter((change) => change.change_kind === "modified").length,
    deleted: changes.filter((change) => change.change_kind === "deleted").length,
    unchanged: changes.filter((change) => change.change_kind === "unchanged").length,
    total: changes.length
  };
}

function scanStatusNextCommands(repoId: string, repoRoot: string, stale: boolean): string[] {
  return stale
    ? [
        `drift scan --repo-root ${repoRoot} --json`,
        `drift doctor --repo-root ${repoRoot} --json`
      ]
    : [
        `drift prepare "task" --repo ${repoId} --json`,
        `drift repo map --repo ${repoId} --json`,
        `drift audit verify --repo ${repoId} --json`
      ];
}

function auditVerifySummary(verification: AuditChainVerification): {
  valid: boolean;
  event_count: number;
  verified_count: number;
  strict: boolean;
  head_sequence?: number | null;
  broken_at_event_id: string | null;
  reason_count: number;
  head_event_hash: string | null;
} {
  return {
    valid: verification.valid,
    event_count: verification.event_count,
    verified_count: verification.verified_count,
    strict: verification.strict === true,
    head_sequence: verification.head_sequence,
    broken_at_event_id: verification.broken_at_event_id,
    reason_count: verification.reasons.length,
    head_event_hash: verification.head_event_hash
  };
}

function auditVerifyNextCommands(repoId: string, verification: AuditChainVerification): string[] {
  return verification.valid
    ? [
        `drift audit list --repo ${repoId} --json`,
        `drift backup create --repo ${repoId} --confirm --json`
      ]
    : [
        `drift audit list --repo ${repoId} --json`,
        `drift doctor --repo-root . --json`
      ];
}

function freshnessRequirement(
  required: boolean,
  scanStatus: ReturnType<typeof scanStatusPayload>
): {
  required: boolean;
  satisfied: boolean;
  next_command: string;
  invalidation_reasons: string[];
} {
  return {
    required,
    satisfied: !scanStatus.stale,
    next_command: scanStatus.next_command,
    invalidation_reasons: scanStatus.invalidation_reasons
  };
}

function assertFreshScanIfRequired(
  repoId: string,
  scanStatus: ReturnType<typeof scanStatusPayload>,
  required: boolean
): void {
  if (!required || !scanStatus.stale) {
    return;
  }
  throw new Error(
    `Scan is stale for ${repoId}. Run ${scanStatus.next_command}; omit require_fresh to inspect stale context.`
  );
}

function policyContextSummary(input: {
  decision: PolicyDecision;
  fileContext: ReturnType<typeof policyFileContext>;
  freshness: ReturnType<typeof freshnessRequirement>;
  deniedGlobCount: number;
}): {
  allowed: boolean;
  mode: PolicyDecision["mode"];
  surface: PolicyDecision["surface"];
  indexed: boolean;
  matched_convention_count: number;
  risky_area_count: number;
  open_finding_count: number;
  freshness_required: boolean;
  freshness_satisfied: boolean;
  denied_glob_count: number;
  approved_snippet_chars: number;
} {
  return {
    allowed: input.decision.allowed,
    mode: input.decision.mode,
    surface: input.decision.surface,
    indexed: input.fileContext.indexed,
    matched_convention_count: input.fileContext.convention_ids.length,
    risky_area_count: input.fileContext.risky_area_ids.length,
    open_finding_count: input.fileContext.open_finding_ids.length,
    freshness_required: input.freshness.required,
    freshness_satisfied: input.freshness.satisfied,
    denied_glob_count: input.deniedGlobCount,
    approved_snippet_chars: input.decision.approved_snippet_chars
  };
}

function policyContextNextCommands(repoId: string, contextPath: string, decision: PolicyDecision): string[] {
  if (!decision.allowed) {
    return [`drift policy show --repo ${repoId} --json`];
  }
  return [
    `drift prepare "task" --repo ${repoId} --path ${contextPath} --json`,
    `drift repo map --repo ${repoId} --path ${contextPath} --json`,
    `drift policy show --repo ${repoId} --json`
  ];
}

function policyFileContext(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  filePath: string,
  contract: RepoContract
): {
  path: string;
  indexed: boolean;
  roles: string[];
  convention_ids: string[];
  risky_area_ids: string[];
  open_finding_ids: string[];
} {
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const findings = storage.listFindings(repoId);
  const graphMap = latestScan ? createGraphQueryService(storage).repoMap({ repoId, scanId: latestScan.id }) : null;
  const readModel = buildRepoMapReadModel({
    repoId,
    scanId: latestScan?.id ?? null,
    graphFiles: graphMap?.files ?? [],
    factFiles: fallbackFactRepoMapFiles(snapshots, facts),
    contract,
    findings
  });
  const file = readModel.all_files.find((entry) => entry.path === filePath);
  if (!file) {
    return {
      path: filePath,
      indexed: false,
      roles: [],
      convention_ids: repoMapConventionIds(contract, filePath),
      risky_area_ids: repoMapRiskyAreaIds(contract, filePath),
      open_finding_ids: repoMapOpenFindingIds(findings, filePath)
    };
  }
  return {
    path: file.path,
    indexed: true,
    roles: file.roles,
    convention_ids: file.convention_ids,
    risky_area_ids: file.risky_area_ids,
    open_finding_ids: file.open_finding_ids
  };
}

function repoMapPayload(
  storage: ReturnType<typeof openDriftStorage>,
  repoId: string,
  options: {
    surface: PolicyDecision["surface"];
    role?: FileRole;
    path?: string;
    requireFresh?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  const repo = storage.getRepo(repoId);
  if (!repo) {
    throw new Error(`Unknown repo ${repoId}.`);
  }
  const { contract, policy } = authorizedMcpContractOrDefault(storage, repoId, options.surface);
  const latestScan = latestIndexedScan(storage.listScanManifests(repoId));
  const snapshots = latestScan ? storage.listFileSnapshots(repoId, latestScan.id) : [];
  const facts = latestScan ? storage.listFacts(latestScan.id) : [];
  const findings = storage.listFindings(repoId);
  const graphMap = latestScan ? createGraphQueryService(storage).repoMap({ repoId, scanId: latestScan.id }) : null;
  const normalizedEntrypoints = latestScan
    ? storage.listNormalizedEntrypoints(repoId, latestScan.id)
    : [];
  const frameworkParserGaps = latestScan
    ? storage.listFrameworkParserGaps(repoId, latestScan.id)
    : [];
  const frameworkCapabilities = latestScan
    ? storage.listFrameworkCapabilities(repoId, latestScan.id)
    : [];
  const frameworkEntryPoints = latestScan
    ? buildFrameworkEntrypointReadModel({
        repo_id: repoId,
        scan_id: latestScan.id,
        entrypoints: normalizedEntrypoints,
        parser_gaps: frameworkParserGaps,
        capabilities: frameworkCapabilities
      })
    : null;
  const offset = options.offset ?? 0;
  const readModel = buildRepoMapReadModel({
    repoId,
    scanId: latestScan?.id ?? null,
    graphFiles: graphMap?.files ?? [],
    factFiles: fallbackFactRepoMapFiles(snapshots, facts),
    contract,
    findings,
    filters: {
      role: options.role,
      path: options.path
    },
    limit: options.limit,
    offset
  });
  const scanStatus = scanStatusPayload(storage, repoId);
  assertFreshScanIfRequired(repoId, scanStatus, Boolean(options.requireFresh));
  const allParserGaps = latestScan
    ? [...storage.listParserGaps(repoId, latestScan.id), ...storage.listParserGapV2(repoId, latestScan.id)]
    : [];
  const readiness = readinessForStoredScan(storage, repoId, latestScan?.id ?? null, "repo_map", allParserGaps);
  const proofRuns = latestScan
    ? storage.listLatestSecurityBoundaryProofRunsForRepo({
        repo_id: repoId,
        file_path: options.path
      })
    : [];
  const fallbackProofs = proofRuns.length === 0 && latestScan
    ? storage.listSecurityBoundaryProofs(repoId, latestScan.id)
        .filter((proof) => !options.path || proof.route.file_path === options.path)
    : [];
  const proofs = proofRuns.length > 0 ? proofRuns.map((run) => run.proof) : fallbackProofs;
  const proofScanId = proofRuns[0]?.scan_id ?? (fallbackProofs.length > 0 ? latestScan?.id ?? null : null);
  const canonicalRoutes = buildCanonicalRouteReadModel({
    repo_id: repoId,
    scan_id: latestScan?.id ?? null,
    entrypoints: normalizedEntrypoints,
    proofs: proofs.map((proof) => ({
      proof_scan_id: proofScanId,
      route_id: proof.route.route_id,
      ...(proof.route.normalized_entrypoint_id ? { normalized_entrypoint_id: proof.route.normalized_entrypoint_id } : {}),
      file_path: proof.route.file_path,
      path: proof.route.endpoint?.path ?? null,
      method: proof.route.endpoint?.method ?? proof.route.handler_symbol ?? null
    })),
    fallback_fact_routes: fallbackFactRoutes(readModel.all_files)
  });
  const phase8Security = buildSecurityPhase8ReadModel({
    repo_id: repoId,
    scan_id: latestScan?.id ?? null,
    check_id: proofRuns[0]?.check_id ?? null,
    proof_scan_id: proofScanId,
    proofs,
    findings: findings.map((finding) => ({
      finding_id: finding.id,
      title: finding.title,
      lifecycle: finding.status
    })),
    accepted_conventions: contract.conventions,
    changed_files: options.path ? [options.path] : undefined,
    known_routes: canonicalRoutes.routes.filter((route) => !options.path || route.file_path === options.path),
    route_source_summary: canonicalRoutes.route_source_summary,
    canonical_route_fallback: canonicalRoutes.fallback
  });
  return {
    response_schema: "drift.repo.map.v1",
    repo_id: repoId,
    repo_root: repo.root_path,
    generated_at: new Date().toISOString(),
    agent_envelope: mcpAgentEnvelope({
      surface: options.surface,
      policy,
      scanStatus,
      requireFresh: Boolean(options.requireFresh),
      // Same value the payload's `redactions` reports - see the CLI repo-map payload.
      contextTruncated: readModel.pagination.has_more
    }),
    policy,
    readiness,
    parser_gap_quality: buildParserGapQuality({
      repo_id: repoId,
      scan_id: latestScan?.id ?? null,
      surface: "repo_map",
      parser_gaps: allParserGaps,
      readiness
    }),
    governance: preflightGovernance(),
    latest_scan: latestScan ?? null,
    scan_fingerprint: latestScan ? scanFingerprint(latestScan, snapshots) : null,
    scan_status: scanStatus,
    filters: {
      role: options.role ?? null,
      path: options.path ?? null
    },
    summary: readModel.summary,
    impact_summary: readModel.impact_summary,
    topology: readModel.topology,
    pagination: readModel.pagination,
    routes: phase8Security.routes,
    route_source_summary: phase8Security.route_source_summary,
    canonical_route_fallback: phase8Security.canonical_route_fallback,
    proof_freshness: phase8Security.proof_freshness,
    framework_entrypoints: frameworkEntryPoints,
    freshness_requirement: freshnessRequirement(Boolean(options.requireFresh), scanStatus),
    files: readModel.listed_files.map(repoMapFileForPayload),
    redactions: {
      denied_globs: contract.context_egress.denied_globs,
      snippets_included: false,
      source_content_included: false,
      graph_context_included: Boolean(graphMap),
      // Derived, not asserted - see the CLI repo-map payload for the same reasoning.
      context_truncated: readModel.pagination.has_more
    },
    next_commands: [
      `drift prepare "task" --repo ${repoId} --json`,
      `drift scan status --repo ${repoId} --json`
    ]
  };
}

function fallbackFactRoutes(files: RepoMapFile[]): CanonicalFactRouteInput[] {
  return files
    .filter((file) => file.roles.includes("api_route"))
    .flatMap((file) => {
      const methods = file.exported_symbols.filter((symbol) =>
        ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(symbol)
      );
      return (methods.length > 0 ? methods : ["unknown"]).map((method) => ({
        route_id: `route:${file.path}:${method}`,
        file_path: file.path,
        method,
        file_role: "api_route"
      }));
    });
}

function orderAcceptedConventionsForReview(conventions: AcceptedConvention[]): AcceptedConvention[] {
  return [...conventions].sort((left, right) =>
    left.accepted_at.localeCompare(right.accepted_at) ||
    left.id.localeCompare(right.id)
  );
}

function paginateAcceptedConventions(
  conventions: AcceptedConvention[],
  limit: number | undefined,
  offset: number
): AcceptedConvention[] {
  return limit === undefined
    ? conventions.slice(offset)
    : conventions.slice(offset, offset + limit);
}

function paginationSummary(total: number, returnedCount: number, limit: number | undefined, offset: number): {
  limit: number | null;
  offset: number;
  returned_count: number;
  has_more: boolean;
  next_offset: number | null;
} {
  const nextOffset = offset + returnedCount;
  const hasMore = nextOffset < total;
  return {
    limit: limit ?? null,
    offset,
    returned_count: returnedCount,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueFileRoles(relevantFiles: Array<{ roles: string[] }>): FileRole[] {
  return uniqueSorted(relevantFiles.flatMap((file) => file.roles)).filter(isFileRole);
}

function isFileRole(value: string): value is FileRole {
  return FileRoleSchema.safeParse(value).success;
}

function graphNodeIdsForPreflight(
  graphContext: ReturnType<typeof graphPreflightContext>,
  relevantFiles: Array<{ path: string }>
): string[] {
  return uniqueSorted([
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
  ].filter((id): id is string => Boolean(id)));
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

function latestIndexedScan(scans: ScanManifest[]): ScanManifest | undefined {
  return scans.find((scan) =>
    scan.status === "completed" &&
    !scan.id.startsWith("scan_baseline_") &&
    !scan.id.startsWith("scan_check_")
  ) ?? scans.find((scan) => scan.status === "completed") ?? scans[0];
}

function gitOutput(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function scanInvalidationReasons(
  scan: ScanManifest,
  input: { currentBranch?: string; currentResolverInputFingerprint?: string } = {}
): string[] {
  const reasons: string[] = [];
  if (input.currentBranch && scan.branch !== input.currentBranch) {
    reasons.push("branch_changed");
  }
  if (scan.scanner_version !== DRIFT_SCANNER_VERSION) {
    reasons.push("scanner_version_changed");
  }
  if (scan.adapter_versions.typescript !== DRIFT_TYPESCRIPT_ADAPTER_VERSION) {
    reasons.push("adapter_version_changed:typescript");
  }
  if (scan.adapter_versions.resolver && scan.adapter_versions.resolver !== DRIFT_RESOLVER_VERSION) {
    reasons.push("resolver_version_changed");
  }
  if (
    scan.adapter_versions.resolver_inputs &&
    input.currentResolverInputFingerprint &&
    scan.adapter_versions.resolver_inputs !== input.currentResolverInputFingerprint
  ) {
    reasons.push("resolver_inputs_changed");
  }
  if (scan.rule_engine_version !== DRIFT_RULE_ENGINE_VERSION) {
    reasons.push("rule_engine_version_changed");
  }
  return reasons;
}

function emptyChanges(): { added: string[]; modified: string[]; deleted: string[] } {
  return { added: [], modified: [], deleted: [] };
}

function compareSnapshotsToCurrentFiles(
  repoRoot: string,
  snapshots: FileSnapshot[]
): { added: string[]; modified: string[]; deleted: string[] } {
  if (!existsSync(repoRoot)) {
    return emptyChanges();
  }

  const previous = new Map(snapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const currentFiles = walkIndexableFiles(repoRoot);
  const current = new Set(currentFiles);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const filePath of currentFiles) {
    const snapshot = previous.get(filePath);
    if (!snapshot) {
      added.push(filePath);
      continue;
    }
    if (fileContentHash(join(repoRoot, filePath)) !== snapshot.content_hash) {
      modified.push(filePath);
    }
  }

  for (const filePath of previous.keys()) {
    if (!current.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort()
  };
}

function resolverInputFingerprint(repoRoot: string): string {
  const inputs = resolverInputPaths(repoRoot)
    .map((path) => [path, fileContentHash(join(repoRoot, path))])
    .sort((left, right) => left[0].localeCompare(right[0]));
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

function resolverInputPaths(repoRoot: string): string[] {
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    return [];
  }
  const paths: string[] = [];
  collectResolverInputPaths(repoRoot, "", paths, 0);
  return paths.sort();
}

function collectResolverInputPaths(
  repoRoot: string,
  relativeDir: string,
  paths: string[],
  depth: number
): void {
  if (depth > 4) {
    return;
  }
  const absoluteDir = join(repoRoot, relativeDir);
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".npmrc") {
      continue;
    }
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", "coverage", ".next", "target", "vendor"].includes(entry.name)) {
        continue;
      }
      collectResolverInputPaths(repoRoot, relativePath, paths, depth + 1);
      continue;
    }
    if (!entry.isFile() || !isResolverInputPath(relativePath)) {
      continue;
    }
    paths.push(relativePath);
  }
}

function isResolverInputPath(filePath: string): boolean {
  const fileName = filePath.split("/").at(-1) ?? filePath;
  return fileName === "package.json" ||
    fileName === "jsconfig.json" ||
    /^tsconfig(?:\.[^.]+)?\.json$/.test(fileName);
}



function isTypescriptPath(filePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

function fileContentHash(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function scanFingerprint(manifest: ScanManifest, snapshots: FileSnapshot[]): string {
  return createHash("sha256").update(canonicalScanStateJson({ manifest, snapshots })).digest("hex");
}

function baselineSummary(storage: ReturnType<typeof openDriftStorage>, repoId: string): {
  active_count: number;
  resolved_count: number;
  by_convention: Array<{ convention_id: string; active_count: number; resolved_count: number }>;
} {
  const rows = storage.listBaselineViolations(repoId);
  const byConvention = new Map<string, { active_count: number; resolved_count: number }>();
  for (const row of rows) {
    const counts = byConvention.get(row.convention_id) ?? { active_count: 0, resolved_count: 0 };
    if (row.status === "active") {
      counts.active_count += 1;
    } else {
      counts.resolved_count += 1;
    }
    byConvention.set(row.convention_id, counts);
  }

  return {
    active_count: rows.filter((row) => row.status === "active").length,
    resolved_count: rows.filter((row) => row.status === "resolved").length,
    by_convention: [...byConvention.entries()].map(([convention_id, counts]) => ({
      convention_id,
      ...counts
    }))
  };
}



function riskyAreasForFiles(
  contract: RepoContract,
  relevantFiles: RelevantFile[]
): PreparedRiskArea[] {
  return contract.risky_areas.flatMap((area) => {
    const pathGlobs = apiCompatibleGlobs(area.path_globs);
    const matchedFiles = relevantFiles
      .filter((file) => pathGlobs.some((glob) => matchesPolicyGlob(file.path, glob)))
      .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...area, matched_files: matchedFiles }] : [];
  });
}

function waiversForFiles(
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
          .filter((file) => pathGlobs.some((glob) => matchesPolicyGlob(file.path, glob)))
          .map((file) => file.path);
    return matchedFiles.length > 0 ? [{ ...waiver, status: "active", matched_files: matchedFiles }] : [];
  });
}

function waiverStatus(
  waiver: RepoContract["waivers"][number],
  now: string
): "active" | "expired" {
  return waiver.expires_at && waiver.expires_at <= now ? "expired" : "active";
}

function requiredChecksForFiles(
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

function allRequiredChecks(contract: RepoContract): RepoContract["required_checks"] {
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

function requiredChecksFromGraphRisk(input: {
  repoRoot: string;
  graphContext: ReturnType<typeof graphPreflightContext>;
  relevantFiles: RelevantFile[];
  safeCommands: RepoContract["safe_commands"];
}): PreparedRequiredCheck[] {
  if (!input.graphContext.available || input.graphContext.reachable_data_access.length === 0) {
    return [];
  }

  const relevantPaths = new Set(input.relevantFiles.map((file) => file.path));
  const command = firstTestCommand(input.safeCommands) ??
    firstTestCommand(defaultSafeCommandsForRepo(input.repoRoot));
  if (!command) {
    return [];
  }

  const checks = new Map<string, PreparedRequiredCheck>();
  for (const access of input.graphContext.reachable_data_access) {
    if (!access.path || !relevantPaths.has(access.path)) {
      continue;
    }
    const riskKinds = uniqueSorted(access.risk_reasons
      .map((reason) => reason.risk_kind)
      .filter((riskKind) => riskKind === "data_write" || riskKind === "data_delete"));
    if (riskKinds.length === 0) {
      continue;
    }
    const evidenceNodeIds = uniqueSorted(access.data_operations
      .filter((operation) =>
        operation.operation_kind === "write" || operation.operation_kind === "delete"
      )
      .flatMap((operation) => [
        operation.operation_node_id,
        operation.data_store_node_id
      ])
      .filter((id): id is string => Boolean(id)));
    const key = `${command.command}\0${access.path}\0${riskKinds.join(",")}`;
    checks.set(key, {
      command: command.command,
      applies_to: {
        path_globs: [access.path],
        file_roles: ["api_route"]
      },
      reason: `Graph risk: ${access.path} reaches ${riskKinds.join(", ")} data operations; run API/service tests before finishing.`,
      source: "graph_risk",
      evidence_node_ids: evidenceNodeIds,
      risk_kinds: riskKinds,
      matched_files: [access.path]
    });
  }

  return [...checks.values()].sort((left, right) =>
    `${left.command}:${left.matched_files.join(",")}`.localeCompare(`${right.command}:${right.matched_files.join(",")}`)
  );
}

function graphPreflightContext(input: {
  storage: ReturnType<typeof openDriftStorage>;
  repoId: string;
  scanStatus: ReturnType<typeof scanStatusPayload>;
  targetPath?: string;
  relevantFiles: RelevantFile[];
}) {
  const latestScan = input.scanStatus.latest_scan;
  if (!latestScan) {
    return unavailableGraphContext(["scan_missing"]);
  }
  const artifact = input.storage.getFactGraphArtifact(input.repoId, latestScan.id);
  if (!artifact) {
    return unavailableGraphContext(["graph_artifact_missing"], latestScan.id);
  }

  const graph = createGraphQueryService(input.storage);
  const paths = uniqueSorted([
    input.targetPath,
    ...input.relevantFiles.map((file) => file.path)
  ].filter((path): path is string => Boolean(path))).slice(0, 10);
  const routePaths = paths.filter(isApiRoutePath);
  const routeFlows = routePaths.map((path) =>
    graph.getRouteFlow({
      repo_id: input.repoId,
      scan_id: latestScan.id,
      path,
      policy_surface: "cli-preflight"
    })
  );
  const reachableDataAccess = routePaths.map((path) =>
    graph.getReachableDataAccess({
      repo_id: input.repoId,
      scan_id: latestScan.id,
      path,
      policy_surface: "cli-preflight"
    })
  );
  const affectedFiles = paths.map((path) =>
    graph.getAffectedFiles({
      repo_id: input.repoId,
      scan_id: latestScan.id,
      path,
      policy_surface: "cli-preflight"
    })
  );
  const completeness = graph.getCompleteness({
    repo_id: input.repoId,
    scan_id: latestScan.id,
    policy_surface: "cli-preflight"
  });
  const diagnosticSummary = graph.getDiagnosticSummary({
    repo_id: input.repoId,
    scan_id: latestScan.id,
    policy_surface: "cli-preflight",
    limit: 3
  });

  return {
    available: true,
    scan_id: latestScan.id,
    completeness: {
      complete: completeness.complete,
      reasons: completeness.reasons
    },
    route_flows: routeFlows,
    reachable_data_access: reachableDataAccess,
    affected_files: affectedFiles,
    diagnostic_summary: diagnosticSummary,
    diagnostics: uniqueSorted([
      ...completeness.reasons,
      ...diagnosticSummary.completeness_reasons,
      ...diagnosticSummary.groups.map((group) => `${group.code}:${group.count}`),
      ...routeFlows.flatMap((flow) => flow.diagnostics),
      ...reachableDataAccess.flatMap((access) => access.diagnostics),
      ...affectedFiles.flatMap((affected) => affected.diagnostics)
    ])
  };
}

function unavailableGraphContext(diagnostics: string[], scanId: string | null = null) {
  return {
    available: false,
    scan_id: scanId,
    completeness: null,
    route_flows: [],
    reachable_data_access: [],
    affected_files: [],
    diagnostic_summary: null,
    diagnostics
  };
}

function firstTestCommand(commands: RepoContract["safe_commands"]): RepoContract["safe_commands"][number] | undefined {
  return commands.find((command) => /\b(test|vitest|jest)\b/.test(command.command));
}

function defaultSafeCommandsForRepo(repoRoot: string | undefined): RepoContract["safe_commands"] {
  if (!repoRoot || !hasPackageScript(repoRoot, "test")) {
    return [];
  }

  const packageManager = detectPackageManager(repoRoot);
  const command = packageManager === "pnpm"
    ? "pnpm test"
    : packageManager === "yarn"
      ? "yarn test"
      : packageManager === "bun"
        ? "bun test"
        : "npm test";
  return [{
    command,
    reason: "Run the repo test script after AI-assisted changes.",
    requires_explicit_run: true
  }];
}

function hasPackageScript(repoRoot: string, scriptName: string): boolean {
  const manifestPath = join(repoRoot, "package.json");
  if (!existsSync(manifestPath)) {
    return false;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return typeof manifest.scripts?.[scriptName] === "string";
  } catch {
    return false;
  }
}

function detectPackageManager(repoRoot: string): "pnpm" | "yarn" | "bun" | "npm" {
  if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(repoRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(repoRoot, "bun.lockb")) || existsSync(join(repoRoot, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

function requiredCheckMatchesFile(
  check: RepoContract["required_checks"][number],
  filePath: string,
  roles: string[]
): boolean {
  return scopeMatchesFile(check.applies_to, filePath, roles);
}

function scopeMatchesFile(
  scope: RepoContract["required_checks"][number]["applies_to"],
  filePath: string,
  roles: string[]
): boolean {
  if ((scope.exclude_path_globs ?? []).some((glob) => matchesPolicyGlob(filePath, glob))) {
    return false;
  }
  const pathGlobs = apiCompatibleGlobs(scope.path_globs);
  const pathMatches = pathGlobs.length === 0 ||
    pathGlobs.some((glob) => matchesPolicyGlob(filePath, glob));
  const roleMatches = !scope.file_roles?.length ||
    scope.file_roles.some((role) => roles.includes(role));
  return pathMatches && roleMatches;
}

function conventionSummary(
  allConventions: AcceptedConvention[],
  filteredConventions: AcceptedConvention[],
  listedConventions: AcceptedConvention[]
): {
  total_count: number;
  filtered_count: number;
  listed_count: number;
  deterministic_count: number;
  heuristic_count: number;
  briefing_only_count: number;
  blocking_count: number;
} {
  return {
    total_count: allConventions.length,
    filtered_count: filteredConventions.length,
    listed_count: listedConventions.length,
    deterministic_count: allConventions.filter((convention) =>
      convention.enforcement_capability === "deterministic_check"
    ).length,
    heuristic_count: allConventions.filter((convention) =>
      convention.enforcement_capability === "heuristic_check"
    ).length,
    briefing_only_count: allConventions.filter((convention) =>
      convention.enforcement_capability === "briefing_only"
    ).length,
    blocking_count: allConventions.filter((convention) =>
      convention.enforcement_mode === "block"
    ).length
  };
}

function preflightSummary(input: {
  conventions: AcceptedConvention[];
  relevantFiles: RelevantFile[];
  riskyAreas: PreparedRiskArea[];
  waivers: PreparedWaiver[];
  findings: Array<{ enforcement_result: Finding["enforcement_result"] }>;
  requiredChecks: PreparedRequiredCheck[];
  safeCommands: RepoContract["safe_commands"];
  baseline: ReturnType<typeof baselineSummary>;
  scanStatus: ReturnType<typeof scanStatusPayload>;
}): {
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

function preflightGovernance(): {
  read_only: true;
  agent_can_mutate: false;
  allowed_agent_actions: string[];
  human_approval_required_for: string[];
} {
  return {
    read_only: true,
    agent_can_mutate: false,
    allowed_agent_actions: ["read_context", "request_preflight", "propose_resolution"],
    human_approval_required_for: [
      "accept_convention",
      "reject_convention",
      "edit_convention",
      "add_exception",
      "add_contract_waiver",
      "mark_needs_review",
      "suppress_finding",
      "accept_drift",
      "mark_false_positive",
      "change_policy",
      "grant_agent_permission",
      "export_contract",
      "import_contract",
      "create_backup",
      "restore_backup"
    ]
  };
}

function isOpenPreflightFinding(finding: Finding): boolean {
  return !["fixed", "false_positive", "suppressed", "accepted_drift", "expired"].includes(finding.status);
}

function prepareFinding(finding: Finding): {
  id: string;
  convention_id: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  diff_status: FindingDiffStatus;
  enforcement_result: Finding["enforcement_result"];
} {
  return {
    id: finding.id,
    convention_id: finding.convention_id,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    diff_status: finding.diff_status,
    enforcement_result: finding.enforcement_result
  };
}

function preflightConvention(
  convention: AcceptedConvention,
  // BB-5/BB-6: same optional context, same shared derivation, as the CLI's preparedConvention. The
  // parity gate compares these entries across surfaces, so a field present on one and absent on the
  // other is a failure rather than a cosmetic difference.
  context?: ExemplarContext
): {
  id: string;
  kind: AcceptedConvention["kind"];
  statement: string;
  severity: Severity;
  enforcement_mode: AcceptedConvention["enforcement_mode"];
  enforcement_capability: AcceptedConvention["enforcement_capability"];
  scope: AcceptedConvention["scope"];
  matcher: AcceptedConvention["matcher"];
  exceptions: AcceptedConvention["exceptions"];
  agent_instruction: string;
  conforming_examples: Array<{ file_path: string; role: string | null }>;
  conforming_examples_reason: string | null;
  rationale: { derivation: string; reason: string | null };
  migration_sentence: string | null;
} {
  const exemplars = conformingExemplars({
    scopeFiles: context?.scopeFilesFor(convention) ?? [],
    // CV-5: any accepted convention, not just this one. The MCP packet and the CLI packet must not
    // disagree about what conforms, which is the EW-6 parity shape.
    violatingFiles: context?.violatingFilesAnyConvention() ?? [],
    roleByFile: context?.roleByFile,
    // Proven, not presumed - and this surface needs it most: get_task_preflight never runs a check,
    // so an absent finding here means only that nothing has ever looked.
    forbiddenImports: convention.matcher?.forbidden_imports ?? [],
    importsByFile: context?.importsByFile
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
    migration_sentence: migrationSentence(context?.baselineActiveCountFor(convention.id) ?? 0)
  };
}

function instructionForConvention(convention: AcceptedConvention): string {
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


function countDeniedFiles(repoRoot: string, deniedGlobs: string[]): number {
  if (deniedGlobs.length === 0 || !existsSync(repoRoot)) {
    return 0;
  }
  return walkIndexableFiles(repoRoot).filter((filePath) =>
    deniedGlobs.some((glob) => matchesPolicyGlob(filePath, glob))
  ).length;
}

function mcpAgentEnvelope(input: {
  surface: PolicyDecision["surface"];
  policy: Pick<PolicyDecision, "allowed" | "surface" | "reason">;
  scanStatus: ReturnType<typeof scanStatusPayload>;
  requireFresh: boolean;
  diagnostics?: string[];
  contextTruncated?: boolean;
}) {
  return createAgentEnvelopeV2({
    surface: input.surface,
    policy: input.policy,
    scan: {
      required_fresh: input.requireFresh,
      stale: input.scanStatus.stale,
      latest_scan_id: input.scanStatus.latest_scan?.id ?? null
    },
    redactions: {
      snippets_included: false,
      context_truncated: Boolean(input.contextTruncated)
    },
    diagnostics: input.diagnostics
  });
}

function isApiRoutePath(filePath: string): boolean {
  return isNextApiRoutePath(filePath);
}

function apiCompatibleGlobs(globs: string[]): string[] {
  return expandApiRouteScopeGlobs(globs);
}

function validateFindingStatus(status: FindingStatus | undefined): FindingStatus | undefined {
  if (!status) {
    return undefined;
  }
  if (
    status === "new" ||
    status === "pre_existing" ||
    status === "needs_review" ||
    status === "fixed" ||
    status === "false_positive" ||
    status === "accepted_drift" ||
    status === "suppressed" ||
    status === "expired"
  ) {
    return status;
  }
  throw new Error("status must be new, pre_existing, needs_review, fixed, false_positive, accepted_drift, suppressed, or expired.");
}

function validateSeverity(severity: Severity | undefined): Severity | undefined {
  if (!severity) {
    return undefined;
  }
  if (severity === "info" || severity === "warning" || severity === "error") {
    return severity;
  }
  throw new Error("severity must be info, warning, or error.");
}

function validateConventionKind(kind: ConventionKind | undefined): ConventionKind | undefined {
  if (!kind) {
    return undefined;
  }
  if (
    kind === "api_route_no_direct_data_access" ||
    kind === "api_route_requires_service_delegation" ||
    kind === "api_route_requires_auth_helper" ||
    kind === "middleware_must_cover_routes" ||
    kind === "api_route_requires_request_validation" ||
    kind === "session_object_must_come_from_trusted_helper" ||
    kind === "api_route_requires_authorization" ||
    kind === "api_route_requires_tenant_scope" ||
    kind === "test_expected_for_changed_module" ||
    kind === "custom_briefing"
  ) {
    return kind;
  }
  throw new Error("kind must be a supported accepted convention kind.");
}

function validateEnforcementCapability(capability: EnforcementCapability | undefined): EnforcementCapability | undefined {
  if (!capability) {
    return undefined;
  }
  if (capability === "briefing_only" || capability === "heuristic_check" || capability === "deterministic_check") {
    return capability;
  }
  throw new Error("capability must be briefing_only, heuristic_check, or deterministic_check.");
}

function validateFindingDiffStatus(diffStatus: FindingDiffStatus | undefined): FindingDiffStatus | undefined {
  if (!diffStatus) {
    return undefined;
  }
  if (diffStatus === "new_in_diff" || diffStatus === "touched_existing" || diffStatus === "outside_diff") {
    return diffStatus;
  }
  throw new Error("diff_status must be new_in_diff, touched_existing, or outside_diff.");
}

function validatePolicySurface(surface: PolicyDecision["surface"]): PolicyDecision["surface"] {
  if (
    surface === "cli-preflight" ||
    surface === "cli-check" ||
    surface === "mcp" ||
    surface === "contract-export" ||
    surface === "artifact" ||
    surface === "log" ||
    surface === "ui"
  ) {
    return surface;
  }
  throw new Error("surface must be cli-preflight, cli-check, mcp, contract-export, artifact, log, or ui.");
}

function sanitizedMcpFinding(finding: Finding) {
  return {
    finding_id: finding.id,
    convention_id: finding.convention_id,
    title: finding.title,
    severity: finding.severity,
    lifecycle: finding.status,
    diff_status: finding.diff_status,
    enforcement_result: finding.enforcement_result,
    file_refs: finding.evidence_refs.map((ref) => ({
      file_path: ref.file_path,
      ...(ref.start_line ? { start_line: ref.start_line } : {}),
      ...(ref.end_line ? { end_line: ref.end_line } : {}),
      redaction_state: ref.start_line || ref.end_line ? "line_only" : "metadata_only"
    }))
  };
}

function countBy<T, K extends string>(
  entries: T[],
  keyFor: (entry: T) => K
): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const entry of entries) {
    const key = keyFor(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
