//! What stands at a guard position of a Python route, decided in one place.
//!
//! A guard position is where a framework runs something before a handler, or in
//! its place: a decorator of the view, a FastAPI dependency (of the handler, the
//! route, a router, a mount or the application), a hook (`before_request`), a
//! base of the view class, a permission class, a middleware. [`classify`] says
//! of the thing written there one of three things ([`Verdict`]):
//!
//! - **a guard**: it turns away every request that comes without an identity;
//! - **not a guard**: it is read to the end and turns no one away, or a closed
//!   list says it never does;
//! - **unknown**: anything else. This is the default. What is not recognised is
//!   never read as nothing.
//!
//! By where the thing comes from:
//!
//! - a function or class of the repository is read from its body
//!   ([`crate::security::authenticates`]: a guard where every request it lets
//!   through has passed a refusal); it is no guard where the body was read to the
//!   end, refuses no one and calls nothing that could; unknown where it refuses
//!   some requests only, hands back something that is not read, or calls what is
//!   not read;
//! - a package's export is a guard only in the call shapes [`LIBRARY`] lists, no
//!   guard where an option on the list makes it optional or where
//!   [`NEVER`] or [`FRAMEWORKS`] say it never authenticates, and unknown with any
//!   option or argument that is not on its entry, or where the package is on no
//!   list at all;
//! - a value (a variable, a constant) is what the call that made it hands back
//!   ([`drift_core::controls::SHAPE`] on the variable), followed to one of the
//!   two above; a value that is anything else (a lookup, a conditional
//!   expression, an attribute of an object of the repository) is unknown;
//! - a name that does not resolve is unknown.
//!
//! The lists are closed: an entry says which library documents the behaviour and
//! which call shapes are understood. A library whose semantics are not certain
//! is not listed, and is unknown.
//!
//! Read by `drift security` and the practice map
//! ([`crate::context::RepoContext::since_measured`]); mining reads none of it.

use drift_core::{Symbol, SymbolKind, WrapKind, controls};

use crate::context::RepoContext;
use crate::practices::UnknownReason;
use crate::security;

/// What a thing at a guard position is ([`classify`]): the verdict of the
/// TypeScript reading ([`crate::guard_position::Verdict`]), one type for both. A
/// guard (it turns away every request without an identity; with the instrument
/// that proves it: the thing itself, or what it is built on or made by that
/// refuses), nothing (it was read, and turns no one away), or unknown (neither is
/// proven: not read, or on no list; the reason is the practice map's).
pub use crate::guard_position::Verdict;

impl Verdict {
    pub fn is_guard(&self) -> bool {
        matches!(self, Verdict::Guard(_))
    }
}

/// Where the thing stands: what the framework does with it decides what counts as
/// a refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Position {
    /// A decorator of the view: the function it hands back runs in the view's
    /// place, and what that returns is the answer.
    Decorator,
    /// A FastAPI dependency: it refuses only by raising. What it returns is
    /// handed to the handler, or dropped.
    Dependency,
    /// A function a framework calls before the request (Flask `before_request`):
    /// what it returns, if anything, is the answer.
    Hook,
    /// A call in a body: it refuses only by raising (what it hands back is the
    /// caller's to return or to drop: [`crate::security::hand_back`]).
    Call,
}

impl Position {
    /// The position a wrap of this kind is, on an entry point of this adapter.
    pub fn of(kind: WrapKind, adapter: &str) -> Option<Position> {
        match kind {
            WrapKind::Decorator => Some(Position::Decorator),
            WrapKind::AppHook => Some(Position::Hook),
            WrapKind::Call if adapter.starts_with("flask") => Some(Position::Hook),
            WrapKind::Call if adapter == "fastapi" => Some(Position::Dependency),
            // A wrapper applied where the view is registered
            // (`path("x", login_required(view))`): a decorator of the view.
            // A DRF permission class is listed as a function called with the
            // view is: bare, by its own entry.
            WrapKind::Call if matches!(adapter, "django" | "drf") => Some(Position::Decorator),
            // A base, a setting: read where they are.
            _ => None,
        }
    }
}

/// How a thing is written where it stands ([`controls::SHAPE`]): bare, or called
/// with these arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shape {
    pub called: bool,
    /// Positional arguments, as written: `True`, `False`, `None`, `lit`, `?`.
    positional: Vec<String>,
    /// Keyword arguments.
    keywords: Vec<(String, String)>,
    /// `*args`, `**kwargs`, or more arguments than the facts hold.
    unread: bool,
}

impl Shape {
    const BARE: Shape = Shape {
        called: false,
        positional: Vec::new(),
        keywords: Vec::new(),
        unread: false,
    };

    /// `(lit,optional=True,**)`; the empty string is the thing written bare.
    fn parse(text: &str) -> Shape {
        let Some(inner) = text.strip_prefix('(').and_then(|t| t.strip_suffix(')')) else {
            return Shape::BARE;
        };
        let mut shape = Shape {
            called: true,
            ..Shape::BARE
        };
        for a in inner.split(',').filter(|a| !a.is_empty()) {
            match a.split_once('=') {
                Some((k, v)) => shape.keywords.push((k.to_string(), v.to_string())),
                None if matches!(a, "*" | "**" | "...") => shape.unread = true,
                None => shape.positional.push(a.to_string()),
            }
        }
        shape
    }

    /// The arguments by parameter name, the positional ones by `names`. None where
    /// an argument cannot be placed: an unpacking, or more positional arguments
    /// than names.
    fn by_name<'a>(&'a self, names: &[&'a str]) -> Option<Vec<(&'a str, &'a str)>> {
        if self.unread || self.positional.len() > names.len() {
            return None;
        }
        Some(
            names
                .iter()
                .copied()
                .zip(self.positional.iter().map(String::as_str))
                .chain(self.keywords.iter().map(|(k, v)| (k.as_str(), v.as_str())))
                .collect(),
        )
    }
}

/// The shapes `holders` record for `callee`, and whether one of them is the value
/// of the holder itself (`shape:=...`, which is no shape of a use).
fn shapes_of(holders: &[&Symbol], callee: &str) -> Vec<Shape> {
    let mut out: Vec<Shape> = Vec::new();
    for c in holders.iter().flat_map(|h| &h.controls) {
        let Some(rest) = c.strip_prefix(controls::SHAPE) else {
            continue;
        };
        if rest.starts_with('=') {
            continue;
        }
        let (name, args) = split_shape(rest);
        if name == callee {
            let shape = Shape::parse(args);
            if !out.contains(&shape) {
                out.push(shape);
            }
        }
    }
    out
}

/// `<callee>(<arguments>)` as the callee and the arguments in their parentheses
/// (empty for a bare name). A callee may itself end in `()` (`pick()` called
/// again), so the arguments are the last group.
fn split_shape(text: &str) -> (&str, &str) {
    if !text.ends_with(')') {
        return (text, "");
    }
    match text.rfind('(') {
        Some(i) => (&text[..i], &text[i..]),
        None => (text, ""),
    }
}

/// The call a variable's value is, or the name it is another name for
/// (`shape:=<callee>(...)`, `shape:=<name>`).
fn value_of(d: &Symbol) -> Option<(&str, Shape)> {
    let mut values = d
        .controls
        .iter()
        .filter_map(|c| c.strip_prefix(controls::SHAPE)?.strip_prefix('='));
    let first = values.next()?;
    // Bound more than once: which binding stands where it is used is not read.
    if values.next().is_some() || first.is_empty() {
        return None;
    }
    let (callee, args) = split_shape(first);
    Some((callee, Shape::parse(args)))
}

/// The name is bound more than once ([`value_of`] then says nothing).
fn rebound(d: &Symbol) -> bool {
    d.controls
        .iter()
        .filter(|c| {
            c.strip_prefix(controls::SHAPE)
                .is_some_and(|rest| rest.starts_with('='))
        })
        .count()
        > 1
        || d.controls
            .iter()
            .any(|c| c.strip_prefix(controls::SHAPE) == Some("="))
}

/// What stands for a token verification a body makes uncaught
/// ([`verifies_uncaught`]), where the practice map names an instrument.
pub const VERIFIES: &str = "verifies a token";

const UNRESOLVED: Verdict = Verdict::Unknown(UnknownReason::Unresolved);
const UNCLASSIFIED: Verdict = Verdict::Unknown(UnknownReason::Unclassified);

/// What `wrapper`, written at position `at` of an entry point, is. `holders` are
/// the symbols that record how it is written there ([`controls::SHAPE`]): the
/// handler and the classes it is a method of.
pub fn classify(ctx: &RepoContext, at: Position, wrapper: &str, holders: &[&Symbol]) -> Verdict {
    read_at(ctx, at, wrapper, holders, false)
}

