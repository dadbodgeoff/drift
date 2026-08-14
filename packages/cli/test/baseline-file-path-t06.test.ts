import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-06 (first half): a baseline row records the file it is about, from the evidence.
 *
 * `createBaselineForFindings` set `file_path` to `inferFilePathFromMessage(finding.message)`, which
 * splits the message on the literal `" imports "`. That substring appears in the data-access
 * message and in no other kind's, so every other kind stored its own PROSE where a path belongs.
 *
 * Measured on dub with both kinds accepted: data-access produced 326 real paths across 405 rows,
 * while the auth family's 87 rows collapsed to 5 distinct values, each one a sentence beginning
 * "This route". `drift baseline status --json` served those 87 sentences to agents as `file_path`.
 *
 * The finding already carries the answer - `evidence_refs[0].file_path` - and T-03 made the same
 * evidence carry the handler symbol. Nothing needed to be inferred from prose at all.
 *
 * Note this is descriptive, not identity: baseline rows are keyed by fingerprint, so correcting
 * the path changes what is DISPLAYED and grandfathers nothing differently.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CLEAN = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json({ ok: true });",
    "});",
    ""
  ].join("\n");

const DATA_ONLY = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    'import { prisma } from "@/lib/db";',
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json(await prisma.user.findMany());",
    "});",
    ""
  ].join("\n");

const AUTH_ONLY = "export async function POST() { return Response.json({ ok: true }); }\n";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function onboard(): Promise<{ repoId: string; databasePath: string; repoRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t06-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await writeFile(
    join(repoRoot, "lib/auth.ts"),
    [
      "export const withSession = (handler: unknown) => handler;",
      "export const withWorkspace = (handler: unknown) => handler;",
      ""
    ].join("\n")
  );
  await writeFile(
    join(repoRoot, "lib/db.ts"),
    "export const prisma = { user: { findMany: async () => [] } };\n"
  );

  const write = async (name: string, contents: string) => {
    const path = join(repoRoot, `app/api/${name}`);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "route.ts"), contents);
  };
  for (let index = 0; index < 25; index += 1) {
    await write(`clean${index}`, CLEAN(index % 2 === 0 ? "withSession" : "withWorkspace"));
  }
  for (let index = 0; index < 3; index += 1) {
    await write(`data${index}`, DATA_ONLY(index % 2 === 0 ? "withSession" : "withWorkspace"));
  }
  for (let index = 0; index < 2; index += 1) {
    await write(`auth${index}`, AUTH_ONLY);
  }

  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t06@drift.test", "-c", "user.name=t06", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--accept-families",
    "--now", "2026-08-14T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode, started.stdout).toBe(0);
  const payload = JSON.parse(started.stdout);
  return { repoId: payload.repo.id, databasePath: payload.state.database_path, repoRoot };
}

async function reviewItems(): Promise<{
  items: Array<{ file_path: string }>;
  repoRoot: string;
}> {
  const { repoId, databasePath, repoRoot } = await onboard();
  const status = await runCli([
    "--db", databasePath, "baseline", "status", "--repo", repoId, "--json"
  ]);
  expect(status.exitCode, status.stdout).toBe(0);
  const payload = JSON.parse(status.stdout);
  return { items: payload.review_items ?? [], repoRoot };
}

describe("baseline rows record a file, not a sentence", () => {
  it("stores a path that exists in the repo, for every kind", async () => {
    const { items, repoRoot } = await reviewItems();

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(
        existsSync(join(repoRoot, item.file_path)),
        `not a file in the repo: ${JSON.stringify(item.file_path)}`
      ).toBe(true);
    }
  }, 120_000);

  it("serves no prose where a path belongs", async () => {
    const { items } = await reviewItems();

    // The exact shape measured on dub: 87 rows whose file_path began "This route".
    for (const item of items) {
      expect(item.file_path.startsWith("This route")).toBe(false);
      expect(item.file_path).not.toContain(" ");
    }
  }, 120_000);

  it("distinguishes the files it baselined, rather than collapsing them", async () => {
    const { items } = await reviewItems();

    // On dub the auth family's 87 rows collapsed to 5 distinct prose values. Here every violating
    // route is its own file, so distinct paths must equal the number of violating files.
    const distinct = new Set(items.map((item) => item.file_path));
    expect(distinct.size).toBe(5);
  }, 120_000);
});
