//! Lowering for the servers and task queues the first adapters do not read:
//! aiohttp, Tornado and Falcon applications, Django Channels routing, Django
//! management commands, Huey tasks and arq workers.
//!
//! Each is read from its documented API only, keyed on the package the
//! constructor, decorator or base class comes from (`aiohttp.web.Application`,
//! `tornado.web.Application`, `falcon.App`, `channels.routing.URLRouter`, a
//! `huey.*Huey` instance, `arq.cron.cron`). What is written here is a listing made
//! since the measured build: the linker reads it into the listed reading only
//! (`link::servers`), so what mining reads of every file stays what it was.
//!
//! The model is one of nodes and routes. A node is something routes are added to:
//! an application, a route table (`web.RouteTableDef()`, a list of Tornado rules or
//! of Channels patterns), or a parameter of a function that is handed one
//! (`def setup_routes(app)`). A route names its node, its path as written and its
//! handler. Mounts put one node under another with a prefix (`add_subapp`,
//! `add_routes(table)`, `URLRouter(...)` in a `ProtocolTypeRouter`), and passes
//! say which node a parameter is (`setup_routes(app)`). Hooks are what an
//! application or a mount runs before every request of what it serves. A path or a
//! handler that is not written out is not guessed: the line is kept
//! ([`RawServers::unplaced`]) for the report of routes in no inventory.

use serde::{Deserialize, Serialize};

use super::*;

/// What one file says of the servers and queues of this module.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawServers {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<RawNodeDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RawServerRoute>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<RawNodeMount>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub passes: Vec<RawNodePass>,
    /// Hooks added to a node after it is built (`app.middlewares.append(m)`,
    /// Falcon's `app.add_middleware(m)`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub node_hooks: Vec<(RawNode, RawServerHook)>,
    /// Module-level classes named `Command` with a base: a Django management
    /// command where the file is `<app>/management/commands/<name>.py`, which only
    /// the linker knows (lowering does not read the path).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commands: Vec<String>,
    /// Falcon's `@falcon.before(hook)`, by the class or responder it is written on
    /// (`Things`, `Things.on_get`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub before: Vec<(String, RawServerHook)>,
    /// Lines of registrations of these frameworks whose path or handler is not
    /// written where they are made (a loop over a table, a computed path).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unplaced: Vec<u32>,
}

impl RawServers {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// The file gives entry points or guards to other files' symbols
    /// (`index::is_global`): a route, a mount, a pass or a hook. A management
    /// command or a Falcon hook only says something of the file itself.
    /// A decorator that registers its own symbol (`@huey.task()`) only says
    /// something of the file it is in.
    pub fn reaches_other_files(&self) -> bool {
        !(self.nodes.is_empty()
            && self.routes.iter().all(|r| r.decorator.is_some())
            && self.mounts.is_empty()
            && self.passes.is_empty()
            && self.node_hooks.is_empty())
    }
}

/// Something routes are added to.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawNode {
    /// A name of the module or an import (`app`, `views.routes`), a local of a
    /// function (`create_app.app`), or a table written in place (`<line>`).
    Ref(RawRef),
    /// A positional parameter of a module-level function or method
    /// (`setup_routes(app)`): the node a pass hands it ([`RawNodePass`]).
    Param { function: String, index: u32 },
}

/// A node built in this file.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawNodeDef {
    pub node: RawRef,
    /// `aiohttp`, `tornado`, `falcon`, `channels`, `huey`.
    pub adapter: String,
    /// A route table: it serves only where an application mounts it. One that
    /// nothing mounts serves nothing, but an aiohttp `RouteTableDef`, which is
    /// made to be added by `add_routes`: its routes are listed under a prefix that
    /// is not known.
    pub table: bool,
    pub hooks: Vec<RawServerHook>,
}

/// What runs before every request of what a node or a mount serves.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawServerHook {
    /// An aiohttp middleware: a function of the request and the handler.
    Middleware(RawRef),
    /// An instance of this class: Falcon runs its `process_request` and
    /// `process_resource`.
    Instance(RawRef),
    /// A function Falcon calls before the responder (`@falcon.before(hook)`).
    Function(RawRef),
    /// An ASGI application wrapped around the routes (a Channels middleware).
    Wraps(RawRef),
    /// Identifies the caller and refuses no one (Channels' `AuthMiddlewareStack`).
    Identifies(RawRef),
    /// Not read, in the code's words: it may be the guard.
    Unread(String),
}

/// A handler registered on a node, or a task on a queue.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawServerRoute {
    /// `None`: a task or job registered by a decorator or a list of no node
    /// (`huey.contrib.djhuey.task`, an arq `WorkerSettings`).
    pub node: Option<RawNode>,
    pub adapter: String,
    /// `http`, `websocket`, `job` or `cron`.
    pub kind: String,
    /// As written; `None` for a job.
    pub path: Option<String>,
    /// Upper case; empty where the handler's own methods say (a class), and `ANY`
    /// for a route of every method.
    pub methods: Vec<String>,
    /// The function, or the class (of an instance) that handles it.
    pub target: RawRef,
    /// Falcon's `suffix=`: the responders `on_<verb>_<suffix>`.
    pub suffix: Option<String>,
    /// A job's name where it is given (`name=`).
    pub name: Option<String>,
    /// The decorator that registers it, by the symbol it is written on: what the
    /// measured build read as a wrap of the symbol is a registration, and no wrap,
    /// in the listed reading.
    pub decorator: Option<(String, RawRef)>,
}

/// One node served under another: `add_subapp(prefix, sub)`, `add_routes(table)`,
/// a Tornado rule table given to an application, `URLRouter(...)` in a
/// `ProtocolTypeRouter`, `path("chat/", URLRouter(...))`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawNodeMount {
    pub parent: RawNode,
    pub child: RawNode,
    pub prefix: String,
    /// Wrappers between the two (`AuthMiddlewareStack(URLRouter(...))`), outermost
    /// first.
    pub hooks: Vec<RawServerHook>,
}

/// A node handed to a function: `setup_routes(app)` makes the function's
/// parameter `index` that node.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawNodePass {
    pub node: RawNode,
    pub callee: RawRef,
    pub index: u32,
}

/// HTTP verbs, lower case, as aiohttp, Tornado and Falcon name methods for them.
const VERBS: &[&str] = &["get", "post", "put", "patch", "delete", "head", "options"];

