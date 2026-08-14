import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { acceptanceDisclosureLines } from "../src/domain/acceptance-disclosure.js";
import { runCli } from "../src/index.js";

/**
 * T-05: when two conventions are accepted, each reports its OWN baseline count.
 *
 * `baselined_count` is a single total, and the disclosure prints it inside the sentence about the
 * primary convention. Measured on dub with both kinds accepted, the baseline holds 405 data-access
 * violations and 87 auth violations; the output said "(492 existing violations baselined)"
 * attributed to data-access, and gave the auth family no count at all.
 *
 * The total is not a useful number to anyone: the question a user has is how much of THIS
 * convention is grandfathered, because that is what decides whether the next check is quiet.
 *
 * The fixture makes the two counts differ on purpose. Equal counts would let an implementation
 * that reports the total twice pass.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const DATA_ACCESS_KIND = "api_route_no_direct_data_access";
const AUTH_KIND = "api_route_requires_auth_helper";

/** Wrapped, no data import: violates neither. */
const CLEAN = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json({ ok: true });",
    "});",
    ""
  ].join("\n");

/** Wrapped, but imports the data layer directly: violates data-access only. */
const DATA_ONLY = (wrapper: string) =>
  [
    `import { ${wrapper} } from "@/lib/auth";`,
    'import { prisma } from "@/lib/db";',
    `export const POST = ${wrapper}(async () => {`,
    "  return Response.json(await prisma.user.findMany());",
    "});",
    ""
  ].join("\n");

/** No wrapper, no data import: violates auth only. */
const AUTH_ONLY = "export async function POST() { return Response.json({ ok: true }); }\n";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

const DATA_ACCESS_VIOLATIONS = 3;
const AUTH_VIOLATIONS = 2;

async function onboardBothKinds(): Promise<{ stdout: string; exitCode: number }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-t05-"));
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

  // Enough clean wrapped routes to clear the presence evidence floor and form a family.
  for (let index = 0; index < 25; index += 1) {
    await write(`clean${index}`, CLEAN(index % 2 === 0 ? "withSession" : "withWorkspace"));
  }
  for (let index = 0; index < DATA_ACCESS_VIOLATIONS; index += 1) {
    await write(`data${index}`, DATA_ONLY(index % 2 === 0 ? "withSession" : "withWorkspace"));
  }
  for (let index = 0; index < AUTH_VIOLATIONS; index += 1) {
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
    ["-c", "user.email=t05@drift.test", "-c", "user.name=t05", "commit", "-qm", "fixture"],
    { cwd: repoRoot, stdio: "ignore" }
  );

  return runCli([
    "start",
    "--repo-root", repoRoot,
    "--state-root", stateRoot,
    "--accept-defaults",
    "--accept-families",
    "--now", "2026-08-14T00:00:30.000Z",
    "--json"
  ]);
}

describe("each accepted convention reports its own baseline count", () => {
  it("carries a per-kind breakdown in the payload", async () => {
    const result = await onboardBothKinds();
    expect(result.exitCode, result.stdout).toBe(0);
    const acceptance = JSON.parse(result.stdout).acceptance;

    // Both kinds were accepted, or the item under test is not exercised.
    const acceptedKinds = [
      acceptance.convention_kind,
      ...acceptance.also_accepted.map((entry: { convention_kind: string }) => entry.convention_kind)
    ];
    expect(acceptedKinds).toContain(DATA_ACCESS_KIND);
    expect(acceptedKinds).toContain(AUTH_KIND);

    // Today: no such field. One total, credited to whichever convention is primary.
    expect(acceptance.baselined_by_kind).toBeDefined();
    expect(acceptance.baselined_by_kind[DATA_ACCESS_KIND]).toBe(DATA_ACCESS_VIOLATIONS);
    expect(acceptance.baselined_by_kind[AUTH_KIND]).toBe(AUTH_VIOLATIONS);
  }, 120_000);

  it("does not credit one convention with another's violations", async () => {
    const result = await onboardBothKinds();
    const acceptance = JSON.parse(result.stdout).acceptance;
    const text = acceptanceDisclosureLines(acceptance).join("\n");

    // The total must not be the number attached to a single kind.
    const total = DATA_ACCESS_VIOLATIONS + AUTH_VIOLATIONS;
    expect(text).not.toContain(`${total} existing violations baselined`);
    // Each kind's own count appears on its own line.
    expect(text).toMatch(
      new RegExp(`${DATA_ACCESS_KIND}[\\s\\S]*?${DATA_ACCESS_VIOLATIONS} existing violation`)
    );
    expect(text).toMatch(new RegExp(`${AUTH_KIND}[\\s\\S]*?${AUTH_VIOLATIONS} existing violation`));
  }, 120_000);
});
