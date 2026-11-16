//! The GitHub Action's scripts (scripts/action/), which carry all of action.yml's
//! logic: their own test suite (fake `gh`, `curl`, `cargo` and `drift`, recorded
//! JSON), and the gate and the comment run on the JSON of the Drift built here, so
//! a renamed or moved `drift check --format json` field fails this test rather
//! than a team's CI. GitHub itself (a run of `uses: ./`) is the `action` job of
//! .github/workflows/ci.yml.
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn scripts() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/action")
}

/// The scripts need jq (on every GitHub-hosted runner). Without it they cannot run,
/// and this says so instead of passing quietly.
fn have_jq() -> bool {
    let found = Command::new("jq")
        .arg("--version")
        .stdout(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !found {
        eprintln!("jq is not installed: the Action script tests did not run");
    }
    found
}

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

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(out.status.success(), "{args:?}: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

/// The value of `name` in a GITHUB_OUTPUT file (the last line for it).
fn output(file: &Path, name: &str) -> Option<String> {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    text.lines()
        .filter_map(|l| l.split_once('='))
        .filter(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
        .next_back()
}

/// Pins scripts/action/test.sh: install (release by tag or commit, checksum and
/// version verified, build from source cached by commit), the gate's outputs and
/// exit code, the one comment kept up to date and escaped, and the status.
#[test]
fn action_scripts_pass_their_tests() {
    if !have_jq() {
        return;
    }
    let out = Command::new("bash")
        .arg(scripts().join("test.sh"))
        .stdin(Stdio::null())
        .output()
        .unwrap();
    let said = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(out.status.success(), "{said}");
    assert!(said.contains(" passed, 0 failed"), "{said}");
}

/// A pull request that adds a route without the `withAuth()` wrapper its 38
/// siblings have (an accepted rule in block mode): the gate run on this Drift's
/// real output says exit 1, one block violation, no advice, the security advice
/// for the new unguarded route; and the comment names its file and line.
#[test]
fn the_gate_and_comment_read_this_drifts_json() {
    if !have_jq() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path().join("repo");
    write(&r, "package.json", "{ \"name\": \"fx\" }");
    write(
        &r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        &r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        let body = if i < 38 {
            "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n"
        } else {
            "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n"
        };
        write(&r, &format!("app/api/r{i:02}/route.ts"), body);
    }
    for i in 10..30 {
        write(
            &r,
            &format!("src/ui/c{i}.tsx"),
            &format!("export function Card{i}() {{\n  return <div>c</div>;\n}}\n"),
        );
        write(
            &r,
            &format!("src/other/o{i}.ts"),
            &format!("export function other{i}() {{\n  return {i};\n}}\n"),
        );
    }
    write(&r, ".gitignore", ".drift/cache/\n");
    drift(&r, &["init"]);
    let census: serde_json::Value =
        serde_json::from_str(&drift(&r, &["census", "--json"])).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule_kind"] == "wrapped_by:call")
        .unwrap_or_else(|| panic!("the wrapper rule is mined: {census}"))["id"]
        .as_str()
        .unwrap()
        .to_string();
    drift(&r, &["review", "--block", &id]);
    git(&r, &["init", "-q"]);
    git(&r, &["add", "-A"]);
    git(&r, &["commit", "-qm", "base"]);
    // What a pull request checkout has: the base branch as origin/<base>.
    git(&r, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(&r, &["checkout", "-qb", "pr"]);
    write(
        &r,
        "app/api/new/route.ts",
        "export async function POST(req: Request) {\n  return Response.json({ ok: true });\n}\n",
    );
    git(&r, &["add", "-A"]);
    git(&r, &["commit", "-qm", "pr"]);

    let tmp = dir.path().join("runner-temp");
    std::fs::create_dir_all(&tmp).unwrap();
    let outputs = dir.path().join("outputs");
    let status = Command::new("bash")
        .arg(scripts().join("check.sh"))
        .arg("gate")
        .current_dir(&r)
        .env("DRIFT_BIN", &*BIN)
        .env("DRIFT_EVENT", "pull_request")
        .env("DRIFT_BASE_REF", "main")
        .env("GITHUB_OUTPUT", &outputs)
        .env("RUNNER_TEMP", &tmp)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY")
        .env_remove("DRIFT_ARGS")
        .env_remove("DRIFT_PR_MODE")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(status.status.success(), "the gate never fails: {status:?}");
    let o = |k: &str| output(&outputs, k);
    assert_eq!(o("exit-code").as_deref(), Some("1"), "{status:?}");
    assert_eq!(o("base").as_deref(), Some("origin/main"));
    assert_eq!(o("block").as_deref(), Some("1"));
    assert_eq!(o("advise").as_deref(), Some("0"));
    assert_eq!(o("security-findings").as_deref(), Some("0"));
    assert_eq!(o("security-advice").as_deref(), Some("1"));
    assert_eq!(o("unchecked").as_deref(), Some("0"));
    assert_eq!(o("outside-diff").as_deref(), Some("0"));
    let report = o("report").expect("the report's path");

    // The comment, posted through a fake gh that records what it was given.
    let fakes = dir.path().join("fakes");
    let log = dir.path().join("gh.log");
    write(
        &fakes,
        "gh",
        "#!/usr/bin/env bash\necho \"gh $*\" >>\"$FAKE_LOG\"\ninput=\"\"\nprev=\"\"\nfor a in \"$@\"; do [ \"$prev\" = --input ] && input=\"$a\"; prev=\"$a\"; done\nif [ -n \"$input\" ]; then cp \"$input\" \"$FAKE_LOG.body\"; fi\nexit 0\n",
    );
    Command::new("chmod")
        .arg("+x")
        .arg(fakes.join("gh"))
        .status()
        .unwrap();
    let path = format!(
        "{}:{}",
        fakes.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let posted = Command::new("bash")
        .arg(scripts().join("comment.sh"))
        .env("PATH", path)
        .env("FAKE_LOG", &log)
        .env("DRIFT_REPORT", &report)
        .env("DRIFT_BASE", "origin/main")
        .env("DRIFT_HEAD_SHA", "4".repeat(40))
        .env("PR_NUMBER", "12")
        .env("GITHUB_REPOSITORY", "acme/app")
        .env("RUNNER_TEMP", &tmp)
        .env_remove("DRIFT_SECURITY_REPORT")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(posted.status.success(), "{posted:?}");
    let calls = std::fs::read_to_string(&log).unwrap();
    assert!(
        calls.contains("gh api --method POST repos/acme/app/issues/12/comments"),
        "{calls}"
    );
    let body: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(format!("{}.body", log.display())).unwrap())
            .unwrap();
    let body = body["body"].as_str().unwrap();
    assert!(body.starts_with("<!-- drift-action:comment -->"), "{body}");
    assert!(
        body.contains("<code>app&#47;api&#47;new&#47;route&#46;ts&#58;1</code>"),
        "{body}"
    );
    assert!(
        body.contains(&format!("<code>{}</code>", id.replace('-', "&#45;"))),
        "{body}"
    );
    assert!(body.contains("1 in block mode"), "{body}");
    assert!(body.contains("**Security: 1 finding**"), "{body}");
}
