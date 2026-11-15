//! Authentication (PLAN-R13 §1.1): how each production entry point turns away callers
//! who are not signed in. Population: request entry points (`http`, `server_action`,
//! `graphql`, `rpc`, `job`), handlers followed through re-exports.
//!
//! Instruments, each kept only where the security helpers say it rejects:
//! - wrappers, decorators, bases, FastAPI dependencies, settings and app hooks that
//!   [`security::authenticates`];
//! - Nest guards: `@UseGuards(G)` through `decorator_args` (`UseGuards=<G>`, on the
//!   handler or its controller), `APP_GUARD=<G>` on a module class of the package and
//!   what `app.useGlobalGuards(new G())` registers (`app_guard`); a decorator of the
//!   route that sets metadata opens it to a guard class only where that guard is
//!   read to let the route through for it ([`security::nest_opt_out`]), and where
//!   that is not read the guard is found, not proven;
//! - in-body checks (`body_checks` that answer 401 or redirect to sign-in);
//! - in-body guard calls that [`security::body_call`] reads as a guard (by what they
//!   do, never by name: the one rule `drift security` lists a ` (body call)` by);
//! - the Next.js middleware, for the routes its matchers provably cover (no
//!   `config.matcher`: every route; `patterns: []`: unknown).
//!
//! A unit's key is all of them together, so a middleware plus an in-body check is one
//! key; the engine folds split policies across units. Besides enforcing uses:
//! `identifies` (a session read with no check, DRF `authentication_classes`: identified,
//! not enforced; dropped when something enforces), `opens` (declared public: `AllowAny`,
//! a `SetMetadata` decorator such as `@Public()`, a middleware's public list; or, when
//! nothing else was found, a liveness or readiness probe: [`PROBE`]) and
//! `service_auth` (a signature verifier, or any check against an env-derived secret:
//! a service caller, not a user; never folded with user authn).
//!
//! Unknown [STRICT]: an in-repo wrapper or guard with no definition, `@UseGuards` with
//! no recorded guard (`opaque_wrapper`); an unresolved wrapper, a middleware whose
//! matchers cannot be read or whose lists cannot be told apart (`unresolved`); a
//! wrapper from an auth library no table knows, a call that only its name says guards,
//! a body call that looks like a guard and is not proven to reject
//! ([`security::BodyCall::Unproven`]; `unclassified`). None: nothing guards, identifies
//! or opens it, and nothing is unknown.

use drift_core::{CheckOutcome, FileFacts, RouteMatcher, Symbol, WrapKind};

use super::common::{
    self, PARAM_CALLEE, REQUEST_KINDS, canonical, declared, external, in_skipped, owning_classes,
    unit_symbol, unknown, unreadable, use_of,
};
use super::libraries::{
    NOT_AUTH_GUARD_LIBRARIES, NOT_AUTH_GUARD_NAMES, PUBLIC_DECORATOR_NAMES, ROLE_GUARD_CALLEES,
    SIGNED_IN_ONLY_CALLEES, authn_callee, key_words, names_role, probe_path, signature_callee,
    verifier_callee,
};
use super::{Assignment, Concern, Cx, UnitRef, UnknownReason, Use, VariantSource};
use crate::security;

pub struct Authn;

/// What stands for a 401 a body answers where no check records why
/// ([`security::answers_401_unrecorded`]).
pub const ANSWERS_401: &str = "answers 401";

/// What an entry point does for authentication, read once and shared with `authz` and
/// `testing`.
#[derive(Debug, Clone, Default)]
pub struct Reading {
    pub uses: Vec<Use>,
    pub sources: Vec<VariantSource>,
    /// The first reason (in sort order) the unit cannot be told.
    pub unknown: Option<(UnknownReason, String)>,
    /// Guards that check a role or permission (`RolesGuard`, `adminProcedure`,
    /// `permission_required`): read by `authz`.
    pub role_guards: Vec<String>,
    /// An awaited body calls a function whose body is not read (an unresolved import,
    /// an in-repo callee the facts do not define): it may be the auth step, so nothing
    /// found is unknown, not none. Reads of the request (`await req.text()`), the
    /// runtime's helpers and known libraries never count.
    unread_call: Option<String>,
    /// A body of the unit's own (its handler, what it hands itself to) calls a
    /// package's method through a typed parameter, unread only because the body also
    /// hands a value to a call the facts do not record, which may be the auth step: the
    /// unit's handler, the function a person reads ([`UnknownReason::PartlyRead`]).
    /// Decides only where no [`Reading::unread_call`] does.
    partly: Option<String>,
    /// The first unknown from a body call ([`Reading::call_unknown`]).
    call_unknown: Option<(UnknownReason, String)>,
    /// Guards that only check a role (`RoleChecker`, `RolesGuard`): authz's, and the
    /// authn instrument only when nothing else signs the caller in.
    role_only: Vec<(String, String, VariantSource)>,
    /// A guard was found at a guard position and is not proven to be one for every
    /// request ([`Reading::position`]): the unit is unknown, and `authz` still asks
    /// what a signed-in caller may do there.
    pub found_guard: bool,
}

impl Reading {
    fn add(&mut self, mechanism: &str, instrument: &str, source: VariantSource) {
        self.uses.push(use_of(mechanism, instrument));
        self.sources.push(source);
    }

    /// An unknown from a call in a body: it cannot be told whether the call guards,
    /// so it decides only a unit nothing proven signs in.
    fn call_unknown(&mut self, reason: UnknownReason, instrument: &str) {
        let u = (reason, instrument.to_string());
        if self.call_unknown.as_ref().is_none_or(|v| u < *v) {
            self.call_unknown = Some(u);
        }
    }

    fn unknown(&mut self, reason: UnknownReason, instrument: &str) {
        let u = (reason, instrument.to_string());
        if self.unknown.as_ref().is_none_or(|v| u < *v) {
            self.unknown = Some(u);
        }
    }

    /// Takes what `own` holds: the reading of one instrument, made apart.
    fn absorb(&mut self, own: Reading) {
        for (u, source) in own.uses.into_iter().zip(own.sources) {
            if !self.uses.contains(&u) {
                self.uses.push(u);
                self.sources.push(source);
            }
        }
        if let Some((reason, instrument)) = own.unknown {
            self.unknown(reason, &instrument);
        }
        if let Some((reason, instrument)) = own.call_unknown {
            self.call_unknown(reason, &instrument);
        }
        if let Some(c) = own.unread_call
            && self.unread_call.as_ref().is_none_or(|x| c < *x)
        {
            self.unread_call = Some(c);
        }
        if let Some(c) = own.partly
            && self.partly.as_ref().is_none_or(|x| c < *x)
        {
            self.partly = Some(c);
        }
        self.role_guards.extend(own.role_guards);
        self.role_only.extend(own.role_only);
        self.found_guard |= own.found_guard;
    }

    /// Settles one instrument at a guard position: `own` is what the wrapper's own
    /// reading found, `verdict` what the position's reading
    /// ([`crate::guard_position`]) proves. A guard is kept only where the position
    /// proves it, with the uses its own reading names it by; what the position
    /// cannot tell is unknown, whatever its own reading found; and nothing is
    /// nothing only where the position read it so.
    fn position(&mut self, verdict: crate::guard_position::Verdict, own: Reading, w: &str) {
        use crate::guard_position::Verdict;
        let signs_in = own.signs_in() || !own.role_only.is_empty();
        let undecided =
            own.unknown.is_some()
            || own.call_unknown.is_some()
            || own.unread_call.is_some()
            || own.partly.is_some();
        match verdict {
            Verdict::Guard(_) if signs_in => self.absorb(own),
            Verdict::Guard(instrument) => {
                self.role_guards.extend(own.role_guards);
                self.add("wrap", &instrument, source(&instrument));
            }
            // What its own reading could not tell stays as it said it.
            Verdict::Unknown(_) if undecided && !signs_in => self.absorb(own),
            Verdict::Unknown(reason) => {
                self.found_guard |= signs_in;
                self.role_guards.extend(own.role_guards);
                self.call_unknown(reason, w);
            }
            Verdict::Nothing if signs_in || undecided => {
                self.role_guards.extend(own.role_guards);
            }
            // Identified, opened, or a role marker: as its own reading says.
            Verdict::Nothing => self.absorb(own),
        }
    }

    /// What stands at a guard position of the unit, or is called in its body, and
    /// could not be told to be a guard or nothing ([`Reading::call_unknown`]): it
    /// decides authentication only where nothing proven signs the caller in, and
    /// what it does with a caller who is signed in is as little read.
    pub fn undecided(&self) -> Option<&(UnknownReason, String)> {
        self.call_unknown.as_ref()
    }

    /// Something guards the unit, other than an explicit public marker or a signature
    /// check (which proves the sender, not a signed-in caller).
    pub fn signs_in(&self) -> bool {
        self.uses.iter().any(|u| enforces(&u.mechanism))
    }

    /// Nothing guards, identifies or opens the unit, and nothing about it is unknown:
    /// what [`Reading::assignment`] records as none.
    fn found_nothing(&self) -> bool {
        self.uses.is_empty()
            && self.unknown.is_none()
            && self.call_unknown.is_none()
            && self.unread_call.is_none()
            && self.partly.is_none()
    }

    /// Drops `identifies` uses when something enforces: identified and enforced is
    /// enforced.
    fn settle(&mut self) {
        if !self.signs_in() {
            for (m, i, src) in std::mem::take(&mut self.role_only) {
                self.add(&m, &i, src);
            }
        }
        if self.signs_in() {
            let uses = std::mem::take(&mut self.uses);
            let sources = std::mem::take(&mut self.sources);
            (self.uses, self.sources) = uses
                .into_iter()
                .zip(sources)
                .filter(|(u, _)| u.mechanism != IDENTIFIES)
                .unzip();
        }
        self.role_guards.sort();
        self.role_guards.dedup();
    }

    pub fn assignment(&self) -> Assignment {
        if let Some((reason, instrument)) = &self.unknown {
            return unknown(*reason, instrument);
        }
        if !self.signs_in() {
            // Nothing proven signs the caller in: a call that may be the guard decides.
            if let Some((reason, instrument)) = &self.call_unknown {
                return unknown(*reason, instrument);
            }
        }
        if self.uses.is_empty() {
            if let Some(c) = &self.unread_call {
                return unknown(UnknownReason::BodyUnreadable, c);
            }
            if let Some(h) = &self.partly {
                return unknown(UnknownReason::PartlyRead, h);
            }
            return Assignment::None {
                label: super::basis::AUTHN_NONE.into(),
            };
        }
        common::known(self.uses.clone(), common::source_of(&self.sources))
    }
}

/// Identified but not enforced: a session read with no check on what it returns, DRF
/// `authentication_classes`.
pub const IDENTIFIES: &str = "identifies";
/// The state of a unit whose every use [`IDENTIFIES`]: the caller is identified and
/// no one is turned away (`identified`, apart from `known`). Its key keeps the
/// mechanism and the instrument (`identifies:pkg:rest_framework#authentication.SessionAuthentication`),
/// so its P- id is the one it had.
pub const IDENTIFIED: &str = "identified";

/// Every use identifies the caller and none turns anyone away: the unit is
/// [`IDENTIFIED`], not known. (A use that enforces drops the `identifies` ones:
/// [`Reading::settle`].)
pub fn identified_only(uses: &[Use]) -> bool {
    !uses.is_empty() && uses.iter().all(|u| u.mechanism == IDENTIFIES)
}

/// Explicitly public (`AllowAny`, `@Public()`, a middleware's public list).
pub const OPENS: &str = "opens";
/// Service-to-service auth (a webhook verifier): a caller class of its own.
pub const SERVICE_AUTH: &str = "service_auth";
/// The instrument of an [`OPENS`] use that no decorator or list declares: the route is a
/// liveness or readiness probe ([`is_probe`]), public because an orchestrator with no
/// credentials has to reach it.
pub const PROBE: &str = "probe";

/// A use that turns away a caller who is not signed in.
pub fn enforces(mechanism: &str) -> bool {
    !matches!(mechanism, IDENTIFIES | OPENS | SERVICE_AUTH)
}

/// How the practice map reads the authentication of one entry point: what `drift
/// security` settles a Python row by, so the two say one thing of a route.
pub(crate) fn of_entry<'a>(
    cx: &Cx<'a>,
    file: &'a FileFacts,
    entry: &'a drift_core::EntryPoint,
) -> Assignment {
    Authn.assign(
        cx,
        &UnitRef::Entry {
            file,
            entry,
            symbol: common::handler(cx.facts, file, &entry.symbol).map(|(_, s)| s),
        },
    )
}

impl Concern for Authn {
    fn id(&self) -> &'static str {
        super::AUTHN
    }

    fn unit(&self) -> &'static str {
        "entry_point"
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        common::entries(cx, REQUEST_KINDS)
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        if let Some(a) = unreadable(cx, unit) {
            return a;
        }
        if let Some((f, s)) = unit_symbol(cx, unit)
            && let Some(a) = common::truncated(f, s, &["body_checks"])
        {
            return a;
        }
        read(cx, unit).assignment()
    }

    fn basis<'a>(
        &self,
        cx: &Cx<'a>,
        unit: &UnitRef<'a>,
        _backing: &super::Backing,
    ) -> Option<super::basis::Basis> {
        Some(super::basis::of_entry(cx, unit))
    }
}

