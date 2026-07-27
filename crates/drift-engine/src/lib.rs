pub const DRIFT_ENGINE_VERSION: &str = "0.1.0";

mod diff;
mod facts;
pub mod next_routes;
mod rules;
mod security_capabilities;
mod security_control_flow;
mod security_facts;
mod security_patterns;
mod security_phase6;
mod security_proof;
mod security_rules;

use std::{
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

pub use diff::{
    DiffClassifiedFinding, DiffFile, DiffScope, DiffStatus, ParsedDiff,
    classify_findings_against_diff, parse_unified_diff,
};
pub use facts::{Fact, FactExtractError, FactKind, extract_typescript_facts};
pub use rules::{
    BaselineStatus, BaselineViolation, ClassifiedFinding, DirectDataAccessRule,
    DirectDataAccessViolation, EnforcementMode, EnforcementResult, FindingStatus, RuleFinding,
    Severity, classify_findings_against_baseline, detect_direct_data_access_imports,
    materialize_direct_data_access_findings,
};
pub use security_capabilities::{
    SecurityCapabilityStatus, SecurityScanCapability, security_capabilities,
};
pub use security_control_flow::{
    MatchedMiddleware, MiddlewareMismatch, ValidatedInputUse, static_middleware_coverage,
    validated_input_uses,
};
pub use security_facts::extract_security_facts;
pub use security_facts::extract_security_facts_with_phase5;
pub use security_facts::extract_security_facts_with_policy;
pub use security_facts::extract_security_facts_with_validation;
pub use security_patterns::{
    AcceptedAuthHelper, AcceptedAuthorizationHelper, AcceptedHelperImport, AcceptedPhase5Contract,
    AcceptedRequestValidator, AcceptedResponseSerializer, AcceptedSensitiveResponseField,
    AcceptedTenantHelper, AuthGuardBehavior, AuthorizationHelperBehavior, AuthorizationHelperKind,
    Phase4SecurityPolicy, RequestValidatorBehavior, RequestValidatorKind, ResponseSerializerPolicy,
    accepted_phase5_contract_from_requires, accepted_response_serializer_for_call,
    dynamic_middleware_matcher_line,
};
pub use security_phase6::{
    Phase6AcceptedHelper, Phase6CorsContract, Phase6CorsPolicyProof, Phase6CorsProof,
    Phase6GuardProof, Phase6HelperProof, Phase6MissingProof, Phase6OutboundRequestProof,
    Phase6ParameterizedSqlProof, Phase6RawSqlCallProof, Phase6RawSqlContract, Phase6RawSqlProof,
    Phase6SecurityContract, Phase6SecurityProof, Phase6SsrfContract, Phase6SsrfProof,
    Phase6UrlSource, build_phase6_security_proof, build_phase6_security_proofs_for_file,
    phase6_proof_to_json,
};
pub use security_proof::{
    AuthBoundaryProof, AuthorizationGuardProof, AuthorizationMissingProof, AuthorizationProof,
    ExposedSecretProof, MiddlewareBoundaryProof, RequestInputReadProof, RequestUnvalidatedUseProof,
    RequestValidatedUseProof, RequestValidationCallProof, RequestValidationProof,
    RequestValidationProofScope, ResponseSensitiveLeakProof, ResponseShapeProof,
    RouteSecurityBoundaryProof, SecretExposureProof, SecurityBoundaryProof, SecurityParserGap,
    SecurityProofResult, SecurityProofStatus, SessionMissingTrustProof, SessionTrustBoundaryProof,
    SessionTrustProof, TenantMissingProof, TenantPredicateProof, TenantProof, TenantSourceProof,
    TrustedGuardCallProof, UndominatedSinkProof, build_auth_boundary_proof,
    build_auth_boundary_proofs_for_file, build_middleware_coverage_proof,
    build_phase4_security_proof, build_phase4_security_proof_with_policy,
    build_request_validation_proof, build_request_validation_proof_with_scope,
    build_response_shape_proof, build_secret_exposure_proof,
};
pub use security_rules::{
    AcceptedOutboundUrlHelper, AcceptedSecurityHelper, SecurityAuthContract,
    SecurityAuthorizationContract, SecurityContractCapability, SecurityCorsContract,
    SecurityCsrfContract, SecurityEnforcementMode, SecurityFinding, SecurityFindingResult,
    SecurityMiddlewareContract, SecurityPhase5Contract, SecurityRateLimitContract,
    SecurityRawSqlContract, SecurityRequestValidationContract, SecuritySsrfContract,
    SecurityTenantScopeContract, evaluate_api_route_cors_must_match_policy,
    evaluate_api_route_forbids_raw_sql_without_params, evaluate_api_route_forbids_secret_exposure,
    evaluate_api_route_forbids_sensitive_response_fields,
    evaluate_api_route_forbids_untrusted_ssrf, evaluate_api_route_requires_auth_helper,
    evaluate_api_route_requires_auth_helper_with_middleware,
    evaluate_api_route_requires_authorization, evaluate_api_route_requires_csrf_for_mutation,
    evaluate_api_route_requires_rate_limit, evaluate_api_route_requires_request_validation,
    evaluate_api_route_requires_tenant_scope, evaluate_middleware_must_cover_routes,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFingerprint {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

const SKIPPED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "target",
    "vendor",
];

const SKIPPED_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "pem", "key", "crt",
];

pub fn should_index_path(path: impl AsRef<Path>) -> bool {
    let path = path.as_ref();
    let normalized = path.to_string_lossy();

    if normalized.starts_with(".env") || normalized.contains("/.env") {
        return false;
    }

    if path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .any(|part| SKIPPED_DIRS.contains(&part))
    {
        return false;
    }

    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| SKIPPED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
    {
        return false;
    }

    true
}

pub fn fingerprint_file(path: impl AsRef<Path>) -> io::Result<FileFingerprint> {
    let path = path.as_ref();
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        hasher.update(&buffer[..read]);
    }

    Ok(FileFingerprint {
        path: normalize_path(path),
        bytes,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

fn normalize_path(path: &Path) -> String {
    PathBuf::from(path).to_string_lossy().replace('\\', "/")
}
