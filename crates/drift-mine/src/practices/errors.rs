//! Error handling (PLAN-R13 §1.3), at the entry points: how an error becomes a
//! response. Population: request entry points.
//!
//! Uses, any of which together make one key:
//! - `app_handler:<handler>`: what the handler throws (or, with nothing thrown, any
//!   error) is covered by a symbol of the same package registered to handle it
//!   (`handles_errors`: FastAPI `exception_handler`, Nest `@Catch`, Flask
//!   `errorhandler(404)`, Express error middleware);
//! - `mapped_by_wrapper:<wrapper>`: a wrapper whose definition catches and responds;
//! - `in_body_try:<builder>`: a catch in the handler that responds (or `return` /
//!   `swallow` when it does that instead); for a handler that builds no response and
//!   catches nothing itself, a catch in the function it hands the request to
//!   (`return proxyRequest(request, params)`: what the route answers is that
//!   function's), where that is the only in-repo function it calls that builds a
//!   response;
//! - `throw:<class>`: a framework error (HTTPException, TRPCError, Nest exceptions,
//!   Boom, `abort`) the framework turns into its status, with no app handler for it;
//! - `bubble:framework_default`: none of these, so the framework's default 500. A
//!   fact, not a gap.
//!
//! Unknown [STRICT]: an in-repo wrapper with no definition (it may catch), an
//! unresolved wrapper, a catch that hands what it caught to the framework after a
//! statement not read (it may have answered), a Python view whose bases are not all
//! read. There is no `none`: an error always goes somewhere.

use std::collections::BTreeSet;

use drift_core::{FileFacts, ResponseVia, Symbol, WrapKind};

use super::common::{
    self, REQUEST_KINDS, canonical, external, in_skipped, unit_symbol, unknown, unreadable, use_of,
};
use super::libraries::framework_error;
use super::{Assignment, Concern, Cx, UnitRef, UnknownReason, Use, VariantSource};

pub struct Errors;

/// What a catch clause does ([`drift_core::CatchFact::does`]) where it hands what it
/// caught to the framework's continuation after a statement Drift does not read
/// (TypeScript, the listed reading only).
const CATCH_UNREAD: &str = "unread";

/// The base classes a handler of which covers every framework error of its package.
const BASE_ERRORS: &[&str] = &["HTTPException", "HttpException", "APIException"];

