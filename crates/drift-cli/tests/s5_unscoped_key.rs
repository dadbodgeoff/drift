//! The baseline kind `unscoped-key` (an entry point that signs the caller in, takes
//! a tenant or owner key from the request and runs nothing that checks it) advises
//! unless the person sets it to fail: a new baseline's `# fail:` line leaves it out,
//! `--write-baseline --fail-on unscoped-key` puts it in, and writing the baseline
//! again keeps what the person chose.
//!
//! Pins: the kind's fail mechanics. What finds an unscoped key is the practice map's
//! (`UnitRow::unscoped`); the findings themselves are pinned where that is read.

use std::path::Path;
use std::process::Command;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// The kinds the lock's `# fail:` line names.
fn fail_line(root: &Path) -> Vec<String> {
    let lock = std::fs::read_to_string(root.join(".drift/security.lock")).unwrap();
    lock.lines()
        .find_map(|l| l.strip_prefix("# fail: "))
        .unwrap_or_else(|| panic!("no fail line: {lock}"))
        .split(',')
        .map(str::to_string)
        .collect()
}

#[test]
fn an_unscoped_key_advises_until_the_person_sets_it_to_fail() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "app/api/a/route.ts",
        "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n",
    );

    // A new baseline: every kind fails but this one.
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let fail = fail_line(r);
    assert!(fail.iter().any(|k| k == "no-guard"), "{fail:?}");
    assert!(fail.iter().any(|k| k == "guard-gap"), "{fail:?}");
    assert!(!fail.iter().any(|k| k == "unscoped-key"), "{fail:?}");

    // The person sets it to fail; the message no longer says it advises.
    let (code, out, err) = drift(
        r,
        &["security", "--write-baseline", "--fail-on", "unscoped-key"],
    );
    assert_eq!(code, 0, "{err}");
    assert!(fail_line(r).iter().any(|k| k == "unscoped-key"));
    // The kinds that still advise are named; this one is no longer among them.
    let advising = out
        .split("appears")
        .nth(1)
        .and_then(|rest| rest.lines().next())
        .unwrap_or_default();
    assert!(!advising.contains("unscoped-key"), "{out}");

    // Written again with no `--fail-on`: the choice is kept.
    let (code, _, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    assert!(fail_line(r).iter().any(|k| k == "unscoped-key"));

    // `public` is no kind of the baseline.
    let (code, _, _) = drift(r, &["security", "--write-baseline", "--fail-on", "public"]);
    assert_ne!(code, 0);

    // Nothing new: the ratchet holds.
    let (code, out, err) = drift(r, &["security", "--ratchet"]);
    assert_eq!(code, 0, "{out}{err}");
}
