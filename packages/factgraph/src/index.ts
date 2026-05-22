import type { FactRecord, FileSnapshot } from "@drift/core";
import { createHash } from "node:crypto";
import { dirname, join, normalize } from "node:path";
import { z } from "zod";

export const FACTGRAPH_SCHEMA_VERSION = "factgraph.v2";
export const SUPPORTED_FACTGRAPH_SCHEMA_VERSIONS = ["factgraph.v1", "factgraph.v2"] as const;

export const GraphNodeKindSchema = z.enum([
  "repo",
  "package",
  "artifact",
  "file",
  "file_version",
  "module",
  "symbol",
  "import_decl",
  "export_decl",
  "callsite",
  "data_store",
  "data_operation",
  "endpoint",
  "re_export",
  "route",
  "file_role",
  "diagnostic",
  "finding"
]);

export const GraphEdgeKindSchema = z.enum([
  "REPO_HAS_FILE",
  "FILE_HAS_VERSION",
  "FILE_DEFINES_MODULE",
  "FILE_HAS_ROLE",
  "FILE_CONTAINS_SYMBOL",
  "MODULE_IMPORTS_MODULE",
  "IMPORT_DECL_REFERENCES_MODULE",
  "IMPORT_RESOLVES_TO_MODULE",
  "IMPORT_RESOLVES_TO_SYMBOL",
  "MODULE_EXPORTS_SYMBOL",
  "ROUTE_DECLARED_IN_FILE",
  "ROUTE_HANDLED_BY_SYMBOL",
  "ROUTE_HAS_ENDPOINT",
  "MODULE_REEXPORTS_MODULE",
  "REEXPORT_RESOLVES_TO_SYMBOL",
  "CALLSITE_REFERENCES_SYMBOL",
  "DATA_OPERATION_READS_DATA_STORE",
  "DATA_OPERATION_WRITES_DATA_STORE",
  "DATA_OPERATION_DELETES_DATA_STORE",
  "DATA_OPERATION_TOUCHES_DATA_STORE",
  "FINDING_HAS_EVIDENCE"
]);

export const GraphEvidenceSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  artifact_id: z.string().min(1),
  file_path: z.string().min(1),
  file_hash: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  start_column: z.number().int().nonnegative().optional(),
  end_column: z.number().int().nonnegative().optional(),
  adapter_id: z.string().min(1),
  adapter_version: z.string().min(1),
  fact_ids: z.array(z.string().min(1)),
  redaction_state: z.enum(["none", "redacted", "snippet_limited"])
});

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: GraphNodeKindSchema,
  label: z.string().min(1),
  stable: z.boolean(),
  evidence_ids: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({})
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  kind: GraphEdgeKindSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  evidence_ids: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({})
});

export const GraphDiagnosticSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1),
  file_path: z.string().min(1).optional(),
  evidence_ids: z.array(z.string().min(1)).default([])
});

export const GraphCompletenessSchema = z.object({
  scope: z.enum(["repo", "changed-files", "changed-hunks", "route-flow", "file"]),
  rule_id: z.string().min(1).optional(),
  complete: z.boolean(),
  required_capabilities: z.array(z.string().min(1)),
  missing_capabilities: z.array(z.string().min(1)),
  truncated: z.boolean(),
  can_block: z.boolean(),
  reasons: z.array(z.string())
});

export const AdapterManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  deterministic: z.boolean(),
  capabilities: z.array(z.string().min(1))
});

export const FactGraphSchema = z.object({
  schema_version: z.enum(SUPPORTED_FACTGRAPH_SCHEMA_VERSIONS),
  repo: z.object({
    repo_id: z.string().min(1),
    scan_id: z.string().min(1),
    root_hash: z.string().min(1),
    branch: z.string().min(1),
    commit: z.string().min(1),
    dirty: z.boolean()
  }),
  adapters: z.array(AdapterManifestSchema),
  artifacts: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    path: z.string().min(1),
    hash: z.string().min(1)
  })),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  evidence: z.array(GraphEvidenceSchema),
  diagnostics: z.array(GraphDiagnosticSchema),
  completeness: z.array(GraphCompletenessSchema),
  stats: z.object({
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    evidence_count: z.number().int().nonnegative(),
    diagnostic_count: z.number().int().nonnegative()
  })
});

