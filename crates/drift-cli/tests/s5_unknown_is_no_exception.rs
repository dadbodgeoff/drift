//! Unknown is never a finding of the security baseline: an entry point whose guard
//! Drift cannot read is no exception of a guard its siblings share, and no new entry
//! point "without a guard" in `--diff-base`. It is listed apart, as guard unknown.
//!
//! Pins: before this, `guard_gaps` listed every member lacking the guard, the
//! unreadable ones included (a `guard-gap` line of the baseline, a failure of
//! `--fail-on guard-gap`), and `regressions` kept them in `added_without_guard`
//! (`--fail-on no-guard`).

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

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
/// A check Drift cannot read: what it calls is in no file of the repository.
const UNREAD_CHECK: &str = "import { requireMember } from \"@/lib/missing\";\n\nexport async function GET() {\n  await requireMember();\n  return Response.json({ ok: true });\n}\n";

/// 39 routes wrapped in `withAuth`, on `main`, and a `pr` branch checked out.
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
    write(
        r,
        "lib/auth.ts",
        "import { TRPCError } from \"@trpc/server\";\n\nexport function withAuth<T>(h: T): T {\n  if (!(globalThis as any).user) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return h;\n}\n",
    );
    for i in 0..39 {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
    }
    write(r, ".gitignore", ".drift/cache/\n");
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    dir
}

#[test]
fn a_guard_that_cannot_be_read_is_no_exception_of_a_shared_guard() {
    let dir = repo();
    let r = dir.path();
    write(r, "app/api/open/route.ts", UNGUARDED);
    write(r, "app/api/unknown/route.ts", UNREAD_CHECK);

    let (code, out, err) = drift(r, &["security", "--json"]);
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let gap = v["guard_gaps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["guard"] == "withAuth")
        .unwrap_or_else(|| panic!("no withAuth gap: {v:#}"))
        .clone();
    let paths = |k: &str| -> Vec<String> {
        gap[k]
            .as_array()
            .into_iter()
            .flatten()
            .map(|e| e["path"].as_str().unwrap().to_string())
            .collect()
    };
    // The one with no guard found is an exception; the unreadable one is not.
    assert_eq!(paths("exceptions"), ["app/api/open/route.ts"], "{gap:#}");
    assert_eq!(paths("unknown"), ["app/api/unknown/route.ts"], "{gap:#}");

    // The text lists it apart, said so.
    let (_, text, _) = drift(r, &["security"]);
    assert!(
        text.contains("guard unknown, not exceptions (1): app/api/unknown/route.ts:3"),
        "{text}"
    );

    // The baseline holds no finding of it.
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    assert!(
        lock.contains("guard-gap\tapp/api/open/route.ts#GET GET /api/open lacks withAuth"),
        "{lock}"
    );
    assert!(!lock.contains("app/api/unknown/"), "{lock}");
}

#[test]
fn a_new_route_whose_guard_cannot_be_read_fails_no_diff() {
    let dir = repo();
    let r = dir.path();
    write(r, "app/api/unknown/route.ts", UNREAD_CHECK);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "unknown"]);

    // Asked to fail on a new route with no guard, or lacking the shared one: the
    // change adds neither.
    let (code, out, err) = drift(
        r,
        &[
            "security",
            "--diff-base",
            "main",
            "--json",
            "--fail-on",
            "no-guard,guard-gap",
        ],
    );
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["added_without_guard"], serde_json::json!([]), "{v:#}");
    assert_eq!(v["guard_gaps"], serde_json::json!([]), "{v:#}");
    assert_eq!(
        v["guard_unknown"][0]["path"], "app/api/unknown/route.ts",
        "{v:#}"
    );

    let (_, text, _) = drift(r, &["security", "--diff-base", "main"]);
    assert!(
        text.contains("\nNew entry points whose guard is unknown (Drift could not read what may be one; not findings)\n  app/api/unknown/route.ts:3 GET /api/unknown [http]: guard unknown"),
        "{text}"
    );
    assert!(
        !text.contains("\nNew entry points where Drift found no guard\n"),
        "{text}"
    );
}
