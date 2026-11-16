//! The security baseline says which inventory wrote it, and `drift check` fails only
//! on what is the change's: a baseline with no stamp is read as the first inventory
//! (its kinds fail as they did), and against a diff an entry point lacking a shared
//! guard in a file the change did not touch fails nothing (other entry points gained
//! the guard, so the share crossed the line).
//!
//! Pins: before this, the lock had no version, so a finding of a kind newer than the
//! lock failed every pull request; and `drift check --diff-base` failed a change that
//! only added guarded routes, for the old routes it made exceptions.

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

/// A Next.js app with `guarded` routes wrapped in `withAuth` and `open` with none.
fn app(r: &Path, guarded: usize, open: usize) {
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
    for i in 0..guarded {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
    }
    for i in 0..open {
        write(r, &format!("app/api/u{i}/route.ts"), UNGUARDED);
    }
    write(r, ".gitignore", ".drift/cache/\n");
}

#[test]
fn a_baseline_with_no_stamp_is_the_first_inventory_and_fails_as_it_did() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r, 0, 2);
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    // The stamp, after the comment lines and before the findings.
    assert!(lock.contains("\n# inventory: 2\n# fail: "), "{lock}");
    assert!(lock.contains("no-guard\tapp/api/u0/route.ts#GET GET /api/u0\n"), "{lock}");

    // The same findings with the header an older Drift wrote: nothing is new.
    let old: String = lock
        .lines()
        .filter(|l| !l.starts_with("# inventory:") && !l.starts_with("# fail:"))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(r.join(".drift/security.lock"), &old).unwrap();
    let (code, out, err) = drift(r, &["security", "--ratchet"]);
    assert_eq!(code, 0, "{out}{err}");

    // A finding of a kind whose reading this Drift widened (`no-guard`) is not one
    // the first inventory would have found as it is found now: against it, it is
    // listed and fails nothing (F3, review R3: the upgrade must not fail CI).
    write(r, "app/api/u9/route.ts", UNGUARDED);
    let (code, out, _) = drift(r, &["security", "--ratchet"]);
    assert_eq!(code, 0, "{out}");
    assert!(out.contains("1 finding(s) come from readings newer than this baseline"), "{out}");
    assert!(out.contains("  app/api/u9/route.ts#GET GET /api/u9  (app/api/u9/route.ts:1)\n"), "{out}");
    // Written again, the baseline is of this inventory, and a new one fails.
    std::fs::remove_file(r.join("app/api/u9/route.ts")).unwrap();
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    write(r, "app/api/u9/route.ts", UNGUARDED);
    let (code, out, _) = drift(r, &["security", "--ratchet"]);
    assert_eq!(code, 1, "{out}");
    assert!(out.contains("[no-guard]\n  app/api/u9/route.ts#GET GET /api/u9  (app/api/u9/route.ts:1)\n"), "{out}");
    assert!(!out.contains("readings newer than this baseline"), "{out}");
}

#[test]
fn a_guard_gap_the_change_did_not_touch_fails_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    // 30 of 34 routes wrapped: under the share, so no route lacks a shared guard.
    app(r, 30, 4);
    let (code, _, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    assert!(!lock.contains("guard-gap\t"), "{lock}");
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);

    // Ten wrapped routes added: 40 of 44, over the share; the four old open routes
    // now lack it, in files the change did not touch.
    for i in 30..40 {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
    }
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "more"]);

    let (code, out, err) = drift(r, &["check", "--diff-base", "main", "--format", "json"]);
    assert_eq!(code, 0, "{out}{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["security"]["added"], serde_json::json!({}), "{v:#}");
    let outside: Vec<&str> = v["security"]["outside_change"]["guard-gap"]
        .as_array()
        .unwrap_or_else(|| panic!("{v:#}"))
        .iter()
        .map(|a| a["at"].as_str().unwrap())
        .collect();
    assert_eq!(
        outside,
        [
            "app/api/u0/route.ts:1",
            "app/api/u1/route.ts:1",
            "app/api/u2/route.ts:1",
            "app/api/u3/route.ts:1"
        ],
        "{v:#}"
    );

    let (code, text, _) = drift(r, &["check", "--diff-base", "main"]);
    assert_eq!(code, 0, "{text}");
    assert!(
        text.contains("[guard-gap] in files this change did not touch: other entry points gained the guard, so these are not this change's; they fail nothing\n"),
        "{text}"
    );

    // Without a diff the same findings are not in the baseline, and fail.
    let (code, out, _) = drift(r, &["security", "--ratchet"]);
    assert_eq!(code, 1, "{out}");
}
