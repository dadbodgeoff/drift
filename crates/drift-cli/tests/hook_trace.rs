//! `DRIFT_HOOK_TRACE=<file>`: each hook appends one JSON line with the event, the path
//! it took and how long it took (PLAN-R14 D1). Off by default; it changes no output.

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

fn hook(root: &Path, event: &str, extra: Value, trace: Option<&Path>) -> String {
    let mut input = json!({ "session_id": "s1", "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let mut cmd = Command::new(&*BIN);
    cmd.args(["hook", "claude", event])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_HOOK_TRACE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(t) = trace {
        cmd.env("DRIFT_HOOK_TRACE", t);
    }
    let mut child = cmd.spawn().unwrap();
    {
        use std::io::Write;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.to_string().as_bytes())
            .unwrap();
    }
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0), "hooks always exit 0");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn lines(trace: &Path) -> Vec<Value> {
    std::fs::read_to_string(trace)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).expect("one JSON object per line"))
        .collect()
}

#[test]
fn the_trace_names_the_path_each_hook_took_and_changes_no_output() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "app/api/x/route.ts",
        "export async function GET() {\n  return Response.json({});\n}\n",
    );
    write(r, "README.md", "# t\n");
    let trace = dir.path().join("trace.jsonl");
    let edit =
        |rel: &str| json!({ "tool_name": "Edit", "tool_input": { "file_path": r.join(rel) } });

    // No conventions file: PostToolUse is silent and says so; SessionStart gives the
    // brief without a policy.
    let silent = hook(r, "PostToolUse", edit("app/api/x/route.ts"), Some(&trace));
    assert!(silent.trim().is_empty(), "{silent}");
    let brief = hook(r, "SessionStart", json!({}), Some(&trace));
    let brief_untraced = hook(r, "SessionStart", json!({}), None);
    assert_eq!(brief, brief_untraced, "the trace changes no output");
    let got = lines(&trace);
    assert_eq!(got.len(), 2, "{got:#?}");
    assert_eq!(got[0]["event"], "PostToolUse");
    assert_eq!(got[0]["path"], "skipped:no_policy");
    assert_eq!(got[0]["answered"], false);
    assert_eq!(got[1]["event"], "SessionStart");
    assert_eq!(got[1]["path"], "full_scan:brief_without_policy");
    assert!(got[1]["ms"].is_u64(), "{got:#?}");

    // With conventions: an edit of a non-source file and of a route file each name the
    // scan path they took.
    let (ok, err) = {
        let out = Command::new(&*BIN)
            .args(["--no-cache", "init"])
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .output()
            .unwrap();
        (
            out.status.success(),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        )
    };
    assert!(ok, "{err}");
    let before = lines(&trace).len();
    hook(r, "PostToolUse", edit("README.md"), Some(&trace));
    hook(r, "PostToolUse", edit("app/api/x/route.ts"), Some(&trace));
    hook(
        r,
        "Stop",
        json!({ "stop_hook_active": false }),
        Some(&trace),
    );
    let got = lines(&trace);
    assert_eq!(got.len(), before + 3, "{got:#?}");
    for g in &got[before..] {
        let path = g["path"].as_str().unwrap();
        assert!(
            path == "single_file"
                || path == "none"
                || path.starts_with("full_scan:")
                || path.starts_with("skipped:"),
            "{g:#}"
        );
    }
    assert_eq!(got[before + 2]["event"], "Stop");
    // A trace file that cannot be written is ignored, and the output is the same as
    // without a trace.
    let untraced = hook(r, "SessionStart", json!({}), None);
    let out = hook(
        r,
        "SessionStart",
        json!({}),
        Some(Path::new("/nonexistent/dir/trace.jsonl")),
    );
    assert_eq!(out, untraced);
}
