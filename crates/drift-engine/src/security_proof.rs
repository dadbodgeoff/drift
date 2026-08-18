use crate::{
    AcceptedAuthHelper, AcceptedPhase5Contract, AcceptedRequestValidator, Fact, FactExtractError,
    Phase4SecurityPolicy, extract_security_facts, extract_security_facts_with_phase5,
    extract_security_facts_with_policy, extract_security_facts_with_validation,
    extract_typescript_facts,
    security_control_flow::{
        DominatedSink, MatchedMiddleware, MiddlewareMismatch, branch_bypass_reasons,
        callback_boundary_reasons, conditional_guard_without_else_reasons,
        guard_dominates_straight_line_sinks, indirect_secret_flow_parser_gaps, protected_sinks,
        static_middleware_coverage, undominated_straight_line_reasons,
        unsupported_dynamic_control_flow,
    },
    security_patterns::dynamic_middleware_matcher_line,
    vocabulary::{
        AuthorizationMissingReason, RequestUnvalidatedReason, SecurityParserGapCode,
        SessionTrustReason, TenantMissingReason, UndominatedSinkReason,
    },
};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityBoundaryProof {
    pub auth: AuthBoundaryProof,
    pub middleware: MiddlewareBoundaryProof,
    pub request_validation: RequestValidationProof,
    pub response_shape: ResponseShapeProof,
    pub secret_exposure: SecretExposureProof,
    pub session_trust: SessionTrustProof,
    pub authorization: AuthorizationProof,
    pub tenant: TenantProof,
    pub parser_gaps: Vec<SecurityParserGap>,
    pub result: SecurityProofResult,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteSecurityBoundaryProof {
    pub route_id: String,
    pub file_path: String,
    pub handler_symbol: String,
    pub auth: AuthBoundaryProof,
    pub trusted_guard_calls: Vec<TrustedGuardCallProof>,
    pub undominated_sinks: Vec<UndominatedSinkProof>,
    pub parser_gaps: Vec<SecurityParserGap>,
    pub missing_proof_codes: Vec<String>,
    pub result: SecurityProofResult,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedGuardCallProof {
    pub fact_id: String,
    pub guard_id: String,
    pub symbol: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndominatedSinkProof {
    pub sink_id: String,
    pub sink_kind: String,
    /// The PROOF-level reason, from the one `undominated_sink_reason` vocabulary.
    pub reason: UndominatedSinkReason,
    pub fact_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthBoundaryProof {
    pub required: bool,
    pub proven: bool,
    pub dominated_sinks: Vec<DominatedSink>,
    /// The PROOF-level reasons, from the one `undominated_sink_reason` vocabulary.
    pub undominated_sinks: Vec<UndominatedSinkReason>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MiddlewareBoundaryProof {
    pub required: bool,
    pub proven: bool,
    pub matched_middleware: Vec<MatchedMiddleware>,
    pub mismatches: Vec<MiddlewareMismatch>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestValidationProof {
    pub required: bool,
    pub proven: bool,
    pub input_reads: Vec<RequestInputReadProof>,
    pub validations: Vec<RequestValidationCallProof>,
    pub validated_uses: Vec<RequestValidatedUseProof>,
    pub unvalidated_uses: Vec<RequestUnvalidatedUseProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionTrustProof {
    pub required: bool,
    pub proven: bool,
    pub trusted_sessions: Vec<SessionTrustBoundaryProof>,
    pub missing_trust: Vec<SessionMissingTrustProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionTrustBoundaryProof {
    pub fact_id: String,
    pub variable: String,
    pub trust: String,
    pub derived_from: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionMissingTrustProof {
    pub fact_id: String,
    pub variable: String,
    /// The PROOF-level reason, from the one vocabulary that declares them.
    ///
    /// This was a `String`, and S1-01 is what that cost: the builder wrote
    /// `session_not_trusted` here - a FINDING-level code, a non-member of the proof-level
    /// enum the CLI parses this field with - and the engine's own output failed
    /// `SecurityBoundaryProofSchema`. Nothing in Rust could have caught it, because every
    /// string is a valid `String`.
    ///
    /// Typed, the same mistake does not compile.
    pub reason: SessionTrustReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationProof {
    pub required: bool,
    pub proven: bool,
    pub role_or_policy_guards: Vec<AuthorizationGuardProof>,
    pub missing: Vec<AuthorizationMissingProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationGuardProof {
    pub fact_id: String,
    pub policy_id: Option<String>,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    pub resource_var: Option<String>,
    pub subject_var: Option<String>,
    pub dominates_sinks: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationMissingProof {
    /// The PROOF-level reason, from the one `authorization_missing_reason` vocabulary.
    pub reason: AuthorizationMissingReason,
    pub sink_fact_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantProof {
    pub required: bool,
    pub proven: bool,
    pub tenant_sources: Vec<TenantSourceProof>,
    pub predicates: Vec<TenantPredicateProof>,
    pub missing: Vec<TenantMissingProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantSourceProof {
    pub fact_id: String,
    pub source: String,
    pub key: Option<String>,
    pub trusted: bool,
    pub variable: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantPredicateProof {
    pub fact_id: String,
    pub data_operation_fact_id: String,
    pub tenant_key: String,
    pub predicate_kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantMissingProof {
    pub data_operation_fact_id: String,
    /// The PROOF-level reason, from the one `tenant_missing_reason` vocabulary.
    pub reason: TenantMissingReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestInputReadProof {
    pub fact_id: String,
    pub source: String,
    pub variable: String,
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestValidationCallProof {
    pub fact_id: String,
    pub validator_symbol: String,
    pub schema_symbol: Option<String>,
    pub input_var: Option<String>,
    pub result_var: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestValidatedUseProof {
    pub fact_id: String,
    pub source_input_var: String,
    pub validated_var: String,
    pub sink_fact_id: String,
    pub sink_kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestUnvalidatedUseProof {
    pub input_fact_id: String,
    pub sink_fact_id: String,
    pub sink_kind: String,
    /// The PROOF-level reason, from the one `request_unvalidated_reason` vocabulary.
    pub reason: RequestUnvalidatedReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResponseShapeProof {
    pub required: bool,
    pub proven: bool,
    pub sensitive_leaks: Vec<ResponseSensitiveLeakProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResponseSensitiveLeakProof {
    pub field_fact_id: String,
    pub field_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretExposureProof {
    pub required: bool,
    pub proven: bool,
    pub exposed_secrets: Vec<ExposedSecretProof>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExposedSecretProof {
    pub secret_fact_id: String,
    pub secret_class: String,
    pub sink_kind: String,
    pub sink_line: usize,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityProofResult {
    pub proof_status: SecurityProofStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityParserGap {
    pub parser_gap_id: String,
    /// From the one `security_parser_gap_code` vocabulary.
    pub code: SecurityParserGapCode,
    pub file_path: String,
    pub reason: String,
    pub blocks_enforcement: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityProofStatus {
    Proven,
    MissingProof,
    ParserGap,
}

pub fn build_auth_boundary_proof(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_auth_helpers: &[AcceptedAuthHelper],
) -> Result<SecurityBoundaryProof, FactExtractError> {
    let base_facts = extract_typescript_facts(&file_path, source)?;
    let security_facts = extract_security_facts(file_path, source, accepted_auth_helpers)?;
    let mut facts: Vec<Fact> = base_facts.into_iter().chain(security_facts).collect();
    facts.sort_by_key(|fact| fact.start_line);

    let dominated_sinks = guard_dominates_straight_line_sinks(&facts);
    let mut undominated_sinks = undominated_straight_line_reasons(&facts);
    undominated_sinks.extend(branch_bypass_reasons(source, &facts));
    undominated_sinks.extend(callback_boundary_reasons(source, &facts));
    let dynamic_control_flow = unsupported_dynamic_control_flow(source);
    if dynamic_control_flow {
        undominated_sinks.push(UndominatedSinkReason::UnsupportedDynamicControlFlow);
    }
    let parser_gaps = if dynamic_control_flow {
        vec![SecurityParserGap {
            parser_gap_id: format!(
                "parser_gap:{}:unsupported_dynamic_control_flow",
                facts
                    .first()
                    .map(|fact| fact.file_path.as_str())
                    .unwrap_or("unknown")
            ),
            code: SecurityParserGapCode::UnsupportedDynamicControlFlow,
            file_path: facts
                .first()
                .map(|fact| fact.file_path.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            reason: "Dynamic control flow could not be analysed, so auth coverage for this route is unknown".to_string(),
            blocks_enforcement: true,
        }]
    } else {
        Vec::new()
    };
    let sink_count = protected_sinks(&facts).len();
    let proven =
        sink_count > 0 && dominated_sinks.len() == sink_count && undominated_sinks.is_empty();

    Ok(SecurityBoundaryProof {
        auth: AuthBoundaryProof {
            required: true,
            proven,
            dominated_sinks,
            undominated_sinks,
        },
        middleware: MiddlewareBoundaryProof {
            required: false,
            proven: false,
            matched_middleware: Vec::new(),
            mismatches: Vec::new(),
        },
        request_validation: RequestValidationProof::not_required(),
        response_shape: ResponseShapeProof::not_required(),
        secret_exposure: SecretExposureProof::not_required(),
        session_trust: build_session_trust_proof_from_facts(&facts),
        authorization: AuthorizationProof::not_required(),
        tenant: TenantProof::not_required(),
        parser_gaps,
        result: SecurityProofResult {
            proof_status: if dynamic_control_flow {
                SecurityProofStatus::ParserGap
            } else if proven {
                SecurityProofStatus::Proven
            } else {
                SecurityProofStatus::MissingProof
            },
        },
    })
}

pub fn build_auth_boundary_proofs_for_file(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_auth_helpers: &[AcceptedAuthHelper],
) -> Result<Vec<RouteSecurityBoundaryProof>, FactExtractError> {
    let file_path_string = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let base_facts = extract_typescript_facts(&file_path, source)?;
    let security_facts = extract_security_facts(file_path, source, accepted_auth_helpers)?;
    let mut facts: Vec<Fact> = base_facts.into_iter().chain(security_facts).collect();
    facts.sort_by_key(|fact| fact.start_line);

    let routes = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::RouteDeclared)
        .cloned()
        .collect::<Vec<_>>();
    let mut proofs = Vec::new();
    for route in routes {
        let route_facts = facts
            .iter()
            .filter(|fact| route.start_line <= fact.start_line && fact.end_line <= route.end_line)
            .cloned()
            .collect::<Vec<_>>();
        let route_id = format!("route:{}:{}", file_path_string, route.name);
        proofs.push(build_route_auth_boundary_proof(
            route_id,
            file_path_string.clone(),
            route.name,
            source,
            &route_facts,
        ));
    }
    Ok(proofs)
}

fn build_route_auth_boundary_proof(
    route_id: String,
    file_path: String,
    handler_symbol: String,
    route_source: &str,
    facts: &[Fact],
) -> RouteSecurityBoundaryProof {
    let sinks = protected_sinks(facts);
    let first_guard_line = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::AuthGuardCalled)
        .map(|fact| fact.start_line)
        .min();
    let trusted_guard_calls = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::AuthGuardCalled)
        .map(|fact| TrustedGuardCallProof {
            fact_id: fact_id(fact),
            guard_id: guard_id(fact),
            symbol: fact
                .imported_name
                .clone()
                .unwrap_or_else(|| fact.name.clone()),
            start_line: fact.start_line,
            end_line: fact.end_line,
        })
        .collect::<Vec<_>>();
    let callback_reasons = callback_boundary_reasons(route_source, facts);
    let branch_reasons = branch_bypass_reasons(route_source, facts);
    let conditional_reasons = conditional_guard_without_else_reasons(route_source, facts);
    let dynamic_control_flow = unsupported_dynamic_control_flow(route_source);
    let path_sensitive_reasons = callback_reasons
        .iter()
        .chain(branch_reasons.iter())
        .chain(conditional_reasons.iter())
        .cloned()
        .collect::<Vec<_>>();

    let mut dominated_sinks = Vec::new();
    let mut undominated_sinks = Vec::new();
    let mut undominated_sink_proofs = Vec::new();
    for sink in sinks {
        let sink_id = sink_id(sink);
        let sink_kind = sink_kind(sink).to_string();
        let fact_ids = vec![fact_id(sink)];
        if dynamic_control_flow {
            undominated_sinks.push(UndominatedSinkReason::UnsupportedDynamicControlFlow);
            undominated_sink_proofs.push(UndominatedSinkProof {
                sink_id,
                sink_kind,
                reason: UndominatedSinkReason::UnsupportedDynamicControlFlow,
                fact_ids,
            });
        } else if let Some(reason) = path_sensitive_reasons.first() {
            undominated_sinks.push(*reason);
            undominated_sink_proofs.push(UndominatedSinkProof {
                sink_id,
                sink_kind,
                reason: *reason,
                fact_ids,
            });
        } else if first_guard_line.is_some_and(|line| line < sink.start_line) {
            dominated_sinks.push(DominatedSink {
                sink_id,
                sink_kind,
                edge_id: format!("edge:auth-dominates:{}:{}", sink.file_path, sink.start_line),
            });
        } else if first_guard_line.is_some_and(|line| line > sink.start_line) {
            undominated_sinks.push(UndominatedSinkReason::GuardAfterSink);
            undominated_sink_proofs.push(UndominatedSinkProof {
                sink_id,
                sink_kind,
                reason: UndominatedSinkReason::GuardAfterSink,
                fact_ids,
            });
        } else {
            undominated_sinks.push(UndominatedSinkReason::NoGuardCall);
            undominated_sink_proofs.push(UndominatedSinkProof {
                sink_id,
                sink_kind,
                reason: UndominatedSinkReason::NoGuardCall,
                fact_ids,
            });
        }
    }
    undominated_sinks.sort();
    undominated_sinks.dedup();
    undominated_sink_proofs.sort_by(|left, right| {
        (left.reason.as_wire(), &left.sink_id).cmp(&(right.reason.as_wire(), &right.sink_id))
    });
    undominated_sink_proofs
        .dedup_by(|left, right| left.reason == right.reason && left.sink_id == right.sink_id);

    let parser_gaps = if dynamic_control_flow {
        vec![SecurityParserGap {
            parser_gap_id: format!("{route_id}:parser_gap:unsupported_dynamic_control_flow"),
            code: SecurityParserGapCode::UnsupportedDynamicControlFlow,
            file_path: file_path.clone(),
            reason: "Dynamic control flow could not be analysed, so auth coverage for this route is unknown".to_string(),
            blocks_enforcement: true,
        }]
    } else {
        Vec::new()
    };
    let sink_count = protected_sinks(facts).len();
    let proven =
        sink_count > 0 && dominated_sinks.len() == sink_count && undominated_sinks.is_empty();
    let missing_proof_codes = if proven {
        Vec::new()
    } else if dynamic_control_flow {
        vec!["unsupported_dynamic_control_flow".to_string()]
    } else {
        undominated_sinks
            .iter()
            .map(|reason| missing_proof_code(*reason).to_string())
            .collect()
    };

    RouteSecurityBoundaryProof {
        route_id,
        file_path,
        handler_symbol,
        auth: AuthBoundaryProof {
            required: true,
            proven,
            dominated_sinks,
            undominated_sinks,
        },
        trusted_guard_calls,
        undominated_sinks: undominated_sink_proofs,
        parser_gaps,
        missing_proof_codes,
        result: SecurityProofResult {
            proof_status: if dynamic_control_flow {
                SecurityProofStatus::ParserGap
            } else if proven {
                SecurityProofStatus::Proven
            } else {
                SecurityProofStatus::MissingProof
            },
        },
    }
}

/// The PROOF-level undominated-sink reason, as the FINDING-level code a user reads.
///
/// Exhaustive over the enum since S2-03, with no catch-all: a member added to
/// `undominated_sink_reason` does not compile until somebody decides what the finding says.
/// The three that collapse to `auth_guard_not_dominating_sink` do so because that is what
/// they mean - a guard exists and does not cover the sink - which is a different statement
/// from `missing_auth_guard`, where there is no guard at all.
fn missing_proof_code(reason: UndominatedSinkReason) -> &'static str {
    match reason {
        UndominatedSinkReason::NoGuardCall => "missing_auth_guard",
        UndominatedSinkReason::UnsupportedDynamicControlFlow => "unsupported_dynamic_control_flow",
        UndominatedSinkReason::GuardAfterSink
        | UndominatedSinkReason::GuardOnlyInOneBranch
        | UndominatedSinkReason::CallbackBoundary => "auth_guard_not_dominating_sink",
    }
}

fn fact_id(fact: &Fact) -> String {
    format!(
        "fact:{}:{}:{}",
        fact.file_path, fact.kind as u8, fact.start_line
    )
}

fn guard_id(fact: &Fact) -> String {
    fact.value
        .as_ref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| {
            value
                .get("guard_id")
                .and_then(|guard| guard.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            format!(
                "auth:{}",
                fact.imported_name.as_deref().unwrap_or(&fact.name)
            )
        })
}

fn sink_id(fact: &Fact) -> String {
    format!("sink:{}:{}:{}", fact.file_path, fact.start_line, fact.name)
}

fn sink_kind(fact: &Fact) -> &'static str {
    match fact.kind {
        crate::FactKind::DataOperationDetected => "data_operation",
        crate::FactKind::RouteReturnsResponse => "response",
        crate::FactKind::OutboundRequestCalled => "outbound_request",
        crate::FactKind::RawSqlCalled => "raw_sql",
        _ => "unknown",
    }
}

pub fn build_middleware_coverage_proof(
    middleware_file_path: impl AsRef<std::path::Path>,
    middleware_source: &str,
    route_file_path: impl AsRef<std::path::Path>,
    route_source: &str,
    accepted_auth_helpers: &[AcceptedAuthHelper],
) -> Result<SecurityBoundaryProof, FactExtractError> {
    let middleware_file_path_string = middleware_file_path
        .as_ref()
        .to_string_lossy()
        .replace('\\', "/");
    let middleware_facts = extract_security_facts(
        &middleware_file_path,
        middleware_source,
        accepted_auth_helpers,
    )?;
    let route_facts = extract_typescript_facts(&route_file_path, route_source)?;
    let route_file_path = route_file_path
        .as_ref()
        .to_string_lossy()
        .replace('\\', "/");
    let route_method = route_facts
        .iter()
        .find(|fact| fact.kind == crate::FactKind::RouteDeclared)
        .map(|fact| fact.name.as_str())
        .unwrap_or("GET");
    let (matched_middleware, mismatches) =
        static_middleware_coverage(&middleware_facts, &route_file_path, route_method);
    let dynamic_matcher_line = dynamic_middleware_matcher_line(middleware_source);
    let parser_gaps = dynamic_matcher_line
        .map(|line| {
            vec![SecurityParserGap {
                parser_gap_id: format!(
                    "parser_gap:{}:{}:unsupported_dynamic_middleware_matcher",
                    middleware_file_path_string, line
                ),
                code: SecurityParserGapCode::UnsupportedDynamicMiddlewareMatcher,
                file_path: middleware_file_path_string.clone(),
                reason: "Dynamic middleware matcher prevents deterministic route coverage proof"
                    .to_string(),
                blocks_enforcement: true,
            }]
        })
        .unwrap_or_default();
    let proven = parser_gaps.is_empty()
        && !matched_middleware.is_empty()
        && matched_middleware
            .iter()
            .any(|middleware| middleware.protection_kind == "auth");

    Ok(SecurityBoundaryProof {
        auth: AuthBoundaryProof {
            required: false,
            proven: false,
            dominated_sinks: Vec::new(),
            undominated_sinks: Vec::new(),
        },
        middleware: MiddlewareBoundaryProof {
            required: true,
            proven,
            matched_middleware,
            mismatches,
        },
        request_validation: RequestValidationProof::not_required(),
        response_shape: ResponseShapeProof::not_required(),
        secret_exposure: SecretExposureProof::not_required(),
        session_trust: build_session_trust_proof_from_facts(&middleware_facts),
        authorization: AuthorizationProof::not_required(),
        tenant: TenantProof::not_required(),
        parser_gaps,
        result: SecurityProofResult {
            proof_status: if dynamic_matcher_line.is_some() {
                SecurityProofStatus::ParserGap
            } else if proven {
                SecurityProofStatus::Proven
            } else {
                SecurityProofStatus::MissingProof
            },
        },
    })
}

pub fn build_request_validation_proof(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_validators: &[AcceptedRequestValidator],
) -> Result<SecurityBoundaryProof, FactExtractError> {
    build_request_validation_proof_with_scope(
        file_path,
        source,
        accepted_validators,
        &RequestValidationProofScope::default(),
    )
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequestValidationProofScope {
    pub input_sources: Vec<String>,
    pub sink_kinds: Vec<String>,
}

pub fn build_request_validation_proof_with_scope(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_validators: &[AcceptedRequestValidator],
    scope: &RequestValidationProofScope,
) -> Result<SecurityBoundaryProof, FactExtractError> {
    let base_facts = extract_typescript_facts(&file_path, source)?;
    let security_facts =
        extract_security_facts_with_validation(file_path, source, &[], accepted_validators)?;
    let mut facts: Vec<Fact> = base_facts.into_iter().chain(security_facts).collect();
    facts.sort_by_key(|fact| fact.start_line);
    let lines = source.lines().collect::<Vec<_>>();

    let input_reads = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::RequestInputRead)
        .filter_map(request_input_read_proof)
        .filter(|input| {
            scope.input_sources.is_empty() || scope.input_sources.contains(&input.source)
        })
        .collect::<Vec<_>>();
    let input_variables = input_reads
        .iter()
        .map(|input| input.variable.clone())
        .collect::<Vec<_>>();
    let validations = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::RequestValidationCalled)
        .filter_map(request_validation_call_proof)
        .collect::<Vec<_>>();
    let validated_uses = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::ValidatedInputUsed)
        .filter_map(request_validated_use_proof)
        .filter(|validated| {
            (scope.sink_kinds.is_empty() || scope.sink_kinds.contains(&validated.sink_kind))
                && input_variables.contains(&validated.source_input_var)
        })
        .collect::<Vec<_>>();
    let parser_gaps = request_input_parser_gaps(&file_path_string(&facts), &lines, &input_reads);
    if input_reads.is_empty() {
        return Ok(SecurityBoundaryProof {
            auth: AuthBoundaryProof {
                required: false,
                proven: false,
                dominated_sinks: Vec::new(),
                undominated_sinks: Vec::new(),
            },
            middleware: MiddlewareBoundaryProof {
                required: false,
                proven: false,
                matched_middleware: Vec::new(),
                mismatches: Vec::new(),
            },
            request_validation: RequestValidationProof::not_required(),
            response_shape: ResponseShapeProof::not_required(),
            secret_exposure: SecretExposureProof::not_required(),
            session_trust: build_session_trust_proof_from_facts(&facts),
            authorization: AuthorizationProof::not_required(),
            tenant: TenantProof::not_required(),
            parser_gaps,
            result: SecurityProofResult {
                proof_status: SecurityProofStatus::Proven,
            },
        });
    }
    let unvalidated_uses = request_unvalidated_uses(
        &facts,
        &lines,
        &input_reads,
        &validations,
        &validated_uses,
        &scope.sink_kinds,
    );
    let proven = parser_gaps.is_empty()
        && !input_reads.is_empty()
        && !validated_uses.is_empty()
        && unvalidated_uses.is_empty();
    let proof_status = if !parser_gaps.is_empty() {
        SecurityProofStatus::ParserGap
    } else if proven {
        SecurityProofStatus::Proven
    } else {
        SecurityProofStatus::MissingProof
    };

    Ok(SecurityBoundaryProof {
        auth: AuthBoundaryProof {
            required: false,
            proven: false,
            dominated_sinks: Vec::new(),
            undominated_sinks: Vec::new(),
        },
        middleware: MiddlewareBoundaryProof {
            required: false,
            proven: false,
            matched_middleware: Vec::new(),
            mismatches: Vec::new(),
        },
        request_validation: RequestValidationProof {
            required: true,
            proven,
            input_reads,
            validations,
            validated_uses,
            unvalidated_uses,
        },
        response_shape: ResponseShapeProof::not_required(),
        secret_exposure: SecretExposureProof::not_required(),
        session_trust: build_session_trust_proof_from_facts(&facts),
        authorization: AuthorizationProof::not_required(),
        tenant: TenantProof::not_required(),
        parser_gaps,
        result: SecurityProofResult { proof_status },
    })
}

/// Whether a sensitive-field `source` is trusted enough to enforce against.
///
/// **This is a TRUST boundary, not an acceptance boundary** — the misreading that produced D1's
/// first proposed fix, and worth stating in the code rather than a review comment.
///
/// The values it tests are *provenance*: where the claim "this field is sensitive" came from.
/// `"candidate"` means a name heuristic guessed it and **no human has looked at the guess** — so
/// enforcing on it would block a diff on Drift's own unreviewed inference. Every other value in
/// `SENSITIVE_FIELD_SOURCES` carries a human behind it: `"contract"` and `"schema"` were written
/// by hand, and `"accepted_inference"` is a guess someone confirmed with `drift conventions
/// accept`.
///
/// What this filter must never be read as is "drop fields that were not accepted". Nothing
/// unaccepted reaches here; the whole input is an accepted convention's `requires`. Reading it
/// that way is what made a hardcoded `"source": "candidate"` at the proposal site
/// (`candidate_command.rs`) look harmless, and it is why this check could not fire on any repo.
pub fn sensitive_field_source_is_trusted(source: &str) -> bool {
    source != "candidate"
}

pub fn build_response_shape_proof(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_phase5: &AcceptedPhase5Contract,
) -> Result<SecurityBoundaryProof, FactExtractError> {
    let base_facts = extract_typescript_facts(&file_path, source)?;
    let security_facts =
        extract_security_facts_with_phase5(&file_path, source, &[], &[], Some(accepted_phase5))?;
    let mut facts: Vec<Fact> = base_facts.into_iter().chain(security_facts).collect();
    facts.sort_by_key(|fact| fact.start_line);

    let sensitive_fields = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::SensitiveFieldDeclared)
        .filter_map(sensitive_field_declared_value)
        .filter(|field| sensitive_field_source_is_trusted(&field.source))
        .collect::<Vec<_>>();
    let serializers = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::SerializerCalled)
        .filter_map(serializer_called_value)
        .collect::<Vec<_>>();
    let file_path_string = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let parser_gaps = response_shape_parser_gaps(&file_path_string, source);
    let mut leaks = Vec::new();
    for response_field in facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::ResponseEmitsField)
        .filter_map(response_emits_field_value)
    {
        if !sensitive_fields
            .iter()
            .any(|field| field.field_path == response_field.field_path)
        {
            continue;
        }
        if serializers
            .iter()
            .any(|serializer| serializer_proves_response_field(serializer, &response_field))
        {
            continue;
        }
        leaks.push(ResponseSensitiveLeakProof {
            field_fact_id: response_field.fact_id,
            field_path: response_field.field_path,
            reason: "sensitive_field_without_serializer".to_string(),
        });
    }
    let proven = leaks.is_empty() && parser_gaps.is_empty();
    let proof_status = if !parser_gaps.is_empty() {
        SecurityProofStatus::ParserGap
    } else if proven {
        SecurityProofStatus::Proven
    } else {
        SecurityProofStatus::MissingProof
    };

    Ok(SecurityBoundaryProof {
        auth: AuthBoundaryProof {
            required: false,
            proven: false,
            dominated_sinks: Vec::new(),
            undominated_sinks: Vec::new(),
        },
        middleware: MiddlewareBoundaryProof {
            required: false,
            proven: false,
            matched_middleware: Vec::new(),
            mismatches: Vec::new(),
        },
        request_validation: RequestValidationProof::not_required(),
        response_shape: ResponseShapeProof {
            required: true,
            proven,
            sensitive_leaks: leaks,
        },
        secret_exposure: SecretExposureProof::not_required(),
        session_trust: SessionTrustProof::not_required(),
        authorization: AuthorizationProof::not_required(),
        tenant: TenantProof::not_required(),
        parser_gaps,
        result: SecurityProofResult { proof_status },
    })
}

pub fn build_secret_exposure_proof(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_phase5: &AcceptedPhase5Contract,
) -> Result<SecurityBoundaryProof, FactExtractError> {
    let base_facts = extract_typescript_facts(&file_path, source)?;
    let security_facts =
        extract_security_facts_with_phase5(&file_path, source, &[], &[], Some(accepted_phase5))?;
    let mut facts: Vec<Fact> = base_facts.into_iter().chain(security_facts).collect();
    facts.sort_by_key(|fact| fact.start_line);

    let secret_reads = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::SecretRead)
        .filter_map(|fact| secret_read_value(fact, source))
        .collect::<Vec<_>>();
    let secret_vars = secret_reads
        .iter()
        .filter_map(|secret| secret.variable.clone())
        .collect::<Vec<_>>();
    let direct_exposures = secret_sink_exposures(source, &secret_reads, &accepted_phase5.log_sinks);
    let exposed_secrets = direct_exposures
        .into_iter()
        .map(|exposure| ExposedSecretProof {
            secret_fact_id: exposure.secret_fact_id,
            secret_class: exposure.secret_class,
            sink_kind: exposure.sink_kind,
            sink_line: exposure.sink_line,
            reason: "secret_reaches_sink".to_string(),
        })
        .collect::<Vec<_>>();
    let file_path_string = file_path.as_ref().to_string_lossy().replace('\\', "/");
    let parser_gaps =
        indirect_secret_flow_parser_gaps(source, &secret_vars, &accepted_phase5.log_sinks)
            .into_iter()
            .map(|gap| SecurityParserGap {
                parser_gap_id: format!(
                    "parser_gap:{}:{}:{}",
                    file_path_string,
                    gap.source_line,
                    gap.code.as_wire()
                ),
                code: gap.code,
                file_path: file_path_string.clone(),
                reason: "Indirect helper secret flow prevents deterministic secret exposure proof"
                    .to_string(),
                blocks_enforcement: true,
            })
            .collect::<Vec<_>>();
    let proven = exposed_secrets.is_empty() && parser_gaps.is_empty();
    let proof_status = if !parser_gaps.is_empty() {
        SecurityProofStatus::ParserGap
    } else if proven {
        SecurityProofStatus::Proven
    } else {
        SecurityProofStatus::MissingProof
    };

    Ok(SecurityBoundaryProof {
        auth: AuthBoundaryProof {
            required: false,
            proven: false,
            dominated_sinks: Vec::new(),
            undominated_sinks: Vec::new(),
        },
        middleware: MiddlewareBoundaryProof {
            required: false,
            proven: false,
            matched_middleware: Vec::new(),
            mismatches: Vec::new(),
        },
        request_validation: RequestValidationProof::not_required(),
        response_shape: ResponseShapeProof::not_required(),
        secret_exposure: SecretExposureProof {
            required: true,
            proven,
            exposed_secrets,
        },
        session_trust: SessionTrustProof::not_required(),
        authorization: AuthorizationProof::not_required(),
        tenant: TenantProof::not_required(),
        parser_gaps,
        result: SecurityProofResult { proof_status },
    })
}

pub fn build_phase4_security_proof(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    accepted_auth_helpers: &[AcceptedAuthHelper],
) -> Result<SecurityBoundaryProof, FactExtractError> {
    build_phase4_security_proof_with_policy(
        file_path,
        source,
        &Phase4SecurityPolicy::from_auth_helpers(accepted_auth_helpers),
    )
}

pub fn build_phase4_security_proof_with_policy(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    phase4_policy: &Phase4SecurityPolicy,
) -> Result<SecurityBoundaryProof, FactExtractError> {
    let base_facts = extract_typescript_facts(&file_path, source)?;
    let security_facts = extract_security_facts_with_policy(file_path, source, phase4_policy, &[])?;
    let mut facts: Vec<Fact> = base_facts.into_iter().chain(security_facts).collect();
    facts.sort_by_key(|fact| fact.start_line);

    let session_trust = build_session_trust_proof_from_facts(&facts);
    let authorization =
        build_authorization_proof_from_facts(&facts, source, &session_trust, phase4_policy);
    let tenant = build_tenant_proof_from_facts(&facts, &session_trust, phase4_policy);
    let parser_gaps = phase4_parser_gaps(&file_path_string(&facts), source);
    let proven = session_trust.proven
        && (!authorization.required || authorization.proven)
        && (!tenant.required || tenant.proven)
        && parser_gaps.is_empty();

    Ok(SecurityBoundaryProof {
        auth: AuthBoundaryProof {
            required: false,
            proven: false,
            dominated_sinks: Vec::new(),
            undominated_sinks: Vec::new(),
        },
        middleware: MiddlewareBoundaryProof {
            required: false,
            proven: false,
            matched_middleware: Vec::new(),
            mismatches: Vec::new(),
        },
        request_validation: RequestValidationProof::not_required(),
        response_shape: ResponseShapeProof::not_required(),
        secret_exposure: SecretExposureProof::not_required(),
        session_trust,
        authorization,
        tenant,
        parser_gaps: parser_gaps.clone(),
        result: SecurityProofResult {
            proof_status: if !parser_gaps.is_empty() {
                SecurityProofStatus::ParserGap
            } else if proven {
                SecurityProofStatus::Proven
            } else {
                SecurityProofStatus::MissingProof
            },
        },
    })
}

fn phase4_parser_gaps(file_path: &str, source: &str) -> Vec<SecurityParserGap> {
    let lines = source.lines().collect::<Vec<_>>();
    let mut gaps = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        if line.contains("where:") && line.contains('[') && line.contains(']') {
            gaps.push(phase4_parser_gap(
                file_path,
                line_number,
                SecurityParserGapCode::UnsupportedTenantDynamicProperty,
                "Computed tenant predicate key prevents deterministic tenant proof",
            ));
        }
        if line.contains("const ")
            && line.contains("where:")
            && line.contains("tenantId")
            && line.contains(".user.")
            && let Some(variable) = assigned_variable(line)
        {
            let marker = format!("({variable})");
            if lines
                .iter()
                .skip(index + 1)
                .any(|candidate| candidate.contains(&marker))
            {
                gaps.push(phase4_parser_gap(
                    file_path,
                    line_number,
                    SecurityParserGapCode::UnsupportedTenantQueryObjectAlias,
                    "Tenant query object alias prevents deterministic tenant proof",
                ));
            }
        }
        if line.contains("user:") && line.contains("tenantId") && line.contains("} = session") {
            gaps.push(phase4_parser_gap(
                file_path,
                line_number,
                SecurityParserGapCode::UnsupportedSessionNestedDestructure,
                "Nested session destructuring prevents deterministic session trust proof",
            ));
        }
    }
    gaps.sort_by(|left, right| {
        (left.code.as_wire(), &left.parser_gap_id)
            .cmp(&(right.code.as_wire(), &right.parser_gap_id))
    });
    gaps.dedup_by(|left, right| {
        left.code == right.code && left.parser_gap_id == right.parser_gap_id
    });
    gaps
}

fn phase4_parser_gap(
    file_path: &str,
    line_number: usize,
    code: SecurityParserGapCode,
    reason: &str,
) -> SecurityParserGap {
    SecurityParserGap {
        parser_gap_id: format!("parser_gap:{file_path}:{line_number}:{}", code.as_wire()),
        code,
        file_path: file_path.to_string(),
        reason: reason.to_string(),
        blocks_enforcement: true,
    }
}

fn build_authorization_proof_from_facts(
    facts: &[Fact],
    source: &str,
    session_trust: &SessionTrustProof,
    phase4_policy: &Phase4SecurityPolicy,
) -> AuthorizationProof {
    let data_operations = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::DataOperationDetected)
        .filter(|fact| data_operation_matches_policy(fact, phase4_policy))
        .collect::<Vec<_>>();
    let guards = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::AuthorizationGuardCalled)
        .filter_map(|fact| {
            authorization_guard_proof(
                fact,
                authorization_guard_dominates(fact, facts, source, phase4_policy),
            )
        })
        .collect::<Vec<_>>();
    let mut missing = Vec::new();
    if !data_operations.is_empty() && guards.is_empty() {
        missing.push(AuthorizationMissingProof {
            reason: AuthorizationMissingReason::AuthorizationGuardMissing,
            sink_fact_id: data_operations.first().map(|fact| sink_id(fact)),
        });
    }
    for guard in &guards {
        if guard
            .subject_var
            .as_deref()
            .is_some_and(|subject| !subject_uses_trusted_session(subject, session_trust))
        {
            missing.push(AuthorizationMissingProof {
                reason: AuthorizationMissingReason::SessionNotTrusted,
                sink_fact_id: data_operations.first().map(|fact| sink_id(fact)),
            });
        }
        if !guard.dominates_sinks {
            missing.push(AuthorizationMissingProof {
                reason: AuthorizationMissingReason::AuthorizationGuardNotDominatingSink,
                sink_fact_id: data_operations.first().map(|fact| sink_id(fact)),
            });
        }
    }
    // Sort on the WIRE STRING, not the enum. Deriving Ord orders variants by their
    // position in vocabulary/vocabulary.json, which is not the lexicographic order these
    // lists were sorted in while `reason` was a String. That difference is not cosmetic:
    // consumers read `.first()` -- `phase4_missing_code` for the finding's missing_code,
    // and security_rules.rs for `actual_layer` -- so a reordering silently changes which
    // reason a user is shown. Proven here: `session_not_trusted` is declared before
    // `authorization_guard_not_dominating_sink` but sorts after it as a string.
    missing.sort_by(|left, right| {
        (left.reason.as_wire(), &left.sink_fact_id)
            .cmp(&(right.reason.as_wire(), &right.sink_fact_id))
    });
    missing.dedup();
    let required = !data_operations.is_empty();
    AuthorizationProof {
        required,
        proven: required && !guards.is_empty() && missing.is_empty(),
        role_or_policy_guards: guards,
        missing,
    }
}

fn build_tenant_proof_from_facts(
    facts: &[Fact],
    session_trust: &SessionTrustProof,
    phase4_policy: &Phase4SecurityPolicy,
) -> TenantProof {
    let data_operations = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::DataOperationDetected)
        .filter(|fact| data_operation_matches_policy(fact, phase4_policy))
        .collect::<Vec<_>>();
    let tenant_sources = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::TenantSource)
        .filter_map(tenant_source_proof)
        .collect::<Vec<_>>();
    let tenant_guard_facts = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::TenantGuardCalled)
        .collect::<Vec<_>>();
    let helper_operations = tenant_guard_facts
        .iter()
        .filter(|fact| {
            fact.value
                .as_deref()
                .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
                .and_then(|value| {
                    value
                        .get("predicate_kind")
                        .and_then(|kind| kind.as_str())
                        .map(|kind| kind == "scoped_helper")
                })
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    let predicates = tenant_guard_facts
        .iter()
        .filter_map(|fact| tenant_predicate_proof(fact, &data_operations))
        .collect::<Vec<_>>();
    let protected_operation_count = data_operations.len() + helper_operations.len();
    let mut missing = Vec::new();
    if protected_operation_count > 0 && predicates.is_empty() && tenant_sources.is_empty() {
        missing.push(TenantMissingProof {
            data_operation_fact_id: data_operations
                .first()
                .map(|fact| fact_id(fact))
                .unwrap_or_default(),
            reason: TenantMissingReason::TenantPredicateMissing,
        });
    }
    // A tenant predicate only has a *source* to distrust when the route itself supplies the tenant
    // value - `where: { tenantId: <expr> }`, recorded as `predicate_kind: "equality"`. A
    // `scoped_helper` predicate is the accepted helper applying the scope, and the helper's own
    // tenant value never appears in the route, so there is nothing here to trace back to a session.
    //
    // Treating the two alike made every proposer-produced convention of this kind unfalsifiable.
    // `push_guard_candidate` (candidate_command.rs:539) emits `requires: { tenant_helpers: [...] }`
    // and nothing else - no `auth_helpers` - so `accepted_auth_helpers` is empty, so no
    // `SessionRead` is ever stamped `source: "auth_result"`, so `trusted_sessions` is empty for
    // every route in the repo. With `!predicates.is_empty()` on both sides of the conjunction, a
    // route that called the accepted helper produced a predicate and was then failed for
    // `tenant_source_untrusted` naming a source it does not have. The kind could report a
    // violation but never a pass, which is not enforcement - it is a constant.
    let route_supplied_predicates = predicates
        .iter()
        .any(|predicate| predicate.predicate_kind != "scoped_helper");
    let has_untrusted_session_use = (!session_trust.missing_trust.is_empty()
        || (session_trust.trusted_sessions.is_empty() && route_supplied_predicates))
        && (route_supplied_predicates
            || tenant_sources
                .iter()
                .any(|source| !source.trusted && source.source != "path_param"));
    if has_untrusted_session_use {
        missing.push(TenantMissingProof {
            data_operation_fact_id: data_operations
                .first()
                .map(|fact| fact_id(fact))
                .unwrap_or_default(),
            reason: TenantMissingReason::TenantSourceUntrusted,
        });
    }
    if protected_operation_count > 0 && predicates.is_empty() && !tenant_sources.is_empty() {
        missing.push(TenantMissingProof {
            data_operation_fact_id: data_operations
                .first()
                .map(|fact| fact_id(fact))
                .unwrap_or_default(),
            reason: TenantMissingReason::TenantPredicateNotBoundToQuery,
        });
    }
    missing.sort_by(|left, right| {
        (left.reason.as_wire(), &left.data_operation_fact_id)
            .cmp(&(right.reason.as_wire(), &right.data_operation_fact_id))
    });
    missing.dedup();
    let required = protected_operation_count > 0;
    TenantProof {
        required,
        proven: required && !predicates.is_empty() && missing.is_empty(),
        tenant_sources,
        predicates,
        missing,
    }
}

fn authorization_guard_proof(
    fact: &Fact,
    dominates_sinks: bool,
) -> Option<AuthorizationGuardProof> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    Some(AuthorizationGuardProof {
        fact_id: fact_id(fact),
        policy_id: value
            .get("policy_id")
            .and_then(|policy| policy.as_str())
            .or_else(|| value.get("guard_id").and_then(|guard| guard.as_str()))
            .map(str::to_string),
        roles: string_array(value.get("roles")),
        permissions: string_array(value.get("permissions")),
        resource_var: value
            .get("resource_var")
            .and_then(|resource| resource.as_str())
            .map(str::to_string),
        subject_var: value
            .get("subject_var")
            .and_then(|subject| subject.as_str())
            .map(str::to_string),
        dominates_sinks,
    })
}

fn authorization_guard_dominates(
    guard: &Fact,
    facts: &[Fact],
    source: &str,
    phase4_policy: &Phase4SecurityPolicy,
) -> bool {
    let data_operations = facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::DataOperationDetected)
        .filter(|fact| data_operation_matches_policy(fact, phase4_policy))
        .collect::<Vec<_>>();
    if data_operations.is_empty()
        || data_operations
            .iter()
            .any(|operation| guard.start_line > operation.start_line)
    {
        return false;
    }
    !authorization_guard_is_one_branch_only(guard, &data_operations, source)
}

fn data_operation_matches_policy(fact: &Fact, phase4_policy: &Phase4SecurityPolicy) -> bool {
    if phase4_policy.data_operations.is_empty() {
        return true;
    }
    let operation_kind = fact
        .imported_name
        .as_deref()
        .and_then(|metadata| metadata.split_once(':').map(|(kind, _)| kind))
        .unwrap_or("unknown");
    let receiver_operation = fact
        .value
        .as_deref()
        .map(|receiver| format!("{receiver}.{}", fact.name));
    phase4_policy.data_operations.iter().any(|accepted| {
        accepted == &fact.name
            || accepted == operation_kind
            || receiver_operation.as_deref() == Some(accepted.as_str())
    })
}

fn authorization_guard_is_one_branch_only(
    guard: &Fact,
    data_operations: &[&Fact],
    source: &str,
) -> bool {
    let lines = source.lines().collect::<Vec<_>>();
    let guard_index = guard.start_line.saturating_sub(1);
    let Some(if_line_index) = lines
        .iter()
        .enumerate()
        .take(guard_index.saturating_add(1))
        .rev()
        .take(4)
        .find(|(_, line)| line.contains("if") && line.contains('{'))
        .map(|(index, _)| index)
    else {
        return false;
    };
    let block_end =
        closing_block_line_for_source(&lines, if_line_index + 1).unwrap_or(if_line_index + 1);
    let has_else = lines
        .iter()
        .skip(block_end)
        .take(2)
        .any(|line| line.contains("else"));
    !has_else
        && data_operations
            .iter()
            .any(|operation| operation.start_line > block_end)
}

fn closing_block_line_for_source(lines: &[&str], start_line: usize) -> Option<usize> {
    let mut depth = 0_i32;
    let mut saw_open = false;
    for (index, line) in lines.iter().enumerate().skip(start_line.saturating_sub(1)) {
        for character in line.chars() {
            match character {
                '{' => {
                    depth += 1;
                    saw_open = true;
                }
                '}' if saw_open => {
                    depth -= 1;
                    if depth <= 0 {
                        return Some(index + 1);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

fn tenant_source_proof(fact: &Fact) -> Option<TenantSourceProof> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    Some(TenantSourceProof {
        fact_id: fact_id(fact),
        source: value.get("source")?.as_str()?.to_string(),
        key: value
            .get("tenant_key")
            .and_then(|key| key.as_str())
            .map(str::to_string),
        trusted: value
            .get("trusted")
            .and_then(|trusted| trusted.as_bool())
            .unwrap_or(false),
        variable: value.get("variable")?.as_str()?.to_string(),
    })
}

fn tenant_predicate_proof(fact: &Fact, data_operations: &[&Fact]) -> Option<TenantPredicateProof> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    let predicate_kind = value.get("predicate_kind")?.as_str()?.to_string();
    let data_operation_fact_id = data_operations
        .iter()
        .find(|operation| operation.start_line == fact.start_line)
        .or_else(|| data_operations.first())
        .map(|operation| fact_id(operation))
        .unwrap_or_else(|| {
            format!(
                "fact:{}:tenant_scope_helper:{}",
                fact.file_path, fact.start_line
            )
        });
    Some(TenantPredicateProof {
        fact_id: fact_id(fact),
        data_operation_fact_id,
        tenant_key: value.get("tenant_key")?.as_str()?.to_string(),
        predicate_kind,
    })
}

fn subject_uses_trusted_session(subject: &str, session_trust: &SessionTrustProof) -> bool {
    session_trust.trusted_sessions.iter().any(|session| {
        subject == session.variable || subject.starts_with(&format!("{}.", session.variable))
    })
}

fn string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn build_session_trust_proof_from_facts(facts: &[Fact]) -> SessionTrustProof {
    let mut trusted_sessions = Vec::new();
    let mut missing_trust = Vec::new();
    for fact in facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::SessionRead)
    {
        let Some(value) = fact
            .value
            .as_deref()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        else {
            continue;
        };
        let variable = value
            .get("variable")
            .and_then(|variable| variable.as_str())
            .unwrap_or(&fact.name)
            .to_string();
        match (
            value.get("source").and_then(|source| source.as_str()),
            value.get("trust").and_then(|trust| trust.as_str()),
        ) {
            (Some("auth_result"), Some("unknown")) => {
                trusted_sessions.push(SessionTrustBoundaryProof {
                    fact_id: fact_id(fact),
                    variable,
                    trust: "trusted".to_string(),
                    derived_from: "auth_guard".to_string(),
                });
            }
            (source, Some("untrusted")) => {
                missing_trust.push(SessionMissingTrustProof {
                    fact_id: fact_id(fact),
                    variable,
                    // PROOF-level vocabulary, NOT the finding-level code a user sees. The
                    // finding-level `session_not_trusted` is derived from this by the
                    // phase4 finding-reason mapper in check_command.rs.
                    reason: if source == Some("unknown_helper") {
                        SessionTrustReason::UnknownHelper
                    } else {
                        SessionTrustReason::DerivedFromRequest
                    },
                });
            }
            _ => {}
        }
    }
    let required = !trusted_sessions.is_empty() || !missing_trust.is_empty();
    SessionTrustProof {
        required,
        proven: required && !trusted_sessions.is_empty() && missing_trust.is_empty(),
        trusted_sessions,
        missing_trust,
    }
}

struct SensitiveFieldValue {
    field_path: String,
    source: String,
}

struct ResponseFieldValue {
    fact_id: String,
    route_id: String,
    field_path: String,
    source_var: Option<String>,
    source_expr: Option<String>,
}

struct SerializerValue {
    route_id: String,
    output_var: Option<String>,
    filtered_fields: Vec<String>,
}

struct SecretReadValue {
    fact_id: String,
    line: usize,
    variable: Option<String>,
    secret_class: String,
}

struct SecretExposureCandidate {
    secret_fact_id: String,
    secret_class: String,
    sink_kind: String,
    sink_line: usize,
}

fn sensitive_field_declared_value(fact: &Fact) -> Option<SensitiveFieldValue> {
    let value: Value = serde_json::from_str(fact.value.as_deref()?).ok()?;
    Some(SensitiveFieldValue {
        field_path: value.get("field_path")?.as_str()?.to_string(),
        source: value.get("source")?.as_str()?.to_string(),
    })
}

fn response_emits_field_value(fact: &Fact) -> Option<ResponseFieldValue> {
    let value: Value = serde_json::from_str(fact.value.as_deref()?).ok()?;
    Some(ResponseFieldValue {
        fact_id: format!("fact:{}:{}", fact.file_path, fact.start_line),
        route_id: value.get("route_id")?.as_str()?.to_string(),
        field_path: value.get("field_path")?.as_str()?.to_string(),
        source_var: value
            .get("source_var")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        source_expr: value
            .get("source_expr")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn serializer_called_value(fact: &Fact) -> Option<SerializerValue> {
    let value: Value = serde_json::from_str(fact.value.as_deref()?).ok()?;
    Some(SerializerValue {
        route_id: value.get("route_id")?.as_str()?.to_string(),
        output_var: value
            .get("output_var")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        filtered_fields: value
            .get("filtered_fields")?
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect(),
    })
}

fn serializer_proves_response_field(
    serializer: &SerializerValue,
    response_field: &ResponseFieldValue,
) -> bool {
    if serializer.route_id != response_field.route_id
        || !serializer
            .filtered_fields
            .contains(&response_field.field_path)
    {
        return false;
    }
    let Some(output_var) = serializer.output_var.as_deref() else {
        return false;
    };
    response_field.source_var.as_deref() == Some(output_var)
        || response_field
            .source_expr
            .as_deref()
            .is_some_and(|expr| expr == output_var || expr.starts_with(&format!("{output_var}.")))
}

fn secret_read_value(fact: &Fact, source: &str) -> Option<SecretReadValue> {
    let value: Value = serde_json::from_str(fact.value.as_deref()?).ok()?;
    let line = source.lines().nth(fact.start_line.saturating_sub(1));
    Some(SecretReadValue {
        fact_id: format!("fact:{}:{}", fact.file_path, fact.start_line),
        line: fact.start_line,
        variable: line.and_then(assigned_variable),
        secret_class: value.get("secret_class")?.as_str()?.to_string(),
    })
}

fn response_shape_parser_gaps(file_path: &str, source: &str) -> Vec<SecurityParserGap> {
    let lines = source.lines().collect::<Vec<_>>();
    let spread_variables = response_spread_variables(&lines);
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            (line.contains("Response.json(")
                || line.contains("NextResponse.json(")
                || line.contains(".json("))
                && (line.contains("...")
                    || spread_variables
                        .iter()
                        .any(|variable| line_uses_identifier(line, variable)))
        })
        .map(|(index, _)| SecurityParserGap {
            parser_gap_id: format!(
                "parser_gap:{}:{}:unsupported_destructuring_or_spread",
                file_path,
                index + 1
            ),
            code: SecurityParserGapCode::UnsupportedDestructuringOrSpread,
            file_path: file_path.to_string(),
            reason: "Dynamic response spread prevents deterministic response-shape proof"
                .to_string(),
            blocks_enforcement: true,
        })
        .collect()
}

fn response_spread_variables(lines: &[&str]) -> Vec<String> {
    lines
        .iter()
        .filter(|line| line.contains("..."))
        .filter_map(|line| assigned_variable(line))
        .collect()
}

fn secret_sink_exposures(
    source: &str,
    secret_reads: &[SecretReadValue],
    log_sinks: &[String],
) -> Vec<SecretExposureCandidate> {
    let lines = source.lines().collect::<Vec<_>>();
    let mut tainted = secret_reads
        .iter()
        .filter_map(|secret| {
            secret.variable.as_ref().map(|variable| {
                (
                    variable.clone(),
                    secret.fact_id.clone(),
                    secret.secret_class.clone(),
                )
            })
        })
        .collect::<Vec<_>>();

    let mut changed = true;
    while changed {
        changed = false;
        for line in &lines {
            let Some(assigned) = assigned_variable(line) else {
                continue;
            };
            if tainted.iter().any(|(variable, _, _)| variable == &assigned) {
                continue;
            }
            if let Some((_, fact_id, secret_class)) = tainted
                .iter()
                .find(|(variable, _, _)| line_uses_identifier(line, variable))
            {
                tainted.push((assigned, fact_id.clone(), secret_class.clone()));
                changed = true;
            }
        }
    }

    let mut exposures = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        let sink_kind = if is_response_sink_line(line) {
            Some("response")
        } else if log_sinks.iter().any(|sink| line.contains(sink)) {
            Some("log")
        } else {
            None
        };
        let Some(sink_kind) = sink_kind else {
            continue;
        };
        if let Some(secret) = secret_reads
            .iter()
            .find(|secret| secret.line == line_number)
        {
            exposures.push(SecretExposureCandidate {
                secret_fact_id: secret.fact_id.clone(),
                secret_class: secret.secret_class.clone(),
                sink_kind: sink_kind.to_string(),
                sink_line: line_number,
            });
        }
        for (variable, fact_id, secret_class) in &tainted {
            if line_uses_identifier(line, variable) {
                exposures.push(SecretExposureCandidate {
                    secret_fact_id: fact_id.clone(),
                    secret_class: secret_class.clone(),
                    sink_kind: sink_kind.to_string(),
                    sink_line: line_number,
                });
            }
        }
    }
    exposures.sort_by(|left, right| {
        (
            left.secret_fact_id.as_str(),
            left.sink_kind.as_str(),
            left.sink_line,
        )
            .cmp(&(
                right.secret_fact_id.as_str(),
                right.sink_kind.as_str(),
                right.sink_line,
            ))
    });
    exposures.dedup_by(|left, right| {
        left.secret_fact_id == right.secret_fact_id
            && left.sink_kind == right.sink_kind
            && left.sink_line == right.sink_line
    });
    exposures
}

fn is_response_sink_line(line: &str) -> bool {
    line.contains("Response.json(")
        || line.contains("NextResponse.json(")
        || line.contains(".json(")
}

fn file_path_string(facts: &[Fact]) -> String {
    facts
        .first()
        .map(|fact| fact.file_path.clone())
        .unwrap_or_else(|| "unknown".to_string())
}

fn request_input_parser_gaps(
    file_path: &str,
    lines: &[&str],
    input_reads: &[RequestInputReadProof],
) -> Vec<SecurityParserGap> {
    let mut gaps = Vec::new();
    for input in input_reads {
        for (index, line) in lines.iter().enumerate() {
            let spread_marker = format!("...{}", input.variable);
            if line.contains(&spread_marker) {
                gaps.push(SecurityParserGap {
                    parser_gap_id: format!(
                        "parser_gap:{}:{}:unsupported_request_input_spread",
                        file_path,
                        index + 1
                    ),
                    code: SecurityParserGapCode::UnsupportedRequestInputSpread,
                    file_path: file_path.to_string(),
                    reason:
                        "Object spread from request input prevents deterministic validation proof"
                            .to_string(),
                    blocks_enforcement: true,
                });
            }
            let destructure_marker = format!("}} = {}", input.variable);
            if line.contains('{') && line.contains(&destructure_marker) {
                gaps.push(SecurityParserGap {
                    parser_gap_id: format!(
                        "parser_gap:{}:{}:unsupported_request_input_destructure",
                        file_path,
                        index + 1
                    ),
                    code: SecurityParserGapCode::UnsupportedRequestInputDestructure,
                    file_path: file_path.to_string(),
                    reason:
                        "Destructuring from request input prevents deterministic validation proof"
                            .to_string(),
                    blocks_enforcement: true,
                });
            }
        }
    }
    gaps
}

impl RequestValidationProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            input_reads: Vec::new(),
            validations: Vec::new(),
            validated_uses: Vec::new(),
            unvalidated_uses: Vec::new(),
        }
    }
}

impl ResponseShapeProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            sensitive_leaks: Vec::new(),
        }
    }
}

impl SecretExposureProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            exposed_secrets: Vec::new(),
        }
    }
}

impl SessionTrustProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            trusted_sessions: Vec::new(),
            missing_trust: Vec::new(),
        }
    }
}

impl AuthorizationProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            role_or_policy_guards: Vec::new(),
            missing: Vec::new(),
        }
    }
}

