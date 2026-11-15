//! Smoke test against a real repository: `DRIFT_SMOKE_REPO=/path/to/repo cargo test -p drift-ts --release -- --ignored`.

use std::time::Instant;

use drift_ts::{ScanOptions, scan};

#[test]
#[ignore = "needs DRIFT_SMOKE_REPO pointing at a real checkout"]
fn real_repo_scans_cleanly() {
    let Ok(repo) = std::env::var("DRIFT_SMOKE_REPO") else {
        return;
    };
    let started = Instant::now();
    let (facts, stats) = scan(repo.as_ref(), &ScanOptions::default()).expect("scan");
    let secs = started.elapsed().as_secs_f64();
    let imports: Vec<_> = facts.files.iter().flat_map(|f| &f.imports).collect();
    let unresolved = imports
        .iter()
        .filter(|i| i.module.starts_with("unresolved:"))
        .count();
    eprintln!(
        "{} files, {} parse errors, {} imports ({} unresolved) in {secs:.2}s",
        stats.files,
        stats.parse_errors,
        imports.len(),
        unresolved
    );
    assert!(stats.files > 0);
    assert!(
        unresolved * 100 <= imports.len(),
        "more than 1% of imports unresolved"
    );
}
