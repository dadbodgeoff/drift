use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

#[test]
fn check_repo_blocks_phase6_ssrf_with_trusted_proof() {
    let source = [
        "export async function GET(request: Request) {",
        r#"  const target = request.nextUrl.searchParams.get("target");"#,
        "  await fetch(target);",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_phase6_fixture(
        "ssrf",
        "app/api/proxy/route.ts",
        &source,
        json!({
            "id": "security_api_no_ssrf",
            "kind": "api_route_forbids_untrusted_ssrf",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["GET"]
            },
            "requires": {
                "outbound_url_allowlist_helpers": [{
                    "helper_id": "outbound_allowlist",
                    "module": "@/security/outbound",
                    "symbol": "requireAllowedOutboundUrl"
                }]
            },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }),
    );

    assert_eq!(
        payload["findings"][0]["rule_id"],
        "api_route_forbids_untrusted_ssrf"
    );
    assert_eq!(payload["findings"][0]["enforcement_result"], "block");
    assert_eq!(
        payload["security_boundary_proofs"][0]["ssrf"]["required"],
        json!(true)
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["result"]["proof_status"],
        "missing_proof"
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/proxy/route.ts:GET"
    );
}

#[test]
fn check_repo_links_phase6_raw_sql_proof_to_normalized_entrypoint() {
    let source = [
        "const db = { $queryRawUnsafe: async (query) => query };",
        "export async function POST(request: Request) {",
        r#"  const id = request.nextUrl.searchParams.get("id");"#,
        "  await db.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${id}`);",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_phase6_fixture(
        "raw_sql",
        "app/api/users/route.ts",
        &source,
        json!({
            "id": "security_api_no_raw_sql",
            "kind": "api_route_forbids_raw_sql_without_params",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["POST"]
            },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }),
    );

    assert_eq!(
        payload["security_boundary_proofs"][0]["raw_sql"]["required"],
        json!(true)
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/users/route.ts:POST"
    );
}

#[test]
fn check_repo_links_phase6_cors_proof_to_normalized_entrypoint() {
    let source = [
        "export async function GET() {",
        "  return Response.json({ ok: true }, {",
        "    headers: {",
        r#"      "Access-Control-Allow-Origin": "*","#,
        r#"      "Access-Control-Allow-Credentials": "true""#,
        "    }",
        "  });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_phase6_fixture(
        "cors",
        "app/api/public/route.ts",
        &source,
        json!({
            "id": "security_api_cors",
            "kind": "api_route_cors_must_match_policy",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["GET"]
            },
            "requires": {
                "cors": {
                    "allowed_origins": ["https://app.example.com"],
                    "allow_credentials": true
                }
            },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }),
    );

    assert_eq!(
        payload["security_boundary_proofs"][0]["cors"]["required"],
        json!(true)
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/public/route.ts:GET"
    );
}

#[test]
fn check_repo_links_phase6_csrf_proof_to_normalized_entrypoint() {
    let source = [
        "export async function POST(request: Request) {",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_phase6_fixture(
        "csrf",
        "app/api/settings/route.ts",
        &source,
        json!({
            "id": "security_api_csrf",
            "kind": "api_route_requires_csrf_for_mutation",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["POST"]
            },
            "requires": {
                "csrf_helpers": [{
                    "helper_id": "csrf",
                    "module": "@/security/csrf",
                    "symbol": "requireCsrf"
                }]
            },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }),
    );

    assert_eq!(
        payload["security_boundary_proofs"][0]["csrf"]["required"],
        json!(true)
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/settings/route.ts:POST"
    );
}

