use drift_engine::{
    AcceptedAuthHelper, AcceptedAuthorizationHelper, AcceptedPhase5Contract,
    AcceptedRequestValidator, AcceptedResponseSerializer, AcceptedSensitiveResponseField,
    AcceptedTenantHelper, AuthGuardBehavior, AuthorizationHelperBehavior, AuthorizationHelperKind,
    FactKind, Phase4SecurityPolicy, RequestValidatorBehavior, RequestValidatorKind,
    ResponseSerializerPolicy, extract_security_facts, extract_security_facts_with_phase5,
    extract_security_facts_with_policy, extract_security_facts_with_validation,
};

fn accepted_phase4_policy() -> Phase4SecurityPolicy {
    Phase4SecurityPolicy {
        accepted_auth_helpers: vec![AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsSession,
        }],
        authorization_helpers: vec![
            AcceptedAuthorizationHelper {
                guard_id: "authorization_require_role".to_string(),
                symbol: "requireRole".to_string(),
                import_source: None,
                kind: AuthorizationHelperKind::Role,
                behavior: AuthorizationHelperBehavior::Throws,
            },
            AcceptedAuthorizationHelper {
                guard_id: "authorization_can_access_project".to_string(),
                symbol: "canAccessProject".to_string(),
                import_source: None,
                kind: AuthorizationHelperKind::Policy,
                behavior: AuthorizationHelperBehavior::Boolean,
            },
        ],
        tenant_helpers: vec![AcceptedTenantHelper {
            helper_id: "tenant_scope_project".to_string(),
            symbol: "scopeProjectToTenant".to_string(),
            import_source: None,
            tenant_key: "tenantId".to_string(),
        }],
        tenant_keys: vec!["tenantId".to_string()],
        tenant_sources: vec![
            "session".to_string(),
            "path_param".to_string(),
            "query".to_string(),
            "body".to_string(),
        ],
        ..Phase4SecurityPolicy::default()
    }
}

#[test]
fn extracts_request_input_read_facts() {
    let source = r#"
export async function POST(request: Request, { params }: { params: { projectId: string } }) {
  const body = await request.json();
  const projectId = request.nextUrl.searchParams.get("projectId");
  const routeProjectId = params.projectId;
  return Response.json({ ok: true, body, projectId, routeProjectId });
}
"#;

    let facts =
        extract_security_facts("app/api/projects/route.ts", source, &[]).expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| format!("{:?}", fact.kind) == "RequestInputRead"
                && fact.name == "body"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"body\"")
                        && value.contains("\"variable\":\"body\"")
                        && value.contains("\"route_id\":\"route:app/api/projects/route.ts:POST\"")
                })
                && fact.start_line == 3),
        "missing body request input read fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| format!("{:?}", fact.kind) == "RequestInputRead"
                && fact.name == "projectId"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"query\"")
                        && value.contains("\"variable\":\"projectId\"")
                        && value.contains("\"key\":\"projectId\"")
                })
                && fact.start_line == 4),
        "missing query request input read fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| format!("{:?}", fact.kind) == "RequestInputRead"
                && fact.name == "routeProjectId"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"params\"")
                        && value.contains("\"variable\":\"routeProjectId\"")
                        && value.contains("\"key\":\"projectId\"")
                })
                && fact.start_line == 5),
        "missing params request input read fact: {facts:#?}"
    );
}

#[test]
fn classifies_outbound_request_url_sources_without_leaking_raw_urls() {
    let source = r#"
export async function POST(request: Request) {
  const body = await request.json();
  const target = request.nextUrl.searchParams.get("target");
  await fetch("https://api.example.test/static");
  await fetch(target);
  await fetch(request.nextUrl.searchParams.get("next"));
  await fetch(`${body.callbackUrl}/hook`);
}
"#;

    let facts =
        extract_security_facts("app/api/proxy/route.ts", source, &[]).expect("security facts");
    let outbound = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::OutboundRequestCalled)
        .collect::<Vec<_>>();

    assert!(
        outbound.iter().any(|fact| {
            fact.start_line == 5
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"url_source\":\"constant\"")
                        && !value.contains("https://api.example.test")
                })
        }),
        "missing constant outbound URL classification: {facts:#?}"
    );
    assert!(
        outbound.iter().any(|fact| {
            fact.start_line == 6
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"url_source\":\"request_input\"")
                        && value.contains("\"url_var\":\"target\"")
                })
        }),
        "missing request-input variable outbound URL classification: {facts:#?}"
    );
    assert!(
        outbound.iter().any(|fact| {
            fact.start_line == 7
                && fact
                    .value
                    .as_deref()
                    .is_some_and(|value| value.contains("\"url_source\":\"request_input\""))
        }),
        "missing inline request-input outbound URL classification: {facts:#?}"
    );
    assert!(
        outbound.iter().any(|fact| {
            fact.start_line == 8
                && fact
                    .value
                    .as_deref()
                    .is_some_and(|value| value.contains("\"url_source\":\"request_input\""))
        }),
        "missing template request-input outbound URL classification: {facts:#?}"
    );
}

