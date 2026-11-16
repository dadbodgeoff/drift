//! A practice a person promoted to a convention (`drift practices promote`) reaches every
//! per-file surface, not only `drift check`: `drift card` lists it for a file of its place
//! that has (or, not written yet, will have) a unit of its concern, the rules an agent
//! gets before it writes a new file (MCP `drift_rules_for`, the PreToolUse hook) include
//! it, and the text an agent gets for a violation of it says what to do. A file outside
//! the place, or one in it that declares no entry point, is not held to it. The
//! convention's role holds no file, so all of this is read from its place and the file's
//! facts, never from a name. End to end on the TypeScript repository of the promote
//! brief: 40 route files in `app/api`, 38 wrapped in `withAuth`, 2 not.
//!
//! Nothing here sets the test switch that turns the show policy off: the person's
//! `agents: show`, which promotion writes, is what admits the convention.

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

/// `drift ARGS` in `root`, which must succeed: its standard output.
fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args, None);
    assert_eq!(code, Some(0), "{args:?} failed:\n{out}\n{err}");
    out
}

/// A Claude Code hook: its `additionalContext`, if it says anything.
fn hook(root: &Path, session: &str, event: &str, extra: Value) -> Option<String> {
    let mut input = json!({ "session_id": session, "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (code, out, err) = run(root, &["hook", "claude", event], Some(&input.to_string()));
    assert_eq!(code, Some(0), "hooks always exit 0: {err}");
    let out = out.trim();
    if out.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(out).expect("hook output is JSON");
    v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .map(str::to_string)
}

/// MCP tool calls, one reply text each.
fn mcp(root: &Path, calls: &[(&str, Value)]) -> Vec<String> {
    let input: String = calls
        .iter()
        .enumerate()
        .map(|(i, (name, args))| {
            format!(
                "{}\n",
                json!({"jsonrpc":"2.0","id":i + 1,"method":"tools/call","params":{"name":name,"arguments":args}})
            )
        })
        .collect();
    let (_, out, err) = run(root, &["mcp"], Some(&input));
    out.lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap_or_else(|e| panic!("{e}: {l}\n{err}"));
            v["result"]["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("{v}"))
                .to_string()
        })
        .collect()
}

const AUTH: &str = r#"type Handler = (req: Request) => Promise<Response>;

export function withAuth(h: Handler): Handler {
  return async (req) => {
    if (!req.headers.get("authorization")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return h(req);
  };
}
"#;

const WRAPPED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

const OPEN: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// A helper: no entry point.
const HELPER: &str = "export function slugify(s: string) {\n  return s.toLowerCase();\n}\n";

fn route(n: usize) -> String {
    format!("app/api/r{n:02}/route.ts")
}

/// The brief's repository after `drift init` and `drift practices promote <P-id> --in
/// app/api`: 38 routes wrapped in `withAuth`, `r38` and `r39` not, and 30 helpers in
/// `lib`. The directory and the promoted convention's id.
fn promoted() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for n in 0..40 {
        write(r, &route(n), if n < 38 { WRAPPED } else { OPEN });
    }
    for n in 0..30 {
        write(
            r,
            &format!("lib/h{n:02}.ts"),
            &format!("export function h{n:02}() {{ return {n}; }}\n"),
        );
    }
    drift(r, &["init"]);
    // The authn variant labelled `wrap withAuth` (`drift practices --json`).
    let map: Value = serde_json::from_str(&drift(r, &["practices", "--json"])).unwrap();
    let variant = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["id"] == "authn")
        .flat_map(|c| c["variants"].as_array().unwrap())
        .find(|x| x["label"] == "wrap withAuth")
        .and_then(|x| x["id"].as_str())
        .unwrap_or_else(|| panic!("no `wrap withAuth` variant: {map:#}"))
        .to_string();
    assert_eq!(variant, "P-0f0acb");
    let out = drift(
        r,
        &[
            "practices",
            "promote",
            &variant,
            "--in",
            "app/api",
            "--json",
        ],
    );
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
    assert_eq!(v["written"], true, "{v:#}");
    let id = v["convention"]["id"].as_str().unwrap().to_string();
    assert_eq!(id, "D-d67d54", "{v:#}");
    assert_eq!(
        v["convention"]["summary"], "Sign-in in app/api: wrapped in withAuth",
        "{v:#}"
    );
    (dir, id)
}

/// The line `drift card` lists the promoted practice with.
fn card_line(id: &str) -> String {
    format!(
        "  [{id}] Sign-in in app/api: wrapped in withAuth (38/40 follow it, advises); copy app/api/r00/route.ts#GET"
    )
}

