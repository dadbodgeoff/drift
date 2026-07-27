use drift_engine::{
    AcceptedAuthHelper, AcceptedAuthorizationHelper, AcceptedPhase5Contract,
    AcceptedRequestValidator, AcceptedResponseSerializer, AcceptedSensitiveResponseField,
    AcceptedTenantHelper, AuthGuardBehavior, AuthorizationHelperBehavior, AuthorizationHelperKind,
    Phase4SecurityPolicy, RequestValidatorBehavior, RequestValidatorKind, ResponseSerializerPolicy,
    SecurityAuthContract, SecurityAuthorizationContract, SecurityContractCapability,
    SecurityEnforcementMode, SecurityFindingResult, SecurityMiddlewareContract,
    SecurityPhase5Contract, SecurityProofStatus, SecurityRequestValidationContract,
    SecurityTenantScopeContract, build_phase4_security_proof_with_policy,
    build_request_validation_proof, build_response_shape_proof, build_secret_exposure_proof,
    evaluate_api_route_forbids_secret_exposure,
    evaluate_api_route_forbids_sensitive_response_fields, evaluate_api_route_requires_auth_helper,
    evaluate_api_route_requires_auth_helper_with_middleware,
    evaluate_api_route_requires_authorization, evaluate_api_route_requires_request_validation,
    evaluate_api_route_requires_tenant_scope, evaluate_middleware_must_cover_routes,
    extract_security_facts, static_middleware_coverage,
};

#[test]
fn security_phase5_response_shape_proof_tracks_sensitive_leaks_and_serializers() {
    let raw_source = r#"
export async function GET() {
  const email = "redacted@example.test";
  return Response.json({ user: { email } });
}
"#;
    let filtering_source = r#"
import { serializePublicUser } from "@/lib/serializers/user";
export async function GET() {
  const user = { email: "redacted@example.test" };
  const payload = serializePublicUser(user);
  return Response.json({ user: { email: payload.email } });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: vec![AcceptedResponseSerializer {
            serializer_id: "serializePublicUser".to_string(),
            import_source: "@/lib/serializers/user".to_string(),
            imported_name: "serializePublicUser".to_string(),
            local_name: None,
            policy: ResponseSerializerPolicy::Denylist,
            filtered_fields: vec!["user.email".to_string()],
        }],
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };

    let raw = build_response_shape_proof("app/api/users/route.ts", raw_source, &phase5)
        .expect("raw proof");
    assert_eq!(raw.response_shape.sensitive_leaks.len(), 1, "{raw:#?}");
    assert_eq!(
        raw.response_shape.sensitive_leaks[0].reason,
        "sensitive_field_without_serializer"
    );

    let filtered = build_response_shape_proof("app/api/users/route.ts", filtering_source, &phase5)
        .expect("filtered proof");
    assert!(
        filtered.response_shape.sensitive_leaks.is_empty(),
        "accepted serializer should prove safe: {filtered:#?}"
    );

    let different_serializer = AcceptedPhase5Contract {
        response_serializers: vec![AcceptedResponseSerializer {
            filtered_fields: vec!["user.name".to_string()],
            ..phase5.response_serializers[0].clone()
        }],
        ..phase5.clone()
    };
    let different = build_response_shape_proof(
        "app/api/users/route.ts",
        filtering_source,
        &different_serializer,
    )
    .expect("different serializer proof");
    assert_eq!(
        different.response_shape.sensitive_leaks.len(),
        1,
        "serializer filtering a different field must not prove safe: {different:#?}"
    );

    let candidate = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "candidate".to_string(),
        }],
        response_serializers: Vec::new(),
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };
    let candidate_proof =
        build_response_shape_proof("app/api/users/route.ts", raw_source, &candidate)
            .expect("candidate proof");
    assert!(
        candidate_proof.response_shape.sensitive_leaks.is_empty(),
        "candidate-only sensitive fields must not block: {candidate_proof:#?}"
    );
}

#[test]
fn security_phase5_serializer_call_must_feed_emitted_response_value() {
    let source = r#"
import { serializePublicUser } from "@/lib/serializers/user";
export async function GET() {
  const user = { email: "redacted@example.test" };
  const safe = serializePublicUser(user);
  void safe;
  return Response.json({ user: { email: user.email } });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: vec![AcceptedResponseSerializer {
            serializer_id: "serializePublicUser".to_string(),
            import_source: "@/lib/serializers/user".to_string(),
            imported_name: "serializePublicUser".to_string(),
            local_name: None,
            policy: ResponseSerializerPolicy::Denylist,
            filtered_fields: vec!["user.email".to_string()],
        }],
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };

    let proof = build_response_shape_proof("app/api/users/route.ts", source, &phase5)
        .expect("response proof");
    assert_eq!(proof.response_shape.sensitive_leaks.len(), 1, "{proof:#?}");
    assert_eq!(
        proof.response_shape.sensitive_leaks[0].reason,
        "sensitive_field_without_serializer"
    );
}

