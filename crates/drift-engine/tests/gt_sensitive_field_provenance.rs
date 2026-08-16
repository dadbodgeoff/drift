//! D1 — sensitive-field provenance and the dead-config diagnostic (TDD §5.1).
//!
//! These pin the Rust half of the P0. They are deliberately *not* the primary evidence: the seam
//! D1 lived in runs from the proposer, through `drift conventions accept` in TypeScript, into the
//! prover, and only `test/e2e/gt-sensitive-fields.test.ts` crosses it. C2 is the point — both
//! halves of D1 were already unit-tested, and neither could see that the proposer emitted a value
//! the prover discards. What these add is the boundary behaviour a workflow test states less
//! precisely: which provenance survives proposal, which `source` values parse, and that a value
//! that does not parse is reported instead of silently dropped.

use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

/// The proposer must carry the originating fact's provenance, not overwrite it.
///
/// `candidate_command.rs` hardcoded `"source": "candidate"` into every proposed field, so a field
/// the user had marked `driftSensitive` — extracted as `"schema"` — was relabelled an unreviewed
/// guess and then discarded by the proof. Both rows below ran identically before the fix.
#[test]
fn proposal_preserves_sensitive_field_provenance() {
    for (declared_source, expected_source) in [("schema", "schema"), ("candidate", "candidate")] {
        let payload = run_infer_candidates(sensitive_candidate_request(Some(declared_source)));
        let fields = proposed_sensitive_fields(&payload);

        assert_eq!(
            fields.len(),
            1,
            "expected one proposed field for source {declared_source}: {payload:#?}"
        );
        assert_eq!(
            fields[0]["source"], expected_source,
            "provenance {declared_source} must survive proposal: {payload:#?}"
        );
        assert_eq!(fields[0]["field_path"], "password");
        assert_eq!(fields[0]["classification"], "credential");
    }
}

/// A fact carrying no provenance at all still has to propose *something*, and the conservative
/// answer is the unreviewed one. This pins that the fix propagates rather than inventing.
#[test]
fn proposal_falls_back_to_candidate_when_the_fact_declares_no_source() {
    let payload = run_infer_candidates(sensitive_candidate_request(None));
    let fields = proposed_sensitive_fields(&payload);

    assert_eq!(fields.len(), 1, "{payload:#?}");
    assert_eq!(fields[0]["source"], "candidate", "{payload:#?}");
}

/// The allowlist half of the fix. Without `"accepted_inference"` here,
/// `accepted_sensitive_response_field` returns `None`, the field never reaches the trust filter,
/// and the check goes on never firing — with nothing reported. That is the trap C1 identified.
#[test]
fn the_allowlist_accepts_every_provenance_the_pipeline_can_produce() {
    for source in ["contract", "schema", "candidate", "accepted_inference"] {
        let requires = json!({
            "sensitive_response_fields": [{
                "field_path": "password",
                "classification": "credential",
                "source": source
            }]
        });
        let accepted = drift_engine::accepted_phase5_contract_from_requires(&requires)
            .unwrap_or_else(|| panic!("source {source} must parse"));
        assert_eq!(accepted.sensitive_response_fields.len(), 1);
        assert_eq!(accepted.sensitive_response_fields[0].source, source);
        assert!(
            drift_engine::SENSITIVE_FIELD_SOURCES.contains(&source),
            "{source} must be declared in SENSITIVE_FIELD_SOURCES"
        );
    }
}

/// `"candidate"` is an unreviewed guess and stays unenforceable; every other provenance names a
/// human. This is the invariant the `security_proof.rs` filter documents, asserted rather than
/// only commented — the comment is what a future reader has; this is what CI has.
#[test]
fn only_unreviewed_guesses_are_excluded_from_enforcement() {
    assert!(!drift_engine::sensitive_field_source_is_trusted(
        "candidate"
    ));
    for source in ["contract", "schema", "accepted_inference"] {
        assert!(
            drift_engine::sensitive_field_source_is_trusted(source),
            "{source} carries a human and must be enforceable"
        );
    }
}

