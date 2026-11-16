//! GraphQL servers outside NestJS: each field of a root type (`Query`, `Mutation`,
//! `Subscription`) is an operation any caller of the server can run, so each is an
//! entry point of kind `graphql`, named and shaped as a NestJS resolver's is
//! (`QUERY Query.user`, method `QUERY`, route `<type>.<field>`).
//!
//! Read from the documented API of each package, never from what a binding is
//! called:
//!
//! - **Resolver maps** given to a server or a schema builder of a GraphQL package
//!   (`new ApolloServer({ resolvers })`, `createSchema({ resolvers })`,
//!   `makeExecutableSchema({ resolvers })`, `buildSubgraphSchema(...)`), in place,
//!   through a binding, an array, `mergeResolvers([...])`, an import or a spread.
//!   Which bindings are served is proven across files by linking
//!   ([`crate::resolve`]); a part that cannot be read is said through the
//!   unlisted-routes report, never dropped silently.
//! - **Code-first builders**: Pothos (`builder.queryField(...)` of a
//!   `new SchemaBuilder()` of `@pothos/core`), Nexus (`queryField`,
//!   `mutationField`, `extendType({ type: "Query" })` of `nexus`) and TypeGraphQL
//!   (`@Resolver` classes with `@Query` / `@Mutation` / `@Subscription` methods of
//!   `type-graphql`).
//! - **Guards**: a call wrapped around a resolver is a wrap of it, as a middleware
//!   is of a route; a `graphql-shield` rule map applied with `applyMiddleware` gives
//!   each field its rule; Pothos `authScopes`, Nexus `authorize` and a server
//!   `context` function that may refuse are guards Drift does not read: the
//!   operation's guard is unknown, never "none". Checks in a resolver's body are
//!   read as a handler's are: its context parameter is a holder of the caller.
//! - **Input**: a resolver's `args` parameter is request input.
//!
//! Mining is frozen: everything here is the listed reading only
//! ([`super::routes::unmeasured_listing`]).

use super::*;

/// The root types whose fields are operations a caller runs, with the method label
/// of their entry points.
const ROOTS: &[(&str, &str)] = &[
    ("Query", "QUERY"),
    ("Mutation", "MUTATION"),
    ("Subscription", "SUBSCRIPTION"),
];

/// Calls of a GraphQL package whose options (the first argument, or each object of
/// an array of them) take resolver maps under `resolvers`, as (package, export). A
/// package is matched by name, a subpath of it, or for `apollo-server` by its prefix
/// (`apollo-server-express`).
const SERVES: &[(&str, &str)] = &[
    ("@apollo/server", "ApolloServer"),
    ("apollo-server", "ApolloServer"),
    ("graphql-yoga", "createSchema"),
    ("@graphql-yoga/node", "createSchema"),
    ("@graphql-tools/schema", "makeExecutableSchema"),
    ("graphql-tools", "makeExecutableSchema"),
    ("@apollo/subgraph", "buildSubgraphSchema"),
    ("@apollo/federation", "buildFederatedSchema"),
];

/// Calls that merge resolver maps into one: what they are given is served with
/// what they hand back.
const MERGES: &[(&str, &str)] = &[
    ("@graphql-tools/merge", "mergeResolvers"),
    ("graphql-tools", "mergeResolvers"),
];

/// The Yoga server: it is given a schema, which may be built in place.
const YOGA: &[(&str, &str)] = &[
    ("graphql-yoga", "createYoga"),
    ("@graphql-yoga/node", "createServer"),
];

/// Packages whose server plugins only serve or describe the schema (a landing page,
/// draining the HTTP server, cache hints): none turns a caller away.
const SERVING_PLUGIN_PACKAGES: &[&str] = &["@apollo/server", "apollo-server-core"];

/// Pothos `t.<method>` field builders whose resolver takes the query first:
/// `resolve: (query, parent, args, ctx)` (`@pothos/plugin-prisma`).
const POTHOS_QUERY_FIRST: &[&str] = &["prismaField", "prismaConnection"];

/// What a file says of GraphQL operations, for linking to prove which are served
/// ([`crate::resolve`]). Never read by mining.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawGraphql {
    /// Resolver maps, and the fields of a Pothos builder.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub maps: Vec<RawGqlMap>,
    /// What a server or a schema builder of the file is given as resolvers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub served: Vec<RawServed>,
    /// Top-level bindings that are a Pothos `SchemaBuilder`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub builders: Vec<String>,
    /// `graphql-shield` rule maps.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shields: Vec<RawShield>,
    /// What `applyMiddleware(schema, ...)` of `graphql-middleware` is given after
    /// the schema.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub applied: Vec<RawRef>,
}

impl RawGraphql {
    pub fn is_empty(&self) -> bool {
        self.maps.is_empty()
            && self.served.is_empty()
            && self.builders.is_empty()
            && self.shields.is_empty()
            && self.applied.is_empty()
    }
}

/// A resolver map bound to a name (`resolvers`, `default`; a map written in place
/// where it is served has a name of its own, `(resolvers <line>)`), or the root
/// fields one Pothos call adds to a builder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawGqlMap {
    pub name: String,
    /// The Pothos builder the fields are added to: they are operations when it is
    /// proven to be one, whether or not anything serves this map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builder: Option<RawRef>,
    /// The maps it takes in: spread (`...users`), listed in an array or merged, each
    /// with the one root type it is taken for (`...users.Query` inside `Query`),
    /// empty for every root, and the line it is written on.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<RawGqlPart>,
    /// Its own root fields.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<RawGqlEntry>,
    /// Lines of what it holds that may be root fields and is not read (a spread of
    /// a value Drift cannot follow, a computed key).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unlisted: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawGqlPart {
    pub root: String,
    pub map: RawRef,
    pub line: u32,
}

/// One root field: the symbol of its resolver and its entry point.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawGqlEntry {
    pub root: String,
    pub field: String,
    pub symbol: RawSymbol,
    pub entry: drift_core::EntryPoint,
}

/// A map given to a server or a schema builder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawServed {
    pub map: RawRef,
    pub line: u32,
    /// What the server runs before every operation and Drift does not read (a
    /// `context` function that may refuse, a plugin), as
    /// [`RawSymbol::app_unread`] says it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<String>,
}

