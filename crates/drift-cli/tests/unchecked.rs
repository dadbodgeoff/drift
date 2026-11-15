//! A file skipped for lack of stack (`stack_unavailable`) is unknown, not absent:
//! under an address-space limit too small to parse it, every command that acts on
//! facts says it was not checked, and none passes it silently, reports a violation
//! because of it, or persists a result that leaves it out.
#![cfg(target_os = "linux")]

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// 3 GB: less than the stack a file of 700 KB needs (2.9 GiB in release builds,
/// 5.6 GiB in debug builds) plus the heap's headroom, whatever the machine's memory.
const LIMIT_KIB: u64 = 3_000_000;

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
const BIG: &str = "app/api/big/route.ts";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `handlers` (an unguarded route's source) followed by 700 KB of comments: no
/// deeper nesting, only length.
fn big(handlers: &str) -> String {
    let mut s = handlers.to_string();
    for i in 0..14_000 {
        s.push_str(&format!(
            "// padding line {i:06} lorem ipsum dolor sit amet\n"
        ));
    }
    s
}

const POST: &str =
    "\nexport async function POST(req: Request) {\n  return Response.json({ ok: false });\n}\n";

/// `drift <args>` in `root`, under `ulimit -v <limit_kib>` (none: no limit), with the
/// cache in the repo: exit code, stdout, stderr.
fn drift(
    root: &Path,
    limit_kib: Option<u64>,
    args: &[&str],
    stdin: Option<&str>,
) -> (i32, String, String) {
    let ulimit = limit_kib.map_or(String::new(), |k| format!("ulimit -v {k} && "));
    let mut child = Command::new("sh")
        .env("DRIFT_TEST_UNSHOWN", "1")
        .arg("-c")
        .arg(format!("{ulimit}exec \"$0\" \"$@\""))
        .arg(&*BIN)
        .args(args)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY")
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
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn limited(root: &Path, args: &[&str]) -> (i32, String, String) {
    drift(root, Some(LIMIT_KIB), args, None)
}

fn unlimited(root: &Path, args: &[&str]) -> (i32, String, String) {
    drift(root, None, args, None)
}

/// The hook's JSON output (`None` when silent); hooks always exit 0.
fn hook(root: &Path, limit_kib: Option<u64>, event: &str, extra: Value) -> Option<Value> {
    hook_as(root, "s1", limit_kib, event, extra)
}

fn hook_as(
    root: &Path,
    session: &str,
    limit_kib: Option<u64>,
    event: &str,
    extra: Value,
) -> Option<Value> {
    let mut input = json!({ "session_id": session, "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (code, out, err) = drift(
        root,
        limit_kib,
        &["hook", "claude", event],
        Some(&input.to_string()),
    );
    assert_eq!(code, 0, "hooks always exit 0: {err}");
    let out = out.trim();
    (!out.is_empty()).then(|| serde_json::from_str(out).expect("hook output is JSON"))
}

fn edit(root: &Path, rel: &str) -> Value {
    json!({ "tool_name": "Write", "tool_input": { "file_path": root.join(rel) } })
}

/// The files of the repo: 40 routes (38 guarded by `withAuth`, 2 legacy unguarded),
/// 30 helpers, and [`BIG`], a 700 KB route with an unguarded `GET`.
fn files(r: &Path) {
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
    write(r, BIG, &big(UNGUARDED));
}

/// [`files`], initialised without a limit, with the `withAuth` convention set to
/// block: the lock baselines the 3 unguarded routes, [`BIG`]'s among them.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    files(r);
    let (code, _, err) = unlimited(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    let (code, _, err) = unlimited(r, &["review", "--block", &id]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join("drift.lock")).unwrap();
    assert!(lock.contains(&format!("{BIG}#GET")), "{lock}");
    dir
}

#[test]
fn check_lists_the_file_it_could_not_read_and_prunes_nothing_for_it() {
    let dir = repo();
    let r = dir.path();
    let (code, out, err) = limited(r, &["--no-cache", "check"]);
    assert_eq!(code, 0, "{out}{err}");
    assert!(
        out.contains("no new violations in the files checked"),
        "{out}"
    );
    assert!(out.contains("1 file(s) NOT CHECKED"), "{out}");
    assert!(out.contains(BIG), "{out}");
    // Its legacy entry is not "fixed": its violations are unknown.
    assert!(!out.contains("lock entries are fixed"), "{out}");

    let (code, out, err) = limited(r, &["--no-cache", "check", "--format", "json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["unchecked"], json!([BIG]));
    assert_eq!(v["fixed"], json!([]));

    let (code, out, _) = limited(r, &["--no-cache", "check", "--format", "github"]);
    assert_eq!(code, 0);
    assert!(
        out.contains(&format!(
            "::warning file={BIG},title=drift%3A not checked::"
        )),
        "{out}"
    );
    assert!(out.contains("1 file(s) not checked"), "{out}");

    let (code, out, _) = limited(r, &["--no-cache", "check", "--format", "sarif"]);
    assert_eq!(code, 0);
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(
        v["runs"][0]["invocations"][0]["toolExecutionNotifications"][0]["locations"][0]["physicalLocation"]
            ["artifactLocation"]["uri"],
        BIG
    );

    // `--strict` fails a check that could not read every file.
    let (code, out, _) = limited(r, &["--no-cache", "check", "--strict"]);
    assert_eq!(code, 1, "{out}");
    assert!(
        out.contains("--strict: files that were not checked fail"),
        "{out}"
    );

    // With room, the file is checked and nothing is said about it.
    let (code, out, _) = unlimited(r, &["--no-cache", "check"]);
    assert_eq!(code, 0);
    assert!(out.contains("no new violations (3 legacy"), "{out}");
    assert!(!out.contains("NOT CHECKED"), "{out}");
}

#[test]
fn init_under_a_limit_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    files(r);
    let (code, out, err) = limited(r, &["--no-cache", "init"]);
    assert_ne!(code, 0, "{out}");
    assert!(err.contains("could not be parsed"), "{err}");
    assert!(err.contains(BIG), "{err}");
    assert!(!r.join(".drift/conventions.yaml").exists());
    assert!(!r.join("drift.lock").exists());

    // Re-running init on an existing policy leaves both files as they are.
    let dir = repo();
    let r = dir.path();
    let before = (
        std::fs::read(r.join(".drift/conventions.yaml")).unwrap(),
        std::fs::read(r.join("drift.lock")).unwrap(),
    );
    let (code, _, err) = limited(r, &["--no-cache", "init"]);
    assert_ne!(code, 0);
    assert!(err.contains("Nothing was written"), "{err}");
    let after = (
        std::fs::read(r.join(".drift/conventions.yaml")).unwrap(),
        std::fs::read(r.join("drift.lock")).unwrap(),
    );
    assert!(before == after, "init changed the policy under a limit");
}

#[test]
fn post_tool_use_says_the_file_was_not_checked() {
    let dir = repo();
    let r = dir.path();
    hook(r, None, "SessionStart", json!({ "source": "startup" }));
    // The agent adds an unguarded handler to the long file: new content, not cached.
    write(r, BIG, &big(&format!("{UNGUARDED}{POST}")));
    let out = hook(r, Some(LIMIT_KIB), "PostToolUse", edit(r, BIG)).expect("not silent");
    let msg = out["systemMessage"].as_str().unwrap();
    assert!(msg.contains(&format!("{BIG} was not checked")), "{out}");
    let ctx = out["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(ctx.contains("was NOT checked"), "{out}");
    assert!(!ctx.contains("new convention violation"), "{out}");
    // With room, the violation is reported.
    let out = hook(r, None, "PostToolUse", edit(r, BIG)).expect("advice");
    let ctx = out["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(ctx.contains("1 new convention violation(s)"), "{out}");
    assert!(ctx.contains("POST"), "{out}");
}

#[test]
fn stop_says_what_it_could_not_check_and_blocks_once_it_can() {
    let dir = repo();
    let r = dir.path();
    hook(r, None, "SessionStart", json!({ "source": "startup" }));
    write(r, BIG, &big(&format!("{UNGUARDED}{POST}")));
    let out = hook(r, Some(LIMIT_KIB), "Stop", json!({})).expect("not silent");
    assert_ne!(out["decision"], "block", "{out}");
    let msg = out["systemMessage"].as_str().unwrap();
    assert!(msg.contains("1 file(s) not checked"), "{out}");
    assert!(msg.contains(BIG), "{out}");
    let out = hook(r, None, "Stop", json!({})).expect("blocks");
    assert_eq!(out["decision"], "block", "{out}");
    assert!(out["reason"].as_str().unwrap().contains("POST"), "{out}");
}

#[test]
fn census_and_security_say_what_they_left_out() {
    let dir = repo();
    let r = dir.path();
    let (code, out, err) = limited(r, &["--no-cache", "census"]);
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("1 file(s) not checked"), "{out}");
    assert!(out.contains("left out of every count"), "{out}");
    let (code, out, err) = limited(r, &["--no-cache", "census", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["unchecked"], json!([BIG]));
    let (_, out, _) = unlimited(r, &["--no-cache", "census", "--json"]);
    let v: Value = serde_json::from_str(&out).unwrap();
    assert!(v.get("unchecked").is_none(), "{v}");

    let (code, out, err) = limited(r, &["--no-cache", "security", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["unchecked"], json!([BIG]));
    let (code, out, _) = limited(r, &["--no-cache", "security"]);
    assert_eq!(code, 0);
    assert!(out.contains("1 file(s) NOT CHECKED"), "{out}");
}

#[test]
fn mcp_tools_say_what_they_could_not_read() {
    let dir = repo();
    let r = dir.path();
    // The server scans with the repo's cache: new content is not in it.
    write(r, BIG, &big(&format!("{UNGUARDED}{POST}")));
    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_check","arguments":{}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":BIG}}}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"drift_security","arguments":{}}}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (code, out, err) = drift(r, Some(LIMIT_KIB), &["mcp"], Some(&input));
    assert_eq!(code, 0, "{err}");
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 3, "{out}");
    let text = |i: usize| {
        replies[i]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let check = text(0);
    assert!(
        check.contains("No new violations in the files checked"),
        "{check}"
    );
    assert!(
        check.contains("NOT CHECKED") && check.contains(BIG),
        "{check}"
    );
    let rules = text(1);
    assert!(rules.contains(&format!("{BIG} was not parsed")), "{rules}");
    assert!(rules.contains("withAuth"), "{rules}");
    assert!(text(2).contains("NOT CHECKED"), "{}", text(2));
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

/// The merge base is scanned with a fresh cache, where the long file cannot be
/// parsed: its violations there are unknown, so a violation in it is judged by the
/// diff's lines (the file is not in the diff), not reported as introduced.
#[test]
fn pr_mode_does_not_blame_the_diff_for_a_file_it_could_not_read_at_the_base() {
    let dir = repo();
    let r = dir.path();
    // On main, after init: an unguarded handler in the long file, not in the lock.
    write(r, BIG, &big(&format!("{UNGUARDED}{POST}")));
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    write(
        r,
        "lib/h00.ts",
        "export function h0() {\n  return 100;\n}\n",
    );
    git(r, &["commit", "-qam", "one line"]);
    // The working tree's facts are cached; the merge base's are not.
    assert_eq!(unlimited(r, &["scan"]).0, 0);
    let (code, out, err) = limited(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["diff"]["base_checked"], true, "{v}");
    assert_eq!(v["diff"]["base_unchecked"], json!([BIG]), "{v}");
    // Not blamed on the diff, and not dropped: unsure.
    let new: Vec<(&Value, &Value)> = v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["baselined"] == false)
        .map(|x| (&x["symbol"], &x["unsure"]))
        .collect();
    assert_eq!(new, [(&json!("POST"), &json!(true))], "{v}");
    let (code, out, _) = limited(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 0, "{out}");
    assert!(
        out.contains("1 file(s) of the merge base not parsed"),
        "{out}"
    );
    // With room at the base too, the same: the violation was there before.
    let (code, out, _) = unlimited(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 0, "{out}");
}

/// [`files`] with routes that import `withAuth` from `lib/guard.ts`, a barrel that
/// re-exports it from `lib/auth.ts` (padded to 700 KB), initialised without a limit
/// and set to block.
fn guard_repo() -> tempfile::TempDir {
    guard_repo_via("@/lib/guard", &[])
}

/// [`guard_repo`] with routes importing `withAuth` from `import`, and `extra` files.
fn guard_repo_via(import: &str, extra: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    files(r);
    std::fs::remove_file(r.join(BIG)).unwrap();
    for (p, body) in extra {
        write(r, p, body);
    }
    let via_guard = GUARDED.replace("@/lib/auth", import);
    for i in 0..38 {
        write(r, &format!("app/api/r{i:02}/route.ts"), &via_guard);
    }
    write(
        r,
        "lib/guard.ts",
        &big("export { withAuth } from \"./auth\";\n"),
    );
    let (code, _, err) = unlimited(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    let (code, _, err) = unlimited(r, &["review", "--block", &id]);
    assert_eq!(code, 0, "{err}");
    dir
}

/// The re-review's repro: the PR replaces the barrel the routes import `withAuth`
/// from with a local no-op, so 38 routes outside the diff break the rule. At a merge
/// base where the barrel cannot be parsed, whether the change caused them is unknown:
/// they are listed as unsure (and fail `--strict`), never dropped.
#[test]
fn pr_mode_lists_what_a_base_it_could_not_read_may_have_hidden() {
    let dir = guard_repo();
    let r = dir.path();
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    write(
        r,
        "lib/guard.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    // A renamed route is judged like the others, not blamed on the rename.
    std::fs::create_dir_all(r.join("app/api/r05b")).unwrap();
    git(r, &["mv", "app/api/r05/route.ts", "app/api/r05b/route.ts"]);
    git(r, &["commit", "-qam", "a local withAuth"]);
    let (code, out, _) = unlimited(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 1, "with room the change is blamed: {out}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let new = |v: &Value, unsure: bool| {
        v["violations"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|x| x["baselined"] == false && (x["unsure"] == true) == unsure)
            .count()
    };
    assert_eq!(new(&v, false), 38, "{v}");

    let (code, out, err) = limited(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["diff"]["base_unchecked"], json!(["lib/guard.ts"]), "{v}");
    assert_eq!(new(&v, false), 0, "{v}");
    assert_eq!(new(&v, true), 38, "{v}");
    assert_eq!(v["diff"]["new_outside_diff"], 0, "{v}");

    let (code, out, _) = limited(r, &["check", "--diff-base", "main", "--strict"]);
    assert_eq!(code, 1, "{out}");
    assert!(
        out.contains("38 violation(s) not counted as new (unsure)"),
        "{out}"
    );

    let summary = r.join("summary.md");
    let out = Command::new("sh")
        .env("DRIFT_TEST_UNSHOWN", "1")
        .arg("-c")
        .arg(format!("ulimit -v {LIMIT_KIB} && exec \"$0\" \"$@\""))
        .arg(&*BIN)
        .args(["check", "--diff-base", "main", "--format", "github"])
        .env_remove("DRIFT_CACHE_DIR")
        .env("GITHUB_STEP_SUMMARY", &summary)
        .current_dir(r)
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{text}");
    assert!(
        text.contains("::warning file=lib/guard.ts,title=drift%3A not checked at the merge base::"),
        "{text}"
    );
    // GitHub keeps about ten notices a step: one with the count, then the first nine.
    assert!(
        text.contains("::notice title=drift%3A unsure violations::38 violation(s)"),
        "{text}"
    );
    assert_eq!(text.matches("(unsure)::").count(), 9, "{text}");
    let md = std::fs::read_to_string(&summary).unwrap();
    assert!(
        md.contains("1 file(s) not checked at the merge base"),
        "{md}"
    );
    assert!(md.contains("38 violation(s) in files that depend"), "{md}");

    let (_, out, _) = limited(r, &["check", "--diff-base", "main", "--format", "sarif"]);
    let v: Value = serde_json::from_str(&out).unwrap();
    let notes = v["runs"][0]["invocations"][0]["toolExecutionNotifications"]
        .as_array()
        .unwrap();
    assert!(
        notes.iter().any(|n| n["message"]["text"]
            .as_str()
            .unwrap()
            .starts_with("Not checked at the merge base")),
        "{v}"
    );
    let text_of = |n: &Value| {
        n["message"]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    };
    assert_eq!(
        notes
            .iter()
            .filter(|n| n["level"] == "note" && text_of(n).starts_with("Unsure ["))
            .count(),
        38,
        "{v}"
    );
    // The moved route serves a new URL (`/api/r05b`) with no guard: the practice
    // facts say so, as a note that never fails the check.
    assert!(
        notes.iter().any(|n| n["level"] == "note"
            && text_of(n).contains("new entry point GET /api/r05b [http]: no guard found")),
        "{v}"
    );
}

/// A Python package re-exports all of a module (`from .core import *`) that cannot be
/// parsed: names imported from the package resolve no further, so the 38 views that
/// use its decorator are unsure, in `check` and in PostToolUse, never new.
#[test]
fn a_python_star_reexport_of_an_unchecked_module_makes_its_users_unsure() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/auth/__init__.py", "from .core import *\n");
    let core = |extra: &str| {
        let mut s =
            String::from("def login_required(f):\n    return f\n\n\ndef helper():\n    return 1\n");
        s.push_str(extra);
        for i in 0..14_000 {
            s.push_str(&format!(
                "# padding line {i:06} lorem ipsum dolor sit amet\n"
            ));
        }
        s
    };
    write(r, "app/auth/core.py", &core(""));
    for i in 0..40 {
        write(r, &format!("app/v{i:02}/__init__.py"), "");
        let body = if i < 38 {
            "from app.auth import login_required\n\n\n@login_required\ndef index(request):\n    return 1\n"
        } else {
            "def index(request):\n    return 1\n"
        };
        write(r, &format!("app/v{i:02}/views.py"), body);
    }
    for i in 0..60 {
        write(r, &format!("app/o{i:02}/__init__.py"), "");
        write(
            r,
            &format!("app/o{i:02}/thing.py"),
            &format!("def thing{i}(x):\n    return x\n"),
        );
    }
    let (code, _, err) = unlimited(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("login_required"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    let (code, _, err) = unlimited(r, &["review", "--block", &id, "--force"]);
    assert_eq!(code, 0, "{err}");

    let (code, out, err) = limited(r, &["--no-cache", "check", "--format", "json"]);
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["unchecked"], json!(["app/auth/core.py"]), "{v}");
    let unsure = v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["unsure"] == true)
        .count();
    let new = v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["baselined"] == false && x["unsure"] != true)
        .count();
    assert_eq!((new, unsure), (0, 38), "{v}");
    assert_eq!(limited(r, &["--no-cache", "check"]).0, 0);

    // A hook: the module behind the package is new content, so not in the cache.
    hook(r, None, "SessionStart", json!({ "source": "startup" }));
    write(r, "app/auth/core.py", &core("\n\nX = 1\n"));
    write(
        r,
        "app/v00/views.py",
        "from app.auth import login_required\n\n\n@login_required\ndef index(request):\n    return 1\n\n\ndef other(request):\n    return 2\n",
    );
    let out = hook(
        r,
        Some(LIMIT_KIB),
        "PostToolUse",
        edit(r, "app/v00/views.py"),
    )
    .expect("advice");
    let ctx = out["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    // Under a heading of their own, not as new violations.
    assert!(ctx.contains("possible violation(s), not certain"), "{ctx}");
    assert!(ctx.contains("app/auth/core.py"), "{ctx}");
    assert!(!ctx.contains("new convention violation"), "{ctx}");
    // Nothing blocks on what it could not tell.
    let out = hook(r, Some(LIMIT_KIB), "Stop", json!({}));
    assert!(
        out.as_ref().is_none_or(|o| o["decision"] != "block"),
        "{out:?}"
    );
}

/// The baseline is the content at SessionStart, not HEAD: an agent that edits the
/// unchecked file and commits does not get its violation folded into the baseline.
#[test]
fn a_commit_does_not_fold_the_agents_violation_into_the_baseline() {
    let dir = repo();
    let r = dir.path();
    // New content (not in the cache), committed before the session.
    write(r, BIG, &big(&format!("{UNGUARDED}// before the session\n")));
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "start"]);
    hook(
        r,
        Some(LIMIT_KIB),
        "SessionStart",
        json!({ "source": "startup" }),
    )
    .expect("a note");
    // The agent adds an unguarded handler to the file it could not read, and commits.
    write(
        r,
        BIG,
        &big(&format!("{UNGUARDED}{POST}// before the session\n")),
    );
    git(r, &["commit", "-qam", "agent"]);
    let out = hook(r, None, "Stop", json!({})).expect("blocks");
    assert_eq!(out["decision"], "block", "{out}");
    assert!(out["reason"].as_str().unwrap().contains("POST"), "{out}");
}

/// Unsure violations are not baselined at SessionStart: the content-hash rule decides
/// them. An agent that strips the guard from a route depending on the barrel that
/// could not be read, or edits the barrel itself, and commits, is blocked once Stop
/// can read them.
#[test]
fn a_dependents_violation_from_the_agents_edit_is_not_baselined() {
    for edit_barrel in [false, true] {
        let dir = guard_repo();
        let r = dir.path();
        // New barrel content (not in the cache), committed before the session.
        write(
            r,
            "lib/guard.ts",
            &big("export { withAuth } from \"./auth\";\n// before the session\n"),
        );
        git(r, &["init", "-q"]);
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", "start"]);
        hook(
            r,
            Some(LIMIT_KIB),
            "SessionStart",
            json!({ "source": "startup" }),
        )
        .expect("a note");
        if edit_barrel {
            write(
                r,
                "lib/guard.ts",
                "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
            );
        } else {
            write(r, "app/api/r05/route.ts", UNGUARDED);
        }
        git(r, &["commit", "-qam", "agent"]);
        let out = hook(r, None, "Stop", json!({})).expect("blocks");
        assert_eq!(out["decision"], "block", "{edit_barrel}: {out}");
        let reason = out["reason"].as_str().unwrap();
        if edit_barrel {
            assert!(
                reason.contains("38 new convention violation(s)"),
                "{reason}"
            );
        } else {
            assert!(reason.contains("1 new convention violation(s)"), "{reason}");
            assert!(reason.contains("app/api/r05/route.ts"), "{reason}");
        }
    }
}

/// Under a limit, single-file scans (PostToolUse) still give a full scan's facts, and
/// fall back to one only when a barrel or a client file needs it: an unparsed file
/// elsewhere does not make every edit scan the repo.
#[test]
fn single_file_scans_under_a_limit_match_full_scans_without_falling_back() {
    let dir = repo();
    let r = dir.path();
    write(r, BIG, &big(&format!("{UNGUARDED}// new content\n")));
    let (code, out, err) = drift(r, Some(LIMIT_KIB), &["debug", "incremental"], None);
    assert_eq!(code, 0, "{out}{err}");
    assert!(
        out.contains("(0 fall back to a full scan), 0 mismatches"),
        "{out}"
    );
}

/// A route that reads `withAuth` through the barrel but does not wrap its handler.
const STRIPPED: &str = "import { withAuth } from \"@/lib/guard\";\n\nexport async function GET(req: Request) {\n  return Response.json({ ok: withAuth });\n}\n";

/// [`guard_repo`] committed with new barrel content (not cached) and, when
/// `stripped`, `app/api/r05/route.ts` already not wrapping its handler: a violation
/// that is unsure under the limit, since the route reads the unparsed barrel.
fn guard_git_repo(stripped: bool) -> tempfile::TempDir {
    let dir = guard_repo();
    let r = dir.path();
    write(
        r,
        "lib/guard.ts",
        &big("export { withAuth } from \"./auth\";\n// before the session\n"),
    );
    if stripped {
        write(r, "app/api/r05/route.ts", STRIPPED);
    }
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "start"]);
    dir
}