impl TenantProof {
    fn not_required() -> Self {
        Self {
            required: false,
            proven: false,
            tenant_sources: Vec::new(),
            predicates: Vec::new(),
            missing: Vec::new(),
        }
    }
}

fn request_unvalidated_uses(
    facts: &[Fact],
    lines: &[&str],
    input_reads: &[RequestInputReadProof],
    validations: &[RequestValidationCallProof],
    validated_uses: &[RequestValidatedUseProof],
    allowed_sink_kinds: &[String],
) -> Vec<RequestUnvalidatedUseProof> {
    let mut uses = Vec::new();
    for input in input_reads {
        uses.extend(unknown_validator_uses(
            facts,
            lines,
            input,
            allowed_sink_kinds,
        ));
        for sink in protected_sinks(facts) {
            if !allowed_sink_kinds.is_empty()
                && !allowed_sink_kinds
                    .iter()
                    .any(|kind| kind == sink_kind(sink))
            {
                continue;
            }
            if sink.start_line <= input_line_from_fact_id(&input.fact_id) {
                continue;
            }
            let sink_text = source_text_for_sink(lines, sink);
            let sink_fact_id = sink_id(sink);
            let validated = validated_uses.iter().any(|validated| {
                validated.source_input_var == input.variable
                    && validated.sink_fact_id == sink_fact_id
            });
            let raw_input_validated = validated_uses.iter().any(|validated| {
                validated.source_input_var == input.variable
                    && validated.validated_var == input.variable
                    && validated.sink_fact_id == sink_fact_id
            });
            if validation_result_used_without_validated_use(
                validations,
                &input.variable,
                &sink_text,
                validated,
            ) {
                uses.push(RequestUnvalidatedUseProof {
                    input_fact_id: input.fact_id.clone(),
                    sink_fact_id,
                    sink_kind: sink_kind(sink).to_string(),
                    reason: RequestUnvalidatedReason::ValidationResultNotUsed,
                });
                continue;
            }
            if !line_uses_identifier(&sink_text, &input.variable) {
                continue;
            }
            if !raw_input_validated {
                uses.push(RequestUnvalidatedUseProof {
                    input_fact_id: input.fact_id.clone(),
                    sink_fact_id,
                    sink_kind: sink_kind(sink).to_string(),
                    reason: RequestUnvalidatedReason::RequestInputNotValidated,
                });
            }
        }
    }
    uses
}

