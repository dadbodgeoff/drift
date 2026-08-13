import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadDiff, parseUnifiedDiff } from "../src/check/diff.js";

/**
 * A diff larger than 1 MB is an ordinary pull request, not an edge case.
 *
 * `execFileSync` defaults to a 1 MB output buffer and raises ENOBUFS with an EMPTY stderr when it
 * is exceeded. Every branch in the diff reader reasons from git's own words, so an empty stderr
 * fell through to the generic message and told the user to "check the range" - about a range that
 * was correct. A lockfile, a generated types file, or a snapshot update crosses 1 MB routinely.
 *
 * Measured on main before the fix, with an 8.35 MB diff across 61 files:
 *   Unable to read git diff for range HEAD~1...HEAD: git diff failed. Check the range, or pass --diff-file <path>.
 *
 * The fixture is deliberately over 1 MB and well under the 64 MB ceiling, so it fails on the old
 * default and passes on the new one. It is not a test that the ceiling is 64 MB.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("diff reading is not capped at Node's 1 MB default", () => {
  it("reads a multi-megabyte diff instead of blaming the range", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-large-diff-"));
    tempDirs.push(dir);
    const repoRoot = join(dir, "repo");
    await mkdir(join(repoRoot, "generated"), { recursive: true });
    await writeFile(join(repoRoot, "package.json"), '{"name":"large-diff","version":"1.0.0"}\n');

    git(repoRoot, "init");
    git(repoRoot, "add", "-A");
    git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init");

    // ~2 MB across 20 files: over the old 1 MB default, far under the 64 MB ceiling.
    const line = "export type Row = { id: string; name: string; value: number; created: Date };\n";
    for (let file = 0; file < 20; file += 1) {
      await writeFile(join(repoRoot, "generated", `types${file}.ts`), line.repeat(1_400));
    }
    git(repoRoot, "add", "-A");
    git(repoRoot, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "generated");

    const raw = execFileSync("git", ["diff", "--unified=0", "HEAD~1...HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    expect(raw.length).toBeGreaterThan(1024 * 1024);

    // The real path: loadDiff shells out to git. On main this threw
    // "git diff failed. Check the range" because ENOBUFS arrived with an empty stderr.
    const loaded = loadDiff(repoRoot, {
      flags: new Map([["diff", "HEAD~1...HEAD"]]),
      positionals: []
    } as never);
    expect(loaded.length).toBeGreaterThan(1024 * 1024);

    expect(parseUnifiedDiff(loaded).files.length).toBe(20);
  });
});