/// A violation that is unsure at SessionStart is never baselined: whether it was
/// there cannot be told. Once a Stop can tell it, it blocks once (saying it was
/// unsure at the start), and the loop guard steps aside when it stays.
#[test]
fn an_unsure_violation_at_the_start_blocks_once_then_steps_aside() {
    let dir = guard_git_repo(true);
    let r = dir.path();
    let out = hook(
        r,
        Some(LIMIT_KIB),
        "SessionStart",
        json!({ "source": "startup" }),
    )
    .expect("a note");
    assert!(
        out["systemMessage"]
            .as_str()
            .unwrap()
            .contains("1 file(s) not checked"),
        "{out}"
    );
    let out = hook(r, None, "Stop", json!({})).expect("blocks");
    assert_eq!(out["decision"], "block", "{out}");
    assert!(
        out["reason"]
            .as_str()
            .unwrap()
            .contains("app/api/r05/route.ts"),
        "{out}"
    );
    assert!(
        out["systemMessage"]
            .as_str()
            .unwrap()
            .contains("1 of these were unsure at session start"),
        "{out}"
    );
    // After one block it is advice: it does not keep the turn from ending.
    let out = hook(r, None, "Stop", json!({})).expect("advice");
    assert_ne!(out["decision"], "block", "{out}");
    assert!(
        out["systemMessage"]
            .as_str()
            .unwrap()
            .contains("were unsure at session start are still there"),
        "{out}"
    );
}

