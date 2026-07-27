import { authorizeContextExport,DRIFT_CONTRACT_SCHEMA_VERSION,type RepoContract,RepoContractSchema } from "@drift/core";
import { buildRepoContractReadModel } from "@drift/query";
import type { SqliteDriftStorage } from "@drift/storage";
import { existsSync,mkdirSync,statSync,writeFileSync } from "node:fs";
import { dirname,extname,join } from "node:path";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { actorFlag,optionalChecksumFlag,optionalIsoTimestampFlag,optionalNonEmptyFlag,optionalRepoRelativeFlag,optionalWaiverStatusFlag,rejectAmbiguousDryRunConfirm,requiredNonEmptyFlag,stringFlag } from "../args/flag-readers.js";
import { requiredDatabasePath,resolveRepoId } from "../args/repo-flags.js";
import { assertUniqueImportedConventionIds,contractImportConfirmCommand,contractSummary,contractWaiverListNextCommands,contractWaiverNextCommands,contractWaiverShowNextCommands,hasUniqueActiveWaiverSelectors,hasUniqueAgentPermissions,hasUniqueCommands,hasUniqueConventionExceptionIds,hasUniqueIds,summarizeImportedConventions,waiverListSummary,waiverMatchesPath,waiverReviewItem,waiverSelectorKey } from "../domain/contract-materialization.js";
import { auditEvent,mutationGovernance,preflightGovernance } from "../domain/governance.js";
import { contractFingerprint,contractWaiverId,hashStable } from "../domain/identifiers.js";
import { requiredRepo,requiredRepoContract } from "../domain/repo-paths.js";
import { formatContractExportText,formatContractShowText,formatContractValidationText,formatContractWaiverListText,formatContractWaiverRemoveText,formatContractWaiverShowText,formatContractWaiverText } from "../formatters/contract.js";
import { fileContentHash } from "../io/file-hash.js";
import { parseContractFile } from "../io/json-file.js";

export function showContract(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "contract-export");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract show: ${policy.reason}`);
  }
  const payload = buildRepoContractReadModel({
    repo_id: repoId,
    contract,
    policy,
    governance: preflightGovernance()
  });
  return {
    payload: parsed.flags.has("json") ? payload : formatContractShowText(payload)
  };
}

export function validateContract(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "contract-export");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract validate: ${policy.reason}`);
  }
  RepoContractSchema.parse(contract);
  const validationReasons = contractValidationReasons(contract);
  const payload = {
    valid: validationReasons.length === 0,
    repo_id: repoId,
    policy,
    governance: preflightGovernance(),
    contract_id: contract.id,
    contract_fingerprint: contractFingerprint(contract),
    schema_version: contract.contract_schema_version,
    supported_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    convention_count: contract.conventions.length,
    agent_contract_count: contract.agent_contracts?.length ?? 0,
    compatibility: {
      compatible: validationReasons.length === 0,
      reasons: validationReasons
    }
  };
  return {
    exitCode: validationReasons.length === 0 ? 0 : 1,
    payload: parsed.flags.has("json") ? payload : formatContractValidationText(payload)
  };
}

