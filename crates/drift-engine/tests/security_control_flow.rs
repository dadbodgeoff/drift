use drift_engine::{
    AcceptedAuthHelper, AcceptedAuthorizationHelper, AcceptedRequestValidator, AuthGuardBehavior,
    AuthorizationHelperBehavior, AuthorizationHelperKind, FactKind, Phase4SecurityPolicy,
    RequestValidatorBehavior, RequestValidatorKind, SecurityProofStatus, build_auth_boundary_proof,
    build_middleware_coverage_proof, build_phase4_security_proof,
    build_phase4_security_proof_with_policy, build_request_validation_proof,
    extract_security_facts,
};

#[test]
fn auth_guard_before_all_sinks_passes() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET() {
  const user = await requireUser();
  const projects = await db.project.findMany({ where: { ownerId: user.id } });
  return Response.json({ projects });
}
"#;

    let proof = build_auth_boundary_proof(
        "app/api/projects/route.ts",
        source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("auth proof");

    assert!(proof.auth.required);
    assert!(proof.auth.proven, "proof should prove auth: {proof:#?}");
    assert_eq!(proof.auth.undominated_sinks, Vec::<String>::new());
    assert!(
        proof
            .auth
            .dominated_sinks
            .iter()
            .any(|sink| sink.sink_kind == "data_operation"),
        "missing dominated data sink: {proof:#?}"
    );
    assert!(
        proof
            .auth
            .dominated_sinks
            .iter()
            .any(|sink| sink.sink_kind == "response"),
        "missing dominated response sink: {proof:#?}"
    );
    assert_eq!(proof.result.proof_status, SecurityProofStatus::Proven);
}

#[test]
fn trusted_session_derives_only_from_accepted_auth_helper_or_middleware() {
    let trusted_source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  await db.project.findMany({ where: { tenantId: session.user.tenantId } });
  return Response.json({});
}
"#;
    let untrusted_source = r#"
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await request.json();
  await db.project.findMany({ where: { tenantId: session.user.tenantId } });
  return Response.json({});
}
"#;
    let helpers = [AcceptedAuthHelper {
        guard_id: "auth_require_user".to_string(),
        symbol: "requireUser".to_string(),
        behavior: AuthGuardBehavior::ReturnsSession,
    }];

    let trusted_proof =
        build_auth_boundary_proof("app/api/projects/route.ts", trusted_source, &helpers)
            .expect("trusted session proof");
    assert!(
        trusted_proof.session_trust.proven,
        "accepted auth helper should establish trusted session: {trusted_proof:#?}"
    );
    assert!(
        trusted_proof
            .session_trust
            .trusted_sessions
            .iter()
            .any(|session| session.variable == "session"
                && session.trust == "trusted"
                && session.derived_from == "auth_guard"),
        "missing trusted session boundary proof: {trusted_proof:#?}"
    );

    let untrusted_proof =
        build_auth_boundary_proof("app/api/projects/route.ts", untrusted_source, &helpers)
            .expect("untrusted session proof");
    assert!(
        !untrusted_proof.session_trust.proven,
        "request-derived session must not be trusted: {untrusted_proof:#?}"
    );
    assert!(
        untrusted_proof
            .session_trust
            .missing_trust
            .iter()
            .any(
                |missing| missing.variable == "session" && missing.reason == "derived_from_request"
            ),
        "missing derived_from_request trust failure: {untrusted_proof:#?}"
    );
}

