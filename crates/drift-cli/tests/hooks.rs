//! End-to-end tests of the `drift` binary: init, review, check (text/SARIF),
//! the Claude Code hook protocol and the MCP server, on a generated repo.

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

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// 40 routes (38 guarded, 2 legacy unguarded) plus helpers, with an accepted blocking convention.
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

fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String) {
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
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

fn hook(root: &Path, event: &str, extra: Value) -> Option<Value> {
    hook_as(root, "s1", event, extra)
}

fn hook_as(root: &Path, session: &str, event: &str, extra: Value) -> Option<Value> {
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

#[test]
fn check_baselines_legacy_and_fails_on_new_code() {
    let (dir, id) = repo();
    let r = dir.path();
    assert_eq!(
        run(r, &["check"], None).0,
        0,
        "legacy violations never fail"
    );
    write(r, "app/api/new/route.ts", UNGUARDED);
    let (code, out) = run(r, &["check"], None);
    assert_eq!(code, 1);
    assert!(
        out.contains(&id) && out.contains("app/api/new/route.ts"),
        "{out}"
    );

    let (_, sarif) = run(r, &["check", "--format", "sarif"], None);
    let s: Value = serde_json::from_str(&sarif).unwrap();
    let results = s["runs"][0]["results"].as_array().unwrap();
    assert_eq!(results.len(), 1, "SARIF lists only new violations");
    assert_eq!(
        results[0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"],
        "app/api/new/route.ts"
    );

    // An explained suppression clears it; an unexplained one does not.
    write(
        r,
        "app/api/new/route.ts",
        &format!("// drift-ignore {id}\n{UNGUARDED}"),
    );
    assert_eq!(run(r, &["check"], None).0, 1);
    write(
        r,
        "app/api/new/route.ts",
        &format!("// drift-ignore {id}: public health endpoint\n{UNGUARDED}"),
    );
    assert_eq!(run(r, &["check"], None).0, 0);
}

#[test]
fn claude_hooks_advise_block_guard_and_protect_policy() {
    let (dir, id) = repo();
    let r = dir.path();
    let new_file = r.join("app/api/new/route.ts");

    let start = hook(r, "SessionStart", json!({})).unwrap();
    assert!(
        start["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap()
            .contains("drift example")
    );

    // Before writing a new file in a known role, the rules are injected.
    let pre = hook(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": new_file } }),
    )
    .unwrap();
    let ctx = pre["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(ctx.contains("withAuth") && ctx.contains(&id), "{ctx}");
    // ...only once per role.
    assert!(
        hook(
            r,
            "PreToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": new_file } })
        )
        .is_none()
    );

    write(r, "app/api/new/route.ts", UNGUARDED);
    let post = hook(
        r,
        "PostToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": new_file } }),
    )
    .unwrap();
    assert!(
        post["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap()
            .contains("advice")
    );
    assert!(
        post.get("decision").is_none(),
        "post-edit hooks never block"
    );

    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block");
    assert!(
        stop["reason"]
            .as_str()
            .unwrap()
            .contains("app/api/new/route.ts")
    );

    // No progress: the loop guard steps aside and tells the person instead.
    let again = hook(r, "Stop", json!({ "stop_hook_active": true })).unwrap();
    assert!(again.get("decision").is_none());
    assert!(
        again["systemMessage"]
            .as_str()
            .unwrap()
            .contains("left for review")
    );

    // Policy files cannot be edited by the agent.
    for f in [".drift/conventions.yaml", "drift.lock"] {
        let deny = hook(
            r,
            "PreToolUse",
            json!({ "tool_name": "Edit", "tool_input": { "file_path": r.join(f) } }),
        )
        .unwrap();
        assert_eq!(
            deny["hookSpecificOutput"]["permissionDecision"], "deny",
            "{f}"
        );
    }

    // Fixed: the turn may end.
    write(r, "app/api/new/route.ts", GUARDED);
    assert!(hook(r, "Stop", json!({ "stop_hook_active": true })).is_none());
}

fn blocks(out: Option<Value>) -> bool {
    out.is_some_and(|v| v["decision"] == "block")
}

fn edit(root: &Path, rel: &str) -> Value {
    json!({ "tool_name": "Write", "tool_input": { "file_path": root.join(rel) } })
}

#[test]
fn resume_keeps_the_session_baseline() {
    let (dir, _) = repo();
    let r = dir.path();
    hook(r, "SessionStart", json!({ "source": "startup" })).unwrap();
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert!(hook(r, "PostToolUse", edit(r, "app/api/new/route.ts")).is_some());
    // `claude --resume`: same session id, SessionStart fires again.
    let resumed = hook(r, "SessionStart", json!({ "source": "resume" })).unwrap();
    assert!(
        resumed["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap()
            .contains("drift example"),
        "context is re-injected"
    );
    // The agent's earlier violation is still new, and was already advised.
    assert!(hook(r, "PostToolUse", edit(r, "app/api/new/route.ts")).is_none());
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false }));
    assert!(blocks(stop.clone()), "{stop:?}");
}

#[test]
fn compaction_keeps_baseline_and_loop_guard() {
    let (dir, _) = repo();
    let r = dir.path();
    hook(r, "SessionStart", json!({ "source": "startup" })).unwrap();
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert!(blocks(hook(
        r,
        "Stop",
        json!({ "stop_hook_active": false })
    )));
    hook(r, "SessionStart", json!({ "source": "compact" })).unwrap();
    // Same unresolved set after compaction: the guard still knows it already blocked.
    let again = hook(r, "Stop", json!({ "stop_hook_active": true })).unwrap();
    assert!(again.get("decision").is_none(), "{again}");
    assert!(
        again["systemMessage"]
            .as_str()
            .unwrap()
            .contains("left for review")
    );
    // A further violation after compaction is still new.
    write(r, "app/api/newer/route.ts", UNGUARDED);
    assert!(blocks(hook(
        r,
        "Stop",
        json!({ "stop_hook_active": false })
    )));
}

#[test]
fn clear_carries_the_baseline_to_the_next_session() {
    let (dir, _) = repo();
    let r = dir.path();
    hook_as(r, "before", "SessionStart", json!({ "source": "startup" })).unwrap();
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert!(hook_as(r, "before", "PostToolUse", edit(r, "app/api/new/route.ts")).is_some());
    // `/clear`: the session ends and a new one (new id) starts.
    assert!(hook_as(r, "before", "SessionEnd", json!({ "reason": "clear" })).is_none());
    hook_as(r, "after", "SessionStart", json!({ "source": "clear" })).unwrap();
    // New context: advice is repeated, and the earlier change still blocks.
    assert!(hook_as(r, "after", "PostToolUse", edit(r, "app/api/new/route.ts")).is_some());
    assert!(blocks(hook_as(r, "after", "Stop", json!({}))));
    // An unrelated new session records what is there now as its baseline.
    hook_as(r, "other", "SessionStart", json!({ "source": "startup" })).unwrap();
    assert!(hook_as(r, "other", "Stop", json!({})).is_none());
}

#[test]
fn sessions_without_an_id_start_fresh() {
    let (dir, _) = repo();
    let r = dir.path();
    let anon = |event: &str, extra: Value| {
        let mut input = json!({ "cwd": r, "hook_event_name": event });
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (_, out) = run(r, &["hook", "claude", event], Some(&input.to_string()));
        let out = out.trim().to_string();
        (!out.is_empty()).then(|| serde_json::from_str::<Value>(&out).unwrap())
    };
    anon("SessionStart", json!({ "source": "startup" }));
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert!(blocks(anon("Stop", json!({}))));
    // A later session shares the state file but not the baseline.
    anon("SessionStart", json!({ "source": "startup" }));
    assert!(anon("Stop", json!({})).is_none());
}

fn git(root: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?}");
}

fn message(out: &Option<Value>) -> &str {
    out.as_ref()
        .and_then(|v| v["systemMessage"].as_str())
        .unwrap_or_default()
}

#[test]
fn missing_state_without_git_fails_open_and_says_so() {
    let (dir, _) = repo();
    let r = dir.path();
    write(r, "app/api/new/route.ts", UNGUARDED);
    // No SessionStart ran and no git: what is there becomes the baseline, and the
    // person is told.
    let out = hook_as(r, "late", "Stop", json!({}));
    assert!(!blocks(out.clone()), "{out:?}");
    assert!(
        message(&out).contains("state was missing; 1 current violation(s) were taken"),
        "{out:?}"
    );
    write(r, "app/api/newer/route.ts", UNGUARDED);
    assert!(blocks(hook_as(r, "late", "Stop", json!({}))));
}

#[test]
fn deleted_or_garbled_state_still_blocks_on_touched_files() {
    let (dir, _) = repo();
    let r = dir.path();
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "init"]);
    hook(r, "SessionStart", json!({ "source": "startup" })).unwrap();
    write(r, "app/api/r05/route.ts", UNGUARDED);
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert!(blocks(hook(r, "Stop", json!({}))));
    // The agent clears Drift's cache mid-session (Bash is not covered by the
    // PreToolUse deny): its own changes still block, and the person is told.
    std::fs::remove_dir_all(r.join(".drift/cache")).unwrap();
    let out = hook(r, "Stop", json!({}));
    assert!(blocks(out.clone()), "{out:?}");
    let reason = out.as_ref().unwrap()["reason"].as_str().unwrap();
    assert!(
        reason.contains("app/api/r05/route.ts") && reason.contains("app/api/new/route.ts"),
        "{reason}"
    );
    assert!(
        message(&out)
            .contains("state was missing; 0 current violation(s) were taken as its baseline, none of them JavaScript/TypeScript"),
        "{out:?}"
    );

    let state = r.join(".drift/cache/sessions/torn.json");
    std::fs::write(&state, "{\"baseline\": [").unwrap();
    let out = hook_as(r, "torn", "Stop", json!({}));
    assert!(
        blocks(out.clone()) && message(&out).contains("state was missing"),
        "{out:?}"
    );
    std::fs::write(&state, "not json").unwrap();
    // Resuming a session whose state is unreadable keeps the agent's changes new.
    let start = hook_as(r, "torn", "SessionStart", json!({ "source": "resume" }));
    assert!(message(&start).contains("state was missing"), "{start:?}");
    assert!(blocks(hook_as(r, "torn", "Stop", json!({}))));
}

/// A Write whose content nests far deeper than the default stack allows (one bracket
/// per line, so only the nesting gate catches it).
fn deeply_nested() -> String {
    format!(
        "export const x = {}0{};\n",
        "[\n".repeat(20_000),
        "]\n".repeat(20_000)
    )
}

#[test]
fn deeply_nested_content_does_not_crash_priming() {
    let (dir, _) = repo();
    let r = dir.path();
    let content = deeply_nested();
    let ti = json!({ "file_path": r.join("app/api/deep/route.ts"), "content": content });
    // `hook` asserts exit 0.
    hook(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": ti }),
    );
    let one_line = format!(
        "export const x = {}0{};\n",
        "[".repeat(20_000),
        "]".repeat(20_000)
    );
    let ti = json!({ "file_path": r.join("app/api/flat/route.ts"), "content": one_line });
    assert!(
        hook(
            r,
            "PreToolUse",
            json!({ "tool_name": "Write", "tool_input": ti })
        )
        .is_none(),
        "minified content gets no rules"
    );

    // Inside a template literal's `${...}`, one bracket per line.
    let template = format!(
        "export const x = `${{{}0{}}}`;\n",
        "(\n".repeat(200_000),
        "\n)".repeat(200_000)
    );
    let ti = json!({ "file_path": r.join("app/api/tpl/route.ts"), "content": template });
    assert!(
        hook(
            r,
            "PreToolUse",
            json!({ "tool_name": "Write", "tool_input": ti })
        )
        .is_none(),
        "content nested too deep gets no rules"
    );
    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/deep/route.ts","content":content}}}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/tpl/route.ts","content":template}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (code, out) = run(r, &["mcp"], Some(&input));
    assert_eq!(code, 0);
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 3, "the server survives: {out}");
    assert_eq!(replies[2]["id"], 2);
    assert!(replies[2]["result"]["tools"].is_array());
}

#[test]
fn deep_code_after_a_regex_does_not_crash_priming() {
    let (dir, _) = repo();
    let r = dir.path();
    // The backtick and quotes inside the regex open no template or string that
    // would hide the nesting after it from the guard.
    let content = format!(
        "declare const s: string;\nif (s) /[`'/]\"/.test(s);\nexport const x = {}0{};\nconst t = `x`;\n",
        "(\n".repeat(200_000),
        "\n)".repeat(200_000)
    );
    let ti = json!({ "file_path": r.join("app/api/regex/route.ts"), "content": content });
    // `hook` asserts exit 0.
    hook(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": ti }),
    );

    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/regex/route.ts","content":content}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (code, out) = run(r, &["mcp"], Some(&input));
    assert_eq!(code, 0);
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 2, "the server survives: {out}");
    assert_eq!(replies[1]["id"], 2);
    assert!(replies[1]["result"]["tools"].is_array());
}

/// Nesting the guard does not count (the `<` of a type argument list, one per line)
/// is parsed, and cannot crash anything either: every parse runs on a stack sized
/// for a file of its length that nests at every byte.
#[test]
fn uncounted_deep_generics_do_not_crash_scan_hooks_or_mcp() {
    let (dir, _) = repo();
    let r = dir.path();
    let content = format!("type T = {}", "A<\n".repeat(150_000));
    assert!(!drift_core::nesting::too_deep(
        &content,
        drift_core::nesting::Syntax::CLike
    ));
    write(r, "lib/generics.ts", &content);
    assert_eq!(run(r, &["scan"], None).0, 0);

    let rel = "app/api/generics/route.ts";
    let ti = json!({ "file_path": r.join(rel), "content": content });
    // `hook` asserts exit 0.
    hook(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": ti }),
    );
    write(r, rel, &content);
    hook(r, "PostToolUse", edit(r, rel));

    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":rel,"content":content}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (code, out) = run(r, &["mcp"], Some(&input));
    assert_eq!(code, 0);
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 2, "the server survives: {out}");
    assert_eq!(replies[1]["id"], 2);
    assert!(replies[1]["result"]["tools"].is_array());
}

/// `drift <args>` in `root` under `ulimit -v <limit_kib>` (none: no limit), with the
/// cache in the repo: exit code, stdout, stderr.
#[cfg(target_os = "linux")]
fn limited(root: &Path, limit_kib: Option<u64>, args: &str) -> (i32, String, String) {
    let ulimit = limit_kib.map_or(String::new(), |k| format!("ulimit -v {k} && "));
    let out = Command::new("sh")
        .env("DRIFT_TEST_UNSHOWN", "1")
        .arg("-c")
        .arg(format!("{ulimit}exec {BIN} {args}", BIN = *BIN))
        .env_remove("DRIFT_CACHE_DIR")
        .current_dir(root)
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// The files and the skipped files (`path:reason`) of `drift scan --json`.
#[cfg(target_os = "linux")]
fn scanned(root: &Path, limit_kib: Option<u64>, args: &str) -> (Vec<String>, Vec<String>) {
    let (code, out, err) = limited(root, limit_kib, &format!("{args} scan --json"));
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let files = v["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap().to_string())
        .collect();
    let skipped = v["skipped"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            format!(
                "{}:{}",
                s["path"].as_str().unwrap(),
                s["reason"].as_str().unwrap()
            )
        })
        .collect();
    (files, skipped)
}

/// 3 GB: less than a file of 600 KB needs (2.4 GiB in release builds, 4.7 GiB in
/// debug builds) plus the heap's headroom, whatever the machine's memory.
#[cfg(target_os = "linux")]
const LIMIT_KIB: u64 = 3_000_000;

/// A repo with a short TypeScript and Python file each, `lib/deep.ts` (600 KB of
/// uncounted unary nesting) and `app/long.py` (600 KB of flat code): the long files are
/// parsed where a stack for their length can be had, skipped for lack of stack
/// where not.
#[cfg(target_os = "linux")]
const ALL_FILES: [&str; 4] = ["app/long.py", "app/views.py", "lib/deep.ts", "lib/small.ts"];
#[cfg(target_os = "linux")]
const LONG_SKIPPED: [&str; 2] = [
    "app/long.py:stack_unavailable",
    "lib/deep.ts:stack_unavailable",
];

#[cfg(target_os = "linux")]
fn long_file_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(r, "lib/small.ts", "export const a = 1;\n");
    write(
        r,
        "lib/deep.ts",
        // Not `A<` generics: a type nested that deep is skipped as too costly before
        // any stack is reserved (`drift_core::speculation`, #47).
        &format!("export const x =\n{}1;\n", "!\n".repeat(300_000)),
    );
    write(r, "app/views.py", "def f():\n    return 1\n");
    write(r, "app/long.py", &"x = 1\n".repeat(100_000));
    // Past the scan index's racy window (2 s), so later scans trust its entries
    // rather than read the files again.
    std::thread::sleep(std::time::Duration::from_millis(2200));
    dir
}

/// Under an address-space limit too small for the stack a long file needs, whatever
/// the machine's memory, a scan still finishes, and the file is skipped for lack of
/// stack (not as too deep, and not left out).
#[cfg(target_os = "linux")]
#[test]
fn a_scan_under_an_address_space_limit_skips_what_it_cannot_parse_and_finishes() {
    let dir = long_file_repo();
    let r = dir.path();
    let (files, skipped) = scanned(r, Some(LIMIT_KIB), "--no-cache");
    assert_eq!(files, ["app/views.py", "lib/small.ts"]);
    assert_eq!(skipped, LONG_SKIPPED);
    let (files, skipped) = scanned(r, None, "--no-cache");
    assert_eq!(files, ALL_FILES);
    assert!(skipped.is_empty(), "{skipped:?}");
}