#[test]
fn extracts_parse_request_body_as_request_input_read() {
    let source = r#"
import { parseRequestBody } from "@/lib/api/utils";

export const POST = withWorkspace(async ({ req }) => {
  const body = await parseRequestBody(req);
  return Response.json({ body });
});
"#;

    let facts =
        extract_security_facts("app/api/oauth/apps/route.ts", source, &[]).expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestInputRead
                && fact.name == "body"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"body\"")
                        && value.contains("\"variable\":\"body\"")
                        && value.contains("\"route_id\":\"route:app/api/oauth/apps/route.ts:POST\"")
                })
                && fact.start_line == 5),
        "missing parseRequestBody request input fact: {facts:#?}"
    );
}

#[test]
fn security_phase5_secret_read_ignores_unknown_public_config_unless_explicitly_accepted() {
    let source = r#"
export async function GET() {
  const publicName = config.publicName;
  return Response.json({ ok: true });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["config".to_string()],
        log_sinks: Vec::new(),
    };
    let facts = extract_security_facts_with_phase5(
        "app/api/config/route.ts",
        source,
        &[],
        &[],
        Some(&phase5),
    )
    .expect("facts");
    assert!(
        facts.iter().all(|fact| fact.kind != FactKind::SecretRead),
        "{facts:#?}"
    );
}

#[test]
fn security_phase5_secret_read_fact_name_does_not_leak_env_key_shaped_variable() {
    let source = r#"
export async function GET() {
  const API_KEY = process.env.API_KEY;
  return Response.json({ ok: true });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec!["env".to_string()],
        log_sinks: Vec::new(),
    };
    let facts = extract_security_facts_with_phase5(
        "app/api/config/route.ts",
        source,
        &[],
        &[],
        Some(&phase5),
    )
    .expect("facts");
    let serialized = format!("{facts:#?}");
    assert!(!serialized.contains("API_KEY"), "{serialized}");
}

#[test]
fn security_phase5_sensitive_field_facts_from_contract_schema_and_candidates() {
    let source = r#"
const UserSchema = z.object({
  email: z.string().meta({ driftSensitive: "pii" }),
  password: z.string(),
});

export async function GET() {
  const user = { email: "SECRET_VALUE_SHOULD_NOT_LEAK", password: "sk_live_should_not_leak" };
  return Response.json({ ok: true });
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

    let facts = extract_security_facts_with_phase5(
        "app/api/users/route.ts",
        source,
        &[],
        &[],
        Some(&phase5),
    )
    .expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::SensitiveFieldDeclared
                && fact.name == "user.email"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"field_path\":\"user.email\"")
                        && value.contains("\"classification\":\"pii\"")
                        && value.contains("\"source\":\"contract\"")
                })),
        "missing contract sensitive field fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::SensitiveFieldDeclared
                && fact.name == "email"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"field_path\":\"email\"")
                        && value.contains("\"classification\":\"pii\"")
                        && value.contains("\"source\":\"schema\"")
                })),
        "missing schema sensitive field fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::SensitiveFieldDeclared
                && fact.name == "password"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"field_path\":\"password\"")
                        && value.contains("\"classification\":\"credential\"")
                        && value.contains("\"source\":\"candidate\"")
                })),
        "missing candidate sensitive field fact: {facts:#?}"
    );

    let serialized = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SensitiveFieldDeclared)
        .filter_map(|fact| fact.value.as_deref())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!serialized.contains("SECRET_VALUE_SHOULD_NOT_LEAK"));
    assert!(!serialized.contains("sk_live_should_not_leak"));
}