export function exportContract(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const format = stringFlag(parsed, "format") ?? "json";
  const outputPath = stringFlag(parsed, "output");
  if (format !== "json") {
    throw new Error("--format must be json.");
  }
  if (parsed.flags.has("force") && !outputPath) {
    throw new Error("--force requires --output for contract export.");
  }
  const contract = requiredRepoContract(storage, repoId);
  if (!parsed.flags.has("confirm")) {
    throw new Error("Contract export requires --confirm.");
  }

  const policy = authorizeContextExport(contract, "contract-export");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract export: ${policy.reason}`);
  }
  const contract_fingerprint = contractFingerprint(contract);
  const exportedContractJson = `${JSON.stringify(contract, null, 2)}\n`;
  if (outputPath) {
    if (existsSync(outputPath) && statSync(outputPath).isDirectory()) {
      throw new Error("Contract export output must be a file path.");
    }
    if (extname(outputPath) !== ".json") {
      throw new Error("Contract export output must end with .json.");
    }
    if (existsSync(outputPath) && !parsed.flags.has("force")) {
      throw new Error("Contract export output already exists. Pass --force to overwrite it.");
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, exportedContractJson);
  }
  const exportRecord = {
    output_path: outputPath ?? null,
    format,
    write_intent: Boolean(outputPath),
    contract_fingerprint,
    checksum_sha256: hashStable(exportedContractJson),
    size_bytes: Buffer.byteLength(exportedContractJson)
  };
  storage.appendAuditEvent(auditEvent({
    id: `audit_event_contract_export_${repoId}_${now}`,
    repoId,
    actor,
    action: "contract_exported",
    targetType: "contract",
    targetId: contract.id,
    metadata: {
      format,
      output_path: outputPath ?? null,
      checksum_sha256: exportRecord.checksum_sha256,
      surface: policy.surface,
      mode: policy.mode
    },
    createdAt: now
  }));
  const payload = {
    contract,
    contract_fingerprint,
    policy,
    export: exportRecord
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatContractExportText(payload)
  };
}

export function importContractDryRun(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  contractPath: string
): CommandPayload {
  const dryRun = parsed.flags.has("dry-run");
  rejectAmbiguousDryRunConfirm(parsed);
  if (!dryRun && !parsed.flags.has("confirm")) {
    throw new Error("Contract import requires --confirm unless --dry-run is used.");
  }
  if (!existsSync(contractPath)) {
    throw new Error(`Contract file not found: ${contractPath}`);
  }
  if (!statSync(contractPath).isFile()) {
    throw new Error(`Contract path must be a file: ${contractPath}`);
  }
  const expectedChecksum = optionalChecksumFlag(parsed, "checksum");
  if (parsed.flags.has("require-checksum") && !expectedChecksum) {
    throw new Error("Contract import requires --checksum when --require-checksum is used.");
  }
  const checksum = fileContentHash(contractPath);
  if (expectedChecksum && expectedChecksum !== checksum) {
    throw new Error(`Contract checksum mismatch: expected ${expectedChecksum}, got ${checksum}.`);
  }
  const contract = parseContractFile(contractPath);
  assertUniqueImportedConventionIds(contract);
  const expectedRepoId = stringFlag(parsed, "repo") ?? contract.repo_id;
  const existingContract = storage.getRepoContract(expectedRepoId);
  const policy = existingContract ? authorizeContextExport(existingContract, "contract-export") : null;
  if (policy && !policy.allowed) {
    throw new Error(`Policy denied contract import: ${policy.reason}`);
  }
  const repo = storage.getRepo(expectedRepoId);
  const expectedFingerprint = existingContract?.repo_fingerprint ?? repo?.fingerprint;
  const conventionImportSummary = summarizeImportedConventions(existingContract, contract);
  const contract_fingerprint = contractFingerprint(contract);
  const existing_contract_fingerprint = existingContract ? contractFingerprint(existingContract) : null;
  const wouldUpdate = !existingContract ||
    existing_contract_fingerprint !== contract_fingerprint;
  const schemaSupported = contract.contract_schema_version <= DRIFT_CONTRACT_SCHEMA_VERSION;
  const conventionContractIdsMatch = contract.conventions.every((convention) =>
    convention.contract_id === contract.id
  );
  const agentContractIdsUnique = hasUniqueIds((contract.agent_contracts ?? []).map((entry) => entry.id));
  const agentPermissionsUnique = hasUniqueAgentPermissions(contract.agent_permissions);
  const exceptionIdsUnique = hasUniqueConventionExceptionIds(contract);
  const waiverIdsUnique = hasUniqueIds(contract.waivers.map((waiver) => waiver.id));
  const waiverSelectorsUnique = waiverIdsUnique
    ? hasUniqueActiveWaiverSelectors(contract.waivers)
    : true;
  const requiredChecksUnique = hasUniqueCommands(contract.required_checks);
  const safeCommandsUnique = hasUniqueCommands(contract.safe_commands);
  const riskyAreaIdsUnique = hasUniqueIds(contract.risky_areas.map((area) => area.id));
  const deniedGlobsUnique = hasUniqueIds(contract.context_egress.denied_globs);
  const rejectedInferencesUnique = hasUniqueIds(
    contract.rejected_inferences.map((inference) => inference.candidate_id)
  );
  const compatibilityReasons = [
    !repo ? "target_repo_missing" : undefined,
    expectedRepoId !== contract.repo_id ? "repo_id_mismatch" : undefined,
    expectedFingerprint && expectedFingerprint !== contract.repo_fingerprint
      ? "repo_fingerprint_mismatch"
      : undefined,
    !schemaSupported ? "contract_schema_unsupported" : undefined,
    !conventionContractIdsMatch ? "convention_contract_ids_mismatch" : undefined,
    !agentContractIdsUnique ? "duplicate_agent_contract_ids" : undefined,
    !agentPermissionsUnique ? "duplicate_agent_permissions" : undefined,
    !exceptionIdsUnique ? "duplicate_exception_ids" : undefined,
    !waiverIdsUnique ? "duplicate_waiver_ids" : undefined,
    !waiverSelectorsUnique ? "duplicate_waiver_selectors" : undefined,
    !requiredChecksUnique ? "duplicate_required_checks" : undefined,
    !safeCommandsUnique ? "duplicate_safe_commands" : undefined,
    !riskyAreaIdsUnique ? "duplicate_risky_area_ids" : undefined,
    !deniedGlobsUnique ? "duplicate_denied_globs" : undefined,
    !rejectedInferencesUnique ? "duplicate_rejected_inferences" : undefined,
    ...contractValidationReasons(contract)
  ].filter((reason): reason is string => Boolean(reason));
  const compatibility = {
    compatible: compatibilityReasons.length === 0,
    target_repo_exists: Boolean(repo),
    repo_id_matches: expectedRepoId === contract.repo_id,
    repo_fingerprint_matches: expectedFingerprint
      ? expectedFingerprint === contract.repo_fingerprint
      : null,
    schema_supported: schemaSupported,
    supported_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    convention_contract_ids_match: conventionContractIdsMatch,
    agent_contract_ids_unique: agentContractIdsUnique,
    agent_permissions_unique: agentPermissionsUnique,
    exception_ids_unique: exceptionIdsUnique,
    waiver_ids_unique: waiverIdsUnique,
    waiver_selectors_unique: waiverSelectorsUnique,
    required_checks_unique: requiredChecksUnique,
    safe_commands_unique: safeCommandsUnique,
    risky_area_ids_unique: riskyAreaIdsUnique,
    denied_globs_unique: deniedGlobsUnique,
    rejected_inferences_unique: rejectedInferencesUnique,
    expected_repo_id: expectedRepoId,
    expected_repo_fingerprint: expectedFingerprint ?? null,
    reasons: compatibilityReasons
  };
  const confirmCommand = compatibility.compatible
    ? contractImportConfirmCommand({
        databasePath: requiredDatabasePath(parsed),
        contractPath,
        repoId: expectedRepoId
      })
    : null;
  const payload = {
    valid: true,
    dry_run: dryRun,
    imported: false,
    repo_id: contract.repo_id,
    contract_id: contract.id,
    schema_version: contract.contract_schema_version,
    supported_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    policy,
    checksum_sha256: checksum,
    checksum_matches: expectedChecksum ? expectedChecksum === checksum : null,
    contract_fingerprint,
    existing_contract_fingerprint,
    write_intent: !dryRun,
    confirm_command: dryRun ? confirmCommand : null,
    convention_count: contract.conventions.length,
    agent_contract_count: contract.agent_contracts?.length ?? 0,
    would_update: wouldUpdate,
    added_convention_count: conventionImportSummary.added_count,
    changed_convention_count: conventionImportSummary.changed_count,
    removed_convention_count: conventionImportSummary.removed_count,
    unchanged_convention_count: conventionImportSummary.unchanged_count,
    compatibility
  };
  if (!compatibility.compatible || dryRun) {
    return {
      exitCode: compatibility.compatible ? 0 : 1,
      payload: parsed.flags.has("json") ? payload : formatContractValidationText(payload)
    };
  }
  if (!wouldUpdate) {
    return {
      payload: parsed.flags.has("json") ? payload : formatContractValidationText(payload)
    };
  }

  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  storage.transaction(() => {
    storage.deleteAcceptedConventionsExcept(
      expectedRepoId,
      contract.conventions.map((convention) => convention.id)
    );
    for (const convention of contract.conventions) {
      storage.upsertAcceptedConvention(expectedRepoId, convention);
    }
    storage.upsertRepoContract(contract);
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_contract_import_${expectedRepoId}_${now}`,
      repoId: expectedRepoId,
      actor,
      action: "contract_imported",
      targetType: "contract",
      targetId: contract.id,
      metadata: {
        contract_path: contractPath,
        convention_count: contract.conventions.length,
        agent_contract_count: contract.agent_contracts?.length ?? 0,
        added_convention_count: conventionImportSummary.added_count,
        changed_convention_count: conventionImportSummary.changed_count,
        removed_convention_count: conventionImportSummary.removed_count,
        unchanged_convention_count: conventionImportSummary.unchanged_count,
        surface: policy?.surface ?? "contract-export",
        mode: policy?.mode ?? null
      },
      createdAt: now
    }));
  });

  const importedPayload = {
    ...payload,
    imported: true
  };
  return {
    payload: parsed.flags.has("json") ? importedPayload : formatContractValidationText(importedPayload)
  };
}