impl Concern for Errors {
    fn id(&self) -> &'static str {
        super::ERRORS
    }

    fn unit(&self) -> &'static str {
        "entry_point"
    }

    /// `bubble:framework_default` is the absence of any handling, recorded as a way: a
    /// new route that handles nothing does it without trying.
    fn passive(&self, uses: &[Use]) -> bool {
        !uses.is_empty() && uses.iter().all(|u| u.mechanism == "bubble")
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        common::entries(cx, REQUEST_KINDS)
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        if let Some(a) = unreadable(cx, unit) {
            return a;
        }
        let (Some((sfile, s)), file) = (unit_symbol(cx, unit), unit.file()) else {
            return unknown(UnknownReason::NoSymbol, "");
        };
        if let Some(a) = common::truncated(sfile, s, &["catches", "responses"]) {
            return a;
        }
        let ctx = cx.context();
        let bodies = answering(cx, common::bodies(cx, s));
        if let Some(m) = own_method_catches(sfile, s, &bodies) {
            return unknown(UnknownReason::NotFollowed, &m);
        }
        let mut uses: Vec<Use> = Vec::new();
        // Python: the override of the framework's method on the view's own class or
        // an in-repo base that answers what that method raised (S15c). A base not
        // read decides only a view nothing else here is read for: a way its own
        // body or wrappers are read to use stays known, as before S15c.
        let base = base_handler(cx, sfile, s);
        if let Ok(Some(h)) = &base {
            uses.push(use_of("base_handler", h));
        }
        for w in &s.wraps {
            if !matches!(w.kind, WrapKind::Call | WrapKind::Decorator) {
                continue;
            }
            let r = &w.wrapper;
            if r.starts_with("unresolved:") {
                return unknown(UnknownReason::Unresolved, r);
            }
            if external(r) {
                continue;
            }
            match ctx.definition(r) {
                None if in_skipped(cx, r) => return unknown(UnknownReason::Unparsed, r),
                None => return unknown(UnknownReason::OpaqueWrapper, r),
                // A guard's own catch (a bearer scheme mapping a bad token to 403) is
                // authentication, not how the handler's errors become responses.
                Some(_)
                    if crate::security::authenticates(ctx, r)
                        || super::authn::class_guard(cx, r) => {}
                // Python: nor is a dependency's catch whose every answer turns the
                // caller away, where the sign-in reading says the dependency may
                // (S15c): `get_current_user` mapping a bad token to 403 refuses the
                // caller; it maps none of the route's errors.
                Some(d) if refuses_in_catch(ctx, r, d) => {}
                Some(d) if responds_in_catch(d) => uses.push(use_of("mapped_by_wrapper", r)),
                Some(_) => {}
            }
        }
        for c in bodies.iter().flat_map(|b| &b.catches) {
            // TypeScript, the listed reading: a clause that hands what it caught to
            // the framework's continuation after a statement Drift does not read
            // (`catch (e) { sendError(res, e); next(e) }`) may have answered the
            // request itself: neither the framework's handling nor the handler's.
            if c.does.iter().any(|d| d == CATCH_UNREAD) {
                return unknown(UnknownReason::Unclassified, "catch");
            }
            if c.does.iter().any(|d| d.starts_with("respond:")) {
                let builder = bodies
                    .iter()
                    .flat_map(|b| &b.responses)
                    .find(|r| r.in_catch && !r.builder.is_empty())
                    .map_or("respond".to_string(), |r| r.builder.clone());
                uses.push(use_of("in_body_try", &builder));
            } else if c.does.iter().any(|d| d == "return" || d == "swallow") {
                let what = if c.does.iter().any(|d| d == "return") {
                    "return"
                } else {
                    "swallow"
                };
                uses.push(use_of("in_body_try", what));
            }
        }
        let handlers = handlers(
            cx,
            &file.package,
            &sfile.package,
            entry_adapter(unit),
            sfile,
        );
        let thrown: BTreeSet<String> = bodies.iter().flat_map(|b| thrown(b)).collect();
        let statuses: BTreeSet<u16> = bodies
            .iter()
            .flat_map(|b| &b.responses)
            .filter(|r| matches!(r.via, ResponseVia::Throw | ResponseVia::Abort) && r.status > 0)
            .map(|r| r.status)
            .collect();
        for t in &thrown {
            // A handler registered for the class (or its status) before a catch-all.
            let specific = |x: &String| {
                x != "*"
                    && (covers(cx, x, t) || statuses.iter().any(|n| *x == format!("status:{n}")))
            };
            let handled = handlers
                .iter()
                .find(|(_, h)| h.iter().any(specific))
                .or_else(|| handlers.iter().find(|(_, h)| h.iter().any(|x| x == "*")));
            if let Some((h, _)) = handled {
                uses.push(use_of("app_handler", h));
            } else if framework_error(t) {
                uses.push(use_of("throw", t.trim_end_matches("(new)")));
            } else if let Some(base) = ctx.ancestors(t).iter().find(|a| framework_error(a)) {
                uses.push(use_of("throw", base));
            }
        }
        // An in-repo base not read may hold the override: "framework default" (or
        // an app's catch-all) is not proven ([`base_handler`]).
        if uses.is_empty()
            && let Err(a) = base
        {
            return a;
        }
        if uses.is_empty() {
            match handlers.iter().find(|(_, h)| h.iter().any(|x| x == "*")) {
                Some((h, _)) => uses.push(use_of("app_handler", h)),
                None => uses.push(use_of("bubble", "framework_default")),
            }
        }
        let source = if uses
            .iter()
            .all(|u| u.mechanism == "throw" || u.mechanism == "bubble")
        {
            VariantSource::Vocab
        } else {
            VariantSource::Usage
        };
        common::known(uses, source)
    }
}