#[test]
fn extracts_request_validation_called_for_accepted_schema_and_helper() {
    let source = r#"
import { ProjectInputSchema } from "@/server/validation";
import { validateProjectInput as validateInput } from "@/server/validation";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = ProjectInputSchema.parse(body);
  const safe = ProjectInputSchema.safeParse(body);
  const checked = validateProjectInput(body);
  const aliased = validateInput(body);
  return Response.json({ parsed, safe, checked, aliased });
}
"#;

    let validators = vec![
        AcceptedRequestValidator {
            validator_id: "schema_project_input".to_string(),
            symbol: "ProjectInputSchema".to_string(),
            kind: RequestValidatorKind::Schema,
            behavior: RequestValidatorBehavior::ReturnsParsed,
        },
        AcceptedRequestValidator {
            validator_id: "helper_project_input".to_string(),
            symbol: "validateProjectInput".to_string(),
            kind: RequestValidatorKind::Helper,
            behavior: RequestValidatorBehavior::ReturnsParsed,
        },
    ];
    let facts = extract_security_facts_with_validation(
        "app/api/projects/route.ts",
        source,
        &[],
        &validators,
    )
    .expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestValidationCalled
                && fact.name == "parse"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"schema_symbol\":\"ProjectInputSchema\"")
                        && value.contains("\"input_var\":\"body\"")
                        && value.contains("\"result_var\":\"parsed\"")
                })
                && fact.start_line == 7),
        "missing accepted schema parse validation fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestValidationCalled
                && fact.name == "safeParse"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"schema_symbol\":\"ProjectInputSchema\"")
                        && value.contains("\"input_var\":\"body\"")
                        && value.contains("\"result_var\":\"safe\"")
                })
                && fact.start_line == 8),
        "missing accepted schema safeParse validation fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestValidationCalled
                && fact.name == "validateProjectInput"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"validator_symbol\":\"validateProjectInput\"")
                        && value.contains("\"input_var\":\"body\"")
                        && value.contains("\"result_var\":\"checked\"")
                })
                && fact.start_line == 9),
        "missing accepted helper validation fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestValidationCalled
                && fact.name == "validateInput"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"validator_symbol\":\"validateProjectInput\"")
                        && value.contains("\"input_var\":\"body\"")
                        && value.contains("\"result_var\":\"aliased\"")
                })
                && fact.start_line == 10),
        "missing accepted helper alias validation fact: {facts:#?}"
    );
}

#[test]
fn extracts_schema_parse_async_for_parse_request_body() {
    let source = r#"
import { parseRequestBody } from "@/lib/api/utils";
import { createOAuthAppSchema } from "@/lib/zod/schemas/oauth";

export const POST = withWorkspace(async ({ req }) => {
  const input = await createOAuthAppSchema.parseAsync(await parseRequestBody(req));
  return Response.json({ input });
});
"#;

    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_create_oauth_app".to_string(),
        symbol: "createOAuthAppSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let facts = extract_security_facts_with_validation(
        "app/api/oauth/apps/route.ts",
        source,
        &[],
        &validators,
    )
    .expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestInputRead
                && fact.name == "input"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"body\"")
                        && value.contains("\"variable\":\"input\"")
                })),
        "missing inline parseRequestBody input fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestValidationCalled
                && fact.name == "parseAsync"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"schema_symbol\":\"createOAuthAppSchema\"")
                        && value.contains("\"input_var\":\"input\"")
                        && value.contains("\"result_var\":\"input\"")
                })
                && fact.start_line == 6),
        "missing parseAsync request validation fact: {facts:#?}"
    );
}

#[test]
fn extracts_multiline_destructured_schema_parse_async_for_parse_request_body() {
    let source = r#"
import { parseRequestBody } from "@/lib/api/utils";
import { createOAuthAppSchema } from "@/lib/zod/schemas/oauth";

export const POST = withWorkspace(async ({ req }) => {
  const {
    name,
    slug,
  } = await createOAuthAppSchema.parseAsync(await parseRequestBody(req));
  await prisma.integration.create({ data: { name, slug } });
  return Response.json({ name, slug });
});
"#;

    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_create_oauth_app".to_string(),
        symbol: "createOAuthAppSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let facts = extract_security_facts_with_validation(
        "app/api/oauth/apps/route.ts",
        source,
        &[],
        &validators,
    )
    .expect("security facts");

    for field in ["name", "slug"] {
        assert!(
            facts
                .iter()
                .any(|fact| fact.kind == FactKind::RequestInputRead
                    && fact.name == field
                    && fact.value.as_deref().is_some_and(|value| {
                        value.contains("\"source\":\"body\"")
                            && value.contains(&format!("\"variable\":\"{field}\""))
                    })),
            "missing destructured parseRequestBody input fact for {field}: {facts:#?}"
        );
        assert!(
            facts
                .iter()
                .any(|fact| fact.kind == FactKind::RequestValidationCalled
                    && fact.name == "parseAsync"
                    && fact.value.as_deref().is_some_and(|value| {
                        value.contains("\"schema_symbol\":\"createOAuthAppSchema\"")
                            && value.contains(&format!("\"input_var\":\"{field}\""))
                            && value.contains(&format!("\"result_var\":\"{field}\""))
                    })
                    && fact.start_line == 9),
            "missing destructured parseAsync request validation fact for {field}: {facts:#?}"
        );
        assert!(
            facts
                .iter()
                .any(|fact| fact.kind == FactKind::ValidatedInputUsed
                    && fact.name == field
                    && fact.value.as_deref().is_some_and(|value| {
                        value.contains(&format!("\"source_input_var\":\"{field}\""))
                            && value.contains(&format!("\"validated_var\":\"{field}\""))
                    })),
            "missing destructured validated use fact for {field}: {facts:#?}"
        );
    }
}

