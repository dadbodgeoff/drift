import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * R8-11's agreement gate. The two chain walkers, on one graph, verdict by verdict.
 *
 * "Does this import reach a forbidden module through some chain of modules" is answered TWICE by
 * two independent breadth-first searches over the same graph edges:
 *
 *   TypeScript  `reachesForbiddenViaExportedSurface` / `graphImportResolvesToForbidden`
 *               (`packages/cli/src/check/run-check.ts`)
 *   Rust        `forbidden_graph_import_target` (`crates/drift-engine/src/check_command.rs`)
 *
 * They are not one implementation called twice, and nothing but this file requires them to agree.
 * The codebase has already paid for that shape twice - see the comment on
 * `is_forbidden_import_source` in `check_command.rs`, where two copies of "is this specifier
 * forbidden" disagreed and a real violation was examined by neither path, and the one above
 * `resolvedModuleFilesFor` explaining why THAT question is answered by a single walk.
 *
 * R8 widened both walkers by one edge kind in one commit. The next person to touch either will
 * not necessarily know the other exists; the file names do not suggest each other and the
 * languages do not share a test runner. So the gate runs the real release binary over a real
 * fixture and compares real verdicts, rather than asserting that two enum lists are equal.
 *
 * WHAT IS COMPARED, precisely. The unit is an `import_decl` node in a file the graph itself marks
 * as an API route, paired with a forbidden-specifier list.
 *
 *   TypeScript verdict  `graphImportResolvesToForbidden` returns true.
 *   Rust verdict        the engine emitted an `api_route_no_direct_data_access` finding whose
 *                       `related_node_ids` contain that import node.
 *
 * The Rust walker is reached through `check-repo` because that is the only door it has; there is
 * no test-only entry point, and adding one would let the gate pass against a function the product
 * does not call. The consequence is that the comparison domain has to match the domain the rule
 * evaluates, which costs exactly one exclusion: an import whose specifier is DIRECTLY forbidden is
 * skipped by the rule before the walk runs (`check_command.rs`, the `is_forbidden_import_source`
 * continue), because the direct rule owns it. Those are excluded here and asserted separately, so
 * the exclusion cannot quietly grow to cover a divergence.
 *
 * The graph handed to both sides is the SCAN graph, unfiltered. `graphForEngineCheck` narrows the
 * edges the engine sees during a real check, and narrowing it here would test that filter rather
 * than the two walks - the filter has its own end-to-end coverage in
 * `packages/cli/test/binding-alias-laundering.test.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ENGINE = join(REPO_ROOT, "target/release/drift-engine");
const CLI_DIST = join(REPO_ROOT, "packages/cli/dist");
const FIXTURE = join(REPO_ROOT, "test/fixtures/bypass-binding-alias");

/**
 * The forbidden-specifier lists the two walkers are compared over.
 *
 * One list would compare one traversal. These pick the cases where a walker can be wrong in a way
 * a single list hides: a target reached only through laundering modules, a laundering module named
 * as the target itself (so the walk must stop at it rather than continue past it), a specifier
 * naming a module nothing launders, and a specifier that resolves to nothing at all - where the
 * only honest answer on both sides is false everywhere, and a walker that treats "resolved to
 * nothing" as a match would say true everywhere.
 */
const FORBIDDEN_SETS = [
  ["@/lib/prisma"],
  ["@/lib/alias"],
  ["@/lib/barrel"],
  ["@/services/users"],
  ["@/lib/does-not-exist"]
];

const tempDirs = [];
afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stringMetadata(metadata, key) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Files the graph itself calls API routes - the same derivation the Rust rule uses. */
function apiRouteFiles(scan) {
  const nodesById = new Map(scan.graph_nodes.map((node) => [node.id, node]));
  const files = new Set();
  for (const edge of scan.graph_edges) {
    if (edge.kind !== "FILE_HAS_ROLE") {
      continue;
    }
    if (stringMetadata(nodesById.get(edge.to)?.metadata, "role") !== "api_route") {
      continue;
    }
    const path = stringMetadata(nodesById.get(edge.from)?.metadata, "path");
    if (path) {
      files.add(path);
    }
  }
  return files;
}

/**
 * Every import declaration in a route file, as the pair both walkers key on.
 *
 * Taken from the graph node rather than joined from the `import_used` fact, because the TypeScript
 * walker looks its import node up by `file:local_name:source:line` - so reading those four fields
 * off the node is the identity function, and a join would introduce a third opinion about which
 * fact belongs to which node.
 */
function routeImports(scan) {
  const routes = apiRouteFiles(scan);
  const evidenceById = new Map(scan.graph_evidence.map((evidence) => [evidence.id, evidence]));
  return scan.graph_nodes
    .filter((node) => node.kind === "import_decl")
    .flatMap((node) => {
      const filePath = stringMetadata(node.metadata, "file_path");
      const name = stringMetadata(node.metadata, "local_name");
      const value = stringMetadata(node.metadata, "source");
      const startLine = node.evidence_ids
        .map((id) => evidenceById.get(id)?.start_line)
        .find((line) => typeof line === "number");
      if (!filePath || !name || !value || !startLine || !routes.has(filePath)) {
        return [];
      }
      return [{ id: node.id, filePath, importUsed: { name, value, start_line: startLine } }];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function conventionFor(forbidden) {
  return {
    id: "convention_chain_walker_parity",
    contract_id: "contract_chain_walker_parity",
    kind: "api_route_no_direct_data_access",
    matcher: { forbidden_imports: forbidden },
    scope: {},
    requires: {},
    exceptions: [],
    accepted_by: "chain-walker-parity",
    accepted_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    rationale: "the two walkers, compared",
    evidence_refs: [],
    counterexample_refs: [],
    severity: "high",
    // Warn, not block. The verdict under test is the walk's, and a blocking convention would drag
    // the CLI's refusal semantics into a comparison that has nothing to do with them.
    enforcement_mode: "warn",
    enforcement_capability: "deterministic_check"
  };
}

/**
 * The release binary and the built CLI, or nothing.
 *
 * Both walkers only exist as shipped artifacts - one is a Rust binary, the other is compiled
 * JavaScript - so there is no version of this gate that runs without them. Skipping loudly beats
 * a source-level approximation that would keep passing while the built pair disagreed.
 */
const BUILT = existsSync(ENGINE) && existsSync(join(CLI_DIST, "main.js"));

const { scanDataFromEngineStreamOutput } = BUILT
  ? await import(join(CLI_DIST, "engine/collect-scan-data.js"))
  : {};
const { engineCheckRequest } = BUILT ? await import(join(CLI_DIST, "engine/engine-check.js")) : {};
const { graphImportResolvesToForbidden } = BUILT
  ? await import(join(CLI_DIST, "check/run-check.js"))
  : {};
const { isForbiddenImport } = BUILT ? await import(join(CLI_DIST, "check/rule-evaluation.js")) : {};

/**
 * ONE scan, shared by every case. Both walkers must answer about the same graph, or the
 * comparison is between two fixtures rather than two implementations.
 */
function scanFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "drift-chain-walker-"));
  tempDirs.push(repoRoot);
  execFileSync("cp", ["-R", `${FIXTURE}/.`, repoRoot]);
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync(
    "git",
    ["-c", "user.email=parity@drift.test", "-c", "user.name=parity", "commit", "-qm", "fixture"],
    { cwd: repoRoot }
  );

  const output = execFileSync(
    ENGINE,
    ["scan-repo", repoRoot, "--format", "jsonl", "--repo-id", "repo_parity", "--scan-id", "scan_parity"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  return {
    repoRoot,
    scan: scanDataFromEngineStreamOutput(output, {
      repoId: "repo_parity",
      scanId: "scan_parity",
      repoRoot
    })
  };
}

describe.skipIf(!BUILT)("the TypeScript and Rust chain walkers agree", () => {
  const { repoRoot, scan } = scanFixture();
  const imports = routeImports(scan);

  /** The import nodes the Rust rule reported as reaching a forbidden module. */
  function rustReached(forbidden) {
    const request = engineCheckRequest({
      repoId: "repo_parity",
      repoRoot,
      scanId: "scan_parity",
      contractId: "contract_chain_walker_parity",
      contractSchemaVersion: 1,
      facts: scan.facts,
      snapshots: scan.snapshots,
      graphNodes: scan.graph_nodes,
      graphEdges: scan.graph_edges,
      graphEvidence: scan.graph_evidence,
      graphDiagnostics: [],
      conventions: [conventionFor(forbidden)],
      baseline: [],
      diff: {
        files: scan.files.map((path) => ({ path, changedLines: new Set([1]), isAdded: true })),
        deletedFiles: []
      },
      scope: "full"
    });
    const result = JSON.parse(
      execFileSync(ENGINE, ["check-repo"], {
        input: JSON.stringify(request),
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024
      })
    );
    const reached = new Set();
    for (const finding of result.findings ?? []) {
      if (finding.rule_id !== "api_route_no_direct_data_access") {
        continue;
      }
      for (const nodeId of finding.related_node_ids ?? []) {
        reached.add(nodeId);
      }
    }
    return reached;
  }

  it("the fixture actually exercises the walk", () => {
    // A gate over an empty domain agrees with everything. This is the assertion that fails the day
    // the fixture stops producing route imports, a role edge stops being emitted, or the scan
    // silently degrades - all of which would otherwise read as green.
    expect(imports.length).toBeGreaterThanOrEqual(15);
    expect(scan.graph_edges.some((edge) => edge.kind === "MODULE_REEXPORTS_MODULE")).toBe(true);
    expect(scan.graph_edges.some((edge) => edge.kind === "MODULE_ALIASES_MODULE")).toBe(true);
  });

  it.each(FORBIDDEN_SETS.map((forbidden) => [forbidden.join(","), forbidden]))(
    "same verdict for every route import, forbidding %s",
    (_label, forbidden) => {
      const reached = rustReached(forbidden);
      const walked = imports.filter((entry) => !isForbiddenImport(entry.importUsed.value, forbidden));

      // Rendered as a table rather than asserted one at a time: a failure has to say WHICH import
      // the two disagreed about and in which direction, or the next person re-derives it by hand.
      const typescript = walked.map(
        (entry) =>
          `${entry.filePath} ${entry.importUsed.value} -> ${
            graphImportResolvesToForbidden(scan, entry.filePath, entry.importUsed, forbidden)
          }`
      );
      const rust = walked.map(
        (entry) => `${entry.filePath} ${entry.importUsed.value} -> ${reached.has(entry.id)}`
      );

      expect(typescript).toEqual(rust);
    }
  );

  it("the excluded imports are only the directly-forbidden ones, and they are few", () => {
    // The exclusion above is the one place this gate could be widened until it proved nothing.
    // `@/lib/prisma` is the single specifier the fixture names directly; if that count ever grows,
    // someone has moved imports out of the compared domain rather than making the walkers agree.
    const excluded = imports.filter((entry) => isForbiddenImport(entry.importUsed.value, ["@/lib/prisma"]));

    expect(excluded.map((entry) => entry.filePath)).toEqual(["src/app/api/legacy/route.ts"]);
  });
});