/// A skip for lack of stack depends on the process, not the content: the scan index
/// does not keep it, so a later scan with room parses the file.
#[cfg(target_os = "linux")]
#[test]
fn a_skip_for_lack_of_stack_is_not_cached() {
    let dir = long_file_repo();
    let r = dir.path();
    let (_, skipped) = scanned(r, Some(LIMIT_KIB), "");
    assert_eq!(skipped, LONG_SKIPPED);
    let (files, skipped) = scanned(r, None, "");
    assert_eq!(files, ALL_FILES);
    assert!(skipped.is_empty(), "{skipped:?}");
}

/// A file the index vouches for whose facts are no longer cached is lowered again;
/// where no stack for it can be had, it is skipped for lack of stack, not dropped
/// from both `files` and `skipped`.
#[cfg(target_os = "linux")]
#[test]
fn a_file_the_index_knows_but_cannot_lower_is_skipped_not_dropped() {
    let dir = long_file_repo();
    let r = dir.path();
    let (files, _) = scanned(r, None, "");
    assert_eq!(files, ALL_FILES);
    for e in std::fs::read_dir(r.join(".drift/cache")).unwrap().flatten() {
        if e.file_name().to_string_lossy().starts_with("facts-") {
            std::fs::remove_dir_all(e.path()).unwrap();
        }
    }
    let (files, skipped) = scanned(r, Some(LIMIT_KIB), "");
    assert_eq!(files, ["app/views.py", "lib/small.ts"]);
    assert_eq!(skipped, LONG_SKIPPED);
    let (files, skipped) = scanned(r, None, "");
    assert_eq!(files, ALL_FILES);
    assert!(skipped.is_empty(), "{skipped:?}");
}

/// Single-file scans (the PostToolUse path) give the same facts as a full scan,
/// linter configs included, with and without an address-space limit: the JavaScript
/// config is parsed on a stack of its own size, not dropped when a large one cannot
/// be had.
#[cfg(target_os = "linux")]
#[test]
fn single_file_scans_keep_linter_configs_under_an_address_space_limit() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "eslint.config.js",
        "export default [{ rules: { \"no-console\": \"error\" } }];\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/a.py",
        "from . import b\n\ndef f():\n    return b.g()\n",
    );
    write(r, "app/b.py", "def g():\n    return 1\n");
    write(r, "web/c.ts", "export const c = 1;\n");
    for limit in [None, Some(LIMIT_KIB)] {
        let (code, out, err) = limited(r, limit, "scan --json");
        assert_eq!(code, 0, "{err}");
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["lint"][0]["rules"][0]["rule"], "no-console", "{limit:?}");
        for _ in 0..3 {
            let (code, out, err) = limited(r, limit, "debug incremental");
            assert_eq!(code, 0, "{err}");
            assert!(out.contains(", 0 mismatches"), "{limit:?}: {out}{err}");
            assert!(!out.contains("mismatch:"), "{limit:?}: {out}");
        }
    }
}

/// `src/emails/**` holds components that render `<BaseEmailWrapper>` and plain helper
/// functions; `src/lib/**` functions pass `level` to `log()`. Both conventions are accepted
/// and shown to agents (`--show-to-agents`: their families are below the admission bar,
/// so accepting alone would keep them from agents; see
/// `suggestions_below_the_admission_bar_reach_people_not_agents`).
fn mixed_repo() -> tempfile::TempDir {
    let dir = mixed_repo_proposed();
    let r = dir.path();
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    // [FIX1-G1] S10: `init` also writes a from-map proposal (`from_map:`, "Responses in
    // the root package"), left proposed here: the three mined conventions are the ones
    // these tests are about.
    let ids: Vec<&str> = yaml
        .split("- id: ")
        .skip(1)
        .filter(|b| !b.contains("\n  from_map: "))
        .map(|b| &b[..8])
        .collect();
    assert_eq!(ids.len(), 3, "{yaml}");
    assert_eq!(yaml.matches("\n  from_map: ").count(), 1, "{yaml}");
    run(r, &["review", "--show-to-agents", &ids.join(",")], None);
    dir
}

/// The same repo after `drift init`, nothing reviewed yet: three conventions, HTTP
/// handlers wrapped in `withAuth()` (a call wrapper: default tier), emails rendered inside
/// `<BaseEmailWrapper>` (a JSX wrapper: a suggestion since decision D7) and helpers that
/// pass `level` to `log()` (a suggestion; TypeScript call rules are not proposed).
fn mixed_repo_proposed() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 10..40 {
        let route = if i < 38 {
            "import { withAuth } from \"../../../lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n"
        } else {
            "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n"
        };
        write(r, &format!("app/api/r{i}/route.ts"), route);
    }
    write(
        r,
        "src/ui/base.tsx",
        "export function BaseEmailWrapper(p: any) {\n  return <div>{p.children}</div>;\n}\n",
    );
    write(
        r,
        "src/lib/log.ts",
        "export function log(m: { level?: string }) {}\n",
    );
    for i in 10..40 {
        let email = if i < 39 {
            format!(
                "import {{ BaseEmailWrapper }} from \"../ui/base\";\n\nexport function Email{i}() {{\n  return <BaseEmailWrapper><p>hi</p></BaseEmailWrapper>;\n}}\n"
            )
        } else {
            format!("export function Email{i}() {{\n  return <p>hi</p>;\n}}\n")
        };
        write(r, &format!("src/emails/e{i}.tsx"), &email);
        let util = if i < 39 {
            format!(
                "import {{ log }} from \"./log\";\n\nexport function util{i}() {{\n  log({{ level: \"x\" }});\n  return {i};\n}}\n"
            )
        } else {
            format!(
                "import {{ log }} from \"./log\";\n\nexport function util{i}() {{\n  log({{}});\n  return {i};\n}}\n"
            )
        };
        write(r, &format!("src/lib/u{i}.ts"), &util);
    }
    for i in 10..30 {
        write(
            r,
            &format!("src/ui/c{i}.tsx"),
            &format!("export function Card{i}() {{\n  return <div>c</div>;\n}}\n"),
        );
        write(
            r,
            &format!("src/other/o{i}.ts"),
            &format!("export function other{i}() {{\n  return {i};\n}}\n"),
        );
        write(
            r,
            &format!("src/emails/h{i}.ts"),
            &format!("export function helper{i}() {{\n  return {i};\n}}\n"),
        );
    }
    run(r, &["init"], None);
    dir
}

fn write_tool(root: &Path, rel: &str, content: Option<&str>) -> Value {
    let mut ti = json!({ "file_path": root.join(rel) });
    if let Some(c) = content {
        ti["content"] = json!(c);
    }
    json!({ "tool_name": "Write", "tool_input": ti })
}

#[test]
fn new_file_priming_follows_what_the_file_declares() {
    let dir = mixed_repo();
    let r = dir.path();
    let router = "export async function routes(app: any) {\n  app.get(\"/x\", async () => 1);\n}\n";
    // A plain function module next to the emails is not told how components render.
    assert!(
        hook(
            r,
            "PreToolUse",
            write_tool(r, "src/emails/router.ts", Some(router))
        )
        .is_none()
    );
    let email = "export function Welcome() {\n  return <p>hi</p>;\n}\n";
    let pre = hook(
        r,
        "PreToolUse",
        write_tool(r, "src/emails/welcome.tsx", Some(email)),
    )
    .unwrap();
    let ctx = pre["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        ctx.contains("BaseEmailWrapper") && !ctx.contains("log()"),
        "{ctx}"
    );
    assert!(!ctx.contains('<'), "markup is escaped: {ctx}");

    // Without content the rules are grouped by what they apply to.
    let pre = hook_as(
        r,
        "s2",
        "PreToolUse",
        write_tool(r, "src/emails/x.tsx", None),
    )
    .unwrap();
    let ctx = pre["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(ctx.contains("if it exports components: [D-"), "{ctx}");
    // Files that are not analysed get no rules.
    assert!(
        hook_as(
            r,
            "s3",
            "PreToolUse",
            write_tool(r, "src/emails/notes.md", Some("# hi\n"))
        )
        .is_none()
    );
    let (_, out) = run(r, &["example", "src/emails/new.tsx"], None);
    assert!(
        out.starts_with("if it exports components:\n  src/emails/"),
        "{out}"
    );
    let (_, out) = run(r, &["example", "src/emails/e10.tsx"], None);
    assert!(
        out.starts_with("src/emails/e10.tsx#Email10  ([D-") && out.contains("] components"),
        "{out}"
    );
}

#[test]
fn hooks_are_silent_without_policy_and_fail_open_on_garbage() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    assert!(hook(r, "Stop", json!({})).is_none());
    let (code, out) = run(r, &["hook", "claude", "Stop"], Some("not json"));
    assert_eq!(code, 0);
    assert!(out.trim().is_empty());
}

#[test]
fn mcp_server_speaks_json_rpc() {
    let (dir, id) = repo();
    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/brand-new/route.ts"}}}),
        json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"drift_example","arguments":{"path":"../outside.ts"}}}),
        json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/brand-new/route.ts","content":"export const config = 1;\n"}}}),
        json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/brand-new/route.ts","content":UNGUARDED}}}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, out) = run(dir.path(), &["mcp"], Some(&input));
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 6, "notifications get no reply");
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "drift");
    assert_eq!(replies[1]["result"]["tools"].as_array().unwrap().len(), 12);
    assert!(
        replies[2]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains(&id)
    );
    assert!(
        replies[3]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("outside the repository")
    );
    // With planned content, only rules for what it declares.
    let t = |i: usize| replies[i]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(t(4).starts_with("No accepted conventions"), "{}", t(4));
    assert!(t(5).contains(&id) && !t(5).contains("if it"), "{}", t(5));
}

#[test]
fn export_splices_agents_md() {
    let (dir, id) = repo();
    let r = dir.path();
    write(r, "AGENTS.md", "# Agents\n\nBe nice.\n");
    run(r, &["export", "agents-md", "--write", "AGENTS.md"], None);
    run(r, &["export", "agents-md", "--write", "AGENTS.md"], None);
    let md = std::fs::read_to_string(r.join("AGENTS.md")).unwrap();
    assert!(md.starts_with("# Agents\n\nBe nice.\n"));
    assert_eq!(
        md.matches("drift:start").count(),
        1,
        "re-export replaces the block"
    );
    assert!(md.contains("withAuth") && md.contains(", blocks)"), "{md}");
    assert!(md.contains("### Rules (1 block: "), "{md}");
    assert!(!md.to_lowercase().contains("enforc"), "{md}");
    let _ = id;
}

/// Every text an agent can read from Drift on `r` in one session: SessionStart, the
/// priming before a new route and a new helper, PostToolUse after each is written with a
/// violation, Stop, UserPromptSubmit, every MCP tool (and the tool list), and the
/// AGENTS.md export.
fn agent_texts(r: &Path, ids: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |v: Option<Value>| {
        if let Some(v) = v {
            out.push(v.to_string());
        }
    };
    push(hook(r, "SessionStart", json!({ "source": "startup" })));
    let util = "import { log } from \"./log\";\n\nexport function util99() {\n  log({});\n  return 1;\n}\n";
    for (rel, body) in [
        ("app/api/new/route.ts", UNGUARDED),
        ("src/lib/u99.ts", util),
    ] {
        push(hook(r, "PreToolUse", write_tool(r, rel, Some(body))));
        write(r, rel, body);
        push(hook(r, "PostToolUse", edit(r, rel)));
    }
    push(hook(r, "Stop", json!({ "stop_hook_active": false })));
    push(hook(r, "UserPromptSubmit", json!({ "prompt": "go on" })));
    let mut msgs = vec![
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/other/route.ts"}}}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"drift_example","arguments":{"path":"app/api/other/route.ts"}}}),
        json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"drift_check","arguments":{}}}),
        json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"drift_security","arguments":{}}}),
    ];
    for (i, id) in ids.iter().enumerate() {
        msgs.push(json!({"jsonrpc":"2.0","id":10 + i,"method":"tools/call","params":{"name":"drift_explain","arguments":{"id":id}}}));
    }
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, mcp) = run(r, &["mcp"], Some(&input));
    out.extend(mcp.lines().map(String::from));
    out.push(run(r, &["export", "agents-md"], None).1);
    out
}

/// Accepted convention ids in the policy.
fn accepted_ids(r: &Path) -> Vec<String> {
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    yaml.split("- id: ")
        .skip(1)
        .filter(|b| b.contains("status: accepted"))
        .map(|b| b[..8].to_string())
        .collect()
}

#[test]
fn a_policy_without_blocking_conventions_never_claims_to_block() {
    // Three accepted conventions, all in advise mode (as `drift review --accept` and
    // the default tier ship them).
    let dir = mixed_repo();
    let r = dir.path();
    let ids = accepted_ids(r);
    assert_eq!(ids.len(), 3);
    let texts = agent_texts(r, &ids.iter().map(String::as_str).collect::<Vec<_>>());
    let all = texts.join("\n");
    // The session's opening says so, with the exact count.
    assert!(
        all.contains(
            "Drift: this repo's 3 accepted conventions advise only (0 block at end of turn)."
        ),
        "{all}"
    );
    // The edits were reported (as advice), and the turn ended.
    assert!(
        all.contains("new convention violation(s) (advice)"),
        "{all}"
    );
    assert!(all.contains("### Rules (0 block: "), "{all}");
    for t in &texts {
        let lower = t.to_lowercase();
        assert!(!lower.contains("enforc"), "{t}");
        assert!(
            !lower.replace("0 block", "").contains("block"),
            "says block other than as \"0 block\": {t}"
        );
    }
}

#[test]
fn agent_texts_count_what_blocks_by_the_mode_as_checked() {
    let (dir, id) = repo();
    let r = dir.path();
    let accepted = accepted_ids(r).len();
    let start = hook(r, "SessionStart", json!({})).unwrap();
    let ctx = start["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        ctx.lines().any(|l| l.starts_with(&format!(
            "Drift: 1 of this repo's {accepted} accepted conventions block at end of turn (a new violation stops the turn from ending), {} advise.",
            accepted - 1
        ))),
        "{ctx}"
    );
    assert!(!ctx.to_lowercase().contains("enforc"), "{ctx}");
    // The rule that blocks is marked as it is primed and when it is first reported.
    let new_file = "app/api/new/route.ts";
    let pre = hook(r, "PreToolUse", write_tool(r, new_file, Some(UNGUARDED))).unwrap();
    let pre = pre["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(pre.contains(&format!("[{id}] (blocks) ")), "{pre}");
    assert!(pre.contains("(blocks) marks a rule"), "{pre}");
    write(r, new_file, UNGUARDED);
    let post = hook(r, "PostToolUse", edit(r, new_file)).unwrap();
    let post = post["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        post.starts_with("drift: 1 new convention violation(s) (1 marked (blocks) will block end of turn unless fixed; 0 advice); "),
        "{post}"
    );
    assert!(post.contains(&format!("[{id}] (blocks) ")), "{post}");

    // A hand-edited policy that sets a small role to block: it advises, and every text
    // says so.
    let p = r.join(".drift/conventions.yaml");
    let yaml = std::fs::read_to_string(&p).unwrap();
    let start = yaml.find(&format!("- id: {id}")).unwrap();
    let end = yaml[start + 1..]
        .find("\n- id: ")
        .map_or(yaml.len(), |i| start + 1 + i);
    let block: String = yaml[start..end]
        .lines()
        .map(|l| {
            let t = l.trim_start();
            if t.starts_with("total: ") || t.starts_with("role_members: ") {
                format!(
                    "{}{}: 10",
                    &l[..l.len() - t.len()],
                    &t[..t.find(':').unwrap()]
                )
            } else {
                l.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    // A role of 10 makes it a suggestion whose family is below the admission bar (W0):
    // shown to agents only because the person says so (`agents: show`).
    let block = format!("{block}\n  agents: show");
    std::fs::write(&p, format!("{}{block}{}", &yaml[..start], &yaml[end..])).unwrap();
    assert!(std::fs::read_to_string(&p).unwrap().contains("mode: block"));
    let start = hook_as(r, "s2", "SessionStart", json!({})).unwrap();
    let ctx = start["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        ctx.lines().any(|l| l.starts_with(&format!(
            "Drift: this repo's {accepted} accepted conventions advise only (0 block at end of turn)."
        ))),
        "{ctx}"
    );
    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_explain","arguments":{"id":id}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/other/route.ts"}}}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, out) = run(r, &["mcp"], Some(&input));
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let t = |i: usize| replies[i]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        t(0).contains("mode: advises (was block, now advise because its role had 10 members when it was mined, under the 15 needed to block)"),
        "{}",
        t(0)
    );
    assert!(
        t(1).contains(", advises); copy") && !t(1).contains("blocks"),
        "{}",
        t(1)
    );
    let (_, md) = run(r, &["export", "agents-md"], None);
    assert!(
        md.contains("### Rules (0 block: ") && !md.contains(", blocks)"),
        "{md}"
    );
}

#[test]
fn review_flags_never_block_small_roles() {
    let (dir, id) = repo();
    let r = dir.path();
    let p = r.join(".drift/conventions.yaml");
    // Pretend the role had only 10 members when it was learned.
    let yaml = std::fs::read_to_string(&p).unwrap();
    let start = yaml.find(&format!("- id: {id}")).unwrap();
    let total = start + yaml[start..].find("total: ").unwrap();
    let end = total + yaml[total..].find('\n').unwrap();
    let edited = format!("{}total: 10{}", &yaml[..total], &yaml[end..]);
    std::fs::write(&p, edited).unwrap();
    run(r, &["review", "--block", &id], None);
    let yaml = std::fs::read_to_string(&p).unwrap();
    let block = &yaml[yaml.find(&format!("- id: {id}")).unwrap()..];
    let block = &block[..block[1..].find("\n- id: ").map_or(block.len(), |i| i + 1)];
    assert!(block.contains("status: accepted"), "{block}");
    assert!(block.contains("mode: advise"), "{block}");
}

