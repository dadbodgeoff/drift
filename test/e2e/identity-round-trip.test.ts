import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * EW-9. The identity round trip, including the CI shape - with local clones only.
 *
 * This is the test that would have caught the shallow-clone identity break, and it is what makes
 * the corrected T120 verdict verifiable. The earlier "T120 verified" was measured on a one-commit
 * repo, where HEAD *is* the root commit - so a shallow clone and a full clone derive the same
 * identity and the measurement could not distinguish a correct implementation from the bug. Every
 * repo built here therefore has **three** commits, which is the whole point: `--depth 1` then
 * grafts at a commit that is not the root, and identity derived from it disagrees.
 *
 * Four cases, and the fourth matters as much as the first three: over-refusal is its own defect. A
 * partial clone (`--filter=blob:none`) has the complete commit graph and only omits blobs, so it
 * must succeed. A refusal there would break exactly the CI setups that adopted partial clones to
 * make checkouts fast.
 *
 * No external service is involved anywhere - "the CI shape" is reproduced as a detached checkout of
 * a local clone, which is what a CI runner actually has.
 */

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * The shape `contract import --json` reports. The compatibility verdict lives under
 * `compatibility`, and `repo_fingerprint_matches` is the field that actually decides portability -
 * `repo_id` is derived from the absolute path and necessarily differs between two checkouts, which
 * is what T120 was about.
 */
interface ImportPayload {
  compatibility?: {
    compatible?: boolean;
    repo_fingerprint_matches?: boolean;
    reasons?: string[];
  };
}

const CLI = join(REPO_ROOT, "packages/cli/dist/main.js");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t"
    }
  }).trim();
}

interface Cli {
  run: (args: string[]) => { code: number; stdout: string; stderr: string };
  home: string;
}

function cliIn(cwd: string, home: string): Cli {
  return {
    home,
    run: (args) => {
      try {
        return {
          code: 0,
          stdout: execFileSync(process.execPath, [CLI, ...args], {
            cwd,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            env: { ...process.env, HOME: home, DRIFT_HOME: home, DRIFT_ENGINE_BIN: ENGINE }
          }),
          stderr: ""
        };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return {
          code: failure.status ?? 1,
          stdout: failure.stdout?.toString() ?? "",
          stderr: failure.stderr?.toString() ?? ""
        };
      }
    }
  };
}

/**
 * A source repository with a real history and a violating API route, so `start` infers a contract
 * worth exporting. Three commits, deliberately: with one, HEAD is the root commit and a shallow
 * clone cannot be distinguished from a full one.
 */
async function sourceRepo(options: { name?: string } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-identity-src-"));
  dirs.push(dir);
  git(dir, "init", "-q");
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: options.name ?? "identity-fixture", private: true })
  );
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } })
  );
  await mkdir(join(dir, "src/lib"), { recursive: true });
  await writeFile(
    join(dir, "src/lib/prisma.ts"),
    "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();\n"
  );
  await mkdir(join(dir, "src/services"), { recursive: true });
  await writeFile(
    join(dir, "src/services/users.ts"),
    "import { prisma } from '@/lib/prisma';\nexport async function listUsers() { return prisma.user.findMany(); }\n"
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "one");

  for (const name of ["clean1", "clean2", "clean3"]) {
    await mkdir(join(dir, "src/app/api", name), { recursive: true });
    await writeFile(
      join(dir, "src/app/api", name, "route.ts"),
      'import { listUsers } from "@/services/users";\n\nexport async function GET() {\n  return Response.json(await listUsers());\n}\n'
    );
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "two");

  await mkdir(join(dir, "src/app/api/legacy"), { recursive: true });
  await writeFile(
    join(dir, "src/app/api/legacy/route.ts"),
    'import { prisma } from "@/lib/prisma";\n\nexport async function GET() {\n  return Response.json(await prisma.user.findMany());\n}\n'
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "three");

  // A shared remote URL is what makes identity portable across checkouts. Cloning from a local
  // path records the path as origin, which is not portable - so set the same canonical remote on
  // every checkout, exactly as two developers cloning from the same host would have.
  git(dir, "remote", "add", "origin", "https://example.invalid/acme/identity-fixture.git");
  return dir;
}

/** A checkout, in the shape CI produces: detached HEAD at a commit, not on a branch. */
async function detachedCheckout(
  source: string,
  options: { depth?: number; filterBlobs?: boolean } = {}
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-identity-checkout-"));
  dirs.push(dir);
  const args = ["clone", "-q"];
  if (options.depth) {
    // `--no-local` is required, not optional: cloning from a local path uses the hardlink
    // transport, which ignores `--depth` entirely and silently produces a full clone. Without it
    // the shallow case would test nothing and pass.
    args.push("--depth", String(options.depth), "--no-local");
  }
  if (options.filterBlobs) {
    // A partial clone: the full commit graph, blobs fetched on demand. This is the shape that must
    // NOT be refused. `--no-local` again, for the same transport reason.
    args.push("--filter=blob:none", "--no-local");
  }
  args.push(source, dir);
  execFileSync("git", args, { stdio: "ignore" });
  git(dir, "remote", "set-url", "origin", "https://example.invalid/acme/identity-fixture.git");
  const head = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "--detach", head);
  return dir;
}

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "drift-identity-home-"));
  dirs.push(home);
  return home;
}

