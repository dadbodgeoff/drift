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
    // PROOF-level reason: a member of the session_trust wire enum.
    assert!(
        payload["security_boundary_proofs"][0]["session_trust"]["missing_trust"]
            .as_array()
            .expect("missing trust")
            .iter()
            .any(|missing| missing["reason"] == "unknown_helper"),
        "{payload:#?}"
    );
    // FINDING-level code: the separate user-facing vocabulary, surfaced through the
    // layer's missing_proof_ids. Asserting BOTH surfaces is what proves the phase4
    // finding-reason mapper was widened rather than the bug merely being relocated.
    let session_missing = payload["security_boundary_proofs"][0]["missing_proof"]
        .as_array()
        .expect("missing_proof")
        .iter()
        .find(|missing| missing["capability"] == "session_trust")
        .expect("session_trust missing_proof entry");
    assert_eq!(
        session_missing["code"], "session_not_trusted",
        "{session_missing:#?}"
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

/// S1-01 RED: the engine emits `session_trust.missing_trust[].reason` onto the wire,
/// where `SecurityBoundaryProofSchema` (packages/core/src/security.ts) parses it with a
/// four-member enum. This test pins that every emitted value is a member of that enum.
///
/// This is the PROOF-level vocabulary — why the proof failed. The FINDING-level code a
/// user sees (`session_not_trusted`) is a separate vocabulary, derived from this one by
/// the phase4 finding-reason mapper in check_command.rs. The two are deliberately
/// different; conflating them is what F1 was.
#[test]
fn session_trust_reason_is_a_member_of_the_wire_enum() {
    let repo_root = temp_repo("phase4_reason_vocabulary");
    write_route(
        &repo_root,
        "app/api/projects/route.ts",
        &[
            "import { requireUser } from '@/server/auth';",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );

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

    // The four members of the enum at packages/core/src/security.ts, the schema that
    // parses this exact field. Keep in sync until S2 generates both sides.
    const LEGAL: [&str; 4] = [
        "derived_from_request",
        "unknown_helper",
        "missing_auth_guard",
        "parser_gap",
    ];

    let missing_trust = payload["security_boundary_proofs"][0]["session_trust"]["missing_trust"]
        .as_array()
        .expect("missing_trust");
    assert!(
        !missing_trust.is_empty(),
        "fixture must produce a missing_trust entry to be a meaningful test: {payload:#?}"
    );
    for missing in missing_trust {
        let reason = missing["reason"].as_str().expect("reason");
        assert!(
            LEGAL.contains(&reason),
            "proof-level reason {reason:?} is not a member of the wire enum {LEGAL:?}"
        );
    }
}

/// B2 RED: a module the contract did not name, and nothing says it supplies the helper.
///
/// This test replaces an assertion I wrote earlier in this sprint that said the opposite. The
/// first round accepted `@/lib` for a contract naming `@/lib/auth` on the theory that a barrel
/// above the resolved module is probably the same helper. Probably is not a proof, and nothing in
/// the engine can promote it to one: the CLI's closure runs OUTWARD from the contract's module,
/// recording what that module re-exports, and never records who re-exports INTO it. So `@/lib`
/// appears nowhere in the evidence, and accepting it was string arithmetic wearing the costume of
/// module identity.
///
/// What it cost, concretely: put `export { requireUser } from "./no-op-auth";` in `lib/index.ts`
/// and this route imports a helper that authenticates nobody. `main` calls that a finding. The
/// first round of this sprint did not - a true positive removed from a security check, which is
/// the one direction a false-positive fix must never move.
///
/// The sibling case is here for the same reason: `@/lib/other` shares a directory with the
/// resolved module and that is all it shares.
///
/// This is a known limitation, not a closed question. The right answer needs the INBOUND closure -
/// which modules re-export the accepted symbol into the helper's module - and that is computable
/// only where the whole graph lives, which is the CLI. Until it ships, a contract whose routes
/// import through a barrel should name the barrel: `barrel_contract_matches_the_module_it_reexports`
/// shows that shape working, with evidence rather than a guess.
#[test]
fn a_barrel_the_contract_did_not_name_is_not_evidence() {
    for spelling in ["@/lib", "@/lib/other"] {
        let repo_root = temp_repo(&format!(
            "phase4_unproven_{}",
            spelling.replace(['@', '/'], "_")
        ));
        write_route(
            &repo_root,
            "app/api/projects/route.ts",
            &[
                &format!("import {{ requireUser }} from '{spelling}';"),
                "export async function GET(request: Request) {",
                "  const session = await requireUser(request);",
                "  return Response.json({ ok: Boolean(session) });",
                "}",
                "",
            ],
        );

        let payload = run_check_repo(json!({
            "repo": { "repo_id": "repo_phase4", "repo_root": repo_root.to_string_lossy() },
            "scan": { "scan_id": "scan_phase4", "facts": [
                fact("file_role_detected", "api_route", 1, 5, None, None),
                fact("import_used", "requireUser", 1, 1, Some(spelling), Some("requireUser")),
                fact("route_declared", "GET", 2, 5, None, None),
                fact("symbol_called", "requireUser", 3, 3, None, None),
                fact("route_returns_response", "json", 4, 4, Some("Response"), None)
            ]},
            "contract": session_trust_contract(
                json!({ "symbol": "requireUser", "import": "@/lib/auth", "behavior": "returns_session" }),
                Some(json!([{
                    "requires_key": "auth_helpers",
                    "symbol": "requireUser",
                    "specifier": "@/lib/auth",
                    "mode": "repo_resolved",
                    "files": ["lib/auth.ts"]
                }])),
            ),
            "baseline": [],
            "diff": { "mode": "full", "files": [] }
        }));

        assert_eq!(
            payload["security_boundary_proofs"][0]["session_trust"]["proven"],
            json!(false),
            "spelling {spelling}: {payload:#?}"
        );
        assert_eq!(
            payload["findings"].as_array().expect("findings").len(),
            1,
            "spelling {spelling}: {payload:#?}"
        );
    }
}

/// S4-01 RED: `../../../lib/auth` and `@/lib/auth` are one file, and tier 1 says otherwise.
///
/// Nothing about this route differs from a conforming one except how its author spelled the path.
/// The table resolves the accepted helper to `lib/auth.ts`; normalising the relative spelling
/// against the importing file reaches the same place.
#[test]
fn relative_spelling_satisfies_session_trust() {
    let repo_root = temp_repo("phase4_relative_specifier");
    write_route(
        &repo_root,
        "app/api/projects/route.ts",
        &[
            "import { requireUser } from '../../../lib/auth';",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );

    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": repo_root.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact("file_role_detected", "api_route", 1, 5, None, None),
            fact("import_used", "requireUser", 1, 1, Some("../../../lib/auth"), Some("requireUser")),
            fact("route_declared", "GET", 2, 5, None, None),
            fact("symbol_called", "requireUser", 3, 3, None, None),
            fact("route_returns_response", "json", 4, 4, Some("Response"), None)
        ]},
        "contract": session_trust_contract(
            json!({ "symbol": "requireUser", "import": "@/lib/auth", "behavior": "returns_session" }),
            Some(json!([{
                "requires_key": "auth_helpers",
                "symbol": "requireUser",
                "specifier": "@/lib/auth",
                "mode": "repo_resolved",
                "files": ["lib/auth.ts"]
            }])),
        ),
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let session_trust = &payload["security_boundary_proofs"][0]["session_trust"];
    assert_eq!(
        session_trust["trusted_sessions"]
            .as_array()
            .expect("trusted_sessions")
            .len(),
        1,
        "{payload:#?}"
    );
    assert!(
        session_trust["missing_trust"]
            .as_array()
            .expect("missing_trust")
            .is_empty(),
        "{payload:#?}"
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "{payload:#?}"
    );
}

/// S4-01 RED: `external` is an answer, and the proof has to say so.
///
/// `next-auth` resolves to nothing because the resolver only resolves into the scan snapshot -
/// by design, not by failure. Matching therefore stays on the specifier and this route passes
/// exactly as it did before. What must change is that the proof records WHICH rule decided it:
/// a reader who cannot tell "matched a resolved module" from "matched a string" cannot tell a
/// tier-2 answer from the tier-1 answer this sprint exists to replace.
///
/// This is also the assertion that makes "dispatch on mode, never on whether `files` is empty"
/// checkable: `files` is empty here and the helper still matches.
#[test]
fn external_mode_records_its_degradation_in_the_proof() {
    let repo_root = temp_repo("phase4_external_mode");
    write_route(
        &repo_root,
        "app/api/projects/route.ts",
        &[
            "import { getServerSession } from 'next-auth';",
            "export async function GET(request: Request) {",
            "  const session = await getServerSession(request);",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );

    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": repo_root.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact("file_role_detected", "api_route", 1, 5, None, None),
            fact("import_used", "getServerSession", 1, 1, Some("next-auth"), Some("getServerSession")),
            fact("route_declared", "GET", 2, 5, None, None),
            fact("symbol_called", "getServerSession", 3, 3, None, None),
            fact("route_returns_response", "json", 4, 4, Some("Response"), None)
        ]},
        "contract": session_trust_contract(
            json!({ "symbol": "getServerSession", "import": "next-auth", "behavior": "returns_session" }),
            Some(json!([{
                "requires_key": "auth_helpers",
                "symbol": "getServerSession",
                "specifier": "next-auth",
                "mode": "external",
                "files": []
            }])),
        ),
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let session_trust = &payload["security_boundary_proofs"][0]["session_trust"];
    let trusted = session_trust["trusted_sessions"]
        .as_array()
        .expect("trusted_sessions");
    assert_eq!(trusted.len(), 1, "{payload:#?}");
    assert_eq!(
        trusted[0]["helper_resolution"]["mode"], "external",
        "{payload:#?}"
    );
    assert_eq!(
        trusted[0]["helper_resolution"]["specifier"], "next-auth",
        "{payload:#?}"
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "{payload:#?}"
    );
}

