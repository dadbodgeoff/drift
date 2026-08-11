import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import { checkRunIdsFor } from "../src/domain/identifiers.js";

/**
 * F-4 (R-2 fix). Verified in the R-2 concurrency run: checkId was
 * hashStable(repoId:scope:now) at millisecond resolution and upsertCheckRun does
 * ON CONFLICT(id) DO UPDATE, so three checks landing in the same millisecond derived the same
 * id and silently merged into ONE check_runs row - two audit records gone, last writer wins.
 * Every invocation must get a distinct id even at identical (repoId, scope, now).
 */

const tempDirs: string[] = [];

async function tempDatabasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-check-ids-"));
  tempDirs.push(dir);
  return join(dir, "drift.sqlite");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SAME_MS = "2026-08-02T12:00:00.000Z";

describe("concurrent checks in the same millisecond keep distinct check_runs rows", () => {
  it("derives distinct ids for identical (repoId, scope, now)", () => {
    const first = checkRunIdsFor("repo_abc", "changed-hunks", SAME_MS);
    const second = checkRunIdsFor("repo_abc", "changed-hunks", SAME_MS);
    const third = checkRunIdsFor("repo_abc", "changed-hunks", SAME_MS);
    expect(new Set([first.checkId, second.checkId, third.checkId]).size).toBe(3);
    expect(new Set([first.checkScanId, second.checkScanId, third.checkScanId]).size).toBe(3);
    for (const ids of [first, second, third]) {
      expect(ids.checkId).toMatch(/^check_[0-9a-f]{16}$/);
      expect(ids.checkScanId).toMatch(/^scan_check_[0-9a-f]{16}$/);
    }
  });

  it("persists three same-millisecond checks as three rows, not one merged row", async () => {
    const databasePath = await tempDatabasePath();
    const storage = openDriftStorage({ databasePath });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: SAME_MS,
      updated_at: SAME_MS
    });

    // Exactly what three concurrent `drift check` invocations do at the storage seam: derive
    // ids from the same (repoId, scope, now), then upsert the completed row.
    for (let invocation = 0; invocation < 3; invocation++) {
      const { checkId, checkScanId } = checkRunIdsFor("repo_abc", "changed-hunks", SAME_MS);
      storage.upsertCheckRun({
        id: checkId,
        repo_id: "repo_abc",
        repo_contract_id: "contract_abc",
        contract_fingerprint: "contract-fp",
        scan_id: checkScanId,
        status: invocation === 2 ? "pass" : "fail",
        scope: "changed-hunks",
        engine_source: "rust",
        fallback_used: false,
        stale_scan: false,
        capability_complete: true,
        findings_count: invocation === 2 ? 0 : 1,
        blocking_count: invocation === 2 ? 0 : 1,
        started_at: SAME_MS,
        completed_at: SAME_MS
      });
    }

    const rows = storage.listCheckRuns("repo_abc");
    storage.close();
    // The R-2 verified failure: 3 same-ms checks -> 1 row, the failing runs' audit trail
    // overwritten by whichever finished last.
    expect(rows.length).toBe(3);
    expect(rows.filter((row) => row.status === "fail").length).toBe(2);
  });
});
