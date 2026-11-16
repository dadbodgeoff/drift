//! The scoped queries of a TypeScript body ([`drift_core::Symbol::scoped_queries`]),
//! for the listed reading only.
//!
//! The lowering already writes where the value each key of a query's filter comes
//! from ([`drift_core::controls::FILTER_VALUE`]: `filter_value:<callee>\t<key>\t
//! <side>`, for a call every request to the body reaches). The readers of
//! authorization ask a body's scoped queries what Python writes for the same
//! case: a query filtered under a key named for a tenant, with whether the value
//! is the caller's, what the request sent, or neither. This module says that of
//! the same facts, so a TypeScript route is read the way a Python route is: a
//! query scoped to the caller's organization, one keyed only by what the request
//! names (the tenant it asked for), one whose value was not read.
//!
//! Which keys are a tenant's is the vocabulary of [`drift_core::practice::tenant_key`];
//! which filters narrow is Prisma's documented filter grammar (a key under `OR`,
//! `NOT`, `none`, `every`, `isNot` or a comparison that is no equality narrows
//! nothing to the value), never a name of the repository's.

use drift_core::{ScopeSource, ScopedQuery};

/// Words of a filter path under which a value does not narrow the rows to it:
/// alternatives, negations, a relation filter that holds for no related row
/// (`every` of none), and comparisons that are no equality. Prisma's operators.
const NOT_NARROWING: &[&str] = &[
    "OR",
    "NOT",
    "not",
    "none",
    "every",
    "isNot",
    "notIn",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "startsWith",
    "endsWith",
    "search",
    "has",
    "hasSome",
    "hasEvery",
];

/// Words of a filter path that stand between a key and its value and keep it an
/// equality: `orgId: { equals: x }`, `orgId: { in: ids }`, a relation filter
/// (`team: { is: { orgId } }`, `members: { some: { userId } }`), and the items
/// of an `AND` list.
const PASS_THROUGH: &[&str] = &["equals", "in", "is", "some", "AND"];

/// Whether the symbol, or one of its methods, has a scoped query: a file with one
/// keeps a listed reading for it ([`drift_core::Listed::symbols`]). Mining reads
/// the file as the measured build did, which wrote none.
pub fn scopes(s: &drift_core::Symbol) -> bool {
    !scoped_queries(&s.controls).is_empty()
        || s.members
            .iter()
            .any(|m| !scoped_queries(&m.unread).is_empty())
}

/// Writes the symbol's scoped queries, and each method's, from their controls
/// (the listed reading's copy of the symbol only).
pub fn fill(s: &mut drift_core::Symbol) {
    s.scoped_queries = scoped_queries(&s.controls);
    // A body with more than the cap is not all there is: a reader answers unknown.
    let cap = drift_core::practice::caps::SCOPED_QUERIES;
    if s.scoped_queries.len() > cap {
        s.scoped_queries.truncate(cap);
        if !s.truncated.iter().any(|t| t == "scoped_queries") {
            s.truncated.push("scoped_queries".to_string());
            s.truncated.sort();
        }
    }
    for m in s.members.iter_mut() {
        m.scoped_queries = scoped_queries(&m.unread);
        m.scoped_queries.truncate(cap);
    }
}

