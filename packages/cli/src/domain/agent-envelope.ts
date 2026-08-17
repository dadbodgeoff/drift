/**
 * W6: `agentEnvelopeForScan` moved to @drift/query.
 *
 * MCP kept `mcpAgentEnvelope` - the same `createAgentEnvelopeV2` call with a narrower signature -
 * and the two would have had to be edited in step forever. Re-exported from here so the CLI's
 * existing importers keep their path; @drift/query holds the only definition.
 */
export { agentEnvelopeForScan } from "@drift/query";