/// What `wrapper`, written at position `at` of an entry point, decides of a caller
/// who is signed in: the reading of [`classify`], asked for authorization.
///
/// - [`Verdict::Guard`], with the instrument: a library's guard that [`AUTHORIZES`]
///   lists, in a call shape that makes it check a role, a permission or a scope
///   (`permission_required("app.perm")`, `IsAdminUser`, `auth.login_required(role=
///   "admin")`);
/// - [`Verdict::Nothing`]: a library's guard that only signs the caller in, a thing
///   a closed list says never authenticates, and a function or class of the
///   repository that [`classify`] read to a guard or to nothing: what its body
///   checks of the caller is read where the practice map follows it;
/// - [`Verdict::Unknown`]: everything [`classify`] could not read. A package on no
///   list, a value that is not followed and a body that is not read to the end can
///   check a role, a tenant or an owner as easily as a sign-in.
pub fn authorizes(ctx: &RepoContext, at: Position, wrapper: &str, holders: &[&Symbol]) -> Verdict {
    read_at(ctx, at, wrapper, holders, true)
}

/// The function or class of the repository that stands behind `wrapper` at a guard
/// position, by its canonical name: the thing itself, what another name for it is
/// bound to (`extra = admins_only`), or the function whose call made the value
/// (`guard = require_role("admin")`, `@require_role("admin")`: a factory's symbol
/// holds the checks of the function it hands back). Its body is what the practice
/// map reads for what it checks of a signed-in caller. `None` for a package's
/// thing, a value that is not followed, and a function that does not hand back
/// the function that refuses ([`controls::REFUSAL_NOT_RETURNED`]).
pub fn repo_thing(ctx: &RepoContext, wrapper: &str) -> Option<String> {
    let mut w = crate::mine::norm_ref(wrapper)
        .trim_end_matches("()")
        .to_string();
    for _ in 0..=VALUE_HOPS {
        if w.starts_with("pkg:") || w.starts_with("global#") || w.starts_with("unresolved:") {
            return None;
        }
        let d = ctx.definition(&w)?;
        let name = w.rsplit_once('#').map_or(&*w, |(_, n)| n);
        if name != d.name || rebound(d) {
            return None;
        }
        if let Some((made_by, _)) = value_of(d) {
            w = crate::mine::norm_ref(made_by).into_owned();
            continue;
        }
        return (matches!(d.kind, SymbolKind::Function | SymbolKind::Class)
            && !d
                .controls
                .iter()
                .any(|c| c == controls::REFUSAL_NOT_RETURNED))
        .then_some(w);
    }
    None
}

/// `canonical` is a package's class that, as a base of a view, checks a role or a
/// permission whatever it is given ([`AUTHORIZES`]: Django's
/// `PermissionRequiredMixin`).
pub fn base_authorizes(canonical: &str) -> bool {
    crate::mine::norm_ref(canonical)
        .strip_prefix("pkg:")
        .and_then(|r| r.split_once('#'))
        .and_then(|(package, path)| entry(package, path, None))
        .is_some_and(|e| {
            e.is == Is::Guard
                && e.form == Form::Bare
                && AUTHORIZES
                    .iter()
                    .any(|(p, name, c)| *p == e.package && *name == e.name && *c == Checks::Role)
        })
}

/// [`classify`], or [`authorizes`] where `authz`.
fn read_at(
    ctx: &RepoContext,
    at: Position,
    wrapper: &str,
    holders: &[&Symbol],
    authz: bool,
) -> Verdict {
    let w = crate::mine::norm_ref(wrapper);
    // `cache_page(60)(view)` in a URLconf is written `...cache_page()`: the callee
    // called, its arguments where the facts hold them.
    let (w, called) = match w.strip_suffix("()") {
        Some(callee) => (std::borrow::Cow::Borrowed(callee), true),
        None => (std::borrow::Cow::Borrowed(&*w), false),
    };
    let mut shapes = shapes_of(holders, &w);
    if called {
        shapes.retain(|s| s.called);
    }
    if shapes.is_empty() {
        shapes.push(if called {
            Shape {
                called: true,
                unread: true,
                ..Shape::BARE
            }
        } else {
            Shape::BARE
        });
    }
    // Written in more than one way on the symbol (one mount with a strict scheme,
    // another with an optional one): each must say the same.
    let mut verdicts = shapes.iter().map(|s| thing(ctx, at, &w, s, 0, authz));
    let first = verdicts.next().unwrap_or(UNRESOLVED);
    let same = |a: &Verdict, b: &Verdict| {
        matches!(
            (a, b),
            (Verdict::Guard(_), Verdict::Guard(_))
                | (Verdict::Nothing, Verdict::Nothing)
                | (Verdict::Unknown(_), Verdict::Unknown(_))
        )
    };
    if verdicts.all(|v| same(&v, &first)) {
        first
    } else {
        UNRESOLVED
    }
}

/// Unknown where a base of a Django or DRF view class, `class`, or a class it
/// is built on in turn, is a package's class that no list knows (`guardian.mixins.
/// PermissionRequiredMixin`, a mixin of `company_auth`): what its `dispatch`
/// does before the view's is not read, so the view is not known to have no
/// guard. Nothing where the base itself is a package's class the lists say never
/// authenticates. `None` for every other base, which is read as it was: the mixins of
/// [`LIBRARY`] by where they come among the bases
/// ([`crate::security::base_guard_runs`]), a class of the repository from its
/// body, a framework's views and what never authenticates as nothing.
pub fn unknown_base(ctx: &RepoContext, class: &str) -> Option<Verdict> {
    let class = crate::mine::norm_ref(class);
    std::iter::once(&*class)
        .chain(ctx.ancestors(&class).iter().map(String::as_str))
        .filter_map(|c| c.strip_prefix("pkg:")?.split_once('#'))
        .any(|(package, path)| !never(package, path) && entry(package, path, None).is_none())
        .then_some(UNCLASSIFIED)
        .or_else(|| never_authenticates(&class).then_some(Verdict::Nothing))
}

/// A package's export the lists say never authenticates (`AccessMixin`, which
/// only says what a refusal does; a framework's view classes).
pub fn never_authenticates(canonical: &str) -> bool {
    crate::mine::norm_ref(canonical)
        .strip_prefix("pkg:")
        .and_then(|r| r.split_once('#'))
        .is_some_and(|(package, path)| match entry(package, path, None) {
            Some(e) => e.is == Is::Never,
            None => never(package, path),
        })
}

/// Hops followed from a value to what made it.
const VALUE_HOPS: usize = 4;

fn thing(
    ctx: &RepoContext,
    at: Position,
    w: &str,
    shape: &Shape,
    depth: usize,
    authz: bool,
) -> Verdict {
    if w.starts_with("unresolved:") || depth > VALUE_HOPS {
        return UNRESOLVED;
    }
    if w.starts_with("global#") {
        // A name the module does not bind (a parameter of an enclosing function,
        // a built-in): not read.
        return UNRESOLVED;
    }
    if let Some(rest) = w.strip_prefix("pkg:") {
        let Some((package, path)) = rest.split_once('#') else {
            return UNCLASSIFIED;
        };
        return library_for(authz, at, w, package, path, None, shape);
    }
    let Some(d) = ctx.definition(w) else {
        return Verdict::Unknown(UnknownReason::OpaqueWrapper);
    };
    // A dependency the repository replaces (`app.dependency_overrides[get_user] =
    // ...`): what runs where a route depends on it is not this body.
    if d.controls.iter().any(|c| c == controls::OVERRIDDEN) {
        return UNRESOLVED;
    }
    let name = w.rsplit_once('#').map_or(w, |(_, n)| n);
    // A member path past the symbol's own name: `auth.login_required` of a value,
    // `Class.method`.
    let member = name
        .strip_prefix(d.name.as_str())
        .and_then(|rest| rest.strip_prefix('.'))
        .unwrap_or_default();
    if rebound(d) {
        return UNRESOLVED;
    }
    if let Some((made_by, built)) = value_of(d) {
        return value(ctx, at, made_by, &built, member, shape, depth, authz);
    }
    match d.kind {
        SymbolKind::Function | SymbolKind::Class if member.is_empty() => {
            match repo_body(ctx, at, w, d, shape) {
                // What its body checks of a signed-in caller is read where the
                // practice map follows it.
                Verdict::Guard(_) if authz => Verdict::Nothing,
                v => v,
            }
        }
        // A method named through its class (`Auth.require`): the method's own body
        // is not what the class's facts say.
        SymbolKind::Function | SymbolKind::Class => UNRESOLVED,
        // A value the facts do not say the making of: a literal, a lookup, a
        // conditional expression.
        _ => UNRESOLVED,
    }
}

/// A value of the repository at a guard position: `made_by` is the call it is
/// (with `built`, its arguments) or the name it stands for.
#[allow(clippy::too_many_arguments)]
fn value(
    ctx: &RepoContext,
    at: Position,
    made_by: &str,
    built: &Shape,
    member: &str,
    shape: &Shape,
    depth: usize,
    authz: bool,
) -> Verdict {
    let made_by = crate::mine::norm_ref(made_by);
    if !built.called {
        // Another name for something (`guard = login_required`): that thing, as
        // this one is written.
        return if member.is_empty() {
            thing(ctx, at, &made_by, shape, depth + 1, authz)
        } else {
            UNRESOLVED
        };
    }
    if member.is_empty() && !shape.called {
        // What the call handed back stands here itself (`guard = jwt_required()`
        // then `@guard`): the callee, written as it was called.
        return thing(ctx, at, &made_by, built, depth + 1, authz);
    }
    // A member of what the call handed back, or that called again: an instance.
    if let Some((package, path)) = made_by.strip_prefix("pkg:").and_then(|r| r.split_once('#')) {
        return library_for(
            authz,
            at,
            &made_by,
            package,
            path,
            Some((built, member)),
            shape,
        );
    }
    // An instance of what the repository builds: what made it may be a value in
    // turn (`users = FastAPIUsers(...)`, `current = users.current_user(...)`).
    if let Some(d) = ctx.definition(&made_by)
        && let Some((inner, inner_built)) = value_of(d)
    {
        let name = made_by.rsplit_once('#').map_or(&*made_by, |(_, n)| n);
        let inner_member = name
            .strip_prefix(d.name.as_str())
            .and_then(|rest| rest.strip_prefix('.'))
            .unwrap_or_default();
        // `current(...)` of `current = users.current_user`: only where this value
        // adds no member of its own.
        if member.is_empty() && !inner_member.is_empty() && inner_built.called {
            return value(
                ctx,
                at,
                inner,
                &inner_built,
                inner_member,
                shape,
                depth + 1,
                authz,
            );
        }
    }
    UNRESOLVED
}

