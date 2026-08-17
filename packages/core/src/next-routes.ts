export interface NextApiRouteIdentity {
  framework: "next_app_route" | "next_pages_api";
  file_path: string;
  route_path: string;
  route_pattern: string;
  dynamic_params: string[];
  route_group_segments: string[];
  ignored_segments: string[];
}

/**
 * D-H2. Kept byte-identical to `API_ROUTE_SCOPE_GLOBS` in
 * crates/drift-engine/src/next_routes.rs - see that file for why `app/api` widened to `app`.
 */
export const API_ROUTE_SCOPE_GLOBS = [
  "**/app/**/route.ts",
  "**/app/**/route.tsx",
  "**/app/**/route.js",
  "**/app/**/route.jsx",
  "**/pages/api/**/*.ts",
  "**/pages/api/**/*.tsx",
  "**/pages/api/**/*.js",
  "**/pages/api/**/*.jsx"
];

export function nextApiRouteIdentity(filePath: string): NextApiRouteIdentity | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  return nextAppRouteIdentity(normalized) ?? nextPagesApiIdentity(normalized);
}

export function isNextApiRoutePath(filePath: string): boolean {
  return Boolean(nextApiRouteIdentity(filePath));
}

/**
 * D-H2: a no-op against the default set now that it says `app/**`, and deliberately kept. A
 * hand-authored or older contract can still narrow itself to `**\/app/api/**\/route.ts`, and that
 * glob still needs the monorepo expansion it always did.
 */
export function expandApiRouteScopeGlobs(globs: string[]): string[] {
  const expanded = new Set(globs);
  for (const glob of globs) {
    if (glob.includes("app/api/")) {
      expanded.add(glob.replaceAll("app/api/", "app/**/api/"));
    }
  }
  return [...expanded].sort();
}

/**
 * D-H2. The mirror of `next_app_route_identity` in crates/drift-engine/src/next_routes.rs, which
 * carries the full rationale. The two are held together by the shared table in
 * test/fixtures/next-route-groups/route-cases.json, asserted from both sides.
 */
function nextAppRouteIdentity(filePath: string): NextApiRouteIdentity | undefined {
  const suffix = ["/route.ts", "/route.tsx", "/route.js", "/route.jsx"].find((value) =>
    filePath.endsWith(value)
  );
  if (!suffix) {
    return undefined;
  }
  const segments = filePath.slice(0, -suffix.length).split("/").filter(Boolean);
  const appIndex = segments.indexOf("app");
  if (appIndex < 0) {
    return undefined;
  }
  const routeSegments = segments.slice(appIndex + 1);

  const dynamic_params: string[] = [];
  const route_group_segments: string[] = [];
  const ignored_segments: string[] = [];
  const urlSegments: string[] = [];

  for (const segment of routeSegments) {
    if (isRouteGroup(segment)) {
      route_group_segments.push(segment);
      continue;
    }
    if (segment.startsWith("@") || segment.startsWith("_")) {
      ignored_segments.push(segment);
      continue;
    }
    urlSegments.push(normalizeSegment(segment, dynamic_params));
  }

  const route_path = `/${urlSegments.join("/")}`;
  return {
    framework: "next_app_route",
    file_path: filePath,
    route_path,
    route_pattern: route_path,
    dynamic_params,
    route_group_segments,
    ignored_segments
  };
}

function nextPagesApiIdentity(filePath: string): NextApiRouteIdentity | undefined {
  const marker = "pages/api/";
  const index = filePath.indexOf(marker);
  if (index < 0) {
    return undefined;
  }
  const rawRoute = filePath.slice(index + "pages/".length);
  const route = rawRoute.replace(/\.(ts|tsx|js|jsx)$/, "");
  if (route === rawRoute) {
    return undefined;
  }

  const dynamic_params: string[] = [];
  const route_path = `/${route.split("/").filter(Boolean).map((segment) =>
    normalizeSegment(segment, dynamic_params)
  ).join("/")}`;
  return {
    framework: "next_pages_api",
    file_path: filePath,
    route_path,
    route_pattern: route_path,
    dynamic_params,
    route_group_segments: [],
    ignored_segments: []
  };
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") &&
    segment.endsWith(")") &&
    !segment.startsWith("(.)") &&
    !segment.startsWith("(..)") &&
    !segment.startsWith("(...)");
}

function normalizeSegment(segment: string, dynamicParams: string[]): string {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll?.[1]) {
    dynamicParams.push(optionalCatchAll[1]);
    return `:${optionalCatchAll[1]}*`;
  }
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) {
    dynamicParams.push(catchAll[1]);
    return `:${catchAll[1]}*`;
  }
  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic?.[1]) {
    dynamicParams.push(dynamic[1]);
    return `:${dynamic[1]}`;
  }
  return segment;
}