/// An unsure-at-start violation that has blocked once no longer counts toward the
/// loop guard: the agent's own new violations keep blocking (the sixth re-review's
/// repro, where the guard's 3-block budget ran out on it).
#[test]
fn an_unsure_violation_does_not_use_up_the_loop_guard() {
    let dir = guard_git_repo(true);
    let r = dir.path();
    hook(
        r,
        Some(LIMIT_KIB),
        "SessionStart",
        json!({ "source": "startup" }),
    );
    let stop = || hook(r, None, "Stop", json!({}));
    let reason = |o: &Value| o["reason"].as_str().unwrap_or_default().to_string();
    let out = stop().expect("blocks on r05");
    assert_eq!(out["decision"], "block", "{out}");
    assert_ne!(stop().unwrap()["decision"], "block");
    // r05, n1 and n2 make the three blocks the guard allows.
    for (i, n) in ["n1", "n2"].iter().enumerate() {
        let rel = format!("app/api/{n}/route.ts");
        write(r, &rel, UNGUARDED);
        let out = stop().expect("blocks");
        assert_eq!(out["decision"], "block", "{n}: {out}");
        assert!(reason(&out).contains(&rel), "{n}: {out}");
        assert!(!reason(&out).contains("app/api/r05/route.ts"), "{n}: {out}");
        std::fs::remove_dir_all(r.join(format!("app/api/{n}"))).unwrap();
        let out = stop();
        assert!(
            out.as_ref().is_none_or(|o| o["decision"] != "block"),
            "{i}: {out:?}"
        );
    }
}

