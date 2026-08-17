import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * D-G4: the `scan_started` vocabulary handshake, for all three vocabularies it declares.
 *
 * The handshake existed and had no test. It also covered one vocabulary of three: fact kinds were
 * compared and refused with exit 3 and a message naming the cause, while graph node and edge kinds
 * were bare `String` on the engine side and a Zod enum on this side with nothing between them. An
 * unknown node kind therefore surfaced from `GraphNodeSchema` partway through the stream - exit 1,
 * "Invalid enum value", after `graph_node_batch` had already arrived, which on a real scan is after
 * every fact - rather than as the exit-3 `engine_vocabulary_mismatch` the same failure got when it
 * happened to a fact.
 *
 * The stub stands in for the one pairing that matters, an engine newer than the CLI beside it. That
 * state is unproducible from this checkout because both sides are generated from one manifest, which
 * is the point of the change and the reason the refusal needs a stand-in to be exercised at all.
 */

const STUB = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "stub-vocabulary-engine.mjs"
);

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scanWithStub(overdeclare: "fact" | "graph_node" | "graph_edge" | "none") {
  const dir = await mkdtemp(join(tmpdir(), "drift-vocabulary-handshake-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  await mkdir(join(repoRoot, "app/api/x"), { recursive: true });
  await writeFile(join(repoRoot, "package.json"), '{"name":"vh","version":"1.0.0"}\n');
  await writeFile(
    join(repoRoot, "app/api/x/route.ts"),
    "export async function GET(){return Response.json({})}\n"
  );

  const previousBin = process.env.DRIFT_ENGINE_BIN;
  const previousVocabulary = process.env.DRIFT_STUB_VOCABULARY;
  try {
    process.env.DRIFT_ENGINE_BIN = STUB;
    process.env.DRIFT_STUB_VOCABULARY = overdeclare;
    return await runCli([
      "scan",
      "--repo-root",
      repoRoot,
      "--db",
      join(dir, "state", "drift.db"),
      "--json"
    ]);
  } finally {
    if (previousBin === undefined) {
      delete process.env.DRIFT_ENGINE_BIN;
    } else {
      process.env.DRIFT_ENGINE_BIN = previousBin;
    }
    if (previousVocabulary === undefined) {
      delete process.env.DRIFT_STUB_VOCABULARY;
    } else {
      process.env.DRIFT_STUB_VOCABULARY = previousVocabulary;
    }
  }
}

describe("engine vocabulary handshake", () => {
  it("accepts an engine whose declared vocabularies are all understood", async () => {
    const result = await scanWithStub("none");
    expect(result.exitCode).toBe(0);
  });

  it("refuses an engine that declares an unknown fact kind", async () => {
    const result = await scanWithStub("fact");
    expect(result.exitCode).toBe(3);
    const payload = JSON.parse(result.stdout) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("engine_vocabulary_mismatch");
    expect(payload.error.message).toContain("graphql_resolver_declared");
    expect(payload.error.message).toContain("facts");
  });

  it("refuses an engine that declares an unknown graph node kind", async () => {
    const result = await scanWithStub("graph_node");
    expect(result.exitCode).toBe(3);
    const payload = JSON.parse(result.stdout) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("engine_vocabulary_mismatch");
    expect(payload.error.message).toContain("service_boundary");
    expect(payload.error.message).toContain("graph node kinds");
  });

  it("refuses an engine that declares an unknown graph edge kind", async () => {
    const result = await scanWithStub("graph_edge");
    expect(result.exitCode).toBe(3);
    const payload = JSON.parse(result.stdout) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("engine_vocabulary_mismatch");
    expect(payload.error.message).toContain("ROUTE_CALLS_SERVICE");
    expect(payload.error.message).toContain("graph edge kinds");
  });
});
