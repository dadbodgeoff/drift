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

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  /**
   * Where to read the MATCHED test files from, for the three fields that are answerable only from
   * a test's own source. Optional, and its absence is reported rather than papered over: without
   * it `snapshot_usage`, `mocked_dependencies` and `fixture_usage` are `null` - "not looked at" -
   * instead of the `false`/`[]` that reads as "looked, and no".
   *
   * Reading lives here rather than in the two callers because that is the W6 shape: a derivation
   * both surfaces need, kept in one place so `prepare` and `get_task_preflight` cannot come to
   * different conclusions about the same file. Only MATCHED tests are read, so the cost is bounded
   * by the size of the answer rather than by the size of the repo.
   */
  repo_root?: string;
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
    test_intelligence: matches.map((entry) => {
      const evidence = readTestFileEvidence(input.repo_root, entry.testFile);
      return {
        schema_version: "drift.test_intelligence.v2",
        test_subject: entry.subject,
        test_type: entry.testFile.includes("/api/") ? "integration" : "unit",
        test_framework:
          entry.testFile.includes(".spec.") || entry.testFile.includes(".test.") ? "vitest" : "unknown",
        test_file_for: subjects,
        covered_routes: input.route_flow?.route ? [input.route_flow.route] : [],
        // Read from the test's own source. `null` when there was no source to read - see
        // TestFileEvidence for why that is a value and not a failure.
        snapshot_usage: evidence?.snapshot_usage ?? null,
        mocked_dependencies: evidence?.mocked_dependencies ?? null,
        fixture_usage: evidence?.fixture_usage ?? null,
        // NOT computed, and recorded as such in scripts/payload-invariants-baseline.json rather
        // than presented as a measurement. `covered_symbols` needs the test's call sites resolved
        // against the symbol graph, which is engine work; `stale_test_candidate` needs a stated
        // definition of stale-relative-to-what before it can have an implementation.
        covered_symbols: [],
        stale_test_candidate: false
      };
    }),
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

/**
 * What a test file says about itself, read from the test file.
 *
 * `null` rather than a zero value when there is nothing to read - no `repo_root`, or a path that
 * no longer resolves because the scan is stale and the file is gone. That distinction is the whole
 * point of this change: `snapshot_usage: false` reads to an agent as "checked, and this test has no
 * snapshot", which is a confident answer to give from a field that never opened the file. `null`
 * says "not looked at", and an agent deciding whether its edit breaks a snapshot can tell the two
 * apart.
 */
interface TestFileEvidence {
  snapshot_usage: boolean;
  mocked_dependencies: string[];
  fixture_usage: string[];
}

/**
 * `expect(x).toMatchSnapshot()` and its inline/file variants, or a reference to a checked-in
 * `.snap`. Deliberately a source scan and not a parse: the question is whether this test asserts
 * against a stored snapshot, and the call by name answers it.
 */
const SNAPSHOT_ASSERTION = /\btoMatch(?:Inline|File)?Snapshot\s*\(|\.snap\b/;

/** `vi.mock("x")` / `jest.mock('x')`, and the non-hoisted `doMock` forms of both. */
const MOCK_CALL = /\b(?:vi|jest)\.(?:do)?[Mm]ock\s*\(\s*["'`]([^"'`]+)["'`]/g;

/** Every `import ... from "x"`, bare `import "x"` and `require("x")` specifier. */
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`]([^"'`]+)["'`]/g;

/**
 * Which of those specifiers is a fixture. Stated as a rule rather than guessed at, because a field
 * named `fixture_usage` that answers a question nobody wrote down is the defect one level up: a
 * `__fixtures__` or `fixtures` path segment, or a `.fixture`/`.fixtures` filename suffix.
 *
 * The suffix has to admit end-of-string, not just `.fixture.`: an import specifier carries no
 * extension, so `./users.fixture` is how the common case actually appears and a rule written for
 * `users.fixture.ts` misses every one of them.
 */
const FIXTURE_SPECIFIER = /(^|\/)(__fixtures__|fixtures)(\/|$)|\.fixtures?(\.|\/|$)/;

function readTestFileEvidence(
  repoRoot: string | undefined,
  testFile: string
): TestFileEvidence | null {
  if (!repoRoot) return null;
  let source: string;
  try {
    source = readFileSync(join(repoRoot, testFile), "utf8");
  } catch {
    return null;
  }
  return {
    snapshot_usage: SNAPSHOT_ASSERTION.test(source),
    mocked_dependencies: sortedUnique(captured(source, MOCK_CALL)),
    fixture_usage: sortedUnique(
      captured(source, IMPORT_SPECIFIER).filter((specifier) => FIXTURE_SPECIFIER.test(specifier))
    )
  };
}

function captured(source: string, pattern: RegExp): string[] {
  // A fresh RegExp per call: these are module-level and `g` makes `lastIndex` stateful, so sharing
  // one across two files would start the second scan wherever the first one stopped.
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => match[1]);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
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
