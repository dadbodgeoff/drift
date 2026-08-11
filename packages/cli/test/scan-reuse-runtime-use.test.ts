import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "@drift/storage";
import {
  DRIFT_RESOLVER_VERSION,
  DRIFT_SCANNER_VERSION,
  DRIFT_TYPESCRIPT_ADAPTER_VERSION
} from "@drift/core";
import {
  cleanupScanReuseManifest,
  createScanReuseManifest
} from "../src/domain/scan-status.js";

/**
 * EW-1, and a defect it uncovered that is older and wider than S10.
 *
 * `runtime_use` is the proof, carried on an `import_used` fact, that a module is executed at
 * runtime: `value_position` (the binding appears in a value position), `dynamic` (`require()` /
 * `import()`, runtime by construction - S1-05), and now `side_effect` (a bindingless
 * `import "x"` - S10). Graph assembly consults it to decide whether member-level symbol
 * conservatism has anything to say: with the proof present, `unresolved_import_symbol` is
 * suppressed, because there is no symbol whose absence could matter.
 *
 * The reuse manifest hands the engine the previous scan's facts so unchanged files are not
 * reparsed. It did not carry `runtime_use`. The consequences are asymmetric in the worst
 * direction: on a *reused* file every runtime-use proof silently evaporates, so the engine
 * re-derives conservative diagnostics that the fresh scan of the identical file does not
 * produce. Measured on the `side-effect-import-finding` fixture: fresh scan -> 0 parser gaps
 * and both violations enforced at `block`; the same check through reuse -> 1
 * `unresolved_import_symbol` gap on the route, `enforcement_result: none` on *both* findings,
 * and the check refusing with exit 3.
 *
 * So the same repo, unmodified, is enforced or refused depending only on whether a prior scan
 * happened to be reusable - and the refusal is the state a real user reaches, because the
 * first thing any user does after `start` is `check`.
 *
 * This test pins the manifest content rather than the downstream effect: the field either
 * round-trips or it does not, and asserting it here fails in one line instead of as a
 * mysterious exit 3 three layers away.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REPO_ID = "repo_reuse";
const SCAN_ID = "scan_reuse_previous";
const ROUTE = "app/api/users/route.ts";
const RESOLVER_INPUTS = "resolver-input-fingerprint";

function factQuality(startColumn = 1) {
  return {
    source_span: { start_line: 1, start_column: startColumn, end_line: 1, end_column: startColumn + 4 },
    ast_node_kind: null,
    extraction_method: "rust_typescript_parser",
    extractor_version: "0.1.0",
    parser_version: "0.1.0",
    confidence: 1,
    confidence_label: "certain" as const,
    evidence_level: "ast" as const,
    resolution_status: "resolved" as const,
    staleness_status: "fresh" as const,
    last_seen_scan_id: SCAN_ID
  };
}

async function reuseManifestFacts(): Promise<Array<Record<string, unknown>>> {
  const dir = await mkdtemp(join(tmpdir(), "drift-reuse-runtime-use-"));
  dirs.push(dir);
  const storage = openDriftStorage({ databasePath: join(dir, "drift.sqlite") });
  try {
    storage.migrate();
    storage.upsertRepo({
      id: REPO_ID,
      root_path: "/tmp/repo",
      fingerprint: "fingerprint",
      created_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z"
    });
    storage.upsertScanManifest({
      id: SCAN_ID,
      repo_id: REPO_ID,
      branch: "main",
      commit: "abc123",
      dirty: false,
      status: "completed",
      rule_engine_version: "0.1.0",
      file_count: 1,
      fact_count: 2,
      finding_count: 0,
      started_at: "2026-08-02T00:00:00.000Z",
      completed_at: "2026-08-02T00:00:01.000Z",
      scanner_version: DRIFT_SCANNER_VERSION,
      adapter_versions: {
        typescript: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
        resolver: DRIFT_RESOLVER_VERSION,
        resolver_inputs: RESOLVER_INPUTS,
        engine: "0.1.0"
      }
    });
    storage.upsertFileSnapshot({
      repo_id: REPO_ID,
      scan_id: SCAN_ID,
      file_path: ROUTE,
      content_hash: "a".repeat(64),
      byte_size: 120,
      indexed: true
    });
    storage.upsertScanCapabilityReport({
      schema_version: "drift.scan_capability_report.v1",
      repo_id: REPO_ID,
      scan_id: SCAN_ID,
      engine_source: "rust",
      engine_version: null,
      scanner_version: DRIFT_SCANNER_VERSION,
      adapter_versions: { typescript: DRIFT_TYPESCRIPT_ADAPTER_VERSION },
      certified_capabilities: [],
      required_capabilities: [],
      missing_capabilities: [],
      completeness: [],
      parser_gap_count: 0,
      parser_gap_kinds: {},
      fallback_used: false,
      enforcement_degraded: false,
      created_at: "2026-08-02T00:00:01.000Z"
    });
    storage.upsertFacts([
      {
        id: "fact_side_effect_import",
        repo_id: REPO_ID,
        scan_id: SCAN_ID,
        kind: "import_used",
        file_path: ROUTE,
        name: "(side-effect)",
        value: "@/lib/prisma",
        imported_name: "(side-effect)",
        runtime_use: "side_effect",
        start_line: 2,
        end_line: 2,
        ...factQuality(9)
      },
      {
        id: "fact_dynamic_import",
        repo_id: REPO_ID,
        scan_id: SCAN_ID,
        kind: "import_used",
        file_path: ROUTE,
        name: "loaded",
        value: "@/lib/other",
        imported_name: "loaded",
        runtime_use: "dynamic",
        start_line: 3,
        end_line: 3,
        ...factQuality(17)
      }
    ]);

    const manifest = createScanReuseManifest({
      storage,
      repoId: REPO_ID,
      previousScan: storage.getScanManifest(SCAN_ID),
      currentResolverInputFingerprint: RESOLVER_INPUTS
    });
    expect(manifest, "reuse must not be blocked, or this test proves nothing").not.toBeNull();
    const parsed = JSON.parse(await readFile(manifest!.path, "utf8")) as {
      facts: Array<Record<string, unknown>>;
    };
    cleanupScanReuseManifest(manifest);
    return parsed.facts;
  } finally {
    storage.close();
  }
}

describe("scan reuse manifest", () => {
  it("carries runtime_use so reused facts keep their runtime-use proof", async () => {
    const facts = await reuseManifestFacts();

    const sideEffect = facts.find((fact) => fact.value === "@/lib/prisma");
    expect(
      sideEffect?.runtime_use,
      "a reused side-effect import with no runtime_use is indistinguishable from a plain " +
        "import whose symbol could not be resolved, which is what makes the engine refuse"
    ).toBe("side_effect");
  });

  it("carries runtime_use for dynamic imports too, which is the older half of the bug", async () => {
    const facts = await reuseManifestFacts();

    const dynamic = facts.find((fact) => fact.value === "@/lib/other");
    expect(
      dynamic?.runtime_use,
      "S1-05 exempted require()/import() from member-level conservatism; reuse was quietly " +
        "putting them back under it"
    ).toBe("dynamic");
  });

  it("carries the source columns, without which a reused file re-collapses two occurrences", async () => {
    const facts = await reuseManifestFacts();

    // EW-6 (DET-1). The reuse manifest is the second counting path, and it was dropping the column
    // that makes two occurrences on one line two facts. Measured: a fresh scan of a repo with four
    // identical calls across two lines stored 46 facts; the same repo rescanned through reuse
    // stored 40. The manifest either carries the position or the drop comes straight back.
    for (const fact of facts) {
      expect(
        fact.start_column,
        `every reused fact needs its column: ${JSON.stringify(fact)}`
      ).toBeGreaterThan(0);
      expect(fact.end_column).toBeGreaterThan(0);
    }
  });
});
