//! The routes of django-ninja, Litestar and Sanic, as their documented APIs write
//! them, lowered into [`RawFrameworks`]: facts of their own, which only the listed
//! link reads (`crate::link::framework_links`), so that nothing the measured build
//! wrote changes. Quart is the Flask API on another package and needs nothing
//! here: its routes, blueprints and hooks are the Flask adapter's facts.
//!
//! What a call or a decorator is of is decided by the linker, from the package the
//! receiver's constructor comes from; here, what is written is kept where it is
//! written in the way the framework documents (a literal path, a list of names).
//! Anything else is kept by its words, or not at all: such a route lists nothing.

use super::*;

/// Litestar's route handler decorators (`from litestar import get`), by the
/// module they are documented in, and the method each serves; `route` takes its
/// methods from `http_method=`.
const LITESTAR_MODULES: &[&str] = &["litestar", "litestar.handlers"];
const LITESTAR_HANDLERS: &[(&str, &str)] = &[
    ("get", "GET"),
    ("post", "POST"),
    ("put", "PUT"),
    ("patch", "PATCH"),
    ("delete", "DELETE"),
    ("head", "HEAD"),
    ("route", ""),
];
/// Litestar's controller class: its subclasses' `path`, `guards` and handlers.
const LITESTAR_CONTROLLERS: &[&str] = &["litestar.Controller", "litestar.controller.Controller"];
/// Options of a Litestar layer that run code around a request in a way this
/// reading does not follow: each may turn a caller away (`before_request=`, a
/// hook whose answer is the response; `on_app_init=`, which may add guards and
/// middleware, as the JWT backends do).
const LITESTAR_UNREAD: &[&str] = &["before_request", "on_app_init"];

/// The option keywords that make a constructor's options worth keeping.
const OPTION_KEYWORDS: &[&str] = &["auth", "guards", "route_handlers"];

impl<'t> Lowerer<'t> {
    /// The module's django-ninja, Litestar and Sanic facts ([`RawFile::frameworks`]):
    /// module-level constructors, decorated functions and classes, and the mounts,
    /// routes and hooks called at module level or in a module-level function.
    pub(crate) fn lower_frameworks(&mut self, body: &'t [Stmt]) {
        for s in body {
            match s {
                Stmt::Assign(a) => {
                    if let [Expr::Name(n)] = a.targets.as_slice() {
                        self.framework_assign(n.id.as_str(), &a.value);
                    }
                }
                Stmt::AnnAssign(a) => {
                    if let (Expr::Name(n), Some(v)) = (a.target.as_ref(), &a.value) {
                        self.framework_assign(n.id.as_str(), v);
                    }
                }
                Stmt::FunctionDef(f) => {
                    self.framework_function(f.name.as_str(), f, &[]);
                    for st in &f.body {
                        if let Stmt::Expr(e) = st
                            && let Expr::Call(c) = e.value.as_ref()
                        {
                            self.framework_call(c, Some(f.name.as_str()));
                        }
                    }
                }
                Stmt::ClassDef(c) => self.framework_class(c),
                Stmt::Expr(e) => {
                    if let Expr::Call(c) = e.value.as_ref() {
                        self.framework_call(c, None);
                    }
                }
                _ => {}
            }
        }
        self.framework_explained_reads(body);
    }

    /// An argument a mount of [`RawFile::frameworks`] takes.
    fn framework_read(&mut self, e: Option<&Expr>) {
        if let Some(e) = e {
            self.framework_reads.insert(e as *const Expr as usize);
        }
    }

