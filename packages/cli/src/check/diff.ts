import { conventionScopeFiles,type AcceptedConvention,type FindingDiffStatus } from "@drift/core";
import { execFileSync } from "node:child_process";
import { existsSync,readFileSync,statSync } from "node:fs";
import { ParsedArgs } from "../app/command-types.js";
import { stringFlag } from "../args/flag-readers.js";
import { isShallowRepository,SHALLOW_CLONE_REMEDIATION } from "../domain/repo-identity.js";
import { GIT_MAX_BUFFER_BYTES,isBufferOverflow } from "../io/git.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";

export interface ParsedDiff {
  files: Array<{ path: string; changedLines: Set<number>; isAdded: boolean }>;
  deletedFiles: string[];
  /**
   * BB-1: files this diff moved, at their new paths.
   *
   * A pure `git mv` with unchanged content produces *only* rename metadata - `similarity index 100%`,
   * `rename from`, `rename to` - and no `---`/`+++` headers or hunks at all. Without tracking it, such
   * a diff parses to no files and no deletions, and the empty-scope refusal fires on an ordinary
   * refactor. The bench caught exactly that: taxonomy's ordinary-edit refusal rate went 0/8 to 1/8 on
   * `E8-rename-a-new-route-directory`.
   *
   * Optional so the synthetic diffs built elsewhere (full-repo scope, exemplar scope) need not care.
   */
  renamedFiles?: string[];
}

export function loadDiff(repoRoot: string, parsed: ParsedArgs): string {
  const diffFile = stringFlag(parsed, "diff-file");
  if (diffFile) {
    if (!existsSync(diffFile)) {
      throw new Error(`Diff file not found: ${diffFile}`);
    }
    if (!statSync(diffFile).isFile()) {
      throw new Error(`--diff-file must be a file: ${diffFile}`);
    }
    return readFileSync(diffFile, "utf8");
  }

  const diffRange = stringFlag(parsed, "diff");
  if (diffRange) {
    try {
      return execFileSync("git", ["diff", "--unified=0", diffRange], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: GIT_MAX_BUFFER_BYTES
      });
    } catch (error) {
      // X-2: this catch used to swallow git's stderr and diagnose every failure as "not a
      // worktree" - wrong advice in the one situation CI hits by default, a depth-1
      // actions/checkout whose range crosses the shallow boundary. Distinguish the three
      // failures git actually produces here, and always carry git's own words.
      const gitStderr = stderrOf(error);
      // Buffer overflow is not a git error and must not be diagnosed as one. ENOBUFS arrives with
      // an EMPTY stderr, so every branch below - which all reason from git's own words - would
      // reach the generic "check the range" message and blame a range that was correct. Named
      // first because it is the only failure here that git never reported.
      if (isBufferOverflow(error)) {
        throw new Error(
          `Unable to read git diff for range ${diffRange}: the diff is larger than Drift's ${Math.round(GIT_MAX_BUFFER_BYTES / (1024 * 1024))} MB read buffer. The range is not the problem. Narrow the range, or write the diff to a file and pass --diff-file <path>.`
        );
      }
      if (!isInsideGitWorktree(repoRoot)) {
        throw new Error(
          `Unable to read git diff for range ${diffRange}: ${repoRoot} is not a Git worktree. Run from a Git worktree or pass --diff-file <path>.`
        );
      }
      if (isShallowRepository(repoRoot) && isUnresolvableRevision(gitStderr)) {
        throw new Error(
          `Unable to read git diff for range ${diffRange}: this repository is a shallow clone and the range crosses the shallow boundary - the commits it references were never fetched. ${SHALLOW_CLONE_REMEDIATION}${gitStderr ? ` git reported: ${gitStderr}` : ""}`
        );
      }
      throw new Error(
        `Unable to read git diff for range ${diffRange}: git diff failed${gitStderr ? ` with: ${gitStderr}` : ""}. Check the range, or pass --diff-file <path>.`
      );
    }
  }

  throw new Error("Missing --diff <range> or --diff-file <path>.");
}

/** git's stderr from a failed execFileSync, trimmed to a single diagnostic line. */
function stderrOf(error: unknown): string {
  const raw = (error as { stderr?: unknown })?.stderr;
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
  // git prefixes the load-bearing line with "fatal:"; keep it and drop the usage hints below.
  return (text.split("\n").find((line) => line.startsWith("fatal:")) ?? text.split("\n")[0] ?? "").trim();
}

function isInsideGitWorktree(repoRoot: string): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() === "true";
  } catch {
    return false;
  }
}

/**
 * True when git failed because a revision in the range does not exist locally. In a shallow
 * clone that is the signature of a range crossing the shallow boundary: the parent commits were
 * never fetched, so `HEAD~1` is an unknown revision even though the history "exists" upstream.
 */
function isUnresolvableRevision(gitStderr: string): boolean {
  return /unknown revision|bad revision|invalid revision|ambiguous argument/i.test(gitStderr);
}

