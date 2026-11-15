//! The requests a file sends with an HTTP client, and what is read of each URL
//! ([`drift_core::FileFacts::outgoing`]): whether its path is written out, or built
//! from the request being served. `drift security` reads them to tell an application
//! that calls another service from one that may relay requests to it.

use drift_core::OutgoingRequest;
use drift_core::practice::{UrlPart, outgoing_url};

use super::*;

/// Packages whose default export, or whose verb methods, send a request to the URL
/// they are given first. The list to extend: a client that is not on it is not seen.
const CLIENTS: &[&str] = &[
    "axios",
    "cross-fetch",
    "got",
    "http",
    "https",
    "isomorphic-fetch",
    "ky",
    "needle",
    "node-fetch",
    "node:http",
    "node:https",
    "ofetch",
    "request",
    "superagent",
    "undici",
];
/// Their methods that send one.
const SENDS: &[&str] = &[
    "", ".get", ".post", ".put", ".patch", ".delete", ".head", ".request", ".fetch", ".stream",
];

pub(super) struct OutgoingFinder<'l, 's> {
    l: &'l Lowerer<'s>,
    text: &'l str,
    /// The names of the functions around, outermost first.
    within: Vec<String>,
    /// What a `const` or `let` bound to a string is built from, by its symbol:
    /// only one nothing writes again, nor a property of.
    bound: HashMap<SymbolId, Vec<UrlPart>>,
    /// The names a property of which is written (`u.host = ...`): what they were
    /// bound to is not what they hold.
    written: HashSet<SymbolId>,
    pub(super) found: Vec<OutgoingRequest>,
}

impl<'l, 's> OutgoingFinder<'l, 's> {
    pub(super) fn new(l: &'l Lowerer<'s>, text: &'l str) -> Self {
        OutgoingFinder {
            l,
            text,
            within: Vec::new(),
            bound: HashMap::new(),
            written: HashSet::new(),
            found: Vec::new(),
        }
    }

    fn source(&self, e: &Expression) -> String {
        let span = e.span();
        self.text
            .get(span.start as usize..span.end as usize)
            .unwrap_or_default()
            .to_string()
    }

    /// The pieces a URL expression is built from: literal text, and each value as
    /// written. A name bound to a string in the file is what it is bound to.
    fn parts(&self, e: &Expression, depth: usize, out: &mut Vec<UrlPart>) {
        let e = unwrap_expr(e);
        if depth > 8 {
            out.push(UrlPart::Value(self.source(e)));
            return;
        }
        match e {
            Expression::StringLiteral(s) => out.push(UrlPart::Text(lit(s))),
            Expression::TemplateLiteral(t) => {
                for (i, q) in t.quasis.iter().enumerate() {
                    out.push(UrlPart::Text(q.value.raw.to_string()));
                    if let Some(x) = t.expressions.get(i) {
                        self.parts(x, depth + 1, out);
                    }
                }
            }
            Expression::BinaryExpression(b) if b.operator == BinaryOperator::Addition => {
                self.parts(&b.left, depth + 1, out);
                self.parts(&b.right, depth + 1, out);
            }
            // `new URL(path, base)`: the base, then the path.
            Expression::NewExpression(n) if matches!(unwrap_expr(&n.callee), Expression::Identifier(i) if i.name == "URL") =>
            {
                let mut args = n.arguments.iter().filter_map(|a| a.as_expression());
                let (path, base) = (args.next(), args.next());
                for x in [base, path].into_iter().flatten() {
                    self.parts(x, depth + 1, out);
                }
            }
            // `String(x)`, `x.toString()`, `x.href`.
            Expression::CallExpression(c)
                if matches!(call_name(&c.callee), Some("String" | "toString")) =>
            {
                let inner = match unwrap_expr(&c.callee) {
                    Expression::StaticMemberExpression(m) => Some(&m.object),
                    _ => c.arguments.first().and_then(|a| a.as_expression()),
                };
                match inner {
                    Some(x) => self.parts(x, depth + 1, out),
                    None => out.push(UrlPart::Value(self.source(e))),
                }
            }
            Expression::Identifier(id) => {
                let bound = id
                    .reference_id
                    .get()
                    .and_then(|r| self.l.scoping.get_reference(r).symbol_id())
                    .and_then(|s| self.bound.get(&s));
                match bound {
                    Some(parts) => out.extend(parts.iter().cloned()),
                    None => out.push(UrlPart::Value(self.source(e))),
                }
            }
            _ => out.push(UrlPart::Value(self.source(e))),
        }
    }

