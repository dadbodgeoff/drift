import { describe, expect, it } from "vitest";
import { noCandidateTextForTest } from "../src/commands/start.js";

/**
 * T103 / T01b. The A6 discovery message must be visible even when the repo has other convention
 * candidates.
 *
 * It is the only thing standing between "this repo has no convention to enforce" and "inference
 * cannot see your data layer, here is where it is" - the distinction that made F4 invisible. A
 * Supabase repo whose routes call the database directly got the same output as a perfectly layered
 * one. Suppressing it whenever some other candidate existed would restore exactly that blindness.
 */
describe("data layer discovery message", () => {
  it("names the wrapper and the command when a data layer was found structurally", () => {
    const text = noCandidateTextForTest({
      declaredPackages: ["@supabase/ssr"],
      suggestions: [
        {
          filePath: "packages/supabase/src/client/server.ts",
          packageName: "@supabase/ssr",
          importedAs: ["@midday/supabase/server"],
          routeImporterCount: 2
        }
      ]
    });
    expect(text).toContain("a data layer was found");
    // The local path matters: a package name alone is not actionable.
    expect(text).toContain("packages/supabase/src/client/server.ts");
    expect(text).toContain("@midday/supabase/server");
    expect(text).toContain("--data-modules");
  });

  it("names declared dependencies when no wrapper is imported by a route", () => {
    const text = noCandidateTextForTest({
      declaredPackages: ["@prisma/client", "better-sqlite3"],
      suggestions: []
    });
    expect(text).toContain("@prisma/client");
    // Says why there is nothing to enforce rather than reporting silence.
    expect(text).toMatch(/nothing to enforce|No local module/);
  });

  it("falls back to a plain message when no discovery ran", () => {
    expect(noCandidateTextForTest(undefined)).toContain("No enforceable convention candidates");
  });
});
