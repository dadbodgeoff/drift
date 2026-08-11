import type { AuditEvent,ConventionKind,ConventionStatus,EnforcementCapability,EnforcementMode,FileRole,FindingDiffStatus,FindingStatus,RepoContract,Severity } from "@drift/core";
import { ParsedArgs } from "../app/command-types.js";
import { BackupArtifactStatusFilter } from "../domain/backup-artifacts.js";
import { isRepoRelativePolicyPattern } from "../domain/repo-paths.js";

export function optionalContextDefaultModeFlag(
  parsed: ParsedArgs,
  name: string
): RepoContract["context_egress"]["default_mode"] | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "local_only" || value === "redacted" || value === "approval_required") {
    return value;
  }
  throw new Error("--default-mode must be local_only, redacted, or approval_required.");
}

export function agentPermissionFlag(
  parsed: ParsedArgs,
  name: string
): RepoContract["agent_permissions"][number]["permissions"][number] {
  const value = requiredFlag(parsed, name);
  if (value === "read_context" || value === "request_preflight" || value === "propose_resolution") {
    return value;
  }
  throw new Error("--permission must be read_context, request_preflight, or propose_resolution.");
}

export function optionalAuditActionFlag(parsed: ParsedArgs, name: string): AuditEvent["action"] | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (isAuditAction(value)) {
    return value;
  }
  throw new Error(`--${name} must be ${AUDIT_ACTIONS.join(", ")}.`);
}

export const AUDIT_ACTIONS = [
  "repo_added",
  "scan_started",
  "scan_completed",
  "scan_failed",
  "election_accepted",
  "election_rejected",
  "election_edited",
  "finding_resolved",
  "finding_suppressed",
  "finding_flagged_for_review",
  "policy_changed",
  "agent_permission_changed",
  "backup_created",
  "restore_completed",
  "contract_exported",
  "contract_imported",
  "adapter_upgraded",
  "scan_invalidated",
  "baseline_created",
  "baseline_cleared",
  "required_check_executed"
] as const satisfies readonly AuditEvent["action"][];

export function isAuditAction(value: string): value is AuditEvent["action"] {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export function optionalFindingStatusFlag(parsed: ParsedArgs, name: string): FindingStatus | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (
    value === "new" ||
    value === "pre_existing" ||
    value === "needs_review" ||
    value === "fixed" ||
    value === "false_positive" ||
    value === "accepted_drift" ||
    value === "suppressed" ||
    value === "expired"
  ) {
    return value;
  }
  throw new Error("--status must be new, pre_existing, needs_review, fixed, false_positive, accepted_drift, suppressed, or expired.");
}

export function optionalChecksKindFlag(parsed: ParsedArgs, name: string): "required" | "safe" | "all" | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "required" || value === "safe" || value === "all") {
    return value;
  }
  throw new Error("--kind must be required, safe, or all.");
}

export function optionalFindingDiffStatusFlag(parsed: ParsedArgs, name: string): FindingDiffStatus | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "new_in_diff" || value === "touched_existing" || value === "outside_diff") {
    return value;
  }
  throw new Error("--diff-status must be new_in_diff, touched_existing, or outside_diff.");
}

export function optionalWaiverStatusFlag(
  parsed: ParsedArgs,
  name: string
): "active" | "expired" | "all" | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "active" || value === "expired" || value === "all") {
    return value;
  }
  throw new Error("--status must be active, expired, or all.");
}

export function optionalFileRoleFlag(parsed: ParsedArgs, name: string): FileRole | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (
    value === "api_route" ||
    value === "server_module" ||
    value === "service_module" ||
    value === "data_access_module" ||
    value === "component" ||
    value === "test" ||
    value === "config"
  ) {
    return value;
  }
  throw new Error(`--${name} must be a supported file role.`);
}

export function optionalSeverityFlag(parsed: ParsedArgs, name: string): Severity | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "info" || value === "warning" || value === "error") {
    return value;
  }
  throw new Error("--severity must be info, warning, or error.");
}

export function optionalConventionStatusFlag(parsed: ParsedArgs, name: string): ConventionStatus | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (
    value === "candidate" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "archived" ||
    value === "expired"
  ) {
    return value;
  }
  throw new Error("--status must be candidate, accepted, rejected, archived, or expired.");
}