#[test]
fn extracts_request_validation_called_for_namespace_imported_schema() {
    let source = r#"
import * as validation from "@/server/validation";
export async function POST(request: Request) {
  const body = await request.json();
  const input = validation.ProjectInputSchema.parse(body);
  return Response.json(input);
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let facts = extract_security_facts_with_validation(
        "app/api/projects/route.ts",
        source,
        &[],
        &validators,
    )
    .expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::RequestValidationCalled),
        "missing namespace-imported schema validation fact: {facts:#?}"
    );
}

#[test]
fn extracts_destructured_params_as_request_input_read() {
    let source = r#"
export async function GET(_request: Request, { params }: { params: { projectId: string } }) {
  const { projectId } = params;
  return Response.json({ projectId });
}
"#;
    let facts =
        extract_security_facts("app/api/projects/route.ts", source, &[]).expect("security facts");

    assert!(
        facts.iter().any(|fact| {
            fact.kind == FactKind::RequestInputRead
                && fact.name == "projectId"
                && fact
                    .value
                    .as_deref()
                    .is_some_and(|value| value.contains("\"source\":\"params\""))
        }),
        "missing destructured params request input read: {facts:#?}"
    );
}

#[test]
fn extracts_validated_input_used_when_parsed_result_reaches_sink() {
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

    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let facts = extract_security_facts_with_validation(
        "app/api/projects/route.ts",
        source,
        &[],
        &validators,
    )
    .expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| format!("{:?}", fact.kind) == "ValidatedInputUsed"
                && fact.name == "input"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source_input_var\":\"body\"")
                        && value.contains("\"validated_var\":\"input\"")
                        && value.contains("\"sink_kind\":\"data_operation\"")
                })
                && fact.start_line == 8),
        "missing validated input use fact: {facts:#?}"
    );
}

#[test]
fn extracts_auth_guard_called_fact() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET() {
  const user = await requireUser();
  const projects = await db.project.findMany({ where: { ownerId: user.id } });
  return Response.json({ projects });
}
"#;

    let facts = extract_security_facts(
        "app/api/projects/route.ts",
        source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::AuthGuardCalled
                && fact.name == "requireUser"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"guard_id\":\"auth_require_user\"")
                        && value.contains("\"route_id\":\"route:app/api/projects/route.ts:GET\"")
                        && value.contains("\"behavior\":\"returns_user\"")
                })
                && fact.start_line == 6
                && fact.end_line == 6),
        "missing accepted auth call fact: {facts:#?}"
    );
}

#[test]
fn extracts_session_read_facts_from_trusted_and_untrusted_sources() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";

export async function POST(request: Request) {
  const session = await requireUser(request);
  const nextAuthSession = await getServerSession(authOptions);
  const user = request.headers.get("x-user");
  const bodySession = await request.json();
  const token = request.cookies.get("session");
  return Response.json({ ok: true });
}
"#;

    let facts = extract_security_facts(
        "app/api/projects/route.ts",
        source,
        &[
            AcceptedAuthHelper {
                guard_id: "auth_require_user".to_string(),
                symbol: "requireUser".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            },
            AcceptedAuthHelper {
                guard_id: "auth_next_session".to_string(),
                symbol: "getServerSession".to_string(),
                behavior: AuthGuardBehavior::ReturnsSession,
            },
        ],
    )
    .expect("security facts");

    let session_reads = facts
        .iter()
        .filter(|fact| format!("{:?}", fact.kind) == "SessionRead")
        .collect::<Vec<_>>();
    assert_eq!(
        session_reads.len(),
        5,
        "expected five sanitized session_read facts: {facts:#?}"
    );
    assert!(
        session_reads.iter().any(|fact| {
            fact.name == "session"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"auth_result\"")
                        && value.contains("\"trust\":\"unknown\"")
                        && value.contains("\"variable\":\"session\"")
                })
        }),
        "missing accepted requireUser session read fact: {facts:#?}"
    );
    assert!(
        session_reads.iter().any(|fact| {
            fact.name == "nextAuthSession"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"auth_result\"")
                        && value.contains("\"trust\":\"unknown\"")
                        && value.contains("\"variable\":\"nextAuthSession\"")
                })
        }),
        "missing accepted getServerSession read fact: {facts:#?}"
    );
    for variable in ["user", "bodySession", "token"] {
        assert!(
            session_reads.iter().any(|fact| {
                fact.name == variable
                    && fact
                        .value
                        .as_deref()
                        .is_some_and(|value| value.contains("\"trust\":\"untrusted\""))
            }),
            "missing untrusted session read fact for {variable}: {facts:#?}"
        );
    }
    for fact in session_reads {
        let value = fact.value.as_deref().unwrap_or_default();
        for forbidden in ["x-user", "tenant-123", "user-123", "payload-secret"] {
            assert!(
                !value.contains(forbidden),
                "session read fact leaked sensitive/source value {forbidden}: {fact:#?}"
            );
        }
    }
}

