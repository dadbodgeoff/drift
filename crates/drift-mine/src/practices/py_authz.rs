//! Authorization at the guard positions of a Python route.
//!
//! A decorator, a dependency, a base class, a permission class, a hook or a
//! middleware of a route can check a role, a tenant or an owner as easily as a
//! sign-in. So what stands there is asked the same question twice, by the one
//! reading of [`crate::py_guards`]: whether it signs the caller in (authentication),
//! and what it decides of a caller who is signed in ([`positions`]):
//!
//! - a library's guard on the closed list of those that check a role, a permission
//!   or a scope, in a call shape that makes it check one, is a role guard;
//! - a library's guard that only signs the caller in, and a thing a closed list
//!   says never authenticates, change nothing;
//! - a function or class of the repository is read from its body, where the
//!   practice map follows it;
//! - anything that reading could not read (a package on no list, a value that is
//!   not followed, a body that is not read to the end) leaves the route's
//!   authorization unknown, unless a check proven elsewhere on the route makes it
//!   known: never `none`.
//!
//! Read by the practice map only ([`crate::context::RepoContext::since_measured`]).

use drift_core::{Symbol, WrapKind};

use super::authn::Reading;
use super::{Cx, UnitRef, UnknownReason, common};
use crate::py_guards::{self, Verdict};
use crate::security::{self, TestAsks};

/// What the guard positions of one Python entry unit say of its authorization.
#[derive(Default)]
pub(super) struct Positions {
    /// The role guards proven where they stand, by the closed lists
    /// ([`py_guards::authorizes`]) or by a test Django runs that asks a role.
    pub roles: Vec<String>,
    /// Guards that sign the caller in by a test read to ask no role
    /// (`UserPassesTestMixin` with `test_func` returning `is_active`): the name of
    /// the wrapper says "test", not "role".
    pub no_role: Vec<String>,
    /// The first thing at a guard position that was not read.
    pub unread: Option<(UnknownReason, String)>,
    /// The functions and classes of the repository that stand at a guard position
    /// the practice map did not follow before ([`py_guards::repo_thing`]): a
    /// decorator of the view, also under another name or as what a factory hands
    /// back, and a hook of the application. Each is read as a dependency around
    /// the unit is, for what its body checks.
    pub bodies: Vec<String>,
}

impl Positions {
    fn unread(&mut self, reason: UnknownReason, instrument: &str) {
        let u = (reason, instrument.to_string());
        if self.unread.as_ref().is_none_or(|v| u < *v) {
            self.unread = Some(u);
        }
    }
}

