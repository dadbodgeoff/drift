import { createAgentEnvelopeV2,type PolicyDecision } from "@drift/core";
import type { scanStatusPayload } from "./scan-status.js";

export function agentEnvelopeForScan(input: {
  surface: PolicyDecision["surface"] | "cli-error";
  policy?: Pick<PolicyDecision, "allowed" | "surface" | "reason">;
  scanStatus?: ReturnType<typeof scanStatusPayload>;
  requireFresh?: boolean;
  diagnostics?: string[];
  contextTruncated?: boolean;
}) {
  return createAgentEnvelopeV2({
    surface: input.surface,
    policy: input.policy,
    scan: {
      required_fresh: Boolean(input.requireFresh),
      stale: input.scanStatus?.stale ?? false,
      latest_scan_id: input.scanStatus?.latest_scan?.id ?? null
    },
    redactions: {
      snippets_included: false,
      context_truncated: Boolean(input.contextTruncated)
    },
    diagnostics: input.diagnostics
  });
}
