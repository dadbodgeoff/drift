//! Method calls on a value `calls` does not hold
//! ([`drift_core::Symbol::receiver_calls`]), and what a function hands back
//! ([`drift_core::Symbol::returns_instance`]).
//!
//! A call whose receiver starts at a local or a parameter has no canonical reference
//! (`svc.list(org)` after `svc = RuleBook(db)`; `exporter.run(user_id)` on an
//! `exporter=Depends(get_exporter)`), so the body's `calls` leave it out. It is
//! recorded here by what the receiver is, where the body says so, and by the
//! receiver's own name where it does not and the call hands a value on. Nothing is
//! decided about what the call does: mining follows it, or reads it as unread.

use std::collections::HashMap;

use ruff_python_ast::visitor::{self, Visitor};
use ruff_python_ast::{self as ast, Expr, Stmt};

use super::{Collector, Lowerer, MAX_MEMBER_DEPTH, hands_value_on, target_names, type_expr};
use crate::raw::*;

/// Names followed at most from a receiver to what it is bound to.
const MAX_RECEIVER_HOPS: usize = 8;

/// How a function's own scope binds one local name.
#[derive(Debug, Default)]
pub(crate) struct Binding<'t> {
    /// The values of its plain assignments (`name = value`, `name: T = value`).
    values: Vec<&'t Expr>,
    /// It is bound some other way too (a loop or `with` target, an `except ... as`, a
    /// tuple target, an import, a definition, a walrus, `nonlocal` in a nested
    /// function, a parameter): what it holds cannot be told.
    other: bool,
    /// Functions the body defines under the name (`def parse(text): ...`): what such
    /// a function does is in the body's own facts.
    defs: u32,
}

/// What a receiver expression is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Recv {
    /// A string, a number or a bytes value: its methods and what they return are
    /// plain values too.
    Text,
    /// A list, dict, set or tuple built in place: its own methods are plain calls,
    /// what it holds is not known.
    Container,
    /// A reference the linker can name (`RuleBook()`, `get_exporter()`), with how
    /// many calls on the way still name what the class is (one for a module-level
    /// name: the call that builds the instance or asks a factory for it; none for an
    /// instance), and whether the facts can tell what it is at all. What a method of
    /// an instance hands back (`repo.counts().get`), an element, and an attribute of
    /// `self` that the class's own `__init__` does not type are named, but not known:
    /// a call on them is recorded only where it hands a value on.
    Ref(RawRef, u8, bool),
    /// It cannot be told: the label names the receiver (`param:exporter`,
    /// `local:row.owner`).
    Unknown(String),
}

/// Annotation names of plain values: a call on a parameter typed by one is a plain
/// call.
const TEXT_TYPES: &[&str] = &["str", "int", "float", "bool", "bytes", "complex"];
const CONTAINER_TYPES: &[&str] = &[
    "dict",
    "list",
    "set",
    "tuple",
    "frozenset",
    "Dict",
    "List",
    "Set",
    "Tuple",
    "FrozenSet",
    "Sequence",
    "Mapping",
    "MutableMapping",
    "Iterable",
    "Collection",
];

/// How `params` and `body` bind each local name of a function's own scope (nested
/// functions, classes, lambdas and comprehensions have their own).
pub(crate) fn local_bindings<'t>(
    params: &ast::Parameters,
    body: &'t [Stmt],
) -> HashMap<String, Binding<'t>> {
    let mut out: HashMap<String, Binding<'t>> = HashMap::new();
    for p in params.iter() {
        out.entry(p.name().as_str().to_string()).or_default().other = true;
    }
    for s in body {
        bind(s, &mut out);
    }
    // A nested function that rebinds a name of this scope.
    let mut n = Nonlocals { names: Vec::new() };
    for s in body {
        n.visit_stmt(s);
    }
    for name in n.names {
        out.entry(name).or_default().other = true;
    }
    out
}

fn other<'t>(e: &Expr, out: &mut HashMap<String, Binding<'t>>) {
    let mut names = Vec::new();
    target_names(e, &mut names);
    for n in names {
        out.entry(n.to_string()).or_default().other = true;
    }
}