fn validation_result_used_without_validated_use(
    validations: &[RequestValidationCallProof],
    input_var: &str,
    sink_text: &str,
    validated: bool,
) -> bool {
    !validated
        && validations.iter().any(|validation| {
            validation.input_var.as_deref() == Some(input_var)
                && validation
                    .result_var
                    .as_deref()
                    .is_some_and(|result_var| line_uses_identifier(sink_text, result_var))
        })
}

fn unknown_validator_uses(
    facts: &[Fact],
    lines: &[&str],
    input: &RequestInputReadProof,
    allowed_sink_kinds: &[String],
) -> Vec<RequestUnvalidatedUseProof> {
    let input_line = input_line_from_fact_id(&input.fact_id);
    let mut uses = Vec::new();
    for call in facts
        .iter()
        .filter(|fact| fact.kind == crate::FactKind::SymbolCalled)
        .filter(|fact| fact.start_line > input_line)
        .filter(|fact| {
            fact.name.starts_with("validate")
                || fact
                    .value
                    .as_deref()
                    .is_some_and(|receiver| receiver.ends_with("Schema"))
        })
    {
        if facts.iter().any(|fact| {
            fact.kind == crate::FactKind::RequestValidationCalled
                && fact.start_line == call.start_line
                && fact.name == call.name
        }) {
            continue;
        }
        let Some(call_line) = lines.get(call.start_line.saturating_sub(1)) else {
            continue;
        };
        if !line_uses_identifier(call_line, &input.variable) {
            continue;
        }
        let Some(result_var) = assigned_variable(call_line) else {
            continue;
        };
        for sink in protected_sinks(facts)
            .into_iter()
            .filter(|sink| sink.start_line > call.start_line)
            .filter(|sink| {
                allowed_sink_kinds.is_empty()
                    || allowed_sink_kinds
                        .iter()
                        .any(|kind| kind == sink_kind(sink))
            })
        {
            let sink_text = source_text_for_sink(lines, sink);
            if line_uses_identifier(&sink_text, &result_var) {
                uses.push(RequestUnvalidatedUseProof {
                    input_fact_id: input.fact_id.clone(),
                    sink_fact_id: sink_id(sink),
                    sink_kind: sink_kind(sink).to_string(),
                    reason: RequestUnvalidatedReason::UnknownValidator,
                });
            }
        }
    }
    uses
}