/// A `graphql-shield` rule map (`shield({ Query: { me: isAuthenticated } },
/// { fallbackRule })`) bound to a name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawShield {
    pub name: String,
    /// `<type>.<field>` (`Query.*` for every field of the type) -> the rules.
    pub rules: Vec<(String, Vec<RawRef>)>,
    /// The rule of every field the map gives none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fallback: Vec<RawRef>,
    /// Some key of it is not read: a field it may give a rule has none here.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unread: bool,
}

/// The method label of a root type's fields.
fn root_label(root: &str) -> Option<&'static str> {
    ROOTS.iter().find(|(r, _)| *r == root).map(|(_, l)| *l)
}

/// A string written as a literal (`"Query"`, `` `me` ``).
fn text_of(e: &Expression) -> Option<String> {
    match unwrap_expr(e) {
        Expression::StringLiteral(l) => Some(lit(l)),
        Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
            t.quasis.first().map(|q| q.value.raw.to_string())
        }
        _ => None,
    }
}

/// What an arrow function hands back: its expression, or the value of the one
/// `return` of its block.
fn arrow_result<'b, 'a>(a: &'b ArrowFunctionExpression<'a>) -> Option<&'b Expression<'a>> {
    if let Some(e) = a.get_expression() {
        return Some(unwrap_expr(e));
    }
    function_result(&a.body.as_function_body()?.statements)
}

fn function_result<'b, 'a>(statements: &'b [Statement<'a>]) -> Option<&'b Expression<'a>> {
    let mut returns = statements.iter().filter_map(|s| match s {
        Statement::ReturnStatement(r) => r.argument.as_ref(),
        _ => None,
    });
    match (returns.next(), returns.next()) {
        (Some(e), None) => Some(unwrap_expr(e)),
        _ => None,
    }
}

/// The name of a function's first parameter (`t` of `definition(t)`).
fn first_param_name<'a>(params: &FormalParameters<'a>) -> Option<&'a str> {
    match &params.items.first()?.pattern {
        BindingPattern::BindingIdentifier(b) => Some(b.name.as_str()),
        _ => None,
    }
}

/// The member chain `t.nonNull.list.field` starts at the identifier `t`.
fn rooted_at(e: &Expression, name: &str) -> bool {
    match unwrap_expr(e) {
        Expression::Identifier(id) => id.name == name,
        Expression::StaticMemberExpression(m) => rooted_at(&m.object, name),
        Expression::CallExpression(c) => match unwrap_expr(&c.callee) {
            Expression::StaticMemberExpression(m) => rooted_at(&m.object, name),
            _ => false,
        },
        _ => false,
    }
}

