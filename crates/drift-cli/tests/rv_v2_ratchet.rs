//! The security baseline fails closed (review of PR 148, area 7 items 1, 2, 4 and 6).
//!
//! A finding the baseline does not hold may be held apart as new in this Drift only
//! where Drift shows the code under it did not change: found by this Drift at the
//! commit that last wrote the baseline (no diff) or at the merge base (a diff), in a
//! file unchanged since. Pins, each failing before:
//!
//! - item 1: against an unstamped baseline, with no diff, a new unguarded route
//!   reaching `eval` was held as new in Drift and `drift security --ratchet` passed;
//!   `drift upgrade --apply --security-baseline` on a branch wrote the branch's own
//!   findings into the baseline;
//! - item 2: taking a guard off a mount in `app.ts` turned the routes of the untouched
//!   `routes/items.ts` into `no-guard`, held as new in Drift, and the check passed;
//! - item 4: a change that emptied `# fail:` made its own findings advice;
//! - item 6: a new route whose guard cannot be read was not shown by the ratchet.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap()
}

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
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

const AUTH: &str = "export function requireAuth(req: any, res: any, next: any) {\n  if (!req.user) {\n    return res.status(401).json({ error: \"unauthorized\" });\n  }\n  next();\n}\n";
const ITEMS: &str = "import { Router } from \"express\";\nexport const items = Router();\nitems.get(\"/items\", (req: any, res: any) => {\n  res.json({ ok: true });\n});\nitems.post(\"/items\", (req: any, res: any) => {\n  res.json({ ok: true });\n});\n";
const APP: &str = "import express from \"express\";\nimport { requireAuth } from \"./auth\";\nimport { items } from \"./routes/items\";\nconst app = express();\napp.use(\"/api\", requireAuth, items);\napp.listen(3000);\n";
/// A route a change adds: no guard, and what the request sent handed to `eval`.
const RUN: &str = "import express from \"express\";\nconst app = express();\napp.post(\"/run\", (req: any, res: any) => {\n  res.json(eval(req.body.x));\n});\napp.listen(3001);\n";

