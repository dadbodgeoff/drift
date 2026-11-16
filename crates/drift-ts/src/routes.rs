//! Route adapters: Express, Hono, Fastify and NestJS.
//!
//! Adapters describe *how code runs*: which declarations are HTTP routes and
//! which middleware, hooks or decorators run before them. They never decide
//! what a team's conventions are; mining does that.
//!
//! Every route becomes a symbol named `METHOD /path` (unique within its file),
//! whose wraps are its guards in order, plus an `http` entry point. Paths are
//! file-local here; the linker joins mount prefixes across files.

use super::*;

const NEST_HTTP: &[(&str, &str)] = &[
    ("Get", "GET"),
    ("Post", "POST"),
    ("Put", "PUT"),
    ("Patch", "PATCH"),
    ("Delete", "DELETE"),
    ("Options", "OPTIONS"),
    ("Head", "HEAD"),
    ("All", "ALL"),
];
/// Key of a router created in an `export default` expression (no local binding can
/// be named `default`).
pub(super) const DEFAULT_ROUTER: &str = "default";
/// What an inline Fastify route schema is validated by: (package, export).
pub(crate) const FASTIFY_SCHEMA: (&str, &str) = ("fastify", "schema");
/// Fastify route hooks that run before the handler.
pub(super) const FASTIFY_HOOKS: &[&str] =
    &["onRequest", "preParsing", "preValidation", "preHandler"];

/// A Hono `createRoute({...})` config.
#[derive(Debug, Clone, Default)]
pub(super) struct RouteConfig {
    method: String,
    path: String,
    middleware: Vec<RawRef>,
    /// What the middleware holds for the readings that list
    /// ([`Lowerer::guard_position`]).
    calls: Vec<RawGuardCall>,
    unread: Vec<String>,
}

/// Join path segments into `/a/b/:c`, collapsing duplicate slashes.
pub(crate) fn join_path(parts: &[&str]) -> String {
    let segs: Vec<&str> = parts
        .iter()
        .flat_map(|p| p.split('/'))
        .filter(|s| !s.is_empty())
        .collect();
    format!("/{}", segs.join("/"))
}

fn string_value(e: &Expression) -> Option<String> {
    match unwrap_expr(e) {
        Expression::StringLiteral(l) => Some(lit(l)),
        Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
            t.quasis.first().map(|q| q.value.raw.to_string())
        }
        _ => None,
    }
}

pub(super) fn object_prop<'b, 'a>(
    o: &'b ObjectExpression<'a>,
    key: &str,
) -> Option<&'b Expression<'a>> {
    o.properties.iter().find_map(|p| match p {
        ObjectPropertyKind::ObjectProperty(p)
            if !p.computed && p.key.static_name().is_some_and(|k| k.as_str() == Some(key)) =>
        {
            Some(&p.value)
        }
        _ => None,
    })
}

/// Call arguments as expressions, with spreads (`...protectedMiddleware`) unwrapped.
fn arg_exprs<'b, 'a>(args: &'b oxc_allocator::Vec<'a, Argument<'a>>) -> Vec<&'b Expression<'a>> {
    args.iter()
        .filter_map(|a| match a {
            Argument::SpreadElement(s) => Some(&s.argument),
            other => other.as_expression(),
        })
        .collect()
}

