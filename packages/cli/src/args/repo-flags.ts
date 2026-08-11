import type { ConventionCandidate } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,mkdirSync,statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname,extname,join,resolve } from "node:path";
import { ParsedArgs } from "../app/command-types.js";
import { repoIdForRoot,sanitizeAuditId } from "../domain/identifiers.js";
import { requiredRepo } from "../domain/repo-paths.js";
import { requiredValue,stringFlag } from "./flag-readers.js";

export function assertCandidateRepoMatchesParsed(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  candidate: ConventionCandidate
): void {
  const repoId = stringFlag(parsed, "repo");
  if (!repoId) {
    return;
  }
  requiredRepo(storage, repoId);
  if (candidate.repo_id !== repoId) {
    throw new Error(`Convention candidate ${candidate.id} belongs to repo ${candidate.repo_id}, not ${repoId}.`);
  }
}

export function resolveDatabasePath(parsed: ParsedArgs): string | undefined {
  const explicit = stringFlag(parsed, "db") ?? process.env.DRIFT_DB;
  if (explicit) {
    return explicit;
  }

  if (
    ["init", "scan", "start"].includes(parsed.positional[0] ?? "") ||
    parsed.flags.has("repo-root") ||
    parsed.flags.has("state-root")
  ) {
    return defaultDatabasePath(resolveRepoRoot(parsed), parsed);
  }

  return undefined;
}

export function requiredDatabasePath(parsed: ParsedArgs): string {
  return requiredValue(resolveDatabasePath(parsed), "database path");
}

export function resolveRepoRoot(parsed: ParsedArgs): string {
  return resolve(stringFlag(parsed, "repo-root") ?? process.cwd());
}

export function resolveRepoId(parsed: ParsedArgs): string {
  return stringFlag(parsed, "repo") ?? repoIdForRoot(resolveRepoRoot(parsed));
}

export function defaultDatabasePath(
  repoRoot: string,
  parsed: ParsedArgs,
  options: { createDir?: boolean } = { createDir: true }
): string {
  const stateRoot = resolve(
    stringFlag(parsed, "state-root") ??
      process.env.DRIFT_STATE_ROOT ??
      join(homedir(), ".drift", "repos")
  );
  const repoId = repoIdForRoot(repoRoot);
  const dir = join(stateRoot, repoId);
  if (options.createDir !== false) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "drift.sqlite");
}

export function resolveBackupPath(parsed: ParsedArgs, repoId: string, now: string): string {
  const outputFlag = stringFlag(parsed, "output") ?? stringFlag(parsed, "output-dir");
  const output = resolve(outputFlag ?? join(homedir(), ".drift", "backups", repoId));
  if (outputFlag && existsSync(output) && statSync(output).isDirectory()) {
    mkdirSync(output, { recursive: true });
    return join(output, `${repoId}-${sanitizeAuditId(now)}.drift-backup.sqlite`);
  }
  if (extname(output) === ".sqlite") {
    mkdirSync(dirname(output), { recursive: true });
    return output;
  }
  if (outputFlag && extname(output)) {
    throw new Error("Backup output file must end in .sqlite or be a directory.");
  }

  mkdirSync(output, { recursive: true });
  return join(output, `${repoId}-${sanitizeAuditId(now)}.drift-backup.sqlite`);
}