/// An Express app whose routes `app.ts` mounts behind `requireAuth`, with Drift's
/// policy and a security baseline as the release before the stamp wrote it (no
/// `# inventory:`, no `# fail:`).
fn app(r: &Path) {
    write(
        r,
        "package.json",
        r#"{ "name": "shop", "dependencies": { "express": "4.19.2" } }"#,
    );
    write(r, "auth.ts", AUTH);
    write(r, "routes/items.ts", ITEMS);
    write(r, "app.ts", APP);
    write(r, ".gitignore", ".drift/cache/\n");
    let (code, out, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{out}{err}");
    let (code, out, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{out}{err}");
}

fn unstamp(r: &Path) {
    let old: String = read(r, ".drift/security.lock")
        .lines()
        .filter(|l| !l.starts_with("# inventory:") && !l.starts_with("# fail:"))
        .map(|l| format!("{l}\n"))
        .collect();
    write(r, ".drift/security.lock", &old);
}

fn commit_main(r: &Path) {
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
}

fn keys(v: &Value, group: &str, kind: &str) -> Vec<String> {
    v[group][kind]
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|a| a["key"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Item 1, with no diff: the route added after the commit that wrote the baseline
/// is not shown to be old code, so it fails; with no git, nothing can be shown, and
/// the run says so and what re-stamps the baseline.
#[test]
fn with_no_diff_a_new_unguarded_route_fails_an_unstamped_baseline() {
    // No git: nothing shows any finding is old.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    unstamp(r);
    write(r, "run.ts", RUN);
    let (code, out, err) = drift(r, &["security", "--ratchet"]);
    assert_eq!(code, 1, "{out}{err}");
    assert!(
        out.contains("Drift could not show that the code under them did not change"),
        "{out}"
    );
    assert!(
        out.contains("`drift upgrade --apply --security-baseline` run on the default branch"),
        "{out}"
    );
    assert!(!out.contains("readings newer than this baseline; they are listed and do not fail"), "{out}");

    // With git: the baseline's commit has the app and not the route.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    unstamp(r);
    commit_main(r);
    write(r, "run.ts", RUN);
    let (code, out, err) = drift(r, &["security", "--ratchet", "--json"]);
    assert_eq!(code, 1, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert!(
        keys(&v, "added", "no-guard")
            .iter()
            .any(|k| k.starts_with("run.ts#")),
        "{v:#}"
    );
    assert!(keys(&v, "new_in_drift", "no-guard").is_empty(), "{v:#}");
    // The documented CI gate says the same.
    let (_, out, err) = drift(r, &["check", "--format", "json"]);
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}{err}"));
    assert!(
        keys(&v["security"], "added", "unguarded-reaching")
            .iter()
            .any(|k| k.starts_with("run.ts#")),
        "{v:#}"
    );

    // A branch's `drift upgrade --apply --security-baseline` records none of the
    // branch's own findings as new in Drift.
    git(r, &["checkout", "-qb", "pr"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "run"]);
    let (_, out, err) = drift(r, &["upgrade", "--apply", "--security-baseline"]);
    let lock = read(r, ".drift/security.lock");
    assert!(!lock.contains("run.ts"), "{out}{err}\n{lock}");
}

/// Item 2: the change takes `requireAuth` off the mount in `app.ts`; the routes in
/// the untouched `routes/items.ts` have no guard now, are not so at the merge base,
/// and fail.
#[test]
fn a_guard_taken_off_a_mount_elsewhere_is_the_changes() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    unstamp(r);
    commit_main(r);
    git(r, &["checkout", "-qb", "pr"]);
    write(
        r,
        "app.ts",
        &APP.replace("app.use(\"/api\", requireAuth, items);", "app.use(\"/api\", items);"),
    );
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "open"]);
    let (code, out, err) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 1, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let added = keys(&v["security"], "added", "no-guard");
    assert!(
        added.iter().any(|k| k.starts_with("routes/items.ts#")),
        "{v:#}"
    );
    assert!(keys(&v["security"], "new_in_drift", "no-guard").is_empty(), "{v:#}");
}

/// Item 4: the change empties `# fail:` and adds an unguarded route; the merge base's
/// header still decides, the route fails, and the edit is said.
#[test]
fn a_change_that_empties_the_fail_line_is_still_checked() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    commit_main(r);
    git(r, &["checkout", "-qb", "pr"]);
    let lock: String = read(r, ".drift/security.lock")
        .lines()
        .map(|l| {
            if l.starts_with("# fail:") {
                "# fail: \n".to_string()
            } else {
                format!("{l}\n")
            }
        })
        .collect();
    write(r, ".drift/security.lock", &lock);
    write(r, "run.ts", RUN);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "quiet"]);
    let (code, out, err) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 1, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert!(
        keys(&v["security"], "added", "no-guard")
            .iter()
            .any(|k| k.starts_with("run.ts#")),
        "{v:#}"
    );
    let header = v["security"]["header"].to_string();
    assert!(header.contains("off `# fail:`"), "{v:#}");
}

/// Item 6: a route the change adds whose guard cannot be read is listed as not
/// checked, and fails nothing.
#[test]
fn a_new_route_whose_guard_cannot_be_read_is_shown_not_checked() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    commit_main(r);
    git(r, &["checkout", "-qb", "pr"]);
    write(
        r,
        "routes/registry.ts",
        "export const gate: any = (globalThis as any).gates;\n",
    );
    write(
        r,
        "routes/admin.ts",
        "import { Router } from \"express\";\nimport { gate } from \"./registry\";\nexport const admin = Router();\nadmin.get(\"/admin/stats\", gate.check, (req: any, res: any) => {\n  res.json({ ok: true });\n});\n",
    );
    write(
        r,
        "app.ts",
        &APP.replace(
            "import { items } from \"./routes/items\";\n",
            "import { items } from \"./routes/items\";\nimport { admin } from \"./routes/admin\";\n",
        )
        .replace("app.listen(3000);", "app.use(\"/ops\", admin);\napp.listen(3000);"),
    );
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "admin"]);
    let (_, out, err) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}{err}"));
    let unknown = v["security"]["guard_unknown"]
        .as_array()
        .unwrap_or_else(|| panic!("{v:#}"));
    assert_eq!(unknown.len(), 1, "{v:#}");
    assert!(
        unknown[0]["key"].as_str().unwrap().starts_with("routes/admin.ts#"),
        "{v:#}"
    );
    assert!(
        !v["security"]["added"].to_string().contains("routes/admin.ts"),
        "{v:#}"
    );
    let (_, text, _) = drift(r, &["check", "--diff-base", "main"]);
    assert!(
        text.contains("1 new entry point(s) whose guard Drift could not read: not checked"),
        "{text}"
    );
}