#[test]
fn extracts_tenant_sources_from_session_params_and_query() {
    let source = r#"
import { requireUser } from "@/server/auth";

export async function GET(request: Request, { params }: { params: { tenantId: string } }) {
  const session = await requireUser(request);
  const sessionTenant = session.user.tenantId;
  const tenantId = params.tenantId;
  const queryTenant = request.nextUrl.searchParams.get("tenantId");
  const { tenantId: destructuredTenantId } = params;
  const body = await request.json();
  const bodyTenant = body.tenantId;
  return Response.json({ sessionTenant, tenantId, queryTenant, destructuredTenantId, bodyTenant });
}
"#;

    let facts = extract_security_facts_with_policy(
        "app/api/projects/route.ts",
        source,
        &accepted_phase4_policy(),
        &[],
    )
    .expect("security facts");

    let tenant_sources = facts
        .iter()
        .filter(|fact| format!("{:?}", fact.kind) == "TenantSource")
        .collect::<Vec<_>>();
    assert!(
        tenant_sources.iter().any(|fact| {
            fact.name == "sessionTenant"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"session\"")
                        && value.contains("\"trusted\":true")
                        && value.contains("\"tenant_key\":\"tenantId\"")
                        && value.contains("\"session_variable\":\"session\"")
                })
        }),
        "missing trusted session tenant source: {facts:#?}"
    );
    assert!(
        tenant_sources.iter().any(|fact| {
            fact.name == "tenantId"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"path_param\"")
                        && value.contains("\"trusted\":false")
                        && value.contains("\"tenant_key\":\"tenantId\"")
                })
        }),
        "missing path param tenant source: {facts:#?}"
    );
    assert!(
        tenant_sources.iter().any(|fact| {
            fact.name == "queryTenant"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"query\"")
                        && value.contains("\"trusted\":false")
                        && value.contains("\"tenant_key\":\"tenantId\"")
                })
        }),
        "missing query tenant source: {facts:#?}"
    );
    assert!(
        tenant_sources.iter().any(|fact| {
            fact.name == "bodyTenant"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source\":\"body\"")
                        && value.contains("\"trusted\":false")
                        && value.contains("\"tenant_key\":\"tenantId\"")
                })
        }),
        "missing body tenant source: {facts:#?}"
    );
    assert!(
        tenant_sources
            .iter()
            .any(|fact| fact.name == "destructuredTenantId")
            || facts.iter().any(|fact| {
                format!("{:?}", fact.kind) == "ParserGap"
                    && fact.value.as_deref().is_some_and(|value| {
                        value.contains("unsupported_tenant_source_destructure")
                    })
            }),
        "destructured path tenant source must be extracted or parser-gapped: {facts:#?}"
    );
}

#[test]
fn extracts_tenant_predicates_and_accepted_tenant_helpers() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { scopeProjectToTenant, unknownTenantScope } from "@/server/tenant";