export const FactGraphArtifactSchema = z.object({
  id: z.string().min(1),
  repo_id: z.string().min(1),
  scan_id: z.string().min(1),
  schema_version: z.enum(SUPPORTED_FACTGRAPH_SCHEMA_VERSIONS),
  graph_hash: z.string().regex(/^[a-f0-9]{64}$/),
  graph: FactGraphSchema,
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  evidence_count: z.number().int().nonnegative(),
  diagnostic_count: z.number().int().nonnegative(),
  created_at: z.string().datetime()
});

export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;
export type GraphEdgeKind = z.infer<typeof GraphEdgeKindSchema>;
export type GraphEvidence = z.infer<typeof GraphEvidenceSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphDiagnostic = z.infer<typeof GraphDiagnosticSchema>;
export type GraphCompleteness = z.infer<typeof GraphCompletenessSchema>;
export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;
export type FactGraph = z.infer<typeof FactGraphSchema>;
export type FactGraphArtifact = z.infer<typeof FactGraphArtifactSchema>;

export interface BuildFactGraphInput {
  repo: FactGraph["repo"];
  snapshots: FileSnapshot[];
  facts: FactRecord[];
  adapters?: AdapterManifest[];
  pathAliases?: Record<string, string[]>;
  diagnostics?: GraphDiagnostic[];
  completeness?: GraphCompleteness[];
  createdAt: string;
}

