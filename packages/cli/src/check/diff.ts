import type { AcceptedConvention,FindingDiffStatus } from "@drift/core";
import { execFileSync } from "node:child_process";
import { existsSync,readFileSync,statSync } from "node:fs";
import { ParsedArgs } from "../app/command-types.js";
import { stringFlag } from "../args/flag-readers.js";
import { matchesGlob } from "../domain/repo-paths.js";
import { walkIndexableFiles } from "../engine/ts-fallback-scanner.js";

export interface ParsedDiff {
  files: Array<{ path: string; changedLines: Set<number> }>;
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
    } catch {
      throw new Error(
        `Unable to read git diff for range ${diffRange}. Run from a Git worktree or pass --diff-file <path>.`
      );
    }
  }

  throw new Error("Missing --diff <range> or --diff-file <path>.");
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
      current = path ? { path, changedLines: new Set<number>() } : undefined;
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
      changedLines: new Set<number>()
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
  const scoped = diffFiles.filter((filePath) =>
    (convention.scope.path_globs.length === 0 ||
      convention.scope.path_globs.some((glob) => matchesGlob(filePath, glob))) &&
    !(convention.scope.exclude_path_globs ?? []).some((glob) => matchesGlob(filePath, glob))
  );

  if (scope === "full") {
    return scoped;
  }
  return scoped;
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
