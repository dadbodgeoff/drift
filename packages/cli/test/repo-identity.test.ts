import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normaliseRemoteUrl, repoIdentityFor } from "../src/domain/repo-identity.js";

/**
 * T120. Identity was `hash(absolute path)`, which made every checkout of a repository a different
 * repo — so a teammate could not import a committed contract, and CI could not either.
 *
 * The property that matters is not "the hash looks right", it is **two checkouts of the same repo
 * at different paths agree, and two different repos do not**. That is what these test.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRepo(options: { remote?: string; name?: string } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-identity-"));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: options.name ?? "pkg" }));
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  if (options.remote) {
    git("remote", "add", "origin", options.remote);
  }
  return dir;
}

/** Clone into a different path — the situation that was broken. */
async function cloneOf(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-identity-clone-"));
  dirs.push(dir);
  execFileSync("git", ["clone", "-q", source, dir], { stdio: "ignore" });
  // A clone from a shared host carries the same origin URL. Cloning from a local path does not, so
  // set it to what the source uses — otherwise the test measures the local path, not the property.
  const sourceRemote = (() => {
    try {
      return execFileSync("git", ["remote", "get-url", "origin"], { cwd: source, encoding: "utf8" }).trim();
    } catch {
      return undefined;
    }
  })();
  if (sourceRemote) {
    execFileSync("git", ["remote", "set-url", "origin", sourceRemote], { cwd: dir, stdio: "ignore" });
  }
  return dir;
}

describe("remote URL normalisation", () => {
  it("treats every spelling of the same remote as the same repository", () => {
    const forms = [
      "git@github.com:acme/app.git",
      "https://github.com/acme/app",
      "https://github.com/acme/app.git",
      "https://github.com/acme/app.git/",
      "ssh://git@github.com/acme/app.git",
      "GIT@GitHub.com:Acme/App.git"
    ];
    const normalised = new Set(forms.map(normaliseRemoteUrl));
    expect(normalised, `got ${[...normalised].join(" | ")}`).toEqual(new Set(["github.com/acme/app"]));
  });

  it("drops credentials rather than hashing them", () => {
    // Otherwise one machine's tokenised URL disagrees with another's.
    expect(normaliseRemoteUrl("https://x-token:secret@github.com/acme/app.git"))
      .toBe(normaliseRemoteUrl("https://github.com/acme/app"));
  });

  it("distinguishes different repositories on the same host", () => {
    expect(normaliseRemoteUrl("git@github.com:acme/app.git"))
      .not.toBe(normaliseRemoteUrl("git@github.com:acme/other.git"));
  });
});

describe("repo identity", () => {
  it("gives two checkouts of the same repo the same id", async () => {
    const origin = await makeRepo({ remote: "git@github.com:acme/app.git" });
    const clone = await cloneOf(origin);
    const a = repoIdentityFor(origin);
    const b = repoIdentityFor(clone);
    expect(a.id).toBe(b.id);
    expect(b.source).toBe("git_remote");
  }, 60_000);

  it("gives different repos different ids", async () => {
    const one = await makeRepo({ remote: "git@github.com:acme/app.git" });
    const two = await makeRepo({ remote: "git@github.com:acme/other.git" });
    expect(repoIdentityFor(one).id).not.toBe(repoIdentityFor(two).id);
  }, 60_000);

  it("distinguishes forks that share a remote name by root commit", async () => {
    // Same remote URL, unrelated history: not the same repository. The two repos need genuinely
    // different first commits — two `git init`s with identical content in the same second produce
    // the same sha, which is a property of git rather than something worth engineering around.
    const one = await makeRepo({ remote: "git@github.com:acme/app.git", name: "one" });
    const two = await makeRepo({ remote: "git@github.com:acme/app.git", name: "two" });
    expect(repoIdentityFor(one).id).not.toBe(repoIdentityFor(two).id);
  }, 60_000);

  it("falls back to repo content when there is no remote", async () => {
    const repo = await makeRepo({ name: "@acme/internal" });
    const identity = repoIdentityFor(repo);
    expect(identity.source).toBe("repo_content");
    expect(identity.detail).toContain("@acme/internal");
  }, 60_000);

  it("content identity also survives a different path", async () => {
    const origin = await makeRepo({ name: "@acme/internal" });
    const clone = await cloneOf(origin);
    // The clone has an origin remote pointing at a local path, so force the content path by
    // comparing the two content-derived ids directly.
    execFileSync("git", ["remote", "remove", "origin"], { cwd: clone, stdio: "ignore" });
    expect(repoIdentityFor(clone).id).toBe(repoIdentityFor(origin).id);
  }, 60_000);

  it("falls back to the path, and says so, when there is no git history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-identity-bare-"));
    dirs.push(dir);
    const identity = repoIdentityFor(dir);
    expect(identity.source).toBe("absolute_path");
    // A contract keyed this way cannot travel; doctor needs to be able to say that.
    expect(identity.detail).toContain(dir.split("/").pop()!);
  });
});
