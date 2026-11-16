//! Elysia 1.x: `new Elysia({ prefix })` and the routes chained on it or registered
//! on its binding (`.get/.post/.put/.patch/.delete/.options/.head/.all`,
//! `.route(method, ...)`, `.ws`), under `.group(prefix, app => ...)` and
//! `.guard(hook, app => ...)`, with the instances and functions `.use(...)` adds.
//!
//! What runs before a route's handler: the lifecycle events registered on the
//! instance before the route (`onRequest`, `onTransform`, `derive`, `resolve`,
//! `onBeforeHandle`, a `.guard(hook)` without a callback) and the route's own hook
//! (`beforeHandle`, `transform`), in that order. A hook registered on an instance
//! runs for the instances it uses after it. A hook an instance registers with
//! `{ as: "scoped" }` or `{ as: "global" }` also runs for the instance that uses
//! it: read where that instance is of the same file, and unread where it is
//! another file's, or a package's plugin that is on no plain list.
//!
//! A route schema (`body`, `query`, `params`, `headers`, `cookie`) validates the
//! request. A route option Elysia does not document may be a macro's, which can
//! add a hook: it is unread.

use super::*;

pub(super) const PACKAGE: &str = "elysia";

/// The lifecycle events an instance registers that run before the handler and may
/// answer in its place.
const BEFORE_EVENTS: &[&str] = &[
    "onRequest",
    "onTransform",
    "derive",
    "resolve",
    "onBeforeHandle",
];

/// The keys of a route's or a guard's hook object that run before the handler.
const HOOK_KEYS: &[&str] = &["transform", "beforeHandle"];

/// The schema keys of a hook object: each validates that part of the request.
const SCHEMA_KEYS: &[&str] = &["body", "query", "params", "headers", "cookie"];

/// The other keys a hook object is documented to take: none runs before the
/// handler, or can turn the caller away.
const OTHER_KEYS: &[&str] = &[
    "response",
    "detail",
    "type",
    "parse",
    "afterHandle",
    "afterResponse",
    "mapResponse",
    "error",
    "tags",
    "config",
    "as",
];

/// Plugins of packages documented to add no hook that turns callers away: they
/// document, serve files, add headers, decorate or derive values.
const PLAIN_PLUGINS: &[&str] = &[
    "@elysiajs/cors",
    "@elysiajs/swagger",
    "@elysiajs/openapi",
    "@elysiajs/static",
    "@elysiajs/html",
    "@elysiajs/cron",
    "@elysiajs/jwt",
    "@elysiajs/bearer",
    "@elysiajs/opentelemetry",
    "@elysiajs/server-timing",
    "@elysiajs/stream",
];

const VERBS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "options", "head", "all",
];

/// Where routes are being registered: the prefix, what runs before them, and the
/// schemas that validate them.
#[derive(Debug, Clone, Default)]
struct Scope {
    prefix: String,
    before: Before,
    schemas: Vec<Option<RawRef>>,
}

#[derive(Default)]
struct State {
    /// The instances bound at the top level of the module.
    instances: BTreeMap<String, Scope>,
    /// What an instance of the module registers with a scope that reaches the
    /// instance using it.
    shared: BTreeMap<String, Before>,
}