/// B1 RED: a contract that names a barrel must match the module the barrel re-exports.
///
/// `files` is a re-export CLOSURE. When the contract names `@/lib`, the CLI resolves that to
/// `lib/index.ts` and then follows the re-exports that carry `requireUser` onward, so `files` is
/// `["lib/auth.ts", "lib/index.ts"]` - and `lib/auth.ts`, the entry that matters, shares no
/// trailing path segment with the specifier `@/lib` at all. Deriving the alias mapping from each
/// candidate file in turn therefore fails on exactly the closure members the closure exists to
/// supply: `shared_path_suffix("@/lib", "lib/auth")` compares `lib` against `auth`, finds nothing,
/// and gives up.
///
/// The two spellings below denote one file and are asserted together, because the whole claim of
/// this sprint is that one module cannot have two verdicts. Before the fix the relative spelling
/// was proven and the aliased one - naming a file literally present in `files` - was not.
#[test]
fn barrel_contract_matches_the_module_it_reexports() {
    for spelling in ["@/lib/auth", "../../../lib/auth"] {
        let repo_root = temp_repo(&format!(
            "phase4_barrel_contract_{}",
            spelling.replace(['@', '/', '.'], "_")
        ));
        write_route(
            &repo_root,
            "app/api/projects/route.ts",
            &[
                &format!("import {{ requireUser }} from '{spelling}';"),
                "export async function GET(request: Request) {",
                "  const session = await requireUser(request);",
                "  return Response.json({ ok: Boolean(session) });",
                "}",
                "",
            ],
        );

        let payload = run_check_repo(json!({
            "repo": { "repo_id": "repo_phase4", "repo_root": repo_root.to_string_lossy() },
            "scan": { "scan_id": "scan_phase4", "facts": [
                fact("file_role_detected", "api_route", 1, 5, None, None),
                fact("import_used", "requireUser", 1, 1, Some(spelling), Some("requireUser")),
                fact("route_declared", "GET", 2, 5, None, None),
                fact("symbol_called", "requireUser", 3, 3, None, None),
                fact("route_returns_response", "json", 4, 4, Some("Response"), None)
            ]},
            "contract": session_trust_contract(
                json!({ "symbol": "requireUser", "import": "@/lib", "behavior": "returns_session" }),
                Some(json!([{
                    "requires_key": "auth_helpers",
                    "symbol": "requireUser",
                    "specifier": "@/lib",
                    "mode": "repo_resolved",
                    // The closure, exactly as `resolvedHelperIdentities` builds it: the module the
                    // specifier names, plus the module a re-export carries the symbol to.
                    "files": ["lib/auth.ts", "lib/index.ts"]
                }])),
            ),
            "baseline": [],
            "diff": { "mode": "full", "files": [] }
        }));

        let session_trust = &payload["security_boundary_proofs"][0]["session_trust"];
        let trusted = session_trust["trusted_sessions"]
            .as_array()
            .expect("trusted_sessions");
        assert_eq!(trusted.len(), 1, "spelling {spelling}: {payload:#?}");
        assert_eq!(
            payload["findings"].as_array().expect("findings").len(),
            0,
            "spelling {spelling}: {payload:#?}"
        );
        // The gap the first round left: `helper_resolution` was asserted for `external` only, so
        // nothing pinned that a repo-resolved helper reports its files and mode at all.
        assert_eq!(
            trusted[0]["helper_resolution"]["mode"], "repo_resolved",
            "spelling {spelling}: {payload:#?}"
        );
        assert_eq!(
            trusted[0]["helper_resolution"]["files"],
            json!(["lib/auth.ts", "lib/index.ts"]),
            "spelling {spelling}: {payload:#?}"
        );
    }
}

