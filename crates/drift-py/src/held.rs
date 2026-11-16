//! What must have held for a request to get somewhere in a body
//! ([`drift_core::controls::HANDED_AFTER`], [`drift_core::controls::LEAVES_AFTER`],
//! [`drift_core::controls::TRUE_AFTER`]).
//!
//! A wrapper hands a request on by calling the function it was given; a guard lets
//! one through by returning without a refusal, or by running off its end; a test
//! answers for one by a `return` that may give a true value. Each of those is a
//! site. This reads the body from its first statement to each site and keeps, for
//! the site, every call whose value was true on the way there: the test of an `if`
//! the site is under, the test of an `if` that left the function where it did not
//! hold (`if not q.exists(): return Response(status=403)`), a local bound to one
//! (`ok = q.exists()`, then `if ok:`), the operands of an `and`, what `is not
//! None` is said of.
//!
//! Nothing here goes by a name. What a call is (a lookup of the caller, a role
//! test) is said where its arguments are read
//! ([`drift_core::controls::ARG_VALUE`]): this says only that it held.

use std::collections::{BTreeMap, BTreeSet};

use ruff_python_ast::visitor::{self, Visitor};
use ruff_python_ast::{self as ast, Expr, Stmt};

use super::{Collector, RawRef, canon_with};

/// The sites of one function's body, each with the calls that held on the way.
#[derive(Debug, Default)]
pub(crate) struct Sites {
    /// Calls of a function an enclosing function was given.
    pub handed: BTreeSet<Vec<RawRef>>,
    /// Returns that do not refuse, and the end of the body where it is reached.
    pub leaves: BTreeSet<Vec<RawRef>>,
    /// Returns that may give a true value.
    pub truthy: BTreeSet<Vec<RawRef>>,
    /// Some `return` gives `False`.
    pub answers_false: bool,
}

/// What is known where a statement starts.
#[derive(Debug, Default, Clone)]
struct State {
    /// The calls whose value was true on every path here.
    held: BTreeSet<RawRef>,
    /// The locals bound to what a call handed back, by the callee.
    bound: BTreeMap<String, RawRef>,
}

impl State {
    /// What both know: a request got here by either path.
    fn meet(&mut self, other: &State) {
        self.held.retain(|r| other.held.contains(r));
        self.bound.retain(|n, r| other.bound.get(n) == Some(r));
    }
}

struct Walk<'c, 'a, 't> {
    c: &'c Collector<'a, 't>,
    /// The names an enclosing function was given, which this one does not rebind.
    handed: &'c BTreeSet<String>,
    sites: Sites,
}

impl<'t> Collector<'_, 't> {
    /// The sites of the function whose body this is. `handed`: the parameters of
    /// the functions it is defined in.
    pub(crate) fn held_sites(&self, body: &[Stmt], handed: &BTreeSet<String>) -> Sites {
        let mut w = Walk {
            c: self,
            handed,
            sites: Sites::default(),
        };
        let mut state = State::default();
        if !w.block(body, &mut state) {
            w.sites.leaves.insert(state.held.into_iter().collect());
        }
        w.sites
    }
}