/// How an entry unit authenticates (the unit must be readable: [`unreadable`]).
pub fn read<'a>(cx: &Cx<'a>, unit: &UnitRef<'a>) -> Reading {
    let mut r = Reading::default();
    let (UnitRef::Entry { file, entry, .. }, Some((sfile, s))) = (*unit, unit_symbol(cx, unit))
    else {
        r.unknown(UnknownReason::NoSymbol, "");
        return r;
    };
    let classes = owning_classes(sfile, s);
    // Nest `@UseGuards(G)` on the handler or its controller: `decorator_args`.
    let guards: Vec<&str> = s
        .decorator_args
        .iter()
        .chain(classes.iter().flat_map(|c| &c.decorator_args))
        .filter_map(|a| a.split_once('='))
        .filter(|(d, _)| crate::mine::norm_ref(d) == USE_GUARDS)
        .map(|(_, g)| g)
        .collect();
    let py = sfile.lang == "py";
    // FastAPI runs every dependency of a route before its handler, and one that
    // answers refuses: none can serve the request before another has run.
    let dependencies = py && entry.adapter == "fastapi";
    // What the unit's own mount adds could not be read [STRICT]: never another
    // mount's guards, never none. What a FastAPI mount adds are dependencies: beside
    // a proven guard they change nothing.
    if unit.mount().is_some_and(|m| m.opaque) {
        if dependencies {
            r.call_unknown(UnknownReason::Unresolved, "");
        } else {
            r.unknown(UnknownReason::Unresolved, "");
        }
    }
    // Whether the guard among a Django view class's bases runs.
    // The view class: the one the handler is a method of, or the handler itself.
    let view: Vec<&Symbol> = classes
        .first()
        .copied()
        .or((s.kind == drift_core::SymbolKind::Class).then_some(s))
        .into_iter()
        .collect();
    let base_order = (py && matches!(entry.adapter.as_str(), "django" | "drf"))
        .then(|| view.first())
        .flatten()
        .and_then(|view| security::base_guard_runs(cx.context(), view));
    let around = unit
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .chain(classes.iter().flat_map(|c| &c.wraps));
    for w in around {
        let hook = w.kind == WrapKind::AppHook
            || (w.kind == WrapKind::Call && entry.adapter.starts_with("flask"));
        // [STRICT]: a hook that answers "not signed in" for some requests only may
        // be the guard of this route, and is not proven to be.
        if hook && security::hook_for_some_requests(cx.context(), &w.wrapper) {
            r.call_unknown(UnknownReason::Unresolved, &w.wrapper);
            continue;
        }
        // [STRICT] A DRF permission class of the repository is read from its own
        // `has_permission`, never through its base: no guard where that is `True`,
        // unknown where it is not read.
        if matches!(w.kind, WrapKind::Call | WrapKind::Config)
            && let Some(own) = security::repo_permission(cx.context(), &w.wrapper)
        {
            match own {
                security::Proof::NotAGuard => {
                    r.add(OPENS, &w.wrapper, source(&w.wrapper));
                    continue;
                }
                security::Proof::Unreadable => {
                    r.call_unknown(UnknownReason::Unresolved, &w.wrapper);
                    continue;
                }
                // The class is the instrument, not the library class it is built on.
                security::Proof::Guard => {
                    let mechanism = match w.kind {
                        WrapKind::Config => "config",
                        _ => "dependency",
                    };
                    r.add(
                        mechanism,
                        &crate::mine::norm_ref(&w.wrapper),
                        VariantSource::Usage,
                    );
                    continue;
                }
            }
        }
        // A DRF permission class that lets a request that only reads through for
        // anyone (`IsAuthenticatedOrReadOnly`): it opens a read, guards a write, and
        // of an entry point listed for every method it does neither. An in-repo
        // class built on one that decides for itself is not read.
        if matches!(w.kind, WrapKind::Call | WrapKind::Config)
            && let Some(safe) = security::safe_methods(cx.context(), &w.wrapper)
        {
            let reads = match safe {
                security::SafeMethods::Open => security::reads_only(entry.method.as_deref()),
                security::SafeMethods::Unread => None,
            };
            match reads {
                Some(true) => {
                    r.add(OPENS, &w.wrapper, source(&w.wrapper));
                    continue;
                }
                None => {
                    r.call_unknown(UnknownReason::Unresolved, &w.wrapper);
                    continue;
                }
                Some(false) => {}
            }
        }
        // [STRICT] A Django view's guard among its bases runs only where it comes
        // before the first base that defines `dispatch`: after a view class it is
        // no guard, and where what comes before it is not read it may be one.
        if w.kind == WrapKind::Extends && security::authenticates(cx.context(), &w.wrapper) {
            match base_order {
                Some(security::Proof::NotAGuard) => continue,
                Some(security::Proof::Unreadable) => {
                    r.call_unknown(UnknownReason::Unresolved, &w.wrapper);
                    continue;
                }
                Some(security::Proof::Guard) | None => {}
            }
        }
        // [STRICT] Django's `user_passes_test` and `UserPassesTestMixin` guard by
        // the test they are given: none where it is `True`, unknown where it is
        // not read.
        let tested = security::django_test(cx.context(), w, s, &view);
        match tested {
            Some(security::Proof::NotAGuard) => continue,
            Some(security::Proof::Unreadable) => {
                r.call_unknown(UnknownReason::Unresolved, &w.wrapper);
                continue;
            }
            Some(security::Proof::Guard) | None => {}
        }
        // [STRICT] Python: a wrapper that could not be read beside a proven guard.
        // It cannot remove the guard; it may answer before the guard runs (a cache
        // around the view). Where it cannot (a FastAPI dependency; a decorator or a
        // base inside a guard that is proven, the wraps being outermost first) the
        // guard decides and the unit is known; where it may (outside the guard, a
        // hook) the unit stays unknown.
        let behind_the_guard = py
            && !hook
            && match w.kind {
                WrapKind::Call => dependencies,
                WrapKind::Decorator | WrapKind::Extends => r.signs_in(),
                _ => false,
            };
        let before = r.unknown.clone();
        // [STRICT] TypeScript: what stands where a guard goes is the guard or
        // nothing only on proof; unknown is the default
        // ([`crate::guard_position`], the reading `drift security` takes too).
        if w.kind == WrapKind::Call
            && crate::guard_position::applies(sfile)
            && declared(cx, super::AUTHN, &w.wrapper).is_none()
        {
            let mut own = Reading::default();
            wrap(cx, sfile, &w.wrapper, w.kind, &guards, None, &mut own);
            r.position(crate::guard_position::read(cx, sfile, s, &w.wrapper), own, &w.wrapper);
            continue;
        }
        // Python: what stands at the position is read in one place
        // ([`crate::py_guards::classify`]), unknown unless proven otherwise.
        let verdict = py
            .then(|| crate::py_guards::Position::of(w.kind, &entry.adapter))
            .flatten()
            .map(|at| {
                // A test Django runs before the view was read above, by the test.
                if tested == Some(security::Proof::Guard) {
                    return crate::py_guards::Verdict::Guard(
                        crate::mine::norm_ref(&w.wrapper).into_owned(),
                    );
                }
                let holders: Vec<&Symbol> =
                    std::iter::once(s).chain(classes.iter().copied()).collect();
                crate::py_guards::classify(cx.context(), at, &w.wrapper, &holders)
            });
        // A base of a Django or DRF view that is, or is built on, a package's
        // class no list knows: its `dispatch` is not read.
        let verdict = match verdict {
            None if py
                && w.kind == WrapKind::Extends
                && matches!(entry.adapter.as_str(), "django" | "drf")
                && tested != Some(security::Proof::Guard) =>
            {
                crate::py_guards::unknown_base(cx.context(), &w.wrapper)
            }
            v => v,
        };
        wrap(cx, sfile, &w.wrapper, w.kind, &guards, verdict, &mut r);
        if behind_the_guard
            && r.unknown != before
            && let Some((reason, instrument)) = std::mem::replace(&mut r.unknown, before)
        {
            r.call_unknown(reason, &instrument);
        }
        // [STRICT]: a decorator that is a name bound to a list
        // (`@method_decorator(decorators, name="dispatch")` with `decorators =
        // [never_cache, login_required]`) is not read: what the list holds may be
        // the guard.
        // (Python: a name is read by what it is bound to, where it stands:
        // [`crate::py_guards::classify`].)
        if w.kind == WrapKind::Decorator
            && !py
            && !external(&w.wrapper)
            && cx.context().definition(&w.wrapper).is_some_and(|d| {
                matches!(
                    d.kind,
                    drift_core::SymbolKind::Const | drift_core::SymbolKind::Variable
                ) && d.name == common::short(&w.wrapper)
                    && d.calls.is_empty()
            })
        {
            r.call_unknown(UnknownReason::Unresolved, &w.wrapper);
        }
    }
    // Django's `LoginRequiredMiddleware` (or a subclass of the repository) in
    // `MIDDLEWARE` redirects every request that is not signed in, except a view
    // marked `login_not_required`.
    let around: Vec<&drift_core::Wrap> = unit
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .chain(classes.iter().flat_map(|c| &c.wraps))
        .collect();
    if let Some(login) = around.iter().find(|w| {
        w.kind == WrapKind::Config && {
            let n = crate::mine::norm_ref(&w.wrapper);
            n == LOGIN_MIDDLEWARE
                || cx
                    .context()
                    .ancestors(&n)
                    .iter()
                    .any(|a| crate::mine::norm_ref(a) == LOGIN_MIDDLEWARE)
        }
    }) {
        match around
            .iter()
            .find(|w| common::short(&w.wrapper).ends_with("login_not_required"))
        {
            Some(open) => r.add(OPENS, &open.wrapper, VariantSource::Vocab),
            None => r.add("middleware", &login.wrapper, VariantSource::Vocab),
        }
    }
    // [STRICT]: what a view class runs around every handler and the facts do not
    // hold: Flask's `decorators = [login_required]` on a `MethodView`, and a
    // `dispatch` the class decorates (`@method_decorator([...])` on `dispatch`).
    // Either may be the guard.
    for c in &classes {
        for d in &c.declares {
            let Some((name, value)) = d.split_once('=') else {
                continue;
            };
            // (The list of a Flask view class is read where it is written: its
            // elements are the class's decorators.)
            let flask_view = c.wraps.iter().any(|w| {
                w.kind == WrapKind::Extends
                    && ["pkg:flask#", "pkg:flask_restful#", "pkg:flask_restx#", "pkg:flask_smorest#"]
                        .iter()
                        .any(|p| w.wrapper.starts_with(p))
            });
            if (name == "decorators" && !flask_view) || (name == "dispatch" && !value.is_empty()) {
                r.call_unknown(
                    UnknownReason::Unresolved,
                    &format!("{}#{}.{name}", sfile.path, c.name),
                );
            }
        }
    }
    // What the decorators on a Nest route change for a guard class that runs for
    // it: the handler's, and those of its controller class.
    let decorators =
        security::route_decorators(unit.mount_wraps().iter().chain(&s.wraps), s, &classes);
    let position = Position {
        package: &sfile.package,
        calls: sfile.guard_calls_of(s),
    };
    for g in &guards {
        route_guard(cx, false, true, g, &decorators, &position, &mut r);
    }
    if entry.adapter == "nestjs" {
        app_guards(cx, sfile, &decorators, &position, &mut r);
    }
    let wraps: std::collections::BTreeSet<String> = unit
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
        .collect();
    for b in common::bodies(cx, s) {
        let request = REQUEST_KINDS.contains(&entry.kind.as_str());
        body(cx, b, py, request, &wraps, &mut r);
        // A Python handler runs what it calls whether it awaits it or not.
        if py || b.controls.iter().any(|c| c == "await") {
            let (unread, of_parameter) = unread_call(cx, b);
            if let Some(c) = unread
                && r.unread_call.as_ref().is_none_or(|x| c < *x)
            {
                r.unread_call = Some(c);
            }
            if of_parameter {
                r.partly = Some(canonical(sfile, s));
            }
        }
    }
    // [STRICT] TypeScript: a handler that is the value a call built (`export const {
    // GET, POST } = initApiPassthrough({ ... })`, `export const GET = handle(app)`)
    // or a binding that names no function has no body in the facts: what runs for
    // the request was not read, so nothing found is unknown, never none.
    if crate::guard_position::applies(sfile)
        && matches!(
            s.kind,
            drift_core::SymbolKind::Const | drift_core::SymbolKind::Variable
        )
        && s.wraps.is_empty()
        && !s.calls.iter().any(|c| c.ends_with("(ref)"))
        && r.unread_call.is_none()
    {
        r.unread_call = Some(
            s.calls
                .iter()
                .find(|c| !c.starts_with("global#"))
                .map_or_else(|| canonical(sfile, s), |c| crate::mine::norm_ref(c).into_owned()),
        );
    }
    if let Some(route) = &entry.route {
        middleware(cx, file, route, &mut r);
    }
    for m in s.app_middleware.iter().chain(unit.mount_middleware()) {
        // A guard class `useGlobalGuards` registers for the whole Nest application.
        if let Some((g, every)) = security::global_guard_entry(m) {
            route_guard(cx, true, every, g, &decorators, &position, &mut r);
            continue;
        }
        // TypeScript: one that is a wrap of the route too (a list of guards spread
        // where a router is mounted) is read once, as the wrap.
        if crate::guard_position::applies(sfile)
            && wraps.contains(crate::mine::norm_ref(m.trim_start_matches('?')).as_ref())
        {
            continue;
        }
        match read_route_middleware(cx, sfile, s, m) {
            AppMiddleware::Guard(m, source) => r.add("middleware", &m, source),
            AppMiddleware::MayGuard(reason, m) => r.call_unknown(reason, m),
            AppMiddleware::NoGuard => {}
        }
    }
    r.settle();
    if r.found_nothing() && is_probe(cx, entry, s) {
        r.add(OPENS, PROBE, VariantSource::Vocab);
    }
    r
}

/// `instrument` is a guard of the Python entry unit `unit` by the reading made
/// where it stands ([`crate::py_guards`]): the proof of something at one of the
/// unit's guard positions, or a library's guard one of its bodies calls in a shape
/// the closed list knows. What the engine's guard filter asks beside
/// [`security::authenticates`], which reads an instrument alone.
pub(crate) fn proven_in_place<'a>(cx: &Cx<'a>, unit: &UnitRef<'a>, instrument: &str) -> bool {
    let (UnitRef::Entry { entry, .. }, Some((sfile, s))) = (*unit, unit_symbol(cx, unit)) else {
        return false;
    };
    if sfile.lang != "py" {
        return false;
    }
    let ctx = cx.context();
    let classes = owning_classes(sfile, s);
    let holders: Vec<&Symbol> = std::iter::once(s).chain(classes.iter().copied()).collect();
    let at_a_position = unit
        .mount_wraps()
        .iter()
        .chain(&s.wraps)
        .chain(classes.iter().flat_map(|c| &c.wraps))
        .any(|w| {
            crate::py_guards::Position::of(w.kind, &entry.adapter).is_some_and(|at| {
                match crate::py_guards::classify(ctx, at, &w.wrapper, &holders) {
                    crate::py_guards::Verdict::Guard(root) => {
                        root == instrument || crate::mine::norm_ref(&w.wrapper) == instrument
                    }
                    _ => false,
                }
            })
        });
    at_a_position
        || common::bodies(cx, s).iter().any(|b| {
            b.calls.iter().any(|c| {
                crate::mine::norm_ref(c) == instrument && crate::py_guards::called_guard(b, c)
            })
        })
}

/// A liveness or readiness probe: a `GET` (or `HEAD`) route whose path is a well-known
/// probe path ([`probe_path`]: exactly, or under a mount prefix) and whose handler, with
/// every body it runs, provably reads no request input
/// ([`drift_core::controls::NO_INPUT`]). The path and the absence of input are the
/// proof; the handler's name is never read. With no input read, a parameter in the
/// prefix (`/{service}/health`) changes nothing the handler does.
fn is_probe<'a>(cx: &Cx<'a>, entry: &drift_core::EntryPoint, s: &'a Symbol) -> bool {
    entry.kind == "http"
        && matches!(entry.method.as_deref(), Some("GET" | "HEAD"))
        && entry.route.as_deref().is_some_and(probe_path)
        && common::bodies(cx, s).iter().all(|b| {
            b.controls
                .iter()
                .any(|c| c == drift_core::controls::NO_INPUT)
        })
}

/// Django 5.1's middleware that requires a signed-in user for every view.
const LOGIN_MIDDLEWARE: &str = "pkg:django#contrib.auth.middleware.LoginRequiredMiddleware";
const USE_GUARDS: &str = "pkg:@nestjs/common#UseGuards";
const SET_METADATA: &str = "pkg:@nestjs/common#SetMetadata";
const APPLY_DECORATORS: &str = "pkg:@nestjs/common#applyDecorators";

/// A metadata decorator named for a public route (`Public`, `AllowAnonymous`).
fn names_public(w: &str) -> bool {
    key_words(common::short(w))
        .iter()
        .any(|x| PUBLIC_DECORATOR_NAMES.contains(&x.as_str()))
}

/// A guard class applied by `@UseGuards` (or, `global`, `APP_GUARD`), read through
/// the shared guard proof ([`security::authenticates`], which applies Nest's guard
/// contract to the classes the repo uses as guards): proven, it is `decorator` /
/// `app_guard`. A role guard is authz's; a rate limiter (by package, or a name that
/// vetoes) is no auth. A class with no definition, or a package's guard the proof
/// cannot read, is opaque [STRICT]; an in-repo one that proves nothing is a wrapper.
fn guard(cx: &Cx<'_>, global: bool, g: &str, at: &Position<'_>, r: &mut Reading) {
    use crate::guard_position::Verdict;
    let mechanism = if global { "app_guard" } else { "decorator" };
    let ctx = cx.context();
    // What the reading of every guard position says of the class
    // ([`crate::guard_position::nest_guard`]): its body decides, never its name.
    let strict = || crate::guard_position::nest_guard(cx, at.package, at.calls, g);
    if declared(cx, super::AUTHN, g).is_some() {
        r.add(mechanism, g, VariantSource::Declared);
    } else if g.starts_with("unresolved:") {
        r.unknown(UnknownReason::Unresolved, g);
    } else if !external(g) && ctx.definition(g).is_none() {
        r.unknown(UnknownReason::OpaqueWrapper, g);
    } else if role_only_guard(cx, g) {
        r.role_guards.push(crate::mine::norm_ref(g).into_owned());
    } else if let Some(verdict) = strict() {
        match verdict {
            Verdict::Guard(_) => {
                if role_guard(cx, g) {
                    r.role_guards.push(crate::mine::norm_ref(g).into_owned());
                }
                r.add(mechanism, g, source(g));
            }
            Verdict::Nothing => {}
            Verdict::Unknown(reason) => r.call_unknown(reason, g),
        }
    } else if not_auth_guard(g) {
        // A rate limiter: turns callers away, but not for who they are.
    } else if security::authenticates(ctx, g) || security::callee_proves_guard(ctx, g) {
        if role_guard(cx, g) {
            r.role_guards.push(crate::mine::norm_ref(g).into_owned());
        }
        r.add(mechanism, g, source(g));
    } else if external(g) {
        // A package's guard the proof cannot read: opaque [STRICT].
        r.unknown(UnknownReason::OpaqueWrapper, g);
    }
    // An in-repo guard whose definition proves nothing (`return true`) is a wrapper.
}

/// Where a Nest route's guards are written: its package, and the calls recorded
/// there ([`drift_core::Listed::guard_calls`]; `AuthGuard("jwt")` in `@UseGuards`).
struct Position<'a> {
    package: &'a str,
    calls: &'a [drift_core::GuardCall],
}

/// A guard class that runs for a Nest route ([`guard`]), with what the route's own
/// decorators change for it ([`security::nest_opt_out`]) and whether every start of
/// the application registers it (`every`). A guard proven to sign the caller in is
/// the route's only where it is registered for every start and no decorator of the
/// route may switch it off: one that lets the route through for the metadata a
/// decorator sets opens it (`@Public()`), and one that may is found, not proven.
fn route_guard(
    cx: &Cx<'_>,
    global: bool,
    every: bool,
    g: &str,
    decorators: &[(&str, bool, Vec<&str>)],
    at: &Position<'_>,
    r: &mut Reading,
) {
    let opt_out = security::nest_opt_out(cx.context(), g, decorators);
    if every && opt_out == security::NestOptOut::Applies {
        return guard(cx, global, g, at, r);
    }
    let mut own = Reading::default();
    guard(cx, global, g, at, &mut own);
    own.settle();
    if !own.signs_in() {
        // Nothing the decorators could switch off: read as it is.
        return guard(cx, global, g, at, r);
    }
    r.role_guards.extend(own.role_guards);
    match opt_out {
        security::NestOptOut::Opens(d) => {
            let opens = use_of(OPENS, d);
            if !r.uses.contains(&opens) {
                r.add(OPENS, d, source(d));
            }
        }
        _ => r.call_unknown(UnknownReason::Unresolved, g),
    }
}

/// A guard that limits rate, not who may call (`ThrottlerGuard`, `@nestjs/throttler`).
fn not_auth_guard(g: &str) -> bool {
    common::package_root(g).is_some_and(|p| NOT_AUTH_GUARD_LIBRARIES.contains(&p.as_str()))
        || key_words(common::short(g))
            .iter()
            .any(|w| NOT_AUTH_GUARD_NAMES.contains(&w.as_str()))
}

