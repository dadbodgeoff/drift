import { authorizeContextExport } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { optionalAuditActionFlag,optionalIsoTimestampFlag,optionalNonEmptyFlag,optionalNonNegativeIntegerFlag,optionalPositiveIntegerFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { auditListNextCommands,auditListSummary,auditVerifyNextCommands,auditVerifySummary } from "../domain/audit-review.js";
import { preflightGovernance } from "../domain/governance.js";
import { orderAuditEventsForReview,paginateAuditEvents,paginationSummary } from "../domain/pagination.js";
import { repoContractOrDefault,requiredRepo } from "../domain/repo-paths.js";
import { formatAuditListText,formatAuditVerifyText } from "../formatters/audit.js";

export function listAudit(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = repoContractOrDefault(storage, repoId);
  const policy = authorizeContextExport(contract, "log");
  if (!policy.allowed) {
    throw new Error(`Policy denied audit output: ${policy.reason}`);
  }
  const limit = optionalPositiveIntegerFlag(parsed, "limit");
  const offset = optionalNonNegativeIntegerFlag(parsed, "offset") ?? 0;
  const action = optionalAuditActionFlag(parsed, "action");
  const actorFilter = optionalNonEmptyFlag(parsed, "actor");
  const targetType = optionalNonEmptyFlag(parsed, "target-type");
  const targetId = optionalNonEmptyFlag(parsed, "target-id");
  const since = optionalIsoTimestampFlag(parsed, "since");
  const until = optionalIsoTimestampFlag(parsed, "until");
  if (since && until && since > until) {
    throw new Error("--since must be before or equal to --until.");
  }
  const allEvents = storage.listAuditEvents(repoId);
  const filteredEvents = allEvents
    .filter((event) => !action || event.action === action)
    .filter((event) => !actorFilter || event.actor === actorFilter)
    .filter((event) => !targetType || event.target_type === targetType)
    .filter((event) => !targetId || event.target_id === targetId)
    .filter((event) => !since || event.created_at >= since)
    .filter((event) => !until || event.created_at <= until);
  const orderedEvents = orderAuditEventsForReview(filteredEvents);
  const events = paginateAuditEvents(orderedEvents, limit, offset);
  const verification = storage.verifyAuditChain(repoId);
  const payload = {
    repo_id: repoId,
    action: action ?? null,
    actor: actorFilter ?? null,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    since: since ?? null,
    until: until ?? null,
    policy,
    governance: preflightGovernance(),
    total_count: allEvents.length,
    filtered_count: filteredEvents.length,
    count: events.length,
    pagination: paginationSummary(filteredEvents.length, events.length, limit, offset),
    audit_integrity: verification,
    summary: auditListSummary({
      totalCount: allEvents.length,
      filteredCount: filteredEvents.length,
      listedCount: events.length,
      verification
    }),
    events,
    next_commands: auditListNextCommands(repoId)
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatAuditListText(payload)
  };
}

export function verifyAudit(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = repoContractOrDefault(storage, repoId);
  const policy = authorizeContextExport(contract, "log");
  if (!policy.allowed) {
    throw new Error(`Policy denied audit output: ${policy.reason}`);
  }
  const verification = storage.verifyAuditChain(repoId);
  const payload = {
    repo_id: repoId,
    policy,
    governance: preflightGovernance(),
    verification,
    summary: auditVerifySummary(verification),
    next_commands: auditVerifyNextCommands(repoId, verification)
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatAuditVerifyText(payload)
  };
}
