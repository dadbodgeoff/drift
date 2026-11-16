//! The applications and routers of Quart, django-ninja, Litestar and Sanic, linked
//! by the shared machinery of the FastAPI and Flask adapters: each is a router of
//! the [`Linker`]'s tables, read by the adapter its API follows (its *model*), so
//! that prefixes, mounts, guards, hooks and Django URL linking are what they are for
//! those two.
//!
//! - Quart is the Flask API on another package: `Quart`, `Blueprint`, `route`,
//!   the verbs, `websocket`, `before_request`, `register_blueprint`. Its entry
//!   points are Flask's.
//! - Sanic's `Sanic` and `Blueprint` follow Flask's model too (a blueprint's
//!   `url_prefix`, replaced by one given where it is mounted; a request hook,
//!   whose answer is the response, before every route of what it is on): mounted
//!   by `app.blueprint(bp)` and `Blueprint.group(...)`, routes added by
//!   `add_route`, hooks by `on_request` and `middleware("request")`.
//! - django-ninja's `NinjaAPI` and `Router` follow FastAPI's model (prefixes join;
//!   typed parameters are parsed), served where Django's URLconf mounts
//!   `api.urls`. Its guard is `auth=`, of the operation, else the one given where
//!   its router is added (`add_router(..., auth=)`), else of the router, else of
//!   the layers above, else of the API: the nearest one given, not all of them. A callable that turns a
//!   caller away by returning a false value is not one either reading of a guard
//!   knows, so what stands there is named and unknown (`drift_mine::py_guards`).
//! - Litestar's `Litestar`, `Router` and `Controller` follow FastAPI's model:
//!   `guards=` of every layer run before the handler, and a guard refuses by
//!   raising. Handlers are registered by `route_handlers=[...]` (the first
//!   argument of `Litestar(...)`); a router's path is its first argument.
//!
//! Each API named here was checked against the published packages' source:
//! Quart 0.23.1 (on Flask 3.1.3's `sansio`), django-ninja 1.8.0, Litestar 2.25.0
//! and Sanic 25.12.1.
//!
//! Every reading here is one the build `a0779066` did not make: asked through
//! [`Linker::since_frozen`], so neither what mining reads nor the compat link
//! has any of it.

use super::*;

/// A router or application class of one of these frameworks.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Framework {
    /// The constructor, canonical.
    class: &'static str,
    /// The framework, for what it reads of its routers.
    pub(super) name: &'static str,
    /// The adapter whose linking it follows (`fastapi`: prefixes join; `flask`: a
    /// mount's prefix replaces the blueprint's own, request hooks).
    pub(super) model: &'static str,
    /// The adapter its entry points name: `flask` for Quart, which is Flask's API.
    pub(super) adapter: &'static str,
    /// An application, served at its own paths.
    pub(super) app: bool,
}

const fn fw(
    class: &'static str,
    name: &'static str,
    model: &'static str,
    adapter: &'static str,
    app: bool,
) -> Framework {
    Framework {
        class,
        name,
        model,
        adapter,
        app,
    }
}

/// The classes, as each framework documents and exports them. The list to extend.
const FRAMEWORKS: &[Framework] = &[
    fw("pkg:quart#Quart", "quart", "flask", "flask", true),
    fw("pkg:quart#app.Quart", "quart", "flask", "flask", true),
    fw("pkg:quart#Blueprint", "quart", "flask", "flask", false),
    fw(
        "pkg:quart#blueprints.Blueprint",
        "quart",
        "flask",
        "flask",
        false,
    ),
    fw("pkg:sanic#Sanic", "sanic", "flask", "sanic", true),
    fw("pkg:sanic#app.Sanic", "sanic", "flask", "sanic", true),
    fw("pkg:sanic#Blueprint", "sanic", "flask", "sanic", false),
    fw(
        "pkg:sanic#blueprints.Blueprint",
        "sanic",
        "flask",
        "sanic",
        false,
    ),
    fw("pkg:ninja#NinjaAPI", "ninja", "fastapi", "ninja", false),
    fw(
        "pkg:ninja#main.NinjaAPI",
        "ninja",
        "fastapi",
        "ninja",
        false,
    ),
    fw("pkg:ninja#Router", "ninja", "fastapi", "ninja", false),
    fw(
        "pkg:ninja#router.Router",
        "ninja",
        "fastapi",
        "ninja",
        false,
    ),
    fw(
        "pkg:litestar#Litestar",
        "litestar",
        "fastapi",
        "litestar",
        true,
    ),
    fw(
        "pkg:litestar#app.Litestar",
        "litestar",
        "fastapi",
        "litestar",
        true,
    ),
    fw(
        "pkg:litestar#Router",
        "litestar",
        "fastapi",
        "litestar",
        false,
    ),
    fw(
        "pkg:litestar#router.Router",
        "litestar",
        "fastapi",
        "litestar",
        false,
    ),
];

