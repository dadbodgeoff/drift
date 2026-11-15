//! What a permission test answers for a caller who is not signed in: DRF's
//! `has_permission`, Django's `test_func` and the test given to `user_passes_test`.
//! Read from the body, for the closed set of shapes that say it; anything else is
//! not read.

use ruff_python_ast::{self as ast, Expr, Stmt};

use super::without_docstring;

/// The answer read off a test.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// It is `True` whoever asks ([`drift_core::VERDICT_TRUE`]).
    True,
    /// It is false for a caller who is not signed in
    /// ([`drift_core::VERDICT_SIGNED_IN`]).
    SignedIn,
    /// It is false where the base class's own test is
    /// ([`drift_core::VERDICT_SUPER`]).
    Super,
}

impl Verdict {
    pub(crate) fn fact(self) -> &'static str {
        match self {
            Verdict::True => drift_core::VERDICT_TRUE,
            Verdict::SignedIn => drift_core::VERDICT_SIGNED_IN,
            Verdict::Super => drift_core::VERDICT_SUPER,
        }
    }
}

/// Whose test it is: how the body names the user, and the method of the base it may
/// ask.
struct Test<'a> {
    user: &'a dyn Fn(&Expr) -> bool,
    base: Option<&'a str>,
}

/// A method of a permission class or of a view with `UserPassesTestMixin`:
/// `has_permission(self, request, view)` reads `request.user`, `test_func(self)`
/// reads `self.request.user`. `None` for any other method, and for a body that is
/// not read.
pub(crate) fn of_method(f: &ast::StmtFunctionDef) -> Option<Verdict> {
    let name = f.name.as_str();
    let params: Vec<&str> = f
        .parameters
        .posonlyargs
        .iter()
        .chain(&f.parameters.args)
        .map(|p| p.parameter.name.as_str())
        .collect();
    fn attr_of<'e>(e: &'e Expr, attr: &str) -> Option<&'e Expr> {
        match e {
            Expr::Attribute(a) if a.attr.as_str() == attr => Some(a.value.as_ref()),
            _ => None,
        }
    }
    let named = |e: &Expr, n: &str| matches!(e, Expr::Name(x) if x.id.as_str() == n);
    let user: Box<dyn Fn(&Expr) -> bool> = match name {
        "has_permission" => {
            let request = *params.get(1)?;
            Box::new(move |e| attr_of(e, "user").is_some_and(|v| named(v, request)))
        }
        "test_func" => {
            let this = *params.first()?;
            Box::new(move |e| {
                attr_of(e, "user")
                    .and_then(|v| attr_of(v, "request"))
                    .is_some_and(|v| named(v, this))
            })
        }
        _ => return None,
    };
    of_body(
        &f.body,
        &Test {
            user: &*user,
            base: Some(name),
        },
    )
}

/// The test given to `user_passes_test`: a `lambda u: ...`, or a function of the
/// module that takes the user (`defs`).
pub(crate) fn of_test<'a>(
    arg: &Expr,
    defs: &dyn Fn(&str) -> Option<&'a ast::StmtFunctionDef>,
) -> Option<Verdict> {
    let one = |p: &ast::Parameters| -> Option<String> {
        let mut names = p.posonlyargs.iter().chain(&p.args);
        let first = names.next()?.parameter.name.as_str().to_string();
        (names.next().is_none() && p.vararg.is_none() && p.kwarg.is_none()).then_some(first)
    };
    match arg {
        Expr::Lambda(l) => {
            let u = one(l.parameters.as_deref()?)?;
            let user = |e: &Expr| matches!(e, Expr::Name(x) if x.id.as_str() == u);
            of_expr(
                &l.body,
                &Test {
                    user: &user,
                    base: None,
                },
            )
        }
        Expr::Name(n) => {
            let f = defs(n.id.as_str())?;
            if !f.decorator_list.is_empty() {
                return None;
            }
            let u = one(&f.parameters)?;
            let user = |e: &Expr| matches!(e, Expr::Name(x) if x.id.as_str() == u);
            of_body(
                &f.body,
                &Test {
                    user: &user,
                    base: None,
                },
            )
        }
        _ => None,
    }
}

/// What a test asks of a caller who is signed in ([`asks_of_method`],
/// [`asks_of_test`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Asks {
    /// A role, a group, a permission or a staff flag
    /// ([`drift_core::ASKS_ROLE`]).
    Role,
    /// The sign-in and the account's state, and nothing else
    /// ([`drift_core::ASKS_STATUS`]).
    Status,
}

impl Asks {
    pub(crate) fn fact(self) -> &'static str {
        match self {
            Asks::Role => drift_core::ASKS_ROLE,
            Asks::Status => drift_core::ASKS_STATUS,
        }
    }
}

