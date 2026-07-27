use drift_engine::{
    DiffScope, DiffStatus, EnforcementResult, RuleFinding, Severity,
    classify_findings_against_diff, parse_unified_diff,
};

fn finding(file_path: &str, line: usize) -> RuleFinding {
    RuleFinding {
        convention_id: "convention_no_direct_data_access".to_string(),
        fingerprint: format!("fingerprint:{file_path}:{line}"),
        title: "API route imports data access directly".to_string(),
        message: "message".to_string(),
        severity: Severity::Error,
        enforcement_result: EnforcementResult::Block,
        file_path: file_path.to_string(),
        import_name: "prisma".to_string(),
        import_source: "@/lib/prisma".to_string(),
        line,
    }
}

#[test]
fn parses_changed_lines_from_unified_git_diff() {
    let diff = r#"diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts
index 1111111..2222222 100644
--- a/apps/web/app/api/users/route.ts
+++ b/apps/web/app/api/users/route.ts
@@ -1,3 +1,5 @@
 import { auth } from "@/auth";
+import { prisma } from "@/lib/prisma";
+
 export async function POST() {
   return Response.json({});
 }
"#;

    let parsed = parse_unified_diff(diff);

    assert_eq!(parsed.files.len(), 1);
    assert_eq!(parsed.files[0].path, "apps/web/app/api/users/route.ts");
    assert_eq!(parsed.files[0].changed_lines, vec![2, 3]);
}

#[test]
fn changed_hunk_scope_marks_only_findings_on_added_lines() {
    let diff = r#"diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts
--- a/apps/web/app/api/users/route.ts
+++ b/apps/web/app/api/users/route.ts
@@ -1,3 +1,4 @@
+import { prisma } from "@/lib/prisma";
 import { auth } from "@/auth";
 export async function POST() {}
"#;
    let parsed = parse_unified_diff(diff);

    let classified = classify_findings_against_diff(
        vec![
            finding("apps/web/app/api/users/route.ts", 1),
            finding("apps/web/app/api/users/route.ts", 2),
            finding("apps/web/app/api/workspaces/route.ts", 1),
        ],
        &parsed,
        DiffScope::ChangedHunks,
    );

    assert_eq!(classified[0].diff_status, DiffStatus::NewInDiff);
    assert_eq!(classified[1].diff_status, DiffStatus::TouchedExisting);
    assert_eq!(classified[2].diff_status, DiffStatus::OutsideDiff);
}

#[test]
fn changed_files_scope_marks_any_finding_in_changed_file_as_touched_existing() {
    let diff = r#"diff --git a/apps/web/app/api/users/route.ts b/apps/web/app/api/users/route.ts
--- a/apps/web/app/api/users/route.ts
+++ b/apps/web/app/api/users/route.ts
@@ -10,2 +10,3 @@
+const touched = true;
"#;
    let parsed = parse_unified_diff(diff);

    let classified = classify_findings_against_diff(
        vec![
            finding("apps/web/app/api/users/route.ts", 42),
            finding("apps/web/app/api/workspaces/route.ts", 1),
        ],
        &parsed,
        DiffScope::ChangedFiles,
    );

    assert_eq!(classified[0].diff_status, DiffStatus::TouchedExisting);
    assert_eq!(classified[1].diff_status, DiffStatus::OutsideDiff);
}

#[test]
fn full_scope_marks_all_findings_as_touched_existing() {
    let classified = classify_findings_against_diff(
        vec![finding("apps/web/app/api/users/route.ts", 42)],
        &parse_unified_diff(""),
        DiffScope::Full,
    );

    assert_eq!(classified[0].diff_status, DiffStatus::TouchedExisting);
}
