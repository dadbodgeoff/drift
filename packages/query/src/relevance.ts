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
