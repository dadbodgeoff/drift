//! Fixes of review R3 to the security inventory and its baseline (F3).
//!
//! - An upgrade fails no one's CI: a baseline written by an older Drift (no
//!   `# inventory:` line) does not hold what a reading widened since finds, so a
//!   finding of such a kind is listed, once said to come from a newer reading, and
//!   fails nothing until the baseline is written again. Before, `drift check` exited
//!   1 on the day of the upgrade with no change to the code.
//! - A baseline written now fails on a genuinely new finding, as before.
//! - `app.use("/orgs/:id", loadOrg())` is a mount, never an `ALL` entry point:
//!   before, a middleware factory under a parameterised prefix read as an
//!   unguarded route.

use std::fs;
use std::path::Path;
use std::process::Command;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

const PKG: &str = r#"{ "name": "shop", "dependencies": { "express": "4.19.2" } }"#;

/// An Express app with one route where Drift finds no guard.
fn server(extra: &str) -> String {
    format!(
        r#"import express from "express";
const app = express();
app.get("/open", (req: any, res: any) => {{
  res.json({{ ok: true }});
}});
{extra}app.listen(3000);
"#
    )
}

/// The baseline as the release before this one wrote it: no stamp, no `# fail:`
/// line, and none of the rows of `kinds` (what that release's narrower reading
/// did not find).
fn as_older_release(lock: &str, kinds: &[&str]) -> String {
    lock.lines()
        .filter(|l| !l.starts_with("# inventory:") && !l.starts_with("# fail:"))
        .filter(|l| !kinds.iter().any(|k| l.starts_with(&format!("{k}\t"))))
        .map(|l| format!("{l}\n"))
        .collect()
}

#[test]
fn an_older_baseline_lists_what_a_wider_reading_finds_and_fails_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", PKG);
    write(r, "server.ts", &server(""));
    write(r, ".gitignore", ".drift/cache/\n");
    let _ = drift(r, &["init"]);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    assert!(
        lock.contains("no-guard\tserver.ts#GET /open GET /open\n"),
        "{lock}"
    );

    // The day of the upgrade: the committed baseline is the older release's, which
    // did not find this row; the code did not change.
    fs::write(
        r.join(".drift/security.lock"),
        as_older_release(&lock, &["no-guard", "unguarded-reaching"]),
    )
    .unwrap();
    let (code, out, err) = drift(r, &["check"]);
    assert_eq!(code, 0, "{out}{err}");
    assert!(
        out.contains("finding(s) come from readings newer than this baseline; they are listed and do not fail the check; write the baseline again to start checking them: `drift security --write-baseline`"),
        "{out}"
    );
    assert!(
        out.contains("  server.ts#GET /open GET /open  (server.ts:"),
        "{out}"
    );
    // Said once.
    assert_eq!(
        out.matches("readings newer than this baseline").count(),
        1,
        "{out}"
    );
    // F10 (review R10 F-6): and where to read what changed. Before, nothing in
    // `drift check` named `drift upgrade`.
    assert!(out.contains("drift: `drift upgrade` shows what this Drift reads differently from the one that wrote these files; it changes nothing by itself"), "{out}");
    let (code, out, _) = drift(r, &["security", "--ratchet"]);
    assert_eq!(code, 0, "{out}");
    let (code, json, _) = drift(r, &["check", "--format", "json"]);
    assert_eq!(code, 0, "{json}");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(
        v["security"]["new_in_drift"]["no-guard"].is_array(),
        "{v:#}"
    );
    assert_eq!(v["security"]["added"], serde_json::json!({}), "{v:#}");
}

#[test]
fn a_baseline_written_now_fails_on_a_new_finding() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", PKG);
    write(r, "server.ts", &server(""));
    write(r, ".gitignore", ".drift/cache/\n");
    let _ = drift(r, &["init"]);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let (code, out, _) = drift(r, &["check"]);
    assert_eq!(code, 0, "{out}");

    write(
        r,
        "server.ts",
        &server("app.get(\"/more\", (req: any, res: any) => {\n  res.json({ ok: true });\n});\n"),
    );
    let (code, out, _) = drift(r, &["check"]);
    assert_eq!(code, 1, "{out}");
    assert!(
        out.contains("[no-guard]\n  server.ts#GET /more GET /more  (server.ts:"),
        "{out}"
    );
    assert!(!out.contains("readings newer than this baseline"), "{out}");
    assert!(!out.contains("`drift upgrade` shows"), "{out}");
}

#[test]
fn a_factory_used_under_a_parameterised_prefix_is_a_mount_not_a_route() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", PKG);
    write(
        r,
        "lib/org.ts",
        r#"export function loadOrg() {
  return (req: any, res: any, next: any) => {
    req.org = req.params.id;
    next();
  };
}
"#,
    );
    write(
        r,
        "server.ts",
        &server("import { loadOrg } from \"./lib/org\";\napp.use(\"/orgs/:id\", loadOrg());\n"),
    );
    let (facts, _) = drift_ts::scan(
        r,
        &drift_ts::ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let inv = drift_mine::security::inventory(&facts);
    let names: Vec<&str> = inv.entry_points.iter().map(|e| e.symbol.as_str()).collect();
    assert!(names.contains(&"GET /open"), "{names:?}");
    assert!(
        !names.iter().any(|n| n.starts_with("ALL /orgs")),
        "{names:?}"
    );
    // Nor in the copy mining reads.
    let measured: Vec<&str> = facts
        .files
        .iter()
        .flat_map(|f| f.entry_points.iter().map(|e| e.symbol.as_str()))
        .collect();
    assert!(
        !measured.iter().any(|n| n.starts_with("ALL ")),
        "{measured:?}"
    );
}
