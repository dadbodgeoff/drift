import { isNextApiRoutePath, type ChangeImpact, type SymbolIdentity } from "@drift/core";

export interface ChangeImpactRouteFlow {
  route: string;
  service_file?: string;
  data_access_file?: string;
  data_operation?: string;
}

export interface BuildChangeImpactInput {
  repo_id: string;
  scan_id: string;
  changed_files: string[];
  route_flows?: ChangeImpactRouteFlow[];
  symbol_identities?: SymbolIdentity[];
  test_files?: string[];
}

export function buildChangeImpact(input: BuildChangeImpactInput): ChangeImpact {
  const flows = input.route_flows ?? [];
  const changed = new Set(input.changed_files);
  const impactedFlows = flows.filter((flow) =>
    (flow.service_file && changed.has(flow.service_file)) ||
    (flow.data_access_file && changed.has(flow.data_access_file)) ||
    input.changed_files.some((file) => file.includes(routeSlug(flow.route)))
  );
  const affectedRoutes = uniqueSorted(impactedFlows.map((flow) => flow.route));
  const affectedServices = uniqueSorted(impactedFlows.flatMap((flow) => flow.service_file ? [flow.service_file] : []));
  const affectedDataOps = uniqueSorted(impactedFlows.flatMap((flow) =>
    flow.data_operation ? [summarizeDataOperation(flow.data_operation)] : []
  ));
  const affectedTests = uniqueSorted((input.test_files ?? []).filter((file) =>
    [...affectedRoutes, ...affectedServices, ...input.changed_files].some((subject) => sameSubject(file, subject))
  ));
  const changedSymbols = changedSymbolsForFiles(input.changed_files, input.symbol_identities ?? []);

  return {
    schema_version: "drift.change_impact.v1",
    repo_id: input.repo_id,
    scan_id: input.scan_id,
    changed_files: uniqueSorted(input.changed_files),
    changed_symbols: changedSymbols,
    // D-A4: this filtered on `file.includes("/api/")`. midday's backend package is `apps/api/`,
    // so every one of the 25 task-relevant files matched - a fixtures file, two test files and a
    // tRPC router among them - and the field reported 25 changed routes out of 25. It sits inside
    // the schema-validated task_preflight_packet, not an internal scratch value, so an agent reads
    // it as measured. `isNextApiRoutePath` is the same framework-semantic predicate the rest of the
    // system uses to decide what a route is.
    changed_routes: uniqueSorted(input.changed_files.filter(isNextApiRoutePath)),
    changed_tests: uniqueSorted(input.changed_files.filter(isTestFile)),
    changed_contract_surfaces: changedContractSurfaces(input.changed_files),
    affected_routes: affectedRoutes,
    affected_services: affectedServices,
    affected_data_ops: affectedDataOps,
    affected_tests: affectedTests,
    affected_callers: affectedServices,
    affected_importers: affectedServices,
    missing_test_candidates: affectedRoutes.length > 0 && affectedTests.length === 0 ? affectedRoutes : []
  };
}

function changedSymbolsForFiles(files: string[], identities: SymbolIdentity[]): string[] {
  const changed = new Set(files);
  return uniqueSorted(identities.flatMap((identity) => {
    const touchesDeclaration = changed.has(identity.declared_in) ||
      identity.exported_from.some((file) => changed.has(file));
    return touchesDeclaration
      ? [identity.canonical_definition]
      : [];
  }));
}

function changedContractSurfaces(files: string[]): string[] {
  const surfaces = files.flatMap((file) => {
    // Same predicate as changed_routes above, and for the same reason: the substring form
    // inherited the identical false-positive class (D-A4).
    if (isNextApiRoutePath(file)) {
      return ["entrypoint"];
    }
    if (file.includes("repositories") || file.includes("data") || file.includes("db")) {
      return ["data_access"];
    }
    if (file.includes("services")) {
      return ["service"];
    }
    return [];
  });
  return uniqueSorted(surfaces);
}

function sameSubject(testFile: string, subject: string): boolean {
  const testSlug = pathSlug(testFile);
  const subjectSlug = subject.startsWith("GET ") || subject.startsWith("POST ")
    ? routeSlug(subject)
    : pathSlug(subject);
  return Boolean(testSlug && subjectSlug && testSlug.includes(subjectSlug));
}

function routeSlug(route: string): string {
  return route.replace(/^[A-Z]+\s+/, "").split("/").filter(Boolean).pop() ?? "";
}

function pathSlug(path: string): string {
  return path.split("/").pop()?.replace(/\.(test|spec)?\.?[tj]sx?$/, "").replace(/route$/, "") ?? "";
}

function isTestFile(path: string): boolean {
  return /(\.test|\.spec)\.[tj]sx?$/.test(path);
}

function summarizeDataOperation(operation: string): string {
  const operationName = operation.split(".").filter(Boolean).at(-1) ?? "unknown";
  const readOps = new Set(["findMany", "findUnique", "findFirst", "count", "aggregate"]);
  const writeOps = new Set(["create", "createMany", "update", "updateMany", "upsert"]);
  if (readOps.has(operationName)) {
    return "data_operation:read";
  }
  if (writeOps.has(operationName)) {
    return "data_operation:write";
  }
  if (operationName.toLowerCase().includes("delete")) {
    return "data_operation:delete";
  }
  return "data_operation:unknown";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