fn source_text_for_sink(lines: &[&str], sink: &Fact) -> String {
    let start_line = sink.start_line;
    let end_line = if sink.kind == crate::FactKind::RouteReturnsResponse {
        sink.start_line
    } else {
        sink.end_line
    };
    if start_line == 0 {
        return String::new();
    }
    lines
        .iter()
        .skip(start_line.saturating_sub(1))
        .take(end_line.saturating_sub(start_line).saturating_add(1))
        .copied()
        .collect::<Vec<_>>()
        .join("\n")
}

fn assigned_variable(line: &str) -> Option<String> {
    let before_equals = line.split_once('=')?.0.trim();
    let variable = before_equals
        .strip_prefix("const ")
        .or_else(|| before_equals.strip_prefix("let "))
        .or_else(|| before_equals.strip_prefix("var "))
        .unwrap_or(before_equals)
        .trim();
    (!variable.is_empty()
        && variable.chars().all(|character| {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        }))
    .then(|| variable.to_string())
}

fn request_input_read_proof(fact: &Fact) -> Option<RequestInputReadProof> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    Some(RequestInputReadProof {
        fact_id: fact_id(fact),
        source: value.get("source")?.as_str()?.to_string(),
        variable: value.get("variable")?.as_str()?.to_string(),
        key: value
            .get("key")
            .and_then(|key| key.as_str())
            .map(str::to_string),
    })
}

