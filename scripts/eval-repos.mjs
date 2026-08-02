/**
 * The pinned evaluation repos, shared by the external-eval suite (scripts/external-eval.mjs)
 * and the evasion matrix (scripts/evasion-matrix.mjs) so the two harnesses can never
 * disagree about which repos and data layers are under test (O-3).
 *
 * Fields consumed only by the evasion matrix:
 *   genuineSubpath/genuineSubpathSymbol  a REAL, existing subpath module of the data
 *     layer plus a symbol it actually exports (S12). Absent when the data module is a
 *     single file with no subpaths (taxonomy, papermark) or the forbidden specifier is
 *     already the deepest real subpath (midday); the shape records UNTESTABLE there.
 */
/**
 * dataModule/dataSymbol   real data layer, used for the injected violation
 * cleanModule/cleanSymbol properly layered import, used for the false-positive control
 * expectForbidden         entries that MUST appear in the learned forbidden_imports
 * expectedExitCode        the exit code the main check MUST produce (O-1). Recorded per
 *                         repo, never hardcoded in the predicate, so every transitional
 *                         value is explicit and reviewable here.
 *
 * On the expectedExitCode values (S1-01 transitional): taxonomy, calcom, papermark and
 * midday expect 3 (refused), not 0 or 2. That is S1-01 working, not a regression - an
 * unresolved import on a route in the diff zeroes every finding's enforcement_result, and
 * the check now refuses (exit 3) instead of reporting that as a clean run. These flip when
 * S1-04 lands resolver coverage (nested tsconfig + workspace packages), which makes those
 * imports resolvable: block-mode repos to 2, warn-mode repos to 0. Do not "fix" a 3 here
 * by reverting S1-01.
 */
