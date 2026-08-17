use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
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
            && candidate["suggested_enforcement_mode"] == "warn"
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

    assert_eq!(
        direct["matcher"]["forbidden_imports"],
        json!(["@/lib/client"])
    );
    assert_eq!(direct["evidence_refs"][0]["symbol"], "client");
}

#[test]
fn infer_candidates_keeps_auth_payment_and_prisma_runtime_out_of_direct_data_access() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                {
                    "id": "module:app/api/auth/login/github/callback/route.ts",
                    "kind": "module",
                    "label": "app/api/auth/login/github/callback/route.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "file_path": "app/api/auth/login/github/callback/route.ts" }
                },
                {
                    "id": "module:src/lib/server/db.ts",
                    "kind": "module",
                    "label": "src/lib/server/db.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "file_path": "src/lib/server/db.ts" }
                },
                {
                    "id": "role:api_route",
                    "kind": "file_role",
                    "label": "api_route",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "role": "api_route" }
                },
                {
                    "id": "role:data_access_module",
                    "kind": "file_role",
                    "label": "data_access_module",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "role": "data_access_module" }
                },
                {
                    "id": "import:route:runtime",
                    "kind": "import_decl",
                    "label": "PrismaClientKnownRequestError from @prisma/client/runtime/library",
                    "stable": false,
                    "evidence_ids": [],
                    "metadata": {
                        "file_path": "app/api/auth/login/github/callback/route.ts",
                        "local_name": "PrismaClientKnownRequestError",
                        "source": "@prisma/client/runtime/library"
                    }
                },
                {
                    "id": "import:route:session",
                    "kind": "import_decl",
                    "label": "createSession from ~/lib/server/auth/session",
                    "stable": false,
                    "evidence_ids": [],
                    "metadata": {
                        "file_path": "app/api/auth/login/github/callback/route.ts",
                        "local_name": "createSession",
                        "source": "~/lib/server/auth/session",
                        "resolved_file_path": "src/lib/server/auth/session.ts"
                    }
                },
                {
                    "id": "import:route:payment",
                    "kind": "import_decl",
                    "label": "stripe from ~/lib/server/payment",
                    "stable": false,
                    "evidence_ids": [],
                    "metadata": {
                        "file_path": "app/api/auth/login/github/callback/route.ts",
                        "local_name": "stripe",
                        "source": "~/lib/server/payment",
                        "resolved_file_path": "src/lib/server/payment.ts"
                    }
                },
                {
                    "id": "import:route:db",
                    "kind": "import_decl",
                    "label": "prisma from ~/lib/server/db",
                    "stable": false,
                    "evidence_ids": ["graph_evidence_prisma"],
                    "metadata": {
                        "file_path": "app/api/auth/login/github/callback/route.ts",
                        "local_name": "prisma",
                        "source": "~/lib/server/db",
                        "resolved_file_path": "src/lib/server/db.ts"
                    }
                }
            ],
            "graph_edges": [
                {
                    "id": "edge:route-role",
                    "kind": "FILE_HAS_ROLE",
                    "from": "module:app/api/auth/login/github/callback/route.ts",
                    "to": "role:api_route",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:db-role",
                    "kind": "FILE_HAS_ROLE",
                    "from": "module:src/lib/server/db.ts",
                    "to": "role:data_access_module",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:db-owner",
                    "kind": "IMPORT_DECL_REFERENCES_MODULE",
                    "from": "import:route:db",
                    "to": "module:app/api/auth/login/github/callback/route.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:db-resolves",
                    "kind": "IMPORT_RESOLVES_TO_MODULE",
                    "from": "import:route:db",
                    "to": "module:src/lib/server/db.ts",
                    "stable": true,
                    "evidence_ids": ["graph_evidence_prisma"],
                    "metadata": {}
                }
            ],
            "graph_evidence": [{
                "id": "graph_evidence_prisma",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/auth/login/github/callback/route.ts:aaaaaaaaaaaa",
                "fact_ids": ["graph_fact_prisma"],
                "file_path": "app/api/auth/login/github/callback/route.ts",
                "start_line": 7,
                "end_line": 7,
                "file_hash": "a".repeat(64),
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "redaction_state": "none"
            }]
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                {
                    "file_path": "app/api/auth/login/github/callback/route.ts",
                    "content_hash": "a".repeat(64),
                    "byte_size": 400,
                    "indexed": true
                },
                {
                    "file_path": "src/lib/server/auth/session.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "src/lib/server/payment.ts",
                    "content_hash": "c".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "src/lib/server/db.ts",
                    "content_hash": "d".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                }
            ],
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/auth/login/github/callback/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 20
                },
                {
                    "kind": "file_role_detected",
                    "file_path": "src/lib/server/auth/session.ts",
                    "name": "data_access_module",
                    "start_line": 1,
                    "end_line": 8
                },
                {
                    "kind": "file_role_detected",
                    "file_path": "src/lib/server/payment.ts",
                    "name": "data_access_module",
                    "start_line": 1,
                    "end_line": 8
                },
                {
                    "kind": "file_role_detected",
                    "file_path": "src/lib/server/db.ts",
                    "name": "data_access_module",
                    "start_line": 1,
                    "end_line": 8
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/auth/login/github/callback/route.ts",
                    "name": "PrismaClientKnownRequestError",
                    "value": "@prisma/client/runtime/library",
                    "start_line": 1,
                    "end_line": 1
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/auth/login/github/callback/route.ts",
                    "name": "createSession",
                    "value": "~/lib/server/auth/session",
                    "start_line": 5,
                    "end_line": 5
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/auth/login/github/callback/route.ts",
                    "name": "stripe",
                    "value": "~/lib/server/payment",
                    "start_line": 6,
                    "end_line": 6
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/auth/login/github/callback/route.ts",
                    "name": "prisma",
                    "value": "~/lib/server/db",
                    "start_line": 7,
                    "end_line": 7
                },
                {
                    "kind": "import_used",
                    "file_path": "src/lib/server/auth/session.ts",
                    "name": "prisma",
                    "value": "~/lib/server/db",
                    "start_line": 1,
                    "end_line": 1
                },
                {
                    "kind": "import_used",
                    "file_path": "src/lib/server/payment.ts",
                    "name": "prisma",
                    "value": "~/lib/server/db",
                    "start_line": 1,
                    "end_line": 1
                }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let direct = direct_data_access_candidate(&payload);

    assert_eq!(
        direct["matcher"]["forbidden_imports"],
        json!(["~/lib/server/db"])
    );
    assert_eq!(evidence_symbols(direct), vec!["prisma"]);
    let fact_ids = direct["evidence_refs"][0]["fact_ids"]
        .as_array()
        .expect("fact ids")
        .iter()
        .map(|value| value.as_str().expect("fact id"))
        .collect::<Vec<_>>();
    assert!(
        fact_ids
            .contains(&"fact:import_used:app/api/auth/login/github/callback/route.ts:prisma:7-7")
    );
    assert!(fact_ids.contains(&"graph_fact_prisma"));
}

