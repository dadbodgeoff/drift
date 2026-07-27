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

  it("recognizes grouped api route and rejects non api app route", () => {
    expect(isNextApiRoutePath("app/(admin)/api/projects/route.ts")).toBe(true);
    expect(isNextApiRoutePath("app/(marketing)/about/route.ts")).toBe(false);
  });
});