/// The join is `(requires_key, symbol)`, and here is the input that can tell.
///
/// Six requires lists can each carry the same name. Keyed by symbol alone, whichever entry the
/// table happened to list last would win, and an `external` CSRF helper would overwrite an auth
/// helper that had a resolved file identity - silently downgrading it to specifier matching, which
/// is precisely the tier-1 behaviour this sprint removes. Nothing about the resulting run looks
/// wrong; the route just quietly starts being reported again.
///
/// So the table below carries `requireUser` twice, under two lists, with the `csrf_helpers` entry
/// second and deliberately `external`. The route uses a relative spelling, which only a
/// `repo_resolved` identity accepts. If the entries collapse, the auth helper inherits `external`,
/// the spelling stops matching and the route is a finding.
#[test]
fn a_symbol_two_requires_lists_share_keeps_two_identities() {
    let repo_root = temp_repo("phase4_cross_list_symbol");
    write_route(
        &repo_root,
        "app/api/projects/route.ts",
        &[
            "import { requireUser } from '../../../lib/auth';",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );

    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": repo_root.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact("file_role_detected", "api_route", 1, 5, None, None),
            fact("import_used", "requireUser", 1, 1, Some("../../../lib/auth"), Some("requireUser")),
            fact("route_declared", "GET", 2, 5, None, None),
            fact("symbol_called", "requireUser", 3, 3, None, None),
            fact("route_returns_response", "json", 4, 4, Some("Response"), None)
        ]},
        "contract": session_trust_contract(
            json!({ "symbol": "requireUser", "import": "@/lib/auth", "behavior": "returns_session" }),
            Some(json!([
                {
                    "requires_key": "auth_helpers",
                    "symbol": "requireUser",
                    "specifier": "@/lib/auth",
                    "mode": "repo_resolved",
                    "files": ["lib/auth.ts"]
                },
                {
                    // Same name, different list, and listed second so a symbol-only key would
                    // hand its mode to the auth helper above.
                    "requires_key": "csrf_helpers",
                    "symbol": "requireUser",
                    "specifier": "next-auth",
                    "mode": "external",
                    "files": []
                }
            ])),
        ),
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let trusted = payload["security_boundary_proofs"][0]["session_trust"]["trusted_sessions"]
        .as_array()
        .expect("trusted_sessions");
    assert_eq!(trusted.len(), 1, "{payload:#?}");
    assert_eq!(
        trusted[0]["helper_resolution"]["mode"], "repo_resolved",
        "the auth helper must keep its own resolution: {payload:#?}"
    );
    assert_eq!(
        trusted[0]["helper_resolution"]["specifier"], "@/lib/auth",
        "{payload:#?}"
    );
    assert_eq!(
        payload["findings"].as_array().expect("findings").len(),
        0,
        "{payload:#?}"
    );
}

