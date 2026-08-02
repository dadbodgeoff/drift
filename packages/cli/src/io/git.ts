import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

export function gitOutput(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/**
 * Paths of files changed in the working tree relative to the git baseline (HEAD):
 * staged, unstaged, and untracked, as repo-root-relative forward-slash paths - the same
 * shape scan facts use.
 *
 * E-6 (decision D-2): candidate inference excludes these files from the coverage
 * direction so newly-detected violations in an analyzed diff can never argue a
 * convention down from block to warn. Returns [] outside a git work tree, which callers
 * treat as "everything is baseline" - the pre-E-6 behaviour.
 */
export function workingTreeChangedFiles(repoRoot: string): string[] {
  const toplevel = gitOutput(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) {
    return [];
  }
  let raw: string;
  try {
    // -z: NUL-separated, no quoting, rename entries carry the origin path as a second
    // NUL-separated field. --untracked-files=all lists files rather than directories.
    raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch {
    return [];
  }
  const paths = new Set<string>();
  const addPath = (path: string): void => {
    // git reports paths relative to the toplevel; facts are relative to repoRoot.
    const relativeToRoot = relative(repoRoot, resolve(toplevel, path));
    if (!relativeToRoot || relativeToRoot.startsWith("..")) {
      return;
    }
    paths.add(relativeToRoot.split("\\").join("/"));
  };
  const entries = raw.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 4) {
      continue;
    }
    const status = entry.slice(0, 2);
    addPath(entry.slice(3));
    if (status[0] === "R" || status[0] === "C") {
      // The origin path of a rename/copy follows as its own NUL-separated field. It also
      // differs from the baseline (the file left that path), so exclude it too.
      const origin = entries[index + 1];
      index += 1;
      if (origin) {
        addPath(origin);
      }
    }
  }
  return [...paths].sort();
}
