import { parserGapKindForDiagnostic } from "./scan-status.js";

/**
 * EW-3. What Drift could not see, as a number, before anyone trusts a verdict.
 *
 * Every measurement this project has comes from seven Next.js/TypeScript monorepos it chose
 * itself. Open beta means Remix, Nx, Vite, Deno, and every repo shape encountered so far has
 * exposed a specific resolver gap. That cannot be pre-fixed. What it can do is say what it cannot
 * see, in the surface a stranger consults first, so a clean-looking check is never mistaken for
 * full coverage.
 *
 * No new analysis: the nine diagnostic kinds already exist. This aggregates them.
 */

export const IMPORT_COVERAGE_SCHEMA_VERSION = "drift.import_coverage.v1";

/** A diagnostic as this report needs it - the stored and in-memory shapes both satisfy it. */
export interface CoverageDiagnostic {
  code: string;
  message: string;
  file_path?: string;
  import_source?: string;
}

export interface CoverageBucket {
  code: string;
  count: number;
  /** Whether this code becomes a `parser_gap` row, which is what makes the totals reconcile. */
  counts_as_parser_gap: boolean;
  /** A named limitation with remediation, for codes that are a known unsupported shape. */
  limitation: string | null;
  by_directory: Array<{ directory: string; count: number }>;
  top_specifiers: Array<{ specifier: string; count: number }>;
}

export interface ImportCoverageReport {
  schema_version: typeof IMPORT_COVERAGE_SCHEMA_VERSION;
  /** Imports the resolver placed at a file in the snapshot. */
  resolved_local_imports: number;
  /** Imports Drift classified as should-be-local and could not place. */
  unresolved_local_imports: number;
  /**
   * `resolved / (resolved + unresolved)`, rounded to four places. `null` when there are no local
   * imports at all, because 0/0 is not "100% resolved" and reporting it as such is the exact kind
   * of flattering non-answer this report exists to avoid.
   */
  local_import_resolution_rate: number | null;
  /** Total diagnostics, whether or not they become parser gaps. */
  diagnostic_count: number;
  /** Diagnostics that become `parser_gap` rows. `by_code` filtered on the flag sums to this. */
  parser_gap_count: number;
  /**
   * Whether the parser-gap-contributing buckets sum to `parser_gap_count`. A report that does not
   * reconcile is worse than none, so the discrepancy is stated rather than hidden - and doctor
   * degrades its own check when this is false rather than presenting numbers it cannot defend.
   */
  reconciles: boolean;
  by_code: CoverageBucket[];
}

/**
 * Codes that name a shape Drift knowingly does not support, with what to do about it.
 *
 * The value of naming them is that "3 unresolved imports" reads as a bug in Drift while "this
 * repo uses a workspace glob shape the resolver does not expand" reads as a boundary a user can
 * work around or report. Codes absent from this map are ordinary gaps, not limitations.
 */
const LIMITATIONS: Record<string, string> = {
  unsupported_workspace_glob:
    "workspace globs of this shape are not expanded, so packages matched only by them are " +
    "invisible to the resolver. Declare the package paths explicitly in the workspace file, or " +
    "report the glob shape.",
  unsupported_dynamic_middleware_matcher:
    "the middleware matcher is computed at runtime, so which routes it covers cannot be read " +
    "statically. Use a literal matcher array if you need middleware coverage proved.",
  unsupported_namespace_import_symbol:
    "member-level resolution through a namespace import (`import * as x`) is conservative when " +
    "the binding is never used in a value position. Import the symbols you use by name to make " +
    "the dependency provable.",
  file_too_large:
    "the file is above the scan size limit and was skipped entirely. Nothing in it is analysed; " +
    "split it if it needs to be covered.",
  file_unreadable:
    "the file could not be read (permissions, or an encoding the parser rejects) and was skipped.",
  unreadable_path:
    "the path could not be traversed (a broken symlink, or permissions) and its contents were " +
    "skipped.",
  ambiguous_route_dependency_service_boundary:
    "the module this route imports exports no symbol the resolver recognises, so whether the " +
    "route delegates through a service cannot be decided either way."
};

/** The first path segment, which is the useful grouping in a monorepo (`apps`, `packages`). */
function topLevelDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : "(root)";
}

function rankedCounts<T extends string>(
  values: T[],
  limit: number
): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    // Count first, then the name, so the order does not depend on Map insertion order - this
    // report is compared across runs by the EW-4 ratchet.
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, limit);
}

const TOP_SPECIFIER_LIMIT = 5;

