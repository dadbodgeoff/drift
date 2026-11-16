//! Stream S8, audit 6 G4: old debt stays old under ordinary work, and new debt is new.
//!
//! - A lock line was keyed only on `path#symbol`, so moving a file with a baselined
//!   violation made it a new, blocking one (audit 6 §2.5). Lines now carry a
//!   fingerprint of the unit beside them, and the baseline matches on either.
//! - `drift init` re-baselined every convention that had no lock line left, so fixing
//!   all of a rule's old debt made the next `init` accept any new violation silently.
//!   Only a convention new to the policy is baselined now.

use std::path::Path;
use std::process::Command;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str]) -> (Option<i32>, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (out.status.code(), String::from_utf8(out.stdout).unwrap())
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out) = run(root, args);
    assert_eq!(code, Some(0), "{args:?} failed: {out}");
    out
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// Routes wrapped in `withAuth` but three (`r37`..`r39`, baselined by the first
/// `init`), that convention accepted in block mode. Returns its id.
fn blocking_repo() -> (tempfile::TempDir, String) {
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
    (dir, id)
}

fn lock(r: &Path) -> String {
    std::fs::read_to_string(r.join("drift.lock")).unwrap()
}

/// Pins: a baselined handler whose file moved is still baselined (before: a new
/// block-mode violation and exit 1); one lock line covers one moved violation, so a
/// second copy of the same code is new.
#[test]
fn a_moved_file_keeps_its_baseline() {
    let (dir, id) = blocking_repo();
    let r = dir.path();
    let text = lock(r);
    assert!(
        text.lines().any(
            |l| l.starts_with(&format!("#~ {id} ")) && l.ends_with(" app/api/r39/route.ts#GET")
        ),
        "the first init writes the fingerprint line, as a comment (F2):\n{text}"
    );
    assert_eq!(run(r, &["check"]).0, Some(0));
    std::fs::create_dir_all(r.join("app/api/moved")).unwrap();
    std::fs::rename(
        r.join("app/api/r39/route.ts"),
        r.join("app/api/moved/route.ts"),
    )
    .unwrap();
    std::fs::remove_dir(r.join("app/api/r39")).unwrap();
    let (code, out) = run(r, &["check"]);
    assert_eq!(code, Some(0), "the moved debt is old debt:\n{out}");
    // Its old line is not "fixed": the debt is still there.
    let json = drift(r, &["check", "--format", "json"]);
    let report: serde_json::Value = serde_json::from_str(&json).unwrap();
    let fixed: Vec<&str> = report["fixed"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|f| f.as_str())
        .collect();
    assert!(
        !fixed.iter().any(|f| f.contains("app/api/r39/")),
        "{fixed:?}"
    );
    // A copy of the same handler is new. Which of two identical handlers is the one
    // that moved cannot be told, so neither is taken for it (F2: before, the first was
    // baselined and the other reported).
    write(r, "app/api/copy/route.ts", UNGUARDED);
    let (code, out) = run(r, &["check"]);
    assert_eq!(code, Some(1), "{out}");
    let (_, json) = run(r, &["check", "--format", "json"]);
    let report: serde_json::Value = serde_json::from_str(&json).unwrap();
    let baselined: Vec<bool> = report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| {
            let p = v["path"].as_str().unwrap_or_default();
            p == "app/api/copy/route.ts" || p == "app/api/moved/route.ts"
        })
        .map(|v| v["baselined"].as_bool().unwrap())
        .collect();
    assert_eq!(baselined.len(), 2, "{json}");
    assert_eq!(baselined.iter().filter(|b| **b).count(), 0, "{json}");
}

/// Pins: once every line of a rule's old debt is fixed and pruned, the next `drift init`
/// does not baseline a violation written since (before: it did, and the check passed).
#[test]
fn a_fixed_rule_is_not_baselined_again() {
    let (dir, id) = blocking_repo();
    let r = dir.path();
    for i in 37..40 {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
    }
    // The fixed lines pruned, as a person does once `drift check` lists them fixed.
    let kept: String = lock(r)
        .lines()
        .filter(|l| !l.starts_with(&id))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(r.join("drift.lock"), kept).unwrap();
    assert_eq!(run(r, &["check"]).0, Some(0));
    write(r, "app/api/n1/route.ts", UNGUARDED);
    drift(r, &["init"]);
    let text = lock(r);
    assert!(!text.contains("app/api/n1/"), "{text}");
    let (code, out) = run(r, &["check"]);
    assert_eq!(code, Some(1), "{out}");
    assert!(out.contains("app/api/n1/route.ts"), "{out}");
}

/// Pins: a lock written before fingerprints works as it did, and the next `drift init`
/// adds the fingerprint lines of the members it already baselines (and nothing else),
/// after which a move keeps the baseline.
#[test]
fn an_old_lock_gains_fingerprints_at_the_next_init() {
    let (dir, id) = blocking_repo();
    let r = dir.path();
    let old: String = lock(r)
        .lines()
        .filter(|l| !l.starts_with("#~"))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(r.join("drift.lock"), &old).unwrap();
    assert_eq!(run(r, &["check"]).0, Some(0), "an old lock works unchanged");
    let members = |t: &str| {
        t.lines()
            .filter(|l| l.starts_with(&format!("{id} ")))
            .count()
    };
    drift(r, &["init"]);
    let text = lock(r);
    assert_eq!(members(&text), members(&old), "{text}");
    assert!(
        text.lines().any(
            |l| l.starts_with(&format!("#~ {id} ")) && l.ends_with(" app/api/r38/route.ts#GET")
        ),
        "{text}"
    );
    std::fs::create_dir_all(r.join("app/api/elsewhere")).unwrap();
    std::fs::rename(
        r.join("app/api/r38/route.ts"),
        r.join("app/api/elsewhere/route.ts"),
    )
    .unwrap();
    std::fs::remove_dir(r.join("app/api/r38")).unwrap();
    let (code, out) = run(r, &["check"]);
    assert_eq!(code, Some(0), "{out}");
}
