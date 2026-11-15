// Round 13 structure fixes (workstream S) in the Studio: entry points' `wrappers` (not guards) in Security, and each
// package's production and test dependencies (`drift map --json`) in the Map view.
import { describe, expect, it } from "vitest";
import { filterEntries } from "@/entities/security";
import { packageDependencies } from "@/features/map";
import type { EntryRow, MapPackage } from "@/shared/contract/drift";
import { json } from "./helpers";

const row = (p: Partial<EntryRow>): EntryRow => ({ path: "app/routers/items.py", symbol: "list_items", line: 3, kind: "http", method: "GET", route: "/items", guards: [], validates: false, reaches: [], reads: [], ...p }) as EntryRow;

describe("wrappers are not guards (security --json entry_points[].wrappers)", () => {
  it("an entry point with only wrappers is unguarded, and is found by its wrapper", () => {
    const rows = [row({ wrappers: ["Depends(get_db)"] }), row({ symbol: "create_item", guards: ["Depends(get_current_user)"] })];
    const f = { q: "", kind: null, unguardedOnly: true, reachingOnly: false, sink: null };
    expect(filterEntries(rows, f).map((e) => e.symbol)).toEqual(["list_items"]);
    expect(filterEntries(rows, { ...f, unguardedOnly: false, q: "get_db" }).map((e) => e.symbol)).toEqual(["list_items"]);
  });
});

describe("a package's dependencies, production and test apart (map --json dependencies_test)", () => {
  const pkgs: MapPackage[] = [
    { path: "svc/api", name: "api", depends_on: [{ package: "libs/db", files: 4 }], dependencies_test: [{ package: "libs/fixtures", files: 2 }, { package: "libs/db", files: 1 }], depended_on_by: 0 },
    { path: "", name: null, depends_on: [], depended_on_by: 1 },
  ];
  it("lists test-only dependencies apart, and marks one production also has", () => {
    expect(packageDependencies(pkgs, "svc/api")).toEqual({
      production: [{ package: "libs/db", files: 4 }],
      test: [
        { package: "libs/fixtures", files: 2, alsoProduction: false },
        { package: "libs/db", files: 1, alsoProduction: true },
      ],
    });
    // An older drift without the field, the root package, and a package drift map does not list.
    expect(packageDependencies(pkgs, "")).toEqual({ production: [], test: [] });
    expect(packageDependencies(pkgs, "nope")).toBeNull();
    expect(packageDependencies(undefined, "svc/api")).toBeNull();
  });

  it("reads the acme map fixture as drift map --json prints it", () => {
    const m = json<{ schema: number; packages: MapPackage[] }>("acme/map.json");
    expect(m.schema).toBe(1);
    expect(packageDependencies(m.packages, "apps/web")?.production.map((d) => d.package)).toEqual(["packages/db", "packages/ui"]);
    expect(m.packages.every((p) => Array.isArray(p.dependencies_test))).toBe(true);
  });
});