impl Walk<'_, '_, '_> {
    /// Walks a block; whether no request runs off its end.
    fn block(&mut self, body: &[Stmt], state: &mut State) -> bool {
        for s in body {
            if self.statement(s, state) {
                return true;
            }
        }
        false
    }

    fn statement(&mut self, s: &Stmt, state: &mut State) -> bool {
        match s {
            Stmt::Return(r) => {
                let value = r.value.as_deref();
                if let Some(v) = value {
                    self.handed_in(v, state);
                }
                if !(self.c.refuses(s) || self.c.rejection(s)) {
                    self.sites
                        .leaves
                        .insert(state.held.iter().cloned().collect());
                }
                match value {
                    Some(Expr::BooleanLiteral(b)) if !b.value => self.sites.answers_false = true,
                    None | Some(Expr::NoneLiteral(_)) => {}
                    Some(v) => {
                        let mut held = state.held.clone();
                        self.holds(v, true, state, &mut held);
                        self.sites.truthy.insert(held.into_iter().collect());
                    }
                }
                true
            }
            Stmt::Raise(_) => true,
            Stmt::Expr(x) => {
                self.handed_in(&x.value, state);
                super::guard_paths::aborts(&x.value) || self.c.denies(&x.value)
            }
            Stmt::Assign(a) => {
                self.handed_in(&a.value, state);
                let bound = match a.targets.as_slice() {
                    [Expr::Name(n)] => self.lookup(&a.value, state).map(|r| (n.id.to_string(), r)),
                    _ => None,
                };
                for t in &a.targets {
                    unbind(t, state);
                }
                if let Some((n, r)) = bound {
                    state.bound.insert(n, r);
                }
                false
            }
            Stmt::AnnAssign(a) => {
                let bound = match (a.target.as_ref(), a.value.as_deref()) {
                    (Expr::Name(n), Some(v)) => {
                        self.handed_in(v, state);
                        self.lookup(v, state).map(|r| (n.id.to_string(), r))
                    }
                    _ => None,
                };
                unbind(&a.target, state);
                if let Some((n, r)) = bound {
                    state.bound.insert(n, r);
                }
                false
            }
            Stmt::AugAssign(a) => {
                self.handed_in(&a.value, state);
                unbind(&a.target, state);
                false
            }
            Stmt::If(i) => self.branches(i, state),
            Stmt::With(w) => self.block(&w.body, state),
            // A loop may run no turn: what its body learns, no later statement
            // knows, and what it rebinds is no longer what was bound.
            Stmt::For(ast::StmtFor { body, orelse, .. })
            | Stmt::While(ast::StmtWhile { body, orelse, .. }) => {
                let mut inside = state.clone();
                inside.bound.clear();
                for name in assigned(body) {
                    state.bound.remove(&name);
                }
                self.block(body, &mut inside);
                let mut after = state.clone();
                self.block(orelse, &mut after);
                false
            }
            Stmt::Match(m) => {
                for c in &m.cases {
                    self.block(&c.body, &mut state.clone());
                    for name in assigned(&c.body) {
                        state.bound.remove(&name);
                    }
                }
                false
            }
            Stmt::Try(t) => {
                // A handler runs for a request that raised anywhere in the body:
                // it knows what was known where the `try` starts.
                let entry = state.clone();
                let mut ends: Vec<State> = Vec::new();
                let mut body = entry.clone();
                if !self.block(&t.body, &mut body) && !self.block(&t.orelse, &mut body) {
                    ends.push(body);
                }
                for h in &t.handlers {
                    let ast::ExceptHandler::ExceptHandler(h) = h;
                    let mut handler = entry.clone();
                    for name in assigned(&t.body) {
                        handler.bound.remove(&name);
                    }
                    if !self.block(&h.body, &mut handler) {
                        ends.push(handler);
                    }
                }
                let Some(mut joined) = ends.pop() else {
                    self.block(&t.finalbody, &mut state.clone());
                    return true;
                };
                for e in &ends {
                    joined.meet(e);
                }
                *state = joined;
                self.block(&t.finalbody, state)
            }
            _ => false,
        }
    }

    fn branches(&mut self, i: &ast::StmtIf, state: &mut State) -> bool {
        // The requests no test so far held for.
        let mut rest = state.clone();
        let mut ends: Vec<State> = Vec::new();
        let mut otherwise = false;
        let tests = std::iter::once((Some(i.test.as_ref()), i.body.as_slice())).chain(
            i.elif_else_clauses
                .iter()
                .map(|c| (c.test.as_ref(), c.body.as_slice())),
        );
        for (test, body) in tests {
            let mut taken = rest.clone();
            match test {
                Some(t) => {
                    self.handed_in(t, &rest);
                    let known = rest.clone();
                    self.holds(t, true, &known, &mut taken.held);
                    self.holds(t, false, &known, &mut rest.held);
                }
                None => otherwise = true,
            }
            if !self.block(body, &mut taken) {
                ends.push(taken);
            }
        }
        if !otherwise {
            ends.push(rest);
        }
        let Some(mut joined) = ends.pop() else {
            return true;
        };
        for e in &ends {
            joined.meet(e);
        }
        *state = joined;
        false
    }

    /// Adds to `held` the calls whose value is true where `e` is `truth`.
    fn holds(&self, e: &Expr, truth: bool, state: &State, held: &mut BTreeSet<RawRef>) {
        match e {
            Expr::UnaryOp(u) if u.op == ast::UnaryOp::Not => {
                self.holds(&u.operand, !truth, state, held);
            }
            // Every operand of a true `and` is true, and of a false `or` false.
            Expr::BoolOp(b) if (b.op == ast::BoolOp::And) == truth => {
                for v in &b.values {
                    self.holds(v, truth, state, held);
                }
            }
            // `x is not None`, `x is None`: said of `x`.
            Expr::Compare(c) => {
                if let ([op], [left, right]) = (&*c.ops, &*c.operands)
                    && matches!(right, Expr::NoneLiteral(_))
                {
                    let found = match op {
                        ast::CmpOp::IsNot | ast::CmpOp::NotEq => truth,
                        ast::CmpOp::Is | ast::CmpOp::Eq => !truth,
                        _ => return,
                    };
                    if found {
                        held.extend(self.lookup(left, state));
                    }
                }
            }
            _ if truth => held.extend(self.lookup(e, state)),
            _ => {}
        }
    }

    /// The callee whose call's value `e` is: a call written here, a local bound to
    /// one, or a method called on such a local (`members.filter(...).exists()`,
    /// the lookup narrowed).
    fn lookup(&self, e: &Expr, state: &State) -> Option<RawRef> {
        match e {
            Expr::Await(a) => self.lookup(&a.value, state),
            Expr::Named(n) => self.lookup(&n.value, state),
            Expr::Name(n) => state.bound.get(n.id.as_str()).cloned(),
            // A query that looks the caller up in what the request names, written
            // on a value the facts give no name (a session a dependency gives): by
            // the rows it reads.
            Expr::Call(c) => self
                .callee(&c.func, state)
                .or_else(|| self.c.caller_lookup(e)),
            _ => None,
        }
    }

    fn callee(&self, func: &Expr, state: &State) -> Option<RawRef> {
        let mut root = func;
        loop {
            root = match root {
                Expr::Attribute(a) => &a.value,
                Expr::Call(c) => &c.func,
                Expr::Name(n) => {
                    let Some(from) = state.bound.get(n.id.as_str()) else {
                        break;
                    };
                    // Read off a local bound to a call: that call's value, then
                    // the rest of the path.
                    let rest =
                        canon_with(func, &|x| (x == n.id.as_str()).then(|| from.base.clone()))?;
                    let mut member = from.member.clone();
                    if !member.ends_with("()") {
                        member.push_str("()");
                    }
                    member.push_str(&rest.member);
                    return Some(RawRef {
                        base: from.base.clone(),
                        member,
                    });
                }
                _ => break,
            };
        }
        self.c.canon(func)
    }

    /// Notes each call in `e` of a function an enclosing function was given.
    fn handed_in(&mut self, e: &Expr, state: &State) {
        if self.handed.is_empty() {
            return;
        }
        struct Finder<'h> {
            handed: &'h BTreeSet<String>,
            found: bool,
        }
        impl<'a> Visitor<'a> for Finder<'_> {
            fn visit_expr(&mut self, e: &'a Expr) {
                match e {
                    Expr::Lambda(_) => {}
                    Expr::Call(c) if matches!(c.func.as_ref(), Expr::Name(n) if self.handed.contains(n.id.as_str())) =>
                    {
                        self.found = true;
                    }
                    _ => visitor::walk_expr(self, e),
                }
            }
        }
        let mut f = Finder {
            handed: self.handed,
            found: false,
        };
        f.visit_expr(e);
        if f.found {
            self.sites
                .handed
                .insert(state.held.iter().cloned().collect());
        }
    }
}

