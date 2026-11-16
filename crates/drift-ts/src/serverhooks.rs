//! What runs before the routes of SvelteKit and Nitro, where a file of the
//! package says it: SvelteKit's `hooks.server` `handle` (and the hooks a
//! `sequence(...)` of `@sveltejs/kit/hooks` chains), a Nitro server middleware
//! (the default export of a file of `server/middleware/`), and the `onRequest`
//! hooks a Nitro route gives `defineEventHandler({ onRequest, handler })`.
//!
//! Each hook is a function of the file, read as any middleware is: the practice
//! map and `drift security` decide from its body whether it is a guard, nothing
//! or unknown ([`drift_core::MountFacts::app_middleware`]). Linking decides which
//! routes it runs before ([`crate::resolve`]).
//!
//! A hook may run its checks for some paths only (`if
//! (event.url.pathname.startsWith("/admin")) { ... }`). A test of the path at the
//! top level of the hook's body, `startsWith` of a literal, is read: the hook is
//! lowered once for each way its tests may come out, a view of its own
//! ([`Lowerer::assume`]), and linking gives each route the view its path makes.
//! Any other read of the path (a comparison, a regular expression, a test inside
//! a branch) leaves the hook unread for every route: which requests it refuses
//! is not known.
//!
//! The listed reading only: the last measured build read none of this.

use oxc_span::Span;

use super::*;

/// The hooks a file of SvelteKit or Nitro gives the routes of its package.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawServerHooks {
    /// `sveltekit` for a `hooks.server` file, `nitro` for a server middleware
    /// file: the file was read, and [`RawServerHooks::hooks`] is everything it
    /// runs before the routes. Empty for any other file.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String,
    /// In the order they run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hooks: Vec<RawServerHook>,
    /// A Nitro route file: what `defineEventHandler({ onRequest })` runs before
    /// its handler.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub route: Vec<RawServerHook>,
}

impl RawServerHooks {
    pub fn is_empty(&self) -> bool {
        self.kind.is_empty() && self.route.is_empty()
    }
}

/// A test of the request's path a hook makes: `startsWith(prefix)` of the URL's
/// path, or of SvelteKit's route id (`event.route.id`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawPathTest {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub route_id: bool,
    pub prefix: String,
}

/// One hook.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawServerHook {
    /// The path tests it makes, in the order written.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tests: Vec<RawPathTest>,
    /// What runs, for each way the tests come out: index `m` is the view where
    /// test `i` holds when bit `i` of `m` is set. One entry where it makes none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub views: Vec<RawRef>,
    /// How it is not read, where it is not: it may refuse any route.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub unread: String,
}

impl RawServerHook {
    fn unread(how: &str) -> Self {
        Self {
            unread: how.to_string(),
            ..Self::default()
        }
    }

    fn of(r: RawRef) -> Self {
        Self {
            views: vec![r],
            ..Self::default()
        }
    }
}

/// At most this many path tests are read in one hook (one view for each way
/// they come out).
const MAX_TESTS: usize = 3;

/// SvelteKit's `hooks.server` file.
pub(super) fn svelte_hooks_file(rel_path: &str) -> bool {
    hooks_file(rel_path) == Some("sveltekit")
}

/// The kind of server hook file at `rel_path`: SvelteKit's `src/hooks.server.ts`
/// (any directory: linking places it), a file directly in a Nitro
/// `server/middleware/` directory.
fn hooks_file(rel_path: &str) -> Option<&'static str> {
    let (dir, file) = rel_path.rsplit_once('/').unwrap_or(("", rel_path));
    let script = |stem: &str, f: &str| {
        f.strip_prefix(stem)
            .is_some_and(|ext| matches!(ext, ".ts" | ".js" | ".mts" | ".mjs" | ".cts" | ".cjs"))
    };
    if script("hooks.server", file)
        || (dir.rsplit('/').next() == Some("hooks.server") && script("index", file))
    {
        return Some("sveltekit");
    }
    let middleware_dir = dir == "server/middleware" || dir.ends_with("/server/middleware");
    if middleware_dir
        && file
            .rsplit_once('.')
            .is_some_and(|(_, e)| script("", &format!(".{e}")))
    {
        return Some("nitro");
    }
    None
}