export async function GET(request: Request, { params }: { params: { projectId: string } }) {
  const session = await requireUser(request);
  await db.project.findMany({ where: { tenantId: session.user.tenantId } });
  await db.project.findUnique({ where: { id: params.projectId, tenantId: session.user.tenantId } });
  await scopeProjectToTenant(db.project, session.user.tenantId).findMany();
  await unknownTenantScope(db.project, session.user.tenantId).findMany();
  return Response.json({});
}
"#;

    let facts = extract_security_facts_with_policy(
        "app/api/projects/route.ts",
        source,
        &accepted_phase4_policy(),
        &[],
    )
    .expect("security facts");

    let tenant_guards = facts
        .iter()
        .filter(|fact| format!("{:?}", fact.kind) == "TenantGuardCalled")
        .collect::<Vec<_>>();
    assert!(
        tenant_guards.iter().any(|fact| {
            fact.value.as_deref().is_some_and(|value| {
                value.contains("\"predicate_kind\":\"equality\"")
                    && value.contains("\"tenant_key\":\"tenantId\"")
                    && value.contains("\"data_operation\":\"db.project.findMany\"")
            })
        }),
        "missing equality tenant guard for findMany: {facts:#?}"
    );
    assert!(
        tenant_guards.iter().any(|fact| {
            fact.value.as_deref().is_some_and(|value| {
                value.contains("\"predicate_kind\":\"equality\"")
                    && value.contains("\"data_operation\":\"db.project.findUnique\"")
            })
        }),
        "missing equality tenant guard for findUnique: {facts:#?}"
    );
    assert!(
        tenant_guards.iter().any(|fact| {
            fact.name == "scopeProjectToTenant"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"predicate_kind\":\"scoped_helper\"")
                        && value.contains("\"helper_symbol\":\"scopeProjectToTenant\"")
                })
        }),
        "missing accepted scoped helper tenant guard: {facts:#?}"
    );
    assert!(
        !tenant_guards
            .iter()
            .any(|fact| fact.name == "unknownTenantScope"),
        "unknown tenant helper must not emit accepted tenant guard: {facts:#?}"
    );
}

#[test]
fn extracts_authorization_guard_called_for_accepted_role_and_policy_helpers() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { requireRole, canAccessProject } from "@/server/authorization";

export async function GET(request: Request, { params }: { params: { projectId: string } }) {
  const session = await requireUser(request);
  requireRole(session.user, "admin");
  await db.project.findMany();
  if (!canAccessProject(session.user, params.projectId, "project:read")) {
    return new Response("forbidden", { status: 403 });
  }
  await db.project.findUnique({ where: { id: params.projectId } });
  if (session.user.role === "admin") {
    await db.project.findFirst();
  }
  return Response.json({});
}
"#;

    let facts = extract_security_facts_with_policy(
        "app/api/projects/route.ts",
        source,
        &accepted_phase4_policy(),
        &[],
    )
    .expect("security facts");

    let authorization_guards = facts
        .iter()
        .filter(|fact| format!("{:?}", fact.kind) == "AuthorizationGuardCalled")
        .collect::<Vec<_>>();
    assert!(
        authorization_guards.iter().any(|fact| {
            fact.name == "requireRole"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"guard_kind\":\"role\"")
                        && value.contains("\"subject_var\":\"session.user\"")
                        && value.contains("\"roles\":[\"admin\"]")
                })
        }),
        "missing accepted role authorization guard: {facts:#?}"
    );
    assert!(
        authorization_guards.iter().any(|fact| {
            fact.name == "canAccessProject"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"guard_kind\":\"policy\"")
                        && value.contains("\"subject_var\":\"session.user\"")
                        && value.contains("\"resource_var\":\"params.projectId\"")
                        && value.contains("\"permissions\":[\"project:read\"]")
                        && value.contains("\"dominates_sinks\":true")
                })
        }),
        "missing accepted boolean policy authorization guard: {facts:#?}"
    );
    assert!(
        !authorization_guards
            .iter()
            .any(|fact| fact.value.as_deref().is_some_and(|value| {
                value.contains("inline_role_check")
                    || value.contains("\"roles\":[\"admin\"]") && fact.name != "requireRole"
            })),
        "inline role comparison must not emit accepted authorization proof: {facts:#?}"
    );
}

#[test]
fn extracts_authorization_from_wrapper_required_permissions_and_roles() {
    let source = r#"
import { withWorkspace } from "@/lib/auth";
import { db } from "@/server/db";

export const POST = withWorkspace(
  async ({ session }) => {
    await db.project.create({ data: { name: "x" } });
    return Response.json({});
  },
  {
    requiredPermissions: ["oauth_apps.write", "project:create"],
    requiredRoles: ["owner"]
  }
);
"#;
    let mut policy = accepted_phase4_policy();
    policy
        .authorization_helpers
        .push(AcceptedAuthorizationHelper {
            guard_id: "authorization_with_workspace".to_string(),
            symbol: "withWorkspace".to_string(),
            import_source: Some("@/lib/auth".to_string()),
            kind: AuthorizationHelperKind::Policy,
            behavior: AuthorizationHelperBehavior::Throws,
        });

    let facts =
        extract_security_facts_with_policy("app/api/oauth/apps/route.ts", source, &policy, &[])
            .expect("security facts");

    assert!(
        facts.iter().any(|fact| {
            fact.kind == FactKind::AuthorizationGuardCalled
                && fact.name == "withWorkspace"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"guard_id\":\"authorization_with_workspace\"")
                        && value
                            .contains("\"permissions\":[\"oauth_apps.write\",\"project:create\"]")
                        && value.contains("\"roles\":[\"owner\"]")
                })
        }),
        "missing wrapper authorization guard fact: {facts:#?}"
    );
}

