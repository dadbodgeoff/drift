import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isApiRoutePath } from "./repo-paths.js";

/**
 * Structural discovery of a repo's data layer.
 *
 * Candidate inference decides what counts as a data-access module with a fixed
 * substring test over the import specifier (`prisma`, `database`, `/db`, `data-access`
 * - see `is_data_access_source` in crates/drift-engine/src/candidate_command.rs). That
 * only recognises repos that happen to name their data layer in that family. A repo
 * using Supabase, Drizzle behind a `store` module, or anything called `repository` /
 * `models` / `persistence` yields zero candidates with the violation sitting in plain
 * sight, and says nothing about why.
 *
 * This module starts from something that does not vary with local naming: the ORM or
 * database driver declared in package.json. From there it walks the repo's own imports
 * to find the local module that wraps that dependency. The wrapper can be called
 * anything; it is identified by what it imports, not what it is named.
 *
 * This is deliberately a *suggestion* source, not an oracle. It feeds the declaration
 * flow so `drift start` can propose the right module instead of asking blind, and it
 * never silently enforces anything a human has not accepted.
 */

/** Published packages that indicate a data layer. Small, closed, slow-moving set. */
const DATA_LAYER_PACKAGES = [
  "@prisma/client",
  "prisma",
  "drizzle-orm",
  "@supabase/supabase-js",
  "@supabase/ssr",
  "kysely",
  "mongodb",
  "mongoose",
  "typeorm",
  "sequelize",
  "knex",
  "pg",
  "mysql2",
  "better-sqlite3",
  "@planetscale/database",
  "@neondatabase/serverless",
  "@libsql/client",
  "postgres",
  "redis",
  "ioredis",
  "@upstash/redis"
];

/**
 * package.json paths worth reading: the repo root plus any manifest inside a scanned
 * workspace. Derived from the scan's own file list so it costs no extra traversal.
 */
export function packageManifestPathsFromFiles(filePaths: string[]): string[] {
  const manifests = new Set<string>(["package.json"]);
  for (const filePath of filePaths) {
    const normalized = filePath.replace(/\\/g, "/");
    const segments = normalized.split("/");
    // Cover the common workspace depths (apps/web, packages/db) without walking deep.
    for (let depth = 1; depth <= Math.min(3, segments.length - 1); depth += 1) {
      manifests.add(`${segments.slice(0, depth).join("/")}/package.json`);
    }
  }
  return [...manifests].sort();
}

export interface DataLayerSuggestion {
  /** Repo-relative path of the local module that wraps a data dependency. */
  filePath: string;
  /** The declared dependency it wraps, e.g. "@supabase/supabase-js". */
  packageName: string;
  /** Import specifiers by which API routes actually reach this module. */
  importedAs: string[];
  /** How many API route files import it, directly or by alias. */
  routeImporterCount: number;
}

export interface DataLayerDiscovery {
  /** Data-layer dependencies found in package.json manifests. */
  declaredPackages: string[];
  /** Local wrapper modules, most-imported first. */
  suggestions: DataLayerSuggestion[];
}

interface ImportFactLike {
  file_path: string;
  value?: string | null;
  name?: string;
}

/** Read every package.json in the repo's manifest set and collect data-layer deps. */
export function declaredDataLayerPackages(repoRoot: string, manifestPaths: string[]): string[] {
  const found = new Set<string>();
  for (const relative of manifestPaths) {
    const absolute = join(repoRoot, relative);
    if (!existsSync(absolute)) {
      continue;
    }
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(absolute, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = manifest[field];
      if (!deps || typeof deps !== "object") {
        continue;
      }
      for (const name of Object.keys(deps as Record<string, unknown>)) {
        if (DATA_LAYER_PACKAGES.includes(name)) {
          found.add(name);
        }
      }
    }
  }
  return [...found].sort();
}

/**
 * Find local modules that import a declared data-layer package, then rank them by how
 * many API routes reach them. Ranking by route reach matters: a repo typically has one
 * client module the routes use and several internal modules that also touch the ORM.
 */
export function discoverDataLayer(
  repoRoot: string,
  manifestPaths: string[],
  importFacts: ImportFactLike[]
): DataLayerDiscovery {
  const declaredPackages = declaredDataLayerPackages(repoRoot, manifestPaths);
  if (declaredPackages.length === 0) {
    return { declaredPackages, suggestions: [] };
  }

  // Local modules that import one of the declared data packages.
  const wrapperToPackage = new Map<string, string>();
  for (const fact of importFacts) {
    const source = fact.value;
    if (!source) {
      continue;
    }
    const matched = declaredPackages.find(
      (pkg) => source === pkg || (source.startsWith(pkg) && source[pkg.length] === "/")
    );
    if (matched && !isApiRoutePath(fact.file_path)) {
      wrapperToPackage.set(fact.file_path, matched);
    }
  }
  if (wrapperToPackage.size === 0) {
    return { declaredPackages, suggestions: [] };
  }

  // How do API routes refer to those modules? Match the tail of the specifier against
  // the wrapper's path so aliases (`@/lib/store`, `~/server/store`) resolve without
  // needing full tsconfig path resolution here.
  const importersByWrapper = new Map<string, { specifiers: Set<string>; routes: Set<string> }>();
  for (const fact of importFacts) {
    const source = fact.value;
    if (!source || !isApiRoutePath(fact.file_path)) {
      continue;
    }
    for (const wrapper of wrapperToPackage.keys()) {
      if (!specifierPointsAt(source, wrapper)) {
        continue;
      }
      const entry = importersByWrapper.get(wrapper) ?? { specifiers: new Set(), routes: new Set() };
      entry.specifiers.add(source);
      entry.routes.add(fact.file_path);
      importersByWrapper.set(wrapper, entry);
    }
  }

  const suggestions: DataLayerSuggestion[] = [...wrapperToPackage.entries()]
    .map(([filePath, packageName]) => {
      const entry = importersByWrapper.get(filePath);
      return {
        filePath,
        packageName,
        importedAs: [...(entry?.specifiers ?? [])].sort(),
        routeImporterCount: entry?.routes.size ?? 0
      };
    })
    .filter((suggestion) => suggestion.routeImporterCount > 0)
    .sort(
      (a, b) => b.routeImporterCount - a.routeImporterCount || a.filePath.localeCompare(b.filePath)
    );

  return { declaredPackages, suggestions };
}

/**
 * True when an import specifier plausibly resolves to `wrapperPath`.
 *
 * Compares the specifier's meaningful tail against the wrapper's path with extensions
 * and `/index` stripped, so `@/lib/store`, `~/lib/store` and `../lib/store` all match
 * `src/lib/store.ts` without resolving tsconfig aliases.
 */
function specifierPointsAt(specifier: string, wrapperPath: string): boolean {
  const wrapper = wrapperPath.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");
  const cleaned = specifier
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
    .replace(/\/index$/, "")
    .replace(/^(\.\.?\/)+/, "")
    .replace(/^[@~]\//, "");
  if (!cleaned) {
    return false;
  }
  const tail = cleaned.split("/").filter(Boolean);
  const wrapperSegments = wrapper.split("/").filter(Boolean);
  if (tail.length === 0 || tail.length > wrapperSegments.length) {
    return false;
  }
  // The specifier's segments must be a suffix of the wrapper's path segments.
  return wrapperSegments.slice(-tail.length).join("/") === tail.join("/");
}
