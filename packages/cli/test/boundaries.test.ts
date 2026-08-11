import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("architecture boundary gate", () => {
  it("covers query and factgraph package ownership rules", async () => {
    const source = await readFile("scripts/check-boundaries.mjs", "utf8");

    expect(source).toContain("query: join(repoRoot, \"packages/query/src\")");
    expect(source).toContain("factgraph: join(repoRoot, \"packages/factgraph/src\")");
    expect(source).toContain("pkg === \"query\"");
    expect(source).toContain("pkg === \"factgraph\"");
    expect(source).toContain("query must stay read-model only");
    expect(source).toContain("factgraph must stay schema-only");
  });
});
