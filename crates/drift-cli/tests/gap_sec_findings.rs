//! Two new kinds of the security baseline, `workflow-hardening` (a workflow an
//! outsider can start that states no token permissions, or runs on a self-hosted
//! runner) and `image-hardening` (an image a compose service deploys whose final
//! stage runs as root, or a secret written into an image's layers), end to end
//! through `drift security`.
//!
//! Pins: before this, none of these was read. Now each is listed (text and JSON),
//! held by the baseline under its own kind, advises by default, and a baseline an
//! older Drift wrote (stamped 2, or unstamped) does not start failing for a
//! repository that did not change; a change that adds one is reported, and fails
//! once a person sets its kind to fail.

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

/// A guarded FastAPI route, a workflow `pull_request_target` starts that states no
/// permissions and runs on a self-hosted runner, and a compose service built from a
/// Dockerfile whose final stage inherits `USER root` from the stage it is built on.
fn repository(r: &Path) {
    write(r, "requirements.txt", "fastapi\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/main.py",
        "from fastapi import Depends, FastAPI\nfrom fastapi.security import OAuth2PasswordBearer\n\napp = FastAPI()\noauth2 = OAuth2PasswordBearer(tokenUrl=\"token\")\n\n\n@app.get(\"/me\")\ndef me(token: str = Depends(oauth2)):\n    return {\"token\": token}\n",
    );
    write(
        r,
        ".github/workflows/label.yml",
        "on: pull_request_target\njobs:\n  label:\n    runs-on: [self-hosted, linux]\n    steps:\n      - run: echo labelled\n",
    );
    write(
        r,
        "compose.yaml",
        "services:\n  api:\n    build: ./api\n    ports: [\"8000:8000\"]\n",
    );
    write(
        r,
        "api/Dockerfile",
        "FROM python:3.13 AS base\nUSER root\nRUN pip install fastapi\nFROM base\nCMD [\"uvicorn\", \"app.main:app\"]\n",
    );
}

const PERMISSIONS: &str =
    "unstated_permissions in .github/workflows/label.yml job label: permissions not stated";
const RUNNER: &str =
    "self_hosted_runner in .github/workflows/label.yml job label: self-hosted, linux";
const ROOT: &str = "root_user in api/Dockerfile for compose.yaml service api: USER root";

fn keys(v: &Value, section: &str, kind: &str) -> Vec<String> {
    v[section][kind]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["key"].as_str().map(str::to_string))
        .collect()
}

fn ratchet(r: &Path, more: &[&str]) -> (i32, Value) {
    let mut args = vec!["security", "--ratchet", "--json"];
    args.extend_from_slice(more);
    let (code, out, err) = drift(r, &args);
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}\n{err}"));
    (code, v)
}

/// The baseline this build writes, as the build before these kinds wrote it: their
/// lines left out, stamped 2, and `# fail:` naming the kinds that build knew.
fn as_written_before(lock: &str) -> String {
    let mut out = String::new();
    for l in lock.lines() {
        if l.starts_with("workflow-hardening\t") || l.starts_with("image-hardening\t") {
            continue;
        }
        if l.starts_with("# inventory: ") {
            out.push_str("# inventory: 2\n");
            continue;
        }
        if let Some(kinds) = l.strip_prefix("# fail: ") {
            let old: Vec<&str> = kinds
                .split(',')
                .filter(|k| !k.ends_with("-hardening"))
                .collect();
            out.push_str(&format!("# fail: {}\n", old.join(",")));
            continue;
        }
        out.push_str(l);
        out.push('\n');
    }
    out
}

