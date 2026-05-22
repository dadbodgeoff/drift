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

    assert!(
        events
            .iter()
            .any(|event| event["event"] == "graph_node_batch")
    );
    assert!(
        events
            .iter()
            .any(|event| event["event"] == "graph_edge_batch")
    );
    assert!(
        events
            .iter()
            .any(|event| event["event"] == "graph_evidence_batch")
    );
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
    fs::write(
        dir.path().join("app/services/index.ts"),
        "export const service = {};\n",
    )
    .expect("write service index");
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
                && edge["from"]
                    .as_str()
                    .is_some_and(|from| from.contains("findMany"))
                && edge["to"]
                    .as_str()
                    .is_some_and(|to| to.contains("@/lib/db:db"))
                && edge["metadata"]["confidence"] == "import-alias"
        }),
        "missing callsite-to-import alias edge: {edges:#?}"
    );
    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "data_store"
                && node["label"] == "user"
                && node["metadata"]["receiver_root"] == "db"
        }),
        "missing data store node for db.user: {nodes:#?}"
    );
    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "data_operation"
                && node["label"] == "findMany"
                && node["metadata"]["receiver_name"] == "db.user"
                && node["metadata"]["store_name"] == "user"
                && node["metadata"]["operation_kind"] == "read"
        }),
        "missing data operation node for db.user.findMany: {nodes:#?}"
    );
    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "DATA_OPERATION_READS_DATA_STORE"
                && edge["from"]
                    .as_str()
                    .is_some_and(|from| from.contains("findMany"))
                && edge["to"]
                    .as_str()
                    .is_some_and(|to| to.contains("data_store:db:user"))
        }),
        "missing data operation read edge: {edges:#?}"
    );
}

#[test]
fn scan_stream_emits_static_endpoint_shape_for_next_routes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let app_route = dir.path().join("src/app/api/users/[id]");
    fs::create_dir_all(&app_route).expect("create app route dir");
    fs::write(
        app_route.join("route.ts"),
        r#"export async function DELETE() {
  return Response.json({});
}
"#,
    )
    .expect("write app route");
    let pages_route = dir.path().join("pages/api/projects/[projectId].ts");
    fs::create_dir_all(pages_route.parent().expect("parent")).expect("create pages api dir");
    fs::write(
        &pages_route,
        r#"export default function handler() {
  return Response.json({});
}
"#,
    )
    .expect("write pages api route");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
            "--repo-id",
            "repo_endpoint",
            "--scan-id",
            "scan_endpoint",
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
    let nodes = events
        .iter()
        .filter(|event| event["event"] == "graph_node_batch")
        .flat_map(|event| event["graph_nodes"].as_array().expect("nodes").iter())
        .collect::<Vec<_>>();
    let edges = events
        .iter()
        .filter(|event| event["event"] == "graph_edge_batch")
        .flat_map(|event| event["graph_edges"].as_array().expect("edges").iter())
        .collect::<Vec<_>>();

    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "endpoint"
                && node["metadata"]["method"] == "DELETE"
                && node["metadata"]["route_pattern"] == "/api/users/:id"
                && node["metadata"]["framework_role"] == "next_app_route"
                && node["metadata"]["dynamic_params"] == serde_json::json!(["id"])
        }),
        "missing app route endpoint shape: {nodes:#?}"
    );
    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "endpoint"
                && node["metadata"]["method"] == "default"
                && node["metadata"]["route_pattern"] == "/api/projects/:projectId"
                && node["metadata"]["framework_role"] == "next_pages_api"
                && node["metadata"]["dynamic_params"] == serde_json::json!(["projectId"])
        }),
        "missing pages api endpoint shape: {nodes:#?}"
    );
    assert!(
        edges
            .iter()
            .any(|edge| edge["kind"] == "ROUTE_HAS_ENDPOINT"),
        "missing route endpoint edge: {edges:#?}"
    );
}

