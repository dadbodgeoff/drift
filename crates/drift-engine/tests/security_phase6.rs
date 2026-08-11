use drift_engine::{
    AcceptedOutboundUrlHelper, AcceptedSecurityHelper, Phase6AcceptedHelper, Phase6CorsContract,
    Phase6RawSqlContract, Phase6SecurityContract, Phase6SecurityProof, Phase6SsrfContract,
    Phase6UrlSource, SecurityContractCapability, SecurityCorsContract, SecurityCsrfContract,
    SecurityEnforcementMode, SecurityFindingResult, SecurityProofStatus, SecurityRateLimitContract,
    SecurityRawSqlContract, SecuritySsrfContract, build_phase6_security_proof,
    evaluate_api_route_cors_must_match_policy, evaluate_api_route_forbids_raw_sql_without_params,
    evaluate_api_route_forbids_untrusted_ssrf, evaluate_api_route_requires_csrf_for_mutation,
    evaluate_api_route_requires_rate_limit, phase6_proof_to_json,
};

#[test]
fn request_controlled_url_reaches_outbound_request_and_blocks() {
    let source = r#"
export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  await fetch(target);
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_forbids_untrusted_ssrf(
        "app/api/proxy/route.ts",
        source,
        &SecuritySsrfContract {
            contract_id: "security_api_no_ssrf".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_allowlist_helpers: Vec::new(),
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].contract_id, "security_api_no_ssrf");
    assert_eq!(findings[0].expected_layer, "outbound_request");
    assert_eq!(findings[0].actual_layer, "request_controlled_url");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
    assert_eq!(findings[0].drift_category, "missing_proof");
}

#[test]
fn accepted_allowlisted_url_passes_ssrf_contract() {
    let source = r#"
import { requireAllowedOutboundUrl } from "@/security/outbound";

export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  const safeTarget = requireAllowedOutboundUrl(target);
  await fetch(safeTarget);
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_forbids_untrusted_ssrf(
        "app/api/proxy/route.ts",
        source,
        &SecuritySsrfContract {
            contract_id: "security_api_no_ssrf".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_allowlist_helpers: vec![AcceptedOutboundUrlHelper {
                helper_id: "outbound_allowlist".to_string(),
                module: "@/security/outbound".to_string(),
                symbol: "requireAllowedOutboundUrl".to_string(),
            }],
        },
    )
    .expect("security findings");

    assert!(
        findings.is_empty(),
        "accepted allowlist helper should prove outbound URL safety: {findings:#?}"
    );
}

#[test]
fn raw_sql_interpolation_with_untrusted_input_blocks() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  await db.$queryRawUnsafe(`select * from users where id = ${id}`);
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_forbids_raw_sql_without_params(
        "app/api/users/route.ts",
        source,
        &SecurityRawSqlContract {
            contract_id: "security_api_no_raw_sql".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].contract_id, "security_api_no_raw_sql");
    assert_eq!(findings[0].expected_layer, "raw_sql");
    assert_eq!(findings[0].actual_layer, "raw_sql_unparameterized");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn parameterized_sql_passes_raw_sql_contract() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  const rows = await db.$queryRaw`select * from users where id = ${id}`;
  return Response.json({ count: rows.length });
}
"#;

    let findings = evaluate_api_route_forbids_raw_sql_without_params(
        "app/api/users/route.ts",
        source,
        &SecurityRawSqlContract {
            contract_id: "security_api_no_raw_sql".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
        },
    )
    .expect("security findings");

    assert!(
        findings.is_empty(),
        "parameterized SQL should satisfy raw SQL contract: {findings:#?}"
    );
}

