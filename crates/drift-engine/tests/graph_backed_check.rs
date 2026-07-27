use std::{
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[test]
fn check_repo_uses_resolved_graph_edges_for_direct_data_access() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                {
                    "id": "file:app/api/users/route.ts",
                    "kind": "file",
                    "label": "app/api/users/route.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "path": "app/api/users/route.ts" }
                },
                {
                    "id": "file_role:api_route",
                    "kind": "file_role",
                    "label": "api_route",
                    "stable": true,
                    "evidence_ids": ["evidence_role"],
                    "metadata": { "role": "api_route" }
                },
                {
                    "id": "module:app/api/users/route.ts",
                    "kind": "module",
                    "label": "app/api/users/route.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "file_path": "app/api/users/route.ts" }
                },
                {
                    "id": "module:src/lib/db.ts",
                    "kind": "module",
                    "label": "src/lib/db.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "file_path": "src/lib/db.ts" }
                },
                {
                    "id": "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1",
                    "kind": "import_decl",
                    "label": "db from @/lib/db",
                    "stable": false,
                    "evidence_ids": ["evidence_import"],
                    "metadata": {
                        "file_path": "app/api/users/route.ts",
                        "source": "@/lib/db",
                        "local_name": "db"
                    }
                }
            ],
            "graph_edges": [
                {
                    "id": "edge:file:app/api/users/route.ts:FILE_HAS_ROLE:file_role:api_route",
                    "kind": "FILE_HAS_ROLE",
                    "from": "file:app/api/users/route.ts",
                    "to": "file_role:api_route",
                    "evidence_ids": ["evidence_role"],
                    "metadata": {}
                },
                {
                    "id": "edge:file:app/api/users/route.ts:FILE_DEFINES_MODULE:module:app/api/users/route.ts",
                    "kind": "FILE_DEFINES_MODULE",
                    "from": "file:app/api/users/route.ts",
                    "to": "module:app/api/users/route.ts",
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1:IMPORT_DECL_REFERENCES_MODULE:module:app/api/users/route.ts",
                    "kind": "IMPORT_DECL_REFERENCES_MODULE",
                    "from": "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1",
                    "to": "module:app/api/users/route.ts",
                    "evidence_ids": ["evidence_import"],
                    "metadata": {}
                },
                {
                    "id": "edge:import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1:IMPORT_RESOLVES_TO_MODULE:module:src/lib/db.ts",
                    "kind": "IMPORT_RESOLVES_TO_MODULE",
                    "from": "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1",
                    "to": "module:src/lib/db.ts",
                    "evidence_ids": ["evidence_import"],
                    "metadata": {}
                }
            ]
        },
        "scan": {
            "scan_id": "scan_abc",
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/users/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 4
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
        },
        "contract": {
            "conventions": [{
                "id": "convention_graph_db",
                "kind": "api_route_no_direct_data_access",
                "matcher": { "forbidden_imports": ["src/lib/db"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("check-repo")
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
    let payload: Value = serde_json::from_slice(&output.stdout).expect("json output");
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["convention_id"], "convention_graph_db");
    assert_eq!(findings[0]["evidence"][0]["evidence_id"], "evidence_import");
    assert!(
        findings[0]["related_node_ids"]
            .as_array()
            .expect("related nodes")
            .iter()
            .any(|node| node == "module:src/lib/db.ts")
    );
}

#[test]
fn graph_backed_baseline_matches_legacy_import_fingerprints() {
    let legacy_fingerprint = legacy_direct_db_fingerprint(
        "convention_graph_db",
        "app/api/users/route.ts",
        "database",
        "@/lib/db",
    );
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:app/api/users/route.ts", "file", "app/api/users/route.ts", json!({ "path": "app/api/users/route.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("module:app/api/users/route.ts", "module", "app/api/users/route.ts", json!({ "file_path": "app/api/users/route.ts" })),
                graph_node("module:src/lib/db.ts", "module", "src/lib/db.ts", json!({ "file_path": "src/lib/db.ts" })),
                graph_node(
                    "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:database:1-1",
                    "import_decl",
                    "database from @/lib/db",
                    json!({
                        "file_path": "app/api/users/route.ts",
                        "source": "@/lib/db",
                        "local_name": "database"
                    })
                )
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_DEFINES_MODULE", "file:app/api/users/route.ts", "module:app/api/users/route.ts"),
                graph_edge(
                    "IMPORT_DECL_REFERENCES_MODULE",
                    "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:database:1-1",
                    "module:app/api/users/route.ts"
                ),
                graph_edge_with_evidence(
                    "IMPORT_RESOLVES_TO_MODULE",
                    "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:database:1-1",
                    "module:src/lib/db.ts",
                    "evidence_import"
                )
            ],
            "graph_evidence": [{
                "id": "evidence_import",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/users/route.ts:a",
                "file_path": "app/api/users/route.ts",
                "file_hash": "a",
                "start_line": 1,
                "end_line": 1,
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "fact_ids": [],
                "redaction_state": "none"
            }]
        },
        "scan": {
            "scan_id": "scan_abc",
            "facts": []
        },
        "contract": {
            "conventions": [{
                "id": "convention_graph_db",
                "kind": "api_route_no_direct_data_access",
                "matcher": { "forbidden_imports": ["src/lib/db"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [{
            "convention_id": "convention_graph_db",
            "finding_fingerprint": legacy_fingerprint,
            "status": "active"
        }],
        "diff": { "mode": "full", "files": [] }
    });
    let payload = run_check(request);
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["status_hint"], "pre_existing");
    assert_ne!(findings[0]["fingerprint"], legacy_fingerprint);
    assert_eq!(
        findings[0]["fingerprint"],
        graph_direct_db_fingerprint(
            "convention_graph_db",
            "app/api/users/route.ts",
            "src/lib/db.ts"
        )
    );
}

#[test]
fn check_repo_allows_route_to_service_to_data_access_flow() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:app/api/users/route.ts", "file", "app/api/users/route.ts", json!({ "path": "app/api/users/route.ts" })),
                graph_node("file:src/services/users.ts", "file", "src/services/users.ts", json!({ "path": "src/services/users.ts" })),
                graph_node("file:src/lib/db.ts", "file", "src/lib/db.ts", json!({ "path": "src/lib/db.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("file_role:service_module", "file_role", "service_module", json!({ "role": "service_module" })),
                graph_node("file_role:data_access_module", "file_role", "data_access_module", json!({ "role": "data_access_module" })),
                graph_node("module:app/api/users/route.ts", "module", "app/api/users/route.ts", json!({ "file_path": "app/api/users/route.ts" })),
                graph_node("module:src/services/users.ts", "module", "src/services/users.ts", json!({ "file_path": "src/services/users.ts" })),
                graph_node("module:src/lib/db.ts", "module", "src/lib/db.ts", json!({ "file_path": "src/lib/db.ts" }))
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_HAS_ROLE", "file:src/services/users.ts", "file_role:service_module"),
                graph_edge("FILE_HAS_ROLE", "file:src/lib/db.ts", "file_role:data_access_module"),
                graph_edge("FILE_DEFINES_MODULE", "file:app/api/users/route.ts", "module:app/api/users/route.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:src/services/users.ts", "module:src/services/users.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:src/lib/db.ts", "module:src/lib/db.ts"),
                graph_edge("MODULE_IMPORTS_MODULE", "module:app/api/users/route.ts", "module:src/services/users.ts"),
                graph_edge("MODULE_IMPORTS_MODULE", "module:src/services/users.ts", "module:src/lib/db.ts")
            ],
            "graph_evidence": []
        },
        "scan": { "scan_id": "scan_abc", "facts": [] },
        "contract": {
            "conventions": [{
                "id": "convention_service_delegation",
                "kind": "api_route_requires_service_delegation",
                "matcher": { "allowed_delegate_imports": ["src/services"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    });
    let payload = run_check(request);
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 0, "{payload:#?}");
    assert_eq!(payload["completeness"][0]["can_block"], true);
}

#[test]
fn check_repo_flags_route_to_data_access_without_service_delegation() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:app/api/users/route.ts", "file", "app/api/users/route.ts", json!({ "path": "app/api/users/route.ts" })),
                graph_node("file:src/lib/db.ts", "file", "src/lib/db.ts", json!({ "path": "src/lib/db.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("file_role:data_access_module", "file_role", "data_access_module", json!({ "role": "data_access_module" })),
                graph_node("module:app/api/users/route.ts", "module", "app/api/users/route.ts", json!({ "file_path": "app/api/users/route.ts" })),
                graph_node("module:src/lib/db.ts", "module", "src/lib/db.ts", json!({ "file_path": "src/lib/db.ts" }))
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_HAS_ROLE", "file:src/lib/db.ts", "file_role:data_access_module"),
                graph_edge("FILE_DEFINES_MODULE", "file:app/api/users/route.ts", "module:app/api/users/route.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:src/lib/db.ts", "module:src/lib/db.ts"),
                graph_edge_with_evidence("MODULE_IMPORTS_MODULE", "module:app/api/users/route.ts", "module:src/lib/db.ts", "evidence_import")
            ],
            "graph_evidence": [{
                "id": "evidence_import",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
                "file_path": "app/api/users/route.ts",
                "file_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "start_line": 1,
                "end_line": 1,
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "fact_ids": ["fact_import"],
                "redaction_state": "none"
            }]
        },
        "scan": { "scan_id": "scan_abc", "facts": [] },
        "contract": {
            "conventions": [{
                "id": "convention_service_delegation",
                "kind": "api_route_requires_service_delegation",
                "matcher": { "allowed_delegate_imports": ["src/services"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    });
    let payload = run_check(request);
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(
        findings[0]["convention_id"],
        "convention_service_delegation"
    );
    assert_eq!(
        findings[0]["rule_id"],
        "api_route_requires_service_delegation"
    );
    assert_eq!(findings[0]["enforcement_result"], "block");
    assert_eq!(findings[0]["evidence"][0]["evidence_id"], "evidence_import");
    assert!(
        findings[0]["related_node_ids"]
            .as_array()
            .expect("related nodes")
            .iter()
            .any(|node| node == "module:src/lib/db.ts")
    );
}

#[test]
fn check_repo_flags_direct_data_access_hidden_behind_barrel_reexport() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:app/api/users/route.ts", "file", "app/api/users/route.ts", json!({ "path": "app/api/users/route.ts" })),
                graph_node("file:src/db/index.ts", "file", "src/db/index.ts", json!({ "path": "src/db/index.ts" })),
                graph_node("file:src/db/client.ts", "file", "src/db/client.ts", json!({ "path": "src/db/client.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("module:app/api/users/route.ts", "module", "app/api/users/route.ts", json!({ "file_path": "app/api/users/route.ts" })),
                graph_node("module:src/db/index.ts", "module", "src/db/index.ts", json!({ "file_path": "src/db/index.ts" })),
                graph_node("module:src/db/client.ts", "module", "src/db/client.ts", json!({ "file_path": "src/db/client.ts" })),
                graph_node("import_decl:app/api/users/route.ts:db", "import_decl", "db from @/db", json!({
                    "file_path": "app/api/users/route.ts",
                    "source": "@/db",
                    "local_name": "db"
                }))
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_DEFINES_MODULE", "file:app/api/users/route.ts", "module:app/api/users/route.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:src/db/index.ts", "module:src/db/index.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:src/db/client.ts", "module:src/db/client.ts"),
                graph_edge_with_evidence("IMPORT_DECL_REFERENCES_MODULE", "import_decl:app/api/users/route.ts:db", "module:app/api/users/route.ts", "evidence_import"),
                graph_edge_with_evidence("IMPORT_RESOLVES_TO_MODULE", "import_decl:app/api/users/route.ts:db", "module:src/db/index.ts", "evidence_import"),
                graph_edge("MODULE_REEXPORTS_MODULE", "module:src/db/index.ts", "module:src/db/client.ts")
            ],
            "graph_evidence": [{
                "id": "evidence_import",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
                "file_path": "app/api/users/route.ts",
                "file_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "start_line": 1,
                "end_line": 1,
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "fact_ids": ["fact_import"],
                "redaction_state": "none"
            }]
        },
        "scan": { "scan_id": "scan_abc", "facts": [] },
        "contract": {
            "conventions": [{
                "id": "convention_graph_db",
                "kind": "api_route_no_direct_data_access",
                "matcher": { "forbidden_imports": ["src/db/client.ts"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    });
    let payload = run_check(request);
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["evidence"][0]["evidence_id"], "evidence_import");
    assert!(
        findings[0]["related_node_ids"]
            .as_array()
            .expect("related nodes")
            .iter()
            .any(|node| node == "module:src/db/client.ts")
    );
}

#[test]
fn check_repo_downgrades_blocking_when_route_import_symbols_are_unresolved() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:app/api/users/route.ts", "file", "app/api/users/route.ts", json!({ "path": "app/api/users/route.ts" })),
                graph_node("file:src/lib/db.ts", "file", "src/lib/db.ts", json!({ "path": "src/lib/db.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("module:app/api/users/route.ts", "module", "app/api/users/route.ts", json!({ "file_path": "app/api/users/route.ts" })),
                graph_node("module:src/lib/db.ts", "module", "src/lib/db.ts", json!({ "file_path": "src/lib/db.ts" })),
                graph_node("import_decl:app/api/users/route.ts:db", "import_decl", "db from @/lib/db", json!({
                    "file_path": "app/api/users/route.ts",
                    "source": "@/lib/db",
                    "local_name": "db"
                }))
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_DEFINES_MODULE", "file:app/api/users/route.ts", "module:app/api/users/route.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:src/lib/db.ts", "module:src/lib/db.ts"),
                graph_edge_with_evidence("IMPORT_DECL_REFERENCES_MODULE", "import_decl:app/api/users/route.ts:db", "module:app/api/users/route.ts", "evidence_import"),
                graph_edge_with_evidence("IMPORT_RESOLVES_TO_MODULE", "import_decl:app/api/users/route.ts:db", "module:src/lib/db.ts", "evidence_import")
            ],
            "graph_evidence": [{
                "id": "evidence_import",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
                "file_path": "app/api/users/route.ts",
                "file_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "start_line": 1,
                "end_line": 1,
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "fact_ids": ["fact_import"],
                "redaction_state": "none"
            }],
            "graph_diagnostics": [{
                "severity": "warning",
                "code": "unresolved_import_symbol",
                "message": "Could not resolve imported symbol db from @/lib/db in src/lib/db.ts.",
                "file_path": "app/api/users/route.ts"
            }]
        },
        "scan": { "scan_id": "scan_abc", "facts": [] },
        "contract": {
            "conventions": [{
                "id": "convention_graph_db",
                "kind": "api_route_no_direct_data_access",
                "matcher": { "forbidden_imports": ["src/lib/db"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    });
    let payload = run_check(request);
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["enforcement_result"], "none");
    assert_eq!(payload["completeness"][0]["complete"], false);
    assert_eq!(payload["completeness"][0]["can_block"], false);
    assert!(
        payload["completeness"][0]["reasons"]
            .as_array()
            .expect("reasons")
            .iter()
            .any(|reason| reason == "unresolved_route_import_symbol:app/api/users/route.ts")
    );
}

#[test]
fn check_repo_uses_graph_target_fingerprint_for_alias_renames() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:app/api/users/route.ts", "file", "app/api/users/route.ts", json!({ "path": "app/api/users/route.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("module:app/api/users/route.ts", "module", "app/api/users/route.ts", json!({ "file_path": "app/api/users/route.ts" })),
                graph_node("module:src/lib/db.ts", "module", "src/lib/db.ts", json!({ "file_path": "src/lib/db.ts" })),
                graph_node("import_decl:app/api/users/route.ts:database", "import_decl", "database from @/lib/db", json!({
                    "file_path": "app/api/users/route.ts",
                    "source": "@/lib/db",
                    "local_name": "database"
                }))
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_DEFINES_MODULE", "file:app/api/users/route.ts", "module:app/api/users/route.ts"),
                graph_edge_with_evidence("IMPORT_DECL_REFERENCES_MODULE", "import_decl:app/api/users/route.ts:database", "module:app/api/users/route.ts", "evidence_import"),
                graph_edge_with_evidence("IMPORT_RESOLVES_TO_MODULE", "import_decl:app/api/users/route.ts:database", "module:src/lib/db.ts", "evidence_import")
            ],
            "graph_evidence": [{
                "id": "evidence_import",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
                "file_path": "app/api/users/route.ts",
                "file_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "start_line": 12,
                "end_line": 12,
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "fact_ids": ["fact_import"],
                "redaction_state": "none"
            }]
        },
        "scan": { "scan_id": "scan_abc", "facts": [] },
        "contract": {
            "conventions": [{
                "id": "convention_graph_db",
                "kind": "api_route_no_direct_data_access",
                "matcher": { "forbidden_imports": ["src/lib/db"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    });
    let payload = run_check(request);
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(
        findings[0]["fingerprint"],
        graph_direct_db_fingerprint(
            "convention_graph_db",
            "app/api/users/route.ts",
            "src/lib/db.ts"
        )
    );
}

#[test]
fn check_repo_disables_blocking_when_check_limits_are_exceeded() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": { "graph_nodes": [], "graph_edges": [], "graph_evidence": [] },
        "scan": {
            "scan_id": "scan_abc",
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/users/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 4
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
        },
        "contract": {
            "conventions": [{
                "id": "convention_db",
                "kind": "api_route_no_direct_data_access",
                "matcher": { "forbidden_imports": ["@/lib/db"] },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] },
        "limits": {
            "max_files_seen": 100,
            "max_files_parsed": 100,
            "max_file_bytes": 2000000,
            "max_facts": 1,
            "max_graph_nodes": 100,
            "max_graph_edges": 100,
            "max_diagnostics": 100,
            "follow_symlinks": false
        }
    });
    let payload = run_check(request);
    let findings = payload["findings"].as_array().expect("findings");

    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["enforcement_result"], "none");
    assert_eq!(payload["stats"]["truncated"], true);
    assert_eq!(payload["completeness"][0]["can_block"], false);
    assert!(
        payload["completeness"][0]["reasons"][0]
            .as_str()
            .expect("reason")
            .contains("facts_exceeded_limit")
    );
}

fn run_check(request: Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("check-repo")
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

fn graph_node(id: &str, kind: &str, label: &str, metadata: Value) -> Value {
    json!({
        "id": id,
        "kind": kind,
        "label": label,
        "stable": true,
        "evidence_ids": [],
        "metadata": metadata
    })
}

fn graph_edge(kind: &str, from: &str, to: &str) -> Value {
    graph_edge_with_evidence(kind, from, to, "")
}

fn graph_edge_with_evidence(kind: &str, from: &str, to: &str, evidence_id: &str) -> Value {
    let evidence_ids = if evidence_id.is_empty() {
        Vec::<String>::new()
    } else {
        vec![evidence_id.to_string()]
    };
    json!({
        "id": format!("edge:{from}:{kind}:{to}"),
        "kind": kind,
        "from": from,
        "to": to,
        "evidence_ids": evidence_ids,
        "metadata": {}
    })
}

fn graph_direct_db_fingerprint(
    convention_id: &str,
    route_file: &str,
    resolved_path: &str,
) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            format!("{convention_id}:{route_file}:graph_direct_data_access:{resolved_path}")
                .as_bytes()
        )
    )
}

fn legacy_direct_db_fingerprint(
    convention_id: &str,
    route_file: &str,
    import_name: &str,
    import_source: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"direct-data-access-v1\0");
    hasher.update(convention_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(route_file.replace('\\', "/").as_bytes());
    hasher.update(b"\0");
    hasher.update(import_name.as_bytes());
    hasher.update(b"\0");
    hasher.update(import_source.as_bytes());
    format!("{:x}", hasher.finalize())
}
