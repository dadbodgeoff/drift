//! Whether a function that turns callers away does so for every request
//! ([`drift_core::controls::REJECTS_SOME`]).
//!
//! [`drift_core::controls::REJECTS_CALLER`] says a body answers "not signed in"
//! somewhere. A guard is a body no request leaves without having passed such a
//! refusal. This reads the paths of one function, from its last statement to its
//! first: a request has passed a refusal once it went by an `if` whose branch
//! always ends by refusing the caller, and the function lets some requests through
//! unrefused where one that passed none returns, runs off the end or is handed on.

use ruff_python_ast::visitor::{self, Visitor};
use ruff_python_ast::{self as ast, Expr, Stmt};
use ruff_text_size::Ranged;

use super::{Collector, RawBase, call_rejection, last_name};

/// What a function's paths say of its refusals ([`Collector::guard_paths`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Paths {
    /// No statement of the function refuses the caller as not signed in or not
    /// allowed.
    Silent,
    /// It refuses, and never returns ([`drift_core::controls::REFUSES_ALL`]).
    RefusesAll,
    /// It refuses, and every request it lets through passed a refusal.
    Every,
    /// It refuses, and lets a request through that passed none
    /// ([`drift_core::controls::REJECTS_SOME`]).
    Some,
}

/// How a block can be left ([`Collector::exits`]).
#[derive(Debug, Default, Clone, Copy)]
struct Exits {
    /// By a `return` that does not refuse.
    returns: bool,
    /// By running off its end.
    falls: bool,
    /// By a refusal: a `raise`, an error answer, `abort(...)`.
    refuses: bool,
    /// By one that says the caller is not signed in or not allowed.
    rejects: bool,
}

/// What happens, from a statement to the end of its function, to a request that
/// has passed no refusal when it gets there.
#[derive(Debug, Default, Clone, Copy)]
struct After {
    /// It does not leave the function unless it is refused or passes a refusal on
    /// the way.
    closed: bool,
    /// And a refusal on the way says the caller is not signed in or not allowed.
    rejects: bool,
}

const CHECKED: After = After {
    closed: true,
    rejects: true,
};

/// Names that say a credential or an identity, beside
/// [`drift_core::controls::names_subject`]: what a condition must read for a branch
/// that returns to be one only a caller with an identity takes.
const CREDENTIAL_WORDS: &[&str] = &[
    "key",
    "keys",
    "apikey",
    "credential",
    "credentials",
    "principal",
    "identity",
    "claims",
    "authorization",
    "authenticated",
    "jwt",
    "bearer",
    "cookie",
    "password",
    "signature",
];

