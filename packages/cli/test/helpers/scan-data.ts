import type { GraphEdge, GraphNode } from "@drift/factgraph";
import type { ScanData } from "../../src/engine/collect-scan-data.js";

/**
 * A minimal engine-produced `ScanData` carrying only a graph.
 *
 * The resolver under test reads `graph_nodes` and `graph_edges` and nothing else, so everything
 * else is filled with the empty shape rather than a fixture. `engineSource: "rust"` is not
 * decoration: every consumer of `IMPORT_RESOLVES_TO_MODULE` in the check path is reachable only
 * on the engine path, because the TypeScript fallback refuses before any check runs
 * (`run-check.ts`, the `typescript_fallback_used` refusal). A synthetic ScanData that claimed
 * `"typescript"` would describe a state the check path cannot observe.
 */
export function graphScanData(input: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}): ScanData {
  return {
    files: [],
    facts: [],
    snapshots: [],
    engineSource: "rust",
    fallbackStatus: {
      engine_source: "rust",
      fallback_used: false,
      fallback_reason: null,
      engine_error_message: null,
      degraded_capabilities: [],
      enforcement_degraded: false,
      engine_resolution: "workspace_release_binary",
      engine_build_profile: "release"
    },
    diagnostics: [],
    graph_nodes: input.nodes,
    graph_edges: input.edges,
    graph_evidence: [],
    graph_diagnostics: [],
    framework_adapters: [],
    normalized_entrypoints: [],
    framework_parser_gaps: [],
    framework_capabilities: []
  };
}

/** An `import_decl` node as the engine emits it: the specifier lives in `metadata.source`. */
export function importNode(input: {
  id: string;
  filePath: string;
  source: string;
  localName?: string;
}): GraphNode {
  return {
    id: input.id,
    kind: "import_decl",
    label: input.source,
    stable: true,
    evidence_ids: [],
    metadata: {
      file_path: input.filePath,
      source: input.source,
      local_name: input.localName ?? "helper"
    }
  };
}

/** A `module` node: the file it is defined by lives in `metadata.file_path`. */
export function moduleNode(input: { id: string; filePath: string }): GraphNode {
  return {
    id: input.id,
    kind: "module",
    label: input.filePath,
    stable: true,
    evidence_ids: [],
    metadata: { file_path: input.filePath }
  };
}

/**
 * A `symbol` node. The engine puts the symbol's name in the node LABEL (`insert_node(..., Symbol,
 * &fact.name, ...)`), not in metadata, so that is where the name lives here too.
 */
export function symbolNode(input: { id: string; filePath: string; name: string }): GraphNode {
  return {
    id: input.id,
    kind: "symbol",
    label: input.name,
    stable: true,
    evidence_ids: [],
    metadata: { file_path: input.filePath, symbol_kind: "function", exported: true }
  };
}

export function graphEdge(input: {
  id: string;
  kind: GraphEdge["kind"];
  from: string;
  to: string;
  /**
   * `MODULE_REEXPORTS_MODULE` carries the re-exported name here - a symbol name for
   * `export { x } from "./m"`, or `"*"` for a flattening `export * from "./m"`.
   */
  exportedName?: string;
}): GraphEdge {
  return {
    id: input.id,
    kind: input.kind,
    from: input.from,
    to: input.to,
    evidence_ids: [],
    metadata: input.exportedName === undefined ? {} : { exported_name: input.exportedName }
  };
}