/// Nest global guards: `APP_GUARD=<guard>` in the `decorator_args` of a `@Module`
/// class of the package apply to every route of the app ([`route_guard`]).
fn app_guards(
    cx: &Cx<'_>,
    file: &FileFacts,
    decorators: &[(&str, bool, Vec<&str>)],
    at: &Position<'_>,
    r: &mut Reading,
) {
    for f in cx.facts.files.iter().filter(|f| f.package == file.package) {
        for c in &f.symbols {
            for (d, g) in c.decorator_args.iter().filter_map(|a| a.split_once('=')) {
                if d == "APP_GUARD" || d.ends_with("#APP_GUARD") || d.ends_with(".APP_GUARD") {
                    route_guard(cx, true, true, g, decorators, at, r);
                }
            }
        }
    }
}

fn source(r: &str) -> VariantSource {
    if external(r) {
        VariantSource::Vocab
    } else {
        VariantSource::Usage
    }
}

/// Reads one wrapper; true when it declares the route public (`@Public()`).
fn wrap(
    cx: &Cx<'_>,
    file: &FileFacts,
    w: &str,
    kind: WrapKind,
    guards: &[&str],
    verdict: Option<crate::py_guards::Verdict>,
    r: &mut Reading,
) -> bool {
    let mechanism = match kind {
        WrapKind::Opens => {
            r.add(OPENS, w, source(w));
            return true;
        }
        WrapKind::Authenticates | WrapKind::ConfigAuthenticates => {
            r.add(IDENTIFIES, w, source(w));
            return false;
        }
        WrapKind::Jsx | WrapKind::Try => return false,
        WrapKind::Call if file.lang == "py" => "dependency",
        WrapKind::Call => "wrap",
        WrapKind::Decorator => "decorator",
        WrapKind::Extends => "base",
        WrapKind::Config => "config",
        WrapKind::AppHook => "app_hook",
    };
    if security::SCHEMA_ONLY.contains(&w) {
        return false;
    }
    if declared(cx, super::AUTHN, w).is_some() {
        r.add(mechanism, w, VariantSource::Declared);
        return false;
    }
    if crate::mine::norm_ref(w) == USE_GUARDS {
        // The guard classes are its arguments; none recorded: opaque [STRICT].
        if guards.is_empty() {
            r.unknown(UnknownReason::OpaqueWrapper, USE_GUARDS);
        }
        return false;
    }
    let ctx = cx.context();
    if kind == WrapKind::Decorator
        && !external(w)
        && let Some(d) = ctx.definition(w)
    {
        let calls_ref = |want: &str| {
            d.calls
                .iter()
                .chain(&d.returns_wrapped_by)
                .any(|c| crate::mine::norm_ref(c).trim_end_matches("()") == want)
        };
        // `SetMetadata` named public (`@Public()`) declares the route public; other
        // metadata (`@RequirePermissions(...)`) is read by a guard: a role marker for
        // authz, nothing for authn.
        if calls_ref(SET_METADATA) {
            if names_public(w) {
                r.add(OPENS, w, VariantSource::Usage);
                return true;
            }
            if names_role(common::short(w)) {
                r.role_guards.push(crate::mine::norm_ref(w).into_owned());
            }
        }
        // A composed decorator (`applyDecorators(...)`) guards only through the
        // `UseGuards` it applies. The guard classes it delivers are on the handler
        // (`UseGuards=<G>` in `decorator_args`) and decide, read with the others; with
        // none recorded it is opaque [STRICT] (a `practices:` line naming it makes it
        // known). One without `UseGuards` guards nothing, whatever its body seems to
        // reject.
        if calls_ref(APPLY_DECORATORS) {
            if calls_ref(USE_GUARDS) && guards.is_empty() {
                r.unknown(UnknownReason::OpaqueWrapper, w);
            }
            return false;
        }
    }
    // A method of a class used where a guard goes (`Auth.requireUser`): its own
    // body decides, not what the class does as a whole.
    match security::method_guard(ctx, w) {
        Some(security::Proof::Guard) => {
            r.add(mechanism, &crate::mine::norm_ref(w), VariantSource::Usage);
            return false;
        }
        Some(security::Proof::Unreadable) => {
            r.call_unknown(UnknownReason::Unresolved, w);
            return false;
        }
        Some(security::Proof::NotAGuard) => return false,
        None => {}
    }
    let proven = match &verdict {
        Some(v) => v.is_guard(),
        None => security::authenticates(ctx, w) || class_guard(cx, w),
    };
    if proven {
        // The guard that rejects, not a dependency that reads what it established
        // (`get_tenant` calling `get_current_user`, `get_folder_service` built on
        // `resolve_principal`): the variant is the check, so routes that share it are
        // one variant ([`proving_root`]).
        let root = proving_root(cx, w);
        let through_another = mechanism == "dependency"
            && !external(&root)
            && root != crate::mine::norm_ref(w);
        if through_another
            && !class_guard(cx, &root)
            && ctx
                .definition(&root)
                .is_some_and(|d| d.kind == drift_core::SymbolKind::Class)
        {
            // The dependency builds a service (`get_folder_service` returns a `FolderService`)
            // whose methods turn callers away: that is work the handler does later, on
            // the record it asks for, not a sign-in at the door. It may still be the auth
            // step, so with nothing else enforcing the unit is unknown, never none.
            if r.unread_call.is_none() {
                r.unread_call = Some(root);
            }
            return false;
        }
        if role_guard(cx, w) {
            r.role_guards.push(crate::mine::norm_ref(w).into_owned());
        }
        if role_only_guard(cx, &root) {
            r.role_only.push((mechanism.to_string(), root, source(w)));
        } else {
            r.add(mechanism, &root, source(&root));
        }
        return false;
    }
    // A Python thing at a guard position that is no proven guard: nothing where
    // it is read to turn no one away, unknown otherwise. One of the repository
    // that was found and is not proven decides only a unit nothing proven signs
    // in, as a body call does.
    match verdict {
        Some(crate::py_guards::Verdict::Unknown(reason)) => {
            let found = reason == UnknownReason::Unresolved
                && !external(w)
                && ctx
                    .definition(w)
                    .is_some_and(|d| !security::returns_unresolved(d));
            if found {
                r.call_unknown(reason, w);
            } else if reason == UnknownReason::OpaqueWrapper && in_skipped(cx, w) {
                r.unknown(UnknownReason::Unparsed, w);
            } else {
                r.unknown(reason, w);
            }
            return false;
        }
        Some(_) => return false,
        None => {}
    }
    if w.starts_with("unresolved:") {
        r.unknown(UnknownReason::Unresolved, w);
    } else if file.lang == "py"
        && matches!(kind, WrapKind::Call | WrapKind::Decorator)
        && security::member_of_a_value(ctx, w)
    {
        // [STRICT]: a member of a module-level value (`Depends(GUARDS.get("user"))`):
        // what it holds is not in its definition.
        r.call_unknown(UnknownReason::Unresolved, w);
    } else if security::may_authenticate(ctx, w) {
        // [STRICT]: it answers "not signed in" in an `except` handler, and is not
        // proven to for every request (the handler does so under a branch, another
        // handler goes on): it may be the guard of this one.
        r.call_unknown(UnknownReason::Unresolved, w);
    } else if !external(w)
        && ctx.definition(w).is_some_and(|d| {
            d.body_checks.iter().any(|c| {
                matches!(
                    c.outcome,
                    drift_core::CheckOutcome::Unauthenticated
                        | drift_core::CheckOutcome::SignInRedirect
                )
            })
        })
    {
        // [STRICT]: it answers "not signed in", and is not proven to for every
        // request (`@app.before_request` returning early for some endpoints, then
        // 401 without a token): it may be the guard of this one.
        r.call_unknown(UnknownReason::Unresolved, w);
    } else if kind == WrapKind::Call
        && file.lang != "py"
        && !external(w)
        && !not_auth_guard(w)
        && ctx.definition(w).is_some_and(|d| {
            matches!(
                d.kind,
                drift_core::SymbolKind::Const | drift_core::SymbolKind::Variable
            ) && d.name == common::short(w)
                && d.made_by.is_empty()
                && d.derives_from.is_empty()
                && d.wraps.is_empty()
        })
    {
        // [STRICT]: a value given where a handler goes (`app.use("/api",
        // ...apiGuards, router)`, the list built somewhere Drift does not read):
        // what it holds may be the guard.
        r.call_unknown(UnknownReason::Unresolved, w);
    } else if kind == WrapKind::Call
        && !external(w)
        && ctx.definition(w).is_some_and(security::returns_unresolved)
    {
        // A dependency factory whose returned callable cannot be resolved.
        r.unknown(UnknownReason::Unresolved, w);
    } else if !external(w) && ctx.definition(w).is_none() {
        if in_skipped(cx, w) {
            r.unknown(UnknownReason::Unparsed, w);
        } else {
            r.unknown(UnknownReason::OpaqueWrapper, w);
        }
    } else if common::package_root(w).is_some_and(|p| auth_library(&p)) {
        r.unknown(UnknownReason::Unclassified, w);
    }
    false
}

/// `w` is a package's export, of a library that authenticates and that no table
/// classifies: it may be the guard (`unclassified` in [`wrap`]).
pub(crate) fn of_an_auth_library(w: &str) -> bool {
    common::package_root(w).is_some_and(|p| auth_library(&p))
}

fn auth_library(package: &str) -> bool {
    super::libraries::AUTHN_LIBRARIES
        .iter()
        .any(|l| match l.strip_suffix('/') {
            Some(prefix) => package.starts_with(&format!("{prefix}/")),
            None => package == *l,
        })
}

/// A guard that checks a role or permission: named for one (`RolesGuard`,
/// `adminProcedure`), a library's (`permission_required`, DRF `IsAdminUser`), or whose
/// definition turns callers away 403 on a role value or a literal.
pub fn role_guard(cx: &Cx<'_>, w: &str) -> bool {
    let name = common::short(w);
    if external(w) {
        let last = name
            .rsplit('.')
            .next()
            .unwrap_or(name)
            .trim_end_matches("(new)");
        return ROLE_GUARD_CALLEES.contains(&last)
            || (w.contains("rest_framework")
                && name.contains("permissions")
                && !SIGNED_IN_ONLY_CALLEES.contains(&last));
    }
    names_role(name.split(['.', '(']).next().unwrap_or(name))
        || cx.context().definition(w).is_some_and(|d| {
            d.body_checks.iter().any(|c| {
                c.outcome == CheckOutcome::Forbidden
                    && (names_role(&c.reads) || c.compares == "literal")
            })
        })
}

/// A role guard that does not also sign the caller in: its definition has no 401
/// check and is built on no library guard (a Nest `RolesGuard` beside a JWT guard).
/// The guard a wrapper's proof rests on, the one step that names it for every call
/// site: the wrapper itself when its own body (or class) turns callers away; otherwise
/// the root the shared proof found ([`security::authenticating_root`]: what it is built
/// on or calls that rejects, `get_org_context` -> `get_current_user`); otherwise a
/// `__call__` class guard ([`class_guard`]) it reaches within three calls. A dependency
/// that only reads the caller another guard established is never the instrument.
fn proving_root(cx: &Cx<'_>, w: &str) -> String {
    let ctx = cx.context();
    let w = crate::mine::norm_ref(w).into_owned();
    if external(&w)
        || class_guard(cx, &w)
        || ctx.definition(&w).is_some_and(self_rejects)
    {
        return w;
    }
    // The shared proof's own root: what the wrapper is built on or calls that rejects.
    if let Some(root) = security::authenticating_root(ctx, &w) {
        return root;
    }
    // A `__call__` class guard reached through calls, which the shared proof does not
    // read ([`class_guard`]).
    let mut cur = w;
    for _ in 0..3 {
        let Some(d) = ctx.definition(&cur) else {
            break;
        };
        let next = d
            .calls
            .iter()
            .chain(d.wraps.iter().map(|w| &w.wrapper))
            .filter(|c| !c.ends_with("(ref)") && !d.after_continuation.contains(c))
            .map(|c| crate::mine::norm_ref(c).into_owned())
            .filter(|c| *c != cur)
            .find(|c| security::authenticates(ctx, c) || class_guard(cx, c));
        match next {
            Some(n) if class_guard(cx, &n) => return n,
            Some(n) => cur = n,
            None => break,
        }
    }
    cur
}

/// A body that turns callers away itself: a rejection control, a 401/403 response,
/// or a check that answers so.
fn self_rejects(d: &Symbol) -> bool {
    d.controls.iter().any(|c| {
        c == drift_core::controls::REJECTS_CALLER || c == drift_core::controls::HANDLER_REJECTS
    }) || d
        .responses
        .iter()
        .any(|r| matches!(r.status, 401 | 403) && !r.in_catch)
        || d.body_checks.iter().any(|c| {
            matches!(
                c.outcome,
                CheckOutcome::Unauthenticated
                    | CheckOutcome::Forbidden
                    | CheckOutcome::SignInRedirect
            )
        })
}

/// A class used as a dependency whose `__call__` is the guard body: one built on a
/// FastAPI security scheme (`class JWTBearer(HTTPBearer)`, whose `__call__` calls the
/// scheme's, which rejects a request without credentials) that passes no
/// `auto_error`, or one whose own body turns callers away (a callable role check).
pub(super) fn class_guard(cx: &Cx<'_>, w: &str) -> bool {
    if external(w) {
        return false;
    }
    let ctx = cx.context();
    let Some(d) = ctx.definition(w) else {
        return false;
    };
    if d.kind != drift_core::SymbolKind::Class {
        return false;
    }
    let Some(call) = d.members.iter().find(|m| m.name == "__call__") else {
        return false;
    };
    let module = w.split_once('#').map_or(w, |(m, _)| m);
    let class = format!("{module}#{}", d.name);
    let scheme = ctx
        .ancestors(&class)
        .iter()
        .any(|a| a.starts_with("pkg:fastapi#") && security::library_guard(a));
    let calls_base = call.calls.iter().any(|c| c.ends_with("super().__call__"));
    let no_auto_error =
        !d.args.iter().any(|a| a.ends_with(":auto_error")) && !ctx.passes_key(&class, "auto_error");
    // A `__call__` that lets a request through that passed no refusal is optional
    // identity ([`drift_core::controls::REJECTS_SOME`]).
    let some_only = call
        .unread
        .iter()
        .any(|u| u == drift_core::controls::REJECTS_SOME);
    (scheme && calls_base && no_auto_error) || (self_rejects(d) && !some_only)
}

fn role_only_guard(cx: &Cx<'_>, g: &str) -> bool {
    if external(g) || !role_guard(cx, g) {
        return false;
    }
    cx.context().definition(g).is_some_and(|d| {
        !d.body_checks
            .iter()
            .any(|c| c.outcome == CheckOutcome::Unauthenticated)
            && !d
                .wraps
                .iter()
                .any(|w| w.kind == WrapKind::Extends && security::library_guard(&w.wrapper))
    })
}

