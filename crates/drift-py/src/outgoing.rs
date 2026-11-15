//! The requests a file sends with an HTTP client, and what is read of each URL
//! ([`drift_core::FileFacts::outgoing`]): whether its path is written out, or built
//! from the request being served. `drift security` reads them to tell an application
//! that calls another service from one that may relay requests to it.

use std::collections::BTreeMap;

use drift_core::OutgoingRequest;
use drift_core::practice::{UrlPart, outgoing_url};
use ruff_python_ast::visitor::{self, Visitor};
use ruff_python_ast::{self as ast, Expr, Stmt};
use ruff_text_size::Ranged;

use super::{Lowerer, arg, string_value};

/// Modules whose functions send a request (`httpx.get(url)`). The list to extend: a
/// client that is not on it is not seen.
const MODULES: &[&str] = &["httpx", "requests", "aiohttp", "urllib3"];
/// Their functions, and the methods of a client, that send one.
const SENDS: &[&str] = &[
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "request",
    "stream",
    "send",
    "build_request",
    "urlopen",
];
/// What builds a client or a session: a name bound to one sends requests.
const CLIENTS: &[&str] = &[
    "httpx.AsyncClient",
    "httpx.Client",
    "requests.Session",
    "requests.session",
    "aiohttp.ClientSession",
    "urllib3.PoolManager",
];

pub(crate) struct OutgoingFinder<'l, 't> {
    l: &'l Lowerer<'t>,
    text: &'t str,
    /// The names of the functions and classes around, outermost first.
    within: Vec<String>,
    /// Names bound to a string, module level first, then each function around.
    bound: Vec<BTreeMap<String, Vec<UrlPart>>>,
    /// Names bound to a client or a session (`client`, `self.http`).
    clients: Vec<String>,
    pub(crate) found: Vec<OutgoingRequest>,
}

/// `a` or `a.b`, as written.
fn name_of(e: &Expr) -> Option<String> {
    match e {
        Expr::Name(n) => Some(n.id.to_string()),
        Expr::Attribute(a) => Some(format!("{}.{}", name_of(&a.value)?, a.attr)),
        _ => None,
    }
}

impl<'l, 't> OutgoingFinder<'l, 't> {
    pub(crate) fn new(l: &'l Lowerer<'t>, text: &'t str) -> Self {
        OutgoingFinder {
            l,
            text,
            within: Vec::new(),
            bound: vec![BTreeMap::new()],
            clients: Vec::new(),
            found: Vec::new(),
        }
    }

    fn source(&self, e: &Expr) -> String {
        self.text
            .get(e.range().start().to_usize()..e.range().end().to_usize())
            .unwrap_or_default()
            .to_string()
    }

    fn builds_client(&self, e: &Expr) -> bool {
        let e = match e {
            Expr::Await(a) => a.value.as_ref(),
            e => e,
        };
        matches!(e, Expr::Call(c) if self
            .l
            .dotted_of(&c.func)
            .is_some_and(|d| CLIENTS.contains(&d.as_str())))
    }

