import { describe, expect, it } from "vitest";
import { conformingExemplars } from "../src/conforming-exemplars.js";

/**
 * An exemplar must be PROVEN to conform, not merely lack a finding.
 *
 * Absence of a finding only ever meant "not evaluated". On a `--scope changed-hunks` run the
 * candidate pool is the whole repo while the violator set comes from the diff, so on dub that was
 * 1 file in and 139 out: 138 unexamined routes were certified conforming, and one of the three
 * offered — `apps/web/app/(ee)/api/admin/ban/route.ts` — imported prisma at line 4 while the SAME
 * payload cited that exact file as violation evidence.
 *
 * `prepare`, `ask` and MCP's `get_task_preflight` are worse still: they never run a check, so on a
 * repo where none ever has, the violator set is empty and every file in scope qualifies.
 */

const SCOPE = [
  "app/api/clean/route.ts",
  "app/api/violating/route.ts",
  "app/api/lookalike/route.ts",
  "app/api/unscanned/route.ts"
];

const IMPORTS = new Map<string, string[]>([
  ["app/api/clean/route.ts", ["@/lib/services/links", "next/server"]],
  ["app/api/violating/route.ts", ["@/lib/prisma"]],
  // A prefix of a forbidden entry is a DIFFERENT module and must stay eligible, or the fix trades
  // the false positive for a false negative.
  ["app/api/lookalike/route.ts", ["@/lib/prisma-legacy"]]
  // "unscanned" deliberately absent: the scan has nothing to say about it.
]);

const forbidden = ["@/lib/prisma", "@prisma/client"];

describe("conforming exemplars are verified against facts", () => {
  it("never offers a file that imports a forbidden module, even with no finding recorded", () => {
    const result = conformingExemplars({
      scopeFiles: SCOPE,
      violatingFiles: [], // the changed-hunks reality: nothing recorded for these files
      forbiddenImports: forbidden,
      importsByFile: IMPORTS,
      // Every candidate, not the top 3. With the default limit the violating file sorts last
      // alphabetically and falls off the end, so this assertion passed on main for a reason that
      // had nothing to do with verification.
      limit: SCOPE.length
    });

    const offered = result.conforming_examples.map((example) => example.file_path);
    expect(offered).not.toContain("app/api/violating/route.ts");
    expect(offered).toContain("app/api/clean/route.ts");
  });

  it("keeps a lookalike module eligible, because it is a different module", () => {
    const offered = conformingExemplars({
      scopeFiles: SCOPE,
      violatingFiles: [],
      forbiddenImports: forbidden,
      importsByFile: IMPORTS,
      limit: SCOPE.length
    }).conforming_examples.map((example) => example.file_path);

    expect(offered).toContain("app/api/lookalike/route.ts");
  });

  it("does not offer a file the scan never saw", () => {
    const offered = conformingExemplars({
      scopeFiles: SCOPE,
      violatingFiles: [],
      forbiddenImports: forbidden,
      importsByFile: IMPORTS,
      limit: SCOPE.length
    }).conforming_examples.map((example) => example.file_path);

    // Unproven is not conforming. This is the whole bug in one assertion.
    expect(offered).not.toContain("app/api/unscanned/route.ts");
  });

  it("offers nothing at all when it cannot verify", () => {
    const result = conformingExemplars({
      scopeFiles: SCOPE,
      violatingFiles: [],
      forbiddenImports: forbidden
      // no importsByFile
    });

    expect(result.conforming_examples).toEqual([]);
    expect(result.reason).toBe("unverified");
  });

  it("still honours the violator set for conventions that forbid no imports", () => {
    const result = conformingExemplars({
      scopeFiles: SCOPE,
      violatingFiles: ["app/api/clean/route.ts"],
      limit: SCOPE.length
    });

    expect(result.conforming_examples.map((example) => example.file_path)).not.toContain(
      "app/api/clean/route.ts"
    );
  });
});