/// Reads every guard position of the Python entry unit `unit` (`s`, of the classes
/// `classes`) for authorization. `reading` is what authentication read of the same
/// positions.
pub(super) fn positions<'a>(
    cx: &Cx<'a>,
    unit: &UnitRef<'a>,
    adapter: &str,
    s: &'a Symbol,
    classes: &[&'a Symbol],
    reading: &Reading,
) -> Positions {
    let ctx = cx.context();
    let mut out = Positions::default();
    let holders: Vec<&Symbol> = std::iter::once(s).chain(classes.iter().copied()).collect();
    let view: Vec<&Symbol> = classes
        .first()
        .copied()
        .or((s.kind == drift_core::SymbolKind::Class).then_some(s))
        .into_iter()
        .collect();
    // The wrappers this reading read to the end.
    let mut read: Vec<String> = Vec::new();
    let around = unit
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .chain(classes.iter().flat_map(|c| &c.wraps));
    for w in around {
        if common::declared(cx, super::AUTHZ, &w.wrapper).is_some() {
            continue;
        }
        let name = crate::mine::norm_ref(&w.wrapper).into_owned();
        // A test Django runs before the view: by what the test asks.
        if let Some(asks) = security::django_test_asks(ctx, w, s, &view) {
            match asks {
                TestAsks::Role => {
                    read.push(name.clone());
                    out.roles.push(name);
                }
                TestAsks::Status => {
                    read.push(name.clone());
                    out.no_role.push(name);
                }
                TestAsks::Unread => {
                    out.no_role.push(name.clone());
                    out.unread(UnknownReason::Unresolved, &name);
                }
            }
            continue;
        }
        // A base of the repository whose `dispatch` never runs for the view
        // ([`base_runs`]) checks nothing of its requests.
        let idle_base = w.kind == WrapKind::Extends
            && matches!(adapter, "django" | "drf")
            && py_guards::repo_thing(ctx, &w.wrapper)
                .is_some_and(|b| !view.first().is_some_and(|v| base_runs(cx, v, &b)));
        match py_guards::Position::of(w.kind, adapter) {
            Some(at) => match py_guards::authorizes(ctx, at, &w.wrapper, &holders) {
                Verdict::Guard(_) if idle_base => read.push(name),
                Verdict::Guard(instrument) => out.roles.push(instrument),
                verdict => {
                    // One of the repository is read from its body, also where
                    // that was not read to the end: what it is proven to check
                    // counts, what it leaves unread keeps the route from `none`.
                    // (A base of a Django view runs through its `dispatch` only
                    // where nothing before it in the order Python looks methods up
                    // in may define one that does not hand on: `Late(LoginRequired
                    // Mixin, View, FeatureMixin)` runs `View.dispatch`.)
                    if let Some(body) = py_guards::repo_thing(ctx, &w.wrapper)
                        && !out.bodies.contains(&body)
                        && !idle_base
                    {
                        out.bodies.push(body);
                    }
                    match verdict {
                        Verdict::Unknown(reason) => out.unread(reason, &name),
                        _ => read.push(name),
                    }
                }
            },
            // A base of a Django or DRF view that is, or is built on, a package's
            // class no list knows: what its `dispatch` does is not read.
            None if w.kind == WrapKind::Extends && matches!(adapter, "django" | "drf") => {
                if let Some(Verdict::Unknown(reason)) = py_guards::unknown_base(ctx, &w.wrapper) {
                    out.unread(reason, &name);
                }
            }
            None => {}
        }
    }
    // A mixin of Django's that checks a permission, among the bases of the view or
    // of a class of the repository it is built on, where it runs.
    if matches!(adapter, "django" | "drf")
        && let Some(view) = view.first()
    {
        let (roles, not_proven) = security::role_bases(ctx, view, &py_guards::base_authorizes);
        if not_proven {
            out.unread(UnknownReason::Unresolved, common::short(&view.name));
        }
        out.roles.extend(roles);
    }
    // A middleware of the repository: what its body does not read (a package's
    // function no list knows) may refuse a caller as a check of its own would.
    for m in s.app_middleware.iter().chain(unit.mount_middleware()) {
        let m = m.trim_start_matches('?');
        if common::external(m) || m.starts_with(drift_core::NEST_GUARD) {
            continue;
        }
        if let Verdict::Unknown(reason) =
            py_guards::authorizes(ctx, py_guards::Position::Hook, m, &holders)
        {
            out.unread(reason, &crate::mine::norm_ref(m));
        }
    }
    // What authentication could not tell of a position or of a call in a body (a
    // middleware of a package on no list, a mount whose additions are not read, a
    // hook that answers some requests only, a package's function called for what
    // it raises): it is as little read for what it does with a signed-in caller.
    // Not what this reading read to the end itself: a test of the account's state
    // (`is_active`) that authentication cannot tell for a caller who is not signed
    // in asks no role of one who is.
    if let Some((reason, instrument)) = reading.undecided()
        && !read
            .iter()
            .any(|r| *r == crate::mine::norm_ref(instrument).as_ref())
    {
        out.unread(*reason, instrument);
    }
    out.roles.sort();
    out.roles.dedup();
    out
}

/// The base `base` (canonical) of the Django view class `view` runs for a request:
/// in the order Python looks `dispatch` up in, every class before it is one of the
/// repository with no `dispatch` of its own, or a package's that defines none or
/// hands on (the closed list of [`crate::security::package_may_define`]). Not where
/// the order cannot be worked out, or the base is not in it.
pub(super) fn base_runs(cx: &Cx<'_>, view: &Symbol, base: &str) -> bool {
    let ctx = cx.context();
    let Some(order) = crate::security::class_order(ctx, "", view) else {
        return false;
    };
    let Some(at) = order
        .iter()
        .position(|c| matches!(c, crate::security::Mro::Repo(r, _) if r == base))
    else {
        return false;
    };
    order[..at].iter().all(|c| match c {
        crate::security::Mro::Repo(_, d) => !d.members.iter().any(|m| m.name == "dispatch"),
        crate::security::Mro::Package(p) => !crate::security::package_may_define(p, "dispatch"),
    })
}
