//! GraphQL entry points at lowering time: strawberry, graphene (with
//! graphene-django) and ariadne.
//!
//! In a GraphQL service every resolver of a root field (Query, Mutation,
//! Subscription) is an operation any caller can invoke, served through one HTTP
//! view. This pass records, in a file that imports one of the libraries, what the
//! libraries document a schema is made of ([`RawGraphql`]): the schemas built
//! (`strawberry.Schema(query=Query)`, `graphene.Schema(...)`,
//! `make_executable_schema(type_defs, query)`), the classes and their fields (a
//! method under one of strawberry's field decorators, `strawberry.field(resolver=f)`,
//! graphene's `resolve_<field>`, a mutation class mounted with `.Field()`), the
//! ariadne objects and the resolvers bound to them, and the view a schema is
//! handed to. Which root types a schema has is a matter of other files (the root
//! classes are imported), so the linker ties them ([`crate::link`]).
//!
//! Everything here is keyed on each library's package and its documented API; the
//! names of the methods graphene calls (`resolve_<field>`, `mutate`,
//! `mutate_and_get_payload`, `get_queryset`) are that API. Nothing here is read by
//! mining: the linker lists these entry points in the listed reading only.

use super::*;

/// The library a dotted path is of, by its package.
fn library(dotted: &str) -> Option<&'static str> {
    match dotted.split('.').next()? {
        "strawberry" => Some("strawberry"),
        "graphene" | "graphene_django" => Some("graphene"),
        "ariadne" => Some("ariadne"),
        _ => None,
    }
}

/// strawberry's decorators (and functions) that make a field of the type they are
/// in: a method under one is resolved by it; one called with `resolver=` is
/// resolved by the function given.
const STRAWBERRY_FIELDS: &[&str] = &[
    "strawberry.field",
    "strawberry.mutation",
    "strawberry.subscription",
    "strawberry.federation.field",
    "strawberry.federation.mutation",
];

/// The classes that build a schema from its root types, by library.
const SCHEMAS: &[(&str, &str)] = &[
    ("strawberry.Schema", "strawberry"),
    ("strawberry.schema.Schema", "strawberry"),
    ("strawberry.federation.Schema", "strawberry"),
    ("graphene.Schema", "graphene"),
    ("graphene.types.schema.Schema", "graphene"),
    ("ariadne.make_executable_schema", "ariadne"),
    (
        "ariadne.executable_schema.make_executable_schema",
        "ariadne",
    ),
];

/// strawberry's function that merges types into one (`merge_types("Query", (A, B))`).
const MERGE_TYPES: &str = "strawberry.tools.merge_types";
/// strawberry's extension that runs permission classes before a field resolves.
const PERMISSION_EXTENSION: &str = "strawberry.permission.PermissionExtension";

/// The roots a schema takes, by position and keyword (strawberry's and graphene's
/// `Schema(query, mutation, subscription)`).
const ROOTS: &[(usize, &str, &str)] = &[
    (0, "query", "QUERY"),
    (1, "mutation", "MUTATION"),
    (2, "subscription", "SUBSCRIPTION"),
];

/// The keywords of `graphene.Field(...)` that are options of the field; every other
/// keyword is an argument of it.
const FIELD_OPTIONS: &[&str] = &[
    "args",
    "resolver",
    "source",
    "deprecation_reason",
    "name",
    "description",
    "required",
    "default_value",
];

/// graphene's wrappers of a type in an argument or a field (`graphene.Argument(T)`,
/// `graphene.List(T)`, `graphene.NonNull(T)`): the type is their first argument.
const TYPE_WRAPPERS: &[&str] = &[
    "graphene.Argument",
    "graphene.List",
    "graphene.NonNull",
    "graphene.Field",
];

/// The methods of a graphene class that graphene calls to resolve a field
/// (`resolve_<field>`, with the field's name after the prefix) or a mutation
/// (`mutate`; `mutate_and_get_payload` of a relay `ClientIDMutation`), and what a
/// graphene-django node type's connection runs to read its rows (`get_queryset`).
fn graphene_method(name: &str) -> bool {
    name.starts_with("resolve_")
        || matches!(name, "mutate" | "mutate_and_get_payload" | "get_queryset")
}