/// A file of a Nitro route (`server/api/`, `server/routes/`).
fn nitro_route_file(rel_path: &str) -> bool {
    let under = |d: &str| rel_path.starts_with(d) || rel_path.contains(&format!("/{d}"));
    under("server/api/") || under("server/routes/")
}

/// A function that may be a hook.
#[derive(Clone, Copy)]
enum HookFn<'b, 'a> {
    /// An arrow or a function expression.
    Expr(&'b Expression<'a>),
    Decl(&'b Function<'a>),
}

impl<'b, 'a> HookFn<'b, 'a> {
    fn of(e: &'b Expression<'a>) -> Option<Self> {
        match unwrap_expr(e) {
            f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                Some(Self::Expr(f))
            }
            _ => None,
        }
    }

    /// The function, where it is not an arrow.
    fn function(self) -> Option<&'b Function<'a>> {
        match self {
            Self::Expr(Expression::FunctionExpression(f)) => Some(f),
            Self::Decl(f) => Some(f),
            Self::Expr(_) => None,
        }
    }

    fn arrow(self) -> Option<&'b ArrowFunctionExpression<'a>> {
        match self {
            Self::Expr(Expression::ArrowFunctionExpression(a)) => Some(a),
            _ => None,
        }
    }

    fn params(self) -> &'b FormalParameters<'a> {
        match (self.arrow(), self.function()) {
            (Some(a), _) => &a.params,
            (None, Some(f)) => &f.params,
            (None, None) => unreachable!("HookFn::of holds functions only"),
        }
    }

    /// The statements of its body; none for an arrow that returns an expression.
    fn statements(self) -> &'b [Statement<'a>] {
        match (self.arrow(), self.function()) {
            (Some(a), _) => match &a.body {
                ArrowFunctionBody::FunctionBody(b) => &b.statements,
                _ => &[],
            },
            (None, Some(f)) => f.body.as_ref().map_or(&[][..], |b| &b.statements),
            _ => &[],
        }
    }

    fn span(self) -> Span {
        match self {
            Self::Expr(e) => e.span(),
            Self::Decl(f) => f.span,
        }
    }

    fn is_async(self) -> bool {
        self.arrow()
            .map_or_else(|| self.function().is_some_and(|f| f.r#async), |a| a.r#async)
    }
}

/// A top-level binding of the module: a function, or the value a `const` holds.
enum Bound<'b, 'a> {
    Value(&'b Expression<'a>),
    Decl(&'b Function<'a>),
}

fn top_binding<'b, 'a>(program: &'b Program<'a>, name: &str) -> Option<Bound<'b, 'a>> {
    for st in &program.body {
        let decl = match st {
            Statement::ExportDeclaration(e) => &e.declaration,
            other => match other.as_declaration() {
                Some(d) => d,
                None => continue,
            },
        };
        let found = match decl {
            Declaration::VariableDeclaration(v) if v.kind.is_const() => {
                v.declarations.iter().find_map(|d| match (&d.id, &d.init) {
                    (BindingPattern::BindingIdentifier(id), Some(init)) if id.name == name => {
                        Some(Bound::Value(init))
                    }
                    _ => None,
                })
            }
            Declaration::FunctionDeclaration(f) => {
                f.id.as_ref()
                    .is_some_and(|id| id.name == name)
                    .then_some(Bound::Decl(f))
            }
            _ => None,
        };
        if found.is_some() {
            return found;
        }
    }
    None
}

/// The local name the module exports as `exported`, where it exports one of its
/// own: by a declaration (`export const handle = ...`) or a specifier (`export {
/// auth as handle }`). `Err` where it exports it otherwise (re-exported from
/// another module, destructured): what it is is not read.
fn exported_local(program: &Program, exported: &str) -> Option<Result<String, ()>> {
    for st in &program.body {
        match st {
            Statement::ExportNamedDeclaration(e) => {
                for s in &e.specifiers {
                    if module_export_name(&s.exported) == exported {
                        return Some(Ok(module_export_name(&s.local)));
                    }
                }
                continue;
            }
            Statement::ExportFromDeclaration(e) => {
                if e.specifiers
                    .iter()
                    .any(|s| module_export_name(&s.exported) == exported)
                {
                    return Some(Err(()));
                }
                continue;
            }
            _ => {}
        }
        let Statement::ExportDeclaration(e) = st else {
            continue;
        };
        match &e.declaration {
            Declaration::VariableDeclaration(v) => {
                for d in &v.declarations {
                    match &d.id {
                        BindingPattern::BindingIdentifier(id) if id.name == exported => {
                            return Some(Ok(exported.to_string()));
                        }
                        BindingPattern::BindingIdentifier(_) => {}
                        // `export const { handle } = SvelteKitAuth(...)`.
                        other => {
                            if binds(other, exported) {
                                return Some(Err(()));
                            }
                        }
                    }
                }
            }
            Declaration::FunctionDeclaration(f)
                if f.id.as_ref().is_some_and(|id| id.name == exported) =>
            {
                return Some(Ok(exported.to_string()));
            }
            _ => {}
        }
    }
    None
}

/// The pattern binds `name` somewhere in it.
fn binds(p: &BindingPattern, name: &str) -> bool {
    match p {
        BindingPattern::BindingIdentifier(b) => b.name == name,
        BindingPattern::AssignmentPattern(a) => binds(&a.left, name),
        BindingPattern::ObjectPattern(o) => {
            o.properties.iter().any(|p| binds(&p.value, name))
                || o.rest.as_ref().is_some_and(|r| binds(&r.argument, name))
        }
        BindingPattern::ArrayPattern(a) => {
            a.elements.iter().flatten().any(|e| binds(e, name))
                || a.rest.as_ref().is_some_and(|r| binds(&r.argument, name))
        }
    }
}

/// The documented names h3 builds an event handler with.
fn event_handler_builder(r: &RawRef) -> bool {
    let name = match &r.base {
        RawBase::Global(g) => g.as_str(),
        RawBase::Import { spec, name }
            if spec == "h3"
                || spec == "#imports"
                || spec.starts_with("nitropack")
                || spec.starts_with("nuxt") =>
        {
            name.as_str()
        }
        _ => return false,
    };
    r.member.is_empty() && matches!(name, "defineEventHandler" | "eventHandler")
}

/// A test of the path: `<path>.startsWith("<literal>")`, negated or not, with the
/// span of the call and of `<path>`.
struct PathTest {
    call: Span,
    read: Span,
    test: RawPathTest,
}

/// The reads of the request's path a hook makes, wherever they are: a member
/// named for the path (`pathname`, `href`, `route.id`, h3's `event.path`, Node's
/// `req.url`), a path destructured (`const { pathname } = event.url`), h3's
/// `getRequestURL` and `getRequestPath`.
struct PathReads<'n> {
    event: &'n str,
    found: Vec<Span>,
}

