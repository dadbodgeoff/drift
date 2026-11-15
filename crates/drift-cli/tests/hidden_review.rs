//! Withheld cards (surface11): mining finds cards the show policy hides (`drift_mine::show`),
//! or that Python proposals being off withholds. People are told how many, by family,
//! language and reason (`drift init`, `drift census`, `drift review`), and
//! `drift review --hidden` lists them with their evidence, for people. A person can
//! promote one with the review answers: it is written to `.drift/conventions.yaml` as
//! accepted by them (`promoted_from_hidden: true`) and from then on follows the normal tier
//! and agent rules.
//!
//! [STRICT] A withheld card is a convention on no agent surface (`drift check` text, the
//! hooks, MCP's rules, the AGENTS.md export) nor in SARIF unless a person promoted it: one
//! test per surface. The card of a file in its role (`drift card`, MCP `drift_card`) states
//! a strong one as a fact about the code, marked as no convention, and nothing else. Every
//! run here applies the show policy (no `DRIFT_TEST_UNSHOWN`), as a release build does.
//! The fixture is synthetic.

use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift` in `root`, the show policy applied: `(exit code, stdout, stderr)`.
fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String, String) {
    let mut cmd = Command::new(&*BIN);
    cmd.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .env_remove("DRIFT_TEST_UNSHOWN")
        .env_remove("DRIFT_REVIEW_VIA")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    }
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn ok(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args, None);
    assert_eq!(code, 0, "{args:?}: {out}{err}");
    out
}

fn ok_json(root: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&ok(root, args)).unwrap()
}

fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}

const GUARDED: &str = "import { withGate } from \"../../../lib/gate\";\n\nexport const GET = withGate(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// A synthetic app: 30 route handlers, 28 in `withGate()` (a default-tier card, proposed);
/// 40 workers in `src/workers/`, 38 named `*Worker` (a naming suggestion with 2 outliers:
/// withheld, too many outliers); 30 notices in `src/notices/`, 29 rendered inside
/// `<FrameShell>` (a JSX layout wrapper, 1 outlier, a family the show table does not admit:
/// withheld).
/// `routes`: whether the route handlers are there.
fn repo(routes: bool) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"fixture-surface\" }");
    if routes {
        write(
            r,
            "lib/gate.ts",
            "export function withGate<T>(h: T): T {\n  return h;\n}\n",
        );
        for i in 10..40 {
            let body = if i < 38 { GUARDED } else { UNGUARDED };
            write(r, &format!("app/api/q{i}/route.ts"), body);
        }
    }
    for i in 0..40 {
        let name = if i < 38 {
            format!("w{i}Worker")
        } else {
            format!("w{i}Thing")
        };
        write(
            r,
            &format!("src/workers/k{i}.ts"),
            &format!("export function {name}() {{\n  return {i};\n}}\n"),
        );
    }
    write(
        r,
        "src/ui/frame.tsx",
        "export function FrameShell(p: any) {\n  return <section>{p.children}</section>;\n}\n",
    );
    for i in 0..30 {
        let body = if i < 29 {
            format!(
                "import {{ FrameShell }} from \"../ui/frame\";\n\nexport function Notice{i}() {{\n  return <FrameShell><p>n</p></FrameShell>;\n}}\n"
            )
        } else {
            format!("export function Notice{i}() {{\n  return <p>n</p>;\n}}\n")
        };
        write(r, &format!("src/notices/n{i}.tsx"), &body);
    }
    for i in 10..30 {
        write(
            r,
            &format!("src/ui/t{i}.tsx"),
            &format!("export function Tile{i}() {{\n  return <div>t</div>;\n}}\n"),
        );
        write(
            r,
            &format!("src/misc/u{i}.ts"),
            &format!("export function util{i}() {{\n  return {i};\n}}\n"),
        );
    }
    dir
}

/// The withheld cards `drift review --hidden --json` lists: (summary, id, reason).
fn hidden_cards(root: &Path) -> Vec<(String, String, String)> {
    let v = ok_json(root, &["review", "--hidden", "--json"]);
    assert_eq!(v["hidden"], true, "{v}");
    v["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|q| {
            (
                q["summary"].as_str().unwrap().to_string(),
                q["id"].as_str().unwrap().to_string(),
                q["withheld"]["reason"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

/// `drift init` on the fixture, and the ids of the two withheld cards: (worker naming,
/// frame wrapper).
fn initialised(routes: bool) -> (tempfile::TempDir, String, String) {
    let dir = repo(routes);
    let r = dir.path();
    ok(r, &["init"]);
    let cards = hidden_cards(r);
    let find = |text: &str, reason: &str| {
        let c = cards
            .iter()
            .find(|c| c.0.contains(text))
            .unwrap_or_else(|| panic!("no withheld card with {text}: {cards:?}"));
        assert_eq!(c.2, reason, "{cards:?}");
        c.1.clone()
    };
    let worker = find("`*Worker`", "too_many_outliers");
    let frame = find("<FrameShell>", "family_not_admitted");
    assert_eq!(cards.len(), 2, "{cards:?}");
    (dir, worker, frame)
}

/// New code that breaks both withheld cards, so every surface that reports violations
/// would have something to say about them.
fn break_both(r: &Path) {
    write(
        r,
        "src/workers/k90.ts",
        "export function w90Gadget() {\n  return 90;\n}\n",
    );
    write(
        r,
        "src/notices/n90.tsx",
        "export function Notice90() {\n  return <p>n</p>;\n}\n",
    );
}

/// More code breaking both, written after a promotion baselined what was there.
fn break_again(r: &Path) {
    write(
        r,
        "src/workers/k92.ts",
        "export function w92Gizmo() {\n  return 92;\n}\n",
    );
    write(
        r,
        "src/notices/n92.tsx",
        "export function Notice92() {\n  return <p>n</p>;\n}\n",
    );
}

fn mentions(text: &str, id: &str, pattern: &str) -> bool {
    text.contains(id) || text.contains(pattern)
}

#[test]
fn init_census_and_review_count_the_withheld_cards() {
    let dir = repo(true);
    let r = dir.path();
    let init = ok(r, &["init"]);
    let note = "2 mined card(s) withheld by the show policy (not proposed; not shown as conventions to agents, hooks, MCP, exports or SARIF; `drift card <file>` states the strong ones as facts, not rules): TypeScript jsx_wrapper 1 (family not admitted (below the show bar on the dev labels)), TypeScript naming 1 (too many outliers (more than 1)). `drift review --hidden` lists them for people, with their evidence; a person can promote one.";
    assert!(init.contains(note), "{init}");
    let census = ok(r, &["census", "--all"]);
    assert!(census.contains(note), "{census}");
    let list = ok(r, &["review", "--list"]);
    assert!(list.contains(note), "{list}");

    // The census JSON: the proposals are what they were, the counts a new field.
    let v = ok_json(r, &["census", "--json", "--all"]);
    assert_eq!(v["conventions"], 1, "{v}");
    assert_eq!(
        v["withheld"],
        json!({
            "total": 2,
            "by": [
                {"language": "ts", "family": "jsx_wrapper", "reason": "family_not_admitted", "n": 1},
                {"language": "ts", "family": "naming", "reason": "too_many_outliers", "n": 1},
            ],
            "review": "drift review --hidden",
        })
    );
    let text = v.to_string();
    assert!(
        !text.contains("`*Worker`") && !text.contains("FrameShell"),
        "census lists no withheld card: {text}"
    );
    // Only the proposal is in the policy.
    let yaml = read(r, ".drift/conventions.yaml");
    assert!(
        !yaml.contains("Worker") && !yaml.contains("FrameShell"),
        "{yaml}"
    );
}

#[test]
fn an_empty_result_says_why_it_is_empty() {
    // No route handlers: every card mining finds is withheld.
    let dir = repo(false);
    let r = dir.path();
    let census = ok(r, &["census"]);
    assert!(
        census.contains("0 conventions from")
            && census.contains(
                "No conventions shown: mining found 2 card(s), and every one was withheld (above)."
            )
            && census.contains("`drift review --hidden` lists them"),
        "{census}"
    );
    assert!(!census.contains("roles need roughly 20+"), "{census}");
    let init = ok(r, &["init"]);
    assert!(
        init.contains("No conventions shown: mining found 2 card(s)"),
        "{init}"
    );
    let list = ok(r, &["review", "--list"]);
    assert!(
        list.starts_with("0 proposed conventions to review.\n2 mined card(s) withheld"),
        "{list}"
    );
    // A repository where mining finds nothing still says what it is missing.
    let empty = tempfile::tempdir().unwrap();
    write(empty.path(), "package.json", "{ \"name\": \"e\" }");
    write(empty.path(), "src/a.ts", "export const a = 1;\n");
    let census = ok(empty.path(), &["census"]);
    assert!(
        census.contains("No conventions found: roles need roughly 20+"),
        "{census}"
    );
    let v = ok_json(empty.path(), &["census", "--json"]);
    assert_eq!(v["withheld"]["total"], 0);
}

/// The closing line of `init` and `census` when cards were withheld: how many, the
/// command that lists them, and that a promoted card of a family below the bar reaches
/// agents only with `--show-to-agents`. Nothing of it where nothing was withheld.
#[test]
fn init_and_census_close_with_the_next_step_for_withheld_cards() {
    let next = "Next for the 2 withheld card(s): `drift review --hidden` lists them with their evidence, and `drift review --hidden --answer <id>=same` promotes one. A promoted card whose rule family is below the admission bar reaches agents only after `drift review --show-to-agents <id>`.";
    for routes in [true, false] {
        let dir = repo(routes);
        let r = dir.path();
        for args in [vec!["census"], vec!["init"], vec!["census"]] {
            let out = ok(r, &args);
            assert_eq!(out.lines().last(), Some(next), "{args:?} {routes}: {out}");
            assert_eq!(out.matches("Next for the").count(), 1, "{out}");
        }
    }
    // Nothing withheld: no such line.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"fixture-plain\" }");
    write(
        r,
        "lib/gate.ts",
        "export function withGate<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 10..40 {
        let body = if i < 38 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/q{i}/route.ts"), body);
    }
    assert_eq!(ok_json(r, &["census", "--json"])["withheld"]["total"], 0);
    for args in [vec!["census"], vec!["init"]] {
        let out = ok(r, &args);
        assert!(
            !out.contains("Next for the") && !out.contains("--hidden"),
            "{out}"
        );
    }
}

#[test]
fn review_hidden_lists_the_cards_with_their_evidence_and_changes_nothing() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    let yaml = read(r, ".drift/conventions.yaml");
    let lock = read(r, "drift.lock");
    let out = ok(r, &["review", "--hidden"]);
    assert!(
        out.starts_with("2 mined card(s) withheld by the show policy"),
        "{out}"
    );
    assert!(
        out.contains("None is a convention unless you promote it: no hook, MCP rule, export or SARIF report lists one, and nothing checks one. `drift card <file>` states the strong ones as facts about the code, not rules."),
        "{out}"
    );
    for (id, why) in [
        (
            &worker,
            "  withheld: too many outliers (more than 1) (TypeScript naming)\n",
        ),
        (
            &frame,
            "  withheld: family not admitted (below the show bar on the dev labels) (TypeScript jsx_wrapper)\n",
        ),
    ] {
        assert!(out.contains(&format!("[{id}] ")), "{out}");
        assert!(out.contains(why), "{out}");
        assert!(
            out.contains(&format!(
                "  promote:  `drift review --hidden --answer {id}=same` (accept)"
            )),
            "{out}"
        );
    }
    // The evidence view of normal review: evidence, tier, example and outliers now.
    assert!(out.contains("  evidence: 38/40 (lower bound"), "{out}");
    assert!(out.contains("  outliers: 2 in the code now\n"), "{out}");
    assert!(out.contains("src/workers/k38.ts:1 w38Thing"), "{out}");
    assert!(out.contains("src/notices/n29.tsx:1 Notice29"), "{out}");
    // No command that needs a card in the policy.
    assert!(!out.contains("--exempt"), "{out}");
    // Nothing was written.
    assert_eq!(read(r, ".drift/conventions.yaml"), yaml);
    assert_eq!(read(r, "drift.lock"), lock);
    // An id that is not withheld is refused, and nothing changes.
    let (code, _, err) = run(
        r,
        &["review", "--hidden", "--answer", "D-000000=same"],
        None,
    );
    assert_ne!(code, 0);
    assert!(err.contains("is not a card mining withholds now"), "{err}");
    let (code, _, err) = run(r, &["review", "--hidden", "--list"], None);
    assert_ne!(code, 0);
    assert!(err.contains("--hidden goes alone"), "{err}");
    // Review of the policy knows nothing of them.
    let (code, _, err) = run(r, &["review", "--accept", &worker], None);
    assert!(code != 0 && err.contains("unknown convention"), "{err}");
    assert_eq!(read(r, ".drift/conventions.yaml"), yaml);
}

#[test]
fn a_promotion_is_a_person_decision_and_is_logged() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    ok(r, &["review", "--set-log", "on"]);
    ok(r, &["review", "--hidden"]);
    let out = ok(
        r,
        &["review", "--hidden", "--answer", &format!("{worker}=same")],
    );
    assert!(
        out.contains(&format!("{worker}: the same kind of thing: accepted"))
            && out.contains("promoted from the withheld cards")
            && out.contains("promoted_from_hidden: true"),
        "{out}"
    );
    let yaml = read(r, ".drift/conventions.yaml");
    let entry = yaml
        .split("- id: ")
        .find(|e| e.starts_with(&worker))
        .unwrap_or_else(|| panic!("{yaml}"));
    assert!(
        entry.contains("status: accepted") && entry.contains("promoted_from_hidden: true"),
        "{entry}"
    );
    assert_eq!(yaml.matches("promoted_from_hidden").count(), 1, "{yaml}");
    // Its outliers now are legacy, as for any card `drift init` adds.
    let lock = read(r, "drift.lock");
    assert!(
        lock.contains(&format!("{worker} src/workers/k38.ts#w38Thing")),
        "{lock}"
    );
    // Not a convention: rejected (marked, so it is not asked again).
    ok(
        r,
        &[
            "review",
            "--hidden",
            "--answer",
            &format!("{frame}=not-a-convention"),
        ],
    );
    let yaml = read(r, ".drift/conventions.yaml");
    let entry = yaml
        .split("- id: ")
        .find(|e| e.starts_with(&frame))
        .unwrap();
    assert!(
        entry.contains("status: rejected") && entry.contains("promoted_from_hidden: true"),
        "{entry}"
    );
    assert!(hidden_cards(r).is_empty());
    let v = ok_json(r, &["census", "--json"]);
    assert_eq!(v["withheld"]["total"], 0, "{v}");
    // The promoted card follows the normal rules: proposed by census as accepted.
    assert!(v.to_string().contains(&worker), "{v}");

    // The log: both cards shown from the hidden list, the promotion and the rejection.
    ok(r, &["review", "--export-log", "study.json"]);
    let study: Value = serde_json::from_str(&read(r, "study.json")).unwrap();
    let events: Vec<&Value> = study["events"].as_array().unwrap().iter().collect();
    let hidden: Vec<(&str, &str, bool)> = events
        .iter()
        .filter(|e| !e["hidden"].is_null())
        .map(|e| {
            (
                e["decision"].as_str().unwrap(),
                e["hidden"]["show_family"].as_str().unwrap(),
                e["hidden"]["promoted"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        hidden,
        [
            ("shown", "jsx_wrapper", false),
            ("shown", "naming", false),
            ("accept", "naming", true),
            ("reject", "jsx_wrapper", false),
        ],
        "{study}"
    );
    let accept = events.iter().find(|e| e["decision"] == "accept").unwrap();
    assert_eq!(accept["hidden"]["reason"], "too_many_outliers");
    assert_eq!(accept["question"]["answer"], "same");
    // Ids are hashed on export.
    assert!(!study.to_string().contains(&worker), "{study}");

    // `drift init` again keeps the decisions and the marker.
    ok(r, &["init"]);
    let yaml = read(r, ".drift/conventions.yaml");
    assert_eq!(
        yaml.matches("promoted_from_hidden: true").count(),
        2,
        "{yaml}"
    );
}

/// The hook answers an agent gets around writing `rel`.
fn hook_texts(r: &Path, rel: &str, content: &str) -> String {
    let mut out = String::new();
    for (event, extra) in [
        ("SessionStart", json!({ "source": "startup" })),
        (
            "PreToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(rel), "content": content } }),
        ),
        (
            "PostToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(rel), "content": content } }),
        ),
        ("Stop", json!({})),
    ] {
        let mut input = json!({ "session_id": "s1", "cwd": r, "hook_event_name": event });
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (code, text, _) = run(r, &["hook", "claude", event], Some(&input.to_string()));
        assert_eq!(code, 0, "hooks exit 0");
        out.push_str(&text);
        out.push('\n');
    }
    out
}

/// The MCP server's answers about the withheld cards.
fn mcp_texts(r: &Path, ids: &[&str]) -> String {
    let mut msgs = vec![json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{}})];
    let mut calls = vec![
        json!({"name":"drift_rules_for","arguments":{"path":"src/workers/k90.ts"}}),
        json!({"name":"drift_rules_for","arguments":{"path":"src/notices/n90.tsx"}}),
        json!({"name":"drift_example","arguments":{"path":"src/workers/k91.ts"}}),
        json!({"name":"drift_check","arguments":{}}),
    ];
    calls.extend(
        ids.iter()
            .map(|id| json!({"name":"drift_explain","arguments":{"id":id}})),
    );
    for (i, c) in calls.iter().enumerate() {
        msgs.push(json!({"jsonrpc":"2.0","id":i + 1,"method":"tools/call","params":c}));
    }
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (_, out, _) = run(r, &["mcp"], Some(&input));
    let answers: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|v| v["id"] != 0)
        .collect();
    assert_eq!(answers.len(), calls.len(), "{out}");
    out
}

/// The withheld cards' patterns as agent surfaces would quote them.
const WORKER: &str = "*Worker";
const FRAME: &str = "FrameShell";

/// Promote both withheld cards: accepted by a person. Their families are below the agents'
/// admission bar, so the normal agent rules still show neither to agents.
fn promote_both(r: &Path, worker: &str, frame: &str) {
    for id in [worker, frame] {
        let out = ok(
            r,
            &["review", "--hidden", "--answer", &format!("{id}=same")],
        );
        assert!(
            out.contains("It now follows the normal tier and agent rules: not shown to agents"),
            "{out}"
        );
    }
}

/// [STRICT] `drift check`'s text, which agents and people read: no withheld card;
/// promoted (accepted by a person), each listed and marked "not shown to agents" while
/// the normal agent rules keep it from agents, and once a person shows one to agents,
/// that one unmarked.
#[test]
fn withheld_cards_never_reach_check_text() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    break_both(r);
    ok(r, &["review", "--hidden"]);
    let (_, text, err) = run(r, &["check", "--include-hidden"], None);
    let text = format!("{text}{err}");
    assert!(
        !mentions(&text, &worker, WORKER) && !text.contains(&frame),
        "{text}"
    );
    let json = ok(r, &["check", "--format", "json"]);
    assert!(!json.contains(&worker) && !json.contains(&frame), "{json}");
    promote_both(r, &worker, &frame);
    break_again(r);
    let (_, text, err) = run(r, &["check"], None);
    let text = format!("{text}{err}");
    assert!(
        text.contains(&format!("[{worker}]"))
            && text.contains(&format!("[{frame}]"))
            && text.contains("2 new violation(s)")
            && text.matches("not shown to agents)").count() == 2,
        "{text}"
    );
    ok(r, &["review", "--show-to-agents", &worker]);
    let (_, text, err) = run(r, &["check"], None);
    let text = format!("{text}{err}");
    assert!(
        text.contains(&format!("[{worker}]"))
            && text.contains(&format!("[{frame}]"))
            && text.contains("2 new violation(s)")
            && text.matches("not shown to agents)").count() == 1,
        "{text}"
    );
}

/// Interactive `drift review` with nothing proposed but cards withheld says so in one
/// line that names `drift review --hidden` and how to promote one, instead of printing
/// "0 proposed conventions" and the keys it would take. Needs a terminal: run under
/// `script` (util-linux).
#[cfg(target_os = "linux")]
#[test]
fn interactive_review_with_only_withheld_cards_names_the_hidden_list() {
    let (dir, _, _) = initialised(false);
    let r = dir.path();
    let review = |r: &Path| -> String {
        let out = Command::new("script")
            .args(["-qec", &format!("{} review", *BIN), "/dev/null"])
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .env_remove("DRIFT_EXPERIMENTAL")
            .env_remove("DRIFT_TEST_UNSHOWN")
            .env_remove("DRIFT_REVIEW_VIA")
            .env_remove("DRIFT_AGENT")
            .stdin(Stdio::null())
            .output()
            .expect("`script` (util-linux) runs the review on a terminal");
        String::from_utf8_lossy(&out.stdout).replace('\r', "")
    };
    let text = review(r);
    assert!(
        text.contains("0 proposed conventions to review, but mining withheld 2 card(s)")
            && text.contains("`drift review --hidden` lists them")
            && text.contains("`drift review --hidden --answer <id>=same` promotes one"),
        "{text}"
    );
    assert!(
        !text.contains("y = accept") && !text.contains("0 accepted"),
        "{text}"
    );
    // Nothing withheld, nothing proposed: just that.
    let empty = tempfile::tempdir().unwrap();
    write(empty.path(), "package.json", "{ \"name\": \"e\" }");
    write(empty.path(), "src/a.ts", "export const a = 1;\n");
    ok(empty.path(), &["init"]);
    assert_eq!(review(empty.path()), "0 proposed conventions to review.\n");
}

/// [STRICT] The hooks: SessionStart, PreToolUse, PostToolUse and Stop say nothing of a
/// withheld card, nor of a promoted one the agent rules do not show.
#[test]
fn withheld_cards_never_reach_the_hooks() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    break_both(r);
    ok(r, &["review", "--hidden"]);
    let bad_worker = "export function w91Gadget() {\n  return 91;\n}\n";
    let bad_notice = "export function Notice91() {\n  return <p>n</p>;\n}\n";
    let quiet = |r: &Path| {
        for (rel, content) in [
            ("src/workers/k91.ts", bad_worker),
            ("src/notices/n91.tsx", bad_notice),
        ] {
            let text = hook_texts(r, rel, content);
            assert!(!mentions(&text, &worker, WORKER), "{text}");
            assert!(!mentions(&text, &frame, FRAME), "{text}");
        }
    };
    quiet(r);
    promote_both(r, &worker, &frame);
    quiet(r);
    // A person shows the naming card to agents: now the hooks have it.
    ok(r, &["review", "--show-to-agents", &worker]);
    let text = hook_texts(r, "src/workers/k91.ts", bad_worker);
    assert!(text.contains(&worker), "{text}");
    let text = hook_texts(r, "src/notices/n91.tsx", bad_notice);
    assert!(!mentions(&text, &frame, FRAME), "{text}");
}

/// [STRICT] MCP: `drift_rules_for`, `drift_example`, `drift_check` and `drift_explain`
/// know no withheld card, nor a promoted one the agent rules do not show.
#[test]
fn withheld_cards_never_reach_mcp() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    break_both(r);
    ok(r, &["review", "--hidden"]);
    let text = mcp_texts(r, &[&worker, &frame]);
    assert!(!text.contains(WORKER) && !text.contains(FRAME), "{text}");
    assert!(
        text.contains(&format!("unknown convention {worker}"))
            && text.contains(&format!("unknown convention {frame}")),
        "{text}"
    );
    promote_both(r, &worker, &frame);
    let text = mcp_texts(r, &[]);
    assert!(!text.contains(WORKER) && !text.contains(FRAME), "{text}");
    ok(r, &["review", "--show-to-agents", &worker]);
    let text = mcp_texts(r, &[]);
    assert!(text.contains(WORKER), "{text}");
    assert!(!text.contains(FRAME), "{text}");
}

/// MCP `drift_card` for `rel`: its text.
fn mcp_card(r: &Path, rel: &str) -> String {
    let input = format!(
        "{}\n{}\n",
        json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}),
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_card","arguments":{"path":rel}}}),
    );
    let (_, out, _) = run(r, &["mcp"], Some(&input));
    let answer: Value = out
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .find(|v| v["id"] == 1)
        .unwrap_or_else(|| panic!("{out}"));
    answer["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("{answer}"))
        .to_string()
}

/// The card of a file (`drift card`, MCP `drift_card`) is the one place an agent reads a
/// withheld card, and there it is a fact about the code under a heading that says it is
/// no convention. Promoted and not shown to agents it stays a fact; shown to agents it is
/// listed as the convention it now is, once; rejected by a person it is not said at all.
#[test]
fn the_card_states_a_strong_withheld_card_as_a_fact_not_a_convention() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    const HEAD: &str =
        "Regularities here (facts, not rules; not accepted conventions, nothing checks them):\n";
    const ACCEPTED_HEAD: &str = "Accepted conventions here (a person accepted them and `drift check` checks them; not shown to agents as rules: their rule family is below the admission bar, `drift review --show-to-agents <id>` shows one):\n";
    let worker_fact = "  functions in src/workers/** are named '*Worker', 38 of 40 (copy src/workers/k1.ts:1 w1Worker); this file: does\n";
    let frame_fact = "  components in src/notices/** render inside ‹FrameShell›, 29 of 30 (copy src/notices/n0.tsx:3 Notice0); this file: does not (Notice29:1)\n";
    let status = |rel: &str| -> Vec<(String, String)> {
        let v = ok_json(r, &["card", "--json", rel]);
        v["regularities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| {
                (
                    g["id"].as_str().unwrap().to_string(),
                    g["status"].as_str().unwrap().to_string(),
                )
            })
            .collect()
    };

    // Withheld: stated as facts, by the CLI and by MCP alike, with no id and no
    // "Conventions" line.
    for text in [
        ok(r, &["card", "src/workers/k0.ts"]),
        mcp_card(r, "src/workers/k0.ts"),
    ] {
        assert!(text.contains(&format!("{HEAD}{worker_fact}")), "{text}");
        assert!(
            !text.contains("Conventions (") && !text.contains(&worker),
            "{text}"
        );
    }
    for text in [
        ok(r, &["card", "src/notices/n29.tsx"]),
        mcp_card(r, "src/notices/n29.tsx"),
    ] {
        assert!(text.contains(&format!("{HEAD}{frame_fact}")), "{text}");
        assert!(
            !text.contains("Conventions (") && !text.contains(&frame),
            "{text}"
        );
    }
    assert_eq!(
        status("src/workers/k0.ts"),
        [(worker.clone(), "withheld".to_string())]
    );
    // `drift review --hidden` says which it is for each card.
    let hidden = ok(r, &["review", "--hidden"]);
    assert_eq!(
        hidden
            .matches("  agents:   a fact on `drift card`, not a convention, while withheld; if promoted, ")
            .count(),
        2,
        "{hidden}"
    );
    // The proposed default-tier card (28 of 30 handlers in `withGate()`) is a fact on
    // the card of a route file too, and a convention nowhere until a person accepts it.
    let text = ok(r, &["card", "app/api/q10/route.ts"]);
    assert!(
        text.contains(&format!("{HEAD}  HTTP handlers in app/** (route files) are wrapped in withGate(), 28 of 30 (copy app/api/q11/route.ts:3 GET); this file: does\n")),
        "{text}"
    );
    assert!(!text.contains("Conventions ("), "{text}");

    // Promoted by a person, its family still not shown to agents: still no convention
    // agents are shown, but no longer "not accepted, nothing checks it".
    promote_both(r, &worker, &frame);
    let text = ok(r, &["card", "src/workers/k0.ts"]);
    assert!(
        text.contains(&format!("{ACCEPTED_HEAD}{worker_fact}")),
        "{text}"
    );
    assert!(!text.contains(HEAD), "{text}");
    assert!(!text.contains("Conventions ("), "{text}");
    assert_eq!(
        status("src/workers/k0.ts"),
        [(worker.clone(), "accepted".to_string())]
    );

    // Shown to agents: the convention it is, and no longer a regularity beside it.
    ok(r, &["review", "--show-to-agents", &worker]);
    for text in [
        ok(r, &["card", "src/workers/k0.ts"]),
        mcp_card(r, "src/workers/k0.ts"),
    ] {
        assert!(
            text.contains(&format!("Conventions (1):\n  [{worker}] ")),
            "{text}"
        );
        assert!(!text.contains("Regularities here"), "{text}");
    }
    assert_eq!(status("src/workers/k0.ts"), []);
    // The other card is untouched by that: accepted, not shown to agents.
    let text = ok(r, &["card", "src/notices/n29.tsx"]);
    assert!(
        text.contains(&format!("{ACCEPTED_HEAD}{frame_fact}")),
        "{text}"
    );
}

/// A card a person rejected is not a fact the card repeats: it was judged no regularity
/// worth following.
#[test]
fn the_card_says_nothing_of_a_card_a_person_rejected() {
    let (dir, worker, _) = initialised(true);
    let r = dir.path();
    assert!(ok(r, &["card", "src/workers/k0.ts"]).contains("Regularities here"));
    ok(
        r,
        &[
            "review",
            "--hidden",
            "--answer",
            &format!("{worker}=not-a-convention"),
        ],
    );
    for text in [
        ok(r, &["card", "src/workers/k0.ts"]),
        mcp_card(r, "src/workers/k0.ts"),
    ] {
        assert!(
            !text.contains("Regularities here") && !text.contains(WORKER),
            "{text}"
        );
    }
}

/// [STRICT] The AGENTS.md export lists no withheld card, nor a promoted one the agent
/// rules do not show.
#[test]
fn withheld_cards_never_reach_the_agents_md_export() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    ok(r, &["review", "--hidden"]);
    let md = ok(r, &["export", "agents-md"]);
    assert!(!md.contains("Worker") && !md.contains(FRAME), "{md}");
    write(r, "AGENTS.md", "# Agents\n");
    ok(r, &["export", "agents-md", "--write", "AGENTS.md"]);
    let md = read(r, "AGENTS.md");
    assert!(!md.contains("Worker") && !md.contains(FRAME), "{md}");
    promote_both(r, &worker, &frame);
    let md = ok(r, &["export", "agents-md"]);
    assert!(!md.contains("Worker") && !md.contains(FRAME), "{md}");
    ok(r, &["review", "--show-to-agents", &worker]);
    let md = ok(r, &["export", "agents-md"]);
    assert!(md.contains(WORKER), "{md}");
    assert!(!md.contains(FRAME), "{md}");
}

/// [STRICT] SARIF lists no finding of a withheld card; once a person promoted one, its
/// new violations are listed (SARIF lists every accepted convention's findings, as
/// before).
#[test]
fn withheld_cards_never_reach_sarif() {
    let (dir, worker, frame) = initialised(true);
    let r = dir.path();
    break_both(r);
    ok(r, &["review", "--hidden"]);
    let sarif = ok(r, &["check", "--format", "sarif"]);
    let s: Value = serde_json::from_str(&sarif).unwrap();
    assert_eq!(s["version"], "2.1.0", "{sarif}");
    assert!(
        !sarif.contains(&worker) && !sarif.contains(&frame),
        "{sarif}"
    );
    assert!(!sarif.contains(WORKER) && !sarif.contains(FRAME), "{sarif}");
    let github = ok(r, &["check", "--format", "github"]);
    assert!(
        !github.contains(&worker) && !github.contains(&frame),
        "{github}"
    );
    ok(
        r,
        &["review", "--hidden", "--answer", &format!("{frame}=same")],
    );
    break_again(r);
    let sarif = ok(r, &["check", "--format", "sarif"]);
    assert!(
        sarif.contains(&frame) && sarif.contains("src/notices/n92.tsx"),
        "{sarif}"
    );
    // Baselined at promotion: the outliers that were there before are not new.
    assert!(
        !sarif.contains("src/notices/n29.tsx") && !sarif.contains("src/notices/n90.tsx"),
        "{sarif}"
    );
    // The card nobody promoted is still absent.
    assert!(
        !sarif.contains(&worker) && !sarif.contains("k92"),
        "{sarif}"
    );
}
