import { createContractParityLedger,type ContractParityLedger } from "./contract-ledger.js";
import { CONVENTION_DISPATCH, SECURITY_CONTRACT_CONVENTION_KINDS, UNEVALUATED_CONVENTION_KINDS, type ConventionDispatch } from "@drift/vocabulary";

export type { ConventionDispatch };

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
      // Empty, and the emptiness is the claim. This listed exactly one kind,
      // `api_route_requires_service_delegation`, and the thing it asserted - that Drift enforces
      // that kind heuristically - was never true of any code path: the proposers stamped
      // `heuristic_check`, the engine's loop required `deterministic_check`, and the CLI never
      // dispatched the kind at all. See docs/decisions/service-delegation-capability.md.
      //
      // Kept as a field rather than deleted: "Drift enforces nothing heuristically" is a real
      // statement about the product, and a reader who finds the key absent cannot tell it from a
      // key nobody thought to write.
      heuristic_convention_kinds: [],
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
      // Drift's own fixture strings. See docs/internal/architecture/security-heuristic-audit.md.
      "security_boundary_proofs",
      "auth_dominance_analysis"
    ]
  };
}

/**
 * Convention kinds produced by the security heuristics layer.
 *
 * Gated behind `--experimental-security` for beta. The layer's own audit (T07,
 * docs/internal/architecture/security-heuristic-audit.md) confirmed that guard "dominance" is a
 * line-number comparison, branch detection is `line.contains("if")`, and - most consequentially -
 * `unsupported_dynamic_control_flow()`, the valve that is supposed to degrade the proof when
 * control flow is too dynamic to reason about, matches only Drift's own fixture strings. It opens
 * for test inputs and never for real dynamic dispatch.
 *
 * The findings are not worthless, but they cannot honestly be called proofs, and a security
 * claim that overstates itself is worse than no security claim.
 *
 * `api_route_no_direct_data_access` is NOT here: it is the layering wedge, deterministic, and
 * stays on by default. `api_route_requires_service_delegation` used to be named beside it on the
 * same grounds and was neither deterministic nor evaluated - it now fails closed at acceptance
 * (docs/decisions/service-delegation-capability.md), so the wedge is one kind, not two.
 *
 * W5: derived from the convention vocabulary's `security_contract` flag, which is also what
 * `SecurityContractKindSchema` is built from. This was a hand-written list of twelve beside two
 * hand-written lists of thirteen, and the one it omitted was `api_route_forbids_secret_exposure` -
 * so the flag that keeps every security kind behind `--experimental-security` did not cover the one
 * kind whose subject is secrets. Latent rather than shipped: candidate inference proposes thirteen
 * kinds and that is not one of them, so no candidate of that kind has ever existed to escape. A
 * hand-authored contract carrying it would have.
 */
export const EXPERIMENTAL_SECURITY_CONVENTION_KINDS = SECURITY_CONTRACT_CONVENTION_KINDS;

export function isExperimentalSecurityKind(kind: string): boolean {
  return (EXPERIMENTAL_SECURITY_CONVENTION_KINDS as readonly string[]).includes(kind);
}

/**
 * Kinds `ConventionKindSchema` accepts that no evaluator implements.
 *
 * Established by searching both evaluators for every declared kind: the engine-owned
 * `crates/drift-engine/src/check_command.rs` and the CLI-owned
 * `packages/cli/src/check/run-check.ts`. These appear in neither, so a contract declaring one
 * produces no finding on any repo, ever, and nothing reports that - `check` returns a clean pass.
 * "Accepted and silently enforcing nothing" is the one thing Drift must not let a user believe, so
 * acceptance refuses them instead of storing an inert rule.
 *
 * Note this is NOT the same as experimental: `middleware_must_cover_routes` is in
 * EXPERIMENTAL_SECURITY_CONVENTION_KINDS above, which gates default-on behaviour, not whether an
 * implementation exists.
 *
 * `api_route_requires_service_delegation` joined this list rather than being reasoned around it.
 * The note that used to sit here said it "has no TypeScript evaluator but IS evaluated by the
 * engine, so it is absent from this list" - and that was wrong on the only point that mattered.
 * The engine's arm existed and was unreachable: both proposers stamp `heuristic_check` where the
 * engine's loop requires `deterministic_check`, and the CLI never dispatched the kind at all. An
 * arm that exists is not an evaluator that runs, and a list derived from "is there an arm" would
 * have kept saying so. See docs/decisions/service-delegation-capability.md.
 *
 * W5 (D-P3a): derived from the dispatch table rather than restated. This was a hand-written list
 * beside a hand-written engine chain and a hand-written CLI chain, with no place that named all
 * twenty-three kinds - so "which kinds have no evaluator" was answerable only by reading three files
 * and trusting the reader. `vocabulary/vocabulary.json` answers it, and the parity gate checks the
 * answer against the two evaluators' sources.
 *
 * Deleting a kind from here is the LAST step of implementing it, not the first - which now means
 * changing its `dispatch` in the manifest and adding the arm the compiler then demands.
 */