/// `drift` with its exit code, stdout and stderr.
fn run_full(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// The id of the proposal whose rule has this `type`, from `census --json`.
fn census_ids(root: &Path) -> Vec<(String, String, String)> {
    let (_, out, _) = run_full(root, &["census", "--json"]);
    let v: Value = serde_json::from_str(&out).unwrap();
    v["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["id"].as_str().unwrap().to_string(),
                p["rule_kind"].as_str().unwrap().to_string(),
                p["tier"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn tiers_order_census_and_guard_review() {
    let dir = mixed_repo_proposed();
    let r = dir.path();
    let yaml_path = r.join(".drift/conventions.yaml");
    let yaml = std::fs::read_to_string(&yaml_path).unwrap();
    assert!(
        !yaml.contains("tier"),
        "tiers are computed, never stored: {yaml}"
    );
    // [FIX1-G1] S10: `init` also writes one from-map proposal (`from_map:`); it advises
    // too. `census` (no `--from-map`) lists the three mined ones only.
    assert_eq!(yaml.matches("\n  from_map: ").count(), 1, "{yaml}");
    assert_eq!(
        yaml.matches("\n  mode: advise\n").count(),
        4,
        "init never blocks: {yaml}"
    );
    assert!(
        !yaml.contains("\n  mode: block\n"),
        "init never blocks: {yaml}"
    );

    let props = census_ids(r);
    let kinds: Vec<(&str, &str)> = props
        .iter()
        .map(|(_, k, t)| (k.as_str(), t.as_str()))
        .collect();
    assert_eq!(
        kinds[0],
        ("wrapped_by:call", "default"),
        "default tier first"
    );
    let mut rest = kinds[1..].to_vec();
    rest.sort();
    assert_eq!(
        rest,
        [
            ("passes_key", "suggestion"),
            ("wrapped_by:jsx", "suggestion")
        ],
        "decision D7: a JSX layout wrapper is a suggestion"
    );
    let id_of = |kind: &str| props.iter().find(|p| p.1 == kind).unwrap().0.clone();
    let (wrapper, jsx, calls) = (
        id_of("wrapped_by:call"),
        id_of("wrapped_by:jsx"),
        id_of("passes_key"),
    );
    // The ids are the policy's ids.
    for id in [&wrapper, &jsx, &calls] {
        assert!(yaml.contains(&format!("- id: {id}")), "{id}: {yaml}");
    }
    let (_, out, _) = run_full(r, &["census", "--json"]);
    let v: Value = serde_json::from_str(&out).unwrap();
    let reason = |id: &str| {
        v["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap()["tier_reason"]
            .clone()
    };
    assert_eq!(reason(&wrapper), Value::Null);
    assert_eq!(reason(&jsx), "rule_kind_d7");
    assert_eq!(reason(&calls), "rule_kind");

    // --tier filters, keeping ranks and counting both tiers.
    let (_, out, _) = run_full(r, &["census", "--json", "--tier", "suggestion"]);
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["conventions"], 3, "all proposals");
    assert_eq!(v["shown"], 2, "after the filter");
    assert_eq!(v["tiers"], json!({ "default": 1, "suggestion": 2 }));
    assert!(
        v["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["rank"] != 1)
    );
    assert_eq!(v["params"]["tier"]["min_members"], 15);
    let (_, text, _) = run_full(r, &["census"]);
    assert!(text.contains("(1 default tier, 2 suggestions)"), "{text}");
    assert!(
        text.contains("tier:     suggestion (rule kind passes_key)"),
        "{text}"
    );
    assert!(
        text.contains(
            "tier:     suggestion (rule kind wrapped_by:jsx; decision D7 keeps only call wrappers and layering)"
        ),
        "{text}"
    );
    assert!(
        text.find(&wrapper).unwrap() < text.find(&calls).unwrap()
            && text.find(&wrapper).unwrap() < text.find(&jsx).unwrap(),
        "{text}"
    );
    let (_, text, _) = run_full(r, &["census", "--tier", "default"]);
    assert!(
        text.contains(&wrapper) && !text.contains(&calls) && !text.contains(&jsx),
        "{text}"
    );
    assert!(text.contains("\nshowing 1 (--tier)\n"), "{text}");

    // --block on a suggestion is refused without --force, and nothing is written.
    let (code, _, err) = run_full(
        r,
        &["review", "--block", &format!("{wrapper},{jsx},{calls}")],
    );
    assert_eq!(code, 2, "{err}");
    assert!(
        err.contains(&calls)
            && err.contains(&jsx)
            && err.contains("suggestion")
            && err.contains("--force"),
        "{err}"
    );
    assert_eq!(
        std::fs::read_to_string(&yaml_path).unwrap(),
        yaml,
        "unchanged"
    );
    let (code, _, err) = run_full(
        r,
        &[
            "review",
            "--block",
            &format!("{wrapper},{jsx},{calls}"),
            "--force",
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert!(err.contains("set to block (--force)"), "{err}");
    let after = std::fs::read_to_string(&yaml_path).unwrap();
    assert_eq!(after.matches("\n  mode: block\n").count(), 3, "{after}");

    // A later init keeps every decision and every id; tiers change nothing on disk.
    // [FIX1-G1] S8 (kept by the lead at F10): decided cards are written in id order, so
    // the first init after a review moves the cards it decided into that order once
    // (`review` keeps the order it found); each card's text is unchanged, and the next
    // init writes the same bytes.
    run(r, &["init"], None);
    let again = std::fs::read_to_string(&yaml_path).unwrap();
    let cards = |y: &str| {
        let mut c: Vec<String> = y
            .split("\n- id: ")
            .map(|b| b.trim_end().to_string())
            .collect();
        c.sort();
        c
    };
    assert_eq!(cards(&again), cards(&after), "{again}");
    let decided: Vec<&str> = again
        .split("\n- id: ")
        .skip(1)
        .filter(|b| b.contains("\n  status: accepted\n"))
        .map(|b| &b[..8])
        .collect();
    assert_eq!(decided.len(), 3, "{again}");
    assert!(decided.is_sorted(), "{again}");
    run(r, &["init"], None);
    assert_eq!(std::fs::read_to_string(&yaml_path).unwrap(), again);
    assert_eq!(census_ids(r), props);
}

#[test]
fn hooks_label_suggestions_and_block_only_in_block_mode() {
    let dir = mixed_repo();
    let r = dir.path();
    let props = census_ids(r);
    let calls = props
        .iter()
        .find(|p| p.1 == "passes_key")
        .unwrap()
        .0
        .clone();
    hook(r, "SessionStart", json!({}));

    // Priming marks the suggestion.
    let util = "import { log } from \"./log\";\n\nexport function util99() {\n  log({});\n  return 1;\n}\n";
    let pre = hook(r, "PreToolUse", write_tool(r, "src/lib/u99.ts", Some(util))).unwrap();
    let ctx = pre["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(ctx.contains(&format!("[{calls}] (suggestion) ")), "{ctx}");

    // Advice after the edit says it is a suggestion; the end of the turn does not block.
    write(r, "src/lib/u99.ts", util);
    let post = hook(r, "PostToolUse", edit(r, "src/lib/u99.ts")).unwrap();
    let ctx = post["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        ctx.contains("(advice)") && ctx.contains("(suggestion) "),
        "{ctx}"
    );
    assert!(hook(r, "Stop", json!({ "stop_hook_active": false })).is_none());

    // MCP and AGENTS.md say which tier each rule is in.
    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"src/lib/u98.ts","content":util}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_explain","arguments":{"id":calls}}}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, out) = run(r, &["mcp"], Some(&input));
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let t = |i: usize| replies[i]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        t(0).contains(&calls) && t(0).contains(", suggestion, advises)"),
        "{}",
        t(0)
    );
    assert!(
        t(1).contains("tier: suggestion (rule kind passes_key)"),
        "{}",
        t(1)
    );
    let (_, md) = run(r, &["export", "agents-md"], None);
    let (rules, sugg) = (
        md.find("### Rules").unwrap(),
        md.find("### Suggestions").unwrap(),
    );
    assert!(rules < sugg && md[sugg..].contains("log"), "{md}");

    // Forced into block mode by a person, the suggestion blocks like any other.
    run(r, &["review", "--block", &calls, "--force"], None);
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block");
    let reason = stop["reason"].as_str().unwrap();
    assert!(
        reason.contains(&calls) && !reason.contains("(suggestion)"),
        "{reason}"
    );
}

/// W0: a suggestion whose rule family is below the admission bar is listed for people
/// (census, init, review, check JSON) and kept from agents (hooks, MCP, `drift example`,
/// `drift check` text, AGENTS.md) until a person shows it with `--show-to-agents`.
#[test]
fn suggestions_below_the_admission_bar_reach_people_not_agents() {
    let dir = mixed_repo_proposed();
    let r = dir.path();
    // People: census JSON says, per proposal, whether agents are shown it and why.
    let (_, census, _) = run_full(r, &["census", "--json"]);
    let census: Value = serde_json::from_str(&census).unwrap();
    let props = census["proposals"].as_array().unwrap();
    assert_eq!(props.len(), 3, "{census}");
    let by_kind = |k: &str| props.iter().find(|p| p["rule_kind"] == k).unwrap();
    let wrapper = by_kind("wrapped_by:call");
    let calls = by_kind("passes_key");
    let jsx = by_kind("wrapped_by:jsx");
    // The default tier is a block candidate until a person accepts it (decision D13).
    assert_eq!(wrapper["agents"]["shown_to_agents"], false, "{wrapper}");
    assert_eq!(wrapper["agents"]["reason"], "candidate");
    for p in [calls, jsx] {
        assert_eq!(p["agents"]["shown_to_agents"], false, "{p}");
        assert_eq!(p["agents"]["reason"], "below_bar", "{p}");
        assert!(
            p["agents"]["text"]
                .as_str()
                .unwrap()
                .starts_with("not shown to agents (family below admission bar: "),
            "{p}"
        );
    }
    assert_eq!(calls["agents"]["family"], "argument_key");
    assert!(
        calls["agents"]["source"]
            .as_str()
            .unwrap()
            .starts_with("crates/drift-mine/data/family-admission.json (eval/study/runs/dev-"),
        "{calls}"
    );
    assert_eq!(
        wrapper["agents"]["source"],
        "default tier (block candidate)"
    );
    assert_eq!(census["agents"]["hidden"], 3, "{census}");
    assert_eq!(census["agents"]["candidates"], 1, "{census}");
    assert!(
        census["agents"]["admission"]["run"]
            .as_str()
            .unwrap()
            .starts_with("eval/study/runs/dev-"),
        "{census}"
    );
    // Ids and tiers are the same as without admission.
    assert_eq!(calls["tier"], "suggestion");
    assert_eq!(wrapper["tier"], "default");
    let (calls, jsx, wrapper) = (
        calls["id"].as_str().unwrap().to_string(),
        jsx["id"].as_str().unwrap().to_string(),
        wrapper["id"].as_str().unwrap().to_string(),
    );
    let (_, text, _) = run_full(r, &["census"]);
    assert!(
        text.contains("2 suggestion(s) are not shown to agents")
            && text.contains("1 default-tier proposal(s) are block candidates: not shown to agents until you accept them")
            && text.contains("    agents:   not shown to agents (block candidate: reaches agents once you accept it)")
            && text.contains("    agents:   not shown to agents (family below admission bar: "),
        "{text}"
    );

    // Accepted, all three: people still see every one, agents only the default tier.
    let (_, out) = run(
        r,
        &["review", "--accept", &format!("{wrapper},{calls},{jsx}")],
        None,
    );
    // [FIX1-G1] S10: init's from-map proposal stays proposed (`census` without
    // `--from-map` does not list it, so it is not among the three accepted here).
    assert!(
        out.contains(
            "3 accepted (0 block), 1 proposed, 0 rejected (2 accepted not shown to agents"
        ),
        "{out}"
    );
    // (drift_explain is asked about the default-tier id only: it echoes the id it is given.)
    let texts = agent_texts(r, &[wrapper.as_str()]);
    let all = texts.join("\n");
    assert!(all.contains(&wrapper), "{all}");
    for hidden in [&calls, &jsx] {
        assert!(
            !all.contains(hidden.as_str()),
            "{hidden} reached an agent: {all}"
        );
    }
    assert!(
        !all.contains("BaseEmailWrapper") && !all.contains("`level`"),
        "{all}"
    );
    assert!(all.contains("this repo's 1 accepted conventions"), "{all}");
    // The priming before a helper that breaks the hidden rule, and the advice after it.
    let util = "import { log } from \"./log\";\n\nexport function util97() {\n  log({});\n  return 1;\n}\n";
    let pre = hook(r, "PreToolUse", write_tool(r, "src/lib/u97.ts", Some(util)));
    assert!(
        pre.as_ref().is_none_or(|v| !v.to_string().contains(&calls)),
        "{pre:?}"
    );
    write(r, "src/lib/u97.ts", util);
    let post = hook(r, "PostToolUse", edit(r, "src/lib/u97.ts"));
    assert!(
        post.as_ref()
            .is_none_or(|v| !v.to_string().contains(&calls)),
        "{post:?}"
    );
    let (_, example) = run(r, &["example", "src/emails/e99.tsx"], None);
    assert!(!example.contains("BaseEmailWrapper"), "{example}");

    // `drift check` text is read by people too: it lists what agents are not shown,
    // marked so, as JSON does (`--include-hidden` is kept and changes nothing).
    let (_, text) = run(r, &["check"], None);
    assert!(text.contains(&format!("[{calls}]")), "{text}");
    assert!(text.contains("(suggestion; not shown to agents)"), "{text}");
    assert!(!text.contains("--include-hidden"), "{text}");
    assert_eq!(run(r, &["check", "--include-hidden"], None).1, text);
    let (_, json) = run(r, &["check", "--format", "json"], None);
    let json: Value = serde_json::from_str(&json).unwrap();
    assert!(
        json["violations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["id"] == calls.as_str()),
        "{json}"
    );
    let conv = |id: &str| {
        json["conventions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .unwrap()
            .clone()
    };
    assert_eq!(conv(&calls)["agents"]["shown_to_agents"], false);
    assert_eq!(conv(&wrapper)["agents"]["shown_to_agents"], true);

    // A person shows one to agents: recorded in conventions.yaml, kept by init, and every
    // agent surface has it.
    let (code, out) = run(r, &["review", "--show-to-agents", &calls], None);
    assert_eq!(code, 0, "{out}");
    assert!(
        out.contains(&format!(
            "{calls}: shown to agents (a person chose to show it"
        )),
        "{out}"
    );
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert_eq!(yaml.matches("\n  agents: show\n").count(), 1, "{yaml}");
    run(r, &["init"], None);
    let again = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert_eq!(again.matches("\n  agents: show\n").count(), 1, "{again}");
    let all = agent_texts(r, &[wrapper.as_str(), calls.as_str()]).join("\n");
    assert!(all.contains(&calls) && !all.contains(&jsx), "{all}");
    let (_, text) = run(r, &["check"], None);
    assert!(text.contains(&calls), "{text}");
    let (_, json) = run(r, &["check", "--format", "json"], None);
    let json: Value = serde_json::from_str(&json).unwrap();
    let c = json["conventions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == calls.as_str())
        .unwrap()
        .clone();
    assert_eq!(c["agents"]["shown_to_agents"], true, "{c}");
    assert_eq!(c["agents"]["reason"], "person", "{c}");
    assert_eq!(
        c["agents"]["source"], "conventions.yaml agents: show",
        "{c}"
    );
    // --show-to-agents with --reject is refused, nothing written.
    let (code, _, err) = run_full(r, &["review", "--show-to-agents", &jsx, "--reject", &jsx]);
    assert_eq!(code, 2, "{err}");
    assert_eq!(
        std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap(),
        again
    );
}

/// A Python repo where every convention is accepted: FastAPI routes in `app/api/**`
/// depend on `get_current_user` and the helper functions beside them call `log()`;
/// Django models have `created_at`; DRF viewsets in `api/**` extend `BaseViewSet`;
/// Celery tasks in `jobs/**` call `audit()`; 30 projects agree on pydantic's version.
/// Returns the convention ids by name.
fn python_repo() -> (
    tempfile::TempDir,
    std::collections::BTreeMap<&'static str, String>,
) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "app/__init__.py", "");
    write(r, "app/api/__init__.py", "");
    write(
        r,
        "app/api/deps.py",
        "from typing import Annotated\nfrom fastapi import Depends\n\ndef get_current_user():\n    return 1\n\nCurrentUser = Annotated[object, Depends(get_current_user)]\n",
    );
    write(r, "app/log.py", "def log(m):\n    pass\n");
    write(r, "manage.py", "import django\n");
    write(r, "api/__init__.py", "");
    write(
        r,
        "api/base.py",
        "from rest_framework import viewsets\n\n\nclass BaseViewSet(viewsets.ModelViewSet):\n    pass\n",
    );
    write(r, "api/views/__init__.py", "");
    write(r, "jobs/__init__.py", "");
    write(
        r,
        "jobs/celery_app.py",
        "from celery import Celery\n\napp = Celery(\"x\")\n",
    );
    write(r, "jobs/audit.py", "def audit(m):\n    pass\n");
    let mut registrations = String::new();
    let mut modules = Vec::new();
    for i in 10..40 {
        let ok = i < 39;
        let route = if ok {
            format!(
                "from fastapi import APIRouter\nfrom app.api.deps import CurrentUser\n\nrouter = APIRouter()\n\n@router.get(\"/r{i}\")\ndef read_{i}(user: CurrentUser):\n    return {i}\n"
            )
        } else {
            format!(
                "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n@router.get(\"/r{i}\")\ndef read_{i}():\n    return {i}\n"
            )
        };
        write(r, &format!("app/api/r{i}.py"), &route);
        let helper = if ok {
            format!(
                "from app.log import log\n\ndef helper_{i}():\n    log(\"x\")\n    return {i}\n"
            )
        } else {
            format!("def helper_{i}():\n    return {i}\n")
        };
        write(r, &format!("app/api/h{i}.py"), &helper);
        write(r, &format!("shop/s{i}/__init__.py"), "");
        write(
            r,
            &format!("shop/s{i}/models.py"),
            &format!(
                "from django.db import models\n\n\nclass Item{i}(models.Model):\n    name = models.CharField(max_length=10)\n{}",
                if ok {
                    "    created_at = models.DateTimeField()\n"
                } else {
                    ""
                }
            ),
        );
        let (import, base) = if ok {
            ("from api.base import BaseViewSet", "BaseViewSet")
        } else {
            (
                "from rest_framework import viewsets",
                "viewsets.ModelViewSet",
            )
        };
        write(
            r,
            &format!("api/views/v{i}.py"),
            &format!("{import}\n\n\nclass V{i}ViewSet({base}):\n    queryset = None\n"),
        );
        registrations.push_str(&format!("router.register(\"v{i}\", v{i}.V{i}ViewSet)\n"));
        modules.push(format!("v{i}"));
        write(
            r,
            &format!("jobs/t{i}.py"),
            &format!(
                "from jobs.audit import audit\nfrom jobs.celery_app import app\n\n\n@app.task\ndef t{i}():\n    {}\n",
                if ok { "audit(\"x\")" } else { "pass" }
            ),
        );
        write(
            r,
            &format!("lib/u{i}.py"),
            &format!("def u{i}():\n    return {i}\n\n\nclass C{i}:\n    pass\n"),
        );
        write(
            r,
            &format!("libs/p{i}/pyproject.toml"),
            &format!(
                "[project]\nname = \"p{i}\"\ndependencies = [\"pydantic{}\"]\n",
                if ok { ">=2.7" } else { ">=1.10" }
            ),
        );
        write(
            r,
            &format!("libs/p{i}/p{i}/__init__.py"),
            &format!("VERSION = {i}\n"),
        );
    }
    write(
        r,
        "api/urls.py",
        &format!(
            "from django.urls import include, path\nfrom rest_framework.routers import DefaultRouter\n\nfrom api.views import {}\n\nrouter = DefaultRouter()\n{registrations}urlpatterns = [path(\"\", include(router.urls))]\n",
            modules.join(", ")
        ),
    );
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id_of = |needle: &str| {
        yaml.split("- id: ")
            .skip(1)
            .find(|block| block.contains(needle))
            .map(|b| b[..8].to_string())
            .unwrap_or_else(|| panic!("no convention mentions {needle}: {yaml}"))
    };
    let ids: std::collections::BTreeMap<&str, String> = [
        ("route", id_of("get_current_user()")),
        ("helper", id_of("call log()")),
        ("model", id_of("created_at")),
        ("viewset", id_of("extend BaseViewSet")),
        ("job", id_of("call audit()")),
        ("pydantic", id_of("pydantic version")),
    ]
    .into_iter()
    .collect();
    // [FIX1-G1] S10: `init` also writes from-map proposals (`from_map:`); accepting them
    // too gave one a priming slot these tests count on for the mined rules. They stay
    // proposed: the mined Python conventions are the ones these tests are about.
    let all: Vec<&str> = yaml
        .split("- id: ")
        .skip(1)
        .filter(|b| !b.contains("\n  from_map: "))
        .map(|b| &b[..8])
        .collect();
    run(r, &["review", "--show-to-agents", &all.join(",")], None);
    (dir, ids)
}

fn primed(root: &Path, session: &str, rel: &str, content: Option<&str>) -> String {
    hook_as(root, session, "PreToolUse", write_tool(root, rel, content))
        .map(|v| {
            v["hookSpecificOutput"]["additionalContext"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .unwrap_or_default()
}

/// `drift check` text, which people read: a person accepted a convention agents are not
/// shown (its family is below the admission bar); its new violation is listed, and the
/// legacy count is the lock's, as JSON says it.
#[test]
fn check_text_lists_violations_agents_are_not_shown_and_counts_their_legacy() {
    let dir = mixed_repo_proposed();
    let r = dir.path();
    let (_, census, _) = run_full(r, &["census", "--json"]);
    let census: Value = serde_json::from_str(&census).unwrap();
    let id_of = |k: &str| {
        census["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["rule_kind"] == k)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let calls = id_of("passes_key");
    let (code, out) = run(r, &["review", "--accept", &calls], None);
    assert_eq!(code, 0, "{out}");
    // A new member that breaks it, beside the legacy outlier the lock holds.
    write(
        r,
        "src/lib/u97.ts",
        "import { log } from \"./log\";\n\nexport function util97() {\n  log({});\n  return 1;\n}\n",
    );
    let (_, json) = run(r, &["check", "--format", "json"], None);
    let json: Value = serde_json::from_str(&json).unwrap();
    let of_calls: Vec<&Value> = json["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["id"] == calls.as_str())
        .collect();
    let legacy = json["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["baselined"] == true)
        .count();
    assert!(
        of_calls.iter().any(|v| v["baselined"] == true)
            && of_calls
                .iter()
                .any(|v| v["baselined"] == false && v["path"] == "src/lib/u97.ts"),
        "{json}"
    );
    let (_, text) = run(r, &["check"], None);
    assert!(
        text.contains(&format!("({legacy} legacy, baselined"))
            && text.contains(&format!("[{calls}]"))
            && text.contains("src/lib/u97.ts:"),
        "{text}"
    );
    assert!(text.contains("(suggestion; not shown to agents)"), "{text}");
    assert!(!text.contains("are not listed"), "{text}");
}

/// Decision D7: every Python proposal is a suggestion, with the reason `language_advise`,
/// whatever its rule kind (here call wrappers, base classes, calls, model and package rules).
#[test]
fn python_proposals_are_all_suggestions() {
    let (dir, _) = python_repo();
    let r = dir.path();
    let (_, out, _) = run_full(r, &["census", "--json"]);
    let v: Value = serde_json::from_str(&out).unwrap();
    let proposals = v["proposals"].as_array().unwrap();
    assert!(proposals.len() >= 5, "{out}");
    let kinds: std::collections::BTreeSet<&str> = proposals
        .iter()
        .map(|p| p["rule_kind"].as_str().unwrap())
        .collect();
    assert!(
        kinds.contains("wrapped_by:call") && kinds.contains("wrapped_by:extends"),
        "{kinds:?}"
    );
    for p in proposals {
        assert_eq!(p["tier"], "suggestion", "{p}");
        assert_eq!(p["tier_reason"], "language_advise", "{p}");
        assert_eq!(p["language"], "py", "{p}");
        assert!(p["evidence"]["python_members"].as_u64().unwrap() > 0, "{p}");
    }
    assert_eq!(v["tiers"]["default"], 0);
    let (_, text, _) = run_full(r, &["census"]);
    assert!(
        text.contains("tier:     suggestion (Python conventions advise only; decision D7)"),
        "{text}"
    );
}

#[test]
fn python_new_file_priming_follows_what_the_file_declares() {
    let (dir, id) = python_repo();
    let r = dir.path();
    // A FastAPI route and a helper module in the same directory get different rules.
    let route = "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n@router.get(\"/x\")\ndef x():\n    return 1\n";
    let ctx = primed(r, "a", "app/api/new_route.py", Some(route));
    assert!(
        ctx.contains(&id["route"]) && !ctx.contains(&id["helper"]),
        "{ctx}"
    );
    // Decision D7: Python advises only, so the route's call wrapper is a suggestion too,
    // and is marked like the helper's call.
    assert!(ctx.contains("(suggestion)"), "{ctx}");
    let ctx = primed(
        r,
        "b",
        "app/api/new_helper.py",
        Some("def helper():\n    return 1\n"),
    );
    assert!(
        ctx.contains(&id["helper"]) && !ctx.contains(&id["route"]),
        "{ctx}"
    );
    assert!(ctx.contains("(suggestion)"), "{ctx}");
    // Content that does not parse gets the rules grouped by what they apply to.
    let ctx = primed(
        r,
        "c",
        "app/api/broken.py",
        Some("def helper(:\n    return 1\n"),
    );
    assert!(
        ctx.contains(&format!("if it exports HTTP handlers: [{}", id["route"]))
            && ctx.contains(&format!("if it exports functions: [{}", id["helper"])),
        "{ctx}"
    );
    // Content a scan would skip gets none, and hostile nesting does not crash.
    let generated = "# Generated by protoc. DO NOT EDIT!\ndef helper():\n    return 1\n";
    assert_eq!(primed(r, "d", "app/api/gen.py", Some(generated)), "");
    let deep = format!("x = {}1{}\n", "(\n".repeat(20_000), "\n)".repeat(20_000));
    assert_eq!(primed(r, "d", "app/api/deep.py", Some(&deep)), "");
    // Inside an f-string's replacement field, across lines of a triple-quoted string.
    let fdeep = format!(
        "x = f\"\"\"{{{}1{}}}\"\"\"\n",
        "(\n".repeat(200_000),
        "\n)".repeat(200_000)
    );
    assert_eq!(primed(r, "d", "app/api/fdeep.py", Some(&fdeep)), "");
    // A viewset nothing registers yet is an HTTP handler; a plain class is not.
    let viewset = "from api.base import BaseViewSet\n\n\nclass NewViewSet(BaseViewSet):\n    queryset = None\n";
    let ctx = primed(r, "e", "api/views/new.py", Some(viewset));
    assert!(ctx.contains(&id["viewset"]), "{ctx}");
    assert_eq!(
        primed(
            r,
            "e",
            "api/views/pager.py",
            Some("class Pager:\n    pass\n")
        ),
        ""
    );
    // A task on the Celery app imported from another module is a job.
    let task = "from jobs.celery_app import app\n\n\n@app.task\ndef new():\n    pass\n";
    let ctx = primed(r, "f", "jobs/new.py", Some(task));
    assert!(ctx.contains(&id["job"]), "{ctx}");
    assert_eq!(
        primed(r, "f", "jobs/plain.py", Some("def plain():\n    pass\n")),
        ""
    );
    // Model rules follow the models a file declares, or where models live.
    let model = "from django.db import models\n\n\nclass New(models.Model):\n    name = models.CharField(max_length=3)\n";
    let ctx = primed(r, "g", "shop/s99/models.py", Some(model));
    assert!(ctx.contains(&id["model"]), "{ctx}");
    assert!(
        !primed(r, "h", "shop/s99/models.py", Some("def f():\n    pass\n")).contains(&id["model"])
    );
    let ctx = primed(r, "i", "shop/s99/models.py", None);
    assert!(
        ctx.contains(&format!("if it defines database models: [{}", id["model"])),
        "{ctx}"
    );
    assert!(!primed(r, "j", "shop/s99/views.py", None).contains(&id["model"]));
    // A new project manifest gets the package rules.
    let ctx = primed(
        r,
        "k",
        "libs/pnew/pyproject.toml",
        Some("[project]\nname = \"pnew\"\n"),
    );
    assert!(ctx.contains(&id["pydantic"]), "{ctx}");

    // The MCP server and `drift example` agree, and hostile content does not kill it.
    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/brand_new.py","content":route}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"shop/s10/models.py"}}}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/fdeep.py","content":fdeep}}}),
        json!({"jsonrpc":"2.0","id":4,"method":"tools/list"}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, out) = run(r, &["mcp"], Some(&input));
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 4, "the server survives: {out}");
    assert!(replies[3]["result"]["tools"].is_array());
    let t = |i: usize| replies[i]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        t(0).contains(&id["route"]) && !t(0).contains(&id["helper"]),
        "{}",
        t(0)
    );
    assert!(t(1).contains(&id["model"]), "{}", t(1));
    let (_, out) = run(r, &["example", "shop/s10/models.py"], None);
    assert!(out.contains("created_at"), "{out}");
}

#[test]
fn python_edits_are_checked_one_file_at_a_time() {
    let (dir, id) = python_repo();
    let r = dir.path();
    hook(r, "SessionStart", json!({ "source": "startup" }));
    let advice = |rel: &str| {
        hook(r, "PostToolUse", edit(r, rel))
            .map(|v| {
                v["hookSpecificOutput"]["additionalContext"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .unwrap_or_default()
    };
    write(
        r,
        "app/api/r10.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n@router.get(\"/r10\")\ndef read_10():\n    return 10\n",
    );
    let ctx = advice("app/api/r10.py");
    assert!(
        ctx.contains(&id["route"]) && ctx.contains("read_10"),
        "{ctx}"
    );
    // A model edit is checked against the model conventions.
    write(
        r,
        "shop/s10/models.py",
        "from django.db import models\n\n\nclass Item10(models.Model):\n    name = models.CharField(max_length=10)\n",
    );
    let ctx = advice("shop/s10/models.py");
    assert!(
        ctx.contains(&id["model"]) && ctx.contains("Item10"),
        "{ctx}"
    );
    // So is a project manifest.
    write(
        r,
        "libs/p12/pyproject.toml",
        "[project]\nname = \"p12\"\ndependencies = [\"pydantic>=1.10\"]\n",
    );
    let ctx = advice("libs/p12/pyproject.toml");
    assert!(ctx.contains(&id["pydantic"]), "{ctx}");
    // Python conventions, package rules among them, are suggestions (decision D7):
    // marked, refused for blocking unless forced, and never blocking at the end of the turn.
    assert!(ctx.contains("(suggestion)"), "{ctx}");
    let (code, _, err) = run_full(r, &["review", "--block", &id["pydantic"]]);
    assert_ne!(code, 0);
    assert!(err.contains("refusing to block"), "{err}");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let block = &yaml[yaml.find(&format!("- id: {}", id["pydantic"])).unwrap()..];
    let block = &block[..block[1..].find("\n- id: ").map_or(block.len(), |i| i + 1)];
    assert!(block.contains("mode: advise"), "{block}");
    let msg = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_explain","arguments":{"id":id["pydantic"]}}});
    let (_, out) = run(r, &["mcp"], Some(&format!("{msg}\n")));
    assert!(
        out.contains("tier: suggestion (Python conventions advise only; decision D7)"),
        "{out}"
    );
    assert!(
        hook(r, "Stop", json!({ "stop_hook_active": false }))
            .is_none_or(|v| v["decision"] != "block")
    );
    // Single-file facts equal a full scan's.
    let (code, out) = run(r, &["debug", "incremental"], None);
    assert_eq!(code, 0, "{out}");
    assert!(out.ends_with(", 0 mismatches\n"), "{out}");
}

/// Whether an `integration/` directory is an integration-test suite (code no
/// convention covers) is learned from all of its test files, in either language: a
/// single-file scan of a fixture app file in it, or of a Python helper, must leave
/// the file out of every role as a full scan does (nest's `integration/*/src`).
#[test]
fn single_file_scans_see_integration_suites() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let controller = |name: &str, route: &str| {
        format!(
            "import {{ Controller, Get }} from \"@nestjs/common\";\n\n@Controller(\"{route}\")\nexport class {name}Controller {{\n  @Get()\n  findAll() {{\n    return [];\n  }}\n}}\n"
        )
    };
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "^10.0.0" } }"#,
    );
    for i in 0..20 {
        write(
            r,
            &format!("src/c{i}/c{i}.controller.ts"),
            &controller(&format!("C{i}"), &format!("c{i}")),
        );
    }
    // A root suite: fixture apps tested by standalone specs, plus a Python helper.
    for s in ["hello", "cors", "cookies"] {
        write(
            r,
            &format!("integration/{s}/src/app.controller.ts"),
            &controller("App", s),
        );
        write(
            r,
            &format!("integration/{s}/src/app.module.ts"),
            "import { AppController } from \"./app.controller\";\n\nexport class AppModule {\n  controllers = [AppController];\n}\n",
        );
        write(
            r,
            &format!("integration/{s}/e2e/{s}.spec.ts"),
            &format!(
                "import {{ AppModule }} from \"../src/app.module\";\n\ndescribe(\"{s}\", () => {{\n  it(\"works\", () => {{\n    new AppModule();\n  }});\n}});\n"
            ),
        );
    }
    write(
        r,
        "integration/hello/seed.py",
        "def seed():\n    return 1\n",
    );
    // A package's suite whose tests are all Python, around a TypeScript fixture app.
    write(r, "packages/api/package.json", r#"{ "name": "api" }"#);
    write(
        r,
        "packages/api/pyproject.toml",
        "[project]\nname = \"api-tests\"\n",
    );
    write(
        r,
        "packages/api/src/api.controller.ts",
        &controller("Api", "api"),
    );
    write(
        r,
        "packages/api/integration/app/app.controller.ts",
        &controller("Fixture", "fixture"),
    );
    for t in ["flows", "more"] {
        write(
            r,
            &format!("packages/api/integration/test_{t}.py"),
            &format!("def test_{t}():\n    assert True\n"),
        );
    }
    let (code, out) = run(r, &["debug", "incremental"], None);
    assert_eq!(code, 0, "{out}");
    assert!(out.ends_with(", 0 mismatches\n"), "{out}");
    // The fixture apps and the helper were among the files compared.
    let checked: usize = out
        .trim()
        .strip_prefix("checked ")
        .and_then(|s| s.split(' ').next())
        .and_then(|n| n.parse().ok())
        .unwrap();
    assert!(checked >= 26, "{out}");
}

/// A production `integration/` directory whose tests sit next to what they test is
/// not an integration-test suite, whatever the tests' naming: pytest's
/// `test_slack.py` next to `slack.py` is co-located like `route.test.ts` next to
/// `route.ts`. Its routes are mined and checked, by `check` and by the hooks.
#[test]
fn pytest_tests_beside_their_module_keep_an_integration_dir_production() {
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
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    for i in 0..40 {
        write(
            r,
            &format!("integration/app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    // Three co-located TypeScript tests, four co-located pytest modules.
    for i in 37..40 {
        write(
            r,
            &format!("integration/app/api/r{i:02}/route.test.ts"),
            "import { GET } from \"./route\";\n\ntest(\"get\", () => {\n  expect(GET).toBeDefined();\n});\n",
        );
    }
    for n in ["slack", "github", "jira", "linear"] {
        write(
            r,
            &format!("integration/{n}.py"),
            &format!("def send_{n}():\n    return 1\n"),
        );
        write(
            r,
            &format!("integration/test_{n}.py"),
            &format!(
                "from integration.{n} import send_{n}\n\n\ndef test_{n}():\n    assert send_{n}() == 1\n"
            ),
        );
    }
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|block| block.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned from the integration routes");
    run(r, &["review", "--show-to-agents", &id], None);
    std::fs::remove_file(r.join("drift.lock")).unwrap();
    let (_, out) = run(r, &["check"], None);
    for route in ["r38", "r39"] {
        assert!(
            out.contains(&format!("integration/app/api/{route}/route.ts")),
            "{out}"
        );
    }
    // The hook sees the same: a new unguarded route is advised.
    hook(r, "SessionStart", json!({ "source": "startup" }));
    write(r, "integration/app/api/r40/route.ts", UNGUARDED);
    let ctx = hook(
        r,
        "PostToolUse",
        edit(r, "integration/app/api/r40/route.ts"),
    )
    .map(|v| v["hookSpecificOutput"]["additionalContext"].to_string())
    .unwrap_or_default();
    assert!(
        ctx.contains(&id) && ctx.contains("integration/app/api/r40/route.ts"),
        "{ctx}"
    );
    let (code, out) = run(r, &["debug", "incremental"], None);
    assert_eq!(code, 0, "{out}");
    assert!(out.ends_with(", 0 mismatches\n"), "{out}");
}

/// PostToolUse checks one file from a single-file scan, Stop checks the full scan:
/// for Python classes whose kind or base chain depends on other files, both must
/// put the class in the same role and judge it the same way.
#[test]
fn python_post_tool_use_and_stop_agree_on_class_roles() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/kit/__init__.py", "");
    write(r, "app/kit/base.py", "class RepositoryBase:\n    pass\n");
    for i in 0..20 {
        write(r, &format!("app/m{i}/__init__.py"), "");
        let body = if i == 0 {
            "class M0Repository:\n    pass\n".to_string()
        } else {
            format!(
                "from app.kit.base import RepositoryBase\n\n\nclass M{i}Repository(RepositoryBase):\n    pass\n"
            )
        };
        write(r, &format!("app/m{i}/repository.py"), &body);
    }
    for i in 0..30 {
        write(
            r,
            &format!("app/o{i}/thing.py"),
            &format!("class Thing{i}:\n    pass\n"),
        );
    }
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("extend RepositoryBase"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    run(r, &["review", "--show-to-agents", &id], None);
    // Python conventions are suggestions (decision D7), so blocking one takes --force.
    let (code, _, err) = run_full(r, &["review", "--block", &id, "--force"]);
    assert_eq!(code, 0, "{err}");
    hook(r, "SessionStart", json!({ "source": "startup" }));

    // A base extended by two classes of another file (no role), a chained subclass
    // (follows the rule through MidRepository), and a real violation.
    write(r, "app/tx/__init__.py", "");
    write(r, "app/tx/repository.py", "class TxCore:\n    pass\n");
    write(r, "app/pay/__init__.py", "");
    write(
        r,
        "app/pay/repository.py",
        "from app.tx.repository import TxCore\n\n\nclass PayRepository(TxCore):\n    pass\n\n\nclass RefundRepository(TxCore):\n    pass\n",
    );
    write(r, "app/mid/__init__.py", "");
    write(
        r,
        "app/mid/repository.py",
        "from app.kit.base import RepositoryBase\n\n\nclass MidRepository(RepositoryBase):\n    pass\n",
    );
    write(r, "app/z/__init__.py", "");
    write(
        r,
        "app/z/repository.py",
        "from app.mid.repository import MidRepository\n\n\nclass ZRepository(MidRepository):\n    pass\n",
    );
    // An unrouted view built on the team's generic view, which is built on Django's:
    // a view (in no role) in both scans, though no URL routes it.
    write(
        r,
        "app/kit/generic.py",
        "from django.views.generic import View\n\n\nclass ObjectView(View):\n    pass\n",
    );
    write(r, "app/v/__init__.py", "");
    write(
        r,
        "app/v/repository.py",
        "from app.kit.generic import ObjectView\n\n\nclass RepositoryView(ObjectView):\n    pass\n",
    );
    let mut post = String::new();
    for rel in [
        "app/tx/repository.py",
        "app/pay/repository.py",
        "app/mid/repository.py",
        "app/z/repository.py",
        "app/v/repository.py",
    ] {
        if let Some(v) = hook(r, "PostToolUse", edit(r, rel)) {
            post.push_str(
                v["hookSpecificOutput"]["additionalContext"]
                    .as_str()
                    .unwrap_or(""),
            );
        }
    }
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false }))
        .map(|v| v.to_string())
        .unwrap_or_default();
    assert!(
        post.contains("PayRepository") && stop.contains("PayRepository"),
        "{post}\n{stop}"
    );
    for name in ["TxCore", "MidRepository", "ZRepository", "RepositoryView"] {
        assert!(!post.contains(name), "PostToolUse flags {name}: {post}");
        assert!(!stop.contains(name), "Stop flags {name}: {stop}");
    }
}

fn bash(root: &Path, command: &str) -> Option<Value> {
    hook(
        root,
        "PreToolUse",
        json!({ "tool_name": "Bash", "tool_input": { "command": command } }),
    )
}

#[test]
fn bash_writes_under_drift_are_denied_and_reads_are_not() {
    let (dir, _) = repo();
    let r = dir.path();
    let policy = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    // A fixture repository's own .drift, on disk.
    write(
        r,
        "tests/fixtures/app/.drift/conventions.yaml",
        "version: 1\n",
    );
    for cmd in [
        "echo '{}' > .drift/cache/facts.json",
        "cat /tmp/x >> .drift/conventions.yaml",
        "cp /tmp/c.yaml .drift/conventions.yaml",
        "mv .drift/conventions.yaml /tmp/c.yaml",
        "rm -rf .drift/cache",
        "echo x | tee .drift/conventions.yaml",
        "sed -i 's/mode: block/mode: advise/' .drift/conventions.yaml",
        "truncate -s 0 drift.lock",
        "ln -sf /etc/passwd .drift/conventions.yaml",
        "cd lib && rm ../drift.lock",
        "(cd /tmp) && rm .drift/cache/x",
    ] {
        let out = bash(r, cmd).unwrap_or_else(|| panic!("{cmd}: no answer"));
        let hso = &out["hookSpecificOutput"];
        assert_eq!(hso["permissionDecision"], "deny", "{cmd}");
        assert!(
            hso["permissionDecisionReason"]
                .as_str()
                .unwrap()
                .contains(".drift/"),
            "{cmd}: {out}"
        );
    }
    for cmd in [
        "cat .drift/conventions.yaml",
        "grep -n mode .drift/conventions.yaml 2>/dev/null",
        "cp .drift/conventions.yaml /tmp/backup.yaml",
        "echo ok > /tmp/out.txt",
        "ls -la .drift/cache",
        // Only this repository's .drift and drift.lock are protected.
        "rm -rf tests/fixtures/app/.drift",
        "rm -rf /tmp/demo/.drift",
        // Scripts are not files, and only a real -i is in-place.
        "sed -i '/.drift/d' .gitignore",
        "perl -Mstrict -ne 'print' .drift/conventions.yaml",
        // Here-document bodies, subshells, popd and unresolvable cd.
        "cat <<'EOF' > /tmp/notes.md\nrm -rf .drift/cache\nEOF",
        "(cd .drift && cat conventions.yaml) && rm -f out.txt",
        "pushd .drift && popd && rm -f out.txt",
        "cd .drift && cd ~ && rm -f out.txt",
        "cd .drift && cd .. && rm -f out.txt",
        "ln -s .drift/conventions.yaml",
    ] {
        assert!(bash(r, cmd).is_none(), "{cmd} is read-only");
    }
    // A read-only Drift lookup is approved, not denied.
    assert_eq!(
        bash(r, "drift check").unwrap()["hookSpecificOutput"]["permissionDecision"],
        "allow"
    );
    // The hook only answers: nothing it saw was run or written.
    assert_eq!(
        std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap(),
        policy
    );
}

#[test]
fn review_advise_moves_back_from_block_and_refuses_unknown_ids() {
    let (dir, id) = repo();
    let r = dir.path();
    let p = r.join(".drift/conventions.yaml");
    let entry = |yaml: &str| {
        let block = &yaml[yaml.find(&format!("- id: {id}")).unwrap()..];
        block[..block[1..].find("\n- id: ").map_or(block.len(), |i| i + 1)].to_string()
    };
    let blocked = std::fs::read_to_string(&p).unwrap();
    assert!(entry(&blocked).contains("mode: block"), "{blocked}");
    // A newly written violation blocks while the convention is in block mode.
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert_eq!(run(r, &["check"], None).0, 1);

    // Unknown ids, and an id both advised and blocked, change nothing.
    let mixed = format!("{id},D-000000");
    for args in [
        vec!["review", "--advise", "D-000000"],
        vec!["review", "--advise", mixed.as_str()],
        vec!["review", "--advise", id.as_str(), "--block", id.as_str()],
        vec!["review", "--advise", id.as_str(), "--reject", id.as_str()],
    ] {
        let (code, _, err) = run_full(r, &args);
        assert_eq!(code, 2, "{args:?}: {err}");
        assert!(err.contains("nothing was changed"), "{args:?}: {err}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), blocked, "{args:?}");
    }
    let (code, _, err) = run_full(r, &["review", "--advise", "D-000000"]);
    assert_eq!(code, 2);
    assert!(err.contains("unknown convention D-000000"), "{err}");

    // Back to advise, still accepted: the violation is listed but no longer fails.
    let (code, out, err) = run_full(r, &["review", "--advise", &id]);
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("1 accepted"), "{out}");
    let advised = std::fs::read_to_string(&p).unwrap();
    let e = entry(&advised);
    assert!(
        e.contains("status: accepted") && e.contains("mode: advise"),
        "{e}"
    );
    let (code, out) = run(r, &["check"], None);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains(&id), "still checked: {out}");
    assert_eq!(run(r, &["check", "--strict"], None).0, 1);
    // Idempotent.
    run(r, &["review", "--advise", &id], None);
    assert_eq!(std::fs::read_to_string(&p).unwrap(), advised);
}

/// A Python repo whose 40 classes in `choices.py` files extend `base` (defined in
/// `app/kit/base.py` by `base_src`), plus a `Plain` one, with the extends convention
/// accepted and a session started.
fn python_base_repo(base_src: &str, target: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/kit/__init__.py", "");
    write(r, "app/kit/base.py", base_src);
    for f in 0..8 {
        write(r, &format!("app/m{f}/__init__.py"), "");
        let mut body = format!("from app.kit.base import {target}\n\n");
        for k in ["Status", "Kind", "Role", "Mode", "Level"] {
            body.push_str(&format!("\nclass M{f}{k}({target}):\n    pass\n"));
        }
        write(r, &format!("app/m{f}/choices.py"), &body);
    }
    write(r, "app/plain/__init__.py", "");
    write(r, "app/plain/choices.py", "class Plain:\n    pass\n");
    for i in 0..60 {
        write(
            r,
            &format!("app/o{i}/thing.py"),
            &format!("class Thing{i}:\n    pass\n"),
        );
    }
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains(&format!("extend {target}")))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    run(r, &["review", "--show-to-agents", &id], None);
    hook(r, "SessionStart", json!({ "source": "startup" }));
    dir
}

/// What PostToolUse says about `rel`, and what `drift check` reports.
fn post_and_check(r: &Path, rel: &str) -> (String, String) {
    let post = hook(r, "PostToolUse", edit(r, rel))
        .map(|v| v.to_string())
        .unwrap_or_default();
    let (_, check, _) = run_full(r, &["check"]);
    (post, check)
}

#[test]
fn python_hooks_and_check_agree_on_base_class_exemptions() {
    // The team base has no package base, so its whole ancestry is known: a field named
    // for its own base is not an outlier, in the hook as in a full check (the hook's
    // single-file scan lacks `app/kit/base.py`, so it falls back to a full scan).
    let dir = python_base_repo("class ChoiceSet:\n    pass\n", "ChoiceSet");
    let r = dir.path();
    write(r, "app/new/__init__.py", "");
    write(
        r,
        "app/new/choices.py",
        "from django import forms\n\n\nclass PriorityField(forms.ChoiceField):\n    pass\n\n\nclass OrderThing:\n    pass\n",
    );
    let (post, check) = post_and_check(r, "app/new/choices.py");
    for out in [&post, &check] {
        assert!(out.contains("OrderThing"), "{out}");
        // Listed as exempt, with its reason, never as a violation.
        assert!(
            !out.contains("at   app/new/choices.py:4 PriorityField"),
            "{out}"
        );
        assert!(
            out.contains("PriorityField") && out.contains("a field, named for its base"),
            "{out}"
        );
    }

    // The team base builds on a package class (`BaseModel`): its ancestry is not
    // known, so `OrderModel(BaseModel)` is reported, by the hook as by a full check.
    let dir = python_base_repo(
        "from pydantic import BaseModel\n\n\nclass Schema(BaseModel):\n    pass\n",
        "Schema",
    );
    let r = dir.path();
    write(r, "app/new/__init__.py", "");
    write(
        r,
        "app/new/choices.py",
        "from pydantic import BaseModel\n\n\nclass OrderModel(BaseModel):\n    pass\n\n\nclass OrderThing(BaseModel):\n    pass\n",
    );
    let (post, check) = post_and_check(r, "app/new/choices.py");
    for out in [&post, &check] {
        assert!(out.contains("OrderThing"), "{out}");
        assert!(out.contains("OrderModel"), "{out}");
    }
}

#[test]
fn python_hooks_and_check_fail_closed_on_bases_the_facts_do_not_show() {
    // Review probe (#27): the team base extends `BaseModel` through a starred base, or
    // in the one of its two definitions that is not first. What it builds on is then
    // unknown, so `OrderModel(BaseModel)` is reported, by the hook as by a full check.
    for base_src in [
        "from pydantic import BaseModel\n\nBASES = (BaseModel,)\n\n\nclass Schema(*BASES):\n    pass\n",
        "import sys\n\nfrom pydantic import BaseModel\n\nif sys.version_info >= (3, 99):\n    class Schema:\n        pass\nelse:\n    class Schema(BaseModel):\n        pass\n",
    ] {
        let dir = python_base_repo(base_src, "Schema");
        let r = dir.path();
        write(r, "app/new/__init__.py", "");
        write(
            r,
            "app/new/choices.py",
            "from pydantic import BaseModel\n\n\nclass OrderModel(BaseModel):\n    pass\n\n\nclass OrderThing(BaseModel):\n    pass\n",
        );
        let (post, check) = post_and_check(r, "app/new/choices.py");
        for out in [&post, &check] {
            assert!(out.contains("OrderThing"), "{base_src}: {out}");
            assert!(out.contains("OrderModel"), "{base_src}: {out}");
        }
    }
}

#[test]
fn python_hooks_and_check_see_an_attribute_rebound_in_an_if_block() {
    // Review probe (#27): `BaseForm.fieldsets` calls `FieldSet()`; 37 forms call it
    // themselves, 3 inherit it, and `PlainForm` has none. `SiteForm(BaseForm)` rebinds
    // `fieldsets` in an `if`/`else` without `FieldSet()`: it inherits nothing and breaks
    // the rule, in the hook as in a full check. `RoomForm(BaseForm)` inherits and holds.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/kit/__init__.py", "");
    write(
        r,
        "app/kit/rendering.py",
        "def FieldSet(*names):\n    return names\n",
    );
    write(
        r,
        "app/kit/base.py",
        "from app.kit.rendering import FieldSet\n\n\nclass BaseForm:\n    fieldsets = (FieldSet('name'),)\n",
    );
    for f in 0..8 {
        write(r, &format!("app/m{f}/__init__.py"), "");
        let mut body =
            "from app.kit.base import BaseForm\nfrom app.kit.rendering import FieldSet\n\n"
                .to_string();
        for (i, k) in ["Site", "Rack", "Room", "Tag", "Role"].iter().enumerate() {
            if f == 0 && i < 3 {
                body.push_str(&format!("\nclass M{f}{k}Form(BaseForm):\n    pass\n"));
            } else {
                body.push_str(&format!(
                    "\nclass M{f}{k}Form:\n    fieldsets = (FieldSet('name'),)\n"
                ));
            }
        }
        write(r, &format!("app/m{f}/forms.py"), &body);
    }
    write(r, "app/plain/__init__.py", "");
    write(r, "app/plain/forms.py", "class PlainForm:\n    pass\n");
    for i in 0..60 {
        write(
            r,
            &format!("app/o{i}/thing.py"),
            &format!("class Thing{i}:\n    pass\n"),
        );
    }
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("call FieldSet"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    run(r, &["review", "--show-to-agents", &id], None);
    hook(r, "SessionStart", json!({ "source": "startup" }));
    write(r, "app/new/__init__.py", "");
    write(
        r,
        "app/new/forms.py",
        "from app.kit.base import BaseForm\n\nDEBUG = False\n\n\nclass SiteForm(BaseForm):\n    if DEBUG:\n        fieldsets = ()\n    else:\n        fieldsets = (('Site', ('name',)),)\n\n\nclass RoomForm(BaseForm):\n    pass\n",
    );
    let (post, check) = post_and_check(r, "app/new/forms.py");
    for out in [&post, &check] {
        assert!(out.contains("SiteForm"), "{out}");
        assert!(!out.contains("RoomForm"), "{out}");
    }
}

/// An email template that renders inside `<BaseEmailWrapper>` and renders `<part>`.
fn email_template(name: &str, part: &str) -> String {
    format!(
        "import React from \"react\";\n\nimport {{ BaseEmailWrapper }} from \"./BaseEmailWrapper\";\nimport {{ {part} }} from \"./{part}\";\n\nexport const {name} = ({{ url }}: {{ url: string }}) => (\n  <BaseEmailWrapper>\n    <{part} href={{url}}>Open</{part}>\n  </BaseEmailWrapper>\n);\n\nexport default {name};\n"
    )
}

fn email_part(name: &str, element: &str) -> String {
    format!(
        "import React from \"react\";\n\nexport const {name} = ({{ href, children }}: {{ href: string; children: string }}) => {{\n  return <{element} href={{href}}>{{children}}</{element}>;\n}};\n"
    )
}

#[test]
fn hooks_and_check_agree_on_shared_parts() {
    // 50 email templates render inside `<BaseEmailWrapper>`; the wrapper itself and
    // `BaseButton` and `BaseLink`, which the templates render, are shared parts,
    // not templates that forgot the wrapper: neither the hook nor `drift check` reports
    // them, while a new template without the wrapper is reported by both.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"mail\" }");
    write(
        r,
        "emails/BaseEmailWrapper.tsx",
        "import React from \"react\";\n\nexport const BaseEmailWrapper = ({ children }: { children: React.ReactNode }) => {\n  return <html>{children}</html>;\n};\n",
    );
    write(r, "emails/BaseButton.tsx", &email_part("BaseButton", "a"));
    write(r, "emails/BaseLink.tsx", &email_part("BaseLink", "a"));
    // Names with no common affix, so that no naming rule competes with the wrapper's.
    let words = [
        "Invite",
        "ResetPassword",
        "Alert",
        "Digest",
        "Welcome",
        "Receipt",
    ];
    for i in 0..50 {
        let part = if i % 2 == 0 { "BaseButton" } else { "BaseLink" };
        let name = format!("{}{i}", words[i % words.len()]);
        write(
            r,
            &format!("emails/{name}.tsx"),
            &email_template(&name, part),
        );
    }
    for i in 0..60 {
        write(
            r,
            &format!("web/W{i}.tsx"),
            &format!("import React from \"react\";\n\nexport const W{i} = () => <div>{i}</div>;\n"),
        );
    }
    run(r, &["init"], None);
    let (_, census, _) = run_full(r, &["census", "--json"]);
    let census: Value = serde_json::from_str(&census).unwrap();
    let p = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| {
            p["summary"]
                .as_str()
                .unwrap()
                .contains("<BaseEmailWrapper>")
        })
        .unwrap_or_else(|| panic!("{census:#}"))
        .clone();
    let outliers: Vec<&str> = p["outliers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["symbol"].as_str().unwrap())
        .collect();
    assert!(outliers.is_empty(), "{p:#}");
    let exempt: Vec<(&str, &str)> = p["exempt"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["symbol"].as_str().unwrap(), e["reason"].as_str().unwrap()))
        .collect();
    assert_eq!(
        exempt,
        [
            ("BaseButton", "shared part used by 25 members"),
            ("BaseEmailWrapper", "shared part used by 50 members"),
            ("BaseLink", "shared part used by 25 members"),
        ]
    );
    let id = p["id"].as_str().unwrap().to_string();
    // The parts are not violations, so nothing was baselined: check and the hook see
    // them exactly as mining did.
    let lock = std::fs::read_to_string(r.join("drift.lock")).unwrap_or_default();
    assert!(!lock.contains("Base"), "{lock}");
    run(r, &["review", "--show-to-agents", &id], None);
    hook(r, "SessionStart", json!({ "source": "startup" }));

    // A new part: two templates now render `BaseBadge`, a fragment written in the
    // session (so nothing baselines it). The hook's single-file scan of it falls back
    // to a full scan to learn who renders it; neither it nor `drift check` reports it.
    write(r, "emails/BaseBadge.tsx", &email_part("BaseBadge", "span"));
    for name in ["Invite0", "Alert2"] {
        write(
            r,
            &format!("emails/{name}.tsx"),
            &email_template(name, "BaseBadge"),
        );
    }
    let (post, check) = post_and_check(r, "emails/BaseBadge.tsx");
    // Not a violation; #45's line of exempt members names it (`shared_part`).
    for out in [&post, &check] {
        assert!(!reports(out, &id), "{out}");
    }
    // Rendered by one template only, it is not shared: reported by both.
    write(
        r,
        "emails/Alert2.tsx",
        &email_template("Alert2", "BaseButton"),
    );
    let (post, check) = post_and_check(r, "emails/BaseBadge.tsx");
    for out in [&post, &check] {
        assert!(out.contains(&id) && out.contains("BaseBadge"), "{out}");
    }
    write(
        r,
        "emails/Alert2.tsx",
        &email_template("Alert2", "BaseBadge"),
    );
    // A new template without the wrapper.
    write(
        r,
        "emails/PlainTemplate.tsx",
        "import React from \"react\";\n\nimport { BaseButton } from \"./BaseButton\";\n\nexport const PlainTemplate = () => <BaseButton href=\"/\">Open</BaseButton>;\n\nexport default PlainTemplate;\n",
    );
    let (post, check) = post_and_check(r, "emails/PlainTemplate.tsx");
    for out in [&post, &check] {
        assert!(out.contains(&id) && out.contains("PlainTemplate"), "{out}");
        // The shared parts are not violations (#45's exempt lines may name them).
        assert!(
            !reports(out, "BaseButton.tsx") && !reports(out, "BaseLink"),
            "{out}"
        );
    }
}

/// The review fixture of #52: 30 handlers in `lib/handlers/` wrapped in `wrapper`
/// (`lib/<file>.ts#<wrapper>`), two more that call `deleteUser`, an unwrapped
/// exported handler beside them, and a route file that reaches `deleteUser` in the
/// style `variant` names.
fn route_styles_repo(wrapper: &str, file: &str, variant: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write_route_styles(dir.path(), wrapper, file, variant, "deleteUser");
    dir
}

/// [`route_styles_repo`]'s files, with the unwrapped handler named `helper`.
fn write_route_styles(r: &Path, wrapper: &str, file: &str, variant: &str, helper: &str) {
    write(
        r,
        "package.json",
        "{ \"name\": \"app\", \"dependencies\": { \"next\": \"14.2.0\", \"react\": \"18.2.0\" } }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        &format!("lib/{file}.ts"),
        &format!(
            "export function {wrapper}(h: (req: Request) => Promise<Response>) {{\n  return async (req: Request) => h(req);\n}}\n"
        ),
    );
    let words = [
        "list", "get", "count", "find", "show", "read", "load", "fetch", "query", "scan", "view",
        "peek",
    ];
    for i in 0..30 {
        let name = format!("{}Items{i}", words[i % words.len()]);
        write(
            r,
            &format!("lib/handlers/{name}.ts"),
            &format!(
                "import {{ {wrapper} }} from \"../{file}\";\n\nexport const {name} = {wrapper}(async (req: Request) => {{\n  return Response.json({{ n: {i}, url: req.url }});\n}});\n"
            ),
        );
    }
    write(
        r,
        "lib/handlers/users.ts",
        &format!(
            "export async function {helper}(req: Request) {{\n  const id = new URL(req.url).searchParams.get(\"id\");\n  return Response.json({{ deleted: id }});\n}}\n"
        ),
    );
    for name in ["bulkDelete", "purgeUsers"] {
        write(
            r,
            &format!("lib/handlers/{name}.ts"),
            &format!(
                "import {{ {wrapper} }} from \"../{file}\";\nimport {{ {helper} }} from \"./users\";\n\nexport const {name} = {wrapper}(async (req: Request) => {{\n  return {helper}(req);\n}});\n"
            ),
        );
    }
    let route = match variant {
        "local" => Some((
            "app/api/users/route.ts",
            format!(
                "import {{ {helper} }} from \"@/lib/handlers/users\";\n\nasync function handler(req: Request) {{\n  return {helper}(req);\n}}\n\nexport const DELETE = handler;\n"
            ),
        )),
        "reexport" => Some((
            "app/api/users/route.ts",
            format!("export {{ {helper} as DELETE }} from \"@/lib/handlers/users\";\n"),
        )),
        "direct" => Some((
            "app/api/users/route.ts",
            format!(
                "import {{ {helper} }} from \"@/lib/handlers/users\";\n\nexport async function DELETE(req: Request) {{\n  return {helper}(req);\n}}\n"
            ),
        )),
        "alias" => Some((
            "app/api/users/route.ts",
            format!(
                "import {{ {helper} }} from \"@/lib/handlers/users\";\n\nexport const DELETE = {helper};\n"
            ),
        )),
        "dynamic" => Some((
            "app/api/users/route.ts",
            format!(
                "export async function DELETE(req: Request) {{\n  const m = await import(\"@/lib/handlers/users\");\n  return m.{helper}(req);\n}}\n"
            ),
        )),
        "dynamic-destructured" => Some((
            "app/api/users/route.ts",
            format!(
                "export async function DELETE(req: Request) {{\n  const {{ {helper} }} = await import(\"@/lib/handlers/users\");\n  return {helper}(req);\n}}\n"
            ),
        )),
        "require" => Some((
            "app/api/users/route.ts",
            format!(
                "const users = require(\"@/lib/handlers/users\");\n\nexport async function DELETE(req: Request) {{\n  return users.{helper}(req);\n}}\n"
            ),
        )),
        "require-inline" => Some((
            "app/api/users/route.ts",
            format!(
                "export async function DELETE(req: Request) {{\n  return require(\"@/lib/handlers/users\").{helper}(req);\n}}\n"
            ),
        )),
        "register" => Some((
            "server/routes.ts",
            format!(
                "import {{ {helper} }} from \"@/lib/handlers/users\";\n\nexport function mountUserRoutes(app: {{ delete: (p: string, h: unknown) => void }}) {{\n  app.delete(\"/users/:id\", {helper});\n}}\n"
            ),
        )),
        _ => None,
    };
    if let Some((path, body)) = route {
        write(r, path, &body);
    }
    for i in 0..41 {
        write(
            r,
            &format!("util/u{i}.ts"),
            &format!("export function util{i}(x: number) {{\n  return x + {i};\n}}\n"),
        );
        write(
            r,
            &format!("web/W{i}.tsx"),
            &format!("export const W{i} = () => <div>{i}</div>;\n"),
        );
    }
}

/// What the wrapper convention of a route-styles repo says about `deleteUser`: an
/// outlier or exempt in census, a violation of `drift check` and of the hook once
/// accepted.
fn delete_user_seen(
    r: &Path,
    wrapper: &str,
    file: &str,
    variant: &str,
) -> (bool, bool, bool, bool) {
    let (_, census, _) = run_full(r, &["census", "--json"]);
    let census: Value = serde_json::from_str(&census).unwrap();
    let p = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| {
            p["summary"]
                .as_str()
                .unwrap()
                .contains(&format!("{wrapper}()"))
        })
        .unwrap_or_else(|| panic!("{census:#}"))
        .clone();
    let names = |k: &str| -> Vec<String> {
        p[k].as_array()
            .map(|a| {
                a.iter()
                    .map(|o| o["symbol"].as_str().unwrap().to_string())
                    .collect()
            })
            .unwrap_or_default()
    };
    let outlier = names("outliers").contains(&"deleteUser".to_string());
    let exempt = names("exempt").contains(&"deleteUser".to_string());
    run(r, &["init"], None);
    let id = p["id"].as_str().unwrap();
    run(r, &["review", "--show-to-agents", id], None);
    std::fs::remove_file(r.join("drift.lock")).unwrap();
    hook(r, "SessionStart", json!({ "source": "startup" }));
    // The agent renames it (a new symbol for the session), and the callers with it.
    write_route_styles(r, wrapper, file, variant, "removeUser");
    let (post, check) = post_and_check(r, "lib/handlers/users.ts");
    (
        outlier,
        exempt,
        reports(&check, "removeUser"),
        reports(&post, "removeUser"),
    )
}

#[test]
fn every_route_style_keeps_an_unwrapped_handler_reported() {
    // Review of #52: `deleteUser` is unwrapped and two wrapped handlers call it. A route
    // reaches it in each of these styles (a dynamic `import()` or a `require()` of the
    // module included: Drift records those as an import of `default`, which is taken
    // as every export), so it is a member, not a part, under a guard
    // (`withAuth`) and under a wrapper that guards nothing (`withTiming`) alike: census
    // lists it as an outlier, and `drift check` and the hook report it.
    for (wrapper, file) in [
        ("withAuth", "auth"),
        ("withWorkspace", "workspace"),
        ("withTiming", "timing"),
    ] {
        for variant in [
            "local",
            "reexport",
            "direct",
            "alias",
            "register",
            "dynamic",
            "dynamic-destructured",
            "require",
            "require-inline",
        ] {
            let dir = route_styles_repo(wrapper, file, variant);
            assert_eq!(
                delete_user_seen(dir.path(), wrapper, file, variant),
                (true, false, true, true),
                "{wrapper} {variant}"
            );
        }
    }
    // No route: under `withAuth` it is still reported (a guard has no parts); under
    // `withTiming` it is a part the two handlers share.
    let dir = route_styles_repo("withAuth", "auth", "none");
    assert_eq!(
        delete_user_seen(dir.path(), "withAuth", "auth", "none"),
        (true, false, true, true)
    );
    let dir = route_styles_repo("withTiming", "timing", "none");
    assert_eq!(
        delete_user_seen(dir.path(), "withTiming", "timing", "none"),
        (false, true, false, false)
    );
}

/// A TypeScript repo with this `package.json`, `tsconfig` paths, 30 helpers and the
/// files given.
fn ts_repo(package_json: &str, files: &[(String, String)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", package_json);
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    for (rel, body) in files {
        write(r, rel, body);
    }
    dir
}

/// `drift init`, then accept the proposal whose summary contains `needle`.
fn init_and_accept(r: &Path, needle: &str) -> String {
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains(needle))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    run(r, &["review", "--show-to-agents", &id], None);
    hook(r, "SessionStart", json!({ "source": "startup" }));
    yaml
}

fn route(wrapper: Option<&str>) -> String {
    match wrapper {
        Some(w) => format!(
            "import {{ {w} }} from \"@/lib/wrappers/{w}\";\n\nexport const GET = {w}(async (req: Request) => {{\n  return Response.json({{ ok: true }});\n}});\n"
        ),
        None => {
            "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n"
                .to_string()
        }
    }
}

#[test]
fn ts_hooks_and_check_agree_on_sibling_wrappers() {
    // F6: 30 routes use `authedHandler`; one uses `sessionHandler`, a handler wrapper
    // of the same strength defined beside it and used by three jobs too, and one uses
    // nothing. `sessionHandler` joins the rule's set, and a new route on it is no
    // violation, in the hook as in a full check.
    let mut files = vec![
        (
            "lib/wrappers/authedHandler.ts".to_string(),
            "export function authedHandler<T>(h: T): T {\n  return h;\n}\n".to_string(),
        ),
        (
            "lib/wrappers/sessionHandler.ts".to_string(),
            "export function sessionHandler<T>(h: T): T {\n  return h;\n}\n".to_string(),
        ),
    ];
    for i in 0..30 {
        files.push((
            format!("app/api/r{i:02}/route.ts"),
            route(Some("authedHandler")),
        ));
    }
    files.push((
        "app/api/admin/route.ts".into(),
        route(Some("sessionHandler")),
    ));
    files.push(("app/api/open/route.ts".into(), route(None)));
    for i in 0..3 {
        files.push((
            format!("lib/jobs/j{i}.ts"),
            "import { sessionHandler } from \"@/lib/wrappers/sessionHandler\";\n\nexport const run = sessionHandler(async () => 1);\n".into(),
        ));
    }
    let dir = ts_repo("{ \"name\": \"t\" }", &files);
    let r = dir.path();
    let yaml = init_and_accept(r, "- lib/wrappers/sessionHandler.ts#sessionHandler");
    assert!(
        yaml.contains("are wrapped in authedHandler() or\n    sessionHandler()"),
        "{yaml}"
    );

    write(r, "app/api/new/route.ts", &route(Some("sessionHandler")));
    write(r, "app/api/bare/route.ts", &route(None));
    let (post, check) = post_and_check(r, "app/api/new/route.ts");
    assert!(!post.contains("app/api/new/route.ts"), "{post}");
    assert!(!check.contains("app/api/new/route.ts"), "{check}");
    let (post, check) = post_and_check(r, "app/api/bare/route.ts");
    for out in [&post, &check] {
        assert!(out.contains("app/api/bare/route.ts"), "{out}");
    }
}

#[test]
fn ts_hooks_and_check_agree_on_framework_root_files() {
    // F9: 30 guide pages build their metadata with `genMeta()`; the root `app/page.tsx`
    // and one nested page do not. The root page is exempt, the nested one is not, in
    // the hook as in a full check.
    let page = |wrapped: bool| {
        if wrapped {
            "import { genMeta } from \"@/lib/meta\";\n\nconst generateMetadata = genMeta(() => ({ title: \"x\" }));\n\nexport { generateMetadata };\n\nexport default function Page() {\n  return null;\n}\n".to_string()
        } else {
            "const generateMetadata = async () => ({ title: \"x\" });\n\nexport { generateMetadata };\n\nexport default function Page() {\n  return null;\n}\n".to_string()
        }
    };
    let mut files = vec![(
        "lib/meta.ts".to_string(),
        "export function genMeta<T>(f: T): T {\n  return f;\n}\n".to_string(),
    )];
    for i in 0..30 {
        files.push((format!("app/guides/g{i:02}/page.tsx"), page(true)));
    }
    files.push(("app/page.tsx".into(), page(false)));
    files.push(("app/blog/x/page.tsx".into(), page(false)));
    let dir = ts_repo(
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\", \"react\": \"19.0.0\" } }",
        &files,
    );
    let r = dir.path();
    init_and_accept(r, "genMeta()");
    let (_, census, _) = run_full(r, &["census", "--json"]);
    assert!(
        census.contains("the app's root page (app/page.tsx), a framework root file"),
        "{census}"
    );

    write(r, "app/page.tsx", &page(false).replace("\"x\"", "\"home\""));
    let (post, check) = post_and_check(r, "app/page.tsx");
    // Not a violation; #45's line of exempt members may name it, with the reason.
    let reported = |out: &str| {
        out.split("\\n")
            .flat_map(|l| l.split('\n'))
            .any(|l| l.contains("app/page.tsx") && !l.contains("exempt"))
    };
    assert!(!reported(&post), "{post}");
    assert!(!reported(&check), "{check}");
    write(r, "app/blog/y/page.tsx", &page(false));
    let (post, check) = post_and_check(r, "app/blog/y/page.tsx");
    for out in [&post, &check] {
        assert!(out.contains("app/blog/y/page.tsx"), "{out}");
    }
}

/// `name` is reported as a violation in `out` (hook JSON or check text): named on a line
/// that is not #45's line of exempt members ("not checked against", "exempt").
fn reports(out: &str, name: &str) -> bool {
    out.split("\\n")
        .flat_map(|l| l.split('\n'))
        .any(|l| l.contains(name) && !l.contains("not checked against") && !l.contains("exempt"))
}

/// A FastAPI repo whose routes in `app/api/**` depend on the session (`SessionDep`) or
/// the user (`CurrentUser`) as their outermost dependency. `read_36` takes the user
/// through `AuthDep`, an alias of a `Depends(get_current_user)` constant, which counts
/// as `get_current_user`. `read_37` reaches the session only through another
/// dependency, which holds the set: a variant set is counted over every dependency
/// slot, as `check` reads it (#60). Two do not hold: one takes the user through a soft
/// dependency (`get_optional_user`, which a chain does not follow), one takes nothing.
fn python_depends_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/api/__init__.py", "");
    write(
        r,
        "app/api/deps.py",
        "from typing import Annotated\n\nfrom fastapi import Depends\n\n\ndef get_db():\n    yield 1\n\n\ndef get_current_user():\n    return 1\n\n\ndef get_optional_user(user: int = Depends(get_current_user)):\n    return user\n\n\ndef get_request_context(db: int = Depends(get_db)):\n    return {}\n\n\nSessionDep = Annotated[int, Depends(get_db)]\nCurrentUser = Annotated[int, Depends(get_current_user)]\nAUTH_REQUIRED = Depends(get_current_user)\nAuthDep = Annotated[int, AUTH_REQUIRED]\n",
    );
    for i in 0..40 {
        let params = match i {
            0..20 => "user: CurrentUser",
            20..36 => "session: SessionDep",
            36 => "user: AuthDep",
            37 => "ctx: dict = Depends(get_request_context)",
            38 => "user: int = Depends(get_optional_user)",
            _ => "",
        };
        write(
            r,
            &format!("app/api/r{i}.py"),
            &depends_route("read", i, params),
        );
        // Functions elsewhere depend on nothing: the rule is the routes' own.
        write(
            r,
            &format!("lib/u{i}.py"),
            &format!("def u{i}():\n    return {i}\n"),
        );
    }
    dir
}

fn depends_route(prefix: &str, i: usize, params: &str) -> String {
    format!(
        "from fastapi import APIRouter, Depends\n\nfrom app.api.deps import AuthDep, CurrentUser, SessionDep, get_optional_user, get_request_context\n\nrouter = APIRouter()\n\n\n@router.get(\"/{prefix}{i}\")\ndef {prefix}_{i}({params}):\n    return {i}\n"
    )
}

#[test]
fn python_dependency_chains_hold_in_census_check_and_hooks() {
    let dir = python_depends_repo();
    let r = dir.path();
    let (code, out) = run(r, &["census", "--json", "--no-cache"], None);
    assert_eq!(code, 0, "{out}");
    let census: Value = serde_json::from_str(&out).unwrap();
    let p = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| {
            p["rule"]["any_of"]
                .as_array()
                .is_some_and(|a| a.iter().any(|x| x.as_str().unwrap().ends_with("#get_db")))
        })
        .unwrap_or_else(|| panic!("{out}"));
    // Decision D7: Python advises only, so the dependency rule is a suggestion.
    assert_eq!(p["tier"], "suggestion", "{p}");
    assert_eq!(p["tier_reason"], "language_advise", "{p}");
    let outliers: Vec<&str> = p["outliers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["symbol"].as_str().unwrap())
        .collect();
    // `read_36` holds through the constant. `read_37` reaches `get_db` behind
    // `get_request_context`, in a later slot: it holds, in census as in `check` (#60).
    // `read_38` reaches the user only through a soft dependency.
    assert_eq!(outliers, ["read_38", "read_39"], "{p}");
    assert_eq!(p["evidence"]["holders"], 38, "{p}");

    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = p["id"].as_str().unwrap();
    assert!(yaml.contains(&format!("- id: {id}")), "{yaml}");
    run(r, &["review", "--show-to-agents", id], None);
    // A Python rule is a suggestion (D7), so blocking it takes --force.
    let (code, _, err) = run_full(r, &["review", "--block", id, "--force"]);
    assert_eq!(code, 0, "{err}");
    let (code, out) = run(r, &["check"], None);
    assert_eq!(code, 0, "only legacy outliers: {out}");
    hook(r, "SessionStart", json!({ "source": "startup" }));
    let advice = |rel: &str| {
        hook(r, "PostToolUse", edit(r, rel))
            .map(|v| v["hookSpecificOutput"]["additionalContext"].to_string())
            .unwrap_or_default()
    };
    // A new route on the constant alias holds; one on the soft dependency does not,
    // from a single-file scan, the full one, `check` and MCP alike.
    write(
        r,
        "app/api/n1.py",
        &depends_route("new", 1, "user: AuthDep"),
    );
    write(
        r,
        "app/api/n3.py",
        &depends_route("new", 3, "user: int = Depends(get_optional_user)"),
    );
    let post = [advice("app/api/n1.py"), advice("app/api/n3.py")].concat();
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false }))
        .map(|v| v.to_string())
        .unwrap_or_default();
    let (code, check) = run(r, &["check"], None);
    assert_ne!(code, 0, "{check}");
    assert!(check.contains("1 new violation"), "{check}");
    let msg = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_check","arguments":{"paths":["app/api/n1.py","app/api/n3.py"]}}});
    let (_, mcp) = run(r, &["mcp"], Some(&format!("{msg}\n")));
    for (what, out) in [
        ("PostToolUse", &post),
        ("Stop", &stop),
        ("check", &check),
        ("MCP", &mcp),
    ] {
        assert!(out.contains("new_3"), "{what}: {out}");
        // [FIX1-G1] S22: under a blocking rule's violation, `check` names members that
        // follow it nearby (`holds near it`); `new_1` may be one of them. It is never
        // reported as a violation.
        let reported: String = out
            .lines()
            .filter(|l| !l.trim_start().starts_with("holds near it"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!reported.contains("new_1"), "{what}: {out}");
    }
    // Single-file facts equal a full scan's.
    let (code, out) = run(r, &["debug", "incremental"], None);
    assert_eq!(code, 0, "{out}");
    assert!(out.ends_with(", 0 mismatches\n"), "{out}");
}

fn service_file(i: usize, extra: &str) -> String {
    format!(
        "import {{ EventEmitter }} from \"events\";\nimport {{ BaseService }} from \"./base.service\";\n\nexport class S{i}Service extends BaseService {{}}\n{extra}"
    )
}

/// 40 services on the team's `BaseService`, an event emitter beside one of them,
/// a legacy service on no base, and plain classes elsewhere; the base-class
/// convention accepted to block.
fn services_repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "src/services/base.service.ts",
        "export class BaseService {}\n",
    );
    for i in 0..40 {
        let extra = if i == 0 {
            "export class UrlEmitter extends EventEmitter {}\n"
        } else {
            ""
        };
        write(
            r,
            &format!("src/services/s{i:02}.service.ts"),
            &service_file(i, extra),
        );
    }
    write(
        r,
        "src/services/plain.service.ts",
        "export class PlainService {}\n",
    );
    for i in 0..80 {
        write(
            r,
            &format!("src/util/u{i:02}.ts"),
            &format!("export class U{i} {{}}\n"),
        );
    }
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|block| block.contains("BaseService") && block.contains("extends"))
        .map(|b| b[..8].to_string())
        .expect("base-class convention learned");
    // A base-class rule is a suggestion since decision D7, so blocking it takes --force.
    run(r, &["review", "--block", &id, "--force"], None);
    (dir, id)
}

