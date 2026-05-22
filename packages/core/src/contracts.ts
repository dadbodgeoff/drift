import type { RepoContract } from "./domain.js";

export function canonicalRepoContractJson(contract: RepoContract): string {
  return `${stableJsonStringify(canonicalRepoContract(contract))}\n`;
}

export function canonicalRepoContract(contract: RepoContract): RepoContract {
  return {
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
