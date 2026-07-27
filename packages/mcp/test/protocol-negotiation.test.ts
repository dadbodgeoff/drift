import { describe, expect, it } from "vitest";
import { handleMcpJsonRpcRequest, DRIFT_MCP_PROTOCOL_VERSION } from "../src/index.js";

/**
 * T47. The server pins protocol revision 2024-11-05, and the launch concern was that modern
 * clients would be turned away. Measured behaviour: it accepts any declared version and replies
 * with its own, which is the spec-correct posture - the server states what it supports and the
 * client decides whether to proceed.
 *
 * These pin that, because the tempting "fix" is to echo the client's version back, and doing so
 * silently claims support for semantics the server may not implement.
 */
describe("protocol negotiation", () => {
  const options = { storage: undefined } as never;

  for (const clientVersion of ["2024-11-05", "2025-03-26", "2025-06-18", "2026-07-28"]) {
    it(`accepts a client declaring ${clientVersion} and states its own version`, () => {
      const response = handleMcpJsonRpcRequest(options, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: clientVersion,
          capabilities: {},
          clientInfo: { name: "probe", version: "1" }
        }
      } as never) as { result?: { protocolVersion?: string }; error?: unknown };

      expect(response?.error, `declaring ${clientVersion} must not be rejected`).toBeUndefined();
      // Never echo the client's version: that would claim semantics the server may not implement.
      expect(response?.result?.protocolVersion).toBe(DRIFT_MCP_PROTOCOL_VERSION);
    });
  }
});
