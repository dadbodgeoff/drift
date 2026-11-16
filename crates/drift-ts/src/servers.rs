//! Route adapters for HTTP servers the last measured build did not read: Elysia,
//! hapi, Restify and h3 (each in a module of its own).
//!
//! Their routes are in the listed reading only ([`drift_core::Listed`]): mining is
//! frozen, so a file that holds one is lowered once more as the measured build
//! listed it ([`unmeasured_listing`]), and this pass does not run then.
//!
//! Each adapter keys on its package and on the API that package documents: what
//! builds an application, which of its calls add a route, and which run something
//! before the handler. What runs there is read as any other guard position is
//! ([`Lowerer::guard_position`]): a function written in place is a symbol of its
//! own, a reference is read through its body. What an adapter cannot follow (a
//! plugin of another file that may add a hook, an option a macro may read) is
//! said, so the route is never said to have no guard; a registration it cannot list
//! at all is in the file's unlisted routes.

use super::*;

#[path = "elysia.rs"]
mod elysia;
#[path = "h3.rs"]
mod h3;
#[path = "hapi.rs"]
mod hapi;
#[path = "restify.rs"]
mod restify;

/// What runs before a route, gathered where it is registered: references read as
/// wraps, functions written in place (symbols of their own), the shapes of the calls
/// written there, and what could not be read (each as [`RawSymbol::app_unread`]
/// says it).
#[derive(Debug, Clone, Default)]
pub(super) struct Before {
    pub wraps: Vec<RawRef>,
    pub hooks: Vec<RawRef>,
    pub calls: Vec<RawGuardCall>,
    pub unread: Vec<String>,
}

fn push_unique<T: PartialEq>(v: &mut Vec<T>, x: T) {
    if !v.contains(&x) {
        v.push(x);
    }
}

impl Before {
    fn add(&mut self, other: &Before) {
        for w in &other.wraps {
            push_unique(&mut self.wraps, w.clone());
        }
        for h in &other.hooks {
            push_unique(&mut self.hooks, h.clone());
        }
        for c in &other.calls {
            push_unique(&mut self.calls, c.clone());
        }
        for u in &other.unread {
            push_unique(&mut self.unread, u.clone());
        }
    }

    fn unread(&mut self, how: impl Into<String>) {
        push_unique(&mut self.unread, how.into());
    }
}

/// A route found by one of these adapters, before it is pushed.
pub(super) struct ServerRoute<'b, 'a> {
    pub adapter: &'static str,
    /// The router it is registered on, as [`RawFile::route_routers`] names it; none
    /// for a route of a plugin function, which is served as its module is mounted.
    pub router: Option<String>,
    pub method: String,
    pub path: String,
    pub line: u32,
    pub before: Before,
    pub handler: Option<&'b Expression<'a>>,
    /// The request schemas the route is validated with (`body: t.Object(...)`,
    /// `validate: { payload }`): none named where written in place.
    pub schemas: Vec<Option<RawRef>>,
}

