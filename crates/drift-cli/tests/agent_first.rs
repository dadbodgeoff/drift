//! Drift as the first stop for "how is X done here?": the search hint before Grep and
//! Glob, the pre-approved read-only lookups, the card's honest "no answer", and the
//! hook paths that return without loading the project or scanning.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Instant;

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

/// 40 routes (38 guarded) and 30 helpers, with the withAuth convention accepted in block mode.
fn repo() -> tempfile::TempDir {
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
    write(r, "README.md", "# t\n");
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|block| block.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    run(r, &["review", "--block", &id], None);
    dir
}

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

fn grep(pattern: &str, path: Option<&str>) -> Value {
    let mut ti = json!({ "pattern": pattern });
    if let Some(p) = path {
        ti["path"] = json!(p);
    }
    json!({ "tool_name": "Grep", "tool_input": ti })
}

fn glob(pattern: &str) -> Value {
    json!({ "tool_name": "Glob", "tool_input": { "pattern": pattern } })
}

fn context(out: &Option<Value>) -> &str {
    out.as_ref()
        .and_then(|v| v["hookSpecificOutput"]["additionalContext"].as_str())
        .unwrap_or("")
}

#[test]
fn a_convention_hunt_gets_one_line_naming_the_card_a_plain_lookup_gets_none() {
    let dir = repo();
    let r = dir.path();
    hook_as(r, "s1", "SessionStart", json!({ "source": "startup" }));
    assert!(
        r.join(".drift/cache/sessions/agent-hints.idx").is_file(),
        "SessionStart writes the index"
    );

    // A session that has not had the brief (it names app/api/r00/route.ts).
    let hint = hook_as(r, "s0", "PreToolUse", grep("auth", None));
    let line = context(&hint);
    assert!(
        line.starts_with("drift knows this: `drift card app/api/r00/route.ts`"),
        "{line}"
    );
    assert!(
        line.contains("40 http entry point(s) in the repository"),
        "{line}"
    );
    assert_eq!(line.lines().count(), 1, "one line");
    let h = &hint.as_ref().unwrap()["hookSpecificOutput"];
    assert!(h.get("permissionDecision").is_none(), "never blocks: {h}");

    // Once per file per session: a second hunt that lands on the same file is silent.
    assert!(hook_as(r, "s0", "PreToolUse", grep("Depends|middleware", None)).is_none());
    // The brief already named it in s1: silent there too, but a narrower search names
    // the file where it looks.
    assert!(hook_as(r, "s1", "PreToolUse", grep("auth", None)).is_none());
    let narrow = context(&hook_as(
        r,
        "s1",
        "PreToolUse",
        grep("auth", Some("app/api/r05")),
    ))
    .to_string();
    assert!(
        narrow.starts_with("drift knows this: `drift card app/api/r05/route.ts`")
            && narrow.contains("1 http entry point(s) under app/api/r05/"),
        "{narrow}"
    );
    // Another session hears it once too.
    assert!(!context(&hook_as(r, "s2", "PreToolUse", glob("app/api/**/*.ts"))).is_empty());

    // Plain symbol and string lookups, a glob over no entry-point directory, and a hunt
    // where Drift knows no entry points: silent.
    for (n, input) in [
        grep("withAuth", None),
        grep("getUserById\\(", None),
        grep("\"Invalid token\"", None),
        grep("auth", Some("lib")),
        glob("lib/**/*.ts"),
        glob("**/*.ts"),
    ]
    .into_iter()
    .enumerate()
    {
        let out = hook_as(r, &format!("quiet{n}"), "PreToolUse", input.clone());
        assert!(out.is_none(), "{input}: {out:?}");
    }

    // Without the index (no SessionStart yet): silent, never a scan.
    std::fs::remove_file(r.join(".drift/cache/sessions/agent-hints.idx")).unwrap();
    assert!(hook_as(r, "s3", "PreToolUse", grep("auth", None)).is_none());
}

