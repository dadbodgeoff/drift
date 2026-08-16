/**
 * W7's ratchet: what Drift can SEE, per repo, held against a baseline.
 *
 * Extracted from the runner so scripts/detection-breadth.test.mjs can drive it with synthetic
 * rows - including a replay of each W7 defect, so the gate is shown to catch the exact escapes it
 * exists for rather than merely being present.
 *
 * The external-eval suite proves the loop works end to end on seven repos: everything onboards, the
 * learned contract names the real data layer, an injected direct-DB route is caught with correct
 * file:line evidence, a properly layered route is not. It passes today and passed before W7. What
 * it cannot see is BREADTH - whether the set of things Drift is capable of noticing has quietly
 * shrunk - because the three fields that would show it (`files`, `facts`, `candidates`) are in that
 * suite's VOLATILE set and excluded from its diff.
 *
 * That exclusion is right for those fields and wrong as a general policy, and W7 is the proof: all
 * six defects it closes were invisible to every gate in the repository.
 *
 *   D-H2   27 route handlers across three repos were not files with a role, so nothing scoped
 *          to `api_route` could reach them. Every external-eval assertion still passed.
 *   D-H3   a Drizzle repo's data layer produced zero candidates. Every corpus repo names its
 *          data layer prisma/db/database, so the suite could not tell.
 *   D-S2   2,773 false or unprovable import-symbol diagnostics, each of which withholds a
 *          finding. Not one field counted them.
 *   D-PA1  129 files that did not parse, reported as clean.
 *
 * Direction matters per field, and it is the whole design:
 *
 *   RECALL fields (routes, exports, data-layer specifiers) may rise freely and may never fall.
 *   A fall is a detection regression - the W7 failure class - and stops the gate.
 *
 *   UNCERTAINTY fields (unresolved symbols, unresolved imports, partial parses) may fall freely
 *   and may never rise. A rise means Drift understands less of the same pinned source than it
 *   did, which withholds findings.
 *
 * Both directions are allowed to move with an explicit `--update` whose diff a human read. What is
 * not allowed is moving silently.
 */

/**
 * Fields where more is better. Falling is the regression.
 *
 * `route_files_outside_api` is listed separately from `route_files` on purpose. It is the D-H2
 * quantity, it is small (27 corpus-wide against 900+ routes), and folding it into the total would
 * let all 27 vanish inside ordinary upstream churn - which is precisely how they went unnoticed.
 */
export const RECALL_FIELDS = [
  "route_files",
  "route_files_outside_api",
  "exported_symbols",
  "data_layer_specifiers_count"
];

/** Fields where less is better. Rising is the regression. */
export const UNCERTAINTY_FIELDS = [
  "unresolved_import_symbol",
  "unresolved_import",
  "partial_parse"
];

/**
 * @typedef {Record<string, unknown>} Row
 */

/**
 * Compare one repo's measured row against its baseline.
 *
 * @param {Row} row      freshly measured
 * @param {Row|undefined} baseline  the recorded row, or undefined for a repo not yet baselined
 * @returns {{ status: "PASS"|"FAIL"|"NEW", failures: string[], moves: string[] }}
 */
export function breadthVerdict(row, baseline) {
  const failures = [];
  const moves = [];

  if (row.status === "MISSING_REPO") {
    // The committed fixture. Absent means a broken checkout, which must stop the gate.
    return { status: "FAIL", failures: ["fixture_missing"], moves: [] };
  }
  if (row.status === "SKIPPED_NO_CORPUS") {
    // A corpus repo that is not on this machine. Skipped rather than failed, so the gate stays
    // meaningful where $DRIFT_EVAL_REPOS is not cloned - the fixture row still runs and still
    // covers every W7 defect. It is reported as SKIPPED, never counted as a pass: a gate that
    // reports success over repos it did not look at is the thing this workstream is about.
    return { status: "SKIPPED", failures: [], moves: [] };
  }
  if (row.status === "CONTAMINATED_WORKTREE") {
    return { status: "FAIL", failures: ["contaminated_worktree"], moves: [] };
  }
  if (row.status === "SCAN_FAILED") {
    return { status: "FAIL", failures: ["scan_failed"], moves: [] };
  }
  if (!baseline) {
    // A repo with no baseline row is NEW, not passing. Treating an absent baseline as a pass is
    // how a gate ends up green on a repo it has never actually checked.
    return { status: "NEW", failures: [], moves: ["no baseline row - run --update"] };
  }

  for (const field of RECALL_FIELDS) {
    const before = Number(baseline[field] ?? 0);
    const after = Number(row[field] ?? 0);
    if (after < before) {
      failures.push(`${field}_fell`);
      moves.push(`${field}: ${before} -> ${after} (detection regression)`);
    } else if (after > before) {
      moves.push(`${field}: ${before} -> ${after}`);
    }
  }

  for (const field of UNCERTAINTY_FIELDS) {
    const before = Number(baseline[field] ?? 0);
    const after = Number(row[field] ?? 0);
    if (after > before) {
      failures.push(`${field}_rose`);
      moves.push(`${field}: ${before} -> ${after} (understands less of the same source)`);
    } else if (after < before) {
      moves.push(`${field}: ${before} -> ${after}`);
    }
  }

  // The specifiers themselves, not just how many. A vocabulary change that swaps one data layer
  // for another keeps the count and is exactly the D-H3 shape, where a whole ORM family was
  // missing while the count on prisma repos stayed put.
  const lost = (baseline.data_layer_specifiers ?? []).filter(
    (specifier) => !(row.data_layer_specifiers ?? []).includes(specifier)
  );
  if (lost.length > 0) {
    failures.push("data_layer_specifiers_lost");
    moves.push(`data_layer_specifiers no longer seen: ${lost.join(", ")}`);
  }

  // D-H3, asserted rather than ratcheted: a row that records what the learned contract forbids must
  // still forbid the repo's real data layer. A ratchet cannot express this - the count was zero
  // before the fix, and "zero is not less than zero" would have passed.
  if (row.learned_contract_names_data_layer === false) {
    failures.push("learned_contract_lost_the_data_layer");
    moves.push(
      `learned_forbidden_imports: ${JSON.stringify(row.learned_forbidden_imports ?? [])}` +
        " no longer names the fixture's data layer"
    );
  }

  return { status: failures.length ? "FAIL" : "PASS", failures, moves };
}

/**
 * Merge measured rows into the baseline without truncating it.
 *
 * The same defect external-eval's O-4 records: `--only` used to rewrite the baseline to just the
 * filtered repos, silently destroying every other row.
 */
export function mergeBreadthRows(baseline, results) {
  const byRepo = new Map(baseline.map((row) => [row.repo, row]));
  for (const row of results) {
    byRepo.set(row.repo, row);
  }
  return [...byRepo.values()].sort((left, right) => left.repo.localeCompare(right.repo));
}