export function parseUnifiedDiff(input: string): ParsedDiff {
  const files: ParsedDiff["files"] = [];
  const deletedFiles = new Set<string>();
  const renamedFiles = new Set<string>();
  let current: ParsedDiff["files"][number] | undefined;
  let oldPath: string | undefined;
  let newLine: number | undefined;

  for (const line of input.split(/\r?\n/)) {
    // BB-1: rename metadata, which a 100%-similarity move emits *instead of* any hunk. Recorded so
    // "this diff moved a file" is distinguishable from "this diff describes nothing".
    if (line.startsWith("rename to ")) {
      renamedFiles.add(normalizeDiffPath(line.slice("rename to ".length)) ?? line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (current) {
        files.push(current);
      }
      const path = normalizeDiffPath(line.slice(4));
      if (!path && oldPath) {
        deletedFiles.add(oldPath);
      }
      // `--- /dev/null` normalizes to undefined, which marks an added file.
      current = path
        ? { path, changedLines: new Set<number>(), isAdded: oldPath === undefined }
        : undefined;
      newLine = undefined;
      continue;
    }

    if (line.startsWith("@@ ")) {
      newLine = parseHunkStart(line);
      continue;
    }

    if (!current || newLine === undefined || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      current.changedLines.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      continue;
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
  }

  if (current) {
    files.push(current);
  }

  // R2a: a purely renamed file is IN scope, at its new path.
  //
  // BB-1 recorded these so an ordinary `git mv` would stop tripping the empty-scope refusal
  // (run-check.ts:432-441), but recording is not scoping: `filesForConvention` maps over `files`
  // and `diffStatusFor` looks the path up in the same array, so a file that appeared only in
  // `renamedFiles` was never examined. Renaming a violating route made it invisible and the check
  // reported clean - an enforcement bypass reachable from the documented workflow, because
  // `git diff --unified=0` has rename detection on by default.
  //
  // `isAdded: false` and no changed lines, deliberately. The content did not change, so the move
  // classifies `touched_existing` and the baseline still shields it. Marking it added would make
  // every moved file's pre-existing violations block, which is the punishing-a-refactor failure the
  // rename cases above exist to prevent - and it would land before finding fingerprints can survive
  // a path change (finding-fingerprint.ts:45 hashes the path), so the debt would return as `new`
  // with nothing to match it against.
  //
  // A rename that also carries an edit already entered `files` through its own `+++` header; the
  // guard keeps it from being counted twice and preserves the changed lines it parsed.
  const scoped = new Set(files.map((file) => file.path));
  for (const renamed of [...renamedFiles].sort()) {
    if (scoped.has(renamed)) {
      continue;
    }
    files.push({ path: renamed, changedLines: new Set<number>(), isAdded: false });
  }

  return {
    files,
    deletedFiles: [...deletedFiles].sort(),
    renamedFiles: [...renamedFiles].sort()
  };
}

export function fullRepoDiff(repoRoot: string): ParsedDiff {
  return {
    files: walkIndexableFiles(repoRoot).map((path) => ({
      path,
      changedLines: new Set<number>(),
      isAdded: false
    })),
    deletedFiles: []
  };
}

export function filesForConvention(
  diff: ParsedDiff,
  convention: AcceptedConvention,
  scope: string
): string[] {
  // BB-6: one scope implementation, in @drift/core, shared by the check path, the CLI packet and the
  // MCP packet. A second one here is what F3 was: the CLI re-derived route membership from globs
  // alone, which silently disabled enforcement for the default create-next-app layout while still
  // reporting `can_block: true`. An exemplar drawn from outside the enforced scope would be the same
  // bug wearing different clothes, and that is what made sharing this worth doing.
  //
  // `scope` is accepted and unused, as before: "changed-hunks" and "changed-files" differ in how
  // findings are *attributed* (see diffStatusFor), not in which files are in the convention's scope.
  void scope;
  return conventionScopeFiles(diff.files.map((file) => file.path), convention);
}

export function diffStatusFor(
  filePath: string,
  line: number,
  diff: ParsedDiff,
  scope: string
): FindingDiffStatus {
  if (scope === "full") {
    return "touched_existing";
  }

  const file = diff.files.find((entry) => entry.path === filePath);
  if (!file) {
    return "outside_diff";
  }

  // F7: an added file is entirely new code, so every line in it is a new hunk.
  // Classifying it as `touched_existing` let brand-new violating routes through
  // even in block mode, because "touched existing" is what the baseline shields.
  // This holds in every scope mode, including changed-files.
  if (file.isAdded) {
    return "new_in_diff";
  }

  if (scope === "changed-files") {
    return "touched_existing";
  }

  return file.changedLines.has(line) ? "new_in_diff" : "touched_existing";
}

export function normalizeDiffPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (trimmed === "/dev/null") {
    return undefined;
  }
  return trimmed.replace(/^[ab]\//, "");
}

export function parseHunkStart(line: string): number | undefined {
  const match = line.match(/\+(\d+)(?:,\d+)?/);
  return match ? Number(match[1]) : undefined;
}
