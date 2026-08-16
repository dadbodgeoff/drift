import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "../src/index.js";

/**
 * W1. Storage keeps the invariants its own comments claim.
 *
 * Three retention rules were written down and none of them held:
 *
 *   - D-ST2: `upsertConventionCandidate` refreshed twenty columns on conflict and not `scan_id`.
 *     Candidate ids are content-derived, so a re-proposed candidate kept the scan id of whichever
 *     scan first inserted it, and pruning then deleted it out from under the live contract. The
 *     failure was periodic, not constant - every third `drift start --accept-defaults` - which is
 *     why it read as flakiness rather than a bug.
 *
 *   - D-CL1: the sticky-rejected clause could not tell a rescan re-proposing a candidate from a
 *     human running `conventions accept`, so an accept after a reject wrote nothing and reported
 *     success anyway.
 *
 *   - D-ST1: the rule protecting finding-referenced scans queried `findings.scan_id`, a column
 *     that table has never had, inside a bare `catch {}`. It threw on every call for the lifetime
 *     of the table, so the guarantee was never once enforced.
 *
 * These assert behaviour across a scan/prune cycle rather than inspecting SQL, because every one of
 * these bugs was invisible to a single-write test and only appeared once a second scan existed.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDatabasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-retention-"));
  dirs.push(dir);
  return join(dir, "drift.sqlite");
}

function openSeeded() {
  return (async () => {
    const storage = openDriftStorage({ databasePath: await tempDatabasePath() });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_r",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    return storage;
  })();
}

function scan(id: string, previous?: string) {
  return {
    id,
    repo_id: "repo_r",
    branch: "main",
    commit: id,
    dirty: false,
    scanner_version: "0.1.0",
    adapter_versions: { typescript: "0.1.0" },
    rule_engine_version: "0.1.0",
    status: "completed" as const,
    file_count: 1,
    fact_count: 1,
    finding_count: 0,
    previous_scan_id: previous,
    started_at: `2026-05-10T00:00:0${id.slice(-1)}.000Z`,
    completed_at: `2026-05-10T00:00:0${id.slice(-1)}.500Z`
  };
}

/** A candidate whose id is stable across scans, exactly as inference produces them. */
function candidate(scanId: string, status: "candidate" | "accepted" | "rejected" = "candidate") {
  return {
    id: "candidate_stable_id",
    repo_id: "repo_r",
    scan_id: scanId,
    kind: "api_route_no_direct_data_access" as const,
    statement: "API routes should not import data-access clients directly.",
    scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route" as const] },
    matcher: {
      kind: "api_route_no_direct_data_access" as const,
      forbidden_imports: ["@/lib/prisma"],
      applies_to_file_roles: ["api_route" as const]
    },
    requires: { forbidden_imports: ["@/lib/prisma"] },
    suggested_severity: "error" as const,
    suggested_enforcement_mode: "block" as const,
    enforcement_capability: "deterministic_check" as const,
    confidence_label: "high" as const,
    scoring: {
      supporting_examples_count: 3,
      counterexamples_count: 0,
      scope_files_count: 3,
      coverage_ratio: 1,
      heuristic_id: "direct-data-access-import-v1"
    },
    evidence_refs: [],
    counterexample_refs: [],
    evidence_fingerprint: "evidence_fp",
    required_capabilities: ["syntax_facts"],
    reason_not_blocking: "candidate_not_accepted" as const,
    status,
    created_at: "2026-05-10T00:00:01.000Z"
  };
}

