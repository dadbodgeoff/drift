import { describe, expect, it } from "vitest";
import {
  API_ROUTE_SCOPE_GLOBS,
  conventionScopeFiles,
  expandApiRouteScopeGlobs,
  matchesPolicyGlob,
  type AcceptedConvention
} from "@drift/core";

/**
 * BB-11: the differential between MCP's local scope decision and the shared core predicate.
 *
 * BB-6 moved scope membership into `@drift/core` so the check path, the CLI packet and the MCP packet
 * could not disagree about what a convention covers. `packages/mcp/src/index.ts:2160` — pre-sprint code
 * from May, on the `relevant_files` reasons/roles surface — still decides scope itself.
 *
 * BB-11 required running this differential *before* replacing that logic, and stopping if the two
 * disagreed, because then the divergence is a live policy bug rather than a refactor. **They disagree**,
 * so the replacement is not made here. What is committed instead is the evidence.
 *
 * The two glob primitives are not the problem: `matchesPolicyGlob` is already a thin alias for core's
 * `matchesGlob`, and `apiCompatibleGlobs` for `expandApiRouteScopeGlobs`. On every tricky path shape
 * with a default or narrowed scope, the two agree — including root-level `app/api/x/route.ts`, which is
 * F3's case.
 *
 * The divergence is that `:2160` applies globs *only*. It never consults `exclude_path_globs`, so a file
 * the contract author explicitly excluded is still reported as "in scope for <convention_id>" on the
 * agent-facing packet, and inherits that convention's roles. MCP's own sibling helper
 * (`scopeMatchesFile`, :2461) does honour exclusions — so this is an inconsistency inside one file, not
 * a deliberate policy.
 *
 * Bounded but real: default onboarding writes `exclude_path_globs: []`, so it is latent until an author
 * narrows their contract. It mislabels a packet; it does not weaken enforcement, which goes through the
 * core path.
 */

const conventionWith = (scope: Partial<AcceptedConvention["scope"]>): AcceptedConvention =>
  ({
    id: "convention_bb11",
    kind: "api_route_no_direct_data_access",
    scope: {
      path_globs: [...API_ROUTE_SCOPE_GLOBS],
      exclude_path_globs: [],
      file_roles: ["api_route"],
      ...scope
    },
    matcher: { kind: "forbidden_imports", forbidden_imports: ["@/lib/prisma"] }
  }) as unknown as AcceptedConvention;

/** MCP's local decision, verbatim from packages/mcp/src/index.ts:2160. */
const mcpInScope = (convention: AcceptedConvention, filePath: string): boolean =>
  expandApiRouteScopeGlobs(convention.scope.path_globs).some((glob) => matchesPolicyGlob(filePath, glob));

const coreInScope = (convention: AcceptedConvention, filePath: string): boolean =>
  conventionScopeFiles([filePath], convention).includes(filePath);

/** The shapes that have historically broken glob-based route detection. */
const TRICKY_PATHS = [
  "app/api/users/route.ts",
  "app/api/users/[id]/route.ts",
  "app/api/users/route.tsx",
  "apps/web/app/api/users/route.ts",
  "apps/web/app/(admin)/api/projects/route.ts",
  "src/app/api/users/route.ts",
  "pages/api/users.ts",
  "src/pages/api/users.ts",
  "app/api/workspaces/[idOrSlug]/invites/route.ts",
  "lib/services/users.ts",
  "app/components/Button.tsx",
  "README.md"
];

describe("BB-11 scope predicate differential", () => {
  it("agrees on every tricky path under the default scope", () => {
    // Including root-level `app/api/users/route.ts`, which is F3: a glob engine that required a leading
    // directory silently disabled enforcement for the default create-next-app layout.
    const convention = conventionWith({});
    for (const filePath of TRICKY_PATHS) {
      expect(
        { path: filePath, mcp: mcpInScope(convention, filePath) },
        `default scope disagreement on ${filePath}`
      ).toEqual({ path: filePath, mcp: coreInScope(convention, filePath) });
    }
  });

  it("agrees on a narrowed scope", () => {
    const convention = conventionWith({ path_globs: ["apps/web/app/api/**/route.ts"] });
    for (const filePath of TRICKY_PATHS) {
      expect(mcpInScope(convention, filePath)).toBe(coreInScope(convention, filePath));
    }
  });

  it("pins the shared predicate's answers for the tricky table", () => {
    // BB-11 red #2's regression pin, on the side that is authoritative.
    const convention = conventionWith({});
    const inScope = TRICKY_PATHS.filter((filePath) => coreInScope(convention, filePath));
    expect(inScope).toEqual([
      "app/api/users/route.ts",
      "app/api/users/[id]/route.ts",
      "app/api/users/route.tsx",
      "apps/web/app/api/users/route.ts",
      "apps/web/app/(admin)/api/projects/route.ts",
      "src/app/api/users/route.ts",
      "pages/api/users.ts",
      "src/pages/api/users.ts",
      "app/api/workspaces/[idOrSlug]/invites/route.ts"
    ]);
  });

  it("DIVERGES on exclude_path_globs - reported, not fixed here", () => {
    // KNOWN DEFECT, pinned deliberately. BB-11 says a disagreement is a product decision rather than a
    // refactor, so the behaviour is left as found and recorded instead.
    //
    // When this is decided and fixed, this test will fail. That is the point: it should fail, and send
    // whoever fixed it to docs/beta-run/SUMMARY-BB.md to strike the open question.
    const convention = conventionWith({ exclude_path_globs: ["**/internal/**"] });
    const excluded = "app/api/internal/route.ts";

    expect(coreInScope(convention, excluded)).toBe(false);
    // The bug: an explicitly excluded file is still labelled in-scope by the MCP surface.
    expect(mcpInScope(convention, excluded)).toBe(true);

    // And the exclusion is honoured everywhere else in the same file, which is what makes this an
    // inconsistency rather than a policy.
    expect(matchesPolicyGlob(excluded, "**/internal/**")).toBe(true);
  });
});
