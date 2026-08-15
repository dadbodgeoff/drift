import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RepoContract } from "@drift/core";
import { relevantFileForPath, relevantFilesForTask, tokenizeTask } from "../src/relevance.js";

/**
 * One implementation, and the behaviours that were adjudicated correct before it.
 *
 * The CLI and MCP each had their own copy of file selection. They diverged three ways, all
 * measured: the in-scope predicate (the CLI tested `path_globs` while `check` enforces with
 * `conventionScopeFiles`), `.gitignore` handling, and declaration files. These pin the winning
 * side of each, so collapsing to one implementation cannot quietly adopt the losing one.
 */

function contractWith(convention: Partial<RepoContract["conventions"][number]>): RepoContract {
  return {
    id: "contract_test",
    repo_id: "repo_test",
    contract_schema_version: 1,
    repo_fingerprint: "fp",
    conventions: [
      {
        id: "convention_test",
        contract_id: "contract_test",
        kind: "api_route_no_direct_data_access",
        statement: "s",
        scope: { path_globs: [], file_roles: [] },
        matcher: {},
        severity: "error",
        enforcement_mode: "warn",
        enforcement_capability: "deterministic_check",
        exceptions: [],
        evidence_refs: [],
        counterexample_refs: [],
        accepted_by: "test",
        accepted_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...convention
      } as RepoContract["conventions"][number]
    ],
    agent_contracts: [],
    agent_permissions: [],
    waivers: [],
    required_checks: [],
    safe_commands: [],
    risky_areas: [],
    rejected_inferences: [],
    context_egress: { denied_globs: [] }
  } as unknown as RepoContract;
}

describe("relevant file selection", () => {
  it("tokenises the way both surfaces did, not the way a rewrite might assume", () => {
    // `_ / -` survive the split, so `app/api` is ONE token rather than two - a path fragment in a
    // task matches a path. The floor is three characters, so `in` is dropped. Both details decide
    // which files earn a `task token:` reason, which is what puts a file in front of an agent.
    expect([...tokenizeTask("update user_id in app/api")].sort()).toEqual([
      "app/api",
      "update",
      "user_id"
    ]);
    // Two characters is below the floor.
    expect([...tokenizeTask("fix db")].sort()).toEqual(["fix"]);
  });

  it("uses the canonical scope predicate, not a glob test", () => {
    // BB-11 adjudicated glob-only as a bug. `exclude_path_globs` is one of four things it gets
    // wrong; a glob test would report this file in scope.
    const contract = contractWith({
      scope: {
        path_globs: ["apps/web/app/api/**"],
        exclude_path_globs: ["apps/web/app/api/internal/**"],
        file_roles: []
      }
    });
    const excluded = relevantFileForPath(
      "apps/web/app/api/internal/route.ts",
      new Set<string>(),
      contract
    );
    expect(excluded?.reasons ?? []).not.toContain("in scope for convention_test");

    const included = relevantFileForPath("apps/web/app/api/public/route.ts", new Set<string>(), contract);
    expect(included?.reasons ?? []).toContain("in scope for convention_test");
  });

  it("walks with gitignore applied and includes declaration files", async () => {
    // The MCP copy had neither: it never read .gitignore, and never learned about `.prisma` when
    // the scan gained it - so `prepare` and `get_task_preflight` disagreed about whether the
    // schema file was worth mentioning for a task about the schema.
    const dir = await mkdtemp(join(tmpdir(), "drift-relevance-"));
    await mkdir(join(dir, "prisma"), { recursive: true });
    await mkdir(join(dir, "generated"), { recursive: true });
    await writeFile(join(dir, ".gitignore"), "generated/\n");
    await writeFile(join(dir, "prisma/schema.prisma"), "model Thing {\n  id String @id\n}\n");
    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
    await writeFile(join(dir, "generated/widget.ts"), "export const generated = 1;\n");

    const files = relevantFilesForTask({
      repoRoot: dir,
      task: "update the widget schema",
      contract: contractWith({})
    });
    const paths = files.map((file) => file.path);

    expect(paths).toContain("prisma/schema.prisma");
    expect(paths).toContain("widget.ts");
    expect(paths).not.toContain("generated/widget.ts");
  });

  it("ranks before capping", () => {
    // An unranked slice returns whatever the walk reached first, and convention scope matches every
    // route in a repository - so the cap was previously exhausted by arbitrary files.
    const contract = contractWith({});
    const tokens = tokenizeTask("invites");
    const scored = relevantFileForPath("apps/web/app/api/invites/route.ts", tokens, contract);
    const unscored = relevantFileForPath("apps/web/app/api/other/route.ts", tokens, contract);
    expect(scored?.reasons).toContain("task token: invites");
    expect(unscored?.reasons ?? []).not.toContain("task token: invites");
  });
});
