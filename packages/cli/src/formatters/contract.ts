import { authorizeContextExport,type RepoContract } from "@drift/core";
import { contractSummary,waiverReviewItem } from "../domain/contract-materialization.js";

export function formatContractShowText(payload: {
  contract: RepoContract;
  contract_fingerprint: string;
  policy: ReturnType<typeof authorizeContextExport>;
}): string {
  const conventionRows = payload.contract.conventions.length > 0
    ? payload.contract.conventions.map((convention) =>
        `${convention.id} ${convention.kind} ${convention.severity}/${convention.enforcement_mode} ${convention.enforcement_capability}`
      )
    : ["  none"];

  return [
    "Drift contract",
    "",
    `Repo: ${payload.contract.repo_id}`,
    `Contract: ${payload.contract.id}`,
    `Fingerprint: ${payload.contract_fingerprint}`,
    `Schema version: ${payload.contract.contract_schema_version}`,
    `Updated: ${payload.contract.updated_at}`,
    `Mode: ${payload.contract.context_egress.default_mode}`,
    `Policy: ${payload.policy.allowed ? "allowed" : "denied"} (${payload.policy.mode})`,
    `Conventions: ${payload.contract.conventions.length}`,
    `Waivers: ${payload.contract.waivers.length}`,
    `Required checks: ${payload.contract.required_checks.length}`,
    `Safe commands: ${payload.contract.safe_commands.length}`,
    "",
    "Accepted conventions:",
    ...conventionRows.map((row) => `  ${row}`),
    ""
  ].join("\n");
}

export function formatContractValidationText(payload: {
  valid: boolean;
  dry_run?: boolean;
  write_intent?: boolean;
  confirm_command?: string | null;
  repo_id: string;
  contract_id: string;
  contract_fingerprint?: string;
  schema_version: number;
  supported_schema_version?: number;
  convention_count: number;
  compatibility?: {
    compatible: boolean;
    reasons?: string[];
  };
}): string {
  return [
    "Drift contract",
    "",
    `Valid: ${payload.valid}`,
    `Repo: ${payload.repo_id}`,
    `Contract: ${payload.contract_id}`,
    payload.contract_fingerprint ? `Fingerprint: ${payload.contract_fingerprint}` : "",
    `Schema version: ${payload.schema_version}`,
    payload.supported_schema_version !== undefined
      ? `Supported schema version: ${payload.supported_schema_version}`
      : "",
    `Conventions: ${payload.convention_count}`,
    payload.compatibility
      ? `Compatibility: ${payload.compatibility.compatible ? "compatible" : "incompatible"}`
      : "",
    payload.compatibility?.reasons?.length
      ? `Reasons: ${payload.compatibility.reasons.join(", ")}`
      : "",
    payload.dry_run !== undefined ? `Dry run: ${payload.dry_run}` : "",
    payload.write_intent !== undefined ? `Write intent: ${payload.write_intent}` : "",
    payload.confirm_command ? `Confirm import: ${payload.confirm_command}` : "",
    ""
  ].filter((line) => line !== "").join("\n");
}

export function formatContractExportText(payload: {
  contract: RepoContract;
  contract_fingerprint: string;
  export: {
    output_path: string | null;
    format: string;
    write_intent: boolean;
    checksum_sha256: string;
    size_bytes: number;
  };
}): string {
  return [
    "Drift contract export",
    "",
    `Repo: ${payload.contract.repo_id}`,
    `Contract: ${payload.contract.id}`,
    `Fingerprint: ${payload.contract_fingerprint}`,
    `Format: ${payload.export.format}`,
    `Output: ${payload.export.output_path ?? "stdout"}`,
    `Write intent: ${payload.export.write_intent}`,
    `Checksum: ${payload.export.checksum_sha256}`,
    `Size: ${payload.export.size_bytes} bytes`,
    ""
  ].join("\n");
}

export function formatContractWaiverText(payload: {
  repo_id: string;
  changed: boolean;
  waiver: RepoContract["waivers"][number];
  contract_summary: ReturnType<typeof contractSummary>;
  next_commands: string[];
}): string {
  return [
    "Drift contract waiver",
    "",
    `Repo: ${payload.repo_id}`,
    `Changed: ${payload.changed}`,
    `Waiver: ${payload.waiver.id}`,
    `Reason: ${payload.waiver.reason}`,
    `Paths: ${(payload.waiver.path_globs ?? []).join(", ") || "none"}`,
    `Symbols: ${(payload.waiver.symbols ?? []).join(", ") || "none"}`,
    `Imports: ${(payload.waiver.imports ?? []).join(", ") || "none"}`,
    `Expires: ${payload.waiver.expires_at ?? "never"}`,
    `Waivers: ${payload.contract_summary.waiver_count}`,
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function formatContractWaiverListText(payload: {
  repo_id: string;
  status: "active" | "expired" | "all";
  path: string | null;
  summary: {
    total_count: number;
    active_count: number;
    expired_count: number;
    listed_count: number;
  };
  review_items: Array<{ id: string; status: "active" | "expired"; reason: string }>;
  next_commands: string[];
}): string {
  const rows = payload.review_items.length > 0
    ? payload.review_items.map((waiver) => `  ${waiver.id} ${waiver.status} - ${waiver.reason}`)
    : ["  none"];
  return [
    "Drift contract waivers",
    "",
    `Repo: ${payload.repo_id}`,
    `Status: ${payload.status}`,
    `Path: ${payload.path ?? "all"}`,
    `Total: ${payload.summary.total_count}`,
    `Active: ${payload.summary.active_count}`,
    `Expired: ${payload.summary.expired_count}`,
    "",
    "Waivers:",
    ...rows,
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function formatContractWaiverShowText(payload: {
  repo_id: string;
  waiver: RepoContract["waivers"][number];
  review_item: ReturnType<typeof waiverReviewItem>;
  contract_summary: ReturnType<typeof contractSummary>;
  next_commands: string[];
}): string {
  return [
    "Drift contract waiver",
    "",
    `Repo: ${payload.repo_id}`,
    `Waiver: ${payload.waiver.id}`,
    `Status: ${payload.review_item.status}`,
    `Reason: ${payload.waiver.reason}`,
    `Paths: ${(payload.waiver.path_globs ?? []).join(", ") || "none"}`,
    `Symbols: ${(payload.waiver.symbols ?? []).join(", ") || "none"}`,
    `Imports: ${(payload.waiver.imports ?? []).join(", ") || "none"}`,
    `Expires: ${payload.waiver.expires_at ?? "never"}`,
    `Waivers: ${payload.contract_summary.waiver_count}`,
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function formatContractWaiverRemoveText(payload: {
  repo_id: string;
  changed: boolean;
  removed_waiver_id: string;
  contract_summary: ReturnType<typeof contractSummary>;
  next_commands: string[];
}): string {
  return [
    "Drift contract waiver removed",
    "",
    `Repo: ${payload.repo_id}`,
    `Changed: ${payload.changed}`,
    `Waiver: ${payload.removed_waiver_id}`,
    `Remaining waivers: ${payload.contract_summary.waiver_count}`,
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}
