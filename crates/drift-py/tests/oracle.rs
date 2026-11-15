//! The importlib oracle (eval/oracle-py/oracle.py) agrees with Drift on every
//! fixture. Needs `python3` 3.11 or later (for `tomllib`) on PATH and fails without
//! it; set `DRIFT_SKIP_ORACLE=1` to skip it deliberately.

use std::io::Write;
use std::path::Path;
use std::process::Command;

use drift_py::{ScanOptions, debug_imports, scan};

fn python() -> Option<&'static str> {
    let ok = Command::new("python3")
        .args(["-c", "import sys, tomllib; sys.exit(0)"])
        .status()
        .is_ok_and(|s| s.success());
    ok.then_some("python3")
}

#[test]
fn oracle_agrees_on_fixtures() {
    if std::env::var_os("DRIFT_SKIP_ORACLE").is_some() {
        eprintln!("DRIFT_SKIP_ORACLE is set: skipping the oracle test");
        return;
    }
    let py = python().expect("python3 >= 3.11 is needed (or set DRIFT_SKIP_ORACLE=1)");
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let oracle = manifest.join("../../eval/oracle-py/oracle.py");
    for name in [
        "fastapi-app",
        "flask-app",
        "django-project",
        "pkg-relative",
        "signals",
        "import-edge-cases",
        "import-case",
    ] {
        let root = manifest.join("tests/fixtures").join(name);
        let tmp = tempfile::tempdir().unwrap();
        let imports = tmp.path().join("imports.jsonl");
        let mut f = std::fs::File::create(&imports).unwrap();
        for row in debug_imports(&root).unwrap() {
            writeln!(f, "{}", serde_json::to_string(&row).unwrap()).unwrap();
        }
        let facts = tmp.path().join("facts.json");
        let r = scan(&root, &ScanOptions::default()).unwrap().0;
        std::fs::write(&facts, serde_json::to_vec(&r).unwrap()).unwrap();
        let report = tmp.path().join("report.json");
        let out = Command::new(py)
            .arg("-I")
            .arg(&oracle)
            .arg(&root)
            .arg(&imports)
            .arg(&facts)
            .arg("--json")
            .arg(&report)
            .current_dir(tmp.path())
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let v: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&report).unwrap()).unwrap();
        let cats = v["imports"]["categories"].as_object().unwrap();
        let bad: Vec<_> = cats
            .iter()
            .filter(|(k, _)| k.starts_with("DISAGREE") || k.starts_with("GAP"))
            .collect();
        assert!(
            bad.is_empty(),
            "{name}: {bad:?}\n{}",
            String::from_utf8_lossy(&out.stdout)
        );
        let s = &v["symbols"];
        assert_eq!(s["missing"], 0, "{name}: {}", v["symbol_examples"]);
        assert_eq!(
            s["exports_python"], s["exports_matched"],
            "{name}: {}",
            v["symbol_examples"]
        );
    }
}