/// Reads one body the entry point runs (`py`: a Python one; `request`: of an entry
/// point a remote caller reaches, [`REQUEST_KINDS`]). `wraps` are the handler's
/// own wrappers (normalised), which a body call is not ([`security::not_a_body_call`]).
fn body(
    cx: &Cx<'_>,
    s: &Symbol,
    py: bool,
    request: bool,
    wraps: &std::collections::BTreeSet<String>,
    r: &mut Reading,
) {
    let ctx = cx.context();
    // A webhook signature verifier of a package: known only where its failure is read
    // to stop the request, else unknown, never none ([`signature_reading`], the one
    // reading `drift security` lists such a webhook by).
    let signature = signature_reading(cx, py, s);
    for (instrument, src) in &signature.verified {
        r.add(SERVICE_AUTH, instrument, *src);
    }
    for instrument in &signature.unproven {
        r.call_unknown(UnknownReason::SignatureNotProven, instrument);
    }
    // [STRICT] TypeScript: a branch on the caller's value hands back what the facts
    // do not read (a refusal builder's response through a local, a status written as
    // a name, a refusal after a branch that serves): found, not proven. Never none.
    for c in &s.controls {
        if let Some(source) = c.strip_prefix(drift_core::controls::EXIT_UNREAD)
            && !py
            && security::exit_unread_of_caller(source)
        {
            r.call_unknown(UnknownReason::Unresolved, source);
        }
    }
    for c in &s.body_checks {
        // [STRICT] TypeScript: a check that turns the caller away where the two sides
        // MATCH (`if (header === process.env.SECRET) return 401`, the `if` of a
        // constant-time compare that answers true) is no check of who calls: the
        // comparison's operator says which way it goes, as the lowering reads it
        // ([`drift_core::check_op`]). Found, not proven. Against a literal it is a
        // deny list (`role === "banned"`), read as before.
        if !py
            && c.op == drift_core::check_op::REFUSES_MATCH
            && c.compares != "literal"
            && matches!(
                c.outcome,
                CheckOutcome::Unauthenticated | CheckOutcome::SignInRedirect
            )
        {
            let what = if c.source.is_empty() {
                "manual".to_string()
            } else {
                format!("{}{}", c.source, c.reads)
            };
            r.call_unknown(UnknownReason::Unresolved, &what);
            continue;
        }
        // (A package's signature verifier is read above.)
        if signature_callee(&c.source) && !repo_function(ctx, &c.source) {
            continue;
        }
        // [STRICT] TypeScript: such a check that only some requests reach, or whose
        // condition tests a local the body assigns more than once, guards those only:
        // found, not proven.
        if !py
            && (c.compares == "env" || signature_callee(&c.source))
            && matches!(
                c.outcome,
                CheckOutcome::Unauthenticated | CheckOutcome::SignInRedirect
            )
            && (c.conditional || c.condition == drift_core::not_always::SWALLOWED)
        {
            let what = if c.source.is_empty() {
                "env".to_string()
            } else {
                c.source.clone()
            };
            r.call_unknown(UnknownReason::Unresolved, &what);
            continue;
        }
        // An in-repo signature check, or a check against an env-derived secret (cron,
        // a service key): the caller is a service, not a signed-in user. The env name
        // is not echoed.
        if c.compares == "env" || signature_callee(&c.source) {
            let what = if c.source.is_empty() {
                "env"
            } else {
                c.source.as_str()
            };
            let src = if verifier_callee(&c.source) {
                VariantSource::Vocab
            } else {
                VariantSource::Usage
            };
            r.add(SERVICE_AUTH, what, src);
            continue;
        }
        if !matches!(
            c.outcome,
            CheckOutcome::Unauthenticated | CheckOutcome::SignInRedirect
        ) {
            continue;
        }
        let what = if c.source.is_empty() {
            "manual".to_string()
        } else {
            format!("{}{}", c.source, c.reads)
        };
        // [STRICT] TypeScript: a `try` whose handler answers 401 for some of what it
        // catches, or after which the request is handed on all the same: found, and
        // not proven to turn anyone away.
        // [STRICT] Python: a check only some requests reach (under a branch, after
        // a return that serves, an operand of `and`) is the guard of those.
        // [STRICT] TypeScript too (round 11): a check after a return that serves
        // some requests (`if (OPEN_PATHS.has(path)) return next()` before it), under
        // a branch, or an operand of `&&`, guards only the requests that reach it.
        // [STRICT] Python, since the measured build: a check made after the body
        // called something other than reading the request refuses after work it
        // may have done ([`security::check_after_work`]).
        if c.condition == drift_core::not_always::SWALLOWED
            || c.conditional
            || (py && security::check_after_work(ctx, s, c))
        {
            r.call_unknown(UnknownReason::Unresolved, &what);
            continue;
        }
        let src = if declared(cx, super::AUTHN, &c.source).is_some() {
            VariantSource::Declared
        } else if authn_callee(&c.source) {
            VariantSource::Vocab
        } else {
            VariantSource::Usage
        };
        r.add("body_check", &what, src);
    }
    // [STRICT] Python: the body answers 401 where no check records why (after a
    // branch that returns for a signed-in caller): found, never none.
    if py && security::answers_401_unrecorded(s) {
        r.call_unknown(UnknownReason::Unresolved, ANSWERS_401);
    }
    // [STRICT] Python: the body verifies a token by a library's call for every
    // request, with nothing to catch what the call raises
    // ([`crate::py_guards::verifies_uncaught`]): a caller without a valid token
    // is not served, and what it is answered is not read. Never none.
    if py && request && crate::py_guards::verifies_uncaught(ctx, s, 0) {
        r.call_unknown(UnknownReason::Unclassified, crate::py_guards::VERIFIES);
    }
    for c in &s.calls {
        if c.ends_with("(ref)") || s.body_checks.iter().any(|b| b.source == *c) {
            continue;
        }
        // A method of a class the handler calls (`service.copy()` on a typed
        // parameter) signs the caller in only when its own checks say so (a 401 or a
        // sign-in redirect): a method that forbids or finds nothing authorises, and is
        // read by `authz`. Its class's other members say nothing about this call.
        if let Some(m) = member_of(ctx, c)
            && declared(cx, super::AUTHN, c).is_none()
            && !m.body_checks.iter().any(|b| {
                matches!(
                    b.outcome,
                    CheckOutcome::Unauthenticated | CheckOutcome::SignInRedirect
                )
            })
        {
            continue;
        }
        if declared(cx, super::AUTHN, c).is_some() {
            r.add("body_call", c, VariantSource::Declared);
            continue;
        }
        if signature_callee(c) || verifier_of(ctx, c).is_some() {
            // A package's verifier is read above ([`signature_reading`]). A function of
            // the repository named as one is a service's check where its body is read
            // to turn the caller away; otherwise what it does is not proven.
            if repo_function(ctx, c) {
                if security::authenticates(ctx, c) {
                    r.add(SERVICE_AUTH, c, VariantSource::Usage);
                } else {
                    r.call_unknown(UnknownReason::SignatureNotProven, c);
                }
            }
            continue;
        }
        // [STRICT] Python: a package's function on no list, called as a statement
        // of its own (`company_auth.check_request()`): it can only act on the
        // request by raising. It may be the guard: never none.
        if py
            && request
            && crate::py_guards::dropped_unlisted(s, c)
            && !security::not_a_body_call(s, wraps, c)
        {
            r.call_unknown(UnknownReason::Unclassified, &crate::mine::norm_ref(c));
            continue;
        }
        // Python: a library's guard called in the body, in a shape the closed list
        // knows (`verify_jwt_in_request()`), for every request and before the body
        // hands control on. In any other shape the call is read as any package's.
        if py
            && external(c)
            && crate::py_guards::called_guard(s, c)
            && !security::not_a_body_call(s, wraps, c)
        {
            if security::for_some_requests(ctx, s, c) || security::after_work(ctx, s, c) {
                r.call_unknown(UnknownReason::Unresolved, &crate::mine::norm_ref(c));
            } else {
                r.add("body_call", &crate::mine::norm_ref(c), VariantSource::Vocab);
            }
            continue;
        }
        if names_service_check(c) && security::authenticates(ctx, c) {
            // An in-repo signature or shared-secret check that rejects
            // (`verifyQstashSignature`): the caller is a service, not a signed-in user.
            r.add(SERVICE_AUTH, c, VariantSource::Usage);
            continue;
        }
        // A function that refuses only by the response it hands back
        // (`requireSession` returning `NextResponse.json(..., { status: 401 })`)
        // guards the body where the body returns that response; where every call
        // is a statement of its own nothing stops the body, and anything else is
        // not read ([`security::hand_back`]).
        match security::hand_back(ctx, s, c) {
            Some(security::HandBack::Returned) => {
                if !security::not_a_body_call(s, wraps, c) {
                    // Python, since the measured build: not proven to refuse before
                    // work the body did first ([`security::after_work`]).
                    if py && security::after_work(ctx, s, c) {
                        r.call_unknown(UnknownReason::Unresolved, &crate::mine::norm_ref(c));
                    } else {
                        r.add("body_call", &crate::mine::norm_ref(c), source(c));
                    }
                }
                continue;
            }
            Some(security::HandBack::Dropped) => continue,
            Some(security::HandBack::Unread) => {
                r.call_unknown(UnknownReason::Unresolved, &crate::mine::norm_ref(c));
                continue;
            }
            None => {}
        }
        // One reading of the call for this report and `drift security`
        // ([`security::body_call`]), and one test of whether it is a body call at all
        // ([`security::not_a_body_call`]): a proven guard called only after the body
        // hands control on, or the handler's own wrapper called again, is no body call
        // in either, so the two never disagree on it.
        let reading = security::body_call(ctx, c);
        let skipped = security::not_a_body_call(s, wraps, c);
        if reading == security::BodyCall::Guard {
            // It turns callers away (PLAN-R14 A3): neither its name nor being called
            // from many entry points (an outbound client built with a service key, a
            // file loader) makes it one.
            if skipped {
            } else if (security::called_for_some(ctx, py, s, c)
                && (py || declared(cx, super::AUTHZ, c).is_none()))
                || (py && security::after_work(ctx, s, c))
            {
                // [STRICT] Called for some of the body's requests only (under a
                // branch, after a return that serves, once per element), or, in
                // Python, only after the body has done its work: their guard.
                r.call_unknown(UnknownReason::Unresolved, &crate::mine::norm_ref(c));
            } else {
                r.add("body_call", &proving_root(cx, c), source(c));
            }
        } else if reading == security::BodyCall::Unproven && !c.ends_with("(new)") && !skipped {
            // It looks like a guard (an in-repo helper entry points call as one, that
            // throws and is named for access) and nothing shows that what it throws
            // turns an unauthenticated caller away: `assertSession()` throwing a plain
            // `Error`. Neither a guard nor nothing, the same reading `drift security`
            // gives it (`opaque`). The helper is the instrument, so a person can name
            // it (`practices: {authn: ...}`), which makes the unit known. It never
            // demotes a unit a proven guard signs in ([`Reading::assignment`]).
            r.call_unknown(UnknownReason::Unclassified, &crate::mine::norm_ref(c));
        } else if authn_callee(c) {
            // A session read with no check on what it returns: identified, not enforced.
            r.add(IDENTIFIES, c, VariantSource::Vocab);
        } else if !common::builds_object(py, c)
            && !c.starts_with(PARAM_CALLEE)
            && security::callee_is_guard(ctx, c)
            && names_guard(c)
            && (external(c) || ctx.definition(c).is_none())
        {
            // Only its name says it guards and what it does cannot be read: neither a
            // guard nor nothing. A definition that rejects no one is no guard. A call
            // through a parameter (`param:server.services.x.canRevoke`) is never a
            // guard by name, and neither is a call that builds an object
            // ([`common::builds_object`]: `new SessionStore()`, Python's
            // `CreateSessionRequestBody(user_id=..)`): it makes a value for the handler
            // to use, whatever the class is called, and a method called on that value is
            // read as its own callee. Either way it never demotes a unit a proven guard
            // signs in ([`Reading::assignment`]).
            r.call_unknown(UnknownReason::Unclassified, c);
        }
    }
}

/// A function or class the repository defines: a callee whose body is the repository's,
/// not a package's verifier.
fn repo_function(ctx: &crate::context::RepoContext<'_>, c: &str) -> bool {
    ctx.definition(c).is_some_and(|d| {
        matches!(
            d.kind,
            drift_core::SymbolKind::Function | drift_core::SymbolKind::Class
        )
    })
}

/// A catch clause that leaves the body ([`drift_core::CatchFact::does`]): it raises,
/// throws or answers with an error status, and neither swallows, returns nor answers
/// with a success.
fn catch_leaves(does: &[String]) -> bool {
    let status = |d: &str| d.strip_prefix("respond:").and_then(|n| n.parse::<u16>().ok());
    does.iter()
        .any(|d| d == "rethrow" || d.starts_with("throw:") || status(d).is_some_and(|n| n >= 400))
        && !does
            .iter()
            .any(|d| d == "swallow" || d == "return" || status(d).is_some_and(|n| n < 400))
}

/// The verifier of [`drift_core::guard_lists::SIGNATURE_VERIFIERS`] a call of `c` is:
/// the package's call itself, or a method of a module-level value one assignment
/// builds from the package's class (`verifier = SignatureVerifier(...)` and
/// `verifier.is_valid_request(...)`).
fn verifier_of(
    ctx: &crate::context::RepoContext<'_>,
    c: &str,
) -> Option<&'static drift_core::guard_lists::SignatureVerifier> {
    use drift_core::guard_lists::signature_verifier;
    let c = c.trim_start_matches('?');
    if let Some(v) = signature_verifier(c) {
        return Some(v);
    }
    let (value, method) = c.rsplit_once('.')?;
    let d = ctx.definition(value)?;
    let mut made = d.controls.iter().filter_map(|x| {
        x.strip_prefix(drift_core::controls::SHAPE)?
            .strip_prefix('=')
    });
    let first = made.next()?;
    if made.next().is_some() {
        return None;
    }
    let (class, _) = first.split_once('(')?;
    signature_verifier(&format!("{class}().{method}"))
}

/// Stripe's `webhooks.constructEvent(Async)`: of the package itself
/// (`pkg:stripe#webhooks.constructEvent`), or of a value of a file that imports
/// `stripe` (`lib/stripe.ts#stripe.webhooks.constructEvent`, the client built there).
fn stripe_construct_event(cx: &Cx<'_>, source: &str) -> bool {
    let Some((owner, path)) = source.split_once('#') else {
        return false;
    };
    let shape = path == "webhooks.constructEvent"
        || path == "webhooks.constructEventAsync"
        || path.ends_with(".webhooks.constructEvent")
        || path.ends_with(".webhooks.constructEventAsync");
    let stripe = |m: &str| m == "pkg:stripe" || m.starts_with("pkg:stripe/");
    shape
        && (stripe(owner)
            || (!repo_function(cx.context(), source)
                && common::file_at(cx.facts, owner)
                    .is_some_and(|f| f.imports.iter().any(|i| stripe(&i.module)))))
}

/// What one body does with a package's webhook signature verifier.
#[derive(Debug, Default)]
struct SignatureReading {
    /// The verifiers whose failure is read to stop the request, as the instrument a
    /// use names them by, with the label `drift security` says, and the use's source.
    verified: Vec<(String, VariantSource)>,
    labels: Vec<&'static str>,
    /// Where none is: the verifier calls found and not proven to stop the request.
    unproven: Vec<String>,
}

/// How a body reads with a package's webhook signature verifier, on a closed list of
/// call shapes ([`drift_core::guard_lists::SIGNATURE_VERIFIERS`]); the one reading the
/// practice map's authentication and `drift security` say such a webhook by. A
/// verifier is proven to stop the request only where its failure leaves the body:
///
/// - Python, a verifier that raises: called on every request, outside any `try` whose
///   handler goes on ([`drift_core::controls::VERIFIES_SIGNATURE`]);
/// - a verifier that answers a boolean (Slack's): a check on its result, made for
///   every request, that refuses with a 4xx;
/// - TypeScript, svix `Webhook.verify` and Stripe `webhooks.constructEvent` (in a file
///   that imports `stripe`): the check the lowering records for the call, made for
///   every request, in a body whose every `catch` leaves it.
///
/// Any other call of a verifier the body makes, or of a package's call named as one
/// ([`signature_callee`]: octokit's `verify`), is not proven: its result may be
/// ignored, what it raises swallowed, or it runs for some requests only. Where nothing
/// is proven, those are [`SignatureReading::unproven`].
fn signature_reading(cx: &Cx<'_>, py: bool, s: &Symbol) -> SignatureReading {
    signature_reading_in(cx, py, s, 0, &mut Vec::new())
}

/// How many functions of the repository a body's verifier is followed through
/// ([`signature_reading_in`]).
const SIGNATURE_HOPS: usize = 3;

/// [`signature_reading`] of `s`, reached through `depth` calls of the functions in
/// `seen`.
fn signature_reading_in(
    cx: &Cx<'_>,
    py: bool,
    s: &Symbol,
    depth: usize,
    seen: &mut Vec<*const Symbol>,
) -> SignatureReading {
    seen.push(s);
    let out = signature_reading_of(cx, py, s, depth, seen);
    seen.pop();
    out
}

