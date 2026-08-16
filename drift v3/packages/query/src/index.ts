import type {
  FactRecord,
  FileSnapshot,
  Finding,
  ModuleDependent,
  RepoContract,
  ResolverDependency,
  SymbolOccurrence
} from "@drift/core";
import type { RepoTopology } from "@drift/core";
import type {
  GraphCompleteness as GraphCompletenessRecord,
  GraphDiagnostic,
  GraphEdge,
  GraphEvidence,
  GraphNode
} from "@drift/factgraph";
import type { SqliteDriftStorage } from "@drift/storage";
import { buildRepoTopology } from "./repo-topology.js";
export { buildEntrypointFlowProof } from "./flow-proof.js";
export { buildChangeImpact } from "./change-impact.js";
export { buildRepoContractReadModel, contractFingerprint, contractSummary } from "./contract-read-model.js";
export { buildFindingsReadModel, findingMatchesPath, reviewFinding } from "./findings-read-model.js";
export { classifyDataOperationRisk } from "./data-operation-risk.js";
export { buildLayerArchitectureProof } from "./layer-architecture.js";
export { buildSymbolIdentity } from "./symbol-identity.js";
export { selectRelevantTests } from "./test-intelligence.js";
export { classifyAgentTask } from "./task-intent.js";
export { evaluateRoleEdge } from "./role-ontology.js";
export { scoreHelperSimilarity } from "./helper-similarity.js";
export { buildRepoTopology } from "./repo-topology.js";
export { buildReadiness } from "./readiness.js";
export { buildSecurityBoundaryProofReadModel, buildSecurityPhase8ReadModel } from "./security-boundary-proof.js";
export { buildSecurityArchitectureAudit } from "./security-architecture-audit.js";
export type { BuildEntrypointFlowProofInput } from "./flow-proof.js";
export type { BuildChangeImpactInput, ChangeImpactRouteFlow } from "./change-impact.js";
export type { ClassifyDataOperationRiskInput } from "./data-operation-risk.js";
export type {
  BuildReadinessInput,
  DriftReadiness,
  DriftReadinessDecision,
  DriftReadinessSurface
} from "./readiness.js";
export type {
  BuildLayerArchitectureProofInput,
  LayerArchitectureObservedEdge,
  LayerArchitectureProof
} from "./layer-architecture.js";
export type { HelperFeatureProfile, ScoreHelperSimilarityInput } from "./helper-similarity.js";
export type { RoleEdgeDecision, RoleEdgeInput, RoleEdgeKind } from "./role-ontology.js";
export type { BuildSymbolIdentityInput } from "./symbol-identity.js";
export type { RelevantTestsSelection, SelectRelevantTestsInput } from "./test-intelligence.js";
export type {
  BuildSecurityBoundaryProofReadModelInput,
  BuildSecurityPhase8ReadModelInput,
  SecurityBoundaryProofReadModel,
  SecurityBoundaryProofRouteSummary,
  SecurityCapabilitySummary,
  SecurityPhase8Route
} from "./security-boundary-proof.js";
export type {
  BuildSecurityArchitectureAuditInput,
  SecurityArchitectureAudit,
  SecurityArchitectureAuditArea,
  SecurityArchitectureAuditAreaKey,
  SecurityArchitectureAuditPattern,
  SecurityArchitectureProofTruth,
  SecurityArchitectureSemanticRole
} from "./security-architecture-audit.js";

export interface GraphRepoMapFile {
  path: string;
  content_hash: string;
  byte_size: number;
  indexed: boolean;
  roles: string[];
  imports: string[];
  exported_symbols: string[];
  calls: string[];
  graph_node_ids: string[];
  evidence_ids: string[];
  fact_count: number;
  route_security?: RepoMapRouteSecurity;
}

export interface RepoMapRouteSecurity {
  middleware_coverage: {
    proven: boolean;
    protection_kinds: string[];
    middleware_ids: string[];
  };
  request_validation: {
    status: "not_required" | "not_evaluated" | "missing_proof";
    input_sources: string[];
  };
  session_trust?: {
    status: "advisory_only";
    advisory_session_variables: string[];
    advisory_trusted_source_count: number;
    advisory_untrusted_source_count: number;
  };
  authorization?: {
    status: "advisory_only";
    advisory_guard_ids: string[];
    advisory_role_count: number;
  };
  tenant_scope?: {
    status: "advisory_only";
    advisory_tenant_keys: string[];
    advisory_trusted_source_count: number;
    advisory_predicate_count: number;
  };
}

export interface GraphRepoMap {
  repo_id: string;
  scan_id: string;
  files: GraphRepoMapFile[];
  graph_summary: {
    node_count: number;
    edge_count: number;
    evidence_count: number;
    graph_backed: boolean;
  };
}

export interface RepoMapFile extends GraphRepoMapFile {
  convention_ids: string[];
  risky_area_ids: string[];
  open_finding_ids: string[];
}

export interface RepoMapReadModel {
  all_files: RepoMapFile[];
  filtered_files: RepoMapFile[];
  listed_files: RepoMapFile[];
  summary: RepoMapSummary;
  impact_summary: RepoMapImpactSummary;
  pagination: RepoMapPagination;
  topology: RepoTopology;
}

export interface RepoMapSummary {
  indexed_file_count: number;
  filtered_file_count: number;
  listed_file_count: number;
  role_counts: Record<string, number>;
  import_count: number;
  export_count: number;
  call_count: number;
}

export interface RepoMapImpactSummary {
  convention_coverage_count: number;
  risky_file_count: number;
  open_finding_count: number;
}

export interface RepoMapPagination {
  limit: number | null;
  offset: number;
  returned_count: number;
  has_more: boolean;
  next_offset: number | null;
}

export interface GraphQueryStorage {
  listFileSnapshots(repoId: string, scanId: string): FileSnapshot[];
  listGraphNodes(repoId: string, scanId: string): GraphNode[];
  listGraphEdges(repoId: string, scanId: string): GraphEdge[];
  listGraphEvidence(repoId: string, scanId: string): GraphEvidence[];
  listGraphDiagnostics?(repoId: string, scanId: string): GraphDiagnostic[];
  listGraphCompleteness?(repoId: string, scanId: string): GraphCompletenessRecord[];
  listResolverDependencies?(repoId: string, scanId: string): ResolverDependency[];
  listModuleDependents?(repoId: string, scanId: string): ModuleDependent[];
  listSymbolOccurrences?(repoId: string, scanId: string): SymbolOccurrence[];
}