/// ariadne's bindables of the root types, by their class's name, and the type each
/// binds. `ObjectType("Query")` binds the type it is given.
fn ariadne_root(class: &str) -> Option<&'static str> {
    match class {
        "QueryType" => Some("Query"),
        "MutationType" => Some("Mutation"),
        "SubscriptionType" => Some("Subscription"),
        _ => None,
    }
}

/// The root type names of a GraphQL schema (the spec's defaults).
const ROOT_TYPES: &[&str] = &["Query", "Mutation", "Subscription"];

/// Every call in the module, wherever it is, by address of the statement that holds
/// it for the module-level ones.
struct Calls<'a> {
    calls: Vec<&'a ast::ExprCall>,
}

impl<'a> Visitor<'a> for Calls<'a> {
    fn visit_expr(&mut self, e: &'a Expr) {
        if let Expr::Call(c) = e {
            self.calls.push(c);
        }
        visitor::walk_expr(self, e);
    }
}

impl<'t> Lowerer<'t> {
    /// Records what the module says of GraphQL ([`RawGraphql`]), where it imports one
    /// of the libraries. ariadne resolvers are bound where the bindable is imported
    /// from another module of the repository (`from app.bindables import query`), with
    /// no import of ariadne: the binds are recorded in every module, and the link
    /// keeps those whose bindable is one of ariadne's.
    pub(crate) fn lower_graphql(&mut self, body: &'t [Stmt]) {
        let imports = self.out.imports.iter().any(|i| library(&i.spec).is_some());
        // Module-level statements, also under `if` and `try`.
        let mut top: Vec<&'t Stmt> = Vec::new();
        fn flatten<'s>(body: &'s [Stmt], out: &mut Vec<&'s Stmt>) {
            for s in body {
                match s {
                    Stmt::If(i) => {
                        flatten(&i.body, out);
                        for c in &i.elif_else_clauses {
                            flatten(&c.body, out);
                        }
                    }
                    Stmt::Try(t) => {
                        flatten(&t.body, out);
                        flatten(&t.orelse, out);
                    }
                    other => out.push(other),
                }
            }
        }
        flatten(body, &mut top);
        // The module-level name each call is bound to (`schema = Schema(...)`).
        let mut bound: HashMap<usize, String> = HashMap::new();
        for &s in &top {
            let (target, value) = match s {
                Stmt::Assign(a) if a.targets.len() == 1 => (&a.targets[0], a.value.as_ref()),
                Stmt::AnnAssign(a) => match &a.value {
                    Some(v) => (a.target.as_ref(), v.as_ref()),
                    None => continue,
                },
                _ => continue,
            };
            if let (Expr::Name(n), Expr::Call(c)) = (target, value) {
                bound.insert(c as *const ast::ExprCall as usize, n.id.to_string());
            }
        }
        let mut g = RawGraphql::default();
        for &s in &top {
            match s {
                Stmt::ClassDef(c) if imports => self.gql_class(c, &mut g),
                Stmt::FunctionDef(f) => self.gql_binds(f, &mut g),
                Stmt::Expr(e) => {
                    // `query.set_field("user", resolve_user)`, a subscription's
                    // `set_source("count", count_source)`.
                    if let Expr::Call(c) = e.value.as_ref()
                        && let Expr::Attribute(a) = c.func.as_ref()
                        && matches!(a.attr.as_str(), "set_field" | "set_source")
                        && matches!(a.value.as_ref(), Expr::Name(_) | Expr::Attribute(_))
                        && let (Some(field), Some(f)) = (
                            c.arguments.args.first().and_then(string_value),
                            c.arguments.args.get(1),
                        )
                        && matches!(f, Expr::Name(_) | Expr::Attribute(_))
                        && let (Some(bindable), Some(resolver)) =
                            (self.canon(&a.value), self.canon(f))
                    {
                        g.binds.push(RawGqlBind {
                            bindable,
                            field,
                            resolver,
                            line: self.line(c),
                            unwraps: vec![],
                        });
                    }
                }
                _ => {}
            }
            // `query = QueryType()`, `mutation = ObjectType("Mutation")`, and
            // `Query = merge_types("Query", (A, B))`.
            if imports
                && let Stmt::Assign(a) = s
                && let [Expr::Name(n)] = a.targets.as_slice()
                && let Expr::Call(c) = a.value.as_ref()
                && let Some(d) = self.dotted_of(&c.func)
            {
                let class = d.rsplit('.').next().unwrap_or_default();
                if library(&d) == Some("ariadne") {
                    let type_name = match ariadne_root(class) {
                        Some(t) => Some(t.to_string()),
                        None if class == "ObjectType" => c
                            .arguments
                            .args
                            .first()
                            .and_then(string_value)
                            .filter(|t| ROOT_TYPES.contains(&t.as_str())),
                        None => None,
                    };
                    if let Some(type_name) = type_name {
                        g.bindables.push(RawGqlBindable {
                            name: n.id.to_string(),
                            type_name,
                            line: self.line(c),
                        });
                    }
                } else if d == MERGE_TYPES
                    && let Some(RawGqlRoot::Merged(_, bases)) = self.merged(c, &mut Vec::new())
                {
                    g.types.push(RawGqlType {
                        name: n.id.to_string(),
                        line: self.line(c),
                        bases,
                        fields: vec![],
                        methods: vec![],
                        args: vec![],
                    });
                }
            }
        }
        // Schemas and the views they are handed to, wherever they are built.
        let mut calls = Calls { calls: Vec::new() };
        if imports {
            for s in body {
                calls.visit_stmt(s);
            }
        }
        for c in calls.calls {
            if let Expr::Attribute(a) = c.func.as_ref()
                && a.attr.as_str() == "as_view"
                && let Some(s) = keyword(c, "schema")
                && matches!(s, Expr::Name(_) | Expr::Attribute(_))
                && let (Some(view), Some(schema)) = (self.canon(&a.value), self.canon(s))
            {
                g.served.push(RawGqlServed { view, schema });
            }
            let Some(d) = self.dotted_of(&c.func) else {
                continue;
            };
            let Some((_, lib)) = SCHEMAS.iter().find(|(s, _)| *s == d) else {
                continue;
            };
            let name = bound.get(&(c as *const ast::ExprCall as usize)).cloned();
            g.schemas.push(self.gql_schema(c, lib, name));
        }
        g.binds.sort();
        g.binds.dedup();
        g.schemas.sort();
        g.schemas.dedup();
        g.types.sort();
        g.bindables.sort();
        g.served.sort();
        g.served.dedup();
        g.methods.sort();
        self.out.graphql = g;
    }

    /// A schema built by `c`, a call of `library`'s.
    fn gql_schema(&self, c: &ast::ExprCall, library: &str, name: Option<String>) -> RawGqlSchema {
        let mut s = RawGqlSchema {
            library: library.to_string(),
            line: self.line(c),
            name,
            roots: vec![],
            bindables: vec![],
            unread: vec![],
        };
        if c.arguments.keywords.iter().any(|k| k.arg.is_none()) {
            s.unread.push("**kwargs".into());
        }
        if library == "ariadne" {
            // `make_executable_schema(type_defs, *bindables)`: a bindable, or a list
            // of them.
            for a in c.arguments.args.iter().skip(1) {
                let items: Vec<&Expr> = match elements(a) {
                    Some(els) => els.iter().collect(),
                    None => vec![a],
                };
                for x in items {
                    match x {
                        Expr::Name(_) | Expr::Attribute(_) => match self.canon(x) {
                            Some(r) => s.bindables.push(r),
                            None => s.unread.push(practice::words(x)),
                        },
                        // A bindable built in place (`ObjectType("User")`) binds no
                        // resolver Drift reads; anything else is not read.
                        Expr::Call(_) => {}
                        other => s.unread.push(practice::words(other)),
                    }
                }
            }
            return s;
        }
        if c.arguments.args.iter().any(|a| a.is_starred_expr()) {
            s.unread.push("*args".into());
        }
        for (i, kw, op) in ROOTS {
            let Some(e) = arg(c, *i, kw) else { continue };
            match e {
                Expr::NoneLiteral(_) => {}
                Expr::Name(_) | Expr::Attribute(_) => match self.canon(e) {
                    Some(r) => s.roots.push((op.to_string(), RawGqlRoot::Ref(r))),
                    None => s.unread.push(format!("{kw}={}", practice::words(e))),
                },
                Expr::Call(m) if self.dotted_of(&m.func).as_deref() == Some(MERGE_TYPES) => {
                    let mut unread = Vec::new();
                    match self.merged(m, &mut unread) {
                        Some(root) => s.roots.push((op.to_string(), root)),
                        None => s.unread.push(format!("{kw}={}", practice::words(e))),
                    }
                    s.unread.extend(unread);
                }
                other => s.unread.push(format!("{kw}={}", practice::words(other))),
            }
        }
        s
    }

    /// `merge_types("Query", (A, B))`: the name and the classes merged; a class that
    /// is no name is said in `unread`.
    fn merged(&self, c: &ast::ExprCall, unread: &mut Vec<String>) -> Option<RawGqlRoot> {
        let name = arg(c, 0, "name").and_then(string_value)?;
        let types = elements(arg(c, 1, "types")?)?;
        let mut refs = Vec::new();
        for t in types {
            match t {
                Expr::Name(_) | Expr::Attribute(_) => match self.canon(t) {
                    Some(r) => refs.push(r),
                    None => unread.push(practice::words(t)),
                },
                other => unread.push(practice::words(other)),
            }
        }
        Some(RawGqlRoot::Merged(name, refs))
    }

    /// A class of the module: its fields, and the methods that may resolve one as
    /// symbols ([`RawGraphql::methods`]).
    fn gql_class(&mut self, c: &'t ast::StmtClassDef, g: &mut RawGraphql) {
        let name = c.name.as_str();
        let bases: Vec<RawRef> = c
            .arguments
            .as_ref()
            .map(|a| {
                a.args
                    .iter()
                    .filter_map(|b| match b {
                        Expr::Subscript(s) => self.canon(&s.value),
                        other => self.canon(other),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut t = RawGqlType {
            name: name.to_string(),
            line: self.line(c),
            bases,
            fields: vec![],
            methods: vec![],
            args: vec![],
        };
        let mut methods: Vec<(&'t ast::StmtFunctionDef, Option<usize>)> = Vec::new();
        for stmt in &c.body {
            match stmt {
                Stmt::FunctionDef(f) => {
                    // The decorator that makes it a field of strawberry's: those
                    // below it wrap the resolver; it, and those above, wrap the field
                    // object strawberry hands back.
                    let field = f.decorator_list.iter().enumerate().find_map(|(i, d)| {
                        let (func, call) = match &d.expression {
                            Expr::Call(dc) => (dc.func.as_ref(), Some(dc)),
                            e => (e, None),
                        };
                        let d = self.dotted_of(func)?;
                        STRAWBERRY_FIELDS.contains(&d.as_str()).then_some((i, call))
                    });
                    match field {
                        Some((i, call)) => {
                            let mut field = RawGqlField {
                                name: f.name.to_string(),
                                line: self.line(f),
                                resolver: RawGqlResolver::Method(f.name.to_string()),
                                permissions: vec![],
                                unread: vec![],
                                args: vec![],
                            };
                            if let Some(call) = call {
                                self.gql_permissions(call, &mut field);
                            }
                            t.fields.push(field);
                            methods.push((f, Some(i)));
                        }
                        None if graphene_method(f.name.as_str()) => methods.push((f, None)),
                        None => {}
                    }
                }
                Stmt::Assign(a) => {
                    if let [Expr::Name(n)] = a.targets.as_slice() {
                        self.gql_attribute(n.id.as_str(), &a.value, self.line(a), &mut t);
                    }
                }
                Stmt::AnnAssign(a) => {
                    if let (Expr::Name(n), Some(v)) = (a.target.as_ref(), &a.value) {
                        self.gql_attribute(n.id.as_str(), v, self.line(a), &mut t);
                    }
                }
                // graphene: what a mutation takes (`class Arguments`, a relay
                // mutation's `class Input`).
                Stmt::ClassDef(inner) if matches!(inner.name.as_str(), "Arguments" | "Input") => {
                    for s in &inner.body {
                        let value = match s {
                            Stmt::Assign(a) => a.value.as_ref(),
                            Stmt::AnnAssign(a) => match &a.value {
                                Some(v) => v.as_ref(),
                                None => continue,
                            },
                            _ => continue,
                        };
                        if let Some(r) = self.type_of(value) {
                            t.args.push(r);
                        }
                    }
                }
                _ => {}
            }
        }
        // The methods, lowered as a method of a view is: what their bodies call and
        // reach, the inputs their parameters declare, and the decorators that wrap
        // them (not `staticmethod` / `classmethod`, which are how Python binds them).
        self.self_class = Some(name.to_string());
        self.self_bases = t.bases.clone();
        self.self_methods = c
            .body
            .iter()
            .filter_map(|st| match st {
                Stmt::FunctionDef(f) => Some(f.name.to_string()),
                _ => None,
            })
            .collect();
        for (f, field) in methods {
            let m = f.name.as_str();
            let mut ms =
                RawSymbol::empty(&format!("{name}.{m}"), SymbolKind::Function, self.line(f));
            ms.is_async = f.is_async;
            if f.returns.is_some() {
                ms.controls.push("typed_return".into());
            }
            // What lowering a decorator records of the file (a route, a
            // registration) is the class's own lowering's, made already.
            let kept = std::mem::take(&mut self.out);
            for (i, d) in f.decorator_list.iter().enumerate() {
                if field.is_some_and(|at| i <= at) {
                    continue;
                }
                let func = match &d.expression {
                    Expr::Call(dc) => dc.func.as_ref(),
                    e => e,
                };
                if let Some(RawRef {
                    base: RawBase::Global(b),
                    member,
                }) = self.canon(func)
                    && member.is_empty()
                    && matches!(b.as_str(), "staticmethod" | "classmethod")
                {
                    continue;
                }
                self.lower_decorator(&ms.name.clone(), d, i as u32, &mut ms);
            }
            self.out = kept;
            let mut col = Collector::new(self, false);
            col.function(&f.parameters, &f.body, f.returns.as_deref());
            col.fill(&mut ms);
            t.methods.push(m.to_string());
            g.methods.push(ms);
        }
        self.self_class = None;
        self.self_methods.clear();
        self.self_bases.clear();
        t.fields.sort();
        t.methods.sort();
        t.args.sort();
        t.args.dedup();
        if !(t.bases.is_empty() && t.fields.is_empty() && t.methods.is_empty()) {
            g.types.push(t);
        }
    }

    /// A class attribute that may be a field: `x: T = strawberry.field(resolver=f)`,
    /// graphene's `user = graphene.Field(User, id=graphene.ID())`,
    /// `create_user = CreateUser.Field()`, `users = DjangoFilterConnectionField(Node)`.
    fn gql_attribute(&self, name: &str, value: &Expr, line: u32, t: &mut RawGqlType) {
        let Expr::Call(c) = value else { return };
        let mut field = RawGqlField {
            name: name.to_string(),
            line,
            resolver: RawGqlResolver::Declared,
            permissions: vec![],
            unread: vec![],
            args: vec![],
        };
        let d = self.dotted_of(&c.func);
        let lib = d.as_deref().and_then(library);
        let resolver = keyword(c, "resolver")
            .filter(|r| matches!(r, Expr::Name(_) | Expr::Attribute(_)))
            .and_then(|r| self.canon(r));
        let named = |r: &RawRef| !matches!(r.base, RawBase::Global(_));
        if d.as_deref().is_some_and(|d| STRAWBERRY_FIELDS.contains(&d)) {
            // A strawberry field with no resolver reads an attribute of the value it
            // is resolved on: no operation of its own.
            let Some(r) = resolver else { return };
            field.resolver = RawGqlResolver::Function(r);
            self.gql_permissions(c, &mut field);
        } else if let Some(r) = resolver {
            field.resolver = RawGqlResolver::Function(r);
            field.args = self.field_args(c);
        } else if lib == Some("graphene") {
            let class = d.as_deref().and_then(|d| d.rsplit('.').next());
            if class.is_some_and(|c| c.ends_with("ConnectionField"))
                && let Some(node) = c.arguments.args.first()
                && matches!(node, Expr::Name(_) | Expr::Attribute(_))
                && let Some(r) = self.canon(node)
            {
                field.resolver = RawGqlResolver::Connection(r);
            }
            field.args = self.field_args(c);
        } else if lib.is_none()
            && let Expr::Attribute(a) = c.func.as_ref()
            && a.attr.as_str() == "Field"
            && let Some(r) = self.canon(&a.value).filter(named)
        {
            // `CreateUser.Field()`: the mutation class mounted.
            field.resolver = RawGqlResolver::Mounted(r);
        } else if self.canon(&c.func).is_some_and(|r| named(&r)) {
            // A field class of the repository or of another package
            // (`PermissionsField(User)`): declared, resolved by a `resolve_<name>`
            // where there is one.
            field.args = self.field_args(c);
        } else {
            return;
        }
        t.fields.push(field);
    }

    /// The types of a graphene field's arguments: its keywords that are no option of
    /// the field.
    fn field_args(&self, c: &ast::ExprCall) -> Vec<RawRef> {
        c.arguments
            .keywords
            .iter()
            .filter(|k| {
                k.arg
                    .as_ref()
                    .is_some_and(|a| !FIELD_OPTIONS.contains(&a.as_str()))
            })
            .filter_map(|k| self.type_of(&k.value))
            .collect()
    }

    /// The type an argument or a field is declared with: `UserInput(required=True)`,
    /// `graphene.Argument(UserInput)`, `graphene.List(graphene.ID)`, a name.
    fn type_of(&self, e: &Expr) -> Option<RawRef> {
        match e {
            Expr::Call(c) => {
                let d = self.dotted_of(&c.func);
                if d.as_deref().is_some_and(|d| TYPE_WRAPPERS.contains(&d)) {
                    return c.arguments.args.first().and_then(|a| self.type_of(a));
                }
                self.canon(&c.func)
            }
            Expr::Name(_) | Expr::Attribute(_) => self.canon(e),
            _ => None,
        }
    }

    /// strawberry's `permission_classes=[...]` and `extensions=[...]` of a field: each
    /// permission class, and each extension that is no `PermissionExtension` (it runs
    /// around the resolver and may refuse); what is not a list of names, by its
    /// words.
    fn gql_permissions(&self, c: &ast::ExprCall, field: &mut RawGqlField) {
        let named = |x: &Expr| -> Option<RawRef> {
            let class = match x {
                Expr::Call(ic) => ic.func.as_ref(),
                other => other,
            };
            matches!(class, Expr::Name(_) | Expr::Attribute(_))
                .then(|| self.canon(class))
                .flatten()
        };
        if let Some(v) = keyword(c, "permission_classes") {
            match elements(v) {
                Some(els) => {
                    for x in els {
                        match named(x) {
                            Some(r) => field.permissions.push(r),
                            None => field.unread.push(practice::words(x)),
                        }
                    }
                }
                None => field
                    .unread
                    .push(format!("permission_classes={}", practice::words(v))),
            }
        }
        let Some(v) = keyword(c, "extensions") else {
            return;
        };
        let Some(els) = elements(v) else {
            field
                .unread
                .push(format!("extensions={}", practice::words(v)));
            return;
        };
        for x in els {
            if let Expr::Call(ec) = x
                && self.dotted_of(&ec.func).as_deref() == Some(PERMISSION_EXTENSION)
            {
                match arg(ec, 0, "permissions").map(|p| (p, elements(p))) {
                    Some((_, Some(perms))) => {
                        for p in perms {
                            match named(p) {
                                Some(r) => field.permissions.push(r),
                                None => field.unread.push(practice::words(p)),
                            }
                        }
                    }
                    Some((p, None)) => field
                        .unread
                        .push(format!("permissions={}", practice::words(p))),
                    None => {}
                }
                continue;
            }
            match named(x) {
                Some(r) => field.permissions.push(r),
                None => field.unread.push(practice::words(x)),
            }
        }
    }

    /// ariadne: the fields a module-level function is bound to by a decorator
    /// (`@query.field("user")`, a subscription's `@subscription.source("count")`).
    fn gql_binds(&self, f: &'t ast::StmtFunctionDef, g: &mut RawGraphql) {
        for (i, d) in f.decorator_list.iter().enumerate() {
            let Expr::Call(dc) = &d.expression else {
                continue;
            };
            let Expr::Attribute(a) = dc.func.as_ref() else {
                continue;
            };
            if !matches!(a.attr.as_str(), "field" | "source")
                || !matches!(a.value.as_ref(), Expr::Name(_) | Expr::Attribute(_))
            {
                continue;
            }
            let (Some(field), Some(bindable)) = (
                dc.arguments.args.first().and_then(string_value),
                self.canon(&a.value),
            ) else {
                continue;
            };
            let unwraps = f.decorator_list[..=i]
                .iter()
                .filter_map(|d| {
                    let func = match &d.expression {
                        Expr::Call(dc) => dc.func.as_ref(),
                        e => e,
                    };
                    self.canon(func)
                })
                .collect();
            g.binds.push(RawGqlBind {
                bindable,
                field,
                resolver: RawRef {
                    base: RawBase::Local(f.name.to_string()),
                    member: String::new(),
                },
                line: self.line(f),
                unwraps,
            });
        }
    }
}
