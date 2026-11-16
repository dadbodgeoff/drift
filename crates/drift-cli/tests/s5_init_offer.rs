//! `drift init` ends by saying what a security baseline would hold and the one
//! command that writes it, and writes nothing; `--write-baseline` says what fails
//! from then on and which kinds only advise.
//!
//! Pins: before this, `drift init` never spoke of the baseline, so the security half
//! of `drift check` stayed off in every repository that had not found the flag.

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

const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

#[test]
fn init_offers_the_baseline_and_writes_none() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    for d in ["a", "b", "c"] {
        write(r, &format!("app/api/{d}/route.ts"), UNGUARDED);
    }

    let (code, out, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    assert!(
        out.contains("\nSecurity baseline: none yet. It would hold 3 findings (3 no-guard), accepted as they are; new ones are reported by `drift check`. `drift security --write-baseline` writes it (.drift/security.lock); nothing was written.\n"),
        "{out}"
    );
    assert!(
        out.contains("\n  drift security --write-baseline accept the 3 security findings as they are; `drift check` then reports new ones\n"),
        "{out}"
    );
    assert!(!r.join(".drift/security.lock").exists());

    let (code, out, err) = drift(r, &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    assert!(
        out.contains("\nCommit it. While it exists, `drift check` (every run over the repository, with or without accepted conventions; not a run given files to check) and `drift security --ratchet` exit 1 when a finding that is not in it appears, except of unscoped-key, which advise (`--write-baseline --fail-on <kind>` sets a kind to fail).\n"),
        "{out}"
    );
    assert!(!out.contains("where the project has conventions"), "{out}");

    // With a baseline, init offers nothing.
    let (code, out, err) = drift(r, &["init"]);
    assert_eq!(code, 0, "{err}");
    assert!(!out.contains("Security baseline: none yet"), "{out}");
    assert!(!out.contains("drift security --write-baseline"), "{out}");
}