#[test]
fn extracts_route_returns_response_fact() {
    let next_response_source = r#"
import { NextResponse } from "next/server";

export async function GET() {
  return Response.json({ ok: true });
}

export async function POST() {
  return NextResponse.json({ ok: true }, { status: 201 });
}
"#;
    let pages_response_source = r#"
export default async function handler(req, res) {
  return res.json({ ok: true });
}
"#;

    let next_facts = extract_security_facts("app/api/projects/route.ts", next_response_source, &[])
        .expect("next route security facts");
    let pages_facts = extract_security_facts("pages/api/projects.ts", pages_response_source, &[])
        .expect("pages route security facts");

    assert!(
        next_facts
            .iter()
            .any(|fact| fact.kind == FactKind::RouteReturnsResponse
                && fact.name == "json"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"response_kind\":\"json\"")
                        && value.contains("\"route_id\":\"route:app/api/projects/route.ts:GET\"")
                })
                && fact.start_line == 5),
        "missing Response.json sink: {next_facts:#?}"
    );
    assert!(
        next_facts
            .iter()
            .any(|fact| fact.kind == FactKind::RouteReturnsResponse
                && fact.name == "json"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"response_kind\":\"json\"")
                        && value.contains("\"route_id\":\"route:app/api/projects/route.ts:POST\"")
                })
                && fact.start_line == 9),
        "missing NextResponse.json sink: {next_facts:#?}"
    );
    assert!(
        pages_facts
            .iter()
            .any(|fact| fact.kind == FactKind::RouteReturnsResponse
                && fact.name == "json"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"response_kind\":\"json\"")
                        && value.contains("\"route_id\":\"route:pages/api/projects.ts:default\"")
                })
                && fact.start_line == 3),
        "missing res.json sink: {pages_facts:#?}"
    );
}

#[test]
fn security_phase5_response_shape_facts_for_static_json_shapes() {
    let source = r#"
import { NextResponse } from "next/server";

export async function GET() {
  const email = "redacted@example.test";
  return Response.json({ user: { email } });
}

export async function POST() {
  const token = "redacted";
  return NextResponse.json({ token });
}

export default async function handler(req, res) {
  const user = { id: "u1" };
  return res.json({ user });
}

export async function PUT() {
  const email = "redacted@example.test";
  const payload = { user: { email } };
  return Response.json(payload);
}

export async function PATCH() {
  const user = { email: "redacted@example.test" };
  return Response.json({ ...user });
}
"#;
    let facts =
        extract_security_facts("app/api/users/route.ts", source, &[]).expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ResponseEmitsField
                && fact.name == "user.email"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"field_path\":\"user.email\"")
                        && value.contains("\"response_kind\":\"json\"")
                        && value.contains("\"classification\":\"unknown\"")
                })),
        "missing nested Response.json field: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ResponseEmitsField
                && fact.name == "token"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"field_path\":\"token\"")
                        && value.contains("\"route_id\":\"route:app/api/users/route.ts:POST\"")
                })),
        "missing NextResponse.json field: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ResponseEmitsField
                && fact.name == "user"
                && fact
                    .value
                    .as_deref()
                    .is_some_and(|value| { value.contains("\"field_path\":\"user\"") })),
        "missing res.json field: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::ResponseEmitsField
                && fact.name == "user.email"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"source_var\":\"payload\"")
                        && value.contains("\"route_id\":\"route:app/api/users/route.ts:PUT\"")
                })),
        "missing response variable field: {facts:#?}"
    );
    assert!(
        !facts
            .iter()
            .any(|fact| fact.kind == FactKind::ResponseEmitsField && fact.start_line == 26),
        "object spread must not emit known-safe response fields: {facts:#?}"
    );
}

