//! Drift Studio (`apps/studio`) loads `drift scan` facts only for the schema versions
//! it lists. A facts schema bump must come with a Studio that reads it, or every
//! facts load in the Studio fails.

use std::path::Path;

#[test]
fn studio_reads_the_facts_schema_this_cli_writes() {
    let schema = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/studio/src/entities/drift/schema.ts");
    let src = std::fs::read_to_string(&schema).expect("Studio schema.ts");
    let list = src
        .lines()
        .find_map(|l| l.trim().strip_prefix("export const SUPPORTED_FACTS = ["))
        .and_then(|rest| rest.split(']').next())
        .expect("SUPPORTED_FACTS in schema.ts");
    let supported: Vec<u32> = list
        .split(',')
        .map(|v| v.trim().parse().expect("a version number"))
        .collect();
    assert!(
        supported.contains(&drift_core::FACTS_SCHEMA_VERSION),
        "apps/studio SUPPORTED_FACTS = {supported:?} lacks FACTS_SCHEMA_VERSION {}",
        drift_core::FACTS_SCHEMA_VERSION
    );
}
