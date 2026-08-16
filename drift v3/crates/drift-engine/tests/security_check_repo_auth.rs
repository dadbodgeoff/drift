use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

#[test]
fn check_repo_does_not_use_get_auth_guard_for_unguarded_post() {
    let repo_root = temp_repo("multi_handler");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            r#"import { requireUser } from "@/server/auth";"#,
            r#"import { db } from "@/server/db";"#,
            "",
            "export async function GET() {",
            "  await requireUser();",
            "  return Response.json({ ok: true });",
            "}",
            "",
            "export async function POST() {",
            "  const project = await db.project.create({ data: {} });",
            "  return Response.json({ project });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_auth",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_auth",
            "facts": [
                fact("file_role_detected", "api_route", 1, 12, None, None),
                fact("import_used", "requireUser", 1, 1, Some("@/server/auth"), Some("requireUser")),
                fact("route_declared", "GET", 4, 7, None, None),
                fact("symbol_called", "requireUser", 5, 5, None, None),
                fact("route_returns_response", "json", 6, 6, Some("Response"), None),
                fact("route_declared", "POST", 9, 12, None, None),
                fact("symbol_called", "create", 10, 10, Some("db.project"), None),
                fact("data_operation_detected", "create", 10, 10, Some("db.project"), Some("write:project")),
                fact("route_returns_response", "json", 11, 11, Some("Response"), None)
            ]
        },
        "contract": {
            "contract_id": "contract_auth",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_auth_require_user",
                "kind": "api_route_requires_auth_helper",
                "matcher": {
                    "required_calls": ["requireUser"],
                    "applies_to_file_roles": ["api_route"]
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
    assert_eq!(findings[0]["rule_id"], "api_route_requires_auth_helper");
    assert_eq!(findings[0]["evidence"][0]["start_line"], 10);
    let proofs = payload["security_boundary_proofs"]
        .as_array()
        .expect("proofs");
    assert!(
        proofs.iter().any(|proof| {
            proof["route"]["handler_symbol"] == "POST"
                && proof["result"]["proof_status"] == "missing_proof"
        }),
        "{payload:#?}"
    );
}

#[test]
fn check_repo_blocks_auth_guard_in_only_one_branch() {
    let source = [
        r#"import { requireUser } from "@/server/auth";"#,
        r#"import { db } from "@/server/db";"#,
        "",
        "export async function GET(request: Request) {",
        r#"  if (request.headers.get("x-auth") === "yes") {"#,
        "    await requireUser();",
        "  } else {",
        "    const projects = await db.project.findMany();",
        "    return Response.json({ projects });",
        "  }",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("branch_bypass", &source, "required_calls");
    assert_auth_failure(&payload, "missing_proof", "guard_only_in_one_branch");
}

#[test]
fn check_repo_blocks_callback_auth_guard_for_outer_sink() {
    let source = [
        r#"import { requireUser } from "@/server/auth";"#,
        r#"import { db } from "@/server/db";"#,
        "",
        "export async function GET() {",
        r#"  ["auth"].forEach(async () => {"#,
        "    await requireUser();",
        "  });",
        "  const projects = await db.project.findMany();",
        "  return Response.json({ projects });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("callback_bypass", &source, "required_calls");
    assert_auth_failure(&payload, "missing_proof", "callback_boundary");
}

#[test]
fn check_repo_blocks_conditional_guard_without_else_before_sink() {
    let source = [
        r#"import { requireUser } from "@/server/auth";"#,
        r#"import { db } from "@/server/db";"#,
        "",
        "export async function GET(request: Request) {",
        r#"  if (request.headers.get("x-auth") === "yes") {"#,
        "    await requireUser();",
        "  }",
        "  const projects = await db.project.findMany();",
        "  return Response.json({ projects });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("conditional_without_else", &source, "required_calls");
    assert_auth_failure(&payload, "missing_proof", "guard_only_in_one_branch");
}

#[test]
fn check_repo_uses_security_proof_parser_gaps_and_missing_proofs() {
    let source = [
        r#"import { requireUser } from "@/server/auth";"#,
        r#"import { db } from "@/server/db";"#,
        "",
        "const guards = { requireUser };",
        "",
        "export async function GET(request: Request) {",
        r#"  const guard = guards[request.headers.get("x-guard") as keyof typeof guards];"#,
        "  await guard();",
        "  const projects = await db.project.findMany();",
        "  return Response.json({ projects });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("dynamic_control_flow", &source, "required_calls");
    assert_auth_failure(&payload, "parser_gap", "unsupported_dynamic_control_flow");
    assert_eq!(
        payload["security_boundary_proofs"][0]["parser_gaps"][0]["code"],
        "unsupported_dynamic_control_flow"
    );
    assert!(
        !payload["security_boundary_proofs"][0]["missing_proof"][0]["fact_ids"]
            .as_array()
            .expect("missing proof fact ids")
            .is_empty(),
        "{payload:#?}"
    );
}

#[test]
fn canonical_requires_auth_helpers_normalizes_trusted_guard_calls() {
    let source = [
        r#"import { requireUser } from "@/server/auth";"#,
        r#"import { db } from "@/server/db";"#,
        "",
        "export async function GET() {",
        "  await requireUser();",
        "  const projects = await db.project.findMany();",
        "  return Response.json({ projects });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("canonical_requires", &source, "canonical_requires");
    assert_eq!(payload["findings"].as_array().expect("findings").len(), 0);
    assert_eq!(
        payload["security_boundary_proofs"][0]["result"]["proof_status"],
        "proven"
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["auth"]["trusted_guard_calls"][0]["guard_id"],
        "auth:requireUser"
    );
}

#[test]
fn wrapped_sibling_routes_treat_wrapper_as_route_level_auth_guard() {
    let source = [
        r#"import { withWorkspace } from "@/lib/auth";"#,
        r#"import { prisma } from "@dub/prisma";"#,
        "",
        "export const GET = withWorkspace(",
        "  async ({ workspace }) => {",
        "    const apps = await prisma.oAuthApp.findMany({ where: { projectId: workspace.id } });",
        "    return Response.json({ apps });",
        "  },",
        ");",
        "",
        "export const POST = withWorkspace(",
        "  async ({ req, workspace }) => {",
        "    const existing = await prisma.integration.findUnique({ where: { slug: \"demo\" } });",
        "    return Response.json({ existing, workspace });",
        "  },",
        ");",
        "",
    ]
    .join("\n");
    let repo_root = temp_repo("wrapped_sibling_routes");
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(&route_path, source).expect("write route");
    let scan = run_scan_repo(&repo_root);

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_auth",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_auth",
            "facts": scan["facts"].clone()
        },
        "contract": {
            "contract_id": "contract_auth",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_auth_with_workspace",
                "kind": "api_route_requires_auth_helper",
                "matcher": {
                    "required_calls": ["withWorkspace"],
                    "applies_to_file_roles": ["api_route"]
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
    let proofs = payload["security_boundary_proofs"]
        .as_array()
        .expect("proofs");
    assert_eq!(proofs.len(), 2, "{payload:#?}");
    assert!(
        proofs
            .iter()
            .all(|proof| proof["result"]["proof_status"] == "proven"),
        "{payload:#?}"
    );
}

#[test]
fn security_phase8_proof_includes_route_path_and_method() {
    let source = [
        r#"import { requireUser } from "@/server/auth";"#,
        r#"import { db } from "@/server/db";"#,
        "",
        "export async function GET() {",
        "  await requireUser();",
        "  const projects = await db.project.findMany();",
        "  return Response.json({ projects });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("phase8_route_metadata", &source, "required_calls");
    let proof = &payload["security_boundary_proofs"][0];

    assert_eq!(proof["route"]["file_role"], "api_route");
    assert_eq!(proof["route"]["endpoint"]["path"], "/api/projects");
    assert_eq!(proof["route"]["endpoint"]["method"], "GET");
    assert_eq!(proof["route"]["endpoint"]["framework"], "next");
}

#[test]
fn route_group_endpoint_is_normalized_for_security_proofs() {
    let repo_root = temp_repo("route_group_endpoint");
    let route_path = repo_root.join("app/api/(admin)/users/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(
        &route_path,
        [
            r#"import { requireUser } from "@/server/auth";"#,
            r#"import { db } from "@/server/db";"#,
            "export async function GET() {",
            "  await requireUser();",
            "  const users = await db.user.findMany();",
            "  return Response.json({ users });",
            "}",
            "",
        ]
        .join("\n"),
    )
    .expect("write route");

    let payload = run_check_repo(json!({
        "repo": {
            "repo_id": "repo_auth",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_auth",
            "facts": [
                { "kind": "file_role_detected", "file_path": "app/api/(admin)/users/route.ts", "name": "api_route", "start_line": 1, "end_line": 7 },
                { "kind": "import_used", "file_path": "app/api/(admin)/users/route.ts", "name": "requireUser", "value": "@/server/auth", "imported_name": "requireUser", "start_line": 1, "end_line": 1 },
                { "kind": "route_declared", "file_path": "app/api/(admin)/users/route.ts", "name": "GET", "start_line": 3, "end_line": 7 },
                { "kind": "symbol_called", "file_path": "app/api/(admin)/users/route.ts", "name": "requireUser", "start_line": 4, "end_line": 4 },
                { "kind": "symbol_called", "file_path": "app/api/(admin)/users/route.ts", "name": "findMany", "value": "db.user", "start_line": 5, "end_line": 5 },
                { "kind": "data_operation_detected", "file_path": "app/api/(admin)/users/route.ts", "name": "findMany", "value": "db.user", "imported_name": "read:user", "start_line": 5, "end_line": 5 },
                { "kind": "route_returns_response", "file_path": "app/api/(admin)/users/route.ts", "name": "json", "value": "Response", "start_line": 6, "end_line": 6 }
            ]
        },
        "contract": {
            "contract_id": "contract_auth",
            "contract_schema_version": 1,
            "conventions": [{
                "id": "security_api_auth_require_user",
                "kind": "api_route_requires_auth_helper",
                "matcher": {
                    "required_calls": ["requireUser"],
                    "applies_to_file_roles": ["api_route"]
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
    assert_eq!(proof["route"]["endpoint"]["path"], "/api/users");
    assert_eq!(proof["route"]["endpoint"]["method"], "GET");
    assert!(
        !proof["evidence_refs"]
            .as_array()
            .expect("evidence refs")
            .is_empty()
    );
}

#[test]
fn accepted_auth_helper_import_alias_is_trusted() {
    let source = [
        r#"import { requireUser as requireAuth } from "@/server/auth";"#,
        r#"import { db } from "@/server/db";"#,
        "",
        "export async function GET() {",
        "  await requireAuth();",
        "  const projects = await db.project.findMany();",
        "  return Response.json({ projects });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("alias", &source, "required_calls");
    assert_eq!(payload["findings"].as_array().expect("findings").len(), 0);
    assert_eq!(
        payload["security_boundary_proofs"][0]["result"]["proof_status"],
        "proven"
    );
}

#[test]
fn name_only_auth_looking_helper_cannot_satisfy_or_block() {
    let source = [
        r#"import { db } from "@/server/db";"#,
        "",
        "function requireUser() { return { id: 'local' }; }",
        "",
        "export async function GET() {",
        "  await requireUser();",
        "  const projects = await db.project.findMany();",
        "  return Response.json({ projects });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_auth_fixture("name_only", &source, "required_calls");
    assert_auth_failure(&payload, "missing_proof", "no_guard_call");
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

fn run_auth_fixture(name: &str, source: &str, contract_shape: &str) -> Value {
    let repo_root = temp_repo(name);
    let route_path = repo_root.join("app/api/projects/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(&route_path, source).expect("write route");
    let scan = run_scan_repo(&repo_root);
    let facts = scan["facts"].clone();
    let convention = if contract_shape == "canonical_requires" {
        json!({
            "id": "security_api_auth_require_user",
            "kind": "api_route_requires_auth_helper",
            "matcher": { "applies_to_file_roles": ["api_route"] },
            "requires": { "auth_helpers": ["requireUser"] },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        })
    } else {
        json!({
            "id": "security_api_auth_require_user",
            "kind": "api_route_requires_auth_helper",
            "matcher": {
                "required_calls": ["requireUser"],
                "applies_to_file_roles": ["api_route"]
            },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        })
    };

    run_check_repo(json!({
        "repo": {
            "repo_id": "repo_auth",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_auth",
            "facts": facts
        },
        "contract": {
            "contract_id": "contract_auth",
            "contract_schema_version": 1,
            "conventions": [convention]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }))
}

fn run_scan_repo(repo_root: &std::path::Path) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            repo_root.to_str().expect("repo root"),
            "--format",
            "json",
            "--repo-id",
            "repo_auth",
            "--scan-id",
            "scan_auth",
        ])
        .output()
        .expect("run scan-repo");
    assert!(
        output.status.success(),
        "scan failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("scan json")
}

fn assert_auth_failure(payload: &Value, proof_status: &str, reason: &str) {
    let findings = payload["findings"].as_array().expect("findings");
    assert_eq!(findings.len(), 1, "{payload:#?}");
    assert_eq!(findings[0]["rule_id"], "api_route_requires_auth_helper");
    let proof = &payload["security_boundary_proofs"][0];
    assert_eq!(proof["result"]["proof_status"], proof_status);
    assert!(
        proof["auth"]["undominated_sinks"]
            .as_array()
            .expect("undominated sinks")
            .iter()
            .any(|sink| sink["reason"] == reason),
        "{payload:#?}"
    );
}