/// A function or class of the repository at a guard position, read from its body.
fn repo_body(ctx: &RepoContext, at: Position, w: &str, d: &Symbol, shape: &Shape) -> Verdict {
    let has = |control: &str| d.controls.iter().any(|c| c == control);
    // What a function called where a guard goes hands back is the guard: where
    // that is not a function the facts name, it is not read. A decorator is
    // always called (with the view).
    let factory = shape.called || at == Position::Decorator;
    if at == Position::Decorator && d.kind == SymbolKind::Function {
        // A decorator that hands the view back unchanged on some path and not on
        // another (`if settings.DEBUG: return view`): whether it guards is decided
        // where it is applied, which is not read.
        if has(controls::HANDS_BACK_PARAM) {
            return UNRESOLVED;
        }
        // One that hands back what another call makes of the view (`return
        // login_required(view)`): that is what runs in the view's place, and it is
        // not read here.
        if d.returns_calls
            .iter()
            .any(|c| !crate::mine::norm_ref(c).starts_with("pkg:python:functools#"))
        {
            return UNRESOLVED;
        }
    }
    if security::authenticates(ctx, w) || class_guard(ctx, w) {
        // A dependency refuses by raising only: one whose refusal is a response it
        // hands back turns no one away.
        if at == Position::Dependency && returns_its_refusal(ctx, w) {
            return Verdict::Nothing;
        }
        return Verdict::Guard(
            security::authenticating_root(ctx, w).unwrap_or_else(|| w.to_string()),
        );
    }
    if factory && has(controls::RETURNS_UNREAD) {
        return UNRESOLVED;
    }
    if security::member_of_a_value(ctx, w)
        || security::may_authenticate(ctx, w)
        || security::returns_unresolved(d)
        || d.body_checks.iter().any(|c| {
            matches!(
                c.outcome,
                drift_core::CheckOutcome::Unauthenticated
                    | drift_core::CheckOutcome::SignInRedirect
            )
        })
    {
        return UNRESOLVED;
    }
    // A library's guard the body calls for some of its requests only.
    if guards_some(ctx, d, 0) {
        return UNRESOLVED;
    }
    // A token verified with nothing around it: a caller without a valid one
    // never reaches the handler, and what it is answered is not in this body.
    if verifies_uncaught(ctx, d, 0) {
        return UNCLASSIFIED;
    }
    if let Some(reason) = calls_unread(ctx, d, 0) {
        return Verdict::Unknown(reason);
    }
    Verdict::Nothing
}

/// The body of `d` verifies a token by a library's call ([`VERIFIERS`]) for
/// every request, with nothing to catch what the call raises: not under a
/// branch, not after a return that serves, not in a `try` whose handler goes
/// on, and not with the verification switched off. Such a body lets no request
/// through that carries no valid token: the caller gets the library's error
/// (a 500, or what an application-wide error handler makes of it), which no
/// check of this body records. Followed one call into a function of the
/// repository the body calls for every request (`claims = decode_token(t)`).
pub fn verifies_uncaught(ctx: &RepoContext, d: &Symbol, depth: usize) -> bool {
    d.calls.iter().any(|c| {
        if c.ends_with("(ref)")
            || d.after_continuation.iter().any(|a| a == c)
            || security::for_some_requests(ctx, d, c)
        {
            return false;
        }
        let n = crate::mine::norm_ref(c);
        if let Some((package, path)) = n.strip_prefix("pkg:").and_then(|r| r.split_once('#')) {
            return verifier(package, path) && !switched_off(d, &n);
        }
        let Some(callee) = ctx.definition(&n) else {
            return false;
        };
        let member = n
            .rsplit_once('#')
            .map_or(&*n, |(_, x)| x)
            .strip_prefix(callee.name.as_str())
            .and_then(|rest| rest.strip_prefix('.'));
        match member {
            // A method of a value a library's class made (`signer.loads(token)`).
            Some(member) => value_of(callee).is_some_and(|(made_by, built)| {
                built.called
                    && crate::mine::norm_ref(made_by)
                        .strip_prefix("pkg:")
                        .and_then(|r| r.split_once('#'))
                        .is_some_and(|(package, _)| verifier(package, member))
                    && !switched_off(d, &n)
            }),
            None => {
                depth < 1
                    && callee.kind == SymbolKind::Function
                    && !std::ptr::eq(callee, d)
                    && verifies_uncaught(ctx, callee, depth + 1)
            }
        }
    })
}

/// Every call of `callee` in `d` is written with its verification switched off:
/// `options={"verify_signature": False}` (PyJWT, python-jose), `verify=False`
/// (PyJWT 1.x).
fn switched_off(d: &Symbol, callee: &str) -> bool {
    let shapes = shapes_of(&[d], callee);
    !shapes.is_empty()
        && shapes.iter().all(|s| {
            s.keywords.iter().any(|(k, v)| {
                (k == "verify" && v == "False")
                    || (k == "options"
                        && v.trim_matches(['{', '}'])
                            .split(';')
                            .any(|item| item == "verify_signature:False"))
            })
        })
}

/// The body of `d`, or a function of the repository it calls, calls a library's
/// guard ([`called_guard`]) where not every request of `d` makes the call.
fn guards_some(ctx: &RepoContext, d: &Symbol, depth: usize) -> bool {
    guards_some_in(ctx, d, depth, false)
}

/// [`guards_some`] of a callee: `conditional` where the call that reached it is
/// made for some requests only.
fn guards_some_in(ctx: &RepoContext, d: &Symbol, depth: usize, conditional: bool) -> bool {
    d.calls.iter().any(|c| {
        if called_guard(d, c) {
            return conditional || security::for_some_requests(ctx, d, c);
        }
        let n = crate::mine::norm_ref(c);
        depth < CALL_HOPS
            && !n.starts_with("pkg:")
            && ctx.definition(&n).is_some_and(|callee| {
                callee.kind == SymbolKind::Function
                    && !std::ptr::eq(callee, d)
                    && guards_some_in(
                        ctx,
                        callee,
                        depth + 1,
                        conditional || security::for_some_requests(ctx, d, c),
                    )
            })
    })
}

/// A list of this module says something of the package export `canonical`: its
/// package never authenticates, the export has an entry, or it is a verifier. What is
/// on none is a package's function Drift has no entry for
/// ([`crate::practices::basis::unlisted_package`]).
pub fn listed_export(canonical: &str) -> bool {
    let c = crate::mine::norm_ref(canonical);
    let Some((package, path)) = c.strip_prefix("pkg:").and_then(|r| r.split_once('#')) else {
        return false;
    };
    never(package, path)
        || entry(package, path, None).is_some()
        || verifier(package, path)
        || drift_core::guard_lists::signature_verifier(&c).is_some()
}

/// `body` (a Python handler's, or a body it runs) calls the package export
/// `callee` only as a statement of its own: what the call hands back goes
/// nowhere ([`controls::DROPS_RESULT_OF`]), so it acts on the request by raising
/// or not at all, and no list says the package never authenticates
/// (`company_auth.check_request()`). It may be the guard: never nothing. A call
/// whose value the body uses is not asked.
pub fn dropped_unlisted(body: &Symbol, callee: &str) -> bool {
    let c = crate::mine::norm_ref(callee);
    let Some((package, path)) = c.strip_prefix("pkg:").and_then(|r| r.split_once('#')) else {
        return false;
    };
    !never(package, path)
        && entry(package, path, None).is_none()
        && !verifier(package, path)
        && body.controls.iter().any(|x| {
            x.strip_prefix(controls::DROPS_RESULT_OF)
                .is_some_and(|f| crate::mine::norm_ref(f) == c)
        })
}

/// The proof of `w` rests on a function that turns callers away only by the
/// response it hands back ([`controls::RETURNS_REJECTION`]).
fn returns_its_refusal(ctx: &RepoContext, w: &str) -> bool {
    security::authenticating_root(ctx, w)
        .and_then(|root| ctx.definition(&root))
        .is_some_and(|d| {
            d.controls.iter().any(|c| {
                c.starts_with(controls::RETURNS_REJECTION) || c == controls::RETURNS_REFUSING
            })
        })
}

