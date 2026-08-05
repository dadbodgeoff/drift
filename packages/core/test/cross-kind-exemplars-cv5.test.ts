import { describe, expect, it } from "vitest";
import { conformingExemplars } from "../src/conforming-exemplars.js";
import { exemplarContext } from "../src/exemplar-context.js";
import type { AcceptedConvention } from "../src/domain.js";

/**
 * CV-5: "conforming" means zero open findings against ANY accepted convention.
 *
 * This is the correct generalization of BB-5's invariant rather than an extension of it. BB-5 asked
 * whether a file conforms to the convention being described, and with one accepted convention that was
 * the same question. CV-5's acceptance floor made a repo able to accept more than one, and they came
 * apart on the first real repo: on dub a file conforming to `api_route_no_direct_data_access` can
 * violate the auth family, and offering it as a conforming example sends an agent to open a file that
 * breaks another accepted rule.
 *
 * That is trial B1's defection trigger, which is the entire reason BB-5 exists - so the honest reading
 * of its invariant was always "zero open findings", not "zero open findings of this kind". The eval
 * suite caught it as `exemplar_integrity: true -> false` the moment auto-acceptance was switched on.
 */

const convention = (id: string, kind: AcceptedConvention["kind"]): AcceptedConvention =>
  ({
    id,
    kind,
    scope: { path_globs: [], exclude_path_globs: [], file_roles: ["api_route" as const] },
    matcher: { kind, applies_to_file_roles: ["api_route" as const] }
  }) as unknown as AcceptedConvention;

const DATA_ACCESS = convention("convention_data", "api_route_no_direct_data_access");
const AUTH = convention("convention_auth", "api_route_requires_auth_helper");

const SCOPE = [
  "app/api/a/route.ts",
  "app/api/b/route.ts",
  "app/api/c/route.ts",
  "app/api/d/route.ts"
];

const contextWith = (findings: Array<{ convention: string; file: string }>) =>
  exemplarContext({
    scanFiles: SCOPE,
    roleByFile: new Map(SCOPE.map((file) => [file, "api_route"])),
    openFindings: findings.map((entry) => ({
      convention_id: entry.convention,
      evidence_refs: [{ file_path: entry.file }] as never
    })),
    activeBaseline: []
  });

describe("CV-5 cross-kind exemplar integrity", () => {
  it("excludes a file that violates a DIFFERENT accepted convention", () => {
    // The dub shape. `b` conforms to data-access and violates the auth family. Describing data-access
    // must not offer it, because the agent reading the packet does not get to know which rule the
    // example was chosen against.
    const context = contextWith([{ convention: AUTH.id, file: "app/api/b/route.ts" }]);
    const result = conformingExemplars({
      scopeFiles: context.scopeFilesFor(DATA_ACCESS),
      violatingFiles: context.violatingFilesAnyConvention(),
      roleByFile: context.roleByFile,
      referenceFile: "app/api/a/route.ts"
    });
    expect(result.conforming_examples.map((example) => example.file_path)).not.toContain(
      "app/api/b/route.ts"
    );
  });

  it("is the union, not the per-convention set - which is what regressed", () => {
    // The negative control for the fix: the OLD behaviour, asked for this convention alone, still
    // returns nothing, so a reader can see the two answers differ and which one ships.
    const context = contextWith([{ convention: AUTH.id, file: "app/api/b/route.ts" }]);
    expect(context.violatingFilesFor(DATA_ACCESS.id).has("app/api/b/route.ts")).toBe(false);
    expect(context.violatingFilesAnyConvention().has("app/api/b/route.ts")).toBe(true);
  });

  it("still excludes a file violating the convention being described", () => {
    // BB-5's original property must survive the generalization.
    const context = contextWith([{ convention: DATA_ACCESS.id, file: "app/api/c/route.ts" }]);
    const result = conformingExemplars({
      scopeFiles: context.scopeFilesFor(DATA_ACCESS),
      violatingFiles: context.violatingFilesAnyConvention(),
      roleByFile: context.roleByFile,
      referenceFile: "app/api/a/route.ts"
    });
    expect(result.conforming_examples.map((example) => example.file_path)).not.toContain(
      "app/api/c/route.ts"
    );
  });

  it("counts a baselined violation of another convention as a violation", () => {
    // BB-5's rule that a baselined violation is still a violation, now spanning kinds. A baseline entry
    // is the most likely way a file violates a second convention, because onboarding baselines them.
    const context = exemplarContext({
      scanFiles: SCOPE,
      roleByFile: new Map(SCOPE.map((file) => [file, "api_route"])),
      openFindings: [],
      activeBaseline: [{ convention_id: AUTH.id, file_path: "app/api/b/route.ts" } as never]
    });
    expect(context.violatingFilesAnyConvention().has("app/api/b/route.ts")).toBe(true);
  });

  it("offers the clean files and nothing else", () => {
    const context = contextWith([
      { convention: AUTH.id, file: "app/api/b/route.ts" },
      { convention: DATA_ACCESS.id, file: "app/api/c/route.ts" }
    ]);
    const result = conformingExemplars({
      scopeFiles: context.scopeFilesFor(DATA_ACCESS),
      violatingFiles: context.violatingFilesAnyConvention(),
      roleByFile: context.roleByFile,
      referenceFile: "app/api/a/route.ts"
    });
    const paths = result.conforming_examples.map((example) => example.file_path);
    expect(paths).not.toContain("app/api/b/route.ts");
    expect(paths).not.toContain("app/api/c/route.ts");
    expect(paths.length).toBeGreaterThan(0);
  });

  it("is deterministic - the tie-break is unchanged", () => {
    const build = () => {
      const context = contextWith([{ convention: AUTH.id, file: "app/api/b/route.ts" }]);
      return conformingExemplars({
        scopeFiles: context.scopeFilesFor(DATA_ACCESS),
        violatingFiles: context.violatingFilesAnyConvention(),
        roleByFile: context.roleByFile,
        referenceFile: "app/api/a/route.ts"
      }).conforming_examples.map((example) => example.file_path);
    };
    expect(build()).toEqual(build());
  });
});
