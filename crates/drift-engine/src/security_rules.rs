use crate::{
    AcceptedAuthHelper, AcceptedAuthorizationHelper, AcceptedPhase5Contract,
    AcceptedRequestValidator, AcceptedTenantHelper, AuthorizationHelperBehavior,
    AuthorizationHelperKind, Fact, FactExtractError, FactKind, Phase4SecurityPolicy,
    RequestValidationProofScope, SecurityProofStatus, build_auth_boundary_proof,
    build_middleware_coverage_proof, build_phase4_security_proof_with_policy,
    build_request_validation_proof_with_scope, build_response_shape_proof,
    build_secret_exposure_proof, extract_security_facts_with_validation, extract_typescript_facts,
    next_routes::next_api_route_identity,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityAuthContract {
    pub contract_id: String,
    pub enforcement_mode: SecurityEnforcementMode,
    pub accepted_auth_helpers: Vec<AcceptedAuthHelper>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityMiddlewareContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub route_paths: Vec<String>,
    pub methods: Vec<String>,
    pub accepted_auth_helpers: Vec<AcceptedAuthHelper>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityRequestValidationContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub methods: Vec<String>,
    pub input_sources: Vec<String>,
    pub sinks: Vec<String>,
    pub accepted_validators: Vec<AcceptedRequestValidator>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityTenantScopeContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub accepted_auth_helpers: Vec<AcceptedAuthHelper>,
    pub tenant_helpers: Vec<String>,
    pub tenant_keys: Vec<String>,
    pub tenant_sources: Vec<String>,
    pub data_operations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityAuthorizationContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub accepted_auth_helpers: Vec<AcceptedAuthHelper>,
    pub authorization_helpers: Vec<String>,
    pub data_operations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityPhase5Contract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub methods: Vec<String>,
    pub path_globs: Vec<String>,
    pub accepted_phase5: AcceptedPhase5Contract,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecuritySsrfContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub accepted_allowlist_helpers: Vec<AcceptedOutboundUrlHelper>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityRawSqlContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityCsrfContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub accepted_csrf_helpers: Vec<AcceptedSecurityHelper>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityRateLimitContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub accepted_rate_limit_helpers: Vec<AcceptedSecurityHelper>,
    pub route_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityCorsContract {
    pub contract_id: String,
    pub capability: SecurityContractCapability,
    pub enforcement_mode: SecurityEnforcementMode,
    pub allowed_origins: Vec<String>,
    pub allow_credentials: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedSecurityHelper {
    pub helper_id: String,
    pub module: String,
    pub symbol: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedOutboundUrlHelper {
    pub helper_id: String,
    pub module: String,
    pub symbol: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityContractCapability {
    BriefingOnly,
    HeuristicCheck,
    DeterministicCheck,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityEnforcementMode {
    Off,
    Brief,
    Warn,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityFindingResult {
    Brief,
    Warn,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityFinding {
    pub contract_id: String,
    pub title: String,
    pub expected_layer: String,
    pub actual_layer: String,
    pub enforcement_result: SecurityFindingResult,
    pub drift_category: String,
    pub confidence_label: String,
}

pub fn evaluate_api_route_requires_auth_helper(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityAuthContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.accepted_auth_helpers.is_empty()
    {
        return Ok(Vec::new());
    }

    let proof = build_auth_boundary_proof(file_path, source, &contract.accepted_auth_helpers)?;
    if proof.result.proof_status == SecurityProofStatus::Proven {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route missing required auth proof".to_string(),
        expected_layer: "auth_guard".to_string(),
        actual_layer: normalize_auth_actual_layer(
            &proof
                .auth
                .undominated_sinks
                .first()
                .cloned()
                .unwrap_or_else(|| "missing_auth_guard".to_string()),
        ),
        enforcement_result: match contract.enforcement_mode {
            SecurityEnforcementMode::Brief => SecurityFindingResult::Brief,
            SecurityEnforcementMode::Warn => SecurityFindingResult::Warn,
            SecurityEnforcementMode::Block => SecurityFindingResult::Block,
            SecurityEnforcementMode::Off => return Ok(Vec::new()),
        },
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_requires_auth_helper_with_middleware(
    route_file_path: impl AsRef<std::path::Path>,
    route_source: &str,
    middleware_file_path: impl AsRef<std::path::Path>,
    middleware_source: &str,
    contract: &SecurityAuthContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.accepted_auth_helpers.is_empty()
    {
        return Ok(Vec::new());
    }
    let middleware_proof = build_middleware_coverage_proof(
        middleware_file_path,
        middleware_source,
        route_file_path.as_ref(),
        route_source,
        &contract.accepted_auth_helpers,
    )?;
    if middleware_proof.result.proof_status == SecurityProofStatus::Proven
        && middleware_proof.middleware.proven
    {
        return Ok(Vec::new());
    }
    evaluate_api_route_requires_auth_helper(route_file_path, route_source, contract)
}

fn normalize_auth_actual_layer(reason: &str) -> String {
    if reason == "no_guard_call" {
        "missing_auth_guard".to_string()
    } else {
        reason.to_string()
    }
}

pub fn evaluate_middleware_must_cover_routes(
    middleware_file_path: impl AsRef<std::path::Path>,
    middleware_source: &str,
    route_file_path: impl AsRef<std::path::Path>,
    route_source: &str,
    contract: &SecurityMiddlewareContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
        || contract.accepted_auth_helpers.is_empty()
    {
        return Ok(Vec::new());
    }
    let route_file_path_string = route_file_path
        .as_ref()
        .to_string_lossy()
        .replace('\\', "/");
    if !contract.route_paths.is_empty()
        && route_path_from_file(&route_file_path_string)
            .is_none_or(|route_path| !contract.route_paths.contains(&route_path))
    {
        return Ok(Vec::new());
    }

    let proof = build_middleware_coverage_proof(
        middleware_file_path,
        middleware_source,
        route_file_path,
        route_source,
        &contract.accepted_auth_helpers,
    )?;
    if proof.result.proof_status == SecurityProofStatus::Proven {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "Middleware does not cover required route".to_string(),
        expected_layer: "middleware_coverage".to_string(),
        actual_layer: proof
            .middleware
            .mismatches
            .first()
            .map(|mismatch| mismatch.reason.clone())
            .unwrap_or_else(|| "middleware_not_covering_route".to_string()),
        enforcement_result: match contract.enforcement_mode {
            SecurityEnforcementMode::Brief => SecurityFindingResult::Brief,
            SecurityEnforcementMode::Warn => SecurityFindingResult::Warn,
            SecurityEnforcementMode::Block => SecurityFindingResult::Block,
            SecurityEnforcementMode::Off => return Ok(Vec::new()),
        },
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_requires_request_validation(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityRequestValidationContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
        || contract.accepted_validators.is_empty()
    {
        return Ok(Vec::new());
    }
    if !contract.methods.is_empty() {
        let route_method = first_route_method(source);
        if route_method
            .is_none_or(|method| !contract.methods.iter().any(|allowed| allowed == &method))
        {
            return Ok(Vec::new());
        }
    }

    let proof = build_request_validation_proof_with_scope(
        file_path,
        source,
        &contract.accepted_validators,
        &RequestValidationProofScope {
            input_sources: contract.input_sources.clone(),
            sink_kinds: contract.sinks.clone(),
        },
    )?;
    if proof.result.proof_status == SecurityProofStatus::Proven {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route uses unvalidated request input".to_string(),
        expected_layer: "request_validation".to_string(),
        actual_layer: proof
            .request_validation
            .unvalidated_uses
            .first()
            .map(|use_proof| use_proof.reason.clone())
            .unwrap_or_else(|| "request_input_not_validated".to_string()),
        enforcement_result: match contract.enforcement_mode {
            SecurityEnforcementMode::Brief => SecurityFindingResult::Brief,
            SecurityEnforcementMode::Warn => SecurityFindingResult::Warn,
            SecurityEnforcementMode::Block => SecurityFindingResult::Block,
            SecurityEnforcementMode::Off => return Ok(Vec::new()),
        },
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_forbids_untrusted_ssrf(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecuritySsrfContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
    {
        return Ok(Vec::new());
    }
    let proof = build_request_validation_proof_with_scope(
        &file_path,
        source,
        &[],
        &RequestValidationProofScope {
            input_sources: Vec::new(),
            sink_kinds: vec!["outbound_request".to_string()],
        },
    )?;
    if proof.result.proof_status == SecurityProofStatus::Proven {
        return Ok(Vec::new());
    }
    if ssrf_allowlist_proves_outbound_urls(file_path.as_ref(), source, contract)? {
        return Ok(Vec::new());
    }
    if !proof
        .request_validation
        .unvalidated_uses
        .iter()
        .any(|use_proof| use_proof.sink_kind == "outbound_request")
    {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route allows request-controlled outbound URL".to_string(),
        expected_layer: "outbound_request".to_string(),
        actual_layer: "request_controlled_url".to_string(),
        enforcement_result: finding_result(contract.enforcement_mode)?,
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_forbids_raw_sql_without_params(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityRawSqlContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
    {
        return Ok(Vec::new());
    }
    let proof = build_request_validation_proof_with_scope(
        &file_path,
        source,
        &[],
        &RequestValidationProofScope {
            input_sources: Vec::new(),
            sink_kinds: vec!["raw_sql".to_string()],
        },
    )?;
    if proof.result.proof_status == SecurityProofStatus::Proven
        || parameterized_sql_proves_raw_sql(file_path.as_ref(), source)?
    {
        return Ok(Vec::new());
    }
    if !proof
        .request_validation
        .unvalidated_uses
        .iter()
        .any(|use_proof| use_proof.sink_kind == "raw_sql")
    {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route uses raw SQL without parameterization".to_string(),
        expected_layer: "raw_sql".to_string(),
        actual_layer: "raw_sql_unparameterized".to_string(),
        enforcement_result: finding_result(contract.enforcement_mode)?,
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_requires_csrf_for_mutation(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityCsrfContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
        || !is_mutation_method(source)
        || accepted_helper_called(file_path.as_ref(), source, &contract.accepted_csrf_helpers)?
    {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "Mutation route missing CSRF proof".to_string(),
        expected_layer: "csrf_guard".to_string(),
        actual_layer: "missing_csrf_guard".to_string(),
        enforcement_result: finding_result(contract.enforcement_mode)?,
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_requires_rate_limit(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityRateLimitContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
        || !rate_limit_contract_matches_route(file_path.as_ref(), contract)
        || accepted_helper_called(
            file_path.as_ref(),
            source,
            &contract.accepted_rate_limit_helpers,
        )?
    {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "Route missing rate limit proof".to_string(),
        expected_layer: "rate_limit_guard".to_string(),
        actual_layer: "missing_rate_limit_guard".to_string(),
        enforcement_result: finding_result(contract.enforcement_mode)?,
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_cors_must_match_policy(
    _file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityCorsContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
    {
        return Ok(Vec::new());
    }
    let Some(cors_violation) = cors_policy_violation(source, contract) else {
        return Ok(Vec::new());
    };

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "CORS policy violates accepted contract".to_string(),
        expected_layer: "cors_policy".to_string(),
        actual_layer: cors_violation,
        enforcement_result: finding_result(contract.enforcement_mode)?,
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_requires_tenant_scope(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityTenantScopeContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
    {
        return Ok(Vec::new());
    }

    let proof = build_phase4_security_proof_with_policy(
        file_path,
        source,
        &tenant_phase4_policy(contract),
    )?;
    if !proof.tenant.required || proof.tenant.proven {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route missing required tenant scope proof".to_string(),
        expected_layer: "tenant_scope".to_string(),
        actual_layer: proof
            .tenant
            .missing
            .first()
            .map(|missing| missing.reason.clone())
            .unwrap_or_else(|| "tenant_predicate_missing".to_string()),
        enforcement_result: match contract.enforcement_mode {
            SecurityEnforcementMode::Brief => SecurityFindingResult::Brief,
            SecurityEnforcementMode::Warn => SecurityFindingResult::Warn,
            SecurityEnforcementMode::Block => SecurityFindingResult::Block,
            SecurityEnforcementMode::Off => return Ok(Vec::new()),
        },
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_requires_authorization(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityAuthorizationContract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
    {
        return Ok(Vec::new());
    }

    let proof = build_phase4_security_proof_with_policy(
        file_path,
        source,
        &authorization_phase4_policy(contract),
    )?;
    if !proof.authorization.required || proof.authorization.proven {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route missing required authorization proof".to_string(),
        expected_layer: "authorization".to_string(),
        actual_layer: proof
            .authorization
            .missing
            .first()
            .map(|missing| missing.reason.clone())
            .unwrap_or_else(|| "authorization_guard_missing".to_string()),
        enforcement_result: match contract.enforcement_mode {
            SecurityEnforcementMode::Brief => SecurityFindingResult::Brief,
            SecurityEnforcementMode::Warn => SecurityFindingResult::Warn,
            SecurityEnforcementMode::Block => SecurityFindingResult::Block,
            SecurityEnforcementMode::Off => return Ok(Vec::new()),
        },
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_forbids_sensitive_response_fields(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityPhase5Contract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if !phase5_contract_applies(&file_path, source, contract)
        || (contract
            .accepted_phase5
            .sensitive_response_fields
            .is_empty()
            && contract.accepted_phase5.response_serializers.is_empty())
    {
        return Ok(Vec::new());
    }

    let proof = build_response_shape_proof(file_path, source, &contract.accepted_phase5)?;
    if proof.result.proof_status == SecurityProofStatus::Proven {
        return Ok(Vec::new());
    }

    let actual_layer = if !proof.response_shape.sensitive_leaks.is_empty() {
        "sensitive_response_field_unfiltered"
    } else {
        "dynamic_response_shape_missing_proof"
    };

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route emits sensitive response field".to_string(),
        expected_layer: "response_shape".to_string(),
        actual_layer: actual_layer.to_string(),
        enforcement_result: finding_result(contract.enforcement_mode)?,
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

pub fn evaluate_api_route_forbids_secret_exposure(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityPhase5Contract,
) -> Result<Vec<SecurityFinding>, FactExtractError> {
    if !phase5_contract_applies(&file_path, source, contract)
        || contract.accepted_phase5.secret_sources.is_empty()
    {
        return Ok(Vec::new());
    }

    let proof = build_secret_exposure_proof(file_path, source, &contract.accepted_phase5)?;
    if proof.result.proof_status == SecurityProofStatus::Proven {
        return Ok(Vec::new());
    }

    Ok(vec![SecurityFinding {
        contract_id: contract.contract_id.clone(),
        title: "API route exposes secret to response or log sink".to_string(),
        expected_layer: "secret_exposure".to_string(),
        actual_layer: "secret_exposure_not_excluded".to_string(),
        enforcement_result: finding_result(contract.enforcement_mode)?,
        drift_category: "missing_proof".to_string(),
        confidence_label: "certain".to_string(),
    }])
}

fn phase5_contract_applies(
    file_path: impl AsRef<std::path::Path>,
    source: &str,
    contract: &SecurityPhase5Contract,
) -> bool {
    if contract.enforcement_mode == SecurityEnforcementMode::Off
        || contract.capability != SecurityContractCapability::DeterministicCheck
    {
        return false;
    }
    if !contract.methods.is_empty() {
        let route_method = first_route_method(source);
        if route_method
            .is_none_or(|method| !contract.methods.iter().any(|allowed| allowed == &method))
        {
            return false;
        }
    }
    if !contract.path_globs.is_empty() {
        let file_path = file_path.as_ref().to_string_lossy().replace('\\', "/");
        let Some(route_path) = route_path_from_file(&file_path) else {
            return false;
        };
        if !contract
            .path_globs
            .iter()
            .any(|pattern| path_glob_matches(pattern, &route_path))
        {
            return false;
        }
    }
    true
}

fn path_glob_matches(pattern: &str, route_path: &str) -> bool {
    if pattern == route_path {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix("/*") {
        return route_path == prefix || route_path.starts_with(&format!("{prefix}/"));
    }
    false
}

fn finding_result(
    enforcement_mode: SecurityEnforcementMode,
) -> Result<SecurityFindingResult, FactExtractError> {
    match enforcement_mode {
        SecurityEnforcementMode::Brief => Ok(SecurityFindingResult::Brief),
        SecurityEnforcementMode::Warn => Ok(SecurityFindingResult::Warn),
        SecurityEnforcementMode::Block => Ok(SecurityFindingResult::Block),
        SecurityEnforcementMode::Off => unreachable!("off mode is filtered before findings"),
    }
}

fn tenant_phase4_policy(contract: &SecurityTenantScopeContract) -> Phase4SecurityPolicy {
    Phase4SecurityPolicy {
        accepted_auth_helpers: contract.accepted_auth_helpers.clone(),
        tenant_helpers: contract
            .tenant_helpers
            .iter()
            .map(|symbol| AcceptedTenantHelper {
                helper_id: format!("tenant:{symbol}"),
                symbol: symbol.clone(),
                import_source: None,
                tenant_key: contract
                    .tenant_keys
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "tenantId".to_string()),
            })
            .collect(),
        tenant_keys: contract.tenant_keys.clone(),
        tenant_sources: contract.tenant_sources.clone(),
        data_operations: contract.data_operations.clone(),
        ..Phase4SecurityPolicy::default()
    }
}

fn authorization_phase4_policy(contract: &SecurityAuthorizationContract) -> Phase4SecurityPolicy {
    Phase4SecurityPolicy {
        accepted_auth_helpers: contract.accepted_auth_helpers.clone(),
        authorization_helpers: contract
            .authorization_helpers
            .iter()
            .map(|symbol| AcceptedAuthorizationHelper {
                guard_id: format!("authorization:{symbol}"),
                symbol: symbol.clone(),
                import_source: None,
                kind: if symbol.to_ascii_lowercase().contains("role") {
                    AuthorizationHelperKind::Role
                } else {
                    AuthorizationHelperKind::Policy
                },
                behavior: if symbol.to_ascii_lowercase().starts_with("can") {
                    AuthorizationHelperBehavior::Boolean
                } else {
                    AuthorizationHelperBehavior::Throws
                },
            })
            .collect(),
        tenant_keys: Vec::new(),
        data_operations: contract.data_operations.clone(),
        ..Phase4SecurityPolicy::default()
    }
}

fn cors_policy_violation(source: &str, contract: &SecurityCorsContract) -> Option<String> {
    let origin = header_literal(source, "Access-Control-Allow-Origin")?;
    let credentials = header_literal(source, "Access-Control-Allow-Credentials")
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
    if origin == "*" && credentials {
        return Some("wildcard_origin_with_credentials".to_string());
    }
    if !contract.allowed_origins.is_empty() && !contract.allowed_origins.contains(&origin) {
        return Some("disallowed_origin".to_string());
    }
    if credentials && !contract.allow_credentials {
        return Some("credentials_not_allowed".to_string());
    }
    None
}

fn header_literal(source: &str, header: &str) -> Option<String> {
    let header_marker = format!("\"{header}\"");
    source.lines().find_map(|line| {
        if !line.contains(&header_marker) {
            return None;
        }
        let after_colon = line.split_once(':')?.1.trim();
        let quote = after_colon
            .chars()
            .find(|value| *value == '"' || *value == '\'')?;
        let after_quote = after_colon.split_once(quote)?.1;
        let value = after_quote.split_once(quote)?.0.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn rate_limit_contract_matches_route(
    file_path: &std::path::Path,
    contract: &SecurityRateLimitContract,
) -> bool {
    if contract.route_paths.is_empty() {
        return true;
    }
    let file_path = file_path.to_string_lossy().replace('\\', "/");
    route_path_from_file(&file_path)
        .is_some_and(|route_path| contract.route_paths.contains(&route_path))
}

fn is_mutation_method(source: &str) -> bool {
    matches!(
        first_route_method(source).as_deref(),
        Some("POST" | "PUT" | "PATCH" | "DELETE")
    )
}

fn accepted_helper_called(
    file_path: &std::path::Path,
    source: &str,
    helpers: &[AcceptedSecurityHelper],
) -> Result<bool, FactExtractError> {
    if helpers.is_empty() {
        return Ok(false);
    }
    let facts = extract_typescript_facts(file_path, source)?;
    Ok(helpers.iter().any(|helper| {
        let imported = facts.iter().any(|fact| {
            fact.kind == FactKind::ImportUsed
                && fact.name == helper.symbol
                && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
                && fact.value.as_deref() == Some(helper.module.as_str())
        });
        let called = facts
            .iter()
            .any(|fact| fact.kind == FactKind::SymbolCalled && fact.name == helper.symbol);
        imported && called
    }))
}

fn parameterized_sql_proves_raw_sql(
    file_path: &std::path::Path,
    source: &str,
) -> Result<bool, FactExtractError> {
    let security_facts = extract_security_facts_with_validation(file_path, source, &[], &[])?;
    let has_raw_sql = security_facts
        .iter()
        .any(|fact| fact.kind == FactKind::RawSqlCalled);
    let has_parameterized = security_facts
        .iter()
        .any(|fact| fact.kind == FactKind::ParameterizedSqlUsed);
    Ok(!has_raw_sql && has_parameterized)
}

fn ssrf_allowlist_proves_outbound_urls(
    file_path: &std::path::Path,
    source: &str,
    contract: &SecuritySsrfContract,
) -> Result<bool, FactExtractError> {
    if contract.accepted_allowlist_helpers.is_empty() {
        return Ok(false);
    }
    let base_facts = extract_typescript_facts(file_path, source)?;
    let security_facts = extract_security_facts_with_validation(file_path, source, &[], &[])?;
    let imported_helpers = contract
        .accepted_allowlist_helpers
        .iter()
        .filter(|helper| {
            base_facts.iter().any(|fact| {
                fact.kind == FactKind::ImportUsed
                    && fact.name == helper.symbol
                    && fact.imported_name.as_deref() == Some(helper.symbol.as_str())
                    && fact.value.as_deref() == Some(helper.module.as_str())
            })
        })
        .collect::<Vec<_>>();
    if imported_helpers.is_empty() {
        return Ok(false);
    }
    let lines = source.lines().collect::<Vec<_>>();
    let allowed_vars = lines
        .iter()
        .filter_map(|line| {
            let assigned = assigned_variable_for_rule(line)?;
            imported_helpers
                .iter()
                .any(|helper| line.contains(&format!("{}(", helper.symbol)))
                .then_some(assigned)
        })
        .collect::<Vec<_>>();
    if allowed_vars.is_empty() {
        return Ok(false);
    }
    let outbound_facts = security_facts
        .iter()
        .filter(|fact| fact.kind == FactKind::OutboundRequestCalled)
        .collect::<Vec<_>>();
    Ok(!outbound_facts.is_empty()
        && outbound_facts
            .iter()
            .all(|fact| outbound_fact_uses_allowed_var(fact, &allowed_vars)))
}

fn outbound_fact_uses_allowed_var(fact: &Fact, allowed_vars: &[String]) -> bool {
    fact.value
        .as_deref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| {
            value
                .get("url_var")
                .and_then(|url_var| url_var.as_str())
                .map(str::to_string)
        })
        .is_some_and(|url_var| allowed_vars.contains(&url_var))
}

fn assigned_variable_for_rule(line: &str) -> Option<String> {
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

fn first_route_method(source: &str) -> Option<String> {
    source.lines().find_map(|line| {
        let trimmed = line.trim_start();
        let rest = trimmed.strip_prefix("export async function ")?;
        let method = rest.split('(').next()?.trim();
        if method.is_empty() {
            None
        } else {
            Some(method.to_uppercase())
        }
    })
}

fn route_path_from_file(file_path: &str) -> Option<String> {
    next_api_route_identity(file_path).map(|identity| identity.route_path)
}