fn signature_reading_of(
    cx: &Cx<'_>,
    py: bool,
    s: &Symbol,
    depth: usize,
    seen: &mut Vec<*const Symbol>,
) -> SignatureReading {
    let ctx = cx.context();
    let mut out = SignatureReading::default();
    // Python, since the measured build: a verifier called after the body has done
    // work is not proven to stop it ([`security::after_work`]).
    let late = |c: &str| py && security::after_work(ctx, s, c);
    let mut after: Vec<String> = Vec::new();
    let every = |conditional: bool, condition: &str| !conditional && condition.is_empty();
    let refuses = |o: CheckOutcome| {
        matches!(
            o,
            CheckOutcome::Unauthenticated | CheckOutcome::Forbidden | CheckOutcome::Invalid
        )
    };
    let source = |c: &str| {
        if verifier_callee(c) {
            VariantSource::Vocab
        } else {
            VariantSource::Usage
        }
    };
    let verified = |out: &mut SignatureReading, instrument: &str, label: &'static str| {
        if !out.verified.iter().any(|(i, _)| i == instrument) {
            out.verified.push((instrument.to_string(), source(instrument)));
        }
        if !out.labels.contains(&label) {
            out.labels.push(label);
        }
    };
    if py {
        for c in &s.controls {
            if let Some(callee) = c.strip_prefix(drift_core::controls::VERIFIES_SIGNATURE)
                && let Some(v) =
                    drift_core::guard_lists::signature_verifier(callee).filter(|v| v.throws)
            {
                if late(callee) {
                    after.push(callee.to_string());
                } else {
                    verified(&mut out, callee, v.label);
                }
            }
        }
        // A boolean verifier: the body refuses where it answers false.
        let checks = s
            .raise_checks
            .iter()
            .map(|r| {
                (
                    &r.source,
                    every(r.conditional, &r.condition) && (400..500).contains(&r.status),
                )
            })
            .chain(s.body_checks.iter().map(|b| {
                (
                    &b.source,
                    every(b.conditional, &b.condition) && refuses(b.outcome),
                )
            }));
        for (c, ok) in checks {
            if ok && let Some(v) = verifier_of(ctx, c).filter(|v| !v.throws) {
                if late(c) {
                    after.push(c.to_string());
                } else {
                    verified(&mut out, c, v.label);
                }
            }
        }
        // Since the measured build: a function of the repository the body calls
        // verifies the signature where its own body does for every request
        // ([`SIGNATURE_HOPS`]); called for some requests only, or after work, it is
        // found and not proven.
        if ctx.since_measured() && depth < SIGNATURE_HOPS {
            for c in &s.calls {
                if c.ends_with("(ref)") || c.ends_with("(new)") {
                    continue;
                }
                let Some(d) = ctx.definition(&crate::mine::norm_ref(c)).filter(|d| {
                    d.kind == drift_core::SymbolKind::Function
                        && !seen.iter().any(|x| std::ptr::eq(*x, *d))
                }) else {
                    continue;
                };
                let inner = signature_reading_in(cx, py, d, depth + 1, seen);
                let every_request = !s
                    .conditional_calls
                    .iter()
                    .filter_map(|x| x.split_once(':'))
                    .any(|(_, x)| x == c)
                    && !security::after_work(ctx, s, c);
                for (instrument, src) in inner.verified {
                    if every_request {
                        if !out.verified.iter().any(|(i, _)| *i == instrument) {
                            out.verified.push((instrument, src));
                        }
                    } else {
                        after.push(instrument);
                    }
                }
                for l in inner.labels {
                    if every_request && !out.labels.contains(&l) {
                        out.labels.push(l);
                    }
                }
                after.extend(inner.unproven);
            }
        }
    } else if s.catches.iter().all(|c| catch_leaves(&c.does)) {
        for b in &s.body_checks {
            if !every(b.conditional, &b.condition) {
                continue;
            }
            // A secret written in the code is not the service's: found, not proven.
            if b.compares == "literal" {
                continue;
            }
            if let Some(v) = drift_core::guard_lists::signature_verifier(&b.source)
                .filter(|v| v.throws && v.package == "svix")
            {
                verified(&mut out, &b.source, v.label);
            } else if stripe_construct_event(cx, &b.source) {
                verified(&mut out, &b.source, "Stripe webhooks.constructEvent");
            }
        }
    }
    if !out.verified.is_empty() {
        // (Labels of what was found and not proven stay out: one proven verifier
        // settles the body, as before.)
        return out;
    }
    // What the body calls of a verifier, and is not proven.
    let package = |c: &str| {
        (signature_callee(c) || verifier_of(ctx, c).is_some()) && !repo_function(ctx, c)
    };
    let mut unproven: std::collections::BTreeSet<String> = after.into_iter().collect();
    for c in &s.body_checks {
        if package(&c.source) {
            unproven.insert(c.source.clone());
        }
    }
    for c in &s.calls {
        let c = c.trim_start_matches('?');
        if !c.ends_with("(ref)") && package(c) {
            unproven.insert(c.to_string());
        }
    }
    for c in &s.conditional_calls {
        if let Some((_, callee)) = c.split_once(':')
            && package(callee)
        {
            unproven.insert(callee.to_string());
        }
    }
    out.unproven = unproven.into_iter().collect();
    out
}

/// The labels of the webhook signature verifiers an entry point's bodies are read to
/// verify the sending service by ([`signature_reading`]): what `drift security` lists
/// a row with no guard by (`svix Webhook.verify`). Empty where a verifier is found
/// and not proven in any of its bodies: the practice map reads such a unit unknown.
pub fn verified_signatures<'a>(cx: &Cx<'a>, py: bool, handler: &'a Symbol) -> Vec<String> {
    let mut labels = std::collections::BTreeSet::new();
    for b in common::bodies(cx, handler) {
        let r = signature_reading(cx, py, b);
        if !r.unproven.is_empty() {
            return Vec::new();
        }
        labels.extend(r.labels);
    }
    labels.into_iter().map(str::to_string).collect()
}

/// The method a `Class.method` callee names, when the facts hold the class and that
/// member ([`drift_core::Member`]).
fn member_of<'a>(ctx: &crate::context::RepoContext<'a>, c: &str) -> Option<&'a drift_core::Member> {
    let method = c.rsplit('.').next()?;
    if !c.contains('.') || common::external(c) {
        return None;
    }
    let d = ctx.definition(c)?;
    if d.kind != drift_core::SymbolKind::Class {
        return None;
    }
    d.members.iter().find(|m| m.name == method)
}

/// The first callee of a body whose own body cannot be read: an unresolved import, an
/// in-repo function the facts do not define, or a call through a parameter that has no
/// other name (`param:server.services.secret.canRevoke`); and whether the body calls a
/// package's method through a typed parameter that is unread only for what else the
/// body hands on ([`common::request_call_beside_unrecorded`]): not a call to name
/// ([`Reading::partly`]). A package's call, the runtime's (`global#`), a constructor, a database
/// client and a handed-over handler are not such a call; nor is a call through a
/// parameter whose type is a package's, in a body that hands nothing to a call the
/// facts did not record ([`common::request_param_call`]: `request.json()` on a
/// `request: NextRequest` is `pkg:next/server#NextRequest.json`, the framework's own
/// method, and `request.nextUrl.searchParams.get` its
/// `NextRequest.nextUrl.searchParams.get`).
fn unread_call(cx: &Cx<'_>, b: &Symbol) -> (Option<String>, bool) {
    let ctx = cx.context();
    let unread: Vec<&String> = b
        .calls
        .iter()
        .filter(|c| !c.ends_with("(ref)") && !c.ends_with("(new)"))
        .filter(|c| !common::request_param_call(b, c))
        .filter(|c| {
            c.starts_with("unresolved:")
                || (!external(c)
                    && ctx.definition(c).is_none()
                    && super::data::instrument_of(cx, c).is_none())
        })
        .collect();
    let beside = |c: &str| common::request_call_beside_unrecorded(b, c);
    let of_parameter = unread.iter().any(|c| beside(c));
    let first = unread
        .into_iter()
        .filter(|c| !beside(c))
        .map(|c| crate::mine::norm_ref(c).into_owned())
        .min();
    (first, of_parameter)
}

/// A callee named for verifying a service's signature or shared secret
/// (`verifyQstashSignature`, `verifyVercelSignature`, `checkCronSecret`).
fn names_service_check(c: &str) -> bool {
    let last = common::short(c).rsplit('.').next().unwrap_or_default();
    key_words(last)
        .iter()
        .any(|w| super::libraries::SERVICE_CHECK_NAMES.contains(&w.as_str()))
}

/// The method a callee ends in names access control (`authorize`, `requireUser`), as
/// the refuse vocabulary reads it; `db.session.findFirst` does not.
fn names_guard(c: &str) -> bool {
    let last = common::short(c).rsplit('.').next().unwrap_or_default();
    crate::vocab::refuse::names_access_control(&format!("x#{last}"))
}

// ---------- the Next.js middleware ----------

/// Of three: provably, provably not, cannot be told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tri {
    Yes,
    No,
    Unsure,
}

impl Tri {
    fn and(self, other: impl FnOnce() -> Tri) -> Tri {
        match self {
            Tri::No => Tri::No,
            Tri::Yes => other(),
            Tri::Unsure => match other() {
                Tri::No => Tri::No,
                _ => Tri::Unsure,
            },
        }
    }
}

/// The route (an entry point's template) matches one of the patterns.
pub fn matches_any(patterns: &[String], route: &str) -> Tri {
    let Some(route) = drift_core::practice::normalize_route(route) else {
        return Tri::Unsure;
    };
    let segs: Vec<&str> = route.split('/').filter(|s| !s.is_empty()).collect();
    let mut out = Tri::No;
    for p in patterns {
        let pat: Vec<&str> = p.trim_start_matches('/').split('/').collect();
        let pat: Vec<&str> = if pat == [""] { vec![] } else { pat };
        match match_segs(&pat, &segs) {
            Tri::Yes => return Tri::Yes,
            Tri::Unsure => out = Tri::Unsure,
            Tri::No => {}
        }
    }
    out
}

fn literal(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn match_segs(pat: &[&str], route: &[&str]) -> Tri {
    let any = drift_core::practice::ANY_SEGMENT;
    let Some((p, rest)) = pat.split_first() else {
        return if route.is_empty() { Tri::Yes } else { Tri::No };
    };
    // A tail that takes anything (`(.*)`, `:path*`): the rest, but only last.
    if *p == "(.*)" || (p.starts_with(':') && p.ends_with('*')) {
        return match (rest.is_empty(), route.is_empty()) {
            (false, _) | (true, true) => Tri::Unsure,
            (true, false) => Tri::Yes,
        };
    }
    if p.starts_with(':') && p.ends_with('+') {
        return match (rest.is_empty(), route.is_empty()) {
            (false, _) => Tri::Unsure,
            (true, empty) => {
                if empty {
                    Tri::No
                } else {
                    Tri::Yes
                }
            }
        };
    }
    let Some((r0, rrest)) = route.split_first() else {
        return Tri::No;
    };
    if let Some(prefix) = p.strip_suffix("(.*)") {
        if !rest.is_empty() || !literal(prefix) {
            return Tri::Unsure;
        }
        return if *r0 == any {
            Tri::Unsure
        } else if r0.starts_with(prefix) {
            Tri::Yes
        } else {
            Tri::No
        };
    }
    if let Some(name) = p.strip_prefix(':') {
        if !literal(name) {
            return Tri::Unsure;
        }
        return match_segs(rest, rrest);
    }
    if !literal(p) {
        return Tri::Unsure;
    }
    let here = if *r0 == any {
        Tri::Unsure
    } else if r0 == p {
        Tri::Yes
    } else {
        Tri::No
    };
    here.and(|| match_segs(rest, rrest))
}

/// A package's application middleware that turns no caller away for who they are
/// [STRICT]: a closed list, by package and class. Any other package's middleware may
/// be the guard.
const NOT_AUTH_MIDDLEWARE: &[(&str, &str)] = &[
    ("fastapi", "CORSMiddleware"),
    ("fastapi", "GZipMiddleware"),
    ("fastapi", "HTTPSRedirectMiddleware"),
    ("fastapi", "TrustedHostMiddleware"),
    ("starlette", "CORSMiddleware"),
    ("starlette", "GZipMiddleware"),
    ("starlette", "HTTPSRedirectMiddleware"),
    ("starlette", "TrustedHostMiddleware"),
    ("starlette", "SessionMiddleware"),
    ("starlette", "ServerErrorMiddleware"),
    ("starlette", "ExceptionMiddleware"),
    ("uvicorn", "ProxyHeadersMiddleware"),
    ("asgi_correlation_id", "CorrelationIdMiddleware"),
    ("starlette_exporter", "PrometheusMiddleware"),
    ("starlette_prometheus", "PrometheusMiddleware"),
    ("sentry_sdk", "SentryAsgiMiddleware"),
    ("opentelemetry", "OpenTelemetryMiddleware"),
    ("brotli_asgi", "BrotliMiddleware"),
];

/// The checks of the body an application middleware runs for every request: a
/// function's own, or those of a class's `dispatch` (Starlette's
/// `BaseHTTPMiddleware`), `__call__` (plain ASGI) or, in TypeScript, `use` (a Nest
/// middleware), with what that body calls. `None` for a class with none of them.
pub(super) fn middleware_body<'a>(
    cx: &Cx<'a>,
    m: &str,
) -> Option<(&'a [drift_core::BodyCheck], &'a [String])> {
    let d = cx.context().definition(m)?;
    if d.name != common::short(m) {
        return None;
    }
    // A Nest middleware class runs its `use` (TypeScript only).
    let nest = !m.split('#').next().is_some_and(|p| p.ends_with(".py"));
    match d.kind {
        drift_core::SymbolKind::Function => Some((&d.body_checks, &d.calls)),
        drift_core::SymbolKind::Class => d
            .members
            .iter()
            .find(|x| x.name == "dispatch")
            .or_else(|| d.members.iter().find(|x| x.name == "__call__"))
            .or_else(|| d.members.iter().find(|x| nest && x.name == "use"))
            .map(|x| (x.body_checks.as_slice(), x.calls.as_slice())),
        _ => None,
    }
}

/// What the body an application middleware runs for every request
/// ([`middleware_body`]) answers in its `except` handlers:
/// [`drift_core::controls::HANDLER_REJECTS`] or
/// [`drift_core::controls::HANDLER_MAY_REJECT`], from a function's controls or the
/// method's own facts ([`drift_core::Member::unread`]).
fn middleware_handler(cx: &Cx<'_>, m: &str) -> Option<&'static str> {
    use drift_core::controls::{HANDLER_MAY_REJECT, HANDLER_REJECTS};
    let d = cx.context().definition(m)?;
    let facts: &[String] = match d.kind {
        drift_core::SymbolKind::Function => &d.controls,
        drift_core::SymbolKind::Class => d
            .members
            .iter()
            .find(|x| x.name == "dispatch")
            .or_else(|| d.members.iter().find(|x| x.name == "__call__"))
            .map(|x| x.unread.as_slice())?,
        _ => return None,
    };
    [HANDLER_REJECTS, HANDLER_MAY_REJECT]
        .into_iter()
        .find(|c| facts.iter().any(|f| f == c))
}

/// What a middleware of the application that serves an entry point is to it
/// ([`read_route_middleware`]).
pub enum AppMiddleware<'m> {
    /// It turns away, for every request, a caller who is not signed in: what proves
    /// it (the middleware itself, or the guard it holds or is made by).
    Guard(std::borrow::Cow<'m, str>, VariantSource),
    /// It may: the reason it cannot be told.
    MayGuard(UnknownReason, &'m str),
    /// It was read and turns no one away for who they are.
    NoGuard,
}

/// Reads one entry of [`drift_core::Symbol::app_middleware`] of the entry point
/// `route` of `file`: the one reading the practice map and `drift security` both
/// take, so a route is never listed as having no guard behind a middleware the map
/// calls its guard, or cannot tell.
///
/// In the repository, it is read: it is the guard where it answers "not signed in"
/// for every request (a check no branch, no earlier return and no `and` makes
/// conditional). One that answers so for some requests only, that calls a guard or
/// that cannot be read may be the guard: unknown, unless something proven signs
/// the caller in. A package's is ignored only from a closed list [STRICT].
///
/// TypeScript [STRICT]: what stands there is read as every guard position is
/// ([`crate::guard_position`]), by the shape of the call where it is one. A class (a
/// Nest middleware, read through its `use`) keeps the reading below.
pub fn read_route_middleware<'m>(
    cx: &Cx<'_>,
    file: &FileFacts,
    route: &Symbol,
    m: &'m str,
) -> AppMiddleware<'m> {
    use crate::guard_position::Verdict;
    let own = read_app_middleware(cx, m);
    let (bare, every) = match m.strip_prefix('?') {
        Some(b) => (b, false),
        None => (m, true),
    };
    let class = !external(bare)
        && cx
            .context()
            .definition(bare)
            .is_some_and(|d| d.kind == drift_core::SymbolKind::Class && d.name == common::short(bare));
    if !crate::guard_position::applies(file)
        || class
        || matches!(own, AppMiddleware::Guard(_, VariantSource::Declared))
    {
        return own;
    }
    match (crate::guard_position::read(cx, file, route, bare), own) {
        (Verdict::Guard(_), _) if !every => {
            AppMiddleware::MayGuard(UnknownReason::Unresolved, bare)
        }
        (Verdict::Guard(_), own @ AppMiddleware::Guard(..)) => own,
        (Verdict::Guard(by), _) => {
            let source = source(&by);
            AppMiddleware::Guard(by.into(), source)
        }
        // What its own reading could not tell stays as it said it.
        (Verdict::Unknown(_), own @ AppMiddleware::MayGuard(..)) => own,
        (Verdict::Unknown(reason), _) => AppMiddleware::MayGuard(reason, bare),
        (Verdict::Nothing, _) => AppMiddleware::NoGuard,
    }
}

/// [`read_route_middleware`] by the middleware alone: a function's own checks, a
/// class's `dispatch`, `__call__` or `use`, a package's from the closed list of
/// [`NOT_AUTH_MIDDLEWARE`].
fn read_app_middleware<'m>(cx: &Cx<'_>, m: &'m str) -> AppMiddleware<'m> {
    use drift_core::CheckOutcome::{SignInRedirect, Unauthenticated};
    // One that only some of the applications serving the route have is never the
    // unit's guard: where it would be, which application answers is not known.
    let (m, every) = match m.strip_prefix('?') {
        Some(m) => (m, false),
        None => (m, true),
    };
    if declared(cx, super::AUTHN, m).is_some() && every {
        return AppMiddleware::Guard(m.into(), VariantSource::Declared);
    }
    if external(m) {
        let known = common::package_root(m).is_some_and(|p| {
            NOT_AUTH_MIDDLEWARE
                .iter()
                .any(|(package, class)| p == *package && common::short(m).ends_with(class))
        });
        return if known {
            AppMiddleware::NoGuard
        } else {
            AppMiddleware::MayGuard(UnknownReason::OpaqueWrapper, m)
        };
    }
    let Some((checks, calls)) = middleware_body(cx, m) else {
        return AppMiddleware::MayGuard(UnknownReason::BodyUnreadable, m);
    };
    let mut signs_in = checks
        .iter()
        .filter(|c| matches!(c.outcome, Unauthenticated | SignInRedirect));
    let ctx = cx.context();
    // What the body answers in the `except` handler of a `try` it cannot pass
    // otherwise (`try: claims = decode(token)` / `except JWTError: return 401`).
    let in_handler = middleware_handler(cx, m);
    if (signs_in.clone().any(|c| !c.conditional)
        || in_handler == Some(drift_core::controls::HANDLER_REJECTS))
        && every
    {
        AppMiddleware::Guard(m.into(), VariantSource::Usage)
    } else if signs_in.next().is_some() || in_handler.is_some() {
        AppMiddleware::MayGuard(UnknownReason::Unresolved, m)
    } else if security::authenticates(ctx, m)
        || calls.iter().any(|c| {
            !external(c) && (security::authenticates(ctx, c) || security::callee_proves_guard(ctx, c))
        })
    {
        AppMiddleware::MayGuard(UnknownReason::NotFollowed, m)
    } else if ctx.definition(m).is_some_and(|d| {
        d.kind == drift_core::SymbolKind::Function && d.responses.iter().any(|x| x.status == 401)
    }) || answers_some_itself(cx, m)
    {
        // [STRICT]: it answers 401 where no check records why (in the `catch` of
        // `await request.jwtVerify()`): it may be the guard.
        AppMiddleware::MayGuard(UnknownReason::Unresolved, m)
    } else {
        AppMiddleware::NoGuard
    }
}

