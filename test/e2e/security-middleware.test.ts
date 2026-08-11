import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

const tempDirs: string[] = [];
let originalEngineBin: string | undefined;

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-security-middleware-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  return { repoRoot, stateRoot };
}

beforeEach(() => {
  originalEngineBin = process.env.DRIFT_ENGINE_BIN;
  process.env.DRIFT_ENGINE_BIN = resolve("target/debug/drift-engine");
});

afterEach(async () => {
  if (originalEngineBin === undefined) {
    delete process.env.DRIFT_ENGINE_BIN;
  } else {
    process.env.DRIFT_ENGINE_BIN = originalEngineBin;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("security middleware fixture matrix", () => {
  it("security middleware fixture matrix proves coverage and gaps", async () => {
    const cases = [
      {
        name: "security-middleware-covered",
        protectsRoute: true,
        parserGap: false
      },
      {
        name: "security-middleware-mismatch",
        protectsRoute: false,
        parserGap: false
      },
      {
        name: "security-middleware-method-mismatch",
        protectsRoute: false,
        parserGap: false
      },
      {
        name: "security-middleware-dynamic-parser-gap",
        protectsRoute: false,
        parserGap: true
      }
    ];

    for (const entry of cases) {
      const { repoRoot, stateRoot } = await fixtureRepo(entry.name);
      const scan = await runCli([
        "scan",
        "--repo-root", repoRoot,
        "--state-root", stateRoot,
        "--now", "2026-05-25T00:00:00.000Z",
        "--json"
      ]);
      expect(scan.exitCode, `${entry.name} scan stderr:\n${scan.stderr}`).toBe(0);
      const payload = JSON.parse(scan.stdout);
      const storage = openDriftStorage({ databasePath: payload.database_path });

      try {
        const facts = storage.listFacts(payload.scan.id);
        expect(facts).toContainEqual(expect.objectContaining({
          kind: "middleware_declared",
          file_path: "middleware.ts"
        }));
        if (!entry.parserGap) {
          expect(facts).toContainEqual(expect.objectContaining({
            kind: "middleware_matcher_declared",
            file_path: "middleware.ts"
          }));
        }
        const protectsRoute = facts.some((fact) =>
          fact.kind === "middleware_protects_route" &&
          fact.file_path === "app/api/projects/route.ts"
        );
        expect(protectsRoute, `${entry.name} protects route`).toBe(entry.protectsRoute);

        const parserGaps = storage.listParserGaps(payload.repo.id, payload.scan.id);
        const hasDynamicMiddlewareGap = parserGaps.some((gap) =>
          gap.message === "unsupported_dynamic_middleware_matcher" &&
          gap.confidence_impact === "blocks_enforcement"
        );
        expect(hasDynamicMiddlewareGap, `${entry.name} dynamic parser gap`).toBe(entry.parserGap);
      } finally {
        storage.close();
      }
    }
  }, 20_000);
});
