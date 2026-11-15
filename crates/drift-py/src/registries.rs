//! Lists of references (registries) and autodiscovery markers, at lowering time.
//!
//! The Python counterpart of the TypeScript finder: module-level list, tuple and
//! dict bindings (`urlpatterns = [...]`, `INSTALLED_APPS = [...]`, also `+=` and
//! `.extend`), container arguments of calls (`Celery("proj", include=[...])`), and
//! the arguments of every statement-level call on one receiver
//! (`admin.site.register(A)`, `app.register_blueprint(bp)`), at module level and in
//! top-level functions (app factories). Items are references, or module paths
//! written as strings directly in a list (`"dcim"`, `"proj.tasks"`), which the
//! linker resolves like imports. Wiring rules (`drift-mine`'s `wiring` module)
//! read them.

use super::*;

/// Deepest nesting followed inside one list.
const MAX_LIST_DEPTH: usize = 5;
/// Statement nesting followed into `if`/`try`/`with` blocks.
const MAX_BLOCK_DEPTH: usize = 6;

/// Marker in [`RawFile::discovers`]: the file calls Celery's `autodiscover_tasks()`.
pub const CELERY_AUTODISCOVER: &str = "celery:autodiscover_tasks";

/// A module path string: dotted identifiers (`dcim`, `proj.tasks`, `a.apps.AConfig`).
fn is_module_path(s: &str) -> bool {
    !s.is_empty()
        && s.split('.').all(|seg| {
            let mut c = seg.chars();
            c.next()
                .is_some_and(|f| f.is_ascii_alphabetic() || f == '_')
                && c.all(|x| x.is_ascii_alphanumeric() || x == '_')
        })
}

pub(crate) struct ListFinder<'l, 't> {
    l: &'l Lowerer<'t>,
    lists: Vec<RawRefList>,
    bindings: BTreeMap<String, (u32, Vec<(RawListItem, u32)>)>,
    calls: BTreeMap<RawRef, (u32, Vec<(RawListItem, u32)>)>,
    discovers: BTreeSet<String>,
}

impl<'l, 't> ListFinder<'l, 't> {
    pub(crate) fn new(l: &'l Lowerer<'t>) -> Self {
        Self {
            l,
            lists: Vec::new(),
            bindings: BTreeMap::new(),
            calls: BTreeMap::new(),
            discovers: BTreeSet::new(),
        }
    }

    pub(crate) fn finish(mut self) -> (Vec<RawRefList>, Vec<String>) {
        for (name, (line, items)) in std::mem::take(&mut self.bindings) {
            self.push(RawListSlot::Binding(name), line, items);
        }
        for (receiver, (line, items)) in std::mem::take(&mut self.calls) {
            self.push(RawListSlot::Calls(receiver), line, items);
        }
        self.lists.sort();
        self.lists.dedup();
        (self.lists, self.discovers.into_iter().collect())
    }

    fn push(&mut self, slot: RawListSlot, line: u32, items: Vec<(RawListItem, u32)>) {
        let items: Vec<_> = items
            .into_iter()
            .filter(|(i, _)| {
                !matches!(
                    i,
                    RawListItem::Ref(RawRef {
                        base: RawBase::Global(_),
                        ..
                    })
                )
            })
            .collect();
        // A list of only what Drift cannot read (`[*helpers()]`) is kept: the
        // linker records it as opaque, so its members are unknown, not missing.
        if !items.is_empty() {
            self.lists.push(RawRefList { slot, line, items });
        }
    }

    /// Walk the module body: bindings and calls at module level, calls in top-level
    /// functions.
    pub(crate) fn module(&mut self, body: &[Stmt]) {
        self.block(body, true, 0);
    }

