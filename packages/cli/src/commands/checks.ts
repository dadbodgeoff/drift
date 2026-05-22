import { authorizeContextExport } from "@drift/core";
import type { SqliteDriftStorage } from "@drift/storage";
import { CommandPayload,ParsedArgs } from "../app/command-types.js";
import { optionalChecksKindFlag,optionalNonNegativeIntegerFlag,optionalPositiveIntegerFlag,optionalRepoRelativeFlag } from "../args/flag-readers.js";
import { resolveRepoId } from "../args/repo-flags.js";
import { preflightGovernance } from "../domain/governance.js";
import { paginationSummary } from "../domain/pagination.js";
import { requiredChecksForPath } from "../domain/preflight.js";
import { requiredRepoContract } from "../domain/repo-paths.js";
import { formatChecksText } from "../formatters/checks.js";

export function listChecks(storage: SqliteDriftStorage, parsed: ParsedArgs): CommandPayload {
  const repoId = resolveRepoId(parsed);
  const contract = requiredRepoContract(storage, repoId);
  const policy = authorizeContextExport(contract, "cli-preflight");
  if (!policy.allowed) {
    throw new Error(`Policy denied checks output: ${policy.reason}`);
  }
  const kind = optionalChecksKindFlag(parsed, "kind") ?? "all";
  const requestedPath = optionalRepoRelativeFlag(parsed, "path");
  const limit = optionalPositiveIntegerFlag(parsed, "limit");
  const offset = optionalNonNegativeIntegerFlag(parsed, "offset") ?? 0;
  const requiredChecks = kind === "safe"
    ? []
    : requestedPath
      ? requiredChecksForPath(contract, requestedPath)
      : contract.required_checks.map((check) => ({ ...check, matched_files: [] }));
  const safeCommands = kind === "required" ? [] : contract.safe_commands;
  const checks = [
    ...requiredChecks.map((check) => ({ type: "required" as const, command: check.command, check })),
    ...safeCommands.map((safeCommand) => ({
      type: "safe" as const,
      command: safeCommand.command,
      safeCommand
    }))
  ].sort((left, right) =>
    left.command.localeCompare(right.command) ||
    left.type.localeCompare(right.type)
  );
  const listedChecks = limit === undefined
    ? checks.slice(offset)
    : checks.slice(offset, offset + limit);
  const listedRequiredChecks = listedChecks.flatMap((entry) => entry.type === "required" ? [entry.check] : []);
  const listedSafeCommands = listedChecks.flatMap((entry) => entry.type === "safe" ? [entry.safeCommand] : []);

  const payload = {
    repo_id: repoId,
    kind,
    path: requestedPath ?? null,
    policy,
    governance: preflightGovernance(),
    contract: {
      id: contract.id,
      schema_version: contract.contract_schema_version,
      updated_at: contract.updated_at
    },
    summary: {
      required_count: listedRequiredChecks.length,
      safe_count: listedSafeCommands.length,
      total_count: listedChecks.length,
      filtered_count: checks.length,
      listed_count: listedChecks.length
    },
    pagination: paginationSummary(checks.length, listedChecks.length, limit, offset),
    required_checks: listedRequiredChecks,
    safe_commands: listedSafeCommands
  };

  return {
    payload: parsed.flags.has("json") ? payload : formatChecksText(payload)
  };
}
