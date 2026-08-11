import type { NormalizedEntrypointFact } from "@drift/core";

export type CanonicalRouteSource = "normalized_entrypoint" | "security_proof" | "legacy_fact_fallback";
export type CanonicalRouteFreshness = "fresh" | "stale" | "none";

export interface CanonicalProofRouteInput {
  proof_scan_id?: string | null;
  route_id: string;
  normalized_entrypoint_id?: string;
  file_path: string;
  path?: string | null;
  method?: string | null;
}

export interface CanonicalFactRouteInput {
  route_id: string;
  file_path: string;
  path?: string | null;
  method?: string | null;
  file_role: "api_route";
}

export interface BuildCanonicalRouteReadModelInput {
  repo_id: string;
  scan_id: string | null;
  entrypoints: NormalizedEntrypointFact[];
  proofs?: CanonicalProofRouteInput[];
  fallback_fact_routes?: CanonicalFactRouteInput[];
}

export interface CanonicalRouteSummary {
  route_id: string;
  normalized_entrypoint_id?: string;
  file_path: string;
  path: string | null;
  method: string | null;
  file_role: "api_route";
  source: CanonicalRouteSource;
  freshness: CanonicalRouteFreshness;
}

export interface CanonicalRouteReadModel {
  response_schema: "drift.canonical_routes.read_model.v1";
  repo_id: string;
  scan_id: string | null;
  proof_freshness: CanonicalRouteFreshness;
  fallback: {
    used: boolean;
    reason: "normalized_entrypoints_missing" | null;
  };
  route_source_summary: Record<CanonicalRouteSource, number>;
  routes: CanonicalRouteSummary[];
}

export function buildCanonicalRouteReadModel(
  input: BuildCanonicalRouteReadModelInput
): CanonicalRouteReadModel {
  const proofs = input.proofs ?? [];
  const proofByRouteId = new Map(proofs.map((proof) => [proof.route_id, proof]));
  const proofFreshness = proofFreshnessFor(input.scan_id, proofs);
  const routesById = new Map<string, CanonicalRouteSummary>();
  const apiRouteEntrypoints = input.entrypoints.filter((entrypoint) => entrypoint.kind === "api_route");

  for (const entrypoint of apiRouteEntrypoints) {
    const method = entrypoint.method ?? entrypoint.handler_symbol ?? "unknown";
    const routeId = `route:${entrypoint.file_path}:${method}`;
    const proof = proofByRouteId.get(routeId);
    routesById.set(routeId, {
      route_id: routeId,
      normalized_entrypoint_id: entrypoint.entrypoint_id,
      file_path: entrypoint.file_path,
      path: entrypoint.route_pattern ?? proof?.path ?? null,
      method,
      file_role: "api_route",
      source: "normalized_entrypoint",
      freshness: proof ? proofFreshnessFor(input.scan_id, [proof]) : "fresh"
    });
  }

  for (const proof of proofs) {
    if (routesById.has(proof.route_id)) {
      continue;
    }
    routesById.set(proof.route_id, {
      route_id: proof.route_id,
      ...(proof.normalized_entrypoint_id ? { normalized_entrypoint_id: proof.normalized_entrypoint_id } : {}),
      file_path: proof.file_path,
      path: proof.path ?? null,
      method: proof.method ?? null,
      file_role: "api_route",
      source: "security_proof",
      freshness: proofFreshnessFor(input.scan_id, [proof])
    });
  }

  const fallbackUsed = apiRouteEntrypoints.length === 0;
  if (fallbackUsed) {
    for (const route of input.fallback_fact_routes ?? []) {
      routesById.set(route.route_id, {
        route_id: route.route_id,
        file_path: route.file_path,
        path: route.path ?? null,
        method: route.method ?? null,
        file_role: "api_route",
        source: "legacy_fact_fallback",
        freshness: "none"
      });
    }
  }

  const routes = [...routesById.values()].sort((left, right) =>
    left.file_path.localeCompare(right.file_path) ||
    (left.method ?? "").localeCompare(right.method ?? "") ||
    left.route_id.localeCompare(right.route_id)
  );

  return {
    response_schema: "drift.canonical_routes.read_model.v1",
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    proof_freshness: proofFreshness,
    fallback: {
      used: fallbackUsed,
      reason: fallbackUsed ? "normalized_entrypoints_missing" : null
    },
    route_source_summary: countBySource(routes),
    routes
  };
}

function proofFreshnessFor(
  scanId: string | null,
  proofs: CanonicalProofRouteInput[]
): CanonicalRouteFreshness {
  if (proofs.length === 0) {
    return "none";
  }
  if (!scanId) {
    return "stale";
  }
  if (scanId && proofs.some((proof) => proof.proof_scan_id && proof.proof_scan_id !== scanId)) {
    return "stale";
  }
  return "fresh";
}

function countBySource(routes: CanonicalRouteSummary[]): Record<CanonicalRouteSource, number> {
  return {
    normalized_entrypoint: routes.filter((route) => route.source === "normalized_entrypoint").length,
    security_proof: routes.filter((route) => route.source === "security_proof").length,
    legacy_fact_fallback: routes.filter((route) => route.source === "legacy_fact_fallback").length
  };
}
