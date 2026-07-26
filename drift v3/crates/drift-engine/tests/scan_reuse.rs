use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::Value;
use sha2::{Digest, Sha256};

/// T15: incremental reuse must refuse facts produced by a different engine version.
///
/// Reuse is keyed on file content, which assumes a given file always yields the same facts.
/// Every extraction change breaks that assumption - T12 stopped emitting type-only imports and
/// T13 narrowed data-layer matching - so without a version gate, upgrading Drift and rescanning
/// would silently keep the old facts for every unchanged file. Stale analysis presented as
/// current is precisely the failure mode this project exists to prevent, so this fails closed:
/// an absent or mismatched version means reparse.
#[test]
fn refuses_reuse_from_a_different_engine_version() {
    let dir = tempfile::tempdir().expect("tempdir");
    let route_dir = dir.path().join("app/api/a");
    fs::create_dir_all(&route_dir).expect("route dir");
    let source = "export const x = 1;\n";
    fs::write(route_dir.join("route.ts"), source).expect("write route");
    fs::write(dir.path().join("package.json"), "{\"name\":\"t\"}").expect("manifest");

    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    let content_hash = format!("{:x}", hasher.finalize());

    let manifest_json = |engine_version: Option<&str>| {
        let mut manifest = serde_json::json!({
            "schema_version": "engine.reuse_manifest.v1",
            "previous_scan_id": "scan_prev",
            "file_snapshots": [{
                "file_path": "app/api/a/route.ts",
                "content_hash": content_hash,
                "byte_size": source.len(),
                "indexed": true
            }],
            // A fact that plain reparsing could never produce, so its presence proves reuse.
            "facts": [{
                "kind": "import_used",
                "file_path": "app/api/a/route.ts",
                "name": "STALE_FACT",
                "value": "@/stale",
                "start_line": 1,
                "end_line": 1
            }]
        });
        if let Some(version) = engine_version {
            manifest["engine_version"] = Value::String(version.to_string());
        }
        manifest.to_string()
    };

    let same = dir.path().join("same.json");
    let different = dir.path().join("different.json");
    let absent = dir.path().join("absent.json");
    fs::write(&same, manifest_json(Some(drift_engine::DRIFT_ENGINE_VERSION))).expect("same");
    fs::write(&different, manifest_json(Some("9.9.9-different"))).expect("different");
    fs::write(&absent, manifest_json(None)).expect("absent");

    // Matching version: reuse applies, so the planted fact survives.
    let reused = scan(dir.path(), &same);
    assert!(
        has_stale_fact(&reused),
        "a matching engine version should reuse stored facts"
    );
    assert_eq!(reused["stats"]["reuse_applied"], Value::Bool(true));

    // Different version: must reparse, so the planted fact is gone.
    let reparsed = scan(dir.path(), &different);
    assert!(
        !has_stale_fact(&reparsed),
        "facts from another engine version must never be reused"
    );
    assert_eq!(reparsed["stats"]["reuse_applied"], Value::Bool(false));

    // Absent version means unknown provenance, which is also not reusable.
    let unknown = scan(dir.path(), &absent);
    assert!(
        !has_stale_fact(&unknown),
        "a manifest without an engine version must not be reused"
    );
    assert_eq!(unknown["stats"]["reuse_applied"], Value::Bool(false));
}

fn scan(repo_root: &Path, manifest: &Path) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            repo_root.to_str().expect("utf8 temp dir"),
            "--format",
            "json",
            "--repo-id",
            "repo_reuse",
            "--scan-id",
            "scan_reuse",
            "--reuse-manifest",
            manifest.to_str().expect("utf8 manifest path"),
        ])
        .output()
        .expect("run drift-engine");
    assert!(
        output.status.success(),
        "engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("scan output json")
}

fn has_stale_fact(scan: &Value) -> bool {
    scan["facts"]
        .as_array()
        .map(|facts| facts.iter().any(|fact| fact["name"] == "STALE_FACT"))
        .unwrap_or(false)
}