#[test]
fn exempt_members_are_listed_by_census_check_and_the_hooks() {
    let (dir, id) = services_repo();
    let r = dir.path();
    let reason = "a emitter, named for its base EventEmitter";

    // The census card shows the exempt members next to the outliers.
    let (_, census) = run(r, &["census", "--all-outliers"], None);
    assert!(
        census.contains(&format!(
            "exempt:   src/services/s00.service.ts:5 UrlEmitter ({reason})"
        )) && census.contains(
            "exempt:   src/services/base.service.ts:1 BaseService (in the module that defines BaseService)"
        ),
        "{census}"
    );
    assert!(census.contains("outlier:  src/services/plain.service.ts:1 PlainService"));

    // `drift check` lists them, in text and JSON.
    let (code, text) = run(r, &["check"], None);
    assert_eq!(code, 0, "{text}");
    assert!(
        text.contains("2 member(s) not checked")
            && text.contains(&format!(
                "exempt [{id}] src/services/s00.service.ts:5 UrlEmitter ({reason})"
            )),
        "{text}"
    );
    let (_, json) = run(r, &["check", "--format", "json"], None);
    let v: Value = serde_json::from_str(&json).unwrap();
    let watcher = v["exempt"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["symbol"] == "UrlEmitter")
        .unwrap_or_else(|| panic!("{json}"));
    assert_eq!(watcher["id"], id.as_str());
    assert_eq!(watcher["reason"], reason);
    assert_eq!(watcher["code"], "named_for_base");

    // The hooks name an exemption the agent's code adds, once; the ones there when the
    // session started are not news.
    hook(r, "SessionStart", json!({}));
    write(
        r,
        "src/services/s01.service.ts",
        &service_file(1, "export class PingEmitter extends EventEmitter {}\n"),
    );
    let post = hook(r, "PostToolUse", edit(r, "src/services/s01.service.ts")).unwrap();
    let ctx = post["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        ctx.contains(&format!(
            "drift: 1 member(s) exempt from accepted conventions: `PingEmitter` not checked against {id}: {reason}"
        )) && !ctx.contains("UrlEmitter"),
        "{ctx}"
    );
    assert!(hook(r, "PostToolUse", edit(r, "src/services/s01.service.ts")).is_none());
    // At the end of the turn the person is told, without blocking.
    write(
        r,
        "src/services/s02.service.ts",
        &service_file(2, "export class TickEmitter extends EventEmitter {}\n"),
    );
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert!(stop.get("decision").is_none(), "{stop}");
    // The person hears about every exemption the session added, including the one
    // PostToolUse already told the agent about, once.
    let m = stop["systemMessage"].as_str().unwrap();
    assert!(
        m.contains("2 member(s) exempt")
            && m.contains("`TickEmitter` not checked against")
            && m.contains("`PingEmitter` not checked against")
            && !m.contains("UrlEmitter"),
        "{m}"
    );
    assert!(hook(r, "Stop", json!({ "stop_hook_active": false })).is_none());
    // A new service on another base skipped the team's: a violation, not an exemption.
    write(
        r,
        "src/services/refund.service.ts",
        "import { EventEmitter } from \"events\";\n\nexport class RefundService extends EventEmitter {}\n",
    );
    // So is a class on another base in a services file, whatever its name.
    write(
        r,
        "src/services/refunds.service.ts",
        "import { EventEmitter } from \"events\";\n\nexport class Refunds extends EventEmitter {}\n",
    );
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block", "{stop}");
    let why = stop["reason"].as_str().unwrap();
    assert!(
        why.contains("RefundService") && why.contains("Refunds"),
        "{why}"
    );
}

