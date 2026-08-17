//! Which import specifiers name a data layer.
//!
//! Lifted out of `candidate_command.rs` (D-H3) for two reasons. It is the predicate that decides
//! whether a repo gets a data-access convention at all - if it says no, inference proposes nothing
//! and the repo is told it has no data layer - and until it lived here it was unreachable from an
//! integration test, so the differential in tests/data_access_vocabulary.rs could not exist.

/// Surfaces of a data package that are types, enums or schemas rather than a client.
///
/// Importing `@calcom/prisma/enums` gives you generated enum values; importing
/// `@calcom/prisma/zod-utils` gives you validation schemas. Neither is a database client, and
/// treating them as one put four wrong entries in cal.com's learned contract out of six.
///
/// `/schema` is deliberately absent. In a Drizzle repo the schema module *is* part of the data
/// layer - `@openstatus/db/src/schema` is imported at runtime and passed to queries - so
/// excluding it would trade these false positives for a false negative on a real data layer.
const DATA_LAYER_TYPE_SURFACES: [&str; 4] = ["/enums", "/zod-utils", "/types", "/constants"];

/// D-H3. ORM and client names that make a specifier a data layer, matched at a word boundary.
///
/// This list recognised `prisma` and `database` and nothing else. The *degraded TypeScript
/// fallback* it replaced - `rawLooksLikeDataAccessImport` in
/// packages/cli/src/domain/convention-candidates.ts - has always recognised
/// `db|database|prisma|drizzle|typeorm|sequelize`, so the primary path saw strictly LESS than the
/// path it exists to improve on, and said nothing when it saw nothing.
///
/// Measured with a positive control before the fix: a real Drizzle client module
/// (`drizzle(pool)` exported as `client`) plus a route importing it and calling
/// `client.select()` produced 0 candidates, 0 evidence refs, and
/// `data_layer_discovery.reason = "no_data_dependency_declared"` - a repo with its data layer in
/// plain sight being told it has none.
///
/// `kysely` is here too, though the TS fallback lacks it: it is already in
/// `DATA_LAYER_PACKAGES` in packages/cli/src/domain/data-layer-discovery.ts, so the project
/// already treats it as a data layer everywhere except the one place that decides.
///
/// Held against the TypeScript fallback by tests/data_access_vocabulary.rs, which asserts the
/// containment in the direction that matters: anything the fallback would catch, this catches.
const DATA_LAYER_TOKENS: [&str; 6] = [
    "prisma",
    "database",
    "drizzle",
    "typeorm",
    "sequelize",
    "kysely",
];

/// True when a data-layer name occurs at a path or word boundary rather than mid-identifier.
///
/// `is_data_access_source` matched raw substrings, so `@calcom/lib/isPrismaObj` - a type-guard
/// utility - matched "prisma" inside a camelCase identifier and was recorded as a database
/// client. This is the same boundary principle applied to forbidden-import matching in B3.
pub fn contains_data_layer_token(lower: &str, token: &str) -> bool {
    let mut from = 0;
    while let Some(offset) = lower[from..].find(token) {
        let start = from + offset;
        let end = start + token.len();
        let before_ok = start == 0
            || !lower[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric());
        let after_ok = end == lower.len()
            || !lower[end..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

pub fn is_data_access_source(source: &str) -> bool {
    let lower = source.to_ascii_lowercase();
    if lower.contains("@prisma/client/runtime") {
        return false;
    }
    // Compare with any file extension removed, so this catches both the import specifier
    // form (`@calcom/prisma/zod-utils`) and the resolved file form
    // (`packages/prisma/zod-utils.ts`).
    let without_extension = lower
        .rsplit_once('.')
        .map(|(stem, ext)| {
            if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs") {
                stem
            } else {
                lower.as_str()
            }
        })
        .unwrap_or(lower.as_str());
    if DATA_LAYER_TYPE_SURFACES
        .iter()
        .any(|surface| without_extension.ends_with(surface))
    {
        return false;
    }
    DATA_LAYER_TOKENS
        .iter()
        .any(|token| contains_data_layer_token(&lower, token))
        // `db` is matched loosely rather than at a boundary, and deliberately: `@acme/dbutils` and
        // `lib/appdb` are data layers in the repos that write them, and tightening this would be a
        // narrowing nobody asked for. The type-surface exclusions above are what keeps it honest.
        || lower.contains("/db")
        || lower.ends_with("db")
        // D4 (TDD §5.4). `data-access` was the same bare substring test, and unlike `db` there is
        // no repo it serves: `lib/no-data-access-here` and `legacy-data-access-notes.ts` matched
        // modules whose own names say they do no data access. The audit did not report this one.
        //
        // `contains_data_layer_token` is NOT sufficient here, which §5.4 assumed it would be: that
        // helper gates on `is_ascii_alphanumeric`, and `-` is not alphanumeric, so `data-access`
        // clears the boundary test on both sides of `no-data-access-here`. The token has to name a
        // path segment, or its head or its tail.
        //
        // Scoped to `data-access` deliberately. The loose `db` rule above stays exactly as it is.
        || data_access_token_names_segment(without_extension)
}

/// True when `data-access` *names* a path segment rather than sitting inside one.
///
/// `lib/data-access/orders`, `lib/data-access.ts` and `orders-data-access` are data layers - the
/// token is the segment, or its head, or its tail. `no-data-access-here` and
/// `legacy-data-access-notes` are not: there the token is an interior fragment of a longer phrase.
fn data_access_token_names_segment(haystack: &str) -> bool {
    const TOKEN: &str = "data-access";
    haystack.split('/').any(|segment| {
        if segment == TOKEN {
            return true;
        }
        let starts_segment = segment
            .strip_prefix(TOKEN)
            .and_then(|rest| rest.chars().next())
            .is_some_and(|character| !character.is_ascii_alphanumeric());
        let ends_segment = segment
            .strip_suffix(TOKEN)
            .and_then(|rest| rest.chars().next_back())
            .is_some_and(|character| !character.is_ascii_alphanumeric());
        starts_segment || ends_segment
    })
}
