use std::{fs, process::Command};

use serde_json::Value;

#[test]
fn scan_respects_root_gitignore_before_emitting_facts_or_graph() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join(".gitignore"),
        "ignored/**\n*.generated.ts\nmain-*.js\noutput/\noutputs/\n",
    )
    .expect("write gitignore");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        "export async function GET() { return Response.json({ ok: true }); }\n",
    )
    .expect("write route");

    let ignored_route = dir.path().join("ignored/app/api/hidden");
    fs::create_dir_all(&ignored_route).expect("create ignored route dir");
    fs::write(
        ignored_route.join("route.ts"),
        "export async function GET() { return Response.json({ ignored: true }); }\n",
    )
    .expect("write ignored route");

    let generated = dir.path().join("src");
    fs::create_dir_all(&generated).expect("create generated dir");
    fs::write(
        generated.join("client.generated.ts"),
        "export const generatedClient = {};\n",
    )
    .expect("write generated file");
    fs::write(
        dir.path().join("main-DlFGMsC6.js"),
        "export const bundled = true;\n",
    )
    .expect("write generated bundle");
    let dogfood_output = dir.path().join("output/dogfood");
    fs::create_dir_all(&dogfood_output).expect("create dogfood output");
    fs::write(
        dogfood_output.join("state.js"),
        "export const localState = true;\n",
    )
    .expect("write dogfood output");
    let generated_output = dir.path().join("outputs/manual");
    fs::create_dir_all(&generated_output).expect("create generated output");
    fs::write(generated_output.join("deck.cjs"), "module.exports = {};\n")
        .expect("write generated output");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "json",
            "--repo-id",
            "repo_abc",
            "--scan-id",
            "scan_abc",
        ])
        .output()
        .expect("run drift-engine");
    assert!(
        output.status.success(),
        "engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let payload = serde_json::from_slice::<Value>(&output.stdout).expect("json output");
    let file_paths = payload["file_snapshots"]
        .as_array()
        .expect("file snapshots")
        .iter()
        .map(|file| file["file_path"].as_str().expect("file path"))
        .collect::<Vec<_>>();

    assert_eq!(file_paths, vec!["app/api/users/route.ts"]);
    assert_eq!(payload["stats"]["files_seen"], 1);
    assert_eq!(payload["stats"]["files_parsed"], 1);
    assert_eq!(payload["stats"]["truncated"], false);
}

#[cfg(unix)]
#[test]
fn scan_skips_symlinks_before_leaving_the_repo_root() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("outside tempdir");
    fs::create_dir_all(outside.path().join("app/api/secret")).expect("create outside route");
    fs::write(
        outside.path().join("app/api/secret/route.ts"),
        "export async function GET() { return Response.json({ leaked: true }); }\n",
    )
    .expect("write outside route");
    symlink(outside.path(), dir.path().join("linked-outside")).expect("create symlink");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "json",
            "--repo-id",
            "repo_abc",
            "--scan-id",
            "scan_abc",
        ])
        .output()
        .expect("run drift-engine");
    assert!(
        output.status.success(),
        "engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let payload = serde_json::from_slice::<Value>(&output.stdout).expect("json output");
    assert_eq!(
        payload["file_snapshots"]
            .as_array()
            .expect("file snapshots")
            .len(),
        0
    );
    assert_eq!(payload["stats"]["files_seen"], 0);
    assert_eq!(payload["stats"]["files_parsed"], 0);
}
