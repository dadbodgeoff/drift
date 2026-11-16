//! hapi 17 to 21 (`@hapi/hapi`, and `hapi` before the scope): `Hapi.server()` and
//! `new Hapi.Server()`, `server.route({ method, path, handler, options })` with an
//! object or an array of them, and the plugins `server.register(...)` adds.
//!
//! What runs before a route's handler, in lifecycle order: the server's request
//! extensions (`server.ext("onRequest" | "onPreAuth" | "onCredentials" |
//! "onPostAuth" | "onPreHandler", ...)`, which run for every route whenever they
//! are added), its authentication, and its prerequisites (`options.pre`).
//!
//! Authentication is the route's `options.auth`: `false` is none; a strategy name,
//! or an object in the mode `required` (the mode a strategy is given in unless
//! told otherwise), refuses a request that does not authenticate (401), whatever
//! the strategy, as hapi documents; the modes `try` and `optional` refuse no one.
//! A route that sets none takes the server's default (`server.auth.default(...)`),
//! wherever in the file it is set: hapi looks the default up when it builds a
//! route's lifecycle, and rebuilds every route already added when the default is
//! set (`lib/auth.js` `default` and `lookup`, `@hapi/hapi` 21.4.13). Where a plugin
//! registered on the server, or a function the server was handed, may set it, or
//! the route is a plugin's (its server is where the plugin is registered), the
//! default is unread. What a plugin or such a function adds to the server is
//! unread for every route of it, added before or after: a server extension is
//! added to every route already added as well (`lib/ext.js`).
//!
//! `options.validate` (`payload`, `query`, `params`, `headers`, `state`) validates
//! the request.

use super::*;

/// The packages hapi is published as.
pub(super) const PACKAGES: &[&str] = &["@hapi/hapi", "hapi"];

/// The extension points that run before the handler and may answer in its place.
const BEFORE_EXT: &[&str] = &[
    "onRequest",
    "onPreAuth",
    "onCredentials",
    "onPostAuth",
    "onPreHandler",
];

/// The schema keys of `options.validate`.
const SCHEMA_KEYS: &[&str] = &["payload", "query", "params", "headers", "state"];

/// Plugins of packages documented to add no extension that turns callers away:
/// authentication schemes (a scheme refuses only the routes whose `auth` uses
/// it), static files, templates, proxies, documentation and logging.
const PLAIN_PLUGINS: &[&str] = &[
    "@hapi/inert",
    "@hapi/vision",
    "@hapi/h2o2",
    "@hapi/jwt",
    "@hapi/cookie",
    "@hapi/basic",
    "@hapi/bell",
    "hapi-auth-jwt2",
    "hapi-auth-basic",
    "hapi-auth-cookie",
    "hapi-swagger",
    "@hapi/good",
    "hapi-pino",
    "inert",
    "vision",
];

/// What a route authenticates with.
#[derive(Debug, Clone)]
enum Auth {
    /// Refuses a request that does not authenticate.
    Required,
    /// Refuses no one (`auth: false`, the modes `try` and `optional`).
    None,
    /// Not read, and how.
    Unread(String),
}

/// A server, or the server a plugin's `register` is given.
#[derive(Debug, Clone, Default)]
struct Server {
    /// The package it is made by.
    spec: String,
    /// The server a plugin is given: what is registered on it elsewhere is not read.
    plugin: bool,
    /// The default authentication, where set so far.
    default_auth: Option<Auth>,
    /// What runs before every route added from here: what is not read.
    unread: Vec<String>,
}

struct HapiWalk<'l, 's> {
    l: &'l mut Lowerer<'s>,
    servers: BTreeMap<String, Server>,
    /// The default authentication and what is unread of each server, gathered
    /// first: they hold for every route of the server, added before or after.
    early: BTreeMap<String, (Option<Auth>, Vec<String>)>,
    /// The request extensions of each server, gathered first: they run for every
    /// route of the server, added before them or after.
    ext: BTreeMap<String, Before>,
    collecting_ext: bool,
    listed: Vec<u32>,
    unlisted: Vec<u32>,
}