#[test]
fn infer_candidates_uses_graph_only_client_data_access_modules() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                {
                    "id": "module:app/api/users/route.ts",
                    "kind": "module",
                    "label": "app/api/users/route.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "file_path": "app/api/users/route.ts" }
                },
                {
                    "id": "module:src/lib/client.ts",
                    "kind": "module",
                    "label": "src/lib/client.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "file_path": "src/lib/client.ts" }
                },
                {
                    "id": "role:api_route",
                    "kind": "file_role",
                    "label": "api_route",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "role": "api_route" }
                },
                {
                    "id": "role:data_access_module",
                    "kind": "file_role",
                    "label": "data_access_module",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "role": "data_access_module" }
                },
                {
                    "id": "import:route:client",
                    "kind": "import_decl",
                    "label": "client from @/lib/client",
                    "stable": false,
                    "evidence_ids": ["graph_evidence_client"],
                    "metadata": {
                        "file_path": "app/api/users/route.ts",
                        "local_name": "client",
                        "source": "@/lib/client",
                        "resolved_file_path": "src/lib/client.ts"
                    }
                }
            ],
            "graph_edges": [
                {
                    "id": "edge:route-role",
                    "kind": "FILE_HAS_ROLE",
                    "from": "module:app/api/users/route.ts",
                    "to": "role:api_route",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:client-role",
                    "kind": "FILE_HAS_ROLE",
                    "from": "module:src/lib/client.ts",
                    "to": "role:data_access_module",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:client-owner",
                    "kind": "IMPORT_DECL_REFERENCES_MODULE",
                    "from": "import:route:client",
                    "to": "module:app/api/users/route.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:client-resolves",
                    "kind": "IMPORT_RESOLVES_TO_MODULE",
                    "from": "import:route:client",
                    "to": "module:src/lib/client.ts",
                    "stable": true,
                    "evidence_ids": ["graph_evidence_client"],
                    "metadata": {}
                }
            ],
            "graph_evidence": [{
                "id": "graph_evidence_client",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
                "fact_ids": ["graph_fact_client"],
                "file_path": "app/api/users/route.ts",
                "start_line": 1,
                "end_line": 1,
                "file_hash": "a".repeat(64),
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "redaction_state": "none"
            }]
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
            "facts": [{
                "kind": "file_role_detected",
                "file_path": "app/api/users/route.ts",
                "name": "api_route",
                "start_line": 1,
                "end_line": 5
            }]
        }
    });
    let payload = run_infer_candidates(request);
    let direct = direct_data_access_candidate(&payload);

    assert_eq!(
        direct["matcher"]["forbidden_imports"],
        json!(["@/lib/client"])
    );
    assert_eq!(
        direct["evidence_refs"][0]["fact_ids"],
        json!(["graph_fact_client"])
    );
}

#[test]
fn infer_candidates_merges_duplicate_raw_and_graph_evidence_fact_ids() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
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
                    "id": "role:api_route",
                    "kind": "file_role",
                    "label": "api_route",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "role": "api_route" }
                },
                {
                    "id": "role:data_access_module",
                    "kind": "file_role",
                    "label": "data_access_module",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": { "role": "data_access_module" }
                },
                {
                    "id": "import:route:db",
                    "kind": "import_decl",
                    "label": "db from @/lib/db",
                    "stable": false,
                    "evidence_ids": ["graph_evidence_db"],
                    "metadata": {
                        "file_path": "app/api/users/route.ts",
                        "local_name": "db",
                        "source": "@/lib/db",
                        "resolved_file_path": "src/lib/db.ts"
                    }
                }
            ],
            "graph_edges": [
                {
                    "id": "edge:route-role",
                    "kind": "FILE_HAS_ROLE",
                    "from": "module:app/api/users/route.ts",
                    "to": "role:api_route",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:db-role",
                    "kind": "FILE_HAS_ROLE",
                    "from": "module:src/lib/db.ts",
                    "to": "role:data_access_module",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:db-owner",
                    "kind": "IMPORT_DECL_REFERENCES_MODULE",
                    "from": "import:route:db",
                    "to": "module:app/api/users/route.ts",
                    "stable": true,
                    "evidence_ids": [],
                    "metadata": {}
                },
                {
                    "id": "edge:db-resolves",
                    "kind": "IMPORT_RESOLVES_TO_MODULE",
                    "from": "import:route:db",
                    "to": "module:src/lib/db.ts",
                    "stable": true,
                    "evidence_ids": ["graph_evidence_db"],
                    "metadata": {}
                }
            ],
            "graph_evidence": [{
                "id": "graph_evidence_db",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:app/api/users/route.ts:aaaaaaaaaaaa",
                "fact_ids": ["graph_fact_db"],
                "file_path": "app/api/users/route.ts",
                "start_line": 1,
                "end_line": 1,
                "file_hash": "a".repeat(64),
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "redaction_state": "none"
            }]
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
                    "file_path": "src/lib/db.ts",
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
                    "name": "db",
                    "value": "@/lib/db",
                    "start_line": 1,
                    "end_line": 1
                }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let direct = direct_data_access_candidate(&payload);
    let refs = direct["evidence_refs"].as_array().expect("evidence refs");

    assert_eq!(refs.len(), 1, "{direct:#?}");
    assert_eq!(
        refs[0]["fact_ids"],
        json!([
            "fact:import_used:app/api/users/route.ts:db:1-1",
            "graph_fact_db"
        ])
    );

    // D-H1: the SCORE has to agree with the list it summarises.
    //
    // This fixture is one import statement in one file described twice - once as a raw fact and
    // once as a graph import - which is exactly what `combined_evidence_refs` dedupes and exactly
    // what `data_imports.len() + graph_data_imports.len()` did not. The test asserted the deduped
    // list and never the count, so `supporting_examples_count: 2` sat beside one ref for as long
    // as it existed. `commands/start.ts:368` prints this number as "Evidence: N matching
    // import(s)" on the screen a human uses to accept the convention.
    assert_eq!(
        direct["scoring"]["supporting_examples_count"],
        json!(refs.len()),
        "{direct:#?}"
    );
}

