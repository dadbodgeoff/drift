//! F2 (review R2 of S7 and S8): a baselined violation is taken to have moved only where
//! Drift read both ends, and only one to one.
//!
//! - A hook's check of one file knows only that file's units, so every baselined member
//!   elsewhere looked gone, and a new violation that read like any of them was absorbed
//!   as moved debt: the agent was never told of it.
//! - On a full check, two deleted violators and one new one that reads the same, or a
//!   fingerprint line whose member line a person removed, absorbed the new violation.
//! - The lock writes its fingerprint lines as comments (`#~ <id> <hex> <member>`), which
//!   an older Drift skips; it read the earlier form as a second, never-current entry.

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

fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (Option<i32>, String) {
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
        out.status.code(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
    )
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out) = run(root, args, None);
    assert_eq!(code, Some(0), "{args:?} failed: {out}");
    out
}

fn hook(root: &Path, event: &str, extra: Value) -> Option<Value> {
    let mut input = json!({ "session_id": "f2", "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (code, out) = run(root, &["hook", "claude", event], Some(&input.to_string()));
    assert_eq!(code, Some(0), "hooks always exit 0");
    let out = out.trim();
    (!out.is_empty()).then(|| serde_json::from_str(out).expect("hook output is JSON"))
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// Routes wrapped in `withAuth` but three identical ones (`r37`..`r39`, baselined by the
/// first `init`), that convention accepted in block mode. Returns its id.
fn blocking_repo() -> (tempfile::TempDir, String) {
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
        let body = if i < 37 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/r{i:02}/route.ts"), body);
    }
    for i in 0..30 {
        let body = format!("export function h{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/h{i:02}.ts"), &body);
    }
    drift(r, &["init"]);
    let census: Value = serde_json::from_str(&drift(r, &["census", "--json"])).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["summary"].as_str().unwrap().contains("withAuth"))
        .expect("withAuth convention")["id"]
        .as_str()
        .unwrap()
        .to_string();
    drift(r, &["review", "--block", &id]);
    (dir, id)
}

fn lock(r: &Path) -> String {
    std::fs::read_to_string(r.join("drift.lock")).unwrap()
}

/// `baselined` of each violation of `id` at `path`, from `drift check --format json`.
fn baselined_at(r: &Path, id: &str, path: &str) -> Vec<bool> {
    let (_, json) = run(r, &["check", "--format", "json"], None);
    let report: Value = serde_json::from_str(&json).unwrap();
    report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["id"] == id && v["path"] == path)
        .map(|v| v["baselined"].as_bool().unwrap())
        .collect()
}

/// Pins: a new violation written by an agent is told to it after the edit, although it
/// reads like baselined members in other files (before: the one-file check took those
/// members for gone and the new violation for one of them, moved, so nothing was said).
#[test]
fn a_one_file_check_takes_no_member_elsewhere_for_moved() {
    let (dir, _) = blocking_repo();
    let r = dir.path();
    hook(r, "SessionStart", json!({ "source": "startup" })).unwrap();
    write(r, "app/api/new/route.ts", UNGUARDED);
    let edit = json!({ "tool_name": "Write", "tool_input": { "file_path": r.join("app/api/new/route.ts") } });
    let out = hook(r, "PostToolUse", edit);
    assert!(out.is_some(), "the new violation is advised");
    assert!(
        out.unwrap().to_string().contains("app/api/new/route.ts"),
        "it names the new file"
    );
}

/// Pins: two baselined violators deleted and one new one that reads the same is not a
/// move (which of the two moved cannot be told): it is new (before: baselined).
#[test]
fn two_deleted_and_one_new_is_not_a_move() {
    let (dir, id) = blocking_repo();
    let r = dir.path();
    for i in [38, 39] {
        std::fs::remove_dir_all(r.join(format!("app/api/r{i}"))).unwrap();
    }
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert_eq!(baselined_at(r, &id, "app/api/new/route.ts"), [false]);
    let (code, out) = run(r, &["check"], None);
    assert_eq!(code, Some(1), "{out}");
}

/// Pins: a fingerprint line left behind when a person removed its member line
/// baselines nothing (before: once the member was gone, it absorbed the next new
/// violation that read the same).
#[test]
fn a_fingerprint_line_without_its_member_line_baselines_nothing() {
    let (dir, id) = blocking_repo();
    let r = dir.path();
    let member = format!("{id} app/api/r39/route.ts#GET");
    let text = lock(r);
    assert!(text.lines().any(|l| l == member), "{text}");
    let kept: String = text
        .lines()
        .filter(|l| *l != member)
        .map(|l| format!("{l}\n"))
        .collect();
    assert!(kept.contains(" app/api/r39/route.ts#GET"), "the #~ line stays: {kept}");
    std::fs::write(r.join("drift.lock"), kept).unwrap();
    std::fs::remove_dir_all(r.join("app/api/r39")).unwrap();
    write(r, "app/api/new/route.ts", UNGUARDED);
    assert_eq!(baselined_at(r, &id, "app/api/new/route.ts"), [false]);
}

/// Pins: a fingerprint line is a `#~` comment right below its member line, so a Drift
/// that skips comments reads one entry per violation (before: `<id> ~<hex> <member>`,
/// which an older Drift read as a second entry and listed as fixed).
#[test]
fn the_fingerprint_line_is_a_comment_below_its_member() {
    let (dir, id) = blocking_repo();
    let r = dir.path();
    let text = lock(r);
    let lines: Vec<&str> = text.lines().collect();
    let at = lines
        .iter()
        .position(|l| *l == format!("{id} app/api/r38/route.ts#GET"))
        .unwrap_or_else(|| panic!("{text}"));
    let next = lines[at + 1];
    assert!(
        next.starts_with(&format!("#~ {id} ")) && next.ends_with(" app/api/r38/route.ts#GET"),
        "{text}"
    );
    // As an older Drift reads it: every non-comment line is an entry, one per violation.
    let entries = lines
        .iter()
        .filter(|l| !l.trim_start().starts_with('#') && l.starts_with(&format!("{id} ")))
        .count();
    assert_eq!(entries, 3, "{text}");
    assert!(!text.lines().any(|l| l.contains(" ~")), "{text}");
}
