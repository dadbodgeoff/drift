// D4 — the `db` / `data-access` token boundary bug (TDD §5.4).
//
// `is_data_access_source` matched `db` and `data-access` as bare substrings, so a debug logger
// (`lib/dbg`), a movie-API client (`lib/imdb`) and a doc helper (`lib/no-data-access-here`) were
// all recorded as data-layer modules and every route importing one was flagged. `prisma` was
// already routed through the boundary-aware matcher, which is why `lib/prismatic` behaved and the
// two other tokens did not.
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

const NEAR_MISSES = [
  // `db` inside a longer identifier, on each side.
  "pages/api/route-dbg.ts",
  "pages/api/route-imdb.ts",
  // `data-access` as an interior fragment of a hyphenated phrase — the case the audit did not
  // report, and the one a `db`-only fix leaves behind.
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
    // Stated as a count as well as a membership list, so a route appearing twice, or a route
    // nobody thought to name, cannot pass unnoticed.
    expect(flagged).toEqual(GENUINE);
  });
});