impl Lowerer<'_> {
    /// What a Fastify route's `schema` option validates request input with
    /// (`schema: { body, querystring, params, headers }`): each schema's canonical name
    /// (`CreateBody`, `z.object()`), or `pkg:fastify#schema.<part>` for an inline JSON
    /// schema.
    pub(super) fn fastify_schema_inputs(&self, o: &ObjectExpression, out: &mut Vec<RawRef>) {
        let Some(Expression::ObjectExpression(schema)) = object_prop(o, "schema").map(unwrap_expr)
        else {
            return;
        };
        for part in ["body", "querystring", "query", "params", "headers"] {
            let Some(v) = object_prop(schema, part) else {
                continue;
            };
            let named = match unwrap_expr(v) {
                Expression::ObjectExpression(_) => None,
                x => self
                    .canon(x)
                    .filter(|r| !matches!(r.base, RawBase::Global(_))),
            };
            out.push(named.unwrap_or_else(|| RawRef {
                base: RawBase::Import {
                    spec: FASTIFY_SCHEMA.0.into(),
                    name: FASTIFY_SCHEMA.1.into(),
                },
                member: format!(".{part}"),
            }));
        }
    }

    /// The guard classes a Nest `@UseGuards(A, B)` decorator names, as
    /// [`RawSymbol::decorator_args`] entries (`UseGuards`, guard).
    pub(super) fn use_guards(&self, decorators: &[Decorator]) -> Vec<(RawOperand, RawRef)> {
        let mut out = Vec::new();
        for d in decorators {
            let Expression::CallExpression(c) = unwrap_expr(&d.expression) else {
                continue;
            };
            let Some(r) = self.canon_callee(&c.callee) else {
                continue;
            };
            if !matches!(&r.base, RawBase::Import { spec, name } if spec == "@nestjs/common" && name == "UseGuards")
                || !r.member.is_empty()
            {
                continue;
            }
            for a in arg_exprs(&c.arguments) {
                // `@UseGuards(AuthGuard("jwt"))`: the factory's callee.
                let g = match unwrap_expr(a) {
                    Expression::CallExpression(f) => self.canon_callee(&f.callee),
                    Expression::NewExpression(n) => self.canon(&n.callee),
                    x => self.canon(x),
                };
                if let Some(g) = g {
                    out.push((RawOperand::Ref(r.clone()), g));
                }
            }
        }
        out
    }

    /// What a Nest `@UseGuards(...)` holds for the readings that list, beside the
    /// classes [`Lowerer::use_guards`] names: the shape of a guard built by a call
    /// (`AuthGuard(["jwt", "anonymous"])`), and each argument that names no class
    /// (a conditional, a computed member), which may be the guard.
    pub(super) fn use_guards_position(&self, decorators: &[Decorator], sym: &mut RawSymbol) {
        for d in decorators {
            let Expression::CallExpression(c) = unwrap_expr(&d.expression) else {
                continue;
            };
            if !self.canon_callee(&c.callee).is_some_and(|r| {
                matches!(&r.base, RawBase::Import { spec, name } if spec == "@nestjs/common" && name == "UseGuards")
                    && r.member.is_empty()
            }) {
                continue;
            }
            for a in &c.arguments {
                let named = match a.as_expression().map(unwrap_expr) {
                    Some(Expression::CallExpression(f)) => {
                        if let Some(call) = self.call_shape(f, 0)
                            && !sym.guard_calls.contains(&call)
                        {
                            sym.guard_calls.push(call);
                        }
                        self.canon_callee(&f.callee).is_some()
                    }
                    Some(Expression::NewExpression(n)) => self.canon(&n.callee).is_some(),
                    Some(x) => self.canon(x).is_some(),
                    None => false,
                };
                let how = "a guard given to UseGuards that is not read".to_string();
                if !named && !sym.app_unread.contains(&how) {
                    sym.app_unread.push(how);
                }
            }
        }
    }

    /// `express()`, `express.Router()`, `Router()`, `fastify()`, `new Hono()`, `new OpenAPIHono()`.
    pub(super) fn router_adapter_of(&self, init: &Expression) -> Option<&'static str> {
        // `new Hono().basePath("/api")` is the router it is called on.
        if let Expression::CallExpression(c) = unwrap_expr(init)
            && let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee)
            && m.property.name == "basePath"
            && !unmeasured_listing()
        {
            return self.router_adapter_of(&m.object).filter(|a| *a == "hono");
        }
        let (callee, is_new) = match unwrap_expr(init) {
            Expression::CallExpression(c) => (&c.callee, false),
            Expression::NewExpression(n) => (&n.callee, true),
            _ => return None,
        };
        let r = self.canon(callee)?;
        let RawBase::Import { spec, name } = &r.base else {
            return None;
        };
        let m = r.member.as_str();
        match (spec.as_str(), name.as_str(), m, is_new) {
            ("express", "default", "" | ".Router", false) | ("express", "Router", "", _) => {
                Some("express")
            }
            ("fastify", "default" | "fastify" | "Fastify", "", false) => Some("fastify"),
            ("hono", "Hono", "", true) | ("@hono/zod-openapi", "OpenAPIHono", "", true) => {
                Some("hono")
            }
            // `new Router()` of `@koa/router`: its routes are listed since the
            // measured build, and what a Koa middleware does is not read.
            ("@koa/router" | "koa-router", "default", "", true) if !unmeasured_listing() => {
                Some("koa")
            }
            _ => None,
        }
    }

    /// `createRoute({ method, path, middleware })` from `@hono/zod-openapi`.
    pub(super) fn route_config(&self, e: &Expression) -> Option<RouteConfig> {
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return None;
        };
        let r = self.canon(&c.callee)?;
        if !matches!(&r.base, RawBase::Import { spec, name } if spec == "@hono/zod-openapi" && name == "createRoute")
        {
            return None;
        }
        let Expression::ObjectExpression(o) = unwrap_expr(c.arguments.first()?.as_expression()?)
        else {
            return None;
        };
        let method = object_prop(o, "method")
            .and_then(string_value)
            .unwrap_or_else(|| "?".into());
        let path = object_prop(o, "path")
            .and_then(route_text)
            .unwrap_or_else(|| "?".into());
        let mut middleware = Vec::new();
        let mut position = GuardPosition::default();
        if let Some(mw) = object_prop(o, "middleware") {
            self.collect_middleware(mw, &mut middleware);
            self.guard_position(mw, &mut position);
        }
        Some(RouteConfig {
            method: method.to_ascii_uppercase(),
            path,
            middleware,
            calls: position.calls,
            unread: position.unread,
        })
    }

    /// A middleware value: a call (`auth("x")` -> `auth`), a reference, or an array of them.
    fn collect_middleware(&self, e: &Expression, out: &mut Vec<RawRef>) {
        match unwrap_expr(e) {
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    if let Some(x) = el.as_expression() {
                        self.collect_middleware(x, out);
                    }
                }
            }
            // Inline hook: `(req, res, done) => { verifyAuth([..])(req, res, () => verifyAdmin(req, res, done)) }`.
            Expression::ArrowFunctionExpression(f) => self.arrow_guards(&f.body, out, 0),
            Expression::FunctionExpression(f) => {
                if let Some(b) = &f.body {
                    self.inline_guards(&b.statements, out, 0);
                }
            }
            other => {
                if let Some(r) = self.middleware_ref(other) {
                    out.push(r);
                }
            }
        }
    }

    /// Guards called at the top level of an inline hook body, in order. Curried
    /// guards (`verifyAuth(modes)(req, res, next)`) count by their factory, and
    /// callbacks passed to them (the `next` continuation) are followed.
    fn arrow_guards(&self, body: &ArrowFunctionBody, out: &mut Vec<RawRef>, depth: usize) {
        match body {
            ArrowFunctionBody::FunctionBody(b) => self.inline_guards(&b.statements, out, depth),
            other => {
                if let Some(e) = other.as_expression() {
                    self.inline_guard_call(e, out, depth);
                }
            }
        }
    }

    fn inline_guards(&self, stmts: &[Statement], out: &mut Vec<RawRef>, depth: usize) {
        for st in stmts {
            let e = match st {
                Statement::ExpressionStatement(e) => &e.expression,
                Statement::ReturnStatement(r) => match &r.argument {
                    Some(a) => a,
                    None => continue,
                },
                _ => continue,
            };
            self.inline_guard_call(e, out, depth);
        }
    }

    fn inline_guard_call(&self, e: &Expression, out: &mut Vec<RawRef>, depth: usize) {
        if depth > 3 {
            return;
        }
        {
            let e = match unwrap_expr(e) {
                Expression::AwaitExpression(a) => &a.argument,
                other => other,
            };
            let Expression::CallExpression(c) = unwrap_expr(e) else {
                return;
            };
            let guard = match unwrap_expr(&c.callee) {
                Expression::CallExpression(inner) => self.canon(&inner.callee),
                callee => self.canon(callee),
            };
            if let Some(r) = guard {
                out.push(r);
            }
            for a in &c.arguments {
                match a.as_expression().map(unwrap_expr) {
                    Some(Expression::ArrowFunctionExpression(f)) => {
                        self.arrow_guards(&f.body, out, depth + 1);
                    }
                    Some(Expression::FunctionExpression(f)) => {
                        if let Some(b) = &f.body {
                            self.inline_guards(&b.statements, out, depth + 1);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    /// A function written where a middleware or a hook of the router `receiver` goes,
    /// as a symbol of its own named for where it is (`app onRequest 9`), listed only
    /// ([`RawSymbol::in_place`]): the reference to it.
    fn in_place_function(&mut self, receiver: &str, what: &str, f: &Expression) -> RawRef {
        let at = self.line_of(f.span().start);
        let mut name = format!("{receiver} {what} {at}");
        let mut n = 2;
        while self.out.symbols.iter().any(|s| s.name == name) {
            name = format!("{receiver} {what} {at} #{n}");
            n += 1;
        }
        let mut sym = RawSymbol::empty(&name, SymbolKind::Function, at);
        sym.in_place = true;
        sym.is_async = match f {
            Expression::ArrowFunctionExpression(a) => a.r#async,
            Expression::FunctionExpression(a) => a.r#async,
            _ => false,
        };
        self.handler_facts(Some(f), &mut sym);
        self.push_symbol(sym);
        RawRef {
            base: RawBase::Local(name),
            member: String::new(),
        }
    }

    /// Records what `e`, given where a middleware or a hook of the router `receiver`
    /// goes, runs before its routes ([`RawSymbol::app_middleware`]): a reference, the
    /// callee of a call that builds one (`bearerAuth({ token })`), each element of an
    /// array, and a function written in place, which becomes a symbol of its own
    /// named for where it is (`app onRequest 9`). `pattern`: the path it is given for.
    fn note_hook(&mut self, receiver: &str, pattern: &str, what: &str, e: &Expression) {
        let hook = match unwrap_expr(e) {
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    if let Some(x) = el.as_expression() {
                        self.note_hook(receiver, pattern, what, x);
                    }
                }
                return;
            }
            f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                self.in_place_function(receiver, what, f)
            }
            other => {
                let p = self.router_position(receiver, pattern, other);
                match self.guard_ref(other) {
                    Some(r) => r,
                    // No name: it may be the guard of the routes behind it.
                    None => match p.unread.first() {
                        Some(how) => Self::unread_hook(how),
                        None => return,
                    },
                }
            }
        };
        let hooks = self.hooks.entry(receiver.to_string()).or_default();
        let entry = (pattern.to_string(), hook);
        if !hooks.contains(&entry) {
            hooks.push(entry);
        }
    }

    /// What the parent `receiver` runs before a router mounted at `prefix` and is
    /// no wrap ([`RawMount::hooks`]): what it was given for a path that covers the
    /// mount, and a middleware written in place, so far; for a path that may take
    /// some of its routes, a hook that may run ([`covers_mount`]). Not `target`, the
    /// router itself.
    fn mount_hooks(&self, receiver: &str, prefix: &str, target: &RawRef) -> Vec<RawRef> {
        let mut out: Vec<RawRef> = Vec::new();
        for (pattern, hook) in self.hooks.get(receiver).into_iter().flatten() {
            if hook == target {
                continue;
            }
            let hook = match covers_mount(pattern, prefix) {
                Some(true) => hook.clone(),
                // Whether the path it is given for takes the mount is not read: it
                // may run for the routes behind it.
                None => Self::unread_hook(&format!(
                    "a middleware given for {pattern}, which may cover the route"
                )),
                Some(false) => continue,
            };
            if !out.contains(&hook) {
                out.push(hook);
            }
        }
        out
    }

    /// What the router `receiver` is given where a handler goes, when it is what a
    /// call of a package hands back, written in place or bound to a `const` of the
    /// module ([`RawFile::handed_calls`]). `before`: what is given with it and runs
    /// first.
    fn note_handed_call(
        &mut self,
        receiver: &str,
        prefix: &str,
        before: &[&Expression],
        last: &Expression,
    ) {
        let target = match unwrap_expr(last) {
            Expression::CallExpression(c) => self.canon(&c.callee),
            Expression::Identifier(id) => self.module_calls.get(id.name.as_str()).cloned(),
            _ => None,
        };
        let Some(target) = target.filter(|t| matches!(t.base, RawBase::Import { .. })) else {
            return;
        };
        if self.scope != 0 && !self.closure_routers.contains(receiver) {
            return;
        }
        let mut middleware = self.express.get(receiver).cloned().unwrap_or_default();
        for x in before {
            self.collect_middleware(x, &mut middleware);
        }
        // What the router was given so far: for every route, and for a path, which
        // linking holds against each route the call serves.
        let mut hooks: Vec<RawRef> = Vec::new();
        let mut pathed: Vec<(String, RawRef)> = Vec::new();
        for (pattern, hook) in self.hooks.get(receiver).into_iter().flatten() {
            if *hook == target {
                continue;
            }
            match covers_mount(pattern, prefix) {
                Some(true) if !hooks.contains(hook) => hooks.push(hook.clone()),
                None => pathed.push((pattern.clone(), hook.clone())),
                _ => {}
            }
        }
        let mut calls = self.calls_covering(receiver, prefix);
        let mut given = GuardPosition::default();
        for x in before {
            self.guard_position(x, &mut given);
        }
        calls.extend(given.calls);
        hooks.extend(given.unread.iter().map(|how| Self::unread_hook(how)));
        hooks.extend(given.members.into_iter().map(|(_, member)| member));
        // What has no name where it was given may be the guard of what follows.
        for how in self.scope_unread.get(receiver).into_iter().flatten() {
            hooks.push(Self::unread_hook(how));
        }
        self.out.handed_calls.push((
            RawMount {
                prefix: prefix.to_string(),
                target,
                middleware,
                parent: receiver.to_string(),
                tentative: false,
                hooks,
                passed: self.passed.get(receiver).cloned().unwrap_or_default(),
                calls,
            },
            pathed,
        ));
    }

    /// A statement that hands a router of the module to a call (`setupAuth(app)`,
    /// `protect(admin, opts)`): what the call registers on it runs before the
    /// routes and the mounts that follow ([`RawSymbol::app_passed`]).
    pub(super) fn note_app_passed(&mut self, e: &Expression) {
        let e = match unwrap_expr(e) {
            Expression::AwaitExpression(a) => unwrap_expr(&a.argument),
            e => e,
        };
        let Expression::CallExpression(c) = e else {
            return;
        };
        // A method of a router is a registration, read where it is.
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee)
            && matches!(unwrap_expr(&m.object), Expression::Identifier(id) if self.express.contains_key(id.name.as_str()))
        {
            return;
        }
        let Some(callee) = self.canon_callee(&c.callee) else {
            return;
        };
        for (i, a) in c.arguments.iter().enumerate() {
            if let Some(Expression::Identifier(id)) = a.as_expression().map(unwrap_expr)
                && self.express.contains_key(id.name.as_str())
            {
                let entry = (callee.clone(), u32::try_from(i).unwrap_or(u32::MAX));
                let list = self.passed.entry(id.name.to_string()).or_default();
                if !list.contains(&entry) {
                    list.push(entry);
                }
            }
        }
    }

    pub(super) fn middleware_ref(&self, e: &Expression) -> Option<RawRef> {
        match unwrap_expr(e) {
            Expression::CallExpression(c) => self.canon(&c.callee),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => None,
            other => self.canon(other),
        }
    }

    /// The member `name` of a Fastify instance (`app.authenticate`,
    /// `fastify.auth`), whatever the instance is called: a decorator, the
    /// repository's or a plugin's ([`drift_core::guard_lists::FASTIFY_MEMBER`]).
    fn fastify_member(&self, e: &Expression) -> Option<RawRef> {
        let Expression::StaticMemberExpression(m) = unwrap_expr(e) else {
            return None;
        };
        let Expression::Identifier(id) = unwrap_expr(&m.object) else {
            return None;
        };
        let name = id.name.as_str();
        (self.express.contains_key(name) && self.router_adapter.get(name) == Some(&"fastify")).then(
            || RawRef {
                base: RawBase::Global("fastify".to_string()),
                member: format!(".{}", m.property.name),
            },
        )
    }

    /// What a value standing where a guard goes is named by, for the readings that
    /// list: a member of a Fastify instance as such ([`Lowerer::fastify_member`]),
    /// anything else as [`Lowerer::middleware_ref`] names it.
    pub(super) fn guard_ref(&self, e: &Expression) -> Option<RawRef> {
        let named = match unwrap_expr(e) {
            Expression::CallExpression(c) => &c.callee,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                return None;
            }
            other => other,
        };
        self.fastify_member(named)
            .or_else(|| self.middleware_ref(e))
    }

    /// One argument of a call at a guard position, as far as it is written there.
    pub(super) fn arg_shape(&self, e: &Expression, depth: usize) -> RawArg {
        use drift_core::GuardCall;
        if depth > GuardCall::MAX_DEPTH {
            return RawArg::Unread;
        }
        match unwrap_expr(e) {
            lit @ (Expression::StringLiteral(_) | Expression::TemplateLiteral(_))
                if string_value(lit).is_some() =>
            {
                RawArg::Text(string_value(lit).unwrap_or_default())
            }
            Expression::BooleanLiteral(b) => RawArg::Bool(b.value),
            Expression::NumericLiteral(n) => RawArg::Number(n.value.to_string()),
            Expression::NullLiteral(_) => RawArg::Null,
            Expression::Identifier(id) if id.name == "undefined" => RawArg::Null,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                RawArg::Function
            }
            Expression::ArrayExpression(a) => {
                let mut out: Vec<RawArg> = Vec::new();
                for el in &a.elements {
                    if out.len() == GuardCall::MAX_ITEMS {
                        out.push(RawArg::Unread);
                        break;
                    }
                    out.push(match el {
                        ArrayExpressionElement::SpreadElement(_) => RawArg::Spread,
                        other => other
                            .as_expression()
                            .map_or(RawArg::Unread, |x| self.arg_shape(x, depth + 1)),
                    });
                }
                RawArg::List(out)
            }
            Expression::ObjectExpression(o) => {
                let mut out: Vec<(String, RawArg)> = Vec::new();
                for p in &o.properties {
                    if out.len() == GuardCall::MAX_ITEMS {
                        out.push(("...".to_string(), RawArg::Unread));
                        break;
                    }
                    out.push(match p {
                        ObjectPropertyKind::SpreadProperty(_) => {
                            ("...".to_string(), RawArg::Spread)
                        }
                        ObjectPropertyKind::ObjectProperty(p) => match p
                            .key
                            .static_name()
                            .and_then(|n| n.as_str().map(String::from))
                        {
                            Some(k) if !p.computed => (k, self.arg_shape(&p.value, depth + 1)),
                            // A computed key: which option it sets is not read.
                            _ => ("...".to_string(), RawArg::Unread),
                        },
                    });
                }
                RawArg::Object(out)
            }
            Expression::CallExpression(c) => match self.call_shape(c, depth + 1) {
                Some(call) => RawArg::Call(call),
                None => RawArg::Unread,
            },
            other => match self.fastify_member(other).or_else(|| self.canon(other)) {
                Some(r) => RawArg::Ref(r),
                None => RawArg::Unread,
            },
        }
    }

    /// The shape of a call ([`RawGuardCall`]): its callee as a wrap of it is named,
    /// and the arguments of each call of the chain (`expressjwt({ ... }).unless({
    /// ... })`, `verify(modes)(req, res, next)`), innermost first. None where the
    /// callee has no name.
    pub(super) fn call_shape(&self, c: &CallExpression, depth: usize) -> Option<RawGuardCall> {
        let callee = self
            .fastify_member(&c.callee)
            .or_else(|| self.canon(&c.callee))?;
        let mut args: Vec<Vec<RawArg>> = Vec::new();
        self.chain_args(c, depth, &mut args);
        Some(RawGuardCall { callee, args })
    }

    fn chain_args(&self, c: &CallExpression, depth: usize, out: &mut Vec<Vec<RawArg>>) {
        // The calls the callee is read off, first.
        let mut inner = unwrap_expr(&c.callee);
        loop {
            match inner {
                Expression::StaticMemberExpression(m) => inner = unwrap_expr(&m.object),
                Expression::CallExpression(i) => {
                    if out.len() < drift_core::GuardCall::MAX_DEPTH {
                        self.chain_args(i, depth, out);
                    }
                    break;
                }
                _ => break,
            }
        }
        out.push(
            c.arguments
                .iter()
                .take(drift_core::GuardCall::MAX_ITEMS)
                .map(|a| match a {
                    Argument::SpreadElement(_) => RawArg::Spread,
                    other => other
                        .as_expression()
                        .map_or(RawArg::Unread, |x| self.arg_shape(x, depth)),
                })
                .collect(),
        );
    }

    /// Gives a route what `e`, written at one of its guard positions, holds for the
    /// readings that list ([`Lowerer::guard_position`]): the calls on the route
    /// itself, what has no name among what is not read (`unread`), and a member
    /// of a Fastify instance as a hook beside the route, in place of the wrap the
    /// measured reading names it by.
    fn route_position(&self, e: &Expression, sym: &mut RawSymbol, unread: &mut Vec<String>) {
        let mut p = GuardPosition::default();
        self.guard_position(e, &mut p);
        for u in p.unread {
            if !unread.contains(&u) {
                unread.push(u);
            }
        }
        for c in p.calls {
            if !sym.guard_calls.contains(&c) {
                sym.guard_calls.push(c);
            }
        }
        for (measured, member) in p.members {
            if let Some(m) = measured
                && !sym.listed_unwraps.contains(&m)
            {
                sym.listed_unwraps.push(m);
            }
            if !sym.app_middleware.contains(&member) {
                sym.app_middleware.push(member);
            }
        }
    }

    /// What the router `receiver` was given for a path that takes the route at `path`
    /// runs before it ([`RawSymbol::app_middleware`]); what was given for a path not
    /// read to take it may ([`covers`]), and is unread.
    fn hooks_covering(&self, receiver: &str, path: &str, sym: &mut RawSymbol) {
        for (pattern, hook) in self.hooks.get(receiver).into_iter().flatten() {
            match covers(pattern, path) {
                Some(true) => {
                    if !sym.app_middleware.contains(hook) {
                        sym.app_middleware.push(hook.clone());
                    }
                }
                // Whether the path it is given for takes the route is not read: it
                // may run for it.
                None => {
                    let how =
                        format!("a middleware given for {pattern}, which may cover the route");
                    if !sym.app_unread.contains(&how) {
                        sym.app_unread.push(how);
                    }
                }
                Some(false) => {}
            }
        }
    }

    /// The calls written on the router `receiver` where a guard of the route or the
    /// mount at `path` goes ([`Lowerer::position_calls`]). Not one given for a path
    /// that is not read to take `path`: what it is given for is a hook that may run
    /// ([`covers`]), never a call that does.
    fn calls_covering(&self, receiver: &str, path: &str) -> Vec<RawGuardCall> {
        let mut out: Vec<RawGuardCall> = Vec::new();
        for (pattern, call) in self.position_calls.get(receiver).into_iter().flatten() {
            if covers(pattern, path) == Some(true) && !out.contains(call) {
                out.push(call.clone());
            }
        }
        out
    }

    /// Notes the instances a function builds and the members it reads off them
    /// ([`Lowerer::local_refs`]), from the `const` declarations at the top of its
    /// body, in the order written: a guard given through one is read by its class.
    /// What was noted before, for the caller to put back. The last measured build
    /// read none: as it listed, nothing is noted.
    fn enter_local_refs(&mut self, body: &[Statement]) -> HashMap<SymbolId, RawRef> {
        let outer = self.local_refs.clone();
        let mut noted = false;
        for st in body {
            let Statement::VariableDeclaration(v) = st else {
                continue;
            };
            if !v.kind.is_const() {
                continue;
            }
            for d in &v.declarations {
                let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) else {
                    continue;
                };
                let Some(sym) = id.symbol_id.get() else {
                    continue;
                };
                let made = match unwrap_expr(init) {
                    Expression::NewExpression(n) => self.canon(&n.callee),
                    Expression::StaticMemberExpression(m) => match unwrap_expr(&m.object) {
                        Expression::Identifier(of) if self.resolve_ident(of).is_none() => {
                            self.canon(init)
                        }
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(r) = made {
                    self.local_refs.insert(sym, r);
                    noted = true;
                }
            }
        }
        if noted && unmeasured_listing() {
            self.local_refs.clone_from(&outer);
        }
        outer
    }

    /// Records what `e`, registered on the router `receiver` for `pattern` (`""`:
    /// every route), holds for the readings that list: its calls
    /// ([`Lowerer::position_calls`]), and what has no name, returned as
    /// [`RawSymbol::app_unread`] says it.
    fn router_position(&mut self, receiver: &str, pattern: &str, e: &Expression) -> GuardPosition {
        let mut p = GuardPosition::default();
        self.guard_position(e, &mut p);
        let list = self.position_calls.entry(receiver.to_string()).or_default();
        for c in &p.calls {
            let entry = (pattern.to_string(), c.clone());
            if !list.contains(&entry) {
                list.push(entry);
            }
        }
        p
    }

    /// What stands for a value with no name where a hook goes
    /// ([`RawSymbol::app_middleware`]): a reference to nothing Drift reads, so the
    /// routes behind it are never said to have no guard.
    fn unread_hook(how: &str) -> RawRef {
        RawRef {
            base: RawBase::Global(how.to_string()),
            member: String::new(),
        }
    }

    /// What `e`, written where a guard goes, holds for the readings that list
    /// ([`GuardPosition`]): the calls and their shapes, and what could not be named
    /// at all, which may be the guard. Every position reads its values through
    /// this, so a value that is not recognised is never dropped.
    pub(super) fn guard_position(&self, e: &Expression, out: &mut GuardPosition) {
        match unwrap_expr(e) {
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    match el {
                        ArrayExpressionElement::SpreadElement(s) => out
                            .unread
                            .push(format!("guards spread from {}", spread_name(&s.argument))),
                        other => {
                            if let Some(x) = other.as_expression() {
                                self.guard_position(x, out);
                            }
                        }
                    }
                }
            }
            // Read where it is written, as a function of its own.
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {}
            Expression::CallExpression(c) => match self.call_shape(c, 0) {
                Some(call) => {
                    if let (Some(member), measured) =
                        (self.fastify_member(&c.callee), self.canon(&c.callee))
                    {
                        out.members.push((measured, member));
                    }
                    out.calls.push(call);
                }
                None => out.unread.push(match unwrap_expr(&c.callee) {
                    Expression::Identifier(id) => format!("a middleware built by {}", id.name),
                    _ => "a guard built by a call that is not read".to_string(),
                }),
            },
            other => match (self.fastify_member(other), self.canon(other)) {
                (Some(member), measured) => out.members.push((measured, member)),
                (None, Some(_)) => {}
                (None, None) => out.unread.push(match other {
                    Expression::Identifier(id) => {
                        format!("a middleware handed in as {}", id.name)
                    }
                    Expression::ConditionalExpression(_) => {
                        "a guard chosen by a condition".to_string()
                    }
                    Expression::LogicalExpression(_) => {
                        "a guard given under a condition".to_string()
                    }
                    Expression::ComputedMemberExpression(_) => {
                        "a guard read by a computed key".to_string()
                    }
                    Expression::StaticMemberExpression(m) => {
                        format!(
                            "a guard read off a value that is not read (.{})",
                            m.property.name
                        )
                    }
                    _ => "a guard that is not read where it is given".to_string(),
                }),
            },
        }
    }

    fn unique_route_name(&self, method: &str, path: &str) -> String {
        let mut name = format!("{method} {path}");
        let mut n = 2;
        while self.out.symbols.iter().any(|s| s.name == name) {
            name = format!("{method} {path} #{n}");
            n += 1;
        }
        name
    }

    /// Push a route symbol and its entry point.
    fn push_route(
        &mut self,
        adapter: &str,
        method: &str,
        path: &str,
        line: u32,
        mut sym: RawSymbol,
    ) {
        // A route of a router a function builds or is handed: listed for the
        // practice map and `drift security` only ([`RawSymbol::in_place`]), under the
        // prefix the plugin it is in was registered with.
        let scoped;
        let path = if self.scope > 0 {
            sym.in_place = true;
            let mut parts: Vec<&str> = self.scope_prefix.iter().map(String::as_str).collect();
            parts.push(path);
            scoped = join_path(&parts);
            scoped.as_str()
        } else {
            path
        };
        let name = self.unique_route_name(method, path);
        sym.name = name.clone();
        sym.kind = SymbolKind::Function;
        sym.line = line;
        self.push_symbol(sym);
        self.out.entry_points.push(drift_core::EntryPoint {
            symbol: name,
            kind: "http".into(),
            method: Some(method.to_string()),
            route: Some(path.to_string()),
            adapter: adapter.into(),
        });
    }

    /// Records the router the route just pushed is registered on.
    fn route_on(&mut self, router: &str) {
        if let Some(e) = self.out.entry_points.last() {
            if self.scope > 0 && self.closure_routers.contains(router) {
                // The module's own router, registered on from inside a function:
                // the route is mounted as the router is.
                self.scope_routes
                    .push((e.symbol.clone(), router.to_string()));
                self.out
                    .route_routers
                    .push((e.symbol.clone(), router.to_string()));
            } else if self.scope > 0 {
                // Not a binding of the module: the route is served as its module is.
                self.scope_routes
                    .push((e.symbol.clone(), router.to_string()));
                self.out
                    .route_routers
                    .push((e.symbol.clone(), format!("{router}@{}", self.scope_seq)));
            } else {
                self.out
                    .route_routers
                    .push((e.symbol.clone(), router.to_string()));
            }
        }
    }

    /// Lower the routers a function builds or is handed, as the module's own are:
    /// the instance a Fastify plugin is given (`async function routes(instance:
    /// FastifyInstance)`, a function written in `app.register(...)`), the router an
    /// Express factory builds (`function makeRouter(guard) { const router =
    /// Router(); ... }`) and the application a helper is handed (`setupAuth(app:
    /// Express)`). Their routes are listed, with the hooks and middleware the
    /// function registers before them; a guard the function is handed is not read
    /// ([`RawSymbol::app_unread`]). `first`: the first parameter is an instance of
    /// this adapter whatever its type; `shared`: the function is declared wrapped
    /// by `fastify-plugin` ([`RawRegisters::shared`]); `parent`: the instance the
    /// plugin is registered on, and whether through `fastify-plugin`, which makes
    /// the plugin's hooks its parent's.
    pub(super) fn scoped_fn(
        &mut self,
        name: Option<&str>,
        params: &FormalParameters,
        body: &FunctionBody,
        (first, shared): (Option<&'static str>, bool),
        parent: Option<(&str, bool)>,
        prefix: Option<String>,
    ) {
        let mut routers: Vec<(String, &'static str, Option<u32>)> = Vec::new();
        for (i, p) in params.items.iter().enumerate() {
            let BindingPattern::BindingIdentifier(id) = &p.pattern else {
                continue;
            };
            let by_name = |name: &str| match name {
                "Express" | "Application" | "Router" | "IRouter" => Some("express"),
                n if n.starts_with("Fastify") => Some("fastify"),
                "Hono" | "OpenAPIHono" => Some("hono"),
                _ => None,
            };
            let typed = match p.type_annotation.as_ref().map(|t| &t.type_annotation) {
                Some(TSType::TSTypeReference(r)) => match &r.type_name {
                    TSTypeName::IdentifierReference(t) => by_name(t.name.as_str()),
                    // `app: express.Express`, `f: fastify.FastifyInstance`: the type
                    // through its namespace, which the measured build did not read.
                    TSTypeName::QualifiedName(q) => {
                        by_name(q.right.name.as_str()).filter(|_| !unmeasured_listing())
                    }
                    _ => None,
                },
                None if matches!(id.name.as_str(), "fastify" | "instance") => Some("fastify"),
                _ => None,
            };
            // A parameter a call in the file hands a router is one, whatever its
            // type says (`app: ReturnType<typeof express>`, no type at all): the
            // measured build read the type only.
            let handed = || {
                let adapter = *self
                    .handed_routers
                    .get(name?)?
                    .get(&u32::try_from(i).ok()?)?;
                (!unmeasured_listing()).then_some(adapter)
            };
            let adapter = match (i, first) {
                (0, Some(a)) => Some(a),
                _ => typed.or_else(handed),
            };
            if let Some(a) = adapter {
                routers.push((id.name.to_string(), a, u32::try_from(i).ok()));
            }
        }
        for st in &body.statements {
            if let Statement::VariableDeclaration(v) = st {
                for d in &v.declarations {
                    if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init)
                        && let Some(a) = self.router_adapter_of(init)
                    {
                        routers.push((id.name.to_string(), a, None));
                    }
                }
            }
        }
        if routers.is_empty() {
            return;
        }
        if let Some(function) = name
            && routers.iter().any(|(_, _, at)| at.is_none())
            && !self.out.router_factories.iter().any(|f| f == function)
        {
            self.out.router_factories.push(function.to_string());
        }
        // The route options the function binds are its own.
        let options = self.route_options.clone();
        for st in &body.statements {
            if let Statement::VariableDeclaration(v) = st {
                for d in &v.declarations {
                    if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) {
                        if v.kind.is_const() {
                            self.note_route_options(id.name.as_str(), init);
                        } else {
                            self.route_options.remove(id.name.as_str());
                        }
                    }
                }
            }
        }
        // The module's routers of the same names are set aside.
        let inherited: Vec<(String, RawRef)> = parent
            .and_then(|(p, _)| self.hooks.get(p))
            .cloned()
            .unwrap_or_default();
        let inherited_calls: Vec<(String, RawGuardCall)> = parent
            .and_then(|(p, _)| self.position_calls.get(p))
            .cloned()
            .unwrap_or_default();
        let mut aside = Vec::new();
        let mut aside_calls = Vec::new();
        for (n, a, _) in &routers {
            aside.push((
                n.clone(),
                self.express.insert(n.clone(), vec![]),
                self.router_adapter.insert(n.clone(), a),
                self.hooks.insert(n.clone(), inherited.clone()),
                self.passed.remove(n),
                self.scope_unread.remove(n),
            ));
            aside_calls.push((
                n.clone(),
                self.position_calls
                    .insert(n.clone(), inherited_calls.clone()),
            ));
        }
        // A registration under a condition, in a loop or in a `try` is not read:
        // what it registers may run before the routes.
        for (n, _, _) in &routers {
            let mut conditional = ConditionalUse {
                router: n,
                found: false,
                unread_routes: 0,
            };
            for st in &body.statements {
                if !matches!(
                    st,
                    Statement::ExpressionStatement(_)
                        | Statement::VariableDeclaration(_)
                        | Statement::ReturnStatement(_)
                ) {
                    conditional.visit_statement(st);
                }
            }
            if conditional.found {
                self.scope_unread
                    .entry(n.clone())
                    .or_default()
                    .push(format!("what is registered on {n} under a condition"));
            }
        }
        self.scope += 1;
        self.scope_seq += 1;
        if let Some(function) = name {
            for (n, _, at) in &routers {
                if at.is_some() {
                    self.out
                        .function_routers
                        .push((function.to_string(), format!("{n}@{}", self.scope_seq)));
                }
            }
        }
        self.scope_prefix.push(prefix.unwrap_or_default());
        let from = self.scope_routes.len();
        let outer_refs = self.enter_local_refs(&body.statements);
        for st in &body.statements {
            // `routes.forEach((r) => router.get(r.path, r.handler))` is a loop.
            let iterates = matches!(st, Statement::ExpressionStatement(es)
                if matches!(peel(&es.expression), Expression::CallExpression(c)
                    if matches!(call_name(&c.callee), Some("forEach" | "map"))));
            if let (Statement::ExpressionStatement(es), false) = (st, iterates) {
                self.note_app_passed(&es.expression);
                self.lower_express_routes(&es.expression, false);
            } else {
                self.conditional_routes(st, 0);
            }
        }
        // A Fastify route takes the hooks of its instance wherever they are added.
        for (symbol, router) in self.scope_routes.split_off(from) {
            if self.router_adapter.get(&router).copied() != Some("fastify") {
                continue;
            }
            let hooks = self.hooks.get(&router).cloned().unwrap_or_default();
            let calls = self
                .position_calls
                .get(&router)
                .cloned()
                .unwrap_or_default();
            if let Some(sym) = self.out.symbols.iter_mut().find(|s| s.name == symbol) {
                for (pattern, hook) in hooks {
                    if pattern.is_empty() && !sym.app_middleware.contains(&hook) {
                        sym.app_middleware.push(hook);
                    }
                }
                for (pattern, call) in calls {
                    if pattern.is_empty() && !sym.guard_calls.contains(&call) {
                        sym.guard_calls.push(call);
                    }
                }
            }
        }
        self.scope_prefix.pop();
        self.scope -= 1;
        self.local_refs = outer_refs;
        for (n, _, at) in &routers {
            let own: Vec<RawRef> = self
                .hooks
                .get(n)
                .into_iter()
                .flatten()
                .filter(|h| h.0.is_empty() && !inherited.contains(h))
                .map(|h| h.1.clone())
                .collect();
            let own_calls: Vec<RawGuardCall> = self
                .position_calls
                .get(n)
                .into_iter()
                .flatten()
                .filter(|c| c.0.is_empty() && !inherited_calls.contains(c))
                .map(|c| c.1.clone())
                .collect();
            if let (Some(function), Some(at)) = (name, at) {
                let mut middleware = self.express.get(n).cloned().unwrap_or_default();
                middleware.extend(own.iter().cloned());
                self.out.registers.push(RawRegisters {
                    function: function.to_string(),
                    param: *at,
                    middleware,
                    unread: self.scope_unread.contains_key(n) || self.passed.contains_key(n),
                    shared,
                    calls: own_calls.clone(),
                });
            }
            if let (Some((p, true)), Some(0)) = (parent, at) {
                let list = aside_calls
                    .iter_mut()
                    .find(|x| x.0 == p)
                    .and_then(|x| x.1.as_mut());
                let given = own_calls.into_iter().map(|c| (String::new(), c));
                match list {
                    Some(list) => list.extend(given),
                    None => self
                        .position_calls
                        .entry(format!("\u{0}{p}"))
                        .or_default()
                        .extend(given),
                }
            }
            // `fastify-plugin` breaks the encapsulation: the plugin's hooks are those
            // of the instance it is registered on.
            if let (Some((p, true)), Some(0)) = (parent, at) {
                let list = aside
                    .iter_mut()
                    .find(|x| x.0 == p)
                    .and_then(|x| x.3.as_mut());
                match list {
                    Some(list) => {
                        for h in own {
                            list.push((String::new(), h));
                        }
                    }
                    None => {
                        let list = self.hooks.entry(format!("\u{0}{p}")).or_default();
                        for h in own {
                            list.push((String::new(), h));
                        }
                    }
                }
            }
        }
        for (n, express, adapter, hooks, passed, unread) in aside {
            let put = |m: &mut BTreeMap<String, Vec<RawRef>>, v: Option<Vec<RawRef>>| match v {
                Some(v) => {
                    m.insert(n.clone(), v);
                }
                None => {
                    m.remove(&n);
                }
            };
            put(&mut self.express, express);
            match adapter {
                Some(a) => {
                    self.router_adapter.insert(n.clone(), a);
                }
                None => {
                    self.router_adapter.remove(&n);
                }
            }
            match hooks {
                Some(h) => {
                    self.hooks.insert(n.clone(), h);
                }
                None => {
                    self.hooks.remove(&n);
                }
            }
            match passed {
                Some(p) => {
                    self.passed.insert(n.clone(), p);
                }
                None => {
                    self.passed.remove(&n);
                }
            }
            match unread {
                Some(u) => {
                    self.scope_unread.insert(n.clone(), u);
                }
                None => {
                    self.scope_unread.remove(&n);
                }
            }
        }
        for (n, calls) in aside_calls {
            match calls {
                Some(c) => {
                    self.position_calls.insert(n, c);
                }
                None => {
                    self.position_calls.remove(&n);
                }
            }
        }
        self.route_options = options;
        // The hooks a `fastify-plugin` plugin gave its parent, where the parent was
        // not one of the names set aside.
        if let Some((p, true)) = parent
            && let Some(given) = self.hooks.remove(&format!("\u{0}{p}"))
        {
            let list = self.hooks.entry(p.to_string()).or_default();
            for h in given {
                if !list.contains(&h) {
                    list.push(h);
                }
            }
        }
        if let Some((p, true)) = parent
            && let Some(given) = self.position_calls.remove(&format!("\u{0}{p}"))
        {
            let list = self.position_calls.entry(p.to_string()).or_default();
            for c in given {
                if !list.contains(&c) {
                    list.push(c);
                }
            }
        }
    }

    /// The routes a function registers under a condition: in an `if` or its `else`,
    /// in a `try`, in a block. They are listed, as routes that may be served. What
    /// is registered beside them there (a hook, a middleware, a plugin) is not
    /// taken to run for any route: the function's routes are already those of a
    /// router with something unread on it ([`Lowerer::scope_unread`]), so a guard
    /// registered under the same condition is not proven, and a guard written on
    /// the route itself is read.
    fn conditional_routes(&mut self, st: &Statement, depth: usize) {
        if depth > 4 {
            return;
        }
        match st {
            Statement::ExpressionStatement(es) => {
                // `routes.forEach((r) => router.get(r.path, r.handler))`: the
                // callback's body, as a loop's.
                if let Expression::CallExpression(c) = peel(&es.expression)
                    && matches!(call_name(&c.callee), Some("forEach" | "map"))
                    && let Some(f) = c.arguments.first().and_then(|a| a.as_expression())
                {
                    match unwrap_expr(f) {
                        Expression::ArrowFunctionExpression(a) => {
                            match &a.body {
                                ArrowFunctionBody::FunctionBody(b) => {
                                    for s in &b.statements {
                                        self.conditional_routes(s, depth + 1);
                                    }
                                }
                                other => {
                                    if let Some(x) = other.as_expression() {
                                        self.conditional_route(x);
                                    }
                                }
                            }
                            return;
                        }
                        Expression::FunctionExpression(a) => {
                            for s in a.body.iter().flat_map(|b| &b.statements) {
                                self.conditional_routes(s, depth + 1);
                            }
                            return;
                        }
                        _ => {}
                    }
                }
                self.conditional_route(&es.expression);
            }
            // A loop or a `switch`: the routes written there are listed, as routes
            // that may be served.
            Statement::ForStatement(f) => self.conditional_routes(&f.body, depth + 1),
            Statement::ForOfStatement(f) => self.conditional_routes(&f.body, depth + 1),
            Statement::ForInStatement(f) => self.conditional_routes(&f.body, depth + 1),
            Statement::WhileStatement(f) => self.conditional_routes(&f.body, depth + 1),
            Statement::DoWhileStatement(f) => self.conditional_routes(&f.body, depth + 1),
            Statement::SwitchStatement(sw) => {
                for case in &sw.cases {
                    for s in &case.consequent {
                        self.conditional_routes(s, depth + 1);
                    }
                }
            }
            Statement::BlockStatement(b) => {
                for s in &b.body {
                    self.conditional_routes(s, depth + 1);
                }
            }
            Statement::IfStatement(i) => {
                self.conditional_routes(&i.consequent, depth + 1);
                if let Some(a) = &i.alternate {
                    self.conditional_routes(a, depth + 1);
                }
            }
            Statement::TryStatement(t) => {
                for s in &t.block.body {
                    self.conditional_routes(s, depth + 1);
                }
                if let Some(f) = &t.finalizer {
                    for s in &f.body {
                        self.conditional_routes(s, depth + 1);
                    }
                }
            }
            _ => {}
        }
    }

    /// One registration under a condition or in a loop: only a route is read.
    fn conditional_route(&mut self, e: &Expression) {
        if !self.first_visit(e) {
            return;
        }
        let outer = std::mem::replace(&mut self.scope_conditional, true);
        let from = self.out.entry_points.len();
        if !self.computed_route(e) {
            self.express_routes(e, false);
        }
        self.scope_conditional = outer;
        // A route whose path is not a literal comes from a table: what the table
        // holds for it (its handler, what runs before it) is not read.
        let unread = "a route registered with a path that is not a literal";
        let listed: Vec<String> = self.out.entry_points[from..]
            .iter()
            .filter(|e| e.route.as_deref().is_some_and(|r| r.contains('?')))
            .map(|e| e.symbol.clone())
            .collect();
        for sym in self
            .out
            .symbols
            .iter_mut()
            .filter(|s| listed.contains(&s.name))
        {
            if !sym.app_unread.iter().any(|u| u == unread) {
                sym.app_unread.push(unread.to_string());
            }
        }
    }

    /// A route whose method is computed (`app[r.method](r.path, r.handler)`, in a
    /// loop over a table of routes): listed for every method, under the path where
    /// it is a literal and an unknown one where it is not, with its guard unread
    /// ([`RawSymbol::app_unread`]): what the table holds for it is not read.
    fn computed_route(&mut self, e: &Expression) -> bool {
        let Expression::CallExpression(c) = peel(e) else {
            return false;
        };
        let Expression::ComputedMemberExpression(m) = unwrap_expr(&c.callee) else {
            return false;
        };
        let Expression::Identifier(id) = unwrap_expr(&m.object) else {
            return false;
        };
        let receiver = id.name.to_string();
        if !self.express.contains_key(&receiver) || c.arguments.len() < 2 {
            return false;
        }
        let exprs = arg_exprs(&c.arguments);
        let Some(handler) = exprs.last().copied() else {
            return false;
        };
        let path = exprs
            .first()
            .and_then(|x| route_text(x))
            .unwrap_or_else(|| "?".to_string());
        let adapter = self
            .router_adapter
            .get(&receiver)
            .copied()
            .unwrap_or("express");
        let line = self.line_of(c.span.start);
        let mut sym = RawSymbol::empty("", SymbolKind::Function, line);
        self.handler_facts(Some(handler), &mut sym);
        sym.app_unread = vec![format!("a route {receiver} registers by a computed method")];
        sym.app_unread.extend(
            self.scope_unread
                .get(&receiver)
                .into_iter()
                .flatten()
                .cloned(),
        );
        self.push_route(adapter, "ALL", &path, line, sym);
        self.route_on(&receiver);
        true
    }

    /// What says a function exported the CommonJS way is handed a router as its
    /// first parameter (`module.exports = async function (app, opts) { app.get(
    /// "/items", ...) }`), where no type does: it registers a route on it under a
    /// path, or calls what only a Fastify instance has (`addHook`, `register`,
    /// `decorate`, `route`). The adapter: Fastify for those calls and for an
    /// `async` function (a plugin), else Express.
    fn plugin_shape(
        &self,
        params: &FormalParameters,
        body: &FunctionBody,
        is_async: bool,
    ) -> Option<&'static str> {
        // A parameter with a type is read by its type.
        if params
            .items
            .first()
            .is_some_and(|p| p.type_annotation.is_some())
        {
            return None;
        }
        let Some(BindingPattern::BindingIdentifier(first)) =
            params.items.first().map(|p| &p.pattern)
        else {
            return None;
        };
        let mut shape = PluginShape {
            param: first.name.as_str(),
            routes: false,
            fastify: false,
        };
        shape.visit_function_body(body);
        match (shape.fastify, shape.routes) {
            (true, _) => Some("fastify"),
            (false, true) if is_async => Some("fastify"),
            (false, true) => Some("express"),
            (false, false) => None,
        }
    }

    /// [`Lowerer::scoped_fn`] for each function the module declares.
    pub(super) fn lower_router_functions(&mut self, program: &Program) {
        // The functions the module exports the CommonJS way by name
        // (`module.exports = routes`).
        let mut exported: BTreeSet<String> = BTreeSet::new();
        for st in &program.body {
            if let Statement::ExpressionStatement(es) = st
                && let Expression::AssignmentExpression(a) = unwrap_expr(&es.expression)
                && self.cjs_export_name(a).is_some()
                && let Expression::Identifier(id) = unwrap_expr(&a.right)
            {
                exported.insert(id.name.to_string());
            }
        }
        // And the ES way: `export default async function (app) { ... }`, `export
        // async function plugin(f) { ... }`, `export { routes }`.
        for e in &self.out.exports {
            if let RawExportTarget::Local(local) = &e.target {
                exported.insert(local.clone());
            }
        }
        let mut pass = ScopedPass { l: self, exported };
        pass.visit_program(program);
    }

    /// The router of the module a call registers on, and the method called:
    /// `app.get(...)` where `app` is a router the module binds at its top level and
    /// no function in between binds the name again.
    fn module_router_call<'b>(&self, c: &'b CallExpression) -> Option<(String, &'b str)> {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return None;
        };
        let Expression::Identifier(id) = unwrap_expr(&m.object) else {
            return None;
        };
        let symbol = id
            .reference_id
            .get()
            .and_then(|r| self.scoping.get_reference(r).symbol_id())?;
        (self.out.routers.iter().any(|r| r == id.name.as_str())
            && self.scoping.symbol_scope_id(symbol) == self.scoping.root_scope_id())
        .then(|| (id.name.to_string(), m.property.name.as_str()))
    }

    /// What is given where a middleware goes never authenticates: a path, or a
    /// value of a package on [`drift_core::guard_lists::NEVER_AUTHENTICATES`]
    /// (`morgan("dev")`, `express.json()`, `cors()`).
    fn never_authenticates(&self, e: &Expression) -> bool {
        if string_value(e).is_some() {
            return true;
        }
        // A router of the module, mounted: its routes are its own.
        if matches!(unwrap_expr(e), Expression::Identifier(id)
            if self.out.routers.iter().any(|r| r == id.name.as_str()))
        {
            return true;
        }
        let target = match unwrap_expr(e) {
            Expression::CallExpression(c) => &c.callee,
            other => other,
        };
        let Some(r) = self.canon(target) else {
            return false;
        };
        let RawBase::Import { spec, name } = &r.base else {
            return false;
        };
        let member = r
            .member
            .trim_start_matches('.')
            .split(['.', '('])
            .next()
            .filter(|m| !m.is_empty());
        drift_core::guard_lists::never_authenticates(
            spec.trim_start_matches("node:"),
            member.unwrap_or(name.as_str()),
        )
    }

    /// [`Lowerer::closure_routes`] for every function of the module, and for every
    /// statement of the module that is no expression and no declaration (an `if`, a
    /// `try`, a loop, a block).
    pub(super) fn lower_closure_routes(&mut self, program: &Program) {
        if self.out.routers.is_empty() {
            return;
        }
        for st in &program.body {
            if matches!(
                st,
                Statement::IfStatement(_)
                    | Statement::TryStatement(_)
                    | Statement::BlockStatement(_)
                    | Statement::ForStatement(_)
                    | Statement::ForOfStatement(_)
                    | Statement::ForInStatement(_)
                    | Statement::WhileStatement(_)
                    | Statement::DoWhileStatement(_)
                    | Statement::SwitchStatement(_)
            ) {
                self.closure_routes(std::slice::from_ref(st), st.span(), true);
            }
        }
        let mut pass = ClosurePass { l: self };
        pass.visit_program(program);
    }

    /// Lowers the routes a function registers on a router of the module where it
    /// is neither handed the router nor builds it: `function setup() {
    /// app.get("/x", h) }`, `ready.then(() => { app.use(auth); app.get("/x", h) })`;
    /// and the routes the module registers under a condition (`conditional`: `body`
    /// is that one statement). The last measured build listed none of them.
    ///
    /// The routes are the module router's own: they are mounted as it is. What the
    /// function registers before a route, in the order written, runs before it,
    /// as in a module. What is registered on the router anywhere else (by the
    /// module, by another function) may run before it or not, depending on when
    /// the function is called: where there is any, the route's guard is unread
    /// ([`RawSymbol::app_unread`]), never none.
    fn closure_routes(&mut self, body: &[Statement], span: oxc_span::Span, conditional: bool) {
        let mut uses = ClosureUse {
            l: self,
            depth: 0,
            routers: BTreeSet::new(),
        };
        for st in body {
            uses.visit_statement(st);
        }
        let routers = uses.routers;
        if routers.is_empty() || unmeasured_listing() {
            return;
        }
        let mut aside = Vec::new();
        for n in &routers {
            let elsewhere = self.guard_sites.get(n).is_some_and(|sites| {
                sites
                    .iter()
                    .any(|(at, _)| *at < span.start || *at >= span.end)
            }) || self.passed.contains_key(n);
            let mut unread = self.scope_unread.get(n).cloned().unwrap_or_default();
            if elsewhere {
                unread.push(deferred_unread(n));
            }
            aside.push((
                n.clone(),
                self.express.insert(n.clone(), vec![]),
                self.hooks.insert(n.clone(), vec![]),
                self.passed.remove(n),
                match unread.is_empty() {
                    true => self.scope_unread.remove(n),
                    false => self.scope_unread.insert(n.clone(), unread),
                },
                self.position_calls.insert(n.clone(), vec![]),
            ));
        }
        // A registration under a condition, in a loop or in a `try` is not read:
        // what it registers may run before the routes.
        for n in &routers {
            let mut found = ConditionalUse {
                router: n,
                found: false,
                unread_routes: 0,
            };
            for st in body {
                if conditional
                    || !matches!(
                        st,
                        Statement::ExpressionStatement(_)
                            | Statement::VariableDeclaration(_)
                            | Statement::ReturnStatement(_)
                    )
                {
                    found.visit_statement(st);
                }
            }
            if found.found {
                self.scope_unread
                    .entry(n.clone())
                    .or_default()
                    .push(format!("what is registered on {n} under a condition"));
            }
        }
        let outer = std::mem::replace(&mut self.closure_routers, routers.clone());
        let outer_refs = self.enter_local_refs(body);
        self.scope += 1;
        self.scope_seq += 1;
        self.scope_prefix.push(String::new());
        let from = self.scope_routes.len();
        for st in body {
            let iterates = matches!(st, Statement::ExpressionStatement(es)
                if matches!(peel(&es.expression), Expression::CallExpression(c)
                    if matches!(call_name(&c.callee), Some("forEach" | "map"))));
            if let (Statement::ExpressionStatement(es), false) = (st, iterates || conditional) {
                self.note_app_passed(&es.expression);
                self.lower_express_routes(&es.expression, false);
            } else {
                self.conditional_routes(st, 0);
            }
        }
        // A Fastify route takes the hooks of its instance wherever they are added.
        for (symbol, router) in self.scope_routes.split_off(from) {
            if self.router_adapter.get(&router).copied() != Some("fastify") {
                continue;
            }
            let hooks = self.hooks.get(&router).cloned().unwrap_or_default();
            let calls = self
                .position_calls
                .get(&router)
                .cloned()
                .unwrap_or_default();
            if let Some(sym) = self.out.symbols.iter_mut().find(|s| s.name == symbol) {
                for (pattern, hook) in hooks {
                    if pattern.is_empty() && !sym.app_middleware.contains(&hook) {
                        sym.app_middleware.push(hook);
                    }
                }
                for (pattern, call) in calls {
                    if pattern.is_empty() && !sym.guard_calls.contains(&call) {
                        sym.guard_calls.push(call);
                    }
                }
            }
        }
        self.scope_prefix.pop();
        self.scope -= 1;
        self.closure_routers = outer;
        self.local_refs = outer_refs;
        for (n, express, hooks, passed, unread, calls) in aside {
            match express {
                Some(v) => self.express.insert(n.clone(), v),
                None => self.express.remove(&n),
            };
            match hooks {
                Some(v) => self.hooks.insert(n.clone(), v),
                None => self.hooks.remove(&n),
            };
            match passed {
                Some(v) => self.passed.insert(n.clone(), v),
                None => self.passed.remove(&n),
            };
            match unread {
                Some(v) => self.scope_unread.insert(n.clone(), v),
                None => self.scope_unread.remove(&n),
            };
            match calls {
                Some(v) => self.position_calls.insert(n, v),
                None => self.position_calls.remove(&n),
            };
        }
    }

    /// The name an assignment exports the CommonJS way: `default` for
    /// `module.exports = ...`, `x` for `module.exports.x = ...` and `exports.x = ...`.
    fn cjs_export_name(&self, a: &AssignmentExpression) -> Option<String> {
        let AssignmentTarget::StaticMemberExpression(m) = &a.left else {
            return None;
        };
        let prop = m.property.name.as_str();
        if prop == "exports" && self.is_global(&m.object, "module") {
            return Some("default".to_string());
        }
        match unwrap_expr(&m.object) {
            Expression::StaticMemberExpression(inner)
                if inner.property.name == "exports" && self.is_global(&inner.object, "module") =>
            {
                Some(prop.to_string())
            }
            obj if self.is_global(obj, "exports") => Some(prop.to_string()),
            _ => None,
        }
    }

    /// A function written in place, or one wrapped by `fastify-plugin`
    /// (`fp(async (instance) => { ... })`): its parameters, its body, and whether
    /// it is so wrapped.
    fn plugin_fn<'b, 'a>(
        &self,
        e: &'b Expression<'a>,
    ) -> Option<(&'b FormalParameters<'a>, &'b FunctionBody<'a>, bool)> {
        match unwrap_expr(e) {
            Expression::ArrowFunctionExpression(f) => match &f.body {
                ArrowFunctionBody::FunctionBody(b) => Some((&f.params, &**b, false)),
                _ => None,
            },
            Expression::FunctionExpression(f) => Some((&f.params, f.body.as_deref()?, false)),
            Expression::CallExpression(c) if matches!(self.canon(&c.callee), Some(RawRef { base: RawBase::Import { spec, .. }, .. }) if spec == "fastify-plugin") =>
            {
                let inner = c.arguments.first()?.as_expression()?;
                self.plugin_fn(inner).map(|(p, b, _)| (p, b, true))
            }
            _ => None,
        }
    }

    /// Facts of a handler: an inline function is walked; a reference is recorded.
    pub(super) fn handler_facts(&self, handler: Option<&Expression>, sym: &mut RawSymbol) {
        let mut c = Collector::new(self);
        let mut status = input::InputUse::Unknown;
        match handler.map(unwrap_expr) {
            Some(
                h @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)),
            ) => {
                status = match h {
                    Expression::ArrowFunctionExpression(a) => input::arrow_input(a, false),
                    Expression::FunctionExpression(f) => input::function_input(f, false),
                    _ => input::InputUse::Unknown,
                };
                c.visit_expression(h);
            }
            Some(h) => {
                if let Some(mut r) = self.canon(h) {
                    r.member.push_str("(ref)");
                    c.calls.insert(r);
                }
                // `asyncHandler(ctrl.list)`, `ctrl.list.bind(ctrl)`: the handler is the
                // reference inside, recorded too.
                let mut inner = Vec::new();
                self.inner_handler_refs(h, &mut inner, 0);
                for mut r in inner {
                    r.member.push_str("(ref)");
                    c.calls.insert(r);
                }
            }
            None => {}
        }
        let saw_input = c.saw_input;
        c.fill(sym);
        record_input(sym, saw_input, status);
    }

    /// The references a handler value wraps or binds: `h` in `asyncHandler(h)`,
    /// `catchErrors(ctrl.list)` (any call given a reference) and `ctrl.list.bind(ctrl)`,
    /// through nested wrappers (`asyncHandler(ctrl.list.bind(ctrl))`). A plain reference
    /// is not inner (the caller records it); globals are left out.
    fn inner_handler_refs(&self, e: &Expression, out: &mut Vec<RawRef>, depth: usize) {
        if depth > 3 {
            return;
        }
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return;
        };
        let take = |x: &Expression, out: &mut Vec<RawRef>| match unwrap_expr(x) {
            Expression::Identifier(_) | Expression::StaticMemberExpression(_) => {
                if let Some(r) = self.canon(x)
                    && !matches!(r.base, RawBase::Global(_))
                {
                    out.push(r);
                }
            }
            Expression::CallExpression(_) => self.inner_handler_refs(x, out, depth + 1),
            _ => {}
        };
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee)
            && m.property.name == "bind"
        {
            take(&m.object, out);
            return;
        }
        for a in &c.arguments {
            if let Some(x) = a.as_expression() {
                take(x, out);
            }
        }
    }

    /// The calls a handler value is handed that build what it wraps: `searchProducts()`
    /// in `asyncHandler(searchProducts())`, through nested wrappers
    /// (`a(b(makeHandler()))`), each as the call is named (`routes/search.ts#
    /// searchProducts()`). A bound method (`ctrl.list.bind(ctrl)`) is a reference
    /// ([`Lowerer::inner_handler_refs`]), and globals are left out: neither is a
    /// function the repository makes.
    fn handler_factories(&self, e: &Expression, out: &mut Vec<RawRef>, depth: usize) {
        if depth > 3 {
            return;
        }
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return;
        };
        for a in &c.arguments {
            let Some(x) = a.as_expression() else {
                continue;
            };
            let Expression::CallExpression(inner) = unwrap_expr(x) else {
                continue;
            };
            let binds = matches!(
                unwrap_expr(&inner.callee),
                Expression::StaticMemberExpression(m) if m.property.name == "bind"
            );
            if !binds
                && let Some(r) = self.canon(x)
                && !matches!(r.base, RawBase::Global(_))
                && !out.contains(&r)
            {
                out.push(r);
            }
            self.handler_factories(x, out, depth + 1);
        }
    }

    // ------------------------------------------------------------------ Express / Hono / Fastify (top level)

    /// The adapter of the router a registration chain starts from, when the chain
    /// starts by creating one inline: `Router().get("/a", h)`.
    pub(super) fn inline_router_adapter(&self, e: &Expression) -> Option<&'static str> {
        let mut cur = unwrap_expr(e);
        loop {
            if let Some(a) = self.router_adapter_of(cur) {
                return Some(a);
            }
            let Expression::CallExpression(c) = cur else {
                return None;
            };
            let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                return None;
            };
            cur = unwrap_expr(&m.object);
        }
    }

    /// Route registrations on known routers in a top-level statement. With `inline`
    /// (`export default Router().get(...)`), a chain may start from a router created
    /// in place; that router is known by its export name, [`DEFAULT_ROUTER`].
    pub(super) fn lower_express_routes(&mut self, e: &Expression, inline: bool) -> bool {
        if self.express.is_empty() {
            return false;
        }
        if !self.first_visit(e) {
            return true;
        }
        self.express_routes(e, inline)
    }

    /// Whether the registration `e` is lowered for the first time: one written
    /// inside a function is met again when the functions that register on a router
    /// of the module are lowered ([`Lowerer::closure_routes`]), which reads each
    /// registration once.
    fn first_visit(&mut self, e: &Expression) -> bool {
        self.scope == 0 || self.lowered_sites.insert(e.span().start)
    }

    /// [`Lowerer::lower_express_routes`], of a registration met for the first time.
    fn express_routes(&mut self, e: &Expression, inline: bool) -> bool {
        if self.express.is_empty() {
            return false;
        }
        let mut regs: Vec<(String, &oxc_allocator::Vec<Argument>)> = Vec::new();
        let Some((receiver, base)) = self.router_chain(e, &mut regs, inline) else {
            return false;
        };
        let adapter = self
            .router_adapter
            .get(&receiver)
            .copied()
            .unwrap_or("express");
        let line = self.line_of(e.span().start);
        for (method, args) in regs {
            let exprs: Vec<&Expression> = arg_exprs(args);
            // Under a condition, only the routes are read: what is registered beside
            // them there runs for no route that is proven.
            if self.scope_conditional
                && matches!(
                    method.as_str(),
                    "hook" | "decorate" | "register" | "use" | "mount" | "openapi" | "param"
                )
            {
                continue;
            }
            // An array of literal paths registers once for each of them.
            let listed = exprs.first().map(|x| listed_paths(x)).unwrap_or_default();
            let aliases: Vec<Option<String>> = match listed.is_empty() {
                true => vec![None],
                false => listed.into_iter().map(Some).collect(),
            };
            for alias in aliases {
                // The path the registration is given, under the router's base.
                let base_of = self.base_paths.get(&receiver).cloned();
                let first_text = |x: &Expression| -> Option<String> {
                    let own = alias.clone().or_else(|| route_text(x))?;
                    Some(match &base_of {
                        Some(b) => join_path(&[b, &own]),
                        None => own,
                    })
                };
                match method.as_str() {
                    "param" => {
                        // The callback runs before every route of this router whose
                        // path has the parameter, and can refuse.
                        let Some(name) = alias
                            .clone()
                            .or_else(|| exprs.first().and_then(|x| string_value(x)))
                        else {
                            continue;
                        };
                        for x in exprs.iter().skip(1) {
                            let hook = match unwrap_expr(x) {
                                f @ (Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)) => {
                                    self.in_place_function(&receiver, "param", f)
                                }
                                other => self.guard_ref(other).unwrap_or_else(|| {
                                    Self::unread_hook("a callback of router.param that is not read")
                                }),
                            };
                            let list = self.param_hooks.entry(receiver.clone()).or_default();
                            let entry = (name.clone(), hook);
                            if !list.contains(&entry) {
                                list.push(entry);
                            }
                        }
                    }
                    "hook" => {
                        // A hook that runs before the handler, for every route of the
                        // instance registered after it.
                        if let Some(name) = exprs.first().and_then(|x| string_value(x))
                            && FASTIFY_HOOKS.contains(&name.as_str())
                        {
                            for x in &exprs[1..] {
                                self.note_hook(&receiver, "", &name, x);
                            }
                        }
                    }
                    "decorate" => {
                        // What the instance carries under a name: an object built from a
                        // class of the module's reach is read through its methods.
                        let Some(name) = exprs.first().and_then(|x| string_value(x)) else {
                            continue;
                        };
                        let built = match exprs.get(1).map(|x| unwrap_expr(x)) {
                            Some(Expression::NewExpression(n)) => {
                                self.canon(&n.callee).map(|mut r| {
                                    r.member.push_str("()");
                                    r
                                })
                            }
                            _ => None,
                        };
                        // Decorated twice: which of the two is not known.
                        let entry = match self.decorations.get(&name) {
                            Some(_) => None,
                            None => built,
                        };
                        // A function the instance carries under the name: given as a
                        // hook (`{ onRequest: [app.authenticate] }`), it is what runs.
                        let function = match exprs.get(1).map(|x| unwrap_expr(x)) {
                            Some(
                                f @ (Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)),
                            ) => Some(self.in_place_function(&receiver, "decorate", f)),
                            Some(
                                x @ (Expression::Identifier(_)
                                | Expression::StaticMemberExpression(_)),
                            ) => self.fastify_member(x).or_else(|| self.canon(x)),
                            _ => None,
                        };
                        self.out.decorated.push((name.clone(), function));
                        self.decorations.insert(name, entry);
                    }
                    "register" => {
                        // A plugin of a package is handed the instance and may add a
                        // hook that turns callers away (`app.register(require(
                        // "@acme/fastify-sso"))`): it runs before the routes of the
                        // instance, and is not read. One known to add none
                        // ([`FASTIFY_PLAIN_PLUGINS`]) is nothing.
                        // A plugin written in place: its routes are those of an
                        // instance of its own, under the hooks of this one.
                        if let Some((params, body, shared)) =
                            exprs.first().and_then(|x| self.plugin_fn(x))
                        {
                            let prefix = match exprs.get(1).map(|x| unwrap_expr(x)) {
                                Some(Expression::ObjectExpression(o)) => {
                                    object_prop(o, "prefix").and_then(route_text)
                                }
                                _ => None,
                            };
                            self.scoped_fn(
                                None,
                                params,
                                body,
                                (Some("fastify"), false),
                                Some((&receiver, shared)),
                                prefix,
                            );
                            continue;
                        }
                        let plugin = exprs.first().and_then(|x| match unwrap_expr(x) {
                            Expression::CallExpression(c) => {
                                self.require_spec_call(c).map(|spec| RawRef {
                                    base: RawBase::Import {
                                        spec,
                                        name: "default".to_string(),
                                    },
                                    member: String::new(),
                                })
                            }
                            x => self.canon(x),
                        });
                        let Some(r) = plugin else { continue };
                        match &r.base {
                            RawBase::Import { spec, .. } if bare_specifier(spec) => {
                                if !FASTIFY_PLAIN_PLUGINS.contains(&spec.as_str()) {
                                    let hooks = self.hooks.entry(receiver.clone()).or_default();
                                    let entry = (String::new(), r);
                                    if !hooks.contains(&entry) {
                                        hooks.push(entry);
                                    }
                                }
                            }
                            RawBase::Global(_) => {}
                            // A plugin of the repository: its routes are served under
                            // the hooks of this instance, and where `fastify-plugin`
                            // wraps it, its hooks run for the routes that follow here
                            // (linking tells: [`RawRegisters::shared`]).
                            _ => {
                                let own = match exprs.get(1).map(|x| unwrap_expr(x)) {
                                    Some(Expression::ObjectExpression(o)) => {
                                        object_prop(o, "prefix").and_then(route_text)
                                    }
                                    _ => None,
                                };
                                let mut parts: Vec<&str> =
                                    self.scope_prefix.iter().map(String::as_str).collect();
                                if let Some(p) = &own {
                                    parts.push(p);
                                }
                                let hooks = self
                                    .hooks
                                    .get(&receiver)
                                    .into_iter()
                                    .flatten()
                                    .filter(|h| h.0.is_empty() && h.1 != r)
                                    .map(|h| h.1.clone())
                                    .collect();
                                self.out.mounts.push(RawMount {
                                    prefix: join_path(&parts),
                                    target: r.clone(),
                                    middleware: vec![],
                                    parent: if self.scope == 0 {
                                        receiver.clone()
                                    } else {
                                        String::new()
                                    },
                                    tentative: false,
                                    hooks,
                                    passed: self.passed.get(&receiver).cloned().unwrap_or_default(),
                                    calls: self.calls_covering(&receiver, ""),
                                });
                                let mut marked = r;
                                marked.member.push_str(PLUGIN_PASSED);
                                let list = self.passed.entry(receiver.clone()).or_default();
                                if !list.contains(&(marked.clone(), 0)) {
                                    list.push((marked, 0));
                                }
                            }
                        }
                    }
                    "use" if exprs.first().and_then(|x| first_text(x)).is_some() => {
                        // `app.use("/v1", [mw...,] router)`: a mount. The router-level middleware
                        // so far, plus any listed before the router, guard every mounted route.
                        let prefix = first_text(exprs[0]).unwrap_or_default();
                        // What is given for the path may be a middleware of the routes
                        // under it (`app.use("/api/*", requireUser)`) as well as a router:
                        // linking tells which.
                        if let [_, before @ .., last] = exprs.as_slice() {
                            self.note_handed_call(&receiver, &prefix, before, last);
                        }
                        for x in &exprs[1..] {
                            self.note_hook(&receiver, &prefix, "use", x);
                        }
                        // `app.use("/ftp/:file", servePublicFiles())` is a mount like
                        // any other: what the call makes may be a router, a middleware
                        // that hands on, or a handler, and no fact of this file says
                        // which. It is listed as no route; a function it makes that
                        // reads a request and answers, and that nothing listed reaches,
                        // is in the inventory's "not listed" (`unreached_handlers`),
                        // never an unguarded entry point.
                        if let Some(target) = exprs.last().and_then(|t| self.canon(t)) {
                            let mut middleware =
                                self.express.get(&receiver).cloned().unwrap_or_default();
                            for x in &exprs[1..exprs.len() - 1] {
                                self.collect_middleware(x, &mut middleware);
                            }
                            let hooks = self.mount_hooks(&receiver, &prefix, &target);
                            if self.scope == 0 || self.closure_routers.contains(&receiver) {
                                let calls = self.calls_covering(&receiver, &prefix);
                                self.out.mounts.push(RawMount {
                                    prefix,
                                    target,
                                    middleware,
                                    parent: receiver.clone(),
                                    tentative: false,
                                    hooks,
                                    passed: self.passed.get(&receiver).cloned().unwrap_or_default(),
                                    calls,
                                });
                            }
                        }
                    }
                    "use" => {
                        // An error middleware (`(err, req, res, next) => ...`) makes the app
                        // or router handle any error (`handles_errors` `*` on its binding).
                        if exprs.iter().any(|x| match unwrap_expr(x) {
                            Expression::ArrowFunctionExpression(f) => error_middleware(&f.params),
                            Expression::FunctionExpression(f) => error_middleware(&f.params),
                            _ => false,
                        }) && let Some(sym) =
                            self.out.symbols.iter_mut().find(|s| s.name == receiver)
                        {
                            sym.handles_errors.push(RawOperand::Text("*".into()));
                        }
                        // A middleware written in place is read as a function of its own:
                        // before the mount below, whose routes it runs for too.
                        for x in &exprs {
                            if matches!(
                                unwrap_expr(x),
                                Expression::ArrowFunctionExpression(_)
                                    | Expression::FunctionExpression(_)
                            ) {
                                self.note_hook(&receiver, "", "use", x);
                            }
                        }
                        if let [before @ .., last] = exprs.as_slice() {
                            self.note_handed_call(&receiver, "", before, last);
                        }
                        // `app.use([mw...,] router)`: mounted with no path, if the last
                        // argument is a router, which only the linker can tell. What is
                        // active on the parent so far, and listed before it, guards it.
                        if let Some(last) = exprs.last()
                            && matches!(
                                unwrap_expr(last),
                                Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                            )
                            && let Some(target) = self.canon(last)
                        {
                            let mut middleware =
                                self.express.get(&receiver).cloned().unwrap_or_default();
                            for x in &exprs[..exprs.len() - 1] {
                                self.collect_middleware(x, &mut middleware);
                            }
                            let mut hooks = self.mount_hooks(&receiver, "", &target);
                            // What is given before the router here: its calls, and what
                            // has no name, which may guard the mounted routes.
                            let mut calls = self.calls_covering(&receiver, "");
                            let mut before = GuardPosition::default();
                            for x in &exprs[..exprs.len() - 1] {
                                self.guard_position(x, &mut before);
                            }
                            calls.extend(before.calls);
                            hooks.extend(before.unread.iter().map(|how| Self::unread_hook(how)));
                            hooks.extend(before.members.into_iter().map(|(_, member)| member));
                            if self.scope == 0 || self.closure_routers.contains(&receiver) {
                                self.out.mounts.push(RawMount {
                                    prefix: String::new(),
                                    target,
                                    middleware,
                                    parent: receiver.clone(),
                                    tentative: true,
                                    hooks,
                                    passed: self.passed.get(&receiver).cloned().unwrap_or_default(),
                                    calls,
                                });
                            }
                        }
                        // Router-level middleware guards every route registered after it.
                        let mut mws = Vec::new();
                        for x in &exprs {
                            self.collect_middleware(x, &mut mws);
                            // What has no name where it is given may be the guard of
                            // the routes that follow, whatever it is.
                            let p = self.router_position(&receiver, "", x);
                            if !p.unread.is_empty() {
                                let unread = self.scope_unread.entry(receiver.clone()).or_default();
                                for how in p.unread {
                                    if !unread.contains(&how) {
                                        unread.push(how);
                                    }
                                }
                            }
                            let hooks = self.hooks.entry(receiver.clone()).or_default();
                            for (_, member) in p.members {
                                let entry = (String::new(), member);
                                if !hooks.contains(&entry) {
                                    hooks.push(entry);
                                }
                            }
                        }
                        if let Some(list) = self.express.get_mut(&receiver) {
                            list.extend(mws);
                        }
                    }
                    "mount" => {
                        // Hono `app.route("/users", usersRouter)`.
                        if let (Some(prefix), Some(target)) = (
                            exprs.first().and_then(|x| first_text(x)),
                            exprs.get(1).and_then(|t| self.canon(t)),
                        ) {
                            let middleware =
                                self.express.get(&receiver).cloned().unwrap_or_default();
                            let hooks = self.mount_hooks(&receiver, &prefix, &target);
                            if self.scope == 0 || self.closure_routers.contains(&receiver) {
                                let calls = self.calls_covering(&receiver, &prefix);
                                self.out.mounts.push(RawMount {
                                    prefix,
                                    target,
                                    middleware,
                                    parent: receiver.clone(),
                                    tentative: false,
                                    hooks,
                                    passed: self.passed.get(&receiver).cloned().unwrap_or_default(),
                                    calls,
                                });
                            }
                        }
                    }
                    "openapi" => {
                        let cfg = match exprs.first().map(|x| unwrap_expr(x)) {
                            Some(Expression::Identifier(id)) => {
                                self.route_configs.get(id.name.as_str()).cloned()
                            }
                            Some(x) => self.route_config(x),
                            None => None,
                        };
                        let Some(cfg) = cfg else { continue };
                        let mut sym = RawSymbol::empty("", SymbolKind::Function, line);
                        for mw in self.express.get(&receiver).cloned().unwrap_or_default() {
                            sym.wraps.push((mw, WrapKind::Call));
                        }
                        for mw in &cfg.middleware {
                            sym.wraps.push((mw.clone(), WrapKind::Call));
                        }
                        sym.guard_calls = cfg.calls.clone();
                        sym.app_unread = cfg.unread.clone();
                        // What the router was given runs for the route as for one
                        // added by its verb: what has no name, what a call it is
                        // handed to registers, and what was given for a path that
                        // takes the route under the router's base.
                        for how in self.scope_unread.get(&receiver).into_iter().flatten() {
                            if !sym.app_unread.contains(how) {
                                sym.app_unread.push(how.clone());
                            }
                        }
                        sym.app_passed = self.passed.get(&receiver).cloned().unwrap_or_default();
                        let path = match &base_of {
                            Some(b) => join_path(&[b, &cfg.path]),
                            None => cfg.path.clone(),
                        };
                        self.hooks_covering(&receiver, &path, &mut sym);
                        for c in self.calls_covering(&receiver, &path) {
                            if !sym.guard_calls.contains(&c) {
                                sym.guard_calls.push(c);
                            }
                        }
                        self.handler_facts(exprs.get(1).copied(), &mut sym);
                        self.push_route("hono", &cfg.method, &cfg.path, line, sym);
                        self.route_on(&receiver);
                    }
                    m => {
                        // `app.all("*", handler)`: every request the router did not
                        // answer goes to what a package's call handed back.
                        if m == "all"
                            && base.is_none()
                            && let [path, before @ .., last] = exprs.as_slice()
                            && let Some(pattern) = first_text(path)
                        {
                            let prefix = pattern.trim_end_matches('*').trim_end_matches('/');
                            self.note_handed_call(&receiver, prefix, before, last);
                        }
                        let mut rest = exprs.clone();
                        // Handlers spread into the registration (`app.get(path,
                        // ...handlers)`): what runs before the last of them is not
                        // written here.
                        let mut unread: Vec<String> = args
                            .iter()
                            .filter_map(|a| match a {
                                Argument::SpreadElement(s) => Some(format!(
                                    "handlers spread from {}",
                                    spread_name(&s.argument)
                                )),
                                _ => None,
                            })
                            .collect();
                        let path = match (&base, rest.first().and_then(|x| first_text(x))) {
                            (Some(p), _) => match &base_of {
                                Some(b) => join_path(&[b, p]),
                                None => p.clone(),
                            },
                            (None, Some(p)) => {
                                rest.remove(0);
                                p
                            }
                            (None, None) if !rest.is_empty() => {
                                rest.remove(0);
                                match &base_of {
                                    Some(b) => join_path(&[b, "?"]),
                                    None => "?".to_string(),
                                }
                            }
                            (None, None) => continue,
                        };
                        // Express flattens arrays of handlers: `router.get("/p", [auth, h])`.
                        let mut rest: Vec<&Expression> = rest
                            .into_iter()
                            .flat_map(|x| match unwrap_expr(x) {
                                Expression::ArrayExpression(a) => a
                                    .elements
                                    .iter()
                                    .filter_map(|el| match el {
                                        ArrayExpressionElement::SpreadElement(s) => {
                                            Some(&s.argument)
                                        }
                                        other => other.as_expression(),
                                    })
                                    .collect(),
                                _ => vec![x],
                            })
                            .collect();
                        let Some(handler) = rest.pop() else { continue };
                        let mut sym = RawSymbol::empty("", SymbolKind::Function, line);
                        for mw in self.express.get(&receiver).cloned().unwrap_or_default() {
                            sym.wraps.push((mw, WrapKind::Call));
                        }
                        // The functions written in place before the handler: each is
                        // read as a function of its own, a hook beside the route.
                        let mut inline: Vec<&Expression> = Vec::new();
                        let mut keys = Collector::new(self);
                        for mw in &rest {
                            // Fastify shorthand: `fastify.get("/p", { preHandler: [...] }, handler)`.
                            if let Expression::ObjectExpression(o) = unwrap_expr(mw) {
                                // `{ ...secured }`: the hooks of the route may be in
                                // what is spread.
                                unread.extend(self.ordered_options(o, &mut sym));
                                self.fastify_schema_inputs(o, &mut sym.inputs);
                                for hook in FASTIFY_HOOKS {
                                    if let Some(v) = object_prop(o, hook) {
                                        let mut refs = Vec::new();
                                        self.collect_middleware(v, &mut refs);
                                        sym.wraps
                                            .extend(refs.into_iter().map(|r| (r, WrapKind::Call)));
                                        inline.extend(in_place_functions(v));
                                    }
                                }
                                continue;
                            }
                            self.route_position(mw, &mut sym, &mut unread);
                            inline.extend(in_place_functions(mw));
                            // Fastify options held in a binding: an object literal of
                            // the module with no hook and no spread carries no guard
                            // ([`Lowerer::route_options`]). The measured build read the
                            // binding as a wrap; the listed reading does not.
                            if adapter == "fastify"
                                && let Expression::Identifier(id) = unwrap_expr(mw)
                                && matches!(self.route_options.get(id.name.as_str()), Some(Some(h)) if h.is_empty())
                                && let Some(r) = self.middleware_ref(mw)
                            {
                                sym.listed_unwraps.push(r);
                            }
                            if let Some(r) = self.middleware_ref(mw) {
                                if let Expression::CallExpression(call) = unwrap_expr(mw) {
                                    for (i, a) in call.arguments.iter().enumerate() {
                                        if let Some(x) = a.as_expression() {
                                            keys.object_keys(&r, i, x);
                                        }
                                    }
                                    // Hono `zValidator("json", schema)` and its kin.
                                    if call_name(&call.callee).is_some_and(|n| {
                                        n.ends_with("Validator") || n == "validator"
                                    }) && let Some(schema) = call
                                        .arguments
                                        .get(1)
                                        .and_then(|a| a.as_expression())
                                        .and_then(|x| self.canon(x))
                                        .filter(|r| !matches!(r.base, RawBase::Global(_)))
                                    {
                                        sym.inputs.push(schema);
                                    }
                                }
                                sym.wraps.push((r, WrapKind::Call));
                            }
                        }
                        keys.fill(&mut sym);
                        self.handler_facts(Some(handler), &mut sym);
                        // The handler is what a call built. A function written in
                        // place in what the call was handed is the handler it wraps
                        // (`wrap(async (req, res) => { ... })`): read as a function
                        // of its own, the route's body for the readings that list.
                        // A call handed no function stands where a guard may
                        // (`app.get("/users", requireUser())`), as what is written
                        // before a handler does: those readings take it as a
                        // middleware of the route.
                        let mut wrapped: Vec<&Expression> = Vec::new();
                        if let Expression::CallExpression(call) = unwrap_expr(handler) {
                            wrapped.extend(
                                call.arguments
                                    .iter()
                                    .filter_map(|a| a.as_expression())
                                    .flat_map(in_place_functions),
                            );
                            let mut named = Vec::new();
                            self.inner_handler_refs(handler, &mut named, 0);
                            // What a wrapper is handed that a call builds
                            // (`asyncHandler(searchProducts())`): the function that
                            // call makes is what answers, a call of the route for the
                            // readings that list, as `app.get("/p", login())` is.
                            let mut made = Vec::new();
                            self.handler_factories(handler, &mut made, 0);
                            for mut r in made {
                                r.member.push_str("(ref)");
                                if !sym.listed_calls.contains(&r) {
                                    sym.listed_calls.push(r);
                                }
                            }
                            if wrapped.is_empty()
                                && named.is_empty()
                                && let Some(r) = self.middleware_ref(handler)
                            {
                                self.route_position(handler, &mut sym, &mut unread);
                                if !sym.app_middleware.contains(&r) {
                                    sym.app_middleware.push(r);
                                }
                            }
                        }
                        unread.extend(
                            self.scope_unread
                                .get(&receiver)
                                .into_iter()
                                .flatten()
                                .cloned(),
                        );
                        // Koa: a middleware answers by setting `ctx.status` or by
                        // `ctx.throw`, which the reading of a guard does not follow.
                        if adapter == "koa" {
                            unread
                                .push("what a Koa middleware does, which is not read".to_string());
                        }
                        // A route the module registers itself, on a router a
                        // function or a condition registers a middleware on: whether
                        // that runs before the route is not read. The measured build
                        // did not read such a registration at all.
                        if self.scope == 0
                            && self
                                .guard_sites
                                .get(&receiver)
                                .is_some_and(|sites| sites.iter().any(|(_, direct)| !direct))
                            && !unmeasured_listing()
                        {
                            unread.push(deferred_unread(&receiver));
                        }
                        sym.app_unread = unread;
                        sym.app_passed = self.passed.get(&receiver).cloned().unwrap_or_default();
                        self.hooks_covering(&receiver, &path, &mut sym);
                        for c in self.calls_covering(&receiver, &path) {
                            if !sym.guard_calls.contains(&c) {
                                sym.guard_calls.push(c);
                            }
                        }
                        for f in inline {
                            let hook = self.in_place_function(&receiver, "before", f);
                            if !sym.app_middleware.contains(&hook) {
                                sym.app_middleware.push(hook);
                            }
                        }
                        for f in wrapped {
                            let mut body = self.in_place_function(&receiver, "handler", f);
                            body.member.push_str("(ref)");
                            if !sym.listed_calls.contains(&body) {
                                sym.listed_calls.push(body);
                            }
                        }
                        self.push_route(adapter, &m.to_ascii_uppercase(), &path, line, sym);
                        self.route_on(&receiver);
                    }
                }
            }
        }
        true
    }

    /// Walk a registration chain back to its router variable, collecting `(method, args)`.
    fn router_chain<'b, 'a>(
        &self,
        e: &'b Expression<'a>,
        out: &mut Vec<(String, &'b oxc_allocator::Vec<'a, Argument<'a>>)>,
        inline: bool,
    ) -> Option<(String, Option<String>)> {
        // `await app.register(...)`.
        let e = match unwrap_expr(e) {
            Expression::AwaitExpression(a) => &a.argument,
            e => e,
        };
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return None;
        };
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return None;
        };
        let prop = m.property.name.as_str();
        let (receiver, base) = match unwrap_expr(&m.object) {
            Expression::Identifier(id) if self.express.contains_key(id.name.as_str()) => {
                (id.name.to_string(), None)
            }
            inner @ Expression::CallExpression(_)
                if inline
                    && self.express.contains_key(DEFAULT_ROUTER)
                    && self.router_adapter_of(inner).is_some() =>
            {
                (DEFAULT_ROUTER.to_string(), None)
            }
            inner @ Expression::CallExpression(_) => self.router_chain(inner, out, inline)?,
            _ => return None,
        };
        let adapter = self
            .router_adapter
            .get(&receiver)
            .copied()
            .unwrap_or("express");
        match prop {
            "route" if adapter == "hono" => {
                out.push(("mount".into(), &c.arguments));
                Some((receiver, base))
            }
            "route" => {
                let path = c
                    .arguments
                    .first()
                    .and_then(|a| a.as_expression())
                    .and_then(route_text)
                    .unwrap_or_else(|| "?".into());
                Some((receiver, Some(path)))
            }
            "use" | "openapi" => {
                out.push((prop.into(), &c.arguments));
                Some((receiver, base))
            }
            // Fastify `app.addHook("onRequest", verify)`.
            "addHook" => {
                out.push(("hook".into(), &c.arguments));
                Some((receiver, base))
            }
            // Express `router.param("id", callback)`.
            "param" if adapter == "express" => {
                out.push(("param".into(), &c.arguments));
                Some((receiver, base))
            }
            // Fastify `app.decorate("devices", new DeviceService(db))`.
            "decorate" if adapter == "fastify" => {
                out.push(("decorate".into(), &c.arguments));
                Some((receiver, base))
            }
            // Fastify `app.register(plugin, opts)`.
            "register" if adapter == "fastify" => {
                out.push(("register".into(), &c.arguments));
                Some((receiver, base))
            }
            p if EXPRESS_METHODS.contains(&p) => {
                out.push((p.to_string(), &c.arguments));
                Some((receiver, base))
            }
            _ => None,
        }
    }

    // ------------------------------------------------------------------ Fastify (anywhere)

    /// `x.route({ method, url, onRequest, preHandler, handler })` and
    /// `x.register(plugin, { prefix })`, wherever they appear.
    pub(super) fn lower_fastify_anywhere(&mut self, program: &Program) {
        let mut finder = FastifyFinder {
            l: self,
            routes: Vec::new(),
            mounts: Vec::new(),
            prefix: Vec::new(),
        };
        finder.visit_program(program);
        let FastifyFinder { routes, mounts, .. } = finder;
        // A registration on an instance of the module is a mount already, with the
        // hooks of the instance.
        for m in mounts {
            if !self
                .out
                .mounts
                .iter()
                .any(|x| x.target == m.target && x.prefix == m.prefix)
            {
                self.out.mounts.push(m);
            }
        }
        for (method, url, line, sym) in routes {
            self.push_route("fastify", &method, &url, line, sym);
        }
    }

    // ------------------------------------------------------------------ NestJS

    /// `@Controller("users")` classes: each `@Get(":id")`-style method becomes a route
    /// whose wraps are the class decorators and then the method decorators.
    pub(super) fn lower_nest_controller(&mut self, class_name: &str, class: &Class) {
        let is_nest = |r: &RawRef, n: &str| matches!(&r.base, RawBase::Import { spec, name } if spec == "@nestjs/common" && name == n);
        let mut ctrl_path = None;
        let mut class_wraps = Vec::new();
        for d in &class.decorators {
            let Some(r) = self.decorator_ref(d) else {
                continue;
            };
            if is_nest(&r, "Controller") {
                let arg = match unwrap_expr(&d.expression) {
                    Expression::CallExpression(c) => {
                        c.arguments.first().and_then(|a| a.as_expression())
                    }
                    _ => None,
                };
                // `@Controller(["items", "things"])`: one controller at each path.
                let paths = |x: &Expression| match listed_paths(x) {
                    listed if !listed.is_empty() => listed,
                    _ => vec![route_text(x).unwrap_or_default()],
                };
                ctrl_path = Some(match arg.map(unwrap_expr) {
                    Some(Expression::ObjectExpression(o)) => {
                        object_prop(o, "path").map_or_else(|| vec![String::new()], paths)
                    }
                    Some(x) => paths(x),
                    None => vec![String::new()],
                });
            } else {
                class_wraps.push(r);
            }
        }
        let Some(ctrl_path) = ctrl_path else { return };
        let class_guards = self.use_guards(&class.decorators);
        for el in &class.body.body {
            let ClassElement::MethodDefinition(m) = el else {
                continue;
            };
            let mut method = None;
            let mut sub = vec![String::new()];
            let mut sym = RawSymbol::empty("", SymbolKind::Function, self.line_of(m.span.start));
            for w in &class_wraps {
                sym.wraps.push((w.clone(), WrapKind::Decorator));
            }
            let mut keys = Collector::new(self);
            keys.in_method_of(class);
            for d in &m.decorators {
                let Some(r) = self.decorator_ref(d) else {
                    continue;
                };
                if let Some((_, verb)) = NEST_HTTP.iter().find(|(n, _)| is_nest(&r, n)) {
                    method = Some(*verb);
                    if let Expression::CallExpression(c) = unwrap_expr(&d.expression)
                        && let Some(x) = c.arguments.first().and_then(|a| a.as_expression())
                    {
                        // `@Get(["a", "b"])`: the handler at each path.
                        sub = match listed_paths(x) {
                            listed if !listed.is_empty() => listed,
                            _ => vec![route_text(x).unwrap_or_default()],
                        };
                    }
                    continue;
                }
                if let Expression::CallExpression(c) = unwrap_expr(&d.expression) {
                    for (i, a) in c.arguments.iter().enumerate() {
                        if let Some(x) = a.as_expression() {
                            keys.object_keys(&r, i, x);
                        }
                    }
                }
                sym.wraps.push((r, WrapKind::Decorator));
            }
            let Some(verb) = method else { continue };
            if let Some(body) = &m.value.body {
                // Whose the handler's parameters are (`@CurrentUser() user`).
                keys.flow_method_params(&m.value.params);
                keys.visit_function_body(body);
            }
            let saw_input = keys.saw_input;
            keys.fill(&mut sym);
            record_input(&mut sym, saw_input, self.nest_input(m));
            self.nest_method_facts(m, &mut sym);
            sym.decorator_args.extend(class_guards.iter().cloned());
            sym.decorator_args.extend(self.use_guards(&m.decorators));
            self.use_guards_position(&class.decorators, &mut sym);
            self.use_guards_position(&m.decorators, &mut sym);
            sym.nest_metadata = self.direct_metadata(&m.decorators);
            let line = sym.line;
            for ctrl in &ctrl_path {
                for sub in &sub {
                    let path = join_path(&[ctrl, sub]);
                    self.push_route("nestjs", verb, &path, line, sym.clone());
                    if let Some(e) = self.out.entry_points.last() {
                        self.out
                            .nest_routes
                            .push((e.symbol.clone(), class_name.to_string()));
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ NestJS middleware

    /// A middleware given to `consumer.apply(...)` or to the application's `use`: a
    /// class or a function by reference, the callee of a call that builds one
    /// (`helmet()`), the class of an instance, and a function written in place,
    /// which becomes a symbol of its own named for where it is.
    fn nest_middleware_ref(&mut self, e: &Expression, at: &str) -> Option<RawRef> {
        match unwrap_expr(e) {
            f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                let line = self.line_of(f.span().start);
                let mut name = format!("{at} {line}");
                let mut n = 2;
                while self.out.symbols.iter().any(|s| s.name == name) {
                    name = format!("{at} {line} #{n}");
                    n += 1;
                }
                let mut sym = RawSymbol::empty(&name, SymbolKind::Function, line);
                sym.in_place = true;
                sym.is_async = match f {
                    Expression::ArrowFunctionExpression(a) => a.r#async,
                    Expression::FunctionExpression(a) => a.r#async,
                    _ => false,
                };
                self.handler_facts(Some(f), &mut sym);
                self.push_symbol(sym);
                Some(RawRef {
                    base: RawBase::Local(name),
                    member: String::new(),
                })
            }
            Expression::CallExpression(c) => self.canon_callee(&c.callee),
            Expression::NewExpression(n) => self.canon(&n.callee),
            other => self.canon(other),
        }
    }

    /// A route `forRoutes` or `exclude` is given, where it is a literal: a path, a
    /// path with a method of `RequestMethod`, or a binding (a controller class).
    fn nest_route(&self, e: &Expression) -> Option<RawNestRoute> {
        match unwrap_expr(e) {
            Expression::ObjectExpression(o) => {
                let read = o.properties.iter().all(|p| match p {
                    ObjectPropertyKind::ObjectProperty(p) => !p.computed,
                    ObjectPropertyKind::SpreadProperty(_) => false,
                });
                if !read {
                    return None;
                }
                let path = object_prop(o, "path").and_then(string_value)?;
                let method = match object_prop(o, "method").map(unwrap_expr) {
                    None => String::new(),
                    Some(Expression::StaticMemberExpression(m)) => match m.property.name.as_str() {
                        "ALL" => String::new(),
                        name => name.to_string(),
                    },
                    Some(_) => return None,
                };
                Some(RawNestRoute::Path { path, method })
            }
            x @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => {
                self.canon(x).map(RawNestRoute::Controller)
            }
            x => string_value(x).map(|path| RawNestRoute::Path {
                path,
                method: String::new(),
            }),
        }
    }

    /// The routes a call is given, and whether each was read.
    fn nest_routes(&self, args: &oxc_allocator::Vec<Argument>) -> (Vec<RawNestRoute>, bool) {
        let mut unread = false;
        let mut out = Vec::new();
        for a in args {
            match a.as_expression().and_then(|x| self.nest_route(x)) {
                Some(r) => out.push(r),
                None => unread = true,
            }
        }
        (out, unread)
    }

    /// One chain of calls on a module's middleware consumer
    /// (`consumer.apply(A, B).exclude("health").forRoutes("*")`, and what follows it
    /// on the same chain): each `apply` up to its `forRoutes` is one
    /// [`RawNestApply`]. `conditional`: the chain stands under a condition.
    fn nest_chain(&mut self, e: &CallExpression, consumer: &str, at: &str, conditional: bool) {
        let mut steps: Vec<(&str, &oxc_allocator::Vec<Argument>)> = Vec::new();
        let mut call = e;
        loop {
            let Expression::StaticMemberExpression(m) = unwrap_expr(&call.callee) else {
                return;
            };
            steps.push((m.property.name.as_str(), &call.arguments));
            match unwrap_expr(&m.object) {
                Expression::CallExpression(inner) => call = inner,
                Expression::Identifier(id) if id.name == consumer => break,
                _ => return,
            }
        }
        steps.reverse();
        let mut open: Option<RawNestApply> = None;
        for (step, args) in steps {
            match step {
                "apply" => {
                    let mut apply = RawNestApply {
                        unread: conditional,
                        at: at.to_string(),
                        ..RawNestApply::default()
                    };
                    for a in args {
                        match a.as_expression() {
                            Some(x) => match self.nest_middleware_ref(x, at) {
                                Some(r) => apply.middleware.push(r),
                                None => apply.unread = true,
                            },
                            None => apply.unread = true,
                        }
                    }
                    open = Some(apply);
                }
                "exclude" => {
                    if let Some(apply) = &mut open {
                        let (routes, unread) = self.nest_routes(args);
                        apply.exclude.extend(routes);
                        apply.unread |= unread;
                    }
                }
                "forRoutes" => {
                    if let Some(mut apply) = open.take() {
                        let (routes, unread) = self.nest_routes(args);
                        apply.routes = routes;
                        apply.unread |= unread;
                        self.out.nest_applies.push(apply);
                    }
                }
                // Any other step is not one Drift knows: what it changes is not read.
                _ => {
                    if let Some(apply) = &mut open {
                        apply.unread = true;
                    }
                }
            }
        }
    }

    /// `configure(consumer: MiddlewareConsumer)` of a Nest module: the middleware it
    /// applies and the routes it applies them to ([`RawFile::nest_applies`]).
    pub(super) fn lower_nest_configure(&mut self, class_name: &str, class: &Class) {
        for el in &class.body.body {
            let ClassElement::MethodDefinition(m) = el else {
                continue;
            };
            if key_name(&m.key).as_deref() != Some("configure") {
                continue;
            }
            let Some(BindingPattern::BindingIdentifier(consumer)) =
                m.value.params.items.first().map(|p| &p.pattern)
            else {
                continue;
            };
            let Some(body) = &m.value.body else { continue };
            let mut chains = NestChains {
                consumer: consumer.name.to_string(),
                at: format!("{class_name}.configure"),
                conditional: false,
                l: self,
            };
            for st in &body.statements {
                chains.conditional = !matches!(st, Statement::ExpressionStatement(_));
                chains.visit_statement(st);
            }
        }
    }

    /// What is registered with `use` on a Nest application (`const app = await
    /// NestFactory.create(AppModule); app.use(sessionMiddleware)`, or on a parameter
    /// typed as one): it runs before every route of the application
    /// ([`RawFile::nest_applies`]). And whether the application is given a global
    /// prefix or versioning ([`RawFile::nest_prefixed`]).
    pub(super) fn lower_nest_application(&mut self, program: &Program) {
        if !self
            .out
            .imports
            .iter()
            .any(|i| i.spec.starts_with("@nestjs/"))
        {
            return;
        }
        let mut apps = NestApps {
            l: self,
            apps: BTreeSet::new(),
        };
        apps.visit_program(program);
        let apps = apps.apps;
        if apps.is_empty() {
            return;
        }
        let mut uses = NestUses {
            l: self,
            apps,
            branches: 0,
        };
        uses.visit_program(program);
    }
}

// ---------------------------------------------------------------------- Node listeners

/// The modules whose `createServer` takes a request listener.
const NODE_SERVERS: &[&str] = &[
    "http",
    "node:http",
    "https",
    "node:https",
    "http2",
    "node:http2",
];

impl Lowerer<'_> {
    /// `createServer(...)` of a Node HTTP module.
    fn creates_node_server(&self, c: &CallExpression) -> bool {
        self.canon_callee(&c.callee).is_some_and(|r| {
            matches!(&r.base, RawBase::Import { spec, name }
                if NODE_SERVERS.contains(&spec.as_str())
                    && ((name == "createServer" && r.member.is_empty())
                        || r.member == ".createServer"))
        })
    }

    /// A listener written in front of an application: `http.createServer((req, res)
    /// => { if (!signed(req)) { res.statusCode = 401; return res.end(); } app(req,
    /// res); })`, and the same given to `server.on("request", ...)`. Where the
    /// function hands the request and the response on to a binding of the module or
    /// an import (`app(req, res)`, `app.handle(req, res)`), it runs before every
    /// route of that application: it becomes a symbol of its own, read as a
    /// middleware of the application is, and the application is served through it
    /// (a mount with that hook, [`RawMount::hooks`]).
    fn node_listener(&mut self, e: &Expression) {
        if let Some((symbol, targets)) = self.listener_symbol(ListenerFn::Expr(unwrap_expr(e))) {
            for target in targets {
                let mount = listener_mount(&symbol, target);
                if !self.out.mounts.contains(&mount) {
                    self.out.mounts.push(mount);
                }
            }
        }
    }

    /// The symbol of a listener ([`Lowerer::node_listener`]), listed only, and
    /// what the function hands the request and the response on to. None for a
    /// function that hands them on to nothing the module binds or imports.
    fn listener_symbol(&mut self, f: ListenerFn) -> Option<(String, Vec<RawRef>)> {
        let (params, is_async, start) = match f {
            ListenerFn::Expr(Expression::ArrowFunctionExpression(a)) => {
                (&a.params, a.r#async, a.span.start)
            }
            ListenerFn::Expr(Expression::FunctionExpression(a)) => {
                (&a.params, a.r#async, a.span.start)
            }
            ListenerFn::Decl(a) => (&a.params, a.r#async, a.span.start),
            ListenerFn::Expr(_) => return None,
        };
        let name = |i: usize| match params.items.get(i).map(|p| &p.pattern) {
            Some(BindingPattern::BindingIdentifier(b)) => Some(b.name.to_string()),
            _ => None,
        };
        let (req, res) = (name(0)?, name(1)?);
        let mut finder = HandsOver {
            l: self,
            req,
            res,
            found: Vec::new(),
        };
        match f {
            ListenerFn::Expr(e) => finder.visit_expression(e),
            ListenerFn::Decl(d) => finder.visit_function(d, oxc_semantic::ScopeFlags::Function),
        }
        let found = finder.found;
        if found.is_empty() {
            return None;
        }
        let line = self.line_of(start);
        let mut symbol = format!("listener {line}");
        let mut n = 2;
        while self.out.symbols.iter().any(|s| s.name == symbol) {
            symbol = format!("listener {line} #{n}");
            n += 1;
        }
        let mut sym = RawSymbol::empty(&symbol, SymbolKind::Function, line);
        sym.in_place = true;
        sym.is_async = is_async;
        let mut c = Collector::new(self);
        // What it hands the request on to is its continuation: what it answers
        // after that turns no caller away.
        c.continuation_names
            .push(found.iter().map(|(_, name)| name.clone()).collect());
        match f {
            ListenerFn::Expr(e) => c.visit_expression(e),
            ListenerFn::Decl(d) => c.visit_function(d, oxc_semantic::ScopeFlags::Function),
        }
        c.fill(&mut sym);
        self.push_symbol(sym);
        Some((
            symbol,
            found.into_iter().map(|(target, _)| target).collect(),
        ))
    }

    /// The listeners of the Node servers the file builds ([`Lowerer::node_listener`]):
    /// written where they are given, or a function the module binds at its top
    /// level (`const handler = (req, res) => { ... }; http.createServer(handler)`,
    /// a declaration, before or after). A function the module exports that hands
    /// its two parameters on as a listener does is one where another file gives it
    /// to `createServer` ([`RawFile::listener_mounts`], which linking confirms
    /// against [`RawFile::node_listener_refs`]). An application handed to a call
    /// whose result is the listener (`createServer(wrap(app))`) went where what is
    /// in front of it is not read ([`RawMount::passed`]).
    pub(super) fn lower_node_listeners(&mut self, program: &Program) {
        let mut fns: Vec<(String, ListenerFn)> = Vec::new();
        for st in &program.body {
            let decl = match st {
                Statement::ExportDefaultDeclaration(e) => {
                    if let ExportDefaultDeclarationKind::FunctionDeclaration(f) = &e.declaration {
                        let name =
                            f.id.as_ref()
                                .map_or_else(|| "default".to_string(), |i| i.name.to_string());
                        fns.push((name, ListenerFn::Decl(f)));
                    }
                    continue;
                }
                Statement::ExportDeclaration(e) => Some(&e.declaration),
                s => s.as_declaration(),
            };
            match decl {
                Some(Declaration::FunctionDeclaration(f)) => {
                    if let Some(id) = &f.id {
                        fns.push((id.name.to_string(), ListenerFn::Decl(f)));
                    }
                }
                Some(Declaration::VariableDeclaration(v)) => {
                    for d in &v.declarations {
                        if let (BindingPattern::BindingIdentifier(id), Some(init)) =
                            (&d.id, &d.init)
                            && matches!(
                                unwrap_expr(init),
                                Expression::ArrowFunctionExpression(_)
                                    | Expression::FunctionExpression(_)
                            )
                        {
                            fns.push((id.name.to_string(), ListenerFn::Expr(unwrap_expr(init))));
                        }
                    }
                }
                _ => {}
            }
        }
        let mut named = BTreeSet::new();
        if self
            .out
            .imports
            .iter()
            .any(|i| NODE_SERVERS.contains(&i.spec.as_str()))
        {
            let mut listeners = NodeListeners {
                l: self,
                servers: BTreeSet::new(),
                named: BTreeSet::new(),
            };
            listeners.visit_program(program);
            named = listeners.named;
        }
        for (name, f) in fns {
            let local = named.contains(&name);
            let exported = self
                .out
                .exports
                .iter()
                .any(|e| matches!(&e.target, RawExportTarget::Local(l) if *l == name));
            if !local && !exported {
                continue;
            }
            let Some((symbol, targets)) = self.listener_symbol(f) else {
                continue;
            };
            for target in targets {
                let mount = listener_mount(&symbol, target);
                if local {
                    if !self.out.mounts.contains(&mount) {
                        self.out.mounts.push(mount);
                    }
                } else {
                    self.out.listener_mounts.push((name.clone(), mount));
                }
            }
        }
    }
}

/// A function that may be a Node listener: written as an expression, or declared.
#[derive(Clone, Copy)]
enum ListenerFn<'b, 'a> {
    Expr(&'b Expression<'a>),
    Decl(&'b Function<'a>),
}

/// The application `target` is served through the listener `symbol`: a mount with
/// that hook ([`RawMount::hooks`]).
fn listener_mount(symbol: &str, target: RawRef) -> RawMount {
    RawMount {
        prefix: String::new(),
        target,
        middleware: vec![],
        parent: String::new(),
        tentative: false,
        hooks: vec![RawRef {
            base: RawBase::Local(symbol.to_string()),
            member: String::new(),
        }],
        passed: vec![],
        calls: vec![],
    }
}

/// Finds what a listener hands its request and response on to: a call given both,
/// in order, whose callee is a binding of the module or an import (`app(req, res)`,
/// `app.handle(req, res)`), with the name it is called by.
struct HandsOver<'l, 's> {
    l: &'l Lowerer<'s>,
    req: String,
    res: String,
    found: Vec<(RawRef, String)>,
}

impl<'a> Visit<'a> for HandsOver<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let named = |i: usize, want: &str| {
            matches!(
                it.arguments.get(i).and_then(|a| a.as_expression()).map(unwrap_expr),
                Some(Expression::Identifier(id)) if id.name.as_str() == want
            )
        };
        if named(0, &self.req) && named(1, &self.res) {
            let callee = match unwrap_expr(&it.callee) {
                Expression::StaticMemberExpression(m) if m.property.name == "handle" => {
                    unwrap_expr(&m.object)
                }
                other => other,
            };
            if let Expression::Identifier(id) = callee
                && let Some(r) = self.l.canon(callee)
                && r.member.is_empty()
                && matches!(r.base, RawBase::Local(_) | RawBase::Import { .. })
                && !self.found.iter().any(|(_, n)| n == id.name.as_str())
            {
                self.found.push((r, id.name.to_string()));
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds the listeners of the Node servers of a file: the function given to
/// `createServer(...)`, and to `on("request", ...)` of what it built.
struct NodeListeners<'l, 's> {
    l: &'l mut Lowerer<'s>,
    servers: BTreeSet<SymbolId>,
    /// The bindings of the module given where a listener goes, by name.
    named: BTreeSet<String>,
}

impl NodeListeners<'_, '_> {
    /// What is given where a listener goes: a function written there, a binding of
    /// the module or an import (read where the function is), or the result of a
    /// call handed a binding (`wrap(app)`: what stands in front of `app` is not
    /// read).
    fn listener(&mut self, e: &Expression) {
        match unwrap_expr(e) {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                self.l.node_listener(e);
            }
            x @ Expression::Identifier(_) => match self.l.canon(x) {
                Some(RawRef {
                    base: RawBase::Local(n),
                    ..
                }) => {
                    self.named.insert(n);
                }
                Some(
                    r @ RawRef {
                        base: RawBase::Import { .. },
                        ..
                    },
                ) if !self.l.out.node_listener_refs.contains(&r) => {
                    self.l.out.node_listener_refs.push(r);
                }
                _ => {}
            },
            Expression::CallExpression(c) => {
                let Some(callee) = self.l.canon_callee(&c.callee) else {
                    return;
                };
                for (i, a) in c.arguments.iter().enumerate() {
                    let Some(x @ Expression::Identifier(_)) = a.as_expression().map(unwrap_expr)
                    else {
                        continue;
                    };
                    let Some(target) = self
                        .l
                        .canon(x)
                        .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }))
                    else {
                        continue;
                    };
                    let mount = RawMount {
                        prefix: String::new(),
                        target,
                        middleware: vec![],
                        parent: String::new(),
                        tentative: false,
                        hooks: vec![],
                        passed: vec![(callee.clone(), u32::try_from(i).unwrap_or(0))],
                        calls: vec![],
                    };
                    if !self.l.out.mounts.contains(&mount) {
                        self.l.out.mounts.push(mount);
                    }
                }
            }
            _ => {}
        }
    }
}

impl<'a> Visit<'a> for NodeListeners<'_, '_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && let Expression::CallExpression(c) = peel(init)
            && self.l.creates_node_server(c)
            && let Some(s) = id.symbol_id.get()
        {
            self.servers.insert(s);
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.l.creates_node_server(it) {
            // `createServer(listener)`, `createServer(options, listener)`.
            if let Some(last) = it.arguments.last().and_then(|a| a.as_expression()) {
                self.listener(last);
            }
        } else if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && m.property.name == "on"
            && it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(string_value)
                .as_deref()
                == Some("request")
        {
            let server = match unwrap_expr(&m.object) {
                Expression::Identifier(id) => id
                    .reference_id
                    .get()
                    .and_then(|r| self.l.scoping.get_reference(r).symbol_id())
                    .is_some_and(|s| self.servers.contains(&s)),
                Expression::CallExpression(c) => self.l.creates_node_server(c),
                _ => false,
            };
            if server && let Some(listener) = it.arguments.get(1).and_then(|a| a.as_expression()) {
                self.listener(listener);
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds the chains of calls on a Nest middleware consumer in the statements walked
/// ([`Lowerer::nest_chain`]).
struct NestChains<'l, 's> {
    l: &'l mut Lowerer<'s>,
    consumer: String,
    at: String,
    conditional: bool,
}

impl<'a> Visit<'a> for NestChains<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        // The outermost call of a chain holds the whole of it.
        let mut cur = unwrap_expr(&it.callee);
        let rooted = loop {
            match cur {
                Expression::StaticMemberExpression(m) => cur = unwrap_expr(&m.object),
                Expression::CallExpression(c) => cur = unwrap_expr(&c.callee),
                Expression::Identifier(id) => break id.name.as_str() == self.consumer,
                _ => break false,
            }
        };
        if rooted {
            self.l
                .nest_chain(it, &self.consumer, &self.at, self.conditional);
            return;
        }
        walk::walk_call_expression(self, it);
    }
}

/// Parameter types that are a Nest application.
const NEST_APPLICATIONS: &[&str] = &[
    "INestApplication",
    "NestExpressApplication",
    "NestFastifyApplication",
];

/// Finds the bindings that hold a Nest application: what `NestFactory.create(...)`
/// is bound to, and a parameter typed as one.
struct NestApps<'l, 's> {
    l: &'l Lowerer<'s>,
    apps: BTreeSet<SymbolId>,
}

impl<'a> Visit<'a> for NestApps<'_, '_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && let Expression::CallExpression(c) = peel(init)
            && let Some(r) = self.l.canon_callee(&c.callee)
            && matches!(&r.base, RawBase::Import { spec, name } if spec == "@nestjs/core" && name == "NestFactory")
            && r.member == ".create"
            && let Some(s) = id.symbol_id.get()
        {
            self.apps.insert(s);
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        if let BindingPattern::BindingIdentifier(id) = &it.pattern
            && let Some(TSType::TSTypeReference(r)) =
                it.type_annotation.as_ref().map(|t| &t.type_annotation)
            && let TSTypeName::IdentifierReference(t) = &r.type_name
            && NEST_APPLICATIONS.contains(&t.name.as_str())
            && let Some(s) = id.symbol_id.get()
        {
            self.apps.insert(s);
        }
        walk::walk_formal_parameter(self, it);
    }
}

/// Finds what is registered on the Nest applications of the file ([`NestApps`]).
struct NestUses<'l, 's> {
    l: &'l mut Lowerer<'s>,
    apps: BTreeSet<SymbolId>,
    /// Under a condition or in a loop.
    branches: u32,
}

impl<'a> Visit<'a> for NestUses<'_, '_> {
    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        self.branches += 1;
        walk::walk_if_statement(self, it);
        self.branches -= 1;
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        self.branches += 1;
        walk::walk_conditional_expression(self, it);
        self.branches -= 1;
    }

    fn visit_logical_expression(&mut self, it: &LogicalExpression<'a>) {
        self.branches += 1;
        walk::walk_logical_expression(self, it);
        self.branches -= 1;
    }

    fn visit_for_of_statement(&mut self, it: &ForOfStatement<'a>) {
        self.branches += 1;
        walk::walk_for_of_statement(self, it);
        self.branches -= 1;
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && let Expression::Identifier(id) = unwrap_expr(&m.object)
            && id
                .reference_id
                .get()
                .and_then(|r| self.l.scoping.get_reference(r).symbol_id())
                .is_some_and(|s| self.apps.contains(&s))
        {
            match m.property.name.as_str() {
                "setGlobalPrefix" | "enableVersioning" => self.l.out.nest_prefixed = true,
                "use" => {
                    let at = format!("{}.use", id.name);
                    let mut apply = RawNestApply {
                        unread: self.branches > 0,
                        at: at.clone(),
                        ..RawNestApply::default()
                    };
                    let mut args = it.arguments.iter().peekable();
                    // `app.use("/api", mw)`: for the paths under it.
                    let path = args
                        .peek()
                        .and_then(|a| a.as_expression())
                        .and_then(string_value);
                    if path.is_some() {
                        args.next();
                    }
                    apply.routes.push(RawNestRoute::Path {
                        path: path.unwrap_or_else(|| "*".to_string()),
                        method: String::new(),
                    });
                    for a in args {
                        match a.as_expression() {
                            Some(x) => match self.l.nest_middleware_ref(x, &at) {
                                Some(r) => apply.middleware.push(r),
                                None => apply.unread = true,
                            },
                            None => apply.unread = true,
                        }
                    }
                    if !apply.middleware.is_empty() || apply.unread {
                        self.l.out.nest_applies.push(apply);
                    }
                    return;
                }
                _ => {}
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// The middleware given for the path `pattern` runs for the route `path`: no pattern,
/// `*`, the path itself, or a prefix of it at a segment boundary (`/api`, `/api/*`).
/// [STRICT]: a pattern with a parameter or a wildcard elsewhere is taken to cover the
/// route (it may), and so is a route whose own path is not read.
/// Fastify plugins of packages that add no hook that turns callers away: they
/// decorate the instance, parse, compress or document. Any other package's plugin
/// may guard the routes of the instance it is registered on.
const FASTIFY_PLAIN_PLUGINS: &[&str] = &[
    "@fastify/jwt",
    "@fastify/auth",
    "@fastify/basic-auth",
    "@fastify/cors",
    "@fastify/helmet",
    "@fastify/cookie",
    "@fastify/session",
    "@fastify/secure-session",
    "@fastify/formbody",
    "@fastify/multipart",
    "@fastify/static",
    "@fastify/swagger",
    "@fastify/swagger-ui",
    "@fastify/sensible",
    "@fastify/rate-limit",
    "@fastify/compress",
    "@fastify/websocket",
    "@fastify/env",
    "@fastify/etag",
    "@fastify/postgres",
    "@fastify/redis",
    "@fastify/mongodb",
    "@fastify/view",
    "@fastify/caching",
    "@fastify/under-pressure",
    "@fastify/request-context",
    "@fastify/type-provider-typebox",
    "fastify-type-provider-zod",
    "fastify-plugin",
];

/// The Express path has the parameter `name`: a segment `:name`, with or without a
/// pattern or a modifier after it (`:id(\\d+)`, `:id?`).
pub(super) fn has_param(path: &str, name: &str) -> bool {
    path.split('/').any(|seg| {
        seg.strip_prefix(':')
            .and_then(|s| s.strip_prefix(name))
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(['(', '?', '*', '+', '.', '-']))
    })
}

thread_local! {
    /// The file is being lowered as the last measured build listed it
    /// ([`crate::lower::RawFile::measured`]).
    static AS_MEASURED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// The lowering met a listing the last measured build did not make.
    static NEW_LISTING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Lowers what follows as the last measured build listed it, or as now.
pub(super) fn as_measured(on: bool) {
    AS_MEASURED.set(on);
}

/// Whether the file is being lowered as the last measured build listed it.
fn lowering_as_measured() -> bool {
    AS_MEASURED.get()
}

/// Whether the lowering since the last call met a listing the last measured build
/// did not make.
pub(super) fn take_new_listing() -> bool {
    NEW_LISTING.replace(false)
}

/// Notes a listing the last measured build did not make: a router with a base
/// path, a registration at several paths. True where the file is being lowered as
/// that build listed it, which did not read them.
pub(crate) fn unmeasured_listing() -> bool {
    NEW_LISTING.set(true);
    AS_MEASURED.get()
}

/// The path a router is based at: `/api` of `new Hono().basePath("/api")`, `?` where
/// what it is given is no literal; none for a router with no base.
pub(super) fn base_path(init: &Expression) -> Option<String> {
    let Expression::CallExpression(c) = unwrap_expr(init) else {
        return None;
    };
    let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
        return None;
    };
    if m.property.name != "basePath" || unmeasured_listing() {
        return None;
    }
    let own = c
        .arguments
        .first()
        .and_then(|a| a.as_expression())
        .and_then(route_text)
        .unwrap_or_else(|| "?".to_string());
    Some(match base_path(&m.object) {
        Some(outer) => join_path(&[&outer, &own]),
        None => own,
    })
}

/// The paths a registration is given: one for a literal, each for an array of
/// literals (`app.use(["/a", "/b"], router)`, `app.get(["/p", "/q"], handler)`);
/// none for anything else.
fn listed_paths(e: &Expression) -> Vec<String> {
    match unwrap_expr(e) {
        Expression::ArrayExpression(a) if !a.elements.is_empty() => {
            let paths: Vec<String> = a
                .elements
                .iter()
                .filter_map(|el| el.as_expression().and_then(route_text))
                .collect();
            if paths.len() == a.elements.len() && !unmeasured_listing() {
                paths
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

/// The functions written in place in `e`, a value where a guard goes: itself, or the
/// elements of an array.
pub(super) fn in_place_functions<'b, 'a>(e: &'b Expression<'a>) -> Vec<&'b Expression<'a>> {
    match unwrap_expr(e) {
        f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => vec![f],
        Expression::ArrayExpression(a) => a
            .elements
            .iter()
            .filter_map(|el| el.as_expression())
            .flat_map(in_place_functions)
            .collect(),
        _ => Vec::new(),
    }
}

/// What a value written where a guard goes holds beyond the references the measured
/// reading takes ([`Lowerer::guard_position`]).
#[derive(Debug, Clone, Default)]
pub(super) struct GuardPosition {
    /// The calls, with their shapes ([`RawSymbol::guard_calls`]).
    pub calls: Vec<RawGuardCall>,
    /// What has no name: each as [`RawSymbol::app_unread`] says it.
    pub unread: Vec<String>,
    /// The members of a Fastify instance: what the measured reading named each by
    /// (`app.auth` of a binding of the module; nothing for a parameter's), and the
    /// decorator it is ([`Lowerer::fastify_member`]).
    pub members: Vec<(Option<RawRef>, RawRef)>,
}

/// Ends the callee of a [`RawSymbol::app_passed`] entry that is a Fastify plugin the
/// instance was registered with (`app.register(authPlugin)`), not a function it was
/// handed to.
pub(crate) const PLUGIN_PASSED: &str = "(plugin)";

/// A specifier that names a package, not a file of the repository.
fn bare_specifier(spec: &str) -> bool {
    !(spec.starts_with('.')
        || spec.starts_with('/')
        || spec.starts_with("@/")
        || spec.starts_with("~/")
        || spec.starts_with('#'))
}

/// What is spread, for saying so: the name, or "an expression".
fn spread_name(e: &Expression) -> String {
    match unwrap_expr(e) {
        Expression::Identifier(id) => id.name.to_string(),
        Expression::StaticMemberExpression(m) => m.property.name.to_string(),
        _ => "an expression".to_string(),
    }
}

impl Lowerer<'_> {
    /// Remembers what an object literal bound with `const` gives a Fastify route it
    /// is spread into ([`Lowerer::route_options`]).
    pub(super) fn note_route_options(&mut self, name: &str, init: &Expression) {
        let Expression::ObjectExpression(o) = unwrap_expr(init) else {
            self.route_options.remove(name);
            return;
        };
        let read = o.properties.iter().all(|p| match p {
            ObjectPropertyKind::ObjectProperty(p) => !p.computed && key_name(&p.key).is_some(),
            ObjectPropertyKind::SpreadProperty(_) => false,
        });
        let hooks = read.then(|| {
            FASTIFY_HOOKS
                .iter()
                .filter_map(|hook| {
                    let mut refs = Vec::new();
                    let value = object_prop(o, hook)?;
                    self.collect_middleware(value, &mut refs);
                    let mut position = GuardPosition::default();
                    self.guard_position(value, &mut position);
                    // A function written in the object is not a function of its
                    // own where the object is spread.
                    if !in_place_functions(value).is_empty() {
                        position
                            .unread
                            .push("a hook written in the options that are spread".to_string());
                    }
                    Some((hook.to_string(), refs, position))
                })
                .collect()
        });
        self.route_options.insert(name.to_string(), hooks);
    }

    /// The object a spread names, where it is one the module read to the end
    /// ([`Lowerer::route_options`]).
    fn spread_read(&self, e: &Expression) -> Option<&HookSets> {
        match unwrap_expr(e) {
            Expression::Identifier(id) => self.route_options.get(id.name.as_str())?.as_ref(),
            _ => None,
        }
    }

    /// A route's options, read in order, as JavaScript builds the object: for each
    /// hook the last writer wins. A property of the hook's own name written last is
    /// the hook, whatever was spread before it; an object spread after it that is
    /// a literal of the module read to the end ([`Lowerer::route_options`])
    /// replaces it where it names the hook, and leaves it where it does not; any
    /// other spread after it, and a computed key, leaves the hook unread
    /// ([`RawSymbol::app_unread`], returned). `{ onRequest: authenticate,
    /// onRequest: undefined }` has no hook.
    ///
    /// The route's wraps hold what the first property of each hook names, as the
    /// measured build read it. Where the ordered reading differs, the listed
    /// reading drops those ([`RawSymbol::listed_unwraps`]) and takes what the last
    /// writer names as a hook beside the route ([`RawSymbol::app_middleware`]).
    fn ordered_options(&self, o: &ObjectExpression, sym: &mut RawSymbol) -> Vec<String> {
        enum Last {
            Named(Vec<RawRef>, GuardPosition),
            Unread(String),
        }
        let mut unread = Vec::new();
        for hook in FASTIFY_HOOKS {
            let mut last: Option<Last> = None;
            let mut measured: Option<Vec<RawRef>> = None;
            for p in &o.properties {
                match p {
                    ObjectPropertyKind::ObjectProperty(p) if p.computed => {
                        last = Some(Last::Unread(
                            "a computed key of the route options".to_string(),
                        ));
                    }
                    ObjectPropertyKind::ObjectProperty(p)
                        if key_name(&p.key).as_deref() == Some(hook) =>
                    {
                        let mut refs = Vec::new();
                        self.collect_middleware(&p.value, &mut refs);
                        measured.get_or_insert_with(|| refs.clone());
                        // `onRequest: undefined`: no hook.
                        refs.retain(|r| !matches!(&r.base, RawBase::Global(n) if n == "undefined"));
                        let mut position = GuardPosition::default();
                        self.guard_position(&p.value, &mut position);
                        last = Some(Last::Named(refs, position));
                    }
                    ObjectPropertyKind::ObjectProperty(_) => {}
                    ObjectPropertyKind::SpreadProperty(s) => match self.spread_read(&s.argument) {
                        Some(hooks) => {
                            if let Some((_, refs, position)) =
                                hooks.iter().find(|(k, _, _)| k == hook)
                            {
                                last = Some(Last::Named(refs.clone(), position.clone()));
                            }
                        }
                        None => {
                            last = Some(Last::Unread(format!(
                                "route options spread from {}",
                                spread_name(&s.argument)
                            )));
                        }
                    },
                }
            }
            let measured = measured.unwrap_or_default();
            let kept = match last {
                // The hook the last writer names, with what it holds for the
                // readings that list: its calls, what has no name, and a member
                // of a Fastify instance as the decorator it is.
                Some(Last::Named(mut refs, position)) => {
                    for how in position.unread {
                        if !unread.contains(&how) {
                            unread.push(how);
                        }
                    }
                    for c in position.calls {
                        if !sym.guard_calls.contains(&c) {
                            sym.guard_calls.push(c);
                        }
                    }
                    for (named, member) in position.members {
                        if let Some(n) = named {
                            refs.retain(|r| *r != n);
                        }
                        if !refs.contains(&member) {
                            refs.push(member);
                        }
                    }
                    refs
                }
                Some(Last::Unread(how)) => {
                    if !unread.contains(&how) {
                        unread.push(how);
                    }
                    Vec::new()
                }
                None => Vec::new(),
            };
            for m in &measured {
                if !kept.contains(m) && !sym.listed_unwraps.contains(m) {
                    sym.listed_unwraps.push(m.clone());
                }
            }
            for r in kept {
                if !measured.contains(&r) && !sym.app_middleware.contains(&r) {
                    sym.app_middleware.push(r);
                }
            }
        }
        unread
    }
}

fn path_covers(pattern: &str, path: &str) -> bool {
    let p = pattern.trim_end_matches('*').trim_end_matches('/');
    if p.is_empty() || p.contains(['*', ':', '(', '?']) || path.contains('?') {
        return true;
    }
    path == p
        || path
            .strip_prefix(p)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Whether what is given for `pattern` runs for the route at `path`: yes, no, or not
/// read (`None`: a pattern with a parameter or a wildcard inside it, a path that is
/// not a literal). Such a pattern is still read to say no where a segment written
/// out in it differs from the path's at the same place ([`apart`]).
fn covers(pattern: &str, path: &str) -> Option<bool> {
    let p = pattern.trim_end_matches('*').trim_end_matches('/');
    if p.is_empty() {
        return Some(true);
    }
    if p.contains(['*', ':', '(', '?']) || path.contains('?') {
        return apart(p, path).then_some(false);
    }
    Some(path_covers(pattern, path))
}

/// Whether what a router was given for `pattern` runs for the route at `route`,
/// which the router serves through something else ([`covers`]).
pub(crate) fn hook_covers(pattern: &str, route: &str) -> Option<bool> {
    covers(pattern, route)
}

/// Whether what is given for `pattern` runs for the routes of a router mounted at
/// `prefix` ([`covers`]): a pattern that does not take the prefix but goes on under
/// it (`/api/admin` beside a mount at `/api`, `/api` beside one with no path) may
/// run for some of them, unless a segment written out sets the two apart.
fn covers_mount(pattern: &str, prefix: &str) -> Option<bool> {
    match covers(pattern, prefix) {
        Some(false) if !apart(pattern.trim_end_matches('*'), prefix) => None,
        c => c,
    }
}

/// The text a segment of a path pattern begins with, where something that is not
/// text follows it: `ftp` of `ftp(?!x)`, `v` of `v:version`. Not the character a
/// quantifier applies to (`ftp` of `ftps?`), and nothing where the segment begins
/// with what is not text.
fn leading_text(segment: &str) -> Option<&str> {
    let end = segment.find([':', '*', '(', ')', '?', '+', '{', '}', '[', ']'])?;
    let quantified = segment[end..].starts_with(['?', '*', '+', '{']);
    let lead = match quantified {
        true => {
            let last = segment[..end].chars().next_back()?;
            &segment[..end - last.len_utf8()]
        }
        false => &segment[..end],
    };
    (!lead.is_empty()).then_some(lead)
}

/// Whether `pattern` can never take `path`: a segment written out in both differs
/// (`/orgs/:id/admin` and `/public/health`; letter case aside, as Express compares).
/// Segments are compared in step for as long as each is one segment of a URL on
/// both sides: text, or a plain parameter (`:id`). Past a wildcard, an optional or
/// a constrained parameter nothing is said, nor for an empty path (the root, or a
/// router mounted with no path, whose routes may be any).
fn apart(pattern: &str, path: &str) -> bool {
    let text = |s: &str| !s.contains([':', '*', '(', ')', '?', '+', '{', '}', '[', ']']);
    let one = |s: &str| {
        text(s)
            || s.strip_prefix(':').is_some_and(|n| {
                !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            })
    };
    let (pattern, path) = (pattern.trim_start_matches('/'), path.trim_matches('/'));
    if path.is_empty() {
        return false;
    }
    for (a, b) in pattern.split('/').zip(path.split('/')) {
        if !one(a) || !one(b) {
            // The text a segment of the pattern begins with, before a group or a
            // parameter (`ftp` of `ftp(?!/quarantine)`), is text the path has there
            // too: `/rest/user/login` is never under `/ftp(?!/quarantine)/:file`.
            // Read since the measured build.
            return text(b)
                && leading_text(a).is_some_and(|lead| {
                    !b.get(..lead.len())
                        .is_some_and(|start| start.eq_ignore_ascii_case(lead))
                })
                && !unmeasured_listing();
        }
        if text(a) && text(b) && !a.eq_ignore_ascii_case(b) {
            return true;
        }
    }
    false
}

/// Finds Fastify full-form routes and prefixed plugin registrations anywhere.
struct FastifyFinder<'l, 's> {
    l: &'l Lowerer<'s>,
    routes: Vec<(String, String, u32, RawSymbol)>,
    mounts: Vec<RawMount>,
    /// Prefixes of the inline plugins being walked
    /// (`server.register(async (s) => { ... }, { prefix: "/api/v1" })`), outermost first.
    prefix: Vec<String>,
}

impl<'a> Visit<'a> for FastifyFinder<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) {
            let prop = m.property.name.as_str();
            let first = it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .map(unwrap_expr);
            match (prop, first) {
                // The full declaration form is specific to Fastify: an object with method + url + handler.
                ("route", Some(Expression::ObjectExpression(o)))
                    if object_prop(o, "url").is_some()
                        && object_prop(o, "method").is_some()
                        && object_prop(o, "handler").is_some() =>
                {
                    let mut url = object_prop(o, "url")
                        .and_then(route_text)
                        .unwrap_or_else(|| "?".into());
                    // The path on the instance, where what it was given for a path is
                    // matched ([`Lowerer::hooks_covering`]).
                    let own = url.clone();
                    if !self.prefix.is_empty() {
                        let mut parts: Vec<&str> = self.prefix.iter().map(String::as_str).collect();
                        parts.push(&url);
                        url = join_path(&parts);
                    }
                    let methods: Vec<String> = match object_prop(o, "method").map(unwrap_expr) {
                        Some(Expression::ArrayExpression(a)) => a
                            .elements
                            .iter()
                            .filter_map(|e| e.as_expression())
                            .filter_map(string_value)
                            .collect(),
                        Some(x) => string_value(x).into_iter().collect(),
                        None => vec![],
                    };
                    let line = self.l.line_of(it.span.start);
                    let mut base = RawSymbol::empty("", SymbolKind::Function, line);
                    for hook in FASTIFY_HOOKS {
                        if let Some(v) = object_prop(o, hook) {
                            let mut refs = Vec::new();
                            self.l.collect_middleware(v, &mut refs);
                            base.wraps
                                .extend(refs.into_iter().map(|r| (r, WrapKind::Call)));
                        }
                    }
                    self.l.fastify_schema_inputs(o, &mut base.inputs);
                    self.l.handler_facts(object_prop(o, "handler"), &mut base);
                    base.app_unread = self.l.ordered_options(o, &mut base);
                    // A hook written in place in a route declared in full is not
                    // read as a function of its own.
                    if FASTIFY_HOOKS.iter().any(|hook| {
                        object_prop(o, hook).is_some_and(|v| !in_place_functions(v).is_empty())
                    }) {
                        base.app_unread
                            .push("a hook written in the route's declaration".to_string());
                    }
                    // The hooks of the instance run for a route declared in full as
                    // for one declared in short ([`Lowerer::finish`]).
                    if let Expression::Identifier(id) = unwrap_expr(&m.object)
                        && self.l.router_adapter.get(id.name.as_str()).copied() == Some("fastify")
                    {
                        self.l.hooks_covering(id.name.as_str(), &own, &mut base);
                        for c in self.l.calls_covering(id.name.as_str(), &own) {
                            if !base.guard_calls.contains(&c) {
                                base.guard_calls.push(c);
                            }
                        }
                        base.app_passed = self
                            .l
                            .passed
                            .get(id.name.as_str())
                            .cloned()
                            .unwrap_or_default();
                    }
                    for m in methods {
                        self.routes
                            .push((m.to_ascii_uppercase(), url.clone(), line, base.clone()));
                    }
                }
                // `register(plugin, { prefix: "/v1" })`, inside any inline plugins'
                // prefixes; an inline plugin's own registrations and routes take its prefix.
                ("register", Some(plugin)) => {
                    let own = match it
                        .arguments
                        .get(1)
                        .and_then(|a| a.as_expression())
                        .map(unwrap_expr)
                    {
                        Some(Expression::ObjectExpression(o)) => {
                            object_prop(o, "prefix").and_then(route_text)
                        }
                        _ => None,
                    };
                    if matches!(
                        plugin,
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) {
                        self.prefix.push(own.unwrap_or_default());
                        self.visit_expression(plugin);
                        self.prefix.pop();
                        return;
                    }
                    if (own.is_some() || !self.prefix.is_empty())
                        && let Some(target) = self.l.canon(plugin)
                    {
                        let mut parts: Vec<&str> = self.prefix.iter().map(String::as_str).collect();
                        if let Some(p) = &own {
                            parts.push(p);
                        }
                        self.mounts.push(RawMount {
                            prefix: join_path(&parts),
                            target,
                            middleware: vec![],
                            parent: String::new(),
                            tentative: false,
                            hooks: vec![],
                            passed: vec![],
                            calls: vec![],
                        });
                    }
                }
                _ => {}
            }
        }
        walk::walk_call_expression(self, it);
    }
}

// ---------------------------------------------------------------------- tRPC, GraphQL, jobs

/// A tRPC procedure chain: `base.use(mw).input(schema).query(handler)`.
pub(super) struct Procedure<'b, 'a> {
    pub kind: &'static str,
    pub base: RawRef,
    pub uses: Vec<RawRef>,
    pub has_input: bool,
    /// What `.input(s)` and `.output(s)` are given, when it has a canonical name.
    pub input: Vec<RawRef>,
    pub output: Option<RawRef>,
    pub handler: Option<&'b Expression<'a>>,
    /// What the chain's `.use(...)` steps hold for the readings that list
    /// ([`Lowerer::guard_position`]); a middleware written in place is not read.
    pub position: GuardPosition,
    /// Neither a builder step (`.input()`, `.use()`) nor the builder's name
    /// (`authedProcedure`) shows the chain is tRPC: `api.query(fn)` is a procedure only
    /// when `base` is proven to be built from a tRPC instance's `.procedure`
    /// ([`RawTrpc::candidates`](crate::lower::RawTrpc::candidates)).
    pub by_origin: bool,
}

/// The steps a tRPC procedure builder takes and stays one: `t.procedure.use(mw)`,
/// `.input(s)`, `.output(s)`, `.meta(m)`, `.concat(p)`.
const PROCEDURE_STEPS: &[&str] = &[
    "input",
    "use",
    "output",
    "meta",
    "concat",
    "unstable_concat",
];
/// The steps that configure `initTRPC` before `.create()` makes an instance.
const INIT_STEPS: &[&str] = &["context", "meta"];

/// NestJS parameter decorators that bind request input to a handler argument.
const NEST_INPUT_DECORATORS: &[&str] = &[
    "Body",
    "Query",
    "Param",
    "Args",
    "Payload",
    "UploadedFile",
    "UploadedFiles",
];

/// NestJS method decorators that make a method an entry point: (package, decorator, kind, method label).
const NEST_ENTRY: &[(&str, &str, &str, &str)] = &[
    ("@nestjs/graphql", "Query", "graphql", "QUERY"),
    ("@nestjs/graphql", "Mutation", "graphql", "MUTATION"),
    ("@nestjs/graphql", "Subscription", "graphql", "SUBSCRIPTION"),
    ("@nestjs/graphql", "ResolveField", "graphql", "FIELD"),
    ("@nestjs/schedule", "Cron", "cron", "CRON"),
    ("@nestjs/schedule", "Interval", "cron", "INTERVAL"),
    ("@nestjs/schedule", "Timeout", "cron", "TIMEOUT"),
    ("@nestjs/bull", "Process", "job", "JOB"),
    ("@nestjs/bullmq", "Process", "job", "JOB"),
    (
        "@nestjs/microservices",
        "MessagePattern",
        "message",
        "MESSAGE",
    ),
    ("@nestjs/microservices", "EventPattern", "message", "EVENT"),
];
/// Class decorators that only mark a class as a container of entry points.
const NEST_CONTAINERS: &[(&str, &str)] = &[
    ("@nestjs/graphql", "Resolver"),
    ("@nestjs/bull", "Processor"),
    ("@nestjs/bullmq", "Processor"),
];

impl<'s> Lowerer<'s> {
    pub(super) fn procedure_chain<'b, 'a>(
        &self,
        e: &'b Expression<'a>,
    ) -> Option<Procedure<'b, 'a>> {
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return None;
        };
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return None;
        };
        let kind = match m.property.name.as_str() {
            "query" => "QUERY",
            "mutation" => "MUTATION",
            "subscription" => "SUBSCRIPTION",
            _ => return None,
        };
        let handler = c.arguments.first().and_then(|a| a.as_expression());
        // Walk `.input()`, `.output()`, `.use()`, `.meta()` back to the base procedure.
        let mut uses = Vec::new();
        let mut position = GuardPosition::default();
        let mut has_input = false;
        let mut input = Vec::new();
        let mut output = None;
        let mut cur = unwrap_expr(&m.object);
        let mut links = 0;
        loop {
            match cur {
                Expression::CallExpression(inner) => {
                    let im = match unwrap_expr(&inner.callee) {
                        Expression::StaticMemberExpression(im)
                            if PROCEDURE_STEPS.contains(&im.property.name.as_str()) =>
                        {
                            im
                        }
                        // `createTeamPbacProcedure("team.read").query(...)`: whatever its
                        // name, a function's result is a builder only when the function
                        // is proven to return one.
                        _ => {
                            let base = self.factory_call(inner)?;
                            uses.reverse();
                            return Some(Procedure {
                                kind,
                                base,
                                uses,
                                has_input,
                                input,
                                output,
                                handler,
                                position,
                                by_origin: true,
                            });
                        }
                    };
                    let arg = inner
                        .arguments
                        .first()
                        .and_then(|a| a.as_expression())
                        .and_then(|x| self.canon(x))
                        .filter(|r| !matches!(r.base, RawBase::Global(_)));
                    match im.property.name.as_str() {
                        "input" => {
                            has_input = true;
                            input.extend(arg);
                        }
                        "output" => output = output.take().or(arg),
                        "use" => {
                            if let Some(mw) = inner
                                .arguments
                                .first()
                                .and_then(|a| a.as_expression())
                                .and_then(|x| self.middleware_ref(x))
                            {
                                uses.push(mw);
                            }
                            // Whatever the step is given may be the guard: what has
                            // no name, and a function written in place, are not read.
                            if let Some(a) = inner.arguments.first() {
                                match a.as_expression() {
                                    Some(x) => {
                                        self.guard_position(x, &mut position);
                                        if !in_place_functions(x).is_empty() {
                                            position.unread.push(
                                                "a middleware written in the procedure's chain"
                                                    .to_string(),
                                            );
                                        }
                                    }
                                    None => position
                                        .unread
                                        .push("a middleware spread into .use()".to_string()),
                                }
                            }
                        }
                        _ => {}
                    }
                    cur = unwrap_expr(&im.object);
                    links += 1;
                }
                base @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => {
                    // The name the chain is written with: the local binding, which is the
                    // builder's name even when the import is `default`
                    // (`import authedProcedure from "./authedProcedure"`), or the last
                    // member (`t.procedure`, `procedures.authedProcedure`).
                    let written = match base {
                        Expression::Identifier(i) => i.name.as_str(),
                        Expression::StaticMemberExpression(m) => m.property.name.as_str(),
                        _ => "",
                    };
                    let base = self.canon(base)?;
                    let is_builder = |n: &str| n.to_ascii_lowercase().ends_with("procedure");
                    // Plain `x.query()` with no builder links is too generic to be tRPC
                    // by itself: only `x`'s proven origin can make it a procedure.
                    let by_origin = links == 0
                        && !is_builder(written)
                        && !matches!(&base.base, RawBase::Import { name, .. } | RawBase::Local(name) if is_builder(name));
                    // A global (`fetch.query()`) has no origin to prove.
                    if by_origin && matches!(base.base, RawBase::Global(_)) {
                        return None;
                    }
                    uses.reverse();
                    return Some(Procedure {
                        kind,
                        base,
                        uses,
                        has_input,
                        input,
                        output,
                        handler,
                        position,
                        by_origin,
                    });
                }
                _ => return None,
            }
        }
    }

    /// The symbol of a tRPC procedure: wrapped by its builder and the middleware its
    /// chain adds, validating when it declares input, with its handler's facts.
    fn procedure_symbol(&self, p: &Procedure, line: u32) -> RawSymbol {
        let mut sym = RawSymbol::empty("", SymbolKind::Function, line);
        // A builder a function returns is wrapped by that function
        // (`createTeamPbacProcedure`), not by its result.
        let mut base = p.base.clone();
        if let Some(callee) = base.member.strip_suffix("()") {
            base.member = callee.to_string();
        }
        sym.wraps.push((base, WrapKind::Call));
        for u in &p.uses {
            sym.wraps.push((u.clone(), WrapKind::Call));
        }
        if p.has_input {
            sym.controls.push("validates".into());
        }
        sym.inputs.extend(p.input.iter().cloned());
        if let Some(model) = &p.output {
            sym.responses.push(RawResponse {
                status: 0,
                via: drift_core::ResponseVia::Declared,
                builder: None,
                model: Some(model.clone()),
                keys: vec![],
                in_catch: false,
            });
        }
        self.handler_facts(p.handler, &mut sym);
        sym.app_unread.extend(p.position.unread.iter().cloned());
        for c in &p.position.calls {
            if !sym.guard_calls.contains(c) {
                sym.guard_calls.push(c.clone());
            }
        }
        sym
    }

    /// Lower a tRPC procedure bound to `name`. One only its builder's origin can prove
    /// is kept aside for the linker, and `name` is lowered as an ordinary value too.
    /// Returns false then.
    pub(super) fn lower_trpc_procedure(&mut self, name: &str, p: Procedure, start: u32) -> bool {
        let mut sym = self.procedure_symbol(&p, self.line_of(start));
        sym.name = name.to_string();
        let entry = drift_core::EntryPoint {
            symbol: name.to_string(),
            kind: "rpc".into(),
            method: Some(p.kind.into()),
            route: Some(name.to_string()),
            adapter: "trpc".into(),
        };
        if p.by_origin {
            self.out.trpc.candidates.push(RawCandidate {
                base: p.base,
                symbol: sym,
                entry,
                replaces: true,
            });
            return false;
        }
        self.push_symbol(sym);
        self.out.entry_points.push(entry);
        true
    }

    /// The reference a top-level `const` (or `export default`) value is a procedure
    /// builder of, if it is one at all: a reference followed by procedure-builder steps
    /// only (`t.procedure.use(mw).meta(m)` -> `t.procedure`, `authed` -> `authed`).
    /// Whether that reference is a builder is for the linker to prove.
    pub(super) fn builder_origin(&self, init: &Expression) -> Option<RawRef> {
        let mut cur = unwrap_expr(init);
        while let Expression::CallExpression(c) = cur {
            match unwrap_expr(&c.callee) {
                Expression::StaticMemberExpression(m)
                    if PROCEDURE_STEPS.contains(&m.property.name.as_str()) =>
                {
                    cur = unwrap_expr(&m.object);
                }
                // `createTeamPbacProcedure("team.read").use(mw)`: what the function returns.
                _ => return self.factory_call(c),
            }
        }
        if !matches!(
            cur,
            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
        ) {
            return None;
        }
        // A global (`window.api`) has no origin to prove.
        self.canon(cur)
            .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }))
    }

    /// The result of calling a named function (`createTeamPbacProcedure("team.read")`,
    /// `procedures.make()`) as a reference ending in `()`: a procedure builder only when
    /// the function is proven to return one on every path
    /// ([`RawTrpc::factories`](crate::lower::RawTrpc::factories)).
    /// A global has no origin. (An optional call, `make?.()`, is a chain expression,
    /// which neither a procedure chain nor a builder is read through.)
    pub(super) fn factory_call(&self, c: &CallExpression) -> Option<RawRef> {
        if !matches!(
            unwrap_expr(&c.callee),
            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
        ) {
            return None;
        }
        let mut r = self
            .canon(&c.callee)
            .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }))?;
        r.member.push_str("()");
        Some(r)
    }

    /// True when `init` makes a tRPC instance: `initTRPC.create(opts)`, configured
    /// first or not (`initTRPC.context<C>().meta<M>().create()`), with `initTRPC`
    /// imported from `@trpc/server`.
    pub(super) fn is_trpc_instance(&self, init: &Expression) -> bool {
        let Expression::CallExpression(c) = unwrap_expr(init) else {
            return false;
        };
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return false;
        };
        if m.property.name != "create" {
            return false;
        }
        let mut cur = unwrap_expr(&m.object);
        while let Expression::CallExpression(c) = cur {
            let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                return false;
            };
            if !INIT_STEPS.contains(&m.property.name.as_str()) || !c.arguments.is_empty() {
                return false;
            }
            cur = unwrap_expr(&m.object);
        }
        matches!(
            self.canon(cur),
            Some(RawRef { base: RawBase::Import { spec, name }, member })
                if member.is_empty()
                    && name == "initTRPC"
                    && (spec == "@trpc/server" || spec.starts_with("@trpc/server/"))
        )
    }

    /// Inline procedures in `router({ key: proc.query(...) })` and job registrations, anywhere.
    pub(super) fn lower_rpc_and_jobs_anywhere(&mut self, program: &Program) {
        let mut f = EntryFinder {
            l: self,
            found: Vec::new(),
            models: Vec::new(),
            candidates: Vec::new(),
        };
        f.visit_program(program);
        let (found, models, candidates) = (f.found, f.models, f.candidates);
        self.out.models.extend(models);
        for (kind, method, route, adapter, line, mut sym) in found {
            let label = method.clone().unwrap_or_else(|| kind.to_ascii_uppercase());
            let name = self.unique_route_name(&label, &route);
            sym.name = name.clone();
            sym.line = line;
            self.push_symbol(sym);
            self.out.entry_points.push(drift_core::EntryPoint {
                symbol: name,
                kind,
                method,
                route: Some(route),
                adapter,
            });
        }
        // Named after every other symbol, so a procedure that is not proven changes no
        // other symbol's name.
        for (base, kind, route, line, mut sym) in candidates {
            let taken = |name: &str| {
                self.out.symbols.iter().any(|s| s.name == name)
                    || self
                        .out
                        .trpc
                        .candidates
                        .iter()
                        .any(|c| c.symbol.name == name)
            };
            let mut name = format!("{kind} {route}");
            let mut n = 2;
            while taken(&name) {
                name = format!("{kind} {route} #{n}");
                n += 1;
            }
            sym.name = name.clone();
            sym.line = line;
            self.out.trpc.candidates.push(RawCandidate {
                base,
                symbol: sym,
                entry: drift_core::EntryPoint {
                    symbol: name,
                    kind: "rpc".into(),
                    method: Some(kind.into()),
                    route: Some(route),
                    adapter: "trpc".into(),
                },
                replaces: false,
            });
        }
    }

    /// What a NestJS handler reads of its request: input when an argument is bound to
    /// it (`@Body()`, `@Query()`, `@Param()`, GraphQL `@Args()`, a microservice's
    /// `@Payload()`, uploaded files), none when it takes no argument, and otherwise
    /// (`@Req() req`, `@Ctx()`) Drift cannot tell.
    fn nest_input(&self, m: &MethodDefinition) -> input::InputUse {
        let params = &m.value.params;
        if params.items.is_empty() && params.rest.is_none() {
            return input::InputUse::None;
        }
        let bound = params.items.iter().any(|p| {
            p.decorators.iter().any(|d| {
                matches!(
                    self.decorator_ref(d),
                    Some(RawRef { base: RawBase::Import { spec, name }, member })
                        if member.is_empty()
                            && spec.starts_with("@nestjs/")
                            && NEST_INPUT_DECORATORS.contains(&name.as_str())
                )
            })
        });
        if bound {
            input::InputUse::Reads
        } else {
            input::InputUse::Unknown
        }
    }

    /// What a NestJS handler's decorators say for the practice facts: the DTO types of
    /// `@Body()` / `@Query()` / `@Param()` / `@Args()` parameters (inputs), `@Headers("x")`
    /// (headers), `@HttpCode(n)` and Swagger `@ApiOkResponse({ type })` /
    /// `@ApiResponse({ status, type })` (declared responses).
    fn nest_method_facts(&self, m: &MethodDefinition, sym: &mut RawSymbol) {
        let nest = |d: &Decorator| match self.decorator_ref(d) {
            Some(RawRef {
                base: RawBase::Import { spec, name },
                member,
            }) if member.is_empty() && spec.starts_with("@nestjs/") => Some(name),
            _ => None,
        };
        fn first_arg<'b, 'a>(d: &'b Decorator<'a>) -> Option<&'b Expression<'a>> {
            match unwrap_expr(&d.expression) {
                Expression::CallExpression(c) => c
                    .arguments
                    .first()
                    .and_then(|a| a.as_expression())
                    .map(unwrap_expr),
                _ => None,
            }
        }
        for p in &m.value.params.items {
            for d in &p.decorators {
                match nest(d).as_deref() {
                    Some("Body" | "Query" | "Param" | "Args" | "Payload") => {
                        if let Some(t) = &p.type_annotation
                            && let TSType::TSTypeReference(r) = &t.type_annotation
                            && let TSTypeName::IdentifierReference(id) = &r.type_name
                            && let Some(base) = self.resolve_ident(id)
                            && !matches!(base, RawBase::Global(_))
                        {
                            sym.inputs.push(RawRef {
                                base,
                                member: String::new(),
                            });
                        }
                        // Each pipe the decorator is handed (`@Param("id",
                        // ParseIntPipe)`, `@Body(new ValidationPipe())`): the
                        // framework runs it on the value before the handler
                        // ([`drift_core::controls::PIPES_INPUT`], listed reading).
                        if let Expression::CallExpression(c) = unwrap_expr(&d.expression) {
                            for a in c.arguments.iter().filter_map(|a| a.as_expression()) {
                                let pipe = match unwrap_expr(a) {
                                    Expression::NewExpression(n) => self.canon(&n.callee),
                                    e @ (Expression::Identifier(_)
                                    | Expression::StaticMemberExpression(_)) => self.canon(e),
                                    _ => None,
                                };
                                if let Some(p) =
                                    pipe.filter(|r| !matches!(r.base, RawBase::Global(_)))
                                {
                                    sym.listed_refs.push((
                                        drift_core::controls::PIPES_INPUT.to_string(),
                                        vec![p],
                                    ));
                                }
                            }
                        }
                    }
                    Some("Headers") => {
                        if let Some(Expression::StringLiteral(l)) = first_arg(d) {
                            let h = lit(l).to_ascii_lowercase();
                            if drift_core::practice::valid_header(&h) {
                                sym.headers.push(h);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        for d in &m.decorators {
            let Some(name) = nest(d) else { continue };
            let declared = |status: u16, model: Option<RawRef>| RawResponse {
                status,
                via: drift_core::ResponseVia::Declared,
                builder: None,
                model,
                keys: vec![],
                in_catch: false,
            };
            match name.as_str() {
                "HttpCode" => {
                    if let Some(s) = first_arg(d).and_then(literal_status) {
                        sym.responses.push(declared(s, None));
                    }
                }
                "ApiOkResponse" | "ApiCreatedResponse" | "ApiResponse" => {
                    let o = match first_arg(d) {
                        Some(Expression::ObjectExpression(o)) => Some(o),
                        _ => None,
                    };
                    let status = o
                        .and_then(|o| object_prop(o, "status"))
                        .and_then(literal_status)
                        .unwrap_or(match name.as_str() {
                            "ApiOkResponse" => 200,
                            "ApiCreatedResponse" => 201,
                            _ => 0,
                        });
                    let model =
                        o.and_then(|o| object_prop(o, "type"))
                            .and_then(|t| match unwrap_expr(t) {
                                Expression::ArrayExpression(a) => a
                                    .elements
                                    .first()
                                    .and_then(|e| e.as_expression())
                                    .and_then(|e| self.canon(e)),
                                e => self.canon(e),
                            });
                    sym.responses.push(declared(status, model));
                }
                _ => {}
            }
        }
    }

    /// NestJS non-HTTP entry points: GraphQL resolvers, cron, queue processors, message handlers.
    pub(super) fn lower_nest_entries(&mut self, class: &Class) {
        let nest = |r: &RawRef| match &r.base {
            RawBase::Import { spec, name } if r.member.is_empty() => {
                Some((spec.clone(), name.clone()))
            }
            _ => None,
        };
        let class_name = class
            .id
            .as_ref()
            .map_or_else(|| "default".to_string(), |i| i.name.to_string());
        let class_guards = self.use_guards(&class.decorators);
        let mut class_wraps = Vec::new();
        for d in &class.decorators {
            let Some(r) = self.decorator_ref(d) else {
                continue;
            };
            if let Some((spec, name)) = nest(&r)
                && (NEST_CONTAINERS
                    .iter()
                    .any(|(s, n)| *s == spec && *n == name)
                    || (spec == "@nestjs/common" && name == "Controller"))
            {
                continue;
            }
            class_wraps.push(r);
        }
        for el in &class.body.body {
            let ClassElement::MethodDefinition(m) = el else {
                continue;
            };
            let mut entry = None;
            let mut sym = RawSymbol::empty("", SymbolKind::Function, self.line_of(m.span.start));
            for w in &class_wraps {
                sym.wraps.push((w.clone(), WrapKind::Decorator));
            }
            let mut keys = Collector::new(self);
            keys.in_method_of(class);
            for d in &m.decorators {
                let Some(r) = self.decorator_ref(d) else {
                    continue;
                };
                if let Some((spec, name)) = nest(&r)
                    && let Some((_, _, kind, label)) = NEST_ENTRY
                        .iter()
                        .find(|(s, n, _, _)| *s == spec && *n == name)
                {
                    entry = Some((*kind, *label));
                    continue;
                }
                if let Expression::CallExpression(c) = unwrap_expr(&d.expression) {
                    for (i, a) in c.arguments.iter().enumerate() {
                        if let Some(x) = a.as_expression() {
                            keys.object_keys(&r, i, x);
                        }
                    }
                }
                sym.wraps.push((r, WrapKind::Decorator));
            }
            let Some((kind, label)) = entry else { continue };
            if let Some(body) = &m.value.body {
                // Whose the handler's parameters are (`@CurrentUser() user`).
                keys.flow_method_params(&m.value.params);
                keys.visit_function_body(body);
            }
            let saw_input = keys.saw_input;
            keys.fill(&mut sym);
            record_input(&mut sym, saw_input, self.nest_input(m));
            self.nest_method_facts(m, &mut sym);
            sym.decorator_args.extend(class_guards.iter().cloned());
            sym.decorator_args.extend(self.use_guards(&m.decorators));
            self.use_guards_position(&class.decorators, &mut sym);
            self.use_guards_position(&m.decorators, &mut sym);
            let method_name = m
                .key
                .static_name()
                .and_then(|k| k.as_str().map(String::from))
                .unwrap_or_else(|| "?".into());
            let route = format!("{class_name}.{method_name}");
            let name = self.unique_route_name(label, &route);
            sym.name = name.clone();
            self.push_symbol(sym);
            let method = if kind == "graphql" {
                Some(label.to_string())
            } else {
                None
            };
            self.out.entry_points.push(drift_core::EntryPoint {
                symbol: name,
                kind: kind.into(),
                method,
                route: Some(route),
                adapter: "nestjs".into(),
            });
        }
    }
}

type Found = (String, Option<String>, String, String, u32, RawSymbol);

/// Finds inline tRPC procedures in router objects, and Inngest / Trigger.dev / BullMQ jobs.
struct EntryFinder<'l, 's> {
    l: &'l Lowerer<'s>,
    found: Vec<Found>,
    models: Vec<RawModel>,
    /// Inline procedures only their builder's origin can prove: (builder, method,
    /// key, line, symbol).
    candidates: Vec<(RawRef, &'static str, String, u32, RawSymbol)>,
}

impl EntryFinder<'_, '_> {
    fn job(
        &mut self,
        kind: &str,
        id: String,
        adapter: &str,
        line: u32,
        handler: Option<&Expression>,
    ) {
        let mut sym = RawSymbol::empty("", SymbolKind::Function, line);
        self.l.handler_facts(handler, &mut sym);
        self.found
            .push((kind.into(), None, id, adapter.into(), line, sym));
    }
}

impl EntryFinder<'_, '_> {
    /// Queue and stream consumers (entry kind `consumer`) in a file that imports the
    /// library: Bull / Bee-Queue `queue.process([name,] [n,] handler)`, kafkajs
    /// `consumer.run({ eachMessage })`, amqplib `channel.consume(queue, handler)`.
    fn consumer(&mut self, it: &CallExpression, line: u32) {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) else {
            return;
        };
        let imports = |pkgs: &[&str]| {
            self.l
                .out
                .imports
                .iter()
                .any(|i| pkgs.contains(&i.spec.as_str()))
        };
        let receiver = match unwrap_expr(&m.object) {
            Expression::Identifier(id) if id.name != "process" => id.name.to_string(),
            Expression::StaticMemberExpression(o) => o.property.name.to_string(),
            _ => return,
        };
        let exprs = arg_exprs(&it.arguments);
        let named = exprs.first().and_then(|x| string_value(x));
        let (adapter, id, handler) = match m.property.name.as_str() {
            "process" if imports(&["bull", "bee-queue"]) => {
                let Some(h) = exprs.last().copied().filter(|h| {
                    matches!(
                        unwrap_expr(h),
                        Expression::ArrowFunctionExpression(_)
                            | Expression::FunctionExpression(_)
                            | Expression::Identifier(_)
                            | Expression::StaticMemberExpression(_)
                    )
                }) else {
                    return;
                };
                ("bull", named.unwrap_or(receiver), Some(h))
            }
            "run" if imports(&["kafkajs"]) => {
                let Some(Expression::ObjectExpression(o)) = exprs.first().map(|x| unwrap_expr(x))
                else {
                    return;
                };
                let Some(h) = object_prop(o, "eachMessage").or_else(|| object_prop(o, "eachBatch"))
                else {
                    return;
                };
                ("kafkajs", receiver, Some(h))
            }
            "consume"
                if imports(&["amqplib", "amqplib/callback_api", "amqp-connection-manager"]) =>
            {
                let Some(h) = exprs.get(1).copied() else {
                    return;
                };
                ("amqplib", named.unwrap_or(receiver), Some(h))
            }
            _ => return,
        };
        self.job("consumer", id, adapter, line, handler);
    }
}

impl<'a> Visit<'a> for EntryFinder<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let line = self.l.line_of(it.span.start);
        let callee = self.l.canon_callee(&it.callee);
        let callee_name = match unwrap_expr(&it.callee) {
            Expression::Identifier(i) => Some(i.name.as_str()),
            Expression::StaticMemberExpression(m) => Some(m.property.name.as_str()),
            _ => None,
        };
        let first = it
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr);
        let import = callee.as_ref().and_then(|r| match &r.base {
            RawBase::Import { spec, name } => {
                Some((spec.as_str(), name.as_str(), r.member.as_str()))
            }
            _ => None,
        });

        // tRPC: router({ key: base.input(...).query(...) })
        if callee_name.is_some_and(|n| n.to_ascii_lowercase().ends_with("router"))
            && let Some(Expression::ObjectExpression(o)) = first
        {
            for p in &o.properties {
                let ObjectPropertyKind::ObjectProperty(p) = p else {
                    continue;
                };
                let Some(key) = p
                    .key
                    .static_name()
                    .and_then(|k| k.as_str().map(String::from))
                else {
                    continue;
                };
                if let Some(proc_) = self.l.procedure_chain(&p.value) {
                    let sym = self
                        .l
                        .procedure_symbol(&proc_, self.l.line_of(p.span.start));
                    if proc_.by_origin {
                        self.candidates.push((
                            proc_.base,
                            proc_.kind,
                            key,
                            self.l.line_of(p.span.start),
                            sym,
                        ));
                        continue;
                    }
                    self.found.push((
                        "rpc".into(),
                        Some(proc_.kind.into()),
                        key,
                        "trpc".into(),
                        self.l.line_of(p.span.start),
                        sym,
                    ));
                }
            }
        }

        // Drizzle: pgTable("links", { id: uuid(), workspaceId: ... })
        if let Some((spec, name, member)) = import
            && spec.starts_with("drizzle-orm")
            && member.is_empty()
            && name.ends_with("Table")
            && let Some(table) = first.and_then(string_value)
            && let Some(Expression::ObjectExpression(o)) = it
                .arguments
                .get(1)
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
        {
            let fields = o
                .properties
                .iter()
                .filter_map(|p| match p {
                    ObjectPropertyKind::ObjectProperty(p) => p
                        .key
                        .static_name()
                        .and_then(|k| k.as_str().map(String::from)),
                    _ => None,
                })
                .collect();
            self.models.push(RawModel {
                name: table,
                line,
                fields,
            });
        }

        // Inngest: client.createFunction({ id }, { event | cron }, handler)
        if callee_name == Some("createFunction") && it.arguments.len() >= 3 {
            let cfg = it.arguments.first().and_then(|a| a.as_expression());
            let trigger = it.arguments.get(1).and_then(|a| a.as_expression());
            let id = cfg.and_then(|c| {
                let Expression::ObjectExpression(o) = unwrap_expr(c) else {
                    return None;
                };
                object_prop(o, "id")
                    .or_else(|| object_prop(o, "name"))
                    .and_then(string_value)
            });
            let cron = trigger.is_some_and(|t| matches!(unwrap_expr(t), Expression::ObjectExpression(o) if object_prop(o, "cron").is_some()));
            if let Some(id) = id {
                let handler = it.arguments.get(2).and_then(|a| a.as_expression());
                self.job(
                    if cron { "cron" } else { "job" },
                    id,
                    "inngest",
                    line,
                    handler,
                );
            }
        }

        // Trigger.dev: task({ id, run }), schemaTask(...), schedules.task(...)
        if let Some((spec, name, member)) = import
            && spec.starts_with("@trigger.dev/sdk")
            && (matches!(name, "task" | "schemaTask") && member.is_empty()
                || name == "schedules" && member == ".task")
            && let Some(Expression::ObjectExpression(o)) = first
            && let Some(id) = object_prop(o, "id").and_then(string_value)
        {
            let kind = if name == "schedules" { "cron" } else { "job" };
            self.job(kind, id, "trigger.dev", line, object_prop(o, "run"));
        }

        self.consumer(it, line);
        walk::walk_call_expression(self, it);
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        // BullMQ: new Worker("queue", processor)
        if let Some(r) = self.l.canon(&it.callee)
            && matches!(&r.base, RawBase::Import { spec, name } if spec == "bullmq" && name == "Worker")
            && let Some(id) = it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(string_value)
        {
            let line = self.l.line_of(it.span.start);
            let handler = it.arguments.get(1).and_then(|a| a.as_expression());
            self.job("job", id, "bullmq", line, handler);
        }
        walk::walk_new_expression(self, it);
    }
}

/// Finds a registration on `router` in the statements walked: `router.use(...)`,
/// `router.addHook(...)`, `router.register(...)`, a route. Not inside a function
/// written there.
struct ConditionalUse<'n> {
    router: &'n str,
    found: bool,
    /// Inside a loop or a `switch`: a route registered there is not read. One
    /// registered in an `if`, a `try` or a block is ([`Lowerer::conditional_routes`]).
    unread_routes: u32,
}

impl<'a> Visit<'a> for ConditionalUse<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && matches!(unwrap_expr(&m.object), Expression::Identifier(id) if id.name == self.router)
        {
            let p = m.property.name.as_str();
            if matches!(p, "use" | "addHook" | "register" | "route")
                || (self.unread_routes > 0 && EXPRESS_METHODS.contains(&p))
            {
                self.found = true;
            }
        }
        walk::walk_call_expression(self, it);
    }
    fn visit_for_statement(&mut self, it: &ForStatement<'a>) {
        self.unread_routes += 1;
        walk::walk_for_statement(self, it);
        self.unread_routes -= 1;
    }
    fn visit_for_of_statement(&mut self, it: &ForOfStatement<'a>) {
        self.unread_routes += 1;
        walk::walk_for_of_statement(self, it);
        self.unread_routes -= 1;
    }
    fn visit_for_in_statement(&mut self, it: &ForInStatement<'a>) {
        self.unread_routes += 1;
        walk::walk_for_in_statement(self, it);
        self.unread_routes -= 1;
    }
    fn visit_while_statement(&mut self, it: &WhileStatement<'a>) {
        self.unread_routes += 1;
        walk::walk_while_statement(self, it);
        self.unread_routes -= 1;
    }
    fn visit_do_while_statement(&mut self, it: &DoWhileStatement<'a>) {
        self.unread_routes += 1;
        walk::walk_do_while_statement(self, it);
        self.unread_routes -= 1;
    }
    fn visit_switch_statement(&mut self, it: &SwitchStatement<'a>) {
        self.unread_routes += 1;
        walk::walk_switch_statement(self, it);
        self.unread_routes -= 1;
    }
    fn visit_catch_clause(&mut self, it: &CatchClause<'a>) {
        self.unread_routes += 1;
        walk::walk_catch_clause(self, it);
        self.unread_routes -= 1;
    }
    fn visit_function(&mut self, _: &Function<'a>, _: oxc_semantic::ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
}

