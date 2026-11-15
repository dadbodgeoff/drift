//! `drift review` as a review surface: each card lists its outliers (path:line and
//! symbol, capped, `--all-outliers` for every one), and a reviewer can mark one fine
//! ("fine because…", `--exempt`), which `drift check` then lists as exempt instead of
//! as a violation, and nothing else changes.

use std::path::Path;
use std::process::{Command, Output};

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

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = run(root, args);
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

fn refused(root: &Path, args: &[&str], why: &str) {
    let before = std::fs::read(root.join(".drift/conventions.yaml")).unwrap();
    let out = run(root, args);
    let err = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(2), "{args:?}: {out:?}");
    assert!(err.contains(why), "{args:?}: {err}");
    assert_eq!(
        std::fs::read(root.join(".drift/conventions.yaml")).unwrap(),
        before,
        "{args:?} changed the policy"
    );
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// 40 routes, 37 wrapped in `withAuth`, that convention in block mode; then 4 new
/// routes without it (7 outliers: 3 legacy, 4 new).
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
        let body = if i < 37 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/r{i:02}/route.ts"), body);
    }
    for i in 0..30 {
        let body = format!("export function h{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/h{i:02}.ts"), &body);
    }
    drift(r, &["init"]);
    let census: serde_json::Value = serde_json::from_str(&drift(r, &["census", "--json"])).unwrap();
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
    for name in ["new", "ping", "status", "zeta"] {
        write(r, &format!("app/api/{name}/route.ts"), UNGUARDED);
    }
    (dir, id)
}

#[test]
fn review_cards_list_outliers_capped() {
    let (dir, id) = repo();
    let r = dir.path();
    let card = drift(r, &["review", "--show", &id]);
    assert!(card.contains("  outliers: 7 in the code now"), "{card}");
    assert!(card.contains("    app/api/new/route.ts:1 GET\n"), "{card}");
    assert!(
        card.contains("    app/api/r37/route.ts:1 GET  (legacy, in drift.lock)"),
        "{card}"
    );
    let listed = card
        .lines()
        .filter(|l| l.contains("route.ts:1 GET"))
        .count();
    assert_eq!(listed, 5, "{card}");
    assert!(
        card.contains(&format!(
            "    +2 more: `drift review --show {id} --all-outliers` lists them all"
        )),
        "{card}"
    );
    assert!(
        card.contains(&format!(
            "fine because...: `drift review --exempt {id} --member app/api/new/route.ts#GET --reason \"<why>\"`"
        )),
        "{card}"
    );
    let all = drift(r, &["review", "--show", &id, "--all-outliers"]);
    assert_eq!(
        all.lines().filter(|l| l.contains("route.ts:1 GET")).count(),
        7,
        "{all}"
    );
    assert!(!all.contains("more: `drift review"), "{all}");
    // Showing changes nothing.
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    drift(r, &["review", "--list"]);
    assert_eq!(
        std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap(),
        yaml
    );
    refused(r, &["review", "--list", "--accept", &id], "each go alone");
    refused(r, &["review", "--show", "D-000000"], "unknown convention");
}

