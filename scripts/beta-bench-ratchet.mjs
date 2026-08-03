/**
 * The ratchet, as a pure decision so it can be tested without seven repos.
 *
 * Two directions, deliberately asymmetric. Parser gaps and refusals may FALL freely - that is the
 * work succeeding, and requiring a baseline update to record an improvement is friction that gets
 * routed around. A RISE fails and names the delta, because a rise is how formbricks went 99 -> 1,104
 * parser gaps without anyone noticing.
 *
 * Fact-count agreement is not a ratchet. It is either true or the determinism claim is false, so it
 * fails on falsity rather than on regression - a baseline recording disagreement would be a baseline
 * that blesses it.
 */
export function ratchetRegressions(row, before) {
  const regressions = [];
  if (!before) {
    return [`${row.repo}: no baseline row; run --update to record one`];
  }
  if (before.onboarded && !row.onboarded) {
    return [`${row.repo}: onboarding regressed (${row.error})`];
  }
  if (
    typeof before.parser_gap_count === "number" &&
    typeof row.parser_gap_count === "number" &&
    row.parser_gap_count > before.parser_gap_count
  ) {
    regressions.push(
      `${row.repo}: parser gaps rose ${before.parser_gap_count} -> ${row.parser_gap_count} ` +
        `(+${row.parser_gap_count - before.parser_gap_count})`
    );
  }
  if (
    typeof before.refused === "number" &&
    typeof row.refused === "number" &&
    row.refused > before.refused
  ) {
    regressions.push(
      `${row.repo}: ordinary-edit refusals rose ${before.refused}/${before.applicable} -> ` +
        `${row.refused}/${row.applicable}`
    );
  }
  if (row.fact_counts_agree === false) {
    regressions.push(
      `${row.repo}: fact counts disagree between scan paths - manifest ${row.fact_count_manifest}, ` +
        `stored ${row.fact_count_stored}`
    );
  }
  return regressions;
}