    fn block(&mut self, body: &[Stmt], module: bool, depth: usize) {
        if depth > MAX_BLOCK_DEPTH {
            return;
        }
        for stmt in body {
            match stmt {
                Stmt::FunctionDef(f) if module => self.block(&f.body, false, depth + 1),
                Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {}
                Stmt::If(i) => {
                    self.block(&i.body, module, depth + 1);
                    for c in &i.elif_else_clauses {
                        self.block(&c.body, module, depth + 1);
                    }
                }
                Stmt::Try(t) => {
                    self.block(&t.body, module, depth + 1);
                    for h in &t.handlers {
                        let ast::ExceptHandler::ExceptHandler(h) = h;
                        self.block(&h.body, module, depth + 1);
                    }
                    self.block(&t.orelse, module, depth + 1);
                    self.block(&t.finalbody, module, depth + 1);
                }
                Stmt::With(w) => self.block(&w.body, module, depth + 1),
                Stmt::Assign(a) => {
                    if module
                        && let [Expr::Name(n)] = a.targets.as_slice()
                        && is_container(&a.value)
                    {
                        self.binding(n.id.as_str(), &a.value);
                    }
                    if module {
                        self.exprs_in(&a.value);
                    }
                }
                Stmt::AnnAssign(a) => {
                    if let Some(v) = &a.value {
                        if module
                            && let Expr::Name(n) = &*a.target
                            && is_container(v)
                        {
                            self.binding(n.id.as_str(), v);
                        }
                        if module {
                            self.exprs_in(v);
                        }
                    }
                }
                Stmt::AugAssign(a) => {
                    if module
                        && let Expr::Name(n) = &*a.target
                        && matches!(a.op, ast::Operator::Add)
                    {
                        self.binding(n.id.as_str(), &a.value);
                    }
                    if module {
                        self.exprs_in(&a.value);
                    }
                }
                Stmt::Expr(e) => {
                    if let Expr::Call(c) = &*e.value {
                        self.statement_call(c, module);
                    }
                    if module {
                        self.exprs_in(&e.value);
                    }
                }
                _ => {}
            }
        }
    }

    /// `NAME = [...]`, `NAME += [...]`.
    fn binding(&mut self, name: &str, value: &Expr) {
        let mut items = Vec::new();
        self.collect(value, 0, true, &mut items);
        let line = self.l.line(value);
        let e = self
            .bindings
            .entry(name.to_string())
            .or_insert((line, Vec::new()));
        e.1.extend(items);
    }

    /// `recv.method(args)` as a statement; `NAME.extend([...])` / `NAME.append(x)`
    /// add to a module-level list binding.
    fn statement_call(&mut self, c: &ast::ExprCall, module: bool) {
        let Expr::Attribute(a) = &*c.func else {
            return;
        };
        if module
            && let Expr::Name(n) = &*a.value
            && matches!(a.attr.as_str(), "extend" | "append" | "insert")
            && self.bindings.contains_key(n.id.as_str())
        {
            for x in c.arguments.args.iter() {
                self.binding(n.id.as_str(), x);
            }
            return;
        }
        if matches!(&*a.value, Expr::Call(_)) {
            return;
        }
        let receiver = match self.l.canon(&a.value) {
            Some(RawRef {
                base: RawBase::Global(n),
                member,
            }) if !stdlib::is_builtin(&n) => Some(RawRef {
                base: RawBase::Local(format!("~{n}")),
                member,
            }),
            r => r,
        };
        let Some(receiver) = receiver.filter(|r| !matches!(r.base, RawBase::Global(_))) else {
            return;
        };
        let mut items = Vec::new();
        for x in c.arguments.args.iter() {
            self.collect(x, 1, false, &mut items);
        }
        for k in c.arguments.keywords.iter() {
            self.collect(&k.value, 1, false, &mut items);
        }
        if !items.is_empty() {
            let line = self.l.line(c);
            let e = self.calls.entry(receiver).or_insert((line, Vec::new()));
            e.1.extend(items);
        }
    }