#[test]
fn an_exempt_member_that_becomes_a_violation_is_reported() {
    let (dir, id) = services_repo();
    let r = dir.path();
    hook(r, "SessionStart", json!({}));
    // `UrlEmitter` was exempt when the session started; on no base, in a services
    // file, it is a service that skipped the base.
    write(
        r,
        "src/services/s00.service.ts",
        &service_file(0, "export class UrlEmitter {}\n"),
    );
    let post = hook(r, "PostToolUse", edit(r, "src/services/s00.service.ts")).unwrap();
    let ctx = post["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        ctx.contains(&format!("[{id}]")) && ctx.contains("UrlEmitter"),
        "{ctx}"
    );
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block", "{stop}");
}

#[test]
fn the_fallback_baseline_counts_violations_not_exemptions() {
    let (dir, _) = services_repo();
    let r = dir.path();
    write(
        r,
        "src/services/late.service.ts",
        "export class LateService {}\n",
    );
    // No SessionStart and no git: the baseline takes the one new violation
    // (`LateService`) and the two exempt members, and says 1.
    let out = hook_as(r, "late", "Stop", json!({}));
    assert!(!blocks(out.clone()), "{out:?}");
    assert!(
        message(&out).contains("state was missing; 1 current violation(s) were taken"),
        "{out:?}"
    );
    assert!(!message(&out).contains("exempt from"), "{out:?}");
}

