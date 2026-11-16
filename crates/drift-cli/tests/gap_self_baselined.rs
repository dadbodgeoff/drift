//! A team opts in, in the security baseline's header (`# fail self-baselined:`,
//! written by `drift security --write-baseline --fail-on self-baselined`), to failing
//! `drift check --diff-base` on a finding the change adds to the code and also writes
//! into `.drift/security.lock` itself. Without the line it stays a notice.
//!
//! Before: such a finding was always a notice (`baselined_by_change`) and the check
//! passed; a team could not ask for the baseline to be accepted apart from the code.

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

const APP: &str = r#"from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

app = FastAPI()
oauth2 = OAuth2PasswordBearer(tokenUrl="token")


def current_user(token: str = Depends(oauth2)):
    if not token:
        raise HTTPException(status_code=401)
    return {"id": 1}


def rows(sql):
    return []


@app.get("/reports")
def reports():
    return rows("SELECT 1")


@app.get("/me")
def me(user=Depends(current_user)):
    return user
"#;

const SEARCH: &str = r#"

@app.get("/search/{term}")
def search(term: str):
    import sqlite3

    return sqlite3.connect("db").execute(f"SELECT * FROM notes WHERE text = '{term}'").fetchall()
"#;

const LOCK: &str = ".drift/security.lock";
const OPT_IN: &str = "# fail self-baselined: failing\n";

/// A FastAPI app on `main` with accepted conventions and a security baseline written
/// with `write_args`, a `pr` branch checked out.
fn repo(write_args: &[&str]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", "fastapi\n");
    write(r, "app/__init__.py", "");
    write(r, "app/main.py", APP);
    write(r, ".gitignore", ".drift/cache/\n");
    git(r, &["init", "-q"]);
    let (code, _, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let mut args = vec!["security", "--write-baseline"];
    args.extend_from_slice(write_args);
    let (code, out, err) = drift(r, &args);
    assert_eq!(code, 0, "{out}{err}");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    dir
}

/// The change adds the search route (no guard, SQL built from its path) and writes its
/// findings into the lock in the same commit.
fn add_and_baseline(r: &Path) {
    write(r, "app/main.py", &format!("{APP}{SEARCH}"));
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "search, baselined"]);
}

/// Pins the default: with no opt-in line, the finding the change baselines itself is
/// a notice and the check exits 0, as before.
#[test]
fn without_the_line_it_is_a_notice_and_the_check_passes() {
    let dir = repo(&[]);
    let r = dir.path();
    assert!(
        !std::fs::read_to_string(r.join(LOCK))
            .unwrap()
            .contains("self-baselined")
    );
    add_and_baseline(r);
    let (code, out, err) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert!(
        v["security"]["baselined_by_change"]["risky"].is_array(),
        "{v:#}"
    );
    assert!(v["security"].get("self_baselined").is_none(), "{v:#}");
}

/// Pins the opt-in: `--fail-on self-baselined` writes the line; the change that adds
/// a finding and its baseline line fails, in every format, saying which finding, that
/// the change wrote its line, and how it is accepted instead.
#[test]
fn opted_in_the_check_fails_and_says_how_to_accept_it() {
    let dir = repo(&["--fail-on", "self-baselined"]);
    let r = dir.path();
    let lock = std::fs::read_to_string(r.join(LOCK)).unwrap();
    assert!(lock.contains(OPT_IN), "{lock}");
    add_and_baseline(r);
    // Written again without the flag, the line is kept.
    let lock = std::fs::read_to_string(r.join(LOCK)).unwrap();
    assert!(lock.contains(OPT_IN), "{lock}");

    let (code, text, err) = drift(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 1, "{text}{err}");
    assert!(
        text.contains("risky operation(s) [risky] this change adds and also writes into .drift/security.lock itself; the baseline sets such findings to fail (`# fail self-baselined:`), so they fail: the change itself wrote its line into .drift/security.lock. Fix the code, or accept the finding with a change to .drift/security.lock alone that reaches the base branch first"),
        "{text}"
    );
    assert!(
        text.contains("app/main.py#search GET /search/{term}"),
        "{text}"
    );

    let (code, out, _) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 1);
    let v: Value = serde_json::from_str(&out).unwrap();
    let sec = &v["security"];
    assert!(sec["self_baselined"]["risky"].is_array(), "{v:#}");
    assert!(
        sec["self_baselined"]["no-guard"][0]["key"]
            .as_str()
            .unwrap()
            .starts_with("app/main.py#search"),
        "{v:#}"
    );
    // Moved, not listed twice.
    assert!(sec.get("baselined_by_change").is_none(), "{v:#}");

    let (code, gh, _) = drift(r, &["check", "--diff-base", "main", "--format", "github"]);
    assert_eq!(code, 1);
    assert!(
        gh.contains("::error file=app/main.py,line=")
            && gh.contains("title=drift security [risky]::")
            && gh.contains("writes its line into .drift/security.lock itself"),
        "{gh}"
    );

    let (code, sarif, _) = drift(r, &["check", "--diff-base", "main", "--format", "sarif"]);
    assert_eq!(code, 1);
    let v: Value = serde_json::from_str(&sarif).unwrap();
    let results = v["runs"][0]["results"].as_array().unwrap();
    assert!(
        results.iter().any(|x| x["ruleId"] == "drift-security/risky"
            && x["level"] == "error"
            && x["message"]["text"]
                .as_str()
                .unwrap()
                .contains("# fail self-baselined:")),
        "{v:#}"
    );

    // With no change to compare, it is not checked: one line says so, and the
    // whole-tree check does not fail on it.
    let (code, text, err) = drift(r, &["check"]);
    assert_eq!(code, 0, "{text}{err}");
    assert!(
        text.contains("this run compares no change, so they are not checked here: `drift check --diff-base <ref>` checks them"),
        "{text}"
    );
}

