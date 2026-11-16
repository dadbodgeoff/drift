//! Framework adapters at lowering time: FastAPI, Flask (and flask-restx), Django,
//! Django REST framework, Celery and Dramatiq.
//!
//! Adapters describe *how code runs* (which functions are HTTP routes or jobs,
//! which dependencies, hooks and decorators run before them); they never decide
//! what a team's conventions are. Whether a decorator's receiver really is a
//! router is often only known across files (`from app.api import router`), so
//! decorator routes are recorded as candidates and confirmed by the linker.

use super::*;

#[path = "framework_routes.rs"]
mod framework_routes;

/// Decorator attributes that register a route or task on a receiver.
const HTTP_VERBS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "options", "head", "trace",
];
const ROUTE_ATTRS: &[&str] = &["route", "api_route", "websocket", "task"];
/// Flask hooks that run before every route of their app or blueprint.
const BEFORE_HOOKS: &[&str] = &["before_request", "before_app_request"];

/// Methods of a router or an application that Drift reads, or that do nothing to
/// where its routes are served: a call of one on a name is not the name handed on
/// ([`RawFile::router_uses`]). The list to extend; any other method called on an
/// application makes it one Drift does not fully know ([`drift_core::AppFacts`]).
pub(crate) const READ_METHODS: &[&str] = &[
    // Routes and mounts, read where they are.
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "trace",
    "route",
    "api_route",
    "add_api_route",
    "websocket",
    "websocket_route",
    "add_api_websocket_route",
    "add_url_rule",
    "include_router",
    "register_blueprint",
    "add_namespace",
    "add_resource",
    "namespace",
    "mount",
    "init_app",
    "register",
    // Middleware, read ([`RawMiddleware`]).
    "add_middleware",
    "middleware",
    // Hooks and handlers: they run on a request that is already routed.
    "on_event",
    "add_event_handler",
    "exception_handler",
    "add_exception_handler",
    "errorhandler",
    "register_error_handler",
    "before_request",
    "after_request",
    "teardown_request",
    "teardown_appcontext",
    "before_app_request",
    "after_app_request",
    "context_processor",
    "shell_context_processor",
    "template_filter",
    "url_defaults",
    "url_value_preprocessor",
    // Reading, running and testing it.
    "openapi",
    "url_path_for",
    "run",
    "test_client",
    "app_context",
    "test_request_context",
    "task",
];

/// How a function that may be handed a request or an application uses its first
/// parameter ([`RawSymbol::param_uses`]).
pub(crate) fn param_uses(f: &ast::StmtFunctionDef) -> Option<Vec<String>> {
    let p = &f.parameters;
    let names: Vec<&str> = p
        .posonlyargs
        .iter()
        .chain(&p.args)
        .map(|a| a.parameter.name.as_str())
        .collect();
    let manager = f.decorator_list.iter().any(|d| {
        let e = match &d.expression {
            Expr::Call(c) => c.func.as_ref(),
            e => e,
        };
        match e {
            Expr::Name(n) => n.id.as_str().ends_with("contextmanager"),
            Expr::Attribute(a) => a.attr.as_str().ends_with("contextmanager"),
            _ => false,
        }
    });
    let (first, second) = match names.as_slice() {
        [one] if manager => (*one, None),
        [one, two] if f.is_async => (*one, Some(*two)),
        _ => return None,
    };
    let mut v = ParamUses {
        first,
        second,
        uses: BTreeSet::new(),
        passed: second.is_none(),
    };
    v.visit_body(&f.body);
    v.passed.then(|| v.uses.into_iter().collect())
}

struct ParamUses<'a> {
    first: &'a str,
    second: Option<&'a str>,
    uses: BTreeSet<String>,
    /// The second parameter is called with the first (`await call_next(request)`).
    passed: bool,
}

impl<'a> Visitor<'a> for ParamUses<'a> {
    fn visit_expr(&mut self, e: &'a Expr) {
        match e {
            Expr::Attribute(_) => {
                // The attribute read on the parameter itself, at the root of the chain.
                let mut at = e;
                let mut attr = None;
                while let Expr::Attribute(a) = at {
                    attr = Some(a.attr.as_str());
                    at = a.value.as_ref();
                }
                if matches!(at, Expr::Name(n) if n.id.as_str() == self.first) {
                    self.uses.extend(attr.map(str::to_string));
                    return;
                }
            }
            Expr::Call(c)
                if matches!(c.func.as_ref(), Expr::Name(n) if Some(n.id.as_str()) == self.second)
                    && c.arguments.keywords.is_empty()
                    && matches!(&*c.arguments.args, [Expr::Name(n)] if n.id.as_str() == self.first) =>
            {
                self.passed = true;
                return;
            }
            Expr::Name(n) if n.id.as_str() == self.first => {
                self.uses.insert("<value>".into());
                return;
            }
            _ => {}
        }
        visitor::walk_expr(self, e);
    }
}

/// A name or dotted name as written; `...` for anything else.
fn written(e: &Expr) -> String {
    match e {
        Expr::Name(n) => n.id.to_string(),
        Expr::Attribute(a) => format!("{}.{}", written(&a.value), a.attr),
        Expr::Call(c) => format!("{}(...)", written(&c.func)),
        _ => "...".to_string(),
    }
}
/// How many levels of a class's own helper methods a handler method's calls go
/// through ([`Lowerer::inline_own_helpers`]).
const OWN_HELPER_DEPTH: usize = 2;

/// The methods `f` calls on its first parameter (`self._write(...)`, `cls.build(...)`),
/// outside nested functions, classes and lambdas.
fn own_method_calls(f: &ast::StmtFunctionDef) -> Vec<String> {
    struct Finder<'n> {
        receiver: &'n str,
        out: Vec<String>,
    }
    impl<'a> Visitor<'a> for Finder<'_> {
        fn visit_stmt(&mut self, s: &'a Stmt) {
            if !matches!(s, Stmt::FunctionDef(_) | Stmt::ClassDef(_)) {
                visitor::walk_stmt(self, s);
            }
        }
        fn visit_expr(&mut self, e: &'a Expr) {
            if let Expr::Call(c) = e
                && let Expr::Attribute(a) = c.func.as_ref()
                && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == self.receiver)
                && !self.out.iter().any(|m| m == a.attr.as_str())
            {
                self.out.push(a.attr.as_str().to_string());
            }
            if !matches!(e, Expr::Lambda(_)) {
                visitor::walk_expr(self, e);
            }
        }
    }
    let Some(first) = f
        .parameters
        .posonlyargs
        .iter()
        .chain(&f.parameters.args)
        .next()
    else {
        return vec![];
    };
    let mut finder = Finder {
        receiver: first.parameter.name.as_str(),
        out: vec![],
    };
    for st in &f.body {
        finder.visit_stmt(st);
    }
    finder.out
}

/// Class-based view methods that handle an HTTP method.
const HANDLER_METHODS: &[&str] = &["get", "post", "put", "patch", "delete", "head", "options"];
/// DRF viewset actions and the HTTP method each serves.
const DRF_ACTIONS: &[(&str, &str)] = &[
    ("list", "GET"),
    ("retrieve", "GET"),
    ("create", "POST"),
    ("update", "PUT"),
    ("partial_update", "PATCH"),
    ("destroy", "DELETE"),
];
/// Base-class name endings that mark an in-repo class-based view (`ObjectListView`).
const VIEW_BASE_SUFFIXES: &[&str] = &["View", "ViewSet", "APIView", "Resource"];

const RESTX_APIS: &[&str] = &["flask_restx.Api", "flask_restplus.Api", "flask_restful.Api"];
pub(crate) const DEPENDS: &[&str] = &[
    "fastapi.Depends",
    "fastapi.Security",
    "fastapi.params.Depends",
    "fastapi.params.Security",
    "fastapi.param_functions.Depends",
    "fastapi.param_functions.Security",
];
const DJANGO_PATHS: &[&str] = &[
    "django.urls.path",
    "django.urls.re_path",
    "django.urls.conf.path",
    "django.urls.conf.re_path",
    "django.conf.urls.url",
];
/// django-decorator-include's `decorator_include(decorators, urlconf)`.
const DECORATOR_INCLUDE: &[&str] = &[
    "decorator_include.decorator_include",
    "decorator_include.include",
];
const DJANGO_INCLUDE: &[&str] = &[
    "django.urls.include",
    "django.urls.conf.include",
    "django.conf.urls.include",
];

/// Base classes that make a class an HTTP view, by adapter.
pub(crate) fn view_adapter(base: &str) -> Option<&'static str> {
    if base.starts_with("rest_framework.") {
        let last = base.rsplit('.').next().unwrap_or(base);
        return (last.ends_with("APIView") || last.ends_with("ViewSet")).then_some("drf");
    }
    if base.starts_with("django.views.") || base.starts_with("django.contrib.auth.views.") {
        return Some("django");
    }
    match base {
        "flask.views.MethodView" | "flask.views.View" => Some("flask"),
        "flask_restx.Resource" | "flask_restplus.Resource" | "flask_restful.Resource" => {
            Some("flask_restx")
        }
        _ => None,
    }
}

/// True when a base class is named like a class-based view (`ObjectListView`,
/// `NetBoxModelViewSet`): an in-repo view base whose framework base is elsewhere.
pub(crate) fn is_view_base(b: &RawRef) -> bool {
    let last = b
        .member
        .rsplit('.')
        .next()
        .filter(|m| !m.is_empty())
        .unwrap_or(match &b.base {
            RawBase::Import { name, .. }
            | RawBase::Local(name)
            | RawBase::Global(name)
            | RawBase::Star(name) => name,
        });
    VIEW_BASE_SUFFIXES.iter().any(|s| last.ends_with(s))
}

fn upper_methods(e: Option<&Expr>) -> Vec<String> {
    e.and_then(elements)
        .map(|els| {
            els.iter()
                .filter_map(string_value)
                .map(|m| m.to_ascii_uppercase())
                .collect()
        })
        .unwrap_or_default()
}

// The soft flags of a FastAPI dependency: built with `auto_error=False`,
// `required=False` or `optional=True` it lets a request without credentials through
// (`HTTPBearer(auto_error=False)`, `Authenticator(required=False)`,
// `current_user(optional=True)`).

/// What an argument's value is, as far as a soft flag cares ([`ArgValue`]).
fn arg_value(e: &Expr) -> ArgValue {
    match e {
        Expr::BooleanLiteral(b) if b.value => ArgValue::True,
        Expr::BooleanLiteral(_) => ArgValue::False,
        Expr::StringLiteral(_)
        | Expr::BytesLiteral(_)
        | Expr::FString(_)
        | Expr::NumberLiteral(_)
        | Expr::NoneLiteral(_)
        | Expr::EllipsisLiteral(_)
        | Expr::List(_)
        | Expr::Tuple(_)
        | Expr::Set(_)
        | Expr::Dict(_) => ArgValue::Literal,
        _ => ArgValue::Unknown,
    }
}

/// Whether a soft flag's parameter with this value makes the dependency soft: the
/// soft literal, or a value that is not known.
pub(crate) fn soft_value(param: &str, v: ArgValue) -> bool {
    match param {
        "auto_error" | "required" => matches!(v, ArgValue::False | ArgValue::Unknown),
        "optional" => matches!(v, ArgValue::True | ArgValue::Unknown),
        _ => false,
    }
}

/// The arguments of a call that builds a dependency, for [`SoftArgs`]: a soft keyword
/// ([`soft_value`]) or a `**kwargs` that may hold one, and the
/// positional arguments for the linker to match by parameter name.
pub(crate) fn soft_args(c: &ast::ExprCall) -> SoftArgs {
    let keyword = c.arguments.keywords.iter().any(|k| match &k.arg {
        None => true,
        Some(a) => soft_value(a.as_str(), arg_value(&k.value)),
    });
    let starred = c.arguments.args.iter().any(Expr::is_starred_expr);
    let positional = c.arguments.args.iter().take(16).map(arg_value).collect();
    SoftArgs {
        keyword,
        positional,
        starred,
        shape: args_shape(c),
    }
}

/// The arguments of a call as [`drift_core::controls::SHAPE`] writes them:
/// `(lit,optional=True,**)`; a dict of options written in place is
/// `{key:value;key:value}`. At most 12 are written; more end in `...`, which no
/// reader knows.
pub(crate) fn args_shape(c: &ast::ExprCall) -> String {
    fn literal(e: &Expr) -> bool {
        match e {
            Expr::StringLiteral(_)
            | Expr::BytesLiteral(_)
            | Expr::NumberLiteral(_)
            | Expr::BooleanLiteral(_)
            | Expr::NoneLiteral(_) => true,
            Expr::List(l) => l.elts.iter().all(literal),
            Expr::Tuple(t) => t.elts.iter().all(literal),
            Expr::Set(s) => s.elts.iter().all(literal),
            _ => false,
        }
    }
    fn value(e: &Expr) -> String {
        match e {
            Expr::BooleanLiteral(b) if b.value => "True".into(),
            Expr::BooleanLiteral(_) => "False".into(),
            Expr::NoneLiteral(_) => "None".into(),
            Expr::Starred(_) => "*".into(),
            e if literal(e) => "lit".into(),
            // A dict of options written in place, its keys words
            // (`options={"verify_signature": False}`): `{verify_signature:False}`.
            Expr::Dict(d)
                if !d.items.is_empty()
                    && d.items.len() <= 6
                    && d.items.iter().all(|i| {
                        i.key.as_ref().and_then(string_value).is_some_and(|k| {
                            !k.is_empty()
                                && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                        })
                    }) =>
            {
                let items: Vec<String> = d
                    .items
                    .iter()
                    .map(|i| {
                        let k = i.key.as_ref().and_then(string_value).unwrap_or_default();
                        let v = match &i.value {
                            Expr::Dict(_) => "?".to_string(),
                            v => value(v),
                        };
                        format!("{k}:{v}")
                    })
                    .collect();
                format!("{{{}}}", items.join(";"))
            }
            _ => "?".into(),
        }
    }
    let mut parts: Vec<String> = Vec::new();
    for a in c.arguments.args.iter() {
        parts.push(value(a));
    }
    for k in c.arguments.keywords.iter() {
        match &k.arg {
            Some(name) => parts.push(format!("{}={}", name.as_str(), value(&k.value))),
            None => parts.push("**".to_string()),
        }
    }
    if parts.len() > 12 {
        parts.truncate(12);
        parts.push("...".to_string());
    }
    format!("({})", parts.join(","))
}

/// The positional parameters of a function, or of a method without `self`.
pub(crate) fn positional_params(params: &ast::Parameters, method: bool) -> RawParams {
    RawParams::Own {
        names: params
            .posonlyargs
            .iter()
            .chain(&params.args)
            .skip(usize::from(method))
            .map(|p| p.parameter.name.as_str().to_string())
            .collect(),
        varargs: params.vararg.is_some(),
    }
}

/// `^api/(?P<pk>\d+)/$` -> `api/(?P<pk>\d+)/`
fn strip_regex_anchors(s: &str) -> String {
    s.trim_start_matches('^').trim_end_matches('$').to_string()
}

impl<'t> Lowerer<'t> {
    pub(crate) fn dotted_of(&self, e: &Expr) -> Option<String> {
        self.canon(e).as_ref().and_then(dotted)
    }

    /// Classes in a DRF `[IsAuthenticated, HasScope(...)]` list (a call names its class).
    /// Why `e`, written where DRF takes a list of permission classes, is not one
    /// Drift reads, in the code's words: not a list, tuple or set written in place
    /// (`BASE + (IsAdminUser,)`, a name), or one with an element that is no class by
    /// name (`IsAuthenticated | IsStaff`, `*BASE`). None for a list of names or of
    /// calls of names, and for nothing written.
    pub(crate) fn classes_unread(&self, e: Option<&Expr>) -> Option<String> {
        let e = e?;
        let read = elements(e).is_some_and(|els| {
            els.iter().all(|x| {
                let class = match x {
                    Expr::Call(ic) => ic.func.as_ref(),
                    other => other,
                };
                matches!(class, Expr::Name(_) | Expr::Attribute(_)) && self.canon(class).is_some()
            })
        });
        (!read).then(|| format!("permission_classes = {}", crate::lower::practice::words(e)))
    }