export const UNIMPLEMENTED_CONVENTION_KINDS = UNEVALUATED_CONVENTION_KINDS;

export function hasConventionEvaluator(kind: string): boolean {
  return !(UNIMPLEMENTED_CONVENTION_KINDS as readonly string[]).includes(kind);
}

/**
 * Where the vocabulary sends this kind, for a consumer that needs the target rather than the
 * yes/no above.
 *
 * `hasConventionEvaluator` collapses four dispatch targets into a boolean, which is the right
 * answer for acceptance - "can this be enforced at all" - and the wrong one for an evaluation
 * receipt, where `reached: false` on a `none` kind and `reached: false` on an `engine_direct` kind
 * are different problems. The first is a kind nothing implements; the second is an implemented
 * kind this run did not enter.
 *
 * Reads CONVENTION_DISPATCH, which is generated from vocabulary/vocabulary.json - the same table
 * the engine's exhaustive match compiles against and the parity gate checks against both
 * evaluators' sources. So a receipt cannot claim a dispatch target the code does not have.
 *
 * Unknown kinds answer `"none"`, which is the honest reading: the schema rejects them before they
 * reach an evaluator, and nothing evaluates what does not exist.
 */
export function conventionDispatchFor(kind: string): ConventionDispatch {
  return CONVENTION_DISPATCH[kind as keyof typeof CONVENTION_DISPATCH] ?? "none";
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

/**
 * CV-5: the floor a presence family must clear to be auto-accepted by `--accept-defaults`.
 *
 * **Pre-registered** in docs/internal/beta-run/CV-5-ACCEPTANCE-FLOOR.md, committed at 34a82807 - before this
 * code and before the measurement - so "not fitted to dub" is checkable rather than asserted. Moving
 * either constant requires saying why in the diff, and "so the family we wanted gets accepted" is not
 * a why.
 *
 * Both floors are required, because each admits a different mistake on its own:
 *
 *   - **Coverage >= 0.6, read CONDITIONED** (within the family's own flavour scope). A convention most
 *     of its scope already follows describes the codebase; one a minority follows proposes a migration
 *     nobody agreed to. Same side of the line as the A5 coverage-direction gate. Conditioned rather
 *     than global is load-bearing: dub's auth family is 0.5709 against all 494 route files and 0.7731
 *     against the 357 application routes it is actually about, so the global figure would put a real
 *     convention below the floor on the strength of 112 cron routes it was never about - CV-2's
 *     miscount reappearing as an acceptance decision.
 *   - **>= 20 distinct evidence files.** Coverage is a ratio and a ratio is loud on a small scope:
 *     three of four routes is 0.75 from three examples, which is a coincidence with a good score
 *     rather than a convention. Roughly an order of magnitude above the deriver's 2-file membership
 *     threshold, so the two are not measuring the same thing twice.
 *
 * Clearing this floor changes what Drift REPORTS, never what it fails: auto-acceptance is always at
 * warn, and block stays an explicit `--mode block` by the author.
 */
export const PRESENCE_AUTO_ACCEPT_MIN_COVERAGE = 0.6;
export const PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES = 20;

/**
 * T-12: whether this convention can ever be a gate.
 *
 * Acceptance already refuses `--mode block` for anything but `deterministic_check`
 * (`convention-candidates.ts`), and that refusal was the only place the rule existed. So
 * `--accept-defaults` would auto-accept a `heuristic_check` candidate at warn and then print
 * "To make this a gate: drift conventions accept ... --mode block --confirm", which exits 1.
 *
 * Measured on a repo that fully complies with its own convention - every route delegating, zero
 * violations - where the ONLY candidate is `api_route_requires_service_delegation`
 * (`heuristic_check`). The best-behaved repo got a convention that cannot block and an upgrade
 * instruction the tool rejects.
 *
 * That measurement now has a second reading, and it is the sharper one: the candidate could not
 * block because it could not enforce at all. `--mode block` was refused while `--mode warn` was
 * taken, so the tool's own refusal was pointing at a dead kind and the warn path quietly stored
 * it. The kind fails closed at acceptance now
 * (docs/decisions/service-delegation-capability.md), so that repo gets a refusal with a reason
 * instead of a convention that reports `pass` forever - which is worse UX and a true statement,
 * where the old behaviour was better UX and a false one.
 *
 * This predicate stays exactly as it was. `canEverBlock` is about the block/warn boundary among
 * kinds that DO enforce, and a heuristic kind that enforces something real would still belong on
 * the warn side of it.
 *
 * One predicate, so the auto-accept filter and the printed command agree with the preflight.
 */
export function canEverBlock(candidate: { enforcement_capability?: string }): boolean {
  return candidate.enforcement_capability === "deterministic_check";
}

/**
 * T-23: whether a convention came from the author or from inference.
 *
 * Derived from the scoring heuristic rather than stored in its own column. `heuristic_id` already
 * distinguishes the two (`declared-data-modules-v1` vs the inference heuristics), already lives
 * inside `scoring_json`, and therefore already survives a round trip through storage - where a new
 * column would have needed a migration to say something the database can already answer.
 *
 * It matters to the disclosure: "declared by author" and "inferred from 326 files" are different
 * claims, and presenting a declaration as an inference overstates what Drift worked out.
 */
export function conventionProvenance(candidate: {
  scoring?: { heuristic_id?: string };
}): "declared" | "inferred" {
  return candidate.scoring?.heuristic_id?.startsWith("declared-") ? "declared" : "inferred";
}

export interface PresenceAutoAcceptDecision {
  eligible: boolean;
  coverage_ratio: number;
  evidence_file_count: number;
  /** Why it did not clear, for the disclosure to print. Null when it did. */
  below_floor_reason: "coverage" | "evidence_files" | "both" | null;
}

/**
 * T-04: why a presence family was left as a candidate instead of accepted.
 *
 * There are two unrelated causes and the disclosure used to print one sentence for both, so a
 * family that cleared every floor was told it had failed them. Measured on dub: coverage 0.774
 * against a floor of 0.6, 365 evidence refs against a floor of 20 - eligible on both counts, and
 * reported as "below the auto-accept floor" because `--accept-families` was not passed.
 *
 * The distinction is the whole point: one is fixed by a flag, the others by the repo changing.
 */
export type PresenceDeferralReason =
  | "families_flag_not_set"
  | "below_coverage_floor"
  | "below_evidence_floor"
  | "below_both";

/**
 * The reason a deferred family was deferred.
 *
 * Eligibility is asked first, because "it qualified and the flag was off" is true regardless of
 * how comfortably it qualified - and it is the only one of the four the user fixes with a flag.
 */
export function presenceDeferralReason(
  decision: Pick<PresenceAutoAcceptDecision, "eligible" | "below_floor_reason">
): PresenceDeferralReason {
  if (decision.eligible) {
    return "families_flag_not_set";
  }
  switch (decision.below_floor_reason) {
    case "coverage":
      return "below_coverage_floor";
    case "evidence_files":
      return "below_evidence_floor";
    default:
      return "below_both";
  }
}

/**
 * Whether `--accept-defaults` should auto-accept this presence family, and if not, why not.
 *
 * Only promoted presence candidates are eligible at all. A guard-dominance candidate of the same kind
 * is never auto-accepted at any coverage - it is quarantined, and coverage is not what disqualifies it.
 */
export function presenceAutoAcceptDecision(candidate: {
  kind: string;
  matcher?: { enforcement_semantics?: string };
  scoring: { coverage_ratio: number };
  evidence_refs: Array<{ file_path: string }>;
}): PresenceAutoAcceptDecision {
  const coverage = candidate.scoring.coverage_ratio;
  const evidenceFiles = new Set(candidate.evidence_refs.map((ref) => ref.file_path)).size;
  const decision: PresenceAutoAcceptDecision = {
    eligible: false,
    coverage_ratio: coverage,
    evidence_file_count: evidenceFiles,
    below_floor_reason: null
  };
  if (!isPromotedPresenceConvention(candidate)) {
    // Not a floor question. Reported as ineligible with no below-floor reason, because saying
    // "coverage too low" about a quarantined candidate would misdescribe why it was skipped.
    return decision;
  }
  const coverageOk = coverage >= PRESENCE_AUTO_ACCEPT_MIN_COVERAGE;
  const evidenceOk = evidenceFiles >= PRESENCE_AUTO_ACCEPT_MIN_EVIDENCE_FILES;
  if (coverageOk && evidenceOk) {
    return { ...decision, eligible: true };
  }
  return {
    ...decision,
    below_floor_reason: !coverageOk && !evidenceOk ? "both" : !coverageOk ? "coverage" : "evidence_files"
  };
}