fn request_validation_call_proof(fact: &Fact) -> Option<RequestValidationCallProof> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    Some(RequestValidationCallProof {
        fact_id: fact_id(fact),
        validator_symbol: value.get("validator_symbol")?.as_str()?.to_string(),
        schema_symbol: value
            .get("schema_symbol")
            .and_then(|symbol| symbol.as_str())
            .map(str::to_string),
        input_var: value
            .get("input_var")
            .and_then(|symbol| symbol.as_str())
            .map(str::to_string),
        result_var: value
            .get("result_var")
            .and_then(|symbol| symbol.as_str())
            .map(str::to_string),
    })
}

fn request_validated_use_proof(fact: &Fact) -> Option<RequestValidatedUseProof> {
    let value = serde_json::from_str::<serde_json::Value>(fact.value.as_deref()?).ok()?;
    Some(RequestValidatedUseProof {
        fact_id: fact_id(fact),
        source_input_var: value.get("source_input_var")?.as_str()?.to_string(),
        validated_var: value.get("validated_var")?.as_str()?.to_string(),
        sink_fact_id: value.get("sink_fact_id")?.as_str()?.to_string(),
        sink_kind: value.get("sink_kind")?.as_str()?.to_string(),
    })
}

fn input_line_from_fact_id(fact_id: &str) -> usize {
    fact_id
        .rsplit(':')
        .next()
        .and_then(|line| line.parse::<usize>().ok())
        .unwrap_or(0)
}

