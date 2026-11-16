//! What each hook costs, pinned by counts of work, not by a stopwatch (CI machines
//! vary): with `DRIFT_HOOK_TRACE` set, each hook writes the work it did (`work`: tree
//! walks, source files read, parses, full and one-file scans, config and policy loads).
//! On a repository of about three hundred files, played through one session:
//!
//! - hooks before a search, a shell command or a prompt walk nothing and scan nothing;
//! - before an edit of an existing file: one walk and one one-file scan at most, no full
//!   scan, nothing parsed (the file's facts are cached);
//! - after an edit: the edited file alone is parsed, and the repository is scanned once
//!   at most, only when one file is not enough. Before, the edit of a new route the
//!   accepted rules found a violation in scanned the repository twice (once for the
//!   practice map and the inventory, once more for the conventions' check);
//! - every hook reads `.drift/config.yaml` once at most (before, about five times) and
//!   the policy once at most.

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

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_HOOK_TRACE")
        .args(args)
        .current_dir(root)
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

/// One traced hook: what it told the agent (`additionalContext`, empty for nothing), its
/// whole output and its trace line.
struct Ran {
    context: String,
    out: Value,
    trace: Value,
}

impl Ran {
    fn work(&self, kind: &str) -> u64 {
        self.trace["work"][kind]
            .as_u64()
            .unwrap_or_else(|| panic!("no {kind} in {:#}", self.trace))
    }

    fn path(&self) -> &str {
        self.trace["path"].as_str().unwrap()
    }
}

fn hook(root: &Path, event: &str, extra: Value) -> Ran {
    let trace = root.join(".trace.jsonl");
    std::fs::remove_file(&trace).ok();
    let mut input = json!({ "session_id": "s1", "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env_remove("DRIFT_CACHE_DIR")
        .env("DRIFT_HOOK_TRACE", &trace)
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
    let out = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let v: Value = if out.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&out).expect("hook output is JSON")
    };
    let lines: Vec<Value> = std::fs::read_to_string(&trace)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 1, "{lines:#?}");
    Ran {
        context: v["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        out: v,
        trace: lines.into_iter().next().unwrap(),
    }
}

fn edit(root: &Path, tool: &str, rel: &str) -> Value {
    json!({ "tool_name": tool, "tool_input": { "file_path": root.join(rel) } })
}

const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// About three hundred files: 40 routes, 38 wrapped in `withAuth`, and 250 helpers,
/// with a `.drift/config.yaml`. After `drift init` the mined `withAuth` rule blocks.
/// The files are written over two seconds before the first scan reads them, so the
/// scan index vouches for them later (a file changed that close to a scan is read
/// again by the next one).
fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for i in 0..250 {
        write(
            r,
            &format!("lib/h{i:03}.ts"),
            &format!("export function h{i:03}(x: number) {{\n  return x + {i};\n}}\n"),
        );
    }
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    std::thread::sleep(std::time::Duration::from_millis(2100));
    drift(r, &["init"]);
    write(r, ".drift/config.yaml", "agents:\n  brief: on\n");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let wrap = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    drift(r, &["review", "--block", &wrap]);
    dir
}