    /// [`RawFrameworks::reads`]: each name every read of which as a value in the
    /// module is an argument of a mount above, by the line of its first read (as
    /// [`RawFile::router_uses`] keeps it). A name read anywhere else as well keeps
    /// what it was.
    fn framework_explained_reads(&mut self, body: &'t [Stmt]) {
        if self.framework_reads.is_empty() {
            return;
        }
        let mut f = CallFinder::default();
        for s in body {
            f.visit_stmt(s);
        }
        let mut by: BTreeMap<RawRef, (u32, bool)> = BTreeMap::new();
        for &(e, func, call) in &f.uses {
            if call || self.read_targets.contains(&(e as *const Expr as usize)) {
                continue;
            }
            let locals = func.and_then(|n| f.local_imports.get(n));
            let Some(r) = self.canon_in(e, locals) else {
                continue;
            };
            let read = self.framework_reads.contains(&(e as *const Expr as usize));
            let line = self.line(e);
            let at = by.entry(r).or_insert((line, true));
            at.0 = at.0.min(line);
            at.1 &= read;
        }
        self.out.frameworks.reads = by
            .into_iter()
            .filter(|(_, (_, all))| *all)
            .map(|(r, (line, _))| (r, line))
            .collect();
    }

    /// What an option that may guard is given ([`RawGiven`]).
    fn framework_given(&self, e: &Expr) -> RawGiven {
        if e.is_none_literal_expr() {
            return RawGiven::Nothing;
        }
        let one = |x: &Expr| -> Option<RawRef> {
            let named = match x {
                Expr::Name(_) | Expr::Attribute(_) => x,
                Expr::Call(c) if matches!(c.func.as_ref(), Expr::Name(_) | Expr::Attribute(_)) => {
                    c.func.as_ref()
                }
                _ => return None,
            };
            self.canon(named)
                .filter(|r| !matches!(r.base, RawBase::Global(_)) && !r.member.contains('('))
        };
        let refs: Option<Vec<RawRef>> = match elements(e) {
            Some(els) => els.iter().map(one).collect(),
            None => one(e).map(|r| vec![r]),
        };
        match refs {
            Some(refs) => RawGiven::Refs(refs),
            None => RawGiven::Unread(crate::lower::practice::words(e)),
        }
    }

    /// The options of a constructor that are not read, as written.
    fn framework_unread(&self, c: &ast::ExprCall) -> Vec<String> {
        let mut out: Vec<String> = c
            .arguments
            .keywords
            .iter()
            .filter_map(|k| match &k.arg {
                Some(a) if LITESTAR_UNREAD.contains(&a.as_str()) => Some(format!("{a}=...")),
                Some(_) => None,
                None => Some(format!("**{}", written(&k.value))),
            })
            .collect();
        out.sort();
        out
    }

