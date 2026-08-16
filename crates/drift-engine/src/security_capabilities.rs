use crate::vocabulary::ScanCapability;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityCapabilityStatus {
    Complete,
    Partial,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityScanCapability {
    pub name: ScanCapability,
    pub capability: String,
    pub status: SecurityCapabilityStatus,
    pub can_block: bool,
    pub block_requires_accepted_convention: bool,
}

/// D-P3b: what the security layer is certified to have looked at.
///
/// This reported thirteen names while `SecurityCapabilityNameSchema` declared twenty, and seven of
/// the twenty never appeared here: cors_policy_facts, csrf_facts, middleware_coverage,
/// outbound_request_facts, rate_limit_facts, raw_sql_facts, request_validation_facts. Five of the
/// seven were not missing detection - they were a SECOND NAME for something this function already
/// reported. `phase6_required_capabilities` labelled the SSRF capability `outbound_request_facts`
/// while this function called the same thing `ssrf`; likewise raw_sql/raw_sql_facts,
/// cors_policy/cors_policy_facts, csrf/csrf_facts, rate_limit/rate_limit_facts. So a route could
/// require `outbound_request_facts` and be told the scan certified `ssrf`, and nothing anywhere
/// compared the two.
///
/// The `*_facts` names won because they are the ones on the wire: they reach
/// `stats.capabilities.required` on every check that matches a Phase 6 convention, where the short
/// names reached nothing - this function had no caller outside its own test.
///
/// `middleware_coverage` and `request_validation_facts` were genuinely absent, and both label real
/// detection: middleware coverage is computed by `static_middleware_coverage` and required by the
/// middleware family candidate, and request validation by
/// `security_request_validation_findings_and_proofs`.
///
/// The list now comes from `ScanCapability::SECURITY`, so a capability added to the vocabulary and
/// not given a row here fails scripts/vocabulary-parity.mjs.
pub fn security_capabilities() -> Vec<SecurityScanCapability> {
    ScanCapability::SECURITY
        .iter()
        .map(|name| SecurityScanCapability {
            name: *name,
            capability: "deterministic_check".to_string(),
            status: SecurityCapabilityStatus::Partial,
            // `security_facts` is the umbrella fact-extraction capability rather than a proof, so it
            // cannot carry a block on its own. Every other member names a proof that can.
            can_block: *name != ScanCapability::SecurityFacts,
            block_requires_accepted_convention: true,
        })
        .collect()
}
