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
 * dataImportKind          how the repo's own routes import that module: "named" (the default) or
 *                         "default". This is not cosmetic. papermark's lib/prisma.ts contains only
 *                         `export default prisma;` and all 204 of its real routes write
 *                         `import prisma from "@/lib/prisma"`, so the named form the harness used to
 *                         inject named a symbol that does not exist and would not compile. It passed
 *                         for years because the extractor recognised default exports only when they
 *                         wrapped a declaration, so the module appeared to export nothing at all and
 *                         symbol resolution was skipped entirely. EW-4 fixed that gap, the engine
 *                         correctly reported the injected import as unresolved, and EW-2 correctly
 *                         withheld a finding whose own import could not be placed. The regression
 *                         was in the fixture, and it had been hiding behind the bug.
 * cleanModule/cleanSymbol properly layered import, used for the false-positive control
 * expectForbidden         entries that MUST appear in the learned forbidden_imports
 * expectedExitCode        the exit code the main check MUST produce (O-1). Recorded per
 *                         repo, never hardcoded in the predicate, so every transitional
 *                         value is explicit and reviewable here.
 *
 * On the expectedExitCode values (S1-01 transitional, resolved by EW-2): every repo used to
 * expect 3 (refused). That was S1-01 working, not a regression - an unresolved import on a
 * route in the diff zeroed every finding's enforcement_result, and the check refused instead
 * of reporting that as a clean run. This note said they would flip once resolver coverage made
 * those imports resolvable. They flipped for a different and better reason.
 *
 * EW-2 narrowed the demotion from check-wide to per-finding: uncertainty about a finding's own
 * dependency chain withholds that finding, and uncertainty elsewhere does not. The 3s were
 * caused by the harness's own deliberately non-existent decoy imports
 * (`@/lib/prisma-legacy`, `@formbricks/database/internal`, `@openstatus/db/internal`), which are
 * genuinely unresolvable and always will be - that is what they are for. Their uncertainty is
 * now scoped to the decoy's own route, so the injected violation is judged at the contract's
 * mode on all seven repos:
 *
 *   block-mode (formbricks, calcom, midday, openstatus)  ->  2, injection_enforcement "block"
 *   warn-mode  (taxonomy, dub, papermark)                ->  3, injection_enforcement "warn"
 *
 * The warn-mode repos still expect 3, and that is correct rather than leftover: a warn-mode
 * violation contributes no blocking count, so nothing outranks the refusal - and the decoy
 * route's own finding genuinely cannot be judged, which is what the refusal reports. The change
 * on those repos is visible in `injection_enforcement`: "none" (the violation was suppressed)
 * became "warn" (the violation was judged, at the mode the contract asks for).
 *
 * Do not "fix" a 3 here by reverting S1-01 or EW-2.
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
    // EW-2: was 3. The subpath decoy (`@formbricks/database/internal`, deliberately
    // non-existent) is still unresolvable and still withholds *its own* route's finding; the
    // injected violation resolves cleanly and now blocks. Measured: injection_enforcement
    // "none" -> "block", blocking_count 0 -> 1.
    expectedExitCode: 2
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
    // EW-2: was 3, for the same decoy-scoping reason as formbricks.
    expectedExitCode: 2
  },
  {
    name: "papermark",
    routeDir: "app/api",
    dataModule: "@/lib/prisma",
    dataSymbol: "prisma",
    cleanModule: "@/lib/utils",
    cleanSymbol: "cn",
    // lib/prisma.ts default-exports and exports nothing named; every real route imports it this way.
    dataImportKind: "default",
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
    // EW-2: was 3, for the same decoy-scoping reason as formbricks.
    expectedExitCode: 2
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
    // EW-2: was 3, for the same decoy-scoping reason as formbricks.
    expectedExitCode: 2
  }
];