/// A class of the repository used as a FastAPI dependency whose `__call__` is the
/// guard: built on a FastAPI security scheme, calling the scheme's `__call__`
/// and passing no `auto_error`.
fn class_guard(ctx: &RepoContext, w: &str) -> bool {
    let Some(d) = ctx.definition(w) else {
        return false;
    };
    if d.kind != SymbolKind::Class {
        return false;
    }
    let Some(call) = d.members.iter().find(|m| m.name == "__call__") else {
        return false;
    };
    let module = w.split_once('#').map_or(w, |(m, _)| m);
    let class = format!("{module}#{}", d.name);
    let scheme = ctx.ancestors(&class).iter().any(|a| {
        a.strip_prefix("pkg:fastapi#")
            .is_some_and(|p| FASTAPI_SCHEMES.contains(&last(p)))
    });
    scheme
        && call.calls.iter().any(|c| c.ends_with("super().__call__"))
        && !d.args.iter().any(|a| a.ends_with(":auto_error"))
        && !ctx.passes_key(&class, "auto_error")
}

/// Bodies followed from a thing at a guard position to what it calls.
const CALL_HOPS: usize = 2;

/// The body of `d`, a function of the repository at a guard position that proves
/// no guard, calls something that is not read and may refuse: a name that does
/// not resolve, a function of the repository the facts do not hold, a package's
/// export that no list says never authenticates (`company_auth.verify(request)`).
/// It is then not a body read to the end.
fn calls_unread(ctx: &RepoContext, d: &Symbol, depth: usize) -> Option<UnknownReason> {
    if d.controls.iter().any(|c| c == controls::CALLS_UNNAMED) {
        return Some(UnknownReason::Unresolved);
    }
    for c in &d.calls {
        let c = c.trim_end_matches("(ref)").trim_end_matches("(new)");
        let c = crate::mine::norm_ref(c);
        if c.starts_with("unresolved:") {
            return Some(UnknownReason::Unresolved);
        }
        if c.starts_with("global#") || c.starts_with("param:") {
            continue;
        }
        if let Some((package, path)) = c.strip_prefix("pkg:").and_then(|r| r.split_once('#')) {
            if !never(package, path) && entry(package, path, None).is_none() {
                return Some(UnknownReason::Unclassified);
            }
            continue;
        }
        let member = ctx.definition(&c).and_then(|callee| {
            c.rsplit_once('#')
                .map_or(&*c, |(_, n)| n)
                .strip_prefix(callee.name.as_str())
                .and_then(|rest| rest.strip_prefix('.'))
                .map(|m| (callee, m.split(['.', '(']).next().unwrap_or_default()))
        });
        if let Some((holder, member)) = member {
            // A member of a value (`registry.hook()`, `db.session.commit()`): by
            // what made the value; or a method of a class named by the class.
            let method_of = |class: &Symbol| {
                class.kind == SymbolKind::Class && class.members.iter().any(|m| m.name == member)
            };
            let read = match value_of(holder) {
                Some((made_by, built)) if built.called => {
                    let made_by = crate::mine::norm_ref(made_by);
                    match made_by.strip_prefix("pkg:").and_then(|r| r.split_once('#')) {
                        Some((package, path)) => {
                            if !never(package, path) && entry(package, path, Some(member)).is_none()
                            {
                                return Some(UnknownReason::Unclassified);
                            }
                            true
                        }
                        None => ctx.definition(&made_by).is_some_and(method_of),
                    }
                }
                Some(_) => false,
                None => !rebound(holder) && method_of(holder),
            };
            if !read {
                return Some(UnknownReason::Unresolved);
            }
            continue;
        }
        match ctx.definition(&c) {
            None => return Some(UnknownReason::OpaqueWrapper),
            // Building an object runs its constructor and nothing else of the
            // class: what its other methods call says nothing of this call.
            Some(class) if class.kind == SymbolKind::Class => {
                let built = class
                    .members
                    .iter()
                    .filter(|m| matches!(m.name.as_str(), "__init__" | "__post_init__" | "__new__"))
                    .flat_map(|m| &m.calls);
                for call in built {
                    let call = crate::mine::norm_ref(call);
                    if call.starts_with("unresolved:") {
                        return Some(UnknownReason::Unresolved);
                    }
                    if let Some((package, path)) =
                        call.strip_prefix("pkg:").and_then(|r| r.split_once('#'))
                        && !never(package, path)
                        && entry(package, path, None).is_none()
                    {
                        return Some(UnknownReason::Unclassified);
                    }
                }
            }
            Some(callee) if depth < CALL_HOPS && !std::ptr::eq(callee, d) => {
                if let Some(r) = calls_unread(ctx, callee, depth + 1) {
                    return Some(r);
                }
            }
            Some(_) => {}
        }
    }
    None
}

/// A package's export called in a body of the repository, as `caller` calls it:
/// the call is a guard of the body where [`LIBRARY`] lists the callee as one in
/// the shape it is called in. Asked where the call runs for every request of the
/// body, before the body hands control on.
pub fn called_guard(caller: &Symbol, callee: &str) -> bool {
    let c = crate::mine::norm_ref(callee);
    let Some((package, path)) = c.strip_prefix("pkg:").and_then(|r| r.split_once('#')) else {
        return false;
    };
    let mut shapes = shapes_of(&[caller], &c);
    if shapes.is_empty() {
        // A call the facts keep no shape of: its arguments are not read.
        return false;
    }
    shapes
        .drain(..)
        .all(|s| library(Position::Call, &c, package, path, None, &s).is_guard())
}

// ---------------------------------------------------------------------------------
// The closed lists
// ---------------------------------------------------------------------------------

/// What an entry of [`LIBRARY`] is, in a shape it understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Is {
    /// It refuses a request without an identity.
    Guard,
    /// It reads who is asking and refuses no one, or it opens the route.
    Never,
}

/// How an entry is written where it guards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Form {
    /// A function used as it is, or called with options first: `@login_required`,
    /// `@login_required(login_url=...)`, `login_required(view)`.
    Either,
    /// It guards only as the result of a call: `@jwt_required()`. Written bare it
    /// is handed the view as its first option, which is not read.
    Called,
    /// A function used as it is; it takes the view and no option.
    Bare,
    /// A class whose instance is the guard: the shape is how the instance was
    /// built. The class itself, not built, is not read.
    Built,
}

/// One export of a package whose behaviour at a guard position is known.
struct Entry {
    package: &'static str,
    /// The last name of the export; for a member of an instance, `Class.member`,
    /// and `Class()` for the instance itself called.
    name: &'static str,
    is: Is,
    form: Form,
    /// The parameters positional arguments bind, in order. The first of a
    /// decorator that takes its view (`login_required(function=None, ...)`) is
    /// named `<view>`.
    positional: &'static [&'static str],
    /// Options that leave it what it is, whatever they are given.
    plain: &'static [&'static str],
    /// Options that decide: `(name, value that makes it optional)`. The other
    /// boolean leaves it a guard; any other value is not read.
    optional: &'static [(&'static str, &'static str)],
}

const VIEW: &str = "<view>";

/// FastAPI's security schemes: `fastapi.security.<name>`.
const FASTAPI_SCHEMES: &[&str] = &[
    "HTTPBearer",
    "HTTPBasic",
    "HTTPDigest",
    "OAuth2",
    "OAuth2PasswordBearer",
    "OAuth2AuthorizationCodeBearer",
    "OpenIdConnect",
    "APIKeyHeader",
    "APIKeyCookie",
    "APIKeyQuery",
];

const fn guard(
    package: &'static str,
    name: &'static str,
    form: Form,
    positional: &'static [&'static str],
    plain: &'static [&'static str],
    optional: &'static [(&'static str, &'static str)],
) -> Entry {
    Entry {
        package,
        name,
        is: Is::Guard,
        form,
        positional,
        plain,
        optional,
    }
}

const fn never_entry(package: &'static str, name: &'static str) -> Entry {
    Entry {
        package,
        name,
        is: Is::Never,
        form: Form::Either,
        positional: &[],
        plain: &[],
        optional: &[],
    }
}