export const EVAL_REPOS = [
  {
    name: "taxonomy",
    routeDir: "app/api",
    dataModule: "@/lib/db",
    dataSymbol: "db",
    cleanModule: "@/lib/session",
    cleanSymbol: "getCurrentUser",
    expectForbidden: ["@/lib/db"],
    expectForbiddenExact: ["@/lib/db"],
    expectedExitCode: 3
  },
  {
    name: "dub",
    routeDir: "apps/web/app/api",
    dataModule: "@/lib/prisma",
    dataSymbol: "prisma",
    cleanModule: "@/lib/api/errors",
    cleanSymbol: "handleAndReturnErrorResponse",
    expectForbidden: ["@/lib/prisma"],
    genuineSubpath: "@/lib/prisma/edge",
    genuineSubpathSymbol: "prismaEdge",
    // E-4 transitional: was 0. Nested tsconfig discovery makes apps/web's `@/lib/*` alias
    // match the harness's own deliberately non-existent negative-control imports
    // (`@/lib/prisma-legacy`), which are now correctly classified unresolved instead of
    // external - so S1-01 refuses the main check (3), exactly the state taxonomy, calcom,
    // papermark and midday already record (their root aliases always matched the decoys).
    // The injected violation itself resolves cleanly (no diagnostics on the injected route;
    // measured directly) and enforcement-in-isolation still matches the warn mode. Flips to
    // 0 when the isolation-aware oracle measurement (S1-03 follow-up) or E-5-era decoy
    // handling lands.
    expectedExitCode: 3
  },
  {
    name: "formbricks",
    routeDir: "apps/web/app/api",
    dataModule: "@formbricks/database",
    dataSymbol: "prisma",
    cleanModule: "@/app/lib/api/response",
    cleanSymbol: "responses",
    expectForbidden: ["@formbricks/database"],
    // E-4: @/lib/utils/resolve-client-id joined the learned set once nested tsconfig
    // resolution made apps/web's `@/*` imports resolvable. Verified genuine: the module
    // imports prisma from @formbricks/database and runs prisma.workspace.findFirst
    // directly - a data-access wrapper reachable from routes, the same discovery shape as
    // midday's expectDiscoveryWrapper. A new true positive, not an over-match.
    expectForbiddenExact: ["@/lib/utils/resolve-client-id", "@formbricks/database"],
    genuineSubpath: "@formbricks/database/src/client",
    genuineSubpathSymbol: "prisma",
    // E-2 transitional (cause re-measured under E-5): was 2. Once resolver coverage
    // (pnpm-workspace.yaml) made @formbricks/database resolvable, the harness's own
    // subpath negative control (`@formbricks/database/internal`, deliberately
    // non-existent) became a genuinely unresolvable import on a route in the diff, so
    // S1-01 refuses the main check (unresolved_route_import on the subpath probe) - the
    // same decoy-driven class as dub. E-2's log attributed this to S1-05 symbol
    // conservatism (unresolved_import_symbol via export * chains); E-5 measured that
    // claim false: the isolated injected route exits 2 and the sole blocked_reason names
    // drift-eval-subpath. This 3 is CORRECT fail-closed behaviour toward the decoy and
    // does not flip with E-5; it flips only if the oracle measures the main check
    // decoy-free (S1-03 follow-up).
    expectedExitCode: 3
  },
  {
    name: "calcom",
    routeDir: "apps/web/app/api",
    dataModule: "@calcom/prisma",
    dataSymbol: "prisma",
    cleanModule: "@calcom/lib/constants",
    cleanSymbol: "WEBAPP_URL",
    expectForbidden: ["@calcom/prisma"],
    expectForbiddenExact: ["@calcom/prisma"],
    genuineSubpath: "@calcom/prisma/selects",
    genuineSubpathSymbol: "safeAppSelect",
    expectedExitCode: 3
  },
  {
    name: "papermark",
    routeDir: "app/api",
    dataModule: "@/lib/prisma",
    dataSymbol: "prisma",
    cleanModule: "@/lib/utils",
    cleanSymbol: "cn",
    expectForbidden: ["@/lib/prisma"],
    expectedExitCode: 3
  },
  {
    // T01: the only repo whose data layer defeats the substring whitelist in
    // is_data_access_source. Without it the suite passes whether or not F4 exists, because
    // every other repo names its data layer prisma/db/database. `whitelistIndependent`
    // switches on the F4 assertions in evaluateRepo.
    name: "midday",
    routeDir: "apps/dashboard/src/app/api",
    dataModule: "@midday/supabase/server",
    dataSymbol: "createClient",
    cleanModule: "@midday/utils/sanitize-redirect",
    // The module exports sanitizeRedirectPath. Importing a symbol that does not exist made the
    // clean control route unresolvable, which correctly suppressed blocking for the whole check.
    cleanSymbol: "sanitizeRedirectPath",
    expectForbidden: ["@midday/supabase/server"],
    whitelistIndependent: true,
    declaredDataModules: "@midday/supabase/server,@midday/supabase/cached-queries",
    expectDiscoveryWrapper: "packages/supabase/src/client/server.ts",
    expectedExitCode: 3
  },
  {
    name: "openstatus",
    routeDir: "apps/dashboard/src/app/api",
    dataModule: "@openstatus/db",
    dataSymbol: "db",
    cleanModule: "@openstatus/api",
    cleanSymbol: "edgeRouter",
    expectForbidden: ["@openstatus/db"],
    expectForbiddenExact: ["@openstatus/db", "@openstatus/db/src/db", "@openstatus/db/src/schema"],
    genuineSubpath: "@openstatus/db/src/db",
    genuineSubpathSymbol: "db",
    // E-3 transitional (cause re-measured under E-5): was 2. Once deep workspace globs
    // (packages/**/*) made @openstatus/db resolvable, the subpath negative control
    // (`@openstatus/db/internal`, deliberately non-existent) became a genuinely
    // unresolvable route import, so S1-01 refuses the main check - the same decoy-driven
    // class as dub and formbricks. E-3's log attributed this to unresolved_import_symbol
    // through the `export *` barrel; E-5 measured that claim false: the injected route in
    // isolation exits 2 (block) and the sole blocked_reason names drift-eval-subpath.
    // Does not flip with E-5; flips only with a decoy-free main-check measurement.
    expectedExitCode: 3
  }
];
