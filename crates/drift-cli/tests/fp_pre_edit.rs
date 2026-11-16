//! FP (hot paths): PreToolUse before an edit of an existing file answers from the policy
//! and the session state, before any scan, once every accepted rule in scope for the file
//! was given this session. What it says is what it said before: nothing, as the
//! one-file scan followed by the "already given" filter said. The hook's trace names
//! the path it took (`skipped:rules_given`), where it named `single_file` before.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift`'s stdout, which must succeed.
fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// One hook event, traced to `trace`: its raw stdout (trimmed) and the path the trace
/// names. Hooks always exit 0.
fn hook(root: &Path, trace: &Path, session: &str, event: &str, extra: Value) -> (String, String) {
    std::fs::remove_file(trace).ok();
    let mut input = json!({ "session_id": session, "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env("DRIFT_HOOK_TRACE", trace)
        .env_remove("DRIFT_CACHE_DIR")
        .args(["hook", "claude", event])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0), "hooks always exit 0");
    let path = std::fs::read_to_string(trace)
        .ok()
        .and_then(|t| t.lines().last().map(str::to_string))
        .and_then(|l| serde_json::from_str::<Value>(&l).ok())
        .and_then(|v| v["path"].as_str().map(str::to_string))
        .unwrap_or_default();
    (
        String::from_utf8_lossy(&out.stdout).trim().to_string(),
        path,
    )
}

fn edit_tool(root: &Path, rel: &str) -> Value {
    json!({ "tool_name": "Edit", "tool_input": { "file_path": root.join(rel) } })
}

const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// An advising rule for every file, accepted by hand (as in `s20_hooks.rs`).
const ADVISES: &str = "- id: D-000000
  status: accepted
  mode: advise
  summary: 'files in ** never read an environment variable'
  role:
    package: ''
    dir: '**'
    file: '*'
    entry: '-'
    kind: module
  rule:
    type: avoids
    signal: env
  evidence:
    holders: 40
    total: 40
    lower_bound: 0.9
    lift: 1.0
  example: app/api/r00/route.ts#(file)
  selector_version: 3
  agents: show
";

/// The repository of `s20_hooks.rs`: 40 routes (38 wrapped in `withAuth`), the mined
/// `withAuth` rule set to block, the `withAuth` practice promoted in `app/api`, and
/// [`ADVISES`]: three accepted rules, each of which covers every route file.
fn routes() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i:02}() {{ return {i}; }}\n"),
        );
    }
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    drift(r, &["init"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let wrap = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    drift(r, &["review", "--block", &wrap]);
    let practices: Value = serde_json::from_str(&drift(r, &["practices", "--json"])).unwrap();
    let variant = practices["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .and_then(|c| {
            c["variants"]
                .as_array()?
                .iter()
                .find(|v| v["label"] == "wrap withAuth")
        })
        .and_then(|v| v["id"].as_str())
        .expect("the withAuth practice")
        .to_string();
    drift(r, &["practices", "promote", &variant, "--in", "app/api"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let yaml = yaml.replacen("conventions:\n", &format!("conventions:\n{ADVISES}"), 1);
    std::fs::write(r.join(".drift/conventions.yaml"), yaml).unwrap();
    (dir, wrap)
}

/// Pins: once the first edit of a route was given every accepted rule (the three cover
/// every route), a second edit of the same file, and the edit of another route, say
/// nothing, exactly as before this change (the scan's rules were all filtered out as
/// given), and now without the one-file scan: the trace says `skipped:rules_given`, not
/// `single_file` (that part fails before this change). A session that has given
/// nothing still hears the rules, after its scan.
#[test]
fn an_edit_whose_rules_were_all_given_says_nothing_and_scans_nothing() {
    let (dir, wrap) = routes();
    let r = dir.path();
    let trace = r.join("trace.jsonl");
    hook(r, &trace, "s1", "SessionStart", json!({ "source": "startup" }));

    let (first, path) = hook(r, &trace, "s1", "PreToolUse", edit_tool(r, "app/api/r05/route.ts"));
    assert_eq!(path, "single_file", "the first edit reads the file's facts");
    let v: Value = serde_json::from_str(&first).expect("rules said");
    let said = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
    assert!(
        said.starts_with("drift: conventions for app/api/r05/route.ts before this edit"),
        "{said}"
    );
    assert!(said.contains(&format!("- [{wrap}] (blocks) ")), "{said}");
    assert!(said.contains("- [D-000000] "), "{said}");

    for rel in ["app/api/r05/route.ts", "app/api/r06/route.ts"] {
        let (out, path) = hook(r, &trace, "s1", "PreToolUse", edit_tool(r, rel));
        assert_eq!(out, "", "{rel}: every rule was given, nothing is said");
        assert_eq!(path, "skipped:rules_given", "{rel}");
    }

    // Another session: nothing given yet, so the scan and the rules, as before.
    hook(r, &trace, "s2", "SessionStart", json!({ "source": "startup" }));
    let (out, path) = hook(r, &trace, "s2", "PreToolUse", edit_tool(r, "app/api/r06/route.ts"));
    assert_eq!(path, "single_file");
    assert!(
        out.contains("drift: conventions for app/api/r06/route.ts before this edit"),
        "{out}"
    );
}
