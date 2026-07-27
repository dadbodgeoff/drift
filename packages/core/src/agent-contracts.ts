import type {
  AcceptedConvention,
  AgentContract,
  AgentContractSelection,
  AgentPreflightPacket,
  CanonicalHelperReuseAgentContract,
  ConventionException,
  EntrypointFlowAgentContract,
  FileRole,
  ImportBoundaryAgentContract,
  ModulePlacementAgentContract,
  RepoContract
} from "./domain.js";
import {
  AgentContractSelectionSchema,
  AgentPreflightPacketSchema
} from "./schemas.js";

export interface CreateAgentPreflightPacketInput {
  repoContract: RepoContract;
  task: string;
  scan_id: string | null;
  stale: boolean;
  explicit_paths: string[];
  changed_paths: string[];
  file_roles: FileRole[];
  graph_node_ids: string[];
}

export function selectAgentContracts(input: CreateAgentPreflightPacketInput): AgentContractSelection {
  const allPaths = uniqueSorted([...input.explicit_paths, ...input.changed_paths]);
  const selectedContractIds = new Set<string>();
  const selectedConventionIds = new Set<string>();
  const selectedHelperIds = new Set<string>();
  const selectedRequiredChecks = new Set<string>();
  const reasons: AgentContractSelection["reasons"] = [];
  const taskTokens = tokenize(input.task);

  for (const contract of input.repoContract.agent_contracts ?? []) {
    const reason = agentContractSelectionReason(contract, allPaths, input.file_roles, taskTokens);
    if (!reason) {
      continue;
    }
    selectedContractIds.add(contract.id);
    reasons.push({
      target_id: contract.id,
      reason,
      evidence_refs: input.graph_node_ids
    });

    if (contract.kind === "canonical_helper_reuse") {
      for (const helper of contract.canonical_helpers) {
        if (helperMatches(helper, input.file_roles, taskTokens)) {
          selectedHelperIds.add(helper.helper_id);
        }
      }
    }

    if (contract.kind === "required_change_checks") {
      for (const rule of contract.rules) {
        if (ruleMatches(rule.applies_to, allPaths, input.file_roles, [])) {
          for (const check of rule.required_checks) {
            selectedRequiredChecks.add(check.command);
          }
        }
      }
    }
  }

  for (const convention of input.repoContract.conventions) {
    if (conventionMatches(convention, allPaths, input.file_roles)) {
      selectedConventionIds.add(convention.id);
      reasons.push({
        target_id: convention.id,
        reason: "path_match",
        evidence_refs: input.graph_node_ids
      });
    }
  }

  return AgentContractSelectionSchema.parse({
    schema_version: "drift.agent.contract_selection.v1",
    repo_id: input.repoContract.repo_id,
    scan_id: input.scan_id ?? "scan_unavailable",
    selected_contract_ids: [...selectedContractIds].sort(),
    selected_convention_ids: [...selectedConventionIds].sort(),
    selected_helper_ids: [...selectedHelperIds].sort(),
    selected_required_checks: [...selectedRequiredChecks].sort(),
    selection_inputs: {
      task_text: input.task,
      explicit_paths: input.explicit_paths,
      changed_paths: input.changed_paths,
      file_roles: input.file_roles,
      graph_node_ids: input.graph_node_ids
    },
    reasons: reasons.sort((a, b) =>
      `${a.target_id}:${a.reason}`.localeCompare(`${b.target_id}:${b.reason}`)
    )
  });
}

