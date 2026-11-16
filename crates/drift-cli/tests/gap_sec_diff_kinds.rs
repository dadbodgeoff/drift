//! `drift security --diff-base` reports every kind of finding the security baseline
//! holds, by the key the baseline holds it under, and `drift security --format sarif`
//! writes the same results `drift check --format sarif` does.
//!
//! Before: the diff compared only guard gaps, unguarded routes reaching a risky
//! operation, new routes with no guard, risky operations and client leaks; a change
//! adding a CI workflow that runs an outsider's code, a dependency from a moving
//! branch or a Kubernetes workload on the node's network said nothing, and
//! `--fail-on workflow` with `--diff-base` was an error. There was no SARIF for
//! `drift security` at all.

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

const WORKFLOW: &str = "on: pull_request_target\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - run: npm test\n";

const AGENT: &str = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: agent\nspec:\n  template:\n    metadata:\n      labels: {app: agent}\n    spec:\n      hostNetwork: true\n      containers:\n        - name: agent\n          image: example/agent:2\n";

/// A FastAPI app on `main` (one route with no guard, one signed in), a `pr` branch
/// checked out.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", "fastapi\n");
    write(r, "app/__init__.py", "");
    write(r, "app/main.py", APP);
    write(r, ".gitignore", ".drift/cache/\n");
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    dir
}

/// Pins part 1: a workflow, a dependency and a Kubernetes manifest the change adds are
/// findings of the diff, keyed as the baseline keys them, in every format, and
/// `--fail-on` takes their kinds.
#[test]
fn every_kind_the_baseline_holds_is_compared_with_the_merge_base() {
    let dir = repo();
    let r = dir.path();
    write(
        r,
        "requirements.txt",
        "fastapi\nlib @ git+https://example.com/someone/lib@main\n",
    );
    write(r, ".github/workflows/pr.yml", WORKFLOW);
    write(r, "deploy/agent.yaml", AGENT);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "ci, a dependency, a workload"]);

    let (code, out, err) = drift(r, &["security", "--diff-base", "main", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let added = v["added"].as_object().unwrap_or_else(|| panic!("{v:#}"));
    for kind in ["workflow", "dependency", "kubernetes"] {
        assert!(added.contains_key(kind), "{kind}: {v:#}");
    }
    // Keyed as `.drift/security.lock` keys them, never by line.
    assert!(
        added["dependency"][0]["key"]
            .as_str()
            .unwrap()
            .contains("in requirements.txt: lib"),
        "{v:#}"
    );
    assert_eq!(
        added["workflow"][0]["at"]
            .as_str()
            .unwrap()
            .split(':')
            .next(),
        Some(".github/workflows/pr.yml")
    );
    // What was there at the merge base is not the change's.
    assert!(!added.contains_key("no-guard"), "{v:#}");

    let (code, text, err) = drift(r, &["security", "--diff-base", "main"]);
    assert_eq!(code, 0, "{err}");
    assert!(
        text.contains("\nOther findings this change adds (keyed as the security baseline holds them; facts for review)\n"),
        "{text}"
    );
    assert!(text.contains("[workflow]\n"), "{text}");
    assert!(text.contains("[kubernetes]\n"), "{text}");
    assert!(
        text.trim_end()
            .ends_with("not a verdict on its exceptions."),
        "{text}"
    );

    let (code, gh, err) = drift(r, &["security", "--diff-base", "main", "--github"]);
    assert_eq!(code, 0, "{err}");
    assert!(
        gh.contains("::notice file=requirements.txt,line=2,title=drift security [dependency]::"),
        "{gh}"
    );

    // Each kind may be named to fail on; one the change does not add passes.
    let (code, _, err) = drift(
        r,
        &["security", "--diff-base", "main", "--fail-on", "workflow"],
    );
    assert_eq!(code, 1, "{err}");
    assert!(
        err.contains("failing as asked (--fail-on workflow): this change introduces 1 workflow"),
        "{err}"
    );
    let (code, _, err) = drift(
        r,
        &["security", "--diff-base", "main", "--fail-on", "scope-gap"],
    );
    assert_eq!(code, 0, "{err}");
}

/// Pins "a change that adds nothing says nothing": lines moved and a file renamed
/// with its routes (the route of an entry point keyed as the one there now) add no
/// finding of any kind.
#[test]
fn a_change_that_only_moves_code_adds_nothing() {
    let dir = repo();
    let r = dir.path();
    git(r, &["mv", "app/main.py", "app/server.py"]);
    write(r, "app/server.py", &format!("\n\n\n{APP}"));
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "moved"]);
    let (code, out, err) = drift(r, &["security", "--diff-base", "main", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["added"], serde_json::json!({}), "{v:#}");
    assert!(v.get("not_compared").is_none(), "{v:#}");
    let (code, text, _) = drift(r, &["security", "--diff-base", "main"]);
    assert_eq!(code, 0);
    assert!(!text.contains("Other findings"), "{text}");
    assert!(!text.contains("Not compared"), "{text}");
    let (code, _, err) = drift(r, &["security", "--diff-base", "main", "--fail-on", "any"]);
    assert_eq!(code, 0, "{err}");
}

