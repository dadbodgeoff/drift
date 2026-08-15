/**
 * Re-exported from `@drift/query`, which owns the one walk.
 *
 * This file used to hold the implementation, and because the MCP server cannot import from the CLI
 * - the boundary check enforces that - a second copy grew there. The two then drifted three ways:
 * the copy never learned about `.gitignore`, never learned about declaration files when the scan
 * gained them, and by then `prepare` and `get_task_preflight` disagreed about whether
 * `prisma/schema.prisma` was worth mentioning for a task about the Prisma schema.
 *
 * Kept as a module so the CLI's five call sites (doctor, start, check/diff, preflight,
 * scan-status) are unaffected by where the implementation lives.
 */
export {
  isDeclarationPath,
  isIndexableFilePath,
  isTypescriptPath,
  shouldSkipPath,
  walkIndexableFiles
} from "@drift/query";