#[test]
fn security_phase5_serializer_output_used_in_response_proves_safe() {
    let source = r#"
import { serializePublicUser } from "@/lib/serializers/user";
export async function GET() {
  const user = { email: "redacted@example.test" };
  const safe = serializePublicUser(user);
  return Response.json({ user: { email: safe.email } });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: vec![AcceptedResponseSerializer {
            serializer_id: "serializePublicUser".to_string(),
            import_source: "@/lib/serializers/user".to_string(),
            imported_name: "serializePublicUser".to_string(),
            local_name: None,
            policy: ResponseSerializerPolicy::Denylist,
            filtered_fields: vec!["user.email".to_string()],
        }],
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };

    let proof = build_response_shape_proof("app/api/users/route.ts", source, &phase5)
        .expect("response proof");
    assert!(
        proof.response_shape.sensitive_leaks.is_empty(),
        "{proof:#?}"
    );
}

#[test]
fn security_phase5_response_variable_spread_blocks_with_parser_gap() {
    let source = r#"
export async function GET() {
  const user = { email: "redacted@example.test" };
  const payload = { ...user };
  return Response.json(payload);
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "user.email".to_string(),
            classification: "pii".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: Vec::new(),
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };

    let proof = build_response_shape_proof("app/api/users/route.ts", source, &phase5)
        .expect("response proof");
    assert_eq!(
        proof.result.proof_status,
        SecurityProofStatus::ParserGap,
        "{proof:#?}"
    );
    assert!(
        proof
            .parser_gaps
            .iter()
            .any(|gap| gap.code == "unsupported_destructuring_or_spread"),
        "{proof:#?}"
    );
}

#[test]
fn security_phase5_secret_object_alias_reaches_response_sink() {
    let source = r#"
export async function GET() {
  const apiKey = process.env.API_KEY;
  const payload = { apiKey };
  return Response.json(payload);
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: vec!["console.error".to_string()],
    };

    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(proof.secret_exposure.exposed_secrets.len(), 1, "{proof:#?}");
    assert_eq!(
        proof.secret_exposure.exposed_secrets[0].sink_kind,
        "response"
    );
}

#[test]
fn security_phase5_inline_secret_read_in_response_blocks() {
    let source = r#"
export async function GET() {
  return Response.json({ apiKey: process.env.API_KEY });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: vec!["console.error".to_string()],
    };

    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(proof.secret_exposure.exposed_secrets.len(), 1, "{proof:#?}");
}

#[test]
fn security_phase5_arrow_secret_helper_emits_parser_gap() {
    let source = r#"
const readSecret = () => process.env.API_KEY;
export async function GET() {
  const apiKey = readSecret();
  return Response.json({ apiKey });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: Vec::new(),
    };
    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(
        proof.result.proof_status,
        SecurityProofStatus::ParserGap,
        "{proof:#?}"
    );
}

#[test]
fn security_phase5_imported_unknown_secret_helper_emits_parser_gap() {
    let source = r#"
import { readSecret } from "@/server/secrets";
export async function GET() {
  const apiKey = readSecret();
  return Response.json({ apiKey });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string(), "secret_manager".to_string()],
        log_sinks: Vec::new(),
    };
    let proof = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    assert_eq!(
        proof.result.proof_status,
        SecurityProofStatus::ParserGap,
        "{proof:#?}"
    );
}

#[test]
fn security_phase5_secret_exposure_proof_tracks_direct_response_and_log_flows() {
    let response_source = r#"
export async function GET() {
  const apiKey = process.env.API_KEY;
  return Response.json({ apiKey });
}
"#;
    let log_source = r#"
export async function GET() {
  const token = process.env["TOKEN"];
  console.error(token);
  return Response.json({ ok: true });
}
"#;
    let unrelated_source = r#"
export async function GET() {
  const apiKey = process.env.API_KEY;
  return Response.json({ ok: true });
}
"#;
    let helper_source = r#"
function readSecret() {
  return process.env.API_KEY;
}
export async function GET() {
  const apiKey = readSecret();
  return Response.json({ apiKey });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: vec!["console.error".to_string(), "logger.error".to_string()],
    };

    let response =
        build_secret_exposure_proof("app/api/secrets/route.ts", response_source, &phase5)
            .expect("response proof");
    assert_eq!(
        response.secret_exposure.exposed_secrets.len(),
        1,
        "{response:#?}"
    );

    let log = build_secret_exposure_proof("app/api/secrets/route.ts", log_source, &phase5)
        .expect("log proof");
    assert_eq!(log.secret_exposure.exposed_secrets.len(), 1, "{log:#?}");

    let unrelated =
        build_secret_exposure_proof("app/api/secrets/route.ts", unrelated_source, &phase5)
            .expect("unrelated proof");
    assert!(
        unrelated.secret_exposure.exposed_secrets.is_empty(),
        "unrelated secret read must not block: {unrelated:#?}"
    );

    let helper = build_secret_exposure_proof("app/api/secrets/route.ts", helper_source, &phase5)
        .expect("helper proof");
    assert_eq!(
        helper.result.proof_status,
        drift_engine::SecurityProofStatus::ParserGap,
        "indirect helper secret return must not silently pass: {helper:#?}"
    );

    let serialized = format!("{response:#?}{log:#?}{helper:#?}");
    assert!(!serialized.contains("API_KEY"));
    assert!(!serialized.contains("TOKEN"));
}

