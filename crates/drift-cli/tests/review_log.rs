//! The review log (round 9, G): opt-in and local. Off (the default), `drift review` writes
//! no file and prints exactly what it printed before; on (`--set-log on`, or `--log` for
//! one run), each decision and each card shown is appended to `.drift/review-log/`, and
//! `--export-log` writes a study file in which nothing names the code unless the person
//! passes `--include-paths`.

use std::path::Path;
use std::process::{Command, Output};

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

fn run_env(root: &Path, args: &[&str], env: &[(&str, &str)]) -> Output {
    let mut cmd = Command::new(&*BIN);
    cmd.env("DRIFT_TEST_UNSHOWN", "1");
    cmd.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_REVIEW_VIA");
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.output().unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = run_env(root, args, &[]);
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// 40 routes, 37 wrapped in `withAuth` (default tier), and 30 emails, 29 rendered in
/// `<BaseWrapper>` (a JSX layout wrapper: a suggestion). Returns the two ids.
fn repo() -> (tempfile::TempDir, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"secret-product\" }");
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
        write(r, &format!("src/emails/e{i:02}.tsx"), &email);
    }
    for i in 0..30 {
        let body = format!("export function h{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/h{i:02}.ts"), &body);
    }
    // Components that are not rendered in it, so the wrapper has lift.
    for i in 0..20 {
        write(
            r,
            &format!("src/ui/c{i:02}.tsx"),
            &format!("export function Card{i}() {{\n  return <div>c</div>;\n}}\n"),
        );
    }
    drift(r, &["init"]);
    let census: Value = serde_json::from_str(&drift(r, &["census", "--json"])).unwrap();
    let find = |what: &str| {
        census["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["summary"].as_str().unwrap().contains(what))
            .unwrap_or_else(|| panic!("{what} convention in {census}"))
            .clone()
    };
    let auth = find("withAuth");
    let email = find("BaseWrapper");
    assert_eq!(auth["tier"], "default", "{auth}");
    assert_eq!(email["tier"], "suggestion", "{email}");
    (
        dir,
        auth["id"].as_str().unwrap().to_string(),
        email["id"].as_str().unwrap().to_string(),
    )
}

/// A review session: cards shown, every kind of decision, an exception added and removed.
fn session(auth: &str, email: &str) -> Vec<Vec<String>> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    vec![
        s(&["review", "--list"]),
        s(&["review", "--show", &format!("{auth},{email}")]),
        s(&["review", "--block", auth]),
        s(&[
            "review",
            "--exempt",
            auth,
            "--member",
            "app/api/r38/route.ts#GET",
            "--reason",
            "health check, public by design",
        ]),
        s(&[
            "review",
            "--unexempt",
            auth,
            "--member",
            "app/api/r38/route.ts#GET",
        ]),
        s(&["review", "--advise", auth]),
        s(&["review", "--block", email, "--force"]),
        s(&["review", "--reject", email]),
        s(&["review", "--accept", email]),
        s(&["review", "--show-to-agents", email]),
    ]
}

