import { createContractParityLedger,type ContractParityLedger } from "./contract-ledger.js";

export interface DriftCapabilities {
  read_only_cli: string[];
  human_confirmed_cli: string[];
  mcp_read_only_tools: string[];
  mcp_mutation_tools: string[];
  supported_wedge: {
    languages: string[];
    convention_kinds: string[];
    heuristic_convention_kinds: string[];
    check_scopes: string[];
    storage: "sqlite";
    source_mutation: false;
  };
  deferred: string[];
  contract_parity: ContractParityLedger;
}

export interface DriftProductionClaimsManifest {
  schema_version: "drift.production.claims.v1";
  allowed_claims: string[];
  blocked_claims: string[];
  source_of_truth: "createDriftCapabilities";
}

export const DRIFT_DEFAULT_MCP_READ_ONLY_TOOLS = [
  "get_runtime_info",
  "get_capabilities",
  "get_audit_status",
  "get_scan_status",
  "get_repo_contract",
  "get_repo_map",
  "get_task_preflight",
  "get_conventions",
  "get_findings",
  "get_required_check_executions",
  "get_allowed_context"
] as const;

export function createDriftCapabilities(input: {
  mcpReadOnlyTools?: string[];
} = {}): DriftCapabilities {
  return {
    read_only_cli: [
      "doctor",
      "version",
      "capabilities",
      "scan",
      "scan status",
      "ask",
      "prepare",
      "repo map",
      "conventions list",
      "conventions accepted",
      "conventions show",
      "check",
      "findings list",
      "findings show",
      "audit list",
      "audit verify",
      "checks list",
      "policy show",
      "policy check-context",
      "contract show",
      "contract validate",
      "contract waivers list",
      "backup list",
      "backup verify",
      "restore --dry-run",
      "support bundle --dry-run"
    ],
    human_confirmed_cli: [
      "conventions accept --confirm",
      "conventions reject --confirm",
      "conventions edit --confirm",
      "conventions exception add --confirm",
      "findings mark-fixed --confirm",
      "findings mark-needs-review --confirm",
      "findings suppress --confirm",
      "findings accept-drift --confirm",
      "findings mark-false-positive --confirm",
      "baseline create --confirm",
      "baseline clear --confirm",
      "policy set-egress --confirm",
      "policy agent grant --confirm",
      "policy agent revoke --confirm",
      "contract export --confirm",
      "contract import --confirm",
      "contract waiver add --confirm",
      "contract waiver remove --confirm",
      "backup create --confirm",
      "restore --confirm"
    ],
    mcp_read_only_tools: input.mcpReadOnlyTools ?? [...DRIFT_DEFAULT_MCP_READ_ONLY_TOOLS],
    mcp_mutation_tools: [],
    supported_wedge: {
      languages: ["typescript", "javascript"],
      convention_kinds: ["api_route_no_direct_data_access"],
      heuristic_convention_kinds: ["api_route_requires_service_delegation"],
      check_scopes: ["changed-hunks", "changed-files", "full"],
      storage: "sqlite",
      source_mutation: false
    },
    deferred: ["desktop_ui", "cloud_sync", "python_adapter", "duplicate_helper_detection"],
    contract_parity: createContractParityLedger()
  };
}

export function createProductionClaimsManifest(): DriftProductionClaimsManifest {
  return {
    schema_version: "drift.production.claims.v1",
    source_of_truth: "createDriftCapabilities",
    allowed_claims: [
      "local_first_cli",
      "typescript_api_route_layering",
      "sqlite_local_state",
      "human_confirmed_governance",
      "read_only_mcp",
      "accepted_contract_blocks_direct_data_access",
      "incremental_reuse"
    ],
    blocked_claims: [
      "cloud_sync",
      "desktop_ui",
      "python_adapter",
      "duplicate_helper_detection",
      "mutation_capable_mcp",
      "general_ai_code_review",
      "broad_language_support",
      // Candidate inference recognises a data layer only when its import specifier
      // contains prisma/database/db/data-access. Repos naming theirs store, supabase,
      // repository or models infer nothing, so Drift cannot claim to learn conventions
      // generally - it bootstraps and enforces a *declared* layering contract. Lift these
      // when structural construction-site detection replaces the substring test.
      "automatic_convention_inference_for_any_data_layer",
      "convention_learning"
    ]
  };
}
