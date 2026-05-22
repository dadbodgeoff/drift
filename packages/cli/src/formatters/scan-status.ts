import type { AuditChainVerification,ScanManifest } from "@drift/core";
import { ScanStatusChangeSet } from "../domain/scan-status.js";

export function formatScanStatusText(payload: {
  repo_id: string;
  repo_root: string;
  latest_scan: ScanManifest | null;
  scan_fingerprint: string | null;
  indexed_file_count: number;
  source_change_count: number;
  audit_integrity?: AuditChainVerification;
  stale: boolean;
  invalidation_reasons?: string[];
  changes: ScanStatusChangeSet;
  next_command: string;
  next_commands?: string[];
}): string {
  const nextCommands = payload.next_commands ?? [payload.next_command];
  return [
    "Drift scan status",
    "",
    `Repo: ${payload.repo_id}`,
    `Root: ${payload.repo_root}`,
    `Latest scan: ${payload.latest_scan?.id ?? "none"}`,
    `Scan fingerprint: ${payload.scan_fingerprint ?? "none"}`,
    `Indexed files: ${payload.indexed_file_count}`,
    `Source changes: ${payload.source_change_count}`,
    `State: ${payload.stale ? "stale" : "fresh"}`,
    `Audit: ${payload.audit_integrity?.valid ? "valid" : "invalid"}`,
    "",
    `Added: ${payload.changes.added.length}`,
    `Modified: ${payload.changes.modified.length}`,
    `Deleted: ${payload.changes.deleted.length}`,
    `Invalidations: ${payload.invalidation_reasons?.join(", ") || "none"}`,
    "",
    nextCommands.length === 1 ? "Next command:" : "Next commands:",
    ...nextCommands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}