fn events(root: &Path) -> Vec<Value> {
    std::fs::read_to_string(root.join(".drift/review-log/log.jsonl"))
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

/// (a) Off, nothing is written and nothing printed changes: the same session with `--log`
/// prints byte for byte what it prints without, and leaves the same conventions.yaml; only
/// the logged repository has `.drift/review-log/`.
#[test]
fn off_writes_nothing_and_logging_changes_no_output() {
    let (off, auth, email) = repo();
    let (on, auth2, email2) = repo();
    assert_eq!((&auth, &email), (&auth2, &email2));
    let yaml0 = std::fs::read(off.path().join(".drift/conventions.yaml")).unwrap();
    for args in session(&auth, &email) {
        let a: Vec<&str> = args.iter().map(String::as_str).collect();
        let plain = run_env(off.path(), &a, &[]);
        let mut logged_args = a.clone();
        logged_args.push("--log");
        let logged = run_env(on.path(), &logged_args, &[]);
        assert!(plain.status.success(), "{a:?}: {plain:?}");
        assert_eq!(plain.status.code(), logged.status.code(), "{a:?}");
        assert_eq!(plain.stdout, logged.stdout, "{a:?}: stdout differs");
        assert_eq!(plain.stderr, logged.stderr, "{a:?}: stderr differs");
        assert_eq!(
            std::fs::read(off.path().join(".drift/conventions.yaml")).unwrap(),
            std::fs::read(on.path().join(".drift/conventions.yaml")).unwrap(),
            "{a:?}"
        );
        assert!(
            !off.path().join(".drift/review-log").exists(),
            "{a:?} created the log with logging off"
        );
    }
    assert!(on.path().join(".drift/review-log/log.jsonl").is_file());
    // A policy that never turned the log on has no `review_log` key, before or after.
    let yaml = std::fs::read_to_string(off.path().join(".drift/conventions.yaml")).unwrap();
    assert!(!yaml.contains("review_log"), "{yaml}");
    assert!(!String::from_utf8_lossy(&yaml0).contains("review_log"));
    // `--shown` records nothing while off, and says so.
    let out = drift(off.path(), &["review", "--shown", &auth]);
    assert!(out.contains("the review log is off"), "{out}");
    assert!(!off.path().join(".drift/review-log").exists());
    let out = run_env(off.path(), &["review", "--export-log", "x.json"], &[]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("no review log"));
    assert!(!off.path().join("x.json").exists());
}

/// On: each decision and each card shown is an event with the card's evidence, rank,
/// tier, family, admission decision and Drift's version; `drift init` keeps the setting;
/// turning it off writes the policy as it was.
#[test]
fn on_records_shown_cards_and_decisions() {
    let (dir, auth, email) = repo();
    let r = dir.path();
    let plain = std::fs::read(r.join(".drift/conventions.yaml")).unwrap();
    let out = drift(r, &["review", "--set-log", "on"]);
    assert!(out.contains("review log on"), "{out}");
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(yaml.contains("review_log: \"on\""), "{yaml}");
    assert!(!r.join(".drift/review-log").exists(), "nothing written yet");
    drift(r, &["init"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(
        yaml.contains("review_log: \"on\""),
        "init dropped it: {yaml}"
    );
    for args in session(&auth, &email) {
        let a: Vec<&str> = args.iter().map(String::as_str).collect();
        drift(r, &a);
    }
    // The Studio's runs say so.
    let out = run_env(
        r,
        &["review", "--shown", &email],
        &[("DRIFT_REVIEW_VIA", "studio")],
    );
    assert!(out.status.success(), "{out:?}");
    let ev = events(r);
    let decisions: Vec<(&str, &str)> = ev
        .iter()
        .map(|e| (e["decision"].as_str().unwrap(), e["id"].as_str().unwrap()))
        .collect();
    assert_eq!(
        decisions,
        [
            ("shown", auth.as_str()),
            ("shown", email.as_str()),
            ("shown", auth.as_str()),
            ("shown", email.as_str()),
            ("block", auth.as_str()),
            ("exempt", auth.as_str()),
            ("unexempt", auth.as_str()),
            ("advise", auth.as_str()),
            ("force_block", email.as_str()),
            ("reject", email.as_str()),
            ("accept", email.as_str()),
            ("show_to_agents", email.as_str()),
            ("shown", email.as_str()),
        ]
    );
    let first = &ev[0];
    assert_eq!(first["event"], "shown");
    assert_eq!(first["via"], "cli");
    assert_eq!(first["tier"], "default");
    assert_eq!(first["rule_kind"], "wrapped_by:call");
    assert_eq!(first["family"], "Call wrappers");
    assert_eq!(first["rank"], 1);
    assert_eq!(first["listed"], true);
    assert_eq!(first["evidence"]["holders"], 37);
    assert_eq!(first["evidence"]["total"], 40);
    assert_eq!(first["evidence"]["outliers"], 3);
    assert!(first["evidence"]["wilson"].as_f64().unwrap() > 0.7);
    assert!(first["evidence"]["lift"].as_f64().is_some());
    assert_eq!(first["outliers_now"], 3);
    // A default-tier card no one has accepted is a block candidate (decision D13): not
    // shown to agents when the person first sees it.
    assert_eq!(first["agents"]["shown"], false);
    assert_eq!(first["agents"]["reason"], "candidate");
    assert!(first["verify"].is_null(), "agents.verify is off");
    assert_eq!(first["drift"]["version"], env!("CARGO_PKG_VERSION"));
    assert!(first["drift"].get("commit").is_some());
    assert!(first["ts"].as_str().unwrap().ends_with('Z'));
    let sugg = &ev[1];
    assert_eq!(sugg["tier"], "suggestion");
    assert_eq!(sugg["rank"], 2);
    assert_eq!(sugg["agents"]["shown"], false, "{sugg}");
    let block = &ev[4];
    assert_eq!(block["before"]["status"], "proposed");
    assert_eq!(block["after"]["status"], "accepted");
    assert_eq!(block["after"]["mode"], "block");
    let exempt = &ev[5];
    assert_eq!(exempt["member"], "app/api/r38/route.ts#GET");
    assert_eq!(exempt["reason"], "health check, public by design");
    let force = &ev[8];
    assert_eq!(force["after"]["mode"], "block");
    // No family record of at least half of 10 labelled cards: the neutral Block.
    assert_eq!(force["block"], "neutral", "{force}");
    assert_eq!(
        force["agents"]["shown"], false,
        "as it stood before the block"
    );
    assert_eq!(ev[9]["after"]["status"], "rejected");
    let show = &ev[11];
    assert_eq!(show["after"]["shown_to_agents"], true);
    assert_eq!(ev[12]["via"], "studio");
    for e in &ev {
        let text = e.to_string();
        assert!(!text.contains("secret-product"), "{text}");
        assert!(
            !text.contains(&*r.to_string_lossy()),
            "the repository's path: {text}"
        );
    }
    // Off again: the policy is written as it was before (decisions aside), the log kept.
    drift(r, &["review", "--set-log", "off"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(!yaml.contains("review_log"), "{yaml}");
    let n = ev.len();
    drift(r, &["review", "--show", &auth]);
    assert_eq!(events(r).len(), n, "off records nothing");
    let _ = plain;
    let gi = std::fs::read_to_string(r.join(".drift/review-log/.gitignore")).unwrap();
    assert!(gi.lines().any(|l| l == "*"), "{gi}");
}

/// (b) The default export names no path, symbol, convention id, package or reason; with
/// `--include-paths` it does. Every event survives, with what the study reads.
#[test]
fn hashed_export_holds_no_raw_paths_or_symbols() {
    let (dir, auth, email) = repo();
    let r = dir.path();
    drift(r, &["review", "--set-log", "on"]);
    for args in session(&auth, &email) {
        let a: Vec<&str> = args.iter().map(String::as_str).collect();
        drift(r, &a);
    }
    let n = events(r).len();
    let out = drift(r, &["review", "--export-log", "study.json"]);
    assert!(out.contains(&format!("wrote {n} review events")), "{out}");
    let text = std::fs::read_to_string(r.join("study.json")).unwrap();
    let study: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(study["schema"], "drift-review-log");
    assert_eq!(study["schema_version"], 1);
    assert_eq!(study["include_paths"], false);
    assert_eq!(study["events"].as_array().unwrap().len(), n);
    let lower = text.to_lowercase();
    for raw in [
        auth.as_str(),
        email.as_str(),
        "app/",
        "src/",
        "lib/",
        "route.ts",
        ".tsx",
        "#get",
        "withauth",
        "basewrapper",
        "email",
        "secret-product",
        "health check",
        &r.to_string_lossy().to_lowercase(),
    ] {
        assert!(!lower.contains(raw), "{raw} in the hashed export: {text}");
    }
    let e0 = &study["events"][0];
    assert!(e0["id"].as_str().unwrap().starts_with("h:"), "{e0}");
    assert_eq!(e0["family"], "Call wrappers");
    assert_eq!(e0["evidence"]["holders"], 37);
    // The same card hashes the same way within one export (shown joins decided).
    let ids: std::collections::BTreeSet<&str> = study["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 2, "{ids:?}");
    let exempt = study["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["decision"] == "exempt")
        .unwrap();
    assert_eq!(exempt["reason_chars"], 30);
    assert!(exempt.get("reason").is_none());
    assert!(exempt["member"].as_str().unwrap().starts_with("h:"));
    // eval/study reads it: per family, the last verdict per card (the email card was
    // rejected, then accepted; the auth card blocked, then set back to advise).
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../eval/study/maintainer-log.mjs");
    match Command::new("node")
        .arg(&script)
        .arg("--json")
        .arg(r.join("study.json"))
        .output()
    {
        Ok(out) => {
            assert!(out.status.success(), "{out:?}");
            let s: Value = serde_json::from_slice(&out.stdout).unwrap();
            assert_eq!(s["repos"], 1, "{s}");
            assert_eq!(s["all"]["cards"], 2, "{s}");
            assert_eq!(s["all"]["accepted"], 2, "{s}");
            assert_eq!(s["by_tier"]["suggestion"]["decided"], 1, "{s}");
            // The default-tier card was a block candidate when decided (decision D13), the
            // suggestion below the bar: no card was shown to agents as the person found it.
            assert_eq!(s["agent_shown"]["decided"], 0, "{s}");
        }
        Err(e) => eprintln!("node not found ({e}): the study script is tested by node --test"),
    }
    // Asked for: as logged.
    drift(
        r,
        &["review", "--export-log", "raw.json", "--include-paths"],
    );
    let raw = std::fs::read_to_string(r.join("raw.json")).unwrap();
    assert!(raw.contains(&auth) && raw.contains("app/api/r38/route.ts#GET"));
    assert!(raw.contains("health check, public by design"));
    let rawv: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(rawv["repo"], study["repo"], "one repository, one token");
}

/// (c) Writers at once (the CLI and the Studio's runs of it): every line whole, none lost.
#[test]
fn concurrent_writers_do_not_corrupt_the_log() {
    let (dir, auth, email) = repo();
    let r = dir.path();
    drift(r, &["review", "--set-log", "on"]);
    let ids = format!("{auth},{email}");
    let children: Vec<_> = (0..12)
        .map(|i| {
            let mut cmd = Command::new(&*BIN);
            cmd.env("DRIFT_TEST_UNSHOWN", "1");
            cmd.args(["review", "--shown", &ids])
                .current_dir(r)
                .env_remove("DRIFT_CACHE_DIR");
            if i % 2 == 0 {
                cmd.env("DRIFT_REVIEW_VIA", "studio");
            }
            cmd.stdout(std::process::Stdio::null()).spawn().unwrap()
        })
        .collect();
    for mut c in children {
        assert!(c.wait().unwrap().success());
    }
    let text = std::fs::read_to_string(r.join(".drift/review-log/log.jsonl")).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 24, "{text}");
    for l in &lines {
        let v: Value = serde_json::from_str(l).unwrap_or_else(|e| panic!("{e}: {l}"));
        assert_eq!(v["decision"], "shown");
    }
    assert_eq!(text.matches("\"via\":\"studio\"").count(), 12);
}

/// Nothing is written through a link a repository planted at `.drift/review-log`.
#[cfg(unix)]
#[test]
fn never_logs_through_a_link() {
    let (dir, auth, _) = repo();
    let r = dir.path();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), r.join(".drift/review-log")).unwrap();
    let out = run_env(r, &["review", "--accept", &auth, "--log"], &[]);
    assert!(out.status.success(), "the decision is still made: {out:?}");
    assert!(String::from_utf8_lossy(&out.stderr).contains("review log was not written"));
    assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
}
