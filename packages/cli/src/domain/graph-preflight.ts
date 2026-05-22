import { createGraphQueryService,type GraphAffectedFiles,type GraphReachableDataAccess,type GraphRouteFlow } from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import type { RelevantFile } from "./preflight.js";
import { isApiRoutePath } from "./repo-paths.js";
import type { scanStatusPayload } from "./scan-status.js";

export interface GraphPreflightContext {
  available: boolean;
  scan_id: string | null;
  completeness: {
    complete: boolean;
    reasons: string[];
  } | null;
  route_flows: GraphRouteFlow[];
  reachable_data_access: GraphReachableDataAccess[];
  affected_files: GraphAffectedFiles[];
  diagnostics: string[];
}

export function graphPreflightContext(input: {
  storage: SqliteDriftStorage;
  repoId: string;
  scanStatus: ReturnType<typeof scanStatusPayload>;
  targetPath?: string;
  relevantFiles: RelevantFile[];
}): GraphPreflightContext {
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
    diagnostics: uniqueSorted([
      ...completeness.reasons,
      ...routeFlows.flatMap((flow) => flow.diagnostics),
      ...reachableDataAccess.flatMap((access) => access.diagnostics),
      ...affectedFiles.flatMap((affected) => affected.diagnostics)
    ])
  };
}

function unavailableGraphContext(diagnostics: string[], scanId: string | null = null): GraphPreflightContext {
  return {
    available: false,
    scan_id: scanId,
    completeness: null,
    route_flows: [],
    reachable_data_access: [],
    affected_files: [],
    diagnostics
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
