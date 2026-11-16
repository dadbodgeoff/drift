//! What a body withholds of what a call handed back, and where it sends the whole
//! of it (TypeScript lowering 84).
//!
//! No field is a secret by its name. A field is one the repository does not send
//! back where its own code takes it out of what a call gave before it answers:
//!
//! - the call is told to leave it out (`findUnique({ where, omit: { passwordHash:
//!   true } })`, `select: { passwordHash: false }`);
//! - it is taken apart from the rest and never read (`const { passwordHash,
//!   ...safe } = user`, `const { key: _, ...app } = row`);
//! - it is deleted or blanked on the value (`delete user.passwordHash`,
//!   `user.passwordHash = undefined`), or blanked in a copy (`{ ...user,
//!   passwordHash: undefined }`).
//!
//! Each is recorded with the call the value came from, or with the parameter
//! where the function was handed it (`function toPublic(user) { const {
//! passwordHash, ...rest } = user; return rest }`: the calls of the function say
//! which rows those are) ([`drift_core::controls::WITHHOLDS`]). Beside them, a body that hands the whole
//! of what a call gave to a response (`res.json(user)`, `NextResponse.json({ user
//! })`, [`drift_core::controls::SENDS_WHOLE`]) or returns it
//! ([`drift_core::controls::RETURNS_WHOLE`]) is recorded with that call. A call
//! that chooses its fields (`select`) hands back no whole, and a value only parts
//! of which are read (`user.id`, `rows.map(...)`) is not the whole either.
//!
//! Nothing here judges: a reader lists where one body sends whole what another
//! withholds a field of (`drift_mine::whole_rows`).

use oxc_ast::ast::*;

use super::{Collector, Sent, call_name, key_name, peel, routes, unwrap_expr};

/// How deep an object or an array written in a response is looked into.
const PAYLOAD_DEPTH: usize = 3;

/// The call an expression is, past `await` and what a promise settles to
/// (`load().then(...)` is not looked through: what `then` gives is another value).
fn settled_call<'b, 'a>(e: &'b Expression<'a>) -> Option<&'b CallExpression<'a>> {
    match peel(e) {
        Expression::CallExpression(c) => Some(c),
        _ => None,
    }
}

