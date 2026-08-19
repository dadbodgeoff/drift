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

/// Phase6's scope narrowing used `path_matches_globs`, a prefix/equality shim that had no
/// `**/` case at all: a pattern that ended in neither `/**` nor `*` fell through to
/// `file_path == glob`. Every glob the candidate proposer emits is `**/`-prefixed and ends in
/// `route.ts` / `route.tsx`, so a phase6 convention carrying that scope compared
/// `"app/api/public/route.ts" == "**/app/api/**/route.ts"`, skipped the file, and emitted
/// nothing. Phase4 and phase5 already narrowed with `path_glob_matches`; phase6 was the last
/// caller of the shim, and the shim is now gone.
///
/// This is the revert-proof test for that migration. Restore `path_matches_globs` at the phase6
/// site and this goes red — the route is skipped and `findings` is empty. The glob set is the
/// proposer's literal `route_scope` from `candidate_command.rs`, copied verbatim.
#[test]
fn phase6_narrows_with_the_proposers_globstar_scope() {
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
        "cors_globstar_scope",
        // Root-level app router — the default create-next-app layout, which has zero leading
        // segments for `**/` to consume. That is the case the old matcher could not express.
        "app/api/public/route.ts",
        &source,
        json!({
            "id": "security_api_cors_globstar",
            "kind": "api_route_cors_must_match_policy",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["GET"],
                "path_globs": [
                    "**/app/api/**/route.ts",
                    "**/app/api/**/route.tsx",
                    "**/pages/api/**/*.ts"
                ]
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
        payload["findings"][0]["rule_id"], "api_route_cors_must_match_policy",
        "the proposer's `**/`-prefixed scope must select a root-level app-router route: {payload:#?}"
    );
    assert_eq!(
        payload["findings"][0]["evidence"][0]["file_path"],
        "app/api/public/route.ts"
    );
    assert_eq!(payload["findings"][0]["enforcement_result"], "block");
    assert_eq!(
        payload["security_boundary_proofs"][0]["route"]["normalized_entrypoint_id"],
        "entrypoint:next_app:app/api/public/route.ts:GET"
    );
}

/// The other half: the migration must not have been a filter deletion. A `**/`-prefixed scope
/// that names a *different* route subtree still excludes the file, so phase6 narrows — it just
/// narrows with real globstar semantics now.
#[test]
fn phase6_globstar_scope_still_excludes_routes_it_does_not_name() {
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
        "cors_globstar_scope_miss",
        "app/api/public/route.ts",
        &source,
        json!({
            "id": "security_api_cors_globstar_miss",
            "kind": "api_route_cors_must_match_policy",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["GET"],
                "path_globs": ["**/app/api/admin/**/route.ts"]
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
        payload["findings"],
        json!([]),
        "a scope naming /admin must not select /public: {payload:#?}"
    );
    assert_eq!(
        payload["security_boundary_proofs"],
        json!([]),
        "{payload:#?}"
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

/// S4-04 RED: F3 on the CSRF guard, through the dispatch a user's run actually takes.
///
/// This route imports the accepted guard, calls it before the response, and is compliant. It
/// reaches `@/security/csrf` by a relative path, and `accepted_security_imports` compared that
/// spelling to the contract's as bytes, found them different, built an empty guard map and
/// reported a missing CSRF proof.
///
/// Everything here is real: `scan-repo` produces the facts, `check-repo` evaluates them, and the
/// helper table travels on the matcher exactly as the CLI sends it.
#[test]
fn check_repo_csrf_proof_survives_a_relative_spelling_of_the_helper_module() {
    let source = [
        r#"import { requireCsrf } from "../../../security/csrf";"#,
        "export async function POST(request: Request) {",
        "  requireCsrf(request);",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_phase6_fixture(
        "csrf_relative",
        "app/api/settings/route.ts",
        &source,
        csrf_convention(Some(json!([{
            "requires_key": "csrf_helpers",
            "symbol": "requireCsrf",
            "specifier": "@/security/csrf",
            "mode": "repo_resolved",
            "files": ["security/csrf.ts"]
        }]))),
    );

    assert_eq!(
        payload["security_boundary_proofs"][0]["csrf"]["proven"],
        json!(true),
        "{payload:#?}"
    );
    assert_eq!(payload["findings"], json!([]), "{payload:#?}");
}

/// S4-04 RED: the same on the SSRF allowlist, which reads its helpers through `accepted_imports`.
#[test]
fn check_repo_ssrf_allowlist_survives_a_relative_spelling_of_the_helper_module() {
    let source = [
        r#"import { requireAllowedOutboundUrl } from "../../../security/outbound";"#,
        "export async function GET(request: Request) {",
        r#"  const target = request.nextUrl.searchParams.get("target");"#,
        "  const safeTarget = requireAllowedOutboundUrl(target);",
        "  await fetch(safeTarget);",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let convention = |table: Value| {
        json!({
            "id": "security_api_no_ssrf",
            "kind": "api_route_forbids_untrusted_ssrf",
            "matcher": {
                "applies_to_file_roles": ["api_route"],
                "methods": ["GET"],
                "accepted_helper_module_files": table
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
        })
    };

    let payload = run_phase6_fixture(
        "ssrf_relative",
        "app/api/proxy/route.ts",
        &source,
        convention(json!([{
            "requires_key": "outbound_url_allowlist_helpers",
            "symbol": "requireAllowedOutboundUrl",
            "specifier": "@/security/outbound",
            "mode": "repo_resolved",
            "files": ["security/outbound.ts"]
        }])),
    );

    assert_eq!(
        payload["security_boundary_proofs"][0]["ssrf"]["proven"],
        json!(true),
        "{payload:#?}"
    );
    assert_eq!(payload["findings"], json!([]), "{payload:#?}");
}

/// A characterization, GREEN before this sprint and pinned so it stays that way.
///
/// The plan expected F4 - renamed imports producing findings on compliant routes - to be live
/// here. It is not, and this is the test that says so: `accepted_security_imports` has always
/// keyed its map by the LOCAL binding and matched on `imported_name`, so `as` never confused it.
/// The rename defect was real only in `security_rules.rs`, which nothing in `src/` calls.
///
/// Pinned rather than deleted because the fix in the previous commit moved code on both sides of
/// this question, and "the real path was already right" is worth exactly as much as the test that
/// would notice it stopping being right.
#[test]
fn check_repo_csrf_proof_already_survived_a_renamed_import() {
    let source = [
        r#"import { requireCsrf as checkCsrf } from "@/security/csrf";"#,
        "export async function POST(request: Request) {",
        "  checkCsrf(request);",
        "  return Response.json({ ok: true });",
        "}",
        "",
    ]
    .join("\n");
    let payload = run_phase6_fixture(
        "csrf_renamed",
        "app/api/settings/route.ts",
        &source,
        csrf_convention(None),
    );

    assert_eq!(
        payload["security_boundary_proofs"][0]["csrf"]["proven"],
        json!(true),
        "{payload:#?}"
    );
    assert_eq!(payload["findings"], json!([]), "{payload:#?}");
}

fn csrf_convention(helper_module_files: Option<Value>) -> Value {
    let mut matcher = json!({
        "applies_to_file_roles": ["api_route"],
        "methods": ["POST"]
    });
    if let Some(table) = helper_module_files {
        matcher["accepted_helper_module_files"] = table;
    }
    json!({
        "id": "security_api_csrf",
        "kind": "api_route_requires_csrf_for_mutation",
        "matcher": matcher,
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
    })
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