/// The methods of a router that register what runs before its routes.
const BEFORE_ROUTES: &[&str] = &["use", "addHook", "register", "param"];

/// How [`RawSymbol::app_unread`] says that a middleware is registered on the
/// router where the order it runs in is not read: by a function, or under a
/// condition.
fn deferred_unread(router: &str) -> String {
    format!("what a function or a condition registers on {router}")
}

/// Finds every registration, on a router of the module, of what runs before its
/// routes ([`Lowerer::guard_sites`]).
pub(super) struct RouterSites<'l, 's> {
    l: &'l Lowerer<'s>,
    /// How many functions enclose the node walked.
    depth: u32,
    /// The statement of the module being walked is an expression statement.
    direct: bool,
    found: BTreeMap<String, Vec<(u32, bool)>>,
}

impl<'l, 's> RouterSites<'l, 's> {
    pub(super) fn of(l: &'l Lowerer<'s>, program: &Program) -> BTreeMap<String, Vec<(u32, bool)>> {
        if l.out.routers.is_empty() {
            return BTreeMap::new();
        }
        let mut sites = RouterSites {
            l,
            depth: 0,
            direct: false,
            found: BTreeMap::new(),
        };
        for st in &program.body {
            sites.direct = matches!(st, Statement::ExpressionStatement(_));
            sites.visit_statement(st);
        }
        sites.found
    }
}