impl Lowerer<'_> {
    /// The package export a callee is (`ApolloServer` of `@apollo/server`).
    fn gql_export(&self, callee: &Expression) -> Option<(String, String)> {
        match self.canon(callee)? {
            RawRef {
                base: RawBase::Import { spec, name },
                member,
            } if member.is_empty() => Some((spec, name)),
            // `import * as yoga from "graphql-yoga"; yoga.createSchema(...)`.
            RawRef {
                base: RawBase::Import { spec, name },
                member,
            } if name == "*" && member.matches('.').count() == 1 => {
                Some((spec, member[1..].to_string()))
            }
            _ => None,
        }
    }

    fn gql_is(&self, callee: &Expression, table: &[(&str, &str)]) -> bool {
        self.gql_export(callee).is_some_and(|(spec, name)| {
            table
                .iter()
                .any(|(s, n)| *n == name && (spec == *s || spec.starts_with(&format!("{s}/"))))
        })
    }

    /// `callee` is given resolver maps ([`SERVES`]).
    fn gql_serves(&self, callee: &Expression) -> bool {
        self.gql_export(callee).is_some_and(|(spec, name)| {
            SERVES.iter().any(|(s, n)| {
                *n == name
                    && (spec == *s
                        || spec.starts_with(&format!("{s}/"))
                        || (*s == "apollo-server" && spec.starts_with("apollo-server-")))
            })
        })
    }

    /// Reads the GraphQL operations of the file: the listed reading only.
    pub(super) fn lower_graphql(&mut self, program: &Program) {
        if self.test_file {
            return;
        }
        let mut found = RawGraphql::default();
        let mut direct = Vec::new();
        let mut unlisted = Vec::new();
        {
            let mut finder = GqlFinder {
                l: self,
                found: &mut found,
                direct: &mut direct,
                unlisted: &mut unlisted,
                top: BTreeMap::new(),
                taken: BTreeSet::new(),
                done: BTreeSet::new(),
            };
            finder.top_level(program);
            finder.visit_program(program);
        }
        // Maps that only take in others (`export default { ...users, ...posts }`)
        // list nothing by themselves: kept in both readings, they prove nothing
        // where nothing serves them.
        let lists = found
            .maps
            .iter()
            .any(|m| !m.entries.is_empty() || !m.unlisted.is_empty())
            || !direct.is_empty()
            || !unlisted.is_empty()
            || !found.builders.is_empty()
            || !found.shields.is_empty()
            || !found.applied.is_empty()
            || !found.served.is_empty();
        if !lists {
            self.out.graphql = found;
            return;
        }
        // The last measured build listed none of this.
        if routes::unmeasured_listing() {
            return;
        }
        for (sym, entry) in direct {
            self.push_symbol(sym);
            self.out.entry_points.push(entry);
        }
        self.out.unlisted_routes.extend(unlisted);
        self.out.unlisted_routes.sort_unstable();
        self.out.unlisted_routes.dedup();
        self.out.graphql = found;
    }

    /// A symbol name no symbol of the file has yet (`QUERY Query.me`,
    /// `QUERY Query.me #2`), beside `taken`.
    fn gql_name(&self, label: &str, route: &str, taken: &BTreeSet<String>) -> String {
        let mut name = format!("{label} {route}");
        let mut n = 2;
        while taken.contains(&name) || self.out.symbols.iter().any(|s| s.name == name) {
            name = format!("{label} {route} #{n}");
            n += 1;
        }
        name
    }

    /// The symbol and entry point of a root field whose resolver is `value`, wrapped
    /// by what `value` is built with. `args_at` is the index of the resolver's
    /// `args` parameter.
    fn gql_entry(
        &self,
        root: &str,
        field: &str,
        value: &Expression,
        args_at: usize,
        name: String,
        line: u32,
    ) -> (RawSymbol, drift_core::EntryPoint) {
        let label = root_label(root).unwrap_or("QUERY");
        let mut sym = RawSymbol::empty(&name, SymbolKind::Function, line);
        let mut handler = unwrap_expr(value);
        // `{ resolve, subscribe }`: a subscription is run by its `subscribe`.
        if let Expression::ObjectExpression(o) = handler {
            let key = if root == "Subscription" {
                "subscribe"
            } else {
                "resolve"
            };
            match routes::object_prop(o, key).or_else(|| routes::object_prop(o, "resolve")) {
                Some(h) => handler = unwrap_expr(h),
                None => sym
                    .app_unread
                    .push(format!("the resolver of {root}.{field}")),
            }
        }
        // `requireAuth(resolver)`, `combineResolvers(isAuthenticated, resolver)`:
        // what builds the resolver wraps it, and so does every function it is
        // given beside the resolver, the last argument.
        let mut depth = 0;
        while let Expression::CallExpression(c) = handler
            && depth < 4
        {
            depth += 1;
            if let Some(r) = self
                .canon(&c.callee)
                .filter(|r| !matches!(r.base, RawBase::Global(_)))
            {
                sym.wraps.push((r, WrapKind::Call));
            } else {
                sym.app_unread
                    .push(format!("a wrapper of {root}.{field} that is not read"));
            }
            let args: Vec<&Expression> = c
                .arguments
                .iter()
                .filter_map(|a| a.as_expression())
                .collect();
            if c.arguments.len() != args.len() {
                sym.app_unread
                    .push(format!("a wrapper of {root}.{field} given a spread"));
            }
            let Some((last, rest)) = args.split_last() else {
                break;
            };
            for a in rest {
                match unwrap_expr(a) {
                    x @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => {
                        if let Some(r) = self
                            .canon(x)
                            .filter(|r| !matches!(r.base, RawBase::Global(_)))
                        {
                            sym.wraps.push((r, WrapKind::Call));
                        }
                    }
                    Expression::ArrowFunctionExpression(_)
                    | Expression::FunctionExpression(_)
                    | Expression::CallExpression(_) => sym
                        .app_unread
                        .push(format!("a wrapper of {root}.{field} written in place")),
                    _ => {}
                }
            }
            handler = unwrap_expr(last);
        }
        match handler {
            Expression::ArrowFunctionExpression(a) => {
                let status =
                    self.gql_args(&a.params, args_at, || ReachesArguments::of_arrow(&a.body));
                self.gql_body(handler, status, &mut sym);
            }
            Expression::FunctionExpression(f) => {
                let status = self.gql_args(&f.params, args_at, || {
                    ReachesArguments::of(f.body.as_deref())
                });
                self.gql_body(handler, status, &mut sym);
            }
            // A resolver bound elsewhere is read where it is declared.
            h => self.handler_facts(Some(h), &mut sym),
        }
        let entry = drift_core::EntryPoint {
            symbol: name,
            kind: "graphql".into(),
            method: Some(label.into()),
            route: Some(format!("{root}.{field}")),
            adapter: "graphql".into(),
        };
        (sym, entry)
    }

    /// What a resolver reads of its `args` parameter (`(parent, args, ctx, info)`):
    /// input when it is destructured or used, none when there is no such parameter
    /// or nothing uses it, and unknown for a rest parameter.
    fn gql_args(
        &self,
        params: &FormalParameters,
        at: usize,
        reaches_arguments: impl FnOnce() -> bool,
    ) -> input::InputUse {
        let Some(p) = params.items.get(at) else {
            if params.rest.is_some() {
                return input::InputUse::Unknown;
            }
            return if reaches_arguments() {
                input::InputUse::Unknown
            } else {
                input::InputUse::None
            };
        };
        match &p.pattern {
            BindingPattern::BindingIdentifier(b) => match b.symbol_id.get() {
                Some(s) if self.scoping.get_resolved_reference_ids(s).is_empty() => {
                    input::InputUse::None
                }
                Some(_) => input::InputUse::Reads,
                None => input::InputUse::Unknown,
            },
            BindingPattern::ObjectPattern(o) if o.properties.is_empty() && o.rest.is_none() => {
                input::InputUse::None
            }
            BindingPattern::ObjectPattern(_) => input::InputUse::Reads,
            _ => input::InputUse::Unknown,
        }
    }

    /// The facts of a resolver written in place, read as a handler's body is.
    fn gql_body(&self, f: &Expression, status: input::InputUse, sym: &mut RawSymbol) {
        let mut c = Collector::new(self);
        c.visit_expression(f);
        c.fill(sym);
        // What the handler reading takes for the request's input is its first
        // parameter, a resolver's parent value: only `args` is said here.
        sym.controls.retain(|c| {
            c != drift_core::controls::READS_INPUT && c != drift_core::controls::NO_INPUT
        });
        record_input(sym, false, status);
    }

    /// TypeGraphQL resolver classes (`@Resolver()` of `type-graphql`): each method
    /// decorated `@Query()`, `@Mutation()` or `@Subscription()` is an operation,
    /// wrapped by the decorators of its class and its own (`@Authorized()`,
    /// `@UseMiddleware(...)`), whose `@Arg()` / `@Args()` parameters are input.
    pub(super) fn lower_type_graphql(&mut self, class: &Class) {
        if self.test_file {
            return;
        }
        let tg = |r: &RawRef| match &r.base {
            RawBase::Import { spec, name } if r.member.is_empty() && spec == "type-graphql" => {
                Some(name.clone())
            }
            _ => None,
        };
        let refs: Vec<RawRef> = class
            .decorators
            .iter()
            .filter_map(|d| self.decorator_ref(d))
            .collect();
        if !refs.iter().any(|r| tg(r).as_deref() == Some("Resolver")) {
            return;
        }
        let class_name = class
            .id
            .as_ref()
            .map_or_else(|| "default".to_string(), |i| i.name.to_string());
        let mut class_wraps = Vec::new();
        for d in &class.decorators {
            if let Some(r) = self.decorator_ref(d)
                && tg(&r).as_deref() != Some("Resolver")
            {
                class_wraps.extend(self.tg_middleware(d, &r));
                class_wraps.push((r, WrapKind::Decorator));
            }
        }
        let mut found = Vec::new();
        for el in &class.body.body {
            let ClassElement::MethodDefinition(m) = el else {
                continue;
            };
            let mut label = None;
            let mut wraps = class_wraps.clone();
            for d in &m.decorators {
                let Some(r) = self.decorator_ref(d) else {
                    continue;
                };
                match tg(&r).as_deref() {
                    Some("Query") => label = Some("QUERY"),
                    Some("Mutation") => label = Some("MUTATION"),
                    Some("Subscription") => label = Some("SUBSCRIPTION"),
                    _ => {
                        wraps.extend(self.tg_middleware(d, &r));
                        wraps.push((r, WrapKind::Decorator));
                    }
                }
            }
            let Some(label) = label else { continue };
            let mut sym = RawSymbol::empty("", SymbolKind::Function, self.line_of(m.span.start));
            sym.wraps = wraps;
            let mut keys = Collector::new(self);
            keys.in_method_of(class);
            if let Some(body) = &m.value.body {
                keys.flow_method_params(&m.value.params);
                keys.visit_function_body(body);
            }
            keys.fill(&mut sym);
            sym.controls.retain(|c| {
                c != drift_core::controls::READS_INPUT && c != drift_core::controls::NO_INPUT
            });
            let params = &m.value.params;
            let status = if params.items.is_empty() && params.rest.is_none() {
                input::InputUse::None
            } else if params.items.iter().any(|p| {
                p.decorators.iter().any(|d| {
                    self.decorator_ref(d)
                        .and_then(|r| tg(&r))
                        .is_some_and(|n| n == "Arg" || n == "Args")
                })
            }) {
                input::InputUse::Reads
            } else {
                input::InputUse::Unknown
            };
            record_input(&mut sym, false, status);
            let method = m
                .key
                .static_name()
                .and_then(|k| k.as_str().map(String::from))
                .unwrap_or_else(|| "?".into());
            found.push((label, format!("{class_name}.{method}"), sym));
        }
        if found.is_empty() || routes::unmeasured_listing() {
            return;
        }
        for (label, route, mut sym) in found {
            let name = self.gql_name(label, &route, &BTreeSet::new());
            sym.name = name.clone();
            self.push_symbol(sym);
            self.out.entry_points.push(drift_core::EntryPoint {
                symbol: name,
                kind: "graphql".into(),
                method: Some(label.into()),
                route: Some(route),
                adapter: "graphql".into(),
            });
        }
    }

    /// What `@UseMiddleware(A, B)` of `type-graphql` runs before the resolver.
    fn tg_middleware(&self, d: &Decorator, r: &RawRef) -> Vec<(RawRef, WrapKind)> {
        let is = matches!(&r.base, RawBase::Import { spec, name }
            if spec == "type-graphql" && name == "UseMiddleware" && r.member.is_empty());
        let Expression::CallExpression(c) = unwrap_expr(&d.expression) else {
            return Vec::new();
        };
        if !is {
            return Vec::new();
        }
        c.arguments
            .iter()
            .filter_map(|a| a.as_expression())
            .filter_map(|a| self.canon(a))
            .filter(|r| !matches!(r.base, RawBase::Global(_)))
            .map(|r| (r, WrapKind::Call))
            .collect()
    }
}

