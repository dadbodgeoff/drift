import { describe, expect, it } from "vitest";
import { runEngineCheck } from "../src/engine/engine-check.js";
import { diffStatusFor, type ParsedDiff } from "../src/check/diff.js";
import { findingFingerprint } from "../src/check/finding-fingerprint.js";

const scanId = "scan_check_parity";
const repoId = "repo_abc";
const routePath = "app/api/users/route.ts";
const diff: ParsedDiff = {
  files: [{ path: routePath, changedLines: new Set([2]) }],
  deletedFiles: []
};

describe("engine-owned check parity", () => {
  it("matches TypeScript fingerprint and diff semantics for direct data access", async () => {
    const result = await runEngineCheck({
      repoId,
      repoRoot: process.cwd(),
      scanId,
      snapshots: [{
        repo_id: repoId,
        scan_id: scanId,
        file_path: routePath,
        content_hash: "a".repeat(64),
        byte_size: 100,
        indexed: true
      }],
      facts: [
        {
          id: "fact_role",
          repo_id: repoId,
          scan_id: scanId,
          kind: "file_role_detected",
          file_path: routePath,
          name: "api_route",
          start_line: 1,
          end_line: 1
        },
        {
          id: "fact_import",
          repo_id: repoId,
          scan_id: scanId,
          kind: "import_used",
          file_path: routePath,
          name: "prisma",
          value: "@/lib/prisma",
          start_line: 2,
          end_line: 2
        }
      ],
      conventions: [{
        id: "convention_no_direct_db",
        repo_id: repoId,
        contract_id: "contract_abc",
        kind: "api_route_no_direct_data_access",
        statement: "API routes should not import data-access clients directly.",
        scope: { path_globs: ["app/api/**/route.ts"] },
        matcher: {
          kind: "api_route_no_direct_data_access",
          forbidden_imports: ["@/lib/prisma"]
        },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check",
        exceptions: [],
        evidence_refs: [],
        counterexample_refs: [],
        accepted_by: "human",
        accepted_at: "2026-05-10T00:00:00.000Z",
        updated_at: "2026-05-10T00:00:00.000Z"
      }],
      baseline: [],
      diff,
      scope: "changed-hunks"
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      fingerprint: findingFingerprint("convention_no_direct_db", routePath, "prisma", "@/lib/prisma"),
      diff_status: diffStatusFor(routePath, 2, diff, "changed-hunks"),
      status_hint: "new",
      enforcement_result: "block"
    });
  });

  it("matches TypeScript baseline semantics for pre-existing findings", async () => {
    const fingerprint = findingFingerprint("convention_no_direct_db", routePath, "prisma", "@/lib/prisma");
    const result = await runEngineCheck({
      repoId,
      repoRoot: process.cwd(),
      scanId,
      snapshots: [{
        repo_id: repoId,
        scan_id: scanId,
        file_path: routePath,
        content_hash: "a".repeat(64),
        byte_size: 100,
        indexed: true
      }],
      facts: [
        {
          id: "fact_role",
          repo_id: repoId,
          scan_id: scanId,
          kind: "file_role_detected",
          file_path: routePath,
          name: "api_route",
          start_line: 1,
          end_line: 1
        },
        {
          id: "fact_import",
          repo_id: repoId,
          scan_id: scanId,
          kind: "import_used",
          file_path: routePath,
          name: "prisma",
          value: "@/lib/prisma",
          start_line: 2,
          end_line: 2
        }
      ],
      conventions: [{
        id: "convention_no_direct_db",
        repo_id: repoId,
        contract_id: "contract_abc",
        kind: "api_route_no_direct_data_access",
        statement: "API routes should not import data-access clients directly.",
        scope: { path_globs: ["app/api/**/route.ts"] },
        matcher: {
          kind: "api_route_no_direct_data_access",
          forbidden_imports: ["@/lib/prisma"]
        },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check",
        exceptions: [],
        evidence_refs: [],
        counterexample_refs: [],
        accepted_by: "human",
        accepted_at: "2026-05-10T00:00:00.000Z",
        updated_at: "2026-05-10T00:00:00.000Z"
      }],
      baseline: [{
        id: "baseline_abc",
        repo_id: repoId,
        convention_id: "convention_no_direct_db",
        finding_fingerprint: fingerprint,
        file_path: routePath,
        first_seen_scan_id: scanId,
        first_seen_commit: "abc123",
        status: "active",
        created_at: "2026-05-10T00:00:00.000Z"
      }],
      diff,
      scope: "changed-hunks"
    });

    expect(result.findings[0].status_hint).toBe("pre_existing");
  });
});
