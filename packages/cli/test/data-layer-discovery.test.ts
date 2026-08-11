import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { declaredDataLayerPackages, discoverDataLayer } from "../src/domain/data-layer-discovery.js";

/**
 * Finding F4: candidate inference only recognises data layers whose import specifier
 * contains prisma/database/db/data-access. These cases cover the naming experiment that
 * produced zero candidates for `store`, `supabase`, `repository` and `models` while an
 * identical violation behind `db` produced two.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-dl-"));
  dirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  return dir;
}

describe("declaredDataLayerPackages", () => {
  it("finds data dependencies regardless of local naming", async () => {
    const root = await repo({
      "package.json": JSON.stringify({
        dependencies: { next: "14", "@supabase/supabase-js": "2.4.0" },
        devDependencies: { vitest: "3" }
      })
    });
    expect(declaredDataLayerPackages(root, ["package.json"])).toEqual(["@supabase/supabase-js"]);
  });

  it("scans every workspace manifest", async () => {
    const root = await repo({
      "package.json": JSON.stringify({ dependencies: { next: "14" } }),
      "apps/web/package.json": JSON.stringify({ dependencies: { "drizzle-orm": "0.3" } })
    });
    expect(declaredDataLayerPackages(root, ["package.json", "apps/web/package.json"])).toEqual([
      "drizzle-orm"
    ]);
  });

  it("ignores unparseable manifests rather than throwing", async () => {
    const root = await repo({ "package.json": "{ not json" });
    expect(declaredDataLayerPackages(root, ["package.json"])).toEqual([]);
  });

  it("returns nothing when no data dependency is declared", async () => {
    const root = await repo({
      "package.json": JSON.stringify({ dependencies: { next: "14", react: "18" } })
    });
    expect(declaredDataLayerPackages(root, ["package.json"])).toEqual([]);
  });
});

describe("discoverDataLayer finds the wrapper whatever it is called", () => {
  const manifest = JSON.stringify({ dependencies: { "@supabase/supabase-js": "2.4.0" } });

  // The exact modules the naming experiment showed inference could not see.
  for (const [label, wrapper, specifier] of [
    ["store", "src/lib/store.ts", "@/lib/store"],
    ["supabase", "src/lib/supabase.ts", "@/lib/supabase"],
    ["repository", "src/server/repository.ts", "~/server/repository"],
    ["models", "src/lib/models.ts", "@/lib/models"]
  ] as const) {
    it(`identifies a data layer named ${label}`, async () => {
      const root = await repo({ "package.json": manifest });
      const facts = [
        { file_path: wrapper, value: "@supabase/supabase-js", name: "createClient" },
        { file_path: "src/app/api/users/route.ts", value: specifier, name: "store" }
      ];

      const { declaredPackages, suggestions } = discoverDataLayer(root, ["package.json"], facts);
      expect(declaredPackages).toEqual(["@supabase/supabase-js"]);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.filePath).toBe(wrapper);
      expect(suggestions[0]!.packageName).toBe("@supabase/supabase-js");
      expect(suggestions[0]!.importedAs).toEqual([specifier]);
      expect(suggestions[0]!.routeImporterCount).toBe(1);
    });
  }

  it("ranks wrappers by how many routes reach them", async () => {
    const root = await repo({ "package.json": manifest });
    const facts = [
      { file_path: "src/lib/store.ts", value: "@supabase/supabase-js", name: "createClient" },
      { file_path: "src/lib/admin.ts", value: "@supabase/supabase-js", name: "createClient" },
      { file_path: "src/app/api/a/route.ts", value: "@/lib/store", name: "store" },
      { file_path: "src/app/api/b/route.ts", value: "@/lib/store", name: "store" },
      { file_path: "src/app/api/c/route.ts", value: "@/lib/admin", name: "admin" }
    ];
    const { suggestions } = discoverDataLayer(root, ["package.json"], facts);
    expect(suggestions.map((s) => s.filePath)).toEqual(["src/lib/store.ts", "src/lib/admin.ts"]);
    expect(suggestions[0]!.routeImporterCount).toBe(2);
  });

  it("resolves relative and tilde specifiers to the same wrapper", async () => {
    const root = await repo({ "package.json": manifest });
    const facts = [
      { file_path: "src/lib/store.ts", value: "@supabase/supabase-js", name: "createClient" },
      { file_path: "src/app/api/a/route.ts", value: "../../../lib/store", name: "store" },
      { file_path: "src/app/api/b/route.ts", value: "~/lib/store", name: "store" }
    ];
    const { suggestions } = discoverDataLayer(root, ["package.json"], facts);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.routeImporterCount).toBe(2);
  });

  it("does not propose a wrapper no route imports", async () => {
    const root = await repo({ "package.json": manifest });
    const facts = [
      { file_path: "src/lib/store.ts", value: "@supabase/supabase-js", name: "createClient" }
    ];
    expect(discoverDataLayer(root, ["package.json"], facts).suggestions).toEqual([]);
  });

  it("does not treat an API route as its own data layer", async () => {
    const root = await repo({ "package.json": manifest });
    const facts = [
      {
        file_path: "src/app/api/users/route.ts",
        value: "@supabase/supabase-js",
        name: "createClient"
      }
    ];
    expect(discoverDataLayer(root, ["package.json"], facts).suggestions).toEqual([]);
  });

  it("returns nothing when no data dependency is declared", async () => {
    const root = await repo({
      "package.json": JSON.stringify({ dependencies: { next: "14" } })
    });
    const facts = [{ file_path: "src/lib/store.ts", value: "@supabase/supabase-js", name: "x" }];
    expect(discoverDataLayer(root, ["package.json"], facts)).toEqual({
      declaredPackages: [],
      suggestions: []
    });
  });
});
