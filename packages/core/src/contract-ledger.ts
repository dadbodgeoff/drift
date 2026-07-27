export type ContractLedgerSurface = "defined" | "missing";
export type ContractLedgerStorage = "persisted" | "derived" | "not_applicable" | "missing";
export type ContractLedgerExposure = "exposed" | "internal" | "not_applicable" | "missing";
export type ContractLedgerReleaseProof = "covered" | "not_required" | "missing";
export type ContractLedgerConfidence = "complete" | "partial" | "experimental";

export interface ContractParityLedgerRow {
  name: string;
  schema: ContractLedgerSurface;
  storage: ContractLedgerStorage;
  cli: ContractLedgerExposure;
  mcp: ContractLedgerExposure;
  release_proof: ContractLedgerReleaseProof;
  beta_required: boolean;
  confidence: ContractLedgerConfidence;
}

export interface ContractParityLedger {
  schema_version: "drift.contract_parity_ledger.v1";
  contracts: ContractParityLedgerRow[];
  summary: {
    complete_count: number;
    partial_count: number;
    missing_count: number;
    not_implemented_count: number;
    beta_required_count: number;
    partial_beta_required_count: number;
  };
}

const CONTRACTS: ContractParityLedgerRow[] = [
  row("ParsedFactContract", "persisted", "internal", "not_applicable", "covered", true),
  row("FactQualityContract", "persisted", "internal", "not_applicable", "covered", true),
  row("GraphContract", "persisted", "exposed", "exposed", "covered", true),
  row("ScanStatusContract", "derived", "exposed", "exposed", "covered", true),
  row("SemanticCapabilityContract", "derived", "internal", "not_applicable", "covered", true),
  row("RoleOntologyContract", "derived", "internal", "not_applicable", "covered", true),
  row("LayerArchitectureContract", "persisted", "exposed", "exposed", "covered", true),
  row("AdapterContract", "derived", "internal", "not_applicable", "not_required", true),
  row("DataOperationContract", "derived", "exposed", "exposed", "covered", true),
  row("EntrypointContract", "derived", "exposed", "exposed", "covered", true),
  row("SymbolIdentityContract", "persisted", "internal", "not_applicable", "not_required", true),
  row("ChangeImpactContract", "derived", "exposed", "exposed", "covered", true),
  row("TestIntelligenceContract", "derived", "exposed", "exposed", "covered", true),
  row("ConventionElectionContract", "persisted", "exposed", "not_applicable", "covered", true),
  row("RepoContract", "persisted", "exposed", "exposed", "covered", true),
  row("RuleContract", "persisted", "exposed", "exposed", "covered", true),
  row("FindingContract", "persisted", "exposed", "exposed", "covered", true),
  row("WaiverContract", "persisted", "exposed", "exposed", "covered", true),
  row("BaselineContract", "persisted", "exposed", "not_applicable", "covered", true),
  row("CheckProofContract", "persisted", "exposed", "exposed", "covered", true),
  row("AgentTaskContract", "derived", "exposed", "exposed", "covered", true),
  row("AgentPreflightContract", "derived", "exposed", "exposed", "covered", true),
  row("ContextPolicyContract", "persisted", "exposed", "exposed", "covered", true),
  row("AuditContract", "persisted", "exposed", "exposed", "covered", true),
  row("ReleaseProofContract", "derived", "exposed", "not_applicable", "covered", true)
];

export function createContractParityLedger(): ContractParityLedger {
  const contracts = CONTRACTS.map((contract) => ({ ...contract }));
  const partialCount = contracts.filter((contract) => contract.confidence !== "complete").length;
  const missingCount = contracts.filter((contract) =>
    contract.schema === "missing" ||
    contract.storage === "missing" ||
    contract.cli === "missing" ||
    contract.mcp === "missing" ||
    contract.release_proof === "missing"
  ).length;
  const partialBetaRequiredCount = contracts.filter((contract) =>
    contract.beta_required && contract.confidence !== "complete"
  ).length;
  return {
    schema_version: "drift.contract_parity_ledger.v1",
    contracts,
    summary: {
      complete_count: contracts.length - partialCount,
      partial_count: partialCount,
      missing_count: missingCount,
      not_implemented_count: missingCount,
      beta_required_count: contracts.filter((contract) => contract.beta_required).length,
      partial_beta_required_count: partialBetaRequiredCount
    }
  };
}

function row(
  name: string,
  storage: ContractLedgerStorage,
  cli: ContractLedgerExposure,
  mcp: ContractLedgerExposure,
  releaseProof: ContractLedgerReleaseProof,
  betaRequired: boolean
): ContractParityLedgerRow {
  return {
    name,
    schema: "defined",
    storage,
    cli,
    mcp,
    release_proof: releaseProof,
    beta_required: betaRequired,
    confidence: "complete"
  };
}