/// The names a target binds are no longer what they were bound to.
fn unbind(target: &Expr, state: &mut State) {
    match target {
        Expr::Name(n) => {
            state.bound.remove(n.id.as_str());
        }
        Expr::Tuple(t) => t.elts.iter().for_each(|e| unbind(e, state)),
        Expr::List(l) => l.elts.iter().for_each(|e| unbind(e, state)),
        Expr::Starred(s) => unbind(&s.value, state),
        _ => {}
    }
}

/// Every name some statement of the block binds, at any depth of it (not in a
/// function or class defined there).
fn assigned(body: &[Stmt]) -> BTreeSet<String> {
    struct Finder(BTreeSet<String>);
    impl Finder {
        fn target(&mut self, e: &Expr) {
            match e {
                Expr::Name(n) => {
                    self.0.insert(n.id.to_string());
                }
                Expr::Tuple(t) => t.elts.iter().for_each(|e| self.target(e)),
                Expr::List(l) => l.elts.iter().for_each(|e| self.target(e)),
                Expr::Starred(s) => self.target(&s.value),
                _ => {}
            }
        }
    }
    impl<'a> Visitor<'a> for Finder {
        fn visit_stmt(&mut self, s: &'a Stmt) {
            match s {
                Stmt::FunctionDef(_) | Stmt::ClassDef(_) => return,
                Stmt::Assign(a) => a.targets.iter().for_each(|t| self.target(t)),
                Stmt::AnnAssign(a) => self.target(&a.target),
                Stmt::AugAssign(a) => self.target(&a.target),
                Stmt::For(f) => self.target(&f.target),
                Stmt::With(w) => {
                    for item in &w.items {
                        if let Some(v) = &item.optional_vars {
                            self.target(v);
                        }
                    }
                }
                _ => {}
            }
            visitor::walk_stmt(self, s);
        }
        fn visit_expr(&mut self, e: &'a Expr) {
            if let Expr::Named(n) = e {
                self.target(&n.target);
            }
            visitor::walk_expr(self, e);
        }
    }
    let mut f = Finder(BTreeSet::new());
    for s in body {
        f.visit_stmt(s);
    }
    f.0
}