/// §5.1.4, the parse-failure half. Both allowlists fail closed and used to fail *silent*.
#[test]
fn an_unparseable_entry_is_named_rather_than_dropped() {
    let cases = [
        (
            json!({ "field_path": "password", "classification": "secret", "source": "schema" }),
            "unknown classification",
        ),
        (
            json!({ "field_path": "password", "classification": "credential", "source": "accepted" }),
            "unknown source",
        ),
        (
            json!({ "classification": "credential", "source": "schema" }),
            "missing field_path",
        ),
        (
            json!({ "field_path": "password", "source": "schema" }),
            "missing classification",
        ),
        (
            json!({ "field_path": "password", "classification": "credential" }),
            "missing source",
        ),
    ];

    for (entry, expected) in cases {
        let requires = json!({ "sensitive_response_fields": [entry.clone()] });
        assert!(
            drift_engine::accepted_phase5_contract_from_requires(&requires)
                .map(|accepted| accepted.sensitive_response_fields.is_empty())
                .unwrap_or(true),
            "{entry} must not parse"
        );
        let rejections = drift_engine::sensitive_response_field_rejections(&requires);
        assert_eq!(rejections.len(), 1, "{entry} -> {rejections:?}");
        assert!(
            rejections[0].contains(expected),
            "{entry} -> {rejections:?}, expected to mention {expected:?}"
        );
    }
}

#[test]
fn a_readable_entry_produces_no_rejection() {
    let requires = json!({
        "sensitive_response_fields": [{
            "field_path": "password",
            "classification": "credential",
            "source": "accepted_inference"
        }]
    });
    assert!(drift_engine::sensitive_response_field_rejections(&requires).is_empty());
}

/// The diagnostic reaching `check` output, through the real engine binary.
///
/// A hand-built contract is legitimate here and only here: this asserts that a *broken* config is
/// reported, not that a convention fires. The injection ban exists because a hand-built convention
/// cannot be evidence that the proposer-to-prover seam works — and nothing about this test claims
/// that. The seam itself is covered end to end in `test/e2e/gt-sensitive-fields.test.ts`.
///
/// The unknown `classification` is §5.1's own named substitution for the pre-fix-state-DB fixture:
/// the extractor normalises an unrecognised `driftSensitive` marker to `"internal"`, so no fixture
/// can drive an allowlist rejection through the real workflow.
#[test]
fn check_reports_an_accepted_convention_it_cannot_read() {
    let repo_root = temp_repo("d1_dead_config");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  const password = 'hunter2';\n  return Response.json({ password });\n}\n",
    );

    let payload = run_check_repo(check_request(
        &repo_root,
        json!({
            "sensitive_response_fields": [{
                "field_path": "password",
                "classification": "no_such_classification",
                "source": "schema"
            }]
        }),
    ));

    let diagnostics = payload["diagnostics"].as_array().expect("diagnostics");
    let unreadable = diagnostics
        .iter()
        .find(|diagnostic| diagnostic["code"] == "convention_config_unreadable")
        .unwrap_or_else(|| panic!("expected a dead-config diagnostic: {payload:#?}"));
    let message = unreadable["message"].as_str().expect("message");
    assert!(
        message.contains("security_api_sensitive_response"),
        "the diagnostic must name the convention: {message}"
    );
    assert!(
        message.contains("no_such_classification"),
        "the diagnostic must name the offending value: {message}"
    );
}

/// The second §5.1.4 failure mode: everything parsed, and the trust filter then discarded all of
/// it. This is the state every convention accepted before the D1 fix is in, and the reason the
/// plan ships this diagnostic instead of a state-DB migration.
#[test]
fn check_reports_an_accepted_convention_with_nothing_left_to_enforce() {
    let repo_root = temp_repo("d1_all_untrusted");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  const password = 'hunter2';\n  return Response.json({ password });\n}\n",
    );

    let payload = run_check_repo(check_request(
        &repo_root,
        json!({
            "sensitive_response_fields": [{
                "field_path": "password",
                "classification": "credential",
                "source": "candidate"
            }]
        }),
    ));

    let diagnostics = payload["diagnostics"].as_array().expect("diagnostics");
    assert!(
        diagnostics
            .iter()
            .any(|diagnostic| diagnostic["code"] == "convention_config_unenforceable"),
        "a convention made only of unreviewed guesses enforces nothing and must say so: {payload:#?}"
    );
    assert_eq!(
        payload["findings"].as_array().map(Vec::len),
        Some(0),
        "and it must still not enforce: {payload:#?}"
    );
}