    /// `api = NinjaAPI(auth=...)`, `router = Router(path="/v1", route_handlers=[...],
    /// guards=[...])`, `app = Litestar(route_handlers=[...])`, and Sanic's `group =
    /// Blueprint.group(a, b, url_prefix="/v1")`.
    fn framework_assign(&mut self, name: &str, value: &'t Expr) {
        let Expr::Call(c) = value else { return };
        if let Expr::Attribute(a) = c.func.as_ref()
            && a.attr.as_str() == "group"
            && let Some(callee) = self.canon(&c.func)
            && !matches!(callee.base, RawBase::Global(_))
        {
            self.out.frameworks.groups.push(RawFrameworkGroup {
                name: name.to_string(),
                callee,
                prefix: self.path_value(keyword(c, "url_prefix")),
                line: self.line(c),
            });
            let members: Vec<&Expr> = c
                .arguments
                .args
                .iter()
                .flat_map(|x| match elements(x) {
                    Some(els) => els.iter().collect::<Vec<_>>(),
                    None => vec![x],
                })
                .collect();
            for m in members {
                if let (Expr::Name(_) | Expr::Attribute(_), Some(target)) = (m, self.canon(m)) {
                    let line = self.line(m);
                    self.framework_reads.insert(m as *const Expr as usize);
                    self.out.frameworks.mounts.push(RawFrameworkMount {
                        how: "group".into(),
                        parent: RawRef {
                            base: RawBase::Local(name.to_string()),
                            member: String::new(),
                        },
                        target,
                        prefix: None,
                        auth: None,
                        line,
                    });
                }
            }
            return;
        }
        let class_like = match c.func.as_ref() {
            Expr::Name(n) => n.id.as_str(),
            Expr::Attribute(a) => a.attr.as_str(),
            _ => "",
        }
        .starts_with(|ch: char| ch.is_ascii_uppercase());
        let kept = c.arguments.keywords.iter().any(|k| {
            k.arg
                .as_ref()
                .is_some_and(|a| OPTION_KEYWORDS.contains(&a.as_str()))
        });
        if !class_like || !kept {
            return;
        }
        let handlers = keyword(c, "route_handlers").map(|h| {
            elements(h).map(|els| {
                els.iter()
                    .map(|e| match e {
                        Expr::Name(_) | Expr::Attribute(_) => {
                            // A router or controller named here is mounted here.
                            self.framework_reads.insert(e as *const Expr as usize);
                            self.canon(e)
                                .filter(|r| !matches!(r.base, RawBase::Global(_)))
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
        });
        let handlers = match handlers {
            // Given, but no list written in place: nothing of it is read.
            Some(None) => Some(vec![None]),
            Some(Some(h)) => Some(h),
            None => None,
        };
        let options = RawFrameworkOptions {
            name: name.to_string(),
            class: false,
            path: None,
            auth: keyword(c, "auth").map(|e| self.framework_given(e)),
            guards: keyword(c, "guards").map(|e| self.framework_given(e)),
            handlers,
            unread: self.framework_unread(c),
            line: self.line(c),
        };
        self.out.frameworks.options.push(options);
    }

    /// The decorators of a module-level function, or of a method of a Litestar
    /// controller (`class_provided`: what the controller's own dependencies
    /// provide, by key).
    fn framework_function(
        &mut self,
        symbol: &str,
        f: &'t ast::StmtFunctionDef,
        class_provided: &[(String, RawRef)],
    ) {
        for d in &f.decorator_list {
            let (func, call) = match &d.expression {
                Expr::Call(c) => (c.func.as_ref(), Some(c)),
                e => (e, None),
            };
            if let Some(h) = self.litestar_handler(symbol, func, call, f, class_provided) {
                self.out.frameworks.handlers.push(h);
                continue;
            }
            let Expr::Attribute(a) = func else { continue };
            let Some(receiver) = self
                .canon(&a.value)
                .filter(|r| !matches!(r.base, RawBase::Global(_)))
            else {
                continue;
            };
            let attr = a.attr.as_str();
            // django-ninja: `@api.get("/x", auth=...)`.
            if let Some(c) = call
                && (HTTP_VERBS.contains(&attr) || attr == "api_operation")
                && let Some(auth) = keyword(c, "auth")
            {
                self.out.frameworks.auth.push(RawRouteAuth {
                    symbol: symbol.to_string(),
                    receiver: receiver.clone(),
                    auth: self.framework_given(auth),
                });
            }
            // Sanic: `@app.on_request`, `@bp.on_response`, `@app.middleware("request")`,
            // `@app.middleware` (a request middleware).
            let hook = match (attr, call) {
                ("on_request", _) => Some((true, false)),
                ("on_response", _) => Some((false, false)),
                ("middleware", None) => Some((true, true)),
                ("middleware", Some(c)) => {
                    match arg(c, 0, "attach_to")
                        .or_else(|| arg(c, 0, "middleware_or_request"))
                        .and_then(string_value)
                        .as_deref()
                    {
                        Some("request") => Some((true, true)),
                        Some("response") => Some((false, true)),
                        _ => None,
                    }
                }
                _ => None,
            };
            if let Some((request, middleware)) = hook {
                self.out.frameworks.hooks.push(RawFrameworkHook {
                    router: receiver,
                    hook: RawRef {
                        base: RawBase::Local(symbol.to_string()),
                        member: String::new(),
                    },
                    request,
                    middleware,
                });
            }
        }
    }

    /// A Litestar route handler decorator on `f` (`@get("/items")`,
    /// `@route("/x", http_method=["GET", "POST"])`), for the handler `symbol`.
    fn litestar_handler(
        &self,
        symbol: &str,
        func: &Expr,
        call: Option<&ast::ExprCall>,
        f: &ast::StmtFunctionDef,
        class_provided: &[(String, RawRef)],
    ) -> Option<RawFrameworkHandler> {
        let decorator = self.canon(func)?;
        let d = dotted(&decorator)?;
        let (module, last) = d.rsplit_once('.')?;
        if !LITESTAR_MODULES.contains(&module) {
            return None;
        }
        let (_, method) = LITESTAR_HANDLERS.iter().find(|(n, _)| *n == last)?;
        let methods = match *method {
            "" => upper_methods(call.and_then(|c| keyword(c, "http_method")))
                .into_iter()
                .chain(
                    call.and_then(|c| keyword(c, "http_method"))
                        .and_then(string_value)
                        .map(|m| m.to_ascii_uppercase()),
                )
                .collect(),
            m => vec![m.to_string()],
        };
        let paths = match call.and_then(|c| arg(c, 0, "path")) {
            None => vec!["/".to_string()],
            Some(p) => match elements(p) {
                Some(els) => els
                    .iter()
                    .filter_map(|e| self.path_value(Some(e)))
                    .collect(),
                None => self.path_value(Some(p)).into_iter().collect(),
            },
        };
        // The dependencies the handler takes by parameter name: its own and its
        // controller's; a key the handler does not name is not resolved for it.
        let params: BTreeSet<&str> = f
            .parameters
            .iter_non_variadic_params()
            .map(|p| p.parameter.name.as_str())
            .collect();
        let mut provided: Vec<RawRef> = Vec::new();
        let own = call
            .and_then(|c| keyword(c, "dependencies"))
            .map(|d| self.provided(d))
            .unwrap_or_default();
        for (key, r) in own.iter().chain(class_provided) {
            if params.contains(key.as_str()) && !provided.contains(r) {
                provided.push(r.clone());
            }
        }
        let mut unread = call.map(|c| self.framework_unread(c)).unwrap_or_default();
        // Dependencies that are no dict of `Provide(f)` written in place.
        if let Some(d) = call.and_then(|c| keyword(c, "dependencies"))
            && !matches!(d, Expr::Dict(x) if x.items.len() == own.len())
        {
            unread.push("dependencies=...".to_string());
        }
        Some(RawFrameworkHandler {
            symbol: symbol.to_string(),
            decorator,
            methods,
            paths,
            guards: call
                .and_then(|c| keyword(c, "guards"))
                .map(|e| self.framework_given(e)),
            provided,
            unread,
            line: self.line(f),
        })
    }

    /// `{"user": Provide(load_user)}`: each key with the function it is provided
    /// by, where both are written as such.
    fn provided(&self, e: &Expr) -> Vec<(String, RawRef)> {
        let Expr::Dict(d) = e else { return vec![] };
        d.items
            .iter()
            .filter_map(|i| {
                let key = i.key.as_ref().and_then(string_value)?;
                let Expr::Call(p) = &i.value else { return None };
                if super::super::practice::callee_name(&p.func) != Some("Provide") {
                    return None;
                }
                let f = p
                    .arguments
                    .args
                    .first()
                    .or_else(|| keyword(p, "dependency"))?;
                let r = self
                    .canon(f)
                    .filter(|r| !matches!(r.base, RawBase::Global(_)))?;
                Some((key, r))
            })
            .collect()
    }

    /// The Litestar controller bases of a class.
    fn litestar_controller(&self, c: &ast::StmtClassDef) -> bool {
        c.arguments.as_ref().is_some_and(|args| {
            args.args.iter().any(|b| {
                self.dotted_of(b)
                    .is_some_and(|d| LITESTAR_CONTROLLERS.contains(&d.as_str()))
            })
        })
    }

    /// A Litestar controller: its `path`, `guards` and `dependencies`, and the
    /// handlers among its methods.
    fn framework_class(&mut self, c: &'t ast::StmtClassDef) {
        if !self.litestar_controller(c) {
            return;
        }
        let name = c.name.as_str();
        let mut options = RawFrameworkOptions {
            name: name.to_string(),
            class: true,
            path: None,
            auth: None,
            guards: None,
            handlers: None,
            unread: vec![],
            line: self.line(c),
        };
        let mut provided = Vec::new();
        for st in &c.body {
            let (target, value) = match st {
                Stmt::Assign(a) => match a.targets.as_slice() {
                    [Expr::Name(n)] => (n.id.as_str(), a.value.as_ref()),
                    _ => continue,
                },
                Stmt::AnnAssign(a) => match (a.target.as_ref(), &a.value) {
                    (Expr::Name(n), Some(v)) => (n.id.as_str(), v.as_ref()),
                    _ => continue,
                },
                _ => continue,
            };
            match target {
                "path" => options.path = self.path_value(Some(value)),
                "guards" => options.guards = Some(self.framework_given(value)),
                "dependencies" => {
                    provided = self.provided(value);
                    if !matches!(value, Expr::Dict(x) if x.items.len() == provided.len()) {
                        options.unread.push("dependencies = ...".to_string());
                    }
                }
                t if LITESTAR_UNREAD.contains(&t) => options.unread.push(format!("{t} = ...")),
                _ => {}
            }
        }
        self.out.frameworks.options.push(options);
        for st in &c.body {
            if let Stmt::FunctionDef(f) = st {
                let symbol = format!("{name}.{}", f.name);
                self.framework_function(&symbol, f, &provided);
            }
        }
    }

    /// A Litestar controller's handler methods, as symbols of the listed reading
    /// only ([`RawSymbol::late`]): one per method with a route handler decorator,
    /// carrying the class's wraps and the method's other decorators. None for a
    /// class that is no Litestar controller.
    pub(super) fn framework_late_methods(
        &mut self,
        c: &'t ast::StmtClassDef,
        sym: &RawSymbol,
    ) -> Option<Vec<RawSymbol>> {
        if !self.litestar_controller(c) {
            return None;
        }
        let class = c.name.as_str();
        // Lowering a method's decorators records what they register; the listed
        // reading takes its handlers from [`RawFile::frameworks`].
        let kept = std::mem::take(&mut self.out);
        let mut out = Vec::new();
        for st in &c.body {
            let Stmt::FunctionDef(f) = st else { continue };
            let mut handler = None;
            for d in &f.decorator_list {
                let (func, call) = match &d.expression {
                    Expr::Call(x) => (x.func.as_ref(), Some(x)),
                    e => (e, None),
                };
                if let Some(h) = self.litestar_handler(f.name.as_str(), func, call, f, &[]) {
                    handler = Some(h);
                }
            }
            let Some(handler) = handler else { continue };
            let mut ms = RawSymbol::empty(
                &format!("{class}.{}", f.name),
                SymbolKind::Function,
                self.line(f),
            );
            ms.owner = Some(class.to_string());
            ms.methods = handler.methods;
            ms.is_async = f.is_async;
            ms.late = true;
            ms.wraps = sym
                .wraps
                .iter()
                .filter(|(_, k)| *k != WrapKind::Try)
                .cloned()
                .collect();
            for (i, d) in f.decorator_list.iter().enumerate() {
                let func = match &d.expression {
                    Expr::Call(x) => x.func.as_ref(),
                    e => e,
                };
                let route = self
                    .canon(func)
                    .and_then(|r| dotted(&r))
                    .and_then(|d| {
                        d.rsplit_once('.')
                            .map(|(m, l)| (m.to_string(), l.to_string()))
                    })
                    .is_some_and(|(m, l)| {
                        LITESTAR_MODULES.contains(&m.as_str())
                            && LITESTAR_HANDLERS.iter().any(|(n, _)| *n == l)
                    });
                if !route {
                    self.lower_decorator(&ms.name.clone(), d, i as u32, &mut ms);
                }
            }
            let mut col = Collector::new(self, false);
            col.function(&f.parameters, &f.body, f.returns.as_deref());
            col.fill(&mut ms);
            out.push(ms);
        }
        self.out = kept;
        Some(out)
    }

    /// Mounts, routes and hooks added by a call: django-ninja's
    /// `api.add_router("/items", router, auth=...)`; Sanic's `app.blueprint(bp,
    /// url_prefix=...)`, `app.add_route(handler, "/x", methods=[...])` and
    /// `app.register_middleware(f, "request")`.
    fn framework_call(&mut self, c: &'t ast::ExprCall, func: Option<&str>) {
        let Expr::Attribute(a) = c.func.as_ref() else {
            return;
        };
        let Some(parent) = self.receiver(&a.value, func, None) else {
            return;
        };
        let named = |l: &Self, e: &Expr| match e {
            Expr::Name(_) | Expr::Attribute(_) => l
                .receiver(e, func, None)
                .filter(|r| !r.member.contains('(')),
            _ => None,
        };
        let line = self.line(c);
        match a.attr.as_str() {
            "add_router" => {
                let (Some(prefix), Some(target)) = (
                    self.path_value(arg(c, 0, "prefix")),
                    arg(c, 1, "router").and_then(|t| named(self, t)),
                ) else {
                    return;
                };
                self.framework_read(arg(c, 1, "router"));
                self.out.frameworks.mounts.push(RawFrameworkMount {
                    how: "add_router".into(),
                    parent,
                    target,
                    prefix: Some(prefix),
                    auth: keyword(c, "auth").map(|e| self.framework_given(e)),
                    line,
                });
            }
            "blueprint" => {
                let Some(given) = arg(c, 0, "blueprint") else {
                    return;
                };
                let prefix = self.path_value(keyword(c, "url_prefix"));
                let targets: Vec<&Expr> = match elements(given) {
                    Some(els) => els.iter().collect(),
                    None => vec![given],
                };
                for t in targets {
                    if let Some(target) = named(self, t) {
                        self.framework_reads.insert(t as *const Expr as usize);
                        self.out.frameworks.mounts.push(RawFrameworkMount {
                            how: "blueprint".into(),
                            parent: parent.clone(),
                            target,
                            prefix: prefix.clone(),
                            auth: None,
                            line,
                        });
                    }
                }
            }
            "add_route" => {
                let handler = arg(c, 0, "handler").map(|h| match h {
                    // `Items.as_view()`: the class.
                    Expr::Call(v) => match v.func.as_ref() {
                        Expr::Attribute(x) if x.attr.as_str() == "as_view" => x.value.as_ref(),
                        _ => h,
                    },
                    h => h,
                });
                let (Some(target), Some(path)) = (
                    handler.and_then(|h| named(self, h)),
                    arg(c, 1, "uri").and_then(string_value),
                ) else {
                    return;
                };
                self.framework_read(handler);
                self.out.frameworks.routes.push(RawFrameworkRoute {
                    router: parent,
                    target,
                    path,
                    methods: upper_methods(keyword(c, "methods")),
                    line,
                });
            }
            "register_middleware" => {
                let Some(hook) = arg(c, 0, "middleware").and_then(|h| named(self, h)) else {
                    return;
                };
                let request = match arg(c, 1, "attach_to") {
                    None => true,
                    Some(e) => match string_value(e).as_deref() {
                        Some("request") => true,
                        Some("response") => false,
                        _ => return,
                    },
                };
                self.framework_read(arg(c, 0, "middleware"));
                self.out.frameworks.hooks.push(RawFrameworkHook {
                    router: parent,
                    hook,
                    request,
                    middleware: false,
                });
            }
            _ => {}
        }
    }
}