#[test]
fn security_phase5_serializer_facts_require_accepted_import_identity() {
    let source = r#"
import { serializePublicUser as publicUser } from "@/lib/serializers/user";
import { serializePublicUser as unsafePublicUser } from "@/lib/unsafe-serializers";

export async function GET() {
  const user = { email: "redacted@example.test" };
  const serialized = publicUser(user);
  const unsafeSerialized = unsafePublicUser(user);
  const localSerialized = serializePublicUser(user);
  return Response.json({ serialized, unsafeSerialized, localSerialized });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: vec![AcceptedResponseSerializer {
            serializer_id: "serializePublicUser".to_string(),
            import_source: "@/lib/serializers/user".to_string(),
            imported_name: "serializePublicUser".to_string(),
            local_name: Some("publicUser".to_string()),
            policy: ResponseSerializerPolicy::Denylist,
            filtered_fields: vec!["user.email".to_string()],
        }],
        secret_sources: Vec::new(),
        log_sinks: Vec::new(),
    };
    let facts = extract_security_facts_with_phase5(
        "app/api/users/route.ts",
        source,
        &[],
        &[],
        Some(&phase5),
    )
    .expect("security facts");

    let serializer_facts = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SerializerCalled)
        .collect::<Vec<_>>();
    assert_eq!(
        serializer_facts.len(),
        1,
        "only the accepted import alias should produce serializer_called: {facts:#?}"
    );
    let fact = serializer_facts[0];
    assert_eq!(fact.name, "publicUser");
    assert!(
        fact.value.as_deref().is_some_and(|value| {
            value.contains("\"serializer_id\":\"serializePublicUser\"")
                && value.contains("\"input_var\":\"user\"")
                && value.contains("\"output_var\":\"serialized\"")
                && value.contains("\"policy\":\"denylist\"")
                && value.contains("\"filtered_fields\":[\"user.email\"]")
        }),
        "serializer fact did not preserve policy and filtered fields: {fact:#?}"
    );
}

#[test]
fn security_phase5_secret_read_facts_are_redacted() {
    let source = r#"
const config = { password: "SECRET_VALUE_SHOULD_NOT_LEAK" };
const secretManager = { get: (key: string) => key };

export async function GET() {
  const apiKey = process.env.API_KEY;
  const token = process.env["TOKEN"];
  const password = config.password;
  const privateKey = secretManager.get("PRIVATE_KEY");
  return Response.json({ ok: true });
}
"#;
    let phase5 = AcceptedPhase5Contract {
        sensitive_response_fields: Vec::new(),
        response_serializers: Vec::new(),
        secret_sources: vec![
            "env".to_string(),
            "config".to_string(),
            "secret_manager".to_string(),
        ],
        log_sinks: Vec::new(),
    };
    let facts = extract_security_facts_with_phase5(
        "app/api/secrets/route.ts",
        source,
        &[],
        &[],
        Some(&phase5),
    )
    .expect("security facts");
    let secret_facts = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::SecretRead)
        .collect::<Vec<_>>();

    assert_eq!(
        secret_facts.len(),
        4,
        "missing secret_read facts: {facts:#?}"
    );
    let serialized = secret_facts
        .iter()
        .filter_map(|fact| fact.value.as_deref())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(serialized.contains("\"source\":\"env\""));
    assert!(serialized.contains("\"source\":\"config\""));
    assert!(serialized.contains("\"source\":\"secret_manager\""));
    assert!(serialized.contains("\"secret_class\":\"api_key\""));
    assert!(serialized.contains("\"secret_class\":\"token\""));
    assert!(serialized.contains("\"secret_class\":\"password\""));
    assert!(serialized.contains("\"secret_class\":\"private_key\""));
    assert!(serialized.contains("\"env_key_hash\""));
    assert!(!serialized.contains("API_KEY"));
    assert!(!serialized.contains("TOKEN"));
    assert!(!serialized.contains("PRIVATE_KEY"));
    assert!(!serialized.contains("SECRET_VALUE_SHOULD_NOT_LEAK"));
    assert!(!serialized.contains("sk_live_should_not_leak"));
}

#[test]
fn extracts_static_middleware_matcher_fact() {
    let source = r#"
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

    let facts = extract_security_facts(
        "middleware.ts",
        source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("security facts");

    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::MiddlewareDeclared
                && fact.name == "middleware"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"middleware_id\":\"middleware:middleware.ts\"")
                        && value.contains("\"protection_kind\":\"auth\"")
                })
                && fact.start_line == 5),
        "missing middleware declaration fact: {facts:#?}"
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == FactKind::MiddlewareMatcherDeclared
                && fact.name == "/api/projects/:path*"
                && fact.value.as_deref().is_some_and(|value| {
                    value.contains("\"middleware_id\":\"middleware:middleware.ts\"")
                        && value.contains("\"matcher_kind\":\"static_path\"")
                        && value.contains("\"path_pattern\":\"/api/projects/:path*\"")
                })
                && fact.start_line == 11),
        "missing static middleware matcher fact: {facts:#?}"
    );
}
