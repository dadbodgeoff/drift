//! What stands at a guard position: the guard, nothing, or unknown.
//!
//! One reading for every position of a TypeScript or JavaScript entry point (a
//! middleware argument, a router's or an application's `use`, what a mount gives, a
//! Fastify hook, a member of a Fastify instance, a wrapper of an exported handler),
//! taken by the practice map (`practices::authn`) and by `drift security`
//! (`security::guards_and_wrappers`), so the two never disagree. Unknown is the
//! default: a value is the guard or nothing only by one of the proofs below, and
//! whatever is not recognised stays unknown. The provenance classes are those of
//! [`drift_core::guard_lists`].
//!
//! - A package's export is read from the closed lists alone
//!   ([`drift_core::guard_lists::library`]), by the shape of the call that stands at
//!   the position ([`drift_core::Listed::guard_calls`]): a library guard in an
//!   understood shape is the guard, one in a shape listed as optional and a value
//!   that never authenticates are nothing, and a shape that is not understood, a
//!   package on no list and a value Drift names nowhere are unknown.
//! - A function of the repository is the guard where its body is read to refuse
//!   every request without identity ([`security::authenticates`], with a check that
//!   no branch makes conditional), and nothing where its body is read to the end
//!   and nothing in it can refuse ([`reads_to_nothing`]). One that refuses some
//!   requests only, that hands the request on where the facts do not follow, that
//!   calls what is not read, or that is no function at all is unknown.
//! - A binding made by a call of a library guard (`const requireAuth =
//!   passport.authenticate("jwt")`) and a function that calls one are read by the
//!   shape of that call, recorded where it is written.
//! - A combinator on the list is what its relation makes of its members, each read
//!   the same way.

use std::collections::BTreeSet;

use drift_core::guard_lists::{self, Library, Relation};
use drift_core::{CallArg, FileFacts, GuardCall, Symbol, SymbolKind};

use crate::practices::{Cx, UnknownReason};
use crate::security;

/// What a value at a guard position is to the entry point it stands before.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// It refuses every request without identity. The instrument that proves it: the
    /// value itself, or the library guard it is made by.
    Guard(String),
    /// It was read, and refuses no one for who they are.
    Nothing,
    /// Neither is proven.
    Unknown(UnknownReason),
}

/// How deep a value is followed: a combinator's members, a builder's steps.
const MAX_DEPTH: usize = 4;
/// Calls followed at most below a function that is read to the end for whether
/// anything in it turns a caller away ([`reads_to_nothing`]), and functions read at
/// most for one such question. Past either, it is not read to the end.
const BODY_DEPTH: usize = 8;
const BODY_NODES: usize = 64;

/// Whether the reading applies to a file's entry points: every language but Python,
/// whose dependencies and decorators have their own.
pub fn applies(file: &FileFacts) -> bool {
    file.lang != "py"
}

/// Reads `value` (a wrap's wrapper, an entry of `app_middleware`) standing at a guard
/// position of the entry point `route` of `file`.
pub fn read(cx: &Cx<'_>, file: &FileFacts, route: &Symbol, value: &str) -> Verdict {
    let calls: Vec<&GuardCall> = file
        .guard_calls_of(route)
        .iter()
        .filter(|c| same(&c.callee, value))
        .collect();
    value_at(cx, &file.package, &calls, value, 0)
}

fn same(a: &str, b: &str) -> bool {
    a == b || crate::mine::norm_ref(a) == crate::mine::norm_ref(b)
}

fn external(r: &str) -> bool {
    r.starts_with("pkg:") || r.starts_with("global#") || r.starts_with("unresolved:")
}

/// What several uses of one value make together: each use covers the entry point, so
/// they agree or the value is unknown.
fn agree(mut verdicts: impl Iterator<Item = Verdict>) -> Verdict {
    let Some(first) = verdicts.next() else {
        return Verdict::Unknown(UnknownReason::Unclassified);
    };
    for v in verdicts {
        match (&first, &v) {
            (Verdict::Guard(_), Verdict::Guard(_)) | (Verdict::Nothing, Verdict::Nothing) => {}
            (Verdict::Unknown(_), _) => return first,
            (_, Verdict::Unknown(_)) => return v,
            _ => return Verdict::Unknown(UnknownReason::Unresolved),
        }
    }
    first
}

fn value_at(
    cx: &Cx<'_>,
    package: &str,
    calls: &[&GuardCall],
    value: &str,
    depth: usize,
) -> Verdict {
    if depth > MAX_DEPTH {
        return Verdict::Unknown(UnknownReason::NotFollowed);
    }
    if value.starts_with("unresolved:") {
        return Verdict::Unknown(UnknownReason::Unresolved);
    }
    // A member of a Fastify instance no decoration of the repository is read for.
    if let Some(name) = value.strip_prefix(guard_lists::FASTIFY_MEMBER) {
        let depends = |library: &str| cx.context().package_depends_on(package, library);
        let listed = |call: Option<&GuardCall>| {
            let l = guard_lists::fastify_decorator(name, call, &depends);
            library_verdict(cx, package, value, l, depth)
        };
        return match calls {
            [] => listed(None),
            calls => agree(calls.iter().map(|c| listed(Some(c)))),
        };
    }
    // The runtime's own (`console.log` called in a middleware written in place).
    if guard_lists::runtime(value) {
        return Verdict::Nothing;
    }
    if external(value) {
        let listed = |call: Option<&GuardCall>| {
            library_verdict(cx, package, value, guard_lists::library(value, call), depth)
        };
        return match calls {
            [] => listed(None),
            calls => agree(calls.iter().map(|c| listed(Some(c)))),
        };
    }
    repository_value(cx, package, calls, value, depth)
}

