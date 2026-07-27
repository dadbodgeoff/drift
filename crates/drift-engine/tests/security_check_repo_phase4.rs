use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

#[test]
fn engine_blocks_tenant_missing_predicate_from_accepted_phase4_contract() {
    let repo_root = temp_repo("phase4_tenant_missing");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "import { requireUser } from '@/server/auth';",
            "const db = { project: { findMany: async () => [] } };",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  await db.project.findMany();",
            "  return Response.json({ ok: true, session: Boolean(session) });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase4",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase4",
            "facts": [
                fact("file_role_detected", "api_route", 1, 7, None, None),
                fact("import_used", "requireUser", 1, 1, Some("@/server/auth"), Some("requireUser")),
                fact("route_declared", "GET", 3, 7, None, None),
                fact("symbol_called", "requireUser", 4, 4, None, None),
                fact("symbol_called", "findMany", 5, 5, Some("db.project"), None),
                fact("data_operation_detected", "findMany", 5, 5, Some("db.project"), Some("read:project")),
                fact("route_returns_response", "json", 6, 6, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase4",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_tenant_scope",
                "kind": "api_route_requires_tenant_scope",
                "matcher": { "applies_to_file_roles": ["api_route"] },
                "requires": {
                    "auth_helpers": [{ "guard_id": "auth_require_user", "symbol": "requireUser", "behavior": "returns_session" }],
                    "tenant_helpers": ["scopeProjectToTenant"],
                    "tenant_keys": ["tenantId"],
                    "tenant_sources": ["session"],
                    "data_operations": ["findMany"]
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
    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["rule_id"], "api_route_requires_tenant_scope");
    assert_eq!(findings[0]["enforcement_result"], "block");
    assert_eq!(
        findings[0]["evidence"][0]["file_path"],
        "app/api/projects/route.ts"
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/projects/route.ts:GET"
    );
    assert!(
        payload["security_boundary_proofs"][0]["tenant"]["missing"]
            .as_array()
            .expect("tenant missing")
            .iter()
            .any(|missing| missing["reason"] == "tenant_predicate_missing"),
        "{payload:#?}"
    );
}

#[test]
fn engine_does_not_accept_phase4_legacy_matcher_required_calls_as_session_trust() {
    let repo_root = temp_repo("phase4_legacy_required_calls");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "import { requireUser } from '@/server/auth';",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase4",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase4",
            "facts": [
                fact("file_role_detected", "api_route", 1, 5, None, None),
                fact("import_used", "requireUser", 1, 1, Some("@/server/auth"), Some("requireUser")),
                fact("route_declared", "GET", 2, 5, None, None),
                fact("symbol_called", "requireUser", 3, 3, None, None),
                fact("route_returns_response", "json", 4, 4, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase4",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_session_trust",
                "kind": "session_object_must_come_from_trusted_helper",
                "matcher": {
                    "applies_to_file_roles": ["api_route"],
                    "required_calls": ["requireUser"]
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
    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(
        findings[0]["rule_id"],
        "session_object_must_come_from_trusted_helper"
    );
    assert!(
        payload["security_boundary_proofs"][0]["session_trust"]["missing_trust"]
            .as_array()
            .expect("missing trust")
            .iter()
            .any(|missing| missing["reason"] == "session_not_trusted"),
        "{payload:#?}"
    );
}

#[test]
fn security_phase4_unaccepted_helpers_rejects_wrong_import_contract() {
    let repo_root = temp_repo("phase4_wrong_import");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "import { requireUser } from '@/server/auth';",
            "import { requireRole } from '@/server/unsafe-authz';",
            "const db = { project: { delete: async () => ({}) } };",
            "export async function DELETE(request: Request) {",
            "  const session = await requireUser(request);",
            "  requireRole(session.user, 'admin');",
            "  await db.project.delete({ where: { tenantId: session.user.tenantId } });",
            "  return Response.json({ ok: true });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase4",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase4",
            "facts": [
                fact("file_role_detected", "api_route", 1, 9, None, None),
                fact("import_used", "requireUser", 1, 1, Some("@/server/auth"), Some("requireUser")),
                fact("import_used", "requireRole", 2, 2, Some("@/server/unsafe-authz"), Some("requireRole")),
                fact("route_declared", "DELETE", 4, 9, None, None),
                fact("symbol_called", "requireUser", 5, 5, None, None),
                fact("symbol_called", "requireRole", 6, 6, None, None),
                fact("symbol_called", "delete", 7, 7, Some("db.project"), None),
                fact("data_operation_detected", "delete", 7, 7, Some("db.project"), Some("delete:project")),
                fact("route_returns_response", "json", 8, 8, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase4",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_authorization",
                "kind": "api_route_requires_authorization",
                "matcher": { "applies_to_file_roles": ["api_route"] },
                "requires": {
                    "auth_helpers": [{ "guard_id": "auth_require_user", "symbol": "requireUser", "import": "@/server/auth", "behavior": "returns_session" }],
                    "authorization_helpers": [{ "guard_id": "authorization_require_role", "symbol": "requireRole", "import": "@/server/authorization", "roles": ["admin"], "behavior": "throws" }],
                    "data_operations": ["delete"]
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
    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["rule_id"], "api_route_requires_authorization");
    assert!(
        payload["security_boundary_proofs"][0]["authorization"]["missing"]
            .as_array()
            .expect("authorization missing")
            .iter()
            .any(|missing| missing["reason"] == "authorization_guard_missing"),
        "{payload:#?}"
    );
}

#[test]
fn security_phase4_auth_helper_returns_contract_accepts_documented_shape() {
    let repo_root = temp_repo("phase4_returns_session");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            "import { getServerSession } from 'next-auth';",
            "export async function GET() {",
            "  const session = await getServerSession();",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase4",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase4",
            "facts": [
                fact("file_role_detected", "api_route", 1, 5, None, None),
                fact("import_used", "getServerSession", 1, 1, Some("next-auth"), Some("getServerSession")),
                fact("route_declared", "GET", 2, 5, None, None),
                fact("symbol_called", "getServerSession", 3, 3, None, None),
                fact("route_returns_response", "json", 4, 4, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_phase4",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_session_trust",
                "kind": "session_object_must_come_from_trusted_helper",
                "matcher": { "applies_to_file_roles": ["api_route"] },
                "requires": {
                    "auth_helpers": [{ "name": "getServerSession", "import": "next-auth", "returns": "session" }]
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
        payload["findings"].as_array().expect("findings").len(),
        0,
        "{payload:#?}"
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["session_trust"]["proven"], true,
        "{payload:#?}"
    );
}

#[test]
fn security_phase4_scope_filtering_honors_method_path_and_data_operation() {
    let method_repo = temp_repo("phase4_method_scope");
    write_route(
        &method_repo,
        "app/api/projects/route.ts",
        &[
            "import { requireUser } from '@/server/auth';",
            "const db = { project: { findMany: async () => [] } };",
            "export async function POST(request: Request) {",
            "  const session = await requireUser(request);",
            "  await db.project.findMany();",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );
    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": method_repo.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact("file_role_detected", "api_route", 1, 7, None, None),
            fact("import_used", "requireUser", 1, 1, Some("@/server/auth"), Some("requireUser")),
            fact("route_declared", "POST", 3, 7, None, None),
            fact("symbol_called", "requireUser", 4, 4, None, None),
            fact("symbol_called", "findMany", 5, 5, Some("db.project"), None),
            fact("data_operation_detected", "findMany", 5, 5, Some("db.project"), Some("read:project")),
            fact("route_returns_response", "json", 6, 6, Some("Response"), None)
        ] },
        "contract": phase4_tenant_contract(json!({ "methods": ["GET"], "applies_to_file_roles": ["api_route"] }), json!({})),
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "POST route must not be blocked by GET-only Phase 4 contract: {payload:#?}"
    );

    let path_repo = temp_repo("phase4_path_scope");
    write_route(
        &path_repo,
        "app/api/admin/route.ts",
        &[
            "import { requireUser } from '@/server/auth';",
            "const db = { project: { findMany: async () => [] } };",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  await db.project.findMany();",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );
    let admin_path = "app/api/admin/route.ts";
    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": path_repo.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact_for_path(admin_path, "file_role_detected", "api_route", 1, 7, None, None),
            fact_for_path(admin_path, "import_used", "requireUser", 1, 1, Some("@/server/auth"), Some("requireUser")),
            fact_for_path(admin_path, "route_declared", "GET", 3, 7, None, None),
            fact_for_path(admin_path, "symbol_called", "requireUser", 4, 4, None, None),
            fact_for_path(admin_path, "symbol_called", "findMany", 5, 5, Some("db.project"), None),
            fact_for_path(admin_path, "data_operation_detected", "findMany", 5, 5, Some("db.project"), Some("read:project")),
            fact_for_path(admin_path, "route_returns_response", "json", 6, 6, Some("Response"), None)
        ] },
        "contract": phase4_tenant_contract(
            json!({ "methods": ["GET"], "applies_to_file_roles": ["api_route"] }),
            json!({ "path_globs": ["app/api/projects/**/route.ts"] })
        ),
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "admin route must not be blocked by projects-only Phase 4 contract: {payload:#?}"
    );

    let operation_repo = temp_repo("phase4_operation_scope");
    write_route(
        &operation_repo,
        "app/api/projects/route.ts",
        &[
            "import { requireUser } from '@/server/auth';",
            "const db = { project: { findMany: async () => [] } };",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  await db.project.findMany();",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );
    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": operation_repo.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact("file_role_detected", "api_route", 1, 7, None, None),
            fact("import_used", "requireUser", 1, 1, Some("@/server/auth"), Some("requireUser")),
            fact("route_declared", "GET", 3, 7, None, None),
            fact("symbol_called", "requireUser", 4, 4, None, None),
            fact("symbol_called", "findMany", 5, 5, Some("db.project"), None),
            fact("data_operation_detected", "findMany", 5, 5, Some("db.project"), Some("read:project")),
            fact("route_returns_response", "json", 6, 6, Some("Response"), None)
        ] },
        "contract": phase4_tenant_contract(json!({ "methods": ["GET"], "applies_to_file_roles": ["api_route"] }), json!({
            "path_globs": ["app/api/projects/route.ts"]
        })),
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "findMany must not be blocked by delete-only Phase 4 data operation scope: {payload:#?}"
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
        "app/api/projects/route.ts",
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

fn write_route(repo_root: &std::path::Path, path: &str, lines: &[&str]) {
    let route_path = repo_root.join(path);
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(&route_path, lines.join("\n")).expect("write route");
}

fn phase4_tenant_contract(matcher: Value, scope: Value) -> Value {
    json!({
        "contract_id": "contract_phase4",
        "contract_schema_version": 1,
        "conventions": [{
            "id": "security_api_tenant_scope",
            "kind": "api_route_requires_tenant_scope",
            "matcher": matcher,
            "scope": scope,
            "requires": {
                "auth_helpers": [{ "guard_id": "auth_require_user", "symbol": "requireUser", "import": "@/server/auth", "behavior": "returns_session" }],
                "tenant_helpers": [{ "symbol": "scopeProjectToTenant", "import": "@/server/tenant", "tenant_arg": "tenantId", "data_operation_arg": "query" }],
                "tenant_keys": ["tenantId"],
                "tenant_sources": ["session"],
                "data_operations": ["delete"]
            },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }]
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