impl Lowerer<'_> {
    pub(super) fn lower_hapi(
        &mut self,
        program: &Program,
        listed: &mut Vec<u32>,
        unlisted: &mut Vec<u32>,
    ) {
        let mut ext = BTreeMap::new();
        let mut early = BTreeMap::new();
        for collecting_ext in [true, false] {
            let mut w = HapiWalk {
                l: self,
                servers: BTreeMap::new(),
                early,
                ext,
                collecting_ext,
                listed: Vec::new(),
                unlisted: Vec::new(),
            };
            w.visit_program(program);
            ext = w.ext;
            early = if collecting_ext {
                w.servers
                    .into_iter()
                    .map(|(name, s)| (name, (s.default_auth, s.unread)))
                    .collect()
            } else {
                w.early
            };
            listed.extend(w.listed);
            unlisted.extend(w.unlisted);
        }
    }

    /// The package of hapi a call makes a server with (`Hapi.server(...)`, `new
    /// Hapi.Server(...)`, `server(...)` imported by name).
    fn hapi_server_spec(&self, e: &Expression) -> Option<String> {
        let callee = match unwrap_expr(e) {
            Expression::CallExpression(c) => &c.callee,
            Expression::NewExpression(n) => &n.callee,
            Expression::AwaitExpression(a) => return self.hapi_server_spec(&a.argument),
            _ => return None,
        };
        let r = self.canon(callee)?;
        let RawBase::Import { spec, name } = &r.base else {
            return None;
        };
        let made = matches!(
            (name.as_str(), r.member.as_str()),
            ("default" | "*", ".server" | ".Server") | ("server" | "Server", "")
        );
        (made && PACKAGES.contains(&spec.as_str())).then(|| spec.clone())
    }
}

/// A hapi path in the form the other adapters write: `{id}` is `:id`, `{id?}` is
/// `:id?`, and `{rest*}` takes the rest.
fn hapi_path(path: &str) -> String {
    let segs: Vec<String> = path
        .split('/')
        .map(
            |s| match s.strip_prefix('{').and_then(|x| x.strip_suffix('}')) {
                Some(p) if p.contains('*') => "*".to_string(),
                Some(p) => format!(":{p}"),
                None => s.to_string(),
            },
        )
        .collect();
    segs.join("/")
}

impl HapiWalk<'_, '_> {
    fn server_of(&self, e: &Expression) -> Option<String> {
        match unwrap_expr(e) {
            Expression::Identifier(id) if self.servers.contains_key(id.name.as_str()) => {
                Some(id.name.to_string())
            }
            _ => None,
        }
    }

    /// The reference a route that authenticates is guarded by: the authentication
    /// of the hapi package itself, read by [`drift_core::guard_lists`].
    fn auth_ref(spec: &str) -> RawRef {
        RawRef {
            base: RawBase::Import {
                spec: spec.to_string(),
                name: "auth".to_string(),
            },
            member: ".required".to_string(),
        }
    }

    fn read_auth(&self, e: &Expression) -> Auth {
        match unwrap_expr(e) {
            Expression::BooleanLiteral(b) if !b.value => Auth::None,
            x if text_of(x).is_some() => Auth::Required,
            Expression::ObjectExpression(o) => {
                if o.properties
                    .iter()
                    .any(|p| matches!(p, ObjectPropertyKind::SpreadProperty(_)))
                {
                    return Auth::Unread("auth options spread from an expression".to_string());
                }
                match object_prop(o, "mode") {
                    None => Auth::Required,
                    Some(m) => match text_of(m).as_deref() {
                        Some("required") => Auth::Required,
                        Some("try" | "optional") => Auth::None,
                        _ => Auth::Unread("an auth mode that is not read".to_string()),
                    },
                }
            }
            _ => Auth::Unread("an auth option that is not read".to_string()),
        }
    }

