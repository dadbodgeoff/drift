/**
 * The external eval suite's per-repo PASS predicate, extracted so the harness's own
 * test suite can drive it with synthetic results (S1-03 / O-1).
 *
 * Every assertion is named; a FAIL verdict carries the names of the assertions that
 * failed, which the runner prints and records.
 */

/** BB-6's envelope ceiling, in bytes. Shared so the runner and the ratchet cannot disagree. */
export const PACKET_ENVELOPE_BUDGET = 500_000;

/**
 * W0: which coarse band of the envelope budget a repo's packet occupies.
 *
 * `packet_within_envelope_budget` is a cliff. It reads true at 499,999 bytes and false at
 * 500,001, so the only regression it can see is one that has already shipped. W7 fixed the
 * overrun that exposed this (dub 715,023 -> 269,235) and recorded `packet_bytes` so a flip
 * could be diagnosed - but put it in VOLATILE, which is the set the baseline diff SKIPS. So
 * the measurement exists and nothing compares it: dub could double from 270,193 to 499,999
 * and the suite would print "no change vs baseline".
 *
 * A band is compared instead of the raw number for the reason `packet_bytes` was made
 * volatile in the first place - ids and timestamps move it by tens of bytes between runs, and
 * a pinned integer would flap. The bands are wide enough that the closest repo (dub, 54.0% of
 * budget) sits 30k bytes clear of a boundary, and narrow enough that crossing 60% prints a
 * line while there is still 40% of the budget left to fix it in.
 */
/**
 * Band edges as fractions of the budget, exported because the anti-flap test asserts no suite
 * repo sits near one. Hardcoding them in the test instead would let an edge be moved onto a
 * repo with nothing failing - the gate losing its grip on the source it reads.
 */
export const ENVELOPE_BAND_EDGES = [0.6, 0.8, 0.95];

/** Worst-to-best ordering, so "did this band get worse" is a comparison rather than a table. */
export const ENVELOPE_BAND_ORDER = ["under_60pct", "60_to_80pct", "80_to_95pct", "over_95pct"];

export function envelopeBudgetBand(packetBytes, budget = PACKET_ENVELOPE_BUDGET) {
  if (!Number.isFinite(packetBytes) || !Number.isFinite(budget) || budget <= 0) {
    return null;
  }
  const ratio = packetBytes / budget;
  const index = ENVELOPE_BAND_EDGES.findIndex((edge) => ratio < edge);
  return index === -1 ? ENVELOPE_BAND_ORDER.at(-1) : ENVELOPE_BAND_ORDER[index];
}

/**
 * @param {object} result the record built by evaluateRepo
 * @param {object} cfg    the REPOS entry (or ad-hoc config) that produced it
 * @returns {{ status: "PASS" | "FAIL", failures: string[] }}
 */
