import { describe, expect, it } from "vitest";
import { resolvedModuleFilesFor } from "../src/check/run-check.js";
import { graphEdge, graphScanData, importNode, moduleNode } from "./helpers/scan-data.js";

/**
 * S3-01: the specifier resolver stops being about forbidden imports specifically.
 *
 * `forbiddenModuleFiles_` answered a question that has nothing to do with the word "forbidden" in
 * its name: given some import specifiers, what files does this repo actually resolve them to. It
 * answers it from the repo's own `IMPORT_RESOLVES_TO_MODULE` edges rather than by re-resolving,
 * which is why it cannot disagree with the resolver that built the graph - and that property is
 * what closed the T93 bypasses, where `../../lib/prisma` and a barrel re-export of the same module
 * both slipped past specifier-string comparison.
 *
 * This is the characterization lock over that extraction, and it pins the ANSWER rather than an
 * identity. The first version of this file compared `resolvedModuleFilesFor` against
 * `forbiddenModuleFiles_` - which by then was a one-line caller of it, so the test compared a
 * function to itself and could not fail. Replacing the entire body of the resolver with
 * `return new Set(["MUTANT/does-not-exist.ts"])` left it green. Every row below now names the files
 * that specifier list must produce, so a resolver that stops resolving fails here first.
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
   * Every specifier list the forbidden-import path can hand this function, each with the answer it
   * must produce. The empty list matters: `run-check.ts` calls the resolver with
   * `convention.matcher.forbidden_imports ?? []` when building the engine request, so an empty list
   * reaching it is a live shape rather than a hypothetical.
   *
   * `@/lib` resolving to all three modules beneath it is the subpath relation this default
   * behaviour is built on, and is exactly what an ACCEPTED helper list must NOT do - see
   * `SpecifierMatch` and the accepted-helper identity tests.
   *
   * `@/lib/prisma` does NOT pick up `@/lib/prisma-legacy`: the relation is bounded at `/`, and that
   * boundary is what keeps the T03 negative control green.
   */
  const cases: Array<{ specifiers: string[]; files: string[] }> = [
    { specifiers: [], files: [] },
    { specifiers: ["@/lib/prisma"], files: ["src/lib/prisma.ts"] },
    { specifiers: ["../../lib/prisma"], files: ["src/lib/prisma.ts"] },
    { specifiers: ["@/lib/prisma", "../../lib/prisma"], files: ["src/lib/prisma.ts"] },
    { specifiers: ["@/lib/prisma-legacy"], files: ["src/lib/prisma-legacy.ts"] },
    { specifiers: ["@/lib/barrel"], files: ["src/lib/barrel.ts"] },
    { specifiers: ["next-auth"], files: [] },
    {
      specifiers: ["@/lib"],
      files: ["src/lib/barrel.ts", "src/lib/prisma-legacy.ts", "src/lib/prisma.ts"]
    },
    {
      specifiers: ["@/lib/prisma", "next-auth", "@/lib/barrel"],
      files: ["src/lib/barrel.ts", "src/lib/prisma.ts"]
    }
  ];

  it("resolves each specifier list to the files the repo says it means", () => {
    for (const { specifiers, files } of cases) {
      expect(
        [...resolvedModuleFilesFor(checkData, specifiers)].sort(),
        `specifiers: ${JSON.stringify(specifiers)}`
      ).toEqual(files);
    }
  });

  /**
   * The subpath relation is the DEFAULT, and an accepted-helper list must never get it. Pinned here
   * so that flipping the default - which would silently widen every accepted helper - fails in the
   * file that documents the relation rather than only in the security tests downstream.
   */
  it("matches a specifier or its subpaths by default, and only the exact specifier on request", () => {
    expect([...resolvedModuleFilesFor(checkData, ["@/lib"], "specifier_or_subpath")].sort())
      .toEqual(["src/lib/barrel.ts", "src/lib/prisma-legacy.ts", "src/lib/prisma.ts"]);
    expect([...resolvedModuleFilesFor(checkData, ["@/lib"], "exact_specifier")]).toEqual([]);
    expect([...resolvedModuleFilesFor(checkData, ["@/lib/prisma"], "exact_specifier")])
      .toEqual(["src/lib/prisma.ts"]);
  });

  /**
   * A bare package resolves to nothing, because the Rust resolver filters to paths inside the scan
   * snapshot and `node_modules` is outside it. This is the emptiness that helper identity must
   * classify as `external` rather than treat as "no such helper".
   */
  it("returns nothing for an external package, which has no resolution edge by design", () => {
    expect([...resolvedModuleFilesFor(checkData, ["next-auth"])]).toEqual([]);
  });

});
