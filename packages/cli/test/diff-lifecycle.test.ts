import { describe, expect, it } from "vitest";
import { diffStatusFor, parseUnifiedDiff } from "../src/check/diff.js";

/**
 * T20/T21. File lifecycle events in a diff, which A5 made consequential: once new violations
 * block, the difference between "this is new code" and "this is pre-existing code that moved"
 * decides whether a refactor is punished.
 *
 * The concern going in was that a git rename presents as delete+add, so moving a legacy
 * violating route would newly block it. It does not: git reports renames as renames, and the
 * violating line is not a changed line, so the finding stays `touched_existing` and warns.
 * These cases pin that, because the behaviour is currently correct for a reason that is easy
 * to break - it depends on how the diff is parsed, not on an explicit rename rule.
 */

describe("added files", () => {
  it("marks a file added when the old path is /dev/null", () => {
    const diff = parseUnifiedDiff(
      [
        "diff --git a/app/api/new/route.ts b/app/api/new/route.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/app/api/new/route.ts",
        "@@ -0,0 +1,2 @@",
        '+import { db } from "@/lib/db";',
        "+export async function GET() {}"
      ].join("\n")
    );
    const [file] = diff.files;
    expect(file?.isAdded).toBe(true);
    // Every line of an added file is new code, in every scope mode (F7).
    expect(diffStatusFor("app/api/new/route.ts", 1, diff, "changed-files")).toBe("new_in_diff");
    expect(diffStatusFor("app/api/new/route.ts", 1, diff, "changed-hunks")).toBe("new_in_diff");
  });
});

describe("renamed files", () => {
  // git emits a rename with both paths present, so the new path is not an addition. A
  // pre-existing violation that moved must not be treated as newly written code.
  const renameWithEdit = parseUnifiedDiff(
    [
      "diff --git a/app/api/me/route.ts b/app/api/me2/route.ts",
      "similarity index 96%",
      "rename from app/api/me/route.ts",
      "rename to app/api/me2/route.ts",
      "--- a/app/api/me/route.ts",
      "+++ b/app/api/me2/route.ts",
      "@@ -8,0 +9,1 @@",
      "+// refactor touch"
    ].join("\n")
  );

  it("does not treat a renamed file as added", () => {
    expect(renameWithEdit.files[0]?.path).toBe("app/api/me2/route.ts");
    expect(renameWithEdit.files[0]?.isAdded).toBe(false);
  });

  it("keeps a moved pre-existing violation out of the blocking set", () => {
    // The violating import sits at line 2; the refactor touched line 9. Moving code must not
    // convert old debt into a new violation.
    expect(diffStatusFor("app/api/me2/route.ts", 2, renameWithEdit, "changed-hunks")).toBe(
      "touched_existing"
    );
  });

  it("still reports a genuinely new violation inside a moved file", () => {
    // Line 9 *was* changed, so a violation written there is new code and should block.
    expect(diffStatusFor("app/api/me2/route.ts", 9, renameWithEdit, "changed-hunks")).toBe(
      "new_in_diff"
    );
  });
});

describe("deleted files", () => {
  it("records the deleted path and produces no file entry to scan", () => {
    const diff = parseUnifiedDiff(
      [
        "diff --git a/app/api/gone/route.ts b/app/api/gone/route.ts",
        "deleted file mode 100644",
        "--- a/app/api/gone/route.ts",
        "+++ /dev/null",
        "@@ -1,2 +0,0 @@",
        '-import { db } from "@/lib/db";',
        "-export async function GET() {}"
      ].join("\n")
    );
    expect(diff.deletedFiles).toEqual(["app/api/gone/route.ts"]);
    expect(diff.files.map((file) => file.path)).not.toContain("app/api/gone/route.ts");
    // Nothing to classify: removing a violation must not leave an orphaned finding.
    expect(diffStatusFor("app/api/gone/route.ts", 1, diff, "changed-files")).toBe("outside_diff");
  });
});
