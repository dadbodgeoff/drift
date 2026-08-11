import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("R&D architecture drift guard", () => {
  it("keeps the graph-backed engine work aligned with the planning docs", async () => {
    const factGraphPlan = await readFile("docs/architecture/factgraph-adapter-boundary.md", "utf8");
    const frontierRequirements = await readFile("docs/architecture/frontier-engineering-requirements.md", "utf8");
    const graphQueryPlan = await readFile("docs/architecture/graph-query-api.md", "utf8");
    const factGraphPackage = await readFile("packages/factgraph/src/index.ts", "utf8");
    const queryPackage = await readFile("packages/query/src/index.ts", "utf8");
    const storageMigrations = await readFile("packages/storage/src/migrations.ts", "utf8");
    const engineContract = await readFile("packages/engine-contract/src/index.ts", "utf8");
    const rustProtocol = await readFile("crates/drift-engine/src/protocol.rs", "utf8");
    const rustEngine = await readFile("crates/drift-engine/src/main.rs", "utf8");
    const repoMap = await readFile("packages/cli/src/domain/repo-map.ts", "utf8");
    const cliManifest = JSON.parse(await readFile("packages/cli/package.json", "utf8"));

    expect(factGraphPlan).toContain("Decision: use Option B as the product path.");
    expect(factGraphPlan).toContain("normalized graph projections in SQLite");
    expect(frontierRequirements).toContain("Streaming Engine Boundary");
    expect(frontierRequirements).toContain("Drift uses Option B");
    expect(graphQueryPlan).toContain("`repo map`, `prepare`, `ask`, and MCP equivalents use the same query builders.");

    expect(factGraphPackage).toContain("FactGraphSchema");
    expect(factGraphPackage).toContain("buildFactGraphArtifactFromParts");
    expect(factGraphPackage).toContain("GraphCompletenessSchema");
    expect(queryPackage).toContain("class GraphQueryService");
    expect(queryPackage).toContain("listGraphNodes");
    expect(queryPackage).toContain("listGraphEdges");
    expect(queryPackage).toContain("listGraphEvidence");

    for (const table of [
      "graph_evidence",
      "graph_diagnostics",
      "graph_completeness",
      "symbol_occurrences",
      "resolver_dependencies",
      "module_dependents"
    ]) {
      expect(storageMigrations).toContain(table);
    }

    for (const eventName of [
      "graph_node_batch",
      "graph_edge_batch",
      "graph_evidence_batch"
    ]) {
      expect(engineContract).toContain(eventName);
    }
    expect(rustProtocol).toContain("GraphNodeBatch");
    expect(rustProtocol).toContain("GraphEdgeBatch");
    expect(rustProtocol).toContain("GraphEvidenceBatch");
    expect(rustEngine).toContain("graph_for_file");
    expect(repoMap).toContain("@drift/query");
    expect(repoMap).toContain("createGraphQueryService");
    expect(cliManifest.dependencies["@drift/query"]).toBe("workspace:*");
  });
});
