// D4 — the `data-access` token boundary bug (TDD §5.4), scoped down at the W7 merge.
//
// `is_data_access_source` matched `db` and `data-access` as bare substrings, so a debug logger
// (`lib/dbg`), a movie-API client (`lib/imdb`) and a doc helper (`lib/no-data-access-here`) were
// all recorded as data-layer modules and every route importing one was flagged. `prisma` was
// already routed through the boundary-aware matcher, which is why `lib/prismatic` behaved and the
// two other tokens did not.
//
// **Only the `data-access` half ships.** Upstream owns `db` and matches it loosely on purpose —
// `crates/drift-engine/src/data_access.rs` records the reason: `@acme/dbutils` and `lib/appdb` are
// real data layers in the repos that write them, and the type-surface exclusions above the token
// tests are what keeps the loose rule honest. That trade-off is upstream's to make, so `route-dbg`
// and `route-imdb` stay flagged and are asserted below as such rather than deleted from the
// fixture: the near-miss shapes are still worth carrying, and if `db` is ever tightened this test
// is where the change has to be argued.
//
// `data-access` had no such defence. `lib/no-data-access-here` is a module whose own name says it
// does no data access, and no repo is served by matching it.
//
// The four genuine routes are the control: they are asserted here and, independently, in
// `test/e2e/gt-golden.test.ts`. A fix that silences the false positives by narrowing too far
// fails on that side, which is the point of keeping both.

import { afterEach, describe, expect, it } from "vitest";
import { cleanupGtTempDirs, flaggedPaths, readFindings, runGtWorkflow } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

const DATA_ACCESS_KIND = "api_route_no_direct_data_access";

const GENUINE = [
  "pages/api/route-data-access.ts",
  "pages/api/route-database.ts",
  "pages/api/route-db.ts",
  "pages/api/route-prisma.ts"
];

// `db` inside a longer identifier, on each side. These were D4's original target and are NOT
// silenced: upstream keeps `db` loose deliberately (see the header). Asserted as flagged so the
// behaviour is stated rather than merely tolerated.
const LOOSE_DB_MATCHES = ["pages/api/route-dbg.ts", "pages/api/route-imdb.ts"];

const NEAR_MISSES = [
  // `data-access` as an interior fragment of a hyphenated phrase — the case the audit did not
  // report, and the half of D4 that ships.
  "pages/api/route-no-data-access.ts",
  // Already correct at baseline: proof the boundary matcher works where it was actually used.
  "pages/api/route-prismatic.ts",
  "pages/api/route-utils.ts"
];

describe("D4 data-access name heuristic", () => {
  it("flags every genuine data-access route and nothing else", async () => {
    const run = await runGtWorkflow({
      fixture: "gt-data-access",
      acceptKinds: [DATA_ACCESS_KIND]
    });

    const flagged = flaggedPaths(readFindings(run.databasePath, run.repoId), DATA_ACCESS_KIND);

    for (const route of GENUINE) {
      expect(flagged, `${route} is a genuine data-access route and must stay flagged`).toContain(route);
    }
    for (const route of NEAR_MISSES) {
      expect(flagged, `${route} imports no data layer and must not be flagged`).not.toContain(route);
    }
    for (const route of LOOSE_DB_MATCHES) {
      expect(
        flagged,
        `${route} is still flagged: the loose \`db\` rule is upstream's documented decision, ` +
          `not an oversight. Changing this line means changing data_access.rs.`
      ).toContain(route);
    }
    // Stated as a count as well as a membership list, so a route appearing twice, or a route
    // nobody thought to name, cannot pass unnoticed.
    expect(flagged).toEqual([...GENUINE, ...LOOSE_DB_MATCHES].sort());
  });
});