    /// `server.ext(event, method[, options])`, `server.ext({ type, method })` and an
    /// array of those.
    fn note_ext(&mut self, server: &str, args: &[&Expression]) {
        let mut b = self.ext.remove(server).unwrap_or_default();
        let one =
            |w: &mut Self, event: Option<String>, method: Option<&Expression>, b: &mut Before| {
                match event {
                    Some(ev) if BEFORE_EXT.contains(&ev.as_str()) => {
                        if let Some(m) = method {
                            w.l.before_of(server, &ev, m, b);
                        }
                    }
                    Some(_) => {}
                    None => b.unread("an extension whose event is not read"),
                }
            };
        match args.first().map(|x| unwrap_expr(x)) {
            Some(Expression::ArrayExpression(a)) => {
                for el in &a.elements {
                    if let Some(Expression::ObjectExpression(o)) =
                        el.as_expression().map(unwrap_expr)
                    {
                        let ev = object_prop(o, "type").and_then(text_of);
                        one(self, ev, object_prop(o, "method"), &mut b);
                    }
                }
            }
            Some(Expression::ObjectExpression(o)) => {
                let ev = object_prop(o, "type").and_then(text_of);
                one(self, ev, object_prop(o, "method"), &mut b);
            }
            Some(x) => {
                let ev = text_of(x);
                one(self, ev, args.get(1).copied(), &mut b);
            }
            None => {}
        }
        self.ext.insert(server.to_string(), b);
    }

    /// One route config.
    fn route(&mut self, server: &str, o: &ObjectExpression) {
        let Some(s) = self.servers.get(server).cloned() else {
            return;
        };
        let line = self.l.line_of(o.span.start);
        let options = match object_prop(o, "options")
            .or_else(|| object_prop(o, "config"))
            .map(unwrap_expr)
        {
            Some(Expression::ObjectExpression(x)) => Some(&**x),
            _ => None,
        };
        let mut before = self.ext.get(server).cloned().unwrap_or_default();
        for u in &s.unread {
            before.unread(u.clone());
        }
        if object_prop(o, "options")
            .or_else(|| object_prop(o, "config"))
            .is_some()
            && options.is_none()
        {
            before.unread("route options that are not written in place");
        }
        let auth = match options.and_then(|x| object_prop(x, "auth")) {
            Some(a) => Some(self.read_auth(a)),
            None => s.default_auth.clone(),
        };
        match auth {
            Some(Auth::Required) => before.wraps.push(Self::auth_ref(&s.spec)),
            Some(Auth::None) => {}
            Some(Auth::Unread(how)) => before.unread(how),
            None if s.plugin => before
                .unread("the default authentication of the server the plugin is registered on"),
            None => {}
        }
        let mut schemas: Vec<Option<RawRef>> = Vec::new();
        if let Some(opts) = options {
            if let Some(pre) = object_prop(opts, "pre") {
                self.pre(server, pre, &mut before);
            }
            if let Some(v) = object_prop(opts, "validate") {
                match unwrap_expr(v) {
                    Expression::ObjectExpression(v) => {
                        for k in SCHEMA_KEYS {
                            if let Some(x) = object_prop(v, k) {
                                schemas.push(self.l.canon(x).filter(|r| {
                                    !matches!(r.base, RawBase::Global(_))
                                        && !r.member.ends_with("()")
                                }));
                            }
                        }
                    }
                    _ => schemas.push(None),
                }
            }
            if object_prop(opts, "ext").is_some() {
                before.unread("an extension of the route that is not read");
            }
        }
        let handler =
            object_prop(o, "handler").or_else(|| options.and_then(|x| object_prop(x, "handler")));
        let path = object_prop(o, "path")
            .and_then(route_text)
            .map_or_else(|| "?".to_string(), |p| hapi_path(&p));
        let methods: Vec<String> = match object_prop(o, "method").map(unwrap_expr) {
            Some(Expression::ArrayExpression(a)) => a
                .elements
                .iter()
                .map(|el| {
                    el.as_expression()
                        .and_then(text_of)
                        .unwrap_or_else(|| "?".to_string())
                })
                .collect(),
            Some(x) => vec![text_of(x).unwrap_or_else(|| "?".to_string())],
            None => vec!["?".to_string()],
        };
        for m in methods {
            let method = match m.as_str() {
                "*" => "ALL".to_string(),
                m => m.to_ascii_uppercase(),
            };
            self.l.server_route(
                ServerRoute {
                    adapter: "hapi",
                    router: (!s.plugin).then(|| server.to_string()),
                    method,
                    path: join_path(&[&path]),
                    line,
                    before: before.clone(),
                    handler,
                    schemas: schemas.clone(),
                },
                &mut self.listed,
            );
        }
    }