fn bind<'t>(stmt: &'t Stmt, out: &mut HashMap<String, Binding<'t>>) {
    let mark = |name: &str, out: &mut HashMap<String, Binding<'t>>| {
        out.entry(name.to_string()).or_default().other = true;
    };
    let block = |body: &'t [Stmt], out: &mut HashMap<String, Binding<'t>>| {
        for s in body {
            bind(s, out);
        }
    };
    match stmt {
        Stmt::FunctionDef(f) => out.entry(f.name.to_string()).or_default().defs += 1,
        Stmt::ClassDef(c) => mark(c.name.as_str(), out),
        Stmt::Assign(a) => match a.targets.as_slice() {
            [Expr::Name(n)] => out
                .entry(n.id.as_str().to_string())
                .or_default()
                .values
                .push(&a.value),
            targets => targets.iter().for_each(|t| other(t, out)),
        },
        Stmt::AnnAssign(a) => match (a.target.as_ref(), &a.value) {
            (Expr::Name(n), Some(v)) => out
                .entry(n.id.as_str().to_string())
                .or_default()
                .values
                .push(v),
            (t, _) => other(t, out),
        },
        // `rows += more` keeps what `rows` is.
        Stmt::AugAssign(_) => {}
        Stmt::TypeAlias(t) => other(&t.name, out),
        Stmt::For(f) => {
            other(&f.target, out);
            block(&f.body, out);
            block(&f.orelse, out);
        }
        Stmt::While(w) => {
            block(&w.body, out);
            block(&w.orelse, out);
        }
        Stmt::If(i) => {
            block(&i.body, out);
            for c in &i.elif_else_clauses {
                block(&c.body, out);
            }
        }
        Stmt::With(w) => {
            for item in &w.items {
                if let Some(v) = &item.optional_vars {
                    other(v, out);
                }
            }
            block(&w.body, out);
        }
        Stmt::Try(t) => {
            block(&t.body, out);
            for h in &t.handlers {
                let ast::ExceptHandler::ExceptHandler(h) = h;
                if let Some(n) = &h.name {
                    mark(n.as_str(), out);
                }
                block(&h.body, out);
            }
            block(&t.orelse, out);
            block(&t.finalbody, out);
        }
        Stmt::Match(m) => {
            let mut names = Names { names: Vec::new() };
            for case in &m.cases {
                names.visit_pattern(&case.pattern);
                block(&case.body, out);
            }
            for n in names.names {
                mark(&n, out);
            }
        }
        Stmt::Import(i) => {
            for a in &i.names {
                let full = a.name.as_str();
                let local = a
                    .asname
                    .as_ref()
                    .map_or_else(|| full.split('.').next().unwrap_or(full), |x| x.as_str());
                mark(local, out);
            }
        }
        Stmt::ImportFrom(i) => {
            for a in &i.names {
                mark(
                    a.asname.as_ref().map_or(a.name.as_str(), |x| x.as_str()),
                    out,
                );
            }
        }
        Stmt::Delete(d) => d.targets.iter().for_each(|t| other(t, out)),
        _ => {}
    }
    // Walrus targets bind in the enclosing function, wherever they are written.
    let mut w = Walrus { names: Vec::new() };
    w.statement(stmt);
    for n in w.names {
        mark(&n, out);
    }
}

/// Names a `match` pattern binds.
struct Names {
    names: Vec<String>,
}

impl<'a> Visitor<'a> for Names {
    fn visit_pattern(&mut self, p: &'a ast::Pattern) {
        use ast::Pattern as P;
        match p {
            P::MatchAs(m) => self.names.extend(m.name.iter().map(|n| n.to_string())),
            P::MatchStar(m) => self.names.extend(m.name.iter().map(|n| n.to_string())),
            P::MatchMapping(m) => self.names.extend(m.rest.iter().map(|n| n.to_string())),
            _ => {}
        }
        visitor::walk_pattern(self, p);
    }
}

/// Walrus targets in the expressions of one statement itself: not in the statements
/// of its blocks (each is walked by [`bind`]), nor in nested scopes.
struct Walrus {
    names: Vec<String>,
}