/// The library guards Drift knows, each in the call shapes it understands. An
/// option that is on no list of the entry makes the thing unknown.
const LIBRARY: &[Entry] = &[
    // --- Django -------------------------------------------------------------
    // `django.contrib.auth.decorators.login_required(function=None,
    // redirect_field_name=..., login_url=None)`: redirects a request whose user is
    // not authenticated to the login page. Bare, or called with its options.
    guard(
        "django",
        "login_required",
        Form::Either,
        &[VIEW, "redirect_field_name", "login_url"],
        &["redirect_field_name", "login_url"],
        &[],
    ),
    // `permission_required(perm, login_url=None, raise_exception=False)`: a user
    // without the permission is redirected to login, or gets a 403; an anonymous
    // user has no permission.
    guard(
        "django",
        "permission_required",
        Form::Called,
        &["perm", "login_url", "raise_exception"],
        &["perm", "login_url", "raise_exception"],
        &[],
    ),
    // `django.contrib.admin.views.decorators.staff_member_required(view_func=None,
    // redirect_field_name=..., login_url=...)`: an active staff user, else the
    // admin login.
    guard(
        "django",
        "staff_member_required",
        Form::Either,
        &[VIEW, "redirect_field_name", "login_url"],
        &["redirect_field_name", "login_url"],
        &[],
    ),
    // `LoginRequiredMixin`, `PermissionRequiredMixin`: `dispatch` refuses a user
    // who is not authenticated (or lacks the permission) before the view's own
    // runs. Read as a base, by where it comes among the bases
    // ([`crate::security::base_guard_runs`]). `UserPassesTestMixin` and
    // `user_passes_test` guard by their test ([`crate::security::django_test`]),
    // and `AccessMixin` alone only says what a refusal does: it refuses no one.
    guard("django", "LoginRequiredMixin", Form::Bare, &[], &[], &[]),
    guard(
        "django",
        "PermissionRequiredMixin",
        Form::Bare,
        &[],
        &[],
        &[],
    ),
    never_entry("django", "AccessMixin"),
    // `login_not_required` (Django 5.1) opens a view to
    // `LoginRequiredMiddleware`.
    never_entry("django", "login_not_required"),
    // --- Django REST framework ------------------------------------------------
    // Permission classes, as `permission_classes` or `DEFAULT_PERMISSION_CLASSES`
    // hold them. `IsAuthenticated` and `IsAdminUser` refuse a request whose user
    // is not authenticated (or not staff); `DjangoModelPermissions` and
    // `DjangoObjectPermissions` refuse an anonymous user
    // (`authenticated_users_only = True`). `IsAuthenticatedOrReadOnly` and
    // `DjangoModelPermissionsOrAnonReadOnly` let `GET`, `HEAD` and `OPTIONS`
    // through for anyone ([`crate::security::safe_methods`]). `AllowAny` opens
    // the view. Every class of `rest_framework.authentication` identifies the
    // caller and refuses no one who sends no credentials.
    guard(
        "rest_framework",
        "IsAuthenticated",
        Form::Bare,
        &[],
        &[],
        &[],
    ),
    guard("rest_framework", "IsAdminUser", Form::Bare, &[], &[], &[]),
    guard(
        "rest_framework",
        "IsAuthenticatedOrReadOnly",
        Form::Bare,
        &[],
        &[],
        &[],
    ),
    guard(
        "rest_framework",
        "DjangoModelPermissions",
        Form::Bare,
        &[],
        &[],
        &[],
    ),
    guard(
        "rest_framework",
        "DjangoModelPermissionsOrAnonReadOnly",
        Form::Bare,
        &[],
        &[],
        &[],
    ),
    guard(
        "rest_framework",
        "DjangoObjectPermissions",
        Form::Bare,
        &[],
        &[],
        &[],
    ),
    never_entry("rest_framework", "AllowAny"),
    // --- Flask-Login ------------------------------------------------------------
    // `login_required(func)` and `fresh_login_required(func)`: call
    // `login_manager.unauthorized()` (a 401, or a redirect to the login view)
    // unless `current_user.is_authenticated`. They take the view and nothing
    // else. `current_user`, read alone, identifies.
    guard(
        "flask_login",
        "login_required",
        Form::Bare,
        &[VIEW],
        &[],
        &[],
    ),
    guard(
        "flask_login",
        "fresh_login_required",
        Form::Bare,
        &[VIEW],
        &[],
        &[],
    ),
    never_entry("flask_login", "current_user"),
    never_entry("flask_login", "login_user"),
    never_entry("flask_login", "logout_user"),
    never_entry("flask_login", "confirm_login"),
    never_entry("flask_login", "login_fresh"),
    never_entry("flask_login", "LoginManager"),
    never_entry("flask_login", "UserMixin"),
    never_entry("flask_login", "AnonymousUserMixin"),
    // --- Flask-JWT-Extended -----------------------------------------------------
    // 4.x: `jwt_required(optional=False, fresh=False, refresh=False,
    // locations=None, verify_type=True)` and `verify_jwt_in_request(...)` with the
    // same options raise `NoAuthorizationError` (answered 401) for a request with
    // no token. `optional=True` lets a request without a token through. `fresh`,
    // `refresh`, `locations` and `verify_type` say which token, never whether
    // one is needed.
    guard(
        "flask_jwt_extended",
        "jwt_required",
        Form::Called,
        &["optional", "fresh", "refresh", "locations", "verify_type"],
        &["fresh", "refresh", "locations", "verify_type"],
        &[("optional", "True")],
    ),
    guard(
        "flask_jwt_extended",
        "verify_jwt_in_request",
        Form::Called,
        &["optional", "fresh", "refresh", "locations", "verify_type"],
        &["fresh", "refresh", "locations", "verify_type"],
        &[("optional", "True")],
    ),
    // 3.x: `@fresh_jwt_required` and `@jwt_refresh_token_required` take the view;
    // `@jwt_optional` and `verify_jwt_in_request_optional()` refuse no one.
    guard(
        "flask_jwt_extended",
        "fresh_jwt_required",
        Form::Bare,
        &[VIEW],
        &[],
        &[],
    ),
    guard(
        "flask_jwt_extended",
        "jwt_refresh_token_required",
        Form::Bare,
        &[VIEW],
        &[],
        &[],
    ),
    never_entry("flask_jwt_extended", "jwt_optional"),
    never_entry("flask_jwt_extended", "verify_jwt_in_request_optional"),
    // What reads the token already verified, makes tokens or sets their cookies:
    // none of it asks for a token (`get_jwt()` before any verification is an
    // error of the program, not an answer to the caller).
    never_entry("flask_jwt_extended", "get_jwt"),
    never_entry("flask_jwt_extended", "get_jwt_identity"),
    never_entry("flask_jwt_extended", "get_jwt_header"),
    never_entry("flask_jwt_extended", "get_current_user"),
    never_entry("flask_jwt_extended", "current_user"),
    never_entry("flask_jwt_extended", "get_jti"),
    never_entry("flask_jwt_extended", "get_csrf_token"),
    never_entry("flask_jwt_extended", "decode_token"),
    never_entry("flask_jwt_extended", "create_access_token"),
    never_entry("flask_jwt_extended", "create_refresh_token"),
    never_entry("flask_jwt_extended", "set_access_cookies"),
    never_entry("flask_jwt_extended", "set_refresh_cookies"),
    never_entry("flask_jwt_extended", "unset_jwt_cookies"),
    never_entry("flask_jwt_extended", "unset_access_cookies"),
    never_entry("flask_jwt_extended", "unset_refresh_cookies"),
    never_entry("flask_jwt_extended", "JWTManager"),
    // --- Flask-HTTPAuth ---------------------------------------------------------
    // `auth.login_required(f=None, role=None, optional=None)` of an instance of
    // `HTTPBasicAuth`, `HTTPTokenAuth`, `HTTPDigestAuth` or `MultiAuth`: answers
    // 401 through the instance's error handler unless its verify callback names a
    // user. `optional=True` lets the request through; `role` adds a 403.
    guard(
        "flask_httpauth",
        "HTTPBasicAuth.login_required",
        Form::Either,
        &[VIEW, "role", "optional"],
        &["role"],
        &[("optional", "True")],
    ),
    guard(
        "flask_httpauth",
        "HTTPTokenAuth.login_required",
        Form::Either,
        &[VIEW, "role", "optional"],
        &["role"],
        &[("optional", "True")],
    ),
    guard(
        "flask_httpauth",
        "HTTPDigestAuth.login_required",
        Form::Either,
        &[VIEW, "role", "optional"],
        &["role"],
        &[("optional", "True")],
    ),
    guard(
        "flask_httpauth",
        "MultiAuth.login_required",
        Form::Either,
        &[VIEW, "role", "optional"],
        &["role"],
        &[("optional", "True")],
    ),
    // --- Authlib ----------------------------------------------------------------
    // An instance of `authlib.integrations.flask_oauth2.ResourceProtector` (or
    // `django_oauth2`) called as a decorator: `require_oauth(scopes=None,
    // optional=False)` raises the token error (401) for a request with no valid
    // bearer token; `optional=True` lets a request with no token through. Only
    // the first positional argument is placed (older versions take an operator
    // second).
    guard(
        "authlib",
        "ResourceProtector()",
        Form::Called,
        &["scopes"],
        &["scopes", "scope", "operator"],
        &[("optional", "True")],
    ),
    // --- FastAPI ----------------------------------------------------------------
    // The security schemes of `fastapi.security`, as instances: called by FastAPI
    // as a dependency, an instance answers 401 or 403 for a request that carries
    // no credential of its kind, unless built with `auto_error=False` (it then
    // hands `None` on). It requires the credential to be present and does not
    // verify it; Drift reads that as a sign-in guard, as it always has (a route
    // that takes a bearer token refuses a caller with none). The other options
    // describe the scheme in the OpenAPI document.
    guard(
        "fastapi",
        "HTTPBearer",
        Form::Built,
        &[],
        &["bearerFormat", "scheme_name", "description"],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "HTTPBasic",
        Form::Built,
        &[],
        &["scheme_name", "realm", "description"],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "HTTPDigest",
        Form::Built,
        &[],
        &["scheme_name", "description"],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "OAuth2",
        Form::Built,
        &[],
        &["flows", "scheme_name", "description"],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "OAuth2PasswordBearer",
        Form::Built,
        &[
            "tokenUrl",
            "scheme_name",
            "scopes",
            "description",
            "auto_error",
        ],
        &[
            "tokenUrl",
            "scheme_name",
            "scopes",
            "description",
            "refreshUrl",
        ],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "OAuth2AuthorizationCodeBearer",
        Form::Built,
        &[
            "authorizationUrl",
            "tokenUrl",
            "refreshUrl",
            "scheme_name",
            "scopes",
            "description",
            "auto_error",
        ],
        &[
            "authorizationUrl",
            "tokenUrl",
            "refreshUrl",
            "scheme_name",
            "scopes",
            "description",
        ],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "OpenIdConnect",
        Form::Built,
        &[],
        &["openIdConnectUrl", "scheme_name", "description"],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "APIKeyHeader",
        Form::Built,
        &[],
        &["name", "scheme_name", "description"],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "APIKeyCookie",
        Form::Built,
        &[],
        &["name", "scheme_name", "description"],
        &[("auto_error", "False")],
    ),
    guard(
        "fastapi",
        "APIKeyQuery",
        Form::Built,
        &[],
        &["name", "scheme_name", "description"],
        &[("auto_error", "False")],
    ),
    // --- FastAPI Users ------------------------------------------------------------
    // `fastapi_users.current_user(optional=False, active=False, verified=False,
    // superuser=False)` of a `FastAPIUsers` instance hands back a dependency that
    // raises 401 where no authenticated user is found (403 for a user who is not
    // verified or not a superuser), unless `optional=True` (it then gives
    // `None`). `get_enabled_backends` is not read.
    guard(
        "fastapi_users",
        "FastAPIUsers.current_user",
        Form::Called,
        &[],
        &["active", "verified", "superuser"],
        &[("optional", "True")],
    ),
    // --- Starlette ----------------------------------------------------------------
    // `starlette.authentication.requires(scopes, status_code=403, redirect=None)`:
    // answers `status_code` or redirects unless the connection has every scope.
    // `AuthenticationMiddleware` alone identifies and refuses no one who sends no
    // credentials.
    guard(
        "starlette",
        "requires",
        Form::Called,
        &["scopes", "status_code", "redirect"],
        &["scopes", "status_code", "redirect"],
        &[],
    ),
    never_entry("starlette", "AuthenticationMiddleware"),
];