/// T26: `withWorkspace` is NOT recognised as an auth helper, and that is the correct behaviour.
///
/// This test previously asserted the opposite, and passed only because `"withworkspace"` was
/// hardcoded in the auth-helper name list. That literal is dub's auth wrapper, and dub is one of
/// the evaluation repos - so the falsification report's "most useful single output across six
/// repositories" existed because a specific codebase's vocabulary was compiled into the engine.
///
/// Removing it costs that candidate. Keeping the assertion inverted here records the honest
/// baseline: generic identity-helper shapes are recognised, repo-specific names are not, and
/// recognising them would require the structural signal rather than a name list.
#[test]
fn does_not_recognise_repo_specific_wrappers_as_auth_helpers() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [],
            "graph_edges": [],
            "graph_evidence": []
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                {
                    "file_path": "app/api/oauth/apps/route.ts",
                    "content_hash": "a".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "app/api/webhooks/route.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                }
            ],
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/oauth/apps/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 8
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/oauth/apps/route.ts",
                    "name": "withWorkspace",
                    "value": "@/lib/auth",
                    "imported_name": "withWorkspace",
                    "start_line": 1,
                    "end_line": 1
                },
                {
                    "kind": "symbol_called",
                    "file_path": "app/api/oauth/apps/route.ts",
                    "name": "withWorkspace",
                    "start_line": 3,
                    "end_line": 8
                },
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/webhooks/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 8
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/webhooks/route.ts",
                    "name": "withWorkspace",
                    "value": "@/lib/auth",
                    "imported_name": "withWorkspace",
                    "start_line": 1,
                    "end_line": 1
                },
                {
                    "kind": "symbol_called",
                    "file_path": "app/api/webhooks/route.ts",
                    "name": "withWorkspace",
                    "start_line": 3,
                    "end_line": 8
                }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");

    assert!(
        !candidates.iter().any(|candidate| {
            candidate["kind"] == "api_route_requires_auth_helper"
                && candidate["matcher"]["required_calls"]
                    .as_array()
                    .is_some_and(|calls| calls.iter().any(|call| call == "withWorkspace"))
        }),
        "withWorkspace must not be recognised as an auth helper: it matched only because dub's \
         wrapper name was hardcoded in the engine. {payload:#?}"
    );
}

#[test]
fn infer_candidates_does_not_treat_body_parser_as_validation_pattern() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [],
            "graph_edges": [],
            "graph_evidence": []
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                {
                    "file_path": "app/api/oauth/apps/route.ts",
                    "content_hash": "a".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "app/api/tokens/route.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                }
            ],
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/oauth/apps/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 8
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/oauth/apps/route.ts",
                    "name": "parseRequestBody",
                    "value": "@/lib/api/utils",
                    "imported_name": "parseRequestBody",
                    "start_line": 1,
                    "end_line": 1
                },
                {
                    "kind": "symbol_called",
                    "file_path": "app/api/oauth/apps/route.ts",
                    "name": "parseRequestBody",
                    "start_line": 4,
                    "end_line": 4
                },
                {
                    "kind": "file_role_detected",
                    "file_path": "app/api/tokens/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 8
                },
                {
                    "kind": "import_used",
                    "file_path": "app/api/tokens/route.ts",
                    "name": "parseRequestBody",
                    "value": "@/lib/api/utils",
                    "imported_name": "parseRequestBody",
                    "start_line": 1,
                    "end_line": 1
                },
                {
                    "kind": "symbol_called",
                    "file_path": "app/api/tokens/route.ts",
                    "name": "parseRequestBody",
                    "start_line": 4,
                    "end_line": 4
                }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");

    assert!(
        !candidates.iter().any(|candidate| {
            candidate["kind"] == "api_route_requires_request_validation"
                && candidate["requires"]["validators"][0]["symbol"] == "parseRequestBody"
        }),
        "{payload:#?}"
    );
}