// #32 x #45 (merge choice 1): when a session's state is lost, a language with a file
// changed since HEAD, or untracked, baselines none of its violations, and none of its
// exempt members either: the person is told about them as new. With the tree as
// committed, the same members are baseline and nothing is said about them.
#[test]
fn a_lost_state_baselines_no_exempt_member_of_a_touched_language() {
    let (dir, id) = services_repo();
    let r = dir.path();
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "services"]);

    // Committed, untouched: the exempt members are baseline, so Stop says nothing of them.
    let out = hook_as(r, "clean", "Stop", json!({}));
    assert!(
        message(&out).contains("state was missing") && !message(&out).contains("exempt from"),
        "{out:?}"
    );

    // An untracked TypeScript file with a new exempt member: JS/TS is touched.
    write(
        r,
        "src/services/s40.service.ts",
        &service_file(40, "export class FeedEmitter extends EventEmitter {}\n"),
    );
    let out = hook_as(r, "lost", "Stop", json!({}));
    let m = message(&out);
    assert!(m.contains("none of them JavaScript/TypeScript"), "{out:?}");
    // Neither the new exempt member nor the one already there is baseline: both are
    // told to the person, against the convention.
    assert!(m.contains("exempt from accepted conventions"), "{out:?}");
    assert!(
        m.contains(&format!("`FeedEmitter` not checked against {id}")),
        "{out:?}"
    );
    assert!(
        m.contains(&format!("`UrlEmitter` not checked against {id}")),
        "{out:?}"
    );
}

