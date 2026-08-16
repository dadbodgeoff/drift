/**
 * The agent envelope, built once for both surfaces.
 *
 * W6. The CLI's `agentEnvelopeForScan` and MCP's `mcpAgentEnvelope` were the same call to
 * `createAgentEnvelopeV2` written twice; the CLI's signature was a strict superset (optional
 * `policy`/`scanStatus`, and the `cli-error` surface), so it is the one that survives.
 *
 * `scanStatus` is typed structurally rather than as `ReturnType<typeof scanStatusPayload>`,
 * because that helper is itself duplicated across the boundary and importing either copy here
 * would make this module pick a side.
 */

import { createAgentEnvelopeV2, type PolicyDecision } from "@drift/core";

export interface AgentEnvelopeScanStatus {
  stale: boolean;
  latest_scan?: { id: string } | null;
}

export function agentEnvelopeForScan(input: {
  surface: PolicyDecision["surface"] | "cli-error";
  policy?: Pick<PolicyDecision, "allowed" | "surface" | "reason">;
  scanStatus?: AgentEnvelopeScanStatus;
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