/// A baseline rebuilt by `resume`, `compact` or a `clear` with no handoff takes no
/// violation of a language with any file changed since HEAD: uncommitted edits to a
/// barrel, behind it, or to a config a tsconfig `extends`, all block.
#[test]
fn a_rebuilt_baseline_takes_nothing_of_a_language_with_changed_files() {
    type Files = &'static [(&'static str, &'static str)];
    let cases: [(&str, &str, Files); 4] = [
        ("resume", "@/lib/a", &[("lib/a.ts", AUTH_NOOP)]),
        (
            "compact",
            "@/lib/guard",
            &[("lib/auth.ts", "export { withAuth } from \"./noop\";\n")],
        ),
        ("clear", "@/lib/a", &[("lib/a.ts", AUTH_NOOP)]),
        (
            "resume",
            "@/lib/guard",
            &[(
                "config/base.json",
                "{ \"compilerOptions\": { \"baseUrl\": \"..\", \"paths\": { \"@/lib/guard\": [\"./lib/noop.ts\"], \"@/*\": [\"./*\"] } } }",
            )],
        ),
    ];
    for (source, import, edit) in cases {
        let named = [("lib/a.ts", "export { withAuth } from \"./guard\";\n")];
        let extends = [
            ("lib/noop.ts", AUTH_NOOP),
            ("tsconfig.json", "{ \"extends\": \"./config/base.json\" }"),
            (
                "config/base.json",
                "{ \"compilerOptions\": { \"baseUrl\": \"..\", \"paths\": { \"@/*\": [\"./*\"] } } }",
            ),
            ("lib/noop.ts", AUTH_NOOP),
        ];
        let extra: &[(&str, &str)] = if import == "@/lib/a" {
            &named
        } else if edit[0].0 == "config/base.json" {
            &extends
        } else {
            &[("lib/noop.ts", AUTH_NOOP)]
        };
        let dir = guard_repo_via(import, extra);
        let r = dir.path();
        git(r, &["init", "-q"]);
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", "start"]);
        assert!(
            unlimited(r, &["check"]).1.contains("no new violations"),
            "{source}"
        );
        for (p, body) in edit {
            write(r, p, body);
        }
        let out = hook(r, None, "SessionStart", json!({ "source": source })).unwrap();
        let msg = out["systemMessage"].as_str().unwrap();
        assert!(msg.contains("state was missing"), "{source}: {out}");
        assert!(
            msg.contains("none of them JavaScript/TypeScript"),
            "{source}: {out}"
        );
        let out = hook(r, None, "Stop", json!({})).expect("blocks");
        assert_eq!(out["decision"], "block", "{source} {edit:?}: {out}");
        assert!(
            out["reason"]
                .as_str()
                .unwrap()
                .contains("38 new convention violation(s)"),
            "{source} {edit:?}: {out}"
        );
    }
}