#[test]
fn security_phase5_rules_block_sensitive_leaks_and_secret_exposure() {
    let raw_sensitive_source = r#"
export async function GET() {
  const email = "redacted@example.test";
  return Response.json({ user: { email } });
}
"#;
    let serializer_source = r#"
import { serializePublicUser } from "@/lib/serializers/user";
export async function GET() {
  const user = { email: "redacted@example.test" };
  const payload = serializePublicUser(user);
  return Response.json({ user: { email: payload.email } });
}
"#;
    let spread_source = r#"
export async function GET() {
  const user = { email: "redacted@example.test" };
  return Response.json({ ...user });
}
"#;
    let candidate_source = r#"
export async function GET() {
  const password = "candidate-only";
  return Response.json({ password });
}
"#;
    let secret_source = r#"
export async function GET() {
  const apiKey = process.env.API_KEY;
  return Response.json({ apiKey });
}
"#;

    let sensitive_contract = SecurityPhase5Contract {
        contract_id: "security_sensitive_response".to_string(),
        capability: SecurityContractCapability::DeterministicCheck,
        enforcement_mode: SecurityEnforcementMode::Block,
        methods: vec!["GET".to_string()],
        path_globs: Vec::new(),
        accepted_phase5: AcceptedPhase5Contract {
            sensitive_response_fields: vec![AcceptedSensitiveResponseField {
                field_path: "user.email".to_string(),
                classification: "pii".to_string(),
                source: "contract".to_string(),
            }],
            response_serializers: vec![AcceptedResponseSerializer {
                serializer_id: "serializePublicUser".to_string(),
                import_source: "@/lib/serializers/user".to_string(),
                imported_name: "serializePublicUser".to_string(),
                local_name: None,
                policy: ResponseSerializerPolicy::Denylist,
                filtered_fields: vec!["user.email".to_string()],
            }],
            secret_sources: Vec::new(),
            log_sinks: Vec::new(),
        },
    };

    let raw_findings = evaluate_api_route_forbids_sensitive_response_fields(
        "app/api/users/route.ts",
        raw_sensitive_source,
        &sensitive_contract,
    )
    .expect("raw sensitive findings");
    assert_eq!(raw_findings.len(), 1, "{raw_findings:#?}");
    assert_eq!(
        raw_findings[0].enforcement_result,
        SecurityFindingResult::Block
    );
    assert_eq!(
        raw_findings[0].actual_layer,
        "sensitive_response_field_unfiltered"
    );

    let serializer_findings = evaluate_api_route_forbids_sensitive_response_fields(
        "app/api/users/route.ts",
        serializer_source,
        &sensitive_contract,
    )
    .expect("serializer findings");
    assert!(
        serializer_findings.is_empty(),
        "accepted serializer proof must pass: {serializer_findings:#?}"
    );

    let spread_findings = evaluate_api_route_forbids_sensitive_response_fields(
        "app/api/users/route.ts",
        spread_source,
        &sensitive_contract,
    )
    .expect("spread findings");
    assert_eq!(spread_findings.len(), 1, "{spread_findings:#?}");
    assert_eq!(
        spread_findings[0].actual_layer,
        "dynamic_response_shape_missing_proof"
    );

    let candidate_contract = SecurityPhase5Contract {
        accepted_phase5: AcceptedPhase5Contract {
            sensitive_response_fields: vec![AcceptedSensitiveResponseField {
                field_path: "password".to_string(),
                classification: "credential".to_string(),
                source: "candidate".to_string(),
            }],
            response_serializers: Vec::new(),
            secret_sources: Vec::new(),
            log_sinks: Vec::new(),
        },
        ..sensitive_contract.clone()
    };
    let candidate_findings = evaluate_api_route_forbids_sensitive_response_fields(
        "app/api/users/route.ts",
        candidate_source,
        &candidate_contract,
    )
    .expect("candidate findings");
    assert!(
        candidate_findings.is_empty(),
        "candidate sensitive fields must not block: {candidate_findings:#?}"
    );

    let secret_contract = SecurityPhase5Contract {
        contract_id: "security_secret_exposure".to_string(),
        capability: SecurityContractCapability::DeterministicCheck,
        enforcement_mode: SecurityEnforcementMode::Block,
        methods: vec!["GET".to_string()],
        path_globs: Vec::new(),
        accepted_phase5: AcceptedPhase5Contract {
            sensitive_response_fields: Vec::new(),
            response_serializers: Vec::new(),
            secret_sources: vec!["env".to_string()],
            log_sinks: vec!["console.error".to_string()],
        },
    };
    let secret_findings = evaluate_api_route_forbids_secret_exposure(
        "app/api/secrets/route.ts",
        secret_source,
        &secret_contract,
    )
    .expect("secret findings");
    assert_eq!(secret_findings.len(), 1, "{secret_findings:#?}");
    assert_eq!(
        secret_findings[0].actual_layer,
        "secret_exposure_not_excluded"
    );
}

