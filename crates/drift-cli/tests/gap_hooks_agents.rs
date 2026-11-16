//! Gap hooks-agents: Drift's hooks have an agent-neutral core with one adapter per agent
//! (`crates/drift-cli/src/hook_agents/`). Claude Code's adapter is the core's own form
//! (every other hook test pins it, unchanged); `drift hook generic <event>` is Drift's
//! own protocol (experimental) for a wrapper around another agent's hooks. These tests
//! feed that protocol's payloads end to end and pin that it gets what Claude Code gets
//! from the same core: the rules before a new file, advice after an edit, refusals of
//! writes to Drift's own files, the end-of-turn block with its loop guard, and that a
//! payload it cannot read fails open with a note.

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

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String) {
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env_remove("DRIFT_CACHE_DIR")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    } else {
        drop(child.stdin.take());
    }
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
    )
}

/// 40 routes (38 guarded, 2 legacy unguarded) with the withAuth convention accepted in
/// block mode, as `hooks.rs` builds it. Returns the convention's id.
fn repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|block| block.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    run(r, &["review", "--block", &id], None);
    (dir, id)
}

/// One `drift hook generic <event>`: its answer (`None`: nothing printed). Exits 0.
fn generic(root: &Path, session: &str, event: &str, extra: Value) -> Option<Value> {
    let mut input = json!({ "session_id": session, "cwd": root });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    raw(root, event, &input.to_string())
}

fn raw(root: &Path, event: &str, stdin: &str) -> Option<Value> {
    let (code, out) = run(root, &["hook", "generic", event], Some(stdin));
    assert_eq!(code, 0, "hooks always exit 0");
    let out = out.trim();
    let v: Option<Value> =
        (!out.is_empty()).then(|| serde_json::from_str(out).expect("hook output is JSON"));
    // Only the protocol's own fields, never Claude Code's.
    if let Some(Value::Object(o)) = &v {
        for k in o.keys() {
            assert!(
                ["decision", "reason", "context", "message"].contains(&k.as_str()),
                "{k} in {out}"
            );
        }
    }
    v
}

/// One `drift hook claude <event>`, as `hooks.rs` sends it.
fn claude(root: &Path, session: &str, event: &str, extra: Value) -> Option<Value> {
    let mut input = json!({ "session_id": session, "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (code, out) = run(root, &["hook", "claude", event], Some(&input.to_string()));
    assert_eq!(code, 0, "hooks always exit 0");
    let out = out.trim();
    (!out.is_empty()).then(|| serde_json::from_str(out).expect("hook output is JSON"))
}

fn field<'v>(v: &'v Option<Value>, k: &str) -> &'v str {
    v.as_ref().and_then(|v| v[k].as_str()).unwrap_or("")
}

/// Pins: through `drift hook generic`, a new file in a known role is primed with its
/// rules once, an unguarded route is advised after the edit, the end of the turn blocks
/// on it and then steps aside when no progress is made, writes to `.drift/` and
/// `drift.lock` are refused for edits and shell commands alike, a read-only lookup is
/// approved, and a fixed turn ends in silence.
#[test]
fn generic_hooks_prime_advise_block_and_protect_policy() {
    let (dir, id) = repo();
    let r = dir.path();
    let new_file = r.join("app/api/new/route.ts");

    let start = generic(r, "g1", "session-start", json!({ "source": "startup" }));
    assert!(
        field(&start, "context").contains("drift example"),
        "{start:?}"
    );

    let pre = generic(r, "g1", "before-edit", json!({ "file_path": new_file }));
    let ctx = field(&pre, "context");
    assert!(ctx.contains("withAuth") && ctx.contains(&id), "{pre:?}");
    assert!(pre.as_ref().unwrap().get("decision").is_none(), "{pre:?}");
    // Once per role.
    assert!(generic(r, "g1", "before-edit", json!({ "file_path": new_file })).is_none());

    write(r, "app/api/new/route.ts", UNGUARDED);
    let post = generic(
        r,
        "g1",
        "after-edit",
        json!({ "file_path": "app/api/new/route.ts" }),
    );
    assert!(field(&post, "context").contains("advice"), "{post:?}");
    assert!(post.as_ref().unwrap().get("decision").is_none());

    let stop = generic(r, "g1", "end-of-turn", json!({ "after_block": false }));
    assert_eq!(field(&stop, "decision"), "block", "{stop:?}");
    assert!(field(&stop, "reason").contains("app/api/new/route.ts"));

    // No progress: the loop guard steps aside and tells the person.
    let again = generic(r, "g1", "end-of-turn", json!({ "after_block": true }));
    assert!(
        again.as_ref().unwrap().get("decision").is_none(),
        "{again:?}"
    );
    assert!(field(&again, "message").contains("left for review"));

    for f in [".drift/conventions.yaml", "drift.lock"] {
        let deny = generic(r, "g1", "before-edit", json!({ "file_path": r.join(f) }));
        assert_eq!(field(&deny, "decision"), "deny", "{f}: {deny:?}");
        assert!(field(&deny, "reason").contains("drift review"), "{deny:?}");
    }
    let deny = generic(
        r,
        "g1",
        "before-shell",
        json!({ "command": "rm .drift/conventions.yaml" }),
    );
    assert_eq!(field(&deny, "decision"), "deny", "{deny:?}");
    let policy = generic(
        r,
        "g1",
        "before-shell",
        json!({ "command": format!("drift review --accept {id}") }),
    );
    assert_eq!(field(&policy, "decision"), "deny", "{policy:?}");
    let lookup = generic(
        r,
        "g1",
        "before-shell",
        json!({ "command": "drift card app/api/r00/route.ts" }),
    );
    assert_eq!(field(&lookup, "decision"), "allow", "{lookup:?}");

    write(r, "app/api/new/route.ts", GUARDED);
    assert!(generic(r, "g1", "end-of-turn", json!({ "after_block": true })).is_none());
}

