import type { AcceptedConvention } from "./domain.js";
import { matchesGlob } from "./globs.js";
import { API_ROUTE_SCOPE_GLOBS, expandApiRouteScopeGlobs, isNextApiRoutePath } from "./next-routes.js";

/**
 * Which files a convention's scope covers.
 *
 * Lifted here from the CLI's `filesForConvention` (BB-6) so the check path, the CLI packet and the
 * MCP packet share one definition. They must: F3 was a second scope implementation - the CLI
 * re-derived route membership from globs alone, which silently disabled enforcement for the default
 * create-next-app layout while still reporting `can_block: true`. A packet that offers an exemplar
 * from outside the enforced scope is the same bug wearing different clothes.
 *
 * The rule, preserved exactly:
 *
 *   - exclusion globs win outright;
 *   - for api-route conventions the engine's segment-based route detection is authoritative, and
 *     path globs only ever narrow further - they never decide whether a route is a route;
 *   - the auto-generated default api-route glob set is fully redundant with that role check, so it
 *     is treated as "no narrowing" rather than applied;
 *   - otherwise a file is in scope when there are no globs, or one matches.
 */
export function conventionScopeFiles(files: string[], convention: AcceptedConvention): string[] {
  const isApiRouteConvention = appliesToApiRouteFiles(convention);
  const pathGlobs = isApiRouteConvention
    ? expandApiRouteScopeGlobs(convention.scope.path_globs)
    : convention.scope.path_globs;
  const excludes = convention.scope.exclude_path_globs ?? [];

  return files.filter((filePath) => {
    if (excludes.some((glob) => matchesGlob(filePath, glob))) {
      return false;
    }
    if (isApiRouteConvention) {
      if (!isNextApiRoutePath(filePath)) {
        return false;
      }
      if (isDefaultApiRouteScope(pathGlobs)) {
        return true;
      }
    }
    return pathGlobs.length === 0 || pathGlobs.some((glob) => matchesGlob(filePath, glob));
  });
}

const DEFAULT_API_ROUTE_SCOPE = new Set(expandApiRouteScopeGlobs([...API_ROUTE_SCOPE_GLOBS]));

export function isDefaultApiRouteScope(pathGlobs: readonly string[]): boolean {
  return pathGlobs.length > 0 && pathGlobs.every((glob) => DEFAULT_API_ROUTE_SCOPE.has(glob));
}

export function appliesToApiRouteFiles(convention: AcceptedConvention): boolean {
  // Kept byte-identical to the predicate this was lifted from. Deriving it from `kind` instead would
  // have been a behaviour change smuggled in under a refactor - exactly what BB-3's DoD warns about.
  return Boolean(
    convention.scope.file_roles?.includes("api_route") ||
    convention.matcher.applies_to_file_roles?.includes("api_route")
  );
}