impl<'t> Collector<'_, 't> {
    /// The paths of the function whose body this is, once it is walked (the locals
    /// bound to an error that rejects are known by then).
    pub(crate) fn guard_paths(&self, body: &[Stmt]) -> Paths {
        let mut rejects = false;
        let from_start = self.block(body, After::default(), &mut rejects);
        let e = self.exits(body);
        if !rejects {
            Paths::Silent
        } else if !(e.returns || e.falls) {
            Paths::RefusesAll
        } else if from_start.closed {
            Paths::Every
        } else {
            Paths::Some
        }
    }

    /// A block followed by `after`, read from its last statement to its first:
    /// what happens to a request that has passed no refusal when it enters.
    /// `rejects`: some statement refuses the caller.
    fn block(&self, body: &[Stmt], after: After, rejects: &mut bool) -> After {
        body.iter()
            .rev()
            .fold(after, |a, s| self.statement(s, a, rejects))
    }

    fn statement(&self, s: &Stmt, after: After, rejects: &mut bool) -> After {
        // Left by a refusal: no request goes on from here.
        let refused = |c: &Self, rejects: &mut bool| {
            let says = c.rejection(s);
            *rejects |= says;
            After {
                closed: true,
                rejects: says,
            }
        };
        match s {
            Stmt::Return(_) if !self.rejection(s) && !self.refuses(s) => After::default(),
            Stmt::Return(_) | Stmt::Raise(_) => refused(self, rejects),
            Stmt::Expr(x) if aborts(&x.value) || self.denies(&x.value) => refused(self, rejects),
            Stmt::Expr(ast::StmtExpr { value, .. })
            | Stmt::Assign(ast::StmtAssign { value, .. })
            | Stmt::AugAssign(ast::StmtAugAssign { value, .. }) => {
                self.value(value, after, rejects)
            }
            Stmt::AnnAssign(a) => match &a.value {
                Some(v) => self.value(v, after, rejects),
                None => after,
            },
            Stmt::If(i) => self.branches(i, after, rejects),
            Stmt::With(w) => self.block(&w.body, after, rejects),
            // A loop may run no turn, a `match` may take no case: what the body
            // checks is no check of every request.
            Stmt::For(ast::StmtFor { body, orelse, .. })
            | Stmt::While(ast::StmtWhile { body, orelse, .. }) => {
                let b = self.block(body, after, rejects);
                let o = self.block(orelse, after, rejects);
                After {
                    closed: after.closed && b.closed && o.closed,
                    rejects: after.rejects,
                }
            }
            Stmt::Match(m) => {
                let mut closed = after.closed;
                for c in &m.cases {
                    closed &= self.block(&c.body, after, rejects).closed;
                }
                After {
                    closed,
                    rejects: after.rejects,
                }
            }
            Stmt::Try(t) => self.try_statement(t, after, rejects),
            _ => after,
        }
    }

    /// A value a statement evaluates: a refusal written in it (`user or
    /// abort(401)`) is one every request reaching the statement passes; a request
    /// handed on there (`response = await call_next(request)`, a dependency's
    /// `yield`) has left the guard.
    fn value(&self, value: &Expr, after: After, rejects: &mut bool) -> After {
        if self.rejects_inline(value) {
            *rejects = true;
            CHECKED
        } else if self.mentions_continuation(value, 0) || yields(value) {
            After::default()
        } else {
            after
        }
    }

    fn branches(&self, i: &ast::StmtIf, after: After, rejects: &mut bool) -> After {
        let mut branches: Vec<(&Expr, &[Stmt])> = vec![(&i.test, &i.body)];
        let mut otherwise: Option<&[Stmt]> = None;
        for c in &i.elif_else_clauses {
            match &c.test {
                Some(t) => branches.push((t, &c.body)),
                None => otherwise = Some(&c.body),
            }
        }
        // The requests no test holds for.
        let mut next = match otherwise {
            Some(body) => self.block(body, after, rejects),
            None => after,
        };
        for (test, body) in branches.into_iter().rev() {
            let e = self.exits(body);
            let taken = self.block(body, after, rejects);
            next = if !e.returns && !e.falls && e.rejects {
                // A branch that always ends by refusing the caller: passed by the
                // requests its test does not hold for, and a refusal of a caller
                // with no identity where that test holds for one.
                *rejects = true;
                After {
                    closed: next.closed || self.refuses_absence(test),
                    rejects: true,
                }
            } else if next.closed && next.rejects && self.shows_identity(test) {
                // Every request that does not take the branch is refused or
                // passes a refusal, and its test reads an identity: the branch is
                // what that refusal lets through.
                next
            } else {
                After {
                    closed: next.closed && taken.closed,
                    rejects: next.rejects || taken.rejects,
                }
            };
        }
        next
    }

    fn try_statement(&self, t: &ast::StmtTry, after: After, rejects: &mut bool) -> After {
        let last = self.block(&t.finalbody, after, rejects);
        let otherwise = self.block(&t.orelse, last, rejects);
        let body = self.block(&t.body, otherwise, rejects);
        // A handler runs for a request that raised anywhere in the body: before
        // any refusal there.
        let mut handlers = After {
            closed: true,
            rejects: false,
        };
        for h in &t.handlers {
            let ast::ExceptHandler::ExceptHandler(h) = h;
            let x = self.block(&h.body, last, rejects);
            handlers.closed &= x.closed;
            handlers.rejects |= x.rejects;
        }
        if self.proven_tries.contains(&t.range().start()) {
            // No request passes it unless its body raised nothing, every handler
            // refuses and one says "not signed in".
            *rejects = true;
            return CHECKED;
        }
        After {
            closed: body.closed && handlers.closed,
            rejects: body.rejects || handlers.rejects,
        }
    }

    /// How the block can be left.
    fn exits(&self, body: &[Stmt]) -> Exits {
        let mut e = Exits {
            falls: true,
            ..Exits::default()
        };
        let join = |e: &mut Exits, x: Exits| {
            e.returns |= x.returns;
            e.refuses |= x.refuses;
            e.rejects |= x.rejects;
        };
        for s in body {
            match s {
                Stmt::Return(_) | Stmt::Raise(_) => {
                    if self.rejection(s) {
                        e.refuses = true;
                        e.rejects = true;
                    } else if self.refuses(s) {
                        e.refuses = true;
                    } else {
                        e.returns = true;
                    }
                    e.falls = false;
                    return e;
                }
                Stmt::Expr(x) if aborts(&x.value) || self.denies(&x.value) => {
                    e.refuses = true;
                    e.rejects |= self.rejection(s);
                    e.falls = false;
                    return e;
                }
                Stmt::If(i) => {
                    let mut falls = !i.elif_else_clauses.iter().any(|c| c.test.is_none());
                    for b in std::iter::once(i.body.as_slice())
                        .chain(i.elif_else_clauses.iter().map(|c| c.body.as_slice()))
                    {
                        let x = self.exits(b);
                        falls |= x.falls;
                        join(&mut e, x);
                    }
                    if !falls {
                        e.falls = false;
                        return e;
                    }
                }
                Stmt::With(w) => {
                    let x = self.exits(&w.body);
                    join(&mut e, x);
                    if !x.falls {
                        e.falls = false;
                        return e;
                    }
                }
                Stmt::For(ast::StmtFor { body, orelse, .. })
                | Stmt::While(ast::StmtWhile { body, orelse, .. }) => {
                    join(&mut e, self.exits(body));
                    join(&mut e, self.exits(orelse));
                }
                Stmt::Match(m) => {
                    for c in &m.cases {
                        join(&mut e, self.exits(&c.body));
                    }
                }
                Stmt::Try(t) => {
                    let b = self.exits(&t.body);
                    let o = self.exits(&t.orelse);
                    let mut falls = b.falls && o.falls;
                    join(&mut e, b);
                    join(&mut e, o);
                    for h in &t.handlers {
                        let ast::ExceptHandler::ExceptHandler(h) = h;
                        let x = self.exits(&h.body);
                        falls |= x.falls;
                        join(&mut e, x);
                    }
                    let f = self.exits(&t.finalbody);
                    join(&mut e, f);
                    if !falls || !f.falls {
                        e.falls = false;
                        return e;
                    }
                }
                _ => {}
            }
        }
        e
    }

    /// The statement refuses the caller as not signed in or not allowed: what it
    /// raises, returns or calls says so ([`Collector::turns_away`]), it returns an
    /// answer that does (`return jsonify(...), 401`), or it raises an error class
    /// named for it (`raise NotAuthenticated()`).
    fn rejection(&self, s: &Stmt) -> bool {
        use drift_core::CheckOutcome::{Forbidden, SignInRedirect, Unauthenticated};
        use drift_core::controls::Rejection;
        if matches!(
            self.turns_away(s),
            Some(Rejection::Unauthenticated | Rejection::Forbidden)
        ) {
            return true;
        }
        match s {
            // A call of a function of the module that never returns and refuses
            // (`deny()`): the refusal, where it stands.
            Stmt::Expr(x) => self.denies(&x.value),
            Stmt::Return(r) => r.value.as_deref().is_some_and(|e| {
                matches!(
                    self.returned_outcome(e),
                    Some(Unauthenticated | Forbidden | SignInRedirect)
                )
            }),
            Stmt::Raise(r) => r.exc.as_deref().is_some_and(|e| {
                self.response_of(e, true)
                    .is_some_and(|r| matches!(r.status, 401 | 403))
                    || self.raises_rejection_class(e)
            }),
            _ => false,
        }
    }

    /// A call of a function of the module that never returns and refuses
    /// ([`crate::lower::Lowerer::denier`]).
    fn denies(&self, e: &Expr) -> bool {
        match e {
            Expr::Call(c) => match c.func.as_ref() {
                Expr::Name(n) => {
                    self.resolve(n.id.as_str())
                        .is_some_and(|b| matches!(b, crate::raw::RawBase::Local(_)))
                        && self.l.denier(n.id.as_str())
                }
                _ => false,
            },
            _ => false,
        }
    }

    fn raises_rejection_class(&self, e: &Expr) -> bool {
        let class = match e {
            Expr::Call(c) => c.func.as_ref(),
            e => e,
        };
        self.canon(class)
            .is_some_and(|r| !matches!(r.base, RawBase::Global(_)))
            && last_name(class).is_some_and(drift_core::controls::rejection_class_name)
    }

    /// The expression calls what turns the caller away by itself, somewhere in it
    /// (`user = load(token) or abort(401)`).
    fn rejects_inline(&self, e: &Expr) -> bool {
        struct Finder(bool);
        impl<'a> Visitor<'a> for Finder {
            fn visit_expr(&mut self, e: &'a Expr) {
                use drift_core::controls::Rejection;
                match e {
                    Expr::Lambda(_) => {}
                    Expr::Call(c)
                        if matches!(
                            call_rejection(c),
                            Some(Rejection::Unauthenticated | Rejection::Forbidden)
                        ) =>
                    {
                        self.0 = true;
                    }
                    _ => visitor::walk_expr(self, e),
                }
            }
        }
        let mut f = Finder(false);
        f.visit_expr(e);
        f.0
    }

    /// The condition of a branch that refuses holds for a caller with no identity:
    /// anything but an `and` with an operand that is no test of a credential's
    /// absence (`if token and not valid(token)`, `if not user and not
    /// settings.OPEN`: a caller with no token, or any caller where the flag is set,
    /// is not refused).
    fn refuses_absence(&self, test: &Expr) -> bool {
        match test {
            Expr::BoolOp(b) if b.op == ast::BoolOp::And => {
                b.values.iter().all(|v| self.tests_absence(v))
            }
            _ => true,
        }
    }

    /// `not <credential>`, `<credential> is None`, `<credential> == <literal>`,
    /// `"user_id" not in session`, or an `and` of them.
    fn tests_absence(&self, e: &Expr) -> bool {
        match e {
            Expr::UnaryOp(u) if u.op == ast::UnaryOp::Not => names_credential(&u.operand),
            Expr::Compare(c) => match c.ops.as_ref() {
                [ast::CmpOp::Is | ast::CmpOp::Eq] => {
                    matches!(
                        Some(c.second_operand()),
                        Some(
                            Expr::NoneLiteral(_) | Expr::StringLiteral(_) | Expr::BooleanLiteral(_)
                        )
                    ) && names_credential(c.first_operand())
                }
                [ast::CmpOp::NotIn] => names_credential(e),
                _ => false,
            },
            Expr::BoolOp(b) if b.op == ast::BoolOp::And => {
                b.values.iter().all(|v| self.tests_absence(v))
            }
            _ => false,
        }
    }

    /// The condition holds only for a caller with an identity: it reads a
    /// credential, and not for its absence (`if user:`, `if token and
    /// valid(token):`, `if key == settings.API_KEY:`). Every operand of an `or`
    /// must; one of an `and` is enough.
    fn shows_identity(&self, test: &Expr) -> bool {
        match test {
            Expr::BoolOp(b) if b.op == ast::BoolOp::And => {
                b.values.iter().any(|v| self.shows_identity(v))
            }
            Expr::BoolOp(b) => b.values.iter().all(|v| self.shows_identity(v)),
            Expr::UnaryOp(u) if u.op == ast::UnaryOp::Not => false,
            Expr::Compare(c) => {
                let nothing = matches!(
                    Some(c.second_operand()),
                    Some(Expr::NoneLiteral(_) | Expr::BooleanLiteral(_))
                );
                match c.ops.as_ref() {
                    [ast::CmpOp::IsNot | ast::CmpOp::NotEq] => {
                        nothing && names_credential(c.first_operand())
                    }
                    [ast::CmpOp::Eq | ast::CmpOp::Is | ast::CmpOp::In] => {
                        !nothing && names_credential(test)
                    }
                    _ => false,
                }
            }
            Expr::Named(n) => self.shows_identity(&n.value) || names_credential(&n.target),
            _ => names_credential(test),
        }
    }
}

