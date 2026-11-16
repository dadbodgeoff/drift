//! CI other than GitHub Actions through the CLI (gap `ci-other`).
//!
//! Pins: before, `drift security` read only `.github/workflows`, so a GitLab
//! pipeline that pipes a download into a shell was in no output and no baseline.
//! Now its findings are in `drift security --json` (`workflows`), a CI file that
//! cannot be read is listed (`ci_not_read`, and said in the text), a finding the
//! baseline does not hold is a SARIF result of `drift check`, and a baseline an
//! older Drift wrote (inventory 2, which read no GitLab pipeline) does not start
//! failing for a pipeline that did not change, while a change's new finding still
//! fails.

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
        .stdin(std::process::Stdio::null())
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

const PKG: &str = r#"{ "name": "shop", "dependencies": { "express": "4.19.2" } }"#;

const SERVER: &str = r#"import express from "express";
const app = express();
app.get("/health", (req: any, res: any) => {
  res.json({ ok: true });
});
app.listen(3000);
"#;

const PIPELINE: &str = "include:
  - remote: https://example.com/ci/shared.yml
build:
  script:
    - curl -fsSL https://get.example.com/install.sh | bash
    - npm test
";

/// A repository with an Express app and a GitLab pipeline.
fn repo(r: &Path) {
    write(r, "package.json", PKG);
    write(r, "server.ts", SERVER);
    write(r, ".gitlab-ci.yml", PIPELINE);
    write(r, ".gitignore", ".drift/cache/\n");
}

#[test]
fn a_gitlab_pipeline_is_in_the_inventory_and_an_unreadable_ci_file_is_said() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repo(r);
    write(r, ".circleci/config.yml", "jobs: {build: \n");
    let (code, json, err) = drift(r, &["security", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    let rows: Vec<(String, String, String, u64)> = v["workflows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| {
            (
                w["kind"].as_str().unwrap().to_string(),
                w["path"].as_str().unwrap().to_string(),
                w["detail"].as_str().unwrap().to_string(),
                w["line"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (
                "piped_download".to_string(),
                ".gitlab-ci.yml".to_string(),
                "curl -fsSL https://get.example.com/install.sh | bash".to_string(),
                5
            ),
            (
                "unpinned_action".to_string(),
                ".gitlab-ci.yml".to_string(),
                "https://example.com/ci/shared.yml".to_string(),
                2
            ),
        ]
    );
    assert_eq!(
        v["ci_not_read"],
        serde_json::json!([{ "path": ".circleci/config.yml", "why": "does not parse as YAML" }]),
        "{v:#}"
    );
    let (code, text, _) = drift(r, &["security"]);
    assert_eq!(code, 0);
    assert!(
        text.contains("1 CI file(s) NOT READ in full, so what their jobs run is unknown: .circleci/config.yml (does not parse as YAML)"),
        "{text}"
    );
    assert!(
        text.contains(".gitlab-ci.yml:5  job build hands a download to an interpreter"),
        "{text}"
    );
}

#[test]
fn a_new_pipeline_finding_is_a_sarif_result_of_drift_check() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repo(r);
    let _ = drift(r, &["init"]);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    assert!(
        lock.contains("workflow\tpiped_download in .gitlab-ci.yml job build: curl -fsSL https://get.example.com/install.sh | bash\n"),
        "{lock}"
    );
    let (code, out, _) = drift(r, &["check"]);
    assert_eq!(code, 0, "{out}");

    write(
        r,
        ".gitlab-ci.yml",
        &format!(
            "{PIPELINE}deploy:\n  script:\n    - wget -qO- https://example.com/deploy.sh | sh\n"
        ),
    );
    let (code, sarif, err) = drift(r, &["check", "--format", "sarif"]);
    assert_eq!(code, 1, "{sarif}{err}");
    let v: serde_json::Value = serde_json::from_str(&sarif).unwrap();
    let result = v["runs"][0]["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["ruleId"] == "drift-security/workflow")
        .unwrap_or_else(|| panic!("{v:#}"))
        .clone();
    assert!(
        result["message"]["text"]
            .as_str()
            .unwrap()
            .contains("piped_download in .gitlab-ci.yml job deploy: wget -qO- https://example.com/deploy.sh | sh"),
        "{result:#}"
    );
    let at = &result["locations"][0]["physicalLocation"];
    assert_eq!(
        at["artifactLocation"]["uri"], ".gitlab-ci.yml",
        "{result:#}"
    );
    assert_eq!(at["region"]["startLine"], 9, "{result:#}");
}

#[test]
fn an_older_baseline_does_not_fail_for_a_pipeline_it_could_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repo(r);
    let _ = drift(r, &["init"]);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    // The baseline as the release before this one wrote it: stamped 2, and none of
    // the pipeline's findings, which that release did not read.
    let older: String = lock
        .lines()
        .filter(|l| !(l.starts_with("workflow\t") && l.contains(".gitlab-ci.yml")))
        .map(|l| {
            if l.starts_with("# inventory: ") {
                "# inventory: 2\n".to_string()
            } else {
                format!("{l}\n")
            }
        })
        .collect();
    assert_ne!(older, lock);
    fs::write(r.join(".drift/security.lock"), &older).unwrap();
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "as the older release wrote it"]);

    let (code, out, err) = drift(r, &["check"]);
    assert_eq!(code, 0, "{out}{err}");
    assert!(out.contains("readings newer than this baseline"), "{out}");
    let (code, json, _) = drift(r, &["check", "--format", "json"]);
    assert_eq!(code, 0, "{json}");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(
        v["security"]["new_in_drift"]["workflow"]
            .as_array()
            .map(Vec::len),
        Some(2),
        "{v:#}"
    );
    assert_eq!(v["security"]["added"], serde_json::json!({}), "{v:#}");

    // A change to the pipeline: what it now finds there is the change's, and fails.
    write(
        r,
        ".gitlab-ci.yml",
        &format!(
            "{PIPELINE}deploy:\n  script:\n    - wget -qO- https://example.com/deploy.sh | sh\n"
        ),
    );
    let (code, out, _) = drift(r, &["check"]);
    assert_eq!(code, 1, "{out}");
}