export function addContractWaiver(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const repo = requiredRepo(storage, repoId);
  if (!parsed.flags.has("confirm")) {
    throw new Error("Contract waiver changes require --confirm.");
  }

  const path = optionalRepoRelativeFlag(parsed, "path");
  const symbol = optionalNonEmptyFlag(parsed, "symbol");
  const importSource = optionalNonEmptyFlag(parsed, "import");
  if (!path && !symbol && !importSource) {
    throw new Error("Contract waiver requires at least one of --path, --symbol, or --import.");
  }

  const reason = requiredNonEmptyFlag(parsed, "reason");
  const expiresAt = optionalIsoTimestampFlag(parsed, "expires-at");
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const approvedFileHashes = parsed.flags.has("reapprove-on-change") && path && !path.includes("*")
    ? approvedFileHashForPath(repo.root_path, path)
    : [];
  const waiver = {
    id: contractWaiverId(repoId, path, symbol, importSource),
    reason,
    ...(path ? { path_globs: [path] } : {}),
    ...(symbol ? { symbols: [symbol] } : {}),
    ...(importSource ? { imports: [importSource] } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    ...(parsed.flags.has("reapprove-on-change") ? { requires_reapproval_on_change: true } : {}),
    ...(approvedFileHashes.length > 0 ? { approved_file_hashes: approvedFileHashes } : {}),
    created_by: actor,
    created_at: now
  };

  const duplicate = contract.waivers.some((entry) =>
    waiverSelectorKey(entry) === waiverSelectorKey(waiver)
  );

  if (duplicate) {
    return {
      payload: parsed.flags.has("json")
        ? {
            repo_id: repoId,
            changed: false,
            waiver,
            contract,
            governance: mutationGovernance(),
            contract_summary: contractSummary(contract),
            next_commands: contractWaiverNextCommands(repoId)
          }
        : formatContractWaiverText({
            repo_id: repoId,
            changed: false,
            waiver,
            contract_summary: contractSummary(contract),
            next_commands: contractWaiverNextCommands(repoId)
          })
    };
  }

  const updatedContract: RepoContract = {
    ...contract,
    waivers: [...contract.waivers, waiver],
    updated_at: now
  };
  const beforeHash = contractFingerprint(contract);
  const afterHash = contractFingerprint(updatedContract);
  storage.transaction(() => {
    storage.upsertRepoContract(updatedContract);
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_contract_waiver_${repoId}_${waiver.id}_${now}`,
      repoId,
      actor,
      action: "policy_changed",
      targetType: "contract_waiver",
      targetId: waiver.id,
      metadata: {
        path: path ?? null,
        symbol: symbol ?? null,
        import_source: importSource ?? null,
        expires_at: expiresAt ?? null,
        requires_reapproval_on_change: parsed.flags.has("reapprove-on-change"),
        reason
      },
      createdAt: now,
      beforeHash,
      afterHash,
      objectSchemaVersion: "drift.repo_contract.v1"
    }));
  });

  const payload = {
    repo_id: repoId,
    changed: true,
    waiver,
    contract: updatedContract,
    governance: mutationGovernance(),
    contract_summary: contractSummary(updatedContract),
    next_commands: contractWaiverNextCommands(repoId)
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatContractWaiverText(payload)
  };
}

export function listContractWaivers(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-preflight");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract waiver list: ${policy.reason}`);
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const status = optionalWaiverStatusFlag(parsed, "status") ?? "all";
  const path = optionalRepoRelativeFlag(parsed, "path");
  const reviewItems = contract.waivers.map((waiver) =>
    waiverReviewItem(waiver, now, path && waiverMatchesPath(waiver, path) ? [path] : [])
  );
  const pathFiltered = path
    ? reviewItems.filter((item) => item.matched_files.includes(path))
    : reviewItems;
  const filtered = pathFiltered.filter((item) => status === "all" || item.status === status);
  const payload = {
    repo_id: repoId,
    status,
    path: path ?? null,
    policy,
    governance: preflightGovernance(),
    summary: waiverListSummary(reviewItems, filtered),
    review_items: filtered,
    waivers: contract.waivers.filter((waiver) =>
      filtered.some((item) => item.id === waiver.id)
    ),
    next_commands: contractWaiverListNextCommands(repoId)
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatContractWaiverListText(payload)
  };
}

export function showContractWaiver(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  waiverId: string
): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-preflight");
  if (!policy.allowed) {
    throw new Error(`Policy denied contract waiver show: ${policy.reason}`);
  }
  const waiver = contract.waivers.find((entry) => entry.id === waiverId);
  if (!waiver) {
    throw new Error(`Contract waiver not found: ${waiverId}.`);
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const payload = {
    repo_id: repoId,
    waiver,
    review_item: waiverReviewItem(waiver, now),
    policy,
    governance: preflightGovernance(),
    contract_summary: contractSummary(contract),
    next_commands: contractWaiverShowNextCommands(repoId, waiverId)
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatContractWaiverShowText(payload)
  };
}

export function removeContractWaiver(
  storage: SqliteDriftStorage,
  parsed: ParsedArgs,
  waiverId: string
): CommandPayload {
  const repoId = resolveRepoId(parsed);
  requiredRepo(storage, repoId);
  if (!parsed.flags.has("confirm")) {
    throw new Error("Contract waiver removal requires --confirm.");
  }
  const now = stringFlag(parsed, "now") ?? new Date().toISOString();
  const actor = actorFlag(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const existing = contract.waivers.find((waiver) => waiver.id === waiverId);
  if (!existing) {
    throw new Error(`Contract waiver not found: ${waiverId}.`);
  }
  const updatedContract: RepoContract = {
    ...contract,
    waivers: contract.waivers.filter((waiver) => waiver.id !== waiverId),
    updated_at: now
  };
  const beforeHash = contractFingerprint(contract);
  const afterHash = contractFingerprint(updatedContract);
  storage.transaction(() => {
    storage.upsertRepoContract(updatedContract);
    storage.appendAuditEvent(auditEvent({
      id: `audit_event_contract_waiver_remove_${repoId}_${waiverId}_${now}`,
      repoId,
      actor,
      action: "policy_changed",
      targetType: "contract_waiver",
      targetId: waiverId,
      metadata: {
        removed: true,
        reason: existing.reason
      },
      createdAt: now,
      beforeHash,
      afterHash,
      objectSchemaVersion: "drift.repo_contract.v1"
    }));
  });

  const payload = {
    repo_id: repoId,
    changed: Boolean(existing),
    removed_waiver_id: waiverId,
    removed_waiver: existing ?? null,
    contract: updatedContract,
    governance: mutationGovernance(),
    contract_summary: contractSummary(updatedContract),
    next_commands: contractWaiverNextCommands(repoId)
  };
  return {
    payload: parsed.flags.has("json") ? payload : formatContractWaiverRemoveText(payload)
  };
}

function contractValidationReasons(contract: RepoContract): string[] {
  const reasons = new Set<string>();
  for (const convention of contract.conventions) {
    if (
      convention.enforcement_mode === "block" &&
      convention.enforcement_capability !== "deterministic_check"
    ) {
      reasons.add("blocking_non_deterministic_convention");
    }
    if (
      convention.enforcement_mode === "block" &&
      convention.kind === "api_route_forbids_sensitive_response_fields" &&
      candidateSensitiveFields(convention.requires).length > 0
    ) {
      reasons.add("candidate_sensitive_fields_blocking");
    }
  }
  return [...reasons].sort();
}

function candidateSensitiveFields(requires: Record<string, unknown> | undefined): unknown[] {
  const fields = requires?.sensitive_response_fields;
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields.filter((field) =>
    typeof field === "object" &&
    field !== null &&
    "source" in field &&
    (field as { source?: unknown }).source === "candidate"
  );
}

function approvedFileHashForPath(
  repoRoot: string,
  path: string
): Array<{ file_path: string; content_hash: string }> {
  const absolutePath = join(repoRoot, path);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return [];
  }
  return [{
    file_path: path,
    content_hash: fileContentHash(absolutePath)
  }];
}