/// What the options of a call say of the fields it hands back: whether it chooses
/// them (`select`), and the ones it leaves out (`omit: { f: true }`, `select: { f:
/// false }`).
fn chosen(c: &CallExpression) -> (bool, Vec<String>) {
    let mut selects = false;
    let mut left_out = Vec::new();
    let keys_set_to = |o: &ObjectExpression, want: bool| -> Vec<String> {
        o.properties
            .iter()
            .filter_map(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) if !p.computed => {
                    match unwrap_expr(&p.value) {
                        Expression::BooleanLiteral(b) if b.value == want => key_name(&p.key),
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect()
    };
    for arg in c.arguments.iter().filter_map(|a| a.as_expression()) {
        let Expression::ObjectExpression(o) = unwrap_expr(arg) else {
            continue;
        };
        if let Some(select) = routes::object_prop(o, "select") {
            match unwrap_expr(select) {
                // Only fields set to `false`: everything else is handed back.
                Expression::ObjectExpression(s)
                    if !s.properties.is_empty() && keys_set_to(s, true).is_empty() =>
                {
                    left_out.extend(keys_set_to(s, false));
                }
                _ => selects = true,
            }
        }
        if let Some(Expression::ObjectExpression(omit)) =
            routes::object_prop(o, "omit").map(unwrap_expr)
        {
            left_out.extend(keys_set_to(omit, true));
        }
    }
    (selects, left_out)
}

/// `null` or `undefined`, written.
fn blank(e: &Expression) -> bool {
    match unwrap_expr(e) {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(id) => id.name == "undefined",
        Expression::UnaryExpression(u) => u.operator == UnaryOperator::Void,
        _ => false,
    }
}

impl Collector<'_, '_> {
    fn row_use(&mut self, kind: &str, side: &str, field: Option<&str>) {
        self.row_uses.insert(match field {
            Some(f) => format!("{kind}\t{side}\t{f}"),
            None => format!("{kind}\t{side}"),
        });
    }

    /// The call a local holds the whole of, where it holds one.
    fn whole_local(&self, e: &Expression) -> Option<String> {
        let Expression::Identifier(id) = peel(e) else {
            return None;
        };
        let sym = self.symbol_of(id)?;
        self.whole_locals
            .contains(&sym)
            .then(|| self.call_locals.get(&sym).cloned())
            .flatten()
    }

    /// A call that leaves fields out of what it hands back
    /// (`omit: { passwordHash: true }`).
    pub(super) fn note_left_out(&mut self, it: &CallExpression) {
        if self.fn_depth == 0 {
            return;
        }
        let (_, left_out) = chosen(it);
        if left_out.is_empty() {
            return;
        }
        let Some(side) = self.callee_side(it) else {
            return;
        };
        for f in left_out {
            self.row_use("withholds", &side, Some(&f));
        }
    }

    /// `const user = await db.user.findUnique(...)`: the local holds the whole of
    /// what the call gave, unless the call chooses its fields. `const { hash,
    /// ...safe } = user` with `hash` never read: the field is withheld.
    pub(super) fn note_row_binding(&mut self, id: &BindingPattern, init: &Expression) {
        if self.fn_depth == 0 {
            return;
        }
        match id {
            BindingPattern::BindingIdentifier(b) => {
                if self.const_decl
                    && let Some(c) = settled_call(init)
                    && !chosen(c).0
                    && self.callee_side(c).is_some()
                    && let Some(sym) = b.symbol_id.get()
                {
                    self.whole_locals.insert(sym);
                }
            }
            BindingPattern::ObjectPattern(o) if o.rest.is_some() => {
                // The value taken apart: a call's result, or a local that holds
                // one.
                let side = match settled_call(init) {
                    Some(c) => self.callee_side(c),
                    None => self.held(init),
                };
                let Some(side) = side else {
                    return;
                };
                for prop in &o.properties {
                    let BindingPattern::BindingIdentifier(b) = &prop.value else {
                        continue;
                    };
                    let unread = b
                        .symbol_id
                        .get()
                        .is_some_and(|s| self.l.scoping.get_resolved_reference_ids(s).is_empty());
                    if let (true, false, Some(key)) = (unread, prop.computed, key_name(&prop.key)) {
                        self.row_use("withholds", &side, Some(&key));
                    }
                }
            }
            _ => {}
        }
    }

    /// `delete user.passwordHash`.
    pub(super) fn note_deleted(&mut self, it: &UnaryExpression) {
        if it.operator != UnaryOperator::Delete {
            return;
        }
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.argument) {
            self.note_blanked(&m.object, m.property.name.as_str());
        }
    }

    /// `user.passwordHash = undefined`.
    pub(super) fn note_blank_assigned(&mut self, it: &AssignmentExpression) {
        if let AssignmentTarget::StaticMemberExpression(m) = &it.left
            && blank(&it.right)
        {
            self.note_blanked(&m.object, m.property.name.as_str());
        }
    }

    fn note_blanked(&mut self, object: &Expression, field: &str) {
        if let Some(side) = self.held(object) {
            self.row_use("withholds", &side, Some(field));
        }
    }

    /// What a name holds that a field can be withheld of: what a call handed
    /// back (`call <callee>`), or what the function itself was handed (`param
    /// #<position>`: the calls of the function say which rows those are).
    fn held(&self, e: &Expression) -> Option<String> {
        let Expression::Identifier(id) = peel(e) else {
            return None;
        };
        if let Some(side) = self
            .symbol_of(id)
            .and_then(|s| self.call_locals.get(&s).cloned())
        {
            return Some(side);
        }
        let (_, at) = self.param_root(e)?;
        (!at.contains('.')).then(|| format!("param {at}"))
    }

    /// The calls whose whole result is in `e`: the value itself, a value of an
    /// object or an item of an array written in place, a spread of one, what
    /// `JSON.stringify` is given. A spread into an object that blanks a field
    /// (`{ ...user, hash: undefined }`) withholds it, recorded in `withheld`.
    fn wholes(
        &self,
        e: &Expression,
        depth: usize,
        out: &mut Vec<String>,
        withheld: &mut Vec<(String, String)>,
    ) {
        if let Some(side) = self.whole_local(e) {
            out.push(side);
            return;
        }
        match peel(e) {
            Expression::CallExpression(c) => {
                if call_name(&c.callee) == Some("stringify") {
                    if let Some(x) = c.arguments.first().and_then(|a| a.as_expression()) {
                        self.wholes(x, depth, out, withheld);
                    }
                } else if !chosen(c).0
                    && self.response_of(Sent::Call(c)).is_none()
                    && let Some(side) = self.callee_side(c)
                {
                    out.push(side);
                }
            }
            Expression::ObjectExpression(o) if depth < PAYLOAD_DEPTH => {
                let mut spread: Vec<String> = Vec::new();
                for p in &o.properties {
                    match p {
                        ObjectPropertyKind::ObjectProperty(p) => {
                            if let (false, true, Some(key)) =
                                (p.computed, blank(&p.value), key_name(&p.key))
                            {
                                withheld.extend(spread.iter().map(|s| (s.clone(), key.clone())));
                            }
                            self.wholes(&p.value, depth + 1, out, withheld);
                        }
                        ObjectPropertyKind::SpreadProperty(s) => {
                            let mut inner = Vec::new();
                            self.wholes(&s.argument, depth + 1, &mut inner, withheld);
                            spread.extend(inner.iter().cloned());
                            out.extend(inner);
                        }
                    }
                }
            }
            Expression::ArrayExpression(a) if depth < PAYLOAD_DEPTH => {
                for x in a.elements.iter().filter_map(|x| x.as_expression()) {
                    self.wholes(x, depth + 1, out, withheld);
                }
            }
            _ => {}
        }
    }

    fn note_wholes(&mut self, kind: &str, e: &Expression) {
        let (mut out, mut withheld) = (Vec::new(), Vec::new());
        self.wholes(e, 0, &mut out, &mut withheld);
        for side in out {
            self.row_use(kind, &side, None);
        }
        for (side, field) in withheld {
            self.row_use("withholds", &side, Some(&field));
        }
    }

    /// What a response is given to send (`res.json(user)`).
    pub(super) fn note_sent_rows(&mut self, x: Sent) {
        let (_, args, _) = x.parts();
        if let Some(first) = args.first().and_then(|a| a.as_expression()) {
            self.note_wholes("sends_whole", first);
        }
    }

    /// What the walk's own function returns (`return user`, `return { user }`).
    pub(super) fn note_returned_rows(&mut self, e: &Expression) {
        self.note_wholes("returns_whole", e);
    }
}