impl<'a> Visit<'a> for PathReads<'_> {
    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        let object_named = |name: &str| match unwrap_expr(&it.object) {
            Expression::StaticMemberExpression(m) => m.property.name == name,
            Expression::Identifier(id) => id.name == name,
            _ => false,
        };
        let is = match it.property.name.as_str() {
            "pathname" | "href" => true,
            "id" => object_named("route"),
            "url" => object_named("req"),
            "path" => {
                matches!(unwrap_expr(&it.object), Expression::Identifier(id) if id.name == self.event)
            }
            _ => false,
        };
        if is {
            self.found.push(it.span);
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if matches!(
            call_name(&it.callee),
            Some("getRequestURL" | "getRequestPath")
        ) {
            self.found.push(it.span);
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_binding_property(&mut self, it: &BindingProperty<'a>) {
        if it
            .key
            .static_name()
            .is_some_and(|k| k == "pathname" || k == "path")
        {
            self.found.push(it.span);
        }
        walk::walk_binding_property(self, it);
    }
}

impl Lowerer<'_> {
    /// Reads what a SvelteKit or Nitro file runs before the routes of its package
    /// ([`RawFile::server_hooks`]).
    pub(super) fn lower_server_hooks(&mut self, program: &Program, rel_path: &str) {
        let kind = hooks_file(rel_path);
        let route = kind.is_none() && nitro_route_file(rel_path);
        if (kind.is_none() && !route) || routes::unmeasured_listing() {
            return;
        }
        match kind {
            Some("sveltekit") => {
                let hooks = match exported_local(program, "handle") {
                    None => Vec::new(),
                    Some(Err(())) => vec![RawServerHook::unread(
                        "a handle hook exported in a way that is not read",
                    )],
                    Some(Ok(local)) => self.svelte_hooks(program, &local, 0),
                };
                self.out.server_hooks.kind = "sveltekit".to_string();
                self.out.server_hooks.hooks = hooks;
            }
            Some(_) => {
                let hook = self.nitro_middleware(program);
                self.out.server_hooks.kind = "nitro".to_string();
                self.out.server_hooks.hooks = vec![hook];
            }
            None => self.out.server_hooks.route = self.nitro_route_hooks(program),
        }
    }

    /// The hooks the binding `local` of a `hooks.server` file runs, in order: a
    /// function, or the hooks a `sequence(...)` chains.
    fn svelte_hooks(&mut self, program: &Program, local: &str, depth: usize) -> Vec<RawServerHook> {
        if depth > 3 {
            return vec![RawServerHook::unread("hooks chained too deep to read")];
        }
        match top_binding(program, local) {
            Some(Bound::Decl(f)) => vec![self.hook_of(local, HookFn::Decl(f), "sveltekit", false)],
            Some(Bound::Value(v)) => match HookFn::of(v) {
                Some(f) => vec![self.hook_of(local, f, "sveltekit", false)],
                None => self.svelte_hook_value(program, v, depth),
            },
            // Imported and exported again: not read here.
            None => vec![RawServerHook::unread(
                "a handle hook that is not a function of the file",
            )],
        }
    }

    /// The hooks a value given as `handle` or to `sequence` runs.
    fn svelte_hook_value(
        &mut self,
        program: &Program,
        v: &Expression,
        depth: usize,
    ) -> Vec<RawServerHook> {
        match unwrap_expr(v) {
            Expression::CallExpression(c)
                if self.canon_callee(&c.callee).is_some_and(|r| {
                    r.member.is_empty()
                        && matches!(&r.base, RawBase::Import { spec, name }
                            if spec == "@sveltejs/kit/hooks" && name == "sequence")
                }) =>
            {
                let mut out = Vec::new();
                for a in &c.arguments {
                    match a.as_expression() {
                        Some(x) => out.extend(self.svelte_hook_value(program, x, depth + 1)),
                        None => out.push(RawServerHook::unread("hooks spread into sequence")),
                    }
                }
                out
            }
            Expression::Identifier(id) => match top_binding(program, id.name.as_str()) {
                Some(_) => self.svelte_hooks(program, id.name.as_str(), depth + 1),
                // Imported: read where it is defined, as any middleware.
                None => match self.canon(v) {
                    Some(r) if !matches!(r.base, RawBase::Global(_)) => vec![RawServerHook::of(r)],
                    _ => vec![RawServerHook::unread("a hook that is not read")],
                },
            },
            x => match HookFn::of(x) {
                Some(f) => {
                    let at = self.line_of(x.span().start);
                    vec![self.hook_of(&format!("handle {at}"), f, "sveltekit", true)]
                }
                None => vec![RawServerHook::unread(
                    "a hook made by a call that is not read",
                )],
            },
        }
    }

    /// The hook a Nitro server middleware file runs: what its default export
    /// gives `defineEventHandler`.
    fn nitro_middleware(&mut self, program: &Program) -> RawServerHook {
        let exported = program.body.iter().find_map(|st| match st {
            Statement::ExportDefaultDeclaration(e) => Some(e),
            _ => None,
        });
        let Some(e) = exported else {
            return RawServerHook::unread("a server middleware with no default export");
        };
        let Some(value) = e.declaration.as_expression() else {
            return RawServerHook::unread("a server middleware that is not read");
        };
        let value = match unwrap_expr(value) {
            Expression::Identifier(id) => match top_binding(program, id.name.as_str()) {
                Some(Bound::Value(v)) => v,
                _ => return RawServerHook::unread("a server middleware that is not read"),
            },
            v => v,
        };
        let Expression::CallExpression(c) = unwrap_expr(value) else {
            return RawServerHook::unread("a server middleware that is not read");
        };
        if !self
            .canon_callee(&c.callee)
            .is_some_and(|r| event_handler_builder(&r))
        {
            return RawServerHook::unread("a server middleware that is not read");
        }
        match c
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .and_then(HookFn::of)
        {
            // `export default defineEventHandler(fn)`: the file's `default`.
            Some(f) => self.hook_of("default", f, "nitro", false),
            None => RawServerHook::unread("a server middleware that is not read"),
        }
    }

    /// What a Nitro route's `defineEventHandler({ onRequest, handler })` runs
    /// before its handler.
    fn nitro_route_hooks(&mut self, program: &Program) -> Vec<RawServerHook> {
        let Some(Statement::ExportDefaultDeclaration(e)) = program
            .body
            .iter()
            .find(|st| matches!(st, Statement::ExportDefaultDeclaration(_)))
        else {
            return Vec::new();
        };
        let Some(Expression::CallExpression(c)) = e.declaration.as_expression().map(unwrap_expr)
        else {
            return Vec::new();
        };
        if !self
            .canon_callee(&c.callee)
            .is_some_and(|r| event_handler_builder(&r))
        {
            return Vec::new();
        }
        let Some(Expression::ObjectExpression(o)) = c
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr)
        else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if o.properties
            .iter()
            .any(|p| matches!(p, ObjectPropertyKind::SpreadProperty(_)))
        {
            out.push(RawServerHook::unread(
                "route options spread from a value that is not read",
            ));
        }
        let Some(hooks) = routes::object_prop(o, "onRequest") else {
            return out;
        };
        let given: Vec<&Expression> = match unwrap_expr(hooks) {
            Expression::ArrayExpression(a) => a
                .elements
                .iter()
                .map(|el| el.as_expression())
                .collect::<Option<Vec<_>>>()
                .unwrap_or_default(),
            x => vec![x],
        };
        if given.is_empty()
            && !matches!(unwrap_expr(hooks), Expression::ArrayExpression(a) if a.elements.is_empty())
        {
            out.push(RawServerHook::unread("onRequest hooks that are not read"));
        }
        for x in given {
            out.push(match HookFn::of(x) {
                Some(f) => {
                    let at = self.line_of(x.span().start);
                    self.hook_of(&format!("default onRequest {at}"), f, "nitro", true)
                }
                None => match unwrap_expr(x) {
                    Expression::Identifier(_) | Expression::StaticMemberExpression(_) => {
                        match self.canon(x) {
                            Some(r) => RawServerHook::of(r),
                            None => RawServerHook::unread("an onRequest hook that is not read"),
                        }
                    }
                    _ => RawServerHook::unread("an onRequest hook made by a call that is not read"),
                },
            });
        }
        out
    }

    /// The hook a function is, under the name `name`: the function itself where it
    /// reads nothing of the path; a view of it for each way its path tests come out
    /// where they are read ([`Lowerer::path_tests`]); unread where the path is read
    /// otherwise. `in_place`: the function is written where the hook is given, and
    /// is lowered as a symbol of its own under `name`.
    fn hook_of(&mut self, name: &str, f: HookFn, framework: &str, in_place: bool) -> RawServerHook {
        let tests = match self.path_tests(f, framework) {
            Ok(tests) => tests,
            Err(()) => {
                return RawServerHook::unread(
                    "a hook that tests the request's path in a way that is not read",
                );
            }
        };
        if tests.is_empty() {
            let r = match in_place {
                true => self.view_symbol(name.to_string(), f, &[]),
                false => RawRef {
                    base: RawBase::Local(name.to_string()),
                    member: String::new(),
                },
            };
            return RawServerHook::of(r);
        }
        let mut views = Vec::new();
        for mask in 0..(1usize << tests.len()) {
            let assumed: Vec<(u32, u32, bool)> = tests
                .iter()
                .enumerate()
                .map(|(i, t)| (t.call.start, t.call.end, mask & (1 << i) != 0))
                .collect();
            let words: Vec<String> = tests
                .iter()
                .zip(&assumed)
                .map(|(t, (_, _, holds))| {
                    format!(
                        "{} {} {}",
                        if t.test.route_id { "route id" } else { "path" },
                        if *holds {
                            "starts with"
                        } else {
                            "does not start with"
                        },
                        // A symbol's name holds no `.` and no `(`: a reference
                        // reads them as a member and a call.
                        t.test
                            .prefix
                            .replace(['.', '#'], "_")
                            .replace('(', "[")
                            .replace(')', "]")
                    )
                })
                .collect();
            let view = format!("{name} where {}", words.join(", "));
            views.push(self.view_symbol(view, f, &assumed));
        }
        RawServerHook {
            tests: tests.into_iter().map(|t| t.test).collect(),
            views,
            unread: String::new(),
        }
    }

    /// The function `f` lowered as a symbol of its own named `name`, listed only
    /// ([`RawSymbol::in_place`]), with the path tests `assumed` taken to come out
    /// as given.
    fn view_symbol(&mut self, name: String, f: HookFn, assumed: &[(u32, u32, bool)]) -> RawRef {
        let at = self.line_of(f.span().start);
        let mut unique = name.clone();
        let mut n = 2;
        while self.out.symbols.iter().any(|s| s.name == unique) {
            unique = format!("{name} #{n}");
            n += 1;
        }
        let mut sym = RawSymbol::empty(&unique, SymbolKind::Function, at);
        sym.in_place = true;
        sym.is_async = f.is_async();
        *self.assume.borrow_mut() = assumed.to_vec();
        match f {
            HookFn::Expr(e) => self.handler_facts(Some(e), &mut sym),
            HookFn::Decl(func) => {
                let mut c = Collector::new(self);
                c.visit_function(func, oxc_semantic::ScopeFlags::Function);
                let saw_input = c.saw_input;
                c.fill(&mut sym);
                record_input(&mut sym, saw_input, self.function_input(func));
            }
        }
        self.assume.borrow_mut().clear();
        self.push_symbol(sym);
        RawRef {
            base: RawBase::Local(unique),
            member: String::new(),
        }
    }

    /// The path tests at the top level of `f`'s body: the test of an `if` that is
    /// one, its negation, or a conjunction with one (`if (pathname.startsWith(
    /// "/admin") && !locals.user)`). `Err` where the body reads the path anywhere
    /// else, or makes more than [`MAX_TESTS`] of them.
    fn path_tests(&self, f: HookFn, framework: &str) -> Result<Vec<PathTest>, ()> {
        let event = match f.params().items.first().map(|p| &p.pattern) {
            // SvelteKit: `({ event, resolve })`.
            Some(BindingPattern::ObjectPattern(o)) if framework == "sveltekit" => o
                .properties
                .iter()
                .find(|p| !p.computed && p.key.static_name().is_some_and(|k| k == "event"))
                .and_then(|p| match &p.value {
                    BindingPattern::BindingIdentifier(b) => Some(b.name.to_string()),
                    _ => None,
                }),
            // Nitro: `(event)`.
            Some(BindingPattern::BindingIdentifier(b)) if framework == "nitro" => {
                Some(b.name.to_string())
            }
            _ => None,
        };
        let mut reads = PathReads {
            event: event.as_deref().unwrap_or(""),
            found: Vec::new(),
        };
        match f {
            HookFn::Expr(e) => reads.visit_expression(e),
            HookFn::Decl(func) => reads.visit_function(func, oxc_semantic::ScopeFlags::Function),
        }
        let found = reads.found;
        if found.is_empty() {
            return Ok(Vec::new());
        }
        let Some(event) = event else { return Err(()) };
        let mut tests = Vec::new();
        for st in f.statements() {
            if let Statement::IfStatement(i) = st {
                collect_tests(&i.test, &event, framework, &mut tests);
            }
        }
        let within = |s: &Span| {
            tests
                .iter()
                .any(|t: &PathTest| t.read.start <= s.start && s.end <= t.read.end)
        };
        if tests.len() > MAX_TESTS || !found.iter().all(within) {
            return Err(());
        }
        Ok(tests)
    }
}

