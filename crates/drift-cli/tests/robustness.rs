//! End-to-end robustness of the `drift` binary on hostile or unusual input:
//! paths given to `drift check`, malformed MCP input, and files planted to hang
//! or exhaust a scan.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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

/// Exit code, stdout and stderr of `drift ARGS` in `root`, killed after 60 s
/// (`None`: it hung).
fn run(root: &Path, args: &[&str], stdin: &[u8]) -> Option<(i32, String, String)> {
    let mut child = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let bytes = stdin.to_vec();
    let feeder = std::thread::spawn(move || {
        let _ = input.write_all(&bytes);
    });
    let start = Instant::now();
    while child.try_wait().unwrap().is_none() {
        if start.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = feeder.join();
    let out = child.wait_with_output().unwrap();
    Some((
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

const GUARDED: &str = "import { withAuth } from \"../../../lib/auth\";\n\nexport const GET = withAuth(async () => new Response(\"ok\"));\n";
const UNGUARDED: &str = "export async function GET() {\n  return new Response(\"no\");\n}\n";

/// 30 guarded routes, 2 legacy ones and an accepted, blocking `withAuth`
/// convention; then one new route that breaks it (`app/api/bad/route.ts`).
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..30 {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    // Two legacy routes break it (baselined in the lock).
    write(r, "app/api/old1/route.ts", UNGUARDED);
    write(r, "app/api/old2/route.ts", UNGUARDED);
    assert_eq!(run(r, &["init"], b"").unwrap().0, 0);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|block| block.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    assert_eq!(run(r, &["review", "--block", &id], b"").unwrap().0, 0);
    write(r, "app/api/bad/route.ts", UNGUARDED);
    dir
}

/// An absolute path, or one with `./`, `..` or a doubled slash, used to match no
/// file: the check passed with the violation unreported.
#[test]
fn check_normalises_the_paths_it_is_given() {
    let dir = repo();
    let r = dir.path();
    let abs = r.canonicalize().unwrap().join("app/api/bad/route.ts");
    let abs = abs.to_str().unwrap();
    for path in [
        "app/api/bad/route.ts",
        "./app/api/bad/route.ts",
        abs,
        "app//api/bad/route.ts",
        "app/api/r00/../bad/route.ts",
    ] {
        let (code, out, err) = run(r, &["check", path], b"").unwrap();
        assert_eq!(code, 1, "{path}: the blocking violation fails\n{out}{err}");
        assert!(out.contains("app/api/bad/route.ts"), "{path}: {out}");
    }
    // The repository root is every file.
    let (code, out, _) = run(r, &["check", "."], b"").unwrap();
    assert_eq!(code, 1, "{out}");
    // A guarded file passes.
    let (code, out, _) = run(r, &["check", "app/api/r01/route.ts"], b"").unwrap();
    assert_eq!(code, 0, "{out}");
}

#[test]
fn check_refuses_paths_outside_the_repository_and_warns_about_missing_ones() {
    let dir = repo();
    let r = dir.path();
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "x.ts", UNGUARDED);
    let other = outside.path().join("x.ts");
    for path in [other.to_str().unwrap(), "../x.ts"] {
        let (code, out, err) = run(r, &["check", path], b"").unwrap();
        assert_eq!(code, 2, "{path}: {out}{err}");
        assert!(err.contains("outside the repository"), "{err}");
    }
    let (code, _, err) = run(r, &["check", "app/api/gone/route.ts", "app"], b"").unwrap();
    assert_eq!(code, 0);
    assert!(
        err.contains("app/api/gone/route.ts does not exist"),
        "{err}"
    );
    assert!(err.contains("app is a directory"), "{err}");
    // An existing file Drift does not analyse is quiet.
    write(r, "README.md", "# t\n");
    let (code, _, err) = run(r, &["check", "README.md"], b"").unwrap();
    assert_eq!(code, 0);
    assert!(err.is_empty(), "{err}");
}

fn replies(out: &str) -> Vec<Value> {
    out.lines()
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("{e}: {l}")))
        .collect()
}

/// A line that is not UTF-8 ended the server (exit 2), and a batch or a bare
/// value got no reply at all, leaving the client waiting. (A batch is now answered
/// request by request: `mcp_conformance.rs`.)
#[test]
fn mcp_answers_malformed_lines_and_keeps_serving() {
    let dir = repo();
    let r = dir.path();
    let mut input = Vec::new();
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n");
    input.extend_from_slice(b"\xff\xfe{\"id\":9}\n");
    input.extend_from_slice(b"[{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"ping\"}]\n");
    input.extend_from_slice(b"\"ping\"\n");
    input.extend_from_slice(b"{ not json\n");
    input.extend_from_slice(b"\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n");
    for (id, args) in [
        (4, json!({})),
        (5, json!({ "path": 7 })),
        (6, json!({ "path": "" })),
        (7, json!({ "path": "." })),
    ] {
        let m = json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"drift_rules_for","arguments":args}});
        input.extend_from_slice(format!("{m}\n").as_bytes());
    }
    let m = json!({"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/r01/route.ts"}}});
    input.extend_from_slice(format!("{m}\n").as_bytes());
    // The last line has no newline.
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"ping\"}");
    let (code, out, err) = run(r, &["mcp"], &input).expect("the server finished");
    assert_eq!(code, 0, "{err}");
    let rs = replies(&out);
    let ids: Vec<Value> = rs
        .iter()
        .map(|m| {
            if m.is_array() {
                m.clone()
            } else {
                m["id"].clone()
            }
        })
        .collect();
    assert_eq!(
        ids,
        [
            json!(1),
            Value::Null,
            json!([{"jsonrpc":"2.0","id":3,"result":{}}]),
            Value::Null,
            Value::Null,
            json!(4),
            json!(5),
            json!(6),
            json!(7),
            json!(8),
            json!(10)
        ],
        "{out}"
    );
    assert_eq!(rs[1]["error"]["code"], -32700, "not UTF-8");
    assert_eq!(rs[3]["error"]["code"], -32600, "a bare value");
    assert_eq!(rs[4]["error"]["code"], -32700, "not JSON");
    for r in &rs[5..9] {
        assert_eq!(r["result"]["isError"], true, "{r}");
    }
    assert!(
        rs[5]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("missing argument `path`")
    );
    assert!(
        rs[8]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("repository root")
    );
    let text = rs[9]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("withAuth"), "{text}");
}

