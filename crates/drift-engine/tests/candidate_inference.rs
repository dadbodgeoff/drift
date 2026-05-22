use std::{
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

#[test]
fn infer_candidates_emits_governance_free_candidate_proposals() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [{
                "id": "module:app/api/users/route.ts",
                "kind": "module",
                "label": "app/api/users/route.ts",
                "stable": true,
                "evidence_ids": [],
                "metadata": { "file_path": "app/api/users/route.ts" }
            }],
            "graph_edges": [],
            "graph_evidence": []
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [{
                "file_path": "app/api/users/route.ts",
                "content_hash": "a".repeat(64),
                "byte_size": 120,
                "indexed": true
            }],
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/users/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 5
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/users/route.ts",
                    "name": "db",
                    "value": "@/lib/db",
                    "start_line": 1,
                    "end_line": 1
                }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");

    assert_eq!(payload["schema_version"], "engine.candidates.result.v1");
    assert_eq!(candidates.len(), 2, "{payload:#?}");
    assert!(candidates.iter().any(|candidate| {
        candidate["kind"] == "api_route_no_direct_data_access"
            && candidate["enforcement_capability"] == "deterministic_check"
            && candidate["suggested_enforcement_mode"] == "block"
            && candidate.get("status").is_none()
    }));
    assert!(candidates.iter().any(|candidate| {
        candidate["kind"] == "api_route_requires_service_delegation"
            && candidate["enforcement_capability"] == "heuristic_check"
            && candidate["suggested_enforcement_mode"] == "warn"
            && candidate["counterexample_refs"]
                .as_array()
                .is_some_and(|refs| refs.len() == 1)
    }));
    assert_eq!(payload["completeness"][0]["can_block"], false);
}

#[test]
fn infer_candidates_uses_resolved_import_targets_for_data_access_modules() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [{
                "id": "import:app/api/users/route.ts:client",
                "kind": "import_decl",
                "label": "client from @/lib/client",
                "stable": false,
                "evidence_ids": [],
                "metadata": {
                    "file_path": "app/api/users/route.ts",
                    "local_name": "client",
                    "source": "@/lib/client",
                    "resolved_file_path": "src/lib/client.ts"
                }
            }],
            "graph_edges": [],
            "graph_evidence": []
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                {
                    "file_path": "app/api/users/route.ts",
                    "content_hash": "a".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "src/lib/client.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 80,
                    "indexed": true
                }
            ],
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/users/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 5
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/users/route.ts",
                    "name": "client",
                    "value": "@/lib/client",
                    "start_line": 1,
                    "end_line": 1
                },
                {
                    "kind": "import_used",
                    "file_path": "src/lib/client.ts",
                    "name": "PrismaClient",
                    "value": "@prisma/client",
                    "start_line": 1,
                    "end_line": 1
                }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");
    let direct = candidates
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_no_direct_data_access")
        .expect("direct data-access candidate");

    assert_eq!(direct["matcher"]["forbidden_imports"], json!(["@/lib/client"]));
    assert_eq!(direct["evidence_refs"][0]["symbol"], "client");
}

#[test]
fn infer_candidates_ignores_repo_fixture_routes_when_repo_root_is_not_the_fixture() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [],
            "graph_edges": [],
            "graph_evidence": []
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [{
                "file_path": "test/fixtures/next-api-direct-db/apps/web/app/api/users/route.ts",
                "content_hash": "a".repeat(64),
                "byte_size": 120,
                "indexed": true
            }],
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "test/fixtures/next-api-direct-db/apps/web/app/api/users/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 5
                },
                {
                    "kind": "import_used",
                    "file_path": "test/fixtures/next-api-direct-db/apps/web/app/api/users/route.ts",
                    "name": "prisma",
                    "value": "@/lib/prisma",
                    "start_line": 1,
                    "end_line": 1
                }
            ]
        }
    });
    let payload = run_infer_candidates(request);

    assert_eq!(payload["candidates"].as_array().expect("candidates").len(), 0);
}

fn run_infer_candidates(request: Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("infer-candidates")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn drift-engine");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(request.to_string().as_bytes())
        .expect("write request");
    let output = child.wait_with_output().expect("wait output");
    assert!(
        output.status.success(),
        "engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("json output")
}
