import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  expandApiRouteScopeGlobs,
  isNextApiRoutePath,
  nextApiRouteIdentity
} from "../src/next-routes.js";

interface RouteCase {
  name: string;
  file_path: string;
  is_api_route: boolean;
  framework?: string;
  route_path?: string;
  dynamic_params?: string[];
  route_group_segments?: string[];
  ignored_segments?: string[];
}

const cases = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/next-route-groups/route-cases.json", import.meta.url), "utf8")
) as RouteCase[];

describe("nextApiRouteIdentity", () => {
  for (const routeCase of cases) {
    it(routeCase.name, () => {
      const identity = nextApiRouteIdentity(routeCase.file_path);
      expect(Boolean(identity)).toBe(routeCase.is_api_route);
      if (identity) {
        expect(identity.framework).toBe(routeCase.framework);
        expect(identity.route_path).toBe(routeCase.route_path);
        expect(identity.dynamic_params).toEqual(routeCase.dynamic_params);
        expect(identity.route_group_segments).toEqual(routeCase.route_group_segments);
        expect(identity.ignored_segments).toEqual(routeCase.ignored_segments);
      }
    });
  }
});

describe("api route scope compatibility", () => {
  it("expands legacy app api globs for grouped app api routes", () => {
    const globs = expandApiRouteScopeGlobs(["**/app/api/**/route.ts"]);

    expect(globs).toContain("**/app/**/api/**/route.ts");
  });

  it("recognizes every route handler under an app tree, and only those", () => {
    expect(isNextApiRoutePath("app/(admin)/api/projects/route.ts")).toBe(true);
    // D-H2: this asserted `false`, which is what made 27 real handlers across the corpus invisible
    // to every role-scoped convention. Under the App Router the folder name decides the URL, not
    // whether the file is a handler.
    expect(isNextApiRoutePath("app/(marketing)/about/route.ts")).toBe(true);
    expect(isNextApiRoutePath("apps/web/app/wellknown/[domain]/[file]/route.ts")).toBe(true);
    // The `app` ancestor is still the boundary.
    expect(isNextApiRoutePath("server/api/users/route.ts")).toBe(false);
    expect(isNextApiRoutePath("apps/web/modules/api/v2/management/webhooks/route.ts")).toBe(false);
  });
});