/// The scoped queries `controls` (a symbol's, or a method's
/// [`drift_core::Member::unread`]) say: one for each
/// [`drift_core::controls::FILTER_VALUE`] of a key under `where` whose field is
/// named for a tenant, keyed by the path the control writes (so a reader that
/// asks the control for the side finds it). Sorted and without duplicates.
pub fn scoped_queries(controls: &[String]) -> Vec<ScopedQuery> {
    let mut out: Vec<ScopedQuery> = controls
        .iter()
        .filter_map(|c| c.strip_prefix(drift_core::controls::FILTER_VALUE))
        .filter_map(|rest| {
            let mut parts = rest.split('\t');
            let (callee, key, side) = (parts.next()?, parts.next()?, parts.next()?);
            if parts.next().is_some() || callee.is_empty() || !tenant_path(key) {
                return None;
            }
            Some(ScopedQuery {
                callee: callee.to_string(),
                key: key.to_string(),
                source: source(side)?,
                condition: String::new(),
            })
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// A filter path (`where.orgId`, `where.team.orgId`, `where.AND.0.teamId.in`,
/// `where.team.id`) that narrows the rows to its value under a field named for a
/// tenant: it starts at `where`, nothing on it is [`NOT_NARROWING`], and its field
/// (the last segment that is no [`PASS_THROUGH`] word or list position) is a
/// tenant key, or `id` of a relation that is one (`team: { id }`).
fn tenant_path(key: &str) -> bool {
    let segs: Vec<&str> = key.split('.').collect();
    if segs.first() != Some(&"where") || segs.iter().any(|s| NOT_NARROWING.contains(s)) {
        return false;
    }
    let fields: Vec<&str> = segs[1..]
        .iter()
        .copied()
        .filter(|s| !PASS_THROUGH.contains(s) && !s.bytes().all(|b| b.is_ascii_digit()))
        .collect();
    match fields.as_slice() {
        [.., relation, "id"] => drift_core::practice::tenant_key(relation),
        [.., field] => drift_core::practice::tenant_key(field),
        [] => false,
    }
}

/// Where a side of [`drift_core::controls::FILTER_VALUE`] says the value comes
/// from: the caller's own by the lowering's closed list of sources; a parameter
/// of the function (what the request sent, in a handler; whatever the caller
/// passed, below it), a header where it is read off one; anything else not known.
///
/// A value read off a parameter is what the request sent only where it is the
/// parameter itself (a decorated `@Query("org") org`, a server action's argument)
/// or is read through what carries input ([`request_input`]). Any other member of
/// it (`req.depot`, tRPC's `ctx.depot`, Hono's `c.var.depot`) is what a middleware
/// or a hook put there, likely from the caller's own claims: it is neither proven
/// the caller's nor what the request named, so no scoped query is written (None)
/// and the filter stays found, not proven, as the measured reading reads it.
fn source(side: &str) -> Option<ScopeSource> {
    if side == "caller" {
        return Some(ScopeSource::Session);
    }
    if side == "literal" {
        return Some(ScopeSource::Literal);
    }
    if let Some(rest) = side.strip_prefix("param ") {
        let path = rest.split_once(' ').map_or("", |(_, at)| at);
        // The first member read off the parameter (after its `#<position>`).
        let first = path.split('.').nth(1);
        return match first {
            Some("headers") => Some(ScopeSource::Header),
            None => Some(ScopeSource::Param),
            Some(m) if request_input(m) => Some(ScopeSource::Param),
            Some(_) => None,
        };
    }
    Some(ScopeSource::Unknown)
}

/// A member of a request, or a key of a handler's parameter, that carries what
/// the request sent: the vocabulary the reading of input already uses
/// ([`crate::lower::input::REQUEST_INPUT_MEMBERS`], [`crate::lower::input::INPUT_KEYS`]).
fn request_input(member: &str) -> bool {
    crate::lower::input::REQUEST_INPUT_MEMBERS.contains(&member)
        || crate::lower::input::INPUT_KEYS.contains(&member)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fv(callee: &str, key: &str, side: &str) -> String {
        format!(
            "{}{callee}\t{key}\t{side}",
            drift_core::controls::FILTER_VALUE
        )
    }

    /// Pins which filter paths are a tenant's scope: a field named for a tenant
    /// under `where`, through an equality, a relation filter or an `AND` list;
    /// never under an alternative or a negation, and never outside `where` (the
    /// data a row is written with filters nothing).
    #[test]
    fn a_tenant_path_narrows_under_where_only() {
        for yes in [
            "where.orgId",
            "where.organizationId",
            "where.teamId.in",
            "where.team.id",
            "where.team.is.id",
            "where.AND.0.workspaceId",
            "where.project.orgId",
            "where.members.some.teamId",
        ] {
            assert!(tenant_path(yes), "{yes}");
        }
        for no in [
            "where.id",
            "where.userId",
            "where.OR.0.orgId",
            "where.NOT.orgId",
            "where.orgId.not",
            "where.members.none.teamId",
            "data.orgId",
            "orgId",
            "where",
            "where.AND",
        ] {
            assert!(!tenant_path(no), "{no}");
        }
    }

    /// Pins the source of each side the lowering writes, and that a control with
    /// no tenant key gives no scoped query, nor one whose value is a member a
    /// middleware set on the handler's parameter.
    #[test]
    fn each_side_has_its_source() {
        let c = vec![
            fv("src/db.ts#prisma.project.findMany", "where.orgId", "caller"),
            fv(
                "src/db.ts#prisma.invoice.findMany",
                "where.orgId",
                "param req #0.params.orgId",
            ),
            fv(
                "src/db.ts#prisma.member.findMany",
                "where.teamId",
                "param req #0.headers.x-team",
            ),
            fv(
                "src/db.ts#prisma.tag.findMany",
                "where.orgId",
                "named src/a.ts#who",
            ),
            fv(
                "src/db.ts#prisma.note.findUnique",
                "where.id",
                "param req #0.params.id",
            ),
            // What a middleware put on the request: no scoped query.
            fv(
                "src/db.ts#prisma.label.findMany",
                "where.orgId",
                "param req #0.depot",
            ),
            fv(
                "src/db.ts#prisma.label.findMany",
                "where.orgId",
                "param ctx #0.ctx.orgId",
            ),
            // A decorated parameter, and tRPC's input.
            fv(
                "src/db.ts#prisma.site.findMany",
                "where.orgId",
                "param org #1",
            ),
            fv(
                "src/db.ts#prisma.site.findMany",
                "where.teamId",
                "param input #0.input.teamId",
            ),
        ];
        let got: Vec<(String, ScopeSource)> = scoped_queries(&c)
            .into_iter()
            .map(|q| (q.callee, q.source))
            .collect();
        assert_eq!(
            got,
            vec![
                (
                    "src/db.ts#prisma.invoice.findMany".to_string(),
                    ScopeSource::Param
                ),
                (
                    "src/db.ts#prisma.member.findMany".to_string(),
                    ScopeSource::Header
                ),
                (
                    "src/db.ts#prisma.project.findMany".to_string(),
                    ScopeSource::Session
                ),
                (
                    "src/db.ts#prisma.site.findMany".to_string(),
                    ScopeSource::Param
                ),
                (
                    "src/db.ts#prisma.site.findMany".to_string(),
                    ScopeSource::Param
                ),
                (
                    "src/db.ts#prisma.tag.findMany".to_string(),
                    ScopeSource::Unknown
                ),
            ]
        );
    }
}