#[test]
fn mutation_route_without_accepted_csrf_proof_blocks() {
    let source = r#"
export async function POST(request: Request) {
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_requires_csrf_for_mutation(
        "app/api/settings/route.ts",
        source,
        &SecurityCsrfContract {
            contract_id: "security_api_csrf".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_csrf_helpers: Vec::new(),
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].contract_id, "security_api_csrf");
    assert_eq!(findings[0].expected_layer, "csrf_guard");
    assert_eq!(findings[0].actual_layer, "missing_csrf_guard");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn login_route_without_accepted_rate_limit_proof_blocks() {
    let source = r#"
export async function POST(request: Request) {
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_requires_rate_limit(
        "app/api/login/route.ts",
        source,
        &SecurityRateLimitContract {
            contract_id: "security_api_rate_limit".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_rate_limit_helpers: Vec::new(),
            route_paths: vec!["/api/login".to_string()],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].contract_id, "security_api_rate_limit");
    assert_eq!(findings[0].expected_layer, "rate_limit_guard");
    assert_eq!(findings[0].actual_layer, "missing_rate_limit_guard");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn cors_wildcard_with_credentials_blocks() {
    let source = r#"
export async function GET() {
  return Response.json({ ok: true }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
"#;

    let findings = evaluate_api_route_cors_must_match_policy(
        "app/api/public/route.ts",
        source,
        &SecurityCorsContract {
            contract_id: "security_api_cors".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            allowed_origins: vec!["https://app.example.com".to_string()],
            allow_credentials: true,
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].contract_id, "security_api_cors");
    assert_eq!(findings[0].expected_layer, "cors_policy");
    assert_eq!(findings[0].actual_layer, "wildcard_origin_with_credentials");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn ssrf_wrong_import_path_with_matching_local_name_does_not_prove_safety() {
    let source = r#"
import { requireAllowedOutboundUrl } from "@/local/fake-outbound";

export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  const safeTarget = requireAllowedOutboundUrl(target);
  await fetch(safeTarget);
  return Response.json({ ok: true });
}
"#;

    let proof = phase6_proof("app/api/proxy/route.ts", source, phase6_ssrf_contract());

    assert!(!proof.ssrf.proven, "{proof:#?}");
    assert_eq!(proof.result.proof_status, SecurityProofStatus::MissingProof);
    assert_eq!(proof.ssrf.missing_proof[0].code, "request_controlled_url");
}

#[test]
fn csrf_helper_after_mutation_sink_does_not_prove_safety() {
    let source = r#"
import { requireCsrf } from "@/security/csrf";

export async function POST(request: Request) {
  await db.settings.update({ data: await request.json() });
  await requireCsrf(request);
  return Response.json({ ok: true });
}
"#;

    let proof = phase6_proof("app/api/settings/route.ts", source, phase6_csrf_contract());

    assert!(!proof.csrf.proven, "{proof:#?}");
    assert_eq!(
        proof.csrf.missing_proof[0].code,
        "csrf_guard_not_dominating_sink"
    );
}

#[test]
fn rate_limit_helper_after_response_sink_does_not_prove_safety() {
    let source = r#"
import { requireRateLimit } from "@/security/rate-limit";

export async function POST(request: Request) {
  const response = Response.json({ ok: true });
  await requireRateLimit(request);
  return response;
}
"#;

    let proof = phase6_proof(
        "app/api/login/route.ts",
        source,
        phase6_rate_limit_contract(),
    );

    assert!(!proof.rate_limit.proven, "{proof:#?}");
    assert_eq!(
        proof.rate_limit.missing_proof[0].code,
        "rate_limit_guard_not_dominating_sink"
    );
}

#[test]
fn unknown_ssrf_sanitizer_emits_blocking_parser_gap() {
    let source = r#"
export async function GET(request: Request) {
  const target = request.nextUrl.searchParams.get("target");
  const safeTarget = sanitizeUrl(target);
  await fetch(safeTarget);
  return Response.json({ ok: true });
}
"#;

    let proof = phase6_proof("app/api/proxy/route.ts", source, phase6_ssrf_contract());

    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
    assert_eq!(
        proof.parser_gaps[0].code,
        "unsupported_dynamic_outbound_url"
    );
    assert!(proof.parser_gaps[0].blocks_enforcement);
    assert_eq!(proof.ssrf.missing_proof[0].code, "request_controlled_url");
}

#[test]
fn inline_request_input_reaching_fetch_blocks() {
    let source = r#"
export async function GET(request: Request) {
  await fetch(request.nextUrl.searchParams.get("target"));
  return Response.json({ ok: true });
}
"#;

    let proof = phase6_proof("app/api/proxy/route.ts", source, phase6_ssrf_contract());

    assert!(!proof.ssrf.proven, "{proof:#?}");
    assert_eq!(
        proof.ssrf.outbound_requests[0].url_source,
        Phase6UrlSource::RequestInput
    );
}

#[test]
fn pool_query_template_with_request_input_blocks_as_raw_sql() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  await pool.query(`select * from users where id = ${id}`);
  return Response.json({ ok: true });
}
"#;

    let proof = phase6_proof("app/api/users/route.ts", source, phase6_raw_sql_contract());

    assert!(!proof.raw_sql.proven, "{proof:#?}");
    assert_eq!(proof.raw_sql.raw_sql_calls[0].query_shape, "template");
    assert_eq!(
        proof.raw_sql.missing_proof[0].code,
        "raw_sql_unparameterized"
    );
}

#[test]
fn raw_sql_concat_with_request_input_blocks() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  await db.query("select * from users where id = " + id);
  return Response.json({ ok: true });
}
"#;

    let proof = phase6_proof("app/api/users/route.ts", source, phase6_raw_sql_contract());

    assert_eq!(
        proof.raw_sql.missing_proof[0].code,
        "raw_sql_unparameterized"
    );
}

#[test]
fn sql_placeholder_array_passes_when_sink_id_matches() {
    let source = r#"
export async function GET(request: Request) {
  const id = request.nextUrl.searchParams.get("id");
  const rows = await pool.query("select * from users where id = $1", [id]);
  return Response.json({ count: rows.length });
}
"#;

    let proof = phase6_proof("app/api/users/route.ts", source, phase6_raw_sql_contract());

    assert!(proof.raw_sql.proven, "{proof:#?}");
}

#[test]
fn dynamic_cors_origin_callback_emits_blocking_parser_gap() {
    let source = r#"
export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  return Response.json({ ok: true }, {
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true"
    }
  });
}
"#;

    let proof = phase6_proof("app/api/public/route.ts", source, phase6_cors_contract());

    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
    assert_eq!(proof.parser_gaps[0].code, "unsupported_dynamic_cors_origin");
}