/// A Litestar controller class ([`RawFrameworkOptions::class`]).
static CONTROLLER: Framework = fw(
    "pkg:litestar#Controller",
    "litestar",
    "fastapi",
    "litestar",
    false,
);
/// A Sanic blueprint group (`Blueprint.group(...)`).
static GROUP: Framework = fw(
    "pkg:sanic#Blueprint.group",
    "sanic",
    "flask",
    "sanic",
    false,
);

/// What each framework's routers are read for, or does nothing to where and behind
/// what their routes are served: a method called on one, or an attribute read, is
/// not the router handed on to a mount that is not read. The list to extend; any
/// other use of a router leaves what it serves not all known.
const READS: &[(&str, &[&str])] = &[
    (
        "ninja",
        &["urls", "add_router", "exception_handler", "create_response"],
    ),
    (
        "sanic",
        &[
            "blueprint",
            "add_route",
            "register_middleware",
            "on_request",
            "on_response",
            "middleware",
            "listener",
            "before_server_start",
            "after_server_start",
            "before_server_stop",
            "after_server_stop",
            "main_process_start",
            "main_process_stop",
            "exception",
            "static",
            "run",
            "ctx",
        ],
    ),
    (
        "quart",
        &[
            "before_serving",
            "after_serving",
            "while_serving",
            "run_task",
            "before_websocket",
            "before_app_websocket",
        ],
    ),
];

/// What the readings here add to the linker's tables.
#[derive(Debug, Default)]
pub(super) struct Tables {
    /// django-ninja's `auth=` given where a router is added (`add_router(...,
    /// auth=...)`), by (router, parent): in place of the router's own.
    mount_auth: BTreeMap<(String, String), Vec<Dep>>,
    /// Routers whose every use that hands them on is a mount read here, or a
    /// method or attribute their framework reads ([`READS`]).
    explained: BTreeSet<String>,
    /// Quart's websocket hooks, by the blueprint or application they run for.
    websocket_hooks: BTreeMap<String, Vec<String>>,
}