export function optionalConventionKindFlag(parsed: ParsedArgs, name: string): ConventionKind | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (
    value === "api_route_no_direct_data_access" ||
    value === "api_route_requires_service_delegation" ||
    value === "api_route_requires_auth_helper" ||
    value === "middleware_must_cover_routes" ||
    value === "api_route_requires_request_validation" ||
    value === "api_route_forbids_untrusted_ssrf" ||
    value === "api_route_forbids_raw_sql_without_params" ||
    value === "api_route_cors_must_match_policy" ||
    value === "api_route_requires_csrf_for_mutation" ||
    value === "api_route_requires_rate_limit" ||
    value === "api_route_forbids_sensitive_response_fields" ||
    value === "api_route_forbids_secret_exposure" ||
    value === "session_object_must_come_from_trusted_helper" ||
    value === "api_route_requires_authorization" ||
    value === "api_route_requires_tenant_scope" ||
    value === "test_expected_for_changed_module" ||
    value === "custom_briefing"
  ) {
    return value;
  }
  throw new Error("--kind must be a supported accepted convention kind.");
}

export function optionalEnforcementCapabilityFlag(parsed: ParsedArgs, name: string): EnforcementCapability | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "briefing_only" || value === "heuristic_check" || value === "deterministic_check") {
    return value;
  }
  throw new Error(`--${name} must be briefing_only, heuristic_check, or deterministic_check.`);
}

export function optionalEnforcementModeFlag(parsed: ParsedArgs, name: string): EnforcementMode | undefined {
  const value = stringFlag(parsed, name);
  if (!value) {
    return undefined;
  }
  if (value === "off" || value === "brief" || value === "warn" || value === "block") {
    return value;
  }
  throw new Error("--mode must be off, brief, warn, or block.");
}

export function withFlags(parsed: ParsedArgs, flags: Record<string, string>): ParsedArgs {
  const next = new Map(parsed.flags);
  for (const [key, value] of Object.entries(flags)) {
    next.set(key, value);
  }
  return {
    positional: parsed.positional,
    flags: next
  };
}

export function requiredFlag(parsed: ParsedArgs, key: string): string {
  return requiredValue(stringFlag(parsed, key), `--${key}`);
}

export function requiredNonEmptyFlag(parsed: ParsedArgs, key: string): string {
  const value = requiredFlag(parsed, key).trim();
  if (!value) {
    throw new Error(`--${key} must not be empty.`);
  }
  return value;
}

export function optionalNonEmptyFlag(parsed: ParsedArgs, key: string): string | undefined {
  if (!parsed.flags.has(key)) {
    return undefined;
  }
  return requiredNonEmptyFlag(parsed, key);
}

export function actorFlag(parsed: ParsedArgs): string {
  return optionalNonEmptyFlag(parsed, "actor") ?? "local-user";
}

export function rejectAmbiguousDryRunConfirm(parsed: ParsedArgs): void {
  if (parsed.flags.has("dry-run") && parsed.flags.has("confirm")) {
    throw new Error("Use either --dry-run or --confirm, not both.");
  }
}

export function requiredRepoRelativeFlag(parsed: ParsedArgs, key: string): string {
  const value = requiredFlag(parsed, key).trim();
  if (!isRepoRelativePolicyPattern(value)) {
    throw new Error(`--${key} must be repo-relative.`);
  }
  return value;
}

export function optionalRepoRelativeFlag(parsed: ParsedArgs, key: string): string | undefined {
  if (!parsed.flags.has(key)) {
    return undefined;
  }
  return requiredRepoRelativeFlag(parsed, key);
}

export function hasAnyFlag(parsed: ParsedArgs, keys: string[]): boolean {
  return keys.some((key) => parsed.flags.has(key));
}

export function optionalPositiveIntegerFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = stringFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return parsedValue;
}

export function optionalNonNegativeIntegerFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = stringFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`--${key} must be a non-negative integer.`);
  }
  return parsedValue;
}

export function optionalBackupArtifactStatusFlag(
  parsed: ParsedArgs,
  key: string
): BackupArtifactStatusFilter | undefined {
  const value = stringFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  if (value !== "present" && value !== "missing" && value !== "checksum_mismatch") {
    throw new Error(`--${key} must be present, missing, or checksum_mismatch.`);
  }
  return value;
}

export function optionalIsoTimestampFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = optionalNonEmptyFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  if (!isIsoTimestamp(value)) {
    throw new Error(`--${key} must be an ISO timestamp.`);
  }
  return value;
}

export function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

export function validateFileLineEvidence(value: string): void {
  const match = /^([^:\n]+):(\d+)$/.exec(value);
  if (!match) {
    throw new Error("--evidence must be formatted as <file>:<line>.");
  }
  const [, filePath, rawLine] = match;
  if (!isRepoRelativePolicyPattern(filePath)) {
    throw new Error("--evidence file must be repo-relative.");
  }
  if (Number(rawLine) <= 0) {
    throw new Error("--evidence line must be positive.");
  }
}

export function optionalChecksumFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = stringFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`--${key} must be a 64-character hex SHA-256 checksum.`);
  }
  return value.toLowerCase();
}

export function stringFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

export function requiredValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}