export function repoVerdict(result, cfg) {
  const failures = [];
  const assert = (name, ok) => {
    if (!ok) failures.push(name);
  };

  assert("onboarded", Boolean(result.onboarded));

  // The F4 gap is *exercised* when inference alone finds nothing and discovery names the
  // wrapper anyway. Asserting inference succeeds would assert the bug is absent, which is
  // the opposite of what whitelist-independent repos are here to prove.
  assert(
    "f4_gap_exercised",
    !cfg.whitelistIndependent ||
      (result.inference_alone_found_data_layer === false &&
        result.discovery_named_data_layer === true)
  );

  assert("contract_names_real_data_layer", Boolean(result.contract_names_real_data_layer));
  assert("forbidden_imports_exact_match", result.forbidden_imports_exact_match !== false);
  assert("injection_caught", Boolean(result.injection_caught));
  assert("injection_evidence_correct", Boolean(result.injection_evidence_correct));

  // O-1: attribution. The finding's evidence must name the injected route itself, not an
  // intermediate/barrel file (the papermark barrel artifact is the canonical false pass:
  // on `pages/api/` repos a barrel beside a route is itself classified as a route, so a
  // finding attributed to it read as a catch). Both sides must be recorded strings.
  assert(
    "injection_attributed_to_injected_file",
    typeof result.injected_route === "string" &&
      result.injected_route.length > 0 &&
      result.injection_evidence_file === result.injected_route
  );

  // O-1: the check's process exit code. B-4's proof: at e0dc052 four repos' exit codes
  // changed 0 -> 3 and the suite printed ok for all 7, because the code was recorded but
  // never asserted. The expectation is per-repo data (REPOS[].expectedExitCode), not a
  // hardcode, so S1-01's transitional 3s are explicit and reviewable. A missing
  // expectation fails closed rather than skipping the assertion.
  assert("exit_code_expectation_recorded", Number.isInteger(cfg.expectedExitCode));
  assert(
    "check_exit_code_matches_expected",
    Number.isInteger(cfg.expectedExitCode) && result.check_exit_code === cfg.expectedExitCode
  );

  // E-1 (S1-02 / B-3): the payload's status must agree with the process exit code. Exit 3
  // alongside check_status "pass" was recorded on every baseline row - the exit code told
  // the truth and the JSON did not, and JSON consumers read check.status, not $?. The
  // mapping asserts on the MEASURED exit code (consistency between two recorded fields);
  // exit codes outside the check contract (e.g. 1, operational error) carry no status
  // expectation here because check_exit_code_matches_expected already fails them.
  const statusForExit = { 0: "pass", 2: "fail", 3: "refused" }[result.check_exit_code];
  assert(
    "check_status_consistent_with_exit",
    statusForExit === undefined || result.check_status === statusForExit
  );

  assert("no_clean_control_false_positive", !result.clean_control_false_positive);
  assert("no_type_only_false_positive", result.fp_type_only_import === false);
  // T101: a block-mode convention that does not block is an F3-class silent pass. Now that
  // enforcement is measured in isolation (see enforcementInIsolation) this is measurable,
  // so it is asserted rather than recorded. O-1: strictly `=== true` — `!== false` was a
  // recording idiom that let a null/absent measurement (enforcementInIsolation erroring or
  // finding nothing) read as agreement.
  assert("enforcement_matches_mode", result.enforcement_matches_mode === true);
  assert("no_lookalike_false_positive", result.fp_lookalike_module === false);
  assert("catches_genuine_subpath", result.catches_genuine_subpath === true);
  // BB-5: strictly `=== true`, following the enforcement_matches_mode lesson - `!== false` would
  // let an absent measurement read as agreement, which is how a silently-disabled property passes.
  // BB-8: cell liveness. A cell that reads 0 while a sibling machine-JSON field says there was
  // something to count is either a product regression or a dead measurement, and both must stop the
  // suite. This exists because the `baselined` cell died silently for a whole sprint: BB-3 reworded the
  // sentence its regex depended on, `?? 0` supplied a plausible zero, and the baseline was updated to
  // the corpse. Nothing failed, because nothing asserted the cell was still alive.
  //
  // `null` is explicitly not 0 here: it means acceptance did not happen, which is a legitimate state.
  assert(
    "baselined_cell_live",
    result.baselined === null ||
      result.baselined === undefined ||
      result.baselined > 0 ||
      !(result.findings_count > 0)
  );
  assert("exemplar_integrity", result.exemplar_integrity === true);
  // BB-6: strictly `=== true`, same reason - an absent measurement must not read as agreement.
  assert("guidance_within_budget", result.guidance_within_budget === true);
  assert("packet_within_envelope_budget", result.packet_within_envelope_budget === true);
  assert("engine_source_rust", result.engine_source === "rust");
  assert("no_fallback_used", result.fallback_used === false);

  return { status: failures.length ? "FAIL" : "PASS", failures };
}

/**
 * O-4 (1): merge a filtered run's rows into the existing baseline.
 *
 * `--only X --update` used to write ONLY the filtered repos' rows, silently destroying
 * every other row (verified live this run: 7 rows -> 1, exit 0). Rows for repos the run
 * did not touch are carried forward unchanged; row order follows the suite's repo order.
 */
export function mergeBaselineRows(existingRows, results, repoOrder) {
  const byRepo = new Map((existingRows ?? []).map((row) => [row.repo, row]));
  for (const row of results) byRepo.set(row.repo, row);
  return repoOrder.map((name) => byRepo.get(name)).filter(Boolean);
}

/**
 * O-4 (2), external-eval rows: the safety-relevant fields that may never silently move
 * in the weakening direction. Strengthening (0 -> 2, pass -> refused) is free; each
 * weakening returns the field name so the runner can demand
 * `--accept-regression <repo>:<field>` for it.
 */
