/**
 * The external eval suite's per-repo PASS predicate, extracted so the harness's own
 * test suite can drive it with synthetic results (S1-03 / O-1).
 *
 * Every assertion is named; a FAIL verdict carries the names of the assertions that
 * failed, which the runner prints and records.
 */

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
  assert("engine_source_rust", result.engine_source === "rust");
  assert("no_fallback_used", result.fallback_used === false);

  return { status: failures.length ? "FAIL" : "PASS", failures };
}