impl Walrus {
    fn statement(&mut self, s: &Stmt) {
        match s {
            Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {}
            Stmt::If(i) => {
                self.visit_expr(&i.test);
                for c in &i.elif_else_clauses {
                    if let Some(t) = &c.test {
                        self.visit_expr(t);
                    }
                }
            }
            Stmt::While(w) => self.visit_expr(&w.test),
            Stmt::For(f) => self.visit_expr(&f.iter),
            Stmt::With(w) => {
                for item in &w.items {
                    self.visit_expr(&item.context_expr);
                }
            }
            Stmt::Try(_) | Stmt::Match(_) => {}
            other => visitor::walk_stmt(self, other),
        }
    }
}

impl<'a> Visitor<'a> for Walrus {
    fn visit_expr(&mut self, e: &'a Expr) {
        if let Expr::Named(n) = e
            && let Expr::Name(t) = n.target.as_ref()
        {
            self.names.push(t.id.as_str().to_string());
        }
        if !matches!(e, Expr::Lambda(_)) {
            visitor::walk_expr(self, e);
        }
    }
}

/// Names a nested function declares `nonlocal` (or `global`).
struct Nonlocals {
    names: Vec<String>,
}

impl<'a> Visitor<'a> for Nonlocals {
    fn visit_stmt(&mut self, s: &'a Stmt) {
        match s {
            Stmt::Nonlocal(n) => self.names.extend(n.names.iter().map(|x| x.to_string())),
            Stmt::Global(g) => self.names.extend(g.names.iter().map(|x| x.to_string())),
            _ => {}
        }
        visitor::walk_stmt(self, s);
    }
}

/// The leftmost name of a receiver expression (`row` of `row.owner[0].save`).
fn root_name(e: &Expr) -> Option<&str> {
    match e {
        Expr::Name(n) => Some(n.id.as_str()),
        Expr::Attribute(a) => root_name(&a.value),
        Expr::Call(c) => root_name(&c.func),
        Expr::Subscript(s) => root_name(&s.value),
        Expr::Await(a) => root_name(&a.value),
        _ => None,
    }
}

