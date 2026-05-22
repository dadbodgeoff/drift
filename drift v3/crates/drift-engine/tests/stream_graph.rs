use std::{fs, process::Command};

use serde_json::Value;

#[test]
fn scan_stream_emits_graph_batches_before_completion() {
    let dir = tempfile::tempdir().expect("tempdir");
    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { prisma } from "../../../lib/prisma";

export async function GET() {
  return Response.json(await prisma.user.findMany());
}
"#,
    )
    .expect("write route");
    let lib = dir.path().join("app/lib");
    fs::create_dir_all(&lib).expect("create lib dir");
    fs::write(lib.join("prisma.ts"), "export const prisma = {};\n").expect("write lib");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
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

    let events = String::from_utf8(output.stdout)
        .expect("utf8 stdout")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("json line"))
        .collect::<Vec<_>>();

    assert!(events.iter().any(|event| event["event"] == "graph_node_batch"));
    assert!(events.iter().any(|event| event["event"] == "graph_edge_batch"));
    assert!(events.iter().any(|event| event["event"] == "graph_evidence_batch"));
    let completed = events
        .iter()
        .find(|event| event["event"] == "scan_completed")
        .expect("scan_completed event");
    assert!(completed["stats"]["graph_nodes"].as_u64().unwrap() > 0);
    assert!(completed["stats"]["graph_edges"].as_u64().unwrap() > 0);
}

#[test]
fn scan_stream_resolves_alias_workspace_index_imports_and_reports_unresolved_imports() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
    )
    .expect("write tsconfig");
    fs::write(
        dir.path().join("package.json"),
        r#"{"private":true,"workspaces":["packages/*"]}"#,
    )
    .expect("write package");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { db } from "@/lib/db";
import { repoDb } from "@acme/db";
import { service } from "../../services";
import { missing } from "@/missing/module";

export async function GET() {
  return Response.json(await db.user.findMany());
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("src/lib")).expect("create src lib");
    fs::write(dir.path().join("src/lib/db.ts"), "export const db = {};\n").expect("write db");
    fs::create_dir_all(dir.path().join("app/services")).expect("create services");
    fs::write(dir.path().join("app/services/index.ts"), "export const service = {};\n").expect("write service index");
    fs::create_dir_all(dir.path().join("packages/db/src")).expect("create package db");
    fs::write(
        dir.path().join("packages/db/package.json"),
        r#"{"name":"@acme/db","exports":"./src/index.ts"}"#,
    )
    .expect("write package db manifest");
    fs::write(
        dir.path().join("packages/db/src/index.ts"),
        "export const repoDb = {};\n",
    )
    .expect("write package db index");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
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

    let events = String::from_utf8(output.stdout)
        .expect("utf8 stdout")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("json line"))
        .collect::<Vec<_>>();
    let edges = events
        .iter()
        .filter(|event| event["event"] == "graph_edge_batch")
        .flat_map(|event| event["graph_edges"].as_array().expect("edges").iter())
        .collect::<Vec<_>>();
    let nodes = events
        .iter()
        .filter(|event| event["event"] == "graph_node_batch")
        .flat_map(|event| event["graph_nodes"].as_array().expect("nodes").iter())
        .collect::<Vec<_>>();
    let diagnostics = events
        .iter()
        .filter(|event| event["event"] == "diagnostic_batch")
        .flat_map(|event| event["diagnostics"].as_array().expect("diagnostics").iter())
        .collect::<Vec<_>>();

    for expected_module in [
        "module:src/lib/db.ts",
        "module:packages/db/src/index.ts",
        "module:app/services/index.ts",
    ] {
        assert!(
            edges.iter().any(|edge| {
                edge["kind"] == "IMPORT_RESOLVES_TO_MODULE" && edge["to"] == expected_module
            }),
            "missing resolved edge to {expected_module}: {edges:#?}"
        );
    }
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic["code"] == "unresolved_import"
                && diagnostic["file_path"] == "app/api/users/route.ts"
                && diagnostic["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("@/missing/module"))
        }),
        "missing unresolved import diagnostic: {diagnostics:#?}"
    );
    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "callsite"
                && node["label"] == "findMany"
                && node["metadata"]["receiver_name"] == "db.user"
        }),
        "missing receiver-aware callsite node: {nodes:#?}"
    );
    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "CALLSITE_REFERENCES_SYMBOL"
                && edge["from"].as_str().is_some_and(|from| from.contains("findMany"))
                && edge["to"].as_str().is_some_and(|to| to.contains("@/lib/db:db"))
                && edge["metadata"]["confidence"] == "import-alias"
        }),
        "missing callsite-to-import alias edge: {edges:#?}"
    );
}