export function createAgentPreflightPacket(input: CreateAgentPreflightPacketInput): AgentPreflightPacket {
  const selection = selectAgentContracts(input);
  const selectedContracts = selectedById(input.repoContract.agent_contracts ?? [], selection.selected_contract_ids);
  const selectedConventions = selectedById(input.repoContract.conventions, selection.selected_convention_ids);
  const selectedHelperIds = new Set(selection.selected_helper_ids);
  const selectedHelpers = selectedContracts
    .filter((contract): contract is CanonicalHelperReuseAgentContract => contract.kind === "canonical_helper_reuse")
    .flatMap((contract) => contract.canonical_helpers)
    .filter((helper) => selectedHelperIds.has(helper.helper_id))
    .map((helper) => ({
      symbol: helper.symbol,
      module: helper.module,
      suggested_import: helper.suggested_import,
      purpose_tags: [...helper.purpose_tags].sort()
    }))
    .sort((a, b) => `${a.module}:${a.symbol}`.localeCompare(`${b.module}:${b.symbol}`));

  const placementGuidance = selectedContracts
    .filter((contract): contract is ModulePlacementAgentContract => contract.kind === "module_placement")
    .map((contract) => ({
      role: contract.target_role,
      allowed_paths: [...contract.allowed_paths].sort(),
      forbidden_paths: [...(contract.forbidden_paths ?? [])].sort()
    }))
    .sort((a, b) => a.role.localeCompare(b.role));

  const importBoundaries = selectedContracts
    .filter((contract): contract is ImportBoundaryAgentContract => contract.kind === "import_boundary");
  const requiredFlows = selectedContracts
    .filter((contract): contract is EntrypointFlowAgentContract => contract.kind === "entrypoint_flow");
  const selectedRequiredCommands = new Set(selection.selected_required_checks);
  const requiredChecks = selectedContracts
    .filter((contract) => contract.kind === "required_change_checks")
    .flatMap((contract) => contract.rules)
    .flatMap((rule) => rule.required_checks)
    .filter((check) => selectedRequiredCommands.has(check.command))
    .map((check) => ({
      command: check.command,
      reason: check.reason
    }))
    .sort((a, b) => a.command.localeCompare(b.command));

  const activeExceptions = selectedConventions.flatMap((convention) => convention.exceptions);
  const activeWaivers = waiversForSelection(input.repoContract.waivers, input.explicit_paths, input.changed_paths, input.file_roles);

  return AgentPreflightPacketSchema.parse({
    schema_version: "drift.agent.preflight.v3",
    repo_id: input.repoContract.repo_id,
    scan_id: input.scan_id,
    stale: input.stale,
    task: input.task,
    selected_contracts: selectedContracts,
    selected_conventions: selectedConventions,
    selected_helpers: selectedHelpers,
    placement_guidance: placementGuidance,
    import_boundaries: importBoundaries,
    required_flows: requiredFlows,
    required_checks: requiredChecks,
    active_exceptions: activeExceptions,
    active_waivers: activeWaivers,
    agent_instructions: agentInstructions(selectedContracts, selectedConventions),
    diagnostics: input.stale ? ["scan is stale; run scan before relying on this packet"] : []
  });
}

function agentContractSelectionReason(
  contract: AgentContract,
  paths: string[],
  roles: FileRole[],
  taskTokens: Set<string>
): AgentContractSelection["reasons"][number]["reason"] | undefined {
  switch (contract.kind) {
    case "file_role":
      return contract.roles.some((role) => paths.some((path) =>
        role.path_globs.some((glob) => matchesRepoGlob(path, glob))
      ))
        ? "path_match"
        : undefined;
    case "module_placement":
      if (roles.includes(contract.target_role)) {
        return "role_match";
      }
      return paths.some((path) =>
        contract.allowed_paths.some((glob) => matchesRepoGlob(path, glob)) ||
        (contract.forbidden_paths ?? []).some((glob) => matchesRepoGlob(path, glob))
      )
        ? "path_match"
        : undefined;
    case "import_boundary":
      return contract.source_roles.some((role) => roles.includes(role)) ? "role_match" : undefined;
    case "entrypoint_flow":
      return contract.entry_roles.some((role) => roles.includes(role)) ? "role_match" : undefined;
    case "canonical_helper_reuse":
      return contract.canonical_helpers.some((helper) => helperMatches(helper, roles, taskTokens))
        ? "task_text_match"
        : undefined;
    case "required_change_checks":
      return contract.rules.some((rule) => ruleMatches(rule.applies_to, paths, roles, []))
        ? "path_match"
        : undefined;
  }
}