    /// `options.pre`: functions, `{ method, assign }` objects, and arrays of them
    /// that run in parallel.
    fn pre(&mut self, server: &str, e: &Expression, out: &mut Before) {
        match unwrap_expr(e) {
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    match el.as_expression() {
                        Some(x) => self.pre(server, x, out),
                        None => out.unread("prerequisites spread from an expression"),
                    }
                }
            }
            Expression::ObjectExpression(o) => match object_prop(o, "method") {
                Some(m) => self.l.before_of(server, "pre", m, out),
                None => out.unread("a prerequisite that is not read"),
            },
            x => self.l.before_of(server, "pre", x, out),
        }
    }

    /// `server.register(plugins[, options])`.
    fn register(&mut self, server: &str, args: &[&Expression]) {
        let outer_prefix = match args.get(1).map(|x| unwrap_expr(x)) {
            Some(Expression::ObjectExpression(o)) => routes_prefix(o),
            _ => None,
        };
        let mut items: Vec<&Expression> = Vec::new();
        match args.first().map(|x| unwrap_expr(x)) {
            Some(Expression::ArrayExpression(a)) => {
                items.extend(a.elements.iter().filter_map(|el| el.as_expression()));
            }
            Some(x) => items.push(x),
            None => {}
        }
        for item in items {
            let (plugin, prefix) = match unwrap_expr(item) {
                Expression::ObjectExpression(o) if object_prop(o, "plugin").is_some() => (
                    object_prop(o, "plugin"),
                    routes_prefix(o).or_else(|| outer_prefix.clone()),
                ),
                x => (Some(x), outer_prefix.clone()),
            };
            let Some(plugin) = plugin else { continue };
            // A plugin object written in place is read where it is.
            if matches!(unwrap_expr(plugin), Expression::ObjectExpression(_)) {
                continue;
            }
            let target = self.l.canon(plugin);
            let Some(r) = target.filter(|r| !matches!(r.base, RawBase::Global(_))) else {
                self.unread_after(server, "what a plugin that is not read sets on the server");
                continue;
            };
            match package_of(&r) {
                Some(spec) if PLAIN_PLUGINS.contains(&spec) => {}
                Some(spec) => {
                    let how = format!("what the plugin of {spec} adds before the routes");
                    self.unread_after(server, &how);
                }
                None => {
                    let s = self.servers.get(server).cloned().unwrap_or_default();
                    let mut before = self.ext.get(server).cloned().unwrap_or_default();
                    for u in &s.unread {
                        before.unread(u.clone());
                    }
                    let parent = if s.plugin { "" } else { server };
                    let prefix = prefix.unwrap_or_default();
                    if !self.collecting_ext {
                        self.l.server_mount(parent, &prefix, r, &before);
                    }
                    self.unread_after(
                        server,
                        "what a plugin registered on the server sets on it (a default authentication, an extension)",
                    );
                }
            }
        }
    }

    fn unread_after(&mut self, server: &str, how: &str) {
        if let Some(s) = self.servers.get_mut(server)
            && !s.unread.iter().any(|u| u == how)
        {
            s.unread.push(how.to_string());
        }
    }
}

/// `{ routes: { prefix } }` of a registration.
fn routes_prefix(o: &ObjectExpression) -> Option<String> {
    match object_prop(o, "routes").map(unwrap_expr) {
        Some(Expression::ObjectExpression(r)) => {
            object_prop(r, "prefix").map(|p| route_text(p).unwrap_or_else(|| "?".to_string()))
        }
        _ => None,
    }
}

/// A plugin object: `{ name, register(server, options) { ... } }` (or `pkg` for
/// its name): the parameter `register` is given is a server.
fn plugin_register<'b, 'a>(o: &'b ObjectExpression<'a>) -> Option<&'b Expression<'a>> {
    let named = object_prop(o, "name").is_some() || object_prop(o, "pkg").is_some();
    let register = object_prop(o, "register")?;
    (named
        && matches!(
            unwrap_expr(register),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ))
    .then_some(register)
}

