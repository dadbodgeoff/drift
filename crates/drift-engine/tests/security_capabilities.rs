use drift_engine::{SecurityCapabilityStatus, security_capabilities};

#[test]
fn reports_phase_one_security_capabilities() {
    let capabilities = security_capabilities();
    let names: Vec<&str> = capabilities
        .iter()
        .map(|capability| capability.name.as_str())
        .collect();

    assert!(
        names.contains(&"security_facts"),
        "missing security_facts: {capabilities:#?}"
    );
    assert!(
        names.contains(&"auth_boundary_facts"),
        "missing auth_boundary_facts: {capabilities:#?}"
    );
    assert!(
        names.contains(&"control_flow_guard_dominance"),
        "missing control_flow_guard_dominance: {capabilities:#?}"
    );
    assert!(
        names.contains(&"response_shape_facts"),
        "missing Phase 5 response_shape_facts: {capabilities:#?}"
    );
    assert!(
        names.contains(&"secret_exposure"),
        "missing Phase 5 secret_exposure: {capabilities:#?}"
    );
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
                capability.name.as_str(),
                "response_shape_facts" | "secret_exposure"
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

    for expected in ["session_trust", "authorization", "tenant_scope"] {
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
            .any(|capability| capability.name == "tenant_scope"
                && capability.status == SecurityCapabilityStatus::Partial),
        "tenant scope must stay partial while dynamic tenant shapes are parser-gap backed: {capabilities:#?}"
    );
}

#[test]
fn security_phase8_reports_phase6_capabilities() {
    let capabilities = security_capabilities();

    for expected in ["ssrf", "raw_sql", "cors_policy", "csrf", "rate_limit"] {
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