/// Calls that verify a token or a signature and raise the library's own error
/// where it does not verify, as `(package, last name of the function or
/// method)`: PyJWT's and python-jose's `jwt.decode` (and `jws.verify`),
/// joserfc's and Authlib's `jwt.decode`, itsdangerous' `Serializer.loads` and
/// `Signer.unsign`, Django's `signing.loads` and `Signer.unsign`, Google's
/// `id_token.verify_oauth2_token` / `verify_token` / `verify_firebase_token`,
/// Firebase Admin's `auth.verify_id_token` / `verify_session_cookie`. A function
/// at a guard position that makes such a call for every request, uncaught, is
/// never read as turning no one away ([`verifies_uncaught`]): unknown, since
/// what the caller is answered (the error, or what an error handler makes of
/// it) is not read. With the verification switched off ([`switched_off`]) the
/// call verifies nothing, and neither do `jwt.get_unverified_claims`,
/// `get_unverified_header`, `jwt.encode` or a password hash: those are calls
/// of a package that never authenticates ([`NEVER`]).
const VERIFIERS: &[(&str, &str)] = &[
    ("jwt", "decode"),
    ("jose", "decode"),
    ("jose", "verify"),
    ("joserfc", "decode"),
    ("authlib", "decode"),
    ("itsdangerous", "loads"),
    ("itsdangerous", "unsign"),
    ("django", "loads"),
    ("django", "unsign"),
    ("google", "verify_oauth2_token"),
    ("google", "verify_token"),
    ("google", "verify_firebase_token"),
    ("firebase_admin", "verify_id_token"),
    ("firebase_admin", "verify_session_cookie"),
];

/// `package`'s export (or method) `path` is on [`VERIFIERS`]. Django's are those
/// of `django.core.signing`.
fn verifier(package: &str, path: &str) -> bool {
    VERIFIERS
        .iter()
        .any(|(p, name)| *p == package && last(path) == *name)
        && (package != "django" || path.contains("signing") || !path.contains('.'))
}

/// Packages none of whose exports authenticates: at a guard position, or called in
/// a body, one is nothing. The list to extend. The Python standard library is
/// `python:<module>`.
const NEVER: &[&str] = &[
    // Sessions alone, CSRF, CORS, rate limits, caches, compression, headers.
    "flask_cors",
    "flask_wtf",
    "flask_limiter",
    "flask_caching",
    "flask_compress",
    "flask_talisman",
    "flask_session",
    "corsheaders",
    "fastapi_limiter",
    "slowapi",
    "fastapi_cache",
    "fastapi_pagination",
    "django_ratelimit",
    "whitenoise",
    // Data, validation, serialisation, documentation.
    "flask_sqlalchemy",
    "flask_migrate",
    "flask_marshmallow",
    "sqlalchemy",
    "sqlmodel",
    "alembic",
    "pydantic",
    "pydantic_settings",
    "marshmallow",
    "webargs",
    "flasgger",
    "apispec",
    "flask_apispec",
    "drf_spectacular",
    "drf_yasg",
    "django_filters",
    // Logging, metrics, tracing, error reports.
    "structlog",
    "loguru",
    "sentry_sdk",
    "prometheus_client",
    "opentelemetry",
    "statsd",
    // Tokens, signatures and password hashes. What of them verifies a token and
    // raises where it does not is on [`VERIFIERS`] and read first; the rest
    // (encoding a token, hashing a password, reading claims unverified)
    // verifies nothing of the request.
    "jwt",
    "jose",
    "joserfc",
    "itsdangerous",
    "passlib",
    "bcrypt",
    "argon2",
    "cryptography",
    "nacl",
    // Tasks, mail, clients.
    "celery",
    "flask_mail",
    "flask_babel",
    "requests",
    "httpx",
    "aiohttp",
    "redis",
    "boto3",
    "botocore",
    "aioboto3",
    "aiobotocore",
    "pika",
    "aio_pika",
    "kafka",
    "aiokafka",
];

/// The frameworks: a package with its modules that authenticate. An export of one
/// of those modules is what its [`LIBRARY`] entry says, and unknown with none;
/// every other export of the package never authenticates: Flask's `abort`,
/// Django's `csrf_exempt`, `require_http_methods`, `cache_page` and
/// `transaction.atomic`, what reads or changes the session's user
/// (`django.contrib.auth.authenticate`, `login`, `get_user_model`).
const FRAMEWORKS: &[(&str, &[&str])] = &[
    ("flask", &[]),
    ("werkzeug", &[]),
    ("fastapi", &["security"]),
    ("starlette", &["authentication"]),
    (
        "django",
        &[
            "contrib.auth.decorators",
            "contrib.auth.mixins",
            "contrib.auth.middleware",
            "contrib.admin.views.decorators",
        ],
    ),
    (
        "rest_framework",
        &["permissions", "authentication", "authtoken"],
    ),
];

/// Exports of a framework's authenticating modules that authenticate no request:
/// request forms and models (`fastapi.security`), what identifies
/// (`rest_framework.authentication`, read as `identifies` by the practice map),
/// what reads or changes the session's user.
const FRAMEWORK_NEVER: &[(&str, &[&str])] = &[
    (
        "fastapi",
        &[
            "OAuth2PasswordRequestForm",
            "OAuth2PasswordRequestFormStrict",
            "SecurityScopes",
            "HTTPAuthorizationCredentials",
            "HTTPBasicCredentials",
        ],
    ),
    (
        "starlette",
        &[
            "AuthenticationMiddleware",
            "AuthCredentials",
            "SimpleUser",
            "UnauthenticatedUser",
            "BaseUser",
            "AuthenticationBackend",
            "AuthenticationError",
            "has_required_scope",
        ],
    ),
    (
        "django",
        &[
            "AccessMixin",
            "login_not_required",
            // They identify: the session's user is read, no one is refused.
            "AuthenticationMiddleware",
            "RemoteUserMiddleware",
            "PersistentRemoteUserMiddleware",
        ],
    ),
    (
        "rest_framework",
        &[
            "AllowAny",
            "SAFE_METHODS",
            "BasicAuthentication",
            "SessionAuthentication",
            "TokenAuthentication",
            "RemoteUserAuthentication",
            "BaseAuthentication",
            "get_authorization_header",
        ],
    ),
];

fn last(path: &str) -> &str {
    path.trim_end_matches("()")
        .rsplit('.')
        .next()
        .unwrap_or_default()
}

