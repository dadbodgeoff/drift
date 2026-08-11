import type { LayerArchitectureContract } from "@drift/core";

export interface LayerArchitectureObservedEdge {
  from_layer: string;
  to_layer: string;
  edge_kind?: string;
  evidence_ids?: string[];
}

export interface BuildLayerArchitectureProofInput {
  entrypoint: string;
  architecture: LayerArchitectureContract;
  graph_edges: LayerArchitectureObservedEdge[];
}

export interface LayerArchitectureProof {
  schema_version: "drift.layer_architecture_proof.v1";
  architecture_id: string;
  entrypoint: string;
  entrypoint_layer: string | null;
  terminal_layers_reached: string[];
  allowed_edges_present: LayerArchitectureObservedEdge[];
  forbidden_edges_present: LayerArchitectureObservedEdge[];
  missing_expected_edges: Array<{ from_layer: string; to_layer: string; edge_kind?: string }>;
}

export function buildLayerArchitectureProof(input: BuildLayerArchitectureProofInput): LayerArchitectureProof {
  const entrypointLayer = input.architecture.layers.find((layer) => layer.position === "entrypoint")?.id ?? null;
  const terminalLayerIds = new Set(
    input.architecture.layers
      .filter((layer) => layer.position === "terminal")
      .map((layer) => layer.id)
  );
  const allowedEdges = input.graph_edges.filter((edge) =>
    input.architecture.allowed_edges.some((allowedEdge) => layerEdgeMatches(allowedEdge, edge))
  );
  const forbiddenEdges = input.graph_edges.filter((edge) =>
    input.architecture.forbidden_edges.some((forbiddenEdge) => layerEdgeMatches(forbiddenEdge, edge))
  );
  const missingExpectedEdges = input.architecture.allowed_edges.filter((allowedEdge) =>
    !input.graph_edges.some((edge) => layerEdgeMatches(allowedEdge, edge))
  );

  return {
    schema_version: "drift.layer_architecture_proof.v1",
    architecture_id: input.architecture.architecture_id,
    entrypoint: input.entrypoint,
    entrypoint_layer: entrypointLayer,
    terminal_layers_reached: uniqueSorted(input.graph_edges
      .map((edge) => edge.to_layer)
      .filter((layerId) => terminalLayerIds.has(layerId))),
    allowed_edges_present: allowedEdges,
    forbidden_edges_present: forbiddenEdges,
    missing_expected_edges: missingExpectedEdges
  };
}

function layerEdgeMatches(
  expected: { from_layer: string; to_layer: string; edge_kind?: string },
  actual: LayerArchitectureObservedEdge
): boolean {
  return expected.from_layer === actual.from_layer &&
    expected.to_layer === actual.to_layer &&
    (!expected.edge_kind || expected.edge_kind === actual.edge_kind);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
