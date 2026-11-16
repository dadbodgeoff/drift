//! `drift check --diff-base` in a repository with no security baseline advises on
//! what the change adds that a baseline would hold: a new request entry point where
//! Drift found no guard, and one reaching an operation fed by the request. Under its
//! own heading, with how to settle it; never part of the exit code. A route whose
//! guard Drift cannot read, and a handler the base already had, are not said.
//!
//! Pins: before this, with no baseline `drift check` said nothing of security, so a
//! repository that had not written one was told nothing of a new open route.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
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

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
const UNGUARDED_EVAL: &str = "export async function POST(req: Request) {\n  const body = await req.text();\n  eval(body);\n  return Response.json({ ok: true });\n}\n";
const UNREAD_CHECK: &str = "import { requireMember } from \"@/lib/missing\";\n\nexport async function GET() {\n  await requireMember();\n  return Response.json({ ok: true });\n}\n";

/// Two open routes on `main`, conventions written, no security baseline; a `pr`
/// branch checked out.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "app/api/old/route.ts", UNGUARDED);
    write(r, "app/api/status/route.ts", UNGUARDED);
    write(r, ".gitignore", ".drift/cache/\n");
    let (code, _, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    assert!(!r.join(".drift/security.lock").exists());
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    // Added: an open route, one that evaluates what the request sent, one whose
    // check Drift cannot read; and the old route edited in place.
    write(r, "app/api/open/route.ts", UNGUARDED);
    write(r, "app/api/run/route.ts", UNGUARDED_EVAL);
    write(r, "app/api/unknown/route.ts", UNREAD_CHECK);
    write(r, "app/api/old/route.ts", &format!("// edited\n{UNGUARDED}"));
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "routes"]);
    dir
}

#[test]
fn with_no_baseline_a_change_is_advised_on_and_never_failed() {
    let dir = repo();
    let r = dir.path();

    let (code, text, err) = drift(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 0, "{text}{err}");
    assert!(
        text.contains("\nSecurity advice: what this change adds (no security baseline; this does not fail the check)\n"),
        "{text}"
    );
    assert!(
        text.contains("\n  New request entry points where Drift found no guard\n    app/api/open/route.ts#GET GET /api/open  (app/api/open/route.ts:1): "),
        "{text}"
    );
    assert!(
        text.contains("\n    app/api/run/route.ts#POST POST /api/run  (app/api/run/route.ts:1): "),
        "{text}"
    );
    assert!(
        text.contains("\n      reaches eval (fed by the request)\n"),
        "{text}"
    );
    assert!(
        text.contains("\n  To settle one: add the guard or the check it lacks, or accept what the repository has with `drift security --write-baseline` (commit .drift/security.lock); `drift check` then reports only what is new.\n"),
        "{text}"
    );
    // Unknown is no advice, and a handler the base had is not the change's.
    assert!(!text.contains("app/api/unknown/route.ts#GET"), "{text}");
    assert!(!text.contains("app/api/old/route.ts#GET"), "{text}");

    let (code, out, err) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert!(v.get("security").is_none(), "{v:#}");
    let advice: Vec<(&str, &str)> = v["security_advice"]
        .as_array()
        .unwrap_or_else(|| panic!("{v:#}"))
        .iter()
        .map(|a| (a["kind"].as_str().unwrap(), a["at"].as_str().unwrap()))
        .collect();
    assert_eq!(
        advice,
        [
            ("no-guard", "app/api/open/route.ts:1"),
            ("unguarded-reaching", "app/api/run/route.ts:1"),
        ],
        "{v:#}"
    );

    // Once a baseline is written, the baseline speaks and the advice is not said.
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let (_, text, _) = drift(r, &["check", "--diff-base", "main"]);
    assert!(!text.contains("Security advice:"), "{text}");
}
