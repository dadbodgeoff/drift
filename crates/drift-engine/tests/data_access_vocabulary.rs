//! D-H3: the engine's data-layer vocabulary must not be narrower than the fallback it replaced.
//!
//! `is_data_access_source` is the primary path. `rawLooksLikeDataAccessImport` in
//! packages/cli/src/domain/convention-candidates.ts is the degraded TypeScript fallback it exists to
//! improve on. The primary path recognised `prisma|database|db|data-access` and the fallback has
//! always recognised `db|database|prisma|drizzle|typeorm|sequelize`, so on a Drizzle, TypeORM or
//! Sequelize repo the better path saw less than the worse one - and saw it silently. No test
//! compared them, in either direction.
//!
//! Measured before the fix with a positive control: a real Drizzle client module (`drizzle(pool)`
//! exported as `client`) plus an `app/api/items/route.ts` importing it and calling
//! `client.select().from("items")` produced 0 candidates, 0 evidence refs, and
//! `data_layer_discovery.reason = "no_data_dependency_declared"`.
//!
//! The other half of this differential is packages/cli/test/data-access-vocabulary.test.ts, which
//! reads the same table. Adding a case there and not here (or the reverse) fails.

use std::fs;

use drift_engine::is_data_access_source;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Case {
    specifier: String,
    engine: bool,
    ts_fallback: bool,
    /// Present only when the engine deliberately says no to something the fallback says yes to.
    /// A narrowing with a reason is a decision; a narrowing without one is D-H3 returning.
    narrowing_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Table {
    cases: Vec<Case>,
}

fn table() -> Vec<Case> {
    let raw = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/data-access-vocabulary/specifiers.json"
    ))
    .expect("the shared data-access vocabulary table must exist");
    serde_json::from_str::<Table>(&raw)
        .expect("parse the shared table")
        .cases
}

#[test]
fn engine_matches_the_shared_table() {
    for case in table() {
        assert_eq!(
            is_data_access_source(&case.specifier),
            case.engine,
            "{} classified against test/fixtures/data-access-vocabulary/specifiers.json",
            case.specifier
        );
    }
}

/// The containment, in the one direction that matters.
///
/// Deliberately run against the live `is_data_access_source` rather than the table's own `engine`
/// column: a check that compares two columns of the same file passes whatever the code does, which
/// is the shape of gate this project keeps finding and removing. The `ts_fallback` column IS
/// measured - packages/cli/test/data-access-vocabulary.test.ts runs every case through the real
/// regex - so one measured side and one live side is enough to close the loop.
#[test]
fn the_engine_catches_everything_the_typescript_fallback_catches() {
    let unexplained = table()
        .into_iter()
        .filter(|case| {
            case.ts_fallback
                && !is_data_access_source(&case.specifier)
                && case.narrowing_reason.is_none()
        })
        .map(|case| case.specifier)
        .collect::<Vec<_>>();

    assert!(
        unexplained.is_empty(),
        "the primary path must not see less than the degraded fallback it replaced. These are \
         caught by rawLooksLikeDataAccessImport and dropped by is_data_access_source with no \
         narrowing_reason recorded, which is exactly the D-H3 shape: {unexplained:?}"
    );
}

/// Every D-H3 ORM must be recognised in at least the bare-package and workspace-scoped forms, so
/// that removing a token from `DATA_LAYER_TOKENS` fails here rather than silently on a real repo.
#[test]
fn every_orm_the_project_already_treats_as_a_data_layer_is_recognised() {
    for specifier in [
        "drizzle-orm",
        "@acme/drizzle",
        "typeorm",
        "@acme/typeorm",
        "sequelize",
        "@acme/sequelize",
        "kysely",
        "@acme/kysely",
    ] {
        assert!(
            is_data_access_source(specifier),
            "{specifier} names a data layer; DATA_LAYER_PACKAGES in \
             packages/cli/src/domain/data-layer-discovery.ts already says so"
        );
    }
}

/// The seam is only a seam if the TypeScript side reads the same table.
#[test]
fn the_typescript_half_of_this_differential_exists() {
    let ts_test = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/cli/test/data-access-vocabulary.test.ts"
    ))
    .expect("the CLI half of this differential must exist - it asserts the ts_fallback column");

    assert!(
        ts_test.contains("data-access-vocabulary/specifiers.json"),
        "the TypeScript half must read the shared table rather than a copy of it"
    );
}