/// p50 under 100 ms for the search hint, process start included (it runs before every
/// Grep and Glob): it reads the index and the session state, nothing else.
#[test]
fn the_search_hint_answers_within_its_latency_budget() {
    let dir = repo();
    let r = dir.path();
    hook_as(r, "s1", "SessionStart", json!({ "source": "startup" }));
    let mut ms: Vec<f64> = Vec::new();
    for i in 0..21 {
        // Alternate a hint (a fresh session each time) and a silent plain lookup.
        let (session, input) = if i % 2 == 0 {
            (format!("lat{i}"), grep("auth", None))
        } else {
            ("lat".to_string(), grep("getUserById", None))
        };
        let t = Instant::now();
        let out = hook_as(r, &session, "PreToolUse", input);
        ms.push(t.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(out.is_some(), i % 2 == 0);
    }
    ms.sort_by(f64::total_cmp);
    let p50 = ms[ms.len() / 2];
    eprintln!(
        "search hint: p50 {p50:.1} ms, max {:.1} ms",
        ms[ms.len() - 1]
    );
    assert!(p50 < 100.0, "p50 {p50:.1} ms: {ms:?}");
}

#[test]
fn read_only_lookups_are_approved_and_nothing_else_is() {
    let dir = repo();
    let r = dir.path();
    let bash = |cmd: &str| {
        hook_as(
            r,
            "s1",
            "PreToolUse",
            json!({ "tool_name": "Bash", "tool_input": { "command": cmd } }),
        )
    };
    let decision = |out: Option<Value>| {
        out.map(|v| v["hookSpecificOutput"]["permissionDecision"].clone())
            .unwrap_or(Value::Null)
    };
    for cmd in [
        "drift card app/api/r00/route.ts",
        "drift map --file lib/auth.ts",
        "drift example app/api/new/route.ts",
        "drift practices --path app/api/r00/route.ts",
        "drift check",
    ] {
        assert_eq!(decision(bash(cmd)), "allow", "{cmd}");
    }
    for cmd in [
        // Read only what `drift practices promote` would do: asked like any command.
        "drift practices promote P-1a2b3c --dry-run",
        "drift practices promote --list",
        "drift card x.ts; rm -rf lib",
        "drift card $(cat x)",
        "drift review --list",
        "drift setup --answer S-1=no --reason r",
        "drift findings --issue F-1",
        "drift export claude-settings",
        "ls",
    ] {
        assert_eq!(decision(bash(cmd)), Value::Null, "{cmd}");
    }
    // Policy is changed by people: each is denied, with that reason.
    for cmd in [
        "drift review --accept D-1",
        "drift review --reject D-x",
        "drift review --show-to-agents D-x",
        "drift setup --forget S-x",
        "DRIFT_SETUP_PERSON=1 drift setup --confirm S-x --by person",
        "drift init",
        "env DRIFT_SETUP_PERSON=1 drift setup --answer S-x=yes",
        "cd lib && drift review --accept D-1",
        "./node_modules/.bin/drift review --block D-1; ls",
        "drift card a.ts | drift init",
        "drift findings --branch F-1",
        "drift export claude-settings --write .claude/settings.json",
        "drift practices promote P-1a2b3c",
        "drift practices promote P-1a2b3c --in app/api --block",
        "drift practices --json promote P-1a2b3c",
    ] {
        let out = bash(cmd).unwrap_or_else(|| panic!("{cmd}: no answer"));
        let hso = &out["hookSpecificOutput"];
        assert_eq!(hso["permissionDecision"], "deny", "{cmd}");
        assert!(
            hso["permissionDecisionReason"]
                .as_str()
                .unwrap()
                .starts_with("Policy is changed by people"),
            "{cmd}: {out}"
        );
    }
    // Also where there is no policy yet: `drift init` is how a repository gets one.
    let bare = tempfile::tempdir().unwrap();
    let out = hook_as(
        bare.path(),
        "s1",
        "PreToolUse",
        json!({ "tool_name": "Bash", "tool_input": { "command": "drift init" } }),
    );
    assert_eq!(decision(out), "deny");
    // Writes under .drift/ are still denied.
    assert_eq!(decision(bash("rm -rf .drift/cache")), "deny");
    let mcp = |t: &str| {
        hook_as(
            r,
            "s1",
            "PreToolUse",
            json!({ "tool_name": t, "tool_input": {} }),
        )
    };
    assert_eq!(decision(mcp("mcp__drift__drift_card")), "allow");
    assert_eq!(decision(mcp("mcp__drift__drift_rules_for")), "allow");
    assert_eq!(decision(mcp("mcp__drift__drift_verify_card")), Value::Null);
    // The setup questions only read; the answer writes `.drift/config.yaml`.
    assert_eq!(decision(mcp("mcp__drift__drift_setup_questions")), "allow");
    assert_eq!(decision(mcp("mcp__drift__drift_setup_answer")), Value::Null);
    // The open list only reads; recording an outcome writes.
    assert_eq!(
        decision(mcp("mcp__drift__drift_investigate_items")),
        "allow"
    );
    assert_eq!(
        decision(mcp("mcp__drift__drift_investigate_record")),
        Value::Null
    );
    assert_eq!(decision(mcp("mcp__other__drift_card")), Value::Null);
}

/// The same entries for `.claude/settings.json`, merged into what is there.
#[test]
fn claude_settings_export_prints_and_merges_the_allow_entries() {
    let dir = repo();
    let r = dir.path();
    let (code, out) = run(r, &["export", "claude-settings"], None);
    assert_eq!(code, 0, "{out}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let allow = v["permissions"]["allow"].as_array().unwrap();
    for e in [
        "Bash(drift card:*)",
        "Bash(drift map:*)",
        "Bash(drift example:*)",
        "Bash(drift practices:*)",
        "Bash(drift check:*)",
        "mcp__drift__drift_card",
        "mcp__drift__drift_explain",
        "mcp__drift__drift_setup_questions",
        "mcp__drift__drift_investigate_items",
    ] {
        assert!(allow.contains(&json!(e)), "{e}");
    }
    // What writes is never pre-approved.
    for e in [
        "mcp__drift__drift_setup_answer",
        "mcp__drift__drift_investigate_record",
        "mcp__drift__drift_verify_card",
    ] {
        assert!(!allow.contains(&json!(e)), "{e}");
    }
    // `Bash(drift practices:*)` covers `drift practices promote`, which writes a
    // convention: that one form is denied by name, and a deny wins over an allow.
    assert_eq!(
        v["permissions"]["deny"],
        json!(["Bash(drift practices promote:*)"]),
        "{v}"
    );
    // Every command an entry names exists in this build, and nothing is asked.
    assert!(v["permissions"].get("ask").is_none(), "{v}");
    for e in allow.iter().filter_map(|e| e.as_str()) {
        if let Some(cmd) = e
            .strip_prefix("Bash(drift ")
            .and_then(|e| e.strip_suffix(":*)"))
        {
            let mut args: Vec<&str> = cmd.split(' ').collect();
            args.push("--help");
            let (code, out) = run(r, &args, None);
            assert_eq!(code, 0, "{e}: {out}");
        }
    }
    let (code, help) = run(r, &["export", "claude-settings", "--help"], None);
    assert_eq!(code, 0, "{help}");
    assert!(!help.contains("promote"), "{help}");
    write(
        r,
        ".claude/settings.json",
        "{\"permissions\": {\"allow\": [\"Bash(npm test:*)\"]}, \"model\": \"m\"}",
    );
    let (code, out) = run(
        r,
        &[
            "export",
            "claude-settings",
            "--write",
            ".claude/settings.json",
        ],
        None,
    );
    assert_eq!(code, 0, "{out}");
    let s: Value =
        serde_json::from_str(&std::fs::read_to_string(r.join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(s["model"], "m");
    assert_eq!(s["permissions"]["allow"][0], "Bash(npm test:*)");
    assert!(
        s["permissions"]["allow"]
            .as_array()
            .unwrap()
            .contains(&json!("Bash(drift card:*)"))
    );
    assert_eq!(
        s["permissions"]["deny"],
        json!(["Bash(drift practices promote:*)"])
    );
    // Not JSON: nothing is written.
    write(r, ".claude/bad.json", "[1]");
    let (code, _) = run(
        r,
        &["export", "claude-settings", "--write", ".claude/bad.json"],
        None,
    );
    assert_ne!(code, 0);
    assert_eq!(
        std::fs::read_to_string(r.join(".claude/bad.json")).unwrap(),
        "[1]"
    );
}

#[test]
fn the_export_block_carries_the_lookup_rule() {
    let dir = repo();
    let (_, md) = run(dir.path(), &["export", "agents-md"], None);
    assert!(
        md.contains("\nBefore searching for how this codebase handles auth, validation, errors, routes or data access, or for its structure (packages, entry points, a file's role), run `drift card <target file>` (or `drift practices --path <file>` when available). Grep only for what it reports as not known. Keep using grep to find where a symbol is called or a string is defined.\n<!-- drift:end -->"),
        "{md}"
    );
}

#[test]
fn the_card_says_when_it_has_no_answer() {
    let dir = repo();
    let r = dir.path();
    let (code, text) = run(r, &["--no-cache", "card", "README.md"], None);
    assert_eq!(code, 0);
    assert!(
        text.starts_with("README.md (root package, not a file Drift parses)\n"),
        "{text}"
    );
    assert!(text.contains("\nNo answer for this file: "), "{text}");
    let last = text.trim_end().lines().last().unwrap();
    assert!(last.starts_with("Not known: "), "{text}");
    // Where it does know something, it says so and no "No answer".
    let (_, text) = run(r, &["--no-cache", "card", "app/api/r39/route.ts"], None);
    assert!(!text.contains("No answer"), "{text}");
    assert!(
        text.trim_end()
            .lines()
            .last()
            .unwrap()
            .starts_with("Not known: "),
        "{text}"
    );
    // A new file with no entry points anywhere near: no answer either.
    let empty = tempfile::tempdir().unwrap();
    write(empty.path(), "src/a.ts", "export const a = 1;\n");
    let (code, text) = run(empty.path(), &["--no-cache", "card", "src/b.ts"], None);
    assert_eq!(code, 0);
    assert!(text.contains("not in the repository yet"), "{text}");
    assert!(text.contains("\nNo answer for this file: "), "{text}");
}

/// Before an edit of an existing file the hook needs neither the policy nor a scan: it
/// answers the same with the policy unreadable. Drift's own files are still denied.
#[test]
fn pre_tool_use_on_an_existing_file_reads_no_policy() {
    let dir = repo();
    let r = dir.path();
    let edit =
        |rel: &str| json!({ "tool_name": "Edit", "tool_input": { "file_path": r.join(rel) } });
    assert!(hook_as(r, "s1", "PreToolUse", edit("lib/h00.ts")).is_none());
    let yaml = r.join(".drift/conventions.yaml");
    let good = std::fs::read_to_string(&yaml).unwrap();
    std::fs::write(&yaml, format!("{good}\nnot: [valid")).unwrap();
    assert!(hook_as(r, "s1", "PreToolUse", edit("lib/h00.ts")).is_none());
    for f in [".drift/conventions.yaml", "drift.lock"] {
        let deny = hook_as(r, "s1", "PreToolUse", edit(f)).unwrap();
        assert_eq!(
            deny["hookSpecificOutput"]["permissionDecision"], "deny",
            "{f}"
        );
    }
    // A new file still loads the project (here: fails open, with a note).
    let new = hook_as(r, "s1", "PreToolUse", edit("app/api/new/route.ts")).unwrap();
    assert!(
        new["systemMessage"]
            .as_str()
            .unwrap()
            .starts_with("drift: hook error"),
        "{new}"
    );
}

/// A Stop on the tree a silent Stop saw says nothing again without a scan; an edit made
/// from the shell (no Edit or Write, so no PostToolUse) changes the tree and still blocks.
#[test]
fn stop_with_no_change_returns_at_once_and_a_shell_edit_is_still_caught() {
    let dir = repo();
    let r = dir.path();
    hook_as(r, "s1", "SessionStart", json!({ "source": "startup" }));
    let stop = || hook_as(r, "s1", "Stop", json!({ "stop_hook_active": false }));
    assert!(stop().is_none());
    let state = || -> Value {
        serde_json::from_str(
            &std::fs::read_to_string(r.join(".drift/cache/sessions/s1.json")).unwrap(),
        )
        .unwrap()
    };
    let stamp = state()["clean_stamp"].clone();
    assert!(stamp.is_string(), "{}", state());
    // Nothing changed: silent again, and the stamp stays.
    assert!(stop().is_none());
    assert_eq!(state()["clean_stamp"], stamp);
    // As `cat > app/api/sh/route.ts` would: a new unguarded route, no PostToolUse.
    write(r, "app/api/sh/route.ts", UNGUARDED);
    let blocked = stop().expect("blocks");
    assert_eq!(blocked["decision"], "block", "{blocked}");
    assert!(
        blocked["reason"]
            .as_str()
            .unwrap()
            .contains("app/api/sh/route.ts"),
        "{blocked}"
    );
    // Fixed, then broken again in place with the same size: a change too.
    write(r, "app/api/sh/route.ts", GUARDED);
    assert!(stop().is_none());
    let fixed = state()["clean_stamp"].clone();
    assert_ne!(fixed, stamp);
    let unguarded_same_len = format!("{:width$}", UNGUARDED, width = GUARDED.len());
    std::fs::write(r.join("app/api/sh/route.ts"), unguarded_same_len).unwrap();
    assert_eq!(stop().expect("blocks")["decision"], "block");
}

/// The session brief (PLAN-R14 C2): packages with their entry points and `drift card` as
/// the first stop, at most 1,200 bytes, before the count line; without a policy too,
/// writing nothing; `agents: {brief: off}` turns it off.
#[test]
fn the_session_brief_with_and_without_a_policy() {
    let dir = repo();
    let r = dir.path();
    let context = |out: Option<Value>| {
        out.and_then(|v| {
            v["hookSpecificOutput"]["additionalContext"]
                .as_str()
                .map(String::from)
        })
        .unwrap_or_default()
    };
    let ctx = context(hook_as(
        r,
        "s1",
        "SessionStart",
        json!({ "source": "startup" }),
    ));
    // One message: the practice map's lines (when it has any), then the structure brief
    // and its first-stop line, then the count line; the two briefs share one cap.
    let lines: Vec<&str> = ctx.lines().collect();
    let at = lines
        .iter()
        .position(|l| l.starts_with("Drift map (facts from this repository, not rules): "))
        .unwrap_or_else(|| panic!("{ctx}"));
    let brief = lines[at];
    assert!(
        brief.contains("entry points by package: (root) 40 (http 40)"),
        "{ctx}"
    );
    assert!(
        lines[..at]
            .first()
            .is_none_or(|l| l.starts_with("drift: practices in ")),
        "{ctx}"
    );
    let ask = lines[at + 1];
    assert!(
        ask.starts_with("Before reading sibling files to learn how a route, handler, job or component is built here, run `drift card <path>`")
            && ask.contains("`drift card app/api/r00/route.ts`"),
        "{ctx}"
    );
    assert!(
        lines[at + 2].starts_with("Drift: 1 of this repo's 1 accepted conventions block"),
        "{ctx}"
    );
    assert!(lines[..at + 2].join("\n").len() <= 1200, "{ctx}");
    // Resumed: the same brief again, from the index.
    let again = context(hook_as(
        r,
        "s1",
        "SessionStart",
        json!({ "source": "resume" }),
    ));
    assert_eq!(again, ctx);
    // Off: the count line only.
    write(r, ".drift/config.yaml", "agents:\n  brief: off\n");
    let off = context(hook_as(
        r,
        "s2",
        "SessionStart",
        json!({ "source": "startup" }),
    ));
    assert!(off.starts_with("Drift: 1 of this repo's"), "{off}");

    // No policy, a git work tree: the brief, and nothing written.
    let bare = tempfile::tempdir().unwrap();
    let b = bare.path();
    std::fs::create_dir_all(b.join(".git")).unwrap();
    for i in 0..3 {
        write(b, &format!("app/api/r{i}/route.ts"), GUARDED);
    }
    write(
        b,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    let out = context(hook_as(
        b,
        "s1",
        "SessionStart",
        json!({ "source": "startup" }),
    ));
    assert!(
        out.starts_with("Drift map (facts from this repository, not rules): "),
        "{out}"
    );
    assert!(out.contains("`drift card app/api/r0/route.ts`"), "{out}");
    assert!(!b.join(".drift").exists(), "nothing written");
    // Not a git work tree: silent.
    let loose = tempfile::tempdir().unwrap();
    write(loose.path(), "app/api/r0/route.ts", GUARDED);
    assert!(hook_as(loose.path(), "s1", "SessionStart", json!({})).is_none());
    assert!(!loose.path().join(".drift").exists());
}

/// Quiet rules (PLAN-R14 C3): a new file that is not a source file hears no rules; the
/// same rules are not said twice; an edit to an existing file says nothing before it.
#[test]
fn quiet_rules_keep_the_hooks_silent_where_they_have_nothing_new() {
    let dir = repo();
    let r = dir.path();
    hook_as(r, "s1", "SessionStart", json!({ "source": "startup" }));
    let write_tool = |rel: &str| json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(rel), "content": UNGUARDED } });
    assert!(hook_as(r, "s1", "PreToolUse", write_tool("app/api/new/notes.md")).is_none());
    assert!(hook_as(r, "s1", "PreToolUse", write_tool("app/api/new/data.json")).is_none());
    let primed = hook_as(r, "s1", "PreToolUse", write_tool("app/api/new/route.ts"));
    assert!(context(&primed).contains("withAuth"), "{primed:?}");
    assert!(hook_as(r, "s1", "PreToolUse", write_tool("app/api/new2/route.ts")).is_none());
    assert!(hook_as(r, "s1", "PreToolUse", write_tool("lib/h00.ts")).is_none());
    // After an edit of a file no parser reads: nothing.
    write(r, "docs/notes.md", "# n\n");
    assert!(
        hook_as(
            r,
            "s1",
            "PostToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": r.join("docs/notes.md") } })
        )
        .is_none()
    );
}