/// `/clear` hands the record of unsure violations on: after the clear they still
/// count, and Stop says they were unsure at the start.
#[test]
fn clear_hands_on_what_was_unsure() {
    let dir = guard_git_repo(true);
    let r = dir.path();
    hook_as(
        r,
        "s1",
        Some(LIMIT_KIB),
        "SessionStart",
        json!({ "source": "startup" }),
    );
    hook_as(r, "s1", None, "SessionEnd", json!({ "reason": "clear" }));
    hook_as(r, "s2", None, "SessionStart", json!({ "source": "clear" }));
    let out = hook_as(r, "s2", None, "Stop", json!({})).expect("blocks");
    assert_eq!(out["decision"], "block", "{out}");
    assert!(
        out["systemMessage"]
            .as_str()
            .unwrap()
            .contains("unsure at session start"),
        "{out}"
    );
}

/// A baseline rebuilt mid-session (no state at Stop, or `resume`/`compact` without
/// state) under the limit never folds in what reads files changed since HEAD: the
/// agent stripped the guard from a route (uncommitted), and Stop with room blocks.
#[test]
fn a_rebuilt_baseline_does_not_fold_the_agents_uncommitted_edit() {
    for resume in [false, true] {
        let dir = guard_git_repo(false);
        let r = dir.path();
        write(r, "app/api/r05/route.ts", STRIPPED);
        let out = if resume {
            hook(
                r,
                Some(LIMIT_KIB),
                "SessionStart",
                json!({ "source": "resume" }),
            )
        } else {
            hook(r, Some(LIMIT_KIB), "Stop", json!({}))
        };
        let out = out.expect("a note");
        assert_ne!(out["decision"], "block", "{resume}: {out}");
        assert!(
            out["systemMessage"]
                .as_str()
                .unwrap()
                .contains("state was missing"),
            "{resume}: {out}"
        );
        let out = hook(r, None, "Stop", json!({})).expect("blocks");
        assert_eq!(out["decision"], "block", "{resume}: {out}");
        assert!(
            out["reason"]
                .as_str()
                .unwrap()
                .contains("app/api/r05/route.ts"),
            "{resume}: {out}"
        );
    }
}