export function unsafeBaselineMoves(before, after) {
  if (!before) return [];
  const moves = [];
  if (before.injection_caught === true && after.injection_caught !== true) {
    moves.push("injection_caught");
  }
  if (before.injection_enforcement === "block" && after.injection_enforcement !== "block") {
    moves.push("injection_enforcement");
  }
  if ((before.blocking_count ?? 0) > 0 && (after.blocking_count ?? 0) === 0) {
    moves.push("blocking_count");
  }
  if ((before.check_exit_code === 2 || before.check_exit_code === 3) && after.check_exit_code === 0) {
    moves.push("check_exit_code");
  }
  if (["fail", "refused"].includes(before.check_status) && after.check_status === "pass") {
    moves.push("check_status");
  }
  // W0: the envelope band may improve for free and may never silently worsen. Without this,
  // `--update` would happily record a packet that grew from 54% to 94% of budget - still
  // `packet_within_envelope_budget: true`, so no assertion fails, and the band delta would be
  // the only line in the diff naming it. That is the shape of the movement W7 had to
  // reconstruct by hand.
  const beforeBand = ENVELOPE_BAND_ORDER.indexOf(before.packet_budget_band);
  const afterBand = ENVELOPE_BAND_ORDER.indexOf(after.packet_budget_band);
  if (beforeBand >= 0 && afterBand > beforeBand) {
    moves.push("packet_budget_band");
  }
  return moves;
}

/**
 * O-4 (2), evasion shape cells: same idea per shape. Moves are prefixed with the shape
 * id (`S06-namespace-import.exit`), and the runner prefixes the repo.
 */
export function unsafeShapeMoves(before, after) {
  if (!before) return [];
  const moves = [];
  const name = (field) => `${after.id ?? before.id}.${field}`;
  if (before.caught === true && after.caught !== true) moves.push(name("caught"));
  if (before.known_evasion !== true && after.known_evasion === true) moves.push(name("known_evasion"));
  if ((before.exit === 2 || before.exit === 3) && after.exit === 0) moves.push(name("exit"));
  if (before.enforcement === "block" && after.enforcement !== "block") moves.push(name("enforcement"));
  if (["fail", "refused"].includes(before.check_status) && after.check_status === "pass") {
    moves.push(name("check_status"));
  }
  return moves;
}

/**
 * O-4 (2)+(3): the update gate. `--update` refuses (nonzero, NO write) when
 *  - any result carries a FAILING verdict ("baseline updated - 0/1 passing" exit 0 was
 *    the recorded bug), or
 *  - a safety-relevant field would move in the unsafe direction without an explicit
 *    `--accept-regression <repo>:<move>` naming that exact move.
 *
 * @param {object} input { results, baselineByRepo, acceptedRegressions: Set<string>,
 *                         unsafeMovesFor(before, after): string[] }
 * @returns {{ ok: boolean, refusals: string[] }}
 */
export function updateGate({ results, baselineByRepo, acceptedRegressions, unsafeMovesFor }) {
  const refusals = [];
  for (const row of results) {
    if (row.status !== "PASS" && row.status !== undefined) {
      refusals.push(
        `${row.repo}: verdict is ${row.status}` +
          (row.failed_assertions ? ` (${row.failed_assertions.join(", ")})` : "") +
          " - a failing run cannot be pinned as the expected baseline; fix the behaviour or the recorded expectation first"
      );
      continue;
    }
    for (const move of unsafeMovesFor(baselineByRepo.get(row.repo), row)) {
      const key = `${row.repo}:${move}`;
      if (!acceptedRegressions.has(key)) {
        refusals.push(
          `${row.repo}: ${move} would move in the unsafe direction; re-run with --accept-regression ${key} to record it deliberately`
        );
      }
    }
  }
  return { ok: refusals.length === 0, refusals };
}