fn line_uses_identifier(line: &str, identifier: &str) -> bool {
    line.split(|character: char| {
        character != '_' && character != '$' && !character.is_ascii_alphanumeric()
    })
    .any(|token| token == identifier)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// S1-02: a unit-level guard on the proof builder itself.
    ///
    /// The end-to-end test in tests/security_check_repo_phase4.rs pins the same
    /// invariant, but this one fails in milliseconds and names the cause directly:
    /// `missing_trust[].reason` is PROOF-level vocabulary, and an unrecognized helper
    /// is `unknown_helper` -- never the finding-level `session_not_trusted`.
    ///
    /// Verified non-vacuous: reverting the emission site to
    /// `SessionTrustReason::DerivedFromRequest` fails this test with
    /// left: DerivedFromRequest, right: UnknownHelper. Since S2-02 the ORIGINAL
    /// regression - writing the finding-level `session_not_trusted` here - can no longer
    /// be expressed: it is not a member of the enum, so it does not compile.
    #[test]
    fn unknown_helper_source_maps_to_unknown_helper_reason() {
        let source = concat!(
            "export async function GET(request: Request) {\n",
            "  const session = await getSession(request);\n",
            "  return Response.json({ ok: Boolean(session) });\n",
            "}\n"
        );

        let proof = build_phase4_security_proof("app/api/x/route.ts", source, &[]).expect("proof");

        let missing = proof
            .session_trust
            .missing_trust
            .first()
            .expect("an unrecognized session helper must produce a missing_trust entry");
        assert_eq!(missing.reason, SessionTrustReason::UnknownHelper);
    }
}