#[test]
fn authorization_guard_after_sink_or_in_one_branch_does_not_dominate() {
    let guard_after_sink = r#"
import { requireUser } from "@/server/auth";
import { requireRole } from "@/server/authorization";
import { db } from "@/server/db";

export async function DELETE(request: Request) {
  const session = await requireUser(request);
  await db.project.delete({ where: { tenantId: session.user.tenantId } });
  requireRole(session.user, "admin");
  return Response.json({});
}
"#;
    let one_branch_guard = r#"
import { requireUser } from "@/server/auth";
import { requireRole } from "@/server/authorization";
import { db } from "@/server/db";

export async function DELETE(request: Request) {
  const session = await requireUser(request);
  if (new URL(request.url).searchParams.get("preview")) {
    requireRole(session.user, "admin");
  }
  await db.project.delete({ where: { tenantId: session.user.tenantId } });
  return Response.json({});
}
"#;
    let helpers = [AcceptedAuthHelper {
        guard_id: "auth_require_user".to_string(),
        symbol: "requireUser".to_string(),
        behavior: AuthGuardBehavior::ReturnsSession,
    }];

    for source in [guard_after_sink, one_branch_guard] {
        let proof = build_phase4_security_proof_with_policy(
            "app/api/projects/route.ts",
            source,
            &Phase4SecurityPolicy {
                accepted_auth_helpers: helpers.to_vec(),
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
            !proof.authorization.proven,
            "authorization must require guard dominance: {proof:#?}"
        );
        assert!(
            proof
                .authorization
                .missing
                .iter()
                .any(|missing| missing.reason == "authorization_guard_not_dominating_sink"),
            "missing dominance failure proof: {proof:#?}"
        );
    }
}

#[test]
fn tenant_authorization_dynamic_shapes_emit_parser_gaps() {
    let dynamic_property = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  const key = "tenantId";
  await db.project.findMany({ where: { [key]: session.user.tenantId } });
  return Response.json({});
}
"#;
    let query_object_alias = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  const args = { where: { tenantId: session.user.tenantId } };
  await db.project.findMany(args);
  return Response.json({});
}
"#;
    let nested_destructure = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  const session = await requireUser(request);
  const { user: { tenantId } } = session;
  await db.project.findMany({ where: { tenantId } });
  return Response.json({});
}
"#;
    let helpers = [AcceptedAuthHelper {
        guard_id: "auth_require_user".to_string(),
        symbol: "requireUser".to_string(),
        behavior: AuthGuardBehavior::ReturnsSession,
    }];

    let cases = [
        (dynamic_property, "unsupported_tenant_dynamic_property"),
        (query_object_alias, "unsupported_tenant_query_object_alias"),
        (nested_destructure, "unsupported_session_nested_destructure"),
    ];
    for (source, expected_code) in cases {
        let proof = build_phase4_security_proof("app/api/projects/route.ts", source, &helpers)
            .expect("phase4 proof");
        assert!(
            proof
                .parser_gaps
                .iter()
                .any(|gap| gap.code == expected_code && gap.blocks_enforcement),
            "missing parser gap {expected_code}: {proof:#?}"
        );
        assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
    }
}

#[test]
fn auth_after_data_operation_blocks() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  const user = await requireUser();
  return Response.json({ projects, user });
}
"#;

    let proof = build_auth_boundary_proof(
        "app/api/projects/route.ts",
        source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("auth proof");

    assert!(!proof.auth.proven, "auth should not be proven: {proof:#?}");
    assert!(
        proof
            .auth
            .undominated_sinks
            .contains(&"guard_after_sink".to_string()),
        "missing guard_after_sink reason: {proof:#?}"
    );
    assert_eq!(proof.result.proof_status, SecurityProofStatus::MissingProof);
}

#[test]
fn auth_in_one_branch_does_not_dominate_other_branch() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: Request) {
  if (request.headers.get("x-auth") === "yes") {
    await requireUser();
  } else {
    const projects = await db.project.findMany();
    return Response.json({ projects });
  }
  return Response.json({ ok: true });
}
"#;

    let proof = build_auth_boundary_proof(
        "app/api/projects/route.ts",
        source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("auth proof");

    assert!(!proof.auth.proven, "branch bypass should fail: {proof:#?}");
    assert!(
        proof
            .auth
            .undominated_sinks
            .contains(&"guard_only_in_one_branch".to_string()),
        "missing guard_only_in_one_branch reason: {proof:#?}"
    );
}

