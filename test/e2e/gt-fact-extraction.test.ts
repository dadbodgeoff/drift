// Ground-truth audit, Track B: D2 (default-export canonicalisation) and D3 (local
// `export { name }`). TDD §5.2, §5.3.
//
// Workflow-level on purpose. The Rust integration layer hand-writes its facts into the
// check-repo request (`security_check_repo_phase5.rs:36-42`), so it starts downstream of
// extraction and cannot see either defect. Only a run of the real CLI can.
//
// Assertions are explicit rather than snapshots. `vitest -u` re-records every snapshot in a
// run from one flagless invocation, and a count that can be silently re-recorded is not
// evidence — which is the whole reason the audit's precision/recall numbers had to be
// remeasured by hand.

import { afterEach, describe, expect, it } from "vitest";
import { openDriftStorage } from "../../packages/storage/src/index.js";
import { cleanupGtTempDirs, readFacts, runGtWorkflow } from "./gt-harness.js";

afterEach(cleanupGtTempDirs);

interface ExportRow {
  name: string;
  value: string | null;
  file_path: string;
  imported_name: string | null;
}

/** `readFacts` omits absent columns; normalise them to `null` so tuples compare cleanly. */
function exportRows(rows: Array<Record<string, unknown>>): ExportRow[] {
  return rows
    .map((row) => ({
      name: String(row.name),
      value: (row.value ?? null) as string | null,
      file_path: String(row.file_path),
      imported_name: (row.imported_name ?? null) as string | null
    }))
    .sort((a, b) =>
      `${a.file_path}|${a.name}`.localeCompare(`${b.file_path}|${b.name}`)
    );
}

async function exportedSymbols(fixture: string): Promise<ExportRow[]> {
  const run = await runGtWorkflow({ fixture });
  const scanId = run.scanPayload.scan?.id ?? run.scanPayload.scan_id;
  return exportRows(readFacts(run.databasePath, scanId, "exported_symbol"));
}

describe("D2 — a default-exported declaration is ONE exported symbol, named `default`", () => {
  // `export default function handler()` does not create a named export `handler`.
  // `exported_symbols_by_file` (main.rs:2174) keys purely on `fact.name`, so the extra
  // `(handler, ∅)` fact made `import { handler } from "./orders"` resolve against a module
  // that exports no such name — a false resolution, not a harmless duplicate.
  it("emits 4 rows for gt-fact-extraction, with no bare `handler`", async () => {
    const rows = await exportedSymbols("gt-fact-extraction");

    expect(
      rows.filter((row) => row.name === "handler"),
      "`export default function handler` must not claim a NAMED export `handler`: " +
        "nothing can import { handler } from these modules"
    ).toEqual([]);

    expect(rows).toEqual([
      { name: "helperUnused", value: null, file_path: "lib/db.ts", imported_name: null },
      { name: "queryUsers", value: null, file_path: "lib/db.ts", imported_name: null },
      {
        name: "default",
        value: "handler",
        file_path: "pages/api/orders.ts",
        imported_name: null
      },
      {
        name: "default",
        value: "handler",
        file_path: "pages/api/users.ts",
        imported_name: null
      }
    ]);
  });

  it("keeps the local identifier as `value`, so consumers can still follow the default back", async () => {
    const rows = await exportedSymbols("gt-fact-extraction");
    const defaults = rows.filter((row) => row.name === "default");
    expect(defaults).toHaveLength(2);
    for (const row of defaults) {
      expect(row.value, `${row.file_path} default export records its local binding`).toBe(
        "handler"
      );
    }
  });

  it("canonicalises every default-export shape the same way", async () => {
    // Anonymous default and default-class are the two shapes the old two-fact split treated
    // asymmetrically: the anonymous form already produced one fact, the declaration form two.
    // One declaration ⇒ one fact makes them the same rule.
    const rows = await exportedSymbols("gt-default-export-shapes");

    expect(
      rows.filter((row) => row.name === "Widget"),
      "`export default class Widget` exports `default`, not a named `Widget`"
    ).toEqual([]);

    expect(rows.filter((row) => row.file_path === "lib/anon-arrow.ts")).toEqual([
      { name: "default", value: null, file_path: "lib/anon-arrow.ts", imported_name: null }
    ]);
    expect(rows.filter((row) => row.file_path === "lib/anon-object.ts")).toEqual([
      { name: "default", value: null, file_path: "lib/anon-object.ts", imported_name: null }
    ]);
    expect(rows.filter((row) => row.file_path === "lib/default-class.ts")).toEqual([
      {
        name: "default",
        value: "Widget",
        file_path: "lib/default-class.ts",
        imported_name: null
      }
    ]);
  });
});