/// The path tests a condition makes as a whole or as an operand of its `&&`.
fn collect_tests(e: &Expression, event: &str, framework: &str, out: &mut Vec<PathTest>) {
    match peel(e) {
        Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
            collect_tests(&u.argument, event, framework, out);
        }
        Expression::LogicalExpression(l) if l.operator == LogicalOperator::And => {
            collect_tests(&l.left, event, framework, out);
            collect_tests(&l.right, event, framework, out);
        }
        x => {
            if let Some(t) = path_test(x, event, framework) {
                out.push(t);
            }
        }
    }
}

/// `<path>.startsWith("/<literal>")`, `<path>?.startsWith(...)`.
fn path_test(e: &Expression, event: &str, framework: &str) -> Option<PathTest> {
    let (call_span, callee, args) = match e {
        Expression::CallExpression(c) => (c.span, &c.callee, &c.arguments),
        Expression::ChainExpression(ch) => match &ch.expression {
            ChainElement::CallExpression(c) => (ch.span, &c.callee, &c.arguments),
            _ => return None,
        },
        _ => return None,
    };
    let Expression::StaticMemberExpression(m) = unwrap_expr(callee) else {
        return None;
    };
    if m.property.name != "startsWith" || args.len() != 1 {
        return None;
    }
    let prefix = args.first()?.as_expression().and_then(literal_text)?;
    if !prefix.starts_with('/') {
        return None;
    }
    let path = unwrap_expr(&m.object);
    let route_id = path_read(path, event, framework)?;
    Some(PathTest {
        call: call_span,
        read: path.span(),
        test: RawPathTest { route_id, prefix },
    })
}