export interface BuildFactGraphFromPartsInput {
  repo: FactGraph["repo"];
  snapshots: FileSnapshot[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: GraphEvidence[];
  adapters?: AdapterManifest[];
  diagnostics?: GraphDiagnostic[];
  completeness?: GraphCompleteness[];
  createdAt: string;
}

export function fileId(filePath: string): string {
  return `file:${normalizeRepoPath(filePath)}`;
}

export function fileVersionId(filePath: string, contentHash: string): string {
  return `file_version:${normalizeRepoPath(filePath)}:${hashPrefix(contentHash)}`;
}

export function moduleId(filePath: string): string {
  return `module:${normalizeRepoPath(filePath)}`;
}

export function symbolId(filePath: string, symbolKind: string, name: string): string {
  return `symbol:${normalizeRepoPath(filePath)}:${slug(symbolKind)}:${slug(name)}`;
}

export function importDeclarationId(input: {
  filePath: string;
  fileHash: string;
  source: string;
  localName: string;
  startLine: number;
  endLine: number;
}): string {
  return [
    "import_decl",
    normalizeRepoPath(input.filePath),
    hashPrefix(input.fileHash),
    input.source,
    input.localName,
    `${input.startLine}-${input.endLine}`
  ].join(":");
}

export function graphEvidenceId(input: {
  filePath: string;
  fileHash: string;
  startLine: number;
  endLine: number;
  adapterId: string;
}): string {
  return [
    "evidence",
    input.adapterId,
    normalizeRepoPath(input.filePath),
    hashPrefix(input.fileHash),
    `${input.startLine}-${input.endLine}`
  ].join(":");
}

export function buildFactGraphArtifact(input: BuildFactGraphInput): FactGraphArtifact {
  const indexedSnapshots = input.snapshots.filter((snapshot) => snapshot.indexed);
  const snapshotsByPath = new Map(indexedSnapshots.map((snapshot) => [snapshot.file_path, snapshot]));
  const snapshotPaths = new Set(indexedSnapshots.map((snapshot) => snapshot.file_path));
  const adapters = input.adapters ?? [{
    id: "typescript",
    version: "0.1.0",
    deterministic: true,
    capabilities: ["file_discovery", "syntax_facts"]
  }];
  const primaryAdapter = adapters[0] ?? {
    id: "unknown",
    version: "0.0.0",
    deterministic: false,
    capabilities: []
  };

  const nodesById = new Map<string, GraphNode>();
  const edgesById = new Map<string, GraphEdge>();
  const evidenceById = new Map<string, GraphEvidence>();
  const addNode = (node: GraphNode): void => {
    nodesById.set(node.id, GraphNodeSchema.parse(node));
  };
  const addEdge = (edge: GraphEdge): void => {
    edgesById.set(edge.id, GraphEdgeSchema.parse(edge));
  };

  const repoNodeId = `repo:${input.repo.repo_id}`;
  addNode({
    id: repoNodeId,
    kind: "repo",
    label: input.repo.repo_id,
    stable: true,
    evidence_ids: [],
    metadata: {}
  });

  for (const snapshot of indexedSnapshots) {
    const fileNodeId = fileId(snapshot.file_path);
    const versionNodeId = fileVersionId(snapshot.file_path, snapshot.content_hash);
    const moduleNodeId = moduleId(snapshot.file_path);
    addNode({
      id: fileNodeId,
      kind: "file",
      label: snapshot.file_path,
      stable: true,
      evidence_ids: [],
      metadata: { path: snapshot.file_path }
    });
    addNode({
      id: versionNodeId,
      kind: "file_version",
      label: `${snapshot.file_path}@${hashPrefix(snapshot.content_hash)}`,
      stable: false,
      evidence_ids: [],
      metadata: {
        file_path: snapshot.file_path,
        content_hash: snapshot.content_hash,
        byte_size: snapshot.byte_size
      }
    });
    addNode({
      id: moduleNodeId,
      kind: "module",
      label: snapshot.file_path,
      stable: true,
      evidence_ids: [],
      metadata: { file_path: snapshot.file_path }
    });
    addEdge(edge("REPO_HAS_FILE", repoNodeId, fileNodeId));
    addEdge(edge("FILE_HAS_VERSION", fileNodeId, versionNodeId));
    addEdge(edge("FILE_DEFINES_MODULE", fileNodeId, moduleNodeId));
  }

  for (const fact of input.facts) {
    const snapshot = snapshotsByPath.get(fact.file_path);
    if (!snapshot) {
      continue;
    }
    const evidence = evidenceForFact(input.repo, fact, snapshot, primaryAdapter);
    evidenceById.set(evidence.id, evidence);
    const fileNodeId = fileId(fact.file_path);
    const moduleNodeId = moduleId(fact.file_path);

    if (fact.kind === "file_role_detected") {
      const roleNodeId = `file_role:${fact.name}`;
      addNode({
        id: roleNodeId,
        kind: "file_role",
        label: fact.name,
        stable: true,
        evidence_ids: [evidence.id],
        metadata: { role: fact.name }
      });
      addEdge(edge("FILE_HAS_ROLE", fileNodeId, roleNodeId, [evidence.id]));
    }

    if (fact.kind === "import_used" && fact.value) {
      const importNodeId = importDeclarationId({
        filePath: fact.file_path,
        fileHash: snapshot.content_hash,
        source: fact.value,
        localName: fact.name,
        startLine: fact.start_line,
        endLine: fact.end_line
      });
      addNode({
        id: importNodeId,
        kind: "import_decl",
        label: `${fact.name} from ${fact.value}`,
        stable: false,
        evidence_ids: [evidence.id],
        metadata: {
          source: fact.value,
          local_name: fact.name,
          file_path: fact.file_path
        }
      });
      addEdge(edge("IMPORT_DECL_REFERENCES_MODULE", importNodeId, moduleNodeId, [evidence.id]));
      const resolvedPath = resolveImportPath(fact.file_path, fact.value, snapshotPaths, input.pathAliases ?? {});
      if (resolvedPath) {
        addEdge(edge("IMPORT_RESOLVES_TO_MODULE", importNodeId, moduleId(resolvedPath), [evidence.id]));
        addEdge(edge("MODULE_IMPORTS_MODULE", moduleNodeId, moduleId(resolvedPath), [evidence.id]));
      }
    }

    if (fact.kind === "exported_symbol") {
      const exportedSymbolId = symbolId(fact.file_path, "function", fact.name);
      addNode({
        id: exportedSymbolId,
        kind: "symbol",
        label: fact.name,
        stable: true,
        evidence_ids: [evidence.id],
        metadata: {
          file_path: fact.file_path,
          symbol_kind: "function",
          exported: true
        }
      });
      addEdge(edge("FILE_CONTAINS_SYMBOL", fileNodeId, exportedSymbolId, [evidence.id]));
      addEdge(edge("MODULE_EXPORTS_SYMBOL", moduleNodeId, exportedSymbolId, [evidence.id]));
    }

    if (fact.kind === "route_declared") {
      const routeNodeId = `route:${fact.name}:${fact.file_path}`;
      addNode({
        id: routeNodeId,
        kind: "route",
        label: fact.name,
        stable: true,
        evidence_ids: [evidence.id],
        metadata: {
          method: fact.name,
          file_path: fact.file_path
        }
      });
      addEdge(edge("ROUTE_DECLARED_IN_FILE", routeNodeId, fileNodeId, [evidence.id]));
      addEdge(edge("ROUTE_HANDLED_BY_SYMBOL", routeNodeId, symbolId(fact.file_path, "function", fact.name), [evidence.id]));
    }

    if (fact.kind === "symbol_called") {
      const callsiteNodeId = `callsite:${fact.file_path}:${hashPrefix(snapshot.content_hash)}:${fact.name}:${fact.start_line}-${fact.end_line}`;
      addNode({
        id: callsiteNodeId,
        kind: "callsite",
        label: fact.name,
        stable: false,
        evidence_ids: [evidence.id],
        metadata: {
          file_path: fact.file_path,
          callee_name: fact.name
        }
      });
      addEdge(edge("CALLSITE_REFERENCES_SYMBOL", callsiteNodeId, moduleNodeId, [evidence.id], {
        confidence: "name-only",
        callee_name: fact.name
      }));
    }
  }

  const graph = FactGraphSchema.parse({
    schema_version: FACTGRAPH_SCHEMA_VERSION,
    repo: input.repo,
    adapters,
    artifacts: indexedSnapshots.map((snapshot) => ({
      id: fileVersionId(snapshot.file_path, snapshot.content_hash),
      kind: "source_file",
      path: snapshot.file_path,
      hash: snapshot.content_hash
    })).sort((left, right) => left.id.localeCompare(right.id)),
    nodes: [...nodesById.values()].sort(byId),
    edges: [...edgesById.values()].sort(byId),
    evidence: [...evidenceById.values()].sort(byId),
    diagnostics: [...(input.diagnostics ?? [])].sort(byId),
    completeness: input.completeness ?? [{
      scope: "repo",
      complete: true,
      required_capabilities: ["file_discovery", "syntax_facts"],
      missing_capabilities: [],
      truncated: false,
      can_block: true,
      reasons: []
    }],
    stats: {
      node_count: nodesById.size,
      edge_count: edgesById.size,
      evidence_count: evidenceById.size,
      diagnostic_count: input.diagnostics?.length ?? 0
    }
  });
  const graph_hash = sha256(JSON.stringify(graph));

  return FactGraphArtifactSchema.parse({
    id: `graph_${input.repo.scan_id}`,
    repo_id: input.repo.repo_id,
    scan_id: input.repo.scan_id,
    schema_version: FACTGRAPH_SCHEMA_VERSION,
    graph_hash,
    graph,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    evidence_count: graph.evidence.length,
    diagnostic_count: graph.diagnostics.length,
    created_at: input.createdAt
  });
}

export function buildFactGraphArtifactFromParts(input: BuildFactGraphFromPartsInput): FactGraphArtifact {
  const adapters = input.adapters ?? [{
    id: "typescript",
    version: "0.1.0",
    deterministic: true,
    capabilities: ["file_discovery", "syntax_facts", "graph_stream"]
  }];
  const graph = FactGraphSchema.parse({
    schema_version: FACTGRAPH_SCHEMA_VERSION,
    repo: input.repo,
    adapters,
    artifacts: input.snapshots
      .filter((snapshot) => snapshot.indexed)
      .map((snapshot) => ({
        id: fileVersionId(snapshot.file_path, snapshot.content_hash),
        kind: "source_file",
        path: snapshot.file_path,
        hash: snapshot.content_hash
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    nodes: input.nodes.map((node) => GraphNodeSchema.parse(node)).sort(byId),
    edges: input.edges.map((edge) => GraphEdgeSchema.parse(edge)).sort(byId),
    evidence: input.evidence.map((evidence) => GraphEvidenceSchema.parse(evidence)).sort(byId),
    diagnostics: [...(input.diagnostics ?? [])].sort(byId),
    completeness: input.completeness ?? [{
      scope: "repo",
      complete: true,
      required_capabilities: ["file_discovery", "syntax_facts", "graph_stream"],
      missing_capabilities: [],
      truncated: false,
      can_block: true,
      reasons: []
    }],
    stats: {
      node_count: input.nodes.length,
      edge_count: input.edges.length,
      evidence_count: input.evidence.length,
      diagnostic_count: input.diagnostics?.length ?? 0
    }
  });
  const graph_hash = sha256(JSON.stringify(graph));

  return FactGraphArtifactSchema.parse({
    id: `graph_${input.repo.scan_id}`,
    repo_id: input.repo.repo_id,
    scan_id: input.repo.scan_id,
    schema_version: FACTGRAPH_SCHEMA_VERSION,
    graph_hash,
    graph,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    evidence_count: graph.evidence.length,
    diagnostic_count: graph.diagnostics.length,
    created_at: input.createdAt
  });
}

function evidenceForFact(
  repo: FactGraph["repo"],
  fact: FactRecord,
  snapshot: FileSnapshot,
  adapter: AdapterManifest
): GraphEvidence {
  return GraphEvidenceSchema.parse({
    id: graphEvidenceId({
      filePath: fact.file_path,
      fileHash: snapshot.content_hash,
      startLine: fact.start_line,
      endLine: fact.end_line,
      adapterId: adapter.id
    }),
    repo_id: repo.repo_id,
    scan_id: repo.scan_id,
    artifact_id: fileVersionId(fact.file_path, snapshot.content_hash),
    file_path: fact.file_path,
    file_hash: snapshot.content_hash,
    start_line: fact.start_line,
    end_line: fact.end_line,
    adapter_id: adapter.id,
    adapter_version: adapter.version,
    fact_ids: [fact.id],
    redaction_state: "none"
  });
}

function edge(
  kind: GraphEdgeKind,
  from: string,
  to: string,
  evidence_ids: string[] = [],
  metadata: Record<string, unknown> = {}
): GraphEdge {
  return {
    id: `edge:${from}:${kind}:${to}`,
    kind,
    from,
    to,
    evidence_ids,
    metadata
  };
}

function resolveImportPath(
  fromFile: string,
  source: string,
  snapshotPaths: Set<string>,
  pathAliases: Record<string, string[]>
): string | undefined {
  const bases = source.startsWith(".")
    ? [normalize(join(dirname(fromFile), source)).replace(/\\/g, "/")]
    : aliasImportBases(source, pathAliases);
  for (const base of bases) {
    const resolved = candidatePaths(base).find((candidate) => snapshotPaths.has(candidate));
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function candidatePaths(base: string): string[] {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`
  ];
}

function aliasImportBases(source: string, pathAliases: Record<string, string[]>): string[] {
  const bases: string[] = [];
  for (const [pattern, targets] of Object.entries(pathAliases)) {
    const starIndex = pattern.indexOf("*");
    if (starIndex < 0) {
      if (source === pattern) {
        bases.push(...targets);
      }
      continue;
    }

    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);
    if (!source.startsWith(prefix) || (suffix && !source.endsWith(suffix))) {
      continue;
    }
    const captured = source.slice(prefix.length, suffix ? -suffix.length : undefined);
    for (const target of targets) {
      bases.push(target.replace("*", captured).replace(/\\/g, "/"));
    }
  }
  return bases;
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function hashPrefix(hash: string): string {
  return hash.slice(0, 12);
}

function slug(value: string): string {
  return value.replace(/[:\s]+/g, "_");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}