#[test]
fn exemptions_reach_github_and_sarif_not_mcp_check() {
    let (dir, id) = services_repo();
    let r = dir.path();
    let (_, gh) = run(r, &["check", "--format", "github"], None);
    assert!(
        gh.contains(&format!(
            "::notice file=src/services/s00.service.ts,line=5,title=drift {id} exempt::UrlEmitter is not checked against {id}: a emitter, named for its base EventEmitter."
        )),
        "{gh}"
    );
    let (_, sarif) = run(r, &["check", "--format", "sarif"], None);
    let s: Value = serde_json::from_str(&sarif).unwrap();
    let note = s["runs"][0]["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| {
            x["level"] == "note"
                && x["message"]["text"]
                    .as_str()
                    .is_some_and(|t| t.starts_with("UrlEmitter "))
        })
        .unwrap_or_else(|| panic!("{sarif}"));
    assert_eq!(note["ruleId"], id.as_str());
    assert_eq!(note["suppressions"][0]["kind"], "external");
    assert_eq!(note["properties"]["exempt"], "named_for_base");
    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_check","arguments":{"paths":["src/services/s00.service.ts"]}}}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, out) = run(r, &["mcp"], Some(&input));
    let reply: Value = serde_json::from_str(out.lines().last().unwrap()).unwrap();
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    // R3: exemption chatter about other members after "No new violations." is not the
    // agent's to act on; `drift check --format json` and SARIF (above) still list it.
    assert_eq!(text, "No new violations.", "{text}");
}