/// What `test_func(self)` asks of `self.request.user`. `None` for another method
/// and for a body that is not read.
pub(crate) fn asks_of_method(f: &ast::StmtFunctionDef) -> Option<Asks> {
    if f.name.as_str() != "test_func" {
        return None;
    }
    let this = f
        .parameters
        .posonlyargs
        .iter()
        .chain(&f.parameters.args)
        .next()?
        .parameter
        .name
        .as_str();
    let user = |e: &Expr| {
        matches!(e, Expr::Attribute(u) if u.attr.as_str() == "user"
            && matches!(u.value.as_ref(), Expr::Attribute(r) if r.attr.as_str() == "request"
                && matches!(r.value.as_ref(), Expr::Name(n) if n.id.as_str() == this)))
    };
    asks_of_body(&f.body, &user)
}

/// What the test given to `user_passes_test` asks: a `lambda u: ...`, or a function
/// of the module that takes the user (`defs`).
pub(crate) fn asks_of_test<'a>(
    arg: &Expr,
    defs: &dyn Fn(&str) -> Option<&'a ast::StmtFunctionDef>,
) -> Option<Asks> {
    let one = |p: &ast::Parameters| -> Option<String> {
        let mut names = p.posonlyargs.iter().chain(&p.args);
        let first = names.next()?.parameter.name.as_str().to_string();
        (names.next().is_none() && p.vararg.is_none() && p.kwarg.is_none()).then_some(first)
    };
    match arg {
        Expr::Lambda(l) => {
            let u = one(l.parameters.as_deref()?)?;
            let user = |e: &Expr| matches!(e, Expr::Name(x) if x.id.as_str() == u);
            asks_of_expr(&l.body, &user)
        }
        Expr::Name(n) => {
            let f = defs(n.id.as_str())?;
            if !f.decorator_list.is_empty() {
                return None;
            }
            let u = one(&f.parameters)?;
            let user = |e: &Expr| matches!(e, Expr::Name(x) if x.id.as_str() == u);
            asks_of_body(&f.body, &user)
        }
        _ => None,
    }
}

/// A body that is one `return <test>`, or `if not <a>: return False` and then
/// `return <b>` (which lets through who passes both).
fn asks_of_body(body: &[Stmt], user: &dyn Fn(&Expr) -> bool) -> Option<Asks> {
    match without_docstring(body) {
        [Stmt::Return(r)] => asks_of_expr(r.value.as_deref()?, user),
        [Stmt::If(i), Stmt::Return(last)] if i.elif_else_clauses.is_empty() => {
            let [Stmt::Return(r)] = i.body.as_slice() else {
                return None;
            };
            if !matches!(r.value.as_deref(), Some(Expr::BooleanLiteral(b)) if !b.value) {
                return None;
            }
            let Expr::UnaryOp(u) = i.test.as_ref() else {
                return None;
            };
            if u.op != ast::UnaryOp::Not {
                return None;
            }
            both(&[
                asks_of_expr(&u.operand, user),
                asks_of_expr(last.value.as_deref()?, user),
            ])
        }
        _ => None,
    }
}

/// What passing every one of the tests asks: a role where one asks a role (the
/// others only narrow it), the account's state where every one was read to that.
fn both(each: &[Option<Asks>]) -> Option<Asks> {
    if each.contains(&Some(Asks::Role)) {
        Some(Asks::Role)
    } else if each.iter().all(|a| *a == Some(Asks::Status)) {
        Some(Asks::Status)
    } else {
        None
    }
}

/// The closed set of what a test of the user says: `<user>.is_staff`,
/// `is_superuser`, `has_perm(...)`, `has_perms(...)`, `has_module_perms(...)` and
/// `groups.filter(...).exists()` ask a role; `is_authenticated`, `is_active`, `not
/// is_anonymous` and `True` ask none; `and`, `or`, `not` and `bool(...)` of these.
/// An `or` lets through whoever passes one operand: a role only where every
/// operand asks one. Anything else is not read.
fn asks_of_expr(e: &Expr, user: &dyn Fn(&Expr) -> bool) -> Option<Asks> {
    match e {
        Expr::BooleanLiteral(b) if b.value => Some(Asks::Status),
        Expr::Attribute(a) if user(&a.value) => match a.attr.as_str() {
            "is_staff" | "is_superuser" => Some(Asks::Role),
            "is_authenticated" | "is_active" => Some(Asks::Status),
            _ => None,
        },
        Expr::UnaryOp(u) if u.op == ast::UnaryOp::Not => match u.operand.as_ref() {
            Expr::Attribute(a) if a.attr.as_str() == "is_anonymous" && user(&a.value) => {
                Some(Asks::Status)
            }
            _ => None,
        },
        Expr::Call(c) => match c.func.as_ref() {
            Expr::Name(n) if n.id.as_str() == "bool" && c.arguments.keywords.is_empty() => {
                match c.arguments.args.as_ref() {
                    [x] => asks_of_expr(x, user),
                    _ => None,
                }
            }
            Expr::Attribute(a) if user(&a.value) => match a.attr.as_str() {
                "has_perm" | "has_perms" | "has_module_perms" => Some(Asks::Role),
                // `user.is_authenticated()`, as old Django spelled it.
                "is_authenticated" | "is_active" if c.arguments.is_empty() => Some(Asks::Status),
                _ => None,
            },
            // `user.groups.filter(name="editors").exists()`.
            Expr::Attribute(a) if a.attr.as_str() == "exists" && c.arguments.is_empty() => {
                match a.value.as_ref() {
                    Expr::Call(q) => match q.func.as_ref() {
                        Expr::Attribute(f) if f.attr.as_str() == "filter" => match f.value.as_ref()
                        {
                            Expr::Attribute(g) if g.attr.as_str() == "groups" && user(&g.value) => {
                                Some(Asks::Role)
                            }
                            _ => None,
                        },
                        _ => None,
                    },
                    _ => None,
                }
            }
            _ => None,
        },
        Expr::BoolOp(b) => {
            let each: Vec<Option<Asks>> = b.values.iter().map(|v| asks_of_expr(v, user)).collect();
            match b.op {
                ast::BoolOp::And => both(&each),
                ast::BoolOp::Or => {
                    if each.iter().all(|a| *a == Some(Asks::Role)) {
                        Some(Asks::Role)
                    } else if each.iter().all(Option::is_some) {
                        Some(Asks::Status)
                    } else {
                        None
                    }
                }
            }
        }
        _ => None,
    }
}