impl Lowerer<'_> {
    pub(super) fn lower_elysia(
        &mut self,
        program: &Program,
        listed: &mut Vec<u32>,
        unlisted: &mut Vec<u32>,
    ) {
        let _ = unlisted;
        let mut st = State::default();
        for stmt in &program.body {
            let decl = match stmt {
                Statement::VariableDeclaration(v) => Some(&**v),
                Statement::ExportDeclaration(e) => match &e.declaration {
                    Declaration::VariableDeclaration(v) => Some(&**v),
                    Declaration::FunctionDeclaration(f) => {
                        self.elysia_function(
                            f.id.as_ref().map(|i| i.name.as_str()),
                            &f.params,
                            f.body.as_deref(),
                            &mut st,
                            listed,
                        );
                        None
                    }
                    _ => None,
                },
                Statement::FunctionDeclaration(f) => {
                    self.elysia_function(
                        f.id.as_ref().map(|i| i.name.as_str()),
                        &f.params,
                        f.body.as_deref(),
                        &mut st,
                        listed,
                    );
                    None
                }
                Statement::ExpressionStatement(es) => {
                    self.elysia_statement(&es.expression, &mut st, listed);
                    None
                }
                Statement::ExportDefaultDeclaration(e) => {
                    if let Some(x) = e.declaration.as_expression() {
                        self.elysia_binding(DEFAULT_ROUTER, x, &mut st, listed);
                    }
                    None
                }
                _ => None,
            };
            for d in decl.into_iter().flat_map(|v| &v.declarations) {
                if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) {
                    self.elysia_binding(id.name.as_str(), init, &mut st, listed);
                }
            }
        }
    }

    /// `new Elysia(...)` of the package, with the prefix it is given.
    fn elysia_root(&self, e: &Expression) -> Option<String> {
        let Expression::NewExpression(n) = unwrap_expr(e) else {
            return None;
        };
        let r = self.canon(&n.callee)?;
        if !matches!(&r.base, RawBase::Import { spec, name } if spec == PACKAGE && name == "Elysia")
            || !r.member.is_empty()
        {
            return None;
        }
        let prefix = match n
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr)
        {
            Some(Expression::ObjectExpression(o)) => match object_prop(o, "prefix") {
                Some(p) => route_text(p).unwrap_or_else(|| "?".to_string()),
                None => String::new(),
            },
            _ => String::new(),
        };
        Some(prefix)
    }

    /// The instance a chain starts from: `new Elysia()`, or the identifier `root`.
    fn elysia_chain_root<'b, 'a>(&self, e: &'b Expression<'a>, root: Option<&str>) -> bool {
        match unwrap_expr(e) {
            Expression::Identifier(id) => root == Some(id.name.as_str()),
            Expression::CallExpression(c) => match unwrap_expr(&c.callee) {
                Expression::StaticMemberExpression(m) => self.elysia_chain_root(&m.object, root),
                _ => false,
            },
            x => self.elysia_root(x).is_some(),
        }
    }

    /// A top-level binding (`const app = new Elysia()...`): an instance of the
    /// module, or a function plugin (`const plugin = (app: Elysia) => app.get(...)`).
    fn elysia_binding(
        &mut self,
        name: &str,
        init: &Expression,
        st: &mut State,
        listed: &mut Vec<u32>,
    ) {
        if self.elysia_chain_root(init, None) {
            self.server_router(name);
            let mut scope = Scope::default();
            let mut shared = Before::default();
            self.elysia_chain(init, name, None, &mut scope, &mut shared, st, listed);
            st.instances.insert(name.to_string(), scope);
            st.shared.insert(name.to_string(), shared);
            return;
        }
        match unwrap_expr(init) {
            Expression::ArrowFunctionExpression(f) if self.elysia_typed(&f.params) => {
                if let Some((param, body)) = callback(init) {
                    self.elysia_plugin_body(param.as_deref(), &body, st, listed);
                }
                let _ = name;
            }
            Expression::FunctionExpression(f) if self.elysia_typed(&f.params) => {
                self.elysia_function(Some(name), &f.params, f.body.as_deref(), st, listed);
            }
            _ => {}
        }
    }

    /// The first parameter is typed as an Elysia instance (`app: Elysia`).
    fn elysia_typed(&self, params: &FormalParameters) -> bool {
        let Some(TSType::TSTypeReference(r)) = params
            .items
            .first()
            .and_then(|p| p.type_annotation.as_ref())
            .map(|t| &t.type_annotation)
        else {
            return false;
        };
        matches!(&r.type_name, TSTypeName::IdentifierReference(t)
            if self.imports.get(t.name.as_str()).is_some_and(|(s, n)| s == PACKAGE && n == "Elysia"))
    }

    fn elysia_function(
        &mut self,
        _name: Option<&str>,
        params: &FormalParameters,
        body: Option<&FunctionBody>,
        st: &mut State,
        listed: &mut Vec<u32>,
    ) {
        if !self.elysia_typed(params) {
            return;
        }
        let Some(body) = body else { return };
        let param = match params.items.first().map(|p| &p.pattern) {
            Some(BindingPattern::BindingIdentifier(id)) => Some(id.name.to_string()),
            _ => None,
        };
        self.elysia_plugin_body(
            param.as_deref(),
            &Callback::Stmts(&body.statements),
            st,
            listed,
        );
    }

    /// The body of a function plugin: its routes are served as its module is
    /// mounted, and what the instance that uses it registered before is not read.
    fn elysia_plugin_body(
        &mut self,
        param: Option<&str>,
        body: &Callback,
        st: &mut State,
        listed: &mut Vec<u32>,
    ) {
        let Some(param) = param else { return };
        let mut scope = Scope::default();
        scope
            .before
            .unread("what the instance that uses this plugin runs before its routes");
        let mut shared = Before::default();
        for e in body.exprs() {
            self.elysia_chain(e, "", Some(param), &mut scope, &mut shared, st, listed);
        }
    }

    /// A top-level statement that registers on an instance of the module.
    fn elysia_statement(&mut self, e: &Expression, st: &mut State, listed: &mut Vec<u32>) {
        let mut root = unwrap_expr(e);
        while let Expression::CallExpression(c) = root
            && let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee)
        {
            root = unwrap_expr(&m.object);
        }
        // `new Elysia().get(...).listen(3000)`, bound to nothing: an instance no
        // other file can name.
        if self.elysia_root(root).is_some() {
            let mut scope = Scope::default();
            let mut shared = Before::default();
            self.elysia_chain(e, "", None, &mut scope, &mut shared, st, listed);
            return;
        }
        let Expression::Identifier(id) = root else {
            return;
        };
        let name = id.name.to_string();
        let Some(mut scope) = st.instances.get(&name).cloned() else {
            return;
        };
        let mut shared = st.shared.get(&name).cloned().unwrap_or_default();
        self.elysia_chain(e, &name, Some(&name), &mut scope, &mut shared, st, listed);
        st.instances.insert(name.clone(), scope);
        st.shared.insert(name, shared);
    }

    /// Reads a registration chain from its root out, registering on `scope`.
    /// `router`: the binding routes are recorded on (`""` for a function plugin's);
    /// `shared`: what the instance registers with a scope that reaches its user.
    #[allow(clippy::too_many_arguments)]
    fn elysia_chain(
        &mut self,
        e: &Expression,
        router: &str,
        root: Option<&str>,
        scope: &mut Scope,
        shared: &mut Before,
        st: &mut State,
        listed: &mut Vec<u32>,
    ) -> bool {
        let e = unwrap_expr(e);
        if let Some(prefix) = self.elysia_root(e) {
            scope.prefix = join_path(&[&scope.prefix, &prefix]);
            return true;
        }
        let Expression::CallExpression(c) = e else {
            return matches!(e, Expression::Identifier(id) if root == Some(id.name.as_str()));
        };
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return false;
        };
        if !self.elysia_chain(&m.object, router, root, scope, shared, st, listed) {
            return false;
        }
        let method = m.property.name.as_str();
        let args = arg_exprs(&c.arguments);
        let line = self.line_of(m.property.span.start);
        match method {
            v if VERBS.contains(&v) => {
                let path = args.first().and_then(|x| route_text(x));
                self.elysia_route(
                    router,
                    scope,
                    &v.to_ascii_uppercase(),
                    path,
                    args.get(1).copied(),
                    args.get(2).copied(),
                    line,
                    listed,
                );
            }
            "route" => {
                let verb = args
                    .first()
                    .and_then(|x| text_of(x))
                    .map_or_else(|| "?".to_string(), |v| v.to_ascii_uppercase());
                let path = args.get(1).and_then(|x| route_text(x));
                self.elysia_route(
                    router,
                    scope,
                    &verb,
                    path,
                    args.get(2).copied(),
                    args.get(3).copied(),
                    line,
                    listed,
                );
            }
            "ws" => {
                let path = args.first().and_then(|x| route_text(x));
                let message = match args.get(1).map(|x| unwrap_expr(x)) {
                    Some(Expression::ObjectExpression(o)) => object_prop(o, "message"),
                    _ => None,
                };
                self.elysia_route(
                    router,
                    scope,
                    "WS",
                    path,
                    message,
                    args.get(1).copied(),
                    line,
                    listed,
                );
            }
            ev if BEFORE_EVENTS.contains(&ev) => {
                // `onBeforeHandle(fn)`, `onBeforeHandle({ as: "scoped" }, fn)`.
                let (opts, fns) = match args.split_first() {
                    Some((first, rest)) if !rest.is_empty() => (Some(*first), rest.to_vec()),
                    _ => (None, args.clone()),
                };
                let wide = opts.is_some_and(|o| self.elysia_reaches_user(o));
                let mut b = Before::default();
                for f in fns {
                    self.before_of(router_name(router), ev, f, &mut b);
                }
                if wide {
                    shared.add(&b);
                }
                scope.before.add(&b);
            }
            "guard" => {
                let Some(hook) = args.first().copied() else {
                    return true;
                };
                let body = args.get(1).and_then(|x| callback(x));
                let mut inner = scope.clone();
                let wide = self.elysia_reaches_user(hook);
                let mut b = Before::default();
                self.elysia_hook(router, hook, &mut b, &mut inner.schemas);
                inner.before.add(&b);
                match body {
                    Some((param, cb)) => {
                        let mut inner_shared = Before::default();
                        for x in cb.exprs() {
                            self.elysia_chain(
                                x,
                                router,
                                param.as_deref(),
                                &mut inner,
                                &mut inner_shared,
                                st,
                                listed,
                            );
                        }
                    }
                    // A guard with no callback: for the routes that follow.
                    None => {
                        if wide {
                            shared.add(&b);
                        }
                        *scope = inner;
                    }
                }
            }
            "group" => {
                let Some(prefix) = args.first() else {
                    return true;
                };
                let mut inner = scope.clone();
                let own = route_text(prefix).unwrap_or_else(|| "?".to_string());
                inner.prefix = join_path(&[&scope.prefix, &own]);
                // `.group(prefix, hook, app => ...)`.
                let (hook, cb) = match args.as_slice() {
                    [_, hook, cb] => (Some(*hook), callback(cb)),
                    [_, cb] => (None, callback(cb)),
                    _ => (None, None),
                };
                if let Some(h) = hook {
                    let mut b = Before::default();
                    self.elysia_hook(router, h, &mut b, &mut inner.schemas);
                    inner.before.add(&b);
                }
                if let Some((param, cb)) = cb {
                    let mut inner_shared = Before::default();
                    for x in cb.exprs() {
                        self.elysia_chain(
                            x,
                            router,
                            param.as_deref(),
                            &mut inner,
                            &mut inner_shared,
                            st,
                            listed,
                        );
                    }
                }
            }
            "use" => {
                for x in args {
                    self.elysia_use(router, x, scope, st, listed);
                }
            }
            _ => {}
        }
        true
    }

    /// `{ as: "scoped" }` or `{ as: "global" }`: the hook reaches the instance that
    /// uses this one.
    fn elysia_reaches_user(&self, opts: &Expression) -> bool {
        matches!(unwrap_expr(opts), Expression::ObjectExpression(o)
            if object_prop(o, "as").and_then(text_of).is_some_and(|a| a == "scoped" || a == "global"))
    }

    /// Reads a hook object (a route's third argument, a guard's first): what runs
    /// before the handler, the schemas, and an option that is not documented.
    fn elysia_hook(
        &mut self,
        router: &str,
        e: &Expression,
        out: &mut Before,
        schemas: &mut Vec<Option<RawRef>>,
    ) {
        let Expression::ObjectExpression(o) = unwrap_expr(e) else {
            out.unread("route options that are not written in place");
            return;
        };
        for p in &o.properties {
            let ObjectPropertyKind::ObjectProperty(p) = p else {
                out.unread("route options spread into the hook");
                continue;
            };
            let Some(key) = key_name(&p.key).filter(|_| !p.computed) else {
                out.unread("a computed key of the route options");
                continue;
            };
            if HOOK_KEYS.contains(&key.as_str()) {
                self.before_of(router_name(router), &key, &p.value, out);
            } else if SCHEMA_KEYS.contains(&key.as_str()) {
                schemas.push(self.canon(&p.value).filter(|r| {
                    !matches!(r.base, RawBase::Global(_)) && !r.member.ends_with("()")
                }));
            } else if !OTHER_KEYS.contains(&key.as_str()) {
                out.unread(format!("the route option {key}, which a macro may read"));
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn elysia_route(
        &mut self,
        router: &str,
        scope: &Scope,
        method: &str,
        path: Option<String>,
        handler: Option<&Expression>,
        hook: Option<&Expression>,
        line: u32,
        listed: &mut Vec<u32>,
    ) {
        let own = path.unwrap_or_else(|| "?".to_string());
        let mut before = scope.before.clone();
        let mut schemas = scope.schemas.clone();
        if let Some(h) = hook {
            self.elysia_hook(router, h, &mut before, &mut schemas);
        }
        self.server_route(
            ServerRoute {
                adapter: "elysia",
                router: (!router.is_empty()).then(|| router.to_string()),
                method: method.to_string(),
                path: join_path(&[&scope.prefix, &own]),
                line,
                before,
                handler,
                schemas,
            },
            listed,
        );
    }

    /// `.use(x)`: a function plugin written in place registers on this instance; an
    /// instance written in place, or one of the module, is served under this one's
    /// prefix and hooks; one of another file is a mount, and what it registers
    /// with a scope that reaches this instance is not read.
    fn elysia_use(
        &mut self,
        router: &str,
        x: &Expression,
        scope: &mut Scope,
        st: &mut State,
        listed: &mut Vec<u32>,
    ) {
        if let Some((param, cb)) = callback(x) {
            let mut shared = Before::default();
            for e in cb.exprs() {
                self.elysia_chain(e, router, param.as_deref(), scope, &mut shared, st, listed);
            }
            return;
        }
        if self.elysia_chain_root(x, None) {
            let mut inner = Scope {
                prefix: scope.prefix.clone(),
                before: scope.before.clone(),
                schemas: scope.schemas.clone(),
            };
            let mut shared = Before::default();
            self.elysia_chain(x, router, None, &mut inner, &mut shared, st, listed);
            scope.before.add(&shared);
            return;
        }
        if let Expression::Identifier(id) = unwrap_expr(x)
            && st.instances.contains_key(id.name.as_str())
        {
            let target = RawRef {
                base: RawBase::Local(id.name.to_string()),
                member: String::new(),
            };
            let before = scope.before.clone();
            self.server_mount(router, &scope.prefix, target, &before);
            if let Some(shared) = st.shared.get(id.name.as_str()).cloned() {
                scope.before.add(&shared);
            }
            return;
        }
        let target = match unwrap_expr(x) {
            Expression::CallExpression(c) => self.canon(&c.callee),
            other => self.canon(other),
        };
        match target {
            Some(r) => match package_of(&r) {
                Some(spec) if PLAIN_PLUGINS.contains(&spec) => {}
                Some(spec) => scope
                    .before
                    .unread(format!("what the plugin of {spec} adds before the routes")),
                None => {
                    if !matches!(r.base, RawBase::Global(_)) {
                        let before = scope.before.clone();
                        self.server_mount(router, &scope.prefix, r.clone(), &before);
                    }
                    scope.before.unread(
                        "what a plugin used before the route adds with a scope that reaches it",
                    );
                }
            },
            None => scope.before.unread("a plugin that is not read"),
        }
    }
}

/// The receiver a function written in place is named for.
fn router_name(router: &str) -> &str {
    if router.is_empty() { "plugin" } else { router }
}
