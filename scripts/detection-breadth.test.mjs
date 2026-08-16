import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  RECALL_FIELDS,
  UNCERTAINTY_FIELDS,
  breadthVerdict,
  mergeBreadthRows
} from "./detection-breadth-predicate.mjs";

/**
 * Tests for the detection-breadth gate itself.
 *
 * The point of the gate is that every W7 defect was invisible to every gate in the repository, so
 * the only way to know this one is worth having is to replay those defects through it and watch it
 * stop. Each case below is a real measurement taken from the engine with the corresponding fix
 * reverted - the numbers are not invented.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const FIXTURE = join(REPO_ROOT, "test/fixtures/detection-breadth-stacks");
const BASELINE = join(HERE, "detection-breadth-baseline.json");

/** The fixture's recorded row, which is the "after" side of every replay below. */
const fixtureBaseline = JSON.parse(readFileSync(BASELINE, "utf8")).find(
  (row) => row.repo === "fixture-stacks"
);

const measured = (overrides) => ({ ...fixtureBaseline, ...overrides });

describe("the breadth gate stops each W7 defect", () => {
  it("passes when nothing moved", () => {
    expect(breadthVerdict(measured({}), fixtureBaseline).status).toBe("PASS");
  });

  it("D-H2: route handlers outside an api folder becoming invisible", () => {
    // Measured against the reverted engine: the fixture's 3 route files fall to 1, and the two
    // outside any `api` folder - dub's and openstatus's real shapes - to zero.
    const verdict = breadthVerdict(
      measured({ route_files: 1, route_files_outside_api: 0 }),
      fixtureBaseline
    );
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("route_files_fell");
    expect(verdict.failures).toContain("route_files_outside_api_fell");
  });

  it("D-H2: routes outside api vanishing while the total is masked by churn", () => {
    // The reason `route_files_outside_api` is its own field. Corpus-wide it is 27 against 900+
    // routes, so an upstream repo adding 30 files would hide the whole regression inside a rising
    // total. Here the total goes UP and the gate still fails.
    const verdict = breadthVerdict(
      measured({ route_files: fixtureBaseline.route_files + 30, route_files_outside_api: 0 }),
      fixtureBaseline
    );
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toEqual(["route_files_outside_api_fell"]);
  });

  it("D-H3: the learned contract losing the repo's data layer", () => {
    const verdict = breadthVerdict(
      measured({
        learned_forbidden_imports: [],
        learned_contract_names_data_layer: false,
        data_layer_specifiers: [],
        data_layer_specifiers_count: 0
      }),
      fixtureBaseline
    );
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("learned_contract_lost_the_data_layer");
    expect(verdict.failures).toContain("data_layer_specifiers_lost");
  });

  it("D-H3: a vocabulary swap that keeps the count", () => {
    // The count alone would not catch this: one data layer traded for another. That is the exact
    // D-H3 shape, where a whole ORM family was missing while the count on prisma repos stayed put.
    const verdict = breadthVerdict(
      measured({ data_layer_specifiers: ["@stacks/prisma", "@stacks/other"] }),
      fixtureBaseline
    );
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toEqual(["data_layer_specifiers_lost"]);
  });

  it("D-S2: bare export lists producing no facts and false unresolved symbols", () => {
    // Measured: exports 13 -> 8 and one false unresolved_import_symbol against the mixed
    // inline/list export file, which is taxonomy's shape.
    const verdict = breadthVerdict(
      measured({ exported_symbols: 8, unresolved_import_symbol: 1 }),
      fixtureBaseline
    );
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toContain("exported_symbols_fell");
    expect(verdict.failures).toContain("unresolved_import_symbol_rose");
  });

  it("D-PA1/D-PA2: a file that stops parsing", () => {
    // Measured: partial_parse 1 -> 2, the second being the `.js` component read by a grammar that
    // cannot see JSX.
    const verdict = breadthVerdict(measured({ partial_parse: 2 }), fixtureBaseline);
    expect(verdict.status).toBe("FAIL");
    expect(verdict.failures).toEqual(["partial_parse_rose"]);
  });
});

describe("the ratchet points the right way per field", () => {
  for (const field of RECALL_FIELDS) {
    it(`allows ${field} to rise`, () => {
      const verdict = breadthVerdict(
        measured({ [field]: Number(fixtureBaseline[field]) + 5 }),
        fixtureBaseline
      );
      expect(verdict.status).toBe("PASS");
      expect(verdict.moves.join(" ")).toContain(field);
    });
  }

  for (const field of UNCERTAINTY_FIELDS) {
    it(`allows ${field} to fall`, () => {
      // Every one of these fell substantially in W7 - 2,773 unresolved symbols to 1,375 across the
      // corpus - so a ratchet that stopped improvement would have blocked the fix it exists for.
      const verdict = breadthVerdict(measured({ [field]: 0 }), fixtureBaseline);
      expect(verdict.status).toBe("PASS");
    });
  }
});