#[test]
fn scan_stream_infers_service_boundary_from_route_import_targets() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
    )
    .expect("write tsconfig");
    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { listUsers } from "@/domain/users";

export async function GET() {
  return Response.json(await listUsers());
}
"#,
    )
    .expect("write route");
    let domain = dir.path().join("src/domain");
    fs::create_dir_all(&domain).expect("create domain dir");
    fs::write(
        domain.join("users.ts"),
        r#"import { db } from "@/db";

export async function listUsers() {
  return db.user.findMany();
}
"#,
    )
    .expect("write domain users");
    fs::write(
        dir.path().join("src/db.ts"),
        "export const db = { user: { findMany: async () => [] } };\n",
    )
    .expect("write db");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
            "--repo-id",
            "repo_service",
            "--scan-id",
            "scan_service",
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

    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "FILE_HAS_ROLE"
                && edge["from"] == "file:src/domain/users.ts"
                && edge["to"] == "file_role:service_module"
                && edge["metadata"]["inferred_from"] == "route_import_target"
        }),
        "missing route-import inferred service role: {edges:#?}"
    );
}

#[test]
fn scan_stream_does_not_infer_service_boundary_for_unresolved_route_symbol() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
    )
    .expect("write tsconfig");
    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { missingUsers } from "@/domain/users";

export async function GET() {
  return Response.json(await missingUsers());
}
"#,
    )
    .expect("write route");
    let domain = dir.path().join("src/domain");
    fs::create_dir_all(&domain).expect("create domain dir");
    fs::write(
        domain.join("users.ts"),
        r#"export async function listUsers() {
  return [];
}
"#,
    )
    .expect("write domain users");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
            "--repo-id",
            "repo_ambiguous",
            "--scan-id",
            "scan_ambiguous",
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
    let diagnostics = events
        .iter()
        .filter(|event| event["event"] == "diagnostic_batch")
        .flat_map(|event| event["diagnostics"].as_array().expect("diagnostics").iter())
        .collect::<Vec<_>>();

    assert!(
        !edges.iter().any(|edge| {
            edge["kind"] == "FILE_HAS_ROLE"
                && edge["from"] == "file:src/domain/users.ts"
                && edge["to"] == "file_role:service_module"
                && edge["metadata"]["inferred_from"] == "route_import_target"
        }),
        "unexpected route-import inferred service role: {edges:#?}"
    );
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic["code"] == "ambiguous_route_dependency_service_boundary"
                && diagnostic["file_path"] == "app/api/users/route.ts"
        }),
        "missing ambiguous service boundary diagnostic: {diagnostics:#?}"
    );
}

