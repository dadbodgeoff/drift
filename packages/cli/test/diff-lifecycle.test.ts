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

  /**
   * R2a: the PURE rename - `git mv` with no edit - which the cases above do not reach.
   *
   * At 100% similarity git emits rename metadata and *no* `---`/`+++`/`@@` at all, so the parser
   * produced no file entry and the moved file left the convention's scope entirely:
   * `filesForConvention` maps over `diff.files`, and `diffStatusFor` looks the path up in the same
   * array. A violating route that was merely renamed was therefore not examined, and the check
   * reported clean.
   *
   * That is an enforcement bypass reachable from the documented workflow, because
   * `git diff --unified=0 <range>` (run-check.ts:495) has rename detection on by default. Verified
   * against real git output, not a hand-written patch:
   *
   *   $ git mv app/api/x/route.ts app/api/x/handler.ts && git diff --cached --unified=0
   *   diff --git a/app/api/x/route.ts b/app/api/x/handler.ts
   *   similarity index 100%
   *   rename from app/api/x/route.ts
   *   rename to app/api/x/handler.ts
   *
   * The moved file must be IN scope. It must NOT become `new_in_diff`: the content is unchanged, so
   * treating the move as newly-written code would convert baselined debt into blocking findings -
   * the same punishment-for-refactoring this describe block exists to prevent.
   */
  const pureRename = parseUnifiedDiff(
    [
      "diff --git a/app/api/x/route.ts b/app/api/x/handler.ts",
      "similarity index 100%",
      "rename from app/api/x/route.ts",
      "rename to app/api/x/handler.ts"
    ].join("\n")
  );

  it("puts a purely renamed file in scope at its new path", () => {
    expect(pureRename.renamedFiles).toEqual(["app/api/x/handler.ts"]);
    expect(pureRename.files.map((file) => file.path)).toContain("app/api/x/handler.ts");
  });

  it("does not let a purely renamed file escape the diff", () => {
    // Was "outside_diff" in both modes, which is what made the route invisible.
    expect(diffStatusFor("app/api/x/handler.ts", 2, pureRename, "changed-files")).toBe(
      "touched_existing"
    );
    expect(diffStatusFor("app/api/x/handler.ts", 2, pureRename, "changed-hunks")).toBe(
      "touched_existing"
    );
  });

  it("does not treat the move itself as newly written code", () => {
    const [file] = pureRename.files;
    expect(file?.isAdded).toBe(false);
    expect(file?.changedLines.size).toBe(0);
  });

  it("leaves the old path out of scope", () => {
    // The pre-rename path no longer exists in the worktree; scanning it would report on a file
    // that is not there (the BB-9 shape, run-check.ts:459-473).
    expect(pureRename.files.map((file) => file.path)).not.toContain("app/api/x/route.ts");
    expect(diffStatusFor("app/api/x/route.ts", 2, pureRename, "changed-files")).toBe("outside_diff");
  });

  it("does not double-count a rename that also carries an edit", () => {
    // renameWithEdit already enters `files` through its `+++` header. Adding rename metadata on
    // top of that must not produce two entries for one file.
    expect(renameWithEdit.files.filter((file) => file.path === "app/api/me2/route.ts")).toHaveLength(
      1
    );
    // And the edit's changed line must survive: this is the regression that would turn
    // "still reports a genuinely new violation inside a moved file" green for the wrong reason.
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