#[test]
fn check_repo_links_phase6_rate_limit_proof_to_normalized_entrypoint() {
    let source = [
        "export async function POST(request: Request) {",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_phase6_fixture(
        "rate_limit",
        "app/api/login/route.ts",
        &source,
        json!({
            "id": "security_api_rate_limit",
            "kind": "api_route_requires_rate_limit",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["POST"]
            },
            "requires": {
                "route_paths": ["/api/login"],
                "rate_limit_helpers": [{
                    "helper_id": "rate_limit",
                    "module": "@/security/rate-limit",
                    "symbol": "requireRateLimit"
                }]
            },
            "severity": "error",
            "enforcement_mode": "block",
            "enforcement_capability": "deterministic_check"
        }),
    );

    assert_eq!(
        payload["security_boundary_proofs"][0]["rate_limit"]["required"],
        json!(true)
    );
    assert_eq!(
        payload["security_boundary_proofs"][0]["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/login/route.ts:POST"
    );
}

fn run_phase6_fixture(name: &str, file_path: &str, source: &str, convention: Value) -> Value {
    let repo_root = temp_repo(name);
    let route_path = repo_root.join(file_path);
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(&route_path, source).expect("write route");
    fs::write(repo_root.join("package.json"), "{}").expect("write package");
    let scan = run_scan_repo(&repo_root);
    run_check_repo(json!({
        "repo": {
            "repo_id": "repo_phase6",
            "repo_root": repo_root.to_string_lossy()
        },
        "scan": {
            "scan_id": "scan_phase6",
            "facts": scan["facts"]
        },
        "contract": {
            "contract_id": "contract_phase6",
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
            "repo_phase6",
            "--scan-id",
            "scan_phase6",
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
        "drift-security-check-phase6-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create temp repo");
    path
}

/// D-F1: a check that cannot evaluate a security convention must say so, not report a pass.
///
/// The audit filed this as a fact-kind problem: `check_fact_to_engine_fact` translated wire kinds
/// through a hand-written match naming 30 of the 36, and the six it dropped included
/// `raw_sql_called` and `parameterized_sql_used`, which security_facts.rs produces on this exact
/// fixture. That drop is real and is fixed. But it was not what made this case return nothing.
///
/// Measured here: every engine security evaluator - auth, request validation, Phase 4, Phase 5,
/// Phase 6 - re-reads the route file from disk (`read_repo_file`, five call sites) and works from
/// the re-extracted source. None of them reads the facts on the wire for their proof. So `repo_root`
/// is not a mask over the dropped facts; it is the only input those twelve kinds have, and the wire
/// protocol declares it `Option<String>`.
///
/// Against the unfixed engine this request returned `findings: []`, `security_boundary_proofs: []`,
/// `completeness[0].can_block: true`, `complete: true`, `missing_capabilities: []` and no
/// diagnostic - a clean pass for a route that reaches a raw SQL sink with request input in it.
#[test]
fn check_repo_reports_a_gap_when_security_conventions_have_no_source() {
    let source = [
        "const db = { $queryRawUnsafe: async (query) => query };",
        "export async function POST(request: Request) {",
        r#"  const id = request.nextUrl.searchParams.get("id");"#,
        "  await db.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${id}`);",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let repo_root = temp_repo("no_repo_root");
    let route_path = repo_root.join("app/api/users/route.ts");
    fs::create_dir_all(route_path.parent().expect("route parent")).expect("create route parent");
    fs::write(&route_path, &source).expect("write route");
    fs::write(repo_root.join("package.json"), "{}").expect("write package");
    let scan = run_scan_repo(&repo_root);

    // D-F1's fact half: the kinds the old `fact_kind_from_str` dropped are on the wire, so a request
    // that carries them carries real evidence. `FactKind::from_wire` is generated from the same
    // manifest as the enum, so none of them can be dropped on the way into the evaluator again.
    let raw_sql_facts = scan["facts"]
        .as_array()
        .expect("facts")
        .iter()
        .filter(|fact| fact["kind"] == "raw_sql_called")
        .count();
    assert!(
        raw_sql_facts > 0,
        "the scan must emit raw_sql_called for this fixture, or the test proves nothing"
    );

    let payload = run_check_repo(json!({
        // No repo_root. `CheckRepoContext` declares it optional and this is what that means.
        "repo": { "repo_id": "repo_phase6" },
        "scan": {
            "scan_id": "scan_phase6",
            "facts": scan["facts"]
        },
        "contract": {
            "contract_id": "contract_phase6",
            "contract_schema_version": 1,
            "conventions": [json!({
                "id": "security_api_no_raw_sql",
                "kind": "api_route_forbids_raw_sql_without_params",
                "matcher": {
                    "applies_to_file_roles": ["api_route"],
                    "methods": ["POST"]
                },
                "severity": "error",
                "enforcement_mode": "block",
                "enforcement_capability": "deterministic_check"
            })]
        },
        "baseline": [],
        "diff": { "mode": "full", "files": [] }
    }));

    let completeness = &payload["completeness"][0];
    assert_eq!(
        completeness["can_block"],
        json!(false),
        "a check that could not evaluate its only convention must not claim it could block: {payload:#?}"
    );
    assert_eq!(completeness["complete"], json!(false), "{payload:#?}");
    assert_eq!(
        completeness["missing_capabilities"],
        json!(["security_facts", "raw_sql_facts"]),
        "the capabilities the skipped convention needed must be reported missing: {payload:#?}"
    );
    assert_eq!(
        payload["stats"]["capabilities"]["missing"],
        json!(["security_facts", "raw_sql_facts"]),
        "{payload:#?}"
    );
    assert_eq!(
        payload["diagnostics"][0]["code"], "check_source_unavailable",
        "the cause must be named, and it is not a limit breach: {payload:#?}"
    );
    assert!(
        payload["diagnostics"][0]["message"]
            .as_str()
            .expect("message")
            .contains("api_route_forbids_raw_sql_without_params"),
        "{payload:#?}"
    );
}