impl<'a> Visit<'a> for RouterSites<'_, '_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        self.depth += 1;
        walk::walk_function(self, it, flags);
        self.depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        self.depth += 1;
        walk::walk_arrow_function_expression(self, it);
        self.depth -= 1;
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some((router, method)) = self.l.module_router_call(it)
            && BEFORE_ROUTES.contains(&method)
            && !it.arguments.iter().all(|a| {
                a.as_expression()
                    .is_some_and(|x| self.l.never_authenticates(x))
            })
        {
            self.found
                .entry(router)
                .or_default()
                .push((it.span.start, self.direct && self.depth == 0));
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds the parameters the file's own calls hand a router
/// ([`Lowerer::handed_routers`]): `configureApp(app, db)` where `app` is bound to a
/// router anywhere in the file (`const app = express()`).
pub(super) struct HandedRouters<'l, 's> {
    l: &'l Lowerer<'s>,
    /// The bindings of the file that hold a router, with its adapter.
    routers: HashMap<SymbolId, &'static str>,
    /// The second walk: the calls.
    calls: bool,
    found: BTreeMap<String, BTreeMap<u32, &'static str>>,
}

impl<'l, 's> HandedRouters<'l, 's> {
    pub(super) fn of(
        l: &'l Lowerer<'s>,
        program: &Program,
    ) -> BTreeMap<String, BTreeMap<u32, &'static str>> {
        let mut pass = HandedRouters {
            l,
            routers: HashMap::new(),
            calls: false,
            found: BTreeMap::new(),
        };
        pass.visit_program(program);
        if pass.routers.is_empty() {
            return BTreeMap::new();
        }
        pass.calls = true;
        pass.visit_program(program);
        pass.found
    }
}

