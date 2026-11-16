//! tRPC router composition: the dotted path each procedure is called by.
//!
//! A procedure's name in its own router (`byId`) is not what a client calls: a
//! router mounted in another (`router({ user: userRouter })`) puts its key in front
//! (`user.byId`), at any depth and across files. Lowering records what each router
//! is composed of ([`RawRouter`]); linking follows the references with the module
//! resolver, the way the Express adapter follows cross-file mounts, and gives each
//! procedure one route per path it is served at ([`TrpcTree`]).
//!
//! The measured build listed a procedure by its key alone, and mining reads that
//! build's listing: the dotted paths are in the listed reading only
//! ([`drift_core::Listed`]), which the practice map and `drift security` read.
//!
//! Where composition is not read the path says so with [`UNKNOWN`]: a computed key
//! (`[name]: r`) is that segment, and a router nothing Drift read mounts, in a
//! package whose routers are composed, is under a prefix that is not known
//! (`?.byId`), never read as a top-level route that exists. A router built by a
//! function Drift does not read is one nothing mounts. tRPC routers take no
//! middleware (only procedures do, by their builder's `.use()` chain), so a mount
//! adds no guard and none is read.

use super::*;

/// A segment of a procedure's path that is not known.
pub const UNKNOWN: &str = "?";

/// How deep router values written in place are read.
const MAX_DEPTH: usize = 8;

/// How many paths one procedure is listed at.
const MAX_PATHS: usize = 16;

/// One tRPC router of a file: `router({...})` (any callee whose name ends in
/// `router`, as the inline procedures are found) or `mergeRouters(a, b)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawRouter {
    /// The top-level binding it is (`default` for `export default`); empty for one
    /// written anywhere else (in a function, as an argument).
    pub name: String,
    /// 1-based line of the call.
    pub line: u32,
    pub entries: Vec<RawRouterEntry>,
}

/// What a router holds under a dotted path relative to it (empty for what is
/// merged into it at its own level).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RawRouterEntry {
    /// A procedure written in place, at the line of its property.
    Procedure { path: String, line: u32 },
    /// A binding: a router or a procedure (`user: userRouter`, `{ get }`), or one
    /// merged (`mergeRouters(a, b)`, `...a._def.procedures`), or the export a lazy
    /// router picks (`lazy(() => import("./x").then((m) => m.userRouter))`).
    Ref { path: String, target: RawRef },
    /// `lazy(() => import("./x"))`: the module's one export.
    Lazy { path: String, spec: String },
    /// A value that is not read (a call, a spread of something else, a computed key
    /// over a procedure).
    Unread { path: String },
}

/// `a.b` of `a` and `b`; either may be empty.
fn join(a: &str, b: &str) -> String {
    match (a.is_empty(), b.is_empty()) {
        (true, _) => b.to_string(),
        (_, true) => a.to_string(),
        _ => format!("{a}.{b}"),
    }
}

/// Whether a router holds anything that is read: a call whose name ends in
/// `router` and is given only options (`Router({ mergeParams: true })`) is none.
fn read_any(entries: &[RawRouterEntry]) -> bool {
    entries
        .iter()
        .any(|e| !matches!(e, RawRouterEntry::Unread { .. }))
}

/// Whether the call is a router (`Some(false)`) or merges routers (`Some(true)`).
fn call_kind(c: &CallExpression) -> Option<bool> {
    let name = match unwrap_expr(&c.callee) {
        Expression::Identifier(i) => i.name.as_str(),
        Expression::StaticMemberExpression(m) => m.property.name.as_str(),
        _ => return None,
    }
    .to_ascii_lowercase();
    if name.ends_with("mergerouters") {
        return Some(true);
    }
    let object = matches!(
        c.arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr),
        Some(Expression::ObjectExpression(_))
    );
    (name.ends_with("router") && object).then_some(false)
}

