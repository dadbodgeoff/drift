import { describe, expect, it } from "vitest";
import { parseEngineSecurityProofEvent } from "../src/index.js";

/**
 * T-17: an unknown missing-proof code must not fail the parse.
 *
 * The engine and the TypeScript schemas each carry their own copy of the reason-code vocabulary,
 * and they drift. Measured on dub: accepting `requires_request_validation` made
 * `check --scope full` exit 1 with
 *
 *   Invalid enum value. Expected 'missing_auth_guard' | ... , received
 *   'unsupported_request_input_spread'
 *
 * Because the whole engine result failed to parse, the run died - and it took the WORKING
 * data-access convention's verdict with it. A vocabulary mismatch became a total loss of
 * enforcement on a repo where enforcement was working.
 *
 * A static diff still shows codes the engine emits that the enum does not name:
 * `unsupported_request_input_spread`, `unsupported_request_input_destructure`,
 * `unsupported_destructuring_or_spread`, `unsupported_session_nested_destructure`.
 *
 * Adding those four would fix today and not tomorrow. The property that survives the next engine
 * change is: an unrecognized code is normalized to `unknown_reason_code` at the parse boundary, so
 * the result loads and the proof carrying it can never be read as satisfied.
 */

function proofEvent(missingProofCode: string): unknown {
  return {
    event: "SecurityProof",
    schema_version: "engine.security.proof/v1",
    proofs: [{
      proof_id: "proof_t17",
      proof_version: "security-boundary-proof/v1",
      route: {
        route_id: "route_t17",
        file_path: "app/api/x/route.ts",
        file_role: "api_route"
      },
      contracts: [{
        contract_id: "convention_t17",
        kind: "api_route_requires_request_validation",
        enforcement_mode: "warn",
        capability: "deterministic_check",
        matched: true
      }],
      capability_status: [],
      auth: {
        required: false,
        proven: false,
        proof_kind: "none",
        trusted_guard_calls: [],
        dominated_sinks: [],
        undominated_sinks: []
      },
      missing_proof: [{
        id: "missing_t17",
        capability: "request_validation",
        code: missingProofCode,
        blocks_enforcement: true,
        fact_ids: [],
        graph_edge_ids: []
      }],
      parser_gaps: [],
      result: {
        proof_status: "missing_proof",
        enforcement_result: "warn",
        can_block: false,
        finding_ids: []
      }
    }]
  };
}

const codeOf = (value: unknown): string =>
  parseEngineSecurityProofEvent(value).proofs[0].missing_proof[0].code;

describe("an unrecognized reason code cannot fail the parse", () => {
  it("normalizes the code the engine actually emitted on dub", () => {
    // Before the fix this threw, and the caller lost every convention's verdict with it.
    expect(codeOf(proofEvent("unsupported_request_input_spread"))).toBe("unknown_reason_code");
  });

  it("normalizes a code that does not exist anywhere yet", () => {
    // The point is surviving the NEXT vocabulary change, not the last one.
    expect(codeOf(proofEvent("a_code_invented_in_a_later_release"))).toBe("unknown_reason_code");
  });

  it("leaves a known code exactly as it was", () => {
    expect(codeOf(proofEvent("missing_auth_guard"))).toBe("missing_auth_guard");
  });

  it("keeps the proof blocking, so an unknown code can never read as satisfied", () => {
    const proof = parseEngineSecurityProofEvent(
      proofEvent("unsupported_request_input_spread")
    ).proofs[0];

    expect(proof.result.proof_status).not.toBe("proven");
    expect(proof.missing_proof[0].blocks_enforcement).toBe(true);
  });
});
