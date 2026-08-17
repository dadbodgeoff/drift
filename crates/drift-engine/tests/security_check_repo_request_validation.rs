use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

#[test]
fn check_repo_does_not_accept_matcher_required_calls_as_request_validators() {
    let repo_root = temp_repo("request_validation_required_calls");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "const db = { project: { create: async (input) => input } };",
            "export async function POST(request: Request) {",
            "  const body = await request.json();",
            "  const input = validateInput(body);",
            "  await db.project.create({ data: input });",
            "  return Response.json({ ok: true });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_validation",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_validation",
            "facts": [
                fact("file_role_detected", "api_route", 1, 7, None, None),
                fact("route_declared", "POST", 2, 7, None, None),
                fact("symbol_called", "json", 3, 3, Some("request"), None),
                fact("symbol_called", "validateInput", 4, 4, None, None),
                fact("symbol_called", "create", 5, 5, Some("db.project"), None),
                fact("data_operation_detected", "create", 5, 5, Some("db.project"), Some("write:project")),
                fact("route_returns_response", "json", 6, 6, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_validation",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_request_validation",
                "kind": "api_route_requires_request_validation",
                "matcher": {
                    "required_calls": ["validateInput"],
                    "applies_to_file_roles": ["api_route"]
                },
                "requires": null,
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    assert!(
        payload["findings"].as_array().expect("findings").is_empty(),
        "{payload:#?}"
    );
    assert!(
        payload["security_boundary_proofs"]
            .as_array()
            .expect("proofs")
            .is_empty(),
        "{payload:#?}"
    );
}

#[test]
fn request_validation_proof_links_normalized_entrypoint_id() {
    let repo_root = temp_repo("request_validation_normalized_entrypoint");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "const db = { project: { create: async (input) => input } };",
            "export async function POST(request: Request) {",
            "  const body = await request.json();",
            "  await db.project.create({ data: body });",
            "  return Response.json({ ok: true });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_validation",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_validation",
            "facts": [
                fact("file_role_detected", "api_route", 1, 6, None, None),
                fact("route_declared", "POST", 2, 6, None, None),
                fact("symbol_called", "json", 3, 3, Some("request"), None),
                fact("symbol_called", "create", 4, 4, Some("db.project"), None),
                fact("data_operation_detected", "create", 4, 4, Some("db.project"), Some("write:project")),
                fact("route_returns_response", "json", 5, 5, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_validation",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_request_validation",
                "kind": "api_route_requires_request_validation",
                "matcher": {
                    "methods": ["POST"],
                    "applies_to_file_roles": ["api_route"]
                },
                "requires": {
                    "validators": ["validateInput"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let proof = &payload["security_boundary_proofs"][0];
    assert_eq!(
        proof["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/projects/route.ts:POST"
    );
    assert_eq!(proof["route"]["endpoint"]["path"], "/api/projects");
    assert_eq!(proof["route"]["endpoint"]["method"], "POST");
}

/// The proposer's own `requires` shape, proved against a real `SomeSchema.safeParse(body)` route.
///
/// `push_request_validation_candidates` (`candidate_command.rs`) writes every inferred symbol into
/// `requires.validators` and leaves `requires.schemas` empty, and never writes a `kind`. For
/// `safeParse` that produced a `Helper` validator, and the `Helper` arm of
/// `accepted_request_validator_for_call` requires `call.value.is_none()` — a call with no receiver
/// — which `ProjectInputSchema.safeParse(body)` never is. So the convention proved nothing and
/// flagged the very route it had been inferred from. The `requires` block below is copied from a
/// real `start --json` payload; the end-to-end evidence is
/// `test/e2e/gt-canary.test.ts > request-validation safeParse proof path fires`.
#[test]
fn proposer_shaped_safe_parse_validator_proves_a_guarded_schema_call() {
    let repo_root = temp_repo("request_validation_safe_parse");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "const db = { project: { create: async (input) => input } };",
            "export async function POST(request: Request) {",
            "  const body = await request.json();",
            "  const result = ProjectInputSchema.safeParse(body);",
            "  if (!result.success) {",
            "    return Response.json({ ok: false }, { status: 400 });",
            "  }",
            "  await db.project.create({ data: result.data });",
            "  return Response.json({ ok: true });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_validation",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_validation",
            "facts": [
                fact("file_role_detected", "api_route", 1, 10, None, None),
                fact("route_declared", "POST", 2, 10, None, None),
                fact("symbol_called", "json", 3, 3, Some("request"), None),
                fact("symbol_called", "safeParse", 4, 4, Some("ProjectInputSchema"), None),
                fact("symbol_called", "create", 8, 8, Some("db.project"), None),
                fact("data_operation_detected", "create", 8, 8, Some("db.project"), Some("write:project")),
                fact("route_returns_response", "json", 9, 9, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_validation",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_request_validation",
                "kind": "api_route_requires_request_validation",
                "matcher": {
                    "methods": ["POST"],
                    "applies_to_file_roles": ["api_route"],
                    "required_calls": ["safeParse"]
                },
                "requires": {
                    "input_sources": ["body", "query", "params"],
                    "sinks": ["data_operation", "response"],
                    "validators": [{
                        "validator_id": "validator:safeParse",
                        "symbol": "safeParse",
                        "import": null
                    }],
                    "schemas": [],
                    "allow_throwing_parse": true,
                    "allow_safe_parse_success_guard": true
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let proof = &payload["security_boundary_proofs"][0]["request_validation"];
    assert_eq!(proof["required"], json!(true), "{payload:#?}");
    assert_eq!(proof["proven"], json!(true), "{payload:#?}");
    // The schema is the receiver, not the accepted symbol - `safeParse` is the method.
    assert_eq!(
        proof["validations"][0]["schema_symbol"],
        json!("ProjectInputSchema"),
        "{payload:#?}"
    );
    assert!(
        payload["findings"].as_array().expect("findings").is_empty(),
        "a guarded safeParse route must not be flagged: {payload:#?}"
    );
}

/// An explicit `kind` still wins, so the widening above cannot silently retag a hand-authored
/// contract that meant a free function called `safeParse`.
#[test]
fn explicit_helper_kind_still_rejects_a_receiver_bearing_safe_parse_call() {
    let repo_root = temp_repo("request_validation_safe_parse_helper_pin");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "const db = { project: { create: async (input) => input } };",
            "export async function POST(request: Request) {",
            "  const body = await request.json();",
            "  const result = ProjectInputSchema.safeParse(body);",
            "  if (!result.success) {",
            "    return Response.json({ ok: false }, { status: 400 });",
            "  }",
            "  await db.project.create({ data: result.data });",
            "  return Response.json({ ok: true });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_validation",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_validation",
            "facts": [
                fact("file_role_detected", "api_route", 1, 10, None, None),
                fact("route_declared", "POST", 2, 10, None, None),
                fact("symbol_called", "json", 3, 3, Some("request"), None),
                fact("symbol_called", "safeParse", 4, 4, Some("ProjectInputSchema"), None),
                fact("symbol_called", "create", 8, 8, Some("db.project"), None),
                fact("data_operation_detected", "create", 8, 8, Some("db.project"), Some("write:project")),
                fact("route_returns_response", "json", 9, 9, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_validation",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_request_validation",
                "kind": "api_route_requires_request_validation",
                "matcher": {
                    "methods": ["POST"],
                    "applies_to_file_roles": ["api_route"]
                },
                "requires": {
                    "validators": [{ "symbol": "safeParse", "kind": "helper" }]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    assert_eq!(
        payload["security_boundary_proofs"][0]["request_validation"]["proven"],
        json!(false),
        "{payload:#?}"
    );
}

/// The finding must point at the sink, not at line 1.
///
/// `request_validation_finding_line` read the sink id's LAST `:`-segment as the line, but sink ids
/// are `sink:{file}:{line}:{symbol}` while every other id in the engine ends in the line. So the
/// parse failed, the zero was filtered, and `unwrap_or(1)` supplied a line that had been measured
/// from nothing - on every request-validation finding this engine has ever emitted.
#[test]
fn request_validation_finding_points_at_the_unvalidated_sink_line() {
    let repo_root = temp_repo("request_validation_finding_line");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "const db = { project: { create: async (input) => input } };",
            "export async function POST(request: Request) {",
            "  const body = await request.json();",
            "  await db.project.create({ data: body });",
            "  return Response.json({ ok: true });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_validation",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_validation",
            "facts": [
                fact("file_role_detected", "api_route", 1, 6, None, None),
                fact("route_declared", "POST", 2, 6, None, None),
                fact("symbol_called", "json", 3, 3, Some("request"), None),
                fact("symbol_called", "create", 4, 4, Some("db.project"), None),
                fact("data_operation_detected", "create", 4, 4, Some("db.project"), Some("write:project")),
                fact("route_returns_response", "json", 5, 5, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_validation",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_request_validation",
                "kind": "api_route_requires_request_validation",
                "matcher": {
                    "methods": ["POST"],
                    "applies_to_file_roles": ["api_route"]
                },
                "requires": {
                    "validators": ["validateInput"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let evidence = &payload["findings"][0]["evidence"][0];
    assert_eq!(
        evidence["file_path"],
        json!("app/api/projects/route.ts"),
        "{payload:#?}"
    );
    assert_eq!(evidence["start_line"], json!(4), "{payload:#?}");
}

fn fact(
    kind: &str,
    name: &str,
    start_line: usize,
    end_line: usize,
    value: Option<&str>,
    imported_name: Option<&str>,
) -> Value {
    json!({
        "kind": kind,
        "file_path": "app/api/projects/route.ts",
        "name": name,
        "value": value,
        "imported_name": imported_name,
        "start_line": start_line,
        "end_line": end_line
    })
}

fn run_check_repo(request: Value) -> Value {
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

fn temp_repo(name: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "drift-security-check-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create temp repo");
    path
}