/// Pins: the generic adapter is thin. For the same edits, in two sessions of one
/// repository, it tells the agent word for word what Claude Code is told, before and
/// after the edit and at the end of the turn.
#[test]
fn generic_says_what_claude_code_is_told() {
    let (dir, _) = repo();
    let r = dir.path();
    let rel = "app/api/new/route.ts";
    let file = r.join(rel);

    let c_start = claude(r, "c", "SessionStart", json!({ "source": "startup" }));
    let g_start = generic(r, "g", "session-start", json!({ "source": "startup" }));
    assert_eq!(
        c_start.as_ref().unwrap()["hookSpecificOutput"]["additionalContext"],
        g_start.as_ref().unwrap()["context"]
    );

    let c_pre = claude(
        r,
        "c",
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": file, "content": UNGUARDED } }),
    );
    let g_pre = generic(
        r,
        "g",
        "before-edit",
        json!({ "file_path": file, "content": UNGUARDED }),
    );
    let c_ctx = c_pre.as_ref().unwrap()["hookSpecificOutput"]["additionalContext"].clone();
    assert!(c_ctx.as_str().is_some_and(|s| !s.is_empty()), "{c_pre:?}");
    assert_eq!(c_ctx, g_pre.as_ref().unwrap()["context"]);

    write(r, rel, UNGUARDED);
    let c_post = claude(
        r,
        "c",
        "PostToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": file } }),
    );
    let g_post = generic(r, "g", "after-edit", json!({ "file_path": file }));
    assert_eq!(
        c_post.as_ref().unwrap()["hookSpecificOutput"]["additionalContext"],
        g_post.as_ref().unwrap()["context"]
    );

    let c_stop = claude(r, "c", "Stop", json!({ "stop_hook_active": false })).unwrap();
    let g_stop = generic(r, "g", "end-of-turn", json!({})).unwrap();
    assert_eq!(c_stop["decision"], "block");
    assert_eq!(g_stop["decision"], "block");
    assert_eq!(c_stop["reason"], g_stop["reason"]);
}

/// Pins: a payload the protocol cannot read (not JSON, not an object, a field the event
/// needs missing, an event it does not have) never refuses or blocks: the hook exits 0
/// with a note for the person, in a repository with a block-mode convention and in one
/// without a policy.
#[test]
fn generic_hooks_fail_open_on_payloads_they_cannot_read() {
    let (dir, _) = repo();
    let empty = tempfile::tempdir().unwrap();
    for r in [dir.path(), empty.path()] {
        for (event, stdin) in [
            ("end-of-turn", "not json"),
            ("before-edit", "[1, 2]"),
            ("before-edit", "{}"),
            ("before-shell", "{\"command\": 7}"),
            ("Stop", "{}"),
        ] {
            let out = raw(r, event, stdin);
            let o = out.as_ref().expect("a note for the person");
            assert!(o.get("decision").is_none(), "{event} {stdin}: {o}");
            assert!(
                field(&out, "message").starts_with("drift: "),
                "{event} {stdin}: {o}"
            );
        }
    }
    // Without a policy, a readable payload hears nothing, as with Claude Code.
    let none = generic(empty.path(), "g", "end-of-turn", json!({}));
    assert!(none.is_none(), "{none:?}");
}
