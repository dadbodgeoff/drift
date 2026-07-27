import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AdapterCapabilitySchema,
  AdapterManifestSchema,
  TYPESCRIPT_ADAPTER_MANIFEST,
  assertCertifiedCapability,
  certifiedCapabilitiesForAdapter,
  expressAdapter,
  missingRequiredCapabilities,
  nextAppRouterAdapter,
  validateAdapterOutputBatch
} from "../src/index.js";

describe("adapter capability registry", () => {
  it("describes Next.js app router entrypoints and boundaries", () => {
    expect(nextAppRouterAdapter()).toMatchObject({
      schema_version: "drift.framework_adapter.v1",
      framework: "next",
      adapter_id: "next_app_router",
      route_discovery: {
        path_globs: ["app/**/route.ts", "app/**/route.tsx"],
        method_exports: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
      },
      entrypoint_patterns: expect.arrayContaining(["api_route", "server_action", "middleware"])
    });
  });

  it("describes Express route shapes without certifying runtime support", () => {
    expect(expressAdapter()).toMatchObject({
      schema_version: "drift.framework_adapter.v1",
      framework: "express",
      adapter_id: "express_router",
      route_discovery: {
        method_exports: ["get", "post", "put", "patch", "delete", "all", "use"]
      },
      entrypoint_patterns: expect.arrayContaining(["api_route", "middleware", "webhook_handler"]),
      unsupported_patterns: expect.arrayContaining(["computed router method names"])
    });
    expect(TYPESCRIPT_ADAPTER_MANIFEST.capabilities.some((capability) =>
      capability.scope.frameworks?.includes("express")
    )).toBe(false);
  });

  it("validates the built-in TypeScript adapter manifest", () => {
    const manifest = AdapterManifestSchema.parse(TYPESCRIPT_ADAPTER_MANIFEST);

    expect(manifest).toMatchObject({
      id: "typescript",
      language: "typescript",
      runtime: "rust_builtin",
      execution: "in_process",
      version: "0.1.0"
    });
    expect(manifest.capabilities.map((capability) => capability.id)).toEqual(expect.arrayContaining([
      "file_discovery",
      "syntax_facts",
      "import_resolution",
      "symbol_linking",
      "route_detection",
      "data_operation_detection",
      "graph_stream",
      "direct_data_access_check",
      "candidate_inference"
    ]));
  });

  it("keeps TypeScript adapter evidence fixture ids resolvable", () => {
    const fixtureIds = TYPESCRIPT_ADAPTER_MANIFEST.capabilities
      .flatMap((capability) => capability.evidence.fixture_ids);
    const fixtureRoot = resolve("..", "..", "test", "fixtures");

    expect(fixtureIds.filter((fixtureId) =>
      !existsSync(resolve(fixtureRoot, fixtureId))
    )).toEqual([]);
  });

  it("certifies capabilities with scope, evidence, and blocking safety", () => {
    const capability = AdapterCapabilitySchema.parse({
      id: "import_resolution",
      certification: "fixture_verified",
      scope: {
        languages: ["typescript", "tsx"],
        frameworks: ["nextjs"],
        file_roles: ["api_route", "service_module"]
      },
      evidence: {
        fixture_ids: ["monorepo-alias-db", "next-api-service-delegated"],
        test_commands: ["cargo test -p drift-engine --test stream_graph"],
        notes: "Static resolver covers tsconfig paths and relative imports."
      },
      can_block: true,
      diagnostics: []
    });

    expect(capability.can_block).toBe(true);
    expect(capability.evidence.fixture_ids).toContain("monorepo-alias-db");
  });

  it("reports missing required capabilities by adapter id", () => {
    expect(missingRequiredCapabilities({
      adapterId: "typescript",
      requiredCapabilities: ["syntax_facts", "import_resolution", "python_ast"]
    })).toEqual(["python_ast"]);
  });

  it("fails closed when a blocking rule requests an uncertified capability", () => {
    expect(() => assertCertifiedCapability({
      adapterId: "typescript",
      capabilityId: "python_ast",
      requiresBlocking: true
    })).toThrow(/does not certify required capability python_ast/);
  });

  it("returns only capabilities certified for blocking when requested", () => {
    const blocking = certifiedCapabilitiesForAdapter("typescript", { blockingOnly: true });

    expect(blocking).toContain("direct_data_access_check");
    expect(blocking).not.toContain("candidate_inference");
  });

  it("validates adapter output batches against manifest capabilities and evidence", () => {
    const batch = validateAdapterOutputBatch({
      manifest: TYPESCRIPT_ADAPTER_MANIFEST,
      batch: {
        schema_version: "adapter.output.batch.v1",
        adapter_id: "typescript",
        adapter_version: "0.1.0",
        sequence: 1,
        capabilities_used: ["syntax_facts", "import_resolution"],
        facts: [{
          id: "fact_import_1",
          kind: "import_used",
          file_path: "apps/web/app/api/users/route.ts",
          evidence_ids: ["evidence_import_1"]
        }],
        graph_nodes: [{
          id: "node_import_1",
          kind: "import_decl",
          evidence_ids: ["evidence_import_1"]
        }],
        graph_edges: [],
        evidence: [{
          id: "evidence_import_1",
          file_path: "apps/web/app/api/users/route.ts",
          file_hash: "a".repeat(64),
          start_line: 1,
          end_line: 1,
          redaction_state: "none"
        }],
        diagnostics: []
      }
    });

    expect(batch.capabilities_used).toEqual(["syntax_facts", "import_resolution"]);
  });

  it("rejects adapter output that overclaims uncertified capabilities", () => {
    expect(() => validateAdapterOutputBatch({
      manifest: TYPESCRIPT_ADAPTER_MANIFEST,
      batch: {
        schema_version: "adapter.output.batch.v1",
        adapter_id: "typescript",
        adapter_version: "0.1.0",
        sequence: 1,
        capabilities_used: ["candidate_inference", "python_ast"],
        facts: [],
        graph_nodes: [],
        graph_edges: [],
        evidence: [],
        diagnostics: []
      }
    })).toThrow(/uses uncertified capability python_ast/);
  });

  it("rejects adapter output that omits required evidence", () => {
    expect(() => validateAdapterOutputBatch({
      manifest: TYPESCRIPT_ADAPTER_MANIFEST,
      batch: {
        schema_version: "adapter.output.batch.v1",
        adapter_id: "typescript",
        adapter_version: "0.1.0",
        sequence: 1,
        capabilities_used: ["syntax_facts"],
        facts: [{
          id: "fact_import_1",
          kind: "import_used",
          file_path: "apps/web/app/api/users/route.ts",
          evidence_ids: ["missing_evidence"]
        }],
        graph_nodes: [],
        graph_edges: [],
        evidence: [],
        diagnostics: []
      }
    })).toThrow(/references missing evidence missing_evidence/);
  });

  it("rejects external executable adapters in V1 conformance", () => {
    expect(() => AdapterManifestSchema.parse({
      id: "python",
      language: "javascript",
      version: "0.1.0",
      runtime: "external_process",
      execution: "subprocess_manifest_only",
      package_name: "@drift/python-adapter",
      capabilities: [{
        id: "syntax_facts",
        certification: "declared",
        scope: { languages: ["javascript"] },
        evidence: { fixture_ids: ["python-fixture"], test_commands: ["pytest"] },
        can_block: false,
        diagnostics: []
      }]
    })).toThrow(/external adapters are manifest-only in V1/);
  });
});
