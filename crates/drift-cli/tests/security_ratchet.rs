//! The security baseline (`.drift/security.lock`) and `drift security --ratchet`.
//!
//! The inventory never fails a run, and `--diff-base` needs a commit to compare
//! with. The baseline records every finding the repository has when it is written,
//! keyed by handler and route and never by line; a later run reports what is found
//! and is not in it, and exits 1. So a repository is accepted as it is, and one
//! more route with no guard, one more route that checks nothing of a signed-in
//! caller, one more risky operation, does not come in unseen.

use std::path::Path;
use std::process::{Command, Output};

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn drift(root: &Path, args: &[&str]) -> Output {
    Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap()
}

const HEAD: &str = r#"from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

app = FastAPI()
oauth2 = OAuth2PasswordBearer(tokenUrl="token")


def current_user(token: str = Depends(oauth2)):
    if not token:
        raise HTTPException(status_code=401)
    return {"id": 1}


def rows(sql):
    return []
"#;

const BEFORE: &str = r#"

@app.get("/reports")
def reports():
    return rows("SELECT 1")


@app.get("/me")
def me(user=Depends(current_user)):
    return user
"#;

const ADDED: &str = r#"

@app.get("/search/{term}")
def search(term: str):
    import sqlite3

    return sqlite3.connect("db").execute(f"SELECT * FROM notes WHERE text = '{term}'").fetchall()
"#;

fn write(root: &Path, main: &str) {
    for (rel, text) in [
        ("requirements.txt", "fastapi\n"),
        ("app/__init__.py", ""),
        ("app/main.py", main),
    ] {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
}

#[test]
fn what_is_there_is_accepted_and_what_is_added_fails() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    // Blank lines first: a finding is keyed by its handler and route, so the
    // lines of the file may move.
    write(root, &format!("{HEAD}{BEFORE}"));
    let wrote = drift(root, &["security", "--write-baseline"]);
    assert!(
        wrote.status.success(),
        "{}",
        String::from_utf8_lossy(&wrote.stderr)
    );
    let lock = std::fs::read_to_string(root.join(".drift/security.lock")).unwrap();
    assert!(
        lock.contains("no-guard\tapp/main.py#reports GET /reports"),
        "{lock}"
    );
    // A route that hands back who calls and touches nothing else checks nothing,
    // and has nothing to check.
    assert!(!lock.contains("no-authorization"), "{lock}");

    // Nothing added: exit 0, also after the lines move.
    write(root, &format!("\n\n\n{HEAD}{BEFORE}"));
    let same = drift(root, &["security", "--ratchet"]);
    assert!(
        same.status.success(),
        "{}",
        String::from_utf8_lossy(&same.stdout)
    );

    // A route with no guard that builds SQL from its path: three findings, exit 1.
    write(root, &format!("{HEAD}{BEFORE}{ADDED}"));
    let added = drift(root, &["security", "--ratchet"]);
    let said = String::from_utf8_lossy(&added.stdout);
    assert_eq!(added.status.code(), Some(1), "{said}");
    assert!(
        said.contains("app/main.py#search GET /search/{term}"),
        "{said}"
    );
    assert!(said.contains("[unguarded-reaching]"), "{said}");
    assert!(said.contains("[risky]"), "{said}");
    // What was there is not said again.
    assert!(!said.contains("#reports"), "{said}");

    // A person asks for one kind only: nothing of it was added.
    let leaks = drift(root, &["security", "--ratchet", "--fail-on", "leak"]);
    assert!(leaks.status.success());

    // Accepted by writing the baseline again; and what is gone is said.
    assert!(
        drift(root, &["security", "--write-baseline"])
            .status
            .success()
    );
    write(root, &format!("{HEAD}{BEFORE}"));
    let gone = drift(root, &["security", "--ratchet"]);
    assert!(gone.status.success());
    assert!(
        String::from_utf8_lossy(&gone.stdout).contains("no longer found"),
        "{}",
        String::from_utf8_lossy(&gone.stdout)
    );
}

#[test]
fn a_ratchet_with_no_baseline_says_how_to_write_one() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), &format!("{HEAD}{BEFORE}"));
    let out = drift(dir.path(), &["security", "--ratchet"]);
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("--write-baseline"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A CI workflow that interpolates text of the event into a shell step is a
/// finding of the inventory and of the baseline.
#[test]
fn a_workflow_that_runs_what_an_outsider_wrote_is_a_finding() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, &format!("{HEAD}{BEFORE}"));
    assert!(
        drift(root, &["security", "--write-baseline"])
            .status
            .success()
    );
    let workflow = root.join(".github/workflows/greet.yml");
    std::fs::create_dir_all(workflow.parent().unwrap()).unwrap();
    std::fs::write(
        &workflow,
        "on: pull_request_target\njobs:\n  greet:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - run: echo \"${{ github.event.pull_request.title }}\"\n",
    )
    .unwrap();
    let listed = drift(root, &["security"]);
    let said = String::from_utf8_lossy(&listed.stdout);
    assert!(
        said.contains("CI workflows that run what an outsider wrote"),
        "{said}"
    );
    assert!(said.contains("github.event.pull_request.title"), "{said}");
    let added = drift(root, &["security", "--ratchet", "--fail-on", "workflow"]);
    let said = String::from_utf8_lossy(&added.stdout);
    assert_eq!(added.status.code(), Some(1), "{said}");
    assert!(said.contains("untrusted_checkout"), "{said}");
    assert!(said.contains("script_injection"), "{said}");
}
