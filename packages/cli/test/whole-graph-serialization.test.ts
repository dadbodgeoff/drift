import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-02: onboarding must not build a whole-graph JSON string.
 *
 * Three sites do today, measured on papermark (1,366 files) at d2517b9:
 *
 *   105,024,113 chars  inferConventionCandidatesFromEngine  the infer-candidates request
 *    97,230,007 chars  buildFactGraphArtifactFromParts      sha256(JSON.stringify(graph))
 *    10,793,116 chars  createScanReuseManifest              rescan only, so absent on a first run
 *
 * Each is bounded only by Node's MAX_STRING_LENGTH (536,870,888), which is what makes repo size a
 * cliff rather than a curve - see the T-01 gate in engine-payload-limits.ts. The third is not in
 * the T-02 plan's site list: it appears only on a rescan, when a previous scan exists to reuse,
 * and it scales with stored facts exactly as the other two do.
 *
 * The budget is 8 MB. It is not a performance target - it is the assertion that no single
 * serialization is proportional to repo size any more.
 */

const STRINGIFY_BUDGET_CHARS = 8 * 1024 * 1024;

const ENGINE_STUB = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "stub-payload-engine.mjs"
);

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface OverBudget {
  chars: number;
  site: string;
}

/**
 * Run `body` with `JSON.stringify` instrumented, reporting every call over budget and where it
 * came from. In-process, so it sees the CLI's own calls rather than a subprocess's.
 */
async function recordOversizedStringify(body: () => Promise<unknown>): Promise<OverBudget[]> {
  const original = JSON.stringify;
  const oversized: OverBudget[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (JSON as any).stringify = function (...args: unknown[]) {
    const out = (original as (...a: unknown[]) => unknown).apply(JSON, args);
    if (typeof out === "string" && out.length > STRINGIFY_BUDGET_CHARS) {
      const site = ((new Error().stack ?? "").split("\n")[2] ?? "unknown").trim();
      oversized.push({ chars: out.length, site });
    }
    return out;
  };
  try {
    await body();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (JSON as any).stringify = original;
  }
  return oversized;
}

async function fixture(): Promise<{ repoRoot: string; statePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t02-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  await mkdir(join(repoRoot, "app/api/x"), { recursive: true });
  await writeFile(join(repoRoot, "package.json"), '{"name":"t02","version":"1.0.0"}\n');
  await writeFile(
    join(repoRoot, "app/api/x/route.ts"),
    "export async function GET(){return Response.json({})}\n"
  );
  return { repoRoot, statePath: join(dir, "drift.db") };
}

/**
 * A payload well over the budget but well under the T-01 ceiling, so onboarding proceeds and the
 * serializations run at a size a whole-graph string cannot hide at.
 *
 * Facts are kept small and numerous. With few enormous facts the fixture's own `value` string
 * would exceed the budget on its own, and the test could not tell that apart from the defect it
 * is looking for - a real repo's facts are hundreds of bytes, not megabytes.
 */
const PAYLOAD_BYTES = 12 * 1024 * 1024;
const FACT_VALUE_BYTES = 256;

async function withStubEngine<T>(body: () => Promise<T>): Promise<T> {
  const previous = {
    DRIFT_ENGINE_BIN: process.env.DRIFT_ENGINE_BIN,
    DRIFT_STUB_ENGINE_PAYLOAD_BYTES: process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES,
    DRIFT_STUB_ENGINE_FACT_VALUE_BYTES: process.env.DRIFT_STUB_ENGINE_FACT_VALUE_BYTES
  };
  try {
    process.env.DRIFT_ENGINE_BIN = ENGINE_STUB;
    process.env.DRIFT_STUB_ENGINE_PAYLOAD_BYTES = String(PAYLOAD_BYTES);
    process.env.DRIFT_STUB_ENGINE_FACT_VALUE_BYTES = String(FACT_VALUE_BYTES);
    return await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function describeSites(oversized: OverBudget[]): string {
  return oversized.map((entry) => `\n  ${entry.chars} chars at ${entry.site}`).join("");
}

describe("no serialization is proportional to repo size", () => {
  it("onboarding builds no JSON string over the budget", async () => {
    const dirs = await fixture();

    const oversized = await withStubEngine(() =>
      recordOversizedStringify(async () => {
        const result = await runCli([
          "start",
          "--repo-root",
          dirs.repoRoot,
          "--db",
          dirs.statePath,
          "--accept-defaults",
          "--json"
        ]);
        expect(result.exitCode, result.stdout).toBe(0);
        return result;
      })
    );

    // Today: two sites, the infer-candidates request and the graph-artifact hash.
    expect(oversized, `oversized serializations:${describeSites(oversized)}`).toEqual([]);
  }, 300_000);

  it("rescanning builds no JSON string over the budget", async () => {
    const dirs = await fixture();

    await withStubEngine(async () => {
      const first = await runCli([
        "start",
        "--repo-root",
        dirs.repoRoot,
        "--db",
        dirs.statePath,
        "--accept-defaults",
        "--json"
      ]);
      expect(first.exitCode, first.stdout).toBe(0);
    });

    const oversized = await withStubEngine(() =>
      recordOversizedStringify(async () => {
        const result = await runCli([
          "scan",
          "--repo-root",
          dirs.repoRoot,
          "--db",
          dirs.statePath,
          "--json"
        ]);
        expect(result.exitCode, result.stdout).toBe(0);
        return result;
      })
    );

    // Today: the two above, plus createScanReuseManifest - which exists only on this path.
    expect(oversized, `oversized serializations:${describeSites(oversized)}`).toEqual([]);
  }, 300_000);
});