#[test]
fn infer_candidates_keeps_distinct_validation_patterns_separate() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [],
            "graph_edges": [],
            "graph_evidence": []
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                {
                    "file_path": "app/api/apps/route.ts",
                    "content_hash": "a".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "app/api/tokens/route.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "app/api/webhooks/route.ts",
                    "content_hash": "c".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "app/api/webhooks/[id]/route.ts",
                    "content_hash": "d".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                }
            ],
            "facts": [
                { "kind": "file_role_detected", "file_path": "app/api/apps/route.ts", "name": "api_route", "start_line": 1, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/apps/route.ts", "name": "parseRequestBody", "start_line": 4, "end_line": 4 },
                { "kind": "file_role_detected", "file_path": "app/api/tokens/route.ts", "name": "api_route", "start_line": 1, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/tokens/route.ts", "name": "parseRequestBody", "start_line": 4, "end_line": 4 },
                { "kind": "file_role_detected", "file_path": "app/api/webhooks/route.ts", "name": "api_route", "start_line": 1, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/webhooks/route.ts", "name": "validateWebhook", "start_line": 4, "end_line": 4 },
                { "kind": "file_role_detected", "file_path": "app/api/webhooks/[id]/route.ts", "name": "api_route", "start_line": 1, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/webhooks/[id]/route.ts", "name": "validateWebhook", "start_line": 4, "end_line": 4 }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let validation_candidates = payload["candidates"]
        .as_array()
        .expect("candidates")
        .iter()
        .filter(|candidate| candidate["kind"] == "api_route_requires_request_validation")
        .collect::<Vec<_>>();
    let validators = validation_candidates
        .iter()
        .filter_map(|candidate| candidate["requires"]["validators"][0]["symbol"].as_str())
        .collect::<Vec<_>>();
    let candidate_ids = validation_candidates
        .iter()
        .filter_map(|candidate| candidate["candidate_id"].as_str())
        .collect::<std::collections::BTreeSet<_>>();

    assert!(validators.contains(&"validateWebhook"), "{payload:#?}");
    assert!(!validators.contains(&"parseRequestBody"), "{payload:#?}");
    assert_eq!(
        candidate_ids.len(),
        validation_candidates.len(),
        "{payload:#?}"
    );
}

#[test]
fn infer_candidates_filters_security_helper_noise_from_body_error_event_and_precondition_symbols() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [],
            "graph_edges": [],
            "graph_evidence": []
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                {
                    "file_path": "app/api/oauth/apps/route.ts",
                    "content_hash": "a".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "app/api/oauth/tokens/route.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                }
            ],
            "facts": [
                { "kind": "file_role_detected", "file_path": "app/api/oauth/apps/route.ts", "name": "api_route", "start_line": 1, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/apps/route.ts", "name": "parseRequestBody", "start_line": 4, "end_line": 4 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/apps/route.ts", "name": "exceededLimitError", "start_line": 5, "end_line": 5 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/apps/route.ts", "name": "accountApplicationDeauthorized", "start_line": 6, "end_line": 6 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/apps/route.ts", "name": "throwIfNoPartnerIdOrTenantId", "start_line": 7, "end_line": 7 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/apps/route.ts", "name": "revalidatePath", "start_line": 8, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/apps/route.ts", "name": "validateScopesForRole", "start_line": 9, "end_line": 9 },
                { "kind": "file_role_detected", "file_path": "app/api/oauth/tokens/route.ts", "name": "api_route", "start_line": 1, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/tokens/route.ts", "name": "parseRequestBody", "start_line": 4, "end_line": 4 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/tokens/route.ts", "name": "exceededLimitError", "start_line": 5, "end_line": 5 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/tokens/route.ts", "name": "accountApplicationDeauthorized", "start_line": 6, "end_line": 6 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/tokens/route.ts", "name": "throwIfNoPartnerIdOrTenantId", "start_line": 7, "end_line": 7 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/tokens/route.ts", "name": "revalidatePath", "start_line": 8, "end_line": 8 },
                { "kind": "symbol_called", "file_path": "app/api/oauth/tokens/route.ts", "name": "validateScopesForRole", "start_line": 9, "end_line": 9 }
            ]
        }
    });
    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");
    let blocked_symbols = [
        ("api_route_requires_request_validation", "parseRequestBody"),
        ("api_route_requires_rate_limit", "exceededLimitError"),
        (
            "api_route_requires_auth_helper",
            "accountApplicationDeauthorized",
        ),
        (
            "api_route_requires_tenant_scope",
            "throwIfNoPartnerIdOrTenantId",
        ),
        ("api_route_requires_request_validation", "revalidatePath"),
        (
            "api_route_requires_request_validation",
            "validateScopesForRole",
        ),
    ];

    for (kind, symbol) in blocked_symbols {
        assert!(
            !candidates.iter().any(|candidate| {
                candidate["kind"] == kind
                    && candidate["matcher"]["required_calls"]
                        .as_array()
                        .is_some_and(|calls| calls.iter().any(|call| call == symbol))
            }),
            "unexpected {kind} candidate for {symbol}: {payload:#?}"
        );
    }
}

#[test]
fn infer_candidates_uses_graph_evidence_without_raw_import_facts() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:app/api/users/route.ts", "file", "app/api/users/route.ts", json!({ "path": "app/api/users/route.ts" })),
                graph_node("file:src/lib/db.ts", "file", "src/lib/db.ts", json!({ "path": "src/lib/db.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("file_role:data_access_module", "file_role", "data_access_module", json!({ "role": "data_access_module" })),
                graph_node("module:app/api/users/route.ts", "module", "app/api/users/route.ts", json!({ "file_path": "app/api/users/route.ts" })),
                graph_node("module:src/lib/db.ts", "module", "src/lib/db.ts", json!({ "file_path": "src/lib/db.ts" })),
                {
                    "id": "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1",
                    "kind": "import_decl",
                    "label": "db from @/lib/db",
                    "stable": false,
                    "evidence_ids": ["evidence_import"],
                    "metadata": {
                        "file_path": "app/api/users/route.ts",
                        "source": "@/lib/db",
                        "local_name": "db",
                        "imported_name": "db",
                        "resolved_file_path": "src/lib/db.ts",
                        "resolved_module_id": "module:src/lib/db.ts"
                    }
                }
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:app/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_HAS_ROLE", "file:src/lib/db.ts", "file_role:data_access_module"),
                graph_edge("FILE_DEFINES_MODULE", "file:app/api/users/route.ts", "module:app/api/users/route.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:src/lib/db.ts", "module:src/lib/db.ts"),
                graph_edge_with_evidence("IMPORT_DECL_REFERENCES_MODULE", "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1", "module:app/api/users/route.ts", "evidence_import"),
                graph_edge_with_evidence("IMPORT_RESOLVES_TO_MODULE", "import_decl:app/api/users/route.ts:aaaaaaaaaaaa:@/lib/db:db:1-1", "module:src/lib/db.ts", "evidence_import")
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
                "fact_ids": ["fact_graph_import"],
                "redaction_state": "none"
            }]
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
                    "file_path": "src/lib/db.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 80,
                    "indexed": true
                }
            ],
            "facts": []
        }
    });
    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");
    let direct = candidates
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_no_direct_data_access")
        .expect("direct data-access candidate");

    assert_eq!(direct["matcher"]["forbidden_imports"], json!(["@/lib/db"]));
    assert_eq!(direct["evidence_refs"][0]["id"], "evidence_import");
    assert_eq!(
        direct["evidence_refs"][0]["fact_ids"],
        json!(["fact_graph_import"])
    );
    assert_eq!(
        direct["required_capabilities"],
        json!(["syntax_facts", "import_resolution", "route_detection"])
    );
}