export type GraphQueryPolicySurface =
  | "cli-preflight"
  | "cli-check"
  | "mcp"
  | "contract-export"
  | "artifact"
  | "log"
  | "ui";

export interface GraphQueryContext {
  repo_id: string;
  scan_id?: string;
  graph_id?: string;
  require_fresh?: boolean;
  policy_surface?: GraphQueryPolicySurface;
  actor?: string;
  limit?: number;
}

export interface GraphQueryMetadata {
  repo_id: string;
  scan_id: string;
  graph_id?: string;
  freshness: "unknown" | "current" | "stale";
  policy: {
    surface?: GraphQueryPolicySurface;
    local_only: true;
  };
  diagnostics: string[];
}

export interface GraphRouteFlow extends GraphQueryMetadata {
  route_id?: string;
  path?: string;
  method?: string;
  route_pattern?: string;
  framework_role?: string;
  dynamic_params: string[];
  complete: boolean;
  route_module_id?: string;
  route_handler_symbol_ids: string[];
  service_module_ids: string[];
  data_access_module_ids: string[];
  module_path: string[];
  unresolved_imports: string[];
  risk_reasons: GraphRouteRiskReason[];
  next_commands: string[];
  recommended_action: string;
}

export interface GraphReachableDataAccess extends GraphQueryMetadata {
  path?: string;
  method?: string;
  data_access_module_ids: string[];
  data_operations: GraphReachableDataOperation[];
  risk_reasons: GraphRouteRiskReason[];
  module_path: string[];
}

export interface GraphRouteRiskReason {
  risk_kind: "data_write" | "data_delete";
  operation_kind: string;
  operation_name: string;
  store_name?: string;
  file_path: string;
  start_line?: number;
}

export interface GraphReachableDataOperation {
  operation_node_id: string;
  data_store_node_id?: string;
  file_path: string;
  start_line?: number;
  operation_kind: string;
  operation_name: string;
  store_name?: string;
  receiver_name?: string;
}

export interface GraphAffectedFiles extends GraphQueryMetadata {
  path: string;
  files: string[];
}

export interface GraphSymbolNeighborhood extends GraphQueryMetadata {
  symbol_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  occurrence_count: number;
  occurrence_files: string[];
  occurrences: SymbolOccurrence[];
}

export interface GraphFindingEvidence extends GraphQueryMetadata {
  finding_id: string;
  evidence: GraphEvidence[];
  related_nodes: GraphNode[];
}

export interface GraphFindingEvidenceInput extends GraphQueryContext {
  finding_id: string;
  evidence_ids?: string[];
  fact_ids?: string[];
  file_paths?: string[];
}

export interface GraphCompleteness extends GraphQueryMetadata {
  complete: boolean;
  reasons: string[];
}

export interface GraphDiagnosticGroup {
  code: string;
  severity: string;
  count: number;
  file_count: number;
  sample_files: string[];
  sample_messages: string[];
}

export interface GraphDiagnosticSummary extends GraphQueryMetadata {
  total_count: number;
  groups: GraphDiagnosticGroup[];
  completeness_reasons: string[];
}

export class GraphQueryService {
  constructor(private readonly storage: GraphQueryStorage) {}

  getRepoMap(input: GraphQueryContext): GraphRepoMap {
    return this.repoMap({ repoId: input.repo_id, scanId: requireScanId(input) });
  }

  repoMap(input: { repoId: string; scanId: string }): GraphRepoMap {
    const snapshots = this.storage.listFileSnapshots(input.repoId, input.scanId)
      .filter((snapshot) => snapshot.indexed)
      .sort((left, right) => left.file_path.localeCompare(right.file_path));
    const nodes = this.storage.listGraphNodes(input.repoId, input.scanId);
    const edges = this.storage.listGraphEdges(input.repoId, input.scanId);
    const evidence = this.storage.listGraphEvidence(input.repoId, input.scanId);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const evidenceIdsByFile = groupEvidenceByFile(evidence);
    const files = snapshots.map((snapshot) => {
      const fileNodeId = `file:${snapshot.file_path}`;
      const fileNodeIds = new Set<string>([fileNodeId]);
      const roles = new Set<string>();
      const imports = new Set<string>();
      const exportedSymbols = new Set<string>();
      const calls = new Set<string>();
      const factIds = new Set<string>();
      const fileEvidenceIds = evidenceIdsByFile.get(snapshot.file_path) ?? new Set<string>();

      for (const edge of edges) {
        if (edge.from === fileNodeId || edge.to === fileNodeId) {
          fileNodeIds.add(edge.from);
          fileNodeIds.add(edge.to);
        }
        if (edge.kind === "FILE_HAS_ROLE" && edge.from === fileNodeId) {
          const roleNode = nodesById.get(edge.to);
          roles.add(stringMetadata(roleNode, "role") ?? roleNode?.label ?? edge.to.replace(/^file_role:/, ""));
          addEvidence(edge.evidence_ids, fileEvidenceIds);
        }
        if (edge.kind === "FILE_CONTAINS_SYMBOL" && edge.from === fileNodeId) {
          const symbolNode = nodesById.get(edge.to);
          if (symbolNode?.metadata.exported === true) {
            exportedSymbols.add(symbolNode.label);
          }
          addEvidence(edge.evidence_ids, fileEvidenceIds);
        }
      }

      for (const node of nodes) {
        if (stringMetadata(node, "file_path") !== snapshot.file_path) {
          continue;
        }
        fileNodeIds.add(node.id);
        addEvidence(node.evidence_ids, fileEvidenceIds);
        if (node.kind === "import_decl") {
          imports.add(stringMetadata(node, "source") ?? node.label);
        }
        if (node.kind === "callsite") {
          calls.add(stringMetadata(node, "callee_name") ?? node.label);
        }
        if (node.kind === "symbol" && node.metadata.exported === true) {
          exportedSymbols.add(node.label);
        }
      }

      for (const evidenceId of fileEvidenceIds) {
        const item = evidence.find((entry) => entry.id === evidenceId);
        for (const factId of item?.fact_ids ?? []) {
          factIds.add(factId);
        }
      }

      return {
        path: snapshot.file_path,
        content_hash: snapshot.content_hash,
        byte_size: snapshot.byte_size,
        indexed: snapshot.indexed,
        roles: sorted(roles),
        imports: sorted(imports),
        exported_symbols: sorted(exportedSymbols),
        calls: sorted(calls),
        graph_node_ids: sorted(fileNodeIds),
        evidence_ids: sorted(fileEvidenceIds),
        fact_count: factIds.size
      };
    });

    return {
      repo_id: input.repoId,
      scan_id: input.scanId,
      files,
      graph_summary: {
        node_count: nodes.length,
        edge_count: edges.length,
        evidence_count: evidence.length,
        graph_backed: nodes.length > 0
      }
    };
  }