const AIOHTTP_APPS: &[&str] = &["aiohttp.web.Application", "aiohttp.web_app.Application"];
const AIOHTTP_TABLES: &[&str] = &[
    "aiohttp.web.RouteTableDef",
    "aiohttp.web_routedef.RouteTableDef",
];
/// Documented middleware of aiohttp that refuses no caller (it redirects to a
/// normalised path): no hook.
const AIOHTTP_PLAIN_MIDDLEWARE: &[&str] = &[
    "aiohttp.web.normalize_path_middleware",
    "aiohttp.web_middlewares.normalize_path_middleware",
];
const TORNADO_APPS: &[&str] = &["tornado.web.Application"];
const TORNADO_RULES: &[&str] = &[
    "tornado.web.url",
    "tornado.web.URLSpec",
    "tornado.routing.URLSpec",
];
const FALCON_APPS: &[&str] = &["falcon.App", "falcon.API", "falcon.asgi.App"];
const FALCON_BEFORE: &[&str] = &["falcon.before", "falcon.hooks.before"];
/// Falcon's own middleware that refuses no caller.
const FALCON_PLAIN_MIDDLEWARE: &[&str] =
    &["falcon.CORSMiddleware", "falcon.middleware.CORSMiddleware"];
const CHANNELS_PROTOCOLS: &[&str] = &["channels.routing.ProtocolTypeRouter"];
const CHANNELS_ROUTERS: &[&str] = &["channels.routing.URLRouter"];
/// Channels' wrappers that set `scope["user"]` and refuse no one.
const CHANNELS_IDENTIFY: &[&str] = &[
    "channels.auth.AuthMiddlewareStack",
    "channels.auth.AuthMiddleware",
];
/// Channels' wrappers that check no identity (origin, cookies, sessions).
const CHANNELS_PLAIN: &[&str] = &[
    "channels.security.websocket.AllowedHostsOriginValidator",
    "channels.security.websocket.OriginValidator",
    "channels.sessions.SessionMiddlewareStack",
    "channels.sessions.SessionMiddleware",
    "channels.sessions.CookieMiddleware",
];
const DJANGO_PATH: &[&str] = &[
    "django.urls.path",
    "django.urls.re_path",
    "django.urls.conf.path",
    "django.urls.conf.re_path",
];
/// Huey's decorators on an instance (`Huey.task`, `periodic_task`, `context_task`,
/// huey 3.5.4 `api.py`) and of Django-Huey (`huey.contrib.djhuey`'s `task`,
/// `periodic_task`, `db_task`, `db_periodic_task`, `on_commit_task`), and whether
/// each schedules its task.
const HUEY_DECORATORS: &[(&str, bool)] = &[
    ("task", false),
    ("db_task", false),
    ("context_task", false),
    ("on_commit_task", false),
    ("periodic_task", true),
    ("db_periodic_task", true),
];
const DJHUEY: &str = "huey.contrib.djhuey.";
const ARQ_FUNC: &[&str] = &["arq.func", "arq.worker.func"];
const ARQ_CRON: &[&str] = &["arq.cron", "arq.cron.cron"];
const ARQ_WORKER: &[&str] = &["arq.Worker", "arq.worker.Worker"];

/// What a name stands for in the scope being read.
#[derive(Clone)]
enum Bound<'t> {
    Node(RawNode),
    /// An instance of this class (a Falcon resource).
    Instance(RawRef),
    /// A list written in place (Tornado's rules, Channels' patterns).
    List(&'t Expr),
}

#[derive(Default, Clone)]
struct Scope<'t> {
    /// The function the scope is the body of (`create_app`, `App.__init__`).
    function: Option<String>,
    names: BTreeMap<String, Bound<'t>>,
}

impl<'t> Scope<'t> {
    /// The reference a name bound in this scope has (`create_app.app`), or a
    /// module-level one.
    fn local_ref(&self, name: &str) -> RawRef {
        match &self.function {
            Some(f) => RawRef {
                base: RawBase::Local(f.clone()),
                member: format!(".{name}"),
            },
            None => RawRef {
                base: RawBase::Local(name.to_string()),
                member: String::new(),
            },
        }
    }
}

fn http_verb(attr: &str) -> Option<String> {
    VERBS.contains(&attr).then(|| attr.to_ascii_uppercase())
}

/// `^/x/(\d+)$` -> `/x/(\d+)`: a regex route as written, but its anchors.
fn strip_anchors(s: &str) -> String {
    s.trim_start_matches('^').trim_end_matches('$').to_string()
}

fn is(d: &Option<String>, list: &[&str]) -> bool {
    d.as_deref().is_some_and(|d| list.contains(&d))
}

/// The Falcon responder a method name is (`on_get`, `on_post_item`): its verb and
/// suffix.
pub(crate) fn responder(method: &str) -> Option<(String, Option<String>)> {
    let rest = method.strip_prefix("on_")?;
    let (verb, suffix) = match rest.split_once('_') {
        Some((v, s)) => (v, Some(s.to_string())),
        None => (rest, None),
    };
    http_verb(verb).map(|v| (v, suffix))
}

impl<'t> Lowerer<'t> {
    /// The file imports a module of `package` (`aiohttp`, `aiohttp.web`).
    fn imports_module(&self, package: &str) -> bool {
        let dotted = format!("{package}.");
        self.out
            .imports
            .iter()
            .any(|i| i.spec == package || i.spec.starts_with(&dotted))
    }

    /// The file imports aiohttp's server API (`from aiohttp import web`, `import
    /// aiohttp.web`): an aiohttp client alone does not make a call a route.
    fn imports_aiohttp_web(&self) -> bool {
        self.out.imports.iter().any(|i| {
            i.spec.starts_with("aiohttp.web")
                || (i.spec == "aiohttp" && i.names.iter().any(|n| n.starts_with("web")))
        })
    }

    fn dotted_call(&self, c: &ast::ExprCall) -> Option<String> {
        self.dotted_of(&c.func)
    }

    /// Every server and queue of the module ([`RawServers`]).
    pub(crate) fn lower_servers(&mut self, body: &'t [Stmt]) {
        let mut out = RawServers::default();
        let mut scope = Scope::default();
        self.servers_body(body, &mut scope, &mut out, true);
        for st in body {
            match st {
                Stmt::FunctionDef(f) => {
                    self.servers_decorators(f.name.as_str(), &f.decorator_list, &mut out)
                }
                Stmt::ClassDef(c) => self.servers_class(c, &mut out),
                _ => {}
            }
        }
        out.nodes.sort();
        out.nodes.dedup();
        out.routes.sort();
        out.routes.dedup();
        out.mounts.sort();
        out.mounts.dedup();
        out.passes.sort();
        out.passes.dedup();
        out.node_hooks.sort();
        out.node_hooks.dedup();
        out.commands.sort();
        out.commands.dedup();
        out.before.sort();
        out.before.dedup();
        out.unplaced.sort();
        out.unplaced.dedup();
        self.out.servers = out;
    }

