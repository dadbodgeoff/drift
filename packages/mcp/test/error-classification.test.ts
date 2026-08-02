import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { handleMcpJsonRpcRequest } from "../src/index.js";

/**
 * F-2 (R-3 fix). The MCP surface had no error classification at all: its catch handler forwarded
 * raw error.message as JSON-RPC -32000, so agents received "file is not a database", "database
 * disk image is malformed", and "disk I/O error" verbatim with no code, no action, and no retry
 * guidance. MCP errors must carry the same classification the CLI reports.
 */

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-mcp-errors-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function classifiedData(response: ReturnType<typeof handleMcpJsonRpcRequest>): {
  code: string;
  user_action: string;
  safe_to_retry: boolean;
  recovery_commands: string[];
} {
  expect(response?.error, "expected a JSON-RPC error response").toBeDefined();
  const data = (response?.error as { data?: unknown })?.data;
  expect(data, "JSON-RPC error must carry classified data").toBeDefined();
  return data as ReturnType<typeof classifiedData>;
}

describe("MCP errors arrive classified, not as raw SQLite strings", () => {
  it("classifies a corrupt (non-SQLite) database as corrupt_database with an action", async () => {
    const dir = await tempDir();
    const databasePath = join(dir, "drift.sqlite");
    // A file that is not a SQLite database - the R-3 shape that reached agents verbatim as
    // "file is not a database" with JSON-RPC code -32000 and nothing else.
    await writeFile(databasePath, "this is not a sqlite database and never was\n".repeat(64));

    const response = handleMcpJsonRpcRequest(
      { databasePath },
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_scan_status", arguments: { repo_id: "repo_abc" } }
      }
    );

    expect(response?.error?.code).toBe(-32000);
    const data = classifiedData(response);
    expect(data.code).toBe("corrupt_database");
    expect(data.safe_to_retry).toBe(false);
    expect(data.user_action).toMatch(/backup|rebuild/i);
    expect(data.recovery_commands.length).toBeGreaterThan(0);
  });

  it("still classifies plain request errors with a code and next action", async () => {
    const dir = await tempDir();
    const databasePath = join(dir, "drift.sqlite");
    await writeFile(databasePath, "garbage");

    const response = handleMcpJsonRpcRequest(
      { databasePath },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_scan_status", arguments: {} } }
    );

    // Invalid arguments never reach the database; they classify as a generic error but must
    // still carry the classified shape so agents can branch on it.
    const data = classifiedData(response);
    expect(data.code).toBeTruthy();
    expect(data.user_action).toBeTruthy();
    expect(typeof data.safe_to_retry).toBe("boolean");
  });
});
