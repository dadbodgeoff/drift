import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

/**
 * T-03: a presence finding must name the handler it is about, in a field.
 *
 * Presence is enforced per HANDLER - a `route.ts` exporting `GET` and `POST` is two independent
 * endpoints, and the engine already treats them separately: the handler name is in the finding
 * fingerprint (check_command.rs) and in the message prose ("This route's PUT handler ...").
 *
 * It was in no structured field. Measured on dub with `requires_auth_helper` accepted, all 87
 * findings carried `evidence_refs[0].symbol = null`, while data-access findings carried
 * `symbol = "prisma"`. The schema field existed and was simply never populated on this path.
 *
 * That matters beyond tidiness because T-06 keys per-handler baseline identity on
 * `(kind, file_path, symbol)`. Without a symbol, two unguarded handlers in one file are
 * indistinguishable to the baseline, and grandfathering one would grandfather both.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Two interchangeable wrappers over four routes, so an auth family forms and is proposed. */
const WRAPPED = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json({ ok: true });",
    "});",
    ""
  ].join("\n");

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function onboard(): Promise<{ repoId: string; databasePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t03-"));
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

  // TWO unwrapped handlers in ONE file. This is the shape the test exists for: file_path alone
  // cannot tell these two findings apart, so if the symbol is absent they are one finding as far
  // as any downstream identity is concerned.
  await mkdir(join(repoRoot, "app/api/naked"), { recursive: true });
  await writeFile(
    join(repoRoot, "app/api/naked/route.ts"),
    [
      "export async function GET() { return Response.json({ ok: true }); }",
      "export async function POST() { return Response.json({ ok: true }); }",
      ""
    ].join("\n")
  );

  for (const [path, wrapper] of [
    ["app/api/a/route.ts", "withSession"],
    ["app/api/b/route.ts", "withSession"],
    ["app/api/c/route.ts", "withWorkspace"],
    ["app/api/d/route.ts", "withWorkspace"]
  ] as const) {
    await mkdir(join(repoRoot, path, ".."), { recursive: true });
    await writeFile(join(repoRoot, path), WRAPPED(wrapper));
  }
  await writeFile(
    join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } })
  );
  git(repoRoot, "init", "-q");
  git(repoRoot, "add", "-A");
  execFileSync(
    "git",
    ["-c", "user.email=t03@drift.test", "-c", "user.name=t03", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  const started = await runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--now", "2026-08-14T00:00:30.000Z",
    "--json"
  ]);
  expect(started.exitCode, started.stdout).toBe(0);
  const payload = JSON.parse(started.stdout);
  return { repoId: payload.repo.id, databasePath: payload.state.database_path };
}

async function presenceFindings(): Promise<Array<{
  message: string;
  evidence_refs: Array<{ file_path: string; symbol?: string | null }>;
}>> {
  const { repoId, databasePath } = await onboard();
  const listed = JSON.parse(
    (await runCli([
      "--db", databasePath, "conventions", "list", "--repo", repoId,
      "--include-low-confidence", "--json"
    ])).stdout
  );
  const family = listed.candidates.find(
    (candidate: { kind: string; matcher: { required_calls?: string[] } }) =>
      candidate.kind === "api_route_requires_auth_helper" &&
      (candidate.matcher.required_calls ?? []).length > 1
  );
  expect(family, "no auth presence family was proposed").toBeDefined();

  const accepted = await runCli([
    "--db", databasePath, "conventions", "accept", family.id,
    "--repo", repoId, "--mode", "warn", "--severity", "warning",
    "--actor", "t03", "--confirm", "--json"
  ]);
  expect(accepted.exitCode, accepted.stdout).toBe(0);

  const checked = await runCli([
    "--db", databasePath, "check", "--repo", repoId, "--scope", "full", "--json"
  ]);
  const conventionId = `convention_${family.id.replace(/^candidate_/, "")}`;
  return (JSON.parse(checked.stdout).findings ?? []).filter(
    (finding: { convention_id: string }) => finding.convention_id === conventionId
  );
}

describe("presence findings name their handler in a field", () => {
  it("carries the handler symbol on the violation evidence", async () => {
    const findings = await presenceFindings();

    expect(findings.length).toBe(2);
    for (const finding of findings) {
      expect(finding.evidence_refs[0].file_path).toBe("app/api/naked/route.ts");
      // Today: undefined on every presence finding. The name exists only inside the prose.
      expect(
        finding.evidence_refs[0].symbol,
        `no symbol on: ${finding.message}`
      ).toBeTruthy();
    }
  }, 90_000);

  it("distinguishes two unguarded handlers in one file", async () => {
    const findings = await presenceFindings();

    // The point of the field: file_path is identical for both, so the symbol is the only thing
    // that tells these two endpoints apart.
    const symbols = findings.map((finding) => finding.evidence_refs[0].symbol).sort();
    expect(symbols).toEqual(["GET", "POST"]);
  }, 90_000);
});