/// What the lists say of a library value, as a verdict.
fn library_verdict(
    cx: &Cx<'_>,
    package: &str,
    value: &str,
    listed: Library,
    depth: usize,
) -> Verdict {
    match listed {
        Library::Guard => Verdict::Guard(value.to_string()),
        Library::Optional | Library::Never => Verdict::Nothing,
        Library::Unread => Verdict::Unknown(UnknownReason::Unclassified),
        Library::Unlisted if crate::practices::of_an_auth_library(value) => {
            Verdict::Unknown(UnknownReason::Unclassified)
        }
        Library::Unlisted => Verdict::Unknown(UnknownReason::OpaqueWrapper),
        Library::Combines(relation, members) => {
            let read: Vec<Verdict> = members
                .iter()
                .map(|m| member(cx, package, m, depth + 1))
                .collect();
            combine(relation, value, &read)
        }
    }
}

/// One member of a composition: a reference, or a call written in place.
fn member(cx: &Cx<'_>, package: &str, m: &CallArg, depth: usize) -> Verdict {
    match m {
        CallArg::Ref(r) => value_at(cx, package, &[], r, depth),
        CallArg::Call(c) => value_at(cx, package, &[c], &c.callee, depth),
        _ => Verdict::Unknown(UnknownReason::NotFollowed),
    }
}

/// What a relation makes of its members ([`Relation`]).
fn combine(relation: Relation, value: &str, members: &[Verdict]) -> Verdict {
    let unknown = members.iter().find(|m| matches!(m, Verdict::Unknown(_)));
    let guard = members.iter().find(|m| matches!(m, Verdict::Guard(_)));
    let nothing = members.contains(&Verdict::Nothing);
    match relation {
        // Each member runs: one guard among them is enough.
        Relation::All => match (guard, unknown) {
            (Some(g), _) => g.clone(),
            (None, Some(u)) => u.clone(),
            (None, None) if members.is_empty() => Verdict::Unknown(UnknownReason::Unclassified),
            (None, None) => Verdict::Nothing,
        },
        // One member that passes is enough: a member that refuses no one lets
        // every request through.
        Relation::Any => {
            if nothing {
                Verdict::Nothing
            } else if let Some(u) = unknown {
                u.clone()
            } else if members.is_empty() {
                Verdict::Unknown(UnknownReason::Unclassified)
            } else {
                Verdict::Guard(value.to_string())
            }
        }
    }
}

/// A guard class a NestJS route runs (`@UseGuards(G)`, `APP_GUARD`,
/// `useGlobalGuards(new G())`), by the same rule as every other position, with
/// `at` the calls recorded where the route's guards are written. `None` where this
/// reading has nothing to say and the readers' own stands (a class that is not
/// defined, a package's class on no list, a class with neither `canActivate` nor
/// `@nestjs/passport`'s base).
///
/// - `AuthGuard(...)` of `@nestjs/passport` is the guard in the shapes its entry
///   understands ([`guard_lists::LIBRARY_GUARDS`]), and so is a class that extends
///   it and overrides nothing; one whose `handleRequest` hands the user back and
///   can throw nothing is optional identity (nothing); one whose `handleRequest`
///   calls what is not read is unknown.
/// - A class with a `canActivate` of its own is the guard where a check no branch
///   makes conditional answers "not signed in", or where it can return a value
///   that is no constant or throws a rejection (Nest answers 403 on false). One
///   whose checks are all conditional is unknown. One that can only return a
///   constant is nothing where everything it calls can refuse no one, and unknown
///   where it calls what is not read. Its name says nothing either way.
/// - A rate limiter of a package ([`crate::practices::NOT_AUTH_GUARD_LIBRARIES`])
///   is nothing; a value that is no class (a member of a binding) is unknown.
pub fn nest_guard(cx: &Cx<'_>, package: &str, at: &[GuardCall], guard: &str) -> Option<Verdict> {
    use drift_core::CheckOutcome::{SignInRedirect, Unauthenticated};
    let ctx = cx.context();
    let g = guard.trim_end_matches("()");
    if g.starts_with("unresolved:") {
        return None;
    }
    let passport = |r: &str| {
        guard_lists::export_of(r.trim_end_matches("()"))
            .is_some_and(|(p, e, _)| p == "@nestjs/passport" && e == "AuthGuard")
    };
    let shaped = |calls: &[&GuardCall], callee: &str| -> Verdict {
        let listed = |c: Option<&GuardCall>| {
            library_verdict(cx, package, callee, guard_lists::library(callee, c), 0)
        };
        match calls {
            [] => listed(None),
            calls => agree(calls.iter().map(|c| listed(Some(c)))),
        }
    };
    if external(g) {
        if passport(g) {
            let calls: Vec<&GuardCall> = at.iter().filter(|c| same(&c.callee, g)).collect();
            return Some(shaped(&calls, g));
        }
        let limiter = guard_lists::export_of(g)
            .is_some_and(|(p, _, _)| crate::practices::NOT_AUTH_GUARD_LIBRARIES.contains(&p));
        return limiter.then_some(Verdict::Nothing);
    }
    let v = crate::mine::norm_ref(g).into_owned();
    let d = ctx.definition(&v)?;
    let short = v.rsplit_once('#').map_or(v.as_str(), |(_, n)| n);
    if d.kind != SymbolKind::Class || d.name != short {
        return Some(Verdict::Unknown(UnknownReason::Unresolved));
    }
    let member = |name: &str| d.members.iter().find(|m| m.name == name);
    let base = d
        .wraps
        .iter()
        .find(|w| w.kind == drift_core::WrapKind::Extends && passport(&w.wrapper));
    let mut seen = BTreeSet::from([v.clone()]);
    let mut harmless = |calls: &[String]| {
        calls
            .iter()
            .all(|c| harmless_call(cx, None, d, c, false, &mut seen, 1))
    };
    if let Some(can) = member("canActivate") {
        let mut signs_in = can
            .body_checks
            .iter()
            .filter(|c| matches!(c.outcome, Unauthenticated | SignInRedirect))
            .peekable();
        if signs_in.peek().is_some() {
            // A class that reads the route's metadata (`if (isPublic) return true`
            // before its check) is read with what the decorators of a route
            // change for it ([`security::nest_opt_out`]).
            let reads_metadata = d.controls.iter().any(|c| {
                c.starts_with(drift_core::controls::OPENS_FOR_METADATA)
                    || c.starts_with(drift_core::controls::READS_METADATA)
                    || c == drift_core::controls::METADATA_UNREAD
            });
            let every = |c: &drift_core::BodyCheck| !c.conditional;
            return if signs_in.any(every) {
                Some(Verdict::Guard(v))
            } else if reads_metadata {
                // Under what it reads of the route's metadata: the readers' own.
                None
            } else {
                Some(Verdict::Unknown(UnknownReason::Unresolved))
            };
        }
        if can.returns_nonconstant_bool || !can.throws.is_empty() {
            // It can refuse: the guard where the proof of every Nest guard holds.
            return Some(match security::proving_root(ctx, &v) {
                Some(_) => Verdict::Guard(v),
                None => Verdict::Unknown(UnknownReason::NotFollowed),
            });
        }
        // It can only return `true`: nothing where what it calls on the way can
        // refuse no one.
        if can.returns_only_true {
            let hands_on = can.unread.iter().any(|u| u == drift_core::MEMBER_HANDS_ON);
            return Some(if !hands_on && harmless(&can.calls) {
                Verdict::Nothing
            } else {
                Verdict::Unknown(UnknownReason::NotFollowed)
            });
        }
        // A `return false`, or no `return` at all: the readers' own.
        return None;
    }
    let base = base?;
    let file = file_of(cx, &v)?;
    let callee = base.wrapper.trim_end_matches("()");
    let calls: Vec<&GuardCall> = file
        .guard_calls_of(d)
        .iter()
        .filter(|c| same(&c.callee, callee))
        .collect();
    let by_shape = match shaped(&calls, callee) {
        Verdict::Guard(_) => Verdict::Guard(v),
        other => other,
    };
    Some(match member("handleRequest") {
        None => by_shape,
        // It still refuses where it builds or throws an error.
        Some(h)
            if !h.throws.is_empty()
                || h.calls
                    .iter()
                    .any(|c| c.ends_with("Exception(new)") || c.ends_with("Error(new)")) =>
        {
            by_shape
        }
        // It hands back what it was given, signed in or not: optional identity.
        Some(h) if h.calls.is_empty() && h.receiver_calls.is_empty() => Verdict::Nothing,
        Some(_) => Verdict::Unknown(UnknownReason::NotFollowed),
    })
}

