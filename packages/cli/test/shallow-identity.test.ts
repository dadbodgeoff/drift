import { openDriftStorage } from "@drift/storage";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDriftError } from "../src/app/drift-error.js";
import { repoIdForRoot } from "../src/domain/identifiers.js";
import { repoIdentityFor } from "../src/domain/repo-identity.js";
import { runCli } from "../src/index.js";

/**
 * X-1 (B-5, decision D-4): a shallow clone reports the graft as its root commit, so an identity
 * derived from it silently disagrees with every full checkout - the developer exports a
 * drift.lock CI can never import, and nothing ever says why. Refuse, don't guess: identity
 * derivation fails closed with exit 3 and the remediation, at the one seam every command shares.
 *
 * Two boundaries pinned here because over-refusal is its own defect:
 * - a partial clone (`--filter=blob:none`) has the full commit graph and MUST pass;
 * - a directory with no git at all keeps the honest absolute_path fallback - only shallowness
 *   lies about identity; absence of git merely narrows it.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "drift-test",
      GIT_AUTHOR_EMAIL: "drift-test@example.invalid",
      GIT_COMMITTER_NAME: "drift-test",
      GIT_COMMITTER_EMAIL: "drift-test@example.invalid"
    }
  });
}

let workDir: string;
let sourceRepo: string;
let shallowClone: string;
let partialClone: string;
let fullClone: string;
let noGitDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "drift-x1-"));
  sourceRepo = join(workDir, "src");
  shallowClone = join(workDir, "depth1");
  partialClone = join(workDir, "partial");
  fullClone = join(workDir, "full");
  noGitDir = join(workDir, "nogit");

  git(workDir, "init", "--initial-branch=main", sourceRepo);
  writeFileSync(join(sourceRepo, "package.json"), JSON.stringify({ name: "x1-fixture" }));
  writeFileSync(join(sourceRepo, "route.ts"), "export const GET = () => new Response('one');\n");
  git(sourceRepo, "add", ".");
  git(sourceRepo, "commit", "-m", "first");
  writeFileSync(join(sourceRepo, "route.ts"), "export const GET = () => new Response('two');\n");
  git(sourceRepo, "add", ".");
  git(sourceRepo, "commit", "-m", "second");
  git(sourceRepo, "config", "uploadpack.allowFilter", "true");
  git(sourceRepo, "remote", "add", "origin", "https://example.invalid/acme/x1-fixture.git");

  // file:// is required: plain local paths use hardlink transport, which ignores --depth/--filter.
  git(workDir, "clone", "--depth", "1", `file://${sourceRepo}`, shallowClone);
  git(workDir, "clone", "--filter=blob:none", `file://${sourceRepo}`, partialClone);
  git(workDir, "clone", `file://${sourceRepo}`, fullClone);
  // Clones of a local path get the path as origin; pin all three to the same logical remote so
  // the test measures shallowness, not remote-URL differences.
  for (const clone of [shallowClone, partialClone, fullClone]) {
    git(clone, "remote", "set-url", "origin", "https://example.invalid/acme/x1-fixture.git");
  }
  execFileSync("mkdir", ["-p", noGitDir]);
  writeFileSync(join(noGitDir, "package.json"), JSON.stringify({ name: "no-git-pkg" }));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("fixtures measure what they claim", () => {
  it("depth-1 is shallow; partial and full are not", () => {
    expect(git(shallowClone, "rev-parse", "--is-shallow-repository").trim()).toBe("true");
    expect(git(partialClone, "rev-parse", "--is-shallow-repository").trim()).toBe("false");
    expect(git(fullClone, "rev-parse", "--is-shallow-repository").trim()).toBe("false");
  });
});

describe("repoIdentityFor refuses shallow clones (D-4)", () => {
  it("fails closed with exit 3, the shallow_clone code, and the remediation", () => {
    let caught: unknown;
    try {
      repoIdentityFor(shallowClone);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(isDriftError(caught)).toBe(true);
    if (!isDriftError(caught)) {
      return;
    }
    expect(caught.code).toBe("shallow_clone");
    expect(caught.exitCode).toBe(3);
    expect(caught.message).toContain("shallow");
    expect(caught.message).toContain("fetch-depth: 0");
    expect(caught.message).toContain("git fetch --unshallow");
  });

  it("derives identical identity for a partial clone and a full clone (no over-refusal)", () => {
    const partial = repoIdentityFor(partialClone);
    const full = repoIdentityFor(fullClone);
    expect(partial.source).toBe("git_remote");
    expect(partial.id).toBe(full.id);
  });

  it("keeps the absolute_path fallback for a directory with no git", () => {
    const identity = repoIdentityFor(noGitDir);
    expect(identity.source).toBe("absolute_path");
    expect(identity.id).toMatch(/^repo_/);
  });
});

describe("identity-deriving commands refuse before writing any repo state", () => {
  it("drift start on a shallow clone exits 3 and registers no repo", async () => {
    const databasePath = join(workDir, "state-start", "drift.sqlite");
    const result = await runCli([
      "--db", databasePath,
      "start",
      "--repo-root", shallowClone,
      "--accept-defaults",
      "--json"
    ]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("shallow");
    expect(result.stderr).toContain("fetch-depth: 0");
    expect(result.stderr).toContain("git fetch --unshallow");
    // Fail closed means no wrong-identity record persisted - the silent path B-5 rode in on.
    if (existsSync(databasePath)) {
      const storage = openDriftStorage({ databasePath });
      try {
        expect(storage.getRepo(repoIdForRoot(shallowClone))).toBeUndefined();
      } finally {
        storage.close();
      }
    }
  });

  it("drift scan on a shallow clone exits 3 and registers no repo", async () => {
    const databasePath = join(workDir, "state-scan", "drift.sqlite");
    const result = await runCli([
      "--db", databasePath,
      "scan",
      "--repo-root", shallowClone,
      "--json"
    ]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("git fetch --unshallow");
    if (existsSync(databasePath)) {
      const storage = openDriftStorage({ databasePath });
      try {
        expect(storage.getRepo(repoIdForRoot(shallowClone))).toBeUndefined();
      } finally {
        storage.close();
      }
    }
  });

  it("drift start on a partial clone proceeds past identity derivation", async () => {
    const databasePath = join(workDir, "state-partial", "drift.sqlite");
    const result = await runCli([
      "--db", databasePath,
      "start",
      "--repo-root", partialClone,
      "--accept-defaults",
      "--json"
    ]);
    // The partial clone must never trip the shallow refusal. Whatever else start does with this
    // tiny fixture, exit 3 with the shallow remediation is the one forbidden outcome.
    expect(result.stderr).not.toContain("git fetch --unshallow");
    expect(result.exitCode).not.toBe(3);
  });
});

describe("doctor diagnoses identity instead of refusing (the X-RED gap)", () => {
  it("surfaces source, fingerprint, and shallow=false on a full clone", async () => {
    const result = await runCli(["doctor", "--repo-root", fullClone, "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.repo_identity).toMatchObject({
      shallow: false,
      source: "git_remote"
    });
    expect(payload.repo_identity.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const check = payload.checks.find((entry: { id: string }) => entry.id === "repo_identity");
    expect(check).toMatchObject({ status: "ok" });
    expect(check.detail).toContain("git_remote");
    expect(check.detail).toContain(payload.repo_identity.fingerprint);
  });

  it("reports the shallow clone as a failed identity check with the remediation, and still exits 0", async () => {
    const result = await runCli(["doctor", "--repo-root", shallowClone, "--json"]);
    const payload = JSON.parse(result.stdout);
    expect(payload.repo_identity).toMatchObject({ shallow: true, source: null, fingerprint: null });
    const check = payload.checks.find((entry: { id: string }) => entry.id === "repo_identity");
    expect(check).toMatchObject({ status: "fail" });
    expect(check.detail).toContain("shallow");
    expect(check.detail).toContain("git fetch --unshallow");
    // Doctor is the diagnostic surface: it must be able to LOOK at a shallow repo.
    expect(payload.status).toBe("fail");
  });

  it("marks a no-git directory as path-bound identity, not a failure", async () => {
    const result = await runCli(["doctor", "--repo-root", noGitDir, "--json"]);
    const payload = JSON.parse(result.stdout);
    expect(payload.repo_identity).toMatchObject({ shallow: false, source: "absolute_path" });
    const check = payload.checks.find((entry: { id: string }) => entry.id === "repo_identity");
    expect(check).toMatchObject({ status: "warn" });
  });
});