/// Pins the work of every hook event of one session (see the file's comment).
#[test]
fn each_hook_does_the_work_its_answer_needs_and_no_more() {
    let dir = repository();
    let r = dir.path();
    let once = |h: &Ran| {
        assert!(h.work("config_loads") <= 1, "{:#}", h.trace);
        assert!(h.work("policy_loads") <= 1, "{:#}", h.trace);
    };

    // The baseline: one scan of the repository, for everything SessionStart records
    // and the index of the search hints.
    let start = hook(r, "SessionStart", json!({ "source": "startup" }));
    assert_eq!(start.work("full_scans"), 1, "{:#}", start.trace);
    assert_eq!(start.work("file_scans"), 0, "{:#}", start.trace);
    once(&start);

    // Hooks that run before every search, command and prompt: no walk, no scan, no
    // parse.
    for h in [
        hook(r, "UserPromptSubmit", json!({ "prompt": "go" })),
        hook(
            r,
            "PreToolUse",
            json!({ "tool_name": "Grep", "tool_input": { "pattern": "auth", "path": r } }),
        ),
        hook(
            r,
            "PreToolUse",
            json!({ "tool_name": "Bash", "tool_input": { "command": "ls lib" } }),
        ),
    ] {
        for kind in [
            "walks",
            "full_scans",
            "file_scans",
            "parses",
            "source_reads",
        ] {
            assert_eq!(h.work(kind), 0, "{kind}: {:#}", h.trace);
        }
        once(&h);
    }
    // Before a new file is written: its rules from what it declares, read from the
    // content it carries (one parse), nothing else.
    let new_file = hook(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": r.join("lib/new.ts"), "content": "export const n = 1;\n" } }),
    );
    for kind in ["walks", "full_scans", "file_scans", "source_reads"] {
        assert_eq!(new_file.work(kind), 0, "{kind}: {:#}", new_file.trace);
    }
    assert!(new_file.work("parses") <= 1, "{:#}", new_file.trace);
    once(&new_file);

    // Before an edit of an existing file: its rules, from its own facts. One walk (which
    // files exist decides how its imports resolve), no full scan, nothing parsed.
    let pre = hook(r, "PreToolUse", edit(r, "Edit", "app/api/r05/route.ts"));
    assert!(pre.context.contains("withAuth"), "{}", pre.context);
    assert_eq!(pre.path(), "single_file");
    assert_eq!(pre.work("full_scans"), 0, "{:#}", pre.trace);
    assert!(pre.work("file_scans") <= 1, "{:#}", pre.trace);
    assert!(pre.work("walks") <= 1, "{:#}", pre.trace);
    assert_eq!(pre.work("parses"), 0, "{:#}", pre.trace);
    once(&pre);

    // After an edit of a helper: the helper alone is parsed and checked.
    write(
        r,
        "lib/h005.ts",
        "export function h005(x: number) {\n  return x + 50;\n}\n",
    );
    let post = hook(r, "PostToolUse", edit(r, "Edit", "lib/h005.ts"));
    assert_eq!(post.path(), "single_file");
    assert_eq!(post.work("full_scans"), 0, "{:#}", post.trace);
    assert_eq!(post.work("file_scans"), 1, "{:#}", post.trace);
    assert!(post.work("walks") <= 1, "{:#}", post.trace);
    assert_eq!(post.work("parses"), 1, "{:#}", post.trace);
    once(&post);

    // A new route without the guard: its facts are looked up in the whole repository
    // (the practice map, the inventory) and its check needs the repository too (one
    // file's facts do not settle a violation). One full scan serves both.
    write(r, "app/api/fresh/route.ts", UNGUARDED);
    let new_route = hook(r, "PostToolUse", edit(r, "Write", "app/api/fresh/route.ts"));
    assert!(
        new_route.context.contains("app/api/fresh/route.ts"),
        "{}",
        new_route.context
    );
    assert_eq!(new_route.work("full_scans"), 1, "{:#}", new_route.trace);
    assert!(new_route.work("file_scans") <= 1, "{:#}", new_route.trace);
    // Its text is that of the two unguarded routes, so the fact cache
    // (keyed by content) may already hold it: at most one parse.
    assert!(new_route.work("parses") <= 1, "{:#}", new_route.trace);
    once(&new_route);

    // An edit of a route the session started with: the repository at once, once.
    write(
        r,
        "app/api/r06/route.ts",
        &format!("{GUARDED}\nexport const POST = withAuth(async () => Response.json({{}}));\n"),
    );
    let route = hook(r, "PostToolUse", edit(r, "Edit", "app/api/r06/route.ts"));
    assert_eq!(route.path(), "full_scan:entry_points");
    assert_eq!(route.work("full_scans"), 1, "{:#}", route.trace);
    assert_eq!(route.work("file_scans"), 0, "{:#}", route.trace);
    assert_eq!(route.work("parses"), 1, "{:#}", route.trace);
    once(&route);

    // The end of the turn: the new violation blocks, from one scan (and the walk of the
    // stamp that lets a later Stop on the same tree skip it).
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false }));
    assert_eq!(stop.out["decision"], "block", "{:#}", stop.out);
    assert!(
        stop.out["reason"]
            .as_str()
            .is_some_and(|t| t.contains("app/api/fresh/route.ts")),
        "{:#}",
        stop.out
    );
    assert_eq!(stop.work("full_scans"), 1, "{:#}", stop.trace);
    assert!(stop.work("walks") <= 2, "{:#}", stop.trace);
    assert_eq!(stop.work("parses"), 0, "{:#}", stop.trace);
    once(&stop);

    let end = hook(r, "SessionEnd", json!({ "reason": "other" }));
    for kind in ["walks", "full_scans", "file_scans", "parses"] {
        assert_eq!(end.work(kind), 0, "{kind}: {:#}", end.trace);
    }
    once(&end);
}

/// A wall-clock ceiling for every hook of the session above, generous (a debug build on
/// a busy machine), and ignored by default since a stopwatch can flake where counts do
/// not. Run it with
/// `cargo test -p drift-cli --test gap_hooks_speed -- --ignored`.
#[test]
#[ignore]
fn every_hook_answers_well_within_its_timeout() {
    let dir = repository();
    let r = dir.path();
    let ms = |h: &Ran| h.trace["ms"].as_u64().unwrap();
    // The plugin's timeouts are 30 s (SessionStart, Stop), 20 s (PostToolUse) and 5 to
    // 10 s (the rest): each hook gets a quarter of its own.
    assert!(ms(&hook(r, "SessionStart", json!({ "source": "startup" }))) < 7_500);
    assert!(
        ms(&hook(
            r,
            "PreToolUse",
            edit(r, "Edit", "app/api/r05/route.ts")
        )) < 1_250
    );
    write(r, "app/api/fresh/route.ts", UNGUARDED);
    assert!(
        ms(&hook(
            r,
            "PostToolUse",
            edit(r, "Write", "app/api/fresh/route.ts")
        )) < 5_000
    );
    assert!(ms(&hook(r, "Stop", json!({ "stop_hook_active": false }))) < 7_500);
}