/// Files a repository can plant (git stores symbolic links) or a local tree can
/// hold: a `package.json` FIFO blocked the resolver forever, a `.gitignore`
/// linked to `/dev/zero` made the walker read until memory ran out, and a FIFO
/// `drift.lock` blocked `check`, the hooks and MCP.
#[cfg(unix)]
#[test]
fn planted_files_do_not_hang_or_exhaust_any_command() {
    let mkfifo = |p: &Path| {
        Command::new("mkfifo")
            .arg(p)
            .status()
            .is_ok_and(|s| s.success())
    };
    let dir = repo();
    let r = dir.path();
    std::fs::remove_file(r.join("package.json")).unwrap();
    let fifos = mkfifo(&r.join("package.json"));
    if !fifos {
        std::os::unix::fs::symlink("/dev/zero", r.join("package.json")).unwrap();
    }
    write(r, "app/api/vendored/route.ts", UNGUARDED);
    std::os::unix::fs::symlink("/dev/zero", r.join("app/api/vendored/.gitignore")).unwrap();
    std::os::unix::fs::symlink("/dev/zero", r.join(".gitattributes")).unwrap();
    std::os::unix::fs::symlink("/dev/zero", r.join("lib/tsconfig.json")).unwrap();

    let (code, _, err) = run(r, &["scan"], b"").expect("scan finished");
    assert_eq!(code, 0, "{err}");
    assert!(err.contains("skipping app/api/vendored"), "{err}");
    let (code, out, _) = run(r, &["check", "--format", "json"], b"").expect("check finished");
    assert_eq!(code, 1, "{out}");
    let report: Value = serde_json::from_str(&out).unwrap();
    let paths: Vec<&str> = report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["baselined"] == false)
        .filter_map(|v| v["path"].as_str())
        .collect();
    assert_eq!(
        paths,
        ["app/api/bad/route.ts"],
        "imports still resolve, the skipped directory is not checked"
    );

    // A lock that cannot be read is an error, never an empty lock.
    std::fs::remove_file(r.join("drift.lock")).unwrap();
    if fifos {
        assert!(mkfifo(&r.join("drift.lock")));
    } else {
        std::os::unix::fs::symlink("/dev/zero", r.join("drift.lock")).unwrap();
    }
    let (code, _, err) = run(r, &["check"], b"").expect("check finished");
    assert_eq!(code, 2);
    assert!(err.contains("drift.lock"), "{err}");
    // MCP still answers, and each tool call says the lock could not be read.
    let input = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"drift_check\"}}\n";
    let (code, out, err) = run(r, &["mcp"], input).expect("mcp finished");
    assert_eq!(code, 0, "{err}");
    let rs = replies(&out);
    assert_eq!(rs[0]["result"], json!({}));
    assert_eq!(rs[1]["result"]["isError"], true, "{out}");
    let text = rs[1]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("drift.lock"), "{text}");
    let event = json!({ "hook_event_name": "SessionStart", "cwd": r });
    let (code, out, _) = run(
        r,
        &["hook", "claude", "SessionStart"],
        event.to_string().as_bytes(),
    )
    .expect("hook finished");
    assert_eq!(code, 0, "a hook never fails the agent: {out}");
}
