/**
 * BB-8: the counts this suite takes from `drift start`, read off the schema-locked JSON.
 *
 * Extracted so it can be unit-tested against a captured payload, which is the whole lesson of BB-8:
 * these four numbers used to be regexed out of `start`'s human output, nothing tested that the regexes
 * still matched anything, and when BB-3 reworded the acceptance sentence the `baselined` reader died.
 * `?? 0` supplied a plausible zero, the suite stayed green, and the baseline was then updated 397->0 on
 * every repo. The product had been baselining correctly the entire time.
 *
 * Two rules encoded here:
 *
 *   1. read the machine surface, never the prose - sentences are UX and will change again;
 *   2. absent is `null`, never `0`. "This run did not accept a convention, so it baselined nothing" and
 *      "this run baselined none of the violations it found" are different facts, and collapsing them
 *      into 0 is exactly what let the dead cell pass for a measurement.
 */

export function startCountsFrom(payload) {
  if (!payload || typeof payload !== "object") {
    return { repo_id: null, files: null, facts: null, candidates: null, baselined: null };
  }
  const summary = payload.summary ?? {};
  return {
    repo_id: payload.repo?.id ?? null,
    files: numberOrNull(summary.files_indexed),
    facts: numberOrNull(summary.facts_count),
    candidates: numberOrNull(summary.candidates_count),
    // `acceptance` is present iff `--accept-defaults` accepted something (BB-3). Its absence is a
    // legitimate state and reads as null; a present block with a real count reads as that count,
    // including a genuine zero on a repo with no pre-existing violations.
    baselined: payload.acceptance ? numberOrNull(payload.acceptance.baselined_count) : null
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
