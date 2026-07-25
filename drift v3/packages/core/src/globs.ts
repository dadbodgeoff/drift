/**
 * Canonical glob matching for Drift.
 *
 * This is the single source of truth for path-glob semantics across the engine
 * contract, CLI, and policy layers. Previously two divergent hand-rolled
 * implementations existed (`packages/cli/src/domain/repo-paths.ts` and
 * `packages/core/src/policy.ts`), both of which compiled `**` to `.*`
 * unconditionally. That made `**\/` require a leading slash, so:
 *
 *   - `**\/app/api/**\/route.ts` never matched a root-relative
 *     `app/api/x/route.ts` (the default `create-next-app` layout), silently
 *     disabling convention enforcement on those repos.
 *   - `**\/pages/api/**\/*.ts` never matched a handler sitting directly in
 *     `pages/api/`, at any depth.
 *   - `**\/*.pem` never matched a root-level `server.pem`, so the default
 *     context-egress deny list failed open on secrets at the repo root.
 *
 * Semantics implemented here (POSIX/globstar conventions):
 *   `**\/`  zero or more complete path segments
 *   `/**`   (trailing) the directory itself or anything beneath it
 *   `**`    any run of characters, including `/`
 *   `*`     any run of characters except `/`
 *   `?`     exactly one character except `/`
 *
 * Matching is performed against forward-slash, repo-relative paths.
 */

const REGEX_METACHARS = /[.+^${}()|[\]\\]/g;

function escapeLiteral(value: string): string {
  return value.replace(REGEX_METACHARS, "\\$&");
}

/** Compile a glob pattern to an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/\\/g, "/");
  let out = "";
  let i = 0;

  while (i < pattern.length) {
    // `**/` -> zero or more complete segments (the zero case is the bug fix).
    if (pattern.startsWith("**/", i)) {
      out += "(?:[^/]+/)*";
      i += 3;
      continue;
    }

    // Trailing `/**` -> this directory, or anything beneath it.
    if (pattern.startsWith("/**", i) && i + 3 === pattern.length) {
      out += "(?:/.*)?";
      i += 3;
      continue;
    }

    // Bare `**` -> anything, including separators.
    if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
      continue;
    }

    if (pattern[i] === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }

    if (pattern[i] === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }

    out += escapeLiteral(pattern[i]!);
    i += 1;
  }

  return new RegExp(`^${out}$`);
}

/** True when `filePath` matches `glob`. Paths are normalized to forward slashes. */
export function matchesGlob(filePath: string, glob: string): boolean {
  return globToRegExp(glob).test(filePath.replace(/\\/g, "/"));
}

/** True when `filePath` matches any of `globs`. Empty list matches nothing. */
export function matchesAnyGlob(filePath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(filePath, glob));
}
