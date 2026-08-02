import { API_ROUTE_SCOPE_GLOBS,expandApiRouteScopeGlobs,type AcceptedConvention,type FindingDiffStatus } from "@drift/core";
import { execFileSync } from "node:child_process";
import { existsSync,readFileSync,statSync } from "node:fs";
import { ParsedArgs } from "../app/command-types.js";
import { stringFlag } from "../args/flag-readers.js";
import { isShallowRepository,SHALLOW_CLONE_REMEDIATION } from "../domain/repo-identity.js";
import { isApiRoutePath,matchesGlob } from "../domain/repo-paths.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";

export interface ParsedDiff {
  files: Array<{ path: string; changedLines: Set<number>; isAdded: boolean }>;
  deletedFiles: string[];
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
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      // X-2: this catch used to swallow git's stderr and diagnose every failure as "not a
      // worktree" - wrong advice in the one situation CI hits by default, a depth-1
      // actions/checkout whose range crosses the shallow boundary. Distinguish the three
      // failures git actually produces here, and always carry git's own words.
      const gitStderr = stderrOf(error);
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
  let current: ParsedDiff["files"][number] | undefined;
  let oldPath: string | undefined;
  let newLine: number | undefined;

  for (const line of input.split(/\r?\n/)) {
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
  return { files, deletedFiles: [...deletedFiles].sort() };
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
  const diffFiles = diff.files.map((file) => file.path);
  const isApiRouteConvention = appliesToApiRouteFiles(convention);
  const pathGlobs = isApiRouteConvention
    ? expandApiRouteScopeGlobs(convention.scope.path_globs)
    : convention.scope.path_globs;

  const scoped = diffFiles.filter((filePath) => {
    if ((convention.scope.exclude_path_globs ?? []).some((glob) => matchesGlob(filePath, glob))) {
      return false;
    }

    // For api-route conventions the engine's segment-based route detection is
    // authoritative: it is what assigns `file_role_detected: api_route` and what
    // candidate inference used to build this contract. Path globs are only ever an
    // *additional* narrowing filter, never the thing that decides whether a route
    // is a route. Previously the CLI re-derived route membership from globs alone,
    // which silently disabled enforcement for repo-root `app/` and `pages/`
    // layouts while inference still produced a correct contract.
    if (isApiRouteConvention) {
      if (!isApiRoutePath(filePath)) {
        return false;
      }
      // Default scope globs are the auto-generated API_ROUTE_SCOPE_GLOBS set, which
      // is fully redundant with the role check above. Only apply globs when the
      // author narrowed the scope to something more specific.
      if (isDefaultApiRouteScope(pathGlobs)) {
        return true;
      }
    }

    return pathGlobs.length === 0 || pathGlobs.some((glob) => matchesGlob(filePath, glob));
  });

  if (scope === "full") {
    return scoped;
  }
  return scoped;
}

const DEFAULT_API_ROUTE_SCOPE = new Set(expandApiRouteScopeGlobs([...API_ROUTE_SCOPE_GLOBS]));

function isDefaultApiRouteScope(pathGlobs: readonly string[]): boolean {
  return pathGlobs.length > 0 && pathGlobs.every((glob) => DEFAULT_API_ROUTE_SCOPE.has(glob));
}

function appliesToApiRouteFiles(convention: AcceptedConvention): boolean {
  return Boolean(
    convention.scope.file_roles?.includes("api_route") ||
    convention.matcher.applies_to_file_roles?.includes("api_route")
  );
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
