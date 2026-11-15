//! The show policy on every surface (`drift_mine::show`, eval/study/PLAN-R10.md §4): a
//! suggestion is shown only with at most one outlier and an admitted family. A hidden card
//! is gone, not flagged: `census --all` does not list it, and a proposal of it in an
//! older `.drift/conventions.yaml` is dropped when Drift reads the file (`check`, review,
//! the AGENTS.md export, MCP). The default tier and what a person decided stay.
//!
//! The older file is written by this debug binary with `DRIFT_TEST_UNSHOWN=1`
//! (`drift_mine::show::TEST_UNSHOWN_ENV`, which release builds do not read).

use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

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

/// 30 route handlers, 28 in `withAuth()` (a default-tier card with 2 outliers); 20 services
/// in `src/svc/`, 19 named `*Service` (a naming suggestion with 1 outlier: shown); 40 jobs
/// in `src/jobs/`, 38 named `*Job` (2 outliers: hidden); 30 emails in `src/emails/`, 29
/// rendered inside `<BaseWrapper>` (a JSX layout wrapper, 1 outlier, a family the table
/// does not admit: hidden).
fn repo() -> tempfile::TempDir {
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
    for (dir, suffix, n, plain) in [("svc", "Service", 20, 1), ("jobs", "Job", 40, 2)] {
        for i in 0..n {
            let name = if i < n - plain {
                format!("x{i}{suffix}")
            } else {
                format!("x{i}Helper")
            };
            write(
                r,
                &format!("src/{dir}/m{i}.ts"),
                &format!("export function {name}() {{\n  return {i};\n}}\n"),
            );
        }
    }
    write(
        r,
        "src/ui/base.tsx",
        "export function BaseWrapper(p: any) {\n  return <div>{p.children}</div>;\n}\n",
    );
    for i in 0..30 {
        let email = if i < 29 {
            format!(
                "import {{ BaseWrapper }} from \"../ui/base\";\n\nexport function Email{i}() {{\n  return <BaseWrapper><p>hi</p></BaseWrapper>;\n}}\n"
            )
        } else {
            format!("export function Email{i}() {{\n  return <p>hi</p>;\n}}\n")
        };
        write(r, &format!("src/emails/e{i}.tsx"), &email);
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
    }
    dir
}

fn run(root: &Path, args: &[&str], unshown: bool, stdin: Option<&str>) -> (bool, String) {
    let mut cmd = Command::new(&*BIN);
    cmd.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_TEST_UNSHOWN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if unshown {
        cmd.env("DRIFT_TEST_UNSHOWN", "1");
    }
    let mut child = cmd.spawn().unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    }
    drop(child.stdin.take());
    let out = child.wait_with_output().unwrap();
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (out.status.success(), text)
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (ok, text) = run(root, args, false, None);
    assert!(ok, "{args:?} failed: {text}");
    text
}

fn json(root: &Path, args: &[&str]) -> Value {
    output_json(root, args, false)
}