/// The module declares a plugin object whose `register` adds a route on the server
/// it is handed (`server.route(...)`): hapi's plugin, in a file that need not
/// import hapi.
pub(super) fn declares_plugin(program: &Program) -> bool {
    struct Plugins(bool);
    struct Routes<'p>(&'p str, bool);
    impl<'a> Visit<'a> for Routes<'_> {
        fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
            if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
                && m.property.name == "route"
                && matches!(unwrap_expr(&m.object), Expression::Identifier(id) if id.name == self.0)
            {
                self.1 = true;
            }
            walk::walk_call_expression(self, it);
        }
    }
    impl<'a> Visit<'a> for Plugins {
        fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
            if let Some(register) = plugin_register(it)
                && let Some((Some(param), _)) = callback(register)
            {
                let mut r = Routes(&param, false);
                r.visit_expression(register);
                self.0 |= r.1;
            }
            walk::walk_object_expression(self, it);
        }
    }
    let mut p = Plugins(false);
    p.visit_program(program);
    p.0
}

impl<'a> Visit<'a> for HapiWalk<'_, '_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && let Some(spec) = self.l.hapi_server_spec(init)
        {
            let (default_auth, unread) = self
                .early
                .get(id.name.as_str())
                .cloned()
                .unwrap_or_default();
            self.servers.insert(
                id.name.to_string(),
                Server {
                    spec,
                    default_auth,
                    unread,
                    ..Server::default()
                },
            );
            // Only a binding of the module is a router other files can name.
            let top = id.symbol_id.get().is_some_and(|s| {
                self.l.scoping.symbol_scope_id(s) == self.l.scoping.root_scope_id()
            });
            if !self.collecting_ext && top {
                self.l.server_router(id.name.as_str());
            }
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        let Some(register) = plugin_register(it) else {
            walk::walk_object_expression(self, it);
            return;
        };
        let spec = self
            .servers
            .values()
            .next()
            .map_or_else(|| PACKAGES[0].to_string(), |s| s.spec.clone());
        let param = callback(register).and_then(|(p, _)| p);
        let saved = param.as_ref().map(|p| (p.clone(), self.servers.remove(p)));
        if let Some(p) = &param {
            self.servers.insert(
                p.clone(),
                Server {
                    spec,
                    plugin: true,
                    ..Server::default()
                },
            );
        }
        walk::walk_object_expression(self, it);
        if let Some((p, old)) = saved {
            self.servers.remove(&p);
            if let Some(old) = old {
                self.servers.insert(p, old);
            }
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let args = arg_exprs(&it.arguments);
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) {
            let method = m.property.name.as_str();
            if let Some(server) = self.server_of(&m.object) {
                match (method, self.collecting_ext) {
                    ("ext", true) => self.note_ext(&server, &args),
                    ("route", false) => match args.first().map(|x| unwrap_expr(x)) {
                        Some(Expression::ObjectExpression(o)) => self.route(&server, o),
                        Some(Expression::ArrayExpression(a)) => {
                            for el in &a.elements {
                                match el.as_expression().map(unwrap_expr) {
                                    Some(Expression::ObjectExpression(o)) => self.route(&server, o),
                                    _ => {
                                        let line = self.l.line_of(it.span.start);
                                        self.unlisted.push(line);
                                    }
                                }
                            }
                        }
                        _ => {
                            let line = self.l.line_of(it.span.start);
                            self.unlisted.push(line);
                        }
                    },
                    ("register", _) => self.register(&server, &args),
                    _ => {}
                }
            } else if method == "default"
                && let Expression::StaticMemberExpression(auth) = unwrap_expr(&m.object)
                && auth.property.name == "auth"
                && let Some(server) = self.server_of(&auth.object)
                && let Some(a) = args.first()
            {
                let read = self.read_auth(a);
                if let Some(s) = self.servers.get_mut(&server) {
                    s.default_auth = Some(read);
                }
            }
        }
        // A server handed to a function: what it sets on it is not read.
        {
            let handed: Vec<String> = args.iter().filter_map(|x| self.server_of(x)).collect();
            for s in handed {
                self.unread_after(&s, "what a function the server is handed sets on it");
                if let Some(srv) = self.servers.get_mut(&s)
                    && srv.default_auth.is_none()
                {
                    srv.default_auth = Some(Auth::Unread(
                        "the default authentication a function the server is handed may set"
                            .to_string(),
                    ));
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}
