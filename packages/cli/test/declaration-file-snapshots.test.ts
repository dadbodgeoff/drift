import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import { runCli } from "../src/index.js";

/**
 * Declaration files are read by their own reader, never by the TypeScript grammar.
 *
 * A `.prisma` file gets a `file_snapshots` row with a content hash - evidence is hard-coupled to
 * that hash (`EvidenceRefSchema.file_hash` is `min(1)`), so nothing can attach to a file without
 * one - and its facts come from the schema reader.
 *
 * The load-bearing assertion is the NEGATIVE one: no TypeScript-shaped fact may ever come off a
 * `.prisma` file. tree-sitter does not reject foreign input; handed a Prisma schema the TypeScript
 * grammar builds an ERROR-node tree and emits plausible-looking `import_used` / `exported_symbol`
 * facts rather than failing. Junk facts are worse than no facts, and they would be invisible in a
 * count-based test - hence checking the kinds, not just the total.
 */
describe("declaration file snapshots", () => {
  async function fixture(): Promise<{ repoRoot: string; stateRoot: string }> {
    const dir = await mkdtemp(join(tmpdir(), "drift-decl-"));
    const repoRoot = join(dir, "repo");
    await mkdir(join(repoRoot, "app/api/thing"), { recursive: true });
    await mkdir(join(repoRoot, "prisma"), { recursive: true });
    await writeFile(
      join(repoRoot, "app/api/thing/route.ts"),
      'export async function GET() { return Response.json({ ok: true }); }\n'
    );
    await writeFile(
      join(repoRoot, "prisma/schema.prisma"),
      "model Thing {\n  id   String @id\n  name String\n}\n\nenum Status {\n  ACTIVE\n}\n"
    );
    await writeFile(join(repoRoot, "package.json"), '{ "name": "fx" }\n');
    return { repoRoot, stateRoot: join(dir, "state") };
  }

  it("reads a .prisma file with its own parser and never with the TypeScript grammar", async () => {
    const { repoRoot, stateRoot } = await fixture();
    const started = await runCli([
      "start", "--repo-root", repoRoot, "--state-root", stateRoot, "--accept-defaults", "--json"
    ]);
    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(started.stdout);

    const storage = openDriftStorage({ databasePath: payload.state.database_path });
    storage.migrate();
    const scan = storage.listScanManifests(payload.repo.id).find((entry) => entry.status === "completed");
    expect(scan).toBeDefined();
    const snapshots = storage.listFileSnapshots(payload.repo.id, scan!.id);

    const prisma = snapshots.find((snapshot) => snapshot.file_path === "prisma/schema.prisma");
    expect(prisma).toBeDefined();
    expect(prisma!.indexed).toBe(true);
    // Evidence needs a hash to attach to.
    expect(prisma!.content_hash.length).toBeGreaterThan(0);

    const prismaFacts = storage.listFacts(scan!.id).filter((fact) => fact.file_path.endsWith(".prisma"));

    // Every fact off this file came from the schema reader.
    expect(prismaFacts.length).toBeGreaterThan(0);
    expect([...new Set(prismaFacts.map((fact) => fact.kind))].sort()).toEqual([
      "data_model_declared",
      "data_model_field_declared"
    ]);
    expect(prismaFacts.map((fact) => fact.name).sort()).toEqual(["Thing", "Thing.id", "Thing.name"]);

    // The negative that matters: no TypeScript-shaped fact, which is what an ERROR-node parse of
    // this file would have produced.
    for (const junk of ["import_used", "exported_symbol", "symbol_called", "re_export_used"]) {
      expect(prismaFacts.some((fact) => fact.kind === junk)).toBe(false);
    }

    // Provenance says which parser to distrust if one of these turns out wrong.
    expect(prismaFacts.every((fact) => fact.extraction_method === "rust_prisma_schema_parser")).toBe(true);

    storage.close();
  });

  it("counts only parsed files in the scan manifest", async () => {
    const { repoRoot, stateRoot } = await fixture();
    const started = await runCli([
      "start", "--repo-root", repoRoot, "--state-root", stateRoot, "--accept-defaults", "--json"
    ]);
    const payload = JSON.parse(started.stdout);

    const storage = openDriftStorage({ databasePath: payload.state.database_path });
    storage.migrate();
    const scan = storage.listScanManifests(payload.repo.id).find((entry) => entry.status === "completed");
    const snapshots = storage.listFileSnapshots(payload.repo.id, scan!.id);

    // Two files recorded and both read - the TypeScript source by the TS grammar, the schema by
    // the schema reader. `package.json` is not in the indexable set at all.
    //
    // `file_count` counts files whose CONTENTS were read, which is what keeps it honest for a
    // format Drift records but cannot yet parse: such a file stays `indexed: false` and is
    // excluded here, rather than inflating "scanned N files" the way BB-1's "Checked N files"
    // exists to prevent one layer up.
    expect(snapshots).toHaveLength(2);
    expect(snapshots.filter((snapshot) => snapshot.indexed)).toHaveLength(2);
    expect(scan!.file_count).toBe(2);

    storage.close();
  });
});
