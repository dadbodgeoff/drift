import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

const tempDirs: string[] = [];
let originalEngineBin: string | undefined;

interface FixtureRepo {
  repoRoot: string;
  stateRoot: string;
  diffPath: string;
  routePath: string;
}

async function fixtureRepo(name: string, routePath: string): Promise<FixtureRepo> {
  const dir = await mkdtemp(join(tmpdir(), "drift-security-phase6-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  const route = await readFile(join(repoRoot, routePath), "utf8");
  const diffPath = join(dir, "change.patch");
  await writeFile(diffPath, [
    `diff --git a/${routePath} b/${routePath}`,
    "--- /dev/null",
    `+++ b/${routePath}`,
    `@@ -0,0 +1,${route.split(/\r?\n/).filter(Boolean).length} @@`,
    ...route.trimEnd().split(/\r?\n/).map((line) => `+${line}`),
    ""
  ].join("\n"));
  return { repoRoot, stateRoot, diffPath, routePath };
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
describe("security Phase 6 fixture matrix", () => {
  it("proves SSRF, raw SQL, CORS, CSRF, and rate-limit contracts through drift check", async () => {
    const cases = [
      {
        name: "security-ssrf",
        routePath: "app/api/proxy/route.ts",
        convention: ssrfConvention(),
        exitCode: 2,
        proofPath: ["ssrf"],
        proofStatus: "missing_proof",
        missingCode: "request_controlled_url"
      },
      {
        name: "security-ssrf-allowlist-pass",
        routePath: "app/api/proxy/route.ts",
        convention: ssrfConvention(),
        exitCode: 0,
        proofPath: ["ssrf"],
        proofStatus: "proven"
      },
      {
        name: "security-raw-sql",
        routePath: "app/api/users/route.ts",
        convention: rawSqlConvention(),
        exitCode: 2,
        proofPath: ["raw_sql"],
        proofStatus: "missing_proof",
        missingCode: "raw_sql_unparameterized"
      },
      {
        name: "security-raw-sql-parameterized-pass",
        routePath: "app/api/users/route.ts",
        convention: rawSqlConvention(),
        exitCode: 0,
        proofPath: ["raw_sql"],
        proofStatus: "proven"
      },
      {
        name: "security-cors-policy-violation",
        routePath: "app/api/public/route.ts",
        convention: corsConvention(),
        exitCode: 2,
        proofPath: ["cors"],
        proofStatus: "missing_proof",
        missingCode: "wildcard_origin_with_credentials"
      },
      {
        name: "security-csrf-missing",
        routePath: "app/api/settings/route.ts",
        convention: csrfConvention(),
        exitCode: 2,
        proofPath: ["csrf"],
        proofStatus: "missing_proof",
        missingCode: "missing_csrf_guard"
      },
      {
        name: "security-rate-limit-missing",
        routePath: "app/api/login/route.ts",
        convention: rateLimitConvention(),
        exitCode: 2,
        proofPath: ["rate_limit"],
        proofStatus: "missing_proof",
        missingCode: "missing_rate_limit_guard"
      }
    ];

    for (const entry of cases) {
      const { repoRoot, stateRoot, diffPath } = await fixtureRepo(entry.name, entry.routePath);
      const scan = await runCli([
        "scan",
        "--repo-root", repoRoot,
        "--state-root", stateRoot,
        "--now", "2026-05-27T00:00:00.000Z",
        "--json"
      ]);
      expect(scan.exitCode, `${entry.name} scan stderr:\n${scan.stderr}`).toBe(0);
      const scanPayload = JSON.parse(scan.stdout);

      const storage = openDriftStorage({ databasePath: scanPayload.database_path });
      storage.migrate();
      storage.upsertAcceptedConvention(scanPayload.repo.id, entry.convention);
      storage.upsertRepoContract({
        id: "contract_security_phase6",
        repo_id: scanPayload.repo.id,
        contract_schema_version: 1,
        repo_fingerprint: scanPayload.repo.fingerprint,
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z",
        conventions: [entry.convention],
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
        "--now", "2026-05-27T00:00:01.000Z",
        "--json"
      ]);
      expect(check.exitCode, `${entry.name} check stderr:\n${check.stderr}\nstdout:\n${check.stdout}`).toBe(entry.exitCode);
      const payload = JSON.parse(check.stdout);
      const proof = payload.security_boundary_proofs?.[0];
      const proofSection = entry.proofPath.reduce((value, key) => value?.[key], proof);
      expect(proof?.result?.proof_status, `${entry.name} proof status`).toBe(entry.proofStatus);
      expect(proofSection, `${entry.name} proof section`).toMatchObject({
        required: true,
        proven: entry.proofStatus === "proven"
      });
      if (entry.missingCode) {
        expect(JSON.stringify(proof)).toContain(entry.missingCode);
        expect(payload.findings?.[0]).toMatchObject({
          convention_id: entry.convention.id,
          actual_layer: entry.missingCode
        });
      } else {
        expect(payload.summary.findings_count, `${entry.name} pass findings`).toBe(0);
      }
      expect(JSON.stringify(payload)).not.toContain("select * from users");
      expect(JSON.stringify(payload)).not.toContain("Access-Control-Allow-Origin");
      expect(JSON.stringify(payload)).not.toContain("target=");
      expect(JSON.stringify(payload)).not.toContain("token=");
    }
  }, 45_000);
});

function baseConvention(kind: string, id: string, matcher: Record<string, unknown>, requires: Record<string, unknown> = {}) {
  return {
    id,
    contract_id: "contract_security_phase6",
    kind,
    statement: "Phase 6 security contract.",
    scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route" as const] },
    matcher: {
      kind,
      applies_to_file_roles: ["api_route" as const],
      ...matcher
    },
    requires,
    severity: "error" as const,
    enforcement_mode: "block" as const,
    enforcement_capability: "deterministic_check" as const,
    exceptions: [],
    evidence_refs: [],
    counterexample_refs: [],
    accepted_by: "test",
    accepted_at: "2026-05-27T00:00:00.000Z",
    updated_at: "2026-05-27T00:00:00.000Z"
  };
}

function ssrfConvention() {
  return baseConvention(
    "api_route_forbids_untrusted_ssrf",
    "security_api_no_untrusted_ssrf",
    { methods: ["GET"] },
    {
      outbound_url_allowlist_helpers: [{
        helper_id: "network:requireAllowedOutboundUrl",
        module: "@/security/outbound",
        symbol: "requireAllowedOutboundUrl"
      }]
    }
  );
}

function rawSqlConvention() {
  return baseConvention(
    "api_route_forbids_raw_sql_without_params",
    "security_api_no_raw_sql",
    { methods: ["GET"] }
  );
}

function corsConvention() {
  return baseConvention(
    "api_route_cors_must_match_policy",
    "security_api_cors_policy",
    { methods: ["GET"] },
    {
      allowed_origins: ["https://app.example.com"],
      allow_credentials: false
    }
  );
}

function csrfConvention() {
  return baseConvention(
    "api_route_requires_csrf_for_mutation",
    "security_api_requires_csrf",
    { methods: ["POST"] },
    {
      csrf_helpers: [{
        helper_id: "csrf:requireCsrf",
        module: "@/security/csrf",
        symbol: "requireCsrf"
      }]
    }
  );
}

function rateLimitConvention() {
  return baseConvention(
    "api_route_requires_rate_limit",
    "security_api_requires_rate_limit",
    {
      methods: ["POST"],
      route_paths: ["/api/login"]
    },
    {
      rate_limit_helpers: [{
        helper_id: "rateLimit:requireRateLimit",
        module: "@/security/rate-limit",
        symbol: "requireRateLimit"
      }]
    }
  );
}