#[test]
fn callback_auth_does_not_dominate_outer_sink() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

export async function GET() {
  ["auth"].forEach(async () => {
    await requireUser();
  });
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let proof = build_auth_boundary_proof(
        "app/api/projects/route.ts",
        source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("auth proof");

    assert!(!proof.auth.proven, "callback guard should fail: {proof:#?}");
    assert!(
        proof
            .auth
            .undominated_sinks
            .contains(&"callback_boundary".to_string()),
        "missing callback_boundary reason: {proof:#?}"
    );

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
            .any(|fact| fact.kind == FactKind::CallbackBoundaryDetected),
        "missing callback boundary fact: {facts:#?}"
    );
}

#[test]
fn unsupported_dynamic_control_flow_emits_parser_gap_and_blocks() {
    let source = r#"
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";

const guards = { requireUser };

export async function GET(request: Request) {
  const guard = guards[request.headers.get("x-guard") as keyof typeof guards];
  await guard();
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let proof = build_auth_boundary_proof(
        "app/api/projects/route.ts",
        source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("auth proof");

    assert!(
        !proof.auth.proven,
        "dynamic control flow should fail: {proof:#?}"
    );
    assert!(
        proof
            .auth
            .undominated_sinks
            .contains(&"unsupported_dynamic_control_flow".to_string()),
        "missing unsupported_dynamic_control_flow reason: {proof:#?}"
    );
    assert!(
        proof
            .parser_gaps
            .iter()
            .any(|gap| gap.code == "unsupported_dynamic_control_flow" && gap.blocks_enforcement),
        "missing parser gap: {proof:#?}"
    );
    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
}

#[test]
fn static_middleware_matcher_protects_route() {
    let middleware_source = r#"
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
    let route_source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let proof = build_middleware_coverage_proof(
        "middleware.ts",
        middleware_source,
        "app/api/projects/route.ts",
        route_source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("middleware proof");

    assert!(proof.middleware.required);
    assert!(
        proof.middleware.proven,
        "static matcher should prove middleware coverage: {proof:#?}"
    );
    assert_eq!(proof.result.proof_status, SecurityProofStatus::Proven);
    assert!(
        proof
            .middleware
            .matched_middleware
            .iter()
            .any(|middleware| middleware.protection_kind == "auth"
                && middleware
                    .protects_route_edge_id
                    .contains("middleware-protects")),
        "missing matched middleware proof: {proof:#?}"
    );
}

#[test]
fn dynamic_middleware_matcher_emits_parser_gap_and_blocks() {
    let middleware_source = r#"
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";

const protectedPaths = ["/api/projects/:path*"];

export async function middleware(request: Request) {
  await requireUser();
  return NextResponse.next();
}

export const config = {
  matcher: protectedPaths,
};
"#;
    let route_source = r#"
import { db } from "@/server/db";

export async function GET() {
  const projects = await db.project.findMany();
  return Response.json({ projects });
}
"#;

    let proof = build_middleware_coverage_proof(
        "middleware.ts",
        middleware_source,
        "app/api/projects/route.ts",
        route_source,
        &[AcceptedAuthHelper {
            guard_id: "auth_require_user".to_string(),
            symbol: "requireUser".to_string(),
            behavior: AuthGuardBehavior::ReturnsUser,
        }],
    )
    .expect("middleware proof");

    assert!(
        !proof.middleware.proven,
        "dynamic matcher should not prove coverage: {proof:#?}"
    );
    assert!(
        proof
            .parser_gaps
            .iter()
            .any(|gap| gap.code == "unsupported_dynamic_middleware_matcher"
                && gap.blocks_enforcement),
        "missing dynamic middleware parser gap: {proof:#?}"
    );
    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
}

#[test]
fn safe_parse_data_is_validated_only_after_success_guard() {
    let unguarded_source = r#"
import { ProjectInputSchema } from "@/server/validation";
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  await db.project.create({ data: result.data });
  return Response.json({ ok: true });
}
"#;
    let guarded_source = r#"
import { ProjectInputSchema } from "@/server/validation";
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ ok: false }, { status: 400 });
  }
  await db.project.create({ data: result.data });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];

    let unguarded =
        build_request_validation_proof("app/api/projects/route.ts", unguarded_source, &validators)
            .expect("unguarded request validation proof");
    assert!(
        !unguarded.request_validation.proven,
        "safeParse data without success guard must not prove validation: {unguarded:#?}"
    );

    let guarded =
        build_request_validation_proof("app/api/projects/route.ts", guarded_source, &validators)
            .expect("guarded request validation proof");
    assert!(
        guarded.request_validation.proven,
        "safeParse data after success guard should prove validation: {guarded:#?}"
    );
}

