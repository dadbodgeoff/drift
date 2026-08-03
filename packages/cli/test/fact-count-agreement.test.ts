import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";

/**
 * EW-6 / DET-1: the two scan paths must agree about how many facts there are.
 *
 * The full path records the engine's emission count on the scan manifest; the incremental path
 * reads rows back out of SQLite. Those are different numbers whenever a fact is dropped between
 * emission and storage, and one was: a fact's stored id was derived from
 * (scan, file, kind, name, value, line) with no column, so two identical calls on one line hashed
 * to the same id and `ON CONFLICT(id) DO UPDATE` silently merged them.
 *
 * The count mismatch is the symptom. The defect is that the second occurrence was gone - nothing
 * downstream could see it. Determinism is the marketed claim, and a count that differs by code path
 * invites exactly the question you least want asked.
 *
 * These run the real CLI so the manifest and the rows come from the paths a user exercises.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A repo whose routes deliberately put two identical calls on one line. Legal, unremarkable, and
 * the exact shape that collapsed.
 */
async function repoWithRepeatedCalls(): Promise<{
  run: (args: string[]) => { code: number; stdout: string };
  home: string;
  repoRoot: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "drift-factcount-repo-"));
  const home = await mkdtemp(join(tmpdir(), "drift-factcount-home-"));
  dirs.push(repoRoot, home);

  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "factcount", private: true }));
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } })
  );
  await mkdir(join(repoRoot, "src/lib"), { recursive: true });
  await writeFile(
    join(repoRoot, "src/lib/prisma.ts"),
    "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();\n"
  );
  await mkdir(join(repoRoot, "src/services"), { recursive: true });
  await writeFile(
    join(repoRoot, "src/services/users.ts"),
    "import { prisma } from '@/lib/prisma';\nexport async function listUsers() { return prisma.user.findMany(); }\n"
  );
  for (const name of ["one", "two", "three"]) {
    await mkdir(join(repoRoot, "src/app/api", name), { recursive: true });
    await writeFile(
      join(repoRoot, "src/app/api", name, "route.ts"),
      'import { listUsers } from "@/services/users";\n\n' +
        "export async function GET() {\n" +
        // Two identical calls on one line, twice over. Nothing here is unusual code.
        "  const a = await listUsers(); const b = await listUsers();\n" +
        "  const c = await listUsers(); const d = await listUsers();\n" +
        "  return Response.json({ a, b, c, d });\n" +
        "}\n"
    );
  }

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const cli = join(REPO_ROOT, "packages/cli/dist/main.js");
  const run = (args: string[]) => {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [cli, ...args], {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          env: {
            ...process.env,
            HOME: home,
            DRIFT_HOME: home,
            DRIFT_ENGINE_BIN: join(REPO_ROOT, "target/release/drift-engine")
          }
        })
      };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      return { code: failure.status ?? 1, stdout: failure.stdout ?? "" };
    }
  };
  return { run, home, repoRoot };
}

interface Counts {
  manifestFactCount: number;
  storedFactCount: number;
  repeatedCallRows: number;
  scanFingerprint: string;
}

function countsFor(databasePath: string, scanId: string): Counts {
  const storage = openDriftStorage({ databasePath });
  try {
    const manifest = storage.getScanManifest(scanId);
    expect(manifest, `scan ${scanId} must exist`).toBeDefined();
    const facts = storage.listFacts(scanId);
    const snapshots = storage.listFileSnapshots(manifest!.repo_id, scanId);
    return {
      manifestFactCount: manifest!.fact_count,
      storedFactCount: facts.length,
      repeatedCallRows: facts.filter(
        (fact) =>
          fact.kind === "symbol_called" &&
          fact.name === "listUsers" &&
          fact.file_path === "src/app/api/one/route.ts"
      ).length,
      // Recomputed the same way `scan status` does, so a change here is a change users see.
      scanFingerprint: JSON.stringify({
        fact_count: manifest!.fact_count,
        file_count: manifest!.file_count,
        snapshots: snapshots.map((snapshot) => [snapshot.file_path, snapshot.content_hash]).sort()
      })
    };
  } finally {
    storage.close();
  }
}

describe("fact count agreement", () => {
  it("stores every emitted fact, so the manifest count and the row count are the same number", async () => {
    const { run, home } = await repoWithRepeatedCalls();
    const started = run(["start", "--repo-root", ".", "--accept-defaults", "--json"]);
    expect(started.code, started.stdout.slice(0, 600)).toBe(0);
    const payload = JSON.parse(started.stdout) as { repo: { id: string }; scan: { id: string } };
    const databasePath = join(home, ".drift/repos", payload.repo.id, "drift.sqlite");

    const counts = countsFor(databasePath, payload.scan.id);

    expect(
      counts.storedFactCount,
      "the full path counts engine emissions and the incremental path counts rows; if these " +
        "differ, facts are being dropped between the two"
    ).toBe(counts.manifestFactCount);
    expect(
      counts.repeatedCallRows,
      "four identical calls across two lines must be four facts, not two"
    ).toBe(4);
  }, 240_000);

  it("keeps the counts in agreement through a rescan, which is the reuse path", async () => {
    const { run, home, repoRoot } = await repoWithRepeatedCalls();
    const started = run(["start", "--repo-root", ".", "--accept-defaults", "--json"]);
    expect(started.code).toBe(0);
    const first = JSON.parse(started.stdout) as { repo: { id: string }; scan: { id: string } };
    const databasePath = join(home, ".drift/repos", first.repo.id, "drift.sqlite");
    const firstCounts = countsFor(databasePath, first.scan.id);

    // A second scan of the *unchanged* repo: every file is reusable, so this is the path where
    // facts come back from the manifest rather than from the parser.
    const rescan = run(["--db", databasePath, "scan", "--repo-root", ".", "--json"]);
    expect(rescan.code, rescan.stdout.slice(0, 600)).toBe(0);
    const second = JSON.parse(rescan.stdout) as { scan: { id: string } };
    const secondCounts = countsFor(databasePath, second.scan.id);

    expect(secondCounts.storedFactCount).toBe(secondCounts.manifestFactCount);
    expect(
      secondCounts.storedFactCount,
      "an unchanged repo must yield the same number of facts however they were obtained"
    ).toBe(firstCounts.storedFactCount);
    expect(
      secondCounts.scanFingerprint,
      "determinism: adding a column discriminator must not reorder or re-key anything else"
    ).toBe(firstCounts.scanFingerprint);
    expect(secondCounts.repeatedCallRows).toBe(4);
    void repoRoot;
  }, 240_000);
});