#[test]
fn infer_candidates_does_not_make_api_route_helpers_direct_data_access_forbidden_imports() {
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": {
            "graph_nodes": [
                graph_node("file:apps/web/app/(ee)/api/users/route.ts", "file", "apps/web/app/(ee)/api/users/route.ts", json!({ "path": "apps/web/app/(ee)/api/users/route.ts" })),
                graph_node("file:apps/web/app/(ee)/api/users/loaders.ts", "file", "apps/web/app/(ee)/api/users/loaders.ts", json!({ "path": "apps/web/app/(ee)/api/users/loaders.ts" })),
                graph_node("file_role:api_route", "file_role", "api_route", json!({ "role": "api_route" })),
                graph_node("file_role:data_access_module", "file_role", "data_access_module", json!({ "role": "data_access_module" })),
                graph_node("module:apps/web/app/(ee)/api/users/route.ts", "module", "apps/web/app/(ee)/api/users/route.ts", json!({ "file_path": "apps/web/app/(ee)/api/users/route.ts" })),
                graph_node("module:apps/web/app/(ee)/api/users/loaders.ts", "module", "apps/web/app/(ee)/api/users/loaders.ts", json!({ "file_path": "apps/web/app/(ee)/api/users/loaders.ts" })),
                {
                    "id": "import_decl:apps/web/app/(ee)/api/users/route.ts:aaaaaaaaaaaa:./loaders:loadUsers:1-1",
                    "kind": "import_decl",
                    "label": "loadUsers from ./loaders",
                    "stable": false,
                    "evidence_ids": ["evidence_route_helper_import"],
                    "metadata": {
                        "file_path": "apps/web/app/(ee)/api/users/route.ts",
                        "source": "./loaders",
                        "local_name": "loadUsers",
                        "imported_name": "loadUsers",
                        "resolved_file_path": "apps/web/app/(ee)/api/users/loaders.ts",
                        "resolved_module_id": "module:apps/web/app/(ee)/api/users/loaders.ts"
                    }
                }
            ],
            "graph_edges": [
                graph_edge("FILE_HAS_ROLE", "file:apps/web/app/(ee)/api/users/route.ts", "file_role:api_route"),
                graph_edge("FILE_HAS_ROLE", "file:apps/web/app/(ee)/api/users/loaders.ts", "file_role:data_access_module"),
                graph_edge("FILE_DEFINES_MODULE", "file:apps/web/app/(ee)/api/users/route.ts", "module:apps/web/app/(ee)/api/users/route.ts"),
                graph_edge("FILE_DEFINES_MODULE", "file:apps/web/app/(ee)/api/users/loaders.ts", "module:apps/web/app/(ee)/api/users/loaders.ts"),
                graph_edge_with_evidence("IMPORT_DECL_REFERENCES_MODULE", "import_decl:apps/web/app/(ee)/api/users/route.ts:aaaaaaaaaaaa:./loaders:loadUsers:1-1", "module:apps/web/app/(ee)/api/users/route.ts", "evidence_route_helper_import"),
                graph_edge_with_evidence("IMPORT_RESOLVES_TO_MODULE", "import_decl:apps/web/app/(ee)/api/users/route.ts:aaaaaaaaaaaa:./loaders:loadUsers:1-1", "module:apps/web/app/(ee)/api/users/loaders.ts", "evidence_route_helper_import")
            ],
            "graph_evidence": [{
                "id": "evidence_route_helper_import",
                "repo_id": "repo_abc",
                "scan_id": "scan_abc",
                "artifact_id": "file_version:apps/web/app/(ee)/api/users/route.ts:aaaaaaaaaaaa",
                "file_path": "apps/web/app/(ee)/api/users/route.ts",
                "file_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "start_line": 1,
                "end_line": 1,
                "adapter_id": "typescript",
                "adapter_version": "0.1.0",
                "fact_ids": ["fact_route_helper_import"],
                "redaction_state": "none"
            }]
        },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                {
                    "file_path": "apps/web/app/(ee)/api/users/route.ts",
                    "content_hash": "a".repeat(64),
                    "byte_size": 120,
                    "indexed": true
                },
                {
                    "file_path": "apps/web/app/(ee)/api/users/loaders.ts",
                    "content_hash": "b".repeat(64),
                    "byte_size": 80,
                    "indexed": true
                }
            ],
            "facts": [
                { "kind": "file_role_detected", "file_path": "apps/web/app/(ee)/api/users/loaders.ts", "name": "data_access_module", "start_line": 1, "end_line": 20 },
                { "kind": "import_used", "file_path": "apps/web/app/(ee)/api/users/loaders.ts", "name": "prisma", "value": "@dub/prisma", "start_line": 1, "end_line": 1 }
            ]
        }
    });
    let payload = run_infer_candidates(request);

    assert!(
        !payload["candidates"]
            .as_array()
            .expect("candidates")
            .iter()
            .any(|candidate| candidate["kind"] == "api_route_no_direct_data_access"),
        "{payload:#?}"
    );
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

    assert_eq!(
        payload["candidates"].as_array().expect("candidates").len(),
        0
    );
}