#[test]
fn disallowed_static_cors_origin_blocks() {
    let source = r#"
export async function GET() {
  return Response.json({ ok: true }, {
    headers: { "Access-Control-Allow-Origin": "https://evil.example.com" }
  });
}
"#;

    let proof = phase6_proof("app/api/public/route.ts", source, phase6_cors_contract());

    assert_eq!(proof.cors.missing_proof[0].code, "disallowed_origin");
}

#[test]
fn security_phase8_proof_evidence_refs_are_line_only_and_sanitized() {
    let proof = phase6_proof_to_json(
        &phase6_proof(
            "app/api/proxy/route.ts",
            r#"
export async function POST(request: Request) {
  const body = await request.json();
  await fetch(body.callbackUrl + "?token=secret");
  await db.query("select * from users where token = 'secret'");
  return Response.json({ ok: true });
}
"#,
            phase6_ssrf_contract(),
        ),
        "api_route_forbids_untrusted_ssrf",
        "security_api_no_ssrf",
        "block",
        Some("finding_ssrf"),
    );
    let serialized = serde_json::to_string(&proof).expect("proof json");

    assert!(serialized.contains("\"evidence_refs\""));
    assert!(serialized.contains("\"start_line\""));
    assert!(!serialized.contains("callbackUrl +"));
    assert!(!serialized.contains("select * from users"));
    assert!(!serialized.contains("token=secret"));
    assert!(!serialized.contains("\"source\""));
    assert!(!serialized.contains("\"snippet\""));
    assert!(!serialized.contains("\"payload\""));
    assert!(!serialized.contains("\"cookie\""));
    assert!(!serialized.contains("\"header\""));
}

#[test]
fn security_phase8_phase6_missing_proof_preserves_fact_ids() {
    let proof_json = phase6_proof_to_json(
        &phase6_proof(
            "app/api/proxy/route.ts",
            r#"
export async function POST(request: Request) {
  const body = await request.json();
  await fetch(body.callbackUrl);
  return Response.json({ ok: true });
}
"#,
            phase6_ssrf_contract(),
        ),
        "api_route_forbids_untrusted_ssrf",
        "security_api_no_ssrf",
        "block",
        Some("finding_ssrf"),
    );
    let missing = proof_json["missing_proof"]
        .as_array()
        .expect("missing proof")
        .iter()
        .find(|entry| entry["code"] == "request_controlled_url")
        .expect("ssrf missing proof");

    assert!(
        !missing["fact_ids"].as_array().expect("fact ids").is_empty(),
        "{proof_json:#?}"
    );
    assert_eq!(missing["blocks_enforcement"], true);
}

fn phase6_proof(
    file_path: &str,
    source: &str,
    contract: Phase6SecurityContract,
) -> Phase6SecurityProof {
    build_phase6_security_proof(file_path, source, &contract).expect("phase6 proof")
}

fn phase6_ssrf_contract() -> Phase6SecurityContract {
    Phase6SecurityContract::Ssrf(Phase6SsrfContract {
        contract_id: "security_api_no_ssrf".to_string(),
        accepted_allowlist_helpers: vec![Phase6AcceptedHelper {
            helper_id: "outbound_allowlist".to_string(),
            module: "@/security/outbound".to_string(),
            symbol: "requireAllowedOutboundUrl".to_string(),
        }],
    })
}

fn phase6_raw_sql_contract() -> Phase6SecurityContract {
    Phase6SecurityContract::RawSql(Phase6RawSqlContract {
        contract_id: "security_api_no_raw_sql".to_string(),
    })
}

fn phase6_cors_contract() -> Phase6SecurityContract {
    Phase6SecurityContract::Cors(Phase6CorsContract {
        contract_id: "security_api_cors".to_string(),
        allowed_origins: vec!["https://app.example.com".to_string()],
        allow_credentials: true,
    })
}

fn phase6_csrf_contract() -> Phase6SecurityContract {
    Phase6SecurityContract::Csrf {
        contract_id: "security_api_csrf".to_string(),
        accepted_helpers: vec![AcceptedSecurityHelper {
            helper_id: "csrf".to_string(),
            module: "@/security/csrf".to_string(),
            symbol: "requireCsrf".to_string(),
        }],
    }
}

fn phase6_rate_limit_contract() -> Phase6SecurityContract {
    Phase6SecurityContract::RateLimit {
        contract_id: "security_api_rate_limit".to_string(),
        accepted_helpers: vec![AcceptedSecurityHelper {
            helper_id: "rate_limit".to_string(),
            module: "@/security/rate-limit".to_string(),
            symbol: "requireRateLimit".to_string(),
        }],
        route_paths: vec!["/api/login".to_string()],
    }
}
