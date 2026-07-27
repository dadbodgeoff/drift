import type { PolicyDecision } from "./domain.js";
import { createPolicyProof,type PolicyProof } from "./policy.js";

export type AgentEnvelopeAction =
  | "safe_to_edit"
  | "run_scan_first"
  | "blocked_by_policy"
  | "blocked_by_stale_graph"
  | "context_truncated";

export interface AgentEnvelopeV2 {
  schema_version: "agent.envelope.v2";
  action: AgentEnvelopeAction;
  surface: PolicyDecision["surface"] | "cli-error" | "mcp-error";
  read_only: true;
  policy: {
    allowed: boolean;
    surface?: PolicyDecision["surface"];
    reason?: string;
  };
  scan: {
    required_fresh: boolean;
    stale: boolean;
    latest_scan_id: string | null;
  };
  redactions: {
    snippets_included: boolean;
    context_truncated: boolean;
  };
  policy_proof: PolicyProof;
  diagnostics: string[];
}

export function createAgentEnvelopeV2(input: {
  surface: AgentEnvelopeV2["surface"];
  policy?: PolicyDecision | Pick<PolicyDecision, "allowed" | "surface" | "reason">;
  scan?: {
    required_fresh?: boolean;
    stale?: boolean;
    latest_scan_id?: string | null;
  };
  redactions?: {
    snippets_included?: boolean;
    context_truncated?: boolean;
  };
  diagnostics?: string[];
}): AgentEnvelopeV2 {
  const policy = policyDecisionForEnvelope(input.policy);
  const scan = {
    required_fresh: input.scan?.required_fresh ?? false,
    stale: input.scan?.stale ?? false,
    latest_scan_id: input.scan?.latest_scan_id ?? null
  };
  const redactions = {
    snippets_included: input.redactions?.snippets_included ?? false,
    context_truncated: input.redactions?.context_truncated ?? false
  };
  return {
    schema_version: "agent.envelope.v2",
    action: agentEnvelopeAction({ policy, scan, redactions }),
    surface: input.surface,
    read_only: true,
    policy: {
      allowed: policy.allowed,
      surface: policy.surface,
      reason: policy.reason
    },
    scan,
    redactions,
    policy_proof: createPolicyProof(policy, {
      snippetsIncluded: redactions.snippets_included,
      sourceContentIncluded: false,
      contextTruncated: redactions.context_truncated
    }),
    diagnostics: [...new Set(input.diagnostics ?? [])].sort((left, right) => left.localeCompare(right))
  };
}

function policyDecisionForEnvelope(
  policy: PolicyDecision | Pick<PolicyDecision, "allowed" | "surface" | "reason"> | undefined
): PolicyDecision {
  if (!policy) {
    return {
      allowed: true,
      surface: "cli-preflight",
      mode: "local_only",
      reason: "metadata-only local preflight packet",
      max_snippet_chars: 0,
      approved_snippet_chars: 0
    };
  }
  return {
    allowed: policy.allowed,
    surface: policy.surface ?? "cli-preflight",
    mode: "mode" in policy ? policy.mode : policy.allowed ? "local_only" : "denied",
    reason: policy.reason ?? (policy.allowed ? "metadata-only local preflight packet" : "context export denied"),
    max_snippet_chars: "max_snippet_chars" in policy ? policy.max_snippet_chars : 0,
    approved_snippet_chars: "approved_snippet_chars" in policy ? policy.approved_snippet_chars : 0
  };
}

function agentEnvelopeAction(input: {
  policy: Pick<PolicyDecision, "allowed">;
  scan: AgentEnvelopeV2["scan"];
  redactions: AgentEnvelopeV2["redactions"];
}): AgentEnvelopeAction {
  if (!input.policy.allowed) {
    return "blocked_by_policy";
  }
  if (input.scan.required_fresh && input.scan.stale) {
    return "blocked_by_stale_graph";
  }
  if (!input.scan.latest_scan_id) {
    return "run_scan_first";
  }
  if (input.redactions.context_truncated) {
    return "context_truncated";
  }
  return "safe_to_edit";
}