/// Pins the protection: a change that removes the line in its own diff is checked as
/// the baseline it starts from says, and the removal is said.
#[test]
fn the_line_removed_by_the_same_change_still_fails() {
    let dir = repo(&["--fail-on", "self-baselined"]);
    let r = dir.path();
    write(r, "app/main.py", &format!("{APP}{SEARCH}"));
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(LOCK)).unwrap();
    write(r, LOCK, &lock.replace(OPT_IN, ""));
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "search, baselined, opt-in removed"]);

    let (code, text, err) = drift(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 1, "{text}{err}");
    assert!(
        text.contains(
            "off `# fail self-baselined:` in .drift/security.lock; this check still fails on them"
        ),
        "{text}"
    );
    assert!(text.contains("so they fail"), "{text}");
}

/// Pins the way to accept it: the lock's lines reach `main` first, in a change of
/// the lock alone; the change that then adds the code writes no line and passes.
/// And a change that baselines its finding and then fixes the code passes.
#[test]
fn a_line_that_reached_the_base_first_or_a_fixed_finding_passes() {
    let dir = repo(&["--fail-on", "self-baselined"]);
    let r = dir.path();
    // The lock written for the code, committed on `main` without the code.
    git(r, &["checkout", "-q", "main"]);
    write(r, "app/main.py", &format!("{APP}{SEARCH}"));
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    write(r, "app/main.py", APP);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "accept the search route's findings"]);
    git(r, &["checkout", "-qb", "feature"]);
    write(r, "app/main.py", &format!("{APP}{SEARCH}"));
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "search"]);
    let (code, text, err) = drift(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 0, "{text}{err}");
    assert!(!text.contains("so they fail"), "{text}");

    // Fixed: the route goes, its lines stay in the lock, nothing fails.
    git(r, &["checkout", "-q", "pr"]);
    add_and_baseline(r);
    write(r, "app/main.py", APP);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "search removed"]);
    let (code, text, err) = drift(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 0, "{text}{err}");
    assert!(!text.contains("so they fail"), "{text}");
}

/// Pins fail closed: a line Drift cannot read is an error naming it (exit 2), not a
/// pass, for the check and for writing the baseline again; and the opt-in is only
/// given where it is recorded, for kinds that fail.
#[test]
fn an_unreadable_line_is_an_error_and_the_flag_is_checked() {
    let dir = repo(&[]);
    let r = dir.path();
    let lock = std::fs::read_to_string(r.join(LOCK)).unwrap();
    write(
        r,
        LOCK,
        &lock.replacen("# fail: ", "# fail self-baselined: riskyy\n# fail: ", 1),
    );
    for args in [
        &["check", "--diff-base", "main"][..],
        &["check"][..],
        &["security", "--write-baseline"][..],
    ] {
        let (code, out, err) = drift(r, args);
        assert_eq!(code, 2, "{args:?}: {out}{err}");
        assert!(
            err.contains("the line `# fail self-baselined: riskyy` cannot be read")
                && err.contains("`riskyy`"),
            "{args:?}: {err}"
        );
    }
    write(r, LOCK, &lock);

    let (code, _, err) = drift(r, &["security", "--ratchet", "--fail-on", "self-baselined"]);
    assert_eq!(code, 2, "{err}");
    assert!(err.contains("given with --write-baseline"), "{err}");
    let (code, _, err) = drift(
        r,
        &[
            "security",
            "--write-baseline",
            "--fail-on",
            "self-baselined:unscoped-key",
        ],
    );
    assert_eq!(code, 2, "{err}");
    assert!(err.contains("add --fail-on unscoped-key"), "{err}");
    let (code, _, err) = drift(
        r,
        &[
            "security",
            "--write-baseline",
            "--fail-on",
            "self-baselined:nope",
        ],
    );
    assert_eq!(code, 2, "{err}");
    assert!(err.contains("`self-baselined:nope` is none of"), "{err}");
    let (code, _, err) = drift(
        r,
        &[
            "security",
            "--write-baseline",
            "--fail-on",
            "self-baselined:risky",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(LOCK)).unwrap();
    assert!(lock.contains("# fail self-baselined: risky\n"), "{lock}");
}