/// A middleware class hands the request on only after a branch that returns: a pure
/// ASGI middleware whose `__call__` sends an answer itself for some requests (`await
/// response(scope, receive, send); return`) and calls the application it wraps
/// (`await self.app(scope, receive, send)`) for the rest. No check records what the
/// branch is for: it may be the guard.
fn answers_some_itself(cx: &Cx<'_>, m: &str) -> bool {
    let Some(d) = cx.context().definition(m) else {
        return false;
    };
    if d.kind != drift_core::SymbolKind::Class || d.name != common::short(m) {
        return false;
    }
    let own = format!("#{}.", d.name);
    d.members
        .iter()
        .filter(|x| x.name == "__call__" || x.name == "dispatch")
        .any(|x| {
            x.conditional_calls.iter().any(|c| {
                c.split_once(':').is_some_and(|(_, callee)| {
                    callee.contains(&own) && x.receiver_calls.iter().any(|r| r == callee)
                })
            })
        })
}

/// The package's Next.js middleware, when it authenticates, covers the route: its
/// `config.matcher` takes it (none declared: every route), no public list takes it,
/// and a protected list (if any) does. Matchers that cannot be read, a list of unknown
/// meaning, or a match that cannot be told: unknown [STRICT].
fn middleware(cx: &Cx<'_>, file: &FileFacts, route: &str, r: &mut Reading) {
    let ctx = cx.context();
    for mf in cx.facts.files.iter().filter(|f| f.package == file.package) {
        for e in mf.entry_points.iter().filter(|e| e.kind == "middleware") {
            if !mf.parse_ok {
                r.unknown(UnknownReason::Unparsed, &mf.path);
                continue;
            }
            let Some((df, s)) = common::handler(cx.facts, mf, &e.symbol) else {
                r.unknown(UnknownReason::NoSymbol, &mf.path);
                continue;
            };
            let me = canonical(df, s);
            if !security::authenticates(ctx, &me) {
                // [STRICT]: an auth library's middleware given a callback
                // (`clerkMiddleware(async (auth, req) => { if (isProtected(req)) await
                // auth.protect() })`) protects what the callback says, which is not
                // read: it may be the guard, for any route its `config.matcher` does
                // not leave out. Bare (`clerkMiddleware()`), it protects nothing.
                let library = s.wraps.iter().find(|w| {
                    w.kind == WrapKind::Call
                        && external(&w.wrapper)
                        && common::package_root(&w.wrapper).is_some_and(|p| auth_library(&p))
                });
                let callback = !s.calls.is_empty()
                    || s.controls.iter().any(|c| {
                        c == "await" || c == drift_core::controls::UNREAD_CALL
                    });
                let left_out = mf
                    .route_matchers
                    .iter()
                    .find(|m| m.binding == "config.matcher")
                    .is_some_and(|m| {
                        !common::matcher_opaque(m) && matches_any(&m.patterns, route) == Tri::No
                    });
                if let Some(w) = library
                    && callback
                    && !left_out
                {
                    r.call_unknown(UnknownReason::Unclassified, &w.wrapper);
                }
                continue;
            }
            let instrument = s
                .wraps
                .iter()
                .find(|w| w.kind == WrapKind::Call && external(&w.wrapper))
                .map_or(me.clone(), |w| w.wrapper.clone());
            let config = mf
                .route_matchers
                .iter()
                .find(|m| m.binding == "config.matcher");
            let in_config = match config {
                None => Tri::Yes,
                Some(m) if common::matcher_opaque(m) => Tri::Unsure,
                Some(m) => matches_any(&m.patterns, route),
            };
            if in_config == Tri::No {
                continue;
            }
            let mut opened = false;
            let mut unsure =
                in_config == Tri::Unsure || common::file_truncated(mf, "route_matchers");
            let mut protected_lists = false;
            let mut protected = false;
            for m in mf
                .route_matchers
                .iter()
                .filter(|m| m.binding != "config.matcher")
            {
                let Some(protects) = common::matcher_polarity(m) else {
                    unsure = true;
                    continue;
                };
                let hit = if common::matcher_opaque(m) {
                    Tri::Unsure
                } else {
                    matches_any(&m.patterns, route)
                };
                match (protects, hit) {
                    (_, Tri::Unsure) => unsure = true,
                    (false, Tri::Yes) => opened = true,
                    (true, Tri::Yes) => {
                        protected_lists = true;
                        protected = true;
                    }
                    (true, Tri::No) => protected_lists = true,
                    (false, Tri::No) => {}
                }
            }
            let binding = |m: &RouteMatcher| format!("{}#{}", mf.path, m.binding);
            if unsure {
                let first = mf
                    .route_matchers
                    .first()
                    .map_or(format!("{}#config.matcher", mf.path), binding);
                r.unknown(UnknownReason::Unresolved, &first);
            } else if opened {
                let public = mf
                    .route_matchers
                    .iter()
                    .find(|m| {
                        m.binding != "config.matcher" && common::matcher_polarity(m) == Some(false)
                    })
                    .map(binding)
                    .unwrap_or_default();
                r.add(OPENS, &public, VariantSource::Usage);
            } else if !protected_lists || protected {
                // [STRICT] The middleware runs for the path a request asks for: a
                // rewrite of the configuration that brings one here from a path
                // the middleware is not shown to guard leaves the route open.
                match rewritten_past(cx, mf, route) {
                    Some(config) => r.unknown(UnknownReason::Unresolved, &config),
                    // [STRICT] Its own refusals all stand after a return that
                    // serves some requests, under a branch or beside another
                    // condition (`if (OPEN.includes(pathname)) return
                    // NextResponse.next()` with a list from the environment, a
                    // `NextResponse.rewrite(...)` returned before the session is
                    // tested): which requests pass without them is not read.
                    None if refuses_only_sometimes(s) => {
                        r.unknown(UnknownReason::Unresolved, &me);
                    }
                    None => r.add("middleware", &instrument, source(&instrument)),
                }
            }
        }
    }
}

/// A middleware's own refusals of a caller who is not signed in all stand where only
/// some requests reach them ([`drift_core::BodyCheck::conditional`]), and it has
/// some: what it lets through before them is not read.
fn refuses_only_sometimes(s: &Symbol) -> bool {
    let mut refusals = s.body_checks.iter().filter(|c| {
        matches!(
            c.outcome,
            CheckOutcome::Unauthenticated | CheckOutcome::SignInRedirect
        )
    });
    refusals.clone().next().is_some() && refusals.all(|c| c.conditional)
}