  getRouteFlow(input: GraphQueryContext & {
    route_id?: string;
    path?: string;
    method?: string;
  }): GraphRouteFlow {
    const scanId = requireScanId(input);
    const nodes = this.storage.listGraphNodes(input.repo_id, scanId);
    const edges = this.storage.listGraphEdges(input.repo_id, scanId);
    const evidence = this.storage.listGraphEvidence(input.repo_id, scanId);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const moduleByFile = moduleIdsByFile(nodes);
    const rolesByFile = fileRolesByPath(edges, nodesById);
    const route = findRouteNode(nodes, input);
    const routeFilePath = stringMetadata(route, "file_path");
    const path = routeFilePath ?? input.path;
    const routeModuleId = routeFilePath ? moduleByFile.get(routeFilePath) : (path ? moduleByFile.get(path) : undefined);
    const traversal = routeModuleId
      ? traverseModules(routeModuleId, edges, nodesById, rolesByFile, input.limit ?? 50)
      : {
        modulePath: [],
        serviceModuleIds: new Set<string>(),
        dataAccessModuleIds: new Set<string>(),
        unresolvedImports: [] as string[]
      };
    const routeHandlerSymbolIds = route
      ? edges
        .filter((edge) => edge.kind === "ROUTE_HANDLED_BY_SYMBOL" && edge.from === route.id)
        .map((edge) => edge.to)
        .sort((left, right) => left.localeCompare(right))
      : [];
    const diagnostics = [
      ...(!route ? ["route_not_found"] : []),
      ...(routeModuleId ? [] : ["route_module_not_found"]),
      ...traversal.unresolvedImports.map((source) => `unresolved_import:${source}`)
    ];
    const dataOperations = reachableDataOperations(traversal.modulePath, nodes, edges, evidence);

    return {
      ...queryMetadata(input, scanId, diagnostics),
      route_id: route?.id ?? input.route_id,
      path,
      method: input.method ?? stringMetadata(route, "method"),
      route_pattern: stringMetadata(route, "route_pattern"),
      framework_role: stringMetadata(route, "framework_role"),
      dynamic_params: stringArrayMetadata(route, "dynamic_params"),
      complete: diagnostics.length === 0,
      route_module_id: routeModuleId,
      route_handler_symbol_ids: routeHandlerSymbolIds,
      service_module_ids: sorted(traversal.serviceModuleIds),
      data_access_module_ids: sorted(traversal.dataAccessModuleIds),
      module_path: traversal.modulePath,
      unresolved_imports: traversal.unresolvedImports,
      risk_reasons: routeRiskReasons(dataOperations),
      next_commands: ["drift repo map --json", "drift findings list --json"],
      recommended_action: traversal.dataAccessModuleIds.size > 0
        ? "Review whether route data access is delegated through an accepted service layer."
        : "No reachable data-access module was found from this route graph."
    };
  }

  getReachableDataAccess(input: GraphQueryContext & {
    path?: string;
    method?: string;
  }): GraphReachableDataAccess {
    const flow = this.getRouteFlow(input);
    const nodes = this.storage.listGraphNodes(input.repo_id, flow.scan_id);
    const edges = this.storage.listGraphEdges(input.repo_id, flow.scan_id);
    const evidence = this.storage.listGraphEvidence(input.repo_id, flow.scan_id);
    const dataOperations = reachableDataOperations(flow.module_path, nodes, edges, evidence);
    return {
      ...queryMetadata(input, flow.scan_id, flow.diagnostics),
      path: flow.path,
      method: flow.method,
      data_access_module_ids: flow.data_access_module_ids,
      data_operations: dataOperations,
      risk_reasons: routeRiskReasons(dataOperations),
      module_path: flow.module_path
    };
  }

  getAffectedFiles(input: GraphQueryContext & { path: string }): GraphAffectedFiles {
    const scanId = requireScanId(input);
    const nodes = this.storage.listGraphNodes(input.repo_id, scanId);
    const moduleByFile = moduleIdsByFile(nodes);
    const fileByModule = moduleFilesById(nodes);
    const moduleId = moduleByFile.get(input.path);
    const affected = new Set<string>([input.path]);
    const queuedModules = new Set<string>();
    const queueModule = (id: string | undefined): void => {
      if (!id || queuedModules.has(id)) {
        return;
      }
      queuedModules.add(id);
    };

    queueModule(moduleId);

    const resolverDependencies = this.storage.listResolverDependencies?.(input.repo_id, scanId);
    const dependents = this.storage.listModuleDependents?.(input.repo_id, scanId);
    const projectionBacked = Boolean(resolverDependencies || dependents);

    if (moduleId && !projectionBacked) {
      const edges = this.storage.listGraphEdges(input.repo_id, scanId);
      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      for (const edge of edges) {
        if (edge.from !== moduleId && edge.to !== moduleId) {
          continue;
        }
        const other = nodesById.get(edge.from === moduleId ? edge.to : edge.from);
        const filePath = stringMetadata(other, "file_path") ?? stringMetadata(other, "path");
        if (filePath) {
          affected.add(filePath);
        }
      }
    }

    for (const dependency of resolverDependencies ?? []) {
      if (dependency.dependency_path !== input.path) {
        continue;
      }
      affected.add(dependency.source_path);
      queueModule(moduleByFile.get(dependency.source_path));
    }

    if ((dependents ?? []).length > 0) {
      const dependentsByModule = new Map<string, ModuleDependent[]>();
      for (const dependent of dependents ?? []) {
        const existing = dependentsByModule.get(dependent.module_id) ?? [];
        existing.push(dependent);
        dependentsByModule.set(dependent.module_id, existing);
      }
      const pending = [...queuedModules].sort((left, right) => left.localeCompare(right));
      for (let index = 0; index < pending.length; index += 1) {
        const current = pending[index];
        for (const dependent of dependentsByModule.get(current) ?? []) {
          const dependentPath = fileByModule.get(dependent.dependent_module_id);
          if (dependentPath) {
            affected.add(dependentPath);
          }
          if (!queuedModules.has(dependent.dependent_module_id)) {
            queuedModules.add(dependent.dependent_module_id);
            pending.push(dependent.dependent_module_id);
          }
        }
      }
    }
    return {
      ...queryMetadata(input, scanId, []),
      path: input.path,
      files: sorted(affected)
    };
  }

