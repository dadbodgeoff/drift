import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildFactGraphArtifactFromParts } from "@drift/factgraph";
import { openDriftStorage } from "@drift/storage";

/**
 * T61. Shared seed used by the CLI test files.
 *
 * Lifted out of cli.test.ts so that file can be split apart incrementally: every family in it
 * depends on this helper, so leaving it inline meant any extraction had to duplicate it, and two
 * copies of a test seed drift apart exactly the way two copies of production code do.
 *
 * Callers pass their own `tempDirs` array so each file keeps its own afterEach cleanup.
 */
export async function seedDatabase(tempDirs: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-cli-"));
  tempDirs.push(dir);
  const databasePath = join(dir, "drift.sqlite");
  const storage = openDriftStorage({ databasePath });
  storage.migrate();
  storage.upsertRepo({
    id: "repo_abc",
    root_path: "/repo",
    fingerprint: "repo-fp",
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z"
  });
  storage.upsertConventionCandidate({
    id: "candidate_no_direct_db",
    repo_id: "repo_abc",
    scan_id: "scan_abc",
    kind: "api_route_no_direct_data_access",
    statement: "API routes should not import data-access clients directly.",
    scope: { path_globs: ["apps/web/app/api/**/route.ts"], file_roles: ["api_route"] },
    matcher: {
      kind: "api_route_no_direct_data_access",
      forbidden_imports: ["@/lib/prisma"],
      applies_to_file_roles: ["api_route"]
    },
    requires: { forbidden_imports: ["@/lib/prisma"] },
    suggested_severity: "error",
    suggested_enforcement_mode: "block",
    enforcement_capability: "deterministic_check",
    confidence_label: "high",
    scoring: {
      supporting_examples_count: 12,
      counterexamples_count: 0,
      scope_files_count: 12,
      coverage_ratio: 1,
      heuristic_id: "direct-data-access-import-v1"
    },
    evidence_refs: [],
    counterexample_refs: [],
    matcher_fingerprint: "matcher_fp",
    scope_fingerprint: "scope_fp",
    graph_fingerprint: "graph_fp",
    evidence_fingerprint: "evidence_fp",
    required_capabilities: ["syntax_facts", "import_resolution"],
    reason_not_blocking: "candidate_not_accepted",
    status: "candidate",
    created_at: "2026-05-10T00:00:01.000Z"
  });
  storage.close();
  return databasePath;
}
