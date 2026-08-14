import { createHash } from "node:crypto";
import type { AuditEvent } from "./domain.js";

export type AuditChainFailureReason =
  | "previous_event_hash_mismatch"
  | "event_hash_missing"
  | "event_hash_mismatch"
  | "sequence_missing"
  | "sequence_gap"
  // T-08: a stored event that does not satisfy the audit schema. Tampering, not a Drift bug - a
  // row whose `action` is outside the enum did not get there by accident. Reported as a
  // verification failure so every kind of tampering answers in the same shape, instead of
  // escaping as a raw parse error that exits 1 and reads like a crash.
  | "schema_invalid";

export interface AuditChainVerification {
  repo_id: string;
  valid: boolean;
  strict?: boolean;
  event_count: number;
  verified_count: number;
  head_sequence?: number | null;
  head_event_hash: string | null;
  broken_at_event_id: string | null;
  reasons: AuditChainFailureReason[];
}

export function auditEventHash(
  event: AuditEvent,
  previousEventHash: string | null
): string {
  return createHash("sha256")
    .update(canonicalAuditEventJson(event, previousEventHash))
    .digest("hex");
}

export function canonicalAuditEventJson(
  event: AuditEvent,
  previousEventHash: string | null
): string {
  return `${stableJsonStringify({
    id: event.id,
    repo_id: event.repo_id,
    actor: event.actor,
    action: event.action,
    target_type: event.target_type,
    target_id: event.target_id,
    metadata: event.metadata,
    ...(event.before_hash ? { before_hash: event.before_hash } : {}),
    ...(event.after_hash ? { after_hash: event.after_hash } : {}),
    ...(event.object_schema_version ? { object_schema_version: event.object_schema_version } : {}),
    created_at: event.created_at,
    previous_event_hash: previousEventHash
  })}\n`;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