function helperMatches(
  helper: CanonicalHelperReuseAgentContract["canonical_helpers"][number],
  roles: FileRole[],
  taskTokens: Set<string>
): boolean {
  const roleMatch = [...(helper.roles ?? []), ...(helper.applies_to_roles ?? [])]
    .some((role) => roles.includes(role));
  const taskMatch = helper.purpose_tags.some((tag) => taskTokens.has(tag.toLowerCase())) ||
    taskTokens.has(helper.symbol.toLowerCase());
  return roleMatch || taskMatch;
}

function conventionMatches(convention: AcceptedConvention, paths: string[], roles: FileRole[]): boolean {
  return paths.some((path) => scopeMatches(convention.scope, path, roles)) ||
    (convention.scope.file_roles ?? []).some((role) => roles.includes(role));
}

function ruleMatches(
  appliesTo: { path_globs?: string[]; file_roles?: FileRole[]; convention_kinds?: string[] },
  paths: string[],
  roles: FileRole[],
  conventionKinds: string[]
): boolean {
  const pathMatches = !appliesTo.path_globs?.length ||
    paths.some((path) => appliesTo.path_globs!.some((glob) => matchesRepoGlob(path, glob)));
  const roleMatches = !appliesTo.file_roles?.length ||
    appliesTo.file_roles.some((role) => roles.includes(role));
  const conventionMatches = !appliesTo.convention_kinds?.length ||
    appliesTo.convention_kinds.some((kind) => conventionKinds.includes(kind));
  return pathMatches && roleMatches && conventionMatches;
}

function scopeMatches(
  scope: { path_globs: string[]; exclude_path_globs?: string[]; file_roles?: FileRole[] },
  path: string,
  roles: FileRole[]
): boolean {
  if ((scope.exclude_path_globs ?? []).some((glob) => matchesRepoGlob(path, glob))) {
    return false;
  }
  const pathMatches = scope.path_globs.length === 0 ||
    scope.path_globs.some((glob) => matchesRepoGlob(path, glob));
  const roleMatches = !scope.file_roles?.length ||
    scope.file_roles.some((role) => roles.includes(role));
  return pathMatches && roleMatches;
}

function waiversForSelection(
  waivers: ConventionException[],
  explicitPaths: string[],
  changedPaths: string[],
  roles: FileRole[]
): ConventionException[] {
  const paths = uniqueSorted([...explicitPaths, ...changedPaths]);
  return waivers.filter((waiver) => {
    const pathMatch = !waiver.path_globs?.length ||
      paths.some((path) => waiver.path_globs!.some((glob) => matchesRepoGlob(path, glob)));
    const roleMatch = !waiver.file_roles?.length ||
      waiver.file_roles.some((role) => roles.includes(role));
    return pathMatch && roleMatch;
  });
}

function agentInstructions(contracts: AgentContract[], conventions: AcceptedConvention[]): string[] {
  const instructions = new Set<string>();
  for (const contract of contracts) {
    if (contract.kind === "canonical_helper_reuse") {
      for (const helper of contract.canonical_helpers) {
        instructions.add(`Use ${helper.symbol} from ${helper.module}.`);
      }
    }
    if (contract.kind === "entrypoint_flow") {
      instructions.add("Follow the accepted entrypoint flow before adding new logic.");
    }
  }
  for (const convention of conventions) {
    instructions.add(convention.statement);
  }
  return [...instructions].sort();
}

function selectedById<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const selected = new Set(ids);
  return items.filter((item) => selected.has(item.id)).sort((a, b) => a.id.localeCompare(b.id));
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9_/-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function matchesRepoGlob(path: string, glob: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedGlob = glob.replace(/\\/g, "/");
  return new RegExp(`^${globToRegExp(normalizedGlob)}$`).test(normalizedPath);
}

function globToRegExp(glob: string): string {
  let output = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
    } else if (char === "*") {
      output += "[^/]*";
    } else {
      output += escapeRegExp(char);
    }
  }
  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
