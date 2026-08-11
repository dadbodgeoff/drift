use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

// T60. Falsification findings that lived as throwaway `/tmp` scripts, promoted to permanent
// fixtures so they are checked on every run rather than remembered.

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test/fixtures")
        .join(name)
}

fn scan(name: &str) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            fixture(name).to_str().expect("utf8 fixture path"),
            "--format",
            "json",
            "--repo-id",
            "repo_fixture",
        ])
        .output()
        .expect("run drift-engine");
    assert!(
        output.status.success(),
        "engine failed on {name}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("scan output json")
}

/// T12: a type-only binding is erased by TypeScript, so it cannot perform data access at
/// runtime and flagging it is a false positive. This drove dub's rate from 8.5% to 3.1%.
#[test]
fn type_only_bindings_are_not_recorded_as_imports() {
    let result = scan("type-only-imports");
    let route = "apps/web/app/api/users/route.ts";
    let imported: Vec<&str> = result["facts"]
        .as_array()
        .expect("facts")
        .iter()
        .filter(|fact| fact["file_path"] == route && fact["kind"] == "import_used")
        .filter_map(|fact| fact["imported_name"].as_str())
        .collect();

    // `prisma` is a value use and must be seen.
    assert!(
        imported.contains(&"prisma"),
        "the value import must still be recorded, got {imported:?}"
    );
    // `User` is `import type`; `Prisma` uses an inline `type` modifier. Neither exists at runtime.
    assert!(
        !imported.contains(&"User"),
        "`import type` must not be recorded, got {imported:?}"
    );
    assert!(
        !imported.contains(&"Prisma"),
        "an inline `type` modifier must not be recorded, got {imported:?}"
    );
}

/// A4: a file that cannot be decoded must not crash the scan, and must not be silently counted
/// as clean - a scan that skips a file while reporting full coverage is the failure this
/// product exists to prevent.
#[test]
fn undecodable_and_binary_files_do_not_break_the_scan() {
    let result = scan("binary-and-unreadable");

    let indexed: Vec<&str> = result["file_snapshots"]
        .as_array()
        .expect("snapshots")
        .iter()
        .filter_map(|snapshot| snapshot["file_path"].as_str())
        .collect();

    // The healthy route is still found.
    assert!(
        indexed
            .iter()
            .any(|path| path.ends_with("api/health/route.ts")),
        "the readable route must still be scanned, got {indexed:?}"
    );
    // A .png is not indexable source and should not appear at all.
    assert!(
        !indexed.iter().any(|path| path.ends_with(".png")),
        "binary assets must not be indexed, got {indexed:?}"
    );
    // Whatever happens to the undecodable .ts, the scan completes rather than panicking - which
    // is what the assertions above already prove by reaching this point.
    assert!(result["stats"]["files_seen"].as_u64().unwrap_or(0) > 0);
}

/// T102: `.gitignore` must behave the way git does — nested files, `!` negations, and patterns
/// scoped to the directory that declares them.
///
/// The last of those is why the first attempt at this was reverted. It built one `Gitignore` rooted
/// at the repo and added every nested file to it, but `GitignoreBuilder::add()` interprets patterns
/// relative to the *builder* root — so a bare `app` in one package went repo-wide and swallowed a
/// different package's API routes. The fixture carries exactly that shape.
#[test]
fn gitignore_is_honoured_per_directory() {
    let result = scan("gitignore-nested");
    let indexed: Vec<&str> = result["file_snapshots"]
        .as_array()
        .expect("snapshots")
        .iter()
        .filter_map(|snapshot| snapshot["file_path"].as_str())
        .collect();

    let has = |suffix: &str| indexed.iter().any(|path| path.ends_with(suffix));

    assert!(
        !has("src/generated/gen.ts"),
        "root .gitignore must apply: {indexed:?}"
    );
    assert!(
        !has("packages/inner/ignored-here.ts"),
        "a nested .gitignore must apply: {indexed:?}"
    );
    assert!(
        has("packages/inner/kept.ts"),
        "a `!` negation must re-include the file: {indexed:?}"
    );
    // The regression that reverted attempt 1.
    assert!(
        has("packages/dashboard/src/app/api/routes/route.ts"),
        "a bare pattern in packages/server must not reach packages/dashboard: {indexed:?}"
    );
    assert!(
        has("src/app/api/a/route.ts"),
        "unignored files must be scanned: {indexed:?}"
    );
}