    /// The URL argument of a call that sends a request; none when the call sends none.
    /// `Some(None)`: it sends one to a URL that is not an argument Drift reads.
    fn sent<'b, 'a>(&self, it: &'b CallExpression<'a>) -> Option<Option<&'b Expression<'a>>> {
        let callee = self.l.canon_callee(&it.callee)?;
        let sends = match &callee.base {
            RawBase::Global(g) => {
                matches!(g.as_str(), "fetch" | "$fetch") && callee.member.is_empty()
            }
            RawBase::Import { spec, .. } => {
                CLIENTS.contains(&spec.as_str()) && SENDS.contains(&callee.member.as_str())
            }
            RawBase::Local(_) => false,
        };
        if !sends {
            return None;
        }
        let first = it.arguments.first().and_then(|a| a.as_expression());
        Some(match first.map(unwrap_expr) {
            // `axios({ url, baseURL })`, `http.request({ host, path })`.
            Some(Expression::ObjectExpression(o)) => o.properties.iter().find_map(|p| match p {
                ObjectPropertyKind::ObjectProperty(p)
                    if matches!(key_name(&p.key).as_deref(), Some("url" | "path")) =>
                {
                    Some(&p.value)
                }
                _ => None,
            }),
            _ => first,
        })
    }
}

/// The names of a file a property of which is written: the object of a member
/// assigned, updated or destructured into (`u.host = x`, `u.port++`,
/// `({ a: u.pathname } = b)`).
struct Written<'l, 's> {
    l: &'l Lowerer<'s>,
    out: HashSet<SymbolId>,
}

impl<'a> Visit<'a> for Written<'_, '_> {
    fn visit_simple_assignment_target(&mut self, it: &SimpleAssignmentTarget<'a>) {
        let mut object = it.as_member_expression().map(|m| m.object());
        while let Some(e) = object {
            match unwrap_expr(e) {
                Expression::Identifier(id) => {
                    if let Some(s) = id
                        .reference_id
                        .get()
                        .and_then(|r| self.l.scoping.get_reference(r).symbol_id())
                    {
                        self.out.insert(s);
                    }
                    break;
                }
                other => object = other.as_member_expression().map(|m| m.object()),
            }
        }
        walk::walk_simple_assignment_target(self, it);
    }
}

impl<'a> Visit<'a> for OutgoingFinder<'_, '_> {
    fn visit_program(&mut self, it: &Program<'a>) {
        let mut written = Written {
            l: self.l,
            out: HashSet::new(),
        };
        written.visit_program(it);
        self.written = written.out;
        walk::walk_program(self, it);
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        let name = it.id.as_ref().map(|i| i.name.to_string());
        let named = name.is_some();
        self.within.extend(name);
        walk::walk_function(self, it, flags);
        if named {
            self.within.pop();
        }
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        let name = it.id.as_ref().map(|i| i.name.to_string());
        let named = name.is_some();
        self.within.extend(name);
        walk::walk_class(self, it);
        if named {
            self.within.pop();
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let BindingPattern::BindingIdentifier(b) = &it.id else {
            walk::walk_variable_declarator(self, it);
            return;
        };
        match it.init.as_ref().map(unwrap_expr) {
            Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                self.within.push(b.name.to_string());
                walk::walk_variable_declarator(self, it);
                self.within.pop();
            }
            Some(
                init @ (Expression::StringLiteral(_)
                | Expression::TemplateLiteral(_)
                | Expression::BinaryExpression(_)
                | Expression::NewExpression(_)),
            ) => {
                let mut parts = Vec::new();
                self.parts(init, 0, &mut parts);
                // A `let` or `var` assigned again, or an object a property of which
                // is set, holds what the file writes later: not read.
                if let Some(s) = b.symbol_id.get()
                    && !self.l.scoping.symbol_is_mutated(s)
                    && !self.written.contains(&s)
                {
                    self.bound.insert(s, parts);
                }
                walk::walk_variable_declarator(self, it);
            }
            _ => walk::walk_variable_declarator(self, it),
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(url) = self.sent(it) {
            let (url, unread) = match url {
                Some(e) => {
                    let mut parts = Vec::new();
                    self.parts(e, 0, &mut parts);
                    let (url, unread) = outgoing_url(&parts);
                    (url, unread.unwrap_or_default())
                }
                None => (
                    String::new(),
                    "its URL is not an argument that is read".to_string(),
                ),
            };
            self.found.push(OutgoingRequest {
                unread,
                line: self.l.line_of(it.span.start),
                within: self.within.first().cloned().unwrap_or_default(),
                url,
            });
        }
        walk::walk_call_expression(self, it);
    }
}