impl Lowerer<'_> {
    /// Every tRPC router of the file ([`crate::lower::RawTrpc::routers`]).
    pub(super) fn lower_trpc_routers(&mut self, program: &Program) {
        let mut read: BTreeSet<u32> = BTreeSet::new();
        let mut routers = Vec::new();
        let mut named = |l: &Self, name: &str, e: &Expression, read: &mut BTreeSet<u32>| {
            let mut entries = Vec::new();
            if l.router_entries(e, "", read, &mut entries, 0) && read_any(&entries) {
                routers.push(RawRouter {
                    name: name.to_string(),
                    line: l.line_of(e.span().start),
                    entries,
                });
            }
        };
        for stmt in &program.body {
            let decl = match stmt {
                Statement::VariableDeclaration(d) => Some(&**d),
                Statement::ExportDeclaration(e) => match &e.declaration {
                    Declaration::VariableDeclaration(d) => Some(&**d),
                    _ => None,
                },
                Statement::ExportDefaultDeclaration(e) => {
                    if let Some(x) = e.declaration.as_expression() {
                        named(self, routes::DEFAULT_ROUTER, x, &mut read);
                    }
                    None
                }
                _ => None,
            };
            for d in decl.into_iter().flat_map(|d| &d.declarations) {
                if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) {
                    named(self, id.name.as_str(), init, &mut read);
                }
            }
        }
        let mut finder = InPlaceRouters {
            l: self,
            read,
            found: Vec::new(),
        };
        finder.visit_program(program);
        routers.extend(finder.found);
        self.out.trpc.routers = routers;
    }

    /// The entries of `e` under `prefix` when it is a router; false when it is not
    /// one. Each router call read is noted in `read`.
    fn router_entries(
        &self,
        e: &Expression,
        prefix: &str,
        read: &mut BTreeSet<u32>,
        out: &mut Vec<RawRouterEntry>,
        depth: usize,
    ) -> bool {
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return false;
        };
        let Some(merges) = call_kind(c) else {
            return false;
        };
        self.call_entries(c, merges, prefix, read, out, depth);
        true
    }

    /// The entries of the router call `c` under `prefix`.
    fn call_entries(
        &self,
        c: &CallExpression,
        merges: bool,
        prefix: &str,
        read: &mut BTreeSet<u32>,
        out: &mut Vec<RawRouterEntry>,
        depth: usize,
    ) {
        read.insert(c.span.start);
        if !merges {
            if let Some(Expression::ObjectExpression(o)) = c
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
            {
                self.object_entries(o, prefix, read, out, depth);
            }
            return;
        }
        for a in &c.arguments {
            match a.as_expression() {
                Some(x) => self.value_entry(x, prefix, false, x.span().start, read, out, depth),
                None => out.push(RawRouterEntry::Unread {
                    path: prefix.to_string(),
                }),
            }
        }
    }

    fn object_entries(
        &self,
        o: &ObjectExpression,
        prefix: &str,
        read: &mut BTreeSet<u32>,
        out: &mut Vec<RawRouterEntry>,
        depth: usize,
    ) {
        for p in &o.properties {
            match p {
                ObjectPropertyKind::ObjectProperty(p) => {
                    let key = p
                        .key
                        .static_name()
                        .and_then(|k| k.as_str().map(String::from));
                    let path = join(prefix, key.as_deref().unwrap_or(UNKNOWN));
                    self.value_entry(
                        &p.value,
                        &path,
                        key.is_some(),
                        p.span.start,
                        read,
                        out,
                        depth,
                    );
                }
                // `...userRouter._def.procedures` (or `._def.record`): its procedures,
                // at this level.
                ObjectPropertyKind::SpreadProperty(s) => {
                    let target = match unwrap_expr(&s.argument) {
                        x @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => {
                            self.canon(x).map(|mut r| {
                                for suffix in ["._def.procedures", "._def.record"] {
                                    if let Some(m) = r.member.strip_suffix(suffix) {
                                        r.member = m.to_string();
                                    }
                                }
                                r
                            })
                        }
                        _ => None,
                    };
                    out.push(match target {
                        Some(target) => RawRouterEntry::Ref {
                            path: prefix.to_string(),
                            target,
                        },
                        None => RawRouterEntry::Unread {
                            path: prefix.to_string(),
                        },
                    });
                }
            }
        }
    }

    /// What a router holds under `path`: `v` written as its value (`keyed` when the
    /// key is a name, `start` the property's offset).
    #[allow(clippy::too_many_arguments)]
    fn value_entry(
        &self,
        v: &Expression,
        path: &str,
        keyed: bool,
        start: u32,
        read: &mut BTreeSet<u32>,
        out: &mut Vec<RawRouterEntry>,
        depth: usize,
    ) {
        let unread = || RawRouterEntry::Unread {
            path: path.to_string(),
        };
        if self.procedure_chain(v).is_some() {
            // A procedure under a computed key is not listed at all.
            out.push(if keyed {
                RawRouterEntry::Procedure {
                    path: path.to_string(),
                    line: self.line_of(start),
                }
            } else {
                unread()
            });
            return;
        }
        if depth >= MAX_DEPTH {
            out.push(unread());
            return;
        }
        if self.router_entries(v, path, read, out, depth + 1) {
            return;
        }
        match unwrap_expr(v) {
            // A nested record (`router({ user: { byId: p.query(...) } })`).
            Expression::ObjectExpression(o) => self.object_entries(o, path, read, out, depth + 1),
            x @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => {
                out.push(match self.canon(x) {
                    Some(target) if !matches!(target.base, RawBase::Global(_)) => {
                        RawRouterEntry::Ref {
                            path: path.to_string(),
                            target,
                        }
                    }
                    _ => unread(),
                });
            }
            Expression::CallExpression(c) => {
                out.push(self.lazy_router(c, path).unwrap_or_else(unread))
            }
            _ => out.push(unread()),
        }
    }

    /// `lazy(() => import("./x"))` of `@trpc/server`, or with `.then((m) => m.name)`.
    fn lazy_router(&self, c: &CallExpression, path: &str) -> Option<RawRouterEntry> {
        let lazy = matches!(
            self.canon_callee(&c.callee),
            Some(RawRef { base: RawBase::Import { spec, name }, member })
                if name == "lazy"
                    && member.is_empty()
                    && (spec == "@trpc/server" || spec.starts_with("@trpc/server/"))
        );
        if !lazy {
            return None;
        }
        let Expression::ArrowFunctionExpression(f) =
            unwrap_expr(c.arguments.first()?.as_expression()?)
        else {
            return None;
        };
        let body = unwrap_expr(f.is_expression().then(|| f.get_expression()).flatten()?);
        let (import, picked) = match body {
            Expression::ImportExpression(i) => (&**i, None),
            Expression::CallExpression(then) => {
                let Expression::StaticMemberExpression(m) = unwrap_expr(&then.callee) else {
                    return None;
                };
                let Expression::ImportExpression(i) = unwrap_expr(&m.object) else {
                    return None;
                };
                if m.property.name != "then" {
                    return None;
                }
                let picked = match unwrap_expr(then.arguments.first()?.as_expression()?) {
                    Expression::ArrowFunctionExpression(pf) if pf.is_expression() => lazy_pick(pf)?,
                    _ => return None,
                };
                (&**i, Some(picked))
            }
            _ => return None,
        };
        let Expression::StringLiteral(spec) = unwrap_expr(&import.source) else {
            return None;
        };
        let spec = lit(spec);
        Some(match picked {
            Some(name) => RawRouterEntry::Ref {
                path: path.to_string(),
                target: RawRef {
                    base: RawBase::Import { spec, name },
                    member: String::new(),
                },
            },
            None => RawRouterEntry::Lazy {
                path: path.to_string(),
                spec,
            },
        })
    }
}