#[test]
fn scan_stream_resolves_aliases_from_extended_tsconfig_with_child_overrides() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.base.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"],"@shared/*":["shared/*"]}}}"#,
    )
    .expect("write base tsconfig");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"extends":"./tsconfig.base.json","compilerOptions":{"paths":{"@/*":["app/*"]}}}"#,
    )
    .expect("write child tsconfig");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { db } from "@/lib/db";
import { shared } from "@shared/util";

export async function GET() {
  return Response.json({ db, shared });
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("app/lib")).expect("create app lib");
    fs::write(dir.path().join("app/lib/db.ts"), "export const db = {};\n").expect("write db");
    fs::create_dir_all(dir.path().join("shared")).expect("create shared");
    fs::write(
        dir.path().join("shared/util.ts"),
        "export const shared = true;\n",
    )
    .expect("write shared util");

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

    for expected in [
        ("@/lib/db:db", "module:app/lib/db.ts"),
        ("@shared/util:shared", "module:shared/util.ts"),
    ] {
        assert!(
            edges.iter().any(|edge| {
                edge["kind"] == "IMPORT_RESOLVES_TO_MODULE"
                    && edge["from"]
                        .as_str()
                        .is_some_and(|from| from.contains(expected.0))
                    && edge["to"] == expected.1
            }),
            "missing extended tsconfig resolution {expected:?}: {edges:#?}"
        );
    }
}

#[test]
fn scan_stream_resolves_jsconfig_baseurl_and_package_export_subpaths() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("jsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":"src"}}"#,
    )
    .expect("write jsconfig");
    fs::write(
        dir.path().join("package.json"),
        r#"{"private":true,"workspaces":["packages/*"]}"#,
    )
    .expect("write root package");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { db } from "lib/db";
import { client } from "@acme/db/client";

export async function GET() {
  return Response.json(await db.user.findMany());
}
"#,
    )
    .expect("write route");

    fs::create_dir_all(dir.path().join("src/lib")).expect("create src lib");
    fs::write(dir.path().join("src/lib/db.ts"), "export const db = {};\n").expect("write db");
    fs::create_dir_all(dir.path().join("packages/db/src")).expect("create package db");
    fs::write(
        dir.path().join("packages/db/package.json"),
        r#"{"name":"@acme/db","exports":{"./client":"./src/client.ts","." :"./src/index.ts"}}"#,
    )
    .expect("write package db manifest");
    fs::write(
        dir.path().join("packages/db/src/index.ts"),
        "export const root = {};\n",
    )
    .expect("write index");
    fs::write(
        dir.path().join("packages/db/src/client.ts"),
        "export const client = {};\n",
    )
    .expect("write client");

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

    for expected_module in ["module:src/lib/db.ts", "module:packages/db/src/client.ts"] {
        assert!(
            edges.iter().any(|edge| {
                edge["kind"] == "IMPORT_RESOLVES_TO_MODULE" && edge["to"] == expected_module
            }),
            "missing resolved edge to {expected_module}: {edges:#?}"
        );
    }
    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "import_decl"
                && node["metadata"]["source"] == "lib/db"
                && node["metadata"]["import_kind"] == "value"
                && node["metadata"]["resolution_status"] == "resolved"
                && node["metadata"]["resolved_module_id"] == "module:src/lib/db.ts"
        }),
        "missing resolved import metadata: {nodes:#?}"
    );
}

#[test]
fn scan_stream_reports_unresolved_explicit_baseurl_imports() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("jsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":"src"}}"#,
    )
    .expect("write jsconfig");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { missing } from "lib/missing";

export async function GET() {
  return Response.json({ ok: Boolean(missing) });
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("src/lib")).expect("create src lib");
    fs::write(
        dir.path().join("src/lib/existing.ts"),
        "export const existing = true;\n",
    )
    .expect("write existing baseurl file");

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
    let diagnostics = events
        .iter()
        .filter(|event| event["event"] == "diagnostic_batch")
        .flat_map(|event| event["diagnostics"].as_array().expect("diagnostics").iter())
        .collect::<Vec<_>>();
    let nodes = events
        .iter()
        .filter(|event| event["event"] == "graph_node_batch")
        .flat_map(|event| event["graph_nodes"].as_array().expect("nodes").iter())
        .collect::<Vec<_>>();

    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic["code"] == "unresolved_import"
                && diagnostic["message"]
                    .as_str()
                    .is_some_and(|message| message.contains("lib/missing"))
        }),
        "missing explicit baseUrl unresolved diagnostic: {diagnostics:#?}"
    );
    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "import_decl"
                && node["metadata"]["source"] == "lib/missing"
                && node["metadata"]["resolution_status"] == "unresolved"
        }),
        "missing unresolved import metadata: {nodes:#?}"
    );
}

#[test]
fn scan_stream_does_not_resolve_bare_subpath_imports_without_explicit_baseurl() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{}}"#,
    )
    .expect("write tsconfig");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { headers } from "next/headers";

export async function GET() {
  return Response.json({ headers: Boolean(headers) });
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("next")).expect("create next dir");
    fs::write(
        dir.path().join("next/headers.ts"),
        "export const headers = {};\n",
    )
    .expect("write local next headers");

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

    assert!(
        !edges.iter().any(|edge| {
            edge["kind"] == "IMPORT_RESOLVES_TO_MODULE" && edge["to"] == "module:next/headers.ts"
        }),
        "implicit baseUrl resolved an external-looking package subpath: {edges:#?}"
    );
    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "import_decl"
                && node["metadata"]["source"] == "next/headers"
                && node["metadata"]["resolution_status"] == "external"
        }),
        "missing external import metadata: {nodes:#?}"
    );
}

#[test]
fn scan_stream_resolves_package_imports() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("package.json"),
        r##"{"imports":{"#db":"./src/lib/db.ts"}}"##,
    )
    .expect("write package");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r##"import { db } from "#db";

export async function GET() {
  return Response.json(await db.user.findMany());
}
"##,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("src/lib")).expect("create lib");
    fs::write(dir.path().join("src/lib/db.ts"), "export const db = {};\n").expect("write db");

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

    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "IMPORT_RESOLVES_TO_MODULE"
                && edge["from"]
                    .as_str()
                    .is_some_and(|from| from.contains("#db:db"))
                && edge["to"] == "module:src/lib/db.ts"
        }),
        "missing package imports resolution edge: {edges:#?}"
    );
}

#[test]
fn scan_stream_emits_barrel_reexport_module_flow_edges() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
    )
    .expect("write tsconfig");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { getUsers } from "@/services";

export async function GET() {
  return Response.json(await getUsers());
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("src/services")).expect("create services");
    fs::write(
        dir.path().join("src/services/index.ts"),
        r#"export { getUsers } from "./users";
"#,
    )
    .expect("write service barrel");
    fs::write(
        dir.path().join("src/services/users.ts"),
        r#"export async function getUsers() {
  return [];
}
"#,
    )
    .expect("write service");

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

    for expected in [
        (
            "module:app/api/users/route.ts",
            "module:src/services/index.ts",
        ),
        (
            "module:src/services/index.ts",
            "module:src/services/users.ts",
        ),
    ] {
        assert!(
            edges.iter().any(|edge| {
                edge["kind"] == "MODULE_IMPORTS_MODULE"
                    && edge["from"] == expected.0
                    && edge["to"] == expected.1
            }),
            "missing barrel flow edge {expected:?}: {edges:#?}"
        );
    }
    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "MODULE_REEXPORTS_MODULE"
                && edge["from"] == "module:src/services/index.ts"
                && edge["to"] == "module:src/services/users.ts"
        }),
        "missing explicit re-export module edge: {edges:#?}"
    );
    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "REEXPORT_RESOLVES_TO_SYMBOL"
                && edge["to"] == "symbol:src/services/users.ts:function:getUsers"
        }),
        "missing explicit re-export symbol edge: {edges:#?}"
    );
}

#[test]
fn scan_stream_emits_route_service_data_access_flow_edges() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
    )
    .expect("write tsconfig");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { getUsers as loadUsers } from "@/services/users";

export async function GET() {
  return Response.json(await loadUsers());
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("src/services")).expect("create services");
    fs::write(
        dir.path().join("src/services/users.ts"),
        r#"import { db } from "@/lib/db";

export async function getUsers() {
  return db.user.findMany();
}
"#,
    )
    .expect("write service");
    fs::create_dir_all(dir.path().join("src/lib")).expect("create lib");
    fs::write(dir.path().join("src/lib/db.ts"), "export const db = {};\n").expect("write db");

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

    for expected in [
        (
            "module:app/api/users/route.ts",
            "module:src/services/users.ts",
        ),
        ("module:src/services/users.ts", "module:src/lib/db.ts"),
    ] {
        assert!(
            edges.iter().any(|edge| {
                edge["kind"] == "MODULE_IMPORTS_MODULE"
                    && edge["from"] == expected.0
                    && edge["to"] == expected.1
            }),
            "missing module flow edge {expected:?}: {edges:#?}"
        );
    }
    for role in ["service_module", "data_access_module"] {
        assert!(
            nodes
                .iter()
                .any(|node| { node["kind"] == "file_role" && node["metadata"]["role"] == role }),
            "missing {role} role node: {nodes:#?}"
        );
    }
    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "CALLSITE_REFERENCES_SYMBOL"
                && edge["from"]
                    .as_str()
                    .is_some_and(|from| from.contains("loadUsers"))
                && edge["to"]
                    .as_str()
                    .is_some_and(|to| to.contains("@/services/users:loadUsers"))
                && edge["metadata"]["confidence"] == "import-alias"
        }),
        "missing route callsite-to-service import edge: {edges:#?}"
    );
}

#[test]
fn scan_stream_resolves_imports_to_exported_symbols() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
    )
    .expect("write tsconfig");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import { getUsers as loadUsers } from "@/services/users";

export async function GET() {
  return Response.json(await loadUsers());
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("src/services")).expect("create services");
    fs::write(
        dir.path().join("src/services/users.ts"),
        r#"export async function getUsers() {
  return [];
}
"#,
    )
    .expect("write service");

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

    assert!(
        nodes.iter().any(|node| {
            node["kind"] == "import_decl"
                && node["metadata"]["source"] == "@/services/users"
                && node["metadata"]["imported_name"] == "getUsers"
                && node["metadata"]["local_name"] == "loadUsers"
        }),
        "missing imported/local symbol metadata: {nodes:#?}"
    );
    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "IMPORT_RESOLVES_TO_SYMBOL"
                && edge["from"]
                    .as_str()
                    .is_some_and(|from| from.contains("@/services/users:loadUsers"))
                && edge["to"] == "symbol:src/services/users.ts:function:getUsers"
                && edge["metadata"]["imported_name"] == "getUsers"
                && edge["metadata"]["local_name"] == "loadUsers"
                && edge["metadata"]["resolution_status"] == "resolved"
        }),
        "missing import-to-exported-symbol edge: {edges:#?}"
    );
}

#[test]
fn scan_stream_resolves_default_exports_and_diagnoses_namespace_membership() {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
    )
    .expect("write tsconfig");

    let route = dir.path().join("app/api/users");
    fs::create_dir_all(&route).expect("create route dir");
    fs::write(
        route.join("route.ts"),
        r#"import loadUsers from "@/services/users";
import * as dbClient from "@/lib/db";

export async function GET() {
  await dbClient.db.user.findMany();
  return Response.json(await loadUsers());
}
"#,
    )
    .expect("write route");
    fs::create_dir_all(dir.path().join("src/services")).expect("create services");
    fs::write(
        dir.path().join("src/services/users.ts"),
        r#"export default async function getUsers() {
  return [];
}
"#,
    )
    .expect("write service");
    fs::create_dir_all(dir.path().join("src/lib")).expect("create lib");
    fs::write(
        dir.path().join("src/lib/db.ts"),
        "export const db = { user: { findMany: async () => [] } };\n",
    )
    .expect("write db");

    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            dir.path().to_str().expect("utf8 temp dir"),
            "--format",
            "jsonl",
            "--repo-id",
            "repo_default",
            "--scan-id",
            "scan_default",
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
    let diagnostics = events
        .iter()
        .filter(|event| event["event"] == "diagnostic_batch")
        .flat_map(|event| event["diagnostics"].as_array().expect("diagnostics").iter())
        .collect::<Vec<_>>();

    assert!(
        edges.iter().any(|edge| {
            edge["kind"] == "IMPORT_RESOLVES_TO_SYMBOL"
                && edge["from"]
                    .as_str()
                    .is_some_and(|from| from.contains("@/services/users:loadUsers"))
                && edge["to"] == "symbol:src/services/users.ts:function:default"
                && edge["metadata"]["imported_name"] == "default"
                && edge["metadata"]["local_name"] == "loadUsers"
        }),
        "missing default import symbol edge: {edges:#?}"
    );
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic["code"] == "unsupported_namespace_import_symbol"
                && diagnostic["file_path"] == "app/api/users/route.ts"
        }),
        "missing namespace import diagnostic: {diagnostics:#?}"
    );
}