  getSymbolNeighborhood(input: GraphQueryContext & {
    symbol_id: string;
    depth?: 1 | 2;
  }): GraphSymbolNeighborhood {
    const scanId = requireScanId(input);
    const nodes = this.storage.listGraphNodes(input.repo_id, scanId);
    const edges = this.storage.listGraphEdges(input.repo_id, scanId);
    const symbolExists = nodes.some((node) => node.id === input.symbol_id && node.kind === "symbol");
    if (!symbolExists) {
      return {
        ...queryMetadata(input, scanId, ["symbol_not_found"]),
        symbol_id: input.symbol_id,
        nodes: [],
        edges: [],
        occurrence_count: 0,
        occurrence_files: [],
        occurrences: []
      };
    }
    const occurrences = (this.storage.listSymbolOccurrences?.(input.repo_id, scanId) ?? [])
      .filter((occurrence) => occurrence.symbol_id === input.symbol_id)
      .sort((left, right) =>
        left.file_path.localeCompare(right.file_path) ||
        left.start_line - right.start_line ||
        left.occurrence_kind.localeCompare(right.occurrence_kind) ||
        left.id.localeCompare(right.id)
      );
    const depth = input.depth ?? 1;
    const selectedIds = new Set<string>([input.symbol_id]);
    for (let index = 0; index < depth; index += 1) {
      for (const edge of edges) {
        if (selectedIds.has(edge.from) || selectedIds.has(edge.to)) {
          selectedIds.add(edge.from);
          selectedIds.add(edge.to);
        }
      }
    }
    return {
      ...queryMetadata(input, scanId, []),
      symbol_id: input.symbol_id,
      nodes: nodes
        .filter((node) => selectedIds.has(node.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
      edges: edges
        .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)),
      occurrence_count: occurrences.length,
      occurrence_files: sorted(new Set(occurrences.map((occurrence) => occurrence.file_path))),
      occurrences
    };
  }

  getFindingEvidence(input: GraphFindingEvidenceInput): GraphFindingEvidence {
    const scanId = requireScanId(input);
    const nodes = this.storage.listGraphNodes(input.repo_id, scanId);
    const edges = this.storage.listGraphEdges(input.repo_id, scanId);
    const evidence = this.storage.listGraphEvidence(input.repo_id, scanId);
    const explicitEvidenceIds = new Set(input.evidence_ids ?? []);
    const factIds = new Set(input.fact_ids ?? []);
    const filePaths = new Set(input.file_paths ?? []);
    const findingNodeIds = new Set([input.finding_id, `finding:${input.finding_id}`]);
    for (const edge of edges) {
      if (edge.kind !== "FINDING_HAS_EVIDENCE") {
        continue;
      }
      if (findingNodeIds.has(edge.from)) {
        explicitEvidenceIds.add(edge.to);
      }
      if (findingNodeIds.has(edge.to)) {
        explicitEvidenceIds.add(edge.from);
      }
      if (findingNodeIds.has(edge.from) || findingNodeIds.has(edge.to)) {
        for (const evidenceId of edge.evidence_ids) {
          explicitEvidenceIds.add(evidenceId);
        }
      }
    }
    const selectedEvidence = evidence.filter((item) => {
      if (explicitEvidenceIds.has(item.id)) {
        return true;
      }
      if ([...factIds].some((factId) => item.fact_ids.includes(factId))) {
        return true;
      }
      return filePaths.has(item.file_path);
    });
    const selectedEvidenceIds = new Set(selectedEvidence.map((item) => item.id));
    const diagnostics = selectedEvidence.length === 0 ? ["finding_evidence_not_linked"] : [];
    return {
      ...queryMetadata(input, scanId, diagnostics),
      finding_id: input.finding_id,
      evidence: selectedEvidence,
      related_nodes: nodes.filter((node) => node.evidence_ids.some((evidenceId) => selectedEvidenceIds.has(evidenceId)))
    };
  }

  getCompleteness(input: GraphQueryContext): GraphCompleteness {
    const scanId = requireScanId(input);
    const nodes = this.storage.listGraphNodes(input.repo_id, scanId);
    const edges = this.storage.listGraphEdges(input.repo_id, scanId);
    const reasons: string[] = [];
    if (nodes.length === 0) {
      reasons.push("graph_empty");
    }
    for (const completeness of this.storage.listGraphCompleteness?.(input.repo_id, scanId) ?? []) {
      if (!completeness.complete) {
        reasons.push(...completeness.reasons);
        reasons.push(...completeness.missing_capabilities);
      }
    }
    for (const diagnostic of this.storage.listGraphDiagnostics?.(input.repo_id, scanId) ?? []) {
      if (diagnostic.code === "unresolved_import" || diagnostic.code === "unresolved_import_symbol") {
        reasons.push("import_resolution_incomplete");
      }
    }
    const importResolutionEdgeCount = new Set(
      edges
        .filter((edge) => edge.kind === "IMPORT_RESOLVES_TO_MODULE")
        .map((edge) => `${edge.from}\0${edge.to}`)
    ).size;
    if (importResolutionEdgeCount > 0 && this.storage.listResolverDependencies) {
      const resolverDependencyCount = this.storage
        .listResolverDependencies(input.repo_id, scanId).length;
      if (resolverDependencyCount < importResolutionEdgeCount) {
        reasons.push("resolver_dependencies_missing");
      }
    }
    const uniqueReasons = unique(reasons);
    return {
      ...queryMetadata(input, scanId, uniqueReasons),
      complete: uniqueReasons.length === 0,
      reasons: uniqueReasons
    };
  }

