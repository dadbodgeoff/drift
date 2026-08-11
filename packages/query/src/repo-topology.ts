import type { RepoTopology } from "@drift/core";

interface RepoTopologyFile {
  path: string;
  roles: string[];
  imports: string[];
  exported_symbols: string[];
  risky_area_ids: string[];
}

export interface BuildRepoTopologyInput {
  repo_id: string;
  scan_id?: string | null;
  files: RepoTopologyFile[];
}

export function buildRepoTopology(input: BuildRepoTopologyInput): RepoTopology {
  const areas = new Map<string, RepoTopology["areas"][number]>();
  const entrypoints = new Set<string>();
  const modules = new Set<string>();
  const layers = new Set<string>();
  const flows = new Set<string>();
  const tests = new Set<string>();
  const configs = new Set<string>();
  const externalSystems = new Set<string>();
  const riskyZones = new Set<string>();
  const generatedZones = new Set<string>();
  const unknownZones = new Set<string>();

  for (const file of input.files) {
    const area = areaForPath(file.path);
    const areaRecord = areas.get(area) ?? {
      name: area,
      entrypoints: [],
      modules: [],
      services: [],
      data_access: [],
      tests: [],
      external_systems: [],
      risky_zones: []
    };
    const roles = new Set(file.roles);
    modules.add(file.path);
    pushUnique(areaRecord.modules, file.path);

    if (roles.has("api_route") || roles.has("route")) {
      const route = routeLabelForPath(file.path, file.exported_symbols);
      entrypoints.add(route);
      pushUnique(areaRecord.entrypoints, route);
      layers.add("entrypoint");
    }
    if (roles.has("service") || roles.has("service_module")) {
      pushUnique(areaRecord.services, file.path);
      layers.add("middle");
    }
    if (roles.has("data_access") || roles.has("data_access_module")) {
      pushUnique(areaRecord.data_access, file.path);
      layers.add("terminal");
    }
    if (roles.has("test_unit") || roles.has("test_integration") || roles.has("test_e2e") || file.path.includes(".test.")) {
      tests.add(file.path);
      pushUnique(areaRecord.tests, file.path);
    }
    if (roles.has("config") || /(^|\/)(package\.json|tsconfig\.json|vite\.config|next\.config)/.test(file.path)) {
      configs.add(file.path);
    }
    if (roles.has("generated") || file.path.includes("/generated/")) {
      generatedZones.add(file.path);
    }
    if (roles.size === 0 || roles.has("unknown") || roles.has("mixed_role")) {
      unknownZones.add(file.path);
    }
    for (const importSource of file.imports) {
      if (isExternalImport(importSource)) {
        externalSystems.add(importSource);
        pushUnique(areaRecord.external_systems, importSource);
      }
    }
    for (const riskyId of file.risky_area_ids) {
      riskyZones.add(riskyId);
      pushUnique(areaRecord.risky_zones, riskyId);
    }
    if (areaRecord.services.length > 0 || areaRecord.data_access.length > 0 || areaRecord.entrypoints.length > 0) {
      flows.add(areaRecord.name);
    }
    areas.set(area, areaRecord);
  }

  return {
    schema_version: "drift.repo_topology.v1",
    repo_id: input.repo_id,
    scan_id: input.scan_id ?? null,
    areas: [...areas.values()].sort((left, right) => left.name.localeCompare(right.name)),
    entrypoints: sorted(entrypoints),
    modules: sorted(modules),
    layers: sorted(layers),
    flows: sorted(flows),
    tests: sorted(tests),
    configs: sorted(configs),
    external_systems: sorted(externalSystems),
    risky_zones: sorted(riskyZones),
    generated_zones: sorted(generatedZones),
    unknown_zones: sorted(unknownZones)
  };
}

function areaForPath(path: string): string {
  const packageMatch = path.match(/^packages\/([^/]+)\//);
  if (packageMatch) {
    return `${titleCase(packageMatch[1].replace(/[-_]/g, " "))} Package`;
  }
  const crateMatch = path.match(/^crates\/([^/]+)\//);
  if (crateMatch) {
    return `${titleCase(crateMatch[1].replace(/[-_]/g, " "))} Crate`;
  }
  const fixtureMatch = path.match(/^test\/fixtures\/([^/]+)\//);
  if (fixtureMatch) {
    return `${titleCase(fixtureMatch[1].replace(/[-_]/g, " "))} Fixture`;
  }
  if (path.startsWith("scripts/")) {
    return "Scripts";
  }
  const apiMatch = path.match(/(?:^|\/)api\/([^/]+)/);
  const serviceMatch = path.match(/(?:^|\/)(?:services|repositories)\/([^/.]+)/);
  if (!apiMatch && !serviceMatch) {
    const appMatch = path.match(/^apps\/([^/]+)\//);
    if (appMatch) {
      return `${titleCase(appMatch[1].replace(/[-_]/g, " "))} App`;
    }
  }
  const raw = apiMatch?.[1] ?? serviceMatch?.[1] ?? path.split("/").filter(Boolean)[0] ?? "Repository";
  return `${titleCase(raw.replace(/[-_]/g, " "))} Management`;
}

function routeLabelForPath(path: string, exports: string[]): string {
  const method = exports.find((value) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value)) ?? "ROUTE";
  const apiIndex = path.indexOf("/api/");
  const routePath = apiIndex >= 0
    ? path.slice(apiIndex + 4).replace(/\/route\.[tj]sx?$/, "")
    : path.replace(/\/route\.[tj]sx?$/, "");
  return `${method} /api/${routePath}`.replace(/\/+/g, "/").replace(/^([^ ]+)\/api/, "$1 /api");
}

function isExternalImport(importSource: string): boolean {
  return !importSource.startsWith(".") && !importSource.startsWith("/") && !importSource.startsWith("@/");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
    values.sort();
  }
}

function sorted(values: Set<string>): string[] {
  return [...values].sort();
}
