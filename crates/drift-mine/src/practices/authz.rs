//! Authorization and tenant scoping (PLAN-R13 §1.2). Population: the entry points whose
//! authentication is not `none` (and not only an explicit public marker).
//!
//! Read from the unit's wrappers and from the bodies it runs, followed into in-repo
//! functions and the methods of its classes (a helper or a service method often holds
//! the check) to a bounded depth and number of bodies ([`AUTHZ_HOPS`],
//! [`AUTHZ_NODES`]); what the deepest body read calls in the repository is unread,
//! never taken for nothing. A method is found through the ways a body gets the
//! instance ([`resolve`]): a parameter typed by the class or by a dependency alias of
//! it, an instance built in place, a `self` attribute, a module-level instance, a base
//! class of the repository.
//! The dependencies around the unit are read too, for what they check ([`Reach`]).
//! Three dimensions in one key:
//! - **role or permission:** `role_guard:<guard>` (a guard, permission class or
//!   metadata decorator for a role: `RolesGuard`, `adminProcedure`,
//!   `permission_required`, DRF `IsAdminUser`), `role_check:<what>` (a 403 on a role
//!   value or a literal, or a call of an in-repo check that proves it rejects and is
//!   named for access: `is_org_admin()`, `canEditProject()`), `permission:<class>`
//!   (another DRF permission class), `policy:<callee>` (CASL, casbin, oso, cerbos);
//! - **tenant scope:** `tenancy_guard:<class>` (a guard or permission class for the
//!   tenant, where its body is read to refuse on one), `tenancy_check:<source>` (a
//!   403/404 on a tenant value),
//!   `tenancy_filter:<key>` (a query filtered by a tenant key from the session, or of
//!   unknown source), `tenancy_requested:<key> (param|header)` (filtered by the tenant
//!   the caller asked for: not enforced unless a check compares it with the session),
//!   `tenancy_literal:<key>`;
//! - **owner scope:** `owner_check:<what>`, `owner_filter:<key>` (`where.userId`).
//!
//! A check in a method or a function below the handler that raises an error class
//! named for a refusal (`if org_id != self.caller.org_id: raise ForbiddenError`) is
//! read from what it compares ([`raised`]) and named by where it is
//! (`tenancy_check:<path>#RuleBook.list_rules`).
//!
//! Unknown [STRICT]: the unit's authentication is unknown; a 403 in the handler's body
//! on something that names neither a role, a tenant nor an owner (`unclassified`);
//! a refusal anywhere the unit's bodies were read that nothing read explains (a 403, a
//! 404 on a comparison, an error class named for a refusal: `unclassified`, with where
//! it is);
//! a tenant read from a header or the route that nothing scopes by (`not_followed`: it
//! may be enforced in a callee whose checks are not followed);
//! a request handed to another service over HTTP by a unit that checks nothing itself
//! (`not_followed`, with the call: what authorises it may be there, and the facts do
//! not say that the caller's own credential goes with it);
//! work handed to a method the facts do not hold, to a binding of unknown type, to a
//! class whose instance's calls are not recorded or to code the facts do not define
//! (`body_unreadable`); a query a method filters by a tenant key with a value of no
//! known source (`unresolved`). None: every body was read and none authorises.

use drift_core::{CheckOutcome, Member, Symbol, SymbolKind};

use super::authn::{self, Authn};
use super::common::{self, REQUEST_KINDS, unit_symbol, unknown, unreadable, use_of};
use super::libraries::{
    NOT_FILTER_KEYS, POLICY_LIBRARIES, names_owner, names_role, names_tenant, permission_verb,
};
use super::{
    Assignment, Backing, Concern, Cx, UnitRef, UnknownReason, Unproven, Use, VariantSource,
    obligation,
};

pub struct Authz;

impl Concern for Authz {
    fn id(&self) -> &'static str {
        super::AUTHZ
    }

    fn unit(&self) -> &'static str {
        "entry_point"
    }

    /// A route behind the accepted check that also scopes its query to the caller is
    /// still behind that check: the checks add up.
    fn additive(&self) -> bool {
        true
    }

    /// A known use is a check proven to run on every request and to compare the caller
    /// with what is asked for ([`obligation`]), except a query scoped to the tenant the
    /// request names or to a fixed one: neither compares anything of the caller.
    fn enforces(&self, uses: &[Use]) -> Option<bool> {
        Some(uses.iter().any(|u| {
            !matches!(
                u.mechanism.as_str(),
                "tenancy_requested" | "tenancy_literal"
            )
        }))
    }

    /// Permissions are the caller's: a background job has no caller.
    fn needs_a_caller(&self) -> bool {
        true
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        common::entries(cx, REQUEST_KINDS)
            .into_iter()
            .filter(|u| {
                if unreadable(cx, u).is_some() {
                    return true;
                }
                let r = authn::read(cx, u);
                r.unknown.is_some() || r.signs_in() || r.found_guard
            })
            .collect()
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        read_unit(cx, unit, &mut None, &mut None)
    }

    fn assign_backed<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> (Assignment, Backing) {
        let mut unproven = None;
        let mut basis = None;
        let a = read_unit(cx, unit, &mut unproven, &mut basis);
        (
            a,
            Backing {
                unproven,
                basis,
                ..Backing::default()
            },
        )
    }

    fn unscoped_key<'a>(
        &self,
        cx: &Cx<'a>,
        unit: &UnitRef<'a>,
        uses: &[Use],
        middleware: Option<&str>,
    ) -> Option<String> {
        unscoped(cx, unit, uses, middleware)
    }
}

/// What `giver` hands back is a value of the caller
/// ([`drift_core::Symbol::caller_args`], after `via`): a dependency that signs the
/// caller in; a function of the repository whose body returns a value of the caller
/// ([`drift_core::controls::RETURNS_CALLER`]: `def current_venue_id(): return
/// get_jwt()["venue_id"]`), one call deep; an attribute of a request-scoped holder
/// that code of the repository binds to one (`g.venue_id = get_jwt()["venue_id"]`
/// in a `before_request`; `holders`: followed once).
fn gives_caller(cx: &Cx<'_>, giver: &str, holders: bool) -> bool {
    gives_caller_at(cx, giver, holders, 0)
}

/// A side of a comparison or a filter, as the lowering writes one
/// ([`drift_core::controls::SIDES`]), is a value of the caller: by its own source,
/// or given by what gives one ([`gives_caller`]).
pub(crate) fn side_is_callers(cx: &Cx<'_>, side: &str) -> bool {
    side == "caller"
        || side
            .strip_prefix("call via ")
            .or_else(|| side.strip_prefix("via "))
            .or_else(|| side.strip_prefix("gives "))
            .is_some_and(|giver| gives_caller(cx, giver, true))
}

/// [`gives_caller`], `depth` dependencies down: a function whose every return
/// reads its value off what its own dependencies gave it
/// ([`drift_core::controls::RETURNS_GIVEN`]: `get_current_user`, which loads the
/// row the verified token names) gives a value of the caller where every one of
/// those dependencies does.
fn gives_caller_at(cx: &Cx<'_>, giver: &str, holders: bool, depth: usize) -> bool {
    let ctx = cx.context();
    let given = |d: &drift_core::Symbol| -> bool {
        let mut from = d
            .controls
            .iter()
            .filter_map(|c| c.strip_prefix(drift_core::controls::RETURNS_GIVEN))
            .peekable();
        depth < 3
            && from.peek().is_some()
            && from.all(|dep| dep != giver && gives_caller_at(cx, dep, false, depth + 1))
    };
    crate::security::authenticates(ctx, giver)
        || (!common::external(giver)
            && ctx.definition(giver).is_some_and(|d| {
                d.kind == drift_core::SymbolKind::Function
                    && d.name == common::short(giver)
                    && (d.controls.iter().any(|c| {
                        c == drift_core::controls::RETURNS_CALLER
                            || c == drift_core::controls::GIVES_CALLER
                    }) || (ctx.since_measured() && given(d)))
            }))
        || (holders
            && ctx.held(giver).is_some_and(|from| {
                from.iter()
                    .any(|via| via.is_empty() || gives_caller_at(cx, via, false, depth + 1))
            }))
}

/// What one entry of a TypeScript body's [`drift_core::Symbol::caller_args`] says the
/// body does with a value of the caller, named: `scope_unread` for a use with no
/// callee ([`drift_core::CALLER_USE_UNREAD`], and a comparison with what a giver
/// hands back), else the callee, where it may scope ([`ts_scopes`]). None for a
/// value bound on a request-scoped holder (it is used where it is read off it),
/// for what a giver hands back that is not the caller's ([`gives_caller`]), and
/// for a callee that is no scope.
fn ts_use<'a>(cx: &Cx<'a>, from: Node<'a>, entry: &str) -> Option<String> {
    let unread = || Some(drift_core::controls::SCOPE_UNREAD.to_string());
    let (callee, via) = match entry.split_once(drift_core::CALLER_ARG_VIA) {
        Some((c, via)) => (c, Some(via)),
        None => (entry, None),
    };
    if let Some(via) = via {
        if !gives_caller(cx, via, true) {
            return None;
        }
        if callee == via {
            return unread();
        }
    }
    if callee.starts_with(drift_core::CALLER_HOLDER_TS) {
        return None;
    }
    if callee == drift_core::CALLER_USE_UNREAD {
        return unread();
    }
    ts_scopes(cx, from, callee).then(|| crate::mine::norm_ref(callee).into_owned())
}

/// What one entry of a Python body's [`drift_core::Symbol::caller_args`] says the
/// body `r` does with a value of the caller, where it may be the scope: compared
/// with what a dependency that signs the caller in gives, or filtered by it, in the
/// body (`scope_unread`, or the body's callee below the unit's own), whatever the
/// key is called; or handed to a query, or to code of the repository that does
/// something with its parameters, or to an object it builds (the callee). Not to a
/// call that writes a row; not what a dependency that gives no identity gives
/// (`Depends(get_db)`). A call that cannot be read is the reach's to name
/// ([`Reach::opaque`]), but in a dependency the reach reads for what it checks only
/// (`r.quiet`), where it may be a query (`db.query(Harvest).filter_by(estate_id=
/// grower.estate_id)` on what `Depends(get_db)` gives). There, code of the
/// repository handed the value is read where the reach follows it, and an object
/// built with it (`RuleBook(caller)`) is read by the methods the unit calls.
fn python_caller_use<'a>(cx: &Cx<'a>, r: &Reached<'a>, entry: &str) -> Option<String> {
    let c = match entry.split_once(drift_core::CALLER_ARG_VIA) {
        Some((c, dep)) if gives_caller(cx, dep, true) => {
            if c == dep {
                return Some(if r.depth == 0 {
                    drift_core::controls::SCOPE_UNREAD.to_string()
                } else {
                    r.callee.clone()
                });
            }
            c
        }
        Some(_) => return None,
        None => entry,
    };
    // A body of the repository that does nothing with its parameters does nothing
    // with the caller's value either.
    let flows = |facts: &[String]| {
        facts.iter().any(|f| {
            f == drift_core::controls::PARAM_FLOWS || f == drift_core::controls::SCOPE_UNREAD
        })
    };
    let scopes = !writes(c)
        && match resolve(cx, r.node, c) {
            // A package's call given a value of the caller (`set_current_tenant(
            // request.user.account)`, django-multitenant) may keep it where the
            // package's queries read it, as a value kept on an object of the module
            // does ([`drift_core::controls::KEEPS_VALUE`]): unless it is on the
            // closed list of what is no scope ([`no_scope`]), since the measured
            // build.
            Callee::Read => {
                data_call(cx, c)
                    || (common::external(c)
                        && cx.context().since_measured()
                        && !no_scope(cx, c)
                        && !conversion(c)
                        // A value bound on a request-scoped holder (`g.venue_id = ...`)
                        // is used where it is read off it.
                        && !drift_core::CALLER_HOLDERS.iter().any(|h| c.starts_with(h)))
            }
            Callee::Opaque(_) => r.quiet,
            Callee::Function(f) => !r.quiet && flows(&f.controls),
            Callee::Method { member, .. } => !r.quiet && flows(&member.unread),
            // What the object keeps of it is used by its methods.
            Callee::Built { .. } => !r.quiet,
        };
    scopes.then(|| crate::mine::norm_ref(c).into_owned())
}

/// A builtin or standard-library call that hands back a value made of what it is
/// given, or a response that answers with it, and keeps nothing: no scope.
fn conversion(c: &str) -> bool {
    let c = crate::mine::norm_ref(c);
    c.starts_with("global#")
        || c.starts_with("pkg:python:")
        || [
            "pkg:django#http.",
            "pkg:django#shortcuts.",
            "pkg:rest_framework#response.",
            "pkg:flask#jsonify",
            "pkg:flask#make_response",
            "pkg:fastapi#responses.",
            "pkg:starlette#responses.",
        ]
        .iter()
        .any(|p| c.starts_with(p))
}

/// The body a reach read does something with a value of its own parameters
/// ([`drift_core::controls::PARAM_FLOWS`]), or is not read to say.
fn flows_parameters(cx: &Cx<'_>, r: &Reached<'_>) -> bool {
    match r.node {
        Node::Member(m) => m
            .unread
            .iter()
            .any(|f| f == drift_core::controls::PARAM_FLOWS),
        Node::Sym(s) => {
            let module = r.callee.split_once('#').map_or("", |(m, _)| m);
            cx.facts
                .files
                .iter()
                .chain(&cx.facts.context_files)
                .find(|x| x.path == module)
                .is_none_or(|x| x.symbol_calls(s).is_some_and(|calls| calls.param_flows))
        }
    }
}

/// A TypeScript body hands a value of the caller to `c`
/// ([`drift_core::Symbol::caller_args`]): what `c` does with it may be the scope,
/// unless `c` is on the closed list of what is no scope ([`no_scope`]), or is a
/// function or method of the repository whose body does nothing with its
/// parameters ([`drift_core::SymbolCalls::param_flows`]). A library's call, a call
/// that cannot be read and an object built with the value all may scope: this is
/// the default, not a list of libraries.
fn ts_scopes<'a>(cx: &Cx<'a>, from: Node<'a>, c: &str) -> bool {
    if no_scope(cx, c) {
        return false;
    }
    let flows = |facts: &[String]| {
        facts.iter().any(|f| {
            f == drift_core::controls::PARAM_FLOWS
                || f == drift_core::controls::SCOPE_UNREAD
                || f == drift_core::MEMBER_HANDS_ON
        })
    };
    match resolve(cx, from, c) {
        Callee::Function(f) => {
            let module = crate::mine::norm_ref(c);
            let module = module.split_once('#').map_or("", |(m, _)| m);
            let file = cx
                .facts
                .files
                .iter()
                .chain(&cx.facts.context_files)
                .find(|x| x.path == module);
            // A body that is not a function's, or whose file is not found, is not
            // read to do nothing with the value.
            f.kind != SymbolKind::Function
                || flows(&f.controls)
                || file.is_none_or(|x| {
                    x.symbol_calls(f)
                        .is_some_and(|calls| calls.param_flows || calls.hands_on)
                })
        }
        Callee::Method { member, .. } => flows(&member.unread),
        Callee::Read | Callee::Opaque(_) | Callee::Built { .. } => true,
    }
}

/// The closed list of callees that are no scope whatever they are given: a
/// logger, an error reporter, a tracer, and what [`NO_SCOPE_LIBRARIES`] names (a
/// rate limiter keyed by the caller, a cache invalidation, a redirect). A binding
/// of the repository built on one of them (`export const logger = pino()`,
/// `export const ratelimit = new Ratelimit(...)`) is one too. The lowering leaves
/// out what it can tell by itself: a response, `console`, a conversion.
fn no_scope(cx: &Cx<'_>, callee: &str) -> bool {
    use super::libraries::{error_reporter, logger_library, tracer};
    let listed = |c: &str| {
        logger_library(c).is_some()
            || error_reporter(c)
            || tracer(c)
            || common::package_root(c)
                .is_some_and(|p| NO_SCOPE_LIBRARIES.iter().any(|l| p == *l || c.contains(&format!("pkg:{l}#"))))
    };
    if listed(callee) {
        return true;
    }
    if common::external(callee) {
        return false;
    }
    cx.context().definition(callee).is_some_and(|d| {
        matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
            && !d.calls.is_empty()
            && d.calls.iter().any(|c| listed(c))
            && d.calls
                .iter()
                .all(|c| listed(c) || common::external(c))
    })
}

/// Packages whose calls key or route by what they are given and scope no rows:
/// rate limiters, Next.js cache invalidation and navigation.
const NO_SCOPE_LIBRARIES: &[&str] = &[
    "@upstash/ratelimit",
    "rate-limiter-flexible",
    "express-rate-limit",
    "limiter",
    "next/cache",
    "next/navigation",
];

/// How one unit does authorization. `unproven`: the check that was found and is not
/// proven to be the unit's, where the unit is unknown for that
/// ([`UnknownReason::CheckNotProven`]).
fn read_unit<'a>(
    cx: &Cx<'a>,
    unit: &UnitRef<'a>,
    unproven: &mut Option<Unproven>,
    found_basis: &mut Option<super::basis::Basis>,
) -> Assignment {
        if let Some(a) = unreadable(cx, unit) {
            return a;
        }
        if let Assignment::Unknown { reason, instrument } = Authn.assign(cx, unit) {
            return unknown(reason, &instrument);
        }
        let reading = authn::read(cx, unit);
        let (UnitRef::Entry { entry, .. }, Some((sfile, s))) = (*unit, unit_symbol(cx, unit))
        else {
            return unknown(UnknownReason::NoSymbol, "");
        };
        if let Some(a) = common::truncated(sfile, s, &["body_checks", "headers", "raise_checks"]) {
            return a;
        }
        let mut ev = Evidence {
            python: sfile.lang == "py",
            dominant: true,
            identifies: false,
            signs_in: reading.uses.iter().map(|u| u.instrument.clone()).collect(),
            ..Evidence::default()
        };
        let classes = common::owning_classes(sfile, s);
        // Python: what stands at each guard position, asked for authorization
        // ([`super::py_authz`]).
        let positions = if ev.python && cx.context().since_measured() {
            super::py_authz::positions(cx, unit, &entry.adapter, s, &classes, &reading)
        } else {
            super::py_authz::Positions::default()
        };
        // Python: the view class of a Django or DRF unit.
        let view = classes
            .first()
            .copied()
            .or((s.kind == SymbolKind::Class).then_some(s));
        for g in &reading.role_guards {
            // A test Django runs before the view is a role guard by what it asks,
            // never by the name of what runs it.
            if positions.no_role.contains(g) || positions.roles.contains(g) {
                continue;
            }
            // A base of the repository whose `dispatch` the view never runs
            // (`Late(LoginRequiredMixin, View, FeatureMixin)`) refuses no one.
            if ev.python
                && cx.context().since_measured()
                && matches!(entry.adapter.as_str(), "django" | "drf")
                && let Some(view) = view
                && view
                    .wraps
                    .iter()
                    .chain(classes.iter().flat_map(|c| &c.wraps))
                    .any(|w| w.kind == drift_core::WrapKind::Extends && crate::mine::norm_ref(&w.wrapper) == g.as_str())
                && !super::py_authz::base_runs(cx, view, g)
            {
                continue;
            }
            // [STRICT]: a library's guard keeps the library's meaning. One of the
            // repository is a role guard where its own body answers 403 on a role
            // value for every request; where only its name says so (`RolesGuard`,
            // `adminProcedure`), it is found by its name, not proven.
            if common::external(g) || role_guard_proven(cx, g) || role_lookup_guard(cx, g) {
                ev.add("role_guard", g, VariantSource::Usage);
            } else if membership_guard(cx, g) {
                // Read from its body, whatever its name says it is for.
                ev.add("membership_guard", g, VariantSource::Usage);
            } else {
                ev.by_name("role_guard", g);
            }
        }
        for g in &positions.roles {
            ev.add("role_guard", g, VariantSource::Vocab);
        }
        // With what the unit's own mount adds (a router mounted more than once).
        let around: Vec<&drift_core::Wrap> = unit
            .mount_wraps()
            .iter()
            .chain(&s.wraps)
            .chain(classes.iter().flat_map(|c| &c.wraps))
            .collect();
        let mut bodies = common::bodies(cx, s);
        let object_checked = object_check_runs(cx, sfile, s, &bodies);
        for w in &around {
            permission_class(cx, &w.wrapper, object_checked, &mut ev);
        }
        let lazy = common::lazy_handlers(cx, sfile, s);
        let unlinked =
            lazy.is_empty() && s.calls.is_empty() && s.controls.iter().any(|c| c == "await");
        bodies.extend(lazy);
        // What builds a handler of the unit from the functions it is given
        // (`app.get("/notes", withUser(async (req, res, user) => ...))`: the
        // unit runs what `withUser` handed back, and the function written there).
        let builders: Vec<&str> = bodies
            .iter()
            .flat_map(|b| &b.calls)
            .filter_map(|c| c.strip_suffix("(ref)")?.strip_suffix("()"))
            .filter(|r| !common::external(r))
            .collect();
        let call_wrappers: Vec<&str> = around
            .iter()
            .filter(|w| w.kind == drift_core::WrapKind::Call)
            .map(|w| w.wrapper.as_str())
            .collect();
        let mut dependencies: Vec<&str> = call_wrappers.clone();
        // Middleware that runs before the handler turns callers away as a dependency
        // does (a 403 unless the caller is an admin): the application's
        // ([`Symbol::app_middleware`]), and the package's Next.js middleware where it
        // covers the route (authentication read it as the unit's guard).
        dependencies.extend(
            s.app_middleware
                .iter()
                .chain(unit.mount_middleware())
                .map(|m| m.trim_start_matches('?'))
                // A Nest guard class of the application is read as the guards of
                // the route are (`reading.role_guards`), not as a function.
                .filter(|m| !common::external(m) && !m.starts_with(drift_core::NEST_GUARD)),
        );
        dependencies.extend(
            reading
                .uses
                .iter()
                .filter(|u| u.mechanism == "middleware" && !common::external(&u.instrument))
                .map(|u| u.instrument.as_str()),
        );
        // Python: the functions of the repository at the guard positions that are
        // no dependency, hook of a blueprint or middleware (a decorator of the
        // view, a hook of the application).
        for body in &positions.bodies {
            if !dependencies.contains(&body.as_str()) {
                dependencies.push(body.as_str());
            }
        }
        // [STRICT] TypeScript: what a composition at a guard position holds
        // (`app.auth([verifyJwt, ownsInvoice])`, a list of guards a binding holds).
        // A member every request runs is read as any other dependency; one of an
        // `or` runs for some requests only, so a check of its own is found and
        // proves nothing.
        let held = if crate::guard_position::applies(sfile) {
            crate::guard_position::held(
                cx,
                sfile,
                s,
                around
                    .iter()
                    .filter(|w| w.kind == drift_core::WrapKind::Call)
                    .map(|w| w.wrapper.as_str())
                    .chain(
                        s.app_middleware
                            .iter()
                            .chain(unit.mount_middleware())
                            .map(|m| m.trim_start_matches('?')),
                    ),
            )
        } else {
            Vec::new()
        };
        for (member, every) in &held {
            if *every {
                if !dependencies.contains(&member.as_str()) {
                    dependencies.push(member.as_str());
                }
            } else if cx.context().definition(member).is_some_and(|d| {
                d.body_checks.iter().any(|c| {
                    matches!(
                        c.outcome,
                        drift_core::CheckOutcome::Forbidden | drift_core::CheckOutcome::NotFound
                    )
                }) || !d.scoped_queries.is_empty()
            }) {
                ev.unknown(UnknownReason::NotFollowed, member.clone());
            }
        }
        // The Python lowering records a call on a local or on what a dependency
        // injects ([`Symbol::receiver_calls`]).
        let receivers = sfile.lang == "py";
        // Python: the methods of the class the route is bound to that run for it,
        // by method resolution order ([`bound_methods`]).
        let bound = if ev.python && cx.context().since_measured() {
            bound_methods(cx, sfile, s)
        } else {
            Bound::default()
        };
        // [STRICT] Python: which methods run is not known (no consistent order, or a
        // class binds one to what is not a `def`): what was not read may check.
        if let Some(class) = &bound.unread {
            ev.unknown(UnknownReason::Unresolved, class.clone());
        }
        let handler = common::canonical(sfile, s);
        let reach = Reach::of(cx, &bodies, &dependencies, receivers, &bound, &handler);
        // What turns a signed-in caller away and nothing read explains, and the call
        // that hands the request to another service: neither is authorization the map
        // can name, and neither leaves the unit a recorded absence.
        let mut refused: Option<String> = None;
        let mut forwards: Option<String> = None;
        let mut scope_unread: Option<String> = None;
        // Python: a body in reach that keeps a value on an object of its module
        // ([`drift_core::controls::KEEPS_VALUE`]).
        let mut kept: Option<String> = None;
        // TypeScript: a use of a value of the caller that nothing classifies as no
        // scope ([`ts_use`]).
        let mut caller_use: Option<String> = None;
        // The uses read from a callee's name ([`calls`]), by index.
        let mut named: Vec<usize> = Vec::new();
        let dominant = reach.dominant();
        // TypeScript: the callee the unit signs the caller in by does nothing with
        // its own parameters (the request aside), so nothing the request chose
        // reaches what it and its callees do with the caller's values: that is
        // identification, not a scope of the unit's rows. One that does something
        // with a parameter (`requireMember(params.orgId)`) may scope.
        let identifies_only = reach
            .nodes
            .iter()
            .filter(|r| r.signs_in && r.depth == 1)
            .all(|r| !flows_parameters(cx, r));
        ev.around = std::iter::once(format!("{}#{}", sfile.path, s.name))
            .chain(
                dependencies
                    .iter()
                    .map(|d| crate::mine::norm_ref(d).into_owned()),
            )
            .collect();
        // TypeScript: what the wrappers written around the unit hand the function
        // they were given.
        let handed = match !ev.python && cx.context().since_measured() {
            true => {
                let wrappers: Vec<&str> = call_wrappers.iter().chain(&builders).copied().collect();
                handed_by_wrappers(cx, &ev.around, &wrappers)
            }
            false => Vec::new(),
        };
        let mut passed_to = passed(cx, &reach, &ev.around, &handed);
        ev.reads_unscoped = ev.python
            && reach
                .nodes
                .iter()
                .zip(&passed_to)
                .any(|(r, passed)| !r.quiet && reads_unscoped(cx, r, &ev.around, passed));
        // TypeScript: the first query of the unit's own work that selects rows by
        // nothing of the caller ([`ts_unscoped_read`]).
        if !ev.python && cx.context().since_measured() {
            ev.unscoped_read = reach
                .nodes
                .iter()
                .zip(&passed_to)
                // (What the callee the unit signs the caller in by reads, and what
                // that callee calls, is how the caller is identified: a session
                // looked up by its token is no row of the route's.)
                .filter(|(r, _)| !r.quiet && !r.signs_in)
                .filter_map(|(r, passed)| ts_unscoped_read(cx, r, &ev.around, passed))
                .min();
        }
        // TypeScript: the keys named for the caller that a body around the unit
        // binds on the request to what the request sent
        // ([`drift_core::controls::HOLDS_SENT`]: `req.user = req.body.user` in a
        // middleware, a wrapper, the unit's own body or what it calls).
        let sent: std::collections::BTreeSet<&str> = match !ev.python && cx.context().since_measured() {
            true => reach
                .nodes
                .iter()
                .flat_map(|r| held_keys(r.node, drift_core::controls::HOLDS_SENT))
                .collect(),
            false => Default::default(),
        };
        for (i, r) in reach.nodes.iter().enumerate() {
            ev.passed = std::mem::take(&mut passed_to[i]);
            // What this body reads under such a key as who calls is what the
            // request chose: nothing it does with the caller's value is proven.
            ev.sent = held_keys(r.node, drift_core::controls::READS_HELD)
                .find(|k| sent.contains(k))
                .map(str::to_string);
            // [STRICT]: what a body only some requests reach checks is found, not
            // proven: it is not the unit's practice, and it is not dropped either.
            ev.dominant = dominant[i];
            ev.cond = (!dominant[i]).then(|| {
                (
                    r.via.unwrap_or(obligation::UNDER_BRANCH).to_string(),
                    r.via_call.clone(),
                )
            });
            ev.identifies = cx.context().since_measured() && r.signs_in;
            let before = ev.uses.len();
            refused_without_own_row(cx, r, &mut ev);
            checks(cx, r, &mut ev);
            raised(cx, r, &mut ev);
            // A query a dependency runs is the dependency's own work (the row of the
            // api key the caller sent, looked up by the organisation in a header), not
            // the scope of what the route reads or writes: only a check there, which
            // refuses the caller, is the route's.
            if !r.quiet {
                filters(cx, r, &mut ev);
            } else if ev.python
                && cx.context().since_measured()
                // A dependency that signs the caller in looks the caller up: its
                // queries are its own work.
                && !gives_caller(cx, &r.callee, true)
                && (scoped_of(r.node).iter().any(|q| {
                    // A lookup by what the request sent (the api key of the
                    // organisation in a header) is the dependency's own work.
                    !matches!(
                        python_filter(cx, r, &ev, &q.callee, &q.key),
                        Some(Origin::Request)
                    ) && !matches!(q.source.as_str(), "param" | "header")
                }) || r.node.unread(drift_core::controls::SCOPE_UNREAD)
                    // A value of the caller compared or filtered by there, or handed
                    // to what may scope with it, whatever the key is called.
                    || r
                        .node
                        .caller_args()
                        .iter()
                        .any(|c| python_caller_use(cx, r, c).is_some()))
            {
                // [STRICT] Python: what a dependency hands the handler may be the
                // rows the route answers with (`docs = Depends(scoped)`), filtered
                // there by the caller's tenant or by a value that was not read: it
                // is never proven to be the route's scope, and the unit is not a
                // recorded absence either.
                let at = r.callee.clone();
                if scope_unread.as_ref().is_none_or(|x| at < *x) {
                    scope_unread = Some(at);
                }
            }
            let explained = ev.uses.len() > before;
            if r.dependency() {
                // What the dependency itself checks is a guard around the unit.
                for u in &mut ev.uses[before..] {
                    let guard = match u.mechanism.as_str() {
                        "tenancy_check" => "tenancy_guard",
                        "role_check" => "role_guard",
                        _ => continue,
                    };
                    *u = use_of(guard, &r.callee);
                }
            }
            let named_from = ev.uses.len();
            calls(cx, r.node, &mut ev);
            named.extend(named_from..ev.uses.len());
            // A dependency that turns a signed-in caller away on what the map cannot
            // name (`require_feature` answering 403 unless the caller's plan has the
            // feature) refuses as the handler's own body would: read for it too.
            if !explained
                && let Some(what) = refusal(r.node, r.quiet)
                    .or_else(|| cut_short(r.node))
                    .or_else(|| caller_refusal(cx, r, &ev))
            {
                let at = if r.depth == 0 { what } else { r.callee.clone() };
                if refused.as_ref().is_none_or(|x| at < *x) {
                    refused = Some(at);
                }
            }
            if ev.python
                && cx.context().since_measured()
                && r.node.unread(drift_core::controls::KEEPS_VALUE)
            {
                let at = if r.depth == 0 {
                    drift_core::controls::KEEPS_VALUE.to_string()
                } else {
                    r.callee.clone()
                };
                if kept.as_ref().is_none_or(|x| at < *x) {
                    kept = Some(at);
                }
            }
            if r.quiet {
                continue;
            }
            // A comparison or a filter by a tenant or an owner key that no fact
            // records may be the scope.
            if r.node.unread(drift_core::controls::SCOPE_UNREAD) {
                let at = if r.depth == 0 {
                    drift_core::controls::SCOPE_UNREAD.to_string()
                } else {
                    r.callee.clone()
                };
                if scope_unread.as_ref().is_none_or(|x| at < *x) {
                    scope_unread = Some(at);
                }
            }
            // A value of the caller handed to a query, or to code of the repository
            // (read below, where it is followed): what is done with it may be the
            // scope. Not to a call that writes a row.
            for c in r.node.caller_args() {
                // What a dependency gives is the caller's where it signs the
                // caller in (`Depends(get_db)` gives no identity); what a helper
                // or a holder gives, where it is a value of the caller there.
                // TypeScript: every use of a value of the caller is one, but those on
                // the closed list of what is no scope ([`ts_use`]).
                if !ev.python {
                    // What the callee the unit signs the caller in by does with a
                    // value of the caller, and what that callee calls, is how the
                    // caller is identified.
                    if r.signs_in && identifies_only {
                        continue;
                    }
                    if let Some(mut named) = ts_use(cx, r.node, c) {
                        // In a body below the unit's own, by the callee it is in.
                        if r.depth > 0 && named == drift_core::controls::SCOPE_UNREAD {
                            named = r.callee.clone();
                        }
                        if caller_use.as_ref().is_none_or(|x| named < *x) {
                            caller_use = Some(named);
                        }
                    }
                    continue;
                }
                if let Some(at) = python_caller_use(cx, r, c)
                    && scope_unread.as_ref().is_none_or(|x| at < *x)
                {
                    scope_unread = Some(at);
                }
            }
            // Named by the function of the repository that hands it on, not by the
            // client's call (`fetch`): that body is where a person reads what goes.
            if !r.signs_in
                && forward(r.node).is_some()
                && let f = reach.holder(r)
                && forwards.as_ref().is_none_or(|x| f < *x)
            {
                forwards = Some(f);
            }
        }
        ev.sent = None;
        // A check that was read where it is says what it compares; the name of the
        // method that holds it says less (`_ensure_access`, whose body compares
        // the row's organisation with the caller's, is a tenant check, not a role
        // check): the name's reading of the same instrument is dropped.
        for i in named.into_iter().rev() {
            let by_name = &ev.uses[i];
            let read = ev.uses.iter().enumerate().any(|(j, u)| {
                j != i && u.instrument == by_name.instrument && u.mechanism != by_name.mechanism
            });
            if read {
                ev.uses.remove(i);
                ev.sources.remove(i);
            }
        }
        ev.cond = None;
        ev.dominant = true;
        // Python: the rows the unit hands its data session are the caller's own
        // record, or rows it builds as the caller's ([`kept_rows`]).
        // Said of a unit every body of which was read: one that was not may hand
        // the session anything.
        if ev.uses.is_empty()
            && ev.python
            && cx.context().since_measured()
            && reach.opaque.is_none()
            && reach.partly.is_none()
            && !unlinked
        {
            kept_rows(cx, &reach, &mut ev);
        }
        // Python: a guard around the unit that lets a request through only after a
        // query of the caller's membership filtered by a value of the URL held ties
        // that value to the caller ([`tie_found`]): a filter of the unit's own by the
        // route's parameter is then the caller's, not one found and not proven.
        if ev.uses.is_empty()
            && !ev.found.is_empty()
            && ev.python
            && cx.context().since_measured()
        {
            tie_found(cx, entry.route.as_deref(), &around, &reach, &mut ev);
        }
        // Nothing proven, and a check found: the unit is unknown, and what was found
        // is said with it. One read where it is says more than one read by its name.
        if ev.uses.is_empty() && !ev.found.is_empty() {
            // A tenant check before an owner's, a role's and a policy's: it is what
            // most needs a person's eye.
            let rank = |u: &Unproven| {
                let by_name = u.obligation == obligation::BY_NAME_ONLY;
                let kind = match u.check.split_once(':').map_or("", |(m, _)| m) {
                    m if m.starts_with("tenancy") => 0,
                    m if m.starts_with("owner") => 1,
                    m if m.starts_with("role") => 2,
                    _ => 3,
                };
                // One a person can settle by naming it before one the unit only
                // sometimes reaches.
                (by_name, kind, !u.declarable)
            };
            ev.found.sort_by(|a, b| rank(a).cmp(&rank(b)).then(a.cmp(b)));
            let found = ev.found.swap_remove(0);
            let instrument = found
                .check
                .split_once(':')
                .map_or("", |(_, i)| i)
                .to_string();
            *unproven = Some(found);
            return unknown(UnknownReason::CheckNotProven, &instrument);
        }
        let enforced = ev.uses.iter().any(|u| {
            matches!(
                u.mechanism.as_str(),
                "tenancy_check"
                    | "tenancy_filter"
                    | "tenancy_guard"
                    | "tenancy_requested"
                    | "membership_guard"
            )
        });
        if !enforced {
            let header = bodies
                .iter()
                .flat_map(|b| &b.headers)
                .find(|h| names_tenant(h));
            let param = entry.route.as_deref().and_then(tenant_param);
            if let Some(h) = header {
                ev.unknown(UnknownReason::NotFollowed, format!("header:{h}"));
            } else if let Some(p) = param {
                // A callee may enforce the tenant the route names: unknown, unless
                // every body the request runs was read to the end and nothing read
                // checks or scopes it ([`unscoped`]). Then the unit is a recorded
                // absence (if nothing else stands in the way below), and the key is
                // the unscoped key its finding names: a signed-in caller can name
                // any value of it.
                let read_through = ev.uses.is_empty()
                    && reading.signs_in()
                    && unscoped(
                        cx,
                        unit,
                        &[],
                        package_middleware(cx, &sfile.package).as_deref(),
                    )
                    .is_some_and(|k| k == p);
                if !read_through {
                    ev.unknown(UnknownReason::NotFollowed, format!("param:{p}"));
                }
            }
        }
        // Python: a handler that hands back who calls and touches nothing else
        // serves the caller's own record: there is no one else's to ask about.
        if ev.uses.is_empty()
            && ev.python
            && cx.context().since_measured()
            && let Some(giver) = serves_own(cx, s, &reach)
        {
            ev.add("own_record", &giver, VariantSource::Usage);
        }
        // A refusal of a body that the map cannot name (`if user == current_user:
        // raise HTTPException(403)` behind a role guard) turns more requests away,
        // never fewer: beside a check every request passes, it changes nothing of
        // what is proven. Alone, it may be the authorization: unknown, as before.
        if ev.uses.iter().any(|u| {
            !matches!(
                u.mechanism.as_str(),
                "tenancy_requested" | "tenancy_literal"
            )
        }) {
            ev.unknowns
                .retain(|(reason, _)| *reason != UnknownReason::Unclassified);
        }
        ev.unknowns.sort();
        if let Some((reason, instrument)) = ev.unknowns.into_iter().next() {
            return unknown(reason, &instrument);
        }
        if ev.uses.is_empty() {
            // A none means every body the unit runs was read and none authorises
            // [STRICT]: work handed to a class whose method the facts do not hold, to a
            // binding of unknown type or to code the facts do not define is unknown.
            if let Some(o) = reach.opaque {
                return unknown(UnknownReason::BodyUnreadable, &o);
            }
            // What stopped the reading is a method of a value the facts do not type,
            // inside a body that was read: the instrument is that body.
            if let Some(h) = reach.partly {
                return unknown(UnknownReason::PartlyRead, &h);
            }
            // The body awaits what it loads without naming it (a lazy handler no
            // import links): it was not read.
            if unlinked {
                return unknown(UnknownReason::Dynamic, "");
            }
            // Something read turns a signed-in caller away (a 403, a 404 on a
            // comparison, an error class named for it) on what names neither a role,
            // a tenant nor an owner: it may be the authorization.
            if let Some(r) = refused {
                return unknown(UnknownReason::Unclassified, &r);
            }
            // [STRICT]: a body compares or filters by a tenant or an owner key where
            // the facts do not record it (a comprehension filter, `any(...)`, a
            // relationship of the caller, SQL as text): it may be the scope.
            if let Some(s) = scope_unread {
                return unknown(UnknownReason::Unclassified, &s);
            }
            // A query filtered by a value whose source the facts do not say
            // (`where: { id: ctx.user.id }`) may be the owner's or tenant's scope.
            if let Some(q) = ev.unsourced {
                return unknown(UnknownReason::Unresolved, &q);
            }
            // The request is handed to another service, which may authorise it: the
            // facts do not say that the caller's own credential goes with it.
            if let Some(f) = forwards {
                return unknown(UnknownReason::Forwarded, &f);
            }
            // [STRICT] TypeScript: a value of the caller is compared, or handed to a
            // call that nothing classifies as no scope (an ORM's operator, a query
            // builder, a helper that does something with it): it may be how the
            // rows are scoped to the caller.
            if let Some(c) = caller_use {
                return unknown(UnknownReason::Unclassified, &c);
            }
            // [STRICT] Python: something at a guard position of the route was not
            // read (a decorator, a dependency, a base or a permission class of a
            // package on no list, a value that is not followed). It can check a
            // role, a tenant or an owner as easily as a sign-in.
            if let Some((reason, instrument)) = positions.unread {
                return unknown(reason, &instrument);
            }
            // [STRICT] What the repository configures outside the route and may
            // scope or refuse it: a filter its data library adds to every query, an
            // interceptor that may refuse ([`outside_the_route`]).
            if let Some(why) = outside_the_route(cx, sfile, s) {
                return unknown(UnknownReason::Unclassified, &why);
            }
            // [STRICT] Python: a body the unit runs (the handler, a dependency, a
            // middleware, what they call) keeps a value on an object of its module
            // (a `ContextVar`, a `threading.local()`, a module-level holder): code the
            // route does not call (a repository, an ORM event, a model's manager) may
            // read it to scope the rows to the caller.
            if let Some(k) = kept {
                return unknown(UnknownReason::Unclassified, &k);
            }
            *found_basis = Some(
                super::basis::Basis {
                    bodies: reach.nodes.len(),
                    followed: reach
                        .nodes
                        .iter()
                        .filter(|r| !r.callee.is_empty())
                        .map(|r| r.callee.clone())
                        .collect(),
                    not_read: reach_not_read(cx, &reach, &sfile.package),
                    ..Default::default()
                }
                .finish(),
            );
            return Assignment::None {
                label: super::basis::AUTHZ_NONE.into(),
            };
        }
        common::known(ev.uses, common::source_of(&ev.sources))
    }

/// What the repository configures outside a TypeScript route, on the application,
/// a controller or the data layer, that may scope or refuse it, where the route
/// itself was read to have no check (round 11's default: anything a framework or
/// library lets a repository configure there, which Drift does not model, makes
/// the routes it may reach unknown):
///
/// - a filter a data library adds to the queries it runs
///   ([`drift_core::controls::ORM_FILTER`]: Prisma `$extends`, MikroORM filters,
///   Kysely plugins, Mongoose query middleware, Sequelize scopes, TypeORM
///   subscribers, and any configuration of a data library that registers code on
///   its queries), anywhere in the repository: a client it is added to may be
///   reached under any name;
/// - a NestJS interceptor (`@UseInterceptors` on the route or its controller,
///   `APP_INTERCEPTOR`, `useGlobalInterceptors`), where the repository has an
///   interceptor class whose `intercept` may refuse or uses a value of the caller:
///   which one runs, and whether its check runs before the handler
///   (`next.handle()`), is not read.
///
/// The label names the file that holds it.
fn outside_the_route(
    cx: &Cx<'_>,
    sfile: &drift_core::FileFacts,
    s: &Symbol,
) -> Option<String> {
    if sfile.lang != "ts" {
        return None;
    }
    let files = || cx.facts.files.iter().filter(|f| f.lang == "ts");
    if let Some(f) = files().find(|f| {
            f.symbols.iter().any(|x| {
                x.controls
                    .iter()
                    .any(|c| c == drift_core::controls::ORM_FILTER)
            })
        })
    {
        return Some(format!("{}#orm_filter", f.path));
    }
    let nest = |w: &str| crate::mine::norm_ref(w) == "pkg:@nestjs/common#UseInterceptors";
    let on_route = s.wraps.iter().any(|w| nest(&w.wrapper))
        || common::owning_classes(sfile, s)
            .iter()
            .any(|c| c.wraps.iter().any(|w| nest(&w.wrapper)));
    let global = || {
        files().find(|f| {
            f.imports.iter().any(|i| {
                i.module == "pkg:@nestjs/core" && i.names.iter().any(|n| n == "APP_INTERCEPTOR")
            }) || f.symbols.iter().any(|x| {
                x.calls
                    .iter()
                    .any(|c| c.ends_with(".useGlobalInterceptors"))
            })
        })
    };
    if !on_route && global().is_none() {
        return None;
    }
    // An interceptor of the repository that may refuse, or uses who calls.
    files().find_map(|f| {
        f.symbols.iter().find_map(|x| {
            x.members
                .iter()
                .find(|m| {
                    m.name == "intercept"
                        && (!m.throws.is_empty()
                            || !m.caller_args.is_empty()
                            || !m.body_checks.is_empty()
                            || !m.raise_checks.is_empty())
                })
                .map(|_| format!("{}#{}.intercept", f.path, x.name))
        })
    })
}

/// Python: the methods that run for a route bound to a class-based view, beside
/// what the unit's own symbol holds.
#[derive(Default)]
struct Bound<'a> {
    /// The bound class and the classes of the repository it derives from, in
    /// method resolution order, canonical.
    classes: Vec<String>,
    /// The methods read as bodies of the unit: the member, the name it runs under
    /// (`<defining class>.<method>`), its depth.
    methods: Vec<(&'a Member, String, usize)>,
    /// The methods the unit's own first body (its method, or the class's own
    /// methods it runs) calls on `self` or through `super()`, by index in
    /// `methods`, and whether only some requests make the call.
    called: Vec<(usize, bool)>,
    /// The same between the methods read: caller, callee, conditional.
    edges: Vec<(usize, usize, bool)>,
    /// What makes the methods that run not known: the order Python looks them up
    /// in cannot be worked out, or a class binds one to what is not a `def`.
    unread: Option<String>,
}

/// The methods a framework calls on a class-based view for a request: Flask's
/// `MethodView`/`View`, Django's views and generic views, DRF's views and
/// viewsets. A closed list; any other method runs where one of these, or one it
/// calls on `self`, calls it.
const RUNS: &[&str] = &[
    "dispatch",
    "dispatch_request",
    "setup",
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "initial",
    "check_permissions",
    "check_object_permissions",
    "has_permission",
    "test_func",
    "get_queryset",
    "filter_queryset",
    "get_object",
    "get_context_data",
    "form_valid",
    "list",
    "retrieve",
    "create",
    "update",
    "partial_update",
    "destroy",
    "perform_create",
    "perform_update",
    "perform_destroy",
];

/// Of [`RUNS`], those the framework calls for every request whatever its method,
/// before the handler, with the package that calls each: Django's `View` (and DRF's
/// `APIView`, built on it) runs `setup` and `dispatch`; DRF's `APIView.dispatch`
/// runs `initial`, which runs `check_permissions`; Flask's `View` runs
/// `dispatch_request`.
const RUNS_EVERY_REQUEST: &[(&str, &[&str])] = &[
    ("setup", &["pkg:django#", "pkg:rest_framework#"]),
    ("dispatch", &["pkg:django#", "pkg:rest_framework#"]),
    ("initial", &["pkg:rest_framework#"]),
    ("check_permissions", &["pkg:rest_framework#"]),
    ("dispatch_request", &["pkg:flask#"]),
];

/// [`Bound`] of the unit `s` of `file`: a class-based view (a class symbol), or a
/// method of one (`ReservationView.get`). The methods that run are, by the bound
/// class's method resolution order (C3, [`crate::security::class_order`]), the
/// framework's methods for a class ([`RUNS`]), or for a method the method itself
/// and those the framework runs for every request ([`RUNS_EVERY_REQUEST`]), and
/// every method they call: on `self` from the start of the order, through
/// `super()` from the class after the one that defines the caller, on a class
/// (`Base.dispatch(self, ...)`) from that class. For
/// `bp.add_url_rule(view_func=ReservationView.as_view(...))` the `authorize` that
/// `get` calls is `ReservationView`'s, whatever a subclass overrides; for the
/// subclass's own route it is the override. A method that a package's class before
/// it may define in its place ([`crate::security::Lookup::Found`] `maybe`) is read
/// as one some requests run. A method the class symbol already holds (its own, for
/// a class unit) is not read twice; a method called on `self` is read below the
/// unit, its parameters what the call passes. Where the order cannot be worked out,
/// only the class's own methods are read, and the rest is [`Bound::unread`].
fn bound_methods<'a>(cx: &Cx<'a>, file: &'a drift_core::FileFacts, s: &'a Symbol) -> Bound<'a> {
    use crate::security::{Lookup, Mro};
    let ctx = cx.context();
    let (class_name, method) = match s.kind {
        SymbolKind::Class => (s.name.as_str(), None),
        _ => match s.name.split_once('.') {
            Some((c, m)) if !m.contains('.') => (c, Some(m)),
            _ => return Bound::default(),
        },
    };
    let own = format!("{}#{class_name}", file.path);
    let Some(class) = file
        .symbols
        .iter()
        .find(|x| x.kind == SymbolKind::Class && x.name == class_name)
    else {
        return Bound::default();
    };
    let mut unread: Option<String> = None;
    let order: Vec<Mro<'a>> = match crate::security::class_order(ctx, &own, class) {
        Some(o) => o,
        None => {
            unread = Some(own.clone());
            vec![Mro::Repo(own.clone(), class)]
        }
    };
    let name_of = |at: usize| match &order[at] {
        Mro::Repo(c, _) | Mro::Package(c) => c.as_str(),
    };
    let position = |c: &str| order.iter().position(|x| matches!(x, Mro::Repo(r, _) if r == c));
    // Where a call of the method `m`, defined at `at` in the order, goes: the place
    // to look up from, and the name. `None` for a call of anything else.
    let target = |m: &Member, at: usize, c: &str| -> Option<(usize, String)> {
        let c = crate::mine::norm_ref(c);
        if let Some(name) = c.strip_prefix("global#super().") {
            return (!name.contains('.')).then(|| (at + 1, name.to_string()));
        }
        let (cl, name) = c.rsplit_once('.')?;
        let p = position(cl)?;
        // `super().x()` is also recorded by the first base as written: it is read
        // above, from the class after the caller's.
        if p != at && m.calls.iter().any(|x| x == &format!("global#super().{name}")) {
            return None;
        }
        // On `self` (recorded under the caller's own class): the bound class's.
        Some((if p == at { 0 } else { p }, name.to_string()))
    };
    let mut out: Vec<(&'a Member, String, usize)> = Vec::new();
    let mut queue: Vec<(&'a Member, usize, String, usize, bool)> = Vec::new();
    let add = |m: &'a Member, at: usize, depth: usize, maybe: bool, queue: &mut Vec<_>| {
        match queue
            .iter()
            .position(|(x, ..): &(&Member, usize, String, usize, bool)| std::ptr::eq(*x, m))
        {
            Some(i) => i,
            None => {
                queue.push((m, at, format!("{}.{}", name_of(at), m.name), depth, maybe));
                queue.len() - 1
            }
        }
    };
    let note = |l: Lookup<'a>, unread: &mut Option<String>| match l {
        Lookup::Found { member, at, maybe } => Some((member, at, maybe)),
        Lookup::Unread(at) => {
            if unread.is_none() {
                *unread = Some(name_of(at).to_string());
            }
            None
        }
        Lookup::Absent => None,
    };
    // Edges from the unit's own first body: callee index in the queue, conditional.
    let mut direct: Vec<(usize, bool)> = Vec::new();
    let mut edges: Vec<(usize, usize, bool)> = Vec::new();
    let framework = |prefixes: &[&str]| {
        order.iter().any(|x| {
            matches!(x, Mro::Package(p) if prefixes.iter().any(|f| p.starts_with(f)))
        })
    };
    let roots: Vec<&str> = match method {
        Some(m) => std::iter::once(m)
            .chain(
                RUNS_EVERY_REQUEST
                    .iter()
                    .filter(|(n, by)| *n != m && framework(by))
                    .map(|(n, _)| *n),
            )
            .collect(),
        None => RUNS.to_vec(),
    };
    for name in roots {
        if let Some((member, at, maybe)) = note(crate::security::lookup(&order, 0, name), &mut unread) {
            // A method a package's class may run in its place: some requests only.
            add(member, at, usize::from(maybe), maybe, &mut queue);
        }
    }
    let mut i = 0;
    while i < queue.len() && queue.len() < AUTHZ_NODES {
        let (m, at, _, depth, _) = queue[i].clone();
        for c in m.calls.iter().chain(&m.receiver_calls) {
            let Some((from, name)) = target(m, at, c) else {
                continue;
            };
            let Some((callee, cat, maybe)) =
                note(crate::security::lookup(&order, from, &name), &mut unread)
            else {
                continue;
            };
            if std::ptr::eq(callee, m) {
                continue;
            }
            let to = add(callee, cat, depth + 1, maybe, &mut queue);
            let conditional = maybe
                || Node::Member(m)
                    .conditional_to(c, Node::Member(callee))
                    .is_some();
            edges.push((i, to, conditional));
        }
        i += 1;
    }
    // A class unit's own methods are in its symbol already, and a method unit's own
    // method is its body: what they call is called by the unit's first body.
    let is_body = |q: &(&'a Member, usize, String, usize, bool)| match method {
        None => q.1 == 0,
        Some(m) => q.1 == 0 && q.0.name == m,
    };
    let mut index: Vec<Option<usize>> = Vec::with_capacity(queue.len());
    for q in &queue {
        if is_body(q) {
            index.push(None);
        } else {
            index.push(Some(out.len()));
            out.push((q.0, q.2.clone(), q.3));
        }
    }
    let mut bound_edges = Vec::new();
    for (from, to, conditional) in edges {
        let Some(to) = index[to] else { continue };
        match index[from] {
            None => direct.push((to, conditional || queue[from].4)),
            Some(from) => bound_edges.push((from, to, conditional)),
        }
    }
    // A root that some requests only run is no root.
    for (i, q) in queue.iter().enumerate() {
        if let Some(at) = index[i]
            && q.4
        {
            out[at].2 = out[at].2.max(1);
        }
    }
    direct.sort();
    direct.dedup();
    Bound {
        classes: order
            .iter()
            .filter_map(|x| match x {
                Mro::Repo(c, _) => Some(c.clone()),
                Mro::Package(_) => None,
            })
            .collect(),
        methods: out,
        called: direct,
        edges: bound_edges,
        unread,
    }
}

/// What a unit does for authorization, gathered from its wrappers and the bodies it
/// runs.
#[derive(Default)]
struct Evidence {
    uses: Vec<Use>,
    sources: Vec<VariantSource>,
    unknowns: Vec<(UnknownReason, String)>,
    /// A data call filtered by a key that names no tenant or owner, with a value of
    /// unknown source: the first, by callee.
    unsourced: Option<String>,
    /// Why what is being read does not run for every request to the unit, when it does
    /// not: the obligation that fails and the condition in words. A use added
    /// meanwhile is found, not proven.
    cond: Option<(String, String)>,
    /// The body being read is one the unit runs on every path.
    dominant: bool,
    /// TypeScript: the body being read is how the caller is identified (reached
    /// through what a body takes the caller from, or signs the caller in by): the
    /// rows it looks up by the caller's credential are the caller's session or
    /// record, not rows the route was asked for. A filter there proves a scope
    /// only as it did before the rules that read any key: under a key named for
    /// an owner or a tenant, in a call every request reaches.
    identifies: bool,
    /// The instrument of what is being read is the symbol that holds the check (a
    /// service's method, a helper), not a value compared in the unit's own body:
    /// naming it in `practices:` settles the unit where the unit always runs it
    /// ([`Unproven::declarable`]).
    named: bool,
    /// The unit's own body is Python's: its plain parameters are the request's.
    python: bool,
    /// What the unit signs the caller in by: a call of one is authentication, never a
    /// check found by its name (`requireSession`).
    signs_in: Vec<String>,
    /// The checks found and not proven.
    found: Vec<Unproven>,
    /// The calls of the body being read that the bodies of the reach make, with
    /// what each passes ([`passed`]).
    passed: Vec<Given>,
    /// TypeScript: the key named for the caller the body being read reads as who
    /// calls ([`drift_core::controls::READS_HELD`]) and a body around the unit
    /// binds to what the request sent ([`drift_core::controls::HOLDS_SENT`]):
    /// what the body does with the caller's value is found, not proven.
    sent: Option<String>,
    /// Python: some body of the reach reads rows by nothing of the caller
    /// ([`reads_unscoped`]): a query filtered by the caller beside it scopes that
    /// query, not what the route reads.
    reads_unscoped: bool,
    /// TypeScript: the first query of the reach, by callee, that selects rows by
    /// nothing of the caller ([`ts_unscoped_read`]): a query filtered by the
    /// caller beside it scopes that query, not what the route reads.
    unscoped_read: Option<String>,
    /// The unit's own bodies and the dependencies around it, by canonical name:
    /// where an object whose method the unit runs may be built
    /// ([`caller_attribute`]).
    around: Vec<String>,
}

impl Evidence {
    fn add(&mut self, mechanism: &str, instrument: &str, source: VariantSource) {
        if let Some((obligation, when)) = self.cond.clone() {
            let declarable = self.dominant && self.named;
            self.find(mechanism, instrument, &obligation, &when, declarable);
            return;
        }
        if self.sent.is_some() {
            self.find(
                mechanism,
                instrument,
                obligation::SIDES_NOT_CALLER_AND_RESOURCE,
                "",
                false,
            );
            return;
        }
        self.uses.push(use_of(mechanism, instrument));
        self.sources.push(source);
    }

    /// A check that was found and is not proven to be the unit's.
    fn find(
        &mut self,
        mechanism: &str,
        instrument: &str,
        obligation: &str,
        when: &str,
        declarable: bool,
    ) {
        self.found.push(Unproven {
            check: format!("{mechanism}:{instrument}"),
            obligation: obligation.to_string(),
            when: when.to_string(),
            declarable,
        });
    }

    /// A check only the name of what is called says is one: the name proves nothing
    /// of what the body compares.
    fn by_name(&mut self, mechanism: &str, instrument: &str) {
        match self.cond.clone() {
            // Its answer is asked for only on some paths: naming it settles nothing.
            Some((obligation, when)) => self.find(mechanism, instrument, &obligation, &when, false),
            None => {
                let declarable = self.dominant;
                self.find(mechanism, instrument, obligation::BY_NAME_ONLY, "", declarable)
            }
        }
    }

    /// A query filtered by a tenant or owner key whose value's source the facts do not
    /// say: found, and not proven to be filtered by the caller's own.
    fn unsourced_filter(&mut self, mechanism: &str, key: &str) {
        match self.cond.clone() {
            Some((obligation, when)) => self.find(mechanism, key, &obligation, &when, false),
            None => self.find(
                mechanism,
                key,
                obligation::SIDES_NOT_CALLER_AND_RESOURCE,
                "",
                false,
            ),
        }
    }

    /// A tenant check whose two sides are not proven to be the caller's and the
    /// resource's or the request's, else the check itself.
    fn tenant(&mut self, instrument: &str, sides: bool) {
        // One that only some requests reach says that first, as it did.
        if sides || self.cond.is_some() {
            self.add("tenancy_check", instrument, VariantSource::Usage);
        } else {
            self.find(
                "tenancy_check",
                instrument,
                obligation::SIDES_NOT_CALLER_AND_RESOURCE,
                "",
                false,
            );
        }
    }

    /// An owner check, or one found whose sides are not proven to be the caller's and
    /// the resource's ([`Evidence::tenant`]).
    fn owner(&mut self, instrument: &str, sides: bool) {
        if sides || self.cond.is_some() {
            self.add("owner_check", instrument, VariantSource::Usage);
        } else {
            self.find(
                "owner_check",
                instrument,
                obligation::SIDES_NOT_CALLER_AND_RESOURCE,
                "",
                false,
            );
        }
    }

    /// What is read from here on is a check under its own condition, unless what is
    /// being read is conditional already.
    fn under(&mut self, outer: &Option<(String, String)>, conditional: bool, kind: &str, when: &str) {
        self.cond = outer.clone().or_else(|| {
            conditional.then(|| {
                let kind = if kind.is_empty() {
                    obligation::UNDER_BRANCH
                } else {
                    kind
                };
                (kind.to_string(), when.to_string())
            })
        });
    }

    /// What is read from here on is a check the body makes after `after`, the calls
    /// before it ([`drift_core::BodyCheck::after`]): where one of them may change
    /// data, the check refuses after the effect, and is found, not proven. A check
    /// that is conditional already says that first.
    ///
    /// Of the unit's own work only (`r` is not `quiet`): what a guard around the unit
    /// does before it refuses (a dependency that mirrors the caller's own record
    /// from the identity provider, a middleware that refreshes a session) is the
    /// guard's own, not what the request asked for.
    fn late<'a>(&mut self, cx: &Cx<'a>, r: &Reached<'a>, after: &[String]) {
        if !r.quiet
            && self.cond.is_none()
            && let Some(what) = effect_among(cx, r.node, after)
        {
            self.cond = Some((obligation::AFTER_EFFECT.to_string(), what));
        }
    }

    fn unknown(&mut self, reason: UnknownReason, instrument: String) {
        self.unknowns.push((reason, instrument));
    }
}

/// Calls followed at most below a call for what it changes ([`effect`]).
const EFFECT_HOPS: usize = 3;
/// Bodies read at most for one such question.
const EFFECT_NODES: usize = 24;

/// What a call's own name says it does to data, as the first word of the name
/// (`delete_rule`, `saveAll`, `commit`).
///
/// This list and [`EFFECT_WHOLE_VERBS`] are the one place that decides, for a call
/// whose body is not read, whether a check that follows it comes after a write
/// ([`effect_by_name`]): the lists to extend. A word here only ever keeps a check
/// from being proven (`after_effect`), and the line shown names the call that was
/// taken as the write, so a wrong guess is visible.
const EFFECT_VERBS: &[&str] = &[
    "archive",
    "bulk",
    "charge",
    "commit",
    "decrement",
    "delete",
    "destroy",
    "dispatch",
    "drop",
    "emit",
    "enqueue",
    "grant",
    "increment",
    "insert",
    "patch",
    "persist",
    "publish",
    "purge",
    "refund",
    "remove",
    "revoke",
    "save",
    "send",
    "store",
    "transfer",
    "truncate",
    "update",
    "upload",
    "upsert",
    "write",
];
/// Verbs that say so only as the whole name (`create`, `createMany`, `add`, `post`):
/// `createError`, `add_header` and `set_cookie` build a value.
const EFFECT_WHOLE_VERBS: &[&str] = &["add", "create", "flush", "merge", "post", "push", "put", "set"];

/// The first of `callees` (what a body calls before a check) that may change data:
/// its name, for the line that says so. `None` where every one was read and changes
/// nothing.
fn effect_among<'a>(cx: &Cx<'a>, from: Node<'a>, callees: &[String]) -> Option<String> {
    let mut seen: Vec<Node<'a>> = Vec::new();
    callees
        .iter()
        .find_map(|c| effect(cx, from, c, 0, &mut seen))
}

/// The call taken as a write, as the line names it: its last two names
/// (`db.delete`, `rule.save`, `delete_rule`).
fn effect_name(c: &str) -> String {
    if c == drift_core::AFTER_MORE {
        return String::new();
    }
    let c = crate::mine::norm_ref(c);
    let name = common::short(&c).trim_end_matches("()");
    let mut parts: Vec<&str> = name.rsplit('.').take(2).collect();
    parts.reverse();
    parts.join(".").replace("()", "")
}

/// The call of `c` in the body `from` may change data: the call that is taken as the
/// write ([`effect_name`]), else `None`. A function or a method of the repository
/// does where something it calls does, to [`EFFECT_HOPS`] calls and [`EFFECT_NODES`]
/// bodies; anything else (a library's call, a database client's, a callee that
/// cannot be read, one past the depth read) by what its name says
/// ([`EFFECT_VERBS`]). A name proves nothing, so this only ever keeps a check from
/// being proven: `rule = repo.get_rule(id)` before a check loads the row, and
/// `repo.delete_rule(id)` before it has deleted the row by the time it refuses.
fn effect<'a>(
    cx: &Cx<'a>,
    from: Node<'a>,
    c: &str,
    hop: usize,
    seen: &mut Vec<Node<'a>>,
) -> Option<String> {
    if c == drift_core::AFTER_MORE {
        return Some(String::new());
    }
    // A function handed on by reference is not called here; an error class the body
    // raises and an object built are values.
    if c.ends_with("(ref)") || c.ends_with("(new)") || from.throws().iter().any(|t| t == c) {
        return None;
    }
    // Called only in what the body throws: no request it ran for goes on to a
    // check that follows ([`drift_core::controls::CALLED_LEAVING`]).
    let facts: &[String] = match from {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let callee = crate::mine::norm_ref(c);
    if facts.iter().any(|f| {
        f.strip_prefix(drift_core::controls::CALLED_LEAVING)
            .is_some_and(|x| x == c || x == callee)
    }) {
        return None;
    }
    let node = match resolve(cx, from, c) {
        Callee::Function(d) => Some(Node::Sym(d)),
        Callee::Method { member, .. } => Some(Node::Member(member)),
        Callee::Built { init, .. } => match init {
            Some((_, member)) => Some(Node::Member(member)),
            None => return None,
        },
        Callee::Read | Callee::Opaque(_) => None,
    };
    match node {
        Some(n) if seen.iter().any(|x| x.same(n)) => None,
        Some(n) if hop < EFFECT_HOPS && seen.len() < EFFECT_NODES => {
            seen.push(n);
            n.callees().find_map(|x| effect(cx, n, x, hop + 1, seen))
        }
        _ => effect_by_name(c).then(|| effect_name(c)),
    }
}

/// The callee's own name says it changes data ([`EFFECT_VERBS`],
/// [`EFFECT_WHOLE_VERBS`]).
fn effect_by_name(c: &str) -> bool {
    let name = common::short(c);
    let last = name
        .rsplit('.')
        .next()
        .unwrap_or(name)
        .trim_end_matches("()");
    let words = super::libraries::key_words(last);
    let Some(first) = words.first() else {
        return false;
    };
    let whole = match words.as_slice() {
        [_] => true,
        [_, second] => ["all", "batch", "many", "one"].contains(&second.as_str()),
        _ => false,
    };
    EFFECT_VERBS.contains(&first.as_str())
        || (whole && EFFECT_WHOLE_VERBS.contains(&first.as_str()))
}

/// Calls followed at most below an entry's bodies for its authorization: a handler,
/// its service's method, a helper that loads the row, the function that checks it.
/// What a body at this depth calls in the repository is unread ([`Reach::grow`]).
const AUTHZ_HOPS: usize = 5;
/// Functions read at most for one unit.
const AUTHZ_NODES: usize = 48;
/// Aliases and instances followed at most from a callee to the method it runs.
const BINDING_HOPS: usize = 4;

/// What one hop of a reach is read from: a function's body, or one method of a class
/// ([`drift_core::Member`]: its own checks and calls).
#[derive(Clone, Copy)]
enum Node<'a> {
    Sym(&'a Symbol),
    Member(&'a Member),
}

impl<'a> Node<'a> {
    fn calls(self) -> &'a [String] {
        match self {
            Node::Sym(s) => &s.calls,
            Node::Member(m) => &m.calls,
        }
    }
    /// Method calls on a receiver `calls` does not hold
    /// ([`Symbol::receiver_calls`]): on a local bound to a call, on what a
    /// dependency injects, and those whose receiver cannot be told.
    fn receiver_calls(self) -> &'a [String] {
        match self {
            Node::Sym(s) => &s.receiver_calls,
            Node::Member(m) => &m.receiver_calls,
        }
    }
    /// Why the body calls `callee` only for some requests, when it does
    /// ([`Symbol::conditional_calls`]).
    fn conditional(self, callee: &str) -> Option<&'a str> {
        let listed = match self {
            Node::Sym(s) => &s.conditional_calls,
            Node::Member(m) => &m.conditional_calls,
        };
        listed
            .iter()
            .filter_map(|e| e.split_once(':'))
            .find(|(_, c)| *c == callee)
            .map(|(why, _)| why)
    }
    /// Why the body's call of `callee`, which runs `to`, does not run or does not
    /// finish for every request. A call whose value is dropped
    /// ([`drift_core::not_always::NOT_AWAITED`]) counts only where what runs is
    /// `async`: the linker lists it for a callee it could not resolve itself.
    fn conditional_to(self, callee: &str, to: Node<'a>) -> Option<&'a str> {
        self.conditional(callee)
            .filter(|why| *why != drift_core::not_always::NOT_AWAITED || to.is_async())
    }
    /// The function or method is declared `async` ([`Symbol::is_async`]).
    fn is_async(self) -> bool {
        match self {
            Node::Sym(s) => s.is_async,
            Node::Member(m) => m.is_async,
        }
    }
    /// Everything the body calls: [`Self::calls`] and [`Self::receiver_calls`].
    fn callees(self) -> impl Iterator<Item = &'a String> {
        self.calls().iter().chain(self.receiver_calls())
    }
    fn body_checks(self) -> &'a [drift_core::BodyCheck] {
        match self {
            Node::Sym(s) => &s.body_checks,
            Node::Member(m) => &m.body_checks,
        }
    }
    fn raise_checks(self) -> &'a [drift_core::RaiseCheck] {
        match self {
            Node::Sym(s) => &s.raise_checks,
            Node::Member(m) => &m.raise_checks,
        }
    }
    fn throws(self) -> &'a [String] {
        match self {
            Node::Sym(s) => &s.throws,
            Node::Member(m) => &m.throws,
        }
    }
    /// The in-repo decorators on the function or method, outermost first: what runs
    /// around its body when it is called.
    fn decorators(self) -> Vec<&'a str> {
        match self {
            Node::Sym(s) => s
                .wraps
                .iter()
                .filter(|w| w.kind == drift_core::WrapKind::Decorator)
                .map(|w| w.wrapper.as_str())
                .collect(),
            Node::Member(m) => m.decorators.iter().map(String::as_str).collect(),
        }
    }
    /// The body does what no other fact of it records
    /// ([`drift_core::controls::UNREAD_EXIT`], [`drift_core::controls::SCOPE_UNREAD`]).
    /// The callees the body hands a value of the caller to
    /// ([`drift_core::Symbol::caller_args`]).
    fn caller_args(self) -> &'a [String] {
        match self {
            Node::Sym(s) => &s.caller_args,
            Node::Member(m) => &m.caller_args,
        }
    }

    fn unread(self, what: &str) -> bool {
        match self {
            Node::Sym(s) => s.controls.iter().any(|c| c == what),
            Node::Member(m) => m.unread.iter().any(|c| c == what),
        }
    }
    fn same(self, other: Node<'a>) -> bool {
        match (self, other) {
            (Node::Sym(a), Node::Sym(b)) => std::ptr::eq(a, b),
            (Node::Member(a), Node::Member(b)) => std::ptr::eq(a, b),
            _ => false,
        }
    }
}

/// One body a reach read.
struct Reached<'a> {
    /// Calls below the entry's own bodies (0).
    depth: usize,
    node: Node<'a>,
    /// The callee it was reached as, by the name of what runs
    /// (`app/services/rules.py#RuleBook.list_rules`); "" for the entry's own bodies.
    callee: String,
    /// A dependency around the unit, or what one calls: read for what it proves, never
    /// for what it leaves unread (its body is not the request's work).
    quiet: bool,
    /// Reached through the callee whose answer the entry's own body signs the caller
    /// in by (`const session = await getSession(); if (!session) return 401`): a
    /// request it sends is how the caller is identified, not the unit's request handed
    /// to another service.
    signs_in: bool,
    /// Why the path it was first reached by does not run for every request, when one
    /// of its calls is conditional ([`Node::conditional`]).
    via: Option<&'a str>,
    /// For a path that follows a call which may change data
    /// ([`obligation::AFTER_EFFECT`]): the call taken as the write.
    via_call: String,
}

impl Reached<'_> {
    /// A dependency around the unit itself, not what it calls.
    fn dependency(&self) -> bool {
        self.quiet && self.depth < AUTHZ_HOPS
    }
}

/// What a callee of a body is, for reading it ([`resolve`]).
enum Callee<'a> {
    /// Nothing of the repository's runs that the facts do not hold: a library's call,
    /// a plain value's method, a value object or an error built.
    Read,
    /// It cannot be read: the instrument to name.
    Opaque(String),
    Function(&'a Symbol),
    /// One method of a class, under the class that defines it.
    Method {
        canonical: String,
        class: &'a Symbol,
        member: &'a Member,
    },
    /// A class of the repository built: its constructor runs there (`init`, where the
    /// class defines one: `RuleBook.__init__` may refuse the caller), and `unread`
    /// names the class when the methods called on the instance are not in the facts.
    Built {
        init: Option<(String, &'a Member)>,
        unread: Option<String>,
    },
}

/// The bodies an entry runs (depth 0) and the in-repo functions and methods they call,
/// to [`AUTHZ_HOPS`]: where a service or helper checks a role or scopes a query. A call
/// of a class's method is read from that method's own facts ([`drift_core::Member`]),
/// through the ways a body gets the instance ([`resolve`]). A call into a class whose
/// method the facts do not hold, into a binding of unknown type, into code the facts
/// do not define, or past [`AUTHZ_NODES`] bodies cannot be read (`opaque`).
///
/// The dependencies around the unit (`Depends(require_org_member)`, a class's
/// `__call__`, a wrapper function) are read too, one call down, for what they prove
/// only: a dependency that opens a database session leaves nothing of the request
/// unread.
struct Reach<'a> {
    nodes: Vec<Reached<'a>>,
    /// The first callee (by name) whose body cannot be read.
    opaque: Option<String>,
    /// The first function or method of the repository (by name) that calls a method
    /// of a value the facts do not type ([`value_member`]): read, except for that.
    partly: Option<String>,
    /// The unit's handler (`path#name`): the function the unit's own bodies are of.
    handler: String,
    /// The calls followed, by the index of the caller's and the callee's node, and
    /// whether the caller makes the call only for some requests.
    edges: Vec<(usize, usize, bool)>,
    /// The nodes the unit itself runs: its bodies and the dependencies around it.
    roots: Vec<usize>,
    /// Python: the classes of the line of the class the route is bound to
    /// ([`Bound::classes`]): a call of a method on `self` names one of them, and
    /// runs the bound class's method of that name, which [`bound_methods`] read.
    bound: Vec<String>,
    /// The nodes before this one are the unit's bodies and the methods of the
    /// bound class [`bound_methods`] read, whose calls on `self` it followed
    /// ([`Bound::called`], [`Bound::edges`]).
    bound_end: usize,
}

impl<'a> Reach<'a> {
    fn of(
        cx: &Cx<'a>,
        bodies: &[&'a Symbol],
        dependencies: &[&str],
        receivers: bool,
        bound: &Bound<'a>,
        handler: &str,
    ) -> Self {
        let mut reach = Reach {
            nodes: bodies
                .iter()
                .map(|b| Reached {
                    depth: 0,
                    node: Node::Sym(b),
                    callee: String::new(),
                    quiet: false,
                    signs_in: false,
                    via: None,
                    via_call: String::new(),
                })
                .chain(bound.methods.iter().map(|(m, callee, depth)| Reached {
                    depth: *depth,
                    node: Node::Member(m),
                    callee: callee.clone(),
                    quiet: false,
                    signs_in: false,
                    via: None,
                    via_call: String::new(),
                }))
                .collect(),
            opaque: None,
            partly: None,
            handler: handler.to_string(),
            edges: Vec::new(),
            // What the framework calls for the request: the unit's bodies, and the
            // bound class's methods it runs ([`RUNS`]).
            roots: (0..bodies.len())
                .chain(
                    bound
                        .methods
                        .iter()
                        .enumerate()
                        .filter(|(_, (_, _, depth))| *depth == 0)
                        .map(|(i, _)| bodies.len() + i),
                )
                .collect(),
            bound: bound.classes.clone(),
            bound_end: bodies.len() + bound.methods.len(),
        };
        // A method unit's own method calls these on `self`: from its first body.
        if !bodies.is_empty() {
            for (i, conditional) in &bound.called {
                reach.edges.push((0, bodies.len() + i, *conditional));
            }
        }
        for (from, to, conditional) in &bound.edges {
            reach
                .edges
                .push((bodies.len() + from, bodies.len() + to, *conditional));
        }
        reach.grow(cx, 0, AUTHZ_NODES, false);
        // [STRICT]: a body that hands a value to a call the facts did not record may
        // have called what a wrapper around it hands it. Where the wrapper builds a
        // class of the repository whose methods cannot be followed, that class is
        // unread. Where the lowering records such a call by its receiver (`receivers`:
        // `svc=Depends(get_service)`, a parameter no annotation types, then
        // `svc.run(id)`, is `get_service().run`), the call itself is followed or
        // unread, and nothing is unrecorded.
        let unrecorded = !receivers
            && bodies.iter().any(|b| {
                b.controls
                    .iter()
                    .any(|c| c == drift_core::controls::UNREAD_CALL)
            });
        let start = reach.nodes.len();
        for w in dependencies {
            let Some((node, callee)) = dependency(cx, w) else {
                continue;
            };
            if unrecorded && matches!(node, Node::Sym(_)) {
                for c in node.calls() {
                    let builds = cx.context().definition(c).is_some_and(|d| {
                        d.kind == SymbolKind::Class && d.name == common::short(c)
                    });
                    if builds
                        && let Callee::Built {
                            unread: Some(class),
                            ..
                        } = resolve(cx, node, c)
                    {
                        reach.unread(class);
                    }
                }
            }
            match reach.nodes.iter().position(|x| x.node.same(node)) {
                Some(at) => reach.roots.push(at),
                None => {
                    reach.roots.push(reach.nodes.len());
                    reach.nodes.push(Reached {
                        depth: AUTHZ_HOPS - 1,
                        node,
                        callee,
                        quiet: true,
                        signs_in: false,
                        via: None,
                        via_call: String::new(),
                    });
                }
            }
        }
        reach.grow(cx, start, start + AUTHZ_NODES, true);
        reach
    }

    /// Per node: every request to the unit runs it. A root does; so does what a node
    /// that does calls on every path of its body ([`Symbol::conditional_calls`] lists
    /// the others), by any chain of such calls.
    fn dominant(&self) -> Vec<bool> {
        let mut d = vec![false; self.nodes.len()];
        for &r in &self.roots {
            d[r] = true;
        }
        loop {
            let mut changed = false;
            for &(from, to, conditional) in &self.edges {
                if d[from] && !conditional && !d[to] {
                    d[to] = true;
                    changed = true;
                }
            }
            if !changed {
                return d;
            }
        }
    }

    /// `c` is a method of a class of the bound class's line ([`Reach::bound`]).
    fn on_self(&self, c: &str) -> bool {
        let c = crate::mine::norm_ref(c);
        c.rsplit_once('.')
            .is_some_and(|(class, _)| self.bound.iter().any(|b| *b == class))
    }

    /// The node of the method of the bound class that a call `c` on `self` runs
    /// ([`bound_methods`] named it `<defining class>.<method>`).
    fn on_self_node(&self, c: &str) -> Option<usize> {
        let c = crate::mine::norm_ref(c);
        let (_, name) = c.rsplit_once('.')?;
        self.nodes.iter().position(|x| {
            matches!(x.node, Node::Member(_))
                && x.callee
                    .rsplit_once('.')
                    .is_some_and(|(class, n)| n == name && self.bound.iter().any(|b| b == class))
        })
    }

    /// Follow the calls of the nodes from `start` on, to at most `limit` nodes.
    fn grow(&mut self, cx: &Cx<'a>, start: usize, limit: usize, quiet: bool) {
        let mut i = start;
        while i < self.nodes.len() {
            let (depth, from) = (self.nodes[i].depth, self.nodes[i].node);
            let through_sign_in = self.nodes[i].signs_in;
            // What a decorator read around a callee calls is not the request's work
            // either.
            let quiet = quiet || self.nodes[i].quiet;
            let at = i;
            i += 1;
            if depth >= AUTHZ_HOPS {
                // [STRICT]: the deepest body read. What it calls in the repository
                // was not read, and may be where the check is: unread, so the unit is
                // not a recorded absence. (Bodies are read breadth first: one that is
                // already among the nodes was read.)
                if !quiet {
                    for c in from.callees() {
                        let c = c.trim_end_matches("(ref)");
                        if self.on_self(c) {
                            continue;
                        }
                        match resolve(cx, from, c) {
                            Callee::Read => {}
                            Callee::Opaque(o) if value_member(cx, from, &o) => {
                                self.unread_in(at)
                            }
                            Callee::Opaque(o) => self.unread(o),
                            Callee::Built { init, unread } => {
                                if let Some(class) = unread {
                                    self.unread(class);
                                }
                                if let Some((canonical, member)) = init
                                    && !self.nodes.iter().any(|x| x.node.same(Node::Member(member)))
                                {
                                    self.unread(canonical);
                                }
                            }
                            Callee::Function(d) => {
                                if !self.nodes.iter().any(|x| x.node.same(Node::Sym(d))) {
                                    self.unread(crate::mine::norm_ref(c).into_owned());
                                }
                            }
                            Callee::Method {
                                canonical, member, ..
                            } => {
                                if !self.nodes.iter().any(|x| x.node.same(Node::Member(member))) {
                                    self.unread(canonical);
                                }
                            }
                        }
                    }
                }
                continue;
            }
            // Where the body's calls first reach one that may change data
            // ([`Symbol::order`], [`drift_core::Member::order`]).
            let order: &[String] = match from {
                Node::Sym(s) if !quiet => &s.order,
                Node::Member(m) if !quiet => &m.order,
                _ => &[],
            };
            let first_effect: Option<(usize, String)> = {
                let mut seen: Vec<Node<'a>> = Vec::new();
                order
                    .iter()
                    .enumerate()
                    .find_map(|(i, o)| effect(cx, from, o, 0, &mut seen).map(|call| (i, call)))
            };
            for c in from.callees() {
                let c = c.trim_end_matches("(ref)");
                // A method of the bound class's line called on `self`: the one that
                // runs is the bound class's, already among the nodes.
                if self.on_self(c) {
                    if at < self.bound_end {
                        continue;
                    }
                    if let Some(to) = self.on_self_node(c) {
                        let conditional = from.conditional_to(c, self.nodes[to].node).is_some();
                        self.edges.push((at, to, conditional));
                    }
                    continue;
                }
                let (node, callee) = match resolve(cx, from, c) {
                    Callee::Read => continue,
                    Callee::Opaque(o) => {
                        if !quiet {
                            if value_member(cx, from, &o) {
                                self.unread_in(at);
                            } else {
                                self.unread(o);
                            }
                        }
                        continue;
                    }
                    Callee::Built { init, unread } => {
                        if let Some(class) = unread
                            && !quiet
                        {
                            self.unread(class);
                        }
                        match init {
                            Some((canonical, member)) => (Node::Member(member), canonical),
                            None => continue,
                        }
                    }
                    Callee::Function(d) => (Node::Sym(d), crate::mine::norm_ref(c).into_owned()),
                    Callee::Method {
                        canonical, member, ..
                    } => (Node::Member(member), canonical),
                };
                // A callee the body first calls after a call that may change data
                // checks what it checks after the effect.
                let late = first_effect.as_ref().is_some_and(|(at, _)| {
                    order
                        .iter()
                        .position(|o| o == c)
                        .is_some_and(|i| i > *at)
                });
                let edge = from
                    .conditional_to(c, node)
                    .or(late.then_some(obligation::AFTER_EFFECT));
                if let Some(to) = self.nodes.iter().position(|x| x.node.same(node)) {
                    self.edges.push((at, to, edge.is_some()));
                    continue;
                }
                // More bodies than are read: what this one does is not known.
                if self.nodes.len() >= limit {
                    if !quiet {
                        self.unread(callee);
                    }
                    continue;
                }
                // The entry's own body answers "not signed in" on what this callee
                // gave it.
                let signs_in = through_sign_in
                    || (depth == 0
                        && from.body_checks().iter().any(|b| {
                            matches!(
                                b.outcome,
                                CheckOutcome::Unauthenticated | CheckOutcome::SignInRedirect
                            ) && crate::mine::norm_ref(&b.source) == callee
                        }))
                    // What the body takes as who calls is how the caller is
                    // identified too, wherever the refusal is written
                    // ([`drift_core::controls::CALLER_FROM`]), and so is a
                    // function that gives the caller by what it returns
                    // ([`drift_core::controls::GIVES_CALLER`]).
                    || (cx.context().since_measured()
                        && (caller_from(from, c, &callee)
                            || matches!(node, Node::Sym(d) if d.controls.iter().any(|x| {
                                x == drift_core::controls::GIVES_CALLER
                                    || x == drift_core::controls::RETURNS_CALLER
                            }))));
                let via = self.nodes[at].via.or(edge);
                let via_call = match (self.nodes[at].via, &first_effect) {
                    (None, Some((_, call))) if late && edge == Some(obligation::AFTER_EFFECT) => {
                        call.clone()
                    }
                    _ => self.nodes[at].via_call.clone(),
                };
                let to = self.nodes.len();
                self.edges.push((at, to, edge.is_some()));
                self.nodes.push(Reached {
                    depth: depth + 1,
                    node,
                    callee,
                    quiet,
                    signs_in,
                    via,
                    via_call: via_call.clone(),
                });
                // The decorators on what is called run around its body
                // (`@require_role("admin")` on a service method, `@admins_only` on a
                // helper): each is read as a dependency around the unit is, for what
                // it checks and for a refusal it cannot name.
                for w in node.decorators() {
                    let Some((decorator, name)) = dependency(cx, w) else {
                        continue;
                    };
                    // A decorator runs wherever what it decorates is called.
                    match self.nodes.iter().position(|x| x.node.same(decorator)) {
                        Some(d) => self.edges.push((to, d, false)),
                        None => {
                            self.edges.push((to, self.nodes.len(), false));
                            self.nodes.push(Reached {
                                depth: AUTHZ_HOPS - 1,
                                node: decorator,
                                callee: name,
                                quiet: true,
                                signs_in: false,
                                via,
                                via_call: via_call.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    fn unread(&mut self, instrument: String) {
        if self.opaque.as_ref().is_none_or(|o| instrument < *o) {
            self.opaque = Some(instrument);
        }
    }

    /// The function or method of the repository a node is the body of: the callee it
    /// was reached by, or the unit's handler for the unit's own bodies.
    fn holder(&self, r: &Reached<'_>) -> String {
        if r.callee.is_empty() {
            self.handler.clone()
        } else {
            r.callee.clone()
        }
    }

    /// The body of node `at` calls a method of a value the facts do not type.
    fn unread_in(&mut self, at: usize) {
        let h = self.holder(&self.nodes[at]);
        if self.partly.as_ref().is_none_or(|o| h < *o) {
            self.partly = Some(h);
        }
    }
}

/// An unreadable callee ([`Callee::Opaque`]) that is a method of a value no definition
/// types, not a function or a method someone wrote:
///
/// - a method of a package's type through a parameter, in a body that also hands a
///   value to a call the facts do not record
///   ([`common::request_call_beside_unrecorded`]: `req.nextUrl.searchParams.get` on a
///   `req: NextRequest`, unread only for what else the body hands on);
/// - a method of a data field of a class of the repository ([`data_field`]), on the
///   class's instance (`self.dest_block.startswith` read as
///   `SignalConnection.dest_block.startswith`), on a module-level instance
///   (`settings.STORAGE_SERVICE_URL.rstrip` on `settings = Settings()`) or on one built
///   in place (`fb.inputs.append` on `fb = FBDefinitionData(name=n)`).
///
/// What blocks the reading there is the value's type, which the facts do not give; the
/// body that calls it is what a person reads, so it is what the unit is unknown for
/// ([`Reach::unread_in`]). The unit stays unknown. A member of a parameter with no
/// type (`server.services.secret.canRevoke`) or of an attribute bound to anything else
/// (an instance `__init__` binds, a method of the class) may be work of the
/// repository, and stays named.
fn value_member(cx: &Cx<'_>, from: Node<'_>, o: &str) -> bool {
    if o.starts_with(common::PARAM_CALLEE) {
        return matches!(from, Node::Sym(b) if common::request_call_beside_unrecorded(b, o));
    }
    let Some((module, rest)) = o.split_once('#') else {
        return false;
    };
    if common::external(o) {
        return false;
    }
    let ctx = cx.context();
    let class_of = |name: &str| {
        ctx.definition(&format!("{module}#{name}"))
            .filter(|d| d.kind == SymbolKind::Class && d.name == name)
    };
    // `X().attr.method`: an attribute of what a class built in place.
    if let Some((head, path)) = rest.split_once("().") {
        return match path.split('.').collect::<Vec<_>>().as_slice() {
            [attr, method] if !head.contains(['.', '(']) && !method.contains('(') => {
                class_of(head).is_some_and(|c| data_field(c, attr))
            }
            _ => false,
        };
    }
    if rest.contains('(') {
        return false;
    }
    match rest.split('.').collect::<Vec<_>>().as_slice() {
        // `Class.attr.method`: an attribute of the class's instance.
        [name, attr, _] if class_of(name).is_some_and(|c| data_field(c, attr)) => true,
        // `value.attr.method` on a module-level instance of one class of the
        // repository (`settings = Settings()`).
        [name, attr, _] => ctx
            .definition(&format!("{module}#{name}"))
            .filter(|d| {
                matches!(d.kind, SymbolKind::Const | SymbolKind::Variable) && d.name == *name
            })
            .and_then(|d| match d.calls.as_slice() {
                [class] if !common::external(class) => ctx.definition(class),
                _ => None,
            })
            .is_some_and(|c| c.kind == SymbolKind::Class && data_field(c, attr)),
        _ => false,
    }
}

/// `attr` is a data field of `class`: the class body binds it ([`Symbol::declares`])
/// to nothing or to a package's call only (`name: str`, `inputs: list[str] =
/// Field(default_factory=list)`), and it is no method of the class. Its value is the
/// field's, not code of the repository.
fn data_field(class: &Symbol, attr: &str) -> bool {
    let mut bound = class
        .declares
        .iter()
        .filter_map(|d| d.split_once('='))
        .filter(|(name, _)| *name == attr)
        .peekable();
    bound.peek().is_some()
        && bound.all(|(_, value)| value.is_empty() || common::external(value))
        && !class.members.iter().any(|m| m.name == attr)
}

/// What the bodies of a reach saw and did not read, where the unit is a recorded
/// absence ([`super::basis`]): a package's function no list has an entry for, called in
/// a body of the request's own work; a construct the facts mark and do not model; and
/// the skipped or unparsed files of the package.
fn reach_not_read(cx: &Cx<'_>, reach: &Reach<'_>, package: &str) -> Vec<super::basis::NotRead> {
    use super::basis::{NotRead, kind};
    let mut out: Vec<NotRead> = Vec::new();
    for r in reach.nodes.iter().filter(|r| !r.quiet) {
        for c in r.node.callees() {
            let c = crate::mine::norm_ref(c.trim_end_matches("(ref)").trim_end_matches("(new)"))
                .into_owned();
            if super::basis::unlisted_package(&c) {
                out.push(NotRead {
                    kind: kind::PACKAGE_FUNCTION.to_string(),
                    what: c,
                    why: "a package's function no list of Drift's has an entry for".to_string(),
                });
            }
        }
        for (control, words) in [
            (
                drift_core::controls::UNREAD_CALL,
                "hands a value to a call the facts do not record",
            ),
            (
                drift_core::controls::LATE_BOUND,
                "a name bound later than its definition",
            ),
        ] {
            if r.node.unread(control) {
                let at = if r.callee.is_empty() { "the handler" } else { r.callee.as_str() };
                out.push(NotRead {
                    kind: kind::NOT_MODELLED.to_string(),
                    what: format!("{at}: {words}"),
                    why: words.to_string(),
                });
            }
        }
    }
    out.extend(super::basis::skipped_in(cx, package));
    out
}

/// The body a dependency or wrapper around a unit runs: the function, or the
/// `__call__` of a class whose instance is the dependency (`Depends(Authorize(...))`).
fn dependency<'a>(cx: &Cx<'a>, wrapper: &str) -> Option<(Node<'a>, String)> {
    if common::external(wrapper) {
        return None;
    }
    let d = cx.context().definition(wrapper)?;
    let canonical = crate::mine::norm_ref(wrapper).into_owned();
    if d.name != common::short(&canonical) {
        return None;
    }
    match d.kind {
        SymbolKind::Function => Some((Node::Sym(d), canonical)),
        // An instance called as a dependency, or a middleware class's `dispatch`.
        SymbolKind::Class => d
            .members
            .iter()
            .find(|m| m.name == "__call__")
            .or_else(|| d.members.iter().find(|m| m.name == "dispatch"))
            .map(|m| (Node::Member(m), canonical)),
        _ => None,
    }
}

/// What `c`, a callee of the body `from`, runs. A method is found through the ways a
/// body gets the instance: a parameter typed by the class or by a dependency alias of
/// it (`RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]`:
/// [`Symbol::alias_of`]), an instance built in place (`OrganizationsService(db)
/// .list_members`), a `self` attribute `__init__` binds, a module-level instance
/// (`service = RuleBook()`), or a base class of the repository that defines it.
fn resolve<'a>(cx: &Cx<'a>, from: Node<'a>, c: &str) -> Callee<'a> {
    resolve_at(cx, from, c, 0)
}

fn resolve_at<'a>(cx: &Cx<'a>, from: Node<'a>, c: &str, hop: usize) -> Callee<'a> {
    let ctx = cx.context();
    let opaque = || Callee::Opaque(crate::mine::norm_ref(c).into_owned());
    let data_or_opaque = || {
        if data_call(cx, c) {
            Callee::Read
        } else {
            opaque()
        }
    };
    // [STRICT]: what the application stored in a framework object's free-form place
    // (`current_app.extensions["projects"].get_checked`, `g.projects.check`) and what
    // a lookup by name handed back (`getattr(service, operation)(...)`) is the
    // repository's code, or anyone's, under a package's name: not read.
    if drift_core::practice::unread_callee(&crate::mine::norm_ref(c)) {
        return opaque();
    }
    if common::external(c) {
        return Callee::Read;
    }
    // An error class the body raises is only raised.
    if from.throws().iter().any(|t| t == c) {
        return Callee::Read;
    }
    if c.starts_with(common::PARAM_CALLEE) {
        return match from {
            Node::Sym(b) if common::request_param_call(b, c) => Callee::Read,
            _ => opaque(),
        };
    }
    // TypeScript's `new X(..)`.
    if let Some(class) = c.strip_suffix("(new)") {
        let name = common::short(class);
        // An error class is only thrown.
        if name.ends_with("Error") || name.ends_with("Exception") {
            return Callee::Read;
        }
        return match ctx.definition(class) {
            Some(d) if d.kind == SymbolKind::Class && d.name == name => built(cx, from, class, d),
            _ if data_call(cx, class) => Callee::Read,
            _ => Callee::Opaque(crate::mine::norm_ref(class).into_owned()),
        };
    }
    let Some((module, rest)) = c.split_once('#') else {
        return opaque();
    };
    // A method of what a call built in place: `Service(db).method`.
    if let Some((head, method)) = rest.split_once("().") {
        let owner = format!("{module}#{head}");
        let plain = |s: &str| !s.contains(['.', '(']);
        return match ctx.definition(&owner) {
            Some(d)
                if d.kind == SymbolKind::Class
                    && d.name == head
                    && plain(head)
                    && plain(method) =>
            {
                method_of(cx, &owner, d, method, true).unwrap_or_else(data_or_opaque)
            }
            // A method of what a function hands back (`get_exporter().run`, on a
            // local bound to the call or on what `Depends(get_exporter)` injects).
            Some(d)
                if d.kind == SymbolKind::Function
                    && d.name == head
                    && plain(head)
                    && plain(method) =>
            {
                handed_back(cx, d, method, hop).unwrap_or_else(opaque)
            }
            // A method of what a module-level factory built on a database library
            // hands back (`SessionLocal = sessionmaker(...)`, then
            // `SessionLocal().close`): the session's.
            Some(d)
                if matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
                    && d.name == head
                    && data_call(cx, &owner) =>
            {
                Callee::Read
            }
            // What a library's method of the class handed back
            // (`RunResponse.model_validate(row).model_dump`, a validated model's):
            // the library's still.
            Some(d)
                if d.kind == SymbolKind::Class
                    && head.split_once('.').is_some_and(|(class, inherited)| {
                        class == d.name
                            && plain(inherited)
                            && matches!(
                                method_of(cx, &format!("{module}#{class}"), d, inherited, true),
                                Some(Callee::Read)
                            )
                    }) =>
            {
                Callee::Read
            }
            _ => data_or_opaque(),
        };
    }
    if rest.contains('(') {
        return data_or_opaque();
    }
    let Some(d) = ctx.definition(c) else {
        return data_or_opaque();
    };
    // The symbol is the longest prefix of the reference the facts define: what is left
    // is the member path called on it.
    let segs: Vec<&str> = rest.split('.').collect();
    let prefix = |k: usize| format!("{module}#{}", segs[..k].join("."));
    let k = (1..=segs.len())
        .find(|k| {
            ctx.definition(&prefix(*k))
                .is_some_and(|x| std::ptr::eq(x, d))
        })
        .unwrap_or(segs.len());
    let (owner, rem) = (prefix(k), &segs[k..]);
    match d.kind {
        // `check.bind(null, user)` builds a function and calls nothing.
        SymbolKind::Function if rem == ["bind"] => opaque(),
        // A member of what a function built, where the function was handed to a
        // call and the binding is what the call gave back (`prisma.user.findMany`
        // of `const prisma = remember("prisma", () => new PrismaClient())`): the
        // function's body is not what runs.
        SymbolKind::Function if !rem.is_empty() && common::built_by_factory(cx, c, d).is_some() => {
            data_or_opaque()
        }
        SymbolKind::Function => Callee::Function(d),
        // [STRICT] Python: a query through a class attribute bound to an instance of
        // a class of the repository that overrides `get_queryset` (Django's `objects
        // = TenantManager()`, which may filter every query of the model by what a
        // thread-local or a context variable holds), by a method the class does not
        // define (`all`, `filter`): what the queries return is decided there, and it
        // is not read.
        SymbolKind::Class
            if rem.len() >= 2
                && ctx.since_measured()
                && owner.contains(".py#")
                && d.declares.iter().any(|x| {
                    x.strip_prefix(&format!("{}=", rem[0])).is_some_and(|class| {
                        !common::external(class)
                            && class
                                .split_once('#')
                                .is_some_and(|(_, name)| !name.contains(['.', '(']))
                            && ctx.definition(class).is_some_and(|k| {
                                k.kind == SymbolKind::Class
                                    && k.members.iter().any(|m| m.name == "get_queryset")
                                    && !k.members.iter().any(|m| m.name == rem[1])
                            })
                    })
                }) =>
        {
            Callee::Opaque(format!("{}.{}", crate::mine::norm_ref(&owner), rem[0]))
        }
        SymbolKind::Class => match rem {
            // Python builds an object by calling its class.
            [] => built(cx, from, &owner, d),
            [method] => method_of(cx, &owner, d, method, false).unwrap_or_else(data_or_opaque),
            // A method of an attribute `__init__` binds, of a class the facts name
            // ([`Symbol::attr_types`]: `repository.db.commit` with `self.db = db`, `db:
            // AsyncSession`), the class's own or one of the repository it extends.
            [attr, method @ ..]
                if hop < BINDING_HOPS
                    && (method.len() == 1 || (!method.is_empty() && ctx.since_measured())) =>
            {
                // What is called on the attribute, a method or a member's
                // (`service.db.user.findMany`, with `db: PrismaClient`).
                let method = method.join(".");
                let of = |s: &'a Symbol| {
                    s.attr_types
                        .iter()
                        .find_map(|t| t.strip_prefix(&format!("{attr}=")))
                };
                let ty = of(d).or_else(|| {
                    ctx.ancestors(&crate::mine::norm_ref(&owner))
                        .iter()
                        .filter_map(|a| ctx.definition(a))
                        .filter(|b| b.kind == SymbolKind::Class)
                        .find_map(of)
                });
                match ty {
                    Some(ty) => resolve_at(cx, from, &format!("{ty}.{method}"), hop + 1),
                    None => data_or_opaque(),
                }
            }
            _ => data_or_opaque(),
        },
        SymbolKind::Const | SymbolKind::Variable if !rem.is_empty() => {
            if hop >= BINDING_HOPS {
                return opaque();
            }
            // A dependency alias: the class it annotates.
            if !d.alias_of.is_empty() {
                let through = format!("{}.{}", d.alias_of, rem.join("."));
                return resolve_at(cx, from, &through, hop + 1);
            }
            if data_call(cx, c) {
                return Callee::Read;
            }
            // Another name for a binding of the repository (`const svc =
            // services.rules;`): the method of what it names.
            if d.calls.is_empty()
                && d.derives_from.contains('#')
                && !common::external(&d.derives_from)
                && !d.derives_from.contains('(')
            {
                let through = format!("{}.{}", d.derives_from, rem.join("."));
                return resolve_at(cx, from, &through, hop + 1);
            }
            // [STRICT]: bound to nothing where it is defined (`rule_book = None`,
            // set by an `init()` at start-up): what the method is called on is not
            // in the facts.
            if d.controls
                .iter()
                .any(|x| x == drift_core::controls::LATE_BOUND)
            {
                return opaque();
            }
            let own: Vec<&String> = d.calls.iter().filter(|x| !common::external(x)).collect();
            match own.as_slice() {
                // Built from a library alone, or a plain value: its methods are the
                // library's. What a framework injects is of a type the facts do not
                // give.
                [] if d.calls.iter().any(|x| injects(x)) => opaque(),
                [] => Callee::Read,
                // A module-level instance of one class of the repository: built
                // from that class, so its own method runs.
                [class] if rem.len() == 1 => match ctx.definition(class) {
                    Some(k) if k.kind == SymbolKind::Class && k.name == common::short(class) => {
                        method_of(cx, class, k, rem[0], true).unwrap_or_else(|| {
                            if data_call(cx, class) {
                                Callee::Read
                            } else {
                                Callee::Opaque(format!(
                                    "{}.{}",
                                    crate::mine::norm_ref(class),
                                    rem[0]
                                ))
                            }
                        })
                    }
                    // Made by a method of a binding that is itself built from a
                    // library alone (`const log = logger.getSubLogger({ ... })`
                    // of `const logger = new Logger(...)`): what a library's
                    // method hands back is the library's. Not what a framework
                    // injects, whose type the facts do not give.
                    _ if !injects(class)
                        && class.split_once('#').is_some_and(|(_, path)| {
                            path.contains('.') && !path.contains('(')
                        })
                        && ctx.definition(class).is_some_and(|k| {
                            matches!(k.kind, SymbolKind::Const | SymbolKind::Variable)
                                && !k.calls.is_empty()
                                && k.calls
                                    .iter()
                                    .all(|x| common::external(x) && !injects(x))
                        }) =>
                    {
                        Callee::Read
                    }
                    _ => opaque(),
                },
                _ => opaque(),
            }
        }
        _ => Callee::Read,
    }
}

/// The method `method` of what a call of the function `f` gives. Where every return
/// of `f` calls one thing for the value ([`Symbol::returns_instance`]): of a class
/// built there, that class's own method (`return ScopedRuleBook(caller)` runs the
/// subclass's, whatever `f` is annotated with); of a function, the method of what
/// that one hands back; of a binding built on a database library (`SessionLocal =
/// sessionmaker(...)`), data access; of a package's, the package's. Else, where `f`
/// is annotated with a class ([`Symbol::returns_type`]), the method an instance typed
/// by that class runs ([`method_of`], not exact: a subclass may override it). `None`
/// where the facts do not say what is handed back.
fn handed_back<'a>(cx: &Cx<'a>, f: &'a Symbol, method: &str, hop: usize) -> Option<Callee<'a>> {
    if hop >= BINDING_HOPS {
        return None;
    }
    let of_class = |class: &str, d: &'a Symbol, exact: bool| {
        method_of(cx, class, d, method, exact).unwrap_or_else(|| {
            if data_call(cx, class) {
                Callee::Read
            } else {
                Callee::Opaque(format!("{}.{method}", crate::mine::norm_ref(class)))
            }
        })
    };
    let ctx = cx.context();
    let built = &f.returns_instance;
    if !built.is_empty() {
        if common::external(built) {
            return Some(Callee::Read);
        }
        if let Some(d) = ctx.definition(built).filter(|d| d.name == common::short(built)) {
            let read = match d.kind {
                SymbolKind::Class => Some(of_class(built, d, true)),
                SymbolKind::Function => handed_back(cx, d, method, hop + 1),
                SymbolKind::Const | SymbolKind::Variable if data_call(cx, built) => {
                    Some(Callee::Read)
                }
                _ => None,
            };
            if read.is_some() {
                return read;
            }
        }
    }
    let typed = &f.returns_type;
    if typed.is_empty() {
        return None;
    }
    if common::external(typed) {
        return Some(Callee::Read);
    }
    let d = ctx
        .definition(typed)
        .filter(|d| d.kind == SymbolKind::Class && d.name == common::short(typed))?;
    Some(of_class(typed, d, false))
}

/// The call is data access the facts name for what it is: a database library's own
/// call, a call on a client binding built from one (`db = PrismaClient()`), or on a
/// model class built on one (Django's `Item.objects.filter`). A class of the
/// repository that only uses a database library in its methods (a repository, a
/// service) is not: what its method does is in the method.
fn data_call(cx: &Cx<'_>, callee: &str) -> bool {
    data_call_at(cx, callee, 0)
}

/// The reference is into the database client a schema of the repository generates
/// ([`drift_core::RepoFacts::generated_clients`]): an import that resolves to no
/// file, written to a path below the directory the schema names (`unresolved:
/// packages/prisma/generated/prisma/client#PrismaClient`, or as a file wrote it
/// from beside that directory, `unresolved:../generated/prisma/client`), or a name
/// a module of the repository hands on from one (`export * from
/// "../generated/prisma/client"`, `import { PrismaClient } from ...` named again).
pub(super) fn generated_client(cx: &Cx<'_>, r: &str) -> bool {
    let generated = &cx.facts.generated_clients;
    if generated.is_empty() {
        return false;
    }
    // The path an unresolved import names is below a generated directory: the
    // whole directory where the import was resolved from the repository's root,
    // its last segments where it was written relative to the importing file.
    let below = |spec: &str| {
        let spec = spec.split('#').next().unwrap_or_default();
        let written: Vec<&str> = spec
            .split('/')
            .filter(|p| !matches!(*p, "" | "." | ".."))
            .collect();
        generated.iter().any(|dir| {
            let dir: Vec<&str> = dir.split('/').collect();
            let relative = spec.starts_with('.');
            match relative {
                false => written.starts_with(&dir),
                // Every segment written before the client's own files is the end
                // of the directory's path.
                true => (1..=dir.len().min(written.len()))
                    .rev()
                    .any(|n| written.starts_with(&dir[dir.len() - n..]) && n >= dir.len().min(2)),
            }
        })
    };
    if let Some(spec) = r.strip_prefix("unresolved:") {
        return below(spec);
    }
    let n = crate::mine::norm_ref(r);
    let Some((module, path)) = n.split_once('#') else {
        return false;
    };
    let name = path.split(['.', '(']).next().unwrap_or_default();
    let ctx = cx.context();
    if ctx.definition(&format!("{module}#{name}")).is_some() {
        return false;
    }
    cx.facts.files.iter().find(|f| f.path == module).is_some_and(|f| {
        f.imports.iter().any(|i| {
            i.module
                .strip_prefix("unresolved:")
                .is_some_and(&below)
                && i.names.iter().any(|x| x == name || x == "*")
        })
    })
}

fn data_call_at(cx: &Cx<'_>, callee: &str, depth: usize) -> bool {
    use super::libraries::data_library;
    if data_library(callee).is_some() || generated_client(cx, callee) {
        return true;
    }
    if common::external(callee) {
        return false;
    }
    let ctx = cx.context();
    let Some(d) = ctx.definition(callee) else {
        return false;
    };
    match d.kind {
        SymbolKind::Const | SymbolKind::Variable => {
            d.calls.iter().any(|c| {
                data_library(c).is_some()
                    || generated_client(cx, c)
                    // Built by a method of a binding of the module that is a
                    // database client (`base.$extends(...)`): the client still.
                    || (depth < BINDING_HOPS
                        && !common::external(c)
                        && c.split_once('#').is_some_and(|(module, path)| {
                            let base = path.split(['.', '(']).next().unwrap_or_default();
                            path.len() > base.len()
                                && base != d.name
                                && ctx
                                    .definition(&format!("{module}#{base}"))
                                    .is_some_and(|b| {
                                        matches!(b.kind, SymbolKind::Const | SymbolKind::Variable)
                                            && b.name == base
                                    })
                                && data_call_at(cx, &format!("{module}#{base}"), depth + 1)
                        }))
            })
        }
        // A class built on a database library, or one the facts hold as a database
        // model (its columns: `Decision.created_at.asc()` orders a query).
        SymbolKind::Class | SymbolKind::Model => callee.split_once('#').is_some_and(|(m, _)| {
            ctx.ancestors(&format!("{m}#{}", d.name))
                .iter()
                .any(|a| data_library(a).is_some())
                || cx
                    .facts
                    .models
                    .iter()
                    .any(|model| model.path == m && model.name == d.name)
        }),
        // A function bound to what a call it was handed to gave back, called through
        // a member: a call on what the function built.
        SymbolKind::Function if depth < BINDING_HOPS => {
            common::built_by_factory(cx, callee, d)
                .is_some_and(|class| data_call_at(cx, class, depth + 1))
        }
        _ => false,
    }
}

/// A callee that hands a body what a framework builds for it (FastAPI's `Depends`).
fn injects(callee: &str) -> bool {
    matches!(
        crate::mine::norm_ref(callee).as_ref(),
        "pkg:fastapi#Depends" | "pkg:fastapi#Security"
    )
}

/// The method `method` of the class `d` (`owner`), where the facts hold it: the
/// class's own, or the one a base class of the repository defines. `Read` for a method
/// of a library base; `None` when no class of the lineage defines it.
///
/// [STRICT]: a protocol or an abstract class declares the method and something else
/// implements it, so what runs is not what the class holds, and a class with a base
/// the facts could not resolve may inherit anything. Where the instance is only typed
/// by the class (a parameter's annotation, a dependency alias, a `self` attribute:
/// not `exact`), it may be a subclass's: `RuleBookDep = Annotated[RuleBook,
/// Depends(get_rule_book)]` whose factory returns `ScopedRuleBook(caller)`. So
/// where a production subclass of the repository defines the method too
/// ([`Cx::overridden`]), which of the two runs is not known, and the method is
/// unread: the base's check would be a false known, its absence a false none.
fn method_of<'a>(
    cx: &Cx<'a>,
    owner: &str,
    d: &'a Symbol,
    method: &str,
    exact: bool,
) -> Option<Callee<'a>> {
    use drift_core::traits::{ABSTRACT, PROTOCOL};
    let ctx = cx.context();
    let owner = crate::mine::norm_ref(owner).into_owned();
    let canonical = format!("{owner}.{method}");
    if d.traits.iter().any(|t| t == PROTOCOL || t == ABSTRACT) {
        return Some(Callee::Opaque(canonical));
    }
    if !exact && cx.overridden(&owner, method) {
        return Some(Callee::Opaque(canonical));
    }
    if let Some(member) = d.members.iter().find(|m| m.name == method) {
        return Some(Callee::Method {
            canonical,
            class: d,
            member,
        });
    }
    let mut library = false;
    for a in ctx.ancestors(&owner) {
        if a.contains(drift_core::UNKNOWN_BASE_NAME) {
            return Some(Callee::Opaque(canonical));
        }
        if common::external(a) {
            library = true;
            continue;
        }
        if let Some(base) = ctx.definition(a)
            && base.kind == SymbolKind::Class
            && let Some(member) = base.members.iter().find(|m| m.name == method)
        {
            return Some(Callee::Method {
                canonical: format!("{a}.{method}"),
                class: base,
                member,
            });
        }
    }
    library.then_some(Callee::Read)
}

/// The class `d` (`class`) built in the body `from`: its constructor runs there, and
/// is read where the class, or the first class of the repository it extends, defines
/// one (a service whose `__init__` answers 403 unless the caller is an admin
/// authorises every route that gets one built).
/// An error class is only raised, a database client is read as data access, and a
/// value object (a dataclass, an enum, a validated model, a class with no method of
/// its own and no base that could give it one) has nothing more to read. Of any other
/// class the methods are what matters:
/// they are read where the facts record them, called on what the call built in place
/// (`Service(db).run` in the same body) or through the `self` attribute a Python
/// `__init__` stores the instance in; otherwise the instance's calls are not in the
/// facts, and the class is unread.
fn built<'a>(cx: &Cx<'a>, from: Node<'a>, class: &str, d: &'a Symbol) -> Callee<'a> {
    use drift_core::traits::{DATACLASS, ENUM, NAMEDTUPLE, TYPEDDICT};
    let ctx = cx.context();
    let canonical = crate::mine::norm_ref(class).into_owned();
    let error = |n: &str| {
        let n = common::short(n);
        n.ends_with("Error") || n.ends_with("Exception")
    };
    let ancestors = ctx.ancestors(&canonical);
    if error(class) || ancestors.iter().any(|a| error(a)) || data_call(cx, class) {
        return Callee::Read;
    }
    let value = d
        .traits
        .iter()
        .any(|t| [DATACLASS, ENUM, NAMEDTUPLE, TYPEDDICT].contains(&t.as_str()))
        || ancestors
            .iter()
            .any(|a| super::libraries::validation_library(a).is_some())
        || (ancestors.is_empty()
            && d.members
                .iter()
                .all(|m| m.name.starts_with("__") || m.name == "constructor"));
    let stored = matches!(from, Node::Member(m) if m.name == "__init__");
    let through = format!("{class}().");
    let called = from.callees().any(|x| x.starts_with(&through));
    // What runs where the class is built: its `__init__` or `constructor`, else the
    // `__post_init__` a dataclass's generated `__init__` calls.
    let constructor = |s: &'a Symbol, owner: &str| {
        s.members
            .iter()
            .find(|m| m.name == "__init__" || m.name == "constructor")
            .or_else(|| {
                s.traits
                    .iter()
                    .any(|t| t == drift_core::traits::DATACLASS)
                    .then(|| s.members.iter().find(|m| m.name == "__post_init__"))
                    .flatten()
            })
            .map(|m| (format!("{owner}.{}", m.name), m))
    };
    let init = constructor(d, &canonical).or_else(|| {
        ancestors.iter().find_map(|a| {
            let base = ctx.definition(a).filter(|b| b.kind == SymbolKind::Class)?;
            constructor(base, a)
        })
    });
    let unread = (!(value || stored || called)).then_some(canonical);
    if init.is_none() && unread.is_none() {
        return Callee::Read;
    }
    Callee::Built { init, unread }
}

/// A permission class or guard wrapper by what it is for: named for a tenant
/// (`HasOrgContext`) or a role, and either proven to reject ([`security::authenticates`])
/// or a DRF permission class (DRF answers 403 when `has_permission` is false).
fn permission_class(cx: &Cx<'_>, w: &str, object_checked: bool, ev: &mut Evidence) {
    let ctx = cx.context();
    // What lets a request through only where the caller is found in what the
    // request names is that check, whatever it is called ([`membership_guard`]).
    if membership_guard(cx, w) {
        ev.add("membership_guard", w, VariantSource::Usage);
        return;
    }
    // And what lets one through only where the caller is found among rows a
    // literal picks is a role, read the same way ([`role_lookup_guard`]).
    if role_lookup_guard(cx, w) {
        ev.add("role_guard", w, VariantSource::Usage);
        return;
    }
    let name = common::short(w).rsplit('.').next().unwrap_or_default();
    if super::libraries::SIGNED_IN_ONLY_CALLEES.contains(&name) {
        return;
    }
    let drf = !common::external(w)
        && ctx.definition(w).is_some()
        && ctx
            .ancestors(&crate::mine::norm_ref(w))
            .iter()
            .any(|a| a.starts_with("pkg:rest_framework#") && a.contains("permissions"));
    // The wrapper itself is what rejects: a dependency that only builds on one that
    // does (`get_workspace_service` depending on the caller's context) is no guard of
    // its own, whatever it is named for.
    let rejects = crate::security::authenticating_root(ctx, w)
        .is_some_and(|root| root == crate::mine::norm_ref(w));
    if !(drf || rejects) {
        return;
    }
    // [STRICT]: a wrapper that rejects someone and is named for a tenant or a role
    // is a guard by its name only (`require_partner_tenant` lets every call that names
    // no partner tenant through): what its body checks is read where the reach follows
    // it, and the name alone is found, not proven. So for a DRF permission class of
    // the repository: the framework answers 403 where `has_permission` is false, and
    // what the method compares (`return obj.account_id == request.user.account_id`)
    // is not in the facts. The library's own classes keep the library's meaning
    // ([`authn::role_guard`]).
    let mechanism = if names_tenant(name) {
        "tenancy_guard"
    } else if names_role(name) {
        "role_guard"
    } else if drf {
        "permission"
    } else {
        return;
    };
    // A class that defines only the object check decides nothing where the view
    // never asks for it: DRF runs `has_object_permission` from `get_object()` and
    // `check_object_permissions()`, not for every request.
    let object_only = drf
        && ctx.definition(w).is_some_and(|d| {
            let has = |n: &str| d.members.iter().any(|m| m.name == n);
            has("has_object_permission") && !has("has_permission")
        });
    if object_only && !object_checked {
        ev.find(mechanism, w, obligation::NOT_CALLED, "", false);
    } else {
        ev.by_name(mechanism, w);
    }
}

/// The sites of a body ([`drift_core::controls::HANDED_AFTER`] and the controls
/// beside it, by `prefix`) are each reached only after a lookup of the caller in
/// what the request names found a row: at every site some call held
/// ([`crate::facts`]) that is the result of a query which, wherever the body makes
/// it, is given a value of the caller under one key and a value read off a
/// parameter or off what the request sent under another
/// ([`drift_core::controls::ARG_VALUE`]). `return Member.objects.filter(member=
/// request.user, workspace__slug=view.slug).exists()` in a permission test; `if
/// not Member.objects.filter(member=request.user, workspace__slug=kwargs["slug"])
/// .exists(): return Response(status=403)` before a wrapper calls the view.
///
/// Nothing names the keys, the model or the guard: the shape of the query and the
/// paths of the body decide. A query made on the result of such a lookup only
/// narrows it, and is read with it. A site nothing held at (`return True` for some
/// requests, the view called under no test) is no such body, nor is one whose
/// query the caller is no part of, or that names nothing of the request (any row
/// of the caller's anywhere).
fn passes_by_lookup(cx: &Cx<'_>, facts: &[String], prefix: &str) -> bool {
    passes_by(cx, facts, prefix, false)
}

/// [`passes_by_lookup`], or (`fixed`) a body that lets a request through only where
/// a lookup found the caller among rows a literal picks, and nothing the request
/// names: `return InstanceAdmin.objects.filter(role__gte=15, user=request.user)
/// .exists()`. The caller holds a place no request chose: a role, whatever the
/// model and the keys are called. A lookup of the caller under no other key (any
/// row of the caller's) says only that the caller has one.
fn passes_by(cx: &Cx<'_>, facts: &[String], prefix: &str, fixed: bool) -> bool {
    let mut sites = facts
        .iter()
        .filter_map(|f| f.strip_prefix(prefix))
        .peekable();
    if sites.peek().is_none() {
        return false;
    }
    // Each query the body makes: the callee, and what each key is given.
    let queries: Vec<(&str, Vec<(&str, &str)>)> = arg_calls(facts.iter())
        .filter(|(_, given)| !given.is_empty())
        .collect();
    let requested = |side: &str| side.starts_with("param") || side == "request";
    // The result of a query that narrows by what it is given (not one that leaves
    // out what matches), every call of which looks the caller up in what the
    // request names.
    let census = row_census(cx, facts);
    let lookup = |result: &str| {
        // A lookup the lowering read off the rows of a model
        // ([`drift_core::controls::LOOKUP_OF`]): every statement of the body that
        // reads that model is one, by a caller the facts prove.
        if let Some(model) = result.strip_suffix(drift_core::controls::LOOKUP_OF) {
            let mut reads = census.iter().filter(|(m, _)| *m == model).peekable();
            return !fixed
                && reads.peek().is_some()
                && reads.all(|(_, by)| {
                    matches!(by, RowsBy::Own(_, side, true) if side_is_caller_self(cx, side))
                });
        }
        let narrows = |q: &str| {
            let method = q.rsplit('.').next().unwrap_or_default();
            QUERY_METHODS.contains(&method)
                && method != "exclude"
                && result
                    .strip_prefix(q)
                    .is_some_and(|rest| rest.is_empty() || rest == "()" || rest.starts_with("()."))
        };
        // A query made on what another of them handed back (`members.filter(
        // role=ADMIN)` on `members = Member.objects.filter(member=request.user,
        // ...)`) narrows the rows the first found: the result is selected by
        // what both are given. What such a link adds is counted where every
        // call of it gives it.
        let continues = |q: &str| {
            queries.iter().any(|(first, _)| {
                narrows(first)
                    && q.strip_prefix(first)
                        .is_some_and(|rest| rest.starts_with("()."))
            })
        };
        let links: Vec<&str> = {
            let mut links: Vec<&str> = queries
                .iter()
                .map(|(q, _)| *q)
                .filter(|q| narrows(q) && continues(q))
                .collect();
            links.sort_unstable();
            links.dedup();
            links
        };
        type Is<'f> = &'f dyn Fn(&str) -> bool;
        let by_a_link = |is: Is<'_>| {
            links.iter().any(|link| {
                queries
                    .iter()
                    .filter(|(q, _)| q == link)
                    .all(|(_, given)| given.iter().any(|(_, side)| is(side)))
            })
        };
        let any_link = |is: Is<'_>| {
            queries
                .iter()
                .filter(|(q, _)| links.contains(q))
                .any(|(_, given)| given.iter().any(|(_, side)| is(side)))
        };
        let mut of = queries
            .iter()
            .filter(|(q, _)| narrows(q) && !continues(q))
            .map(|(_, given)| given)
            .peekable();
        of.peek().is_some()
            && of.all(|given| {
                let has = |is: Is<'_>| given.iter().any(|(_, side)| is(side)) || by_a_link(is);
                has(&|side| side_is_callers(cx, side))
                    && match fixed {
                        false => has(&requested),
                        true => {
                            has(&|side| side == "literal")
                                && !given.iter().any(|(_, side)| requested(side))
                                && !any_link(&requested)
                        }
                    }
            })
    };
    sites.all(|site| site.split('\t').any(lookup))
}

/// A guard of the repository lets a request through only where a lookup found the
/// caller among rows a literal picks ([`passes_by`]): a role guard read from its
/// body, at the same places [`membership_guard`] reads.
fn role_lookup_guard(cx: &Cx<'_>, g: &str) -> bool {
    use drift_core::controls::{HANDED_AFTER, LEAVES_AFTER, TRUE_AFTER};
    let ctx = cx.context();
    if common::external(g) || !ctx.since_measured() {
        return false;
    }
    let Some(d) = ctx.definition(g) else {
        return false;
    };
    match d.kind {
        SymbolKind::Function => {
            passes_by(cx, &d.controls, HANDED_AFTER, true)
                || passes_by(cx, &d.controls, LEAVES_AFTER, true)
        }
        SymbolKind::Class => d
            .members
            .iter()
            .find(|m| m.name == "has_permission")
            .is_some_and(|m| passes_by(cx, &m.unread, TRUE_AFTER, true)),
        _ => false,
    }
}

/// A guard of the repository lets a request through only after a lookup of the
/// caller in what the request names ([`passes_by_lookup`]), read from its body
/// whatever it is called: a decorator's wrapper, wherever it calls the view; a
/// function that refuses, wherever it returns without refusing; a DRF permission
/// class, wherever its `has_permission` may answer true.
fn membership_guard(cx: &Cx<'_>, g: &str) -> bool {
    use drift_core::controls::{HANDED_AFTER, LEAVES_AFTER, TRUE_AFTER};
    let ctx = cx.context();
    if common::external(g) || !ctx.since_measured() {
        return false;
    }
    let Some(d) = ctx.definition(g) else {
        return false;
    };
    match d.kind {
        SymbolKind::Function => {
            passes_by_lookup(cx, &d.controls, HANDED_AFTER)
                || passes_by_lookup(cx, &d.controls, LEAVES_AFTER)
        }
        SymbolKind::Class => d
            .members
            .iter()
            .find(|m| m.name == "has_permission")
            .is_some_and(|m| passes_by_lookup(cx, &m.unread, TRUE_AFTER)),
        _ => false,
    }
}

/// The guard's own body answers 403 on a role value or a literal, for every request
/// it sees (a function's checks, or those of a class's methods). A Python class's
/// methods count only where the framework runs them for a request
/// ([`PY_GUARD_RUNS`]), by the order Python looks them up in, or one of those calls
/// them on `self` on every path: a method nothing calls refuses no one.
fn role_guard_proven(cx: &Cx<'_>, g: &str) -> bool {
    role_guard_proven_at(cx, g, 0)
}

fn role_guard_proven_at(cx: &Cx<'_>, g: &str, depth: usize) -> bool {
    let own = crate::mine::norm_ref(g).into_owned();
    let python = own.split_once('#').is_some_and(|(m, _)| m.ends_with(".py"));
    let refuses = |checks: &[drift_core::BodyCheck]| {
        checks.iter().any(|c| {
            !c.conditional
                && ((c.outcome == CheckOutcome::Forbidden
                    && (names_role(&c.reads) || c.compares == "literal"))
                    // TypeScript: a member of the caller compared with a literal,
                    // refused as "not signed in" (`if (ctx.user?.role !== "ADMIN")
                    // throw new TRPCError({ code: "UNAUTHORIZED" })`): a role
                    // whatever the answer says.
                    || (!python
                        && c.outcome == CheckOutcome::Unauthenticated
                        && c.compares == "literal"
                        && c.op == drift_core::check_op::REFUSES_MISMATCH
                        && !c.reads.is_empty()
                        && whose(&c.source, &c.reads) == Whose::Caller))
        })
    };
    let ctx = cx.context();
    let Some(d) = ctx.definition(g) else {
        return false;
    };
    // TypeScript: a binding built from another by steps that only add to it
    // (`publicProcedure.use(isAdmin)`, `authedProcedure.use(...)`) refuses as the
    // functions its steps are given do, and as what it is built from does.
    if !python
        && depth < BINDING_HOPS
        && matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
        && d.name == common::short(&own)
        && !d.derives_from.is_empty()
    {
        let steps = d.calls.iter().filter_map(|c| c.strip_suffix("(ref)"));
        let base = d
            .derives_from
            .split_once('#')
            .map(|(module, path)| {
                let name = path.split(['.', '(']).next().unwrap_or_default();
                format!("{module}#{name}")
            })
            .filter(|b| *b != own);
        if steps
            .chain(base.as_deref())
            .any(|x| !common::external(x) && role_guard_proven_at(cx, x, depth + 1))
        {
            return true;
        }
    }
    let python_class = d.kind == SymbolKind::Class && d.name == common::short(&own) && python;
    if !python_class || !ctx.since_measured() {
        return refuses(&d.body_checks);
    }
    let Some(order) = crate::security::class_order(ctx, &own, d) else {
        return false;
    };
    let found = |from: usize, name: &str| match crate::security::lookup(&order, from, name) {
        crate::security::Lookup::Found {
            member,
            at,
            maybe: false,
        } => Some((member, at)),
        _ => None,
    };
    let mut run: Vec<(&Member, usize)> = PY_GUARD_RUNS.iter().filter_map(|n| found(0, n)).collect();
    let mut i = 0;
    while i < run.len() && run.len() < AUTHZ_NODES {
        let (m, at) = run[i];
        i += 1;
        for c in m.calls.iter().chain(&m.receiver_calls) {
            if Node::Member(m).conditional(c).is_some() {
                continue;
            }
            let c = crate::mine::norm_ref(c);
            let next = match c.strip_prefix("global#super().") {
                Some(name) => found(at + 1, name),
                None => c.rsplit_once('.').and_then(|(cl, name)| {
                    let own_class = matches!(&order[at], crate::security::Mro::Repo(r, _) if r == cl);
                    own_class.then(|| found(0, name)).flatten()
                }),
            };
            if let Some(n) = next
                && !run.iter().any(|(x, _)| std::ptr::eq(*x, n.0))
            {
                run.push(n);
            }
        }
    }
    run.iter().any(|(m, _)| refuses(&m.body_checks))
}

/// The methods of a Python class at a guard position that a framework runs for a
/// request: a view's `setup`, `dispatch`, DRF's `initial` and `check_permissions`,
/// Flask's `dispatch_request`, a permission class's `has_permission`, a callable
/// dependency's or middleware's `__call__`, a Django middleware's hooks.
const PY_GUARD_RUNS: &[&str] = &[
    "setup",
    "dispatch",
    "initial",
    "check_permissions",
    "dispatch_request",
    "has_permission",
    "__call__",
    "process_request",
    "process_view",
];

/// DRF runs the object check of the unit's permission classes
/// (`has_object_permission`): a body of the unit calls `get_object()` or
/// `check_object_permissions()`, or the unit is a generic view with no handler of
/// its own whose library handler does (retrieve, update, destroy; a view set's
/// detail routes).
fn object_check_runs(cx: &Cx<'_>, file: &drift_core::FileFacts, s: &Symbol, bodies: &[&Symbol]) -> bool {
    let asks = |c: &String| {
        let name = common::short(c);
        matches!(
            name.rsplit('.').next().unwrap_or(name),
            "get_object" | "check_object_permissions"
        )
    };
    if bodies
        .iter()
        .any(|b| b.calls.iter().chain(&b.receiver_calls).any(asks))
    {
        return true;
    }
    s.kind == SymbolKind::Class
        && cx
            .context()
            .ancestors(&format!("{}#{}", file.path, s.name))
            .iter()
            .filter(|a| common::external(a))
            .any(|a| {
                let name = common::short(a);
                ["Retrieve", "Update", "Destroy", "ViewSet"]
                    .iter()
                    .any(|w| name.contains(w))
            })
}

/// 403 / 404 checks in a body: on a tenant value, a role or literal, the owner, or
/// the answer of an in-repo check named for access ([`answering_check`]); any other
/// 403 in the handler's own body is unknown (below it, [`refusal`] keeps the unit from
/// a recorded absence).
fn checks<'a>(cx: &Cx<'a>, r: &Reached<'a>, ev: &mut Evidence) {
    let outer = ev.cond.clone();
    let roles_are_callers = alternative_roles(
        cx,
        r,
        ev,
        r.node
            .body_checks()
            .iter()
            .map(|c| (&c.condition, &c.source, &c.reads, &c.compares)),
    );
    for c in r.node.body_checks() {
        // A member of the caller compared with a literal asks what the caller is,
        // whatever the refusal is answered with (`if (ctx.user?.role !== "ADMIN")
        // throw new TRPCError({ code: "UNAUTHORIZED" })`): a role, though the answer
        // says "not signed in". A value tested for being there is the sign-in
        // check and no more, and one read off what the request sent is what any
        // caller writes.
        let role_answered_as_sign_in = c.outcome == CheckOutcome::Unauthenticated
            && c.compares == "literal"
            // Equal or not equal to it: an order comparison (`exp < now`, a count)
            // is read as before.
            && matches!(
                c.op.as_str(),
                drift_core::check_op::REFUSES_MISMATCH | drift_core::check_op::REFUSES_MATCH
            )
            && !c.reads.is_empty()
            && match ev.python {
                true => {
                    python_role_side(cx, r, ev, &c.source, &c.reads, &c.compares) == Some(true)
                }
                false => whose(&c.source, &c.reads) == Whose::Caller,
            };
        if !matches!(c.outcome, CheckOutcome::Forbidden | CheckOutcome::NotFound)
            && !role_answered_as_sign_in
        {
            continue;
        }
        // The request's HTTP method against a literal (`if (req.method !== "GET")
        // return 403`) is a value of the request and nothing of the caller: no role,
        // and no refusal of a caller left to explain.
        if c.compares == "literal" && c.reads.rsplit('.').next() == Some("method") {
            continue;
        }
        // [STRICT]: a check only some requests reach (under `if (req.method !==
        // "GET")`, in a loop over what the body names, after a branch that returns, as
        // one operand of `and`) does not check the others. It is not the unit's
        // authorization: it is found, not proven, and says why.
        // A role beside an owner's comparison only: beside a tenant's, the role lets
        // its holder into every tenant, which is what a person must look at.
        let owners = names_owner(&c.reads)
            && !names_tenant(&c.reads)
            && !names_tenant(&c.compares);
        let by_role = roles_are_callers
            && owners
            && c.condition == drift_core::not_always::ROLE_ALTERNATIVE;
        let own_return = ev.python && returns_for_own(cx, r.node, &c.condition);
        let (conditional, kind) = beside_role(c.conditional, &c.condition, by_role, own_return);
        ev.under(&outer, conditional, kind, &c.unless);
        ev.late(cx, r, &c.after);
        let requested = |s: &str| s.starts_with("header:") || s.starts_with("param:");
        let side = if requested(&c.compares) {
            c.compares.clone()
        } else if requested(&c.source) && c.reads.is_empty() {
            // A method's own parameter checked against the caller's record
            // (`if workspace_id != self.caller.workspace_id: raise Forbidden`): the
            // tenant the caller asked for is the value itself.
            c.source.clone()
        } else {
            format!("claim:{}", c.reads)
        };
        // The role that passes in the comparison's place is part of what the check
        // is: said with it.
        let what = match (by_role, own_return) {
            (true, _) => format!("{}{}{OR_A_ROLE}", c.source, c.reads),
            (false, true) => format!("{}{}{OR_OWN}", c.source, c.reads),
            (false, false) => format!("{}{}", c.source, c.reads),
        };
        // A tenant or an owner counts where the check refuses a caller whose value
        // differs from the one it is compared with ([`refuses_mismatch`]). One that is
        // only asked for (`if not caller.org_id: raise ...`) scopes nothing: the
        // caller has some tenant, and gets every tenant's rows. One compared the other
        // way round (`if org_id == caller.org_id: raise ...` refuses the caller's own
        // tenant and serves any other) is a refusal the map cannot name.
        let mismatch = refuses_mismatch(&c.op, &c.compares);
        let tenant = names_tenant(&c.compares)
            || names_tenant(&c.reads)
            || (requested(&c.source) && c.reads.is_empty() && names_tenant(&c.source));
        let owner = names_owner(&c.reads);
        // [STRICT]: in TypeScript one side must be read off the caller
        // ([`caller_side`]): `req.params.orgId !== req.body.orgId` and `rule.orgId !==
        // req.query.orgId` compare what the request sent with itself or with the row.
        let callers = ev.python || caller_side(c);
        // TypeScript: the comparison is of a value of the caller with the row's, the
        // request's or what the body was handed, by where the lowering says each
        // side comes from ([`python_sides`]; a parameter below the handler is what
        // the calls of the reach pass for it): `if (userId !== schedule.userId)
        // throw new ForbiddenException()` in a method the handler hands the
        // caller's id and the row it loaded.
        let by_sides = !ev.python
            && mismatch == Some(true)
            && python_sides(cx, r, ev, &c.source, &c.reads, &c.compares) == Some(true);
        if tenant && mismatch == Some(true) {
            let own_body = ev.python && r.depth == 0 && !r.quiet;
            // Python: one side read off the caller, the other off the row or the
            // request, by where the lowering says each comes from.
            let fallback = callers && sides(&c.source, &c.reads, &c.compares, own_body);
            let proven = sides_proven(cx, r, ev, c, fallback);
            ev.tenant(&side, proven);
        } else if (tenant || owner) && mismatch == Some(false) {
            if r.depth == 0 && !r.quiet && !c.conditional {
                ev.unknown(UnknownReason::Unclassified, what);
            }
        } else if c.outcome == CheckOutcome::NotFound {
            if (owner || by_sides) && mismatch == Some(true) {
                let proven = sides_proven(cx, r, ev, c, callers);
                ev.owner(&what, proven);
            }
        } else if (names_role(&c.reads) && !owner_compared(owner, mismatch, &c.compares))
            || c.compares == "literal"
        {
            // [STRICT]: a role is the caller's. Compared with another value
            // (`post.ownerId !== req.body.userId`), one side must be the caller's;
            // read off what the request sent (`req.body.role !== "admin"`), it is
            // what any caller writes.
            let two = !c.compares.is_empty() && c.compares != "literal";
            let sent = !ev.python && whose(&c.source, &c.reads) == Whose::Sent;
            // [STRICT] Python: the role compared is read off the caller, by the
            // closed list of sources; one read off what the request sent
            // (`body.acting_role`, a header) is what any caller writes.
            let not_callers = ev.python
                && python_role_side(cx, r, ev, &c.source, &c.reads, &c.compares) == Some(false);
            if (two && !callers) || sent || not_callers {
                ev.find(
                    "role_check",
                    &what,
                    obligation::SIDES_NOT_CALLER_AND_RESOURCE,
                    "",
                    false,
                );
            } else {
                ev.add("role_check", &what, VariantSource::Usage);
            }
        } else if by_sides {
            // A value of the caller against the resource's, refused where they
            // differ: the owner's check, whatever either is called.
            ev.owner(&what, true);
        } else if owner && mismatch == Some(true) {
            let proven = sides_proven(cx, r, ev, c, callers);
            ev.owner(&what, proven);
        } else if let Some(mechanism) = answering_check(cx, c) {
            // [STRICT]: the 403 proves that the answer decides, the name says what was
            // asked, and nothing proves that the function compares the caller with
            // what is asked for: found by its name only.
            ev.by_name(mechanism, &c.source);
        } else if r.depth == 0 && !r.quiet && !c.conditional {
            ev.unknown(UnknownReason::Unclassified, what);
        }
    }
    ev.cond = outer;
}

/// A comparison a check makes is of the caller with what is asked for. Python: by
/// where the lowering says each side comes from ([`python_sides`]), and `fallback`
/// where it recorded nothing. TypeScript: `fallback` (what a side is read from, by
/// [`caller_side`]), or the sides where they prove it.
fn sides_proven<'a>(
    cx: &Cx<'a>,
    r: &Reached<'a>,
    ev: &Evidence,
    c: &drift_core::BodyCheck,
    fallback: bool,
) -> bool {
    match python_sides(cx, r, ev, &c.source, &c.reads, &c.compares) {
        Some(proven) if ev.python => proven,
        Some(proven) => proven || fallback,
        None => fallback,
    }
}

/// A 403 on what an in-repo function answered, where the function is named as a
/// question about access to a tenant or a role (`if (!(await ownsWorkspace(id)))
/// return 403`, `callerCanOpenWorkspace`, `isOrgAdmin`): the mechanism. The 403 is the
/// proof that the answer decides; the name says what was asked, as it does for a check
/// that rejects by itself ([`calls`]). A getter (`getOrgId()`), a method of a value
/// and a rate limit ask nothing about access.
fn answering_check(cx: &Cx<'_>, c: &drift_core::BodyCheck) -> Option<&'static str> {
    if c.outcome != CheckOutcome::Forbidden
        || !c.reads.is_empty()
        || !c.compares.is_empty()
        || common::external(&c.source)
        || c.source.starts_with(common::PARAM_CALLEE)
        || c.source.starts_with("header:")
    {
        return None;
    }
    let d = cx.context().definition(&c.source)?;
    let name = common::short(&c.source);
    if d.kind != SymbolKind::Function || d.name != name || not_access(name) {
        return None;
    }
    let words = super::libraries::key_words(name);
    let asks = permission_verb(name)
        || words
            .iter()
            .any(|w| super::libraries::ACCESS_PREDICATES.contains(&w.as_str()));
    if !asks {
        None
    } else if names_tenant(name) {
        Some("tenancy_check")
    } else if names_role(name) {
        Some("role_check")
    } else {
        None
    }
}

/// A name that turns callers away for something other than what they may do: a rate
/// limit, or a signature check (it proves the sender, as service authentication does).
fn not_access(name: &str) -> bool {
    let words = super::libraries::key_words(name);
    words
        .iter()
        .any(|w| super::libraries::NOT_AUTH_GUARD_NAMES.contains(&w.as_str()))
        || (words.iter().any(|w| w == "rate") && words.iter().any(|w| w == "limit"))
        || words.iter().any(|w| w == "signature" || w == "hmac")
}

/// A value named for an owner, compared with another value that is no literal, by
/// a check that refuses where the two differ (`row.owner_id != caller.id`): the
/// comparison of a row's owner with the caller, not a test of the caller's role.
/// `owner` is a role's name as well (`member.role == "owner"`), so a name alone
/// reads either way; what it is compared with tells them apart.
fn owner_compared(owner: bool, mismatch: Option<bool>, compares: &str) -> bool {
    owner && mismatch == Some(true) && !compares.is_empty() && compares != "literal"
}

/// Whether every role a comparison of the body stands beside
/// ([`drift_core::not_always::ALTERNATIVE_ROLE`]) is read off the caller, by where
/// the lowering says it comes from ([`python_role_side`]; in TypeScript, by what it
/// is read from, [`whose`]): the comparison is then
/// decided for every request, by the caller's role or by itself. False where the
/// body has no such role, where one is read off anything else (a row's flag, what
/// the request sent) and where its source is not recorded: the comparison stays an
/// operand of an `and`, found and not proven.
fn alternative_roles<'a, 'c>(
    cx: &Cx<'a>,
    r: &Reached<'a>,
    ev: &Evidence,
    checks: impl Iterator<Item = (&'c String, &'c String, &'c String, &'c String)>,
) -> bool {
    let mut any = false;
    for (condition, source, reads, compares) in checks {
        if condition != drift_core::not_always::ALTERNATIVE_ROLE {
            continue;
        }
        any = true;
        let callers = match ev.python {
            true => python_role_side(cx, r, ev, source, reads, compares) == Some(true),
            // TypeScript: by what the role is read from ([`whose`]).
            false => whose(source, reads) == Whose::Caller,
        };
        if !callers {
            return false;
        }
    }
    any
}

/// Python: the unit's handler hands back what gives the caller, wherever it
/// returns a value ([`drift_core::controls::RETURNS_GIVEN`],
/// [`drift_core::controls::RETURNS_CALLER`]: `def read_user_me(current_user:
/// CurrentUser): return current_user`), and does nothing else that could reach
/// another's data: its own body is the only one the unit runs, and it calls
/// nothing of the repository and nothing of a data library. What gives the caller,
/// for the unit's key. Read from the body: a route is not this by being named
/// `/me`.
fn serves_own<'a>(cx: &Cx<'a>, s: &Symbol, reach: &Reach<'a>) -> Option<String> {
    use drift_core::controls::{RETURNS_CALLER, RETURNS_GIVEN};
    if s.kind != SymbolKind::Function {
        return None;
    }
    let givers: Vec<&str> = s
        .controls
        .iter()
        .filter_map(|c| c.strip_prefix(RETURNS_GIVEN))
        .collect();
    let giver = match givers.as_slice() {
        [] if s.controls.iter().any(|c| c == RETURNS_CALLER) => "the caller".to_string(),
        [] => return None,
        all if all.iter().all(|g| gives_caller(cx, g, true)) => all[0].to_string(),
        _ => return None,
    };
    let alone = reach.nodes.iter().filter(|r| !r.quiet).count() == 1;
    let harmless = s
        .calls
        .iter()
        .chain(&s.receiver_calls)
        .map(|c| crate::mine::norm_ref(c))
        .all(|c| {
            c.starts_with("global#")
                || (c.starts_with("pkg:") && super::libraries::data_library(&c).is_none())
        });
    (alone && harmless && s.sinks.is_empty()).then_some(giver)
}

/// Python: what the unit's own bodies hand a data session, where every such
/// call is handed rows that are the caller's.
///
/// - The caller's own record: every value handed is the caller itself
///   ([`side_is_caller_self`]: `session.add(current_user)`, `session.refresh(
///   current_user)`), read as `own_record`.
/// - A row the body builds as the caller's: what a call of a model of the
///   repository handed back ([`drift_core::RepoFacts::models`]), every build of
///   which in the body gives one field of the model the caller itself
///   ([`stamped`]), read as `owner_stamp:<field> (session)`. The row's owner is
///   who calls, whatever the field is called and whatever else the request sent.
///
/// A call handed nothing picks no rows (`session.commit()`). Proven where no
/// other call of a data session is handed anything else and no body of the
/// unit reads rows by nothing of the caller ([`reads_unscoped`]); beside one,
/// found. A field given through a method of the model that was not read
/// (`Item.model_validate(item_in, update={"owner_id": current_user.id})`: what
/// the method does with the dict is the package's to say) is found, not proven.
fn kept_rows<'a>(cx: &Cx<'a>, reach: &Reach<'a>, ev: &mut Evidence) {
    let mut own: Option<String> = None;
    // Field, and the method of the model the value went through where it is
    // not the model's own constructor.
    let mut built: std::collections::BTreeMap<String, Option<String>> = Default::default();
    let mut other: Option<String> = None;
    for r in reach.nodes.iter().filter(|r| !r.quiet) {
        let facts: &[String] = match r.node {
            Node::Sym(s) => &s.controls,
            Node::Member(m) => &m.unread,
        };
        for (callee, given) in arg_calls_own(facts.iter()).chain(pkg_arg_calls(facts)) {
            if given.is_empty() || !on_session(cx, callee) {
                continue;
            }
            if given.iter().all(|(_, side)| side_is_caller_self(cx, side)) {
                let giver = given[0]
                    .1
                    .strip_prefix(drift_core::controls::OWN_SIDE)
                    .unwrap_or_default();
                let giver = giver
                    .rsplit_once("via ")
                    .map_or("the caller", |(_, dep)| dep)
                    .to_string();
                if own.as_ref().is_none_or(|x| giver < *x) {
                    own = Some(giver);
                }
                continue;
            }
            let rows: Option<Vec<(String, Option<String>)>> = given
                .iter()
                .map(|(_, side)| {
                    side.strip_prefix("call ")
                        .and_then(|from| model_of(cx, from))
                        .and_then(|model| stamped(cx, facts, model))
                })
                .collect();
            match rows {
                Some(rows) => built.extend(rows),
                None => {
                    let c = crate::mine::norm_ref(callee).into_owned();
                    if other.as_ref().is_none_or(|x| c < *x) {
                        other = Some(c);
                    }
                }
            }
        }
    }
    if own.is_none() && built.is_empty() {
        return;
    }
    let beside = other.is_some() || ev.reads_unscoped;
    let when = other
        .as_deref()
        .map(|c| common::short(c).replace("()", ""))
        .unwrap_or_default();
    if let Some(giver) = own {
        match beside {
            true => ev.find(
                "own_record",
                &giver,
                obligation::OTHER_READ_UNSCOPED,
                &when,
                false,
            ),
            false => ev.add("own_record", &giver, VariantSource::Usage),
        }
    }
    for (field, through) in built {
        let instrument = format!("{field} (session)");
        match (beside, through.as_deref()) {
            (true, _) => ev.find(
                "owner_stamp",
                &instrument,
                obligation::OTHER_READ_UNSCOPED,
                &when,
                false,
            ),
            (false, Some(method)) => ev.find(
                "owner_stamp",
                &instrument,
                obligation::CALLEE_UNREAD,
                &common::short(method).replace("()", ""),
                true,
            ),
            (false, None) => ev.add("owner_stamp", &instrument, VariantSource::Usage),
        }
    }
}

/// The calls of a package's code the body makes that are handed something
/// ([`drift_core::controls::PKG_ARG_VALUE`]), each side as written.
fn pkg_arg_calls(facts: &[String]) -> impl Iterator<Item = (&str, Vec<(&str, &str)>)> {
    facts.iter().filter_map(|f| {
        let rest = f.strip_prefix(drift_core::controls::PKG_ARG_VALUE)?;
        let mut parts = rest.split('\t');
        let callee = parts.next()?;
        let mut given = Vec::new();
        while let (Some(key), Some(side)) = (parts.next(), parts.next()) {
            given.push((key, side));
        }
        Some((callee, given))
    })
}

/// Python: `callee` is a call on a session or a client of a data library, not
/// on a model: a data library's own call (`pkg:sqlmodel#Session.add` on a
/// parameter the package types), a call on a name of the repository annotated
/// as one (`SessionDep = Annotated[Session, Depends(get_db)]`:
/// [`Symbol::alias_of`]), on a binding built from one ([`data_call`]), or on a
/// binding the repository's models are declared on ([`models_declared_on`]).
/// What it is handed is what it keeps, reads or drops.
fn on_session(cx: &Cx<'_>, callee: &str) -> bool {
    use super::libraries::data_library;
    if model_of(cx, callee).is_some() {
        return false;
    }
    if common::external(callee) {
        return data_library(callee).is_some();
    }
    match cx.context().definition(callee) {
        Some(d) if !d.alias_of.is_empty() => data_library(&d.alias_of).is_some(),
        Some(d) => {
            matches!(d.kind, SymbolKind::Const | SymbolKind::Variable)
                && (data_call(cx, callee) || models_declared_on(cx, callee))
        }
        None => false,
    }
}

/// Python: `callee` is a call on a binding of the repository that a model of the
/// repository is declared on: the class a model extends is read off it (`class
/// Note(db.Model)` of `db = SQLAlchemy(app)`, whatever built the binding and
/// whatever it is called). The models' own data layer, so `db.session.add(row)`
/// is a call of its session.
fn models_declared_on(cx: &Cx<'_>, callee: &str) -> bool {
    let Some((module, path)) = callee.split_once('#') else {
        return false;
    };
    let base = path.split(['.', '(']).next().unwrap_or_default();
    if base.is_empty() || base.len() == path.len() {
        return false;
    }
    let on = format!("{module}#{base}.");
    let ctx = cx.context();
    cx.facts.models.iter().any(|m| {
        ctx.ancestors(&format!("{}#{}", m.path, m.name))
            .iter()
            .any(|a| a.starts_with(&on))
    })
}

/// The model of the repository `callee` is, or is called on
/// ([`drift_core::RepoFacts::models`]): `app/models.py#Item` of
/// `app/models.py#Item` and of `app/models.py#Item.model_validate`.
fn model_of<'c>(cx: &Cx<'_>, callee: &'c str) -> Option<&'c str> {
    let (module, path) = callee.split_once('#')?;
    let name = path.split(['.', '(']).next()?;
    cx.facts
        .models
        .iter()
        .any(|m| m.path == module && m.name == name)
        .then(|| &callee[..module.len() + 1 + name.len()])
}

/// Python: the field of `model` every build of it in the body gives the caller
/// itself, and the method the value went through where one build is no call of
/// the model's own constructor. A build is a call of the model or of a method on
/// it ([`drift_core::controls::ARG_VALUE`]): the constructor's keyword
/// (`Item(owner_id=current_user.id)`), or a key of a dict written in place and
/// handed to a method (`update.owner_id`). None where there is no build, where
/// one build gives the field anything else or nothing, and where the body
/// writes the field afterwards by what is not the caller itself
/// ([`drift_core::controls::ROW_SET`]).
fn stamped(cx: &Cx<'_>, facts: &[String], model: &str) -> Option<(String, Option<String>)> {
    let (module, name) = model.split_once('#')?;
    let fields = &cx
        .facts
        .models
        .iter()
        .find(|m| m.path == module && m.name == name)?
        .fields;
    let builds: Vec<(&str, Vec<(&str, &str)>)> = arg_calls_own(facts.iter())
        .filter(|(c, _)| model_of(cx, c) == Some(model))
        .collect();
    if builds.is_empty() {
        return None;
    }
    let set_after = |field: &str| {
        facts.iter().any(|f| {
            f.strip_prefix(drift_core::controls::ROW_SET)
                .and_then(|rest| rest.split_once('\t'))
                .is_some_and(|(of, attr)| model_of(cx, of) == Some(model) && attr == field)
        })
    };
    fields.iter().find_map(|field| {
        let mut through: Option<String> = None;
        let every = builds.iter().all(|(callee, given)| {
            let constructor = *callee == model;
            let gives = given.iter().any(|(key, side)| {
                let named = match constructor {
                    true => key == field,
                    false => key.split_once('.').is_some_and(|(_, k)| k == field),
                };
                named && side_is_caller_self(cx, side)
            });
            if gives && !constructor && through.is_none() {
                through = Some(crate::mine::norm_ref(callee).into_owned());
            }
            gives
        });
        (every && !set_after(field)).then(|| (field.clone(), through))
    })
}

/// What the instrument of a check ends with where the body serves the caller's
/// own record before it ([`returns_for_own`]): the check is "the caller's own, or
/// this", and says so wherever it is named.
const OR_OWN: &str = " or the caller's own";

/// Python: the body returns early, without refusing, only for the requests about
/// the caller's own record ([`drift_core::controls::RETURNS_EARLY_FOR_OWN`]), so a
/// check after that return is asked of every other request.
fn returns_for_own(cx: &Cx<'_>, n: Node<'_>, condition: &str) -> bool {
    cx.context().since_measured()
        && condition == drift_core::not_always::AFTER_CONDITIONAL_RETURN
        && n.unread(drift_core::controls::RETURNS_EARLY_FOR_OWN)
}

/// What the instrument of an owner check ends with where a role of the caller's
/// passes in the comparison's place ([`beside_role`]): the check is "the owner, or
/// a role", and says so wherever it is named.
const OR_A_ROLE: &str = " or a role";

/// How a check that may stand beside a role is read
/// ([`drift_core::not_always::ROLE_ALTERNATIVE`]): where the role is the caller's
/// (`roles_are_callers`, [`alternative_roles`]) the comparison runs, and decides,
/// for every request the role does not decide, so it is under no condition. In
/// every other case it, and the role's own test, are operands of an `and`. Asked
/// of an owner's comparison only: a role beside a tenant's comparison lets its
/// holder into every tenant, and stays found, not proven.
///
/// A check after a branch that returned for the requests about the caller's own
/// record only (`own_return`, [`returns_for_own`]) is asked of every other
/// request: under no condition either, and said with what it stands beside
/// ([`OR_OWN`]).
fn beside_role(
    conditional: bool,
    kind: &str,
    roles_are_callers: bool,
    own_return: bool,
) -> (bool, &str) {
    use drift_core::not_always::{
        AFTER_CONDITIONAL_RETURN, ALTERNATIVE_ROLE, AND_OPERAND, ROLE_ALTERNATIVE,
    };
    match kind {
        AFTER_CONDITIONAL_RETURN if own_return => (false, ""),
        ROLE_ALTERNATIVE if roles_are_callers => (false, ""),
        ROLE_ALTERNATIVE | ALTERNATIVE_ROLE => (true, AND_OPERAND),
        _ => (conditional, kind),
    }
}

/// How a check's condition compares its value ([`drift_core::check_op`]): `Some(true)`
/// where it turns away a caller whose value differs from the other (`a != b`),
/// `Some(false)` where it compares another way (it refuses a match, or orders the
/// two), `None` where it compares nothing. Facts that state no operator (written by
/// hand, or by a lowering that records none) and name what the value is compared
/// with read as a refused mismatch, as they did before the operator was recorded.
fn refuses_mismatch(op: &str, compares: &str) -> Option<bool> {
    match op {
        "" if compares.is_empty() => None,
        "" | drift_core::check_op::REFUSES_MISMATCH => Some(true),
        _ => Some(false),
    }
}

/// A raise check says the caller is not allowed: it states 403, or states no status
/// and raises a class named for it ([`crate::vocab::refuse::forbids_class`]).
fn forbids(c: &drift_core::RaiseCheck) -> bool {
    c.status == 403 || (c.status == 0 && crate::vocab::refuse::forbids_class(&c.raises))
}

/// The conditions of a body that raise an error class named for a refusal
/// ([`drift_core::RaiseCheck`]), by what they compare: the tenant the caller asked for
/// with the caller's own (`if org_id != self.caller.org_id: raise ForbiddenError`), a
/// row's tenant or owner with the caller's, a role. Read as [`checks`] reads a 403: a
/// tenant or an owner, a parameter's or a claim's, counts only where it is compared
/// with something (`if not org_id: raise ...` and `if not self.caller.org_id: raise
/// ...` ask for a value, not for the caller's).
///
/// The instrument is where the check is: the method or function reached, or, in the
/// entry's own body, what is compared.
fn raised<'a>(cx: &Cx<'a>, r: &Reached<'a>, ev: &mut Evidence) {
    let requested = |s: &str| s.starts_with("header:") || s.starts_with("param:");
    let outer = ev.cond.clone();
    let roles_are_callers = alternative_roles(
        cx,
        r,
        ev,
        r.node
            .raise_checks()
            .iter()
            .map(|c| (&c.condition, &c.source, &c.reads, &c.compares)),
    );
    for c in r.node.raise_checks() {
        // [STRICT]: whatever the class raised. A mismatch of a row's tenant that
        // raises `RuleNotFoundError` or `ValueError` may turn the caller away as a
        // 403 does: it is found. It is proven only where the exit says what it is (a
        // 403, a 404, a class named for a refusal): of another class, nothing says
        // that the value the row is compared with is the caller's (`if
        // decision.workspace_id != workspace_id: raise ObjectNotFoundError` compares
        // a row with the path).
        let forbidden = forbids(c);
        let refuses = forbidden || c.status == 404;
        // A check only some requests reach proves nothing of the others: found, not
        // proven ([`checks`]).
        let by_role = roles_are_callers
            && names_owner(&c.reads)
            && !names_tenant(&c.reads)
            && !names_tenant(&c.compares)
            && c.condition == drift_core::not_always::ROLE_ALTERNATIVE;
        let own_return = ev.python && returns_for_own(cx, r.node, &c.condition);
        let (conditional, kind) = beside_role(c.conditional, &c.condition, by_role, own_return);
        ev.under(&outer, conditional, kind, &c.unless);
        ev.late(cx, r, &c.after);
        let mismatch = refuses_mismatch(&c.op, &c.compares);
        let own = requested(&c.source) && c.reads.is_empty();
        let what = match (by_role, own_return) {
            (true, _) => format!("{}{}{OR_A_ROLE}", c.source, c.reads),
            (false, true) => format!("{}{}{OR_OWN}", c.source, c.reads),
            (false, false) => format!("{}{}", c.source, c.reads),
        };
        // The value read is the last member of the path: `.caller.org_id` is a
        // tenant, `.get_organization_memberships().data` is not.
        let read = c.reads.rsplit('.').next().unwrap_or_default();
        let asked = requested(&c.compares) && names_tenant(&c.compares);
        // [STRICT]: a value named for a tenant and compared with a literal
        // (`caller.account_status != "active"`) is compared with nothing of the
        // request or the resource: no tenant check.
        let tenant = (names_tenant(read) || asked || (own && names_tenant(&c.source)))
            && c.compares != "literal";
        // A tenant or an owner counts only where the check refuses a caller whose
        // value differs from the one it is compared with: a claim that is only asked
        // for (`if not self.caller.org_id: raise ...`) says the caller has a tenant,
        // not that the rows are that tenant's, and a check that refuses a match (`if
        // org_id == self.caller.org_id: raise ...`) turns away the caller's own.
        let (mechanism, at) = if tenant && mismatch == Some(true) {
            let side = if asked {
                c.compares.clone()
            } else if own {
                c.source.clone()
            } else {
                format!("claim:{}", c.reads)
            };
            ("tenancy_check", side)
        } else if !forbidden {
            if !(names_owner(&c.reads) && mismatch == Some(true)) {
                continue;
            }
            ("owner_check", what)
        } else if tenant && mismatch == Some(false) {
            continue;
        } else if names_role(read)
            && !owner_compared(names_owner(&c.reads), mismatch, &c.compares)
        {
            ("role_check", what)
        } else if (names_owner(&c.reads) || (own && names_owner(&c.source)))
            && mismatch == Some(true)
        {
            ("owner_check", what)
        } else {
            continue;
        };
        let instrument = if r.depth == 0 { &at } else { &r.callee };
        ev.named = r.depth > 0;
        if mechanism == "tenancy_check" {
            let own_body = ev.python && r.depth == 0 && !r.quiet;
            let sides = refuses
                && python_sides(cx, r, ev, &c.source, &c.reads, &c.compares)
                    .unwrap_or_else(|| sides(&c.source, &c.reads, &c.compares, own_body));
            ev.tenant(instrument, sides);
        } else if !refuses
            || (mechanism == "owner_check"
                && python_sides(cx, r, ev, &c.source, &c.reads, &c.compares)
                    == Some(false))
            || (mechanism == "role_check"
                && ev.python
                && python_role_side(cx, r, ev, &c.source, &c.reads, &c.compares)
                    == Some(false))
        {
            ev.find(
                mechanism,
                instrument,
                obligation::SIDES_NOT_CALLER_AND_RESOURCE,
                "",
                false,
            );
        } else {
            ev.add(mechanism, instrument, VariantSource::Usage);
        }
        ev.named = false;
    }
    ev.cond = outer;
}

/// A raise check that may be how the body authorises, whatever the class it raises
/// [STRICT]: it compares a value the facts could not read, or it reads or compares a
/// value named for a tenant, an owner or a role. One that reads and compares only
/// what names none of them (`if rule.status != "active": raise ...`, `if rule is
/// None: raise ...`) refuses for something else.
fn may_authorise(c: &drift_core::RaiseCheck) -> bool {
    let compared = !c.op.is_empty() || !c.compares.is_empty();
    let unread = c.source.is_empty() || c.compares == drift_core::UNREAD_COMPARE;
    let names = |s: &str| names_tenant(s) || names_owner(s) || names_role(s);
    let read = c.reads.rsplit('.').next().unwrap_or_default();
    let own = (c.source.starts_with("param:") || c.source.starts_with("header:"))
        && c.reads.is_empty();
    (compared && unread)
        || names(read)
        || (own && names(&c.source))
        || ((c.compares.starts_with("param:") || c.compares.starts_with("header:"))
            && names(&c.compares))
}

/// What in a body turns away a caller who is signed in: a 403 check, a 404 on a
/// comparison, an error class named for it (raised under a condition or not), a 403
/// response, a raise of any class on what may be the authorization
/// ([`may_authorise`]), an exit on a condition the facts do not hold
/// ([`drift_core::controls::UNREAD_EXIT`]). `None` for a body that refuses no one.
fn refusal(n: Node<'_>, around: bool) -> Option<String> {
    use crate::vocab::refuse::forbids_class;
    if let Some(c) = n.body_checks().iter().find(|c| {
        c.outcome == CheckOutcome::Forbidden
            || (c.outcome == CheckOutcome::NotFound && !c.compares.is_empty())
    }) {
        return Some(format!("{}{}", c.source, c.reads));
    }
    if let Some(c) = n
        .raise_checks()
        .iter()
        .find(|c| forbids(c) || may_authorise(c))
    {
        return Some(crate::mine::norm_ref(&c.raises).into_owned());
    }
    if n.unread(drift_core::controls::UNREAD_EXIT) {
        return Some(drift_core::controls::UNREAD_EXIT.into());
    }
    if let Some(t) = n
        .throws()
        .iter()
        .chain(n.calls())
        .find(|t| forbids_class(t))
    {
        return Some(crate::mine::norm_ref(t.trim_end_matches("(new)")).into_owned());
    }
    // Around the unit (a dependency, a decorator), a 403 answered in a `catch` maps an
    // error the wrapped body raised (`except ForbiddenError: raise HTTPException(403)`
    // in an error-mapping decorator): the refusal is where the error is raised.
    match n {
        Node::Sym(s)
            if s.responses
                .iter()
                .any(|r| r.status == 403 && !(around && r.in_catch)) =>
        {
            Some("status:403".into())
        }
        Node::Member(m) if m.unread.iter().any(|u| u == drift_core::ANSWERS_403) => {
            Some(drift_core::ANSWERS_403.into())
        }
        _ => None,
    }
}

/// A body whose checks, raises or responses were cut short ([`Symbol::truncated`]):
/// what refuses may be among those not kept, so it is never read as a body that
/// refuses no one; the unit is unknown, not "none". The field, named as
/// [`common::truncated`] names it. Not a proof of anything: only the unknown path
/// reads it.
fn cut_short(n: Node<'_>) -> Option<String> {
    let Node::Sym(s) = n else {
        return None;
    };
    ["body_checks", "raise_checks", "responses"]
        .into_iter()
        .find(|f| common::symbol_truncated(s, f))
        .map(|f| format!("truncated:{f}"))
}

/// [STRICT] Python: a raise of any class on a comparison one side of which is a
/// value of the caller, by where the lowering says each side comes from
/// ([`drift_core::controls::SIDES`], [`origin`]): `if row.estate_id != value: raise
/// ValueError(...)` in a helper the handler hands `grower.estate_id`. Whatever the
/// key compared is called and whatever the class, it may be the authorization
/// ([`may_authorise`] reads only what names a tenant, an owner or a role). The class
/// raised, for the reason. Not a 401, which turns away a caller who is not signed in.
fn caller_refusal<'a>(cx: &Cx<'a>, r: &Reached<'a>, ev: &Evidence) -> Option<String> {
    if !ev.python || !cx.context().since_measured() {
        return None;
    }
    r.node
        .raise_checks()
        .iter()
        .find(|c| {
            c.status != 401
                && recorded_sides(r.node, &c.source, &c.reads, &c.compares).is_some_and(|(a, b)| {
                [a, b]
                    .iter()
                    .any(|s| origin(cx, &ev.around, r, s, &ev.passed) == Origin::Caller)
            })
        })
        .map(|c| crate::mine::norm_ref(&c.raises).into_owned())
}

/// The call of a body that hands the request to another service over HTTP (`fetch`,
/// an HTTP client library): what authorises it may be there.
fn forward(n: Node<'_>) -> Option<String> {
    n.callees()
        .map(|c| c.trim_end_matches("(ref)"))
        .find(|c| {
            crate::mine::norm_ref(c) == "global#fetch"
                || common::package_root(c).is_some_and(|p| {
                    super::libraries::HTTP_CLIENT_LIBRARIES.contains(&p.as_str())
                })
        })
        .map(|c| crate::mine::norm_ref(c).into_owned())
}

/// The method refuses a caller ([`refusal`]), or a sibling method it calls does.
fn member_refuses(class: &Symbol, member: &Member) -> bool {
    if refusal(Node::Member(member), false).is_some() {
        return true;
    }
    let sibling = format!("#{}.", class.name);
    member.calls.iter().any(|c| {
        c.rsplit_once(&sibling).is_some_and(|(_, name)| {
            class
                .members
                .iter()
                .any(|m| m.name == name && refusal(Node::Member(m), false).is_some())
        })
    })
}

/// The callee is a function or a method of the repository, or builds one of its
/// classes: the keys it is given are its arguments, not the filter of a query. What it
/// does with them is in its own body, read where the reach follows it.
fn own_body<'a>(cx: &Cx<'a>, from: Node<'a>, callee: &str) -> bool {
    if common::external(callee) {
        return false;
    }
    let built = cx.context().definition(callee).is_some_and(|d| {
        d.kind == SymbolKind::Class && d.name == common::short(callee.trim_end_matches("(new)"))
    });
    built
        || matches!(
            resolve(cx, from, callee),
            Callee::Function(_) | Callee::Method { .. }
        )
}

/// Calls of a policy library that refuse by themselves when the decision is no:
/// CASL's `ForbiddenError.from(ability).throwUnlessCan(...)`, Oso's `authorize`,
/// and the `*OrFail` / `*OrThrow` spellings.
const THROWING_POLICY_CALLS: &[&str] = &[
    "ForbiddenError.from",
    ".throwUnlessCan",
    ".authorize",
    "OrFail",
    "OrThrow",
    ".assertCan",
];

/// Calls of a policy library or of an in-repo check that proves it rejects and is
/// named for a role, permission or tenant (`is_org_admin()`, `ensureTeamAccess()`). A
/// method of a class is proven by what that method does (it, or a sibling it calls,
/// refuses a caller), never by what another method of its class does.
fn calls<'a>(cx: &Cx<'a>, from: Node<'a>, ev: &mut Evidence) {
    let ctx = cx.context();
    let policy =
        |r: &str| common::package_root(r).is_some_and(|p| POLICY_LIBRARIES.contains(&p.as_str()));
    for c in from
        .callees()
        .filter(|c| !c.ends_with("(ref)") && !c.ends_with("(new)"))
    {
        let in_repo_policy = !common::external(c)
            && ctx
                .definition(c)
                .is_some_and(|d| d.calls.iter().any(|x| policy(x)));
        if policy(c) || in_repo_policy {
            let src = if policy(c) {
                VariantSource::Vocab
            } else {
                VariantSource::Usage
            };
            // [STRICT] A decision computed and not used to refuse is no check
            // (`const ok = await enforcer.enforce(...)` written to a header or a
            // log): the policy call is one only where something refuses beside it,
            // in the body that makes it or in the in-repo function that calls the
            // library, or where the library's own call refuses
            // ([`THROWING_POLICY_CALLS`]). Otherwise found and not proven.
            let decides = THROWING_POLICY_CALLS
                .iter()
                .any(|m| common::short(c).ends_with(m))
                || refusal(from, false).is_some()
                || (in_repo_policy
                    && ctx
                        .definition(c)
                        .is_some_and(|d| refusal(Node::Sym(d), false).is_some()));
            if !decides {
                ev.find("policy", c, obligation::RESULT_NOT_REFUSED, "", false);
                continue;
            }
            // [STRICT]: a policy call the body makes only on some paths (`if
            // rule.private: enforcer.enforce(...)`) decides nothing for the others.
            let outer = ev.cond.clone();
            if outer.is_none()
                && let Some(kind) = from.conditional(c)
            {
                ev.cond = Some((kind.to_string(), String::new()));
            }
            ev.add("policy", c, src);
            ev.cond = outer;
            continue;
        }
        if common::external(c) {
            continue;
        }
        // What names the check: a function's name; a method's own name, and its
        // class's too where the method itself refuses (`OrganizationsService
        // .require_member`), never where only a sibling it calls does.
        let mut to: Option<Node<'a>> = None;
        let (callee, proven, own_name) = match resolve(cx, from, c) {
            Callee::Method {
                canonical,
                class,
                member,
            } => {
                let proven = crate::security::callee_proves_guard(ctx, &canonical)
                    && member_refuses(class, member);
                let itself = refusal(Node::Member(member), false).is_some();
                to = Some(Node::Member(member));
                (canonical, proven, !itself)
            }
            Callee::Function(d) => {
                to = Some(Node::Sym(d));
                (
                    c.clone(),
                    crate::security::callee_proves_guard(ctx, c),
                    false,
                )
            }
            // [STRICT]: what runs behind an unread callee is not known (a method a
            // subclass overrides, a method of an attribute no `__init__` types): its
            // name, and what the class it is written under throws elsewhere, prove
            // nothing of it.
            Callee::Opaque(_) => continue,
            _ => (
                c.clone(),
                crate::security::callee_proves_guard(ctx, c),
                false,
            ),
        };
        if !proven {
            continue;
        }
        let name = match (own_name, common::short(&callee)) {
            (true, n) => n.rsplit('.').next().unwrap_or(n),
            (false, n) => n,
        };
        if not_access(name)
            || super::libraries::verifier_callee(&callee)
            || ev.signs_in.contains(&callee)
        {
            continue;
        }
        // [STRICT]: the callee refuses someone and is named for a tenant or a role.
        // Neither says that it compares the caller with what is asked for: a check
        // read where it is ([`checks`], [`raised`]) is the unit's practice, one read
        // from its name is found, not proven. A callee the body calls only on some
        // paths is not proven to run either.
        let (outer, dominant) = (ev.cond.clone(), ev.dominant);
        let conditional = match to {
            Some(to) => from.conditional_to(c, to),
            // Not resolved to a body: nothing says it is `async`.
            None => from
                .conditional(c)
                .filter(|why| *why != drift_core::not_always::NOT_AWAITED),
        };
        if outer.is_none()
            && let Some(kind) = conditional
        {
            ev.cond = Some((kind.to_string(), String::new()));
            ev.dominant = false;
        }
        if names_tenant(name) {
            ev.by_name("tenancy_check", &callee);
        } else if names_role(name) || permission_verb(name) {
            ev.by_name("role_check", &callee);
        }
        ev.cond = outer;
        ev.dominant = dominant;
    }
}

/// Where one side of a Python comparison, or the value of a filter, comes from, as
/// the lowering wrote it ([`drift_core::controls::SIDES`]) and this reading judges
/// what the lowering leaves to a reader.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Origin {
    /// A value of the caller, by the closed list of sources.
    Caller,
    /// What the request sent.
    Request,
    /// What a data call handed back.
    Row,
    /// What a call or a dependency that gives no identity handed back, or an
    /// attribute of the object that is not the caller's record: a resource, by
    /// nothing that says the caller.
    Handed,
    /// A setting, an environment read, a literal, or a value that was not read:
    /// nothing a check of the caller compares the caller with.
    Fixed,
    Unread,
}

/// The origin of `side` ([`drift_core::controls::SIDES`]) in the body `r`.
///
/// - What a declared dependency gives (`via`) is the request's where the
///   dependency returns what the request sent
///   ([`drift_core::controls::RETURNS_REQUEST`]), whatever else it does; else the
///   caller's where it signs the caller in ([`gives_caller`]); else not read (it may
///   give a setting). What a method called on it hands back (`call via`:
///   `db.get(Document, id)`) is the same, else a resource's (a session's, a
///   repository's).
/// - What a helper called with nothing or with the request gives, or a holder
///   keeps (`gives`), is read the same way, and is not read where it is neither.
/// - A parameter is what the request sent in the unit's own body and in what a
///   framework calls for the request (a dependency, a decorator's wrapper, a
///   hook); below, it is whatever the calling body passed. In the unit's own
///   body it is the caller's where a wrapper of the repository around the unit
///   hands the function it was given a value of the caller there
///   ([`handed_by_wrappers`]: `handler(req, res, user)` in `withUser(handler)`).
/// - An attribute of `self` is the caller's where the constructor binds it from a
///   parameter for which every body around the unit that builds the class passes
///   a value of the caller ([`caller_attribute`]).
fn origin<'a>(
    cx: &Cx<'a>,
    around: &[String],
    r: &Reached<'a>,
    side: &str,
    passed: &[Given],
) -> Origin {
    let own = r.depth == 0 && !r.quiet;
    let request = own || r.dependency();
    let member = match r.node {
        Node::Member(m) => Some(m),
        Node::Sym(_) => None,
    };
    // What the framework calls for the request is passed nothing the facts
    // hold; the unit's own bodies are passed what its wrappers hand them.
    let passed = match request && !own {
        true => &[],
        false => passed,
    };
    origin_of(cx, around, side, request, member, passed)
}

/// What one call passes: each argument by keyword or `#<position>` (`*` for an
/// unpacking), with the origin of the value.
type Given = Vec<(String, Origin)>;

/// What a body is passed for its parameter `side` (`param <name>` or `param
/// <name> #<position>`, the position with the keys the value is read under where
/// it is read off an object: `#0.userId`; [`drift_core::controls::SIDES`]) by the
/// calls of the reach
/// (`calls`, [`passed`]): one origin where every call passes a value of that
/// origin, a resource whatever its kind where every call passes one. Not read
/// where no call of the reach is seen, and where one passes nothing for it (its
/// default) or unpacks its arguments.
fn passed_for(side: &str, calls: &[Given]) -> Origin {
    let given: Vec<Origin> = calls
        .iter()
        .map(|call| given_at(side, call).unwrap_or(Origin::Unread))
        .collect();
    let resource = |o: &Origin| matches!(o, Origin::Row | Origin::Request | Origin::Handed);
    match given.first() {
        None => Origin::Unread,
        Some(first) if given.iter().all(|o| o == first) => *first,
        Some(_) if given.iter().all(resource) => Origin::Handed,
        Some(_) => Origin::Unread,
    }
}

/// The keys a body's facts name under `control`
/// ([`drift_core::controls::HOLDS_SENT`], [`drift_core::controls::READS_HELD`]).
fn held_keys<'a>(n: Node<'a>, control: &'static str) -> impl Iterator<Item = &'a str> {
    let facts: &'a [String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    facts.iter().filter_map(move |f| f.strip_prefix(control))
}

/// What one call passes for the parameter `side` ([`passed_for`]); None where
/// it passes nothing for it.
fn given_at(side: &str, call: &Given) -> Option<Origin> {
    let mut parts = side.split(' ').skip(1);
    let name = parts.next().unwrap_or_default();
    let position = parts.next();
    if let Some((key, o)) = call
        .iter()
        .find(|(key, _)| key == name || Some(key.as_str()) == position || key == "*")
    {
        return Some(if key == "*" { Origin::Unread } else { *o });
    }
    // Read under keys of what the position holds (`#0.userId` of `opts
    // .userId`, of `({ userId })`), and the call wrote no such key in place:
    // a member of the value it gave, which is of that value's origin.
    let mut at = position;
    while let Some((holder, _)) = at.and_then(|p| p.rsplit_once('.')) {
        if let Some((_, o)) = call.iter().find(|(key, _)| key == holder) {
            return Some(*o);
        }
        at = Some(holder);
    }
    None
}

/// What the wrappers around a unit hand its own body for the parameter `side`
/// (`handed`, [`handed_by_wrappers`]): the caller's where one hands a value
/// there and every one that does hands a value of the caller. A wrapper that
/// calls what it was given with fewer values (`withErrors(withUser(handler))`
/// calls the function `withUser` built) is not the one that calls the body.
fn handed_for(side: &str, handed: &[Given]) -> bool {
    let mut given = handed
        .iter()
        .filter_map(|call| given_at(side, call))
        .peekable();
    given.peek().is_some() && given.all(|o| o == Origin::Caller)
}

/// What each call the wrappers around a unit make of a function they were
/// given hands it ([`drift_core::controls::PARAM_CALLED`], the parameter itself
/// called): `handler(req, res, currentUser(req))` in `withUser(handler)`, around
/// `export const GET = withUser(async (req, res, user) => ...)` and where the
/// unit runs what the wrapper built (`app.get("/notes", withUser(...))`). The origin of
/// each value is read in the wrapper's body, whose own parameters are the
/// functions it wraps and prove nothing.
fn handed_by_wrappers(cx: &Cx<'_>, around: &[String], wrappers: &[&str]) -> Vec<Given> {
    let ctx = cx.context();
    let mut out = Vec::new();
    for w in wrappers {
        let w = crate::mine::norm_ref(w);
        // A function of the repository: what a package built (`t.procedure
        // .use(...)`) calls what it was given as the package says.
        let Some(d) = ctx
            .definition(&w)
            .filter(|d| d.name == common::short(&w) && d.kind == SymbolKind::Function)
        else {
            continue;
        };
        for (callee, given) in arg_calls(d.controls.iter()) {
            if callee
                .strip_prefix(drift_core::controls::PARAM_CALLED)
                .is_none_or(|name| name.contains('.'))
            {
                continue;
            }
            out.push(
                given
                    .iter()
                    .map(|(key, side)| {
                        (
                            key.to_string(),
                            origin_of(cx, around, side, false, None, &[]),
                        )
                    })
                    .collect(),
            );
        }
    }
    out
}

/// [`origin`] of a side written in a body whose parameters are what the request
/// sent (`request`) or what the calls of the reach pass (`passed`; for the
/// unit's own body, what its wrappers hand it), and that is the method `member`
/// where it is one.
fn origin_of(
    cx: &Cx<'_>,
    around: &[String],
    side: &str,
    request: bool,
    member: Option<&Member>,
    passed: &[Given],
) -> Origin {
    let ctx = cx.context();
    let returns_request = |c: &str| {
        !common::external(c)
            && ctx.definition(c).is_some_and(|d| {
                d.name == common::short(&crate::mine::norm_ref(c))
                    && (d
                        .controls
                        .iter()
                        .any(|x| x == drift_core::controls::RETURNS_REQUEST)
                        || d.members.iter().any(|m| {
                            m.name == "__call__"
                                && m.unread
                                    .iter()
                                    .any(|x| x == drift_core::controls::RETURNS_REQUEST)
                        }))
            })
    };
    match side {
        "caller" => Origin::Caller,
        "request" => Origin::Request,
        "literal" | "setting" => Origin::Fixed,
        _ if side.starts_with("param") && request => match handed_for(side, passed) {
            true => Origin::Caller,
            false => Origin::Request,
        },
        _ if side.starts_with("param") => passed_for(side, passed),
        _ => {
            if let Some(dep) = side.strip_prefix("call via ") {
                // What a method of it hands back: of the request's value, of the
                // caller's, else of a resource (a session, a repository).
                if returns_request(dep) {
                    Origin::Request
                } else if gives_caller(cx, dep, true) {
                    Origin::Caller
                } else {
                    Origin::Handed
                }
            } else if let Some(dep) = side.strip_prefix("via ") {
                // The value itself: the request's, the caller's, else not read (a
                // dependency may give a setting as easily as a resource).
                if returns_request(dep) {
                    Origin::Request
                } else if gives_caller(cx, dep, true) {
                    Origin::Caller
                } else {
                    Origin::Unread
                }
            } else if let Some(giver) = side.strip_prefix("gives ") {
                if returns_request(giver) {
                    Origin::Request
                } else if gives_caller(cx, giver, true) {
                    Origin::Caller
                } else {
                    Origin::Unread
                }
            } else if let Some(callee) = side.strip_prefix("call ") {
                if data_call(cx, callee) {
                    Origin::Row
                } else {
                    Origin::Handed
                }
            } else if let Some(attr) = side.strip_prefix("self.") {
                match member {
                    Some(m) if caller_attribute(cx, around, m, attr) => Origin::Caller,
                    _ => Origin::Handed,
                }
            } else {
                // A module-level value, or what was not read.
                Origin::Unread
            }
        }
    }
}

/// An attribute of `self`, read in the method `m`, is a value of the caller for this
/// unit: the constructor of the class binds it from one of its parameters
/// ([`drift_core::controls::ATTR_PARAM`]), and every body around the unit that
/// builds the class (`around`: the unit's own bodies and its dependencies, by
/// canonical name; `def get_service(caller: CallerDep) -> Service: return
/// Service(repo, principal=caller)`) passes a value of the caller for that
/// parameter ([`drift_core::controls::ARG_VALUE`]: a value by the closed list of
/// sources, or what a dependency that signs the caller in gives). One that passes
/// anything else (`principal=Principal(org_id=None, ...)`), and a unit
/// around which nothing builds the class, prove nothing: the attribute is then a
/// resource the object holds.
fn caller_attribute(cx: &Cx<'_>, around: &[String], m: &Member, attr: &str) -> bool {
    let ctx = cx.context();
    // The class of the method.
    let Some(class) = cx.facts.files.iter().find_map(|f| {
        f.symbols
            .iter()
            .find(|s| s.kind == SymbolKind::Class && s.members.iter().any(|x| std::ptr::eq(x, m)))
            .map(|s| format!("{}#{}", f.path, s.name))
    }) else {
        return false;
    };
    // The parameter the attribute is bound from, by the first class of the built
    // class's line that defines a constructor.
    // (By the order Python looks `__init__` up in; nothing where it cannot be
    // worked out.)
    let bound_from = |built: &str| -> Option<(String, String)> {
        let class = ctx
            .definition(built)
            .filter(|d| d.kind == SymbolKind::Class && d.name == common::short(built))?;
        crate::security::class_order(ctx, built, class)?
            .into_iter()
            .filter_map(|c| match c {
                crate::security::Mro::Repo(_, d) => Some(d),
                crate::security::Mro::Package(_) => None,
            })
            // (or, a dataclass, whose generated constructor binds its fields)
            .find(|d| {
                d.members.iter().any(|x| x.name == "__init__")
                    || d.controls
                        .iter()
                        .any(|c| c.starts_with(drift_core::controls::ATTR_PARAM))
            })
            .and_then(|d| {
                let mut bound = d.controls.iter().filter_map(|c| {
                    let rest = c.strip_prefix(drift_core::controls::ATTR_PARAM)?;
                    let mut parts = rest.split('\t');
                    (parts.next()? == attr)
                        .then(|| Some((parts.next()?.to_string(), format!("#{}", parts.next()?))))
                        .flatten()
                });
                let first = bound.next()?;
                // Bound twice: which binding stands is not read.
                bound.next().is_none().then_some(first)
            })
    };
    let mut built_here = false;
    for b in around {
        let Some(d) = ctx.definition(b) else {
            continue;
        };
        // What the body records, a function's own or a class's `__call__`.
        let facts: Vec<&String> = d
            .controls
            .iter()
            .chain(d.members.iter().flat_map(|x| &x.unread))
            .collect();
        for built in d.calls.iter().map(|c| crate::mine::norm_ref(c)) {
            let builds = *built == class || ctx.ancestors(&built).contains(&class);
            if !builds
                || !ctx
                    .definition(&built)
                    .is_some_and(|k| k.kind == SymbolKind::Class && k.name == common::short(&built))
            {
                continue;
            }
            built_here = true;
            let Some((param, position)) = bound_from(&built) else {
                return false;
            };
            // Every call of the class passes a value of the caller for it.
            let mut calls = arg_calls(facts.iter().copied())
                .filter(|(callee, _)| crate::mine::norm_ref(callee) == built)
                .peekable();
            let callers = calls.peek().is_some()
                && calls.all(|(_, given)| {
                    given
                        .iter()
                        .find(|(key, _)| *key == param || *key == position || *key == "*")
                        .is_some_and(|(key, side)| {
                            *key != "*"
                                && origin_of(cx, around, side, false, None, &[]) == Origin::Caller
                        })
                });
            if !callers {
                return false;
            }
        }
    }
    built_here
}

/// The calls a body records ([`drift_core::controls::ARG_VALUE`]): the callee,
/// and what each argument is, by keyword or `#<position>` (`*` for an unpacking).
/// A side that is the caller itself ([`drift_core::controls::OWN_SIDE`]) is the
/// side it is.
fn arg_calls<'a>(
    facts: impl Iterator<Item = &'a String>,
) -> impl Iterator<Item = (&'a str, Vec<(&'a str, &'a str)>)> {
    arg_calls_own(facts).map(|(callee, given)| {
        (
            callee,
            given
                .into_iter()
                .map(|(key, side)| {
                    (
                        key,
                        side.strip_prefix(drift_core::controls::OWN_SIDE)
                            .unwrap_or(side),
                    )
                })
                .collect(),
        )
    })
}

/// [`arg_calls`], each side as written: `own <side>` where the value is the
/// caller itself or the key of the caller's record.
fn arg_calls_own<'a>(
    facts: impl Iterator<Item = &'a String>,
) -> impl Iterator<Item = (&'a str, Vec<(&'a str, &'a str)>)> {
    facts.filter_map(|f| {
        let rest = f.strip_prefix(drift_core::controls::ARG_VALUE)?;
        let mut parts = rest.split('\t');
        let callee = parts.next()?;
        let mut given = Vec::new();
        while let (Some(key), Some(side)) = (parts.next(), parts.next()) {
            given.push((key, side));
        }
        Some((callee, given))
    })
}

/// A side of [`drift_core::controls::ARG_VALUE`] is the caller itself or the key
/// of the caller's record ([`drift_core::controls::OWN_SIDE`]), of a caller the
/// facts prove ([`side_is_callers`]).
fn side_is_caller_self(cx: &Cx<'_>, side: &str) -> bool {
    side.strip_prefix(drift_core::controls::OWN_SIDE)
        .is_some_and(|inner| side_is_callers(cx, inner))
}

/// Per body of the reach: the calls of it the bodies of the reach make
/// ([`drift_core::controls::ARG_VALUE`]), each with what it passes, by keyword or
/// `#<position>` (`*` for an unpacking), each value's origin read in the calling
/// body (`assert_same_org(rule, user)`, `service.check(document.org_id,
/// user.org_id)`). What a calling body passes of its own parameters is what it was
/// passed in turn; a call around a cycle is not read.
///
/// The unit's own bodies are passed what the wrappers around the unit hand them
/// (`handed`, [`handed_by_wrappers`]).
fn passed<'a>(
    cx: &Cx<'a>,
    reach: &Reach<'a>,
    around: &[String],
    handed: &[Given],
) -> Vec<Vec<Given>> {
    // The calls of the reach into the reach: from, to, what is passed.
    type Edge<'a> = (usize, usize, Vec<(&'a str, &'a str)>);
    let mut edges: Vec<Edge<'a>> = Vec::new();
    for (i, r) in reach.nodes.iter().enumerate() {
        let facts: &'a [String] = match r.node {
            Node::Sym(s) => &s.controls,
            Node::Member(m) => &m.unread,
        };
        for (callee, given) in arg_calls(facts.iter()) {
            let to = match resolve(cx, r.node, callee) {
                Callee::Function(f) => Node::Sym(f),
                Callee::Method { member, .. } => Node::Member(member),
                _ => continue,
            };
            for (j, x) in reach.nodes.iter().enumerate() {
                if x.node.same(to) {
                    edges.push((i, j, given.clone()));
                }
            }
        }
    }
    fn into<'a>(
        cx: &Cx<'a>,
        around: &[String],
        handed: &[Given],
        reach: &Reach<'a>,
        edges: &[Edge<'a>],
        j: usize,
        stack: &mut Vec<usize>,
    ) -> Vec<Given> {
        if reach.nodes[j].depth == 0 && !reach.nodes[j].quiet {
            return handed.to_vec();
        }
        stack.push(j);
        let mut out = Vec::new();
        for (i, _, given) in edges.iter().filter(|e| e.1 == j) {
            let r = &reach.nodes[*i];
            let request = (r.depth == 0 && !r.quiet) || r.dependency();
            let mut call = Vec::new();
            for (key, side) in given {
                let o = if side.starts_with("param") && !request {
                    if stack.contains(i) || stack.len() > AUTHZ_HOPS {
                        Origin::Unread
                    } else {
                        let calls = into(cx, around, handed, reach, edges, *i, stack);
                        passed_for(side, &calls)
                    }
                } else {
                    origin(cx, around, r, side, handed)
                };
                call.push((key.to_string(), o));
            }
            out.push(call);
        }
        stack.pop();
        out
    }
    (0..reach.nodes.len())
        .map(|j| into(cx, around, handed, reach, &edges, j, &mut Vec::new()))
        .collect()
}

/// What the lowering recorded of the two sides of the comparison a check of `n`
/// makes ([`drift_core::controls::SIDES`]), by the check's own `source`, `reads`
/// and `compares`. `None` where nothing is recorded (facts written by hand or by
/// another lowering); both unread where two comparisons the facts hold as one
/// check say different things.
fn recorded_sides<'a>(
    n: Node<'a>,
    source: &str,
    reads: &str,
    compares: &str,
) -> Option<(&'a str, &'a str)> {
    let facts: &'a [String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let compares = if compares == drift_core::UNREAD_COMPARE {
        ""
    } else {
        compares
    };
    let mut found: Option<(&'a str, &'a str)> = None;
    for f in facts {
        let Some(rest) = f.strip_prefix(drift_core::controls::SIDES) else {
            continue;
        };
        let parts: Vec<&'a str> = rest.split('\t').collect();
        let [s, r, c, left, right] = parts.as_slice() else {
            continue;
        };
        if *s != source || *r != reads || *c != compares {
            continue;
        }
        match found {
            None => found = Some((left, right)),
            Some(x) if x == (*left, *right) => {}
            Some(_) => return Some(("unread", "unread")),
        }
    }
    found
}

/// A Python comparison is a check of the caller: one side is read off the caller
/// and the other off the row, the request or what the body was handed. `None`
/// where the lowering recorded nothing of the sides.
///
/// [STRICT] A side read off a setting, the environment, a constant or a literal,
/// the request on both sides, the caller on both sides, and a side whose origin
/// is not read make it a comparison that was found and is not proven to be the
/// caller's. A parameter of a body below the handler is what the calls of the
/// reach pass for it ([`passed`]), and not read where they do not say.
fn python_sides<'a>(
    cx: &Cx<'a>,
    r: &Reached<'a>,
    ev: &Evidence,
    source: &str,
    reads: &str,
    compares: &str,
) -> Option<bool> {
    if !cx.context().since_measured() {
        return None;
    }
    let (left, right) = recorded_sides(r.node, source, reads, compares)?;
    if same_value(source, compares) {
        return Some(false);
    }
    let (a, b) = (
        origin(cx, &ev.around, r, left, &ev.passed),
        origin(cx, &ev.around, r, right, &ev.passed),
    );
    let other = |o: Origin| matches!(o, Origin::Row | Origin::Request | Origin::Handed);
    Some((a == Origin::Caller && other(b)) || (b == Origin::Caller && other(a)))
}

/// A Python role check reads the role off the caller: one side of the comparison
/// is a value of the caller by the closed list of sources ([`Origin::Caller`]):
/// `Some(true)`; `Some(false)` where neither is and one is what the request sent
/// (a header, a body field, a query parameter); `None` where the lowering recorded
/// nothing of the sides or their origin is not read.
fn python_role_side<'a>(
    cx: &Cx<'a>,
    r: &Reached<'a>,
    ev: &Evidence,
    source: &str,
    reads: &str,
    compares: &str,
) -> Option<bool> {
    if !cx.context().since_measured() {
        return None;
    }
    let (left, right) = recorded_sides(r.node, source, reads, compares)?;
    let (a, b) = (
        origin(cx, &ev.around, r, left, &ev.passed),
        origin(cx, &ev.around, r, right, &ev.passed),
    );
    if a == Origin::Caller || b == Origin::Caller {
        return Some(true);
    }
    // What the request sent, against a literal or another value of the request: no
    // value of the caller. Where the request sent it: a header, a body or a query
    // read as such, or a parameter of the unit's own handler (one of a wrapper
    // around a function the handler calls is what the handler passed). A side
    // whose origin is not read is left to the name rule ([`checks`]), as before.
    let own = r.depth == 0 && !r.quiet;
    let sent = |side: &str, o: Origin| {
        o == Origin::Request && (side == "request" || side.starts_with("gives ") || own)
    };
    // [STRICT] What a query or a call handed back, against a literal or a setting
    // (`if row.estate_id != "acme": raise HTTPException(403)`): a value of the
    // resource, checked whoever calls. Whatever the value is called: with a key named
    // for a tenant it was never read as a role.
    let resource = |o: Origin| matches!(o, Origin::Row | Origin::Handed);
    let fixed = |o: Origin| o == Origin::Fixed;
    let of_the_resource = (resource(a) && fixed(b)) || (resource(b) && fixed(a));
    (sent(left, a) || sent(right, b) || of_the_resource).then_some(false)
}

/// Where the value a scoped query of `r` filters `key` by comes from
/// ([`drift_core::controls::FILTER_VALUE`]). `None` where nothing is recorded.
fn python_filter<'a>(
    cx: &Cx<'a>,
    r: &Reached<'a>,
    ev: &Evidence,
    callee: &str,
    key: &str,
) -> Option<Origin> {
    if !cx.context().since_measured() {
        return None;
    }
    let facts: &[String] = match r.node {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let mut found: Option<Origin> = None;
    for f in facts {
        let Some(rest) = f.strip_prefix(drift_core::controls::FILTER_VALUE) else {
            continue;
        };
        let parts: Vec<&str> = rest.split('\t').collect();
        let [c, k, side] = parts.as_slice() else {
            continue;
        };
        if *c != callee || *k != key {
            continue;
        }
        let o = origin(cx, &ev.around, r, side, &ev.passed);
        match found {
            None => found = Some(o),
            Some(x) if x == o => {}
            Some(_) => return Some(Origin::Unread),
        }
    }
    found
}

/// The two sides of a comparison may be the caller's and the resource's or the
/// request's. [STRICT]: not where both are the same value's members (`rule.org_id !=
/// rule.owner_org_id` compares a row with itself), and not where both are what the
/// request sent, in a Python handler's own body (`body.org_id != org_id`, a body field
/// and a path parameter: a caller of any tenant passes by sending the same value
/// twice). A side read off something named for the caller (`request.user`) is the
/// caller's.
fn sides(source: &str, reads: &str, compares: &str, own_body: bool) -> bool {
    if same_value(source, compares) {
        return false;
    }
    let requested = |s: &str| s.starts_with("header:") || s.starts_with("param:");
    let subject = |s: &str| {
        s.trim_start_matches("param:")
            .split('.')
            .any(drift_core::controls::names_subject)
    };
    !(own_body
        && requested(source)
        && requested(compares)
        && !subject(source)
        && !subject(reads)
        && !subject(compares))
}

/// What a call gave, compared with what the same call gave: a parameter says nothing
/// here (`self._load(id).org_id != self.caller.org_id` reads `self` twice).
fn same_value(source: &str, compares: &str) -> bool {
    compares.strip_prefix("call:").is_some_and(|other| {
        !source.is_empty() && (other == source || other.starts_with(&format!("{source}.")))
    })
}

/// One side of a TypeScript comparison is read off the caller: a session, a user or
/// a token. The facts name what each side is read from and the member path read
/// ([`drift_core::BodyCheck::compares_path`]); where neither says the caller, the
/// comparison is of the row and the request, or of two things the request sent, and
/// a caller of any tenant passes it by sending the value it is compared with.
fn caller_side(c: &drift_core::BodyCheck) -> bool {
    whose(&c.source, &c.reads) == Whose::Caller
        || whose(&c.compares, &c.compares_path) == Whose::Caller
}

/// Whose a value is, by what it is read from and the path read ([`whose`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Whose {
    /// Read off the caller: a session, a user, a token.
    Caller,
    /// What the request sent: a body, a query, a path parameter, a header.
    Sent,
    /// Neither is said: a row, what a function returned, a value that was not read.
    Other,
}

/// Whose a value is. The caller's:
///
/// - a parameter named for the caller (`session.orgId`, `user`, `currentUser.orgId`);
/// - a member named for the caller of a request or a context (`req.user.orgId`,
///   `ctx.session.user.orgId`, `req.auth.orgId`), read before any member that holds
///   what the request sent (`req.body.user.orgId` is the body's);
/// - what a function named for the caller returned (`(await getSession()).orgId`,
///   `auth().orgId`), or a member named for the caller of what another returned
///   (`(await load()).session.orgId`).
///
/// The last member is the value itself, and names nothing (`req.body.userId`). What
/// the request sent: a header, and a member that holds input (`req.query.orgId`,
/// `params.orgId`). A literal and a value that could not be read are neither.
fn whose(root: &str, path: &str) -> Whose {
    /// Members that hold what the request sent.
    const SENT: &[&str] = &[
        "body",
        "query",
        "params",
        "param",
        "headers",
        "header",
        "cookies",
        "searchParams",
        "nextUrl",
        "url",
        "input",
        "rawInput",
        "parsedInput",
        "formData",
        "json",
        "args",
        "payload",
    ];
    let subject = |s: &str| {
        drift_core::controls::names_subject(s)
            || super::libraries::key_words(s).iter().any(|w| {
                matches!(
                    w.as_str(),
                    "caller" | "principal" | "claims" | "viewer" | "identity" | "actor" | "me"
                )
            })
    };
    let first = if let Some(name) = root.strip_prefix("param:") {
        name
    } else if root.starts_with("header:") {
        return Whose::Sent;
    } else if root.is_empty() || matches!(root, "literal" | "env" | drift_core::UNREAD_COMPARE) {
        return Whose::Other;
    } else {
        // A callee: the function's own name (`db.user.findUnique` is `findUnique`,
        // a query, not the caller).
        let name = common::short(root.trim_start_matches("call:"));
        name.rsplit('.').next().unwrap_or(name)
    };
    let mut members: Vec<&str> = path.split('.').filter(|s| !s.is_empty()).collect();
    members.pop();
    for seg in std::iter::once(first).chain(members) {
        if SENT.contains(&seg) {
            return Whose::Sent;
        }
        if subject(seg) {
            return Whose::Caller;
        }
    }
    Whose::Other
}

/// Query keys that filter by tenant or owner, on a database call
/// (`prisma.x.findMany({ where: { organizationId } })`, `Model.objects.filter(org=...)`),
/// and the scoped queries the lowering records with where the value came from. Of a
/// class's method, a value from the method's own parameter is whatever its caller
/// passed: a filter by a tenant key, of a source the facts do not say.
/// The scoped queries of a body ([`common::scoped`]).
fn scoped_of(n: Node<'_>) -> Vec<common::Scoped> {
    match n {
        Node::Sym(b) => common::scoped_queries(b),
        Node::Member(m) => common::scoped(&m.scoped_queries),
    }
}

fn filters<'a>(cx: &Cx<'a>, r: &Reached<'a>, ev: &mut Evidence) {
    let n = r.node;
    let (scoped, args) = (
        scoped_of(n),
        match n {
            Node::Sym(b) => &b.args,
            Node::Member(m) => &m.args,
        },
    );
    for q in &scoped {
        // Python: by where the value comes from, as the lowering recorded it
        // ([`python_filter`]): the caller's, the caller's tenant; what the request
        // sent, the tenant it asked for; a literal, one tenant named; anything
        // else, a filter found and not proven.
        if let Some(o) = python_filter(cx, r, ev, &q.callee, &q.key) {
            // What the request sent, handed on to a method below the handler, is
            // found and not proven there, as a method's parameter always was; to a
            // function, it is the tenant the request asked for, as before.
            let request_body =
                (r.depth == 0 && !r.quiet) || r.dependency() || matches!(n, Node::Sym(_));
            let (mechanism, label) = match o {
                Origin::Caller => ("tenancy_filter", format!("{} (session)", q.key)),
                Origin::Request if !request_body => {
                    ev.unsourced_filter("tenancy_filter", &q.key);
                    continue;
                }
                Origin::Request if matches!(q.source.as_str(), "param" | "header") => {
                    ("tenancy_requested", q.label())
                }
                Origin::Request => ("tenancy_requested", format!("{} (param)", q.key)),
                Origin::Fixed
                    if !matches!(q.source.as_str(), "session" | "unknown" | "param" | "header") =>
                {
                    ("tenancy_literal", q.label())
                }
                _ => {
                    ev.unsourced_filter("tenancy_filter", &q.key);
                    continue;
                }
            };
            if mechanism == "tenancy_filter" && !q.condition.is_empty() {
                ev.find(mechanism, &label, &q.condition, "", false);
                continue;
            }
            ev.add(mechanism, &label, VariantSource::Usage);
            continue;
        }
        // A method's parameter is whatever its caller passed, which the facts do not
        // follow: the query is filtered by a tenant key, by a value of no known
        // source. It may be the scope, so the unit is not a recorded absence, and it
        // may be anyone's, so it is not a known scope either.
        if matches!(n, Node::Member(_)) && matches!(q.source.as_str(), "param" | "unknown") {
            if !r.quiet && ev.unsourced.as_ref().is_none_or(|x| r.callee < *x) {
                ev.unsourced = Some(r.callee.clone());
            }
            continue;
        }
        // From the caller's session the scope is enforced; from a parameter or a header
        // it is the tenant the caller asked for, enforced only by a check against the
        // session; a literal names one tenant.
        let mechanism = match q.source.as_str() {
            "session" => "tenancy_filter",
            // [STRICT]: a value whose source the facts do not say may be what the
            // request sent: a filter found, not proven to be by the caller's tenant.
            "unknown" => {
                ev.unsourced_filter("tenancy_filter", &q.label());
                continue;
            }
            "param" | "header" => "tenancy_requested",
            _ => "tenancy_literal",
        };
        // [STRICT]: a query filtered only for the requests that take a branch (`if
        // mine: stmt = stmt.where(Rule.org_id == caller.org_id)`) scopes those: the
        // others are answered by another query. Found, not proven.
        if mechanism == "tenancy_filter" && !q.condition.is_empty() {
            ev.find(mechanism, &q.label(), &q.condition, "", false);
            continue;
        }
        ev.add(mechanism, &q.label(), VariantSource::Usage);
    }
    for a in args {
        let Some((callee, key)) = a
            .rsplit_once('@')
            .and_then(|(c, rest)| rest.split_once(':').map(|(_, k)| (c, k)))
        else {
            continue;
        };
        if !filter_key(key)
            || !query_call(cx, callee, key)
            || writes(callee)
            || own_body(cx, n, callee)
        {
            continue;
        }
        let last = key.rsplit('.').next().unwrap_or(key);
        // The value the key filters by is the caller's own, by where the lowering
        // read it. TypeScript: [`drift_core::controls::FILTER_VALUE`], side
        // `caller`, in a call every request to the body reaches. Python: every
        // query the body makes of the same rows is given one
        // ([`given_callers`]).
        let callers = match ev.python {
            false => {
                let by_caller = filtered_by_caller(n, callee, key)
                    || (cx.context().since_measured()
                        && (filtered_by_passed(cx, r, ev, callee, key)
                            || (!ev.identifies
                                && given_caller_in_every_call(n, callee, key).is_some())));
                // [STRICT]: filtered by the caller, and another query of the unit
                // selects rows by nothing of the caller: this query is scoped, what
                // the route reads is not proven to be.
                if by_caller
                    && (names_tenant(last) || names_owner(last))
                    && let Some(other) = ev.unscoped_read.clone()
                {
                    let mechanism = match names_tenant(last) {
                        true => "tenancy_filter",
                        false => "owner_filter",
                    };
                    if !names_tenant(last) || scoped.is_empty() {
                        ev.find(
                            mechanism,
                            &format!("{key} (session)"),
                            obligation::OTHER_READ_UNSCOPED,
                            &common::short(&other).replace("()", ""),
                            false,
                        );
                    }
                    continue;
                }
                by_caller
            }
            true => {
                let given = cx.context().since_measured() && given_callers(cx, n, callee, key);
                // [STRICT]: filtered by the caller (an alias of the request's user
                // followed: `user = request.user` then `filter(user=user)`), and
                // another query of the unit reads rows by nothing of the caller
                // ([`reads_unscoped`]): this query is scoped, what the route reads
                // is not proven to be. Said as that, not as sides not proven.
                if given
                    && ev.reads_unscoped
                    && ev.cond.is_none()
                    && (!names_tenant(last) || scoped.is_empty())
                {
                    let mechanism = match names_tenant(last) {
                        true => "tenancy_filter",
                        false => "owner_filter",
                    };
                    ev.find(
                        mechanism,
                        &format!("{key} (session)"),
                        obligation::OTHER_READ_UNSCOPED,
                        "",
                        false,
                    );
                    continue;
                }
                given && !ev.reads_unscoped
            }
        };
        if !names_tenant(last) && !names_owner(last) {
            // Python: rows filtered by a value of the caller are the caller's,
            // whatever the key is called (`Seat.objects.filter(holder=
            // request.user)`): the value says so, not the name.
            if callers && ev.python {
                ev.add(
                    "owner_filter",
                    &format!("{key} (session)"),
                    VariantSource::Usage,
                );
                continue;
            }
            // TypeScript: so are rows a query narrows to the caller itself under
            // any key (`prisma.user.findUnique({ where: { id: userId } })` with
            // what the sign-in call handed back, `where: { holder:
            // session.user.id }`): the value says whose they are. A group or a
            // setting read off the caller (`session.user.kennelId`) says less,
            // and stays a use of the caller's value. Proven where every read of
            // the unit is narrowed so; beside one that is not, found.
            if callers
                && cx.context().since_measured()
                && !ev.identifies
                && given_caller_itself(n, callee, key)
                && key.split('.').all(|seg| !NOT_NARROWING.contains(&seg))
            {
                match ev.unscoped_read.clone() {
                    Some(other) => ev.find(
                        "owner_filter",
                        &format!("{key} (session)"),
                        obligation::OTHER_READ_UNSCOPED,
                        &common::short(&other).replace("()", ""),
                        false,
                    ),
                    None => ev.add(
                        "owner_filter",
                        &format!("{key} (session)"),
                        VariantSource::Usage,
                    ),
                }
                continue;
            }
            let c = crate::mine::norm_ref(callee).into_owned();
            if ev.unsourced.as_ref().is_none_or(|x| c < *x) {
                ev.unsourced = Some(c);
            }
            continue;
        }
        if names_tenant(last) {
            // The lowering's scoped queries say more (where the value came from).
            // [STRICT]: a key named for a tenant, with nothing recorded of where
            // its value came from (`where: { orgId }` with `orgId` from the query
            // string, the body, a cookie or a constant filters by what the request
            // chose): found, not proven.
            if scoped.is_empty() {
                match callers {
                    true => ev.add(
                        "tenancy_filter",
                        &format!("{key} (session)"),
                        VariantSource::Usage,
                    ),
                    false => ev.unsourced_filter("tenancy_filter", key),
                }
            }
        } else if names_owner(last) {
            match callers {
                true => ev.add(
                    "owner_filter",
                    &format!("{key} (session)"),
                    VariantSource::Usage,
                ),
                false => ev.unsourced_filter("owner_filter", key),
            }
        }
    }
    // Python: the rows a statement reads by the caller itself, whatever the key is
    // called and however the query is written ([`drift_core::controls::ROWS`]:
    // `select(Item).where(Item.owner_id == current_user.id)`), where every read of
    // the unit is by the caller ([`reads_unscoped`]).
    if ev.python && cx.context().since_measured() && !ev.reads_unscoped {
        let facts: &[String] = match n {
            Node::Sym(s) => &s.controls,
            Node::Member(m) => &m.unread,
        };
        let census = row_census(cx, facts);
        for (model, by) in &census {
            // (Under a key named for a tenant the filter is the tenant's, read
            // above by where its value comes from.)
            if let RowsBy::Own(key, side, _) = by
                && side_is_caller_self(cx, side)
                && !names_tenant(key)
            {
                // The same rows read whole in a branch taken on the caller's role:
                // the filter is "the caller's own, or a role", and says so.
                let or_a_role = census.iter().any(|(m, other)| {
                    m == model && matches!(other, RowsBy::ByRole(role) if side_is_callers(cx, role))
                });
                let label = match or_a_role {
                    true => format!("{key} (session){OR_A_ROLE}"),
                    false => format!("{key} (session)"),
                };
                ev.add("owner_filter", &label, VariantSource::Usage);
            }
        }
    }
}

/// TypeScript: the body filters `callee` under `key` by a value read off one of
/// its own parameters ([`drift_core::controls::FILTER_VALUE`], side `param ...`),
/// and every call of the body the unit's bodies make passes a value of the caller
/// for that parameter ([`origin`], [`passed`]): `listNotes(req.user.id)` in the
/// handler, `where: { userId }` in `listNotes(userId)`. A parameter the request
/// chose (`listNotes(req.params.userId)`), or one no call of the reach is seen to
/// pass, proves nothing. In the unit's own body a parameter is the caller's
/// where the wrappers around the unit hand it one ([`handed_for`]). Every filter of the callee under the key must be so, or
/// by the caller's own value written there.
fn filtered_by_passed<'a>(
    cx: &Cx<'a>,
    r: &Reached<'a>,
    ev: &Evidence,
    callee: &str,
    key: &str,
) -> bool {
    let facts: &[String] = match r.node {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let callee = crate::mine::norm_ref(callee);
    let mut sides = facts
        .iter()
        .filter_map(|f| f.strip_prefix(drift_core::controls::FILTER_VALUE))
        .filter_map(|rest| {
            let mut parts = rest.split('\t');
            (parts.next()? == callee && parts.next()? == key).then(|| parts.next())?
        })
        .peekable();
    sides.peek().is_some()
        && sides.all(|side| {
            side == "caller"
                || (side.starts_with("param")
                    && origin(cx, &ev.around, r, side, &ev.passed) == Origin::Caller)
        })
}

/// The body `from` takes what a call of `callee` (written `c`) hands back as who
/// calls ([`drift_core::controls::CALLER_FROM`]).
fn caller_from(from: Node<'_>, c: &str, callee: &str) -> bool {
    let facts: &[String] = match from {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    facts.iter().any(|f| {
        f.strip_prefix(drift_core::controls::CALLER_FROM)
            .is_some_and(|x| x == c || x == callee)
    })
}

/// TypeScript: every call of `callee` the body makes, on whatever path, is handed
/// a value of the caller under `key` ([`drift_core::controls::FILTER_EVERY`]:
/// `if (intent === "delete") await db.passkey.delete({ where: { id, userId } })`
/// with what gives the caller), and whether each is the caller itself. A request
/// that takes no such path makes no call of it, and one that does reads or writes
/// rows of the caller: whether another query of the unit selects by nothing of
/// the caller is asked where the filter is counted ([`ts_unscoped_read`]).
fn given_caller_in_every_call(n: Node<'_>, callee: &str, key: &str) -> Option<bool> {
    let facts: &[String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let norm = crate::mine::norm_ref(callee);
    facts.iter().find_map(|f| {
        let mut parts = f
            .strip_prefix(drift_core::controls::FILTER_EVERY)?
            .split('\t');
        let c = parts.next()?;
        ((c == callee || c == norm) && parts.next()? == key).then(|| parts.next() == Some("own"))
    })
}

/// TypeScript: every call of `callee` the body makes that gives `key` gives it
/// the caller itself or the key of the caller's record
/// ([`drift_core::controls::FILTER_OWN`]): not a group or a setting read off the
/// caller.
fn given_caller_itself(n: Node<'_>, callee: &str, key: &str) -> bool {
    let facts: &[String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let norm = crate::mine::norm_ref(callee);
    facts.iter().any(|f| {
        f.strip_prefix(drift_core::controls::FILTER_OWN)
            .and_then(|rest| rest.split_once('\t'))
            .is_some_and(|(c, k)| (c == callee || c == norm) && k == key)
    })
}

/// Python: every call of `callee` the body makes gives `key` the caller itself
/// or the key of the caller's record ([`side_is_caller_self`]): the rows found
/// are this caller's and no one else's, whatever the key is called. A value read
/// off the caller (`request.user.org_id`, a claim) says a group or a setting of
/// the caller: whether the key scopes by it is said by the key
/// ([`names_tenant`]), not here. Proof of the route only where no body of its
/// reach reads rows by nothing of the caller ([`reads_unscoped`]).
fn given_callers(cx: &Cx<'_>, n: Node<'_>, callee: &str, key: &str) -> bool {
    let facts: &[String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let callee = crate::mine::norm_ref(callee);
    let mut under = arg_calls_own(facts.iter())
        .filter(|(c, _)| *c == callee)
        .map(|(_, given)| {
            let mut sides = given.iter().filter(|(k, _)| *k == key).peekable();
            sides.peek().is_some() && sides.all(|(_, side)| side_is_caller_self(cx, side))
        })
        .peekable();
    under.peek().is_some() && under.all(|callers| callers)
}

/// The rows a query starts from, where `callee` starts one on a model of the
/// repository: `app/models.py#Doc.objects` of `app/models.py#Doc.objects.filter`.
/// None of a call made on what another call handed back
/// (`...filter().order_by`: the query it narrows), and of what is no data call.
fn query_rows<'c>(cx: &Cx<'_>, callee: &'c str) -> Option<&'c str> {
    let (rows, method) = callee.rsplit_once('.')?;
    let (module, path) = rows.split_once('#')?;
    let model = path.split('.').next()?;
    let class = format!("{module}#{model}");
    (!path.contains('(')
        && !method.contains('(')
        && !common::external(callee)
        && data_call(cx, &class)
        && !schema_only(cx, &class))
    .then_some(rows)
}

/// `class` is built on a data library and holds no rows: the facts list the tables
/// of its library ([`drift_core::RepoFacts::models`]: SQLModel's `table=True`), and
/// neither it nor a class it is built on is one (`class ItemPublic(ItemBase)`, the
/// shape a response is validated into). A class built on a listed table reads that
/// table's rows (a Django proxy, a mapped subclass), and where the facts list no
/// table of the library nothing says which class is one.
fn schema_only(cx: &Cx<'_>, class: &str) -> bool {
    use super::libraries::data_library;
    let ctx = cx.context();
    let listed = |c: &str| {
        c.split_once('#').is_some_and(|(m, n)| {
            cx.facts
                .models
                .iter()
                .any(|model| model.path == m && model.name == n)
        })
    };
    let ancestors = ctx.ancestors(class);
    if listed(class) || ancestors.iter().any(|a| listed(a)) {
        return false;
    }
    // A table of the same library is listed: the adapter reads which are.
    let libraries: Vec<&String> = ancestors
        .iter()
        .filter(|a| data_library(a).is_some())
        .collect();
    !libraries.is_empty()
        && cx.facts.models.iter().any(|model| {
            ctx.ancestors(&format!("{}#{}", model.path, model.name))
                .iter()
                .any(|a| libraries.contains(&a))
        })
}

/// By what a statement of a body reads the rows of a model
/// ([`drift_core::controls::ROWS`]).
enum RowsBy<'a> {
    /// By the caller itself, under this key; the side as written; and whether the
    /// statement also filters by what the request names
    /// ([`drift_core::controls::ROWS_ASKED`]).
    Own(&'a str, &'a str, bool),
    /// By a value read off what these gave.
    From(Vec<&'a str>),
    /// By nothing of the caller, in a branch taken where a member of this side is
    /// set or is a literal: for the callers a role lets through.
    ByRole(&'a str),
    Any,
}

/// `class` is a model of the repository: a class built on a data library, or on a
/// base of the repository that a data library made (`class Seat(Base)` with `Base
/// = declarative_base()`).
fn is_model(cx: &Cx<'_>, class: &str) -> bool {
    let ctx = cx.context();
    ctx.definition(class)
        .is_some_and(|d| d.kind == SymbolKind::Class)
        && (data_call(cx, class) || ctx.ancestors(class).iter().any(|a| data_call(cx, a)))
}

/// The rows a body reads, of the models of the repository
/// ([`drift_core::controls::ROWS`]).
fn row_census<'a>(cx: &Cx<'_>, facts: &'a [String]) -> Vec<(&'a str, RowsBy<'a>)> {
    facts
        .iter()
        .filter_map(|f| f.strip_prefix(drift_core::controls::ROWS))
        .filter_map(|rest| {
            let mut parts = rest.split('\t');
            let model = parts.next()?;
            let by = match parts.next()? {
                "own" => RowsBy::Own(
                    parts.next()?,
                    parts.next()?,
                    parts.next() == Some(drift_core::controls::ROWS_ASKED),
                ),
                "from" => RowsBy::From(parts.collect()),
                "any" => match (parts.next(), parts.next()) {
                    (Some("role"), Some(side)) => RowsBy::ByRole(side),
                    _ => RowsBy::Any,
                },
                _ => RowsBy::Any,
            };
            is_model(cx, model).then_some((model, by))
        })
        .collect()
}

/// Methods of a query, by which a call on a value the facts do not resolve (a
/// local, `self.get_queryset()`, `super()`) is taken for a read of rows of unknown
/// scope.
const READ_METHODS: &[&str] = &[
    "all",
    "filter",
    "filter_by",
    "get",
    "first",
    "last",
    "one",
    "one_or_none",
    "scalar",
    "scalars",
    "values",
    "values_list",
    "get_queryset",
    "get_object",
    "execute",
];

/// Python: the body reads rows by nothing of the caller. Every query it starts on
/// a model of the repository ([`query_rows`]) must be given, in every call, the
/// caller itself or the key of the caller's record ([`side_is_caller_self`]), or
/// a value read off rows the body reads by one (`Comment.objects.filter(doc=doc)`
/// after `doc = Doc.objects.get(pk=pk, owner=request.user)`); below the unit's
/// own bodies, also what a calling body passed that is a value of the caller or
/// of a row ([`origin`]): the rows it was handed are the rows the unit read. And
/// it must read no rows the facts do not resolve ([`READ_METHODS`] on a local or
/// on what a method of the class hands back). A row written is no read.
fn reads_unscoped<'a>(cx: &Cx<'a>, r: &Reached<'a>, around: &[String], passed: &[Given]) -> bool {
    let n = r.node;
    let facts: &[String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let recorded: Vec<(&str, Vec<(&str, &str)>)> = arg_calls_own(facts.iter()).collect();
    let callers = |given: &[(&str, &str)]| {
        given.iter().any(|(_, side)| {
            side_is_caller_self(cx, side)
                || (r.depth > 0
                    && side.starts_with("param")
                    && matches!(
                        origin(cx, around, r, side, passed),
                        Origin::Caller | Origin::Row
                    ))
        })
    };
    // The queries the body starts, by the rows each reads.
    let mut starts: Vec<(&str, &str)> = Vec::new();
    for c in n.callees() {
        let c = c.as_str();
        let method = c
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .trim_end_matches("()");
        if let Some(rows) = query_rows(cx, c) {
            if !writes(c) {
                starts.push((rows, c));
            }
        } else if READ_METHODS.contains(&method)
            && (c.starts_with("local:") || !c.contains('#') || {
                // A method of the repository's own code read on (`self.get_queryset()
                // .filter`): what it hands back is rows of its own scope.
                c.contains("().") && !common::external(c) && query_rows(cx, c).is_none() && {
                    let head = c.split("().").next().unwrap_or_default();
                    query_rows(cx, head).is_none()
                }
            })
        {
            return true;
        }
    }
    starts.sort_unstable();
    starts.dedup();
    // Every recorded call of a callee passes `ok`, and there is one.
    type Passes<'f> = &'f dyn Fn(&[(&str, &str)]) -> bool;
    let every = |callee: &str, ok: Passes<'_>| {
        let mut calls = recorded.iter().filter(|(c, _)| *c == callee).peekable();
        calls.peek().is_some() && calls.all(|(_, given)| ok(given))
    };
    // The rows every query of which is given a value of the caller.
    let scoped: Vec<&str> = starts
        .iter()
        .map(|(rows, _)| *rows)
        .filter(|rows| {
            starts
                .iter()
                .filter(|(x, _)| x == rows)
                .all(|(_, callee)| every(callee, &callers))
        })
        .collect();
    let derived = |given: &[(&str, &str)]| {
        given.iter().any(|(_, side)| {
            side.strip_prefix("call ")
                .or_else(|| side.strip_prefix("value "))
                .is_some_and(|from| {
                    scoped
                        .iter()
                        .any(|rows| rows.strip_prefix(from).is_some_and(|rest| rest.starts_with('.')))
                })
        })
    };
    if starts.iter().any(|(rows, callee)| {
        !scoped.contains(rows) && !every(callee, &|given| callers(given) || derived(given))
    }) {
        return true;
    }
    // The rows the body's statements read by naming a model
    // ([`drift_core::controls::ROWS`]: `select(Item).where(...)`,
    // `session.get(Item, item_id)`), where the calls above do not say: each by the
    // caller itself, or by a value read off rows that are.
    let census = row_census(cx, facts);
    let by_call = |model: &str| {
        starts
            .iter()
            .any(|(rows, _)| rows.strip_prefix(model).is_some_and(|x| x.starts_with('.')))
    };
    let own = |model: &str| {
        census
            .iter()
            .filter(|(m, _)| *m == model)
            .all(|(_, by)| matches!(by, RowsBy::Own(_, side, _) if side_is_caller_self(cx, side)))
            || scoped.iter().any(|rows| {
                rows.strip_prefix(model).is_some_and(|x| x.starts_with('.'))
            })
    };
    census.iter().any(|(model, by)| {
        !by_call(model)
            && match by {
                RowsBy::Own(_, side, _) => !side_is_caller_self(cx, side),
                // Read whole for the callers whose own role lets them through.
                RowsBy::ByRole(side) => !side_is_callers(cx, side),
                RowsBy::From(givers) => !givers.iter().all(|g| {
                    census.iter().any(|(m, _)| {
                        (g == m || g.strip_prefix(m).is_some_and(|x| x.starts_with('.'))) && own(m)
                    })
                }),
                RowsBy::Any => true,
            }
    })
}

/// Words of a query's filter under which a value narrows nothing to itself: an
/// alternative (`OR`), a negation (`NOT`, `none`), a comparison that is no
/// equality. A value of the caller under one does not say the rows are the
/// caller's.
const NOT_NARROWING: &[&str] = &[
    "OR", "NOT", "not", "none", "notIn", "lt", "lte", "gt", "gte", "$or", "$nor", "$not", "$ne",
    "$nin", "$lt", "$lte", "$gt", "$gte",
];

/// The words of a filter that hold alternatives, each an item of a list.
const ALTERNATIVES: &[&str] = &["OR", "$or"];

/// The filter a call is handed (`sides`: each value by the path of its key, with
/// the side that says where it comes from) narrows the rows to what `good` says
/// is the caller's: one value under no alternative or negation
/// ([`NOT_NARROWING`]) is, or every alternative of one list of them holds one
/// (`OR: [{ userId }, { teamId: { in: teamIds } }]`, the caller's own or the
/// caller's teams').
fn narrowed(sides: &[(&str, &str)], good: &dyn Fn(&str) -> bool) -> bool {
    // The list of alternatives a path is under, with the item's position, where
    // nothing else on the path keeps a value from narrowing.
    let place = |path: &str| -> Option<Option<(String, String)>> {
        let segs: Vec<&str> = path.split('.').collect();
        let mut under: Option<(String, String)> = None;
        let mut i = 0;
        while i < segs.len() {
            let seg = segs[i];
            if ALTERNATIVES.contains(&seg) && under.is_none() {
                let item = segs.get(i + 1)?;
                if !item.chars().all(|c| c.is_ascii_digit()) {
                    return None;
                }
                under = Some((segs[..=i].join("."), item.to_string()));
                i += 2;
                continue;
            }
            if NOT_NARROWING.contains(&seg) {
                return None;
            }
            i += 1;
        }
        Some(under)
    };
    let placed: Vec<(Option<(String, String)>, bool)> = sides
        .iter()
        .filter_map(|(path, side)| place(path).map(|at| (at, good(side))))
        .collect();
    if placed.iter().any(|(at, ok)| at.is_none() && *ok) {
        return true;
    }
    // Every item of one list holds a value that is.
    let lists: Vec<&String> = placed
        .iter()
        .filter_map(|(at, _)| at.as_ref().map(|(list, _)| list))
        .collect();
    lists.iter().any(|list| {
        // The items written, by any value under them, narrowing or not.
        let mut items: Vec<&str> = sides
            .iter()
            .filter_map(|(path, _)| {
                path.strip_prefix(list.as_str())?
                    .strip_prefix('.')?
                    .split('.')
                    .next()
            })
            .collect();
        items.sort_unstable();
        items.dedup();
        !items.is_empty()
            && items.iter().all(|item| {
                placed.iter().any(|(at, ok)| {
                    *ok && at
                        .as_ref()
                        .is_some_and(|(l, i)| l == *list && i == item)
                })
            })
    })
}

/// TypeScript: the body runs a query that selects rows by nothing of the caller,
/// named by its callee. Read from what each call is handed
/// ([`drift_core::controls::ARG_VALUE`], which the lowering writes for a call of
/// the repository's code and for a method of what a parameter, `this` or a local
/// holds):
///
/// - a call handed a filter (a key [`query_call`] reads as one: `where.id`, the
///   object a builder's `where` is given) selects the rows the filter names. It is
///   by the caller where one value of the filter, under no alternative or negation
///   ([`NOT_NARROWING`]), is a value of the caller; a value read off rows another
///   call of the body selected by the caller (`where: { bookingId: booking.id }`
///   after `booking = findFirst({ where: { userId: session.user.id } })`); or,
///   below the unit's own bodies, what every calling body passed that is one,
///   and in them what the wrappers around the unit hand ([`origin`]);
/// - a call of a database client's model handed no filter selects every row
///   (`findMany()`, `findMany({ select })`), unless what it is handed is the row it
///   writes (`create({ data })`);
/// - a body with more calls than the lowering records is not proven to select by
///   the caller.
///
/// A query the facts do not record as one (a builder's chain compared by a
/// function, SQL as text) is not judged here: the unit is unknown by what reads
/// those ([`drift_core::controls::SCOPE_UNREAD`], [`ts_use`]).
fn ts_unscoped_read<'a>(
    cx: &Cx<'a>,
    r: &Reached<'a>,
    around: &[String],
    passed: &[Given],
) -> Option<String> {
    let n = r.node;
    let facts: &[String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let recorded: Vec<(&str, Vec<(&str, &str)>)> = arg_calls(facts.iter()).collect();
    if recorded.iter().any(|(c, _)| *c == "*") {
        return Some(match r.callee.is_empty() {
            true => drift_core::controls::ARG_VALUE.trim_end_matches(':').to_string(),
            false => r.callee.clone(),
        });
    }
    let filter_sides = |callee: &str, given: &[(&'a str, &'a str)]| -> Vec<(&'a str, &'a str)> {
        ts_filter_sides(cx, n, callee, given)
    };
    let by_caller = |side: &str| {
        side == "caller"
            || (side.starts_with("param")
                && matches!(origin(cx, around, r, side, passed), Origin::Caller | Origin::Row))
    };
    // The callees every filtered call of which is by the caller.
    let selections: Vec<(&str, Vec<(&str, &str)>)> = recorded
        .iter()
        .map(|(c, given)| (*c, filter_sides(c, given)))
        .filter(|(_, sides)| !sides.is_empty())
        .collect();
    let scoped: Vec<&str> = selections
        .iter()
        .map(|(c, _)| *c)
        .filter(|c| {
            selections
                .iter()
                .filter(|(x, _)| x == c)
                .all(|(_, sides)| narrowed(sides, &by_caller))
        })
        .collect();
    let derived = |side: &str| {
        side.strip_prefix("call ")
            .is_some_and(|from| scoped.contains(&from))
    };
    for (callee, sides) in &selections {
        if !narrowed(sides, &|side| by_caller(side) || derived(side)) {
            return Some(callee.to_string());
        }
    }
    // A model of a database client called with no filter: every row, unless the
    // call writes the row it is handed.
    let model_call = |c: &str| {
        let path = c.split_once('#').map_or("", |(_, p)| p);
        !c.ends_with("(ref)")
            && !c.ends_with("(new)")
            && !path.contains('(')
            && path.matches('.').count() >= 2
            && data_call(cx, c)
    };
    for c in n.calls() {
        let c = c.as_str();
        if !model_call(c) || selections.iter().any(|(x, _)| *x == c) {
            continue;
        }
        // Every call of it is handed the row it writes, and nothing else.
        let mut calls = recorded.iter().filter(|(x, _)| *x == c).peekable();
        let writes_rows = calls.peek().is_some()
            && calls.all(|(_, given)| {
                given.iter().any(|(key, _)| {
                    key.strip_prefix('#')
                        .and_then(|k| k.split_once('.'))
                        .and_then(|(_, path)| path.split('.').next())
                        .is_some_and(|first| super::libraries::WRITTEN_KEYS.contains(&first))
                })
            });
        if !writes_rows {
            return Some(c.to_string());
        }
    }
    None
}

/// The values a TypeScript call filters by ([`drift_core::controls::ARG_VALUE`]):
/// under a key of an object it is handed, the key one that filters, each by the
/// path of its key with the side that says where it comes from.
fn ts_filter_sides<'a, 's>(
    cx: &Cx<'a>,
    n: Node<'a>,
    callee: &str,
    given: &[(&'s str, &'s str)],
) -> Vec<(&'s str, &'s str)> {
    given
        .iter()
        .filter_map(|(key, side)| {
            let (_, path) = key.strip_prefix('#')?.split_once('.')?;
            // (A method named as a Python query's is nothing here: `calendar
            // .events.get({ eventId })` asks another service.)
            let method = common::short(callee)
                .rsplit('.')
                .next()
                .unwrap_or_default()
                .trim_end_matches("()");
            let filters = path == "where"
                || path.starts_with("where.")
                || WHERE_METHODS.contains(&method)
                || super::data::instrument_of(cx, callee).is_some();
            (filter_key(path) && filters && !own_body(cx, n, callee)).then_some((path, *side))
        })
        .collect()
}

/// TypeScript: the body refuses every request for which one query of it finds
/// nothing ([`drift_core::controls::REFUSES_ABSENT`]), and that query is narrowed
/// to a value of the caller's own and by something more that the request does
/// not choose (`db.user.findFirst({ where: { id: userId, roles: { some: { name }
/// } } })` with `name` a literal every caller of the helper passes; `if (!user)
/// throw forbidden()`). No caller gets past it but one whose own record meets
/// the condition: what the caller is, checked, whatever the helper, the model
/// and the keys are called. A condition whose value is not read to be fixed is
/// found and not proven; one the request sends is a lookup of what was asked
/// for, and no check of the caller.
fn refused_without_own_row<'a>(cx: &Cx<'a>, r: &Reached<'a>, ev: &mut Evidence) {
    if ev.python || !cx.context().since_measured() || ev.identifies {
        return;
    }
    let n = r.node;
    let facts: &[String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let recorded: Vec<(&str, Vec<(&str, &str)>)> = arg_calls(facts.iter()).collect();
    for callee in facts
        .iter()
        .filter_map(|f| f.strip_prefix(drift_core::controls::REFUSES_ABSENT))
    {
        // One call of it in the body: of two, which found nothing is not read.
        let mut calls = recorded.iter().filter(|(c, _)| *c == callee);
        let (Some((_, given)), None) = (calls.next(), calls.next()) else {
            continue;
        };
        let sides = ts_filter_sides(cx, n, callee, given);
        let whose = |side: &str| origin(cx, &ev.around, r, side, &ev.passed);
        let callers = |side: &str| whose(side) == Origin::Caller;
        // Narrowed to the caller itself: rows found by a group or a setting of
        // the caller are someone's of that group, not the caller's.
        let own: Vec<(&str, &str)> = sides
            .iter()
            .map(|(path, side)| {
                let itself = callers(side) && given_caller_itself(n, callee, path);
                (*path, if itself { "own" } else { "" })
            })
            .collect();
        if !narrowed(&own, &|side| side == "own") {
            continue;
        }
        let more: Vec<(&str, Origin)> = sides
            .iter()
            .filter(|(_, side)| !callers(side))
            .map(|(path, side)| (*path, whose(side)))
            .collect();
        if more.is_empty() || more.iter().any(|(_, o)| *o == Origin::Request) {
            continue;
        }
        let what = more
            .iter()
            .map(|(path, _)| *path)
            .collect::<Vec<_>>()
            .join("+");
        match more.iter().all(|(_, o)| *o == Origin::Fixed) {
            true => ev.add("role_check", &what, VariantSource::Usage),
            false => ev.find(
                "role_check",
                &what,
                obligation::SIDES_NOT_CALLER_AND_RESOURCE,
                "",
                false,
            ),
        }
    }
}

/// The body gives `callee` a value of the caller's own under `key`, in a call every
/// request to the body reaches ([`drift_core::controls::FILTER_VALUE`] with the
/// side `caller`, which the TypeScript lowering records): the query is filtered by
/// who calls.
fn filtered_by_caller(n: Node<'_>, callee: &str, key: &str) -> bool {
    let facts: &[String] = match n {
        Node::Sym(s) => &s.controls,
        Node::Member(m) => &m.unread,
    };
    let want = format!(
        "{}{callee}\t{key}\tcaller",
        drift_core::controls::FILTER_VALUE
    );
    facts.contains(&want)
}

/// The call runs a query: a known database client, a Prisma-style `where` argument,
/// or a filtering method (`filter`, `get`, `exclude`, `filter_by`, `get_object_or_404`)
/// whose client the facts may not resolve (`globalThis.prisma ?? new Client()`).
fn query_call(cx: &Cx<'_>, callee: &str, key: &str) -> bool {
    let method = common::short(callee)
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches("()");
    super::data::instrument_of(cx, callee).is_some()
        || key == "where"
        || key.starts_with("where.")
        || QUERY_METHODS.contains(&method)
        // A query builder's filter given an object (`db("payouts").where({
        // merchant_id: claims.merchantId })`).
        || WHERE_METHODS.contains(&method)
}

/// Methods of a query builder that filter by the object they are given.
const WHERE_METHODS: &[&str] = &["where", "andWhere", "orWhere"];

/// Methods that filter a query by their keyword arguments.
const QUERY_METHODS: &[&str] = &[
    "filter",
    "filter_by",
    "get",
    "exclude",
    "get_object_or_404",
    "get_or_none",
];

/// Methods whose keyword arguments are the values of a row written, not a filter
/// (`insert(Run).values(created_by=...)`, `session.add(...)`).
const WRITE_METHODS: &[&str] = &["values", "insert", "add", "save", "bulk_create"];

/// The call writes rows ([`WRITE_METHODS`]).
fn writes(callee: &str) -> bool {
    let method = common::short(callee)
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches("()");
    WRITE_METHODS.contains(&method)
}

/// A query argument key that filters rows: not what is selected, included, ordered or
/// written (`select.userId`, `data.orgId`).
fn filter_key(key: &str) -> bool {
    let first = key.split('.').next().unwrap_or(key);
    !NOT_FILTER_KEYS.contains(&first)
}

/// The name of a dynamic route segment, `None` for a static one: `:workspaceId`
/// (Express), `[orgId]` and `[...path]` (Next.js), `{org_id}` and `{org_id:int}`
/// (FastAPI and Starlette put the name before the convertor), `<org_id>` and
/// `<int:org_id>` (Flask and Django put it after).
fn segment_param(seg: &str) -> Option<&str> {
    let name = if let Some(s) = seg.strip_prefix(':') {
        s
    } else if let Some(s) = seg.strip_prefix('{') {
        let s = s.trim_end_matches('}');
        s.split(':').next().unwrap_or(s)
    } else if let Some(s) = seg.strip_prefix('<') {
        let s = s.trim_end_matches('>');
        s.rsplit(':').next().unwrap_or(s)
    } else if seg.starts_with('[') {
        seg.trim_matches(['[', ']', '.'])
    } else {
        return None;
    };
    Some(name)
}

/// The first dynamic route segment that names a tenant (`[orgId]`, `{org_id}`,
/// `{org_id:int}`, `<int:org_id>`, `:workspaceId`), by its name.
pub fn tenant_param(route: &str) -> Option<String> {
    route
        .split('/')
        .filter_map(segment_param)
        .find(|name| names_tenant(name))
        .map(str::to_string)
}

/// The first dynamic route segment that names a tenant or an owner (`{org_id}`,
/// `[userId]`, `<int:owner_id>`), by its name: a key the caller names in the route.
pub fn request_key(route: &str) -> Option<String> {
    route
        .split('/')
        .filter_map(segment_param)
        .find(|name| names_tenant(name) || names_owner(name))
        .map(str::to_string)
}

// ---------- a guard that ties a parameter of the URL to the caller ----------

/// The columns a guard ties to the caller, each with the parameter whose value the
/// guard filters it by (`param slug`, `param view`, `param kwargs`: its name).
type Ties = std::collections::BTreeMap<String, String>;

/// What a guard around a unit (a decorator of the handler, a dependency, a
/// permission class of the view) ties to the caller: the columns that every way it
/// lets a request through has passed a query of the caller's own rows filtered by.
///
/// - Where it lets the request through: a decorator's or a wrapper's call of what it
///   wraps ([`drift_core::controls::HANDED_AFTER`]); else, of a function, each return
///   that does not refuse ([`drift_core::controls::LEAVES_AFTER`]); of a permission
///   class, each return of `has_permission` that may answer true
///   ([`drift_core::controls::TRUE_AFTER`]). Each lists the callees whose value held
///   on every path to it.
/// - A callee ties a column where every call of its query that the guard records
///   ([`drift_core::controls::ARG_VALUE`]) filters by the caller itself or the key of
///   the caller's record (`member=request.user`) and filters the column by a value of
///   one of the guard's parameters (`workspace__slug=kwargs["slug"]`): rows exist only
///   for a caller who belongs to what the parameter names.
/// - A column is tied where every way through has a callee that ties it, by the same
///   parameter. A way through where nothing held ties nothing.
///
/// `None` where nothing is tied, and for a guard that is not the repository's.
fn guard_ties(cx: &Cx<'_>, wrapper: &str) -> Option<Ties> {
    /// A function lets a request through where it hands it on, else where it
    /// returns without refusing; a permission class, where it answers true.
    const FUNCTION_WAYS: &[&str] = &[
        drift_core::controls::HANDED_AFTER,
        drift_core::controls::LEAVES_AFTER,
    ];
    const CLASS_WAYS: &[&str] = &[drift_core::controls::TRUE_AFTER];
    let w = crate::mine::norm_ref(wrapper).into_owned();
    if common::external(&w) {
        return None;
    }
    let d = cx
        .context()
        .definition(&w)
        .filter(|d| d.name == common::short(&w))?;
    let (facts, prefixes): (&[String], &[&str]) = match d.kind {
        SymbolKind::Function => (d.controls.as_slice(), FUNCTION_WAYS),
        SymbolKind::Class => (
            d.members
                .iter()
                .find(|m| m.name == "has_permission")?
                .unread
                .as_slice(),
            CLASS_WAYS,
        ),
        _ => return None,
    };
    // The ways through, by the first kind of them the guard records.
    let sites: Vec<Vec<&str>> = prefixes.iter().find_map(|prefix| {
        let sites: Vec<Vec<&str>> = facts
            .iter()
            .filter_map(|f| f.strip_prefix(*prefix))
            .map(|rest| rest.split('\t').filter(|c| !c.is_empty()).collect())
            .collect();
        (!sites.is_empty()).then_some(sites)
    })?;
    let mut tied: Option<Ties> = None;
    for site in &sites {
        let mut here = Ties::new();
        for held in site {
            for (column, param) in callee_ties(cx, facts, held) {
                here.entry(column).or_insert(param);
            }
        }
        tied = Some(match tied {
            None => here,
            Some(before) => before
                .into_iter()
                .filter(|(column, param)| here.get(column) == Some(param))
                .collect(),
        });
    }
    tied.filter(|t| !t.is_empty())
}

/// The columns one held callee of a guard ties to the caller ([`guard_ties`]): the
/// query it is a method of (`Member.objects.filter().exists` asks
/// `Member.objects.filter`), every recorded call of which filters by the caller itself
/// and filters the column by the same parameter of the guard.
fn callee_ties(cx: &Cx<'_>, facts: &[String], held: &str) -> Ties {
    let query = held.split("()").next().unwrap_or(held);
    let calls: Vec<Vec<(&str, &str)>> = arg_calls_own(facts.iter())
        .filter(|(callee, _)| *callee == query)
        .map(|(_, given)| given)
        .collect();
    let mut out: Option<Ties> = None;
    for given in &calls {
        let by_caller = given
            .iter()
            .any(|(_, side)| side_is_caller_self(cx, side));
        if !by_caller {
            return Ties::new();
        }
        let here: Ties = given
            .iter()
            .filter(|(column, _)| !column.starts_with('#') && filter_key(column))
            .filter(|(column, _)| query_call(cx, query, column))
            .filter_map(|(column, side)| {
                let param = side.strip_prefix("param ")?.split(' ').next()?;
                Some((column.to_string(), param.to_string()))
            })
            .collect();
        out = Some(match out {
            None => here,
            Some(before) => before
                .into_iter()
                .filter(|(column, param)| here.get(column) == Some(param))
                .collect(),
        });
    }
    out.unwrap_or_default()
}

/// The parameter of the route every filter of the unit's own bodies under `column`
/// takes its value from ([`drift_core::controls::ARG_VALUE`], side `param <name>`, in a
/// body the request runs itself): `None` where one takes it from anything else, where
/// a body below the unit's own filters by the column, or where no filter of the
/// unit's own is recorded under it.
fn route_param_of<'a>(reach: &Reach<'a>, column: &str, segments: &[&str]) -> Option<String> {
    let mut found: Option<String> = None;
    for r in reach.nodes.iter().filter(|r| !r.quiet) {
        let facts: &[String] = match r.node {
            Node::Sym(s) => &s.controls,
            Node::Member(m) => &m.unread,
        };
        for (_, given) in arg_calls_own(facts.iter()) {
            for (key, side) in given {
                if key != column {
                    continue;
                }
                if r.depth != 0 {
                    return None;
                }
                let param = side.strip_prefix("param ")?.split(' ').next()?;
                if !segments.contains(&param)
                    || found.as_deref().is_some_and(|f| f != param)
                {
                    return None;
                }
                found = Some(param.to_string());
            }
        }
    }
    found
}

/// Found filters ([`Evidence::found`]) whose value is not proven to be the caller's
/// ([`obligation::SIDES_NOT_CALLER_AND_RESOURCE`]) and that a guard around the unit
/// ties to the caller ([`guard_ties`]) become the unit's: a tenant or owner filter of
/// the unit's own under a column, by a parameter of the route ([`route_param_of`]),
/// that a guard ties by a parameter of the same name, which the framework gives the
/// guard from the same segment of the URL. Units move from a check found and not
/// proven to known, never the other way.
///
/// A guard's parameter the route does not name ties nothing (review R5, row 3): of
/// a FastAPI dependency it is a query or body value (`def allow_member(workspace:
/// str)`), which the caller sends beside the URL's, so the guard and the handler may
/// check two objects. Nor does what a guard reads the URL's parameters off (a DRF
/// `view`, a decorator's `**kwargs`): the facts do not say which key it read.
/// [STRICT] Neither is a guard's parameter of the route's name that the guard
/// declares to come from elsewhere (`slug: str = Query()`): the facts do not hold
/// where a parameter's value comes from.
fn tie_found<'a>(
    cx: &Cx<'a>,
    route: Option<&str>,
    around: &[&drift_core::Wrap],
    reach: &Reach<'a>,
    ev: &mut Evidence,
) {
    let Some(route) = route else {
        return;
    };
    let segments: Vec<&str> = route.split('/').filter_map(segment_param).collect();
    if segments.is_empty() {
        return;
    }
    let guards: Vec<(String, Ties)> = around
        .iter()
        .filter(|w| {
            matches!(
                w.kind,
                drift_core::WrapKind::Decorator | drift_core::WrapKind::Call
            )
        })
        .filter_map(|w| {
            let t = guard_ties(cx, &w.wrapper)?;
            Some((crate::mine::norm_ref(&w.wrapper).into_owned(), t))
        })
        .collect();
    if guards.is_empty() {
        return;
    }
    let mut kept = Vec::new();
    for u in std::mem::take(&mut ev.found) {
        let unproven_sides =
            u.obligation == obligation::SIDES_NOT_CALLER_AND_RESOURCE && u.when.is_empty();
        let tied = unproven_sides
            .then(|| u.check.split_once(':'))
            .flatten()
            .filter(|(mechanism, _)| matches!(*mechanism, "tenancy_filter" | "owner_filter"))
            .and_then(|(mechanism, rest)| {
                let column = rest.split(" (").next().unwrap_or(rest);
                let param = route_param_of(reach, column, &segments)?;
                let (guard, _) = guards
                    .iter()
                    .find(|(_, t)| t.get(column).is_some_and(|by| by == &param))?;
                Some((
                    mechanism.to_string(),
                    format!("{column} ({param}, tied by {guard})"),
                ))
            });
        match tied {
            Some((mechanism, label)) => {
                ev.uses.push(use_of(&mechanism, &label));
                ev.sources.push(VariantSource::Usage);
            }
            None => kept.push(u),
        }
    }
    ev.found = kept;
}

// ---------- the keys this repository scopes by (learned) ----------

/// Bodies, at least, whose queries filter rows by a key with a value of the caller
/// for that key to be one this repository scopes by ([`scope_keys`]).
const LEARNED_SCOPE_BODIES: usize = 3;
/// Rows of different queries (`Note.objects`, `db.post`), at least, filtered so: a key
/// one query alone filters by the caller (`User.objects.filter(id=request.user.id)`)
/// looks the caller's own record up, it scopes nothing else.
const LEARNED_SCOPE_TARGETS: usize = 3;

/// A query key or a route parameter as the two are compared: the whole filter path
/// but a leading `where`, lower-cased, its letters and digits only (`where.userId`,
/// `user_id`, `{userId}` all read `userid`). Not its last member: a filter through
/// a relation (`where: { author: { id } }`, `author__id`) reads `authorid`, never
/// `id`, which would make every `{id}` of a route a key the repository scopes rows
/// by (review R5, row 5).
fn scope_word(key: &str) -> String {
    let key = key.strip_prefix("where.").unwrap_or(key);
    key.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// What a query reads rows of: its callee before the first call's parentheses,
/// without the method (`app/models.py#Note.objects.filter().exists` reads
/// `app/models.py#Note.objects`, `lib/db.ts#db.note.findMany` reads `lib/db.ts#db.note`).
fn query_target(callee: &str) -> String {
    let head = callee.split('(').next().unwrap_or(callee);
    match head.rsplit_once('.') {
        Some((target, _)) if !target.ends_with('#') => target.to_string(),
        _ => head.to_string(),
    }
}

/// The keys this repository scopes rows to the caller by, learned from its own
/// queries: a key ([`scope_word`]) that at least [`LEARNED_SCOPE_BODIES`] bodies of
/// production code filter by a value of the caller, over at least
/// [`LEARNED_SCOPE_TARGETS`] different rows ([`query_target`]). A value of the
/// caller is what the lowering says it is: a scoped query whose value is the
/// session's ([`drift_core::ScopeSource::Session`]), a filter whose value is the
/// caller's ([`drift_core::controls::FILTER_VALUE`]), and an argument of a query
/// call that is the caller's or the caller itself ([`drift_core::controls::ARG_VALUE`],
/// [`side_is_callers`], [`side_is_caller_self`]). No name decides: the repository's
/// own code says which keys tie its rows to the caller. Each package's own, written
/// `package\tkey` ([`scope_param`] reads them). Found once for the run
/// ([`Cx::scope_keys`]).
pub(crate) fn scope_keys<'c>(cx: &'c Cx<'_>) -> &'c std::collections::BTreeSet<String> {
    cx.scope_keys(learn_scope_keys)
}

fn learn_scope_keys(cx: &Cx<'_>) -> std::collections::BTreeSet<String> {
    use std::collections::{BTreeMap, BTreeSet};
    // Per key: the bodies and the rows filtered by it with a value of the caller.
    let mut by: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)> = BTreeMap::new();
    // Learned per package (`package\tword`): in a monorepo one package's queries
    // say nothing of another's keys (review R5, row 6).
    let mut note = |package: &str, key: &str, callee: &str, body: &str| {
        let word = scope_word(key);
        if word.is_empty() {
            return;
        }
        let e = by.entry(format!("{package}\t{word}")).or_default();
        e.0.insert(body.to_string());
        e.1.insert(query_target(callee));
    };
    for f in &cx.facts.files {
        if crate::roles::is_test_path(&f.path) {
            continue;
        }
        for s in &f.symbols {
            let body = format!("{}#{}", f.path, s.name);
            let bodies = std::iter::once((body.clone(), &s.controls, &s.scoped_queries)).chain(
                s.members
                    .iter()
                    .map(|m| (format!("{body}.{}", m.name), &m.unread, &m.scoped_queries)),
            );
            for (body, facts, queries) in bodies {
                for q in queries {
                    if q.source == drift_core::ScopeSource::Session {
                        note(
                            f.package.as_str(),
                            q.key.as_str(),
                            q.callee.as_str(),
                            body.as_str(),
                        );
                    }
                }
                for x in facts {
                    if let Some(rest) = x.strip_prefix(drift_core::controls::FILTER_VALUE) {
                        let parts: Vec<&str> = rest.split('\t').collect();
                        if let [callee, key, side] = parts.as_slice()
                            && side_is_callers(cx, side)
                        {
                            note(f.package.as_str(), key, callee, body.as_str());
                        }
                    }
                }
                for (callee, given) in arg_calls_own(facts.iter()) {
                    if writes(callee) {
                        continue;
                    }
                    for (key, side) in given {
                        // TypeScript writes an argument by its position and the path
                        // of its keys (`#0.where.userId`); a position alone filters
                        // by nothing named.
                        let key = match key.strip_prefix('#') {
                            Some(rest) => match rest.split_once('.') {
                                Some((_, path)) => path,
                                None => continue,
                            },
                            None => key,
                        };
                        let callers = side_is_caller_self(cx, side) || side_is_callers(cx, side);
                        if callers && filter_key(key) && query_call(cx, callee, key) {
                            note(f.package.as_str(), key, callee, body.as_str());
                        }
                    }
                }
            }
        }
    }
    by.into_iter()
        .filter(|(_, (bodies, targets))| {
            bodies.len() >= LEARNED_SCOPE_BODIES && targets.len() >= LEARNED_SCOPE_TARGETS
        })
        .map(|(word, _)| word)
        .collect()
}

/// The first dynamic segment of `route` that is a key `package` scopes rows to the
/// caller by: one of the keys it learned ([`scope_keys`]) where its queries show
/// any; otherwise, and only then, one named for a tenant or an owner
/// ([`request_key`]: the name lists of [`super::libraries`], kept as the fallback
/// for a package whose own queries say nothing).
pub fn scope_param(cx: &Cx<'_>, package: &str, route: &str) -> Option<String> {
    let prefix = format!("{package}\t");
    let learned: std::collections::BTreeSet<&str> = scope_keys(cx)
        .iter()
        .filter_map(|k| k.strip_prefix(prefix.as_str()))
        .collect();
    if learned.is_empty() {
        return request_key(route);
    }
    route
        .split('/')
        .filter_map(segment_param)
        .find(|name| learned.contains(scope_word(name).as_str()))
        .map(str::to_string)
}

/// The package's middleware, by its own symbol, as the engine finds it (the first
/// file of the package by path with a middleware entry point): what runs before
/// every route of the package it covers, read with the unit's own bodies
/// ([`unscoped`]).
fn package_middleware(cx: &Cx<'_>, package: &str) -> Option<String> {
    let mut files: Vec<&drift_core::FileFacts> = cx
        .facts
        .files
        .iter()
        .filter(|f| {
            f.package == package && f.entry_points.iter().any(|e| e.kind == "middleware")
        })
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let f = files.first()?;
    let e = f.entry_points.iter().find(|e| e.kind == "middleware")?;
    Some(
        crate::entries::entry_symbol(cx.facts, f, e).map_or_else(
            || format!("{}#{}", f.path, e.symbol),
            |(df, s)| format!("{}#{}", df.path, s.name),
        ),
    )
}

// ---------- the unscoped key (a finding, not a variant) ----------

/// The mechanism of a query filtered by the tenant the caller asked for.
const REQUESTED: &str = "tenancy_requested";
/// Bodies read at most for one unit by [`Authz::unscoped_key`]: a unit that runs
/// more is not said to leave a key unscoped.
const CLOSURE_NODES: usize = 48;

/// A tenant or owner key the unit takes from the request and neither checks nor
/// scopes, when the facts prove it ([`super::FindingKind::UnscopedKey`]). `uses` are
/// the unit's known authz uses, empty for a recorded absence.
///
/// Stricter than a `none`, because it is said as a fact about one line. All of:
/// - the unit's authz is a recorded absence and its route names a key this
///   repository scopes rows by ([`scope_param`]: learned from its own queries, the
///   name lists only where they say nothing), or its only uses are queries filtered
///   by the tenant the caller asked for (`tenancy_requested`): the key is the
///   route's, or the query's;
/// - every body the request runs was read to the end ([`closure`]): the handler, what
///   it calls and what those call, its wrappers, decorators and dependencies and the
///   package's middleware. A call into a class's method (the facts hold no method's
///   query filters), a guard, permission or dependency class around the unit (it
///   decides in a method), a call through a parameter or a binding that is no
///   library's, into an unresolved import or into code the facts do not define ends
///   the reading, and so does a value handed to a call the facts did not record
///   ([`drift_core::controls::UNREAD_CALL`]): nothing is said. A constructor
///   function of the repository, built, and the functions it assigns on `this` are
///   read where they are written ([`constructor_method`], [`enclosing_function`]);
/// - nothing read turns away a caller who is signed in ([`rejects_signed_in`]): a
///   check the vocabulary cannot name may be the scope.
fn unscoped<'a>(
    cx: &Cx<'a>,
    unit: &UnitRef<'a>,
    uses: &[Use],
    middleware: Option<&str>,
) -> Option<String> {
    let (UnitRef::Entry { entry, .. }, Some((sfile, s))) = (*unit, unit_symbol(cx, unit)) else {
        return None;
    };
    if uses.iter().any(|u| u.mechanism != REQUESTED) {
        return None;
    }
    if common::truncated(
        sfile,
        s,
        &["body_checks", "headers", "responses", "scoped_queries"],
    )
    .is_some()
    {
        return None;
    }
    let lazy = common::lazy_handlers(cx, sfile, s);
    if lazy.is_empty() && s.calls.is_empty() && s.controls.iter().any(|c| c == "await") {
        return None;
    }
    let mut roots: Vec<Node<'a>> = common::bodies(cx, s)
        .into_iter()
        .chain(lazy)
        .map(Node::Sym)
        .collect();
    let ctx = cx.context();
    let classes = common::owning_classes(sfile, s);
    // What the unit's own mount adds, and the application's middleware, run too
    // (review R5, row 11): read as `read_unit` reads them, a package's left to the
    // reading of the unit.
    let wraps = unit
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .chain(classes.iter().flat_map(|c| &c.wraps));
    let app = s
        .app_middleware
        .iter()
        .chain(unit.mount_middleware())
        .map(|m| m.trim_start_matches('?'));
    let around = wraps
        .filter(|w| w.kind != drift_core::WrapKind::Try)
        .map(|w| w.wrapper.as_str())
        .chain(app)
        .chain(middleware);
    for w in around {
        if w.starts_with("unresolved:") {
            return None;
        }
        if common::external(w) {
            // A package's wrapper no list of Drift's knows may be the scope ([`closure`]).
            if super::basis::unlisted_package(w) {
                return None;
            }
            continue;
        }
        match ctx.definition(w) {
            Some(d) if d.kind == SymbolKind::Function => roots.push(Node::Sym(d)),
            // [STRICT]: a guard, permission or dependency class decides in a method,
            // and a method's facts ([`drift_core::Member`]) hold neither what it hands
            // to a call that was not recorded nor, outside TypeScript, that it answers
            // with a comparison (`return user.orgId === req.params.orgId`, on which the
            // framework answers 403). A base class may scope what the view queries.
            // Such a class may be the scope: nothing is said.
            _ => return None,
        }
    }
    let nodes = closure(cx, roots)?;
    if nodes.iter().any(|n| rejects_signed_in(*n)) {
        return None;
    }
    if uses.is_empty() {
        return entry
            .route
            .as_deref()
            .and_then(|r| scope_param(cx, &sfile.package, r));
    }
    nodes
        .iter()
        .filter_map(|n| match n {
            Node::Sym(b) => Some(*b),
            Node::Member(_) => None,
        })
        .flat_map(|b| &b.scoped_queries)
        .filter(|q| {
            matches!(
                q.source,
                drift_core::ScopeSource::Param | drift_core::ScopeSource::Header
            )
        })
        .map(|q| q.key.clone())
        .min()
}

/// `roots` and every in-repo function they call, to the end; `None` when a call
/// leaves what the facts read, or more than [`CLOSURE_NODES`] bodies run. A library's
/// call, a log call, a database client's and the building of a value object (a class
/// whose constructor calls nothing of the repository's) are read as what they are.
fn closure<'a>(cx: &Cx<'a>, roots: Vec<Node<'a>>) -> Option<Vec<Node<'a>>> {
    let ctx = cx.context();
    let mut nodes: Vec<Node<'a>> = Vec::new();
    for r in roots {
        if !nodes.iter().any(|x| x.same(r)) {
            nodes.push(r);
        }
    }
    let mut i = 0;
    while i < nodes.len() {
        if nodes.len() > CLOSURE_NODES {
            return None;
        }
        let n = nodes[i];
        i += 1;
        // The body hands a value to a call the facts did not record. A function
        // written in a constructor function's body and read by its own name
        // (`this.show = (req, res) => { dao.find(req.params.userId) }` in `function
        // Handler(db) { const dao = new DAO(db); ... }`) calls a method of a local the
        // outer body binds: the outer body holds the inner one's calls, by what the
        // local was built from. Where the outer body records every call it hands a
        // value to, it is read too (more than the request runs, never less).
        if let Node::Sym(s) = n
            && s.controls
                .iter()
                .any(|c| c == drift_core::controls::UNREAD_CALL)
        {
            let outer = enclosing_function(cx, s).filter(|o| {
                !o.controls
                    .iter()
                    .any(|c| c == drift_core::controls::UNREAD_CALL)
            })?;
            let next = Node::Sym(outer);
            if !nodes.iter().any(|x| x.same(next)) {
                nodes.push(next);
            }
        }
        // A method called on a local or on what a dependency injects, that is no
        // library's and no database client's: what it does is in a class the closure
        // does not read. A method of what a constructor function of the repository
        // built (`new DAO(db)`, then `dao.find(...)`) is read where it is written
        // ([`constructor_method`]).
        for c in n.receiver_calls() {
            if let Some(body) = constructor_method(cx, c) {
                let next = Node::Sym(body);
                if !nodes.iter().any(|x| x.same(next)) {
                    nodes.push(next);
                }
                continue;
            }
            if !matches!(resolve(cx, n, c), Callee::Read) {
                return None;
            }
        }
        let logs: Vec<&str> = match n {
            Node::Sym(s) => s.log_calls.iter().map(|l| l.callee.as_str()).collect(),
            Node::Member(_) => Vec::new(),
        };
        for c in n.calls() {
            let c = c.trim_end_matches("(ref)");
            if c.starts_with("unresolved:") || c.starts_with("param:") {
                return None;
            }
            if logs.contains(&c) {
                continue;
            }
            if common::external(c) {
                // An export of a package no list of Drift's knows ([`super::basis::
                // unlisted_package`]: what a none lists as not read) is code the facts
                // do not define: it may check or scope the key. The reading ends.
                if super::basis::unlisted_package(c) {
                    return None;
                }
                continue;
            }
            let built = c.strip_suffix("(new)");
            let r = built.unwrap_or(c);
            let d = ctx.definition(r)?;
            match d.kind {
                SymbolKind::Function if built.is_none() => {
                    let next = Node::Sym(d);
                    if !nodes.iter().any(|x| x.same(next)) {
                        nodes.push(next);
                    }
                }
                // A constructor function of the repository, built (`new DAO(db)`):
                // its body runs, and holds the functions it assigns on `this`.
                SymbolKind::Function if d.name == common::short(r) => {
                    let next = Node::Sym(d);
                    if !nodes.iter().any(|x| x.same(next)) {
                        nodes.push(next);
                    }
                }
                // A method the class defines: the facts hold its checks and calls, not
                // the filters of its queries.
                SymbolKind::Class
                    if d.members
                        .iter()
                        .any(|m| Some(m.name.as_str()) == r.rsplit('.').next()) =>
                {
                    return None;
                }
                _ if super::data::instrument_of(cx, r).is_some() => {}
                // The class itself, built: only its constructor runs.
                SymbolKind::Class if common::short(r) == d.name => {
                    let builds = d
                        .members
                        .iter()
                        .filter(|m| m.name == "__init__" || m.name == "constructor");
                    for m in builds {
                        if !m.calls.iter().all(|x| common::external(x)) {
                            return None;
                        }
                    }
                }
                SymbolKind::Const | SymbolKind::Variable if library_binding(d) => {}
                _ => return None,
            }
        }
    }
    Some(nodes)
}

/// The constructor function a function is written in, where the lowering reads the
/// inner one by its own name (`Handler.show` of `this.show = ...` in `function
/// Handler()`): a function of the same file named by the inner one's first segment.
/// A class's method (`Class.method`) has a class there, and is none.
fn enclosing_function<'a>(cx: &Cx<'a>, inner: &'a Symbol) -> Option<&'a Symbol> {
    let (outer, _) = inner.name.split_once('.')?;
    let file = cx
        .facts
        .files
        .iter()
        .find(|f| f.symbols.iter().any(|s| std::ptr::eq(s, inner)))?;
    file.symbols
        .iter()
        .find(|s| s.kind == SymbolKind::Function && s.name == outer)
}

/// What a method call on an instance a constructor function of the repository built
/// runs (`<module>#DAO().find`, of `const dao = new DAO(db)`): the function the
/// constructor assigns there, where the lowering reads it by its own name
/// (`DAO.find`). `None` where the constructor assigns no function of that name, as
/// where the method comes from elsewhere (`util.inherits(DAO, Base)`,
/// `Object.assign(DAO.prototype, mixin)`, a constructor that returns another
/// object: review R5, row 4), where the module assigns methods on the
/// constructor's prototype (`DAO.prototype.find = ...`, outside its body), or where
/// the call is anything else: the caller reads it as before.
fn constructor_method<'a>(cx: &Cx<'a>, c: &str) -> Option<&'a Symbol> {
    let (module, rest) = c.split_once('#')?;
    let (head, method) = rest.split_once("().")?;
    let plain = |s: &str| !s.is_empty() && !s.contains(['.', '(']);
    if !plain(head) || !plain(method) || common::external(c) {
        return None;
    }
    let ctx = cx.context();
    ctx.definition(&format!("{module}#{head}"))
        .filter(|d| d.kind == SymbolKind::Function && d.name == head)?;
    let file = cx.facts.files.iter().find(|f| f.path == module)?;
    if file
        .symbols
        .iter()
        .any(|s| s.name.starts_with(&format!("{head}.prototype")))
    {
        return None;
    }
    let own = format!("{head}.{method}");
    file.symbols
        .iter()
        .find(|s| s.kind == SymbolKind::Function && s.name == own)
}

/// A binding built from a library the map names for what it is (a schema, a logger, a
/// database client, a config reader) and from nothing of the repository's: a call on
/// it is that library's. Any other binding may hold anything (`ServiceDep =
/// Annotated[Service, Depends(get_service)]`).
fn library_binding(d: &Symbol) -> bool {
    use super::libraries::{config_library, data_library, logger_library, validation_library};
    !d.calls.is_empty()
        && d.calls.iter().all(|c| {
            validation_library(c).is_some()
                || logger_library(c).is_some()
                || data_library(c).is_some()
                || config_library(c).is_some()
        })
}

/// The body turns away a caller who is signed in, or may: a 403 (a check, a response
/// or an error class named for it), a 404 on a comparison, or a rejection no check of
/// its explains as "not signed in".
fn rejects_signed_in(n: Node<'_>) -> bool {
    use crate::vocab::refuse::forbids_class;
    let checks = n.body_checks();
    if checks.iter().any(|c| {
        c.outcome == CheckOutcome::Forbidden
            || (c.outcome == CheckOutcome::NotFound && !c.compares.is_empty())
    }) {
        return true;
    }
    if n.throws().iter().any(|t| forbids_class(t)) || n.calls().iter().any(|c| forbids_class(c)) {
        return true;
    }
    let Node::Sym(s) = n else {
        return false;
    };
    // Checks or responses cut short (`truncated`): a 403 may be among those not
    // kept, so it may turn a caller away; never read as one that does not.
    if s.truncated
        .iter()
        .any(|t| t == "body_checks" || t == "responses")
    {
        return true;
    }
    let signs_in = checks.iter().any(|c| {
        matches!(
            c.outcome,
            CheckOutcome::Unauthenticated | CheckOutcome::SignInRedirect
        )
    });
    s.responses.iter().any(|r| r.status == 403)
        || (!signs_in
            && s.controls
                .iter()
                .any(|c| c == drift_core::controls::REJECTS_CALLER))
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn known_scope_and_role_variants() {
        let d = empty();
        let facts = fixtures::next_clerk();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        let route = "app/api/projects/[projectId]/route.ts";
        assert_eq!(
            key(&of(&all, route, "GET")),
            "tenancy_check:header:x-org-id"
        );
        // The webhook is public: not in the population.
        assert!(
            !all.iter().any(|(p, _, _)| p.contains("webhooks")),
            "{all:#?}"
        );
        // Authenticated, no role, no tenant: a recorded absence.
        assert!(matches!(of(&all, route, "POST"), Assignment::None { .. }));

        let facts = fixtures::fastapi_split();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        let items = "services/api/app/routers/items.py";
        assert_eq!(
            key(&of(&all, items, "read_item")),
            "tenancy_check:param:org_id"
        );
        // The org id is read from the route and a header, and no check is seen.
        assert_eq!(
            of(&all, items, "create_item"),
            unknown(UnknownReason::NotFollowed, "header:x-org-id")
        );
        // The Flask view is unguarded: no authz unit.
        assert!(!all.iter().any(|(p, _, _)| p.contains("legacy")));

        let facts = fixtures::nest_mixed();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        // Which guards `@UseGuards` applies is not recorded: authn and authz unknown.
        let ctl = "src/projects/projects.controller.ts";
        for name in ["GET /projects/:id", "POST /projects"] {
            assert_eq!(
                of(&all, ctl, name),
                unknown(UnknownReason::OpaqueWrapper, "pkg:@nestjs/common#UseGuards")
            );
        }
    }

    #[test]
    fn roles_filters_and_unknowns_in_cases() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        assert_eq!(
            key(&of(&all, "app/api/admin/route.ts", "GET")),
            "role_check:lib/auth.ts#getUser.role"
        );
        assert_eq!(
            of(&all, "app/api/ws/[workspaceId]/route.ts", "GET"),
            unknown(UnknownReason::NotFollowed, "header:x-workspace-id")
        );
        assert_eq!(
            key(&of(&all, "apps/nest/src/items.controller.ts", "GET /items")),
            "role_guard:apps/nest/src/roles.guard.ts#RolesGuard"
        );
        assert!(matches!(
            of(&all, "apps/nest/src/health.controller.ts", "GET /status"),
            Assignment::None { .. }
        ));
        // Declared public, identified only, or a service caller: not in the population.
        for p in [
            "apps/nest/src/health.controller.ts",
            "app/api/session/route.ts",
            "app/api/cron/route.ts",
        ] {
            assert!(
                !all.iter().any(|(f, n, _)| f == p && n != "GET /status"),
                "{p}"
            );
        }
        // Authn unknown stays unknown here.
        assert_eq!(
            of(&all, "app/api/opaque/route.ts", "GET"),
            unknown(UnknownReason::OpaqueWrapper, "lib/wrap.ts#withThing")
        );
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        assert_eq!(
            of(&all, "svc/web/views.py", "ItemView.get"),
            unknown(UnknownReason::CheckNotProven, "org_id")
        );
        assert_eq!(
            key(&of(&all, "svc/app/routes.py", "admin_items")),
            "role_guard:svc/app/deps.py#require_admin"
        );
    }

    #[test]
    fn tenant_params() {
        assert_eq!(
            tenant_param("/orgs/{org_id}/items").as_deref(),
            Some("org_id")
        );
        assert_eq!(
            tenant_param("/w/[workspaceId]").as_deref(),
            Some("workspaceId")
        );
        assert_eq!(tenant_param("/t/<int:team_id>").as_deref(), Some("team_id"));
        // Starlette and FastAPI put the name before the convertor.
        assert_eq!(
            tenant_param("/orgs/{org_id:int}/members").as_deref(),
            Some("org_id")
        );
        assert_eq!(
            tenant_param("/w/:workspaceId/x").as_deref(),
            Some("workspaceId")
        );
        assert_eq!(tenant_param("/files/{path:path}"), None);
        assert_eq!(tenant_param("/projects/:id"), None);
    }

    /// The authz gap: what a `none` must not hide.
    #[test]
    fn owner_scope_helpers_two_hops_and_services() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        assert_eq!(
            of(&all, "app/api/authz/owned/route.ts", "GET"),
            unknown(UnknownReason::CheckNotProven, "where.userId")
        );
        // A helper that refuses someone and is named for a permission is no role
        // check by its name. This one is what the route signs the caller in by, so it
        // is not even found as one: its refusal is one nothing names.
        assert_eq!(
            of(&all, "app/api/authz/helper/route.ts", "POST"),
            unknown(UnknownReason::Unclassified, "lib/perm.ts#canEditProject")
        );
        assert_eq!(
            of(&all, "app/api/authz/twohop/route.ts", "GET"),
            unknown(UnknownReason::CheckNotProven, "where.organizationId")
        );
        // A service class's methods are not detailed in the facts: not a none.
        assert_eq!(
            of(&all, "app/api/authz/service/route.ts", "GET"),
            unknown(UnknownReason::BodyUnreadable, "lib/svc.ts#ProjectService.list")
        );
        assert!(matches!(
            of(&all, "app/api/authz/plain/route.ts", "GET"),
            Assignment::None { .. }
        ));
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        // [STRICT]: a DRF permission class of the repository named for a tenant was
        // the unit's `tenancy_guard` by its name and the framework's contract. What
        // its `has_permission` compares is not in the facts: found by its name, not
        // proven. The unit is unknown with what was found (first the query its body
        // filters by `org`, a value of no proven source).
        assert_eq!(
            of(&all, "svc/crm/views.py", "LeadView.get"),
            unknown(UnknownReason::CheckNotProven, "org")
        );
        // tRPC handlers loaded with `import()` are read; a filter whose value's source is
        // not known is not a none; an await nothing links is unknown.
        let ts = fixtures::ts_cases();
        let tcx = Cx::new(&ts, &d);
        let tall = assign_all(&Authz, &tcx);
        let r = "packages/trpc/routers/keys/_router.ts";
        assert_eq!(
            of(&tall, r, "MUTATION remove"),
            unknown(UnknownReason::CheckNotProven, "where.userId")
        );
        assert_eq!(
            of(&tall, r, "MUTATION edit"),
            unknown(UnknownReason::Unresolved, "lib/db.ts#db.apiKey.update")
        );
        assert_eq!(
            of(&tall, r, "QUERY ping"),
            unknown(UnknownReason::Dynamic, "")
        );
        // A repository object it builds: its method calls are not in the facts.
        assert_eq!(
            of(&tall, r, "QUERY list"),
            unknown(UnknownReason::BodyUnreadable, "lib/repo/keys.ts#KeyRepository")
        );
        // Scoped queries say where the tenant came from (PLAN-R14 B7).
        assert_eq!(
            key(&of(&all, "svc/crm/scoped.py", "ItemList.get")),
            "tenancy_filter:org (session)"
        );
        assert_eq!(
            key(&of(&all, "svc/crm/scoped.py", "OrgItems.get")),
            "tenancy_requested:org_id (param)"
        );
    }

    /// Owner keys are whole identifiers: `created_by` is an owner filter,
    /// `created_at__gte` is not.
    #[test]
    fn owner_keys_are_whole_identifiers() {
        let d = empty();
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        assert_eq!(
            of(&all, "svc/crm/insights.py", "InsightsView.get"),
            unknown(UnknownReason::CheckNotProven, "created_by")
        );
        for (k, owner) in [
            ("created_by", true),
            ("created_by__id", true),
            ("where.userId", true),
            ("owner_id", true),
            ("created_at__gte", false),
            ("created_at", false),
            ("username", false),
        ] {
            assert_eq!(names_owner(k), owner, "{k}");
        }
    }

    /// A service called through a parameter has no readable body: authz is unknown
    /// (unresolved) until the service registry is resolved.
    #[test]
    fn param_services_are_unresolved() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authz, &cx);
        assert_eq!(
            of(&all, "backend/routes/secrets.ts", "DELETE /secrets/:id"),
            unknown(
                UnknownReason::BodyUnreadable,
                "param:server.services.secret.canRevoke"
            )
        );
    }

    // ---------- the unscoped key ----------

    use super::super::{FindingKind, Options, PracticesReport, practices};
    use drift_core::{
        BodyCheck, EntryPoint, FileFacts, Member, RepoFacts, ScopeSource, ScopedQuery, Wrap,
        WrapKind,
    };

    const USER: &str = "svc/deps.py#get_current_user";
    const DB: &str = "svc/deps.py#get_db";
    const SELECT: &str = "pkg:sqlalchemy#select";
    const DENIED: &str = "pkg:acme_errors#PermissionDenied";

    fn func(name: &str, line: u32, calls: &[&str]) -> Symbol {
        Symbol {
            name: name.into(),
            exported_as: vec![name.into()],
            line,
            calls: calls.iter().map(|c| c.to_string()).collect(),
            ..Symbol::default()
        }
    }

    fn check(source: &str, outcome: CheckOutcome) -> BodyCheck {
        BodyCheck {
            source: source.into(),
            outcome,
            ..BodyCheck::default()
        }
    }

    /// A FastAPI route in `svc/api/<stem>.py`: signed in by `Depends(get_current_user)`
    /// unless `wrappers` is empty.
    fn route(stem: &str, route: &str, wrappers: &[&str], handler: Symbol) -> FileFacts {
        let mut handler = handler;
        handler.wraps = wrappers
            .iter()
            .map(|w| Wrap {
                wrapper: w.to_string(),
                kind: WrapKind::Call,
            })
            .collect();
        FileFacts {
            path: format!("svc/api/{stem}.py"),
            lang: "py".into(),
            package: "svc".into(),
            parse_ok: true,
            entry_points: vec![EntryPoint {
                symbol: handler.name.clone(),
                kind: "http".into(),
                method: Some("GET".into()),
                route: Some(route.into()),
                adapter: "fastapi".into(),
            }],
            symbols: vec![handler],
            ..FileFacts::default()
        }
    }

    fn module(path: &str, symbols: Vec<Symbol>) -> FileFacts {
        FileFacts {
            path: path.into(),
            lang: "py".into(),
            package: "svc".into(),
            parse_ok: true,
            symbols,
            ..FileFacts::default()
        }
    }

    fn scoped(key: &str, source: ScopeSource) -> ScopedQuery {
        ScopedQuery {
            condition: String::new(),
            callee: "pkg:sqlalchemy#select().where".into(),
            key: key.into(),
            source,
        }
    }

    /// The shared modules of the cases: a guard that rejects with 401, a database
    /// session, plain helpers, a helper that raises a class named for a 403 with
    /// no check recorded, a dependency that answers 403, a tenant guard and a service class.
    fn shared() -> Vec<FileFacts> {
        let mut user = func("get_current_user", 5, &["pkg:fastapi#HTTPException", "pkg:jwt#decode"]);
        user.controls = vec!["rejects_caller".into(), "throw".into()];
        user.throws = vec!["pkg:fastapi#HTTPException".into()];
        user.body_checks = vec![check("pkg:jwt#decode", CheckOutcome::Unauthenticated)];
        let mut plan = func("check_plan", 30, &["pkg:fastapi#HTTPException"]);
        plan.controls = vec!["rejects_caller".into(), "throw".into()];
        plan.body_checks = vec![check(USER, CheckOutcome::Forbidden)];
        let mut org = func("require_org_member", 40, &["pkg:fastapi#HTTPException"]);
        org.controls = vec!["rejects_caller".into(), "throw".into()];
        org.body_checks = vec![BodyCheck {
            source: USER.into(),
            reads: ".org_id".into(),
            compares: "param:org_id".into(),
            outcome: CheckOutcome::Forbidden,
            op: drift_core::check_op::REFUSES_MISMATCH.into(),
            conditional: false,
            condition: String::new(),
            unless: String::new(),
            compares_path: String::new(),
            after: vec![],
        }];
        let mut session = func("SessionLocal", 3, &["pkg:sqlalchemy.orm#sessionmaker"]);
        session.kind = SymbolKind::Variable;
        let mut profile = func("load_profile", 20, &[SELECT, DENIED]);
        profile.throws = vec![DENIED.into()];
        let mut service = func("SettingsService", 4, &[SELECT]);
        service.kind = SymbolKind::Class;
        service.members = vec![Member {
            name: "load".into(),
            calls: vec![SELECT.into()],
            ..Member::default()
        }];
        vec![
            module("svc/db.py", vec![session]),
            module(
                "svc/deps.py",
                vec![
                    plan,
                    user,
                    func("get_db", 12, &["svc/db.py#SessionLocal"]),
                    org,
                ],
            ),
            module(
                "svc/crud.py",
                vec![func("load_settings", 8, &[SELECT]), profile],
            ),
            module("svc/services.py", vec![service]),
        ]
    }

    fn report(mut routes: Vec<FileFacts>) -> PracticesReport {
        routes.extend(shared());
        routes.sort_by(|a, b| a.path.cmp(&b.path));
        let facts = RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            files: routes,
            ..RepoFacts::default()
        };
        practices(&facts, &Options::default())
    }

    /// The unscoped keys a report names, as `(key, members, first example's symbol)`.
    fn unscoped_keys(r: &PracticesReport) -> Vec<(String, usize, String)> {
        r.findings
            .iter()
            .filter(|f| f.kind == FindingKind::UnscopedKey)
            .map(|f| {
                (
                    f.key.clone().unwrap_or_default(),
                    f.members,
                    f.examples[0].symbol.clone(),
                )
            })
            .collect()
    }

    /// How the engine assigned the authz unit of `symbol`: `known`, `none` or `unknown`.
    fn authz_of(r: &PracticesReport, symbol: &str) -> String {
        let facts_units = r
            .concerns
            .iter()
            .find(|c| c.id == super::super::AUTHZ)
            .expect("authz");
        facts_units
            .units
            .iter()
            .find(|u| u.symbol == symbol)
            .map_or_else(|| "absent".to_string(), |u| u.assignment.clone())
    }

    fn with_units(mut routes: Vec<FileFacts>) -> PracticesReport {
        routes.extend(shared());
        routes.sort_by(|a, b| a.path.cmp(&b.path));
        let facts = RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            files: routes,
            ..RepoFacts::default()
        };
        let opts = Options {
            units: true,
            ..Options::default()
        };
        practices(&facts, &opts)
    }

    /// Signed in, an owner key in the route, every body read and nothing checks it.
    #[test]
    fn a_route_key_nothing_scopes_is_an_unscoped_key_and_ranks_first() {
        let r = with_units(vec![route(
            "settings",
            "/users/{user_id}/settings",
            &[USER, DB],
            func("user_settings", 10, &["svc/crud.py#load_settings"]),
        )]);
        assert_eq!(authz_of(&r, "user_settings"), "none");
        let f = &r.findings[0];
        assert_eq!(f.kind, FindingKind::UnscopedKey, "{:#?}", r.findings);
        assert_eq!(
            (f.concern.as_str(), f.package.as_deref(), f.key.as_deref(), f.members),
            ("authz", Some("svc"), Some("user_id"), 1)
        );
        let e = &f.examples[0];
        assert_eq!(
            (e.path.as_str(), e.line, e.symbol.as_str()),
            ("svc/api/settings.py", 10, "user_settings")
        );
        let text = super::super::render_recipes(&r);
        assert!(
            text.contains(
                "authz unscoped key in svc: 1 signed-in entry point(s) take `user_id` from \
                 the request and nothing read checks or scopes it, so a signed-in caller can \
                 name any user_id (svc/api/settings.py:10 user_settings)"
            ),
            "{text}"
        );
        // Additive JSON: the key is a new field, and the other kinds do not carry it.
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["findings"][0]["kind"], "unscoped_key");
        assert_eq!(json["findings"][0]["key"], "user_id");
        for other in json["findings"].as_array().unwrap().iter().skip(1) {
            assert!(other.get("key").is_none(), "{other}");
        }
    }

    /// A query filtered by the tenant a parameter names, and no check beside it.
    #[test]
    fn a_query_filtered_by_the_requested_tenant_is_an_unscoped_key() {
        let mut list = func("list_items", 10, &[SELECT]);
        list.scoped_queries = vec![scoped("org_id", ScopeSource::Param)];
        let mut mine = func("list_mine", 10, &[SELECT]);
        mine.scoped_queries = vec![scoped("org_id", ScopeSource::Session)];
        let r = with_units(vec![
            route("items", "/items", &[USER, DB], list),
            route("mine", "/my-items", &[USER, DB], mine),
        ]);
        assert_eq!(authz_of(&r, "list_items"), "known");
        assert_eq!(
            unscoped_keys(&r),
            [("org_id".to_string(), 1, "list_items".to_string())]
        );
    }

    /// Units of one package that leave the same key unscoped are one finding, with at
    /// most `caps::EXAMPLES` examples in path order.
    #[test]
    fn units_with_the_same_key_are_one_finding() {
        let routes: Vec<FileFacts> = (0..5)
            .map(|i| {
                route(
                    &format!("r{i}"),
                    &format!("/users/{{user_id}}/r{i}"),
                    &[USER, DB],
                    func(&format!("h{i}"), 10, &["svc/crud.py#load_settings"]),
                )
            })
            .collect();
        let r = report(routes);
        assert_eq!(
            unscoped_keys(&r),
            [("user_id".to_string(), 5, "h0".to_string())]
        );
        let f = &r.findings[0];
        assert_eq!(f.examples.len(), super::super::caps::EXAMPLES);
        let text = super::super::render_recipes(&r);
        assert!(text.contains("(svc/api/r0.py:10 h0; svc/api/r1.py:10 h1; svc/api/r2.py:10 h2)"));
    }

    /// Precision before recall: each of these is signed in and names a key, and none
    /// is said to leave it unscoped.
    #[test]
    fn nothing_is_said_where_the_facts_do_not_prove_it() {
        let settings = |name: &str, calls: &[&str]| func(name, 10, calls);
        // A helper raises a class named for a 403, though no check of it is recorded:
        // unknown to authz too (a refusal nothing explains is never a none).
        let profile = route(
            "profile",
            "/users/{user_id}/profile",
            &[USER, DB],
            settings("user_profile", &["svc/crud.py#load_profile"]),
        );
        // The work is handed to a service class's method: authz reads its checks and
        // says none, but the facts hold no method's query filters.
        let prefs = route(
            "prefs",
            "/users/{user_id}/prefs",
            &[USER, DB],
            settings("user_prefs", &["svc/services.py#SettingsService.load"]),
        );
        // A callee the facts do not define: authz is unknown.
        let export = route(
            "export",
            "/users/{user_id}/export",
            &[USER, DB],
            settings("user_export", &["svc/crud.py#missing"]),
        );
        // A call through a parameter (`service.load()`): nothing links its body.
        let through = route(
            "through",
            "/users/{user_id}/through",
            &[USER, DB],
            settings("user_through", &["param:service.load", SELECT]),
        );
        // No one is signed in: there is no caller to scope.
        let public = route(
            "public",
            "/public/{user_id}/card",
            &[],
            settings("public_card", &["svc/crud.py#load_settings"]),
        );
        // A dependency answers 403 on something the vocabulary cannot name.
        let plan = route(
            "plan",
            "/users/{user_id}/plan",
            &[USER, DB, "svc/deps.py#check_plan"],
            settings("user_plan", &["svc/crud.py#load_settings"]),
        );
        // The tenant guard the siblings share is on this unit too: it is scoped.
        let audit = route(
            "audit",
            "/orgs/{org_id}/audit",
            &[USER, DB, "svc/deps.py#require_org_member"],
            settings("org_audit", &["svc/crud.py#load_settings"]),
        );
        // The handler's own 403 response, on a condition the facts did not record:
        // unknown to authz, as the helper's refusal is.
        let mut gated = settings("user_gated", &["svc/crud.py#load_settings"]);
        gated.responses = vec![drift_core::ResponseFact {
            status: 403,
            ..drift_core::ResponseFact::default()
        }];
        let gated = route("gated", "/users/{user_id}/gated", &[USER, DB], gated);
        // A key that names neither a tenant nor an owner.
        let item = route(
            "item",
            "/items/{item_id}",
            &[USER, DB],
            settings("read_item", &["svc/crud.py#load_settings"]),
        );
        // An unresolved wrapper may be the scope.
        let wrapped = route(
            "wrapped",
            "/users/{user_id}/wrapped",
            &[USER, DB, "unresolved:svc.scope#scoped"],
            settings("user_wrapped", &["svc/crud.py#load_settings"]),
        );
        // The key is handed to a method the facts did not record (`exporter.run(user_id)`
        // on a value of no known class): authz says none, the finding says nothing.
        let mut handed = settings("user_handed", &["svc/crud.py#load_settings"]);
        handed.controls = vec![drift_core::controls::UNREAD_CALL.into()];
        let handed = route("handed", "/users/{user_id}/handed", &[USER, DB], handed);
        // A guard class decides by what its method returns (a Nest `canActivate` that
        // compares the caller's organisation with the route's; DRF's `has_permission`):
        // the framework answers 403, and no check, throw or 403 is in the facts.
        let mut owner = func("OwnerGuard", 50, &[]);
        owner.kind = SymbolKind::Class;
        owner.members = vec![Member {
            name: "canActivate".into(),
            returns_nonconstant_bool: true,
            ..Member::default()
        }];
        // The same in Python, where a method's verdict is not recorded at all.
        let mut permission = func("IsOwner", 60, &[]);
        permission.kind = SymbolKind::Class;
        permission.members = vec![Member {
            name: "has_permission".into(),
            ..Member::default()
        }];
        let guards = module("svc/guards.py", vec![owner, permission]);
        let guarded = route(
            "guarded",
            "/users/{user_id}/guarded",
            &[USER, DB, "svc/guards.py#OwnerGuard"],
            settings("user_guarded", &["svc/crud.py#load_settings"]),
        );
        let permitted = route(
            "permitted",
            "/users/{user_id}/permitted",
            &[USER, DB, "svc/guards.py#IsOwner"],
            settings("user_permitted", &["svc/crud.py#load_settings"]),
        );
        let r = with_units(vec![
            profile, prefs, export, through, public, plan, audit, gated, item, wrapped,
            handed, guards, guarded, permitted,
        ]);
        assert_eq!(unscoped_keys(&r), [], "{:#?}", r.findings);
        // What authz itself says of them: the finding is stricter than a none.
        for (symbol, assignment) in [
            ("user_profile", "unknown"),
            ("user_prefs", "none"),
            ("user_export", "unknown"),
            ("user_through", "unknown"),
            ("public_card", "absent"),
            // The dependency's refusal may be the authorization: not a none.
            ("user_plan", "unknown"),
            ("org_audit", "known"),
            ("user_gated", "unknown"),
            ("read_item", "none"),
            ("user_wrapped", "unknown"),
            ("user_handed", "none"),
            ("user_guarded", "none"),
            ("user_permitted", "none"),
        ] {
            assert_eq!(authz_of(&r, symbol), assignment, "{symbol}");
        }
    }

    // ---------- S4: tenant keys, the guard that ties them, constructor functions ----------

    /// The authz unit row of `symbol`.
    fn unit_row<'r>(r: &'r PracticesReport, symbol: &str) -> &'r super::super::UnitRow {
        r.concerns
            .iter()
            .find(|c| c.id == super::super::AUTHZ)
            .expect("authz")
            .units
            .iter()
            .find(|u| u.symbol == symbol)
            .expect("unit")
    }

    /// Pins: a tenant the route names, in a unit every body of which was read to the
    /// end and where nothing checks or scopes it, is a recorded absence with that key
    /// unscoped, in the finding and on the unit's exported row. Before, the unit was
    /// unknown (`not_followed`, "a callee may enforce it") and the row's `unscoped`
    /// was never filled.
    #[test]
    fn a_tenant_route_param_read_to_the_end_is_an_unscoped_key() {
        let r = with_units(vec![route(
            "raw",
            "/orgs/{org_id}/raw",
            &[USER, DB],
            func("org_raw", 10, &["svc/crud.py#load_settings"]),
        )]);
        assert_eq!(authz_of(&r, "org_raw"), "none");
        assert_eq!(
            unscoped_keys(&r),
            [("org_id".to_string(), 1, "org_raw".to_string())]
        );
        assert_eq!(unit_row(&r, "org_raw").unscoped.as_deref(), Some("org_id"));
    }

    /// Pins: a call on the way that the facts do not define keeps a tenant route's
    /// unit unknown, and no finding is said: an unknown is never a violation.
    #[test]
    fn an_unread_call_on_the_way_keeps_a_tenant_route_unknown() {
        let r = with_units(vec![route(
            "x",
            "/orgs/{org_id}/x",
            &[USER, DB],
            func("org_x", 10, &["svc/crud.py#missing"]),
        )]);
        assert_eq!(authz_of(&r, "org_x"), "unknown");
        assert_eq!(unscoped_keys(&r), []);
        assert_eq!(unit_row(&r, "org_x").unscoped, None);
    }

    /// Pins (G2): a dependency that lets the request through only after a query of
    /// the caller's own membership filtered by the route's `slug` ties `slug` to the
    /// caller, so the handler's filter by `slug` is the caller's: known, no finding.
    /// Before, the filter was found and not proven (`check_not_proven`). Without the
    /// guard it still is.
    #[test]
    fn a_guard_that_ties_the_route_param_makes_the_filter_the_callers() {
        const MEMBERS: &str = "svc/models.py#Member.objects.filter";
        const ITEMS: &str = "svc/models.py#Item.objects.filter";
        let mut guard = func("allow_member", 20, &["pkg:fastapi#HTTPException"]);
        guard.controls = vec![
            "rejects_caller".into(),
            "throw".into(),
            format!("{}{MEMBERS}().exists", drift_core::controls::LEAVES_AFTER),
            format!(
                "{}{MEMBERS}\tmember\town caller\tworkspace__slug\tparam slug",
                drift_core::controls::ARG_VALUE
            ),
        ];
        guard.body_checks = vec![check(USER, CheckOutcome::Forbidden)];
        let handler = |name: &str| {
            let mut h = func(name, 10, &[]);
            h.args = vec![format!("{ITEMS}@0:workspace__slug")];
            h.controls = vec![format!(
                "{}{ITEMS}\tworkspace__slug\tparam slug",
                drift_core::controls::ARG_VALUE
            )];
            h
        };
        let r = with_units(vec![
            module("svc/perm.py", vec![guard]),
            route(
                "items",
                "/workspaces/{slug}/items",
                &[USER, DB, "svc/perm.py#allow_member"],
                handler("ws_items"),
            ),
            route(
                "loose",
                "/workspaces/{slug}/loose",
                &[USER, DB],
                handler("ws_loose"),
            ),
        ]);
        assert_eq!(authz_of(&r, "ws_items"), "known");
        assert_eq!(authz_of(&r, "ws_loose"), "unknown");
        assert_eq!(unscoped_keys(&r), [], "{:#?}", r.findings);
    }

    /// The NodeGoat shape: `function Handler(db) { const dao = new DAO(db);
    /// this.show = (req, res) => dao.find(req.params.userId) }`, with `DAO` a
    /// constructor function of the module that assigns `this.find`. The lowering reads
    /// `Handler.show` by its own name, with a value handed to a call it did not
    /// record (`dao.find`), and records that call in `Handler`.
    fn nodegoat(dao_calls: &[&str], dao_unread: bool, outer_unread: bool) -> RepoFacts {
        let js = |path: &str, symbols: Vec<Symbol>| FileFacts {
            path: path.into(),
            lang: "js".into(),
            package: "app".into(),
            parse_ok: true,
            symbols,
            ..FileFacts::default()
        };
        let mut show = func("Handler.show", 12, &[]);
        show.controls = vec![drift_core::controls::UNREAD_CALL.into()];
        let mut outer = func("Handler", 3, &["app/data/dao.js#DAO(new)"]);
        outer.receiver_calls = vec!["app/data/dao.js#DAO().find".into()];
        if outer_unread {
            outer.controls = vec![drift_core::controls::UNREAD_CALL.into()];
        }
        let mut dao = func("DAO", 2, dao_calls);
        if dao_unread {
            dao.controls = vec![drift_core::controls::UNREAD_CALL.into()];
        }
        let find = func("DAO.find", 5, &["pkg:mongodb#Collection.find"]);
        RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            files: vec![
                js("app/data/dao.js", vec![dao, find]),
                js("app/routes/allocations.js", vec![outer, show]),
            ],
            ..RepoFacts::default()
        }
    }

    /// Pins (recall): the handler written in a constructor function and the DAO it
    /// builds are read to the end: the closure holds the outer body, the DAO and the
    /// method it assigns. Before, the handler's unread call ended the reading. Where
    /// the DAO queries through its untyped parameter (`db.find`, what NodeGoat's
    /// facts hold today), records an unread call itself, or the outer body does,
    /// nothing is read to the end and nothing can be said.
    #[test]
    fn the_nodegoat_dao_shape_is_read_through_constructor_functions() {
        let d = empty();
        let names = |facts: &RepoFacts| -> Option<Vec<String>> {
            let cx = Cx::new(facts, &d);
            let show = facts.files[1]
                .symbols
                .iter()
                .find(|s| s.name == "Handler.show")
                .unwrap();
            let nodes = closure(&cx, vec![Node::Sym(show)])?;
            let mut out: Vec<String> = nodes
                .iter()
                .filter_map(|n| match n {
                    Node::Sym(s) => Some(s.name.clone()),
                    Node::Member(_) => None,
                })
                .collect();
            out.sort();
            Some(out)
        };
        let read = nodegoat(&["pkg:mongodb#MongoClient"], false, false);
        assert_eq!(
            names(&read),
            Some(vec![
                "DAO".to_string(),
                "DAO.find".to_string(),
                "Handler".to_string(),
                "Handler.show".to_string(),
            ])
        );
        assert_eq!(names(&nodegoat(&["param:db.find"], false, false)), None);
        assert_eq!(names(&nodegoat(&["pkg:mongodb#MongoClient"], true, false)), None);
        assert_eq!(names(&nodegoat(&["pkg:mongodb#MongoClient"], false, true)), None);
    }

    /// Pins (no name list): where the repository's own queries scope rows to the
    /// caller by `org_id` in three bodies over three models, `org_id` is the key it
    /// scopes by, and `user_id` in a route is no longer one by its name alone: no
    /// finding for it, while one for `org_id` is still said. Before, both were
    /// found by the name lists.
    #[test]
    fn scope_keys_are_learned_from_the_repositorys_own_queries() {
        let by_caller = |name: &str, model: &str| {
            let mut f = func(name, 3, &[]);
            f.scoped_queries = vec![ScopedQuery {
                condition: String::new(),
                callee: format!("svc/models.py#{model}.objects.filter"),
                key: "org_id".into(),
                source: ScopeSource::Session,
            }];
            f
        };
        let repo = module(
            "svc/repo.py",
            vec![
                by_caller("list_notes", "Note"),
                by_caller("list_tags", "Tag"),
                by_caller("list_teams", "Team"),
            ],
        );
        let r = with_units(vec![
            repo,
            route(
                "user",
                "/users/{user_id}/settings",
                &[USER, DB],
                func("user_settings", 10, &["svc/crud.py#load_settings"]),
            ),
            route(
                "org",
                "/orgs/{org_id}/settings",
                &[USER, DB],
                func("org_settings", 10, &["svc/crud.py#load_settings"]),
            ),
        ]);
        assert_eq!(
            unscoped_keys(&r),
            [("org_id".to_string(), 1, "org_settings".to_string())]
        );
        assert_eq!(unit_row(&r, "user_settings").unscoped, None);
    }

    /// Pins (review R5, row 3): a guard ties the route's value only by a parameter of
    /// the same name. One that filters by `param workspace`, which the route
    /// `/workspaces/{slug}` does not name (a FastAPI dependency's query or body
    /// value), ties nothing: the unit stays a check found and not proven. Before, a
    /// guard parameter the route does not name was taken as the URL's. A guard with
    /// a way through where nothing held ties nothing either (sibling case).
    #[test]
    fn a_guard_tied_by_a_value_beside_the_url_ties_nothing() {
        const MEMBERS: &str = "svc/models.py#Member.objects.filter";
        const ITEMS: &str = "svc/models.py#Item.objects.filter";
        let guard = |name: &str, param: &str, ways: &[&str]| {
            let mut g = func(name, 20, &["pkg:fastapi#HTTPException"]);
            g.controls = vec!["rejects_caller".into(), "throw".into()];
            g.controls.extend(
                ways.iter()
                    .map(|w| format!("{}{w}", drift_core::controls::LEAVES_AFTER)),
            );
            g.controls.push(format!(
                "{}{MEMBERS}\tmember\town caller\tworkspace__slug\tparam {param}",
                drift_core::controls::ARG_VALUE
            ));
            g.body_checks = vec![check(USER, CheckOutcome::Forbidden)];
            g
        };
        let held = format!("{MEMBERS}().exists");
        let handler = |name: &str| {
            let mut h = func(name, 10, &[]);
            h.args = vec![format!("{ITEMS}@0:workspace__slug")];
            h.controls = vec![format!(
                "{}{ITEMS}\tworkspace__slug\tparam slug",
                drift_core::controls::ARG_VALUE
            )];
            h
        };
        let r = with_units(vec![
            module(
                "svc/perm.py",
                vec![
                    guard("by_query", "workspace", &[held.as_str()]),
                    guard("one_way", "slug", &[held.as_str(), ""]),
                ],
            ),
            route(
                "query",
                "/workspaces/{slug}/query",
                &[USER, DB, "svc/perm.py#by_query"],
                handler("ws_query"),
            ),
            route(
                "branch",
                "/workspaces/{slug}/branch",
                &[USER, DB, "svc/perm.py#one_way"],
                handler("ws_branch"),
            ),
        ]);
        assert_eq!(authz_of(&r, "ws_query"), "unknown");
        assert_eq!(authz_of(&r, "ws_branch"), "unknown");
    }

    /// Pins (review R5, row 4): a method the constructor function does not assign
    /// (it may come from `util.inherits`, a mixin, a returned object) is not read as
    /// the constructor's whole body: nothing is read to the end. Before, `DAO().find`
    /// with no `DAO.find` read `DAO`'s body in its place.
    #[test]
    fn a_method_no_constructor_assigns_is_not_read_through_it() {
        let d = empty();
        let mut facts = nodegoat(&["pkg:mongodb#MongoClient"], false, false);
        facts.files[0].symbols.retain(|s| s.name != "DAO.find");
        let cx = Cx::new(&facts, &d);
        let show = facts.files[1]
            .symbols
            .iter()
            .find(|s| s.name == "Handler.show")
            .unwrap();
        assert!(closure(&cx, vec![Node::Sym(show)]).is_none());
    }

    /// Pins (review R5, row 5): a filter through a relation is learned by its whole
    /// path, so `where.author.id` is never the key `id`. Before, it read `id`.
    #[test]
    fn a_relation_filter_is_learned_by_its_whole_path() {
        assert_eq!(scope_word("where.author.id"), "authorid");
        assert_eq!(scope_word("author__id"), "authorid");
        assert_eq!(scope_word("where.userId"), "userid");
        assert_eq!(scope_word("user_id"), "userid");
        assert_eq!(scope_word("authorId"), "authorid");
    }

    /// Pins (review R5, row 6): keys are learned per package. The `org_id` that
    /// package `svc` scopes by says nothing of package `web`, whose `user_id` route
    /// is still read by the name lists. Before, one package's learned keys turned
    /// the fallback off for every package.
    #[test]
    fn scope_keys_are_learned_per_package() {
        let by_caller = |name: &str, model: &str| {
            let mut f = func(name, 3, &[]);
            f.scoped_queries = vec![ScopedQuery {
                condition: String::new(),
                callee: format!("svc/models.py#{model}.objects.filter"),
                key: "org_id".into(),
                source: ScopeSource::Session,
            }];
            f
        };
        let repo = module(
            "svc/repo.py",
            vec![
                by_caller("list_notes", "Note"),
                by_caller("list_tags", "Tag"),
                by_caller("list_teams", "Team"),
            ],
        );
        let mut web = route(
            "web_user",
            "/users/{user_id}/settings",
            &[USER, DB],
            func("web_settings", 10, &["svc/crud.py#load_settings"]),
        );
        web.package = "web".into();
        let r = with_units(vec![repo, web]);
        assert_eq!(
            unscoped_keys(&r),
            [("user_id".to_string(), 1, "web_settings".to_string())]
        );
    }

    /// Pins (review R5, row 11): what the application runs before the unit is read
    /// with it. A middleware class of the repository decides in a method the closure
    /// does not read, so nothing is said of the key. Before, the unit's own wraps
    /// alone were read.
    #[test]
    fn the_applications_middleware_is_read_before_a_key_is_unscoped() {
        let d = empty();
        let build = |middleware: &[&str]| {
            let mut h = func("user_settings", 10, &["svc/crud.py#load_settings"]);
            h.app_middleware = middleware.iter().map(|m| m.to_string()).collect();
            let mut mw = func("TenantScope", 2, &[]);
            mw.kind = SymbolKind::Class;
            let mut files = vec![
                route("settings", "/users/{user_id}/settings", &[USER, DB], h),
                module("svc/mw.py", vec![mw]),
            ];
            files.extend(shared());
            files.sort_by(|a, b| a.path.cmp(&b.path));
            RepoFacts {
                schema_version: drift_core::FACTS_SCHEMA_VERSION,
                files,
                ..RepoFacts::default()
            }
        };
        let key_of = |facts: &RepoFacts| {
            let cx = Cx::new(facts, &d);
            let file = facts
                .files
                .iter()
                .find(|f| f.path == "svc/api/settings.py")
                .unwrap();
            let unit = UnitRef::Entry {
                file,
                entry: &file.entry_points[0],
                symbol: file.symbols.first(),
            };
            unscoped(&cx, &unit, &[], None)
        };
        assert_eq!(key_of(&build(&[])).as_deref(), Some("user_id"));
        assert_eq!(key_of(&build(&["svc/mw.py#TenantScope"])), None);
    }

    // ---------- a service class's method ----------

    const FORBIDDEN: &str = "svc/errors.py#ForbiddenError";
    const RULES: &str = "svc/services.py#RuleBook";

    fn raise(source: &str, reads: &str, compares: &str) -> drift_core::RaiseCheck {
        drift_core::RaiseCheck {
            source: source.into(),
            reads: reads.into(),
            compares: compares.into(),
            raises: FORBIDDEN.into(),
            status: 0,
            op: String::new(),
            conditional: false,
            condition: String::new(),
            unless: String::new(),
            after: vec![],
        }
    }

    /// A class, with what its methods call and raise together on the class itself, as
    /// the lowerings record it.
    fn class(name: &str, members: Vec<Member>) -> Symbol {
        let mut c = func(name, 4, &[]);
        c.kind = SymbolKind::Class;
        c.calls = members.iter().flat_map(|m| m.calls.clone()).collect();
        c.calls.sort();
        c.calls.dedup();
        c.throws = members.iter().flat_map(|m| m.throws.clone()).collect();
        c.throws.sort();
        c.throws.dedup();
        c.members = members;
        c
    }

    fn member(name: &str, calls: &[&str]) -> Member {
        Member {
            name: name.into(),
            calls: calls.iter().map(|c| c.to_string()).collect(),
            ..Member::default()
        }
    }

    /// `svc/services.py`: a service whose `list_rules` compares the organisation asked
    /// for with the caller's and raises, whose `get_rule` leaves that to a sibling,
    /// whose `ping` checks nothing, whose `find` filters by what it is handed and
    /// whose `mine` filters by the session's; a protocol of the same shape; and a
    /// class with one method that queries nothing.
    /// `svc/wiring.py`: a dependency alias of the service, a module-level instance of
    /// it, an alias of the protocol and a dependency of no known type.
    fn service_modules() -> Vec<FileFacts> {
        let mut list = member("list_rules", &[FORBIDDEN, SELECT]);
        list.throws = vec![FORBIDDEN.into()];
        list.raise_checks = vec![raise("param:org_id", "", "param:self")];
        let mut assert_access = member("_ensure_access", &[FORBIDDEN]);
        assert_access.throws = vec![FORBIDDEN.into()];
        assert_access.raise_checks = vec![raise("param:rule", ".org_id", "param:self")];
        let get = member("get_rule", &[SELECT, "svc/services.py#RuleBook._ensure_access"]);
        let mut find = member("find", &[SELECT]);
        find.scoped_queries = vec![scoped("org_id", ScopeSource::Param)];
        let mut mine = member("mine", &[SELECT]);
        mine.scoped_queries = vec![scoped("org_id", ScopeSource::Session)];
        let service = class(
            "RuleBook",
            vec![assert_access, find, get, list, mine, member("ping", &[SELECT])],
        );
        let mut protocol = class("RuleReader", vec![member("list_rules", &[])]);
        protocol.traits = vec![drift_core::traits::PROTOCOL.into()];
        let mut alias = func("RuleBookDep", 3, &["pkg:fastapi#Depends"]);
        alias.kind = SymbolKind::Variable;
        alias.alias_of = RULES.into();
        let mut instance = func("rules", 5, &[RULES]);
        instance.kind = SymbolKind::Variable;
        let mut reader = func("RuleReaderDep", 7, &["pkg:fastapi#Depends"]);
        reader.kind = SymbolKind::Variable;
        reader.alias_of = "svc/services.py#RuleReader".into();
        let mut untyped = func("OTHER", 9, &["pkg:fastapi#Depends"]);
        untyped.kind = SymbolKind::Const;
        let mailer = class("Mailer", vec![member("send", &["svc/crud.py#load_settings"])]);
        vec![
            module("svc/services.py", vec![mailer, protocol, service]),
            module("svc/wiring.py", vec![untyped, alias, reader, instance]),
        ]
    }

    /// The authz assignment of each handler, as `(symbol, assignment, key or instrument)`.
    fn assigned(mut routes: Vec<FileFacts>) -> Vec<(String, String, String)> {
        routes.extend(shared());
        routes.extend(service_modules());
        routes.sort_by(|a, b| a.path.cmp(&b.path));
        let facts = RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            files: routes,
            ..RepoFacts::default()
        };
        let d = empty();
        let cx = Cx::new(&facts, &d);
        assign_all(&Authz, &cx)
            .into_iter()
            .filter(|(p, ..)| p.starts_with("svc/api/"))
            .map(|(_, name, a)| match &a {
                Assignment::Known { .. } => (name, "known".into(), key(&a)),
                Assignment::None { .. } => (name, "none".into(), String::new()),
                Assignment::Unknown { reason, instrument } => {
                    (name, format!("unknown:{reason:?}"), instrument.clone())
                }
            })
            .collect()
    }

    fn handler(name: &str, calls: &[&str]) -> FileFacts {
        route(name, &format!("/{name}"), &[USER, DB], func(name, 10, calls))
    }

    /// Each unit of `svc/api/` with what was found for it: the variant key of a known
    /// unit, or the check found and not proven as `<check> [<obligation>] <when>
    /// <declarable>`.
    fn found(mut routes: Vec<FileFacts>) -> Vec<(String, String)> {
        routes.extend(shared());
        routes.extend(service_modules());
        routes.sort_by(|a, b| a.path.cmp(&b.path));
        let facts = RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            files: routes,
            ..RepoFacts::default()
        };
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let mut out: Vec<(String, String)> = Authz
            .population(&cx)
            .iter()
            .filter_map(|u| {
                let UnitRef::Entry { file, entry, .. } = *u else {
                    return None;
                };
                if !file.path.starts_with("svc/api/") {
                    return None;
                }
                let (a, b) = Authz.assign_backed(&cx, u);
                let what = match (&a, &b.unproven) {
                    (
                        Assignment::Unknown {
                            reason: UnknownReason::CheckNotProven,
                            ..
                        },
                        Some(p),
                    ) => format!("{} [{}] {} {}", p.check, p.obligation, p.when, p.declarable),
                    (Assignment::Known { .. }, None) => key(&a),
                    _ => format!("{a:?}"),
                };
                Some((entry.symbol.clone(), what))
            })
            .collect();
        out.sort();
        out
    }

    /// [STRICT] `known` needs proof that the check runs on every request. A check in
    /// a helper the body calls only on some paths, or one that is conditional in the
    /// helper itself, is found and not proven: the unit is unknown, and says the check
    /// and the obligation that failed. A helper reached on every path by one chain of
    /// calls is proven, whatever other chain reaches it conditionally. Naming the
    /// helper in `practices:` settles the unit only where the unit always runs it.
    #[test]
    fn a_check_only_some_requests_reach_is_found_not_proven() {
        let org = "svc/helpers.py#assert_org";
        let if_set = "svc/helpers.py#assert_org_if_set";
        let sometimes = "svc/helpers.py#sometimes";
        let always = "svc/helpers.py#always";
        let helpers = || {
            let mut plain = func("assert_org", 3, &[]);
            plain.raise_checks = vec![raise("param:rule", ".org_id", "param:caller")];
            let mut conditional = func("assert_org_if_set", 9, &[]);
            let mut check = raise("param:rule", ".org_id", "param:caller");
            check.conditional = true;
            check.condition = drift_core::not_always::AND_OPERAND.into();
            check.unless = "only when caller.org_id is not None".into();
            conditional.raise_checks = vec![check];
            let mut skips = func("sometimes", 15, &[org]);
            skips.conditional_calls = vec![format!("after_conditional_return:{org}")];
            module(
                "svc/helpers.py",
                vec![plain, conditional, skips, func("always", 21, &[org])],
            )
        };
        let mut branch = handler("branch", &[org]);
        branch.symbols[0].conditional_calls = vec![format!("under_branch:{org}")];
        let got = found(vec![
            helpers(),
            handler("plain", &[org]),
            branch,
            handler("operand", &[if_set]),
            handler("deeper", &[sometimes]),
            // Reached conditionally through one helper and on every path through
            // another: it runs for every request.
            handler("upgraded", &[sometimes, always]),
        ]);
        let want = |name: &str, what: &str| (name.to_string(), what.to_string());
        assert_eq!(
            got,
            [
                want(
                    "branch",
                    "tenancy_check:svc/helpers.py#assert_org [under_branch]  false"
                ),
                want(
                    "deeper",
                    "tenancy_check:svc/helpers.py#assert_org [after_conditional_return]  false"
                ),
                want(
                    "operand",
                    "tenancy_check:svc/helpers.py#assert_org_if_set [and_operand] only when caller.org_id is not None true"
                ),
                want("plain", "tenancy_check:svc/helpers.py#assert_org"),
                want("upgraded", "tenancy_check:svc/helpers.py#assert_org"),
            ]
        );
    }

    /// [STRICT] A tenant check compares the caller's value with the resource's or the
    /// request's. A row compared with itself, a value compared with a literal and, in
    /// a Python handler's own body, two values the request sent are none.
    #[test]
    fn a_comparison_of_two_sides_that_are_not_the_callers_is_no_tenant_check() {
        assert!(sides("svc/repo.py#get_rule", ".org_id", "call:svc/deps.py#get_caller", true));
        assert!(!sides(
            "svc/repo.py#get_rule",
            ".org_id",
            "call:svc/repo.py#get_rule.owner_org_id",
            false
        ));
        assert!(!sides("param:body", ".org_id", "param:org_id", true));
        // A helper's parameters are whatever its caller passed.
        assert!(sides("param:body", ".org_id", "param:org_id", false));
        // What is read off the request's user is the caller's.
        assert!(sides("param:request", ".user.org_id", "param:org_id", true));
        // `self` on both sides says nothing.
        assert!(sides("param:self", ".caller.org_id", "param:self", false));
    }

    /// The check lives in the service's method: it is read through each way a handler
    /// gets the instance, and named where it is.
    #[test]
    fn a_service_method_is_read_through_how_the_handler_gets_the_instance() {
        let checked = "tenancy_check:svc/services.py#RuleBook.list_rules";
        let got = assigned(vec![
            // A parameter typed by a dependency alias of the class.
            handler("by_alias", &["svc/wiring.py#RuleBookDep.list_rules"]),
            // A parameter typed by the class itself.
            handler("by_type", &["svc/services.py#RuleBook.list_rules"]),
            // An instance built in place.
            handler(
                "built",
                &[RULES, "svc/services.py#RuleBook().list_rules"],
            ),
            // A module-level instance.
            handler("by_instance", &["svc/wiring.py#rules.list_rules"]),
            // The method leaves the check to a sibling: two calls down.
            handler("by_sibling", &["svc/wiring.py#RuleBookDep.get_rule"]),
        ]);
        // Named for what the method compares (the row's organisation), not for the
        // word `access` in its name.
        let sibling = "tenancy_check:svc/services.py#RuleBook._ensure_access";
        assert_eq!(
            got,
            [
                ("built".to_string(), "known".to_string(), checked.to_string()),
                ("by_alias".into(), "known".into(), checked.into()),
                ("by_instance".into(), "known".into(), checked.into()),
                ("by_sibling".into(), "known".into(), sibling.into()),
                ("by_type".into(), "known".into(), checked.into()),
            ]
        );
    }

    /// [STRICT]: where the method that runs cannot be read, the unit is unknown, never
    /// a none; and a method that was read and checks nothing is a none.
    #[test]
    fn a_method_that_cannot_be_read_is_unknown_and_one_that_checks_nothing_is_a_none() {
        let got = assigned(vec![
            // What a framework injects, of a type the facts do not give.
            handler("untyped", &["svc/wiring.py#OTHER.list_rules"]),
            // A protocol: what runs is an implementation's method.
            handler("protocol", &["svc/wiring.py#RuleReaderDep.list_rules"]),
            // A method the class does not define.
            handler("missing", &["svc/wiring.py#RuleBookDep.export"]),
            // A class built whose methods are called on the instance, unrecorded.
            handler("kept", &["svc/services.py#Mailer"]),
            // Read to the end: it queries and checks nothing.
            handler("plain", &["svc/wiring.py#RuleBookDep.ping"]),
            // A query filtered by what the method was handed: maybe the scope.
            handler("handed", &["svc/wiring.py#RuleBookDep.find"]),
            // A query filtered by the session's tenant.
            handler("scoped", &["svc/wiring.py#RuleBookDep.mine"]),
        ]);
        let unread = "unknown:BodyUnreadable".to_string();
        assert_eq!(
            got,
            [
                (
                    "handed".to_string(),
                    "unknown:Unresolved".to_string(),
                    "svc/services.py#RuleBook.find".to_string()
                ),
                ("kept".into(), unread.clone(), "svc/services.py#Mailer".into()),
                (
                    "missing".into(),
                    unread.clone(),
                    "svc/services.py#RuleBook.export".into()
                ),
                ("plain".into(), "none".into(), String::new()),
                (
                    "protocol".into(),
                    unread.clone(),
                    "svc/services.py#RuleReader.list_rules".into()
                ),
                (
                    "scoped".into(),
                    "known".into(),
                    "tenancy_filter:org_id (session)".into()
                ),
                (
                    "untyped".into(),
                    unread,
                    "svc/wiring.py#OTHER.list_rules".into()
                ),
            ]
        );
    }

    /// A raise check is read by what it compares, not by a word on the way: a
    /// parameter named for a tenant counts only where it is compared, and the value
    /// read is the last member of the path.
    #[test]
    fn a_raise_check_is_named_by_what_it_compares() {
        let reached = |checks: Vec<drift_core::RaiseCheck>| {
            let mut ev = Evidence::default();
            let mut f = func("f", 1, &[]);
            f.raise_checks = checks;
            let facts = RepoFacts::default();
            let declared = empty();
            let cx = Cx::new(&facts, &declared);
            let r = Reached {
                depth: 0,
                node: Node::Sym(&f),
                callee: String::new(),
                quiet: false,
                signs_in: false,
                via: None,
                via_call: String::new(),
            };
            raised(&cx, &r, &mut ev);
            ev.uses
                .iter()
                .map(|u| format!("{}:{}", u.mechanism, u.instrument))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            reached(vec![raise("param:org_id", "", "param:self")]),
            ["tenancy_check:param:org_id"]
        );
        // `if not org_id: raise ...` asks for a value, not for the caller's.
        assert_eq!(reached(vec![raise("param:org_id", "", "")]), [] as [&str; 0]);
        // Compared with a value that could not be read: compared all the same.
        assert_eq!(
            reached(vec![raise("param:org_id", "", drift_core::UNREAD_COMPARE)]),
            ["tenancy_check:param:org_id"]
        );
        assert_eq!(
            reached(vec![raise("param:rule", ".workspace_id", "param:self")]),
            ["tenancy_check:claim:.workspace_id"]
        );
        assert_eq!(
            reached(vec![raise("param:rule", ".user_id", "param:self")]),
            ["owner_check:param:rule.user_id"]
        );
        assert_eq!(
            reached(vec![raise("param:self", ".caller.role", "literal")]),
            ["role_check:param:self.caller.role"]
        );
        // A claim that is only asked for: the caller has a tenant (or the row an
        // owner), and nothing says the rows are that tenant's.
        assert_eq!(
            reached(vec![raise("param:self", ".caller.org_id", "")]),
            [] as [&str; 0]
        );
        assert_eq!(
            reached(vec![raise("param:rule", ".user_id", "")]),
            [] as [&str; 0]
        );
        // The operator decides: a check that refuses a match turns away the caller's
        // own tenant and serves any other, and an ordering compares no identity.
        let mut own = raise("param:org_id", "", "param:self");
        own.op = drift_core::check_op::REFUSES_MATCH.into();
        assert_eq!(reached(vec![own.clone()]), [] as [&str; 0]);
        own.op = drift_core::check_op::OTHER.into();
        assert_eq!(reached(vec![own.clone()]), [] as [&str; 0]);
        own.op = drift_core::check_op::REFUSES_MISMATCH.into();
        assert_eq!(reached(vec![own]), ["tenancy_check:param:org_id"]);
        let mut row = raise("param:rule", ".user_id", drift_core::UNREAD_COMPARE);
        row.op = drift_core::check_op::REFUSES_MATCH.into();
        assert_eq!(reached(vec![row]), [] as [&str; 0]);
        // A check only some requests reach proves nothing of the others.
        let mut some = raise("param:org_id", "", "param:self");
        some.conditional = true;
        assert_eq!(reached(vec![some]), [] as [&str; 0]);
        // A word on the way names nothing: the value read is `.data`.
        assert_eq!(
            reached(vec![raise(
                "svc/clerk.py#client",
                ".get_organization_memberships.data",
                ""
            )]),
            [] as [&str; 0]
        );
        // A class that is no refusal, and a status that is none, say nothing; a 403
        // the raise states does.
        let mut conflict = raise("param:org_id", "", "param:self");
        conflict.raises = "svc/errors.py#ConflictError".into();
        assert_eq!(reached(vec![conflict.clone()]), [] as [&str; 0]);
        conflict.raises = "pkg:fastapi#HTTPException".into();
        conflict.status = 409;
        assert_eq!(reached(vec![conflict.clone()]), [] as [&str; 0]);
        conflict.status = 403;
        assert_eq!(reached(vec![conflict]), ["tenancy_check:param:org_id"]);
    }

    // ---------- a refusal nothing explains ----------

    /// A refusal the map cannot name, in the handler or any number of calls below it,
    /// is never a recorded absence: the unit is unknown, or known by what else is read.
    #[test]
    fn a_refusal_nothing_explains_is_never_a_none() {
        let mut person = member("_person", &[FORBIDDEN]);
        person.throws = vec![FORBIDDEN.into()];
        person.raise_checks = vec![raise("param:self", ".caller.token_user_id", "")];
        let record = member("record", &["svc/reviews.py#ReviewService._person"]);
        let decisions = module(
            "svc/reviews.py",
            vec![class("ReviewService", vec![person, record])],
        );
        let mut gated = func("own", 10, &["svc/crud.py#load_settings"]);
        gated.responses = vec![drift_core::ResponseFact {
            status: 403,
            ..drift_core::ResponseFact::default()
        }];
        let got = assigned(vec![
            decisions,
            // Two calls down, in a method the service calls.
            handler("by_member", &["svc/reviews.py#ReviewService.record"]),
            // One call down, in a helper that raises a class named for a 403.
            handler("by_helper", &["svc/crud.py#load_profile"]),
            // The handler's own 403 response, on a condition the facts do not hold.
            route("own", "/own", &[USER, DB], gated),
            // Beside a check the map can name, the unit is known by that check.
            handler(
                "with_scope",
                &[
                    "svc/reviews.py#ReviewService.record",
                    "svc/wiring.py#RuleBookDep.list_rules",
                ],
            ),
        ]);
        let unclassified = "unknown:Unclassified".to_string();
        assert_eq!(
            got,
            [
                (
                    "by_helper".to_string(),
                    unclassified.clone(),
                    "svc/crud.py#load_profile".to_string()
                ),
                (
                    "by_member".into(),
                    unclassified.clone(),
                    "svc/reviews.py#ReviewService._person".into()
                ),
                ("own".into(), unclassified, "status:403".into()),
                (
                    "with_scope".into(),
                    "known".into(),
                    "tenancy_check:svc/services.py#RuleBook.list_rules".into()
                ),
            ]
        );
    }

    // ---------- request plumbing, a forward, a check that answers ----------

    const SEARCH: &str = "nextUrl.searchParams.get";
    const NEXT_REQUEST: &str = "pkg:next/server#NextRequest.nextUrl.searchParams.get";

    /// A call through the framework's request object, by a path of several members, is
    /// the framework's: read only where the facts tie the call to a typed parameter.
    #[test]
    fn a_longer_path_through_a_package_typed_request_is_read() {
        let through = |p: &str| format!("param:{p}.{SEARCH}");
        let req = through("req");
        let ctx = through("ctx");
        let mut handed = func("handed", 10, &[&req, NEXT_REQUEST]);
        handed.controls = vec![drift_core::controls::UNREAD_CALL.into()];
        let got = assigned(vec![
            handler("read", &[&req, NEXT_REQUEST]),
            // No type names the path: the parameter has none.
            handler("untyped", &[&req]),
            // Two parameters' calls have the path and one type names it: which is whose
            // is not known.
            handler("two", &[&ctx, &req, NEXT_REQUEST]),
            // The type is the repository's: its method is unread code.
            handler("own_type", &[&req, "svc/types.py#Req.nextUrl.searchParams.get"]),
            // The body hands a value to a call the facts did not record.
            route("handed", "/handed", &[USER, DB], handed),
        ]);
        let unread = "unknown:BodyUnreadable".to_string();
        assert_eq!(
            got,
            [
                // The request's own method, unread only for what else the body hands
                // on: the body is what is read in part, not `nextUrl.searchParams.get`.
                (
                    "handed".to_string(),
                    "unknown:PartlyRead".to_string(),
                    "svc/api/handed.py#handed".to_string()
                ),
                ("own_type".into(), unread.clone(), req.clone()),
                ("read".into(), "none".into(), String::new()),
                ("two".into(), unread.clone(), ctx),
                ("untyped".into(), unread, req),
            ]
        );
    }

    /// A body that hands the request to another service is not said to authorise
    /// nothing: what authorises it may be there.
    #[test]
    fn a_request_forwarded_to_another_service_is_not_a_none() {
        let got = assigned(vec![
            handler("fetched", &["global#fetch"]),
            handler("client", &["pkg:httpx#AsyncClient.get"]),
            // A helper one call down forwards it.
            module(
                "svc/upstream.py",
                vec![func("forward_to_iam", 3, &["pkg:requests#post"])],
            ),
            handler("helped", &["svc/upstream.py#forward_to_iam"]),
            // With a check of its own, it is known by that check.
            handler(
                "checked",
                &["global#fetch", "svc/wiring.py#RuleBookDep.list_rules"],
            ),
        ]);
        // Named by the function that hands it on, never by the client's call.
        let forwarded = "unknown:Forwarded".to_string();
        assert_eq!(
            got,
            [
                (
                    "checked".to_string(),
                    "known".to_string(),
                    "tenancy_check:svc/services.py#RuleBook.list_rules".to_string()
                ),
                ("client".into(), forwarded.clone(), "svc/api/client.py#client".into()),
                (
                    "fetched".into(),
                    forwarded.clone(),
                    "svc/api/fetched.py#fetched".into()
                ),
                (
                    "helped".into(),
                    forwarded,
                    "svc/upstream.py#forward_to_iam".into()
                ),
            ]
        );
    }

    /// A 403 on what an in-repo function answered: named for a question about access
    /// to a tenant, a tenant check is found by its name only, and the unit is unknown
    /// with it (the function may answer anything); a getter and a rate limit ask no
    /// such thing.
    #[test]
    fn a_403_on_the_answer_of_a_check_named_for_access_is_found_by_name_only() {
        let on = |name: &str, source: &str| {
            let mut h = func(name, 10, &[source]);
            h.controls = vec!["rejects_caller".into()];
            h.body_checks = vec![check(source, CheckOutcome::Forbidden)];
            route(name, &format!("/{name}"), &[USER, DB], h)
        };
        let access = module(
            "svc/access.py",
            vec![
                func("check_rate_limit_for_org", 9, &[]),
                func("get_org_id", 6, &[]),
                func("owns_workspace", 3, &["global#fetch"]),
            ],
        );
        let got = assigned(vec![
            access,
            on("asks", "svc/access.py#owns_workspace"),
            on("gets", "svc/access.py#get_org_id"),
            on("limits", "svc/access.py#check_rate_limit_for_org"),
            // What a library answered is no check of the repository's.
            on("library", "pkg:acme_billing#has_org_plan"),
        ]);
        let unclassified = "unknown:Unclassified".to_string();
        assert_eq!(
            got,
            [
                (
                    "asks".to_string(),
                    "unknown:CheckNotProven".to_string(),
                    "svc/access.py#owns_workspace".to_string()
                ),
                (
                    "gets".into(),
                    unclassified.clone(),
                    "svc/access.py#get_org_id".into()
                ),
                (
                    "library".into(),
                    unclassified.clone(),
                    "pkg:acme_billing#has_org_plan".into()
                ),
                (
                    "limits".into(),
                    unclassified,
                    "svc/access.py#check_rate_limit_for_org".into()
                ),
            ]
        );
    }

    /// A parameter typed by a class may hold a subclass's instance: where a
    /// production subclass defines the method too, which one runs is not known. An
    /// instance built in place is the class's own; a subclass in a test file is a
    /// test double.
    #[test]
    fn a_method_a_subclass_overrides_is_unread_through_a_typed_parameter() {
        let scoped = |path: &str| {
            let mut sub = class("ScopedRuleBook", vec![member("ping", &[])]);
            sub.wraps = vec![Wrap {
                wrapper: RULES.into(),
                kind: WrapKind::Extends,
            }];
            module(path, vec![sub])
        };
        let cases = || {
            vec![
                handler("typed", &["svc/wiring.py#RuleBookDep.ping"]),
                handler("checked", &["svc/wiring.py#RuleBookDep.list_rules"]),
                handler("built", &[RULES, "svc/services.py#RuleBook().ping"]),
            ]
        };
        let of = |got: &[(String, String, String)], name: &str| {
            let (_, a, i) = got.iter().find(|(n, ..)| n == name).unwrap();
            (a.clone(), i.clone())
        };
        let mut with = cases();
        with.push(scoped("svc/scoped.py"));
        let got = assigned(with);
        assert_eq!(
            of(&got, "typed"),
            (
                "unknown:BodyUnreadable".to_string(),
                "svc/services.py#RuleBook.ping".to_string()
            )
        );
        // A method the subclass leaves alone is the base's, whoever the instance is.
        assert_eq!(of(&got, "checked").0, "known");
        assert_eq!(of(&got, "built"), ("none".to_string(), String::new()));
        let mut test_double = cases();
        test_double.push(scoped("svc/tests/test_rules.py"));
        assert_eq!(
            of(&assigned(test_double), "typed"),
            ("none".to_string(), String::new())
        );
    }

    /// A chain of helpers longer than the reach reads: what the deepest body read
    /// calls is unread, so the unit is unknown, never a recorded absence; within the
    /// reach, a check at the end of the chain is read.
    #[test]
    fn what_the_deepest_body_read_calls_is_unread() {
        let chain = |len: usize| {
            let mut symbols: Vec<Symbol> = (1..=len)
                .map(|i| {
                    let next = format!("svc/chain.py#h{}", i + 1);
                    let calls: &[&str] = if i < len { &[next.as_str()] } else { &[FORBIDDEN] };
                    func(&format!("h{i}"), i as u32, calls)
                })
                .collect();
            let last = symbols.last_mut().unwrap();
            last.throws = vec![FORBIDDEN.into()];
            last.raise_checks = vec![raise("param:org_id", "", "param:caller")];
            module("svc/chain.py", symbols)
        };
        let got = assigned(vec![
            chain(AUTHZ_HOPS),
            handler("deep", &["svc/chain.py#h1"]),
        ]);
        assert_eq!(
            got,
            [(
                "deep".to_string(),
                "known".to_string(),
                format!("tenancy_check:svc/chain.py#h{AUTHZ_HOPS}")
            )]
        );
        let got = assigned(vec![
            chain(AUTHZ_HOPS + 1),
            handler("deeper", &["svc/chain.py#h1"]),
        ]);
        assert_eq!(
            got,
            [(
                "deeper".to_string(),
                "unknown:BodyUnreadable".to_string(),
                format!("svc/chain.py#h{}", AUTHZ_HOPS + 1)
            )]
        );
    }

    /// A constructor runs wherever its class is built: a check in `__init__` is read
    /// through the dependency that builds the service, and through a service built
    /// in place; a class whose instance's calls are not recorded is still unread.
    #[test]
    fn a_check_in_a_constructor_is_read_where_the_class_is_built() {
        let mut init = member("__init__", &[FORBIDDEN]);
        init.throws = vec![FORBIDDEN.into()];
        init.raise_checks = vec![raise("param:caller", ".role", "literal")];
        let gated = class("ReportService", vec![init, member("purge", &[])]);
        let mut factory = func("get_report_service", 20, &["svc/reports.py#ReportService"]);
        factory.wraps = vec![Wrap {
            wrapper: USER.into(),
            kind: WrapKind::Call,
        }];
        let got = assigned(vec![
            module("svc/reports.py", vec![gated, factory]),
            route(
                "injected",
                "/injected",
                &[USER, DB, "svc/reports.py#get_report_service"],
                func("injected", 10, &["svc/reports.py#ReportService.purge"]),
            ),
            handler(
                "built",
                &[
                    "svc/reports.py#ReportService",
                    "svc/reports.py#ReportService().purge",
                ],
            ),
            handler("kept", &["svc/reports.py#ReportService"]),
        ]);
        let by_init = "role_check:svc/reports.py#ReportService.__init__".to_string();
        assert_eq!(
            got,
            [
                ("built".to_string(), "known".to_string(), by_init.clone()),
                ("injected".into(), "known".into(), by_init.clone()),
                ("kept".into(), "known".into(), by_init),
            ]
        );
    }

    /// The decorators on what a handler calls run around its body: one that checks a
    /// role is the unit's guard, one that refuses on what the map cannot name leaves
    /// the unit unknown, and one that only maps errors says nothing.
    #[test]
    fn a_decorator_on_a_callee_is_read_as_a_dependency_is() {
        let http = "pkg:fastapi#HTTPException";
        let mut role = func("require_role", 3, &[http]);
        role.throws = vec![http.into()];
        role.raise_checks = vec![drift_core::RaiseCheck {
            source: "param:self".into(),
            reads: ".caller.role".into(),
            compares: drift_core::UNREAD_COMPARE.into(),
            raises: http.into(),
            status: 403,
            op: drift_core::check_op::REFUSES_MISMATCH.into(),
            conditional: false,
            condition: String::new(),
            unless: String::new(),
            after: vec![],
        }];
        let mut gate = func("beta_gate", 12, &[FORBIDDEN]);
        gate.throws = vec![FORBIDDEN.into()];
        let mut mapped = func("map_errors", 20, &[http]);
        mapped.responses = vec![drift_core::ResponseFact {
            status: 403,
            in_catch: true,
            ..drift_core::ResponseFact::default()
        }];
        let decorated = |name: &str, decorator: &str| {
            let mut m = member(name, &[]);
            m.decorators = vec![format!("svc/guards.py#{decorator}")];
            m
        };
        let mut helper = func("purge_all", 30, &[]);
        helper.wraps = vec![Wrap {
            wrapper: "svc/guards.py#require_role".into(),
            kind: WrapKind::Decorator,
        }];
        let service = class(
            "JobService",
            vec![
                decorated("delete", "require_role"),
                decorated("preview", "beta_gate"),
                decorated("load", "map_errors"),
            ],
        );
        let got = assigned(vec![
            module("svc/guards.py", vec![gate, mapped, role]),
            module("svc/jobs.py", vec![service, helper]),
            handler("by_method", &["svc/jobs.py#JobService().delete", "svc/jobs.py#JobService"]),
            handler("by_function", &["svc/jobs.py#purge_all"]),
            handler("gated", &["svc/jobs.py#JobService().preview", "svc/jobs.py#JobService"]),
            handler("mapped", &["svc/jobs.py#JobService().load", "svc/jobs.py#JobService"]),
        ]);
        let guard = "role_guard:svc/guards.py#require_role".to_string();
        assert_eq!(
            got,
            [
                ("by_function".to_string(), "known".to_string(), guard.clone()),
                ("by_method".into(), "known".into(), guard),
                (
                    "gated".into(),
                    "unknown:Unclassified".into(),
                    "svc/guards.py#beta_gate".into()
                ),
                ("mapped".into(), "none".into(), String::new()),
            ]
        );
    }

    /// A module-level name bound to nothing where it is defined holds, when a handler
    /// calls a method on it, whatever start-up code put there: unread. A module-level
    /// plain value's method is the library's, as before.
    #[test]
    fn a_method_of_a_module_name_bound_later_is_unread() {
        let mut late = func("rule_book", 3, &[]);
        late.kind = SymbolKind::Variable;
        late.controls = vec![drift_core::controls::LATE_BOUND.into()];
        let mut names = func("NAMES", 5, &[]);
        names.kind = SymbolKind::Const;
        let got = assigned(vec![
            module("svc/state.py", vec![names, late]),
            handler("late", &["svc/state.py#rule_book.list_rules"]),
            handler("plain", &["svc/state.py#NAMES.get"]),
        ]);
        assert_eq!(
            got,
            [
                (
                    "late".to_string(),
                    "unknown:BodyUnreadable".to_string(),
                    "svc/state.py#rule_book.list_rules".to_string()
                ),
                ("plain".into(), "none".into(), String::new()),
            ]
        );
    }

    /// A call on a local or on what a dependency injects ([`Symbol::receiver_calls`])
    /// is followed as a call is: into the class a call builds, into the class a
    /// factory hands back (the one it builds, before the one it is annotated with),
    /// through an attribute `__init__` types. One whose receiver cannot be told is
    /// unread.
    #[test]
    fn a_call_on_a_local_or_an_injected_value_is_followed_or_unread() {
        let received = |name: &str, calls: &[&str]| {
            let mut h = func(name, 10, &[]);
            h.receiver_calls = calls.iter().map(|c| c.to_string()).collect();
            route(name, &format!("/{name}"), &[USER, DB], h)
        };
        // A factory that builds the service, one only annotated with it, one that
        // builds a subclass under the base's annotation, and one that says nothing.
        let mut builds = func("get_rules", 3, &[RULES]);
        builds.returns_instance = RULES.into();
        let mut typed = func("typed_rules", 5, &[]);
        typed.returns_type = RULES.into();
        let mut scoped = class("ScopedRuleBook", vec![member("ping", &[FORBIDDEN])]);
        scoped.wraps = vec![Wrap {
            wrapper: RULES.into(),
            kind: WrapKind::Extends,
        }];
        scoped.members[0].throws = vec![FORBIDDEN.into()];
        scoped.members[0].raise_checks = vec![raise("param:org_id", "", "param:self")];
        let mut sub = func("get_scoped", 7, &["svc/factories.py#ScopedRuleBook"]);
        sub.returns_instance = "svc/factories.py#ScopedRuleBook".into();
        sub.returns_type = RULES.into();
        let silent = func("get_other", 9, &[]);
        // A holder whose `__init__` types an attribute by the service.
        let mut holder = class("Holder", vec![member("__init__", &[])]);
        holder.attr_types = vec![format!("rules={RULES}")];
        let checked = "tenancy_check:svc/services.py#RuleBook.list_rules";
        let got = assigned(vec![
            module(
                "svc/factories.py",
                vec![holder, scoped, silent, sub, builds, typed],
            ),
            received("local", &["svc/services.py#RuleBook().list_rules"]),
            received("injected", &["svc/factories.py#get_rules().list_rules"]),
            received("annotated", &["svc/factories.py#typed_rules().list_rules"]),
            received("attribute", &["svc/factories.py#Holder.rules.list_rules"]),
            // The subclass the factory builds runs, not the annotated base.
            received("subclass", &["svc/factories.py#get_scoped().ping"]),
            // The annotated base's `ping` may be the subclass's: unread.
            received("base_typed", &["svc/factories.py#typed_rules().ping"]),
            received("unknown_factory", &["svc/factories.py#get_other().list_rules"]),
            received("untyped", &["param:exporter.run"]),
            received("loop", &["local:row.attach"]),
            received("no_attribute", &["svc/factories.py#Holder.other.run"]),
        ]);
        let of = |name: &str| {
            let (_, a, i) = got.iter().find(|(n, ..)| n == name).unwrap();
            (a.as_str(), i.as_str())
        };
        for name in ["local", "injected", "annotated", "attribute"] {
            assert_eq!(of(name), ("known", checked), "{name}");
        }
        assert_eq!(
            of("subclass"),
            (
                "known",
                "tenancy_check:svc/factories.py#ScopedRuleBook.ping"
            )
        );
        let unread = "unknown:BodyUnreadable";
        assert_eq!(of("base_typed"), (unread, "svc/services.py#RuleBook.ping"));
        assert_eq!(
            of("unknown_factory"),
            (unread, "svc/factories.py#get_other().list_rules")
        );
        assert_eq!(of("untyped"), (unread, "param:exporter.run"));
        assert_eq!(of("loop"), (unread, "local:row.attach"));
        assert_eq!(
            of("no_attribute"),
            (unread, "svc/factories.py#Holder.other.run")
        );
    }

    // ---------- the dependencies around a unit ----------

    /// The query a dependency runs to sign the caller in (`select(ApiKey).where(
    /// ApiKey.org_id == <the x-org-id header>, ...)`) scopes nothing the route does:
    /// a route under it that reads no tenant is a recorded absence, not `known
    /// tenancy_requested`.
    #[test]
    fn a_query_a_dependency_runs_is_not_the_routes_scope() {
        let mut lookup = func("get_key", 40, &[SELECT]);
        lookup.scoped_queries = vec![scoped("org_id", ScopeSource::Header)];
        let got = assigned(vec![
            module("svc/lookup.py", vec![lookup]),
            route(
                "under",
                "/under",
                &[USER, DB, "svc/lookup.py#get_key"],
                func("under", 10, &["svc/crud.py#load_settings"]),
            ),
        ]);
        assert_eq!(got, [("under".to_string(), "none".to_string(), String::new())]);
    }

    /// A dependency around the unit is read for what it checks: a class instance's
    /// `__call__`, or a function, that compares the tenant in the route and refuses is
    /// the unit's guard, whatever it is named. Its name alone proves nothing: a
    /// factory named for a tenant that only builds on a dependency that signs in is no
    /// guard.
    #[test]
    fn a_dependency_is_a_guard_by_what_it_checks() {
        let http = "pkg:fastapi#HTTPException";
        let mut call = member("__call__", &[http]);
        call.throws = vec![http.into()];
        call.body_checks = vec![BodyCheck {
            source: "param:self".into(),
            reads: ".required_role".into(),
            compares: String::new(),
            outcome: CheckOutcome::Forbidden,
            op: String::new(),
            conditional: false,
            condition: String::new(),
            unless: String::new(),
            compares_path: String::new(),
            after: vec![],
        }];
        call.raise_checks = vec![drift_core::RaiseCheck {
            source: "param:organization_id".into(),
            reads: String::new(),
            compares: drift_core::UNREAD_COMPARE.into(),
            raises: http.into(),
            status: 403,
            op: drift_core::check_op::REFUSES_MISMATCH.into(),
            conditional: false,
            condition: String::new(),
            unless: String::new(),
            after: vec![],
        }];
        let mut authorize = class("Authorize", vec![call]);
        authorize.controls = vec!["rejects_caller".into(), "throw".into()];
        let mut scope = func("check_scope", 20, &[FORBIDDEN]);
        scope.throws = vec![FORBIDDEN.into()];
        scope.raise_checks = vec![raise("param:org_id", "", "param:user")];
        // It rejects no one itself: it is built on the dependency that signs in.
        let mut factory = func("get_workspace_service", 30, &[RULES]);
        factory.wraps = vec![Wrap {
            wrapper: USER.into(),
            kind: WrapKind::Call,
        }];
        let guards = module("svc/guards.py", vec![authorize, scope, factory]);
        let under = |name: &str, wrapper: &str| {
            route(
                name,
                &format!("/orgs/{{org_id}}/{name}"),
                &[USER, DB, wrapper],
                func(name, 10, &["svc/crud.py#load_settings"]),
            )
        };
        let got = assigned(vec![
            guards,
            under("by_class", "svc/guards.py#Authorize"),
            under("by_function", "svc/guards.py#check_scope"),
            under("by_name", "svc/guards.py#get_workspace_service"),
        ]);
        assert_eq!(
            got,
            [
                (
                    "by_class".to_string(),
                    "known".to_string(),
                    "role_guard:svc/guards.py#Authorize+tenancy_guard:svc/guards.py#Authorize"
                        .to_string()
                ),
                (
                    "by_function".into(),
                    "known".into(),
                    "tenancy_guard:svc/guards.py#check_scope".into()
                ),
                // The tenant in the route, and nothing read enforces it.
                (
                    "by_name".into(),
                    "unknown:NotFollowed".into(),
                    "param:org_id".into()
                ),
            ]
        );
    }

    /// [STRICT]: a handler that hands a value to a call the facts did not record,
    /// under a wrapper that builds a service of the repository, may have called the
    /// service: the unit is unknown, not a none. This is how a lowering that records
    /// no receiver calls is read (TypeScript); the Python lowering records the call
    /// itself (`get_mailer().send`), which is followed or unread.
    #[test]
    fn an_injected_service_the_facts_cannot_follow_is_unread() {
        let factory = module(
            "svc/factories.py",
            vec![func("get_mailer", 3, &["svc/services.py#Mailer"])],
        );
        let mut calls_it = func("untyped", 10, &["svc/crud.py#load_settings"]);
        calls_it.controls = vec![drift_core::controls::UNREAD_CALL.into()];
        let unrecorded = |mut f: FileFacts| {
            f.lang = "ts".into();
            f
        };
        let got = assigned(vec![
            factory,
            unrecorded(route(
                "untyped",
                "/untyped",
                &[USER, DB, "svc/factories.py#get_mailer"],
                calls_it,
            )),
            // Every call of the body is in the facts: the service was not called.
            unrecorded(route(
                "unused",
                "/unused",
                &[USER, DB, "svc/factories.py#get_mailer"],
                func("unused", 10, &["svc/crud.py#load_settings"]),
            )),
        ]);
        assert_eq!(
            got,
            [
                ("untyped".to_string(), "unknown:BodyUnreadable".to_string(), "svc/services.py#Mailer".to_string()),
                ("unused".into(), "none".into(), String::new()),
            ]
        );
    }

    #[test]
    fn request_keys() {
        assert_eq!(
            request_key("/users/{user_id}/x").as_deref(),
            Some("user_id")
        );
        assert_eq!(
            request_key("/api/orgs/[orgId]/members/[memberId]").as_deref(),
            Some("orgId")
        );
        assert_eq!(
            request_key("/o/<int:owner_id>").as_deref(),
            Some("owner_id")
        );
        assert_eq!(
            request_key("/orgs/{org_id:int}/members").as_deref(),
            Some("org_id")
        );
        assert_eq!(request_key("/users/me"), None);
        assert_eq!(request_key("/items/:itemId"), None);
        for (class, forbids) in [
            ("svc/errors.py#ForbiddenError", true),
            ("pkg:django#core.exceptions.PermissionDenied", true),
            ("lib/errors.ts#AccessDeniedError(new)", true),
            ("lib/errors.ts#NotAuthorizedError", true),
            ("lib/errors.ts#UnauthorizedError", false),
            ("lib/errors.ts#NotAuthenticated", false),
            ("lib/errors.ts#ValidationError", false),
        ] {
            assert_eq!(
                crate::vocab::refuse::forbids_class(class),
                forbids,
                "{class}"
            );
        }
    }
}