    /// Container arguments of every call inside `e`, and autodiscovery markers.
    fn exprs_in(&mut self, e: &Expr) {
        struct Calls<'e>(Vec<&'e ast::ExprCall>);
        impl<'e> Visitor<'e> for Calls<'e> {
            fn visit_expr(&mut self, e: &'e Expr) {
                if let Expr::Call(c) = e {
                    self.0.push(c);
                }
                if !matches!(e, Expr::Lambda(_)) {
                    visitor::walk_expr(self, e);
                }
            }
        }
        let mut found = Calls(Vec::new());
        found.visit_expr(e);
        for c in found.0 {
            if let Expr::Attribute(a) = &*c.func
                && a.attr.as_str() == "autodiscover_tasks"
            {
                self.discovers.insert(CELERY_AUTODISCOVER.to_string());
            }
            let Some(callee) = self.l.canon(&c.func) else {
                continue;
            };
            if matches!(callee.base, RawBase::Global(_)) {
                continue;
            }
            let slots = c
                .arguments
                .args
                .iter()
                .enumerate()
                .map(|(i, x)| (u32::try_from(i).unwrap_or(u32::MAX), String::new(), x))
                .chain(c.arguments.keywords.iter().filter_map(|k| {
                    k.arg
                        .as_ref()
                        .map(|n| (KWARG_INDEX, n.as_str().to_string(), &k.value))
                }));
            for (index, key, x) in slots {
                if !is_container(x) {
                    continue;
                }
                let mut items = Vec::new();
                self.collect(x, 0, true, &mut items);
                let slot = RawListSlot::Arg {
                    callee: callee.clone(),
                    index,
                    key,
                };
                let line = self.l.line(x);
                self.push(slot, line, items);
            }
        }
    }

    /// References inside a list element: names and attributes, the callee and
    /// arguments of calls, dict values, nested containers, spreads; strings
    /// directly in a list when `strings` (module paths such as `INSTALLED_APPS`
    /// entries), and modules `include()`d by string anywhere.
    ///
    /// `strings` also marks a direct element of a list. There a lambda, or a call
    /// whose arguments name nothing (`make_urls()`), holds what no reference
    /// describes, as does a spread of anything but a name (`*helper()`): the list
    /// gets an [`RawListItem::Opaque`] marker.
    fn collect(&self, e: &Expr, depth: usize, strings: bool, out: &mut Vec<(RawListItem, u32)>) {
        if depth > MAX_LIST_DEPTH {
            return;
        }
        let line = self.l.line(e);
        match e {
            Expr::Name(_) | Expr::Attribute(_) => {
                if let Some(r) = self.l.canon(e) {
                    out.push((RawListItem::Ref(r), line));
                }
            }
            Expr::Call(c) => {
                if let Some(r) = self.l.canon(&c.func) {
                    out.push((RawListItem::Ref(r), line));
                }
                let include = match &*c.func {
                    Expr::Name(n) => n.id.as_str() == "include",
                    Expr::Attribute(a) => a.attr.as_str() == "include",
                    _ => false,
                };
                let before = out.len();
                for x in c.arguments.args.iter() {
                    if include
                        && let Some(s) = string_value(x)
                        && is_module_path(&s)
                    {
                        out.push((RawListItem::Include(s), line));
                        continue;
                    }
                    self.collect(x, depth + 1, false, out);
                }
                for k in c.arguments.keywords.iter() {
                    self.collect(&k.value, depth + 1, false, out);
                }
                let bare = matches!(&*c.func, Expr::Name(_));
                if strings && bare && out.len() == before {
                    out.push((RawListItem::Opaque, line));
                }
            }
            Expr::List(_) | Expr::Tuple(_) | Expr::Set(_) => {
                for x in elements(e).unwrap_or_default() {
                    self.collect(x, depth + 1, strings, out);
                }
            }
            Expr::Dict(d) => {
                for item in &d.items {
                    match &item.key {
                        // `{**extra}` spreads a mapping.
                        None => self.spread(&item.value, line, out),
                        Some(_) => self.collect(&item.value, depth + 1, false, out),
                    }
                }
            }
            Expr::Starred(s) => self.spread(&s.value, line, out),
            Expr::Lambda(_) if strings => out.push((RawListItem::Opaque, line)),
            Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
                self.collect(&b.left, depth + 1, strings, out);
                self.collect(&b.right, depth + 1, strings, out);
            }
            Expr::StringLiteral(_) if strings => {
                if let Some(s) = string_value(e)
                    && is_module_path(&s)
                {
                    out.push((RawListItem::Module(s), line));
                }
            }
            _ => {}
        }
    }

    /// `*x`: a name stands for that list's items; anything else is opaque.
    fn spread(&self, e: &Expr, line: u32, out: &mut Vec<(RawListItem, u32)>) {
        match e {
            Expr::Name(_) | Expr::Attribute(_) => match self.l.canon(e) {
                Some(r) => out.push((RawListItem::Spread(r), line)),
                None => out.push((RawListItem::Opaque, line)),
            },
            _ => out.push((RawListItem::Opaque, line)),
        }
    }
}

fn is_container(e: &Expr) -> bool {
    matches!(
        e,
        Expr::List(_) | Expr::Tuple(_) | Expr::Set(_) | Expr::Dict(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_paths() {
        assert!(is_module_path("dcim"));
        assert!(is_module_path("proj.tasks"));
        assert!(is_module_path("a.apps.AConfig"));
        assert!(!is_module_path("user-list"));
        assert!(!is_module_path("users/"));
        assert!(!is_module_path(""));
        assert!(!is_module_path("a..b"));
    }
}