/**
 * O-3: the evasion matrix's per-shape verdict.
 *
 * Same hardened semantics as repoVerdict - exit code, enforcement-vs-mode, attribution -
 * plus the two pins this run's discoveries added:
 *
 *  (a) attribution checks EVERY finding on the injected paths, not just the first: each
 *      one's leading evidence must name the injected route itself, so a second finding
 *      attributed to an intermediate barrel fails the shape;
 *  (b) split scenario semantics: the blocking scenario (real violation alone) must exit
 *      2 on block-mode repos, and the refusal scenario (non-existent decoy) must exit 3
 *      with blocked_reasons naming the decoy.
 *
 * Outcome classes a catch shape may legitimately land in are pinned by the committed
 * baseline (evasion-baseline.json), not hardcoded here: blocked (exit 2), warned
 * (exit 0 + enforcement warn), refused (exit 3, fail-closed). What is hardcoded is what
 * may NEVER happen: a caught violation exiting 0 under a block-mode convention (the
 * exit-0-with-demotion class G1 forbids), a mis-attributed finding, a negative control
 * producing a finding, and a payload status contradicting the exit code. An evasion that
 * still exists is tolerated only when the baseline records it (`known_evasion: true`) -
 * KNOWN_EVASION, never PASS - so progress and regression are both pinned.
 *
 * @param {object} record  the per-shape record built by the evasion runner
 * @param {object} context { shapeClass: "catch"|"silent"|"observe"|"refuse",
 *                           enforcementMode, isBlockingScenario, knownEvasion }
 * @returns {{ status: "PASS" | "FAIL" | "KNOWN_EVASION", failures: string[] }}
 */
export function shapeVerdict(record, context) {
  const failures = [];
  const assert = (name, ok) => {
    if (!ok) failures.push(name);
  };

  // E-1 (B-3): the payload's status must agree with the process exit code, on every
  // shape. Exit codes outside the check contract (e.g. 1) fail the shape outright.
  const statusForExit = { 0: "pass", 2: "fail", 3: "refused" }[record.exit];
  assert("check_exit_code_in_contract", statusForExit !== undefined);
  assert(
    "check_status_consistent_with_exit",
    statusForExit === undefined || record.check_status === statusForExit
  );

  if (context.shapeClass === "silent") {
    // Negative controls prove restraint. A finding here is a false positive regardless
    // of anything else the check did.
    assert("negative_control_silent", record.caught === false && record.findings_count === 0);
    return { status: failures.length ? "FAIL" : "PASS", failures };
  }

  if (context.shapeClass === "refuse") {
    // Pin (b), refusal half: a deliberately non-existent decoy must produce a fail-closed
    // refusal that names the decoy - never a block (claiming to enforce the unresolvable)
    // and never a pass (the silent path S1-01 closed).
    assert("refusal_exits_3", record.exit === 3);
    assert("refusal_names_decoy", record.refusal_names_decoy === true);
    return { status: failures.length ? "FAIL" : "PASS", failures };
  }

  if (context.shapeClass === "observe") {
    // Recorded and baseline-pinned, no class-level expectation.
    return { status: failures.length ? "FAIL" : "PASS", failures };
  }

  // shapeClass "catch"
  if (record.caught) {
    // Pin (a): every finding on the injected paths must lead with evidence naming the
    // injected route itself. attributed_files collects evidence_refs[0].file_path of
    // EVERY such finding, so a second barrel-attributed finding fails here.
    assert(
      "every_finding_attributed_to_route",
      Array.isArray(record.attributed_files) &&
        record.attributed_files.length > 0 &&
        record.attributed_files.every((filePath) => filePath === record.route)
    );
    // The core invariant, shape-level: no path from "a violation was found" to exit 0
    // under a block-mode convention.
    assert(
      "caught_block_mode_cannot_exit_zero",
      !(context.enforcementMode === "block" && record.exit === 0)
    );
    if (record.exit === 0) {
      // A catch that passes (warn-mode repo) must carry the mode, strictly - null was
      // the recording idiom O-1 killed.
      assert("enforcement_matches_mode", record.enforcement === context.enforcementMode);
    }
    if (record.exit === 2) {
      assert(
        "blocked_only_under_block_mode",
        context.enforcementMode === "block" && record.enforcement === "block"
      );
    }
    // exit 3 (refused) is a legitimate fail-closed landing for a catch shape; the
    // baseline pins which cells live there.
  } else if (context.knownEvasion) {
    return { status: failures.length ? "FAIL" : "KNOWN_EVASION", failures };
  } else {
    assert("should_catch_shape_evaded", false);
  }

  if (context.isBlockingScenario && context.enforcementMode === "block") {
    // Pin (b), blocking half: the real violation ALONE must block on block-mode repos.
    assert("blocking_scenario_blocks", record.exit === 2);
  }

  return { status: failures.length ? "FAIL" : "PASS", failures };
}