    /// The statements of one scope, in order: what each binds, and the calls it
    /// makes. Nested blocks are the same scope; a function is a scope of its own.
    fn servers_body(
        &mut self,
        body: &'t [Stmt],
        scope: &mut Scope<'t>,
        out: &mut RawServers,
        module: bool,
    ) {
        for st in body {
            match st {
                Stmt::Assign(a) => {
                    if let [Expr::Name(n)] = a.targets.as_slice() {
                        self.servers_assign(n.id.as_str(), &a.value, scope, out, module);
                    }
                    self.servers_expr(&a.value, scope, out);
                }
                Stmt::Expr(e) => self.servers_expr(&e.value, scope, out),
                Stmt::Return(r) => {
                    if let Some(v) = &r.value {
                        // An application built where it is returned (`return
                        // tornado.web.Application([...])`): a node of its own.
                        if let Expr::Call(c) = v.as_ref()
                            && let Some(def) =
                                self.server_node(&scope.local_ref("<returned>"), c, scope, out)
                        {
                            out.nodes.push(def);
                        }
                        self.servers_expr(v, scope, out);
                    }
                }
                Stmt::If(i) => {
                    self.servers_body(&i.body, scope, out, module);
                    for c in &i.elif_else_clauses {
                        self.servers_body(&c.body, scope, out, module);
                    }
                }
                Stmt::With(w) => self.servers_body(&w.body, scope, out, module),
                Stmt::Try(t) => {
                    self.servers_body(&t.body, scope, out, module);
                    self.servers_body(&t.orelse, scope, out, module);
                    self.servers_body(&t.finalbody, scope, out, module);
                }
                Stmt::For(f) => self.servers_body(&f.body, scope, out, module),
                Stmt::FunctionDef(f) if module => {
                    self.servers_function(f.name.as_str(), f, None, out);
                }
                Stmt::ClassDef(c) if module => {
                    // A Tornado application of the repository's own class gives its
                    // rules to the base's constructor (`super().__init__(handlers,
                    // **settings)`).
                    let tornado = c.arguments.as_ref().is_some_and(|a| {
                        a.args.iter().any(|b| is(&self.dotted_of(b), TORNADO_APPS))
                    });
                    let app = RawRef {
                        base: RawBase::Local(c.name.to_string()),
                        member: String::new(),
                    };
                    if tornado {
                        out.nodes.push(RawNodeDef {
                            node: app.clone(),
                            adapter: "tornado".into(),
                            table: false,
                            hooks: vec![],
                        });
                    }
                    for m in &c.body {
                        if let Stmt::FunctionDef(f) = m {
                            let name = format!("{}.{}", c.name, f.name);
                            let own =
                                (tornado && f.name.as_str() == "__init__").then(|| app.clone());
                            self.servers_function(&name, f, own, out);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// A function's body, its parameters bound to the nodes passes hand them.
    fn servers_function(
        &mut self,
        name: &str,
        f: &'t ast::StmtFunctionDef,
        app: Option<RawRef>,
        out: &mut RawServers,
    ) {
        let mut scope = Scope {
            function: Some(name.to_string()),
            names: BTreeMap::new(),
        };
        let method = name.contains('.');
        for (i, p) in f
            .parameters
            .posonlyargs
            .iter()
            .chain(&f.parameters.args)
            .skip(usize::from(method))
            .enumerate()
        {
            scope.names.insert(
                p.parameter.name.to_string(),
                Bound::Node(RawNode::Param {
                    function: name.to_string(),
                    index: i as u32,
                }),
            );
        }
        if let Some(app) = app {
            scope
                .names
                .insert("<application>".into(), Bound::Node(RawNode::Ref(app)));
        }
        self.servers_body(&f.body, &mut scope, out, false);
    }

    /// What a name is bound to: an application, a table, a resource, a list.
    fn servers_assign(
        &mut self,
        name: &str,
        value: &'t Expr,
        scope: &mut Scope<'t>,
        out: &mut RawServers,
        module: bool,
    ) {
        let node = scope.local_ref(name);
        match value {
            Expr::Call(c) => {
                if let Some(def) = self.server_node(&node, c, scope, out) {
                    out.nodes.push(def);
                    scope
                        .names
                        .insert(name.to_string(), Bound::Node(RawNode::Ref(node)));
                } else if let Expr::Name(_) | Expr::Attribute(_) = c.func.as_ref()
                    && let Some(class) = self.canon(&c.func)
                    && !matches!(class.base, RawBase::Global(_))
                {
                    // An instance (a Falcon resource): its class handles the route.
                    scope.names.insert(name.to_string(), Bound::Instance(class));
                }
            }
            Expr::List(_) | Expr::Tuple(_) => {
                scope.names.insert(name.to_string(), Bound::List(value));
                // A module-level table another file may give an application: read
                // here, served where a mount names it.
                if module {
                    self.server_table(&RawNode::Ref(node), value, scope, out, true);
                }
            }
            _ => {}
        }
    }

    /// The node a constructor call builds, with its hooks and the routes given to it.
    fn server_node(
        &mut self,
        node: &RawRef,
        c: &'t ast::ExprCall,
        scope: &Scope<'t>,
        out: &mut RawServers,
    ) -> Option<RawNodeDef> {
        let d = self.dotted_call(c);
        let at = RawNode::Ref(node.clone());
        let def = |adapter: &str, table: bool, hooks: Vec<RawServerHook>| RawNodeDef {
            node: node.clone(),
            adapter: adapter.into(),
            table,
            hooks,
        };
        if is(&d, AIOHTTP_APPS) {
            let hooks = self.hook_list(keyword(c, "middlewares"), scope, "aiohttp");
            return Some(def("aiohttp", false, hooks));
        }
        if is(&d, AIOHTTP_TABLES) {
            return Some(def("aiohttp", true, vec![]));
        }
        if is(&d, TORNADO_APPS) {
            if let Some(rules) = arg(c, 0, "handlers") {
                self.server_rules(&at, rules, scope, out);
            }
            return Some(def("tornado", false, vec![]));
        }
        if is(&d, FALCON_APPS) {
            let hooks = self.hook_list(keyword(c, "middleware"), scope, "falcon");
            return Some(def("falcon", false, hooks));
        }
        if is(&d, CHANNELS_PROTOCOLS) {
            if let Some(Expr::Dict(map)) = arg(c, 0, "application_mapping") {
                for item in &map.items {
                    if item.key.as_ref().and_then(string_value).as_deref() == Some("websocket") {
                        self.channels_layers(&at, "", &item.value, vec![], scope, out);
                    }
                }
            }
            return Some(def("channels", false, vec![]));
        }
        if is(&d, CHANNELS_ROUTERS) {
            if let Some(routes) = c.arguments.args.first() {
                self.server_table(&at, routes, scope, out, false);
            }
            return Some(def("channels", true, vec![]));
        }
        if d.as_deref().is_some_and(|d| {
            d.starts_with("huey.") && d.rsplit('.').next().is_some_and(|l| l.ends_with("Huey"))
        }) {
            return Some(def("huey", false, vec![]));
        }
        // `Worker(functions=(), *, ..., cron_jobs=None)`: the functions may be given
        // first (arq 0.28.0 `worker.py`).
        if is(&d, ARQ_WORKER) {
            self.arq_lists(arg(c, 0, "functions"), keyword(c, "cron_jobs"), out);
        }
        None
    }

    /// The hooks of a `middlewares=` / `middleware=` list written in place.
    fn hook_list(&self, e: Option<&Expr>, scope: &Scope<'t>, adapter: &str) -> Vec<RawServerHook> {
        let Some(e) = e else { return vec![] };
        let Some(els) = elements(e) else {
            return vec![RawServerHook::Unread(crate::lower::practice::words(e))];
        };
        els.iter()
            .filter_map(|x| self.server_hook(x, scope, adapter))
            .collect()
    }

    /// One middleware: an aiohttp function, a Falcon instance.
    fn server_hook(&self, x: &Expr, scope: &Scope<'t>, adapter: &str) -> Option<RawServerHook> {
        let unread = || RawServerHook::Unread(crate::lower::practice::words(x));
        match (adapter, x) {
            ("aiohttp", Expr::Name(_) | Expr::Attribute(_)) => match self.canon(x) {
                Some(r) if !matches!(r.base, RawBase::Global(_)) => {
                    Some(RawServerHook::Middleware(r))
                }
                _ => Some(unread()),
            },
            ("aiohttp", Expr::Call(c)) if is(&self.dotted_call(c), AIOHTTP_PLAIN_MIDDLEWARE) => {
                None
            }
            ("falcon", Expr::Call(c)) => match self.canon(&c.func) {
                _ if is(&self.dotted_call(c), FALCON_PLAIN_MIDDLEWARE) => None,
                Some(r) if !matches!(r.base, RawBase::Global(_)) => {
                    Some(RawServerHook::Instance(r))
                }
                _ => Some(unread()),
            },
            ("falcon", Expr::Name(n)) => match scope.names.get(n.id.as_str()) {
                Some(Bound::Instance(class)) => Some(RawServerHook::Instance(class.clone())),
                _ => Some(unread()),
            },
            _ => Some(unread()),
        }
    }

    /// The node an expression names: a name of this scope bound to one, a
    /// parameter, or a name of the module or an import.
    fn server_receiver(&self, e: &Expr, scope: &Scope<'t>) -> Option<RawNode> {
        if let Expr::Name(n) = e
            && let Some(b) = scope.names.get(n.id.as_str())
        {
            return match b {
                Bound::Node(node) => Some(node.clone()),
                _ => None,
            };
        }
        if let Expr::Call(c) = e
            && c.arguments.is_empty()
            && let Expr::Name(n) = c.func.as_ref()
            && n.id.as_str() == "super"
        {
            return None;
        }
        let r = self.canon(e)?;
        (!matches!(r.base, RawBase::Global(_) | RawBase::Star(_))).then_some(RawNode::Ref(r))
    }

    /// The handler a registration is given: a function or class by name, an
    /// instance made in place (`Things()`), or a name of this scope bound to one.
    fn server_target(&self, e: &Expr, scope: &Scope<'t>) -> Option<RawRef> {
        let r = match e {
            Expr::Name(n) => match scope.names.get(n.id.as_str()) {
                Some(Bound::Instance(class)) => return Some(class.clone()),
                Some(_) => return None,
                None => self.canon(e)?,
            },
            Expr::Attribute(_) => self.canon(e)?,
            Expr::Call(c) if matches!(c.func.as_ref(), Expr::Name(_) | Expr::Attribute(_)) => {
                let r = self.canon(&c.func)?;
                // `ChatConsumer.as_asgi()`: the class.
                match r.member.strip_suffix(".as_asgi") {
                    Some(class) => RawRef {
                        base: r.base,
                        member: class.to_string(),
                    },
                    None => r,
                }
            }
            _ => return None,
        };
        (!matches!(r.base, RawBase::Global(_)) && !r.member.contains('(')).then_some(r)
    }

    /// Every call of an expression that registers on a node.
    fn servers_expr(&mut self, e: &'t Expr, scope: &Scope<'t>, out: &mut RawServers) {
        let Expr::Call(c) = e else {
            if let Expr::Await(a) = e {
                self.servers_expr(&a.value, scope, out);
            }
            return;
        };
        for a in c.arguments.args.iter() {
            self.servers_expr(a, scope, out);
        }
        let line = self.line(c);
        let Expr::Attribute(a) = c.func.as_ref() else {
            self.server_pass(c, scope, out);
            return;
        };
        let attr = a.attr.as_str();
        // `app.router.add_get(path, handler)` and the other methods of aiohttp's
        // router.
        if let Expr::Attribute(inner) = a.value.as_ref()
            && inner.attr.as_str() == "router"
            && let Some(method) = attr.strip_prefix("add_")
        {
            let Some(node) = self.server_receiver(&inner.value, scope) else {
                return;
            };
            // `app.router.add_routes([...])`: the router's own `add_routes`.
            if method == "routes" {
                self.aiohttp_add_routes(node, c, scope, out, line);
                return;
            }
            let (methods, path, handler) = match method {
                "route" => (
                    arg(c, 0, "method").and_then(string_value).map(|m| {
                        vec![if m == "*" {
                            "ANY".into()
                        } else {
                            m.to_ascii_uppercase()
                        }]
                    }),
                    arg(c, 1, "path"),
                    arg(c, 2, "handler"),
                ),
                "view" => (Some(vec![]), arg(c, 0, "path"), arg(c, 1, "handler")),
                m => match http_verb(m) {
                    Some(v) => (Some(vec![v]), arg(c, 0, "path"), arg(c, 1, "handler")),
                    None => return,
                },
            };
            self.server_route(
                node, "aiohttp", "http", methods, path, handler, scope, out, line,
            );
            return;
        }
        // `app.middlewares.append(m)`: aiohttp's list, before the app starts.
        if matches!(attr, "append" | "extend" | "insert")
            && let Expr::Attribute(list) = a.value.as_ref()
            && list.attr.as_str() == "middlewares"
        {
            if let Some(app) = self.server_receiver(&list.value, scope)
                && let Some(x) = c.arguments.args.last()
            {
                let given: Vec<&Expr> = match (attr, elements(x)) {
                    ("extend", Some(els)) => els.iter().collect(),
                    _ => vec![x],
                };
                for x in given {
                    if let Some(h) = self.server_hook(x, scope, "aiohttp") {
                        out.node_hooks.push((app.clone(), h));
                    }
                }
            }
            return;
        }
        let Some(node) = self.server_receiver(&a.value, scope) else {
            // `super().__init__(handlers, **settings)` of a Tornado application
            // class.
            if attr == "__init__"
                && let Some(Bound::Node(app)) = scope.names.get("<application>")
                && let Some(rules) = c.arguments.args.first()
            {
                let app = app.clone();
                self.server_rules(&app, rules, scope, out);
            }
            return;
        };
        match attr {
            "add_routes" => self.aiohttp_add_routes(node, c, scope, out, line),
            "add_subapp" => {
                let prefix = arg(c, 0, "prefix").and_then(string_value);
                let child = arg(c, 1, "subapp").and_then(|s| self.server_receiver(s, scope));
                match (prefix, child) {
                    (Some(prefix), Some(child)) => out.mounts.push(RawNodeMount {
                        parent: node,
                        child,
                        prefix,
                        hooks: vec![],
                    }),
                    _ => out.unplaced.push(line),
                }
            }
            // Falcon: `app.add_route("/things/{id}", Things(), suffix="item")`.
            "add_route" if self.imports_module("falcon") => {
                let suffix = keyword(c, "suffix").and_then(string_value);
                let target = arg(c, 1, "resource").and_then(|r| self.server_target(r, scope));
                match (arg(c, 0, "uri_template").and_then(string_value), target) {
                    (Some(path), Some(target)) => out.routes.push(RawServerRoute {
                        node: Some(node),
                        adapter: "falcon".into(),
                        kind: "http".into(),
                        path: Some(path),
                        methods: vec![],
                        target,
                        suffix,
                        name: None,
                        decorator: None,
                    }),
                    _ => out.unplaced.push(line),
                }
            }
            "add_middleware" if self.imports_module("falcon") => {
                if let Some(m) = arg(c, 0, "middleware") {
                    for x in elements(m).map_or_else(|| vec![m], |els| els.iter().collect()) {
                        if let Some(h) = self.server_hook(x, scope, "falcon") {
                            out.node_hooks.push((node.clone(), h));
                        }
                    }
                }
            }
            // Tornado: `app.add_handlers(r".*", [(r"/x", X)])`.
            "add_handlers" if self.imports_module("tornado") => {
                if let Some(rules) = arg(c, 1, "host_handlers") {
                    self.server_rules(&node, rules, scope, out);
                }
            }
            _ => self.server_pass(c, scope, out),
        }
    }

    /// `app.add_routes(...)` / `app.router.add_routes(...)`: route definitions
    /// written in place or bound to a list, or a table (`RouteTableDef`) mounted.
    fn aiohttp_add_routes(
        &mut self,
        node: RawNode,
        c: &'t ast::ExprCall,
        scope: &Scope<'t>,
        out: &mut RawServers,
        line: u32,
    ) {
        match c.arguments.args.first() {
            Some(table @ (Expr::List(_) | Expr::Tuple(_))) => {
                self.aiohttp_defs(&node, table, scope, out);
            }
            Some(Expr::Name(n))
                if matches!(scope.names.get(n.id.as_str()), Some(Bound::List(_))) =>
            {
                if let Some(Bound::List(table)) = scope.names.get(n.id.as_str()) {
                    let table = *table;
                    self.aiohttp_defs(&node, table, scope, out);
                }
            }
            Some(t) => match self.server_receiver(t, scope) {
                Some(child) => out.mounts.push(RawNodeMount {
                    parent: node,
                    child,
                    prefix: String::new(),
                    hooks: vec![],
                }),
                None => out.unplaced.push(line),
            },
            None => {}
        }
    }

    /// A node handed to a function (`setup_routes(app)`).
    fn server_pass(&self, c: &ast::ExprCall, scope: &Scope<'t>, out: &mut RawServers) {
        let Some(callee) = self.canon(&c.func) else {
            return;
        };
        if matches!(callee.base, RawBase::Global(_)) {
            return;
        }
        for (i, a) in c.arguments.args.iter().enumerate() {
            let node = match a {
                Expr::Name(n) => match scope.names.get(n.id.as_str()) {
                    Some(Bound::Node(node)) => Some(node.clone()),
                    _ => None,
                },
                _ => None,
            };
            if let Some(node) = node {
                out.passes.push(RawNodePass {
                    node,
                    callee: callee.clone(),
                    index: i as u32,
                });
            }
        }
    }

    /// A route whose path and handler are what the call is given.
    #[allow(clippy::too_many_arguments)]
    fn server_route(
        &self,
        node: RawNode,
        adapter: &str,
        kind: &str,
        methods: Option<Vec<String>>,
        path: Option<&Expr>,
        handler: Option<&Expr>,
        scope: &Scope<'t>,
        out: &mut RawServers,
        line: u32,
    ) {
        let path = path.and_then(string_value);
        let target = handler.and_then(|h| self.server_target(h, scope));
        match (methods, path, target) {
            (Some(methods), Some(path), Some(target)) => out.routes.push(RawServerRoute {
                node: Some(node),
                adapter: adapter.into(),
                kind: kind.into(),
                path: Some(path),
                methods,
                target,
                suffix: None,
                name: None,
                decorator: None,
            }),
            _ => out.unplaced.push(line),
        }
    }

    /// `add_routes([web.get("/", index), web.view("/x", X), ...])`.
    fn aiohttp_defs(&self, node: &RawNode, table: &Expr, scope: &Scope<'t>, out: &mut RawServers) {
        let Some(els) = elements(table) else { return };
        for x in els {
            let Expr::Call(c) = x else {
                out.unplaced.push(self.line(x));
                continue;
            };
            let d = self.dotted_call(c).unwrap_or_default();
            let Some(method) = d
                .strip_prefix("aiohttp.web.")
                .or_else(|| d.strip_prefix("aiohttp.web_routedef."))
            else {
                continue;
            };
            let (methods, path, handler) = match method {
                "route" => (
                    arg(c, 0, "method").and_then(string_value).map(|m| {
                        vec![if m == "*" {
                            "ANY".into()
                        } else {
                            m.to_ascii_uppercase()
                        }]
                    }),
                    arg(c, 1, "path"),
                    arg(c, 2, "handler"),
                ),
                "view" => (Some(vec![]), arg(c, 0, "path"), arg(c, 1, "handler")),
                m => match http_verb(m) {
                    Some(v) => (Some(vec![v]), arg(c, 0, "path"), arg(c, 1, "handler")),
                    None => continue,
                },
            };
            self.server_route(
                node.clone(),
                "aiohttp",
                "http",
                methods,
                path,
                handler,
                scope,
                out,
                self.line(c),
            );
        }
    }

    /// Tornado's rules given to an application: a list written in place, a name of
    /// the scope bound to one, or a table of the module or another file.
    fn server_rules(
        &self,
        app: &RawNode,
        rules: &'t Expr,
        scope: &Scope<'t>,
        out: &mut RawServers,
    ) {
        let rules = match rules {
            Expr::Name(n) => match scope.names.get(n.id.as_str()) {
                Some(Bound::List(l)) => *l,
                _ => rules,
            },
            other => other,
        };
        if elements(rules).is_some() {
            self.tornado_rules(app, rules, scope, out);
            return;
        }
        match self.server_receiver(rules, scope) {
            Some(child) => out.mounts.push(RawNodeMount {
                parent: app.clone(),
                child,
                prefix: String::new(),
                hooks: vec![],
            }),
            None => out.unplaced.push(self.line(rules)),
        }
    }

    /// `[(r"/", Home), url(r"/x/(\d+)", X, name="x"), ...]`.
    fn tornado_rules(
        &self,
        node: &RawNode,
        rules: &Expr,
        scope: &Scope<'t>,
        out: &mut RawServers,
    ) -> bool {
        let Some(els) = elements(rules) else {
            return false;
        };
        let mut any = false;
        for x in els {
            let (pattern, handler) = match x {
                Expr::Tuple(t) if t.elts.len() >= 2 => (&t.elts[0], &t.elts[1]),
                Expr::Call(c) if is(&self.dotted_call(c), TORNADO_RULES) => {
                    match (arg(c, 0, "pattern"), arg(c, 1, "handler")) {
                        (Some(p), Some(h)) => (p, h),
                        _ => {
                            out.unplaced.push(self.line(c));
                            continue;
                        }
                    }
                }
                _ => continue,
            };
            let Some(path) = string_value(pattern) else {
                out.unplaced.push(self.line(x));
                continue;
            };
            let Some(target) = self.server_target(handler, scope) else {
                out.unplaced.push(self.line(x));
                continue;
            };
            any = true;
            out.routes.push(RawServerRoute {
                node: Some(node.clone()),
                adapter: "tornado".into(),
                kind: "http".into(),
                path: Some(strip_anchors(&path)),
                methods: vec![],
                target,
                suffix: None,
                name: None,
                decorator: None,
            });
        }
        any
    }

    /// A table of the module: Tornado's rules, or Channels' patterns
    /// (`websocket_urlpatterns = [path("ws/", ChatConsumer.as_asgi())]`), or
    /// what a `URLRouter(...)` is given. A module-level list is only a candidate:
    /// it is recorded as a table node, served where a mount names it.
    fn server_table(
        &mut self,
        node: &RawNode,
        value: &'t Expr,
        scope: &Scope<'t>,
        out: &mut RawServers,
        candidate: bool,
    ) {
        let RawNode::Ref(r) = node else { return };
        let value = match value {
            Expr::Name(n) => match scope.names.get(n.id.as_str()) {
                Some(Bound::List(l)) => *l,
                _ => value,
            },
            other => other,
        };
        if elements(value).is_none() {
            // `URLRouter(websocket_urlpatterns)`: the table of that name.
            if !candidate && let Some(child) = self.server_receiver(value, scope) {
                out.mounts.push(RawNodeMount {
                    parent: node.clone(),
                    child,
                    prefix: String::new(),
                    hooks: vec![],
                });
            }
            return;
        }
        // A module-level list of pairs is a Tornado table only in a file that
        // imports Tornado: `choices = [("a", _("A"))]` is none.
        let tornado = (!candidate || self.imports_module("tornado")) && {
            let mut probe = RawServers::default();
            self.tornado_rules(node, value, scope, &mut probe) && {
                out.routes.extend(probe.routes);
                out.unplaced.extend(probe.unplaced);
                true
            }
        };
        if tornado {
            out.nodes.push(RawNodeDef {
                node: r.clone(),
                adapter: "tornado".into(),
                table: true,
                hooks: vec![],
            });
            return;
        }
        let channels = self.channels_patterns(node, value, scope, out, candidate);
        if channels {
            out.nodes.push(RawNodeDef {
                node: r.clone(),
                adapter: "channels".into(),
                table: true,
                hooks: vec![],
            });
        }
    }

    /// `path("ws/chat/<room>/", ChatConsumer.as_asgi())` and `re_path(...)`, and
    /// `path("chat/", URLRouter(...))`. A module-level list is read only where a
    /// pattern names its consumer by `.as_asgi()` (Channels 3): a Django URLconf is
    /// no Channels table. One given to a `URLRouter` in place is read whatever it
    /// names (Channels 2 routes the class itself).
    fn channels_patterns(
        &mut self,
        node: &RawNode,
        value: &'t Expr,
        scope: &Scope<'t>,
        out: &mut RawServers,
        candidate: bool,
    ) -> bool {
        let Some(els) = elements(value) else {
            return false;
        };
        let asgi = |v: &Expr| {
            matches!(v, Expr::Call(c) if matches!(c.func.as_ref(),
                Expr::Attribute(a) if a.attr.as_str() == "as_asgi"))
        };
        let views: Vec<&ast::ExprCall> = els
            .iter()
            .filter_map(|x| match x {
                Expr::Call(c) if is(&self.dotted_call(c), DJANGO_PATH) => Some(c),
                _ => None,
            })
            .collect();
        if candidate && !views.iter().any(|c| arg(c, 1, "view").is_some_and(asgi)) {
            return false;
        }
        let mut any = false;
        for c in views {
            let Some(route) = arg(c, 0, "route").and_then(string_value) else {
                out.unplaced.push(self.line(c));
                continue;
            };
            let route = strip_anchors(&route);
            let Some(view) = arg(c, 1, "view") else {
                continue;
            };
            any = true;
            // `path("chat/", URLRouter(chat_urls))`: a table under a prefix.
            if let Expr::Call(inner) = view
                && is(&self.dotted_call(inner), CHANNELS_ROUTERS)
            {
                let child = RawRef {
                    base: RawBase::Local(format!("<{}>", self.line(inner))),
                    member: String::new(),
                };
                out.nodes.push(RawNodeDef {
                    node: child.clone(),
                    adapter: "channels".into(),
                    table: true,
                    hooks: vec![],
                });
                if let Some(t) = inner.arguments.args.first() {
                    self.server_table(&RawNode::Ref(child.clone()), t, scope, out, false);
                }
                out.mounts.push(RawNodeMount {
                    parent: node.clone(),
                    child: RawNode::Ref(child),
                    prefix: route,
                    hooks: vec![],
                });
                continue;
            }
            let Some(target) = self.server_target(view, scope) else {
                out.unplaced.push(self.line(c));
                continue;
            };
            out.routes.push(RawServerRoute {
                node: Some(node.clone()),
                adapter: "channels".into(),
                kind: "websocket".into(),
                path: Some(route),
                methods: vec![],
                target,
                suffix: None,
                name: None,
                decorator: None,
            });
        }
        any
    }

    /// The layers of a `ProtocolTypeRouter`'s `"websocket"` application down to its
    /// `URLRouter`: each wrapper is a hook of the mount.
    fn channels_layers(
        &mut self,
        parent: &RawNode,
        prefix: &str,
        e: &'t Expr,
        mut hooks: Vec<RawServerHook>,
        scope: &Scope<'t>,
        out: &mut RawServers,
    ) {
        let mount = |child: RawNode, hooks: Vec<RawServerHook>, out: &mut RawServers| {
            out.mounts.push(RawNodeMount {
                parent: parent.clone(),
                child,
                prefix: prefix.to_string(),
                hooks,
            });
        };
        let Expr::Call(c) = e else {
            // A router bound to a name (`websocket = URLRouter(...)`).
            match self.server_receiver(e, scope) {
                Some(child) => mount(child, hooks, out),
                None => out.unplaced.push(self.line(e)),
            }
            return;
        };
        let d = self.dotted_call(c);
        if is(&d, CHANNELS_ROUTERS) {
            let child = RawNode::Ref(RawRef {
                base: RawBase::Local(format!("<{}>", self.line(c))),
                member: String::new(),
            });
            if let RawNode::Ref(cr) = &child {
                out.nodes.push(RawNodeDef {
                    node: cr.clone(),
                    adapter: "channels".into(),
                    table: true,
                    hooks: vec![],
                });
            }
            if let Some(t) = c.arguments.args.first() {
                self.server_table(&child, t, scope, out, false);
            }
            mount(child, hooks, out);
            return;
        }
        let Some(inner) = c.arguments.args.first() else {
            out.unplaced.push(self.line(c));
            return;
        };
        match self.canon(&c.func) {
            _ if is(&d, CHANNELS_PLAIN) => {}
            Some(r) if is(&d, CHANNELS_IDENTIFY) => hooks.push(RawServerHook::Identifies(r)),
            Some(r) if !matches!(r.base, RawBase::Global(_)) => hooks.push(RawServerHook::Wraps(r)),
            _ => hooks.push(RawServerHook::Unread(crate::lower::practice::words(
                &c.func,
            ))),
        }
        self.channels_layers(parent, prefix, inner, hooks, scope, out);
    }

    /// Decorators of a module-level function or class that register it: an
    /// aiohttp `RouteTableDef`'s (`@routes.get("/")`, `@routes.view("/x")`), a
    /// Huey instance's (`@huey.task()`, `@huey.periodic_task(crontab(...))`) and
    /// Django-Huey's.
    fn servers_decorators(
        &self,
        symbol: &str,
        decorators: &[ast::Decorator],
        out: &mut RawServers,
    ) {
        for d in decorators {
            let (func, call) = match &d.expression {
                Expr::Call(c) => (c.func.as_ref(), Some(c)),
                e => (e, None),
            };
            let Some(deco) = self.canon(func) else {
                continue;
            };
            let dd = dotted(&deco);
            // Django-Huey: `from huey.contrib.djhuey import task`.
            if let Some(which) = dd.as_deref().and_then(|d| d.strip_prefix(DJHUEY))
                && let Some((_, periodic)) = HUEY_DECORATORS.iter().find(|(n, _)| *n == which)
            {
                self.huey_task(symbol, None, &deco, call, *periodic, out);
                continue;
            }
            let Expr::Attribute(a) = func else { continue };
            let Some(receiver) = self.canon(&a.value) else {
                continue;
            };
            if matches!(receiver.base, RawBase::Global(_) | RawBase::Star(_)) {
                continue;
            }
            let attr = a.attr.as_str();
            if let Some((_, periodic)) = HUEY_DECORATORS.iter().find(|(n, _)| *n == attr) {
                self.huey_task(
                    symbol,
                    Some(RawNode::Ref(receiver)),
                    &deco,
                    call,
                    *periodic,
                    out,
                );
                continue;
            }
            // aiohttp: the linker keeps it where the receiver is a `RouteTableDef`.
            // Read in a file that imports aiohttp's server API only: a FastAPI
            // router's `@router.get` is none.
            let Some(c) = call.filter(|_| self.imports_aiohttp_web()) else {
                continue;
            };
            let (methods, path) = match attr {
                "route" => (
                    arg(c, 0, "method").and_then(string_value).map(|m| {
                        vec![if m == "*" {
                            "ANY".into()
                        } else {
                            m.to_ascii_uppercase()
                        }]
                    }),
                    arg(c, 1, "path"),
                ),
                "view" => (Some(vec![]), arg(c, 0, "path")),
                m => match http_verb(m) {
                    Some(v) => (Some(vec![v]), arg(c, 0, "path")),
                    None => continue,
                },
            };
            let (Some(methods), Some(path)) = (methods, path.and_then(string_value)) else {
                continue;
            };
            out.routes.push(RawServerRoute {
                node: Some(RawNode::Ref(receiver)),
                adapter: "aiohttp".into(),
                kind: "http".into(),
                path: Some(path),
                methods,
                target: RawRef {
                    base: RawBase::Local(symbol.to_string()),
                    member: String::new(),
                },
                suffix: None,
                name: None,
                decorator: Some((symbol.to_string(), deco)),
            });
        }
    }

    fn huey_task(
        &self,
        symbol: &str,
        node: Option<RawNode>,
        deco: &RawRef,
        call: Option<&ast::ExprCall>,
        periodic: bool,
        out: &mut RawServers,
    ) {
        let name = call.and_then(|c| keyword(c, "name")).and_then(string_value);
        let kinds: &[&str] = if periodic { &["job", "cron"] } else { &["job"] };
        for kind in kinds {
            out.routes.push(RawServerRoute {
                node: node.clone(),
                adapter: "huey".into(),
                kind: (*kind).into(),
                path: None,
                methods: vec![],
                target: RawRef {
                    base: RawBase::Local(symbol.to_string()),
                    member: String::new(),
                },
                suffix: None,
                name: name.clone(),
                decorator: Some((symbol.to_string(), deco.clone())),
            });
        }
    }

    /// A module-level class: a management command, Falcon's hooks on it and on its
    /// responders, an arq worker's settings, and the decorators that register it.
    fn servers_class(&self, c: &'t ast::StmtClassDef, out: &mut RawServers) {
        let name = c.name.as_str();
        let has_base = c.arguments.as_ref().is_some_and(|a| !a.args.is_empty());
        if name == "Command" && has_base {
            out.commands.push(name.to_string());
        }
        self.servers_decorators(name, &c.decorator_list, out);
        for d in &c.decorator_list {
            if let Some(h) = self.falcon_before(d) {
                out.before.push((name.to_string(), h));
            }
        }
        let mut functions = None;
        let mut cron_jobs = None;
        for st in &c.body {
            match st {
                Stmt::FunctionDef(f) if responder(f.name.as_str()).is_some() => {
                    for d in &f.decorator_list {
                        if let Some(h) = self.falcon_before(d) {
                            out.before.push((format!("{name}.{}", f.name), h));
                        }
                    }
                }
                Stmt::Assign(a) => match a.targets.as_slice() {
                    [Expr::Name(n)] if n.id.as_str() == "functions" => functions = Some(&*a.value),
                    [Expr::Name(n)] if n.id.as_str() == "cron_jobs" => cron_jobs = Some(&*a.value),
                    _ => {}
                },
                _ => {}
            }
        }
        if (functions.is_some() || cron_jobs.is_some()) && self.imports_module("arq") {
            self.arq_lists(functions, cron_jobs, out);
        }
    }

    /// `@falcon.before(hook, ...)`: the hook.
    fn falcon_before(&self, d: &ast::Decorator) -> Option<RawServerHook> {
        let Expr::Call(c) = &d.expression else {
            return None;
        };
        if !is(&self.dotted_call(c), FALCON_BEFORE) {
            return None;
        }
        let hook = arg(c, 0, "action")?;
        Some(match self.canon(hook) {
            Some(r)
                if matches!(hook, Expr::Name(_) | Expr::Attribute(_))
                    && !matches!(r.base, RawBase::Global(_)) =>
            {
                RawServerHook::Function(r)
            }
            _ => RawServerHook::Unread(crate::lower::practice::words(hook)),
        })
    }

    /// arq's `functions = [...]` and `cron_jobs = [...]`: jobs and schedules.
    fn arq_lists(&self, functions: Option<&Expr>, cron_jobs: Option<&Expr>, out: &mut RawServers) {
        for (list, kind) in [(functions, "job"), (cron_jobs, "cron")] {
            let Some(list) = list else { continue };
            let Some(els) = elements(list) else {
                out.unplaced.push(self.line(list));
                continue;
            };
            for x in els {
                let (target, name) = match x {
                    Expr::Name(_) | Expr::Attribute(_) if kind == "job" => (self.canon(x), None),
                    Expr::Call(c)
                        if (kind == "job" && is(&self.dotted_call(c), ARQ_FUNC))
                            || (kind == "cron" && is(&self.dotted_call(c), ARQ_CRON)) =>
                    {
                        let first = arg(c, 0, "coroutine");
                        (
                            first
                                .filter(|f| matches!(f, Expr::Name(_) | Expr::Attribute(_)))
                                .and_then(|f| self.canon(f)),
                            keyword(c, "name").and_then(string_value),
                        )
                    }
                    _ => (None, None),
                };
                match target.filter(|t| !matches!(t.base, RawBase::Global(_))) {
                    Some(target) => out.routes.push(RawServerRoute {
                        node: None,
                        adapter: "arq".into(),
                        kind: kind.into(),
                        path: None,
                        methods: vec![],
                        target,
                        suffix: None,
                        name,
                        decorator: None,
                    }),
                    None => out.unplaced.push(self.line(x)),
                }
            }
        }
    }

    /// The methods of a class no view base is read for that these frameworks call,
    /// as symbols of the listed reading only (as [`RawSymbol::late`] handler
    /// methods are): Falcon's responders (`on_get`, `on_post_item`) and middleware
    /// methods (`process_request`, `process_resource`), Tornado's `prepare`, and a
    /// management command's `handle`. A symbol is kept where an entry point or a
    /// hook of the listed reading names it.
    ///
    /// They have no owner: a reader that looks for a class's handler methods by
    /// owner (a Django registration, a preview) reads the class as it did. And what
    /// the lowering writes for one reading only is taken as the listed reading
    /// writes it, so that the test of which files mining links again
    /// (`Linker::links_differently`) reads none of them.
    pub(crate) fn server_late(
        &mut self,
        c: &'t ast::StmtClassDef,
        class: &RawSymbol,
        taken: &[RawSymbol],
    ) -> Vec<RawSymbol> {
        let name = c.name.as_str();
        let has_base = c.arguments.as_ref().is_some_and(|a| !a.args.is_empty());
        let mut out = Vec::new();
        for st in &c.body {
            let Stmt::FunctionDef(f) = st else { continue };
            let m = f.name.as_str();
            let full = format!("{name}.{m}");
            if taken.iter().any(|s| s.name == full) {
                continue;
            }
            let verbs = match responder(m) {
                Some((verb, _)) => Some(vec![verb]),
                None if matches!(
                    m,
                    "process_request"
                        | "process_resource"
                        | "process_request_async"
                        | "process_resource_async"
                ) =>
                {
                    None
                }
                None if m == "prepare" && has_base => None,
                None if m == "handle" && name == "Command" && has_base => None,
                None => continue,
            };
            // Writing nothing to the file's own facts while the method is lowered.
            let kept = std::mem::take(&mut self.out);
            let mut ms = RawSymbol::empty(&full, SymbolKind::Function, self.line(f));
            ms.late = true;
            ms.is_async = f.is_async;
            if let Some(v) = verbs {
                ms.methods = v;
                // The class's decorators wrap its responders, but Falcon's hooks,
                // which the linker reads as hooks ([`RawServers::before`]).
                ms.wraps = class
                    .wraps
                    .iter()
                    .filter(|(r, k)| {
                        *k != WrapKind::Try
                            && !dotted(r).is_some_and(|d| FALCON_BEFORE.contains(&d.as_str()))
                    })
                    .cloned()
                    .collect();
            }
            for (i, d) in f.decorator_list.iter().enumerate() {
                if self.falcon_before(d).is_none() {
                    self.lower_decorator(&full, d, i as u32, &mut ms);
                }
            }
            let mut col = Collector::new(self, false);
            col.function(&f.parameters, &f.body, f.returns.as_deref());
            col.fill(&mut ms);
            self.out = kept;
            as_listed(&mut ms);
            out.push(ms);
        }
        out
    }
}

/// A symbol of the listed reading only, with what the lowering wrote for one of the
/// two readings taken as the listed reading takes it: the sinks read since are
/// sinks, a check read since is a check and one only the measured build reads is
/// none, a decorator that is no name is unresolved, and an exit only the measured
/// build left unread is not one.
fn as_listed(s: &mut RawSymbol) {
    let since = std::mem::take(&mut s.since_sinks);
    s.sinks.extend(since.into_iter().map(|k| {
        k.strip_prefix(crate::raw::SINCE)
            .map_or(k.clone(), str::to_string)
    }));
    s.sinks.sort();
    s.sinks.dedup();
    s.body_checks.retain(|b| !b.measured);
    for b in &mut s.body_checks {
        b.since = false;
    }
    s.controls.retain(|c| c != crate::raw::UNREAD_EXIT_MEASURED);
    for (at, r, words) in std::mem::take(&mut s.since_wraps).into_iter().rev() {
        let r = r.unwrap_or_else(|| RawRef {
            base: RawBase::Global(format!("unresolved:{words}")),
            member: String::new(),
        });
        let at = (at as usize).min(s.wraps.len());
        s.wraps.insert(at, (r, WrapKind::Decorator));
    }
    s.wraps_only.clear();
    s.since_only.clear();
    s.drf_reassigned = None;
}
