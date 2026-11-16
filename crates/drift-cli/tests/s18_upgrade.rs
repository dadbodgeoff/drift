//! A policy written by a newer Drift (stream S18), on every path that loads it: `drift
//! check` and `drift review` stop with exit 2 and say what to do (upgrade; `drift
//! --version` shows the installed one), and a hook fails open with that warning, exit
//! 0, as the threat model asks (never block the agent because Drift could not read its
//! policy, never pass it silently either). A policy of the version this Drift writes
//! for a file without new forms keeps working.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift ARGS` in `root`, with `stdin` when given: its exit code, standard output and
/// standard error.
fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (Option<i32>, String, String) {
    let mut child = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("CLAUDE_CODE_SESSION_ID")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    match stdin {
        Some(s) => child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap(),
        None => drop(child.stdin.take()),
    }
    let out = child.wait_with_output().unwrap();
    (
        out.status.code(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// A policy file of format `version`, with one convention of a rule type no Drift
/// knows today (what a future Drift may write beside its new version).
fn policy(version: u32, future_rule: bool) -> String {
    let conventions = if future_rule {
        "conventions:
- id: D-f00000
  status: accepted
  mode: block
  summary: a rule of a later Drift
  role:
    package: ''
    dir: app/api
    file: route
    entry: http
    kind: function
  rule:
    type: a_rule_of_the_future
  evidence:
    holders: 20
    total: 20
    lower_bound: 0.84
    lift: 1.0
  example: app/api/a/route.ts#GET
  selector_version: 3
"
    } else {
        "conventions: []\n"
    };
    format!(
        "version: {version}\nengine: drift 9.0.0\nfile_kinds:\n  literal_stems:\n  - route\n  suffixes: []\n{conventions}"
    )
}

fn repo(policy_text: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "app/api/a/route.ts",
        "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n",
    );
    write(r, ".drift/conventions.yaml", policy_text);
    dir
}

/// The upgrade advice, wherever it is said.
fn says_upgrade(text: &str) {
    assert!(text.contains("written by a newer Drift"), "{text}");
    assert!(text.contains("drift --version"), "{text}");
    assert!(!text.contains("unknown variant"), "{text}");
}

/// Pins: `drift check` and `drift review --list` refuse a future-format policy with
/// exit 2 and the upgrade advice, also when it holds a rule type this Drift cannot
/// parse (before this change: a parse error naming the unknown rule type).
#[test]
fn commands_refuse_a_future_policy_with_what_to_do() {
    let dir = repo(&policy(99, true));
    let r = dir.path();
    for args in [&["check"][..], &["review", "--list"][..]] {
        let (code, out, err) = run(r, args, None);
        assert_eq!(code, Some(2), "{args:?}:\n{out}\n{err}");
        says_upgrade(&err);
        assert!(err.contains("policy format 99"), "{err}");
    }
}

/// Pins: a hook in a repository whose policy is of a future format fails open (exit 0,
/// no decision) and tells the person to upgrade, without quoting the file. Before
/// this change it said only that the file "could not be read".
#[test]
fn a_hook_fails_open_with_the_upgrade_warning() {
    let dir = repo(&policy(99, true));
    let r = dir.path();
    for event in ["SessionStart", "PostToolUse"] {
        let mut input = json!({ "session_id": "s18", "cwd": r, "hook_event_name": event });
        if event == "PostToolUse" {
            let file = r.join("app/api/a/route.ts");
            input.as_object_mut().unwrap().extend(
                json!({
                    "tool_name": "Edit",
                    "tool_input": { "file_path": file },
                    "tool_response": {}
                })
                .as_object()
                .unwrap()
                .clone(),
            );
        }
        let (code, out, err) = run(r, &["hook", "claude", event], Some(&input.to_string()));
        assert_eq!(code, Some(0), "hooks always exit 0: {err}");
        let v: Value = serde_json::from_str(out.trim()).expect("hook output is JSON");
        let msg = v["systemMessage"].as_str().unwrap_or_default();
        says_upgrade(msg);
        assert!(!msg.contains("a rule of a later Drift"), "{msg}");
        assert!(v.get("decision").is_none(), "{v}");
        assert!(v.get("hookSpecificOutput").is_none(), "{v}");
    }
}

/// Pins: a version-1 policy written by an older Drift still checks (exit 0, nothing
/// refused), so raising the newest format did not raise what is required to read it.
#[test]
fn an_old_policy_still_checks() {
    let dir = repo(&policy(1, false));
    let (code, out, err) = run(dir.path(), &["check"], None);
    assert_eq!(code, Some(0), "{out}\n{err}");
    assert!(!err.contains("newer Drift"), "{err}");
}
