import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath,resolveRepoRoot } from "../args/repo-flags.js";
import { auditEvent } from "../domain/governance.js";
import { hashStable,repoIdForRoot,sanitizeAuditId } from "../domain/identifiers.js";
import { runScanRepo,scanStatusPayload } from "../domain/scan-status.js";
import { formatScanStatusText } from "../formatters/scan-status.js";

export async function scanRepo(storage: SqliteDriftStorage, parsed: ParsedArgs) {
  return runScanRepo(storage, {
    now: stringFlag(parsed, "now") ?? new Date().toISOString(),
    repoRoot: resolveRepoRoot(parsed),
    actor: actorFlag(parsed),
    databasePath: requiredDatabasePath(parsed)
  });
}

export function scanStatus(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = stringFlag(parsed, "repo") ?? repoIdForRoot(resolveRepoRoot(parsed));
  const payload = scanStatusPayload(storage, repoId);
  auditScanInvalidationIfNeeded(storage, parsed, payload);

  return {
    payload: parsed.flags.has("json") ? payload : formatScanStatusText(payload)
  };
}

export function auditScanInvalidationIfNeeded(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  payload: ReturnType<typeof scanStatusPayload>
): void {
  if (!payload.stale || !payload.latest_scan) {
    return;
  }

  const invalidationKey = hashStable(JSON.stringify({
    scan_id: payload.latest_scan.id,
    reasons: payload.invalidation_reasons,
    changes: payload.changes
  })).slice(0, 16);
  const eventId = sanitizeAuditId(`audit_event_scan_invalidated_${payload.repo_id}_${payload.latest_scan.id}_${invalidationKey}`);
  if (storage.listAuditEvents(payload.repo_id).some((event) => event.id === eventId)) {
    return;
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  storage.appendAuditEvent(auditEvent({
    id: eventId,
    repoId: payload.repo_id,
    actor: actorFlag(parsed),
    action: "scan_invalidated",
    targetType: "scan",
    targetId: payload.latest_scan.id,
    metadata: {
      latest_scan_id: payload.latest_scan.id,
      invalidation_reasons: payload.invalidation_reasons,
      added: payload.changes.added,
      modified: payload.changes.modified,
      deleted: payload.changes.deleted
    },
    createdAt: now
  }));
}