/** Onboard a checkout and export its contract to a file. */
async function exportedContract(checkout: string): Promise<string> {
  const cli = cliIn(checkout, await freshHome());
  const started = cli.run(["start", "--repo-root", ".", "--accept-defaults", "--json"]);
  expect(started.code, started.stdout.slice(0, 600)).toBe(0);
  const repoId = JSON.parse(started.stdout).repo.id as string;
  const output = join(checkout, "drift.lock.json");
  const exported = cli.run([
    "--db", join(cli.home, ".drift/repos", repoId, "drift.sqlite"),
    "contract", "export", "--repo", repoId, "--output", output, "--confirm", "--json"
  ]);
  expect(exported.code, exported.stdout.slice(0, 600)).toBe(0);
  return output;
}

/** Onboard a checkout, then import the given contract into it. */
function importInto(checkout: string, home: string, contractPath: string) {
  const cli = cliIn(checkout, home);
  const started = cli.run(["start", "--repo-root", ".", "--accept-defaults", "--json"]);
  if (started.code !== 0) {
    // A refusal during onboarding is itself a valid outcome for the shallow case: identity cannot
    // be derived, so there is nothing to import into. Return it rather than asserting here.
    return { stage: "start" as const, ...started };
  }
  const repoId = JSON.parse(started.stdout).repo.id as string;
  const imported = cli.run([
    "--db", join(home, ".drift/repos", repoId, "drift.sqlite"),
    // The contract file is a positional argument, not a flag.
    "contract", "import", contractPath, "--repo", repoId, "--confirm", "--json"
  ]);
  return { stage: "import" as const, ...imported };
}

describe("identity round trip", () => {
  it("imports a contract exported from one full clone into another, checked out detached", async () => {
    const source = await sourceRepo();
    const author = await detachedCheckout(source);
    const contract = await exportedContract(author);

    // A different full clone of the same repository, detached at the same commit - the CI shape.
    const ci = await detachedCheckout(source);
    await writeFile(join(ci, "drift.lock.json"), await readFileText(contract));

    const result = importInto(ci, await freshHome(), join(ci, "drift.lock.json"));

    expect(result.stage).toBe("import");
    expect(result.code, result.stdout.slice(0, 900)).toBe(0);
    const payload = JSON.parse(result.stdout) as ImportPayload;
    expect(
      payload.compatibility?.compatible,
      "two full checkouts of one repository are the same repo; a committed contract must travel"
    ).toBe(true);
    expect(payload.compatibility?.reasons ?? []).toEqual([]);
    expect(
      payload.compatibility?.repo_fingerprint_matches,
      "and it matches on the portable fingerprint, not on the path-derived repo id"
    ).toBe(true);
  }, 300_000);

  it("refuses a shallow checkout with the X-1 remediation instead of deriving a wrong identity", async () => {
    const source = await sourceRepo();
    const author = await detachedCheckout(source);
    const contract = await exportedContract(author);

    const shallow = await detachedCheckout(source, { depth: 1 });
    expect(
      git(shallow, "rev-parse", "--is-shallow-repository"),
      "the checkout must actually be shallow, or this test proves nothing"
    ).toBe("true");
    await writeFile(join(shallow, "drift.lock.json"), await readFileText(contract));

    const result = importInto(shallow, await freshHome(), join(shallow, "drift.lock.json"));

    expect(result.code, "a shallow clone must refuse, not guess").toBe(3);
    const output = `${result.stdout}${result.stderr}`;
    expect(
      output,
      "a refusal a user cannot act on is barely better than a wrong answer"
    ).toMatch(/shallow/i);
    expect(output).toMatch(/fetch|unshallow|depth/i);
  }, 300_000);

  it("still refuses a contract from a different repository", async () => {
    const source = await sourceRepo({ name: "identity-fixture" });
    const author = await detachedCheckout(source);
    const contract = await exportedContract(author);

    // A genuinely different repository: its own history and its own remote.
    const foreign = await sourceRepo({ name: "other-fixture" });
    git(foreign, "remote", "set-url", "origin", "https://example.invalid/acme/other-fixture.git");
    const foreignCheckout = await detachedCheckout(foreign);
    git(foreignCheckout, "remote", "set-url", "origin", "https://example.invalid/acme/other-fixture.git");
    await writeFile(join(foreignCheckout, "drift.lock.json"), await readFileText(contract));

    const result = importInto(foreignCheckout, await freshHome(), join(foreignCheckout, "drift.lock.json"));

    const payload = result.stdout ? safeJson(result.stdout) : null;
    const reasons = (payload?.compatibility?.reasons ?? []) as string[];
    expect(
      result.code !== 0 || reasons.length > 0,
      `a foreign contract must not import cleanly: ${result.stdout.slice(0, 600)}`
    ).toBe(true);
    if (reasons.length > 0) {
      expect(reasons.join(" ")).toMatch(/fingerprint_mismatch|repo_id_mismatch/);
    }
  }, 300_000);

  it("accepts a partial clone with full history - the over-refusal guard", async () => {
    const source = await sourceRepo();
    const author = await detachedCheckout(source);
    const contract = await exportedContract(author);

    const partial = await detachedCheckout(source, { filterBlobs: true });
    expect(
      git(partial, "rev-parse", "--is-shallow-repository"),
      "a partial clone is not shallow: it has every commit, only blobs are lazy"
    ).toBe("false");
    await writeFile(join(partial, "drift.lock.json"), await readFileText(contract));

    const result = importInto(partial, await freshHome(), join(partial, "drift.lock.json"));

    expect(
      result.code,
      `a partial clone must not be refused - that would break the CI setups that use it: ${result.stdout.slice(0, 900)}`
    ).toBe(0);
    const payload = JSON.parse(result.stdout) as ImportPayload;
    expect(payload.compatibility?.compatible).toBe(true);
    expect(payload.compatibility?.repo_fingerprint_matches).toBe(true);
  }, 300_000);
});

async function readFileText(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

function safeJson(text: string): ImportPayload | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
