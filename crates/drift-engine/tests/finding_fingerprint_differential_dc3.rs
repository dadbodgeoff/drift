//! D-C3: the direct-data-access finding fingerprint exists three times, and nothing compared them.
//!
//! The three implementations, all live:
//!
//!   - `findingFingerprint` in packages/cli/src/check/finding-fingerprint.ts, used by the CLI's own
//!     check path (`run-check.ts`);
//!   - `direct_data_access_fingerprint` in crates/drift-engine/src/rules.rs, used by the engine's
//!     import-based rule;
//!   - `legacy_direct_data_access_fingerprint` in crates/drift-engine/src/check_command.rs, which
//!     the graph-based rule uses to emit `legacy_fingerprints` so an old baseline still matches.
//!
//! A fingerprint is the identity of a violation across runs. If two of the three disagree by a byte,
//! every stored baseline orphans at once: findings that were `pre_existing` come back `new`, and a
//! user's first check after upgrading floods with violations for code they did not write. The TS
//! side pinned its digest in packages/cli/test/frozen-contracts.test.ts and no Rust test pinned
//! anything, so a change to either Rust copy would have been caught by nothing.
//!
//! This is the same seam as `route_flavor_differential_cv2.rs`: the table is duplicated on purpose,
//! and the second test below fails when the TypeScript side stops asserting the same digests. When
//! adding a case here, add it there too. The pairing is the mechanism.

use drift_engine::{
    DirectDataAccessRule, EnforcementMode, Fact, FactKind, RUNTIME_USE_VALUE_POSITION, Severity,
    materialize_direct_data_access_findings,
};

/// (convention_id, file_path, import_name, import_source, expected sha256).
///
/// Every digest here also appears in packages/cli/test/frozen-contracts.test.ts.
const EXPECTED: &[(&str, &str, &str, &str, &str)] = &[
    (
        "convention_x",
        "apps/web/app/api/users/route.ts",
        "prisma",
        "@/lib/prisma",
        "f89345641d5764b90d14c8ce1f569170c0d67bc6788356ba11764a17f83a36a5",
    ),
    (
        "convention_no_direct_db",
        "app/api/items/route.ts",
        "db",
        "@/lib/db",
        "03a8e3c929e01da4d31ecd949629e4822f454eb51fe78421df1f88cc8283cecf",
    ),
];

fn route_facts(file_path: &str, import_name: &str, import_source: &str) -> Vec<Fact> {
    vec![
        Fact {
            kind: FactKind::FileRoleDetected,
            file_path: file_path.to_string(),
            name: "api_route".to_string(),
            value: None,
            imported_name: None,
            runtime_use: None,
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 1,
        },
        Fact {
            kind: FactKind::ImportUsed,
            file_path: file_path.to_string(),
            name: import_name.to_string(),
            value: Some(import_source.to_string()),
            imported_name: Some(import_name.to_string()),
            runtime_use: Some(RUNTIME_USE_VALUE_POSITION.to_string()),
            start_line: 1,
            end_line: 1,
            start_column: 1,
            end_column: 1,
        },
    ]
}

#[test]
fn engine_direct_data_access_fingerprint_matches_the_typescript_digest() {
    for (convention_id, file_path, import_name, import_source, expected) in EXPECTED {
        let rule = DirectDataAccessRule {
            convention_id: (*convention_id).to_string(),
            forbidden_imports: vec![(*import_source).to_string()],
            forbidden_module_files: Vec::new(),
            severity: Severity::Error,
            enforcement_mode: EnforcementMode::Block,
        };
        let findings = materialize_direct_data_access_findings(
            &route_facts(file_path, import_name, import_source),
            &rule,
        );
        assert_eq!(
            findings.len(),
            1,
            "fixture must produce exactly one violation for {file_path}, or the digest below is \
             about nothing"
        );
        assert_eq!(
            &findings[0].fingerprint.as_str(),
            expected,
            "the engine's fingerprint for {convention_id}/{file_path} must equal what \
             findingFingerprint produces in packages/cli/src/check/finding-fingerprint.ts"
        );
    }
}

/// The table is only a seam if the TypeScript side really pins the same digests.
///
/// Reads the frozen-contract test and fails when a digest here is missing from it, so the two
/// cannot quietly drift apart - and so that changing the recipe forces both files open at once.
#[test]
fn every_digest_in_this_table_is_also_pinned_in_typescript() {
    let ts_test = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/cli/test/frozen-contracts.test.ts"
    ))
    .expect("the frozen-contract test must exist - it is the other half of this differential");

    let missing = EXPECTED
        .iter()
        .map(|(_, _, _, _, digest)| *digest)
        .filter(|digest| !ts_test.contains(digest))
        .collect::<Vec<_>>();

    assert!(
        missing.is_empty(),
        "these digests are asserted here and nowhere in packages/cli/test/frozen-contracts.test.ts, \
         so the TypeScript fingerprint could change without failing anything: {missing:?}"
    );
}
