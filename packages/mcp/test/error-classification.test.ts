import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { classifyFailure, selfClassifiedError } from "@drift/core";
import { openDriftStorage } from "@drift/storage";
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

  it("refuses to serve from a mid-file-corrupted database instead of returning success (F-3a)", async () => {
    // R-3 verified silent mode: a DB corrupted in pages the queried tables do not touch was
    // served as success with silently incomplete data. MCP must fail closed.
    const dir = await tempDir();
    const databasePath = join(dir, "drift.sqlite");
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/nonexistent/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    storage.close();

    // Add a filler table and corrupt one of its interior pages: everything get_scan_status
    // reads still walks, which is exactly how the corruption stayed silent.
    const raw = new Database(databasePath);
    const before = (raw.pragma("page_count") as Array<{ page_count: number }>)[0]!.page_count;
    raw.exec("CREATE TABLE filler (id INTEGER PRIMARY KEY, data BLOB)");
    const insert = raw.prepare("INSERT INTO filler (data) VALUES (?)");
    const blob = Buffer.alloc(4000, 7);
    raw.transaction(() => {
      for (let i = 0; i < 200; i++) insert.run(blob);
    })();
    raw.pragma("wal_checkpoint(TRUNCATE)");
    raw.close();

    const bytes = await readFile(databasePath);
    const pageSize = bytes.readUInt16BE(16) === 1 ? 65536 : bytes.readUInt16BE(16);
    const offset = (before + 3) * pageSize; // a page inside the filler btree
    bytes.fill(0xff, offset + 32, offset + pageSize - 32);
    await writeFile(databasePath, bytes);

    const response = handleMcpJsonRpcRequest(
      { databasePath },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_scan_status", arguments: { repo_id: "repo_abc" } }
      }
    );

    expect(response?.error, "corrupt DB must refuse, not serve incomplete data as success").toBeDefined();
    const data = classifiedData(response);
    expect(data.code).toBe("corrupt_database");
    expect(data.safe_to_retry).toBe(false);
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

  it("classifies MCP's own refusals from the error, not from its prose", () => {
    // W4/D-E7. These two throw sites carried no classification, so `classifyFailureMessage`
    // recognised them by the first four words of their sentences - "Scan is stale" and "No repo
    // contract exists". That matched, so nothing was broken; what was true is that since W3 the
    // exit code follows the failure code, so rewording either sentence would have silently
    // demoted a refusal to the catch-all. The CLI stopped being able to do that in W3.
    //
    // Asserted against a REWORDED message, which is the property under test: a classifier reading
    // the code gets it right, and one reading the prose cannot.
    const stale = selfClassifiedError({
      message: "the scan for repo_abc is out of date",
      code: "stale_scan",
      userAction: "Refresh the scan or rerun without --require-fresh for read-only stale context.",
      recoveryCommands: ["drift scan --repo-root ."]
    });
    const missingContract = selfClassifiedError({
      message: "repo_abc has not accepted anything yet",
      code: "missing_contract",
      userAction: "Accept or import a repo contract before running contract-backed enforcement.",
      recoveryCommands: []
    });

    expect(classifyFailure(stale, stale.message).code).toBe("stale_scan");
    expect(classifyFailure(missingContract, missingContract.message).code).toBe("missing_contract");

    // The control: the same reworded prose, thrown as a plain Error, is NOT recognised. This is
    // what the two sites were one edit away from.
    expect(classifyFailure(new Error(stale.message), stale.message).code).not.toBe("stale_scan");
    expect(classifyFailure(new Error("repo_abc has not accepted anything yet"), "repo_abc has not accepted anything yet").code)
      .not.toBe("missing_contract");
  });
});