    /// The pieces a URL expression is built from: literal text, and each value as
    /// written. A name bound to a string in the function or the module is what it is
    /// bound to.
    fn parts(&self, e: &Expr, depth: usize, out: &mut Vec<UrlPart>) {
        if depth > 8 {
            out.push(UrlPart::Value(self.source(e)));
            return;
        }
        if let Some(s) = string_value(e) {
            out.push(UrlPart::Text(s));
            return;
        }
        match e {
            Expr::FString(f) => {
                for part in f.value.iter() {
                    match part {
                        ast::FStringPartRef::Literal(l) => {
                            out.push(UrlPart::Text(l.value.to_string()))
                        }
                        ast::FStringPartRef::FString(fs) => {
                            for el in &fs.elements {
                                match el {
                                    ast::InterpolatedStringElement::Literal(l) => {
                                        out.push(UrlPart::Text(l.value.to_string()))
                                    }
                                    ast::InterpolatedStringElement::Interpolation(i) => {
                                        self.parts(&i.expression, depth + 1, out)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
                self.parts(&b.left, depth + 1, out);
                self.parts(&b.right, depth + 1, out);
            }
            // `str(x)`; `urljoin(base, path)`: the base, then the path.
            Expr::Call(c)
                if matches!(c.func.as_ref(), Expr::Name(n) if n.id.as_str() == "str")
                    || name_of(&c.func).is_some_and(|n| n.ends_with("urljoin")) =>
            {
                if c.arguments.args.is_empty() {
                    out.push(UrlPart::Value(self.source(e)));
                }
                for a in &c.arguments.args {
                    self.parts(a, depth + 1, out);
                }
            }
            Expr::Name(n) => {
                match self
                    .bound
                    .iter()
                    .rev()
                    .find_map(|scope| scope.get(n.id.as_str()))
                {
                    Some(parts) => out.extend(parts.iter().cloned()),
                    None => out.push(UrlPart::Value(self.source(e))),
                }
            }
            _ => out.push(UrlPart::Value(self.source(e))),
        }
    }

    /// The URL argument of a call that sends a request; none when the call sends none.
    /// `Some(None)`: it sends one to a URL that is not an argument Drift reads.
    fn sent<'a>(&self, c: &'a ast::ExprCall) -> Option<Option<&'a Expr>> {
        let Expr::Attribute(a) = c.func.as_ref() else {
            return None;
        };
        let verb = a.attr.as_str();
        if !SENDS.contains(&verb) {
            return None;
        }
        let module = self.l.dotted_of(&c.func).is_some_and(|d| {
            MODULES.contains(&d.split('.').next().unwrap_or_default())
                || d == "urllib.request.urlopen"
        });
        let client = name_of(&a.value).is_some_and(|n| self.clients.contains(&n))
            || self.builds_client(&a.value);
        if !(module || client) {
            return None;
        }
        // `request(method, url)` and the like name the method first.
        let at = usize::from(matches!(verb, "request" | "stream" | "build_request"));
        Some(match verb {
            // A request built elsewhere (`client.send(req)`) is read where it is built.
            "send" => return None,
            _ => arg(c, at, "url"),
        })
    }

    fn bind(&mut self, target: &Expr, value: &Expr) {
        let Some(name) = name_of(target) else { return };
        if self.builds_client(value) {
            self.clients.push(name);
        } else if matches!(
            value,
            Expr::FString(_) | Expr::BinOp(_) | Expr::StringLiteral(_)
        ) && !name.contains('.')
        {
            let mut parts = Vec::new();
            self.parts(value, 0, &mut parts);
            if let Some(scope) = self.bound.last_mut() {
                scope.insert(name, parts);
            }
        } else if let Some(scope) = self.bound.last_mut() {
            // Bound again to something that is not read.
            scope.remove(&name);
        }
    }
}

impl<'a> Visitor<'a> for OutgoingFinder<'_, '_> {
    fn visit_stmt(&mut self, s: &'a Stmt) {
        match s {
            Stmt::FunctionDef(f) => {
                self.within.push(f.name.to_string());
                self.bound.push(BTreeMap::new());
                let known = self.clients.len();
                // A parameter annotated as a client is one (`client: httpx.AsyncClient`).
                for p in f.parameters.iter() {
                    let annotated = p.annotation().is_some_and(|t| {
                        self.l
                            .dotted_of(t)
                            .is_some_and(|d| CLIENTS.contains(&d.as_str()))
                    });
                    if annotated {
                        self.clients.push(p.name().to_string());
                    }
                }
                visitor::walk_stmt(self, s);
                // `self.http = httpx.AsyncClient()` holds for the class's other methods.
                let kept: Vec<String> = self
                    .clients
                    .split_off(known)
                    .into_iter()
                    .filter(|n| n.contains('.'))
                    .collect();
                self.clients.extend(kept);
                self.bound.pop();
                self.within.pop();
                return;
            }
            Stmt::ClassDef(c) => {
                self.within.push(c.name.to_string());
                let known = self.clients.len();
                visitor::walk_stmt(self, s);
                self.clients.truncate(known);
                self.within.pop();
                return;
            }
            Stmt::Assign(a) => {
                if let [target] = a.targets.as_slice() {
                    self.bind(target, &a.value);
                }
            }
            Stmt::AnnAssign(a) => {
                if let Some(value) = &a.value {
                    self.bind(&a.target, value);
                }
            }
            Stmt::With(w) => {
                for item in &w.items {
                    if let Some(target) = &item.optional_vars {
                        self.bind(target, &item.context_expr);
                    }
                }
            }
            _ => {}
        }
        visitor::walk_stmt(self, s);
    }

    fn visit_expr(&mut self, e: &'a Expr) {
        if let Expr::Call(c) = e
            && let Some(url) = self.sent(c)
        {
            let (url, unread) = match url {
                Some(u) => {
                    let mut parts = Vec::new();
                    self.parts(u, 0, &mut parts);
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
                line: self.l.line(c),
                within: self.within.first().cloned().unwrap_or_default(),
                url,
            });
        }
        visitor::walk_expr(self, e);
    }
}
