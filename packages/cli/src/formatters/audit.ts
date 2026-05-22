import type { AuditChainVerification,AuditEvent } from "@drift/core";

export function formatAuditListText(payload: {
  repo_id: string;
  since?: string | null;
  until?: string | null;
  total_count: number;
  filtered_count: number;
  count: number;
  pagination: {
    limit: number | null;
    offset: number;
    returned_count: number;
    has_more: boolean;
    next_offset: number | null;
  };
  audit_integrity?: AuditChainVerification;
  events: AuditEvent[];
  next_commands?: string[];
}): string {
  const nextCommands = payload.next_commands ?? [];
  return [
    "Drift audit log",
    "",
    `Repo: ${payload.repo_id}`,
    `Since: ${payload.since ?? "beginning"}`,
    `Until: ${payload.until ?? "latest"}`,
    `Total: ${payload.total_count}`,
    `Filtered: ${payload.filtered_count}`,
    `Events: ${payload.count}`,
    `Offset: ${payload.pagination.offset}`,
    `Limit: ${payload.pagination.limit ?? "none"}`,
    `Next offset: ${payload.pagination.next_offset ?? "none"}`,
    `Audit valid: ${payload.audit_integrity?.valid ? "yes" : "no"}`,
    "",
    ...payload.events.map((event) =>
      `${event.created_at} ${event.action} ${event.target_type}:${event.target_id} by ${event.actor}`
    ),
    nextCommands.length > 0 ? "" : "",
    nextCommands.length > 0 ? "Next commands:" : "",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function formatAuditVerifyText(payload: {
  repo_id: string;
  verification: AuditChainVerification;
  next_commands?: string[];
}): string {
  const nextCommands = payload.next_commands ?? [];
  return [
    "Drift audit verification",
    "",
    `Repo: ${payload.repo_id}`,
    `Valid: ${payload.verification.valid ? "yes" : "no"}`,
    `Events: ${payload.verification.event_count}`,
    `Verified: ${payload.verification.verified_count}`,
    `Head hash: ${payload.verification.head_event_hash ?? "none"}`,
    `Broken at: ${payload.verification.broken_at_event_id ?? "none"}`,
    payload.verification.reasons.length > 0
      ? `Reasons: ${payload.verification.reasons.join(", ")}`
      : "Reasons: none",
    nextCommands.length > 0 ? "" : "",
    nextCommands.length > 0 ? "Next commands:" : "",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}
