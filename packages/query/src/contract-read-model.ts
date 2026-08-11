import { canonicalRepoContractJson, type PolicyDecision, type RepoContract } from "@drift/core";
import { createHash } from "node:crypto";

export function buildRepoContractReadModel(input: {
  repo_id: string;
  contract: RepoContract;
  policy: PolicyDecision;
  governance: unknown;
}): {
  response_schema: "drift.repo.contract.v1";
  repo_id: string;
  policy: PolicyDecision;
  governance: unknown;
  summary: ReturnType<typeof contractSummary>;
  contract_fingerprint: string;
  contract: RepoContract;
} {
  return {
    response_schema: "drift.repo.contract.v1",
    repo_id: input.repo_id,
    policy: input.policy,
    governance: input.governance,
    summary: contractSummary(input.contract),
    contract_fingerprint: contractFingerprint(input.contract),
    contract: input.contract
  };
}

export function contractSummary(contract: RepoContract): {
  convention_count: number;
  agent_contract_count: number;
  risky_area_count: number;
  required_check_count: number;
  safe_command_count: number;
  waiver_count: number;
  rejected_inference_count: number;
} {
  return {
    convention_count: contract.conventions.length,
    agent_contract_count: contract.agent_contracts?.length ?? 0,
    risky_area_count: contract.risky_areas.length,
    required_check_count: contract.required_checks.length,
    safe_command_count: contract.safe_commands.length,
    waiver_count: contract.waivers.length,
    rejected_inference_count: contract.rejected_inferences.length
  };
}

export function contractFingerprint(contract: RepoContract): string {
  return createHash("sha256").update(canonicalRepoContractJson(contract)).digest("hex");
}