/// Whether `e` is the request's path (`Some(false)`) or SvelteKit's route id
/// (`Some(true)`), as the framework documents them for `event`: SvelteKit's
/// `event.url.pathname` and `event.route.id`; h3's `event.path`,
/// `event.url.pathname`, `getRequestURL(event).pathname` and
/// `event.node.req.url`.
fn path_read(e: &Expression, event: &str, framework: &str) -> Option<bool> {
    let is_event =
        |x: &Expression| matches!(unwrap_expr(x), Expression::Identifier(id) if id.name == event);
    let Expression::StaticMemberExpression(m) = e else {
        return None;
    };
    let object = unwrap_expr(&m.object);
    let of = |x: &Expression, name: &str| matches!(x, Expression::StaticMemberExpression(o) if o.property.name == name && is_event(&o.object));
    match (framework, m.property.name.as_str()) {
        (_, "pathname") if of(object, "url") => Some(false),
        ("sveltekit", "id") if of(object, "route") => Some(true),
        ("nitro", "path") if is_event(object) => Some(false),
        ("nitro", "pathname") => match object {
            Expression::CallExpression(c)
                if call_name(&c.callee) == Some("getRequestURL")
                    && c.arguments
                        .first()
                        .and_then(|a| a.as_expression())
                        .is_some_and(is_event) =>
            {
                Some(false)
            }
            _ => None,
        },
        ("nitro", "url") => match object {
            Expression::StaticMemberExpression(req)
                if req.property.name == "req" && of(&req.object, "node") =>
            {
                Some(false)
            }
            _ => None,
        },
        _ => None,
    }
}