#[test]
fn a_member_marked_fine_is_exempt_and_nothing_else_changes() {
    let (dir, id) = repo();
    let r = dir.path();
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(!yaml.contains("exceptions"), "{yaml}");
    let before = run(r, &["check", "--format", "json"]);
    assert_eq!(before.status.code(), Some(1), "4 new blocking violations");
    let before: serde_json::Value = serde_json::from_slice(&before.stdout).unwrap();

    // Refused, nothing written: not an outlier, no reason, a reason too long, a bad member.
    refused(
        r,
        &[
            "review",
            "--exempt",
            &id,
            "--member",
            "app/api/r00/route.ts#GET",
            "--reason",
            "x",
        ],
        "is not an outlier of",
    );
    refused(
        r,
        &[
            "review",
            "--exempt",
            &id,
            "--member",
            "app/api/ping/route.ts#GET",
            "--reason",
            "  ",
        ],
        "give a reason",
    );
    let long = "x".repeat(121);
    refused(
        r,
        &[
            "review",
            "--exempt",
            &id,
            "--member",
            "app/api/ping/route.ts#GET",
            "--reason",
            &long,
        ],
        "keep it to 120",
    );
    refused(
        r,
        &[
            "review",
            "--exempt",
            &id,
            "--member",
            "../ping/route.ts#GET",
            "--reason",
            "x",
        ],
        "expected a member as path#symbol",
    );

    // A reason that reads like a flag is a value with `=` (as the Studio passes it).
    let out = drift(
        r,
        &[
            "review",
            &format!("--exempt={id}"),
            "--member=app/api/ping/route.ts#GET",
            "--reason=--accept `public` health   check",
        ],
    );
    assert!(
        out.contains("app/api/ping/route.ts#GET marked fine"),
        "{out}"
    );
    let marked = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(
        marked.contains("  exceptions:\n  - member: app/api/ping/route.ts#GET\n    reason: --accept `public` health check\n"),
        "{marked}"
    );

    let after = run(r, &["check", "--format", "json"]);
    assert_eq!(after.status.code(), Some(1), "3 others still block");
    let after: serde_json::Value = serde_json::from_slice(&after.stdout).unwrap();
    let paths = |v: &serde_json::Value| -> Vec<String> {
        v["violations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["path"].as_str().unwrap().to_string())
            .collect()
    };
    let mut expect = paths(&before);
    expect.retain(|p| p != "app/api/ping/route.ts");
    assert_eq!(paths(&after), expect);
    let exempt: Vec<_> = after["exempt"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["code"] == "reviewed")
        .collect();
    assert_eq!(exempt.len(), 1, "{after}");
    assert_eq!(exempt[0]["path"], "app/api/ping/route.ts");
    assert_eq!(
        exempt[0]["reason"],
        "marked fine by a reviewer: --accept 'public' health check"
    );
    // The convention's tier and mode are what they were.
    assert_eq!(after["conventions"], before["conventions"]);

    // The card says so; the other new routes still fail the check in text.
    let card = drift(r, &["review", "--show", &id]);
    assert!(
        card.contains("  marked fine by a reviewer: 1\n    app/api/ping/route.ts#GET: --accept `public` health check\n"),
        "{card}"
    );
    assert!(card.contains("  outliers: 6 in the code now"), "{card}");

    // Agents read it only where they already read Drift's exemptions: drift_explain's
    // "left out now" (and check's exempt note), sanitised and capped.
    let input = format!(
        "{}\n",
        serde_json::json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_explain","arguments":{"id": id}}})
    );
    let out = Command::new(&*BIN)
        .args(["mcp"])
        .current_dir(r)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut c| {
            use std::io::Write;
            c.stdin.take().unwrap().write_all(input.as_bytes())?;
            c.wait_with_output()
        })
        .unwrap();
    let reply: serde_json::Value = serde_json::from_str(
        String::from_utf8(out.stdout)
            .unwrap()
            .lines()
            .next()
            .unwrap(),
    )
    .unwrap();
    let explain = reply["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        explain.contains(
            "app/api/ping/route.ts:1 GET (marked fine by a reviewer: --accept 'public' health check)"
        ),
        "{explain}"
    );

    // Undo: the file is as it was before, byte for byte.
    drift(
        r,
        &[
            "review",
            "--unexempt",
            &id,
            "--member",
            "app/api/ping/route.ts#GET",
        ],
    );
    assert_eq!(
        std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap(),
        yaml
    );
    refused(
        r,
        &[
            "review",
            "--unexempt",
            &id,
            "--member",
            "app/api/ping/route.ts#GET",
        ],
        "has no exception",
    );

    // Marking all four new routes fine: the check passes, the legacy ones stay legacy.
    for name in ["new", "ping", "status", "zeta"] {
        drift(
            r,
            &[
                "review",
                "--exempt",
                &id,
                "--member",
                &format!("app/api/{name}/route.ts#GET"),
                "--reason",
                "public by design",
            ],
        );
    }
    let out = run(r, &["check"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{text}");
    assert!(
        text.contains("no new violations (3 legacy, baselined)"),
        "{text}"
    );
    assert!(!text.contains("lock entries are fixed"), "{text}");
}