/// The routes read `withAuth` from `lib/index.ts`, an `export *` of the unparsed
/// `lib/big.ts`. The agent replaces the intermediate barrel with a local no-op and
/// commits: 38 new violations, none of them folded in (the barrel changed).
#[test]
fn an_edited_intermediate_barrel_is_not_folded_into_the_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    files(r);
    std::fs::remove_file(r.join(BIG)).unwrap();
    let via_index = GUARDED.replace("@/lib/auth", "@/lib/index");
    for i in 0..38 {
        write(r, &format!("app/api/r{i:02}/route.ts"), &via_index);
    }
    let auth = "export function withAuth<T>(h: T): T {\n  return h;\n}\n";
    write(r, "lib/index.ts", "export * from \"./big\";\n");
    write(r, "lib/big.ts", &big(auth));
    let (code, _, err) = unlimited(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    assert_eq!(unlimited(r, &["review", "--block", &id]).0, 0);
    write(
        r,
        "lib/big.ts",
        &big(&format!("{auth}// before the session\n")),
    );
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "start"]);
    hook(
        r,
        Some(LIMIT_KIB),
        "SessionStart",
        json!({ "source": "startup" }),
    )
    .expect("a note");
    write(r, "lib/index.ts", auth);
    git(r, &["commit", "-qam", "agent"]);
    let out = hook(r, None, "Stop", json!({})).expect("blocks");
    assert_eq!(out["decision"], "block", "{out}");
    assert!(
        out["reason"]
            .as_str()
            .unwrap()
            .contains("38 new convention violation(s)"),
        "{out}"
    );
}

