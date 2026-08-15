import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * A contract may name only files Drift actually indexes.
 *
 * Before these guards, an `agent_contracts` entry with `path_globs: ["prisma/*.prisma"]` imported
 * reporting `Valid: true, compatible: true, reasons: []`, and then behaved two different ways
 * depending only on the scope flag:
 *
 *   --scope changed-files -> exit 1 with a raw Zod trace on `evidence_refs[0].file_hash`, because
 *                            the evaluators glob the parsed diff (no extension filter), found no
 *                            snapshot, and built evidence with `file_hash: ""`. The throw killed
 *                            the whole check, discarding conventions that had already passed.
 *   --scope full          -> `status: pass`, because `fullRepoDiff` is TypeScript-only, so the
 *                            rule matched nothing and silently enforced nothing.
 *
 * Both are the "accepted and silently enforcing nothing" failure that UNIMPLEMENTED_CONVENTION_KINDS
 * exists to prevent, and neither was caught by any test.
 */
describe("unindexed contract targets", () => {
  async function fixture(): Promise<{ repoRoot: string; stateRoot: string }> {
    const dir = await mkdtemp(join(tmpdir(), "drift-unindexed-"));
    const repoRoot = join(dir, "repo");
    await mkdir(join(repoRoot, "app/api/thing"), { recursive: true });
    await mkdir(join(repoRoot, "lib"), { recursive: true });
    await mkdir(join(repoRoot, "prisma"), { recursive: true });
    await writeFile(
      join(repoRoot, "app/api/thing/route.ts"),
      'import { db } from "@/lib/db";\nexport async function GET() { return Response.json(await db.thing.findMany()); }\n'
    );
    await writeFile(
      join(repoRoot, "lib/db.ts"),
      'import { PrismaClient } from "@prisma/client";\nexport const db = new PrismaClient();\n'
    );
    await writeFile(join(repoRoot, "prisma/schema.prisma"), "model Thing {\n  id String @id\n}\n");
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    // Present on disk and deliberately NOT indexed, so the guard is exercised against a real file
    // rather than a merely missing path. `.prisma` is no longer a valid target for this test - it
    // is parsed now, so a rule about it IS enforceable.
    await writeFile(join(repoRoot, "docs/architecture.md"), "# Architecture\n");
    await writeFile(join(repoRoot, "package.json"), '{ "name": "fx" }\n');
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }\n'
    );
    return { repoRoot, stateRoot: join(dir, "state") };
  }

  function withUnindexedGlob(contract: Record<string, unknown>): Record<string, unknown> {
    return {
      ...contract,
      agent_contracts: [
        {
          kind: "file_role",
          id: "agent_docs",
          version: 1,
          roles: [
            {
              role: "docs",
              path_globs: ["docs/*.md"],
              required_exports: ["Thing"],
              confidence: "deterministic"
            }
          ]
        }
      ]
    };
  }

  it("refuses a contract whose agent globs match no indexed file", async () => {
    const { repoRoot, stateRoot } = await fixture();
    const started = await runCli([
      "start", "--repo-root", repoRoot, "--state-root", stateRoot, "--accept-defaults", "--json"
    ]);
    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(started.stdout);
    const db = payload.state.database_path;
    const repoId = payload.repo.id;

    const exported = await runCli([
      "--db", db, "contract", "export", "--repo", repoId,
      "--format", "json", "--output", join(stateRoot, "c.json"), "--confirm", "--json"
    ]);
    expect(exported.exitCode).toBe(0);

    const base = JSON.parse(await readFile(join(stateRoot, "c.json"), "utf8"));
    const contract = withUnindexedGlob(base.contract ?? base);
    const contractPath = join(stateRoot, "c-prisma.json");
    await writeFile(contractPath, JSON.stringify(contract, null, 2));

    const dryRun = await runCli(["--db", db, "contract", "import", contractPath, "--dry-run", "--json"]);
    expect(dryRun.exitCode).toBe(1);
    const result = JSON.parse(dryRun.stdout);
    expect(result.compatibility.compatible).toBe(false);
    expect(result.compatibility.reasons).toContain("agent_contract_target_not_indexed");
  });

  it("still imports a contract whose agent globs match indexed files", async () => {
    const { repoRoot, stateRoot } = await fixture();
    const started = await runCli([
      "start", "--repo-root", repoRoot, "--state-root", stateRoot, "--accept-defaults", "--json"
    ]);
    const payload = JSON.parse(started.stdout);
    const db = payload.state.database_path;
    const repoId = payload.repo.id;

    const exported = await runCli([
      "--db", db, "contract", "export", "--repo", repoId,
      "--format", "json", "--output", join(stateRoot, "c.json"), "--confirm", "--json"
    ]);
    expect(exported.exitCode).toBe(0);

    const base = JSON.parse(await readFile(join(stateRoot, "c.json"), "utf8"));
    const contract = base.contract ?? base;
    // Same shape, but pointed at a file the scan does index.
    contract.agent_contracts = [
      {
        kind: "file_role",
        id: "agent_lib",
        version: 1,
        roles: [
          { role: "data_access_module", path_globs: ["lib/*.ts"], confidence: "heuristic" }
        ]
      }
    ];
    const contractPath = join(stateRoot, "c-lib.json");
    await writeFile(contractPath, JSON.stringify(contract, null, 2));

    const dryRun = await runCli(["--db", db, "contract", "import", contractPath, "--dry-run", "--json"]);
    expect(dryRun.exitCode).toBe(0);
    expect(JSON.parse(dryRun.stdout).compatibility.reasons).not.toContain(
      "agent_contract_target_not_indexed"
    );
  });
});