/// The routers written anywhere but bound at the top level: in a function, as an
/// argument (`createHTTPServer({ router: router({...}) })`).
struct InPlaceRouters<'l, 's> {
    l: &'l Lowerer<'s>,
    read: BTreeSet<u32>,
    found: Vec<RawRouter>,
}

impl<'a> Visit<'a> for InPlaceRouters<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if !self.read.contains(&it.span.start)
            && let Some(merges) = call_kind(it)
        {
            let mut entries = Vec::new();
            self.l
                .call_entries(it, merges, "", &mut self.read, &mut entries, 0);
            if read_any(&entries) {
                self.found.push(RawRouter {
                    name: String::new(),
                    line: self.l.line_of(it.span.start),
                    entries,
                });
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// The routers of the linked files and what mounts each, canonical: the paths of
/// their procedures ([`TrpcTree::listed`]).
#[derive(Default)]
pub(crate) struct TrpcTree {
    /// Each router or named procedure (`module#binding`, or `module#(router N)` for
    /// one written in place) -> the routers it is mounted in, with the dotted path
    /// relative to them (empty for one merged).
    parents: BTreeMap<String, BTreeSet<(String, String)>>,
    /// Each procedure written in place, by file and line -> its router and its path
    /// in it.
    inline: BTreeMap<(String, u32), Vec<(String, String)>>,
    /// The routers nothing mounts that are a root of their package's API: one that
    /// mounts another router, or any where no router of the package does.
    roots: BTreeSet<String>,
}

/// The node of a router of `rel`.
fn router_node(rel: &str, r: &RawRouter) -> String {
    if r.name.is_empty() {
        format!("{rel}#(router {})", r.line)
    } else {
        format!("{rel}#{}", r.name)
    }
}

impl TrpcTree {
    /// The tree of `files`: `canon` makes a reference of a file canonical,
    /// `lazy` names the one export of the module a file's specifier loads, and
    /// `package` is the package of a file.
    pub(crate) fn of(
        files: &[crate::resolve::LoweredFile],
        canon: impl Fn(&str, &RawRef) -> String,
        lazy: impl Fn(&str, &str) -> Option<String>,
        mut package: impl FnMut(&crate::resolve::LoweredFile) -> String,
    ) -> TrpcTree {
        let mut tree = TrpcTree::default();
        let mut routers: BTreeMap<String, String> = BTreeMap::new();
        for f in files.iter().filter(|f| !f.raw.trpc.routers.is_empty()) {
            let pkg = package(f);
            for r in &f.raw.trpc.routers {
                let node = router_node(&f.rel_path, r);
                routers.insert(node.clone(), pkg.clone());
                for e in &r.entries {
                    let (path, child) = match e {
                        RawRouterEntry::Procedure { path, line } => {
                            tree.inline
                                .entry((f.rel_path.clone(), *line))
                                .or_default()
                                .push((node.clone(), path.clone()));
                            continue;
                        }
                        RawRouterEntry::Ref { path, target } => (path, canon(&f.rel_path, target)),
                        RawRouterEntry::Lazy { path, spec } => {
                            let Some(child) = lazy(&f.rel_path, spec) else {
                                continue;
                            };
                            (path, child)
                        }
                        RawRouterEntry::Unread { .. } => continue,
                    };
                    if child != node {
                        tree.parents
                            .entry(child)
                            .or_default()
                            .insert((node.clone(), path.clone()));
                    }
                }
            }
        }
        // A router that mounts another router composes its package's API.
        let composes: BTreeSet<&String> = tree
            .parents
            .iter()
            .filter(|(child, _)| routers.contains_key(*child))
            .flat_map(|(_, ps)| ps.iter().map(|(p, _)| p))
            .collect();
        let composed: BTreeSet<&String> = composes.iter().filter_map(|r| routers.get(*r)).collect();
        tree.roots = routers
            .iter()
            .filter(|(r, pkg)| {
                !tree.parents.contains_key(*r) && (composes.contains(r) || !composed.contains(pkg))
            })
            .map(|(r, _)| r.clone())
            .collect();
        tree
    }

    /// The paths of the router or procedure `node`: under each router that mounts
    /// it, else none.
    fn mounted(&self, node: &str, depth: usize) -> Vec<String> {
        let Some(parents) = self.parents.get(node).filter(|_| depth < 16) else {
            return Vec::new();
        };
        parents
            .iter()
            .flat_map(|(p, seg)| {
                self.router_paths(p, depth + 1)
                    .into_iter()
                    .map(move |up| join(&up, seg))
            })
            .collect()
    }

    /// The paths a router is served at: "" for a root, [`UNKNOWN`] for one nothing
    /// Drift read mounts.
    fn router_paths(&self, router: &str, depth: usize) -> Vec<String> {
        let paths = self.mounted(router, depth);
        if !paths.is_empty() {
            return paths;
        }
        if self.roots.contains(router) {
            vec![String::new()]
        } else {
            vec![UNKNOWN.to_string()]
        }
    }

    /// The paths of the tRPC procedure an entry point of `rel` names (its symbol,
    /// the line of that symbol and its route as lowered, the key): sorted, at most
    /// [`MAX_PATHS`]. Empty where nothing is said of it.
    fn paths(&self, rel: &str, symbol: &str, line: u32, route: &str) -> Vec<String> {
        let leaf = |path: &str| path.rsplit('.').next() == Some(route);
        let mut out: Vec<String> = match self.inline.get(&(rel.to_string(), line)) {
            Some(at) if at.iter().any(|(_, p)| leaf(p)) => at
                .iter()
                .filter(|(_, p)| leaf(p))
                .flat_map(|(r, p)| {
                    self.router_paths(r, 0)
                        .into_iter()
                        .map(move |up| join(&up, p))
                })
                .collect(),
            // A procedure bound to a name is listed by it.
            _ if symbol == route => {
                let paths = self.mounted(&format!("{rel}#{symbol}"), 0);
                if paths.is_empty() {
                    vec![join(UNKNOWN, route)]
                } else {
                    paths
                }
            }
            _ => Vec::new(),
        };
        out.sort();
        out.dedup();
        out.truncate(MAX_PATHS);
        out
    }

    /// `entry_points` of `rel` with each tRPC procedure at its paths, one entry
    /// point for each (`symbol_line` gives the line of a symbol); `None` where that
    /// changes nothing.
    pub(crate) fn listed(
        &self,
        rel: &str,
        entry_points: &[drift_core::EntryPoint],
        symbol_line: impl Fn(&str) -> Option<u32>,
    ) -> Option<Vec<drift_core::EntryPoint>> {
        let mut changed = false;
        let mut out = Vec::with_capacity(entry_points.len());
        for e in entry_points {
            let paths = match (&e.route, e.adapter == "trpc") {
                (Some(route), true) => symbol_line(&e.symbol)
                    .map(|line| self.paths(rel, &e.symbol, line, route))
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            if paths.is_empty() || paths.len() == 1 && e.route.as_deref() == Some(&paths[0]) {
                out.push(e.clone());
                continue;
            }
            changed = true;
            for p in paths {
                out.push(drift_core::EntryPoint {
                    route: Some(p),
                    ..e.clone()
                });
            }
        }
        changed.then_some(out)
    }
}
