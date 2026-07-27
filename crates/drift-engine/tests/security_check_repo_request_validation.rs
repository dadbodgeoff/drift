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