/// The results of a SARIF log that Drift's security rules gave: (rule, level, file,
/// line), sorted.
fn security_results(sarif: &str) -> Vec<(String, String, String, u64)> {
    let v: Value = serde_json::from_str(sarif).unwrap_or_else(|e| panic!("{e}: {sarif}"));
    assert_eq!(v["version"], "2.1.0", "{v:#}");
    let mut out: Vec<_> = v["runs"][0]["results"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["ruleId"].as_str().unwrap().starts_with("drift-security/"))
        .map(|r| {
            let loc = &r["locations"][0]["physicalLocation"];
            (
                r["ruleId"].as_str().unwrap().to_string(),
                r["level"].as_str().unwrap().to_string(),
                loc["artifactLocation"]["uri"].as_str().unwrap().to_string(),
                loc["region"]["startLine"].as_u64().unwrap(),
            )
        })
        .collect();
    out.sort();
    out
}

/// Pins part 2: `drift security --format sarif` (the inventory, `--ratchet` and
/// `--diff-base`) gives a finding the rule id, level and location
/// `drift check --format sarif` gives it.
#[test]
fn security_sarif_is_what_drift_check_writes() {
    let dir = repo();
    let r = dir.path();
    git(r, &["checkout", "-q", "main"]);
    let (code, _, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "baseline"]);
    git(r, &["checkout", "-q", "pr"]);
    git(r, &["merge", "-q", "main"]);

    // The whole inventory: every finding, here the route with no guard.
    let (code, sarif, err) = drift(r, &["security", "--format", "sarif"]);
    assert_eq!(code, 0, "{err}");
    let all = security_results(&sarif);
    assert!(
        all.iter()
            .any(|(rule, level, uri, _)| rule == "drift-security/no-guard"
                && level == "error"
                && uri == "app/main.py"),
        "{all:?}"
    );

    write(r, "app/main.py", &format!("{APP}{SEARCH}"));
    let (code, sarif, _) = drift(r, &["check", "--format", "sarif"]);
    assert_eq!(code, 1);
    let check = security_results(&sarif);
    assert!(
        check
            .iter()
            .any(|(rule, _, _, _)| rule == "drift-security/risky"),
        "{check:?}"
    );
    let (code, sarif, _) = drift(r, &["security", "--ratchet", "--format", "sarif"]);
    assert_eq!(code, 1);
    assert_eq!(security_results(&sarif), check);
    // Against the merge base, whose lock held what its code had: the same findings.
    let (code, sarif, err) = drift(r, &["security", "--diff-base", "main", "--format", "sarif"]);
    assert_eq!(code, 0, "{err}");
    assert_eq!(security_results(&sarif), check);
    // The inventory holds them too.
    let (_, sarif, _) = drift(r, &["security", "--format", "sarif"]);
    let all = security_results(&sarif);
    assert!(check.iter().all(|c| all.contains(c)), "{all:?}\n{check:?}");
}
