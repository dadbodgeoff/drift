//! The experimental agent verifier (`agents.verify: on`, `drift_verify_card`) end to end:
//! the MCP payload, the host agent's verdicts, the 2-of-3 decision and its cache, what
//! agents are then shown, and that the default tier is never verified.

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

fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String) {
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .env("DRIFT_CACHE_DIR", root.join(".cache-test"))
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

/// Routes wrapped in `withAuth()` (a call wrapper: default tier), emails rendered inside
/// `<BaseEmailWrapper>` and helpers that pass `level` to `log()` (both suggestions), each
/// with legacy outliers; all three accepted. Returns (wrapper, calls, jsx) ids.
fn repo() -> (tempfile::TempDir, String, String, String) {
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
    let (_, census) = run(r, &["census", "--json"], None);
    let census: Value = serde_json::from_str(&census).unwrap();
    let id = |k: &str| {
        census["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["rule_kind"] == k)
            .unwrap_or_else(|| panic!("no {k} proposal: {census}"))["id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let (wrapper, calls, jsx) = (
        id("wrapped_by:call"),
        id("passes_key"),
        id("wrapped_by:jsx"),
    );
    run(
        r,
        &["review", "--accept", &format!("{wrapper},{calls},{jsx}")],
        None,
    );
    (dir, wrapper, calls, jsx)
}

fn set_verify(r: &Path, on: bool) {
    let p = r.join(".drift/conventions.yaml");
    let yaml = std::fs::read_to_string(&p).unwrap();
    let yaml = yaml
        .replace("agents:\n  verify: on\n", "")
        .replace("agents:\n  verify: \"on\"\n", "");
    let yaml = if on {
        yaml.replacen(
            "\nconventions:\n",
            "\nagents:\n  verify: on\nconventions:\n",
            1,
        )
    } else {
        yaml
    };
    std::fs::write(p, yaml).unwrap();
}

/// The replies of an MCP session fed `msgs`, by request id.
fn mcp(r: &Path, msgs: &[Value]) -> Vec<Value> {
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, out) = run(r, &["mcp"], Some(&input));
    out.lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

/// `drift_verify_card` with `args`: (is an error, its text).
fn verify_card(r: &Path, args: Value) -> (bool, String) {
    let reply = mcp(
        r,
        &[json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_verify_card","arguments":args}})],
    )
    .remove(0);
    let res = &reply["result"];
    (
        res["isError"] == true,
        res["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    )
}

fn tool_listed(r: &Path) -> bool {
    mcp(r, &[json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})])[0]["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "drift_verify_card")
}

fn session_context(r: &Path) -> String {
    let input = json!({ "session_id": "s1", "cwd": r, "hook_event_name": "SessionStart", "source": "startup" });
    let (_, out) = run(
        r,
        &["hook", "claude", "SessionStart"],
        Some(&input.to_string()),
    );
    let v: Value = serde_json::from_str(out.trim()).unwrap();
    v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

/// `check --format json` `conventions[]` for `id`.
fn checked(r: &Path, id: &str) -> Value {
    let (_, out) = run(r, &["check", "--format", "json"], None);
    let v: Value = serde_json::from_str(&out).unwrap();
    v["conventions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone()
}

fn reply(intended: bool, outliers: &[&str]) -> Value {
    json!({"intended": intended, "outliers": outliers, "show": intended, "confidence": 70, "why": "x"})
}

#[test]
fn the_host_agent_verifies_a_suggestion_over_mcp() {
    let (dir, wrapper, calls, jsx) = repo();
    let r = dir.path();
    let prompt = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../eval/study/research/2026-11-07/r6-verifier-prompt-v3.txt"),
    )
    .unwrap();

    // Off by default: no tool, no hint, no `verify` in check JSON, suggestions hidden.
    assert!(!tool_listed(r));
    let reply_off = mcp(
        r,
        &[
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_verify_card","arguments":{"id": calls}}}),
        ],
    );
    assert_eq!(reply_off[0]["error"]["code"], -32602, "{reply_off:?}");
    assert!(!session_context(r).contains("drift_verify_card"));
    assert!(checked(r, &calls).get("verify").is_none());
    assert_eq!(checked(r, &calls)["agents"]["shown_to_agents"], false);

    set_verify(r, true);
    assert!(tool_listed(r));
    // The hint names the hidden suggestions, never the default tier.
    let ctx = session_context(r);
    assert!(
        ctx.contains("drift_verify_card") && ctx.contains(&calls) && ctx.contains(&jsx),
        "{ctx}"
    );
    assert!(!ctx.contains(&wrapper), "{ctx}");
    assert_eq!(checked(r, &calls)["verify"]["state"], "unverified");
    assert_eq!(checked(r, &calls)["verify"]["text"], "not verified");
    assert!(checked(r, &wrapper).get("verify").is_none());

    // [STRICT] The default tier is never verified.
    let (err, t) = verify_card(r, json!({"id": wrapper}));
    assert!(err && t.contains("default tier"), "{t}");
    let (err, t) = verify_card(r, json!({"id": "D-nope00"}));
    assert!(err && t.contains("unknown convention"), "{t}");

    // The payload: the frozen prompt, the card, 3 holders and the outlier, excerpted.
    let (err, t) = verify_card(r, json!({"id": calls}));
    assert!(!err, "{t}");
    let p: Value = serde_json::from_str(&t).unwrap();
    assert_eq!(p["system_prompt"], prompt.as_str());
    assert_eq!(p["prompt_version"], "v3");
    assert_eq!(p["samples"], 3);
    let hash = p["content_hash"].as_str().unwrap().to_string();
    assert_eq!(hash.len(), 64);
    assert_eq!(p["holders"].as_array().unwrap().len(), 3, "{p}");
    assert_eq!(p["outliers_total"], 1, "{p}");
    assert_eq!(p["outliers"][0]["path"], "src/lib/u39.ts", "{p}");
    let msg = p["message"].as_str().unwrap();
    for part in [
        "Repository: ",
        "## The card (as the tool prints it)\n```text\n[",
        "    outlier:  src/lib/u39.ts:",
        "## Code excerpts\n```text\n### Holder 1 (the example): ",
        "### Holder 2: ",
        "### Holder 3: ",
        "(another member that follows the rule)",
        "### Outlier 1: src/lib/u39.ts:",
        "  log({});",
    ] {
        assert!(msg.contains(part), "{part:?} not in {msg}");
    }
    // Holders follow the rule; no excerpt is of the outlier's file but its own.
    assert_eq!(msg.matches("src/lib/u39.ts").count(), 2, "{msg}");
    // The same card gives the same payload.
    let (_, again) = verify_card(r, json!({"id": calls}));
    assert_eq!(
        serde_json::from_str::<Value>(&again).unwrap()["content_hash"],
        hash.as_str()
    );

    // Verdicts for another content, or not three valid ones, are refused; nothing cached.
    let yes = reply(true, &["violation"]);
    let no = reply(false, &["exception"]);
    let (err, t) = verify_card(
        r,
        json!({"id": calls, "content_hash": "0".repeat(64), "verdicts": [yes, yes, no]}),
    );
    assert!(err && t.contains("card changed"), "{t}");
    let (err, t) = verify_card(
        r,
        json!({"id": calls, "content_hash": hash, "verdicts": [yes, yes]}),
    );
    assert!(err && t.contains("expected 3 verdicts"), "{t}");
    let (err, t) = verify_card(
        r,
        json!({"id": calls, "content_hash": hash, "verdicts": [yes, yes, {"intended": true, "outliers": ["perhaps"]}]}),
    );
    assert!(err, "{t}");
    assert!(!r.join(".drift/verify-cache.json").exists());

    // 2 of 3 (the second as the reply's raw text): verified, cached, shown to agents.
    let raw = format!("```json\n{yes}\n```");
    let (err, t) = verify_card(
        r,
        json!({"id": calls, "content_hash": hash, "verdicts": [yes, raw, no]}),
    );
    assert!(!err, "{t}");
    assert!(t.contains("verified by agent (2/3)"), "{t}");
    let cache: Value =
        serde_json::from_str(&std::fs::read_to_string(r.join(".drift/verify-cache.json")).unwrap())
            .unwrap();
    assert_eq!(cache["entries"][&calls]["content_hash"], hash.as_str());
    assert_eq!(cache["entries"][&calls]["passes"], 2);
    let c = checked(r, &calls);
    assert_eq!(c["agents"]["shown_to_agents"], true, "{c}");
    assert_eq!(c["agents"]["reason"], "verified", "{c}");
    assert_eq!(c["verify"]["state"], "passed", "{c}");
    assert_eq!(c["verify"]["text"], "verified by agent (2/3)", "{c}");
    // A new violation is what the verified rule now advises on: it is not part of the card
    // (only legacy outliers are), so the card stays verified and the agent is told.
    session_context(r);
    let bad = "import { log } from \"./log\";\n\nexport function util98() {\n  log({});\n  return 1;\n}\n";
    write(r, "src/lib/u98.ts", bad);
    let (_, text) = run(r, &["check"], None);
    assert!(text.contains(&calls) && text.contains("u98"), "{text}");
    assert_eq!(checked(r, &calls)["verify"]["state"], "passed");
    let post = json!({ "session_id": "s1", "cwd": r, "hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": { "file_path": r.join("src/lib/u98.ts") } });
    let (_, out) = run(
        r,
        &["hook", "claude", "PostToolUse"],
        Some(&post.to_string()),
    );
    assert!(out.contains(&calls), "{out}");
    std::fs::remove_file(r.join("src/lib/u98.ts")).unwrap();
    let ctx = session_context(r);
    assert!(!ctx.contains(&calls) && ctx.contains(&jsx), "{ctx}");
    let rules = mcp(
        r,
        &[
            json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"src/lib/u12.ts"}}}),
        ],
    );
    assert!(rules[0].to_string().contains(&calls), "{rules:?}");
    // One verdict per card content: no re-run until it passes.
    let (_, t) = verify_card(
        r,
        json!({"id": calls, "content_hash": hash, "verdicts": [no, no, no]}),
    );
    assert!(t.contains("already verified"), "{t}");
    assert_eq!(checked(r, &calls)["verify"]["state"], "passed");

    // 1 of 3: cached, not shown.
    let (_, t) = verify_card(r, json!({"id": jsx}));
    let jh = serde_json::from_str::<Value>(&t).unwrap()["content_hash"]
        .as_str()
        .unwrap()
        .to_string();
    let (_, t) = verify_card(
        r,
        json!({"id": jsx, "content_hash": jh, "verdicts": [yes, no, no]}),
    );
    assert!(t.contains("not verified (agent verdict 1/3)"), "{t}");
    let j = checked(r, &jsx);
    assert_eq!(
        (
            j["agents"]["shown_to_agents"].clone(),
            j["verify"]["state"].clone()
        ),
        (json!(false), json!("not_passed"))
    );

    // The card changes (an excerpted file is edited): the verdict is stale and ignored.
    let u39 = std::fs::read_to_string(r.join("src/lib/u39.ts")).unwrap();
    write(r, "src/lib/u39.ts", &format!("// edited\n{u39}"));
    let c = checked(r, &calls);
    assert_eq!(c["verify"]["state"], "stale", "{c}");
    assert_eq!(c["agents"]["shown_to_agents"], false, "{c}");
    assert!(session_context(r).contains(&calls));
    let (_, t) = verify_card(r, json!({"id": calls}));
    assert_ne!(
        serde_json::from_str::<Value>(&t).unwrap()["content_hash"],
        hash.as_str()
    );
    write(r, "src/lib/u39.ts", &u39);
    assert_eq!(checked(r, &calls)["verify"]["state"], "passed");

    // Off again: the cached pass is not read.
    set_verify(r, false);
    let c = checked(r, &calls);
    assert_eq!(c["agents"]["shown_to_agents"], false, "{c}");
    assert!(c.get("verify").is_none());
    // `drift init` keeps the setting.
    set_verify(r, true);
    run(r, &["init"], None);
    assert!(tool_listed(r));
    assert_eq!(checked(r, &calls)["verify"]["state"], "passed");
}
