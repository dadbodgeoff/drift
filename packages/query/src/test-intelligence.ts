/**
 * Which existing tests cover a change, and - when none do - why not.
 *
 * W4/D-A3. Three defects, all of which made the answer look the same as a correct one:
 *
 *   (a) selection saw ONE file. Both surfaces called this with
 *       `changed_file: relevantFiles[0]?.path`, and `relevantFiles` is ranked and then
 *       truncated, so on midday's "update the onboarding email template" the directly relevant
 *       test sat behind a file at index 0 that had none, and was never considered. The input is
 *       `changed_files` now: the whole set both surfaces had already computed and were
 *       discarding all but the head of.
 *
 *   (b) the matcher was a raw basename-slug `.includes()`, so `lib/utils/formatCurrency.ts`
 *       against `lib/utils/__tests__/format-currency.test.ts` returned []. camelCase in the
 *       source and kebab-case in the test file is an ordinary convention pair, and it defeated
 *       the match completely. Slugs are now compared with case and separators removed.
 *
 *   (c) `test_intelligence_reason` was `"not_implemented_for_repo"` whenever the list was
 *       empty, written as an inline ternary in BOTH surfaces. taxonomy (0 test files, so
 *       legitimately nothing to find) and midday (86 test files, one directly relevant, missed
 *       by (a)) emitted the byte-identical string, and an agent reading it cannot tell "this
 *       repo has no tests" from "the matcher missed them" - which call for opposite responses.
 *       The reason is computed HERE, where the inputs that distinguish the two cases exist, so
 *       there is one of it and it cannot disagree with the list it explains. The old value was
 *       also just false: the feature is implemented for every repo.
 *
 *       It was an expression rather than a function, which is why W6's duplicate gate did not
 *       collapse it - that gate indexes function bodies. Worth recording as a known limit of it.
 */

import type { TestIntelligence } from "@drift/core";

export interface SelectRelevantTestsInput {
  /**
   * Every file the change touches, not just the first. A caller passing one file is asking
   * "does some test mention THIS file", which is a weaker question than the one this answers.
   */
  changed_files: string[];
  route_flow?: {
    route?: string;
    service_file?: string;
  };
  test_files: string[];
}

/**
 * Why `test_intelligence` is empty, when it is. Never a bare `[]` - the EW-3 lesson - and these
 * two values are the distinction D-A3 collapsed into one string.
 */
export type TestIntelligenceReason =
  /** The repo has no test files at all. Nothing was missed; there is nothing to find. */
  | "no_test_files_in_repo"
  /** The repo HAS tests and none matched this change. A reader should go looking. */
  | "no_tests_matched_change";

export interface RelevantTestsSelection {
  closest_tests: string[];
  missing_test_candidate: boolean;
  required_check_hint: string;
  test_intelligence: TestIntelligence[];
  test_intelligence_reason: TestIntelligenceReason | null;
}

export function selectRelevantTests(input: SelectRelevantTestsInput): RelevantTestsSelection {
  const subjects = [
    ...input.changed_files,
    input.route_flow?.route,
    input.route_flow?.service_file
  ].filter((value): value is string => Boolean(value));

  // Which subject each matching test covers, so `test_subject` names the file the test is
  // actually about rather than whichever file happened to rank first.
  const matches = input.test_files
    .map((testFile) => ({
      testFile,
      subject: subjects.find((subject) => matchesSubject(testFile, subject))
    }))
    .filter((entry): entry is { testFile: string; subject: string } => Boolean(entry.subject))
    .sort((left, right) => left.testFile.localeCompare(right.testFile));

  const slug = subjects.map(subjectSlug).find(Boolean) ?? "changed";

  return {
    closest_tests: matches.map((entry) => entry.testFile),
    missing_test_candidate: matches.length === 0,
    required_check_hint: `npm test -- ${slug}`,
    test_intelligence: matches.map((entry) => ({
      schema_version: "drift.test_intelligence.v1",
      test_subject: entry.subject,
      test_type: entry.testFile.includes("/api/") ? "integration" : "unit",
      test_framework:
        entry.testFile.includes(".spec.") || entry.testFile.includes(".test.") ? "vitest" : "unknown",
      test_file_for: subjects,
      covered_symbols: [],
      covered_routes: input.route_flow?.route ? [input.route_flow.route] : [],
      mocked_dependencies: [],
      fixture_usage: [],
      snapshot_usage: false,
      missing_test_candidate: false,
      stale_test_candidate: false
    })),
    // (c): derived from the inputs that tell the two cases apart, rather than from the emptiness
    // of the output - which is the one thing both cases have in common.
    test_intelligence_reason:
      matches.length > 0
        ? null
        : input.test_files.length === 0
          ? "no_test_files_in_repo"
          : "no_tests_matched_change"
  };
}

function matchesSubject(testFile: string, subject: string): boolean {
  const testSlug = comparableSlug(subjectSlug(testFile));
  const targetSlug = comparableSlug(subjectSlug(subject));
  return Boolean(testSlug && targetSlug && testSlug.includes(targetSlug));
}

/**
 * (b): case and separators removed, so `formatCurrency` and `format-currency` are the same name.
 * Not a fuzzy match - every character must still be present, in order.
 */
function comparableSlug(slug: string): string {
  return slug.toLowerCase().replaceAll(/[-_.]/g, "");
}

function subjectSlug(subject: string): string {
  if (subject.startsWith("GET ") || subject.startsWith("POST ")) {
    return subject.split("/").filter(Boolean).pop() ?? "";
  }
  const parts = subject.split("/").filter(Boolean);
  const basename = parts.at(-1) ?? "";
  const slug = basename.replace(/\.(test|spec)?\.?[tj]sx?$/, "");
  if (slug === "route" || slug === "") {
    return parts.at(-2) ?? "";
  }
  return slug;
}