impl<'a> Visit<'a> for HandedRouters<'_, '_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if !self.calls
            && let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && let Some(sym) = id.symbol_id.get()
            // `new Hono().basePath(...)` is read where the module binds it.
            && base_path(init).is_none()
            && let Some(adapter) = self.l.router_adapter_of(init)
        {
            self.routers.insert(sym, adapter);
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.calls
            && let Expression::Identifier(callee) = unwrap_expr(&it.callee)
            // A function the file declares, not an import or a global.
            && matches!(self.l.resolve_ident(callee), Some(RawBase::Local(_)) | None)
        {
            for (i, a) in it.arguments.iter().enumerate() {
                let Some(Expression::Identifier(id)) = a.as_expression().map(unwrap_expr) else {
                    continue;
                };
                let adapter = id
                    .reference_id
                    .get()
                    .and_then(|r| self.l.scoping.get_reference(r).symbol_id())
                    .and_then(|s| self.routers.get(&s));
                if let (Some(adapter), Ok(i)) = (adapter, u32::try_from(i)) {
                    self.found
                        .entry(callee.name.to_string())
                        .or_default()
                        .insert(i, *adapter);
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds the registrations written as a route is that the lowering did not list
/// ([`drift_core::FileFacts::unlisted_routes`]): a call of a method named for an
/// HTTP verb, on anything, with a path written out first and a handler written in
/// place last (a function of two or three parameters, as a framework calls one).
/// One is listed where a route of the file was lowered from its line.
pub(super) struct UnlistedRoutes<'l, 's> {
    l: &'l Lowerer<'s>,
    listed: BTreeSet<u32>,
    found: BTreeSet<u32>,
}

impl<'l, 's> UnlistedRoutes<'l, 's> {
    pub(super) fn of(l: &'l Lowerer<'s>, program: &Program) -> Vec<u32> {
        // The measured reading lists fewer routes: what is not listed is said of
        // the full one ([`drift_core::FileFacts::hold`]).
        if l.test_file || lowering_as_measured() {
            return Vec::new();
        }
        let routes: BTreeSet<&str> = l
            .out
            .entry_points
            .iter()
            .filter(|e| e.kind != "cli")
            .map(|e| e.symbol.as_str())
            .collect();
        let mut pass = UnlistedRoutes {
            l,
            listed: l
                .out
                .symbols
                .iter()
                .filter(|s| routes.contains(s.name.as_str()))
                .map(|s| s.line)
                .collect(),
            found: BTreeSet::new(),
        };
        pass.visit_program(program);
        pass.found.into_iter().collect()
    }
}

impl<'a> Visit<'a> for UnlistedRoutes<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let handler = |e: &Expression| match unwrap_expr(e) {
            Expression::ArrowFunctionExpression(f) => matches!(f.params.items.len(), 2 | 3),
            Expression::FunctionExpression(f) => matches!(f.params.items.len(), 2 | 3),
            _ => false,
        };
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && matches!(
                m.property.name.as_str(),
                "get" | "post" | "put" | "patch" | "delete"
            )
            && it.arguments.len() >= 2
            && it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(string_value)
                .is_some_and(|p| p.starts_with('/'))
            && it
                .arguments
                .last()
                .and_then(|a| a.as_expression())
                .is_some_and(handler)
        {
            let line = self.l.line_of(it.span.start);
            if !self.listed.contains(&line) {
                self.found.insert(line);
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds the routers of the module a function body registers on itself: not in a
/// function written inside it, but for the callback of a `forEach` or a `map`.
struct ClosureUse<'l, 's> {
    l: &'l Lowerer<'s>,
    depth: u32,
    routers: BTreeSet<String>,
}

impl<'a> Visit<'a> for ClosureUse<'_, '_> {
    fn visit_function(&mut self, _: &Function<'a>, _: oxc_semantic::ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}

    fn visit_class(&mut self, _: &Class<'a>) {}

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some((router, _)) = self.l.module_router_call(it) {
            self.routers.insert(router);
        }
        // `routes.forEach((r) => app.get(r.path, r.handler))`: read as a loop.
        if matches!(call_name(&it.callee), Some("forEach" | "map"))
            && self.depth < 4
            && let Some(f) = it.arguments.first().and_then(|a| a.as_expression())
        {
            self.depth += 1;
            match unwrap_expr(f) {
                Expression::ArrowFunctionExpression(a) => match &a.body {
                    ArrowFunctionBody::FunctionBody(b) => {
                        for st in &b.statements {
                            self.visit_statement(st);
                        }
                    }
                    other => {
                        if let Some(x) = other.as_expression() {
                            self.visit_expression(x);
                        }
                    }
                },
                Expression::FunctionExpression(a) => {
                    for st in a.body.iter().flat_map(|b| &b.statements) {
                        self.visit_statement(st);
                    }
                }
                _ => {}
            }
            self.depth -= 1;
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds every function of a module for [`Lowerer::closure_routes`], whatever it is
/// written in: a declaration, a callback, a function in a function.
struct ClosurePass<'l, 's> {
    l: &'l mut Lowerer<'s>,
}

impl<'a> Visit<'a> for ClosurePass<'_, '_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        if let Some(body) = &it.body {
            self.l.closure_routes(&body.statements, body.span, false);
        }
        walk::walk_function(self, it, flags);
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if let ArrowFunctionBody::FunctionBody(b) = &it.body {
            self.l.closure_routes(&b.statements, b.span, false);
        }
        walk::walk_arrow_function_expression(self, it);
    }

    fn visit_class(&mut self, _: &Class<'a>) {}
}

/// Finds the functions a module declares for [`Lowerer::scoped_fn`]: a declaration, a
/// function bound to a name, a default export, each also where `fastify-plugin` wraps
/// it. Not a function written as an argument: one handed to `register` is lowered
/// where it is registered.
struct ScopedPass<'l, 's> {
    l: &'l mut Lowerer<'s>,
    /// The names the module exports the CommonJS way (`module.exports = routes`).
    exported: BTreeSet<String>,
}

/// Finds what a function does with its first parameter that says it is a router
/// ([`Lowerer::plugin_shape`]).
struct PluginShape<'n> {
    param: &'n str,
    routes: bool,
    fastify: bool,
}

impl<'a> Visit<'a> for PluginShape<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && matches!(unwrap_expr(&m.object), Expression::Identifier(id) if id.name.as_str() == self.param)
        {
            let first = it.arguments.first().and_then(|a| a.as_expression());
            match m.property.name.as_str() {
                "addHook" | "decorate" | "decorateRequest" | "setErrorHandler" => {
                    self.fastify = true;
                }
                "register" | "route" => self.fastify = true,
                "get" | "post" | "put" | "patch" | "delete" | "all" | "head" | "options"
                    if it.arguments.len() >= 2
                        && first
                            .and_then(string_value)
                            .is_some_and(|p| p.starts_with('/')) =>
                {
                    self.routes = true;
                }
                _ => {}
            }
        }
        walk::walk_call_expression(self, it);
    }
}

impl<'a> Visit<'a> for ScopedPass<'_, '_> {
    fn visit_function(&mut self, it: &Function<'a>, _: oxc_semantic::ScopeFlags) {
        if let Some(body) = &it.body {
            let name = it
                .id
                .as_ref()
                .map_or_else(|| "default".to_string(), |i| i.name.to_string());
            // `async function routes(app) { ... }; module.exports = routes;`.
            let first = self
                .exported
                .contains(&name)
                .then(|| self.l.plugin_shape(&it.params, body, it.r#async))
                .flatten();
            self.l
                .scoped_fn(Some(&name), &it.params, body, (first, false), None, None);
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && let Some((params, body, shared)) = self.l.plugin_fn(init)
        {
            // `export const plugin = async (f) => { f.get("/x", ...) }`.
            let first = shared.then_some("fastify").or_else(|| {
                self.exported
                    .contains(id.name.as_str())
                    .then(|| self.l.plugin_shape(params, body, async_function(init, 0)))
                    .flatten()
            });
            self.l.scoped_fn(
                Some(id.name.as_str()),
                params,
                body,
                (first, shared),
                None,
                None,
            );
        }
    }

    fn visit_export_default_declaration(&mut self, it: &ExportDefaultDeclaration<'a>) {
        match it.declaration.as_expression() {
            Some(e) => {
                if let Some((params, body, shared)) = self.l.plugin_fn(e) {
                    // `export default async (server) => { server.get("/x", ...) }`.
                    let first = shared
                        .then_some("fastify")
                        .or_else(|| self.l.plugin_shape(params, body, async_function(e, 0)));
                    self.l
                        .scoped_fn(Some("default"), params, body, (first, shared), None, None);
                }
            }
            None => walk::walk_export_default_declaration(self, it),
        }
    }

    // Nothing inside a statement that is no declaration, a class or a call, but a
    // function exported the CommonJS way: `module.exports = async function (app) {
    // ... }`, `exports.plugin = async (instance) => { ... }`.
    fn visit_expression_statement(&mut self, it: &ExpressionStatement<'a>) {
        let Expression::AssignmentExpression(a) = unwrap_expr(&it.expression) else {
            return;
        };
        let Some(name) = self.l.cjs_export_name(a) else {
            return;
        };
        let Some((params, body, shared)) = self.l.plugin_fn(&a.right) else {
            return;
        };
        let is_async = match unwrap_expr(&a.right) {
            Expression::ArrowFunctionExpression(f) => f.r#async,
            Expression::FunctionExpression(f) => f.r#async,
            _ => true,
        };
        let first = match shared {
            true => Some("fastify"),
            false => self.l.plugin_shape(params, body, is_async),
        };
        self.l
            .scoped_fn(Some(&name), params, body, (first, shared), None, None);
    }
    fn visit_class(&mut self, _: &Class<'a>) {}
    fn visit_call_expression(&mut self, _: &CallExpression<'a>) {}
}
