import type { RepoRecord } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { ParsedArgs } from "../app/command-types.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath,resolveRepoRoot } from "../args/repo-flags.js";
import { auditEvent } from "../domain/governance.js";
import { assertRepoRootDirectory,repoRecordForRoot } from "../domain/repo-paths.js";

export function initRepo(storage: SqliteDriftStorage, parsed: ParsedArgs): {
  repo: RepoRecord;
  database_path: string;
} {
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const repoRoot = resolveRepoRoot(parsed);
  assertRepoRootDirectory(repoRoot);
  const actor = actorFlag(parsed);
  const repo = repoRecordForRoot(repoRoot, now);
  const isNewRepo = !storage.getRepo(repo.id);
  storage.upsertRepo(repo);
  if (isNewRepo) {
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_repo_added_${repo.id}_${now}`,
      repoId: repo.id,
      actor,
      action: "repo_added",
      targetType: "repo",
      targetId: repo.id,
      metadata: { root_path: repoRoot },
      createdAt: now
    }));
  }

  return {
    repo,
    database_path: requiredDatabasePath(parsed)
  };
}