impl Lowerer<'_> {
    /// Lists the routes of the servers of these adapters in the file. Runs after
    /// every other adapter and the unlisted-routes reading, which it corrects for the
    /// lines it lists.
    pub(crate) fn lower_servers(&mut self, program: &Program) {
        if self.test_file {
            return;
        }
        let specs: BTreeSet<&str> = self.imports.values().map(|(s, _)| s.as_str()).collect();
        let elysia = specs.contains(elysia::PACKAGE);
        // A hapi plugin's file need not import hapi: its `register` is handed the
        // server, on which it adds routes.
        let hapi =
            hapi::PACKAGES.iter().any(|p| specs.contains(p)) || hapi::declares_plugin(program);
        let restify = specs.contains(restify::PACKAGE);
        let h3 = specs.contains(h3::PACKAGE);
        if !(elysia || hapi || restify || h3) || unmeasured_listing() {
            return;
        }
        let mut listed: Vec<u32> = Vec::new();
        let mut unlisted: Vec<u32> = Vec::new();
        if elysia {
            self.lower_elysia(program, &mut listed, &mut unlisted);
        }
        if hapi {
            self.lower_hapi(program, &mut listed, &mut unlisted);
        }
        if restify {
            self.lower_restify(program, &mut listed, &mut unlisted);
        }
        if h3 {
            self.lower_h3(program, &mut listed, &mut unlisted);
        }
        // A registration written as a route is (`x.get("/p", ...)`) that none of
        // them listed is said to be unlisted, whatever its handler looks like.
        let mut finder = VerbCalls {
            l: self,
            found: BTreeSet::new(),
        };
        finder.visit_program(program);
        let found = finder.found;
        let mut all: BTreeSet<u32> = self.out.unlisted_routes.iter().copied().collect();
        all.extend(found);
        all.extend(unlisted);
        // Not a line any adapter listed a route from.
        let routes: BTreeSet<&str> = self
            .out
            .entry_points
            .iter()
            .map(|e| e.symbol.as_str())
            .collect();
        for s in self
            .out
            .symbols
            .iter()
            .filter(|s| routes.contains(s.name.as_str()))
        {
            all.remove(&s.line);
        }
        for l in &listed {
            all.remove(l);
        }
        self.out.unlisted_routes = all.into_iter().collect();
    }

    /// Notes `name` as a router of the module ([`RawFile::routers`]).
    fn server_router(&mut self, name: &str) {
        if !self.out.routers.iter().any(|r| r == name) {
            self.out.routers.push(name.to_string());
            self.out.routers.sort();
        }
    }

    /// Reads `e`, written where something runs before the routes of `router` (`what`
    /// names the position, for a function written in place): each element of an
    /// array, a function written in place as a symbol of its own, and anything else
    /// as a guard position reads it.
    fn before_of(&mut self, router: &str, what: &str, e: &Expression, out: &mut Before) {
        match unwrap_expr(e) {
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    match el {
                        ArrayExpressionElement::SpreadElement(s) => {
                            out.unread(format!("guards spread from {}", spread_name(&s.argument)));
                        }
                        other => {
                            if let Some(x) = other.as_expression() {
                                self.before_of(router, what, x, out);
                            }
                        }
                    }
                }
            }
            f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                let r = self.in_place_function(router, what, f);
                push_unique(&mut out.hooks, r);
            }
            other => {
                let mut p = GuardPosition::default();
                self.guard_position(other, &mut p);
                for c in p.calls {
                    push_unique(&mut out.calls, c);
                }
                for u in p.unread {
                    out.unread(u);
                }
                if let Some(r) = self.middleware_ref(other) {
                    push_unique(&mut out.wraps, r);
                }
            }
        }
    }

    /// Pushes a route of one of these adapters, with its entry point.
    fn server_route(&mut self, r: ServerRoute, listed: &mut Vec<u32>) {
        let mut sym = RawSymbol::empty("", SymbolKind::Function, r.line);
        for w in &r.before.wraps {
            sym.wraps.push((w.clone(), WrapKind::Call));
        }
        sym.app_middleware.clone_from(&r.before.hooks);
        sym.guard_calls.clone_from(&r.before.calls);
        sym.app_unread.clone_from(&r.before.unread);
        self.handler_facts(r.handler, &mut sym);
        if !r.schemas.is_empty() {
            push_unique(&mut sym.controls, "validates".to_string());
            for s in r.schemas.into_iter().flatten() {
                push_unique(&mut sym.inputs, s);
            }
        }
        self.push_route(r.adapter, &r.method, &r.path, r.line, sym);
        // With no router, the route is served as its module is: the mounts of the
        // module say under what.
        if let Some(router) = &r.router {
            self.route_on(router);
        }
        push_unique(listed, r.line);
    }

    /// Records the mount of `target` on `parent` (a router of the module, or `""`)
    /// under `prefix`, with what runs before it there.
    fn server_mount(&mut self, parent: &str, prefix: &str, target: RawRef, before: &Before) {
        let mut hooks = before.hooks.clone();
        hooks.extend(before.unread.iter().map(|how| Self::unread_hook(how)));
        self.out.mounts.push(RawMount {
            prefix: prefix.to_string(),
            target,
            middleware: before.wraps.clone(),
            parent: parent.to_string(),
            tentative: false,
            hooks,
            passed: Vec::new(),
            calls: before.calls.clone(),
        });
    }
}