#[test]
fn the_card_of_a_route_in_the_place_lists_the_promoted_practice() {
    let (dir, id) = promoted();
    let r = dir.path();
    // A route that follows it, and one recorded as breaking it.
    for rel in [route(0), route(38)] {
        let out = drift(r, &["card", &rel]);
        assert!(out.contains(&card_line(&id)), "{rel}:\n{out}");
    }
}

#[test]
fn the_card_of_a_route_not_written_yet_in_the_place_lists_it() {
    let (dir, id) = promoted();
    let r = dir.path();
    let out = drift(r, &["card", "app/api/brandnew/route.ts"]);
    assert!(out.contains(&card_line(&id)), "{out}");
}

#[test]
fn a_file_outside_the_place_is_not_held_to_it() {
    let (dir, id) = promoted();
    let r = dir.path();
    // A helper, a file not written yet, and a route of another directory.
    write(r, "app/admin/x/route.ts", OPEN);
    for rel in ["lib/h00.ts", "lib/brandnew.ts", "app/admin/x/route.ts"] {
        let out = drift(r, &["card", rel]);
        assert!(!out.contains(&id), "{rel}:\n{out}");
    }
}

#[test]
fn a_helper_in_the_place_with_no_entry_point_is_not_held_to_it() {
    let (dir, id) = promoted();
    let r = dir.path();
    write(r, "app/api/util.ts", HELPER);
    // Written: its facts declare no entry point. Not written yet: no file of its name
    // declares one in the package, and no directory where files of any name do holds it.
    for rel in ["app/api/util.ts", "app/api/r00/helpers.ts"] {
        let out = drift(r, &["card", rel]);
        assert!(!out.contains(&id), "{rel}:\n{out}");
    }
}

#[test]
fn drift_rules_for_gives_it_for_a_new_route_by_its_content() {
    let (dir, id) = promoted();
    let r = dir.path();
    let replies = mcp(
        r,
        &[
            (
                "drift_rules_for",
                json!({ "path": "app/api/r40/route.ts", "content": OPEN }),
            ),
            (
                "drift_rules_for",
                json!({ "path": "app/api/r40/slug.ts", "content": HELPER }),
            ),
        ],
    );
    let line = replies[0]
        .lines()
        .find(|l| l.contains(&format!("[{id}]")))
        .unwrap_or_else(|| panic!("{}", replies[0]));
    assert!(
        line.contains("Sign-in in app/api: wrapped in withAuth (38/40 follow it")
            && line.contains("advises")
            && line.ends_with("; copy app/api/r00/route.ts#GET"),
        "{line}"
    );
    // A helper of the place declares no entry point: not its rule.
    assert!(!replies[1].contains(&id), "{}", replies[1]);
}

#[test]
fn the_pre_tool_use_hook_gives_it_before_a_new_route_is_written() {
    let (dir, id) = promoted();
    let r = dir.path();
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));
    let write_tool = |rel: &str, content: &str| json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(rel), "content": content } });
    let said = hook(
        r,
        "s1",
        "PreToolUse",
        write_tool("app/api/r40/route.ts", OPEN),
    )
    .expect("the rules for a new route");
    let line = said
        .lines()
        .find(|l| l.starts_with("- ") && l.contains(&format!("[{id}]")))
        .unwrap_or_else(|| panic!("{said}"));
    assert!(
        line.contains("Sign-in in app/api: wrapped in withAuth (38/40 follow it)")
            && line.ends_with("; copy app/api/r00/route.ts#GET"),
        "{line}"
    );
    // A new helper of the place declares no entry point: not its rule.
    let helper = hook(
        r,
        "s2",
        "PreToolUse",
        write_tool("app/api/r40/slug.ts", HELPER),
    )
    .unwrap_or_default();
    assert!(!helper.contains(&id), "{helper}");
}

#[test]
fn the_agent_text_for_a_violation_says_what_to_do() {
    let (dir, id) = promoted();
    let r = dir.path();
    let fix = "  fix  handle sign-in the way app/api/r00/route.ts#GET does\n";
    hook(r, "s1", "SessionStart", json!({ "source": "startup" }));
    write(r, &route(40), OPEN);
    // After the edit (PostToolUse).
    let post = hook(
        r,
        "s1",
        "PostToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(route(40)) } }),
    )
    .expect("the new route breaks the promoted practice");
    assert!(post.contains(&format!("[{id}]")), "{post}");
    assert!(post.contains(fix), "{post}");
    // MCP `drift_check`.
    let replies = mcp(r, &[("drift_check", json!({ "paths": [route(40)] }))]);
    assert!(replies[0].contains(&format!("[{id}]")), "{}", replies[0]);
    assert!(replies[0].contains(fix), "{}", replies[0]);
    // A route that follows it has nothing to fix.
    write(r, &route(40), WRAPPED);
    let replies = mcp(r, &[("drift_check", json!({ "paths": [route(40)] }))]);
    assert!(!replies[0].contains(fix), "{}", replies[0]);
}