#[test]
fn safe_parse_bare_result_is_not_validated_input() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ ok: false }, { status: 400 });
  }
  await db.project.create({ data: result });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(
        !proof.request_validation.proven,
        "bare safeParse result must not prove validation"
    );
    assert!(
        proof
            .request_validation
            .unvalidated_uses
            .iter()
            .any(|use_proof| use_proof.reason == "validation_result_not_used"
                || use_proof.reason == "request_input_not_validated")
    );
}

#[test]
fn safe_parse_guard_must_exit_not_contain_return_string() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  if (!result.success) {
    console.log("return later");
  }
  await db.project.create({ data: result.data });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(
        !proof.request_validation.proven,
        "fake success guard must not prove validation"
    );
}

#[test]
fn safe_parse_data_alias_after_exit_guard_is_validated_input() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const result = ProjectInputSchema.safeParse(body);
  if (!result.success) {
    throw new Error("bad input");
  }
  const input = result.data;
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
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(
        proof.request_validation.proven,
        "guarded safeParse .data alias should prove validation"
    );
}

#[test]
fn multiline_sink_with_validated_and_raw_values_blocks() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const input = ProjectInputSchema.parse(body);
  await db.project.create({
    data: input,
    audit: body
  });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(
        !proof.request_validation.proven,
        "raw body in multi-line sink must block"
    );
    assert!(
        proof
            .request_validation
            .unvalidated_uses
            .iter()
            .any(|use_proof| use_proof.reason == "request_input_not_validated")
    );
}

#[test]
fn destructured_body_input_emits_parser_gap() {
    let source = r#"
const db = { project: { create: async (input) => input } };
export async function POST(request: Request) {
  const body = await request.json();
  const { name } = body;
  await db.project.create({ data: { name } });
  return Response.json({ ok: true });
}
"#;
    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &[])
        .expect("request validation proof");

    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
    assert!(proof.parser_gaps.iter().any(|gap| {
        gap.code == "unsupported_request_input_destructure" && gap.blocks_enforcement
    }));
}

#[test]
fn request_input_spread_emits_parser_gap_and_blocks() {
    let source = r#"
import { ProjectInputSchema } from "@/server/validation";
import { db } from "@/server/db";

export async function POST(request: Request) {
  const body = await request.json();
  const input = ProjectInputSchema.parse(body);
  await db.project.create({ data: { ...body, ownerId: input.ownerId } });
  return Response.json({ ok: true });
}
"#;
    let validators = vec![AcceptedRequestValidator {
        validator_id: "schema_project_input".to_string(),
        symbol: "ProjectInputSchema".to_string(),
        kind: RequestValidatorKind::Schema,
        behavior: RequestValidatorBehavior::ReturnsParsed,
    }];

    let proof = build_request_validation_proof("app/api/projects/route.ts", source, &validators)
        .expect("request validation proof");

    assert!(
        proof.parser_gaps.iter().any(|gap| {
            gap.code == "unsupported_request_input_spread" && gap.blocks_enforcement
        }),
        "missing unsupported request input spread parser gap: {proof:#?}"
    );
    assert_eq!(proof.result.proof_status, SecurityProofStatus::ParserGap);
}