#[test]
fn security_phase5_no_sensitive_output_in_rust_proofs() {
    let source = r#"
export async function GET(request: Request) {
  const token = process.env.API_KEY;
  const tenant = "tenant-should-not-leak";
  const cookie = "cookie-should-not-leak";
  const authorization = "Authorization: Bearer should-not-leak";
  const payload = "request payload canary";
  return Response.json({ token, tenant, cookie, authorization, payload });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: vec![AcceptedSensitiveResponseField {
            field_path: "token".to_string(),
            classification: "token".to_string(),
            source: "contract".to_string(),
        }],
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: vec!["console.error".to_string()],
    };
    let response = build_response_shape_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("response proof");
    let secrets = build_secret_exposure_proof("app/api/secrets/route.ts", source, &phase5)
        .expect("secret proof");
    let serialized = format!("{response:#?}{secrets:#?}");

    for canary in [
        "SECRET_VALUE_SHOULD_NOT_LEAK",
        "sk_live_should_not_leak",
        "tenant-should-not-leak",
        "cookie-should-not-leak",
        "Authorization: Bearer should-not-leak",
        "request payload canary",
        "API_KEY",
    ] {
        assert!(
            !serialized.contains(canary),
            "Rust proof leaked sensitive canary {canary}: {serialized}"
        );
    }
}

#[test]
fn accepted_auth_helper_contract_blocks_missing_auth() {
    let source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;
    let findings = evaluate_api_route_requires_auth_helper(
        "app/api/projects/route.ts",
        source,
        &SecurityAuthContract {
            contract_id: "security_api_auth_require_user".to_string(),
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsUser,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].contract_id, "security_api_auth_require_user");
    assert_eq!(findings[0].title, "API route missing required auth proof");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
    assert_eq!(findings[0].drift_category, "missing_proof");
    assert_eq!(findings[0].confidence_label, "certain");
}