/// Finds what [`RawGraphql`] holds, and the operations a file proves by itself
/// (Nexus).
struct GqlFinder<'l, 's, 'f, 'p, 'a> {
    l: &'l Lowerer<'s>,
    found: &'f mut RawGraphql,
    direct: &'f mut Vec<(RawSymbol, drift_core::EntryPoint)>,
    /// Lines of what may be an operation the file proves by itself and is not read.
    unlisted: &'f mut Vec<u32>,
    /// The file's top-level `const` bindings and what they are bound to.
    top: BTreeMap<&'p str, &'p Expression<'a>>,
    /// Symbol names given so far.
    taken: BTreeSet<String>,
    /// The serving calls read already, by where they start: a schema built in
    /// place in `createYoga({ schema })` is read with the server's options.
    done: BTreeSet<u32>,
}

/// A name of a map written in place, unique in the file.
fn inner_name(kind: &str, at: u32) -> String {
    format!("({kind} @{at})")
}

fn local(name: String) -> RawRef {
    RawRef {
        base: RawBase::Local(name),
        member: String::new(),
    }
}

impl<'p, 'a> GqlFinder<'_, '_, '_, 'p, 'a> {
    fn name(&mut self, root: &str, field: &str) -> String {
        let label = root_label(root).unwrap_or("QUERY");
        let name = self
            .l
            .gql_name(label, &format!("{root}.{field}"), &self.taken);
        self.taken.insert(name.clone());
        name
    }

    /// A top-level object of the file bound with `const`.
    fn top_object(&self, name: &str) -> Option<&'p ObjectExpression<'a>> {
        match self.top.get(name).copied().map(unwrap_expr) {
            Some(Expression::ObjectExpression(o)) => Some(o),
            _ => None,
        }
    }

    /// The top-level bindings: resolver maps, merges, Pothos builders and shield
    /// maps bound to a name.
    fn top_level(&mut self, program: &'p Program<'a>) {
        let mut bound: Vec<(&'p str, &'p Expression<'a>)> = Vec::new();
        for stmt in &program.body {
            let decl = match stmt {
                Statement::ExportDeclaration(e) => Some(&e.declaration),
                s => s.as_declaration(),
            };
            if let Some(Declaration::VariableDeclaration(v)) = decl
                && v.kind == VariableDeclarationKind::Const
            {
                for d in &v.declarations {
                    if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) {
                        bound.push((id.name.as_str(), init));
                    }
                }
            }
            if let Statement::ExportDefaultDeclaration(e) = stmt
                && let Some(x) = e.declaration.as_expression()
                && !matches!(unwrap_expr(x), Expression::Identifier(_))
            {
                bound.push(("default", x));
            }
        }
        for (name, init) in &bound {
            self.top.insert(name, init);
        }
        for (name, init) in bound {
            let init = unwrap_expr(init);
            if let Expression::NewExpression(n) = init
                && matches!(self.l.gql_export(&n.callee), Some((spec, export))
                    if spec == "@pothos/core" && export == "default")
            {
                self.found.builders.push(name.to_string());
                continue;
            }
            if let Some(shield) = self.shield(name, init) {
                self.found.shields.push(shield);
                continue;
            }
            // A binding named for a root type holds that type's fields
            // (`export const Query = { ... }`, read through `import * as resolvers`).
            if root_label(name).is_some()
                && let Expression::ObjectExpression(o) = init
            {
                let mut map = empty_map(name);
                self.root_fields(&mut map, name, o, 0);
                if !map.entries.is_empty() || !map.unlisted.is_empty() {
                    self.found.maps.push(map);
                }
                continue;
            }
            if let Some(map) = self.map_of(name, init, false) {
                self.found.maps.push(map);
            }
        }
    }

    /// `e` read as resolver maps: an object with root types or spreads, an array of
    /// maps, `mergeResolvers([...])`. `served` reads any object or array as maps
    /// (it is given where resolvers go); otherwise only an object that has a root
    /// type or only spreads, and an array of names. None for anything else.
    fn map_of(&mut self, name: &str, e: &Expression<'a>, served: bool) -> Option<RawGqlMap> {
        let mut map = empty_map(name);
        match unwrap_expr(e) {
            Expression::ObjectExpression(o) => {
                let has_root = o.properties.iter().any(|p| match p {
                    ObjectPropertyKind::ObjectProperty(p) => {
                        !p.computed && key_name(&p.key).is_some_and(|k| root_label(&k).is_some())
                    }
                    ObjectPropertyKind::SpreadProperty(_) => false,
                });
                let all_spreads = !o.properties.is_empty()
                    && o.properties
                        .iter()
                        .all(|p| matches!(p, ObjectPropertyKind::SpreadProperty(_)));
                if !(served || has_root || all_spreads) {
                    return None;
                }
                self.map_object(&mut map, o);
            }
            Expression::ArrayExpression(a) => {
                let names = a.elements.iter().all(|el| {
                    el.as_expression().is_some_and(|x| {
                        matches!(
                            unwrap_expr(x),
                            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                        )
                    })
                });
                if a.elements.is_empty() || !(served || names) {
                    return None;
                }
                for el in &a.elements {
                    let line = self.l.line_of(el.span().start);
                    match el.as_expression() {
                        Some(x) => self.part(&mut map, "", x, line),
                        None => map.unlisted.push(line),
                    }
                }
            }
            Expression::CallExpression(c) if self.l.gql_is(&c.callee, MERGES) => {
                for a in &c.arguments {
                    let line = self.l.line_of(a.span().start);
                    match a.as_expression() {
                        Some(x) => self.part(&mut map, "", x, line),
                        None => map.unlisted.push(line),
                    }
                }
            }
            _ => return None,
        }
        Some(map)
    }

    /// One value a map takes in for `root` (every root when empty).
    fn part(&mut self, map: &mut RawGqlMap, root: &str, x: &Expression<'a>, line: u32) {
        match unwrap_expr(x) {
            e @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => {
                match self
                    .l
                    .canon(e)
                    .filter(|r| !matches!(r.base, RawBase::Global(_)))
                {
                    Some(r) => map.parts.push(RawGqlPart {
                        root: root.to_string(),
                        map: r,
                        line,
                    }),
                    None => map.unlisted.push(line),
                }
            }
            e @ (Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::CallExpression(_)) => {
                let inner = inner_name("part", e.span().start);
                match self.map_of(&inner, e, true) {
                    Some(m) => {
                        map.parts.push(RawGqlPart {
                            root: root.to_string(),
                            map: local(inner),
                            line,
                        });
                        self.found.maps.push(m);
                    }
                    None => map.unlisted.push(line),
                }
            }
            _ => map.unlisted.push(line),
        }
    }

    /// The properties of a resolver map: its root types' fields, and what it
    /// spreads. Other types' fields resolve a field of a value, not an operation.
    fn map_object(&mut self, map: &mut RawGqlMap, o: &ObjectExpression<'a>) {
        for p in &o.properties {
            let line = self.l.line_of(p.span().start);
            match p {
                ObjectPropertyKind::SpreadProperty(s) => self.part(map, "", &s.argument, line),
                ObjectPropertyKind::ObjectProperty(p) if p.computed => map.unlisted.push(line),
                ObjectPropertyKind::ObjectProperty(p) => {
                    let Some(root) = key_name(&p.key).filter(|k| root_label(k).is_some()) else {
                        continue;
                    };
                    match unwrap_expr(&p.value) {
                        Expression::ObjectExpression(fields) => {
                            self.root_fields(map, &root, fields, 0);
                        }
                        // `Query: queries` of a top-level object of the file.
                        Expression::Identifier(id) => match self.top_object(id.name.as_str()) {
                            Some(fields) => self.root_fields(map, &root, fields, 1),
                            None => map.unlisted.push(line),
                        },
                        // `Query: users.Query`: that map's fields of the root.
                        Expression::StaticMemberExpression(m)
                            if m.property.name == root.as_str() =>
                        {
                            self.part(map, &root, &m.object, line);
                        }
                        _ => map.unlisted.push(line),
                    }
                }
            }
        }
    }

    /// The fields of `root` an object holds, each an entry; what it spreads is
    /// taken in for that root only.
    fn root_fields(
        &mut self,
        map: &mut RawGqlMap,
        root: &str,
        fields: &ObjectExpression<'a>,
        depth: u32,
    ) {
        for p in &fields.properties {
            let line = self.l.line_of(p.span().start);
            match p {
                ObjectPropertyKind::SpreadProperty(s) => match unwrap_expr(&s.argument) {
                    // `...users.Query`: the fields `users` has for the root.
                    Expression::StaticMemberExpression(m) if m.property.name == root => {
                        self.part(map, root, &m.object, line);
                    }
                    // `...queries` of a top-level object of the file.
                    Expression::Identifier(id) if depth < 2 => {
                        match self.top_object(id.name.as_str()) {
                            Some(o) => self.root_fields(map, root, o, depth + 1),
                            None => map.unlisted.push(line),
                        }
                    }
                    _ => map.unlisted.push(line),
                },
                ObjectPropertyKind::ObjectProperty(p) => {
                    let Some(field) = key_name(&p.key).filter(|_| !p.computed) else {
                        map.unlisted.push(line);
                        continue;
                    };
                    let name = self.name(root, &field);
                    let (symbol, entry) = self.l.gql_entry(root, &field, &p.value, 1, name, line);
                    map.entries.push(RawGqlEntry {
                        root: root.to_string(),
                        field,
                        symbol,
                        entry,
                    });
                }
            }
        }
    }

    /// A `graphql-shield` rule map: `shield({ Query: { me: rule } }, { fallbackRule })`.
    fn shield(&self, name: &str, init: &Expression) -> Option<RawShield> {
        let Expression::CallExpression(c) = unwrap_expr(init) else {
            return None;
        };
        if !self.l.gql_is(&c.callee, &[("graphql-shield", "shield")]) {
            return None;
        }
        let mut shield = RawShield {
            name: name.to_string(),
            rules: Vec::new(),
            fallback: Vec::new(),
            unread: false,
        };
        match c
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr)
        {
            Some(Expression::ObjectExpression(o)) => {
                for p in &o.properties {
                    let ObjectPropertyKind::ObjectProperty(p) = p else {
                        shield.unread = true;
                        continue;
                    };
                    let Some(root) = key_name(&p.key).filter(|_| !p.computed) else {
                        shield.unread = true;
                        continue;
                    };
                    match unwrap_expr(&p.value) {
                        Expression::ObjectExpression(fields) => {
                            for f in &fields.properties {
                                match f {
                                    ObjectPropertyKind::ObjectProperty(f) if !f.computed => {
                                        if let Some(field) = key_name(&f.key) {
                                            shield.rules.push((
                                                format!("{root}.{field}"),
                                                self.rules(&f.value),
                                            ));
                                        }
                                    }
                                    _ => shield.unread = true,
                                }
                            }
                        }
                        // A rule for every field of the type.
                        v => shield.rules.push((format!("{root}.*"), self.rules(v))),
                    }
                }
            }
            _ => shield.unread = true,
        }
        if let Some(Expression::ObjectExpression(o)) = c
            .arguments
            .get(1)
            .and_then(|a| a.as_expression())
            .map(unwrap_expr)
            && let Some(f) = routes::object_prop(o, "fallbackRule")
        {
            shield.fallback = self.rules(f);
        }
        Some(shield)
    }

    /// The rules a shield value names: a rule, or each rule `and(a, b)` /
    /// `or(a, b)` / `chain(a, b)` combines (with the combinator itself).
    fn rules(&self, e: &Expression) -> Vec<RawRef> {
        let mut out = Vec::new();
        let mut stack = vec![unwrap_expr(e)];
        while let Some(x) = stack.pop() {
            if let Expression::CallExpression(c) = x {
                out.extend(self.l.canon(&c.callee));
                stack.extend(
                    c.arguments
                        .iter()
                        .filter_map(|a| a.as_expression())
                        .map(unwrap_expr),
                );
            } else {
                out.extend(self.l.canon(x));
            }
        }
        out.retain(|r| !matches!(r.base, RawBase::Global(_)));
        out
    }

    /// What a serving call is given, recorded as served.
    fn serve(&mut self, given: &Expression<'a>, line: u32, unread: &[String]) {
        let r = match unwrap_expr(given) {
            e @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => self
                .l
                .canon(e)
                .filter(|r| !matches!(r.base, RawBase::Global(_))),
            e => {
                let name = inner_name("resolvers", e.span().start);
                self.map_of(&name, e, true).map(|m| {
                    self.found.maps.push(m);
                    local(name)
                })
            }
        };
        match r {
            Some(map) => self.found.served.push(RawServed {
                map,
                line,
                unread: unread.to_vec(),
            }),
            None => self.serve_unread(line),
        }
    }

    /// Something is served there and not read: its operations are not listed,
    /// and the unlisted-routes report says so.
    fn serve_unread(&mut self, line: u32) {
        let name = format!("(unread {line})");
        let mut map = empty_map(&name);
        map.unlisted.push(line);
        self.found.maps.push(map);
        self.found.served.push(RawServed {
            map: local(name),
            line,
            unread: Vec::new(),
        });
    }

    /// What a server's options run before every operation and Drift does not read:
    /// a `context` function that may refuse (one written in place with no `throw`
    /// only builds the context), a plugin of another package than the server's.
    fn server_unread(&self, o: &ObjectExpression) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(ctx) = routes::object_prop(o, "context") {
            let builds_only = match unwrap_expr(ctx) {
                Expression::ArrowFunctionExpression(a) => !Throws::in_arrow(a),
                Expression::FunctionExpression(f) => !Throws::in_function(f),
                Expression::ObjectExpression(_) => true,
                _ => false,
            };
            if !builds_only {
                out.push("the GraphQL server's context function".to_string());
            }
        }
        if let Some(Expression::ArrayExpression(a)) =
            routes::object_prop(o, "plugins").map(unwrap_expr)
        {
            let serving = |x: &Expression| match unwrap_expr(x) {
                Expression::CallExpression(c) => matches!(self.l.gql_export(&c.callee),
                    Some((spec, _)) if SERVING_PLUGIN_PACKAGES
                        .iter()
                        .any(|p| spec == *p || spec.starts_with(&format!("{p}/")))),
                _ => false,
            };
            if !a
                .elements
                .iter()
                .all(|el| el.as_expression().is_some_and(serving))
            {
                out.push("a GraphQL server plugin".to_string());
            }
        }
        out
    }

    /// A serving call: `new ApolloServer({ resolvers })`, `createSchema(...)`,
    /// `createYoga({ schema: createSchema(...) })`.
    fn serving_call(
        &mut self,
        callee: &Expression<'a>,
        args: &oxc_allocator::Vec<'a, Argument<'a>>,
        line: u32,
        outer: &[String],
    ) {
        let first = args
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr);
        if self.l.gql_is(callee, YOGA) {
            if let Some(Expression::ObjectExpression(o)) = first
                && let Some(Expression::CallExpression(s)) =
                    routes::object_prop(o, "schema").map(unwrap_expr)
            {
                let mut unread = outer.to_vec();
                unread.extend(self.server_unread(o));
                self.done.insert(s.span.start);
                self.serving_call(&s.callee, &s.arguments, line, &unread);
            }
            return;
        }
        if !self.l.gql_serves(callee) {
            return;
        }
        let mut unread = outer.to_vec();
        match first {
            Some(Expression::ObjectExpression(o)) => {
                unread.extend(self.server_unread(o));
                if let Some(given) = routes::object_prop(o, "resolvers") {
                    self.serve(given, line, &unread);
                } else if o
                    .properties
                    .iter()
                    .any(|p| matches!(p, ObjectPropertyKind::SpreadProperty(_)))
                {
                    self.serve_unread(line);
                }
            }
            // `buildSubgraphSchema([{ typeDefs, resolvers }])`.
            Some(Expression::ArrayExpression(a)) => {
                for el in &a.elements {
                    match el.as_expression().map(unwrap_expr) {
                        Some(Expression::ObjectExpression(o)) => {
                            if let Some(given) = routes::object_prop(o, "resolvers") {
                                self.serve(given, line, &unread);
                            }
                        }
                        _ => self.serve_unread(line),
                    }
                }
            }
            // Options Drift cannot read: what they serve is not listed.
            Some(_) => self.serve_unread(line),
            None => {}
        }
    }

    /// Pothos: `builder.queryField("me", (t) => t.field({...}))`,
    /// `builder.queryFields((t) => ({ ... }))`, `builder.queryType({ fields })`.
    fn pothos(&mut self, c: &CallExpression<'a>) {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return;
        };
        let (root, shape) = match m.property.name.as_str() {
            "queryField" => ("Query", 0),
            "mutationField" => ("Mutation", 0),
            "subscriptionField" => ("Subscription", 0),
            "queryFields" => ("Query", 1),
            "mutationFields" => ("Mutation", 1),
            "subscriptionFields" => ("Subscription", 1),
            "queryType" => ("Query", 2),
            "mutationType" => ("Mutation", 2),
            "subscriptionType" => ("Subscription", 2),
            _ => return,
        };
        let Some(builder) = self
            .l
            .canon(&m.object)
            .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }))
        else {
            return;
        };
        let line = self.l.line_of(c.span.start);
        let mut map = empty_map(&inner_name("pothos", c.span.start));
        map.builder = Some(builder);
        let arg = |i: usize| {
            c.arguments
                .get(i)
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
        };
        if shape == 0 {
            match (arg(0).and_then(text_of), arg(1)) {
                (Some(field), Some(Expression::ArrowFunctionExpression(a))) => {
                    match arrow_result(a) {
                        Some(v) => self.pothos_field(&mut map, root, &field, v, line),
                        None => map.unlisted.push(line),
                    }
                }
                _ => map.unlisted.push(line),
            }
        } else {
            let fields = if shape == 1 {
                arg(0)
            } else {
                match arg(0) {
                    Some(Expression::ObjectExpression(o)) => {
                        routes::object_prop(o, "fields").map(unwrap_expr)
                    }
                    _ => None,
                }
            };
            let obj = match fields {
                Some(Expression::ArrowFunctionExpression(a)) => arrow_result(a),
                _ => None,
            };
            match obj {
                Some(Expression::ObjectExpression(o)) => {
                    for p in &o.properties {
                        let at = self.l.line_of(p.span().start);
                        match p {
                            ObjectPropertyKind::ObjectProperty(p) if !p.computed => {
                                match key_name(&p.key) {
                                    Some(field) => {
                                        self.pothos_field(&mut map, root, &field, &p.value, at);
                                    }
                                    None => map.unlisted.push(at),
                                }
                            }
                            _ => map.unlisted.push(at),
                        }
                    }
                }
                // `queryType({})` with no fields adds none.
                _ if shape == 2 && fields.is_none() => {}
                _ => map.unlisted.push(line),
            }
        }
        if !map.entries.is_empty() || !map.unlisted.is_empty() {
            self.found.maps.push(map);
        }
    }

    /// One Pothos field: `t.field({ resolve, authScopes })`,
    /// `t.withAuth({...}).prismaField({...})`.
    fn pothos_field(
        &mut self,
        map: &mut RawGqlMap,
        root: &str,
        field: &str,
        v: &Expression<'a>,
        line: u32,
    ) {
        let Expression::CallExpression(c) = unwrap_expr(v) else {
            map.unlisted.push(line);
            return;
        };
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            map.unlisted.push(line);
            return;
        };
        let with_auth = matches!(unwrap_expr(&m.object), Expression::CallExpression(w)
            if matches!(unwrap_expr(&w.callee), Expression::StaticMemberExpression(wm)
                if wm.property.name == "withAuth"));
        let Some(Expression::ObjectExpression(o)) = c
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr)
        else {
            map.unlisted.push(line);
            return;
        };
        let Some(h) = resolver_of(o, root) else {
            map.unlisted.push(line);
            return;
        };
        let args_at = if POTHOS_QUERY_FIRST.contains(&m.property.name.as_str()) {
            2
        } else {
            1
        };
        let name = self.name(root, field);
        let (mut symbol, entry) = self.l.gql_entry(root, field, h, args_at, name, line);
        if with_auth || routes::object_prop(o, "authScopes").is_some() {
            symbol
                .app_unread
                .push(format!("the authScopes of {root}.{field}"));
        }
        map.entries.push(RawGqlEntry {
            root: root.to_string(),
            field: field.to_string(),
            symbol,
            entry,
        });
    }

    /// Nexus: `queryField("me", { resolve })`, `mutationField(...)`,
    /// `subscriptionField(...)`, `extendType({ type: "Query", definition(t) {...} })`,
    /// `objectType({ name: "Query", definition })`, `queryType({ definition })`.
    fn nexus(&mut self, c: &CallExpression<'a>) {
        let Some((spec, export)) = self.l.gql_export(&c.callee) else {
            return;
        };
        if spec != "nexus" && spec != "@nexus/schema" {
            return;
        }
        let arg = |i: usize| {
            c.arguments
                .get(i)
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
        };
        let line = self.l.line_of(c.span.start);
        let single = match export.as_str() {
            "queryField" => Some("Query"),
            "mutationField" => Some("Mutation"),
            "subscriptionField" => Some("Subscription"),
            _ => None,
        };
        if let Some(root) = single {
            match (arg(0), arg(1)) {
                (Some(name), Some(Expression::ObjectExpression(o))) => match text_of(name) {
                    Some(field) => self.nexus_field(root, &field, o, line),
                    None => self.unlisted.push(line),
                },
                // `queryField((t) => { t.field(...) })`.
                (Some(f), None) => self.nexus_definition(root, f, line),
                _ => self.unlisted.push(line),
            }
            return;
        }
        let root = match export.as_str() {
            "queryType" => Some("Query".to_string()),
            "mutationType" => Some("Mutation".to_string()),
            "subscriptionType" => Some("Subscription".to_string()),
            "extendType" | "objectType" => match arg(0) {
                Some(Expression::ObjectExpression(o)) => routes::object_prop(
                    o,
                    if export == "extendType" {
                        "type"
                    } else {
                        "name"
                    },
                )
                .and_then(text_of),
                _ => None,
            },
            _ => None,
        };
        let Some(root) = root.filter(|r| root_label(r).is_some()) else {
            return;
        };
        let Some(Expression::ObjectExpression(o)) = arg(0) else {
            self.unlisted.push(line);
            return;
        };
        match routes::object_prop(o, "definition") {
            Some(d) => self.nexus_definition(&root, d, line),
            None => self.unlisted.push(line),
        }
    }

    /// The fields a Nexus `definition(t)` adds: `t.field("x", {...})`,
    /// `t.nonNull.list.field("x", {...})`, `t.string("x", {...})`.
    fn nexus_definition(&mut self, root: &str, d: &Expression<'a>, line: u32) {
        let (params, statements) = match unwrap_expr(d) {
            Expression::FunctionExpression(f) => {
                (&f.params, f.body.as_ref().map(|b| &b.statements))
            }
            Expression::ArrowFunctionExpression(a) => {
                (&a.params, a.body.as_function_body().map(|b| &b.statements))
            }
            _ => {
                self.unlisted.push(line);
                return;
            }
        };
        let (Some(t), Some(statements)) = (first_param_name(params), statements) else {
            self.unlisted.push(line);
            return;
        };
        for s in statements {
            let Statement::ExpressionStatement(es) = s else {
                continue;
            };
            let Expression::CallExpression(c) = unwrap_expr(&es.expression) else {
                continue;
            };
            let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                continue;
            };
            if !rooted_at(&m.object, t) {
                continue;
            }
            let at = self.l.line_of(c.span.start);
            let arg = |i: usize| {
                c.arguments
                    .get(i)
                    .and_then(|a| a.as_expression())
                    .map(unwrap_expr)
            };
            match (arg(0).and_then(text_of), arg(1)) {
                (Some(field), Some(Expression::ObjectExpression(o))) => {
                    self.nexus_field(root, &field, o, at);
                }
                // A field with no resolver of its own answers from the root value.
                (Some(_), None) => {}
                _ => self.unlisted.push(at),
            }
        }
    }

    fn nexus_field(&mut self, root: &str, field: &str, o: &ObjectExpression<'a>, line: u32) {
        let Some(h) = resolver_of(o, root) else {
            return;
        };
        let name = self.name(root, field);
        let (mut sym, entry) = self.l.gql_entry(root, field, h, 1, name, line);
        if routes::object_prop(o, "authorize").is_some() {
            sym.app_unread
                .push(format!("the authorize of {root}.{field}"));
        }
        self.direct.push((sym, entry));
    }
}

