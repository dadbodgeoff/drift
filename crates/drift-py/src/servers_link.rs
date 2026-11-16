//! Linking what `lower::servers` read: the entry points of aiohttp, Tornado, Falcon
//! and Channels applications, Django management commands, Huey tasks and arq jobs,
//! with what runs before each of them.
//!
//! All of it is a listing made since the measured build, read into the listed
//! reading only ([`drift_core::Listed`]). It is held apart from the tables the
//! first adapters build ([`Linker::servers`]): nothing here is a term of the test of
//! which files mining links again (`Linker::links_differently`), and the measured
//! and compat links never merge it (`Linker::since_frozen`). So what mining reads of
//! every file is what it was, and a file these readings change keeps them in its
//! listed reading, for `drift security` and the practice map.
//!
//! What is not known is said so: a route of a table or of an application handed to
//! a function where no mount or pass is read is listed under a prefix that is not
//! known (`/?/x`), with an unresolved hook (it may be served behind a guard that was
//! not read); a route served through mounts that do not run the same hooks has the
//! hooks they share and an unresolved one.

use super::*;
use crate::lower::servers::{RawNode, RawServerHook, RawServerRoute, responder};

/// What the listed reading adds to one file ([`Linker::servers`]).
#[derive(Debug, Clone, Default)]
pub(super) struct Served {
    entries: Vec<EntryPoint>,
    /// symbol -> wraps to prepend (outermost first), as [`Extra::wraps`].
    wraps: BTreeMap<String, Vec<Wrap>>,
    /// symbol -> decorators that register it, which the measured build read as
    /// wraps of the symbol (`@routes.get("/")`, `@huey.task()`): no wrap here.
    drop: BTreeMap<String, BTreeSet<String>>,
    /// Methods of the listed reading only ([`RawSymbol::late`]) that a hook names
    /// (`BaseHandler.prepare`, `Auth.process_request`), kept as symbols.
    pub(super) keep: BTreeSet<String>,
}

impl Served {
    /// Into the file's extra facts: the entry points and wraps, and the
    /// registrations taken out of the decorators the measured build fell back to.
    pub(super) fn merge_into(&self, extra: &mut Extra) {
        extra.entries.extend(self.entries.iter().cloned());
        for (symbol, ws) in &self.wraps {
            let have = extra.wraps.entry(symbol.clone()).or_default();
            for w in ws {
                if !have.contains(w) {
                    have.push(w.clone());
                }
            }
        }
        for (symbol, gone) in &self.drop {
            if let Some(fb) = extra.fallback.get_mut(symbol) {
                fb.retain(|(_, w)| !gone.contains(w));
            }
        }
    }

    /// The decorators of `symbol` that are registrations ([`Served::drop`]).
    pub(super) fn dropped(&self, symbol: &str) -> Option<&BTreeSet<String>> {
        self.drop.get(symbol)
    }
}

/// One way a node is served: the full prefix, and the hooks on the way, outermost
/// first.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Way {
    prefix: String,
    hooks: Vec<Wrap>,
}

/// A node defined somewhere: its adapter, whether it is a table, and its hooks.
struct NodeInfo {
    adapter: String,
    table: bool,
    hooks: Vec<Wrap>,
}

/// How deep mounts are followed, and how many ways of one node are kept.
const MAX_DEPTH: usize = 16;
const MAX_WAYS: usize = 16;

fn unresolved(why: &str) -> Wrap {
    Wrap {
        wrapper: format!("unresolved:{why}"),
        kind: WrapKind::AppHook,
    }
}

/// The parameter node of `function` in module `rel` (`routes.py#setup_routes(#0)`).
fn param_id(rel: &str, function: &str, index: u32) -> String {
    format!("{rel}#{function}(#{index})")
}

struct Tables {
    nodes: BTreeMap<String, NodeInfo>,
    /// child -> (parent, prefix, hooks of the mount)
    parents: BTreeMap<String, Vec<(String, String, Vec<Wrap>)>>,
}