#[cfg(test)]
mod reason_ordering_tests {
    use super::*;

    /// Typing these fields changed how they SORT, which changed what a user is told.
    ///
    /// While `reason` was a `String` these lists sorted lexicographically by wire value.
    /// Deriving `Ord` on the generated enum orders by position in
    /// vocabulary/vocabulary.json instead. Consumers read `.first()` --
    /// `phase4_missing_code` for a finding's missing_code, `security_rules.rs` for its
    /// `actual_layer` -- so the two orders disagreeing silently changes which of several
    /// true reasons gets shown.
    ///
    /// `session_not_trusted` is declared BEFORE `authorization_guard_not_dominating_sink`
    /// and sorts AFTER it as a string, so a route carrying both flips on the enum order.
    /// Nothing else pins this: every affected sort is textually unchanged by the typing,
    /// and the whole engine suite stayed green while the output moved.
    #[test]
    fn authorization_reasons_sort_by_wire_string_not_declaration_order() {
        let mut missing = [
            AuthorizationMissingProof {
                reason: AuthorizationMissingReason::SessionNotTrusted,
                sink_fact_id: Some("sink:1".to_string()),
            },
            AuthorizationMissingProof {
                reason: AuthorizationMissingReason::AuthorizationGuardNotDominatingSink,
                sink_fact_id: Some("sink:1".to_string()),
            },
        ];
        missing.sort_by(|left, right| {
            (left.reason.as_wire(), &left.sink_fact_id)
                .cmp(&(right.reason.as_wire(), &right.sink_fact_id))
        });

        assert_eq!(
            missing
                .iter()
                .map(|entry| entry.reason.as_wire())
                .collect::<Vec<_>>(),
            [
                "authorization_guard_not_dominating_sink",
                "session_not_trusted"
            ],
            "sorted on the enum's derived Ord instead of the wire string"
        );

        // The two orders genuinely disagree -- if they ever agree this test is vacuous.
        assert!(
            AuthorizationMissingReason::SessionNotTrusted
                < AuthorizationMissingReason::AuthorizationGuardNotDominatingSink,
            "declaration order no longer differs; this test has stopped proving anything"
        );
    }
}