export function importCoverageReport(input: {
  diagnostics: CoverageDiagnostic[];
  /** Imports resolved to a file in the snapshot - distinct `IMPORT_RESOLVES_TO_MODULE` sources. */
  resolvedLocalImports: number;
  /**
   * The stored `parser_gap_count` for this scan, when there is one. Passing it lets the report
   * state whether it reconciles against what was actually persisted instead of only against
   * itself, which is the failure this check is really guarding: a scan whose gap rows and whose
   * diagnostics disagree.
   */
  storedParserGapCount?: number;
}): ImportCoverageReport {
  const buckets = new Map<string, CoverageDiagnostic[]>();
  for (const diagnostic of input.diagnostics) {
    const existing = buckets.get(diagnostic.code);
    if (existing) {
      existing.push(diagnostic);
    } else {
      buckets.set(diagnostic.code, [diagnostic]);
    }
  }

  const byCode: CoverageBucket[] = [...buckets.entries()]
    .map(([code, diagnostics]) => ({
      code,
      count: diagnostics.length,
      // Mirrors `parserGapsFromDiagnostics` exactly, including its `file_path` requirement.
      // Re-deriving the predicate rather than sharing it is how the two would drift apart, so
      // the mapping function is imported and the file_path condition restated beside it.
      counts_as_parser_gap: diagnostics.some(
        (diagnostic) =>
          parserGapKindForDiagnostic(diagnostic.code) !== null && Boolean(diagnostic.file_path)
      ),
      limitation: LIMITATIONS[code] ?? null,
      by_directory: rankedCounts(
        diagnostics
          .map((diagnostic) => diagnostic.file_path)
          .filter((filePath): filePath is string => Boolean(filePath))
          .map(topLevelDirectory),
        // Directories are few and all of them are actionable, so none are dropped.
        Number.MAX_SAFE_INTEGER
      ).map(({ value, count }) => ({ directory: value, count })),
      top_specifiers: rankedCounts(
        diagnostics
          .map((diagnostic) => diagnostic.import_source)
          .filter((specifier): specifier is string => Boolean(specifier)),
        TOP_SPECIFIER_LIMIT
      ).map(({ value, count }) => ({ specifier: value, count }))
    }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  const parserGapCount = input.diagnostics.filter(
    (diagnostic) =>
      parserGapKindForDiagnostic(diagnostic.code) !== null && Boolean(diagnostic.file_path)
  ).length;
  const bucketedGapCount = byCode
    .filter((bucket) => bucket.counts_as_parser_gap)
    .reduce(
      (total, bucket) =>
        total +
        bucket.count -
        // A bucket can mix gap-eligible and ineligible diagnostics when some rows have no
        // file_path, so the bucket count alone would overstate. Subtract the ineligible ones.
        (buckets.get(bucket.code) ?? []).filter((diagnostic) => !diagnostic.file_path).length,
      0
    );

  const unresolvedLocalImports = byCode.find((bucket) => bucket.code === "unresolved_import")?.count ?? 0;
  const localImports = input.resolvedLocalImports + unresolvedLocalImports;

  return {
    schema_version: IMPORT_COVERAGE_SCHEMA_VERSION,
    resolved_local_imports: input.resolvedLocalImports,
    unresolved_local_imports: unresolvedLocalImports,
    local_import_resolution_rate:
      localImports === 0
        ? null
        : Math.round((input.resolvedLocalImports / localImports) * 10_000) / 10_000,
    diagnostic_count: input.diagnostics.length,
    parser_gap_count: parserGapCount,
    reconciles:
      bucketedGapCount === parserGapCount &&
      (input.storedParserGapCount === undefined || input.storedParserGapCount === parserGapCount),
    by_code: byCode
  };
}

/** One line for the doctor text surface: the number, then the largest bucket. */
export function importCoverageDetail(report: ImportCoverageReport): string {
  if (report.local_import_resolution_rate === null && report.diagnostic_count === 0) {
    return "no local imports seen yet - run a scan";
  }
  const rate =
    report.local_import_resolution_rate === null
      ? "no local imports"
      : `${(report.local_import_resolution_rate * 100).toFixed(1)}% of local imports resolved ` +
        `(${report.resolved_local_imports} of ` +
        `${report.resolved_local_imports + report.unresolved_local_imports})`;
  if (!report.reconciles) {
    return `${rate}; report does not reconcile with the stored parser gap count, so treat these numbers as unreliable`;
  }
  const largest = report.by_code[0];
  if (!largest) {
    return `${rate}; no coverage gaps`;
  }
  const where = largest.by_directory[0];
  return (
    `${rate}; ${report.parser_gap_count} parser gap${report.parser_gap_count === 1 ? "" : "s"}, ` +
    `largest ${largest.code} x${largest.count}` +
    (where ? ` in ${where.directory}/` : "") +
    (largest.limitation ? " (known limitation - see JSON for remediation)" : "")
  );
}
