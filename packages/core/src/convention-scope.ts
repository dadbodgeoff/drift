import type { AcceptedConvention, RouteFlavor } from "./domain.js";
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
      // CV-2: a convention about session routes is not about cron routes. Absent or empty means the
      // convention is unconditioned and every flavour is in scope - a repo with no cron paths must not
      // have flavours manufactured for it.
      const flavors = convention.matcher.applies_to_route_flavors ?? [];
      if (flavors.length > 0 && !flavors.includes(routeFlavor(filePath))) {
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

/**
 * CV-2: which flavour of route a file is.
 *
 * dub uses a member of its auth-wrapper family on 358 of 494 route files. The other 136 are cron
 * (111) and webhook (25) routes, which authenticate by signature rather than session. One global
 * denominator either drags a session family's confidence down by counting routes it was never about,
 * or - worse - accepts a session family that then flags every cron route as missing auth.
 *
 * This is the ONE path-to-flavour predicate on the TypeScript side, and it lives beside
 * `conventionScopeFiles` because it is a scope decision. The engine classifies the same thing at fact
 * time (it must: the candidate deriver cannot be given a glob engine of its own, which is the BB-11
 * lesson), and the two are held together by the differential in
 * packages/core/test/route-flavor-differential.test.ts rather than by sharing code, which is not
 * available across the process boundary. If they disagree there, that test fails.
 *
 * Matching is per SEGMENT, never substring: `app/api/crontab-editor/route.ts` is an ordinary route
 * that happens to start with "cron", and `app/api/webhooks-docs/route.ts` is not a webhook receiver.
 * Substring matching here would be F4's mistake in a new place.
 */
const CRON_SEGMENTS = new Set(["cron", "crons", "jobs", "scheduled"]);
const WEBHOOK_SEGMENTS = new Set(["webhook", "webhooks"]);

export function routeFlavor(filePath: string): RouteFlavor {
  // Only segments below the api boundary decide flavour. A repo mounted under `apps/cron-service/`
  // does not make every route in it a cron job.
  const segments = routeSegmentsBelowApi(filePath);
  if (segments.some((segment) => CRON_SEGMENTS.has(segment))) {
    return "cron_job";
  }
  if (segments.some((segment) => WEBHOOK_SEGMENTS.has(segment))) {
    return "webhook_handler";
  }
  return "api_route";
}

function routeSegmentsBelowApi(filePath: string): string[] {
  const segments = filePath.toLowerCase().split("/");
  const apiIndex = segments.lastIndexOf("api");
  const below = apiIndex === -1 ? segments : segments.slice(apiIndex + 1);
  return below
    // Next route groups - `(ee)`, `(admin)` - are organisational and carry no flavour.
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .map((segment) => segment.replace(/\.(ts|tsx|js|jsx)$/, ""));
}