/// The Next.js configuration of the middleware file `mf`'s package that rewrites a
/// request to `route` from a path `mf` is not shown to guard
/// ([`drift_core::Listed::rewrites`]): as `<file>#rewrites`. A rewrite that is not
/// read may go anywhere, from anywhere; one to another host reaches no route.
fn rewritten_past(cx: &Cx<'_>, mf: &FileFacts, route: &str) -> Option<String> {
    // The source as a route: `/open/:path*` is `/open/[[...path]]`.
    let as_route = |source: &str| -> Option<String> {
        let segs: Option<Vec<String>> = source
            .trim_start_matches('/')
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|seg| match seg.strip_prefix(':') {
                None => literal(seg).then(|| seg.to_string()),
                Some(name) => match name.as_bytes().last() {
                    Some(b'*') if literal(&name[..name.len() - 1]) => {
                        Some(format!("[[...{}]]", &name[..name.len() - 1]))
                    }
                    Some(b'+') if literal(&name[..name.len() - 1]) => {
                        Some(format!("[...{}]", &name[..name.len() - 1]))
                    }
                    _ => literal(name).then(|| format!("[{name}]")),
                },
            })
            .collect();
        Some(format!("/{}", segs?.join("/")))
    };
    // Every path the source takes is one the middleware guards: each of its lists
    // says so.
    let guarded = |source: &str| -> bool {
        let Some(source) = as_route(source) else {
            return false;
        };
        mf.route_matchers.iter().all(|m| {
            if common::matcher_opaque(m) {
                return false;
            }
            let hit = matches_any(&m.patterns, &source);
            match (m.binding == "config.matcher", common::matcher_polarity(m)) {
                (true, _) | (false, Some(true)) => hit == Tri::Yes,
                (false, Some(false)) => hit == Tri::No,
                (false, None) => false,
            }
        })
    };
    cx.facts
        .files
        .iter()
        .filter(|f| f.package == mf.package)
        .find(|f| {
            f.rewrites().iter().any(|w| {
                let d = w.destination.as_str();
                if d.starts_with("http://") || d.starts_with("https://") {
                    return false;
                }
                let reaches = d == "?"
                    || matches_any(
                        &[d.split(['?', '#']).next().unwrap_or_default().to_string()],
                        route,
                    ) != Tri::No;
                reaches && !guarded(&w.source)
            })
        })
        .map(|f| format!("{}#rewrites", f.path))
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn next_clerk_split_auth_is_one_key() {
        let facts = fixtures::next_clerk();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        // The page and the middleware are not in the population.
        assert_eq!(all.len(), 4, "{all:#?}");
        let route = "app/api/projects/[projectId]/route.ts";
        assert_eq!(
            key(&of(&all, route, "GET")),
            "body_check:pkg:@clerk/nextjs#auth.userId+middleware:pkg:@clerk/nextjs#clerkMiddleware"
        );
        assert_eq!(key(&of(&all, route, "GET")), key(&of(&all, route, "POST")));
        // A re-exported handler is read at its origin.
        assert_eq!(
            key(&of(&all, "app/api/legacy/route.ts", "GET")),
            key(&of(&all, route, "GET"))
        );
        // The webhook is public by the middleware's list and verifies its sender.
        assert_eq!(
            key(&of(&all, "app/api/webhooks/stripe/route.ts", "POST")),
            "opens:middleware.ts#isPublicRoute+service_auth:pkg:stripe#webhooks.constructEvent"
        );
    }

    #[test]
    fn fastapi_guard_dependency_not_get_db() {
        let facts = fixtures::fastapi_split();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        let items = "services/api/app/routers/items.py";
        for name in ["create_item", "read_item"] {
            assert_eq!(
                key(&of(&all, items, name)),
                "dependency:services/api/app/deps.py#get_current_user"
            );
        }
        // Flask view with nothing: a recorded absence.
        assert!(matches!(
            of(&all, "services/legacy/views.py", "show"),
            Assignment::None { .. }
        ));
    }

    #[test]
    fn nest_guards_from_decorator_args() {
        // No `decorator_args`: which guards `@UseGuards` applies is not known [STRICT].
        let facts = fixtures::nest_mixed();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        let ctl = "src/projects/projects.controller.ts";
        for name in ["GET /projects/:id", "POST /projects"] {
            assert_eq!(
                of(&all, ctl, name),
                unknown(UnknownReason::OpaqueWrapper, USE_GUARDS)
            );
        }
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        // The controller's guard and the app's global guard; the roles guard is authz.
        assert_eq!(
            key(&of(&all, "apps/nest/src/items.controller.ts", "GET /items")),
            "app_guard:apps/nest/src/auth.guard.ts#AuthGuard+decorator:apps/nest/src/jwt.guard.ts#JwtGuard"
        );
        let units = Authn.population(&cx);
        let items = units
            .iter()
            .find(|u| u.file().path == "apps/nest/src/items.controller.ts")
            .unwrap();
        assert_eq!(
            read(&cx, items).role_guards,
            ["apps/nest/src/roles.guard.ts#RolesGuard"]
        );
        // `@Public()` (built on SetMetadata) skips the global guard only where the
        // guard is read to let through a route that carries the key it sets. These
        // facts hold neither: whether the guard honours it is not known.
        let health = "apps/nest/src/health.controller.ts";
        assert_eq!(
            of(&all, health, "GET /health"),
            unknown(
                UnknownReason::Unresolved,
                "apps/nest/src/auth.guard.ts#AuthGuard"
            )
        );
        assert_eq!(
            key(&of(&all, health, "GET /status")),
            "app_guard:apps/nest/src/auth.guard.ts#AuthGuard"
        );
        // With what the lowering records of the decorator and of the guard.
        let mut facts = fixtures::ts_cases();
        for (path, name, control) in [
            (
                "apps/nest/src/public.decorator.ts",
                "Public",
                "sets_metadata:\"isPublic\"",
            ),
            (
                "apps/nest/src/auth.guard.ts",
                "AuthGuard",
                "opens_for_metadata:any:\"isPublic\"",
            ),
        ] {
            let f = facts.files.iter_mut().find(|f| f.path == path).unwrap();
            let s = f.symbols.iter_mut().find(|s| s.name == name).unwrap();
            s.controls.push(control.into());
        }
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        assert_eq!(
            key(&of(&all, health, "GET /health")),
            "opens:apps/nest/src/public.decorator.ts#Public"
        );
        assert_eq!(
            key(&of(&all, health, "GET /status")),
            "app_guard:apps/nest/src/auth.guard.ts#AuthGuard"
        );
    }

    #[test]
    fn a_declared_instrument_is_known() {
        // The engine's config hint for an unrecorded `@UseGuards`.
        let facts = fixtures::nest_mixed();
        let mut d = empty();
        d.entry(super::super::AUTHN.into())
            .or_default()
            .insert(USE_GUARDS.into(), "UseGuards".into());
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        let a = of(
            &all,
            "src/projects/projects.controller.ts",
            "GET /projects/:id",
        );
        assert_eq!(key(&a), format!("decorator:{USE_GUARDS}"));
        assert!(matches!(
            a,
            Assignment::Known {
                source: VariantSource::Declared,
                ..
            }
        ));
    }

    #[test]
    fn identified_service_and_enforced_are_apart() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        // A session read with no check: identified, not enforced.
        assert_eq!(
            key(&of(&all, "app/api/session/route.ts", "GET")),
            "identifies:pkg:next-auth#getServerSession"
        );
        assert_eq!(
            key(&of(&all, "app/api/cron/route.ts", "GET")),
            "service_auth:pkg:crypto#timingSafeEqual"
        );
        let py = fixtures::py_cases();
        let cx = Cx::new(&py, &d);
        let all = assign_all(&Authn, &cx);
        assert_eq!(
            key(&of(&all, "svc/app/hooks.py", "stripe_hook")),
            "service_auth:pkg:stripe#Webhook.construct_event"
        );
        assert_eq!(
            key(&of(&all, "svc/web/api.py", "Ping.get")),
            "identifies:pkg:rest_framework#authentication.TokenAuthentication"
        );
        // Identified and enforced is enforced.
        assert_eq!(
            key(&of(&all, "svc/web/api.py", "ItemList.get")),
            "config:pkg:rest_framework#permissions.IsAuthenticated"
        );
    }

    #[test]
    fn none_and_unknown_cases() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        assert!(matches!(
            of(&all, "app/api/open/route.ts", "GET"),
            Assignment::None { .. }
        ));
        assert_eq!(
            of(&all, "app/api/opaque/route.ts", "GET"),
            unknown(UnknownReason::OpaqueWrapper, "lib/wrap.ts#withThing")
        );
        // A call only its name says guards.
        assert_eq!(
            of(&all, "app/api/acl/route.ts", "GET"),
            unknown(UnknownReason::Unclassified, "pkg:acl-lib#authorize")
        );
        // Named like a guard, defined as no guard (PLAN-R14 A3): nothing guards it.
        assert!(matches!(
            of(&all, "app/api/signup/route.ts", "POST"),
            Assignment::None { .. }
        ));
        // A middleware matcher that cannot be read: never covered, never uncovered.
        assert_eq!(
            of(&all, "apps/mw/app/api/x/route.ts", "GET"),
            unknown(
                UnknownReason::Unresolved,
                "apps/mw/middleware.ts#config.matcher"
            )
        );
        // A declared instrument is known.
        let mut d = empty();
        d.entry(super::super::AUTHN.into())
            .or_default()
            .insert("pkg:next-auth#getServerSession".into(), "session".into());
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        assert_eq!(
            key(&of(&all, "app/api/session/route.ts", "GET")),
            "body_call:pkg:next-auth#getServerSession"
        );
        let py = fixtures::py_cases();
        let d = empty();
        let cx = Cx::new(&py, &d);
        let all = assign_all(&Authn, &cx);
        assert_eq!(
            of(&all, "svc/app/routes.py", "legacy"),
            unknown(UnknownReason::Unresolved, "unresolved:guards#check")
        );
        assert_eq!(
            of(&all, "svc/app/broken.py", "broken"),
            unknown(UnknownReason::Unparsed, "svc/app/broken.py")
        );
        assert_eq!(
            key(&of(&all, "svc/web/views.py", "ItemView.get")),
            "decorator:pkg:django#contrib.auth.decorators.login_required"
        );
        assert!(matches!(
            of(&all, "svc/app/routes.py", "list_items"),
            Assignment::None { .. }
        ));
    }

    #[test]
    fn matchers_are_tri_state() {
        let p = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            matches_any(&p(&["/api/(.*)"]), "/api/projects/[id]"),
            Tri::Yes
        );
        assert_eq!(
            matches_any(&p(&["/api/webhooks(.*)"]), "/api/projects/[id]"),
            Tri::No
        );
        assert_eq!(
            matches_any(&p(&["/api/webhooks(.*)"]), "/api/webhooks/stripe"),
            Tri::Yes
        );
        assert_eq!(matches_any(&p(&["/api/:path*"]), "/api/x"), Tri::Yes);
        assert_eq!(matches_any(&p(&["/api/:id"]), "/api/[id]"), Tri::Yes);
        assert_eq!(matches_any(&p(&["/admin"]), "/[slug]"), Tri::Unsure);
        assert_eq!(matches_any(&p(&["/((?!_next).*)"]), "/api/x"), Tri::Unsure);
        assert_eq!(matches_any(&p(&["/api/(.*)"]), "/api"), Tri::Unsure);
        assert_eq!(matches_any(&p(&["/dash"]), "/api/x"), Tri::No);
    }

    #[test]
    fn promotion_is_deferred() {
        // PLAN-R13 §9.6: no variant maps to a rule this round.
        let key = super::super::VariantKey::new(&[use_of("wrap", "lib/a.ts#withAuth")]);
        assert_eq!(Authn.promotable(&key), None);
    }

    /// The Studio acme shape (fix round, FALSE_NONE gate): `@UseGuards(AuthGuard)`
    /// where `canActivate` returns `Boolean(headers.authorization)`: through the shared
    /// guard proof (Nest's contract) it is that guard. With the guard classes not
    /// recorded (facts from before `decorator_args`) it is unknown. Never none.
    #[test]
    fn nest_use_guards_is_never_none() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        let guard = "apps/acme/src/common/auth.guard.ts#AuthGuard";
        let with_args = of(
            &all,
            "apps/acme/src/projects/projects.controller.ts",
            "GET /projects/:id",
        );
        assert_eq!(key(&with_args), format!("decorator:{guard}"));
        assert_eq!(
            of(
                &all,
                "apps/acme/src/teams/teams.controller.ts",
                "GET /teams/:id"
            ),
            unknown(UnknownReason::OpaqueWrapper, USE_GUARDS)
        );
        // Through the engine too: no acme route is a recorded absence.
        let acme = drift_core::RepoFacts {
            files: facts
                .files
                .iter()
                .filter(|f| {
                    f.path.ends_with("auth.guard.ts")
                        || f.path.ends_with("projects.controller.ts")
                        || f.path.ends_with("teams.controller.ts")
                })
                .cloned()
                .collect(),
            ..facts.clone()
        };
        let r = super::super::practices(&acme, &super::super::Options::default());
        let authn = r
            .concerns
            .iter()
            .find(|c| c.id == super::super::AUTHN)
            .unwrap();
        assert_eq!(authn.population.none, 0, "{:#?}", authn.population);
    }

    /// Composed decorators guard only through the `UseGuards` they apply; metadata
    /// decorators open a route only when named public; throwing an error class is no
    /// guard call.
    #[test]
    fn composed_and_metadata_decorators() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        let alerts = "apps/acme/src/alerts/alerts.controller.ts";
        assert_eq!(
            of(&all, alerts, "GET /alerts"),
            unknown(
                UnknownReason::OpaqueWrapper,
                "apps/acme/src/framework/decorators.ts#RequireAuthentication"
            )
        );
        // A response-schema decorator whose body mentions 401 guards nothing.
        assert!(matches!(
            of(&all, alerts, "GET /alerts/open"),
            Assignment::None { .. }
        ));
    }

    /// A composed decorator whose guard class the handler records (`UseGuards=<G>` in
    /// `decorator_args`, from `applyDecorators(UseGuards(G))`) is decided by that class:
    /// known, not opaque.
    #[test]
    fn a_composed_decorator_is_decided_by_the_guard_class_it_delivers() {
        let mut facts = fixtures::ts_cases();
        let alerts = "apps/acme/src/alerts/alerts.controller.ts";
        let s = facts
            .files
            .iter_mut()
            .find(|f| f.path == alerts)
            .unwrap()
            .symbols
            .iter_mut()
            .find(|s| s.name == "GET /alerts")
            .unwrap();
        s.decorator_args
            .push("pkg:@nestjs/common#UseGuards=apps/nest/src/auth.guard.ts#AuthGuard".into());
        // The handler's other decorator sets a key the guard does not read
        // (`RequirePermissions = (...p) => SetMetadata(PERMISSIONS, p)`), as the
        // lowering records it: it changes nothing for the guard.
        facts
            .files
            .iter_mut()
            .find(|f| f.path == "apps/acme/src/framework/decorators.ts")
            .unwrap()
            .symbols
            .iter_mut()
            .find(|s| s.name == "RequirePermissions")
            .unwrap()
            .controls
            .push("sets_metadata:~\"permissions\"".into());
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        assert_eq!(
            key(&of(&all, alerts, "GET /alerts")),
            "decorator:apps/nest/src/auth.guard.ts#AuthGuard"
        );
    }

    /// The handler a wrapper is given by reference is read (`respond(deleteHandler)`).
    /// An awaited call whose body cannot be read is unknown; awaiting a read of the
    /// request is not (the card's r39 gap stays a none).
    #[test]
    fn handler_bodies_and_unread_calls() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        assert_eq!(
            key(&of(&all, "app/api/calendar/route.ts", "DELETE")),
            "body_call:app/api/calendar/route.ts#authMiddleware"
        );
        assert!(matches!(
            of(&all, "backend/routes/acme.ts", "POST /new-account"),
            Assignment::None { .. }
        ));
        assert!(matches!(
            of(&all, "app/api/r39/route.ts", "POST"),
            Assignment::None { .. }
        ));
        assert_eq!(
            of(&all, "app/api/access/route.ts", "GET"),
            unknown(
                UnknownReason::Unclassified,
                "unresolved:./access#checkAccess"
            )
        );
        assert_eq!(
            of(&all, "app/api/opaque-helper/route.ts", "GET"),
            unknown(UnknownReason::BodyUnreadable, "lib/missing.ts#loadStuff")
        );
    }

    /// Pilot fixes: the authn instrument is the guard that rejects. A bearer-scheme
    /// subclass and a callable role check are read through `__call__`; a context
    /// reader is never the instrument; a client factory or file loader is no guard.
    #[test]
    fn proving_guards_only() {
        let facts = fixtures::py_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        let r = "svc/sec/routes.py";
        let bearer = "dependency:svc/sec/auth.py#JWTBearer";
        assert_eq!(key(&of(&all, r, "bearer")), bearer);
        // The role check is authz's when the bearer signs the caller in.
        assert_eq!(key(&of(&all, r, "admin")), bearer);
        assert_eq!(
            key(&of(&all, r, "role_only")),
            "dependency:svc/sec/auth.py#RoleChecker"
        );
        assert_eq!(
            key(&of(&all, r, "ctx")),
            "dependency:svc/sec/auth.py#get_current_user"
        );
        for name in ["billing", "billing2"] {
            assert!(
                matches!(of(&all, r, name), Assignment::None { .. }),
                "{name}"
            );
        }
    }

    /// A Clerk middleware with no protect call covers no route, through the engine:
    /// its routes are none, not unknown (dynamic).
    #[test]
    fn an_open_middleware_covers_nothing() {
        let facts = fixtures::ts_cases();
        let open = drift_core::RepoFacts {
            files: facts
                .files
                .iter()
                .filter(|f| f.package == "apps/open")
                .cloned()
                .collect(),
            ..facts.clone()
        };
        let r = super::super::practices(&open, &super::super::Options::default());
        let authn = r
            .concerns
            .iter()
            .find(|c| c.id == super::super::AUTHN)
            .unwrap();
        assert_eq!(
            (authn.population.none, authn.population.unknown),
            (1, 0),
            "{:#?}",
            authn.population
        );
    }

    /// `svc/app/routes.py` with one of its routes rewritten: the entry point `symbol`
    /// renamed to `name`, served at `method route`, its handler carrying `controls`.
    fn rerouted(
        symbol: &str,
        name: &str,
        method: &str,
        route: &str,
        controls: &[&str],
    ) -> Assignment {
        let path = "svc/app/routes.py";
        let mut facts = fixtures::py_cases();
        let f = facts.files.iter_mut().find(|f| f.path == path).unwrap();
        let e = f
            .entry_points
            .iter_mut()
            .find(|e| e.symbol == symbol)
            .unwrap();
        e.symbol = name.into();
        e.method = Some(method.into());
        e.route = Some(route.into());
        let s = f.symbols.iter_mut().find(|s| s.name == symbol).unwrap();
        s.name = name.into();
        s.exported_as = vec![name.into()];
        s.controls = controls.iter().map(|c| c.to_string()).collect();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        of(&assign_all(&Authn, &cx), path, name)
    }

    /// A liveness or readiness probe is public on purpose: a `GET` on a probe path,
    /// alone or under a mount prefix, whose handler provably reads no input, is recorded
    /// as open. The method, the path and the absence of input decide; the handler's
    /// name never does, and a guard or an unknown that was found stays what it is.
    #[test]
    fn a_probe_that_reads_no_input_is_open_not_none() {
        let none = [drift_core::controls::NO_INPUT];
        for (method, route) in [
            ("GET", "/health"),
            ("GET", "/healthz"),
            ("GET", "/billing/health/"),
            ("GET", "/api/v1/health/ready"),
            ("GET", "/{service_name}/health"),
            ("HEAD", "/livez"),
        ] {
            let a = rerouted("list_items", "list_items", method, route, &none);
            assert_eq!(key(&a), "opens:probe", "{method} {route}");
            assert!(
                matches!(
                    &a,
                    Assignment::Known { label, source: VariantSource::Vocab, .. }
                        if label == "opens probe"
                ),
                "{a:?}"
            );
        }
        for (name, method, route, controls) in [
            // Not a probe path, whatever the handler is called.
            ("health_check", "GET", "/items", &none[..]),
            ("health_check", "GET", "/apihealth", &none[..]),
            ("health_check", "GET", "/health/items", &none[..]),
            ("health_check", "GET", "/", &none[..]),
            // A probe is read, not written to.
            ("health_check", "POST", "/health", &none[..]),
            ("health_check", "ANY", "/health", &none[..]),
            // It reads input, or Drift cannot tell that it reads none.
            (
                "health_check",
                "GET",
                "/health",
                &[drift_core::controls::READS_INPUT][..],
            ),
            ("health_check", "GET", "/health", &[][..]),
        ] {
            let a = rerouted("list_items", name, method, route, controls);
            assert!(
                matches!(a, Assignment::None { .. }),
                "{name} {method} {route} {controls:?}: {a:?}"
            );
        }
        // A guarded probe keeps its guard; an unknown one stays unknown.
        let guarded = rerouted("admin_items", "admin_items", "GET", "/admin/items", &none);
        assert!(guarded != Assignment::None { label: "no guard, nothing opens it".into() });
        assert_eq!(
            rerouted("admin_items", "admin_items", "GET", "/health", &none),
            guarded
        );
        assert_eq!(
            rerouted("legacy", "legacy", "GET", "/health", &none),
            unknown(UnknownReason::Unresolved, "unresolved:guards#check")
        );
        // A probe opens the route: it signs nobody in.
        let mut facts = fixtures::py_cases();
        let f = facts
            .files
            .iter_mut()
            .find(|f| f.path == "svc/app/routes.py")
            .unwrap();
        let e = f
            .entry_points
            .iter_mut()
            .find(|e| e.symbol == "list_items")
            .unwrap();
        e.route = Some("/health".into());
        let s = f.symbols.iter_mut().find(|s| s.name == "list_items").unwrap();
        s.controls = vec![drift_core::controls::NO_INPUT.into()];
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let units = Authn.population(&cx);
        let unit = units
            .iter()
            .find(|u| matches!(u, UnitRef::Entry { entry, .. } if entry.symbol == "list_items"))
            .unwrap();
        assert!(!read(&cx, unit).signs_in());
    }

    /// An in-repo signature check that rejects is a service caller, not user sign-in.
    #[test]
    fn in_repo_signature_checks_are_service_auth() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        assert_eq!(
            key(&of(&all, "app/api/cron/aggregate/route.ts", "POST")),
            "service_auth:lib/cron/verify-qstash.ts#verifyQstashSignature"
        );
    }

    /// Calls through a handler parameter (`param:server.services.x.canRevoke`) are
    /// never guards by name and never demote a unit a proven guard signs in; with no
    /// guard, an awaited one may be the auth step: unknown.
    #[test]
    fn param_callees_never_demote_a_proven_guard() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Authn, &cx);
        let f = "backend/routes/secrets.ts";
        assert_eq!(
            key(&of(&all, f, "DELETE /secrets/:id")),
            "wrap:backend/auth/verify-auth.ts#verifyAuth"
        );
        assert_eq!(
            of(&all, f, "GET /secrets/raw"),
            unknown(
                UnknownReason::BodyUnreadable,
                "param:server.services.secret.canRevoke"
            )
        );
    }

    const REQUIRE: &str = "lib/helpers.ts#requireSession";
    const ASSERT: &str = "lib/helpers.ts#assertSession";
    const TENANT: &str = "lib/helpers.ts#require_tenant";
    const PARSE: &str = "lib/helpers.ts#parseBody";
    const OPTIONAL: &str = "lib/helpers.ts#optionalSession";

    /// A Next.js app whose `GET app/api/<name>/route.ts` handlers call helpers of
    /// `lib/helpers.ts` in their bodies: `requireSession` answers 401, the others throw
    /// a plain `Error` (which turns no caller away that the facts can show).
    fn body_calls(routes: &[(String, Vec<&str>)]) -> drift_core::RepoFacts {
        use drift_core::{EntryPoint, RepoFacts};
        let helper = |r: &str, rejects: bool| Symbol {
            name: r.rsplit('#').next().unwrap().into(),
            exported_as: vec![r.rsplit('#').next().unwrap().into()],
            calls: if rejects {
                vec![]
            } else {
                vec!["global#Error(new)".into()]
            },
            controls: vec![if rejects {
                drift_core::controls::REJECTS_CALLER.into()
            } else {
                "throw".into()
            }],
            throws: if rejects {
                vec![]
            } else {
                vec!["global#Error".into()]
            },
            ..Symbol::default()
        };
        let mut files = vec![FileFacts {
            path: "lib/helpers.ts".into(),
            parse_ok: true,
            symbols: vec![
                helper(REQUIRE, true),
                helper(ASSERT, false),
                helper(TENANT, false),
                helper(PARSE, false),
                helper(OPTIONAL, false),
            ],
            ..FileFacts::default()
        }];
        for (i, (name, calls)) in routes.iter().enumerate() {
            files.push(FileFacts {
                path: format!("app/api/{name}/route.ts"),
                parse_ok: true,
                symbols: vec![Symbol {
                    name: "GET".into(),
                    exported_as: vec!["GET".into()],
                    line: 3 + i as u32,
                    calls: calls.iter().map(|c| c.to_string()).collect(),
                    ..Symbol::default()
                }],
                entry_points: vec![EntryPoint {
                    symbol: "GET".into(),
                    kind: "http".into(),
                    method: Some("GET".into()),
                    route: Some(format!("/api/{name}")),
                    adapter: "nextjs".into(),
                }],
                ..FileFacts::default()
            });
        }
        RepoFacts {
            files,
            ..RepoFacts::default()
        }
    }

    /// `n` routes `<stem>0..n` that each call `calls`.
    fn calling(stem: &str, n: usize, calls: &[&'static str]) -> Vec<(String, Vec<&'static str>)> {
        (0..n)
            .map(|i| (format!("{stem}{i}"), calls.to_vec()))
            .collect()
    }

    /// The routes of the three outcomes, and one a proven guard signs in that also
    /// calls a helper that only looks like one.
    fn three_outcomes() -> drift_core::RepoFacts {
        let mut routes = calling("sess", 40, &[REQUIRE]);
        routes.extend(calling("named", 2, &[ASSERT]));
        routes.extend(calling("tenant", 2, &[TENANT, PARSE]));
        routes.extend(calling("parse", 2, &[PARSE]));
        routes.extend(calling("optional", 2, &[OPTIONAL]));
        routes.extend(calling("both", 1, &[REQUIRE, ASSERT]));
        body_calls(&routes)
    }

    fn authn_of(
        facts: &drift_core::RepoFacts,
        declared: super::super::Declared,
    ) -> super::super::ConcernReport {
        let opts = super::super::Options {
            units: true,
            declared,
            ..Default::default()
        };
        let r = super::super::practices(facts, &opts);
        r.concerns
            .into_iter()
            .find(|c| c.id == super::super::AUTHN)
            .unwrap()
    }

    /// The unit of `app/api/<name>/route.ts`: its assignment, its unknown reason and
    /// its variant's key ("" when unknown).
    fn outcome(
        c: &super::super::ConcernReport,
        name: &str,
    ) -> (String, Option<UnknownReason>, String) {
        let path = format!("app/api/{name}/route.ts");
        let u = c.units.iter().find(|u| u.path == path).unwrap();
        let key = c
            .variants
            .iter()
            .find(|v| v.id == u.variant)
            .map(|v| v.key.clone())
            .unwrap_or_default();
        (u.assignment.clone(), u.reason, key)
    }

    /// A proven guard the body calls only after it hands control on is no body call in
    /// either report ([`security::not_a_body_call`]): `drift security` lists no guard
    /// for the route, and the map says none, as it does of a route that calls nothing.
    /// The same guard called before stays a guard in both.
    #[test]
    fn a_guard_called_only_after_the_continuation_is_no_body_call_on_either_surface() {
        let mut facts = three_outcomes();
        let handler = facts
            .files
            .iter_mut()
            .find(|f| f.path == "app/api/sess0/route.ts")
            .and_then(|f| {
                f.symbols
                    .iter_mut()
                    .find(|s| s.calls.iter().any(|c| c == REQUIRE))
            })
            .expect("the route that calls the guard");
        handler.after_continuation = vec![REQUIRE.into()];
        let c = authn_of(&facts, empty());
        assert_eq!(outcome(&c, "sess0").0, "none", "{:?}", outcome(&c, "sess0"));
        assert_eq!(
            outcome(&c, "sess1"),
            ("known".to_string(), None, format!("body_call:{REQUIRE}"))
        );
        let inv = security::inventory(&facts);
        let row = |name: &str| {
            let path = format!("app/api/{name}/route.ts");
            inv.entry_points
                .iter()
                .find(|e| e.path == path)
                .unwrap_or_else(|| panic!("{path}"))
        };
        assert!(row("sess0").unguarded(), "{:?}", row("sess0"));
        assert_eq!(row("sess1").guards, ["requireSession (body call)"]);
    }

    /// One rule for a call in a handler's body, on both surfaces
    /// ([`security::BodyCall`]). Proven to reject: known here, a guard in `drift
    /// security`. Looks like a guard (shared, throws, named for access) and not shown
    /// to reject: unknown here with the helper as the instrument and a `practices:`
    /// line offered, `opaque` there, so neither says "guarded" or "no guard". Anything
    /// else, a name that opens access included: none, no guard. A unit a proven guard
    /// signs in is never demoted by a look-alike beside it.
    #[test]
    fn a_body_call_is_a_guard_unknown_or_nothing_on_both_surfaces() {
        let facts = three_outcomes();
        let c = authn_of(&facts, empty());
        let known = ("known".to_string(), None, format!("body_call:{REQUIRE}"));
        let unknown = (
            "unknown".to_string(),
            Some(UnknownReason::Unclassified),
            String::new(),
        );
        for name in ["sess0", "sess39", "both0"] {
            assert_eq!(outcome(&c, name), known, "{name}");
        }
        for name in ["named0", "named1", "tenant0", "tenant1"] {
            assert_eq!(outcome(&c, name), unknown, "{name}");
        }
        for name in ["parse0", "parse1", "optional0", "optional1"] {
            assert_eq!(outcome(&c, name).0, "none", "{name}");
        }
        assert_eq!(
            (c.population.known, c.population.unknown, c.population.none),
            (41, 4, 4)
        );
        // The helper is the instrument, and a line that names it is offered.
        let hint = |r: &str| super::super::InstrumentCount {
            instrument: r.to_string(),
            members: 2,
            config_hint: format!(
                "practices: {{authn: {{\"{r}\": \"{}\"}}}}",
                r.rsplit('#').next().unwrap()
            ),
        };
        assert_eq!(c.unknown.instruments, [hint(ASSERT), hint(TENANT)]);
        // No variant is built on a helper that is not proven.
        for v in &c.variants {
            for r in [ASSERT, TENANT, PARSE, OPTIONAL] {
                assert!(!v.key.contains(r), "{}", v.key);
            }
        }

        // `drift security` reads every one of them the same way.
        let inv = security::inventory(&facts);
        for u in &c.units {
            let e = inv
                .entry_points
                .iter()
                .find(|e| e.path == u.path)
                .unwrap();
            let row = if !e.guards.is_empty() {
                "known"
            } else if !e.opaque.is_empty() {
                "unknown"
            } else {
                "none"
            };
            assert_eq!(row, u.assignment, "{}: {e:?}", u.path);
        }
        let row = |name: &str| {
            let path = format!("app/api/{name}/route.ts");
            let e = inv.entry_points.iter().find(|e| e.path == path).unwrap();
            (e.guards.join(","), e.opaque.join(","))
        };
        let guard = "requireSession (body call)".to_string();
        let looks = "assertSession (body call)".to_string();
        assert_eq!(row("sess0"), (guard.clone(), String::new()));
        assert_eq!(row("named0"), (String::new(), looks.clone()));
        assert_eq!(
            row("tenant0"),
            (String::new(), "require_tenant (body call)".to_string())
        );
        assert_eq!(row("both0"), (guard, looks));
        assert_eq!(row("parse0"), (String::new(), String::new()));
        assert_eq!(row("optional0"), (String::new(), String::new()));
    }

    /// A person who names the helper (the offered `practices:` line) makes its units
    /// known, by that helper as a declared body call.
    #[test]
    fn naming_an_unproven_body_call_makes_its_units_known() {
        let facts = three_outcomes();
        let mut d = empty();
        d.entry(super::super::AUTHN.into())
            .or_default()
            .insert(ASSERT.into(), "assertSession".into());
        let c = authn_of(&facts, d);
        for name in ["named0", "named1"] {
            assert_eq!(
                outcome(&c, name),
                ("known".to_string(), None, format!("body_call:{ASSERT}")),
                "{name}"
            );
        }
        let v = c
            .variants
            .iter()
            .find(|v| v.key == format!("body_call:{ASSERT}"))
            .unwrap();
        assert_eq!((v.members, v.source), (2, VariantSource::Declared));
        // What was not named stays unknown, and is still offered.
        assert_eq!(outcome(&c, "tenant0").0, "unknown");
        assert_eq!(
            c.unknown
                .instruments
                .iter()
                .map(|i| i.instrument.as_str())
                .collect::<Vec<_>>(),
            [TENANT]
        );
        assert_eq!(
            (c.population.known, c.population.unknown, c.population.none),
            (43, 2, 4)
        );
    }

    /// An unknown is never told to an agent as a fact: a route that calls only a
    /// helper that looks like a guard is no departure from the guard the routes around
    /// it use, and its card line says nothing of authn. A route with nothing is one.
    #[test]
    fn an_unproven_body_call_is_never_a_departure() {
        let facts = three_outcomes();
        let opts = super::super::Options {
            units: true,
            ..Default::default()
        };
        let report = super::super::practices(&facts, &opts);
        let departs = |name: &str| {
            let path = format!("app/api/{name}/route.ts");
            super::super::departures(&report, Some(&path))
                .into_iter()
                .filter(|d| d.concern == super::super::AUTHN)
                .map(|d| d.line())
                .collect::<Vec<_>>()
        };
        let none = departs("parse0");
        assert_eq!(none.len(), 1, "{none:?}");
        assert!(
            none[0].contains("use body call requireSession")
                && none[0].contains("none: no guard found in what Drift read"),
            "{none:?}"
        );
        for name in ["named0", "tenant0", "sess0", "both0"] {
            assert_eq!(departs(name), Vec::<String>::new(), "{name}");
        }
        let card = |name: &str| {
            let path = format!("app/api/{name}/route.ts");
            super::super::card_lines(&facts, &opts, &path)
                .into_iter()
                .filter(|l| l.trim_start().starts_with("authn:"))
                .collect::<Vec<_>>()
        };
        assert_eq!(card("named0"), Vec::<String>::new());
        assert_eq!(card("parse0").len(), 1);
    }

    /// One `POST` route per `(path, calls, checks)`, in a file of that path's language:
    /// its handler awaits, calls `calls` and makes the caller checks whose sources are
    /// `checks` (each answers 401).
    fn handlers(spec: &[(&str, &[&str], &[&str])]) -> drift_core::RepoFacts {
        use drift_core::{BodyCheck, EntryPoint, RepoFacts};
        let mut files: Vec<FileFacts> = spec
            .iter()
            .map(|(path, calls, checks)| {
                let mut calls: Vec<String> = calls.iter().map(|c| c.to_string()).collect();
                calls.sort();
                let py = path.ends_with(".py");
                // What Python lowering 66 records of a verifier called on every
                // request ([`drift_core::controls::VERIFIES_SIGNATURE`]).
                let mut controls = vec!["await".to_string()];
                controls.extend(
                    calls
                        .iter()
                        .filter(|c| {
                            py && drift_core::guard_lists::signature_verifier(c)
                                .is_some_and(|v| v.throws)
                        })
                        .map(|c| format!("{}{c}", drift_core::controls::VERIFIES_SIGNATURE)),
                );
                FileFacts {
                    path: path.to_string(),
                    lang: path.rsplit('.').next().unwrap().into(),
                    parse_ok: true,
                    symbols: vec![Symbol {
                        name: "handle".into(),
                        exported_as: vec!["handle".into()],
                        line: 3,
                        calls,
                        controls,
                        body_checks: checks
                            .iter()
                            .map(|c| BodyCheck {
                                source: c.to_string(),
                                outcome: CheckOutcome::Unauthenticated,
                                ..BodyCheck::default()
                            })
                            .collect(),
                        ..Symbol::default()
                    }],
                    entry_points: vec![EntryPoint {
                        symbol: "handle".into(),
                        kind: "http".into(),
                        method: Some("POST".into()),
                        route: Some(format!("/{path}")),
                        adapter: "test".into(),
                    }],
                    ..FileFacts::default()
                }
            })
            .collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        RepoFacts {
            files,
            ..RepoFacts::default()
        }
    }

    fn assigned(facts: &drift_core::RepoFacts, path: &str) -> Assignment {
        let d = empty();
        let cx = Cx::new(facts, &d);
        of(&assign_all(&Authn, &cx), path, "handle")
    }

    /// A webhook verifier called on an object built in place is the verifier
    /// (`Webhook(secret).verify(..)` in Python, `new Webhook(secret).verify(..)` in
    /// TypeScript: svix's `Webhook.verify`): the sender is a service, known as
    /// `service_auth`, and never a user's sign-in. A `verify` of a class no table
    /// knows stays unknown.
    #[test]
    fn a_verifier_called_on_a_built_object_is_service_auth() {
        const PY: &str = "pkg:svix#webhooks.Webhook().verify";
        const TS: &str = "pkg:svix#Webhook(new).verify";
        const OTHER: &str = "pkg:acme_sdk#Gate().verify";
        let facts = handlers(&[
            ("svc/hooks.py", &[PY, "pkg:svix#webhooks.Webhook"], &[]),
            ("app/api/hooks/route.ts", &[TS], &[TS]),
            ("svc/other.py", &[OTHER], &[]),
        ]);
        for (path, callee) in [("svc/hooks.py", PY), ("app/api/hooks/route.ts", TS)] {
            let a = assigned(&facts, path);
            assert_eq!(key(&a), format!("service_auth:{callee}"), "{path}");
            assert!(
                matches!(
                    a,
                    Assignment::Known {
                        source: VariantSource::Vocab,
                        ..
                    }
                ),
                "{path}: {a:?}"
            );
        }
        assert_eq!(
            assigned(&facts, "svc/other.py"),
            unknown(UnknownReason::Unclassified, OTHER)
        );
    }

    /// A call through a parameter annotated with a package's type is that package's
    /// method, which the facts name beside the `param:` one: reading the body of a
    /// `request: NextRequest` is the framework's own code, so a route that does only
    /// that has no guard (none), not an unread call. The strict side stays: a call
    /// through a parameter with no type has no other name and may be the auth step,
    /// and so may a method of an in-repo type, whether the facts define it or not.
    #[test]
    fn a_call_on_a_package_typed_parameter_is_the_packages() {
        let mut facts = handlers(&[
            (
                "app/api/ingest/route.ts",
                &[
                    "param:request.json",
                    "pkg:next/server#NextRequest.json",
                    "pkg:next/server#NextResponse.json",
                ],
                &[],
            ),
            (
                // A longer path may be an untyped parameter's beside the typed one's
                // (`ctx.nextUrl.searchParams.get()`): the names cannot tell them apart.
                "app/api/deep/route.ts",
                &[
                    "param:ctx.nextUrl.searchParams.get",
                    "param:request.nextUrl.searchParams.get",
                    "pkg:next/server#NextRequest.nextUrl.searchParams.get",
                    "pkg:next/server#NextResponse.json",
                ],
                &[],
            ),
            (
                // The body also hands a value to a call the facts did not record
                // (`ctx.json(body)` on a parameter with no type), marked below.
                "app/api/handed/route.ts",
                &[
                    "param:request.json",
                    "pkg:next/server#NextRequest.json",
                    "pkg:next/server#NextResponse.json",
                ],
                &[],
            ),
            (
                "app/api/untyped/route.ts",
                &[
                    "param:deps.jobs.run",
                    "pkg:next/server#NextResponse.json",
                ],
                &[],
            ),
            (
                // Another receiver's method of the same name is not the parameter's type.
                "app/api/other/route.ts",
                &["param:deps.jobs.run", "pkg:acme-sdk#Client.run"],
                &[],
            ),
            (
                "app/api/in-repo/route.ts",
                &["param:gate.load", "lib/gate.ts#Gate.load"],
                &[],
            ),
            (
                // The in-repo class is defined, and a package has a method of the name.
                "app/api/service/route.ts",
                &[
                    "lib/users.ts#UsersService.find",
                    "param:svc.find",
                    "pkg:acme-sdk#Client.find",
                ],
                &[],
            ),
        ]);
        facts.files.push(FileFacts {
            path: "lib/users.ts".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![Symbol {
                name: "UsersService".into(),
                kind: drift_core::SymbolKind::Class,
                exported_as: vec!["UsersService".into()],
                ..Symbol::default()
            }],
            ..FileFacts::default()
        });
        for f in &mut facts.files {
            if f.path == "app/api/handed/route.ts" {
                f.symbols[0]
                    .controls
                    .push(drift_core::controls::UNREAD_CALL.into());
            }
        }
        facts.files.sort_by(|a, b| a.path.cmp(&b.path));
        let a = assigned(&facts, "app/api/ingest/route.ts");
        assert!(matches!(a, Assignment::None { .. }), "{a:?}");
        // The request's own method, unread only for what else the body hands on: the
        // handler is what is read in part, not `request.json`.
        assert_eq!(
            assigned(&facts, "app/api/handed/route.ts"),
            unknown(UnknownReason::PartlyRead, "app/api/handed/route.ts#handle")
        );
        for (path, instrument) in [
            ("app/api/deep/route.ts", "param:ctx.nextUrl.searchParams.get"),
            ("app/api/untyped/route.ts", "param:deps.jobs.run"),
            ("app/api/other/route.ts", "param:deps.jobs.run"),
            ("app/api/in-repo/route.ts", "lib/gate.ts#Gate.load"),
            ("app/api/service/route.ts", "param:svc.find"),
        ] {
            assert_eq!(
                assigned(&facts, path),
                unknown(UnknownReason::BodyUnreadable, instrument),
                "{path}"
            );
        }
    }

    /// A call that builds an object is never a guard by its name: it makes a value the
    /// handler uses, whatever the class is called. TypeScript marks it `(new)`; Python
    /// has no `new`, so a call of a class by its name (PEP 8) is read the same way. An
    /// endpoint that mints a token from `CreateSessionRequestBody(user_id=..)` and
    /// checks nothing has no guard: none, not unknown. The strict side stays: a
    /// package's function named for access, and a method called on what was built, may
    /// be the sign-in step and cannot be read.
    #[test]
    fn building_an_object_is_never_a_guard_by_name() {
        const BODY: &str = "pkg:clerk_backend_api#CreateSessionRequestBody";
        let facts = handlers(&[
            ("svc/mint.py", &[BODY, "pkg:fastapi#Query"], &[]),
            ("svc/nested.py", &["pkg:acme_sdk#models.SessionToken"], &[]),
            ("svc/function.py", &["pkg:acme_sdk#require_session"], &[]),
            ("svc/method.py", &["pkg:acme_sdk#SessionGate().authorize"], &[]),
            ("svc/constant.py", &["pkg:acme_sdk#ACL"], &[]),
            ("web/new.ts", &["pkg:acme-sdk#SessionToken(new)"], &[]),
            ("web/called.ts", &["pkg:acme-sdk#SessionToken"], &[]),
        ]);
        for path in ["svc/mint.py", "svc/nested.py", "web/new.ts"] {
            let a = assigned(&facts, path);
            assert!(matches!(a, Assignment::None { .. }), "{path}: {a:?}");
        }
        for (path, callee) in [
            ("svc/function.py", "pkg:acme_sdk#require_session"),
            ("svc/method.py", "pkg:acme_sdk#SessionGate().authorize"),
            // Not a class by its name: read as before.
            ("svc/constant.py", "pkg:acme_sdk#ACL"),
            // TypeScript builds with `new`: a capitalised name called without it is a
            // function, and one named for access may be the guard.
            ("web/called.ts", "pkg:acme-sdk#SessionToken"),
        ] {
            assert_eq!(
                assigned(&facts, path),
                unknown(UnknownReason::Unclassified, callee),
                "{path}"
            );
        }
    }
}
