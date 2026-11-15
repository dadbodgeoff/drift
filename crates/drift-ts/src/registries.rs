//! Lists of references (registries) and autodiscovery globs, at lowering time.
//!
//! A registry is a place that names other code by reference: an array or object
//! literal passed to a call or decorator (`@Module({ providers: [A, B] })`,
//! `combineReducers({ a, b })`), a module-level array or object binding
//! (`export const routes = [...]`), or the arguments of every statement-level call
//! on one receiver (`app.use(a); app.use(b)`). Only references are recorded,
//! never string values, and resolution to canonical symbols happens in the linker
//! like every other reference. Wiring rules (`drift-mine`'s `wiring` module) read
//! them.

use super::*;

/// Deepest nesting followed inside one list (`[{ path, children: [{ component }] }]`).
const MAX_LIST_DEPTH: usize = 5;
/// Deepest object key path recorded for an argument (`{ test: { setupFiles: [...] } }`).
const MAX_ARG_KEY_DEPTH: usize = 2;

/// Where a list sits, before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawSlot {
    /// Argument `index` of a call or decorator, under the object key path `key`
    /// (empty for the argument itself).
    Arg {
        callee: RawRef,
        index: u32,
        key: String,
    },
    /// A module-level binding (`default` for `export default`).
    Binding(String),
    /// Every statement-level call of a method of this receiver.
    Calls(RawRef),
}

/// One list of references, before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawList {
    pub slot: RawSlot,
    pub line: u32,
    /// (reference, line), in source order.
    pub items: Vec<(RawRef, u32)>,
    /// References spread into the list (`...USE_CASES`).
    #[serde(default)]
    pub spreads: Vec<(RawRef, u32)>,
    /// The list holds something no reference describes (see
    /// `drift_core::Registry::opaque`).
    #[serde(default)]
    pub opaque: bool,
}

/// Object keys whose function value loads code lazily (Angular and Vue routes,
/// React Router's `lazy`): what they load is not visible as a reference.
const LAZY_KEYS: &[&str] = &[
    "loadComponent",
    "loadChildren",
    "lazy",
    "component",
    "getComponent",
];

/// What one list holds, while it is being read.
#[derive(Default)]
struct Acc {
    items: Vec<(RawRef, u32)>,
    spreads: Vec<(RawRef, u32)>,
    opaque: bool,
}

impl Acc {
    fn refs(&self) -> usize {
        self.items.len() + self.spreads.len()
    }
}

/// Finds registries and autodiscovery globs anywhere in a file.
pub(super) struct ListFinder<'l, 's> {
    l: &'l Lowerer<'s>,
    lists: Vec<RawList>,
    /// Statement-level calls by receiver: (first line, items).
    calls: BTreeMap<RawRef, (u32, Acc)>,
    discovers: BTreeSet<String>,
    /// Function nesting: argument lists count at module level (and in decorators)
    /// only, statement calls also directly in top-level functions (app factories).
    /// A call inside a component or hook body (`useReactTable({ columns })`) is
    /// code that runs, not a place things are registered.
    depth: usize,
}

impl<'l, 's> ListFinder<'l, 's> {
    pub(super) fn new(l: &'l Lowerer<'s>) -> Self {
        Self {
            l,
            lists: Vec::new(),
            calls: BTreeMap::new(),
            discovers: BTreeSet::new(),
            depth: 0,
        }
    }

    /// Lists and globs found, in a canonical order.
    pub(super) fn finish(mut self) -> (Vec<RawList>, Vec<String>) {
        for (receiver, (line, acc)) in std::mem::take(&mut self.calls) {
            self.push(RawSlot::Calls(receiver), line, acc);
        }
        self.lists.sort();
        self.lists.dedup();
        (self.lists, self.discovers.into_iter().collect())
    }

