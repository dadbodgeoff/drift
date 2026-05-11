use std::fs;

use drift_engine::{DRIFT_ENGINE_VERSION, FileFingerprint, fingerprint_file, should_index_path};

#[test]
fn exposes_engine_version() {
    assert_eq!(DRIFT_ENGINE_VERSION, "0.1.0");
}

#[test]
fn skips_generated_vendor_binary_and_secret_like_paths() {
    assert!(!should_index_path("node_modules/react/index.js"));
    assert!(!should_index_path("dist/app.js"));
    assert!(!should_index_path("coverage/report.json"));
    assert!(!should_index_path(".env.local"));
    assert!(!should_index_path("certs/private.pem"));
    assert!(!should_index_path("public/logo.png"));
    assert!(should_index_path("apps/web/app/api/workspaces/route.ts"));
}

#[test]
fn fingerprints_files_without_loading_repo_into_memory() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("route.ts");
    let fixture = "export async function POST() { return Response.json({ ok: true }); }\n";
    fs::write(&file, fixture).expect("write fixture");

    let fingerprint = fingerprint_file(&file).expect("fingerprint");

    assert_eq!(fingerprint.bytes, fixture.len() as u64);
    assert_eq!(fingerprint.sha256.len(), 64);
    assert!(matches!(
        fingerprint,
        FileFingerprint { path, .. } if path.ends_with("route.ts")
    ));
}