/// `bodies` (the handler's, [`common::bodies`]) and, when none of them builds a
/// response or catches anything, the one in-repo function whose call the handler
/// returns ([`Symbol::returns_calls`]), where it builds responses: the route answers
/// what it returns (`return proxyRequest(request, params)`), so a catch of its that
/// responds, or what it throws, is the route's. One level. A handler that builds a
/// response or has a catch of its own is read as it stands.
///
/// [STRICT]: only the callee whose call is returned. `await readSession(request)`,
/// whose catch answers 401, and then `return fetch(url)` or `return passThrough(url)`
/// answers what the fetch or `passThrough` gave: nothing catches what that throws,
/// and the catch of the helper whose value is not returned is not how the route's
/// errors become responses. A handler that returns the calls of two functions of the
/// repository is answered by either: none is followed, and the route reads as its
/// own body does.
fn answering<'a>(cx: &Cx<'a>, mut bodies: Vec<&'a Symbol>) -> Vec<&'a Symbol> {
    if bodies
        .iter()
        .any(|b| !b.responses.is_empty() || !b.catches.is_empty())
    {
        return bodies;
    }
    let Some(handler) = bodies.first().copied() else {
        return bodies;
    };
    let ctx = cx.context();
    let delegates: Vec<&'a Symbol> = handler
        .returns_calls
        .iter()
        .filter(|c| !external(c))
        .filter_map(|c| ctx.definition(c))
        .filter(|d| d.kind == drift_core::SymbolKind::Function)
        .filter(|d| !bodies.iter().any(|b| std::ptr::eq(*b, *d)))
        .collect();
    let mut distinct: Vec<&'a Symbol> = Vec::new();
    for d in delegates {
        if !distinct.iter().any(|x| std::ptr::eq(*x, d)) {
            distinct.push(d);
        }
    }
    if let [only] = distinct.as_slice()
        && !only.responses.is_empty()
    {
        bodies.push(only);
    }
    bodies
}

/// [STRICT] A NestJS route whose own body builds no response and catches nothing,
/// and calls a method of its own controller (`return this.load(id)`) where a
/// method of that class has a `catch`: the helper's body may answer what it catches
/// with a fallback, which is then the route's answer, not the framework's 500. A
/// method's own catches are not recorded apart from its class's, so which method
/// catches is not read: the route is unknown (the method named), never `bubble`.
fn own_method_catches(file: &FileFacts, s: &Symbol, bodies: &[&Symbol]) -> Option<String> {
    if bodies
        .iter()
        .any(|b| !b.responses.is_empty() || !b.catches.is_empty())
    {
        return None;
    }
    common::owning_classes(file, s).iter().find_map(|class| {
        if class.catches.is_empty() {
            return None;
        }
        let own = format!("{}#{}.", file.path, class.name);
        s.order
            .iter()
            .chain(&s.calls)
            .chain(&s.returns_calls)
            .find(|c| {
                c.strip_prefix(&own)
                    .is_some_and(|m| class.members.iter().any(|x| x.name == m))
            })
            .cloned()
    })
}

fn responds_in_catch(d: &Symbol) -> bool {
    d.catches
        .iter()
        .any(|c| c.does.iter().any(|x| x.starts_with("respond:")))
}

/// [Python] The wrapper `r` (defined as `d`) answers in its catches only by
/// turning the caller away (every `respond:` of its catches is a 401 or a 403, and
/// there is one), and the sign-in reading says it may turn callers away
/// ([`crate::security::may_authenticate`]: a refusal in an `except` handler, or a
/// body that rejects). That catch is a refusal of the caller, as a guard's is: the
/// FastAPI template's `get_current_user` mapping a token that does not decode to
/// 403. It is not how the route's errors become responses. Read from the statuses
/// and the sign-in reading, never from the wrapper's name; a wrapper that also
/// answers some other status in a catch still maps errors (S15c).
fn refuses_in_catch(ctx: &crate::context::RepoContext, r: &str, d: &Symbol) -> bool {
    let python = crate::mine::norm_ref(r)
        .split_once('#')
        .is_some_and(|(m, _)| m.ends_with(".py"));
    if !python {
        return false;
    }
    let mut statuses = d
        .catches
        .iter()
        .flat_map(|c| &c.does)
        .filter_map(|x| x.strip_prefix("respond:"))
        .peekable();
    statuses.peek().is_some()
        && statuses.all(|s| matches!(s, "401" | "403"))
        && crate::security::may_authenticate(ctx, r)
}

