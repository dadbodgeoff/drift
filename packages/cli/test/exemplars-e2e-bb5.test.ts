import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import { runCli } from "../src/index.js";

/**
 * BB-5, end to end: the exemplars a real check and a real packet actually emit.
 *
 * The unit tests pin the selector; these pin the wiring, which is where the invariant can be lost -
 * a correct selector fed the wrong violation set still cites violators.
 *
 * The fixture is built in dub's shape deliberately: the two files nearest the flagged route are
 * *also* violators, so a selector that ranked purely by path distance would cite them and reproduce
 * the trial-B1 defection.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const violating = (symbol: string) => [
  `import { ${symbol} } from "@/lib/prisma";`,
  "export async function POST() {",
  `  return Response.json(await ${symbol}.user.findMany());`,
  "}",
  ""
].join("\n");

const conforming = [
  'import { listUsers } from "@/lib/services/users";',
  "export async function GET() {",
  "  return Response.json(await listUsers());",
  "}",
  ""
].join("\n");

async function onboard(): Promise<{ repoId: string; databasePath: string; repoRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-bb5-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");

  await mkdir(join(repoRoot, "lib/services"), { recursive: true });
  await writeFile(join(repoRoot, "lib/prisma.ts"), "export const prisma = {} as never;\n");
  await writeFile(
    join(repoRoot, "lib/services/users.ts"),
    'import { prisma } from "@/lib/prisma";\nexport async function listUsers() { return prisma; }\n'
  );

  // Violators clustered together, conforming routes further away: the dub invite-routes shape.
  for (const [path, source] of [
    ["app/api/workspaces/invites/route.ts", violating("prisma")],
    ["app/api/workspaces/invites/accept/route.ts", violating("prisma")],
    ["app/api/workspaces/invites/resend/route.ts", violating("prisma")],
    ["app/api/health/route.ts", conforming],
    ["app/api/status/route.ts", conforming],
    ["app/api/ping/route.ts", conforming],
    ["app/api/version/route.ts", conforming]
  ] as const) {
    await mkdir(join(repoRoot, path, ".."), { recursive: true });
    await writeFile(join(repoRoot, path), source);
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-08-03T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode).toBe(0);
  const payload = JSON.parse(started.stdout);
  return { repoId: payload.repo.id, databasePath: payload.state.database_path, repoRoot };
}

describe("BB-5 exemplars end to end", () => {
  it("attaches conforming exemplars to findings, and never a violator", async () => {
    const { repoId, databasePath } = await onboard();

    const checked = await runCli([
      "--db", databasePath,
      "check",
      "--repo", repoId,
      "--scope", "full",
      "--json"
    ]);
    const payload = JSON.parse(checked.stdout);
    expect(payload.findings.length).toBeGreaterThan(0);

    const violatingPaths = new Set<string>(
      payload.findings.flatMap((finding: { evidence_refs: Array<{ file_path: string }> }) =>
        finding.evidence_refs.map((ref) => ref.file_path)
      )
    );

    for (const finding of payload.findings) {
      const examples: Array<{ file_path: string }> = finding.conforming_examples ?? [];
      expect(examples.length).toBeGreaterThan(0);
      expect(examples.length).toBeLessThanOrEqual(3);
      for (const example of examples) {
        // The invariant, asserted against the run's own finding set.
        expect(violatingPaths.has(example.file_path)).toBe(false);
      }
    }
  });

  it("carries the migration sentence on findings once violations are baselined", async () => {
    const { repoId, databasePath } = await onboard();

    const checked = await runCli([
      "--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"
    ]);
    const payload = JSON.parse(checked.stdout);
    const messages: string[] = payload.findings.map((finding: { message: string }) => finding.message);

    // `start --accept-defaults` baselined the three pre-existing violations, so the sentence applies
    // and says so with live counts.
    expect(messages.some((message) => /existing violations? (is|are) baselined/.test(message))).toBe(true);
    expect(messages.some((message) => message.includes("new code is held to this rule"))).toBe(true);
  });

  it("puts exemplars, the rationale split, and the sentence in the packet - within 4 KB per entry", async () => {
    const { repoId, databasePath } = await onboard();
    await runCli(["--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"]);

    const prepared = await runCli([
      "--db", databasePath,
      "prepare", "add an endpoint that lists workspace invites",
      "--repo", repoId,
      "--json"
    ]);
    expect(prepared.exitCode).toBe(0);
    const packet = JSON.parse(prepared.stdout);
    const conventions = packet.task_preflight_packet?.accepted_conventions ?? packet.accepted_conventions;
    expect(Array.isArray(conventions)).toBe(true);

    const entry = conventions.find(
      (convention: { kind: string }) => convention.kind === "api_route_no_direct_data_access"
    );
    expect(entry).toBeTruthy();
    expect(Array.isArray(entry.conforming_examples)).toBe(true);
    // Empty-with-reason, never a bare [].
    if (entry.conforming_examples.length === 0) {
      expect(entry.conforming_examples_reason).toBeTruthy();
    } else {
      expect(entry.conforming_examples_reason).toBeNull();
    }
    expect(entry.rationale).toMatchObject({ reason: expect.stringContaining("Route modules are transport") });
    expect(entry.migration_sentence).toContain("new code is held to this rule");

    // EW-8's lesson: only a byte assertion forces a real fix. Adding exemplars must not let the
    // conventions entry regrow into an evidence dump.
    const bytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    expect(bytes).toBeLessThan(4096);
  });

  it("emits no exemplars, with a reason, when every file in scope violates", async () => {
    // The negative control at the wiring level: a repo where nothing conforms must never manufacture
    // an example, and must say why it has none.
    const dir = await mkdtemp(join(tmpdir(), "drift-bb5-none-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    const stateRoot = join(dir, "state");
    await mkdir(join(repoRoot, "lib"), { recursive: true });
    await writeFile(join(repoRoot, "lib/prisma.ts"), "export const prisma = {} as never;\n");
    for (const path of ["app/api/a/route.ts", "app/api/b/route.ts"]) {
      await mkdir(join(repoRoot, path, ".."), { recursive: true });
      await writeFile(join(repoRoot, path), violating("prisma"));
    }
    await writeFile(
      join(repoRoot, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
    );

    const started = await runCli([
      "start", "--repo-root", repoRoot, "--state-root", stateRoot,
      "--accept-defaults", "--now", "2026-08-03T00:00:30.000Z", "--json"
    ]);
    const startPayload = JSON.parse(started.stdout);
    const repoId = startPayload.repo.id;
    const databasePath = startPayload.state.database_path;
    await runCli(["--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"]);

    const prepared = await runCli([
      "--db", databasePath, "prepare", "add an endpoint", "--repo", repoId, "--json"
    ]);
    const packet = JSON.parse(prepared.stdout);
    const conventions = packet.task_preflight_packet?.accepted_conventions ?? packet.accepted_conventions;
    const entry = conventions.find(
      (convention: { kind: string }) => convention.kind === "api_route_no_direct_data_access"
    );
    if (entry) {
      expect(entry.conforming_examples).toEqual([]);
      expect(entry.conforming_examples_reason).toBe("no_conforming_examples");
    }

    const storage = openDriftStorage({ databasePath });
    for (const finding of storage.listFindings(repoId)) {
      // Never a violator, and never an invented example.
      expect(finding.conforming_examples ?? []).toEqual([]);
    }
    storage.close();
  });
});