impl Collector<'_, '_> {
    /// The value a server hook's view takes a test to have ([`Lowerer::assume`]),
    /// through `!` and `&&`; none where it decides nothing.
    pub(super) fn assumed_value(&self, e: &Expression) -> Option<bool> {
        let assume = self.l.assume.borrow();
        if assume.is_empty() {
            return None;
        }
        fn value(assume: &[(u32, u32, bool)], e: &Expression) -> Option<bool> {
            match peel(e) {
                Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                    value(assume, &u.argument).map(|v| !v)
                }
                Expression::LogicalExpression(l) if l.operator == LogicalOperator::And => {
                    match (value(assume, &l.left), value(assume, &l.right)) {
                        (Some(false), _) | (_, Some(false)) => Some(false),
                        (Some(true), Some(true)) => Some(true),
                        _ => None,
                    }
                }
                x => {
                    let s = x.span();
                    assume
                        .iter()
                        .find(|(start, end, _)| *start == s.start && *end == s.end)
                        .map(|(_, _, v)| *v)
                }
            }
        }
        value(&assume, e)
    }

    /// The names a function's continuation goes by ([`continuation_params`]),
    /// and in SvelteKit's `hooks.server` the `resolve` a hook is handed
    /// (`({ event, resolve }) => resolve(event)`), for the listed reading.
    pub(super) fn continuation_names_of(&self, params: &FormalParameters) -> Vec<String> {
        let mut names = continuation_params(params);
        if !self.l.svelte_hooks {
            return names;
        }
        let resolve = params.items.first().and_then(|p| match &p.pattern {
            BindingPattern::ObjectPattern(o) => {
                o.properties
                    .iter()
                    .find_map(|p| match (&p.value, p.computed) {
                        (BindingPattern::BindingIdentifier(b), false)
                            if p.key.static_name().is_some_and(|k| k == "resolve") =>
                        {
                            Some(b.name.to_string())
                        }
                        _ => None,
                    })
            }
            _ => None,
        });
        if let Some(r) = resolve
            && !routes::unmeasured_listing()
        {
            names.push(r);
        }
        names
    }

    /// A call that throws where it stands, by the framework's documented API:
    /// Koa's `ctx.throw(...)` and `ctx.assert(...)` on the context a function is
    /// handed, SvelteKit's `error(...)` and `redirect(...)` (which throw since
    /// SvelteKit 2).
    pub(super) fn throws_by_framework(&self, c: &CallExpression) -> bool {
        self.koa_context_call(c).is_some()
            || self.l.canon_callee(&c.callee).is_some_and(|r| {
                r.member.is_empty()
                    && matches!(&r.base, RawBase::Import { spec, name }
                        if spec == "@sveltejs/kit" && matches!(name.as_str(), "error" | "redirect"))
            })
    }

    /// `throw` or `assert` of `<param>.throw(...)`: Koa's context, a parameter of
    /// the function, refusing the request.
    fn koa_context_call<'x>(&self, c: &'x CallExpression) -> Option<&'x str> {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return None;
        };
        let Expression::Identifier(id) = unwrap_expr(&m.object) else {
            return None;
        };
        let name = m.property.name.as_str();
        (matches!(name, "throw" | "assert")
            && self
                .symbol_of(id)
                .is_some_and(|s| self.l.params.contains_key(&s)))
        .then_some(name)
    }

    /// How a call refuses by the framework's documented API, where the lowering
    /// did not read it before: Koa's `ctx.throw(401)` (the status any argument
    /// gives), SvelteKit's `redirect(303, "/login")` and h3's
    /// `sendRedirect(event, "/login")` to a sign-in page.
    pub(super) fn framework_refusal(&self, c: &CallExpression) -> Option<drift_core::CheckOutcome> {
        if self.koa_context_call(c) == Some("throw") {
            return c
                .arguments
                .iter()
                .filter_map(|a| a.as_expression())
                .find_map(literal_status)
                .and_then(status_outcome);
        }
        let second = c.arguments.get(1).and_then(|a| a.as_expression());
        let target = match call_name(&c.callee) {
            Some("redirect")
                if self.throws_by_framework(c)
                    && c.arguments
                        .first()
                        .and_then(|a| a.as_expression())
                        .and_then(literal_status)
                        .is_some() =>
            {
                second
            }
            // h3's, auto-imported by Nitro or imported.
            Some("sendRedirect")
                if self.l.canon_callee(&c.callee).is_some_and(|r| {
                    r.member.is_empty()
                        && match &r.base {
                            RawBase::Global(g) => g == "sendRedirect",
                            RawBase::Import { spec, name } => {
                                name == "sendRedirect" && (spec == "h3" || spec == "#imports")
                            }
                            _ => false,
                        }
                }) =>
            {
                second
            }
            _ => None,
        };
        sign_in_arg(target).then_some(drift_core::CheckOutcome::SignInRedirect)
    }
}
