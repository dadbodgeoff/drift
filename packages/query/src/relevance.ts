/**
 * How relevant a file is to a task, highest first.
 *
 * Shared by `drift prepare` (CLI) and `get_task_preflight` (MCP). It lives here because those two
 * had independent copies of the whole preflight assembly, and the copies diverged the moment one
 * was fixed: T46 added this ranking to the CLI and the MCP surface - the one agents actually
 * call - kept returning files in filesystem-walk order. That is the same failure class as the
 * TypeScript/Rust import divergence B3 and T12 closed.
 *
 * Task-token matches dominate deliberately. A file whose path names what the task is about is
 * evidence of an existing pattern to follow; convention scope only says the file is the kind of
 * thing the rule applies to, which is true of every route in the repository.
 */

import { existsSync } from "node:fs";
import { conventionScopeFiles, isNextApiRoutePath, matchesGlob, type RepoContract } from "@drift/core";
import { walkIndexableFiles } from "./repo-files.js";

export interface RankableFile {
  path: string;
  roles: string[];
  reasons: string[];
}

/** Files a preflight will return, ranked and capped. */
export const MAX_RELEVANT_FILES = 25;

export function relevanceScore(file: RankableFile): number {
  let score = 0;
  for (const reason of file.reasons) {
    if (reason === "requested path") {
      score += 1000;
    } else if (reason.startsWith("task token:")) {
      // Each distinct token match compounds: matching both "workspace" and "invites" is a much
      // stronger signal than matching either alone.
      score += 100;
    } else if (reason.startsWith("in scope for")) {
      score += 1;
    } else {
      score += 5;
    }
  }
  // Prefer routes over components when otherwise equal - the task is usually about an endpoint.
  if (file.roles.includes("api_route")) {
    score += 2;
  }
  return score;
}

/**
 * Rank, then truncate. Order matters: truncating first is what made `prepare` return 24 arbitrary
 * routes and miss the one file the task was about.
 */
export function rankRelevantFiles<T extends RankableFile>(files: T[]): T[] {
  return files
    .map((file) => ({ file, score: relevanceScore(file) }))
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, MAX_RELEVANT_FILES)
    .map((entry) => entry.file);
}

/**
 * Files worth showing an agent for a task, ranked and capped.
 *
 * This is the SELECTION half of what T51 half-fixed. T51 moved ranking here after the CLI and MCP
 * copies of it diverged; selection stayed duplicated and diverged three ways of its own:
 *
 *  - the in-scope predicate. The CLI tested `path_globs` alone while the enforcement path uses
 *    `conventionScopeFiles`, so `prepare` told an agent a file was "in scope for convention_X"
 *    using a rule `check` does not use to enforce convention_X. BB-11 already adjudicated
 *    glob-only as a bug rather than a policy - and fixed only the MCP copy. Measured on dub's real
 *    file list, the two answer differently by 623 vs 171 files for a contract with exclusions, and
 *    0 vs 4,091 for one with empty globs.
 *  - `.gitignore`. The CLI honoured it; the MCP copy never did.
 *  - declaration files. When the scan learned to record `.prisma`, only the CLI walker learned it,
 *    so `prepare` surfaced `prisma/schema.prisma` for a task about the Prisma schema and
 *    `get_task_preflight` did not.
 *
 * The canonical predicate wins on scope and the gitignore-aware walk wins on discovery, because
 * each was the side that had already been adjudicated correct.
 */
export function relevantFilesForTask(input: {
  repoRoot: string;
  task: string;
  contract: RepoContract;
  targetPath?: string;
}): RankableFile[] {
  const tokens = tokenizeTask(input.task);
  if (!existsSync(input.repoRoot)) {
    // No tree to walk: a requested path is still worth returning, because the caller named it.
    return input.targetPath
      ? [relevantFileForPath(input.targetPath, tokens, input.contract, "requested path")].filter(
          (file): file is RankableFile => Boolean(file)
        )
      : [];
  }

  const deniedGlobs = input.contract.context_egress.denied_globs;
  const files = walkIndexableFiles(input.repoRoot)
    .filter((filePath) => !deniedGlobs.some((glob) => matchesGlob(filePath, glob)))
    .map((filePath) => relevantFileForPath(filePath, tokens, input.contract))
    .filter((file): file is RankableFile => Boolean(file));

  if (
    input.targetPath &&
    !deniedGlobs.some((glob) => matchesGlob(input.targetPath!, glob)) &&
    !files.some((file) => file.path === input.targetPath)
  ) {
    const targetFile = relevantFileForPath(input.targetPath, tokens, input.contract, "requested path");
    if (targetFile) {
      files.unshift(targetFile);
    }
  } else if (input.targetPath) {
    const existing = files.find((file) => file.path === input.targetPath);
    if (existing && !existing.reasons.includes("requested path")) {
      existing.reasons = [...new Set([...existing.reasons, "requested path"])].sort();
    }
  }

  // Rank before truncating: the cap is 25 and "in scope for this convention" matches every route
  // in the repository, so an unranked slice returns whatever the walk reached first.
  return rankRelevantFiles(files);
}

export function relevantFileForPath(
  filePath: string,
  tokens: Set<string>,
  contract: RepoContract,
  forcedReason?: string
): RankableFile | undefined {
  const reasons = new Set<string>();
  const roles = new Set<string>();
  if (forcedReason) {
    reasons.add(forcedReason);
  }
  if (isNextApiRoutePath(filePath)) {
    roles.add("api_route");
  }

  for (const token of tokens) {
    if (filePath.toLowerCase().includes(token)) {
      reasons.add(`task token: ${token}`);
    }
  }

  for (const convention of contract.conventions) {
    // The canonical predicate, not a glob test. It additionally honours `exclude_path_globs`,
    // treats route detection as authoritative for api-route conventions, applies route-flavour
    // narrowing, and reads empty `path_globs` as "no narrowing" rather than "matches nothing" -
    // four behaviours a glob test silently gets wrong, in both directions.
    if (conventionScopeFiles([filePath], convention).length > 0) {
      reasons.add(`in scope for ${convention.id}`);
      for (const role of convention.scope.file_roles ?? []) {
        roles.add(role);
      }
    }
  }

  if (reasons.size === 0) {
    return undefined;
  }
  return {
    path: filePath,
    roles: [...roles].sort(),
    reasons: [...reasons].sort()
  };
}

/**
 * The tokens a path is matched against.
 *
 * Copied verbatim from the two byte-identical implementations this replaces, deliberately: `_`,
 * `/` and `-` survive the split because paths contain them, and the floor is three characters, not
 * four. Both details are load-bearing - they decide which files earn a `task token:` reason, and a
 * reason is what puts a file in front of an agent at all.
 */
export function tokenizeTask(task: string): Set<string> {
  return new Set(
    task
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}
