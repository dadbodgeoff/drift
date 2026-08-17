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
 *
 * The asymmetry had a hole in it, and the hole was the shape of the whole bench. Every term above
 * fires on a RISE: parser gaps up, refusals up, fact counts disagreeing. Nothing fired on a fall,
 * because on those three axes a fall is the work succeeding. But the bench also measures how much
 * Drift found, and there a fall is not the work succeeding - it is the check going quiet. A build
 * that detected nothing at all would have posted zero parser gaps and zero refusals and read as
 * seven repos' worth of improvement. `findings_count` is the floor that makes that case fail: it is
 * the number of findings the onboarding `--scope full` check reported, and it may not drop.
 */
export function ratchetRegressions(row, before) {
  const regressions = [];
  if (!before) {
    return [`${row.repo}: no baseline row; run --update to record one`];
  }
  if (before.onboarded && !row.onboarded) {
    return [`${row.repo}: onboarding regressed (${row.error})`];
  }
  regressions.push(...findingsFloorRegressions(row, before));
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

/**
 * The floor: a repo's full-scope findings count may rise, but it may never fall.
 *
 * Deliberately unlike the terms above, and for the reason those terms are one-directional. A rise
 * here is Drift detecting more, which is the direction the product is trying to move in, so it is
 * recorded on the next `--update` and never blocks. A fall is a check that used to fire and no
 * longer does, which is the failure this bench could not previously see at all.
 *
 * Both "the field went missing" cases fail loudly rather than skipping. A number that becomes
 * `null` because the check payload stopped parsing is the *same event* as the number going to zero,
 * and a baseline row with no floor in it is a repo that passes this term by having never been
 * measured - which is how a repo joins the suite and asserts nothing.
 */
function findingsFloorRegressions(row, before) {
  if (typeof before.findings_count !== "number") {
    return [
      `${row.repo}: no findings_count in the baseline row, so nothing holds the floor; ` +
        `re-record it with \`pnpm eval:bench:update\``
    ];
  }
  if (typeof row.findings_count !== "number") {
    return [
      `${row.repo}: findings_count is unmeasured (${JSON.stringify(row.findings_count)}) but the ` +
        `baseline recorded ${before.findings_count}; an unreadable check is not a clean one`
    ];
  }
  if (row.findings_count < before.findings_count) {
    return [
      `${row.repo}: full-scope findings fell ${before.findings_count} -> ${row.findings_count} ` +
        `(-${before.findings_count - row.findings_count}); a check that stopped firing is not an improvement`
    ];
  }
  return [];
}