describe("W1 scan retention invariants", () => {
  it("refreshes scan_id when a later scan re-proposes the same candidate (D-ST2)", async () => {
    const storage = await openSeeded();

    storage.upsertScanManifest(scan("scan_1"));
    storage.upsertConventionCandidate(candidate("scan_1"));
    storage.upsertScanManifest(scan("scan_2", "scan_1"));
    storage.upsertConventionCandidate(candidate("scan_2"));

    expect(storage.getConventionCandidate("candidate_stable_id")?.scan_id).toBe("scan_2");
  });

  it("keeps a re-proposed candidate alive across repeated scan and prune cycles (D-ST2)", async () => {
    const storage = await openSeeded();

    // Six cycles: the reported failure had period three, so anything shorter passes vacuously.
    let previous: string | undefined;
    for (let index = 1; index <= 6; index += 1) {
      const scanId = `scan_${index}`;
      storage.upsertScanManifest(scan(scanId, previous));
      storage.upsertConventionCandidate(candidate(scanId));
      storage.pruneSupersededScans("repo_r", { keep: 1 });

      expect(
        storage.getConventionCandidate("candidate_stable_id"),
        `candidate vanished after cycle ${index}`
      ).toBeDefined();
      previous = scanId;
    }
  });

  it("lets a human accept override a standing rejection, but not a rescan (D-CL1)", async () => {
    const storage = await openSeeded();
    storage.upsertScanManifest(scan("scan_1"));

    storage.upsertConventionCandidate(candidate("scan_1"));
    storage.upsertConventionCandidate(candidate("scan_1", "rejected"), { decidedByHuman: true });
    expect(storage.getConventionCandidate("candidate_stable_id")?.status).toBe("rejected");

    // A rescan re-proposing identical evidence must not revive it. This is the real feature the
    // sticky clause exists for, and it has to keep working.
    storage.upsertConventionCandidate(candidate("scan_1"));
    expect(storage.getConventionCandidate("candidate_stable_id")?.status).toBe("rejected");

    // A human accepting it deliberately must win.
    storage.upsertConventionCandidate(candidate("scan_1", "accepted"), { decidedByHuman: true });
    expect(storage.getConventionCandidate("candidate_stable_id")?.status).toBe("accepted");
  });

  it("refuses to prune when a retention rule names a column that no longer exists (D-ST1)", async () => {
    const path = await tempDatabasePath();
    const storage = openDriftStorage({ databasePath: path });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_r",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-10T00:00:00.000Z",
      updated_at: "2026-05-10T00:00:00.000Z"
    });
    for (let index = 1; index <= 4; index += 1) {
      storage.upsertScanManifest(scan(`scan_${index}`, index > 1 ? `scan_${index - 1}` : undefined));
    }

    // Break the column `baseline_violations` retention depends on. This is the shape the real bug
    // had: the rule still runs, the column is gone, and the scans it was meant to protect become
    // eligible for deletion. Swallowing that is how it went unnoticed for the table's whole life.
    const side = new Database(path);
    side.exec("ALTER TABLE baseline_violations RENAME COLUMN first_seen_scan_id TO moved_scan_id;");
    side.close();

    expect(() => storage.pruneSupersededScans("repo_r", { keep: 1 })).toThrow(
      /retention is misconfigured/i
    );
  });

  /**
   * Guards the guarantee rather than the fix. Findings reach a scan only through their check run,
   * and the `check_runs` rule already retains a superset of those scans - so this passed before the
   * D-ST1 change too, and is here to fail if someone later removes that rule and assumes findings
   * still cover it.
   */
  it("retains a scan referenced by a finding through its check run (D-ST1)", async () => {
    const storage = await openSeeded();

    storage.upsertScanManifest(scan("scan_1"));
    storage.upsertCheckRun({
      id: "check_1",
      repo_id: "repo_r",
      repo_contract_id: "contract_r",
      contract_fingerprint: "contract-fp",
      scan_id: "scan_1",
      status: "fail",
      scope: "changed-hunks",
      engine_source: "rust",
      fallback_used: false,
      stale_scan: false,
      capability_complete: true,
      findings_count: 1,
      blocking_count: 1,
      started_at: "2026-05-10T00:00:01.000Z",
      completed_at: "2026-05-10T00:00:02.000Z"
    });
    storage.upsertFinding({
      id: "finding_1",
      repo_id: "repo_r",
      convention_id: "convention_x",
      fingerprint: "finding-fp",
      title: "Direct data access in an API route",
      message: "Route imports the client directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "touched_existing",
      evidence_refs: [],
      check_id: "check_1",
      created_by_engine_version: "0.1.0",
      created_by_rule_engine_version: "0.1.0",
      contract_schema_version: 1,
      created_at: "2026-05-10T00:00:02.000Z"
    });

    for (let index = 2; index <= 5; index += 1) {
      storage.upsertScanManifest(scan(`scan_${index}`, `scan_${index - 1}`));
    }

    const result = storage.pruneSupersededScans("repo_r", { keep: 1 });

    expect(result.deleted).not.toContain("scan_1");
    expect(storage.listScanManifests("repo_r").map((manifest) => manifest.id)).toContain("scan_1");
  });
});
