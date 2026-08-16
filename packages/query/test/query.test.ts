import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_ROUTE_SCOPE_GLOBS, ENGINE_CERTIFIED_SCAN_CAPABILITIES, type Finding, type RepoContract } from "@drift/core";
import { buildFactGraphArtifact, buildFactGraphArtifactFromParts } from "@drift/factgraph";
import { openDriftStorage } from "@drift/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLayerArchitectureProof,
  buildEntrypointFlowProof,
  buildChangeImpact,
  buildFindingsReadModel,
  buildParserGapSummary,
  buildReadiness,
  buildRepoContractReadModel,
  buildRepoMapReadModel,
  buildRepoTopology,
  buildSemanticCoverage,
  buildSemanticCoverageFromCapabilityReport,
  buildStoredScanReadiness,
  buildSymbolIdentity,
  classifyAgentTask,
  classifyDataOperationRisk,
  createGraphQueryService,
  evaluateRoleEdge,
  fallbackFactRepoMapFiles,
  selectRelevantTests,
  scoreHelperSimilarity
} from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function findingFixture(input: {
  id: string;
  severity: Finding["severity"];
  status: Finding["status"];
  diff_status: Finding["diff_status"];
  convention_id: string;
  file_path: string;
  created_at: string;
}): Finding {
  return {
    id: input.id,
    repo_id: "repo_abc",
    convention_id: input.convention_id,
    fingerprint: `${input.id}_fingerprint`,
    title: "Finding",
    message: "Finding message.",
    severity: input.severity,
    enforcement_result: input.severity === "error" ? "block" : "warn",
    status: input.status,
    diff_status: input.diff_status,
    evidence_refs: [{
      id: `${input.id}_evidence`,
      kind: "violation",
      file_path: input.file_path,
      start_line: 1,
      end_line: 1,
      symbol: "runCli",
      import_source: "@drift/cli",
      fact_ids: [],
      scan_id: "scan_abc",
      file_hash: "a".repeat(64),
      redaction_state: "none"
    }],
    created_at: input.created_at
  };
}

function contractFixture(): RepoContract {
  return {
    id: "contract_abc",
    repo_id: "repo_abc",
    contract_schema_version: 1,
    repo_fingerprint: "repo-fp",
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
    conventions: [],
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
    agent_permissions: [],
    agent_contracts: [{
      kind: "import_boundary",
      id: "agent_contract_abc",
      version: 1,
      source_roles: ["mcp_module"],
      forbidden_imports: ["@drift/cli"],
      enforcement: "blocking"
    }]
  };
}