/// Pins the listing and the baseline: each finding is in `drift security`'s text and
/// JSON, the base image's unknown user is not one, and the baseline holds them under
/// kinds that advise (not on `# fail:`), stamped 3.
#[test]
fn the_new_kinds_are_listed_and_held_by_the_baseline_as_advice() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repository(r);
    let (code, text, err) = drift(r, &["security"]);
    assert_eq!(code, 0, "{err}");
    assert!(
        text.contains("CI workflows an outsider can start, with what they leave unstated"),
        "{text}"
    );
    assert!(
        text.contains(
            ".github/workflows/label.yml:3  job label on pull_request_target states no permissions"
        ),
        "{text}"
    );
    assert!(
        text.contains("runs on a self-hosted runner: self-hosted, linux"),
        "{text}"
    );
    assert!(
        text.contains("api/Dockerfile:2  for compose.yaml service api runs as root: USER root"),
        "{text}"
    );

    let (code, out, err) = drift(r, &["security", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let wf: Vec<&str> = v["workflow_hardening"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["kind"].as_str().unwrap())
        .collect();
    assert_eq!(wf, ["self_hosted_runner", "unstated_permissions"]);
    assert_eq!(v["image_hardening"][0]["kind"], "root_user");
    assert_eq!(v["image_hardening"][0]["line"], 2);

    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    assert!(lock.contains("\n# inventory: 3\n"), "{lock}");
    for (kind, key) in [
        ("workflow-hardening", PERMISSIONS),
        ("workflow-hardening", RUNNER),
        ("image-hardening", ROOT),
    ] {
        assert!(lock.contains(&format!("\n{kind}\t{key}\n")), "{lock}");
    }
    let fail = lock.lines().find(|l| l.starts_with("# fail: ")).unwrap();
    assert!(!fail.contains("hardening"), "{fail}");
    assert!(fail.contains("workflow"), "{fail}");
}

/// Pins "an older baseline does not start failing": the same repository, against the
/// baseline the build before these kinds wrote (stamped 2, or with no stamp), passes
/// `--ratchet`; the new findings are advice, or new in this Drift where the commit
/// that wrote the baseline shows them, and never `added`.
#[test]
fn an_older_baseline_does_not_fail_an_unchanged_repository() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repository(r);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    let old = as_written_before(&lock);
    assert!(!old.contains("hardening"), "{old}");
    write(r, ".drift/security.lock", &old);

    let (code, v) = ratchet(r, &[]);
    assert_eq!(code, 0, "{v}");
    assert!(keys(&v, "added", "workflow-hardening").is_empty(), "{v}");
    assert!(keys(&v, "added", "image-hardening").is_empty(), "{v}");
    assert_eq!(
        keys(&v, "advised", "workflow-hardening"),
        [RUNNER, PERMISSIONS],
        "{v}"
    );
    assert_eq!(keys(&v, "advised", "image-hardening"), [ROOT], "{v}");

    // With no header at all (the first baselines): the same.
    let unstamped: String = old
        .lines()
        .filter(|l| !l.starts_with("# inventory: ") && !l.starts_with("# fail: "))
        .map(|l| format!("{l}\n"))
        .collect();
    write(r, ".drift/security.lock", &unstamped);
    let (code, v) = ratchet(r, &[]);
    assert_eq!(code, 0, "{v}");
    assert!(keys(&v, "added", "image-hardening").is_empty(), "{v}");

    // Committed, so the commit that wrote the baseline is read: what it shows in
    // files unchanged since is new in this Drift.
    write(r, ".drift/security.lock", &old);
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "old baseline"]);
    let (code, v) = ratchet(r, &[]);
    assert_eq!(code, 0, "{v}");
    assert_eq!(keys(&v, "new_in_drift", "image-hardening"), [ROOT], "{v}");
    assert_eq!(
        keys(&v, "new_in_drift", "workflow-hardening").len(),
        2,
        "{v}"
    );
    // Even when a person asks for the kinds to fail: what Drift newly reads is not
    // the change's.
    let (code, v) = ratchet(r, &["--fail-on", "workflow-hardening,image-hardening"]);
    assert_eq!(code, 0, "{v}");
}

/// Pins "a change that adds the finding is seen": against a baseline this build
/// wrote, a second workflow a comment starts with no permissions, and a release
/// workflow that hands a secret to a build argument the Dockerfile writes into
/// `ENV`, are reported as advice (exit 0); with their kinds set to fail, they fail.
#[test]
fn a_change_that_adds_a_finding_is_advised_and_fails_once_its_kind_is_set_to_fail() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repository(r);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let (code, v) = ratchet(r, &[]);
    assert_eq!(code, 0, "{v}");

    write(
        r,
        ".github/workflows/comment.yml",
        "on: issue_comment\njobs:\n  reply:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo thanks\n",
    );
    write(
        r,
        ".github/workflows/release.yml",
        "on: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - run: docker build --build-arg SENTRY_DSN=${{ secrets.SENTRY_DSN }} -t api api\n",
    );
    write(
        r,
        "api/Dockerfile",
        "FROM python:3.13 AS base\nUSER root\nRUN pip install fastapi\nFROM base\nARG SENTRY_DSN\nENV SENTRY_DSN=$SENTRY_DSN\nCMD [\"uvicorn\", \"app.main:app\"]\n",
    );
    let (code, v) = ratchet(r, &[]);
    assert_eq!(code, 0, "advice only: {v}");
    assert_eq!(
        keys(&v, "advised", "workflow-hardening"),
        ["unstated_permissions in .github/workflows/comment.yml job reply: permissions not stated"],
        "{v}"
    );
    assert_eq!(
        keys(&v, "advised", "image-hardening"),
        [
            "build_secret in api/Dockerfile for .github/workflows/release.yml job image: ARG SENTRY_DSN given secrets.SENTRY_DSN, read by ENV"
        ],
        "{v}"
    );

    // A person sets them to fail (on the accepted state), then the change fails.
    let accepted = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    let with_fail = accepted.replace(
        "\n# fail: ",
        "\n# fail: workflow-hardening,image-hardening,",
    );
    write(r, ".drift/security.lock", &with_fail);
    let (code, v) = ratchet(r, &[]);
    assert_eq!(code, 1, "{v}");
    assert_eq!(keys(&v, "added", "workflow-hardening").len(), 1, "{v}");
    assert_eq!(keys(&v, "added", "image-hardening").len(), 1, "{v}");
    // Or names one for this run.
    write(r, ".drift/security.lock", &accepted);
    let (code, _) = ratchet(r, &["--fail-on", "image-hardening"]);
    assert_eq!(code, 1);
}