  getDiagnosticSummary(input: GraphQueryContext): GraphDiagnosticSummary {
    const scanId = requireScanId(input);
    const limit = input.limit ?? 3;
    const diagnostics = this.storage.listGraphDiagnostics?.(input.repo_id, scanId) ?? [];
    const completenessReasons = unique(
      (this.storage.listGraphCompleteness?.(input.repo_id, scanId) ?? [])
        .flatMap((completeness) => [
          ...(!completeness.complete ? completeness.reasons : []),
          ...completeness.missing_capabilities
        ])
    );
    const grouped = new Map<string, {
      code: string;
      severity: string;
      count: number;
      files: Set<string>;
      messages: Set<string>;
    }>();

    for (const diagnostic of diagnostics) {
      const key = `${diagnostic.code}\0${diagnostic.severity}`;
      const group = grouped.get(key) ?? {
        code: diagnostic.code,
        severity: diagnostic.severity,
        count: 0,
        files: new Set<string>(),
        messages: new Set<string>()
      };
      group.count += 1;
      if (diagnostic.file_path) {
        group.files.add(diagnostic.file_path);
      }
      group.messages.add(diagnostic.message);
      grouped.set(key, group);
    }

    const groups = [...grouped.values()]
      .map((group) => ({
        code: group.code,
        severity: group.severity,
        count: group.count,
        file_count: group.files.size,
        sample_files: sorted(group.files).slice(0, limit),
        sample_messages: sorted(group.messages).slice(0, limit)
      }))
      .sort((left, right) =>
        right.count - left.count ||
        left.severity.localeCompare(right.severity) ||
        left.code.localeCompare(right.code)
      );

    return {
      ...queryMetadata(input, scanId, completenessReasons),
      total_count: diagnostics.length,
      groups,
      completeness_reasons: completenessReasons
    };
  }
}

export function createGraphQueryService(storage: SqliteDriftStorage): GraphQueryService {
  return new GraphQueryService(storage);
}

export function buildRepoMapReadModel(input: {
  repoId?: string;
  scanId?: string | null;
  graphFiles: GraphRepoMapFile[];
  factFiles: GraphRepoMapFile[];
  contract: RepoContract;
  findings: Finding[];
  filters?: {
    role?: string;
    path?: string;
  };
  limit?: number;
  offset?: number;
}): RepoMapReadModel {
  const allFiles = buildRepoMapFiles(input);
  const filteredFiles = allFiles.filter((file) =>
    (!input.filters?.role || file.roles.includes(input.filters.role)) &&
    (!input.filters?.path || file.path === input.filters.path || matchesRepoGlob(file.path, input.filters.path))
  );
  const offset = input.offset ?? 0;
  const listedFiles = paginateRepoMapFiles(filteredFiles, input.limit, offset);
  return {
    all_files: allFiles,
    filtered_files: filteredFiles,
    listed_files: listedFiles,
    summary: repoMapSummary(allFiles, filteredFiles, listedFiles),
    impact_summary: repoMapImpactSummary(listedFiles),
    pagination: repoMapPagination(filteredFiles.length, listedFiles.length, input.limit, offset),
    topology: buildRepoTopology({
      repo_id: input.repoId ?? input.contract.repo_id,
      scan_id: input.scanId ?? null,
      files: allFiles
    })
  };
}

