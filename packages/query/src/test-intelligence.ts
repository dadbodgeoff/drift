import type { TestIntelligence } from "@drift/core";

export interface SelectRelevantTestsInput {
  changed_file: string;
  route_flow?: {
    route?: string;
    service_file?: string;
  };
  test_files: string[];
}

export interface RelevantTestsSelection {
  closest_tests: string[];
  missing_test_candidate: boolean;
  required_check_hint: string;
  test_intelligence: TestIntelligence[];
}

export function selectRelevantTests(input: SelectRelevantTestsInput): RelevantTestsSelection {
  const subjects = [
    input.changed_file,
    input.route_flow?.route,
    input.route_flow?.service_file
  ].filter((value): value is string => Boolean(value));
  const closestTests = input.test_files.filter((testFile) =>
    subjects.some((subject) => matchesSubject(testFile, subject))
  ).sort((left, right) => left.localeCompare(right));
  const slug = subjects.map(subjectSlug).find(Boolean) ?? "changed";

  return {
    closest_tests: closestTests,
    missing_test_candidate: closestTests.length === 0,
    required_check_hint: `npm test -- ${slug}`,
    test_intelligence: closestTests.map((testFile) => ({
      schema_version: "drift.test_intelligence.v1",
      test_subject: input.changed_file,
      test_type: testFile.includes("/api/") ? "integration" : "unit",
      test_framework: testFile.includes(".spec.") || testFile.includes(".test.") ? "vitest" : "unknown",
      test_file_for: subjects,
      covered_symbols: [],
      covered_routes: input.route_flow?.route ? [input.route_flow.route] : [],
      mocked_dependencies: [],
      fixture_usage: [],
      snapshot_usage: false,
      missing_test_candidate: false,
      stale_test_candidate: false
    }))
  };
}

function matchesSubject(testFile: string, subject: string): boolean {
  const testSlug = subjectSlug(testFile);
  const targetSlug = subjectSlug(subject);
  return Boolean(testSlug && targetSlug && testSlug.includes(targetSlug));
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
