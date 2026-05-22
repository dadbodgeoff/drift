import { createHash } from "node:crypto";
import type { AuditEvent } from "./domain.js";

export type AuditChainFailureReason =
  | "previous_event_hash_mismatch"
  | "event_hash_missing"
  | "event_hash_mismatch";

export interface AuditChainVerification {
  repo_id: string;
  valid: boolean;
  event_count: number;
  verified_count: number;
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