export function buildRepoMapFiles(input: {
  graphFiles: GraphRepoMapFile[];
  factFiles: GraphRepoMapFile[];
  contract: RepoContract;
  findings: Finding[];
}): RepoMapFile[] {
  return mergeGraphAndFactRepoMapFiles(input.graphFiles, input.factFiles)
    .map((file) => ({
      ...file,
      convention_ids: repoMapConventionIds(input.contract, file.path),
      risky_area_ids: repoMapRiskyAreaIds(input.contract, file.path),
      open_finding_ids: repoMapOpenFindingIds(input.findings, file.path)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function mergeGraphAndFactRepoMapFiles(
  graphFiles: GraphRepoMapFile[],
  factFiles: GraphRepoMapFile[]
): GraphRepoMapFile[] {
  const factByPath = new Map(factFiles.map((file) => [file.path, file]));
  const graphByPath = new Map(graphFiles.map((file) => [file.path, file]));
  const paths = unique([...graphByPath.keys(), ...factByPath.keys()]);
  return paths.map((path) => {
    const graphFile = graphByPath.get(path);
    const factFile = factByPath.get(path);
    if (!graphFile) {
      return factFile!;
    }
    if (!factFile) {
      return graphFile;
    }
    return {
      path,
      content_hash: graphFile.content_hash,
      byte_size: graphFile.byte_size,
      indexed: graphFile.indexed,
      roles: unique([...graphFile.roles, ...factFile.roles]),
      imports: unique([...graphFile.imports, ...factFile.imports]),
      exported_symbols: unique([...graphFile.exported_symbols, ...factFile.exported_symbols]),
      calls: unique([...graphFile.calls, ...factFile.calls]),
      graph_node_ids: unique([...graphFile.graph_node_ids, ...factFile.graph_node_ids]),
      evidence_ids: unique([...graphFile.evidence_ids, ...factFile.evidence_ids]),
      fact_count: Math.max(graphFile.fact_count, factFile.fact_count),
      route_security: mergeRouteSecurity(graphFile.route_security, factFile.route_security)
    };
  });
}

export function repoMapConventionIds(contract: RepoContract, filePath: string): string[] {
  return unique(contract.conventions
    .filter((convention) =>
      convention.scope.path_globs.some((glob) => matchesRepoGlob(filePath, glob)) &&
      !(convention.scope.exclude_path_globs ?? []).some((glob) => matchesRepoGlob(filePath, glob))
    )
    .map((convention) => convention.id));
}

export function repoMapRiskyAreaIds(contract: RepoContract, filePath: string): string[] {
  return unique(contract.risky_areas
    .filter((area) => area.path_globs.some((glob) => matchesRepoGlob(filePath, glob)))
    .map((area) => area.id));
}

export function repoMapOpenFindingIds(findings: Finding[], filePath: string): string[] {
  return unique(findings
    .filter((finding) =>
      !isClosedFindingStatus(finding.status) &&
      finding.evidence_refs.some((ref) => ref.file_path === filePath)
    )
    .map((finding) => finding.id));
}

export function paginateRepoMapFiles(files: RepoMapFile[], limit: number | undefined, offset: number): RepoMapFile[] {
  return limit === undefined
    ? files.slice(offset)
    : files.slice(offset, offset + limit);
}

export function repoMapImpactSummary(files: RepoMapFile[]): RepoMapImpactSummary {
  return {
    convention_coverage_count: files.filter((file) => file.convention_ids.length > 0).length,
    risky_file_count: files.filter((file) => file.risky_area_ids.length > 0).length,
    open_finding_count: files.reduce((count, file) => count + file.open_finding_ids.length, 0)
  };
}

export function repoMapSummary(
  allFiles: RepoMapFile[],
  filteredFiles: RepoMapFile[],
  listedFiles: RepoMapFile[]
): RepoMapSummary {
  const roleCounts: Record<string, number> = {};
  for (const file of listedFiles) {
    for (const role of file.roles) {
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
  }
  return {
    indexed_file_count: allFiles.length,
    filtered_file_count: filteredFiles.length,
    listed_file_count: listedFiles.length,
    role_counts: roleCounts,
    import_count: listedFiles.reduce((count, file) => count + file.imports.length, 0),
    export_count: listedFiles.reduce((count, file) => count + file.exported_symbols.length, 0),
    call_count: listedFiles.reduce((count, file) => count + file.calls.length, 0)
  };
}

export function repoMapPagination(
  total: number,
  returnedCount: number,
  limit: number | undefined,
  offset: number
): RepoMapPagination {
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

export function matchesRepoGlob(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}

export function decorateRepoMapFiles<T extends {
  path: string;
  convention_ids?: string[];
  risky_area_ids?: string[];
  open_finding_ids?: string[];
}>(
  files: T[],
  input: {
    contract: RepoContract;
    findings: Finding[];
    conventionIdsForPath: (contract: RepoContract, filePath: string) => string[];
    riskyAreaIdsForPath: (contract: RepoContract, filePath: string) => string[];
    openFindingIdsForPath: (findings: Finding[], filePath: string) => string[];
  }
): Array<T & {
  convention_ids: string[];
  risky_area_ids: string[];
  open_finding_ids: string[];
}> {
  return files.map((file) => ({
    ...file,
    convention_ids: input.conventionIdsForPath(input.contract, file.path),
    risky_area_ids: input.riskyAreaIdsForPath(input.contract, file.path),
    open_finding_ids: input.openFindingIdsForPath(input.findings, file.path)
  }));
}

function isClosedFindingStatus(status: Finding["status"]): boolean {
  return ["fixed", "false_positive", "suppressed", "accepted_drift", "expired"].includes(status);
}

export function fallbackFactRepoMapFiles(
  snapshots: FileSnapshot[],
  facts: FactRecord[]
): GraphRepoMapFile[] {
  const factsByFile = new Map<string, FactRecord[]>();
  for (const fact of facts) {
    const existing = factsByFile.get(fact.file_path) ?? [];
    existing.push(fact);
    factsByFile.set(fact.file_path, existing);
  }

  return snapshots
    .filter((snapshot) => snapshot.indexed)
    .map((snapshot) => {
      const fileFacts = factsByFile.get(snapshot.file_path) ?? [];
      return {
        path: snapshot.file_path,
        content_hash: snapshot.content_hash,
        byte_size: snapshot.byte_size,
        indexed: snapshot.indexed,
        roles: unique(fileFacts
          .filter((fact) => fact.kind === "file_role_detected")
          .map((fact) => fact.name)),
        imports: unique(fileFacts
          .filter((fact) => fact.kind === "import_used")
          .map((fact) => fact.value ?? fact.name)),
        exported_symbols: unique(fileFacts
          .filter((fact) => fact.kind === "exported_symbol")
          .map((fact) => fact.name)),
        calls: unique(fileFacts
          .filter((fact) => fact.kind === "symbol_called")
          .map((fact) => fact.name)),
        graph_node_ids: [],
        evidence_ids: [],
        fact_count: fileFacts.length,
        route_security: routeSecurityFromFacts(fileFacts)
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function routeSecurityFromFacts(fileFacts: FactRecord[]): RepoMapRouteSecurity | undefined {
  const middlewareProtectionFacts = fileFacts.filter((fact) =>
    fact.kind === "middleware_protects_route"
  );
  const requestInputFacts = fileFacts.filter((fact) => fact.kind === "request_input_read");
  const validatedUseFacts = fileFacts.filter((fact) => fact.kind === "validated_input_used");
  const sessionReadFacts = fileFacts.filter((fact) => fact.kind === "session_read");
  const authorizationGuardFacts = fileFacts.filter((fact) => fact.kind === "authorization_guard_called");
  const tenantSourceFacts = fileFacts.filter((fact) => fact.kind === "tenant_source");
  const tenantGuardFacts = fileFacts.filter((fact) => fact.kind === "tenant_guard_called");
  if (
    middlewareProtectionFacts.length === 0 &&
    requestInputFacts.length === 0 &&
    validatedUseFacts.length === 0 &&
    sessionReadFacts.length === 0 &&
    authorizationGuardFacts.length === 0 &&
    tenantSourceFacts.length === 0 &&
    tenantGuardFacts.length === 0
  ) {
    return undefined;
  }
  const middlewareIds = middlewareProtectionFacts.map((fact) => {
    const metadata = parseFactValue(fact.value);
    return typeof metadata.middleware_id === "string" ? metadata.middleware_id : fact.name;
  });
  const protectionKinds = middlewareProtectionFacts.map((fact) => {
    const metadata = parseFactValue(fact.value);
    return typeof metadata.protection_kind === "string"
      ? metadata.protection_kind
      : fact.imported_name ?? "unknown";
  });
  const routeSecurity: RepoMapRouteSecurity = {
    middleware_coverage: {
      proven: middlewareProtectionFacts.length > 0,
      protection_kinds: unique(protectionKinds),
      middleware_ids: unique(middlewareIds)
    },
    request_validation: {
      status: requestInputFacts.length === 0
        ? "not_required"
        : "not_evaluated",
      input_sources: unique(requestInputFacts.map((fact) => {
        const metadata = parseFactValue(fact.value);
        return typeof metadata.source === "string" ? metadata.source : fact.name;
      }))
    }
  };
  if (sessionReadFacts.length > 0) {
    routeSecurity.session_trust = {
      status: "advisory_only",
      advisory_session_variables: unique(sessionReadFacts.map((fact) => fact.name)),
      advisory_trusted_source_count: sessionReadFacts.filter((fact) => parseFactValue(fact.value).trust === "trusted").length,
      advisory_untrusted_source_count: sessionReadFacts.filter((fact) => parseFactValue(fact.value).trust === "untrusted").length
    };
  }
  if (authorizationGuardFacts.length > 0) {
    routeSecurity.authorization = {
      status: "advisory_only",
      advisory_guard_ids: unique(authorizationGuardFacts.map((fact) => {
        const metadata = parseFactValue(fact.value);
        return typeof metadata.policy_id === "string"
          ? metadata.policy_id
          : typeof metadata.guard_id === "string"
            ? metadata.guard_id
            : fact.name;
      })),
      advisory_role_count: authorizationGuardFacts.reduce((count, fact) => {
        const roles = parseFactValue(fact.value).roles;
        return count + (Array.isArray(roles) ? roles.filter((role) => typeof role === "string").length : 0);
      }, 0)
    };
  }
  if (tenantSourceFacts.length > 0 || tenantGuardFacts.length > 0) {
    routeSecurity.tenant_scope = {
      status: "advisory_only",
      advisory_tenant_keys: unique([
        ...tenantSourceFacts.map((fact) => {
          const metadata = parseFactValue(fact.value);
          return typeof metadata.key === "string" ? metadata.key : fact.name;
        }),
        ...tenantGuardFacts.map((fact) => {
          const metadata = parseFactValue(fact.value);
          return typeof metadata.tenant_key === "string" ? metadata.tenant_key : fact.name;
        })
      ]),
      advisory_trusted_source_count: tenantSourceFacts.filter((fact) => parseFactValue(fact.value).trusted === true).length,
      advisory_predicate_count: tenantGuardFacts.length
    };
  }
  return routeSecurity;
}

function mergeRouteSecurity(
  left: RepoMapRouteSecurity | undefined,
  right: RepoMapRouteSecurity | undefined
): RepoMapRouteSecurity | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const routeSecurity: RepoMapRouteSecurity = {
    middleware_coverage: {
      proven: left.middleware_coverage.proven || right.middleware_coverage.proven,
      protection_kinds: unique([
        ...left.middleware_coverage.protection_kinds,
        ...right.middleware_coverage.protection_kinds
      ]),
      middleware_ids: unique([
        ...left.middleware_coverage.middleware_ids,
        ...right.middleware_coverage.middleware_ids
      ])
    },
    request_validation: {
      status: left.request_validation.status === "missing_proof" || right.request_validation.status === "missing_proof"
          ? "missing_proof"
          : left.request_validation.status === "not_evaluated" || right.request_validation.status === "not_evaluated"
            ? "not_evaluated"
            : "not_required",
      input_sources: unique([
        ...left.request_validation.input_sources,
        ...right.request_validation.input_sources
      ])
    }
  };
  routeSecurity.session_trust = left.session_trust ?? right.session_trust;
  routeSecurity.authorization = left.authorization ?? right.authorization;
  routeSecurity.tenant_scope = left.tenant_scope ?? right.tenant_scope;
  return routeSecurity;
}

function parseFactValue(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function groupEvidenceByFile(evidence: GraphEvidence[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const item of evidence) {
    const existing = grouped.get(item.file_path) ?? new Set<string>();
    existing.add(item.id);
    grouped.set(item.file_path, existing);
  }
  return grouped;
}

function addEvidence(evidenceIds: string[], target: Set<string>): void {
  for (const evidenceId of evidenceIds) {
    target.add(evidenceId);
  }
}

function stringMetadata(node: GraphNode | undefined, key: string): string | undefined {
  const value = node?.metadata[key];
  return typeof value === "string" ? value : undefined;
}

function queryMetadata(
  input: GraphQueryContext,
  scanId: string,
  diagnostics: string[]
): GraphQueryMetadata {
  return {
    repo_id: input.repo_id,
    scan_id: scanId,
    graph_id: input.graph_id,
    freshness: "unknown",
    policy: {
      surface: input.policy_surface,
      local_only: true
    },
    diagnostics
  };
}

function requireScanId(input: GraphQueryContext): string {
  if (!input.scan_id) {
    throw new Error("scan_id is required for graph queries");
  }
  return input.scan_id;
}

function findRouteNode(
  nodes: GraphNode[],
  input: { route_id?: string; path?: string; method?: string }
): GraphNode | undefined {
  return nodes.find((node) => {
    if (node.kind !== "route") {
      return false;
    }
    if (input.route_id && node.id !== input.route_id) {
      return false;
    }
    if (input.path &&
      stringMetadata(node, "file_path") !== input.path &&
      stringMetadata(node, "route_pattern") !== input.path
    ) {
      return false;
    }
    if (input.method && stringMetadata(node, "method") !== input.method) {
      return false;
    }
    return true;
  });
}

function stringArrayMetadata(node: GraphNode | undefined, key: string): string[] {
  const value = node?.metadata[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function moduleIdsByFile(nodes: GraphNode[]): Map<string, string> {
  const modules = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== "module") {
      continue;
    }
    const filePath = stringMetadata(node, "file_path");
    if (filePath) {
      modules.set(filePath, node.id);
    }
  }
  return modules;
}

function moduleFilesById(nodes: GraphNode[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== "module") {
      continue;
    }
    const filePath = stringMetadata(node, "file_path");
    if (filePath) {
      files.set(node.id, filePath);
    }
  }
  return files;
}

function reachableDataOperations(
  modulePath: string[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  evidence: GraphEvidence[]
): GraphReachableDataOperation[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const reachableFiles = new Set(
    modulePath
      .map((moduleId) => stringMetadata(nodesById.get(moduleId), "file_path"))
      .filter((filePath): filePath is string => Boolean(filePath))
  );
  const dataStoreByOperation = new Map<string, string>();
  for (const edge of edges) {
    if (!isDataOperationStoreEdge(edge.kind)) {
      continue;
    }
    dataStoreByOperation.set(edge.from, edge.to);
  }

  return nodes
    .filter((node) => node.kind === "data_operation")
    .filter((node) => {
      const filePath = stringMetadata(node, "file_path");
      return Boolean(filePath && reachableFiles.has(filePath));
    })
    .map((node) => {
      const evidenceRef = node.evidence_ids
        .map((id) => evidenceById.get(id))
        .find((item): item is GraphEvidence => Boolean(item));
      const dataStoreNodeId = dataStoreByOperation.get(node.id);
      const dataStore = dataStoreNodeId ? nodesById.get(dataStoreNodeId) : undefined;
      return {
        operation_node_id: node.id,
        data_store_node_id: dataStoreNodeId,
        file_path: stringMetadata(node, "file_path") ?? "",
        start_line: evidenceRef?.start_line,
        operation_kind: stringMetadata(node, "operation_kind") ?? "unknown",
        operation_name: stringMetadata(node, "operation_name") ?? node.label,
        store_name: stringMetadata(node, "store_name") ?? stringMetadata(dataStore, "store_name"),
        receiver_name: stringMetadata(node, "receiver_name")
      };
    })
    .sort((left, right) =>
      left.file_path.localeCompare(right.file_path) ||
      (left.start_line ?? 0) - (right.start_line ?? 0) ||
      left.operation_node_id.localeCompare(right.operation_node_id)
    );
}

function routeRiskReasons(operations: GraphReachableDataOperation[]): GraphRouteRiskReason[] {
  return operations
    .flatMap((operation): GraphRouteRiskReason[] => {
      if (operation.operation_kind !== "write" && operation.operation_kind !== "delete") {
        return [];
      }
      return [{
        risk_kind: operation.operation_kind === "delete" ? "data_delete" : "data_write",
        operation_kind: operation.operation_kind,
        operation_name: operation.operation_name,
        store_name: operation.store_name,
        file_path: operation.file_path,
        start_line: operation.start_line
      }];
    })
    .sort((left, right) =>
      left.file_path.localeCompare(right.file_path) ||
      (left.start_line ?? 0) - (right.start_line ?? 0) ||
      left.operation_name.localeCompare(right.operation_name)
    );
}

function isDataOperationStoreEdge(kind: string): boolean {
  return kind === "DATA_OPERATION_READS_DATA_STORE" ||
    kind === "DATA_OPERATION_WRITES_DATA_STORE" ||
    kind === "DATA_OPERATION_DELETES_DATA_STORE" ||
    kind === "DATA_OPERATION_TOUCHES_DATA_STORE";
}

function fileRolesByPath(
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>
): Map<string, Set<string>> {
  const rolesByPath = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.kind !== "FILE_HAS_ROLE") {
      continue;
    }
    const file = nodesById.get(edge.from);
    const role = nodesById.get(edge.to);
    const filePath = stringMetadata(file, "path");
    const roleName = stringMetadata(role, "role");
    if (!filePath || !roleName) {
      continue;
    }
    const roles = rolesByPath.get(filePath) ?? new Set<string>();
    roles.add(roleName);
    rolesByPath.set(filePath, roles);
  }
  return rolesByPath;
}

function traverseModules(
  rootModuleId: string,
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
  rolesByFile: Map<string, Set<string>>,
  limit: number
): {
  modulePath: string[];
  serviceModuleIds: Set<string>;
  dataAccessModuleIds: Set<string>;
  unresolvedImports: string[];
} {
  const importsByModule = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "MODULE_IMPORTS_MODULE") {
      continue;
    }
    const existing = importsByModule.get(edge.from) ?? [];
    existing.push(edge.to);
    importsByModule.set(edge.from, existing);
  }

  const queue = [rootModuleId];
  const seen = new Set<string>();
  const modulePath: string[] = [];
  const serviceModuleIds = new Set<string>();
  const dataAccessModuleIds = new Set<string>();
  const unresolvedImports = new Set<string>();

  while (queue.length > 0 && seen.size < limit) {
    const moduleId = queue.shift();
    if (!moduleId || seen.has(moduleId)) {
      continue;
    }
    seen.add(moduleId);
    modulePath.push(moduleId);
    const moduleNode = nodesById.get(moduleId);
    const filePath = stringMetadata(moduleNode, "file_path");
    const roles = filePath ? rolesByFile.get(filePath) : undefined;
    if (roles?.has("service_module")) {
      serviceModuleIds.add(moduleId);
    }
    if (roles?.has("data_access_module")) {
      dataAccessModuleIds.add(moduleId);
    }
    for (const next of importsByModule.get(moduleId) ?? []) {
      queue.push(next);
    }
  }

  for (const node of nodesById.values()) {
    if (node.kind !== "import_decl" || stringMetadata(node, "resolution_status") !== "unresolved") {
      continue;
    }
    const filePath = stringMetadata(node, "file_path");
    if (!filePath) {
      continue;
    }
    const ownerModuleId = `module:${filePath}`;
    if (seen.has(ownerModuleId)) {
      unresolvedImports.add(stringMetadata(node, "source") ?? node.label);
    }
  }

  return {
    modulePath,
    serviceModuleIds,
    dataAccessModuleIds,
    unresolvedImports: sorted(unresolvedImports)
  };
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function unique(values: string[]): string[] {
  return sorted(new Set(values));
}
