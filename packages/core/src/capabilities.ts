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
      // CV-3: the layering wedge, plus the three kinds promoted for PRESENCE-only enforcement.
      //
      // Listing a kind here says Drift enforces it deterministically, and for these three that is
      // true of the presence claim only - a family candidate carrying
      // `enforcement_semantics: "presence"`. The guard-dominance candidates of the same kinds are
      // still quarantined and are not what this line refers to. `beta-claims.json` carries the
      // distinction, including what presence enforcement does not catch.
      convention_kinds: [
        "api_route_no_direct_data_access",
        ...PRESENCE_PROMOTABLE_CONVENTION_KINDS
      ],
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
      "incremental_reuse",
      // CV-1 / CV-3. Both are advisory in `enforcement_posture`: aggregation produces candidates
      // rather than findings, and a promoted presence family is accepted at warn by default, so out
      // of the box it reports and exits 0. Block is available only as an explicit upgrade.
      "convention_family_aggregation",
      "presence_only_family_enforcement"
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
      "convention_learning",
      // The security layer is gated behind --experimental-security. Its "proofs" are line-order
      // comparisons, and the valve that should degrade them on dynamic control flow only matches
      // Drift's own fixture strings. See docs/architecture/security-heuristic-audit.md.
      "security_boundary_proofs",
      "auth_dominance_analysis"
    ]
  };
}

/**
 * Convention kinds produced by the security heuristics layer.
 *
 * Gated behind `--experimental-security` for beta. The layer's own audit (T07,
 * docs/architecture/security-heuristic-audit.md) confirmed that guard "dominance" is a
 * line-number comparison, branch detection is `line.contains("if")`, and - most consequentially -
 * `unsupported_dynamic_control_flow()`, the valve that is supposed to degrade the proof when
 * control flow is too dynamic to reason about, matches only Drift's own fixture strings. It opens
 * for test inputs and never for real dynamic dispatch.
 *
 * The findings are not worthless, but they cannot honestly be called proofs, and a security
 * claim that overstates itself is worse than no security claim.
 *
 * `api_route_no_direct_data_access` and `api_route_requires_service_delegation` are NOT here:
 * they are the layering wedge, deterministic, and stay on by default.
 */
export const EXPERIMENTAL_SECURITY_CONVENTION_KINDS = [
  "api_route_requires_auth_helper",
  "api_route_requires_authorization",
  "api_route_requires_csrf_for_mutation",
  "api_route_requires_rate_limit",
  "api_route_requires_request_validation",
  "api_route_requires_tenant_scope",
  "api_route_forbids_raw_sql_without_params",
  "api_route_forbids_sensitive_response_fields",
  "api_route_forbids_untrusted_ssrf",
  "api_route_cors_must_match_policy",
  "middleware_must_cover_routes",
  "session_object_must_come_from_trusted_helper"
] as const;

export function isExperimentalSecurityKind(kind: string): boolean {
  return (EXPERIMENTAL_SECURITY_CONVENTION_KINDS as readonly string[]).includes(kind);
}

/**
 * CV-3: the kinds a presence-only family may be promoted for.
 *
 * These three, and no others, because these three are the ones whose claim can be reduced to "the
 * route calls an accepted helper". The rest of the quarantined set cannot: `cors_policy` compares a
 * declared policy, `raw_sql` and `sensitive_response_fields` follow dataflow, and
 * `session_object_must_come_from_trusted_helper` is about where a value came from. A presence version
 * of any of those would not be a weaker claim, it would be a different one.
 */
export const PRESENCE_PROMOTABLE_CONVENTION_KINDS = [
  "api_route_requires_auth_helper",
  "api_route_requires_rate_limit",
  "api_route_requires_request_validation"
] as const;

/**
 * Whether this specific convention has left quarantine.
 *
 * Promotion is per CANDIDATE, not per kind, and that distinction is the whole design. The same kind
 * produces both shapes: a family candidate carrying `enforcement_semantics: "presence"`, which is
 * checked by asking whether the route calls a member, and the per-symbol candidates, which carry
 * `requires.dominates` and are checked by `build_auth_boundary_proof` - guard dominance, branch-bypass
 * and callback-boundary analysis. Removing the kind from the quarantine list would have surfaced both.
 *
 * So the presence family is visible by default and the dominance candidates of the same kind stay
 * hidden behind `--experimental-security`, which is the honest split.
 */
export function isPromotedPresenceConvention(convention: {
  kind: string;
  matcher?: { enforcement_semantics?: string };
}): boolean {
  return (
    (PRESENCE_PROMOTABLE_CONVENTION_KINDS as readonly string[]).includes(convention.kind) &&
    convention.matcher?.enforcement_semantics === "presence"
  );
}
