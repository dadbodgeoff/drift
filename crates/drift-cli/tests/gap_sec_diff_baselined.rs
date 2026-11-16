//! `drift check --diff-base`: a finding the change adds to the code and also writes
//! into `.drift/security.lock` itself is listed where a reviewer reads the check
//! (text, JSON, GitHub annotations, SARIF), as a notice that fails nothing.
//!
//! Before: only the lock's header was protected against the change's own edit; a line
//! the change added to the lock accepted its finding silently, and the lock's diff was
//! the only place it showed. A lock written again for code that was there (as
//! `drift upgrade --apply` writes it), or lines that only moved with a renamed file,
//! are not the change's findings and are not listed.

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

/// A FastAPI app on `main` with accepted conventions and a security baseline, a `pr`
/// branch checked out. `edit` changes the lock before it is committed.
fn repo(edit: impl Fn(&str) -> String) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", "fastapi\n");
    write(r, "app/__init__.py", "");
    write(r, "app/main.py", APP);
    write(r, ".gitignore", ".drift/cache/\n");
    git(r, &["init", "-q"]);
    let (code, _, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(LOCK)).unwrap();
    write(r, LOCK, &edit(&lock));
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    dir
}

/// Pins part 3: the change adds a route with no guard that builds SQL from its path,
/// and writes its findings into the lock in the same commit. The check passes (they
/// are in the baseline), and says so in every format.
#[test]
fn a_finding_the_change_adds_and_baselines_is_listed_in_every_format() {
    let dir = repo(str::to_string);
    let r = dir.path();
    write(r, "app/main.py", &format!("{APP}{SEARCH}"));
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "search, baselined"]);

    let (code, text, err) = drift(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 0, "{text}{err}");
    assert!(
        text.contains("risky operation(s) [risky] this change adds and also writes into .drift/security.lock itself: it baselines them, so they fail nothing; a reviewer accepts them by approving the lock's diff\n"),
        "{text}"
    );
    assert!(
        text.contains("app/main.py#search GET /search/{term}"),
        "{text}"
    );

    let (code, out, _) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 0);
    let v: Value = serde_json::from_str(&out).unwrap();
    let by = &v["security"]["baselined_by_change"];
    assert!(by["risky"].is_array(), "{v:#}");
    assert!(
        by["no-guard"][0]["key"]
            .as_str()
            .unwrap()
            .starts_with("app/main.py#search"),
        "{v:#}"
    );
    // The route that was there at the merge base is not the change's.
    assert!(!by.to_string().contains("#reports"), "{v:#}");

    let (code, gh, _) = drift(r, &["check", "--diff-base", "main", "--format", "github"]);
    assert_eq!(code, 0);
    assert!(
        gh.contains("::notice file=app/main.py,line=")
            && gh.contains("title=drift security [risky]::"),
        "{gh}"
    );
    assert!(!gh.contains("::error"), "{gh}");

    let (code, sarif, _) = drift(r, &["check", "--diff-base", "main", "--format", "sarif"]);
    assert_eq!(code, 0);
    let v: Value = serde_json::from_str(&sarif).unwrap();
    let results = v["runs"][0]["results"].as_array().unwrap();
    assert!(
        results.iter().any(|x| x["ruleId"] == "drift-security/risky"
            && x["level"] == "note"
            && x["message"]["text"]
                .as_str()
                .unwrap()
                .contains("baselines it")),
        "{v:#}"
    );
}

/// A lock written again for code the merge base had (a line its lock lacked, as one
/// `drift upgrade --apply` records), and a lock whose lines only moved with a renamed
/// file: no finding is the change's own.
#[test]
fn a_line_for_code_that_was_there_or_that_only_moved_is_not_listed() {
    // The merge base's lock lacks the line of a route its code has.
    let dir = repo(|lock| {
        lock.lines()
            .filter(|l| !l.starts_with("no-guard\tapp/main.py#reports"))
            .map(|l| format!("{l}\n"))
            .collect()
    });
    let r = dir.path();
    git(r, &["mv", "app/main.py", "app/server.py"]);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "renamed, lock written again"]);
    let lock = std::fs::read_to_string(r.join(LOCK)).unwrap();
    assert!(lock.contains("no-guard\tapp/server.py#reports"), "{lock}");

    let (code, out, err) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert!(v["security"].get("baselined_by_change").is_none(), "{v:#}");
    let (_, text, _) = drift(r, &["check", "--diff-base", "main"]);
    assert!(
        !text.contains("writes into .drift/security.lock itself"),
        "{text}"
    );
}
