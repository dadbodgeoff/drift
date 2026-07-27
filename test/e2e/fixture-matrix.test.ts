import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";
import { openDriftStorage } from "../../packages/storage/src/index.js";

const tempDirs: string[] = [];
let originalEngineBin: string | undefined;

async function fixtureRepo(name: string): Promise<{ repoRoot: string; stateRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "drift-fixture-matrix-"));
  tempDirs.push(dir);
  const repoRoot = join(dir, "repo");
  const stateRoot = join(dir, "state");
  await cp(resolve("test/fixtures", name), repoRoot, { recursive: true });
  return { repoRoot, stateRoot };
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

describe("fixture matrix", () => {
  async function scanFixture(name: string) {
    const { repoRoot, stateRoot } = await fixtureRepo(name);
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    expect(scan.exitCode).toBe(0);
    return { repoRoot, scanPayload: JSON.parse(scan.stdout) };
  }

  it("keeps a service-delegated API route as a graph-resolved route-to-service flow", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("next-api-service-delegated");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(scan.stdout);
    const storage = openDriftStorage({ databasePath: payload.database_path });

    try {
      const edges = storage.listGraphEdges(payload.repo.id, payload.scan.id);
      const diagnostics = storage.listGraphDiagnostics(payload.repo.id, payload.scan.id);

      expect(payload.summary.files_indexed).toBe(3);
      expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: "unresolved_import" }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/services/users.ts"
      }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/lib/prisma.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("keeps a realistic Next Prisma service fixture clean when routes delegate", async () => {
    const { scanPayload } = await scanFixture("next-prisma-clean-service");
    const storage = openDriftStorage({ databasePath: scanPayload.database_path });

    try {
      const diagnostics = storage.listGraphDiagnostics(scanPayload.repo.id, scanPayload.scan.id);
      const edges = storage.listGraphEdges(scanPayload.repo.id, scanPayload.scan.id);

      expect(scanPayload.summary.files_indexed).toBeGreaterThanOrEqual(3);
      expect(scanPayload.candidates.map((candidate: any) => candidate.kind))
        .not.toContain("api_route_no_direct_data_access");
      expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: "unresolved_import" }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/services/users.ts"
      }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/lib/prisma.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("does not invent Prisma or data-store conventions for service fetch usage", async () => {
    const { scanPayload } = await scanFixture("next-non-prisma-fetch-service");

    expect(scanPayload.candidates.map((candidate: any) => candidate.kind))
      .not.toContain("api_route_no_direct_data_access");
    expect(JSON.stringify(scanPayload)).not.toContain("prisma");
  });

  it("handles a non-Next Node API repo without Next route claims", async () => {
    const { scanPayload } = await scanFixture("node-express-api");

    expect(scanPayload.summary.files_indexed).toBeGreaterThanOrEqual(4);
    expect(scanPayload.candidates.map((candidate: any) => candidate.kind))
      .not.toContain("api_route_no_direct_data_access");
  });

  it("resolves monorepo workspace package imports into graph module edges", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("monorepo-alias-db");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(scan.stdout);
    const storage = openDriftStorage({ databasePath: payload.database_path });

    try {
      const edges = storage.listGraphEdges(payload.repo.id, payload.scan.id);

      expect(payload.summary.files_indexed).toBe(2);
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:packages/db/src/index.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("handles repos with no TypeScript or JavaScript without inventing conventions", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("no-ts-repo");
    const scan = await runCli([
      "scan",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--now", "2026-05-10T00:00:00.000Z",
      "--json"
    ]);
    const payload = JSON.parse(scan.stdout);

    expect(payload.summary.files_indexed).toBe(0);
    expect(payload.summary.candidates_count).toBe(0);
    expect(payload.candidates).toEqual([]);
  });

  it("keeps barrel re-exported data clients visible in graph evidence", async () => {
    const { scanPayload } = await scanFixture("barrel-reexport-db");
    const storage = openDriftStorage({ databasePath: scanPayload.database_path });

    try {
      const edges = storage.listGraphEdges(scanPayload.repo.id, scanPayload.scan.id);

      expect(edges).toContainEqual(expect.objectContaining({
        kind: "MODULE_REEXPORTS_MODULE",
        to: "module:apps/web/lib/db.ts"
      }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        from: expect.stringContaining("apps/web/lib/index.ts"),
        to: "module:apps/web/lib/db.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("keeps namespace import and receiver-chain facts visible in graph nodes", async () => {
    const { scanPayload } = await scanFixture("namespace-import-db");
    const storage = openDriftStorage({ databasePath: scanPayload.database_path });

    try {
      const nodes = storage.listGraphNodes(scanPayload.repo.id, scanPayload.scan.id);

      expect(nodes).toContainEqual(expect.objectContaining({
        kind: "import_decl",
        metadata: expect.objectContaining({
          imported_name: "*",
          local_name: "dbModule",
          resolved_file_path: "apps/web/lib/db.ts"
        })
      }));
      expect(nodes).toContainEqual(expect.objectContaining({
        kind: "data_operation",
        metadata: expect.objectContaining({
          receiver_name: "dbModule.db.user",
          receiver_root: "dbModule",
          store_name: "db",
          operation_kind: "read"
        })
      }));
    } finally {
      storage.close();
    }
  });

  it("resolves default-exported services from API routes", async () => {
    const { scanPayload } = await scanFixture("default-export-service");
    const storage = openDriftStorage({ databasePath: scanPayload.database_path });

    try {
      const edges = storage.listGraphEdges(scanPayload.repo.id, scanPayload.scan.id);

      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        from: expect.stringContaining("apps/web/app/api/users/route.ts"),
        to: "module:apps/web/services/users.ts"
      }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_SYMBOL",
        to: "symbol:apps/web/services/users.ts:function:default"
      }));
    } finally {
      storage.close();
    }
  });

  it("derives endpoint shapes for dynamic app and pages API routes", async () => {
    const { scanPayload } = await scanFixture("dynamic-route-params");
    const storage = openDriftStorage({ databasePath: scanPayload.database_path });

    try {
      const endpoints = storage
        .listGraphNodes(scanPayload.repo.id, scanPayload.scan.id)
        .filter((node) => node.kind === "endpoint")
        .map((node) => node.metadata);

      expect(endpoints).toContainEqual(expect.objectContaining({
        route_pattern: "/api/users/:id",
        dynamic_params: ["id"]
      }));
      expect(endpoints).toContainEqual(expect.objectContaining({
        route_pattern: "/api/projects/:projectId",
        dynamic_params: ["projectId"]
      }));
    } finally {
      storage.close();
    }
  });

  it("surfaces write data operations through prepare graph context", async () => {
    const { repoRoot, scanPayload } = await scanFixture("route-write-operation");
    const prepared = await runCli([
      "--db", scanPayload.database_path,
      "prepare",
      "change user creation route",
      "--repo", scanPayload.repo.id,
      "--path", "apps/web/app/api/users/route.ts",
      "--json"
    ]);
    expect(prepared.exitCode).toBe(0);
    const payload = JSON.parse(prepared.stdout);

    expect(payload.graph_context.reachable_data_access[0].risk_reasons).toContainEqual(expect.objectContaining({
      risk_kind: "data_write",
      operation_kind: "write",
      operation_name: "create"
    }));
    expect(payload.required_checks).toContainEqual(expect.objectContaining({
      source: "graph_risk",
      matched_files: ["apps/web/app/api/users/route.ts"],
      risk_kinds: ["data_write"]
    }));
    expect(repoRoot).toContain("repo");
  });

  it("indexes mixed JavaScript and TypeScript route/service files", async () => {
    const { scanPayload } = await scanFixture("mixed-js-ts");
    const storage = openDriftStorage({ databasePath: scanPayload.database_path });

    try {
      const edges = storage.listGraphEdges(scanPayload.repo.id, scanPayload.scan.id);

      expect(scanPayload.summary.files_indexed).toBe(3);
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        from: expect.stringContaining("apps/web/pages/api/users.js"),
        to: "module:apps/web/services/users.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("indexes CommonJS require and dynamic import route dependencies", async () => {
    const { scanPayload } = await scanFixture("commonjs-dynamic-imports");
    const storage = openDriftStorage({ databasePath: scanPayload.database_path });

    try {
      const nodes = storage.listGraphNodes(scanPayload.repo.id, scanPayload.scan.id);
      const edges = storage.listGraphEdges(scanPayload.repo.id, scanPayload.scan.id);

      expect(scanPayload.summary.files_indexed).toBe(3);
      expect(nodes).toContainEqual(expect.objectContaining({
        kind: "import_decl",
        label: "prisma from ../../../lib/prisma",
        metadata: expect.objectContaining({
          source: "../../../lib/prisma",
          imported_name: "prisma"
        })
      }));
      expect(nodes).toContainEqual(expect.objectContaining({
        kind: "import_decl",
        label: "auth from ../../../server/auth",
        metadata: expect.objectContaining({
          source: "../../../server/auth",
          imported_name: "default"
        })
      }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/lib/prisma.ts"
      }));
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "IMPORT_RESOLVES_TO_MODULE",
        to: "module:apps/web/server/auth.ts"
      }));
    } finally {
      storage.close();
    }
  });

  it("keeps Chadlike auth and payment wrappers out of direct data-access imports", async () => {
    const { repoRoot, stateRoot } = await fixtureRepo("next-real-repo-chadlike");
    const started = await runCli([
      "start",
      "--repo-root", repoRoot,
      "--state-root", stateRoot,
      "--accept-defaults",
      "--now", "2026-05-10T00:00:10.000Z",
      "--json"
    ]);
    expect(started.exitCode).toBe(0);
    const payload = JSON.parse(started.stdout);
    const direct = payload.candidates.find((candidate: any) =>
      candidate.kind === "api_route_no_direct_data_access"
    );

    expect(direct?.matcher.forbidden_imports).toEqual(["~/lib/server/db"]);
    expect(payload.baselined_count).toBe(4);
    expect(payload.accepted.evidence_refs.every((ref: any) => ref.fact_ids.length > 0)).toBe(true);
    expect(payload.accepted.matcher.forbidden_imports).not.toContain("~/lib/server/auth/session");
    expect(payload.accepted.matcher.forbidden_imports).not.toContain("~/lib/server/payment");
    expect(payload.accepted.matcher.forbidden_imports).not.toContain("@prisma/client/runtime/library");
  });
});
