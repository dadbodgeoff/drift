/**
 * Which files a repository scan sees, and how it walks them.
 *
 * Lives here rather than in the CLI because the MCP server cannot import from the CLI - the
 * boundary check enforces that - so a copy of this walk was made there, and the two drifted. Three
 * ways, measured: the copy never learned about `.gitignore`, never learned about declaration files
 * when the scan gained them, and by then `prepare` and `get_task_preflight` disagreed about whether
 * `prisma/schema.prisma` was a file worth mentioning for a task about the Prisma schema.
 *
 * `@drift/query` is the designated home for logic both surfaces need - the same move T51 made for
 * preflight ranking, after the two copies of THAT silently diverged. This is the other half.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join,relative } from "node:path";

export function walkIndexableFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const ignorePatterns = readGitignorePatterns(repoRoot);
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      const relativePath = relative(repoRoot, absolutePath).replaceAll("\\", "/");
      if (shouldSkipPath(entry.name) || isIgnoredPath(relativePath, ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && isIndexableFilePath(entry.name)) {
        files.push(relativePath);
      }
    }
  };
  visit(repoRoot);
  return files.sort();
}

export function shouldSkipPath(name: string): boolean {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "target",
    "vendor"
  ].includes(name);
}

export function isTypescriptPath(filePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

/**
 * Files that DECLARE structure rather than implement it. Mirrors `is_declaration_path` in
 * crates/drift-engine/src/main.rs - the engine is authoritative, this keeps the CLI-side walker
 * from disagreeing with it about which files exist.
 *
 * These are snapshotted for their path and content hash and are NOT parsed, so they carry no
 * facts. Anything deciding whether a rule can be evaluated must read `snapshot.indexed` rather
 * than test the extension: presence in this list means Drift knows the file is there, not that it
 * knows what is in it.
 */
export function isDeclarationPath(filePath: string): boolean {
  return /\.prisma$/.test(filePath);
}

/** Every file the scan records, parsed or not. */
export function isIndexableFilePath(filePath: string): boolean {
  return isTypescriptPath(filePath) || isDeclarationPath(filePath);
}

function readGitignorePatterns(repoRoot: string): string[] {
  const gitignorePath = join(repoRoot, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return [];
  }
  return readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
    .map((line) => line.replace(/^\/+/, ""));
}

function isIgnoredPath(filePath: string, patterns: string[]): boolean {
  const fileName = filePath.split("/").at(-1) ?? filePath;
  return patterns.some((pattern) => gitignorePatternMatches(pattern, filePath, fileName));
}

function gitignorePatternMatches(pattern: string, filePath: string, fileName: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3).replace(/\/+$/, "");
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("/")) {
    const prefix = pattern.replace(/\/+$/, "");
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  if (pattern.startsWith("**/")) {
    const rest = pattern.slice(3);
    return wildcardMatches(rest, fileName) || wildcardMatches(rest, filePath) || wildcardMatches(pattern, filePath);
  }
  if (pattern.includes("*")) {
    if (pattern.includes("/")) {
      return wildcardMatches(pattern, filePath);
    }
    return filePath.split("/").some((component) => wildcardMatches(pattern, component));
  }
  if (pattern.includes("/")) {
    return filePath === pattern || filePath.startsWith(`${pattern}/`);
  }
  return filePath.split("/").includes(pattern);
}

function wildcardMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