#[test]
fn infer_candidates_uses_route_group_aware_api_scope_globs() {
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
                "file_path": "apps/web/app/(admin)/api/users/route.ts",
                "content_hash": "a".repeat(64),
                "byte_size": 120,
                "indexed": true
            }],
            "facts": [
                {
                    "kind": "file_role_detected",
                    "file_path": "apps/web/app/(admin)/api/users/route.ts",
                    "name": "api_route",
                    "start_line": 1,
                    "end_line": 5
                },
                {
                    "kind": "import_used",
                    "file_path": "apps/web/app/(admin)/api/users/route.ts",
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
    let direct = candidates
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_no_direct_data_access")
        .expect("direct data-access candidate");

    assert_eq!(
        direct["scope"]["path_globs"],
        // D-H2: `app/**` rather than `app/api/**`. Under the App Router any `route.ts` is a
        // handler, and the narrower globs missed 27 real handlers across the corpus.
        json!([
            "**/app/**/route.ts",
            "**/app/**/route.tsx",
            "**/app/**/route.js",
            "**/app/**/route.jsx",
            "**/pages/api/**/*.ts",
            "**/pages/api/**/*.tsx",
            "**/pages/api/**/*.js",
            "**/pages/api/**/*.jsx"
        ])
    );
}

#[test]
fn infer_candidates_emits_security_phase_candidates_as_non_blocking_elections() {
    let route_a = "app/api/users/route.ts";
    let route_b = "app/api/projects/route.ts";
    let facts = json!([
        { "kind": "file_role_detected", "file_path": route_a, "name": "api_route", "start_line": 1, "end_line": 5 },
        { "kind": "file_role_detected", "file_path": route_b, "name": "api_route", "start_line": 1, "end_line": 5 },
        { "kind": "import_used", "file_path": route_a, "name": "requireUser", "value": "@/auth", "start_line": 1, "end_line": 1 },
        { "kind": "import_used", "file_path": route_b, "name": "requireUser", "value": "@/auth", "start_line": 1, "end_line": 1 },
        { "kind": "symbol_called", "file_path": route_a, "name": "requireUser", "start_line": 4, "end_line": 4 },
        { "kind": "symbol_called", "file_path": route_b, "name": "requireUser", "start_line": 4, "end_line": 4 },
        { "kind": "request_validation_called", "file_path": route_a, "name": "validateBody", "start_line": 5, "end_line": 5 },
        { "kind": "request_validation_called", "file_path": route_b, "name": "validateBody", "start_line": 5, "end_line": 5 },
        { "kind": "authorization_guard_called", "file_path": route_a, "name": "requireRole", "start_line": 6, "end_line": 6 },
        { "kind": "authorization_guard_called", "file_path": route_b, "name": "requireRole", "start_line": 6, "end_line": 6 },
        { "kind": "tenant_guard_called", "file_path": route_a, "name": "scopeTenant", "start_line": 7, "end_line": 7 },
        { "kind": "tenant_guard_called", "file_path": route_b, "name": "scopeTenant", "start_line": 7, "end_line": 7 },
        { "kind": "serializer_called", "file_path": route_a, "name": "serializeUser", "start_line": 8, "end_line": 8 },
        { "kind": "serializer_called", "file_path": route_b, "name": "serializeUser", "start_line": 8, "end_line": 8 },
        { "kind": "parameterized_sql_used", "file_path": route_a, "name": "safeQuery", "start_line": 9, "end_line": 9 },
        { "kind": "parameterized_sql_used", "file_path": route_b, "name": "safeQuery", "start_line": 9, "end_line": 9 },
        { "kind": "symbol_called", "file_path": route_a, "name": "allowlistedUrl", "start_line": 9, "end_line": 9 },
        { "kind": "symbol_called", "file_path": route_b, "name": "allowlistedUrl", "start_line": 9, "end_line": 9 },
        { "kind": "csrf_guard_called", "file_path": route_a, "name": "requireCsrf", "start_line": 10, "end_line": 10 },
        { "kind": "csrf_guard_called", "file_path": route_b, "name": "requireCsrf", "start_line": 10, "end_line": 10 },
        { "kind": "rate_limit_guard_called", "file_path": route_a, "name": "rateLimit", "start_line": 11, "end_line": 11 },
        { "kind": "rate_limit_guard_called", "file_path": route_b, "name": "rateLimit", "start_line": 11, "end_line": 11 },
        { "kind": "cors_policy_declared", "file_path": route_a, "name": "cors", "value": "{\"origin\":\"https://app.example.com\",\"allow_credentials\":true}", "start_line": 12, "end_line": 12 },
        { "kind": "sensitive_field_declared", "file_path": route_a, "name": "password", "value": "{\"field_path\":\"password\",\"classification\":\"credential\"}", "start_line": 13, "end_line": 13 }
    ]);
    let request = json!({
        "repo": { "repo_id": "repo_abc" },
        "graph": { "graph_nodes": [], "graph_edges": [], "graph_evidence": [] },
        "scan": {
            "scan_id": "scan_abc",
            "file_snapshots": [
                { "file_path": route_a, "content_hash": "a".repeat(64), "byte_size": 120, "indexed": true },
                { "file_path": route_b, "content_hash": "b".repeat(64), "byte_size": 120, "indexed": true }
            ],
            "facts": facts
        }
    });

    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");
    for expected in [
        "api_route_requires_auth_helper",
        "api_route_requires_request_validation",
        "api_route_requires_authorization",
        "api_route_requires_tenant_scope",
        "api_route_forbids_sensitive_response_fields",
        "api_route_forbids_raw_sql_without_params",
        "api_route_forbids_untrusted_ssrf",
        "api_route_requires_csrf_for_mutation",
        "api_route_requires_rate_limit",
        "api_route_cors_must_match_policy",
    ] {
        let candidate = candidates
            .iter()
            .find(|candidate| candidate["kind"] == expected)
            .unwrap_or_else(|| panic!("missing {expected}: {payload:#?}"));
        assert_eq!(candidate["suggested_enforcement_mode"], "warn");
        assert_eq!(candidate["reason_not_blocking"], "candidate_not_accepted");
        assert!(
            candidate["requires"].is_object(),
            "missing requires for {expected}"
        );
        assert!(
            candidate["evidence_fingerprint"]
                .as_str()
                .is_some_and(|value| !value.is_empty()),
            "missing evidence fingerprint for {expected}: {candidate:#?}"
        );
    }
}

#[test]
fn scan_repo_then_infer_candidates_covers_phase7_security_candidate_families() {
    let repo_root = temp_repo_root("phase7-candidate-coverage");
    write_phase7_candidate_fixture(&repo_root);

    let scan = run_scan_repo(&repo_root);
    let request = json!({
        "repo": { "repo_id": "repo_phase7" },
        "graph": { "graph_nodes": [], "graph_edges": [], "graph_evidence": [] },
        "scan": {
            "scan_id": "scan_phase7",
            "file_snapshots": scan["file_snapshots"].clone(),
            "facts": scan["facts"].clone(),
        }
    });
    let payload = run_infer_candidates(request);
    let candidates = payload["candidates"].as_array().expect("candidates");

    for expected in [
        "api_route_requires_auth_helper",
        "middleware_must_cover_routes",
        "api_route_requires_request_validation",
        "api_route_requires_authorization",
        "api_route_requires_tenant_scope",
        "api_route_forbids_sensitive_response_fields",
        "api_route_forbids_raw_sql_without_params",
        "api_route_forbids_untrusted_ssrf",
        "api_route_requires_csrf_for_mutation",
        "api_route_requires_rate_limit",
        "api_route_cors_must_match_policy",
    ] {
        let candidate = candidates
            .iter()
            .find(|candidate| candidate["kind"] == expected)
            .unwrap_or_else(|| panic!("missing {expected}: {payload:#?}"));
        assert_eq!(candidate["suggested_enforcement_mode"], "warn");
        assert_eq!(candidate["reason_not_blocking"], "candidate_not_accepted");
        assert!(
            candidate["requires"].is_object(),
            "missing requires for {expected}"
        );
    }

    let cors = candidates
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_cors_must_match_policy")
        .expect("cors candidate");
    assert_eq!(
        cors["requires"]["allowed_origins"],
        json!(["https://app.example.com"])
    );

    let ssrf = candidates
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_forbids_untrusted_ssrf")
        .expect("ssrf candidate");
    assert_eq!(
        ssrf["requires"]["outbound_url_allowlist_helpers"][0]["module"],
        "@/server/url"
    );

    let csrf = candidates
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_requires_csrf_for_mutation")
        .expect("csrf candidate");
    assert_eq!(
        csrf["requires"]["csrf_helpers"][0]["module"],
        "@/server/csrf"
    );

    let serializer = candidates
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_forbids_sensitive_response_fields")
        .and_then(|candidate| candidate["requires"]["response_serializers"].as_array())
        .and_then(|serializers| serializers.first())
        .expect("serializer candidate");
    assert_eq!(serializer["import_source"], "@/server/serializers");
    assert_eq!(serializer["imported_name"], "serializeUser");
    assert_eq!(serializer["policy"], "denylist");

    fs::remove_dir_all(repo_root).ok();
}

/// E-6 (decision D-2, TDD S1-06): enforcement direction is frozen to the baseline scan.
///
/// T100's recall improvement demoted taxonomy block -> warn silently: newly-detected
/// violations in the analyzed diff pushed the violating ratio past the 50% threshold, so
/// better detection weakened enforcement. Direction must be computed from the files that
/// were already part of the repo (the baseline), never from files the current diff added.
fn direction_request(
    baseline_clean: usize,
    baseline_violating: usize,
    diff_violating: usize,
    declare_diff: bool,
) -> Value {
    let mut facts = Vec::new();
    let mut snapshots = Vec::new();
    let mut diff_changed_files = Vec::new();
    let mut add_route = |name: &str, violating: bool, in_diff: bool| {
        let path = format!("app/api/{name}/route.ts");
        snapshots.push(json!({
            "file_path": path,
            "content_hash": "a".repeat(64),
            "byte_size": 120,
            "indexed": true
        }));
        facts.push(json!({
            "kind": "file_role_detected",
            "file_path": path,
            "name": "api_route",
            "start_line": 1,
            "end_line": 5
        }));
        if violating {
            facts.push(json!({
                "kind": "import_used",
                "file_path": path,
                "name": "db",
                "value": "@/lib/db",
                "start_line": 1,
                "end_line": 1
            }));
        }
        if in_diff {
            diff_changed_files.push(json!(path));
        }
    };
    for index in 0..baseline_clean {
        add_route(&format!("clean{index}"), false, false);
    }
    for index in 0..baseline_violating {
        add_route(&format!("bad{index}"), true, false);
    }
    for index in 0..diff_violating {
        add_route(&format!("diffbad{index}"), true, true);
    }
    let mut request = json!({
        "repo": { "repo_id": "repo_direction" },
        "graph": { "graph_nodes": [], "graph_edges": [], "graph_evidence": [] },
        "scan": {
            "scan_id": "scan_direction",
            "file_snapshots": snapshots,
            "facts": facts
        }
    });
    if declare_diff {
        request["diff_changed_files"] = json!(diff_changed_files);
    }
    request
}

#[test]
fn coverage_direction_is_frozen_to_baseline_scan_not_the_analyzed_diff() {
    // Baseline: 1 violating of 4 scope files -> block. The diff adds 5 newly-detected
    // violating routes; recomputing over everything reads 6/9 > 0.5 -> warn. That is the
    // exact T100 pathology: improved recall (more detected violations in the analyzed
    // diff) silently demoting enforcement.
    let payload = run_infer_candidates(direction_request(3, 1, 5, true));
    let direct = direct_data_access_candidate(&payload);

    assert_eq!(
        direct["suggested_enforcement_mode"], "block",
        "newly-detected violations in the diff must not argue the convention down: {direct:#?}"
    );
    let direction = &direct["scoring"]["coverage_direction"];
    assert_eq!(direction["violating_files"], 1, "{direction:#?}");
    assert_eq!(direction["scope_files"], 4, "{direction:#?}");
    assert_eq!(direction["demoted"], false, "{direction:#?}");

    // Control: the same shape with no diff information keeps today's behaviour (6/9 -> warn),
    // so the freeze is driven by the declared diff, not by a blanket weakening of the gate.
    let undeclared = run_infer_candidates(direction_request(3, 1, 5, false));
    assert_eq!(
        direct_data_access_candidate(&undeclared)["suggested_enforcement_mode"],
        "warn"
    );
}

#[test]
fn legitimate_baseline_demotion_is_explicit_never_silent() {
    // The baseline itself violates in the majority: 4 of 5 scope files. warn is the
    // documented, correct direction (an aspiration, not a rule) - but it must carry an
    // explicit machine-readable marker so no consumer can mistake it for a silent flip.
    let payload = run_infer_candidates(direction_request(1, 4, 0, true));
    let direct = direct_data_access_candidate(&payload);

    assert_eq!(direct["suggested_enforcement_mode"], "warn");
    let direction = &direct["scoring"]["coverage_direction"];
    assert_eq!(direction["violating_files"], 4, "{direction:#?}");
    assert_eq!(direction["scope_files"], 5, "{direction:#?}");
    assert_eq!(direction["threshold"], 0.5, "{direction:#?}");
    assert_eq!(
        direction["demoted"], true,
        "a baseline-driven demotion must be explicit: {direction:#?}"
    );
    let ratio = direction["violation_ratio"].as_f64().expect("ratio");
    assert!((ratio - 0.8).abs() < 1e-9, "{direction:#?}");
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

fn direct_data_access_candidate(payload: &Value) -> &Value {
    payload["candidates"]
        .as_array()
        .expect("candidates")
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_no_direct_data_access")
        .expect("direct data-access candidate")
}

fn evidence_symbols(candidate: &Value) -> Vec<&str> {
    candidate["evidence_refs"]
        .as_array()
        .expect("evidence refs")
        .iter()
        .map(|reference| reference["symbol"].as_str().expect("symbol"))
        .collect()
}

fn run_scan_repo(repo_root: &Path) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg("scan-repo")
        .arg(repo_root)
        .arg("--format")
        .arg("json")
        .arg("--repo-id")
        .arg("repo_phase7")
        .arg("--scan-id")
        .arg("scan_phase7")
        .output()
        .expect("run scan-repo");
    assert!(
        output.status.success(),
        "scan failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("scan json")
}

fn temp_repo_root(prefix: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("{prefix}-{}-{suffix}", std::process::id()));
    fs::create_dir_all(&path).expect("create temp repo");
    path
}

fn write_phase7_candidate_fixture(repo_root: &Path) {
    fs::write(
        repo_root.join("middleware.ts"),
        r#"
import { NextResponse } from "next/server";

export async function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
"#,
    )
    .expect("write middleware");

    for name in ["users", "projects"] {
        let dir = repo_root.join(format!("app/api/{name}"));
        fs::create_dir_all(&dir).expect("create route dir");
        fs::write(
            dir.join("route.ts"),
            r#"
import { requireUser } from "@/server/auth";
import { validateBody } from "@/server/validation";
import { requireRole } from "@/server/authorization";
import { scopeTenant } from "@/server/tenant";
import { serializeUser } from "@/server/serializers";
import { safeUrl } from "@/server/url";
import { requireCsrf } from "@/server/csrf";
import { rateLimit } from "@/server/rate-limit";
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  const user = await requireUser();
  const input = validateBody(body);
  requireRole(user, "admin");
  const tenantId = scopeTenant(user);
  await requireCsrf(request);
  await rateLimit(request);
  const target = safeUrl(input.callbackUrl);
  await fetch(target);
  await db.query("select * from users where id = $1", [input.id]);
  const row = { id: input.id, password: "redacted", tenantId };
  const safe = serializeUser(row);
  return Response.json(safe, {
    headers: {
      "Access-Control-Allow-Origin": "https://app.example.com",
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
"#,
        )
        .expect("write route");
    }
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