/// `package`'s export `path` is on a list of what never authenticates.
fn never(package: &str, path: &str) -> bool {
    if package.starts_with("python:") || NEVER.contains(&package) {
        return true;
    }
    // A framework: by its modules that authenticate, whatever else it is known as.
    if let Some((_, modules)) = FRAMEWORKS.iter().find(|(p, _)| *p == package) {
        let in_auth = modules.iter().any(|m| {
            path == *m || path.starts_with(&format!("{m}.")) || path.contains(&format!(".{m}."))
        });
        return !in_auth
            || FRAMEWORK_NEVER
                .iter()
                .any(|(p, names)| *p == package && names.contains(&last(path)));
    }
    // A package with entries of its own is read by them.
    if LIBRARY.iter().any(|e| e.package == package) {
        return false;
    }
    // What the practice map already knows as a data, logging, validation,
    // configuration, tracing or error-report library, or an HTTP client.
    use crate::practices::libraries as l;
    let r = format!("pkg:{package}#{path}");
    l::data_library(&r).is_some()
        || l::logger_library(&r).is_some()
        || l::validation_library(&r).is_some()
        || l::config_library(&r).is_some()
        || l::tracer(&r)
        || l::error_reporter(&r)
        || l::HTTP_CLIENT_LIBRARIES.contains(&package)
}

/// The [`LIBRARY`] entry of `package`'s export `path`; with `member`, of that
/// member of an instance of the class `path` names (empty: the instance called).
fn entry(package: &str, path: &str, member: Option<&str>) -> Option<&'static Entry> {
    let name = match member {
        None => last(path).to_string(),
        Some("") => format!("{}()", last(path)),
        Some(m) => format!("{}.{m}", last(path)),
    };
    LIBRARY
        .iter()
        .find(|e| e.package == package && e.name == name)
}

/// A package's export at a guard position. `instance`: the thing is a member of
/// an instance of the class the path names, or that instance called
/// (`(how the instance was built, member)`).
fn library(
    at: Position,
    canonical: &str,
    package: &str,
    path: &str,
    instance: Option<(&Shape, &str)>,
    shape: &Shape,
) -> Verdict {
    let found = entry(package, path, instance.map(|(_, m)| m));
    let Some(e) = found else {
        // A member of an instance of a class that never authenticates
        // (`limiter.limit(...)`, `csrf.exempt`, `cache.cached(...)`), or an export
        // of such a package.
        return if never(package, path) {
            Verdict::Nothing
        } else {
            UNCLASSIFIED
        };
    };
    if e.is == Is::Never {
        return Verdict::Nothing;
    }
    // A scheme is a guard as an instance; so is what a decorator factory hands
    // back. The shape that decides is the call that made it.
    match (e.form, shape.called) {
        (Form::Built, false) | (Form::Called, false) => {
            // The class itself where an instance goes, a factory where its result
            // goes: as a hook, a factory with no required argument is called by
            // the framework with none.
            if !(at == Position::Hook && e.form == Form::Called) {
                return UNCLASSIFIED;
            }
        }
        (Form::Bare, true) => return UNCLASSIFIED,
        _ => {}
    }
    let Some(args) = shape.by_name(e.positional) else {
        return UNCLASSIFIED;
    };
    let mut optional = false;
    for (name, value) in args {
        if name == VIEW {
            continue;
        }
        if let Some((_, weak)) = e.optional.iter().find(|(n, _)| *n == name) {
            match value {
                v if v == *weak => optional = true,
                "True" | "False" => {}
                _ => return UNCLASSIFIED,
            }
        } else if !e.plain.contains(&name) {
            return UNCLASSIFIED;
        }
    }
    if optional {
        Verdict::Nothing
    } else {
        Verdict::Guard(canonical.to_string())
    }
}

/// What a guard of [`LIBRARY`] decides of a caller who is signed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Checks {
    /// A role, a permission or a staff flag, however it is written.
    Role,
    /// One where one of these options is given (`auth.login_required(role="admin")`,
    /// `require_oauth("profile")`), and the sign-in alone without them.
    RoleWith(&'static [&'static str]),
    /// One where this option is `True` (`current_user(superuser=True)`), the
    /// sign-in alone where it is `False` or left out; any other value is not read.
    RoleWhen(&'static str),
    /// What it is given decides, and the facts do not hold it (`requires(
    /// "authenticated")` asks for the sign-in, `requires("admin")` for a scope).
    Unread,
}

/// The guards of [`LIBRARY`] that check more than the sign-in, as `(package, entry
/// name, what)`. A guard of [`LIBRARY`] that is not here only signs the caller in:
/// Django's `login_required` and `LoginRequiredMixin`, DRF's `IsAuthenticated` and
/// `IsAuthenticatedOrReadOnly`, Flask-Login, Flask-JWT-Extended, FastAPI's security
/// schemes (their `scopes` only document the API: FastAPI hands the scopes of
/// `Security(dep, scopes=[...])` to a dependency that asks for `SecurityScopes`, and
/// checks none itself).
///
/// - Django's `permission_required` and `PermissionRequiredMixin` (`has_perms`),
///   `staff_member_required` (`is_staff`);
/// - DRF's `IsAdminUser` (`is_staff`), `DjangoModelPermissions`,
///   `DjangoModelPermissionsOrAnonReadOnly`, `DjangoObjectPermissions`;
/// - Flask-HTTPAuth's `login_required(role=...)`: `authorize` answers 403 unless the
///   application's `get_user_roles` gives the user one of the roles;
/// - Authlib's `ResourceProtector` called with scopes (`require_oauth("profile")`):
///   `insufficient_scope` (403) unless the token has them;
/// - FastAPI Users' `current_user(superuser=True)`: 403 unless `is_superuser`
///   (`active` and `verified` are the account's state, no role);
/// - Starlette's `requires(scopes)`: the scopes are not in the facts.
const AUTHORIZES: &[(&str, &str, Checks)] = &[
    ("django", "permission_required", Checks::Role),
    ("django", "staff_member_required", Checks::Role),
    ("django", "PermissionRequiredMixin", Checks::Role),
    ("rest_framework", "IsAdminUser", Checks::Role),
    ("rest_framework", "DjangoModelPermissions", Checks::Role),
    (
        "rest_framework",
        "DjangoModelPermissionsOrAnonReadOnly",
        Checks::Role,
    ),
    ("rest_framework", "DjangoObjectPermissions", Checks::Role),
    (
        "flask_httpauth",
        "HTTPBasicAuth.login_required",
        Checks::RoleWith(&["role"]),
    ),
    (
        "flask_httpauth",
        "HTTPTokenAuth.login_required",
        Checks::RoleWith(&["role"]),
    ),
    (
        "flask_httpauth",
        "HTTPDigestAuth.login_required",
        Checks::RoleWith(&["role"]),
    ),
    (
        "flask_httpauth",
        "MultiAuth.login_required",
        Checks::RoleWith(&["role"]),
    ),
    (
        "authlib",
        "ResourceProtector()",
        Checks::RoleWith(&["scopes", "scope"]),
    ),
    (
        "fastapi_users",
        "FastAPIUsers.current_user",
        Checks::RoleWhen("superuser"),
    ),
    ("starlette", "requires", Checks::Unread),
];

