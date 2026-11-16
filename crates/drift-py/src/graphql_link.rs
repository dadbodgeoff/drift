//! GraphQL entry points at link time: every resolver of a root field (Query,
//! Mutation, Subscription) of a schema Drift ties to its root types, as an entry
//! point of kind `graphql`, the shape the TypeScript reader gives a NestJS resolver:
//! the method is the operation (`QUERY`, `MUTATION`, `SUBSCRIPTION`), the route is
//! `<root type>.<field>` (`Mutation.create_user`), the adapter is the library
//! (`strawberry`, `graphene`, `ariadne`).
//!
//! The schema names its root types (`strawberry.Schema(query=Query)`), which are
//! often defined in other files and built on other types
//! (`class Query(UserQuery, OrderQuery)`); their fields, and the functions and
//! methods that resolve them, are read where they are written ([`RawGraphql`]).
//! Only root fields are entry points: a field of any other type runs inside an
//! operation that already is one.
//!
//! What guards a resolver is said per entry point ([`drift_core::MountFacts`]): the
//! permission classes of the field (strawberry's `permission_classes`, read as a
//! position whose verdict is unknown, as the reader of `drift security` reads it),
//! and what guards the HTTP route that serves the schema, where it is read (a
//! Django URLconf entry of a library's view, `GraphQLView.as_view(schema=schema)`:
//! its wrappers, the settings' middleware). A schema served in any other way (a
//! FastAPI router, an ASGI application, a view whose schema is set in settings, a
//! view class of the repository) may be guarded where Drift does not read: each of
//! its entry points says so (`opaque`), never "no guard". Decorators of a
//! resolver are its wraps, read as any.
//!
//! Listed reading only: nothing here is made when linking what mining reads
//! ([`Linker::since_frozen`]).

use super::*;

/// Classes followed up the bases of a type.
const MAX_BASES: usize = 16;

/// What the listed reading adds to one file for GraphQL.
#[derive(Debug, Default, Clone)]
pub(super) struct FileGql {
    pub(super) entries: Vec<EntryPoint>,
    pub(super) mounts: Vec<drift_core::MountFacts>,
    /// Symbol -> the wrappers (canonical) that are no wrap of it: an ariadne
    /// binding decorator and those above it.
    pub(super) unwraps: BTreeMap<String, BTreeSet<String>>,
    /// Symbol -> the input types declared for it elsewhere (graphene's `Arguments`,
    /// a field's arguments), classes of the repository.
    pub(super) inputs: BTreeMap<String, BTreeSet<String>>,
}

/// The GraphQL facts of every file, built once per link ([`Linker::graphql_of`]).
#[derive(Debug, Default)]
pub(super) struct Table {
    files: BTreeMap<String, FileGql>,
    /// File -> the lines of its schemas Drift could not tie to all their root types
    /// (a root built by a call, `*bindables`, a class it cannot find): what they
    /// hold is not listed ([`Linker::graphql_unlisted`]).
    unlisted: BTreeMap<String, BTreeSet<u32>>,
}

/// What every entry point of one schema shares.
struct Schema<'a> {
    library: &'a str,
    /// The wraps the route serving it gives, where read.
    served: Vec<Wrap>,
    /// How it is served is not read.
    opaque: bool,
}

/// One resolver found for a root field.
struct Found {
    file: String,
    symbol: String,
    op: String,
    route: String,
    /// Permission wrappers (canonical, or `unresolved:<words>`).
    permissions: Vec<String>,
    inputs: Vec<String>,
    unwraps: Vec<String>,
}

fn operation(type_name: &str) -> Option<&'static str> {
    match type_name {
        "Query" => Some("QUERY"),
        "Mutation" => Some("MUTATION"),
        "Subscription" => Some("SUBSCRIPTION"),
        _ => None,
    }
}

