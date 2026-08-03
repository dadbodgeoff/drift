import { describe, expect, it } from "vitest";
import { importCoverageDetail, importCoverageReport } from "../src/domain/import-coverage.js";

/**
 * EW-3, the arithmetic. The end-to-end surfaces are pinned in
 * test/e2e/coverage-self-report.test.ts; these are the properties that make the numbers worth
 * printing at all.
 *
 * The one that matters most is reconciliation. A breakdown whose buckets do not sum to the gap
 * count is not a smaller truth, it is a wrong one - a reader would take "3 unresolved imports in
 * apps/web" as the whole of a run that actually had eleven gaps. So the report states whether it
 * reconciles, and doctor downgrades itself to `fail` when it does not, rather than presenting
 * numbers it cannot defend.
 */

const gap = (code: string, filePath: string, importSource?: string) => ({
  code,
  message: `${code} on ${filePath}`,
  file_path: filePath,
  ...(importSource ? { import_source: importSource } : {})
});

describe("import coverage report", () => {
  it("buckets by diagnostic code and reconciles against the parser gap count", () => {
    const report = importCoverageReport({
      resolvedLocalImports: 90,
      diagnostics: [
        gap("unresolved_import", "apps/web/app/api/a/route.ts", "@/lib/missing"),
        gap("unresolved_import", "apps/web/app/api/b/route.ts", "@/lib/missing"),
        gap("unresolved_import", "packages/db/src/index.ts", "@/lib/other"),
        gap("unsupported_namespace_import_symbol", "apps/web/app/api/c/route.ts", "@acme/util")
      ]
    });

    expect(report.resolved_local_imports).toBe(90);
    expect(report.unresolved_local_imports).toBe(3);
    expect(report.local_import_resolution_rate).toBeCloseTo(90 / 93, 4);
    expect(report.parser_gap_count).toBe(4);
    expect(report.reconciles, "the whole point of a breakdown is that it adds up").toBe(true);

    const unresolved = report.by_code.find((bucket) => bucket.code === "unresolved_import");
    expect(unresolved?.count).toBe(3);
    expect(unresolved?.by_directory).toEqual([
      { directory: "apps", count: 2 },
      { directory: "packages", count: 1 }
    ]);
    expect(
      unresolved?.top_specifiers,
      "the top offenders are the work list - without them a count is not actionable"
    ).toEqual([
      { specifier: "@/lib/missing", count: 2 },
      { specifier: "@/lib/other", count: 1 }
    ]);
  });

  it("reports a mismatch against a stored gap count rather than hiding it", () => {
    const report = importCoverageReport({
      resolvedLocalImports: 10,
      diagnostics: [gap("unresolved_import", "app/api/a/route.ts", "@/lib/missing")],
      // The scan persisted a different number: its gap rows and its diagnostics disagree.
      storedParserGapCount: 7
    });

    expect(report.reconciles).toBe(false);
    expect(
      importCoverageDetail(report),
      "the detail line must say the numbers are unreliable, not print them as if they were fine"
    ).toMatch(/does not reconcile/);
  });

  it("names a known unsupported shape as a limitation with remediation", () => {
    const report = importCoverageReport({
      resolvedLocalImports: 5,
      diagnostics: [gap("unsupported_namespace_import_symbol", "app/api/a/route.ts", "@acme/util")]
    });

    const bucket = report.by_code[0];
    expect(bucket.code).toBe("unsupported_namespace_import_symbol");
    expect(bucket.limitation, "a limitation is a boundary a user can work around").toBeTruthy();
    expect(bucket.limitation).toMatch(/Import the symbols you use by name/);
  });

  it("reports no rate rather than 100% when there are no local imports", () => {
    const report = importCoverageReport({ resolvedLocalImports: 0, diagnostics: [] });

    expect(
      report.local_import_resolution_rate,
      "0/0 is not full coverage, and reporting it as 1 is the flattering non-answer this exists to avoid"
    ).toBeNull();
    expect(importCoverageDetail(report)).toMatch(/no local imports seen yet/);
  });

  it("excludes diagnostics with no file path from the gap count, matching what is stored", () => {
    // `parserGapsFromDiagnostics` requires a file_path, so a file-less diagnostic never becomes a
    // gap row. A bucket that counted it would make the report unreconcilable against storage.
    const report = importCoverageReport({
      resolvedLocalImports: 4,
      diagnostics: [
        { code: "unresolved_import", message: "no file" },
        gap("unresolved_import", "app/api/a/route.ts", "@/lib/missing")
      ]
    });

    expect(report.diagnostic_count).toBe(2);
    expect(report.parser_gap_count).toBe(1);
    expect(report.reconciles).toBe(true);
  });
});
