import type { ScanManifest } from "@drift/core";
import { createHash } from "node:crypto";

export function baselineScanManifest(input: {
  id: string;
  repoId: string;
  from: string;
  now: string;
  findingCount: number;
}): ScanManifest {
  return {
    id: input.id,
    repo_id: input.repoId,
    branch: input.from,
    commit: input.from,
    dirty: false,
    scanner_version: "0.1.0",
    adapter_versions: { baseline: "0.1.0" },
    rule_engine_version: "0.1.0",
    status: "completed",
    file_count: 0,
    fact_count: 0,
    finding_count: input.findingCount,
    started_at: input.now,
    completed_at: input.now
  };
}

export function inferFilePathFromMessage(message: string): string {
  return message.split(" imports ")[0] || "unknown";
}

export function findingFingerprint(
  conventionId: string,
  filePath: string,
  importName: string,
  importSource: string
): string {
  return createHash("sha256")
    .update("direct-data-access-v1\0")
    .update(conventionId)
    .update("\0")
    .update(filePath.replaceAll("\\", "/"))
    .update("\0")
    .update(importName)
    .update("\0")
    .update(importSource)
    .digest("hex");
}

export function canonicalHelperReuseFindingFingerprint(
  agentContractId: string,
  helperId: string,
  filePath: string,
  symbolName: string
): string {
  return createHash("sha256")
    .update("canonical-helper-reuse-v1\0")
    .update(agentContractId)
    .update("\0")
    .update(helperId)
    .update("\0")
    .update(filePath.replaceAll("\\", "/"))
    .update("\0")
    .update(symbolName)
    .digest("hex");
}

export function agentContractFindingFingerprint(
  kind: string,
  agentContractId: string,
  filePath: string,
  symbolName: string,
  target: string
): string {
  return createHash("sha256")
    .update("agent-contract-v1\0")
    .update(kind)
    .update("\0")
    .update(agentContractId)
    .update("\0")
    .update(filePath.replaceAll("\\", "/"))
    .update("\0")
    .update(symbolName)
    .update("\0")
    .update(target)
    .digest("hex");
}