/// `abort(...)` as a statement of its own: the function is left there.
fn aborts(e: &Expr) -> bool {
    matches!(e, Expr::Call(c) if last_name(&c.func) == Some("abort"))
}

fn yields(e: &Expr) -> bool {
    match e {
        Expr::Yield(_) | Expr::YieldFrom(_) => true,
        Expr::Await(a) => yields(&a.value),
        _ => false,
    }
}

/// Some name or member read in the expression says a credential or an identity.
fn names_credential(e: &Expr) -> bool {
    struct Finder(bool);
    impl<'a> Visitor<'a> for Finder {
        fn visit_expr(&mut self, e: &'a Expr) {
            let name = match e {
                Expr::Name(n) => Some(n.id.as_str()),
                Expr::Attribute(a) => Some(a.attr.as_str()),
                Expr::StringLiteral(s) => Some(s.value.to_str()),
                _ => None,
            };
            if name.is_some_and(credential_name) {
                self.0 = true;
                return;
            }
            visitor::walk_expr(self, e);
        }
    }
    let mut f = Finder(false);
    f.visit_expr(e);
    f.0
}

fn credential_name(name: &str) -> bool {
    drift_core::controls::names_subject(name)
        || drift_core::controls::name_words(name)
            .iter()
            .any(|w| CREDENTIAL_WORDS.contains(&w.as_str()))
}