#[test]
fn check_stays_quiet_when_the_accepted_config_is_enforceable() {
    let repo_root = temp_repo("d1_healthy_config");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  const password = 'hunter2';\n  return Response.json({ password });\n}\n",
    );

    let payload = run_check_repo(check_request(
        &repo_root,
        json!({
            "sensitive_response_fields": [{
                "field_path": "password",
                "classification": "credential",
                "source": "accepted_inference"
            }]
        }),
    ));

    let diagnostics = payload["diagnostics"].as_array().expect("diagnostics");
    assert!(
        diagnostics.iter().all(|diagnostic| {
            diagnostic["code"] != "convention_config_unenforceable"
                && diagnostic["code"] != "convention_config_unreadable"
        }),
        "{payload:#?}"
    );
    // The negative above is only meaningful if the convention was live: an accepted_inference
    // field does enforce, so the leaking route is flagged.
    assert_eq!(
        payload["findings"].as_array().map(Vec::len),
        Some(1),
        "{payload:#?}"
    );
}

fn sensitive_candidate_request(declared_source: Option<&str>) -> Value {
    let mut value = json!({
        "field_path": "password",
        "classification": "credential"
    });
    if let Some(source) = declared_source {
        value["source"] = json!(source);
    }

    json!({
        "repo": { "repo_id": "repo_d1" },
        "graph": { "graph_nodes": [], "graph_edges": [], "graph_evidence": [] },
        "scan": {
            "scan_id": "scan_d1",
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
                    "kind": "sensitive_field_declared",
                    "file_path": "app/api/users/route.ts",
                    "name": "password",
                    "value": value.to_string(),
                    "start_line": 3,
                    "end_line": 3
                }
            ]
        }
    })
}

fn proposed_sensitive_fields(payload: &Value) -> Vec<Value> {
    payload["candidates"]
        .as_array()
        .expect("candidates")
        .iter()
        .find(|candidate| candidate["kind"] == "api_route_forbids_sensitive_response_fields")
        .unwrap_or_else(|| panic!("no sensitive-fields candidate: {payload:#?}"))["requires"]
        ["sensitive_response_fields"]
        .as_array()
        .expect("sensitive_response_fields")
        .clone()
}

fn check_request(repo_root: &std::path::Path, requires: Value) -> Value {
    json!({
        "repo": {
            "repo_id": "repo_d1_check",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_d1_check",
            "facts": [
                fact("file_role_detected", "api_route", 1, 4, None),
                fact("route_declared", "GET", 1, 4, None),
                fact("symbol_called", "json", 3, 3, Some("Response")),
                fact("route_returns_response", "json", 3, 3, Some("Response"))
            ]
        },
        "contract": {
            "contract_id": "contract_d1",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": { "path_globs": ["app/api/**/route.ts"] },
                "requires": requires,
                "severity": "warning",
                "enforcement_mode": "warn",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    })
}

fn fact(kind: &str, name: &str, start_line: usize, end_line: usize, value: Option<&str>) -> Value {
    json!({
        "kind": kind,
        "file_path": "app/api/users/route.ts",
        "name": name,
        "value": value,
        "start_line": start_line,
        "end_line": end_line
    })
}

fn write_route(repo_root: &std::path::Path, file_path: &str, source: &str) {
    let route_path = repo_root.join(file_path);
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(route_path, source).expect("write route");
}

fn run_infer_candidates(request: Value) -> Value {
    run_engine("infer-candidates", request)
}

fn run_check_repo(request: Value) -> Value {
    run_engine("check-repo", request)
}

fn run_engine(subcommand: &str, request: Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .arg(subcommand)
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

fn temp_repo(name: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("drift-gt-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create temp repo");
    path
}