    /// What a view's `get_permissions` returns, case by case
    /// ([`RawSymbol::drf_permission_cases`]), where its body is nothing but tests
    /// of the request's method or the view's action, each answered by a list of
    /// classes: `if self.request.method in SAFE_METHODS: return [A()]` then `return
    /// [B()]`; or a name bound to a list in each branch and returned instantiated
    /// (`permission_classes = [A]` ... `return [p() for p in permission_classes]`).
    /// `None` where anything else is written: the permissions are then not read,
    /// as before.
    pub(crate) fn permission_cases(&self, f: &ast::StmtFunctionDef) -> Option<Vec<RawPermCase>> {
        let this = f
            .parameters
            .posonlyargs
            .iter()
            .chain(&f.parameters.args)
            .next()?
            .parameter
            .name
            .as_str();
        // The name a branch binds its classes to: a local, or `self.permission_classes`.
        let bound = |target: &Expr| -> Option<String> {
            match target {
                Expr::Name(n) => Some(n.id.to_string()),
                Expr::Attribute(a)
                    if a.attr.as_str() == "permission_classes"
                        && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == this) =>
                {
                    Some(format!("{this}.permission_classes"))
                }
                _ => None,
            }
        };
        let mut cases: Vec<RawPermCase> = Vec::new();
        // The tests no earlier branch held for.
        let mut rest: Vec<RawPermTest> = Vec::new();
        // The lists a name was bound to, by the tests of each binding.
        // (The name, the cases its bindings make, and what it held before them.)
        type Held = (String, Vec<RawPermCase>, Option<Option<Vec<RawRef>>>);
        let mut held: Option<Held> = None;
        for stmt in super::without_docstring(&f.body) {
            match stmt {
                Stmt::Pass(_) => {}
                Stmt::Assign(a) => {
                    let [target] = a.targets.as_slice() else {
                        return None;
                    };
                    let name = bound(target)?;
                    if held.is_some() {
                        return None;
                    }
                    held = Some((name, Vec::new(), Some(self.permission_list(&a.value)?)));
                }
                Stmt::If(i) => {
                    let branches = std::iter::once((Some(i.test.as_ref()), i.body.as_slice()))
                        .chain(
                            i.elif_else_clauses
                                .iter()
                                .map(|c| (c.test.as_ref(), c.body.as_slice())),
                        );
                    let mut otherwise = false;
                    for (test, body) in branches {
                        let mut tests = rest.clone();
                        match test {
                            Some(t) => {
                                let t = self.permission_test(t, this)?;
                                rest.push(RawPermTest {
                                    holds: !t.holds,
                                    ..t.clone()
                                });
                                tests.push(t);
                            }
                            None => otherwise = true,
                        }
                        match body {
                            [Stmt::Return(r)] if held.as_ref().is_none_or(|h| h.1.is_empty()) => {
                                if held.is_some() {
                                    return None;
                                }
                                cases.push(RawPermCase {
                                    tests,
                                    classes: self.permission_list(r.value.as_deref()?)?,
                                });
                            }
                            [Stmt::Assign(a)] if cases.is_empty() => {
                                let [target] = a.targets.as_slice() else {
                                    return None;
                                };
                                let name = bound(target)?;
                                let h =
                                    held.get_or_insert_with(|| (name.clone(), Vec::new(), None));
                                if h.0 != name {
                                    return None;
                                }
                                h.1.push(RawPermCase {
                                    tests,
                                    classes: self.permission_list(&a.value)?,
                                });
                            }
                            _ => return None,
                        }
                    }
                    if otherwise && held.is_none() {
                        // Every request was answered.
                        return Some(cases);
                    }
                    if otherwise && let Some(h) = &mut held {
                        // No request keeps what the name held before.
                        h.2 = None;
                    }
                }
                Stmt::Return(r) => {
                    let value = r.value.as_deref()?;
                    return match held {
                        None => {
                            cases.push(RawPermCase {
                                tests: rest,
                                classes: self.permission_list(value)?,
                            });
                            Some(cases)
                        }
                        // The name, instantiated: `[p() for p in name]`, or, of
                        // `self.permission_classes`, what the base's own method
                        // makes of it.
                        Some((name, mut bound_cases, default)) => {
                            let of_name = |e: &Expr| bound(e).as_deref() == Some(name.as_str());
                            let instantiated = match value {
                                Expr::ListComp(l) => match l.generators.as_slice() {
                                    [g] if g.ifs.is_empty() => {
                                        of_name(&g.iter)
                                            && matches!(l.elt.as_ref(), Expr::Call(c)
                                                if c.arguments.is_empty()
                                                    && matches!((c.func.as_ref(), &g.target),
                                                        (Expr::Name(x), Expr::Name(t)) if x.id == t.id))
                                    }
                                    _ => false,
                                },
                                _ => {
                                    name.ends_with(".permission_classes")
                                        && self.permission_list(value) == Some(None)
                                }
                            };
                            if !instantiated {
                                return None;
                            }
                            // The requests no branch bound it for keep what it held.
                            match default {
                                Some(classes) => bound_cases.push(RawPermCase {
                                    tests: rest,
                                    classes,
                                }),
                                None if bound_cases.is_empty() => return None,
                                None => {}
                            }
                            Some(bound_cases)
                        }
                    };
                }
                _ => return None,
            }
        }
        None
    }

    /// The classes a `get_permissions` returns in one place: a list of classes or
    /// of calls of them (`[IsAuthenticated(), IsOwner()]`), such a list
    /// instantiated in a comprehension, or `super().get_permissions()` (`None`:
    /// the view's `permission_classes`).
    fn permission_list(&self, e: &Expr) -> Option<Option<Vec<RawRef>>> {
        if let Expr::Call(c) = e
            && c.arguments.is_empty()
            && let Expr::Attribute(a) = c.func.as_ref()
            && a.attr.as_str() == "get_permissions"
            && matches!(a.value.as_ref(), Expr::Call(s)
                if matches!(s.func.as_ref(), Expr::Name(n) if n.id.as_str() == "super"))
        {
            return Some(None);
        }
        let listed = match e {
            Expr::ListComp(l) => match l.generators.as_slice() {
                [g] if g.ifs.is_empty() => elements(&g.iter)?,
                _ => return None,
            },
            other => elements(other)?,
        };
        listed
            .iter()
            .map(|x| {
                let class = match x {
                    Expr::Call(c) if c.arguments.is_empty() => c.func.as_ref(),
                    Expr::Call(_) => return None,
                    other => other,
                };
                matches!(class, Expr::Name(_) | Expr::Attribute(_))
                    .then(|| self.canon(class))
                    .flatten()
                    .filter(|r| !matches!(r.base, RawBase::Global(_)))
            })
            .collect::<Option<Vec<RawRef>>>()
            .map(Some)
    }

    /// A test `get_permissions` branches on ([`RawPermTest`]): the request's
    /// method or the view's action against a literal, a list of literals, or DRF's
    /// `SAFE_METHODS`; negated, or an `or` of such tests of one of the two.
    fn permission_test(&self, e: &Expr, this: &str) -> Option<RawPermTest> {
        match e {
            Expr::UnaryOp(u) if u.op == ast::UnaryOp::Not => {
                let t = self.permission_test(&u.operand, this)?;
                Some(RawPermTest {
                    holds: !t.holds,
                    ..t
                })
            }
            Expr::BoolOp(b) if b.op == ast::BoolOp::Or => {
                let mut tests = b.values.iter().map(|v| self.permission_test(v, this));
                let mut all = tests.next()??;
                for t in tests {
                    let t = t?;
                    if !all.holds || !t.holds || t.action != all.action {
                        return None;
                    }
                    all.names.extend(t.names);
                }
                Some(all)
            }
            Expr::Compare(c) => {
                let ([op], [left, right]) = (&*c.ops, &*c.operands) else {
                    return None;
                };
                let holds = match op {
                    ast::CmpOp::Eq | ast::CmpOp::In => true,
                    ast::CmpOp::NotEq | ast::CmpOp::NotIn => false,
                    _ => return None,
                };
                // `self.action`, `self.request.method`, `request.method`.
                let action = match left {
                    Expr::Attribute(a)
                        if a.attr.as_str() == "action"
                            && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == this) =>
                    {
                        true
                    }
                    Expr::Attribute(a) if a.attr.as_str() == "method" => match a.value.as_ref() {
                        Expr::Name(n) if n.id.as_str() == "request" => false,
                        Expr::Attribute(r)
                            if r.attr.as_str() == "request"
                                && matches!(r.value.as_ref(), Expr::Name(n) if n.id.as_str() == this) =>
                        {
                            false
                        }
                        _ => return None,
                    },
                    _ => return None,
                };
                let literal = |x: &Expr| match x {
                    Expr::StringLiteral(s) => Some(s.value.to_str().to_string()),
                    _ => None,
                };
                let mut names: Vec<String> = match (op, right) {
                    (ast::CmpOp::Eq | ast::CmpOp::NotEq, r) => vec![literal(r)?],
                    (_, r) if elements(r).is_some() => elements(r)?
                        .iter()
                        .map(literal)
                        .collect::<Option<Vec<String>>>()?,
                    (_, r)
                        if !action
                            && self.dotted_of(r).as_deref()
                                == Some("rest_framework.permissions.SAFE_METHODS") =>
                    {
                        ["GET", "HEAD", "OPTIONS"].map(String::from).to_vec()
                    }
                    _ => return None,
                };
                if !action {
                    for n in &mut names {
                        *n = n.to_ascii_uppercase();
                    }
                }
                Some(RawPermTest {
                    action,
                    names,
                    holds,
                })
            }
            _ => None,
        }
    }

    pub(crate) fn class_list(&self, e: Option<&Expr>) -> Vec<RawRef> {
        e.and_then(elements)
            .map(|els| {
                els.iter()
                    .filter_map(|x| {
                        self.canon(match x {
                            Expr::Call(ic) => ic.func.as_ref(),
                            other => other,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// `Depends(...)` / `Security(...)` from FastAPI.
    pub(crate) fn is_depends_call(&self, e: &Expr) -> bool {
        matches!(e, Expr::Call(c) if self.dotted_of(&c.func).is_some_and(|d| DEPENDS.contains(&d.as_str())))
    }

    /// What `Depends(x)` depends on: `x`, an instance made in place for
    /// `Depends(Limiter(...))` (with how it was built: [`soft_args`]), or the annotated
    /// type for `Depends()`.
    pub(crate) fn depends_target(
        &self,
        call: &ast::ExprCall,
        annotation: Option<&Expr>,
    ) -> Option<RawDep> {
        let written = arg(call, 0, "dependency");
        let target = written.or(annotation)?;
        let unread = || RawDep::Unread(crate::lower::practice::words(target));
        // [STRICT]: what `Depends(...)` is given and cannot be read may be the guard.
        // What the annotation names (`Depends()`) is a type: no dependency when it
        // is none Drift reads.
        match target {
            Expr::Call(c) => match self.canon(&c.func) {
                // A built-in's result (`getattr(deps, "require_admin")`).
                Some(r) if matches!(r.base, RawBase::Global(_)) && written.is_some() => {
                    Some(unread())
                }
                Some(r) => Some(RawDep::Instance(r, soft_args(c))),
                None => written.map(|_| unread()),
            },
            // A generic class (`Depends(Repo[Rule])`): its parameter is a type, which
            // PEP 8 writes in CapWords. Anything else in the brackets is a lookup
            // (`GUARDS[MODE]`, `GUARDS["admin"]`): which function it finds is not read.
            Expr::Subscript(s) => match self.canon(&s.value) {
                Some(r) if type_argument(&s.slice) => Some(RawDep::Direct(r)),
                _ => written.map(|_| unread()),
            },
            e => match self.canon(e) {
                // A name the module does not bind: a parameter of an enclosing
                // function (`Depends(guard)` in `create_app(guard)`), a local.
                Some(r) if matches!(r.base, RawBase::Global(_)) && written.is_some() => {
                    Some(unread())
                }
                Some(r) => Some(RawDep::Direct(r)),
                None => written.map(|_| unread()),
            },
        }
    }

    /// A name that may be a dependency alias or a `Depends(f)` constant.
    pub(crate) fn alias_dep(&self, e: &Expr) -> Option<RawDep> {
        match e {
            Expr::Name(_) | Expr::Attribute(_) => match self.canon(e) {
                Some(r) if !matches!(r.base, RawBase::Global(_)) => Some(RawDep::Alias(r)),
                _ => None,
            },
            _ => None,
        }
    }

    /// `X | None`, `Optional[X]`, `Union[X, None]`, `Annotated[X | None, ...]`, `None`.
    fn is_optional_type(&self, e: &Expr) -> bool {
        match e {
            Expr::NoneLiteral(_) => true,
            Expr::BinOp(b) if matches!(b.op, ast::Operator::BitOr) => {
                self.is_optional_type(&b.left) || self.is_optional_type(&b.right)
            }
            Expr::Subscript(s) => match self.dotted_of(&s.value).as_deref() {
                Some("typing.Optional" | "typing_extensions.Optional") => true,
                Some("typing.Union" | "typing_extensions.Union") => match s.slice.as_ref() {
                    Expr::Tuple(t) => t.elts.iter().any(|x| self.is_optional_type(x)),
                    other => self.is_optional_type(other),
                },
                Some("typing.Annotated" | "typing_extensions.Annotated") => {
                    match s.slice.as_ref() {
                        Expr::Tuple(t) => t.elts.first().is_some_and(|x| self.is_optional_type(x)),
                        _ => false,
                    }
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// Dependencies in `Annotated[T, Depends(f)]` (or `Annotated[T, API_KEY_REQUIRED]`, a
    /// `Depends(f)` constant); a bare name may be an alias, and so may the non-`None` part
    /// of `CurrentUser | None`.
    pub(crate) fn annotation_deps(&self, ann: &Expr) -> Vec<RawDep> {
        match ann {
            Expr::Subscript(s)
                if matches!(
                    self.dotted_of(&s.value).as_deref(),
                    Some("typing.Annotated" | "typing_extensions.Annotated")
                ) =>
            {
                let Expr::Tuple(t) = s.slice.as_ref() else {
                    return vec![];
                };
                let ty = t.elts.first();
                t.elts
                    .iter()
                    .skip(1)
                    .filter_map(|x| match x {
                        Expr::Call(c) if self.is_depends_call(x) => self.depends_target(c, ty),
                        other => self.alias_dep(other),
                    })
                    .collect()
            }
            Expr::Subscript(s)
                if matches!(
                    self.dotted_of(&s.value).as_deref(),
                    Some("typing.Optional" | "typing_extensions.Optional")
                ) =>
            {
                self.annotation_deps(&s.slice)
            }
            Expr::BinOp(b) if matches!(b.op, ast::Operator::BitOr) => {
                let mut out = self.annotation_deps(&b.left);
                out.extend(self.annotation_deps(&b.right));
                out
            }
            Expr::Name(_) | Expr::Attribute(_) => self.alias_dep(ann).into_iter().collect(),
            _ => vec![],
        }
    }

    /// FastAPI dependencies declared by a function's parameters. One whose parameter may
    /// be `None` is [`RawDep::Optional`].
    pub(crate) fn parameter_deps(&self, params: &ast::Parameters) -> Vec<RawDep> {
        let mut out = Vec::new();
        for p in params
            .posonlyargs
            .iter()
            .chain(&params.args)
            .chain(&params.kwonlyargs)
        {
            let ann = p.parameter.annotation();
            let default = p.default.as_deref();
            let optional = ann.is_some_and(|a| self.is_optional_type(a))
                || matches!(default, Some(Expr::NoneLiteral(_)));
            let mut deps = Vec::new();
            match default {
                Some(d @ Expr::Call(c)) if self.is_depends_call(d) => {
                    deps.extend(self.depends_target(c, ann));
                }
                // `_key: str = API_KEY_REQUIRED`, a `Depends(f)` constant.
                Some(d @ (Expr::Name(_) | Expr::Attribute(_))) => {
                    deps.extend(self.alias_dep(d));
                    deps.extend(ann.map(|a| self.annotation_deps(a)).unwrap_or_default());
                }
                _ => deps.extend(ann.map(|a| self.annotation_deps(a)).unwrap_or_default()),
            }
            out.extend(deps.into_iter().map(|d| {
                if optional {
                    RawDep::Optional(Box::new(d))
                } else {
                    d
                }
            }));
        }
        out
    }

    /// `dependencies=[Depends(a), Security(b)]`.
    ///
    /// [STRICT]: a list that is not written here (a name, a concatenation, a call) and
    /// an element that is no dependency Drift reads (a spread, a call that is not
    /// `Depends`) may hold the guard: [`RawDep::Unread`], never nothing.
    fn deps_list(&self, e: Option<&Expr>) -> Vec<RawDep> {
        let Some(e) = e else { return vec![] };
        let unread = |x: &Expr| RawDep::Unread(crate::lower::practice::words(x));
        let Some(els) = elements(e) else {
            return match e {
                Expr::NoneLiteral(_) => vec![],
                _ => vec![unread(e)],
            };
        };
        els.iter()
            .filter_map(|x| match x {
                Expr::Call(c) if self.is_depends_call(x) => self.depends_target(c, None),
                Expr::Name(_) | Expr::Attribute(_) => self.alias_dep(x),
                other => Some(unread(other)),
            })
            .collect()
    }

    /// The dependencies the options spread into a call give it
    /// ([`RawRoute::splat_deps`]).
    fn splat_deps(&self, c: &ast::ExprCall) -> Vec<RawDep> {
        let mut out = Vec::new();
        for k in c.arguments.keywords.iter().filter(|k| k.arg.is_none()) {
            match self.dict_dependencies(&k.value, 0) {
                Some(Some(deps)) => out.extend(deps),
                Some(None) => {}
                None => out.push(RawDep::Unread(format!(
                    "**{}",
                    crate::lower::practice::words(&k.value)
                ))),
            }
        }
        out
    }

    /// What a dict gives for `dependencies`, read in order so that the last key
    /// wins: `Some(None)` where it has no such key, `None` where the dict is not
    /// read (not a dict written in place or a module-level name bound once to
    /// one, a key that is no text, a spread that is not read).
    fn dict_dependencies(&self, e: &Expr, depth: usize) -> Option<Option<Vec<RawDep>>> {
        let d = match e {
            Expr::Dict(d) => d,
            Expr::Name(n) if depth < 4 => self.dicts.get(n.id.as_str()).copied()?,
            _ => return None,
        };
        let mut found = None;
        for item in &d.items {
            match &item.key {
                None => {
                    if let Some(inner) = self.dict_dependencies(&item.value, depth + 1)? {
                        found = Some(inner);
                    }
                }
                Some(k) => {
                    if string_value(k)? == "dependencies" {
                        found = Some(self.deps_list(Some(&item.value)));
                    }
                }
            }
        }
        Some(found)
    }

    /// `CurrentUser = Annotated[User, Depends(get_current_user)]`, and
    /// `API_KEY_REQUIRED = Depends(require_api_key)` (a constant used as a parameter's
    /// default or in another alias).
    pub(crate) fn record_dep_alias(&mut self, name: &str, value: &Expr) {
        // The class an `Annotated[T, ...]` alias annotates: a parameter annotated with
        // the alias is of that class ([`drift_core::Symbol::alias_of`]).
        if let Expr::Subscript(s) = value
            && matches!(
                self.dotted_of(&s.value).as_deref(),
                Some("typing.Annotated" | "typing_extensions.Annotated")
            )
            && let Some(r) = super::type_expr(value).and_then(|t| self.canon(t))
        {
            self.out.alias_types.push((name.to_string(), r));
        }
        let deps: Vec<RawDep> = match value {
            Expr::Call(c) if self.is_depends_call(value) => {
                self.depends_target(c, None).into_iter().collect()
            }
            Expr::Subscript(s)
                if matches!(
                    self.dotted_of(&s.value).as_deref(),
                    Some("typing.Annotated" | "typing_extensions.Annotated")
                ) =>
            {
                let optional = self.is_optional_type(value);
                self.annotation_deps(value)
                    .into_iter()
                    .map(|d| {
                        if optional {
                            RawDep::Optional(Box::new(d))
                        } else {
                            d
                        }
                    })
                    .collect()
            }
            _ => return,
        };
        if !deps.is_empty() {
            self.out.dep_aliases.push((name.to_string(), deps));
        }
    }

    /// A path or prefix as it is written: a string literal as it is; an f-string with
    /// its literal parts and each interpolation as `?` (`f"{BASE}/health"` is
    /// `?/health`: what `BASE` holds, and how many segments, is not read); anything
    /// else (a name, a concatenation, an attribute of settings) is `?`. Never the
    /// path without the part that was not read.
    fn path_value(&self, e: Option<&Expr>) -> Option<String> {
        let e = e?;
        if let Some(s) = string_value(e) {
            return Some(s);
        }
        let Expr::FString(f) = e else {
            return Some(UNKNOWN_PREFIX.to_string());
        };
        let mut out = String::new();
        for part in f.value.iter() {
            match part {
                ast::FStringPartRef::Literal(l) => out.push_str(&l.value),
                ast::FStringPartRef::FString(fs) => {
                    for el in &fs.elements {
                        match el {
                            ast::InterpolatedStringElement::Literal(l) => out.push_str(&l.value),
                            ast::InterpolatedStringElement::Interpolation(_) => {
                                out.push_str(UNKNOWN_PREFIX)
                            }
                        }
                    }
                }
            }
        }
        Some(out)
    }

    /// The prefix a router is built with, under the keyword `name`: as written
    /// ([`Lowerer::path_value`]); `?` when options are spread into the constructor
    /// and none is written (`APIRouter(**OPTIONS)`); none when there is none.
    fn ctor_prefix(&self, c: &ast::ExprCall, name: &str) -> Option<String> {
        match self.path_value(keyword(c, name)) {
            None if spreads(c) => Some(UNKNOWN_PREFIX.to_string()),
            prefix => prefix,
        }
    }

    /// `middleware=[Middleware(SignIn, ...), ...]` as it is given: the classes named,
    /// and whether there is more to it than those (it is no list written in place,
    /// or an element is no `Middleware(<class>, ...)`). What is not read may turn
    /// callers away.
    fn middleware_list(&self, given: Option<&Expr>) -> (Vec<RawRef>, bool) {
        let middleware: Vec<RawRef> = given
            .and_then(elements)
            .map(|els| {
                els.iter()
                    .filter_map(|e| match e {
                        Expr::Call(m)
                            if super::practice::callee_name(&m.func) == Some("Middleware") =>
                        {
                            m.arguments.args.first().and_then(|x| self.canon(x))
                        }
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let unread = given.is_some_and(|g| {
            !g.is_none_literal_expr() && elements(g).is_none_or(|els| els.len() != middleware.len())
        });
        (middleware, unread)
    }

    /// `behind` and, after it, the `middleware=` the call `c` of `what` (`Mount`,
    /// `Route`, `Router`) is given. A list that is not read, and options spread into
    /// the call, are kept as what was not read ([`RawBehind::unread`]).
    fn behind(
        &self,
        behind: &RawBehind,
        c: &ast::ExprCall,
        given: Option<&Expr>,
        what: &str,
    ) -> RawBehind {
        let mut out = behind.clone();
        let (middleware, unread) = self.middleware_list(given);
        out.middleware.extend(middleware);
        if unread {
            out.unread
                .push((format!("`middleware=` of `{what}(...)`"), self.line(c)));
        } else if given.is_none() && spreads(c) {
            out.unread
                .push((format!("options spread into `{what}(...)`"), self.line(c)));
        }
        out
    }

    /// The route table and the middleware of a Starlette application or router built
    /// by the call `c`: `Starlette(debug, routes, middleware)` takes both by
    /// position too, `Router(routes, ..., middleware=)` its table. None for any
    /// other call.
    fn starlette_table<'e>(
        &self,
        c: &'e ast::ExprCall,
    ) -> Option<(Option<&'e Expr>, Option<&'e Expr>)> {
        let callee = self.canon(&c.func).and_then(|r| dotted(&r))?;
        if STARLETTE_APPS.contains(&callee.as_str()) {
            Some((arg(c, 1, "routes"), arg(c, 2, "middleware")))
        } else if STARLETTE_ROUTERS.contains(&callee.as_str()) {
            Some((arg(c, 0, "routes"), keyword(c, "middleware")))
        } else {
            None
        }
    }

    /// The routes of a Starlette route table on the application `app`: each
    /// `Route(path, endpoint, methods=[...])` is the endpoint registered at the path,
    /// and those of a `Mount(path, routes=[...])` under its path, as are those of a
    /// router built in the mount (`Mount(path, app=Router(routes=[...]))`). The
    /// measured build read no route table ([`RawRegistration::unmeasured`]). A table
    /// that is no list written in place or bound to a name of the module, and an
    /// element that is neither (`*more`, a `WebSocketRoute`), list nothing.
    ///
    /// [STRICT] `behind` is the middleware given on the way from the application to
    /// this table: each `Mount(..., middleware=[...])` around it, the router's own
    /// where one is built in a mount, and a `Route(..., middleware=[...])`'s own on
    /// the route. Every route listed carries it ([`RawRegistration::behind`]), and a
    /// `Mount` of an application that is named or wrapped (`app=sub`,
    /// `app=WSGIMiddleware(legacy)`) is kept with where it is and what it is behind
    /// ([`Lowerer::table_mounts`]) for [`Lowerer::lower_app_mounts`].
    fn lower_starlette_routes(
        &mut self,
        app: &RawRef,
        routes: &Expr,
        prefix: &str,
        depth: usize,
        behind: &RawBehind,
    ) {
        if depth > 4 {
            return;
        }
        let els: &[Expr] = match routes {
            Expr::Name(n) => match self.lists.get(n.id.as_str()).copied() {
                Some(els) => els,
                None => return,
            },
            e => match elements(e) {
                Some(els) => els,
                None => return,
            },
        };
        for e in els {
            let Expr::Call(c) = e else { continue };
            match super::practice::callee_name(&c.func) {
                Some("Route") => {
                    let (Some(path), Some(endpoint)) = (
                        self.path_value(arg(c, 0, "path")),
                        arg(c, 1, "endpoint").and_then(|v| self.canon(v)),
                    ) else {
                        continue;
                    };
                    self.out.registrations.push(RawRegistration {
                        target: endpoint,
                        router: Some(app.clone()),
                        adapter: "fastapi".into(),
                        route: format!("{prefix}{path}"),
                        methods: upper_methods(keyword(c, "methods")),
                        guards: vec![],
                        unmeasured: true,
                        candidate: false,
                        behind: self.behind(behind, c, keyword(c, "middleware"), "Route"),
                        shapes: vec![],
                        since_guards: vec![],
                    });
                }
                Some("Mount") => {
                    let Some(path) = self.path_value(arg(c, 0, "path")) else {
                        continue;
                    };
                    let at = format!("{prefix}{path}");
                    let behind = self.behind(behind, c, keyword(c, "middleware"), "Mount");
                    let key = c as *const ast::ExprCall as usize;
                    // Starlette serves `app` where both are given.
                    let mounted = arg(c, 1, "app");
                    let built = match mounted {
                        Some(Expr::Call(b)) => self.starlette_table(b).map(|t| (b, t)),
                        _ => None,
                    };
                    if let Some((built, (inner, given))) = built {
                        // A router built in the mount: its routes are the table's,
                        // behind its own middleware too.
                        let what = super::practice::callee_name(&built.func).unwrap_or("Router");
                        let behind = self.behind(&behind, built, given, what);
                        if let Some(inner) = inner {
                            self.lower_starlette_routes(app, inner, &at, depth + 1, &behind);
                        }
                        self.table_mounts.insert(
                            key,
                            RawTableMount {
                                at: Some((app.clone(), at)),
                                behind: RawBehind::default(),
                                listed: true,
                            },
                        );
                    } else if mounted.is_some() {
                        self.table_mounts.insert(
                            key,
                            RawTableMount {
                                at: Some((app.clone(), at)),
                                behind,
                                listed: false,
                            },
                        );
                    } else if let Some(inner) = arg(c, 2, "routes") {
                        self.lower_starlette_routes(app, inner, &at, depth + 1, &behind);
                    }
                }
                _ => {}
            }
        }
    }

    /// `router = APIRouter(prefix="/items")`, `bp = Blueprint("auth", __name__, url_prefix="/auth")`,
    /// `app = Celery("proj")`, `router = DefaultRouter()`: any module-level instance of a
    /// PascalCase class, decided by the linker (the class may be a subclass or a re-export).
    pub(crate) fn lower_router_def(&mut self, name: &str, value: &Expr) {
        let Expr::Call(c) = value else { return };
        let Some(callee) = self.canon(&c.func) else {
            return;
        };
        let class_like = match c.func.as_ref() {
            Expr::Name(n) => n.id.as_str(),
            Expr::Attribute(a) => a.attr.as_str(),
            _ => "",
        }
        .starts_with(|ch: char| ch.is_ascii_uppercase());
        // Django's application object is made by a function.
        let django_app = dotted(&callee).is_some_and(|d| {
            matches!(
                d.as_str(),
                "django.core.wsgi.get_wsgi_application" | "django.core.asgi.get_asgi_application"
            )
        });
        if !(class_like || django_app) || matches!(callee.base, RawBase::Global(_)) {
            return;
        }
        if dotted(&callee).is_some_and(|d| RESTX_APIS.contains(&d.as_str())) {
            // `Api(blueprint)`: an API object mounted on its app or blueprint.
            if let Some(parent) = arg(c, 0, "app").and_then(|p| {
                self.read_targets.insert(p as *const Expr as usize);
                self.canon(p)
            }) {
                self.out.mounts.push(RawMount {
                    parent: Some(parent),
                    target: MountTarget::Ref(RawRef {
                        base: RawBase::Local(name.to_string()),
                        member: String::new(),
                    }),
                    prefix: Some(
                        keyword(c, "prefix")
                            .and_then(string_value)
                            .unwrap_or_default(),
                    ),
                    deps: vec![],
                    opaque: false,
                    whole_app: false,
                    unmeasured: false,
                    table: None,
                });
            }
        }
        // A Starlette application's or router's route table, written in place or
        // bound to a name of the module: `Starlette(routes=[Route("/orders", orders)])`.
        let table = self.starlette_table(c);
        if let Some((Some(routes), _)) = table {
            let app = RawRef {
                base: RawBase::Local(name.to_string()),
                member: String::new(),
            };
            self.lower_starlette_routes(&app, routes, "", 0, &RawBehind::default());
        }
        // `middleware=[Middleware(SignIn, ...), ...]`: the classes, where each is one.
        let given = match table {
            Some((_, given)) => given,
            None => keyword(c, "middleware"),
        };
        let (middleware, unread) = self.middleware_list(given);
        let middleware_unread = unread || (given.is_some() && spreads(c));
        self.out.routers.push(RawRouter {
            name: name.to_string(),
            callee,
            prefix: self.ctor_prefix(c, "prefix"),
            url_prefix: self.ctor_prefix(c, "url_prefix"),
            path: self.ctor_prefix(c, "path"),
            first: c.arguments.args.first().and_then(string_value),
            deps: self.deps_list(keyword(c, "dependencies")),
            args: soft_args(c),
            keywords: c
                .arguments
                .keywords
                .iter()
                .map(|k| match &k.arg {
                    Some(name) => name.to_string(),
                    None => format!("**{}", written(&k.value)),
                })
                .chain(c.arguments.args.iter().filter_map(|a| match a {
                    Expr::Starred(s) => Some(format!("*{}", written(&s.value))),
                    _ => None,
                }))
                .collect(),
            lifespan: keyword(c, "lifespan").and_then(|e| self.canon(e)),
            line: self.line(c),
            middleware,
            middleware_unread,
        });
    }

    /// Route handlers defined inside a FastAPI app factory (pilot gap (g)):
    /// `def create_app(): app = FastAPI(); @app.get("/x") def read(): ...`. Each local
    /// `FastAPI()`/`APIRouter()` of the factory is a router named `create_app.app` (the
    /// name its calls in the factory already give it), and each function nested directly
    /// in the factory with a route decorator on one is lowered as a module symbol, so
    /// it is the entry point it is at run time. Only FastAPI; a nested function whose
    /// name a module symbol already has is left out (first definition wins).
    pub(crate) fn lower_factory_routes(&mut self, f: &'t ast::StmtFunctionDef) {
        let factory = f.name.as_str();
        let mut locals: BTreeSet<String> = BTreeSet::new();
        for s in &f.body {
            let Stmt::Assign(a) = s else { continue };
            let [Expr::Name(n)] = a.targets.as_slice() else {
                continue;
            };
            let Expr::Call(c) = a.value.as_ref() else {
                continue;
            };
            let fastapi = self
                .canon(&c.func)
                .and_then(|r| dotted(&r))
                .is_some_and(|d| matches!(d.as_str(), "fastapi.FastAPI" | "fastapi.APIRouter"));
            if fastapi {
                self.lower_router_def(&format!("{factory}.{}", n.id), &a.value);
                locals.insert(n.id.to_string());
            }
        }
        if locals.is_empty() {
            return;
        }
        let routed = |inner: &ast::StmtFunctionDef| {
            inner.decorator_list.iter().any(|d| {
                let Expr::Call(c) = &d.expression else {
                    return false;
                };
                matches!(c.func.as_ref(), Expr::Attribute(a)
                    if matches!(a.value.as_ref(), Expr::Name(n) if locals.contains(n.id.as_str()))
                        && (HTTP_VERBS.contains(&a.attr.as_str()) || a.attr.as_str() == "api_route"))
            })
        };
        let previous = self.factory.replace((factory.to_string(), locals.clone()));
        for s in &f.body {
            let Stmt::FunctionDef(inner) = s else {
                continue;
            };
            if routed(inner) && !self.has_symbol(inner.name.as_str()) {
                let sym = self.lower_function(inner);
                self.push_symbol(sym);
            }
        }
        self.factory = previous;
    }

    /// Decorators that make the symbol an entry point. Returns true when consumed
    /// (the decorator is a registration, not a wrapper of the symbol).
    pub(crate) fn lower_entry_decorator(
        &mut self,
        symbol: &str,
        d: &'t ast::Decorator,
        position: u32,
        sym: &mut RawSymbol,
    ) -> bool {
        let (func, call) = match &d.expression {
            Expr::Call(c) => (c.func.as_ref(), Some(c)),
            e => (e, None),
        };
        let line = self.line(d);
        if let Some(r) = self.canon(func)
            && let Some(dd) = dotted(&r)
        {
            match dd.as_str() {
                "celery.shared_task"
                | "celery.task"
                | "dramatiq.actor"
                | "celery.task.periodic_task"
                | "celery.decorators.periodic_task" => {
                    let adapter = if dd.starts_with("dramatiq") {
                        "dramatiq"
                    } else {
                        "celery"
                    };
                    let given = call
                        .and_then(|c| {
                            keyword(
                                c,
                                if adapter == "dramatiq" {
                                    "actor_name"
                                } else {
                                    "name"
                                },
                            )
                        })
                        .and_then(string_value);
                    // Dramatiq names an actor after its function; Celery's default name is
                    // `module.function`, filled in by the linker (route `None`).
                    let task_name = match adapter {
                        "dramatiq" => Some(given.unwrap_or_else(|| symbol.to_string())),
                        _ => given,
                    };
                    if let Some(c) = call {
                        for k in &c.arguments.keywords {
                            if let Some(a) = &k.arg {
                                sym.args
                                    .push((r.clone(), KWARG_INDEX, a.as_str().to_string()));
                            }
                        }
                    }
                    self.out.entry_points.push(drift_core::EntryPoint {
                        symbol: symbol.to_string(),
                        kind: "job".into(),
                        method: None,
                        route: task_name.clone(),
                        adapter: adapter.into(),
                    });
                    // `@periodic_task(run_every=crontab(...))` (Celery 3) is also scheduled.
                    if dd.ends_with(".periodic_task") {
                        self.out.entry_points.push(drift_core::EntryPoint {
                            symbol: symbol.to_string(),
                            kind: "cron".into(),
                            method: None,
                            route: task_name,
                            adapter: adapter.into(),
                        });
                    }
                    return true;
                }
                "rest_framework.decorators.api_view" => {
                    let methods = upper_methods(call.and_then(|c| arg(c, 0, "http_method_names")));
                    sym.methods = if methods.is_empty() {
                        vec!["GET".into()]
                    } else {
                        methods
                    };
                    sym.view = Some("drf".into());
                    return true;
                }
                "rest_framework.decorators.permission_classes" => {
                    let written = call.and_then(|c| c.arguments.args.first());
                    sym.drf_permissions_unread = self.classes_unread(written);
                    let classes = self.class_list(written);
                    for pr in &classes {
                        sym.wraps.push((pr.clone(), WrapKind::Call));
                    }
                    sym.drf_permissions = Some(classes);
                    return true;
                }
                "rest_framework.decorators.authentication_classes" => {
                    let classes = self.class_list(call.and_then(|c| c.arguments.args.first()));
                    for pr in &classes {
                        sym.wraps.push((pr.clone(), WrapKind::Authenticates));
                    }
                    sym.drf_authentication = Some(classes);
                    return true;
                }
                "django.views.decorators.http.require_http_methods" => {
                    sym.methods = upper_methods(call.and_then(|c| c.arguments.args.first()));
                }
                "django.views.decorators.http.require_GET" => sym.methods = vec!["GET".into()],
                "django.views.decorators.http.require_POST" => sym.methods = vec!["POST".into()],
                "django.views.decorators.http.require_safe" => {
                    sym.methods = vec!["GET".into(), "HEAD".into()]
                }
                _ => {}
            }
        }
        let Expr::Attribute(a) = func else {
            return false;
        };
        let attr = a.attr.as_str();
        // A local app or router of the FastAPI factory being lowered is the factory's
        // local (`create_app.app`), as calls in the factory name it.
        let local = match (&self.factory, a.value.as_ref()) {
            (Some((f, names)), Expr::Name(n)) if names.contains(n.id.as_str()) => Some(RawRef {
                base: RawBase::Local(f.clone()),
                member: format!(".{}", n.id),
            }),
            _ => None,
        };
        let Some(receiver) = local.or_else(|| self.canon(&a.value)) else {
            return false;
        };
        if matches!(receiver.base, RawBase::Global(_)) {
            return false;
        }
        if attr == "middleware"
            && let Some(c) = call
        {
            self.read_targets.insert(c as *const ast::ExprCall as usize);
            // Starlette and FastAPI `@app.middleware("http")`: a middleware of the
            // application object, and a hook that may guard its routes.
            self.out.hooks.push(RawHook {
                router: receiver.clone(),
                hook: RawRef {
                    base: RawBase::Local(symbol.to_string()),
                    member: String::new(),
                },
                app_wide: false,
                middleware: true,
                conditional: false,
                unmeasured: false,
            });
            self.out.middlewares.push(RawMiddleware {
                app: receiver,
                what: Some(RawRef {
                    base: RawBase::Local(symbol.to_string()),
                    member: String::new(),
                }),
                class: false,
                text: format!("@{}(...)", written(func)),
                line: self.line(c),
            });
            return false;
        }
        if BEFORE_HOOKS.contains(&attr) && call.is_none() {
            self.out.hooks.push(RawHook {
                router: receiver,
                hook: RawRef {
                    base: RawBase::Local(symbol.to_string()),
                    member: String::new(),
                },
                app_wide: attr == "before_app_request",
                middleware: false,
                conditional: false,
                unmeasured: false,
            });
            return true;
        }
        if !(HTTP_VERBS.contains(&attr) || ROUTE_ATTRS.contains(&attr)) {
            return false;
        }
        if attr != "task" && call.is_none() {
            return false;
        }
        let path = call.and_then(|c| {
            self.path_value(arg(c, 0, if attr == "route" { "rule" } else { "path" }))
        });
        if attr != "task" && path.is_none() {
            return false;
        }
        let route = RawRoute {
            symbol: symbol.to_string(),
            receiver,
            verb: attr.to_string(),
            path,
            methods: upper_methods(call.and_then(|c| keyword(c, "methods"))),
            deps: self.deps_list(call.and_then(|c| keyword(c, "dependencies"))),
            keywords: call
                .map(|c| {
                    c.arguments
                        .keywords
                        .iter()
                        .filter_map(|k| k.arg.as_ref().map(|a| a.as_str().to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            name: call.and_then(|c| keyword(c, "name")).and_then(string_value),
            line,
            position,
            above: (sym.wraps.len() as u32, sym.since_wraps.len() as u32),
            splat_deps: call.map(|c| self.splat_deps(c)).unwrap_or_default(),
        };
        self.out.routes.push(route);
        true
    }

    /// `@method_decorator(<decorators>, name=<method>)` on a class, for a method
    /// other than `dispatch`: `Some(Some(method))`, or `Some(None)` where the name
    /// is not a literal. `None` for any other decorator, which applies to the class
    /// as a whole.
    fn method_decorator_name(&self, d: &ast::Decorator) -> Option<Option<String>> {
        let Expr::Call(c) = &d.expression else {
            return None;
        };
        if self.dotted_of(&c.func).as_deref() != Some("django.utils.decorators.method_decorator") {
            return None;
        }
        let name = keyword(c, "name").or_else(|| c.arguments.args.get(1))?;
        match string_value(name) {
            Some(n) if n == "dispatch" => None,
            Some(n) => Some(Some(n)),
            None => Some(None),
        }
    }

    /// `class X(Base): ...` at module level.
    /// The decorators a Flask view class applies to its handlers: `decorators =
    /// [...]` (`View.as_view` wraps the view in each, the first innermost) and
    /// Flask-RESTful's `method_decorators`. Kept outermost first; an element that
    /// is no name, and a value that is no list written in place, by its words.
    fn view_decorators(&self, c: &ast::StmtClassDef, sym: &mut RawSymbol) {
        for stmt in &c.body {
            let Stmt::Assign(a) = stmt else { continue };
            let [Expr::Name(n)] = a.targets.as_slice() else {
                continue;
            };
            if !matches!(n.id.as_str(), "decorators" | "method_decorators") {
                continue;
            }
            sym.view_decorators = true;
            let at = sym.wraps.len() as u32;
            let Some(els) = elements(&a.value) else {
                sym.since_wraps
                    .push((at, None, crate::lower::practice::words(&a.value)));
                continue;
            };
            for x in els.iter().rev() {
                let (r, text) = self.wrapper_written(x, None);
                if let Some(r) = &r
                    && !text.is_empty()
                {
                    sym.shapes.push((r.clone(), text.clone()));
                }
                sym.since_wraps.push((at, r, text));
            }
        }
    }

    pub(crate) fn lower_class(&mut self, c: &'t ast::StmtClassDef) {
        let name = c.name.as_str();
        let mut sym = RawSymbol::empty(name, SymbolKind::Class, self.line(c));
        // An error class that refuses the caller by the status its own definition
        // sets ([`drift_core::controls::REFUSAL_STATUS`]), read since the measured
        // build (S15c): as the TypeScript lowering writes it.
        if let Some(status) = self.class_status(name).filter(|s| matches!(*s, 401 | 403)) {
            sym.controls.push(format!(
                "{}{}{status}",
                crate::raw::SINCE,
                drift_core::controls::REFUSAL_STATUS
            ));
        }
        // What the class's decorators apply to every method (`name="dispatch"`, or
        // a decorator that is no `method_decorator`).
        let mut wide: Vec<RawRef> = Vec::new();
        for (i, d) in c.decorator_list.iter().enumerate() {
            let before = sym.wraps.len();
            let since_before = sym.since_wraps.len();
            let controls_before = sym.controls.clone();
            self.lower_decorator(name, d, i as u32, &mut sym);
            let added = sym.wraps[before..].iter().map(|(r, _)| r.clone());
            match self.method_decorator_name(d) {
                Some(only) => {
                    // What the test of this decorator says is its method's.
                    use drift_core::controls::{
                        PASSES_TEST_SIGNED_IN, PASSES_TEST_TRUE, PASSES_TEST_UNREAD,
                        TEST_ASKS_ROLE, TEST_ASKS_STATUS, TEST_ASKS_UNREAD,
                    };
                    let test = [
                        PASSES_TEST_SIGNED_IN,
                        PASSES_TEST_TRUE,
                        PASSES_TEST_UNREAD,
                        TEST_ASKS_ROLE,
                        TEST_ASKS_STATUS,
                        TEST_ASKS_UNREAD,
                    ];
                    let moved: Vec<String> = sym
                        .controls
                        .iter()
                        .filter(|c| test.contains(&c.as_str()) && !controls_before.contains(c))
                        .cloned()
                        .collect();
                    sym.controls.retain(|c| !moved.contains(c));
                    sym.controls_only
                        .extend(moved.into_iter().map(|c| (c, only.clone())));
                    sym.wraps_only.extend(added.map(|r| (r, only.clone())));
                    sym.since_only.extend(
                        (since_before..sym.since_wraps.len()).map(|i| (i as u32, only.clone())),
                    );
                }
                None => wide.extend(added),
            }
            // `@admin.register(Site)`, `@register_type(models.Site)`: the reference a
            // registration decorator files the class under.
            if let Expr::Call(dc) = &d.expression
                && let Some(first @ (Expr::Name(_) | Expr::Attribute(_))) =
                    dc.arguments.args.first()
                && let (Some(dr), Some(ar)) = (self.canon(&dc.func), self.canon(first))
                // Only a decorator that wraps the class itself (not `@method_decorator(x)`,
                // which applies `x`, nor a route registration).
                && sym.wraps.last() == Some(&(dr.clone(), WrapKind::Decorator))
            {
                sym.decorator_args.push((dr, ar));
            }
        }
        // Read after the class's decorators: a route decorator among them counts
        // what is written above it, and the list a view class applies to its
        // handlers is not ([`RawRoute::above`]).
        self.view_decorators(c, &mut sym);
        sym.meta = self.class_meta(&c.body);
        sym.disclaims = crate::docs::docstring(&c.body)
            .map(|d| crate::docs::disclaims(d, name))
            .unwrap_or_default();
        let mut bases = Vec::new();
        let mut table_kw = false;
        if let Some(args) = &c.arguments {
            for b in &args.args {
                let b = match b {
                    Expr::Subscript(s) => s.value.as_ref(),
                    other => other,
                };
                match self.canon(b) {
                    Some(r) => {
                        bases.push(r.clone());
                        sym.wraps.push((r, WrapKind::Extends));
                    }
                    // `*BASES`, `A if c else B`: a base no reference stands for.
                    None => sym.wraps.push((unknown_base(), WrapKind::Extends)),
                }
            }
            table_kw = args.keywords.iter().any(|k| {
                k.arg.as_ref().is_some_and(|a| a.as_str() == "table")
                    && matches!(k.value, Expr::BooleanLiteral(ref b) if b.value)
            });
            // `metaclass=ABCMeta`: abstract whatever its methods say.
            if args.keywords.iter().any(|k| {
                k.arg.as_ref().is_some_and(|a| a.as_str() == "metaclass")
                    && self.dotted_of(&k.value).as_deref() == Some("abc.ABCMeta")
            }) {
                sym.traits.push(drift_core::traits::ABSTRACT.into());
            }
        }
        if is_abstract_body(&c.body, &|e| self.dotted_of(e)) {
            sym.traits.push(drift_core::traits::ABSTRACT.into());
        }
        // A decorated class without `__init__` (a dataclass) builds one from its fields,
        // and one with `__new__` is built by it.
        let defines = |name: &str| {
            c.body
                .iter()
                .any(|st| matches!(st, Stmt::FunctionDef(f) if f.name.as_str() == name))
        };
        if !defines("__init__") && (!c.decorator_list.is_empty() || defines("__new__")) {
            sym.params = RawParams::Unknown;
            // The measured build read `__new__` alone as an inherited constructor.
            sym.built_by_new = c.decorator_list.is_empty();
        }
        sym.view = bases
            .iter()
            .filter_map(dotted)
            .find_map(|d| view_adapter(&d))
            .map(String::from);

        let mut django_fields = Vec::new();
        let mut sqla_fields = Vec::new();
        let mut annotated = Vec::new();
        let mut tablename = false;
        for stmt in &c.body {
            match stmt {
                Stmt::FunctionDef(f) => {
                    let m = f.name.as_str();
                    if m == "get_permissions" {
                        sym.drf_permissions_unread = Some(crate::raw::GET_PERMISSIONS.into());
                        sym.drf_permission_cases = self.permission_cases(f);
                    }
                    if HANDLER_METHODS.contains(&m) {
                        sym.methods.push(m.to_ascii_uppercase());
                    }
                    // A class used as a FastAPI dependency (`Depends(Pagination)`, or an
                    // instance with `__call__`) has its parameters' dependencies.
                    match m {
                        "__init__" => {
                            sym.deps.extend(self.parameter_deps(&f.parameters));
                            sym.params = positional_params(&f.parameters, true);
                        }
                        "__call__" => sym.call_deps.extend(self.parameter_deps(&f.parameters)),
                        _ => {}
                    }
                    for d in &f.decorator_list {
                        if let Expr::Call(dc) = &d.expression
                            && self.dotted_of(&dc.func).as_deref()
                                == Some("django.utils.decorators.method_decorator")
                            && let Some(inner) = dc.arguments.args.first()
                            && let Some(r) = self.canon(match inner {
                                Expr::Call(ic) => &ic.func,
                                other => other,
                            })
                        {
                            // On `dispatch` it runs for every method; on any
                            // other, for that method only.
                            if m == "dispatch" {
                                wide.push(r.clone());
                            } else {
                                sym.wraps_only.push((r.clone(), Some(m.to_string())));
                            }
                            sym.wraps.push((r, WrapKind::Decorator));
                        }
                    }
                }
                Stmt::Assign(a) => {
                    let [Expr::Name(target)] = a.targets.as_slice() else {
                        continue;
                    };
                    let t = target.id.as_str();
                    if t == "__tablename__" {
                        tablename = true;
                    }
                    if t == "permission_classes"
                        && sym.drf_permissions_unread.as_deref()
                            != Some(crate::raw::GET_PERMISSIONS)
                    {
                        sym.drf_permissions_unread = self.classes_unread(Some(&a.value));
                    }
                    if matches!(t, "permission_classes" | "authentication_classes")
                        && elements(&a.value).is_some()
                    {
                        let classes = self.class_list(Some(&a.value));
                        // Authentication identifies the caller; only permissions reject.
                        let kind = if t == "permission_classes" {
                            WrapKind::Call
                        } else {
                            WrapKind::Authenticates
                        };
                        for r in &classes {
                            sym.wraps.push((r.clone(), kind));
                        }
                        if t == "permission_classes" {
                            sym.drf_permissions = Some(classes);
                        } else {
                            sym.drf_authentication = Some(classes);
                        }
                    }
                    if let Expr::Call(v) = a.value.as_ref() {
                        let callee = match v.func.as_ref() {
                            Expr::Attribute(x) => Some(x.attr.as_str()),
                            Expr::Name(x) => Some(x.id.as_str()),
                            _ => None,
                        };
                        let d = self.dotted_of(&v.func);
                        if d.as_deref().is_some_and(|d| {
                            d.starts_with("django.db.models.")
                                && (d.ends_with("Field") || d.ends_with("ForeignKey"))
                        }) {
                            django_fields.push(t.to_string());
                        } else if matches!(callee, Some("Column" | "mapped_column")) {
                            sqla_fields.push(t.to_string());
                        }
                    }
                }
                Stmt::AnnAssign(a) => {
                    if let Expr::Name(target) = a.target.as_ref() {
                        let ann_is_mapped = matches!(a.annotation.as_ref(), Expr::Subscript(s) if matches!(s.value.as_ref(), Expr::Name(n) if n.id.as_str() == "Mapped") || matches!(s.value.as_ref(), Expr::Attribute(x) if x.attr.as_str() == "Mapped"));
                        let class_var = matches!(a.annotation.as_ref(), Expr::Subscript(s) if matches!(s.value.as_ref(), Expr::Name(n) if n.id.as_str() == "ClassVar"));
                        if ann_is_mapped {
                            sqla_fields.push(target.id.as_str().to_string());
                        } else if !class_var && !target.id.as_str().starts_with('_') {
                            annotated.push(target.id.as_str().to_string());
                        }
                    }
                }
                _ => {}
            }
        }
        let model = if !django_fields.is_empty() {
            Some(("django", django_fields))
        } else if !sqla_fields.is_empty() || (tablename && !annotated.is_empty()) {
            let mut f = sqla_fields;
            if tablename {
                f.extend(annotated.iter().cloned());
            }
            Some(("sqlalchemy", f))
        } else if table_kw && !annotated.is_empty() {
            Some(("sqlmodel", annotated))
        } else {
            None
        };
        if let Some((source, mut fields)) = model {
            fields.sort();
            fields.dedup();
            self.out.models.push(RawModel {
                name: name.to_string(),
                source: source.into(),
                line: sym.line,
                fields,
            });
        }
        let mut col = Collector::new(self, false);
        col.class_body(&c.body);
        col.fill(&mut sym);
        // A method's receiver calls are its member's, read with what `__init__` binds.
        sym.receiver_calls.clear();
        sym.conditional_calls.clear();
        self.self_class = Some(name.to_string());
        self.self_bases = bases.to_vec();
        self.self_methods = c
            .body
            .iter()
            .filter_map(|st| match st {
                Stmt::FunctionDef(f) => Some(f.name.to_string()),
                _ => None,
            })
            .collect();
        sym.members = self.class_members(name, &c.body);
        sym.attr_types = std::mem::take(&mut self.attr_types);
        sym.attr_params = std::mem::take(&mut self.attr_params);
        // A dataclass with no `__init__` of its own: the generated one binds each
        // field from the parameter of its name, in the order of the fields.
        let dataclass = c.decorator_list.iter().any(|d| {
            let e = match &d.expression {
                Expr::Call(call) => call.func.as_ref(),
                e => e,
            };
            matches!(
                e,
                Expr::Name(n) if matches!(n.id.as_str(), "dataclass" | "define" | "frozen")
            ) || matches!(
                e,
                Expr::Attribute(a) if matches!(a.attr.as_str(), "dataclass" | "define" | "frozen")
            )
        });
        // The generated constructor is read only where its parameters are the
        // fields as written, in order: a class with no base (an inherited
        // dataclass's fields come first, and any base may be one), a decorator given
        // no option that changes the constructor (`init=False`, `kw_only=True`), and
        // no field that is no parameter or not by its position (`ClassVar`,
        // `InitVar`, `KW_ONLY`, `field(init=False)`, `field(kw_only=True)`, an attrs
        // field whose name starts with `_`, which its parameter drops). Nor where a
        // method binds the field again (`__post_init__`). Else nothing is bound from
        // a parameter: [`drift_core::controls::ATTR_PARAM_UNREAD`].
        if dataclass && !sym.members.iter().any(|m| m.name == "__init__") {
            let keywords_kept = c.decorator_list.iter().all(|d| match &d.expression {
                Expr::Call(call) => call.arguments.keywords.iter().all(|k| {
                    k.arg.as_ref().is_some_and(|a| {
                        matches!(
                            a.as_str(),
                            "repr"
                                | "eq"
                                | "order"
                                | "unsafe_hash"
                                | "frozen"
                                | "slots"
                                | "weakref_slot"
                                | "match_args"
                                | "hash"
                                | "str"
                        )
                    })
                }),
                _ => true,
            });
            let no_base = c
                .arguments
                .as_ref()
                .is_none_or(|a| a.args.is_empty() && a.keywords.is_empty());
            let mut fields: Vec<String> = Vec::new();
            let mut plain = keywords_kept && no_base;
            for st in &c.body {
                let Stmt::AnnAssign(a) = st else { continue };
                let Expr::Name(n) = a.target.as_ref() else {
                    plain = false;
                    continue;
                };
                let last = |e: &Expr| match e {
                    Expr::Name(n) => Some(n.id.to_string()),
                    Expr::Attribute(x) => Some(x.attr.to_string()),
                    _ => None,
                };
                let annotation = match a.annotation.as_ref() {
                    Expr::Subscript(x) => last(&x.value),
                    e => last(e),
                };
                let special = annotation
                    .as_deref()
                    .is_some_and(|t| matches!(t, "ClassVar" | "InitVar" | "KW_ONLY"));
                let options = a.value.as_deref().is_some_and(|v| match v {
                    Expr::Call(call) => {
                        last(&call.func)
                            .is_some_and(|f| matches!(f.as_str(), "field" | "ib" | "attrib"))
                            && call.arguments.keywords.iter().any(|k| {
                                k.arg.as_ref().is_none_or(|a| {
                                    matches!(a.as_str(), "init" | "kw_only" | "alias")
                                })
                            })
                    }
                    _ => false,
                });
                if special || options || n.id.starts_with('_') {
                    plain = false;
                }
                fields.push(n.id.to_string());
            }
            let methods = c.body.iter().filter_map(|st| match st {
                Stmt::FunctionDef(f) => Some(f),
                _ => None,
            });
            let writes = SelfWrites::of(methods.flat_map(|f| &f.body));
            if writes.any_setattr || fields.iter().any(|f| writes.attrs.contains_key(f.as_str())) {
                plain = false;
            }
            sym.attr_params = if plain {
                fields
                    .into_iter()
                    .enumerate()
                    .map(|(i, f)| (f.clone(), f, i as u32))
                    .collect()
            } else {
                Vec::new()
            };
            if !plain {
                sym.controls
                    .push(drift_core::controls::ATTR_PARAM_UNREAD.into());
            }
        }
        sym.wraps.dedup();
        // One that also runs for every method is no method's own.
        sym.wraps_only.retain(|(r, _)| !wide.contains(r));
        sym.wraps_only.sort();
        sym.wraps_only.dedup();
        let viewish = sym.view.is_some()
            || !self.out.routes.iter().all(|r| r.symbol != name)
            || bases.iter().any(is_view_base);
        let methods = if viewish {
            self.handler_methods(name, &sym, &c.body)
        } else if let Some(late) = self.framework_late_methods(c, &sym) {
            // A Litestar controller: its handlers, for the listed reading only.
            late
        } else if !bases.is_empty() && !sym.methods.is_empty() {
            // A class on a base of the repository may be a view (`Items(Base)`,
            // `Base(View)`): its handler methods are symbols of the link that reads
            // them, kept apart from what the measured build mined. Lowering what the
            // decorators of a method register is for the symbols the build had.
            let kept = std::mem::take(&mut self.out);
            let mut late = self.handler_methods(name, &sym, &c.body);
            self.out = kept;
            late.retain(|m| {
                m.name
                    .rsplit_once('.')
                    .is_some_and(|(_, f)| HANDLER_METHODS.contains(&f))
            });
            for m in &mut late {
                m.late = true;
            }
            late
        } else {
            vec![]
        };
        self.self_class = None;
        self.self_methods.clear();
        self.self_bases.clear();
        self.push_symbol(sym);
        for m in methods {
            self.push_symbol(m);
        }
    }

    /// Each method the class body defines, with what its own body calls and the risky
    /// operations in it ([`drift_core::Symbol::members`]). A call of a sibling method
    /// through `self` or `cls` (`self.refresh()`) is recorded as the class's member.
    fn class_members(&mut self, class_name: &str, body: &'t [Stmt]) -> Vec<RawMember> {
        let defs: Vec<&'t ast::StmtFunctionDef> = body
            .iter()
            .filter_map(|st| match st {
                Stmt::FunctionDef(f) => Some(f),
                _ => None,
            })
            .collect();
        let names: BTreeSet<&str> = defs.iter().map(|f| f.name.as_str()).collect();
        // What `__init__` binds on `self` from a typed parameter (`self.repo = repo` with
        // `repo: Repo`) or a constructor call (`self.repo = Repo()`): the class of each
        // attribute, so a method's `self.repo.find()` is `Repo.find`.
        self.self_types.clear();
        self.attr_params.clear();
        // What the methods of the class bind on `self`, and `__init__` by name.
        let writes = SelfWrites::of(defs.iter().flat_map(|f| &f.body));
        if let Some(init) = defs.iter().find(|f| f.name.as_str() == "__init__") {
            let init_writes = SelfWrites::of(init.body.iter());
            // The parameters by position, `self` left out.
            let positions: Vec<&str> = init
                .parameters
                .posonlyargs
                .iter()
                .chain(&init.parameters.args)
                .skip(1)
                .map(|p| p.parameter.name.as_str())
                .chain(
                    init.parameters
                        .kwonlyargs
                        .iter()
                        .map(|p| p.parameter.name.as_str()),
                )
                .collect();
            let mut param_types: HashMap<String, RawRef> = HashMap::new();
            for p in init.parameters.iter() {
                if let Some(a) = p.annotation()
                    && let Some(t) = crate::lower::type_expr(a)
                    && let Some(r) = self.canon(t)
                {
                    param_types.insert(p.name().as_str().to_string(), r);
                }
            }
            for st in &init.body {
                let Stmt::Assign(a) = st else { continue };
                let [Expr::Attribute(t)] = a.targets.as_slice() else {
                    continue;
                };
                if !matches!(t.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self") {
                    continue;
                }
                // Only the attribute's one binding, from a parameter `__init__` never
                // rebinds: an attribute any method of the class (this one too,
                // later, or under a branch) also binds, or a parameter rebound
                // (`actor = Member.objects.get(...)`), holds what was not passed.
                if let Expr::Name(n) = a.value.as_ref()
                    && let Some(i) = positions.iter().position(|p| *p == n.id.as_str())
                    && !writes.any_setattr
                    && writes.attrs.get(t.attr.as_str()) == Some(&1)
                    && !init_writes.names.contains_key(n.id.as_str())
                {
                    // A keyword-only parameter has no position a call can give.
                    let positional = (init.parameters.posonlyargs.len()
                        + init.parameters.args.len())
                    .saturating_sub(1);
                    let at = if i < positional { i as u32 } else { u32::MAX };
                    self.attr_params
                        .push((t.attr.to_string(), n.id.to_string(), at));
                }
                let ty = match a.value.as_ref() {
                    Expr::Name(n) => param_types.get(n.id.as_str()).cloned(),
                    Expr::Call(c) => self.canon(&c.func),
                    _ => None,
                };
                if let Some(ty) = ty {
                    self.self_types.insert(t.attr.as_str().to_string(), ty);
                }
            }
        }
        let mut out = Vec::new();
        for f in &defs {
            let mut tmp = RawSymbol::empty(f.name.as_str(), SymbolKind::Function, 0);
            let mut c = Collector::new(self, false);
            c.function(&f.parameters, &f.body, f.returns.as_deref());
            let order = std::mem::take(&mut c.body_order);
            c.fill(&mut tmp);
            let mut siblings = SelfCalls {
                names: &names,
                found: BTreeSet::new(),
            };
            for st in &f.body {
                siblings.visit_stmt(st);
            }
            let mut calls = tmp.calls;
            calls.extend(siblings.found.into_iter().map(|m| RawRef {
                base: RawBase::Local(class_name.to_string()),
                member: format!(".{m}"),
            }));
            calls.sort();
            calls.dedup();
            out.push(RawMember {
                is_async: f.is_async,
                name: f.name.to_string(),
                calls,
                sinks: tmp.sinks,
                since_sinks: tmp.since_sinks,
                fed_sinks: tmp.fed_sinks,
                param_passes: tmp.param_passes,
                held: tmp.held,
                rows: tmp.rows,
                body_checks: tmp.body_checks,
                throws: tmp.throws,
                args: tmp.args,
                scoped: tmp.scoped,
                raise_checks: tmp.raise_checks,
                decorators: f
                    .decorator_list
                    .iter()
                    .filter_map(|d| {
                        self.canon(match &d.expression {
                            Expr::Call(c) => c.func.as_ref(),
                            e => e,
                        })
                    })
                    .filter(|r| !matches!(r.base, RawBase::Global(_)))
                    .collect(),
                receiver_calls: tmp.receiver_calls,
                conditional_calls: tmp.conditional_calls,
                order,
                caller_args: tmp.caller_args,
                check_sides: tmp.check_sides,
                filter_values: tmp.filter_values,
                arg_sides: tmp.arg_sides,
                row_sets: tmp.row_sets,
                typed_calls: tmp.typed_calls,
                unread: tmp
                    .controls
                    .iter()
                    .filter(|c| {
                        use drift_core::controls::{
                            HANDLER_MAY_REJECT, HANDLER_REJECTS, KEEPS_VALUE, PARAM_FLOWS,
                            REJECTS_SOME, SCOPE_UNREAD, UNREAD_EXIT,
                        };
                        [
                            KEEPS_VALUE,
                            UNREAD_EXIT,
                            crate::raw::UNREAD_EXIT_MEASURED,
                            SCOPE_UNREAD,
                            HANDLER_REJECTS,
                            HANDLER_MAY_REJECT,
                            PARAM_FLOWS,
                            REJECTS_SOME,
                        ]
                        // (One the lowering wrote for one reading only, too.)
                        .contains(
                            &c.strip_prefix(crate::raw::SINCE)
                                .or_else(|| c.strip_prefix(crate::raw::MEASURED))
                                .unwrap_or(c.as_str()),
                        )
                    })
                    .cloned()
                    // An `except` handler of its own that answers with a response,
                    // read since the measured build (S15c).
                    .chain(
                        tmp.catches
                            .iter()
                            .any(|c| c.does.iter().any(|d| matches!(d, RawDoes::Respond(_))))
                            .then(|| {
                                format!("{}{}", crate::raw::SINCE, drift_core::CATCH_RESPONDS)
                            }),
                    )
                    // A 403 the method answers outside any `except`, as a function's
                    // `responses` hold it.
                    .chain(
                        tmp.responses
                            .iter()
                            .any(|r| r.status == 403 && !r.in_catch)
                            .then(|| drift_core::ANSWERS_403.to_string()),
                    )
                    // What a permission test answers a caller who is not signed in.
                    .chain(super::verdict::of_method(f).map(|v| v.fact().to_string()))
                    // Whether what it hands back is what the request sent, for the
                    // `__call__` FastAPI calls as a dependency.
                    .chain(
                        tmp.controls
                            .iter()
                            .filter(|c| {
                                f.name.as_str() == "__call__"
                                    && *c == drift_core::controls::RETURNS_REQUEST
                            })
                            .cloned(),
                    )
                    // What it asks of a caller who is signed in.
                    .chain(super::verdict::asks_of_method(f).map(|a| a.fact().to_string()))
                    .collect(),
            });
        }
        self.attr_types = self
            .self_types
            .drain()
            .filter(|(_, r)| !matches!(r.base, RawBase::Global(_)))
            .collect();
        self.attr_types.sort();
        out
    }

    /// What a class's own `class Meta:` sets: `model` (a reference), and the
    /// `abstract` / `proxy` flags when `True`. The last `Meta` and assignment win, as
    /// in Python. With them, what the class gives of its fields (lowering 72):
    /// `fields=*` for `fields = "__all__"`, `exclude=<field>` for each field `exclude`
    /// names, and `hidden=<field>` for a field declared as never given back
    /// (`password = CharField(write_only=True)`, `extra_kwargs = {"password":
    /// {"write_only": True}}`, `hashed_password: str = Field(exclude=True)`; the
    /// last two are read with or without a `Meta`).
    fn class_meta(&self, body: &[Stmt]) -> Vec<(String, Option<RawRef>)> {
        // What the class leaves out of what it gives of its fields, read where a
        // field is declared: `password = CharField(write_only=True)`,
        // `hashed_password: str = Field(exclude=True)`.
        let set = |c: &ast::ExprCall, k: &str| matches!(keyword(c, k), Some(Expr::BooleanLiteral(b)) if b.value);
        let mut left_out: BTreeSet<String> = BTreeSet::new();
        for s in body {
            let (target, value) = match s {
                Stmt::Assign(a) => match a.targets.as_slice() {
                    [Expr::Name(t)] => (t.id.as_str(), Some(a.value.as_ref())),
                    _ => continue,
                },
                Stmt::AnnAssign(a) => match a.target.as_ref() {
                    Expr::Name(t) => (t.id.as_str(), a.value.as_deref()),
                    _ => continue,
                },
                _ => continue,
            };
            if let Some(Expr::Call(c)) = value
                && (set(c, "write_only") || set(c, "exclude"))
            {
                left_out.insert(format!("hidden={target}"));
            }
        }
        let Some(meta) = body.iter().rev().find_map(|s| match s {
            Stmt::ClassDef(m) if m.name.as_str() == "Meta" => Some(m),
            _ => None,
        }) else {
            return left_out.into_iter().map(|k| (k, None)).collect();
        };
        let mut model = None;
        let mut flags = std::collections::BTreeMap::new();
        for s in &meta.body {
            let Stmt::Assign(a) = s else { continue };
            let [Expr::Name(t)] = a.targets.as_slice() else {
                continue;
            };
            match t.id.as_str() {
                // The whole of the model, or the whole but what is named.
                "fields" if string_value(&a.value).as_deref() == Some("__all__") => {
                    left_out.insert("fields=*".into());
                }
                "exclude" => left_out.extend(
                    elements(&a.value)
                        .into_iter()
                        .flatten()
                        .filter_map(string_value)
                        .map(|f| format!("exclude={f}")),
                ),
                // `extra_kwargs = {"password": {"write_only": True}}`.
                "extra_kwargs" => {
                    if let Expr::Dict(d) = a.value.as_ref() {
                        for item in &d.items {
                            let (Some(field), Expr::Dict(opts)) =
                                (item.key.as_ref().and_then(string_value), &item.value)
                            else {
                                continue;
                            };
                            if opts.items.iter().any(|o| {
                                o.key.as_ref().and_then(string_value).as_deref()
                                    == Some("write_only")
                                    && matches!(&o.value, Expr::BooleanLiteral(b) if b.value)
                            }) {
                                left_out.insert(format!("hidden={field}"));
                            }
                        }
                    }
                }
                "model" => {
                    model = match a.value.as_ref() {
                        v @ (Expr::Name(_) | Expr::Attribute(_)) => self.canon(v),
                        _ => None,
                    }
                }
                f @ ("abstract" | "proxy") => {
                    let on = matches!(a.value.as_ref(), Expr::BooleanLiteral(b) if b.value);
                    flags.insert(f, on);
                }
                _ => {}
            }
        }
        let mut out: Vec<(String, Option<RawRef>)> = flags
            .into_iter()
            .filter(|(_, on)| *on)
            .map(|(f, _)| (f.to_string(), None))
            .collect();
        if let Some(m) = model {
            out.push(("model".into(), Some(m)));
        }
        out.extend(left_out.into_iter().map(|k| (k, None)));
        out
    }

    /// One symbol per HTTP handler of a class-based view (`PostDetail.get`), carrying
    /// the class's wraps and its own decorators, so per-method guards are visible.
    fn handler_methods(
        &mut self,
        class: &str,
        sym: &RawSymbol,
        body: &'t [Stmt],
    ) -> Vec<RawSymbol> {
        let mut out = Vec::new();
        for stmt in body {
            let Stmt::FunctionDef(f) = stmt else { continue };
            let m = f.name.as_str();
            let action = f.decorator_list.iter().find_map(|d| {
                let (func, call) = match &d.expression {
                    Expr::Call(c) => (c.func.as_ref(), Some(c)),
                    e => (e, None),
                };
                (self.dotted_of(func).as_deref() == Some("rest_framework.decorators.action"))
                    .then(|| upper_methods(call.and_then(|c| keyword(c, "methods"))))
            });
            let verbs: Vec<String> = if let Some(v) = action {
                if v.is_empty() { vec!["GET".into()] } else { v }
            } else if HANDLER_METHODS.contains(&m) {
                vec![m.to_ascii_uppercase()]
            } else if let Some((_, v)) = DRF_ACTIONS.iter().find(|(a, _)| *a == m)
                && sym.view.as_deref() != Some("django")
            {
                vec![v.to_string()]
            } else {
                continue;
            };
            let mut ms =
                RawSymbol::empty(&format!("{class}.{m}"), SymbolKind::Function, self.line(f));
            // `@action(permission_classes=[...])`: the action's own, in place of
            // the class's.
            ms.drf_permissions_unread = f.decorator_list.iter().find_map(|d| match &d.expression {
                Expr::Call(c)
                    if self.dotted_of(&c.func).as_deref()
                        == Some("rest_framework.decorators.action") =>
                {
                    keyword(c, "permission_classes").map(|v| {
                        format!(
                            "action(permission_classes={})",
                            crate::lower::practice::words(v)
                        )
                    })
                }
                _ => None,
            });
            ms.owner = Some(class.to_string());
            ms.methods = verbs;
            ms.wraps = sym
                .wraps
                .iter()
                .filter(|(_, k)| *k != WrapKind::Try)
                .cloned()
                .collect();
            ms.wraps_only = sym.wraps_only.clone();
            for (control, only) in &sym.controls_only {
                if only.as_deref().is_none_or(|o| o == m) && !ms.controls.contains(control) {
                    ms.controls.push(control.clone());
                }
            }
            // A decorator that is no name, given to `method_decorator` for this
            // method (or for a method whose name is not read).
            for (i, only) in &sym.since_only {
                if only.as_deref().is_none_or(|o| o == m)
                    && let Some(w) = sym.since_wraps.get(*i as usize)
                {
                    ms.since_wraps.push(w.clone());
                }
            }
            if f.returns.is_some() {
                ms.controls.push("typed_return".into());
            }
            for (i, d) in f.decorator_list.iter().enumerate() {
                let is_action = matches!(&d.expression, Expr::Call(c) if self.dotted_of(&c.func).as_deref() == Some("rest_framework.decorators.action"))
                    || self.dotted_of(&d.expression).as_deref()
                        == Some("rest_framework.decorators.action");
                if !is_action {
                    self.lower_decorator(&ms.name.clone(), d, i as u32, &mut ms);
                }
            }
            let mut c = Collector::new(self, false);
            c.function(&f.parameters, &f.body, f.returns.as_deref());
            c.fill(&mut ms);
            self.inline_own_helpers(f, body, &mut ms);
            out.push(ms);
        }
        out
    }

    /// What a handler method calls through its class's own helper methods
    /// (`self._write(request, pk)` returning `Response(...)`): the helpers' calls, to
    /// [`OWN_HELPER_DEPTH`] levels, are the handler's calls too. The class symbol already
    /// holds every method's calls; only the handler's own symbol would miss them, and a
    /// rule that handlers call `Response()` would then count a handler that returns
    /// one through `self._write` as an outlier. Only methods of this class body called
    /// on the method's first parameter (`self`, `cls`); never a base's method, which
    /// the file may not hold. Calls only: keys passed, call order, controls and throws
    /// stay the handler's own.
    fn inline_own_helpers(
        &mut self,
        handler: &'t ast::StmtFunctionDef,
        body: &'t [Stmt],
        ms: &mut RawSymbol,
    ) {
        let methods: BTreeMap<&str, &'t ast::StmtFunctionDef> = body
            .iter()
            .filter_map(|st| match st {
                Stmt::FunctionDef(f) => Some((f.name.as_str(), f)),
                _ => None,
            })
            .collect();
        let mut seen: BTreeSet<&str> = BTreeSet::from([handler.name.as_str()]);
        let mut frontier = vec![handler];
        for _ in 0..OWN_HELPER_DEPTH {
            let mut next = Vec::new();
            for f in frontier {
                for name in own_method_calls(f) {
                    let Some((&key, &h)) = methods.get_key_value(name.as_str()) else {
                        continue;
                    };
                    if !seen.insert(key) {
                        continue;
                    }
                    let mut part = RawSymbol::empty(key, SymbolKind::Function, ms.line);
                    let mut c = Collector::new(self, false);
                    c.function(&h.parameters, &h.body, h.returns.as_deref());
                    c.fill(&mut part);
                    ms.calls.extend(part.calls);
                    next.push(h);
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
    }

    // ------------------------------------------------------------------ Django URLconf

    /// `urlpatterns = [path(...), ...]` (also `+=`, `+ router.urls`, `.extend`).
    pub(crate) fn lower_urlpatterns(&mut self, value: &'t Expr, prefix: &str) {
        self.lower_urlpatterns_at(value, prefix, 0);
    }

    fn lower_urlpatterns_at(&mut self, value: &'t Expr, prefix: &str, depth: usize) {
        if depth > 8 {
            return;
        }
        match value {
            Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
                self.lower_urlpatterns_at(&b.left, prefix, depth + 1);
                self.lower_urlpatterns_at(&b.right, prefix, depth + 1);
            }
            Expr::Attribute(a) if a.attr.as_str() == "urls" => {
                if let Some(r) = self.canon(&a.value) {
                    self.out.mounts.push(RawMount {
                        parent: None,
                        target: MountTarget::Ref(r),
                        prefix: Some(prefix.to_string()),
                        deps: vec![],
                        opaque: false,
                        whole_app: false,
                        unmeasured: false,
                        table: None,
                    });
                }
            }
            Expr::Name(n) => {
                if let Some(els) = self.lists.get(n.id.as_str()).copied() {
                    for e in els {
                        self.lower_url_entry_at(e, prefix, depth + 1);
                    }
                } else {
                    // A pattern list of another module (`urlpatterns = [...] + more`):
                    // included here, or, when it cannot be named, not followed.
                    let target = match self.canon(value) {
                        Some(r) if matches!(r.base, RawBase::Import { .. }) => MountTarget::Ref(r),
                        _ => MountTarget::Dynamic,
                    };
                    self.out.mounts.push(RawMount {
                        parent: None,
                        target,
                        prefix: Some(prefix.to_string()),
                        deps: vec![],
                        opaque: false,
                        whole_app: false,
                        // Not read by the measured build.
                        unmeasured: true,
                        table: None,
                    });
                }
            }
            Expr::Call(c) => {
                // `format_suffix_patterns([...])`, `i18n_patterns(...)`: patterns inside.
                // `i18n_patterns` serves them under a language code, which is not read.
                let i18n = self
                    .dotted_of(&c.func)
                    .is_some_and(|d| d.ends_with("i18n_patterns"));
                let under = if i18n {
                    format!("{prefix}{UNKNOWN_PREFIX}/")
                } else {
                    prefix.to_string()
                };
                for a in &c.arguments.args {
                    if elements(a).is_some() || matches!(a, Expr::Name(_)) {
                        self.lower_urlpatterns_at(a, &under, depth + 1);
                    } else if matches!(a, Expr::Call(_)) {
                        // A pattern written as an argument: the measured build read
                        // lists only, so what this one lists is marked.
                        let (mounts, registrations) =
                            (self.out.mounts.len(), self.out.registrations.len());
                        self.lower_url_entry_at(a, &under, depth + 1);
                        for m in &mut self.out.mounts[mounts..] {
                            m.unmeasured = true;
                        }
                        for r in &mut self.out.registrations[registrations..] {
                            r.unmeasured = true;
                        }
                    }
                }
            }
            e => {
                if let Some(els) = elements(e) {
                    for x in els {
                        // `urlpatterns = [*cycle_urls, *module_urls]`: each list
                        // unpacked in place is a pattern list of its own, of this
                        // module or of another. The measured build read no such
                        // element, so what one lists is marked.
                        if let Expr::Starred(starred) = x {
                            let (mounts, registrations) =
                                (self.out.mounts.len(), self.out.registrations.len());
                            self.lower_urlpatterns_at(&starred.value, prefix, depth + 1);
                            for m in &mut self.out.mounts[mounts..] {
                                m.unmeasured = true;
                            }
                            for r in &mut self.out.registrations[registrations..] {
                                r.unmeasured = true;
                            }
                            continue;
                        }
                        self.lower_url_entry_at(x, prefix, depth + 1);
                    }
                } else {
                    // A comprehension, a subscript, a conditional: the patterns are
                    // made where Drift does not read them. The URLconf is open, and
                    // the views its module names are listed under a path that is not
                    // known ([`Lowerer::lower_adapters_anywhere`]). The measured build
                    // read nothing here.
                    self.unread_urlpatterns = true;
                    self.out.mounts.push(RawMount {
                        parent: None,
                        target: MountTarget::Dynamic,
                        prefix: Some(prefix.to_string()),
                        deps: vec![],
                        opaque: false,
                        whole_app: false,
                        unmeasured: true,
                        table: None,
                    });
                }
            }
        }
    }

    pub(crate) fn lower_url_entry(&mut self, e: &'t Expr, prefix: &str) {
        self.lower_url_entry_at(e, prefix, 0);
    }

    fn lower_url_entry_at(&mut self, e: &'t Expr, prefix: &str, depth: usize) {
        let Expr::Call(c) = e else { return };
        let Some(d) = self.dotted_of(&c.func) else {
            return;
        };
        if !DJANGO_PATHS.contains(&d.as_str()) {
            return;
        }
        let regex = !d.ends_with(".path");
        let piece = match c.arguments.args.first().and_then(string_value) {
            Some(s) if regex => strip_regex_anchors(&s),
            Some(s) => s,
            None => "?".into(),
        };
        let route = format!("{prefix}{piece}");
        let Some(view) = arg(c, 1, "view") else {
            return;
        };
        self.lower_url_view(view, &route, Vec::new(), depth);
    }

    fn lower_url_view(
        &mut self,
        view: &'t Expr,
        route: &str,
        mut guards: Vec<RawRef>,
        depth: usize,
    ) {
        if depth > 12 {
            return;
        }
        match view {
            Expr::Call(c) => {
                let d = self.dotted_of(&c.func);
                // `decorator_include(login_required, "app.urls")`
                // (django-decorator-include): the include, with the decorators
                // around every view of it. A decorator that is a name is the
                // mount's guard, read as any; anything else is not read. The
                // measured build followed no such include.
                if d.as_deref().is_some_and(|d| DECORATOR_INCLUDE.contains(&d)) {
                    let (Some(decorators), Some(module)) = (
                        c.arguments.args.first(),
                        c.arguments.args.get(1).and_then(string_value),
                    ) else {
                        return;
                    };
                    let written: Vec<&Expr> = match elements(decorators) {
                        Some(els) => els.iter().collect(),
                        None => vec![decorators],
                    };
                    let deps: Vec<RawDep> = written
                        .iter()
                        .filter(|e| matches!(e, Expr::Name(_) | Expr::Attribute(_)))
                        .filter_map(|e| self.canon(e))
                        .map(RawDep::Direct)
                        .collect();
                    self.out.mounts.push(RawMount {
                        parent: None,
                        target: MountTarget::Module(module),
                        prefix: Some(route.to_string()),
                        opaque: deps.len() != written.len(),
                        deps,
                        whole_app: false,
                        unmeasured: true,
                        table: None,
                    });
                    return;
                }
                if d.as_deref().is_some_and(|d| DJANGO_INCLUDE.contains(&d)) {
                    let Some(first) = c.arguments.args.first() else {
                        return;
                    };
                    let first = match first {
                        Expr::Tuple(t) => t.elts.first().unwrap_or(first),
                        other => other,
                    };
                    match first {
                        _ if string_value(first).is_some() => {
                            self.out.mounts.push(RawMount {
                                parent: None,
                                target: MountTarget::Module(
                                    string_value(first).unwrap_or_default(),
                                ),
                                prefix: Some(route.to_string()),
                                deps: vec![],
                                opaque: false,
                                whole_app: false,
                                unmeasured: false,
                                table: None,
                            });
                        }
                        Expr::List(_) | Expr::Tuple(_) => {
                            self.lower_urlpatterns_at(first, route, depth + 1)
                        }
                        Expr::Name(n) if self.lists.contains_key(n.id.as_str()) => {
                            self.lower_urlpatterns_at(first, route, depth + 1)
                        }
                        Expr::Attribute(a) if a.attr.as_str() == "urls" => {
                            if let Some(r) = self.canon(&a.value) {
                                self.out.mounts.push(RawMount {
                                    parent: None,
                                    target: MountTarget::Ref(r),
                                    prefix: Some(route.to_string()),
                                    deps: vec![],
                                    opaque: false,
                                    whole_app: false,
                                    unmeasured: false,
                                    table: None,
                                });
                            }
                        }
                        other => {
                            // `include(module)`, `include(imported_list)`; a call result
                            // or a computed string is an include Drift cannot follow.
                            let target = match self.canon(other) {
                                Some(r)
                                    if !r.member.contains('(')
                                        && !matches!(r.base, RawBase::Global(_)) =>
                                {
                                    MountTarget::Ref(r)
                                }
                                _ => MountTarget::Dynamic,
                            };
                            self.out.mounts.push(RawMount {
                                parent: None,
                                target,
                                prefix: Some(route.to_string()),
                                deps: vec![],
                                opaque: false,
                                whole_app: false,
                                unmeasured: false,
                                table: None,
                            });
                        }
                    }
                    return;
                }
                if let Expr::Attribute(a) = c.func.as_ref()
                    && a.attr.as_str() == "as_view"
                {
                    if let Some(target) = self.canon(&a.value) {
                        self.registration(target, None, "django", route, vec![], guards);
                    }
                    return;
                }
                // `login_required(views.f)`, `cache_page(60)(views.f)`: a wrapper around the view.
                if let Some(inner) = c.arguments.args.first() {
                    let before = self.out.registrations.len();
                    let named = self.canon(&c.func);
                    if let Some(g) = &named {
                        guards.push(g.clone());
                    }
                    self.lower_url_view(inner, route, guards, depth + 1);
                    // How the wrapper is written where it is a call
                    // (`permission_required("x")(view)`), and one that is no name
                    // (`GUARDS["x"](view)`) by its words: it may be the guard.
                    let written = self.wrapper_written(&c.func, None);
                    for r in &mut self.out.registrations[before..] {
                        match (&named, &written) {
                            (Some(g), (Some(_), shape)) if !shape.is_empty() => {
                                let callee = RawRef {
                                    base: g.base.clone(),
                                    member: g.member.trim_end_matches("()").to_string(),
                                };
                                r.shapes.push((callee, shape.clone()));
                            }
                            (None, (None, words)) => {
                                r.since_guards.insert(0, (None, words.clone()));
                            }
                            _ => {}
                        }
                    }
                }
            }
            // `path("admin/", admin.site.urls)`: an included URLconf (`AdminSite.urls` is
            // the `(patterns, app_name, namespace)` triple `include()` returns).
            Expr::Attribute(a) if a.attr.as_str() == "urls" => {
                if let Some(r) = self.canon(&a.value) {
                    self.out.mounts.push(RawMount {
                        parent: None,
                        target: MountTarget::Ref(r),
                        prefix: Some(route.to_string()),
                        deps: vec![],
                        opaque: false,
                        whole_app: false,
                        unmeasured: false,
                        table: None,
                    });
                }
            }
            Expr::Name(_) | Expr::Attribute(_) => {
                if let Some(target) = self.canon(view) {
                    self.registration(target, None, "django", route, vec![], guards);
                }
            }
            _ => {}
        }
    }

    /// Applications mounted by a constructor, wherever its result goes: a Starlette
    /// `Mount("/v1", app=sub)` in a route list, a werkzeug
    /// `DispatcherMiddleware(app, {"/v1": admin})`. What the constructed object is
    /// itself served under is not followed, so the path is under an unknown prefix
    /// ([`UNKNOWN_PREFIX`]).
    fn lower_app_mounts(&mut self, c: &'t ast::ExprCall, locals: Option<&Locals>) {
        let under = |path: &str| format!("{UNKNOWN_PREFIX}/{path}");
        match super::practice::callee_name(&c.func) {
            Some("Mount") => {
                let Some(target) = arg(c, 1, "app") else {
                    return;
                };
                let path = self.path_value(arg(c, 0, "path")).unwrap_or_default();
                // [STRICT] What the mount is behind: as the route table that holds
                // it says ([`Lowerer::lower_starlette_routes`]). In no table that
                // was read, its own `middleware=`, and the application that holds
                // it, which is not known: that one's middleware runs for what is
                // mounted and was not read.
                let key = c as *const ast::ExprCall as usize;
                let table = self.table_mounts.get(&key).cloned().unwrap_or_else(|| {
                    let mut behind =
                        self.behind(&RawBehind::default(), c, keyword(c, "middleware"), "Mount");
                    behind.unread.push((
                        "the application whose route table holds `Mount(...)`".to_string(),
                        self.line(c),
                    ));
                    RawTableMount {
                        at: None,
                        behind,
                        listed: false,
                    }
                });
                self.mount_app(None, under(&path), target, locals, Some(table));
            }
            Some("DispatcherMiddleware") => match arg(c, 1, "mounts") {
                Some(Expr::Dict(d)) => {
                    for item in &d.items {
                        let path = match &item.key {
                            Some(k) => self.path_value(Some(k)).unwrap_or_default(),
                            None => UNKNOWN_PREFIX.to_string(),
                        };
                        self.mount_app(None, under(&path), &item.value, locals, None);
                    }
                }
                Some(_) => self.unfollowed_mount(None, UNKNOWN_PREFIX.to_string()),
                None => {}
            },
            _ => {}
        }
    }

    /// `target` is served under `prefix` on `parent` as a whole application. A name is
    /// the application it names (the linker says whether Drift reads it). A call may
    /// wrap one of its arguments (`WSGIMiddleware(flask_app)`) or build an application
    /// Drift cannot name (`make_app()`): its arguments are mounted, and the mount is
    /// recorded as not followed. Static files are no application.
    fn mount_app(
        &mut self,
        parent: Option<RawRef>,
        prefix: String,
        target: &Expr,
        locals: Option<&Locals>,
        table: Option<RawTableMount>,
    ) {
        let mount = |out: &mut RawFile, target: MountTarget| {
            // A mount Drift cannot follow says so, whatever it is behind, but where
            // its routes are listed in the table.
            let table = match target {
                MountTarget::Unfollowed => table.clone().filter(|t| t.listed),
                _ => table.clone(),
            };
            out.mounts.push(RawMount {
                parent: parent.clone(),
                target,
                prefix: Some(prefix.clone()),
                deps: vec![],
                opaque: false,
                whole_app: true,
                unmeasured: false,
                table: table.map(Box::new),
            });
        };
        match target {
            Expr::Call(inner) => {
                if super::practice::callee_name(&inner.func) == Some("StaticFiles") {
                    return;
                }
                let args = inner.arguments.args.iter();
                for a in args.chain(inner.arguments.keywords.iter().map(|k| &k.value)) {
                    if matches!(a, Expr::Name(_) | Expr::Attribute(_))
                        && let Some(r) = self.canon_in(a, locals)
                    {
                        mount(&mut self.out, MountTarget::Ref(r));
                    }
                }
                mount(&mut self.out, MountTarget::Unfollowed);
            }
            other => match self.canon_in(other, locals) {
                Some(r) => {
                    self.read_targets.insert(other as *const Expr as usize);
                    mount(&mut self.out, MountTarget::Ref(r))
                }
                None => mount(&mut self.out, MountTarget::Unfollowed),
            },
        }
    }

    /// A mount of an application Drift cannot name.
    fn unfollowed_mount(&mut self, parent: Option<RawRef>, prefix: String) {
        self.out.mounts.push(RawMount {
            parent,
            target: MountTarget::Unfollowed,
            prefix: Some(prefix),
            deps: vec![],
            opaque: false,
            whole_app: true,
            unmeasured: false,
            table: None,
        });
    }

    /// A wrapper applied to a view where it is registered, as
    /// [`RawRegistration::since_guards`] holds it: `f` is what is called with the
    /// view. A name (`login_required`), a call of a name (`jwt_required()`) with
    /// its arguments, or the words of anything else.
    fn wrapper_written(&self, f: &Expr, locals: Option<&Locals>) -> (Option<RawRef>, String) {
        let unread = || (None, crate::lower::practice::words(f));
        match f {
            Expr::Name(_) | Expr::Attribute(_) => match self.canon_in(f, locals) {
                Some(r) if !matches!(r.base, RawBase::Global(_)) => (Some(r), String::new()),
                _ => unread(),
            },
            Expr::Call(fc) if matches!(fc.func.as_ref(), Expr::Name(_) | Expr::Attribute(_)) => {
                match self.canon_in(&fc.func, locals) {
                    Some(r) if !matches!(r.base, RawBase::Global(_)) => (Some(r), args_shape(fc)),
                    _ => unread(),
                }
            }
            _ => unread(),
        }
    }

    fn registration(
        &mut self,
        target: RawRef,
        router: Option<RawRef>,
        adapter: &str,
        route: &str,
        methods: Vec<String>,
        guards: Vec<RawRef>,
    ) {
        self.out.registrations.push(RawRegistration {
            target,
            router,
            adapter: adapter.into(),
            route: route.to_string(),
            methods,
            guards,
            unmeasured: false,
            candidate: false,
            behind: RawBehind::default(),
            shapes: vec![],
            since_guards: vec![],
        });
    }

    // ------------------------------------------------------------------ calls anywhere

    /// Router mounts, registrations and hooks, wherever they are (often in an app factory).
    pub(crate) fn lower_adapters_anywhere(&mut self, body: &'t [Stmt]) {
        let mut f = CallFinder::default();
        for s in body {
            f.visit_stmt(s);
        }
        self.branched = std::mem::take(&mut f.branched);
        for &(c, func) in &f.calls {
            let locals = func.and_then(|n| f.local_imports.get(n));
            self.lower_adapter_call(c, func, locals);
        }
        // A `urlpatterns` that is not read may route any view the module names: each
        // imported name read as a value at module level is a registration Drift
        // cannot place (`ROUTES = {"orders": views.list_orders}` beside
        // `urlpatterns = [path(n, v) for n, v in ROUTES.items()]`).
        if self.unread_urlpatterns {
            let mut seen = BTreeSet::new();
            for &(e, func, call) in &f.uses {
                if func.is_some() {
                    continue;
                }
                let Some(mut target) = self.canon(e) else {
                    continue;
                };
                // `views.ReportView.as_view()` names the class; any other call is not
                // a view handed to a pattern.
                match target.member.strip_suffix(".as_view") {
                    Some(class) if call => target.member = class.to_string(),
                    _ if call => continue,
                    _ => {}
                }
                if matches!(target.base, RawBase::Import { .. }) && seen.insert(target.clone()) {
                    self.out.registrations.push(RawRegistration {
                        target,
                        router: None,
                        adapter: "django".into(),
                        route: UNKNOWN_PREFIX.to_string(),
                        methods: vec![],
                        guards: vec![],
                        unmeasured: true,
                        candidate: true,
                        behind: RawBehind::default(),
                        shapes: vec![],
                        since_guards: vec![],
                    });
                }
            }
        }
        // The module's own functions and classes read as values: what a table of
        // the module names ([`RawFile::value_defs`]).
        let mut value_defs = BTreeSet::new();
        for &(e, func, _) in &f.uses {
            let locals = func.and_then(|n| f.local_imports.get(n));
            if let Some(RawRef {
                base: RawBase::Local(n),
                ..
            }) = self.canon_in(e, locals)
                && self.defines(&n)
            {
                value_defs.insert(n);
            }
        }
        self.out.value_defs = value_defs.into_iter().collect();
        // A registration that is not placed may be handed any view the file names:
        // each import, `def` or class of the module that is read as a value, anywhere
        // in the file, but where a read registration took it. The linker keeps the
        // functions and view classes, and follows a table or a module of another
        // file (`ROUTES`, `getattr(views, name)`). The measured build listed none.
        if !self.unplaced.is_empty() {
            let mut targets = BTreeSet::new();
            for &(e, func, call) in &f.uses {
                if self.placed_views.contains(&(e as *const Expr as usize))
                    || self.read_targets.contains(&(e as *const Expr as usize))
                {
                    continue;
                }
                let locals = func.and_then(|n| f.local_imports.get(n));
                let Some(mut target) = self.canon_in(e, locals) else {
                    continue;
                };
                // A method called on the name reads the name (`ROUTES.items()`,
                // `View.as_view()`).
                if call {
                    match target.member.rfind('.') {
                        Some(dot) => target.member.truncate(dot),
                        None => continue,
                    }
                }
                let named = match &target.base {
                    RawBase::Import { .. } | RawBase::Star(_) => true,
                    RawBase::Local(n) => self.defines(n),
                    _ => false,
                };
                if named && !target.member.contains('(') {
                    targets.insert(target);
                }
            }
            for (router, adapter) in std::mem::take(&mut self.unplaced) {
                for target in &targets {
                    self.out.registrations.push(RawRegistration {
                        target: target.clone(),
                        router: router.clone(),
                        adapter: adapter.into(),
                        route: UNKNOWN_PREFIX.to_string(),
                        methods: vec![],
                        guards: vec![],
                        unmeasured: true,
                        candidate: true,
                        behind: RawBehind::default(),
                        shapes: vec![],
                        since_guards: vec![],
                    });
                }
            }
        }
        // What may hand a router on to a mount that is not read: every such name that
        // is an import or a router of this module, but the ones a read mount took.
        let mut uses: BTreeMap<(RawRef, bool), u32> = BTreeMap::new();
        for &(e, func, call) in &f.uses {
            if self.read_targets.contains(&(e as *const Expr as usize)) {
                continue;
            }
            let locals = func.and_then(|n| f.local_imports.get(n));
            let Some(r) = self.canon_in(e, locals) else {
                continue;
            };
            let router = match &r.base {
                RawBase::Import { .. } | RawBase::Star(_) => true,
                RawBase::Local(name) => {
                    self.out.routers.iter().any(|x| x.name == *name) || name.contains('.')
                }
                _ => false,
            };
            if router && !r.member.contains('(') {
                let line = self.line(e);
                let at = uses.entry((r, call)).or_insert(line);
                *at = (*at).min(line);
            }
        }
        // Modules or code reached by a name that is computed: what they mount is not
        // seen. The list to extend.
        let dynamic = f.sys_modules
            || f.calls.iter().any(|(c, _)| {
                self.dotted_of(&c.func).is_some_and(|d| {
                    ["importlib", "pkgutil", "runpy"]
                        .iter()
                        .any(|m| d.split('.').next() == Some(m))
                }) || matches!(c.func.as_ref(), Expr::Name(n)
                    if matches!(n.id.as_str(), "__import__" | "exec" | "eval"))
            });
        // The file's own namespace read as a table: every name in it is handed on. In
        // a function, `locals()` and `vars()` hold what the function imports.
        let namespace = |c: &ast::ExprCall, names: &[&str]| {
            c.arguments.args.is_empty()
                && c.arguments.keywords.is_empty()
                && matches!(c.func.as_ref(), Expr::Name(n) if names.contains(&n.id.as_str()))
        };
        self.out.uses_namespace = f.calls.iter().any(|&(c, func)| {
            namespace(c, &["globals"])
                || (func.is_none() && namespace(c, &["locals", "vars", "dir"]))
        });
        for &(c, func) in &f.calls {
            if let Some(locals) = func.and_then(|n| f.local_imports.get(n))
                && namespace(c, &["locals", "vars"])
            {
                for base in locals.values() {
                    let r = RawRef {
                        base: base.clone(),
                        member: String::new(),
                    };
                    uses.entry((r, false)).or_insert(self.line(c));
                }
            }
        }
        self.out.uses_all = dynamic || uses.len() > MAX_ROUTER_USES;
        self.out.router_uses = uses
            .into_iter()
            .take(MAX_ROUTER_USES)
            .map(|((on, call), line)| RawUse { on, call, line })
            .collect();
        // `init_hooks(app)` in `create_app()`: the helper's parameter is the factory's app.
        // An imported name whose every read as a value is an argument of a call:
        // the calls say all the file does with it (`handler = Mangum(app)`), so an
        // application imported from another file is read through them, not taken to
        // have gone anywhere. At most eight reads of a name, 64 passes a file.
        let mut value_reads: BTreeMap<RawRef, usize> = BTreeMap::new();
        for &(e, func, call) in &f.uses {
            if call || !matches!(e, Expr::Name(_)) {
                continue;
            }
            if let Some(r) = self.canon_in(e, func.and_then(|n| f.local_imports.get(n)))
                && matches!(r.base, RawBase::Import { .. })
            {
                *value_reads.entry(r).or_default() += 1;
            }
        }
        let mut imported: BTreeMap<RawRef, Vec<RawAppPass>> = BTreeMap::new();
        for &(c, func) in &f.calls {
            // A module-level application or router of the file passed to a function,
            // wherever the call is: to a helper that registers on its parameter, or
            // to code Drift does not read. The measured build recorded the passes of
            // a function's own locals only.
            let locals = func.and_then(|n| f.local_imports.get(n));
            // Not to a method Drift reads where it is called (`app.include_router(r)`).
            // (`ext.init_app(app)` hands the application to the extension: read
            // by what the extension is.)
            let read = matches!(c.func.as_ref(), Expr::Attribute(a)
                if READ_METHODS.contains(&a.attr.as_str()) && a.attr.as_str() != "init_app");
            if !read && let Some(callee) = self.canon_in(&c.func, locals) {
                let positional = c
                    .arguments
                    .args
                    .iter()
                    .enumerate()
                    .map(|(i, a)| (Some(i as u32), None, a));
                let named = c.arguments.keywords.iter().filter_map(|k| {
                    Some((None, Some(k.arg.as_ref()?.as_str().to_string()), &k.value))
                });
                for (index, keyword, a) in positional.chain(named) {
                    // Not a parameter of the function around.
                    let Expr::Name(name) = a else { continue };
                    if func
                        .and_then(|n| f.params.get(n))
                        .is_some_and(|ps| ps.contains(&name.id.as_str()))
                    {
                        continue;
                    }
                    let Some(from) = self.canon_in(a, locals) else {
                        continue;
                    };
                    let at = c as *const ast::ExprCall as usize;
                    // A `Mount(path, app=sub)` of a route table that was read is
                    // read as the mount it is ([`RawMount::table`]).
                    if self.table_mounts.get(&at).is_some_and(|t| t.at.is_some()) {
                        continue;
                    }
                    // An imported application bound again under its own name to
                    // what the call hands back (`from api import app`, `app =
                    // TokenMiddleware(app)`): the pass is of the import.
                    if let RawBase::Local(n) = &from.base
                        && from.member.is_empty()
                        && f.bound.get(&at) == Some(&n.as_str())
                        && func.is_none()
                        && let Some(import) = self.rebound_imports.get(n)
                    {
                        self.out.app_passes.push(RawAppPass {
                            from: RawRef {
                                base: import.clone(),
                                member: String::new(),
                            },
                            callee: callee.clone(),
                            index,
                            keyword,
                            line: self.line(c),
                            unmeasured: true,
                            used: true,
                        });
                        continue;
                    }
                    let object = matches!(&from.base, RawBase::Local(n)
                        if from.member.is_empty()
                            && self.out.routers.iter().any(|x| x.name == *n));
                    let pass = RawAppPass {
                        from: from.clone(),
                        callee: callee.clone(),
                        index,
                        keyword,
                        line: self.line(c),
                        unmeasured: true,
                        used: {
                            f.handed_on.contains(&at)
                                || f.bound.get(&at).is_some_and(|to| {
                                    *to == name.id.as_str() || SERVED_NAMES.contains(to)
                                })
                        },
                    };
                    if object {
                        self.out.app_passes.push(pass);
                    } else if matches!(from.base, RawBase::Import { .. }) && from.member.is_empty()
                    {
                        imported.entry(from).or_default().push(pass);
                    }
                }
            }
            let Some(func) = func else { continue };
            let Some(callee) = self
                .canon_in(&c.func, f.local_imports.get(func))
                .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }))
            else {
                continue;
            };
            let positional = c
                .arguments
                .args
                .iter()
                .enumerate()
                .map(|(i, a)| (Some(i as u32), None, a));
            let named =
                c.arguments.keywords.iter().filter_map(|k| {
                    Some((None, Some(k.arg.as_ref()?.as_str().to_string()), &k.value))
                });
            for (index, keyword, a) in positional.chain(named) {
                if !matches!(a, Expr::Name(_)) {
                    continue;
                }
                if let Some(from) = self
                    .receiver(a, Some(func), None)
                    .filter(|r| matches!(&r.base, RawBase::Local(n) if n == func))
                {
                    self.out.app_passes.push(RawAppPass {
                        from,
                        callee: callee.clone(),
                        index,
                        keyword,
                        line: self.line(c),
                        unmeasured: false,
                        used: false,
                    });
                }
            }
        }
        self.out.hands_back = f.hands_back.iter().map(|n| n.to_string()).collect();
        let mut kept = 0;
        for (from, passes) in imported {
            if value_reads.get(&from) == Some(&passes.len())
                && passes.len() <= 8
                && kept + passes.len() <= 64
            {
                kept += passes.len();
                self.out.app_passes.extend(passes);
            }
        }
        // `@app.before_request` on a function nested in an app factory.
        for (d, hook, func, branched) in f.nested_hooks {
            let Expr::Attribute(a) = &d.expression else {
                continue;
            };
            let Some(router) = self.receiver(&a.value, Some(func), f.local_imports.get(func))
            else {
                continue;
            };
            self.out.hooks.push(RawHook {
                router,
                hook: RawRef {
                    base: RawBase::Local(func.to_string()),
                    member: format!(".{hook}"),
                },
                app_wide: a.attr.as_str() == "before_app_request",
                middleware: false,
                conditional: branched,
                unmeasured: false,
            });
        }
        // Parameters of functions whose parameter is a receiver (`def init_hooks(app)`),
        // so a call passing an app can be matched to the parameter.
        // A module-level name bound to what a function returns, that the file then
        // registers on (`admin = make_app("admin")`, `admin.before_request(f)`).
        let registered: BTreeSet<&str> = self
            .out
            .mounts
            .iter()
            .filter_map(|m| m.parent.as_ref())
            .chain(self.out.hooks.iter().map(|h| &h.router))
            .chain(self.out.middlewares.iter().map(|m| &m.app))
            .chain(
                self.out
                    .registrations
                    .iter()
                    .filter_map(|g| g.router.as_ref()),
            )
            .filter_map(|r| match &r.base {
                RawBase::Local(n) if r.member.is_empty() => Some(n.as_str()),
                _ => None,
            })
            .collect();
        // What a function does with a local it registers on, beyond what is read.
        let registering: BTreeSet<(&str, &str)> = self
            .out
            .mounts
            .iter()
            .filter_map(|m| m.parent.as_ref())
            .chain(self.out.hooks.iter().map(|h| &h.router))
            .chain(self.out.middlewares.iter().map(|m| &m.app))
            .chain(
                self.out
                    .registrations
                    .iter()
                    .filter_map(|g| g.router.as_ref()),
            )
            .filter_map(|r| match &r.base {
                RawBase::Local(func) => Some((func.as_str(), r.member.strip_prefix('.')?)),
                _ => None,
            })
            .filter(|(_, var)| !var.contains(['.', '(']))
            .collect();
        let mut local_uses: BTreeMap<(RawRef, bool), u32> = BTreeMap::new();
        for &(e, func, call) in &f.uses {
            let (Some(func), Expr::Attribute(_)) = (func, e) else {
                continue;
            };
            let mut first = e;
            while let Expr::Attribute(a) = first {
                first = a.value.as_ref();
            }
            let Expr::Name(n) = first else { continue };
            if !registering.contains(&(func, n.id.as_str())) {
                continue;
            }
            let on = RawRef {
                base: RawBase::Local(func.to_string()),
                member: format!(".{}", written(e)),
            };
            let line = self.line(e);
            let at = local_uses.entry((on, call)).or_insert(line);
            *at = (*at).min(line);
        }
        let local_uses: Vec<RawUse> = local_uses
            .into_iter()
            .take(64)
            .map(|((on, call), line)| RawUse { on, call, line })
            .collect();
        let mut results = BTreeSet::new();
        for a in &f.assigns {
            let ([Expr::Name(n)], Expr::Call(c)) = (a.targets.as_slice(), a.value.as_ref()) else {
                continue;
            };
            if registered.contains(n.id.as_str())
                && !self.out.routers.iter().any(|x| x.name == n.id.as_str())
                && let Some(callee) = self
                    .canon(&c.func)
                    .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }))
            {
                results.insert((n.id.to_string(), callee));
            }
        }
        self.out.factory_results = results.into_iter().collect();
        self.out.local_uses = local_uses;
        let mut used: BTreeSet<&str> = BTreeSet::new();
        let locals = self
            .out
            .mounts
            .iter()
            .filter_map(|m| m.parent.as_ref())
            .chain(self.out.hooks.iter().map(|h| &h.router))
            .chain(
                self.out
                    .registrations
                    .iter()
                    .filter_map(|g| g.router.as_ref()),
            );
        for r in locals {
            if let RawBase::Local(func) = &r.base
                && let Some(var) = r.member.strip_prefix('.')
                && let Some((name, params)) = f.params.get_key_value(func.as_str())
                && params.contains(&var)
            {
                used.insert(name);
            }
        }
        for name in used {
            let params = f.params[name].iter().map(|p| p.to_string()).collect();
            self.out.factory_params.push((name.to_string(), params));
        }
    }

    /// The router or app a call is made on. A name bound in an enclosing module-level
    /// function and not at module level (`app` in `create_app()`) is that function's
    /// local, `create_app.app`: a root of its own.
    fn receiver(&self, e: &Expr, func: Option<&str>, locals: Option<&Locals>) -> Option<RawRef> {
        let r = self.canon_in(e, locals)?;
        match (&r.base, func, e) {
            (RawBase::Global(n), Some(f), Expr::Name(_)) if !stdlib::is_builtin(n) => {
                Some(RawRef {
                    base: RawBase::Local(f.to_string()),
                    member: format!(".{n}"),
                })
            }
            (RawBase::Global(_) | RawBase::Star(_), _, _) => None,
            _ => Some(r),
        }
    }

    /// A reference inside a function, where its local imports
    /// (`from CTFd.views import views` in `create_app()`) shadow module names.
    fn canon_in(&self, e: &Expr, locals: Option<&Locals>) -> Option<RawRef> {
        canon_with(e, &|n| {
            locals
                .and_then(|l| l.get(n).cloned())
                .or_else(|| Some(self.module_base(n)))
        })
    }

    /// `name` is a `def` or a class of the module.
    fn defines(&self, name: &str) -> bool {
        self.functions.contains(name)
            || self
                .out
                .symbols
                .iter()
                .any(|s| s.name == name && s.kind == SymbolKind::Class)
    }

    /// The view a registration call names, when it is one Drift can name where the
    /// call is written: an import (`views.lease_job`) or a `def` or class of the
    /// module. None for a loop variable, a parameter, a table entry, a call: the
    /// registration is then not placed, and the expression is not a name that a
    /// registration which is not read may be handed.
    fn view_ref(&mut self, view: Option<&Expr>, locals: Option<&Locals>) -> Option<RawRef> {
        let view = view?;
        let r = self.canon_in(view, locals)?;
        let named = match &r.base {
            RawBase::Import { .. } | RawBase::Star(_) => true,
            RawBase::Local(n) => self.defines(n),
            _ => false,
        };
        if named {
            self.placed_views.insert(view as *const Expr as usize);
        }
        named.then_some(r)
    }

    /// A route decorator called as a function (`app.route(rule)(view)`,
    /// `router.post(path)(fn)`): the registration of `view` on the router, whichever
    /// framework it is of (the linker says; a receiver that is no router gives
    /// nothing). The measured build read decorators only.
    fn lower_route_call(
        &mut self,
        c: &'t ast::ExprCall,
        func: Option<&str>,
        locals: Option<&Locals>,
    ) {
        let Expr::Call(inner) = c.func.as_ref() else {
            return;
        };
        let Expr::Attribute(a) = inner.func.as_ref() else {
            return;
        };
        let verb = a.attr.as_str();
        if !(HTTP_VERBS.contains(&verb) || matches!(verb, "route" | "api_route")) {
            return;
        }
        let ([view], true) = (c.arguments.args.as_ref(), c.arguments.keywords.is_empty()) else {
            return;
        };
        let Some(parent) = self.receiver(&a.value, func, locals) else {
            return;
        };
        let path = self.path_value(arg(inner, 0, "path").or_else(|| keyword(inner, "rule")));
        match (self.view_ref(Some(view), locals), path) {
            (Some(target), Some(route)) => {
                let methods = match verb {
                    "route" | "api_route" => upper_methods(keyword(inner, "methods")),
                    v => vec![v.to_ascii_uppercase()],
                };
                self.out.registrations.push(RawRegistration {
                    target,
                    router: Some(parent),
                    adapter: OWN_ADAPTER.into(),
                    route,
                    methods: if methods.is_empty() {
                        vec!["GET".into()]
                    } else {
                        methods
                    },
                    guards: vec![],
                    unmeasured: true,
                    candidate: false,
                    behind: RawBehind::default(),
                    shapes: vec![],
                    since_guards: vec![],
                });
            }
            _ => {
                self.unplaced.insert((Some(parent), OWN_ADAPTER));
            }
        }
    }

    fn lower_adapter_call(
        &mut self,
        c: &'t ast::ExprCall,
        func: Option<&str>,
        locals: Option<&Locals>,
    ) {
        // `app.middleware("http")(function)`: the decorator, called. Recorded twice: as a
        // middleware of the application object (what serves a route), and as a hook of
        // the application (what may guard its routes).
        if let Expr::Call(inner) = c.func.as_ref()
            && let Expr::Attribute(ia) = inner.func.as_ref()
            && ia.attr.as_str() == "middleware"
            && let Some(app) = self.receiver(&ia.value, func, locals)
        {
            self.read_targets
                .insert(inner as *const ast::ExprCall as usize);
            let function = c.arguments.args.first();
            if let Some(given) = function {
                let hook = self.canon_in(given, locals).unwrap_or_else(|| RawRef {
                    base: RawBase::Global(crate::lower::practice::words(given)),
                    member: String::new(),
                });
                self.out.hooks.push(RawHook {
                    router: app.clone(),
                    hook,
                    app_wide: false,
                    middleware: true,
                    conditional: false,
                    unmeasured: false,
                });
            }
            self.out.middlewares.push(RawMiddleware {
                app,
                what: function.and_then(|t| self.canon_in(t, locals)),
                class: false,
                text: format!(
                    "{}(...)({})",
                    written(&inner.func),
                    function.map_or("...".to_string(), written)
                ),
                line: self.line(c),
            });
        }
        let Expr::Attribute(a) = c.func.as_ref() else {
            self.lower_app_mounts(c, locals);
            self.lower_route_call(c, func, locals);
            return;
        };
        let parent = self.receiver(&a.value, func, locals);
        match a.attr.as_str() {
            "add_middleware" => {
                if let Some(app) = parent {
                    let class = c
                        .arguments
                        .args
                        .first()
                        .or_else(|| keyword(c, "middleware_class"));
                    // Also a hook of the application: one that cannot be named is kept,
                    // by its words, since it may be the guard.
                    if let Some(given) = class {
                        let hook = self.canon_in(given, locals).unwrap_or_else(|| RawRef {
                            base: RawBase::Global(crate::lower::practice::words(given)),
                            member: String::new(),
                        });
                        self.out.hooks.push(RawHook {
                            router: app.clone(),
                            hook,
                            app_wide: false,
                            middleware: true,
                            conditional: false,
                            unmeasured: false,
                        });
                    }
                    self.out.middlewares.push(RawMiddleware {
                        app,
                        what: class.and_then(|t| self.canon_in(t, locals)),
                        class: true,
                        text: format!(
                            "{}({})",
                            written(&c.func),
                            class.map_or("...".to_string(), written)
                        ),
                        line: self.line(c),
                    });
                }
            }
            // The call alone, its result kept or passed on: what it is given is not read.
            "middleware"
                if !self
                    .read_targets
                    .contains(&(c as *const ast::ExprCall as usize)) =>
            {
                if let Some(app) = parent {
                    self.out.middlewares.push(RawMiddleware {
                        app,
                        what: None,
                        class: false,
                        text: format!("{}(...)", written(&c.func)),
                        line: self.line(c),
                    });
                }
            }
            // Starlette and FastAPI: `app.mount("/v1", sub)` serves the application
            // `sub` under the path.
            // A mount under what is written as a URL with a scheme
            // (`session.mount("https://", adapter)`, a transport of an HTTP client)
            // serves nothing: a path an application is served under has none.
            "mount" => {
                if let Some(target) = arg(c, 1, "app") {
                    let prefix = self.path_value(arg(c, 0, "path")).unwrap_or_default();
                    if !prefix.contains("://") {
                        self.mount_app(parent, prefix, target, locals, None);
                    }
                }
            }
            // An extension given its application after it is built
            // (`api = Api(); api.init_app(app)`): what `api` serves is the app's.
            "init_app" => {
                if let (Some(target), Some(app)) = (
                    parent,
                    arg(c, 0, "app").and_then(|t| self.receiver(t, func, locals)),
                ) {
                    self.out.mounts.push(RawMount {
                        parent: Some(app),
                        target: MountTarget::Ref(target),
                        prefix: None,
                        deps: vec![],
                        opaque: false,
                        whole_app: false,
                        unmeasured: false,
                        table: None,
                    });
                }
            }
            "include_router" => {
                let Some(target) = arg(c, 0, "router").and_then(|t| {
                    self.read_targets.insert(t as *const Expr as usize);
                    self.canon_in(t, locals)
                }) else {
                    return;
                };
                // Dependencies that are not a list written here, or one with an element
                // that is no dependency Drift reads, or options spread into the call:
                // what the mount adds is not all known.
                let dependencies = keyword(c, "dependencies");
                // (The mount says so itself: what could not be read is not kept as a
                // dependency beside it.)
                let mut deps = self.deps_list(dependencies);
                deps.retain(|d| !matches!(d, RawDep::Unread(_)));
                let opaque = spreads(c)
                    || dependencies
                        .is_some_and(|d| elements(d).is_none_or(|e| e.len() != deps.len()));
                // No prefix written, but options spread into the call may hold one.
                let prefix = match self.path_value(keyword(c, "prefix")) {
                    None if spreads(c) => UNKNOWN_PREFIX.to_string(),
                    prefix => prefix.unwrap_or_default(),
                };
                self.out.mounts.push(RawMount {
                    parent,
                    target: MountTarget::Ref(target),
                    prefix: Some(prefix),
                    deps,
                    opaque,
                    whole_app: false,
                    unmeasured: false,
                    table: None,
                });
            }
            "register_blueprint" | "add_namespace" => {
                let Some(target) = arg(c, 0, "blueprint").and_then(|t| {
                    self.read_targets.insert(t as *const Expr as usize);
                    self.canon_in(t, locals)
                }) else {
                    return;
                };
                let prefix = if a.attr.as_str() == "add_namespace" {
                    self.path_value(arg(c, 1, "path"))
                } else {
                    self.path_value(keyword(c, "url_prefix"))
                };
                let prefix = match prefix {
                    None if spreads(c) => Some(UNKNOWN_PREFIX.to_string()),
                    prefix => prefix,
                };
                self.out.mounts.push(RawMount {
                    parent,
                    target: MountTarget::Ref(target),
                    prefix,
                    deps: vec![],
                    opaque: false,
                    whole_app: false,
                    unmeasured: false,
                    table: None,
                });
            }
            "add_api_route" => {
                let endpoint = arg(c, 1, "endpoint");
                if self.view_ref(endpoint, locals).is_none() && (endpoint.is_some() || spreads(c)) {
                    self.unplaced.insert((parent.clone(), "fastapi"));
                }
                let (Some(path), Some(endpoint)) = (
                    self.path_value(arg(c, 0, "path")),
                    endpoint.and_then(|t| self.canon_in(t, locals)),
                ) else {
                    return;
                };
                let guards = self
                    .deps_list(keyword(c, "dependencies"))
                    .into_iter()
                    .filter_map(|d| match d {
                        RawDep::Direct(r) | RawDep::Instance(r, _) => Some(r),
                        RawDep::Alias(_)
                        | RawDep::Optional(_)
                        | RawDep::Unread(_)
                        | RawDep::Gives(_) => None,
                    })
                    .collect();
                let methods = upper_methods(keyword(c, "methods"));
                self.registration(endpoint, parent, "fastapi", &path, methods, guards);
            }
            "add_url_rule" => {
                // The view: a function, or `View.as_view(...)` of a class, and since
                // the measured build what is wrapped around it
                // (`view_func=login_required(view)`, `jwt_required()(view)`).
                let mut wrappers: Vec<(Option<RawRef>, String)> = Vec::new();
                let mut written = arg(c, 2, "view_func");
                let view = loop {
                    match written {
                        Some(Expr::Call(vc)) => match vc.func.as_ref() {
                            Expr::Attribute(x) if x.attr.as_str() == "as_view" => {
                                break Some(x.value.as_ref());
                            }
                            f if vc.arguments.args.len() == 1
                                && vc.arguments.keywords.is_empty()
                                && wrappers.len() < 8 =>
                            {
                                wrappers.push(self.wrapper_written(f, locals));
                                written = vc.arguments.args.first();
                            }
                            _ => break None,
                        },
                        v => break v,
                    }
                };
                // No view Drift names (a loop variable, a table entry, none at all:
                // the endpoint's function is bound elsewhere): not placed.
                if self.view_ref(view, locals).is_none() {
                    self.unplaced.insert((parent.clone(), "flask"));
                }
                let Some(path) = self.path_value(arg(c, 0, "rule")) else {
                    return;
                };
                let placed = view;
                let Some(view) = view.and_then(|v| self.canon_in(v, locals)) else {
                    return;
                };
                let methods = upper_methods(keyword(c, "methods"));
                self.registration(view, parent, "flask", &path, methods, vec![]);
                // A view with something wrapped around it was not placed by the
                // measured build.
                if !wrappers.is_empty()
                    && let Some(r) = self.out.registrations.last_mut()
                {
                    r.unmeasured = true;
                    r.since_guards = wrappers;
                    if let Some(v) = placed {
                        self.placed_views.insert(v as *const Expr as usize);
                    }
                }
            }
            "add_resource" => {
                let first = c.arguments.args.first();
                // A resource that is not a class named here (a loop variable), or a
                // path that is not written: not placed. A first argument that is a
                // string is no resource (another library's `add_resource`).
                let resource = first.filter(|t| string_value(t).is_none());
                if resource.is_some()
                    && (self.view_ref(resource, locals).is_none()
                        || c.arguments.args.get(1).and_then(string_value).is_none())
                {
                    self.unplaced.insert((parent.clone(), "flask_restx"));
                }
                let (Some(target), Some(path)) = (
                    first.and_then(|t| self.canon_in(t, locals)),
                    c.arguments.args.get(1).and_then(string_value),
                ) else {
                    return;
                };
                if let Some(t) = first {
                    self.placed_views.insert(t as *const Expr as usize);
                }
                self.registration(target, parent, "flask_restx", &path, vec![], vec![]);
            }
            "register" if c.arguments.args.len() >= 2 => {
                let viewset = c.arguments.args.get(1);
                if parent.is_some()
                    && (c.arguments.args.first().and_then(string_value).is_none()
                        || self.view_ref(viewset, locals).is_none())
                {
                    self.unplaced.insert((parent.clone(), "drf"));
                }
                let (Some(prefix), Some(target)) = (
                    c.arguments.args.first().and_then(string_value),
                    viewset.and_then(|t| self.canon_in(t, locals)),
                ) else {
                    return;
                };
                if parent.is_some() {
                    if let Some(t) = viewset {
                        self.placed_views.insert(t as *const Expr as usize);
                    }
                    let route = strip_regex_anchors(&prefix);
                    self.registration(target, parent, "drf", &route, vec![], vec![]);
                }
            }
            hook if BEFORE_HOOKS.contains(&hook) => {
                if let (Some(router), Some(given)) = (parent, c.arguments.args.first()) {
                    // What is given and is no name (`HOOKS["session"]`, `strict if X
                    // else lenient`, `pick_hook()`) is kept by its words: it may be
                    // the guard.
                    let named = match given {
                        Expr::Name(_) | Expr::Attribute(_) => self.canon_in(given, locals),
                        _ => None,
                    };
                    let unmeasured = named.is_none();
                    let h = named.unwrap_or_else(|| RawRef {
                        base: RawBase::Global(crate::lower::practice::words(given)),
                        member: String::new(),
                    });
                    self.out.hooks.push(RawHook {
                        router,
                        hook: h,
                        app_wide: hook == "before_app_request",
                        middleware: false,
                        conditional: self
                            .branched
                            .contains(&(c as *const ast::ExprCall as usize)),
                        unmeasured,
                    });
                }
            }
            _ => {}
        }
    }
}

/// What stands in the brackets of a generic class is a type: a CapWords name
/// (`Rule`, `models.Rule`), or several.
fn type_argument(e: &Expr) -> bool {
    let capwords = |n: &str| {
        n.starts_with(|c: char| c.is_ascii_uppercase())
            && n.contains(|c: char| c.is_ascii_lowercase())
    };
    match e {
        Expr::Name(n) => capwords(n.id.as_str()),
        Expr::Attribute(a) => capwords(a.attr.as_str()),
        Expr::Tuple(t) => !t.elts.is_empty() && t.elts.iter().all(type_argument),
        Expr::Subscript(s) => type_argument(&s.value),
        _ => false,
    }
}

/// Starlette's application class, as it is imported.
const STARLETTE_APPS: &[&str] = &["starlette.applications.Starlette", "starlette.Starlette"];

/// Starlette's router class: a route table with its own middleware, served where it
/// is mounted.
const STARLETTE_ROUTERS: &[&str] = &["starlette.routing.Router"];

/// Module-level names a server is pointed at (`gunicorn pkg.wsgi:application`): what
/// is bound to one is served ([`RawAppPass::used`]).
const SERVED_NAMES: &[&str] = &[
    "app",
    "application",
    "asgi",
    "asgi_app",
    "wsgi",
    "wsgi_app",
    "handler",
    "server",
];

/// Every `return` of the function's own body hands back one parameter of the
/// function, the same one, and there is one (`def configure(app): ...; return app`).
fn hands_back_parameter(f: &ast::StmtFunctionDef) -> bool {
    fn returns<'x>(body: &'x [Stmt], out: &mut Vec<Option<&'x Expr>>) {
        for s in body {
            match s {
                Stmt::Return(r) => out.push(r.value.as_deref()),
                Stmt::If(i) => {
                    returns(&i.body, out);
                    for c in &i.elif_else_clauses {
                        returns(&c.body, out);
                    }
                }
                Stmt::For(x) => {
                    returns(&x.body, out);
                    returns(&x.orelse, out);
                }
                Stmt::While(x) => {
                    returns(&x.body, out);
                    returns(&x.orelse, out);
                }
                Stmt::With(x) => returns(&x.body, out),
                Stmt::Try(t) => {
                    returns(&t.body, out);
                    for h in &t.handlers {
                        let ast::ExceptHandler::ExceptHandler(h) = h;
                        returns(&h.body, out);
                    }
                    returns(&t.orelse, out);
                    returns(&t.finalbody, out);
                }
                Stmt::Match(m) => {
                    for c in &m.cases {
                        returns(&c.body, out);
                    }
                }
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    returns(&f.body, &mut out);
    let params: Vec<&str> = f.parameters.iter().map(|p| p.name().as_str()).collect();
    let mut names = out.iter().map(|r| match r {
        Some(Expr::Name(n)) if params.contains(&n.id.as_str()) => Some(n.id.as_str()),
        _ => None,
    });
    match names.next() {
        Some(Some(first)) => names.all(|n| n == Some(first)),
        _ => false,
    }
}

/// Every call expression in the file, in source order, with the module-level function
/// it is in; and hook decorators on functions nested in a module-level function.
#[derive(Default)]
pub(super) struct CallFinder<'a> {
    pub(super) calls: Vec<(&'a ast::ExprCall, Option<&'a str>)>,
    /// Every name or dotted name read as a value, with the function it is in: what a
    /// router can be handed on through. Not the receiver of a method call, the name
    /// of a function called, or a decorator: those use the name where it is.
    /// The last is whether the name is the method called (`app.frobnicate` in
    /// `app.frobnicate()`), for a method that is not in [`READ_METHODS`].
    uses: Vec<(&'a Expr, Option<&'a str>, bool)>,
    /// `sys.modules` is read.
    sys_modules: bool,
    /// The parameter names of the functions around: a name that is one is the
    /// function's own, not the module's.
    shadow: Vec<Vec<&'a str>>,
    /// Every assignment statement.
    pub(super) assigns: Vec<&'a ast::StmtAssign>,
    /// (decorator, nested function, enclosing module-level function, under a branch)
    nested_hooks: Vec<(&'a ast::Decorator, &'a str, &'a str, bool)>,
    /// How many branches, loops and `try` statements are around.
    branch: usize,
    /// The calls made under one (by address).
    branched: BTreeSet<usize>,
    /// The calls whose value is handed to another call as an argument or returned
    /// (by address), and those bound to a name, with the name.
    handed_on: BTreeSet<usize>,
    bound: BTreeMap<usize, &'a str>,
    /// The module-level functions whose every `return` hands back one of their own
    /// parameters ([`RawFile::hands_back`]).
    hands_back: BTreeSet<&'a str>,
    /// Positional parameter names of module-level functions.
    params: BTreeMap<&'a str, Vec<&'a str>>,
    /// Names imported inside each module-level function.
    local_imports: BTreeMap<&'a str, Locals>,
    func: Option<&'a str>,
    /// Inside a class body (its methods are not module-level functions).
    in_class: usize,
}

/// Names bound by imports inside a function.
type Locals = BTreeMap<String, RawBase>;

impl<'a> Visitor<'a> for CallFinder<'a> {
    fn visit_stmt(&mut self, s: &'a Stmt) {
        let branch = matches!(
            s,
            Stmt::If(_) | Stmt::For(_) | Stmt::While(_) | Stmt::Try(_) | Stmt::Match(_)
        );
        self.branch += usize::from(branch);
        self.visit_statement(s);
        self.branch -= usize::from(branch);
    }

    fn visit_decorator(&mut self, d: &'a ast::Decorator) {
        if !is_dotted(&d.expression) {
            self.visit_expr(&d.expression);
        }
    }

    fn visit_expr(&mut self, e: &'a Expr) {
        self.visit_expression(e);
    }
}

impl<'a> CallFinder<'a> {
    fn visit_statement(&mut self, s: &'a Stmt) {
        if let Stmt::Assign(a) = s {
            self.assigns.push(a);
        }
        match s {
            Stmt::Assign(a) => {
                if let ([Expr::Name(n)], Expr::Call(c)) = (a.targets.as_slice(), a.value.as_ref()) {
                    self.bound
                        .insert(c as *const ast::ExprCall as usize, n.id.as_str());
                }
            }
            Stmt::Return(r) => {
                if let Some(Expr::Call(c)) = r.value.as_deref() {
                    self.handed_on.insert(c as *const ast::ExprCall as usize);
                }
            }
            _ => {}
        }
        if let Stmt::FunctionDef(f) = s
            && self.func.is_none()
            && self.in_class == 0
            && hands_back_parameter(f)
        {
            self.hands_back.insert(f.name.as_str());
        }
        if let Stmt::FunctionDef(f) = s {
            match self.func {
                None => {
                    // Decorators belong to the enclosing scope, the body to the function.
                    for d in &f.decorator_list {
                        self.visit_decorator(d);
                    }
                    self.func = Some(f.name.as_str());
                    let p = &f.parameters;
                    if self.in_class == 0 {
                        self.params.entry(f.name.as_str()).or_insert_with(|| {
                            p.posonlyargs
                                .iter()
                                .chain(&p.args)
                                .map(|a| a.parameter.name.as_str())
                                .collect()
                        });
                    }
                    visitor::walk_parameters(self, &f.parameters);
                    if let Some(r) = &f.returns {
                        self.visit_expr(r);
                    }
                    self.shadow.push(parameter_names(&f.parameters));
                    self.visit_body(&f.body);
                    self.shadow.pop();
                    self.func = None;
                    return;
                }
                Some(outer) => {
                    for d in &f.decorator_list {
                        if let Expr::Attribute(a) = &d.expression
                            && BEFORE_HOOKS.contains(&a.attr.as_str())
                        {
                            self.nested_hooks
                                .push((d, f.name.as_str(), outer, self.branch > 0));
                        }
                    }
                    for d in &f.decorator_list {
                        self.visit_decorator(d);
                    }
                    visitor::walk_parameters(self, &f.parameters);
                    if let Some(r) = &f.returns {
                        self.visit_expr(r);
                    }
                    self.shadow.push(parameter_names(&f.parameters));
                    self.visit_body(&f.body);
                    self.shadow.pop();
                    return;
                }
            }
        }
        if let Stmt::ClassDef(_) = s
            && self.func.is_none()
        {
            self.in_class += 1;
            visitor::walk_stmt(self, s);
            self.in_class -= 1;
            return;
        }
        if let Some(func) = self.func {
            let locals = self.local_imports.entry(func).or_default();
            match s {
                // A name the function binds is the function's own, also where the
                // module binds the same name (`app = FastAPI(...)` in `create_app()`
                // and `app = create_app()` below it): never the module's.
                Stmt::Assign(a) => {
                    for t in &a.targets {
                        if let Expr::Name(n) = t {
                            locals
                                .entry(n.id.to_string())
                                .or_insert_with(|| RawBase::Global(n.id.to_string()));
                        }
                    }
                }
                Stmt::Import(i) => {
                    for a in &i.names {
                        let full = a.name.as_str();
                        let (bound, spec) = match &a.asname {
                            Some(as_) => (as_.as_str(), full),
                            None => {
                                let top = full.split('.').next().unwrap_or(full);
                                (top, top)
                            }
                        };
                        locals.insert(
                            bound.to_string(),
                            RawBase::Import {
                                spec: spec.to_string(),
                                name: "*".into(),
                            },
                        );
                    }
                }
                Stmt::ImportFrom(i) => {
                    let spec = from_spec(i);
                    for a in i.names.iter().filter(|a| a.name.as_str() != "*") {
                        let bound = a.asname.as_ref().unwrap_or(&a.name).as_str();
                        locals.insert(
                            bound.to_string(),
                            RawBase::Import {
                                spec: spec.clone(),
                                name: a.name.as_str().to_string(),
                            },
                        );
                    }
                }
                _ => {}
            }
        }
        visitor::walk_stmt(self, s);
    }

    fn visit_expression(&mut self, e: &'a Expr) {
        match e {
            Expr::Call(c) => {
                self.calls.push((c, self.func));
                if self.branch > 0 {
                    self.branched.insert(c as *const ast::ExprCall as usize);
                }
                for a in c
                    .arguments
                    .args
                    .iter()
                    .chain(c.arguments.keywords.iter().map(|k| &k.value))
                {
                    if let Expr::Call(inner) = a {
                        self.handed_on
                            .insert(inner as *const ast::ExprCall as usize);
                    }
                }
                match c.func.as_ref() {
                    Expr::Name(_) => {}
                    Expr::Attribute(a) if is_dotted(&a.value) => {
                        if !READ_METHODS.contains(&a.attr.as_str()) && !self.shadowed(&a.value) {
                            self.uses.push((c.func.as_ref(), self.func, true));
                        }
                    }
                    callee => self.visit_expr(callee),
                }
                let args = c.arguments.args.iter();
                for a in args.chain(c.arguments.keywords.iter().map(|k| &k.value)) {
                    self.visit_expr(a);
                }
                return;
            }
            Expr::Name(n) if n.ctx.is_load() => {
                if !self.shadowed(e) {
                    self.uses.push((e, self.func, false));
                }
                return;
            }
            // Read or assigned: `app.root_path = "/api"` is a use of `app` too.
            Expr::Attribute(a) if is_dotted(e) => {
                self.sys_modules |= a.attr.as_str() == "modules"
                    && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "sys");
                if !self.shadowed(e) {
                    self.uses.push((e, self.func, false));
                }
                return;
            }
            Expr::Lambda(l) => {
                if let Some(p) = &l.parameters {
                    visitor::walk_parameters(self, p);
                    self.shadow.push(parameter_names(p));
                } else {
                    self.shadow.push(Vec::new());
                }
                self.visit_expr(&l.body);
                self.shadow.pop();
                return;
            }
            _ => {}
        }
        visitor::walk_expr(self, e);
    }
}

impl CallFinder<'_> {
    /// The first name of the dotted name `e` is a parameter of a function around.
    fn shadowed(&self, e: &Expr) -> bool {
        let mut at = e;
        while let Expr::Attribute(a) = at {
            at = a.value.as_ref();
        }
        matches!(at, Expr::Name(n) if self.shadow.iter().flatten().any(|p| *p == n.id.as_str()))
    }
}

/// Every name a function's parameters bind.
fn parameter_names(p: &ast::Parameters) -> Vec<&str> {
    p.iter().map(|a| a.name().as_str()).collect()
}

/// `a` or `a.b.c`: names and nothing else.
fn is_dotted(e: &Expr) -> bool {
    match e {
        Expr::Name(_) => true,
        Expr::Attribute(a) => is_dotted(&a.value),
        _ => false,
    }
}

/// A class body that declares an abstract method (`@abstractmethod`, also stacked
/// under `@property` or `@classmethod`) or is a Django abstract model or abstract
/// graphene type (`class Meta: abstract = True`).
fn is_abstract_body(body: &[Stmt], dotted_of: &dyn Fn(&Expr) -> Option<String>) -> bool {
    body.iter().any(|stmt| match stmt {
        Stmt::FunctionDef(f) => f.decorator_list.iter().any(|d| {
            let e = match &d.expression {
                Expr::Call(c) => c.func.as_ref(),
                e => e,
            };
            matches!(
                dotted_of(e).as_deref(),
                Some(
                    "abc.abstractmethod"
                        | "abc.abstractproperty"
                        | "abc.abstractclassmethod"
                        | "abc.abstractstaticmethod"
                )
            )
        }),
        Stmt::ClassDef(m) if m.name.as_str() == "Meta" => m.body.iter().any(|s| {
            matches!(s, Stmt::Assign(a)
                if matches!(a.targets.as_slice(), [Expr::Name(n)] if n.id.as_str() == "abstract")
                    && matches!(a.value.as_ref(), Expr::BooleanLiteral(b) if b.value))
        }),
        _ => false,
    })
}

/// Calls of sibling methods through `self` or `cls` (`self.refresh()`) in one method's
/// body; a nested function or class is not looked into.
struct SelfCalls<'n> {
    names: &'n BTreeSet<&'n str>,
    found: BTreeSet<String>,
}

impl<'a> ruff_python_ast::visitor::Visitor<'a> for SelfCalls<'_> {
    fn visit_stmt(&mut self, s: &'a Stmt) {
        match s {
            Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {}
            _ => ruff_python_ast::visitor::walk_stmt(self, s),
        }
    }

    fn visit_expr(&mut self, e: &'a Expr) {
        if let Expr::Call(c) = e
            && let Expr::Attribute(a) = c.func.as_ref()
            && matches!(a.value.as_ref(), Expr::Name(n) if matches!(n.id.as_str(), "self" | "cls"))
            && self.names.contains(a.attr.as_str())
        {
            self.found.insert(a.attr.to_string());
        }
        ruff_python_ast::visitor::walk_expr(self, e);
    }
}

/// The call spreads arguments Drift does not read into its keywords or positions
/// (`f(x, **options)`, `f(*args)`).
fn spreads(c: &ast::ExprCall) -> bool {
    c.arguments.keywords.iter().any(|k| k.arg.is_none())
        || c.arguments.args.iter().any(|a| a.is_starred_expr())
}

/// The path segment that stands for a prefix Drift could not read (a variable, options
/// spread into a call, a mount that was not followed): `/?/jobs/lease` is served at
/// some path that ends in `/jobs/lease`, never known to be at `/jobs/lease`.
pub(crate) const UNKNOWN_PREFIX: &str = "?";

/// The adapter of a registration whose call does not say which framework its
/// router is of (`app.route(rule)(view)`): the router's own, which the linker reads.
pub(crate) const OWN_ADAPTER: &str = "?";

/// What a class's methods bind on `self` (`self.x = ...`, `self.x += ...`, a
/// `for`, `with` or tuple target, at any depth), how many statements each, the
/// plain names they bind, and whether one calls `setattr(self, ...)`.
#[derive(Default)]
struct SelfWrites<'b> {
    attrs: BTreeMap<&'b str, usize>,
    names: BTreeMap<&'b str, usize>,
    any_setattr: bool,
}

impl<'b> SelfWrites<'b> {
    fn of(body: impl Iterator<Item = &'b Stmt>) -> Self {
        let mut w = SelfWrites::default();
        for st in body {
            ruff_python_ast::visitor::Visitor::visit_stmt(&mut w, st);
        }
        w
    }

    fn target(&mut self, e: &'b Expr) {
        match e {
            Expr::Attribute(a) if matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self") =>
            {
                *self.attrs.entry(a.attr.as_str()).or_default() += 1;
            }
            Expr::Name(n) => *self.names.entry(n.id.as_str()).or_default() += 1,
            Expr::Tuple(t) => t.elts.iter().for_each(|x| self.target(x)),
            Expr::List(l) => l.elts.iter().for_each(|x| self.target(x)),
            Expr::Starred(s) => self.target(&s.value),
            _ => {}
        }
    }
}

impl<'b> ruff_python_ast::visitor::Visitor<'b> for SelfWrites<'b> {
    fn visit_stmt(&mut self, st: &'b Stmt) {
        match st {
            Stmt::Assign(a) => a.targets.iter().for_each(|t| self.target(t)),
            Stmt::AugAssign(a) => self.target(&a.target),
            Stmt::AnnAssign(a) if a.value.is_some() => self.target(&a.target),
            Stmt::For(f) => self.target(&f.target),
            Stmt::With(w) => w
                .items
                .iter()
                .filter_map(|i| i.optional_vars.as_deref())
                .for_each(|t| self.target(t)),
            _ => {}
        }
        ruff_python_ast::visitor::walk_stmt(self, st);
    }

    fn visit_expr(&mut self, e: &'b Expr) {
        match e {
            Expr::Named(n) => self.target(&n.target),
            Expr::Call(c)
                if matches!(c.func.as_ref(), Expr::Name(f) if f.id.as_str() == "setattr")
                    && matches!(c.arguments.args.first(), Some(Expr::Name(n)) if n.id.as_str() == "self") =>
            {
                self.any_setattr = true;
            }
            _ => {}
        }
        ruff_python_ast::visitor::walk_expr(self, e);
    }
}
