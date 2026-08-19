/**
 * Versions the BUILT artifact is expected to report.
 *
 * Deliberately a literal, and deliberately not derived from `MIGRATIONS.length`.
 *
 * The unit and integration suites derive this number from the source of truth, because they are
 * testing behaviour and the number is incidental to them. These end-to-end tests are the opposite:
 * they run the packed, installed CLI and assert what it reports about itself. Deriving the
 * expectation from source would make them pass whenever source and build agreed with each other -
 * including when both are wrong, or when a stale build is packaged - which is the one failure an
 * end-to-end test exists to catch.
 *
 * So this is an independent restatement, and updating it is a deliberate act. When a migration is
 * added, exactly two places change: the migration list pinned in
 * `packages/storage/test/sqlite-storage.test.ts`, and this constant.
 */
export const EXPECTED_SQLITE_SCHEMA_VERSION = 36;
