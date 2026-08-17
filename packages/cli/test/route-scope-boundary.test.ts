import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";
import { noCandidateTextForTest } from "../src/commands/start.js";

/**
 * Drift's route detection is Next.js-only, and the CLI said so nowhere.
 *
 * `isNextApiRoutePath` recognises app-router `**\/app/**\/route.*` and pages-router
 * `**\/pages/api/**`, and nothing else - it is the same predicate `conventionScopeFiles` and the
 * engine use, so it decides what can be enforced at all. On an Express, Fastify, NestJS or
 * SvelteKit repo the scan indexes files and stores facts normally, then proposes zero candidates,
 * and the only thing reported was `onboarding.status: "needs_more_signal"` - which reads as "scan
 * harder". Scanning harder is exactly what cannot help.
 *
 * Worse in the common case: an Express repo that also uses Prisma reaches the F4 data-layer
 * discovery branch and is handed `drift start ... --data-modules "db"`, an instruction that costs
 * a full rescan and produces zero candidates again.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function expressRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-express-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");

  await mkdir(join(repoRoot, "src/routes"), { recursive: true });
  await mkdir(join(repoRoot, "src/db"), { recursive: true });
  await writeFile(
    join(repoRoot, "src/db/client.ts"),
    ['import { PrismaClient } from "@prisma/client";', "export const db = new PrismaClient();", ""].join("\n")
  );
  // The shape the boundary hides: a router handler reaching the database directly. Drift would
  // have an opinion about this file if it recognised it as a route. It does not.
  await writeFile(
    join(repoRoot, "src/routes/users.ts"),
    [
      'import { Router } from "express";',
      'import { db } from "../db/client";',
      "export const users = Router();",
      'users.get("/users", async (_req, res) => res.json(await db.user.findMany()));',
      ""
    ].join("\n")
  );
  await writeFile(
    join(repoRoot, "src/server.ts"),
    ['import express from "express";', 'import { users } from "./routes/users";', "express().use(users).listen(3000);", ""].join("\n")
  );
  await writeFile(
    join(repoRoot, "package.json"),
    JSON.stringify(
      { name: "express-api", version: "1.0.0", dependencies: { express: "^4.19.0", "@prisma/client": "^5.0.0" } },
      null,
      2
    ) + "\n"
  );
  git(repoRoot, "init");
  git(repoRoot, "add", ".");
  git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init");
  return repoRoot;
}

describe("onboarding an Express-shaped repo", () => {
  it("names the Next.js route boundary instead of asking for more signal", async () => {
    const repoRoot = await expressRepo();
    const dir = join(repoRoot, "..");

    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", join(dir, "state"),
      "--accept-defaults",
      "--now", "2026-05-10T00:00:00.000Z"
    ]);
    expect(started.exitCode).toBe(0);

    // The premise: files were indexed and facts were stored, and still nothing was proposed.
    expect(started.stdout).toContain("Found 0 convention candidates.");
    expect(started.stdout).not.toContain("Stored 0 facts.");

    // The boundary, named: what is supported, and that this is a scope limit rather than a
    // property of the user's repo.
    expect(started.stdout).toContain("No API routes were found");
    expect(started.stdout).toContain("Next.js API routes only");
    expect(started.stdout).toContain("**/app/**/route.{ts,tsx,js,jsx}");
    expect(started.stdout).toContain("**/pages/api/**");
    expect(started.stdout).toContain("Express");
    expect(started.stdout).toContain("That is a scope limit, not a property of your repo.");

    // And does NOT hand the user the data-modules instruction. This repo declares Prisma and wraps
    // it in `src/db/client.ts`, which is exactly the F4 discovery shape - the suggestion is
    // well-formed and useless, because the rescan it asks for still has no route to enforce on.
    expect(started.stdout).not.toContain("--data-modules");
  }, 120_000);

  it("still reports needs_more_signal in JSON, so the human text is where the boundary is said", async () => {
    const repoRoot = await expressRepo();
    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", join(repoRoot, "..", "state"),
      "--accept-defaults",
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(started.stdout);
    expect(payload.onboarding.status).toBe("needs_more_signal");
    expect(payload.onboarding.candidate_count).toBe(0);
    expect(payload.summary.files_indexed).toBeGreaterThan(0);
    expect(payload.summary.facts_count).toBeGreaterThan(0);
  }, 120_000);
});

describe("noCandidateText", () => {
  it("checks the route boundary before the data-layer suggestion", () => {
    const discovery = {
      declaredPackages: ["@prisma/client"],
      suggestions: [
        { filePath: "src/db/client.ts", packageName: "@prisma/client", importedAs: ["db"], routeImporterCount: 0 }
      ]
    };
    expect(noCandidateTextForTest(discovery, { apiRouteFileCount: 0 })).toContain("No API routes were found");
    // With routes present the F4 message is the right one and must be untouched.
    expect(noCandidateTextForTest(discovery, { apiRouteFileCount: 3 })).toContain("--data-modules");
  });

  it("leaves the message alone when the caller says nothing about route scope", () => {
    // The second call site - the data-layer gap printed alongside an inferred candidate - passes no
    // route scope, and must keep behaving as it did.
    expect(noCandidateTextForTest()).toBe("No enforceable convention candidates found yet.");
  });
});