/// The methods a framework's view class runs around every request's handler, so
/// that an override of one that answers in its own `except` handler answers what
/// any handler of the view raised, with the packages whose view classes run each:
/// Django's `View` (and DRF's `APIView`, built on it) runs the handler inside
/// `dispatch`; DRF's `APIView.dispatch` hands whatever the handler raised to
/// `handle_exception`; Flask's `View` runs it inside `dispatch_request`. How the
/// frameworks run, as `authz::RUNS_EVERY_REQUEST` is; a method on no line here
/// runs for a request only where the handler's own method is it.
const AROUND_EVERY_HANDLER: &[(&str, &[&str])] = &[
    ("dispatch", &["pkg:django#", "pkg:rest_framework#"]),
    ("dispatch_request", &["pkg:flask#"]),
    ("handle_exception", &["pkg:rest_framework#"]),
];

/// [Python] The method of a class of the repository that runs for the entry and
/// overrides its base's (its body calls `super().<name>(...)`), answering in its own
/// `except` handler with a response ([`drift_core::CATCH_RESPONDS`]): plane's
/// `BaseAPIView.handle_exception`, which turns what DRF's own handling raised
/// (`IntegrityError`, `ObjectDoesNotExist`) into a 400 or a 404. What the base's
/// method raised for the view is answered there: that is how the view's errors
/// become responses. Canonical (`app/views/base.py#BaseAPIView.handle_exception`).
///
/// Only a method that runs for the entry counts: the entry's own method (`get` of
/// `ItemView.get`, found on a base where the view's own hands on to it), or one the
/// framework runs around every handler of the class ([`AROUND_EVERY_HANDLER`], where
/// the class is built on that framework's view). `Base.create` answering an
/// `IntegrityError` says nothing of `ItemView.get`: `create` never runs on a GET.
/// Which class's method runs is looked up as Python does, in the class's method
/// resolution order (C3, [`crate::security::class_order`]): `class V(MixinA, Base)`
/// runs `MixinA.handle_exception`, and `Base`'s only where that one hands on to it.
///
/// Unknown where that order cannot be worked out, where a base of the repository
/// is not read (no definition, a module not parsed, written as nothing a reference
/// stands for, not resolved), where a class binds the name to what is not a `def`,
/// or where a package's class before the override may define the method in its
/// place: what runs is not read. A package's base is the framework's and is not
/// read. Read from what the bodies do and the order Python looks them up in, never
/// from what a class is called (S15c).
fn base_handler<'a>(
    cx: &Cx<'a>,
    sfile: &'a FileFacts,
    s: &'a Symbol,
) -> Result<Option<String>, Assignment> {
    use crate::security::Mro;
    if sfile.lang != "py" {
        return Ok(None);
    }
    let ctx = cx.context();
    let (class_name, own) = match s.kind {
        drift_core::SymbolKind::Class => (s.name.as_str(), None),
        _ => match s.name.rsplit_once('.') {
            Some((c, m)) => (c, Some(m)),
            None => return Ok(None),
        },
    };
    let Some(class) = sfile
        .symbols
        .iter()
        .find(|x| x.kind == drift_core::SymbolKind::Class && x.name == class_name)
    else {
        return Ok(None);
    };
    let id = format!("{}#{class_name}", sfile.path);
    let Some(order) = crate::security::class_order(ctx, &id, class) else {
        return Err(unknown(UnknownReason::NotFollowed, &id));
    };
    // A base the facts do not define may hold the override.
    let unknown_base = format!("global#{}", drift_core::UNKNOWN_BASE_NAME);
    for c in &order {
        let Mro::Package(b) = c else { continue };
        if b.starts_with("unresolved:") {
            return Err(unknown(UnknownReason::Unresolved, b));
        }
        if *b == unknown_base {
            return Err(unknown(UnknownReason::NotFollowed, b));
        }
        if external(b) {
            continue;
        }
        if in_skipped(cx, b) {
            return Err(unknown(UnknownReason::Unparsed, b));
        }
        return Err(unknown(UnknownReason::NotFollowed, b));
    }
    let framework = |prefixes: &[&str]| {
        order.iter().any(|x| {
            matches!(x, Mro::Package(p) if prefixes.iter().any(|f| p.starts_with(f)))
        })
    };
    let around = AROUND_EVERY_HANDLER
        .iter()
        .filter(|(n, by)| Some(*n) != own && framework(by))
        .map(|(n, _)| *n);
    for name in own.into_iter().chain(around) {
        if let Some(h) = override_answering(&order, name, own == Some(name))? {
            return Ok(Some(h));
        }
    }
    Ok(None)
}

