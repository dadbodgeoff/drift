import type { AgentContract, RepoContract } from "./domain.js";

export function canonicalRepoContractJson(contract: RepoContract): string {
  return `${stableJsonStringify(canonicalRepoContract(contract))}\n`;
}

export function canonicalRepoContract(contract: RepoContract): RepoContract {
  const canonical: RepoContract = {
    ...contract,
    conventions: [...contract.conventions]
      .map((convention) => ({
        ...convention,
        exceptions: [...convention.exceptions].sort(byId),
        evidence_refs: [...convention.evidence_refs].sort(byId),
        counterexample_refs: [...convention.counterexample_refs].sort(byId)
      }))
      .sort(byId),
    rejected_inferences: [...contract.rejected_inferences].sort((a, b) =>
      a.candidate_id.localeCompare(b.candidate_id)
    ),
    waivers: [...contract.waivers].sort(byId),
    risky_areas: [...contract.risky_areas].sort(byId),
    safe_commands: [...contract.safe_commands].sort((a, b) =>
      a.command.localeCompare(b.command)
    ),
    required_checks: [...contract.required_checks].sort((a, b) =>
      a.command.localeCompare(b.command)
    ),
    context_egress: {
      ...contract.context_egress,
      denied_globs: [...contract.context_egress.denied_globs].sort()
    },
    agent_permissions: [...contract.agent_permissions]
      .map((entry) => ({
        ...entry,
        permissions: [...entry.permissions].sort()
      }))
      .sort((a, b) => a.agent.localeCompare(b.agent))
  };

  if (contract.agent_contracts) {
    canonical.agent_contracts = [...contract.agent_contracts]
      .map(canonicalAgentContract)
      .sort(byId);
  }

  return canonical;
}

function canonicalAgentContract(contract: AgentContract): AgentContract {
  switch (contract.kind) {
    case "file_role":
      return {
        ...contract,
        roles: [...contract.roles]
          .map((role) => ({
            ...role,
            path_globs: [...role.path_globs].sort(),
            required_exports: sortStrings(role.required_exports),
            forbidden_imports: sortStrings(role.forbidden_imports)
          }))
          .sort((a, b) => a.role.localeCompare(b.role))
      };
    case "module_placement":
      return {
        ...contract,
        allowed_paths: [...contract.allowed_paths].sort(),
        forbidden_paths: sortStrings(contract.forbidden_paths),
        required_parent_roles: sortStrings(contract.required_parent_roles),
        forbidden_contained_roles: sortStrings(contract.forbidden_contained_roles),
        examples: contract.examples
          ? {
              good: [...contract.examples.good].sort(),
              bad: [...contract.examples.bad].sort()
            }
          : undefined
      };
    case "import_boundary":
      return {
        ...contract,
        source_roles: [...contract.source_roles].sort(),
        forbidden_imports: sortStrings(contract.forbidden_imports),
        forbidden_target_roles: sortStrings(contract.forbidden_target_roles),
        allowed_imports: sortStrings(contract.allowed_imports),
        allowed_delegate_imports: sortStrings(contract.allowed_delegate_imports)
      };
    case "entrypoint_flow":
      return {
        ...contract,
        entry_roles: [...contract.entry_roles].sort(),
        required_steps: contract.required_steps.map((step) => {
          switch (step.kind) {
            case "auth_helper":
            case "validation_helper":
              return {
                ...step,
                imports: sortStrings(step.imports),
                calls: sortStrings(step.calls)
              };
            case "service_delegation":
              return {
                ...step,
                target_roles: sortStrings(step.target_roles),
                imports: sortStrings(step.imports)
              };
            case "response_boundary":
              return {
                ...step,
                calls: sortStrings(step.calls)
              };
          }
        }),
        forbidden_steps: contract.forbidden_steps
          ? [...contract.forbidden_steps].sort((a, b) => a.kind.localeCompare(b.kind))
          : undefined
      };
    case "canonical_helper_reuse":
      return {
        ...contract,
        canonical_helpers: [...contract.canonical_helpers]
          .map((helper) => ({
            ...helper,
            roles: sortStrings(helper.roles),
            applies_to_roles: sortStrings(helper.applies_to_roles),
            purpose_tags: [...helper.purpose_tags].sort(),
            avoid_new_symbols_matching: sortStrings(helper.avoid_new_symbols_matching),
            avoid_new_files_matching: sortStrings(helper.avoid_new_files_matching)
          }))
          .sort((a, b) => a.helper_id.localeCompare(b.helper_id))
      };
    case "required_change_checks":
      return {
        ...contract,
        rules: [...contract.rules]
          .map((rule) => ({
            ...rule,
            applies_to: {
              ...rule.applies_to,
              path_globs: sortStrings(rule.applies_to.path_globs),
              file_roles: sortStrings(rule.applies_to.file_roles),
              convention_kinds: sortStrings(rule.applies_to.convention_kinds)
            },
            required_checks: [...rule.required_checks].sort((a, b) =>
              a.command.localeCompare(b.command)
            )
          }))
          .sort((a, b) => stableJsonStringify(a.applies_to).localeCompare(stableJsonStringify(b.applies_to)))
      };
  }
}

function sortStrings<T extends string>(values: T[] | undefined): T[] | undefined {
  return values ? [...values].sort() : undefined;
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

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}
