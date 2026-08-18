import { describe, expect, it } from "vitest";
import { forbiddenModuleFiles_, resolvedModuleFilesFor } from "../src/check/run-check.js";
import { graphEdge, graphScanData, importNode, moduleNode } from "./helpers/scan-data.js";

/**
 * S3-01: the specifier resolver stops being about forbidden imports specifically.
 *
 * `forbiddenModuleFiles_` answers one question - "what files do these specifiers actually resolve
 * to, according to the repo's own resolved-import edges" - and answers it for the one caller that
 * happened to need it first. The accepted-security-helper side of the pipeline needs the identical
 * answer about a different specifier list, and the wrong way to get it is a second walk over
 * `IMPORT_RESOLVES_TO_MODULE` that can drift out of agreement with this one.
 *
 * So this is a characterization lock rather than a behaviour test. It asserts nothing about what
 * the right answer IS; it asserts that generalising the function did not change the answer the
 * forbidden-import path already relies on. If a later change to `resolvedModuleFilesFor` shifts
 * that answer, the T93 bypass closures ride on it and this fails first.
 */
describe("resolvedModuleFilesFor", () => {
  /**
   * Three shapes the forbidden-import path already depends on, in one graph:
   *   - two distinct specifiers for the same file (`@/lib/prisma` and `../../lib/prisma`), which is
   *     the whole reason resolution beats string comparison;
   *   - a lookalike (`@/lib/prisma-legacy`) that must resolve to its own file and stay out;
   *   - a bare package (`next-auth`) with no resolution edge at all, which is what an external
   *     import looks like in this graph - the Rust resolver filters to paths inside the snapshot.
   */
  const checkData = graphScanData({
    nodes: [
      importNode({ id: "import:a", filePath: "app/api/a/route.ts", source: "@/lib/prisma" }),
      importNode({ id: "import:b", filePath: "app/api/b/route.ts", source: "../../lib/prisma" }),
      importNode({ id: "import:c", filePath: "app/api/c/route.ts", source: "@/lib/prisma-legacy" }),
      importNode({ id: "import:d", filePath: "app/api/d/route.ts", source: "@/lib/barrel" }),
      importNode({ id: "import:e", filePath: "app/api/e/route.ts", source: "next-auth" }),
      moduleNode({ id: "module:prisma", filePath: "src/lib/prisma.ts" }),
      moduleNode({ id: "module:legacy", filePath: "src/lib/prisma-legacy.ts" }),
      moduleNode({ id: "module:barrel", filePath: "src/lib/barrel.ts" })
    ],
    edges: [
      graphEdge({ id: "e1", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:a", to: "module:prisma" }),
      graphEdge({ id: "e2", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:b", to: "module:prisma" }),
      graphEdge({ id: "e3", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:c", to: "module:legacy" }),
      graphEdge({ id: "e4", kind: "IMPORT_RESOLVES_TO_MODULE", from: "import:d", to: "module:barrel" }),
      graphEdge({ id: "e5", kind: "MODULE_REEXPORTS_MODULE", from: "module:barrel", to: "module:prisma" })
    ]
  });

  /**
   * Every specifier list the forbidden-import path can hand this function, including the two
   * degenerate ones. The empty list matters: `graphImportResolvesToForbidden` returns early on it
   * today, but `run-check.ts` still calls the resolver directly with
   * `convention.matcher.forbidden_imports ?? []` when building the engine request, so an empty
   * list reaching it is a live shape, not a hypothetical.
   */
  const specifierLists: string[][] = [
    [],
    ["@/lib/prisma"],
    ["../../lib/prisma"],
    ["@/lib/prisma", "../../lib/prisma"],
    ["@/lib/prisma-legacy"],
    ["@/lib/barrel"],
    ["next-auth"],
    ["@/lib"],
    ["@/lib/prisma", "next-auth", "@/lib/barrel"]
  ];

  it("resolvedModuleFilesFor_matches_forbiddenModuleFiles_", () => {
    for (const specifiers of specifierLists) {
      expect(
        [...resolvedModuleFilesFor(checkData, specifiers)].sort(),
        `specifiers: ${JSON.stringify(specifiers)}`
      ).toEqual([...forbiddenModuleFiles_(checkData, specifiers)].sort());
    }
  });

  /**
   * The lock above would pass if both functions returned the empty set for everything, so pin the
   * one answer that makes it worth locking: two differently-typed specifiers naming one file agree,
   * and the lookalike does not join them.
   */
  it("resolves two spellings of one module to the same file, and a lookalike to its own", () => {
    expect([...resolvedModuleFilesFor(checkData, ["@/lib/prisma", "../../lib/prisma"])])
      .toEqual(["src/lib/prisma.ts"]);
    expect([...resolvedModuleFilesFor(checkData, ["@/lib/prisma-legacy"])])
      .toEqual(["src/lib/prisma-legacy.ts"]);
  });

  /**
   * A bare package name resolves to nothing, because the Rust resolver filters to paths inside the
   * scan snapshot and `node_modules` is outside it. This is the emptiness that S3-02 must classify
   * rather than treat as "no such helper".
   */
  it("returns nothing for an external package, which has no resolution edge by design", () => {
    expect([...resolvedModuleFilesFor(checkData, ["next-auth"])]).toEqual([]);
  });
});
