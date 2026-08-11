import type { RepoContract } from "@drift/core";
import { defaultSafeCommandsForRepo,uniqueSorted } from "./contract-materialization.js";
import type { GraphPreflightContext } from "./graph-preflight.js";
import type { PreparedRequiredCheck,RelevantFile } from "./preflight.js";

export function requiredChecksFromGraphRisk(input: {
  repoRoot: string;
  graphContext: GraphPreflightContext;
  relevantFiles: RelevantFile[];
  safeCommands: RepoContract["safe_commands"];
}): PreparedRequiredCheck[] {
  if (!input.graphContext.available || input.graphContext.reachable_data_access.length === 0) {
    return [];
  }

  const relevantPaths = new Set(input.relevantFiles.map((file) => file.path));
  const command = firstTestCommand(input.safeCommands) ??
    firstTestCommand(defaultSafeCommandsForRepo(input.repoRoot));
  if (!command) {
    return [];
  }

  const checks = new Map<string, PreparedRequiredCheck>();
  for (const access of input.graphContext.reachable_data_access) {
    if (!access.path || !relevantPaths.has(access.path)) {
      continue;
    }
    const riskKinds = uniqueSorted(access.risk_reasons
      .map((reason) => reason.risk_kind)
      .filter((riskKind) => riskKind === "data_write" || riskKind === "data_delete"));
    if (riskKinds.length === 0) {
      continue;
    }
    const evidenceNodeIds = uniqueSorted(access.data_operations
      .filter((operation) =>
        operation.operation_kind === "write" || operation.operation_kind === "delete"
      )
      .flatMap((operation) => [
        operation.operation_node_id,
        operation.data_store_node_id
      ])
      .filter((id): id is string => Boolean(id)));
    const key = `${command.command}\0${access.path}\0${riskKinds.join(",")}`;
    checks.set(key, {
      command: command.command,
      applies_to: {
        path_globs: [access.path],
        file_roles: ["api_route"]
      },
      reason: `Graph risk: ${access.path} reaches ${riskKinds.join(", ")} data operations; run API/service tests before finishing.`,
      source: "graph_risk",
      evidence_node_ids: evidenceNodeIds,
      risk_kinds: riskKinds,
      matched_files: [access.path]
    });
  }

  return [...checks.values()].sort((left, right) =>
    `${left.command}:${left.matched_files.join(",")}`.localeCompare(`${right.command}:${right.matched_files.join(",")}`)
  );
}

function firstTestCommand(commands: RepoContract["safe_commands"]): RepoContract["safe_commands"][number] | undefined {
  return commands.find((command) => /\b(test|vitest|jest)\b/.test(command.command));
}