#[test]
fn middleware_matcher_covers_grouped_next_api_route() {
    let middleware_facts = extract_security_facts(
        "middleware.ts",
        r#"import { NextResponse } from "next/server";
export function middleware(request) {
  return NextResponse.next();
}
export const config = { matcher: ["/api/:path*"] };
"#,
        &[AcceptedAuthHelper {
            guard_id: "middleware_next_response".to_string(),
            symbol: "NextResponse.next".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("middleware facts");

    let (matched, mismatches) = static_middleware_coverage(
        &middleware_facts,
        "app/(admin)/api/projects/route.ts",
        "GET",
    );

    assert_eq!(
        mismatches,
        Vec::new(),
        "unexpected mismatches: {mismatches:#?}"
    );
    assert_eq!(
        matched.len(),
        1,
        "missing middleware coverage: {matched:#?}"
    );
}

#[test]
fn untrusted_session_cannot_satisfy_tenant_or_authorization_proof() {
    let source = r#"
import { db } from "@/server/db";
import { requireRole } from "@/server/authorization";

export async function GET(request: Request) {
  const session = await request.json();
  requireRole(session.user, "admin");
  await db.project.findMany({ where: { tenantId: session.user.tenantId } });
  return Response.json({});
}
"#;

    let proof = build_phase4_security_proof_with_policy(
        "app/api/projects/route.ts",
        source,
        &Phase4SecurityPolicy {
            authorization_helpers: vec![AcceptedAuthorizationHelper {
                guard_id: "authorization_require_role".to_string(),
                symbol: "requireRole".to_string(),
                import_source: None,
                kind: AuthorizationHelperKind::Role,
                behavior: AuthorizationHelperBehavior::Throws,
            }],
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            ..Phase4SecurityPolicy::default()
        },
    )
    .expect("phase4 proof");

    assert!(
        !proof.session_trust.proven,
        "request-derived session must not be trusted: {proof:#?}"
    );
    assert!(
        !proof.authorization.proven,
        "authorization must not be proven from untrusted session: {proof:#?}"
    );
    assert!(
        proof
            .authorization
            .missing
            .iter()
            .any(|missing| missing.reason == "session_not_trusted"),
        "authorization missing proof must include session_not_trusted: {proof:#?}"
    );
    assert!(
        !proof.tenant.proven,
        "tenant proof must not be proven from untrusted session: {proof:#?}"
    );
    assert!(
        proof
            .tenant
            .missing
            .iter()
            .any(|missing| missing.reason == "tenant_source_untrusted"),
        "tenant missing proof must include tenant_source_untrusted: {proof:#?}"
    );
}

#[test]
fn tenant_scoped_route_without_tenant_predicate_blocks() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  await db.project.findMany();
  return Response.json({});
}
"#;

    let findings = evaluate_api_route_requires_tenant_scope(
        "app/api/projects/route.ts",
        source,
        &SecurityTenantScopeContract {
            contract_id: "security_api_tenant_scope".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            tenant_helpers: vec!["scopeProjectToTenant".to_string()],
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("tenant findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].contract_id, "security_api_tenant_scope");
    assert_eq!(
        findings[0].title,
        "API route missing required tenant scope proof"
    );
    assert_eq!(findings[0].expected_layer, "tenant_scope");
    assert_eq!(findings[0].actual_layer, "tenant_predicate_missing");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
    assert_eq!(findings[0].drift_category, "missing_proof");
    assert_eq!(findings[0].confidence_label, "certain");
}

#[test]
fn tenant_param_read_but_not_bound_to_data_operation_blocks() {
    let source = r#"
import { db } from "@/server/db";

export async function GET(request: Request, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId;
  await db.project.findMany({ where: { archived: false } });
  return Response.json({});
}
"#;

    let findings = evaluate_api_route_requires_tenant_scope(
        "app/api/projects/route.ts",
        source,
        &SecurityTenantScopeContract {
            contract_id: "security_api_tenant_scope".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: Vec::new(),
            tenant_helpers: vec!["scopeProjectToTenant".to_string()],
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["path_param".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("tenant findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(
        findings[0].actual_layer,
        "tenant_predicate_not_bound_to_query"
    );
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn trusted_tenant_source_bound_to_data_predicate_passes() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  const projects = await db.project.findMany({
    where: { tenantId: session.user.tenantId }
  });
  return Response.json(projects);
}
"#;

    let findings = evaluate_api_route_requires_tenant_scope(
        "app/api/projects/route.ts",
        source,
        &SecurityTenantScopeContract {
            contract_id: "security_api_tenant_scope".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            tenant_helpers: vec!["scopeProjectToTenant".to_string()],
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("tenant findings");

    assert!(
        findings.is_empty(),
        "trusted tenant predicate should satisfy tenant scope: {findings:#?}"
    );
}

#[test]
fn accepted_tenant_scope_helper_bound_to_data_operation_passes() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { scopeProjectToTenant } from "@/server/tenant";

export async function GET(request: Request) {
  const session = await requireUser(request);
  const scoped = scopeProjectToTenant(db.project, session.user.tenantId);
  const projects = await db.project.findMany();
  return Response.json(projects);
}
"#;

    let proof = build_phase4_security_proof_with_policy(
        "app/api/projects/route.ts",
        source,
        &Phase4SecurityPolicy {
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            tenant_helpers: vec![AcceptedTenantHelper {
                helper_id: "tenant_scope_project".to_string(),
                symbol: "scopeProjectToTenant".to_string(),
                import_source: None,
                tenant_key: "tenantId".to_string(),
            }],
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            ..Phase4SecurityPolicy::default()
        },
    )
    .expect("phase4 proof");

    assert!(
        proof.tenant.required,
        "tenant proof must be required: {proof:#?}"
    );
    assert!(
        proof.tenant.proven,
        "tenant helper should prove scope: {proof:#?}"
    );
    assert!(
        proof
            .tenant
            .predicates
            .iter()
            .any(|predicate| predicate.predicate_kind == "scoped_helper"),
        "scoped helper predicate must be preserved: {proof:#?}"
    );

    let findings = evaluate_api_route_requires_tenant_scope(
        "app/api/projects/route.ts",
        source,
        &SecurityTenantScopeContract {
            contract_id: "security_api_tenant_scope".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            tenant_helpers: vec!["scopeProjectToTenant".to_string()],
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("tenant findings");

    assert!(
        findings.is_empty(),
        "accepted tenant helper should satisfy tenant scope: {findings:#?}"
    );
}

#[test]
fn authorization_required_route_without_guard_blocks() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function DELETE(request: Request, { params }: { params: { projectId: string } }) {
  const session = await requireUser(request);
  await db.project.delete({ where: { id: params.projectId, tenantId: session.user.tenantId } });
  return Response.json({});
}
"#;

    let findings = evaluate_api_route_requires_authorization(
        "app/api/projects/route.ts",
        source,
        &SecurityAuthorizationContract {
            contract_id: "security_api_authorization".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            authorization_helpers: vec!["requireRole".to_string(), "canAccessProject".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("authorization findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].contract_id, "security_api_authorization");
    assert_eq!(
        findings[0].title,
        "API route missing required authorization proof"
    );
    assert_eq!(findings[0].expected_layer, "authorization");
    assert_eq!(findings[0].actual_layer, "authorization_guard_missing");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
    assert_eq!(findings[0].drift_category, "missing_proof");
    assert_eq!(findings[0].confidence_label, "certain");
}

#[test]
fn accepted_authorization_guard_with_trusted_session_passes() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { requireRole } from "@/server/authorization";
import { db } from "@/server/db";

export async function DELETE(request: Request, { params }: { params: { projectId: string } }) {
  const session = await requireUser(request);
  requireRole(session.user, "admin");
  await db.project.delete({ where: { id: params.projectId, tenantId: session.user.tenantId } });
  return Response.json({});
}
"#;

    let proof = build_phase4_security_proof_with_policy(
        "app/api/projects/route.ts",
        source,
        &Phase4SecurityPolicy {
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            authorization_helpers: vec![AcceptedAuthorizationHelper {
                guard_id: "authorization_require_role".to_string(),
                symbol: "requireRole".to_string(),
                import_source: None,
                kind: AuthorizationHelperKind::Role,
                behavior: AuthorizationHelperBehavior::Throws,
            }],
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            ..Phase4SecurityPolicy::default()
        },
    )
    .expect("phase4 proof");

    assert!(
        proof.authorization.required,
        "authorization required: {proof:#?}"
    );
    assert!(
        proof.authorization.proven,
        "authorization should be proven: {proof:#?}"
    );
    assert!(
        proof
            .authorization
            .role_or_policy_guards
            .iter()
            .any(|guard| {
                guard.policy_id.as_deref() == Some("authorization_require_role")
                    && guard.subject_var.as_deref() == Some("session.user")
                    && guard.roles == vec!["admin".to_string()]
            }),
        "accepted role guard metadata must be preserved: {proof:#?}"
    );

    let findings = evaluate_api_route_requires_authorization(
        "app/api/projects/route.ts",
        source,
        &SecurityAuthorizationContract {
            contract_id: "security_api_authorization".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            authorization_helpers: vec!["requireRole".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("authorization findings");

    assert!(
        findings.is_empty(),
        "accepted authorization guard should satisfy contract: {findings:#?}"
    );
}

#[test]
fn candidate_only_role_and_tenant_evidence_does_not_block() {
    let source = r#"
import { getSession } from "@/server/session";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await getSession(request);
  if (session.user.role === "admin") {
    await db.project.findMany({ where: { tenantId: session.user.tenantId } });
  }
  return Response.json({});
}
"#;

    let proof = build_phase4_security_proof_with_policy(
        "app/api/projects/route.ts",
        source,
        &Phase4SecurityPolicy {
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            ..Phase4SecurityPolicy::default()
        },
    )
    .expect("phase4 proof");

    assert!(
        !proof.authorization.proven,
        "inline role comparison must not satisfy authorization proof: {proof:#?}"
    );
    assert!(
        proof.authorization.role_or_policy_guards.is_empty(),
        "inline role comparison must not emit accepted authorization guard: {proof:#?}"
    );
    assert!(
        !proof.tenant.proven,
        "tenant-looking variable from unknown session helper must not satisfy tenant proof: {proof:#?}"
    );
    assert!(
        proof
            .tenant
            .missing
            .iter()
            .any(|missing| missing.reason == "tenant_source_untrusted"),
        "candidate tenant evidence must remain missing proof, not deterministic proof: {proof:#?}"
    );
}

#[test]
fn security_phase4_unaccepted_helpers_do_not_satisfy_proof() {
    let authorization_source = r#"
import { requireUser } from "@/server/auth";
import { requireRole, canAccessProject } from "@/server/authorization";
import { db } from "@/server/db";

export async function DELETE(request: Request, { params }: { params: { projectId: string } }) {
  const session = await requireUser(request);
  requireRole(session.user, "admin");
  if (!canAccessProject(session.user, params.projectId, "project:delete")) {
    return new Response("forbidden", { status: 403 });
  }
  await db.project.delete({ where: { id: params.projectId, tenantId: session.user.tenantId } });
  return Response.json({});
}
"#;

    for authorization_helpers in [Vec::new(), vec!["someOtherGuard".to_string()]] {
        let findings = evaluate_api_route_requires_authorization(
            "app/api/projects/route.ts",
            authorization_source,
            &SecurityAuthorizationContract {
                contract_id: "security_api_authorization".to_string(),
                capability: SecurityContractCapability::DeterministicCheck,
                enforcement_mode: SecurityEnforcementMode::Block,
                accepted_auth_helpers: vec![AcceptedAuthHelper {
                    guard_id: "auth_require_user".to_string(),
                    symbol: "requireUser".to_string(),
                    behavior: AuthGuardBehavior::ReturnsSession,
                }],
                authorization_helpers,
                data_operations: Vec::new(),
            },
        )
        .expect("authorization findings");

        assert_eq!(
            findings.len(),
            1,
            "unaccepted requireRole/canAccessProject must not satisfy authorization proof: {findings:#?}"
        );
        assert_eq!(findings[0].actual_layer, "authorization_guard_missing");
    }

    let tenant_helper_source = r#"
import { requireUser } from "@/server/auth";
import { scopeProjectToTenant } from "@/server/tenant";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  const scoped = scopeProjectToTenant(db.project, session.user.tenantId);
  const projects = await db.project.findMany();
  return Response.json(projects);
}
"#;

    let findings = evaluate_api_route_requires_tenant_scope(
        "app/api/projects/route.ts",
        tenant_helper_source,
        &SecurityTenantScopeContract {
            contract_id: "security_api_tenant_scope".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            tenant_helpers: Vec::new(),
            tenant_keys: vec!["tenantId".to_string()],
            tenant_sources: vec!["session".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("tenant findings");

    assert_eq!(
        findings.len(),
        1,
        "unaccepted scopeProjectToTenant must not satisfy tenant proof: {findings:#?}"
    );

    let tenant_key_source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  const projects = await db.project.findMany({
    where: { tenantId: session.user.tenantId }
  });
  return Response.json(projects);
}
"#;

    let findings = evaluate_api_route_requires_tenant_scope(
        "app/api/projects/route.ts",
        tenant_key_source,
        &SecurityTenantScopeContract {
            contract_id: "security_api_tenant_scope".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            }],
            tenant_helpers: Vec::new(),
            tenant_keys: vec!["orgId".to_string()],
            tenant_sources: vec!["session".to_string()],
            data_operations: Vec::new(),
        },
    )
    .expect("tenant findings");

    assert_eq!(
        findings.len(),
        1,
        "tenantId must not satisfy tenant proof when only orgId is accepted: {findings:#?}"
    );
}

#[test]
fn request_body_reaches_data_operation_without_validation_blocks() {
    let source = r#"
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "security_api_request_validation".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            methods: Vec::new(),
            input_sources: Vec::new(),
            sinks: Vec::new(),
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].contract_id, "security_api_request_validation");
    assert_eq!(
        findings[0].title,
        "API route uses unvalidated request input"
    );
    assert_eq!(findings[0].expected_layer, "request_validation");
    assert_eq!(findings[0].actual_layer, "request_input_not_validated");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
    assert_eq!(findings[0].drift_category, "missing_proof");
    assert_eq!(findings[0].confidence_label, "certain");
}

#[test]
fn route_without_request_input_does_not_require_request_validation() {
    let source = r#"
const db = { project: { findMany: async () => [] } };
export async function GET() {
  const projects = await db.project.findMany();
  return Response.json(projects);
}
"#;
    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "security_api_request_validation".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            methods: Vec::new(),
            input_sources: Vec::new(),
            sinks: Vec::new(),
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("request validation findings");

    assert!(
        findings.is_empty(),
        "no request input should not block: {findings:#?}"
    );
}

#[test]
fn request_validation_contract_applies_only_to_configured_methods() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function GET(request: Request) {
  const body = await request.json();
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;
    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "security_api_request_validation".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            methods: vec!["POST".to_string()],
            input_sources: Vec::new(),
            sinks: Vec::new(),
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("request validation findings");

    assert!(
        findings.is_empty(),
        "POST-only request validation should not apply to GET: {findings:#?}"
    );
}

#[test]
fn validator_called_but_raw_input_used_blocks() {
    let source = r#"
import { ProjectInputSchema } from "@/server/validation";
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = ProjectInputSchema.parse(body);
  await db.project.create({ data: body });
  return Response.json({ parsed });
}
"#;

    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "security_api_request_validation".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            methods: Vec::new(),
            input_sources: Vec::new(),
            sinks: Vec::new(),
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].actual_layer, "request_input_not_validated");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn validated_parsed_result_reaches_data_operation_passes() {
    let source = r#"
import { ProjectInputSchema } from "@/server/validation";
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  const input = ProjectInputSchema.parse(body);
  await db.project.create({ data: input });
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "security_api_request_validation".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            methods: Vec::new(),
            input_sources: Vec::new(),
            sinks: Vec::new(),
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("security findings");

    assert!(
        findings.is_empty(),
        "validated parsed result should satisfy request validation: {findings:#?}"
    );
}

#[test]
fn unknown_validator_name_does_not_satisfy_request_validation() {
    let source = r#"
import { validateInput } from "@/server/validation";
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  const input = validateInput(body);
  await db.project.create({ data: input });
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "security_api_request_validation".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            methods: Vec::new(),
            input_sources: Vec::new(),
            sinks: Vec::new(),
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].actual_layer, "unknown_validator");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn candidate_only_validation_evidence_does_not_block() {
    let source = r#"
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_api_route_requires_request_validation(
        "app/api/projects/route.ts",
        source,
        &SecurityRequestValidationContract {
            contract_id: "candidate_request_validation".to_string(),
            capability: SecurityContractCapability::HeuristicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            methods: Vec::new(),
            input_sources: Vec::new(),
            sinks: Vec::new(),
            accepted_validators: vec![AcceptedRequestValidator {
                validator_id: "schema_project_input".to_string(),
                symbol: "ProjectInputSchema".to_string(),
                kind: RequestValidatorKind::Schema,
                behavior: RequestValidatorBehavior::ReturnsParsed,
            }],
        },
    )
    .expect("security findings");

    assert!(
        findings.is_empty(),
        "candidate-only validation evidence must not block: {findings:#?}"
    );
}

#[test]
fn throwing_validator_dominating_sink_allows_original_input_use() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  assertProjectInput(body);
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "assert_project_input".to_string(),
        symbol: "assertProjectInput".to_string(),
        kind: RequestValidatorKind::Helper,
        behavior: RequestValidatorBehavior::Throws,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(
        proof.request_validation.proven,
        "throwing validator before sink should prove original input"
    );
}

#[test]
fn returns_parsed_validator_does_not_allow_raw_input_use() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  validateProjectInput(body);
  await db.project.create({ data: body });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "validate_project_input".to_string(),
        symbol: "validateProjectInput".to_string(),
        kind: RequestValidatorKind::Helper,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(
        !proof.request_validation.proven,
        "returns-parsed validator must not bless raw input"
    );
}

#[test]
fn auth_like_helper_without_accepted_contract_does_not_block() {
    let source = r#"
import { auth } from "@/server/auth";
import { db } from "@/server/db";

export async function GET() {
  await auth();
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let findings = evaluate_api_route_requires_auth_helper(
        "app/api/projects/route.ts",
        source,
        &SecurityAuthContract {
            contract_id: "security_api_auth_require_user".to_string(),
            enforcement_mode: SecurityEnforcementMode::Block,
            accepted_auth_helpers: Vec::new(),
        },
    )
    .expect("security findings");

    assert!(
        findings.is_empty(),
        "auth-looking names without accepted contract must not block: {findings:#?}"
    );
}

#[test]
fn middleware_path_mismatch_blocks_covered_route_contract() {
    let middleware_source = r#"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
"#;
    let route_source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let findings = evaluate_middleware_must_cover_routes(
        "middleware.ts",
        middleware_source,
        "app/api/projects/route.ts",
        route_source,
        &SecurityMiddlewareContract {
            contract_id: "security_middleware_api_coverage".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            route_paths: vec!["/api/projects".to_string()],
            methods: Vec::new(),
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsUser,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].contract_id, "security_middleware_api_coverage");
    assert_eq!(
        findings[0].title,
        "Middleware does not cover required route"
    );
    assert_eq!(findings[0].actual_layer, "path_not_matched");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
    assert_eq!(findings[0].drift_category, "missing_proof");
}

#[test]
fn route_paths_contract_selects_grouped_next_api_route_by_normalized_path() {
    let middleware_source = r#"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
"#;
    let route_source = r#"
export async function GET() {
  return Response.json({ ok: true });
}
"#;

    let findings = evaluate_middleware_must_cover_routes(
        "middleware.ts",
        middleware_source,
        "app/(admin)/api/projects/route.ts",
        route_source,
        &SecurityMiddlewareContract {
            contract_id: "security_middleware_api_coverage".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            route_paths: vec!["/api/projects".to_string()],
            methods: Vec::new(),
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsUser,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(
        findings.len(),
        1,
        "grouped route must be selected by normalized route path: {findings:#?}"
    );
    assert_eq!(findings[0].actual_layer, "path_not_matched");
}

#[test]
fn middleware_method_mismatch_blocks_when_contract_requires_method() {
    let middleware_source = r##"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/projects/:path*#POST"],
};
"##;
    let route_source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let findings = evaluate_middleware_must_cover_routes(
        "middleware.ts",
        middleware_source,
        "app/api/projects/route.ts",
        route_source,
        &SecurityMiddlewareContract {
            contract_id: "security_middleware_api_coverage".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            route_paths: vec!["/api/projects".to_string()],
            methods: vec!["GET".to_string()],
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsUser,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].actual_layer, "method_not_matched");
    assert_eq!(findings[0].enforcement_result, SecurityFindingResult::Block);
}

#[test]
fn middleware_excludes_matched_route_blocks() {
    let middleware_source = r#"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "!/api/projects/:path*"],
};
"#;
    let route_source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let findings = evaluate_middleware_must_cover_routes(
        "middleware.ts",
        middleware_source,
        "app/api/projects/route.ts",
        route_source,
        &SecurityMiddlewareContract {
            contract_id: "security_middleware_api_coverage".to_string(),
            capability: SecurityContractCapability::DeterministicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            route_paths: vec!["/api/projects".to_string()],
            methods: vec!["GET".to_string()],
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsUser,
            }],
        },
    )
    .expect("security findings");

    assert_eq!(findings.len(), 1, "expected one finding: {findings:#?}");
    assert_eq!(findings[0].actual_layer, "path_not_matched");
    assert_eq!(findings[0].drift_category, "missing_proof");
}

#[test]
fn auth_contract_accepts_static_middleware_proof_but_not_middleware_existence() {
    let covered_middleware_source = r#"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/projects/:path*"],
};
"#;
    let middleware_without_matcher_source = r#"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}
"#;
    let route_source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;
    let contract = SecurityAuthContract {
        contract_id: "security_api_auth_require_user".to_string(),
        enforcement_mode: SecurityEnforcementMode::Block,
        accepted_auth_helpers: vec![AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    };

    let covered_findings = evaluate_api_route_requires_auth_helper_with_middleware(
        "app/api/projects/route.ts",
        route_source,
        "middleware.ts",
        covered_middleware_source,
        &contract,
    )
    .expect("covered security findings");
    assert!(
        covered_findings.is_empty(),
        "deterministic middleware proof should satisfy auth: {covered_findings:#?}"
    );

    let existence_only_findings = evaluate_api_route_requires_auth_helper_with_middleware(
        "app/api/projects/route.ts",
        route_source,
        "middleware.ts",
        middleware_without_matcher_source,
        &contract,
    )
    .expect("existence-only security findings");
    assert_eq!(
        existence_only_findings.len(),
        1,
        "middleware existence alone must not satisfy auth: {existence_only_findings:#?}"
    );
    assert_eq!(
        existence_only_findings[0].actual_layer,
        "missing_auth_guard"
    );
    assert_eq!(
        existence_only_findings[0].enforcement_result,
        SecurityFindingResult::Block
    );
}

#[test]
fn candidate_only_middleware_evidence_does_not_block() {
    let middleware_source = r#"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
"#;
    let route_source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let findings = evaluate_middleware_must_cover_routes(
        "middleware.ts",
        middleware_source,
        "app/api/projects/route.ts",
        route_source,
        &SecurityMiddlewareContract {
            contract_id: "candidate_middleware_api_coverage".to_string(),
            capability: SecurityContractCapability::HeuristicCheck,
            enforcement_mode: SecurityEnforcementMode::Block,
            route_paths: vec!["/api/projects".to_string()],
            methods: vec!["GET".to_string()],
            accepted_auth_helpers: vec![AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsUser,
            }],
        },
    )
    .expect("security findings");

    assert!(
        findings.is_empty(),
        "candidate-only heuristic middleware evidence must not block: {findings:#?}"
    );
}