    fn push(&mut self, slot: RawSlot, line: u32, acc: Acc) {
        // Only lists that name something the linker can place: in-file or imported
        // bindings. Globals (`console`, `Number`) never register anything; a spread
        // global (`...Object.values(x)` is a call, but `...globalThis.x`) is opaque.
        // A list of nothing but what Drift cannot read (`[...getControllers()]`) is
        // kept as an opaque list: dropping it would make its members look
        // unregistered.
        let global = |r: &RawRef| matches!(r.base, RawBase::Global(_));
        let opaque = acc.opaque || acc.spreads.iter().any(|(r, _)| global(r));
        let items: Vec<_> = acc.items.into_iter().filter(|(r, _)| !global(r)).collect();
        let spreads: Vec<_> = acc
            .spreads
            .into_iter()
            .filter(|(r, _)| !global(r))
            .collect();
        if !items.is_empty() || !spreads.is_empty() || opaque {
            self.lists.push(RawList {
                slot,
                line,
                items,
                spreads,
                opaque,
            });
        }
    }

    /// Module-level bindings whose value is an array or object literal.
    pub(super) fn bindings(&mut self, program: &Program) {
        for stmt in &program.body {
            let decl = match stmt {
                Statement::VariableDeclaration(v) => Some(&**v),
                Statement::ExportDeclaration(e) => match &e.declaration {
                    Declaration::VariableDeclaration(v) => Some(&**v),
                    _ => None,
                },
                _ => None,
            };
            if let Some(v) = decl {
                for d in &v.declarations {
                    if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init)
                        && is_container(init)
                    {
                        let mut acc = Acc::default();
                        self.collect(init, 0, false, &mut acc);
                        let line = self.l.line_of(init.span().start);
                        self.push(RawSlot::Binding(id.name.to_string()), line, acc);
                    }
                }
            }
            if let Statement::ExportDefaultDeclaration(e) = stmt
                && let Some(expr) = e.declaration.as_expression()
                && is_container(expr)
            {
                let mut acc = Acc::default();
                self.collect(expr, 0, false, &mut acc);
                let line = self.l.line_of(expr.span().start);
                self.push(RawSlot::Binding("default".into()), line, acc);
            }
        }
    }

    /// References inside a list element, in source order: identifiers and member
    /// paths, the callee and arguments of calls, the values of objects, the elements
    /// of nested arrays, spreads. `stmt` is set for the arguments of statement calls
    /// (`app.use(cors(), (req, res, next) => ...)`), where inline handlers and
    /// middleware factories are common and register nothing.
    ///
    /// The list becomes opaque ([`RawList::opaque`]) when it holds what no reference
    /// describes: a spread of a call (`...providers()`), a bare call with no
    /// reference arguments as an element (`provideHttpClient()`, a helper), a
    /// function as an element or a lazy route loader (`loadComponent: () => ...`).
    /// An arrow whose body is a reference stands for it (`forwardRef(() => X)`).
    fn collect(&self, e: &Expression, depth: usize, stmt: bool, acc: &mut Acc) {
        if depth > MAX_LIST_DEPTH {
            return;
        }
        let e = unwrap_expr(e);
        let line = self.l.line_of(e.span().start);
        match e {
            Expression::Identifier(_)
            | Expression::StaticMemberExpression(_)
            | Expression::ChainExpression(_) => {
                if let Some(r) = self.symbol_ref(e) {
                    acc.items.push((r, line));
                }
            }
            Expression::CallExpression(c) => {
                if self.l.require_spec_call(c).is_some() {
                    return;
                }
                if let Some(r) = self.symbol_ref(&c.callee) {
                    acc.items.push((r, line));
                }
                let before = acc.refs();
                for a in &c.arguments {
                    match a {
                        Argument::SpreadElement(s) => self.spread(&s.argument, line, acc),
                        a => {
                            if let Some(x) = a.as_expression() {
                                self.element(x, depth + 1, stmt, acc);
                            }
                        }
                    }
                }
                let bare = matches!(unwrap_expr(&c.callee), Expression::Identifier(_));
                if !stmt && depth == 1 && bare && acc.refs() == before {
                    acc.opaque = true;
                }
            }
            Expression::NewExpression(n) => {
                if let Some(r) = self.symbol_ref(&n.callee) {
                    acc.items.push((r, line));
                }
            }
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    match el {
                        ArrayExpressionElement::SpreadElement(s) => {
                            self.spread(&s.argument, line, acc)
                        }
                        ArrayExpressionElement::Elision(_) => {}
                        el => {
                            if let Some(x) = el.as_expression() {
                                self.element(x, depth + 1, stmt, acc);
                            }
                        }
                    }
                }
            }
            Expression::ObjectExpression(o) => {
                for p in &o.properties {
                    match p {
                        ObjectPropertyKind::ObjectProperty(p) => {
                            if p.method {
                                continue;
                            }
                            let value = unwrap_expr(&p.value);
                            if is_function(value) {
                                let lazy = p
                                    .key
                                    .static_name()
                                    .and_then(|k| k.as_str().map(|k| LAZY_KEYS.contains(&k)))
                                    .unwrap_or(false);
                                if lazy && !stmt {
                                    self.function(value, depth + 1, acc);
                                }
                                continue;
                            }
                            self.collect(value, depth + 1, stmt, acc);
                        }
                        ObjectPropertyKind::SpreadProperty(s) => {
                            self.spread(&s.argument, line, acc)
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// An element of a list or an argument inside one: functions are read as
    /// [`Self::function`], anything else as [`Self::collect`].
    fn element(&self, e: &Expression, depth: usize, stmt: bool, acc: &mut Acc) {
        if is_function(unwrap_expr(e)) {
            if !stmt {
                self.function(unwrap_expr(e), depth, acc);
            }
        } else {
            self.collect(e, depth, stmt, acc);
        }
    }

    /// A function in a list: `() => X` stands for `X`; anything else is opaque.
    fn function(&self, e: &Expression, depth: usize, acc: &mut Acc) {
        if let Expression::ArrowFunctionExpression(a) = e
            && let Some(body) = a.get_expression()
            && matches!(
                unwrap_expr(body),
                Expression::Identifier(_) | Expression::StaticMemberExpression(_)
            )
        {
            self.collect(body, depth, false, acc);
        } else {
            acc.opaque = true;
        }
    }

    /// `...x`: a reference stands for its items; anything else is opaque.
    fn spread(&self, e: &Expression, line: u32, acc: &mut Acc) {
        match unwrap_expr(e) {
            x @ (Expression::Identifier(_) | Expression::StaticMemberExpression(_)) => {
                match self.symbol_ref(x) {
                    Some(r) => acc.spreads.push((r, line)),
                    None => acc.opaque = true,
                }
            }
            _ => acc.opaque = true,
        }
    }

    /// The symbol an expression names: its base binding plus member path, but
    /// never `this.x` (an instance field, not a module symbol).
    fn symbol_ref(&self, e: &Expression) -> Option<RawRef> {
        let mut cur = unwrap_expr(e);
        loop {
            match cur {
                Expression::StaticMemberExpression(m) => cur = unwrap_expr(&m.object),
                Expression::CallExpression(c) => cur = unwrap_expr(&c.callee),
                Expression::ThisExpression(_) => return None,
                _ => break,
            }
        }
        self.l.canon(e)
    }

    /// Lists in the arguments of one call: arrays (`f([a, b])`), and arrays or
    /// objects under an object argument's keys (`Module({ providers: [a] })`), plus
    /// an object argument's plain values (`combineReducers({ a, b })`).
    /// `Module` of `@nestjs/common`, when this file imports from it.
    fn nest_module(&self) -> Option<RawRef> {
        // Type-only imports count (`import type { DynamicModule }`).
        self.l
            .out
            .imports
            .iter()
            .any(|i| i.spec == "@nestjs/common")
            .then(|| RawRef {
                base: RawBase::Import {
                    spec: "@nestjs/common".to_string(),
                    name: "Module".to_string(),
                },
                member: String::new(),
            })
    }

    fn dynamic_module(&mut self, o: &ObjectExpression) {
        if !is_dynamic_module(o) {
            return;
        }
        let Some(callee) = self.nest_module() else {
            return;
        };
        for p in &o.properties {
            let ObjectPropertyKind::ObjectProperty(p) = p else {
                continue;
            };
            let value = unwrap_expr(&p.value);
            if let Some(k) = p.key.static_name()
                && let Some(k) = k.as_str()
                && NEST_MODULE_KEYS.contains(&k)
                && matches!(value, Expression::ArrayExpression(_))
            {
                let k = k.to_string();
                self.arg_lists(&callee, 0, value, &k, 1);
            }
        }
    }

    fn call_lists(&mut self, callee: &RawRef, args: &[Argument]) {
        // `@Module(getModuleConfig())`: the module's lists exist but cannot be read.
        // Each slot is an opaque list, so its family is unknown, never "missing".
        if matches!(&callee.base, RawBase::Import { spec, name }
                if spec == "@nestjs/common" && name == "Module")
            && callee.member.is_empty()
            && let Some(first) = args.first().and_then(Argument::as_expression)
            && !matches!(unwrap_expr(first), Expression::ObjectExpression(_))
        {
            let line = self.l.line_of(first.span().start);
            for k in NEST_MODULE_KEYS {
                let slot = RawSlot::Arg {
                    callee: callee.clone(),
                    index: 0,
                    key: (*k).to_string(),
                };
                self.push(
                    slot,
                    line,
                    Acc {
                        opaque: true,
                        ..Acc::default()
                    },
                );
            }
        }
        for (i, a) in args.iter().enumerate() {
            let Some(e) = a.as_expression() else { continue };
            let index = u32::try_from(i).unwrap_or(u32::MAX);
            self.arg_lists(callee, index, unwrap_expr(e), "", 0);
        }
    }

    fn arg_lists(&mut self, callee: &RawRef, index: u32, e: &Expression, key: &str, depth: usize) {
        match e {
            Expression::ArrayExpression(_) => {
                let mut acc = Acc::default();
                self.collect(e, 0, false, &mut acc);
                let slot = RawSlot::Arg {
                    callee: callee.clone(),
                    index,
                    key: key.to_string(),
                };
                let line = self.l.line_of(e.span().start);
                self.push(slot, line, acc);
            }
            Expression::ObjectExpression(o) => {
                // Plain values directly in the object form one list; nested
                // containers form their own, keyed by their property name.
                let mut direct = Acc::default();
                for p in &o.properties {
                    let ObjectPropertyKind::ObjectProperty(p) = p else {
                        continue;
                    };
                    if p.method || p.computed {
                        continue;
                    }
                    let value = unwrap_expr(&p.value);
                    if is_container(value) {
                        if depth < MAX_ARG_KEY_DEPTH
                            && let Some(k) = p.key.static_name()
                            && let Some(k) = k.as_str()
                        {
                            let k = k.to_string();
                            let path = if key.is_empty() {
                                k
                            } else {
                                format!("{key}.{k}")
                            };
                            self.arg_lists(callee, index, value, &path, depth + 1);
                        }
                    } else if matches!(
                        value,
                        Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                    ) {
                        self.collect(value, 0, false, &mut direct);
                    }
                }
                if direct.refs() > 0 {
                    let slot = RawSlot::Arg {
                        callee: callee.clone(),
                        index,
                        key: key.to_string(),
                    };
                    let line = self.l.line_of(e.span().start);
                    self.push(slot, line, direct);
                }
            }
            _ => {}
        }
    }

    /// `import.meta.glob("./x/*.ts")` and `require.context("./x", true)`: globs
    /// relative to this file.
    fn glob_call(&mut self, c: &CallExpression) -> bool {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return false;
        };
        let prop = m.property.name.as_str();
        let first = c.arguments.first().and_then(Argument::as_expression);
        match unwrap_expr(&m.object) {
            Expression::ImportMeta(_) if matches!(prop, "glob" | "globEager") => {
                let mut pats = Vec::new();
                match first.map(unwrap_expr) {
                    Some(Expression::StringLiteral(s)) => pats.push(lit(s)),
                    Some(Expression::ArrayExpression(a)) => {
                        for el in &a.elements {
                            if let Some(Expression::StringLiteral(s)) =
                                el.as_expression().map(unwrap_expr)
                            {
                                pats.push(lit(s));
                            }
                        }
                    }
                    _ => {}
                }
                // Negated patterns narrow a glob; they never add files.
                self.discovers
                    .extend(pats.into_iter().filter(|p| !p.starts_with('!')));
                true
            }
            Expression::Identifier(id)
                if id.name == "require"
                    && prop == "context"
                    && matches!(self.l.resolve_ident(id), Some(RawBase::Global(_))) =>
            {
                if let Some(Expression::StringLiteral(s)) = first.map(unwrap_expr) {
                    let recursive = !matches!(
                        c.arguments.get(1).and_then(Argument::as_expression).map(unwrap_expr),
                        Some(Expression::BooleanLiteral(b)) if !b.value
                    );
                    let dir = lit(s);
                    let dir = dir.trim_end_matches('/');
                    self.discovers.insert(if recursive {
                        format!("{dir}/**")
                    } else {
                        format!("{dir}/*")
                    });
                }
                true
            }
            _ => false,
        }
    }
}

/// An arrow function or function expression.
fn is_function(e: &Expression) -> bool {
    matches!(
        e,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

/// An array or object literal.
fn is_container(e: &Expression) -> bool {
    matches!(
        unwrap_expr(e),
        Expression::ArrayExpression(_) | Expression::ObjectExpression(_)
    )
}

/// The keys of `@Module({ ... })` that hold lists.
const NEST_MODULE_KEYS: &[&str] = &["controllers", "exports", "imports", "providers"];

/// Whether an object literal is a Nest `DynamicModule`: it has a `module` key.
fn is_dynamic_module(o: &ObjectExpression) -> bool {
    o.properties.iter().any(|p| {
        matches!(p, ObjectPropertyKind::ObjectProperty(p)
            if !p.computed && p.key.static_name().is_some_and(|k| k == "module"))
    })
}

impl<'a> Visit<'a> for ListFinder<'_, '_> {
    /// A returned `DynamicModule` (`return { module: M, controllers: [X] }`, in a
    /// `@Module`'s static method or an exported object's method) registers like
    /// `@Module({ ... })`: its arrays are lists of the decorator's slots.
    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        if let Some(Expression::ObjectExpression(o)) = it.argument.as_ref().map(unwrap_expr) {
            self.dynamic_module(o);
        }
        walk::walk_return_statement(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if !self.glob_call(it)
            && self.depth == 0
            && self.l.require_spec_call(it).is_none()
            && let Some(callee) = self.l.canon_callee(&it.callee)
            && !matches!(callee.base, RawBase::Global(_))
        {
            self.call_lists(&callee, &it.arguments);
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        self.depth += 1;
        walk::walk_function(self, it, flags);
        self.depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if let Some(body) = it.get_expression()
            && let Expression::ObjectExpression(o) = unwrap_expr(body)
        {
            self.dynamic_module(o);
        }
        self.depth += 1;
        walk::walk_arrow_function_expression(self, it);
        self.depth -= 1;
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        if self.depth == 0
            && let Some(mut callee) = self.l.canon(&it.callee)
            && !matches!(callee.base, RawBase::Global(_))
        {
            callee.member.push_str("(new)");
            self.call_lists(&callee, &it.arguments);
        }
        walk::walk_new_expression(self, it);
    }

    fn visit_expression_statement(&mut self, it: &ExpressionStatement<'a>) {
        // `app.use(a)`, `container.register(X)`: one list per receiver.
        if self.depth <= 1
            && let Expression::CallExpression(c) = unwrap_expr(&it.expression)
            && let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee)
            && !matches!(unwrap_expr(&m.object), Expression::CallExpression(_))
        {
            let receiver = self
                .l
                .canon(&m.object)
                .or_else(|| match unwrap_expr(&m.object) {
                    // A function-local app or router (`const app = express()` in a factory).
                    Expression::Identifier(id) => Some(RawRef {
                        base: RawBase::Local(format!("~{}", id.name)),
                        member: String::new(),
                    }),
                    _ => None,
                });
            if let Some(receiver) = receiver
                && !matches!(receiver.base, RawBase::Global(_))
            {
                let mut acc = Acc::default();
                let line = self.l.line_of(it.span.start);
                for a in &c.arguments {
                    match a {
                        Argument::SpreadElement(s) => self.spread(&s.argument, line, &mut acc),
                        a => {
                            if let Some(x) = a.as_expression()
                                && !is_container(x)
                            {
                                self.collect(x, 1, true, &mut acc);
                            }
                        }
                    }
                }
                if acc.refs() > 0 {
                    let entry = self.calls.entry(receiver).or_insert((line, Acc::default()));
                    entry.1.items.extend(acc.items);
                    entry.1.spreads.extend(acc.spreads);
                    entry.1.opaque |= acc.opaque;
                }
            }
        }
        walk::walk_expression_statement(self, it);
    }
}