/// A body that is one `return <test>`, or that opens with `if <no identity>: return
/// False` (whatever follows is asked of a signed-in caller only).
fn of_body(body: &[Stmt], t: &Test) -> Option<Verdict> {
    match without_docstring(body) {
        [Stmt::Return(r)] => of_expr(r.value.as_deref()?, t),
        [Stmt::If(i), ..] if i.elif_else_clauses.is_empty() => {
            let [Stmt::Return(r)] = i.body.as_slice() else {
                return None;
            };
            if !matches!(r.value.as_deref(), Some(Expr::BooleanLiteral(b)) if !b.value) {
                return None;
            }
            // `if not <signed in>:`, or an `or` with such an operand; and `if
            // <user>.is_anonymous:`, which Django's anonymous user alone has as
            // `True`: the same test, said of who is not signed in.
            let negated = |e: &Expr| match e {
                Expr::UnaryOp(u) if u.op == ast::UnaryOp::Not => of_expr(&u.operand, t),
                Expr::Attribute(a) if a.attr.as_str() == "is_anonymous" && (t.user)(&a.value) => {
                    Some(Verdict::SignedIn)
                }
                _ => None,
            };
            let found: Vec<Verdict> = match i.test.as_ref() {
                Expr::BoolOp(b) if b.op == ast::BoolOp::Or => {
                    b.values.iter().filter_map(negated).collect()
                }
                e => negated(e).into_iter().collect(),
            };
            if found.contains(&Verdict::SignedIn) {
                Some(Verdict::SignedIn)
            } else if found.contains(&Verdict::Super) {
                Some(Verdict::Super)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// `True`; `<user>.is_authenticated` (also `is_staff`, `is_superuser`, which
/// Django's anonymous user has as `False`; called or not); the base's own test
/// (`super().has_permission(request, view)`); `bool(...)` of one; an `and` with one
/// such operand; an `or` of nothing else.
fn of_expr(e: &Expr, t: &Test) -> Option<Verdict> {
    match e {
        Expr::BooleanLiteral(b) if b.value => Some(Verdict::True),
        Expr::Attribute(a)
            if matches!(
                a.attr.as_str(),
                "is_authenticated" | "is_staff" | "is_superuser"
            ) && (t.user)(&a.value) =>
        {
            Some(Verdict::SignedIn)
        }
        Expr::Call(c) => match c.func.as_ref() {
            Expr::Name(n) if n.id.as_str() == "bool" && c.arguments.keywords.is_empty() => {
                match c.arguments.args.as_ref() {
                    [x] => of_expr(x, t).filter(|v| *v != Verdict::True),
                    _ => None,
                }
            }
            // `request.user.is_authenticated()`, as old Django spelled it.
            f @ Expr::Attribute(a) if c.arguments.is_empty() && a.attr.as_str() != "user" => {
                of_expr(f, t).filter(|v| *v == Verdict::SignedIn)
            }
            Expr::Attribute(a)
                if t.base == Some(a.attr.as_str())
                    && matches!(a.value.as_ref(), Expr::Call(s)
                        if matches!(s.func.as_ref(), Expr::Name(n) if n.id.as_str() == "super")) =>
            {
                Some(Verdict::Super)
            }
            _ => None,
        },
        Expr::BoolOp(b) => {
            let each: Vec<Option<Verdict>> = b.values.iter().map(|v| of_expr(v, t)).collect();
            let has = |v: Verdict| each.contains(&Some(v));
            match b.op {
                ast::BoolOp::And if has(Verdict::SignedIn) => Some(Verdict::SignedIn),
                ast::BoolOp::And if has(Verdict::Super) => Some(Verdict::Super),
                ast::BoolOp::Or
                    if each
                        .iter()
                        .all(|v| matches!(v, Some(Verdict::SignedIn | Verdict::Super))) =>
                {
                    if has(Verdict::Super) {
                        Some(Verdict::Super)
                    } else {
                        Some(Verdict::SignedIn)
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }
}