impl Linker<'_> {
    /// The listed reading's GraphQL facts of file `rel`: none where the repository
    /// builds no schema, and none when linking what mining reads.
    pub(super) fn graphql_of(&self, rel: &str) -> Option<&FileGql> {
        if !self.graphql_schemas || !self.since_frozen() {
            return None;
        }
        self.graphql
            .get_or_init(|| self.graphql_table())
            .files
            .get(rel)
    }

    /// The lines of the schemas of file `fi` that Drift could not tie to all their
    /// root types, so that some of their operations are not listed: the hook for
    /// the report of the routes Python does not list (none yet). Empty when linking
    /// what mining reads.
    pub fn graphql_unlisted(&self, fi: usize) -> Vec<u32> {
        if !self.graphql_schemas || !self.since_frozen() {
            return Vec::new();
        }
        self.graphql
            .get_or_init(|| self.graphql_table())
            .unlisted
            .get(self.module_of(fi))
            .map(|l| l.iter().copied().collect())
            .unwrap_or_default()
    }

    fn graphql_table(&self) -> Table {
        let mut t = Table::default();
        // ariadne: the resolvers bound to each bindable, by its canonical name.
        let mut binds: BTreeMap<String, Vec<(usize, &RawGqlBind)>> = BTreeMap::new();
        for fi in 0..self.files.len() {
            for b in &self.files[fi].raw.graphql.binds {
                binds
                    .entry(self.canon(fi, &b.bindable))
                    .or_default()
                    .push((fi, b));
            }
        }
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi);
            // A schema a test builds serves no request.
            if is_test_path(rel) {
                continue;
            }
            for s in &self.files[fi].raw.graphql.schemas {
                let id = s.name.as_ref().map(|n| format!("{rel}#{n}"));
                let (served, opaque) = self.gql_serving(id.as_deref());
                let schema = Schema {
                    library: &s.library,
                    served,
                    opaque,
                };
                let mut found = Vec::new();
                let tied = if s.library == "ariadne" {
                    self.gql_ariadne(fi, s, &binds, &mut found)
                } else {
                    self.gql_roots(fi, s, &mut found)
                };
                if !tied || !s.unread.is_empty() {
                    t.unlisted
                        .entry(rel.to_string())
                        .or_default()
                        .insert(s.line);
                }
                for f in found {
                    self.gql_emit(&mut t, &schema, f);
                }
            }
        }
        for g in t.files.values_mut() {
            g.entries.sort();
            g.entries.dedup();
            g.mounts.sort();
            g.mounts
                .dedup_by(|a, b| a.symbol == b.symbol && a.route == b.route);
        }
        t
    }

    fn gql_emit(&self, t: &mut Table, schema: &Schema, f: Found) {
        if self.untracked(&f.file) || is_test_path(&f.file) {
            return;
        }
        let g = t.files.entry(f.file).or_default();
        let mut wraps = schema.served.clone();
        wraps.extend(f.permissions.into_iter().map(|wrapper| Wrap {
            wrapper,
            kind: WrapKind::Call,
        }));
        if !wraps.is_empty() || schema.opaque {
            g.mounts.push(drift_core::MountFacts {
                symbol: f.symbol.clone(),
                route: f.route.clone(),
                wraps,
                opaque: schema.opaque,
                ..Default::default()
            });
        }
        g.entries.push(EntryPoint {
            symbol: f.symbol.clone(),
            kind: "graphql".into(),
            method: Some(f.op),
            route: Some(f.route),
            adapter: schema.library.to_string(),
        });
        let inputs: BTreeSet<String> = f
            .inputs
            .into_iter()
            .filter(|c| self.is_repo_class(c))
            .collect();
        if !inputs.is_empty() {
            g.inputs.entry(f.symbol.clone()).or_default().extend(inputs);
        }
        if !f.unwraps.is_empty() {
            g.unwraps.entry(f.symbol).or_default().extend(f.unwraps);
        }
    }

    /// The type a canonical name stands for, with its file.
    fn gql_type(&self, canonical: &str) -> Option<(usize, &RawGqlType)> {
        let (module, name) = canonical.split_once('#')?;
        if module.contains(':') || name.contains(['.', '(']) {
            return None;
        }
        let ti = self.file(module)?;
        self.files[ti]
            .raw
            .graphql
            .types
            .iter()
            .find(|t| t.name == name)
            .map(|t| (ti, t))
    }

    /// A type and the types of the repository it is built on, itself first, each
    /// base before its own bases, each once: where a field or a method is looked up.
    fn gql_chain<'s>(&'s self, ti: usize, t: &'s RawGqlType) -> Vec<(usize, &'s RawGqlType)> {
        let mut out: Vec<(usize, &RawGqlType)> = Vec::new();
        let mut stack: Vec<(usize, &RawGqlType)> = vec![(ti, t)];
        while let Some((fi, ty)) = stack.pop() {
            if out.len() >= MAX_BASES || out.iter().any(|(f, x)| *f == fi && x.name == ty.name) {
                continue;
            }
            out.push((fi, ty));
            for b in ty.bases.iter().rev() {
                if let Some(base) = self.gql_type(&self.canon(fi, b)) {
                    stack.push(base);
                }
            }
        }
        out
    }

    /// The symbol a function given as a resolver is: a module-level function, or a
    /// resolver method of a class ([`RawGraphql::methods`]).
    fn gql_function(&self, canonical: &str) -> Option<(String, String)> {
        let (module, name) = canonical.split_once('#')?;
        if module.contains(':') || name.contains('(') {
            return None;
        }
        let fi = self.file(module)?;
        let raw = &self.files[fi].raw;
        let found = if name.contains('.') {
            raw.graphql.methods.iter().any(|m| m.name == name)
        } else {
            raw.symbols
                .iter()
                .any(|s| s.name == name && s.kind == drift_core::SymbolKind::Function)
        };
        found.then(|| (module.to_string(), name.to_string()))
    }

    /// The first class of `chain` with one of `methods`, as a symbol.
    fn gql_method(
        &self,
        chain: &[(usize, &RawGqlType)],
        methods: &[&str],
    ) -> Option<(String, String)> {
        chain.iter().find_map(|(fi, t)| {
            methods
                .iter()
                .find(|m| t.methods.iter().any(|x| x == *m))
                .map(|m| (self.module_of(*fi).to_string(), format!("{}.{m}", t.name)))
        })
    }

    /// strawberry and graphene: each root's fields and what resolves them. False
    /// where a root type is not found.
    fn gql_roots(&self, fi: usize, s: &RawGqlSchema, found: &mut Vec<Found>) -> bool {
        let mut tied = true;
        let graphene = s.library == "graphene";
        for (op, root) in &s.roots {
            let (root_name, starts) = match root {
                RawGqlRoot::Ref(r) => match self.gql_type(&self.canon(fi, r)) {
                    Some((ti, t)) => (t.name.clone(), vec![(ti, t)]),
                    None => {
                        tied = false;
                        continue;
                    }
                },
                RawGqlRoot::Merged(name, refs) => {
                    let mut starts = Vec::new();
                    for r in refs {
                        match self.gql_type(&self.canon(fi, r)) {
                            Some(x) => starts.push(x),
                            None => tied = false,
                        }
                    }
                    (name.clone(), starts)
                }
            };
            let mut chain: Vec<(usize, &RawGqlType)> = Vec::new();
            for (ti, t) in starts {
                for x in self.gql_chain(ti, t) {
                    if !chain.iter().any(|(f, y)| *f == x.0 && y.name == x.1.name) {
                        chain.push(x);
                    }
                }
            }
            let mut seen = BTreeSet::new();
            for (ti, t) in &chain {
                for field in &t.fields {
                    if !seen.insert(field.name.as_str()) {
                        continue;
                    }
                    let mut inputs: Vec<String> =
                        field.args.iter().map(|r| self.canon(*ti, r)).collect();
                    let target = match &field.resolver {
                        RawGqlResolver::Method(m) => t
                            .methods
                            .contains(m)
                            .then(|| (self.module_of(*ti).to_string(), format!("{}.{m}", t.name))),
                        RawGqlResolver::Function(r) => self.gql_function(&self.canon(*ti, r)),
                        RawGqlResolver::Mounted(r) => {
                            self.gql_type(&self.canon(*ti, r)).and_then(|(mi, mt)| {
                                let mutation = self.gql_chain(mi, mt);
                                for (ai, a) in &mutation {
                                    inputs.extend(a.args.iter().map(|r| self.canon(*ai, r)));
                                }
                                self.gql_method(&mutation, &["mutate", "mutate_and_get_payload"])
                            })
                        }
                        RawGqlResolver::Declared | RawGqlResolver::Connection(_) if graphene => {
                            let own = format!("resolve_{}", field.name);
                            self.gql_method(&chain, &[own.as_str()]).or_else(|| {
                                let RawGqlResolver::Connection(node) = &field.resolver else {
                                    return None;
                                };
                                // A connection with no resolver of its own reads the
                                // rows its node type's `get_queryset` gives, or the
                                // model's: the node type is what runs.
                                let c = self.canon(*ti, node);
                                match self.gql_type(&c) {
                                    Some((ni, nt)) => self
                                        .gql_method(&self.gql_chain(ni, nt), &["get_queryset"])
                                        .or_else(|| {
                                            Some((self.module_of(ni).to_string(), nt.name.clone()))
                                        }),
                                    None => None,
                                }
                            })
                        }
                        RawGqlResolver::Declared | RawGqlResolver::Connection(_) => None,
                    };
                    let Some((file, symbol)) = target else {
                        continue;
                    };
                    let mut permissions: Vec<String> = field
                        .permissions
                        .iter()
                        .map(|r| self.canon(*ti, r))
                        .collect();
                    permissions.extend(field.unread.iter().map(|w| format!("unresolved:{w}")));
                    found.push(Found {
                        file,
                        symbol,
                        op: op.clone(),
                        route: format!("{root_name}.{}", field.name),
                        permissions,
                        inputs,
                        unwraps: vec![],
                    });
                }
            }
        }
        tied
    }

    /// ariadne: the resolvers bound to the root bindables given. False where a
    /// bindable given is not found.
    fn gql_ariadne(
        &self,
        fi: usize,
        s: &RawGqlSchema,
        binds: &BTreeMap<String, Vec<(usize, &RawGqlBind)>>,
        found: &mut Vec<Found>,
    ) -> bool {
        let mut tied = true;
        for b in &s.bindables {
            let c = self.canon(fi, b);
            let Some((module, var)) = c.split_once('#') else {
                tied = false;
                continue;
            };
            if module.contains(':') {
                // A bindable of a package (`snake_case_fallback_resolvers`).
                continue;
            }
            let Some(bf) = self.file(module) else {
                tied = false;
                continue;
            };
            // A bindable of a type that is no root (`ObjectType("User")`) is not
            // recorded: its fields run inside an operation.
            let Some(type_name) = self.files[bf]
                .raw
                .graphql
                .bindables
                .iter()
                .find(|x| x.name == var)
                .map(|x| x.type_name.as_str())
            else {
                continue;
            };
            let Some(op) = operation(type_name) else {
                continue;
            };
            for (bi, bind) in binds.get(&c).into_iter().flatten() {
                let Some((file, symbol)) = self.gql_function(&self.canon(*bi, &bind.resolver))
                else {
                    continue;
                };
                found.push(Found {
                    file,
                    symbol,
                    op: op.to_string(),
                    route: format!("{type_name}.{}", bind.field),
                    permissions: vec![],
                    inputs: vec![],
                    unwraps: bind.unwraps.iter().map(|r| self.canon(*bi, r)).collect(),
                });
            }
        }
        tied
    }

    /// What guards the HTTP route that serves the schema `schema` (canonical) gives
    /// each of its operations, and whether that is not read. Read for a library's
    /// view handed the schema in a Django URLconf (`path("graphql/",
    /// login_required(GraphQLView.as_view(schema=schema)))`): its wrappers, the
    /// URLconfs it is included through, the settings' middleware. Anything else is
    /// not read: a schema with no name, served nowhere Drift reads, through a view
    /// class of the repository (whose `dispatch` may do anything first), or served
    /// on two routes that differ.
    fn gql_serving(&self, schema: Option<&str>) -> (Vec<Wrap>, bool) {
        let Some(schema) = schema else {
            return (Vec::new(), true);
        };
        let mut found: Vec<Vec<Wrap>> = Vec::new();
        let mut unread = false;
        for fi in 0..self.files.len() {
            let raw = &self.files[fi].raw;
            if raw.graphql.served.is_empty() || is_test_path(self.module_of(fi)) {
                continue;
            }
            for sv in &raw.graphql.served {
                if self.canon(fi, &sv.schema) != schema {
                    continue;
                }
                let view = self.canon(fi, &sv.view);
                if !view.starts_with("pkg:") {
                    unread = true;
                    continue;
                }
                let regs: Vec<&RawRegistration> = raw
                    .registrations
                    .iter()
                    .filter(|g| {
                        !g.candidate && g.adapter == "django" && self.canon(fi, &g.target) == view
                    })
                    .collect();
                if regs.is_empty() {
                    unread = true;
                }
                for g in regs {
                    let nodes = match &g.router {
                        Some(r) => self.nodes_of(fi, r),
                        None => vec![self.module_of(fi).to_string()],
                    };
                    for node in nodes {
                        if self.is_dead(&node) {
                            continue;
                        }
                        match self.gql_route_wraps(fi, g, &node) {
                            Some(w) => found.push(w),
                            None => unread = true,
                        }
                    }
                }
            }
        }
        let Some((first, rest)) = found.split_first() else {
            return (Vec::new(), true);
        };
        let common: Vec<Wrap> = first
            .iter()
            .filter(|w| rest.iter().all(|r| r.contains(w)))
            .cloned()
            .collect();
        let same = rest.iter().all(|r| r == first);
        (common, unread || !same)
    }

    /// The wraps one Django registration of a library's view gives what it serves,
    /// outermost first; `None` where a mount on the way to it is not read, or its
    /// routes are not all given the same.
    fn gql_route_wraps(&self, fi: usize, g: &RawRegistration, node: &str) -> Option<Vec<Wrap>> {
        let chains = self.chains(node, 0);
        if chains.is_empty() || chains.iter().any(|c| c.opaque) {
            return None;
        }
        let served = Served::of(&chains, |c| c.prefix.clone());
        if served
            .adds
            .iter()
            .any(|(guards, hooks, opaque)| !guards.is_empty() || !hooks.is_empty() || *opaque)
        {
            return None;
        }
        let wrap = |wrapper: String, kind| Wrap { wrapper, kind };
        let reg: Vec<String> = g.guards.iter().map(|r| self.canon(fi, r)).collect();
        let mut out: Vec<Wrap> = served
            .hooks
            .iter()
            .chain(&self.django_served)
            .map(|h| wrap(h.clone(), WrapKind::AppHook))
            .collect();
        out.extend(self.package_view_settings(node, &reg));
        // Django runs what is given where the view is registered as decorators of
        // the view.
        out.extend(
            served
                .guards
                .iter()
                .map(|d| wrap(d.id.clone(), WrapKind::Decorator)),
        );
        out.extend(reg.into_iter().map(|r| wrap(r, WrapKind::Decorator)));
        for (r, text) in &g.since_guards {
            let wrapper = match r {
                Some(r) => self.canon(fi, r),
                None => format!("unresolved:{text}"),
            };
            out.push(wrap(wrapper, WrapKind::Decorator));
        }
        Some(out)
    }
}