/// The functions of the repository that the compositions at the guard positions of
/// `route` hold (`values`: its wraps and middleware): each with whether every
/// request runs it (a member of a list, of an `and`) or only some may (a member of
/// an `or`). What stands at a position itself is not listed: only what a
/// combinator, a list or an options object brings with it.
pub fn held<'v>(
    cx: &Cx<'_>,
    file: &FileFacts,
    route: &Symbol,
    values: impl Iterator<Item = &'v str>,
) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    for value in values {
        let calls: Vec<&GuardCall> = file
            .guard_calls_of(route)
            .iter()
            .filter(|c| same(&c.callee, value))
            .collect();
        holds(cx, &file.package, &calls, value, true, 0, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

fn holds(
    cx: &Cx<'_>,
    package: &str,
    calls: &[&GuardCall],
    value: &str,
    every: bool,
    depth: usize,
    out: &mut Vec<(String, bool)>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let members = |relation: Relation, members: &[CallArg], out: &mut Vec<(String, bool)>| {
        let every = every && relation == Relation::All;
        for m in members {
            match m {
                CallArg::Ref(r) => {
                    if !external(r) {
                        out.push((crate::mine::norm_ref(r).into_owned(), every));
                    }
                    holds(cx, package, &[], r, every, depth + 1, out);
                }
                CallArg::Call(c) => holds(cx, package, &[c], &c.callee, every, depth + 1, out),
                _ => {}
            }
        }
    };
    if let Some(name) = value.strip_prefix(guard_lists::FASTIFY_MEMBER) {
        let depends = |library: &str| cx.context().package_depends_on(package, library);
        for c in calls {
            if let Library::Combines(relation, held) =
                guard_lists::fastify_decorator(name, Some(c), &depends)
            {
                members(relation, &held, out);
            }
        }
        return;
    }
    if external(value) {
        for c in calls {
            if let Library::Combines(relation, held) = guard_lists::library(value, Some(c)) {
                members(relation, &held, out);
            }
        }
        return;
    }
    // A binding that holds an array, or an object of Fastify hooks.
    let Some(d) = cx.context().definition(value) else {
        return;
    };
    let Some(file) = file_of(cx, value) else {
        return;
    };
    for c in file.guard_calls_of(d) {
        if c.callee == GuardCall::LIST {
            let held: Vec<CallArg> = c.args.iter().flatten().cloned().collect();
            members(Relation::All, &held, out);
        } else if c.callee == GuardCall::OPTIONS
            && let Some(CallArg::Object(props)) = c.args.first().and_then(|a| a.first())
        {
            let held: Vec<CallArg> = props
                .iter()
                .flat_map(|(_, v)| match v {
                    CallArg::List(l) => l.clone(),
                    other => vec![other.clone()],
                })
                .collect();
            members(Relation::All, &held, out);
        }
    }
}

/// The file a canonical reference of the repository is in.
fn file_of<'a>(cx: &Cx<'a>, r: &str) -> Option<&'a FileFacts> {
    let module = r.split_once('#').map_or(r, |(m, _)| m);
    crate::practices::file_at(cx.facts, module)
}

/// `callee` is a function of the repository that hands back the one function
/// written where it returns ([`drift_core::SymbolCalls::returns_function`]): what a
/// call of it builds runs that function's body, which its facts hold.
pub(crate) fn returns_function(cx: &Cx<'_>, callee: &str) -> bool {
    let v = crate::mine::norm_ref(callee);
    !external(&v)
        && cx.context().definition(&v).is_some_and(|d| {
            d.kind == SymbolKind::Function
                && v.rsplit_once('#').is_some_and(|(_, n)| n == d.name)
                && file_of(cx, &v).is_some_and(|f| f.returns_function(d))
        })
}