fn output_json(root: &Path, args: &[&str], unshown: bool) -> Value {
    let mut cmd = Command::new(&*BIN);
    cmd.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_TEST_UNSHOWN");
    if unshown {
        cmd.env("DRIFT_TEST_UNSHOWN", "1");
    }
    let out = cmd.output().unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

fn ids(v: &Value, key: &str) -> Vec<String> {
    v[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect()
}

/// The cards of `census --json` (`unshown`: as the miner finds them, before the policy).
fn census(root: &Path, unshown: bool) -> Value {
    output_json(root, &["census", "--json", "--all"], unshown)
}

/// The id of the card whose summary contains `text`.
fn card<'a>(v: &'a Value, text: &str) -> Option<&'a Value> {
    v["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["summary"].as_str().unwrap().contains(text))
}

#[test]
fn census_all_lists_only_what_the_show_policy_shows() {
    let dir = repo();
    let r = dir.path();
    let all = census(r, true);
    let shown = census(r, false);
    let auth = card(&all, "withAuth").expect("the default-tier card");
    assert_eq!(auth["tier"], "default");
    assert_eq!(auth["outliers_total"], 2);
    let svc = card(&all, "`*Service`").expect("the miner finds the service naming card");
    let jobs = card(&all, "`*Job`").expect("the miner finds the job naming card");
    let emails = card(&all, "<BaseWrapper>").expect("the miner finds the layout wrapper card");
    assert_eq!(
        (
            &svc["outliers_total"],
            &jobs["outliers_total"],
            &emails["outliers_total"]
        ),
        (&Value::from(1), &Value::from(2), &Value::from(1))
    );
    for c in [svc, jobs, emails] {
        assert_eq!(c["tier"], "suggestion", "{c}");
    }
    let listed = ids(&shown, "proposals");
    // The default tier, and the one-outlier card of an admitted family.
    assert!(listed.contains(&auth["id"].as_str().unwrap().to_string()));
    assert!(listed.contains(&svc["id"].as_str().unwrap().to_string()));
    // Gone: two outliers; a family not admitted.
    assert!(!listed.contains(&jobs["id"].as_str().unwrap().to_string()));
    assert!(!listed.contains(&emails["id"].as_str().unwrap().to_string()));
    // Nothing new, and the table's provenance is stated.
    for id in &listed {
        assert!(ids(&all, "proposals").contains(id), "{id}");
    }
    let show = &shown["params"]["show"];
    assert_eq!(show["file"], "crates/drift-mine/data/show-policy.json");
    assert_eq!(show["max_outliers"], 1);
    assert_eq!(
        show["admitted"]["ts"],
        serde_json::json!(["control", "naming"])
    );
    // The text census says the same.
    let text = drift(r, &["census", "--all"]);
    assert!(
        text.contains("`*Service`") && !text.contains("`*Job`") && !text.contains("<BaseWrapper>"),
        "{text}"
    );
}

#[test]
fn a_hidden_proposal_in_an_older_policy_reaches_no_surface() {
    let dir = repo();
    let r = dir.path();
    // An older Drift proposed every card, and a person accepted the layout wrapper.
    let (ok, text) = run(r, &["init"], true, None);
    assert!(ok, "{text}");
    let all = census(r, true);
    let jobs = card(&all, "`*Job`").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let emails = card(&all, "<BaseWrapper>").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (ok, text) = run(r, &["review", "--accept", &emails], true, None);
    assert!(ok, "{text}");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(yaml.contains(&jobs) && yaml.contains(&emails));

    // `check --format json` lists every policy convention as Drift reads it.
    let check = json(r, &["check", "--format", "json"]);
    let conventions = ids(&check, "conventions");
    assert!(!conventions.contains(&jobs), "{conventions:?}");
    assert!(conventions.contains(&emails), "a person's decision stays");
    // Review knows nothing of it.
    let (ok, text) = run(r, &["review", "--accept", &jobs], false, None);
    assert!(!ok && text.contains("unknown convention"), "{text}");
    let list = drift(r, &["review", "--list"]);
    assert!(!list.contains(&jobs), "{list}");
    // Nor do the AGENTS.md export and MCP.
    let md = drift(r, &["export", "agents-md"]);
    assert!(!md.contains(&jobs) && !md.contains("`*Job`"), "{md}");
    let mcp = concat!(
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_explain","arguments":{"id":"ID"}}}"#,
        "\n"
    )
    .replace("ID", &jobs);
    let (_, text) = run(r, &["mcp"], false, Some(&mcp));
    assert!(text.contains(r#""id":2"#), "MCP answered: {text}");
    assert!(!text.contains("`*Job`"), "{text}");
    // The next `drift init` writes the file without it; the accepted card stays.
    drift(r, &["init"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(!yaml.contains(&jobs), "{yaml}");
    assert!(yaml.contains(&emails), "{yaml}");
}