/// The body calls its base's method of its own name (`super().<name>(...)`).
fn calls_base(m: &drift_core::Member) -> bool {
    let global = format!("global#super().{}", m.name);
    let local = format!("local:super().{}", m.name);
    m.calls.contains(&global) || m.receiver_calls.contains(&local)
}

/// Looks `name` up in `order` as Python runs it ([`base_handler`]): the first class
/// of the repository that defines it runs, and the next one only where that one
/// calls its base's. The first that hands on inside an `except` handler that
/// answers, `<class>.<name>`; none where one that runs does not hand on before
/// one does. `own`: `name` is the entry's own method, whose definition on the bound
/// class (the first in the order) is the handler's body, read as that, not as an
/// override.
fn override_answering(
    order: &[crate::security::Mro<'_>],
    name: &str,
    own: bool,
) -> Result<Option<String>, Assignment> {
    use crate::security::Mro;
    // A package's class before the method that may define it in its place.
    let mut shadow: Option<&str> = None;
    for (at, c) in order.iter().enumerate() {
        match c {
            Mro::Package(p) => {
                if shadow.is_none() && crate::security::package_may_define(p, name) {
                    shadow = Some(p.as_str());
                }
            }
            Mro::Repo(cid, d) => {
                // `declares` holds every name the body binds, a `def` too: only a
                // name bound with no method of it (`dispatch = guard(...)`) is
                // unread, as `security::lookup` reads it.
                let Some(m) = d.members.iter().find(|m| m.name == name) else {
                    if d.declares
                        .iter()
                        .any(|x| x.split_once('=').map_or(x.as_str(), |(n, _)| n) == name)
                    {
                        return Err(unknown(UnknownReason::NotFollowed, &format!("{cid}.{name}")));
                    }
                    continue;
                };
                let body = own && at == 0;
                if !body
                    && calls_base(m)
                    && m.unread.iter().any(|u| u == drift_core::CATCH_RESPONDS)
                {
                    if let Some(p) = shadow {
                        return Err(unknown(UnknownReason::NotFollowed, p));
                    }
                    return Ok(Some(format!("{cid}.{name}")));
                }
                if !calls_base(m) {
                    return Ok(None);
                }
            }
        }
    }
    Ok(None)
}

/// What the handler throws: `throws`, and the classes of responses it throws or aborts
/// with, package-normalised.
fn thrown(s: &Symbol) -> BTreeSet<String> {
    let mut out: BTreeSet<String> = s
        .throws
        .iter()
        .map(|t| crate::mine::norm_ref(t).into_owned())
        .collect();
    for r in &s.responses {
        if matches!(r.via, ResponseVia::Throw | ResponseVia::Abort) && !r.builder.is_empty() {
            out.insert(crate::mine::norm_ref(r.builder.trim_end_matches("(new)")).into_owned());
        }
    }
    out
}

/// A handler registered for `handled` covers the thrown class `t`: the same class,
/// one of its in-repo bases, any error (`*`), or the framework's base HTTP error of
/// the same package (`HttpException` covers `NotFoundException`).
fn covers(cx: &Cx<'_>, handled: &str, t: &str) -> bool {
    let h = crate::mine::norm_ref(handled);
    h == "*"
        || h == t
        || cx.context().ancestors(t).iter().any(|a| *a == h)
        || (BASE_ERRORS.contains(&common::short(&h))
            && framework_error(t)
            && common::package_root(&h) == common::package_root(t))
}

/// The error handlers of the entry's package (and of its handler's, for a
/// re-export): each symbol's canonical id and what it handles.
fn handlers(
    cx: &Cx<'_>,
    package: &str,
    other: &str,
    adapter: &str,
    entry_file: &drift_core::FileFacts,
) -> Vec<(String, Vec<String>)> {
    // A Next.js route handler has no app-wide error handler: what is registered as one
    // there is client code (an error boundary, a fetch library's `onError`).
    if adapter == "nextjs" {
        return Vec::new();
    }
    let mut out = Vec::new();
    for f in cx.facts.files.iter().filter(|f| {
        (f.package == package || f.package == other)
            && !crate::roles::is_test_path(&f.path)
            && f.lang == entry_file.lang
            && server_side(f)
            // tRPC's `errorFormatter` handles tRPC procedures only.
            && (adapter == "trpc" || !imports_trpc(f))
    }) {
        for s in f
            .symbols
            .iter()
            .filter(|s| !s.handles_errors.is_empty() && s.kind != drift_core::SymbolKind::Component)
        {
            out.push((canonical(f, s), s.handles_errors.clone()));
        }
    }
    out
}

/// Code that runs on the server: not a `"use client"` module, not a component file.
fn server_side(f: &drift_core::FileFacts) -> bool {
    !f.directives.iter().any(|d| d == "use client") && f.lang != "tsx" && f.lang != "jsx"
}

fn imports_trpc(f: &drift_core::FileFacts) -> bool {
    f.imports.iter().any(|i| i.module.starts_with("pkg:@trpc/"))
}

/// The adapter of an entry unit ("" for other units).
fn entry_adapter<'a>(unit: &UnitRef<'a>) -> &'a str {
    match *unit {
        UnitRef::Entry { entry, .. } => entry.adapter.as_str(),
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn handlers_throws_and_try() {
        let d = empty();
        let facts = fixtures::fastapi_split();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Errors, &cx);
        let items = "services/api/app/routers/items.py";
        assert_eq!(
            key(&of(&all, items, "read_item")),
            "app_handler:services/api/app/main.py#http_exception_handler"
        );
        // Nothing thrown: the catch-all handler takes whatever is raised.
        assert_eq!(
            key(&of(&all, items, "create_item")),
            "app_handler:services/api/app/main.py#unhandled"
        );
        assert_eq!(
            key(&of(&all, "services/legacy/views.py", "show")),
            "app_handler:services/legacy/views.py#not_found"
        );

        let facts = fixtures::next_clerk();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Errors, &cx);
        let route = "app/api/projects/[projectId]/route.ts";
        assert_eq!(
            key(&of(&all, route, "GET")),
            "in_body_try:pkg:next#NextResponse.json"
        );
        assert_eq!(key(&of(&all, route, "POST")), "bubble:framework_default");

        let facts = fixtures::nest_mixed();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Errors, &cx);
        assert_eq!(
            key(&of(
                &all,
                "src/projects/projects.controller.ts",
                "GET /projects/:id"
            )),
            "app_handler:src/common/http-exception.filter.ts#HttpExceptionFilter"
        );
    }

    #[test]
    fn framework_throw_and_unknown() {
        let d = empty();
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Errors, &cx);
        assert_eq!(
            key(&of(&all, "svc/app/routes.py", "admin_items")),
            "throw:pkg:fastapi#HTTPException"
        );
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Errors, &cx);
        assert_eq!(
            of(&all, "app/api/opaque/route.ts", "GET"),
            unknown(UnknownReason::OpaqueWrapper, "lib/wrap.ts#withThing")
        );
    }

    /// A handler that answers nothing itself is followed into the one function whose
    /// call it returns, where that function builds responses; never into a helper it
    /// only calls, and into none where it returns the calls of two.
    #[test]
    fn a_delegate_is_followed_only_when_its_call_is_what_the_handler_returns() {
        use drift_core::{CatchFact, ResponseFact, Symbol};
        let json = "pkg:next/server#NextResponse.json";
        let answers = |name: &str, catches: bool| Symbol {
            name: name.into(),
            exported_as: vec![name.into()],
            calls: vec![json.into()],
            responses: vec![ResponseFact {
                status: if catches { 401 } else { 200 },
                builder: json.into(),
                in_catch: catches,
                ..ResponseFact::default()
            }],
            catches: if catches {
                vec![CatchFact {
                    catches: vec!["*".into()],
                    does: vec!["respond:401".into()],
                }]
            } else {
                vec![]
            },
            ..Symbol::default()
        };
        let handler = |calls: &[&str], returns: &[&str]| Symbol {
            name: "GET".into(),
            exported_as: vec!["GET".into()],
            calls: calls.iter().map(|c| c.to_string()).collect(),
            returns_calls: returns.iter().map(|c| c.to_string()).collect(),
            ..Symbol::default()
        };
        let lib = drift_core::FileFacts {
            path: "lib/work.ts".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![answers("readSession", true), answers("work", false)],
            ..drift_core::FileFacts::default()
        };
        let route = |dir: &str, calls: &[&str], returns: &[&str]| drift_core::FileFacts {
            path: format!("app/api/{dir}/route.ts"),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![handler(calls, returns)],
            ..drift_core::FileFacts::default()
        };
        let (session, work) = ("lib/work.ts#readSession", "lib/work.ts#work");
        let mut files = vec![
            route("both", &[session, work], &[session, work]),
            route("caught", &[session], &[session]),
            route("plain", &[work], &[work]),
            // `await readSession(request); return work(url)`.
            route("second", &[session, work], &[work]),
            // `await readSession(request); return fetch(url)`.
            route("fetch", &["global#fetch", session], &["global#fetch"]),
            // `const r = await readSession(request); return r`.
            route("bound", &[session], &[]),
            lib,
        ];
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let facts = drift_core::RepoFacts {
            schema_version: drift_core::FACTS_SCHEMA_VERSION,
            files,
            ..drift_core::RepoFacts::default()
        };
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let followed = |dir: &str| -> Vec<String> {
            let f = common::file_at(&facts, &format!("app/api/{dir}/route.ts")).unwrap();
            answering(&cx, vec![&f.symbols[0]])
                .iter()
                .map(|s| s.name.clone())
                .collect()
        };
        assert_eq!(followed("caught"), ["GET", "readSession"]);
        assert_eq!(followed("plain"), ["GET", "work"]);
        // The calls of two are returned: either answers.
        assert_eq!(followed("both"), ["GET"]);
        // Only the callee whose call is returned (second review, S3).
        assert_eq!(followed("second"), ["GET", "work"]);
        assert_eq!(followed("fetch"), ["GET"]);
        assert_eq!(followed("bound"), ["GET"]);
    }

    /// A guard's own catch is not the handler's error mapping, and a client-side
    /// `onError` is no app error handler for a Next route.
    #[test]
    fn guards_and_client_handlers_are_not_error_mapping() {
        let d = empty();
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Errors, &cx);
        assert_eq!(
            key(&of(&all, "svc/sec/routes.py", "bearer")),
            "bubble:framework_default"
        );
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Errors, &cx);
        assert_eq!(
            key(&of(&all, "apps/open/app/api/thing/route.ts", "POST")),
            "bubble:framework_default"
        );
    }
}
