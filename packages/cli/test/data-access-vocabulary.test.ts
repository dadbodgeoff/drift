import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { rawLooksLikeDataAccessImport } from "../src/domain/convention-candidates.js";

/**
 * D-H3, the TypeScript half. The Rust half is crates/drift-engine/tests/data_access_vocabulary.rs
 * and carries the full rationale; both read this one table.
 *
 * What this side owns is the `ts_fallback` column. The containment the engine asserts - that the
 * primary path never sees less than this degraded fallback - is only meaningful if this column is
 * measured rather than remembered, so every case is run through the real regex here.
 */

const table = JSON.parse(
  readFileSync(
    new URL("../../../test/fixtures/data-access-vocabulary/specifiers.json", import.meta.url),
    "utf8"
  )
) as {
  cases: Array<{
    specifier: string;
    engine: boolean;
    ts_fallback: boolean;
    narrowing_reason?: string;
  }>;
};

describe("D-H3 data-access vocabulary", () => {
  for (const testCase of table.cases) {
    it(`classifies ${testCase.specifier} as ${testCase.ts_fallback ? "" : "not "}a data layer`, () => {
      expect(rawLooksLikeDataAccessImport(testCase.specifier)).toBe(testCase.ts_fallback);
    });
  }

  it("records a reason wherever the engine is deliberately narrower than this fallback", () => {
    // The same assertion the engine makes, from this side, so a case added here without an
    // engine-side thought fails here too rather than only in Rust.
    const unexplained = table.cases
      .filter((c) => c.ts_fallback && !c.engine && !c.narrowing_reason)
      .map((c) => c.specifier);
    expect(unexplained).toEqual([]);
  });

  it("names the ORMs the rest of the project already treats as data layers", () => {
    // This fallback misses drizzle-orm and kysely as bare package names, and that is precisely why
    // it is the fallback. Pinned so the gap is a known quantity rather than a discovery.
    expect(rawLooksLikeDataAccessImport("@acme/drizzle")).toBe(true);
    expect(rawLooksLikeDataAccessImport("typeorm")).toBe(true);
    expect(rawLooksLikeDataAccessImport("sequelize")).toBe(true);
    expect(rawLooksLikeDataAccessImport("drizzle-orm")).toBe(false);
    expect(rawLooksLikeDataAccessImport("kysely")).toBe(false);
  });
});