describe("D3 — a local `export { name }` is an exported symbol", () => {
  // `extract_export` (facts.rs:622) gates the specifier path on a `source` child — the `from`
  // clause. A local `export { internalHelper };` has no source child, no declaration child and
  // is not a default export, so it fell through all four arms and emitted nothing. It is the
  // audit's sole recall miss.
  it("emits `internalHelper` for gt-fact-extraction2", async () => {
    const rows = await exportedSymbols("gt-fact-extraction2");

    expect(
      rows.map((row) => row.name),
      "`export { internalHelper }` at lib/util.ts:17 exports a runtime symbol"
    ).toContain("internalHelper");

    expect(rows).toEqual([
      { name: "addOne", value: null, file_path: "lib/util.ts", imported_name: null },
      { name: "internalHelper", value: null, file_path: "lib/util.ts", imported_name: null },
      { name: "Widget", value: null, file_path: "lib/util.ts", imported_name: null }
    ]);
  });

  it("does not model the type-only `export interface WidgetShape` as a runtime symbol", async () => {
    // Existing behaviour, pinned rather than changed. `exported_symbol` models RUNTIME
    // symbols; `first_named_declaration_identifier` (facts.rs:1163) matches only
    // function/generator/class/lexical/variable declarations, so an interface emits nothing.
    // A future consumer that needs type exports gets a distinct `exported_type` kind.
    const rows = await exportedSymbols("gt-fact-extraction2");
    expect(rows.map((row) => row.name)).not.toContain("WidgetShape");
  });

  it("does NOT emit a re-export fact for the local form", async () => {
    // A re-export additionally emits `ReExportUsed` (facts.rs:653), which is what
    // `export_star_sources_by_file` and `MODULE_REEXPORTS_MODULE` read. A local
    // `export { x }` has no target module, so claiming one would invent a module dependency
    // that does not exist.
    const run = await runGtWorkflow({ fixture: "gt-fact-extraction2" });
    const scanId = run.scanPayload.scan?.id ?? run.scanPayload.scan_id;

    expect(
      readFacts(run.databasePath, scanId, "re_export_used"),
      "a local export names no source module"
    ).toEqual([]);
    expect(
      readFacts(run.databasePath, scanId, "import_used"),
      "and it does not make the file an importer of anything"
    ).toEqual([]);
  });

  it("records a local alias in `imported_name`, following the EW-4 convention", async () => {
    // `export { helper as renamedHelper }` exports `renamedHelper`; `helper` is the local
    // binding. EW-4 already established `name` = exported, `imported_name` = the other name,
    // for the re-export case (facts.rs:936). The ASYMMETRY worth stating: in a re-export
    // `imported_name` is resolved in the TARGET module, whereas a local alias has no target,
    // so here it records the local binding in this same file. `value` is deliberately not
    // used — it means "the module specifier"/"the local binding of a default" elsewhere.
    const rows = await exportedSymbols("gt-default-export-shapes");
    const local = rows.filter((row) => row.file_path === "lib/local-specifiers.ts");

    expect(local).toEqual([
      {
        name: "default",
        value: "prisma",
        file_path: "lib/local-specifiers.ts",
        imported_name: null
      },
      { name: "prisma", value: null, file_path: "lib/local-specifiers.ts", imported_name: null },
      {
        name: "renamedHelper",
        value: null,
        file_path: "lib/local-specifiers.ts",
        imported_name: "helper"
      }
    ]);
  });

  it("leaves the graph referentially intact — no edge names a node that does not exist", async () => {
    // Not a D3 property: a D2 consequence, pinned here because it is the failure mode a fact
    // deletion causes and nothing else in the suite would have caught it.
    //
    // `symbol:<file>:function:<name>` nodes are inserted ONLY from `exported_symbol` facts
    // (main.rs:1627). Three edges point at them, and one of the three -
    // ROUTE_HANDLED_BY_SYMBOL (main.rs:1712) - used to target a Next pages/api route's local
    // handler identifier. That node existed only because a default-exported declaration emitted a
    // second fact under its local name, which is precisely the fact D2 removes. Dropping it
    // without retargeting the edge left `route_handler_symbol_ids` (query/src/index.ts:504)
    // handing callers an id that names nothing.
    const run = await runGtWorkflow({ fixture: "gt-fact-extraction" });
    const scanId = run.scanPayload.scan?.id ?? run.scanPayload.scan_id;
    const storage = openDriftStorage({ databasePath: run.databasePath });
    try {
      const nodeIds = new Set(storage.listGraphNodes(run.repoId, scanId).map((node: any) => node.id));
      const dangling = storage
        .listGraphEdges(run.repoId, scanId)
        .filter((edge: any) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))
        .map((edge: any) => `${edge.kind}: ${edge.from} -> ${edge.to}`)
        .sort();

      expect(dangling, "every edge endpoint must resolve to a node in the same graph").toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("leaves `symbol_called` facts untouched", async () => {
    // The control. D3 adds export rows; it must not perturb call extraction, which is what
    // the D5 phase-2 invocation-evidence work will rest on.
    const run = await runGtWorkflow({ fixture: "gt-fact-extraction2" });
    const scanId = run.scanPayload.scan?.id ?? run.scanPayload.scan_id;
    const called = readFacts(run.databasePath, scanId, "symbol_called");

    expect(called).toHaveLength(2);
    expect(called.map((fact) => fact.name)).toEqual(["addOne", "addOne"]);
    expect(called.every((fact) => fact.file_path === "lib/util.ts")).toBe(true);
  });
});