/// The Python shape: views import `login_required` from `app/api.py`, which star-
/// imports `app.auth`, which star-imports the unparsed `app/auth/core.py`. The agent
/// replaces `app/api.py` with a local no-op and commits: nothing is folded in.
#[test]
fn an_edited_python_star_module_is_not_folded_into_the_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/auth/__init__.py", "from .core import *\n");
    write(r, "app/api.py", "from app.auth import *\n");
    let core = |extra: &str| {
        let mut s = String::from("def login_required(f):\n    return f\n");
        s.push_str(extra);
        for i in 0..14_000 {
            s.push_str(&format!(
                "# padding line {i:06} lorem ipsum dolor sit amet\n"
            ));
        }
        s
    };
    write(r, "app/auth/core.py", &core(""));
    for i in 0..40 {
        write(r, &format!("app/v{i:02}/__init__.py"), "");
        let body = if i < 38 {
            "from app.api import login_required\n\n\n@login_required\ndef index(request):\n    return 1\n"
        } else {
            "def index(request):\n    return 1\n"
        };
        write(r, &format!("app/v{i:02}/views.py"), body);
    }
    for i in 0..60 {
        write(r, &format!("app/o{i:02}/__init__.py"), "");
        write(
            r,
            &format!("app/o{i:02}/thing.py"),
            &format!("def thing{i}(x):\n    return x\n"),
        );
    }
    assert_eq!(unlimited(r, &["init"]).0, 0);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("login_required"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    assert_eq!(unlimited(r, &["review", "--block", &id, "--force"]).0, 0);
    write(r, "app/auth/core.py", &core("\n# before the session\n"));
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "start"]);
    hook(
        r,
        Some(LIMIT_KIB),
        "SessionStart",
        json!({ "source": "startup" }),
    )
    .expect("a note");
    write(r, "app/api.py", "def login_required(f):\n    return f\n");
    git(r, &["commit", "-qam", "agent"]);
    let out = hook(r, None, "Stop", json!({})).expect("blocks");
    assert_eq!(out["decision"], "block", "{out}");
    assert!(
        out["reason"]
            .as_str()
            .unwrap()
            .contains("38 new convention violation(s)"),
        "{out}"
    );
}

const AUTH_NOOP: &str = "export function withAuth<T>(h: T): T {\n  return h;\n}\n";

/// The fifth re-review's repros: after a SessionStart under the limit, the agent
/// changes what the routes' `withAuth` resolves to without touching the routes or
/// the unparsed barrel, and commits. Every route then violates, and Stop blocks.
#[test]
fn edits_that_change_resolution_behind_an_unparsed_barrel_block() {
    let workspace_pkg =
        "{ \"name\": \"@acme/auth\", \"exports\": { \"./guard\": \"./src/guard.ts\" } }";
    type Edit = &'static [(&'static str, &'static str)];
    type Case = (
        &'static str,
        &'static str,
        Vec<(&'static str, String)>,
        Edit,
    );
    let cases: [Case; 4] = [
        // tsconfig `paths` maps the barrel's specifier to a no-op.
        (
            "tsconfig",
            "@/lib/guard",
            vec![],
            &[
                ("lib/noop.ts", AUTH_NOOP),
                (
                    "tsconfig.json",
                    "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/lib/guard\": [\"./lib/noop.ts\"], \"@/*\": [\"./*\"] } } }",
                ),
            ],
        ),
        // The file behind the unparsed barrel now re-exports a no-op.
        (
            "behind",
            "@/lib/guard",
            vec![],
            &[
                ("lib/noop.ts", AUTH_NOOP),
                ("lib/auth.ts", "export { withAuth } from \"./noop\";\n"),
            ],
        ),
        // A named re-export barrel between the routes and the unparsed one.
        (
            "named barrel",
            "@/lib/a",
            vec![(
                "lib/a.ts",
                "export { withAuth } from \"./guard\";\n".to_string(),
            )],
            &[("lib/a.ts", AUTH_NOOP)],
        ),
        // A workspace package's `exports` maps the specifier to a no-op.
        (
            "package exports",
            "@acme/auth/guard",
            vec![
                (
                    "package.json",
                    "{ \"name\": \"t\", \"workspaces\": [\"packages/*\"] }".to_string(),
                ),
                ("packages/auth/package.json", workspace_pkg.to_string()),
                ("packages/auth/src/auth.ts", AUTH_NOOP.to_string()),
                (
                    "packages/auth/src/guard.ts",
                    big("export { withAuth } from \"./auth\";\n"),
                ),
            ],
            &[
                ("packages/auth/src/noop.ts", AUTH_NOOP),
                (
                    "packages/auth/package.json",
                    "{ \"name\": \"@acme/auth\", \"exports\": { \"./guard\": \"./src/noop.ts\" } }",
                ),
            ],
        ),
    ];
    for (name, import, extra, edit) in cases {
        let extra: Vec<(&str, &str)> = extra.iter().map(|(p, b)| (*p, b.as_str())).collect();
        let dir = guard_repo_via(import, &extra);
        let r = dir.path();
        if name == "package exports" {
            std::fs::create_dir_all(r.join("node_modules/@acme")).unwrap();
            std::os::unix::fs::symlink("../../packages/auth", r.join("node_modules/@acme/auth"))
                .unwrap();
        }
        // New content for the unparsed barrel, committed before the session.
        let barrel = if name == "package exports" {
            "packages/auth/src/guard.ts"
        } else {
            "lib/guard.ts"
        };
        write(
            r,
            barrel,
            &big("export { withAuth } from \"./auth\";\n// before the session\n"),
        );
        git(r, &["init", "-q"]);
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", "start"]);
        hook(
            r,
            Some(LIMIT_KIB),
            "SessionStart",
            json!({ "source": "startup" }),
        );
        // Nothing certain yet: the routes read the barrel that could not be parsed.
        let (_, out, _) = unlimited(r, &["check"]);
        assert!(out.contains("no new violations"), "{name}: {out}");
        for (p, body) in edit {
            write(r, p, body);
        }
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", "agent"]);
        let out = hook(r, None, "Stop", json!({})).unwrap_or_else(|| panic!("{name}: silent"));
        assert_eq!(out["decision"], "block", "{name}: {out}");
        assert!(
            out["reason"]
                .as_str()
                .unwrap()
                .contains("38 new convention violation(s)"),
            "{name}: {out}"
        );
    }
}

/// A rebuilt baseline (no state at Stop, or `resume` without state) takes no JS/TS
/// violation when a tsconfig changed since HEAD: the agent's `paths` edit makes every
/// route violate without touching one.
#[test]
fn a_rebuilt_baseline_takes_nothing_of_a_language_whose_resolution_changed() {
    for resume in [false, true] {
        let dir = guard_repo_via("@/lib/guard", &[]);
        let r = dir.path();
        git(r, &["init", "-q"]);
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", "start"]);
        write(r, "lib/noop.ts", AUTH_NOOP);
        write(
            r,
            "tsconfig.json",
            "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/lib/guard\": [\"./lib/noop.ts\"], \"@/*\": [\"./*\"] } } }",
        );
        if resume {
            let out = hook(r, None, "SessionStart", json!({ "source": "resume" })).unwrap();
            assert!(
                out["systemMessage"]
                    .as_str()
                    .unwrap()
                    .contains("state was missing"),
                "{out}"
            );
        }
        let out = hook(r, None, "Stop", json!({})).expect("blocks");
        assert_eq!(out["decision"], "block", "{resume}: {out}");
        assert!(
            out["reason"]
                .as_str()
                .unwrap()
                .contains("38 new convention violation(s)"),
            "{resume}: {out}"
        );
    }
}

/// Python: a star chain behind the unparsed module. `core.py` (700 KB) star-imports
/// `app.impl`; the agent points `app.impl` at a no-op and commits. Stop blocks.
#[test]
fn a_python_edit_behind_the_unparsed_module_blocks() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"acme\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/auth/__init__.py", "from .core import *\n");
    write(r, "app/api.py", "from app.auth import *\n");
    write(r, "app/impl/__init__.py", "from .decorators import *\n");
    write(
        r,
        "app/impl/decorators.py",
        "def login_required(f):\n    return f\n",
    );
    let core = |extra: &str| {
        let mut s = format!("from app.impl import *\n{extra}");
        for i in 0..14_000 {
            s.push_str(&format!(
                "# padding line {i:06} lorem ipsum dolor sit amet\n"
            ));
        }
        s
    };
    write(r, "app/auth/core.py", &core(""));
    for i in 0..40 {
        write(r, &format!("app/v{i:02}/__init__.py"), "");
        let body = if i < 38 {
            "from app.api import login_required\n\n\n@login_required\ndef index(request):\n    return 1\n"
        } else {
            "def index(request):\n    return 1\n"
        };
        write(r, &format!("app/v{i:02}/views.py"), body);
    }
    for i in 0..60 {
        write(r, &format!("app/o{i:02}/__init__.py"), "");
        write(
            r,
            &format!("app/o{i:02}/thing.py"),
            &format!("def thing{i}(x):\n    return x\n"),
        );
    }
    assert_eq!(unlimited(r, &["init"]).0, 0);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("login_required"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("{yaml}"));
    assert_eq!(unlimited(r, &["review", "--block", &id, "--force"]).0, 0);
    write(r, "app/auth/core.py", &core("# before the session\n"));
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "start"]);
    hook(
        r,
        Some(LIMIT_KIB),
        "SessionStart",
        json!({ "source": "startup" }),
    )
    .expect("a note");
    write(
        r,
        "app/impl/noop.py",
        "def login_required(f):\n    return f\n",
    );
    write(r, "app/impl/__init__.py", "from .noop import *\n");
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "agent"]);
    let out = hook(r, None, "Stop", json!({})).expect("blocks");
    assert_eq!(out["decision"], "block", "{out}");
    assert!(
        out["reason"]
            .as_str()
            .unwrap()
            .contains("38 new convention violation(s)"),
        "{out}"
    );
}