fn empty_map(name: &str) -> RawGqlMap {
    RawGqlMap {
        name: name.to_string(),
        builder: None,
        parts: Vec::new(),
        entries: Vec::new(),
        unlisted: Vec::new(),
    }
}

/// What runs a root field given as options: `subscribe` for a subscription, else
/// `resolve`.
fn resolver_of<'b, 'a>(o: &'b ObjectExpression<'a>, root: &str) -> Option<&'b Expression<'a>> {
    if root == "Subscription" {
        routes::object_prop(o, "subscribe").or_else(|| routes::object_prop(o, "resolve"))
    } else {
        routes::object_prop(o, "resolve")
    }
}

impl<'a> Visit<'a> for GqlFinder<'_, '_, '_, '_, 'a> {
    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        if !self.done.contains(&it.span.start) {
            let line = self.l.line_of(it.span.start);
            self.serving_call(&it.callee, &it.arguments, line, &[]);
        }
        walk::walk_new_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let line = self.l.line_of(it.span.start);
        if !self.done.contains(&it.span.start) {
            self.serving_call(&it.callee, &it.arguments, line, &[]);
        }
        self.pothos(it);
        self.nexus(it);
        if self
            .l
            .gql_is(&it.callee, &[("graphql-middleware", "applyMiddleware")])
        {
            for a in it.arguments.iter().skip(1) {
                match a.as_expression().map(unwrap_expr) {
                    Some(
                        e @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)),
                    ) => {
                        if let Some(r) = self.l.canon(e) {
                            self.found.applied.push(r);
                        }
                    }
                    Some(e) => {
                        let name = inner_name("shield", e.span().start);
                        if let Some(s) = self.shield(&name, e) {
                            self.found.shields.push(s);
                            self.found.applied.push(local(name));
                        }
                    }
                    None => {}
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// A function written in place throws somewhere in its own body.
struct Throws {
    found: bool,
}

impl Throws {
    fn in_arrow(a: &ArrowFunctionExpression) -> bool {
        let mut t = Self { found: false };
        t.visit_arrow_function_body(&a.body);
        t.found
    }

    fn in_function(f: &Function) -> bool {
        let mut t = Self { found: false };
        if let Some(b) = &f.body {
            t.visit_function_body(b);
        }
        t.found
    }
}

impl<'a> Visit<'a> for Throws {
    fn visit_throw_statement(&mut self, _: &ThrowStatement<'a>) {
        self.found = true;
    }
}