/// The HTTP verbs a registration of these servers is named for, lowercase.
const VERB_CALLS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "del", "head", "options", "opts", "all",
];

/// Finds the calls of a method named for an HTTP verb, on anything, given a path
/// written out first and a function written in place after it (itself, or handed
/// to a call: `defineEventHandler(() => ...)`), as a route is registered.
struct VerbCalls<'l, 's> {
    l: &'l Lowerer<'s>,
    found: BTreeSet<u32>,
}

impl<'a> Visit<'a> for VerbCalls<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && VERB_CALLS.contains(&m.property.name.as_str())
            && it.arguments.len() >= 2
            && it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(route_text)
                .is_some_and(|p| p.starts_with('/'))
            && it.arguments.iter().skip(1).any(|a| {
                a.as_expression().is_some_and(|x| match unwrap_expr(x) {
                    Expression::CallExpression(c) => c.arguments.iter().any(|a| {
                        a.as_expression()
                            .is_some_and(|y| !in_place_functions(y).is_empty())
                    }),
                    y => !in_place_functions(y).is_empty(),
                })
            })
        {
            self.found.insert(self.l.line_of(m.property.span.start));
        }
        walk::walk_call_expression(self, it);
    }
}

/// The text of a literal (a string, or a template with no placeholder).
pub(super) fn text_of(e: &Expression) -> Option<String> {
    string_value(e)
}

/// The function a callback is written as, with its first parameter's name and its
/// body: `(app) => app.get(...)`, `function (server) { ... }`.
pub(super) fn callback<'b, 'a>(
    e: &'b Expression<'a>,
) -> Option<(Option<String>, Callback<'b, 'a>)> {
    let first = |p: &FormalParameters| match p.items.first().map(|i| &i.pattern) {
        Some(BindingPattern::BindingIdentifier(id)) => Some(id.name.to_string()),
        _ => None,
    };
    match unwrap_expr(e) {
        Expression::ArrowFunctionExpression(f) => Some((
            first(&f.params),
            match &f.body {
                ArrowFunctionBody::FunctionBody(b) => Callback::Stmts(&b.statements),
                other => Callback::Expr(other.as_expression()?),
            },
        )),
        Expression::FunctionExpression(f) => Some((
            first(&f.params),
            Callback::Stmts(&f.body.as_ref()?.statements),
        )),
        _ => None,
    }
}

/// The body of a [`callback`].
pub(super) enum Callback<'b, 'a> {
    Expr(&'b Expression<'a>),
    Stmts(&'b [Statement<'a>]),
}

impl<'b, 'a> Callback<'b, 'a> {
    /// The expressions the body evaluates as statements of its own, or returns.
    pub(super) fn exprs(&self) -> Vec<&'b Expression<'a>> {
        match self {
            Callback::Expr(e) => vec![*e],
            Callback::Stmts(s) => s
                .iter()
                .filter_map(|st| match st {
                    Statement::ExpressionStatement(es) => Some(&es.expression),
                    Statement::ReturnStatement(r) => r.argument.as_ref(),
                    _ => None,
                })
                .collect(),
        }
    }
}

/// The package a reference is imported from, where it is a package's.
pub(super) fn package_of(r: &RawRef) -> Option<&str> {
    match &r.base {
        RawBase::Import { spec, .. } if bare_specifier(spec) => Some(spec.as_str()),
        _ => None,
    }
}