impl Linker<'_> {
    /// The framework of a router or application class: one of [`FRAMEWORKS`], or a
    /// class of the repository built on one. None when linking what mining reads.
    pub(super) fn framework_of(&self, class: &str) -> Option<&'static Framework> {
        let f = self.framework_match(class, 0)?;
        self.since_frozen().then_some(f)
    }

    fn framework_match(&self, class: &str, depth: usize) -> Option<&'static Framework> {
        if let Some(f) = FRAMEWORKS.iter().find(|f| f.class == class) {
            return Some(f);
        }
        if depth > 8 {
            return None;
        }
        let (module, name) = class.split_once('#')?;
        if name.contains(['.', '(']) {
            return None;
        }
        let fi = self.file(module)?;
        let sym = self.files[fi].raw.symbols.iter().find(|s| s.name == name)?;
        if sym.kind != drift_core::SymbolKind::Class {
            return None;
        }
        sym.wraps.iter().find_map(|(base, kind)| {
            (*kind == WrapKind::Extends)
                .then(|| self.framework_match(&self.canon(fi, base), depth + 1))
                .flatten()
        })
    }

    /// The prefix a router of a framework is built with: Flask's model's
    /// `url_prefix=`; Litestar's `path`, given by keyword or first
    /// (`Router("/admin", route_handlers=[...])`: `Router.__init__(self, path, *,
    /// ...)`); none for django-ninja's, whose prefix is given where it is added.
    pub(super) fn framework_prefix(&self, f: &Framework, r: &RawRouter) -> Option<String> {
        match (f.model, f.name) {
            ("flask", _) => r.url_prefix.clone(),
            (_, "litestar") if !f.app => r.path.clone().or_else(|| r.first.clone()),
            (_, "litestar") => r.path.clone(),
            _ => None,
        }
    }

    /// The options read of the router or class `name` of file `fi`.
    fn options_in(&self, fi: usize, name: &str, class: bool) -> Option<&RawFrameworkOptions> {
        self.files[fi]
            .raw
            .frameworks
            .options
            .iter()
            .find(|o| o.name == name && o.class == class)
    }

    /// What an option that may guard stands for, as dependencies: each name given,
    /// none for `None`, and what is not read by its words, which may be the guard.
    fn given_deps(&self, fi: usize, g: &RawGiven) -> Vec<Dep> {
        match g {
            RawGiven::Refs(refs) => refs.iter().map(|r| Dep::plain(self.canon(fi, r))).collect(),
            RawGiven::Nothing => vec![],
            RawGiven::Unread(words) => vec![Dep::plain(format!("unresolved:{words}"))],
        }
    }

    /// The guards a router of a framework is built with: Litestar's `guards=`,
    /// each of which runs before every route of the router.
    pub(super) fn framework_guards(&self, fi: usize, name: &str) -> Vec<Dep> {
        self.options_in(fi, name, false)
            .and_then(|o| o.guards.as_ref())
            .map(|g| self.given_deps(fi, g))
            .unwrap_or_default()
    }

    /// The framework of a router node, where it is one of these.
    fn node_framework(&self, node: &str) -> Option<&'static Framework> {
        self.routers.get(node).and_then(|i| i.framework)
    }

    /// A Sanic blueprint group: mounted under a prefix, its own prefix is joined
    /// to it rather than replaced (`Sanic.blueprint` merges the mount's, the
    /// group's and each blueprint's `url_prefix`, Sanic 25.12.1 `app.py`), unlike
    /// a blueprint mounted on its own.
    pub(super) fn framework_joins_mount(&self, node: &str) -> bool {
        self.node_framework(node)
            .is_some_and(|f| std::ptr::eq(f, &GROUP))
    }

    /// Whether the use of a router `node` that reads `attr` of it (empty: the router
    /// itself, read as a value at `on` on `line` of file `fi`) is one this reading
    /// accounts for: a mount read here, or what its framework reads ([`READS`]).
    /// `api.urls` resolves to the API itself, and is read as the attribute. Never of
    /// a router no framework here has.
    pub(super) fn framework_explains(
        &self,
        node: &str,
        fi: usize,
        on: &RawRef,
        attr: &str,
        line: u32,
    ) -> bool {
        let Some(f) = self.node_framework(node) else {
            return false;
        };
        let attr = match attr {
            "" if on.member.ends_with(".urls") => "urls",
            a => a,
        };
        if attr.is_empty() {
            return self.files[fi]
                .raw
                .frameworks
                .reads
                .iter()
                .any(|(r, l)| r == on && *l == line);
        }
        READS
            .iter()
            .any(|(name, reads)| *name == f.name && reads.contains(&attr))
    }

    /// Whether a router of a framework is handed on only where this reading reads
    /// it ([`Tables::explained`]): the mounts that are read are then all of them.
    pub(super) fn framework_handed_read(&self, node: &str) -> bool {
        self.frameworks.explained.contains(node)
    }

    /// The routers, mounts and hooks of these frameworks, into the linker's tables:
    /// Litestar's controllers, Sanic's blueprint groups, the mounts read here, the
    /// options of a Litestar layer whose effect is not read, and Sanic's request
    /// hooks. After the routers, mounts and hooks of the other adapters.
    pub(super) fn framework_tables(&mut self) {
        if self.files.iter().all(|f| f.raw.frameworks.is_empty()) || !self.since_frozen() {
            return;
        }
        // Controllers and groups are routers of their own.
        let mut routers: Vec<(String, RouterInfo)> = Vec::new();
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi).to_string();
            let raw = &self.files[fi].raw.frameworks;
            for o in raw.options.iter().filter(|o| o.class) {
                routers.push((
                    format!("{rel}#{}", o.name),
                    RouterInfo {
                        adapter: CONTROLLER.model.to_string(),
                        prefix: o.path.clone().unwrap_or_default(),
                        deps: o
                            .guards
                            .as_ref()
                            .map(|g| self.given_deps(fi, g))
                            .unwrap_or_default(),
                        app: false,
                        root: false,
                        framework: Some(&CONTROLLER),
                    },
                ));
            }
            for g in &raw.groups {
                let callee = self.canon(fi, &g.callee);
                let group = callee
                    .strip_suffix(".group")
                    .and_then(|class| self.framework_match(class, 0))
                    .is_some_and(|f| f.name == "sanic" && !f.app);
                if group {
                    routers.push((
                        format!("{rel}#{}", g.name),
                        RouterInfo {
                            adapter: GROUP.model.to_string(),
                            prefix: g.prefix.clone().unwrap_or_default(),
                            deps: vec![],
                            app: false,
                            root: false,
                            framework: Some(&GROUP),
                        },
                    ));
                }
            }
        }
        for (node, info) in routers {
            self.routers.entry(node).or_insert(info);
        }
        let mut parents: Vec<(String, Parent)> = Vec::new();
        let mut unread: Vec<(String, String)> = Vec::new();
        let mut hooks: Vec<(String, Option<String>, Option<String>)> = Vec::new();
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi).to_string();
            let at = self.files[fi].rel_path.clone();
            let raw = &self.files[fi].raw.frameworks;
            for m in &raw.mounts {
                let target = self.node_of(fi, &m.target);
                let wants = match m.how.as_str() {
                    "add_router" => "ninja",
                    _ => "sanic",
                };
                if self.node_framework(&target).is_none_or(|f| f.name != wants) {
                    continue;
                }
                for parent in self.nodes_of(fi, &m.parent) {
                    if self.node_framework(&parent).is_none_or(|f| f.name != wants)
                        || parent == target
                    {
                        continue;
                    }
                    if let Some(auth) = &m.auth {
                        let deps = self.given_deps(fi, auth);
                        self.frameworks
                            .mount_auth
                            .insert((target.clone(), parent.clone()), deps);
                    }
                    parents.push((
                        target.clone(),
                        (parent, m.prefix.clone(), vec![], false, vec![]),
                    ));
                }
            }
            // Litestar: what each layer's `route_handlers=` holds that is a router
            // or a controller is mounted on it.
            for o in &raw.options {
                let node = format!("{rel}#{}", o.name);
                let litestar = self
                    .node_framework(&node)
                    .is_some_and(|f| f.name == "litestar");
                if !litestar {
                    continue;
                }
                if !o.unread.is_empty() {
                    unread.push((
                        node.clone(),
                        format!("`{}` ({at}:{})", o.unread.join(", "), o.line),
                    ));
                }
                for h in o.handlers.iter().flatten().flatten() {
                    let target = self.node_of(fi, h);
                    if self
                        .node_framework(&target)
                        .is_some_and(|f| f.name == "litestar" && !f.app)
                        && target != node
                    {
                        parents.push((target, (node.clone(), None, vec![], false, vec![])));
                    }
                }
            }
            // Sanic: a request hook guards what it is on; the same function written
            // `@x.middleware("request")` is no application middleware of the FastAPI
            // kind, and a response hook runs after the handler.
            for h in &raw.hooks {
                let hook = self.canon(fi, &h.hook);
                for node in self.nodes_of(fi, &h.router) {
                    if self.node_framework(&node).is_none_or(|f| f.name != "sanic") {
                        continue;
                    }
                    hooks.push((
                        node,
                        h.middleware.then(|| format!("{EVERY_MIDDLEWARE}{hook}")),
                        h.request.then(|| hook.clone()),
                    ));
                }
            }
        }
        for (target, parent) in parents {
            self.parents.entry(target).or_default().insert(parent);
        }
        for (node, how) in unread {
            self.unread.entry(node).or_insert(how);
        }
        for (node, middleware, hook) in hooks {
            let list = self.hooks.entry(node).or_default();
            if let Some(m) = middleware {
                list.retain(|h| *h != m);
            }
            list.extend(hook);
        }
        // Quart: a websocket hook runs for the websockets of what it is on, or of
        // the applications its blueprint is registered on.
        let mut ws: Vec<(String, String)> = Vec::new();
        for fi in 0..self.files.len() {
            for h in &self.files[fi].raw.frameworks.websocket_hooks {
                let hook = self.canon(fi, &h.hook);
                for node in self.nodes_of(fi, &h.router) {
                    if self.node_framework(&node).is_none_or(|f| f.name != "quart") {
                        continue;
                    }
                    let on = if h.app_wide {
                        self.mount_roots(&node)
                    } else {
                        vec![node]
                    };
                    ws.extend(on.into_iter().map(|n| (n, hook.clone())));
                }
            }
        }
        for (node, hook) in ws {
            let list = self.frameworks.websocket_hooks.entry(node).or_default();
            if !list.contains(&hook) {
                list.push(hook);
            }
        }
        self.frameworks.explained = self.explained();
    }

    /// The routers of these frameworks whose every use that hands them on is one
    /// this reading accounts for ([`Linker::framework_explains`]).
    fn explained(&self) -> BTreeSet<String> {
        let nodes: BTreeSet<&String> = self
            .routers
            .iter()
            .filter(|(_, i)| i.framework.is_some() && !i.root)
            .map(|(n, _)| n)
            .collect();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut open: BTreeSet<String> = BTreeSet::new();
        for fi in 0..self.files.len() {
            if is_test_path(&self.files[fi].rel_path) {
                continue;
            }
            for u in &self.files[fi].raw.router_uses {
                let full = self.node_of(fi, &u.on);
                for node in &nodes {
                    let attr = match full.strip_prefix(node.as_str()) {
                        Some("") => "",
                        Some(rest) if rest.starts_with('.') => {
                            rest[1..].split('.').next().unwrap_or_default()
                        }
                        _ => continue,
                    };
                    seen.insert(node.to_string());
                    if !self.framework_explains(node, fi, &u.on, attr, u.line) {
                        open.insert(node.to_string());
                    }
                }
            }
        }
        seen.into_iter().filter(|n| !open.contains(n)).collect()
    }

    /// What runs before a Quart websocket route on `node`, in place of the hooks a
    /// request runs: the websocket hooks of the node and of the applications it is
    /// served under. None for a route of any other framework, or of another kind.
    pub(super) fn framework_websocket_guards(&self, node: &str, kind: &str) -> Option<Vec<Dep>> {
        if kind != "websocket" || self.node_framework(node).is_none_or(|f| f.name != "quart") {
            return None;
        }
        let mut on = vec![node.to_string()];
        on.extend(self.mount_roots(node).into_iter().filter(|r| r != node));
        let mut out: Vec<Dep> = Vec::new();
        for n in on {
            for h in self
                .frameworks
                .websocket_hooks
                .get(&n)
                .into_iter()
                .flatten()
            {
                let d = Dep::plain(h.clone());
                if !out.contains(&d) {
                    out.push(d);
                }
            }
        }
        Some(out)
    }

    /// The guard of a django-ninja operation: its own `auth=`, else the nearest
    /// layer's ([`Linker::ninja_layer_auth`]). Nothing for any other framework.
    pub(super) fn framework_route_guards(&self, fi: usize, rt: &RawRoute, node: &str) -> Vec<Dep> {
        if self.node_framework(node).is_none_or(|f| f.name != "ninja") {
            return vec![];
        }
        let own = self.files[fi]
            .raw
            .frameworks
            .auth
            .iter()
            .find(|a| a.symbol == rt.symbol && a.receiver == rt.receiver);
        match own {
            Some(a) => self.given_deps(fi, &a.auth),
            None => self.ninja_layer_auth(node, 0).unwrap_or_default(),
        }
    }

    /// The `auth=` given where the router `node` is added, else its own (of the
    /// router or API), else its parent's; none where no layer gives one. Two mounts
    /// that give it different ones: which one a request takes is not read. The
    /// mount's beats the router's own (`BoundRouter.__init__` and
    /// `Router.build_routers` of `ninja/router.py`, django-ninja 1.8.0).
    fn ninja_layer_auth(&self, node: &str, depth: usize) -> Option<Vec<Dep>> {
        if depth > 8 {
            return None;
        }
        let own = node.split_once('#').and_then(|(module, name)| {
            let fi = self.file(module)?;
            let auth = self.options_in(fi, name, false)?.auth.as_ref()?;
            Some(self.given_deps(fi, auth))
        });
        let Some(parents) = self.parents.get(node).filter(|p| !p.is_empty()) else {
            return own;
        };
        let mut found: Vec<Option<Vec<Dep>>> = Vec::new();
        for (parent, ..) in parents {
            let auth = match self
                .frameworks
                .mount_auth
                .get(&(node.to_string(), parent.clone()))
            {
                Some(deps) => Some(deps.clone()),
                None if own.is_some() => own.clone(),
                None if self
                    .node_framework(parent)
                    .is_some_and(|f| f.name == "ninja") =>
                {
                    self.ninja_layer_auth(parent, depth + 1)
                }
                None => None,
            };
            if !found.contains(&auth) {
                found.push(auth);
            }
        }
        match found.as_slice() {
            [one] => one.clone(),
            [] => None,
            _ => Some(vec![Dep::plain(
                "unresolved:auth of mounts that give different ones".to_string(),
            )]),
        }
    }

    /// A django-ninja API every way to which goes through a Django URLconf that
    /// `ROOT_URLCONF` does not reach: it serves nothing.
    pub(super) fn framework_unserved(&self, node: &str, depth: usize) -> bool {
        if depth > 16 {
            return false;
        }
        match self.parents.get(node) {
            None => !node.contains('#') && self.is_dead(node),
            Some(ps) => {
                !ps.is_empty()
                    && ps
                        .iter()
                        .all(|(p, ..)| self.framework_unserved(p, depth + 1))
            }
        }
    }

    /// The routes added by a registration of these frameworks: each Litestar
    /// handler a layer's `route_handlers=` names and each handler of a controller,
    /// at its paths, behind its own guards and the dependencies it takes; and each
    /// Sanic `add_route`. The decorator of a Litestar handler registers it: no wrap
    /// of it ([`Extra::dropped`]).
    pub(super) fn framework_registrations(&self, fi: usize, extra: &mut BTreeMap<String, Extra>) {
        let raw = &self.files[fi].raw.frameworks;
        if raw.is_empty() || !self.since_frozen() {
            return;
        }
        let rel = self.module_of(fi).to_string();
        // Litestar: what a layer names.
        for o in raw.options.iter().filter(|o| !o.class) {
            let node = format!("{rel}#{}", o.name);
            if self
                .node_framework(&node)
                .is_none_or(|f| f.name != "litestar")
            {
                continue;
            }
            for h in o.handlers.iter().flatten().flatten() {
                let target = self.canon(fi, h);
                let Some((module, name)) = target.split_once('#') else {
                    continue;
                };
                if name.contains(['.', '(']) {
                    continue;
                }
                let Some(ti) = self.file(module) else {
                    continue;
                };
                self.litestar_handler_at(ti, name, &node, extra);
            }
        }
        // Litestar: a controller's handlers, on the controller.
        for o in raw.options.iter().filter(|o| o.class) {
            let node = format!("{rel}#{}", o.name);
            if self.node_framework(&node).is_none() {
                continue;
            }
            let methods: Vec<&str> = raw
                .handlers
                .iter()
                .filter(|h| {
                    h.symbol
                        .split_once('.')
                        .is_some_and(|(class, _)| class == o.name)
                })
                .map(|h| h.symbol.as_str())
                .collect();
            for m in methods {
                self.litestar_handler_at(fi, m, &node, extra);
            }
        }
        // Sanic: `add_route`.
        for r in &raw.routes {
            let target = self.canon(fi, &r.target);
            let Some((module, name)) = target.split_once('#') else {
                continue;
            };
            if name.contains(['.', '(']) || self.untracked(module) {
                continue;
            }
            let Some(ti) = self.file(module) else {
                continue;
            };
            let Some(sym) = self.files[ti].raw.symbols.iter().find(|s| s.name == name) else {
                continue;
            };
            for node in self.nodes_of(fi, &r.router) {
                if self.node_framework(&node).is_none_or(|f| f.name != "sanic") {
                    continue;
                }
                // `add_route(handler, uri, methods=frozenset({"GET"}))`: a function
                // serves GET unless told otherwise; an `HTTPMethodView` serves the
                // methods it defines, whatever it is given (`RouteMixin.add_route`,
                // Sanic 25.12.1).
                let methods = if sym.kind == drift_core::SymbolKind::Class {
                    vec![]
                } else if r.methods.is_empty() {
                    vec!["GET".to_string()]
                } else {
                    r.methods.clone()
                };
                let g = RawRegistration {
                    target: r.target.clone(),
                    router: Some(r.router.clone()),
                    adapter: "sanic".into(),
                    route: r.path.clone(),
                    methods,
                    guards: vec![],
                    unmeasured: true,
                    candidate: false,
                    behind: RawBehind::default(),
                    shapes: vec![],
                    since_guards: vec![],
                    line: crate::raw::Site::default(),
                };
                self.registration_at(fi, &g, &node, (module, name, ti, sym), extra);
            }
        }
    }

    /// The Litestar handler `symbol` of file `ti` (a function, or `Class.method`),
    /// registered on `node`: one route for each of its paths.
    fn litestar_handler_at(
        &self,
        ti: usize,
        symbol: &str,
        node: &str,
        extra: &mut BTreeMap<String, Extra>,
    ) {
        let module = self.module_of(ti);
        if self.untracked(module) {
            return;
        }
        let raw = &self.files[ti].raw;
        let Some(h) = raw.frameworks.handlers.iter().find(|h| h.symbol == symbol) else {
            return;
        };
        let Some(sym) = raw.symbols.iter().find(|s| s.name == symbol) else {
            return;
        };
        let mut guards: Vec<RawRef> = Vec::new();
        let mut since_guards: Vec<(Option<RawRef>, String)> = Vec::new();
        match &h.guards {
            Some(RawGiven::Refs(refs)) => guards.extend(refs.iter().cloned()),
            Some(RawGiven::Unread(words)) => since_guards.push((None, words.clone())),
            Some(RawGiven::Nothing) | None => {}
        }
        guards.extend(h.provided.iter().cloned());
        since_guards.extend(h.unread.iter().map(|u| (None, u.clone())));
        for path in &h.paths {
            let g = RawRegistration {
                target: RawRef {
                    base: RawBase::Local(symbol.to_string()),
                    member: String::new(),
                },
                router: None,
                adapter: "litestar".into(),
                route: path.clone(),
                methods: h.methods.clone(),
                guards: guards.clone(),
                unmeasured: true,
                candidate: false,
                behind: RawBehind::default(),
                shapes: vec![],
                since_guards: since_guards.clone(),
                line: crate::raw::Site::default(),
            };
            self.registration_at(ti, &g, node, (module, symbol, ti, sym), extra);
        }
        let decorator = self.canon(ti, &h.decorator);
        extra
            .entry(module.to_string())
            .or_default()
            .dropped
            .entry(symbol.to_string())
            .or_default()
            .insert(decorator);
    }

    /// The lines of the route handlers of these frameworks in file `fi` that no
    /// entry point lists: a Litestar handler no layer's `route_handlers=` that is
    /// read names (built in a function, in a list that is not written in place),
    /// in no inventory. Merged into [`drift_core::FileFacts::unlisted_routes`].
    pub(super) fn framework_unlisted(&self, fi: usize, entries: &[EntryPoint]) -> Vec<u32> {
        let raw = &self.files[fi].raw.frameworks;
        if raw.handlers.is_empty() || is_test_path(&self.files[fi].rel_path) || !self.since_frozen()
        {
            return vec![];
        }
        let mut out: Vec<u32> = raw
            .handlers
            .iter()
            .filter(|h| !entries.iter().any(|e| e.symbol == h.symbol))
            .map(|h| h.line)
            .collect();
        out.sort();
        out.dedup();
        out
    }
}
