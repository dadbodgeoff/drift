import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

const tempDirs: string[] = [];
let originalEngineBin: string | undefined;

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string; diffPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-security-tenant-authorization-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  const route = await readFile(join(repoRoot, "app/api/projects/route.ts"), "utf8");
  const diffPath = join(dir, "change.patch");
  await writeFile(diffPath, [
    "diff --git a/app/api/projects/route.ts b/app/api/projects/route.ts",
    "--- /dev/null",
    "+++ b/app/api/projects/route.ts",
    `@@ -0,0 +1,${route.split(/\r?\n/).filter(Boolean).length} @@`,
    ...route.trimEnd().split(/\r?\n/).map((line) => `+${line}`),
    ""
  ].join("\n"));
  return { repoRoot, stateRoot, diffPath };
}

beforeEach(() => {
  originalEngineBin = process.env.DRIFT_ENGINE_BIN;
  process.env.DRIFT_ENGINE_BIN = resolve("target/debug/drift-engine");
});

afterEach(async () => {
  if (originalEngineBin === undefined) {
    delete process.env.DRIFT_ENGINE_BIN;
  } else {
    process.env.DRIFT_ENGINE_BIN = originalEngineBin;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// A5 made `drift check` exit 2 for a blocked diff, distinct from 1 (Drift itself failed) and
// 3 (fail-closed refusal). CI has to tell "this diff violates the contract" from "the tool
// broke". These matrices predate that and expected 1 for every blocking case.
describe("security tenant authorization fixture matrix", () => {
  it("security tenant authorization fixture matrix proves phase4 trust and gaps", async () => {
    const cases = [
      {
        name: "security-tenant-missing",
        kind: "api_route_requires_tenant_scope",
        exitCode: 2,
        proof: "tenant",
        proven: false,
        missingReason: "tenant_predicate_missing",
        parserGap: false
      },
      {
        name: "security-tenant-param-unused",
        kind: "api_route_requires_tenant_scope",
        exitCode: 2,
        proof: "tenant",
        proven: false,
        missingReason: "tenant_predicate_not_bound_to_query",
        parserGap: false
      },
      {
        name: "security-tenant-bound-to-query",
        kind: "api_route_requires_tenant_scope",
        exitCode: 0,
        proof: "tenant",
        proven: true,
        parserGap: false
      },
      {
        name: "security-tenant-untrusted-source",
        kind: "api_route_requires_tenant_scope",
        exitCode: 2,
        proof: "tenant",
        proven: false,
        missingReason: "tenant_source_untrusted",
        parserGap: false
      },
      {
        name: "security-tenant-parser-gap",
        kind: "api_route_requires_tenant_scope",
        exitCode: 2,
        proof: "tenant",
        proven: false,
        parserGap: true
      },
      {
        name: "security-role-missing",
        kind: "api_route_requires_authorization",
        exitCode: 2,
        proof: "authorization",
        proven: false,
        missingReason: "authorization_guard_missing",
        parserGap: false
      },
      {
        name: "security-role-guard-present",
        kind: "api_route_requires_authorization",
        exitCode: 0,
        proof: "authorization",
        proven: true,
        parserGap: false
      },
      {
        name: "security-role-branch-bypass",
        kind: "api_route_requires_authorization",
        exitCode: 2,
        proof: "authorization",
        proven: false,
        missingReason: "authorization_guard_not_dominating_sink",
        parserGap: false
      },
      {
        name: "security-session-from-request-untrusted",
        kind: "session_object_must_come_from_trusted_helper",
        exitCode: 2,
        proof: "session_trust",
        proven: false,
        missingReason: "derived_from_request",
        parserGap: false
      },
      {
        name: "security-session-trusted-helper",
        kind: "session_object_must_come_from_trusted_helper",
        exitCode: 0,
        proof: "session_trust",
        proven: true,
        parserGap: false
      }
    ] as const;

    for (const entry of cases) {
      const { repoRoot, stateRoot, diffPath } = await fixtureRepo(entry.name);
      const scan = await runCli([
        "scan",
        "--repo-root", repoRoot,
        "--state-root", stateRoot,
        "--now", "2026-05-26T00:00:00.000Z",
        "--json"
      ]);
      expect(scan.exitCode, `${entry.name} scan stderr:\n${scan.stderr}`).toBe(0);
      const scanPayload = JSON.parse(scan.stdout);

      const storage = openDriftStorage({ databasePath: scanPayload.database_path });
      storage.migrate();
      const convention = phase4Convention(entry.kind);
      storage.upsertAcceptedConvention(scanPayload.repo.id, convention);
      storage.upsertRepoContract({
        id: "contract_security_phase4",
        repo_id: scanPayload.repo.id,
        contract_schema_version: 1,
        repo_fingerprint: scanPayload.repo.fingerprint,
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        conventions: [convention],
        rejected_inferences: [],
        waivers: [],
        risky_areas: [],
        safe_commands: [],
        required_checks: [],
        context_egress: {
          default_mode: "local_only",
          denied_globs: [".env*", "**/*.pem"],
          max_snippet_chars: 1200,
          allow_full_file_content: false
        },
        agent_permissions: []
      });
      storage.close();

      const check = await runCli([
        "--db", scanPayload.database_path,
        "check",
        "--repo", scanPayload.repo.id,
        "--scope", "changed-hunks",
        "--diff-file", diffPath,
        "--now", "2026-05-26T00:00:01.000Z",
        "--json"
      ]);
      expect(check.exitCode, `${entry.name} check stderr:\n${check.stderr}\nstdout:\n${check.stdout}`).toBe(entry.exitCode);
      const payload = JSON.parse(check.stdout);
      const proof = payload.security_boundary_proofs?.[0];
      expect(proof?.[entry.proof], `${entry.name} proof:\n${JSON.stringify(payload)}`).toMatchObject({
        required: true,
        proven: entry.proven
      });
      if (entry.missingReason) {
        expect(JSON.stringify(proof)).toContain(entry.missingReason);
      }
      expect((proof?.parser_gaps ?? []).length > 0, `${entry.name} parser gap`).toBe(entry.parserGap);
      expect(JSON.stringify(payload)).not.toContain("session.user.tenantId");
      expect(JSON.stringify(payload)).not.toContain("session-concrete-value-should-not-leak");
      expect(JSON.stringify(payload)).not.toContain("user-actual-id-should-not-leak");
      expect(JSON.stringify(payload)).not.toContain("tenant-actual-value");
      expect(JSON.stringify(payload)).not.toContain("header-actual-value-should-not-leak");
      expect(JSON.stringify(payload)).not.toContain("cookie-actual-value-should-not-leak");
      expect(JSON.stringify(payload)).not.toContain("payload-actual-value-should-not-leak");
      expect(JSON.stringify(payload)).not.toContain("raw-sql-tenant-value-should-not-leak");
      expect(JSON.stringify(payload)).not.toContain("request.json()");
      expect(JSON.stringify(payload)).not.toContain("SECRET_VALUE_SHOULD_NOT_LEAK");
    }
  }, 60_000);
});

function phase4Convention(kind: "api_route_requires_tenant_scope" | "api_route_requires_authorization" | "session_object_must_come_from_trusted_helper") {
  return {
    id: `security_${kind}`,
    contract_id: "contract_security_phase4",
    kind,
    statement: "Phase 4 security boundary proof is required.",
    scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route" as const] },
    matcher: {
      kind,
      applies_to_file_roles: ["api_route" as const]
    },
    requires: {
      auth_helpers: [{ guard_id: "auth_require_user", symbol: "requireUser", behavior: "returns_session" }],
      authorization_helpers: ["requireRole", "canAccessProject"],
      tenant_helpers: ["scopeProjectToTenant"],
      tenant_keys: ["tenantId"],
      tenant_sources: ["session", "query", "body"],
      data_operations: ["findMany", "findUnique", "delete"]
    },
    severity: "error" as const,
    enforcement_mode: "block" as const,
    enforcement_capability: "deterministic_check" as const,
    exceptions: [],
    evidence_refs: [],
    counterexample_refs: [],
    accepted_by: "test",
    accepted_at: "2026-05-26T00:00:00.000Z",
    updated_at: "2026-05-26T00:00:00.000Z"
  };
}
