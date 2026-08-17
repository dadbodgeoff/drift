/**
 * The determinism run's anti-silence comparison, as a pure decision so it can be tested without
 * seven repos and a release engine.
 *
 * `determinism.mjs` already computed the exact artifact this needs - findings count and every
 * fingerprint, `--scope full`, on every corpus repo - and threw it away at the end of the run. That
 * made the harness answer one question ("did three runs agree?") while staying blind to the one that
 * actually costs something: three runs agreeing on *nothing*. A check that stops firing is perfectly
 * deterministic. Ten baseline files sat beside this script and none of them was determinism's.
 *
 * The comparison is deliberately NOT a ratchet, and this is the difference from
 * beta-bench-ratchet.mjs. There, a falling parser-gap count is the work succeeding and demanding a
 * baseline update for an improvement is friction that gets routed around. Here a falling fingerprint
 * set is the failure mode itself, and a rising one is a change to what the product detects - which is
 * a claim about behaviour, so a human records it. Both directions fail; only the message differs,
 * because "12 fingerprints disappeared" and "3 fingerprints appeared" want different responses.
 *
 * Never auto-update. A gate that rewrites its own baseline when it disagrees is a gate that reports
 * whatever it just measured.
 */

/** The command a human runs to record a rise. Shared so the message and the docs cannot disagree. */
export const REBASELINE_COMMAND = "pnpm eval:determinism:update";

/**
 * Reduce a measured repo row to the part that is compared. Runs that flapped or never ran carry no
 * usable observation, so they contribute no artifact row rather than an empty one - a zeroed row
 * would look exactly like the drop this exists to catch, and the flap has already failed the run.
 */
export function digestArtifact(rows) {
  return rows
    .filter((row) => row.status === "DETERMINISTIC" && row.observable)
    .map((row) => ({
      repo: row.repo,
      digest: row.digest,
      findings_count: row.observable.findings_count,
      fingerprints: row.observable.findings.map((finding) => finding.fingerprint).sort()
    }));
}

/**
 * @param {ReturnType<typeof digestArtifact>} current
 * @param {ReturnType<typeof digestArtifact>} baseline
 * @returns {string[]} one line per failure, empty when the artifact matches
 */
export function digestRegressions(current, baseline) {
  const failures = [];
  const currentByRepo = new Map(current.map((row) => [row.repo, row]));
  const baselineByRepo = new Map(baseline.map((row) => [row.repo, row]));

  for (const [repo, before] of baselineByRepo) {
    if (!currentByRepo.has(repo)) {
      // A repo that stopped producing a comparable observation is the loudest possible drop: its
      // entire fingerprint set went missing at once. Silence about it would be the original bug.
      failures.push(`${repo}: measured in the baseline, absent from this run`);
      continue;
    }
    const now = currentByRepo.get(repo);
    const before_ = new Set(before.fingerprints);
    const now_ = new Set(now.fingerprints);
    const lost = before.fingerprints.filter((fingerprint) => !now_.has(fingerprint));
    const gained = now.fingerprints.filter((fingerprint) => !before_.has(fingerprint));

    if (now.findings_count < before.findings_count) {
      failures.push(
        `${repo}: DROP findings ${before.findings_count} -> ${now.findings_count} ` +
          `(-${before.findings_count - now.findings_count}); a check that stopped firing is not an improvement`
      );
    }
    if (lost.length > 0) {
      failures.push(
        `${repo}: DROP ${lost.length} fingerprint(s) no longer reported: ${describe(lost)}`
      );
    }
    if (gained.length > 0 || now.findings_count > before.findings_count) {
      failures.push(
        `${repo}: RISE findings ${before.findings_count} -> ${now.findings_count}` +
          (gained.length > 0 ? `, ${gained.length} new fingerprint(s): ${describe(gained)}` : "") +
          `. A rise is a change to what Drift detects; record it deliberately with \`${REBASELINE_COMMAND}\``
      );
    }
  }

  for (const repo of currentByRepo.keys()) {
    if (!baselineByRepo.has(repo)) {
      failures.push(
        `${repo}: no baseline row; a repo must not join the suite and assert nothing - ` +
          `record it with \`${REBASELINE_COMMAND}\``
      );
    }
  }

  return failures;
}

/** Enough fingerprints to act on, not so many the message becomes a dump. */
function describe(fingerprints) {
  const shown = fingerprints.slice(0, 5).join(", ");
  return fingerprints.length > 5 ? `${shown}, +${fingerprints.length - 5} more` : shown;
}