/// [`returns_function`], and the function it hands back serves the request: it
/// does not call a continuation ([`drift_core::controls::CONTINUES`]). One that
/// does stands before what serves, as a middleware does.
pub(crate) fn builds_handler(cx: &Cx<'_>, callee: &str) -> bool {
    returns_function(cx, callee)
        && cx
            .context()
            .definition(&crate::mine::norm_ref(callee))
            .is_some_and(|d| {
                !d.controls
                    .iter()
                    .any(|c| c == drift_core::controls::CONTINUES)
            })
}

/// The exports of the guard and combinator lists a definition calls.
fn listed_callees(d: &Symbol) -> Vec<&str> {
    d.calls
        .iter()
        .map(|c| c.trim_end_matches("(ref)").trim_end_matches("(new)"))
        .filter(|c| c.starts_with("pkg:"))
        .filter(|c| {
            !matches!(
                guard_lists::library(c, None),
                Library::Unlisted | Library::Never
            )
        })
        .collect()
}

/// A value of the repository.
fn repository_value(
    cx: &Cx<'_>,
    package: &str,
    calls: &[&GuardCall],
    value: &str,
    depth: usize,
) -> Verdict {
    let ctx = cx.context();
    let v = crate::mine::norm_ref(value).into_owned();
    let Some(d) = ctx.definition(&v) else {
        return Verdict::Unknown(if crate::practices::in_skipped(cx, &v) {
            UnknownReason::Unparsed
        } else {
            UnknownReason::OpaqueWrapper
        });
    };
    let file = file_of(cx, &v);
    let short = v.rsplit_once('#').map_or(v.as_str(), |(_, n)| n);
    let itself = d.name == short;
    // A method of a class or of an object: its own body decides.
    if let Some(proof) = security::method_guard(ctx, &v) {
        return match proof {
            security::Proof::Guard => Verdict::Guard(v),
            security::Proof::Unreadable => Verdict::Unknown(UnknownReason::Unresolved),
            // No check of its own: nothing where what it calls can refuse no one.
            security::Proof::NotAGuard => {
                let method = short.rsplit('.').next().unwrap_or_default();
                let calls = d
                    .members
                    .iter()
                    .find(|m| m.name == method)
                    .map(|m| m.calls.as_slice());
                let mut seen = BTreeSet::from([v.clone()]);
                match calls {
                    Some(calls)
                        if calls
                            .iter()
                            .all(|c| harmless_call(cx, None, d, c, false, &mut seen, depth)) =>
                    {
                        Verdict::Nothing
                    }
                    _ => Verdict::Unknown(UnknownReason::NotFollowed),
                }
            }
        };
    }
    let bound = matches!(d.kind, SymbolKind::Const | SymbolKind::Variable);
    // A member of an instance the module builds from a class or a constructor of
    // the repository, and from nothing else (`const session = new Session(db)`,
    // then `session.required` where a guard goes): the class's own method. Not of
    // a binding that may be given another value (`let`).
    if d.kind == SymbolKind::Const
        && !itself
        && d.derives_from.is_empty()
        && let [made] = d.calls.as_slice()
        && let Some(class) = made.strip_suffix("(new)")
        && !external(class)
        && let Some(member) = short
            .strip_prefix(d.name.as_str())
            .filter(|m| m.starts_with('.') && !m[1..].contains(['.', '(']))
    {
        let method = format!("{}{member}", crate::mine::norm_ref(class));
        return match value_at(cx, package, &[], &method, depth + 1) {
            // Named as it is written where it stands.
            Verdict::Guard(_) => Verdict::Guard(v),
            other => other,
        };
    }
    // The base procedure of a tRPC instance (`t.procedure`): it runs no middleware.
    if bound
        && short.strip_prefix(d.name.as_str()) == Some(".procedure")
        && !d.calls.is_empty()
        && d.calls
            .iter()
            .all(|c| c.starts_with(guard_lists::TRPC_INSTANCE))
    {
        return Verdict::Nothing;
    }
    if bound && itself {
        let recorded = file.map_or(&[][..], |f| f.guard_calls_of(d));
        // A builder derived from another by steps that only add to it
        // (`publicProcedure.use(isAuthed)`): the base, with what each middleware
        // step is given. A step given a function written in place is read by the
        // binding's own body, which is that function's.
        if !d.derives_from.is_empty() {
            let base = builder_base(&d.derives_from);
            let mut read = vec![value_at(cx, package, &[], base, depth + 1)];
            let steps = recorded.iter().find(|c| c.callee == GuardCall::STEPS);
            let stepped = drift_core::builders::MIDDLEWARE_STEPS
                .iter()
                .any(|s| d.derives_from.contains(&format!(".{s}()")));
            match steps {
                Some(steps) => {
                    for given in steps.args.iter().flatten() {
                        read.push(match given {
                            CallArg::Function => own_body(d),
                            other => member(cx, package, other, depth + 1),
                        });
                    }
                }
                // Steps whose arguments were not recorded.
                None if stepped => read.push(Verdict::Unknown(UnknownReason::NotFollowed)),
                None => {}
            }
            return match combine(Relation::All, &v, &read) {
                // Named by the binding, as its routes are wrapped by it.
                Verdict::Guard(_) => Verdict::Guard(v),
                other => other,
            };
        }
        // An object that names a Fastify hook, given as a route's options: what it
        // holds under the hooks runs, where the object is read to the end.
        if let Some(options) = recorded.iter().find(|c| c.callee == GuardCall::OPTIONS) {
            let Some(CallArg::Object(props)) = options.args.first().and_then(|a| a.first()) else {
                return Verdict::Unknown(UnknownReason::NotFollowed);
            };
            if props.iter().any(|(k, _)| k == "...") {
                return Verdict::Unknown(UnknownReason::NotFollowed);
            }
            let mut read: Vec<Verdict> = Vec::new();
            for hook in ["onRequest", "preParsing", "preValidation", "preHandler"] {
                // The last writer of a key is the hook.
                match props.iter().rev().find(|(k, _)| k == hook).map(|(_, v)| v) {
                    Some(CallArg::List(members)) => {
                        read.extend(members.iter().map(|m| member(cx, package, m, depth + 1)));
                    }
                    Some(CallArg::Null) | None => {}
                    Some(one) => read.push(member(cx, package, one, depth + 1)),
                }
            }
            return if read.is_empty() {
                Verdict::Nothing
            } else {
                combine(Relation::All, &v, &read)
            };
        }
        // An array a binding holds: each element runs where the binding is given.
        if let Some(list) = recorded.iter().find(|c| c.callee == GuardCall::LIST) {
            let read: Vec<Verdict> = list
                .args
                .iter()
                .flatten()
                .map(|m| member(cx, package, m, depth + 1))
                .collect();
            return combine(Relation::All, &v, &read);
        }
        // A binding made by a call of a library guard: the shape of the call that
        // made it decides, where it is the only thing it is made of.
        let made_by = listed_callees(d);
        if let [callee] = made_by.as_slice() {
            let made: Vec<&GuardCall> = recorded
                .iter()
                .filter(|c| same(&c.callee, callee))
                .collect();
            return match made.as_slice() {
                [one] if d.calls.len() == 1 => value_at(cx, package, &[one], callee, depth + 1),
                _ => Verdict::Unknown(UnknownReason::NotFollowed),
            };
        }
        if !made_by.is_empty() {
            return Verdict::Unknown(UnknownReason::NotFollowed);
        }
        // One that only holds references (a conditional, an object, an alias):
        // which of them is given where the binding stands is not read.
        let own_refusal = security::answers_not_signed_in(d)
            || d.controls.iter().any(|c| {
                c == drift_core::controls::REJECTS_CALLER
                    || c == drift_core::controls::HANDLER_REJECTS
            });
        if d.derives_from.is_empty()
            && d.made_by.is_empty()
            && d.wraps.is_empty()
            && !d.calls.is_empty()
            && d.calls.iter().all(|c| c.ends_with("(ref)"))
            && !own_refusal
        {
            return Verdict::Unknown(UnknownReason::Unresolved);
        }
    }
    // What a library that never authenticates made (`const limiter = rateLimit({
    // ... })`, `upload.single("file")` of `const upload = multer()`).
    if bound && made_only_by_what_never_authenticates(d) {
        return Verdict::Nothing;
    }
    if security::hook_for_some_requests(ctx, &v) {
        return Verdict::Unknown(UnknownReason::Unresolved);
    }
    // By what the definitions do: no word of its name makes it a guard or opens it.
    if itself && let Some(root) = security::proving_root(ctx, &v) {
        if external(&root) {
            // It is a guard by a library guard it calls: in the shapes the list
            // understands only.
            let under = library_calls_under(cx, &v, &root);
            return match under.as_slice() {
                [] => Verdict::Unknown(UnknownReason::NotFollowed),
                under => {
                    match agree(under.iter().map(|c| {
                        library_verdict(
                            cx,
                            package,
                            &root,
                            guard_lists::library(&c.callee, Some(c)),
                            depth + 1,
                        )
                    })) {
                        Verdict::Guard(_) => Verdict::Guard(v),
                        // An optional library guard inside a function: what the
                        // function does with the caller it identified is not read.
                        Verdict::Nothing => Verdict::Unknown(UnknownReason::NotFollowed),
                        unknown => unknown,
                    }
                }
            };
        }
        // What proves it is called under a condition, refuses some requests only,
        // or is read off the function that proves (`requireUser.bind(...)`).
        let root_short = root.rsplit_once('#').map_or(root.as_str(), |(_, n)| n);
        let conditional = root != v
            && (security::hook_for_some_requests(ctx, &root)
                || ctx.definition(&root).is_none_or(|r| r.name != root_short)
                || d.conditional_calls.iter().any(|c| {
                    c.split_once(':')
                        .is_some_and(|(_, callee)| same(callee, &root))
                }));
        return if conditional {
            Verdict::Unknown(UnknownReason::Unresolved)
        } else {
            Verdict::Guard(v)
        };
    }
    if !itself
        || security::may_authenticate(ctx, &v)
        || security::answers_not_signed_in(d)
        || security::returns_unresolved(d)
    {
        return Verdict::Unknown(UnknownReason::Unresolved);
    }
    // Called where it stands (`requireRole("admin")`, `wrap(requireUser)`): it is
    // nothing only where what runs is a function written in its own body, and
    // nothing it is given can be what runs.
    if !calls.is_empty()
        && !(file.is_some_and(|f| f.returns_function(d))
            && calls.iter().all(|c| given_only_data(cx, c)))
    {
        return Verdict::Unknown(UnknownReason::NotFollowed);
    }
    let mut seen = BTreeSet::new();
    if reads_to_nothing(cx, &v, &mut seen, depth) {
        Verdict::Nothing
    } else {
        Verdict::Unknown(UnknownReason::NotFollowed)
    }
}

