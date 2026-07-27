import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

const tempDirs: string[] = [];
let originalEngineBin: string | undefined;

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string; diffPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-security-sensitive-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  const route = await readFile(join(repoRoot, "app/api/users/route.ts"), "utf8");
  const diffPath = join(dir, "change.patch");
  await writeFile(diffPath, [
    "diff --git a/app/api/users/route.ts b/app/api/users/route.ts",
    "--- /dev/null",
    "+++ b/app/api/users/route.ts",
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
describe("security sensitive response fixture matrix", () => {
  it("blocks Phase 5 sensitive response and secret exposure cases", async () => {
    const cases = [
      {
        name: "security-sensitive-leak",
        exitCode: 2,
        convention: sensitiveConvention(),
        proofKey: "response_shape",
        proofStatus: "missing_proof",
        actualLayer: "sensitive_response_field_unfiltered"
      },
      {
        name: "security-sensitive-serializer-pass",
        exitCode: 0,
        convention: sensitiveConvention(),
        proofKey: "response_shape",
        proofStatus: "proven"
      },
      {
        name: "security-secret-leak",
        exitCode: 2,
        convention: secretConvention(),
        proofKey: "sinks",
        proofStatus: "missing_proof",
        actualLayer: "secret_exposure_not_excluded"
      },
      {
        name: "security-response-spread-missing-proof",
        exitCode: 2,
        convention: sensitiveConvention(),
        proofKey: "response_shape",
        proofStatus: "parser_gap",
        actualLayer: "dynamic_response_shape_missing_proof"
      },
      {
        name: "security-sensitive-wrong-serializer-import",
        exitCode: 2,
        convention: sensitiveConvention(),
        proofKey: "response_shape",
        proofStatus: "missing_proof",
        actualLayer: "sensitive_response_field_unfiltered"
      }
    ] as const;

    for (const entry of cases) {
      const { repoRoot, stateRoot, diffPath } = await fixtureRepo(entry.name);
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
        id: "contract_security_sensitive",
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
      expect(proof?.result?.proof_status, `${entry.name} proof status`).toBe(entry.proofStatus);
      expect(proof?.[entry.proofKey], `${entry.name} proof key`).toBeDefined();
      if (entry.actualLayer) {
        expect(payload.findings?.[0]).toMatchObject({
          actual_layer: entry.actualLayer
        });
      } else {
        expect(payload.summary.findings_count, `${entry.name} pass findings`).toBe(0);
      }
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("SECRET_VALUE_SHOULD_NOT_LEAK");
      expect(serialized).not.toContain("sk_live_should_not_leak");
      expect(serialized).not.toContain("API_KEY");
      expect(serialized).not.toContain("redacted@example.test");
    }
  }, 30_000);
});

function sensitiveConvention() {
  return {
    id: "security_api_sensitive_response",
    contract_id: "contract_security_sensitive",
    kind: "api_route_forbids_sensitive_response_fields" as const,
    statement: "API responses must not emit accepted sensitive fields.",
    scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route" as const] },
    matcher: {
      kind: "api_route_forbids_sensitive_response_fields" as const,
      methods: ["GET"],
      applies_to_file_roles: ["api_route" as const]
    },
    requires: {
      sensitive_response_fields: [{
        field_path: "user.email",
        classification: "pii",
        source: "contract"
      }],
      response_serializers: [{
        serializer_id: "serializePublicUser",
        import_source: "../../../lib/serializers/user",
        imported_name: "serializePublicUser",
        local_name: "serializePublicUser",
        policy: "denylist",
        filtered_fields: ["user.email"]
      }]
    },
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

function secretConvention() {
  return {
    id: "security_api_secret_exposure",
    contract_id: "contract_security_sensitive",
    kind: "api_route_forbids_secret_exposure" as const,
    statement: "API routes must not expose accepted secret sources.",
    scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route" as const] },
    matcher: {
      kind: "api_route_forbids_secret_exposure" as const,
      methods: ["GET"],
      applies_to_file_roles: ["api_route" as const]
    },
    requires: {
      secret_sources: ["env"],
      log_sinks: ["console.error"]
    },
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
