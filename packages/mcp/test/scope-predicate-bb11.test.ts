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
 * disagreed, because then the divergence is a live policy bug rather than a refactor. They disagreed on
 * exactly one input - `exclude_path_globs`, which `:2160` never consulted - and that was adjudicated as
 * a bug rather than a policy, because `scopeMatchesFile` in the same file already honours exclusions.
 *
 * `:2160` now calls `conventionScopeFiles`. This file therefore flipped from pinning the divergence to
 * pinning the agreement: the tricky-path table is now a regression test on the shared predicate, and
 * the exclusion case asserts the two AGREE where it used to assert they differ. The behavioural
 * regression test for the seam itself is in mcp.test.ts, for the reason given on `mcpInScope` below.
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

/**
 * What :2160 now calls. This is a MIRROR of the source, not the source itself - the seam is a private
 * function - so nothing in this file can detect the source reverting to a local glob decision. An
 * earlier version of this comment claimed it could; red-checking the revert proved it does not, because
 * reverting the source leaves this mirror untouched.
 *
 * The behavioural guarantee therefore lives where it can actually fail: "does not report an excluded
 * file as in scope for a convention (BB-11)" in mcp.test.ts drives `get_task_preflight` through the real
 * seam, and goes red when the fix is reverted. What this file contributes is the predicate-level
 * differential and the record of the adjudication.
 */
const mcpInScope = (convention: AcceptedConvention, filePath: string): boolean =>
  conventionScopeFiles([filePath], convention).length > 0;

/** The pre-fix local decision, retained so the defect it caused stays reproducible. */
const legacyGlobOnlyInScope = (convention: AcceptedConvention, filePath: string): boolean =>
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

  it("AGREES on exclude_path_globs - the divergence BB-11 found, now fixed", () => {
    // This assertion is inverted from the one this file shipped with. It used to pin
    // `mcpInScope === true` on an excluded path as a KNOWN DEFECT; the fix routes :2160 through the
    // shared predicate, so both now exclude it.
    const convention = conventionWith({ exclude_path_globs: ["**/internal/**"] });
    const excluded = "app/api/internal/route.ts";

    expect(coreInScope(convention, excluded)).toBe(false);
    expect(mcpInScope(convention, excluded)).toBe(false);

    // The defect stays reproducible: the old glob-only decision still says the excluded file is in
    // scope, so the divergence BB-11 measured is preserved as evidence rather than deleted. Note this
    // does NOT detect a revert at :2160 - see the note on `mcpInScope` for where that is tested.
    expect(legacyGlobOnlyInScope(convention, excluded)).toBe(true);
    expect(matchesPolicyGlob(excluded, "**/internal/**")).toBe(true);
  });

  it("still labels an unexcluded route in scope - the fix must not over-narrow", () => {
    // The negative control for the fix: routing through core must not silently drop files that were
    // correctly in scope before, which would quietly shrink the agent-facing relevant_files surface.
    const convention = conventionWith({ exclude_path_globs: ["**/internal/**"] });

    expect(mcpInScope(convention, "app/api/users/route.ts")).toBe(true);
    expect(coreInScope(convention, "app/api/users/route.ts")).toBe(true);
  });
});
