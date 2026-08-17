use drift_engine::{ScanCapability, SecurityCapabilityStatus, security_capabilities};

/// D-P3b: the report covers every capability the vocabulary marks as security-owned.
///
/// It used to report thirteen names against a twenty-name TypeScript enum, and five of the seven
/// it omitted were a second name for something it already reported (`ssrf` here,
/// `outbound_request_facts` on the wire). The synonym pairs are collapsed and the list is derived,
/// so a capability can no longer be required under one name and certified under another.
#[test]
fn reports_every_security_capability_in_the_vocabulary() {
    let capabilities = security_capabilities();
    let names: Vec<ScanCapability> = capabilities
        .iter()
        .map(|capability| capability.name)
        .collect();

    assert_eq!(
        names,
        ScanCapability::SECURITY.to_vec(),
        "security_capabilities() must report exactly the vocabulary's security members"
    );

    for expected in [
        ScanCapability::SecurityFacts,
        ScanCapability::AuthBoundaryFacts,
        ScanCapability::ControlFlowGuardDominance,
        ScanCapability::ResponseShapeFacts,
        ScanCapability::SecretExposure,
    ] {
        assert!(
            names.contains(&expected),
            "missing {expected}: {capabilities:#?}"
        );
    }

    assert!(
        capabilities
            .iter()
            .all(|capability| capability.block_requires_accepted_convention),
        "security capabilities must require accepted conventions: {capabilities:#?}"
    );
    assert!(
        capabilities
            .iter()
            .filter(|capability| matches!(
                capability.name,
                ScanCapability::ResponseShapeFacts | ScanCapability::SecretExposure
            ))
            .all(|capability| capability.can_block
                && capability.status == SecurityCapabilityStatus::Partial),
        "Phase 5 capabilities should be partial deterministic blockers only behind accepted contracts: {capabilities:#?}"
    );
    assert!(
        capabilities
            .iter()
            .any(|capability| capability.status == SecurityCapabilityStatus::Partial),
        "Phase 1 guard dominance should report partial, not overclaim complete: {capabilities:#?}"
    );
}

#[test]
fn phase4_capabilities_reflect_supported_parser_gaps_and_contracts() {
    let capabilities = security_capabilities();

    for expected in [
        ScanCapability::SessionTrust,
        ScanCapability::Authorization,
        ScanCapability::TenantScope,
    ] {
        let capability = capabilities
            .iter()
            .find(|capability| capability.name == expected)
            .unwrap_or_else(|| panic!("missing {expected}: {capabilities:#?}"));
        assert_eq!(
            capability.capability, "deterministic_check",
            "{expected} must report deterministic authority: {capabilities:#?}"
        );
        assert!(
            capability.can_block,
            "{expected} must be able to block accepted contracts: {capabilities:#?}"
        );
        assert!(
            capability.block_requires_accepted_convention,
            "{expected} must require accepted contracts: {capabilities:#?}"
        );
    }

    assert!(
        capabilities
            .iter()
            .any(|capability| capability.name == ScanCapability::TenantScope
                && capability.status == SecurityCapabilityStatus::Partial),
        "tenant scope must stay partial while dynamic tenant shapes are parser-gap backed: {capabilities:#?}"
    );
}

/// The Phase 6 capabilities, under the names `phase6_required_capabilities` actually requires.
///
/// This asserted `ssrf`, `raw_sql`, `cors_policy`, `csrf`, `rate_limit` - the names only
/// `security_capabilities()` used. The engine required `outbound_request_facts`, `raw_sql_facts`,
/// `cors_policy_facts`, `csrf_facts` and `rate_limit_facts` on the wire, so this test passed while
/// the two halves of the same capability had different names and nothing compared them.
#[test]
fn security_phase8_reports_phase6_capabilities() {
    let capabilities = security_capabilities();

    for expected in [
        ScanCapability::OutboundRequestFacts,
        ScanCapability::RawSqlFacts,
        ScanCapability::CorsPolicyFacts,
        ScanCapability::CsrfFacts,
        ScanCapability::RateLimitFacts,
    ] {
        let capability = capabilities
            .iter()
            .find(|capability| capability.name == expected)
            .unwrap_or_else(|| panic!("missing {expected}: {capabilities:#?}"));
        assert_eq!(capability.capability, "deterministic_check");
        assert!(
            capability.can_block,
            "{expected} must be block-capable behind accepted contracts"
        );
        assert!(capability.block_requires_accepted_convention);
    }
}