describe("GraphQueryService", () => {
  it("classifies route to data access as a forbidden role edge", () => {
    const result = evaluateRoleEdge({
      from_role: "route",
      to_role: "data_access",
      edge_kind: "imports"
    });

    expect(result).toMatchObject({
      allowed: false,
      severity: "blocking",
      reason_code: "route_must_not_import_data_access"
    });
  });

  it("classifies service to data access as allowed", () => {
    expect(evaluateRoleEdge({
      from_role: "service",
      to_role: "data_access",
      edge_kind: "imports"
    })).toMatchObject({ allowed: true });
  });

  it("normalizes scanner-emitted file roles before evaluating role edges", () => {
    expect(evaluateRoleEdge({
      from_role: "api_route",
      to_role: "data_access_module",
      edge_kind: "imports"
    })).toMatchObject({
      allowed: false,
      severity: "blocking",
      reason_code: "route_must_not_import_data_access"
    });

    expect(evaluateRoleEdge({
      from_role: "service_module",
      to_role: "data_access_module",
      edge_kind: "imports"
    })).toMatchObject({
      allowed: true,
      reason_code: "service_may_use_data_access"
    });
  });

  it("lets repo-contract role ontology rules override built-in role edge defaults", () => {
    expect(evaluateRoleEdge({
      from_role: "route",
      to_role: "data_access",
      edge_kind: "imports",
      rules: [{
        rule_id: "role_rule_data_migration_route",
        from_role: "route",
        to_role: "data_access",
        edge_kind: "imports",
        allowed: true,
        severity: "warning",
        reason_code: "repo_contract_allows_migration_route_data_access",
        reason: "This repo has an explicit migration endpoint exception.",
        source: "repo_contract"
      }]
    })).toMatchObject({
      allowed: true,
      severity: "warning",
      reason_code: "repo_contract_allows_migration_route_data_access",
      source: "repo_contract",
      rule_id: "role_rule_data_migration_route"
    });
  });

  it("builds a route service data access architecture proof", () => {
    const proof = buildLayerArchitectureProof({
      entrypoint: "apps/web/app/api/users/route.ts",
      graph_edges: [
        { from_layer: "route", to_layer: "service", edge_kind: "imports" },
        { from_layer: "service", to_layer: "data_access", edge_kind: "imports" }
      ],
      architecture: {
        schema_version: "drift.layer_architecture.v1",
        architecture_id: "architecture_api_layering",
        repo_id: "repo_abc",
        version: 1,
        layers: [
          { id: "route", role: "route", position: "entrypoint" },
          { id: "service", role: "service", position: "middle" },
          { id: "data_access", role: "data_access", position: "terminal" }
        ],
        allowed_edges: [
          { from_layer: "route", to_layer: "service" },
          { from_layer: "service", to_layer: "data_access" }
        ],
        forbidden_edges: [{ from_layer: "route", to_layer: "data_access" }],
        soft_edges: []
      }
    });

    expect(proof).toMatchObject({
      entrypoint_layer: "route",
      terminal_layers_reached: ["data_access"],
      forbidden_edges_present: []
    });
  });

  it("classifies data operations by side effect risk", () => {
    expect(classifyDataOperationRisk({
      receiver_name: "prisma.user",
      operation_name: "delete"
    })).toMatchObject({
      operation_family: "orm_operation",
      effect: "delete",
      risk: "destructive_write"
    });

    expect(classifyDataOperationRisk({
      receiver_name: "process.env",
      operation_name: "SECRET"
    })).toMatchObject({
      operation_family: "env_secret_read",
      effect: "secret_access"
    });
  });

  it("tracks canonical symbol identity across import aliases and re-exports", () => {
    const identity = buildSymbolIdentity({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      symbol_name: "getUserById",
      declared_in: "server/services/users.ts",
      exported_from: ["server/services/users.ts", "server/services/index.ts"],
      imported_as: [{ file_path: "app/api/users/route.ts", local_name: "loadUser" }],
      call_sites: [{ file_path: "app/api/users/route.ts", start_line: 4, end_line: 4 }]
    });

    expect(identity).toMatchObject({
      canonical_definition: "server/services/users.ts#getUserById",
      imported_as: [{ file_path: "app/api/users/route.ts", local_name: "loadUser" }],
      re_export_chain: ["server/services/index.ts"]
    });
  });

  it("maps a changed repository function to affected routes and tests", () => {
    const impact = buildChangeImpact({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      changed_files: ["server/repositories/users.ts"],
      route_flows: [{
        route: "GET /api/users",
        service_file: "server/services/users.ts",
        data_access_file: "server/repositories/users.ts",
        data_operation: "prisma.user.findMany"
      }],
      symbol_identities: [{
        schema_version: "drift.symbol_identity.v1",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        symbol_name: "findUsers",
        kind: "function",
        declared_in: "server/repositories/users.ts",
        exported_from: ["server/repositories/index.ts"],
        imported_as: [{ file_path: "server/services/users.ts", local_name: "findUsers" }],
        re_export_chain: ["server/repositories/index.ts"],
        canonical_definition: "server/repositories/users.ts#findUsers",
        call_sites: [{ file_path: "server/services/users.ts", start_line: 4, end_line: 4 }],
        references: [{ file_path: "server/services/users.ts", start_line: 4, end_line: 4 }],
        visibility: "exported"
      }],
      test_files: ["server/services/users.test.ts"]
    });

    expect(impact).toMatchObject({
      changed_symbols: ["server/repositories/users.ts#findUsers"],
      affected_routes: expect.arrayContaining(["GET /api/users"]),
      affected_services: expect.arrayContaining(["server/services/users.ts"]),
      affected_data_ops: expect.arrayContaining(["data_operation:read"]),
      affected_tests: expect.arrayContaining(["server/services/users.test.ts"])
    });
  });

  it("builds shared findings review models for CLI and MCP transports", () => {
    const findings: Finding[] = [
      findingFixture({
        id: "finding_b",
        severity: "warning",
        status: "pre_existing",
        diff_status: "pre_existing",
        convention_id: "convention_docs",
        file_path: "docs/readme.md",
        created_at: "2026-05-10T00:00:02.000Z"
      }),
      findingFixture({
        id: "finding_a",
        severity: "error",
        status: "new",
        diff_status: "new_in_diff",
        convention_id: "convention_api",
        file_path: "apps/web/app/api/users/route.ts",
        created_at: "2026-05-10T00:00:01.000Z"
      })
    ];

    const readModel = buildFindingsReadModel({
      findings,
      filters: { severity: "error", path: "apps/web/app/api/**/route.ts" },
      limit: 1,
      offset: 0
    });

    expect(readModel).toMatchObject({
      filters: {
        status: null,
        severity: "error",
        diff_status: null,
        convention_id: null,
        path: "apps/web/app/api/**/route.ts"
      },
      summary: {
        total_count: 2,
        filtered_count: 1,
        by_status: { new: 1, pre_existing: 1 },
        by_severity: { error: 1, warning: 1 },
        by_diff_status: { new_in_diff: 1, pre_existing: 1 }
      },
      pagination: {
        limit: 1,
        offset: 0,
        returned_count: 1,
        has_more: false,
        next_offset: null
      },
      review_items: [{
        id: "finding_a",
        convention_id: "convention_api",
        first_evidence: {
          file_path: "apps/web/app/api/users/route.ts",
          start_line: 1,
          import_source: "@drift/cli",
          symbol: "runCli"
        }
      }]
    });
    expect(readModel.findings.map((finding) => finding.id)).toEqual(["finding_a"]);
  });

  it("builds shared repo contract read models for CLI and MCP transports", () => {
    const contract = contractFixture();
    const readModel = buildRepoContractReadModel({
      repo_id: "repo_abc",
      contract,
      policy: {
        allowed: true,
        reason: "local_only_allowed",
        mode: "local_only",
        surface: "contract-export",
        redacted: false
      },
      governance: {
        read_only: true,
        agent_can_mutate: false
      }
    });

    expect(readModel).toMatchObject({
      response_schema: "drift.repo.contract.v1",
      repo_id: "repo_abc",
      summary: {
        convention_count: 0,
        agent_contract_count: 1,
        risky_area_count: 0,
        required_check_count: 0,
        safe_command_count: 0,
        waiver_count: 0,
        rejected_inference_count: 0
      },
      contract: {
        id: "contract_abc",
        agent_contracts: [expect.objectContaining({ id: "agent_contract_abc" })]
      }
    });
    expect(readModel.contract_fingerprint).toHaveLength(64);
  });

  it("selects route and service tests relevant to a changed route flow", () => {
    const result = selectRelevantTests({
      changed_files: ["app/api/users/route.ts"],
      route_flow: {
        route: "GET /api/users",
        service_file: "server/services/users.ts"
      },
      test_files: ["app/api/users/route.test.ts", "server/services/users.test.ts"]
    });

    expect(result).toMatchObject({
      closest_tests: ["app/api/users/route.test.ts", "server/services/users.test.ts"],
      missing_test_candidate: false,
      required_check_hint: "npm test -- users",
      test_intelligence_reason: null
    });
  });

  it("considers every changed file, not only the first", () => {
    // D-A3(a). Both surfaces passed `relevantFiles[0]?.path`, and relevantFiles is ranked then
    // truncated. This is midday's shape: the directly relevant test belongs to the file at
    // index 2, and the files ahead of it have no tests at all, so selection returned [].
    const result = selectRelevantTests({
      changed_files: [
        "app/(marketing)/page.tsx",
        "lib/constants.ts",
        "lib/email/onboarding-template.ts"
      ],
      test_files: ["lib/email/__tests__/onboarding-template.test.ts"]
    });

    expect(result.closest_tests).toEqual(["lib/email/__tests__/onboarding-template.test.ts"]);
    // The subject is the file the test is about, not whichever file ranked first.
    expect(result.test_intelligence[0]).toMatchObject({
      test_subject: "lib/email/onboarding-template.ts"
    });
  });

  it("matches a camelCase source against a kebab-case test", () => {
    // D-A3(b). The exact pair from the audit: the raw slugs are `formatCurrency` and
    // `format-currency`, and `.includes()` on them is false.
    const result = selectRelevantTests({
      changed_files: ["lib/utils/formatCurrency.ts"],
      test_files: ["lib/utils/__tests__/format-currency.test.ts"]
    });

    expect(result.closest_tests).toEqual(["lib/utils/__tests__/format-currency.test.ts"]);
    expect(result.missing_test_candidate).toBe(false);
  });

  it("distinguishes a repo with no tests from a change nothing covers", () => {
    // D-A3(c). These two emitted the byte-identical `"not_implemented_for_repo"`, and they call
    // for opposite responses: one means write the first test, the other means go find the test
    // that already exists. taxonomy is the first shape, midday the second.
    const noTestsAnywhere = selectRelevantTests({
      changed_files: ["app/api/users/route.ts"],
      test_files: []
    });
    const testsExistButNoneMatch = selectRelevantTests({
      changed_files: ["app/api/users/route.ts"],
      test_files: ["lib/unrelated/billing.test.ts"]
    });

    expect(noTestsAnywhere.test_intelligence_reason).toBe("no_test_files_in_repo");
    expect(testsExistButNoneMatch.test_intelligence_reason).toBe("no_tests_matched_change");
    expect(noTestsAnywhere.test_intelligence_reason).not.toBe(
      testsExistButNoneMatch.test_intelligence_reason
    );
  });

  it("reports no reason when tests were found", () => {
    const result = selectRelevantTests({
      changed_files: ["server/services/users.ts"],
      test_files: ["server/services/users.test.ts"]
    });
    expect(result.test_intelligence_reason).toBeNull();
  });

  it("does not match an unrelated test after separators are stripped", () => {
    // Restraint for (b): removing separators must not turn every name into a substring of every
    // other. A normalized match is still a substring match, not a fuzzy one.
    const result = selectRelevantTests({
      changed_files: ["server/services/users.ts"],
      test_files: ["server/services/billing-reports.test.ts"]
    });
    expect(result.closest_tests).toEqual([]);
    expect(result.test_intelligence_reason).toBe("no_tests_matched_change");
  });

  /** A repo with one matched test whose source carries the three things now read from it. */
  async function repoWithTestSource(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "drift-test-intelligence-"));
    tempDirs.push(dir);
    await mkdir(join(dir, "server/services"), { recursive: true });
    await writeFile(join(dir, "server/services/users.test.ts"), source);
    return dir;
  }

  const SELECT_USERS = {
    changed_files: ["server/services/users.ts"],
    test_files: ["server/services/users.test.ts"]
  };

  it("reads snapshot, mock and fixture evidence from the matched test's source", async () => {
    // EW-3. These three were literals - `false`, `[]`, `[]` - on every entry Drift has ever
    // emitted, and the payload-invariants gate confirms it: identical across all 176 matrix cells.
    // An agent asking "does my edit break a snapshot test" got a confident no from a field that
    // had never opened the file.
    const repoRoot = await repoWithTestSource([
      'import { describe, expect, it, vi } from "vitest";',
      'import { listUsers } from "./users";',
      'import { userRows } from "../__fixtures__/users.json";',
      'import { seed } from "./users.fixture";',
      'vi.mock("server/repositories/users");',
      "jest.mock('server/lib/clock');",
      'it("renders", () => { expect(listUsers(userRows)).toMatchSnapshot(); });'
    ].join("\n"));

    const result = selectRelevantTests({ ...SELECT_USERS, repo_root: repoRoot });

    expect(result.test_intelligence[0]).toMatchObject({
      snapshot_usage: true,
      // Both framework spellings, deduplicated and ordered so the payload is stable.
      mocked_dependencies: ["server/lib/clock", "server/repositories/users"],
      // A `__fixtures__` path segment and a `.fixture.` filename; `./users` and `vitest` are
      // imports and not fixtures, and must not be swept in.
      fixture_usage: ["../__fixtures__/users.json", "./users.fixture"]
    });
  });

  it("answers no rather than nothing when the test genuinely has none of them", async () => {
    // The other half, and the one that makes the field worth reading: a real `false` from a real
    // look has to be distinguishable from the `null` below.
    const repoRoot = await repoWithTestSource(
      'import { listUsers } from "./users";\nit("works", () => { expect(listUsers()).toEqual([]); });\n'
    );
    expect(selectRelevantTests({ ...SELECT_USERS, repo_root: repoRoot }).test_intelligence[0])
      .toMatchObject({ snapshot_usage: false, mocked_dependencies: [], fixture_usage: [] });
  });

  it("says null, not false, when it never opened the file", async () => {
    // Two ways to have nothing to read, and neither may be reported as a measurement. Without a
    // repo_root there is nowhere to look; with one, a path from a stale scan can name a file that
    // has since been deleted.
    const noRepoRoot = selectRelevantTests(SELECT_USERS);
    expect(noRepoRoot.test_intelligence[0]).toMatchObject({
      snapshot_usage: null,
      mocked_dependencies: null,
      fixture_usage: null
    });

    const emptyRepo = await mkdtemp(join(tmpdir(), "drift-test-intelligence-"));
    tempDirs.push(emptyRepo);
    expect(selectRelevantTests({ ...SELECT_USERS, repo_root: emptyRepo }).test_intelligence[0])
      .toMatchObject({ snapshot_usage: null, mocked_dependencies: null, fixture_usage: null });
  });

  it("keeps the selection's missing_test_candidate after dropping the per-entry one", async () => {
    // The drop, and the trap in it. `missing_test_candidate` names two different things one level
    // apart: the per-entry flag was false by construction - an entry exists only because a test
    // was FOUND - while the selection-level one carries the real signal and varies. A blind
    // rename would have taken both.
    const repoRoot = await repoWithTestSource('it("works", () => {});\n');
    const found = selectRelevantTests({ ...SELECT_USERS, repo_root: repoRoot });
    expect(found.missing_test_candidate).toBe(false);
    expect(found.test_intelligence[0]).not.toHaveProperty("missing_test_candidate");

    const missing = selectRelevantTests({
      changed_files: ["server/services/billing.ts"],
      test_files: ["server/services/users.test.ts"],
      repo_root: repoRoot
    });
    expect(missing.missing_test_candidate).toBe(true);
  });

  it("does not let one test file's mocks leak into the next", async () => {
    // The `g` flag makes `lastIndex` stateful, so a module-level regex shared across two files
    // starts the second scan wherever the first one stopped - and the second test silently loses
    // its first mock. Two matched tests in one selection is the case that exposes it.
    const dir = await mkdtemp(join(tmpdir(), "drift-test-intelligence-"));
    tempDirs.push(dir);
    await mkdir(join(dir, "server/services"), { recursive: true });
    await writeFile(
      join(dir, "server/services/users.test.ts"),
      'vi.mock("server/repositories/users");\nit("a", () => {});\n'
    );
    await writeFile(
      join(dir, "server/services/users-admin.test.ts"),
      'vi.mock("server/repositories/admin");\nit("b", () => {});\n'
    );

    const result = selectRelevantTests({
      changed_files: ["server/services/users.ts"],
      test_files: ["server/services/users-admin.test.ts", "server/services/users.test.ts"],
      repo_root: dir
    });

    expect(result.test_intelligence.map((entry) => entry.mocked_dependencies)).toEqual([
      ["server/repositories/admin"],
      ["server/repositories/users"]
    ]);
  });

  it("classifies a user endpoint filtering task", () => {
    expect(classifyAgentTask("add filtering to users endpoint")).toMatchObject({
      task_intent: "feature",
      target_area: "user_management",
      likely_entrypoint_kinds: ["api_route"],
      likely_files: expect.arrayContaining(API_ROUTE_SCOPE_GLOBS),
      human_approval_needed: false
    });
  });

  it("scores renamed auth helper as high similarity to canonical helper", () => {
    const result = scoreHelperSimilarity({
      candidate: {
        symbol: "getCurrentUser",
        file_path: "apps/web/lib/get-current-user.ts",
        purpose_tags: ["auth", "user"],
        parameter_shape: ["request"],
        return_shape: "user",
        call_dependencies: ["getSession"],
        import_dependencies: ["next/server"],
        body_operation_kinds: ["auth_guard"]
      },
      canonical: {
        symbol: "requireUser",
        module: "@/lib/auth/require-user",
        purpose_tags: ["auth", "user"],
        parameter_shape: ["request"],
        return_shape: "user",
        call_dependencies: ["getSession"],
        import_dependencies: ["next/server"],
        body_operation_kinds: ["auth_guard"]
      }
    });

    expect(result.score_band).toBe("high");
    expect(result.matched_features).toContain("purpose_tags");
    expect(result.matched_features).toContain("call_dependencies");
    expect(result.blocking_allowed).toBe(false);
  });

  it("builds entrypoint flow proof from entrypoint facts", () => {
    const proof = buildEntrypointFlowProof({
      contract: {
        kind: "entrypoint_flow",
        id: "agent_contract_api_flow",
        version: 1,
        entry_roles: ["api_route"],
        required_steps: [
          { kind: "auth_helper", calls: ["requireUser"] },
          { kind: "validation_helper", imports: ["@/lib/validation/account-schema"] },
          { kind: "service_delegation", imports: ["@/server/services/accounts"] }
        ],
        forbidden_steps: [{ kind: "direct_data_access" }],
        enforcement: "blocking"
      },
      entry_file_path: "apps/web/app/api/accounts/route.ts",
      facts: [
        {
          id: "fact_call_auth",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "symbol_called",
          file_path: "apps/web/app/api/accounts/route.ts",
          name: "requireUser",
          start_line: 4,
          end_line: 4
        },
        {
          id: "fact_import_schema",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "import_used",
          file_path: "apps/web/app/api/accounts/route.ts",
          name: "accountSchema",
          value: "@/lib/validation/account-schema",
          start_line: 1,
          end_line: 1
        },
        {
          id: "fact_import_service",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "import_used",
          file_path: "apps/web/app/api/accounts/route.ts",
          name: "createAccount",
          value: "@/server/services/accounts",
          start_line: 2,
          end_line: 2
        }
      ]
    });

    expect(proof.required_steps.every((step) => step.satisfied)).toBe(true);
    expect(proof.forbidden_steps[0]).toMatchObject({
      step_kind: "direct_data_access",
      present: false
    });
    expect(proof.missing_evidence).toEqual([]);
  });

  it("builds a shared repo-map read model from graph, facts, contracts, and findings", () => {
    const contract: RepoContract = {
      id: "contract_abc",
      repo_id: "repo_abc",
      contract_schema_version: 1,
      repo_fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z",
      conventions: [{
        id: "convention_api_routes",
        contract_id: "contract_abc",
        kind: "api_route_no_direct_data_access",
        statement: "API routes should delegate data access.",
        scope: { path_globs: ["app/api/**/route.ts"], file_roles: ["api_route"] },
        matcher: { kind: "api_route_no_direct_data_access", forbidden_imports: ["@/lib/db"] },
        severity: "error",
        enforcement_mode: "block",
        enforcement_capability: "deterministic_check",
        exceptions: [],
        evidence_refs: [],
        counterexample_refs: [],
        accepted_by: "geoff",
        accepted_at: "2026-05-22T00:00:00.000Z",
        updated_at: "2026-05-22T00:00:00.000Z"
      }],
      rejected_inferences: [],
      waivers: [],
      risky_areas: [{
        id: "risk_api",
        path_globs: ["app/api/**/route.ts"],
        risk_kind: "data_access",
        reason: "API route boundary"
      }],
      safe_commands: [],
      required_checks: [],
      context_egress: {
        default_mode: "local_only",
        denied_globs: [],
        max_snippet_chars: 1200,
        allow_full_file_content: false
      },
      agent_permissions: []
    };
    const finding: Finding = {
      id: "finding_abc",
      repo_id: "repo_abc",
      convention_id: "convention_api_routes",
      fingerprint: "finding-fp",
      title: "API route imports data access directly",
      message: "Route imports db directly.",
      severity: "error",
      enforcement_result: "block",
      status: "new",
      diff_status: "new_in_diff",
      evidence_refs: [{
        id: "evidence_abc",
        kind: "violation",
        file_path: "app/api/users/route.ts",
        start_line: 1,
        end_line: 1,
        scan_id: "scan_abc",
        file_hash: "a".repeat(64),
        redaction_state: "none"
      }],
      created_at: "2026-05-22T00:00:01.000Z"
    };
    const factFiles = fallbackFactRepoMapFiles([
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/services/users.ts",
        content_hash: "b".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ], [
      {
        id: "fact_role",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "file_role_detected",
        file_path: "app/api/users/route.ts",
        name: "api_route",
        start_line: 1,
        end_line: 1
      }
    ]);

    const model = buildRepoMapReadModel({
      graphFiles: [{
        path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true,
        roles: [],
        imports: ["@/lib/db"],
        exported_symbols: ["GET"],
        calls: ["GET"],
        graph_node_ids: ["file:app/api/users/route.ts"],
        evidence_ids: ["evidence_abc"],
        fact_count: 1
      }],
      factFiles,
      contract,
      findings: [finding],
      filters: { role: "api_route" },
      limit: 1,
      offset: 0
    });

    expect(model.summary).toMatchObject({
      indexed_file_count: 2,
      filtered_file_count: 1,
      listed_file_count: 1,
      import_count: 1,
      export_count: 1
    });
    expect(model.listed_files[0]).toMatchObject({
      path: "app/api/users/route.ts",
      roles: ["api_route"],
      imports: ["@/lib/db"],
      convention_ids: ["convention_api_routes"],
      risky_area_ids: ["risk_api"],
      open_finding_ids: ["finding_abc"],
      graph_node_ids: ["file:app/api/users/route.ts"],
      evidence_ids: ["evidence_abc"]
    });
    expect(model.impact_summary).toEqual({
      convention_coverage_count: 1,
      risky_file_count: 1,
      open_finding_count: 1
    });
  });

  it("builds an area-oriented repo topology", () => {
    const topology = buildRepoTopology({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      files: [
        {
          path: "app/api/users/route.ts",
          roles: ["api_route"],
          imports: ["@/server/services/users"],
          exported_symbols: ["GET"],
          risky_area_ids: ["risk_users"]
        },
        {
          path: "server/services/users.ts",
          roles: ["service"],
          imports: ["@/server/repositories/users"],
          exported_symbols: ["listUsers"],
          risky_area_ids: []
        },
        {
          path: "server/repositories/users.ts",
          roles: ["data_access"],
          imports: ["@prisma/client"],
          exported_symbols: ["findUsers"],
          risky_area_ids: []
        },
        {
          path: "server/services/users.test.ts",
          roles: ["test_unit"],
          imports: ["vitest"],
          exported_symbols: [],
          risky_area_ids: []
        }
      ]
    });

    expect(topology).toMatchObject({
      schema_version: "drift.repo_topology.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      areas: expect.arrayContaining([
        expect.objectContaining({
          name: "Users Management",
          entrypoints: ["GET /api/users"],
          services: ["server/services/users.ts"],
          data_access: ["server/repositories/users.ts"],
          tests: ["server/services/users.test.ts"]
        })
      ]),
      external_systems: expect.arrayContaining(["@prisma/client", "vitest"]),
      risky_zones: ["risk_users"]
    });
  });

  it("groups monorepo package and crate paths into package-aware topology areas", () => {
    const topology = buildRepoTopology({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      files: [
        {
          path: "packages/cli/src/commands/check.ts",
          roles: ["cli_command_module"],
          imports: ["@drift/core"],
          exported_symbols: ["runCheck"],
          risky_area_ids: []
        },
        {
          path: "packages/core/src/domain.ts",
          roles: ["core_module"],
          imports: [],
          exported_symbols: ["RepoContract"],
          risky_area_ids: []
        },
        {
          path: "crates/drift-engine/src/main.rs",
          roles: ["engine_bridge_module"],
          imports: [],
          exported_symbols: [],
          risky_area_ids: []
        },
        {
          path: "test/fixtures/next-api-direct-db/app/api/users/route.ts",
          roles: ["api_route"],
          imports: ["@/lib/db"],
          exported_symbols: ["GET"],
          risky_area_ids: []
        }
      ]
    });

    expect(topology.areas.map((area) => area.name)).toEqual(expect.arrayContaining([
      "Cli Package",
      "Core Package",
      "Drift Engine Crate",
      "Next Api Direct Db Fixture"
    ]));
    expect(topology.areas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Cli Package",
        modules: ["packages/cli/src/commands/check.ts"]
      }),
      expect.objectContaining({
        name: "Drift Engine Crate",
        modules: ["crates/drift-engine/src/main.rs"]
      })
    ]));
  });

  it("maps repo files from persisted FactGraph projections without reading raw facts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_abc",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 2,
      fact_count: 4,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        file_path: "app/lib/db.ts",
        content_hash: "b".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifact({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      facts: [
        {
          id: "fact_role",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "file_role_detected",
          file_path: "app/api/users/route.ts",
          name: "api_route",
          start_line: 1,
          end_line: 4
        },
        {
          id: "fact_import",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "import_used",
          file_path: "app/api/users/route.ts",
          name: "db",
          value: "../../lib/db",
          start_line: 1,
          end_line: 1
        },
        {
          id: "fact_export",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "exported_symbol",
          file_path: "app/api/users/route.ts",
          name: "GET",
          start_line: 3,
          end_line: 3
        },
        {
          id: "fact_call",
          repo_id: "repo_abc",
          scan_id: "scan_abc",
          kind: "symbol_called",
          file_path: "app/api/users/route.ts",
          name: "findMany",
          start_line: 4,
          end_line: 4
        }
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const service = createGraphQueryService(storage);
    const map = service.repoMap({ repoId: "repo_abc", scanId: "scan_abc" });

    // T113: pin the whole projection, not just the fields this test happens to assert.
    //
    // T112 memoised the graph per scan, which changes *how* the projection is fed without
    // intending to change what it produces. A shape pin is what makes that claim checkable, and it
    // is cheap: any difference in the projected map fails here rather than surfacing as a subtly
    // different repo map in someone's agent context.
    expect(map).toMatchSnapshot("repoMap projection");

    // T112: the memo must return an identical projection on a second call, and not a shared
    // mutable object that a caller could have altered.
    const second = service.repoMap({ repoId: "repo_abc", scanId: "scan_abc" });
    expect(second).toEqual(map);

    storage.close();

    expect(map.graph_summary).toMatchObject({
      graph_backed: true,
      evidence_count: 4
    });
    expect(map.files[0]).toMatchObject({
      path: "app/api/users/route.ts",
      roles: ["api_route"],
      imports: ["../../lib/db"],
      exported_symbols: ["GET"],
      calls: ["findMany"],
      fact_count: 4
    });
    expect(map.files[0]?.graph_node_ids).toContain("file:app/api/users/route.ts");
    expect(map.files[0]?.evidence_ids).toContain("evidence:typescript:app/api/users/route.ts:aaaaaaaaaaaa:1-1");
  });

  it("returns route-to-service-to-data-access flow from graph projections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_flow",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 3,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        file_path: "src/services/users.ts",
        content_hash: "b".repeat(64),
        byte_size: 100,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        file_path: "src/lib/db.ts",
        content_hash: "c".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_flow",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        graphNode("file:app/api/users/route.ts", "file", "app/api/users/route.ts", { path: "app/api/users/route.ts" }),
        graphNode("file:src/services/users.ts", "file", "src/services/users.ts", { path: "src/services/users.ts" }),
        graphNode("file:src/lib/db.ts", "file", "src/lib/db.ts", { path: "src/lib/db.ts" }),
        graphNode("module:app/api/users/route.ts", "module", "app/api/users/route.ts", { file_path: "app/api/users/route.ts" }),
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" }),
        graphNode("file_role:api_route", "file_role", "api_route", { role: "api_route" }),
        graphNode("file_role:service_module", "file_role", "service_module", { role: "service_module" }),
        graphNode("file_role:data_access_module", "file_role", "data_access_module", { role: "data_access_module" }),
        graphNode("route:POST:app/api/users/route.ts", "route", "POST", {
          file_path: "app/api/users/route.ts",
          method: "POST",
          route_pattern: "/api/users",
          framework_role: "next_app_route",
          dynamic_params: []
        }),
        graphNode("symbol:app/api/users/route.ts:function:POST", "symbol", "POST", {
          file_path: "app/api/users/route.ts",
          symbol_kind: "function",
          exported: true
        }),
        graphNode("data_store:db:user", "data_store", "user", {
          receiver_root: "db",
          store_name: "user",
          file_path: "src/services/users.ts"
        }),
        {
          ...graphNode("data_operation:src/services/users.ts:bbbbbbbbbbbb:db.user:create:3-3", "data_operation", "create", {
            file_path: "src/services/users.ts",
            receiver_name: "db.user",
            receiver_root: "db",
            store_name: "user",
            operation_name: "create",
            operation_kind: "write"
          }),
          evidence_ids: ["evidence_data_operation"]
        }
      ],
      edges: [
        graphEdge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
        graphEdge("FILE_HAS_ROLE", "file:src/services/users.ts", "file_role:service_module"),
        graphEdge("FILE_HAS_ROLE", "file:src/lib/db.ts", "file_role:data_access_module"),
        graphEdge("MODULE_IMPORTS_MODULE", "module:app/api/users/route.ts", "module:src/services/users.ts"),
        graphEdge("MODULE_IMPORTS_MODULE", "module:src/services/users.ts", "module:src/lib/db.ts"),
        graphEdge("ROUTE_HANDLED_BY_SYMBOL", "route:POST:app/api/users/route.ts", "symbol:app/api/users/route.ts:function:POST"),
        graphEdge("DATA_OPERATION_WRITES_DATA_STORE", "data_operation:src/services/users.ts:bbbbbbbbbbbb:db.user:create:3-3", "data_store:db:user")
      ],
      evidence: [
        graphEvidence("evidence_data_operation", "fact_data_operation", "scan_flow", "src/services/users.ts", 3)
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const flow = createGraphQueryService(storage).getRouteFlow({
      repo_id: "repo_abc",
      scan_id: "scan_flow",
      path: "app/api/users/route.ts",
      method: "POST",
      policy_surface: "mcp"
    });
    const reachable = createGraphQueryService(storage).getReachableDataAccess({
      repo_id: "repo_abc",
      scan_id: "scan_flow",
      path: "app/api/users/route.ts",
      method: "POST",
      policy_surface: "mcp"
    });
    const endpointFlow = createGraphQueryService(storage).getRouteFlow({
      repo_id: "repo_abc",
      scan_id: "scan_flow",
      path: "/api/users",
      method: "POST",
      policy_surface: "mcp"
    });
    storage.close();

    expect(flow.complete).toBe(true);
    expect(flow.policy).toMatchObject({ surface: "mcp", local_only: true });
    expect(flow).toMatchObject({
      route_pattern: "/api/users",
      framework_role: "next_app_route",
      dynamic_params: []
    });
    expect(endpointFlow.route_module_id).toBe("module:app/api/users/route.ts");
    expect(flow.route_module_id).toBe("module:app/api/users/route.ts");
    expect(flow.route_handler_symbol_ids).toEqual(["symbol:app/api/users/route.ts:function:POST"]);
    expect(flow.service_module_ids).toEqual(["module:src/services/users.ts"]);
    expect(flow.data_access_module_ids).toEqual(["module:src/lib/db.ts"]);
    expect(flow.risk_reasons).toEqual([{
      risk_kind: "data_write",
      operation_kind: "write",
      operation_name: "create",
      store_name: "user",
      file_path: "src/services/users.ts",
      start_line: 3
    }]);
    expect(flow.module_path).toEqual([
      "module:app/api/users/route.ts",
      "module:src/services/users.ts",
      "module:src/lib/db.ts"
    ]);
    expect(reachable.data_operations).toEqual([{
      operation_node_id: "data_operation:src/services/users.ts:bbbbbbbbbbbb:db.user:create:3-3",
      data_store_node_id: "data_store:db:user",
      file_path: "src/services/users.ts",
      start_line: 3,
      operation_kind: "write",
      operation_name: "create",
      store_name: "user",
      receiver_name: "db.user"
    }]);
    expect(reachable.risk_reasons).toEqual(flow.risk_reasons);
  });

  it("resolves finding evidence through graph links and explicit fact selectors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_evidence",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 1,
      fact_count: 0,
      finding_count: 1,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [{
      repo_id: "repo_abc",
      scan_id: "scan_evidence",
      file_path: "app/api/users/route.ts",
      content_hash: "a".repeat(64),
      byte_size: 120,
      indexed: true
    }];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_evidence",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        graphNode("finding:finding_abc", "finding", "API route imports data access directly", {}),
        {
          ...graphNode("import_decl:app/api/users/route.ts:db", "import_decl", "db", {
            file_path: "app/api/users/route.ts",
            source: "@/lib/db"
          }),
          evidence_ids: ["evidence_route"]
        },
        {
          ...graphNode("callsite:app/api/users/route.ts:findMany", "callsite", "findMany", {
            file_path: "app/api/users/route.ts"
          }),
          evidence_ids: ["evidence_fact"]
        }
      ],
      edges: [
        graphEdge("FINDING_HAS_EVIDENCE", "finding:finding_abc", "evidence_route")
      ],
      evidence: [
        graphEvidence("evidence_route", "fact_import", "scan_evidence", "app/api/users/route.ts", 1),
        graphEvidence("evidence_fact", "fact_call", "scan_evidence", "app/api/users/route.ts", 3)
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const result = createGraphQueryService(storage).getFindingEvidence({
      repo_id: "repo_abc",
      scan_id: "scan_evidence",
      finding_id: "finding_abc",
      fact_ids: ["fact_call"],
      policy_surface: "mcp"
    });
    storage.close();

    expect(result.diagnostics).toEqual([]);
    expect(result.policy).toMatchObject({ surface: "mcp", local_only: true });
    expect(result.evidence.map((evidence) => evidence.id).sort()).toEqual(["evidence_fact", "evidence_route"]);
    expect(result.related_nodes.map((node) => node.id).sort()).toEqual([
      "callsite:app/api/users/route.ts:findMany",
      "import_decl:app/api/users/route.ts:db"
    ]);
  });

  it("returns affected files from module dependents and resolver dependencies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_affected",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 3,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        file_path: "src/services/users.ts",
        content_hash: "b".repeat(64),
        byte_size: 100,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        file_path: "src/lib/db.ts",
        content_hash: "c".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_affected",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        graphNode("file:app/api/users/route.ts", "file", "app/api/users/route.ts", { path: "app/api/users/route.ts" }),
        graphNode("file:src/services/users.ts", "file", "src/services/users.ts", { path: "src/services/users.ts" }),
        graphNode("file:src/lib/db.ts", "file", "src/lib/db.ts", { path: "src/lib/db.ts" }),
        graphNode("module:app/api/users/route.ts", "module", "app/api/users/route.ts", { file_path: "app/api/users/route.ts" }),
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" }),
        graphNode("import_decl:src/services/users.ts:db", "import_decl", "db from ../lib/db", {
          file_path: "src/services/users.ts",
          source: "../lib/db",
          resolved_file_path: "src/lib/db.ts"
        })
      ],
      edges: [
        graphEdge("MODULE_IMPORTS_MODULE", "module:app/api/users/route.ts", "module:src/services/users.ts"),
        graphEdge("MODULE_IMPORTS_MODULE", "module:src/services/users.ts", "module:src/lib/db.ts"),
        graphEdge("IMPORT_RESOLVES_TO_MODULE", "import_decl:src/services/users.ts:db", "module:src/lib/db.ts")
      ],
      evidence: [],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const affected = createGraphQueryService(storage).getAffectedFiles({
      repo_id: "repo_abc",
      scan_id: "scan_affected",
      path: "src/lib/db.ts",
      policy_surface: "cli-preflight"
    });
    const routeAffected = createGraphQueryService(storage).getAffectedFiles({
      repo_id: "repo_abc",
      scan_id: "scan_affected",
      path: "app/api/users/route.ts",
      policy_surface: "cli-preflight"
    });
    storage.close();

    expect(affected.policy).toMatchObject({ surface: "cli-preflight", local_only: true });
    expect(affected.files).toEqual([
      "app/api/users/route.ts",
      "src/lib/db.ts",
      "src/services/users.ts"
    ]);
    expect(routeAffected.files).toEqual(["app/api/users/route.ts"]);
  });

  it("reports graph completeness from resolver dependency projections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    for (const scanId of ["scan_missing", "scan_complete", "scan_incomplete", "scan_diagnostic"]) {
      storage.upsertScanManifest({
        id: scanId,
        repo_id: "repo_abc",
        branch: "main",
        commit: "abc123",
        dirty: false,
        scanner_version: "0.1.0",
        adapter_versions: { typescript: "0.1.0" },
        rule_engine_version: "0.1.0",
        status: "completed",
        file_count: 1,
        fact_count: 0,
        finding_count: 0,
        started_at: "2026-05-22T00:00:00.000Z",
        completed_at: "2026-05-22T00:00:01.000Z"
      });
    }
    const snapshots = [{
      repo_id: "repo_abc",
      scan_id: "scan_complete",
      file_path: "src/services/users.ts",
      content_hash: "a".repeat(64),
      byte_size: 120,
      indexed: true
    }];
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_complete",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      // Declared explicitly: the fallback defaults to incomplete (T11b), so a graph that
      // means "full coverage" must say so rather than inherit an optimistic default.
      completeness: [{
        scope: "repo",
        complete: true,
        required_capabilities: ["file_discovery", "syntax_facts", "graph_stream"],
        missing_capabilities: [],
        truncated: false,
        can_block: true,
        reasons: []
      }],
      snapshots,
      nodes: [
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" }),
        graphNode("import_decl:src/services/users.ts:db", "import_decl", "db from ../lib/db", {
          file_path: "src/services/users.ts",
          resolved_file_path: "src/lib/db.ts"
        })
      ],
      edges: [
        graphEdge("IMPORT_RESOLVES_TO_MODULE", "import_decl:src/services/users.ts:db", "module:src/lib/db.ts")
      ],
      evidence: [],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_incomplete",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [{ ...snapshots[0], scan_id: "scan_incomplete" }],
      nodes: [
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" }),
        graphNode("module:src/lib/db.ts", "module", "src/lib/db.ts", { file_path: "src/lib/db.ts" })
      ],
      edges: [
        graphEdge("IMPORT_RESOLVES_TO_MODULE", "import_decl:src/services/users.ts:db", "module:src/lib/db.ts")
      ],
      evidence: [],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_diagnostic",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [{ ...snapshots[0], scan_id: "scan_diagnostic" }],
      nodes: [
        graphNode("module:src/services/users.ts", "module", "src/services/users.ts", { file_path: "src/services/users.ts" })
      ],
      edges: [],
      evidence: [],
      diagnostics: [{
        id: "diag_unresolved_import",
        severity: "warning",
        code: "unresolved_import",
        message: "Could not resolve import ../lib/db from src/services/users.ts.",
        file_path: "src/services/users.ts",
        evidence_ids: []
      }],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const service = createGraphQueryService(storage);
    const missing = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_missing" });
    const complete = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_complete" });
    const incomplete = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_incomplete" });
    const diagnostic = service.getCompleteness({ repo_id: "repo_abc", scan_id: "scan_diagnostic" });
    storage.close();

    expect(missing.complete).toBe(false);
    expect(missing.reasons).toContain("graph_empty");
    expect(complete.complete).toBe(true);
    expect(complete.reasons).toEqual([]);
    expect(incomplete.complete).toBe(false);
    expect(incomplete.reasons).toContain("resolver_dependencies_missing");
    expect(diagnostic.complete).toBe(false);
    expect(diagnostic.reasons).toContain("import_resolution_incomplete");
  });

  it("builds advisory readiness when parser gaps lower flow confidence", () => {
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "prepare",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [{
        schema_version: "drift.parser_gap.v1",
        gap_id: "parser_gap_missing_service",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "unresolved_import",
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 1,
        end_line: 1,
        confidence_impact: "lowers_flow",
        message: "Could not resolve import @/services/users.",
        evidence_refs: ["diagnostic_unresolved_import"],
        created_at: "2026-05-25T00:00:00.000Z"
      }],
      completeness_reasons: [],
      required_capabilities: ["route_flow_graph"],
      missing_capabilities: []
    });

    expect(readiness).toMatchObject({
      schema_version: "drift.readiness.v1",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "prepare",
      graph_available: true,
      graph_complete: true,
      parser_gap_count: 1,
      parser_gaps_by_kind: { unresolved_import: 1 },
      confidence: 0.82,
      decision: "advisory_only",
      reasons: ["parser_gaps_present"],
      required_capabilities: ["route_flow_graph"],
      missing_capabilities: []
    });
  });

  it("refuses readiness when parser gap v2 blocks enforcement", () => {
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "check",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [{
        schema_version: "drift.parser_gap.v2",
        parser_gap_id: "parser_gap_dynamic_route",
        repo_id: "repo_abc",
        scan_id: "scan_abc",
        kind: "dynamic_import_unresolved",
        file_path: "apps/web/app/api/users/route.ts",
        start_line: 4,
        end_line: 4,
        confidence_impact: "blocks_enforcement",
        message: "Dynamic import target is not statically resolvable.",
        affected_capabilities: ["ts.dynamic_imports.v1", "ts.route_flow.v1"],
        affected_contract_kinds: ["api_route_no_direct_data_access"],
        suggested_action: "rewrite_static",
        evidence_refs: ["diagnostic_dynamic_import"]
      }],
      completeness_reasons: [],
      required_capabilities: ["route_flow_graph"],
      missing_capabilities: []
    });

    expect(readiness).toMatchObject({
      parser_gap_count: 1,
      parser_gaps_by_kind: { dynamic_import_unresolved: 1 },
      confidence: 0.4,
      decision: "refuse",
      reasons: ["parser_gap_blocks_enforcement", "parser_gaps_present"]
    });
  });

  it("builds stored-scan readiness for missing scans and missing graphs", () => {
    const missingScan = buildStoredScanReadiness({
      repo_id: "repo_abc",
      scan_id: null,
      surface: "scan_status",
      graph_available: false,
      parser_gaps: []
    });
    const missingGraph = buildStoredScanReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "repo_map",
      graph_available: false,
      parser_gaps: []
    });

    expect(missingScan).toMatchObject({
      decision: "refuse",
      required_capabilities: ["fact_graph", "scan_manifest"],
      missing_capabilities: ["fact_graph", "scan_manifest"]
    });
    expect(missingScan.reasons).toEqual(expect.arrayContaining([
      "scan_missing",
      "graph_missing",
      "missing_capability:fact_graph",
      "missing_capability:scan_manifest"
    ]));
    expect(missingGraph).toMatchObject({
      decision: "refuse",
      required_capabilities: ["fact_graph"],
      missing_capabilities: ["fact_graph"]
    });
    expect(missingGraph.reasons).toEqual(expect.arrayContaining([
      "graph_missing",
      "missing_capability:fact_graph"
    ]));
  });

  it("summarizes parser gaps with v2 capability and contract impact", () => {
    const summary = buildParserGapSummary([{
      schema_version: "drift.parser_gap.v2",
      parser_gap_id: "parser_gap_dynamic_route",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "dynamic_import_unresolved",
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 4,
      end_line: 4,
      confidence_impact: "blocks_enforcement",
      message: "Dynamic import target is not statically resolvable.",
      affected_capabilities: ["ts.dynamic_imports.v1", "ts.route_flow.v1"],
      affected_contract_kinds: ["api_route_no_direct_data_access"],
      suggested_action: "rewrite_static",
      evidence_refs: ["diagnostic_dynamic_import"]
    }]);

    expect(summary).toEqual({
      total_count: 1,
      by_kind: { dynamic_import_unresolved: 1 },
      confidence_impact: { blocks_enforcement: 1 },
      by_capability: {
        "ts.dynamic_imports.v1": 1,
        "ts.route_flow.v1": 1
      },
      by_contract_kind: { api_route_no_direct_data_access: 1 }
    });
  });

  it("builds semantic coverage from readiness and parser gap v2 capability impact", () => {
    const parserGap = {
      schema_version: "drift.parser_gap.v2" as const,
      parser_gap_id: "parser_gap_dynamic_route",
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      kind: "dynamic_import_unresolved" as const,
      file_path: "apps/web/app/api/users/route.ts",
      start_line: 4,
      end_line: 4,
      confidence_impact: "blocks_enforcement" as const,
      message: "Dynamic import target is not statically resolvable.",
      affected_capabilities: ["dynamic_imports"],
      affected_contract_kinds: ["api_route_no_direct_data_access" as const],
      suggested_action: "rewrite_static" as const,
      evidence_refs: ["diagnostic_dynamic_import"]
    };
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "prepare",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [parserGap],
      completeness_reasons: [],
      required_capabilities: ["route_flow", "dynamic_imports"],
      missing_capabilities: []
    });

    const coverage = buildSemanticCoverage({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      scope: "preflight",
      scope_id: "task_users_route",
      required_capabilities: ["route_flow", "dynamic_imports"],
      certified_capabilities: ["route_flow"],
      missing_capabilities: [],
      readiness,
      parser_gaps: [parserGap],
      generated_at: "2026-05-28T00:00:00.000Z"
    });

    expect(coverage).toMatchObject({
      schema_version: "drift.semantic_coverage.v1",
      scope: "preflight",
      complete_capabilities: ["route_flow"],
      partial_capabilities: ["dynamic_imports"],
      parser_gap_ids: ["parser_gap_dynamic_route"],
      confidence: 0.4,
      decision: "refuse",
      reasons: ["parser_gap_blocks_enforcement", "parser_gaps_present"]
    });
  });

  /**
   * D-S1, the flagship. This is the case that never worked.
   *
   * The capability report here is not a fixture shape - it is what `scanCapabilityReportForScan`
   * stores after a real scan: `certified` is the engine's `certified_capabilities()` verbatim and
   * `required` is `capability_stats(&["file_discovery", "syntax_facts", "graph_stream"])`. Readiness
   * is synthetically perfect: blocking_allowed, confidence 1.0, no parser gaps, nothing missing.
   *
   * Against the unfixed code this produced `decision: "refuse"`, and it did so on every repo. The
   * mapping table translated `graph_stream` to nothing, so it became an unknown capability; the
   * preflight requirement `ts.route_flow.v1` belonged to a namespace no engine string is in, so it
   * was never certified; and either alone forces the refusal.
   */
  it("allows blocking preflight coverage on a real engine capability report", () => {
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "prepare",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [],
      completeness_reasons: [],
      required_capabilities: ["route_flow"],
      missing_capabilities: []
    });
    expect(readiness.decision).toBe("blocking_allowed");

    const coverage = buildSemanticCoverageFromCapabilityReport({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      scope: "preflight",
      scope_id: "task_users_route",
      capability_report: {
        certified_capabilities: [...ENGINE_CERTIFIED_SCAN_CAPABILITIES],
        required_capabilities: ["file_discovery", "syntax_facts", "graph_stream"],
        missing_capabilities: []
      },
      readiness,
      parser_gaps: [],
      generated_at: "2026-05-28T00:00:00.000Z"
    });

    expect(coverage).toMatchObject({
      required_capabilities: ["file_discovery", "graph_stream", "route_flow", "syntax_facts"],
      complete_capabilities: ["file_discovery", "graph_stream", "route_flow", "syntax_facts"],
      missing_capabilities: [],
      unsupported_capabilities: [],
      decision: "blocking_allowed",
      reasons: []
    });
  });

  it("builds semantic coverage from a scan capability report and fails closed on unknown requirements", () => {
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "prepare",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [],
      completeness_reasons: [],
      required_capabilities: ["route_flow"],
      missing_capabilities: []
    });

    const coverage = buildSemanticCoverageFromCapabilityReport({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      scope: "preflight",
      scope_id: "task_users_route",
      capability_report: {
        certified_capabilities: ["syntax_facts", "file_discovery", "route_flow"],
        // `fact_graph` was one of the four names the old translation table invented. It is not a
        // capability any producer emits, so it belongs in the same bucket as any other typo.
        required_capabilities: ["syntax_facts", "file_discovery", "fact_graph"],
        missing_capabilities: []
      },
      readiness,
      parser_gaps: [],
      generated_at: "2026-05-28T00:00:00.000Z"
    });

    expect(coverage).toMatchObject({
      required_capabilities: ["fact_graph", "file_discovery", "route_flow", "syntax_facts"],
      complete_capabilities: ["file_discovery", "route_flow", "syntax_facts"],
      missing_capabilities: ["fact_graph"],
      unsupported_capabilities: ["fact_graph"],
      decision: "refuse"
    });
    expect(coverage.reasons).toEqual(expect.arrayContaining([
      "missing_capability:fact_graph",
      "unsupported_capability:fact_graph"
    ]));
  });

  it("fails closed when required scan capabilities are not certified", () => {
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "prepare",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [],
      completeness_reasons: [],
      required_capabilities: ["route_flow"],
      missing_capabilities: []
    });

    const coverage = buildSemanticCoverageFromCapabilityReport({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      scope: "preflight",
      scope_id: "task_users_route",
      capability_report: {
        certified_capabilities: ["route_flow"],
        required_capabilities: ["route_flow", "import_resolution"],
        missing_capabilities: []
      },
      readiness,
      parser_gaps: [],
      generated_at: "2026-05-28T00:00:00.000Z"
    });

    expect(coverage).toMatchObject({
      required_capabilities: ["import_resolution", "route_flow"],
      complete_capabilities: ["route_flow"],
      missing_capabilities: ["import_resolution"],
      decision: "refuse"
    });
    expect(coverage.reasons).toContain("missing_capability:import_resolution");
  });

  it("allows blocking readiness when graph and parser evidence are complete", () => {
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: "scan_abc",
      surface: "check",
      graph_available: true,
      graph_complete: true,
      parser_gaps: [],
      completeness_reasons: [],
      required_capabilities: ["direct_data_access_check"],
      missing_capabilities: []
    });

    expect(readiness).toMatchObject({
      confidence: 1,
      decision: "blocking_allowed",
      reasons: [],
      parser_gap_count: 0,
      parser_gaps_by_kind: {}
    });
  });

  it("refuses blocking readiness when graph evidence is missing", () => {
    const readiness = buildReadiness({
      repo_id: "repo_abc",
      scan_id: null,
      surface: "check",
      graph_available: false,
      graph_complete: false,
      parser_gaps: [],
      completeness_reasons: ["graph_missing"],
      required_capabilities: ["direct_data_access_check"],
      missing_capabilities: ["graph"]
    });

    expect(readiness).toMatchObject({
      confidence: 0,
      decision: "refuse",
      reasons: [
        "graph_incomplete",
        "graph_missing",
        "graph_unavailable",
        "missing_capability:graph"
      ],
      missing_capabilities: ["graph"]
    });
  });

  it("groups graph diagnostics into bounded deterministic summaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_diagnostics",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 3,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_diagnostics",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots: [],
      nodes: [graphNode("module:src/a.ts", "module", "src/a.ts", { file_path: "src/a.ts" })],
      edges: [],
      evidence: [],
      diagnostics: [
        {
          id: "diag_unresolved_a",
          severity: "warning",
          code: "unresolved_import",
          message: "Could not resolve import @/db from src/a.ts.",
          file_path: "src/a.ts",
          evidence_ids: []
        },
        {
          id: "diag_unresolved_b",
          severity: "warning",
          code: "unresolved_import",
          message: "Could not resolve import @/db from src/b.ts.",
          file_path: "src/b.ts",
          evidence_ids: []
        },
        {
          id: "diag_namespace",
          severity: "info",
          code: "unsupported_namespace_import_symbol",
          message: "Namespace import membership is not statically resolved.",
          file_path: "src/c.ts",
          evidence_ids: []
        }
      ],
      completeness: [{
        scope: "repo",
        complete: false,
        required_capabilities: ["import_resolution"],
        missing_capabilities: [],
        truncated: false,
        can_block: false,
        reasons: ["import_resolution_incomplete"]
      }],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const summary = createGraphQueryService(storage).getDiagnosticSummary({
      repo_id: "repo_abc",
      scan_id: "scan_diagnostics",
      limit: 1,
      policy_surface: "cli-preflight"
    });
    storage.close();

    expect(summary.total_count).toBe(3);
    expect(summary.completeness_reasons).toEqual(["import_resolution_incomplete"]);
    expect(summary.groups).toEqual([
      {
        code: "unresolved_import",
        severity: "warning",
        count: 2,
        file_count: 2,
        sample_files: ["src/a.ts"],
        sample_messages: ["Could not resolve import @/db from src/a.ts."]
      },
      {
        code: "unsupported_namespace_import_symbol",
        severity: "info",
        count: 1,
        file_count: 1,
        sample_files: ["src/c.ts"],
        sample_messages: ["Namespace import membership is not statically resolved."]
      }
    ]);
  });

  it("returns semantic symbol neighborhoods from import and callsite graph links", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drift-query-"));
    tempDirs.push(dir);
    const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
    storage.migrate();
    storage.upsertRepo({
      id: "repo_abc",
      root_path: "/repo",
      fingerprint: "repo-fp",
      created_at: "2026-05-22T00:00:00.000Z",
      updated_at: "2026-05-22T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: "scan_symbols",
      repo_id: "repo_abc",
      branch: "main",
      commit: "abc123",
      dirty: false,
      scanner_version: "0.1.0",
      adapter_versions: { typescript: "0.1.0" },
      rule_engine_version: "0.1.0",
      status: "completed",
      file_count: 2,
      fact_count: 0,
      finding_count: 0,
      started_at: "2026-05-22T00:00:00.000Z",
      completed_at: "2026-05-22T00:00:01.000Z"
    });
    const snapshots = [
      {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        file_path: "app/api/users/route.ts",
        content_hash: "a".repeat(64),
        byte_size: 120,
        indexed: true
      },
      {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        file_path: "src/services/users.ts",
        content_hash: "b".repeat(64),
        byte_size: 80,
        indexed: true
      }
    ];
    for (const snapshot of snapshots) {
      storage.upsertFileSnapshot(snapshot);
    }
    storage.upsertFactGraphArtifact(buildFactGraphArtifactFromParts({
      repo: {
        repo_id: "repo_abc",
        scan_id: "scan_symbols",
        root_hash: "root_hash",
        branch: "main",
        commit: "abc123",
        dirty: false
      },
      snapshots,
      nodes: [
        {
          ...graphNode("symbol:src/services/users.ts:function:getUsers", "symbol", "getUsers", {
            file_path: "src/services/users.ts",
            symbol_kind: "function",
            exported: true
          }),
          evidence_ids: ["evidence_decl"]
        },
        {
          ...graphNode("import_decl:app/api/users/route.ts:loadUsers", "import_decl", "loadUsers from @/services/users", {
            file_path: "app/api/users/route.ts",
            source: "@/services/users",
            imported_name: "getUsers",
            local_name: "loadUsers"
          }),
          evidence_ids: ["evidence_ref"]
        },
        graphNode("callsite:app/api/users/route.ts:loadUsers", "callsite", "loadUsers", {
          file_path: "app/api/users/route.ts",
          callee_name: "loadUsers"
        })
      ],
      edges: [
        {
          ...graphEdge("IMPORT_RESOLVES_TO_SYMBOL", "import_decl:app/api/users/route.ts:loadUsers", "symbol:src/services/users.ts:function:getUsers"),
          evidence_ids: ["evidence_ref"]
        },
        graphEdge("CALLSITE_REFERENCES_SYMBOL", "callsite:app/api/users/route.ts:loadUsers", "import_decl:app/api/users/route.ts:loadUsers")
      ],
      evidence: [
        graphEvidence("evidence_decl", "fact_decl", "scan_symbols", "src/services/users.ts", 2),
        graphEvidence("evidence_ref", "fact_import", "scan_symbols", "app/api/users/route.ts", 1)
      ],
      createdAt: "2026-05-22T00:00:00.000Z"
    }));

    const neighborhood = createGraphQueryService(storage).getSymbolNeighborhood({
      repo_id: "repo_abc",
      scan_id: "scan_symbols",
      symbol_id: "symbol:src/services/users.ts:function:getUsers",
      depth: 2,
      policy_surface: "cli-preflight"
    });
    const missing = createGraphQueryService(storage).getSymbolNeighborhood({
      repo_id: "repo_abc",
      scan_id: "scan_symbols",
      symbol_id: "symbol:missing",
      policy_surface: "cli-preflight"
    });
    storage.close();

    expect(neighborhood.diagnostics).toEqual([]);
    expect(neighborhood.policy).toMatchObject({ surface: "cli-preflight", local_only: true });
    expect(neighborhood.nodes.map((node) => node.id)).toEqual([
      "callsite:app/api/users/route.ts:loadUsers",
      "import_decl:app/api/users/route.ts:loadUsers",
      "symbol:src/services/users.ts:function:getUsers"
    ]);
    expect(neighborhood.edges.map((edge) => edge.kind)).toEqual([
      "CALLSITE_REFERENCES_SYMBOL",
      "IMPORT_RESOLVES_TO_SYMBOL"
    ]);
    expect(neighborhood.occurrence_count).toBe(2);
    expect(neighborhood.occurrence_files).toEqual([
      "app/api/users/route.ts",
      "src/services/users.ts"
    ]);
    expect(missing.diagnostics).toContain("symbol_not_found");
    expect(missing.nodes).toEqual([]);
    expect(missing.edges).toEqual([]);
    expect(missing.occurrence_count).toBe(0);
  });
});

function graphNode(
  id: string,
  kind: string,
  label: string,
  metadata: Record<string, unknown>
) {
  return {
    id,
    kind,
    label,
    stable: true,
    evidence_ids: [],
    metadata
  };
}

function graphEdge(kind: string, from: string, to: string) {
  return {
    id: `edge:${from}:${kind}:${to}`,
    kind,
    from,
    to,
    evidence_ids: [],
    metadata: {}
  };
}

function graphEvidence(
  id: string,
  factId: string,
  scanId: string,
  filePath: string,
  line: number
) {
  return {
    id,
    repo_id: "repo_abc",
    scan_id: scanId,
    artifact_id: `file_version:${filePath}:aaaaaaaaaaaa`,
    file_path: filePath,
    file_hash: "a".repeat(64),
    start_line: line,
    end_line: line,
    adapter_id: "typescript",
    adapter_version: "0.1.0",
    fact_ids: [factId],
    redaction_state: "none"
  };
}