/// The binding a builder chain starts from: `src/trpc.ts#publicProcedure` of
/// `src/trpc.ts#publicProcedure.input().use()`.
fn builder_base(derives_from: &str) -> &str {
    let Some(open) = derives_from.find('(') else {
        return derives_from;
    };
    match derives_from[..open].rfind('.') {
        Some(dot) => &derives_from[..dot],
        None => derives_from,
    }
}

/// A function written in place as a builder's step, read by the facts of the
/// binding it is written in: the guard where a check no branch makes conditional
/// answers "not signed in"; anything else is not proven, since the binding's facts
/// are not the function's alone.
fn own_body(d: &Symbol) -> Verdict {
    use drift_core::CheckOutcome::{SignInRedirect, Unauthenticated};
    let mut signs_in = d
        .body_checks
        .iter()
        .filter(|c| matches!(c.outcome, Unauthenticated | SignInRedirect));
    if signs_in.any(|c| !c.conditional) {
        Verdict::Guard(String::new())
    } else {
        Verdict::Unknown(UnknownReason::NotFollowed)
    }
}

/// A binding whose every call is of a library value that never authenticates
/// ([`guard_lists::NEVER_AUTHENTICATES`]), and that calls something.
fn made_only_by_what_never_authenticates(d: &Symbol) -> bool {
    !d.calls.is_empty()
        && d.calls.iter().all(|c| {
            let c = c.trim_end_matches("(new)");
            guard_lists::library(c, None) == Library::Never
        })
}

