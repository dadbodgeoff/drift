import type { FactRecord, FileSnapshot, Finding, RepoContract } from "@drift/core";
import type { GraphEdge, GraphEvidence, GraphNode } from "@drift/factgraph";
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
}

export class GraphQueryService {
  constructor(private readonly storage: GraphQueryStorage) {}

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

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function unique(values: string[]): string[] {
  return sorted(new Set(values));
}
