use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

#[test]
fn security_phase5_contract_input_reaches_rust_check_repo_capabilities() {
    let repo_root = temp_repo("phase5_contract_input");
    let route_path = repo_root.join("app/api/users/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "import { serializePublicUser } from '@/lib/serializers/user';",
            "export async function GET() {",
            "  const user = { email: 'redacted@example.test' };",
            "  return Response.json(serializePublicUser(user));",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase5",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase5",
            "facts": [
                fact("file_role_detected", "api_route", 1, 5, None, None),
                fact("route_declared", "GET", 2, 5, None, None),
                fact("import_used", "serializePublicUser", 1, 1, Some("@/lib/serializers/user"), Some("serializePublicUser")),
                fact("symbol_called", "serializePublicUser", 4, 4, None, None),
                fact("route_returns_response", "json", 4, 4, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["app/api/users/**/route.ts"]
                },
                "requires": {
                    "sensitive_response_fields": [{
                        "field_path": "user.email",
                        "classification": "pii",
                        "source": "contract"
                    }],
                    "response_serializers": [{
                        "serializer_id": "serializePublicUser",
                        "import_source": "@/lib/serializers/user",
                        "imported_name": "serializePublicUser",
                        "local_name": "serializePublicUser",
                        "policy": "denylist",
                        "filtered_fields": ["user.email"]
                    }],
                    "secret_sources": ["env", "config", "secret_manager"],
                    "log_sinks": ["console.error", "logger.error"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }, {
                "id": "security_api_secret_exposure",
                "kind": "api_route_forbids_secret_exposure",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["app/api/users/**/route.ts"]
                },
                "requires": {
                    "secret_sources": ["env", "config", "secret_manager"],
                    "log_sinks": ["console.error", "logger.error"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let required = payload["stats"]["capabilities"]["required"]
        .as_array()
        .expect("required capabilities")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    assert!(
        required.contains(&"response_shape_facts"),
        "missing response shape capability: {payload:#?}"
    );
    assert!(
        required.contains(&"secret_exposure"),
        "missing secret exposure capability: {payload:#?}"
    );
}

#[test]
fn security_phase5_scope_filtering_and_blocking_are_engine_owned() {
    let repo_root = temp_repo("phase5_scope_filtering");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\nexport async function POST() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\n",
    );
    write_route(
        &repo_root,
        "app/api/admin/route.ts",
        "export async function GET() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\n",
    );
    write_route(
        &repo_root,
        "lib/user-helper.ts",
        "export function userPayload(email: string) {\n  return { user: { email } };\n}\n",
    );
    write_route(
        &repo_root,
        "app/api/secrets/route.ts",
        "export async function GET() {\n  const apiKey = process.env.API_KEY;\n  return Response.json({ apiKey });\n}\n",
    );

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase5_scope",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase5_scope",
            "facts": [
                fact_for_path("app/api/users/route.ts", "file_role_detected", "api_route", 1, 8, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "GET", 1, 4, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "POST", 5, 8, None, None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 3, 3, Some("Response"), None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 7, 7, Some("Response"), None),
                fact_for_path("app/api/admin/route.ts", "file_role_detected", "api_route", 1, 4, None, None),
                fact_for_path("app/api/admin/route.ts", "route_declared", "GET", 1, 4, None, None),
                fact_for_path("app/api/admin/route.ts", "symbol_called", "json", 3, 3, Some("Response"), None),
                fact_for_path("lib/user-helper.ts", "file_role_detected", "service", 1, 3, None, None),
                fact_for_path("app/api/secrets/route.ts", "file_role_detected", "api_route", 1, 4, None, None),
                fact_for_path("app/api/secrets/route.ts", "route_declared", "GET", 1, 4, None, None),
                fact_for_path("app/api/secrets/route.ts", "symbol_called", "json", 3, 3, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5_scope",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["/api/users/*"]
                },
                "requires": {
                    "sensitive_response_fields": [{
                        "field_path": "user.email",
                        "classification": "pii",
                        "source": "contract"
                    }]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }, {
                "id": "security_api_secret_exposure",
                "kind": "api_route_forbids_secret_exposure",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["/api/secrets/*"]
                },
                "requires": {
                    "secret_sources": ["env"],
                    "log_sinks": ["console.error"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            }]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(findings.len(), 2, "{payload:#?}");
    assert!(
        findings.iter().any(|finding| finding["rule_id"]
            == "api_route_forbids_sensitive_response_fields"
            && finding["evidence"][0]["file_path"] == "app/api/users/route.ts"),
        "expected only matching GET /api/users sensitive finding: {payload:#?}"
    );
    assert!(
        findings.iter().any(
            |finding| finding["rule_id"] == "api_route_forbids_secret_exposure"
                && finding["evidence"][0]["file_path"] == "app/api/secrets/route.ts"
        ),
        "expected only matching /api/secrets secret finding: {payload:#?}"
    );
    assert!(
        findings.iter().all(|finding| {
            finding["evidence"][0]["file_path"] != "app/api/admin/route.ts"
                && finding["evidence"][0]["file_path"] != "lib/user-helper.ts"
        }),
        "admin/helper files must be out of Phase 5 route scope: {payload:#?}"
    );
    let proofs = payload["security_boundary_proofs"]
        .as_array()
        .expect("proofs");
    assert!(
        proofs.iter().any(|proof| {
            proof["route"]["route_id"] == "route:app/api/users/route.ts:GET"
                && proof["route"]["normalized_entrypoint_id"]
                    == "entrypoint:next_app:app/api/users/route.ts:GET"
        }),
        "{payload:#?}"
    );
    assert!(
        proofs.iter().any(|proof| {
            proof["route"]["route_id"] == "route:app/api/secrets/route.ts:GET"
                && proof["route"]["normalized_entrypoint_id"]
                    == "entrypoint:next_app:app/api/secrets/route.ts:GET"
        }),
        "{payload:#?}"
    );
}

#[test]
fn security_phase5_get_contract_does_not_block_post_leak_in_same_route_file() {
    let repo_root = temp_repo("phase5_mixed_methods");
    write_route(
        &repo_root,
        "app/api/users/route.ts",
        "export async function GET() {\n  return Response.json({ ok: true });\n}\nexport async function POST() {\n  const email = 'redacted@example.test';\n  return Response.json({ user: { email } });\n}\n",
    );

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase5_methods",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase5_methods",
            "facts": [
                fact_for_path("app/api/users/route.ts", "file_role_detected", "api_route", 1, 7, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "GET", 1, 3, None, None),
                fact_for_path("app/api/users/route.ts", "route_declared", "POST", 4, 7, None, None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 2, 2, Some("Response"), None),
                fact_for_path("app/api/users/route.ts", "symbol_called", "json", 6, 6, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase5_methods",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_sensitive_response",
                "kind": "api_route_forbids_sensitive_response_fields",
                "matcher": {
                    "methods": ["GET"],
                    "applies_to_file_roles": ["api_route"]
                },
                "scope": {
                    "path_globs": ["/api/users/*"]
                },
                "requires": {
                    "sensitive_response_fields": [{
                        "field_path": "user.email",
                        "classification": "pii",
                        "source": "contract"
                    }]
                },
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
}

fn fact(
    kind: &str,
    name: &str,
    start_line: usize,
    end_line: usize,
    value: Option<&str>,
    imported_name: Option<&str>,
) -> Value {
    fact_for_path(
        "app/api/users/route.ts",
        kind,
        name,
        start_line,
        end_line,
        value,
        imported_name,
    )
}

fn fact_for_path(
    file_path: &str,
    kind: &str,
    name: &str,
    start_line: usize,
    end_line: usize,
    value: Option<&str>,
    imported_name: Option<&str>,
) -> Value {
    json!({
        "kind": kind,
        "file_path": file_path,
        "name": name,
        "value": value,
        "imported_name": imported_name,
        "start_line": start_line,
        "end_line": end_line
    })
}

fn write_route(repo_root: &std::path::Path, file_path: &str, source: &str) {
    let route_path = repo_root.join(file_path);
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(route_path, source).expect("write route");
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