#[test]
fn an_unguarded_nest_controller_on_a_package_base_blocks() {
    // 30 controllers extend the team's `AuthedController`, and their routes make it a
    // guard. A webhook controller on a package handler base, named for that base, is not
    // exempt: Stop blocks and `drift check` fails.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"@nestjs/common\": \"10\", \"svix-nest\": \"1\" } }",
    );
    write(
        r,
        "src/auth/authed.ts",
        "export class AuthedController {}\n",
    );
    for i in 0..30 {
        write(
            r,
            &format!("src/x{i:02}/x{i:02}.controller.ts"),
            &format!(
                "import {{ Controller, Post }} from \"@nestjs/common\";\nimport {{ AuthedController }} from \"../auth/authed\";\n\n@Controller(\"x{i}\")\nexport class X{i}Controller extends AuthedController {{\n  @Post(\"run\")\n  run() {{}}\n}}\n"
            ),
        );
    }
    write(
        r,
        "src/plain/plain.controller.ts",
        "import { Controller, Post } from \"@nestjs/common\";\n\n@Controller(\"plain\")\nexport class PlainController {\n  @Post(\"run\")\n  run() {}\n}\n",
    );
    for i in 0..80 {
        write(
            r,
            &format!("src/util/u{i:02}.ts"),
            &format!("export class U{i} {{}}\n"),
        );
    }
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("AuthedController") && b.contains("extends"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    // A base-class rule is a suggestion since decision D7, so blocking it takes --force.
    run(r, &["review", "--block", &id, "--force"], None);
    hook(r, "SessionStart", json!({}));
    write(
        r,
        "src/stripe/stripe.controller.ts",
        "import { Controller, Post } from \"@nestjs/common\";\nimport { WebhookHandler } from \"svix-nest\";\n\n@Controller(\"stripe\")\nexport class StripeWebhookHandler extends WebhookHandler {\n  @Post(\"purge-everything\")\n  purge() {}\n}\n",
    );
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block", "{stop}");
    assert!(
        stop["reason"]
            .as_str()
            .unwrap()
            .contains("StripeWebhookHandler")
    );
    let (code, text) = run(r, &["check"], None);
    assert_eq!(code, 1, "{text}");
    assert!(
        text.contains("StripeWebhookHandler") && !text.contains("not checked"),
        "{text}"
    );
}

/// `out` (a hook's output or `check`'s) names `symbol` as exempt.
fn names_exempt(out: &str, symbol: &str) -> bool {
    out.split(['\n', ';']).any(|l| {
        l.contains(symbol) && (l.contains("not checked against") || l.contains("exempt ["))
    })
}

/// The block-mode convention on `target` (`init`, then `review --block --force`: a
/// base-class rule is a suggestion since D7), after the session started.
fn block_extends(r: &Path, target: &str) -> String {
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains(target) && b.contains("extends"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    run(r, &["review", "--block", &id, "--force"], None);
    hook(r, "SessionStart", json!({}));
    id
}

#[test]
fn an_express_handler_a_route_constructs_blocks() {
    // #45's follow-up repro: 30 handlers extend the team's `BaseHandler` (its `handle()`
    // answers 401 without a user) and each route runs one with `new XHandler().handle(req,
    // res)`. A webhook processor on a package base, named for it, that a new route
    // constructs is not exempt: PostToolUse and `check` agree, Stop blocks, check fails.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"express\": \"4\", \"svix\": \"1\" } }",
    );
    write(
        r,
        "src/lib/base.handler.ts",
        "export abstract class BaseHandler {\n  handle(req: any, res: any) {\n    if (!req.user) return res.status(401).end();\n    return this.run(req, res);\n  }\n  abstract run(req: any, res: any): unknown;\n}\n",
    );
    let mut routes = String::from("import express from \"express\";\n");
    let mut body = String::from("export const app = express();\n");
    for i in 0..30 {
        write(
            r,
            &format!("src/handlers/x{i:02}.handler.ts"),
            &format!(
                "import {{ BaseHandler }} from \"../lib/base.handler\";\n\nexport class X{i}Handler extends BaseHandler {{\n  run(req: any, res: any) {{\n    return res.json({{ ok: true }});\n  }}\n}}\n"
            ),
        );
        routes.push_str(&format!(
            "import {{ X{i}Handler }} from \"./handlers/x{i:02}.handler\";\n"
        ));
        body.push_str(&format!(
            "app.post(\"/x{i}\", (req, res) => new X{i}Handler().handle(req, res));\n"
        ));
    }
    write(r, "src/routes.ts", &format!("{routes}{body}"));
    for i in 0..80 {
        write(
            r,
            &format!("src/util/u{i:02}.ts"),
            &format!("export class U{i} {{}}\n"),
        );
    }
    let id = block_extends(r, "BaseHandler");
    write(
        r,
        "src/handlers/stripe.handler.ts",
        "import { WebhookProcessor } from \"svix\";\n\nexport class StripeWebhookProcessor extends WebhookProcessor {\n  handle(req: any, res: any) {\n    return res.json({ purged: true });\n  }\n}\n",
    );
    write(
        r,
        "src/routes.ts",
        &format!(
            "{routes}import {{ StripeWebhookProcessor }} from \"./handlers/stripe.handler\";\n{body}app.post(\"/stripe/purge-everything\", (req, res) => new StripeWebhookProcessor().handle(req, res));\n"
        ),
    );
    let (post, check) = post_and_check(r, "src/handlers/stripe.handler.ts");
    for out in [&post, &check] {
        assert!(
            out.contains("StripeWebhookProcessor") && !names_exempt(out, "StripeWebhookProcessor"),
            "{out}"
        );
    }
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block", "{stop}");
    let reason = stop["reason"].as_str().unwrap();
    assert!(
        reason.contains("StripeWebhookProcessor") && reason.contains(&id),
        "{reason}"
    );
    let (code, text) = run(r, &["check"], None);
    assert_eq!(code, 1, "{text}");
    assert!(
        text.contains("StripeWebhookProcessor") && !names_exempt(&text, "StripeWebhookProcessor"),
        "{text}"
    );
}

#[test]
fn a_flask_view_that_instantiates_an_unguarded_handler_blocks() {
    // The Python analogue: 32 handlers on the team's `BaseHandler`, each run by a Flask
    // view (`return XHandler().handle(request)`); a processor on svix's base that a new
    // view instantiates blocks at Stop, and the hook's verdict on its file is check's.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"acme\"\ndependencies = [\"flask>=3\", \"svix>=1\"]\n",
    );
    for p in [
        "app/__init__.py",
        "app/handlers/__init__.py",
        "app/lib/__init__.py",
    ] {
        write(r, p, "");
    }
    write(
        r,
        "app/lib/base_handler.py",
        "from flask import abort, g\n\n\nclass BaseHandler:\n    def handle(self, request):\n        if not getattr(g, \"user\", None):\n            abort(401)\n        return self.run(request)\n",
    );
    let mut imports = String::from("from flask import Flask, request\n");
    let mut views = String::from("\napp = Flask(__name__)\n");
    for i in 0..32 {
        write(
            r,
            &format!("app/handlers/x{i:02}_handler.py"),
            &format!(
                "from app.lib.base_handler import BaseHandler\n\n\nclass X{i}Handler(BaseHandler):\n    def run(self, request):\n        return {{}}\n"
            ),
        );
        imports.push_str(&format!(
            "from app.handlers.x{i:02}_handler import X{i}Handler\n"
        ));
        views.push_str(&format!(
            "\n\n@app.post(\"/x{i}\")\ndef x{i}_view():\n    return X{i}Handler().handle(request)\n"
        ));
    }
    write(
        r,
        "app/handlers/legacy_handler.py",
        "class LegacyPingHandler:\n    def handle(self, request):\n        return {}\n",
    );
    write(r, "app/routes.py", &format!("{imports}{views}"));
    for i in 0..80 {
        write(
            r,
            &format!("app/util/u{i:02}.py"),
            &format!("class U{i}:\n    pass\n"),
        );
    }
    write(r, "app/util/__init__.py", "");
    let id = block_extends(r, "BaseHandler");
    write(
        r,
        "app/handlers/stripe_handler.py",
        "from svix.webhooks import WebhookProcessor\n\n\nclass StripeWebhookProcessor(WebhookProcessor):\n    def handle(self, request):\n        return {\"purged\": True}\n",
    );
    write(
        r,
        "app/routes.py",
        &format!(
            "{imports}from app.handlers.stripe_handler import StripeWebhookProcessor\n{views}\n\n@app.post(\"/stripe/purge-everything\")\ndef stripe_purge_view():\n    return StripeWebhookProcessor().handle(request)\n"
        ),
    );
    let (post, check) = post_and_check(r, "app/handlers/stripe_handler.py");
    for out in [&post, &check] {
        assert!(
            out.contains("StripeWebhookProcessor") && !names_exempt(out, "StripeWebhookProcessor"),
            "{out}"
        );
    }
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block", "{stop}");
    assert!(stop["reason"].as_str().unwrap().contains(&id), "{stop}");
    let (code, text) = run(r, &["check"], None);
    assert_eq!(code, 1, "{text}");
    assert!(
        text.contains("StripeWebhookProcessor") && !names_exempt(&text, "StripeWebhookProcessor"),
        "{text}"
    );
}

/// A NestJS controller file: `@Get()` handlers decorated with the team's `@Endpoint()`
/// (`holders`), with `@ApiExcludeEndpoint()` instead (`opted`), or with neither (`bare`).
fn nest_controller(name: &str, holders: usize, opted: usize, bare: usize) -> String {
    let mut body = format!(
        "import {{ Controller, Get }} from '@nestjs/common';\nimport {{ ApiExcludeEndpoint }} from '@nestjs/swagger';\nimport {{ Endpoint }} from './decorators';\n\n@Controller('{name}')\nexport class {}Controller {{\n",
        name.to_uppercase()
    );
    let mut handler = |route: String, decorator: &str| {
        body.push_str(&format!(
            "  @Get('{route}')\n{decorator}  {}() {{\n    return 1;\n  }}\n\n",
            route.replace('-', "_")
        ));
    };
    for i in 0..holders {
        handler(format!("doc-{i}"), "  @Endpoint('docs')\n");
    }
    for i in 0..opted {
        handler(format!("skip-{i}"), "  @ApiExcludeEndpoint()\n");
    }
    for i in 0..bare {
        handler(format!("bare-{i}"), "");
    }
    body.push_str("}\n");
    body
}

#[test]
fn hooks_and_check_never_take_an_opt_out_for_a_route() {
    // `@Endpoint()` wraps only `@nestjs/swagger`; three handlers carry that package's
    // `@ApiExcludeEndpoint()` instead, which no `@Endpoint()` handler carries: an opt-out
    // by F11a's clauses. But they are routes, and `@Endpoint()` decorates the routes (a
    // guard as `drift security` reads guards): the exemption gate refuses any exemption
    // for an entry point or under a guard, the opt-out included. They stay outliers, and
    // the hook's scan and `drift check` both report them, like a handler with neither.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"api\" }");
    write(
        r,
        "src/decorators.ts",
        "import { applyDecorators } from '@nestjs/common';\nimport { ApiOperation, ApiTags } from '@nestjs/swagger';\n\nexport function Endpoint(summary: string) {\n  return applyDecorators(ApiOperation({ summary }), ApiTags('api'));\n}\n",
    );
    for (i, (opted, bare)) in [(2, 1), (1, 0), (0, 0), (0, 0), (0, 0)].iter().enumerate() {
        write(
            r,
            &format!("src/c{i}.controller.ts"),
            &nest_controller(&format!("c{i}"), 8, *opted, *bare),
        );
    }
    for i in 0..40 {
        write(
            r,
            &format!("src/lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    run(r, &["init"], None);
    let (_, json, _) = run_full(r, &["census", "--json", "--all-outliers"]);
    let census: Value = serde_json::from_str(&json).unwrap();
    let p = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule"]["any_of"][0] == "src/decorators.ts#Endpoint")
        .unwrap_or_else(|| panic!("{json}"))
        .clone();
    let id = p["id"].as_str().unwrap().to_string();
    let exempt = p["exempt"].as_array().map_or(0, Vec::len);
    assert_eq!(exempt, 0, "{p}");
    let outliers: Vec<&str> = p["outliers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["symbol"].as_str().unwrap())
        .collect();
    assert_eq!(
        outliers.iter().filter(|s| s.contains("/skip-")).count(),
        3,
        "{p}"
    );
    // A decorator rule is a suggestion (D7): blocked on purpose.
    run(r, &["review", "--block", &id, "--force"], None);
    hook(r, "SessionStart", json!({ "source": "startup" }));

    write(r, "src/c9.controller.ts", &nest_controller("c9", 2, 1, 1));
    let (post, check) = post_and_check(r, "src/c9.controller.ts");
    for out in [&post, &check] {
        assert!(out.contains("/c9/bare-0"), "{out}");
        assert!(out.contains("/c9/skip-0"), "{out}");
        assert!(
            !out.contains("/c0/skip-"),
            "baselined at session start: {out}"
        );
    }
}

// ---------- known limitations of the neighbour gate (round 11, WS-J; off by default) ----------
//
// With `DRIFT_NEIGHBOUR_GATE=on`, a new violator next to a member Drift exempts by itself
// (not a reviewer's exception) is nearer that member than the holders, so the gate holds
// a real violation back. The labelled-outlier evaluation did not cover this case
// (eval/study/runs/neighbour-r11-2026-11-08/README.md); any future admission must. These
// tests pin the limitation: when it is fixed, they fail and must be turned around.

/// `drift check --format json` with the neighbour gate on.
fn check_json_gate_on(root: &Path) -> Value {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env("DRIFT_NEIGHBOUR_GATE", "on")
        .args(["check", "--format", "json"])
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("{e}: {out:?}"))
}

/// Whether the gate held back the violation of `symbol` in `path`.
fn held_back(v: &Value, path: &str, symbol: &str) -> bool {
    v["suppressed_neighbour"].as_array().is_some_and(|hs| {
        hs.iter()
            .any(|h| h["path"] == path && h["symbol"] == symbol)
    })
}

#[test]
fn known_limitation_gate_holds_back_a_violator_next_to_a_base_class_exemption() {
    // Failure mode: a new violator near a member Drift exempts by itself (base-class exemption).
    let dir = python_base_repo("class ChoiceSet:\n    pass\n", "ChoiceSet");
    let r = dir.path();
    write(r, "app/new/__init__.py", "");
    write(
        r,
        "app/new/choices.py",
        "from django import forms\n\n\nclass PriorityField(forms.ChoiceField):\n    pass\n\n\nclass OrderThing:\n    pass\n",
    );
    let v = check_json_gate_on(r);
    assert!(held_back(&v, "app/new/choices.py", "OrderThing"), "{v:#}");
}

#[test]
fn known_limitation_gate_holds_back_a_violator_next_to_shared_parts() {
    // Failure mode: a new violator near a member Drift exempts by itself (shared parts).
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"mail\" }");
    write(
        r,
        "emails/BaseEmailWrapper.tsx",
        "import React from \"react\";\n\nexport const BaseEmailWrapper = ({ children }: { children: React.ReactNode }) => {\n  return <html>{children}</html>;\n};\n",
    );
    write(r, "emails/BaseButton.tsx", &email_part("BaseButton", "a"));
    write(r, "emails/BaseLink.tsx", &email_part("BaseLink", "a"));
    let words = [
        "Invite",
        "ResetPassword",
        "Alert",
        "Digest",
        "Welcome",
        "Receipt",
    ];
    for i in 0..50 {
        let part = if i % 2 == 0 { "BaseButton" } else { "BaseLink" };
        let name = format!("{}{i}", words[i % words.len()]);
        write(
            r,
            &format!("emails/{name}.tsx"),
            &email_template(&name, part),
        );
    }
    for i in 0..60 {
        write(
            r,
            &format!("web/W{i}.tsx"),
            &format!("import React from \"react\";\n\nexport const W{i} = () => <div>{i}</div>;\n"),
        );
    }
    run(r, &["init"], None);
    let census: Value = serde_json::from_str(&run_full(r, &["census", "--json"]).1).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| {
            p["summary"]
                .as_str()
                .unwrap()
                .contains("<BaseEmailWrapper>")
        })
        .unwrap_or_else(|| panic!("{census:#}"))["id"]
        .as_str()
        .unwrap()
        .to_string();
    run(r, &["review", "--show-to-agents", &id], None);
    // `BaseBadge`, rendered by one template only: not a shared part, a violation.
    write(r, "emails/BaseBadge.tsx", &email_part("BaseBadge", "span"));
    write(
        r,
        "emails/Invite0.tsx",
        &email_template("Invite0", "BaseBadge"),
    );
    let v = check_json_gate_on(r);
    assert!(held_back(&v, "emails/BaseBadge.tsx", "BaseBadge"), "{v:#}");
}

#[test]
fn known_limitation_gate_holds_back_a_violator_next_to_a_framework_root_file() {
    // Failure mode: a new violator near a member Drift exempts by itself (framework root files).
    let page = |wrapped: bool| {
        if wrapped {
            "import { genMeta } from \"@/lib/meta\";\n\nconst generateMetadata = genMeta(() => ({ title: \"x\" }));\n\nexport { generateMetadata };\n\nexport default function Page() {\n  return null;\n}\n".to_string()
        } else {
            "const generateMetadata = async () => ({ title: \"x\" });\n\nexport { generateMetadata };\n\nexport default function Page() {\n  return null;\n}\n".to_string()
        }
    };
    let mut files = vec![(
        "lib/meta.ts".to_string(),
        "export function genMeta<T>(f: T): T {\n  return f;\n}\n".to_string(),
    )];
    for i in 0..30 {
        files.push((format!("app/guides/g{i:02}/page.tsx"), page(true)));
    }
    files.push(("app/page.tsx".into(), page(false)));
    files.push(("app/blog/x/page.tsx".into(), page(false)));
    let dir = ts_repo(
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\", \"react\": \"19.0.0\" } }",
        &files,
    );
    let r = dir.path();
    init_and_accept(r, "genMeta()");
    write(r, "app/blog/y/page.tsx", &page(false));
    let v = check_json_gate_on(r);
    assert!(
        held_back(&v, "app/blog/y/page.tsx", "generateMetadata"),
        "{v:#}"
    );
}