impl Linker<'_> {
    fn node_id(&self, fi: usize, n: &RawNode) -> String {
        match n {
            RawNode::Ref(r) => self.canon(fi, r),
            RawNode::Param { function, index } => param_id(self.module_of(fi), function, *index),
        }
    }

    /// The wraps a hook written in file `fi` stands for, and the late symbols they
    /// name (module, symbol).
    fn hook_wraps(
        &self,
        fi: usize,
        h: &RawServerHook,
        keep: &mut Vec<(String, String)>,
    ) -> Vec<Wrap> {
        let hook = |wrapper: String| Wrap {
            wrapper,
            kind: WrapKind::AppHook,
        };
        match h {
            // An application middleware: read as one, by its body.
            RawServerHook::Middleware(r) => {
                vec![hook(format!("{EVERY_MIDDLEWARE}{}", self.canon(fi, r)))]
            }
            RawServerHook::Function(r) | RawServerHook::Wraps(r) => vec![hook(self.canon(fi, r))],
            RawServerHook::Identifies(r) => vec![Wrap {
                wrapper: self.canon(fi, r),
                kind: WrapKind::Authenticates,
            }],
            RawServerHook::Unread(words) => vec![unresolved(words)],
            // Falcon runs `process_request` before routing and `process_resource`
            // after it: the first class of the chain that defines each.
            RawServerHook::Instance(r) => {
                let class = self.canon(fi, r);
                if class.starts_with("pkg:") || self.symbol_at(&class).is_none() {
                    return vec![hook(class)];
                }
                let mut out = Vec::new();
                for method in ["process_request", "process_resource"] {
                    for c in self.class_chain(&class) {
                        let m = format!("{c}.{method}");
                        if self.symbol_at(&m).is_some() {
                            if let Some((module, name)) = m.split_once('#') {
                                keep.push((module.to_string(), name.to_string()));
                            }
                            out.push(hook(m));
                            break;
                        }
                    }
                }
                out
            }
        }
    }

    /// Every node, mount and pass of the repository.
    fn server_tables(&self, keep: &mut Vec<(String, String)>) -> Tables {
        let mut nodes: BTreeMap<String, NodeInfo> = BTreeMap::new();
        let mut parents: BTreeMap<String, Vec<(String, String, Vec<Wrap>)>> = BTreeMap::new();
        let mut later: Vec<(String, Vec<Wrap>)> = Vec::new();
        for (fi, f) in self.files.iter().enumerate() {
            let s = &f.raw.servers;
            if s.is_empty() || is_test_path(&f.rel_path) {
                continue;
            }
            for d in &s.nodes {
                let hooks = d
                    .hooks
                    .iter()
                    .flat_map(|h| self.hook_wraps(fi, h, keep))
                    .collect();
                nodes.insert(
                    self.canon(fi, &d.node),
                    NodeInfo {
                        adapter: d.adapter.clone(),
                        table: d.table,
                        hooks,
                    },
                );
            }
            for (n, h) in &s.node_hooks {
                later.push((self.node_id(fi, n), self.hook_wraps(fi, h, keep)));
            }
            for m in &s.mounts {
                let hooks = m
                    .hooks
                    .iter()
                    .flat_map(|h| self.hook_wraps(fi, h, keep))
                    .collect();
                parents
                    .entry(self.node_id(fi, &m.child))
                    .or_default()
                    .push((self.node_id(fi, &m.parent), m.prefix.clone(), hooks));
            }
            for p in &s.passes {
                let callee = self.canon(fi, &p.callee);
                let Some((module, function)) = callee.split_once('#') else {
                    continue;
                };
                if module.contains(':') {
                    continue;
                }
                parents
                    .entry(param_id(module, function, p.index))
                    .or_default()
                    .push((self.node_id(fi, &p.node), String::new(), vec![]));
            }
        }
        for (id, hooks) in later {
            if let Some(n) = nodes.get_mut(&id) {
                n.hooks.extend(hooks);
            } else {
                // Hooks added to an application handed in (`app.middlewares.append`
                // in `setup(app)`): of the mount from what was handed.
                for p in parents.get_mut(&id).into_iter().flatten() {
                    p.2.extend(hooks.iter().cloned());
                }
            }
        }
        for v in parents.values_mut() {
            v.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
            v.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1 && a.2 == b.2);
        }
        Tables { nodes, parents }
    }

    /// Every way node `id` is served. `open`: a node that nothing mounts and that
    /// is no application is served under a prefix that is not known (an
    /// application handed to a function where no pass is read, a `RouteTableDef`).
    fn server_ways(&self, t: &Tables, id: &str, open: bool, depth: usize) -> Vec<Way> {
        let own = t.nodes.get(id);
        let own_hooks = own.map(|n| n.hooks.clone()).unwrap_or_default();
        let Some(parents) = t
            .parents
            .get(id)
            .filter(|p| !p.is_empty() && depth < MAX_DEPTH)
        else {
            return match own {
                Some(n) if !n.table => vec![Way {
                    prefix: String::new(),
                    hooks: own_hooks,
                }],
                Some(n) if n.adapter != "aiohttp" => vec![],
                _ if open || own.is_some() => {
                    let mut hooks = vec![unresolved("the application that serves it is not read")];
                    hooks.extend(own_hooks);
                    vec![Way {
                        prefix: crate::lower::adapters::UNKNOWN_PREFIX.to_string(),
                        hooks,
                    }]
                }
                _ => vec![],
            };
        };
        let mut out = Vec::new();
        for (parent, prefix, mount_hooks) in parents {
            for w in self.server_ways(t, parent, true, depth + 1) {
                let mut hooks = w.hooks;
                hooks.extend(mount_hooks.iter().cloned());
                hooks.extend(own_hooks.iter().cloned());
                let way = Way {
                    prefix: join_path(&[&w.prefix, prefix]),
                    hooks,
                };
                if !out.contains(&way) {
                    out.push(way);
                }
            }
        }
        out.truncate(MAX_WAYS);
        out
    }

    /// The listed reading's facts of every file the servers and queues of the
    /// repository give entry points to ([`Served`]).
    pub(super) fn build_servers(&self) -> BTreeMap<String, Served> {
        if self.files.iter().all(|f| f.raw.servers.is_empty()) {
            return BTreeMap::new();
        }
        let mut keep: Vec<(String, String)> = Vec::new();
        let t = self.server_tables(&mut keep);
        let mut out: BTreeMap<String, Served> = BTreeMap::new();
        for (fi, f) in self.files.iter().enumerate() {
            let s = &f.raw.servers;
            if s.is_empty() || is_test_path(&f.rel_path) {
                continue;
            }
            for r in &s.routes {
                self.server_route(fi, r, &t, &mut keep, &mut out);
            }
            self.command(fi, &mut keep, &mut out);
        }
        for (module, name) in keep {
            if !self.untracked(&module) {
                out.entry(module).or_default().keep.insert(name);
            }
        }
        for s in out.values_mut() {
            s.entries.sort();
            s.entries.dedup();
        }
        out
    }

    /// A Django management command: the class `Command` of
    /// `<app>/management/commands/<name>.py`, run as `manage.py <name>` (a name
    /// that starts with `_` is no command). Its `handle` is the entry point.
    fn command(
        &self,
        fi: usize,
        keep: &mut Vec<(String, String)>,
        out: &mut BTreeMap<String, Served>,
    ) {
        let f = &self.files[fi];
        let rel = f.rel_path.as_str();
        if !f.raw.servers.commands.iter().any(|c| c == "Command") || self.untracked(rel) {
            return;
        }
        let mut parts = rel.rsplit('/');
        let (Some(file), Some("commands"), Some("management")) =
            (parts.next(), parts.next(), parts.next())
        else {
            return;
        };
        let Some(name) = file.strip_suffix(".py").filter(|n| !n.starts_with('_')) else {
            return;
        };
        let handle = f
            .raw
            .symbols
            .iter()
            .any(|s| s.name == "Command.handle" && s.late);
        let symbol = if handle {
            keep.push((rel.to_string(), "Command.handle".into()));
            "Command.handle"
        } else {
            "Command"
        };
        out.entry(rel.to_string())
            .or_default()
            .entries
            .push(EntryPoint {
                symbol: symbol.into(),
                kind: "cli".into(),
                method: None,
                route: Some(name.to_string()),
                adapter: "django".into(),
            });
    }

    /// The entry points and wraps one route gives the file that defines its handler.
    fn server_route(
        &self,
        fi: usize,
        r: &RawServerRoute,
        t: &Tables,
        keep: &mut Vec<(String, String)>,
        out: &mut BTreeMap<String, Served>,
    ) {
        let target = self.canon(fi, &r.target);
        let Some((module, name)) = target.split_once('#') else {
            return;
        };
        if module.contains(':') || name.contains(['.', '(']) || self.untracked(module) {
            return;
        }
        let Some(ti) = self.file(module) else { return };
        let raw = &self.files[ti].raw;
        let Some(sym) = raw
            .symbols
            .iter()
            .find(|s| s.name == name && s.owner.is_none())
        else {
            return;
        };
        let class = sym.kind == drift_core::SymbolKind::Class;
        let node = r.node.as_ref().map(|n| self.node_id(fi, n));
        let info = node.as_ref().and_then(|n| t.nodes.get(n));
        // A registration that needs its node to be of the framework: a decorator
        // (`@routes.get` of a `RouteTableDef`, `@huey.task` of a Huey instance).
        if r.decorator.is_some() && r.node.is_some() && info.is_none_or(|n| n.adapter != r.adapter)
        {
            return;
        }
        let drop = r.decorator.as_ref().map(|(_, d)| self.canon(fi, d));
        let served = out.entry(module.to_string()).or_default();
        // A message consumer (`lower::consumers`) is placed as a job is.
        if matches!(r.kind.as_str(), "job" | "cron" | "consumer") {
            served.entries.push(EntryPoint {
                symbol: name.to_string(),
                kind: r.kind.clone(),
                method: None,
                route: r
                    .name
                    .clone()
                    .or_else(|| (r.adapter == "arq").then(|| name.to_string())),
                adapter: r.adapter.clone(),
            });
            if let Some(d) = drop {
                served.drop.entry(name.to_string()).or_default().insert(d);
            }
            return;
        }
        let Some(node) = node else { return };
        let ways = self.server_ways(t, &node, r.decorator.is_none(), 0);
        if ways.is_empty() {
            return;
        }
        // The handlers: a function, or the methods of a class its framework calls.
        let handlers: Vec<(String, Vec<String>)> = if class {
            let of = format!("{name}.");
            let methods: Vec<(String, Vec<String>)> = raw
                .symbols
                .iter()
                .filter_map(|s| {
                    let method = s.name.strip_prefix(&of)?;
                    match r.adapter.as_str() {
                        "falcon" => {
                            let (verb, suffix) = responder(method)?;
                            (s.owner.is_none() && s.late && suffix == r.suffix)
                                .then(|| (s.name.clone(), vec![verb]))
                        }
                        "aiohttp" | "tornado" => (s.owner.as_deref() == Some(name)
                            && crate::lower::adapters::HANDLER_METHODS.contains(&method))
                        .then(|| (s.name.clone(), vec![method.to_ascii_uppercase()])),
                        _ => None,
                    }
                })
                .collect();
            if methods.is_empty() {
                vec![(name.to_string(), vec!["ANY".into()])]
            } else {
                methods
            }
        } else {
            let methods = if r.methods.is_empty() {
                vec!["ANY".into()]
            } else {
                r.methods.clone()
            };
            vec![(name.to_string(), methods)]
        };
        // What every way runs; a hook only some ways run is not one of the route.
        let mut common: Vec<Wrap> = ways[0].hooks.clone();
        common.retain(|w| ways.iter().all(|x| x.hooks.contains(w)));
        if ways
            .iter()
            .any(|x| x.hooks.iter().any(|w| !common.contains(w)))
        {
            common.push(unresolved(
                "served at more than one place, behind different hooks",
            ));
        }
        // Tornado's `prepare`: the first class of the handler's chain that defines it.
        let mut own: Vec<Wrap> = Vec::new();
        if class && r.adapter == "tornado" {
            for c in self.class_chain(&target) {
                if c.starts_with("pkg:") {
                    break;
                }
                let m = format!("{c}.prepare");
                if self.symbol_at(&m).is_some() {
                    if let Some((pm, pn)) = m.split_once('#') {
                        keep.push((pm.to_string(), pn.to_string()));
                    }
                    own.push(Wrap {
                        wrapper: m,
                        kind: WrapKind::AppHook,
                    });
                    break;
                }
            }
        }
        let before = |symbol: &str| -> Vec<Wrap> {
            raw.servers
                .before
                .iter()
                .filter(|(s, _)| s == symbol)
                .flat_map(|(_, h)| self.hook_wraps(ti, h, &mut Vec::new()))
                .collect()
        };
        let served = out.entry(module.to_string()).or_default();
        for (symbol, methods) in handlers {
            for way in &ways {
                let route = join_path(&[&way.prefix, r.path.as_deref().unwrap_or("")]);
                if r.kind == "websocket" {
                    served.entries.push(EntryPoint {
                        symbol: symbol.clone(),
                        kind: r.kind.clone(),
                        method: None,
                        route: Some(route),
                        adapter: r.adapter.clone(),
                    });
                    continue;
                }
                for m in &methods {
                    served.entries.push(EntryPoint {
                        symbol: symbol.clone(),
                        kind: r.kind.clone(),
                        method: Some(m.clone()),
                        route: Some(route.clone()),
                        adapter: r.adapter.clone(),
                    });
                }
            }
            let mut wraps: Vec<Wrap> = common.iter().chain(&own).cloned().collect();
            if r.adapter == "falcon" {
                wraps.extend(before(name));
                if symbol != name {
                    wraps.extend(before(&symbol));
                }
            }
            let ws = served.wraps.entry(symbol.clone()).or_default();
            for w in wraps {
                if !ws.contains(&w) {
                    ws.push(w);
                }
            }
            if let Some(d) = &drop {
                served
                    .drop
                    .entry(symbol.clone())
                    .or_default()
                    .insert(d.clone());
            }
        }
    }
}