/// Block-once is tied to the violation's file as it was when it blocked: reintroduced
/// under the same key by a new edit, a violation blocks again. R: a tsconfig remap
/// blocks the 38 routes, it is reverted (clean), then r05 is stripped. P: the revert
/// and the strip in one turn. U: the unparsed barrel is replaced with a no-op (38
/// block), then restored while r05 is stripped.
#[test]
fn a_violation_reintroduced_after_its_one_block_blocks_again() {
    for case in ["R", "P", "U"] {
        let dir = guard_git_repo(false);
        let r = dir.path();
        hook(
            r,
            Some(LIMIT_KIB),
            "SessionStart",
            json!({ "source": "startup" }),
        );
        let tsconfig = std::fs::read_to_string(r.join("tsconfig.json")).unwrap();
        let barrel = std::fs::read_to_string(r.join("lib/guard.ts")).unwrap();
        if case == "U" {
            write(r, "lib/guard.ts", AUTH_NOOP);
        } else {
            write(r, "lib/noop.ts", AUTH_NOOP);
            write(
                r,
                "tsconfig.json",
                "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/lib/guard\": [\"./lib/noop.ts\"], \"@/*\": [\"./*\"] } } }",
            );
        }
        let out = hook(r, None, "Stop", json!({})).expect("blocks");
        assert_eq!(out["decision"], "block", "{case}: {out}");
        assert!(
            out["reason"]
                .as_str()
                .unwrap()
                .contains("38 new convention violation(s)"),
            "{case}: {out}"
        );
        if case == "U" {
            write(r, "lib/guard.ts", &barrel);
        } else {
            write(r, "tsconfig.json", &tsconfig);
        }
        if case == "R" {
            assert!(hook(r, None, "Stop", json!({})).is_none(), "{case}: clean");
        }
        write(r, "app/api/r05/route.ts", STRIPPED);
        let out = hook(r, None, "Stop", json!({})).expect("blocks");
        assert_eq!(out["decision"], "block", "{case}: {out}");
        let reason = out["reason"].as_str().unwrap();
        assert!(
            reason.contains("1 new convention violation(s)"),
            "{case}: {reason}"
        );
        assert!(reason.contains("app/api/r05/route.ts"), "{case}: {reason}");
    }
}