/// What a parameter annotation says of a plain value: `str`, `dict[str, int]`,
/// `Annotated[list[str], ...]`, `str | None`.
fn plain_annotation(e: &Expr) -> Option<Recv> {
    let name = |e: &Expr| match e {
        Expr::Name(n) => Some(n.id.to_string()),
        Expr::Attribute(a) => Some(a.attr.to_string()),
        _ => None,
    };
    let of = |n: &str| {
        if TEXT_TYPES.contains(&n) {
            Some(Recv::Text)
        } else if CONTAINER_TYPES.contains(&n) {
            Some(Recv::Container)
        } else {
            None
        }
    };
    match e {
        Expr::Name(_) | Expr::Attribute(_) => of(&name(e)?),
        Expr::Subscript(s) => {
            let head = name(&s.value)?;
            if matches!(head.as_str(), "Annotated" | "Optional") {
                match s.slice.as_ref() {
                    Expr::Tuple(t) => t.elts.first().and_then(plain_annotation),
                    inner => plain_annotation(inner),
                }
            } else {
                of(&head)
            }
        }
        Expr::BinOp(b) if matches!(b.op, ast::Operator::BitOr) => {
            if matches!(b.right.as_ref(), Expr::NoneLiteral(_)) {
                plain_annotation(&b.left)
            } else if matches!(b.left.as_ref(), Expr::NoneLiteral(_)) {
                plain_annotation(&b.right)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// The parameters of a function annotated as plain values.
pub(crate) fn plain_params(params: &ast::Parameters) -> HashMap<String, Recv> {
    let mut out = HashMap::new();
    for p in params.iter() {
        if let Some(r) = p.annotation().and_then(plain_annotation) {
            out.insert(p.name().as_str().to_string(), r);
        }
    }
    // `*args` is a tuple and `**kwargs` a dict.
    for rest in [&params.vararg, &params.kwarg].into_iter().flatten() {
        out.insert(rest.name.as_str().to_string(), Recv::Container);
    }
    out
}

fn push(r: &mut RawRef, member: &str) -> bool {
    if r.member.matches('.').count() >= MAX_MEMBER_DEPTH {
        return false;
    }
    r.member.push('.');
    r.member.push_str(member);
    true
}

impl<'t> Collector<'_, 't> {
    /// What a receiver expression is ([`Recv`]).
    pub(crate) fn receiver(&self, e: &Expr, hops: usize) -> Recv {
        let unknown = |e: &Expr| {
            Recv::Unknown(match root_name(e) {
                Some(n) if self.is_param(n) => format!("param:{n}"),
                Some(n) => format!("local:{n}"),
                None => "local:(value)".to_string(),
            })
        };
        if hops > MAX_RECEIVER_HOPS {
            return unknown(e);
        }
        match e {
            Expr::Await(a) => self.receiver(&a.value, hops + 1),
            Expr::Named(n) => self.receiver(&n.value, hops + 1),
            Expr::StringLiteral(_)
            | Expr::BytesLiteral(_)
            | Expr::NumberLiteral(_)
            | Expr::BooleanLiteral(_)
            | Expr::FString(_) => Recv::Text,
            Expr::List(_)
            | Expr::Dict(_)
            | Expr::Set(_)
            | Expr::Tuple(_)
            | Expr::ListComp(_)
            | Expr::DictComp(_)
            | Expr::SetComp(_) => Recv::Container,
            Expr::Name(n) => self.receiver_name(n.id.as_str(), hops),
            Expr::Attribute(a) => {
                // `self.repo` where `__init__` says what `repo` is.
                if matches!(a.value.as_ref(), Expr::Name(s) if s.id.as_str() == "self")
                    && self.is_param("self")
                {
                    if let Some(ty) = self.l.self_types.get(a.attr.as_str()) {
                        return Recv::Ref(ty.clone(), 0, true);
                    }
                    // A base class's `__init__` may say what it is: named by the
                    // class, for mining to look up ([`drift_core::Symbol::attr_types`]).
                    if self.frames.len() == 1
                        && let Some(class) = &self.l.self_class
                    {
                        return Recv::Ref(
                            RawRef {
                                base: RawBase::Local(class.clone()),
                                member: format!(".{}", a.attr),
                            },
                            0,
                            false,
                        );
                    }
                }
                match self.receiver(&a.value, hops + 1) {
                    // A framework object's free-form bag (`request.state`,
                    // `request.app.state`): what it holds is whatever the application
                    // put there, a service of the repository as well as a plain value.
                    Recv::Ref(r, ..)
                        if a.attr.as_str() == "state" && !matches!(r.base, RawBase::Local(_)) =>
                    {
                        match unknown(e) {
                            Recv::Unknown(root) => Recv::Unknown(format!("{root}.state")),
                            other => other,
                        }
                    }
                    Recv::Ref(mut r, calls, sure) => {
                        if push(&mut r, a.attr.as_str()) {
                            Recv::Ref(r, calls, sure)
                        } else {
                            unknown(e)
                        }
                    }
                    Recv::Unknown(mut label) => {
                        label.push('.');
                        label.push_str(a.attr.as_str());
                        Recv::Unknown(label)
                    }
                    // An attribute of a container is its method; of text, text.
                    plain => plain,
                }
            }
            Expr::Call(c) => match self.receiver(&c.func, hops + 1) {
                Recv::Ref(mut r, calls, sure) => {
                    if !r.member.ends_with("()") {
                        r.member.push_str("()");
                    }
                    Recv::Ref(r, calls.saturating_sub(1), sure && calls > 0)
                }
                Recv::Text => Recv::Text,
                // What a container's method hands back is what it holds.
                Recv::Container => unknown(e),
                u => u,
            },
            Expr::Subscript(s) => match self.receiver(&s.value, hops + 1) {
                Recv::Ref(mut r, _, _) => {
                    if push(&mut r, "__getitem__") {
                        r.member.push_str("()");
                        Recv::Ref(r, 0, false)
                    } else {
                        unknown(e)
                    }
                }
                Recv::Text => Recv::Text,
                Recv::Container => unknown(e),
                u => u,
            },
            _ => unknown(e),
        }
    }

    /// `name` is a parameter of the function being walked.
    fn is_param(&self, name: &str) -> bool {
        self.frames
            .last()
            .is_some_and(|(_, params)| params.contains(name))
    }

    fn receiver_name(&self, name: &str, hops: usize) -> Recv {
        let local = |name: &str| Recv::Unknown(format!("local:{name}"));
        // A module-level or imported name (imported inside the function too).
        if let Some(base) = self.resolve(name) {
            return Recv::Ref(
                RawRef {
                    base,
                    member: String::new(),
                },
                1,
                true,
            );
        }
        let Some((scope, params)) = self.frames.last() else {
            return local(name);
        };
        // A comprehension or lambda inside the function binds it, or it is a name of
        // an enclosing function.
        if self
            .scopes
            .iter()
            .skip(scope + 1)
            .any(|s| s.names.contains_key(name))
            || !self
                .scopes
                .get(*scope)
                .is_some_and(|s| s.names.contains_key(name))
        {
            return local(name);
        }
        let bindings = self.recv_locals.last();
        if params.contains(name) {
            // Rebound in the body: what it holds there cannot be told.
            if bindings
                .and_then(|b| b.get(name))
                .is_some_and(|b| !b.values.is_empty())
            {
                return Recv::Unknown(format!("param:{name}"));
            }
            if let Some(ty) = self.param_types.last().and_then(|t| t.get(name)) {
                // `x: Any` says nothing of what `x` is.
                if typing_name(ty) {
                    return Recv::Unknown(format!("param:{name}"));
                }
                return Recv::Ref(ty.clone(), 0, true);
            }
            if let Some(plain) = self.plain_params.last().and_then(|p| p.get(name)) {
                return plain.clone();
            }
            if let Some(RawOperand::Dep(d, _)) = self.param_ops.last().and_then(|o| o.get(name)) {
                return dependency_result(d).map_or_else(
                    || Recv::Unknown(format!("param:{name}")),
                    |r| Recv::Ref(r, 0, true),
                );
            }
            return Recv::Unknown(format!("param:{name}"));
        }
        let Some(b) = bindings.and_then(|b| b.get(name)) else {
            return local(name);
        };
        // A function the body defines: calling it runs what the body's own facts
        // already hold.
        if b.defs == 1 && !b.other && b.values.is_empty() {
            return Recv::Text;
        }
        if b.other || b.defs > 0 || b.values.is_empty() {
            return local(name);
        }
        // `query = query.where(...)` keeps what `query` is: a builder handing itself
        // back. Only the other bindings say what it is.
        let mut all = b
            .values
            .iter()
            .filter(|v| {
                !(matches!(v, Expr::Call(_) | Expr::Await(_)) && root_name(v) == Some(name))
            })
            .map(|v| self.receiver(v, hops + 1));
        let first = all.next().unwrap_or_else(|| local(name));
        if matches!(first, Recv::Unknown(_)) || all.any(|r| r != first) {
            return local(name);
        }
        first
    }

    /// `super().__init__(caller, org_id)` in a method of a class runs the method of
    /// the class's base: recorded as a receiver call of the one base's method, so a
    /// check there is read (`calls` keeps `super().__init__`, as before). With several
    /// bases which method runs is not told: a call on a receiver that cannot be read.
    pub(crate) fn note_super(&mut self, c: &ast::ExprCall) {
        let Expr::Attribute(a) = c.func.as_ref() else {
            return;
        };
        let Expr::Call(s) = a.value.as_ref() else {
            return;
        };
        if !matches!(s.func.as_ref(), Expr::Name(n) if n.id.as_str() == "super")
            || !s.arguments.is_empty()
            || self.l.self_class.is_none()
            || self.frames.len() != 1
            || !self.is_param("self")
        {
            return;
        }
        match self.l.self_bases.as_slice() {
            [] => {}
            [base] => {
                if !matches!(base.base, RawBase::Global(_)) {
                    let mut r = base.clone();
                    r.member.push('.');
                    r.member.push_str(a.attr.as_str());
                    self.note_dominance(&r);
                    self.receiver_calls.insert(RawReceiverCall::Ref(r));
                }
            }
            _ => {
                self.receiver_calls
                    .insert(RawReceiverCall::Unread(format!("local:super().{}", a.attr)));
            }
        }
    }

    /// Record a call `calls` does not hold ([`drift_core::Symbol::receiver_calls`]):
    /// by what its receiver is, or, where that cannot be told and the call hands a
    /// value on, by the receiver's name.
    pub(crate) fn note_receiver_call(&mut self, c: &ast::ExprCall) {
        // A sibling method through `self` is the class's member already; one the
        // class body does not define is a base's.
        if let Expr::Attribute(a) = c.func.as_ref()
            && matches!(a.value.as_ref(), Expr::Name(s) if s.id.as_str() == "self")
            && self.is_param("self")
            && self.frames.len() == 1
            && let Some(class) = &self.l.self_class
        {
            let sibling = RawRef {
                base: RawBase::Local(class.clone()),
                member: format!(".{}", a.attr),
            };
            // A sibling method is called here: on every path, or conditionally.
            self.note_dominance(&sibling);
            self.note_arg_sides(&sibling, c);
            if !self.l.self_methods.contains(a.attr.as_str())
                && !self.l.self_types.contains_key(a.attr.as_str())
            {
                self.receiver_calls.insert(RawReceiverCall::Ref(sibling));
            }
            return;
        }
        // The call that hands control on (the view a decorator wraps, `call_next`) is
        // the continuation, not a method of a value.
        if self.continues(c) {
            return;
        }
        match self.receiver(&c.func, 0) {
            Recv::Text | Recv::Container => {}
            Recv::Ref(r, _, sure) => {
                // What a built-in hands back (`rows = list(x)`) is a plain value; what
                // `getattr(service, operation)` hands back is whatever method was
                // asked for, and calling it runs that.
                let looked_up = matches!(&r.base, RawBase::Global(g) if g == "getattr")
                    && r.member.starts_with("()");
                if looked_up
                    || (!matches!(r.base, RawBase::Global(_)) && (sure || hands_value_on(c)))
                {
                    self.note_dominance(&r);
                    if !looked_up {
                        self.note_arg_sides(&r, c);
                    }
                    self.receiver_calls.insert(RawReceiverCall::Ref(r));
                }
            }
            Recv::Unknown(label) => {
                if hands_value_on(c) {
                    self.note_prior(RawReceiverCall::Unread(label.clone()));
                    self.receiver_calls.insert(RawReceiverCall::Unread(label));
                }
            }
        }
    }
}

/// The value a dependency hands its parameter, as a reference: the call of what
/// `Depends` names (`Depends(get_exporter)` -> `get_exporter()`, `Depends(Pagination)`
/// -> `Pagination()`), or of an instance made in place (`Depends(Limiter(...))` ->
/// `Limiter().__call__()`). None for an alias that may name anything.
fn dependency_result(d: &RawDep) -> Option<RawRef> {
    match d {
        RawDep::Direct(r) => {
            let mut r = r.clone();
            if !r.member.ends_with("()") {
                r.member.push_str("()");
            }
            Some(r)
        }
        RawDep::Instance(r, _) => {
            let mut r = r.clone();
            if !r.member.ends_with("()") {
                r.member.push_str("()");
            }
            r.member.push_str(".__call__()");
            Some(r)
        }
        RawDep::Alias(_) | RawDep::Unread(_) | RawDep::Gives(_) => None,
        RawDep::Optional(inner) => dependency_result(inner),
    }
}

impl Lowerer<'_> {
    /// What a function hands back: the callee every `return` and `yield` of its own
    /// body calls for the value ([`drift_core::Symbol::returns_instance`]), and the
    /// class its return annotation names ([`drift_core::Symbol::returns_type`]).
    pub(crate) fn returns_instance(
        &self,
        f: &ast::StmtFunctionDef,
    ) -> (Option<RawRef>, Option<RawRef>) {
        let c = Collector::new(self, false);
        let bindings = local_bindings(&f.parameters, &f.body);
        let mut found = Returned {
            values: Vec::new(),
            yields: false,
        };
        for s in &f.body {
            found.visit_stmt(s);
        }
        let callee_of = |e: &Expr| -> Option<RawRef> {
            let e = match e {
                Expr::Await(a) => a.value.as_ref(),
                other => other,
            };
            let call = match e {
                Expr::Call(call) => call,
                // A local bound once to a call.
                Expr::Name(n) => {
                    let b = bindings.get(n.id.as_str())?;
                    let [v] = b.values.as_slice() else {
                        return None;
                    };
                    if b.other {
                        return None;
                    }
                    match v {
                        Expr::Call(call) => call,
                        Expr::Await(a) => match a.value.as_ref() {
                            Expr::Call(call) => call,
                            _ => return None,
                        },
                        _ => return None,
                    }
                }
                _ => return None,
            };
            // The callee is not a local of the function either.
            if root_name(&call.func).is_some_and(|n| bindings.contains_key(n)) {
                return None;
            }
            c.canon(&call.func)
                .filter(|r| !matches!(r.base, RawBase::Global(_)))
        };
        let mut callee: Option<RawRef> = None;
        let mut agree = !found.values.is_empty();
        for v in &found.values {
            match (v.and_then(callee_of), &callee) {
                (Some(r), None) => callee = Some(r),
                (Some(r), Some(c)) if r == *c => {}
                _ => {
                    agree = false;
                    break;
                }
            }
        }
        let annotated = f.returns.as_deref().and_then(|a| {
            let a = if found.yields { yielded_type(a)? } else { a };
            let t = type_expr(a)?;
            c.canon(t)
                .filter(|r| !matches!(r.base, RawBase::Global(_)) && !typing_name(r))
        });
        // Only a call that builds an object says what comes back: a class, by its
        // name as PEP 8 writes one (`RuleBook(...)`, `SessionLocal()`). What a
        // function called there hands back (`return redirect(url)`) is that
        // function's business.
        let builds = |r: &RawRef| {
            let name = match r.member.rsplit('.').next() {
                Some(m) if !m.is_empty() => m.to_string(),
                _ => match &r.base {
                    RawBase::Local(n) | RawBase::Global(n) | RawBase::Star(n) => n.clone(),
                    RawBase::Import { name, .. } => name.clone(),
                },
            };
            name.starts_with(|ch: char| ch.is_ascii_uppercase())
                && name.chars().any(|ch| ch.is_ascii_lowercase())
        };
        (callee.filter(|r| agree && builds(r)), annotated)
    }
}

/// A name of the `typing` module (`Any`, `Self`, a generic's alias): no class whose
/// methods could be read.
fn typing_name(r: &RawRef) -> bool {
    matches!(&r.base, RawBase::Import { spec, .. }
        if matches!(spec.as_str(), "typing" | "typing_extensions" | "collections.abc"))
}

/// The element type of a generator's annotation: `Iterator[T]`, `Generator[T, None,
/// None]`, `AsyncIterator[T]`, `AsyncGenerator[T, None]`.
fn yielded_type(a: &Expr) -> Option<&Expr> {
    let Expr::Subscript(s) = a else { return None };
    let head = match s.value.as_ref() {
        Expr::Name(n) => n.id.as_str(),
        Expr::Attribute(x) => x.attr.as_str(),
        _ => return None,
    };
    if !matches!(
        head,
        "Iterator"
            | "Generator"
            | "AsyncIterator"
            | "AsyncGenerator"
            | "Iterable"
            | "AsyncIterable"
    ) {
        return None;
    }
    match s.slice.as_ref() {
        Expr::Tuple(t) => t.elts.first(),
        other => Some(other),
    }
}

/// The values a function's own body returns or yields (`None` for a bare one).
struct Returned<'a> {
    values: Vec<Option<&'a Expr>>,
    yields: bool,
}

impl<'a> Visitor<'a> for Returned<'a> {
    fn visit_stmt(&mut self, s: &'a Stmt) {
        match s {
            Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {}
            Stmt::Return(r) => {
                self.values.push(r.value.as_deref());
                visitor::walk_stmt(self, s);
            }
            _ => visitor::walk_stmt(self, s),
        }
    }

    fn visit_expr(&mut self, e: &'a Expr) {
        match e {
            Expr::Lambda(_) => {}
            Expr::Yield(y) => {
                self.yields = true;
                self.values.push(y.value.as_deref());
            }
            Expr::YieldFrom(_) => {
                self.yields = true;
                self.values.push(None);
            }
            _ => visitor::walk_expr(self, e),
        }
    }
}