/// The third mode's turn in the proof.
///
/// `unresolved` is a repo-relative specifier the CLI could not resolve - the graph could not
/// answer, and the match fell back to comparing strings. That is the mode a reader most needs to
/// see, because it is the one where a passing proof rests on the weakest evidence, and it was the
/// only one of the three the emitted proof was never checked to report.
#[test]
fn unresolved_mode_reaches_the_proof_too() {
    let repo_root = temp_repo("phase4_unresolved_mode");
    write_route(
        &repo_root,
        "app/api/projects/route.ts",
        &[
            "import { requireUser } from '../../../lib/auth';",
            "export async function GET(request: Request) {",
            "  const session = await requireUser(request);",
            "  return Response.json({ ok: Boolean(session) });",
            "}",
            "",
        ],
    );

    let payload = run_check_repo(json!({
        "repo": { "repo_id": "repo_phase4", "repo_root": repo_root.to_string_lossy() },
        "scan": { "scan_id": "scan_phase4", "facts": [
            fact("file_role_detected", "api_route", 1, 5, None, None),
            fact("import_used", "requireUser", 1, 1, Some("../../../lib/auth"), Some("requireUser")),
            fact("route_declared", "GET", 2, 5, None, None),
            fact("symbol_called", "requireUser", 3, 3, None, None),
            fact("route_returns_response", "json", 4, 4, Some("Response"), None)
        ]},
        "contract": session_trust_contract(
            json!({ "symbol": "requireUser", "import": "../../../lib/auth", "behavior": "returns_session" }),
            Some(json!([{
                "requires_key": "auth_helpers",
                "symbol": "requireUser",
                "specifier": "../../../lib/auth",
                "mode": "unresolved",
                "files": []
            }])),
        ),
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let trusted = payload["security_boundary_proofs"][0]["session_trust"]["trusted_sessions"]
        .as_array()
        .expect("trusted_sessions");
    assert_eq!(trusted.len(), 1, "{payload:#?}");
    assert_eq!(
        trusted[0]["helper_resolution"]["mode"], "unresolved",
        "{payload:#?}"
    );
}

/// A `session_object_must_come_from_trusted_helper` contract with one accepted auth helper, and
/// optionally the resolved-identity table the CLI ships beside it.
fn session_trust_contract(helper: Value, helper_module_files: Option<Value>) -> Value {
    let mut matcher = json!({ "applies_to_file_roles": ["api_route"] });
    if let Some(table) = helper_module_files {
        matcher["accepted_helper_module_files"] = table;
    }
    json!({
        "contract_id": "contract_phase4",
        "contract_schema_version": 1,
        "conventions": [{
            "id": "security_session_trust",
            "kind": "session_object_must_come_from_trusted_helper",
            "matcher": matcher,
            "requires": { "auth_helpers": [helper] },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }]
    })
}