/// [`library`], or for [`authorizes`] what the guard it proves checks beyond the
/// sign-in ([`AUTHORIZES`]): the role guard with its instrument, nothing for a
/// guard that only signs the caller in, unknown where what decides is not read.
fn library_for(
    authz: bool,
    at: Position,
    canonical: &str,
    package: &str,
    path: &str,
    instance: Option<(&Shape, &str)>,
    shape: &Shape,
) -> Verdict {
    let verdict = library(at, canonical, package, path, instance, shape);
    if !authz {
        return verdict;
    }
    let Verdict::Guard(_) = verdict else {
        return verdict;
    };
    let Some(e) = entry(package, path, instance.map(|(_, m)| m)) else {
        return UNCLASSIFIED;
    };
    let Some((_, _, checks)) = AUTHORIZES
        .iter()
        .find(|(p, name, _)| *p == e.package && *name == e.name)
    else {
        return Verdict::Nothing;
    };
    // The instrument: the export, or the member of the instance.
    let instrument = match instance {
        Some((_, member)) if !member.is_empty() => format!("{canonical}.{member}"),
        _ => canonical.to_string(),
    };
    let given = |option: &str| {
        shape.by_name(e.positional).and_then(|args| {
            args.into_iter()
                .find(|(name, _)| *name == option)
                .map(|(_, value)| value.to_string())
        })
    };
    match checks {
        Checks::Role => Verdict::Guard(instrument),
        Checks::RoleWith(options) => {
            let asked = options
                .iter()
                .any(|o| given(o).is_some_and(|value| value != "None"));
            if asked {
                Verdict::Guard(instrument)
            } else {
                Verdict::Nothing
            }
        }
        Checks::RoleWhen(option) => match given(option).as_deref() {
            None | Some("False") => Verdict::Nothing,
            Some("True") => Verdict::Guard(instrument),
            Some(_) => UNCLASSIFIED,
        },
        Checks::Unread => UNCLASSIFIED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(text: &str) -> Shape {
        Shape::parse(text)
    }

    /// A guard, whatever proves it.
    const GUARD: Verdict = Verdict::Guard(String::new());

    fn lib(at: Position, canonical: &str, text: &str) -> Verdict {
        let (package, path) = canonical
            .strip_prefix("pkg:")
            .unwrap()
            .split_once('#')
            .unwrap();
        match library(at, canonical, package, path, None, &shape(text)) {
            Verdict::Guard(_) => GUARD,
            v => v,
        }
    }

    fn lib_az(canonical: &str, instance: Option<(&str, &str)>, text: &str) -> Verdict {
        let (package, path) = canonical
            .strip_prefix("pkg:")
            .unwrap()
            .split_once('#')
            .unwrap();
        let built = instance.map(|(built, member)| (shape(built), member));
        let instance = built.as_ref().map(|(b, m)| (b, *m));
        match library_for(
            true,
            Position::Decorator,
            canonical,
            package,
            path,
            instance,
            &shape(text),
        ) {
            Verdict::Guard(_) => GUARD,
            v => v,
        }
    }

    #[test]
    fn a_library_guard_authorizes_only_by_its_entry_and_its_shape() {
        // Only the sign-in: nothing for authorization.
        assert_eq!(
            lib_az("pkg:flask_login#login_required", None, ""),
            Verdict::Nothing
        );
        assert_eq!(
            lib_az("pkg:flask_jwt_extended#jwt_required", None, "()"),
            Verdict::Nothing
        );
        // A permission, however it is written.
        let perm = "pkg:django#contrib.auth.decorators.permission_required";
        assert_eq!(lib_az(perm, None, "(lit)"), GUARD);
        assert_eq!(lib_az(perm, None, "(lit,raise_exception=True)"), GUARD);
        // A shape the list does not understand is not read, for either question.
        assert_eq!(lib_az(perm, None, "(lit,**)"), UNCLASSIFIED);
        // A role only where one is asked for.
        let basic = "pkg:flask_httpauth#HTTPBasicAuth";
        let login = Some(("()", "login_required"));
        assert_eq!(lib_az(basic, login, ""), Verdict::Nothing);
        assert_eq!(lib_az(basic, login, "(role=lit)"), GUARD);
        assert_eq!(lib_az(basic, login, "(role=None)"), Verdict::Nothing);
        assert_eq!(
            lib_az(basic, login, "(role=lit,optional=True)"),
            Verdict::Nothing
        );
        let protector = "pkg:authlib#integrations.flask_oauth2.ResourceProtector";
        assert_eq!(lib_az(protector, Some(("()", "")), "()"), Verdict::Nothing);
        assert_eq!(lib_az(protector, Some(("()", "")), "(lit)"), GUARD);
        let users = "pkg:fastapi_users#FastAPIUsers";
        let current = Some(("(?,?)", "current_user"));
        assert_eq!(lib_az(users, current, "(active=True)"), Verdict::Nothing);
        assert_eq!(lib_az(users, current, "(superuser=True)"), GUARD);
        assert_eq!(
            lib_az(users, current, "(superuser=False)"),
            Verdict::Nothing
        );
        assert_eq!(lib_az(users, current, "(superuser=?)"), UNCLASSIFIED);
        // What it is given decides, and is not in the facts.
        assert_eq!(
            lib_az("pkg:starlette#authentication.requires", None, "(lit)"),
            UNCLASSIFIED
        );
        // A package on no list is unknown for both questions.
        assert_eq!(
            lib_az("pkg:company_auth#require_scope", None, "(lit)"),
            UNCLASSIFIED
        );
        assert!(base_authorizes(
            "pkg:django#contrib.auth.mixins.PermissionRequiredMixin"
        ));
        assert!(!base_authorizes(
            "pkg:django#contrib.auth.mixins.LoginRequiredMixin"
        ));
        assert!(!base_authorizes(
            "pkg:guardian#mixins.PermissionRequiredMixin"
        ));
    }

    #[test]
    fn a_library_guard_is_one_only_in_a_shape_on_its_entry() {
        use Position::{Call, Decorator, Dependency, Hook};
        let jwt = "pkg:flask_jwt_extended#jwt_required";
        assert_eq!(lib(Decorator, jwt, "()"), GUARD);
        assert_eq!(lib(Decorator, jwt, "(fresh=True)"), GUARD);
        assert_eq!(lib(Decorator, jwt, "(optional=False)"), GUARD);
        assert_eq!(lib(Decorator, jwt, "(optional=True)"), Verdict::Nothing);
        assert_eq!(lib(Decorator, jwt, "(True)"), Verdict::Nothing);
        assert_eq!(lib(Decorator, jwt, "(optional=?)"), UNCLASSIFIED);
        assert_eq!(
            lib(Decorator, jwt, "(skip_revocation_check=True)"),
            UNCLASSIFIED
        );
        assert_eq!(lib(Decorator, jwt, "(**)"), UNCLASSIFIED);
        // Written bare, a factory is handed the view as its first option.
        assert_eq!(lib(Decorator, jwt, ""), UNCLASSIFIED);
        let verify = "pkg:flask_jwt_extended#verify_jwt_in_request";
        assert_eq!(lib(Call, verify, "()"), GUARD);
        assert_eq!(lib(Call, verify, "(optional=True)"), Verdict::Nothing);
        // Given to `before_request`, Flask calls it with nothing.
        assert_eq!(lib(Hook, verify, ""), GUARD);
        let bearer = "pkg:fastapi#security.HTTPBearer";
        assert_eq!(lib(Dependency, bearer, "()"), GUARD);
        assert_eq!(lib(Dependency, bearer, "(auto_error=True)"), GUARD);
        assert_eq!(
            lib(Dependency, bearer, "(auto_error=False)"),
            Verdict::Nothing
        );
        assert_eq!(lib(Dependency, bearer, "(auto_error=?)"), UNCLASSIFIED);
        // The class where an instance goes.
        assert_eq!(lib(Dependency, bearer, ""), UNCLASSIFIED);
        let login = "pkg:django#contrib.auth.decorators.login_required";
        assert_eq!(lib(Decorator, login, ""), GUARD);
        assert_eq!(lib(Decorator, login, "(login_url=lit)"), GUARD);
        assert_eq!(lib(Decorator, login, "(?)"), GUARD);
        assert_eq!(lib(Decorator, login, "(strict=True)"), UNCLASSIFIED);
    }

    #[test]
    fn a_package_on_no_list_is_unknown_and_one_that_never_authenticates_is_nothing() {
        use Position::{Decorator, Dependency};
        assert_eq!(
            lib(Decorator, "pkg:company_auth#require_login", ""),
            UNCLASSIFIED
        );
        assert_eq!(
            lib(
                Decorator,
                "pkg:rules#contrib.views.permission_required",
                "(lit)"
            ),
            UNCLASSIFIED
        );
        assert_eq!(
            lib(Decorator, "pkg:guardian#mixins.PermissionRequiredMixin", ""),
            UNCLASSIFIED
        );
        assert_eq!(
            lib(Decorator, "pkg:flask_cors#cross_origin", "()"),
            Verdict::Nothing
        );
        assert_eq!(
            lib(Decorator, "pkg:python:functools#lru_cache", "()"),
            Verdict::Nothing
        );
        assert_eq!(
            lib(
                Decorator,
                "pkg:django#views.decorators.csrf.csrf_exempt",
                ""
            ),
            Verdict::Nothing
        );
        assert_eq!(
            lib(Decorator, "pkg:django#db.transaction.atomic", ""),
            Verdict::Nothing
        );
        assert_eq!(
            lib(
                Dependency,
                "pkg:fastapi#security.OAuth2PasswordRequestForm",
                ""
            ),
            Verdict::Nothing
        );
        // A name of an authenticating module that no entry knows.
        assert_eq!(
            lib(
                Decorator,
                "pkg:django#contrib.auth.decorators.something_new",
                ""
            ),
            UNCLASSIFIED
        );
    }

    #[test]
    fn a_member_of_an_instance_is_read_by_its_class() {
        use Position::Decorator;
        let built = shape("()");
        let member = |class: &str, member: &str, text: &str| {
            let (package, path) = class.strip_prefix("pkg:").unwrap().split_once('#').unwrap();
            match library(
                Decorator,
                class,
                package,
                path,
                Some((&built, member)),
                &shape(text),
            ) {
                Verdict::Guard(_) => GUARD,
                v => v,
            }
        };
        let basic = "pkg:flask_httpauth#HTTPBasicAuth";
        assert_eq!(member(basic, "login_required", ""), GUARD);
        assert_eq!(member(basic, "login_required", "(role=lit)"), GUARD);
        assert_eq!(
            member(basic, "login_required", "(optional=True)"),
            Verdict::Nothing
        );
        assert_eq!(member(basic, "verify_password", ""), UNCLASSIFIED);
        let protector = "pkg:authlib#integrations.flask_oauth2.ResourceProtector";
        assert_eq!(member(protector, "", "(lit)"), GUARD);
        assert_eq!(member(protector, "", "()"), GUARD);
        assert_eq!(
            member(protector, "", "(lit,optional=True)"),
            Verdict::Nothing
        );
        assert_eq!(member(protector, "", "(lit,lit)"), UNCLASSIFIED);
        let users = "pkg:fastapi_users#FastAPIUsers";
        assert_eq!(member(users, "current_user", "(active=True)"), GUARD);
        assert_eq!(
            member(users, "current_user", "(optional=True)"),
            Verdict::Nothing
        );
        assert_eq!(
            member(users, "current_user", "(get_enabled_backends=None)"),
            UNCLASSIFIED
        );
        assert_eq!(
            member("pkg:flask_limiter#Limiter", "limit", "(lit)"),
            Verdict::Nothing
        );
        assert_eq!(member("pkg:company_sso#SSO", "protect", ""), UNCLASSIFIED);
    }
}