/// A call given nothing that could be what runs in its place: literals, bindings of
/// the repository that are no functions, and what a package that is on no guard
/// list built (`validate(z.object({ ... }))`).
fn given_only_data(cx: &Cx<'_>, call: &GuardCall) -> bool {
    fn data(cx: &Cx<'_>, a: &CallArg) -> bool {
        match a {
            CallArg::Text(_) | CallArg::Bool(_) | CallArg::Number(_) | CallArg::Null => true,
            CallArg::List(l) => l.iter().all(|x| data(cx, x)),
            CallArg::Object(o) => o.iter().all(|(_, x)| data(cx, x)),
            CallArg::Ref(r) if external(r) => {
                r.starts_with("pkg:")
                    && matches!(
                        guard_lists::library(r, None),
                        Library::Unlisted | Library::Never
                    )
            }
            CallArg::Ref(r) => cx.context().definition(r).is_some_and(|d| {
                matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
                    && d.calls.iter().all(|c| !c.ends_with("(ref)"))
                    && listed_callees(d).is_empty()
            }),
            CallArg::Call(c) => {
                c.callee.starts_with("pkg:")
                    && matches!(
                        guard_lists::library(&c.callee, None),
                        Library::Unlisted | Library::Never
                    )
                    && !crate::practices::of_an_auth_library(&c.callee)
                    && c.args.iter().flatten().all(|x| data(cx, x))
            }
            CallArg::Function | CallArg::Spread | CallArg::Unread => false,
        }
    }
    call.args.iter().flatten().all(|a| data(cx, a))
}

/// The calls of the library guard `root` made by `value` and by what it is built on
/// or calls, as [`security::authenticates`] searches: each with its shape, where one
/// was recorded.
fn library_calls_under<'a>(cx: &Cx<'a>, value: &str, root: &str) -> Vec<&'a GuardCall> {
    let ctx = cx.context();
    let mut out: Vec<&GuardCall> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut queue: Vec<(String, usize)> = vec![(value.to_string(), 0)];
    while let Some((r, hops)) = queue.pop() {
        if hops > 6 || seen.len() > 64 || !seen.insert(r.clone()) || external(&r) {
            continue;
        }
        let (Some(d), Some(file)) = (ctx.definition(&r), file_of(cx, &r)) else {
            continue;
        };
        out.extend(
            file.guard_calls_of(d)
                .iter()
                .filter(|c| same(&c.callee, root)),
        );
        let mut next = |r: &str| {
            queue.push((crate::mine::norm_ref(r).into_owned(), hops + 1));
        };
        if !d.derives_from.is_empty() {
            next(&d.derives_from);
        }
        for w in &d.wraps {
            next(&w.wrapper);
        }
        for c in &d.calls {
            next(c.trim_end_matches("(ref)").trim_end_matches("(new)"));
        }
    }
    out
}

/// The function `value` of the repository is read to the end and nothing in it can
/// refuse a request: it has no check that answers "not signed in" or "not allowed",
/// no rejection of any kind, no `throw`, no 401 or 403; it does not hand the request
/// on where the facts do not follow; and everything it calls is the runtime's, a
/// package's that is no authentication library, or a function of the repository
/// that is read the same way.
pub fn reads_to_nothing(
    cx: &Cx<'_>,
    value: &str,
    seen: &mut BTreeSet<String>,
    depth: usize,
) -> bool {
    body_reads_to_nothing(cx, value, false, false, seen, depth)
}

/// [`reads_to_nothing`] of a function, or (`held`) of a binding that holds a plain
/// value ([`drift_core::traits::PLAIN_VALUE`]: an object, a list, a map written in
/// the module), a method of which is called: what runs is a built-in's method or
/// a function written in the binding's own value, and the binding's facts are
/// those of every function written in it.
///
/// `lost`: the function runs where nothing waits for it (an asynchronous function
/// called and not awaited, or one whose rejection a handler written in the caller
/// takes), so what it throws stops no one; what it answers still does.
fn body_reads_to_nothing(
    cx: &Cx<'_>,
    value: &str,
    held: bool,
    lost: bool,
    seen: &mut BTreeSet<String>,
    depth: usize,
) -> bool {
    use drift_core::CheckOutcome::{Forbidden, SignInRedirect, Unauthenticated};
    use drift_core::controls;
    let ctx = cx.context();
    let v = crate::mine::norm_ref(value).into_owned();
    // Read once for each way it runs: what was read with its throws lost says
    // nothing of a call that is waited for.
    let key = match lost {
        true => format!("{v}\u{0}"),
        false => v.clone(),
    };
    // Or every `throw` of its own rejects a promise nothing waits for
    // ([`controls::THROWS_LOST`]).
    let own_lost = |d: &Symbol| d.controls.iter().any(|c| c == controls::THROWS_LOST);
    if !seen.insert(key) {
        // Already being read: it adds nothing of its own.
        return true;
    }
    if depth > BODY_DEPTH || seen.len() > BODY_NODES {
        return false;
    }
    let (Some(d), Some(file)) = (ctx.definition(&v), file_of(cx, &v)) else {
        return false;
    };
    let short = v.rsplit_once('#').map_or(v.as_str(), |(_, n)| n);
    let read = match held {
        false => d.kind == SymbolKind::Function,
        true => {
            matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
                && d.traits
                    .iter()
                    .any(|t| t == drift_core::traits::PLAIN_VALUE)
                && d.members.is_empty()
        }
    };
    if !read || d.name != short {
        return false;
    }
    let refuses = d
        .body_checks
        .iter()
        .any(|c| matches!(c.outcome, Unauthenticated | SignInRedirect | Forbidden))
        || d.controls.iter().any(|c| {
            c == controls::REJECTS_CALLER
                || c == controls::HANDLER_REJECTS
                || c == controls::HANDLER_MAY_REJECT
                || (!lost && c.starts_with(controls::RETURNS_REJECTION))
                || (!lost && !own_lost(d) && c == "throw")
        })
        || (!lost && !own_lost(d) && !d.throws.is_empty())
        || d.responses.iter().any(|r| matches!(r.status, 401 | 403))
        || !d.truncated.is_empty()
        || !d.derives_from.is_empty()
        || !d.alias_of.is_empty();
    let recorded = file.symbol_calls(d);
    if refuses || recorded.is_some_and(|r| r.hands_on || !r.verifies.is_empty()) {
        return false;
    }
    d.calls
        .iter()
        .all(|c| harmless_call(cx, recorded, d, c, lost, seen, depth))
}

