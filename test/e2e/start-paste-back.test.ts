import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";

/**
 * Paste the block `drift start` prints, and every line has to work.
 *
 * It did not. `resolveDatabasePath` derives the default state path for the commands that create it
 * (`init`, `scan`, `start`), for the two readers the quickstart runs (`check`, `prepare`), and for
 * anything carrying `--repo-root`/`--state-root`. Onboarding printed seven commands, and
 * `contract show`, `baseline status` and `backup create` matched none of those cases: three of
 * seven answered `Missing --db <path> or DRIFT_DB. Run drift --help.` and exited 1, with the
 * database sitting exactly where the two lines above them said it was.
 *
 * This is the first thing a new user does with Drift, so it is tested the way they do it: run
 * `start`, take the printed lines verbatim, run them, require exit 0 from every one.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * Split a printed command the way a shell would: whitespace separates, double quotes group.
 *
 * `drift prepare "task" ...` is printed with the quotes, and a reader pasting it into a terminal
 * gets one argument. Splitting on whitespace alone would hand the CLI a different argv than the
 * user's shell does, which would make this test agree with a build that is broken for humans.
 */
function shellTokens(command: string): string[] {
  return (command.match(/"[^"]*"|\S+/g) ?? []).map((token) =>
    token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token
  );
}

function printedCommands(stdout: string): string[] {
  const lines = stdout.split("\n");
  const heading = lines.indexOf("Next commands:");
  expect(heading).toBeGreaterThan(-1);
  return lines
    .slice(heading + 1)
    .filter((line) => line.startsWith("  ") && line.trim().length > 0)
    .map((line) => line.trim());
}

async function onboardedRepo(): Promise<{ repoRoot: string; stateRoot: string; home: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-paste-back-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  const home = join(dir, "home");
  await mkdir(home, { recursive: true });

  await mkdir(join(repoRoot, "lib"), { recursive: true });
  await mkdir(join(repoRoot, "services"), { recursive: true });
  await writeFile(join(repoRoot, "lib/prisma.ts"), "export const prisma = {} as never;\n");
  await writeFile(join(repoRoot, "services/users.ts"), "export const listUsers = async () => [];\n");
  await mkdir(join(repoRoot, "app/api/legacy"), { recursive: true });
  await writeFile(
    join(repoRoot, "app/api/legacy/route.ts"),
    [
      'import { prisma } from "@/lib/prisma";',
      "export async function GET() {",
      "  return Response.json(await prisma.user.findMany());",
      "}",
      ""
    ].join("\n")
  );
  await writeFile(join(repoRoot, "package.json"), '{"name":"paste-back","version":"1.0.0"}\n');

  git(repoRoot, "init", "--initial-branch=main");
  git(repoRoot, "add", ".");
  git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init");

  // A branch with a commit on it, because `--diff main...HEAD` is one of the printed commands and
  // an empty range is a refusal (exit 3) by design - BB-1. The added route conforms, so the check
  // passes whether the accepted convention landed warn or block.
  git(repoRoot, "checkout", "-b", "feature");
  await mkdir(join(repoRoot, "app/api/new"), { recursive: true });
  await writeFile(
    join(repoRoot, "app/api/new/route.ts"),
    [
      'import { listUsers } from "@/services/users";',
      "export async function GET() {",
      "  return Response.json(await listUsers());",
      "}",
      ""
    ].join("\n")
  );
  git(repoRoot, "add", ".");
  git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "add a conforming route");

  return { repoRoot, stateRoot, home };
}

async function withHome<T>(home: string, body: () => Promise<T>): Promise<T> {
  // `backup create` writes under `~/.drift/backups`. Pointing HOME at the fixture keeps the test
  // from depositing artifacts in the developer's own state directory.
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    return await body();
  } finally {
    if (previous === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previous;
    }
  }
}

describe("the command block drift start prints", () => {
  it("runs verbatim, every line, exit 0", async () => {
    const { repoRoot, stateRoot, home } = await onboardedRepo();

    await withHome(home, async () => {
      const started = await runCli([
        "start",
        "--repo-root", repoRoot,
        "--state-root", stateRoot,
        "--accept-defaults",
        "--now", "2026-05-10T00:00:00.000Z"
      ]);
      expect(started.exitCode).toBe(0);

      const commands = printedCommands(started.stdout);
      // Guard against the block silently emptying out - a paste-back test over zero commands is a
      // test that passes by describing nothing.
      expect(commands.length).toBe(7);

      for (const command of commands) {
        const tokens = shellTokens(command);
        expect(tokens[0]).toBe("drift");
        const result = await runCli(tokens.slice(1));
        expect(result.exitCode, `${command}\n${result.stdout}${result.stderr}`).toBe(0);
      }
    });
  }, 300_000);

  it("fails the way it used to when the database is not named", async () => {
    // The control. Without `--db` these commands match no case `resolveDatabasePath` derives, and
    // the failure they produce - `missing_database`, exit 1 - is the one users hit. If this ever
    // starts passing, the derivation changed and the test above is no longer measuring anything.
    const { repoRoot, stateRoot, home } = await onboardedRepo();

    await withHome(home, async () => {
      const started = await runCli([
        "start",
        "--repo-root", repoRoot,
        "--state-root", stateRoot,
        "--accept-defaults",
        "--now", "2026-05-10T00:00:00.000Z"
      ]);
      const repoId = started.stdout.match(/--repo (repo_[a-f0-9]+)/)?.[1];
      expect(repoId).toBeTruthy();

      for (const argv of [
        ["contract", "show", "--repo", repoId!],
        ["baseline", "status", "--repo", repoId!],
        ["backup", "create", "--repo", repoId!, "--confirm"]
      ]) {
        const result = await runCli([...argv, "--json"]);
        expect(result.exitCode, argv.join(" ")).toBe(1);
        expect(JSON.parse(result.stdout).failure.code, argv.join(" ")).toBe("missing_database");
      }
    });
  }, 300_000);
});
