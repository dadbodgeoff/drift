import type {
  FactRecord,
  FileSnapshot,
  Finding,
  ModuleDependent,
  RepoContract,
  ResolverDependency,
  SymbolOccurrence
} from "@drift/core";
import type {
  GraphCompleteness as GraphCompletenessRecord,
  GraphDiagnostic,
  GraphEdge,
  GraphEvidence,
  GraphNode
} from "@drift/factgraph";
import type { SqliteDriftStorage } from "@drift/storage";

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
}

export function createGraphQueryService(storage: SqliteDriftStorage): GraphQueryService {
  return new GraphQueryService(storage);
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
        fact_count: fileFacts.length
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
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