describe("the gate refuses to report success over what it did not measure", () => {
  it("calls an unbaselined repo NEW, never PASS", () => {
    // An absent baseline read as a pass is how a gate ends up green on a repo it has never checked.
    expect(breadthVerdict(measured({}), undefined).status).toBe("NEW");
  });

  it("fails when the committed fixture is missing, and skips an absent corpus repo", () => {
    // Different absences with different meanings. The fixture is in git, so its absence is a broken
    // checkout and must stop the gate; a corpus repo lives outside the repository and may simply
    // not be cloned. Neither is ever a PASS.
    expect(breadthVerdict({ repo: "fixture-stacks", status: "MISSING_REPO" }, undefined)).toEqual({
      status: "FAIL",
      failures: ["fixture_missing"],
      moves: []
    });
    expect(breadthVerdict({ repo: "dub", status: "SKIPPED_NO_CORPUS" }, undefined).status).toBe(
      "SKIPPED"
    );
  });

  it("fails a contaminated worktree rather than recording its numbers", () => {
    expect(
      breadthVerdict({ repo: "dub", status: "CONTAMINATED_WORKTREE" }, fixtureBaseline).status
    ).toBe("FAIL");
  });

  it("fails a scan that did not complete", () => {
    expect(breadthVerdict({ repo: "dub", status: "SCAN_FAILED" }, fixtureBaseline).status).toBe(
      "FAIL"
    );
  });
});

describe("--update does not destroy what it did not measure", () => {
  it("merges rather than truncating, which is external-eval's O-4 defect", () => {
    const merged = mergeBreadthRows(
      [
        { repo: "dub", route_files: 497 },
        { repo: "taxonomy", route_files: 7 }
      ],
      [{ repo: "dub", route_files: 500 }]
    );
    expect(merged.map((row) => row.repo)).toEqual(["dub", "taxonomy"]);
    expect(merged.find((row) => row.repo === "dub").route_files).toBe(500);
  });
});

describe("the committed fixture is intact", () => {
  it("carries a route handler outside any api folder, which is the D-H2 shape", () => {
    expect(existsSync(join(FIXTURE, "apps/web/app/wellknown/[domain]/route.ts"))).toBe(true);
    expect(existsSync(join(FIXTURE, "apps/web/app/(marketing)/feed.xml/route.ts"))).toBe(true);
  });

  it("carries data layers the corpus cannot supply, which is the D-H3 shape", () => {
    // Recorded here because it is the reason the fixture exists: openstatus IS a Drizzle app, but
    // its package is `@openstatus/db`, so the pre-W7 vocabulary caught it by accident through the
    // `/db` clause. Every other corpus repo names its data layer prisma or database, so a suite
    // built only from the seven passes whether or not Drizzle is visible at all.
    expect(readFileSync(join(FIXTURE, "packages/drizzle/src/index.ts"), "utf8")).toContain(
      "drizzle-orm"
    );
    expect(readFileSync(join(FIXTURE, "packages/kysely/src/index.ts"), "utf8")).toContain("kysely");
    expect(fixtureBaseline.data_layer_specifiers).toEqual(["@stacks/drizzle", "@stacks/kysely"]);
    expect(fixtureBaseline.learned_contract_names_data_layer).toBe(true);
  });

  it("carries an Express route.ts that must NOT become a Next route", () => {
    // The boundary of the D-H2 widening, and the non-Next stack in the fixture. `server/api/users/
    // route.ts` has an `api` folder above it and no `app` ancestor.
    expect(readFileSync(join(FIXTURE, "server/api/users/route.ts"), "utf8")).toContain("express");
    expect(fixtureBaseline.route_files).toBe(3);
  });

  it("carries the D-S2 and D-PA shapes", () => {
    expect(readFileSync(join(FIXTURE, "apps/web/lib/reports.ts"), "utf8")).toContain(
      "export { listReports, reportCount }"
    );
    expect(readFileSync(join(FIXTURE, "apps/web/lib/only-list.ts"), "utf8")).toContain(
      "export { REGION, regionOf }"
    );
    expect(readFileSync(join(FIXTURE, "apps/web/components/panel.js"), "utf8")).toContain(".map(");
    expect(fixtureBaseline.partial_parse).toBe(1);
  });
});

describe("the gate runs end to end against the committed fixture", () => {
  it("passes on the fixture with no corpus present", () => {
    // The one case that needs no corpus and no network, so it can live in test:harness. A missing
    // release engine is reported rather than silently skipped.
    const engine = join(REPO_ROOT, "target/release/drift-engine");
    if (!existsSync(engine) || !existsSync(join(REPO_ROOT, "packages/cli/dist/main.js"))) {
      throw new Error(
        "detection-breadth needs the release engine and the built CLI: " +
          "cargo build --release -p drift-engine && pnpm build"
      );
    }
    const stdout = execFileSync(
      process.execPath,
      [join(HERE, "detection-breadth.mjs"), "--only", "fixture-stacks"],
      { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, DRIFT_EVAL_REPOS: "/nonexistent" } }
    );
    expect(stdout).toContain("ok   fixture-stacks");
    expect(stdout).toContain("1/1 passing");
  }, 120_000);
});