/// The package's class that gives `class` its `method`: no class of the repository
/// on the line up declares the method, and the line ends in a package's class.
fn package_method(
    ctx: &crate::context::RepoContext,
    class: &str,
    method: &str,
    depth: usize,
) -> Option<String> {
    let d = ctx.definition(class)?;
    let named = class.rsplit_once('#').is_some_and(|(_, n)| n == d.name);
    if depth > MAX_DEPTH
        || !named
        || d.kind != SymbolKind::Class
        || d.members.iter().any(|m| m.name == method)
        || d.declares
            .iter()
            .any(|a| a.split_once('=').map_or(a.as_str(), |(name, _)| name) == method)
    {
        return None;
    }
    let mut bases = d
        .wraps
        .iter()
        .filter(|w| w.kind == drift_core::WrapKind::Extends)
        .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned());
    let base = bases.next()?;
    if bases.next().is_some() {
        return None;
    }
    if base.starts_with("pkg:") {
        return Some(base);
    }
    package_method(ctx, &base, method, depth + 1)
}

/// The methods the language gives every promise.
const PROMISE_METHODS: &[&str] = &["then", "catch", "finally"];

/// A call in a body that is read to turn no one away ([`reads_to_nothing`]): the
/// runtime's, a member of a parameter, a package's that does not authenticate, the
/// application the body hands the request on to, or a function of the repository
/// read the same way. A call that verifies who calls (an authentication library's,
/// a verifying member of the request) is one only where what it throws is caught
/// and every handler of the body swallows it.
fn harmless_call(
    cx: &Cx<'_>,
    recorded: Option<&drift_core::SymbolCalls>,
    body: &Symbol,
    c: &str,
    lost: bool,
    seen: &mut BTreeSet<String>,
    depth: usize,
) -> bool {
    if c.starts_with("unresolved:") {
        return false;
    }
    let callee = c.trim_end_matches("(ref)").trim_end_matches("(new)");
    // No call of an asynchronous function of the repository is waited for
    // ([`drift_core::controls::UNAWAITED`]): what it throws is lost.
    let lost = lost
        || (body
            .controls
            .iter()
            .filter_map(|x| x.strip_prefix(drift_core::controls::UNAWAITED))
            .any(|f| f == callee)
            && cx.context().definition(callee).is_some_and(|d| d.is_async));
    let member = callee.rsplit('.').next().unwrap_or_default();
    let verifies = if callee.starts_with(crate::practices::PARAM_CALLEE) {
        guard_lists::VERIFIER_MEMBERS.contains(&member)
    } else {
        callee.starts_with("pkg:")
            && (crate::practices::of_an_auth_library(callee)
                || crate::practices::authn_callee(callee)
                || !matches!(
                    guard_lists::library(callee, None),
                    Library::Unlisted | Library::Never
                ))
    };
    if verifies {
        // Called only where the request carries a credential: a request that
        // carries none runs past it, whatever it refuses.
        if recorded.is_some_and(|r| r.given_credential.iter().any(|x| x == callee)) {
            return true;
        }
        // Or only where what a function of the repository handed back is there,
        // and that is a credential the request carries or nothing
        // ([`drift_core::controls::GIVEN_RESULT_OF`]).
        let mut by = body
            .controls
            .iter()
            .filter_map(|x| x.strip_prefix(drift_core::controls::GIVEN_RESULT_OF))
            .filter_map(|x| x.split_once('\t'))
            .filter(|(verifier, _)| *verifier == callee)
            .map(|(_, by)| by)
            .peekable();
        if by.peek().is_some()
            && by.all(|f| {
                cx.context().definition(f).is_some_and(|d| {
                    d.controls
                        .iter()
                        .any(|c| c == drift_core::controls::RETURNS_SENT_CREDENTIAL)
                })
            })
        {
            return true;
        }
        let swallowed = !body.catches.is_empty()
            && body.catches.iter().all(|k| {
                k.does
                    .iter()
                    .all(|x| matches!(x.as_str(), "swallow" | "log" | "report"))
            });
        return swallowed && recorded.is_some_and(|r| r.caught.iter().any(|x| x == callee));
    }
    if callee.starts_with(crate::practices::PARAM_CALLEE)
        || callee.starts_with("global#")
        || callee.starts_with("pkg:")
    {
        return true;
    }
    // What refuses only by the value it hands back, where every call of it is a
    // statement of its own: nothing stops the body ([`security::hand_back`]).
    if security::hand_back(cx.context(), body, c) == Some(security::HandBack::Dropped) {
        return true;
    }
    // A class of the repository built here: not read.
    if c.ends_with("(new)") {
        return false;
    }
    // A method of what a function of the repository handed back, where every value
    // it hands back is plain data ([`drift_core::controls::RETURNS_DATA`]:
    // `previous().timestamp.getTime()`): a built-in's method, and the function is
    // read as any other.
    if let Some((made_by, _)) = callee.split_once("().")
        && !made_by.contains('(')
        && cx.context().definition(made_by).is_some_and(|d| {
            d.kind == SymbolKind::Function
                && made_by.rsplit_once('#').is_some_and(|(_, n)| n == d.name)
                && d.controls
                    .iter()
                    .any(|c| c == drift_core::controls::RETURNS_DATA)
        })
    {
        return body_reads_to_nothing(cx, made_by, false, lost, seen, depth + 1);
    }
    // A method a class of the repository declares nowhere on its line, where the
    // line ends in a package's class (`class Challenge extends Model`; then
    // `challenge.save()`): the package's method, as one called on the package's own
    // class is.
    // Whatever of a promise's own methods hangs on the call (`Complaint
    // .findAndCountAll(query).then(tally)`).
    let mut called = callee;
    while let Some((before, method)) = called.rsplit_once("().")
        && PROMISE_METHODS.contains(&method)
    {
        called = before;
    }
    if let Some((class, method)) = called.rsplit_once('.')
        && !method.contains('(')
        && let Some(base) = package_method(cx.context(), class, method, 0)
    {
        return !crate::practices::of_an_auth_library(&base)
            && !crate::practices::authn_callee(&base)
            && matches!(
                guard_lists::library(&base, None),
                Library::Unlisted | Library::Never
            );
    }
    // A promise's own method on the call of an asynchronous function of the
    // repository (`notify(challenge).catch(report)`): the language's, and the
    // function is read as any other.
    if let Some((made_by, method)) = callee.split_once("().")
        && !made_by.contains('(')
        && PROMISE_METHODS.contains(&method)
        && cx.context().definition(made_by).is_some_and(|d| {
            d.is_async && made_by.rsplit_once('#').is_some_and(|(_, n)| n == d.name)
        })
    {
        // What it rejects with goes to the handler a `.catch` hangs on it, which
        // is the body's own code.
        return body_reads_to_nothing(
            cx,
            made_by,
            false,
            lost || method == "catch",
            seen,
            depth + 1,
        );
    }
    // A method of a value the module builds from a package that does not
    // authenticate (`const counter = new Counter(...)`, `const log = createLogger()`;
    // then `counter.labels(code).inc()`, `log.info(...)`): a package's call, as one
    // written through the import is. By what the binding is built from, not by its
    // name.
    let binding = callee
        .split_once('#')
        .map(|(file, path)| {
            let name = &path[..path.find(['.', '(']).unwrap_or(path.len())];
            (format!("{file}#{name}"), path.len() > name.len())
        })
        .filter(|(_, member)| *member);
    // A method of a plain value the module holds (`const seen = []`, `const cache =
    // { get(k) { ... }, put(k, v) { ... } }`; then `seen.forEach(...)`, `cache
    // .get(token)`): read by what is written in the value.
    if let Some((binding, _)) = &binding
        && cx.context().definition(binding).is_some_and(|d| {
            d.traits
                .iter()
                .any(|t| t == drift_core::traits::PLAIN_VALUE)
        })
    {
        return body_reads_to_nothing(cx, binding, true, lost, seen, depth + 1);
    }
    if let Some((binding, _)) = binding
        && cx.context().definition(&binding).is_some_and(|d| {
            matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
                && !d.calls.is_empty()
                && d.calls.iter().all(|c| {
                    let c = c.trim_end_matches("(ref)").trim_end_matches("(new)");
                    c.starts_with("pkg:")
                        && !crate::practices::of_an_auth_library(c)
                        && !crate::practices::authn_callee(c)
                        && matches!(
                            guard_lists::library(c, None),
                            Library::Unlisted | Library::Never
                        )
                })
        })
    {
        return true;
    }
    // The application or router the body hands the request on to.
    if cx.context().definition(callee).is_some_and(|d| {
        matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
            && !d.calls.is_empty()
            && d.calls.iter().all(|c| guard_lists::router_constructor(c))
    }) {
        return true;
    }
    body_reads_to_nothing(cx, callee, false, lost, seen, depth + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> Verdict {
        Verdict::Guard("g".into())
    }

    fn unknown() -> Verdict {
        Verdict::Unknown(UnknownReason::Unclassified)
    }

    #[test]
    fn a_relation_decides_from_its_members() {
        use Relation::{All, Any};
        // One guard among members that all run is the guard.
        assert_eq!(combine(All, "c", &[Verdict::Nothing, guard()]), guard());
        assert_eq!(combine(All, "c", &[unknown(), guard()]), guard());
        assert_eq!(combine(All, "c", &[Verdict::Nothing, unknown()]), unknown());
        assert_eq!(combine(All, "c", &[Verdict::Nothing]), Verdict::Nothing);
        // An `or` is a guard only where every member is, and nothing where one
        // member lets every request through.
        assert_eq!(
            combine(Any, "c", &[guard(), guard()]),
            Verdict::Guard("c".into())
        );
        assert_eq!(
            combine(Any, "c", &[guard(), Verdict::Nothing]),
            Verdict::Nothing
        );
        assert_eq!(
            combine(Any, "c", &[unknown(), Verdict::Nothing]),
            Verdict::Nothing
        );
        assert_eq!(combine(Any, "c", &[guard(), unknown()]), unknown());
        // No member: nothing is proven.
        assert_eq!(combine(Any, "c", &[]), unknown());
        assert_eq!(combine(All, "c", &[]), unknown());
    }

    #[test]
    fn uses_that_disagree_are_unknown() {
        assert_eq!(agree([guard(), guard()].into_iter()), guard());
        assert_eq!(
            agree([Verdict::Nothing, Verdict::Nothing].into_iter()),
            Verdict::Nothing
        );
        assert_eq!(
            agree([guard(), Verdict::Nothing].into_iter()),
            Verdict::Unknown(UnknownReason::Unresolved)
        );
        assert_eq!(agree([guard(), unknown()].into_iter()), unknown());
        assert_eq!(agree(std::iter::empty()), unknown());
    }
}
